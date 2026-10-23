# Gorshey diorama — build spec

## Round-3 contract (integration, read first)

Values as shipped by integration this round. Where they differ from the lead's work order, the
shipped value wins and the reason is given.

| What | Value | Note |
| --- | --- | --- |
| `R.view.fitW` | **15.2** m | 1080² → patch 86.4 % wide, centred within 1.2 %; 390×844 → 86.4 %; dancers ≈ 33 art px |
| `R.view.shiftY` | **0.035** | 0.05 pushed 1600×1000 4 % below today; with 0.035 (and fitW 15.2) 1600×1000 moves +2.5 % (top 13.8 %, bottom 13.8 %, size unchanged) and 1080² keeps 20.6 % white above the finial, bottom fringe at 80.8 % (caption starts at 84.4 %) |
| `R.view.height` | 12.6 m | unchanged (landscape framing unchanged in size) |
| portrait shift | `shiftY · min(hFit, fitW)` | in portrait the frame is ~33 m tall, so a plain fraction of hView would drop the patch 1 m; capped so it stays a content-relative nudge |
| night sun | **0xa8b0c4 → 0xa2aed0, sunI 0.45 → 0.72** | with 0.45 the lit tent roof sampled #40474d (band 3 only); 0.72 + a touch bluer gives #4d5662 ≈ target #4E5566. Fire still dominates. hemiSky 0x3a4256, hemiGround 0x15181e, ambient 0x2a2f3c, hemi 0.55, ambientI 0.2 as ordered |
| post | uDither 0.7, uBandDither 0.42, uCool = mix(0.55, 0.30, night) | as ordered |
| `PATCH.edge` | 0.14 | as ordered |
| LAYOUT / CLEAR / FOOTPRINTS | exactly as ordered | see *Placement* below |
| new core exports | `FOOTPRINTS`, `footprintK`, `inFootprint`, `glslColor`, `WIND_DIR`, `mixHex`, `shadeHex`, `U.uArtPx` | GLSL.common adds `uniform float uArtPx;` and `#define G_WIND_DIR` |
| new ctx fields | `ctx.params`, `ctx.zoom`, `ctx.debug`, `ctx.expose(name, value)` | |
| public handle | `window.gorshey = { ready, renderAt, setMode, LOOP, info, debug? }` | `__ready`, `__renderAt`, `__info`, `__LOOP`, `__setMode` aliases kept; `?debug=1` also exposes `gorshey.debug.R` and `gorshey.debug.ctx` |
| motion-probe baseline | today's dancers.js (via `window.__dancers`) fails hips (13–22 cm one-frame drops, e.g. t≈1.13→1.17), planted-toe drift (7–14 cm/frame), toe sink (−2.4 cm: the heel-up pivot is not at the sole's toe edge) and neighbour contact (hands/sleeves 0.01–0.4 cm apart); sleeves never enter the torso (e ≥ 1.27) | `shots/polish/integration/probe-full.json` |

Interim renders show life's hard-coded yak over the new rug; life moves it to `LAYOUT.yak`.

## The piece

An animated, isometric pixel-art diorama in the style of shawn (@zzzzshawn)'s "Small plays" series:
a small patch of Tibetan grassland floating on a plain background, dissolving into it with an ordered
dither at the rim. Twelve dancers in traditional dress sing and step the gorshey (སྒོར་གཞས།) ring around a
campfire; on the ring's left flank a neighbour plays the dranyen on a khaden rug beside a grandmother
with her prayer wheel and a little girl, with a tea table behind them; a white lingka tent and prayer
flags stand behind the ring, a yak grazes in the front right, a mastiff dozes by the tent. The scene is an
imagined composite of a summer lingka picnic and a fireside gorshey. Day mode (light page) is a golden
late afternoon; night mode (dark page) is lit mostly by the fire.

Reference frames of the target look: `/Users/tenzindelek/Developer/creative-vibe/ref/*.png`
(read them with the Read tool before you start). Notice: tiny figures (~20–35 art pixels tall),
lots of micro-detail suggested by single pixels, naturalistic slightly muted colour, soft cast
shadows, no thick black outlines, white space all around.

## Files and owners

```
index.html      page + import map (three r170 from jsDelivr)          integration
js/main.js      boot, loop, modules, drag-to-turn, theme sync          integration
js/render.js    pixel pipeline, camera framing, lights                 integration
js/core.js      shared helpers, LAYOUT, FOOTPRINTS, PAL, CLEAR, GLSL   integration (ask in your report)
js/base.js      flat test-bed patch (?only=base,<module>)              integration
js/ground.js    meadow base, grass, flowers, trampled ring             ground
js/fire.js      fire pit, flames, sparks, smoke, fire light            fire
js/dancers.js   twelve dancers + choreography                          dancers
js/camp.js      lingka tent, prayer flags + pole, mani stones, sangbum, woodpile   camp
js/life.js      musician w/ dranyen, elder w/ prayer wheel, girl, rug, tea table + thermos, yak, dog   life
tools/*.mjs             shot.mjs, capture.mjs, motion-probe.mjs, imgdiff.mjs   integration
```

Only edit your own module file. You may create extra files named `<module>-*.js` next to it if it gets long.

## Module contract

```js
import * as THREE from 'three';
import { mat, box, boxB, cyl, cylB, cone, sphere, ico, put, pivot, PAL, LAYOUT, cyc, LOOP, BEAT, wind, rng } from './core.js';

export function build(ctx) {          // may be async
  const group = new THREE.Group();
  // ... build geometry once here ...
  return {
    group,                             // added to the scene by main.js
    update(t, ctx, dt) { ... },        // t in [0, LOOP) seconds. ctx.mode is 'day' | 'night'. dt = 0 during capture.
  };
}
```

`ctx` = `{ THREE, core, scene, renderer, camera, sun, R, mode, shared, params, zoom, debug, expose }`.

- `ctx.params` — the page's `URLSearchParams`, parsed once by main.js. `ctx.zoom` — the `?zoom=` number
  (default 1). `ctx.debug` — true with `?debug=1`.
- `ctx.expose(name, value)` — publishes `window.gorshey.debug[name]` for tools, only when `ctx.debug` is on
  (e.g. dancers: `ctx.expose('dancers', dancers)`; tools/motion-probe.mjs reads it).
- **Modules must not parse `location.search` or write `window` globals.** Use `ctx.params`, `ctx.zoom`,
  `ctx.debug`, `ctx.expose`.
- `ctx.shared` contract is exactly two keys: `fireFlicker` (set by fire: the current fire-light flicker
  factor, for anything lit by the fire) and `groundPressesGrass` (set `true` by ground when it applies
  `FOOTPRINTS` to its own blades; then nobody else touches grass instances). Anything else on `ctx.shared`
  is unsupported and will be removed: read placements from `LAYOUT` / `FOOTPRINTS` instead.

Modules load in parallel and are built strictly in this order: ground, fire, dancers, camp, life.

## Placement (core.js)

- `LAYOUT` — positions `[x, z]` in metres (fire at the origin, camera looks from +x,+z), `ry` about +y.
  Object-local `(u, v)` maps to world `x = pos.x + u·cos ry + v·sin ry`, `z = pos.z − u·sin ry + v·cos ry`.
  - `rug: { pos: [-3.2, 3.1], ry: -0.785, w: 1.92, d: 1.2 }` — on the ring's left flank. Rug-local u (the
    length w) runs along world (0.707, 0.707), toward the camera; +v points away from the fire; the inner
    edge is at r ≈ 3.86 (dancers reach 3.62 m).
  - `musician: { pos: [-3.15, 2.75], ry: 2.29 }` — seat on the rug's inner half, facing the fire (local +z forward).
  - `teaTable: { pos: [-4.19, 2.11], ry: -0.785 }` — just past the rug's back (−u) short edge, ~0.2 m gap.
  - `yak: { pos: [4.5, 1.65], ry: -2.36 }` — profile foreground anchor at front-right; model head +x maps
    to world (−0.707, 0.707), screen-left at az 45°.
  - `dog: { pos: [-5.1, -0.75], ry: 0.79 }`, `flagPole: { pos: [3.4, -3.2] }`, `tent`, `flagAnchors`,
    `mani`, `woodpile`, `sangbum`, `circle` (r 2.55, 12 dancers), `path`, `fire`.
- `CLEAR` — round grass-free footprints `[x, z, r]`, every entry derived from LAYOUT; `CLEAR[0]` is the
  fire (1.05). Radii: tent 1.75, rug 1.0, teaTable 0.5, mani 0.55, woodpile 0.6, flagPole 0.3, sangbum 0.45.
  `isClear(x, z, pad)`.
- `FOOTPRINTS` — shaped footprints that press or remove grass:
  `{ id, shape: 'rect' | 'ellipse', pos, ry, hx, hz, cx?, k, soft }` (half-extents in local x/z, ellipse
  centre offset cx along local x, k = blade-height multiplier inside, `soft` m falloff outside):
  `rug` (k 0), `rugApron` (k 0.35), `tea` (k 0.15), `yak` (k 0.2), `dog` (k 0.15).
- `footprintK(x, z)` — 1 untouched grass … 0 no grass (min over FOOTPRINTS of `1 − (1 − k)·w`,
  `w = 1 − smooth(0, soft, d)`, d = rect `max(|lx|−hx, |lz|−hz)` / ellipse `(hypot((lx−cx)/hx, lz/hz) − 1)·min(hx, hz)`).
- `inFootprint(x, z, pad = 0)` — true when d < pad for any footprint.
- `PATCH` (rx 6.9, rz 5.9, edge 0.14) + `patchMask`, `patchRadius`, GLSL `gPatchMask` — the meadow outline.
  Stay inside `patchMask(x, z) > 0.6`. `onPath()` is the dance ring.

## Framing and pixels (render.js)

- Fit model: `hView = max(view.height, view.fitW / aspect) / view.zoom` (height 12.6, fitW 15.2). Landscape
  keeps 12.6 m vertically; square and portrait keep 15.2 m horizontally, so the patch is ~86 % of the width.
- `view.shiftY` (0.035) moves the content down on screen (raises the look point along camera-up before the
  art-pixel snap). Portrait (aspect < 0.8): main.js measures the caption overlay and calls
  `R.setInsets({ bottom })`; the patch is centred in the area above it. `?zoom`, `?cx`, `?cz` set
  `view.centred` so close-ups have no offsets.
- Art pixel: `state.px = max(2, round(min(h, 0.9·w) / 380))` device px; `uArtPx` (core `U.uArtPx`, GLSL
  `uniform float uArtPx`) = one art pixel in world metres at zoom 1 (≈ 0.042 at 1080², 0.039 on a 390×844
  phone). Use it for one-pixel-wide billboards instead of computing `(cam.top − cam.bottom) / lowH · zoom`.
- Post pass: luma snapped to 11 bands with a narrow Bayer dither (`uBandDither` 0.42) so flat faces stay one
  tone, then a per-channel posterise to 24 levels (`uDither` 0.7); darks cool, highlights warm.

## Shared helpers (core.js)

`mat`, geometry helpers (`box`, `boxB`, `cyl`, `cylB`, `cone`, `sphere`, `ico`, `tint`, `put`, `pivot`),
`cyc`, `frac`, `clamp`, `lerp`, `smooth`, `rng`, `hash2`, `vnoise2`, `fbm2`, `wind` / `GLSL.wind`, `PAL`, `PANGDEN`,
plus (new, migrate your private copies to these):

- `glslColor(hex)` → `'vec3(r, g, b)'` (linear working space; identical to camp-lib `glc`).
- `WIND_DIR` (`Vector3(1, 0, −0.55).normalize()`), GLSL `G_WIND_DIR` in `GLSL.common`.
- `mixHex(a, b, k)`, `shadeHex(hex, k)` (linear working space, like dancers-rig `mix` / `shade`).
- `U.uArtPx` / `uniform float uArtPx;` (see above). Uniforms in every `mat()`: `uTime`, `uLoop`, `uNight`, `uArtPx`.

## Hard rules

1. **Loop-periodic animation only.** `update(t)` must be a pure function of `t` (no accumulated state,
   no Math.random at runtime). LOOP = 48 s (the dance circle makes exactly one turn per loop).
   Every oscillation uses `cyc(t, n)` with an **integer** n = cycles per 24 s (CYC_BASE), e.g.
   `Math.sin(cyc(t, 32))` is one cycle per beat (BEAT = 0.75 s → 64 beats = 8 phrases of 8 counts per
   loop). In GLSL `cycP(n)` is the same. Particles: give particle i a phase `frac(t * k / 24 + i / N)`
   with integer k. Frame t=0 and t=48 must be identical so the exported video loops seamlessly.
2. **No transparency blending.** For fades use the dither: `mat(color, { fade: true })` then set
   `material.userData.fade.value` (0..1), or `instFade: true` with an `aFade` InstancedBufferAttribute.
3. **Materials via `mat()`** (flat-shaded Lambert + pixel grain). Use `PAL` colours (add your own
   constants in your file when needed, keep them in the same muted, naturalistic register).
   `grain` 0.03–0.15 gives cloth/wood/thatch speckle; `stripe` gives wood grain/planks.
   For bright self-lit things (flames, sparks) use `emissive` + `emissiveIntensity`.
   GLSL hooks (`vertex.body`, `fragment.body`) let you sway/flutter in the shader: `uTime`, `uLoop`,
   `uNight`, `uArtPx`, `cycP(n)`, `gWind(xz)` (include `GLSL.wind` in `head`), `G_WIND_DIR`, `gBayer4`,
   `gNoise2`, `gFbm2`, `vGWorld`, `vGLocal` are available (see core.js).
4. **Scale.** 1 unit = 1 m. Adults 1.55–1.75 m. The whole scene is ~14 × 12 m, so one art pixel is
   ≈ 4 cm; details smaller than ~3 cm vanish, details of 4–8 cm read as single pixels — use them.
5. **Placement.** Use `LAYOUT` positions from core.js; stay inside the patch (`patchMask(x,z) > 0.6`).
   `CLEAR`/`isClear()` and `FOOTPRINTS`/`footprintK()`/`inFootprint()` mark where grass doesn't grow or is
   pressed; `onPath()` is the dance ring.
6. **Shadows.** Meshes from the helpers cast + receive shadows. Turn `castShadow` off for tiny or
   self-lit things (sparks, smoke, flames, grass blades). The sun shadow map is 1024².
7. **Budget.** Keep your module under ~350 draw calls; use InstancedMesh for anything repeated > 30×.
   Merge static geometry when it helps:
   `import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'` (import map maps
   `three/addons/` to three r170 examples/jsm).
8. **Respect.** This is a living Tibetan tradition. Dress, colours and objects should be what Tibetans
   actually wear and use. No generic "Asian" props, no exaggerated or comic features.
   The scene is a composite (lingka picnic + fireside gorshey); copy must say so and must not frame
   gorshey as a fire ritual.
9. **No globals.** Modules never read `location.search` or write `window.*`; see the module contract.

## Testing (do this, repeatedly)

A static server runs at http://localhost:8787 (if not: `python3 -m http.server 8787 --directory /Users/tenzindelek/Developer/creative-vibe &`).

```
cd /Users/tenzindelek/Developer/creative-vibe
node tools/shot.mjs --q "only=base,fire" --t 0,3,6 --out shots/<you>/view
node tools/shot.mjs --q "only=base,dancers&zoom=2.5&cx=0&cz=2.5" --t 0,0.375,0.75 --out shots/<you>/close
node tools/shot.mjs --q "only=base,fire&mode=night" --t 2 --out shots/<you>/night
node tools/shot.mjs --q "only=ground,fire,dancers,camp&grid=1" --t 2 --w 1080 --h 1080 --out shots/<you>/layout
```

`base` is a stable flat test-bed patch (js/base.js) — use it instead of `ground` while other agents
are editing. Once in a while also try `only=ground,<you>` to see your module sunk into the real grass.

Then **Read the PNGs** and judge them like an art director against the reference frames. Query
options: `only=` (comma list of modules), `t=` time, `mode=day|night`, `zoom=` (2–4 for close-ups),
`cx`,`cz` (look-at point), `az=` (camera azimuth degrees, default 45), `el=` elevation, `grid=1`
(1 m grid, magenta LAYOUT posts, cyan CLEAR circles, yellow FOOTPRINTS, orange 3.62 m dancer reach),
`debug=1` (on-page error box + `window.gorshey.debug`), `clean=1` (no caption). The script prints page
console errors — fix every one. Use a shots sub-folder named after your module.

shot.mjs flags: `--w --h` (CSS px, default 1200×900), `--dpr 3` (phone density), `--crop x,y,w,h`,
`--scale k` (nearest-neighbour upscale of the saved image, for crops), `--info 1` (`window.__info()`:
draw calls incl. shadow passes, triangles, meshes per module, art px), `--bbox 1` (bounding box of
non-background pixels as % of the viewport + caption/controls rects), `--sample "x,y;x,y"` (sRGB colour
at CSS-px points, overlay hidden). Standard framing checks: 1080×1080, 1600×1000 and 390×844 `--dpr 3`,
day and night, t=2 and t=19.

Note: at the default zoom the pixel pipeline is exactly what viewers see; close-ups (`zoom=`) are
for checking construction only. Judge the final look at zoom 1.

Keep the whole scene under ~1500 calls including shadow passes.

### Motion probe (dancers)

```
node tools/motion-probe.mjs [--q "only=base,dancers"] [--from 0] [--to 48] [--fps 30] [--dancer name] [--out prefix] [--report-only]
```

Loads `index.html?static=1&debug=1&<q>`, steps t by 1/fps with `__renderAt(t)` and reads
`window.gorshey.debug.dancers ?? window.__dancers` (`[{ spec.name, rig.bones, rig.mesh, D }]`). Heel and
toe points come from the foot bones' skinning matrices and the sole box in dancers-rig.js. Per dancer it
prints a table and writes `<out>.json` (default `shots/motion/probe.json`):

1. hips Δy > 3 cm per frame (skipping frames where both soles are > 1 cm up),
2. planted sole drift > 0.3 cm per frame (heel/toe below 1 cm in both frames),
3. minimum sole y < −0.5 cm,
4. neighbour (i, i±1) arm / forearm / hand / sleeve segments closer than 4 cm (worst pairs + times),
5. own sleeve points inside the torso (elliptic torso, half-widths `D.torsoW/2` × `D.torsoD/2`, around the
   hips–spine–chest–neck polyline),
6. head-y range per 6 s phrase (SEQ A B A C | A D A C), reported only.

Exits 1 on any failure unless `--report-only`. A full 48 s loop at 30 fps takes ~10 s.

### Loop check

```
node tools/shot.mjs --t 0,48 --w 1080 --h 1080 --out shots/<you>/loop && cmp shots/<you>/loop-t0.png shots/<you>/loop-t48.png
node tools/imgdiff.mjs a.png b.png      # differing pixel count + bounding box (exit 1 if any differ)
```
