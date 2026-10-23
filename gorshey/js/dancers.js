// Dancers: twelve people in festival dress circling the fire in gorshey, men in one arc, women in the other.
// Each person is ONE skinned mesh (see dancers-rig.js → makePerson, documented there; re-exported here for life.js).
// Choreography (dancers-dance.js): A B A C | A D A C over the 48 s loop, one revolution per loop, planted feet (IK),
// sleeves lag the wrist by 1/8 beat and whip on the flicks, the men's empty right sleeve swings at the hip.
export const DIR = 1; // 1 = clockwise seen from above, -1 = counterclockwise
import * as THREE from 'three';
import { PAL, PANGDEN, LAYOUT, BEAT, LOOP, TAU, clamp, smooth, lerp } from './core.js';
import { makePerson, personDims, shade, mix } from './dancers-rig.js';
import { buildPlan, evalFoot, bodyLift, NB, SEQ } from './dancers-dance.js';
export { makePerson, personDims } from './dancers-rig.js';

// test override: ?dir=-1 flips the direction without editing the file
const QS = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } })();
const DIRV = QS.get('dir') === '-1' ? -1 : QS.get('dir') === '1' ? 1 : DIR;
// debug: ?lineup=1 stands everyone in a row facing the camera (pose still animated), ?lineupAz=deg turns them
const LINEUP = QS.get('lineup') === '1' ? THREE.MathUtils.degToRad(+(QS.get('lineupAz') ?? 0)) : null;

// ---- palette (muted, naturalistic; see ref/gorshey-culture.json) -------------------------------------
const C = {
  black: 0x24212a, maroon: 0x6a2129, navy: 0x253553, bronze: 0x7a5b3a, forest: 0x2f4a3a, slate: 0x46515e, brownM: 0x5a3b2a, greyM: 0x5f5d62,
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
const CAST = [
  // ---- men
  { name: 'exile', sex: 'm', height: 1.7, chuba: C.slate, trim: C.brocade, shirt: C.shirtW, sash: C.sashRed, hairStyle: 'short', jewel: [undefined, C.turq] },
  { name: 'khampa', sex: 'm', height: 1.75, build: 1.06, chuba: C.maroon, trim: C.lamb, lining: C.lamb, hemBand: C.otter, shirt: C.shirtY, sash: C.sashGold, hairStyle: 'tassels', skin: PAL.skinDeep, jewel: [C.coral, C.turq, C.turq] },
  { name: 'boy', sex: 'm', age: 'child', height: 1.25, chuba: C.brownM, trim: C.brocade, shirt: C.shirtB, sash: C.sashOrange, hairStyle: 'short', delay: 0.15, armDelay: 0.06 },
  { name: 'pala', sex: 'm', age: 'elder', height: 1.64, chuba: C.greyM, trim: 0x8a7a5a, shirt: C.cream, sash: C.sashMaroon, hat: 'fedora', hatColor: 0x5b4636, hair: C.grey, skin: PAL.skinDeep, jewel: [C.coral] },
  { name: 'furhat', sex: 'm', height: 1.72, chuba: C.black, trim: C.brocade, shirt: C.shirtW, sash: C.sashGreen, hat: 'brocade', fur: 0xa8683a, jewel: [undefined, C.coral] },
  { name: 'fedora', sex: 'm', height: 1.68, chuba: C.bronze, trim: C.brocade, shirt: C.shirtB, sash: C.sashRed, hat: 'fedora', hatColor: 0x3f342c, hatBand: 0x7a2a26 },
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
    ? { stance: 0.23, lift: 0.09, liftTap: 0.15, hop: 0.06, hopBody: 0.055, bounce: 0.045, back: 0.3, amp: 1.0, wide: 1.18, cap: 2.9, lean: 0.12, twist: 1.2, wrist: 1.0 }
    : { stance: 0.19, lift: 0.06, liftTap: 0.105, hop: 0.04, hopBody: 0.04, bounce: 0.032, back: 0.26, amp: 0.88, wide: 1.0, cap: 1.42, lean: 0.06, twist: 0.9, wrist: 1.15 };
  if (elder) Object.assign(st, { lift: 0.05, liftTap: 0.07, hop: 0.025, hopBody: 0.02, bounce: 0.022, amp: 0.6, wide: 1.0, lean: st.lean + 0.1, stoop: 0.16, twist: 0.6 });
  if (child) Object.assign(st, { stance: 0.17, lift: 0.08, liftTap: 0.13, hop: 0.06, hopBody: 0.06, bounce: 0.04, back: 0.22, amp: 1.1 });
  if (spec.age === 'teen') Object.assign(st, { amp: 0.95, wrist: 1.25 });
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

export function build(ctx) {
  const group = new THREE.Group();
  group.name = 'dancers';
  const R = LAYOUT.circle.r;
  const N = Math.min(LAYOUT.circle.count, CAST.length);
  const lead = DIRV === 1 ? 'L' : 'R', trail = DIRV === 1 ? 'R' : 'L';

  const dancers = [];
  for (let i = 0; i < N; i++) {
    const spec = CAST[i];
    const rig = makePerson(spec);
    const st = styleFor(spec, i);
    const plan = buildPlan(st, R);
    const theta0 = (i / N) * TAU + 0.35 + Math.sin(i * 3.7) * 0.03;
    group.add(rig.root);
    dancers.push({ spec, rig, st, plan, theta0, D: rig.dims });
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
  const tmpW = {}, tmpF = {}, footOut = {};
  const bodyAt = (d, xb, out) => {
    const b = d.plan.bodyTrack.eval(xb, out.v ?? (out.v = [0, 0, 0]));
    ringToWorld(d, b[0], b[1], out);
    out.yaw = yawAt(out.th, b[2]);
    out.psi = b[2];
    return out;
  };
  // which phrase / beat-in-phrase
  const phraseOf = (xb) => { const x = wrapB(xb); const ph = Math.floor(x / 8); return { type: SEQ[ph], lb: x - ph * 8 }; };

  // upper-body pose at beat xb (torso + arms), in the rig's physical L/R terms
  function upperPose(d, xb, p) {
    const st = d.st;
    const a = d.plan.armTrack.eval(xb - st.armDelay / BEAT);
    const up = clamp(a[12]);
    const cap = lerp(st.cap, 2.95, up);
    const arm = (o, out) => {
      let e = 0.2 + (a[o] - 0.2) * st.amp;
      let az = a[o + 1];
      if (st.wide !== 1) { e *= 1 + (st.wide - 1) * smooth(0.6, 1.4, e); az *= 1 + (st.wide - 1) * 0.4; }
      e = Math.min(e, cap);
      out.e = e; out.az = az; out.el = a[o + 2]; out.wr = a[o + 3] * st.wrist;
      return out;
    };
    p.armL = p.armL ?? {}; p.armR = p.armR ?? {};
    arm(0, lead === 'L' ? p.armL : p.armR);
    arm(4, lead === 'L' ? p.armR : p.armL);
    // turn the chest/head back toward the fire while walking turned toward the line of travel
    const ph = phraseOf(xb);
    const bt = d.plan.bodyTrack.eval(xb, tmpBody);
    let rel = bt[2] - TAU * Math.round(bt[2] / TAU);
    const turnWin = ph.type === 'C' ? smooth(3.1, 3.7, ph.lb) * (1 - smooth(6.7, 7.3, ph.lb)) : 0;
    rel = clamp(rel, -1, 1) * (1 - turnWin);
    const tw = a[8] * st.twist, lk = a[9], ln = a[10], hd = a[11];
    p.hips = p.hips ?? {};
    p.hips.pitch = st.lean * 0.3; p.hips.yaw = DIRV * (tw * 0.25 - rel * 0.15); p.hips.roll = 0;
    p.spine = { pitch: st.lean * 0.4 + st.stoop * 0.6 + ln * 0.5, yaw: DIRV * (tw * 0.35 - rel * 0.2), roll: -DIRV * tw * 0.12 };
    p.chest = { pitch: st.lean * 0.4 + st.stoop * 0.5 + ln * 0.5, yaw: DIRV * (tw * 0.4 - rel * 0.22), roll: -DIRV * tw * 0.15 };
    p.neck = { pitch: -st.stoop * 0.4, yaw: 0, roll: 0 };
    p.head = { pitch: hd - st.stoop * 0.5 - st.lean * 0.4, yaw: DIRV * (lk * 0.8 - rel * 0.2), roll: DIRV * lk * 0.1 };
    return p;
  }
  const tmpBody = [0, 0, 0];

  const lagP = Array.from({ length: 4 }, () => ({}));
  const lagB = Array.from({ length: 4 }, () => ({}));
  const qY = new THREE.Quaternion(), AY = new THREE.Vector3(0, 1, 0);
  const dl = Array.from({ length: 4 }, () => new THREE.Vector3());
  const sl1 = [new THREE.Vector3(), new THREE.Vector3()], sl2 = [new THREE.Vector3(), new THREE.Vector3()];
  const hang = [new THREE.Vector3(), new THREE.Vector3()];
  const brL = [new THREE.Vector3(), new THREE.Vector3()], brR = [new THREE.Vector3(), new THREE.Vector3()];
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const pts = Array.from({ length: 3 }, () => new THREE.Vector3());
  const hipJ = new THREE.Vector3(), toe = new THREE.Vector3();
  const LAG = 0.125; // beats

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

  function poseDancer(d, t) {
    const st = d.st, rig = d.rig, D = d.D;
    const xb = wrapB((t - st.delay) / BEAT);
    // body
    const b = bodyAt(d, xb, tmpW);
    rig.root.position.set(b.x, 0, b.z);
    rig.root.rotation.set(0, b.yaw, 0);
    const p = d.p ?? (d.p = {});
    upperPose(d, xb, p);
    // feet
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    let hipY = D.hipsY + bodyLift(d.plan, xb, st);
    const legs = {};
    for (const f of ['L', 'T']) {
      const fo = evalFoot(d.plan, f, xb, footOut);
      ringToWorld(d, fo.s, fo.u, tmpF);
      const wy = yawAt(tmpF.th, fo.yaw);
      const dx = tmpF.x - b.x, dz = tmpF.z - b.z;
      const side = f === 'L' ? lead : trail;
      const leg = p['leg' + side] ?? (p['leg' + side] = { ankle: new THREE.Vector3() });
      leg.ankle.set(dx * c - dz * s, D.ankle + fo.y, dx * s + dz * c);
      leg.yaw = wy - b.yaw;
      leg.pitch = fo.pitch;
      leg.planted = fo.swing < 0;
      legs[side] = leg;
    }
    // trailing planted foot: raise the heel, pivoting on the toe (which stays put), when the leg runs out of reach
    const L = (D.thigh + D.shin) * 0.985;
    for (const side of ['L', 'R']) {
      const leg = legs[side];
      if (!leg.planted) continue;
      const hx = (side === 'L' ? 1 : -1) * D.hipX;
      hipJ.set(hx, hipY - (D.hipsY - D.hipJ), 0);
      const fx = Math.sin(leg.yaw), fz = Math.cos(leg.yaw);
      const a = leg.ankle, lev = 0.14 * (D.child ? 0.85 : 1), h = D.ankle;
      toe.set(a.x + fx * lev, 0, a.z + fz * lev);
      const ank = (phi, out) => out.set(toe.x - fx * (lev * Math.cos(phi) - h * Math.sin(phi)), lev * Math.sin(phi) + h * Math.cos(phi), toe.z - fz * (lev * Math.cos(phi) - h * Math.sin(phi)));
      const want = L * 0.965;
      if (ank(0, v2).distanceTo(hipJ) <= want || ank(0.3, v3).distanceTo(hipJ) >= v2.distanceTo(hipJ)) continue;
      let lo = 0, hi = 0.75;
      if (ank(hi, v2).distanceTo(hipJ) > want) lo = hi;
      else for (let it = 0; it < 14; it++) { const mid = (lo + hi) / 2; if (ank(mid, v2).distanceTo(hipJ) > want) lo = mid; else hi = mid; }
      const phi = lo === hi ? hi : hi;
      ank(phi, a);
      leg.pitch = phi;
    }
    // keep the legs within reach: lower the pelvis when the feet are far apart
    for (const side of ['L', 'R']) {
      const a = legs[side].ankle, hx = (side === 'L' ? 1 : -1) * D.hipX;
      const hd = Math.hypot(a.x - hx, a.z);
      const vmax = Math.sqrt(Math.max(0.01, L * L - hd * hd));
      const lim = a.y + vmax + (D.hipsY - D.hipJ);
      // smooth min so the pelvis never snaps
      const k = 0.015, mn = Math.min(hipY, lim);
      hipY = mn - k * Math.log(1 + Math.exp(-Math.abs(hipY - lim) / k));
    }
    p.hips.y = hipY;
    // hips shift toward the planted foot a little (lateral)
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
      const alpha = 0.7;
      out[0].copy(dl[1]).addScaledVector(v1.subVectors(dl[1], dl[2]), alpha).addScaledVector(DOWN, 0.22).normalize();
      out[1].copy(dl[2]).addScaledVector(v1.subVectors(dl[2], dl[3]), alpha * 1.2).addScaledVector(DOWN, 0.45).normalize();
      p['sleeve' + S] = out;
    }
    if (D.m) p.sleeveR = null;
    // the men's empty right sleeve and the women's braids trail behind the body's motion
    if (D.m) {
      p.hang = trail2(d, xb, [-D.torsoW / 2 - 0.05, D.waistY, -0.05], [0.22, 0.45], 2.4, hang);
      // keep it off the skirt: lean the sleeve out to the right side
      v1.set(-Math.cos(b.yaw), 0, Math.sin(b.yaw));
      for (const v of hang) v.addScaledVector(v1, 0.18).normalize();
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
      // stand in a row across the view, facing the default camera (+x,+z), rotated by lineupAz
      const k = (dancers.indexOf(d) - (dancers.length - 1) / 2) * 0.62;
      const yaw = Math.PI / 4 + LINEUP;
      rig.root.position.set(k * Math.SQRT1_2, 0, -k * Math.SQRT1_2);
      rig.root.rotation.set(0, yaw, 0);
      qY.setFromAxisAngle(AY, yaw - b.yaw);
      for (const arr of [p.sleeveL, p.sleeveR, p.hang, p.braidL, p.braidR]) if (arr) for (const v of arr) v.applyQuaternion(qY);
    }
    rig.pose(p);
  }

  function update(t) {
    for (const d of dancers) poseDancer(d, t);
  }
  update(0);
  ctx.shared.dancers = dancers.map((d) => d.rig);
  try { window.__dancers = dancers; } catch { /* no window (tests) */ }
  return { group, update };
}
