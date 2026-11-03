// Geometry and behaviour checks for Locus. Exits non-zero if any check fails.
// usage: node tools/verify.js [path/to/index.html]   (PLAYWRIGHT=/path/to/playwright to use an existing install)
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path');
const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

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
    check(`${dn}: bar · Edit opens the Box tab`, (await sheet()).tab === 'box' && await shown('#pvBoxPanel'), await sheet());
    await tp.evaluate(() => window.__pv.setSheet('peek')); await tp.waitForTimeout(400);
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
  check('No script errors', errors.length === 0, errors);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
