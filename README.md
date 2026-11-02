# Locus

A locus is the set of points a rule allows. Locus has two modes:

- **Geometry** draws sacred geometry one compass-and-straightedge step at a time.
- **Perspective** plans a painting before you paint it: stand in front of a canvas, put boxes in the room around you, and see exactly where every edge and vanishing point lands on the canvas, in inches, including scenes that wrap over your head.

Either way, the Studio panel sends the result off the screen at real size: print, pen plotter or hand-cut stencil, from A3 up to a wall.

Started September 2026. One HTML file, no dependencies, no build step.

**Live:** https://claude.ai/artifact/Dd9YXEXD7ixMpePpwSpnHo  ·  **Local:** open `index.html` in any browser.

## What's in it

- **Perspective planner:** boxes of any size, repeated in rows, grids, towers, rings around you and arches over you. Linear perspective (1, 2 or 3 point, exact vanishing points) or curvilinear (every edge an exact circle you can swing with a pin and string). Measurements to mark on your canvas, and Studio output at the canvas's real size.
- **11 figures:** Seed, Flower, Metatron's Cube (2D and 3D), the five Platonic solids, Vesica, and the Sri Yantra. Each one is a timeline you can scrub step by step.
- **Views:** plan, axonometric, and 1/2/3-point perspective. Undo and redo cover everything.
- **Studio outputs**, built from whatever figure, step and view is on screen:
  - *Print SVG*: true millimetres, one layer per group, real pen widths.
  - *Plotter SVG*: one path per stroke, one numbered layer per pen (works with AxiDraw layer mode). Overlapping lines are merged so nothing is drawn twice, and strokes are ordered to keep pen-up travel short.
  - *Stencil set*: one sheet per layer. Lines become slots, every stretch of slot between two crossings keeps at least one bridge so no piece falls out, and cut-through registration crosses let you line the sheets up.
  - *Tiling*: splits big pieces onto Letter, A4, Tabloid, A3 or 24×36 Mylar, with row and column labels and alignment crosses in the overlaps.
  - *PNG*: 4× screen, or print resolution at 150/300/600 dpi.

## How a figure is made

Figures are scripts, not coordinate lists. The kernel has three moves: `circle(centre, through)`, `line(a, b)` and `meet(x, y)`. After a figure's two givens, every point is where two curves meet, so a figure can't come out at the wrong ratio: "compass on the newest crossing, same radius" can only ever produce the Flower. Each figure is one entry in `REGISTRY` (title, note, family, steps), and each step label is written next to the operation that draws it, so labels and drawings can't drift apart.

Every point remembers its parents. **Hover any node** to light its whole ancestry back to the givens, hidden helper lines included, with a line like `D3 = circle at P3 through O ∩ line OP3 · 3 generations · 4 ancestor points`. The **Workings** chip shows those hidden lines permanently: midpoints, rays, helper circles.

The solids are 3D, so they start from canonical coordinates (noted on every vertex) and derive the rest: nearest-neighbour edges grown outward from one vertex, and a circumsphere through the vertices. **Metatron's Cube · 3D** is two cubes stood on a corner, with a star tetrahedron (the outer cube's face diagonals) and an octahedron (its face centres). Seen in plan, straight down that corner, its 13 positions are exactly Metatron's Cube. The Sri Yantra is solved numerically; its section below explains why.

## Continuum, axes and depth

**Continuum** (the opening figure) is the whole family as one construction: a point, a distance, the vesica, the Seed growing out of the vesica's own crossing, the Flower, the Fruit (a true midpoint halves the radius), and Metatron's Cube. Then each of its 13 nodes rises out of the page to the cube corner it is the shadow of, and the star tetrahedron and octahedron are drawn inside that cube. Chapter marks under the timeline jump between stages, and the lift plays as an animation when you step into it.

**Symmetry axes** are not typed in. They are found from each solid's own vertices by testing which turns map it onto itself, which recovers each rotation group exactly (tetrahedron 3·2-fold + 4·3-fold, cube 6 + 4 + 3, icosahedron 15 + 10 + 6). A readout shows the nearest axis and how far off it you are. Release within 5°, press **Look down it**, or press `S` to snap. Near a 3-fold axis of a cube-family solid, Metatron's Cube fades in behind it; on the axis the solid sits exactly on top of it.

**Depth ink** makes nearer lines heavier and darker and farther lines lighter, so wireframes stop flipping (the Necker-cube effect). Exports bake the depth into each stroke.

## Look

Two worlds, both designed on purpose. **Night instrument** is the default: blue-black ground, bone-white hairlines, slate construction circles, one cinnabar accent on whatever the current step just built, and gold for lineage traces. **Geometer's notebook** is the light mode: warm paper with a faint grain, graphite lines, blue-pencil construction circles and red-pencil accents. Every centre is a compass pinhole. The theme button cycles System → Night → Paper and remembers your choice. Type is Instrument Serif for the figure's name, IBM Plex Sans for the interface, and IBM Plex Mono for labels and readouts. Panels are hairline rules rather than cards.

## Perspective planner

The **Perspective** tab at the top of the sidebar. It's built around the real situation: you, standing in front of a canvas, imagining a room full of forms.

- **The canvas** is a real size (16 × 20 in up to 4 × 8 ft, or custom), and **Stand back** is how far your eye is from it. That distance is the focal length, so it's also the distance from which the finished painting reads true. The readout says how many degrees across the canvas takes in.
- **You** have an eye height, and you can look up or down and turn. You can also drag the empty drawing to look around, or drag **YOU** in the plan (bottom right) to walk.
- **Boxes**: double-click the floor or press **+ Box**. Drag a box to slide it along the floor, Shift-drag to lift it, Alt-drag to copy it, and drop it on another box to stack it. Each box has a width, height and depth in inches, a turn and a tip. **Repeat** makes rows (across or running away), grids, towers, a ring around you, or an arch from the box up over your head and down behind.
- **Linear** projection keeps edges straight, and every family of parallel edges meets at one vanishing point. That gives 1-, 2- or 3-point perspective depending only on how you're turned and tilted, with nothing to set. Drag a vanishing point and you turn your head so it follows your hand. The 60° circle is where linear is honest; past 90° it stretches, and it can't show anything beside or behind you. Switch the *Cubes overhead* scene to Linear to watch it tear.
- **Curvilinear** projection is stereographic. A straight edge and your eye span a plane, which meets the sphere of directions around your eye in a great circle, and stereographic projection maps every circle to a circle. So each edge is an exact circular arc. Click an edge of the selected box and Locus gives its pin position and string length on your canvas. The whole room fits: overhead (zenith), underfoot (nadir), ahead and behind, up to six vanishing points.
- **Hidden edges** are found by casting a ray from your eye to each point of each edge. That's exact, it's the same in both projections, and it covers boxes hiding each other.
- **On your canvas** lists the horizon, every vanishing point and the centre of vision, measured from the canvas's bottom-left corner. Rows marked *off canvas* go on the wall beside it.
- **Studio** in this mode uses your canvas as the page at full size: box edges on the Figure layer, hidden edges and the horizon on Construction, vanishing-point marks on Centre marks, and the floor grid and lines to vanishing points on Drafting. Tile it onto letter paper or cut it as a stencil.
- Keys: **Delete** removes the selected box, **D** duplicates it, **R** turns it, the arrow keys nudge it (Shift for 1 in), PageUp and PageDown lift it, **F** fits the view, **Esc** deselects, and Ctrl/⌘-Z undoes.

## Perspective (Geometry mode)

Perspective is a real camera now: a pinhole with a focal length, an eye height and a direction it's looking. The handles are the camera's controls. Wherever you put them, every family of parallel edges converges exactly on its handle (the checks measure this to within half a pixel).

- **Horizon** is your eye level. Moving it raises or lowers the eye, and the figure stays where it is: you see more of its top or its underside.
- **1-point**: you look straight down one axis, so VP 1 is the centre of vision.
- **2-point**: the two handles set the focal length (the distance between them) and which way you're turned (where the centre sits between them).
- **3-point**: the three handles form a triangle whose orthocentre is where you're looking. VP 3 is usually far off the page, so its knob stays at the edge with an arrow and a readout of the real distance. Dragging it further out uses an accelerating scale. Handles can't be put anywhere that no real camera could produce. Moving the horizon re-aims your eyes and VP 3 swings with it, flipping overhead when you look up. Before, the camera collapsed to a fisheye.
- A perspective box drawn around the figure shows the convergence, and the guide rays run from its edges to the handles.
- Lines that come too close to the eye are clipped, as on any real camera, and the floor grid keeps only the stretch well in front of you.

## Sri Yantra

The one figure a compass can't build. Its nine triangles (four up, five down) only lock together if 24 points, 12 a side, each have three lines passing exactly through them. Nine base levels and seven half-widths make 16 unknowns; 12 conditions leaves the 4 free choices Huet identified. Locus starts from the proportions of the classic drawing and takes the nearest exact solution (a min-norm Gauss–Newton solve, a few milliseconds when the page loads). Each triple point is pinned where two of its lines cross, and the check confirms that the third line passes within 1e-9 and that the point lies on the segments themselves, not on their extensions. After the bindu come the enclosures: eight and sixteen petals drawn as compass arcs, three girdles, and the bhupura with its four gates.

Incidence structure (which three lines meet at each point) follows the open-source construction in [alchemy-run/alchemy](https://github.com/alchemy-run/alchemy/pull/2006). For background, see Huet, *Theoretical Computer Science* 281 (2002), and Chiodo, *Comptes Rendus Mathématique* (2021).

## Layout

```
index.html              the app
archive/v0-original.html    the file as first received (52,169 bytes)
archive/v1-pass0.html       after the Pass 0 geometry and export fixes
docs/evidence/          before/after renders for every Pass 0 fix; pass1/ kernel; pass2/ continuum and axes
docs/samples/           a 48×48 in Flower of Life: print SVG, plotter SVG, stencil zip
tools/                  Playwright checks (see below)
```

## Checks

```
npm i -D playwright       # or set PLAYWRIGHT to an existing install
node tools/verify.js              # 92 pass/fail checks: kernel provenance, 78 chords, Flower r = d, √3, the Sri Yantra, planner VPs and arcs, hidden lines, drag, export …
node tools/sweep.js               # every figure × view × step × overlay, looking for script errors
node tools/studio-sweep.js        # print / plotter / stencil for every figure × view × primitive
```

## History

- **v0**: the original single-file drawing tool.
- **v1, Pass 0**: fixed the Flower (radius = spacing), all 78 Metatron chords plus Fruit circles, a Vesica lens made of two arcs with its √3 proportion, a Yantra with 4 up and 5 down, whirling φ squares, circumsphere radii, tilt in 2/3-point perspective, and a standalone SVG export. Also fixed the smaller bugs: phase labels, the aria-live status, undo inertia, the VP dot.
- **v2, Studio**: the physical outputs above.
- **v8, Perspective planner**: the Perspective mode above (scene, canvas, you, boxes and repeats, linear and curvilinear, hidden lines, plan, readouts, real-size Studio output) and the Geometry-mode 3-point horizon fix. 18 new checks: vanishing points meet to 1e-9, arcs are circles to 1e-9, both projections agree at the centre, hidden lines, arches, rings, horizon, dragging, stacking, VP dragging, pin and string, export size, undo across modes. 92 checks.
- **v7, Sri Yantra**: the solved nine triangles with 24 exact triple points, the bindu, the lotus rings, girdles and bhupura, and four checks for it in place of the old placement check. 74 checks.
- **v6, True perspective**: the camera model above, the perspective box, the off-page VP 3 knob, near-plane clipping, and four new checks for convergence, horizon and grid. 71 checks.
- **v5, Look**: Night instrument and Geometer's notebook themes with a toggle, the hairline interface, an accent on the newest construction, compass pinholes, and the two Codex review fixes from PR #2. 66 checks.
- **v4, Pass II**: Continuum with chapters and the lift animation, symmetry axes found from the geometry with snapping and the Metatron ghost, depth ink, and Auto rotate available in every view. 62 checks.
- **v3, Pass I**: the construction kernel and figure registry, lineage on hover, the Workings view, a 3D Metatron that collapses onto the 2D figure in plan, styling moved to CSS generated from one table (shared with the exported SVG), dimensions that measure the construction, and `tools/verify.js` as a 44-check pass/fail suite.

## Next

- **Parked:** generating a 13-node Metatron navigation from the kernel.
- **Known issues:** in stencils, the slots at six-way junctions merge into thin wedges; they stay attached but are fragile.
