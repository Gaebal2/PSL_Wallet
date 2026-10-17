(() => {
  'use strict';
  const ua = navigator.userAgent || '';
  const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  const embedded = !standalone && /KAKAOTALK|Telegram|FBAN|FBAV|Instagram|Line\/|NAVER\(|DaumApps|; wv\)|\bwv\b/i.test(ua);
  const android = /Android/i.test(ua);
  const dialog = document.getElementById('externalBrowserDialog');
  const status = document.getElementById('externalBrowserStatus');
  const address = document.getElementById('externalBrowserAddress');
  // Share only the app entry point, never wallet data or URL fragments.
  const url = new URL('./', location.href).href;
  address.value = url;
  document.getElementById('externalBrowserClose').hidden = embedded;
  dialog.addEventListener('cancel', event => { if (embedded) event.preventDefault(); });
  document.getElementById('externalBrowserClose').onclick = () => dialog.close();
  document.getElementById('externalBrowserGuideBtn').onclick = () => dialog.showModal();
  document.getElementById('externalBrowserOpen').onclick = () => {
    status.textContent = '전환되지 않으면 메신저 메뉴의 “외부 브라우저로 열기”를 선택하거나 주소를 복사해 기본 브라우저에 붙여 넣어 주세요.';
    if (android) {
      // Do not pin Chrome: let the device resolve the browser where supported.
      location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=${location.protocol.slice(0, -1)};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
    } else {
      // iOS and unsupported hosts have no universal external-browser API.
      document.getElementById('externalBrowserSteps').focus();
    }
  };
  document.getElementById('externalBrowserCopy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = '주소를 복사했습니다. 기본 브라우저를 열고 주소창에 붙여 넣어 주세요.';
    } catch {
      address.focus();
      address.select();
      status.textContent = '아래 주소를 길게 눌러 복사한 뒤 기본 브라우저에서 열어 주세요.';
    }
  };
  window.PSLExternalBrowser = {
    guard() {
      if (!embedded) return false;
      document.querySelector('.app-shell').hidden = true;
      dialog.showModal();
      return true;
    }
  };
})();
