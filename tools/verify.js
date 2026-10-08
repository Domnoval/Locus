// Geometry and behaviour checks for Locus. Exits non-zero if any check fails.
// usage: node tools/verify.js [path/to/index.html]   (PLAYWRIGHT=/path/to/playwright to use an existing install)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
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
    return { id: o.value, spatial: !!f.spatial, placed: !!f.placed, givens: K.pts.filter(p => p.op === 'given').length, other: K.pts.filter(p => !p.abs && !['given', 'meet'].includes(p.op)).length, orphans: K.pts.filter(p => p.op !== 'given' && !p.parents.length).length };
  }));
  prov.filter(f => !f.spatial && !f.placed).forEach(f => check(`${f.id}: two givens, every other flat point is a meet`, f.givens === 2 && f.other === 0, f));
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

  // Yantra
  const tri = await page.evaluate(() => { const sel = document.querySelector('#pattern'); sel.value = 'yantra'; sel.dispatchEvent(new Event('change')); const K = window.__k(), by = {}; K.curves.filter(c => c.type === 'seg').forEach(c => (by[c.step] = by[c.step] || new Set()).add(c.a).add(c.b));
    return Object.values(by).map(s => { const v = [...s].sort((a, b) => a.y - b.y); return Math.abs(v[1].y - v[2].y) < 1e-6 ? 'up' : 'down'; }); });
  check('Yantra: 4 up, 5 down, innermost down', tri.filter(t => t === 'up').length === 4 && tri.filter(t => t === 'down').length === 5 && tri[tri.length - 1] === 'down', tri);

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

  check('No script errors', errors.length === 0, errors);
  await browser.close();
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
