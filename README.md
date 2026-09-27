# Locus

A locus is the set of points a rule allows. This tool draws geometry one construction step at a time, and the Studio panel sends the result off the screen at real size: print, pen plotter, or hand-cut stencil, from A3 up to a wall.

Started September 2026. One HTML file, no dependencies, no build step.

**Live:** https://claude.ai/artifact/Dd9YXEXD7ixMpePpwSpnHo  ·  **Local:** open `index.html` in any browser.

## What's in it

- **11 figures:** Seed, Flower, Metatron's Cube (2D and 3D), the five Platonic solids, Vesica, and a nine-triangle Yantra. Each one is a timeline you can scrub step by step.
- **Views:** plan, axonometric, and 1/2/3-point perspective. Undo and redo cover everything.
- **Studio outputs**, built from whatever figure, step and view is on screen:
  - *Print SVG*: true millimetres, one layer per group, real pen widths.
  - *Plotter SVG*: one path per stroke, one numbered layer per pen (works with AxiDraw layer mode). Overlapping lines are merged so nothing is drawn twice, and strokes are ordered to keep pen-up travel short.
  - *Stencil set*: one sheet per layer. Lines become slots, every stretch of slot between two crossings keeps at least one bridge so no piece falls out, and cut-through registration crosses let you line the sheets up.
  - *Tiling*: splits big pieces onto Letter, A4, Tabloid, A3 or 24×36 Mylar, with row and column labels and alignment crosses in the overlaps.
  - *PNG*: 4× screen, or print resolution at 150/300/600 dpi.

## Layout

```
index.html              the app
archive/v0-original.html    the file as first received (52,169 bytes)
archive/v1-pass0.html       after the Pass 0 geometry and export fixes
docs/evidence/          before/after renders for every Pass 0 fix
docs/samples/           a 48×48 in Flower of Life: print SVG, plotter SVG, stencil zip
tools/                  Playwright checks (see below)
```

## Checks

```
npm i -D playwright       # or set PLAYWRIGHT to an existing install
node tools/verify.js index.html   # geometry: 78 Metatron chords, Flower r = d, vesica √3, yantra 4▲ 5▼ …
node tools/sweep.js               # every figure × view × step × overlay, looking for script errors
node tools/studio-sweep.js        # print / plotter / stencil for every figure × view × primitive
```

## History

- **v0**: the original single-file drawing tool.
- **v1, Pass 0**: fixed the Flower (radius = spacing), all 78 Metatron chords plus Fruit circles, a Vesica lens made of two arcs with its √3 proportion, a Yantra with 4 up and 5 down, whirling φ squares, circumsphere radii, tilt in 2/3-point perspective, and a standalone SVG export. Also fixed the smaller bugs: phase labels, the aria-live status, undo inertia, the VP dot.
- **v2, Studio**: the physical outputs above.

## Next

- **Pass I:** a compass-and-straightedge construction kernel with one registry entry per figure, so a wrong figure can't be written in the first place.
- **Pass II:** one continuous timeline (point → vesica → seed → flower → fruit → Metatron → solids), symmetry-axis snaps, and depth-cued ink.
- **Open:** a true Sri Yantra (solved numerically), and whether the kernel should generate a 13-node Metatron navigation.
- **Known issues:** in perspective, the horizon and VP 1 act as a pan, VP 1 and the 3-point handles aren't true vanishing points, and the guide lines go to fixed screen points. Only 2-point is honest. In stencils, the slots at six-way junctions merge into thin wedges; they stay attached but are fragile.
