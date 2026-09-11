const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../pwa/backup.js');

(async () => {
  const wallet = { privateKey: 'ab'.repeat(32), name: '테스트 지갑' };
  const password = 'backup-password-123';
  const encrypted = await WalletBackup.encrypt(wallet, password);
  assert(!encrypted.includes(wallet.privateKey));
  assert(!encrypted.includes(password));
  assert.deepEqual(await WalletBackup.decrypt(encrypted, password), wallet);
  assert.notEqual(encrypted, await WalletBackup.encrypt(wallet, password));
  await assert.rejects(WalletBackup.decrypt(encrypted, 'wrong-password'));
  const tampered = JSON.parse(encrypted);
  tampered.ciphertext = (tampered.ciphertext[0] === 'A' ? 'B' : 'A') + tampered.ciphertext.slice(1);
  await assert.rejects(WalletBackup.decrypt(JSON.stringify(tampered), password));
  await assert.rejects(WalletBackup.decrypt(JSON.stringify({ ...JSON.parse(encrypted), iterations: 1e10 }), password));
  await assert.rejects(WalletBackup.decrypt('x'.repeat(16385), password));
  await assert.rejects(WalletBackup.decrypt('{}', password));
  await assert.rejects(WalletBackup.encrypt(wallet, 'short'));
  await assert.rejects(WalletBackup.encrypt({ ...wallet, privateKey: 'invalid' }, password));

  // Execute the actual app's wallet construction and gating functions with UI/RPC stubs.
  const source = fs.readFileSync(require.resolve('../pwa/app.js'), 'utf8');
  function extract(name) {
    const start = source.indexOf(`  function ${name}(`);
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
  vm.runInContext(['walletAddress', 'makeWallet', 'activeWallet', 'address', 'shortenAddress', 'showWallet'].map(extract).join('\n'), context);
  vm.runInContext(`wallets = [makeWallet('${wallet.privateKey}', 'existing')]; showWallet();`, context);
  assert.equal(context.gated, 1, 'Legacy/new wallets require backup verification');
  vm.runInContext(`wallets = [makeWallet('${wallet.privateKey}', 'restored', true)]; showWallet();`, context);
  assert.equal(context.gated, 1, 'Verified/restored wallets can open');
  vm.runInContext(`wallets = JSON.parse(JSON.stringify(wallets)).map(w => makeWallet(w.privateKey, w.name, w.backupVerified)); showWallet();`, context);
  assert.equal(context.gated, 1, 'Verification survives reload');
  console.log('✓ Backup round-trip, wrong password, tampering, malformed input, random encryption and wallet migration/gating passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
