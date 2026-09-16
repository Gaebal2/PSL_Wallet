(() => {
  'use strict';

  if (window.top !== window.self) return;
  document.documentElement.classList.add('app-context-verified');

  const $ = (id) => document.getElementById(id);

  function disableInputSuggestions(root = document) {
    root.querySelectorAll('form').forEach((form) => form.setAttribute('autocomplete', form.querySelector('[data-password-autocomplete]') ? 'on' : 'off'));
    root.querySelectorAll('input:not([type="checkbox"]), textarea').forEach((input) => {
      input.setAttribute('autocomplete', input.dataset.passwordAutocomplete || 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('spellcheck', 'false');
      if (input.dataset.passwordAutocomplete) input.removeAttribute('aria-autocomplete');
      else input.setAttribute('aria-autocomplete', 'none');
    });
  }

  disableInputSuggestions();
  new MutationObserver((mutations) => {
    mutations.forEach(({ addedNodes }) => addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches('form, input:not([type="checkbox"]), textarea')) disableInputSuggestions(node.parentElement || document);
      else disableInputSuggestions(node);
    }));
  }).observe(document.body, { childList: true, subtree: true });
  const VAULT_KEY = 'psl-wallet-vault-v1';
  const CONFIG_KEY = 'psl-wallet-config-v1';
  const LEGACY_KEY = 'psl-wallet-key';
  const WALLET_DB = 'psl-wallet-storage-v1';
  const WALLET_STORE = 'wallet';
  const SL_SYSTEM_CID = '19bd191ea2da3fd599528b4b831206ec5cf958d6cdbea0188a22d7d44673dd58';
  const DEFAULT_PSL_CID = 'dbd6217ffd83c29c077571c5be8eb945418f6cef27ab4ba92f378acb6a1d0080';
  const INSTALLED_KEY = 'psl-wallet-installed-v1';
  const PENDING_TRANSFERS_KEY = 'psl-wallet-pending-transfers-v1';
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const defaults = { endpoint: 'https://main.saseul.net', owner: '', space: 'MY TOKEN', cid: DEFAULT_PSL_CID };
  let config = readJson(CONFIG_KEY, defaults);
  if (typeof config.endpoint !== 'string' || !config.endpoint.trim()) config.endpoint = defaults.endpoint;
  if (!config.cid) config.cid = DEFAULT_PSL_CID;
  let privateKey = '';
  let wallets = [];
  let activeWalletId = '';
  let vaultPassword = '';
  const walletBalances = new Map();
  let token = { symbol: 'PSL', decimal: 0 };
  let rawBalance = '0';
  let rawSlBalance = '0';
  let selectedAsset = 'PSL';
  let autoLockTimer;
  let deferredInstallPrompt = null;
  let isRefreshing = false;
  let historyPage = 1;
  let historyLoading = false;
  let historyRequestId = 0;
  let dialogScrollY = 0;
  let pullStart = null;
  let pullDistance = 0;
  let suppressLockClickUntil = 0;
  let walletVault = null;
  let transferInFlight = false;
  const PULL_THRESHOLD = 72;

  function readJson(key, fallback) {
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
    catch { return { ...fallback }; }
  }

  function toast(message) {
    const toastElement = $('toast');
    toastElement.textContent = message;
    if (typeof toastElement.showPopover === 'function' && !toastElement.matches(':popover-open')) toastElement.showPopover();
    toastElement.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      toastElement.classList.remove('show');
      if (typeof toastElement.hidePopover === 'function' && toastElement.matches(':popover-open')) toastElement.hidePopover();
    }, 2600);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }

  function openWalletDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB is unavailable'));
      const request = indexedDB.open(WALLET_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(WALLET_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function durableVault(action, value) {
    const db = await openWalletDb();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(WALLET_STORE, action === 'get' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore(WALLET_STORE);
        const request = action === 'get' ? store.get(VAULT_KEY)
          : action === 'put' ? store.put(value, VAULT_KEY) : store.delete(VAULT_KEY);
        request.onsuccess = () => resolve(action === 'get' ? request.result || null : undefined);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }

  async function initializeVault() {
    const localVault = localStorage.getItem(VAULT_KEY);
    let indexedVault = null;
    try { indexedVault = await durableVault('get'); } catch { /* localStorage is the fallback */ }
    walletVault = localVault || indexedVault;
    if (walletVault && !localVault) localStorage.setItem(VAULT_KEY, walletVault);
    if (walletVault && !indexedVault) {
      try { await durableVault('put', walletVault); } catch { /* best-effort redundant copy */ }
    }
    if (walletVault && navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch { /* browser-controlled */ }
    }
  }

  async function passwordKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptVault(value, password) {
    if (!crypto?.subtle) throw new Error('이 브라우저는 안전한 암호화 저장소를 지원하지 않습니다.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const derivedKey = await passwordKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, new TextEncoder().encode(value));
    walletVault = JSON.stringify({ version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) });
    localStorage.setItem(VAULT_KEY, walletVault);
    try { await durableVault('put', walletVault); } catch { /* local copy is still usable */ }
    if (navigator.storage?.persist) {
      try { await navigator.storage.persist(); } catch { /* browser-controlled */ }
    }
  }

  async function decryptVault(password) {
    const vault = JSON.parse(walletVault || localStorage.getItem(VAULT_KEY));
    if (!vault || vault.version !== 1) throw new Error('지원하지 않는 지갑 데이터입니다.');
    const key = await passwordKey(password, base64ToBytes(vault.salt));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(vault.iv) }, key, base64ToBytes(vault.ciphertext));
    const value = new TextDecoder().decode(plaintext);
    if (SASEUL.Sign.keyValidity(value)) {
      return { version: 2, wallets: [makeWallet(value, '지갑 1')], activeWalletId: '' };
    }
    const data = JSON.parse(value);
    if (data?.version !== 2 || !Array.isArray(data.wallets) || !data.wallets.length
      || data.wallets.some((item) => !SASEUL.Sign.keyValidity(item.privateKey))) {
      throw new Error('지갑 데이터가 손상되었습니다.');
    }
    return data;
  }

  function address() {
    return privateKey ? SASEUL.Sign.address(SASEUL.Sign.publicKey(privateKey)) : '';
  }

  function walletAddress(wallet) {
    return SASEUL.Sign.address(SASEUL.Sign.publicKey(wallet.privateKey));
  }

  function shortenAddress(value) {
    const text = String(value || '');
    return text.length > 10 ? `${text.slice(0, 5)}…${text.slice(-5)}` : text;
  }

  function makeWallet(key, name, backupVerified = false) {
    const privateKeyValue = key.toLowerCase();
    const walletAddressValue = walletAddress({ privateKey: privateKeyValue });
    return { id: walletAddressValue, name: name || `지갑 ${wallets.length + 1}`, privateKey: privateKeyValue, backupVerified: backupVerified === true };
  }

  function activeWallet() {
    return wallets.find((wallet) => wallet.id === activeWalletId) || wallets[0];
  }

  async function persistWallets() {
    if (!vaultPassword || !wallets.length) throw new Error('지갑 잠금을 먼저 해제해 주세요.');
    await encryptVault(JSON.stringify({ version: 2, wallets, activeWalletId, backupRecord }), vaultPassword);
  }

  function contractId() {
    if (config.cid) return config.cid;
    if (!SASEUL.Sign.addressValidity(config.owner)) throw new Error('설정에서 토큰 CID 또는 올바른 발행자 주소를 입력해 주세요.');
    return SASEUL.Enc.cid(config.owner, config.space);
  }

  function setLoading(button, loading, label) {
    button.disabled = loading;
    button.textContent = loading ? '처리 중…' : label;
  }

  function formatUnits(value, decimals) {
    const negative = String(value).startsWith('-');
    const digits = String(value).replace('-', '').padStart(decimals + 1, '0');
    if (!decimals) return `${negative ? '-' : ''}${digits}`;
    const integer = digits.slice(0, -decimals);
    const fraction = digits.slice(-decimals).replace(/0+$/, '');
    return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
  }

  function formatCompactUnits(value, decimals, maxFraction = 9) {
    const exact = formatUnits(value, decimals);
    const raw = BigInt(value);
    const magnitude = raw < 0n ? -raw : raw;
    const units = [[12, 'T'], [9, 'B'], [6, 'M'], [3, 'K']];
    if (maxFraction === 0) {
      const divisor = 10n ** BigInt(decimals);
      const whole = raw / divisor;
      const wholeMagnitude = whole < 0n ? -whole : whole;
      const wholeUnit = units.find(([power]) => wholeMagnitude >= 10n ** BigInt(power));
      if (wholeUnit) {
        const [power, suffix] = wholeUnit;
        return `${whole / (10n ** BigInt(power))}${suffix}`;
      }
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(whole);
    }
    const unit = units.find(([power]) => magnitude >= 10n ** BigInt(decimals + power));
    if (unit) {
      const [power, suffix] = unit;
      const [integer, fraction = ''] = formatUnits(value, decimals + power).split('.');
      const visibleFraction = fraction.slice(0, maxFraction).replace(/0+$/, '');
      return `${integer}${visibleFraction ? `.${visibleFraction}` : ''}${suffix}`;
    }
    const numeric = Number(exact);
    if (!Number.isFinite(numeric)) return exact;
    const absolute = Math.abs(numeric);
    if (absolute > 0 && absolute < 10 ** -maxFraction) return `< ${`0.${'0'.repeat(maxFraction - 1)}1`}`;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.min(decimals, maxFraction) }).format(numeric);
  }

  function formatDisplayUnits(value, decimals) {
    const [integer, fraction] = formatUnits(value, decimals).split('.');
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction ? `${grouped}.${fraction}` : grouped;
  }

  function generatePrivateKey() {
    if (!globalThis.crypto?.getRandomValues) throw new Error('이 브라우저는 안전한 지갑 생성을 지원하지 않습니다.');
    const seed = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(seed, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function formatPslBalance(value) {
    return formatCompactUnits(value, token.decimal);
  }

  function parseUnits(value, decimals) {
    const text = String(value).replace(/,/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('수량을 숫자로 입력해 주세요.');
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > decimals) throw new Error(`소수점은 최대 ${decimals}자리까지 입력할 수 있습니다.`);
    return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, '0') || '0')).toString();
  }

  function rpcError(error) {
    const contractMessage = error?.msg || error?.message || error?.data?.msg || error?.data;
    if (typeof contractMessage === 'string' && /can't send more than what you have/i.test(contractMessage)) return '보유 수량이 부족합니다.';
    if (typeof error?.msg === 'string') return error.msg;
    if (typeof error?.message === 'string') return error.message;
    if (typeof error?.data?.msg === 'string') return error.data.msg;
    if (typeof error?.data === 'string') return error.data;
    return '네트워크 요청에 실패했습니다.';
  }

  function transactionAccepted(result) {
    if (result?.code === 200) return true;
    return /already|duplicate|exist|중복|이미 (처리|존재|등록)/i.test(rpcError(result));
  }

  async function submitTransaction(signed) {
    let directError;
    try {
      const result = await SASEUL.Rpc.sendTransaction(signed);
      if (transactionAccepted(result)) return result;
      directError = result;
    } catch (error) { directError = error; }
    try {
      const result = await SASEUL.Rpc.broadcastTransaction(signed);
      if (transactionAccepted(result)) return result;
      throw result;
    } catch (error) {
      if (transactionAccepted(error) || transactionAccepted(directError)) return { code: 200 };
      throw error?.code || error?.message ? error : directError;
    }
  }

  function normalizeBalance(value, decimals) {
    const text = String(value ?? '0').trim();
    if (!text.includes('.')) return BigInt(text || '0').toString();
    const [whole, fraction = ''] = text.split('.');
    const significantFraction = fraction.replace(/0+$/, '');
    return parseUnits(significantFraction ? `${whole}.${significantFraction}` : whole, decimals);
  }

  function parseTokenUnits(value, decimals) {
    const text = String(value ?? '0').replace(/,/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('토큰 잔액 형식이 올바르지 않습니다.');
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new Error('토큰 소수 자릿수가 설정과 일치하지 않습니다.');
    const usableFraction = fraction.slice(0, decimals);
    return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(usableFraction.padEnd(decimals, '0') || '0')).toString();
  }

  function formatAmountInput(value) {
    const raw = String(value).replace(/,/g, '');
    if (!/^\d*(\.\d*)?$/.test(raw)) return null;
    if (!raw) return '';
    const [integer = '', fraction] = raw.split('.');
    const grouped = (integer || '0').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
  }

  async function estimateTransactionFee(signed) {
    try {
      const fee = await SASEUL.Rpc.estimatedFee(signed);
      if (Number.isFinite(Number(fee)) && Number(fee) >= 0) return BigInt(Math.trunc(Number(fee))).toString();
    } catch { /* use the SDK's standard Send transaction fallback below */ }
    return (BigInt(JSON.stringify(signed).length + 336) * 1000000000n).toString();
  }

  function formatSlFee(fee) {
    return `${formatDisplayUnits(fee, 18)} SL`;
  }

  function confirmTransfer(amount, symbol, to, fee) {
    const dialog = $('transferReviewDialog');
    $('transferReviewAmount').textContent = `${amount} ${symbol}`;
    $('transferReviewFee').textContent = formatSlFee(fee);
    $('transferReviewAddress').textContent = to;
    dialog.showModal();
    return new Promise((resolve) => {
      let settled = false;
      const onCancel = (event) => { event.preventDefault(); finish(false); };
      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('cancel', onCancel);
        dialog.close();
        resolve(confirmed);
      };
      $('transferReviewCancel').onclick = () => finish(false);
      $('transferReviewConfirm').onclick = () => finish(true);
      dialog.addEventListener('cancel', onCancel);
    });
  }

  function showAlert(message, title = '확인해 주세요', details = []) {
    const dialog = $('appAlertDialog');
    $('appAlertTitle').textContent = title;
    $('appAlertMessage').textContent = message;
    const detailList = $('appAlertDetails');
    detailList.replaceChildren();
    detailList.classList.toggle('hidden', !details.length);
    details.forEach(({ label, values, literal = false }) => {
      const term = document.createElement('dt');
      term.textContent = label;
      detailList.append(term);
      values.forEach(value => {
        const description = document.createElement('dd');
        if (literal) description.setAttribute('translate', 'no');
        description.textContent = value;
        detailList.append(description);
      });
    });
    dialog.showModal();
    return new Promise((resolve) => {
      const finish = () => {
        dialog.removeEventListener('cancel', onCancel);
        dialog.removeEventListener('close', finish);
        dialog.close();
        resolve();
      };
      const onCancel = (event) => { event.preventDefault(); finish(); };
      $('appAlertClose').onclick = finish;
      dialog.addEventListener('cancel', onCancel);
      dialog.addEventListener('close', finish);
    });
  }

  function confirmDanger(title, message, requirePhrase = false) {
    const dialog = $('dangerConfirmDialog');
    const phraseWrap = $('dangerConfirmPhraseWrap');
    const phraseInput = $('dangerConfirmPhrase');
    $('dangerConfirmTitle').textContent = title;
    $('dangerConfirmMessage').textContent = message;
    $('dangerConfirmError').textContent = '';
    phraseWrap.classList.toggle('hidden', !requirePhrase);
    phraseInput.value = '';
    dialog.showModal();
    if (requirePhrase) setTimeout(() => phraseInput.focus(), 0);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('cancel', onCancel);
        dialog.close();
        resolve(confirmed);
      };
      const onCancel = (event) => { event.preventDefault(); finish(false); };
      $('dangerConfirmCancel').onclick = () => finish(false);
      $('dangerConfirmAccept').onclick = () => {
        if (requirePhrase && phraseInput.value.trim() !== (WalletI18n.language === 'en' ? 'DELETE' : '삭제')) {
          $('dangerConfirmError').textContent = '“삭제”를 정확히 입력해 주세요.';
          phraseInput.focus();
          return;
        }
        finish(true);
      };
      dialog.addEventListener('cancel', onCancel);
    });
  }

  function requestTextInput(title, label, initialValue = '') {
    const dialog = $('textInputDialog');
    const input = $('textInputValue');
    $('textInputTitle').textContent = title;
    $('textInputLabel').textContent = label;
    $('textInputError').textContent = '';
    input.value = initialValue;
    dialog.showModal();
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('cancel', onCancel);
        dialog.close();
        resolve(value);
      };
      const onCancel = (event) => { event.preventDefault(); finish(null); };
      $('textInputCancel').onclick = () => finish(null);
      $('textInputAccept').onclick = () => {
        const value = input.value.trim();
        if (!value) {
          $('textInputError').textContent = '지갑 이름을 입력해 주세요.';
          input.focus();
          return;
        }
        finish(value);
      };
      input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); $('textInputAccept').click(); } };
      dialog.addEventListener('cancel', onCancel);
    });
  }

  function confirmPrivateKeyBackup() {
    const dialog = $('backupConfirmDialog');
    dialog.showModal();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        dialog.removeEventListener('cancel', onCancel);
        dialog.close();
        resolve(confirmed);
      };
      const onCancel = (event) => { event.preventDefault(); finish(false); };
      $('backupConfirmCancel').onclick = () => finish(false);
      $('backupConfirmAccept').onclick = () => finish(true);
      dialog.addEventListener('cancel', onCancel);
    });
  }

  function showPrivateKeyBackup() {
    const list = $('privateKeyList');
    list.replaceChildren();
    wallets.forEach(wallet => {
      const item = document.createElement('section');
      item.className = 'private-key-entry';
      const name = document.createElement('strong');
      name.textContent = wallet.name;
      name.translate = false;
      const addressValue = document.createElement('code');
      addressValue.className = 'private-key-address';
      addressValue.textContent = wallet.id;
      const row = document.createElement('div');
      row.className = 'private-key-box';
      const key = document.createElement('code');
      key.textContent = wallet.privateKey;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', '개인키 복사');
      button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></svg>';
      button.onclick = () => copy(wallet.privateKey);
      row.append(key, button);
      item.append(name, addressValue, row);
      list.append(item);
    });
    const dialog = $('privateKeyDialog');
    dialog.oncancel = (event) => { event.preventDefault(); closePrivateKeyBackup(); };
    dialog.showModal();
  }

  function closePrivateKeyBackup() {
    $('privateKeyDialog').close();
    $('privateKeyList').replaceChildren();
  }

  function isInvalidPslTransferAmount(value) {
    const text = String(value).replace(/,/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return false;
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole) < 1n || fraction.length > 0;
  }

  async function validatePslTransfer() {
    let cid;
    try { cid = contractId(); }
    catch { throw new Error('PSL 토큰 CID 또는 발행자 주소를 네트워크 설정에서 먼저 입력해 주세요.'); }
    const walletAddressValue = address();
    const [infoResult, balanceResult] = await Promise.all([
      SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ cid, type: 'GetInfo' }, privateKey)),
      SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ cid, type: 'GetBalance', address: walletAddressValue }, privateKey))
    ]);
    if (infoResult.code !== 200) throw new Error(`PSL 컨트랙트를 확인할 수 없습니다: ${rpcError(infoResult)}`);
    if (balanceResult.code !== 200) throw new Error(`PSL 잔액을 확인할 수 없습니다: ${rpcError(balanceResult)}`);
    token = { symbol: infoResult.data.symbol || 'PSL', decimal: Number(infoResult.data.decimal || 0) };
    rawBalance = parseTokenUnits(balanceResult.data.balance, token.decimal);
    return cid;
  }

  function applyConfig() {
    $('endpoint').value = config.endpoint;
    $('cid').value = config.cid;
    SASEUL.Rpc.endpoints([config.endpoint]);
    SASEUL.Rpc.timeout(12000);
  }

  function showOnly(id) {
    ['onboarding', 'unlock', 'wallet'].forEach((view) => $(view).classList.toggle('hidden', view !== id));
    $('lockBtn').classList.toggle('hidden', id !== 'wallet');
  }

  function showWallet() {
    const current = activeWallet();
    if (!current) return lockWallet(false);
    activeWalletId = current.id;
    privateKey = current.privateKey;
    showOnly('wallet');
    $('activeWalletName').textContent = current.name;
    $('accountAddress').textContent = shortenAddress(address());
    $('receiveAddress').textContent = address();
    renderWalletList();
    resetAutoLock();
    refresh();

  }

  function lockWallet(notify = true) {
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    $('deviceBackupForm').reset();
    $('restoreBackupForm').reset();
    privateKey = '';
    vaultPassword = '';
    wallets = [];
    backupRecord = null;
    $('privateKeyList').replaceChildren();
    renderBackupStatus();
    activeWalletId = '';
    walletBalances.clear();
    clearTimeout(autoLockTimer);
    if (walletVault) showOnly('unlock'); else showOnly('onboarding');
    $('unlockForm').reset();
    if (notify) toast('지갑을 잠갔습니다.');
  }

  function resetAutoLock() {
    if (!privateKey) return;
    clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(() => lockWallet(true), AUTO_LOCK_MS);
  }

  function balanceState(walletId) {
    return walletBalances.get(walletId) || { sl: '0', psl: '0', loading: true, error: false };
  }

  function renderWalletList() {
    renderBackupStatus();
    const container = $('walletList');
    container.replaceChildren();
    wallets.forEach((wallet) => {
      const balances = balanceState(wallet.id);
      const item = document.createElement('article');
      item.className = `wallet-list-item${wallet.id === activeWalletId ? ' active' : ''}`;
      item.dataset.walletId = wallet.id;
      const details = document.createElement('div');
      details.className = 'wallet-select';
      details.innerHTML = '<span class="wallet-avatar"></span><span class="wallet-meta"><strong></strong><span class="wallet-address"><code></code><button type="button">복사</button></span></span><span class="wallet-balances"><strong></strong><small></small></span>';
      details.querySelector('.wallet-avatar').textContent = wallet.name.slice(0, 1).toUpperCase();
      details.querySelector('.wallet-meta strong').textContent = wallet.name;
      details.querySelector('code').textContent = shortenAddress(wallet.id);
      details.querySelector('.wallet-address button').onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        copy(wallet.id);
      };
      details.querySelector('.wallet-balances strong').textContent = balances.loading ? '조회 중' : `${formatPslBalance(balances.psl)} ${token.symbol}`;
      details.querySelector('.wallet-balances small').textContent = balances.loading ? '—' : `${formatCompactUnits(balances.sl, 18, 9)} SL`;
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'wallet-choose-button';
      selectButton.textContent = wallets.length === 1 || wallet.backupVerified ? '선택' : '기기에 개인키 백업 후 사용가능';
      selectButton.disabled = !wallet.backupVerified || wallet.id === activeWalletId;
      selectButton.onclick = async () => { await switchWallet(wallet.id, false); $('walletManagerDialog').close(); };
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'wallet-delete-button';
      deleteButton.textContent = '삭제';
      deleteButton.onclick = () => removeWallet(wallet.id);
      const row = document.createElement('div');
      row.className = 'wallet-select-row';
      row.append(details, selectButton, deleteButton);
      const actions = document.createElement('div');
      actions.className = 'wallet-item-actions single-action';
      [['이름 변경', '', '']].forEach(([label, panel, asset]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.className = !panel ? 'rename-action' : `${asset.toLowerCase()}-${panel === 'sendPanel' ? 'send' : 'receive'}-action`;
        button.onclick = async () => {
          if (!panel) return renameWallet(wallet.id);
          await switchWallet(wallet.id, false);
          openPanel(panel, asset);
        };
        actions.append(button);
      });
      item.append(row, actions);
      container.append(item);
    });
    $('walletCount').textContent = String(wallets.length);
  }

  async function removeWallet(walletId) {
    const wallet = wallets.find((item) => item.id === walletId);
    if (!wallet) return;
    if (wallets.length === 1) return toast('마지막 지갑은 여기서 삭제할 수 없습니다. 설정의 “이 기기에서 지갑 삭제”를 이용해 주세요.');
    if (!await confirmDanger(`${wallet.name} 지갑을 삭제할까요?`, '백업하지 않은 개인키는 복구할 수 없습니다.')) return;
    const previousWallets = wallets.slice();
    const previousActiveWalletId = activeWalletId;
    wallets = wallets.filter((item) => item.id !== walletId);
    walletBalances.delete(walletId);
    if (walletId === activeWalletId) {
      activeWalletId = wallets[0].id;
      privateKey = wallets[0].privateKey;
    }
    try {
      await persistWallets();
      showWallet();
      toast(`${wallet.name} 지갑을 삭제했습니다.`);
    } catch (error) {
      wallets = previousWallets;
      activeWalletId = previousActiveWalletId;
      privateKey = activeWallet()?.privateKey || '';
      renderWalletList();
      toast(error.message);
    }
  }

  function syncDialogScrollLock() {
    const hasOpenDialog = Boolean(document.querySelector('dialog[open]'));
    if (hasOpenDialog && !document.body.classList.contains('dialog-open')) {
      dialogScrollY = window.scrollY;
      document.body.style.top = `-${dialogScrollY}px`;
      document.body.classList.add('dialog-open');
    } else if (!hasOpenDialog && document.body.classList.contains('dialog-open')) {
      document.body.classList.remove('dialog-open');
      document.body.style.top = '';
      window.scrollTo(0, dialogScrollY);
    }
  }

  async function switchWallet(walletId, scroll = true) {
    const wallet = wallets.find((item) => item.id === walletId);
    if (!wallet || !wallet.backupVerified) return;
    activeWalletId = wallet.id;
    privateKey = wallet.privateKey;
    $('activeWalletName').textContent = wallet.name;
    $('accountAddress').textContent = shortenAddress(address());
    $('receiveAddress').textContent = address();
    const balances = balanceState(wallet.id);
    updateActiveBalances(balances);
    renderWalletList();
    try { await persistWallets(); } catch { /* selection remains valid for this session */ }
    refreshHistory(1);

    if (scroll) $('wallet').scrollIntoView({ behavior: 'smooth', block: 'start' });
    resetAutoLock();
  }

  function updateActiveBalances(balances) {
    rawSlBalance = balances.sl;
    rawBalance = balances.psl;
    const slDisplay = balances.error ? '연결 오류' : formatCompactUnits(balances.sl, 18, 9);
    $('slHeroBalance').textContent = slDisplay;
    $('slHeroBalance').classList.toggle('long-balance', slDisplay.length > 12);
    $('slHeroBalance').title = `${formatDisplayUnits(balances.sl, 18)} SL`;
    const pslDisplay = balances.error ? '—' : formatCompactUnits(balances.psl, token.decimal, 0);
    $('pslHeroBalance').textContent = pslDisplay;
    $('pslHeroBalance').classList.toggle('long-balance', pslDisplay.length > 12);
    $('pslHeroBalance').title = `${formatDisplayUnits(balances.psl, token.decimal)} ${token.symbol}`;
    $('pslHeroSymbol').textContent = token.symbol;
  }

  async function fetchWalletBalance(wallet) {
    const walletAddressValue = walletAddress(wallet);
    const slRequest = SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ type: 'GetBalance', address: walletAddressValue }, wallet.privateKey));
    const pslRequest = (async () => {
      const cid = contractId();
      return Promise.all([
        SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ cid, type: 'GetInfo' }, wallet.privateKey)),
        SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ cid, type: 'GetBalance', address: walletAddressValue }, wallet.privateKey))
      ]);
    })();
    const [slState, pslState] = await Promise.allSettled([slRequest, pslRequest]);
    let sl = '0';
    let psl = '0';
    let online = false;
    if (slState.status === 'fulfilled' && slState.value.code === 200) {
      try {
        sl = normalizeBalance(slState.value.data.balance, 18);
        online = true;
      } catch { /* keep PSL and history available if SL formatting is unexpected */ }
    }
    if (pslState.status === 'fulfilled') {
      const [infoResult, balanceResult] = pslState.value;
      if (infoResult.code === 200 && balanceResult.code === 200) {
        token = { symbol: infoResult.data.symbol || 'PSL', decimal: Number(infoResult.data.decimal || 0) };
        try {
          psl = parseTokenUnits(balanceResult.data.balance, token.decimal);
          online = true;
        } catch { /* keep SL and history available if token formatting is unexpected */ }
      }
    }
    walletBalances.set(wallet.id, { sl, psl, loading: false, error: !online });
    return online;
  }

  async function refresh() {
    if (!privateKey || isRefreshing) return;
    isRefreshing = true;
    $('connectionState').className = 'connection';
    $('connectionState').innerHTML = '<i></i> 연결 확인 중';
    wallets.forEach((wallet) => walletBalances.set(wallet.id, { ...balanceState(wallet.id), loading: true }));
    renderWalletList();
    let results = [];
    try {
      results = await Promise.all(wallets.map(async (wallet) => {
        try { return await fetchWalletBalance(wallet); }
        catch {
          walletBalances.set(wallet.id, { sl: '0', psl: '0', loading: false, error: true });
          return false;
        }
      }));
    } finally {
      const balances = balanceState(activeWalletId);
      updateActiveBalances(balances);
      renderWalletList();
      const online = results.some(Boolean);
      $('networkBadge').textContent = config.endpoint.toLowerCase().includes('test') ? 'TESTNET' : 'MAINNET';
      $('connectionState').className = `connection ${online ? 'online' : 'offline'}`;
      $('connectionState').innerHTML = `<i></i> ${online ? '온라인' : '연결 안 됨'}`;
      isRefreshing = false;
      refreshHistory(1);
    }
  }

  function transactionEndpoints() {
    const configured = new URL('/transaction', config.endpoint).href;
    if (config.endpoint.toLowerCase().includes('test')) return [configured];
    if (new URL(config.endpoint).hostname === 'main.saseul.net') {
      return ['https://sub.saseul.net/transaction', 'https://blanc.saseul.net/transaction', 'https://chardonnay.saseul.net/transaction'];
    }
    return [configured, 'https://sub.saseul.net/transaction', 'https://blanc.saseul.net/transaction'];
  }

  async function requestHistory(body) {
    const requests = transactionEndpoints().map(async (endpoint) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(endpoint, { method: 'POST', body: new URLSearchParams(body), signal: controller.signal });
        if (response.status === 204 || response.status === 404) return {};
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.code === 200) return result.data ?? {};
        if (result.code === 204 || result.code === 404) return {};
        throw new Error(rpcError(result));
      } finally { clearTimeout(timeout); }
    });
    try { return await Promise.any(requests); }
    catch (error) { throw error?.errors?.[0] || error || new Error('거래 조회 노드에 연결할 수 없습니다.'); }
  }

  function historyEntries(data) {
    return Array.isArray(data) ? data.map((entry) => [entry.hash || '', entry]) : Object.entries(data || {});
  }

  async function waitForExplorerTransaction(expectedHash, walletAddress, attempts = 10) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const requestKey = generatePrivateKey();
      const timestamp = SASEUL.Util.utime();
      const body = new URLSearchParams({
        data: 'fullList', type: 'Send', address: walletAddress, page: '0', count: '20',
        timestamp: String(timestamp), public_key: SASEUL.Sign.publicKey(requestKey), signature: SASEUL.Sign.signature(timestamp, requestKey)
      });
      try {
        const entries = historyEntries(await requestHistory(body));
        if (entries.some(([hash, entry]) => historyTransaction(entry, hash)?.hash === expectedHash)) return true;
      } catch { /* retry another explorer index endpoint */ }
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return false;
  }

  function pendingTransfers() {
    try {
      return JSON.parse(localStorage.getItem(PENDING_TRANSFERS_KEY) || '[]')
        .filter((item) => item?.hash);
    } catch { return []; }
  }

  function savePendingTransfers(items) {
    localStorage.setItem(PENDING_TRANSFERS_KEY, JSON.stringify(items));
  }

  function pendingTransferKey(walletAddress, asset, cid, to, amount) {
    return [walletAddress, asset, cid || '', to, amount].join(':');
  }

  function rememberPendingTransfer(item) {
    const items = pendingTransfers().filter(({ hash }) => hash !== item.hash);
    items.push(item);
    savePendingTransfers(items);
  }

  function forgetPendingTransfer(hash) {
    savePendingTransfers(pendingTransfers().filter((item) => item.hash !== hash));
  }

  function updatePendingTransfer(hash, changes) {
    savePendingTransfers(pendingTransfers().map((item) => item.hash === hash ? { ...item, ...changes } : item));
  }

  function transactionTimestampExpired(error) {
    return /timestamp must be greater than \d+ and less than \d+/i.test(rpcError(error));
  }

  function prepareReplacementTransfer(item) {
    forgetPendingTransfer(item.hash);
    openPanel('sendPanel', item.asset === 'SL' ? 'SL' : 'PSL');
    $('toAddress').value = item.to || '';
    $('amount').value = formatAmountInput(item.displayAmount || '') || '';
    $('amount').dataset.previousValue = $('amount').value;
    toast('만료된 거래는 다시 체결되지 않습니다. 내용을 확인한 뒤 새 거래를 전송하세요.');
    refreshHistory(1);
  }

  async function rebroadcastPendingTransfer(item, button) {
    if (!activeWallet()?.backupVerified) return openDeviceBackup();
    if (!item?.signed?.transaction || SASEUL.Enc.txHash(item.signed.transaction) !== item.hash) {
      forgetPendingTransfer(item?.hash);
      await showAlert('저장된 거래 정보가 올바르지 않아 다시 전파할 수 없습니다.', '거래 확인');
      refreshHistory(1);
      return;
    }
    button.disabled = true;
    button.textContent = '다시 전파 중…';
    showTransferStatus('processing', `기존 거래를 동일한 해시로 다시 전파하고 있습니다. 거래 해시: ${item.hash}`);
    try {
      await submitTransaction(item.signed);
      const confirmed = await waitForExplorerTransaction(item.hash, item.walletAddress, 3);
      if (confirmed) {
        forgetPendingTransfer(item.hash);
        showTransferStatus('success', `기존 거래가 확인되었습니다. 거래 해시: ${item.hash}`);
        refresh();
      } else {
        showTransferStatus('pending', `기존 거래를 다시 전파했지만 아직 확인 중입니다. 새 거래는 생성되지 않았습니다. 거래 해시: ${item.hash}`);
        refreshHistory(1);
      }
    } catch (error) {
      if (transactionTimestampExpired(error)) {
        updatePendingTransfer(item.hash, { status: 'expired', expiredAt: Date.now() });
        showTransferStatus('expired', `기존 거래의 유효 시간이 지나 노드가 거절했습니다. 이 해시는 더 이상 다시 전파하거나 체결할 수 없습니다. 거래 해시: ${item.hash}`);
        refreshHistory(1);
      } else {
        showTransferStatus('pending', `${rpcError(error)} 기존 해시는 보존되며 새 거래는 생성되지 않았습니다. 거래 해시: ${item.hash}`);
      }
    } finally {
      button.disabled = false;
      button.textContent = '동일 해시 다시 전파';
    }
  }

  function renderPendingTransfer(container, item) {
    const row = document.createElement('article');
    const expired = item.status === 'expired';
    row.className = `history-row sent pending-transfer${expired ? ' expired' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'history-icon';
    icon.textContent = expired ? '!' : '…';
    const details = document.createElement('div');
    details.className = 'history-details';
    const title = document.createElement('strong');
    title.textContent = `${item.symbol || item.asset} ${expired ? '전송 만료됨' : '전송 확인 중'}`;
    const addressText = document.createElement('small');
    addressText.className = 'history-counterparty';
    addressText.textContent = `받는 주소: ${item.to}`;
    details.append(title, addressText);
    const value = document.createElement('div');
    value.className = 'history-value';
    const amount = document.createElement('strong');
    amount.textContent = `-${item.displayAmount} ${item.symbol || item.asset}`;
    const time = document.createElement('small');
    time.textContent = expired ? '유효시간 만료 · 체결 불가' : '네트워크 확인 대기 중';
    value.append(amount, time);
    const actions = document.createElement('div');
    actions.className = 'pending-transfer-actions';
    const explorer = document.createElement('a');
    explorer.className = 'history-hash';
    explorer.href = `https://explorer.saseul.com/?ic=tx&h=${encodeURIComponent(item.hash)}&ia=detail`;
    explorer.target = '_blank';
    explorer.rel = 'noopener noreferrer';
    explorer.textContent = `${item.hash.slice(0, 10)}…${item.hash.slice(-8)} ↗`;
    const rebroadcast = document.createElement('button');
    rebroadcast.type = 'button';
    rebroadcast.className = 'pending-rebroadcast';
    rebroadcast.textContent = expired ? '새 거래 작성' : '동일 해시 다시 전파';
    rebroadcast.onclick = () => expired ? prepareReplacementTransfer(item) : rebroadcastPendingTransfer(item, rebroadcast);
    actions.append(explorer, rebroadcast);
    row.append(icon, details, value, actions);
    container.append(row);
  }

  function showTransferStatus(status, message) {
    const dialog = $('transferSuccessDialog');
    const states = {
      pending: { mark: '…', title: '전송 확인 중', eyebrow: 'TRANSFER PENDING' },
      expired: { mark: '!', title: '전송 만료됨', eyebrow: 'TRANSFER EXPIRED' },
      processing: { mark: '…', title: '보내기(처리중...)', eyebrow: 'CHECKING TRANSACTION' },
      success: { mark: '✓', title: '보내기(성공)', eyebrow: 'TRANSFER COMPLETE' },
      failed: { mark: '!', title: '보내기(실패)', eyebrow: 'TRANSFER FAILED' }
    };
    const state = states[status];
    dialog.classList.remove('pending', 'expired', 'processing', 'success', 'failed');
    dialog.classList.add(status);
    $('transferSuccessMark').textContent = state.mark;
    $('transferSuccessTitle').textContent = state.title;
    $('transferSuccessEyebrow').textContent = state.eyebrow;
    $('transferSuccessMessage').textContent = message;
    $('transferSuccessClose').disabled = status === 'processing';
    if (!dialog.open) dialog.showModal();
  }

  function historyTransaction(entry, fallbackHash = '') {
    let value = entry;
    if (typeof entry?.data === 'string') {
      try { value = { ...entry, ...JSON.parse(entry.data) }; } catch { value = entry; }
    }
    const transaction = value?.transaction || value;
    if (!transaction || transaction.type !== 'Send') return null;
    const hash = value.hash || value.tx_hash || value.transaction_hash || fallbackHash || SASEUL.Enc.txHash(transaction);
    const signed = value?.transaction ? {
      transaction,
      ...(value.public_key ? { public_key: value.public_key } : {}),
      ...(value.signature ? { signature: value.signature } : {})
    } : { transaction };
    const recordedFee = value.fee ?? value.transaction_fee ?? value.network_fee ?? null;
    return { hash, transaction, signed, recordedFee };
  }

  function renderHistory(entries, page, hasNext = false) {
    const container = $('historyList');
    container.replaceChildren();
    const currentAddress = address();
    let pslCid = '';
    try { pslCid = contractId(); } catch { /* PSL history stays unavailable until configured */ }
    const transactions = entries.map(([hash, entry]) => historyTransaction(entry, hash)).filter(Boolean).filter(({ transaction }) => {
      const involvesWallet = transaction.from === currentAddress || transaction.to === currentAddress;
      const supportedAsset = !transaction.cid || transaction.cid === SL_SYSTEM_CID || (pslCid && transaction.cid === pslCid);
      return involvesWallet && supportedAsset;
    }).slice(0, 10);
    const confirmedHashes = new Set(transactions.map(({ hash }) => hash));
    const allPending = pendingTransfers();
    const confirmedPending = allPending.filter(({ hash }) => confirmedHashes.has(hash));
    confirmedPending.forEach(({ hash }) => forgetPendingTransfer(hash));
    const pending = page === 1
      ? allPending.filter((item) => item.walletAddress === currentAddress && !confirmedHashes.has(item.hash))
      : [];
    pending.forEach((item) => renderPendingTransfer(container, item));
    if (!transactions.length && !pending.length) {
      $('historyStatus').textContent = '표시할 SL · PSL 송수신 이력이 없습니다.';
    } else {
      $('historyStatus').textContent = '';
      transactions.forEach(({ hash, transaction, signed, recordedFee }) => {
        const sent = transaction.from === currentAddress;
        const isPsl = Boolean(transaction.cid && transaction.cid !== SL_SYSTEM_CID);
        const symbol = isPsl ? token.symbol : 'SL';
        const decimals = isPsl ? token.decimal : 18;
        const counterparty = sent ? transaction.to : transaction.from;
        const row = document.createElement('article');
        row.className = `history-row ${sent ? 'sent' : 'received'}`;
        const icon = document.createElement('span');
        icon.className = 'history-icon';
        const tokenIcon = document.createElement('img');
        tokenIcon.src = `images/${isPsl ? 'psl-token-icon.svg' : 'sl-token-icon.png'}`;
        tokenIcon.alt = `${symbol} 아이콘`;
        icon.append(tokenIcon);
        const details = document.createElement('div');
        details.className = 'history-details';
        const title = document.createElement('strong');
        title.textContent = `${symbol} ${sent ? '보냄 ↗' : '받음 ↙'}`;
        const addressText = document.createElement('small');
        addressText.className = 'history-counterparty';
        addressText.textContent = counterparty
          ? `${sent ? '받는 주소' : '보낸 주소'}: ${counterparty}`
          : `${sent ? '받는 주소' : '보낸 주소'}: 알 수 없음`;
        if (counterparty) addressText.title = counterparty;
        details.append(title, addressText);
        const value = document.createElement('div');
        value.className = 'history-value';
        const amount = document.createElement('strong');
        try {
          const historyAmount = isPsl
            ? parseTokenUnits(transaction.amount, decimals)
            : normalizeBalance(transaction.amount, decimals);
          amount.textContent = `${sent ? '-' : '+'}${formatDisplayUnits(historyAmount, decimals)} ${symbol}`;
        } catch { amount.textContent = `${sent ? '-' : '+'}${transaction.amount || '0'} ${symbol}`; }
        const time = document.createElement('small');
        const timestamp = Number(transaction.timestamp || 0);
        time.dataset.timestamp = timestamp ? String(timestamp / 1000) : '';
        time.textContent = timestamp ? new Intl.DateTimeFormat(WalletI18n.language === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp / 1000)) : '';
        const feeText = document.createElement('small');
        feeText.className = 'history-fee';
        feeText.textContent = '수수료 계산 중…';
        value.append(amount, feeText, time);
        const applyFee = (fee) => { feeText.textContent = `수수료 ${formatSlFee(fee)}`; };
        if (recordedFee !== null && /^\d+$/.test(String(recordedFee))) applyFee(String(recordedFee));
        else estimateTransactionFee(signed).then(applyFee).catch(() => { feeText.textContent = '수수료 확인 불가'; });
        const explorer = document.createElement('a');
        explorer.className = 'history-hash';
        explorer.href = `https://explorer.saseul.com/?ic=tx&h=${encodeURIComponent(hash)}&ia=detail`;
        explorer.target = '_blank';
        explorer.rel = 'noopener noreferrer';
        explorer.textContent = `${hash.slice(0, 10)}…${hash.slice(-8)} ↗`;
        row.append(icon, details, value, explorer);
        container.append(row);
      });
    }
    historyPage = page;
    $('historyPage').textContent = String(page);
    $('historyPageBadge').textContent = String(page);
    $('historyPrev').disabled = page <= 1;
    $('historyNext').disabled = !hasNext;
    $('historyPagination').classList.toggle('hidden', page === 1 && !hasNext);
  }

  async function refreshHistory(page = historyPage) {
    if (!privateKey) return;
    const requestId = ++historyRequestId;
    historyLoading = true;
    $('historyStatus').textContent = '거래 이력을 불러오는 중입니다.';
    $('historyPrev').disabled = true;
    $('historyNext').disabled = true;
    try {
      const requestKey = SASEUL.Sign.privateKey();
      const timestamp = SASEUL.Util.utime();
      const body = new URLSearchParams({
        data: 'fullList', type: 'Send', address: address(), page: String(page - 1), count: '10',
        timestamp: String(timestamp), public_key: SASEUL.Sign.publicKey(requestKey), signature: SASEUL.Sign.signature(timestamp, requestKey)
      });
      const data = await requestHistory(body);
      if (requestId !== historyRequestId) return;
      const entries = historyEntries(data);
      let hasNext = false;
      if (entries.length >= 10) {
        try {
          const nextBody = new URLSearchParams(body);
          nextBody.set('page', String(page));
          const nextData = await requestHistory(nextBody);
          if (requestId !== historyRequestId) return;
          hasNext = (Array.isArray(nextData) ? nextData.length : Object.keys(nextData || {}).length) > 0;
        } catch { /* keep the current page visible when look-ahead fails */ }
      }
      renderHistory(entries, page, hasNext);
    } catch {
      if (requestId !== historyRequestId) return;
      $('historyStatus').textContent = '거래 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      $('historyPrev').disabled = page <= 1;
      $('historyNext').disabled = true;
    } finally { if (requestId === historyRequestId) historyLoading = false; }
  }

  function resetPullIndicator(delay = 0) {
    setTimeout(() => {
      pullStart = null;
      pullDistance = 0;
      $('pullRefresh').className = 'pull-refresh hidden';
      $('pullRefresh').style.removeProperty('transform');
      $('pullRefresh').setAttribute('aria-hidden', 'true');
      $('pullRefreshLabel').textContent = '아래로 당겨 새로고침';
    }, delay);
  }

  function canStartPull(event) {
    return Boolean(
      privateKey
      && !isRefreshing
      && window.scrollY <= 0
      && !document.querySelector('dialog[open]')
      && !event.target.closest('input, textarea, select, [contenteditable="true"]')
    );
  }

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1 || !canStartPull(event)) return;
    pullStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    pullDistance = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (!pullStart || event.touches.length !== 1) return;
    const deltaX = event.touches[0].clientX - pullStart.x;
    const deltaY = event.touches[0].clientY - pullStart.y;
    if (deltaY <= 0 || Math.abs(deltaX) > deltaY) {
      resetPullIndicator();
      return;
    }
    event.preventDefault();
    pullDistance = Math.min(deltaY * 0.55, 96);
    if (pullDistance > 8) suppressLockClickUntil = Date.now() + 700;
    $('pullRefresh').classList.remove('hidden');
    $('pullRefresh').classList.add('visible');
    $('pullRefresh').style.transform = `translate(-50%, ${Math.min(0, -70 + pullDistance)}px)`;
    $('pullRefresh').setAttribute('aria-hidden', 'false');
    const ready = pullDistance >= PULL_THRESHOLD;
    $('pullRefresh').classList.toggle('ready', ready);
    $('pullRefreshLabel').textContent = ready ? '놓아서 잔액 새로고침' : '아래로 당겨 새로고침';
  }, { passive: false });

  document.addEventListener('touchend', async () => {
    if (!pullStart) return;
    const shouldRefresh = pullDistance >= PULL_THRESHOLD;
    pullStart = null;
    if (!shouldRefresh) {
      resetPullIndicator();
      return;
    }
    $('pullRefresh').className = 'pull-refresh visible refreshing';
    $('pullRefreshLabel').textContent = 'SL · PSL 잔액 갱신 중';
    await refresh();
    $('pullRefreshLabel').textContent = '잔액을 새로고침했습니다';
    resetPullIndicator(650);
  }, { passive: true });

  document.addEventListener('touchcancel', () => resetPullIndicator(), { passive: true });

  async function saveWallet(key, password, name = '') {
    if (!SASEUL.Sign.keyValidity(key)) throw new Error('개인키는 64자리 16진수여야 합니다.');
    const wallet = makeWallet(key, name || '지갑 1');
    wallets = [wallet];
    activeWalletId = wallet.id;
    vaultPassword = password;
    await persistWallets();
    localStorage.removeItem(LEGACY_KEY);
    privateKey = wallet.privateKey;
    showWallet();
  }

  function selectAsset(asset) {
    selectedAsset = asset;
    const symbol = asset === 'SL' ? 'SL' : token.symbol;
    $('sendTitle').textContent = `${symbol} 보내기`;
    $('receiveTitle').textContent = `${symbol} 받기`;
    $('amountSymbol').textContent = symbol;
    $('receiveHelp').textContent = `${symbol}을 받을 수 있는 SASEUL 주소입니다.`;
    $('sendForm').reset();
    $('sendError').textContent = '';
  }

  function openPanel(id, asset) {
    if (!activeWallet()?.backupVerified) return openDeviceBackup();
    selectAsset(asset);
    if (id === 'receivePanel') renderReceiveQr();
    $(id).showModal();
  }

  function renderReceiveQr() {
    const container = $('receiveQr');
    container.replaceChildren();
    if (!address() || typeof QRCode === 'undefined') {
      container.textContent = 'QR 코드를 생성할 수 없습니다.';
      return;
    }
    new QRCode(container, {
      text: address(),
      width: 176,
      height: 176,
      colorDark: '#10131a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('주소를 복사했습니다.'); }
    catch { toast('복사할 수 없습니다. 주소를 길게 눌러 복사해 주세요.'); }
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function updateInstallDialog() {
    const ios = isIos();
    $('iosInstallHelp').classList.toggle('hidden', !ios);
    if (ios) {
      $('installDescription').textContent = 'Safari에서 홈 화면 아이콘을 만들어 앱처럼 사용할 수 있습니다.';
      $('installBtn').textContent = '설치 방법 확인';
    } else if (deferredInstallPrompt) {
      $('installDescription').textContent = '홈 화면이나 바탕화면에서 앱처럼 빠르게 열 수 있습니다.';
      $('installBtn').textContent = '폰·바탕화면에 설치';
    } else {
      $('installDescription').textContent = '브라우저 메뉴에서 앱 설치 또는 바로가기 만들기를 선택할 수 있습니다.';
      $('installBtn').textContent = '설치 방법 확인';
    }
  }

  function showInstallDialog() {
    if (isStandalone() || localStorage.getItem(INSTALLED_KEY) || !deferredInstallPrompt || $('installDialog').open) return;
    updateInstallDialog();
    $('installDialog').showModal();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallDialog();
    setTimeout(showInstallDialog, 150);
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    localStorage.setItem(INSTALLED_KEY, 'true');
    if ($('installDialog').open) $('installDialog').close();
    toast('Wallet을 설치했습니다.');
  });

  $('installBtn').onclick = async () => {
    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        localStorage.setItem(INSTALLED_KEY, 'true');
        $('installDialog').close();
      }
      else updateInstallDialog();
      return;
    }
    if (isIos()) {
      $('iosInstallHelp').classList.remove('hidden');
      return;
    }
    toast('브라우저 메뉴의 “앱 설치” 또는 “바로가기 만들기”를 선택하세요.');
  };

  $('installLaterBtn').onclick = () => $('installDialog').close();

  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.passwordToggle);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.classList.toggle('is-visible', reveal);
      const fieldName = input.id === 'importKey' || input.id === 'additionalWalletKey' ? '개인키' : '비밀번호';
      button.setAttribute('aria-label', `${fieldName} ${reveal ? '숨기기' : '표시'}`);
      button.setAttribute('aria-pressed', String(reveal));
      input.focus({ preventScroll: true });
    });
  });

  $('createBtn').onclick = () => {
    $('createForm').reset();
    $('createDialog').showModal();
    $('createPassword').focus();
  };

  $('showImportBtn').onclick = () => {
    $('importForm').reset();
    $('importDialog').showModal();
    $('importName').focus();
  };

  $('importClose').onclick = () => $('importDialog').close();
  $('importDialog').addEventListener('close', () => $('importForm').reset());

  $('createDialog').addEventListener('close', () => $('createForm').reset());

  $('createForm').onsubmit = async (event) => {
    event.preventDefault();
    const password = $('createPassword').value;
    if (password !== $('createPasswordConfirm').value) return toast('비밀번호가 일치하지 않습니다.');
    if (password.length < 10) return toast('비밀번호를 10자 이상 입력해 주세요.');
    const button = event.submitter;
    try {
      setLoading(button, true, '안전하게 생성');
      await saveWallet(generatePrivateKey(), password);
      $('createDialog').close();
      toast('지갑을 만들었습니다. 지금 개인키를 백업하세요.');
    } catch (error) { toast(error.message); }
    finally { setLoading(button, false, '안전하게 생성'); }
  };

  $('importForm').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.submitter;
    try {
      setLoading(button, true, '암호화하여 가져오기');
      await saveWallet($('importKey').value.trim(), $('importPassword').value, $('importName').value.trim());
      $('importForm').reset();
      $('importDialog').close();
      toast('지갑을 안전하게 가져왔습니다.');
    } catch (error) { toast(error.message); }
    finally { setLoading(button, false, '암호화하여 가져오기'); }
  };

  $('unlockForm').onsubmit = async (event) => {
    event.preventDefault();
    $('unlockError').textContent = '';
    try {
      setLoading($('unlockBtn'), true, '잠금 해제');
      const password = $('unlockPassword').value;
      const data = await decryptVault(password);
      wallets = data.wallets.map((wallet, index) => makeWallet(wallet.privateKey, wallet.name || `지갑 ${index + 1}`, wallet.backupVerified));
      backupRecord = data.backupRecord || null;
      activeWalletId = wallets.some((wallet) => wallet.id === data.activeWalletId) ? data.activeWalletId : wallets[0].id;
      vaultPassword = password;
      privateKey = activeWallet().privateKey;
      await persistWallets();
      $('unlockForm').reset();
      showWallet();
    } catch {
      privateKey = '';
      $('unlockError').textContent = '비밀번호가 올바르지 않거나 지갑 데이터가 손상되었습니다.';
    } finally { setLoading($('unlockBtn'), false, '잠금 해제'); }
  };

  $('settingsBtn').onclick = () => {
    $('endpoint').value = config.endpoint;
    $('cid').value = config.cid;
    $('settingsDialog').showModal();
  };
  $('settingsClose').onclick = () => $('settingsDialog').close();
  $('uninstallGuideBtn').onclick = () => {
    $('settingsDialog').close();
    $('uninstallGuideDialog').showModal();
  };
  const closeUninstallGuide = () => {
    $('uninstallGuideDialog').close();
    setTimeout(() => $('settingsDialog').showModal(), 0);
  };
  $('uninstallGuideClose').onclick = closeUninstallGuide;
  $('uninstallGuideDialog').oncancel = (event) => { event.preventDefault(); closeUninstallGuide(); };
  $('uninstallGuideBackup').onclick = async () => {
    if (!privateKey) return toast('먼저 지갑 잠금을 해제해 주세요.');
    if (!await confirmPrivateKeyBackup()) return;
    showPrivateKeyBackup(privateKey);
    resetAutoLock();
  };
  $('editWalletsBtn').onclick = () => $('walletManagerDialog').showModal();
  $('walletManagerClose').onclick = () => $('walletManagerDialog').close();
  $('activePslSend').onclick = () => openPanel('sendPanel', 'PSL');
  $('activePslReceive').onclick = () => openPanel('receivePanel', 'PSL');
  $('activeSlSend').onclick = () => openPanel('sendPanel', 'SL');
  $('activeSlReceive').onclick = () => openPanel('receivePanel', 'SL');
  $('transferSuccessClose').onclick = () => $('transferSuccessDialog').close();
  $('transferSuccessDialog').oncancel = (event) => {
    if ($('transferSuccessClose').disabled) event.preventDefault();
  };
  $('historyPrev').onclick = () => refreshHistory(Math.max(1, historyPage - 1));
  $('historyNext').onclick = () => refreshHistory(historyPage + 1);
  $('openAddWalletBtn').onclick = () => {
    $('walletManagerDialog').close();
    $('addWalletDialog').showModal();
    $('additionalWalletName').focus();
  };
  const returnToWalletManager = (dialog) => {
    dialog.close();
    setTimeout(() => $('walletManagerDialog').showModal(), 0);
  };
  $('addWalletClose').onclick = () => returnToWalletManager($('addWalletDialog'));
  $('addWalletDialog').oncancel = (event) => { event.preventDefault(); returnToWalletManager($('addWalletDialog')); };
  async function renameWallet(walletId) {
    const wallet = wallets.find((item) => item.id === walletId);
    if (!wallet) return;
    const name = await requestTextInput('지갑 이름 변경', '새 지갑 이름', wallet.name);
    if (!name || name === wallet.name) return;
    if (name.length > 24) return toast('지갑 이름은 24자 이하로 입력해 주세요.');
    const previousName = wallet.name;
    wallet.name = name;
    try {
      await persistWallets();
      renderWalletList();
      toast('지갑 이름을 변경했습니다.');
    } catch (error) {
      wallet.name = previousName;
      toast(error.message);
    }
  }
  $('addWalletBtn').onclick = async () => {
    const key = $('additionalWalletKey').value.trim();
    if (!SASEUL.Sign.keyValidity(key)) return toast('개인키는 64자리 16진수여야 합니다.');
    const wallet = makeWallet(key, $('additionalWalletName').value.trim());
    if (wallets.some((item) => item.id === wallet.id)) return toast('이미 추가된 지갑입니다.');
    const previousWalletId = activeWalletId;
    try {
      setLoading($('addWalletBtn'), true, '암호화하여 추가');
      wallets.push(wallet);
      await persistWallets();
      $('additionalWalletName').value = '';
      $('additionalWalletKey').value = '';
      $('addWalletDialog').close();
      showWallet();
      $('walletManagerDialog').showModal();
      toast(`${wallet.name}을 추가했습니다.`);
    } catch (error) {
      wallets = wallets.filter((item) => item.id !== wallet.id);
      activeWalletId = previousWalletId;
      privateKey = activeWallet()?.privateKey || '';
      toast(error.message);
    } finally { setLoading($('addWalletBtn'), false, '암호화하여 추가'); }
  };
  $('lockBtn').onclick = () => {
    if (Date.now() < suppressLockClickUntil) return;
    lockWallet(true);
  };
  $('settingsForm').onsubmit = event => event.preventDefault();
  $('endpoint').onchange = () => {
    const next = { ...config, endpoint: $('endpoint').value.trim().replace(/\/$/, '') };
    if (!next.endpoint.startsWith('https://') && location.hostname !== 'localhost') return toast('배포 환경에서는 HTTPS RPC만 사용할 수 있습니다.');
    if (next.cid && !/^[0-9a-fA-F]{64}$/.test(next.cid)) return toast('CID는 64자리 16진수여야 합니다.');
    if (!next.cid && next.owner && !SASEUL.Sign.addressValidity(next.owner)) return toast('발행자 주소를 확인해 주세요.');
    config = next;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    applyConfig();
    toast('설정을 저장했습니다.');
    if (privateKey) refresh();
  };

  $('exportBtn').onclick = async () => {
    if (!privateKey) return toast('먼저 지갑 잠금을 해제해 주세요.');
    if (!await confirmPrivateKeyBackup()) return;
    showPrivateKeyBackup(privateKey);
    resetAutoLock();
  };

  $('privateKeyClose').onclick = closePrivateKeyBackup;
  $('privateKeyDialog').addEventListener('close', () => $('privateKeyList').replaceChildren());

  async function deleteWallet() {
    if (!walletVault) return;
    if (!await confirmDanger('이 기기에서 모든 지갑을 삭제할까요?', '백업하지 않은 지갑과 개인키는 복구할 수 없습니다.', true)) return;
    localStorage.removeItem(VAULT_KEY);
    localStorage.removeItem(LEGACY_KEY);
    try { await durableVault('delete'); } catch { /* local deletion still succeeds */ }
    walletVault = null;
    privateKey = '';
    vaultPassword = '';
    wallets = [];
    backupRecord = null;
    $('privateKeyList').replaceChildren();
    activeWalletId = '';
    walletBalances.clear();
    $('settingsDialog').close();
    $('uninstallGuideDialog').close();
    showOnly('onboarding');
    toast('이 기기에서 지갑을 삭제했습니다.');
  }


  $('uninstallGuideDelete').onclick = async () => {
    await deleteWallet();
  };
  $('createAdditionalWalletBtn').onclick = async () => {
    $('walletManagerDialog').close();
    $('createWalletName').value = '';
    $('createWalletConfirmDialog').showModal();
    setTimeout(() => $('createWalletName').focus(), 0);
  };
  const cancelWalletCreation = () => returnToWalletManager($('createWalletConfirmDialog'));
  $('createWalletConfirmCancel').onclick = cancelWalletCreation;
  $('createWalletConfirmDialog').oncancel = (event) => { event.preventDefault(); cancelWalletCreation(); };
  $('createWalletConfirmAccept').onclick = async () => {
    let wallet = null;
    const previousWalletId = activeWalletId;
    try {
      setLoading($('createWalletConfirmAccept'), true, '생성');
      wallet = makeWallet(generatePrivateKey(), $('createWalletName').value.trim());
      wallets.push(wallet);
      await persistWallets();
      $('createWalletConfirmDialog').close();
      showWallet();
      $('walletManagerDialog').showModal();
      toast(`${wallet.name}을 생성했습니다. 개인키를 꼭 백업하세요.`);
    } catch (error) {
      if (wallet) wallets = wallets.filter((item) => item.id !== wallet.id);
      activeWalletId = previousWalletId;
      privateKey = activeWallet()?.privateKey || '';
      toast(error.message);
    } finally { setLoading($('createWalletConfirmAccept'), false, '생성'); }
  };
  $('resetBtn').onclick = deleteWallet;
  document.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => button.closest('dialog').close(); });
  new MutationObserver(syncDialogScrollLock).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });
  $('copyAddress').onclick = () => copy(address());
  $('copyAccount').onclick = () => copy(address());
  $('maxBtn').onclick = async () => {
    if (selectedAsset !== 'SL') {
      $('amount').value = formatAmountInput(formatUnits(rawBalance, token.decimal).split('.')[0]);
      return;
    }
    const button = $('maxBtn');
    button.disabled = true;
    try {
      const enteredAddress = $('toAddress').value.trim();
      const to = SASEUL.Sign.addressValidity(enteredAddress) ? enteredAddress : SASEUL.Enc.ZERO_ADDRESS;
      let maximum = BigInt(rawSlBalance);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const signed = SASEUL.Rpc.signedTransaction({ type: 'Send', to, amount: maximum.toString() }, privateKey);
        const fee = BigInt(await estimateTransactionFee(signed));
        const nextMaximum = BigInt(rawSlBalance) > fee ? BigInt(rawSlBalance) - fee : 0n;
        if (nextMaximum === maximum) break;
        maximum = nextMaximum;
      }
      $('amount').value = formatAmountInput(formatUnits(maximum.toString(), 18));
      $('amount').dataset.previousValue = $('amount').value;
      if (maximum === 0n) toast('수수료를 제외한 전송 가능 SL이 없습니다.');
    } catch { toast('SL 최대 전송 금액을 계산하지 못했습니다.'); }
    finally { button.disabled = false; }
  };
  $('amount').addEventListener('input', (event) => {
    const formatted = formatAmountInput(event.target.value);
    if (formatted === null) event.target.value = event.target.dataset.previousValue || '';
    else {
      event.target.value = formatted;
      event.target.dataset.previousValue = formatted;
    }
  });

  $('sendForm').onsubmit = async (event) => {
    event.preventDefault();
    if (!activeWallet()?.backupVerified) return openDeviceBackup();
    if (transferInFlight) return;
    $('sendError').textContent = '';
    const to = $('toAddress').value.trim();
    if (selectedAsset !== 'SL' && isInvalidPslTransferAmount($('amount').value)) {
      await showAlert('PSL은 소수점 이하 단위로 전송할 수 없습니다. 최소 송금 가능 금액은 1 PSL입니다.', 'PSL 송금 수량 확인');
      return;
    }
    transferInFlight = true;
    try {
      if (!SASEUL.Sign.addressValidity(to)) throw new Error('받는 주소가 올바르지 않습니다.');
      if (to === address()) throw new Error('내 주소로는 전송할 수 없습니다.');
      const transactionCid = selectedAsset === 'SL' ? '' : await validatePslTransfer();
      const decimals = selectedAsset === 'SL' ? 18 : token.decimal;
      const symbol = selectedAsset === 'SL' ? 'SL' : token.symbol;
      const available = selectedAsset === 'SL' ? rawSlBalance : rawBalance;
      const amount = parseUnits($('amount').value, decimals);
      if (BigInt(amount) <= 0n) throw new Error('0보다 큰 수량을 입력해 주세요.');
      if (BigInt(amount) > BigInt(available)) throw new Error('보유 수량이 부족합니다.');
      const displayAmount = formatDisplayUnits(amount, decimals);
      const transactionAmount = selectedAsset === 'SL' ? amount : formatUnits(amount, decimals);
      const transaction = { type: 'Send', to, amount: transactionAmount };
      if (transactionCid) transaction.cid = transactionCid;
      const transferKey = pendingTransferKey(address(), selectedAsset, transactionCid, to, transactionAmount);
      const existingPending = pendingTransfers().find((item) => item.key === transferKey);
      if (existingPending) {
        const confirmed = await waitForExplorerTransaction(existingPending.hash, address(), 1);
        if (confirmed) {
          forgetPendingTransfer(existingPending.hash);
          showTransferStatus('success', `이미 접수된 동일 전송이 확인되었습니다. 거래 해시: ${existingPending.hash}`);
          refresh();
        } else {
          showTransferStatus('pending', `동일한 전송이 이미 네트워크에 접수되어 확인 중입니다. 중복 전송을 막기 위해 다시 보내지 않았습니다. 거래 해시: ${existingPending.hash}`);
        }
        return;
      }
      const signed = SASEUL.Rpc.signedTransaction(transaction, privateKey);
      const fee = await estimateTransactionFee(signed);
      if (selectedAsset === 'SL' && BigInt(amount) + BigInt(fee) > BigInt(rawSlBalance)) throw new Error('SL 수량과 네트워크 수수료를 합한 금액이 잔액을 초과합니다.');
      if (selectedAsset !== 'SL' && BigInt(fee) > BigInt(rawSlBalance)) throw new Error(`PSL 전송 수수료 ${formatSlFee(fee)}를 낼 SL 잔액이 부족합니다.`);
      if (!await confirmTransfer(displayAmount, symbol, to, fee)) return;
      setLoading($('sendBtn'), true, '검토 후 전송');
      $('sendPanel').close();
      showTransferStatus('processing', `${displayAmount} ${symbol} 전송 요청을 처리하고 익스플로러에서 거래 해시를 확인하고 있습니다.`);
      const expectedHash = SASEUL.Enc.txHash(signed.transaction);
      rememberPendingTransfer({
        key: transferKey, hash: expectedHash, createdAt: Date.now(), signed,
        walletAddress: address(), asset: selectedAsset, symbol, to, displayAmount
      });
      try {
        const result = await submitTransaction(signed);
        if (!transactionAccepted(result)) throw new Error(rpcError(result));
        const confirmed = await waitForExplorerTransaction(expectedHash, address());
        if (!confirmed) {
          showTransferStatus('pending', `네트워크가 전송을 접수했지만 탐색기 반영을 기다리고 있습니다. 중복 전송하지 마세요. 거래 해시: ${expectedHash}`);
          refreshHistory(1);
          return;
        }
        forgetPendingTransfer(expectedHash);
        $('sendForm').reset();
        showTransferStatus('success', `${displayAmount} ${symbol} 전송이 확인되었습니다. 거래 해시: ${expectedHash}`);
        refresh();
      } catch (error) {
        if (transactionTimestampExpired(error)) {
          updatePendingTransfer(expectedHash, { status: 'expired', expiredAt: Date.now() });
          showTransferStatus('expired', `거래 유효 시간이 지나 노드가 거절했습니다. 이 거래는 체결되지 않으며 이력에서 새 거래를 작성할 수 있습니다. 거래 해시: ${expectedHash}`);
          refreshHistory(1);
        } else {
          showTransferStatus('failed', `${rpcError(error)} 중복 전송을 피하려면 이력 또는 익스플로러를 먼저 확인해 주세요.`);
          refreshHistory(1);
        }
      }
    } catch (error) { $('sendError').textContent = rpcError(error); }
    finally { transferInFlight = false; setLoading($('sendBtn'), false, '검토 후 전송'); resetAutoLock(); }
  };

  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => document.addEventListener(eventName, resetAutoLock, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && privateKey) resetAutoLock(); });
  window.addEventListener('offline', () => { $('connectionState').className = 'connection offline'; $('connectionState').innerHTML = '<i></i> 오프라인'; });

  let backupRecord = null;
  let backupVerificationId = null;
  let backupBusy = false;
  let backupWizardStep = 0;

  function makeBackupRecord(saved, fileName) {
    return { wallets: saved.map(({ name, privateKey }) => ({ name, privateKey })), fileName };
  }

  function backupStatus() {
    if (!backupRecord) return 'missing';
    return WalletBackup.matches(wallets, backupRecord.wallets) ? 'good' : 'stale';
  }

  function renderBackupStatus() {
    const status = backupStatus();
    const labels = {
      good: ['양호', '개인키 기기에 백업 완료', '✓'],
      stale: ['주의', '기기에 백업된 개인키 업데이트 필요', '!'],
      missing: ['경고', '개인키 기기에 백업 안됨', '!']
    };
    const editButton = $('editWalletsBtn');
    editButton.classList.remove('backup-good', 'backup-stale', 'backup-missing');
    editButton.classList.add('backup-' + status);
    $('editWalletsStatusIcon').textContent = labels[status][2];
    $('editWalletsStatusIcon').setAttribute('aria-label', labels[status][0]);
    document.querySelectorAll('[data-device-backup]').forEach(button => {
      const card = button.closest('.backup-status-card');
      card.classList.remove('backup-good', 'backup-stale', 'backup-missing');
      card.classList.add('backup-' + status);
      card.querySelector('.backup-status-title').textContent = labels[status][0];
      card.querySelector('.backup-status-description').textContent = labels[status][1];
      card.querySelector('.backup-status-icon').textContent = labels[status][2];
      button.textContent = status === 'good' ? '확인하기' : '해결하기';
    });
  }

  function handleBackupStatus() {
    if (!vaultPassword) return openDeviceBackup();
    if (backupStatus() === 'good') {
      $('backupFileName').textContent = backupRecord.fileName;
      $('backupLocationDialog').showModal();
    } else openDeviceBackup();
  }
  $('backupLocationClose').onclick = () => $('backupLocationDialog').close();
  $('backupLocationVerify').onclick = () => {
    if (!vaultPassword || !backupRecord) return;
    showAlert('마지막으로 확인한 백업 파일의 정보입니다. 파일 이동·삭제 여부는 자동으로 확인할 수 없습니다.', '기기에 저장한 백업', [
      { label: '저장 위치', values: ['브라우저에서 전체 폴더 경로를 제공하지 않습니다. 파일 저장 시 선택한 폴더 또는 다운로드 폴더를 확인해 주세요.'] },
      { label: '파일명', values: [backupRecord.fileName], literal: true },
      { label: '저장된 지갑 이름', values: backupRecord.wallets.map(wallet => wallet.name), literal: true }
    ]);
  };
  $('backupLocationCreate').onclick = () => {
    if (backupBusy || !vaultPassword) return;
    openDeviceBackup();
  };

  function backupFileName(now = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const timestamp = String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes());
    const prefix = WalletI18n.language === 'en' ? 'PSL Wallet private key' : 'PSL지갑 개인키';
    return prefix + '_' + timestamp + '.json';
  }

  function downloadBackup(text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName();
    // Preserve the wallet page when Safari previews a download.
    link.target = '_blank';
    link.rel = 'noopener';
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    (dialogs[dialogs.length - 1] || document.body).append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function mergeVerifiedWallets(current, restored, targetId) {
    if (targetId && !restored.some(wallet => wallet.id === targetId)) throw new Error('선택한 지갑의 백업 파일이 아닙니다.');
    const merged = new Map(current.map(wallet => [wallet.id, wallet]));
    for (const wallet of restored) {
      const existing = merged.get(wallet.id);
      merged.set(wallet.id, { ...(existing || wallet), backupVerified: true });
    }
    return [...merged.values()];
  }

  let preparedBackup = null;
  let backupPreparation = 0;
  let backupSaveComplete = false;

  function resetDeviceBackup() {
    backupPreparation++;
    preparedBackup = null;
    backupSaveComplete = false;
    $('deviceBackupForm').reset();
    $('deviceBackupSave').disabled = true;
  }

  async function prepareDeviceBackup() {
    const revision = ++backupPreparation;
    preparedBackup = null;
    backupSaveComplete = false;
    $('deviceBackupSave').disabled = true;
    $('deviceBackupError').textContent = '';
    const password = $('deviceBackupPassword').value;
    if (backupBusy || !vaultPassword || password.length < 10 || password !== $('deviceBackupConfirm').value) return;
    const snapshot = wallets;
    const session = vaultPassword;
    try {
      const text = await WalletBackup.encrypt(snapshot, password);
      if (revision !== backupPreparation || snapshot !== wallets || session !== vaultPassword || !$('deviceBackupDialog').open) return;
      preparedBackup = { text, snapshot, session, file: new File([text], backupFileName(), { type: 'application/json' }) };
      $('deviceBackupSave').disabled = false;
    } catch {
      if (revision === backupPreparation) $('deviceBackupError').textContent = '백업 파일을 만들지 못했습니다. 비밀번호는 10자 이상이어야 합니다. 다시 시도해 주세요.';
    }
  }
  $('deviceBackupPassword').oninput = prepareDeviceBackup;
  $('deviceBackupConfirm').oninput = prepareDeviceBackup;

  function openDeviceBackup() {
    const wallet = activeWallet();
    if (!wallet || !vaultPassword) return toast('먼저 지갑 잠금을 해제해 주세요.');
    // Keep the previous dialog underneath so cancel returns to the entry screen.
    resetDeviceBackup();
    $('deviceBackupError').textContent = '';

    $('deviceBackupDialog').showModal();
  }

  function renderBackupWizard() {
    $('restoreBackupPrevious').classList.toggle('hidden', !backupWizardStep);
    $('restoreBackupSteps').querySelectorAll('li').forEach((item, index) => {
      if (index + 1 === backupWizardStep) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    $('restoreBackupSubmit').textContent = backupWizardStep === 2 ? '다음 >' : backupWizardStep === 3 ? '사용하기' : '백업된 개인키 불러오기';
  }

  function openRestoreBackup(verify = false) {
    if (!verify && walletVault && !vaultPassword) {
      toast('기존 지갑을 보호하기 위해 먼저 잠금을 해제한 후 백업을 불러와 주세요.');
      $('unlockPassword').focus();
      return;
    }
    backupWizardStep = verify ? 2 : 0;
    backupVerificationId = verify ? activeWalletId : null;
    $('restoreBackupSteps').classList.toggle('hidden', !verify);
    $('restoreBackupInputs').classList.remove('hidden');
    $('restoreBackupSummary').classList.add('hidden');
    renderBackupWizard();
    $('restoreBackupForm').reset();
    $('restoreBackupError').textContent = '';
    $('restoreBackupTitle').textContent = verify ? '저장된 개인키 확인하기' : '백업된 개인키 불러오기';
    $('restoreVaultFields').classList.toggle('hidden', Boolean(vaultPassword));
    $('restoreVaultPassword').required = !vaultPassword;
    $('restoreVaultConfirm').required = !vaultPassword;
    $('restoreBackupDialog').showModal();
  }

  document.querySelectorAll('[data-device-backup]').forEach((button) => { button.onclick = handleBackupStatus; });
  document.querySelectorAll('[data-restore-backup]').forEach((button) => { button.onclick = () => openRestoreBackup(); });
  $('deviceBackupClose').onclick = () => {
    if (!backupBusy) $('deviceBackupDialog').close();
  };
  $('restoreBackupPrevious').onclick = () => {
    if (backupBusy || !backupWizardStep) return;
    if (backupWizardStep === 3) {
      backupWizardStep = 2;
      $('restoreBackupTitle').textContent = '저장된 개인키 확인하기';
      $('restoreBackupInputs').classList.remove('hidden');
      $('restoreBackupSummary').classList.add('hidden');
      $('restoreBackupError').textContent = '';
      renderBackupWizard();
    } else {
      $('restoreBackupDialog').close();
      openDeviceBackup();
    }
  };
  $('deviceBackupDialog').oncancel = event => { if (backupBusy) event.preventDefault(); };
  $('restoreBackupClose').onclick = () => { if (!backupBusy) $('restoreBackupDialog').close(); };
  $('restoreBackupDialog').oncancel = event => { if (backupBusy) event.preventDefault(); };
  $('restoreBackupDialog').addEventListener('close', () => $('restoreBackupForm').reset());
  $('deviceBackupDialog').addEventListener('close', resetDeviceBackup);

  $('deviceBackupForm').onsubmit = async event => {
    event.preventDefault();
    if (backupBusy || !preparedBackup || !vaultPassword) return;
    const prepared = preparedBackup;
    if (prepared.snapshot !== wallets || prepared.session !== vaultPassword) {
      prepareDeviceBackup();
      return;
    }
    const active = () => preparedBackup === prepared && prepared.snapshot === wallets && prepared.session === vaultPassword && $('deviceBackupDialog').open;
    backupBusy = true;
    backupSaveComplete = false;
    $('deviceBackupPassword').disabled = true;
    $('deviceBackupConfirm').disabled = true;
    setLoading($('deviceBackupSave'), true, '새 백업 파일 저장');
    try {
      let message;
      let title = '백업 파일 저장 완료';
      // All permission prompts start in the submit gesture, before any await.
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({ suggestedName: prepared.file.name, types: [{ description: 'PSL Wallet backup', accept: { 'application/json': ['.json'] } }] });
        if (!active()) return;
        const writable = await handle.createWritable();
        try {
          await writable.write(prepared.text);
          await writable.close();
        } catch (error) {
          await writable.abort().catch(() => {});
          throw error;
        }
        message = '백업 파일을 저장했습니다. 저장한 파일을 다시 선택하여 확인해 주세요.';
      } else if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [prepared.file] })) {
        await navigator.share({ files: [prepared.file] });
        title = '파일 저장 창 완료';
        message = '파일 저장 창이 완료되었습니다. 선택한 위치의 백업 파일을 다시 열어 확인해 주세요.';
      } else {
        downloadBackup(prepared.text);
        title = '백업 파일 저장 요청';
        message = '다운로드를 요청했습니다. 브라우저에서 저장을 완료한 뒤 저장한 파일을 다시 선택하여 확인해 주세요.';
      }
      if (!active()) return;
      await showAlert(message, title);
      if (!active()) return;
      backupSaveComplete = true;
      $('deviceBackupError').textContent = '';
      $('deviceBackupDialog').close();
      openRestoreBackup(true);
    } catch (error) {
      if (active() && error.name !== 'AbortError') $('deviceBackupError').textContent = '파일을 저장하지 못했습니다. 다시 시도해 주세요.';
    } finally {
      backupBusy = false;
      $('deviceBackupPassword').disabled = false;
      $('deviceBackupConfirm').disabled = false;
      setLoading($('deviceBackupSave'), false, '새 백업 파일 저장');
      $('deviceBackupSave').disabled = !preparedBackup;
    }
  };

  $('restoreBackupForm').onsubmit = async (event) => {
    event.preventDefault();
    if (backupBusy) return;
    const file = $('restoreBackupFile').files[0];
    if (!file || file.size > WalletBackup.maxFileSize) {
      $('restoreBackupError').textContent = '1MB 이하의 지갑 백업 파일을 선택해 주세요.';
      return;
    }
    const sessionPassword = vaultPassword;
    const targetId = backupVerificationId;
    const newPassword = $('restoreVaultPassword').value;
    if (!sessionPassword && (newPassword.length < 10 || newPassword !== $('restoreVaultConfirm').value)) {
      $('restoreBackupError').textContent = '새 잠금 비밀번호를 10자 이상 입력하고 동일하게 확인해 주세요.';
      return;
    }
    backupBusy = true;
    setLoading($('restoreBackupSubmit'), true, '백업된 개인키 불러오기');
    const previousWallets = wallets;
    const previousId = activeWalletId;
    const previousRecord = backupRecord;
    const previousVault = walletVault;
    try {
      const data = await WalletBackup.decrypt(await file.text(), $('restoreBackupPassword').value);
      if (vaultPassword !== sessionPassword || !$('restoreBackupDialog').open) return;
      const restored = data.wallets.map(wallet => makeWallet(wallet.privateKey, wallet.name, true));
      if (targetId && !restored.some(wallet => wallet.id === targetId)) throw new Error('선택한 지갑의 백업 파일이 아닙니다.');
      if (backupWizardStep && !WalletBackup.matches(wallets, data.wallets)) throw new Error('BACKUP_MISMATCH');
      if (backupWizardStep === 2) {
        backupWizardStep = 3;
        $('restoreBackupTitle').textContent = '저장한 개인키 불러오기';
        $('restoreBackupInputs').classList.add('hidden');
        $('restoreBackupWalletNames').textContent = data.wallets.map(wallet => wallet.name).join('\n');
        $('restoreBackupSummary').classList.remove('hidden');
        $('restoreBackupError').textContent = '';
        return;
      }
      // Only wallets actually present in the verified file become usable.
      wallets = targetId
        ? wallets.map(wallet => ({ ...wallet, backupVerified: restored.some(saved => saved.id === wallet.id) || wallet.backupVerified }))
        : mergeVerifiedWallets(wallets, restored, targetId);
      backupRecord = makeBackupRecord(data.wallets, file.name);
      activeWalletId = targetId || restored[0].id;
      vaultPassword = sessionPassword || newPassword;
      try { await persistWallets(); }
      catch (error) {
        wallets = previousWallets;
        backupRecord = previousRecord;
        activeWalletId = previousId;
        vaultPassword = sessionPassword;
        walletVault = previousVault;
        throw error;
      }
      document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
      showWallet();
      toast(`백업 파일의 지갑 ${restored.length}개를 확인했습니다. 모두 사용할 수 있습니다.`);
    } catch (error) {
      $('restoreBackupError').textContent = error.message === '선택한 지갑의 백업 파일이 아닙니다.' ? error.message : '비밀번호가 잘못되었거나 파일이 손상되었거나 저장 공간이 부족합니다. 기존 지갑은 유지됩니다.';
    } finally {
      backupBusy = false;
      setLoading($('restoreBackupSubmit'), false, '백업된 개인키 불러오기');
      renderBackupWizard();
    }
  };

  async function start() {
    applyConfig();
    renderBackupStatus();
    await initializeVault();
    if (localStorage.getItem(LEGACY_KEY) && !walletVault) {
      localStorage.removeItem(LEGACY_KEY);
      toast('보안을 위해 기존 평문 키를 제거했습니다. 백업 키를 다시 가져와 주세요.');
    }
    showOnly(walletVault ? 'unlock' : 'onboarding');
  }

  start();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    let pendingUpdate = false;
    let reloading = false;
    let hadController = Boolean(navigator.serviceWorker.controller);
    const applyUpdate = () => {
      if (!pendingUpdate || reloading || document.hidden || backupBusy || transferInFlight || document.querySelector('dialog[open]')) return;
      // Do not discard passwords or an in-progress form while applying an update.
      if ([...document.querySelectorAll('input')].some(input => input.value && input.offsetParent !== null)) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) pendingUpdate = true;
      hadController = true;
      applyUpdate();
    });
    navigator.serviceWorker.register('./sw.js?v=92', { updateViaCache: 'none' }).then(registration => {
      const checkUpdate = () => {
        if (document.hidden) return;
        registration.update().catch(() => {});
        applyUpdate();
      };
      document.addEventListener('visibilitychange', checkUpdate);
      window.addEventListener('pageshow', checkUpdate);
      window.addEventListener('online', checkUpdate);
      setInterval(checkUpdate, 60000);
      setInterval(applyUpdate, 1000);
      checkUpdate();
    }).catch(() => {});
  }
})();
