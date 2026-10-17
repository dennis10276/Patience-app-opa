/* Offline support. Network first (so updates arrive right away), cache as fallback. */
const CACHE = 'patience-v23';
const FILES = ['./', 'index.html', 'style.css?v=23', 'game.js?v=23', 'tracking-config.js?v=23', 'tracking.js?v=23', 'manifest.webmanifest',
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
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/version\.json$/.test(url.pathname)) return;        // update checks always go to the website
  // the page itself is always checked with the website, so a new version is picked up right away
  const get = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req);
  e.respondWith(
    get.then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: false }).then(r => r || caches.match('index.html')))
  );
});
