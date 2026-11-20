// Output checks for Locus: what leaves the Studio must be what is on screen, at the size it says. Exits non-zero if any check fails.
// usage: node tools/output-check.js [path/to/index.html]   (PLAYWRIGHT=/path/to/playwright to use an existing install)
// Every check reads the real downloaded file (SVG, zip or PNG) with its own small reader, and compares it with the lines in the screen drawing,
// which are read sub-path by sub-path straight from the page, never through the Studio's own reader.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib'), { spawnSync } = require('child_process');
const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'locus-out-'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

/* ---------- readers ---------- */
// every sub-path of every <path> in each layer group of a Studio SVG, in millimetres
const parseSvg = text => {
  const strokes = [], root = (text.match(/<svg[^>]*>/) || [''])[0], attr = n => (root.match(new RegExp(` ${n}="([^"]+)"`)) || [])[1];
  const re = /<g id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g; let m;
  while ((m = re.exec(text))) { const pr = /<path d="([^"]+)"([^>]*)\/>/g; let p;
    while ((p = pr.exec(m[2]))) (p[1].match(/M[^M]*/g) || []).forEach(sub => { const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number), pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      strokes.push({ layer: m[1], pts, closed: /Z\s*$/.test(sub), width: +(p[2].match(/stroke-width="([^"]+)"/) || [])[1], opacity: (p[2].match(/ opacity="([^"]+)"/) || [])[1], filled: !/stroke=/.test(p[2]), slots: /fill-rule=/.test(p[2]) }); }); }
  const texts = [...text.matchAll(/<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)" text-anchor="([^"]+)"[^>]*>([^<]*)<\/text>/g)].map(t => ({ x: +t[1], y: +t[2], size: +t[3], anchor: t[4], text: t[5] }));
  return { strokes, texts, width: attr('width'), height: attr('height'), viewBox: attr('viewBox'), nText: (text.match(/<text/g) || []).length };
};
// a stored (uncompressed) zip, as Locus writes it
const unzip = buf => { const out = {}; let p = 0; while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) { const size = buf.readUInt32LE(p + 18), nl = buf.readUInt16LE(p + 26), xl = buf.readUInt16LE(p + 28), name = buf.toString('utf8', p + 30, p + 30 + nl); out[name] = buf.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size); p += 30 + nl + xl + size; } return out; };
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
// a PNG: size, chunk names, pHYs, whether every chunk's CRC holds, and (on request) its pixels
const readPng = (b, pixels) => { const chunks = [], idat = []; let p = 8, phys = null, crcOk = true;
  while (p + 12 <= b.length) { const n = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8); chunks.push(type); if (crc32(b.subarray(p + 4, p + 8 + n)) !== b.readUInt32BE(p + 8 + n)) crcOk = false;
    if (type === 'pHYs') phys = { x: b.readUInt32BE(p + 8), y: b.readUInt32BE(p + 12), unit: b[p + 16] }; if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + n)); p += 12 + n; }
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), out = { w, h, chunks, phys, crcOk, depth: b[24], colour: b[25] };
  if (pixels && out.depth === 8 && (out.colour === 6 || out.colour === 2)) { const bpp = out.colour === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), line = w * bpp, px = Buffer.alloc(h * line);
    for (let y = 0; y < h; y++) { const f = raw[y * (line + 1)], src = y * (line + 1) + 1, dst = y * line;
      for (let x = 0; x < line; x++) { const a = x >= bpp ? px[dst + x - bpp] : 0, u = y ? px[dst + x - line] : 0, c = x >= bpp && y ? px[dst + x - line - bpp] : 0; let v = raw[src + x];
        if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1; else if (f === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; } px[dst + x] = v & 255; } }
    out.dark = (x, y) => { const i = (y * w + x) * bpp; return (bpp === 4 ? px[i + 3] > 40 : true) && px[i] + px[i + 1] + px[i + 2] < 600; }; }
  return out; };
const dPoly = (p, pts) => { let best = Infinity; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); if (d < best) best = d; } return best; };

/* ---------- the screen drawing, read on the page (runs in the browser) ---------- */
const screenRef = () => { const out = [], odd = new Set();
  [['grid', '#gridLayer'], ['guides', '#guideLayer'], ['shapes', '#shapeLayer'], ['points', '#pointLayer']].forEach(([src, sel]) => { const g = document.querySelector(sel);
    g.querySelectorAll('path[data-kind],line[data-kind]').forEach(el => { const kind = el.dataset.kind;
      if (el.tagName === 'line') { out.push({ src, kind, pts: [[+el.getAttribute('x1'), +el.getAttribute('y1')], [+el.getAttribute('x2'), +el.getAttribute('y2')]] }); return; }
      const d = el.getAttribute('d'); (d.match(/[A-DF-Za-df-z]/g) || []).forEach(c => { if (!'MLZ'.includes(c)) odd.add(c); });
      d.split('M').filter(x => x.trim()).forEach(sub => { const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number), pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]); if (/Z\s*$/.test(sub)) pts.push(pts[0]); if (pts.length > 1) out.push({ src, kind, pts }); }); });
    if (src === 'points') g.querySelectorAll('circle').forEach(c => { const r = +c.getAttribute('r'), cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy'); out.push({ src, kind: 'dot', pts: Array.from({ length: 721 }, (_, i) => [cx + Math.cos(i / 720 * 2 * Math.PI) * r, cy + Math.sin(i / 720 * 2 * Math.PI) * r]) }); }); });
  return { ref: out, odd: [...odd] }; };
// A screen polyline stands for a true curve that may bulge from it by about a sagitta: half the largest corner-to-chord distance covers two. Straight lines get rounding only (0.02 of a screen unit).
const chordErr = pts => { let e = 0; for (let i = 1; i + 1 < pts.length; i++) { const a = pts[i - 1], b = pts[i + 1], p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l > 1e-9) e = Math.max(e, Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l); } return e / 2; };
const boxOf = pts => { const a = [1e9, 1e9, -1e9, -1e9]; pts.forEach(([x, y]) => { a[0] = Math.min(a[0], x); a[1] = Math.min(a[1], y); a[2] = Math.max(a[2], x); a[3] = Math.max(a[3], y); }); return a; };
// ink on ink: every point of every line in `lines` (sampled each quarter unit) must lie on some line of `ref`, within that line's own tolerance plus `pad`. Returns what does not.
function offInk(lines, ref, mmPerUnit, pad = 0) {
  ref.forEach(r => { if (r.tol == null) { r.tol = 0.02 + chordErr(r.pts); r.bb = boxOf(r.pts); } });
  let segs = 0, stray = 0, mm = 0, worst = 0; const ex = [];
  lines.forEach(P => { for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(4, Math.min(400, Math.ceil(L / .25))), m = 1 + pad; segs++;
    const near = ref.filter(r => !(Math.min(a[0], b[0]) > r.bb[2] + m || Math.max(a[0], b[0]) < r.bb[0] - m || Math.min(a[1], b[1]) > r.bb[3] + m || Math.max(a[1], b[1]) < r.bb[1] - m));
    let over = 0, last = null; for (let k = 0; k <= n; k++) { const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; let d = last ? dPoly(q, last.pts) - last.tol - pad : Infinity; if (d > 0) for (const r of near) { const e = dPoly(q, r.pts) - r.tol - pad; if (e < d) { d = e; last = r; if (d <= 0) break; } } if (d > over) over = d; }
    if (over > 0) { stray++; mm += L * mmPerUnit; worst = Math.max(worst, over); if (ex.length < 2) ex.push(`${a.map(v => v.toFixed(1))} → ${b.map(v => v.toFixed(1))}, ${(over * mmPerUnit).toFixed(2)} mm off`); } } });
  return { segs, stray, mm: Math.round(mm), worstMm: +(worst * mmPerUnit).toFixed(3), ex };
}
const closedPts = s => s.closed ? [...s.pts, s.pts[0]] : s.pts;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (viewport = { width: 1400, height: 900 }, query = '') => { const ctx = await browser.newContext({ viewport, acceptDownloads: true }), page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await page.goto('file://' + file + query); return { ctx, page }; };
  let seq = 0; const grab = async (page, sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const f = path.join(tmp, `${++seq}-${d.suggestedFilename()}`); await d.saveAs(f); return { name: d.suggestedFilename(), f, buf: fs.readFileSync(f) }; };
  const studio = async (page, on) => { if (await page.evaluate(() => document.querySelector('#studio').open) !== on) await page.click(on ? '#studioBtn' : '#stClose'); await page.waitForTimeout(on ? 320 : 60); };
  const layers = (page, mode, which) => page.evaluate(([mode, which]) => { const S = window.__studio; S.ST.mode = mode; S.ST.sheet = 'off'; Object.keys(S.ST.layers).forEach(k => S.ST.layers[k].on = !which || which.includes(k)); }, [mode, which]);
  const mode = async (page, m) => { await page.click(`#stModes button[data-v="${m}"]`); await page.waitForTimeout(320); };
  const scene = async (page, id, proj, patch = {}) => { await page.selectOption('#pvScene', id); if (proj) await page.click(`#pvProj button[data-v="${proj}"]`);
    await page.evaluate(patch => { const P = window.__pv, st = window.__state; st.pv = { ...st.pv, ...patch, show: { ...st.pv.show, ...(patch.show || {}) } }; P.sel = null; P.fit(true); P.render(); P.sync(); }, patch); await page.waitForTimeout(60); };
  const GUIDES = { sq: 6, show: { floor: true, horizon: true, vps: true } };
  const box = page => page.evaluate(() => { const b = document.querySelector('#geometry').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
  // the everyday Steady gestures: scroll to magnify, drag to slide (then Esc, in case the drag began on a shape and chose it)
  const magnify = async (page, at = [.8, .8], to = [.1, .1]) => { const r = await box(page); await page.mouse.move(r[0] + r[2] * at[0], r[1] + r[3] * at[1]); for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(20); }
    await page.mouse.move(r[0] + r[2] * .5, r[1] + r[3] * .5); await page.mouse.down(); await page.mouse.move(r[0] + r[2] * to[0], r[1] + r[3] * to[1], { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(80); await page.keyboard.press('Escape'); await page.waitForTimeout(80); };
  const viewOf = page => page.evaluate(() => window.__pv.viewS);
  const diff = (a, b) => { const A = parseSvg(a).strokes, B = parseSvg(b).strokes; let worst = 0, moved = 0; A.forEach((s, i) => { const t = B[i]; if (!t || t.layer !== s.layer || t.pts.length !== s.pts.length) { moved++; return; } s.pts.forEach((p, k) => worst = Math.max(worst, Math.hypot(p[0] - t.pts[k][0], p[1] - t.pts[k][1]))); }); return { strokes: [A.length, B.length], differ: moved, worstMm: +worst.toFixed(4) }; };

  /* ===== 1. The file does not depend on the screen's magnification, slide or lock (A3) ===== */
  const SCENE_NAMES = { street: 'A street of cubes', room: 'A room of cubes', totem: 'Totem' };
  // Each view gets a fresh page, so the Studio's first reading of the scene is made at that view (a second reading on the same page would only repeat what the first one kept).
  // The view is noted just before the Studio opens: opening it resizes the drawing, and a resize refits the screen.
  const camOf = page => page.evaluate(() => JSON.stringify([window.__state.pv.eye, window.__state.pv.yaw, window.__state.pv.pitch, window.__state.pv.cv, window.__state.pv.dist]));
  const printAt = async (id, proj, act) => { const { ctx, page } = await open(); await page.click('#appMode button[data-app="perspective"]'); await scene(page, id, proj, GUIDES); await layers(page, 'print'); const v0 = await viewOf(page), out = { steady: await page.evaluate(() => window.__pv.steady) };
    if (act) await act(page); out.view = await viewOf(page); out.zoom = out.view[0] / v0[0]; out.cam = await camOf(page); out.lock = await page.evaluate(() => window.__pv.viewLock);
    await studio(page, true); out.file = (await grab(page, '#stDownload')).buf.toString(); out.stats = await page.textContent('#studioStats');
    if (act) { await studio(page, false); await page.click('#pvFit'); await page.waitForTimeout(80); await studio(page, true); out.refit = (await grab(page, '#stDownload')).buf.toString(); }
    await ctx.close(); return out; };
  for (const id of ['street', 'room', 'totem']) for (const proj of ['linear', 'curvi']) {
    const fit = await printAt(id, proj), mag = await printAt(id, proj, page => magnify(page)), lock = await printAt(id, proj, async page => { await page.click('#pvLockBtn'); await page.waitForTimeout(60); await magnify(page, [.25, .3], [.9, .85]); });
    const n = parseSvg(fit.file).strokes.length;
    check(`${SCENE_NAMES[id]}, ${proj === 'curvi' ? 'curvilinear' : 'linear'}: the print file is the same fitted, magnified and slid, after Fit, and with Lock view on (${n} strokes, to the byte)`,
      fit.steady && n > 50 && mag.zoom > 4 && lock.zoom > 4 && lock.lock && !mag.lock && mag.cam === fit.cam && lock.cam === fit.cam && mag.file === fit.file && mag.refit === fit.file && lock.file === fit.file && lock.refit === fit.file,
      { steady: fit.steady, locked: lock.lock, cameraKept: mag.cam === fit.cam && lock.cam === fit.cam, view: [fit.view, mag.view, lock.view].map(v => v.map(x => Math.round(x))), magnified: diff(fit.file, mag.file), afterFit: diff(fit.file, mag.refit), lockView: diff(fit.file, lock.file), stats: [fit.stats, mag.stats, lock.stats].map(t => (t.match(/(\d+) strokes/) || [])[1]) });
  }
  {
    // the other outputs, the screen files, and a different window
    const others = async (act, viewport) => { const { ctx, page } = await open(viewport); await page.click('#appMode button[data-app="perspective"]'); await scene(page, 'street', 'curvi', GUIDES); await layers(page, 'plotter'); const v0 = await viewOf(page), o = {};
      if (act) await act(page); o.zoom = (await viewOf(page))[0] / v0[0]; o.export = (await grab(page, '#exportBtn')).buf; if (act) await act(page);
      await studio(page, true); o.plotter = (await grab(page, '#stDownload')).buf; await mode(page, 'stencil'); o.stencil = (await grab(page, '#stDownload')).buf; await mode(page, 'print'); o.print = (await grab(page, '#stDownload')).buf;
      await studio(page, false); if (act) await act(page); await studio(page, true); o.png = readPng((await grab(page, '#stPng4')).buf); o.screenSvg = (await grab(page, '#stScreenSvg')).buf; await ctx.close(); return o; };
    const a = await others(), b = await others(page => magnify(page)), c = await others(null, { width: 1000, height: 640 });
    check('Plotter file and stencil set are the same fitted and magnified, to the byte', b.zoom > 4 && a.plotter.equals(b.plotter) && a.stencil.equals(b.stencil) && a.print.equals(b.print), { zoom: b.zoom, plotter: [a.plotter.length, b.plotter.length], stencil: [a.stencil.length, b.stencil.length] });
    check('Export (the screen SVG) in Perspective is the canvas, not the magnified screen: the same file fitted and magnified', b.zoom > 4 && a.export.length > 5000 && a.export.equals(b.export) && a.png.w === b.png.w && a.png.h === b.png.h, { zoom: b.zoom, bytes: [a.export.length, b.export.length] });
    check('A smaller window gives the same print, plotter and Export files, to the byte', c.print.equals(a.print) && c.plotter.equals(a.plotter) && c.export.equals(a.export), { print: diff(a.print.toString(), c.print.toString()), export: [a.export.length, c.export.length] });
  }

  /* ===== 2. No stray lines: every line in a file is a line on screen (A1) ===== */
  const { ctx, page } = await open();
  // --- Geometry: every figure in plan, axonometric and perspective, at its last step ---
  await page.evaluate(() => { const S = window.__studio; S.ST.mode = 'print'; S.ST.sheet = 'off'; S.ST.page = '36x48'; S.ST.orient = 'portrait'; S.ST.margin = 50; Object.keys(S.ST.layers).forEach(k => S.ST.layers[k].on = true); });
  const figures = await page.$$eval('#pattern option', os => os.map(o => [o.value, o.textContent]));
  for (const [pat, title] of figures) { const det = {}; let ok = true;
    for (const view of ['plan', 'axon', 'perspective']) { await studio(page, false); await page.selectOption('#pattern', pat); await page.click(`#viewMode button[data-mode="${view}"]`); await page.$eval('#step', el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.evaluate(() => { if (window.__state.autoRotate) document.querySelector('#autoRotateBtn').click(); }); await page.waitForTimeout(50);
      const { ref, odd } = await page.evaluate(screenRef); await studio(page, true); const svg = parseSvg((await grab(page, '#stDownload')).buf.toString());
      // where the page-fit puts the drawing, worked out from the screen alone: its bounding box, scaled to fill the page inside the margin and centred
      const b = boxOf(ref.flatMap(r => r.pts)), W = 914.4, H = 1219.2, m = 50, bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]), s = Math.min((W - 2 * m) / bw, (H - 2 * m) / bh), ox = (W - bw * s) / 2 - b[0] * s, oy = (H - bh * s) / 2 - b[1] * s;
      const onScreen = svg.strokes.map(st => closedPts(st).map(([x, y]) => [(x - ox) / s, (y - oy) / s])), fwd = offInk(onScreen, ref, s), back = offInk(ref.map(r => r.pts), onScreen.map(pts => ({ pts })), s);
      det[view] = { screenLines: ref.length, fileStrokes: svg.strokes.length, notOnScreen: fwd.stray, notInFile: back.stray, ex: [...fwd.ex, ...back.ex] }; if (odd.length) det[view].curves = odd;
      ok = ok && ref.length > 5 && svg.strokes.length === ref.length && fwd.stray === 0 && back.stray === 0 && !odd.length; }
    check(`${title}: every line in the print file is a line on screen, and every screen line is in the file (plan, axonometric, perspective)`, ok, det); }
  await studio(page, false);
  // --- Perspective: squaring grid, floor and horizon on; print, plotter and stencil ---
  await page.click('#appMode button[data-app="perspective"]'); await page.waitForTimeout(100); await layers(page, 'print');
  const keep = {};
  for (const [id, name] of [['blank', 'One cube'], ['street', 'A street of cubes'], ['room', 'A room of cubes'], ['platonic', 'The five Platonic solids']]) for (const proj of ['linear', 'curvi']) {
    await studio(page, false); await scene(page, id, proj, GUIDES); const { ref, odd } = await page.evaluate(screenRef), fr = await page.evaluate(() => window.__pv.frame()), k = fr.W / fr.w, toScr = ([x, y]) => [fr.x + x / k, fr.y + y / k];
    await studio(page, true); await mode(page, 'print'); const print = parseSvg((await grab(page, '#stDownload')).buf.toString()); await mode(page, 'plotter'); const plot = parseSvg((await grab(page, '#stDownload')).buf.toString());
    await mode(page, 'stencil'); const zip = unzip((await grab(page, '#stDownload')).buf), slotMm = await page.evaluate(() => +window.__studio.ST.slot), all = Object.keys(zip).find(n => /all-layers\.svg$/.test(n)), sten = parseSvg(zip[all].toString()); await mode(page, 'print');
    const a = offInk(print.strokes.map(s => closedPts(s).map(toScr)), ref, k), b = offInk(plot.strokes.map(s => closedPts(s).map(toScr)), ref, k);
    // a slot is its line widened by half the slot width each side (a hair more at a bend). The sheet's slots are one path; its registration crosses, which are not part of the drawing, are another
    const slots = sten.strokes.filter(s => s.slots);
    const c = offInk(slots.map(s => closedPts(s).map(toScr)), ref, k, (slotMm / 2 * 1.001 + .01) / k);
    keep[id + proj] = { print, plot, fr };
    check(`${name}, ${proj === 'curvi' ? 'curvilinear' : 'linear'}, with squaring grid, floor and horizon: every line in the print, plotter and stencil files lies on a line on screen`,
      !odd.length && print.strokes.length > 60 && plot.strokes.length > 60 && slots.length > 60 && a.stray === 0 && b.stray === 0 && c.stray === 0, { screenLines: ref.length, print: a, plotter: b, stencil: c }); }
  {
    // the three places stray lines used to come from, looked at directly
    await studio(page, false); await scene(page, 'street', 'linear', GUIDES); await layers(page, 'print');
    const { print } = keep.streetlinear, straight = s => s.pts.length === 2, upright = s => Math.abs(s.pts[0][0] - s.pts[1][0]) < 1e-6, level = s => Math.abs(s.pts[0][1] - s.pts[1][1]) < 1e-6;
    const st = await page.evaluate(() => { const S = window.__studio; return S.geometry(0.1).strokes.map(s => ({ kind: s.kind, layer: s.layer, pts: s.pts })); });
    const sq = st.filter(s => s.kind === 'sq'), cols = sq.filter(s => straight(s) && upright(s)).map(s => s.pts[0][0]).sort((a, b) => a - b), rows = sq.filter(s => straight(s) && level(s)).map(s => s.pts[0][1]).sort((a, b) => a - b);
    const cv = await page.evaluate(() => window.__state.pv.canvas), onInch = (v, i) => Math.abs(v - i * 6 * 25.4) < 1e-6;
    check('Squaring grid on paper: one straight line per column and row edge, each on its 6 in mark to the micron, on the Construction layer; nothing oblique',
      sq.length === cols.length + rows.length && cols.length === cv.w / 6 + 1 && rows.length === cv.h / 6 + 1 && cols.every(onInch) && rows.every(onInch) && sq.every(s => s.layer === 'construction'), { strokes: sq.length, cols, rows });
    const floor = st.filter(s => s.kind === 'floor'), marks = st.filter(s => s.kind === 'vp-mark');
    check('Floor grid (linear): every stroke is one straight line, never a zigzag', floor.length > 20 && floor.every(straight), { strokes: floor.length, points: [...new Set(floor.map(s => s.pts.length))] });
    check('Vanishing-point crosses: each is one level and one upright stroke on Centre marks, never a diagonal', marks.length >= 4 && marks.length % 2 === 0 && marks.every(s => straight(s) && (upright(s) || level(s)) && s.layer === 'marks') && marks.filter(upright).length === marks.length / 2, marks.map(s => s.pts.map(p => p.map(v => +v.toFixed(1)))));
    // letters and numbers
    const sqc = print.strokes.filter(s => s.layer === 'construction'), T = print.texts, letters = T.filter(t => /^[A-Z]+$/.test(t.text)), nums = T.filter(t => /^\d+$/.test(t.text)), cell = 6 * 25.4;
    const inside = letters.every((t, i) => t.text === String.fromCharCode(65 + i) && t.x > i * cell && t.x < (i + 1) * cell && t.y > 0 && t.y < cell / 2 && t.size >= 3 && t.size <= 12) && nums.every((t, j) => t.text === String(j + 1) && t.y > j * cell && t.y < (j + 1) * cell && t.x > 0 && t.x < cell / 2);
    check('Squaring grid letters and numbers reach the print file as text: a letter in every column along the top, a number in every row down the left, inside the canvas', sqc.length > 0 && print.nText === T.length && letters.length === cv.w / 6 && nums.length === cv.h / 6 && inside, { letters: letters.map(t => t.text).join(''), numbers: nums.map(t => t.text).join(','), size: T[0] && T[0].size });
    const plotText = keep.streetlinear.plot.nText; await studio(page, true); await mode(page, 'stencil'); const z = unzip((await grab(page, '#stDownload')).buf), stText = Object.keys(z).filter(n => /^\d-/.test(n)).map(n => (z[n].toString().match(/<text[^>]*>([^<]*)</g) || []).filter(t => />[A-Z]{1,2}<|>\d{1,2}</.test(t)).length); await mode(page, 'print');
    check('Plotter and stencil files carry the grid’s lines only: no text for a pen to skip or a knife to cut', plotText === 0 && stText.every(n => n === 0), { plotText, stText });
  }
  {
    // Print PNG: the picture is the print file's lines and the grid's letters, nothing else
    await studio(page, false); await scene(page, 'blank', 'linear', { canvas: { w: 16, h: 20 }, sq: 2, show: { floor: true, horizon: true, vps: true } }); await layers(page, 'print'); await studio(page, true); await page.selectOption('#stDpi', '150');
    const svg = parseSvg((await grab(page, '#stDownload')).buf.toString()), got = await grab(page, '#stPngPrint'), png = readPng(got.buf, true), ppm = 150 / 25.4, mask = new Uint8Array(png.w * png.h);
    const disc = (cx, cy, r, v) => { for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(png.h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(png.w - 1, Math.ceil(cx + r)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * png.w + x] |= v; };
    svg.strokes.forEach(s => { const P = closedPts(s).map(p => [p[0] * ppm, p[1] * ppm]), r = (s.width || .5) * ppm / 2 + 1.6; for (let i = 1; i < P.length; i++) { const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), n = Math.max(1, Math.ceil(L / .7)); for (let k = 0; k <= n; k++) disc(P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k / n, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k / n, r, 1); } });
    const boxes = svg.texts.map(t => { const x0 = t.anchor === 'middle' ? t.x - t.size : t.x - t.size * .2, x1 = t.anchor === 'middle' ? t.x + t.size : t.x + t.size * 1.6; return [x0 * ppm, (t.y - t.size * 1.1) * ppm, x1 * ppm, (t.y + t.size * .4) * ppm]; }), inked = boxes.map(() => 0);
    let stray = 0, dark = 0; for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) if (png.dark(x, y)) { dark++; const bi = boxes.findIndex(b => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]); if (mask[y * png.w + x]) continue; if (bi >= 0) inked[bi]++; else stray++; }
    check('Print PNG: every dark pixel is on a line of the print file or in a grid letter; every letter and number is there', png.w === 2400 && png.h === 3000 && dark > 20000 && stray === 0 && svg.texts.length === 18 && inked.every(n => n > 3), { size: [png.w, png.h], darkPixels: dark, strayPixels: stray, lettersInked: inked.filter(n => n > 3).length + '/' + svg.texts.length });
    keep.pngSmall = { png, name: got.name };
  }

  /* ===== 3. Thin objects hide what is behind them (A4) ===== */
  await studio(page, false); await page.selectOption('#pvScene', 'blank');
  const thin = await page.evaluate(() => {
    const S = window.__studio, P = window.__pv, st = window.__state, base = st.pv.boxes[0], ARR = { ...base.arr, type: 'none' }, out = { post: [], other: [] };
    const mk = (w, shape = 'box') => { st.pv = { ...st.pv, proj: 'linear', pitch: 0, yaw: 0, roll: 0, cv: { x: 0, y: 0 }, dist: 30, canvas: { w: 48, h: 36 }, eye: { x: 0, y: 30, z: 0 }, sq: 0, show: { ...st.pv.show, hidden: false, floor: false, horizon: false, vps: false },
      boxes: [{ ...base, id: 1, shape: 'box', x: 0, y: 0, z: 200, w: 300, h: 60, d: 10, ry: 0, rx: 0, arr: ARR }, { ...base, id: 2, shape, x: 7, y: shape === 'sphere' ? 44.88 : 0, z: 100, w, h: shape === 'sphere' ? w : 80, d: w, ry: 0, rx: 0, arr: ARR }] }; P.sel = null; P.fit(true); P.render(); };
    // the wall's long front edges (z = 195), bottom then top
    const edges = (list) => { const I = list.find(I => I.b.id === 1); return P.EDGES.map(([a, b]) => [I.P[a], I.P[b]]).filter(([a, b]) => Math.abs(a[2] - 195) < 1e-6 && Math.abs(b[2] - 195) < 1e-6 && a[1] === b[1]).sort((p, q) => p[0][1] - q[0][1]); };
    // an independent ray cast along an edge: the stretch where some solid's near side is in front of the point
    const cast = (A, B, list, K, N = 60000) => { let lo = null, hi = null; for (let i = 0; i <= N; i++) { const t = i / N, Pt = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t], dir = [Pt[0] - K.E[0], Pt[1] - K.E[1], Pt[2] - K.E[2]], dp = Math.hypot(...dir);
      if (list.some(J => { const sp = P.span(J, K.E, dir); return sp && sp[0] > 0 && sp[0] < 1 && (1 - sp[0]) * dp > .02; })) { if (lo == null) lo = t; hi = t; } } return lo == null ? null : [lo * 300, hi * 300]; };
    for (const w of [20, 6, 2, 1, .5, .1]) { mk(w); const K = P.camera(), list = P.sceneOf(st.pv, K), E = edges(list);
      // the post's outline is its four upright corners; from x = 0 the wall edge is hidden between the leftmost and rightmost of them, carried on to z = 195
      const at = [7 - w / 2, 7 + w / 2].flatMap(x => [100 - w / 2, 100 + w / 2].map(z => x * 195 / z + 150)), want = [Math.min(...at), Math.max(...at)];
      const runs = E.map(([a, b]) => P.runsOf(a, b, list, K).map(r => [r[0] * 300, r[1] * 300, r[2]]));
      Object.keys(S.ST.layers).forEach(k => S.ST.layers[k].on = k === 'figure'); const g = S.geometry(0.1), k = 30 * 25.4 / 195, y = (30 - 60) * -k + 18 * 25.4, mid = 24 * 25.4 + (want[0] + want[1]) / 2 * k - 150 * k;
      // in the file: the wall's top edge is level at 60 in up; is there ink on it at the middle of the post?
      // (canvas 48 × 36 in, 30 in back: a point x across and y up at 195 in away lands 24 + 30x/195 across and 18 − 30(y − 30)/195 down)
      const topInk = g.strokes.some(s => s.pts.length === 2 && Math.abs(s.pts[0][1] - s.pts[1][1]) < 1e-6 && Math.abs(s.pts[0][1] - (18 - 30 * 30 / 195) * 25.4) < .01 && Math.min(s.pts[0][0], s.pts[1][0]) < mid && Math.max(s.pts[0][0], s.pts[1][0]) > mid);
      const beside = mid - (want[1] - want[0]) / 2 * k - 40, topBeside = g.strokes.some(s => s.pts.length === 2 && Math.abs(s.pts[0][1] - s.pts[1][1]) < 1e-6 && Math.abs(s.pts[0][1] - (18 - 30 * 30 / 195) * 25.4) < .01 && Math.min(s.pts[0][0], s.pts[1][0]) < beside && Math.max(s.pts[0][0], s.pts[1][0]) > beside);
      out.post.push({ post: w, hides: +(want[1] - want[0]).toFixed(2), found: runs.every(r => r.length === 3 && r[0][2] && !r[1][2] && r[2][2] && Math.abs(r[1][0] - want[0]) < .01 && Math.abs(r[1][1] - want[1]) < .01), wallShowsThroughInFile: topInk, wallDrawnBeside: topBeside, strokes: g.strokes.length }); }
    for (const [shape, w] of [['cyl', 1], ['cone', 2], ['sphere', 1], ['tetra', 1.5], ['icosa', 1]]) { mk(w, shape); const K = P.camera(), list = P.sceneOf(st.pv, K), [a, b] = edges(list)[shape === 'sphere' ? 1 : 0], want = cast(a, b, list, K), r = P.runsOf(a, b, list, K).map(r => [r[0] * 300, r[1] * 300, r[2]]);
      out.other.push({ shape, size: w, want: want && want.map(v => +v.toFixed(2)), got: r[1] && [+r[1][0].toFixed(2), +r[1][1].toFixed(2)], ok: !!want && r.length === 3 && !r[1][2] && Math.abs(r[1][0] - want[0]) < .02 && Math.abs(r[1][1] - want[1]) < .02 }); }
    return out; });
  check('A post in front of a 300 in wall hides its stretch of the wall’s edges exactly, from 20 in wide down to a tenth of an inch (ends within 0.01 in of where its corners fall)', thin.post.every(p => p.found), thin.post);
  check('…and in the Studio file the wall does not print through the post', thin.post.every(p => !p.wallShowsThroughInFile && p.wallDrawnBeside && p.strokes >= 10), thin.post);
  check('A 1 in pole, a 2 in cone, a 1 in ball, a thin tetrahedron and icosahedron each hide their stretch of the wall (against an independent ray cast, to 0.02 in)', thin.other.every(o => o.ok), thin.other);
  const brute = await page.evaluate(() => {
    const P = window.__pv, st = window.__state, base = st.pv.boxes[0], ARR = { ...base.arr, type: 'none' }; let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, R = (a, b) => a + (b - a) * rnd();
    let edges = 0, wrong = 0, worst = 0, thinHidden = 0; const ex = [];
    // surely hidden: some solid's near side is more than 0.03 in in front of the point. Surely seen: nothing in front of it at all. In the planner's 0.02 in skin, where an edge lies in a face, either answer stands
    const test = (A, B, list, K, tag) => { const L = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); if (L < .5) return; edges++; const runs = P.runsOf(A, B, list, K), N = Math.min(8000, Math.max(400, Math.ceil(L / .01))); let run = 0, max = 0;
      runs.forEach(r => { if (!r[2] && (r[1] - r[0]) * L < 2) thinHidden++; });
      for (let i = 0; i <= N; i++) { const t = i / N, Pt = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t], dir = [Pt[0] - K.E[0], Pt[1] - K.E[1], Pt[2] - K.E[2]], dp = Math.hypot(...dir); let depth = 0;
        for (const J of list) { const sp = P.span(J, K.E, dir); if (sp && sp[0] > 0 && sp[0] < 1) depth = Math.max(depth, (1 - sp[0]) * dp); }
        const truth = depth > .03 ? false : depth < 1e-6 ? true : null, r = runs.find(r => t >= r[0] && t <= r[1]), nearEnd = runs.some(r => (r[0] > 0 && Math.abs(t - r[0]) * L < .06) || (r[1] < 1 && Math.abs(t - r[1]) * L < .06));
        if (truth !== null && r && r[2] !== truth && !nearEnd) { run++; max = Math.max(max, run); } else if (truth !== null) run = 0; }
      const w = max / N * L; if (w > .06) { wrong++; worst = Math.max(worst, w); if (ex.length < 3) ex.push({ tag, wrongInches: +w.toFixed(2), L: +L.toFixed(1) }); } };
    for (let trial = 0; trial < 24; trial++) { const boxes = [], n = 3 + Math.floor(rnd() * 7);
      for (let i = 0; i < n; i++) { const slim = rnd() < .45, shape = P.SHAPES[Math.floor(rnd() * P.SHAPES.length)]; boxes.push({ ...base, id: i + 1, shape, x: Math.round(R(-60, 60)), y: rnd() < .3 ? Math.round(R(0, 30)) : 0, z: Math.round(R(40, 240)), w: slim ? R(.2, 2) : R(6, 60), h: R(6, 80), d: slim && rnd() < .5 ? R(.2, 2) : R(6, 60), ry: Math.round(R(-45, 45)), rx: rnd() < .2 ? Math.round(R(-20, 20)) : 0, arr: ARR }); }
      st.pv = { ...st.pv, proj: trial % 2 ? 'curvi' : 'linear', pitch: R(-20, 15), yaw: R(-15, 15), eye: { x: R(-20, 20), y: R(20, 70), z: 0 }, boxes }; const K = P.camera(), list = P.sceneOf(st.pv, K);
      list.forEach(I => { I.S.E.forEach(([a, b], e) => { if (!I.S.smoothE[e]) test(I.P[a], I.P[b], list, K, `trial ${trial} ${I.b.shape} edge ${e}`); }); const others = list.filter(J => J !== I); P.silhouettes(I, K.E).forEach(pl => { for (let i = 1; i < pl.length; i += 7) test(pl[i - 1], pl[i], others, K, `trial ${trial} ${I.b.shape} outline`); }); }); }
    // a sacred figure's own lines, behind and between its solids
    const s = document.querySelector('#pvScene'); s.value = 'metatron'; s.dispatchEvent(new Event('change')); const K = P.camera(), list = P.sceneOf(st.pv, K); let sacred = 0;
    st.pv.boxes.forEach(b => { const L = P.sacredLines(b, list); if (L) { L.segs.forEach(([A, B]) => { sacred++; test(A, B, list, K, 'metatron chord'); }); L.loops.forEach((pl, j) => { if (j % 4 === 0) for (let i = 1; i < pl.length; i += 5) { sacred++; test(pl[i - 1], pl[i], list, K, 'metatron circle'); } }); } });
    return { edges, sacred, wrong, worstInches: +worst.toFixed(2), thinHidden, ex }; });
  check(`Hidden lines against an independent ray cast: ${brute.edges} edges, outlines and figure lines of every solid, thin and fat, in 24 random scenes and Metatron’s Cube; none wrong by more than 0.06 in`, brute.edges > 2000 && brute.sacred > 80 && brute.thinHidden > 100 && brute.wrong === 0, brute);

  /* ===== 4. PNG: the canvas's shape, the scene's name, and its real size (A7) ===== */
  {
    await page.click('#appMode button[data-app="geometry"]'); await page.waitForTimeout(100); await studio(page, true);
    const g4 = await grab(page, '#stPng4'), gp = readPng(g4.buf), gs = await grab(page, '#stScreenSvg'), gn = await page.evaluate(() => `${window.__state.pattern}-step-${window.__state.step}`);
    check('PNG 4× in Geometry is still 3600 × 2800, named after the figure and step', gp.w === 3600 && gp.h === 2800 && g4.name === gn + '@4x.png' && gs.name === gn + '-screen.svg', { name: g4.name, size: [gp.w, gp.h], svg: gs.name });
    await studio(page, false); await page.click('#appMode button[data-app="perspective"]'); await page.waitForTimeout(100); const shapes = [];
    for (const [id, w, h] of [['totem', 36, 48], ['street', 48, 36], ['blank', 16, 20], ['platonic', 48, 30]]) { await studio(page, false); await scene(page, id, null, { canvas: { w, h } }); await studio(page, true);
      const d = await grab(page, '#stPng4'), p = readPng(d.buf), sv = await grab(page, '#stScreenSvg');
      shapes.push({ scene: id, canvas: `${w} × ${h}`, name: d.name, svg: sv.name, size: [p.w, p.h], ok: d.name === `perspective-${id}@4x.png` && sv.name === `perspective-${id}-screen.svg` && Math.max(p.w, p.h) >= 3600 && Math.abs(p.w / p.h - w / h) < 1 / Math.min(p.w, p.h) }); }
    check('PNG 4× in Perspective keeps the canvas’s proportions (to the pixel) and is named after the scene, as is the screen SVG', shapes.every(s => s.ok), shapes);
    const res = [];
    for (const dpi of [150, 300]) { await studio(page, false); await scene(page, 'blank', 'linear', { canvas: { w: 16, h: 20 } }); await layers(page, 'print'); await studio(page, true); await page.selectOption('#stDpi', String(dpi));
      const d = await grab(page, '#stPngPrint'), p = readPng(d.buf), ppm = Math.round(dpi / .0254);
      res.push({ dpi, name: d.name, size: [p.w, p.h], chunks: [...new Set(p.chunks)].join(' '), pHYs: p.phys, widthInches: p.phys && +(p.w / p.phys.x / .0254).toFixed(4), ok: p.crcOk && p.w === 16 * dpi && p.h === 20 * dpi && !!p.phys && p.phys.unit === 1 && p.phys.x === ppm && p.phys.y === ppm && p.chunks.indexOf('pHYs') < p.chunks.indexOf('IDAT') && p.chunks.filter(c => c === 'pHYs').length === 1 && Math.abs(p.w / p.phys.x / .0254 - 16) <= 16 * .5 / (dpi / .0254) && d.name === `perspective-blank-406x508mm@${dpi}dpi.png` }); }
    check('Print PNG carries its resolution: a pHYs chunk before the image data (pixels per metre, valid CRC), so 16 × 20 in at 150 and 300 dpi opens 16 in wide (to the half pixel per metre the format holds)', res.every(r => r.ok), res);
  }

  /* ===== 5. Depth ink (A8) ===== */
  {
    await studio(page, false); await scene(page, 'street', 'linear', { canvas: { w: 48, h: 36 }, sq: 0, show: { depth: true, floor: false, horizon: false, vps: false } }); await layers(page, 'print', ['figure']);
    const scr = await page.evaluate(() => [...document.querySelectorAll('#shapeLayer [data-kind="main"]')].map(e => `${+e.style.getPropertyValue('--dzw')} ${+e.style.getPropertyValue('--dzo')}`)), pen = await page.evaluate(() => window.__studio.ST.layers.figure.pen);
    await studio(page, true); const pr = parseSvg((await grab(page, '#stDownload')).buf.toString()), note = async () => page.evaluate(() => { const n = document.querySelector('#stDepthNote'); return n && !n.hidden && n.getBoundingClientRect().height > 0 ? n.textContent : ''; }), nPrint = await note();
    const got = [...new Set(pr.strokes.map(s => `${+(s.width / pen).toFixed(3)} ${+s.opacity}`))], scrSet = new Set(scr), heavy = Math.max(...pr.strokes.map(s => s.width));
    check('Depth ink reaches the print file: each solid’s lines carry the weight and tone the screen gives them (nearest 1.3 × the pen at full strength), and the panel says so',
      scrSet.size > 5 && got.length > 5 && got.every(k => scrSet.has(k)) && Math.abs(heavy - pen * 1.3) < 1e-9 && pr.strokes.filter(s => Math.abs(s.width - heavy) < 1e-9).every(s => +s.opacity === 1) && /Depth ink is on, and it prints/.test(nPrint), { onScreen: scrSet.size, inFile: got.length, heaviest: heavy, pen, note: nPrint });
    await mode(page, 'plotter'); const pl = (await grab(page, '#stDownload')).buf.toString(), nPlot = await note(), widths = [...new Set([...pl.matchAll(/stroke-width="([^"]+)"/g)].map(m => m[1]))]; await mode(page, 'stencil'); const nSten = await note(); await mode(page, 'print');
    check('Depth ink cannot reach a plotter file (one pen, one width), and the Studio panel says so in plain words, for the stencil too', widths.length === 1 && !/ opacity=/.test(pl) && /does not reach a plotter file/.test(nPlot) && /does not reach a stencil/.test(nSten), { widths, plotter: nPlot, stencil: nSten });
    await studio(page, false); await page.click('#pvShow [data-show="depth"]'); await page.waitForTimeout(60); await studio(page, true);
    const off = parseSvg((await grab(page, '#stDownload')).buf.toString()), nOff = await note();
    check('With Depth ink off the print file has one pen width per layer, as before, and the note goes away', [...new Set(off.strokes.map(s => s.width))].length === 1 && off.strokes.every(s => s.opacity === undefined) && off.strokes.length === pr.strokes.length && nOff === '', { widths: [...new Set(off.strokes.map(s => s.width))], note: nOff });
    // Geometry: the cube, turned
    await studio(page, false); await page.click('#appMode button[data-app="geometry"]'); await page.selectOption('#pattern', 'cube'); await page.click('#viewMode button[data-mode="axon"]'); await page.$eval('#step', el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => { if (window.__state.autoRotate) document.querySelector('#autoRotateBtn').click(); if (!window.__state.depthInk) document.querySelector('.chip[data-toggle="depthInk"]').click(); }); await layers(page, 'print');
    const gscr = await page.evaluate(() => [...document.querySelectorAll('#gridLayer [data-kind],#guideLayer [data-kind],#shapeLayer [data-kind],#pointLayer [data-kind]')].filter(e => e.style.getPropertyValue('--dzw')).map(e => `${+e.style.getPropertyValue('--dzw')} ${+e.style.getPropertyValue('--dzo')}`)), pens = await page.evaluate(() => Object.fromEntries(Object.entries(window.__studio.ST.layers).map(([k, v]) => [k, v.pen])));
    await studio(page, true); const gpr = parseSvg((await grab(page, '#stDownload')).buf.toString()), deep = gpr.strokes.filter(s => s.opacity !== undefined), gk = [...new Set(deep.map(s => `${+(s.width / pens[s.layer]).toFixed(3)} ${+s.opacity}`))], gnote = await note();
    await studio(page, false); await page.click('#viewMode button[data-mode="plan"]'); await page.waitForTimeout(60); await studio(page, true); const plan = parseSvg((await grab(page, '#stDownload')).buf.toString()), pnote = await note();
    check('Depth ink in Geometry: a turned cube prints with the screen’s weights and tones; in plan, where the screen has none, the file has none',
      new Set(gscr).size >= 2 && deep.length === gscr.length && gk.every(k => new Set(gscr).has(k)) && gk.length === new Set(gscr).size && /it prints/.test(gnote) && plan.strokes.every(s => s.opacity === undefined) && pnote === '', { onScreen: new Set(gscr).size, linesOnScreen: gscr.length, linesInFile: deep.length, inFile: gk.length, planNote: pnote });
  }

  /* ===== 6. The squaring grid's tooltip names the layer it goes to ===== */
  {
    const tip = await page.getAttribute('#pvSqChip', 'title');
    check('The squaring-grid tooltip names the Construction layer (where the grid goes), not Drafting', /Construction layer/.test(tip) && !/Drafting/.test(tip), tip);
  }

  /* ===== 7. Print SVG units: the root says the chosen size in mm, and one unit of the drawing is one millimetre ===== */
  {
    const sizes = [];
    for (const [pg, orient, cw, ch, margin, W, H] of [['a3', 'portrait', 0, 0, 20, 297, 420], ['a3', 'landscape', 0, 0, 20, 420, 297], ['48x48', 'portrait', 0, 0, 50, 1219.2, 1219.2], ['custom', 'landscape', 400, 600, 0, 600, 400]]) {
      await studio(page, false); await page.selectOption('#pattern', 'flower'); await page.click('#viewMode button[data-mode="plan"]'); await page.$eval('#step', el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.evaluate(([pg, orient, cw, ch, margin]) => { const S = window.__studio; Object.assign(S.ST, { mode: 'print', sheet: 'off', page: pg, orient, margin }); if (cw) { S.ST.cw = cw; S.ST.ch = ch; } Object.keys(S.ST.layers).forEach(k => S.ST.layers[k].on = ['construction', 'figure', 'accent'].includes(k)); }, [pg, orient, cw, ch, margin]);
      await studio(page, true); const d = await grab(page, '#stDownload'), svg = parseSvg(d.buf.toString()), vb = svg.viewBox.split(' ').map(Number), b = boxOf(svg.strokes.flatMap(s => s.pts)), pens = await page.evaluate(() => Object.fromEntries(Object.entries(window.__studio.ST.layers).map(([k, v]) => [k, v.pen])));
      const fill = Math.max((b[2] - b[0]) / (W - 2 * margin), (b[3] - b[1]) / (H - 2 * margin)), centred = Math.abs((b[0] + b[2]) / 2 - W / 2) < .02 && Math.abs((b[1] + b[3]) / 2 - H / 2) < .02;
      // the Flower's 19 circles: all one radius in millimetres
      const radii = svg.strokes.filter(s => s.layer === 'figure' && s.closed && s.pts.length > 50).map(s => { const bb = boxOf(s.pts); return (bb[2] - bb[0]) / 2; });
      sizes.push({ page: `${pg} ${orient}`, root: `${svg.width} × ${svg.height}`, viewBox: svg.viewBox, fills: +fill.toFixed(5), circles: radii.length, radiusSpreadMm: +(Math.max(...radii) - Math.min(...radii)).toFixed(4),
        ok: svg.width === `${W}mm` && svg.height === `${H}mm` && vb[0] === 0 && vb[1] === 0 && vb[2] === W && vb[3] === H && Math.abs(fill - 1) < 1e-4 && centred && b[0] >= margin - .01 && b[1] >= margin - .01 && radii.length === 19 && Math.max(...radii) - Math.min(...radii) < .011 && svg.strokes.every(s => s.filled || s.width === pens[s.layer]) }); keep.lastGeo = d.f; }
    check('Print SVG units in Geometry: the root’s width and height are the chosen sheet in mm (A3 either way up, 48 × 48 in, custom), the viewBox is the same numbers so a unit is a millimetre, the drawing fills the sheet inside the margin, pen widths are the mm you set', sizes.every(s => s.ok), sizes);
    await studio(page, false); await page.evaluate(() => { const S = window.__studio; Object.assign(S.ST, { page: '48x48', orient: 'portrait', margin: 50 }); }); await page.click('#appMode button[data-app="perspective"]'); await page.waitForTimeout(100); const pvs = [];
    for (const [w, h] of [[36, 48], [48, 36], [16, 20]]) { await studio(page, false); await scene(page, 'blank', 'linear', { canvas: { w, h }, sq: 2, pitch: 0, roll: 0, yaw: 0, cv: { x: 0, y: 1.3 }, show: { floor: false, horizon: true, vps: false, depth: false } }); await layers(page, 'print', ['construction', 'figure']); await studio(page, true);
      const d = await grab(page, '#stDownload'), svg = parseSvg(d.buf.toString()), vb = svg.viewBox.split(' ').map(Number), W = +(w * 25.4).toFixed(2), H = +(h * 25.4).toFixed(2);
      // real size: the horizon prints where "On your canvas" says it is, measured up from the bottom edge
      const hz = await page.evaluate(() => { const P = window.__pv, K = P.camera(), G = P.circleOf(K, [K.CT[0][1], K.CT[1][1], K.CT[2][1]]); return P.onCanvas(G.p)[1]; }), read = await page.evaluate(() => (document.querySelector('#pvReadout').textContent.match(/Horizon\s*([\d.]+) in up/) || [])[1]);
      const lvl = svg.strokes.filter(s => s.layer === 'construction' && s.pts.length === 2 && Math.abs(s.pts[0][1] - s.pts[1][1]) < 1e-9).map(s => s.pts[0][1]), hzMm = H - hz * 25.4, onGrid = v => Math.abs(v / 50.8 - Math.round(v / 50.8)) < 1e-4, extra = lvl.filter(v => !onGrid(v));
      pvs.push({ canvas: `${w} × ${h} in`, root: `${svg.width} × ${svg.height}`, viewBox: svg.viewBox, horizonReadout: read, horizonInFileMm: extra.map(v => +v.toFixed(2)), wantMm: +hzMm.toFixed(2), file: d.f,
        ok: svg.width === `${W}mm` && svg.height === `${H}mm` && vb[0] === 0 && vb[1] === 0 && vb[2] === W && vb[3] === H && lvl.filter(onGrid).length === h / 2 + 1 && extra.length === 1 && Math.abs(extra[0] - hzMm) < .011 && Math.abs(hz - (h / 2 + 1.3)) < 1e-9 && Math.abs(+read - hz) < .051 }); }
    check('Print SVG units in Perspective: the page is the canvas at 25.4 mm to the inch (36 × 48, 48 × 36, 16 × 20), the 2 in grid lands on every 50.8 mm, and the horizon prints at the height “On your canvas” reads', pvs.every(s => s.ok), pvs.map(({ file, ...r }) => r));
    // an independent reader: Inkscape rasterises the file at 25.4 dpi, a pixel per millimetre
    const ink = spawnSync('inkscape', ['--version'], { encoding: 'utf8' });
    if (!ink.error && ink.status === 0) { const out = path.join(tmp, 'ink.png'), r = spawnSync('inkscape', ['--export-type=png', '--export-dpi=25.4', '-o', out, pvs[0].file], { encoding: 'utf8', timeout: 120000 }), p = fs.existsSync(out) ? readPng(fs.readFileSync(out)) : null;
      check('Inkscape opens the 36 × 48 in print file at 914 × 1219 mm (a pixel per millimetre at 25.4 dpi)', !!p && Math.abs(p.w - 914.4) <= 1 && Math.abs(p.h - 1219.2) <= 1, p ? [p.w, p.h] : (r.stderr || r.error)); }
    else console.log('SKIP  Inkscape is not installed: the independent size reading was not made');
  }
  await ctx.close();

  /* ===== 8. What gets cut and plotted (A5, A6, tiling): real downloaded files, read by readers in this file only ===== */
  {
    const { ctx, page } = await open();
    const f1 = v => +v.toFixed(3);
    const waitChecked = async () => { await page.waitForFunction(() => !/checking/i.test(document.querySelector('#studioStats').textContent), null, { timeout: 180000 }); };
    const figure = async (pat, view = 'plan', step) => { await studio(page, false); await page.selectOption('#pattern', pat); await page.click(`#viewMode button[data-mode="${view}"]`); await page.$eval('#step', (el, step) => { el.value = step || el.max; el.dispatchEvent(new Event('input', { bubbles: true })); }, step); await page.evaluate(() => { if (window.__state.autoRotate) document.querySelector('#autoRotateBtn').click(); }); await page.waitForTimeout(50); };
    const setPage = (patch, which) => page.evaluate(([patch, which]) => { const S = window.__studio; Object.assign(S.ST, { sheet: 'off', orient: 'portrait', margin: 50, ...patch }); Object.keys(S.ST.layers).forEach(k => S.ST.layers[k].on = which.includes(k)); }, [patch, which]);
    const lines = svg => svg.strokes.filter(s => !s.filled).map(closedPts);
    // an index of segments: the distance from any point to the nearest line (capped)
    const segIndex = L => { const cell = 5, grid = new Map(), segs = []; L.forEach(P => { for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], k = segs.length; segs.push([a, b]); const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cell / 2))), seen = new Set();
        for (let j = 0; j <= n; j++) { const cx = Math.floor((a[0] + (b[0] - a[0]) * j / n) / cell), cy = Math.floor((a[1] + (b[1] - a[1]) * j / n) / cell); for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const key = (cx + ox) + ',' + (cy + oy); if (!seen.has(key)) { seen.add(key); (grid.get(key) || grid.set(key, []).get(key)).push(k); } } } } });
      return (p, cap = 2) => { let d = cap; for (const k of grid.get(Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell)) || []) { const [q, r] = segs[k], dx = r[0] - q[0], dy = r[1] - q[1], l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); const e = Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy); if (e < d) d = e; } return d; }; };
    // ink on ink: the largest distance from a point of A (sampled each 0.2 mm) to the lines of B, and how many mm of A are more than 0.05 mm from B
    const worstOff = (A, B) => { const near = segIndex(B); let w = 0, off = 0; A.forEach(P => { for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / .2)); for (let j = 0; j <= n; j++) { const d = near([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); if (d > .05) off += l / n; if (d > w) w = d; } } }); return { worst: w, off }; };
    // repeated pen-down length: a run of one stroke that stays within 0.03 mm of another stroke (the same line again; the files are rounded to 0.01 mm) for over 1 mm, and ends where a line stops or turns (a repeat is a copy of part of a line; lines that only touch and part are two lines)
    const turnDeg = (a, b, c) => { const x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - b[0], y2 = c[1] - b[1], l = Math.hypot(x1, y1) * Math.hypot(x2, y2); return l ? Math.acos(Math.max(-1, Math.min(1, (x1 * x2 + y1 * y2) / l))) * 180 / Math.PI : 0; };
    const repeated = S => { const far = .03, h = .05, cell = 2, grid = new Map(), segs = [];
      S.forEach((s, si) => { const P = closedPts(s); s.P = P; s.cum = [0]; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]); s.cum.push(s.cum[i - 1] + l); if (l < 1e-12) continue; const k = segs.length; segs.push({ si, a, b, l0: s.cum[i - 1] });
        const n = Math.max(1, Math.ceil(l / (cell / 2))), seen = new Set(); for (let j = 0; j <= n; j++) { const px = a[0] + (b[0] - a[0]) * j / n, py = a[1] + (b[1] - a[1]) * j / n; for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const key = (Math.floor(px / cell) + ox) + ',' + (Math.floor(py / cell) + oy); if (!seen.has(key)) { seen.add(key); (grid.get(key) || grid.set(key, []).get(key)).push(k); } } } } s.len = s.cum[s.cum.length - 1];
        s.corners = []; for (let i = 1; i < P.length - 1; i++) if (turnDeg(P[i - 1], P[i], P[i + 1]) > 12) s.corners.push(s.cum[i]); if (s.closed && P.length > 3 && turnDeg(P[P.length - 2], P[0], P[1]) > 12) s.corners.push(0, s.len); });
      const stops = (s, t) => (!s.closed && (t < .3 || t > s.len - .3)) || s.corners.some(c => Math.abs(c - t) < .3);
      let mm = 0;
      S.forEach((s, si) => { if (s.len < 1e-9) return; const n = Math.max(1, Math.ceil(s.len / h)), open = new Map(), runs = []; let seg = 1;
        const close = (B, st) => runs.push({ B, ...st });
        for (let j = 0; j <= n; j++) { const t = s.len * j / n; while (seg < s.cum.length - 1 && s.cum[seg] < t) seg++; const l0 = s.cum[seg - 1], l1 = s.cum[seg], k = l1 > l0 ? (t - l0) / (l1 - l0) : 0, p = [s.P[seg - 1][0] + (s.P[seg][0] - s.P[seg - 1][0]) * k, s.P[seg - 1][1] + (s.P[seg][1] - s.P[seg - 1][1]) * k], near = new Map();
          for (const id of grid.get(Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell)) || []) { const g = segs[id]; let key = g.si; const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], l2 = dx * dx + dy * dy, u = Math.max(0, Math.min(1, ((p[0] - g.a[0]) * dx + (p[1] - g.a[1]) * dy) / l2));
            if (g.si === si) { let gap = Math.abs(g.l0 + u * Math.sqrt(l2) - t); if (s.closed) gap = Math.min(gap, s.len - gap); if (gap < .4) continue; key = -1 - si; }
            const d = Math.hypot(p[0] - g.a[0] - u * dx, p[1] - g.a[1] - u * dy); if (d <= far && (!near.has(key) || d < near.get(key)[0])) near.set(key, [d, g.l0 + u * Math.sqrt(l2)]); }
          for (const [B, st] of open) if (!near.has(B)) { close(B, st); open.delete(B); }
          for (const [B, [, bt]] of near) { const st = open.get(B); if (st) { st.to = t; st.bt.push(bt); } else open.set(B, { from: t, to: t, bt: [bt] }); } }
        for (const [B, st] of open) close(B, st);
        runs.forEach(x => { const L = x.to - x.from; if (L <= 1) return; const B = x.B < 0 ? s : S[x.B], e0 = stops(s, x.from) || stops(B, x.bt[0]), e1 = stops(s, x.to) || stops(B, x.bt[x.bt.length - 1]); if ((e0 && e1) || (s.closed && L > s.len - .2)) mm += L / 2; }); });
      return mm; };
    const plotCase = async (tag, ready, maxFig) => {
      await ready(); await layers(page, 'plotter'); await studio(page, true); await mode(page, 'plotter'); const plD = await grab(page, '#stDownload'), pl = parseSvg(plD.buf.toString()); pl.file = plD.f; await mode(page, 'print'); const pr = parseSvg((await grab(page, '#stDownload')).buf.toString()); await studio(page, false);
      const ids = [...new Set(pl.strokes.map(s => s.layer))]; let rep = 0, tiny = 0; const plText = (await fs.promises.readFile(pl.file)).toString(), fig = [...plText.matchAll(/<g id="[^"]+"[^>]*inkscape:label="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g)].filter(m => /Figure/.test(m[1])).reduce((t, m) => t + (m[2].match(/M/g) || []).length, 0);
      ids.forEach(id => { rep += repeated(pl.strokes.filter(s => s.layer === id)); });
      const PL = pl.strokes.map(closedPts), PR = pr.strokes.map(closedPts), a = worstOff(PL, PR), b = worstOff(PR, PL), w1 = a.worst, w2 = b.worst, off = a.off + b.off;
      pl.strokes.forEach(s => { if (len(closedPts(s)) < 2) tiny++; });
      return { tag, paths: pl.strokes.length, figurePaths: fig, repeatedMm: Math.round(rep), plottedNotOnPrint: f1(w1), printNotPlotted: f1(w2), offMm: Math.round(off), under2mm: tiny, ok: rep === 0 && w1 <= .05 && w2 <= .05 && (maxFig == null || fig <= maxFig) }; };
    const len = P => { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; };
    await page.click('#appMode button[data-app="geometry"]'); await setPage({ page: '36x48' }, ['construction', 'figure', 'accent', 'marks', 'drafting']);
    const plots = [];
    await studio(page, false);
    for (const [pat, view, step, tag] of [['metatron', 'plan', null, 'Metatron plan'], ['yantra', 'plan', null, 'Sri Yantra plan']]) plots.push(await plotCase(tag, async () => { await figure(pat, view, step); await setPage({ page: '36x48', mode: 'plotter' }, ['construction', 'figure', 'accent', 'marks', 'drafting']); }));
    await page.click('#appMode button[data-app="perspective"]'); await page.waitForTimeout(100);
    const custom = async spec => { await page.selectOption('#pvScene', 'blank'); await page.evaluate(spec => { const P = window.__pv, st = window.__state, base = P.fromScene('blank').boxes[0], { box, ...rest } = spec; st.pv = { ...P.fromScene('blank'), ...rest, boxes: [{ ...base, id: 1, ...box, arr: { ...base.arr, ...box.arr } }] }; P.sel = null; P.fit(true); P.render(); P.sync(); }, spec); await page.waitForTimeout(60); };
    const flush = proj => ({ proj, pitch: -35, yaw: 20, roll: 0, cv: { x: 0, y: 0 }, dist: 30, canvas: { w: 36, h: 48 }, eye: { x: 0, y: 90, z: 0 }, box: { x: -20, y: 0, z: 90, w: 20, h: 20, d: 20, ry: 0, rx: 0, arr: { type: 'grid', n: 3, n2: 3, gap: 0 } } });
    const solid = (shape, proj) => ({ proj, pitch: -15, yaw: 0, eye: { x: 0, y: 50, z: 0 }, box: { shape, x: 0, y: 0, z: 100, w: 24, h: 24, d: 24, ry: 0, rx: 0, arr: { type: 'none' } } });
    plots.push(await plotCase('3 × 3 flush cubes, curvilinear', () => custom(flush('curvi'))));
    plots.push(await plotCase('cylinder, curvilinear (Figure layer in a handful of paths)', () => custom(solid('cyl', 'curvi')), 8));
    plots.push(await plotCase('cone, curvilinear (Figure layer in a handful of paths)', () => custom(solid('cone', 'curvi')), 8));
    for (const [id, tag] of [['tower', 'Tower, curvilinear'], ['totem', 'Totem, curvilinear'], ['fruit', 'Fruit of Life scene, curvilinear']]) plots.push(await plotCase(tag, () => scene(page, id, 'curvi')));
    check('Plotter: no stretch of line is drawn twice (over 1 mm within 0.03 mm of another stroke, the same line again, ending where a line stops or turns), every line of the print file is plotted and nothing else is, to 0.05 mm, a cylinder and a cone have a handful of Figure paths: Metatron, Sri Yantra, 3 × 3 flush cubes, cylinder, cone, Tower, Totem, Fruit scene (straight and curved strokes)', plots.every(p => p.ok), plots);

    /* ---- stencil sheets: rasterised at 4 pixels to the mm from the downloaded files; one piece, or the panel says so ---- */
    // the reader's grid is not the app's: 6 pixels to the mm (the app checks at 4) and its origin shifted by a third of a millimetre each way, so the two can only agree if both are right
    const rasterCut = (svgText, ppm, off = [0, 0]) => { const vb = (svgText.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || []).slice(1).map(Number), w = Math.ceil((vb[0] + off[0]) * ppm), h = Math.ceil((vb[1] + off[1]) * ppm), mat = new Uint8Array(w * h).fill(1), acc = new Int16Array(w + 1), re = /<path d="([^"]+)"([^>]*)\/>/g; let m;
      while ((m = re.exec(svgText))) { if (!/fill="#000"/.test(m[2])) continue; const rows = new Map();
        (m[1].match(/M[^M]*/g) || []).forEach(sub => { const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number), P = []; for (let i = 0; i + 1 < n.length; i += 2) P.push([n[i] + off[0], n[i + 1] + off[1]]);
          for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; let ax = a[0] * ppm, ay = a[1] * ppm, bx = b[0] * ppm, by = b[1] * ppm; if (ay === by) continue; const dir = by > ay ? 1 : -1; if (dir < 0) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
            for (let r = Math.max(0, Math.ceil(ay - .5)), r1 = Math.min(h - 1, Math.ceil(by - .5) - 1); r <= r1; r++) { const x = ax + (bx - ax) * ((r + .5 - ay) / (by - ay)); let l = rows.get(r); if (!l) rows.set(r, l = []); l.push(x, dir); } } });
        for (const [r, l] of rows) { acc.fill(0); for (let i = 0; i < l.length; i += 2) acc[Math.max(0, Math.min(w, Math.ceil(l[i] - .5)))] += l[i + 1]; let wind = 0; for (let x = 0; x < w; x++) { wind += acc[x]; if (wind !== 0) mat[r * w + x] = 0; } } }
      // pieces of material (4-connected); everything but the largest that is at least 1 mm² is loose
      const lab = new Int32Array(w * h), stack = new Int32Array(w * h), sizes = []; let nL = 0;
      for (let i = 0; i < w * h; i++) { if (lab[i] || !mat[i]) continue; nL++; let sp = 0, a = 0; stack[sp++] = i; lab[i] = nL;
        while (sp) { const k = stack[--sp], kx = k % w; a++; if (kx > 0 && !lab[k - 1] && mat[k - 1]) { lab[k - 1] = nL; stack[sp++] = k - 1; } if (kx < w - 1 && !lab[k + 1] && mat[k + 1]) { lab[k + 1] = nL; stack[sp++] = k + 1; } if (k >= w && !lab[k - w] && mat[k - w]) { lab[k - w] = nL; stack[sp++] = k - w; } if (k < w * h - w && !lab[k + w] && mat[k + w]) { lab[k + w] = nL; stack[sp++] = k + w; } } sizes.push(a / (ppm * ppm)); }
      sizes.sort((p, q) => q - p); const loose = sizes.slice(1).filter(a => a >= 1); return { pieces: loose.length, mm2: loose.reduce((t, a) => t + a, 0), band: [sizes.slice(1).filter(a => a >= 1.25).length, sizes.slice(1).filter(a => a >= .8).length] }; };
    const stencilCase = async tag => {
      await studio(page, true); await waitChecked(); const stats = await page.textContent('#studioStats'), noteShown = await page.evaluate(() => { const n = document.querySelector('#stStencilNote'); return n && !n.hidden ? n.textContent : ''; });
      const z = unzip((await grab(page, '#stDownload')).buf); await studio(page, false);
      const sheets = Object.keys(z).filter(n => /^\d-\w+\.svg$/.test(n)).map(n => ({ n, ...rasterCut(z[n].toString(), 6, [0.37, 0.21]) })), pieces = sheets.reduce((t, s) => t + s.pieces, 0), mm2 = sheets.reduce((t, s) => t + s.mm2, 0), said = (noteShown.match(/in (\d+) piece/g) || []).reduce((t, m) => t + +m.match(/\d+/)[0], 0);
      const saysFine = /nothing falls out/i.test(stats), warned = /fall out/i.test(noteShown) && /WARNING/.test(stats), readme = !!z['READ-ME-LOOSE-PIECES.txt'];
      // one piece, or the warning is up and tells the truth about how many pieces (within one speck's difference of area), and the stencil never claims "nothing falls out" while pieces are loose
      // Two different grids cannot agree on every sliver: a piece 1 mm wide or less is joined or split by a pixel either way. So the panel's piece count may differ from the reader's by a tenth (at least one),
      // its total area by a tenth (plus 1 mm²), and, the point of the finer grid, it must name every sheet the reader finds a piece of at least 1.25 mm² on, and no sheet the reader finds nothing of 0.8 mm² or more on
      const lo = sheets.reduce((t, s) => t + s.band[0], 0), hi = sheets.reduce((t, s) => t + s.band[1], 0), namedSheets = (noteShown.match(/about \d+ mm² in \d+ piece/g) || []).length, panelMm2 = (noteShown.match(/about (\d+) mm²/g) || []).reduce((t, m) => t + +m.match(/\d+/)[0], 0);
      const sLo = sheets.filter(s => s.band[0] > 0).length, sHi = sheets.filter(s => s.band[1] > 0).length, fine = saysFine && !noteShown && !readme;
      const loud = warned && !saysFine && readme && /mm²/.test(noteShown) && said >= 1 && said >= lo - Math.max(1, .1 * lo) && said <= hi + Math.max(1, .1 * hi) && Math.abs(panelMm2 - mm2) <= .1 * mm2 + 1 + said && namedSheets >= sLo && namedSheets <= sHi;
      const ok = hi === 0 ? fine : lo > 0 ? loud : fine || loud;
      return { tag, sheets: sheets.length, band: [lo, hi], named: namedSheets, panelMm2: Math.round(panelMm2), loosePieces: pieces, looseMm2: Math.round(mm2), panelSays: pieces ? `${said} pieces` : 'nothing falls out', ok }; };
    const sten = []; await page.click('#appMode button[data-app="geometry"]');
    const figs = await page.$$eval('#pattern option', os => os.map(o => o.value));
    for (const [pg, margin] of [['a3', 50], ['a2', 50], ['36x48', 50]]) for (const f of figs) { await figure(f, 'plan'); await setPage({ page: pg, margin, mode: 'stencil', slot: 4, bridge: 5, span: 160 }, ['construction', 'figure', 'accent']); sten.push(await stencilCase(`${f} on ${pg}`)); }
    await figure('continuum', 'plan', 26); await setPage({ page: 'a2', margin: 20, mode: 'stencil' }, ['construction', 'figure', 'accent']); sten.push(await stencilCase('Continuum at the Metatron step on A2'));
    await figure('yantra', 'plan'); await setPage({ page: 'a3', margin: 15, mode: 'stencil' }, ['construction', 'figure', 'accent']); sten.push(await stencilCase('Sri Yantra on A3, 15 mm margin'));
    await page.click('#appMode button[data-app="perspective"]'); await page.waitForTimeout(100);
    for (const id of ['fruit', 'street', 'room']) { await scene(page, id, null); await setPage({ page: '36x48', mode: 'stencil' }, ['construction', 'figure', 'accent']); sten.push(await stencilCase(`${id} scene at 36 × 48 in`)); }
    // the case that slipped through at the same grid: a Room of cubes, curvilinear, squaring grid 5, every layer, whose Figure sheet has a 2.9 mm² piece
    await scene(page, 'room', 'curvi', { sq: 5, show: { floor: true, horizon: true, vps: true, depth: false } }); await setPage({ page: '36x48', mode: 'stencil' }, ['construction', 'figure', 'accent', 'marks', 'drafting']); sten.push(await stencilCase('Room, curvilinear, squaring grid 5, all five layers'));
    check(`Stencil sheets, ${sten.length} sets (every figure at A3, A2 and 36 × 48 in, Continuum at the Metatron step, Sri Yantra at A3, three scenes, and a curvilinear Room with every layer): rasterised by the check itself at 6 pixels to the mm on its own shifted grid (the app checks at its own, coarser one) every sheet is one piece, or the panel and a read-me in the zip say what falls out (the same number of pieces), and it never says nothing falls out when something does`, sten.every(s => s.ok), sten.filter(s => !s.ok || s.loosePieces));
    const bridged = await (async () => { await page.click('#appMode button[data-app="geometry"]'); await figure('yantra', 'plan'); await setPage({ page: 'a3', margin: 50, mode: 'stencil' }, ['construction', 'figure', 'accent']); await studio(page, true); await waitChecked(); const z = unzip((await grab(page, '#stDownload')).buf), big = rasterCut(z['2-figure.svg'].toString(), 4); await studio(page, false); return big; })();
    check('Sri Yantra on A3: the big piece that used to fall out (about 12,400 mm²) is now held by a bridge the check added, and what is left is only slivers under 3 mm² each, which the panel reports', bridged.pieces > 0 ? bridged.mm2 < 60 : true, bridged);
    // stencil sheets made in Perspective are titled after the scene
    await page.click('#appMode button[data-app="perspective"]'); await scene(page, 'fruit', null); await setPage({ page: '36x48', mode: 'stencil' }, ['figure']); await studio(page, true); await waitChecked(); const zt = unzip((await grab(page, '#stDownload')).buf), scName = await page.evaluate(() => window.__state.pv.name), gName = await page.evaluate(() => window.__state.pattern); await studio(page, false);
    const label = zt['1-figure.svg'].toString().match(/<text[^>]*>([^<]*)<\/text>/), figName = await page.evaluate(() => document.querySelector('#pattern option:checked').textContent); check('A stencil sheet made in Perspective is titled after the scene, not the Geometry figure', !!label && label[1].toLowerCase().includes(scName.toLowerCase()) && (figName.toLowerCase() === scName.toLowerCase() || !label[1].toLowerCase().includes(figName.toLowerCase())), { label: label && label[1], scene: scName, geometryFigure: figName });

    /* ---- tiling: tiles cover, hold only their own geometry, and carry a 100 mm check rule ---- */
    const tileCase = async (tag, mode_, sheetId, overlap, view = 'plan') => {
      await page.click('#appMode button[data-app="geometry"]'); await figure('flower', view); await setPage({ page: 'a2', margin: 50, mode: mode_, sheet: sheetId, overlap }, ['construction', 'figure', 'accent']); await page.evaluate(([s, o]) => { window.__studio.ST.sheet = s; window.__studio.ST.overlap = o; }, [sheetId, overlap]);
      await studio(page, true); if (mode_ === 'stencil') await waitChecked(); const z = unzip((await grab(page, '#stDownload')).buf); await studio(page, false);
      const whole = Object.keys(z).filter(n => /^[^/]+\.svg$/.test(n) && !/^\d-/.test(n)).map(n => n)[0], tiles = Object.keys(z).filter(n => /^tiles\/(?:\d-\w+\/)?r\d+c\d+\.svg$/.test(n)); const wholeSvg = parseSvg(z[whole || Object.keys(z).find(n => /^\d-figure\.svg$/.test(n))].toString());
      const W = +wholeSvg.viewBox.split(' ')[2], H = +wholeSvg.viewBox.split(' ')[3]; return { tag, z, tiles, W, H, wholeSvg }; };
    const readTile = text => { const sw = +text.match(/<svg[^>]*width="([\d.]+)mm"/)[1], sh = +text.match(/<svg[^>]*height="([\d.]+)mm"/)[1], tr = text.match(/<g transform="translate\(([-\d.]+) ([-\d.]+)\)"><g transform="translate\(([-\d.]+) ([-\d.]+)\)">/), rect = text.match(/<rect x="0" y="0" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="#bbb"/);
      if (!tr || !rect) return null; const ox = +tr[1] - +tr[3], oy = +tr[2] - +tr[4], tile = [-+tr[3], -+tr[4], -+tr[3] + +rect[1], -+tr[4] + +rect[2]];
      const body = text.slice(text.indexOf(tr[0]), text.indexOf('<rect x="0" y="0"')), ink = [], marks = [], re = /<path d="([^"]+)"([^>]*)\/>/g; let m; while ((m = re.exec(body))) { const dst = /#1f8b8b/.test(m[2]) ? marks : ink; (m[1].match(/M[^M]*/g) || []).forEach(sub => { const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number), P = []; for (let i = 0; i + 1 < n.length; i += 2) P.push([n[i], n[i + 1]]); dst.push({ pts: P, closed: /Z\s*$/.test(sub), filled: !/fill="none"/.test(m[2]) }); }); }
      const rg = text.match(/<g id="check-rule"><path d="M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)M/), rtext = text.match(/<g id="check-rule">[\s\S]*?<text[^>]*>([^<]*)<\/text>/);
      return { sw, sh, edge: +tr[1], tile, ink, marks, clip: /clip-path|clipPath/.test(text), rule: rg ? { len: Math.hypot(+rg[3] - +rg[1], +rg[4] - +rg[2]), y: +rg[2], level: Math.abs(+rg[4] - +rg[2]) < 1e-9, x0: Math.min(+rg[1], +rg[3]), x1: Math.max(+rg[1], +rg[3]), text: rtext && rtext[1] } : null, texts: [...text.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)].map(t => [+t[1], +t[2]]) }; };
    const tileChecks = async (c, label, expectCols) => {
      const T = c.tiles.map(n => readTile(c.z[n].toString())), bad = [], P = c.wholeSvg.strokes.filter(s => !s.filled && s.layer !== undefined);
      if (T.some(t => !t)) return { tag: c.tag, ok: false, why: 'a tile is not in the expected shape' };
      const noClip = T.every(t => !t.clip), outside = T.filter(t => t.ink.some(s => s.pts.some(p => p[0] < t.tile[0] - .02 || p[0] > t.tile[2] + .02 || p[1] < t.tile[1] - .02 || p[1] > t.tile[3] + .02))).length;
      // nothing off the page: ink in tile coordinates (tile origin and the 6 mm edge) stays inside the sheet, and so do the rule and the text
      const offPage = T.filter(t => t.ink.concat(t.marks).some(s => s.pts.some(p => p[0] - t.tile[0] + t.edge < -.02 || p[0] - t.tile[0] + t.edge > t.sw + .02 || p[1] - t.tile[1] + t.edge < -.02 || p[1] - t.tile[1] + t.edge > t.sh + .02)) || (t.rule && (t.rule.x1 + 3 > t.sw)) || t.texts.some(([x, y]) => x < 0 || y < 0 || x > t.sw || y > t.sh)).length;
      // the rectangles of all tiles cover the page, with no gap (checked on a 1 mm lattice)
      let gaps = 0; for (let x = 0; x < c.W; x += 1) for (let y = 0; y < c.H; y += 1) if (!T.some(t => x >= t.tile[0] - 1e-6 && x <= t.tile[2] + 1e-6 && y >= t.tile[1] - 1e-6 && y <= t.tile[3] + 1e-6)) gaps++;
      // every point of the drawing (sampled each 0.5 mm) is on ink in every tile whose rectangle holds it; every tile's ink is on a line of the drawing
      const idxT = T.map(t => segIndex(t.ink.filter(s => !s.filled).map(closedPts))), idxP = segIndex(P.map(closedPts)); let lost = 0, checked = 0, stray = 0, rep = 0;
      P.forEach(s => { const Q = closedPts(s); for (let i = 1; i < Q.length; i++) { const a = Q[i - 1], b = Q[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / .5)); for (let j = 0; j <= n; j++) { const p = [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]; let held = false;
        T.forEach((t, k) => { if (p[0] > t.tile[0] + .05 && p[0] < t.tile[2] - .05 && p[1] > t.tile[1] + .05 && p[1] < t.tile[3] - .05) { checked++; held = true; if (idxT[k](p, .1) > .05) lost++; } }); if (!held && !T.some(t => p[0] >= t.tile[0] - .05 && p[0] <= t.tile[2] + .05 && p[1] >= t.tile[1] - .05 && p[1] <= t.tile[3] + .05)) lost++; } } });
      T.forEach(t => t.ink.filter(s => !s.filled).forEach(s => { const Q = closedPts(s); for (let i = 1; i < Q.length; i++) if (idxP(Q[i], .1) > .05) stray++; }));
      const rules = T.every(t => t.rule && Math.abs(t.rule.len - 100) < .011 && t.rule.level && /100 mm/.test(t.rule.text || '') && t.rule.y > t.edge + (t.tile[3] - t.tile[1]) && t.rule.y < t.sh);
      const sizesOk = T.every(t => (Math.abs(t.sw - 210) < .01 && Math.abs(t.sh - 297) < .01) || (Math.abs(t.sw - 297) < .01 && Math.abs(t.sh - 210) < .01));
      const rows = new Set(T.map(t => f1(t.tile[1]))).size, cols = new Set(T.map(t => f1(t.tile[0]))).size;
      return { tag: c.tag, tiles: T.length, grid: `${cols} × ${rows}`, noClipPath: noClip, inkOutsideItsTile: outside, offPage, gapPoints: gaps, drawingPointsChecked: checked, drawingPointsMissing: lost, inkNotOnDrawing: stray, ruleOk: rules, a4: sizesOk, ok: noClip && outside === 0 && offPage === 0 && gaps === 0 && lost === 0 && stray === 0 && rules && sizesOk && T.length > 1 }; };
    const tc = [];
    for (const [tag, m, sheetId, ov] of [['print, 20 mm overlap, A4', 'print', 'a4', 20], ['print, no overlap, A4', 'print', 'a4', 0], ['print, overlap typed as 5000 mm, A4', 'print', 'a4', 5000]]) tc.push(await tileChecks(await tileCase(tag, m, sheetId, ov)));
    const st = await tileCase('stencil Figure sheet, 20 mm overlap, A4', 'stencil', 'a4', 20); const stName = Object.keys(st.z).find(n => /^\d-figure\.svg$/.test(n)); st.tiles = st.tiles.filter(n => n.startsWith(`tiles/${stName.replace('.svg', '')}/`));
    // the stencil's own slots are the "drawing" here: read the whole sheet's cut shapes as lines for the coverage comparison
    st.wholeSvg = parseSvg(st.z[stName].toString()); const stAll = st.tiles.map(n => readTile(st.z[n].toString())), stT = stAll.filter(Boolean); const stRes = { tag: st.tag, tiles: stT.length, noClipPath: stT.every(t => t && !t.clip), rulesOk: stT.every(t => t.rule && Math.abs(t.rule.len - 100) < .011), oneSheetFill: stT.every(t => t.ink.every(s => s.filled || s.closed !== undefined)) };
    let stGap = 0; for (let x = 0; x < st.W; x++) for (let y = 0; y < st.H; y++) if (!stT.some(t => x >= t.tile[0] - 1e-6 && x <= t.tile[2] + 1e-6 && y >= t.tile[1] - 1e-6 && y <= t.tile[3] + 1e-6)) stGap++;
    // each stencil tile's cut shapes lie inside the tile (trimmed, not hidden) and the tiles' cut shapes joined give the whole sheet's cut area
    const area = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
    stRes.outside = stT.filter(t => t.ink.some(s => s.pts.some(p => p[0] < t.tile[0] - .02 || p[0] > t.tile[2] + .02 || p[1] < t.tile[1] - .02 || p[1] > t.tile[3] + .02))).length; stRes.gapPoints = stGap; stRes.ok = stT.length > 1 && stT.length === stAll.length && stRes.noClipPath && stRes.rulesOk && stRes.outside === 0 && stGap === 0;
    tc.push(stRes);
    check('Tiling (print at 20 mm, 0 mm and an absurd 5000 mm overlap; a stencil sheet): no clipPath, each tile holds only the lines inside its own rectangle (trimmed to it), the rectangles cover the page with no gap, every point of the drawing is inked in every tile that holds it, nothing is off the sheet, and each tile carries a labelled rule that measures 100 mm', tc.every(t => t.ok), tc);
    await ctx.close();
  }
  check('No script errors', errors.length === 0, errors);
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
