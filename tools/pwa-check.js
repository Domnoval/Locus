// Checks that Locus installs as an app (Android's home screen) and works offline. Exits non-zero if any check fails.
// usage: node tools/pwa-check.js   (PLAYWRIGHT=/path/to/playwright to use an existing install)
// It serves the repository over http://localhost, as GitHub Pages will over https, and asks Chrome itself
// whether the page is installable (DevTools' Page.getInstallabilityErrors).
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const root = path.resolve(__dirname, '..');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

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
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
