# Gorshey diorama — build spec

An animated, isometric pixel-art diorama in the style of shawn (@zzzzshawn)'s "Small plays" series:
a small patch of Tibetan grassland floating on a plain background, dissolving into it with an ordered
dither at the rim. Ten dancers in traditional dress circle a bonfire doing gorshey (སྒོར་གཞས།),
a musician plays the dranyen on a rug, a white lingka tent and prayer flags stand behind,
a yak grazes, a dog dozes. Day mode (light page) is a golden late afternoon; night mode (dark page)
is lit mostly by the fire.

Reference frames of the target look: `/Users/tenzindelek/Developer/creative-vibe/ref/*.png`
(read them with the Read tool before you start). Notice: tiny figures (~20–28 art pixels tall),
lots of micro-detail suggested by single pixels, naturalistic slightly muted colour, soft cast
shadows, no thick black outlines, white space all around.

## Files

```
gorshey/index.html      page + import map (three r170 from jsDelivr)
gorshey/js/main.js      boot, loop, modules, drag-to-turn, theme sync  (do not edit)
gorshey/js/render.js    pixel pipeline + lights                         (do not edit)
gorshey/js/core.js      shared helpers, LAYOUT, PAL, CLEAR, GLSL        (do not edit; ask in your report if you need something)
gorshey/js/ground.js    meadow base, grass, flowers, trampled ring     (ground agent)
gorshey/js/fire.js      fire pit, flames, sparks, smoke, fire light    (fire agent)
gorshey/js/dancers.js   ten dancers + choreography                     (dancers agent)
gorshey/js/camp.js      lingka tent, prayer flags + pole, mani stones, woodpile (camp agent)
gorshey/js/life.js      musician w/ dranyen, elder w/ prayer wheel, rug, tea table + thermos, yak, dog (life agent)
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

`ctx` = `{ THREE, core, scene, renderer, camera, sun, R, mode, shared }`. `ctx.shared` is a plain
object modules may use to publish data for others (e.g. the fire module sets `ctx.shared.fireLight`).
Modules load in this order: ground, fire, dancers, camp, life.

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
   `uNight`, `cycP(n)`, `gWind(xz)` (include `GLSL.wind` in `head`), `gBayer4`, `gNoise2`, `gFbm2`,
   `vGWorld`, `vGLocal` are available (see core.js).
4. **Scale.** 1 unit = 1 m. Adults 1.55–1.75 m. The whole scene is ~14 × 12 m, so one art pixel is
   ≈ 4 cm; details smaller than ~3 cm vanish, details of 4–8 cm read as single pixels — use them.
5. **Placement.** Use `LAYOUT` positions from core.js; stay inside the patch (`patchMask(x,z) > 0.6`).
   `CLEAR`/`isClear()` marks prop footprints where grass doesn't grow; `onPath()` is the dance ring.
6. **Shadows.** Meshes from the helpers cast + receive shadows. Turn `castShadow` off for tiny or
   self-lit things (sparks, smoke, flames, grass blades).
7. **Budget.** Keep your module under ~350 draw calls; use InstancedMesh for anything repeated > 30×.
   Merge static geometry when it helps:
   `import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'` (import map maps
   `three/addons/` to three r170 examples/jsm).
8. **Respect.** This is a living Tibetan tradition. Dress, colours and objects should be what Tibetans
   actually wear and use. No generic "Asian" props, no exaggerated or comic features.

## Testing (do this, repeatedly)

A static server runs at http://localhost:8787 (if not: `python3 -m http.server 8787 --directory /Users/tenzindelek/Developer/creative-vibe &`).

```
cd /Users/tenzindelek/Developer/creative-vibe
node tools/shot.mjs --q "only=base,fire" --t 0,3,6 --out shots/<you>/view
node tools/shot.mjs --q "only=base,dancers&zoom=2.5&cx=0&cz=2.5" --t 0,0.375,0.75 --out shots/<you>/close
node tools/shot.mjs --q "only=base,fire&mode=night" --t 2 --out shots/<you>/night
```

`base` is a stable flat test-bed patch (js/base.js) — use it instead of `ground` while other agents
are editing, since ground.js may be mid-rewrite. Once in a while also try `only=ground,<you>` to see
your module sunk into the real grass (if it errors, that's the ground agent's work in progress).

Then **Read the PNGs** and judge them like an art director against the reference frames. Query
options: `only=` (comma list of modules), `t=` time, `mode=day|night`, `zoom=` (2–4 for close-ups),
`cx`,`cz` (look-at point), `az=` (camera azimuth degrees, default 45), `el=` elevation, `grid=1`
(1 m grid + LAYOUT markers). The script prints page console errors — fix every one.
Use a shots sub-folder named after your module.

Note: at the default zoom the pixel pipeline is exactly what viewers see; close-ups (`zoom=`) are
for checking construction only. Judge the final look at zoom 1.

Stats: `node tools/shot.mjs ... --info 1` prints `window.__info()` (draw calls incl. shadow passes,
triangles, meshes per module). Keep the whole scene under ~1500 calls including shadow passes.
