// Grazing yak (dri) and a dozing Tibetan mastiff (do-khyi). One SkinnedMesh each.
// Model space: head toward +x, y up, ground at y = 0.
import * as THREE from 'three';
import { cyc, frac, smooth, clamp, lerp, rng, wind } from './core.js';
import { Rig, gBox, gSeg, gLoft, paint, paintY, furMat, resetPose } from './life-rig.js';

const LOOPT = 48;
const tmod = (t) => ((t % LOOPT) + LOOPT) % LOOPT;
// 0 outside [a - r, b + r], 1 inside [a, b]
const win = (x, a, b, r) => smooth(a - r, a, x) * (1 - smooth(b, b + r, x));
// a quick blip at each of n events per 24 s (phase off), duration dur (fraction of the period)
const blip = (t, n, off, dur) => { const f = frac((t * n) / 24 + off); return f < dur ? Math.sin(Math.PI * f / dur) : 0; };

// ---- yak -------------------------------------------------------------------------------------------
// A pied dri in true profile: dark brown body with a sun-lit band along the back and the shoulder hump,
// white only in the face blaze and the tail tip, a long skirt of hair ending ~0.25 m above the ground in
// ragged 1-px strand ends so the legs show beneath, short pale horns curving up and out, red ear tassels.
const YC = {
  base: 0x3a2e28, lit: 0x5a4a40, litTip: 0x66554a, dark: 0x2a221e, core: 0x241d19, tip: 0x4a3c33, tipLt: 0x55463b,
  white: 0xe4ded2, whiteDk: 0xc9c1b3, horn: 0xd8d0bd, hornTip: 0xb5ac9a, hoof: 0x171312, nose: 0x161211,
  tassel: 0xb03229, tassel2: 0xd8a43a, tassel3: 0x2f6aa0,
};
export function buildYak(side = -1) {
  // side: which flank (z sign) faces the camera
  const R = rng(9001);
  const rig = new Rig();
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('body', 'root', [0, 0.78, 0]);
  rig.bone('neck', 'body', [0.62, 1.0, 0]);
  rig.bone('head', 'neck', [0.92, 0.74, 0]);
  rig.bone('earL', 'head', [1.0, 0.8, 0.15]);
  rig.bone('earR', 'head', [1.0, 0.8, -0.15]);
  rig.bone('tail1', 'body', [-1.0, 1.0, 0]);
  rig.bone('tail2', 'tail1', [-1.08, 0.72, 0]);
  rig.bone('skirtL', 'body', [0, 0.74, 0.3]);
  rig.bone('skirtR', 'body', [0, 0.74, -0.3]);
  rig.bone('legRest', 'root', [-0.72, 0.55, side * 0.17]);   // near hind leg: rests its hoof once a loop
  const bx = (bone, hex, x0, x1, y0, y1, wz, z = 0) => rig.box(bone, hex, x1 - x0, y1 - y0, wz, (x0 + x1) / 2, (y0 + y1) / 2, z);

  // body: one lofted hull along x [x, top, bottom, halfWidth] — rump, a level back at ~1.1 m, then a
  // distinct shoulder hump ~0.2 m (4 art px) above it, dropping steeply to the low-slung neck
  const SL = [
    [-1.07, 0.94, 0.7, 0.17], [-1.0, 1.02, 0.6, 0.25], [-0.82, 1.07, 0.54, 0.29], [-0.5, 1.07, 0.52, 0.31],
    [-0.2, 1.06, 0.5, 0.315], [0.02, 1.07, 0.5, 0.315], [0.13, 1.15, 0.5, 0.31], [0.23, 1.26, 0.5, 0.3],
    [0.33, 1.31, 0.51, 0.29], [0.44, 1.28, 0.52, 0.28], [0.54, 1.17, 0.54, 0.26], [0.63, 1.04, 0.57, 0.23], [0.72, 0.93, 0.62, 0.18], [0.79, 0.85, 0.66, 0.13],
  ];
  const at = (x, k) => {
    for (let i = 0; i < SL.length - 1; i++) if (x <= SL[i + 1][0]) { const u = clamp((x - SL[i][0]) / (SL[i + 1][0] - SL[i][0])); return lerp(SL[i][k], SL[i + 1][k], u); }
    return SL[SL.length - 1][k];
  };
  const topAt = (x) => at(x, 1), widAt = (x) => 2 * at(x, 3);
  // hull colour per vertex: the top ring (the back and the hump) in the lit band, the rest the base brown
  const hull = paint(gLoft(SL, 12, 0.62), YC.base);
  {
    const p = hull.attributes.position, c = hull.attributes.color, lit = new THREE.Color(YC.lit);
    for (let i = 0; i < p.count; i++) if (p.getY(i) > topAt(p.getX(i)) - 0.03) c.setXYZ(i, lit.r, lit.g, lit.b);
  }
  rig.add('body', hull);
  // shaggy tufts breaking the top line of the back and the hump, sun-lit
  for (let k = 0; k < 15; k++) {
    const x = -0.85 + (k / 14) * 1.4 + (R() - 0.5) * 0.06;
    rig.add('body', paint(gBox(0.07 + R() * 0.05, 0.05, 0.12 + R() * 0.12, x, topAt(x) - 0.005, (R() - 0.5) * 0.18, 0, R(), 0.25 * (R() - 0.5)), R() < 0.5 ? YC.litTip : YC.lit));
  }
  // hair core under the belly, kept above the hem so the legs and the grass show below the skirt
  bx('body', YC.core, -0.86, 0.66, 0.34, 0.52, 0.46);

  // legs: short and stocky; near/far pairs staggered so four legs read below the skirt
  const legs = [[0.52, side * 0.17], [0.42, -side * 0.17], [-0.84, -side * 0.17]];
  for (const [x, z] of legs) {
    bx('root', YC.dark, x - 0.06, x + 0.06, 0.04, 0.55, 0.12, z);
    bx('root', YC.hoof, x - 0.065, x + 0.075, 0, 0.06, 0.13, z);
  }
  bx('legRest', YC.dark, -0.78, -0.66, 0.04, 0.55, 0.12, side * 0.17);
  bx('legRest', YC.hoof, -0.785, -0.645, 0, 0.06, 0.13, side * 0.17);

  // the long skirt: thin strands (about 1 art px) dark at the root, a touch lighter toward the tip,
  // rooted at staggered heights on the flank, ending in a ragged hem ~0.25 m above the ground
  const strand = (bone, x, z, y0, y1, flare, w = 0.034, tip = YC.tip) => {
    const g = gSeg([x, y0, z], [x + (R() - 0.5) * 0.04, y1, z + flare], w, w * 0.9);
    const rootC = R() < 0.55 ? YC.base : YC.dark;
    rig.add(bone, paintY(g, tip, rootC, y1, y1 + (y0 - y1) * (0.45 + R() * 0.4)));
  };
  for (const s of [1, -1]) {
    const bone = s > 0 ? 'skirtL' : 'skirtR';
    let x = -0.95;
    while (x <= 0.74) {
      const wz = widAt(x) / 2;
      // hem ~0.25 m, ragged by about one art px either way; a little longer under the chest
      const hem = 0.235 + 0.08 * R() - 0.04 * smooth(0.2, 0.6, x);
      const root = 0.55 + R() * 0.3;
      strand(bone, x, s * (wz - 0.005), root, hem, s * (0.05 + R() * 0.05), 0.03 + R() * 0.012, R() < 0.25 ? YC.tipLt : YC.tip);
      x += 0.03 + R() * 0.03;
    }
    // shorter locks higher on the flank and over the shoulder for shag
    for (let k = 0; k < 14; k++) {
      const xx = -0.8 + R() * 1.4, wz = widAt(xx) / 2;
      const y0 = Math.min(topAt(xx) - 0.1, 0.8 + R() * 0.3);
      strand(bone, xx, s * (wz + 0.004), y0, y0 - 0.2 - R() * 0.16, s * 0.025, 0.028, YC.tip);
    }
  }
  // chest/brisket fringe and the "trousers" of hair on the hind thighs (also ending above the ground)
  for (let z = -0.2; z <= 0.2; z += 0.05) strand('body', 0.76 + R() * 0.02, z, 0.78 + R() * 0.12, 0.2 + R() * 0.08, 0.03);
  for (let z = -0.2; z <= 0.2; z += 0.05) strand('body', -1.055, z, 0.9 - R() * 0.1, 0.32 + R() * 0.1, -0.03);

  // neck with a hairy dewlap
  rig.seg('neck', YC.base, [0.62, 1.04, 0], [0.96, 0.74, 0], 0.36, 0.38);
  rig.seg('neck', YC.lit, [0.64, 1.13, 0], [0.9, 0.87, 0], 0.07, 0.26);
  for (let i = 0; i < 7; i++) {
    const x = 0.64 + i * 0.045;
    const y0 = 0.84 - i * 0.03;
    const g = gSeg([x, y0, (R() - 0.5) * 0.2], [x + 0.02, y0 - 0.2 - R() * 0.06, (R() - 0.5) * 0.24], 0.035, 0.03);
    rig.add('neck', paintY(g, YC.tip, YC.base, y0 - 0.26, y0 - 0.05));
  }

  // head: skull, muzzle, a white blaze down the face, horns, ears with wool tassels
  bx('head', YC.base, 0.86, 1.22, 0.6, 0.9, 0.3);
  bx('head', YC.base, 1.2, 1.36, 0.56, 0.76, 0.24);
  bx('head', YC.nose, 1.36, 1.38, 0.6, 0.71, 0.18);
  bx('head', YC.lit, 0.88, 1.1, 0.88, 0.95, 0.24);                    // shaggy poll
  bx('head', YC.white, 1.06, 1.225, 0.84, 0.906, 0.12);               // blaze: forehead …
  bx('head', YC.white, 1.2, 1.345, 0.715, 0.766, 0.1);                // … down the nose …
  bx('head', YC.white, 1.218, 1.226, 0.7, 0.88, 0.11);
  bx('head', YC.whiteDk, 1.36, 1.366, 0.7, 0.76, 0.09);               // … to the muzzle
  for (const s of [1, -1]) {
    // horns: 1-art-px strokes out of the poll, out and up, tips turning in
    const hz = s * 0.12;
    rig.add('head', paint(gSeg([1.02, 0.88, hz], [1.03, 0.94, s * 0.23], 0.044, 0.044), YC.horn));
    rig.add('head', paint(gSeg([1.03, 0.94, s * 0.23], [1.06, 1.04, s * 0.26], 0.042, 0.042), YC.horn));
    rig.add('head', paint(gSeg([1.06, 1.04, s * 0.26], [1.1, 1.09, s * 0.21], 0.04, 0.04), YC.hornTip));
    const ear = s > 0 ? 'earL' : 'earR';
    rig.add(ear, paint(gSeg([1.0, 0.8, s * 0.14], [0.97, 0.75, s * 0.29], 0.075, 0.03), YC.base));
    rig.add(ear, paint(gBox(0.045, 0.09, 0.045, 0.965, 0.69, s * 0.29), YC.tassel));
    rig.add(ear, paint(gBox(0.03, 0.03, 0.03, 0.965, 0.75, s * 0.31), s > 0 ? YC.tassel2 : YC.tassel3));
  }

  // tail: a short stalk and a dark switch reaching the hocks, white only at the tip
  rig.seg('tail1', YC.base, [-1.0, 1.02, 0], [-1.08, 0.72, 0], 0.075, 0.075);
  rig.add('tail2', paint(gSeg([-1.08, 0.74, 0], [-1.095, 0.42, 0], 0.13, 0.12), YC.dark));
  rig.add('tail2', paint(gSeg([-1.095, 0.43, 0], [-1.1, 0.33, 0], 0.13, 0.12), YC.white));
  for (let i = 0; i < 4; i++) rig.add('tail2', paint(gSeg([-1.14 + i * 0.03, 0.36, (R() - 0.5) * 0.08], [-1.15 + i * 0.03, 0.25 + R() * 0.05, (R() - 0.5) * 0.1], 0.03, 0.03), YC.white));

  const mesh = rig.build(furMat(), 'yak');
  const B = mesh.userData.bones;
  const lookY = { v: 0 };
  // tail: a swish at flies every 6 s (0.72 s long), alternating sides, over a lazy sway
  const swish = (tq) => { const f = frac((tq * 4) / 24 + 0.4); return f < 0.12 ? Math.sin(Math.PI * f / 0.12) : 0; };
  const swSide = (tq) => (Math.floor((tq * 4) / 24 + 0.4) % 2 ? 1 : -1);
  const tailX = (tq) => 0.1 * Math.sin(cyc(tq, 5)) + 0.3 * swSide(tq) * swish(tq);   // side swing (toward / away from the camera)

  function update(t) {
    resetPose(mesh);
    const tt = tmod(t);
    // head up to look round and chew twice per loop, grazing (muzzle in the grass) otherwise
    const U = win(tt, 16.6, 22.0, 1.7) + win(tt, 38.2, 42.6, 1.5);
    const crop = (1 - U) * (0.04 * Math.sin(cyc(t, 22)) + 0.02 * Math.sin(cyc(t, 41) + 1.0));
    B.neck.rotation.order = 'YZX';
    B.neck.rotation.set(0, (1 - U) * 0.14 * Math.sin(cyc(t, 2) + 0.3) + U * lookY.v, lerp(-0.62, 0.0, U) + crop);
    const chew = U * 0.035 * Math.sin(cyc(t, 34));
    B.head.rotation.set(0.04 * U * Math.sin(cyc(t, 3)), 0, lerp(-0.36, 0.12, U) + chew - crop * 0.5);
    // ear flicks
    const fl = blip(t, 4, 0.1, 0.05), fr = blip(t, 3, 0.55, 0.05);
    B.earL.rotation.set(-0.7 * fl + 0.08 * Math.sin(cyc(t, 5)), 0, 0.15 * U);
    B.earR.rotation.set(0.7 * fr - 0.08 * Math.sin(cyc(t, 5) + 1), 0, 0.15 * U);
    // tail: the side swish (x) plus a flick in the profile plane (z) so the white tip travels 2-3 art px
    // across the screen; the switch (tail2) lags the stalk by 0.1 s
    B.tail1.rotation.set(tailX(t), 0, 0.025 * Math.sin(cyc(t, 3)) + 0.11 * swish(t));
    B.tail2.rotation.set(0.6 * tailX(t - 0.2) - 0.3 * tailX(t), 0, 0.07 * swish(t - 0.1));
    // weight shift once a loop: rests the near hind hoof, the body settles over the other legs
    const W = win(tt, 28.5, 33.5, 0.9);
    B.body.position.z += -side * 0.03 * W;
    B.body.rotation.set(-side * 0.025 * W + 0.006 * Math.sin(cyc(t, 5)), 0, 0.01 * Math.sin(cyc(t, 5)));
    B.body.scale.set(1, 1 + 0.008 * Math.sin(cyc(t, 5)), 1 + 0.01 * Math.sin(cyc(t, 5)));
    B.legRest.rotation.set(0.0, 0, -0.18 * W);
    B.legRest.position.y += 0.03 * W;
    // the skirt swings in the breeze and with the body
    const wd = wind(t, 4.5, 1.65);
    B.skirtL.rotation.set(0.05 * wd + side * 0.01 * W, 0, 0.03 * Math.sin(cyc(t, 7)));
    B.skirtR.rotation.set(0.05 * wd + side * 0.01 * W, 0, 0.03 * Math.sin(cyc(t, 7) + 1));
  }
  return { mesh, update, lookY };
}

// ---- Tibetan mastiff -----------------------------------------------------------------------------
// A do-khyi lying sphinx-style: forelegs stretched forward, chest up, head held high and turned toward
// the camera (the fire lies that way too); a lion-like mane ruff much wider than the head, the red
// yak-wool kekhor collar, black-and-tan points (brows, muzzle, chest, forelegs), the plumed tail
// curled up over the near hip, and a sun-lit band along the back.
const DC = {
  coat: 0x2f2a28, coatLt: 0x4a423c, coatDk: 0x221e1c, mane: 0x332d2a, maneTip: 0x5e5044, tan: 0x9a6a3a, tanLt: 0xae7d48,
  collar: 0xa62f2a, collarDk: 0x7e2420, tailTip: 0x7a6a58, nose: 0x0f0d0c, eye: 0x2a1e14,
};
export function buildDog(side = 1) {
  // side: which flank (z sign) faces the camera; the tail curls onto that side
  const R = rng(4711);
  const rig = new Rig();
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('body', 'root', [-0.1, 0.17, 0]);
  rig.bone('chest', 'body', [0.18, 0.2, 0]);
  rig.bone('head', 'chest', [0.36, 0.44, 0]);
  rig.bone('earL', 'head', [0.42, 0.57, 0.11]);
  rig.bone('earR', 'head', [0.42, 0.57, -0.11]);
  rig.bone('tail1', 'body', [-0.5, 0.27, side * 0.05]);
  rig.bone('tail2', 'tail1', [-0.54, 0.45, side * 0.1]);
  const bx = (bone, hex, x0, x1, y0, y1, wz, z = 0) => rig.box(bone, hex, x1 - x0, y1 - y0, wz, (x0 + x1) / 2, (y0 + y1) / 2, z);

  // torso: a lofted hull lying on the ground, round haunch, tucked waist, deep chest; lit along the back
  rig.add('body', paintY(gLoft([[-0.56, 0.2, 0.05, 0.1], [-0.5, 0.29, 0.02, 0.18], [-0.38, 0.33, 0.02, 0.2], [-0.2, 0.31, 0.02, 0.17],
    [0.0, 0.34, 0.02, 0.18], [0.14, 0.38, 0.02, 0.19]], 10, 0.7), DC.coat, DC.coatLt, 0.27, 0.35));
  for (const s of [1, -1]) {
    // folded hind leg: thigh bulging on the flank, tan hock, paw tucked forward
    rig.add('body', paint(gBox(0.26, 0.17, 0.08, -0.36, 0.11, s * 0.19, 0, 0, -0.2), DC.coatDk));
    bx('body', DC.tan, -0.5, -0.42, 0.02, 0.1, 0.06, s * 0.2);
    bx('body', DC.tan, -0.24, -0.1, 0.0, 0.05, 0.08, s * 0.2);
  }
  // raised chest with a tan bib
  rig.add('chest', paintY(gLoft([[0.04, 0.39, 0.02, 0.19], [0.2, 0.42, 0.04, 0.18], [0.32, 0.38, 0.06, 0.14]], 10, 0.7), DC.coat, DC.coatLt, 0.3, 0.41));
  bx('chest', DC.tan, 0.3, 0.34, 0.07, 0.27, 0.15);
  // the mane ruff round neck and shoulders: taller than the head and twice as wide, lighter at the tips
  rig.add('chest', paintY(gLoft([[0.04, 0.42, 0.14, 0.15], [0.12, 0.6, 0.1, 0.27], [0.24, 0.68, 0.1, 0.31], [0.35, 0.63, 0.14, 0.28], [0.43, 0.52, 0.2, 0.17]], 10, 0.55), DC.mane, DC.maneTip, 0.4, 0.66));
  for (let i = 0; i < 11; i++) {
    const a = (i / 10) * Math.PI;
    rig.add('chest', paint(gBox(0.06, 0.06, 0.06, 0.18 + R() * 0.14, 0.38 + Math.sin(a) * 0.29, Math.cos(a) * 0.31, R(), R(), R()), DC.maneTip));
  }
  // red yak-wool collar ruff (kekhor) round the throat, in front of the mane
  rig.add('chest', paintY(gLoft([[0.36, 0.52, 0.16, 0.25], [0.41, 0.55, 0.15, 0.26], [0.47, 0.5, 0.18, 0.2]], 10, 0.55), DC.collarDk, DC.collar, 0.22, 0.47));
  // forelegs stretched forward, tan below, big tan paws
  for (const s of [1, -1]) {
    rig.seg('root', DC.coat, [0.14, 0.08, s * 0.1], [0.3, 0.05, s * 0.1], 0.1, 0.09);
    rig.seg('root', DC.tan, [0.3, 0.05, s * 0.1], [0.52, 0.04, s * 0.1], 0.08, 0.075);
    bx('root', DC.tanLt, 0.5, 0.61, 0.0, 0.06, 0.095, s * 0.1);
  }
  // head: broad skull, tan muzzle and cheeks, the tan brow spots ("four eyes"), drop ears
  bx('head', DC.coat, 0.3, 0.52, 0.39, 0.6, 0.24);
  bx('head', DC.coatLt, 0.32, 0.5, 0.595, 0.615, 0.18);
  bx('head', DC.tan, 0.52, 0.64, 0.4, 0.49, 0.14);
  bx('head', DC.coat, 0.52, 0.63, 0.485, 0.51, 0.1);
  bx('head', DC.nose, 0.635, 0.655, 0.465, 0.505, 0.07);
  for (const s of [1, -1]) {
    bx('head', DC.tan, 0.42, 0.52, 0.39, 0.45, 0.03, s * 0.115);          // cheeks
    bx('head', DC.tan, 0.51, 0.525, 0.545, 0.575, 0.04, s * 0.055);       // brow spots
    bx('head', DC.eye, 0.515, 0.527, 0.505, 0.525, 0.03, s * 0.055);
    rig.seg(s > 0 ? 'earL' : 'earR', DC.coatDk, [0.42, 0.57, s * 0.11], [0.44, 0.45, s * 0.14], 0.08, 0.03);
  }
  // bushy tail curled up over the near hip and forward along the flank
  rig.seg('tail1', DC.mane, [-0.5, 0.27, side * 0.05], [-0.54, 0.45, side * 0.1], 0.1, 0.1);
  rig.add('tail2', paint(gSeg([-0.54, 0.45, side * 0.1], [-0.36, 0.5, side * 0.16], 0.14, 0.12), DC.coatLt));
  rig.add('tail2', paint(gSeg([-0.38, 0.5, side * 0.16], [-0.24, 0.41, side * 0.2], 0.1, 0.09), DC.tailTip));

  const mesh = rig.build(furMat(), 'dog');
  const B = mesh.userData.bones;
  const look = { yaw: 0 };

  function update(t) {
    resetPose(mesh);
    const tt = tmod(t);
    // head held up, turned toward the camera (the fire lies that way too); twice a loop it watches the
    // dancers go by (head follows them, ears up, tail thumps), staggered against the yak's head-up windows
    const A = win(tt, 7.2, 13.5, 1.2) + win(tt, 31.0, 37.5, 1.2);
    B.head.rotation.order = 'YZX';
    const follow = 0.22 * Math.sin(cyc(t, 2) + 0.4);
    B.head.rotation.set(0.04 * Math.sin(cyc(t, 1)), 0.8 * look.yaw + A * follow + 0.06 * Math.sin(cyc(t, 3)),
      0.02 + 0.03 * Math.sin(cyc(t, 4) + 0.7) + 0.04 * A * Math.sin(cyc(t, 32)));
    // breathing: slow at rest, a bit quicker when alert
    const br = Math.sin(cyc(t, 7)) * (1 - A) + Math.sin(cyc(t, 12)) * A;
    B.body.scale.set(1, 1 + 0.025 * br, 1 + 0.03 * br);
    B.chest.scale.set(1, 1 + 0.02 * br, 1 + 0.02 * br);
    // ear twitches (a fly, a shout), ears lift when alert
    const e1 = blip(t, 5, 0.21, 0.035), e2 = blip(t, 3, 0.67, 0.035);
    B.earL.rotation.set(-0.5 * e1, 0, 0.3 * e1 + 0.18 * A);
    B.earR.rotation.set(0.5 * e2, 0, 0.3 * e2 + 0.18 * A);
    // tail thumps while it watches, an occasional single thump otherwise
    const thump = (win(tt, 7.6, 10.4, 0.4) + win(tt, 31.4, 33.8, 0.4)) * Math.max(0, Math.sin(cyc(t, 44))) + blip(t, 2, 0.8, 0.03);
    B.tail1.rotation.set(-side * 0.45 * thump, 0, 0.2 * thump);
    B.tail2.rotation.set(-side * 0.2 * thump, 0, 0);
  }
  return { mesh, update, look };
}
