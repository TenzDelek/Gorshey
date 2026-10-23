// Lingka picnic tent: a white cotton ridge tent with low walls, blue appliqué (scalloped valance with
// cloud scrolls and red-yellow-green edging, endless-knot lattice medallions, corner curls), a door on
// the gable end facing the fire with the flaps tied back, a dark interior with a rug and cushions,
// ridge-pole tips with brass finials, guy ropes to wooden stakes.
// Geometry is baked in world space into the shared accumulators (canvas / solids / cloth).
import * as THREE from 'three';
import { LAYOUT, patchMask } from './core.js';
import { CP, M, glc } from './camp-lib.js';

// ---- dimensions (metres, tent-local: +z toward the fire = door end, x across) -------------
export const T = {
  L: 2.5,        // wall length along the ridge
  W: 2.5,        // wall width
  HE: 1.12,      // wall / eave height
  HR: 2.36,      // ridge height
  OV: 0.12,      // roof overhang past the side walls (horizontal)
  OG: 0.1,       // roof overhang past the gables
  VH: 0.25,      // valance height
  DW: 0.86,      // door width
  DS: 1.36,      // door side height
  DH: 1.7,       // door apex
  TIP: 0.26,     // ridge-pole tip above the ridge
};
T.k = (T.HR - T.HE) / (T.W / 2);              // roof rise per metre
T.XE = T.W / 2 + T.OV;                       // eave x
T.YE = T.HE - T.OV * T.k;                    // eave y
T.S = Math.hypot(T.XE, T.HR - T.YE);         // slope length ridge -> eave
T.RL = T.L + 2 * T.OG;                       // roof length

// Placement: LAYOUT.tent sits right on the patch rim behind it, so the tent is nudged a little toward
// the fire (and to screen-left, where the patch is deeper) to keep its back inside the meadow.
// The door always faces the fire.
const NUDGE_FWD = 0.55, NUDGE_SIDE = -0.3;
export function tentFrame() {
  const [x0, z0] = LAYOUT.tent.pos;
  const ry0 = Math.atan2(-x0, -z0);
  const f0 = [Math.sin(ry0), Math.cos(ry0)], s0 = [Math.cos(ry0), -Math.sin(ry0)];
  const x = x0 + f0[0] * NUDGE_FWD + s0[0] * NUDGE_SIDE, z = z0 + f0[1] * NUDGE_FWD + s0[1] * NUDGE_SIDE;
  const ry = Math.atan2(-x, -z);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
  return { x, z, ry, m };
}

// ---- canvas shader -------------------------------------------------------------------------
// part ids (aP.x): 0 wall, 1 roof, 2 valance, 3 gable, 4 liner, 5 flap, 6 plain (vertex colour only)
export function canvasGLSL() {
  const f = (v) => v.toFixed(4);
  return /* glsl */`
    varying vec2 vUV;
    varying vec4 vP;
    // endless-knot-like woven lattice inside a diamond of half-diagonal R
    float knotM(vec2 q, float R, float w) {
      vec2 a = vec2(q.x + q.y, q.x - q.y) * 0.70710678;
      float m = max(abs(a.x), abs(a.y));
      if (m > R + w) return 0.0;
      float sp = R / 2.0;
      float lx = abs(fract(a.x / sp + 0.5) - 0.5) * sp;
      float ly = abs(fract(a.y / sp + 0.5) - 0.5) * sp;
      // loops at the four corners
      float loops = 0.0;
      vec2 aa = abs(a);
      float lr = length(vec2(max(aa.x - R, 0.0), max(aa.y - R, 0.0)));
      return max(step(min(lx, ly), w) * step(m, R + w), loops);
    }
    // endless knot: a diamond with one interlaced crossing and a loop at each corner
    float knot2M(vec2 q, float R, float w) {
      vec2 a = vec2(q.x + q.y, q.x - q.y) * 0.70710678;
      float m = max(abs(a.x), abs(a.y));
      float k = step(abs(m - R), w) + step(m, R) * (step(abs(a.x), w) + step(abs(a.y), w) + step(abs(abs(a.x) - R * 0.5), w) * step(abs(a.y), R * 0.5) + step(abs(abs(a.y) - R * 0.5), w) * step(abs(a.x), R * 0.5));
      float lr = R * 0.34, d = R * 1.414 + lr * 0.55;
      k += step(abs(length(vec2(abs(q.x) - d, q.y)) - lr), w) + step(abs(length(vec2(q.x, abs(q.y) - d)) - lr), w);
      return k;
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
      vec3 B = ${glc(CP.appBlue)};
      float blue = 0.0;
      vec3 c = base;
      if (part == 1.0) {               // roof slope: u along ridge (0..RL), v = slope distance from ridge
        float u = uv.x, s = uv.y;
        blue = step(s, 0.075) + step(abs(s - 0.14), 0.019);
        blue += step(${f(T.S)} - 0.06, s) + step(abs(s - ${f(T.S - 0.125)}), 0.019);
        blue += step(u, 0.055) + step(${f(T.RL)} - 0.055, u);
        float uc = min(u, ${f(T.RL)} - u);
        float dir = u < ${f(T.RL / 2)} ? 1.0 : -1.0;
        blue += curlM(vec2(uc - 0.36, s - ${f(T.S - 0.4)}) * vec2(1.0, 1.0), 0.23, 1.7, 0.021, dir);
        blue += curlM(vec2(uc - 0.36, s - 0.42), 0.17, 1.4, 0.021, -dir);
        blue += knot2M(vec2(u - ${f(T.RL / 2)}, s - ${f(T.S * 0.55)}), 0.24, 0.021);
      } else if (part == 2.0) {        // valance: u along eave, v down from the top
        float u = uv.x, v = uv.y;
        float t = fract(u / 0.2) - 0.5;
        float edge = ${f(T.VH)} - 0.055 + 0.055 * sqrt(max(0.0, 1.0 - 4.0 * t * t));
        if (v > edge) cut = 1.0;
        if (v < 0.034) c = ${glc(CP.edgeRed)};
        else if (v < 0.068) c = ${glc(CP.edgeYellow)};
        else if (v < 0.102) c = ${glc(CP.edgeGreen)};
        blue = step(edge - 0.058, v);
        // a running cloud scroll between the edging and the scallop border
        float t2 = fract(u / 0.4) - 0.5;
        float wave = 0.155 + 0.03 * sin(u / 0.4 * 6.2831853);
        blue += step(abs(v - wave), 0.018) * step(0.104, v);
        blue += step(length(vec2(t2 * 0.4 - 0.1, v - 0.17)), 0.028);
      } else if (part == 3.0) {        // gable: uv = (x, y) in the gable plane
        float x = uv.x, y = uv.y, ax = abs(x);
        float cosP = ${f(Math.cos(Math.atan(T.k)))};
        float rake = (${f(T.HE)} + (${f(T.W / 2)} - ax) * ${f(T.k)} - y) * cosP;   // distance below the roof line
        float along = (${f(T.W / 2)} - ax) / cosP;                                // distance up the rake
        float tt = fract(along / 0.2) - 0.5;
        float sc = 0.075 + 0.05 * sqrt(max(0.0, 1.0 - 4.0 * tt * tt));
        blue = step(rake, sc) * step(0.02, rake) + step(rake, 0.0);
        blue += step(abs(rake - sc - 0.05), 0.017) * step(y, ${f(T.HR)} - 0.3) * step(0.35, along);
        if (vP.w < 0.5) {
          // door frame
          vec2 nTop = normalize(vec2(${f(T.DH - T.DS)}, ${f(T.DW / 2)}));
          float dTop = dot(vec2(ax, y) - vec2(${f(T.DW / 2)}, ${f(T.DS)}), nTop);
          float door = max(ax - ${f(T.DW / 2)}, dTop);
          blue += step(door, 0.075) * step(0.0, door);
          // medallion above the door
          blue += knot2M(vec2(x, y - ${f((T.DH + T.HR) / 2 - 0.03)}), 0.13, 0.02);
        } else {
          // back gable: one large endless knot
          blue += knot2M(vec2(x, y - 1.15), 0.26, 0.022);
        }
        // cloud scrolls either side of the door
        blue += curlM(vec2(ax - 0.84, y - 0.5), 0.2, 1.6, 0.02, sign(x));
        // bottom band
        blue += step(y, 0.075) + step(abs(y - 0.135), 0.017) * step(${f(T.DW / 2 + 0.08)}, ax);
      } else if (part == 0.0) {        // side wall: u along, v up
        float u = uv.x, v = uv.y;
        blue = step(v, 0.075) + step(abs(v - 0.135), 0.017);
        blue += step(abs(u - ${f(T.L / 2)}), 0.05) * 0.0;
        c *= 1.0 - 0.07 * step(fract(u / 0.62 + 0.5), 0.05);   // seams between canvas widths
        blue += step(u, 0.05) + step(${f(T.L)} - 0.05, u);
      } else if (part == 4.0) {        // liner: dark interior, faint seams
        c *= 1.0 - 0.12 * step(fract(uv.x / 0.62), 0.06);
      }
      return mix(c, B, clamp(blue, 0.0, 1.0));
    }
  `;
}

export const CANVAS_FRAG = /* glsl */`
  {
    float cut = 0.0;
    float gn = gHash13(floor(vGLocal * 27.0) + 3.0);
    vec3 c = canvasMotif(diffuseColor.rgb, cut);
    if (cut > 0.5) discard;
    c *= 0.96 + 0.08 * gn;
    diffuseColor.rgb = c;
    // white cotton glows a little and bounces light: lift the faces turned from the sun (day only)
    float part = floor(vP.x + 0.5);
    vec3 nF = normalize(cross(dFdx(vGWorld), dFdy(vGWorld)));
    if (dot(nF, cameraPosition - vGWorld) < 0.0) nF = -nF;
    float sunK = clamp(dot(nF, normalize(vec3(3.2, 12.0, -4.4))), 0.0, 1.0);
    if (part != 4.0) totalEmissiveRadiance += c * vec3(0.93, 0.97, 1.06) * (0.03 + 0.17 * (1.0 - sunK)) * (1.0 - uNight);
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
  const nW = (out ?? nrm).clone().normalize().transformDirection(m);
  if (flip) nrm.negate();
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
  const { L, W, HE, HR, XE, YE, S, RL, VH, OG } = T;
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
    panel(canvas, m, [V(sg * (hw + 0.05), 0, -hl), V(sg * (hw + 0.05), 0, hl), V(sg * hw, HE, hl), V(sg * hw, HE, -hl)],
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
  for (const sg of [1, -1]) {
    const z = hl + 0.025;
    const top = V(sg * 0.02, T.DH - 0.03, z), sideTop = V(sg * (T.DW / 2 + 0.06), T.DS + 0.02, z);
    const tie = V(sg * (T.DW / 2 - 0.1), 0.74, z + 0.035), outer = V(sg * (T.DW / 2 + 0.1), 0.74, z + 0.015);
    const botIn = V(sg * (T.DW / 2 - 0.08), 0.0, z + 0.02), botOut = V(sg * (T.DW / 2 + 0.09), 0.0, z);
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
    const e = 0.055 * sg, dz = V(0, 0, 0.006).transformDirection(m).multiplyScalar(0.006);
    const E = [top, tie, botIn].map((q) => q.clone().applyMatrix4(m).add(dz));
    const E2 = [V(top.x + e * 0.9, top.y - 0.06, top.z), V(tie.x + e, tie.y, tie.z), V(botIn.x + e, 0, botIn.z)].map((q) => q.clone().applyMatrix4(m).add(dz));
    const pb = { aUV: [0, 0], aP: [6, 0, 0, 0] };
    for (let k = 0; k < 2; k++) {
      if (sg > 0) canvas.quad(E[k], E[k + 1], E2[k + 1], E2[k], CP.appBlue, pb, nW);
      else canvas.quad(E[k], E2[k], E2[k + 1], E[k + 1], CP.appBlue, pb, nW);
    }
    // tie cord
    solids.add(new THREE.BoxGeometry(0.1, 0.035, 0.03), M(sg * (T.DW / 2 - 0.02), 0.74, hl + 0.06).premultiply(m), CP.edgeRed);
  }

  // ---- solids: poles, finials, interior ----
  const wood = (geo, mm, col = CP.pole) => solids.add(geo, mm.premultiply(m), col, { aK: [3, 0, 0, 0] });
  for (const z of [hl - 0.04, -hl + 0.04]) {
    wood(new THREE.CylinderGeometry(0.032, 0.036, HR + T.TIP, 5), M(0, (HR + T.TIP) / 2, z));
    solids.add(new THREE.SphereGeometry(0.05, 6, 4), M(0, HR + T.TIP + 0.03, z).premultiply(m), CP.brass);
    solids.add(new THREE.ConeGeometry(0.03, 0.09, 5), M(0, HR + T.TIP + 0.1, z).premultiply(m), CP.brass);
  }
  // floor felt + rug + cushions + low table + butter lamp, seen through the door
  // (felt + carpets are laid thick, which also keeps the meadow grass out of sight)
  const FY = 0.16;
  const dim = (hex, k = 0.42) => new THREE.Color(hex).multiplyScalar(k).getHex();
  solids.add(new THREE.BoxGeometry(W - 0.08, FY, L - 0.08), M(0, FY / 2, 0).premultiply(m), dim(0x3a2f28), { aK: [0, 0, 0, 0] });
  solids.add(new THREE.BoxGeometry(1.7, 0.02, 1.9), M(0, FY + 0.01, 0.05).premultiply(m), dim(CP.rugRed, 0.5), (i, p, n, l) => ({ aK: [5, l.x / 1.7 + 0.5, l.z / 1.9 + 0.5, 0] }));
  for (const [x, z, w, d, col] of [[-0.55, -0.95, 1.0, 0.45, CP.cushion], [0.55, -0.95, 1.0, 0.45, CP.cushion2], [-0.98, 0.05, 0.42, 1.4, CP.rugBlue], [0.98, 0.05, 0.42, 1.4, CP.cushion]]) {
    solids.add(new THREE.BoxGeometry(w, 0.12, d), M(x, FY + 0.06, z).premultiply(m), dim(col, 0.5), { aK: [6, 0, 0, 0] });
  }
  solids.add(new THREE.BoxGeometry(0.5, 0.26, 0.32), M(0.1, FY + 0.13, -0.35).premultiply(m), dim(0x7a3a26, 0.5), { aK: [0, 0, 0, 0] });
  solids.add(new THREE.CylinderGeometry(0.03, 0.022, 0.05, 5), M(0.22, FY + 0.285, -0.35).premultiply(m), dim(CP.brass, 0.6));
  solids.add(new THREE.BoxGeometry(0.03, 0.04, 0.03), M(0.22, FY + 0.325, -0.35).premultiply(m), 0xffc860, { aK: [4, 0, 0, 1] });

  // ---- guy ropes + stakes ----
  const toW = (v) => v.clone().applyMatrix4(m);
  const ropes = [[V(0, HR + T.TIP - 0.04, -hl + 0.04), V(0, 0.1, -hl - 0.85)]];
  for (const sg of [1, -1]) for (const zz of [1, -1]) ropes.push([V(sg * XE, YE, zz * hr), V(sg * (XE + 0.55), 0.1, zz * (hr + 0.38))]);
  for (const sg of [1, -1]) ropes.push([V(sg * XE, YE, 0), V(sg * (XE + 0.62), 0.1, 0)]);
  for (const [a, b] of ropes) {
    const A = toW(a), B = toW(b);
    if (patchMask(B.x, B.z) < 0.5) continue;
    ribbon(cloth, [A, B], CP.rope, [0, 0]);
    const ang = Math.atan2(A.x - B.x, A.z - B.z);
    solids.add(new THREE.BoxGeometry(0.045, 0.17, 0.045), M(B.x, 0.07, B.z, 0, ang, 0).multiply(M(0, 0, 0, -0.35, 0, 0)), CP.poleDark, { aK: [3, 0, 0, 0] });
  }

  const tipFront = toW(V(0, HR + T.TIP - 0.02, hl - 0.04));
  const tipBack = toW(V(0, HR + T.TIP - 0.02, -hl + 0.04));
  return { frame: F, tipFront, tipBack };
}
