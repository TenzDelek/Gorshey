// makePerson(spec): one skinned, vertex-coloured low-poly Tibetan figure = ONE mesh (one draw call per pass).
// Shared by the dancers and (later) the life module so every figure in the scene matches.
//
// Model space: metres, y up, the figure faces +z, its LEFT is +x, its RIGHT is -x. Feet on y = 0.
//
// spec fields (all optional unless noted):
//   sex: 'f' | 'm'                     required
//   age: 'adult' | 'elder' | 'teen' | 'child'
//   height: m (women 1.55-1.62, men 1.65-1.75, elders a bit less, children 1.1-1.3)
//   build: width scale (default 1)
//   skin: hex (PAL.skin / PAL.skinDeep)
//   hair: hex, hairStyle: 'braids' (two) | 'braid' (one) | 'short' | 'tassels' (Khampa red silk in the hair)
//   yarn: hex of the red/black yarn plaited into braids
//   chuba: hex (robe), trim: hex (brocade / lambskin edge, also the left-over-right wrap line)
//   lining: hex (inside of the empty men's sleeve / cuff), length: 'ankle' (women) | 'knee' (men)
//   blouse: hex (women's long-sleeved silk wonju under the sleeveless chuba)
//   shirt: hex (men's silk shirt; the right arm is out of the chuba)
//   sleeve: extra sleeve length past the wrist in m (women 0.32-0.40; men's left chuba sleeve ~0.16)
//   sash: hex, pangden: array of stripe hexes (top to bottom) or null
//   boot: hex, bootBand: [hex, hex], trousers: hex
//   hat: null | 'brocade' | 'fedora', hatColor: hex, fur: hex, hatBand: hex
//   jewel: [hex, ...] single-pixel turquoise / coral pieces (earrings, gau, hair)
//   eyes: bool (1-px dark eyes, default true)
//
// Returns rig = { root (Group), mesh (SkinnedMesh), bones {name: Bone}, dims, pose(p), handDirWorld(p, side, rootQ, out) }.
// pose(p) (all fields optional; angles in radians):
//   hips:  { x, y, z, pitch, yaw, roll }    hip-bone offset in root space (y = absolute height, default dims.hipsY)
//   spine, chest, neck, head: { pitch, yaw, roll }   pitch + leans forward, yaw + turns to the figure's left, roll + tips to its right
//   armL / armR: { e, az, el, wr, tw, shrug }  e = elevation from hanging (0) to overhead (PI), az = 0 forward .. PI/2 out to the side,
//                el = elbow flex, wr = wrist flex (+ palm-ward, - snapped back), tw = twist about the arm, shrug = shoulder lift
//   legL / legR: { ankle: Vector3 (root-local ankle target, IK), yaw, pitch, knee: Vector3 hint }  or  { fk: [hipX, hipY, hipZ], knee, ankle }
//   sleeveL / sleeveR: [dir1, dir2] world-space directions for the two sleeve-end bones (null = follow the hand)
//   hang: [dir1, dir2] world directions of the empty right chuba sleeve (men), braidL / braidR: [dir1, dir2]
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, tint, PAL, clamp, smooth, lerp } from './core.js';

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'clavL', 'armL', 'foreL', 'handL', 'slvL1', 'slvL2',
  'clavR', 'armR', 'foreR', 'handR', 'slvR1', 'slvR2',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
  'hang1', 'hang2', 'braidL1', 'braidL2', 'braidR1', 'braidR2',
];
const PARENT = {
  hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavL: 'chest', armL: 'clavL', foreL: 'armL', handL: 'foreL', slvL1: 'handL', slvL2: 'slvL1',
  clavR: 'chest', armR: 'clavR', foreR: 'armR', handR: 'foreR', slvR1: 'handR', slvR2: 'slvR1',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
  hang1: 'hips', hang2: 'hang1', braidL1: 'head', braidL2: 'braidL1', braidR1: 'head', braidR2: 'braidR1',
};
const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));

// ---- proportions ----------------------------------------------------------------
export function personDims(spec) {
  const H = spec.height ?? 1.6;
  const child = H < 1.36;
  const m = spec.sex === 'm';
  const kw = (spec.build ?? 1) * (child ? 0.8 : 1);
  const headH = spec.headH ?? (child ? 0.2 : 0.212 + (H - 1.6) * 0.06);
  const headW = headH * 0.84, headD = headH * 0.92;
  const neck = child ? 0.035 : 0.05;
  const headBase = H - headH;
  const shY = headBase - neck - 0.025;
  const hipsY = H * (child ? 0.5 : 0.525);
  const hipJ = hipsY - 0.035;
  const ankle = 0.065;
  const legLen = hipJ - ankle;
  const thigh = legLen * 0.52, shin = legLen - thigh;
  const kneeY = hipJ - thigh;
  const waistY = lerp(hipsY, shY, 0.33);
  const chestY = lerp(hipsY, shY, 0.62);
  const torsoW = (m ? 0.29 : 0.27) * kw;
  const torsoD = (m ? 0.2 : 0.18) * kw;
  const armT = 0.078;
  const shX = torsoW / 2 + armT * 0.45;
  const upper = H * 0.18, fore = H * 0.152;
  const wristY = shY - upper - fore;
  const hipX = 0.083 * kw;
  return { H, child, m, kw, headH, headW, headD, neck, headBase, shY, hipsY, hipJ, ankle, legLen, thigh, shin, kneeY, waistY, chestY, torsoW, torsoD, armT, shX, upper, fore, wristY, hipX };
}

// ---- geometry helpers -----------------------------------------------------------------
function skinAttr(geo, wfn) {
  const p = geo.attributes.position, n = p.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    let w = typeof wfn === 'number' ? [[wfn, 1]] : wfn(p.getX(v), p.getY(v), p.getZ(v));
    w = w.filter((a) => a[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = w.reduce((a, b) => a + b[1], 0) || 1;
    for (let k = 0; k < w.length; k++) { si[v * 4 + k] = w[k][0]; sw[v * 4 + k] = w[k][1] / s; }
    if (!w.length) { si[v * 4] = 0; sw[v * 4] = 1; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}
// weights along a vertical chain: joints = [[boneIndex, yTop], ...] with yTop descending
function chainW(joints, blend = 0.03) {
  return (x, y) => {
    const out = [];
    for (let i = 0; i < joints.length; i++) {
      const top = joints[i][1];
      const bot = i < joints.length - 1 ? joints[i + 1][1] : -1e9;
      const wIn = i === 0 ? 1 : smooth(top + blend, top - blend, y);
      const wOut = i === joints.length - 1 ? 1 : 1 - smooth(bot + blend, bot - blend, y);
      const w = wIn * wOut;
      if (w > 1e-3) out.push([joints[i][0], w]);
    }
    return out;
  };
}
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler();
class Parts {
  constructor() { this.list = []; }
  push(g, color, w) { if (g.index) g = g; tint(g, color); skinAttr(g, w); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); this.list.push(g); return g; }
  // box centred at x,y,z; rot = [rx, ry, rz] applied before translation; hs = height segments
  box(w, h, d, x, y, z, color, wfn, rot = null, hs = 1) {
    const g = new THREE.BoxGeometry(w, h, d, 1, hs, 1);
    if (rot) g.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rot[0], rot[1], rot[2])));
    g.translate(x, y, z);
    return this.push(g, color, wfn);
  }
  // elliptic (octagonal) frustum from yTop to yBot, flat face to the front
  frustum(rxT, rzT, rxB, rzB, yTop, yBot, color, wfn, hs = 3, z0 = 0) {
    const h = yTop - yBot;
    const g = new THREE.CylinderGeometry(1, 1, h, 8, hs, false, Math.PI / 8);
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const k = (p.getY(v) + h / 2) / h;   // 0 bottom .. 1 top
      const sx = lerp(rxB, rxT, k), sz = lerp(rzB, rzT, k);
      p.setXYZ(v, p.getX(v) * sx, yBot + k * h, p.getZ(v) * sz + z0);
    }
    g.computeVertexNormals();
    return this.push(g, color, wfn);
  }
}

// ---- colour utility ------------------------------------------------------------------------
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
export function shade(hex, k) { return _c1.setHex(hex).multiplyScalar(k).getHex(); }
export function mix(a, b, k) { return _c1.setHex(a).lerp(_c2.setHex(b), k).getHex(); }

// ---- build --------------------------------------------------------------------------------
export function makePerson(spec) {
  const D = personDims(spec);
  const P = new Parts();
  const m = D.m;
  const skin = spec.skin ?? PAL.skin;
  const hair = spec.hair ?? PAL.hair;
  const chuba = spec.chuba ?? PAL.chubaBlack;
  const trim = spec.trim ?? PAL.gold;
  const sash = spec.sash ?? PAL.sashRed;
  const boot = spec.boot ?? (m ? PAL.bootBlack : PAL.bootRed);
  const bands = spec.bootBand ?? (m ? [PAL.bootRed, PAL.bootGreen] : [PAL.bootGreen, PAL.bootBlack]);
  const trousers = spec.trousers ?? 0x2a2626;
  const blouse = spec.blouse ?? PAL.blousePink;
  const shirt = spec.shirt ?? PAL.blouseWhite;
  const lining = spec.lining ?? shade(chuba, 1.35);
  const { torsoW: TW, torsoD: TD, shY, waistY, chestY, hipsY, hipJ, kneeY, headBase, headH, headW, headD, shX, wristY, upper, ankle, hipX } = D;
  const hemY = spec.length === 'knee' || (m && spec.length !== 'ankle') ? kneeY + 0.02 : 0.11 + (D.child ? 0.02 : 0);
  D.hemY = hemY;

  // ---------------------------------------------------------------- legs + boots
  for (const sgn of [1, -1]) {
    const S = sgn > 0 ? 'L' : 'R';
    const x = sgn * hipX;
    const thighW = chainW([[BI['thigh' + S], hipJ + 0.04], [BI['shin' + S], kneeY]], 0.035);
    // trousers (men show them between hem and boot). Women: the legs are wrapped in robe fabric, so when a
    // long stride parts the chuba what shows is the robe, not a dark leg.
    const legC = m ? trousers : shade(chuba, 0.9), lw = m ? 1 : 1.35;
    P.box(0.1 * D.kw * lw, hipJ - kneeY + 0.05, 0.11 * D.kw * lw, x, (hipJ + kneeY) / 2, 0, legC, thighW, null, 3);
    const bootTop = m ? kneeY - 0.02 : Math.min(hemY + 0.05, kneeY - 0.06);
    const shinW = BI['shin' + S];
    if (kneeY - bootTop > 0.02) P.box(0.092 * D.kw * lw, kneeY - bootTop + 0.02, 0.1 * D.kw * lw, x, (kneeY + bootTop) / 2, 0, legC, shinW);
    // boot shaft
    const shaftBot = ankle + 0.02;
    P.box(0.1 * D.kw, bootTop - shaftBot, 0.108 * D.kw, x, (bootTop + shaftBot) / 2, 0.0, boot, shinW);
    // bands: men's black lham with red + green felt bands at the top; women's red somba with green / black bands
    if (m) {
      P.box(0.106 * D.kw, 0.05, 0.114 * D.kw, x, bootTop - 0.03, 0, bands[0], shinW);
      P.box(0.104 * D.kw, 0.03, 0.112 * D.kw, x, bootTop - 0.075, 0, bands[1], shinW);
    } else {
      P.box(0.104 * D.kw, 0.035, 0.112 * D.kw, x, shaftBot + 0.045, 0, bands[0], shinW);
    }
    // foot (sole flat on the ground when the ankle sits at `ankle`)
    const footW = BI['foot' + S];
    P.box(0.096 * D.kw, 0.085, 0.235 * (D.child ? 0.85 : 1), x, 0.0425, 0.055, boot, footW);
    P.box(0.1 * D.kw, 0.02, 0.24 * (D.child ? 0.85 : 1), x, 0.01, 0.055, shade(boot, 0.55), footW); // dark sole edge
    if (!m) P.box(0.1 * D.kw, 0.025, 0.06, x, 0.07, 0.13, bands[0], footW); // embroidered toe band
  }

  // ---------------------------------------------------------------- robe skirt
  // the robe follows the thighs only partly (and mostly as a pair) so the hem sways instead of splaying
  const kMax = m ? 0.78 : 0.52, split = m ? 0.8 : 0.62;
  const skirtW = (x, y) => {
    const k = clamp((hipJ - y) / (hipJ - Math.max(0.1, hemY - 0.05)));
    const kk = Math.pow(k, 1.1) * kMax;
    const sL = 0.5 + (smooth(-0.08, 0.08, x) - 0.5) * split;
    return [[BI.hips, 1 - kk], [BI.thighL, kk * sL], [BI.thighR, kk * (1 - sL)]];
  };
  const a8 = 1 / Math.cos(Math.PI / 8); // octagon radius for a given apothem
  const skTopX = (TW / 2 + 0.008) * a8, skTopZ = (TD / 2 + 0.008) * a8;
  const skBotX = (m ? 0.205 : 0.178) * D.kw * a8 * (D.child ? 1.05 : 1), skBotZ = (m ? 0.17 : 0.14) * D.kw * a8;
  const skTop = waistY - 0.02;
  P.frustum(skTopX, skTopZ, skBotX, skBotZ, skTop, hemY, chuba, skirtW, 5);
  // hem band (brocade / lambskin / darker edge)
  const hemBand = spec.hemBand ?? (m ? trim : shade(chuba, 0.72));
  const hb = m ? 0.05 : 0.035;
  P.frustum(skBotX + 0.006, skBotZ + 0.006, skBotX + 0.008, skBotZ + 0.008, hemY + hb, hemY - 0.004, hemBand, skirtW, 1);
  // front skirt surface at height y (apothem in z) — for the apron + wrap edge
  const frontZ = (y) => lerp(skBotZ, skTopZ, clamp((y - hemY) / (skTop - hemY))) / a8;
  const frontX = (y) => lerp(skBotX, skTopX, clamp((y - hemY) / (skTop - hemY))) / a8;
  const slope = Math.atan2((skBotZ - skTopZ) / a8, skTop - hemY);

  // women: the robe's overlap edge runs down the right front of the skirt
  if (!m) {
    const yA = skTop - 0.06, yB = hemY + 0.03;
    for (let y = yA; y > yB; y -= 0.1) {
      const y2 = Math.max(yB, y - 0.1), yc = (y + y2) / 2;
      P.box(0.022, y - y2 + 0.005, 0.01, -frontX(yc) * 0.62, yc, frontZ(yc) + 0.006, shade(chuba, 0.6), skirtW, [slope, 0, 0]);
    }
  }

  // pangden: three panels of offset horizontal stripes, knee-to-ankle, on the front of the skirt
  if (spec.pangden && spec.pangden.length) {
    const st = spec.pangden;
    const yTop = waistY - 0.045, yBot = Math.max(hemY + 0.1, D.kneeY - 0.17);
    const n = Math.max(6, Math.round((yTop - yBot) / 0.062));
    const sh = (yTop - yBot) / n;
    const aw = Math.min(TW * 0.95, 0.27 * D.kw);
    for (let i = 0; i < n; i++) {
      const yc = yTop - sh * (i + 0.5);
      for (let pnl = 0; pnl < 3; pnl++) {
        const c = st[i % st.length];
        const px = (pnl - 1) * aw / 3;
        P.box(aw / 3 + 0.002, sh + 0.002, 0.012, px, yc, frontZ(yc) + 0.009, c, skirtW, [slope, 0, 0]);
      }
    }
    // brocade corner triangles at the top (one pixel each)
    P.box(0.04, 0.035, 0.014, -aw / 2 + 0.02, yTop - 0.018, frontZ(yTop) + 0.012, PAL.gold, skirtW, [slope, 0, 0]);
    P.box(0.04, 0.035, 0.014, aw / 2 - 0.02, yTop - 0.018, frontZ(yTop) + 0.012, PAL.gold, skirtW, [slope, 0, 0]);
  }

  // ---------------------------------------------------------------- torso
  const torsoWt = chainW([[BI.hips, waistY - 0.02], [BI.spine, waistY + 0.03], [BI.chest, chestY]], 0.04);
  const torsoTop = shY + 0.035;
  if (m) {
    // bloused chuba over a tight sash: the pouch (amba) bulges above the sash
    P.box(TW, torsoTop - (waistY - 0.03), TD, 0, (torsoTop + waistY - 0.03) / 2, 0, chuba, torsoWt, null, 3);
    P.box(TW + 0.03, 0.15, TD + 0.05, 0, waistY + 0.1, 0.012, chuba, torsoWt, null, 2);
    // right arm out of the chuba: the silk shirt shows on the right shoulder and chest
    {
      const rows = [[torsoTop, chestY + 0.12, TW * 0.46], [chestY + 0.12, chestY + 0.05, TW * 0.34], [chestY + 0.05, chestY - 0.02, TW * 0.22], [chestY - 0.02, chestY - 0.09, TW * 0.11]];
      for (const [y0, y1, wd] of rows) P.box(wd + 0.006, y0 - y1, TD + 0.008, -TW / 2 + wd / 2 - 0.003, (y0 + y1) / 2, 0, shirt, torsoWt);
    }
    // the robe's left-over-right front edge: trim from the neck down to the right side
    const ex0 = 0.02, ey0 = torsoTop - 0.005, ex1 = -TW * 0.5 + 0.03, ey1 = chestY - 0.09;
    const len = Math.hypot(ex1 - ex0, ey1 - ey0), ang = Math.atan2(ey1 - ey0, ex1 - ex0);
    P.box(len, 0.03, 0.012, (ex0 + ex1) / 2, (ey0 + ey1) / 2, TD / 2 + 0.03, trim, torsoWt, [0, 0, ang]);
    // collar of the shirt
    P.box(0.11, 0.05, 0.12, 0, torsoTop + 0.01, 0.0, shirt, BI.chest);
    // sash: tight, ends hanging at the left hip
    P.box(TW + 0.045, 0.075, TD + 0.06, 0, waistY - 0.015, 0.01, sash, BI.spine);
    P.box(0.05, 0.2, 0.02, TW / 2 + 0.01, waistY - 0.12, 0.05, sash, chainW([[BI.spine, waistY], [BI.hips, waistY - 0.06]]));
    P.box(0.04, 0.16, 0.02, TW / 2 + 0.01, waistY - 0.1, -0.01, shade(sash, 0.8), chainW([[BI.spine, waistY], [BI.hips, waistY - 0.06]]));
  } else {
    // sleeveless chuba bodice over the blouse
    P.box(TW, torsoTop - (waistY - 0.03), TD, 0, (torsoTop + waistY - 0.03) / 2, 0, chuba, torsoWt, null, 3);
    // blouse collar + the V where it shows at the neck
    P.box(0.1, 0.045, 0.11, 0, torsoTop + 0.012, 0.004, blouse, BI.chest);
    // wrap edge: the outer (left) panel crosses to the wearer's right, from the neck down under the right arm
    const ex0 = 0.035, ey0 = torsoTop - 0.005, ex1 = -TW * 0.5 + 0.015, ey1 = chestY - 0.03;
    const len = Math.hypot(ex1 - ex0, ey1 - ey0), ang = Math.atan2(ey1 - ey0, ex1 - ex0);
    P.box(len, 0.028, 0.012, (ex0 + ex1) / 2, (ey0 + ey1) / 2, TD / 2 + 0.002, trim, torsoWt, [0, 0, ang]);
    // sash
    P.box(TW + 0.025, 0.065, TD + 0.03, 0, waistY - 0.01, 0.0, sash, BI.spine);
  }
  // jewellery: a gau / coral-turquoise necklace piece on the chest
  const jewel = spec.jewel ?? [];
  if (jewel[0] !== undefined) P.box(0.045, 0.045, 0.02, 0.0, chestY + 0.06, TD / 2 + 0.012, jewel[0], BI.chest);

  // ---------------------------------------------------------------- arms
  for (const sgn of [1, -1]) {
    const S = sgn > 0 ? 'L' : 'R';
    const x = sgn * shX;
    const shirtArm = m && sgn < 0;                       // men: right arm out of the chuba, silk shirt sleeve, bare hand
    const col = m ? (shirtArm ? shirt : chuba) : blouse;
    const ext = shirtArm ? 0 : (spec.sleeve ?? (m ? 0.16 : 0.36));
    const t = shirtArm ? D.armT * 0.92 : D.armT * (m ? 1.05 : 1);
    const top = shY + 0.045;
    const e1 = wristY - Math.max(0.06, ext * 0.36), e2 = wristY - Math.max(0.12, ext * 0.68);
    const joints = [[BI['arm' + S], top + 1], [BI['fore' + S], shY - upper], [BI['hand' + S], wristY], [BI['slv' + S + '1'], e1], [BI['slv' + S + '2'], e2]];
    const aw = chainW(joints, 0.03);
    // shoulder cap (clavicle) so raised arms do not open a gap
    P.box(t + 0.01, 0.06, t + 0.01, x - sgn * 0.01, shY + 0.01, 0, m && !shirtArm ? chuba : (m ? shirt : chuba), BI['clav' + S]);
    const len = top - (wristY - ext);
    P.box(t, len, t, x, top - len / 2, 0, col, aw, null, 10);
    if (ext > 0.05) {
      // the free end of the sleeve flares a little; men's chuba cuff shows the lining
      const cuff = m ? lining : shade(blouse, 0.9);
      P.box(t + 0.018, 0.05, t + 0.018, x, wristY - ext + 0.025, 0, cuff, aw);
    }
    if (shirtArm || ext < 0.05) {
      P.box(0.065, 0.12, 0.05, x, wristY - 0.06, 0.005, skin, BI['hand' + S]);
    }
  }

  // ---------------------------------------------------------------- empty right sleeve (men), hanging from the waist
  if (m) {
    const hx = -TW / 2 - 0.05, hy = waistY + 0.02, hz = -0.04;
    const L = Math.min(0.6, D.H * 0.34);
    const hw = chainW([[BI.hang1, hy + 1], [BI.hang2, hy - L * 0.45]], 0.05);
    P.box(0.11, L, 0.08, hx, hy - L / 2, hz, shade(chuba, 1.22), hw, null, 6);
    P.box(0.115, 0.07, 0.085, hx, hy - L + 0.035, hz, lining, hw);
  }

  // ---------------------------------------------------------------- neck + head
  P.box(0.085, headBase - shY + 0.04, 0.085, 0, (headBase + shY) / 2 + 0.01, 0, shade(skin, 0.86), chainW([[BI.chest, shY + 0.01], [BI.neck, shY + 0.03]], 0.015));
  const hc = headBase + headH / 2;
  P.box(headW, headH, headD, 0, hc, 0.005, skin, BI.head);
  // hair
  const style = spec.hairStyle ?? (m ? 'short' : 'braids');
  const hairW = BI.head;
  P.box(headW + 0.02, 0.06, headD + 0.02, 0, headBase + headH - 0.02, -0.002, hair, hairW);                       // crown
  P.box(headW + 0.02, headH * (m ? 0.62 : 0.86), 0.05, 0, headBase + headH * (m ? 0.66 : 0.56), -headD / 2 - 0.006, hair, hairW); // back
  P.box(0.025, headH * (m ? 0.35 : 0.55), headD * 0.7, headW / 2 + 0.006, headBase + headH * 0.68, -0.025, hair, hairW);         // sides
  P.box(0.025, headH * (m ? 0.35 : 0.55), headD * 0.7, -headW / 2 - 0.006, headBase + headH * 0.68, -0.025, hair, hairW);
  if (!m) P.box(headW * 0.9, 0.03, 0.02, 0, headBase + headH - 0.035, headD / 2 + 0.008, hair, hairW); // fringe line over the brow
  // eyes (1 art px each)
  if (spec.eyes !== false) {
    const ey = headBase + headH * 0.5;
    P.box(0.032, 0.026, 0.01, 0.042, ey, headD / 2 + 0.008, 0x241a16, BI.head);
    P.box(0.032, 0.026, 0.01, -0.042, ey, headD / 2 + 0.008, 0x241a16, BI.head);
  }
  if (jewel[1] !== undefined) {   // earrings
    P.box(0.028, 0.04, 0.028, headW / 2 + 0.012, headBase + headH * 0.28, 0.0, jewel[1], BI.head);
    if (!m) P.box(0.028, 0.04, 0.028, -headW / 2 - 0.012, headBase + headH * 0.28, 0.0, jewel[1], BI.head);
  }
  // braids with red yarn
  if (style === 'braids' || style === 'braid') {
    const yarn = spec.yarn ?? 0xa8302a;
    const bl = spec.braidLen ?? Math.min(0.5, D.H * 0.3);
    const by = headBase + 0.05, bz = -headD / 2 - 0.035;
    const list = style === 'braids' ? [[1, 'L'], [-1, 'R']] : [[0, 'L']];
    for (const [sx, S] of list) {
      const bx = sx * 0.05;
      const bw = chainW([[BI['braid' + S + '1'], by + 1], [BI['braid' + S + '2'], by - bl * 0.5]], 0.05);
      P.box(0.036, bl, 0.034, bx, by - bl / 2, bz, hair, bw, null, 5);
      P.box(0.05, 0.07, 0.048, bx, by - bl + 0.06, bz, yarn, bw);            // red yarn wrapped near the end
      P.box(0.034, 0.06, 0.034, bx, by - bl - 0.015, bz, shade(yarn, 0.8), bw); // tassel
      if (jewel[2] !== undefined && sx >= 0) P.box(0.036, 0.036, 0.03, bx, by - 0.02, bz - 0.022, jewel[2], bw);
    }
  }
  // headgear
  const top = headBase + headH;
  if (style === 'tassels') {
    // Khampa: long hair wrapped round the head with red silk tassels (tra-dzi)
    const red = spec.tassel ?? 0xa82a26;
    const ry = top - 0.045, rh = 0.07, th = 0.04;
    P.box(headW + 2 * th, rh, th, 0, ry, headD / 2 + th / 2 - 0.004, red, hairW);
    P.box(headW + 2 * th, rh, th, 0, ry, -headD / 2 - th / 2 - 0.004, shade(red, 0.9), hairW);
    P.box(th, rh, headD + 0.01, headW / 2 + th / 2 - 0.004, ry, 0, red, hairW);
    P.box(th, rh, headD + 0.01, -headW / 2 - th / 2 + 0.004, ry, 0, shade(red, 0.92), hairW);
    P.box(0.035, 0.14, 0.035, headW / 2 + 0.045, top - 0.11, -0.03, red, hairW);  // tassel ends at the left temple
    if (jewel[2] !== undefined) P.box(0.04, 0.04, 0.03, 0.03, top - 0.015, headD / 2 + 0.04, jewel[2], hairW);
  }
  if (spec.hat === 'fedora') {
    const hc2 = spec.hatColor ?? 0x5b4636;
    // felt fedora: wide thin brim, low crown with a dark band and a pinched top
    P.box(headW + 0.16, 0.018, headD + 0.15, 0, top - 0.025, 0.005, hc2, hairW);
    P.box(headW - 0.01, 0.075, headD - 0.02, 0, top + 0.012, 0, hc2, hairW);
    P.box(headW + 0.0, 0.025, headD - 0.01, 0, top - 0.005, 0, spec.hatBand ?? shade(hc2, 0.55), hairW);
    P.box(headW - 0.06, 0.018, headD * 0.35, 0, top + 0.055, 0, shade(hc2, 0.85), hairW); // pinch
  } else if (spec.hat === 'brocade') {
    const gold = spec.hatColor ?? 0xc0a050, fur = spec.fur ?? 0xa8683a;
    P.box(headW + 0.01, 0.1, headD + 0.01, 0, top + 0.04, 0, gold, hairW);
    P.box(headW - 0.03, 0.04, headD - 0.03, 0, top + 0.1, 0, spec.hatBand ?? 0x9e2e2a, hairW);    // red crown
    P.box(headW + 0.07, 0.06, headD + 0.07, 0, top - 0.005, 0, fur, hairW);                       // fur band
    P.box(0.04, 0.13, headD * 0.8, headW / 2 + 0.05, top + 0.03, -0.01, fur, hairW, [0, 0, -0.35]); // flaps turned up
    P.box(0.04, 0.13, headD * 0.8, -headW / 2 - 0.05, top + 0.03, -0.01, fur, hairW, [0, 0, 0.35]);
    P.box(headW * 0.7, 0.1, 0.04, 0, top + 0.035, headD / 2 + 0.04, shade(fur, 1.12), hairW, [-0.3, 0, 0]);
  }

  // ---------------------------------------------------------------- mesh + skeleton
  const geo = mergeGeometries(P.list.map((g) => (g.index ? g : g)), false);
  geo.computeBoundingSphere();
  const bones = {};
  const rest = {
    root: [0, 0, 0], hips: [0, hipsY, 0], spine: [0, waistY, 0], chest: [0, chestY, 0], neck: [0, shY, 0], head: [0, headBase, 0],
    clavL: [0.05, shY, 0], armL: [shX, shY, 0], foreL: [shX, shY - upper, 0], handL: [shX, wristY, 0],
    clavR: [-0.05, shY, 0], armR: [-shX, shY, 0], foreR: [-shX, shY - upper, 0], handR: [-shX, wristY, 0],
    thighL: [hipX, hipJ, 0], shinL: [hipX, kneeY, 0], footL: [hipX, ankle, 0],
    thighR: [-hipX, hipJ, 0], shinR: [-hipX, kneeY, 0], footR: [-hipX, ankle, 0],
    hang1: [-TW / 2 - 0.05, waistY + 0.02, -0.04], hang2: [-TW / 2 - 0.05, waistY + 0.02 - Math.min(0.6, D.H * 0.34) * 0.45, -0.04],
    braidL1: [0.05, headBase + 0.05, -headD / 2 - 0.035], braidR1: [-0.05, headBase + 0.05, -headD / 2 - 0.035],
  };
  if (style === 'braid') rest.braidL1 = [0, headBase + 0.05, -headD / 2 - 0.035];
  const bl = spec.braidLen ?? Math.min(0.5, D.H * 0.3);
  rest.braidL2 = [rest.braidL1[0], rest.braidL1[1] - bl * 0.5, rest.braidL1[2]];
  rest.braidR2 = [rest.braidR1[0], rest.braidR1[1] - bl * 0.5, rest.braidR1[2]];
  for (const S of ['L', 'R']) {
    const ext = (m && S === 'R') ? 0 : (spec.sleeve ?? (m ? 0.16 : 0.36));
    const x = rest['hand' + S][0];
    rest['slv' + S + '1'] = [x, wristY - Math.max(0.06, ext * 0.36), 0];
    rest['slv' + S + '2'] = [x, wristY - Math.max(0.12, ext * 0.68), 0];
  }
  const list = BONE_NAMES.map((n) => { const b = new THREE.Bone(); b.name = n; bones[n] = b; return b; });
  for (const n of BONE_NAMES) {
    const b = bones[n], r = rest[n];
    const par = PARENT[n];
    if (par) {
      const pr = rest[par];
      b.position.set(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2]);
      bones[par].add(b);
    } else b.position.set(r[0], r[1], r[2]);
  }
  const material = mat(0xffffff, { vertexColors: true, grain: 0.05 });
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.add(bones.root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list));
  const root = new THREE.Group();
  root.name = spec.name ?? 'person';
  root.add(mesh);

  const restLocal = Object.fromEntries(BONE_NAMES.map((n) => [n, bones[n].position.clone()]));
  const rig = { root, mesh, bones, dims: D, spec, restLocal };
  rig.pose = (p) => posePerson(rig, p);
  rig.handDirWorld = (p, side, rootQ, out) => handDirWorld(rig, p, side, rootQ, out);
  rig.pose({});
  return rig;
}

// ---- posing ----------------------------------------------------------------------------
const DOWN = new THREE.Vector3(0, -1, 0);
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const tq = Array.from({ length: 16 }, () => new THREE.Quaternion());
const tv = Array.from({ length: 12 }, () => new THREE.Vector3());
const tE = new THREE.Euler();
const tM = new THREE.Matrix4();

function eulerQ(q, o, order = 'YXZ') { return q.setFromEuler(tE.set(o?.pitch ?? 0, o?.yaw ?? 0, o?.roll ?? 0, order)); }

// local quaternions of one arm chain (clavicle, upper arm, forearm, hand) from {e, az, el, wr, tw, shrug}
function armQuats(a, sgn, qClav, qArm, qFore, qHand) {
  const e = clamp(a?.e ?? 0.15, 0, 2.95), az = a?.az ?? 0.5;
  const shrug = a?.shrug ?? 0.16 * smooth(1.3, 2.7, e);
  qClav.setFromAxisAngle(AZ, sgn * shrug);
  const d = tv[0].set(sgn * Math.sin(e) * Math.sin(az), -Math.cos(e), Math.sin(e) * Math.cos(az)).normalize();
  // express the direction in the clavicle frame, then the minimal rotation from hanging
  d.applyQuaternion(tq[15].copy(qClav).invert());
  qArm.setFromUnitVectors(DOWN, d);
  if (a?.tw) qArm.multiply(tq[14].setFromAxisAngle(AY, -sgn * a.tw));
  qFore.setFromAxisAngle(AX, -(a?.el ?? 0.3));
  qHand.setFromAxisAngle(AX, -(a?.wr ?? 0));
}

function torsoQuats(p, qHips, qSpine, qChest) {
  eulerQ(qHips, p.hips);
  eulerQ(qSpine, p.spine);
  eulerQ(qChest, p.chest);
}

// world-space direction of a hand (sleeve start) for pose p, without touching the bones
function handDirWorld(rig, p, side, rootQ, out) {
  const sgn = side === 'L' ? 1 : -1;
  const [qH, qS, qC, qCl, qA, qF, qHd] = [tq[0], tq[1], tq[2], tq[3], tq[4], tq[5], tq[6]];
  torsoQuats(p, qH, qS, qC);
  armQuats(side === 'L' ? p.armL : p.armR, sgn, qCl, qA, qF, qHd);
  const w = tq[7].copy(rootQ).multiply(qH).multiply(qS).multiply(qC).multiply(qCl).multiply(qA).multiply(qF).multiply(qHd);
  return out.copy(DOWN).applyQuaternion(w);
}

// two-bone IK in root space: sets thigh/shin/foot local quaternions
function solveLeg(rig, S, sgn, qHipsW, hipsPos, leg) {
  const D = rig.dims, B = rig.bones;
  const hip = tv[1].set(sgn * D.hipX, D.hipJ - D.hipsY, 0).applyQuaternion(qHipsW).add(hipsPos);
  const tgt = tv[2].copy(leg.ankle);
  const l1 = D.thigh, l2 = D.shin;
  const dv = tv[3].subVectors(tgt, hip);
  let d = dv.length();
  const dir = tv[4].copy(dv).divideScalar(Math.max(d, 1e-5));
  d = clamp(d, Math.abs(l1 - l2) + 0.02, (l1 + l2) * 0.9995);
  // knee points along the foot (yaw) blended with a hint
  const fy = leg.yaw ?? 0;
  const kh = tv[5].set(Math.sin(fy), 0, Math.cos(fy));
  if (leg.knee) kh.add(leg.knee).normalize();
  kh.addScaledVector(dir, -kh.dot(dir));
  if (kh.lengthSq() < 1e-6) kh.set(0, 0, 1);
  kh.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const knee = tv[6].copy(hip).addScaledVector(dir, a).addScaledVector(kh, h);
  const ankle = tv[7].copy(hip).addScaledVector(dir, d);
  // thigh basis: +y up the limb (knee -> hip), +z toward the kneecap
  const basis = (from, to, q) => {
    const y = tv[8].subVectors(from, to).normalize();
    const z = tv[9].copy(kh).addScaledVector(y, -kh.dot(y)).normalize();
    const x = tv[10].crossVectors(y, z);
    tM.makeBasis(x, y, z);
    return q.setFromRotationMatrix(tM);
  };
  const qThighW = basis(hip, knee, tq[8]);
  const qShinW = basis(knee, ankle, tq[9]);
  const qFootW = tq[10].setFromAxisAngle(AY, fy).multiply(tq[11].setFromAxisAngle(AX, leg.pitch ?? 0));
  B['thigh' + S].quaternion.copy(qHipsW).invert().multiply(qThighW);
  B['shin' + S].quaternion.copy(qThighW).invert().multiply(qShinW);
  B['foot' + S].quaternion.copy(qShinW).invert().multiply(qFootW);
}

// aim a chain of bones (each pointing along its local -y) at world directions, limiting the bend per joint
function aimChain(bones, parentW, dirs, maxBend = 1.35) {
  const cur = tq[12].copy(parentW);
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const axis = tv[8].copy(DOWN).applyQuaternion(cur);
    const want = tv[9].copy(dirs[i]).normalize();
    let ang = axis.angleTo(want);
    const rel = tq[13].setFromUnitVectors(axis, want);
    if (ang > maxBend) rel.slerp(tq[14].identity(), 1 - maxBend / ang);
    // local = cur^-1 * rel * cur
    b.quaternion.copy(cur).invert().multiply(rel).multiply(cur);
    cur.premultiply(rel);
  }
}

const _rootQ = new THREE.Quaternion();
function posePerson(rig, p) {
  const B = rig.bones, D = rig.dims;
  rig.root.updateWorldMatrix(true, false);
  rig.root.getWorldQuaternion(_rootQ);
  const rootQ = _rootQ;
  // torso
  B.hips.position.set(p.hips?.x ?? 0, p.hips?.y ?? D.hipsY, p.hips?.z ?? 0);
  torsoQuats(p, B.hips.quaternion, B.spine.quaternion, B.chest.quaternion);
  eulerQ(B.neck.quaternion, p.neck);
  eulerQ(B.head.quaternion, p.head);
  // arms
  armQuats(p.armL, 1, B.clavL.quaternion, B.armL.quaternion, B.foreL.quaternion, B.handL.quaternion);
  armQuats(p.armR, -1, B.clavR.quaternion, B.armR.quaternion, B.foreR.quaternion, B.handR.quaternion);
  // legs
  const qHipsW = B.hips.quaternion; // root space
  for (const [S, sgn] of [['L', 1], ['R', -1]]) {
    const leg = p['leg' + S];
    if (leg?.ankle) solveLeg(rig, S, sgn, qHipsW, B.hips.position, leg);
    else {
      const fk = leg?.fk ?? [0, 0, 0];
      B['thigh' + S].quaternion.setFromEuler(tE.set(fk[0], fk[1], fk[2]));
      B['shin' + S].quaternion.setFromAxisAngle(AX, leg?.knee ?? 0);
      B['foot' + S].quaternion.setFromAxisAngle(AX, leg?.ankleA ?? 0);
    }
  }
  // world quaternions for the dangling chains
  const qHipsWorld = tq[0].copy(rootQ).multiply(B.hips.quaternion);
  const qChestWorld = tq[1].copy(qHipsWorld).multiply(B.spine.quaternion).multiply(B.chest.quaternion);
  for (const [S] of [['L'], ['R']]) {
    const sl = p['sleeve' + S];
    const b1 = B['slv' + S + '1'], b2 = B['slv' + S + '2'];
    if (sl) {
      const qHand = tq[2].copy(qChestWorld).multiply(B['clav' + S].quaternion).multiply(B['arm' + S].quaternion)
        .multiply(B['fore' + S].quaternion).multiply(B['hand' + S].quaternion);
      aimChain([b1, b2], qHand, sl, 1.25);
    } else { b1.quaternion.identity(); b2.quaternion.identity(); }
  }
  if (p.hang) aimChain([B.hang1, B.hang2], qHipsWorld, p.hang, 1.2);
  else { B.hang1.quaternion.identity(); B.hang2.quaternion.identity(); }
  const qHeadWorld = tq[3].copy(qChestWorld).multiply(B.neck.quaternion).multiply(B.head.quaternion);
  for (const S of ['L', 'R']) {
    const br = p['braid' + S];
    if (br) aimChain([B['braid' + S + '1'], B['braid' + S + '2']], tq[4].copy(qHeadWorld), br, 1.0);
    else { B['braid' + S + '1'].quaternion.identity(); B['braid' + S + '2'].quaternion.identity(); }
  }
}
