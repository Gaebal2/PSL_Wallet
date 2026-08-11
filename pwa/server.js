const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png'
};
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400, securityHeaders).end('Bad request'); return; }
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(root, requested);
  if (!file.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403, securityHeaders).end('Forbidden');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, securityHeaders).end('Not found');
      return;
    }
    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=0, must-revalidate'
    });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`PSL Wallet: http://localhost:${port}`));
