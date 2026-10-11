/* Offline support. Network first (so updates arrive right away), cache as fallback. */
const CACHE = 'patience-v14';
const FILES = ['./', 'index.html', 'style.css?v=14', 'game.js?v=14', 'tracking-config.js?v=14', 'tracking.js?v=14', 'manifest.webmanifest',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
['spades', 'hearts', 'diamonds', 'clubs'].forEach(s => ['ace', 2, 3, 4, 5, 6, 7, 8, 9, 10, 'jack', 'queen', 'king'].forEach(r => { FILES.push(`cards/${r}_of_${s}.png`); FILES.push(`cards/groot/${r}_of_${s}.png`); }));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('patience-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: false }).then(r => r || caches.match('index.html')))
  );
});
