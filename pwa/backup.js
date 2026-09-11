/* Portable, encrypted single-wallet backups. No browser storage or network access. */
globalThis.WalletBackup = (() => {
  const encode = (bytes) => btoa(String.fromCharCode(...bytes));
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
  return {
    async encrypt(wallet, password) {
      if (password.length < 10) throw new Error('백업 비밀번호는 10자 이상 입력해 주세요.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), new TextEncoder().encode(JSON.stringify(validate(wallet))));
      return JSON.stringify({ format: 'psl-wallet-backup', version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, cipher: 'AES-256-GCM', salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) });
    },
    async decrypt(text, password) {
      if (typeof text !== 'string' || text.length > 16384) throw new Error('백업 파일이 너무 큽니다.');
      const data = JSON.parse(text);
      if (data?.format !== 'psl-wallet-backup' || data.version !== 1 || data.kdf !== 'PBKDF2-SHA256' || data.iterations !== 310000 || data.cipher !== 'AES-256-GCM'
        || !['salt', 'iv', 'ciphertext'].every((field) => typeof data[field] === 'string')) throw new Error('지원하지 않는 백업 파일입니다.');
      const salt = decode(data.salt), iv = decode(data.iv), ciphertext = decode(data.ciphertext);
      if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17) throw new Error('손상된 백업 파일입니다.');
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(password, salt), ciphertext);
      return validate(JSON.parse(new TextDecoder().decode(plaintext)));
    }
  };
})();
