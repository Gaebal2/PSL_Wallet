const CACHE_NAME = 'psl-wallet-v18';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './wallets.css',
  './install.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './images/psl-wallet-social-v2.png',
  './vendor/crypto-js.min.js',
  './vendor/nacl-fast.min.js',
  './vendor/axios.min.js',
  './vendor/qrcode.min.js',
  './vendor/saseul.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
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
