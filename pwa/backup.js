/* Portable encrypted wallet bundles; legacy single-wallet files remain readable. */
globalThis.WalletBackup = (() => {
  const encode = (bytes) => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  };
  const decode = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  async function key(password, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function validate(wallet) {
    if (!wallet || typeof wallet.privateKey !== 'string' || !/^[a-f0-9]{64}$/i.test(wallet.privateKey)
      || typeof wallet.name !== 'string' || wallet.name.length > 24) throw new Error('잘못된 백업 파일입니다.');
    return { privateKey: wallet.privateKey.toLowerCase(), name: wallet.name };
  }
  function validateBundle(wallets) {
    if (!Array.isArray(wallets) || !wallets.length || wallets.length > 1000) throw new Error('잘못된 백업 파일입니다.');
    const unique = new Map();
    for (const item of wallets) {
      const wallet = validate(item);
      if (!unique.has(wallet.privateKey)) unique.set(wallet.privateKey, wallet);
    }
    return [...unique.values()];
  }
  return {
    maxFileSize: 1048576,
    matches(current, saved) {
      if (!Array.isArray(saved) || current.length !== saved.length) return false;
      const entries = new Map(saved.map(wallet => [wallet.privateKey.toLowerCase(), wallet.name]));
      return entries.size === current.length && current.every(wallet => entries.get(wallet.privateKey.toLowerCase()) === wallet.name);
    },
    merge(existing, current) {
      // File-only wallets are preserved; existing names win for duplicate keys.
      const merged = new Map();
      for (const wallet of [...validateBundle(existing), ...validateBundle(current)]) {
        if (!merged.has(wallet.privateKey)) merged.set(wallet.privateKey, wallet);
      }
      return validateBundle([...merged.values()]);
    },
    async writeVerified(handle, original, updated, isActive = () => true) {
      let stage = 'permission';
      const checkActive = () => { if (!isActive()) throw new Error('SESSION_ENDED'); };
      // Retry reads only: a transient read failure must never trigger another write.
      const readFresh = async () => {
        for (let attempt = 0; ; attempt++) {
          checkActive();
          try {
            const file = await handle.getFile();
            const text = await file.text();
            checkActive();
            return text;
          } catch (error) {
            if (error.name !== 'NotReadableError' || attempt >= 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
          }
        }
      };
      try {
        // Keep this request in the original button gesture, before any other await.
        if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('WRITE_DENIED');
        checkActive();
        stage = 'read-original';
        if (await readFresh() !== original) throw new Error('FILE_CHANGED');
        stage = 'open-writer';
        const stream = await handle.createWritable();
        try {
          checkActive();
          stage = 'write';
          await stream.write(updated);
          checkActive();
          stage = 'commit';
          await stream.close();
        } catch (error) {
          try { await stream.abort(); } catch {}
          throw error;
        }
        stage = 'verify';
        if (await readFresh() !== updated) throw new Error('VERIFY_FAILED');
      } catch (cause) {
        const error = new Error(cause.message, { cause });
        error.name = cause.name;
        error.backupStage = stage;
        throw error;
      }
    },
    async encrypt(wallets, password) {
      if (password.length < 10) throw new Error('백업 비밀번호는 10자 이상 입력해 주세요.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload = { wallets: validateBundle(wallets) };
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), new TextEncoder().encode(JSON.stringify(payload)));
      // Public names are for human inspection only. Restore trusts the encrypted payload.
      return JSON.stringify({ walletNames: payload.wallets.map(wallet => wallet.name), format: 'psl-wallet-backup', version: 2, kdf: 'PBKDF2-SHA256', iterations: 310000, cipher: 'AES-256-GCM', salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }, null, 2);
    },
    async decrypt(text, password) {
      if (typeof text !== 'string' || text.length > 1048576) throw new Error('백업 파일이 너무 큽니다.');
      const data = JSON.parse(text);
      if (data?.format !== 'psl-wallet-backup' || ![1, 2].includes(data.version) || data.kdf !== 'PBKDF2-SHA256' || data.iterations !== 310000 || data.cipher !== 'AES-256-GCM'
        || !['salt', 'iv', 'ciphertext'].every((field) => typeof data[field] === 'string')) throw new Error('지원하지 않는 백업 파일입니다.');
      const salt = decode(data.salt), iv = decode(data.iv), ciphertext = decode(data.ciphertext);
      if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) throw new Error('손상된 백업 파일입니다.');
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(password, salt), ciphertext);
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      return { wallets: validateBundle(data.version === 1 ? [payload] : payload?.wallets) };
    }
  };
})();
