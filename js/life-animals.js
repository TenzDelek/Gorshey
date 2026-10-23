// Grazing yak (dri) and a dozing Tibetan mastiff (do-khyi). One SkinnedMesh each.
// Model space: head toward +x, y up, ground at y = 0.
import * as THREE from 'three';
import { cyc, frac, smooth, clamp, lerp, rng, wind } from './core.js';
import { Rig, gBox, gSeg, gLoft, paint, paintY, rimFurMat, resetPose } from './life-rig.js';
import { RIM } from './life-people.js';

const LOOPT = 48;
const tmod = (t) => ((t % LOOPT) + LOOPT) % LOOPT;
// 0 outside [a - r, b + r], 1 inside [a, b]
const win = (x, a, b, r) => smooth(a - r, a, x) * (1 - smooth(b, b + r, x));
// a quick blip at each of n events per 24 s (phase off), duration dur (fraction of the period)
const blip = (t, n, off, dur) => { const f = frac((t * n) / 24 + off); return f < dur ? Math.sin(Math.PI * f / dur) : 0; };
// night fur: moonlit tops, the fire's warm light on faces turned to it, a faint cool sheen (see rimFurMat)
const yakMat = () => rimFurMat(RIM, { moonK: 0.085, warmK: 0.4, sheenK: 0.015 });
const dogMat = () => rimFurMat(RIM, { moonK: 0.13, moonY0: 0.6, warmK: 0.3, sheenK: 0.015, liftK: 0.3 });

// ---- yak -------------------------------------------------------------------------------------------
// A dark-brown dri in true profile, grazing. It has to read at 1x from its silhouette and three value bands:
// a strong shoulder hump well above a level back, the head down in the grass below the back line with a
// lighter muzzle and 1-px pale horns turning up, a bushy pale-tipped tail, and four legs below a ragged
// skirt of hair. The skirt ends ~0.3 m above the ground under the belly and higher (knees, hocks) round the
// legs, so the near legs show and, in the gaps between them, the far legs. Bands: a sun-lit back and hump,
// shaggy flank locks a step lighter than the hull between them, a darker belly and hem.
const YC = {
  // the camera flank is in sun shadow (only sky light, ~0.2 of the albedo), so the albedos are light enough
  // to land the flank one or two luma bands off black; the sun-lit back comes out a warm mid brown
  // (sky light is cool, so the browns lean warm to stay brown in the shade)
  lit: 0x7c6350, litTip: 0x8c705a, upper: 0x927458, hull: 0x6e533f, shag: 0x987a5c, shag2: 0x82664e, belly: 0x32261d,
  hem: 0x4e3a2c, hemTip: 0x644c3a, lockLt: 0xa3846a, lockDk: 0x6e5440,
  leg: 0x44342a, legLt: 0x5e4a3a, hoof: 0x1e1915,
  head: 0x624c3c, muzzle: 0xa08a76, muzzleDk: 0x7c6656, nose: 0x241e1a,
  white: 0xe4ded2, whiteDk: 0xc9c1b3, horn: 0xe8e1ce, hornTip: 0xcac1ac,
  tail: 0x4a3b30, tailTip: 0xddd5c6, tailTipDk: 0xbfb5a4,
  tassel: 0xb03229, tassel2: 0xd8a43a, tassel3: 0x2f6aa0,
};
// vertical three-stop colour ramp (per vertex): c0 at y <= y0, c1 at y1, c2 at y >= y2
function paintY3(geo, c0, c1, c2, y0, y1, y2) {
  const g = paint(geo, c0);
  const p = g.attributes.position, c = g.attributes.color;
  const A = new THREE.Color(c0), B = new THREE.Color(c1), C = new THREE.Color(c2), T = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y <= y1) T.copy(A).lerp(B, clamp((y - y0) / (y1 - y0)));
    else T.copy(B).lerp(C, clamp((y - y1) / (y2 - y1)));
    c.setXYZ(i, T.r, T.g, T.b);
  }
  return g;
}
const setRim = (g, v) => { g.attributes.aRim.array.fill(v); return g; };

export function buildYak(side = -1) {
  // side: which flank (z sign) faces the camera
  const R = rng(9001);
  const rig = new Rig();
  // legs: near / far pairs staggered along x so the far ones show in the gaps (a grazing step)
  const LEG = { nf: 0.44, ff: 0.62, nh: -0.64, fh: -0.86, z: 0.2 };
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('body', 'root', [0, 0.8, 0]);
  rig.bone('neck', 'body', [0.62, 1.05, 0]);
  rig.bone('head', 'neck', [0.95, 0.78, 0]);
  rig.bone('earL', 'head', [1.0, 0.82, 0.15]);
  rig.bone('earR', 'head', [1.0, 0.82, -0.15]);
  rig.bone('tail1', 'body', [-1.02, 1.0, 0]);
  rig.bone('tail2', 'tail1', [-1.1, 0.74, 0]);
  rig.bone('skirtL', 'body', [0, 0.78, 0.28]);
  rig.bone('skirtR', 'body', [0, 0.78, -0.28]);
  rig.bone('legRest', 'root', [LEG.nh, 0.6, side * LEG.z]);   // near hind leg: rests its hoof once a loop
  const bx = (bone, hex, x0, x1, y0, y1, wz, z = 0) => rig.box(bone, hex, x1 - x0, y1 - y0, wz, (x0 + x1) / 2, (y0 + y1) / 2, z);

  // body: one lofted hull along x [x, top, bottom, halfWidth] — rump, a level back at ~1.06 m, then a
  // strong shoulder hump 0.38 m (~7 art px) above it, dropping steeply to the low-slung neck
  const SL = [
    [-1.06, 0.97, 0.72, 0.17], [-0.99, 1.04, 0.62, 0.25], [-0.82, 1.08, 0.57, 0.28], [-0.5, 1.07, 0.55, 0.3],
    [-0.2, 1.06, 0.54, 0.3], [0.0, 1.08, 0.54, 0.3], [0.12, 1.21, 0.55, 0.3], [0.22, 1.36, 0.56, 0.29],
    [0.32, 1.44, 0.57, 0.28], [0.42, 1.42, 0.58, 0.27], [0.52, 1.29, 0.6, 0.25], [0.61, 1.12, 0.62, 0.22],
    [0.7, 0.98, 0.66, 0.18], [0.77, 0.89, 0.7, 0.13],
  ];
  const at = (x, k) => {
    for (let i = 0; i < SL.length - 1; i++) if (x <= SL[i + 1][0]) { const u = clamp((x - SL[i][0]) / (SL[i + 1][0] - SL[i][0])); return lerp(SL[i][k], SL[i + 1][k], u); }
    return SL[SL.length - 1][k];
  };
  const topAt = (x) => at(x, 1), botAt = (x) => at(x, 2), hwAt = (x) => at(x, 3);
  // hull colour per vertex: the top ring (the back and the hump) lit and moon-rimmed at night, the upper
  // flank a lighter shaggy band, the lower flank the hull brown, the underside the dark belly
  const hull = rig.add('body', paint(gLoft(SL, 12, 0.62), YC.hull));
  {
    const p = hull.attributes.position, c = hull.attributes.color, rim = hull.attributes.aRim;
    const lit = new THREE.Color(YC.lit), up = new THREE.Color(YC.upper), bel = new THREE.Color(YC.belly);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      if (y > topAt(x) - 0.03) { c.setXYZ(i, lit.r, lit.g, lit.b); rim.setX(i, 3); }
      else if (y > 0.86) c.setXYZ(i, up.r, up.g, up.b);                 // upper flank: the shaggy mid band
      else if (y < botAt(x) + 0.03) c.setXYZ(i, bel.r, bel.g, bel.b);
    }
  }
  // shaggy tufts breaking the top line of the back and the hump, sun-lit (moonlit at night)
  for (let k = 0; k < 15; k++) {
    const x = -0.85 + (k / 14) * 1.4 + (R() - 0.5) * 0.06;
    setRim(rig.add('body', paint(gBox(0.07 + R() * 0.05, 0.05, 0.12 + R() * 0.12, x, topAt(x) - 0.005, (R() - 0.5) * 0.18, 0, R(), 0.25 * (R() - 0.5)), R() < 0.5 ? YC.litTip : YC.lit)), 3);
  }
  // dark hair core under the belly (only between the legs, above the belly hem)
  bx('body', YC.belly, -0.5, 0.3, 0.36, 0.58, 0.42);

  // legs: short and stocky, a little narrower below the knee, dark hooves
  const leg = (bone, x, z) => {
    bx(bone, YC.leg, x - 0.06, x + 0.06, 0.3, 0.64, 0.12, z);
    bx(bone, YC.leg, x - 0.05, x + 0.05, 0.05, 0.31, 0.1, z);
    bx(bone, YC.legLt, x + 0.04, x + 0.052, 0.08, 0.3, 0.08, z);              // a lighter front edge on the shin
    bx(bone, YC.hoof, x - 0.058, x + 0.065, 0, 0.06, 0.115, z);
  };
  leg('root', LEG.nf, side * LEG.z);
  leg('root', LEG.ff, -side * LEG.z);
  leg('root', LEG.fh, -side * LEG.z);
  leg('legRest', LEG.nh, side * LEG.z);

  // the skirt: thin strands (about 1 art px) hanging straight down from the flank — locks a step lighter
  // than the hull, the rest hull brown, all darkening to the hem, some tips catching a little light. The hem
  // is ~0.3 m under the belly and rises to the knees / hocks round the legs (ragged by about one art px).
  const hemAt = (x) => 0.3 + 0.17 * Math.max(win(x, LEG.nf - 0.08, LEG.ff + 0.06, 0.06), win(x, LEG.fh - 0.12, LEG.nh + 0.1, 0.06));
  const strand = (bone, x, z, y0, y1, w, lock) => {
    const g = gSeg([x, y0, z], [x + (R() - 0.5) * 0.03, y1, z * 0.96], w, w * 0.9);
    const top = lock ? (R() < 0.5 ? YC.shag : YC.shag2) : YC.hull;   // locks a step lighter than the rest
    const tip = R() < 0.35 ? YC.hemTip : YC.hem;
    rig.add(bone, paintY3(g, tip, YC.hem, top, y1, y1 + 0.05, y1 + (y0 - y1) * (0.45 + R() * 0.25)));
  };
  for (const s of [1, -1]) {
    const bone = s > 0 ? 'skirtL' : 'skirtR';
    let x = -0.98;
    while (x <= 0.74) {
      const hw = hwAt(x);
      const hem = hemAt(x) + (R() - 0.5) * 0.06;
      const root = Math.min(topAt(x) - 0.12, 0.64 + R() * 0.28);
      strand(bone, x, s * hw * 0.93, root, hem, 0.032 + R() * 0.012, R() < 0.42);
      x += 0.028 + R() * 0.028;
    }
    // short locks over the upper flank and the shoulder, a touch lighter or darker than the band: shag
    for (let k = 0; k < 40; k++) {
      const xx = -0.9 + R() * 1.55, hw = hwAt(xx);
      const y0 = Math.min(topAt(xx) - 0.06, 0.84 + R() * 0.34);
      const g = gSeg([xx, y0, s * (hw * 0.97)], [xx + (R() - 0.5) * 0.03, y0 - 0.08 - R() * 0.1, s * (hw + 0.01)], 0.026, 0.024);
      rig.add(bone, paint(g, R() < 0.6 ? YC.lockLt : YC.lockDk));
    }
  }
  // chest / brisket fringe between the front legs and the "trousers" of hair on the hind thighs
  for (let z = -0.18; z <= 0.18; z += 0.06) strand('body', 0.75 + R() * 0.02, z, 0.8 + R() * 0.1, 0.4 + R() * 0.06, 0.036, R() < 0.3);
  for (let z = -0.16; z <= 0.16; z += 0.05) strand('body', -1.04, z, 0.9 - R() * 0.1, 0.44 + R() * 0.06, 0.036, R() < 0.3);

  // neck, a lit (moonlit) crest, a short dewlap that leaves grass between the chest and the grazing head
  rig.rim = 1;                                                        // neck and dewlap face the fire
  rig.seg('neck', YC.hull, [0.62, 1.06, 0], [0.97, 0.76, 0], 0.34, 0.36);
  setRim(rig.add('neck', gSeg([0.64, 1.15, 0], [0.92, 0.88, 0], 0.07, 0.24), YC.lit), 3);
  for (let i = 0; i < 4; i++) {
    const x = 0.66 + i * 0.05, y0 = 0.86 - i * 0.035;
    const g = gSeg([x, y0, (R() - 0.5) * 0.18], [x + 0.02, y0 - 0.14 - R() * 0.05, (R() - 0.5) * 0.2], 0.035, 0.03);
    rig.add('neck', paintY(g, YC.hem, YC.hull, y0 - 0.2, y0 - 0.04));
  }

  // head: skull, a lighter muzzle, a white blaze down the face, horns, ears with wool tassels. Faces that
  // turn to the fire catch its light at night; the horns also catch the moon.
  rig.rim = 1;
  bx('head', YC.head, 0.88, 1.22, 0.62, 0.92, 0.3);
  bx('head', YC.muzzle, 1.2, 1.37, 0.58, 0.78, 0.25);
  bx('head', YC.muzzleDk, 1.2, 1.37, 0.575, 0.62, 0.252);              // jaw line
  bx('head', YC.nose, 1.37, 1.39, 0.6, 0.72, 0.19);
  bx('head', YC.lit, 0.9, 1.12, 0.9, 0.97, 0.26);                     // shaggy poll
  bx('head', YC.white, 1.06, 1.225, 0.86, 0.926, 0.13);               // blaze: forehead …
  bx('head', YC.white, 1.2, 1.355, 0.74, 0.786, 0.11);                // … down the nose …
  bx('head', YC.whiteDk, 1.37, 1.376, 0.7, 0.76, 0.09);               // … to the muzzle
  for (const s of [1, -1]) {
    // horns: 1-art-px pale strokes out of the poll, then up and back (so they turn up while it grazes)
    rig.rim = 4;
    rig.add('head', paint(gSeg([1.02, 0.9, s * 0.12], [1.01, 0.94, s * 0.21], 0.046, 0.046), YC.horn));
    rig.add('head', paint(gSeg([1.01, 0.94, s * 0.21], [0.95, 1.08, s * 0.25], 0.044, 0.044), YC.horn));
    rig.add('head', paint(gSeg([0.95, 1.08, s * 0.25], [0.88, 1.16, s * 0.21], 0.04, 0.04), YC.hornTip));
    rig.rim = 1;
    const ear = s > 0 ? 'earL' : 'earR';
    rig.add(ear, paint(gSeg([1.0, 0.82, s * 0.14], [0.97, 0.77, s * 0.3], 0.075, 0.03), YC.head));
    rig.add(ear, paint(gBox(0.045, 0.09, 0.045, 0.965, 0.71, s * 0.3), YC.tassel));
    rig.add(ear, paint(gBox(0.03, 0.03, 0.03, 0.965, 0.77, s * 0.32), s > 0 ? YC.tassel2 : YC.tassel3));
  }
  rig.rim = 0;

  // tail: a short stalk, then a bushy switch flaring to a pale tuft that reaches the hocks
  setRim(rig.add('tail1', paint(gSeg([-1.02, 1.03, 0], [-1.1, 0.74, 0], 0.08, 0.08), YC.hull)), 3);
  rig.add('tail2', paint(gSeg([-1.1, 0.76, 0], [-1.115, 0.52, 0], 0.13, 0.12), YC.tail));
  rig.add('tail2', paintY(gSeg([-1.115, 0.54, 0], [-1.125, 0.36, 0], 0.18, 0.16), YC.tailTipDk, YC.tail, 0.42, 0.53));
  for (let i = 0; i < 5; i++) {
    const x = -1.17 + i * 0.025, z = (R() - 0.5) * 0.12;
    rig.add('tail2', paint(gSeg([x, 0.44, z], [x - 0.01, 0.3 + R() * 0.05, z * 1.3], 0.032, 0.03), i % 2 ? YC.tailTip : YC.tailTipDk));
  }

  const mesh = rig.build(yakMat(), 'yak');
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
    // tail: the side swish (x) plus a flick in the profile plane (z) so the pale tuft travels 2-3 art px
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
// the camera (the fire lies that way too); a lion-like mane ruff much wider than the head, lighter at the
// tips, the red yak-wool kekhor collar as a 2-px band at the throat, black-and-tan points (2-px brows, muzzle,
// cheeks, the bib under the collar, the paws, the hind legs) sized to read at 1x, the plumed tail curled up
// over the near hip with a pale plume, and a sun-lit band along the back. The grazed turf in the dog's
// footprint is 2-4 art px tall, so the forelegs stretch out to big 0.13 m paws whose tops clear it; the tan
// side faces are painted light (see DC.tanSide) because the whole camera flank is in sun shadow.
const DC = {
  coat: 0x2f2a28, coatLt: 0x5a5048, coatDk: 0x221e1c, mane: 0x3a322d, maneTip: 0x7c6856, tan: 0xb27a42, tanLt: 0xc8915a,
  // the camera flank is in sun shadow (sky light only), where the tan above lands one band off the mane brown:
  // the tan points' side faces carry this lighter tan so they read tan in the shade, the sun-lit tops keep `tan`
  tanSide: 0xe2a466,
  collar: 0xb0342c, collarDk: 0x84261f, tailTip: 0xa08a72, nose: 0x0f0d0c, eye: 0x2a1e14,
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
  rig.bone('tail2', 'tail1', [-0.55, 0.5, side * 0.1]);
  const bx = (bone, hex, x0, x1, y0, y1, wz, z = 0) => rig.box(bone, hex, x1 - x0, y1 - y0, wz, (x0 + x1) / 2, (y0 + y1) / 2, z);
  // moonlit tops at night: the back band, the mane, the head and the tail carry aRim 3
  const moonTop = (g, y) => { const p = g.attributes.position, r = g.attributes.aRim; for (let i = 0; i < p.count; i++) if (p.getY(i) > y) r.setX(i, 3); return g; };
  // tan points: sides (faces not turned up) in the lighter shade tan, flagged aRim -1 (lifted in the shade by
  // day, see rimFurMat liftK); the tops keep the sun-lit tan
  const TS = new THREE.Color(DC.tanSide), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();
  const tanSides = (g) => {
    const p = g.attributes.position, c = g.attributes.color, r = g.attributes.aRim;
    for (let i = 0; i < p.count; i += 3) {
      _a.fromBufferAttribute(p, i + 1).sub(_n.fromBufferAttribute(p, i));
      _b.fromBufferAttribute(p, i + 2).sub(_n);
      if (Math.abs(_n.crossVectors(_a, _b).normalize().y) < 0.5) for (let j = 0; j < 3; j++) { c.setXYZ(i + j, TS.r, TS.g, TS.b); r.setX(i + j, -1); }
    }
    return g;
  };
  const tan = (bone, x0, x1, y0, y1, wz, z = 0) => tanSides(bx(bone, DC.tan, x0, x1, y0, y1, wz, z));

  // torso: a lofted hull lying on the ground, round haunch, tucked waist, deep chest; lit along the back
  moonTop(rig.add('body', paintY(gLoft([[-0.56, 0.2, 0.05, 0.1], [-0.5, 0.29, 0.02, 0.18], [-0.38, 0.33, 0.02, 0.2], [-0.2, 0.31, 0.02, 0.17],
    [0.0, 0.34, 0.02, 0.18], [0.14, 0.38, 0.02, 0.19]], 10, 0.7), DC.coat, DC.coatLt, 0.31, 0.37)), 0.3);
  for (const s of [1, -1]) {
    // folded hind leg: thigh bulging on the flank over one tan piece, the hock to the paw lying flat
    rig.add('body', paint(gBox(0.26, 0.17, 0.08, -0.36, 0.11, s * 0.19, 0, 0, -0.2), DC.coatDk));
    tan('body', -0.5, -0.16, 0.0, 0.085, 0.085, s * 0.2);
  }
  // raised chest with a tan bib under the collar, wrapping round onto the flanks so it shows side-on
  rig.add('chest', paintY(gLoft([[0.04, 0.39, 0.02, 0.19], [0.2, 0.42, 0.04, 0.18], [0.34, 0.4, 0.06, 0.15], [0.44, 0.34, 0.1, 0.11]], 10, 0.7), DC.coat, DC.coatLt, 0.3, 0.41));
  tan('chest', 0.38, 0.48, 0.19, 0.33, 0.27);
  // the mane ruff round neck and shoulders: taller than the head and twice as wide, warm-tipped
  moonTop(rig.add('chest', paintY(gLoft([[0.04, 0.42, 0.14, 0.15], [0.12, 0.6, 0.1, 0.27], [0.24, 0.68, 0.12, 0.31], [0.35, 0.64, 0.3, 0.27], [0.44, 0.55, 0.4, 0.18]], 10, 0.55), DC.mane, DC.maneTip, 0.36, 0.66)), 0.55);
  for (let i = 0; i < 13; i++) {
    const a = (i / 12) * Math.PI;
    setRim(rig.add('chest', paint(gBox(0.07, 0.07, 0.07, 0.2 + R() * 0.14, 0.36 + Math.sin(a) * 0.3, Math.cos(a) * 0.31, R(), R(), R()), DC.maneTip)), 3);
  }
  // red yak-wool collar (kekhor): a 2-px band round the throat under the jaw, the tan bib showing below it
  rig.add('chest', paintY(gLoft([[0.37, 0.41, 0.325, 0.25], [0.42, 0.42, 0.33, 0.25], [0.48, 0.405, 0.325, 0.19]], 10, 0.55), DC.collarDk, DC.collar, 0.33, 0.41));
  // forelegs stretched forward, tan from the elbow down, big tan paws (their tops just clear the turf)
  for (const s of [1, -1]) {
    const f = s > 0 ? 0.03 : 0;                                          // the near paw a little ahead
    rig.seg('root', DC.coat, [0.18, 0.11, s * 0.09], [0.53 + f, 0.08, s * 0.09], 0.11, 0.1);
    tanSides(rig.seg('root', DC.tan, [0.52 + f, 0.08, s * 0.09], [0.62 + f, 0.075, s * 0.09], 0.1, 0.1));
    tanSides(bx('root', DC.tanLt, 0.6 + f, 0.72 + f, 0.0, 0.13, 0.12, s * 0.09));
  }
  // head: broad skull, tan muzzle and cheeks, the tan brow spots ("four eyes"), drop ears
  bx('head', DC.coat, 0.3, 0.52, 0.39, 0.6, 0.24);
  moonTop(bx('head', DC.coatLt, 0.32, 0.5, 0.595, 0.615, 0.18), 0.6);
  tan('head', 0.52, 0.65, 0.395, 0.5, 0.15);
  bx('head', DC.coat, 0.52, 0.57, 0.495, 0.515, 0.09);                  // dark stop between the eyes
  bx('head', DC.nose, 0.635, 0.665, 0.46, 0.515, 0.08);
  for (const s of [1, -1]) {
    tan('head', 0.4, 0.53, 0.385, 0.46, 0.035, s * 0.112);               // cheeks
    tan('head', 0.48, 0.542, 0.53, 0.605, 0.08, s * 0.085);              // brow spots (2 art px), wrapping onto the side
    bx('head', DC.eye, 0.515, 0.538, 0.5, 0.527, 0.035, s * 0.058);
    rig.seg(s > 0 ? 'earL' : 'earR', DC.coatDk, [0.42, 0.57, s * 0.11], [0.44, 0.45, s * 0.14], 0.08, 0.03);
  }
  // bushy tail curled up over the near hip and forward along the flank, the plume pale-tipped
  moonTop(rig.add('tail1', paint(gSeg([-0.5, 0.27, side * 0.05], [-0.55, 0.5, side * 0.1], 0.11, 0.11), DC.mane)), 0.4);
  setRim(rig.add('tail2', paint(gSeg([-0.55, 0.5, side * 0.1], [-0.38, 0.57, side * 0.16], 0.16, 0.14), DC.coatLt)), 3);
  setRim(rig.add('tail2', paint(gSeg([-0.4, 0.57, side * 0.16], [-0.24, 0.46, side * 0.21], 0.13, 0.11), DC.tailTip)), 3);
  rig.add('tail2', paint(gSeg([-0.47, 0.5, side * 0.2], [-0.3, 0.47, side * 0.24], 0.08, 0.04), DC.tan));   // tan underside of the plume

  const mesh = rig.build(dogMat(), 'dog');
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
