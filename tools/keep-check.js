// Checks that Locus keeps your work: both modes come back after a reload, an edit made just before the page goes survives, a message's Undo
// undoes its own action, a scene or a figure travels as a file, and nothing read back from storage or a file can break the app. Exits non-zero if any check fails.
// usage: node tools/keep-check.js [path/to/index.html]   (PLAYWRIGHT=/path/to/playwright to use an existing install)
// "The same" always means the real downloaded print SVG, byte for byte, fetched through the Studio's own Download button. Controls are worked as the artist
// works them (clicks, drags, the file chooser); the saved file is read here with JSON.parse, not with Locus's own reader.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'locus-keep-'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const BAD = /NaN|Infinity|undefined/;
// what the page is showing, read in the browser: the mode, both saved things in a fixed key order, the Studio settings, and anything that is not a number in the drawing
const peek = () => { const S = window.__state; if (!S) return { dead: true };
  const sort = v => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : Array.isArray(v) ? v.map(sort) : v;
  const pv = S.pv, scene = sort({ scene: pv.scene, name: pv.name, canvas: pv.canvas, eye: pv.eye, yaw: pv.yaw, pitch: pv.pitch, roll: pv.roll || 0, dist: pv.dist, proj: pv.proj, cv: pv.cv, grid: pv.grid, show: pv.show, sq: pv.sq || 0, guy: pv.guy || null, boxes: pv.boxes, sel: window.__pv.sel || null });
  const geo = {}; ['pattern', 'mode', 'primitive', 'perspectivePoints', 'step', 'rotation', 'tilt', 'depth', 'weight', 'guides', 'points', 'mirror', 'darkline', 'perspectiveLines', 'phi', 'dimensions', 'multiView', 'fruit', 'workings', 'depthInk', 'horizon', 'vp1X', 'vpLeft', 'vpRight', 'vp3X', 'vp3Y', 'autoRotate'].forEach(k => geo[k] = S[k]);
  const bad = []; document.querySelectorAll('#geometry *, #pvPlan *, #studioPreview *').forEach(n => { for (const a of n.attributes) if (/NaN|Infinity|undefined/.test(a.value) && !/^(class$|id$|data-|aria-)/.test(a.name) && bad.length < 3) bad.push(`${n.tagName} ${a.name}=${a.value.slice(0, 40)}`); });
  const t = document.querySelector('#toast'), shown = t.classList.contains('show'), b = t.querySelector('button');
  return { app: S.app, scene: JSON.stringify(scene), geo: JSON.stringify(geo), speed: document.querySelector('#speed').value, playing: S.playing, studio: JSON.stringify(sort(window.__studio.ST)), bad, drawn: document.querySelectorAll('#geometry path, #geometry line').length,
    toast: shown ? [...t.childNodes].filter(n => n !== b).map(n => n.textContent).join('') : '', toastBtn: shown && b ? b.textContent : '', undo: !document.querySelector('#undoBtn').disabled, redo: !document.querySelector('#redoBtn').disabled,
    ui: { pattern: document.querySelector('#pattern').value, view: (document.querySelector('#viewMode button.active') || {}).dataset?.mode, step: document.querySelector('#step').value, pvScene: document.querySelector('#pvScene').value, pvApp: document.body.classList.contains('pv-app') } }; };
const oneSentence = t => /^[A-Z“][^]*\.$/.test(t.trim()) && !/[.!?]\s+\S/.test(t.trim());

let browser;
const report = () => { const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`); return failed.length; };
(async () => {
  browser = await chromium.launch();
  const errors = [];
  const open = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, ...(opts.ctx || {}) }); if (opts.init) await ctx.addInitScript(opts.init); const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => { errs.push(e.message); if (!opts.quiet) errors.push(e.message); }); await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await page.goto('file://' + file + (opts.query || '')); await page.waitForTimeout(250); return { ctx, page, errs }; };
  let seq = 0; const grab = async (page, sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const f = path.join(tmp, `${++seq}-${d.suggestedFilename()}`); await d.saveAs(f); return { name: d.suggestedFilename(), f, buf: fs.readFileSync(f) }; };
  const studio = async (page, on) => { if (await page.evaluate(() => document.querySelector('#studio').open) !== on) await page.click(on ? '#studioBtn' : '#stClose'); await page.waitForTimeout(on ? 320 : 60); };
  // every layer on, through the Studio's own tick boxes (so the choice is saved like any other Studio setting)
  const allLayers = async page => { await studio(page, true); for (const id of ['construction', 'figure', 'accent', 'marks', 'drafting']) await page.check('#stOn-' + id); await page.waitForTimeout(300); };
  const print = async page => { await studio(page, true); await page.click('#stModes button[data-v="print"]'); await page.waitForTimeout(320); const g = await grab(page, '#stDownload'); await studio(page, false); return g.buf; };
  const pv = page => page.click('#appMode button[data-app="perspective"]');
  const range = (page, sel, v) => page.$eval(sel, (el, v) => { el.dispatchEvent(new Event('pointerdown', { bubbles: true })); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const dragCanvas = async (page, fx0, fy0, fx1, fy1) => { const b = await page.evaluate(() => { const r = document.querySelector('#geometry').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }); await page.mouse.move(b[0] + b[2] * fx0, b[1] + b[3] * fy0); await page.mouse.down(); await page.mouse.move(b[0] + b[2] * (fx0 + fx1) / 2, b[1] + b[3] * (fy0 + fy1) / 2, { steps: 4 }); await page.mouse.move(b[0] + b[2] * fx1, b[1] + b[3] * fy1, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(700); };
  const chooseFile = async (page, btn, f) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click(btn)]); await fc.setFiles(f); await page.waitForTimeout(350); };
  const write = (name, data) => { const f = path.join(tmp, name); fs.writeFileSync(f, data); return f; };

  /* ---------- a first-time visitor sees what they always saw ---------- */
  {
    const { ctx, page } = await open(); await page.waitForTimeout(900);
    const a = await page.evaluate(peek), keys = await page.evaluate(() => Object.keys(localStorage)), g = JSON.parse(a.geo);
    check('First visit, nothing stored: Geometry opens on Continuum at its opening step, axonometric, with the opening toggles', g.pattern === 'continuum' && g.step === 17 && g.mode === 'axon' && g.primitive === 'flat' && g.rotation === 0 && g.tilt === 0 && g.depth === 45 && g.weight === 1.1 && g.guides && g.points && !g.mirror && !g.darkline && g.depthInk && g.autoRotate && a.speed === '650' && !a.playing && a.toast === '', { g, toast: a.toast });
    check('…and nothing is written to storage until something is changed', keys.length === 0, keys);
    await pv(page); await page.waitForTimeout(300); const s = JSON.parse((await page.evaluate(peek)).scene);
    check('First visit: Perspective opens on Cubes overhead, with nothing chosen', s.scene === 'overhead' && s.boxes.length === 2 && s.proj === 'curvi' && s.canvas.w === 48 && s.canvas.h === 48 && s.sel === null, s);
    check('Save and Open are where the scene and the figure are chosen, with plain labels, in both modes', await page.evaluate(() => { const t = id => { const b = document.querySelector('#' + id); return b && b.offsetParent ? b.textContent : null; }; const pvOk = t('pvSaveFile') === 'Save scene file' && t('pvOpenFile') === 'Open scene file' && !!document.querySelector('#pvSaveFile').closest('section').querySelector('#pvScene');
      document.querySelector('#appMode button[data-app="geometry"]').click(); return pvOk && t('geoSaveFile') === 'Save figure file' && t('geoOpenFile') === 'Open figure file' && !!document.querySelector('#geoSaveFile').closest('section').querySelector('#pattern'); }));
    await ctx.close();
  }

  /* ---------- gate 1: a reload restores Geometry exactly ---------- */
  const GEO = [
    ['Flower of Life in plan at step 9, heavier line, guides off, dimensions on', async p => { await p.selectOption('#pattern', 'flower'); await p.click('#viewMode button[data-mode="plan"]'); await range(p, '#step', 9); await range(p, '#weight', 17); await p.click('.chip[data-toggle="guides"]'); await p.click('.chip[data-toggle="dimensions"]'); }],
    ['Metatron in 3D turned by hand, mirrored, at step 6', async p => { await p.selectOption('#pattern', 'metatron3d'); await range(p, '#step', 6); await dragCanvas(p, .45, .5, .62, .41); await p.click('.chip[data-toggle="mirror"]'); await range(p, '#depth', 70); }],
    ['Cube in two-point perspective, horizon moved, perspective lines off, workings on', async p => { await p.selectOption('#pattern', 'cube'); await p.click('#viewMode button[data-mode="perspective"]'); await p.click('#perspectiveMode button[data-points="2"]'); await range(p, '#horizon', 250); await p.click('#perspectiveLinesBtn'); await p.click('.chip[data-toggle="workings"]'); await range(p, '#rotation', -37); await p.$eval('#step', el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); }],
    ['Dodecahedron in three-point perspective with golden squares, ink accent and depth ink off', async p => { await p.selectOption('#pattern', 'dodecahedron'); await p.click('#viewMode button[data-mode="perspective"]'); await p.click('#perspectiveMode button[data-points="3"]'); await p.click('.chip[data-toggle="phi"]'); await p.click('.chip[data-toggle="darkline"]'); await p.click('.chip[data-toggle="depthInk"]'); await range(p, '#tilt', 51); await p.click('#primitiveMode button[data-primitive="flat"]'); await p.$eval('#step', el => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); }],
    ['Sri Yantra in axonometric at step 5 with plan study, playback at 2×', async p => { await p.selectOption('#pattern', 'yantra'); await p.click('#viewMode button[data-mode="axon"]'); await range(p, '#step', 5); await p.click('.chip[data-toggle="multiView"]'); await range(p, '#tilt', 40); await range(p, '#rotation', 12); await p.selectOption('#speed', '360'); }],
  ];
  for (const [name, set] of GEO) {
    const { ctx, page } = await open(); await set(page); await page.waitForTimeout(150); await allLayers(page);
    const a = await print(page), sa = await page.evaluate(peek);
    await page.reload(); await page.waitForTimeout(350);
    const sb = await page.evaluate(peek), b = await print(page), ui = sb.ui, g = JSON.parse(sb.geo);
    check(`Reload, Geometry: ${name}: the print file is the same to the byte, and every setting and control is as it was`, a.equals(b) && a.length > 2000 && sa.geo === sb.geo && sa.speed === sb.speed && sb.app === 'geometry' && ui.pattern === g.pattern && ui.view === g.mode && +ui.step === g.step && sb.toast === '' && !sb.bad.length,
      { sameBytes: a.equals(b), bytes: [a.length, b.length], before: sa.geo, after: sb.geo, ui, toast: sb.toast });
    await ctx.close();
  }
  { // every figure, as it first appears when chosen
    const { ctx, page } = await open(); const ids = await page.$$eval('#pattern option', o => o.map(x => x.value)); await allLayers(page); await studio(page, false); const diff = [];
    for (const id of ids) { await page.selectOption('#pattern', id); await page.waitForTimeout(80); const a = await print(page), sa = await page.evaluate(peek); await page.reload(); await page.waitForTimeout(300); const sb = await page.evaluate(peek), b = await print(page); if (!a.equals(b) || sa.geo !== sb.geo) diff.push(id); }
    check(`Reload, Geometry: all ${ids.length} figures as first chosen come back with the same print file, to the byte`, ids.length >= 12 && !diff.length, diff);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(); await page.selectOption('#pattern', 'seed'); await page.selectOption('#speed', '1100'); await page.click('#playBtn');
    await page.waitForFunction(() => window.__state.step >= 3, null, { timeout: 8000 }); const at = await page.evaluate(() => window.__state.step); await page.reload(); await page.waitForTimeout(300);
    const s = await page.evaluate(() => ({ step: window.__state.step, playing: window.__state.playing, btn: document.querySelector('#playBtn').textContent })); await page.waitForTimeout(1500); const later = await page.evaluate(() => window.__state.step);
    check('Play is not resumed by a reload: the figure comes back paused on the step it had reached', s.step === at && !s.playing && s.btn === '▶' && later === at, { at, s, later });
    await ctx.close();
  }

  /* ---------- gate 1: a reload restores Perspective exactly ---------- */
  const scene = async (p, id) => { await p.selectOption('#pvScene', id); await p.waitForTimeout(120); };
  const SCN = [
    ['a street in linear with a box added and moved, the squaring grid on, and a box chosen', async p => { await scene(p, 'street'); await p.click('#pvAdd'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowUp'); await p.click('#pvSqChip'); await range(p, '#pvEye', 71); }],
    ['the totem in curvilinear after a shot, the canvas turned, hidden edges on', async p => { await scene(p, 'totem'); const shots = await p.$$eval('.pv-shot', b => b.map(x => x.dataset.shot)); await p.click(`.pv-shot[data-shot="${shots[2] || shots[0]}"]`); await p.waitForTimeout(900); await p.click('#pvTurnCanvas'); await p.click('#pvShow [data-show="hidden"]'); await range(p, '#pvRoll', -7); }],
    ['one cube made a ring of dodecahedra, with the little guy standing in it', async p => { await scene(p, 'blank'); await p.evaluate(() => { const P = window.__pv; P.sel = { id: window.__state.pv.boxes[0].id, k: 0 }; P.render(); P.sync(); }); await p.click('#pvShapes [data-shape="dodeca"]'); await p.selectOption('#pvArr', 'ring'); await range(p, '#pvCount', 9); await range(p, '#pvSpan', 220); await p.click('#pvShow [data-show="guy"]'); await p.click('#pvShow [data-show="guy"]'); await p.click('#pvProj button[data-v="curvi"]'); }],
  ];
  for (const [name, set] of SCN) {
    const { ctx, page } = await open(); await pv(page); await set(page); await page.waitForTimeout(150); await allLayers(page);
    const a = await print(page), sa = await page.evaluate(peek);
    await page.reload(); await page.waitForTimeout(400);
    const sb = await page.evaluate(peek), b = await print(page);
    check(`Reload, Perspective: ${name}: the print file is the same to the byte, and the scene is as it was`, a.equals(b) && a.length > 2000 && sa.scene === sb.scene && sb.app === 'perspective' && sb.ui.pvApp && sb.toast === '' && !sb.bad.length, { sameBytes: a.equals(b), bytes: [a.length, b.length], same: sa.scene === sb.scene, before: sa.scene.slice(0, 300), after: sb.scene.slice(0, 300), toast: sb.toast });
    await ctx.close();
  }
  { // every built-in scene, untouched
    const { ctx, page } = await open(); await pv(page); const ids = await page.$$eval('#pvScene option', o => o.map(x => x.value)); await allLayers(page); await studio(page, false); const diff = [];
    for (const id of ids) { await scene(page, id); const a = await print(page), sa = await page.evaluate(peek); await page.reload(); await page.waitForTimeout(350); const sb = await page.evaluate(peek), b = await print(page); if (!a.equals(b) || sa.scene !== sb.scene) diff.push(id); }
    check(`Reload, Perspective: all ${ids.length} built-in scenes come back with the same print file, to the byte`, ids.length >= 10 && !diff.length, diff);
    await ctx.close();
  }

  /* ---------- gate 2: an edit made right before a reload, or before the tab is hidden, survives ---------- */
  {
    const { ctx, page } = await open(); await pv(page); await scene(page, 'blank'); await page.waitForTimeout(700);
    await page.click('#pvAdd'); const n0 = await page.evaluate(() => window.__state.pv.boxes.length); await page.reload(); await page.waitForTimeout(300);
    const n1 = await page.evaluate(() => window.__state.pv.boxes.length);
    check('A box added and the page reloaded at once: the box is still there', n0 === 2 && n1 === 2, { n0, n1 });
    await page.click('#appMode button[data-app="geometry"]'); await page.selectOption('#pattern', 'flower'); await page.waitForTimeout(700);
    await page.click('#nextBtn'); await page.click('#nextBtn'); const s0 = await page.evaluate(() => window.__state.step); await page.reload(); await page.waitForTimeout(300);
    const s1 = await page.evaluate(() => [window.__state.pattern, window.__state.step]);
    check('A step taken in Geometry and the page reloaded at once: the figure is on that step', s0 === 3 && s1[0] === 'flower' && s1[1] === 3, { s0, s1 });
    // the tab going into the background: headless Chromium cannot hide a tab, so the page is told it is hidden and sent the browser's own event
    const hidden = await page.evaluate(() => { document.querySelector('.chip[data-toggle="mirror"]').click(); const before = JSON.parse(localStorage.getItem('locus-geo') || '{}').mirror; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); return { before, after: JSON.parse(localStorage.getItem('locus-geo') || '{}').mirror }; });
    check('A toggle changed and the tab hidden at once: it is written the moment the tab is hidden, not 400 ms later', hidden.before === false && hidden.after === true, hidden);
    await pv(page); await page.waitForTimeout(600);
    const hid2 = await page.evaluate(() => { document.querySelector('#pvAdd').click(); const before = JSON.parse(localStorage.getItem('locus-pv')).boxes.length; document.dispatchEvent(new Event('visibilitychange')); return { before, after: JSON.parse(localStorage.getItem('locus-pv')).boxes.length }; });
    check('…and the same for a box added in Perspective', hid2.after === hid2.before + 1, hid2);
    // two tabs: the idle one must not write its older picture over the newer one when it is hidden
    const other = await ctx.newPage(); await other.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await other.goto('file://' + file); await other.waitForTimeout(400);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); }); await page.click('#pvAdd'); await page.waitForTimeout(700);
    const newer = await page.evaluate(() => localStorage.getItem('locus-pv'));
    const kept = await other.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); return localStorage.getItem('locus-pv'); });
    check('A second tab that has changed nothing does not write its older scene over the newer one when it is hidden or closed', kept === newer && JSON.parse(newer).boxes.length >= 3, { same: kept === newer });
    await ctx.close();
  }

  /* ---------- B2: a message's Undo undoes its own action ---------- */
  {
    const { ctx, page } = await open(); await pv(page); await scene(page, 'room'); await page.waitForTimeout(100);
    await scene(page, 'street'); const quiet = await page.evaluate(peek);
    check('Choosing a scene over an untouched built-in scene says nothing (nothing of yours was replaced)', quiet.toast === '', quiet.toast);
    await page.click('#pvAdd'); await page.keyboard.press('ArrowLeft'); await page.click('#pvAdd'); await range(page, '#pvYaw', 31); await allLayers(page); const mine = await page.evaluate(peek), fileA = await print(page);
    await scene(page, 'tower'); const said = await page.evaluate(peek);
    check('Choosing a scene over your own work says what happened, in one sentence, with an Undo', oneSentence(said.toast + '.') && /replaced/.test(said.toast) && /Tower/.test(said.toast) && said.toastBtn === 'Undo' && JSON.parse(said.scene).scene === 'tower', { toast: said.toast, btn: said.toastBtn });
    // something else is done while the message is up
    await page.click('#pvAdd'); await page.keyboard.press('ArrowRight'); await page.click('#pvShow [data-show="floor"]'); const between = await page.evaluate(peek);
    await page.click('#toast button'); await page.waitForTimeout(200); const back = await page.evaluate(peek), fileB = await print(page);
    check('That Undo puts back exactly the scene that was replaced, even after other things were done in between (same print file, to the byte)', back.scene === mine.scene && fileA.equals(fileB) && between.scene !== mine.scene, { same: back.scene === mine.scene, bytes: fileA.equals(fileB) });
    await page.keyboard.press('Control+z'); await page.waitForTimeout(150); const hist = await page.evaluate(peek);
    const noSel = t => JSON.stringify({ ...JSON.parse(t), sel: 0 });   // which box is chosen is not part of the undo history
    check('…and it is itself one undoable step: Ctrl+Z after it returns to what you had done in between', noSel(hist.scene) === noSel(between.scene), { same: noSel(hist.scene) === noSel(between.scene) });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(); await pv(page); await scene(page, 'platonic'); await page.click('#pvAdd'); await page.waitForTimeout(100); const mine = await page.evaluate(peek), n = JSON.parse(mine.scene).boxes.length;
    await page.click('#pvNewBtn'); await page.click('#pvNewMenu [data-new="clear"]'); await page.waitForTimeout(150); const said = await page.evaluate(peek);
    await page.click('#pvAdd'); await page.waitForTimeout(80); await page.click('#toast button'); await page.waitForTimeout(200); const back = await page.evaluate(peek);
    check('Clear shapes, then a shape added, then the message’s Undo: the cleared shapes come back exactly (it used to remove the new shape and leave them cleared)', new RegExp(`Cleared ${n} shapes`).test(said.toast) && said.toastBtn === 'Undo' && back.scene === mine.scene, { toast: said.toast, n, after: JSON.parse(back.scene).boxes.length });
    await page.click('#pvNewBtn'); await page.click('#pvNewMenu [data-new="fresh"]'); await page.waitForTimeout(150); await page.click('#pvTurnCanvas'); await page.click('#pvAdd'); await page.waitForTimeout(80);
    await page.click('#toast button'); await page.waitForTimeout(200); const back2 = await page.evaluate(peek);
    check('Start fresh, then the canvas turned and a shape added, then the message’s Undo: the scene you had comes back exactly', back2.scene === mine.scene, { same: back2.scene === mine.scene });
    await ctx.close();
  }
  { // undo while the camera is gliding
    const { ctx, page } = await open(); await pv(page); await scene(page, 'room'); await scene(page, 'street'); await page.waitForTimeout(200); const start = await page.evaluate(peek);
    const shots = await page.$$eval('.pv-shot', b => b.map(x => x.dataset.shot)), shot = `.pv-shot[data-shot="${shots.includes('bird') ? 'bird' : shots[1]}"]`;
    await page.click(shot); await page.waitForTimeout(1000); const landed = await page.evaluate(peek); await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
    await page.click(shot); await page.waitForTimeout(150); const mid = await page.evaluate(peek); await page.keyboard.press('Control+z'); await page.waitForTimeout(60); const un = await page.evaluate(peek); await page.waitForTimeout(900); const settled = await page.evaluate(peek);
    check('Undo pressed while the camera glides to a shot: the scene and view from before the glide come back, and the glide does not carry on over them', mid.scene !== start.scene && mid.scene !== landed.scene && un.scene === start.scene && settled.scene === start.scene && settled.redo, { midDiffers: mid.scene !== start.scene, un: un.scene === start.scene, settled: settled.scene === start.scene, redo: settled.redo });
    await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(150); const re = await page.evaluate(peek);
    check('…and Redo then gives the whole glide: the shot’s finished view, not a point halfway', re.scene === landed.scene, { same: re.scene === landed.scene });
    await page.keyboard.press('Control+z'); await page.waitForTimeout(100); await page.click(shot); await page.waitForTimeout(150); await scene(page, 'tower'); await page.waitForTimeout(900);
    const fresh = await page.evaluate(peek), want = await page.evaluate(() => { const v = window.__pv.fromScene('tower'); return [v.eye, v.yaw, v.pitch, v.dist]; }), got = JSON.parse(fresh.scene);
    check('A scene chosen while the camera glides opens with its own view: the glide does not finish on top of it', JSON.stringify([got.eye, got.yaw, got.pitch, got.dist]) === JSON.stringify(want), { got: [got.eye, got.yaw, got.pitch, got.dist], want });
    await ctx.close();
  }

  /* ---------- B3 and gate 4: save to a file, open in a fresh browser, same drawing ---------- */
  const saved = {};
  const TRIPS = [
    ['scene', 'a street with boxes added, a tetrahedron, the squaring grid and a chosen box', async p => { await pv(p); await SCN[0][1](p); await p.click('#pvShapes [data-shape="tetra"]'); }, '#pvSaveFile'],
    ['scene', 'a curvilinear ring of dodecahedra with the little guy', async p => { await pv(p); await SCN[2][1](p); }, '#pvSaveFile'],
    ['figure', 'the cube in two-point perspective', GEO[2][1], '#geoSaveFile'],
    ['figure', 'the Flower of Life in plan with dimensions', GEO[0][1], '#geoSaveFile'],
  ];
  for (const [kind, name, set, saveBtn] of TRIPS) {
    const { ctx, page } = await open(); await set(page); await page.waitForTimeout(150); await allLayers(page);
    // Studio settings that are not the usual ones, so the file has to carry them for the drawing to be the same
    await page.fill('#stPen-figure', '0.8'); await page.dispatchEvent('#stPen-figure', 'change'); await page.fill('#stPen-construction', '0.35'); await page.dispatchEvent('#stPen-construction', 'change'); if (kind === 'figure') { await page.selectOption('#stPage', 'a2'); await page.click('#stOrient button[data-v="landscape"]'); await page.fill('#stMargin', '35'); await page.dispatchEvent('#stMargin', 'change'); } await page.waitForTimeout(300);
    const a = await print(page), sa = await page.evaluate(peek), f = await grab(page, saveBtn); await ctx.close();
    let doc = null; try { doc = JSON.parse(f.buf.toString('utf8')); } catch { }
    check(`Save ${kind} file (${name}): one small JSON file with a format name, a version number and the ${kind} in it`, !!doc && doc.format === 'locus' && doc.version === 1 && doc.kind === kind && typeof doc[kind] === 'object' && /\.json$/.test(f.name) && f.buf.length < 60000 && (kind === 'scene' ? Array.isArray(doc.scene.boxes) && doc.scene.canvas.w > 0 : typeof doc.figure.pattern === 'string' && doc.figure.step >= 1), { name: f.name, bytes: f.buf.length, keys: doc && Object.keys(doc) });
    // another machine: a fresh browser context with nothing stored, opening in the other mode
    const B = await open(); if (kind === 'figure') await pv(B.page);
    await chooseFile(B.page, kind === 'figure' ? '#pvOpenFile' : '#geoOpenFile', f.f); const sb = await B.page.evaluate(peek), b = await print(B.page);
    check(`…opened in a fresh browser, it gives the same drawing: the print file is identical to the byte`, a.equals(b) && a.length > 2000 && (kind === 'scene' ? sa.scene === sb.scene && sb.app === 'perspective' : sa.geo === sb.geo && sb.app === 'geometry') && sa.studio === sb.studio && /^Opened “/.test(sb.toast) && sb.toastBtn === 'Undo' && !sb.bad.length, { sameBytes: a.equals(b), bytes: [a.length, b.length], state: kind === 'scene' ? sa.scene === sb.scene : sa.geo === sb.geo, studio: sa.studio === sb.studio, toast: sb.toast });
    await B.ctx.close(); saved[kind] = saved[kind] || f;
  }
  { // opening over work is undoable, and its Undo belongs to it
    const { ctx, page } = await open(); await pv(page); await scene(page, 'totem'); await page.click('#pvAdd'); await page.waitForTimeout(100); const mine = await page.evaluate(peek);
    await chooseFile(page, '#pvOpenFile', saved.scene.f); const opened = await page.evaluate(peek); await page.click('#pvAdd'); await page.waitForTimeout(80);
    await page.click('#toast button'); await page.waitForTimeout(200); const back = await page.evaluate(peek);
    check('Opening a scene file over your own work can be undone: the message’s Undo puts back your scene and your Studio settings exactly, even after something else was done', opened.scene !== mine.scene && back.scene === mine.scene && back.studio === mine.studio && back.app === 'perspective', { scene: back.scene === mine.scene, studio: back.studio === mine.studio });
    await page.click('#appMode button[data-app="geometry"]'); await page.selectOption('#pattern', 'vesica'); await range(page, '#step', 3); await page.waitForTimeout(100); const fig = await page.evaluate(peek);
    await chooseFile(page, '#geoOpenFile', saved.figure.f); const o2 = await page.evaluate(peek); await page.keyboard.press('Control+z'); await page.waitForTimeout(150); const u2 = await page.evaluate(peek);
    check('Opening a figure file is one step in the undo history as well: Ctrl+Z brings back the figure you had', o2.geo !== fig.geo && u2.geo === fig.geo && u2.app === 'geometry', { opened: o2.geo !== fig.geo, undone: u2.geo === fig.geo });
    await ctx.close();
  }

  /* ---------- B3 and gate 3: nothing read back can break the app ---------- */
  const BOX = { id: 1, x: 0, y: 0, z: 90, w: 20, h: 20, d: 20, ry: 0 }, CAN = { w: 36, h: 48 }, EYE = { x: 0, y: 60, z: 0 }, PV = o => JSON.stringify({ boxes: [BOX], canvas: CAN, eye: EYE, ...o }), P = 'perspective';
  // [name, what is in storage, 'tell' (one sentence expected) or 'quiet' (a harmless omission), options]. The first 14 are the kinds the code audit named.
  const STORES = [
    ['scene: not JSON at all', { 'locus-pv': '{not json', 'locus-app': P }, 'tell'],
    ['scene: boxes [null]', { 'locus-pv': JSON.stringify({ boxes: [null], canvas: CAN, eye: EYE }), 'locus-app': P }, 'tell'],
    ['scene: boxes [{}]', { 'locus-pv': JSON.stringify({ boxes: [{}], canvas: CAN, eye: EYE }), 'locus-app': P }, 'tell'],
    ['scene: a box with no repeat (an old save)', { 'locus-pv': PV({ yaw: 0, pitch: 0, dist: 30, proj: 'linear' }), 'locus-app': P }, 'quiet'],
    ['scene: canvas {} and eye {}', { 'locus-pv': JSON.stringify({ boxes: [], canvas: {}, eye: {} }), 'locus-app': P }, 'tell'],
    ['scene: canvas 0 × 0', { 'locus-pv': PV({ canvas: { w: 0, h: 0 } }), 'locus-app': P }, 'tell'],
    ['scene: every number a string', { 'locus-pv': JSON.stringify({ boxes: [{ id: '1', x: '0', y: '0', z: '90', w: '20', h: '20', d: '20', ry: '0', arr: { type: 'row', n: '3', gap: '2' } }], canvas: { w: '36', h: '48' }, eye: { x: '0', y: '60', z: '0' }, yaw: '10', pitch: '0', dist: '30' }), 'locus-app': P }, 'quiet'],
    ['scene: show is a string, cv null, dist 0', { 'locus-pv': PV({ show: 'x', cv: null, dist: 0 }), 'locus-app': P }, 'tell'],
    ['scene: unknown scene and projection', { 'locus-pv': PV({ scene: 'gone', proj: 'weird' }), 'locus-app': P }, 'tell'],
    ['scene: a broken little guy', { 'locus-pv': PV({ guy: { x: 'a' } }), 'locus-app': P }, 'tell'],
    ['studio: a layer null, unknown sheet, mode and dpi', { 'sg-studio': JSON.stringify({ layers: { figure: null }, page: 'zzz', mode: 'weird', dpi: 'x' }) }, 'tell'],
    ['studio: the number 42', { 'sg-studio': '42' }, 'tell'],
    ['theme: unknown', { 'locus-theme': 'sepia' }, 'quiet'],
    ['mode unknown, walk size NaN, lock "yes"', { 'locus-app': 'zzz', 'locus-walk-size': 'NaN', 'locus-view-lock': 'yes' }, 'quiet'],
    ['scene: JSON null', { 'locus-pv': 'null', 'locus-app': P }, 'tell'],
    ['scene: an empty list', { 'locus-pv': '[]', 'locus-app': P }, 'tell'],
    ['scene: cv null alone', { 'locus-pv': PV({ cv: null }), 'locus-app': P }, 'tell'],
    ['scene: canvas {} alone', { 'locus-pv': PV({ canvas: {} }), 'locus-app': P }, 'tell'],
    ['scene: eye height null, turn "abc", pitch 1e99, roll true', { 'locus-pv': PV({ eye: { x: 0, y: null, z: 0 }, yaw: 'abc', pitch: 1e99, roll: true }), 'locus-app': P }, 'tell'],
    ['scene: floor grid 0 (the plan would loop for ever)', { 'locus-pv': PV({ grid: 0 }), 'locus-app': P }, 'tell'],
    ['scene: squaring grid of a ten-millionth of an inch', { 'locus-pv': PV({ sq: 1e-7 }), 'locus-app': P }, 'tell'],
    ['scene: a repeat of a billion by a billion', { 'locus-pv': PV({ boxes: [{ ...BOX, arr: { type: 'grid', n: 1e9, n2: 1e9, gap: 2 } }] }), 'locus-app': P }, 'tell'],
    ['scene: boxes of width -5, height "Infinity", depth 0, and one good one', { 'locus-pv': PV({ boxes: [{ ...BOX, w: -5 }, { ...BOX, id: 2, h: 'Infinity' }, { ...BOX, id: 3, d: 0 }, { ...BOX, id: 4 }] }), 'locus-app': P }, 'tell'],
    ['scene: two boxes with one number, and a chosen box that is not there', { 'locus-pv': PV({ boxes: [BOX, { ...BOX, x: 40 }], sel: { id: 99, k: 0 } }), 'locus-app': P }, 'quiet'],
    ['scene: keys it has never heard of', { 'locus-pv': '{"boxes":[{"id":1,"x":0,"y":0,"z":90,"w":20,"h":20,"d":20,"ry":0,"__proto__":{"w":"NaN"},"zzz":[1,2]}],"canvas":{"w":36,"h":48},"eye":{"x":0,"y":60,"z":0},"__proto__":{"dist":"x"},"constructor":5,"future":{"a":1}}', 'locus-app': P }, 'quiet'],
    ['scene: canvas a billion by minus five', { 'locus-pv': PV({ canvas: { w: 1e9, h: -5 } }), 'locus-app': P }, 'tell'],
    ['scene: an arch with a broken pivot and a repeat called "spiral"', { 'locus-pv': PV({ boxes: [{ ...BOX, arr: { type: 'arch', n: 5, span: 180, pivot: { x: null } } }, { ...BOX, id: 2, x: 50, arr: { type: 'spiral' } }] }), 'locus-app': P }, 'tell'],
    ['scene: a shape called "blob", turned "sideways"', { 'locus-pv': PV({ boxes: [{ ...BOX, shape: 'blob', ry: 'sideways', rx: 9999 }] }), 'locus-app': P }, 'tell'],
    ['scene: 2,005 shapes', { 'locus-pv': PV({ boxes: Array.from({ length: 2005 }, (_, i) => ({ ...BOX, id: i + 1, x: (i % 50) * 6 - 150, z: 90 + Math.floor(i / 50) * 6, w: 2, h: 2, d: 2 })) }), 'locus-app': P }, 'tell', { noStudio: true, wait: 4000 }],
    ['figure: not JSON at all', { 'locus-geo': '}{' }, 'tell'],
    ['figure: unknown figure, step 999, view "iso"', { 'locus-geo': JSON.stringify({ pattern: 'pentagram', step: 999, mode: 'iso' }) }, 'tell'],
    ['figure: rotation "NaN", tilt 500, weight -3, horizon null', { 'locus-geo': JSON.stringify({ pattern: 'cube', mode: 'perspective', rotation: 'NaN', tilt: 500, weight: -3, horizon: null, depth: 1e308 }) }, 'tell'],
    ['figure: vanishing points crossed over', { 'locus-geo': JSON.stringify({ pattern: 'cube', mode: 'perspective', perspectivePoints: 2, vpLeft: 700, vpRight: 200, vp3Y: 'up' }) }, 'tell'],
    ['figure: toggles written as words', { 'locus-geo': JSON.stringify({ pattern: 'flower', guides: 'yes', mirror: 1, depthInk: null, perspectivePoints: '2' }) }, 'tell'],
    ['figure: only the figure’s name (a partial save)', { 'locus-geo': JSON.stringify({ pattern: 'flower' }) }, 'quiet'],
    ['figure: step 0', { 'locus-geo': JSON.stringify({ pattern: 'seed', step: 0 }) }, 'tell'],
    ['studio: pen 0, colour "red", sheet -5 wide, tiling "zzz", overlap "abc"', { 'sg-studio': JSON.stringify({ layers: { figure: { on: 'yes', pen: 0, color: 'red' }, marks: 7 }, page: 'custom', cw: -5, ch: 'NaN', sheet: 'zzz', overlap: 'abc', slot: 0, span: null }) }, 'tell'],
    ['studio: an empty list', { 'sg-studio': '[]' }, 'tell'],
    ['everything broken at once', { 'locus-pv': 'x', 'locus-geo': 'y', 'sg-studio': 'z', 'locus-theme': '', 'locus-app': P }, 'tell'],
  ];
  const seed = store => `(${(s) => { try { if (!sessionStorage.getItem('seeded')) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } catch (e) { } }})(${JSON.stringify(store)})`;
  const failures = [], told = [];
  for (const [name, store, want, o = {}] of STORES) {
    const { ctx, page, errs } = await open({ quiet: true }); await page.evaluate(s => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store); await page.reload(); await page.waitForTimeout(250); if (o.wait) await page.waitForTimeout(o.wait);
    const a = await page.evaluate(peek).catch(e => ({ dead: true, err: e.message.slice(0, 80) })); const why = [];
    if (a.dead) why.push('the app did not start'); else {
      if (a.bad.length) why.push('not a number in the drawing: ' + a.bad[0]); if (!a.drawn) why.push('nothing drawn');
      if (want === 'tell' ? !(oneSentence(a.toast) && /could not be read/.test(a.toast) && a.toastBtn === 'OK') : a.toast !== '') why.push(`message: "${a.toast}"`);
      if (!o.noStudio) { let file = null; try { await studio(page, true); const empty = /^Nothing to output/.test(await page.textContent('#studioStats')); if (empty) await studio(page, false); else file = (await print(page)).toString('utf8'); } catch (e) { why.push('Studio: ' + e.message.split('\n')[0].slice(0, 80)); } if (file && (BAD.test(file) || !/^<svg[^>]* width="[\d.]+mm" height="[\d.]+mm"/.test(file))) why.push('the print file is not sound');
        const s = await page.evaluate(peek).catch(() => ({ bad: ['dead'] })); if (s.bad.length) why.push('not a number in the Studio: ' + s.bad[0]); }
      // both modes must draw, whichever one it opened in
      await page.click(`#appMode button[data-app="${a.app === 'perspective' ? 'geometry' : 'perspective'}"]`).catch(() => why.push('the mode switch is dead')); await page.waitForTimeout(o.wait ? 1500 : 150); const c = await page.evaluate(peek).catch(() => ({ bad: ['dead'], drawn: 0 })); if (c.bad.length || !c.drawn) why.push('the other mode: ' + (c.bad[0] || 'nothing drawn'));
      await page.waitForTimeout(450); await page.reload(); await page.waitForTimeout(o.wait ? 2500 : 300); const again = await page.evaluate(peek).catch(() => ({ dead: true }));
      if (again.dead || again.bad.length || !again.drawn) why.push('after a reload: broken'); else if (again.toast !== '') why.push(`said again after a reload: "${again.toast}"`);
    }
    if (errs.length) why.push('script error: ' + errs[0].slice(0, 90)); if (why.length) failures.push({ name, why }); if (want === 'tell' && a.toast) told.push(`${name} → ${a.toast}`);
    await ctx.close();
  }
  check(`${STORES.length} malformed stores: each one starts, draws both modes with every number a number, gives a sound print file, and either says nothing (a harmless omission) or one plain sentence, once`, !failures.length, failures);
  for (const [name, init] of [['Storage blocked altogether (the browser refuses it)', `Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}})`], ['Storage full (every write refused)', `Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}`]]) {
    const { ctx, page, errs } = await open({ init, quiet: true }); await page.selectOption('#pattern', 'flower'); await pv(page); await page.click('#pvAdd'); await page.click('#themeBtn'); await page.waitForTimeout(600); await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
    const a = await page.evaluate(peek); let ok = true; try { await print(page); } catch { ok = false; }
    check(`${name}: Locus runs as usual, with no error and no message`, !a.dead && !errs.length && ok && a.toast === '' && !a.bad.length && JSON.parse(a.scene).boxes.length === 3, { errs, toast: a.toast });
    await ctx.close();
  }

  /* ---------- files that must be refused, and one that must be repaired ---------- */
  {
    const good = saved.scene.buf.toString('utf8'), doc = JSON.parse(good), fig = JSON.parse(saved.figure.buf.toString('utf8'));
    const REFUSE = [
      ['plain text', 'hello, this is my shopping list', /not a Locus file/],
      ['an empty file', '', /not a Locus file/],
      ['JSON that is not Locus’s', JSON.stringify({ hello: 1, boxes: [] }), /not a Locus file/],
      ['a list, a number, a word', '[1,2,3]', /not a Locus file/],
      ['the word "locus"', '"locus"', /not a Locus file/],
      ['an image', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0xff, 0xfe, 0, 1]), /not a Locus file/],
      ['a Locus file cut short', good.slice(0, Math.floor(good.length * .6)), /cut short/],
      ['a Locus file cut off after its first line', good.slice(0, 40), /cut short/],
      ['a file from a newer Locus (version 2)', JSON.stringify({ ...doc, version: 2 }), /newer Locus/],
      ['a version written as a word', JSON.stringify({ ...doc, version: 'one' }), /not a Locus file/],
      ['version 0', JSON.stringify({ ...doc, version: 0 }), /not a Locus file/],
      ['a kind it does not know', JSON.stringify({ ...doc, kind: 'mural' }), /not a kind/],
      ['a scene file with no scene', JSON.stringify({ format: 'locus', version: 1, kind: 'scene' }), /no scene/],
      ['a scene that is null', JSON.stringify({ ...doc, scene: null }), /no scene/],
      ['a scene with no shapes list', JSON.stringify({ ...doc, scene: { canvas: CAN, eye: EYE } }), /no scene/],
      ['a figure Locus does not have', JSON.stringify({ ...fig, figure: { ...fig.figure, pattern: 'tree-of-life' } }), /no figure/],
      ['a figure that is a number', JSON.stringify({ ...fig, figure: 7 }), /no figure/],
      ['a file of 6 MB', JSON.stringify({ ...doc, pad: 'x'.repeat(6e6) }), /too big/],
    ];
    const { ctx, page } = await open(); await pv(page); await scene(page, 'platonic'); await page.click('#pvAdd'); await page.waitForTimeout(700);
    const before = await page.evaluate(peek), store0 = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort())), wrong = [];
    for (const [name, data, re] of REFUSE) { await chooseFile(page, '#pvOpenFile', write('bad.json', data)); const s = await page.evaluate(peek);
      if (!(re.test(s.toast) && /nothing was changed\.$/.test(s.toast) && oneSentence(s.toast) && s.toastBtn === 'OK' && s.scene === before.scene && s.geo === before.geo && s.studio === before.studio && s.app === before.app && s.undo === before.undo && !s.bad.length)) wrong.push({ name, toast: s.toast, changed: s.scene !== before.scene }); await page.click('#toast button'); }
    await page.waitForTimeout(600); const store1 = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
    check(`${REFUSE.length} files that are not Locus’s, are cut short, are from a newer Locus or hold nothing readable: each is refused in one sentence and nothing changes (scene, figure, Studio settings, undo history, storage)`, !wrong.length && store0 === store1, { wrong, storage: store0 === store1 });
    // a real Locus file with faults in it: opened, repaired, and said
    const hurt = JSON.parse(good); hurt.scene.canvas.w = 'wide'; hurt.scene.boxes.push(null, { x: 1 }); hurt.scene.cv = null; hurt.studio = { layers: 3, margin: -9 };
    await chooseFile(page, '#pvOpenFile', write('hurt.json', JSON.stringify(hurt))); const s = await page.evaluate(peek); let file = ''; try { file = (await print(page)).toString('utf8'); } catch { }
    check('A Locus file with faults in it (a canvas width in words, two unreadable shapes, broken Studio settings) opens, says in one sentence what was reset and left out, and can be undone', /^Opened “hurt\.json”, but part of it could not be read: Locus reset .*left out 2 shapes$/.test(s.toast) && s.toastBtn === 'Undo' && !s.bad.length && /^<svg/.test(file) && !BAD.test(file) && JSON.parse(s.scene).boxes.length === doc.scene.boxes.length, { toast: s.toast, bad: s.bad });
    await page.click('#toast button'); await page.waitForTimeout(200); const back = await page.evaluate(peek);
    check('…and its Undo puts back the scene and Studio settings that were there', back.scene === before.scene && back.studio === before.studio, { scene: back.scene === before.scene, studio: back.studio === before.studio });
    await ctx.close();
  }


  /* ---------- after the round 1 review: a refusal is not joined to a file message; a repaired empty canvas says so; the sheet's Paper is kept ---------- */
  {
    const good = saved.scene.buf.toString('utf8'), { ctx, page } = await open(); await pv(page); await scene(page, 'platonic'); await page.waitForTimeout(300);
    await chooseFile(page, '#pvOpenFile', write('bad2.json', 'hello, not locus')); const refused = (await page.evaluate(peek)).toast;
    await studio(page, true); await page.click('#stModes button[data-v="print"]'); await page.waitForTimeout(320); await grab(page, '#stDownload'); const after = await page.evaluate(peek);
    check('A download confirmation never joins a refusal: after “That is not a Locus file…” (an OK button, no Undo) a download replaces the message with its own line', /not a Locus file/.test(refused) && /^Downloaded /.test(after.toast) && !/not a Locus file/.test(after.toast), { refused, after: after.toast });
    // an Undo message still keeps its Undo and gains the confirmation (the earlier rule stays)
    await studio(page, false); const hurt = JSON.parse(good); hurt.scene.canvas.w = 'wide'; await chooseFile(page, '#pvOpenFile', write('hurt2.json', JSON.stringify(hurt))); await studio(page, true); await grab(page, '#stDownload'); const kept = await page.evaluate(peek);
    check('…while an Undo message still keeps its Undo and gains the confirmation beside it', kept.toastBtn === 'Undo' && /Opened/.test(kept.toast) && /Downloaded /.test(kept.toast), kept.toast);
    await ctx.close();
  }
  {
    const good = saved.scene.buf.toString('utf8'), { ctx, page } = await open(); await pv(page);
    const zero = JSON.parse(good); zero.scene.canvas = { w: 0, h: -3 }; zero.scene.boxes = [{ x: 900, y: 0, z: 0, w: 5, h: 5, d: 5 }]; zero.scene.sq = 0; zero.scene.show = Object.fromEntries((await page.evaluate(() => Object.keys(window.__state.pv.show))).map(k => [k, false]));
    await chooseFile(page, '#pvOpenFile', write('zero.json', JSON.stringify(zero))); await studio(page, true); await page.click('#stModes button[data-v="print"]'); await page.waitForTimeout(500);
    const layersOn = await page.evaluate(() => Object.values(window.__studio.ST.layers).filter(l => l.on).length), shown = await page.textContent('#studioStats'); let got = false; page.once('download', () => { got = true; });
    await page.evaluate(() => document.querySelector('#stDownload').click()); await page.waitForTimeout(500); const t = (await page.evaluate(peek)).toast;
    check('A file whose canvas had to be repaired and shows nothing: layers are on, so Download does not say “turn on a layer”; it says no line falls on the canvas, and so does the preview', layersOn > 0 && !got && /no line falls on the canvas/.test(t) && !/Turn on a layer/.test(t) && /no line falls on the canvas/.test(shown), { layersOn, t, shown });
    await ctx.close();
  }
  {
    const { ctx, page } = await open(); await studio(page, true); await page.selectOption('#stSoPaper', 'a4'); await page.waitForTimeout(100); await page.reload(); await page.waitForTimeout(500); await studio(page, true);
    const v = await page.inputValue('#stSoPaper'); await page.selectOption('#stSoPaper', 'letter'); await page.reload(); await page.waitForTimeout(500); await studio(page, true); const w = await page.inputValue('#stSoPaper');
    await page.evaluate(() => localStorage.setItem('sg-studio', JSON.stringify({ ...JSON.parse(localStorage.getItem('sg-studio')), setout: 'tabloid' }))); await page.reload(); await page.waitForTimeout(500); await studio(page, true); const x = await page.inputValue('#stSoPaper');
    check('The setting-out sheet’s Paper choice is remembered between visits (A4 stays A4, back to Letter stays Letter), and an unknown saved paper falls back to Letter', v === 'a4' && w === 'letter' && x === 'letter', { v, w, x });
    await ctx.close();
  }

  check('No script errors', errors.length === 0, errors);
  await browser.close(); fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + JSON.stringify(r.detail)}`));
  if (process.env.SENTENCES) { console.log('\nWhat the artist is told:'); told.forEach(t => console.log('  ' + t)); }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { check('The check itself crashed: ' + String(e.message).split('\n')[0], false, e.stack); try { await browser.close(); } catch { } const n = report(); console.log(`${n} failed (crash)`); process.exit(1); });
