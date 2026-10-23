// Seated onlookers on the rug: the dranyen player, the grandmother with her prayer wheel and mala,
// and a small girl clapping the beat. Each is one SkinnedMesh (see life-rig.js).
// Figure space: +z forward, +x = the figure's LEFT, -x = RIGHT, y up, seat on y = 0.
import * as THREE from 'three';
import { PAL, PANGDEN, BEAT, cyc, frac, smooth, lerp, TAU } from './core.js';
import { Rig, gBox, gSeg, gCyl, gXform, paint, paintSegments, rimClothMat, resetPose } from './life-rig.js';

// Night fire-rim strength (uNight-gated in the shader); life.js writes the fire flicker into it each frame.
export const RIM = { value: 1 };
let _mat = null;
const peopleMat = () => (_mat ??= rimClothMat(RIM));   // one program for all three figures

// ---- palette (muted, naturalistic) ------------------------------------------------------------
export const PC = {
  eye: 0x1c1512, lip: 0x7a4a36,
  hair: PAL.hair, grey: 0x8f8a83, greyHi: 0xb4afa7,
  yarn: 0xa8292a,
  turq: PAL.turquoise, coral: PAL.coral, silver: 0xb9b8b2, gold: 0xc9a03e,
  // musician
  muChuba: 0x672530, muChubaDk: 0x4a1a22, muTrim: 0xb48c3a, muShirt: 0xe9e3d5, muSash: 0xc4943a,
  felt: 0x5b4636, feltBand: 0x2c221c, muSkin: 0x9c6a4a,
  // elder (amala)
  elChuba: 0x4a3629, elChubaDk: 0x36271e, elTrim: 0x8c6b3e, elBlouse: 0x9dbdd2, elSash: 0x7c2a2c, elSkin: 0x9a6b4e,
  // child
  chChuba: 0x32503e, chChubaDk: 0x243a2e, chTrim: 0xc9a227, chBlouse: 0xe39aae, chSash: 0xd29a3a,
  boot: PAL.bootBlack, bootRed: PAL.bootRed, bootGreen: PAL.bootGreen,
  // dranyen
  wood: 0x8c5a32, woodLt: 0xa8733f, woodDk: 0x5e3a20, skinTop: 0xd6c6a2, paintRed: 0xa8352c, paintGreen: 0x3c7448, paintGold: 0xd1a443,
  // prayer wheel + mala
  copper: 0xb27a46, copperDk: 0x8a5732, wheelSilver: 0xc4bfb2, iron: 0x3a3532, mala: 0x6e2a22, handle: 0x6b4428,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- shared seated body ---------------------------------------------------------------------------
// o: { sex, chuba, chubaDk, trim, top (shirt/blouse), sash, skin, hair, hat, hairStyle, pangden, earring, armOut, headScale,
//      rimHead: 'front' (a strip at the face's front edge glows at night) | +1 / -1 (a strip at that side's front edge, lit where it faces the fire) }
function seatedBody(rig, o) {
  const male = o.sex === 'm';
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('spine', 'root', [0, 0.13, -0.02]);
  rig.bone('head', 'spine', [0, 0.64, -0.005]);

  // lower body: cross-legged lap
  if (male) {
    rig.box('root', o.chuba, 0.5, 0.12, 0.4, 0, 0.06, 0.05);
    rig.box('root', o.trim, 0.506, 0.026, 0.05, 0, 0.1, 0.232);              // brocade hem over the knees
    rig.box('root', o.chubaDk, 0.42, 0.05, 0.14, 0, 0.025, -0.19);           // skirt drape behind
    // crossed shins in knee boots, coloured bands at the boot tops (by the knees)
    rig.seg('root', o.boot, [-0.22, 0.055, 0.13], [0.13, 0.045, 0.3], 0.085, 0.085);
    rig.seg('root', o.boot, [0.22, 0.07, 0.13], [-0.13, 0.06, 0.3], 0.085, 0.085);
    rig.box('root', PC.bootRed, 0.07, 0.092, 0.092, -0.205, 0.058, 0.14, 0, 0.45);
    rig.box('root', PC.bootGreen, 0.03, 0.094, 0.094, -0.165, 0.056, 0.16, 0, 0.45);
    rig.box('root', PC.bootRed, 0.07, 0.092, 0.092, 0.205, 0.072, 0.14, 0, -0.45);
    rig.box('root', PC.bootGreen, 0.03, 0.094, 0.094, 0.165, 0.07, 0.16, 0, -0.45);
  } else {
    rig.box('root', o.chuba, 0.52, 0.13, 0.44, 0, 0.065, 0.05);
    rig.box('root', o.chuba, 0.46, 0.085, 0.05, 0, 0.0425, 0.285);           // robe falling over the feet
    rig.box('root', o.trim, 0.465, 0.02, 0.054, 0, 0.012, 0.285);            // hem band
    rig.box('root', o.chubaDk, 0.44, 0.05, 0.15, 0, 0.025, -0.2);
    // somba toes peeping out: red felt, green band
    for (const sx of [-1, 1]) {
      rig.box('root', PC.bootRed, 0.07, 0.05, 0.07, sx * 0.1, 0.025, 0.33);
      rig.box('root', PC.bootGreen, 0.072, 0.014, 0.02, sx * 0.1, 0.045, 0.31);
    }
    if (o.pangden) {
      // striped apron draped over the lap and falling over the knees (stripes run across the body)
      const st = o.pangden;
      const n = 6;
      for (let i = 0; i < n; i++) rig.box('root', st[i % st.length], 0.3, 0.008, 0.032, 0, 0.134, 0.1 + i * 0.032);
      for (let i = 0; i < 4; i++) rig.box('root', st[(i + n) % st.length], 0.3, 0.03, 0.008, 0, 0.115 - i * 0.03, 0.276);
      // brocade corner triangles at the waist
      rig.box('root', PC.gold, 0.04, 0.02, 0.03, -0.13, 0.136, 0.085);
      rig.box('root', PC.gold, 0.04, 0.02, 0.03, 0.13, 0.136, 0.085);
    }
  }

  // torso
  if (male) {
    rig.box('spine', o.chuba, 0.37, 0.16, 0.27, 0, 0.255, 0.025);           // bloused pouch (amba) over the sash
    rig.box('spine', o.sash, 0.38, 0.05, 0.264, 0, 0.165, 0.01);
    rig.box('spine', o.chuba, 0.37, 0.27, 0.22, 0, 0.465, -0.01);
    if (o.armOut) {
      // right shoulder out of the robe: silk shirt shows; the robe's edge runs from the neck to under the right arm
      rig.box('spine', o.top, 0.125, 0.21, 0.226, -0.125, 0.4975, -0.01);
      rig.seg('spine', o.trim, [0.035, 0.595, 0.103], [-0.062, 0.4, 0.103], 0.03, 0.014);
    } else {
      rig.seg('spine', o.trim, [0.03, 0.595, 0.103], [-0.17, 0.37, 0.103], 0.03, 0.014);
    }
    rig.box('spine', o.top, 0.125, 0.035, 0.125, 0, 0.615, 0);              // stand collar
  } else {
    rig.box('spine', o.chuba, 0.33, 0.14, 0.22, 0, 0.245, 0.0);
    rig.box('spine', o.sash, 0.34, 0.05, 0.226, 0, 0.17, 0.0);
    rig.box('spine', o.chuba, 0.33, 0.27, 0.2, 0, 0.455, -0.01);
    rig.seg('spine', o.trim, [0.035, 0.59, 0.093], [-0.165, 0.36, 0.093], 0.026, 0.014);   // left-over-right wrap edge
    rig.box('spine', o.top, 0.11, 0.035, 0.11, 0, 0.608, 0);                // blouse collar
    rig.box('spine', o.top, 0.06, 0.06, 0.01, 0.0, 0.565, 0.092);           // blouse in the V of the wrap
  }
  rig.box('spine', o.skin, 0.075, 0.05, 0.075, 0, 0.635, 0);

  // head (optionally scaled about the neck for the child's bigger head)
  const hs = o.headScale ?? 1;
  const H = (g, hex, rim = 0) => {
    if (hs !== 1) { g.translate(0, -0.64, 0); g.scale(hs, hs, hs); g.translate(0, 0.64, 0); }
    return rig.add('head', g, hex, rim);
  };
  if (o.rimHead === 'front') {
    // seen side-on, the face's fire side is its front edge: a 0.05 m strip there glows (aRim 2)
    const e = 0.05;
    H(gBox(0.17, 0.21, 0.185 - e, 0, 0.765, 0.01 - e / 2), o.skin);
    H(gBox(0.17, 0.21, e, 0, 0.765, 0.1025 - e / 2), o.skin, 2);
  } else if (o.rimHead) {
    // split the face: a 0.06 m strip on the fire side carries the rim, the rest stays plain
    const sx = o.rimHead, e = 0.06;
    H(gBox(0.17 - e, 0.21, 0.185, -sx * e / 2, 0.765, 0.01), o.skin);
    H(gBox(e, 0.21, 0.185, sx * (0.085 - e / 2), 0.765, 0.01), o.skin, 1);
  } else H(gBox(0.17, 0.21, 0.185, 0, 0.765, 0.01), o.skin);
  for (const sx of [-1, 1]) {
    H(gBox(0.03, 0.022, 0.012, sx * 0.04, 0.778, 0.104), PC.eye);
    H(gBox(0.022, 0.05, 0.04, sx * 0.094, 0.765, 0.0), o.skin);
  }
  if (o.earring) for (const sx of [-1, 1]) if (male ? sx > 0 : true) H(gBox(0.026, 0.034, 0.026, sx * 0.098, 0.728, 0.006), o.earring);
  if (o.hairStyle === 'short') {
    H(gBox(0.18, 0.05, 0.196, 0, 0.848, 0.004), o.hair);
    H(gBox(0.18, 0.12, 0.04, 0, 0.8, -0.075), o.hair);
  } else {
    H(gBox(0.18, 0.06, 0.196, 0, 0.848, 0.004), o.hair);
    H(gBox(0.18, 0.17, 0.045, 0, 0.775, -0.075), o.hair);
    H(gBox(0.186, 0.1, 0.03, 0, 0.8, 0.05), o.hair);                          // hair at the temples
    if (o.hairStyle === 'crown') {
      // braids wound round the head with red yarn, as older women wear them
      H(gBox(0.192, 0.034, 0.206, 0, 0.835, 0.004), o.hairHi ?? o.hair);
      H(gBox(0.04, 0.036, 0.03, 0.06, 0.836, 0.1), PC.yarn);
      H(gBox(0.05, 0.036, 0.03, -0.05, 0.836, -0.1), PC.yarn);
      H(gBox(0.03, 0.03, 0.03, 0.097, 0.84, 0.0), PC.turq);                   // turquoise in the hair
    }
  }
  if (o.hat === 'fedora') {
    H(gBox(0.29, 0.018, 0.3, 0, 0.873, 0.004), o.felt);
    H(gBox(0.195, 0.022, 0.205, 0, 0.893, 0.004), o.feltBand);
    H(gBox(0.19, 0.085, 0.2, 0, 0.922, 0.004), o.felt);
    H(gBox(0.15, 0.02, 0.15, 0, 0.972, 0.004), o.felt);
  }
  // braids down the back (child, younger women): on the spine so they hang with the body
  if (o.hairStyle === 'braids') {
    for (const sx of [-1, 1]) {
      rig.seg('spine', o.hair, [sx * 0.055, 0.68, -0.1], [sx * 0.07, 0.36, -0.125], 0.036, 0.036);
      rig.box('spine', PC.yarn, 0.042, 0.06, 0.042, sx * 0.071, 0.335, -0.126);
    }
  }
  if (o.hairStyle === 'crown') {
    rig.seg('spine', o.hair, [0, 0.66, -0.105], [0.0, 0.42, -0.125], 0.04, 0.036);
    rig.box('spine', PC.yarn, 0.045, 0.05, 0.045, 0, 0.4, -0.126);
  }
}

// Arm from shoulder to hand. Bones: sh<side> (spine), el<side>, wr<side>.
function arm(rig, side, J, sleeve, cuff, skin, opt = {}) {
  const { sh, el, wr, hand } = J;
  rig.bone('sh' + side, 'spine', sh);
  rig.bone('el' + side, 'sh' + side, el);
  rig.bone('wr' + side, 'el' + side, wr);
  const w = opt.w ?? 0.09;
  rig.add('sh' + side, gBox(w * 1.08, w * 1.1, w * 1.1, sh[0], sh[1], sh[2]), sleeve);
  rig.seg('sh' + side, sleeve, sh, el, w, w, 0, 0.04);
  rig.seg('el' + side, sleeve, el, wr, w * 0.9, w * 0.9, 0, 0.03);
  // cuff band at the wrist (blouse/shirt cuff, or a long silk cuff turned back)
  const d = V(...wr).sub(V(...el)).normalize();
  const c0 = V(...wr).addScaledVector(d, -(opt.cuffLen ?? 0.04)), c1 = V(...wr).addScaledVector(d, 0.012);
  rig.seg('el' + side, cuff, c0, c1, w * 0.98, w * 0.98);
  rig.add('wr' + side, gSeg(wr, hand, opt.hw ?? 0.066, opt.hd ?? 0.045, opt.roll ?? 0), skin, opt.rimHand ? 1 : 0);
}

// ---- dranyen ------------------------------------------------------------------------------------
// Local frame: +x along the neck toward the scroll, +y across the body, +z out of the soundboard.
function dranyenGeos() {
  const P = [];
  const box = (hex, x0, x1, w, z0, z1, y = 0) => P.push(paint(gBox(x1 - x0, w, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2), hex));
  // waisted body: skin-covered lower bout, narrow waist, wooden upper bout with painted edges
  box(PC.wood, -0.175, -0.02, 0.17, -0.075, 0);
  box(PC.skinTop, -0.165, -0.03, 0.145, 0, 0.007);
  box(PC.woodDk, -0.115, -0.105, 0.1, 0.007, 0.02);                     // bridge on the skin
  box(PC.woodDk, -0.19, -0.175, 0.07, -0.06, -0.01);                    // tail block
  box(PC.wood, -0.02, 0.035, 0.105, -0.065, 0);
  box(PC.woodLt, 0.035, 0.135, 0.13, -0.068, 0.002);
  box(PC.paintRed, 0.04, 0.13, 0.012, -0.06, 0.006, 0.062);
  box(PC.paintGreen, 0.04, 0.13, 0.012, -0.06, 0.006, -0.062);
  box(PC.paintGold, 0.07, 0.1, 0.03, 0.002, 0.009);                     // small carved rosette
  // neck, pegbox with three pegs a side, and the hooked scroll head
  box(PC.woodLt, 0.135, 0.64, 0.037, -0.032, 0.004);
  box(PC.woodDk, 0.64, 0.765, 0.044, -0.042, 0.002);
  for (const px of [0.665, 0.7, 0.735]) for (const sy of [-1, 1]) box(PC.woodLt, px - 0.01, px + 0.01, 0.03, -0.03, -0.012, sy * 0.034);
  P.push(paint(gSeg([0.76, 0, -0.018], [0.835, 0, -0.05], 0.044, 0.04), PC.paintGreen));
  P.push(paint(gSeg([0.835, 0, -0.05], [0.86, 0, -0.105], 0.042, 0.04), PC.paintRed));
  P.push(paint(gSeg([0.86, 0, -0.105], [0.82, 0, -0.14], 0.04, 0.038), PC.paintGold));
  P.push(paint(gBox(0.03, 0.05, 0.03, 0.81, 0, -0.125), PC.paintRed));
  return P;
}

// =================================================================================================
// MUSICIAN
export function buildMusician() {
  const rig = new Rig();
  const o = {
    sex: 'm', chuba: PC.muChuba, chubaDk: PC.muChubaDk, trim: PC.muTrim, top: PC.muShirt, sash: PC.muSash,
    skin: PC.muSkin, hair: PC.hair, hairStyle: 'short', hat: 'fedora', felt: PC.felt, feltBand: PC.feltBand,
    earring: PC.turq, armOut: true, boot: PC.boot, rimHead: 'front',
  };
  seatedBody(rig, o);

  // instrument frame: body in front of the right belly, the neck laid diagonally across the chest up to
  // the player's left and a little forward, so in profile it rises in front of his face and breaks his
  // outline; the soundboard is tipped a little to his right (toward the camera) so the skin top shows.
  const Bc = V(-0.06, 0.3, 0.21);
  const X = V(0.66, 0.64, 0.28).normalize();
  const Z = V(-0.35, 0.25, 1);
  Z.addScaledVector(X, -Z.dot(X)).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X);
  const F = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(Bc);
  rig.bone('dran', 'spine', Bc.toArray());
  // no fire rim on the instrument: the fire's own light warms it, and a rim lit the whole neck into a rod
  for (const g of dranyenGeos()) rig.add('dran', gXform(g, F), undefined, 0);
  const along = (s, up = 0) => Bc.clone().addScaledVector(X, s).addScaledVector(Z, up).toArray();

  // right arm: out of the robe, white silk sleeve, strumming over the skin
  arm(rig, 'R', { sh: [-0.19, 0.58, -0.01], el: [-0.27, 0.36, 0.04], wr: [-0.16, 0.3, 0.19], hand: along(-0.075, 0.045) }, PC.muShirt, PC.muShirt, PC.muSkin, { rimHand: true });
  // left arm in the maroon sleeve with the white shirt cuff showing, hand round the neck
  const fret = along(0.42, -0.01);
  arm(rig, 'L', { sh: [0.19, 0.58, -0.01], el: [0.3, 0.4, 0.12], wr: [fret[0] + 0.005, fret[1] - 0.045, fret[2] - 0.04], hand: fret }, PC.muChuba, PC.muShirt, PC.muSkin, { cuffLen: 0.035, rimHand: true });
  // the empty right sleeve, hanging from the sash behind the right hip
  rig.bone('sleeve', 'spine', [-0.19, 0.2, -0.04]);
  rig.seg('sleeve', PC.muChuba, [-0.19, 0.2, -0.04], [-0.24, 0.035, -0.17], 0.085, 0.075);
  rig.box('sleeve', PC.muTrim, 0.09, 0.03, 0.08, -0.243, 0.025, -0.18, 0.9, 0, 0);

  const mesh = rig.build(peopleMat(), 'musician');
  const B = mesh.userData.bones;
  const shLb = B.shL.userData.bind, handL = V(...fret);
  const rL = handL.clone().sub(shLb);
  const axisL = new THREE.Vector3().crossVectors(rL, X).normalize();
  const rLen = rL.length();
  const elRb = B.elR.userData.bind;
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const AX = V(1, 0, 0), AY = V(0, 1, 0), AZ = V(0, 0, 1);
  // fretting-hand position along the neck (offset from the bind position), one per phrase of 8 counts
  const FRET = [0, 0.07, 0, -0.06, 0, 0.07, 0.12, 0.03];

  function update(t) {
    resetPose(mesh);
    const b = t / BEAT, bf = frac(b);
    const c = (((b + 16) % 32) + 32) % 32;                         // count 32 (beat 31, 63) sits at c in [15, 16)
    const shout = smooth(14.75, 15.0, c) * (1 - smooth(15.8, 16.35, c));
    // strum: down on the beat, up on the "and" (sweep across the strings: forearm turns about the neck axis)
    let pos = 1 - 2 * smooth(0, 0.09, bf) + 2 * smooth(0.5, 0.6, bf);
    pos *= 1 - 0.6 * shout;
    // the right shoulder dips into each downstroke and eases back up before the upstroke
    const dip = smooth(0, 0.09, bf) * (1 - smooth(0.14, 0.48, bf)) * (1 - 0.6 * shout);
    // body: lean over the instrument, sway one cycle per two beats, a little bounce on the beat
    const sway = Math.sin(cyc(t, 16));
    B.spine.rotation.set(0.1 + 0.025 * Math.cos(cyc(t, 32)) - 0.1 * shout, 0, 0.045 * sway + 0.03 * dip);
    // head: nod on the beat, look along the ring, lift on the shout
    const nod = 0.5 + 0.5 * Math.cos(cyc(t, 32));
    B.head.rotation.set(0.03 + 0.1 * nod - 0.5 * shout, 0.14 * Math.sin(cyc(t, 1) + 0.5) - 0.04 * sway, 0.04 * sway - 0.03 * dip);
    q.setFromAxisAngle(X, 0.3 * pos);
    B.elR.quaternion.copy(q);
    B.wrR.rotation.set(0, 0, 0.25 * pos);
    // on the shout he lifts the strumming hand off the strings
    B.shR.rotation.set(-0.5 * shout, 0, -0.25 * shout);
    B.shR.position.y -= 0.025 * dip;
    // fretting hand: shifts along the neck every 2 bars, small slides every 2 beats
    const ph = Math.floor(b / 8), pf = frac(b / 8) * 8;
    const s0 = FRET[(ph + 7) % 8], s1 = FRET[ph % 8];
    let s = lerp(s0, s1, smooth(0, 0.35, pf)) + 0.012 * Math.sin(cyc(t, 16) + 1.2);
    q.setFromAxisAngle(axisL, s / (rLen * 0.9));
    B.shL.quaternion.copy(q);
    // instrument rocks a hair with each strum and with the sway
    B.dran.rotation.set(0.0, 0.0, -0.06 * pos);
    // empty sleeve swings with the body and the breeze
    B.sleeve.rotation.set(0.08 * Math.sin(cyc(t, 16) - 0.8) + 0.04 * Math.sin(cyc(t, 7)), 0, -0.1 * sway);
  }
  return { mesh, update, height: 0.98 };
}

// =================================================================================================
// ELDER (grandmother) with a hand prayer wheel (mani khorlo) and a mala
export function buildElder() {
  const rig = new Rig();
  const o = {
    sex: 'f', chuba: PC.elChuba, chubaDk: PC.elChubaDk, trim: PC.elTrim, top: PC.elBlouse, sash: PC.elSash,
    skin: PC.elSkin, hair: PC.grey, hairHi: PC.greyHi, hairStyle: 'crown', earring: PC.turq, pangden: PANGDEN[0].map(mute),
    rimHead: 1,   // she sits turned three-quarters to the camera with the fire on her left: rim strip on that side
  };
  seatedBody(rig, o);
  // right hand holds the wheel up, out to her right side (the camera side) so the drum clears her body;
  // left hand rests on the knee telling the mala
  arm(rig, 'R', { sh: [-0.17, 0.57, -0.01], el: [-0.33, 0.41, 0.0], wr: [-0.37, 0.45, 0.1], hand: [-0.37, 0.48, 0.135] }, PC.elBlouse, PC.elBlouse, PC.elSkin, { w: 0.082, cuffLen: 0.07 });
  arm(rig, 'L', { sh: [0.17, 0.57, -0.01], el: [0.23, 0.37, 0.04], wr: [0.18, 0.24, 0.2], hand: [0.16, 0.215, 0.25] }, PC.elBlouse, PC.elBlouse, PC.elSkin, { w: 0.082, cuffLen: 0.07 });

  // prayer wheel: wooden handle, copper drum with silver bands, finial, weight on a short chain
  const hx = -0.37, hz = 0.14;
  const hy = 0.47;
  rig.bone('wheel', 'wrR', [hx, hy, hz]);
  rig.add('wheel', gBox(0.03, 0.2, 0.03, hx, hy + 0.04, hz), PC.handle);
  rig.bone('drum', 'wheel', [hx, hy + 0.185, hz]);
  const dy = hy + 0.185;
  rig.add('drum', paintSegments(gCyl(0.056, 0.056, 0.095, 8, hx, dy, hz), [PC.copper, PC.copperDk, PC.copper, PC.paintRed, PC.copper, PC.copperDk, PC.copper, PC.gold], PC.copper));
  rig.add('drum', gCyl(0.061, 0.061, 0.016, 8, hx, dy - 0.05, hz), PC.wheelSilver);
  rig.add('drum', gCyl(0.061, 0.061, 0.016, 8, hx, dy + 0.05, hz), PC.wheelSilver);
  rig.add('drum', gCyl(0.004, 0.022, 0.045, 6, hx, dy + 0.079, hz), PC.gold);
  rig.add('drum', gSeg([hx + 0.056, dy - 0.015, hz], [hx + 0.094, dy - 0.045, hz], 0.012, 0.012), PC.iron);
  rig.add('drum', gBox(0.034, 0.034, 0.034, hx + 0.099, dy - 0.055, hz), PC.iron);

  // mala: 12 beads looped over the fingers, hanging below the hand
  const mc = V(0.165, 0.175, 0.27);
  rig.bone('mala', 'wrL', mc.toArray());
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    rig.add('mala', gBox(0.026, 0.026, 0.026, mc.x, mc.y + Math.cos(a) * 0.045, mc.z + Math.sin(a) * 0.032), i === 0 ? PC.coral : PC.mala);
  }

  const mesh = rig.build(peopleMat(), 'elder');
  mesh.scale.setScalar(0.93);
  const B = mesh.userData.bones;

  function update(t) {
    resetPose(mesh);
    // stooped a little, rocking gently while she murmurs the mantra
    const stoop = 0.17 + 0.025 * Math.sin(cyc(t, 3));
    B.spine.rotation.set(stoop, 0, 0.018 * Math.sin(cyc(t, 2) + 1));
    // head follows the circle passing in front of her, nods to the shout
    const b = t / BEAT;
    const c = (((b + 16) % 32) + 32) % 32;
    const shout = smooth(14.75, 15.0, c) * (1 - smooth(15.8, 16.35, c));
    B.head.rotation.set(-0.13 + 0.04 * Math.sin(cyc(t, 3) + 1.5) + 0.12 * shout, 0.32 * Math.sin(cyc(t, 1) - 0.7), 0);
    // wheel: clockwise seen from above (negative turn about +y), one turn a second; the hand
    // circles the handle in step so the weight keeps it going
    const phi = cyc(t, 24);
    B.wheel.rotation.set(-stoop + 0.08 * Math.cos(phi), 0, 0.08 * Math.sin(phi));
    B.drum.rotation.set(0, -phi, 0);
    B.wrR.rotation.set(0.04 * Math.sin(phi), 0, 0.04 * Math.cos(phi));
    // mala: the thumb pulls one bead every 2 s (24 per loop = two full turns of 12 beads)
    const k = t / 2, kf = frac(k);
    const ang = (Math.floor(k) + smooth(0.0, 0.3, kf)) * (TAU / 12);
    B.mala.rotation.set(ang, 0, 0);
    B.wrL.rotation.set(0.12 * Math.exp(-kf * 9), 0, 0);
  }
  return { mesh, update, height: 0.86 };
}

// =================================================================================================
// CHILD: a little girl in a pink blouse and small green chuba, two braids with red yarn, clapping
export function buildChild() {
  const rig = new Rig();
  const o = {
    sex: 'f', chuba: PC.chChuba, chubaDk: PC.chChubaDk, trim: PC.chTrim, top: PC.chBlouse, sash: PC.chSash,
    skin: PAL.skin, hair: PC.hair, hairStyle: 'braids', earring: PC.coral, headScale: 1.22,
  };
  seatedBody(rig, o);
  // hands meet in front of the chest, well below the chin (bind pose = the clap)
  arm(rig, 'R', { sh: [-0.165, 0.57, -0.01], el: [-0.2, 0.35, 0.09], wr: [-0.07, 0.385, 0.255], hand: [-0.02, 0.4, 0.29] }, PC.chBlouse, PC.chBlouse, PAL.skin, { w: 0.085, cuffLen: 0.08 });
  arm(rig, 'L', { sh: [0.165, 0.57, -0.01], el: [0.2, 0.35, 0.09], wr: [0.07, 0.385, 0.255], hand: [0.02, 0.4, 0.29] }, PC.chBlouse, PC.chBlouse, PAL.skin, { w: 0.085, cuffLen: 0.08 });
  const mesh = rig.build(peopleMat(), 'child');
  mesh.scale.setScalar(0.66);
  const B = mesh.userData.bones;

  function update(t) {
    resetPose(mesh);
    const b = t / BEAT, bf = frac(b);
    const c = (((b + 16) % 32) + 32) % 32;
    const shout = smooth(14.6, 14.95, c) * (1 - smooth(15.9, 16.5, c));
    // claps land on the beat; she pauses to watch for a phrase now and then
    const p = Math.floor(b / 8) % 8, pf = frac(b / 8);
    const rest = (p === 2 || p === 6) ? smooth(0.0, 0.12, pf) * (1 - smooth(0.85, 1.0, pf)) : 0;
    const open = Math.pow(Math.sin(Math.PI * bf), 2) * (1 - rest) * (1 - shout) + rest * 0.35;
    const lift = -2.1 * shout;                                    // both arms up for the shout
    B.shL.rotation.set(lift - 0.15 * open, 0.55 * open + 0.2 * shout, 0);
    B.shR.rotation.set(lift - 0.15 * open, -0.55 * open - 0.2 * shout, 0);
    B.elL.rotation.set(0.25 * rest, 0, 0);
    B.elR.rotation.set(0.25 * rest, 0, 0);
    // bounce on the beat, look around during the rests
    const bounce = Math.abs(Math.sin(Math.PI * bf)) * (1 - rest);
    B.root.position.y = 0.012 * bounce;
    B.spine.rotation.set(0.04 + 0.04 * Math.cos(cyc(t, 32)) * (1 - rest) - 0.12 * shout, 0, 0.03 * Math.sin(cyc(t, 16)));
    B.head.rotation.set(-0.05 + 0.06 * (1 - bounce) - 0.25 * shout, rest * 0.6 * Math.sin(cyc(t, 2) + p), 0.06 * Math.sin(cyc(t, 16) + 0.5));
  }
  return { mesh, update, height: 0.62 };
}

// mute a pangden colour toward the scene's register (saturation ~ 50 %)
function mute(hex) {
  const c = new THREE.Color(hex), hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s * 0.62, hsl.l * 0.92 + 0.02);
  return c.getHex();
}
