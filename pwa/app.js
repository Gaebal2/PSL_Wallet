(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const VAULT_KEY = 'psl-wallet-vault-v1';
  const CONFIG_KEY = 'psl-wallet-config-v1';
  const LEGACY_KEY = 'psl-wallet-key';
  const WALLET_DB = 'psl-wallet-storage-v1';
  const WALLET_STORE = 'wallet';
  const SL_SYSTEM_CID = '19bd191ea2da3fd599528b4b831206ec5cf958d6cdbea0188a22d7d44673dd58';
  const INSTALLED_KEY = 'psl-wallet-installed-v1';
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const defaults = { endpoint: 'https://main.saseul.net', owner: '', space: 'MY TOKEN', cid: '' };
  let config = readJson(CONFIG_KEY, defaults);
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
  const PULL_THRESHOLD = 72;

  function readJson(key, fallback) {
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
    catch { return { ...fallback }; }
  }

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('toast').classList.remove('show'), 2600);
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

  function makeWallet(key, name) {
    const privateKeyValue = key.toLowerCase();
    const walletAddressValue = walletAddress({ privateKey: privateKeyValue });
    return { id: walletAddressValue, name: name || `지갑 ${wallets.length + 1}`, privateKey: privateKeyValue };
  }

  function activeWallet() {
    return wallets.find((wallet) => wallet.id === activeWalletId) || wallets[0];
  }

  async function persistWallets() {
    if (!vaultPassword || !wallets.length) throw new Error('지갑 잠금을 먼저 해제해 주세요.');
    await encryptVault(JSON.stringify({ version: 2, wallets, activeWalletId }), vaultPassword);
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

  function showAlert(message, title = '확인해 주세요') {
    const dialog = $('appAlertDialog');
    $('appAlertTitle').textContent = title;
    $('appAlertMessage').textContent = message;
    dialog.showModal();
    return new Promise((resolve) => {
      const finish = () => {
        dialog.removeEventListener('cancel', onCancel);
        dialog.close();
        resolve();
      };
      const onCancel = (event) => { event.preventDefault(); finish(); };
      $('appAlertClose').onclick = finish;
      dialog.addEventListener('cancel', onCancel);
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
        if (requirePhrase && phraseInput.value.trim() !== '삭제') {
          $('dangerConfirmError').textContent = '“삭제”를 정확히 입력해 주세요.';
          phraseInput.focus();
          return;
        }
        finish(true);
      };
      dialog.addEventListener('cancel', onCancel);
    });
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
    SASEUL.Rpc.endpoints([config.endpoint]);
    SASEUL.Rpc.timeout(12000);
    $('endpoint').value = config.endpoint;
    $('contractOwner').value = config.owner;
    $('space').value = config.space;
    $('cid').value = config.cid;
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
    privateKey = '';
    vaultPassword = '';
    wallets = [];
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
      details.querySelector('.wallet-address button').onclick = () => copy(wallet.id);
      details.querySelector('.wallet-balances strong').textContent = balances.loading ? '조회 중' : `${formatCompactUnits(balances.sl, 18, 9)} SL`;
      details.querySelector('.wallet-balances small').textContent = balances.loading ? '—' : `${formatCompactUnits(balances.psl, token.decimal)} ${token.symbol}`;
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'wallet-choose-button';
      selectButton.textContent = '선택';
      selectButton.disabled = wallet.id === activeWalletId;
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
    if (!wallet) return;
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
    const pslDisplay = balances.error ? '—' : formatCompactUnits(balances.psl, token.decimal, 6);
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
    if (!transactions.length) {
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
        tokenIcon.src = `images/${isPsl ? 'psl' : 'sl'}-token-icon.png`;
        tokenIcon.alt = `${symbol} 아이콘`;
        icon.append(tokenIcon);
        const details = document.createElement('div');
        details.className = 'history-details';
        const title = document.createElement('strong');
        title.textContent = `${symbol} ${sent ? '보냄' : '받음'}`;
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
        time.textContent = timestamp ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp / 1000)) : '';
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
      const entries = Array.isArray(data) ? data.map((entry) => [entry.hash || '', entry]) : Object.entries(data || {});
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
    toast('PSL Wallet을 설치했습니다.');
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
      input.focus({ preventScroll: true });
    });
  });

  $('createBtn').onclick = () => {
    $('createForm').classList.toggle('hidden');
    $('importForm').classList.add('hidden');
    if (!$('createForm').classList.contains('hidden')) $('createPassword').focus();
  };

  $('showImportBtn').onclick = () => {
    $('importForm').classList.toggle('hidden');
    $('createForm').classList.add('hidden');
    if (!$('importForm').classList.contains('hidden')) $('importKey').focus();
  };

  $('createForm').onsubmit = async (event) => {
    event.preventDefault();
    const password = $('createPassword').value;
    if (password !== $('createPasswordConfirm').value) return toast('비밀번호가 일치하지 않습니다.');
    if (password.length < 10) return toast('비밀번호를 10자 이상 입력해 주세요.');
    const button = event.submitter;
    try {
      setLoading(button, true, '안전하게 생성');
      const pair = SASEUL.Sign.keyPair();
      await saveWallet(pair.private_key, password);
      toast('지갑을 만들었습니다. 지금 개인키를 백업하세요.');
      setTimeout(() => $('settingsDialog').showModal(), 350);
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
      wallets = data.wallets.map((wallet, index) => makeWallet(wallet.privateKey, wallet.name || `지갑 ${index + 1}`));
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

  $('settingsBtn').onclick = () => $('settingsDialog').showModal();
  $('settingsClose').onclick = () => $('settingsDialog').close();
  $('editWalletsBtn').onclick = () => $('walletManagerDialog').showModal();
  $('walletManagerClose').onclick = () => $('walletManagerDialog').close();
  $('activePslSend').onclick = () => openPanel('sendPanel', 'PSL');
  $('activePslReceive').onclick = () => openPanel('receivePanel', 'PSL');
  $('activeSlSend').onclick = () => openPanel('sendPanel', 'SL');
  $('activeSlReceive').onclick = () => openPanel('receivePanel', 'SL');
  $('transferSuccessClose').onclick = () => $('transferSuccessDialog').close();
  $('historyPrev').onclick = () => refreshHistory(Math.max(1, historyPage - 1));
  $('historyNext').onclick = () => refreshHistory(historyPage + 1);
  $('openAddWalletBtn').onclick = () => {
    $('walletManagerDialog').close();
    $('addWalletDialog').showModal();
    $('additionalWalletName').focus();
  };
  $('addWalletClose').onclick = () => $('addWalletDialog').close();
  async function renameWallet(walletId) {
    const wallet = wallets.find((item) => item.id === walletId);
    if (!wallet) return;
    const name = prompt('새 지갑 이름을 입력하세요.', wallet.name)?.trim();
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
      activeWalletId = wallet.id;
      privateKey = wallet.privateKey;
      await persistWallets();
      $('additionalWalletName').value = '';
      $('additionalWalletKey').value = '';
      $('addWalletDialog').close();
      showWallet();
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
  $('settingsForm').onsubmit = (event) => {
    event.preventDefault();
    const next = { endpoint: $('endpoint').value.trim().replace(/\/$/, ''), owner: $('contractOwner').value.trim(), space: $('space').value.trim(), cid: $('cid').value.trim() };
    if (!next.endpoint.startsWith('https://') && location.hostname !== 'localhost') return toast('배포 환경에서는 HTTPS RPC만 사용할 수 있습니다.');
    if (next.cid && !/^[0-9a-fA-F]{64}$/.test(next.cid)) return toast('CID는 64자리 16진수여야 합니다.');
    if (!next.cid && next.owner && !SASEUL.Sign.addressValidity(next.owner)) return toast('발행자 주소를 확인해 주세요.');
    config = next;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    applyConfig();
    $('settingsDialog').close();
    toast('설정을 저장했습니다.');
    if (privateKey) refresh();
  };

  $('exportBtn').onclick = () => {
    if (!privateKey) return toast('먼저 지갑 잠금을 해제해 주세요.');
    if (!confirm('화면을 볼 수 있는 사람은 개인키로 자산을 가져갈 수 있습니다. 혼자 있는 안전한 장소입니까?')) return;
    prompt('개인키를 오프라인 장소에 백업한 뒤 이 창을 닫으세요.', privateKey);
    resetAutoLock();
  };

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
    activeWalletId = '';
    walletBalances.clear();
    $('settingsDialog').close();
    showOnly('onboarding');
    toast('이 기기에서 지갑을 삭제했습니다.');
  }

  $('logoutBtn').onclick = deleteWallet;
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
    $('sendError').textContent = '';
    const to = $('toAddress').value.trim();
    if (selectedAsset !== 'SL' && isInvalidPslTransferAmount($('amount').value)) {
      await showAlert('PSL은 소수점 이하 단위로 전송할 수 없습니다. 최소 송금 가능 금액은 1 PSL입니다.', 'PSL 송금 수량 확인');
      return;
    }
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
      const signed = SASEUL.Rpc.signedTransaction(transaction, privateKey);
      const fee = await estimateTransactionFee(signed);
      if (selectedAsset === 'SL' && BigInt(amount) + BigInt(fee) > BigInt(rawSlBalance)) throw new Error('SL 수량과 네트워크 수수료를 합한 금액이 잔액을 초과합니다.');
      if (selectedAsset !== 'SL' && BigInt(fee) > BigInt(rawSlBalance)) throw new Error(`PSL 전송 수수료 ${formatSlFee(fee)}를 낼 SL 잔액이 부족합니다.`);
      if (!await confirmTransfer(displayAmount, symbol, to, fee)) return;
      setLoading($('sendBtn'), true, '검토 후 전송');
      const result = await submitTransaction(signed);
      if (!transactionAccepted(result)) throw new Error(`${symbol} 전송 실패: ${rpcError(result)}`);
      $('sendForm').reset();
      $('sendPanel').close();
      $('transferSuccessMessage').textContent = `${displayAmount} ${symbol} 전송 요청이 정상적으로 접수되었습니다.`;
      $('transferSuccessDialog').showModal();
      setTimeout(refresh, 3000);
    } catch (error) { $('sendError').textContent = rpcError(error); }
    finally { setLoading($('sendBtn'), false, '검토 후 전송'); resetAutoLock(); }
  };

  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => document.addEventListener(eventName, resetAutoLock, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && privateKey) resetAutoLock(); });
  window.addEventListener('offline', () => { $('connectionState').className = 'connection offline'; $('connectionState').innerHTML = '<i></i> 오프라인'; });

  async function start() {
    applyConfig();
    await initializeVault();
    if (localStorage.getItem(LEGACY_KEY) && !walletVault) {
      localStorage.removeItem(LEGACY_KEY);
      toast('보안을 위해 기존 평문 키를 제거했습니다. 백업 키를 다시 가져와 주세요.');
    }
    showOnly(walletVault ? 'unlock' : 'onboarding');
  }

  start();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js?v=33', { updateViaCache: 'none' }).catch(() => {});
})();
