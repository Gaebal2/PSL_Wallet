const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../pwa/app.js'), 'utf8');
function harness(ios, standalone = false) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        open: false, attributes: {}, textContent: '', focused: false,
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        setAttribute(name, value) { this.attributes[name] = value; },
        focus() { this.focused = true; },
        showModal() { this.open = true; }, close() { this.open = false; }
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({ $, deferredInstallPrompt: null,
    navigator: { userAgent: ios ? 'iPhone' : 'Android', maxTouchPoints: 1 },
    window: { navigator: { standalone }, matchMedia: () => ({ matches: standalone }), addEventListener() {} },
    document: { querySelector: () => null }, setTimeout() {}, toast() {},
    localStorage: { setItem() {} }, INSTALLED_KEY: 'installed'
  });
  vm.runInContext(source.slice(source.indexOf('  function isStandalone()'), source.indexOf("  document.querySelectorAll('[data-password-toggle]')")), context);
  return { $, context };
}

(async () => {
  const { $, context } = harness(true);
  vm.runInContext('showInstallDialog()', context);
  assert.equal($('installDialog').open, true);
  assert.equal($('iosInstallHelp').classList.contains('hidden'), true);
  await $('installBtn').onclick();
  assert.equal($('iosInstallHelp').classList.contains('hidden'), false);
  assert.equal($('iosInstallHelp').focused, true);
  assert.equal($('installBtn').attributes['aria-expanded'], 'true');
  assert.equal($('installBtn').textContent, '닫기');
  await $('installBtn').onclick();
  assert.equal($('installDialog').open, false);
  vm.runInContext('showInstallDialog()', context);
  assert.equal($('iosInstallHelp').classList.contains('hidden'), true);
  assert.equal($('installBtn').attributes['aria-expanded'], 'false');
  for (const app of [harness(true, true), harness(false)]) {
    vm.runInContext('showInstallDialog()', app.context);
    assert.equal(app.$('installDialog').open, false);
  }
  let prompted = false;
  context.deferredInstallPrompt = { prompt: async () => { prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
  await $('installBtn').onclick();
  assert.equal(prompted, true);
  assert.equal($('installDialog').open, false);
  console.log('✓ Install guide reveal, close, reset, standalone suppression and native prompt passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
