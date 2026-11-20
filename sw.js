// Locus offline: the page comes from the network when it can (so updates arrive) and from the cache when it can't.
// Only a page that really is Locus is ever saved, or shown in place of the saved copy: it must answer OK and carry the marker line below.
// A Wi-Fi sign-in page, an error page from the host, a redirect or anything else falls back to the saved copy and is never stored.
// Icons and fonts come from the cache first; they don't change.
// The cache name changes when this worker's behaviour does (v2: the marker check), so installed copies start clean; the fonts are carried over.
const CACHE = 'locus-v2';
const MARK = '<meta name="locus-app" content="locus"';   // the same line is in index.html's head; neither may change without the other
const CORE = ['./manifest.webmanifest', './app/icon.svg', './app/icon-192.png', './app/icon-512.png', './app/icon-maskable-192.png', './app/icon-maskable-512.png'];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

const isLocus = async res => { try { return !!res && res.ok && (await res.clone().text()).includes(MARK); } catch { return false; } };

// the app is saved at install only if what the host sends is Locus; otherwise the install fails and the worker already there carries on
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE), res = await fetch('./index.html', { cache: 'no-cache' });
    if (!(await isLocus(res))) throw new Error('index.html is not Locus');
    await cache.put('./index.html', res);
    await cache.addAll(CORE);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const now = await caches.open(CACHE);
    for (const k of (await caches.keys()).filter(k => k.startsWith('locus-') && k !== CACHE)) {
      // fonts already saved by an earlier worker are kept, so an update while offline doesn't lose them
      try { const old = await caches.open(k); for (const req of await old.keys()) if (FONTS.test(req.url) && !(await now.match(req))) { const r = await old.match(req); if (r) await now.put(req, r); } } catch { }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// network first, but don't keep a painter waiting on bad Wi-Fi: after 3 s use the saved page (the fetch still refreshes it)
async function page(e) {
  const cache = await caches.open(CACHE), saved = await cache.match('./index.html');
  const net = fetch(e.request).then(async res => {
    if (await isLocus(res)) { await cache.put('./index.html', res.clone()); return res; }
    if (!saved) return res;            // nothing saved yet (a first visit): show what came, store nothing
    throw new Error('not Locus');      // a sign-in page, an error page, a redirect: the saved copy is shown instead
  });
  e.waitUntil(net.catch(() => { }));
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
  if (r.mode === 'navigate' && u.origin === location.origin && /\/(index\.html)?$/.test(u.pathname)) { e.respondWith(page(e)); return; }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') { e.respondWith(stored(r)); return; }
  if (u.origin === location.origin && u.pathname.includes('/app/')) e.respondWith(stored(r));
});
