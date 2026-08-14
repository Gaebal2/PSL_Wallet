const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pwa = path.join(root, 'pwa');
const required = ['index.html', 'styles.css', 'install.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'icons/icon.svg', 'images/psl-wallet-social-v2.png', 'vendor/qrcode.min.js'];
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
const referencedIds = [...appSource.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
const missingIds = [...new Set(referencedIds.filter((id) => !ids.includes(id)))];
if (missingIds.length) failures.push(`JavaScript references missing HTML ids: ${missingIds.join(', ')}`);
if (!html.includes('Content-Security-Policy')) failures.push('HTML CSP is missing');
if (!html.includes('property="og:image"')) failures.push('Open Graph image metadata is missing');
if (!html.includes('https://gaebal2.github.io/PSL_Wallet/images/psl-wallet-social-v2.png')) failures.push('Open Graph image must use the public absolute URL');
if (!appSource.includes("notation: 'compact'")) failures.push('Compact balance formatting is missing');
if ((html.match(/data-password-toggle=/g) || []).length < 5) failures.push('Password visibility toggles are missing');
if (!html.includes('id="receiveQr"') || !appSource.includes('new QRCode(')) failures.push('Receive QR generation is missing');
if (!html.includes('id="pslSendTab"') || !html.includes('id="pslReceiveTab"')) failures.push('PSL asset actions are missing');
if (!html.includes('id="pullRefresh"') || !appSource.includes('PULL_THRESHOLD')) failures.push('Pull-to-refresh is missing');
if (appSource.includes("setLoading($('refreshBtn')")) failures.push('Refresh button must not replace its icon with loading text');
if (!html.includes('id="pullRefresh" class="pull-refresh hidden"')) failures.push('Pull-to-refresh must be hidden before CSS and JavaScript are ready');
if (!appSource.includes('!deferredInstallPrompt')) failures.push('Install dialog must require a real browser install prompt');
if (!appSource.includes("indexedDB.open(WALLET_DB, 1)")) failures.push('Durable IndexedDB wallet backup is missing');
if (!appSource.includes('navigator.storage?.persist')) failures.push('Persistent browser storage request is missing');
if (html.includes('\uFFFD') || html.includes('釉') || html.includes('吏')) failures.push('HTML appears to contain mojibake');

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exit(1);
}
console.log('✓ PWA files, JavaScript, manifest, references, IDs, CSP, and encoding validated');
