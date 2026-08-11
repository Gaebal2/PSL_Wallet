const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pwa = path.join(root, 'pwa');
const required = ['index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'icons/icon.svg'];
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
if (!html.includes('Content-Security-Policy')) failures.push('HTML CSP is missing');
if (html.includes('\uFFFD') || html.includes('釉') || html.includes('吏')) failures.push('HTML appears to contain mojibake');

if (failures.length) {
  console.error(failures.map((failure) => `✗ ${failure}`).join('\n'));
  process.exit(1);
}
console.log('✓ PWA files, JavaScript, manifest, references, IDs, CSP, and encoding validated');
