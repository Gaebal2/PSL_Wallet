const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../pwa/backup.js');

(async () => {
  const wallet = { privateKey: 'ab'.repeat(32), name: '테스트 지갑' };
  const password = 'backup-password-123';
  const wallet2 = { privateKey: 'cd'.repeat(32), name: '두 번째 지갑' };
  assert(WalletBackup.matches([wallet, wallet2], [wallet2, wallet]), 'Order does not affect backup status');
  assert(!WalletBackup.matches([wallet], [wallet, wallet2]), 'Removed wallet requires update');
  assert(!WalletBackup.matches([wallet, wallet2], [wallet]), 'Added wallet requires update');
  assert(!WalletBackup.matches([{ ...wallet, name: 'Renamed' }], [wallet]), 'Renamed wallet requires update');
  assert(!WalletBackup.matches([{ ...wallet, privateKey: wallet2.privateKey }], [wallet]), 'Changed key requires update');
  assert(!WalletBackup.matches([wallet], null), 'No verified backup is not good');
  const encrypted = await WalletBackup.encrypt([wallet, wallet2], password);
  assert(!encrypted.includes(wallet.privateKey));
  assert(!encrypted.includes(password));
  assert(!encrypted.includes(wallet2.privateKey));
  assert.deepEqual(JSON.parse(encrypted).walletNames, [wallet.name, wallet2.name]);
  const alteredNames = JSON.stringify({ ...JSON.parse(encrypted), walletNames: ['Forged display name'] });
  assert.deepEqual((await WalletBackup.decrypt(alteredNames, password)).wallets, [wallet, wallet2], 'Public names cannot override authenticated wallet data');
  assert.deepEqual(await WalletBackup.decrypt(encrypted, password), { wallets: [wallet, wallet2] });
  assert.notEqual(encrypted, await WalletBackup.encrypt([wallet, wallet2], password));
  assert.deepEqual((await WalletBackup.decrypt(await WalletBackup.encrypt([wallet, wallet], password), password)).wallets, [wallet]);
  await assert.rejects(WalletBackup.decrypt(encrypted, 'wrong-password'));
  const tampered = JSON.parse(encrypted);
  tampered.ciphertext = (tampered.ciphertext[0] === 'A' ? 'B' : 'A') + tampered.ciphertext.slice(1);
  await assert.rejects(WalletBackup.decrypt(JSON.stringify(tampered), password));
  await assert.rejects(WalletBackup.decrypt(JSON.stringify({ ...JSON.parse(encrypted), iterations: 1e10 }), password));
  await assert.rejects(WalletBackup.decrypt('x'.repeat(WalletBackup.maxFileSize + 1), password));
  await assert.rejects(WalletBackup.decrypt('{}', password));
  await assert.rejects(WalletBackup.encrypt([wallet], 'short'));
  await assert.rejects(WalletBackup.encrypt([wallet, { ...wallet, privateKey: 'invalid' }], password));
  await assert.rejects(WalletBackup.encrypt([], password));
  await assert.rejects(WalletBackup.encrypt(Array(1001).fill(wallet), password));
  // Build a v1 file using the original documented single-wallet format.
  const { pbkdf2Sync, createCipheriv, randomBytes } = require('node:crypto');
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', pbkdf2Sync(password, salt, 310000, 32, 'sha256'), iv);
  const legacyBytes = Buffer.concat([cipher.update(JSON.stringify(wallet)), cipher.final(), cipher.getAuthTag()]);
  const legacy = JSON.stringify({ format: 'psl-wallet-backup', version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, cipher: 'AES-256-GCM', salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: legacyBytes.toString('base64') });
  assert.deepEqual(await WalletBackup.decrypt(legacy, password), { wallets: [wallet] });
  const fileOnly = { privateKey: 'ef'.repeat(32), name: '파일에만 있는 지갑' };
  const combined = WalletBackup.merge([wallet, fileOnly], [{ ...wallet, name: '새 이름' }, wallet2]);
  assert.deepEqual(combined, [wallet, fileOnly, wallet2], 'Preserve file-only wallets and names; deduplicate private keys');
  const combinedText = await WalletBackup.encrypt(combined, password);
  function fileHandle(options = {}) {
    let stored = encrypted, staged, creates = 0, aborts = 0;
    return {
      requestPermission: async () => options.denied ? 'denied' : 'granted',
      getFile: async () => ({ text: async () => options.changed && !creates ? 'changed elsewhere' : options.corrupt && creates ? 'bad readback' : stored }),
      createWritable: async () => {
        creates++;
        return {
          write: async text => { staged = text; if (options.failWrite) throw new Error('DISK_FULL'); },
          close: async () => { stored = staged; },
          abort: async () => { staged = undefined; aborts++; },
        };
      },
      get stored() { return stored; }, get creates() { return creates; }, get aborts() { return aborts; },
    };
  }
  const handle = fileHandle();
  await WalletBackup.writeVerified(handle, encrypted, combinedText);
  assert.deepEqual((await WalletBackup.decrypt(handle.stored, password)).wallets, combined);
  const denied = fileHandle({ denied: true });
  await assert.rejects(WalletBackup.writeVerified(denied, encrypted, combinedText), /WRITE_DENIED/);
  assert.equal(denied.creates, 0);
  const changed = fileHandle({ changed: true });
  await assert.rejects(WalletBackup.writeVerified(changed, encrypted, combinedText), /FILE_CHANGED/);
  assert.equal(changed.creates, 0);
  const failed = fileHandle({ failWrite: true });
  await assert.rejects(WalletBackup.writeVerified(failed, encrypted, combinedText), /DISK_FULL/);
  assert.equal(failed.stored, encrypted);
  assert.equal(failed.aborts, 1);
  const corrupted = fileHandle({ corrupt: true });
  await assert.rejects(WalletBackup.writeVerified(corrupted, encrypted, combinedText), /VERIFY_FAILED/);
  const locked = fileHandle();
  await assert.rejects(WalletBackup.writeVerified(locked, encrypted, combinedText, () => false), /SESSION_ENDED/);
  assert.equal(locked.creates, 0);

  // Execute the actual app's wallet construction and gating functions with UI/RPC stubs.
  const source = fs.readFileSync(require.resolve('../pwa/app.js'), 'utf8');
  function extract(name) {
    const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
    assert(start >= 0);
    const end = source.indexOf('\n  }', start);
    return source.slice(start, end + 4);
  }
  const context = vm.createContext({
    wallets: [], activeWalletId: '', privateKey: '', gated: 0,
    SASEUL: { Sign: { publicKey: key => key, address: key => key } },
    $: () => ({}), showOnly() {}, renderWalletList() {}, resetAutoLock() {}, refresh() {},
    openDeviceBackup() { context.gated++; },
  });
  vm.runInContext(['walletAddress', 'makeWallet', 'activeWallet', 'address', 'shortenAddress', 'showWallet', 'mergeVerifiedWallets'].map(extract).join('\n'), context);
  vm.runInContext(`wallets = [makeWallet('${wallet.privateKey}', 'existing')]; showWallet();`, context);
  assert.equal(context.gated, 0, 'New wallets do not automatically open backup dialogs');
  vm.runInContext(`wallets = [makeWallet('${wallet.privateKey}', 'restored', true)]; showWallet();`, context);
  assert.equal(context.gated, 0, 'Verified/restored wallets can open');
  vm.runInContext(`wallets = JSON.parse(JSON.stringify(wallets)).map(w => makeWallet(w.privateKey, w.name, w.backupVerified)); showWallet();`, context);
  assert.equal(context.gated, 0, 'Verification survives reload');
  context.WalletBackup = WalletBackup;
  vm.runInContext(['makeBackupRecord', 'backupStatus'].map(extract).join('\n'), context);
  context.backupRecord = null;
  assert.equal(context.backupStatus(), 'missing');
  context.backupRecord = context.makeBackupRecord(context.wallets, 'test.json');
  assert.equal(context.backupStatus(), 'good');
  context.wallets[0].name = 'Renamed';
  assert.equal(context.backupStatus(), 'stale', 'Record must not share mutable wallet objects');
  context.backupRecord = JSON.parse(JSON.stringify(context.backupRecord));
  assert.equal(context.backupStatus(), 'stale', 'Backup record survives persistence');
  const old = { id: 'a', name: 'Keep my name', backupVerified: false };
  const pending = { id: 'b', backupVerified: false };
  const verified = context.mergeVerifiedWallets([old, pending], [{ id: 'a', name: 'Old name' }], 'a');
  assert.equal(verified.length, 2);
  assert.equal(verified[0].name, old.name);
  assert.equal(verified[0].backupVerified, true);
  assert.equal(verified[1].backupVerified, false, 'Old backups cannot unlock newly added wallets');
  assert.equal(old.backupVerified, false, 'Merging does not mutate existing state before persistence');
  assert.throws(() => context.mergeVerifiedWallets([old, pending], [{ id: 'a' }], 'b'));
  const all = context.mergeVerifiedWallets([old], [{ id: 'a' }, { id: 'b' }], 'b');
  assert.equal(all.length, 2);
  assert(all.every(wallet => wallet.backupVerified));

  // Run the real restore handler: verification must not resurrect deleted wallets,
  // overwrite current names, or report stale files as up to date.
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', open: true, classList: { add() {}, remove() {} }, reset() {}, close() { this.open = false; } });
    return elements.get(id);
  };
  const current = { ...wallet, id: wallet.privateKey, name: 'Current name', backupVerified: false };
  const restoreContext = vm.createContext({
    WalletBackup, wallets: [current], activeWalletId: current.id,
    backupRecord: null, backupVerificationId: current.id, backupBusy: false, backupWizardStep: 0, renderBackupWizard() {},
    vaultPassword: 'session-password', walletVault: 'old-vault',
    $: element, setLoading() {}, showWallet() {}, toast() {},
    persistWallets: async () => {},
    document: { querySelectorAll: () => [] },
    makeWallet: (key, name, backupVerified) => ({ id: key, privateKey: key, name, backupVerified })
  });
  vm.runInContext(['makeBackupRecord', 'backupStatus', 'mergeVerifiedWallets'].map(extract).join('\n'), restoreContext);
  const restoreStart = source.indexOf("  $('restoreBackupForm').onsubmit = async");
  const restoreEnd = source.indexOf('\n  async function start()', restoreStart);
  vm.runInContext(source.slice(restoreStart, restoreEnd), restoreContext);
  element('restoreBackupPassword').value = password;
  element('restoreBackupFile').files = [{ size: encrypted.length, name: 'saved.json', text: async () => encrypted }];
  await element('restoreBackupForm').onsubmit({ preventDefault() {} });
  assert.equal(restoreContext.wallets.length, 1, 'Verification does not import file-only wallets');
  assert.equal(restoreContext.wallets[0].name, 'Current name');
  assert(restoreContext.wallets[0].backupVerified);
  assert.equal(restoreContext.backupStatus(), 'stale');
  const exact = await WalletBackup.encrypt(restoreContext.wallets, password);
  element('restoreBackupFile').files = [{ size: exact.length, name: 'latest.json', text: async () => exact }];
  await element('restoreBackupForm').onsubmit({ preventDefault() {} });
  assert.equal(restoreContext.backupStatus(), 'good');
  assert.equal(restoreContext.backupRecord.fileName, 'latest.json');
  const previousRecord = restoreContext.backupRecord;
  restoreContext.persistWallets = async () => { throw new Error('DISK_FULL'); };
  element('restoreBackupFile').files = [{ size: encrypted.length, name: 'old.json', text: async () => encrypted }];
  await element('restoreBackupForm').onsubmit({ preventDefault() {} });
  assert.equal(restoreContext.backupRecord, previousRecord, 'Persistence failure rolls back the backup record');

  // Wizard verification is read-only until the separate final Use action.
  restoreContext.wallets = [{ ...current }];
  restoreContext.backupRecord = null;
  restoreContext.backupWizardStep = 2;
  let persisted = 0;
  restoreContext.persistWallets = async () => { persisted++; };
  element('restoreBackupFile').files = [{ size: encrypted.length, name: 'stale.json', text: async () => encrypted }];
  await element('restoreBackupForm').onsubmit({ preventDefault() {} });
  assert.equal(restoreContext.backupWizardStep, 2, 'A stale backup cannot advance the wizard');
  assert.equal(persisted, 0);
  element('restoreBackupFile').files = [{ size: exact.length, name: 'latest.json', text: async () => exact }];
  element('restoreBackupPassword').value = 'wrong-password';
  await element('restoreBackupForm').onsubmit({ preventDefault() {} });
  assert.equal(restoreContext.backupWizardStep, 2, 'Wrong password cannot advance');
  element('restoreBackupPassword').value = password;
  await element('restoreBackupForm').onsubmit({ preventDefault() {} });
  assert.equal(restoreContext.backupWizardStep, 3);
  assert.equal(persisted, 0, 'Next only verifies; it does not persist or unlock');
  assert.equal(restoreContext.wallets[0].backupVerified, false);
  await element('restoreBackupForm').onsubmit({ preventDefault() {} });
  assert.equal(persisted, 1, 'Use commits the verified backup');
  assert.equal(restoreContext.wallets[0].backupVerified, true);
  assert.equal(restoreContext.backupStatus(), 'good');

  // Exercise the two-step update UI and the real verified-write handler.
  function uiElement() {
    const classes = new Set();
    return {
      value: '', textContent: '', disabled: false, open: false, children: [],
      classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      showModal() { this.open = true; }, close() { this.open = false; },
      reset() {}, addEventListener() {}, querySelector() { return uiElement(); }, dataset: {}
    };
  }
  const updateElements = new Map();
  const ui = id => {
    if (!updateElements.has(id)) updateElements.set(id, uiElement());
    return updateElements.get(id);
  };
  const newlyAdded = { ...wallet2, id: wallet2.privateKey, backupVerified: false };
  const existing = { ...wallet, id: wallet.privateKey, backupVerified: true };
  const created = [];
  const updateContext = vm.createContext({
    WalletBackup, wallets: [existing, newlyAdded], activeWalletId: existing.id,
    backupRecord: null, backupBusy: false, updateBackupSelection: null, updateBackupPlan: null,
    vaultPassword: 'session-password', walletVault: 'old-vault', window: {},
    $: ui, setLoading(button, loading) { button.disabled = loading; },
    activeWallet: () => existing, persistWallets: async () => {}, showWallet() {}, toast() {},
    renderBackupStatus() {}, balanceState: () => ({ loading: true }), shortenAddress: value => value,
    document: { createElement() { const item = uiElement(); created.push(item); return item; } }
  });
  vm.runInContext(['makeBackupRecord', 'renderWalletList'].map(extract).join('\n'), updateContext);
  updateContext.renderWalletList();
  let choices = created.filter(item => item.className === 'wallet-choose-button');
  assert(choices[1].disabled);
  assert.equal(choices[1].textContent, '기기에 개인키 백업 후 사용가능');
  updateContext.wallets = [{ ...existing, backupVerified: false }];
  created.length = 0;
  updateContext.renderWalletList();
  choices = created.filter(item => item.className === 'wallet-choose-button');
  assert.equal(choices[0].textContent, '선택', 'A single wallet shows Select even before backup');
  assert(choices[0].disabled, 'The active wallet remains disabled');
  updateContext.wallets = [existing, newlyAdded];
  const updateStart = source.indexOf('  function syncBackupUpdateControls()');
  const routingContext = vm.createContext({
    $: ui, vaultPassword: 'session-password', backupBusy: false,
    backupRecord: { fileName: 'saved.json' }, status: 'stale',
    backupStatus: () => routingContext.status,
    openBackupUpdate() { routingContext.updated = true; },
    openDeviceBackup() { routingContext.created = true; },
    openRestoreBackup() {}
  });
  const routingStart = source.indexOf('  function handleBackupStatus()');
  const routingEnd = source.indexOf('  function backupFileName(', routingStart);
  vm.runInContext(source.slice(routingStart, routingEnd), routingContext);
  routingContext.handleBackupStatus();
  assert(ui('backupResolveDialog').open, 'Stale backups first show the method chooser');
  assert(!routingContext.updated && !routingContext.created);
  ui('backupResolveUpdate').onclick();
  assert(routingContext.updated && ui('backupResolveDialog').open, 'Update keeps the method chooser underneath');
  routingContext.handleBackupStatus();
  ui('backupResolveCreate').onclick();
  assert(routingContext.created && ui('backupResolveDialog').open, 'New backup keeps the method chooser underneath');
  routingContext.status = 'good';
  routingContext.handleBackupStatus();
  assert(ui('backupLocationDialog').open, 'Good backups still show saved-file details');
  routingContext.created = false;
  ui('backupLocationCreate').onclick();
  assert(routingContext.created && ui('backupLocationDialog').open, 'New backup keeps the saved-file details underneath');
  routingContext.activeWallet = () => existing;
  routingContext.resetDeviceBackup = () => {};
  routingContext.document = { querySelectorAll: () => { throw new Error('Opening a backup must not close parent dialogs'); } };
  vm.runInContext(extract('openDeviceBackup'), routingContext);
  const cancelStart = source.indexOf("  $('deviceBackupExit').onclick =");
  const cancelEnd = source.indexOf("  $('deviceBackupDialog').addEventListener('close'", cancelStart);
  vm.runInContext(source.slice(cancelStart, cancelEnd), routingContext);
  routingContext.openDeviceBackup();
  assert(ui('deviceBackupDialog').open);
  ui('deviceBackupExit').onclick();
  assert(!ui('deviceBackupDialog').open && ui('backupLocationDialog').open, 'Cancel new backup returns to saved-file details');
  const saveContext = vm.createContext({
    $: ui, backupBusy: false, preparedBackup: null, vaultPassword: 'session',
    backupPreparation: 0, backupSaveComplete: false, wallets: [wallet], WalletBackup,
    window: {}, setLoading(button, loading) { button.disabled = loading; },
    showAlert: async () => {},
    File: globalThis.File, backupFileName: () => 'backup.json',
    navigator: { canShare: () => true, share: async () => { saveContext.shared = true; } },
    downloadBackup() { saveContext.downloaded = true; },
    openRestoreBackup(verify) {
      assert(!ui('deviceBackupDialog').open, 'Close backup dialog before opening the file picker dialog');
      saveContext.verified = verify;
    }
  });
  const saveStart = source.indexOf("  $('deviceBackupClose').onclick =");
  const saveEnd = source.indexOf("  $('restoreBackupForm').onsubmit =", saveStart);
  vm.runInContext(extract('resetDeviceBackup') + '\n' + extract('prepareDeviceBackup'), saveContext);
  vm.runInContext(source.slice(saveStart, saveEnd), saveContext);
  ui('deviceBackupDialog').showModal();
  saveContext.resetDeviceBackup();
  assert(ui('deviceBackupVerify').disabled && ui('deviceBackupSave').disabled);
  ui('deviceBackupVerify').onclick();
  assert(!saveContext.verified, 'Verification cannot bypass the saving step');
  ui('deviceBackupPassword').value = password;
  ui('deviceBackupConfirm').value = 'mismatch';
  await saveContext.prepareDeviceBackup();
  assert(ui('deviceBackupSave').disabled, 'Mismatched passwords cannot save');
  ui('deviceBackupConfirm').value = password;
  await saveContext.prepareDeviceBackup();
  assert(!ui('deviceBackupSave').disabled && ui('deviceBackupVerify').disabled);
  let closeAlert;
  saveContext.showAlert = () => new Promise(resolve => { closeAlert = resolve; });
  const submitBackup = () => ui('deviceBackupForm').onsubmit({ preventDefault() {} });
  const sharing = submitBackup();
  assert(saveContext.shared, 'Native sharing starts synchronously from the save tap');
  await new Promise(resolve => setImmediate(resolve));
  assert(ui('deviceBackupVerify').disabled, 'Verification waits for completion popup');
  closeAlert();
  await sharing;
  assert(!ui('deviceBackupVerify').disabled && !saveContext.backupBusy && !saveContext.verified);
  saveContext.showAlert = async () => {};
  saveContext.navigator.share = async () => { throw Object.assign(new Error(), { name: 'AbortError' }); };
  await submitBackup();
  assert(!saveContext.backupBusy && saveContext.preparedBackup, 'Cancelled sharing allows a retry');
  assert(ui('deviceBackupVerify').disabled, 'Cancelled saves never enable verification');
  saveContext.navigator.canShare = () => false;
  await submitBackup();
  assert(saveContext.downloaded, 'Unsupported sharing falls back to a download');
  let written, closed = false;
  saveContext.window.showSaveFilePicker = async () => ({ createWritable: async () => ({
    write: async text => { written = text; }, close: async () => { closed = true; }, abort: async () => {}
  }) });
  await submitBackup();
  assert.equal(written, saveContext.preparedBackup.text);
  assert(closed && saveContext.backupSaveComplete, 'File handle is closed before completion');
  saveContext.window.showSaveFilePicker = async () => { throw new Error('Denied'); };
  await submitBackup();
  assert(ui('deviceBackupVerify').disabled && !saveContext.backupBusy, 'Failed saves allow retry without verification');
  delete saveContext.window.showSaveFilePicker;
  await submitBackup();
  ui('deviceBackupDialog').showModal();
  ui('deviceBackupVerify').onclick();
  assert(saveContext.verified, 'Verification opens from a separate user action');
  ui('deviceBackupDialog').showModal();
  ui('deviceBackupConfirm').value = 'changed-password';
  await saveContext.prepareDeviceBackup();
  assert(!saveContext.preparedBackup && ui('deviceBackupVerify').disabled, 'Password edits invalidate the previous prepared file');
  const updateEnd = source.indexOf('  function mergeVerifiedWallets(', updateStart);
  vm.runInContext(source.slice(updateStart, updateEnd), updateContext);
  updateContext.openBackupUpdate();
  assert.equal(ui('updateBackupChoose').disabled, false);
  assert.equal(ui('updateBackupReview').disabled, true);
  let fileText = await WalletBackup.encrypt([wallet], password);
  const writableHandle = {
    name: 'existing.json', requestPermission: async () => 'granted',
    getFile: async () => ({ name: 'existing.json', size: fileText.length, text: async () => fileText }),
    createWritable: async () => ({ write: async text => { fileText = text; }, close: async () => {}, abort: async () => {} })
  };
  updateContext.updateBackupSelection = { handle: writableHandle };
  updateContext.syncBackupUpdateControls();
  assert(ui('updateBackupReview').disabled, 'File alone cannot enable review');
  ui('updateBackupPassword').value = password;
  ui('updateBackupPassword').oninput();
  assert.equal(ui('updateBackupReview').disabled, false);
  await ui('updateBackupForm').onsubmit({ preventDefault() {} });
  assert(ui('updateBackupInput').classList.contains('hidden'), 'Review hides file/password controls');
  assert.equal(ui('updateBackupSummary').classList.contains('hidden'), false);
  assert.equal(ui('updateBackupFileName').textContent, 'existing.json');
  assert.deepEqual(ui('updateBackupOldWallets').children.map(item => item.textContent), [wallet.name]);
  assert.deepEqual(ui('updateBackupNewWallets').children.map(item => item.textContent), [wallet.name, wallet2.name]);
  await ui('updateBackupAccept').onclick();
  assert(!updateContext.wallets[1].backupVerified, 'Saving an updated backup does not unlock pending wallets');
  assert.equal(ui('updateBackupNext').disabled, false, 'Successful update enables the next step');
  assert(WalletBackup.matches(updateContext.wallets, (await WalletBackup.decrypt(fileText, password)).wallets));
  created.length = 0;
  updateContext.renderWalletList();
  choices = created.filter(item => item.className === 'wallet-choose-button');
  assert.equal(choices[1].disabled, true, 'Updated wallet stays locked until the final import');
  assert.equal(choices[1].textContent, '기기에 개인키 백업 후 사용가능');
  console.log('✓ Backup round-trip, wrong password, tampering, malformed input, random encryption and wallet migration/gating passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
