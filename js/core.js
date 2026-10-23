// Shared helpers for every scene module.
// World units are metres. Ground is the y = 0 plane. The bonfire sits at the origin.
// Every animation must be periodic in LOOP so the video export loops seamlessly:
// use cyc(t, n) with an integer n instead of raw t. n counts cycles per CYC_BASE (24 s);
// LOOP is 48 s = 2 × CYC_BASE, so any integer n is seamless.
import * as THREE from 'three';

export const LOOP = 48;            // seconds; the dance circle makes exactly one clockwise turn per loop
export const CYC_BASE = 24;        // seconds; cyc(t, n) = n cycles per 24 s
export const BEAT = 0.75;          // seconds per step beat (80 bpm): 64 beats per loop, 8 phrases of 8 counts
export const TAU = Math.PI * 2;

export const cyc = (t, n) => (TAU * n * t) / CYC_BASE;      // phase angle, n integer (cycles per 24 s)
export const frac = (x) => x - Math.floor(x);
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };

// Seeded PRNG (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sine-free hash + value noise. The GLSL twins below use the same formulas.
export function hash2(x, y) {
  let p3x = frac(x * 0.1031), p3y = frac(y * 0.1031), p3z = frac(x * 0.1031);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  return frac((p3x + p3y) * p3z);
}
export function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function fbm2(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ---- The diorama base -------------------------------------------------------
// An irregular meadow patch. patchMask returns 1 well inside, falling to 0 past the rim,
// with a noisy, organic outline. Ground, grass and props all use it so they agree.
export const PATCH = { rx: 6.9, rz: 5.9, edge: 0.14, wobble: 0.34, freq: 0.32 };   // edge: rim band width (fraction of radius)
export function patchRadius(x, z) {
  const r = Math.hypot(x / PATCH.rx, z / PATCH.rz);
  return r + (fbm2(x * PATCH.freq + 11.3, z * PATCH.freq - 4.7, 4) - 0.5) * PATCH.wobble;
}
export function patchMask(x, z) {
  return 1 - smooth(1 - PATCH.edge, 1, patchRadius(x, z));
}

// Where things live. Positions are [x, z]; ry is rotation about Y in radians.
// The camera looks from +x,+z toward the origin, so "front" of the scene is +x/+z.
// Object-local axes follow three.js: a point (u, v) in an object's local x/z maps to world
//   x = pos.x + u·cos(ry) + v·sin(ry),   z = pos.z − u·sin(ry) + v·cos(ry).
export const LAYOUT = {
  fire: [0, 0],
  circle: { r: 2.55, count: 12 },          // dancers travel on this ring (max reach ≈ 3.62 m from the centre)
  path: { r: 2.55, width: 0.9 },           // trampled earth ring under their feet
  tent: { pos: [-3.9, -3.3], ry: 0.62 },   // white lingka tent, back-left, door toward fire
  flagPole: { pos: [3.4, -3.2] },          // tall pole with lungta lines, back-right (base in full grass)
  flagAnchors: [[-3.9, -3.3], [5.4, -1.6], [1.0, -5.0]], // other ends of flag lines (tent peak + ground stakes)
  // The picnic group sits on the ring's LEFT FLANK (side-on to the camera, faces read in profile).
  // Rug-local u (its length w) runs along world (0.707, 0.707), toward the camera; +v points away from
  // the fire. Inner (fire-side) edge at r ≈ 3.86.
  rug: { pos: [-3.2, 3.1], ry: -0.785, w: 1.92, d: 1.2 },
  musician: { pos: [-3.15, 2.75], ry: 2.29 },   // seat on the rug's inner half, facing the fire (local +z forward)
  teaTable: { pos: [-4.19, 2.11], ry: -0.785 }, // low painted chokse just past the rug's back (−u) short edge
  // The yak is a profile foreground anchor at front-right. Model head is local +x → world (−0.707, 0.707),
  // i.e. screen-left at the default azimuth (45°).
  yak: { pos: [4.5, 1.65], ry: -2.36 },
  dog: { pos: [-5.1, -0.75], ry: 0.79 },   // off the tent's left side, clear of its side guy-rope stake
  mani: { pos: [1.4, -4.9] },              // small carved mani-stone pile
  woodpile: { pos: [-1.2, 4.6] },
  sangbum: { pos: [-1.25, -4.2] },         // small whitewashed juniper-incense burner with a smoke curl
};

// Round footprints where tall grass must not grow: [x, z, radius]. CLEAR[0] is always the fire.
// Every entry derives from LAYOUT (move a prop there and its clearing follows). The dance ring is LAYOUT.path.
const at = (key, r) => [LAYOUT[key].pos[0], LAYOUT[key].pos[1], r];
export const CLEAR = [
  [LAYOUT.fire[0], LAYOUT.fire[1], 1.05],   // fire pit + ash
  at('tent', 1.75),                         // tent floor
  at('rug', 1.0),                           // rug
  at('teaTable', 0.5),                      // tea table
  at('mani', 0.55),                         // mani stones
  at('woodpile', 0.6),                      // woodpile
  at('flagPole', 0.3),                      // flag pole base
  at('sangbum', 0.45),                      // sangbum incense burner
];
export function isClear(x, z, pad = 0) {
  for (const [cx, cz, r] of CLEAR) if (Math.hypot(x - cx, z - cz) < r + pad) return true;
  return false;
}

// Shaped footprints (rect / ellipse in the object's local x/z) that press or remove grass.
// k = blade-height multiplier inside (0 = no grass, 1 = untouched); `soft` m of falloff outside the shape;
// ellipses may be offset along local x by cx. The grass owner (ground) applies these; life places on them.
export const FOOTPRINTS = [
  { id: 'rug', shape: 'rect', pos: LAYOUT.rug.pos, ry: LAYOUT.rug.ry, hx: LAYOUT.rug.w / 2 + 0.08, hz: LAYOUT.rug.d / 2 + 0.05, k: 0, soft: 0.1 },
  { id: 'rugApron', shape: 'rect', pos: LAYOUT.rug.pos, ry: LAYOUT.rug.ry, hx: LAYOUT.rug.w / 2 + 0.38, hz: LAYOUT.rug.d / 2 + 0.35, k: 0.35, soft: 0.15 },
  { id: 'tea', shape: 'rect', pos: LAYOUT.teaTable.pos, ry: LAYOUT.teaTable.ry, hx: 0.45, hz: 0.75, k: 0.15, soft: 0.12 },
  { id: 'yak', shape: 'ellipse', pos: LAYOUT.yak.pos, ry: LAYOUT.yak.ry, hx: 1.75, hz: 0.9, cx: 0.3, k: 0.2, soft: 0.6 },
  { id: 'dog', shape: 'ellipse', pos: LAYOUT.dog.pos, ry: LAYOUT.dog.ry, hx: 0.85, hz: 0.55, cx: 0.08, k: 0.15, soft: 0.5 },
];
// signed-ish distance (m) outside footprint f, <= 0 inside
function footprintD(f, x, z) {
  const dx = x - f.pos[0], dz = z - f.pos[1];
  const c = Math.cos(f.ry ?? 0), s = Math.sin(f.ry ?? 0);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (f.shape === 'rect') return Math.max(Math.abs(lx) - f.hx, Math.abs(lz) - f.hz);
  return (Math.hypot((lx - (f.cx ?? 0)) / f.hx, lz / f.hz) - 1) * Math.min(f.hx, f.hz);
}
// Grass height multiplier at (x, z): 1 = untouched grass, 0 = no grass.
export function footprintK(x, z) {
  let k = 1;
  for (const f of FOOTPRINTS) {
    const w = 1 - smooth(0, f.soft, footprintD(f, x, z));
    k = Math.min(k, 1 - (1 - f.k) * w);
  }
  return k;
}
// True when (x, z) lies inside any footprint grown by `pad` metres.
export function inFootprint(x, z, pad = 0) {
  for (const f of FOOTPRINTS) if (footprintD(f, x, z) < pad) return true;
  return false;
}
export function onPath(x, z) { // 0..1, 1 = centre of the trampled dance ring
  const d = Math.abs(Math.hypot(x, z) - LAYOUT.path.r);
  return 1 - smooth(LAYOUT.path.width * 0.35, LAYOUT.path.width * 0.6, d);
}

// ---- Colour -----------------------------------------------------------------
// Use these instead of ad-hoc colours so the scene reads as one palette.
export const PAL = {
  grassDeep: 0x3f5f1f, grass: 0x5f8a2a, grassLight: 0x93b33e, grassDry: 0xb7a95a,
  earth: 0x8a6a46, earthDark: 0x5e4630, stone: 0x8e8a80, stoneDark: 0x5f5b55,
  wood: 0x7a4e2c, woodLight: 0xa77446, charcoal: 0x2b2420,
  white: 0xf3efe6, tentBlue: 0x1f4e8c, tentRed: 0xa3242a,
  flameCore: 0xfff1b8, flame: 0xffb43a, flameDeep: 0xe2531c,
  // Lungta order: blue, white, red, green, yellow
  lungta: [0x2f63b8, 0xf2f2ec, 0xc8322b, 0x2f8a4a, 0xf1c232],
  // Costume
  chubaBlack: 0x23202a, chubaMaroon: 0x6e1f2a, chubaNavy: 0x213252, chubaBrown: 0x5b3a26, chubaGrey: 0x5c5a60,
  blousePink: 0xe59ab0, blouseSky: 0x9cc6e8, blouseYellow: 0xf0cf62, blouseWhite: 0xf1ede4, blouseLilac: 0xb8a2d8,
  sashRed: 0xb52a2a, sashGold: 0xd9a23a, gold: 0xd4a640, coral: 0xd2523c, turquoise: 0x2fb2a6,
  skin: 0xb07a55, skinDeep: 0x8f5e40, hair: 0x1b1716, fur: 0x8a6a4a, furLight: 0xd8cbb4,
  bootRed: 0x9c2a22, bootGreen: 0x2f5e4a, bootBlack: 0x1d1a1a,
  yak: 0x2a2320, yakLight: 0x4a3f38, horn: 0xd8d0bd,
};
// Pangden stripe sets: striped apron, mainly Ü-Tsang, associated with married/adult women (never men), read top to bottom.
export const PANGDEN = [
  [0xc8322b, 0x2f63b8, 0xf1c232, 0x2f8a4a, 0xe07a2e, 0x6d3a8f, 0xf2f2ec],
  [0x2f8a4a, 0xc8322b, 0x2fb2a6, 0xf1c232, 0x23202a, 0xe07a2e],
  [0x6d3a8f, 0xf1c232, 0xc8322b, 0x2f63b8, 0x2f8a4a, 0xd2523c],
];

// ---- Shared time uniforms (main.js writes these every frame) ----------------
export const U = {
  uTime: { value: 0 },
  uLoop: { value: LOOP },
  uNight: { value: 0 },  // 0 day, 1 night (eases between)
  uArtPx: { value: 0.04 }, // one art pixel in world metres at zoom 1 (render.js updateCamera writes it)
};

// ---- Wind direction + colour helpers ----------------------------------------
// Prevailing wind (world xz, normalised): flags, smoke and grass lean along it. GLSL: G_WIND_DIR.
export const WIND_DIR = new THREE.Vector3(1, 0, -0.55).normalize();
// 'vec3(r, g, b)' GLSL literal of an sRGB hex colour, in the linear working space (same as camp-lib glc).
export function glslColor(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}
const _hA = new THREE.Color(), _hB = new THREE.Color();
// Blend two hex colours (k = 0 → a, 1 → b) in the linear working space; returns a hex.
export function mixHex(a, b, k) { return _hA.setHex(a).lerp(_hB.setHex(b), k).getHex(); }
// Scale a hex colour's brightness by k (linear working space); returns a hex.
export function shadeHex(hex, k) { return _hA.setHex(hex).multiplyScalar(k).getHex(); }

// ---- GLSL snippets ----------------------------------------------------------
export const GLSL = {
  common: /* glsl */`
    #ifndef GORSHEY_COMMON
    #define GORSHEY_COMMON
    #define G_TAU 6.28318530718
    uniform float uTime;
    uniform float uLoop;
    uniform float uNight;
    uniform float uArtPx;   // one art pixel in world metres at zoom 1
    #define G_WIND_DIR vec3(${WIND_DIR.x.toFixed(4)}, 0.0, ${WIND_DIR.z.toFixed(4)})
    float cycP(float n) { return G_TAU * n * uTime / 24.0; } // n integer cycles per 24 s (LOOP = 48 s)
    float gHash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float gHash13(vec3 p3) {
      p3 = fract(p3 * 0.1031);
      p3 += dot(p3, p3.zyx + 31.32);
      return fract((p3.x + p3.y) * p3.z);
    }
    float gNoise2(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(gHash12(i), gHash12(i + vec2(1, 0)), u.x),
                 mix(gHash12(i + vec2(0, 1)), gHash12(i + vec2(1, 1)), u.x), u.y);
    }
    float gFbm2(vec2 p) {
      float s = 0.0, a = 0.5, n = 0.0;
      for (int i = 0; i < 4; i++) { s += a * gNoise2(p); n += a; a *= 0.5; p *= 2.03; }
      return s / n;
    }
    // 4x4 ordered-dither threshold for the current low-res pixel, in (0,1)
    float gBayer4(vec2 fc) {
      ivec2 i = ivec2(mod(floor(fc), 4.0));
      int idx = i.x + i.y * 4;
      float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
      return (m[idx] + 0.5) / 16.0;
    }
    #endif
  `,
  // patch mask in GLSL (twin of patchMask above). Needs common.
  patch: /* glsl */`
    float gPatchRadius(vec2 xz) {
      float r = length(xz / vec2(${PATCH.rx.toFixed(3)}, ${PATCH.rz.toFixed(3)}));
      return r + (gFbm2(xz * ${PATCH.freq.toFixed(3)} + vec2(11.3, -4.7)) - 0.5) * ${PATCH.wobble.toFixed(3)};
    }
    float gPatchMask(vec2 xz) {
      return 1.0 - smoothstep(${(1 - PATCH.edge).toFixed(3)}, 1.0, gPatchRadius(xz));
    }
  `,
};

// ---- Materials ----------------------------------------------------------------
// mat(color, opts) returns a flat-shaded Lambert material with optional pixel "grain":
//   grain:      0..0.3  blocky per-cell brightness noise (reads as fabric/thatch/wood speckle)
//   grainScale: cells per metre (default 18 ≈ one art pixel)
//   stripe:     { axis: 'x'|'y'|'z', freq, amp } sinusoidal banding in local space (wood grain, planks)
//   emissive:   hex colour; emissiveIntensity
//   fade:       true → adds uniform uFade (material.userData.fade.value, 0..1) dithered dissolve
//   instFade:   true → per-instance attribute `aFade` (InstancedBufferAttribute, 0..1) dithered dissolve
//   vertex:     { head, body }   GLSL injected before main / after <begin_vertex> (edit `transformed`, local space;
//                                for instanced meshes `instanceMatrix` is available)
//   fragment:   { head, body }   GLSL injected before main / after <color_fragment> (edit diffuseColor)
//   Varyings always available in fragment hooks: vGLocal (object-space position), vGWorld (world position).
//   Uniforms always available: uTime (0..LOOP), uLoop, uNight (0 day .. 1 night), plus GLSL.common helpers.
//   uniforms:   extra uniforms object for hooks
//   vertexColors: true → multiply by the geometry's `color` attribute (use colour 0xffffff). Lets you
//                merge many differently coloured parts into one mesh (one draw call per pass).
//   side, transparent=false always (we dither instead of blending)
const cache = new Map();
export function mat(color, opts = {}) {
  const simple = !opts.vertex && !opts.fragment && !opts.uniforms && !opts.fade && !opts.instFade;
  const key = simple ? JSON.stringify([color, opts]) : null;
  if (key && cache.has(key)) return cache.get(key);

  const m = new THREE.MeshLambertMaterial({
    color,
    flatShading: opts.flat !== false,
    side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    vertexColors: !!opts.vertexColors,
  });
  const grain = opts.grain ?? 0.06;
  const grainScale = opts.grainScale ?? 18;
  const stripe = opts.stripe ?? null;
  const seed = opts.seed ?? (Math.abs(Math.sin(color * 12.9898)) * 100) % 50;
  const fadeU = { value: opts.fadeValue ?? 1 };
  if (opts.fade) m.userData.fade = fadeU;
  const extra = opts.uniforms ?? {};
  const axis = stripe ? ({ x: '1.,0.,0.', y: '0.,1.,0.', z: '0.,0.,1.' })[stripe.axis ?? 'x'] : '1.,0.,0.';

  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, extra, { uFade: fadeU });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL.common}\nvarying vec3 vGLocal;\nvarying vec3 vGWorld;\n${opts.instFade ? 'attribute float aFade;\nvarying float vFade;' : ''}\n${opts.vertex?.head ?? ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${opts.vertex?.body ?? ''}\nvGLocal = position;\n${opts.instFade ? 'vFade = aFade;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 gW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          gW = instanceMatrix * gW;
          #endif
          vGWorld = (modelMatrix * gW).xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL.common}\nvarying vec3 vGLocal;\nvarying vec3 vGWorld;\nuniform float uFade;\n${opts.instFade ? 'varying float vFade;' : ''}\n${opts.fragment?.head ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float gF = uFade${opts.instFade ? ' * vFade' : ''};
          if (gF < 0.999 && gF < gBayer4(gl_FragCoord.xy)) discard;
          float gN = gHash13(floor(vGLocal * ${grainScale.toFixed(2)} + ${seed.toFixed(2)}));
          diffuseColor.rgb *= 1.0 + (gN - 0.5) * ${(2 * grain).toFixed(3)};
          ${stripe ? `diffuseColor.rgb *= 1.0 + ${(stripe.amp ?? 0.08).toFixed(3)} * sin(dot(vGLocal, vec3(${axis})) * ${(stripe.freq ?? 40).toFixed(2)} + gHash12(floor(vGLocal.xz * 3.0)) * 6.0);` : ''}
        }
        ${opts.fragment?.body ?? ''}`);
  };
  m.customProgramCacheKey = () => 'g' + JSON.stringify([grain, grainScale, stripe, seed, !!opts.fade, !!opts.instFade, opts.vertex, opts.fragment]);
  if (key) cache.set(key, m);
  return m;
}

// ---- Geometry helpers -----------------------------------------------------------
// All helpers return meshes that cast and receive shadows. `m` is a colour or a material.
const asMat = (m) => (m && m.isMaterial ? m : mat(m ?? 0xff00ff));
function mesh(geo, m, opts = {}) {
  const me = new THREE.Mesh(geo, asMat(m));
  me.castShadow = opts.cast ?? true;
  me.receiveShadow = opts.receive ?? true;
  return me;
}
// Box centred on its origin.
export const box = (w, h, d, m, o) => mesh(new THREE.BoxGeometry(w, h, d), m, o);
// Box whose origin is at the centre of its bottom face (handy for stacking on the ground).
export function boxB(w, h, d, m, o) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); return mesh(g, m, o); }
export const cyl = (rt, rb, h, seg, m, o) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg ?? 8), m, o);
export function cylB(rt, rb, h, seg, m, o) { const g = new THREE.CylinderGeometry(rt, rb, h, seg ?? 8); g.translate(0, h / 2, 0); return mesh(g, m, o); }
export const cone = (r, h, seg, m, o) => mesh(new THREE.ConeGeometry(r, h, seg ?? 8), m, o);
export const sphere = (r, ws, hs, m, o) => mesh(new THREE.SphereGeometry(r, ws ?? 8, hs ?? 6), m, o);
export const ico = (r, detail, m, o) => mesh(new THREE.IcosahedronGeometry(r, detail ?? 0), m, o);
// Bake a flat vertex colour into a (non-indexed or indexed) geometry; returns the geometry.
// Pair with mergeGeometries + mat(0xffffff, { vertexColors: true }) to merge coloured parts.
export function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
// Add `child` to `parent` at x,y,z with optional euler rotation; returns child.
export function put(parent, child, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  child.position.set(x, y, z);
  child.rotation.set(rx, ry, rz);
  parent.add(child);
  return child;
}
// A pivot group (for joints): put a group at x,y,z inside parent.
export function pivot(parent, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

// Wind: smooth, loop-periodic gust field. Returns roughly -1..1.
export function wind(t, x = 0, z = 0) {
  return 0.55 * Math.sin(cyc(t, 6) + x * 0.45 + z * 0.3) + 0.3 * Math.sin(cyc(t, 11) + x * 0.9 - z * 0.7) + 0.15 * Math.sin(cyc(t, 17) - x * 1.7);
}
// GLSL twin of wind(); needs common. `p` is world xz.
GLSL.wind = /* glsl */`
  float gWind(vec2 p) {
    return 0.55 * sin(cycP(6.0) + p.x * 0.45 + p.y * 0.3) + 0.3 * sin(cycP(11.0) + p.x * 0.9 - p.y * 0.7) + 0.15 * sin(cycP(17.0) - p.x * 1.7);
  }
`;
