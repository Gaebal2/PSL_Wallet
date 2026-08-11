(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const VAULT_KEY = 'psl-wallet-vault-v1';
  const CONFIG_KEY = 'psl-wallet-config-v1';
  const LEGACY_KEY = 'psl-wallet-key';
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const defaults = { endpoint: 'https://main.saseul.net', owner: '', space: 'MY TOKEN', cid: '' };
  let config = readJson(CONFIG_KEY, defaults);
  let privateKey = '';
  let token = { symbol: 'PSL', decimal: 0 };
  let rawBalance = '0';
  let rawSlBalance = '0';
  let selectedAsset = 'PSL';
  let autoLockTimer;
  let deferredInstallPrompt = null;

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

  async function encryptVault(key, password) {
    if (!crypto?.subtle) throw new Error('이 브라우저는 안전한 암호화 저장소를 지원하지 않습니다.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const derivedKey = await passwordKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, derivedKey, new TextEncoder().encode(key));
    localStorage.setItem(VAULT_KEY, JSON.stringify({ version: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) }));
  }

  async function decryptVault(password) {
    const vault = JSON.parse(localStorage.getItem(VAULT_KEY));
    if (!vault || vault.version !== 1) throw new Error('지원하지 않는 지갑 데이터입니다.');
    const key = await passwordKey(password, base64ToBytes(vault.salt));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(vault.iv) }, key, base64ToBytes(vault.ciphertext));
    const value = new TextDecoder().decode(plaintext);
    if (!SASEUL.Sign.keyValidity(value)) throw new Error('지갑 데이터가 손상되었습니다.');
    return value;
  }

  function address() {
    return privateKey ? SASEUL.Sign.address(SASEUL.Sign.publicKey(privateKey)) : '';
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

  function parseUnits(value, decimals) {
    const text = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('수량을 숫자로 입력해 주세요.');
    const [whole, fraction = ''] = text.split('.');
    if (fraction.length > decimals) throw new Error(`소수점은 최대 ${decimals}자리까지 입력할 수 있습니다.`);
    return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(fraction.padEnd(decimals, '0') || '0')).toString();
  }

  function rpcError(error) {
    if (typeof error?.msg === 'string') return error.msg;
    if (typeof error?.message === 'string') return error.message;
    return '네트워크 요청에 실패했습니다.';
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
    showOnly('wallet');
    $('accountAddress').textContent = address();
    $('receiveAddress').textContent = address();
    resetAutoLock();
    refresh();
  }

  function lockWallet(notify = true) {
    privateKey = '';
    clearTimeout(autoLockTimer);
    if (localStorage.getItem(VAULT_KEY)) showOnly('unlock'); else showOnly('onboarding');
    $('unlockForm').reset();
    if (notify) toast('지갑을 잠갔습니다.');
  }

  function resetAutoLock() {
    if (!privateKey) return;
    clearTimeout(autoLockTimer);
    autoLockTimer = setTimeout(() => lockWallet(true), AUTO_LOCK_MS);
  }

  async function refresh() {
    if (!privateKey) return;
    setLoading($('refreshBtn'), true, '↻');
    $('connectionState').className = 'connection';
    $('connectionState').innerHTML = '<i></i> 연결 확인 중';
    const slRequest = SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ type: 'GetBalance', address: address() }, privateKey));
    const pslRequest = (async () => {
      const cid = contractId();
      return Promise.all([
        SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ cid, type: 'GetInfo' }, privateKey)),
        SASEUL.Rpc.request(SASEUL.Rpc.signedRequest({ cid, type: 'GetBalance', address: address() }, privateKey))
      ]);
    })();
    const [slState, pslState] = await Promise.allSettled([slRequest, pslRequest]);
    let online = false;
    if (slState.status === 'fulfilled' && slState.value.code === 200) {
      online = true;
      rawSlBalance = String(slState.value.data.balance || '0');
      $('slBalance').textContent = formatUnits(rawSlBalance, 18);
    } else {
      $('slBalance').textContent = '연결 오류';
    }
    if (pslState.status === 'fulfilled') {
      const [infoResult, balanceResult] = pslState.value;
      if (infoResult.code === 200 && balanceResult.code === 200) {
        online = true;
        token = { symbol: infoResult.data.symbol || 'PSL', decimal: Number(infoResult.data.decimal || 0) };
        rawBalance = String(balanceResult.data.balance || '0');
        const formatted = formatUnits(rawBalance, token.decimal);
        $('symbol').textContent = token.symbol;
        $('assetSymbol').textContent = token.symbol;
        $('balance').textContent = formatted;
        $('balanceShort').textContent = formatted;
        $('assetValueStatus').textContent = '실시간 잔액';
      } else {
        $('balance').textContent = '연결 오류';
        $('balanceShort').textContent = '—';
      }
    } else {
      $('balance').textContent = '설정 필요';
      $('balanceShort').textContent = '—';
      $('assetValueStatus').textContent = '토큰 설정 확인';
    }
    $('networkBadge').textContent = config.endpoint.toLowerCase().includes('test') ? 'TESTNET' : 'MAINNET';
    $('connectionState').className = `connection ${online ? 'online' : 'offline'}`;
    $('connectionState').innerHTML = `<i></i> ${online ? '온라인' : '연결 안 됨'}`;
    setLoading($('refreshBtn'), false, '↻');
  }

  async function saveWallet(key, password) {
    if (!SASEUL.Sign.keyValidity(key)) throw new Error('개인키는 64자리 16진수여야 합니다.');
    await encryptVault(key.toLowerCase(), password);
    localStorage.removeItem(LEGACY_KEY);
    privateKey = key.toLowerCase();
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
    ['sendPanel', 'receivePanel'].forEach((panel) => $(panel).classList.toggle('hidden', panel !== id));
    $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (isStandalone() || $('installDialog').open) return;
    updateInstallDialog();
    $('installDialog').showModal();
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallDialog();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if ($('installDialog').open) $('installDialog').close();
    toast('PSL Wallet을 설치했습니다.');
  });

  $('installBtn').onclick = async () => {
    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') $('installDialog').close();
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
      await saveWallet($('importKey').value.trim(), $('importPassword').value);
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
      privateKey = await decryptVault($('unlockPassword').value);
      $('unlockForm').reset();
      showWallet();
    } catch {
      privateKey = '';
      $('unlockError').textContent = '비밀번호가 올바르지 않거나 지갑 데이터가 손상되었습니다.';
    } finally { setLoading($('unlockBtn'), false, '잠금 해제'); }
  };

  $('settingsBtn').onclick = () => $('settingsDialog').showModal();
  $('settingsClose').onclick = () => $('settingsDialog').close();
  $('lockBtn').onclick = () => lockWallet(true);
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

  function deleteWallet() {
    if (!localStorage.getItem(VAULT_KEY)) return;
    const phrase = prompt('백업하지 않은 지갑은 복구할 수 없습니다. 삭제하려면 "삭제"를 입력하세요.');
    if (phrase !== '삭제') return toast('삭제를 취소했습니다.');
    localStorage.removeItem(VAULT_KEY);
    localStorage.removeItem(LEGACY_KEY);
    privateKey = '';
    $('settingsDialog').close();
    showOnly('onboarding');
    toast('이 기기에서 지갑을 삭제했습니다.');
  }

  $('logoutBtn').onclick = deleteWallet;
  $('resetBtn').onclick = deleteWallet;
  $('refreshBtn').onclick = refresh;
  $('sendTab').onclick = () => openPanel('sendPanel', 'PSL');
  $('receiveTab').onclick = () => openPanel('receivePanel', 'PSL');
  $('slSendTab').onclick = () => openPanel('sendPanel', 'SL');
  $('slReceiveTab').onclick = () => openPanel('receivePanel', 'SL');
  document.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => button.closest('.sheet').classList.add('hidden'); });
  $('copyAddress').onclick = () => copy(address());
  $('copyAccount').onclick = () => copy(address());
  $('maxBtn').onclick = () => {
    if (selectedAsset === 'SL') return toast('SL은 수수료를 남기고 수량을 입력해 주세요.');
    $('amount').value = formatUnits(rawBalance, token.decimal);
  };

  $('sendForm').onsubmit = async (event) => {
    event.preventDefault();
    $('sendError').textContent = '';
    const to = $('toAddress').value.trim();
    try {
      if (!SASEUL.Sign.addressValidity(to)) throw new Error('받는 주소가 올바르지 않습니다.');
      if (to === address()) throw new Error('내 주소로는 전송할 수 없습니다.');
      const decimals = selectedAsset === 'SL' ? 18 : token.decimal;
      const symbol = selectedAsset === 'SL' ? 'SL' : token.symbol;
      const available = selectedAsset === 'SL' ? rawSlBalance : rawBalance;
      const amount = parseUnits($('amount').value, decimals);
      if (BigInt(amount) <= 0n) throw new Error('0보다 큰 수량을 입력해 주세요.');
      if (BigInt(amount) > BigInt(available)) throw new Error('보유 수량이 부족합니다.');
      if (!confirm(`${$('amount').value} ${symbol}을 전송할까요?\n\n받는 주소: ${to}\n\n주소와 수량을 다시 확인하세요.`)) return;
      setLoading($('sendBtn'), true, '검토 후 전송');
      const transaction = { type: 'Send', to, amount };
      if (selectedAsset !== 'SL') transaction.cid = contractId();
      const result = await SASEUL.Rpc.broadcastTransaction(SASEUL.Rpc.signedTransaction(transaction, privateKey));
      if (result.code !== 200) throw result;
      toast('전송 요청이 완료되었습니다.');
      $('sendForm').reset();
      setTimeout(refresh, 3000);
    } catch (error) { $('sendError').textContent = rpcError(error); }
    finally { setLoading($('sendBtn'), false, '검토 후 전송'); resetAutoLock(); }
  };

  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => document.addEventListener(eventName, resetAutoLock, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && privateKey) resetAutoLock(); });
  window.addEventListener('offline', () => { $('connectionState').className = 'connection offline'; $('connectionState').innerHTML = '<i></i> 오프라인'; });

  applyConfig();
  if (localStorage.getItem(LEGACY_KEY) && !localStorage.getItem(VAULT_KEY)) {
    localStorage.removeItem(LEGACY_KEY);
    toast('보안을 위해 기존 평문 키를 제거했습니다. 백업 키를 다시 가져와 주세요.');
  }
  showOnly(localStorage.getItem(VAULT_KEY) ? 'unlock' : 'onboarding');
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  window.addEventListener('load', () => setTimeout(showInstallDialog, 700));
})();
