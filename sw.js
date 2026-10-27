/* PrioriBuy — service worker v2
   Aturan keamanan:
   - HANYA menyimpan: app.html, aset statis aplikasi, dan file CDN (Bootstrap, ikon, font).
   - TIDAK PERNAH menyimpan: respons API/Supabase, token, bukti pembayaran, percakapan konsultasi, halaman PHP.
   - Pembaruan: jaringan-dulu untuk app.html dan aset aplikasi, cache hanya cadangan offline. Versi cache dinaikkan setiap rilis. */
const VERSION = 'pb-planner-v3';
const CORE = [
  'index.html', 'app.html', 'manifest.json',
  'assets/css/theme.css', 'assets/js/theme.js',
  'assets/img/logo-horizontal.png', 'assets/img/logo-utama.png', 'assets/img/favicon-48.png', 'assets/img/apple-touch-icon.png', 'assets/img/pwa/icon-192.png', 'assets/img/pwa/icon-512.png', 'assets/img/pwa/icon-maskable-512.png',
  'assets/img/pwa/icon-192.png', 'assets/img/pwa/icon-512.png', 'assets/img/pwa/icon-maskable-512.png'
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    await Promise.allSettled(CDN.map(u => cache.add(new Request(u, { mode: 'cors' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith('pb-planner-') && k !== VERSION) || k.startsWith('pb-private')).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Dipanggil saat logout: pastikan tidak ada cache privat tersisa
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_PRIVATE') {
    event.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('pb-private')).map(k => caches.delete(k)))));
  }
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(req, key, ms) {
  const cache = await caches.open(VERSION);
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    const fresh = await fetch(req, { signal: ctl.signal, cache: 'no-cache' }); clearTimeout(t);
    if (fresh && fresh.ok) cache.put(key, fresh.clone());
    return fresh;
  } catch (e) {
    return (await cache.match(key)) || (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/(^|\.)supabase\.(co|in)$/.test(url.hostname)) return;          // API & Storage & Realtime: tidak pernah di-cache

  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/app.html')) { event.respondWith(networkFirst(req, 'app.html', 4000)); return; }
    const rel = url.pathname.replace(/^.*?(assets\/|manifest\.json)/, '$1');
    if (CORE.includes(rel)) { event.respondWith(networkFirst(req, rel, 4000)); }
    return;                                                           // halaman lain, PHP, konsultasi: biarkan browser
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; }
      catch (e) { return Response.error(); }
    })());
  }
});
