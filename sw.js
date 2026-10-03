// Service worker dels Cronògrafs: l'app funciona sense connexió.
// - Fitxers propis: primer la xarxa (per rebre actualitzacions), si no, la còpia desada.
// - API externes (temps, festius, ubicació): primer la xarxa, si no, l'última resposta desada.
const VERSION = 'cronografs-v6';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VERSION + '-api').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  const bucket = own ? VERSION : VERSION + '-api';

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(bucket).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || (own && req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
