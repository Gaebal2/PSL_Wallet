const CACHE_NAME = 'psl-wallet-v59';
const APP_SHELL = [
  './',
  './index.html',
  './framing.css?v=55',
  './styles.css?v=55',
  './wallets.css?v=59',
  './install.css?v=55',
  './history.css?v=55',
  './overlays.css?v=55',
  './app.js?v=59',
  './manifest.webmanifest',
  './icons/icon-512.png',
  './icons/icon.svg',
  './images/psl-wallet-social-v3.png',
  './images/psl-token-icon.svg',
  './images/sl-token-icon.png',
  './vendor/crypto-js.min.js',
  './vendor/nacl-fast.min.js',
  './vendor/axios.min.js',
  './vendor/qrcode.min.js',
  './vendor/saseul.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(APP_SHELL.map(async (url) => {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) throw new Error(`Failed to cache ${url}`);
    await cache.put(url, response);
  }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
