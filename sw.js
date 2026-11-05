// Locus offline: the page comes from the network when it can (so updates arrive) and from the cache when it can't.
// Icons and fonts come from the cache first; they don't change.
const CACHE = 'locus-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './app/icon.svg', './app/icon-192.png', './app/icon-512.png', './app/icon-maskable-192.png', './app/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('locus-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// network first, but don't keep a painter waiting on bad Wi-Fi: after 3 s use the saved page (the fetch still refreshes it)
async function page(request) {
  const cache = await caches.open(CACHE);
  const net = fetch(request).then(res => { if (res.ok) cache.put('./index.html', res.clone()); return res; });
  net.catch(() => {});
  const saved = await cache.match('./index.html');
  if (!saved) return net;
  try { return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))]); }
  catch { return saved; }
}
async function stored(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (r.mode === 'navigate' && u.origin === location.origin && /\/(index\.html)?$/.test(u.pathname)) { e.respondWith(page(r)); return; }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') { e.respondWith(stored(r)); return; }
  if (u.origin === location.origin && u.pathname.includes('/app/')) e.respondWith(stored(r));
});
