# Locus

A locus is the set of points a rule allows. Locus has two modes:

- **Geometry** draws sacred geometry one compass-and-straightedge step at a time.
- **Perspective** plans a painting before you paint it: stand in front of a canvas, put boxes in the room around you, and see exactly where every edge and vanishing point lands on the canvas, in inches, including scenes that wrap over your head.

Either way, the Studio panel sends the result off the screen at real size: print, pen plotter or hand-cut stencil, from A3 up to a wall.

Started September 2026. One HTML file, no dependencies, no build step.

**Live:** https://claude.ai/artifact/Dd9YXEXD7ixMpePpwSpnHo  ·  **App:** https://domnoval.github.io/Locus/ (once GitHub Pages is on, see below)  ·  **Local:** open `index.html` in any browser.

## Install on Android

Locus installs as an app: an icon on your home screen that opens full screen, straight into Perspective, and works with no connection at the easel.

1. On the phone or tablet, open **https://domnoval.github.io/Locus/** in Chrome.
2. Tap **Install** on the banner. If you dismissed the banner, use the **⤓ Install Locus** button in the Scene tab, or Chrome's ⋮ menu → **Install app**.
3. Open it from the home screen. Long-press the icon for its shortcuts:
   - **At the easel** opens straight into Reference view.
   - **Perspective** and **Geometry** open in those modes.

Once installed, Locus keeps the screen awake in Reference view, and snaps give a small vibration under your finger. It updates itself when you're online: the newest version loads when the network answers within 3 seconds, and otherwise the saved copy opens.

*Hosting:* the app is served by GitHub Pages from `main`, so every merge updates it. Pages is switched on once in the repository's **Settings → Pages**: *Deploy from a branch*, `main`, `/ (root)`.

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

Open the **Perspective** tab at the top of the sidebar. It's built around the real situation: you, standing in front of a canvas, imagining a room full of forms, and wanting a picture you can paint from.

- **Shots** run along the top of the canvas as live thumbnails of the angles a painter reaches for:
  - *Eye level* (1-point)
  - *Corner* (2-point, turned 35°)
  - *Worm's eye* (3-point, looking up)
  - *Bird's eye* (3-point, looking down)
  - *Dutch tilt*
  - *Long lens* (flat, calm)
  - *Fisheye* (4-point wrap)
  - *Straight up* (5-point, lying on your back)

  Click one and the camera glides there with the whole scene framed on your canvas. Level shots keep verticals vertical: they shift the lens rather than tilting it, put your eye just above the subject's top, and put the horizon on a third.
- **Hands on the view:**
  - Drag empty space to walk round what you're looking at (the selected box, or the scene). Scroll to come closer or step back. Shift-drag (or right-drag) to look around from where you stand.
  - Pinch, or Ctrl-scroll, zooms the view itself.
  - Drag the horizon line to slide it up or down the canvas.
  - In the plan (bottom right), drag **YOU** to walk.
- **Snap-tos** (hold Ctrl/⌘ to switch them off):
  - Views click to 1-point square-on, 2-point at 45° and the classic 30/60, level (verticals parallel), and straight up.
  - The horizon clicks to the centre, the thirds and the golden section.
  - A box's middle clicks to the thirds and golden points of the canvas.
  - Boxes click flush against their neighbours and stack.
  - The turn dial clicks in 15° steps (Shift for 1°).
  - Vanishing points click to the canvas edges and centre line.
  - A small label says what clicked.
- **Lens** is a dolly zoom: wide is dramatic and long is calm, and your subject keeps its size on the canvas while you change it. The readout gives degrees across the canvas and the distance from which the painting reads true. **Dutch tilt** rolls the picture.
- **The canvas** has a real size, from 16 × 20 in up to 4 × 8 ft, or custom, either way up. Thirds and golden-section (φ) lines are optional guides on it.
- **Boxes:**
  - Double-click the floor or press **+ Box**. With a box selected, the new one lands flush beside it at the same size and turn; otherwise it finds clear floor in front of you.
  - Drag a box along the floor (Shift lifts it, Alt-drags a copy), and drop it onto another to stack it.
  - The selected box grows a handle out of each face you can see: pull one to stretch the box with the opposite face held still.
  - **Repeat** makes rows, grids, towers, a ring around a point, or an arch over it. Rings and arches stay put when you walk away from where you made them. A tower can **Twist**: each cube turns that much more than the one below.
- **Linear** projection keeps edges straight, and every family of parallel edges meets at one vanishing point. That's 1-, 2- or 3-point depending only on how you're turned and tilted. Drag a vanishing point to turn your head so it follows your hand. Past 90° linear stretches, and it can't show anything beside or behind you.
- **Curvilinear** projection is stereographic. A straight edge and your eye span a plane, which meets the sphere of directions around your eye in a great circle, and stereographic projection maps every circle to a circle. So each edge is an exact circular arc. Click an edge of the selected box to get its pin position and string length on your canvas.
- **Reference view** (the button in the heading) shows just the picture, as big as the screen allows, with no instruments. It goes full screen and keeps the screen awake where the browser allows. Esc brings the tools back.
- **Drawing:** the screen draws boxes far to near, lit faces then edges (a painter's algorithm), which keeps dragging smooth. The exact ray-cast hidden lines are used for Studio output and the Hidden edges guide.
- **On your canvas** lists the horizon, every box's vanishing points and the centre of vision, measured from the canvas's bottom-left corner. Rows marked *off canvas* go on the wall beside it. When more than two differently turned families of boxes share a scene, the picture shows only the world's vanishing points and the selected box's. Otherwise a crowd of labels buries the drawing.
- **Studio and Export** use your canvas as the page at full size. Box edges go on the Figure layer; hidden edges, the horizon and the squaring grid on Construction; and vanishing-point marks on Centre marks.
- **Squaring grid** (Guides, or *Grid* in Reference view) lays squares in real inches on the canvas: 6, 3, 12 or 2 in. Columns are lettered A, B, C… and rows numbered from the top, so you can carry the drawing across square by square. It prints with the drawing.
- **Scenes** include *Totem · 36 × 48*, built after a canvas on the easel: a column of cubes twisting up the middle, blocks turned in from both sides, two arches overhead, and a ring at your feet that bends into a bowl. It's all curvilinear.
- Keys:
  - **Delete** removes the selected box, **D** duplicates it and **R** turns it. The arrow keys nudge it (Shift for 1 in), and PageUp and PageDown lift it.
  - **A** aims at the selection, keeping you level if you were. **F** fits the view, and **Esc** deselects or leaves Reference view.
  - Ctrl/⌘-Z undoes, and a whole glide is one undo.

### Lock view, and the little guy

Once the boxes are where you want them and the view is right, **lock it**: the padlock at the top right of the drawing.

- **While locked, nothing can change the perspective.** Scroll, pinch and drag only magnify and move the picture, like zooming into a photo of it. **F** fits it back.
- **What's refused:** the Shots strip, Aim, Reference view's shot swipe, the Canvas and Camera controls, and dragging the horizon or vanishing points. Each shows a short note instead.
- **Boxes stay editable,** and undo still works.

**The little guy** is a box mannequin, the old perspective-drawing scale figure, standing in your scene at your walking size.

- **Tap him** and you walk as him, in first person (below).
- **Come back** (✕, Esc or Android's back) and your composition is exactly as you left it, locked or not, with him standing wherever you stopped.
- **Drag him** to place him; he stands on top of a box if you drop him there.
- **The *Little guy* chip** in Guides hides him, or puts one in front of you if you haven't walked yet.
- **He's a guide, not part of the picture:** Export and the Studio leave him out.

### Walk (first person, at any size)

**Walk** (in the heading) puts you inside the scene. The camera becomes your eyes, so every frame is a true perspective you could paint, with real vanishing points.

- **Choose your size.** *Size* offers Ant ¼″, Mouse 2″, Cat 10″, Child 3′, You 5′8″ and Giant 20′, with a slider for anything in between. Walk speed, jump height, step height and gravity all scale with you, so any size feels like your own body, and the boxes become furniture or skyscrapers. The readout says how tall you are, how high your eye is, what you're standing on, and how the boxes compare to you.
- **Gravity and solid boxes.**
  - You stop at a box's face and slide along walls.
  - You walk straight up anything under a third of your height.
  - You jump about 0.8 of your height, onto boxes, turned ones and tilted tops included, and your head stops at the underside of anything above.
  - Ring cubes make steps and arches make bridges.
- **On a phone or tablet:** the left thumb is a stick that appears wherever you put it, and pushed all the way it runs. Drag anywhere on the right to look, and **Jump** sits bottom-right. Android's back gesture takes you out.
- **With a keyboard:** **WASD** or the arrows to move (←/→ turn), drag to look, **Space** to jump, **Shift** to run, **+**/**−** to grow or shrink, the wheel to resize, **Esc** to go back, **Enter** to keep the view.
- **Frame** shows your canvas as a viewfinder, and **Curvi/Linear** swaps the projection as you walk. At ant size the near plane shrinks with you, so nothing close gets cut away.
- **Use this view** leaves with the camera where you're standing, your found composition, ready for Reference view or Studio; one undo puts it back. It's hidden while the view is locked. **✕**, Esc or back returns to the plan exactly as it was, and the little guy stays where you stopped. Locus remembers your size for next time.



Built and tested for Chrome on Android: emulated Galaxy S24, Pixel 8 and Galaxy Tab S9, upright and on its side, driven with real touch events. Other touch screens get the same layout.

- **Phone, or a tablet held upright:**
  - The canvas gets the screen, and the controls live in a **sheet** that peeks from the bottom with six tabs: Scene, Canvas, Camera, Box, Guides and Measure.
  - Tap a tab to open the sheet half way on just that tab. Drag the grip up for the whole sheet, and drag it down to tuck it away.
  - Tap a size field and the sheet lifts it clear of the keyboard.
- **A tablet on its side:** the controls become a **side panel** on the right, and the drawing gets the full height. On a Galaxy Tab S9 that's 446 px of drawing, up from 315.
- **Android's back gesture** closes the sheet, or leaves Reference view, before it ever leaves the page.
- **Tap a box** and a bar floats under it with finger-sized buttons: Copy, Stack (a copy on top), 90°, Edit (opens the Box tab) and Delete.
- **Double-tap the floor** to put a cube there. **One finger** walks round the subject, and **two fingers** pinch-zoom the view.
- **A small vibration** when something snaps into place, or a swipe changes shot. Android vibrates; elsewhere it's silent. Controls respond when your finger lifts, so the first tap after a quick flick isn't lost (Chrome would otherwise drop that tap).
- **Reference view** is for working from at the easel:
  - **‹ ›** and a **swipe** step through the Shots, with the view locked so a brushed screen doesn't knock it.
  - **Grid** cycles the squaring grid. **Lines** turns the floor and horizon on or off, **Values** the light and shade, and **◐** swaps paper and night.
  - **Locked / Unlocked** lets one finger turn the view again, and **✕** leaves.
  - The bar fades after a few seconds; tap the picture to bring it back.
  - Upright, the bar sits below the drawing, and on a phone it folds into two rows. On its side, the bar becomes a rail in the margin beside the drawing. Either way it never covers the drawing.
- Reference view goes full screen and keeps the screen awake, where the browser allows. Chrome on Android allows both, but a page embedded in another site may not get them.

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
manifest.webmanifest    what Android needs to install it: name, icons, full screen, shortcuts, screenshots
sw.js                   offline: the page network-first (3 s, then the saved copy), icons and fonts cache-first
app/                    the icon (vesica, horizon and vanishing point; SVG, PNG and maskable) and the install screenshots
archive/v0-original.html    the file as first received (52,169 bytes)
archive/v1-pass0.html       after the Pass 0 geometry and export fixes
docs/evidence/          before/after renders for every Pass 0 fix; pass1/ kernel; pass2/ continuum and axes; perspective-planner/ and easel/ for the planner
docs/samples/           a 48×48 in Flower of Life: print SVG, plotter SVG, stencil zip
tools/                  Playwright checks (see below)
```

## Checks

```
npm i -D playwright       # or set PLAYWRIGHT to an existing install
node tools/verify.js              # 225 pass/fail checks: kernel provenance, 78 chords, Flower r = d, √3, the Sri Yantra, planner VPs and arcs, hidden lines, drag, export, and the planner on an emulated Galaxy S24 and Galaxy Tab S9 (upright and on its side) driven by real touch events …
node tools/sweep.js               # every figure × view × step × overlay, looking for script errors
node tools/studio-sweep.js        # print / plotter / stencil for every figure × view × primitive
node tools/pwa-check.js           # serves the repo over http, asks Chrome whether Locus is installable, launches it offline, and tries the shortcuts and the install offer
```

## History

- **v0**: the original single-file drawing tool.
- **v1, Pass 0**: fixed the Flower (radius = spacing), all 78 Metatron chords plus Fruit circles, a Vesica lens made of two arcs with its √3 proportion, a Yantra with 4 up and 5 down, whirling φ squares, circumsphere radii, tilt in 2/3-point perspective, and a standalone SVG export. Also fixed the smaller bugs: phase labels, the aria-live status, undo inertia, the VP dot.
- **v2, Studio**: the physical outputs above.
- **v8, Perspective planner**: the Perspective mode above (scene, canvas, you, boxes and repeats, linear and curvilinear, hidden lines, plan, readouts, real-size Studio output) and the Geometry-mode 3-point horizon fix. 18 new checks: vanishing points meet to 1e-9, arcs are circles to 1e-9, both projections agree at the centre, hidden lines, arches, rings, horizon, dragging, stacking, VP dragging, pin and string, export size, undo across modes. Then the hands-on round: face handles, the turn dial, flush snapping, aim, one draw per frame, double-click to add. 101 checks.
- **v9, Painter's round**: Shots with live thumbnails and auto-framing, walking round the subject by default, scroll to come closer, a dolly-zoom Lens, Dutch tilt and gliding transitions. Snap-tos for views, the horizon, composition points, boxes, the dial and vanishing points. Reference view; painter's-algorithm screen drawing (about 5 to 10 ms a frame, where it was up to 35). The usability audit's fixes: no fly-away drags, + Box beside the selection, every box's vanishing points, clear names, finger-sized handles, a clean cropped Export, plan dragging, unique VP names. 128 checks.
- **v10, At the easel**: the planner for an Android phone or tablet propped beside the canvas.
  - The sheet with tabs on phones and upright tablets; a side panel on a tablet on its side (Galaxy Tab S9: 446 px of drawing, up from 315); a phone header that gives the canvas back its height.
  - The floating box bar and double-tap to add.
  - An easel-ready Reference view: swipe between shots, a view lock, an auto-hiding bar with large buttons that never covers the drawing, and the squaring grid, which prints on Construction.
  - Android's back gesture, haptic ticks, and size fields kept clear of the keyboard.
  - Tower Twist, the Totem scene, and a vanishing-point budget for crowded scenes.
  - 62 new checks run on emulated Android devices with CDP touch events. They caught:
    - taps on the floating bars being swallowed by the canvas's pointer capture;
    - the first tap after a flick being dropped (Chrome's fling tap-suppression);
    - a phone reference bar that ran off the screen;
    - a sheet clipped by its own tab strip;
    - a squaring grid that never reached the paper.
  - 190 checks.
- **v12, Walk, the lock and the little guy**: first person at any size, from ¼ inch to 20 feet.
  - **Lock view**, so zooming never changes the perspective.
  - **The little guy:** a box mannequin who stays in the scene where you left him. Tap him to walk as him, drag him to place him. He never goes into Export or the Studio.
  - Physics: gravity, solid boxes you slide along, step-up, a jump onto boxes (turned and tilted ones too), and ceilings, all scaled to your size.
  - A thumb stick, look-drag and a Jump button on Android; WASD, mouse and Space on a keyboard.
  - A viewfinder for your canvas, and *Use this view* to keep what you find.
  - 20 new checks:
    - stopping exactly at a box's face, jumping on and staying, walking off an edge;
    - a 4″ you who can't reach a 24″ box, step-up, sliding along a turned box without entering it, ceilings;
    - speed scaling 17× from 4″ to 68″, an ant who still sees the world;
    - the keys and the two ways out with undo;
    - on a Galaxy S24: the stick, look, Jump, Size and back.
  - 15 more checks cover the lock (wheel, drag, Shots, Aim, the controls, boxes still editable, pinch on a phone) and the little guy (left in place, kept out of Export and the Studio, drag, tap to walk, the chip).
  - The phone checks caught a class-name clash that had switched off every touch in walk mode, and the lock button losing its tap to the canvas.
  - 225 checks.
- **v11, The app**: Locus installs on Android as a full-screen app that works offline.
  - A manifest with the new icon, shortcuts (At the easel, Perspective, Geometry), and install screenshots.
  - A service worker; a one-time install banner and a lasting Install button; the address bar colour follows the theme.
  - `tools/pwa-check.js`, 15 checks, including Chrome's own installability verdict and an offline launch.
- **v7, Sri Yantra**: the solved nine triangles with 24 exact triple points, the bindu, the lotus rings, girdles and bhupura, and four checks for it in place of the old placement check. 74 checks.
- **v6, True perspective**: the camera model above, the perspective box, the off-page VP 3 knob, near-plane clipping, and four new checks for convergence, horizon and grid. 71 checks.
- **v5, Look**: Night instrument and Geometer's notebook themes with a toggle, the hairline interface, an accent on the newest construction, compass pinholes, and the two Codex review fixes from PR #2. 66 checks.
- **v4, Pass II**: Continuum with chapters and the lift animation, symmetry axes found from the geometry with snapping and the Metatron ghost, depth ink, and Auto rotate available in every view. 62 checks.
- **v3, Pass I**: the construction kernel and figure registry, lineage on hover, the Workings view, a 3D Metatron that collapses onto the 2D figure in plan, styling moved to CSS generated from one table (shared with the exported SVG), dimensions that measure the construction, and `tools/verify.js` as a 44-check pass/fail suite.

## Next

- **Parked:** generating a 13-node Metatron navigation from the kernel.
- **Known issues:** in stencils, the slots at six-way junctions merge into thin wedges; they stay attached but are fragile.
