// Grazing yak (dri) and a dozing Tibetan mastiff (do-khyi). One SkinnedMesh each.
// Model space: head toward +x, y up, ground at y = 0.
import * as THREE from 'three';
import { mat, cyc, frac, smooth, clamp, lerp, rng, wind } from './core.js';
import { Rig, gBox, gSeg, gLoft, paint, paintY, furMat, resetPose } from './life-rig.js';

const LOOPT = 48;
const tmod = (t) => ((t % LOOPT) + LOOPT) % LOOPT;
// 0 outside [a - r, b + r], 1 inside [a, b]
const win = (x, a, b, r) => smooth(a - r, a, x) * (1 - smooth(b, b + r, x));
// a quick blip at each of n events per 24 s (phase off), duration dur (fraction of the period)
const blip = (t, n, off, dur) => { const f = frac((t * n) / 24 + off); return f < dur ? Math.sin(Math.PI * f / dur) : 0; };

// ---- yak -------------------------------------------------------------------------------------------
// Piebald (a dri, not a wild yak): white saddle over the shoulder hump spilling down the near flank,
// painted in object space on dark fur only, so it follows hull and skirt strands with a dithered edge.
const glc = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
function yakMat(side) {
  return mat(0xffffff, {
    vertexColors: true, grain: 0.11, grainScale: 30,
    fragment: {
      head: '',
      body: /* glsl */`
        {
          vec3 p = vGLocal;
          float lum = dot(vColor, vec3(0.299, 0.587, 0.114));
          if (lum < 0.12) {
            float n = gNoise2(p.xy * 5.0 + p.z * 3.0) - 0.5;
            float n2 = gNoise2(p.zy * 7.0 + 11.0) - 0.5;
            float d1 = length((p - vec3(0.26, 1.24, 0.0)) / vec3(0.3, 0.3, 0.62)) + n * 0.55 + n2 * 0.25;
            float d2 = length((p - vec3(0.06, 0.84, ${(0.3 * side).toFixed(2)})) / vec3(0.2, 0.2, 0.2)) + n * 0.6;
            float d = min(d1, d2);
            if (d < 1.0 + (gBayer4(gl_FragCoord.xy) - 0.5) * 0.14) diffuseColor.rgb = YAK_WHITE * (0.9 + 0.16 * gHash13(floor(p * 30.0)));
          }
        }
      `.replace('YAK_WHITE', glc(0xddd6c8)),
    },
  });
}
const YC = {
  base: 0x2a2320, dark: 0x1d1917, top: 0x463a32, tip: 0x5c4a3c, tipLt: 0x6e5a48,
  white: 0xe4ded2, whiteDk: 0xc2baac, horn: 0xd6cdb8, hornTip: 0x8c8474, hoof: 0x171312, nose: 0x161211,
  tassel: 0xb03229, tassel2: 0xd8a43a, tassel3: 0x2f6aa0,
};
export function buildYak(side = 1) {
  const R = rng(9001);
  const rig = new Rig();
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('body', 'root', [0, 0.78, 0]);
  rig.bone('neck', 'body', [0.6, 0.98, 0]);
  rig.bone('head', 'neck', [0.92, 0.74, 0]);
  rig.bone('earL', 'head', [1.0, 0.8, 0.15]);
  rig.bone('earR', 'head', [1.0, 0.8, -0.15]);
  rig.bone('tail1', 'body', [-1.0, 1.02, 0]);
  rig.bone('tail2', 'tail1', [-1.08, 0.72, 0]);
  rig.bone('skirtL', 'body', [0, 0.74, 0.3]);
  rig.bone('skirtR', 'body', [0, 0.74, -0.3]);
  rig.bone('legBL', 'root', [-0.78, 0.55, 0.17]);
  const bx = (bone, hex, x0, x1, y0, y1, wz, z = 0) => rig.box(bone, hex, x1 - x0, y1 - y0, wz, (x0 + x1) / 2, (y0 + y1) / 2, z);

  // body: one lofted hull along x [x, top, bottom, halfWidth] — rump, long back rising to the big
  // shoulder hump, dropping steeply to the low-slung neck — shaded dark below to sun-bleached on top
  const SL = [
    [-1.07, 0.9, 0.68, 0.17], [-1.0, 0.99, 0.58, 0.25], [-0.82, 1.03, 0.52, 0.29], [-0.5, 1.06, 0.5, 0.31],
    [-0.2, 1.11, 0.49, 0.315], [0.05, 1.2, 0.49, 0.315], [0.22, 1.32, 0.5, 0.305], [0.38, 1.42, 0.5, 0.29],
    [0.52, 1.38, 0.52, 0.28], [0.64, 1.24, 0.55, 0.26], [0.74, 1.06, 0.6, 0.22], [0.8, 0.93, 0.66, 0.15],
  ];
  const at = (x, k) => {
    for (let i = 0; i < SL.length - 1; i++) if (x <= SL[i + 1][0]) { const u = clamp((x - SL[i][0]) / (SL[i + 1][0] - SL[i][0])); return lerp(SL[i][k], SL[i + 1][k], u); }
    return SL[SL.length - 1][k];
  };
  const topAt = (x) => at(x, 1), widAt = (x) => 2 * at(x, 3);
  rig.add('body', paintY(gLoft(SL, 12, 0.62), YC.base, YC.top, 0.95, 1.36));
  // shaggy tufts breaking the top line of the hump and back
  for (let k = 0; k < 14; k++) {
    const x = -0.85 + (k / 13) * 1.45 + (R() - 0.5) * 0.06;
    rig.add('body', paint(gBox(0.07 + R() * 0.05, 0.05, 0.1 + R() * 0.12, x, topAt(x) - 0.01, (R() - 0.5) * 0.2, 0, R(), 0.25 * (R() - 0.5)), R() < 0.5 ? YC.tip : YC.top));
  }
  // hair core under the belly so the skirt reads solid between the legs
  bx('body', YC.dark, -0.86, 0.66, 0.24, 0.52, 0.48);

  // legs: short and stocky, mostly hidden by the skirt
  for (const [x, z] of [[0.5, 0.17], [0.5, -0.17], [-0.78, -0.17]]) {
    bx('root', YC.dark, x - 0.06, x + 0.06, 0.04, 0.52, 0.12, z);
    bx('root', YC.hoof, x - 0.065, x + 0.075, 0, 0.06, 0.13, z);
  }
  bx('legBL', YC.dark, -0.84, -0.72, 0.04, 0.52, 0.12, 0.17);
  bx('legBL', YC.hoof, -0.845, -0.705, 0, 0.06, 0.13, 0.17);

  // the long skirt: thin strands (about 1 art px) dark at the root, sun-bleached brown toward the tip,
  // rooted at staggered heights on the flank and flaring out into a ragged A-line hem
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
      // hem: lowest under the shoulders and chest, shorter toward the flank behind, ragged throughout
      const hem = 0.1 + 0.12 * R() * R() + 0.1 * (1 - smooth(-0.2, 0.4, x)) + 0.08 * (1 - smooth(-1.0, -0.75, x));
      const root = 0.55 + R() * 0.3;
      strand(bone, x, s * (wz - 0.005), root, hem, s * (0.05 + R() * 0.06), 0.03 + R() * 0.012, R() < 0.25 ? YC.tipLt : YC.tip);
      x += 0.026 + R() * 0.03;
    }
    // shorter locks higher on the flank and over the shoulder for shag
    for (let k = 0; k < 16; k++) {
      const xx = -0.8 + R() * 1.45, wz = widAt(xx) / 2;
      const y0 = Math.min(topAt(xx) - 0.08, 0.78 + R() * 0.3);
      strand(bone, xx, s * (wz + 0.004), y0, y0 - 0.2 - R() * 0.16, s * 0.025, 0.028, YC.tip);
    }
  }
  // chest/brisket fringe and the "trousers" of hair on the hind thighs
  for (let z = -0.22; z <= 0.22; z += 0.04) strand('body', 0.77 + R() * 0.02, z, 0.78 + R() * 0.12, 0.14 + R() * 0.1, 0.03);
  for (let z = -0.22; z <= 0.22; z += 0.045) strand('body', -1.055, z, 0.9 - R() * 0.1, 0.3 + R() * 0.12, -0.03);

  // neck with a hairy dewlap
  rig.seg('neck', YC.base, [0.6, 1.02, 0], [0.96, 0.74, 0], 0.38, 0.4);
  rig.seg('neck', YC.top, [0.62, 1.12, 0], [0.9, 0.86, 0], 0.08, 0.3);
  for (let i = 0; i < 7; i++) {
    const x = 0.62 + i * 0.045;
    const y0 = 0.82 - i * 0.03;
    const g = gSeg([x, y0, (R() - 0.5) * 0.2], [x + 0.02, y0 - 0.22 - R() * 0.08, (R() - 0.5) * 0.24], 0.035, 0.03);
    rig.add('neck', paintY(g, YC.tip, YC.base, y0 - 0.3, y0 - 0.05));
  }

  // head: skull, muzzle with a white blaze, shaggy forelock, horns, ears with wool tassels
  bx('head', YC.base, 0.86, 1.22, 0.6, 0.9, 0.3);
  bx('head', YC.base, 1.2, 1.36, 0.56, 0.76, 0.24);
  bx('head', YC.nose, 1.36, 1.38, 0.6, 0.71, 0.18);
  bx('head', YC.top, 0.88, 1.1, 0.88, 0.97, 0.26);
  bx('head', YC.white, 1.04, 1.225, 0.84, 0.906, 0.13);
  bx('head', YC.white, 1.2, 1.345, 0.715, 0.766, 0.11);
  bx('head', YC.white, 1.218, 1.226, 0.7, 0.88, 0.12);
  bx('head', YC.white, 1.36, 1.366, 0.7, 0.76, 0.1);
  for (const s of [1, -1]) {
    const hz = s * 0.13;
    rig.add('head', paint(gSeg([1.0, 0.86, hz], [1.0, 0.91, s * 0.27], 0.06, 0.06), YC.horn));
    rig.add('head', paint(gSeg([1.0, 0.91, s * 0.27], [1.05, 1.03, s * 0.31], 0.05, 0.05), YC.horn));
    rig.add('head', paint(gSeg([1.05, 1.03, s * 0.31], [1.11, 1.1, s * 0.26], 0.038, 0.038), YC.hornTip));
    const ear = s > 0 ? 'earL' : 'earR';
    rig.add(ear, paint(gSeg([1.0, 0.8, s * 0.14], [0.97, 0.75, s * 0.29], 0.075, 0.03), YC.base));
    rig.add(ear, paint(gBox(0.045, 0.09, 0.045, 0.965, 0.69, s * 0.29), YC.tassel));
    rig.add(ear, paint(gBox(0.03, 0.03, 0.03, 0.965, 0.75, s * 0.31), s > 0 ? YC.tassel2 : YC.tassel3));
  }

  // tail: a short stalk and a big white switch reaching the hocks
  rig.seg('tail1', YC.base, [-1.0, 1.04, 0], [-1.08, 0.72, 0], 0.075, 0.075);
  rig.add('tail2', paintY(gSeg([-1.08, 0.74, 0], [-1.1, 0.3, 0], 0.15, 0.13), YC.white, YC.whiteDk, 0.35, 0.72));
  for (let i = 0; i < 4; i++) rig.add('tail2', paint(gSeg([-1.14 + i * 0.03, 0.34, (R() - 0.5) * 0.08], [-1.15 + i * 0.03, 0.22 + R() * 0.05, (R() - 0.5) * 0.1], 0.03, 0.03), YC.white));

  const mesh = rig.build(yakMat(side), 'yak');
  const B = mesh.userData.bones;
  const lookY = { v: 0 };

  function update(t) {
    resetPose(mesh);
    const tt = tmod(t);
    // head up to look round and chew twice per loop, grazing otherwise
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
    // tail: lazy sway plus a hard swish at flies every 6 s, alternating sides
    const tailAt = (tq) => {
      const f = frac((tq * 4) / 24 + 0.4), k = Math.floor((tq * 4) / 24 + 0.4);
      const sw = f < 0.12 ? Math.sin(Math.PI * f / 0.12) : 0;
      return 0.14 * Math.sin(cyc(tq, 5)) + (k % 2 ? 0.55 : -0.55) * sw;
    };
    B.tail1.rotation.set(tailAt(t), 0, 0.06 * Math.sin(cyc(t, 3)));
    B.tail2.rotation.set(0.7 * tailAt(t - 0.2) - 0.3 * tailAt(t), 0, 0);
    // weight shift once a loop: rests a hind hoof, the body settles over the other legs
    const W = win(tt, 28.5, 33.5, 0.9);
    B.body.position.z += 0.03 * W;
    B.body.rotation.set(0.025 * W + 0.006 * Math.sin(cyc(t, 5)), 0, 0.01 * Math.sin(cyc(t, 5)));
    B.body.scale.set(1, 1 + 0.008 * Math.sin(cyc(t, 5)), 1 + 0.01 * Math.sin(cyc(t, 5)));
    B.legBL.rotation.set(0.0, 0, -0.18 * W);
    B.legBL.position.y += 0.03 * W;
    // the skirt swings in the breeze and with the body
    const wd = wind(t, -4.4, 1.6);
    B.skirtL.rotation.set(0.05 * wd - 0.4 * 0.025 * W, 0, 0.03 * Math.sin(cyc(t, 7)));
    B.skirtR.rotation.set(0.05 * wd - 0.4 * 0.025 * W, 0, 0.03 * Math.sin(cyc(t, 7) + 1));
  }
  return { mesh, update, lookY };
}

// ---- Tibetan mastiff -----------------------------------------------------------------------------
const DC = {
  black: 0x1f1a19, blackLt: 0x2f2724, mane: 0x2a221f, maneTip: 0x4c3c30, tan: 0x96643a, tanLt: 0xad7a46,
  collar: 0xa62f2a, collarDk: 0x7e2420, tailTip: 0x6a5240, nose: 0x0f0d0c, eye: 0x3a2a1a,
};
export function buildDog(side = -1) {
  // side: which flank (z sign) faces the camera; the tail curls onto that side
  const R = rng(4711);
  const rig = new Rig();
  rig.bone('root', null, [0, 0, 0]);
  rig.bone('body', 'root', [-0.1, 0.17, 0]);
  rig.bone('chest', 'body', [0.18, 0.2, 0]);
  rig.bone('head', 'chest', [0.36, 0.38, 0]);
  rig.bone('earL', 'head', [0.43, 0.5, 0.1]);
  rig.bone('earR', 'head', [0.43, 0.5, -0.1]);
  rig.bone('tail1', 'body', [-0.5, 0.25, side * 0.06]);
  rig.bone('tail2', 'tail1', [-0.52, 0.35, side * 0.16]);
  const bx = (bone, hex, x0, x1, y0, y1, wz, z = 0) => rig.box(bone, hex, x1 - x0, y1 - y0, wz, (x0 + x1) / 2, (y0 + y1) / 2, z);

  // torso: a lofted hull lying on the ground, round haunch, tucked waist, deep chest
  rig.add('body', paintY(gLoft([[-0.56, 0.2, 0.05, 0.1], [-0.5, 0.28, 0.02, 0.18], [-0.38, 0.32, 0.02, 0.2], [-0.2, 0.3, 0.02, 0.17],
    [0.0, 0.33, 0.02, 0.18], [0.14, 0.36, 0.02, 0.19]], 10, 0.7), DC.black, DC.blackLt, 0.2, 0.34));
  for (const s of [1, -1]) {
    // folded hind leg: thigh bulging on the flank, tan hock, paw tucked forward
    rig.add('body', paint(gBox(0.26, 0.17, 0.08, -0.36, 0.11, s * 0.19, 0, 0, -0.2), DC.blackLt));
    bx('body', DC.tan, -0.5, -0.42, 0.02, 0.1, 0.06, s * 0.2);
    bx('body', DC.tan, -0.24, -0.1, 0.0, 0.05, 0.08, s * 0.2);
  }
  // chest with a tan bib
  rig.add('chest', paintY(gLoft([[0.06, 0.37, 0.02, 0.19], [0.22, 0.38, 0.04, 0.18], [0.32, 0.34, 0.08, 0.14]], 10, 0.7), DC.black, DC.blackLt, 0.25, 0.38));
  bx('chest', DC.tan, 0.3, 0.33, 0.08, 0.24, 0.14);
  // the lion-like mane ruff round neck and shoulders, lighter at the tips
  rig.add('chest', paintY(gLoft([[0.06, 0.42, 0.16, 0.16], [0.14, 0.53, 0.12, 0.24], [0.26, 0.57, 0.12, 0.26], [0.36, 0.5, 0.16, 0.2], [0.4, 0.42, 0.2, 0.13]], 10, 0.55), DC.mane, DC.maneTip, 0.32, 0.56));
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI;
    rig.add('chest', paint(gBox(0.05, 0.05, 0.05, 0.16 + R() * 0.16, 0.34 + Math.sin(a) * 0.22, Math.cos(a) * 0.25, R(), R(), R()), DC.maneTip));
  }
  // red yak-wool collar ruff (kekhor) round the throat, in front of the mane
  rig.add('chest', paintY(gLoft([[0.33, 0.5, 0.14, 0.235], [0.37, 0.52, 0.13, 0.25], [0.42, 0.48, 0.16, 0.2]], 10, 0.55), DC.collarDk, DC.collar, 0.2, 0.45));
  // forelegs stretched forward, tan below, big tan paws
  for (const s of [1, -1]) {
    rig.seg('root', DC.black, [0.14, 0.08, s * 0.1], [0.3, 0.05, s * 0.1], 0.1, 0.09);
    rig.seg('root', DC.tan, [0.3, 0.05, s * 0.1], [0.52, 0.04, s * 0.1], 0.08, 0.075);
    bx('root', DC.tanLt, 0.5, 0.6, 0.0, 0.06, 0.095, s * 0.1);
  }
  // head: broad skull, tan muzzle and cheeks, the black-and-tan "four eyes" brow spots, drop ears
  bx('head', DC.black, 0.32, 0.54, 0.32, 0.52, 0.23);
  bx('head', DC.blackLt, 0.34, 0.52, 0.515, 0.535, 0.17);
  bx('head', DC.tan, 0.54, 0.66, 0.33, 0.42, 0.13);
  bx('head', DC.black, 0.54, 0.65, 0.415, 0.44, 0.1);
  bx('head', DC.nose, 0.655, 0.675, 0.395, 0.435, 0.07);
  for (const s of [1, -1]) {
    bx('head', DC.tan, 0.44, 0.54, 0.32, 0.38, 0.03, s * 0.11);
    bx('head', DC.tan, 0.53, 0.545, 0.47, 0.5, 0.035, s * 0.05);
    bx('head', DC.eye, 0.535, 0.547, 0.435, 0.455, 0.03, s * 0.055);
    rig.seg(s > 0 ? 'earL' : 'earR', DC.black, [0.43, 0.5, s * 0.1], [0.45, 0.39, s * 0.128], 0.075, 0.03);
  }
  // bushy tail curled up over the near hip and forward along the flank
  rig.seg('tail1', DC.mane, [-0.5, 0.25, side * 0.06], [-0.52, 0.35, side * 0.16], 0.09, 0.09);
  rig.add('tail2', paintY(gSeg([-0.52, 0.35, side * 0.16], [-0.34, 0.38, side * 0.23], 0.13, 0.11), DC.maneTip, DC.tailTip, 0.32, 0.44));
  rig.add('tail2', paint(gSeg([-0.36, 0.38, side * 0.23], [-0.22, 0.33, side * 0.24], 0.08, 0.08), DC.tailTip));

  const mesh = rig.build(furMat(), 'dog');
  const B = mesh.userData.bones;
  const look = { yaw: 0 };

  function update(t) {
    resetPose(mesh);
    const tt = tmod(t);
    // head up to watch the dancers twice a loop, chin on the paws otherwise
    const U = win(tt, 7.2, 17.5, 1.4) + win(tt, 30.8, 39.5, 1.2);
    B.head.rotation.order = 'YZX';
    const follow = 0.18 * Math.sin(cyc(t, 2) + 0.4);
    B.head.position.x += lerp(0.03, 0, U);
    B.head.position.y += lerp(-0.15, 0, U);
    B.head.rotation.set(0.05 * Math.sin(cyc(t, 1)) * U, U * (look.yaw + follow), lerp(-0.12, 0.06, U) + 0.03 * U * Math.sin(cyc(t, 32)));
    // breathing: slow when dozing, a bit quicker when alert
    const br = Math.sin(cyc(t, 7)) * (1 - U) + Math.sin(cyc(t, 12)) * U;
    B.body.scale.set(1, 1 + 0.025 * br, 1 + 0.03 * br);
    B.chest.scale.set(1, 1 + 0.02 * br, 1 + 0.02 * br);
    // ear twitches (a fly, a shout)
    const e1 = blip(t, 5, 0.21, 0.035), e2 = blip(t, 3, 0.67, 0.035);
    B.earL.rotation.set(-0.5 * e1, 0, 0.3 * e1 + 0.15 * U);
    B.earR.rotation.set(0.5 * e2, 0, 0.3 * e2 + 0.15 * U);
    // tail thumps when it looks up, an occasional single thump while dozing
    const thump = (win(tt, 7.6, 10.4, 0.4) + win(tt, 31.2, 33.6, 0.4)) * Math.max(0, Math.sin(cyc(t, 44))) + blip(t, 2, 0.8, 0.03);
    B.tail1.rotation.set(-side * 0.55 * thump, 0, 0.25 * thump);
    B.tail2.rotation.set(-side * 0.2 * thump, 0, 0);
  }
  return { mesh, update, look };
}
