const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../pwa/backup.js');

(async () => {
  const wallet = { privateKey: 'ab'.repeat(32), name: '테스트 지갑' };
  const password = 'backup-password-123';
  const wallet2 = { privateKey: 'cd'.repeat(32), name: '두 번째 지갑' };
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
  vm.runInContext(['walletAddress', 'makeWallet', 'activeWallet', 'address', 'shortenAddress', 'showWallet', 'mergeVerifiedWallets'].map(extract).join('\n'), context);
  vm.runInContext(`wallets = [makeWallet('${wallet.privateKey}', 'existing')]; showWallet();`, context);
  assert.equal(context.gated, 1, 'Legacy/new wallets require backup verification');
  vm.runInContext(`wallets = [makeWallet('${wallet.privateKey}', 'restored', true)]; showWallet();`, context);
  assert.equal(context.gated, 1, 'Verified/restored wallets can open');
  vm.runInContext(`wallets = JSON.parse(JSON.stringify(wallets)).map(w => makeWallet(w.privateKey, w.name, w.backupVerified)); showWallet();`, context);
  assert.equal(context.gated, 1, 'Verification survives reload');
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
  console.log('✓ Backup round-trip, wrong password, tampering, malformed input, random encryption and wallet migration/gating passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
