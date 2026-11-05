// Geometry and behaviour checks for Locus. Exits non-zero if any check fails.
// usage: node tools/verify.js [path/to/index.html]   (PLAYWRIGHT=/path/to/playwright to use an existing install)
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path');
const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const wrapA = a => ((a + 180) % 360 + 360) % 360 - 180;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await page.goto('file://' + file);

  const setStep = v => page.$eval('#step', (el, v) => { el.value = v === 'max' ? el.max : v; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  const go = async (p, mode = 'plan') => { await page.selectOption('#pattern', p); await page.click(`#viewMode button[data-mode="${mode}"]`); };
  const paths = sel => page.$$eval(sel, ps => ps.map(p => { const a = p.getAttribute('d').match(/-?\d*\.?\d+/g).map(Number), pts = []; for (let i = 0; i < a.length; i += 2) pts.push([a[i] - 450, a[i + 1] - 350]); return pts; }));
  const fit = pts => { const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length; return { cx, cy, r: Math.hypot(pts[0][0] - cx, pts[0][1] - cy) }; };
  const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

  // defaults
  const pressed = await page.$$eval('.chip[data-toggle]', bs => Object.fromEntries(bs.map(b => [b.dataset.toggle, b.getAttribute('aria-pressed')])));
  check('φ, dimensions and plan study start off', pressed.phi === 'false' && pressed.dimensions === 'false' && pressed.multiView === 'false', pressed);

  // the kernel's promise: in a constructed figure every point after the givens is a meeting of two curves
  const prov = await page.evaluate(() => [...document.querySelectorAll('#pattern option')].map(o => {
    const sel = document.querySelector('#pattern'); sel.value = o.value; sel.dispatchEvent(new Event('change'));
    const K = window.__k(), f = window.__fig(o.value);
    return { id: o.value, spatial: !!f.spatial, solved: !!f.solved, givens: K.pts.filter(p => p.op === 'given').length, other: K.pts.filter(p => !p.abs && !['given', 'meet'].includes(p.op)).length, orphans: K.pts.filter(p => p.op !== 'given' && !p.parents.length).length };
  }));
  prov.filter(f => !f.spatial && !f.solved).forEach(f => check(`${f.id}: two givens, every other flat point is a meet`, f.givens === 2 && f.other === 0, f));
  prov.forEach(f => check(`${f.id}: no derived point without parents`, f.orphans === 0, f));

  // Flower of Life
  await go('flower'); await setStep('max');
  const fl = (await paths('#shapeLayer path')).map(fit), d = Math.hypot(fl[1].cx - fl[0].cx, fl[1].cy - fl[0].cy), bound = fit((await paths('#guideLayer path'))[0]);
  check('Flower: 19 circles', fl.length === 19, fl.length);
  check('Flower: radius equals lattice spacing', near(fl[0].r, d) && fl.every(c => near(c.r, fl[0].r)), { r: fl[0].r, d });
  check('Flower: boundary at 3d, touching the outermost circles', near(bound.r, 3 * d) && near(Math.max(...fl.map(c => Math.hypot(c.cx, c.cy) + c.r)), 3 * d), bound.r);
  await setStep(7);
  check('Flower: step 7 is a real Seed of Life', (await page.textContent('#phaseLabel')).startsWith('Seed complete') && (await paths('#shapeLayer path')).map(fit).slice(1).every(c => near(Math.hypot(c.cx, c.cy), d)));

  // Metatron's Cube
  await go('metatron'); await setStep(17);
  const segs = await paths('#shapeLayer path'), r = 92;
  check('Metatron: all 78 chords', segs.length === 78, segs.length);
  check('Metatron: inner hexagram present (√3·r chords)', segs.filter(s => near(Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) / r, Math.sqrt(3), 0.01)).length === 18);
  await page.click('#fruitChip');
  check('Metatron: Fruit circles are r/2', near(fit((await paths('#guideLayer path'))[0]).r, r / 2));
  await page.click('#fruitChip');

  // Metatron 3D collapses onto Metatron's Cube in plan
  const shadow = await page.evaluate(() => { const sel = document.querySelector('#pattern'); sel.value = 'metatron3d'; sel.dispatchEvent(new Event('change')); const K = window.__k(), sh = K.pts.filter(p => p.note === 'dropped straight down the axis'); const rs = [...new Set(sh.map(p => Math.hypot(p.x, p.y).toFixed(3)))].map(Number).sort((a, b) => a - b); const angOk = sh.every(p => Math.hypot(p.x, p.y) < 1e-6 || Math.abs(((Math.atan2(p.y, p.x) * 180 / Math.PI) % 60 + 60) % 60) < 1e-6 || Math.abs(((Math.atan2(p.y, p.x) * 180 / Math.PI) % 60 + 60) % 60 - 60) < 1e-6); return { n: sh.length, rs, angOk }; });
  check('Metatron 3D: 13 plan positions, rings at r and 2r, every 60°', shadow.n === 13 && shadow.rs.length === 3 && Math.abs(shadow.rs[2] / shadow.rs[1] - 2) < 1e-9 && shadow.angOk, shadow);

  // Vesica
  await go('vesica'); await setStep('max');
  const lens = await page.$$eval('#shapeLayer path[data-kind="lens"]', ps => ps.map(p => p.getAttribute('d')));
  const lp = lens.flatMap(dd => { const a = dd.match(/-?\d*\.?\d+/g).map(Number), o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; });
  const W = Math.max(...lp.map(p => p[0])) - Math.min(...lp.map(p => p[0])), H = Math.max(...lp.map(p => p[1])) - Math.min(...lp.map(p => p[1]));
  check('Vesica: lens is two arcs, height ÷ width = √3', lens.length === 2 && Math.abs(H / W - Math.sqrt(3)) < 0.005, { arcs: lens.length, ratio: H / W });

  // Sri Yantra: solved, so check what the solution promises
  const sy = await page.evaluate(() => { const sel = document.querySelector('#pattern'); sel.value = 'yantra'; sel.dispatchEvent(new Event('change')); const K = window.__k();
    const tri = K.steps.map((s, i) => [s.label, i]).filter(([l]) => /triangle/.test(l)).map(([l, i]) => { const v = [...new Set(K.curves.filter(c => c.step === i && c.kind === 'main').flatMap(c => [c.a, c.b]))].sort((a, b) => a.y - b.y); return Math.abs(v[1].y - v[2].y) < 1e-6 ? 'up' : 'down'; });
    const dist = (c, q) => { const dx = c.b.x - c.a.x, dy = c.b.y - c.a.y; return Math.abs((q.x - c.a.x) * dy - (q.y - c.a.y) * dx) / Math.hypot(dx, dy); };
    const inside = (c, q) => { const t = ((q.x - c.a.x) * (c.b.x - c.a.x) + (q.y - c.a.y) * (c.b.y - c.a.y)) / ((c.b.x - c.a.x) ** 2 + (c.b.y - c.a.y) ** 2); return t > -1e-9 && t < 1 + 1e-9; };
    const triples = K.pts.filter(q => q.triples).flatMap(q => q.triples.map(t => ({ q, t })));
    const R = K.curves.find(c => c.type === 'circle').r, corners = ['U1a', 'U1b', 'D1a', 'D1b'].map(n => K.pts.find(p => p.name === n)), apexes = ['A', 'Z'].map(n => K.pts.find(p => p.name === n));
    return { tri, n: triples.length, miss: Math.max(...triples.flatMap(({ q, t }) => t.map(c => dist(c, q)))), outside: triples.filter(({ q, t }) => !t.every(c => inside(c, q))).length,
      inscribed: Math.max(...corners.concat(apexes).map(p => Math.abs(Math.hypot(p.x, p.y) - R))) }; });
  check('Sri Yantra: 4 up, 5 down, innermost down', sy.tri.filter(t => t === 'up').length === 4 && sy.tri.filter(t => t === 'down').length === 5 && sy.tri[sy.tri.length - 1] === 'down', sy.tri);
  check('Sri Yantra: 24 triple points, every third line passes through (< 1e-9)', sy.n === 24 && sy.miss < 1e-9, { n: sy.n, miss: sy.miss });
  check('Sri Yantra: triple points sit on the segments, not their extensions', sy.outside === 0, sy.outside);
  check('Sri Yantra: the two outer triangles are inscribed', sy.inscribed < 1e-9, sy.inscribed);

  // circumspheres pass through the vertices
  for (const s of ['tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron']) {
    const c = await page.evaluate(id => { const sel = document.querySelector('#pattern'); sel.value = id; sel.dispatchEvent(new Event('change')); const K = window.__k(), ring = K.curves.find(c => c.plane); const vr = K.pts.filter(p => p.name[0] === 'V').map(p => Math.hypot(p.x, p.y, p.z)); return { ring: ring.r, min: Math.min(...vr), max: Math.max(...vr), full: K.steps.at(-2).label }; }, s);
    check(`${s}: circumsphere radius equals every vertex radius`, Math.abs(c.ring - c.min) < 1e-6 && Math.abs(c.ring - c.max) < 1e-6 && c.full === 'Full frame', c);
  }

  // Pass II · Continuum: one chain from a point to the solids
  const cont = await page.evaluate(() => { const sel = document.querySelector('#pattern'); sel.value = 'continuum'; sel.dispatchEvent(new Event('change')); const K = window.__k();
    const flat = K.pts.filter(p => !p.abs), lifted = K.pts.filter(p => p.from);
    const crown = lifted.filter(p => p.from.name !== 'O' && Math.hypot(p.x, p.y) < 81);
    const { E, m } = (() => { const S = K.sym; let mm = Infinity; S.forEach((a, i) => S.forEach((b, j) => { if (j > i) mm = Math.min(mm, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)) })); return { E: 0, m: mm } })();
    return { chapters: [...new Set(K.steps.map(s => s.chapter))], givens: flat.filter(p => p.op === 'given').length, nonMeet: flat.filter(p => !['given', 'meet'].includes(p.op)).length,
      liftedOk: lifted.every(p => p.parents[0] === p.from && Math.abs(p.x - p.from.x) < 1e-9 && Math.abs(p.y - p.from.y) < 1e-9), lifted: lifted.length,
      cubeEdge: m / 80, crownR: crown.map(p => +Math.hypot(p.x, p.y).toFixed(6)) } });
  check('Continuum: chapters run Point → Vesica → Seed → Flower → Fruit → Metatron → Lift → Solids', cont.chapters.join() === 'Point,Vesica,Seed,Flower,Fruit,Metatron,Lift,Solids', cont.chapters);
  check('Continuum: the flat part is two givens and meets only', cont.givens === 2 && cont.nonMeet === 0, cont);
  check('Continuum: every cube corner is lifted straight up from a node of Metatron’s Cube', cont.liftedOk && cont.lifted === 16, cont);
  check('Continuum: the lifted outer cube is a true cube on Metatron’s rings', Math.abs(cont.cubeEdge - 2 * Math.sqrt(1.5)) < 1e-9 && cont.crownR.every(r => Math.abs(r - 80) < 1e-6), cont);
  const chap = await page.$$eval('#chapters button', b => b.map(x => x.textContent));
  await page.click('#chapters button[data-chapter="Fruit"]');
  check('Chapter marks jump to their chapter', chap.length === 8 && (await page.textContent('#phaseLabel')).startsWith('Half a radius'), chap);
  // the lift plays: midway, a corner is between its shadow and its height
  await page.evaluate(() => { const K = window.__k(), st = document.querySelector('#step'); st.value = K.steps.findIndex(s => s.lift); st.dispatchEvent(new Event('input', { bubbles: true })) });
  await page.click('#nextBtn'); await page.waitForTimeout(650);
  const mid = await page.evaluate(() => { const q = window.__k().pts.find(p => p.name === 'T↑'), a = window.__proj(q), b = window.__proj(q.from); return Math.hypot(a.x - b.x, a.y - b.y) });
  await page.waitForTimeout(1500);
  const end = await page.evaluate(() => { const q = window.__k().pts.find(p => p.name === 'T↑'), a = window.__proj(q), b = window.__proj(q.from); return Math.hypot(a.x - b.x, a.y - b.y) });
  check('Continuum: the lift animates corners up out of their shadows', mid > 2 && end > mid + 2, { mid, end });

  // symmetry axes come out of the geometry, and match each solid's rotation group
  const groups = { tetrahedron: '2:3,3:4', cube: '2:6,3:4,4:3', octahedron: '2:6,3:4,4:3', dodecahedron: '2:15,3:10,5:6', icosahedron: '2:15,3:10,5:6', metatron3d: '2:6,3:4,4:3' };
  for (const [id, want] of Object.entries(groups)) {
    const got = await page.evaluate(id => { const sel = document.querySelector('#pattern'); sel.value = id; sel.dispatchEvent(new Event('change')); const c = {}; window.__axes().forEach(a => c[a.k] = (c[a.k] || 0) + 1); return Object.keys(c).sort().map(k => `${k}:${c[k]}`).join() }, id);
    check(`${id}: symmetry axes ${want}`, got === want, got);
  }
  await go('cube', 'axon'); await setStep('max');
  if (await page.$eval('#autoRotateBtn', b => b.classList.contains('active'))) await page.click('#autoRotateBtn');
  const t3 = await page.evaluate(() => window.__axes().find(a => a.k === 3));
  await page.evaluate(a => { const r = document.querySelector('#rotation'), t = document.querySelector('#tilt'); r.value = a.rot + 4; r.dispatchEvent(new Event('input', { bubbles: true })); t.value = a.tilt - 3; t.dispatchEvent(new Event('input', { bubbles: true })) }, t3);
  const ghostNear = await page.$$eval('#ghostLayer [data-kind="ghost"]', g => g.length);
  await page.click('#snapBtn'); await page.waitForTimeout(700);
  const snapped = await page.evaluate(() => window.__nearest());
  check('Snap lands exactly on the 3-fold axis', snapped && snapped.k === 3 && snapped.deg < 1e-6, snapped);
  check('Near a 3-fold axis the flat Metatron’s Cube shows behind the cube (13 circles, 78 chords)', ghostNear === 91 && (await page.textContent('#axisText')).includes('Metatron'), ghostNear);
  // depth ink: nearer edges heavier
  await page.evaluate(() => { const r = document.querySelector('#rotation'), t = document.querySelector('#tilt'); r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); t.value = 30; t.dispatchEvent(new Event('input', { bubbles: true })) });
  const ink = await page.$$eval('#shapeLayer path', ps => ps.map(p => +p.style.getPropertyValue('--dzw')));
  check('Depth ink varies weight with depth', Math.max(...ink) - Math.min(...ink) > 0.3, { min: Math.min(...ink), max: Math.max(...ink) });
  check('Auto rotate can be switched in every view', await page.isVisible('#autoRotateBtn'));

  // regressions found in review of PR #2
  await page.selectOption('#pattern', 'continuum'); await setStep('max'); await page.click('#viewMode button[data-mode="axon"]');
  if (!(await page.$eval('#autoRotateBtn', b => b.classList.contains('active')))) await page.click('#autoRotateBtn');
  const ar0 = await page.$eval('#rotation', e => +e.value); await page.waitForTimeout(600); const ar1 = await page.$eval('#rotation', e => +e.value);
  await page.click('#autoRotateBtn');
  check('Auto rotate turns the Continuum once its solids are showing', ar0 !== ar1, { ar0, ar1 });
  const inkA = await page.$$eval('#shapeLayer path[style*="--dzw"]', x => x.length);
  await page.click('#studioBtn'); await page.waitForTimeout(400); await page.click('#stClose'); await page.waitForTimeout(100);
  const inkB = await page.$$eval('#shapeLayer path[style*="--dzw"]', x => x.length);
  check('Depth ink survives opening and closing Studio', inkA > 0 && inkA === inkB, { inkA, inkB });

  // look: theme toggle and the accent on the newest construction
  const themes = [];
  for (let i = 0; i < 3; i++) { await page.click('#themeBtn'); themes.push([await page.textContent('#themeBtn span'), await page.evaluate(() => document.documentElement.getAttribute('data-theme')), await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim())]); }
  check('Theme toggle cycles Night → Paper → System and repaints', themes[0][0] === 'Night' && themes[0][1] === 'dark' && themes[1][0] === 'Paper' && themes[1][1] === 'light' && themes[0][2] !== themes[1][2] && themes[2][0] === 'System', themes);
  await page.selectOption('#pattern', 'flower'); await setStep(10);
  const fresh = await page.$$eval('[data-fresh]', x => x.length); await setStep('max'); const freshEnd = await page.$$eval('[data-fresh]', x => x.length);
  check('The newest step is marked in the accent, and the finished figure is not', fresh > 0 && freshEnd === 0, { fresh, freshEnd });

  // controls
  await go('flower'); check('φ overlay unavailable on hexagonal figures', await page.$eval('#phiChip', b => b.disabled));
  await go('dodecahedron'); check('φ overlay available on pentagonal figures', !(await page.$eval('#phiChip', b => b.disabled)));
  await go('cube'); const p1 = await page.$eval('#primitiveMode .active', b => b.dataset.primitive); await go('seed'); const p2 = await page.$eval('#primitiveMode .active', b => b.dataset.primitive);
  check('Primitive follows the figure', p1 === 'solid' && p2 === 'flat', { p1, p2 });

  await go('cube', 'perspective'); await setStep('max');
  if (await page.$eval('#autoRotateBtn', b => b.classList.contains('active'))) await page.click('#autoRotateBtn');
  for (const pts of [1, 2, 3]) {
    await page.click(`#perspectiveMode button[data-points="${pts}"]`);
    const shot = async t => { await page.$eval('#tilt', (el, t) => { el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); }, t); return page.$eval('#shapeLayer path', p => p.getAttribute('d')); };
    check(`Tilt changes the drawing in ${pts}-point`, (await shot(5)) !== (await shot(60)));
  }
  check('VP centre dots render', (await page.$$eval('#perspectiveLayer .vp-dot', x => x.length)) === 3);
  check('isSpatial is not a global', !(await page.evaluate(() => 'isSpatial' in window)));

  // true perspective: parallel edges meet exactly at their handle, the horizon is eye level, nothing runs past the eye
  const setR = (id, v) => page.$eval(id, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await setR('#rotation', 0); await setR('#tilt', 0);
  const meets = () => page.evaluate(() => {
    const V = window.__k().pts.filter(q => q.name[0] === 'V'), fam = { 0: [], 1: [], 2: [] };
    V.forEach((a, i) => V.forEach((c, j) => { if (j > i && Math.abs(Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z) - 196.3) < 1) { const d = [c.x - a.x, c.y - a.y, c.z - a.z].map(Math.abs); fam[d.indexOf(Math.max(...d))].push([window.__proj(a), window.__proj(c)]); } }));
    const meet = ([a, b], [c, d]) => { const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x); if (Math.abs(den) < 1e-6) return null; const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den; return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }; };
    return window.__cam().vps.map(v => { const L = fam[v.axis], ms = L.slice(1).map(l => meet(L[0], l)).filter(Boolean); return ms.length ? Math.max(...ms.map(m => Math.hypot(m.x - v.x, m.y - v.y))) : Infinity; });
  });
  for (const pts of [1, 2, 3]) { await page.click(`#perspectiveMode button[data-points="${pts}"]`); const m = await meets(); check(`${pts}-point: every family of parallel edges meets at its vanishing point`, m.length === pts && m.every(d => d < 0.5), m); }
  const gb = await page.evaluate(() => { const b = document.querySelector('#gridLayer').getBBox(); return Math.max(b.width, b.height); });
  check('Perspective grid stays in front of the eye (no runaway coordinates)', gb < 1400, gb);
  await page.click('#perspectiveMode button[data-points="1"]');
  const atH = async h => { await setR('#horizon', h); return page.evaluate(() => { const ys = window.__k().pts.filter(q => q.name[0] === 'V').map(q => window.__proj(q).y), o = window.__view(window.__model({ x: 0, y: 0, z: 0 })); return { c: [o.x, o.y].map(Math.round), h: Math.round(Math.max(...ys) - Math.min(...ys)) }; }); };
  const hs = [await atH(150), await atH(350), await atH(550)];
  check('Horizon moves the eye, not the drawing', hs.every(r => r.c[0] === 450 && r.c[1] === 350) && hs[0].h !== hs[1].h, hs);
  await setR('#horizon', 350);

  await page.click('#perspectiveMode button[data-points="1"]'); await page.click('#autoRotateBtn');
  const live = await page.evaluate(() => new Promise(res => { let n = 0; const mo = new MutationObserver(m => n += m.length); mo.observe(document.getElementById('statusLine'), { childList: true, subtree: true, characterData: true }); const r0 = document.getElementById('rotation').value; setTimeout(() => { mo.disconnect(); res({ n, rotated: r0 !== document.getElementById('rotation').value }); }, 1000); }));
  check('Status line stays quiet while auto-rotating', live.rotated && live.n === 0, live);
  await page.click('#autoRotateBtn');

  const box = await page.locator('#canvasWrap').boundingBox();
  await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down(); for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x + 300 + i * 60, box.y + 300); await page.waitForTimeout(8); } await page.mouse.up();
  await page.click('#undoBtn'); const u1 = await page.$eval('#rotation', e => +e.value); await page.waitForTimeout(700); const u2 = await page.$eval('#rotation', e => +e.value);
  check('Undo during a flick stops the spin', u1 === u2, { u1, u2 });

  // lineage
  await go('flower'); await setStep('max');
  const pt = await page.evaluate(() => { const q = window.__k().pts.find(p => p.name === 'D3'), s = document.querySelector('#geometry').getBoundingClientRect(), pr = window.__proj(q); return { x: s.left + pr.x * s.width / 900, y: s.top + pr.y * s.height / 700 }; });
  await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(100);
  const tip = await page.textContent('#lineageTip');
  check('Hovering a point shows its lineage', tip.startsWith('D3 = circle at P3') && (await page.$$eval('#lineageLayer path', p => p.length)) > 0, tip);
  await page.mouse.move(2, 2);

  // standalone export
  await go('dodecahedron', 'perspective'); for (const k of ['phi', 'dimensions', 'multiView']) await page.click(`.chip[data-toggle="${k}"]`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const svg = require('fs').readFileSync(await dl.path(), 'utf8');
  check('Export: no unresolved tokens, kind rules inlined, depth resolved, no lineage overlay', !svg.includes('var(--') && !svg.includes('--dz') && svg.includes('[data-kind="main"]') && !svg.includes('lineageLayer'), { tokens: (svg.match(/var\(--/g) || []).length });

  // three-point (Geometry): dropping the horizon keeps a real camera; looking up swings VP 3 overhead
  await go('cube', 'perspective'); if (await page.$eval('#autoRotateBtn', b => b.classList.contains('active'))) await page.click('#autoRotateBtn');
  await page.click('#perspectiveMode button[data-points="3"]');
  const drop = []; for (const h of [150, 500, 630]) { await page.$eval('#horizon', (e, h) => { e.value = h; e.dispatchEvent(new Event('input', { bubbles: true })); }, h); drop.push(await page.evaluate(() => { const c = window.__cam(), s = window.__state, x = c.vps.find(v => v.axis === 1); return { f: c.f, ab: (x.x - s.vpLeft) * (s.vpRight - x.x), vp3: x.y, h: s.horizon }; })); }
  check('3-point: dropping the horizon never collapses the camera (f ≥ 0.6·√ab) and VP 3 flips above when you look up', drop.every(d => d.f >= 0.6 * Math.sqrt(d.ab) - 1e-6) && drop[0].vp3 > drop[0].h && drop[2].vp3 < drop[2].h, drop);

  /* ---------- Perspective planner ---------- */
  await page.click('#appMode [data-app="perspective"]');
  {
  const scene=id=>page.evaluate(id=>{const s=document.querySelector('#pvScene');s.value=id;s.dispatchEvent(new Event('change'))},id);
  // 1 linear: every family of parallel edges meets exactly at its vanishing point
  await scene('blank');
  const lin=await page.evaluate(()=>{const P=window.__pv,S=window.__state;S.pv={...S.pv,boxes:S.pv.boxes.map(b=>({...b,ry:30,rx:12})),pitch:-14,yaw:9};P.render();const K=P.camera(),I=P.sceneOf(S.pv,K)[0];
    const im=p=>P.img(K,P.toCam(K,p)),meet=([a,b],[c,d])=>{const den=(a[0]-b[0])*(c[1]-d[1])-(a[1]-b[1])*(c[0]-d[0]);const t=((a[0]-c[0])*(c[1]-d[1])-(a[1]-c[1])*(c[0]-d[0]))/den;return[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]};
    let worst=0;[1,2,4].forEach(bit=>{const fam=P.EDGES.filter(([a,b])=>(a^b)===bit).map(([a,b])=>[im(I.P[a]),im(I.P[b])]),j=bit===1?0:bit===2?1:2,v=[I.R[0][j],I.R[1][j],I.R[2][j]],c=K.CT.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]),vp=P.dirImg(K,c[2]>0?c:c.map(x=>-x));
      fam.slice(1).forEach(f=>{const m=meet(fam[0],f);worst=Math.max(worst,Math.hypot(m[0]-vp[0],m[1]-vp[1])/Math.max(1,Math.hypot(vp[0],vp[1])))})});return worst});
  check('Linear: every family of parallel edges meets at its vanishing point (relative miss < 1e-9)',lin<1e-9,lin);
  // 2 curvilinear: every edge lies on its circle, in the maths and in the drawing
  await scene('overhead');
  const cur=await page.evaluate(()=>{const P=window.__pv,S=window.__state,K=P.camera(),list=P.sceneOf(S.pv,K);let worst=0,worstPx=0,n=0;
    list.forEach(I=>P.EDGES.forEach(([a,b])=>{const ca=P.toCam(K,I.P[a]),cb=P.toCam(K,I.P[b]),cr=[ca[1]*cb[2]-ca[2]*cb[1],ca[2]*cb[0]-ca[0]*cb[2],ca[0]*cb[1]-ca[1]*cb[0]],l=Math.hypot(...cr),G=P.circleOf(K,cr.map(x=>x/l));if(G.type!=='circle')return;
      for(let i=0;i<=20;i++){const t=i/20,p=I.P[a].map((v,k)=>v+(I.P[b][k]-v)*t),q=P.img(K,P.toCam(K,p));if(!q)continue;n++;worst=Math.max(worst,Math.abs(Math.hypot(q[0]-G.c[0],q[1]-G.c[1])-G.r)/G.r)}
      const [cx,cy]=P.toSvg(G.c),rs=G.r*P.view.s;P.segPolys(K,I.P[a],I.P[b]).forEach(poly=>poly.forEach(([x,y])=>{if(x<=-1799.999||x>=2699.999||y<=-1399.999||y>=2099.999)return;worstPx=Math.max(worstPx,Math.abs(Math.hypot(x-cx,y-cy)-rs))}))}));return{worst,worstPx,n}});
  check('Curvilinear: every edge is an exact circle (relative miss < 1e-9), and the drawn arc sits on it (< 1e-6 px)',cur.worst<1e-9&&cur.worstPx<1e-6&&cur.n>1000,cur);
  // 3 the two projections agree near the centre
  const agree=await page.evaluate(()=>{const P=window.__pv,S=window.__state,K1=P.camera({...S.pv,proj:'linear'}),K2=P.camera({...S.pv,proj:'curvi'}),a=1*Math.PI/180,c=[Math.sin(a),0,Math.cos(a)].map(x=>x*100),p=P.img(K1,c),q=P.img(K2,c);return Math.abs(p[0]-q[0])/p[0]});
  check('Linear and curvilinear agree at the centre of vision (1° off: < 0.01%)',agree<1e-4,agree);
  // 4 hidden lines: a lone cube seen from above and turned shows 9 edges and hides 3
  await scene('blank');
  const hl=await page.evaluate(()=>{const P=window.__pv,S=window.__state;S.pv={...S.pv,boxes:S.pv.boxes.map(b=>({...b,ry:30,rx:0})),pitch:-20,yaw:0};const K=P.camera(),list=P.sceneOf(S.pv,K),I=list[0];let vis=0,hid=0;
    P.EDGES.forEach(([a,b])=>{const r=P.runsOf(I.P[a],I.P[b],list,K);if(r.length===1&&r[0][2])vis++;else if(r.length===1&&!r[0][2])hid++});return{vis,hid}});
  check('Hidden lines: a turned cube seen from above shows 9 edges, hides 3',hl.vis===9&&hl.hid===3,hl);
  const occ=await page.evaluate(()=>{const P=window.__pv,S=window.__state,base=S.pv.boxes[0];S.pv={...S.pv,pitch:0,yaw:0,eye:{x:0,y:20,z:0},boxes:[{...base,id:1,x:0,y:0,z:60,w:40,h:40,d:40,ry:0,arr:{...base.arr,type:'none'}},{...base,id:2,x:0,y:10,z:160,w:10,h:10,d:10,ry:0,arr:{...base.arr,type:'none'}}]};
    const K=P.camera(),list=P.sceneOf(S.pv,K),I=list.find(I=>I.b.id===2);return P.EDGES.every(([a,b])=>P.runsOf(I.P[a],I.P[b],list,K).every(r=>!r[2]))});
  check('Hidden lines: a small box straight behind a big one is hidden completely',occ);
  // 5 arrays
  await scene('overhead');
  const arr=await page.evaluate(()=>{const P=window.__pv,S=window.__state,E=[S.pv.eye.x,S.pv.eye.y,S.pv.eye.z],arch=P.instances(S.pv,S.pv.boxes[0]),ring=P.instances(S.pv,S.pv.boxes[1]);
    const dist=I=>{const c=[0,1,2].map(k=>I.t[k]+I.R[k][1]*I.h/2);return Math.hypot(c[0]-E[0],c[1]-E[1],c[2]-E[2])},hd=I=>Math.hypot(I.t[0]-E[0],I.t[2]-E[2]);
    const ad=arch.map(dist),rd=ring.map(hd),spread=a=>Math.max(...a)-Math.min(...a);
    const ang=(A,B)=>{const u=[0,1,2].map(k=>A.t[k]-E[k]),v=[0,1,2].map(k=>B.t[k]-E[k]);return Math.acos(Math.min(1,(u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/Math.hypot(...u)/Math.hypot(...v)))};const steps=arch.slice(1).map((I,i)=>ang(arch[i],I));
    const top=Math.max(...arch.map(I=>I.t[1]));return{n:arch.length,ns:S.pv.boxes[0].arr.n,ad:spread(ad),rd:spread(rd),step:spread(steps),top,eye:E[1]}});
  check('Arch: the right count, all the same distance from your eye, evenly spaced, and over your head',arr.n===arr.ns&&arr.ad<1e-9&&arr.step<1e-9&&arr.top>arr.eye+40,arr);
  check('Ring: every copy the same distance from where you stand',arr.rd<1e-9,arr.rd);
  // 6 horizon
  const hz=await page.evaluate(()=>{const P=window.__pv,S=window.__state,out={};for(const proj of ['linear','curvi'])for(const pitch of [0,25]){const K=P.camera({...S.pv,proj,pitch}),n=K.CT.map(r=>r[1]),G=P.circleOf(K,n);
    out[proj+pitch]=G.type==='line'?G.p[1]-(G.d[0]?0:0):G.c[1]-G.r}out.D=S.pv.dist;return out});
  const D=hz.D;check('Horizon: through the centre when level; drops by D·tan φ (linear) and 2D·tan(φ/2) (curvilinear) when you look up',Math.abs(hz.linear0)<1e-9&&Math.abs(hz.curvi0)<1e-9&&Math.abs(hz.linear25+D*Math.tan(25*Math.PI/180))<1e-9&&Math.abs(hz.curvi25+2*D*Math.tan(12.5*Math.PI/180))<1e-9,hz);
  // 7 hands: drag a box, look around, undo
  await scene('blank');await page.waitForTimeout(100);
  const at=async (w)=>page.evaluate(w=>{const P=window.__pv,K=P.camera(),[x,y]=P.toSvg(P.img(K,P.toCam(K,w))),m=document.querySelector('#geometry').getScreenCTM(),p=new DOMPoint(x,y).matrixTransform(m);return[p.x,p.y]},w);
  const b0=await page.evaluate(()=>({...window.__state.pv.boxes[0]}));let [sx,sy]=await at([b0.x,b0.h,b0.z]);
  await page.mouse.move(sx,sy);await page.mouse.down();for(let i=1;i<=10;i++)await page.mouse.move(sx+i*12,sy);await page.mouse.up();
  const b1=await page.evaluate(()=>({...window.__state.pv.boxes[0]}));
  check('Dragging a box slides it along the floor (it stays on the floor, snapped to 3 in)',Math.abs(b1.x-b0.x)>6&&b1.y===0&&b1.x%3===0,{b0:[b0.x,b0.y,b0.z],b1:[b1.x,b1.y,b1.z]});
  await page.click('#undoBtn');const b2=await page.evaluate(()=>({...window.__state.pv.boxes[0]}));check('Undo puts the box back',b2.x===b0.x&&b2.z===b0.z,[b2.x,b2.z]);
  const y0=await page.evaluate(()=>window.__state.pv.yaw);const box=await (await page.$('#canvasWrap')).boundingBox();await page.mouse.move(box.x+120,box.y+140);await page.mouse.down();for(let i=1;i<=8;i++)await page.mouse.move(box.x+120+i*15,box.y+140);await page.mouse.up();
  const y1=await page.evaluate(()=>window.__state.pv.yaw);check('Dragging empty space turns your head',y1<y0-3,{y0,y1});
  // 8 stacking: drop one box onto another
  await scene('blank');await page.evaluate(()=>{const S=window.__state,b={...S.pv.boxes[0],ry:0};S.pv={...S.pv,boxes:[b,{...structuredClone(b),id:2,x:b.x+40}]};window.__pv.sel=null;window.__pv.render()});
  const c2=await page.evaluate(()=>({...window.__state.pv.boxes[1]}));[sx,sy]=await at([c2.x,c2.h,c2.z]);const [tx,ty]=await at([b0.x,b0.h,b0.z]);
  await page.mouse.move(sx,sy);await page.mouse.down();for(let i=1;i<=16;i++)await page.mouse.move(sx+(tx-sx)*i/16,sy+(ty-sy)*i/16);await page.mouse.up();
  const c3=await page.evaluate(()=>({...window.__state.pv.boxes[1]}));check('Drop a box onto another and it sits on top',c3.y===b0.h,[c3.x,c3.y,c3.z]);
  // 9 VP drag turns you so the point follows the hand
  await scene('street');await page.waitForTimeout(100);
  const vp=await page.evaluate(()=>{const g=[...document.querySelectorAll('#overlayLayer .pv-vp')].find(g=>g.querySelector('.vp-handle'));const c=g.querySelector('.vp-handle'),r=c.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,dir:g.dataset.dir}});
  await page.mouse.move(vp.x,vp.y);await page.mouse.down();await page.mouse.move(vp.x-30,vp.y,{steps:5});await page.mouse.move(vp.x-60,vp.y+20,{steps:5});await page.mouse.up();
  const vp2=await page.evaluate(d=>{const P=window.__pv,K=P.camera(),v=d.split(',').map(Number),c=K.CT.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]),[x,y]=P.toSvg(P.dirImg(K,c)),m=document.querySelector('#geometry').getScreenCTM(),p=new DOMPoint(x,y).matrixTransform(m);return[p.x,p.y]},vp.dir);
  check('Dragging a vanishing point turns your head so the point follows the hand (< 1.5 px)',Math.hypot(vp2[0]-(vp.x-60),vp2[1]-(vp.y+20))<1.5,{want:[vp.x-60,vp.y+20],got:vp2});
  // 10 an edge in curvilinear gives its pin and string
  await scene('overhead');await page.waitForTimeout(100);
  await page.evaluate(()=>{const P=window.__pv;P.sel={id:1,k:4};P.pin={id:1,k:4,edge:3};P.render()});
  const pinTxt=await page.evaluate(()=>[...document.querySelectorAll('#overlayLayer text')].map(t=>t.textContent).find(t=>t.startsWith('PIN')));
  const arc=await page.evaluate(()=>{const P=window.__pv,A=P.arcOf({id:1,k:4,edge:3});return A&&A.G});
  check('Click an arc edge and it gives the pin position and string length on your canvas',pinTxt&&arc&&arc.type==='circle'&&pinTxt.includes('STRING'),pinTxt);
  // 11 Studio: the canvas is the page at full size
  await scene('street');
  await page.click('#studioBtn');await page.waitForTimeout(300);await page.click('#stModes [data-v="print"]');
  const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#stDownload')]);const svg=require('fs').readFileSync(await dl.path(),'utf8');
  const wmm=+(svg.match(/width="([\d.]+)mm"/)||[])[1],hmm=+(svg.match(/height="([\d.]+)mm"/)||[])[1];
  const nums=[...svg.matchAll(/ d="([^"]+)"/g)].flatMap(m=>m[1].match(/-?\d*\.?\d+/g).map(Number));let okIn=true;for(let i=0;i+1<nums.length;i+=2){if(nums[i]<-0.01||nums[i]>wmm+0.01||nums[i+1]<-0.01||nums[i+1]>hmm+0.01){okIn=false;break}}
  check('Studio print: the page is your canvas at full size (48 × 36 in → 1219.2 × 914.4 mm) and nothing runs off it',Math.abs(wmm-1219.2)<.05&&Math.abs(hmm-914.4)<.05&&okIn&&nums.length>100,{wmm,hmm,okIn,n:nums.length});
  await page.click('#stClose');
  // screen export from the planner resolves every token
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);const psvg = require('fs').readFileSync(await dl2.path(), 'utf8');
  check('Planner export: a standalone SVG with no unresolved tokens', psvg.startsWith('<svg') && !psvg.includes('var(--') && psvg.includes('pv-face'), { tokens: (psvg.match(/var\(--/g) || []).length });
  // 12 back to geometry and forward again
  await page.click('#appMode [data-app="geometry"]');const gt=await page.textContent('#patternTitle');const steps=await page.isVisible('.steps');
  await page.click('#undoBtn');const back=await page.evaluate(()=>window.__state.app);
  check('Switching back to Geometry restores it, and undo steps back across the switch',gt&&gt!=='A street of cubes'&&steps&&back==='perspective',{gt,steps,back});
  }
  {
  // hands on: handles, flush snapping, aim, one draw per frame
  await page.click('#appMode [data-app="perspective"]');
  const scene=id=>page.evaluate(id=>{const s=document.querySelector('#pvScene');s.value=id;s.dispatchEvent(new Event('change'))},id);
  const T = {
  // 1 stretch a side face: it grows, the opposite face stays put
  async side(){await scene('blank');await page.evaluate(()=>{const P=window.__pv;P.sel={id:1,k:0};P.render()});
    const h=await page.evaluate(()=>{const P=window.__pv,G=P.gizmo(),F=G.faces.find(F=>F.front&&(F.dim==='w'||F.dim==='d')),el=document.querySelector(`[data-pv="face:${F.f}"] rect`),r=el.getBoundingClientRect(),K=P.camera(),a=P.toSvg(P.img(K,P.toCam(K,F.c))),t=P.toSvg(P.img(K,P.toCam(K,F.tip))),m=document.querySelector('#geometry').getScreenCTM();
      const A=new DOMPoint(...a).matrixTransform(m),B=new DOMPoint(...t).matrixTransform(m),opp=G.faces.find(o=>o.dim===F.dim&&o.f!==F.f);return{f:F.f,dim:F.dim,x:r.x+r.width/2,y:r.y+r.height/2,dx:B.x-A.x,dy:B.y-A.y,opp:opp.c,size:window.__state.pv.boxes[0][F.dim]}});
    const L=Math.hypot(h.dx,h.dy);await page.mouse.move(h.x,h.y);await page.mouse.down();for(let i=1;i<=10;i++)await page.mouse.move(h.x+h.dx/L*4*i,h.y+h.dy/L*4*i);await page.mouse.up();
    const after=await page.evaluate(f=>{const G=window.__pv.gizmo(),F=G.faces[f],opp=G.faces.find(o=>o.dim===F.dim&&o.f!==F.f);return{opp:opp.c,b:window.__state.pv.boxes[0]}},h.f);
    const moved=Math.hypot(...after.opp.map((v,i)=>v-h.opp[i]));
    check('Pull a side handle: the box grows that way and the opposite face stays put (< 0.06 in)',after.b[h.dim]>h.size+3&&moved<0.06,{dim:h.dim,from:h.size,to:after.b[h.dim],moved})},
  // 2 the top handle makes it taller without lifting it
  async top(){await page.evaluate(()=>{const P=window.__pv;P.sel={id:1,k:0};P.render()});
    const h=await page.evaluate(()=>{const el=document.querySelector('[data-pv="face:2"] rect');if(!el)return null;const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,at=document.elementFromPoint(x,y);return{x,y,h:window.__state.pv.boxes[0].h,y0:window.__state.pv.boxes[0].y,at:at&&(at.getAttribute('class')+' '+at.closest('[data-pv]')?.dataset.pv),pv:{yaw:window.__state.pv.yaw,pitch:window.__state.pv.pitch,proj:window.__state.pv.proj}}});
    if(!h){check('Pull the top handle: taller, base stays on the floor',false,'no top handle');return}
    await page.mouse.move(h.x,h.y);await page.mouse.down();for(let i=1;i<=10;i++)await page.mouse.move(h.x,h.y-5*i);await page.mouse.up();
    const b1=await page.evaluate(()=>window.__state.pv.boxes[0]);check('Pull the top handle: taller, base stays on the floor',b1.h>h.h+3&&b1.y===h.y0,{h0:h.h,h1:b1.h,y:b1.y,at:h.at,pv:h.pv,xy:[h.x,h.y]})},
  // 3 the dial turns it about its own foot
  async dial(){await page.evaluate(()=>{const P=window.__pv;P.sel={id:1,k:0};P.render()});
    const h=await page.evaluate(()=>{const el=document.querySelector('[data-pv="turn"] circle');const r=el.getBoundingClientRect();const b=window.__state.pv.boxes[0];return{x:r.x+r.width/2,y:r.y+r.height/2,ry:b.ry,bx:b.x,bz:b.z}});
    await page.mouse.move(h.x,h.y);await page.mouse.down();for(let i=1;i<=10;i++)await page.mouse.move(h.x+8*i,h.y);await page.mouse.up();
    const b1=await page.evaluate(()=>window.__state.pv.boxes[0]);check('Swing the dial: the box turns (in 5° steps) about its own foot',b1.ry!==h.ry&&b1.ry%5===0&&b1.x===h.bx&&b1.z===h.bz,{ry0:h.ry,ry1:b1.ry})},
  // 4 flush snapping
  async flush(){const r=await page.evaluate(()=>{const P=window.__pv,S=window.__state,b={...S.pv.boxes[0],ry:0,w:24,h:24,d:24,x:0,y:0,z:96,arr:{...S.pv.boxes[0].arr,type:'none'}};S.pv={...S.pv,boxes:[b,{...structuredClone(b),id:2,x:40}]};
      const touch=P.flush(S.pv,{...S.pv.boxes[1],x:26.5,z:97.5}),far=P.flush(S.pv,{...S.pv.boxes[1],x:33}),turned=P.flush({...S.pv,boxes:S.pv.boxes.map(o=>({...o,ry:30}))},{...S.pv.boxes[1],ry:30,x:26.5});return{touch,far,turned}});
    check('Flush: a box within 4 in of a neighbour clicks against its face and lines up with it',r.touch.x===24&&r.touch.z===96&&r.touch.cue===1,r.touch);
    check('Flush: farther than 4 in it stays where you put it',r.far.x===33&&r.far.cue==null,r.far);
    const th=30*Math.PI/180,lx=r.turned.x*Math.cos(th)-(r.turned.z-96)*Math.sin(th);check('Flush works for boxes turned the same way (touching along their own axes)',r.turned.cue===1&&Math.abs(lx-24)<1e-3,{...r.turned,lx})},
  // 5 aim
  async aim(){await scene('room');const c=await page.evaluate(()=>{const P=window.__pv,S=window.__state;P.sel={id:1,k:5};P.aim();P.render();const K=P.camera(),I=P.sceneOf(S.pv,K).find(I=>I.b.id===1&&I.k===5),c=[0,1,2].map(k=>I.t[k]+I.R[k][1]*I.h/2);return P.img(K,P.toCam(K,c))});
    check('Aim: the selected box lands dead centre (< 0.01 in)',Math.hypot(...c)<.01,c)},
  // 6 one draw per frame however fast the pointer moves
  async frames(){await scene('overhead');const r=await page.evaluate(async()=>{const P=window.__pv,w=document.querySelector('#canvasWrap'),g=document.querySelector('#geometry'),R=w.getBoundingClientRect(),x=R.x+60,y=R.y+60,f0=P.frames;
      const fire=(t,dx)=>g.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x+dx,clientY:y,pointerId:7,pointerType:'mouse',button:0}));fire('pointerdown',0);for(let i=1;i<=30;i++)fire('pointermove',i*3);const sync=P.frames-f0;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const later=P.frames-f0;fire('pointerup',90);return{sync,later,yaw:window.__state.pv.yaw}});
    check('Thirty pointer moves in one frame cost one redraw',r.sync===0&&r.later===1,r)}};
for(const k of Object.keys(T))await T[k]();
  }
  {
  // double-click the floor to put a box there
  await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'))});
  const [x,y]=await page.evaluate(()=>{const P=window.__pv,K=P.camera(),[sx,sy]=P.toSvg(P.img(K,P.toCam(K,[-40,0,110]))),m=document.querySelector('#geometry').getScreenCTM(),q=new DOMPoint(sx,sy).matrixTransform(m);return[q.x,q.y]});
  await page.mouse.dblclick(x,y);const nb=await page.evaluate(()=>window.__state.pv.boxes.slice(-1)[0]);
  check('Double-click the floor: a new box lands there, on the floor, snapped to 3 in',nb.id===2&&nb.y===0&&Math.abs(nb.x+40)<=1.5&&Math.abs(nb.z-110)<=1.5&&nb.x%3===0,[nb.x,nb.y,nb.z]);
  }
  {
  // round 3: walk round, shots, snap-tos, reference view, and the audit's fixes
  await page.click('#appMode [data-app="perspective"]');
  const T = {
  async orbit(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'))});
    const st=()=>page.evaluate(()=>{const P=window.__pv,S=window.__state,F=P.focus(),E=[S.pv.eye.x,S.pv.eye.y,S.pv.eye.z],K=P.camera(),q=P.img(K,P.toCam(K,F));return{F,E,r:Math.hypot(E[0]-F[0],E[1]-F[1],E[2]-F[2]),q,yaw:S.pv.yaw,pitch:S.pv.pitch}});
    const a=await st();const box=await (await page.$('#canvasWrap')).boundingBox();const x=box.x+120,y=box.y+box.height-90;
    await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=10;i++)await page.mouse.move(x+i*13,y-i*6);await page.mouse.up();const c=await st();
    check('Orbit: dragging empty space walks you round the subject at the same distance, keeping it dead centre',Math.abs(c.r-a.r)<1e-6&&Math.hypot(c.E[0]-a.E[0],c.E[2]-a.E[2])>5&&Math.hypot(...c.q)<1e-6,{r0:a.r,r1:c.r,q:c.q});
    // Shift-drag looks around from where you stand
    await page.keyboard.down('Shift');await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=6;i++)await page.mouse.move(x+i*10,y);await page.mouse.up();await page.keyboard.up('Shift');const d=await st();
    check('Shift-drag looks around without moving you',d.E.every((v,i)=>v===c.E[i])&&d.yaw!==c.yaw,{E0:c.E,E1:d.E})},
  async detents(){const r=await page.evaluate(()=>{const P=window.__pv,S=window.__state;S.pv={...S.pv,boxes:S.pv.boxes.map(b=>({...b,ry:20}))};P.sel=null;P.render();return{one:P.detentYaw(21.7),corner:P.detentYaw(20+44),cl:P.detentYaw(20+31.5),free:P.detentYaw(20+12)}});
    check('View detents: square-on (1-point), 45° and 30/60 corners click into place relative to the box',r.one.yaw===20&&r.corner.yaw===65&&Math.abs(r.cl.yaw-50)<1e-9&&r.free.name==null,r)},
  async level(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'));const S=window.__state,P=window.__pv,F=P.focus();S.pv={...S.pv,eye:{x:F[0],y:F[1]+3,z:F[2]-120},yaw:0,pitch:-1.43};P.render()});
    const box=await (await page.$('#canvasWrap')).boundingBox();const x=box.x+120,y=box.y+box.height-90;await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=3;i++)await page.mouse.move(x+1,y+i);await page.mouse.up();
    const p=await page.evaluate(()=>window.__state.pv.pitch);check('Level detent: orbiting near level snaps the pitch to exactly 0, so verticals stay parallel',p===0,p)},
  async dolly(){const a=await page.evaluate(()=>{const P=window.__pv,S=window.__state,F=P.focus();return{F,E:{...S.pv.eye},yaw:S.pv.yaw,pitch:S.pv.pitch}});
    const box=await (await page.$('#canvasWrap')).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-240);await page.waitForTimeout(400);
    const c=await page.evaluate(()=>{const S=window.__state;return{E:{...S.pv.eye},yaw:S.pv.yaw,pitch:S.pv.pitch}});const r=E=>Math.hypot(E.x-a.F[0],E.y-a.F[1],E.z-a.F[2]);
    const dir=E=>[E.x-a.F[0],E.y-a.F[1],E.z-a.F[2]].map(v=>v/r(E));const cos=dir(a.E).reduce((s,v,i)=>s+v*dir(c.E)[i],0);
    check('Scroll moves you closer along the line to the subject (same direction, same aim)',r(c.E)<r(a.E)-1&&cos>1-1e-9&&c.yaw===a.yaw&&c.pitch===a.pitch,{r0:r(a.E),r1:r(c.E),cos})},
  async lens(){// the size of the subject where you're looking: a 12 in upright through the focus
    const size=()=>page.evaluate(()=>{const P=window.__pv,K=P.camera(),F=P.focus(),a=P.img(K,P.toCam(K,[F[0],F[1]-6,F[2]])),b=P.img(K,P.toCam(K,[F[0],F[1]+6,F[2]]));return Math.hypot(a[0]-b[0],a[1]-b[1])});
    await page.evaluate(()=>{const S=window.__state,P=window.__pv,F=P.focus();S.pv={...S.pv,eye:{x:F[0],y:F[1],z:F[2]-140},yaw:0,pitch:0};P.render()});const s0=await size();
    await page.$eval('#pvDist',e=>{e.value=18;e.dispatchEvent(new Event('input',{bubbles:true}))});const s1=await size();await page.$eval('#pvDist',e=>{e.value=110;e.dispatchEvent(new Event('input',{bubbles:true}))});const s2=await size();
    check('Lens is a dolly zoom: wide or long, the subject keeps its size on the canvas (< 0.1%)',Math.abs(s1/s0-1)<1e-3&&Math.abs(s2/s0-1)<1e-3,{s0,s1,s2})},
  async shots(){for(const sc of ['blank','overhead','street','room']){const r=await page.evaluate(sc=>{const s=document.querySelector('#pvScene');s.value=sc;s.dispatchEvent(new Event('change'));const P=window.__pv,S=window.__state,out={};
      P.SHOTS.forEach(sh=>{const cam=P.frameShot(sh.spec),pv={...S.pv,...cam},K=P.camera(pv),pts=P.sceneOf(pv,K).flatMap(I=>I.P);let inside=0;
        pts.forEach(p=>{const c=P.toCam(K,p),q=P.img(K,c);if(!q)return;const u=q[0]+cam.cv.x+pv.canvas.w/2,v=q[1]+cam.cv.y+pv.canvas.h/2;if(u>=-1e-6&&u<=pv.canvas.w+1e-6&&v>=-1e-6&&v<=pv.canvas.h+1e-6)inside++});
        out[sh.id]={frac:inside/pts.length,pitch:cam.pitch,roll:cam.roll,proj:cam.proj,eyeY:cam.eye.y,hz:cam.cv.y+pv.canvas.h/2,H:pv.canvas.h}});return out},sc);
      const levelOk=['eye','corner','long'].every(k=>r[k].pitch===0&&[1/3,2/3].some(f=>Math.abs(r[k].hz-f*r[k].H)<1e-6));
      const framed=['eye','corner','worm','bird','dutch','long'].every(k=>r[k].frac===1);
      check(`Shots (${sc}): the classic views each fit the whole scene on the canvas; level ones keep verticals and put the horizon on a third`,framed&&levelOk&&r.worm.eyeY===6&&r.bird.pitch<-30&&r.dutch.roll===14&&r.up.pitch===90&&r.up.proj==='curvi'&&r.fisheye.proj==='curvi',r)}},
  async glide(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'))});await page.waitForTimeout(300);
    const want=await page.evaluate(()=>window.__pv.frameShot(window.__pv.SHOTS.find(s=>s.id==='corner').spec));await page.click('[data-shot="corner"]');await page.waitForTimeout(900);
    const got=await page.evaluate(()=>{const v=window.__state.pv;return{eye:v.eye,yaw:v.yaw,pitch:v.pitch,cv:v.cv,dist:v.dist}});
    const thumbs=await page.$$eval('.pv-shot svg',x=>x.length);
    check('Click a shot: the camera glides there (one undo step) and every shot has a thumbnail',Math.hypot(got.eye.x-want.eye.x,got.eye.y-want.eye.y,got.eye.z-want.eye.z)<1e-6&&got.yaw===want.yaw&&got.pitch===want.pitch&&got.cv.y===want.cv.y&&thumbs===8,{want,got,thumbs});
    await page.click('#undoBtn');const back=await page.evaluate(()=>window.__state.pv.yaw);check('Undo takes the whole glide back in one step',back!==want.yaw,back)},
  async horizon(){await page.evaluate(()=>{const P=window.__pv,S=window.__state;S.pv={...S.pv,pitch:0,roll:0,cv:{x:0,y:2}};P.render()});
    const h=await page.evaluate(()=>{const el=document.querySelector('.pv-hz-hit'),r=el.getBoundingClientRect(),P=window.__pv,S=window.__state,R=document.querySelector('.pv-frame').getBoundingClientRect();return{x:R.x+R.width*.2,y:r.y+r.height/2,third:R.y+R.height*(1-1/3)}});
    await page.mouse.move(h.x,h.y);await page.mouse.down();await page.mouse.move(h.x,h.third+3,{steps:6});await page.mouse.up();
    const v=await page.evaluate(()=>{const S=window.__state;return S.pv.cv.y+S.pv.canvas.h/2});const H=await page.evaluate(()=>window.__state.pv.canvas.h);
    check('Drag the horizon near a third and it lands exactly on it',Math.abs(v-H/3)<1e-9,{v,H3:H/3})},
  async comp(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'));const S=window.__state;S.pv={...S.pv,pitch:0,roll:0,cv:{x:0,y:2}};window.__pv.render()});
    const r=await page.evaluate(()=>{const P=window.__pv,S=window.__state,K=P.camera(),b=S.pv.boxes[0],c=[b.x,b.y+b.h/2,b.z],q=P.img(K,P.toCam(K,c)),W=S.pv.canvas.w,H=S.pv.canvas.h;
      // nudge the box so its middle sits a hair off the lower-left thirds point, then ask where it snaps
      const tx=W/3-W/2-S.pv.cv.x+.15,ty=H/3-H/2-S.pv.cv.y+.1,d=P.rayDir(K,tx,ty),t=(c[1]-K.E[1])/d[1],w=[K.E[0]+d[0]*t,K.E[2]+d[2]*t],s=P.compSnap(K,{...b,x:w[0],z:w[1]});if(!s)return{none:true};
      const q2=P.img(K,P.toCam(K,[s.x,c[1],s.z]));return{name:s.name,u:q2[0]+S.pv.cv.x+W/2,v:q2[1]+S.pv.cv.y+H/2,W,H}});
    check('Move a box near a thirds point and its middle lands exactly on it',!r.none&&Math.abs(r.u-r.W/3)<1e-6&&Math.abs(r.v-r.H/3)<1e-6&&r.name==='ON THE THIRDS',r)},
  async vpEdge(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='street';s.dispatchEvent(new Event('change'))});await page.waitForTimeout(100);
    const vp=await page.evaluate(()=>{const g=[...document.querySelectorAll('#overlayLayer .pv-vp')].find(g=>g.querySelector('.vp-handle'));const c=g.querySelector('.vp-handle').getBoundingClientRect(),R=document.querySelector('.pv-frame').getBoundingClientRect();return{x:c.x+c.width/2,y:c.y+c.height/2,dir:g.dataset.dir,edge:R.x}});
    await page.mouse.move(vp.x,vp.y);await page.mouse.down();await page.mouse.move(vp.edge+4,vp.y,{steps:8});await page.mouse.up();
    const u=await page.evaluate(d=>{const P=window.__pv,K=P.camera(),v=d.split(',').map(Number),c=K.CT.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);return P.onCanvas(P.dirImg(K,c))[0]},vp.dir);
    check('Drag a vanishing point near the canvas edge and it sits exactly on the edge',Math.abs(u)<1e-3,u)},
  async pivot(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='overhead';s.dispatchEvent(new Event('change'))});
    const pos=()=>page.evaluate(()=>{const P=window.__pv,S=window.__state;return P.instances(S.pv,S.pv.boxes[0]).map(I=>I.t.map(v=>+v.toFixed(9)))});const a=await pos();
    await page.evaluate(()=>{const S=window.__state,P=window.__pv;S.pv={...S.pv,eye:{x:140,y:30,z:-60}};P.render()});const c=await pos();
    check('Rings and arches stay put in the room when you walk away from where you made them',JSON.stringify(a)===JSON.stringify(c))},
  async roll(){const s=await page.evaluate(()=>{const P=window.__pv,S=window.__state;S.pv={...S.pv,proj:'linear',pitch:0,roll:14};const K=P.camera(),G=P.circleOf(K,K.CT.map(r=>r[1]));return Math.atan2(G.d[1],G.d[0])*180/Math.PI});
    check('Dutch tilt rolls the horizon by exactly its angle',Math.abs(Math.abs(s)-14)<1e-9||Math.abs(Math.abs(s)-166)<1e-9,s)},
  async reference(){await page.evaluate(()=>{const S=window.__state,P=window.__pv;S.pv={...S.pv,roll:0};P.render()});await page.click('#pvRefBtn');await page.waitForTimeout(250);
    const r=await page.evaluate(()=>({side:getComputedStyle(document.querySelector('.sidebar')).display,shots:getComputedStyle(document.querySelector('#pvShots')).display,ticks:document.querySelectorAll('#overlayLayer .pv-ticks,#overlayLayer .pv-vp,#overlayLayer .pv-cv').length,frame:document.querySelector('#overlayLayer .pv-frame').getBoundingClientRect().width,vw:innerWidth}));
    await page.keyboard.press('Escape');await page.waitForTimeout(200);const back=await page.evaluate(()=>getComputedStyle(document.querySelector('.sidebar')).display);
    check('Reference view: just the picture, big (no sidebar, shots, rulers or markers), and Esc brings the tools back',r.side==='none'&&r.shots==='none'&&r.ticks===0&&back!=='none',{...r,back})},
  async flyaway(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'));const S=window.__state,P=window.__pv,b=S.pv.boxes[0];S.pv={...S.pv,eye:{x:0,y:12,z:0},pitch:0,yaw:0,cv:{x:0,y:0}};P.sel=null;P.render()});
    const at=await page.evaluate(()=>{const P=window.__pv,S=window.__state,b=S.pv.boxes[0],K=P.camera(),[x,y]=P.toSvg(P.img(K,P.toCam(K,[b.x+6,12,b.z-12]))),m=document.querySelector('#geometry').getScreenCTM(),q=new DOMPoint(x,y).matrixTransform(m);return[q.x,q.y]});
    await page.mouse.move(at[0],at[1]);await page.mouse.down();for(let i=1;i<=10;i++)await page.mouse.move(at[0]+20*i,at[1]);await page.mouse.up();
    const b=await page.evaluate(()=>window.__state.pv.boxes[0]);check('Grab a box right at eye level and drag: it moves a sane distance instead of flying to the horizon',Math.hypot(b.x,b.z-96)<120&&Math.abs(b.x)>3,[b.x,b.z])},
  async addBeside(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'));window.__pv.sel={id:1,k:0};window.__pv.render()});await page.click('#pvAdd');
    const r=await page.evaluate(()=>{const [a,b]=window.__state.pv.boxes,th=a.ry*Math.PI/180,lx=(b.x-a.x)*Math.cos(th)-(b.z-a.z)*Math.sin(th),lz=(b.x-a.x)*Math.sin(th)+(b.z-a.z)*Math.cos(th);return{lx,lz,same:a.w===b.w&&a.h===b.h&&a.ry===b.ry&&a.y===b.y}});
    check('+ Box with a box selected: a twin lands flush beside it, same size and turn',Math.abs(Math.abs(r.lx)-24)<.06&&Math.abs(r.lz)<.06&&r.same,r);
    await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'));window.__pv.sel=null;window.__pv.render()});await page.click('#pvAdd');await page.keyboard.press('Escape');await page.click('#pvAdd');
    const ys=await page.evaluate(()=>window.__state.pv.boxes.map(b=>b.y));check('+ Box with nothing selected finds clear floor (no towers by accident)',ys.length===3&&ys.every(y=>y===0),ys)},
  async vpsAll(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'));window.__pv.sel=null;window.__pv.render();window.__pv.sync()});await page.waitForTimeout(50);
    const rows=await page.$$eval('#pvReadout .pv-row span',x=>x.map(e=>e.textContent));check('Every box’s own vanishing points are listed, selected or not',rows.some(t=>/^box /i.test(t)),rows);
    const names=await page.evaluate(()=>{const P=window.__pv,S=window.__state;S.pv={...S.pv,proj:'curvi',yaw:-57,pitch:80};const K=P.camera();return P.vanishing(K,[[1,0,0],[0,1,0],[0,0,1],[Math.cos(.5),0,Math.sin(.5)],[Math.cos(1),0,Math.sin(1)]]).map(v=>v.name)});
    check('Vanishing point names never repeat',new Set(names).size===names.length,names)},
  async aimLevel(){const r=await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='street';s.dispatchEvent(new Event('change'));const P=window.__pv,S=window.__state;P.sel={id:2,k:3};P.aim();P.render();const K=P.camera(),I=P.sceneOf(S.pv,K).find(I=>I.b.id===2&&I.k===3),c=[0,1,2].map(k=>I.t[k]+I.R[k][1]*I.h/2),q=P.img(K,P.toCam(K,c));return{pitch:S.pv.pitch,q:[q[0]+S.pv.cv.x,q[1]+S.pv.cv.y]}});
    check('Aim from a level view stays level (it shifts the lens rather than tilting) and centres the box',r.pitch===0&&Math.hypot(...r.q)<.02,r)},
  async exportClean(){await page.evaluate(()=>{window.__pv.sel={id:1,k:0};window.__pv.render()});const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#exportBtn')]);const svg=require('fs').readFileSync(await dl.path(),'utf8');
    const vb=(svg.match(/viewBox="([^"]+)"/)||[])[1].split(' ').map(Number),fr=await page.evaluate(()=>window.__pv.frame());
    check('Export in Perspective is just the canvas: cropped to it, no rulers, markers or selection',!svg.includes('id="overlayLayer"')&&!svg.includes('class="pv-sel')&&Math.abs(vb[2]-fr.w)<1e-6&&Math.abs(vb[3]-fr.h)<1e-6,{vb,fr:[fr.w,fr.h]})},
  async planDrag(){await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='blank';s.dispatchEvent(new Event('change'))});await page.waitForTimeout(100);
    const r=await page.evaluate(()=>{const e=document.querySelector('#pvPlan [data-box]').getBoundingClientRect();return{x:e.x+e.width/2,y:e.y+e.height/2,b:{...window.__state.pv.boxes[0]}}});
    await page.mouse.move(r.x,r.y);await page.mouse.down();await page.mouse.move(r.x-25,r.y,{steps:5});await page.mouse.up();const b=await page.evaluate(()=>window.__state.pv.boxes[0]);
    check('Drag a box in the plan and it moves (the view wedge no longer gets in the way)',b.x<r.b.x-3,{from:r.b.x,to:b.x})},
  async speed(){const ms=await page.evaluate(()=>{const s=document.querySelector('#pvScene');s.value='overhead';s.dispatchEvent(new Event('change'));const P=window.__pv;for(let i=0;i<3;i++)P.render();const xs=[];for(let i=0;i<15;i++){const t=performance.now();P.render();xs.push(performance.now()-t)}xs.sort((a,b)=>a-b);return xs[7]});
    check('Drawing the busiest scene takes under 20 ms (median)',ms<20,+ms.toFixed(1))}};
for(const k of Object.keys(T))await T[k]();
  }
  // ── at the easel: Android phone and tablet, driven with real touch events (CDP), so pointerType is 'touch'
  const touchCtx = async dev => { const c = await browser.newContext({ ...dev, colorScheme: 'dark' }); await c.addInitScript(() => { window.__buzz = []; navigator.vibrate = ms => { window.__buzz.push(ms); return true; }; }); return c; };
  for (const [dn, dev] of [['Galaxy S24', devices['Galaxy S24']], ['Galaxy Tab S9', devices['Galaxy Tab S9']]]) {
    const tctx = await touchCtx(dev), tp = await tctx.newPage();
    tp.on('pageerror', e => errors.push(dn + ': ' + e.message));
    await tp.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await tp.goto('file://' + file);
    await tp.evaluate(() => document.querySelector('#appMode [data-app="perspective"]').click()); await tp.waitForTimeout(400);
    const cdp = await tctx.newCDPSession(tp), T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await tp.waitForTimeout(30); await T('touchEnd', []); await tp.waitForTimeout(60); };
    const swipe = async (x0, y0, x1, y1, n = 10) => { await T('touchStart', [{ x: x0, y: y0 }]); for (let i = 1; i <= n; i++) { await T('touchMove', [{ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n }]); await tp.waitForTimeout(16); } await T('touchEnd', []); await tp.waitForTimeout(80); };
    const mid = sel => tp.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
    const shown = sel => tp.evaluate(s => { const e = document.querySelector(s), r = e && e.getBoundingClientRect(); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && r.width > 0; }, sel);
    const sheet = () => tp.evaluate(() => { const s = document.querySelector('.sidebar'); return { tab: s.dataset.tab, sheet: s.dataset.sheet }; });
    const n = () => tp.evaluate(() => window.__state.pv.boxes.length);
    const lay = await tp.evaluate(() => { const f = document.querySelector('.pv-frame').getBoundingClientRect(), s = document.querySelector('.sidebar').getBoundingClientRect(); return { frame: Math.round(f.width), vw: innerWidth, sheetTop: Math.round(s.top), vh: innerHeight, scroll: document.documentElement.scrollHeight - innerHeight }; });
    check(`${dn}: the drawing gets the screen (canvas ≥ 80% of the width, no page scroll)`, lay.frame >= lay.vw * .8 && lay.scroll <= 0, lay);
    check(`${dn}: controls start as a sheet peeking from the bottom`, (await sheet()).sheet === 'peek' && lay.vh - lay.sheetTop < 100, lay);
    await tap(...await mid('.pv-tabs [data-t="camera"]')); await tp.waitForTimeout(400);
    const tabs = await tp.evaluate(() => [...document.querySelectorAll('#pvSide [data-tab]')].filter(e => e.offsetParent).map(e => e.dataset.tab));
    check(`${dn}: tapping a tab opens the sheet half way on just that tab`, (await sheet()).sheet === 'half' && tabs.length && tabs.every(t => t === 'camera'), { s: await sheet(), tabs });
    const wide = []; for (const t of ['scene', 'canvas', 'camera', 'box', 'guides', 'measure']) { await tp.evaluate(t => { if (t === 'box') { window.__pv.sel = { id: 1, k: 0 }; window.__pv.render(); window.__pv.sync(); } window.__pv.openTab(t); }, t); await tp.waitForTimeout(120);
      wide.push(...await tp.evaluate(t => { const s = document.querySelector('.sidebar'); return s.scrollWidth > s.clientWidth + 1 ? [t + ':' + s.scrollWidth] : []; }, t)); }
    check(`${dn}: every tab fits the sheet's width (nothing cut off at the right)`, !wide.length, wide);
    await tp.evaluate(() => { window.__pv.sel = null; window.__pv.render(); window.__pv.sync(); window.__pv.openTab('camera'); }); await tp.waitForTimeout(400);
    const g = await mid('.pv-grip'); await swipe(g[0], g[1], g[0], 40); await tp.waitForTimeout(450);
    check(`${dn}: drag the grip up and the sheet opens full`, (await sheet()).sheet === 'full', await sheet());
    const g2 = await mid('.pv-grip'); await swipe(g2[0], g2[1], g2[0], lay.vh - 10, 12); await tp.waitForTimeout(450);
    check(`${dn}: drag it down and it tucks away`, (await sheet()).sheet === 'peek', await sheet());
    await tap(...await mid('.pv-tabs [data-t="camera"]')); await tp.waitForTimeout(350);
    check(`${dn}: a tap straight after flicking the sheet shut still lands (Chrome's fling tap-suppression)`, (await sheet()).sheet === 'half', await sheet());
    await tp.goBack({ waitUntil: 'commit' }).catch(() => {}); await tp.waitForTimeout(400);
    check(`${dn}: Android back closes the sheet and stays on the page`, (await sheet()).sheet === 'peek' && await tp.evaluate(() => document.body.classList.contains('pv-app')), await sheet());
    await tap(...await mid('.pv-tabs [data-t="camera"]')); await tp.waitForTimeout(300); await tap(...await mid('.pv-tabs [data-t="camera"]')); await tp.waitForTimeout(500);
    check(`${dn}: closing the sheet by hand leaves no dead back entry`, (await sheet()).sheet === 'peek' && !(await tp.evaluate(() => history.state && history.state.locus)));
    await tp.evaluate(() => { window.__pv.sel = { id: 1, k: 0 }; window.__pv.render(); window.__pv.sync(); window.__pv.openTab('box'); }); await tp.waitForTimeout(400);
    await tp.evaluate(() => document.querySelector('#pvH').focus()); await tp.waitForTimeout(700);
    const kb = await tp.evaluate(() => ({ sheet: document.querySelector('.sidebar').dataset.sheet, y: Math.round(document.querySelector('#pvH').getBoundingClientRect().top), vh: innerHeight }));
    check(`${dn}: tap a size field and the sheet lifts it clear of the keyboard (top half)`, kb.sheet === 'full' && kb.y < kb.vh * .5, kb);
    await tp.evaluate(() => { document.activeElement.blur(); window.__pv.sel = null; window.__pv.render(); window.__pv.sync(); window.__pv.setSheet('peek'); }); await tp.waitForTimeout(400);
    const face = await tp.evaluate(() => { const W = document.querySelector('#canvasWrap').getBoundingClientRect(), sb = document.querySelector('.sidebar').getBoundingClientRect().top; let best = null;
      document.querySelectorAll('#geometry .pv-face').forEach(f => { const r = f.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2; if (cx < W.x + 20 || cx > W.right - 20 || cy < W.y + 20 || cy > Math.min(W.bottom, sb) - 20) return; const a = r.width * r.height; if (!best || a > best.a) best = { a, cx, cy }; }); return best; });
    await tap(face.cx, face.cy); await tp.waitForTimeout(250);
    const bar = await tp.evaluate(() => { const b = document.querySelector('#pvBoxBar'), r = b.getBoundingClientRect(), W = document.querySelector('#canvasWrap').getBoundingClientRect(); return { on: !b.hidden, inside: r.left >= W.left - 1 && r.right <= W.right + 1 && r.top >= W.top - 1, btn: Math.min(...[...b.querySelectorAll('button')].map(x => x.getBoundingClientRect().height)) }; });
    check(`${dn}: tap a box and a finger-sized bar floats under it`, bar.on && bar.inside && bar.btn >= 44, bar);
    const act = async a => { await tap(...await mid(`#pvBoxBar [data-act="${a}"]`)); await tp.waitForTimeout(200); };
    let c0 = await n(); await act('dup'); check(`${dn}: bar · Copy adds a box`, await n() === c0 + 1);
    const top = await tp.evaluate(() => { const b = window.__state.pv.boxes; return b[b.length - 1]; }); await act('stack');
    const st = await tp.evaluate(() => { const b = window.__state.pv.boxes; return b[b.length - 1]; });
    check(`${dn}: bar · Stack sets a copy on top`, Math.abs(st.y - (top.y + top.h)) < 1e-6 && st.id !== top.id, { top, st });
    await act('rot'); const rot = await tp.evaluate(() => { const b = window.__state.pv.boxes; return b[b.length - 1].ry; });
    check(`${dn}: bar · 90° turns it a quarter`, Math.abs(rot - (st.ry || 0) - 90) < 1e-6, [st.ry, rot]);
    c0 = await n(); await act('del'); check(`${dn}: bar · Delete removes it and the bar goes`, await n() === c0 - 1 && !(await shown('#pvBoxBar')));
    await tap(face.cx, face.cy); await tp.waitForTimeout(250); await act('edit'); await tp.waitForTimeout(350);
    check(`${dn}: bar · Edit opens the edit tray (the sheet stays down)`, await shown('#pvTray') && (await sheet()).sheet === 'peek', await sheet());
    await tap(...await mid('#pvTray [data-ta="more"]')); await tp.waitForTimeout(400);
    check(`${dn}: tray · ⋯ opens the Box tab for exact numbers and repeats`, (await sheet()).tab === 'box' && await shown('#pvBoxPanel') && !(await shown('#pvTray')), await sheet());
    await tp.evaluate(() => { window.__pv.setSheet('peek'); window.__pv.sel = null; window.__pv.render(); window.__pv.sync(); }); await tp.waitForTimeout(400);
    const spot = await tp.evaluate(() => { const W = document.querySelector('#canvasWrap').getBoundingClientRect(), sb = document.querySelector('.sidebar').getBoundingClientRect().top, faces = [...document.querySelectorAll('#geometry .pv-face')].map(f => f.getBoundingClientRect()), bot = Math.min(W.bottom, sb) - 30;
      for (let y = bot; y > W.y + W.height * .55; y -= 12) for (let x = W.x + 30; x < W.right - 120; x += 12) if (!faces.some(r => x > r.left - 14 && x < r.right + 14 && y > r.top - 14 && y < r.bottom + 14)) return [x, y]; return null; });
    c0 = await n(); await tap(...spot); await tp.waitForTimeout(90); await tap(...spot); await tp.waitForTimeout(250);
    check(`${dn}: double-tap the floor adds a box there`, await n() === c0 + 1, spot);
    c0 = await n(); await tap(spot[0] + 4, spot[1] - 40); await tp.waitForTimeout(450); check(`${dn}: a single tap adds nothing`, await n() === c0);
    // reference view at the easel
    await tap(...await mid('#pvRefBtn')); await tp.waitForTimeout(500);
    check(`${dn}: Reference: the sheet goes, the big bar comes`, await tp.evaluate(() => document.body.classList.contains('pv-ref')) && !(await shown('.sidebar')) && await shown('#pvRefBar'));
    const rbtn = await tp.evaluate(() => { const W = document.querySelector('#canvasWrap').getBoundingClientRect(); return [...document.querySelectorAll('#pvRefBar button')].map(b => { const r = b.getBoundingClientRect(); return { r: b.dataset.r, h: r.height, in: r.left >= W.left && r.right <= W.right }; }); });
    check(`${dn}: Reference: every button on screen and ≥ 48px`, rbtn.every(b => b.in && b.h >= 48), rbtn);
    const W = await tp.evaluate(() => { const r = document.querySelector('#canvasWrap').getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width }; });
    const y0 = await tp.evaluate(() => window.__state.pv.yaw), s0 = await tp.textContent('#pvRefShot');
    await tp.evaluate(() => window.__buzz.length = 0); await swipe(W.cx + W.w * .3, W.cy, W.cx - W.w * .3, W.cy, 8); await tp.waitForTimeout(900); const s1 = await tp.textContent('#pvRefShot');
    check(`${dn}: Reference: swipe to the next shot (with a tick), the view locked against stray touches`, s1 !== s0 && s1.includes('·') && await tp.evaluate(() => window.__buzz.length) > 0, [s0, s1]);
    await swipe(W.cx - W.w * .3, W.cy, W.cx + W.w * .3, W.cy, 8); await tp.waitForTimeout(900);
    check(`${dn}: Reference: swipe back`, await tp.textContent('#pvRefShot') !== s1);
    const rb = async r => { await tap(...await mid(`#pvRefBar [data-r="${r}"]`)); await tp.waitForTimeout(150); };
    const sqs = []; for (let i = 0; i < 5; i++) { await rb('grid'); sqs.push(await tp.evaluate(() => [window.__state.pv.sq || 0, document.querySelectorAll('#geometry .pv-sq-label').length])); }
    check(`${dn}: Reference: Grid steps 6″ → 3″ → 12″ → 2″ → off, lettered and numbered`, sqs.map(x => x[0]).join() === '6,3,12,2,0' && sqs[0][1] > 4 && sqs[4][1] === 0, sqs);
    await rb('lock'); const ly0 = await tp.evaluate(() => window.__state.pv.yaw); await swipe(W.cx - 60, W.cy, W.cx + 60, W.cy + 20, 8); await tp.waitForTimeout(200);
    check(`${dn}: Reference: unlocked, a drag turns the view`, !(await tp.evaluate(() => window.__pv.refLock)) && Math.abs(await tp.evaluate(() => window.__state.pv.yaw) - ly0) > 1);
    await rb('lock'); await tp.waitForTimeout(3800);
    check(`${dn}: Reference: the bar fades when left alone, a tap brings it back`, await tp.evaluate(() => document.querySelector('#pvRefBar').classList.contains('idle')) && (await tap(W.cx, W.cy), await tp.waitForTimeout(200), await tp.evaluate(() => !document.querySelector('#pvRefBar').classList.contains('idle'))));
    await rb('exit'); await tp.waitForTimeout(400);
    check(`${dn}: Reference: ✕ leaves and the sheet returns`, !(await tp.evaluate(() => document.body.classList.contains('pv-ref'))) && await shown('.sidebar'));
    await tap(...await mid('#pvRefBtn')); await tp.waitForTimeout(400); await tp.goBack({ waitUntil: 'commit' }).catch(() => {}); await tp.waitForTimeout(400);
    check(`${dn}: Android back leaves Reference view, not the page`, !(await tp.evaluate(() => document.body.classList.contains('pv-ref'))) && await tp.evaluate(() => document.body.classList.contains('pv-app')));
    await tctx.close();
  }
  // ── an Android tablet on its side: the controls become a side panel and the drawing gets the height
  {
    const lctx = await touchCtx(devices['Galaxy Tab S9 landscape']), lp = await lctx.newPage(); lp.on('pageerror', e => errors.push('Tab landscape: ' + e.message));
    await lp.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await lp.goto('file://' + file);
    await lp.evaluate(() => document.querySelector('#appMode [data-app="perspective"]').click()); await lp.waitForTimeout(400);
    const L = await lp.evaluate(() => { const f = document.querySelector('.pv-frame').getBoundingClientRect(), s = document.querySelector('.sidebar'), t = document.querySelector('.pv-tabs'), sr = s.getBoundingClientRect();
      return { side: document.body.classList.contains('pv-side'), frame: Math.round(f.height), vh: innerHeight, panel: [Math.round(sr.left), Math.round(sr.width), Math.round(sr.height)], tabsFit: t.scrollWidth <= t.clientWidth + 1, scroll: document.documentElement.scrollHeight - innerHeight }; });
    check('Tab landscape: controls move to a side panel and the drawing gets ⅔ of the height', L.side && L.frame >= L.vh * .66 && L.panel[0] > 600 && L.tabsFit && L.scroll <= 0, L);
    await lp.evaluate(() => window.__pv.openTab('box')); await lp.waitForTimeout(300);
    check('Tab landscape: the panel never slides and leaves no back entry', await lp.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).transform === 'none' && !(history.state && history.state.locus)));
    await lp.evaluate(() => window.__pv.setRef(true)); await lp.waitForTimeout(400);
    check('Tab landscape: Reference view takes the whole screen', await lp.evaluate(() => Math.round(document.querySelector('#canvasWrap').getBoundingClientRect().width) === innerWidth));
    const rail = await lp.evaluate(() => { const f = document.querySelector('.pv-frame').getBoundingClientRect(), r = document.querySelector('#pvRefBar').getBoundingClientRect(); return { clear: r.left >= f.right || r.right <= f.left || r.top >= f.bottom || r.bottom <= f.top, onScreen: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth, f: [f.left, f.right].map(Math.round), r: [r.left, r.top, r.height].map(Math.round) }; });
    check('Tab landscape: Reference controls stand in a rail beside the drawing, never on it', rail.clear && rail.onScreen, rail);
    await lctx.close();
  }
  // the squaring grid goes out with the drawing
  await page.setViewportSize({ width: 1400, height: 900 });
  const sqOut = await page.evaluate(() => { const s = document.querySelector('#pvScene'); s.value = 'totem'; s.dispatchEvent(new Event('change')); const S = window.__state; S.pv = { ...S.pv, sq: 6 }; window.__pv.render();
    const P = window.__pv, f = P.frame(), lines = [...document.querySelectorAll('#geometry [data-kind="sq"], #geometry .pv-sq')].length; return { lines, w: f.w, h: f.h, tower: S.pv.boxes[0].arr }; });
  check('Squaring grid draws on the canvas (and so goes out with it)', sqOut.lines > 0, sqOut);
  const sqHarvest = await page.evaluate(() => { const g = window.__studio.geometry(); const st = (g.strokes || g).filter(s => s.kind === 'sq'); return { n: st.length, layer: [...new Set(st.map(s => s.layer))] }; });
  check('…and reaches the Studio on the Construction layer, which is on by default', sqHarvest.n > 0 && sqHarvest.layer.join() === 'construction', sqHarvest);
  const tw = await page.evaluate(() => { const P = window.__pv, S = window.__state, b = S.pv.boxes[0], I = P.instances(S.pv, b), ang = R => Math.atan2(R[0][2], R[0][0]) * 180 / Math.PI; return I.slice(0, 3).map(i => ang(i.R)); });
  check('Tower twist turns each cube that much more than the one below', Math.abs(Math.abs(tw[1] - tw[0]) - 9) < 1e-6 && Math.abs(Math.abs(tw[2] - tw[1]) - 9) < 1e-6, tw);
  const totMs = await page.evaluate(() => { const P = window.__pv; for (let i = 0; i < 3; i++) P.render(); const xs = []; for (let i = 0; i < 15; i++) { const t = performance.now(); P.render(); xs.push(performance.now() - t); } xs.sort((a, b) => a - b); return xs[7]; });
  check('Totem (69 cubes) draws under 25 ms (median)', totMs < 25, +totMs.toFixed(1));
  // ── walk: first person at any size. Physics, driven step by step so the numbers are exact
  await page.setViewportSize({ width: 1400, height: 900 });
  const WK = await page.evaluate(() => {
    const P = window.__pv, S = window.__state, ARR = { type: 'none', n: 6, n2: 3, gap: 6, span: 180, axis: 'across', twist: 0 };
    const box = (id, x, y, z, s, e = {}) => ({ id, x, y, z, w: s, h: s, d: s, ry: 0, rx: 0, ...e, arr: { ...ARR, ...(e.arr || {}) } });
    const scene = (boxes, eye, yaw = 0, size = 68) => { if (P.walking) P.walkStop(false); S.pv = { ...S.pv, guy: null, proj: 'linear', eye, yaw, pitch: 0, roll: 0, cv: { x: 0, y: 0 }, boxes }; P.render(); P.walkStart(); P.setWalkSize(size); };
    const w = () => P.walking, run = (sec, inp) => { const tr = []; for (let t = 0; t < sec; t += 1 / 60) { P.walkStep(1 / 60, typeof inp === 'function' ? inp(t) : inp); tr.push([w().p[0], w().p[1], w().p[2], w().ground]); } return tr; };
    const o = {}; let j;
    scene([box(1, 0, 0, 60, 24)], { x: 0, y: 62, z: 0 }); run(.3, {}); o.stand = [w().p[1], w().ground];
    o.face = run(3, { fwd: 1 }).at(-1)[2];
    j = 0; const up = run(1.2, () => ({ fwd: w().p[2] < 56 ? 1 : 0, jump: !j && (j = 1) })); /* let go of forward once over the box, or you sail past it */ const iTop = up.findIndex(x => Math.abs(x[1] - 24) < 1e-9 && x[3]);
    o.onTop = iTop >= 0; if (o.onTop) { w().p = up[iTop].slice(0, 3); w().v = [0, 0, 0]; w().ground = true; o.stay = run(.6, {}).at(-1)[1]; }
    o.offEdge = run(2.5, { fwd: 1 }).at(-1)[1];
    scene([box(1, 0, 0, 60, 24)], { x: 0, y: 4, z: 40 }, 0, 4); run(.3, {}); j = 0; const tiny = run(3, t => ({ fwd: 1, jump: t > .3 && !j && (j = 1) })); o.tiny = { maxY: Math.max(...tiny.map(x => x[1])), z: tiny.at(-1)[2] };
    scene([box(1, 0, 0, 40, 6, { w: 60, d: 30 })], { x: 0, y: 62, z: 0 }); o.step = run(1, { fwd: 1 }).some(x => Math.abs(x[1] - 6) < 1e-9 && x[3]);
    scene([box(1, 40, 0, 0, 12, { ry: 30 })], { x: 0, y: 20, z: 0 }, 90, 20); const I = P.solids()[0], tr = run(3, { fwd: 1 });
    o.notInside = tr.every(([x, y, z]) => { const q = [x - I.t[0], y - I.t[1], z - I.t[2]], lx = I.RT[0][0] * q[0] + I.RT[0][2] * q[2], lz = I.RT[2][0] * q[0] + I.RT[2][2] * q[2]; return !(Math.abs(lx) < I.hw - .01 && Math.abs(lz) < I.hd - .01 && y < I.h); });
    scene([box(1, 0, 80, 0, 30, { w: 80, d: 80 })], { x: 0, y: 62, z: 0 }); run(.3, {}); j = 0; o.ceil = Math.max(...run(1.5, () => ({ jump: !j && (j = 1) })).map(x => x[1]));
    const dist = size => { scene([], { x: 0, y: 1, z: 0 }, 0, size); run(.5, {}); const z0 = w().p[2]; run(1, { fwd: 1 }); return w().p[2] - z0; }; o.speedRatio = dist(68) / dist(4);
    scene([box(1, 0, 0, 3, 1)], { x: 0, y: .25, z: 0 }, 0, .25); P.render(); o.ant = { faces: document.querySelectorAll('#geometry .pv-face').length, eye: S.pv.eye.y };
    P.walkStop(false); return o;
  });
  check('Walk: you stand on the floor', WK.stand[0] === 0 && WK.stand[1], WK.stand);
  check('Walk: a box stops you exactly at its face (your radius away)', Math.abs(WK.face - (48 - .22 * 68)) < .01, WK.face);
  check('Walk: you can jump up onto a box lower than your jump, and stay there', WK.onTop && WK.stay === 24, { onTop: WK.onTop, stay: WK.stay });
  check('Walk: walk off the far edge and you fall to the floor', WK.offEdge === 0, WK.offEdge);
  check('Walk: 4 inches tall, a 24-inch box is out of reach (jump ≈ 0.8 of your height) and stops you', WK.tiny.maxY < 3.3 && Math.abs(WK.tiny.z - (48 - .88)) < .01, WK.tiny);
  check('Walk: a ledge under your step height you just walk up', WK.step);
  check('Walk: you slide along a turned box and never pass into it', WK.notInside);
  check('Walk: jumping under a box, your head stops at its underside', Math.abs(WK.ceil - 12) < 1e-6, WK.ceil);
  check('Walk: speed scales with you (68 in vs 4 in → 17× as far)', Math.abs(WK.speedRatio - 17) < .2, WK.speedRatio);
  check('Walk: an ant (¼ in) still sees the world (near plane shrinks with you)', WK.ant.faces > 0 && Math.abs(WK.ant.eye - .23) < 1e-9, WK.ant);
  // keys and leaving
  const k0 = await page.evaluate(() => { const S = window.__state; window.__pv.walkStop(false); const s = document.querySelector('#pvScene'); s.value = 'totem'; s.dispatchEvent(new Event('change')); S.pv = { ...S.pv, eye: { x: 0, y: 60, z: 0 }, yaw: 0 }; window.__pv.render(); return { eye: { ...S.pv.eye }, yaw: S.pv.yaw, n: S.pv.boxes.length }; });
  await page.evaluate(() => { try { localStorage.removeItem('locus-walk-size'); } catch { } });
  await page.click('#pvWalkBtn'); await page.waitForTimeout(300); await page.evaluate(() => window.__pv.setWalkSize(68));
  check('Walk button enters first person (the plan and controls step aside)', await page.evaluate(() => document.body.classList.contains('pv-walk') && !!window.__pv.walking && !document.querySelector('#pvWalk').hidden));
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w'); await page.keyboard.press('d'); await page.waitForTimeout(100);
  const k1 = await page.evaluate(() => ({ z: window.__state.pv.eye.z, n: window.__state.pv.boxes.length }));
  check('Walk: W walks forward, and D strafes instead of duplicating a box', k1.z > k0.eye.z + 5 && k1.n === k0.n, { k0, k1 });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const k2 = await page.evaluate(() => ({ walking: !!window.__pv.walking, eye: window.__state.pv.eye, yaw: window.__state.pv.yaw }));
  check('Walk: Esc goes back to the plan exactly as it was', !k2.walking && Math.abs(k2.eye.z - k0.eye.z) < 1e-9 && Math.abs(k2.eye.y - k0.eye.y) < 1e-9, k2);
  await page.click('#pvWalkBtn'); await page.waitForTimeout(200); await page.evaluate(() => window.__pv.setWalkSize(68)); await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const k3 = await page.evaluate(() => ({ walking: !!window.__pv.walking, z: window.__state.pv.eye.z }));
  await page.click('#undoBtn'); await page.waitForTimeout(200);
  const k4 = await page.evaluate(() => window.__state.pv.eye.z);
  check('Walk: Enter (Use this view) keeps the camera where you stood; one undo puts it back', !k3.walking && k3.z > k0.eye.z + 5 && Math.abs(k4 - k0.eye.z) < 1e-9, { k3, k4 });
  // ── the view lock, and the little guy
  await page.evaluate(() => { const S = window.__state; const s = document.querySelector('#pvScene'); s.value = 'totem'; s.dispatchEvent(new Event('change')); window.__pv.setLock(false); try { localStorage.removeItem('locus-walk-size'); } catch { } }); await page.waitForTimeout(200);
  const camOf = () => page.evaluate(() => { const v = window.__state.pv; return JSON.stringify([v.eye, v.yaw, v.pitch, v.roll || 0, v.dist, v.cv, v.proj, v.canvas]); });
  const lc0 = await camOf();
  await page.click('#pvLockBtn');
  check('Lock view: the padlock on the drawing locks it', await page.evaluate(() => window.__pv.viewLock && document.body.classList.contains('pv-locked')));
  const LW = await page.evaluate(() => { const r = document.querySelector('#canvasWrap').getBoundingClientRect(); return { x: r.x + r.width * .2, y: r.y + r.height * .3 }; });
  const vs0 = await page.evaluate(() => window.__pv.viewS);
  await page.mouse.move(LW.x, LW.y); await page.mouse.wheel(0, -500); await page.waitForTimeout(300);
  const vs1 = await page.evaluate(() => window.__pv.viewS);
  check('Locked: scrolling magnifies the picture and the perspective stays exactly the same', vs1[0] > vs0[0] * 1.2 && await camOf() === lc0, { vs0, vs1 });
  await page.mouse.down(); await page.mouse.move(LW.x + 140, LW.y + 50, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const vs2 = await page.evaluate(() => window.__pv.viewS);
  check('Locked: dragging empty space moves the picture, not the camera', Math.abs(vs2[1] - vs1[1]) > 20 && await camOf() === lc0, { vs1, vs2 });
  await page.click('#pvShots .pv-shot:nth-child(2)'); await page.waitForTimeout(700); await page.keyboard.press('a'); await page.waitForTimeout(200);
  check('Locked: Shots and Aim refuse (with a note), the camera stays put', await camOf() === lc0 && /locked/i.test(await page.textContent('#toast').catch(() => '') || await page.evaluate(() => document.querySelector('.toast')?.textContent || '')));
  check('Locked: the Canvas and Camera controls are disabled', await page.evaluate(() => [...document.querySelectorAll('#pvSide > [data-tab="camera"] input, #pvSide > [data-tab="canvas"] input, #pvSide > [data-tab="canvas"] select')].every(i => i.disabled) && document.querySelector('#pvAim').disabled));
  const bx = await page.evaluate(() => { let best = null; const W = document.querySelector('#canvasWrap').getBoundingClientRect(), L = document.querySelector('#pvLockBtn').getBoundingClientRect(), PL = document.querySelector('#pvPlan').getBoundingClientRect(); document.querySelectorAll('#geometry .pv-face:not(.guy)').forEach(f => { const r = f.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2; if ((cx > PL.x - 10 && cy > PL.y - 10) || cx < W.x + 30 || cx > W.right - 30 || cy < W.y + 30 || cy > W.bottom - 60 || (cx > L.x - 10 && cy < L.bottom + 10)) return; if (r.width * r.height > (best?.a || 0)) best = { a: r.width * r.height, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); return { ...best, boxes: JSON.stringify(window.__state.pv.boxes.map(b => [b.x, b.z])) }; });
  await page.mouse.move(bx.x, bx.y); await page.mouse.down(); await page.mouse.move(bx.x + 40, bx.y + 10, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200);
  const bxAfter = await page.evaluate(() => JSON.stringify(window.__state.pv.boxes.map(b => [b.x, b.z]))), camSame = await camOf() === lc0;
  check('Locked: boxes can still be moved (only the camera is locked)', bxAfter !== bx.boxes && camSame, { at: [bx.x, bx.y], moved: bxAfter !== bx.boxes, camSame, hit: await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.getAttribute('class') || e.tagName); }, [bx.x, bx.y]) });
  await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
  // walk while locked: the composition is untouched, and he stays where you left him
  await page.click('#pvWalkBtn'); await page.waitForTimeout(200); await page.evaluate(() => window.__pv.setWalkSize(16));
  check('Locked: while walking, “Use this view” is hidden (it would change the composition)', await page.evaluate(() => document.querySelector('.pv-walk-bar [data-w="keep"]').hidden));
  await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  const G1 = await page.evaluate(() => ({ guy: window.__state.pv.guy, faces: document.querySelectorAll('#geometry .pv-face.guy').length, hit: window.__pv.guyHit }));
  check('The little guy: after a walk he stands where you left him, at your size, drawn in the composition', await camOf() === lc0 && G1.guy && G1.guy.size === 16 && G1.guy.z > 5 && G1.faces > 3 && !!G1.hit, G1);
  const [gdl] = await Promise.all([page.waitForEvent('download'), page.click('#exportBtn')]);
  const gsvg = require('fs').readFileSync(await gdl.path(), 'utf8');
  const gStudio = await page.evaluate(() => { const g = window.__studio.geometry(); return (g.strokes || g).filter(s => s.kind === 'guy').length; });
  check('The little guy never goes out: not in Export, not in the Studio', !/<path[^>]*(data-kind="guy"|class="pv-face [a-z]+ guy")/.test(gsvg) && /<path[^>]*class="pv-face/.test(gsvg) && gStudio === 0, gStudio);
  const gc = await page.evaluate(() => { const h = window.__pv.guyHit, svg = document.querySelector('#geometry'), pt = svg.createSVGPoint(); pt.x = (h[0] + h[2]) / 2; pt.y = (h[1] + h[3]) / 2; const q = pt.matrixTransform(svg.getScreenCTM()); return [q.x, q.y]; });
  await page.mouse.move(gc[0], gc[1]); await page.mouse.down(); await page.mouse.move(gc[0] + 60, gc[1] - 20, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const G2 = await page.evaluate(() => window.__state.pv.guy);
  check('The little guy: drag him to place him (on the floor, or on top of a box)', Math.hypot(G2.x - G1.guy.x, G2.z - G1.guy.z) > 2 && G2.size === 16 && await camOf() === lc0, { from: G1.guy, to: G2 });
  const gc2 = await page.evaluate(() => { const h = window.__pv.guyHit, svg = document.querySelector('#geometry'), pt = svg.createSVGPoint(); pt.x = (h[0] + h[2]) / 2; pt.y = (h[1] + h[3]) / 2; const q = pt.matrixTransform(svg.getScreenCTM()); return [q.x, q.y]; });
  await page.mouse.click(gc2[0], gc2[1]); await page.waitForTimeout(300);
  const G3 = await page.evaluate(() => ({ walking: !!window.__pv.walking, p: window.__pv.walking && window.__pv.walking.p, size: window.__pv.walking && window.__pv.walking.size }));
  check('The little guy: tap him and you walk as him, from his spot at his size', G3.walking && Math.abs(G3.p[0] - G2.x) < 1e-6 && Math.abs(G3.p[2] - G2.z) < 1e-6 && G3.size === 16, G3);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.click('#pvShow [data-show="guy"]'); await page.waitForTimeout(150);
  check('The Little guy chip hides him', await page.evaluate(() => document.querySelectorAll('#geometry .pv-face.guy').length === 0 && !window.__pv.guyHit));
  await page.evaluate(() => { const s = document.querySelector('#pvScene'); s.value = 'street'; s.dispatchEvent(new Event('change')); }); await page.waitForTimeout(150);
  await page.click('#pvShow [data-show="guy"]').catch(() => {}); await page.waitForTimeout(150);
  const G4 = await page.evaluate(() => ({ guy: window.__state.pv.guy, show: window.__state.pv.show.guy, faces: document.querySelectorAll('#geometry .pv-face.guy').length }));
  if (G4.show === false) { await page.click('#pvShow [data-show="guy"]'); await page.waitForTimeout(150); }
  const G5 = await page.evaluate(() => ({ guy: window.__state.pv.guy, faces: document.querySelectorAll('#geometry .pv-face.guy').length, cam: window.__state.pv.eye }));
  check('With no little guy yet, the chip puts one in front of you, facing you', !!G5.guy && G5.faces > 3, G5);
  await page.click('#pvLockBtn'); await page.waitForTimeout(100);
  check('Unlock: the controls come back', await page.evaluate(() => !window.__pv.viewLock && !document.querySelector('#pvSide > [data-tab="camera"] input').disabled));
  // Android: thumb stick, look, Jump, back
  {
    const wctx = await touchCtx(devices['Galaxy S24']), wp = await wctx.newPage(); wp.on('pageerror', e => errors.push('walk touch: ' + e.message));
    await wp.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await wp.goto('file://' + file);
    await wp.evaluate(() => { document.querySelector('#appMode [data-app="perspective"]').click(); const s = document.querySelector('#pvScene'); s.value = 'totem'; s.dispatchEvent(new Event('change')); const S = window.__state; S.pv = { ...S.pv, eye: { x: 0, y: 30, z: 0 }, yaw: 0 }; window.__pv.render(); }); await wp.waitForTimeout(300);
    const cdp = await wctx.newCDPSession(wp), T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const mid = s => wp.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, s);
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await wp.waitForTimeout(30); await T('touchEnd', []); await wp.waitForTimeout(80); };
    await tap(...await mid('#pvWalkBtn')); await wp.waitForTimeout(400);
    const full = await wp.evaluate(() => ({ walk: document.body.classList.contains('pv-walk'), wrapW: Math.round(document.querySelector('#canvasWrap').getBoundingClientRect().width), vw: innerWidth, sheet: getComputedStyle(document.querySelector('.sidebar')).display }));
    check('Walk on a phone: full screen, the sheet out of the way', full.walk && full.wrapW === full.vw && full.sheet === 'none', full);
    const e0 = await wp.evaluate(() => ({ ...window.__state.pv.eye, yaw: window.__state.pv.yaw }));
    const vh = await wp.evaluate(() => innerHeight);
    await T('touchStart', [{ x: 80, y: vh - 200 }]); for (let i = 1; i <= 6; i++) { await T('touchMove', [{ x: 80, y: vh - 200 - i * 10 }]); await wp.waitForTimeout(16); } await wp.waitForTimeout(700); await T('touchEnd', []); await wp.waitForTimeout(150);
    const e1 = await wp.evaluate(() => ({ ...window.__state.pv.eye, yaw: window.__state.pv.yaw }));
    check('Walk on a phone: push the left thumb stick up and you walk forward', e1.z > e0.z + 3 && Math.abs(e1.x - e0.x) < 1, { e0, e1 });
    await T('touchStart', [{ x: 300, y: 400 }]); for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: 300 - i * 10, y: 400 }]); await wp.waitForTimeout(16); } await T('touchEnd', []); await wp.waitForTimeout(150);
    const e2 = await wp.evaluate(() => window.__state.pv.yaw);
    check('Walk on a phone: drag on the right to look round', Math.abs(e2 - e1.yaw) > 10, [e1.yaw, e2]);
    const jb = await mid('.pv-jump'); await T('touchStart', [{ x: jb[0], y: jb[1] }]); await wp.waitForTimeout(150); await T('touchEnd', []);
    const jy = await wp.evaluate(() => window.__pv.walking.p[1]);
    check('Walk on a phone: Jump lifts you off the floor', jy > 1, jy);
    await wp.waitForTimeout(800);
    await tap(...await mid('.pv-walk-bar [data-w="size"]')); await wp.waitForTimeout(150); await tap(...await mid('.pv-walk-chips [data-s="2"]')); await wp.waitForTimeout(200);
    const sz = await wp.evaluate(() => ({ size: window.__pv.walking.size, hud: document.querySelector('#pvWalkHud').textContent }));
    check('Walk on a phone: Size → Mouse makes you 2 inches tall', sz.size === 2 && /2″ tall/.test(sz.hud), sz);
    await wp.goBack({ waitUntil: 'commit' }).catch(() => {}); await wp.waitForTimeout(400);
    const out = await wp.evaluate(() => ({ walking: !!window.__pv.walking, app: document.body.classList.contains('pv-app'), eye: window.__state.pv.eye }));
    check('Walk on a phone: Android back leaves walking, the plan as it was', !out.walking && out.app && Math.abs(out.eye.z - e0.z) < 1e-9, out);
    await wp.waitForTimeout(500);
    const wcam = () => wp.evaluate(() => { const v = window.__state.pv; return JSON.stringify([v.eye, v.yaw, v.pitch, v.dist, v.cv]); });
    await tap(...await mid('#pvLockBtn')); await wp.waitForTimeout(200); const lk0 = await wcam(), lv0 = await wp.evaluate(() => window.__pv.viewS);
    await T('touchStart', [{ x: 120, y: 400 }, { x: 240, y: 400 }]); for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: 120 - i * 8, y: 400 }, { x: 240 + i * 8, y: 400 }]); await wp.waitForTimeout(16); } await T('touchEnd', []); await wp.waitForTimeout(150);
    await T('touchStart', [{ x: 200, y: 450 }]); for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: 200 + i * 10, y: 450 + i * 4 }]); await wp.waitForTimeout(16); } await T('touchEnd', []); await wp.waitForTimeout(150);
    const lv1 = await wp.evaluate(() => window.__pv.viewS);
    check('Locked on a phone: pinch magnifies and a one-finger drag moves the picture; the perspective never changes', await wcam() === lk0 && lv1[0] > lv0[0] * 1.2, { lv0, lv1 });
    await wctx.close();
  }
  // ── the edit tray: big steps instead of fiddly drags, on a Galaxy S24, in the plan and while walking
  {
    const ectx = await touchCtx(devices['Galaxy S24']), ep = await ectx.newPage(); ep.on('pageerror', e => errors.push('tray: ' + e.message));
    await ep.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await ep.goto('file://' + file);
    await ep.evaluate(() => { localStorage.clear(); document.querySelector('#appMode [data-app="perspective"]').click(); const s = document.querySelector('#pvScene'); s.value = 'totem'; s.dispatchEvent(new Event('change')); }); await ep.waitForTimeout(400);
    const cdp = await ectx.newCDPSession(ep), T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await ep.waitForTimeout(30); await T('touchEnd', []); await ep.waitForTimeout(140); };
    const hold = async (x, y, ms) => { await T('touchStart', [{ x, y }]); await ep.waitForTimeout(ms); await T('touchEnd', []); await ep.waitForTimeout(160); };
    const mid = s => ep.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, s);
    const sb = () => ep.evaluate(() => { const P = window.__pv, b = P.sel && window.__state.pv.boxes.find(b => b.id === P.sel.id); return b && { x: b.x, y: b.y, z: b.z, ry: b.ry || 0, rx: b.rx || 0, w: b.w, h: b.h, d: b.d }; });
    const face = await ep.evaluate(() => { let best = null; const W = document.querySelector('#canvasWrap').getBoundingClientRect(); document.querySelectorAll('#geometry .pv-face').forEach(f => { const r = f.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2; if (cy < W.y + 40 || cy > W.bottom - 40 || cx < W.x + 20 || cx > W.right - 20) return; const a = r.width * r.height; if (!best || a > best.a) best = { a, cx, cy }; }); return best; });
    await tap(face.cx, face.cy); await ep.waitForTimeout(200); await tap(...await mid('#pvBoxBar [data-act="edit"]')); await ep.waitForTimeout(500);
    const t0 = await ep.evaluate(() => { const t = document.querySelector('#pvTray'), r = t.getBoundingClientRect(), s = [...document.querySelectorAll('#overlayLayer .pv-sel:not(.twin)')].map(e => e.getBoundingClientRect()); return { open: !t.hidden, top: r.top, sheet: document.querySelector('.sidebar').dataset.sheet, bar: !document.querySelector('#pvBoxBar').hidden, boxBottom: s.length ? Math.max(...s.map(q => q.bottom)) : null }; });
    check('Edit tray: Edit opens a slim tray, not the sheet, and the box bar steps aside', t0.open && t0.sheet === 'peek' && !t0.bar, t0);
    check('Edit tray: the drag handles step aside while it’s open (buttons, not fiddly drags)', await ep.evaluate(() => document.querySelectorAll('#overlayLayer [data-pv^="face"], #overlayLayer [data-pv="turn"]').length === 0));
    check('Edit tray: the box stays in view above the tray (the picture slides up, the camera doesn’t)', t0.boxBottom != null && t0.boxBottom <= t0.top + 2, t0);
    const e0 = await sb(); await tap(...await mid('#pvTrayPad [data-n="right"]')); const e1 = await sb();
    check('Edit tray: Move ▶ steps exactly 3″ along the floor, to a clean number', Math.abs(Math.abs((e1.x - e0.x) + (e1.z - e0.z)) - 3) < 1e-9 && (e1.x % 3 === 0 || e1.z % 3 === 0), { e0, e1 });
    await hold(...await mid('#pvTrayPad [data-n="away"]'), 1200); const e2 = await sb();
    await tap(...await mid('#undoBtn')); const e3 = await sb();
    check('Edit tray: hold to repeat, and the whole hold is one undo', Math.hypot(e2.x - e1.x, e2.z - e1.z) >= 9 && e3.x === e1.x && e3.z === e1.z, { e1, e2, e3 });
    await tap(...await mid('.pv-tray-tabs [data-tm="turn"]')); await tap(...await mid('#pvTrayPad [data-n="cw"]')); const e4 = await sb();
    await tap(...await mid('.pv-tray-tabs [data-tm="tip"]')); await tap(...await mid('#pvTraySteps [data-step="1"]')); await tap(...await mid('#pvTrayPad [data-n="fwd"]')); const e5 = await sb();
    check('Edit tray: Turn steps 15°, Tip steps the 5° you picked', e4.ry === wrapA(e3.ry + 15) && e5.rx === e4.rx + 5, { ry: [e3.ry, e4.ry], rx: [e4.rx, e5.rx] });
    await tap(...await mid('.pv-tray-tabs [data-tm="lift"]')); await tap(...await mid('#pvTrayPad [data-n="up"]')); const e6 = await sb(); await tap(...await mid('#pvTrayPad [data-n="floor"]')); const e7 = await sb();
    await tap(...await mid('.pv-tray-tabs [data-tm="size"]')); await tap(...await mid('#pvTrayPad [data-axis="h"]')); await tap(...await mid('#pvTrayPad [data-n="plus"]')); const e8 = await sb();
    check('Edit tray: Lift raises a step and ⤓ sets it back down; Size grows just the height when H is picked', e6.y === e7.y + 3 && e8.h === Math.round((e7.h + 3) / 3) * 3 && e8.w === e7.w, { y: [e6.y, e7.y], h: [e7.h, e8.h], w: [e7.w, e8.w] });
    check('Edit tray: the readout says what you changed', /× /.test(await ep.textContent('#pvTrayRead')));
    await ep.goBack({ waitUntil: 'commit' }).catch(() => {}); await ep.waitForTimeout(400);
    check('Edit tray: Android back closes it, and you stay in the planner', await ep.evaluate(() => document.querySelector('#pvTray').hidden && document.body.classList.contains('pv-app')));
    // while walking: tap what you're looking at, adjust it, ✓, walk on
    await ep.evaluate(() => { const S = window.__state; S.pv = { ...S.pv, eye: { x: -30, y: 20, z: 40 }, yaw: -20, pitch: 0, guy: null }; window.__pv.render(); });
    await tap(...await mid('#pvWalkBtn')); await ep.waitForTimeout(400); await ep.evaluate(() => window.__pv.setWalkSize(20)); await ep.waitForTimeout(300);
    const wf = await ep.evaluate(() => { let best = null; document.querySelectorAll('#geometry .pv-face').forEach(f => { const r = f.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2; if (cx < innerWidth * .5 || cx > innerWidth - 20 || cy < 180 || cy > innerHeight - 200) return; const a = r.width * r.height; if (!best || a > best.a) best = { a, cx, cy }; }); return best; });
    await tap(wf.cx, wf.cy); await ep.waitForTimeout(300);
    const w1 = await ep.evaluate(() => ({ sel: window.__pv.sel, tray: window.__pv.trayOn, outline: document.querySelectorAll('#overlayLayer .pv-sel').length, jump: getComputedStyle(document.querySelector('.pv-jump')).display }));
    check('Walking: tap a box you’re looking at and it’s selected (outlined), with the tray; the stick and Jump step aside', !!w1.sel && w1.tray && w1.outline > 0 && w1.jump === 'none', w1);
    const wb0 = await sb(); await tap(...await mid('#pvTrayPad [data-n="away"]')); await ep.waitForTimeout(200); const wb1 = await sb();
    check('Walking: Move ▲ pushes it away from you', wb1.z > wb0.z && wb1.x === wb0.x, { wb0, wb1 });
    await tap(...await mid('.pv-tray-tabs [data-ta="done"]')); await ep.waitForTimeout(200);
    check('Walking: ✓ lets go and you walk on', await ep.evaluate(() => !window.__pv.trayOn && !window.__pv.sel && !!window.__pv.walking && getComputedStyle(document.querySelector('.pv-jump')).display !== 'none'));
    await ectx.close();
  }
  // ── shapes and sacred geometry: any box can be another solid; repeats can be the figures themselves
  {
    await page.goto('file://' + file); await page.evaluate(() => { localStorage.clear(); document.querySelector('#appMode [data-app="perspective"]').click(); }); await page.waitForTimeout(300);
    const A0 = { type: 'none', n: 6, n2: 3, gap: 6, span: 180, axis: 'across', twist: 0, plane: 'floor', levels: 1, lines: true };
    const solids = await page.evaluate(() => Object.fromEntries(Object.entries(window.__pv.SOLIDS).map(([id, S]) => { const used = new Set(S.F.flatMap(f => f.c));
      return [id, { V: used.size, E: S.E.length, F: S.F.length, closed: S.EF.every(f => f.length === 2), out: S.F.every(f => S.V.every((v, i) => !used.has(i) || f.n[0] * v[0] + f.n[1] * v[1] + f.n[2] * v[2] <= f.d + 1e-9)) }]; })));
    check('Solids: all ten are closed, faces outward, V − E + F = 2', Object.values(solids).length === 10 && Object.values(solids).every(s => s.closed && s.out && s.V - s.E + s.F === 2), solids);
    const pc = ({ tetra, box, octa, dodeca, icosa }) => [tetra, box, octa, dodeca, icosa].map(s => s.F + '/' + s.E).join(' ');
    check('Solids: the Platonic five have their faces and edges (4/6, 6/12, 8/12, 12/30, 20/30)', pc(solids) === '4/6 6/12 8/12 12/30 20/30', pc(solids));
    const perf = await page.evaluate(A0 => { const P = window.__pv, S = window.__state, b = { id: 1, x: 0, y: 0, z: 90, w: 30, h: 12, d: 20, ry: 20, rx: 0, arr: A0 }, c = { ...b, ...P.perfectPatch(b) };
      const t = { ...b, shape: 'tetra', ...P.perfectPatch(b, 'tetra') }; S.pv = { ...S.pv, boxes: [t] }; const K = P.camera(), I = P.sceneOf(S.pv, K)[0], L = I.S.E.map(([a, q]) => Math.hypot(I.P[a][0] - I.P[q][0], I.P[a][1] - I.P[q][1], I.P[a][2] - I.P[q][2]));
      return { cube: [c.w, c.h, c.d], vol: c.w * c.h * c.d, edges: [Math.min(...L), Math.max(...L)], perfect: P.isPerfect(t) }; }, A0);
    check('Perfect: a 30 × 12 × 20 box becomes a cube of about the same volume (19″)', perf.cube.join() === '19,19,19' && Math.abs(perf.vol - 7200) / 7200 < .05, perf);
    check('Perfect: a perfect tetrahedron is regular (all six edges equal)', perf.perfect && (perf.edges[1] - perf.edges[0]) / perf.edges[1] < .003, perf.edges);
    const sil = await page.evaluate(A0 => { const P = window.__pv, S = window.__state; S.pv = { ...S.pv, eye: { x: 13, y: 70, z: -4 }, boxes: [{ id: 1, x: 10, y: 6, z: 80, w: 24, h: 24, d: 24, ry: 31, rx: 12, shape: 'sphere', arr: A0 }, { id: 2, x: -40, y: 0, z: 90, w: 20, h: 30, d: 20, ry: 10, rx: 0, shape: 'cyl', arr: A0 }, { id: 3, x: 50, y: 0, z: 70, w: 20, h: 26, d: 20, ry: 0, rx: 0, shape: 'cone', arr: A0 }] };
      const K = P.camera(), L = P.sceneOf(S.pv, K), E = K.E, u = v => { const l = Math.hypot(...v); return v.map(x => x / l); }, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => a.map((x, i) => x - b[i]);
      let worst = 0; const sp = L[0], C = sp.c; P.silhouettes(sp, E)[0].forEach(Q => worst = Math.max(worst, Math.abs(dot(u(sub(Q, C)), u(sub(E, Q))))));
      [L[1], L[2]].forEach(I => P.silhouettes(I, E).forEach(([A, B]) => { const ax = [0, 1, 0], foot = [I.t[0], A[1], I.t[2]], n = u(sub(A, foot)), m = I.S.id === 'cone' ? u([n[0] * I.h, I.hw, n[2] * I.h]) : n; worst = Math.max(worst, Math.abs(dot(m, u(sub(E, A))))); }));
      return { worst, n: L.map(I => P.silhouettes(I, E).length) }; }, A0);
    check('Curved solids: the outlines are exact (sphere, cylinder and cone: the line of sight just grazes the surface)', sil.worst < 1e-6 && sil.n.join() === '1,2,2', sil);
    const pk = await page.evaluate(A0 => { const P = window.__pv, S = window.__state; S.pv = { ...S.pv, eye: { x: 0, y: 30, z: 0 }, yaw: 0, pitch: 0, boxes: [{ id: 1, x: 0, y: 0, z: 100, w: 40, h: 40, d: 40, ry: 0, rx: 0, shape: 'octa', arr: A0 }] }; P.render();
      const K = P.camera(), I = P.sceneOf(S.pv, K)[0], hit = Q => P.span(I, K.E, Q.map((x, i) => x - K.E[i]));
      return { centre: !!hit([0, 20, 100]), corner: !!hit([18, 38, 80]) }; }, A0);
    check('Picking and hidden lines see the real shape: through an octahedron’s middle hits, through the empty corner of its box misses', pk.centre && !pk.corner, pk);
    const gr = await page.evaluate(A0 => { const P = window.__pv, S = window.__state; S.pv = { ...S.pv, guy: null, eye: { x: 0, y: 30, z: 40 }, yaw: 0, pitch: 0, boxes: [{ id: 1, x: 0, y: 0, z: 100, w: 40, h: 20, d: 40, ry: 0, rx: 0, shape: 'pyramid', arr: A0 }] }; P.render();
      const L = P.solids(), g = [P.groundAt(L, 0, 100, 1e5), P.groundAt(L, 10, 100, 1e5)]; P.walkStart(); P.setWalkSize(36); let top = 0; for (let i = 0; i < 240; i++) { P.walkStep(1 / 60, { fwd: 1 }); top = Math.max(top, P.walking.p[1]); } const z = P.walking.p[2]; P.walkStop(false); return { g, top, z }; }, A0);
    check('Walk: you stand on the real shape (a pyramid is 20″ at its tip, 10″ halfway down) and can climb over it', Math.abs(gr.g[0] - 20) < 1e-6 && Math.abs(gr.g[1] - 10) < 1e-6 && gr.top > 19 && gr.z > 125, gr);
    const fig = await page.evaluate(A0 => { const P = window.__pv, S = window.__state, out = {};
      for (const t of ['seed', 'metatron', 'flower', 'metatron3', 'merkaba', 'p-tetra', 'p-octa', 'p-box', 'p-icosa', 'p-dodeca']) { const b = { id: 1, x: 0, y: 0, z: 150, w: 12, h: 12, d: 12, ry: 0, rx: 0, arr: { ...A0, type: t, gap: 0 } }; S.pv = { ...S.pv, boxes: [b] };
        const K = P.camera(), L = P.sceneOf(S.pv, K), F = P.sacredLines(b, L); let near = 1e9; L.forEach((I, i) => L.forEach((J, j) => { if (j > i) near = Math.min(near, Math.hypot(...I.c.map((x, k) => x - J.c[k]))); }));
        out[t] = [L.length, F.segs.length, F.loops.length, +(near / Math.hypot(12, 12, 12)).toFixed(3), +Math.min(...L.map(I => I.t[1])).toFixed(6)]; }
      const b2 = { id: 1, x: 0, y: 0, z: 300, w: 8, h: 8, d: 8, ry: 0, rx: 0, arr: { ...A0, type: 'metatron', levels: 2 } }; S.pv = { ...S.pv, boxes: [b2] }; const L2 = P.sceneOf(S.pv, P.camera()); out.sprawl = [L2.length, P.sacredLines(b2, L2).segs.length];
      const bw = { ...b2, arr: { ...A0, type: 'metatron', plane: 'wall' } }; S.pv = { ...S.pv, boxes: [bw] }; const Lw = P.sceneOf(S.pv, P.camera()), ys = Lw.map(I => I.t[1]); out.wall = [Math.min(...ys), Math.max(...ys) > 30, Lw.every(I => Math.abs(I.t[2] - 300) < 1e-9)];
      const bf = { ...b2, arr: { ...A0, type: 'metatron' } }; S.pv = { ...S.pv, boxes: [bf] }; const Lf = P.sceneOf(S.pv, P.camera()); out.floorLines = P.sacredLines(bf, Lf).segs.every(([A, B]) => A[1] === 0 && B[1] === 0);
      return out; }, A0);
    const cnt = t => fig[t].slice(0, 3).join('/');
    check('Metatron’s Cube: 13 copies and every one joined to every other (78 lines), with the 13 circles of the Fruit of Life', cnt('metatron') === '13/78/13', fig.metatron);
    check('Seed of Life 7 and Flower of Life 19, each with its circles and the circle round them', cnt('seed') === '7/0/8' && cnt('flower') === '19/0/20', [fig.seed, fig.flower]);
    check('In 3D: Metatron as twelve round one (78 lines), the star tetrahedron (two tetrahedra, 12 lines)', cnt('metatron3') === '13/78/0' && cnt('merkaba') === '8/12/0', [fig.metatron3, fig.merkaba]);
    check('On the corners of each Platonic solid, joined along its edges (4/6, 6/12, 8/12, 12/30, 20/30)', ['p-tetra', 'p-octa', 'p-box', 'p-icosa', 'p-dodeca'].map(t => fig[t][0] + '/' + fig[t][1]).join(' ') === '4/6 6/12 8/12 12/30 20/30', fig);
    check('Copies never touch at no gap (centres at least a diagonal apart), and solid figures rest on the floor', Object.entries(fig).filter(([k]) => fig[k].length === 5).every(([k, v]) => v[3] >= (['seed', 'metatron', 'flower'].includes(k) ? Math.sqrt(2 / 3) : 1) * .999 && v[4] === 0), fig);
    check('Figure of figures: Metatron on each of its own 13 centres, 169 copies, lines at both scales (14 × 78)', fig.sprawl.join() === '169,1092', fig.sprawl);
    check('Standing up: the figure rises off the floor in its own plane; on the floor, its lines lie on the floor', fig.wall[0] === 0 && fig.wall[1] && fig.wall[2] && fig.floorLines, fig);
    // the panel: shape chips, Perfect, the sacred repeats
    await page.evaluate(() => { const s = document.querySelector('#pvScene'); s.value = 'blank'; s.dispatchEvent(new Event('change')); const P = window.__pv; P.sel = { id: 1, k: 0 }; P.render(); P.sync(); }); await page.waitForTimeout(200);
    await page.click('#pvShapes [data-shape="tetra"]'); await page.waitForTimeout(120);
    const u1 = await page.evaluate(() => { const b = window.__state.pv.boxes[0]; return { shape: b.shape, perfect: window.__pv.isPerfect(b), on: document.querySelector('#pvShapes .on')?.dataset.shape, name: document.querySelector('#pvPerfectName').textContent, faces: document.querySelectorAll('#geometry .pv-face').length }; });
    check('Shape picker: tap Tetra and a perfect cube becomes a regular tetrahedron; the chip and the Perfect button follow', u1.shape === 'tetra' && u1.perfect && u1.on === 'tetra' && u1.name === 'Perfect tetrahedron' && u1.faces > 0, u1);
    await page.fill('#pvH', '40'); await page.dispatchEvent('#pvH', 'change'); await page.click('#pvShapes [data-shape="cyl"]'); await page.waitForTimeout(100);
    const u2 = await page.evaluate(() => { const b = window.__state.pv.boxes[0]; return { shape: b.shape, h: b.h, active: document.querySelector('#pvPerfect').classList.contains('active') }; });
    await page.click('#pvPerfect'); await page.waitForTimeout(100);
    const u3 = await page.evaluate(() => { const b = window.__state.pv.boxes[0]; return { w: b.w, h: b.h, d: b.d, perfect: window.__pv.isPerfect(b) }; });
    check('A stretched shape keeps its box when it changes; Perfect then gives the cylinder height = diameter', u2.shape === 'cyl' && u2.h === 40 && !u2.active && u3.perfect && u3.w === u3.h && u3.h === u3.d, { u2, u3 });
    await page.selectOption('#pvArr', 'metatron'); await page.waitForTimeout(200);
    const u4 = await page.evaluate(() => ({ n: window.__pv.instances(window.__state.pv, window.__state.pv.boxes[0]).length, rows: ['pvPlaneRow', 'pvSacredRow', 'pvGapRow'].map(id => !document.getElementById(id).hidden), count: !document.getElementById('pvCountRow').hidden, lines: document.querySelectorAll('#geometry [data-kind="sacred"]').length, gap: document.getElementById('pvGapLabel').textContent }));
    check('Repeat → Metatron’s Cube: 13 copies with its lines; the panel offers floor or standing, Lines, Figure of figures and Spacing', u4.n === 13 && u4.rows.every(Boolean) && !u4.count && u4.lines > 0 && u4.gap === 'Spacing', u4);
    await page.click('#pvLines'); await page.waitForTimeout(100); const off = await page.evaluate(() => document.querySelectorAll('#geometry [data-kind="sacred"]').length);
    await page.click('#pvLines'); await page.click('#pvPlane [data-v="wall"]'); await page.waitForTimeout(100);
    const u5 = await page.evaluate(() => { const ys = window.__pv.instances(window.__state.pv, window.__state.pv.boxes[0]).map(I => I.t[1]); return { plane: window.__state.pv.boxes[0].arr.plane, rise: Math.max(...ys) - Math.min(...ys) }; });
    check('Lines toggles the figure’s lines; Standing up stands the figure on its edge', off === 0 && u5.plane === 'wall' && u5.rise > 50, { off, u5 });
    // exports: exact hidden lines for every shape; the figure's lines on the Accent layer
    const ex = await page.evaluate(() => { const r = {}; for (const sc of ['fruit', 'metatron', 'platonic', 'sprawl']) { const s = document.querySelector('#pvScene'); s.value = sc; s.dispatchEvent(new Event('change')); const g = window.__studio.geometry(); const k = {}; g.strokes.forEach(x => { const key = x.kind + '/' + x.layer; k[key] = (k[key] || 0) + 1; }); r[sc] = k; } return r; });
    check('Studio: the spheres’ outlines export whole (13), Metatron’s lines go on the Accent layer, every shape draws', ex.fruit['main/figure'] === 13 && ex.fruit['sacred/accent'] > 0 && ex.metatron['sacred/accent'] > 0 && ex.metatron['main/figure'] > 50 && ex.platonic['main/figure'] > 30 && ex.sprawl['main/figure'] > 300, ex);
    const ms = await page.evaluate(() => { const s = document.querySelector('#pvScene'); s.value = 'fruit'; s.dispatchEvent(new Event('change')); const P = window.__pv; P.render(); const t = performance.now(); for (let i = 0; i < 5; i++) P.render(); return (performance.now() - t) / 5; });
    check('Smooth: thirteen spheres with Metatron’s lines draw in well under a frame budget for editing (< 40 ms)', ms < 40, Math.round(ms));
    // the tray on a phone: a Shape tab, and Perfect
    const sctx = await touchCtx(devices['Galaxy S24']), sp = await sctx.newPage(); sp.on('pageerror', e => errors.push('shape tray: ' + e.message));
    await sp.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await sp.goto('file://' + file);
    await sp.evaluate(() => { localStorage.clear(); document.querySelector('#appMode [data-app="perspective"]').click(); const s = document.querySelector('#pvScene'); s.value = 'blank'; s.dispatchEvent(new Event('change')); const P = window.__pv; P.sel = { id: 1, k: 0 }; P.render(); P.sync(); P.openTray(); }); await sp.waitForTimeout(400);
    await sp.tap('.pv-tray-tabs [data-tm="shape"]'); await sp.waitForTimeout(150); await sp.tap('#pvTrayPad [data-shape="dodeca"]'); await sp.waitForTimeout(200);
    const s1 = await sp.evaluate(() => ({ shape: window.__state.pv.boxes[0].shape, read: document.querySelector('#pvTrayRead').textContent, on: document.querySelector('#pvTrayPad .on')?.dataset.shape }));
    check('Tray on a phone: Shape → Dodeca turns it into a dodecahedron, and says so', s1.shape === 'dodeca' && s1.on === 'dodeca' && /^Dodecahedron/.test(s1.read), s1);
    await sp.tap('.pv-tray-tabs [data-tm="size"]'); await sp.tap('#pvTrayPad [data-axis="h"]'); await sp.tap('#pvTrayPad [data-n="plus"]'); await sp.waitForTimeout(150); const s2 = await sp.evaluate(() => window.__pv.isPerfect(window.__state.pv.boxes[0]));
    await sp.tap('#pvTrayPad [data-n="perfect"]'); await sp.waitForTimeout(150); const s3 = await sp.evaluate(() => window.__pv.isPerfect(window.__state.pv.boxes[0]));
    check('Tray: Size ＋ stretches it; ◆ makes it perfect again', !s2 && s3, { s2, s3 });
    await sctx.close();
  }
  check('No script errors', errors.length === 0, errors);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
