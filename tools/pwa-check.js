// Checks that Locus installs as an app (Android's home screen) and works offline. Exits non-zero if any check fails.
// usage: node tools/pwa-check.js   (PLAYWRIGHT=/path/to/playwright to use an existing install)
// It serves the repository over http://localhost, as GitHub Pages will over https, and asks Chrome itself
// whether the page is installable (DevTools' Page.getInstallabilityErrors).
// Then it plays a bad network from real local servers: a host that answers 503, a Wi-Fi sign-in page that answers 200, a slow host,
// and a fonts host that accepts the request and never answers. Fonts are NOT blocked in that part: a local https server stands in
// for fonts.googleapis.com and fonts.gstatic.com (it needs openssl for a throwaway certificate; without openssl those checks are skipped
// with a note), and that browser is started with no proxy, so it can reach nothing but this machine.
// LOCUS_ROOT=/path/to/another/copy runs the same checks on that copy.
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const root = path.resolve(process.env.LOCUS_ROOT || path.join(__dirname, '..'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

/* ---------- the bad network ---------- */
// the worker that installed copies of Locus have today (cache "locus-v1"), word for word, to check that they update cleanly
const OLD_WORKER = `const CACHE = 'locus-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './app/icon.svg', './app/icon-192.png', './app/icon-512.png', './app/icon-maskable-192.png', './app/icon-maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('locus-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
async function page(request) { const cache = await caches.open(CACHE); const net = fetch(request).then(res => { if (res.ok) cache.put('./index.html', res.clone()); return res; }); net.catch(() => {}); const saved = await cache.match('./index.html'); if (!saved) return net;
  try { return await Promise.race([net, new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))]); } catch { return saved; } }
async function stored(request) { const cache = await caches.open(CACHE); const hit = await cache.match(request); if (hit) return hit; const res = await fetch(request); if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }
self.addEventListener('fetch', e => { const r = e.request; if (r.method !== 'GET') return; const u = new URL(r.url);
  if (r.mode === 'navigate' && u.origin === location.origin && /\\/(index\\.html)?$/.test(u.pathname)) { e.respondWith(page(r)); return; }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') { e.respondWith(stored(r)); return; }
  if (u.origin === location.origin && u.pathname.includes('/app/')) e.respondWith(stored(r)); });
`;
async function badNetwork() {
  // the host: what it answers is set by `host`
  const host = { page: 'ok', mark: 'v1', worker: 'new', link: 'asis', install: 'ok' };
  const PORTAL = '<title>Hotel Wi-Fi</title><h1>Sign in to Hotel Wi-Fi</h1>';
  const app = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); const bare = p.endsWith('/'); if (bare) p += 'index.html';
    const f = path.join(root, p);
    if (p.endsWith('/index.html')) {
      // "blocking" serves the page with the fonts link as it used to be, for comparing the look
      const html = () => { let t = fs.readFileSync(f, 'utf8').replace('<title>Locus</title>', `<title>Locus ${host.mark}</title>`); if (host.link === 'blocking') t = t.replace(` media="print" onload="this.media='all'"`, ''); return t; };
      if (host.page === '503') { res.writeHead(503, { 'content-type': 'text/html' }); res.end('<title>503</title><h1>503 Service Unavailable</h1>'); return; }
      if (host.page === 'portal' || (!bare && host.install === 'portal')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PORTAL); return; }
      if (host.page === 'slow') { const h = html(); setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(h); }, 5000); return; }
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }); res.end(html()); return;
    }
    if (p === '/sw.js' && host.worker === 'old') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' }); res.end(OLD_WORKER); return; }
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${app.address().port}/`;
  // the fonts host: three local typefaces stand in for the real ones, so "the fonts arrived" can be seen and measured
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locus-net-'));
  const FACES = [['Instrument Serif', 'normal', '400', 'freefont/FreeSerif.ttf'], ['Instrument Serif', 'italic', '400', 'freefont/FreeSerifItalic.ttf'], ['IBM Plex Sans', 'normal', '400 600', 'freefont/FreeSans.ttf'], ['IBM Plex Mono', 'normal', '400 500', 'freefont/FreeMono.ttf']]
    .map(f => [...f, ['/usr/share/fonts/truetype/' + f[3], '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'].find(p => fs.existsSync(p))]);
  let fontSrv = null, fonts = 'ok', fontHits = 0; const held = [];
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=fonts.googleapis.com', '-addext', 'subjectAltName=DNS:fonts.googleapis.com,DNS:fonts.gstatic.com'], { stdio: 'ignore' });
    if (FACES.some(f => !f[4])) throw new Error('no local typeface to stand in');
    fontSrv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
      fontHits++;
      if (fonts === 'hang') { held.push(res); return; }            // accepted, never answered
      if (fonts === 'fail') { req.socket.destroy(); return; }       // as when offline
      const head = type => ({ 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      if (req.url.startsWith('/css2')) { res.writeHead(200, head('text/css')); res.end(FACES.map((f, i) => `@font-face{font-family:'${f[0]}';font-style:${f[1]};font-weight:${f[2]};font-display:swap;src:url(https://fonts.gstatic.com/s/face${i})}`).join('\n')); return; }
      const m = req.url.match(/^\/s\/face(\d)$/); if (m && FACES[+m[1]]) { res.writeHead(200, head('font/ttf')); res.end(fs.readFileSync(FACES[+m[1]][4])); return; }
      res.writeHead(404); res.end();
    });
    await new Promise(r => fontSrv.listen(0, '127.0.0.1', r));
  } catch (e) { fontSrv = null; console.log(`NOTE  the fonts-host checks were skipped: ${e.message.split('\n')[0]}`); }
  const drop = () => held.splice(0).forEach(r => r.socket.destroy());
  const env = { ...process.env }; ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].forEach(k => delete env[k]);
  const fp = fontSrv ? fontSrv.address().port : 9;   // with no fonts host, port 9 (discard) refuses at once, as offline does
  const browser = await chromium.launch({ env, args: [`--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1:${fp}, MAP fonts.gstatic.com 127.0.0.1:${fp}`] });
  const errors = [];
  const open = async (opts = {}) => { const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, ...opts }), page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); return { ctx, page }; };
  const go = (page, url = base) => page.goto(url, { waitUntil: 'domcontentloaded' }).then(() => page.waitForTimeout(150)).catch(() => { });
  const see = page => page.evaluate(() => ({ title: document.title, h1: (document.querySelector('h1') || {}).textContent || '', locus: !!window.__state && document.querySelectorAll('#geometry path').length > 0 })).catch(e => ({ title: '', h1: '', locus: false, err: e.message.slice(0, 80) }));
  const controlled = page => page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).then(() => true).catch(() => false);
  const cacheList = page => page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async k => [k, (await (await caches.open(k)).keys()).map(r => r.url.replace(location.origin, ''))]))));

  { // the host changes its mind: update, 503, sign-in page, offline, recovery, slow
    Object.assign(host, { page: 'ok', mark: 'v1', worker: 'new', link: 'asis', install: 'ok' }); fonts = 'fail';
    const { ctx, page } = await open();
    await go(page, base + '?app=perspective'); const ctl = await controlled(page);
    host.mark = 'v2'; await go(page); const upd = await see(page);
    check('A new version on the host arrives at the next launch (updating still works)', ctl && upd.locus && upd.title === 'Locus v2', { ctl, upd });
    host.page = '503'; await go(page); const e503 = await see(page);
    check('The host answers 503: the saved Locus opens, not the error page', e503.locus && e503.title === 'Locus v2', e503);
    host.page = 'portal'; await go(page); const por = await see(page);
    check('A Wi-Fi sign-in page that answers 200 is not shown in place of Locus', por.locus && por.title === 'Locus v2', por);
    await ctx.setOffline(true); await go(page); const off = await see(page); await ctx.setOffline(false);
    check('…and it is not saved as the app: offline afterwards, Locus still opens', off.locus && off.title === 'Locus v2', off);
    host.page = 'ok'; host.mark = 'v3'; await go(page); const rec = await see(page);
    check('Back on a good network the next version arrives (recovery)', rec.locus && rec.title === 'Locus v3', rec);
    host.page = 'slow'; host.mark = 'v4'; const t = Date.now(); await go(page); const slow = await see(page), ms = Date.now() - t;
    check('A slow host (5 s to answer): the saved Locus opens after about 3 s', slow.locus && slow.title === 'Locus v3' && ms > 2500 && ms < 4800, { slow, ms });
    await page.waitForTimeout(3500); host.page = 'ok'; await ctx.setOffline(true); await go(page); const behind = await see(page); await ctx.setOffline(false);
    check('…and the slow answer is still saved behind it: offline next, the newer version opens', behind.locus && behind.title === 'Locus v4', behind);
    await ctx.close();
  }
  { // the worker installs while the host is answering with a sign-in page: that page must never be saved as the app
    Object.assign(host, { page: 'ok', mark: 'v1', worker: 'new', install: 'portal' }); fonts = 'fail';
    const { ctx, page } = await open(); await go(page); await page.waitForTimeout(2500);
    const savedPages = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const req of await c.keys()) if (/\/(index\.html)?$/.test(new URL(req.url).pathname)) out.push((await (await c.match(req)).text()).slice(0, 60)); } return out; });
    check('If the host answers with a sign-in page while the worker installs, that page is not saved as the app', !savedPages.some(t => /Hotel Wi-Fi/.test(t)), savedPages);
    host.install = 'ok'; await go(page); const ctl = await controlled(page); await ctx.setOffline(true); await go(page); const off = await see(page); await ctx.setOffline(false);
    check('…and once the host is itself again the worker installs and Locus opens offline', ctl && off.locus, { ctl, off });
    await ctx.close();
  }
  { // an installed copy with today's worker takes the new one
    Object.assign(host, { page: 'ok', mark: 'v1', worker: 'old', install: 'ok' }); fonts = 'fail';
    const { ctx, page } = await open(); await go(page); const ctl = await controlled(page);
    await page.evaluate(async () => { const c = await caches.open('locus-v1'); await c.put(new Request('https://fonts.gstatic.com/s/kept-from-v1'), new Response('font bytes', { headers: { 'content-type': 'font/woff2' } })); });
    const before = await cacheList(page);
    host.worker = 'new'; host.mark = 'v2'; await go(page);
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update().catch(() => { }); });
    let after = {}; for (let i = 0; i < 40; i++) { after = await cacheList(page).catch(() => ({})); if (!after['locus-v1'] && Object.keys(after).length) break; await page.waitForTimeout(250); }
    const names = Object.keys(after), now = after[names[0]] || [];
    await ctx.setOffline(true); await go(page); const off = await see(page); await ctx.setOffline(false);
    check('An installed copy with today’s worker (cache locus-v1) updates cleanly: one new cache, the old one gone, saved fonts carried across, and Locus opens offline',
      ctl && !!before['locus-v1'] && names.length === 1 && names[0] !== 'locus-v1' && /^locus-v\d+$/.test(names[0]) && now.includes('https://fonts.gstatic.com/s/kept-from-v1') && now.includes('/index.html') && off.locus, { ctl, before: Object.keys(before), after, off });
    await ctx.close();
  }
  if (fontSrv) {
    // how long from asking for the page until the drawing is there
    const start = async (page, limit = 8000) => { const t = Date.now(); page.goto(base, { waitUntil: 'commit' }).catch(() => { }); while (Date.now() - t < limit) { if (await page.evaluate(() => !!window.__state && document.querySelectorAll('#geometry path').length > 0).catch(() => false)) return Date.now() - t; await page.waitForTimeout(40); } return null; };
    const face = page => page.evaluate(() => ({ media: (document.querySelector('link[href*="fonts.googleapis.com/css2"]') || {}).media, sans: document.fonts.check('12px "IBM Plex Sans"'), mono: document.fonts.check('12px "IBM Plex Mono"'), serif: document.fonts.check('12px "Instrument Serif"'), loaded: [...document.fonts].filter(f => f.status === 'loaded').length })).catch(() => ({}));
    { // held open on a first visit
      Object.assign(host, { page: 'ok', mark: 'v1', worker: 'new', link: 'asis', install: 'ok' }); fonts = 'hang'; fontHits = 0;
      const { ctx, page } = await open(); const ms = await start(page); const f = await face(page);
      check('The fonts request is accepted and never answered, on a first visit: Locus starts on its fallback fonts within about a second', ms != null && ms < 1500 && fontHits > 0 && f.loaded === 0, { ms, fontHits, f });
      let reg = false; for (let i = 0; i < 28 && !reg; i++) { await page.waitForTimeout(250); reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }).catch(() => false); }
      const state = await page.evaluate(() => document.readyState).catch(() => '');
      check('…and the offline worker still installs, although the page never finishes loading', reg && fontHits > 0, { reg, readyState: state, fontHits });
      drop(); await ctx.close();
    }
    { // held open on a later visit: the worker is in charge and has no fonts saved
      fonts = 'ok'; const { ctx, page } = await open(); await go(page); const ctl = await controlled(page); await page.waitForTimeout(600);
      await page.evaluate(async () => { for (const k of await caches.keys()) { const c = await caches.open(k); for (const req of await c.keys()) if (/fonts\./.test(req.url)) await c.delete(req); } });
      fonts = 'hang'; fontHits = 0; const ms = await start(page); const f = await face(page);
      check('The same with the worker in charge and no fonts saved yet: Locus starts within about a second', ctl && ms != null && ms < 1500 && fontHits > 0 && f.loaded === 0, { ctl, ms, fontHits, f });
      drop(); await ctx.close();
    }
    { // the fonts arrive
      fonts = 'ok'; const { ctx, page } = await open(); await go(page); await page.waitForFunction(() => [...document.fonts].filter(f => f.status === 'loaded').length >= 3, null, { timeout: 8000 }).catch(() => { }); const f = await face(page);
      check('When the fonts do arrive they are switched on: all three families are in use', f.media !== 'print' && f.sans && f.mono && f.serif && f.loaded >= 3, f);
      await ctx.close();
    }
    // the look: the page with the fonts link as it used to be (blocking) against the page as it is, pixel for pixel, in both modes
    const shot = async (link, mode, q) => { host.link = link; fonts = mode; const { ctx, page } = await open({ reducedMotion: 'reduce' }); await go(page, base + q);
      if (mode === 'ok') await page.waitForFunction(() => document.fonts.status === 'loaded' && [...document.fonts].filter(f => f.status === 'loaded').length >= 3, null, { timeout: 8000 }).catch(() => { });
      await page.waitForTimeout(700); const png = await page.screenshot({ fullPage: true }), n = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').length); await ctx.close(); host.link = 'asis'; return { png, n }; };
    for (const [mode, name] of [['ok', 'With the fonts loaded Locus looks exactly as it did when the fonts link blocked the page (same pixels, Geometry and Perspective)'], ['fail', 'With the fonts unavailable Locus looks exactly as it did then too: the same fallback faces (same pixels, both modes)']]) {
      const out = []; for (const q of ['?app=geometry', '?app=perspective']) { const a = await shot('blocking', mode, q), b = await shot('asis', mode, q); out.push({ q, same: a.png.equals(b.png), bytes: [a.png.length, b.png.length], faces: [a.n, b.n] }); }
      check(name, out.every(o => o.same && (mode === 'ok' ? o.faces[0] >= 3 && o.faces[1] >= 3 : o.faces[0] === 0 && o.faces[1] === 0)), out);
    }
  }
  check('No script errors on the bad network', errors.length === 0, errors);
  await browser.close(); app.close(); if (fontSrv) { drop(); fontSrv.close(); if (fontSrv.closeAllConnections) fontSrv.closeAllConnections(); } fs.rmSync(dir, { recursive: true, force: true });
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locus-pwa-'));
  // a persistent (non-incognito) profile: Chrome won't call an incognito page installable
  const ctx = await chromium.launchPersistentContext(dir, { ...devices['Galaxy S24'], colorScheme: 'dark' });
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  const cdp = await ctx.newCDPSession(page);

  // the manifest parses, and every icon and screenshot it names is there at the size it claims
  await page.goto(base + '?app=perspective', { waitUntil: 'load' });
  const man = await cdp.send('Page.getAppManifest');
  check('Manifest is found and parses without errors', man.url && !man.errors.length, man.errors);
  const M = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const pngSize = b => [b.readUInt32BE(16), b.readUInt32BE(20)];
  const jpgSize = b => { let i = 2; while (i < b.length) { if (b[i] !== 0xFF) { i++; continue; } const m = b[i + 1]; if (m >= 0xC0 && m <= 0xC2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + b.readUInt16BE(i + 2); } return null; };
  const bad = [];
  for (const im of [...M.icons, ...M.screenshots]) {
    const f = path.join(root, im.src); if (!fs.existsSync(f)) { bad.push(im.src + ' missing'); continue; }
    if (im.sizes === 'any') continue;
    const b = fs.readFileSync(f), s = im.type === 'image/png' ? pngSize(b) : jpgSize(b);
    if (!s || s.join('x') !== im.sizes) bad.push(`${im.src} is ${s && s.join('x')}, says ${im.sizes}`);
  }
  check('Every icon and screenshot exists at the size the manifest declares', !bad.length, bad);
  check('Has a 512 px maskable icon (adaptive icons on Android) and a 192 px one', M.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512') && M.icons.some(i => i.sizes === '192x192'));
  check('Opens full screen, any way up, straight into Perspective', M.display === 'fullscreen' && M.orientation === 'any' && /app=perspective/.test(M.start_url));

  // Chrome's own verdict
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || false, null, { timeout: 15000 }).catch(() => {});
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload({ waitUntil: 'load' }); }
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: !!(r && r.active), controlled: !!navigator.serviceWorker.controller, scope: r && r.scope }; });
  check('Service worker is installed and controls the page', sw.active && sw.controlled, sw);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check('Chrome says Locus is installable (no installability errors)', inst.installabilityErrors.length === 0, inst.installabilityErrors);

  // launch parameters
  check('Launching with ?app=perspective opens Perspective and tidies the address', await page.evaluate(() => document.body.classList.contains('pv-app') && !location.search));
  await page.goto(base + '?app=perspective&ref=1', { waitUntil: 'load' }); await page.waitForTimeout(400);
  check('The “At the easel” shortcut opens straight into Reference view', await page.evaluate(() => document.body.classList.contains('pv-ref')));
  await page.goto(base + '?app=geometry', { waitUntil: 'load' }); await page.waitForTimeout(200);
  check('The Geometry shortcut opens Geometry', await page.evaluate(() => !document.body.classList.contains('pv-app')));

  // offline at the easel
  await ctx.setOffline(true);
  await page.goto(base + '?app=perspective', { waitUntil: 'load' }); await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({ app: document.body.classList.contains('pv-app'), boxes: document.querySelectorAll('#geometry .pv-face').length }));
  check('With the network off, Locus still opens and draws', off.app && off.boxes > 0, off);
  await page.evaluate(() => window.__pv.setRef(true)); await page.waitForTimeout(300);
  check('…and Reference view works offline too', await page.evaluate(() => document.body.classList.contains('pv-ref')));
  await ctx.setOffline(false);

  // the install offer: Chrome fires beforeinstallprompt when it's installable; here a stand-in event drives the UI
  await page.goto(base, { waitUntil: 'load' }); await page.evaluate(() => { try { localStorage.removeItem('locus-install-seen'); } catch { } });
  await page.reload({ waitUntil: 'load' });
  const offer = await page.evaluate(() => { window.__prompted = 0; const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e);
    return { banner: !document.querySelector('#installBanner').hidden, row: !document.querySelector('#installRow').hidden }; });
  check('When Chrome offers installing, a one-time banner and an Install button appear', offer.banner && offer.row, offer);
  await page.click('#installBanner .go');
  const after = await page.evaluate(() => ({ prompted: window.__prompted, banner: !document.querySelector('#installBanner').hidden, seen: localStorage.getItem('locus-install-seen') }));
  check('Install hands over to Chrome’s install dialog, and the banner won’t nag again', after.prompted === 1 && !after.banner && after.seen === '1', after);
  const tc0 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content);
  await page.click('#themeBtn').catch(() => page.evaluate(() => document.querySelector('#themeBtn').click()));
  await page.evaluate(() => document.querySelector('#themeBtn').click());
  const tc1 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]').content);
  check('The app’s bar colour follows the theme (night ↔ paper)', tc0 !== tc1 && /^#/.test(tc1), [tc0, tc1]);

  check('No script errors', errors.length === 0, errors);
  await ctx.close(); server.close(); fs.rmSync(dir, { recursive: true, force: true });
  await badNetwork();
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
