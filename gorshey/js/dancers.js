// Dancers: twelve people in festival dress circling the fire in gorshey, men in one arc, women in the other.
// Each person is ONE skinned mesh (see dancers-rig.js → makePerson, documented there; re-exported here for life.js).
// Choreography (dancers-dance.js): A B A C | A D A C over the 48 s loop, one revolution per loop, planted feet (IK),
// sleeves lag the wrist by 1/8 beat and whip on the flicks, the men's empty right sleeve swings at the hip.
//
// Feet: a planted foot stays put; when the leg runs out of reach its heel rises, pivoting on the sole's toe edge.
// A swing starts from that pivot: the toe stays pinned while the heel keeps peeling up (toe-off, first 30 %), then
// the TOE travels on an arc to the next footprint (so it always clears the ground) while the foot flattens out.
// The pelvis is lowered (smooth-min) only as far as the legs need, anticipating the landing reach.
export const DIR = 1; // 1 = clockwise seen from above, -1 = counterclockwise
import * as THREE from 'three';
import { PAL, PANGDEN, LAYOUT, BEAT, TAU, clamp, smooth, lerp } from './core.js';
import { makePerson, mix } from './dancers-rig.js';
import { buildPlan, evalFoot, bodyLift, dipAt, NB, SEQ } from './dancers-dance.js';
export { makePerson, personDims } from './dancers-rig.js';

// ---- palette (muted, naturalistic; see ref/gorshey-culture.json) -------------------------------------
// The dark chubas sit one value step above the shadows so shoulders and sleeve tops keep a lit band at 1x.
const C = {
  black: 0x3a3340, maroon: 0x7e2a32, navy: 0x2e4166, bronze: 0x8a6844, forest: 0x3a5a47, slate: 0x56616f, brownM: 0x6a4630, greyM: 0x6e6c72,
  pink: 0xe3a0b2, sky: 0x9ec4e0, gold: 0xe2bf62, cream: 0xe9dfc8, lime: 0xbfd07e, magenta: 0xb85582, lilac: 0xb9a6d4,
  shirtW: 0xf0ece2, shirtY: 0xe4be5c, shirtB: 0xaecbe2,
  sashRed: 0xa8302c, sashGold: 0xc89a3a, sashOrange: 0xc4682e, sashGreen: 0x3d7a52, sashMaroon: 0x7e2a2e,
  brocade: 0xc6a24a, lamb: 0xe6dcc6, otter: 0x4b3a2a,
  hair: 0x1d1917, grey: 0x9a958e, greyDark: 0x6f6b66,
  coral: 0xcc5640, turq: 0x3fb0a6, amber: 0xd4952e, silver: 0xc2c4c6,
};
const mute = (arr, k = 0.24) => arr.map((h) => mix(h, 0x8a8478, k));
const PG_FINE = [0x8e3a3a, 0x9a6a3a, 0x6a6a4a, 0x3e5a6a, 0x7a3a4a, 0xa08a5a];     // elder: fine stripes in related shades
const PG_NAVY = [0xc8322b, 0xe8e2d0, 0x5aa9e6, 0xf1c232, 0x2f8a4a, 0x151515, 0xe86a1c];

// Ring order (clockwise from theta0). Men in one arc, women in the other; ages mixed.
// No man wears maroon with yellow or saffron (reads as monastic): the Khampa has a white shirt and a green sash.
const CAST = [
  // ---- men
  { name: 'exile', sex: 'm', height: 1.7, chuba: C.slate, trim: C.brocade, shirt: C.shirtW, sash: C.sashRed, hairStyle: 'short', jewel: [undefined, C.turq] },
  { name: 'khampa', sex: 'm', height: 1.75, build: 1.06, chuba: C.maroon, trim: C.lamb, lining: C.lamb, hemBand: C.otter, shirt: C.shirtW, sash: C.sashGreen, hairStyle: 'tassels', skin: PAL.skinDeep, jewel: [C.coral, C.turq, C.turq] },
  { name: 'boy', sex: 'm', age: 'child', height: 1.25, chuba: C.brownM, trim: C.brocade, shirt: C.shirtB, sash: C.sashOrange, hairStyle: 'short', delay: 0.15, armDelay: 0.06 },
  { name: 'pala', sex: 'm', age: 'elder', height: 1.64, chuba: C.greyM, trim: 0x8a7a5a, shirt: C.cream, sash: C.sashMaroon, hat: 'fedora', hatColor: 0x664f3c, hair: C.grey, skin: PAL.skinDeep, jewel: [C.coral] },
  { name: 'furhat', sex: 'm', height: 1.72, chuba: C.black, trim: C.brocade, shirt: C.shirtW, sash: C.sashGreen, hat: 'brocade', fur: 0xa8683a, jewel: [undefined, C.coral] },
  { name: 'fedora', sex: 'm', height: 1.68, chuba: C.bronze, trim: C.brocade, shirt: C.shirtB, sash: C.sashRed, hat: 'fedora', hatColor: 0x4e4036, hatBand: 0x7a2a26 },
  // ---- women
  { name: 'dolma', sex: 'f', height: 1.6, chuba: C.maroon, blouse: C.sky, sash: C.sashGold, pangden: mute(PANGDEN[0]), jewel: [C.turq, C.coral, C.turq] },
  { name: 'amala', sex: 'f', age: 'elder', height: 1.52, chuba: C.black, blouse: C.cream, sash: C.sashMaroon, pangden: PG_FINE, hair: C.grey, yarn: 0x7a2a2a, skin: PAL.skinDeep, jewel: [C.coral, C.turq] },
  { name: 'yangchen', sex: 'f', height: 1.62, chuba: C.bronze, trim: C.brocade, blouse: C.lilac, sash: C.sashRed, pangden: mute(PANGDEN[2]), jewel: [C.amber, C.coral, C.coral] },
  { name: 'pema', sex: 'f', age: 'teen', height: 1.5, chuba: C.forest, blouse: C.pink, sash: C.sashRed, hairStyle: 'braid', pangden: null, jewel: [undefined, C.turq] },
  { name: 'tsering', sex: 'f', height: 1.57, chuba: C.black, blouse: C.gold, sash: C.sashGreen, pangden: mute(PANGDEN[1]), jewel: [C.turq, C.coral, C.coral] },
  { name: 'kunsang', sex: 'f', height: 1.55, chuba: C.navy, blouse: C.lime, sash: C.sashMaroon, pangden: mute(PG_NAVY), jewel: [C.coral, C.turq] },
];

// movement style per dancer type
function styleFor(spec, i) {
  const m = spec.sex === 'm', elder = spec.age === 'elder', child = spec.age === 'child';
  const st = m
    ? { stance: 0.21, lift: 0.09, liftTap: 0.15, hop: 0.06, hopBody: 0.055, bounce: 0.045, back: 0.3, amp: 1.0, wide: 1.18, wideD: 1.0, cap: 2.9, lean: 0.12, twist: 1.2, wrist: 1.0 }
    : { stance: 0.165, lift: 0.06, liftTap: 0.105, hop: 0.04, hopBody: 0.04, bounce: 0.032, back: 0.26, amp: 0.88, wide: 1.0, wideD: 1.0, cap: 1.42, lean: 0.06, twist: 0.9, wrist: 1.15 };
  if (elder) Object.assign(st, { lift: 0.05, liftTap: 0.07, hop: 0.025, hopBody: 0.02, bounce: 0.022, amp: 0.6, wide: 1.0, wideD: 1.0, lean: st.lean + 0.1, stoop: 0.16, twist: 0.6 });
  // the child trots: two steps per beat in A and D (dancers-dance.js), stride ≈ 0.46 × leg
  if (child) Object.assign(st, { stance: 0.17, lift: 0.07, liftTap: 0.12, hop: 0.04, hopBody: 0.035, bounce: 0.03, back: 0.16, amp: 1.0, dbl: true });
  if (spec.age === 'teen') Object.assign(st, { amp: 0.95, wrist: 1.25 });
  st.long = !m;          // long blouse sleeves
  st.kC = 0.5; st.kD = 0.85;
  // constant per-dancer variation (keeps the loop periodic)
  const j = (k) => Math.sin(i * 12.9898 + k * 78.233) * 0.5;
  st.amp *= 1 + j(1) * 0.16;
  st.bounce *= 1 + j(2) * 0.3;
  st.delay = spec.delay ?? j(3) * 0.09;
  st.armDelay = spec.armDelay ?? 0.03 + (j(4) + 0.5) * 0.05;
  st.stoop = st.stoop ?? 0;
  return st;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const KT = 0.3;           // toe-off share of a swing (toe pinned, heel peeling up)
const K_SMIN = 0.04;      // pelvis smooth-min softness (m)
const smin = (a, c) => Math.min(a, c) - K_SMIN * Math.log(1 + Math.exp(-Math.abs(a - c) / K_SMIN));
const PHI_MAX = 0.9;      // steepest heel-up pivot (rad)

export function build(ctx) {
  const group = new THREE.Group();
  group.name = 'dancers';
  // test overrides (ctx.params): ?dir=-1 flips the direction; ?lineup=1 stands everyone in a row facing the
  // camera (pose still animated, the C turn included), ?lineupAz=deg turns the row
  const QS = ctx.params ?? new URLSearchParams('');
  const DIRV = QS.get('dir') === '-1' ? -1 : QS.get('dir') === '1' ? 1 : DIR;
  const LINEUP = QS.get('lineup') === '1' ? THREE.MathUtils.degToRad(+(QS.get('lineupAz') ?? 0) || 0) : null;
  const R = LAYOUT.circle.r;
  const N = Math.min(LAYOUT.circle.count, CAST.length);
  const lead = DIRV === 1 ? 'L' : 'R', trail = DIRV === 1 ? 'R' : 'L';

  const dancers = [];
  for (let i = 0; i < N; i++) {
    const spec = CAST[i];
    const rig = makePerson(spec);
    const st = styleFor(spec, i);
    const plan = buildPlan(st, R);
    const theta0 = (i / N) * TAU + 0.35 + Math.sin(i * 3.7) * 0.006;   // slightly uneven spacing (±1.5 cm; the ring is only 1.3 m per dancer)
    group.add(rig.root);
    dancers.push({ spec, rig, st, plan, theta0, D: rig.dims, i });
  }

  // ---- helpers -----------------------------------------------------------------------
  const ringToWorld = (d, s, u, out) => {
    const th = d.theta0 + DIRV * s / R, r = R - u;
    out.x = r * Math.cos(th); out.z = r * Math.sin(th); out.th = th;
    return out;
  };
  const yawAt = (th, psi) => {
    // facing = sin(psi) * e_s + cos(psi) * e_u, e_s = DIR * (-sin th, cos th), e_u = (-cos th, -sin th)
    const fx = Math.sin(psi) * DIRV * -Math.sin(th) + Math.cos(psi) * -Math.cos(th);
    const fz = Math.sin(psi) * DIRV * Math.cos(th) + Math.cos(psi) * -Math.sin(th);
    return Math.atan2(fx, fz);
  };
  const wrapB = (x) => ((x % NB) + NB) % NB;
  const bodyAt = (d, xb, out) => {
    const b = d.plan.bodyTrack.eval(xb, out.v ?? (out.v = [0, 0, 0]));
    ringToWorld(d, b[0], b[1], out);
    out.yaw = yawAt(out.th, b[2]);
    out.psi = b[2];
    return out;
  };
  // which phrase / beat-in-phrase
  const phraseOf = (xb) => { const x = wrapB(xb); const ph = Math.floor(x / 8); return { ph, type: SEQ[ph], lb: x - ph * 8 }; };
  // facing relative to the fire, folded to [-1, 1] and released during the C turn (chest/head counter-turn)
  const tmpBody = [0, 0, 0];
  const relTurn = (d, xb) => {
    const ph = phraseOf(xb);
    const bt = d.plan.bodyTrack.eval(xb, tmpBody);
    const rel = bt[2] - TAU * Math.round(bt[2] / TAU);
    const turnWin = ph.type === 'C' ? smooth(3.1, 3.7, ph.lb) * (1 - smooth(6.7, 7.3, ph.lb)) : 0;
    return clamp(rel, -1, 1) * (1 - turnWin);
  };
  const armAt = (d, xb, out) => d.plan.armTrack.eval(xb - d.st.armDelay / BEAT, out);

  // upper-body pose at beat xb (torso + arms), in the rig's physical L/R terms
  const armBuf = new Array(14).fill(0);
  function upperPose(d, xb, p) {
    const st = d.st;
    const a = armAt(d, xb, armBuf);
    const up = clamp(a[12]);
    const cap = lerp(st.cap, 2.95, up);
    const wide = lerp(st.wide, st.wideD, clamp(a[13]));
    const arm = (o, out) => {
      let e = 0.2 + (a[o] - 0.2) * st.amp;
      let az = a[o + 1];
      if (wide !== 1) { e *= 1 + (wide - 1) * smooth(0.6, 1.4, e); az *= 1 + (wide - 1) * 0.4; }
      e = Math.min(e, cap);
      out.e = e; out.az = az; out.el = a[o + 2]; out.wr = a[o + 3] * st.wrist;
      return out;
    };
    p.armL = p.armL ?? {}; p.armR = p.armR ?? {};
    arm(0, lead === 'L' ? p.armL : p.armR);
    arm(4, lead === 'L' ? p.armR : p.armL);
    // turn the chest/head back toward the fire while walking turned toward the line of travel
    const rel = relTurn(d, xb);
    const tw = a[8] * st.twist, lk = a[9], ln = a[10], hd = a[11];
    p.hips = p.hips ?? {};
    p.hips.pitch = st.lean * 0.3; p.hips.yaw = DIRV * (tw * 0.25 - rel * 0.15); p.hips.roll = 0;
    p.spine = { pitch: st.lean * 0.4 + st.stoop * 0.6 + ln * 0.5, yaw: DIRV * (tw * 0.35 - rel * 0.2), roll: -DIRV * tw * 0.12 };
    p.chest = { pitch: st.lean * 0.4 + st.stoop * 0.5 + ln * 0.5, yaw: DIRV * (tw * 0.4 - rel * 0.22), roll: -DIRV * tw * 0.15 };
    p.neck = { pitch: -st.stoop * 0.4, yaw: 0, roll: 0 };
    p.head = { pitch: hd - st.stoop * 0.5 - st.lean * 0.4, yaw: DIRV * (lk * 0.8 - rel * 0.2), roll: DIRV * lk * 0.1 };
    return p;
  }

  // ---- body frames and leg reach --------------------------------------------------------------
  // a frame = root transform, pelvis rotation and unlowered pelvis height at one beat
  const tE = new THREE.Euler();
  const armBuf2 = new Array(14).fill(0);
  const mkFrame = () => ({ b: {}, q: new THREE.Quaternion(), hipY: 0 });
  function frameAt(d, xb, fr) {
    bodyAt(d, xb, fr.b);
    const tw = armAt(d, xb, armBuf2)[8] * d.st.twist;
    fr.q.setFromEuler(tE.set(d.st.lean * 0.3, DIRV * (tw * 0.25 - relTurn(d, xb) * 0.15), 0, 'YXZ'));
    fr.hipY = d.D.hipsY + bodyLift(d.plan, xb, d.st);
    return fr;
  }
  // root-local hip joint of the physical side S for frame fr, relative to the hips bone
  const hipOff = (D, fr, S, out) => out.set((S === 'L' ? 1 : -1) * D.hipX, D.hipJ - D.hipsY, 0).applyQuaternion(fr.q);
  // world → root-local
  const toLocal = (fr, wx, wy, wz, out) => {
    const c = Math.cos(fr.b.yaw), s = Math.sin(fr.b.yaw), dx = wx - fr.b.x, dz = wz - fr.b.z;
    return out.set(dx * c - dz * s, wy, dx * s + dz * c);
  };
  // a footprint in world space: flat-ankle ground point (x, z) and world yaw
  const footW = (d, s, u, psi, out) => { ringToWorld(d, s, u, out); out.wy = yawAt(out.th, psi); return out; };
  // ankle (world) for a foot whose toe edge is at (tx, ty, tz), yaw wy, heel-up pitch p
  const ankleFromToe = (D, tx, ty, tz, wy, p, out) => {
    const r = D.toeZ * Math.cos(p) - D.ankle * Math.sin(p);
    return out.set(tx - Math.sin(wy) * r, ty + D.toeZ * Math.sin(p) + D.ankle * Math.cos(p), tz - Math.cos(wy) * r);
  };
  const LEG = (D) => (D.thigh + D.shin) * 0.985;
  const tv = Array.from({ length: 8 }, () => new THREE.Vector3());
  // heel-up pivot (rad) a planted footprint fw needs at frame fr so the leg reaches (0 if it already does).
  // Only a foot behind the hip (body facing) pivots; a foot in front is reached by lowering the pelvis instead.
  function pivotPhi(d, fr, fw, S) {
    const D = d.D;
    const J = hipOff(D, fr, S, tv[0]); J.y += fr.hipY;
    const want = LEG(D) * 0.965;
    const tx = fw.x + Math.sin(fw.wy) * D.toeZ, tz = fw.z + Math.cos(fw.wy) * D.toeZ;
    const A = tv[1], T = tv[2];
    const dist = (p) => { ankleFromToe(D, tx, 0, tz, fw.wy, p, A); toLocal(fr, A.x, A.y, A.z, T); return T.distanceTo(J); };
    if (dist(0) <= want) return 0;
    // how far behind the hip the foot is, along the body's facing
    toLocal(fr, fw.x, 0, fw.z, T);
    const cap = PHI_MAX * smooth(-0.1, 0.04, J.z - T.z);
    if (cap < 1e-3) return 0;
    if (dist(cap) > want) return cap;
    let lo = 0, hi = cap;
    for (let it = 0; it < 18; it++) { const mid = (lo + hi) / 2; if (dist(mid) > want) lo = mid; else hi = mid; }
    return hi;
  }
  // pelvis-height limit for one leg: highest hips y at which the root-local ankle A is within reach
  function hipLimit(D, fr, S, A) {
    const o = hipOff(D, fr, S, tv[3]);
    const L = LEG(D);
    const hd2 = (A.x - o.x) ** 2 + (A.z - o.z) ** 2;
    return A.y + Math.sqrt(Math.max(1e-4, L * L - hd2)) - o.y;
  }

  // ---- one foot at the current frame -------------------------------------------------------
  const frNow = mkFrame(), frT = mkFrame(), frDn = mkFrame();
  const fw0 = {}, fw1 = {}, fwm = {}, footOut = {};
  const toeArc = (u, pk) => (u < pk ? Math.sin(0.5 * Math.PI * u / pk) : 1 - ((u - pk) / (1 - pk)) ** 2);
  // ankle (world) of footprint fw with its toe edge at height ty and heel-up pitch p
  const ankleOn = (D, fw, ty, p, out) => ankleFromToe(D, fw.x + Math.sin(fw.wy) * D.toeZ, ty, fw.z + Math.cos(fw.wy) * D.toeZ, fw.wy, p, out);
  // fills leg = { ankle (root-local), yaw, pitch, planted, k (swing 0..1), limFly (pelvis limit in flight, or null) }
  function footPose(d, f, side, xb, leg) {
    const D = d.D;
    const fo = evalFoot(d.plan, f, xb, footOut);
    footW(d, fo.s0, fo.u0, fo.yaw0, fw0);
    const A = tv[4];
    leg.planted = fo.swing < 0;
    leg.limFly = null;
    let wy = fw0.wy, p;
    if (fo.swing < 0) {
      // planted: flat, or heel up pivoting on the toe edge
      p = pivotPhi(d, frNow, fw0, side);
      ankleOn(D, fw0, 0, p, A);
    } else {
      const k = leg.k = fo.swing;
      footW(d, fo.s1, fo.u1, fo.yaw1, fw1);
      const tDn = fo.tDn, tT = fo.tUp + KT * (tDn - fo.tUp);
      const pOff = fo.kind === 'step' ? 0.55 : 0.4;
      if (k < KT) {
        // toe-off: toe pinned on the take-off footprint, the heel keeps rising (continuous with the planted pivot)
        p = Math.max(pivotPhi(d, frNow, fw0, side), pOff * smooth(0, KT, k));
        ankleOn(D, fw0, 0, p, A);
      } else {
        // the toe flies on an arc from the take-off toe to the landing toe while the foot flattens
        const u = (k - KT) / (1 - KT);
        frameAt(d, tT, frT); frameAt(d, tDn, frDn);
        const pT = Math.max(pivotPhi(d, frT, fw0, side), pOff);
        const pL = pivotPhi(d, frDn, fw1, side);
        // In flight the pelvis follows a smooth blend of the reach at take-off and at landing (each taken at its own
        // moment), not the fast-moving ankle: no pop when the foot leaves, no drop as it reaches for the landing.
        const AT = tv[5];
        ankleOn(D, fw0, 0, pT, AT);
        const limT = hipLimit(D, frT, side, toLocal(frT, AT.x, AT.y, AT.z, tv[6]));
        ankleOn(D, fw1, 0, pL, AT);
        const limL = hipLimit(D, frDn, side, toLocal(frDn, AT.x, AT.y, AT.z, tv[6]));
        leg.limFly = lerp(limT, limL, smooth(0, 1, u));
        const hp = smooth(0.12, 0.8, u);          // lift the toe clear first, then travel (and turn)
        footW(d, lerp(fo.s0, fo.s1, hp), lerp(fo.u0, fo.u1, hp), lerp(fo.yaw0, fo.yaw1, hp), fwm);
        wy = fwm.wy;
        p = lerp(pT, pL, smooth(0, 0.75, u));
        if (fo.kind === 'hop') p += 0.12 * Math.sin(Math.PI * u);           // pointed toe in the skip
        // toe clearance >= 1.5 cm through the middle of every swing (the lowest lift is 3 cm)
        ankleOn(D, fwm, Math.max(0.03, fo.lift * 0.85) * toeArc(u, fo.peak), p, A);
      }
    }
    // never below the ground (sole edge points)
    const lowest = A.y - D.ankle * Math.cos(p) - Math.max(D.toeZ * Math.sin(p), D.heelZ * Math.sin(p));
    if (lowest < 0) A.y -= lowest;
    toLocal(frNow, A.x, A.y, A.z, leg.ankle);
    leg.yaw = wy - frNow.b.yaw;
    leg.pitch = p;
    return leg;
  }

  // ---- sleeves, braids and the hanging sleeve ------------------------------------------------
  const lagP = Array.from({ length: 4 }, () => ({}));
  const lagB = Array.from({ length: 4 }, () => ({}));
  const qY = new THREE.Quaternion(), AY = new THREE.Vector3(0, 1, 0);
  const dl = Array.from({ length: 4 }, () => new THREE.Vector3());
  const sl1 = [new THREE.Vector3(), new THREE.Vector3()], sl2 = [new THREE.Vector3(), new THREE.Vector3()];
  const hang = [new THREE.Vector3(), new THREE.Vector3()];
  const brL = [new THREE.Vector3(), new THREE.Vector3()], brR = [new THREE.Vector3(), new THREE.Vector3()];
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const pts = Array.from({ length: 3 }, () => new THREE.Vector3());
  const LAG = 0.125; // beats
  const tmpW = {};

  // a point fixed on the body (root-local, ignoring torso bend) in world space at beat xb
  const bodyPoint = (d, xb, lx, ly, lz, out) => {
    const b = bodyAt(d, xb, tmpW);
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    return out.set(b.x + lx * c + lz * s, ly, b.z - lx * s + lz * c);
  };
  // trailing directions of a hanging chain attached at a body point
  const trail2 = (d, xb, lp, lags, gain, out) => {
    bodyPoint(d, xb, lp[0], lp[1], lp[2], pts[0]);
    for (let k = 0; k < 2; k++) {
      bodyPoint(d, xb - lags[k], lp[0], lp[1], lp[2], pts[1]);
      out[k].subVectors(pts[1], pts[0]).multiplyScalar(gain);
      out[k].y = Math.min(out[k].y, 0.05);
      out[k].add(v3.set(0, -0.32, 0)).normalize();
    }
    return out;
  };

  const legs = { L: null, R: null };
  function poseDancer(d, t) {
    const st = d.st, rig = d.rig, D = d.D;
    const xb = wrapB((t - st.delay) / BEAT);
    // body
    frameAt(d, xb, frNow);
    const b = frNow.b;
    rig.root.position.set(b.x, 0, b.z);
    rig.root.rotation.set(0, b.yaw, 0);
    const p = d.p ?? (d.p = {});
    upperPose(d, xb, p);
    // feet
    for (const f of ['L', 'T']) {
      const side = f === 'L' ? lead : trail;
      const leg = p['leg' + side] ?? (p['leg' + side] = { ankle: new THREE.Vector3() });
      footPose(d, f, side, xb, leg);
      legs[side] = leg;
    }
    // pelvis: as high as the bounce wants, as low as the legs need (smooth min, so it never snaps)
    let hipY = frNow.hipY;
    const dbg = ctx.debug ? (d.dbg ??= {}) : null;
    if (dbg) dbg.hip0 = hipY;
    for (const side of ['L', 'R']) {
      const leg = legs[side];
      let lim = hipLimit(D, frNow, side, leg.ankle);
      if (dbg) { dbg['act' + side] = lim; dbg['k' + side] = leg.planted ? -1 : leg.k; dbg['p' + side] = leg.pitch; }
      if (leg.limFly !== null) lim = leg.limFly;
      if (dbg) dbg['lim' + side] = lim;
      hipY = smin(hipY, lim);
    }
    // the child never sinks below 85 % of his standing hips (except the deliberate stamp dip on C 8)
    if (D.child) hipY = Math.max(hipY, 0.85 * D.hipsY - dipAt(d.plan, xb, st));
    p.hips.y = hipY;
    p.hips.x = 0; p.hips.z = 0;
    p.hips.roll = 0;

    // sleeves: sample the arm motion 1, 2, 3 lags back (pure functions of t, so still periodic)
    const sleeveSides = D.m ? ['L'] : ['L', 'R'];
    for (let k = 1; k <= 3; k++) {
      const xk = xb - LAG * k;
      upperPose(d, xk, lagP[k]);
      bodyAt(d, xk, lagB[k]);
    }
    for (const S of sleeveSides) {
      for (let k = 1; k <= 3; k++) {
        qY.setFromAxisAngle(AY, lagB[k].yaw);
        rig.handDirWorld(lagP[k], S, qY, dl[k]);
      }
      const out = S === 'L' ? sl1 : sl2;
      // cloth: the near half follows the wrist a lag late and droops; the tip lags further and hangs heavier
      out[0].copy(dl[1]).addScaledVector(v1.subVectors(dl[1], dl[2]), 0.7).addScaledVector(DOWN, 0.6).normalize();
      out[1].copy(dl[2]).lerp(dl[3], 0.35).addScaledVector(v1.subVectors(dl[2], dl[3]), 1.0).addScaledVector(DOWN, 1.5).normalize();
      p['sleeve' + S] = out;
    }
    if (D.m) p.sleeveR = null;
    // the men's empty right sleeve and the women's braids trail behind the body's motion
    if (D.m) {
      const H = D.hang;
      p.hang = trail2(d, xb, [H.x, H.y, H.z], [0.22, 0.45], 1.1, hang);
      // keep it just off the skirt: a little out to the right side and back
      v1.set(-Math.cos(b.yaw), 0, Math.sin(b.yaw));
      v2.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
      for (const v of hang) v.addScaledVector(v1, 0.05).addScaledVector(v2, 0.08).normalize();
    }
    else p.hang = null;
    const nape = [0, D.headBase + 0.05, -D.headD / 2 - 0.05];
    if (!D.m) {
      p.braidL = trail2(d, xb, [0.05, nape[1], nape[2]], [0.15, 0.32], 0.9, brL);
      p.braidR = trail2(d, xb, [-0.05, nape[1], nape[2]], [0.15, 0.32], 0.9, brR);
      // braids hang over the back: keep them behind the body
      for (const arr of [brL, brR]) for (const v of arr) { v1.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw)); v.addScaledVector(v1, 0.12).normalize(); }
    }
    if (LINEUP !== null) {
      // stand in a row across the view, facing the default camera (+x,+z), rotated by lineupAz, plus the
      // dancer's turn within the phrase (so the C three-step turn shows)
      const k = (d.i - (dancers.length - 1) / 2) * 0.62;
      const ph = phraseOf(xb);
      const yaw = Math.PI / 4 + LINEUP + (b.psi - d.plan.phrasePsi[ph.ph]);
      rig.root.position.set(k * Math.SQRT1_2, 0, -k * Math.SQRT1_2);
      rig.root.rotation.set(0, yaw, 0);
      qY.setFromAxisAngle(AY, yaw - b.yaw);
      for (const arr of [p.sleeveL, p.sleeveR, p.hang, p.braidL, p.braidR]) if (arr) for (const v of arr) v.applyQuaternion(qY);
    }
    rig.pose(p);
    if (ctx.debug && d.dbg) {
      // IK error: how far each foot bone ended up from its ankle target (cm)
      for (const side of ['L', 'R']) {
        rig.bones['foot' + side].getWorldPosition(v1);
        v2.copy(legs[side].ankle).applyMatrix4(rig.root.matrixWorld);
        d.dbg['ik' + side] = v1.distanceTo(v2) * 100;
      }
    }
  }

  function update(t) {
    for (const d of dancers) poseDancer(d, t);
  }
  update(0);
  ctx.expose?.('dancers', dancers);
  return { group, update };
}
