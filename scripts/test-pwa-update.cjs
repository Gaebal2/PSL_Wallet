const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const source = fs.readFileSync(require.resolve('../pwa/app.js'), 'utf8');
  const start = source.indexOf("  if ('serviceWorker' in navigator && location.protocol");
  const updateCode = source.slice(start, source.lastIndexOf('\n})();'));
  async function harness(controlled = true) {
    const events = {}, intervals = new Map();
    let reloads = 0, checks = 0, dialog = false, inputs = [];
    const registration = { update: async () => { checks++; } };
    const context = vm.createContext({
      backupBusy: false, transferInFlight: false,
      location: { protocol: 'https:', reload() { reloads++; } },
      document: { hidden: false, querySelector: () => dialog, querySelectorAll: () => inputs,
        addEventListener: (name, fn) => { events[name] = fn; } },
      window: { addEventListener: (name, fn) => { events[name] = fn; } },
      navigator: { serviceWorker: { controller: controlled ? {} : null,
        addEventListener: (name, fn) => { events[name] = fn; },
        register: async (_, options) => { assert.equal(options.updateViaCache, 'none'); return registration; } } },
      setInterval: (fn, ms) => intervals.set(ms, fn)
    });
    vm.runInContext(updateCode, context);
    await new Promise(resolve => setImmediate(resolve));
    return { context, events, intervals, get reloads() { return reloads; }, get checks() { return checks; },
      setDialog: value => { dialog = value; }, setInputs: value => { inputs = value; } };
  }
  const fresh = await harness(false);
  fresh.events.controllerchange();
  assert.equal(fresh.reloads, 0, 'First installation does not reload');
  const idle = await harness();
  idle.events.controllerchange();
  idle.events.controllerchange();
  assert.equal(idle.reloads, 1, 'New worker reloads an idle app only once');
  for (const busy of ['backupBusy', 'transferInFlight']) {
    const app = await harness();
    app.context[busy] = true;
    app.events.controllerchange();
    assert.equal(app.reloads, 0);
    app.context[busy] = false;
    app.intervals.get(1000)();
    assert.equal(app.reloads, 1, `Update resumes after ${busy}`);
  }
  const editing = await harness();
  editing.setDialog(true);
  editing.events.controllerchange();
  assert.equal(editing.reloads, 0, 'Open dialogs are preserved');
  editing.setDialog(false);
  editing.setInputs([{ value: 'unfinished', offsetParent: {} }]);
  editing.intervals.get(1000)();
  assert.equal(editing.reloads, 0, 'Visible form inputs are preserved');
  editing.setInputs([]);
  editing.intervals.get(1000)();
  assert.equal(editing.reloads, 1);
  const background = await harness();
  background.context.document.hidden = true;
  background.events.controllerchange();
  background.events.visibilitychange();
  assert.equal(background.reloads, 0);
  assert.equal(background.checks, 1, 'No polling while hidden');
  background.context.document.hidden = false;
  background.events.visibilitychange();
  assert.equal(background.reloads, 1, 'Returning to the app applies the update');
  assert.equal(background.checks, 2);
  console.log('✓ PWA update detection, foreground refresh and active-work preservation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
