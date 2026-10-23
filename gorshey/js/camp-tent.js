// Lingka picnic tent: a white cotton ridge tent with low walls, blue appliqué (scalloped valance with a
// running wave and red-yellow-green edging, endless-knot medallions, paired cloud scrolls by the door), a
// door on the gable end facing the fire with the flaps tied back, a dark interior with a rug and cushions,
// ridge-pole tips with brass finials, guy ropes to wooden stakes.
// Geometry is baked in world space into the shared accumulators (canvas / solids / cloth).
import * as THREE from 'three';
import { LAYOUT, patchMask, glslColor as glc } from './core.js';
import { CP, M } from './camp-lib.js';

// ---- dimensions (metres, tent-local: +z toward the fire = door end, x across) -------------
// SC is the detail scale against the round-2 tent (2.5 m): door, valance, overhangs and appliqué follow it.
export const T = {
  SC: 0.85,
  L: 2.1,        // wall length along the ridge
  W: 2.1,        // wall width
  HE: 1.0,       // wall / eave height
  HR: 1.95,      // ridge height
  OV: 0.1,       // roof overhang past the side walls (horizontal)
  OG: 0.085,     // roof overhang past the gables
  VH: 0.21,      // valance height
  DW: 0.73,      // door width
  DS: 1.16,      // door side height
  DH: 1.45,      // door apex
  TIP: 0.2,      // ridge-pole tip above the ridge
};
T.k = (T.HR - T.HE) / (T.W / 2);              // roof rise per metre
T.XE = T.W / 2 + T.OV;                       // eave x
T.YE = T.HE - T.OV * T.k;                    // eave y
T.S = Math.hypot(T.XE, T.HR - T.YE);         // slope length ridge -> eave
T.RL = T.L + 2 * T.OG;                       // roof length

// Placement: LAYOUT.tent sits right on the patch rim behind it, so the tent is nudged a little toward
// the fire (and to screen-left, where the patch is deeper) to keep its back inside the meadow, while the
// front gable (r ≈ 3.82) and every stake (r ≥ 3.75) stay clear of the dancers' reach (3.62 m).
// The door always faces the fire.
const NUDGE_FWD = 0.25, NUDGE_SIDE = -0.3;
export function tentFrame() {
  const [x0, z0] = LAYOUT.tent.pos;
  const ry0 = Math.atan2(-x0, -z0);
  const f0 = [Math.sin(ry0), Math.cos(ry0)], s0 = [Math.cos(ry0), -Math.sin(ry0)];
  const x = x0 + f0[0] * NUDGE_FWD + s0[0] * NUDGE_SIDE, z = z0 + f0[1] * NUDGE_FWD + s0[1] * NUDGE_SIDE;
  const ry = Math.atan2(-x, -z);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
  return { x, z, ry, m };
}

// Night glow inside the tent (butter lamp + the fire's light through the door): a dim brown core round the
// lamp with a two-step falloff, on the floor, rug, cushions and table. The walls hide all of it except
// what shows through the door opening.
const GLOW = { c: [0.15, 0.3, -0.3], r1: 0.38, r2: 0.68, r3: 1.0, core: 0x8a4a26 };
export function tentInteriorGLSL(F = tentFrame()) {
  const f = (v) => v.toFixed(4);
  const g = new THREE.Vector3(...GLOW.c).applyMatrix4(F.m);
  return /* glsl */`
    uniform float uGlow;
    // 0..1 inside the tent: tent-local |x|, |z| within the walls and below the eaves
    float campInTent(vec3 w) {
      vec2 d = w.xz - vec2(${f(F.x)}, ${f(F.z)});
      float u = d.x * ${f(Math.cos(F.ry))} - d.y * ${f(Math.sin(F.ry))};
      float v = d.x * ${f(Math.sin(F.ry))} + d.y * ${f(Math.cos(F.ry))};
      return step(abs(u), ${f(T.W / 2 - 0.02)}) * step(abs(v), ${f(T.L / 2 - 0.02)}) * step(w.y, ${f(T.HE)});
    }
    float campGlowK(vec3 w) {
      float d = distance(w, vec3(${f(g.x)}, ${f(g.y)}, ${f(g.z)}));
      return d < ${f(GLOW.r1)} ? 1.0 : (d < ${f(GLOW.r2)} ? 0.5 : (d < ${f(GLOW.r3)} ? 0.22 : 0.0));
    }
  `;
}
export const TENT_INTERIOR_FRAG = /* glsl */`
  {
    float gk = campInTent(vGWorld) * campGlowK(vGWorld) * uNight;
    if (gk > 0.0) {
      totalEmissiveRadiance += ${glc(GLOW.core)} * mix(1.0, 3.0 * dot(diffuseColor.rgb, vec3(0.33)), 0.35) * gk * uGlow;
      diffuseColor.rgb *= 1.0 - 0.6 * gk;
    }
  }
`;

// ---- canvas shader -------------------------------------------------------------------------
// part ids (aP.x): 0 wall, 1 roof, 2 valance, 3 gable, 4 liner, 5 flap, 6 plain (vertex colour only)
export function canvasGLSL(zoom = 1) {
  const f = (v) => v.toFixed(4);
  const s = T.SC;
  return /* glsl */`
    varying vec2 vUV;
    varying vec4 vP;
    varying vec3 vNW;
    // endless knot: a diamond lattice with one interlaced crossing and a loop at each corner
    float knot2M(vec2 q, float R, float w) {
      vec2 a = vec2(q.x + q.y, q.x - q.y) * 0.70710678;
      float m = max(abs(a.x), abs(a.y));
      float k = step(abs(m - R), w) + step(m, R) * (step(abs(a.x), w) + step(abs(a.y), w) + step(abs(abs(a.x) - R * 0.5), w) * step(abs(a.y), R * 0.5) + step(abs(abs(a.y) - R * 0.5), w) * step(abs(a.x), R * 0.5));
      float lr = R * 0.34, d = R * 1.414 + lr * 0.55;
      k += step(abs(length(vec2(abs(q.x) - d, q.y)) - lr), w) + step(abs(length(vec2(q.x, abs(q.y) - d)) - lr), w);
      return k;
    }
    // Screen-aware strokes for the roof: gJu / gJs are the screen derivatives of the roof uv, so a stroke of
    // world half-width w along a field with uv-gradient g is widened to at least one art pixel on screen
    // (2 px wide) on the foreshortened slope.
    vec2 gJu, gJs;
    float sw(vec2 g, float w) { return max(w, 1.05 * length(g.x * gJu + g.y * gJs)); }
    // Endless-knot medallion for the roof. At the default framing (one art pixel ~4-8 cm across the
    // foreshortened slope) only what reads survives: the knot's diamond outline, a loop at each corner and a
    // jewel in the middle, strokes >= 2 art px. In close-ups (?zoom >= 1.8) the interlaced lattice is drawn too.
    float knotMedM(vec2 q, float R, float w) {
      const float r2 = 0.70710678;
      vec2 a = vec2(q.x + q.y, q.x - q.y) * r2;
      float m = max(abs(a.x), abs(a.y));
      vec2 gx = vec2(r2, r2), gy = vec2(r2, -r2);
      vec2 gm = abs(a.x) > abs(a.y) ? sign(a.x) * gx : sign(a.y) * gy;
      float k = step(abs(m - R), sw(gm, w));
      float lr = R * 0.3, d = R * 1.414 + lr * 0.5;
      vec2 p1 = vec2(abs(q.x) - d, q.y), p2 = vec2(q.x, abs(q.y) - d);
      k += step(abs(length(p1) - lr), sw(normalize(p1 + 1e-5) * vec2(sign(q.x), 1.0), w));
      k += step(abs(length(p2) - lr), sw(normalize(p2 + 1e-5) * vec2(1.0, sign(q.y)), w));
      const float fine = ${zoom >= 1.8 ? '1.0' : '0.0'};
      float lat = step(m, R) * (step(abs(a.x), w) + step(abs(a.y), w)
        + step(abs(abs(a.x) - R * 0.5), w) * step(abs(a.y), R * 0.5) + step(abs(abs(a.y) - R * 0.5), w) * step(abs(a.x), R * 0.5));
      return k + mix(step(m, R * 0.28), lat, fine);
    }
    // cloud-scroll curl: a spiral of the given turns inside radius R; dir mirrors it
    float curlM(vec2 q, float R, float turns, float w, float dir) {
      float r = length(q);
      if (r > R || r < w * 0.6) return 0.0;
      float th = atan(q.y, q.x * dir) / 6.2831853 + 0.5;
      float s = r / R * turns - th;
      float d = abs(fract(s + 0.5) - 0.5) * R / turns;
      return step(d, w) * step(s, turns - 0.15);
    }
    // a pair of mirrored cloud curls joined by a lower arc (ru-yi cloud), width ~2R
    float cloudM(vec2 q, float R, float w) {
      float m = curlM(q - vec2(-R * 0.48, R * 0.08), R * 0.5, 1.5, w, 1.0);
      m += curlM(q - vec2(R * 0.48, R * 0.08), R * 0.5, 1.5, w, -1.0);
      float arc = abs(length((q - vec2(0.0, R * 0.55)) * vec2(0.62, 1.0)) - R * 0.98);
      m += step(arc, w) * step(q.y, -R * 0.2) * step(abs(q.x), R * 0.75);
      m += step(length(q - vec2(0.0, -R * 0.12)), w * 1.6);
      return m;
    }
    vec3 canvasMotif(vec3 base, inout float cut) {
      float part = floor(vP.x + 0.5);
      vec2 uv = vUV;
      vec2 dx = dFdx(uv), dy = dFdy(uv);
      gJu = vec2(dx.x, dy.x); gJs = vec2(dx.y, dy.y);
      vec3 B = ${glc(CP.appBlue)};
      float blue = 0.0;
      vec3 c = base;
      if (part == 1.0) {               // roof slope: u along ridge (0..RL), v = slope distance from ridge
        float u = uv.x, s = uv.y;
        // the trims at the gable ends and the eave are the roof's edge against the page: never thinner
        // than one art pixel on screen
        float eu = max(${f(0.06)}, fwidth(u) * 1.1), es = max(${f(0.06)}, fwidth(s) * 1.1);
        blue = step(s, ${f(0.065)});
        blue += step(${f(T.S)} - es, s) + step(abs(s - ${f(T.S - 0.13)}), 0.021);
        blue += step(u, eu) + step(${f(T.RL)} - eu, u);
        // one endless-knot medallion per slope, drawn bold for 1x: a diamond, one crossing, a loop at each
        // corner, strokes 2 art px (0.08 m)
        blue += knotMedM(vec2(u - ${f(T.RL / 2)}, s - ${f(T.S * 0.5)}), 0.30, 0.04);
      } else if (part == 2.0) {        // valance: u along eave, v down from the top
        float u = uv.x, v = uv.y;
        float t = fract(u / ${f(0.2 * s)}) - 0.5;
        float edge = ${f(T.VH - 0.047)} + 0.047 * sqrt(max(0.0, 1.0 - 4.0 * t * t));
        if (v > edge) cut = 1.0;
        if (v < 0.03) c = ${glc(CP.edgeRed)};
        else if (v < 0.06) c = ${glc(CP.edgeYellow)};
        else if (v < 0.09) c = ${glc(CP.edgeGreen)};
        blue = step(edge - 0.05, v);
        // a running wave between the edging and the scallop border
        float t2 = fract(u / ${f(0.4 * s)}) - 0.5;
        float wave = ${f(0.132)} + 0.025 * sin(u / ${f(0.4 * s)} * 6.2831853);
        blue += step(abs(v - wave), 0.016) * step(0.092, v);
        blue += step(length(vec2(t2 * ${f(0.4 * s)} - 0.085, v - 0.145)), 0.024);
      } else if (part == 3.0) {        // gable: uv = (x, y) in the gable plane
        float x = uv.x, y = uv.y, ax = abs(x);
        float cosP = ${f(Math.cos(Math.atan(T.k)))};
        float rake = (${f(T.HE)} + (${f(T.W / 2)} - ax) * ${f(T.k)} - y) * cosP;   // distance below the roof line
        float along = (${f(T.W / 2)} - ax) / cosP;                                // distance up the rake
        float tt = fract(along / ${f(0.2 * s)}) - 0.5;
        float sc = ${f(0.064)} + 0.043 * sqrt(max(0.0, 1.0 - 4.0 * tt * tt));
        blue = step(rake, sc) * step(0.02, rake) + step(rake, 0.0);
        blue += step(abs(rake - sc - 0.045), 0.017) * step(y, ${f(T.HR - 0.26)}) * step(0.3, along);
        if (vP.w < 0.5) {
          // door frame
          vec2 nTop = normalize(vec2(${f(T.DH - T.DS)}, ${f(T.DW / 2)}));
          float dTop = dot(vec2(ax, y) - vec2(${f(T.DW / 2)}, ${f(T.DS)}), nTop);
          float door = max(ax - ${f(T.DW / 2)}, dTop);
          blue += step(door, 0.066) * step(0.0, door);
          // medallion above the door
          blue += knot2M(vec2(x, y - ${f((T.DH + T.HR) / 2 - 0.03)}), ${f(0.13 * s)}, 0.02);
        } else {
          // back gable: one large endless knot
          blue += knot2M(vec2(x, y - ${f(1.15 * s)}), ${f(0.26 * s)}, 0.022);
        }
        // paired cloud scrolls either side of the door
        blue += cloudM(vec2(ax - ${f(0.84 * s)}, y - ${f(0.5 * s)}), ${f(0.22 * s)}, 0.02);
        // bottom band
        blue += step(y, ${f(0.065)}) + step(abs(y - ${f(0.118)}), 0.017) * step(${f(T.DW / 2 + 0.07)}, ax);
      } else if (part == 0.0) {        // side wall: u along, v up
        float u = uv.x, v = uv.y;
        blue = step(v, ${f(0.065)}) + step(abs(v - ${f(0.118)}), 0.017);
        c *= 1.0 - 0.06 * step(fract(u / ${f(0.62 * s)} + 0.5), 0.05);   // seams between canvas widths
        blue += step(u, 0.05) + step(${f(T.L)} - 0.05, u);
      } else if (part == 4.0) {        // liner: dark interior, faint seams
        c *= 1.0 - 0.12 * step(fract(uv.x / ${f(0.62 * s)}), 0.06);
      }
      return mix(c, B, clamp(blue, 0.0, 1.0));
    }
    // Firelight on the canvas at night: only a warm grey-ochre tint (no saturated orange on white cotton).
    // By day it is all but lost in the sun (and must not flicker the flat faces).
    vec3 campFireTint(vec3 c) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      return mix(c * 0.15, l * ${glc(0x9a7254)} * 2.0, uNight);
    }
  `;
}

export const CANVAS_FRAG = /* glsl */`
  {
    float cut = 0.0;
    vec3 c = canvasMotif(diffuseColor.rgb, cut);
    if (cut > 0.5) discard;
    // sparse felt flecks instead of an all-over grain, so a flat face resolves to one value band
    float gn = gHash13(floor(vGLocal * 24.0) + 3.0);
    c *= 1.0 - 0.05 * step(0.92, gn);
    diffuseColor.rgb = c;
    float part = floor(vP.x + 0.5);
    // white cotton bounces light: lift the faces turned from the sun a little (day only). Uses the panel
    // normal, so the wind flex never breaks a face into a checker.
    vec3 nW = normalize(vNW);
    float sunK = clamp(dot(nW, normalize(vec3(3.2, 12.0, -4.4))), 0.0, 1.0);
    if (part != 4.0) {
      totalEmissiveRadiance += c * vec3(1.06, 0.99, 0.9) * (0.02 + 0.63 * pow(1.0 - sunK, 2.2)) * (1.0 - uNight);
      // night: the felt is the lightest thing under the moon. Lift it (a little warmer than the blue key)
      // so the moonlit roof resolves to one slate band (~#555F6A) instead of a blue checker.
      diffuseColor.rgb *= 1.0 + vec3(0.74, 0.81, 0.46) * uNight;
    }
  }
`;

// ---- build -----------------------------------------------------------------------------------
// panel: four corners (CCW seen from outside, or auto-fixed using `out`), bilinear subdivision.
function panel(acc, m, [a, b, c, d], uvs, nu, nv, part, color, flexFn, out, phase = 0) {
  const lerp3 = (p, q, k) => new THREE.Vector3().lerpVectors(p, q, k);
  const P = (s, t) => lerp3(lerp3(a, b, s), lerp3(d, c, s), t);
  const UV = (s, t) => {
    const u0 = uvs[0][0] + (uvs[1][0] - uvs[0][0]) * s, v0 = uvs[0][1] + (uvs[1][1] - uvs[0][1]) * s;
    const u1 = uvs[3][0] + (uvs[2][0] - uvs[3][0]) * s, v1 = uvs[3][1] + (uvs[2][1] - uvs[3][1]) * s;
    return [u0 + (u1 - u0) * t, v0 + (v1 - v0) * t];
  };
  const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
  const flip = out && nrm.dot(out) < 0;
  if (flip) nrm.negate();
  const nW = nrm.clone().transformDirection(m);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const s0 = i / nu, s1 = (i + 1) / nu, t0 = j / nv, t1 = (j + 1) / nv;
    const corners = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];
    const pts = corners.map(([s, t]) => P(s, t).applyMatrix4(m));
    const at = corners.map(([s, t]) => ({ aUV: UV(s, t), aP: [part, flexFn ? flexFn(s, t) : 0, phase, 0] }));
    if (flip) acc.quad(pts[0], pts[3], pts[2], pts[1], color, [at[0], at[3], at[2], at[1]], nW);
    else acc.quad(pts[0], pts[1], pts[2], pts[3], color, at, nW);
  }
}

export function buildTent({ canvas, solids, cloth, ribbon }) {
  const F = tentFrame();
  const m = F.m;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const { L, W, HE, HR, XE, YE, S, RL, VH, SC } = T;
  const hl = L / 2, hw = W / 2, hr = RL / 2;
  const bell = (s) => Math.sin(Math.PI * s);

  // roof slopes (outward = up and to the side)
  for (const sg of [1, -1]) {
    panel(canvas, m, [V(0, HR, -hr), V(0, HR, hr), V(sg * XE, YE, hr), V(sg * XE, YE, -hr)],
      [[0, 0], [RL, 0], [RL, S], [0, S]], 10, 5, 1, CP.canvas,
      (s, t) => 0.55 * bell(s) * Math.sin(Math.PI * Math.min(1, t * 1.1)), V(sg, 1, 0), sg > 0 ? 0.1 : 0.6);
    // valance hanging from the eave
    panel(canvas, m, [V(sg * XE, YE, -hr), V(sg * XE, YE, hr), V(sg * (XE + 0.01), YE - VH, hr), V(sg * (XE + 0.01), YE - VH, -hr)],
      [[0, 0], [RL, 0], [RL, VH], [0, VH]], 16, 2, 2, CP.canvas, (s, t) => t * (0.7 + 0.3 * bell(s)), V(sg, 0, 0), sg > 0 ? 0.3 : 0.8);
    // side wall, bottom flared a little where it is staked out
    panel(canvas, m, [V(sg * (hw + 0.04), 0, -hl), V(sg * (hw + 0.04), 0, hl), V(sg * hw, HE, hl), V(sg * hw, HE, -hl)],
      [[0, 0], [L, 0], [L, HE], [0, HE]], 8, 3, 0, CP.canvas, (s, t) => 0.6 * bell(s) * bell(t), V(sg, 0, 0), sg > 0 ? 0.45 : 0.9);
    // liner (inward): wall and roof
    panel(canvas, m, [V(sg * (hw - 0.03), 0, -hl), V(sg * (hw - 0.03), 0, hl), V(sg * (hw - 0.03), HE - 0.03, hl), V(sg * (hw - 0.03), HE - 0.03, -hl)],
      [[0, 0], [L, 0], [L, HE], [0, HE]], 1, 1, 4, CP.liner, null, V(-sg, 0, 0));
    panel(canvas, m, [V(0, HR - 0.04, -hl), V(0, HR - 0.04, hl), V(sg * (hw - 0.03), HE - 0.04, hl), V(sg * (hw - 0.03), HE - 0.04, -hl)],
      [[0, 0], [L, 0], [L, S], [0, S]], 1, 1, 4, CP.linerDeep, null, V(-sg, -1, 0));
  }

  // gables
  const gableShape = (withDoor) => {
    const s = new THREE.Shape();
    if (withDoor) {
      s.moveTo(-hw, 0); s.lineTo(-T.DW / 2, 0); s.lineTo(-T.DW / 2, T.DS); s.lineTo(0, T.DH);
      s.lineTo(T.DW / 2, T.DS); s.lineTo(T.DW / 2, 0); s.lineTo(hw, 0);
    } else { s.moveTo(-hw, 0); s.lineTo(hw, 0); }
    s.lineTo(hw, HE); s.lineTo(0, HR); s.lineTo(-hw, HE); s.closePath();
    return new THREE.ShapeGeometry(s);
  };
  const addGable = (geo, mm, part, color, nOut, back = 0) => {
    const g = geo.toNonIndexed();
    const p = g.attributes.position;
    const nW = nOut.clone().transformDirection(m);
    for (let i = 0; i < p.count; i += 3) {
      const pts = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k));
      const at = pts.map((q) => ({ aUV: [q.x, q.y], aP: [part, 0, 0, back] }));
      const w = pts.map((q) => q.clone().applyMatrix4(mm).applyMatrix4(m));
      canvas.tri(w[0], w[1], w[2], color, at, nW);
    }
  };
  addGable(gableShape(true), M(0, 0, hl), 3, CP.canvas, V(0, 0, 1));
  addGable(gableShape(false), M(0, 0, -hl, 0, Math.PI, 0), 3, CP.canvas, V(0, 0, -1), 1);
  // liner of the back gable (faces +z, into the tent)
  addGable(gableShape(false), M(0, 0, -hl + 0.03, 0, 0, 0, 0.97, 0.98, 1), 4, CP.liner, V(0, 0, 1));

  // tied-back door flaps: canvas drapes from the door apex to a tie at the side, then down to the ground
  const tieY = 0.74 * SC;
  for (const sg of [1, -1]) {
    const z = hl + 0.025;
    const top = V(sg * 0.02, T.DH - 0.03, z), sideTop = V(sg * (T.DW / 2 + 0.05), T.DS + 0.02, z);
    const tie = V(sg * (T.DW / 2 - 0.085), tieY, z + 0.03), outer = V(sg * (T.DW / 2 + 0.085), tieY, z + 0.013);
    const botIn = V(sg * (T.DW / 2 - 0.07), 0.0, z + 0.017), botOut = V(sg * (T.DW / 2 + 0.075), 0.0, z);
    const P = [top, sideTop, outer, tie, botIn, botOut].map((q) => q.clone().applyMatrix4(m));
    const nW = V(0, 0, 1).transformDirection(m);
    const at = (fl) => ({ aUV: [0, 0], aP: [5, fl, 0.2, 0] });
    const tri = (a, b, c, col, fa, fb, fc) => { if (sg > 0) canvas.tri(a, b, c, col, [at(fa), at(fb), at(fc)], nW); else canvas.tri(a, c, b, col, [at(fa), at(fc), at(fb)], nW); };
    // upper drape
    tri(P[0], P[3], P[1], CP.canvasWarm, 0, 0.3, 0);
    tri(P[1], P[3], P[2], CP.canvasWarm, 0, 0.3, 0.2);
    // lower drape
    tri(P[3], P[4], P[2], CP.canvasWarm, 0.3, 0.1, 0.2);
    tri(P[2], P[4], P[5], CP.canvasWarm, 0.2, 0.1, 0);
    // blue edging along the inner edge of the flap (in front of it)
    const e = 0.05 * sg, dz = V(0, 0, 0.006).transformDirection(m).multiplyScalar(0.006);
    const E = [top, tie, botIn].map((q) => q.clone().applyMatrix4(m).add(dz));
    const E2 = [V(top.x + e * 0.9, top.y - 0.05, top.z), V(tie.x + e, tie.y, tie.z), V(botIn.x + e, 0, botIn.z)].map((q) => q.clone().applyMatrix4(m).add(dz));
    const pb = { aUV: [0, 0], aP: [6, 0, 0, 0] };
    for (let k = 0; k < 2; k++) {
      if (sg > 0) canvas.quad(E[k], E[k + 1], E2[k + 1], E2[k], CP.appBlue, pb, nW);
      else canvas.quad(E[k], E2[k], E2[k + 1], E[k + 1], CP.appBlue, pb, nW);
    }
    // tie cord
    solids.add(new THREE.BoxGeometry(0.09, 0.035, 0.03), M(sg * (T.DW / 2 - 0.02), tieY, hl + 0.055).premultiply(m), CP.edgeRed);
  }

  // ---- solids: poles, finials, interior ----
  const wood = (geo, mm, col = CP.pole) => solids.add(geo, mm.premultiply(m), col, { aK: [3, 0, 0, 0] });
  for (const z of [hl - 0.04, -hl + 0.04]) {
    wood(new THREE.CylinderGeometry(0.03, 0.034, HR + T.TIP, 5), M(0, (HR + T.TIP) / 2, z));
    solids.add(new THREE.SphereGeometry(0.05, 6, 4), M(0, HR + T.TIP + 0.03, z).premultiply(m), CP.brass);
    solids.add(new THREE.ConeGeometry(0.03, 0.09, 5), M(0, HR + T.TIP + 0.1, z).premultiply(m), CP.brass);
  }
  // floor felt + rug + cushions + low table + butter lamp, seen through the door
  // (felt + carpets are laid thick, which also keeps the meadow grass out of sight)
  const FY = 0.16;
  const dim = (hex, k = 0.42) => new THREE.Color(hex).multiplyScalar(k).getHex();
  solids.add(new THREE.BoxGeometry(W - 0.08, FY, L - 0.08), M(0, FY / 2, 0).premultiply(m), dim(0x3a2f28), { aK: [0, 0, 0, 0] });
  const rw = 1.7 * SC, rd = 1.9 * SC;
  solids.add(new THREE.BoxGeometry(rw, 0.02, rd), M(0, FY + 0.01, 0.04).premultiply(m), dim(CP.rugRed, 0.5), (i, p, n, l) => ({ aK: [5, l.x / rw + 0.5, l.z / rd + 0.5, 0] }));
  for (const [x, z, w, d, col] of [[-0.55, -0.95, 1.0, 0.45, CP.cushion], [0.55, -0.95, 1.0, 0.45, CP.cushion2], [-0.98, 0.05, 0.42, 1.4, CP.rugBlue], [0.98, 0.05, 0.42, 1.4, CP.cushion]]) {
    solids.add(new THREE.BoxGeometry(w * SC, 0.12, d * SC), M(x * SC, FY + 0.06, z * SC).premultiply(m), dim(col, 0.5), { aK: [6, 0, 0, 0] });
  }
  solids.add(new THREE.BoxGeometry(0.44, 0.24, 0.28), M(0.08, FY + 0.12, -0.3).premultiply(m), dim(0x7a3a26, 0.5), { aK: [0, 0, 0, 0] });
  solids.add(new THREE.CylinderGeometry(0.03, 0.022, 0.05, 5), M(0.19, FY + 0.265, -0.3).premultiply(m), dim(CP.brass, 0.6));
  solids.add(new THREE.BoxGeometry(0.03, 0.04, 0.03), M(0.19, FY + 0.305, -0.3).premultiply(m), 0xffc860, { aK: [4, 0, 0, 1] });

  // ---- guy ropes + stakes ----
  // Each rope runs from its tie point out along `dir` (tent-local xz) for `reach` m. If that stake would land
  // outside the full meadow (mask < 0.62), the rope swings toward the door end (`turn`) and/or shortens
  // until it does. That keeps the back stakes in the grass on the rim side.
  const toW = (v) => v.clone().applyMatrix4(m);
  const stake = (a, dir, reach, turn) => {
    const sgn = dir[0] >= 0 ? 1 : -1;
    for (let k = 0; k <= (turn ? 9 : 0); k++) {
      // rotate dir toward +z (the door end) in 10° steps
      const ang = Math.atan2(dir[1], dir[0]) + sgn * (k * 10 * Math.PI) / 180;
      const ux = Math.cos(ang), uz = Math.sin(ang);
      for (const kr of [1, 0.88, 0.76, 0.64]) {
        const B = V(a.x + ux * reach * kr, 0.1, a.z + uz * reach * kr);
        const Bw = toW(B);
        if (patchMask(Bw.x, Bw.z) >= 0.62) return B;
      }
    }
    return null;
  };
  const ropes = [[V(0, HR + T.TIP - 0.04, -hl + 0.04), [0, -1], 0.75, false]];
  for (const sg of [1, -1]) for (const zz of [1, -1]) {
    const d = new THREE.Vector2(sg * 0.47, zz * 0.32).normalize();
    ropes.push([V(sg * XE, YE, zz * hr), [d.x, d.y], 0.5, true]);
  }
  for (const sg of [1, -1]) ropes.push([V(sg * XE, YE, 0), [sg, 0], 0.53, false]);
  for (const [a, dir, reach, turn] of ropes) {
    const b = stake(a, dir, reach, turn);
    if (!b) continue;
    const A = toW(a), B = toW(b);
    ribbon(cloth, [A, B], CP.rope, [0, 0]);
    const ang = Math.atan2(A.x - B.x, A.z - B.z);
    solids.add(new THREE.BoxGeometry(0.045, 0.17, 0.045), M(B.x, 0.07, B.z, 0, ang, 0).multiply(M(0, 0, 0, -0.35, 0, 0)), CP.poleDark, { aK: [3, 0, 0, 0] });
  }

  const tipFront = toW(V(0, HR + T.TIP - 0.02, hl - 0.04));
  const tipBack = toW(V(0, HR + T.TIP - 0.02, -hl + 0.04));
  return { frame: F, tipFront, tipBack };
}
