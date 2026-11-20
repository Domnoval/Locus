// Setting-out sheet checks for Locus: a person following the sheet must get the figure. Exits non-zero if any check fails.
// usage: node tools/sheet-check.js [path/to/index.html]   (PLAYWRIGHT=/path/to/playwright to use an existing install)
// The centre of this file is a replay. An independent reader takes only the words and tables of the downloaded sheet, carries the
// instructions out with its own arithmetic (set a radius, strike a circle about a named point, rule a line through two named points,
// mark where two things cross), and ends with a drawing. That drawing is compared with the print SVG the Studio gives for the same
// figure at the same size. Nothing here asks Locus what it meant: both files come through the real buttons and are read as files.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib'), { spawnSync } = require('child_process');
const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'locus-sheet-'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const TOL = 0.5;   // mm: how far the hand-built figure may sit from the print, working from the sheet's rounded millimetres at 48 in
// At any other size the arithmetic limit is what holds: the first point is placed to the nearest 0.5 mm each way (0.25 × √2), a circle about it has its radius
// rounded by up to 0.25, and the print file's own numbers sit on a 0.03 mm grid. A stepped compass setting adds 0.025 a radius, already inside the first two.
const BOUND = +(.25 * Math.SQRT2 + .25 + .03).toFixed(3);
const NEAR = 0.28; // mm, per axis: a table position against a point of the print file. 0.25 is the rounding to 0.5 mm; the rest is the print file's own grid (its numbers are 0.01 of a screen unit apart, up to 0.03 mm at 48 in)

/* ---------- reading the sheet: words and tables only ---------- */
const un = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/ /g, ' ');
function readSheet(html) {
  const paras = [], byId = new Map(), tables = {}, labels = []; let step = 0;
  const pages = html.split('<section class="page"').slice(1);
  pages.forEach(pg => { const re = /<div class="r([^"]*)"(?: data-step="(\d+)")?(?: data-p="(\d+)")?>([^<]*)<\/div>|<table data-table="(\w+)">([\s\S]*?)<\/table>/g; let m;
    while ((m = re.exec(pg))) {
      if (m[5]) { const rows = tables[m[5]] = tables[m[5]] || []; (m[6].split('<tbody>')[1] || '').replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_, tr) => { rows.push([...tr.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(c => un(c[1]))); return ''; }); continue; }
      if (m[2]) { step = +m[2]; continue; }
      if (!m[3]) continue; let p = byId.get(m[3]); if (!p) { p = { cls: m[1].trim(), step: /\bin\b/.test(m[1]) ? step : 0, text: '' }; byId.set(m[3], p); paras.push(p); } p.text += (p.text ? ' ' : '') + un(m[4]).trim(); } });
  [...html.matchAll(/<g class="lb"[^>]*>([\s\S]*?)<\/g>/g)].forEach(g => [...g[1].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].forEach(t => labels.push(un(t[1]))));
  const size = (html.match(/@page\{size:([\d.]+)mm ([\d.]+)mm/) || []).slice(1).map(Number);
  return { paras, tables, labels, pages: pages.length, size, steps: [...new Set([...html.matchAll(/data-step="(\d+)"/g)].map(m => +m[1]))], text: paras.map(p => p.text).join('\n') };
}
// a length as the sheet writes it: "7 3/8 in (186.5 mm)". The reader works in one unit throughout, as the sheet tells the artist to
const IN = String.raw`-?(?:\d+ \d+\/\d+|\d+\/\d+|\d+) in`, MM = String.raw`-?\d+(?:\.\d+)? mm`, LEN = `(${IN}) \\((${MM})\\)`, NAME = String.raw`([^\s,.:;()]+)`;
const REF = `the (?:circle about ${NAME}(?: of radius ${LEN})?|line through ${NAME} and ${NAME})`;
const inches = t => { const m = t.match(/^(-?)(?:(\d+) (\d+)\/(\d+)|(\d+)\/(\d+)|(\d+)) in$/); return (m[1] ? -1 : 1) * (m[2] ? +m[2] + m[3] / m[4] : m[5] ? m[5] / m[6] : +m[7]); };
const cellIn = t => inches(t + ' in');

/* ---------- the replay: follow the sentences with nothing but a compass, a straightedge and a tape ---------- */
function replay(sheet, unit) {
  const len = (i, mm) => unit === 'mm' ? parseFloat(mm) : inches(i) * 25.4;
  const pts = new Map(), circles = [], lines = [], out = [], errors = [], said = new Set(), claims = []; let compass = null, stated = null, lastPt = null, lastCircle = null, first = null;
  // setting the compass: to the length given, or, where the sheet asks for ten steps along a line, to a tenth of what the ten steps must measure
  const SET = `(Set the compass to|Same compass setting,) ${LEN}\\.(?: To set it exactly, step it ten times along a straight line: the ten steps together must measure ${LEN}\\.)?`;
  const set = (how, i, mm, ti, tmm) => { const r = len(i, mm); if (how[1] === 'a') { if (Math.abs(r - stated) > 1e-9) errors.push('“Same compass setting” but the setting changed'); return; } stated = r; compass = ti ? len(ti, tmm) / 10 : r; if (ti && Math.abs(compass - r) > (unit === 'mm' ? .25 : 25.4 / 32) * 1.1 + 1e-9) errors.push(`ten steps (${tmm}) do not agree with the setting (${mm})`); };
  const P = n => { said.add(n); const p = pts.get(n); if (!p) { errors.push(`uses ${n} before it is marked`); return [NaN, NaN]; } return p; };
  const mark = (n, xy) => { said.add(n); if (pts.has(n)) errors.push(`${n} is marked twice`); pts.set(n, xy); lastPt = n; if (!first) first = n; };
  const levelUp = k => { const r = (sheet.tables.levels || []).find(r => +r[0] === +k); if (!r) { errors.push('no level ' + k); return NaN; } return unit === 'mm' ? +r[4] : cellIn(r[3]) * 25.4; };
  // what a named thing is, from what has been drawn so far
  const thing = (c, ri, rmm, a, b) => { if (c) { said.add(c); const mine = circles.filter(q => q.name === c), want = ri ? len(ri, rmm) : null, hit = want == null ? mine : mine.filter(q => Math.abs(q.stated - want) < 1e-6);
      if (hit.length !== 1) errors.push(`“the circle about ${c}” fits ${hit.length} circles drawn so far`); return hit[0] && { t: 'c', c: hit[0].c, r: hit[0].r }; }
    const hit = lines.filter(l => (l.a === a && l.b === b) || (l.a === b && l.b === a)); if (!hit.length) errors.push(`no line through ${a} and ${b} has been ruled`); return { t: 'l', p: P(a), q: P(b) }; };
  const cross = (A, B) => { if (!A || !B) return [];
    if (A.t === 'l' && B.t === 'l') { const d1 = [A.q[0] - A.p[0], A.q[1] - A.p[1]], d2 = [B.q[0] - B.p[0], B.q[1] - B.p[1]], den = d1[0] * d2[1] - d1[1] * d2[0]; if (Math.abs(den) < 1e-12) return []; const t = ((B.p[0] - A.p[0]) * d2[1] - (B.p[1] - A.p[1]) * d2[0]) / den; return [[A.p[0] + t * d1[0], A.p[1] + t * d1[1]]]; }
    if (A.t === 'l') [A, B] = [B, A];
    if (B.t === 'l') { const d = [B.q[0] - B.p[0], B.q[1] - B.p[1]], L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L], t = (A.c[0] - B.p[0]) * u[0] + (A.c[1] - B.p[1]) * u[1], f = [B.p[0] + t * u[0], B.p[1] + t * u[1]], h2 = A.r * A.r - (A.c[0] - f[0]) ** 2 - (A.c[1] - f[1]) ** 2; if (h2 < 0) return []; const h = Math.sqrt(h2); return [[f[0] - h * u[0], f[1] - h * u[1]], [f[0] + h * u[0], f[1] + h * u[1]]]; }
    const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1], d = Math.hypot(dx, dy); if (d < 1e-9 || d > A.r + B.r || d < Math.abs(A.r - B.r)) return []; const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, A.r * A.r - a * a)), mx = A.c[0] + a * dx / d, my = A.c[1] + a * dy / d;
    return [[mx - h * dy / d, my + h * dx / d], [mx + h * dy / d, my - h * dx / d]]; };
  const draw = (o, light) => out.push({ ...o, light: !!light });
  const seg = (a, b, i, mm, light) => { const p = P(a), q = P(b); lines.push({ a, b }); draw({ k: 'seg', a: p, b: q }, light); claims.push({ what: `${a} to ${b}`, said: len(i, mm), got: Math.hypot(q[0] - p[0], q[1] - p[1]) }); };
  const RULES = [
    [`Mark ${NAME} at ${LEN} across and ${LEN} up(?: from the bottom-left corner of the sheet)?\\.`, m => mark(m[1], [len(m[2], m[3]), len(m[4], m[5])])],
    [`${SET} Mark ${NAME} that far from ${NAME}, (?:level with it, to the (right|left)|straight (above|below) it|toward the spot ${LEN} across and ${LEN} up)\\.`, m => { set(m[1], m[2], m[3], m[4], m[5]); const o = P(m[7]), d = compass; let u;
      if (m[8]) u = [m[8] === 'right' ? 1 : -1, 0]; else if (m[9]) u = [0, m[9] === 'above' ? 1 : -1]; else { const s = [len(m[10], m[11]) - o[0], len(m[12], m[13]) - o[1]], L = Math.hypot(s[0], s[1]); u = [s[0] / L, s[1] / L]; } mark(m[6], [o[0] + d * u[0], o[1] + d * u[1]]); }],
    [`Mark ${NAME} where ${REF} crosses ${REF}(?:, at the (?:crossing that is not ${NAME}|(upper|lower|right-hand|left-hand) crossing))?\\.`, m => { const xs = cross(thing(m[2], m[3], m[4], m[5], m[6]), thing(m[7], m[8], m[9], m[10], m[11])); let p = xs[0];
      if (!xs.length) { errors.push(`${m[1]}: the two things do not cross`); p = [NaN, NaN]; }
      else if (m[12]) { const z = P(m[12]); p = xs.reduce((a, b) => Math.hypot(a[0] - z[0], a[1] - z[1]) > Math.hypot(b[0] - z[0], b[1] - z[1]) ? a : b); }
      else if (m[13]) p = xs.reduce((a, b) => (m[13] === 'upper' ? a[1] > b[1] : m[13] === 'lower' ? a[1] < b[1] : m[13] === 'right-hand' ? a[0] > b[0] : a[0] < b[0]) ? a : b);
      else if (xs.length > 1 && Math.hypot(xs[0][0] - xs[1][0], xs[0][1] - xs[1][1]) > 1e-6) errors.push(`${m[1]}: two crossings and the sheet does not say which`); mark(m[1], p); }],
    [`Mark ${NAME} on the axis at level (\\d+)\\.`, m => mark(m[1], [P(first)[0], levelUp(m[2])])],
    [`Mark ${NAME} on level (\\d+), ${LEN} (left|right) of the axis\\.`, m => mark(m[1], [P(first)[0] + (m[5] === 'left' ? -1 : 1) * len(m[3], m[4]), levelUp(m[2])])],
    [`${SET} Point on ${NAME}: (lightly )?draw (?:a circle|the (shorter|longer) arc from ${NAME} to ${NAME})\\.`, m => { set(m[1], m[2], m[3], m[4], m[5]); const r = compass, c = P(m[6]);
      if (m[8]) draw({ k: 'arc', c, r, from: P(m[9]), to: P(m[10]), long: m[8] === 'longer' }, m[7]); else { circles.push(lastCircle = { name: m[6], c, r, stated }); draw({ k: 'circle', c, r }, m[7]); } }],
    [`(Lightly rule|Rule) a line through ${NAME} and ${NAME}, carried on ${LEN} past each\\.`, m => { const p = P(m[2]), q = P(m[3]), L = Math.hypot(q[0] - p[0], q[1] - p[1]), u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L], e = len(m[4], m[5]); lines.push({ a: m[2], b: m[3] }); draw({ k: 'seg', a: [p[0] - e * u[0], p[1] - e * u[1]], b: [q[0] + e * u[0], q[1] + e * u[1]] }, m[1][0] === 'L'); }],
    [`(Lightly rule|Rule) a line from ${NAME} to ${NAME}, ${LEN}\\.`, m => seg(m[2], m[3], m[4], m[5], m[1][0] === 'L')],
    [`(Lightly rule|Rule) these (\\d+) lines: ((?:${NAME} to ${NAME}, ${LEN}(?:; )?)+)\\.`, m => { const items = [...m[3].matchAll(new RegExp(`${NAME} to ${NAME}, ${LEN}`, 'g'))]; if (items.length !== +m[2]) errors.push(`says ${m[2]} lines, lists ${items.length}`); items.forEach(x => seg(x[1], x[2], x[3], x[4], m[1][0] === 'L')); }],
    [`Ellipse centred on ${NAME}: (lightly )?draw it with its long axis from ${NAME} to ${NAME}, ${LEN}, and ${LEN} wide across the middle\\.`, m => { const c = P(m[1]), e1 = P(m[3]), e2 = P(m[4]); draw({ k: 'ellipse', e1, e2, b: len(m[7], m[8]) / 2 }, m[2]);
      claims.push({ what: `long axis ${m[3]} to ${m[4]}`, said: len(m[5], m[6]), got: Math.hypot(e2[0] - e1[0], e2[1] - e1[1]) }, { what: `ellipse centre ${m[1]}`, said: 0, got: Math.hypot((e1[0] + e2[0]) / 2 - c[0], (e1[1] + e2[1]) / 2 - c[1]) }); }],
    [`Paint a solid dot ${LEN} across, centred on ${NAME}\\.`, m => draw({ k: 'circle', c: P(m[3]), r: len(m[1], m[2]) / 2, dot: true })],
    // things the sheet tells the artist to check: the reader checks them too
    [`Check: ${REF} passes through it\\.`, m => { const T = thing(m[1], m[2], m[3], m[4], m[5]), p = P(lastPt); if (T && T.t === 'l') { const d = [T.q[0] - T.p[0], T.q[1] - T.p[1]]; claims.push({ what: `line through ${m[4]} and ${m[5]} passes through ${lastPt}`, said: 0, got: Math.abs((p[0] - T.p[0]) * d[1] - (p[1] - T.p[1]) * d[0]) / Math.hypot(d[0], d[1]) }); } }],
    [`It passes through ${NAME}\\.`, m => { const p = P(m[1]); claims.push({ what: `circle about ${lastCircle.name} passes through ${m[1]}`, said: lastCircle.r, got: Math.hypot(p[0] - lastCircle.c[0], p[1] - lastCircle.c[1]) }); }],
    [`That is the distance from ${NAME} to ${NAME}\\.`, m => { const p = P(m[1]), q = P(m[2]); claims.push({ what: `compass is ${m[1]} to ${m[2]}`, said: stated, got: Math.hypot(p[0] - q[0], p[1] - q[1]) }); }],
    [`In this view it is the same spot as ${NAME}\\.`, m => { const p = P(lastPt), q = P(m[1]); claims.push({ what: `${lastPt} on ${m[1]}`, said: 0, got: Math.hypot(p[0] - q[0], p[1] - q[1]) }); }],
    [`Nothing to rule from ${NAME} to ${NAME}: in this view they are the same spot\\.`, m => { const p = P(m[1]), q = P(m[2]); claims.push({ what: `${m[1]} on ${m[2]}`, said: 0, got: Math.hypot(p[0] - q[0], p[1] - q[1]) }); }],
    [`With two pins and a loop of string: pins on the long axis ${LEN} either side of ${NAME}, and the string from pin to pencil to pin ${LEN}\\.`, m => { const e = out[out.length - 1], a = Math.hypot(e.e2[0] - e.e1[0], e.e2[1] - e.e1[1]) / 2; claims.push({ what: 'pins of the ellipse', said: len(m[1], m[2]), got: Math.sqrt(Math.max(0, a * a - e.b * e.b)), loose: a / Math.sqrt(Math.max(1e-9, a * a - e.b * e.b)) }, { what: 'string of the ellipse', said: len(m[4], m[5]), got: 2 * a }); }],
    [`Level (\\d+) is ${LEN} up from the bottom edge of the sheet\\.`, m => { const t = levelUp(m[1]); claims.push({ what: `level ${m[1]} height, said inline and in the table`, said: len(m[2], m[3]), got: t }); }],
    [`The (?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+th) )?circle about ${NAME} is seen (?:edge-on in this view, so it is a straight line|at an angle in this view, so it is an ellipse)\\.`, () => { }],
    [`Nothing new to draw at this step\\.`, () => { }]].map(([re, fn]) => [new RegExp('^' + re), fn]);
  sheet.paras.filter(p => p.cls === 'in').forEach(p => { let rest = p.text;
    while (rest) { const hit = RULES.find(([re]) => re.test(rest)); if (!hit) { errors.push(`step ${p.step}: cannot follow “${rest.slice(0, 90)}”`); break; } const m = rest.match(hit[0]); hit[1](m); rest = rest.slice(m[0].length).trim(); } });
  return { pts, out, errors, said, claims };
}

/* ---------- the print file, and how far one drawing is from the other ---------- */
const parseSvg = text => { const strokes = [], root = (text.match(/<svg[^>]*>/) || [''])[0], attr = n => (root.match(new RegExp(` ${n}="([^"]+)"`)) || [])[1];
  const re = /<g id="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g; let m;
  while ((m = re.exec(text))) { const pr = /<path d="([^"]+)"([^>]*)\/>/g; let p;
    while ((p = pr.exec(m[2]))) (p[1].match(/M[^M]*/g) || []).forEach(sub => { const n = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g).map(Number), pts = []; for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]); if (/Z\s*$/.test(sub)) pts.push(pts[0]); strokes.push({ layer: m[1], pts, filled: !/stroke=/.test(p[2]) }); }); }
  return { strokes, W: parseFloat(attr('width')), H: parseFloat(attr('height')), unit: (attr('width') || '').replace(/[\d.]/g, '') }; };
const dSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
// the replay's drawing, turned to the print file's frame (millimetres from the top-left corner), as exact shapes
function shapes(run, H, lightToo) { const f = p => [p[0], H - p[1]];
  return run.out.filter(o => lightToo ? o.light : !o.light).map(o => { if (o.k === 'seg') return { k: 'seg', a: f(o.a), b: f(o.b) }; if (o.k === 'circle') return { k: 'circle', c: f(o.c), r: o.r };
    if (o.k === 'arc') { const c = f(o.c), a0 = Math.atan2(f(o.from)[1] - c[1], f(o.from)[0] - c[0]), a1 = Math.atan2(f(o.to)[1] - c[1], f(o.to)[0] - c[0]), d = norm(a1 - a0), short = d <= Math.PI ? [a0, d] : [a1, 2 * Math.PI - d], sp = o.long ? [short[0] + short[1], 2 * Math.PI - short[1]] : short; return { k: 'arc', c, r: o.r, s: sp[0], w: sp[1], ends: [f(o.from), f(o.to)] }; }
    const e1 = f(o.e1), e2 = f(o.e2), c = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], a = Math.hypot(e2[0] - e1[0], e2[1] - e1[1]) / 2, u = [(e2[0] - e1[0]) / (2 * a), (e2[1] - e1[1]) / (2 * a)], poly = [];
    for (let i = 0; i <= 2880; i++) { const t = i / 2880 * 2 * Math.PI, x = a * Math.cos(t), y = o.b * Math.sin(t); poly.push([c[0] + x * u[0] - y * u[1], c[1] + x * u[1] + y * u[0]]); } return { k: 'poly', pts: poly }; }); }
const dShape = (p, s) => { if (s.k === 'seg') return dSeg(p, s.a, s.b); const d = s.k === 'poly' ? 0 : Math.hypot(p[0] - s.c[0], p[1] - s.c[1]); if (s.k === 'circle') return Math.abs(d - s.r);
  if (s.k === 'arc') return norm(Math.atan2(p[1] - s.c[1], p[0] - s.c[0]) - s.s) <= s.w + 1e-9 ? Math.abs(d - s.r) : Math.min(...s.ends.map(e => Math.hypot(p[0] - e[0], p[1] - e[1])));
  let best = Infinity; for (let i = 1; i < s.pts.length; i++) { const e = dSeg(p, s.pts[i - 1], s.pts[i]); if (e < best) best = e; } return best; };
const sample = s => { const out = []; if (s.k === 'seg') { const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), n = Math.max(2, Math.ceil(L / 2)); for (let i = 0; i <= n; i++) out.push([s.a[0] + (s.b[0] - s.a[0]) * i / n, s.a[1] + (s.b[1] - s.a[1]) * i / n]); }
  else if (s.k === 'poly') s.pts.forEach((p, i) => { if (i % 4 === 0) out.push(p); }); else { const w = s.k === 'arc' ? s.w : 2 * Math.PI, s0 = s.k === 'arc' ? s.s : 0, n = Math.max(24, Math.ceil(w * s.r / 2)); for (let i = 0; i <= n; i++) out.push([s.c[0] + s.r * Math.cos(s0 + w * i / n), s.c[1] + s.r * Math.sin(s0 + w * i / n)]); } return out; };
// both ways: every point of every line the replay drew lies on a line of the print file, and every line of the print file was drawn by the replay
// A printed curve is a polyline whose corners are on the true curve, so the curve bulges from its chords by a sagitta. That is measured from the file itself (half the
// largest corner-to-chord distance covers two) and allowed to the replay's line when it is tested against the chords. The other way round the corners themselves are tested, with no allowance.
const sagOf = pts => { let e = 0; for (let i = 1; i + 1 < pts.length; i++) { const a = pts[i - 1], b = pts[i + 1], p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l > 1e-9) e = Math.max(e, Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l); } return e / 2; };
function compare(run, svg, lightToo, layers = l => l !== 'marks') { const strokes = svg.strokes.filter(s => layers(s.layer) && s.pts.length > 1 && s.pts.some(p => Math.hypot(p[0] - s.pts[0][0], p[1] - s.pts[0][1]) > .05)), mine = shapes(run, svg.H, lightToo);
  const cell = 25, grid = new Map(), key = (x, y) => x + ',' + y; strokes.forEach(s => { const sag = s.pts.length > 3 ? sagOf(s.pts) : 0; for (let i = 1; i < s.pts.length; i++) { const a = s.pts[i - 1], b = s.pts[i]; for (let x = Math.floor((Math.min(a[0], b[0]) - 3) / cell); x <= Math.floor((Math.max(a[0], b[0]) + 3) / cell); x++) for (let y = Math.floor((Math.min(a[1], b[1]) - 3) / cell); y <= Math.floor((Math.max(a[1], b[1]) + 3) / cell); y++) { const k = key(x, y); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([a, b, sag]); } } });
  let offPrint = 0, offWhere = '', offMine = 0, mineWhere = '';
  mine.forEach((s, si) => sample(s).forEach(p => { let d = 3; (grid.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell))) || []).forEach(([a, b, sag]) => { const e = Math.max(0, dSeg(p, a, b) - sag); if (e < d) d = e; }); if (d > offPrint) { offPrint = d; offWhere = `${s.k} ${si} at ${p.map(v => v.toFixed(1))}`; } }));
  strokes.forEach(s => { const probe = []; s.pts.forEach((p, i) => { probe.push(p); if (i) probe.push([(p[0] + s.pts[i - 1][0]) / 2, (p[1] + s.pts[i - 1][1]) / 2]); });
    probe.forEach(p => { let d = Infinity; for (const m of mine) { const e = dShape(p, m); if (e < d) { d = e; if (d < 1e-3) break; } } if (d > offMine) { offMine = d; mineWhere = `${s.layer} at ${p.map(v => v.toFixed(1))}`; } }); });
  return { shapes: mine.length, strokes: strokes.length, replayOffPrint: +offPrint.toFixed(3), offWhere, printOffReplay: +offMine.toFixed(3), mineWhere, worst: +Math.max(offPrint, offMine).toFixed(3) }; }

/* ---------- a PDF as Chromium prints it: page boxes and every straight stroke, in millimetres from the top-left of its page ---------- */
function readPdf(buf) { const s = buf.toString('latin1'), objs = {}, re = /(\d+) 0 obj/g; let m;
  while ((m = re.exec(s))) { const start = m.index + m[0].length, end = s.indexOf('endobj', start), body = s.slice(start, end), o = { dict: body }, si = body.indexOf('stream');
    if (si >= 0) { o.dict = body.slice(0, si); let a = start + si + 6; if (s[a] === '\r') a++; if (s[a] === '\n') a++; let raw = buf.subarray(a, s.lastIndexOf('endstream', end)); if (/FlateDecode/.test(o.dict)) raw = zlib.inflateSync(raw); o.stream = raw.toString('latin1'); } objs[m[1]] = o; }
  const kids = id => { const o = objs[id]; if (/\/Type\s*\/Pages/.test(o.dict)) return [...o.dict.match(/\/Kids\s*\[([^\]]*)\]/)[1].matchAll(/(\d+) 0 R/g)].flatMap(k => kids(k[1])); return [o]; }, root = Object.keys(objs).find(id => /\/Type\s*\/Pages/.test(objs[id].dict) && !/\/Parent/.test(objs[id].dict));
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  return kids(root).map(pg => { const box = pg.dict.match(/\/MediaBox\s*\[([^\]]+)\]/)[1].trim().split(/\s+/).map(Number), streams = [...pg.dict.match(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/)[1].matchAll(/(\d+) 0 R/g)].map(c => objs[c[1]].stream).join('\n');
    const k = 25.4 / 72, segs = [], stack = []; let ctm = [1, 0, 0, 1, 0, 0], nums = [], cur = null, start = null, path = []; const at = (x, y) => [(ctm[0] * x + ctm[2] * y + ctm[4]) * k, (box[3] - (ctm[1] * x + ctm[3] * y + ctm[5])) * k];
    for (const tok of streams.replace(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>/g, ' ').split(/\s+/)) { if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(tok)) { nums.push(+tok); continue; }
      if (tok === 'q') stack.push(ctm); else if (tok === 'Q') ctm = stack.pop() || ctm; else if (tok === 'cm') ctm = mul(nums.slice(-6), ctm);
      else if (tok === 'm') { cur = start = at(nums[nums.length - 2], nums[nums.length - 1]); } else if (tok === 'l') { const p = at(nums[nums.length - 2], nums[nums.length - 1]); if (cur) path.push([cur, p]); cur = p; } else if (tok === 'h') { if (cur && start) path.push([cur, start]); cur = start; }
      else if (tok === 'S' || tok === 's') { segs.push(...path); path = []; } else if (/^(f|F|f\*|n|B|B\*|b|b\*)$/.test(tok)) path = [];
      nums = []; }
    return { w: box[2] * k, h: box[3] * k, segs }; }); }

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (query = '?app=geometry', viewport = { width: 1400, height: 900 }) => { const ctx = await browser.newContext({ viewport, acceptDownloads: true }), page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort()); await page.goto('file://' + file + query); return { ctx, page }; };
  let seq = 0; const grab = async (page, sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const f = path.join(tmp, `${++seq}-${d.suggestedFilename()}`); await d.saveAs(f); return { name: d.suggestedFilename(), f, buf: fs.readFileSync(f) }; };
  const studio = async (page, on) => { if (await page.evaluate(() => document.querySelector('#studio').open) !== on) await page.click(on ? '#studioBtn' : '#stClose'); await page.waitForTimeout(on ? 320 : 60); };
  // put a figure on screen through its own controls: figure, view, step, turn, tilt, and the chips
  const figure = async (page, id, o = {}) => { await studio(page, false); await page.selectOption('#pattern', id); await page.click(`#viewMode button[data-mode="${o.mode || 'axon'}"]`);
    await page.evaluate(o => { const st = window.__state, fire = (e, t) => e.dispatchEvent(new Event(t, { bubbles: true })); if (st.autoRotate) document.querySelector('#autoRotateBtn').click();
      const s = document.querySelector('#step'); s.value = o.step || s.max; fire(s, 'input'); const set = (sel, v) => { const e = document.querySelector(sel); e.value = v; fire(e, 'input'); fire(e, 'change'); }; set('#rotation', o.rot || 0); set('#tilt', o.tilt || 0);
      Object.entries({ guides: false, workings: false, mirror: false, ...(o.chips || {}) }).forEach(([k, v]) => { if (!!st[k] !== v) document.querySelector(`.chip[data-toggle="${k}"]`).click(); });
      const S = window.__studio; Object.assign(S.ST, { mode: 'print', page: '48x48', orient: 'portrait', margin: 50, sheet: 'off', ...(o.studio || {}) }); Object.keys(S.ST.layers).forEach(k => S.ST.layers[k].on = (o.layers || ['construction', 'figure', 'accent', 'drafting']).includes(k)); }, o);
    await page.waitForTimeout(60); await studio(page, true); };
  const sheetOf = async (page, paper) => { await page.selectOption('#stSoPaper', paper); const d = await grab(page, '#stSetOut'); return { ...d, html: d.buf.toString(), sheet: readSheet(d.buf.toString()) }; };
  const printOf = async page => parseSvg((await grab(page, '#stDownload')).buf.toString());

  /* ===== the gate: all twelve figures at their last step, three at a step part-way, rebuilt from the sheet alone ===== */
  const { page } = await open();
  if (!(await page.$('#stSetOut'))) { console.log('FAIL  The Studio has a Setting-out sheet control  "this file has none, so there is no sheet to check"\n\n0/1 passed'); await browser.close(); process.exit(1); }
  const CASES = [
    ...['seed', 'flower', 'metatron', 'vesica', 'yantra', 'continuum'].map((id, i) => ({ id, what: 'last step, as it opens (seen square-on)', paper: i % 2 ? 'letter' : 'a4', gate: true })),
    ...['metatron3d', 'tetrahedron', 'cube', 'octahedron', 'dodecahedron', 'icosahedron'].map((id, i) => ({ id, rot: 25, tilt: 60, what: 'last step, 3D view turned 25° and tilted 60°', paper: i % 2 ? 'a4' : 'letter', gate: true })),
    { id: 'flower', step: 9, mode: 'plan', what: 'step 9 of 20, 2D', paper: 'letter', gate: true }, { id: 'metatron', step: 12, mode: 'plan', what: 'step 12 of 18, 2D', paper: 'a4', gate: true },
    { id: 'yantra', step: 7, mode: 'plan', what: 'step 7 of 15, 2D', paper: 'letter', gate: true }, { id: 'continuum', step: 19, mode: 'plan', what: 'step 19 of 26 (Fruit of Life), 2D', paper: 'a4', gate: true },
    { id: 'cube', what: 'last step, as it opens (straight down, corners one over another)', paper: 'a4' }, { id: 'cube', rot: 45, tilt: 54.7356, what: 'last step, down its 3-fold axis', paper: 'letter' },
    { id: 'flower', rot: 20, tilt: 50, what: 'last step, tilted 50° with its circles lifted', paper: 'a4' }, { id: 'flower', mode: 'plan', rot: 17, chips: { mirror: true }, what: 'last step, 2D turned 17° and mirrored', paper: 'letter' },
    { id: 'metatron', mode: 'plan', chips: { workings: true }, what: 'last step, 2D with Workings on', paper: 'a4', workings: true }];
  const runs = [], keep = {};
  for (const c of CASES) { await figure(page, c.id, c); const stepNow = await page.evaluate(() => window.__state.step), sh = await sheetOf(page, c.paper), svg = await printOf(page), mm = replay(sh.sheet, 'mm'), inch = replay(sh.sheet, 'in');
    // with Workings on, the working lines print on the Drafting layer: the figure is compared with the other layers, the lightly ruled lines with that one
    const inkLayers = c.workings ? l => l !== 'marks' && l !== 'drafting' : undefined, cm = compare(mm, svg, false, inkLayers), ci = compare(inch, svg, false, inkLayers), claim = r => r.claims.reduce((w, q) => Math.max(w, Math.abs(q.said - q.got) / (q.loose || 1)), 0);
    const lightOn = c.workings ? compare(mm, svg, true, l => l === 'drafting') : null;
    runs.push({ ...c, stepNow, sh, svg, mm, inch, cm, ci, claimMm: +claim(mm).toFixed(3), lightOn, row: { figure: c.id, what: c.what, steps: sh.sheet.steps.length, points: sh.sheet.tables.points.length, pages: sh.sheet.pages, drawn: cm.shapes, printStrokes: cm.strokes, worstMm: cm.worst, worstInch: ci.worst, cannot: mm.errors.slice(0, 3), ...(process.env.WHERE ? { a: cm.replayOffPrint, at: cm.offWhere, b: cm.printOffReplay, bt: cm.mineWhere } : {}) } });
    keep[c.id + (c.gate && !c.step ? '' : ':' + c.what)] = runs[runs.length - 1]; }
  const gate = runs.filter(r => r.gate), okRun = r => !r.mm.errors.length && r.cm.shapes > 0 && r.cm.worst <= TOL;
  check(`The replay rebuilds all 12 figures from the sheet alone: at the last step, every line the sheet has you draw lies on a line of the print file and every line of the print file is drawn, within ${TOL} mm at 48 in, working from the sheet's rounded millimetres`, gate.filter(r => !r.step).length === 12 && gate.filter(r => !r.step).every(okRun), gate.filter(r => !r.step).map(r => r.row));
  check(`…and four figures part-way through (Flower step 9, Metatron step 12, Sri Yantra step 7, Continuum step 19): the sheet gives exactly that many steps and the replay matches the print at that step`, gate.filter(r => r.step).every(r => okRun(r) && r.sh.sheet.steps.length === r.step && r.stepNow === r.step), gate.filter(r => r.step).map(r => r.row));
  check('Other views rebuild too: a cube straight down and down its 3-fold axis, a tilted Flower with its circles lifted (ellipses), a Flower turned 17° and mirrored', runs.filter(r => !r.gate && !r.workings).every(okRun), runs.filter(r => !r.gate && !r.workings).map(r => r.row));
  { const r = runs.find(r => r.workings); check('With Workings on, every working line the sheet has you rule lightly lies on a working line of the print file', r && !r.mm.errors.length && r.cm.worst <= TOL && r.lightOn.shapes > 0 && r.lightOn.replayOffPrint <= TOL, r && { ...r.row, lightLines: r.lightOn.shapes, lightOffPrint: r.lightOn.replayOffPrint }); }
  const worstMm = Math.max(...gate.map(r => r.cm.worst)), worstIn = Math.max(...gate.map(r => r.ci.worst));
  console.log(`NOTE  worst distance between the hand-built figure and the print, over the gate's ${gate.length} sheets: ${worstMm} mm working in millimetres, ${worstIn} mm working in inches (1/16 in is 1.6 mm)`);
  check(`Working in inches the same sheets still rebuild every figure (the reader can follow every sentence), and the sheet is honest that millimetres are finer: the worst case in inches is ${worstIn} mm`, gate.every(r => !r.inch.errors.length && r.ci.shapes === r.cm.shapes) && worstIn > worstMm && gate.every(r => /millimetres are the finer/.test(r.sh.sheet.text)), gate.filter(r => r.inch.errors.length).map(r => [r.id, r.inch.errors[0]]));
  { // the replay has to be able to fail. Four sheets, each with one thing wrong, must each come out away from the print
    const spoil = (r, fn) => { const paras = r.sh.sheet.paras.map(p => ({ ...p })); fn(paras.filter(p => p.cls === 'in'), paras); const run = replay({ ...r.sh.sheet, paras }, 'mm'); return run.errors.length ? 'cannot follow: ' + run.errors[0] : compare(run, r.svg).worst; };
    const edit = (list, re, to) => { const p = list.find(p => re.test(p.text)); p.text = p.text.replace(re, to); }, cube = runs.find(r => r.id === 'cube' && r.gate);
    const trials = [['Flower, untouched', spoil(keep.flower, () => { }), false],
      ['Flower, the stepped compass setting 1 mm long (ten steps 10 mm long)', spoil(keep.flower, l => edit(l, /(ten steps together must measure [^(]*\()([\d.]+) mm/, (m, a, b) => `${a}${+b + 10} mm`)), true],
      ['Flower, the last circle left out', spoil(keep.flower, (l, all) => all.splice(all.indexOf(l[l.length - 1]), 1)), true],
      ['Sri Yantra, one corner marked right of the axis instead of left', spoil(keep.yantra, l => edit(l, /(Mark U2a on level \d+, [^.]*?) left of the axis/, '$1 right of the axis')), true],
      ['Cube, one corner plotted 2 mm out', spoil(cube, l => edit(l, /(Mark V3 at [^(]*\()([\d.]+) mm/, (m, a, b) => `${a}${+b + 2} mm`)), true]];
    check('The replay can fail: the Flower’s own sheet passes, and the same sheets with a compass setting 1 mm long, a circle left out, a corner on the wrong side of the axis or a point 2 mm out each end up away from the print', trials.every(([, got, bad]) => bad ? typeof got === 'string' || got > TOL : got <= TOL), trials.map(([what, got]) => [what, got])); }
  // a stated length and the two points it joins are three numbers rounded separately: 0.25 mm for the length and 0.25 mm on each axis of each end
  const CLAIM = +(.25 + 2 * .25 * Math.SQRT2).toFixed(3);
  check(`Every length the sheet states for a ruled line, an ellipse or a compass check is the length the replay measures on its own drawing, within ${CLAIM} mm (the rounding of the length and of both its ends)`, runs.every(r => r.claimMm <= CLAIM), runs.map(r => [r.id, r.claimMm]));

  /* ===== names, tables and numbers ===== */
  { const bad = []; runs.forEach(r => { const t = r.sh.sheet.tables.points, names = t.map(x => x[0]), onKey = new Set(r.sh.sheet.labels.flatMap(l => l.split('=')).filter(l => !/^detail \d+$/.test(l)));
      if (new Set(names).size !== names.length) bad.push([r.id, 'a name is used twice']); [...r.mm.said].forEach(n => { if (!names.includes(n)) bad.push([r.id, n + ' is not in the table']); if (!onKey.has(n)) bad.push([r.id, n + ' is not on the key drawing']); }); names.forEach(n => { if (!onKey.has(n)) bad.push([r.id, n + ' is in the table but not on the key drawing']); }); });
    check('Point names are unique, and every name used in a sentence is on the key drawing and in the table (all ' + runs.length + ' sheets)', !bad.length, bad.slice(0, 8)); }
  { const bad = []; let n = 0; runs.forEach(r => { [...r.sh.sheet.text.matchAll(new RegExp(LEN, 'g'))].forEach(m => { n++; if (Math.abs(inches(m[1]) * 25.4 - parseFloat(m[2])) > 25.4 / 32 + .25 + 1e-9) bad.push([r.id, m[0]]); });
      Object.values(r.sh.sheet.tables).forEach(rows => rows.forEach(row => { for (let i = 1; i + 1 < row.length; i += 2) if (/^-?[\d /]+$/.test(row[i]) && /^-?[\d.]+$/.test(row[i + 1])) { n++; if (Math.abs(cellIn(row[i]) * 25.4 - row[i + 1]) > 25.4 / 32 + .25 + 1e-9) bad.push([r.id, row[0], row[i], row[i + 1]]); } })); });
    check(`The inch and millimetre figures agree: each pair is one length rounded two ways, to 1/16 in and to 0.5 mm (${n} pairs read)`, n > 3000 && !bad.length, bad.slice(0, 6)); }
  { // the table against the print file: a point that is the centre of a printed circle, or the end of a printed line, sits where the table says
    const rows = []; let all = true; runs.filter(r => r.gate).forEach(r => { const H = r.svg.H, centres = [], ends = [];
      r.svg.strokes.forEach(s => { if (s.layer === 'marks') return; const closed = s.pts.length > 12 && Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]) < 1e-6;
        if (closed) { const q = s.pts.slice(1), c = [q.reduce((t, p) => t + p[0], 0) / q.length, q.reduce((t, p) => t + p[1], 0) / q.length], d = q.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])); if (Math.max(...d) - Math.min(...d) < .1) centres.push(c); } else ends.push(s.pts[0], s.pts[s.pts.length - 1]); });
      let matched = 0, worst = 0; const loose = []; r.sh.sheet.tables.points.forEach(row => { const p = [+row[2], H - row[4]], pi = [cellIn(row[1]) * 25.4, H - cellIn(row[3]) * 25.4]; let best = Infinity; [...centres, ...ends].forEach(q => { const e = Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])); if (e < best) best = e; });
        if (best <= NEAR) { matched++; worst = Math.max(worst, best); } else { const on = r.mm.pts.get(row[0]), e = on ? Math.max(Math.abs(on[0] - p[0]), Math.abs(H - on[1] - p[1])) : 9; if (e > TOL) loose.push([row[0], +e.toFixed(2)]); }
        if (Math.max(Math.abs(pi[0] - p[0]), Math.abs(pi[1] - p[1])) > 25.4 / 32 + .25 + 1e-9) loose.push([row[0], 'inch and mm columns differ']); });
      rows.push({ figure: r.id, what: r.what, points: r.sh.sheet.tables.points.length, onPrintCentreOrEnd: matched, worstMm: +worst.toFixed(3), others: loose.slice(0, 4) }); if (!matched || loose.length) all = false; });
    check(`Table positions match the print file: every point that is the centre of a printed circle or the end of a printed line is within ${NEAR} mm of it on each axis (0.25 mm of rounding, and the 0.03 mm grid the print file's own numbers sit on), and every other point is where the replay constructed it`, all, rows); }

  /* ===== the size chosen in the Studio drives every number ===== */
  { await figure(page, 'flower', {}); const a = await sheetOf(page, 'a4'); await figure(page, 'flower', { studio: { page: 'custom', cw: 2438.4, ch: 2438.4, margin: 100 } }); const b = await sheetOf(page, 'a4'), svgB = await printOf(page);
    const nums = s => [...s.sheet.paras.filter(p => p.cls === 'in').map(p => p.text).join(' ').matchAll(/\((-?[\d.]+) mm\)/g)].map(m => +m[1]).concat(s.sheet.tables.points.flatMap(r => [+r[2], +r[4], +r[6], +r[8]])), A = nums(a), B = nums(b);
    const off = A.map((v, i) => Math.abs(B[i] - 2 * v)), rb = replay(b.sheet, 'mm'), cb = compare(rb, svgB);
    check(`Changing the Studio’s real size changes every number in proportion: a sheet twice the size (96 × 96 in, margin doubled) doubles every length and position in the steps and the table, to within rounding, and still rebuilds the print within the ${BOUND} mm that rounding to 0.5 mm allows at any size`, A.length > 100 && A.length === B.length && Math.max(...off) <= .75 + 1e-9 && A.some(v => v > 100) && !rb.errors.length && cb.worst <= BOUND, { numbers: A.length, worstOff: Math.max(...off), sizeLine: b.sheet.paras.find(p => /^Real size/.test(p.text)).text, rebuildWorstMm: cb.worst });
    await figure(page, 'flower', {}); }

  /* ===== the printed page: paper size, true scale, nothing lost, nothing fetched ===== */
  const viewer = await (await browser.newContext({ viewport: { width: 1000, height: 1300 } })).newPage(); const fetched = []; viewer.on('request', r => { if (!/^(file|data|blob|about):/.test(r.url())) fetched.push(r.url()); }); viewer.on('pageerror', e => errors.push('sheet: ' + e.message));
  const have = cmd => { const r = spawnSync(cmd, ['-v'], { encoding: 'utf8' }); return !r.error; };
  for (const [paper, w, h] of [['a4', 210, 297], ['letter', 215.9, 279.4]]) { await figure(page, 'flower', {}); const sh = await sheetOf(page, paper); await viewer.goto('file://' + sh.f); await viewer.emulateMedia({ media: 'print' });
    const dom = await viewer.evaluate(() => { const px = 25.4 / 96, pg = document.querySelector('.page').getBoundingClientRect(), box = id => { const r = document.getElementById(id).getBoundingClientRect(); return [(r.left - pg.left) * px, (r.top - pg.top) * px, r.width * px]; }; return { mm: box('so-rule-mm'), inch: box('so-rule-in'), pages: document.querySelectorAll('.page').length }; });
    const pdfFile = path.join(tmp, `rule-${paper}.pdf`); await viewer.pdf({ path: pdfFile, preferCSSPageSize: true, printBackground: true }); const pdf = readPdf(fs.readFileSync(pdfFile));
    // the rule in the PDF: the stroke that starts where the page puts it. Its length is read from the PDF's own numbers, at the PDF's 72 points to the inch
    const find = at => pdf[0].segs.filter(([a, b]) => Math.abs(a[1] - b[1]) < .01 && Math.abs(Math.min(a[0], b[0]) - at[0]) < .15 && Math.abs(a[1] - at[1]) < .15).map(([a, b]) => +Math.abs(b[0] - a[0]).toFixed(3)), rmm = find(dom.mm), rin = find(dom.inch);
    check(`${paper === 'a4' ? 'A4' : 'Letter'}: in the PDF Chromium prints at 100%, the check rule is 100 mm long and the inch rule 4 in (101.6 mm), to 0.02 mm, read from the PDF’s own drawing commands`, rmm.length === 1 && Math.abs(rmm[0] - 100) <= .02 && rin.length === 1 && Math.abs(rin[0] - 101.6) <= .02, { mmRule: rmm, inchRule: rin, onPage: dom.mm.map(v => +v.toFixed(2)) });
    check(`${paper === 'a4' ? 'A4' : 'Letter'}: every page of the document is ${w} × ${h} mm, the PDF has one page per sheet (${dom.pages}) and no blank extra, and the file says the same size in its own @page rule`, pdf.length === dom.pages && pdf.length === sh.sheet.pages && pdf.every(p => Math.abs(p.w - w) < .2 && Math.abs(p.h - h) < .2) && sh.sheet.size[0] === w && sh.sheet.size[1] === h, pdf.map(p => [+p.w.toFixed(2), +p.h.toFixed(2)]));
    // an independent reader: poppler rasterises the strip of page 1 that holds the rules at 2400 dpi, and each rule is measured in pixels from the middle of its first tick to the middle of its last.
    // Poppler snaps a thin line to whole pixels, so each end can sit a pixel out: two pixels at 2400 dpi is 0.02 mm
    if (have('pdftoppm')) { const DPI = 2400, k = DPI / 25.4, x0 = Math.round((dom.mm[0] - 4) * k), y0 = Math.round((dom.mm[1] - 6) * k), base = path.join(tmp, `strip-${paper}`);
      spawnSync('pdftoppm', ['-r', String(DPI), '-gray', '-f', '1', '-l', '1', '-x', String(x0), '-y', String(y0), '-W', String(Math.round(112 * k)), '-H', String(Math.round(18 * k)), pdfFile, base], { timeout: 180000 });
      const pgm = fs.readdirSync(tmp).filter(f => f.startsWith(`strip-${paper}`) && f.endsWith('.pgm')).map(f => fs.readFileSync(path.join(tmp, f)))[0], hd = pgm.toString('latin1', 0, 40).match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/), W = +hd[1], off = hd[0].length, dark = (x, y) => pgm[off + y * W + x] < 128;
      const span = at => { const y = Math.round((at[1] - 1.2) * k) - y0; let lo = -1, hi = -1; for (let x = 0; x < W; x++) if (dark(x, y)) { if (lo < 0) lo = x; hi = x; } let l2 = lo, h2 = hi; while (dark(l2 + 1, y)) l2++; while (dark(h2 - 1, y)) h2--; return ((h2 + hi) / 2 - (lo + l2) / 2) / k; }, a = span(dom.mm), b = span(dom.inch);
      check(`${paper === 'a4' ? 'A4' : 'Letter'}: poppler renders the same PDF at 2400 dpi and the rules measure 100 mm and 101.6 mm between their end ticks, to 0.025 mm`, Math.abs(a - 100) <= .025 && Math.abs(b - 101.6) <= .025, { mm: +a.toFixed(3), inch: +b.toFixed(3) }); }
    else console.log('SKIP  pdftoppm is not installed: the independent reading of the rule was not made');
    if (have('pdfinfo')) { const out = spawnSync('pdfinfo', [pdfFile], { encoding: 'utf8' }).stdout || '', m = out.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/); check(`${paper === 'a4' ? 'A4' : 'Letter'}: pdfinfo reads the page as ${w} × ${h} mm`, m && Math.abs(m[1] * 25.4 / 72 - w) < .2 && Math.abs(m[2] * 25.4 / 72 - h) < .2, m && [m[1], m[2]]); } }
  // layout: every sheet made above, in the font the machine falls back to and in three others, loses nothing off the edge of a page and no two names touch
  { const bad = [], seen = []; for (const r of runs) { await viewer.goto('file://' + r.sh.f); await viewer.emulateMedia({ media: 'print' });
      for (const font of ['', 'DejaVu Sans Mono', 'FreeMono']) { const res = await viewer.evaluate(font => { let st = document.getElementById('force'); if (!st) { st = document.createElement('style'); st.id = 'force'; document.head.appendChild(st); } st.textContent = font ? `body,svg text{font-family:"${font}"!important}` : ''; document.body.offsetWidth;
          const out = { clipped: 0, overlaps: 0, covered: 0, labels: 0, font: getComputedStyle(document.body).fontFamily.slice(0, 30) };
          document.querySelectorAll('.page').forEach(pg => { const R = pg.getBoundingClientRect(), pad = 12 * 96 / 25.4 - 1; pg.querySelectorAll('.r,td,th,h1,.h2,svg').forEach(e => { const b = e.getBoundingClientRect(), w = Math.max(b.width, e.scrollWidth || 0); if (b.left < R.left + pad - 1 || b.left + w > R.right - pad + 2 || b.bottom > R.bottom - 14 || b.top < R.top + pad - 1) out.clipped++; }); });
          document.querySelectorAll('svg.key').forEach(svg => { const L = [...svg.querySelectorAll('.lb text')].map(t => t.getBoundingClientRect()), dots = [...svg.querySelectorAll('g[fill="#000"] circle[r=".55"]')].map(c => { const b = c.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); out.labels += L.length;
            L.forEach((a, i) => { L.forEach((b, j) => { if (j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.overlaps++; }); dots.forEach(d => { if (d[0] > a.left && d[0] < a.right && d[1] > a.top && d[1] < a.bottom) out.covered++; }); }); }); return out; }, font);
        if (res.clipped || res.overlaps || res.covered || !res.labels) bad.push([r.id, r.what, font || 'default', res]);
        if (!font) seen.push(res.labels); } }
    check(`Layout holds whichever font the reader has (the machine’s fallback, DejaVu Sans Mono, FreeMono): on all ${runs.length} sheets no line of text or table cell runs off its page, no two names on a key drawing overlap, and no name sits on another point (${seen.reduce((a, b) => a + b, 0)} names measured in the browser)`, !bad.length, bad.slice(0, 5)); }
  check('The sheet is one self-contained file: opening and printing it fetches nothing from the network (so blocked or missing fonts change nothing)', fetched.length === 0 && runs.every(r => !/https?:\/\//.test(r.sh.html.replace(/xmlns="[^"]+"/g, ''))), fetched.slice(0, 3));
  { const r = keep.flower.sh.sheet, head = r.paras.map(p => p.text); check('The header carries the figure, the step, the real size, the date, and the check rule; the footer numbers the pages', /<div class="r eye">LOCUS · SETTING-OUT SHEET<\/div>/.test(keep.flower.sh.html) && /<h1>Flower of Life<\/h1>/.test(keep.flower.sh.html) && head.some(t => /^Step 20 of 20: /.test(t) && /Made \d+ \w+ \d{4}\./.test(t)) && head.some(t => /^Real size: the sheet is 48 in \(1219 mm\) wide by 48 in \(1219 mm\) high/.test(t)) && /id="so-rule-mm" d="M1 5H101"/.test(keep.flower.sh.html) && /id="so-rule-in" d="M1 13H102.6"/.test(keep.flower.sh.html) && new RegExp(`Page 2 of ${r.pages}`).test(keep.flower.sh.html), head.slice(0, 4)); }
  { const y = keep.yantra.sh.sheet, c = keep.continuum.sh.sheet; check('The Sri Yantra sheet prints its nine levels as a table and its sentences use them; the Continuum sheet prints the heights that lift its plane figure into the cubes', (y.tables.levels || []).length === 9 && y.paras.filter(p => /on level \d|at level \d/.test(p.text)).length >= 20 && (c.tables.heights || []).length === 16 && c.tables.heights.every(r => r[1] && /^-?[\d.]+$/.test(r[3])), { levels: (y.tables.levels || []).map(r => r.slice(0, 3).join(' | ')), heights: (c.tables.heights || []).length }); }
  { await figure(page, 'flower', { mode: 'perspective' }); await page.click('#stSetOut'); await page.waitForTimeout(150); const toast = await page.textContent('#toast'); check('In Geometry’s own perspective view, where a circle is neither a circle nor an ellipse about its centre, no sheet is made and the app says why', /2D or 3D view/.test(toast), toast); await page.click('#viewMode button[data-mode="axon"]'); }

  /* ===== making a sheet leaves every other output exactly as it was ===== */
  { const all = async () => { const out = {}; for (const m of ['print', 'plotter', 'stencil']) { await page.click(`#stModes button[data-v="${m}"]`); await page.waitForTimeout(320); out[m] = (await grab(page, '#stDownload')).buf; } out.png = (await grab(page, '#stPngPrint')).buf; out.screen = (await grab(page, '#stScreenSvg')).buf; await page.click('#stModes button[data-v="print"]'); await page.waitForTimeout(320); return out; };
    await figure(page, 'metatron', { studio: { dpi: 150, page: 'a3' } }); const before = await all(), shot = await page.locator('#geometry').screenshot(); await sheetOf(page, 'a4'); await sheetOf(page, 'letter'); const after = await all(), shot2 = await page.locator('#geometry').screenshot();
    check('Making a sheet changes nothing else: the print SVG, plotter SVG, stencil set, Print PNG and screen SVG downloaded before and after are the same to the byte, and the drawing on screen is the same to the pixel', Object.keys(before).every(k => before[k].equals(after[k])) && shot.equals(shot2), Object.keys(before).filter(k => !before[k].equals(after[k]))); }
  { const ui = await page.evaluate(() => { const secs = [...document.querySelectorAll('#studio .st-body > section')].map(s => s.querySelector('.label').textContent), b = document.querySelector('#stSetOut'), sec = b.closest('section'); return { secs, button: b.textContent, cls: b.className, papers: [...document.querySelectorAll('#stSoPaper option')].map(o => o.textContent), note: sec.querySelector('.st-note').textContent.length, modes: [...document.querySelectorAll('#stModes button')].map(x => x.textContent) }; });
    check('The Studio panel has one new group, Setting-out sheet, after tiling and before Images, built from the panel’s own parts (a labelled select, an action button, a note); every other group is where it was', JSON.stringify(ui.secs) === JSON.stringify(['Size', 'Layers · pen width · colour', 'Stencil', 'Tile onto smaller sheets', 'Setting-out sheet', 'Images']) && ui.button === 'Setting-out sheet' && ui.cls === 'action' && ui.papers.join() === 'Letter,A4' && ui.note > 100 && ui.modes.join() === 'Print,Plotter,Stencil', ui); }

  /* ===== a Perspective scene ===== */
  { const { page: pv } = await open('?app=perspective'); const scene = async (id, proj, patch = {}) => { await studio(pv, false); await pv.selectOption('#pvScene', id); await pv.click(`#pvProj button[data-v="${proj}"]`);
      await pv.evaluate(patch => { const P = window.__pv, st = window.__state; st.pv = { ...st.pv, ...patch, show: { ...st.pv.show, ...(patch.show || {}) } }; P.sel = null; P.fit(true); P.render(); P.sync(); const S = window.__studio; S.ST.mode = 'print'; S.ST.sheet = 'off'; Object.keys(S.ST.layers).forEach(k => S.ST.layers[k].on = true); }, patch); await pv.waitForTimeout(80); await studio(pv, true); };
    const rows = []; let ok = true;
    for (const [id, proj] of [['street', 'linear'], ['blank', 'linear'], ['room', 'linear'], ['blank', 'curvi']]) { await scene(id, proj, { sq: 6, show: { floor: false, horizon: true, vps: true, depth: false } }); const sh = await sheetOf(pv, 'letter'), svg = await printOf(pv), s = sh.sheet, H = svg.H, txt = s.text;
      const fig = svg.strokes.filter(q => q.layer === 'figure'), verts = fig.flatMap(q => [q.pts[0], q.pts[q.pts.length - 1]]), corners = (s.tables.corners || []).filter(r => r.length === 5);
      // every listed corner is the end of a printed edge
      let worstC = 0; corners.forEach(r => { const p = [+r[2], H - r[4]]; let best = Infinity; verts.forEach(v => { const e = Math.max(Math.abs(v[0] - p[0]), Math.abs(v[1] - p[1])); if (e < best) best = e; }); worstC = Math.max(worstC, best); });
      // every listed vanishing point that cubes use is where printed edges really run to: at least two edges that are not in line with each other, produced, pass through it
      const straight = fig.filter(q => q.pts.length === 2 && Math.hypot(q.pts[1][0] - q.pts[0][0], q.pts[1][1] - q.pts[0][1]) > 20), vps = (s.tables.vps || []); let worstV = 0, lone = 0;
      vps.forEach(r => { if (!r[6]) return; const p = [+r[2], H - r[4]], through = straight.filter(q => { const [a, b] = q.pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L, far = Math.max(Math.hypot(p[0] - a[0], p[1] - a[1]), L); return d <= .36 + .012 * far / L; });
        const dirs = through.map(q => Math.atan2(q.pts[1][1] - q.pts[0][1], q.pts[1][0] - q.pts[0][0])), spread = dirs.some(a => Math.abs(Math.sin(a - dirs[0])) > .02); if (through.length < 2 || !spread) lone++; });
      // the crosses Locus prints for vanishing points land on listed points; the horizon and the grid are where the sheet says
      // (a cross is two strokes, 0.8 in each way for a vanishing point and 0.5 in for the centre of vision; one near the edge of the canvas is trimmed, so each stroke is tested against the cross it belongs to)
      const marks = proj === 'curvi' ? [] : svg.strokes.filter(q => q.layer === 'marks' && q.pts.length === 2), mids = marks, cvm = txt.match(new RegExp(`Centre of vision: ${LEN} across and ${LEN} up`)), listed = vps.map(r => [+r[2], H - r[4], 20.32]).concat(cvm ? [[parseFloat(cvm[2]), H - parseFloat(cvm[4]), 12.7]] : []);
      marks.forEach(q => { const [a, b] = q.pts, flat = Math.abs(a[1] - b[1]) < 1e-6, u = flat ? 0 : 1, v = 1 - u; let best = Infinity; listed.forEach(p => { const off = Math.abs(a[v] - p[v]), out = Math.max(0, p[u] - p[2] - Math.min(a[u], b[u]), Math.max(a[u], b[u]) - p[u] - p[2]); best = Math.min(best, Math.max(off, out)); }); worstV = Math.max(worstV, best); });
      const hz = txt.match(new RegExp(`Horizon: level, ${LEN} up`)), level = svg.strokes.filter(q => q.layer === 'construction' && q.pts.length === 2 && Math.abs(q.pts[0][1] - q.pts[1][1]) < 1e-6).map(q => q.pts[0][1]), hzOk = proj === 'curvi' ? /Horizon: (an arc of a circle|level)/.test(txt) : !!hz && level.some(y => Math.abs(H - parseFloat(hz[2]) - y) <= .26);
      const canvas = txt.match(new RegExp(`Canvas: ${LEN} wide by ${LEN} high`)), grid = /Squaring grid: squares of 6 in \(152\.5 mm\)/.test(txt), plain = proj === 'curvi' ? /straight-line vanishing points do not apply/.test(txt) && !s.tables.vps : vps.length >= 2 && mids.length >= 2;
      const row = { scene: id, proj, corners: corners.length, cornerWorstMm: +worstC.toFixed(3), vps: vps.length, vpCrosses: mids.length, vpCrossWorstMm: +worstV.toFixed(3), vpsNoEdgesRunTo: lone, horizon: hzOk, grid, says: plain, labels: s.labels.length, pages: s.pages };
      rows.push(row); if (!(corners.length >= 6 && worstC <= NEAR && worstV <= NEAR && !lone && hzOk && grid && plain && canvas && Math.abs(parseFloat(canvas[2]) - svg.W) <= .25 && Math.abs(parseFloat(canvas[4]) - H) <= .25 && new Set(corners.map(r => r[0])).size === corners.length && corners.every(r => s.labels.some(l => l.split('=').includes(r[0]))))) ok = false; }
    check('Scene sheet (Street, One cube and Room in linear; One cube in curvilinear): the canvas is the print’s size; every listed corner is the end of a printed edge within 0.28 mm on each axis and is named on the numbered drawing; printed edges, produced, really run to each listed vanishing point; the printed vanishing-point crosses sit on listed points; the horizon and the 6 in grid are where the sheet says; and the curvilinear sheet says plainly that straight-line vanishing points do not apply', ok, rows); await pv.context().close(); }

  await page.context().close(); await viewer.context().close();
  /* ===== after the round 1 review: the Sri Yantra sheet reads in order and its key drawing is legible; the cube's circles have distinct names; a heavy scene's sheet does not freeze the page ===== */
  { const y = keep.yantra.sh, html = y.html, at = re => html.search(re), lv = at(/<table data-table="levels">/), st = at(/data-step="1"/), key = at(/<svg class="key"/), pts = at(/<table data-table="points">/);
    const stepsAbout = y.sheet.paras.filter(p => p.cls === 'in' && /\bon level \d|at level \d/.test(p.text)), lacking = stepsAbout.filter(p => { const lv = [...p.text.matchAll(/(?:on|at) level (\d+)/g)].map(m => m[1]); return !lv.every(n => new RegExp(`Level ${n} is ${LEN} up from the bottom edge of the sheet\\.`).test(p.text)); });
    check('Sri Yantra sheet: the levels table comes right after the key drawing and before the first step, and every step that says “level N” gives that level’s height in inches and millimetres in the same paragraph', key > 0 && lv > key && lv < st && st < pts && stepsAbout.length >= 20 && lacking.length === 0, { key, lv, st, pts, steps: stepsAbout.length, lacking: lacking.slice(0, 2).map(p => p.text.slice(0, 120)) }); }
  { const pg = await browser.newPage(); const STRIKE = () => { const out = { names: 0, struck: 0, patched: 0, where: [] };
      document.querySelectorAll('svg.key').forEach((svg, si) => { const root = svg.querySelector('g[clip-path]'), lines = [...root.querySelectorAll('path,circle,ellipse')].filter(e => !e.closest('.lb') && !e.closest('g[stroke="none"]') && (e.tagName !== 'path' || e.getAttribute('d'))), pts = [];
        lines.forEach(e => { const L = e.getTotalLength(), m = e.transform && e.transform.baseVal.numberOfItems ? e.transform.baseVal.consolidate().matrix : null; for (let d = 0; d <= L; d += .2) { const p = e.getPointAtLength(d); pts.push(m ? [m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f] : [p.x, p.y]); } });
        root.querySelectorAll('.lb text').forEach(t => { out.names++; const b = t.getBBox(), pad = .2, patched = t.previousElementSibling && t.previousElementSibling.tagName === 'rect', hit = pts.some(p => p[0] > b.x + pad && p[0] < b.x + b.width - pad && p[1] > b.y + pad && p[1] < b.y + b.height - pad);
          if (patched) out.patched++; else if (hit) { out.struck++; if (out.where.length < 5) out.where.push(`key ${si}: ${t.textContent}`); } }); });
      return out; };
    const res = {}; for (const id of ['yantra', 'flower', 'continuum']) { await pg.setContent(keep[id].sh.html); res[id] = await pg.evaluate(`(${STRIKE.toString()})()`); } await pg.close();
    check('Key drawings: no name is crossed by a line (names that could find no clear place sit on a small white patch instead, and crowded places are enlarged): Sri Yantra, Flower and Continuum', Object.values(res).every(r => r.names >= 10 && r.struck === 0) && res.yantra.patched < res.yantra.names / 2, res); }
  { const sentences = []; runs.forEach((r, ri) => (r.sh.sheet.paras || []).filter(p => p.cls === 'in').forEach(p => [...p.text.matchAll(/The (?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+th) )?circle about (\S+) is seen (edge-on|at an angle)/g)].forEach(m => sentences.push({ run: ri, step: p.step, ord: m[1], at: m[2], how: m[3] }))));
    const groups = {}; sentences.forEach(s => (groups[`${s.run}|${s.at}`] = groups[`${s.run}|${s.at}`] || []).push(s)); const dup = Object.entries(groups).filter(([, l]) => new Set(l.map(s => s.ord || '-')).size !== l.length);
    const cube = runs.filter(r => r.id === 'cube' && /edge-on/.test(r.sh.sheet.text)), line = cube.length && cube[0].sh.sheet.text.match(/The (second|third) circle about \S+ is seen edge-on in this view, so it is a straight line\. Rule a line from (\S+) to (\S+), /);
    check('Circles that share a centre have their own names in the sentences (first, second, third …), so “the circle about O” is never two different circles, and an edge-on circle is ruled between its two named end points', sentences.length > 5 && dup.length === 0 && !!line && line[2] !== line[3], { sentences: sentences.length, dup: dup.slice(0, 2), line: line && line.slice(0, 4) }); }
  { // a heavy scene's sheet: the page stays free while it is made, it is the sheet that a straight run would give, and it says it is working
    const { ctx, page: hp } = await open(); const cdp = await ctx.newCDPSession(hp); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await hp.click('#appMode button[data-app="perspective"]'); await hp.selectOption('#pvScene', 'sprawl'); await hp.waitForTimeout(400); await hp.click('#studioBtn');
    await hp.waitForFunction(() => { const t = document.querySelector('#studioStats').textContent; return t.length > 5 && !/Working/.test(t); }, null, { timeout: 300000 });
    await hp.evaluate(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask' }); });
    const [d] = await Promise.all([hp.waitForEvent('download', { timeout: 300000 }), hp.click('#stSetOut')]); await hp.waitForTimeout(100); const lt = await hp.evaluate(() => window.__lt), f = path.join(tmp, 'heavy-sheet.html'); await d.saveAs(f);
    const got = fs.readFileSync(f, 'utf8'), straight = await hp.evaluate(() => window.__sheet.html(window.__sheet.scene(), window.__sheet.PAPER.letter)), canon = t => t.replace(/id="c[a-z0-9]{1,6}"/g, 'id="C"').replace(/url\(#c[a-z0-9]{1,6}\)/g, 'url(#C)');
    check(`A heavy scene (Metatron of Metatrons, ${(got.length / 1e6).toFixed(0)} MB sheet): the sheet downloads without a single block over 450 ms at 4× slowed CPU (longest ${Math.max(0, ...lt)} ms in ${lt.length} blocks), and is the same text, to the byte, as the sheet built in one run`, Math.max(0, ...lt) <= 450 && canon(got) === canon(straight) && got.length > 1e6, { longest: Math.max(0, ...lt), blocks: lt.length, same: canon(got) === canon(straight), bytes: got.length }); await ctx.close(); }
  check('No script errors', errors.length === 0, errors);
  await browser.close();
  if (process.env.KEEP) console.log('files kept in', tmp); else fs.rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter(r => !r.ok);
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok && !process.env.DETAIL ? '' : '  ' + JSON.stringify(r.detail)}`));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
