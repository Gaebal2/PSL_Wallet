const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pwa = path.join(root, 'pwa');
const required = ['index.html', 'framing.css', 'styles.css', 'wallets.css', 'install.css', 'history.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'icons/icon-512.png', 'images/psl-wallet-social-v2.png', 'images/psl-token-icon.svg', 'images/sl-token-icon.png', 'vendor/qrcode.min.js'];
const failures = [];

for (const file of required) {
  if (!fs.existsSync(path.join(pwa, file))) failures.push(`Missing ${file}`);
}

for (const file of ['app.js', 'sw.js', 'server.js']) {
  try { new vm.Script(fs.readFileSync(path.join(pwa, file), 'utf8'), { filename: file }); }
  catch (error) { failures.push(error.message); }
}

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(pwa, 'manifest.webmanifest'), 'utf8'));
  for (const field of ['name', 'short_name', 'start_url', 'display', 'icons']) {
    if (!manifest[field]) failures.push(`Manifest is missing ${field}`);
  }
  for (const icon of manifest.icons || []) {
    if (!fs.existsSync(path.join(pwa, icon.src))) failures.push(`Manifest icon not found: ${icon.src}`);
  }
} catch (error) { failures.push(`Invalid manifest: ${error.message}`); }

const html = fs.readFileSync(path.join(pwa, 'index.html'), 'utf8');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) failures.push(`Duplicate HTML ids: ${[...new Set(duplicates)].join(', ')}`);
const appSource = fs.readFileSync(path.join(pwa, 'app.js'), 'utf8');
const swSource = fs.readFileSync(path.join(pwa, 'sw.js'), 'utf8');
const walletsSource = fs.readFileSync(path.join(pwa, 'wallets.css'), 'utf8');
const framingSource = fs.readFileSync(path.join(pwa, 'framing.css'), 'utf8');
const referencedIds = [...appSource.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
const missingIds = [...new Set(referencedIds.filter((id) => !ids.includes(id)))];
if (missingIds.length) failures.push(`JavaScript references missing HTML ids: ${missingIds.join(', ')}`);
if (!html.includes('Content-Security-Policy')) failures.push('HTML CSP is missing');
if (!appSource.includes('window.top !== window.self') || !appSource.includes("classList.add('app-context-verified')") || !framingSource.includes('html.app-context-verified')) failures.push('Framing protection is missing');
if (!html.includes('property="og:image"')) failures.push('Open Graph image metadata is missing');
if (!html.includes('https://gaebal2.github.io/PSL_Wallet/images/psl-wallet-social-v2.png')) failures.push('Open Graph image must use the public absolute URL');
if (!appSource.includes('formatCompactUnits') || !appSource.includes("[12, 'T'], [9, 'B'], [6, 'M'], [3, 'K']") || !appSource.includes('visibleFraction')) failures.push('Adaptive compact balance formatting is missing');
if ((html.match(/data-password-toggle=/g) || []).length < 5) failures.push('Password visibility toggles are missing');
if (!html.includes('id="receiveQr"') || !appSource.includes('new QRCode(')) failures.push('Receive QR generation is missing');
if (!html.includes('id="activePslSend"') || !html.includes('id="activePslReceive"')) failures.push('PSL asset actions are missing');
if (!html.includes('id="pullRefresh"') || !appSource.includes('PULL_THRESHOLD')) failures.push('Pull-to-refresh is missing');
if (html.includes('id="refreshBtn"')) failures.push('Redundant refresh button must not be shown');
if (!html.includes('id="pullRefresh" class="pull-refresh hidden"')) failures.push('Pull-to-refresh must be hidden before CSS and JavaScript are ready');
if (!appSource.includes('!deferredInstallPrompt')) failures.push('Install dialog must require a real browser install prompt');
if (!appSource.includes("indexedDB.open(WALLET_DB, 1)")) failures.push('Durable IndexedDB wallet backup is missing');
if (!appSource.includes('navigator.storage?.persist')) failures.push('Persistent browser storage request is missing');
if (!html.includes('id="walletList"') || !html.includes('id="openAddWalletBtn"')) failures.push('Multi-wallet list and import controls are missing');
if (!appSource.includes('version: 2, wallets, activeWalletId')) failures.push('Multi-wallet encrypted vault format is missing');
if (!appSource.includes("['이름 변경', '', '']")) failures.push('Wallet editor action is missing');
if (!appSource.includes("['이름 변경', '', '']") || !appSource.includes("requestTextInput('지갑 이름 변경'")) failures.push('Wallet rename control is missing');
if (!html.includes('id="addWalletDialog"') || !html.includes('id="importName"')) failures.push('Independent wallet dialog or wallet name import is missing');
if (!html.includes('ACTIVE WALLET') || !html.includes('id="editWalletsBtn"') || !html.includes('id="walletManagerDialog"')) failures.push('Active wallet card or wallet manager is missing');
if (html.includes('class="asset-section"') || html.includes('class="quick-actions"')) failures.push('Legacy asset detail sections must stay removed');
if (!appSource.includes('validatePslTransfer') || !appSource.includes('formatCompactUnits(balances.sl, 18, 9)') || !appSource.includes('formatPslBalance(balances.psl)')) failures.push('PSL preflight or wallet-list PSL formatter is missing');
if (!html.includes('id="historyList"') || !html.includes('id="historyPagination"') || !appSource.includes("data: 'fullList', type: 'Send'")) failures.push('Paginated transaction history is missing');
if (!appSource.includes('normalizeBalance') || !appSource.includes('nextBody.set')) failures.push('Decimal PSL balances or history look-ahead are not handled');
if (!appSource.includes('removeWallet') || !appSource.includes('syncDialogScrollLock')) failures.push('Per-wallet deletion or dialog scroll locking is missing');
if (!appSource.includes('formatDisplayUnits') || !appSource.includes('submitTransaction') || !html.includes('id="transferSuccessDialog"')) failures.push('Exact grouped amounts or resilient transfer completion UI is missing');
if (!appSource.includes('Promise.any(requests)') || !appSource.includes('result.data ?? {}') || !appSource.includes("'받는 주소' : '보낸 주소'")) failures.push('Resilient empty history handling or counterparty labels are missing');
if (!html.includes('id="transferReviewDialog"') || !appSource.includes('confirmTransfer') || !appSource.includes('formatAmountInput') || !appSource.includes("selectedAsset === 'SL' ? amount : formatUnits(amount, decimals)") || !appSource.includes('parseTokenUnits(balanceResult.data.balance, token.decimal)')) failures.push('Custom transfer review, grouped input, or PSL contract units are missing');
if (!html.includes('app.js?v=48') || !appSource.includes("sw.js?v=48") || !swSource.includes("cache: 'reload'")) failures.push('Versioned app assets or forced service-worker refresh are missing');
if (!html.includes('id="appAlertDialog"') || !appSource.includes('isInvalidPslTransferAmount') || !appSource.includes('최소 송금 가능 금액은 1 PSL')) failures.push('Whole-unit PSL transfer warning is missing');
if (!html.includes('id="transferReviewFee"') || !appSource.includes('estimatedFee') || !appSource.includes('history-fee') || !appSource.includes("'psl-token-icon.svg' : 'sl-token-icon.png'")) failures.push('Transfer fee preview or token-aware history is missing');
if (!html.includes('id="dangerConfirmDialog"') || !appSource.includes('confirmDanger') || appSource.includes('if (!confirm(`${wallet.name}')) failures.push('Custom wallet deletion confirmation is missing');
if (!html.includes('id="uninstallGuideDialog"') || !html.includes('id="uninstallGuideBackup"') || !appSource.includes("$('uninstallGuideDelete').onclick")) failures.push('App removal and storage guidance is missing');
if (!appSource.includes('const closeUninstallGuide') || !appSource.includes('formatCompactUnits(balances.psl, token.decimal, 0)')) failures.push('Settings return flow or whole-unit active PSL display is missing');
if (!html.includes('class="orb small unlock-orb"') || !html.includes('class="active-wallet-name-row"') || !html.includes('class="hero-balance-icon psl-balance-icon"')) failures.push('Unlock icon or active wallet layout refinement is missing');
if (!html.includes('id="textInputDialog"') || !html.includes('id="backupConfirmDialog"') || !html.includes('id="privateKeyDialog"') || !appSource.includes('requestTextInput') || !appSource.includes('confirmPrivateKeyBackup')) failures.push('Custom rename or private-key backup dialogs are missing');
if (!appSource.includes("DEFAULT_PSL_CID = 'dbd6217ffd83c29c077571c5be8eb945418f6cef27ab4ba92f378acb6a1d0080'")) failures.push('Default PSL CID is missing');
if (!html.includes('images/psl-token-icon.svg') || !swSource.includes('images/psl-token-icon.svg')) failures.push('Aligned vector PSL icon is missing');
if (!appSource.includes('event.stopPropagation()') || !walletsSource.includes('-webkit-tap-highlight-color: transparent')) failures.push('Wallet copy tap target isolation is missing');
if (/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(appSource.replace(/promptEvent\.prompt\s*\(/g, ''))) failures.push('Browser-native app dialogs are still in use');
if (!appSource.includes('parseTokenUnits') || !appSource.includes('keep SL and history available')) failures.push('Token balance parsing or refresh isolation is missing');
if (!appSource.includes('https://explorer.saseul.com/?ic=tx&h=')) failures.push('Explorer transaction links are missing');
if (!html.includes('id="activePslSend"') || !html.includes('id="activeSlReceive"')) failures.push('Active wallet asset actions are missing');
if (html.includes('\uFFFD') || html.includes('釉') || html.includes('吏')) failures.push('HTML appears to contain mojibake');

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exit(1);
}
console.log('✓ PWA files, JavaScript, manifest, references, IDs, CSP, and encoding validated');
