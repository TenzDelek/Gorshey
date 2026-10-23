// Camp props: the mani-stone cairn with painted/carved slabs and a khata on a stick, the whitewashed
// sangbum incense burner (its juniper smoke is animated in camp.js), and the woodpile of split
// juniper with dried yak-dung patties stacked and heaped in a wicker basket.
import * as THREE from 'three';
import { LAYOUT, rng } from './core.js';
import { CP, M, jitter, insidePatch, glc } from './camp-lib.js';
import { khata } from './camp-flags.js';

// solid-material kinds (aK.x): 0 plain, 1 mani text face, 2 wicker, 3 wood, 4 glow, 5 rug, 6 brocade, 7 dung
export const SOLID_GLSL = /* glsl */`
  varying vec4 vK;
  vec3 maniInk(float i) {
    if (i < 0.5) return ${glc(0xe8e4d8)};
    if (i < 1.5) return ${glc(0x77a35e)};
    if (i < 2.5) return ${glc(0xdcb64c)};
    if (i < 3.5) return ${glc(0x6a93c6)};
    if (i < 4.5) return ${glc(0xc4523f)};
    return ${glc(0xe8e4d8)};
  }
`;
export const SOLID_FRAG = /* glsl */`
  {
    float kind = floor(vK.x + 0.5);
    vec3 c = diffuseColor.rgb;
    float h = gHash13(floor(vGWorld * 27.0) + 7.0);
    if (kind == 1.0) {
      // om ma ni pad me hum: two rows of six syllables, a head-line over each row, stems below
      vec2 uv = vK.yz;
      float x = (uv.x - 0.07) / 0.86;
      float li = floor(x * 6.0);
      float fx = fract(x * 6.0);
      float inX = step(0.0, x) * step(x, 1.0);
      float r1 = uv.y - 0.52, r2 = uv.y - 0.12;
      float head = (step(abs(r1 - 0.3), 0.05) + step(abs(r2 - 0.3), 0.05)) * step(fx, 0.82);
      float stem = (step(abs(r1 - 0.14), 0.13) + step(abs(r2 - 0.14), 0.13)) * (step(abs(fx - 0.22), 0.13) + step(abs(fx - 0.62), 0.12) * step(0.45, gHash12(vec2(li, floor(uv.y * 2.0)) + vK.w)));
      float on = clamp(head + stem, 0.0, 1.0) * inX;
      vec3 ink = vK.w > 0.5 ? maniInk(li) : ${glc(0xc9c6bd)};
      c = mix(c, ink, on);
    } else if (kind == 2.0) {
      // wicker: staggered horizontal weave with dark gaps and vertical stakes
      float row = floor(vK.z / 0.037);
      float u = vK.y / 0.06 + mod(row, 2.0) * 0.5;
      c *= 0.82 + 0.3 * step(0.25, fract(u)) * step(0.3, fract(vK.z / 0.037));
    } else if (kind == 3.0) {
      c *= 0.84 + 0.32 * h;
    } else if (kind == 4.0) {
      float pulse = 0.7 + 0.3 * sin(cycP(37.0) + h * 6.2831) * sin(cycP(13.0) + vGWorld.x * 7.0);
      float k = vK.w > 0.5 ? (0.35 + 0.65 * uNight) : (0.55 + 0.6 * uNight);
      totalEmissiveRadiance += c * pulse * k;
      c *= 0.3;
    } else if (kind == 5.0) {
      vec2 uv = vK.yz;
      float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      if (e < 0.09) c = ${glc(CP.rugBlue)} * 0.5;
      if (abs(e - 0.11) < 0.015) c = ${glc(CP.rugGold)} * 0.5;
      float dm = abs(uv.x - 0.5) + abs(uv.y - 0.5) * 0.9;
      if (dm < 0.2 && dm > 0.12) c = ${glc(CP.rugGold)} * 0.5;
      if (dm < 0.07) c = ${glc(CP.rugBlue)} * 0.5;
    } else if (kind == 6.0) {
      c *= 0.85 + 0.3 * step(0.5, fract((vGWorld.x + vGWorld.z) * 9.0)) * step(0.4, h);
    } else if (kind == 7.0) {
      c = mix(c, ${glc(CP.dungDry)}, step(0.8, h));
      c *= 0.9 + 0.2 * gHash13(floor(vGWorld * 40.0));
    }
    diffuseColor.rgb = c;
  }
`;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- mani cairn -------------------------------------------------------------------------------
export function buildMani({ solids, cloth }) {
  const R = rng(108);
  const [cx, cz] = insidePatch(...LAYOUT.mani.pos, 0.6, 0.4);
  const W = new THREE.Matrix4().makeTranslation(cx, 0, cz);
  const at = (mm) => mm.premultiply(W);
  const slates = [CP.slate, CP.slate2, CP.slate3];
  const stone = (g, mm, col) => solids.add(g, at(mm), col, { aK: [0, 0, 0, 0] });
  // base boulders
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + R() * 0.3, r = 0.3 + R() * 0.06;
    const s = 0.11 + R() * 0.05;
    stone(jitter(new THREE.IcosahedronGeometry(1, 0), 0.22, k * 5.7, false), M(Math.cos(a) * r, s * 0.55, Math.sin(a) * r, R(), R() * 3, R(), s * 1.3, s * 0.9, s * 1.05), R() < 0.35 ? CP.fieldStone : slates[k % 3]);
  }
  stone(jitter(new THREE.IcosahedronGeometry(1, 0), 0.2, 3.3, false), M(0, 0.16, 0, 0.2, 0.5, 0.1, 0.32, 0.2, 0.3), CP.slate3);
  // flat slates stacked, getting smaller
  let y = 0.24;
  for (let k = 0; k < 8; k++) {
    const sc = 1 - k * 0.09;
    const w = 0.56 * sc + R() * 0.06, d = 0.44 * sc + R() * 0.05, t = 0.05 + R() * 0.025;
    stone(jitter(new THREE.BoxGeometry(1, 1, 1, 2, 1, 2), 0.1, k * 9.1, false), M((R() - 0.5) * 0.05, y + t / 2, (R() - 0.5) * 0.05, (R() - 0.5) * 0.14, R() * 3, (R() - 0.5) * 0.14, w, t, d), slates[(k + 1) % 3]);
    y += t * 0.9;
  }
  const topY = y;
  // painted and carved slabs set into the pile, faces turned out toward the camp
  // [direction, height of the slab foot, width, height, painted]
  const slabs = [[-0.5, 0.2, 0.3, 0.24, 1], [0.05, 0.26, 0.34, 0.26, 1], [0.6, 0.2, 0.28, 0.22, 0], [1.1, 0.27, 0.3, 0.24, 1], [1.65, 0.2, 0.26, 0.2, 0], [0.32, 0.46, 0.24, 0.18, 1], [0.95, 0.5, 0.22, 0.17, 0]];
  slabs.forEach(([phi, fy, w, h, painted], k) => {
    const r = 0.36 - fy * 0.35;
    const lean = 0.42 + R() * 0.1;
    const m = at(M(Math.sin(phi) * r, fy, Math.cos(phi) * r, 0, phi, 0).multiply(M(0, 0, 0, -lean, 0, (R() - 0.5) * 0.12)));
    const g = jitter(new THREE.BoxGeometry(w, h, 0.05, 2, 2, 1), 0.012, k * 4.4, false);
    g.translate(0, h / 2, 0);
    solids.add(g, m.clone(), slates[k % 3], { aK: [0, 0, 0, 0] });
    const face = new THREE.PlaneGeometry(w * 0.92, h * 0.86);
    face.translate(0, h / 2, 0.027);
    solids.add(face, m.clone(), slates[(k + 2) % 3], (i, p, n, l) => ({ aK: [1, l.x / (w * 0.92) + 0.5, (l.y - h * 0.07) / (h * 0.86), painted] }));
  });
  // one more painted stone on the top
  {
    const m = at(M(0.02, topY + 0.02, 0.03, -0.1, 0.75, 0.04));
    solids.add(new THREE.BoxGeometry(0.24, 0.04, 0.17), m.clone(), CP.slate2, { aK: [0, 0, 0, 0] });
    const face = new THREE.PlaneGeometry(0.22, 0.15);
    face.rotateX(-Math.PI / 2); face.translate(0, 0.021, 0);
    solids.add(face, m.clone(), CP.slate2, (i, p, n, l) => ({ aK: [1, l.x / 0.22 + 0.5, -l.z / 0.15 + 0.5, 1] }));
  }
  // white quartz stones offered on top
  for (const [x, z, sz] of [[0.1, -0.06, 0.06], [-0.08, 0.1, 0.05], [0.12, 0.12, 0.045]]) {
    stone(jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, x * 40, false), M(x, topY + sz * 0.5, z, x * 9, z * 7, 0, sz * 1.2, sz * 0.85, sz), CP.quartz);
  }
  // stick with a khata
  const stickTop = V(cx - 0.08, topY + 0.6, cz - 0.06);
  solids.add(new THREE.CylinderGeometry(0.02, 0.024, 0.7, 4), M(cx - 0.08, topY + 0.25, cz - 0.06, 0.04, 0, -0.03), CP.poleDark, { aK: [3, 0, 0, 0] });
  khata(cloth, stickTop, 0.42);
  return { pos: [cx, cz], stickTop };
}

// ---- sangbum --------------------------------------------------------------------------------
export const SANG = { top: 0.745 };
export function buildSangbum({ solids }) {
  const [sx, sz] = LAYOUT.sangbum.pos;
  const ry = Math.atan2(-sx, -sz) + 0.25;
  const W = M(sx, 0, sz, 0, ry, 0);
  const at = (mm) => mm.premultiply(W);
  const wash = (geo, mm, col = CP.white) => solids.add(geo, at(mm), (i, p, n) => (n.y < -0.5 ? CP.whiteShade : col), { aK: [0, 0, 0, 0] });
  wash(jitter(new THREE.BoxGeometry(0.64, 0.14, 0.64, 2, 1, 2), 0.012, 1, true), M(0, 0.07, 0), CP.whiteShade);
  wash(new THREE.BoxGeometry(0.52, 0.12, 0.52), M(0, 0.2, 0));
  wash(new THREE.BoxGeometry(0.42, 0.26, 0.42), M(0, 0.39, 0));
  solids.add(new THREE.BoxGeometry(0.426, 0.03, 0.426), at(M(0, 0.47, 0)), CP.ochre, { aK: [0, 0, 0, 0] });
  const dome = new THREE.SphereGeometry(0.21, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  wash(dome, M(0, 0.525, 0, 0, 0, 0, 1, 0.85, 1));
  wash(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 7), M(0, 0.705, 0));
  // soot-dark mouth on top with embers deep inside
  solids.add(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 7), at(M(0, 0.742, 0)), 0x2a2622, { aK: [0, 0, 0, 0] });
  solids.add(new THREE.BoxGeometry(0.05, 0.01, 0.04), at(M(0.01, 0.744, -0.005)), 0xff6a1e, { aK: [4, 0, 0, 0] });
  // front stoking opening: soot stain, dark mouth, glowing embers
  const fz = 0.212;
  solids.add(new THREE.PlaneGeometry(0.22, 0.09), at(M(0, 0.47, fz + 0.001)), 0x8f8a80, { aK: [0, 0, 0, 0] });
  solids.add(new THREE.PlaneGeometry(0.15, 0.15), at(M(0, 0.36, fz + 0.002)), 0x221e1b, { aK: [0, 0, 0, 0] });
  solids.add(new THREE.PlaneGeometry(0.11, 0.04), at(M(0, 0.305, fz + 0.003)), 0xff7a22, { aK: [4, 0, 0, 0] });
  // juniper sprigs offered on the step
  for (let k = 0; k < 4; k++) {
    const g = jitter(new THREE.IcosahedronGeometry(0.05, 0), 0.02, k * 2.1, false);
    solids.add(g, at(M(-0.15 + k * 0.1, 0.285, 0.23 + (k % 2) * 0.02, 0, k, 0, 1.4, 0.7, 1)), k % 2 ? CP.juniper : CP.juniperLight);
  }
  return { mouth: new THREE.Vector3(sx, SANG.top, sz) };
}

// ---- woodpile -------------------------------------------------------------------------------
export function buildWoodpile({ solids }) {
  const R = rng(77);
  const [wx, wz] = LAYOUT.woodpile.pos;
  // logs lie broadside to the camera: bark stripes on screen, cut ends catching the sun on the right
  const W = M(wx, 0, wz, 0, 0.12, 0);
  const at = (mm) => mm.premultiply(W);
  // a log along local x: whole (bark) or split (pale split face, bark half turned by `rot`)
  const log = (x, y, z, len, r, split, rot = 0, yaw = 0) => {
    const g = split
      ? new THREE.CylinderGeometry(r, r, len, 6, 1, false, 0, Math.PI)
      : new THREE.CylinderGeometry(r * 0.94, r, len, 7, 1, false);
    g.rotateZ(Math.PI / 2);
    if (split) g.rotateX(rot);
    const mm = at(M(x, y, z, 0, yaw + (R() - 0.5) * 0.1, 0));
    const capCol = R() < 0.5 ? CP.splitWood : CP.splitWood2, barkCol = R() < 0.6 ? CP.bark : CP.barkDark;
    solids.add(g, mm, (i, p, n, l, nl) => (Math.abs(nl.x) > 0.7 ? capCol : barkCol), { aK: [3, 0, 0, 0] });
    if (split) {
      const f = new THREE.PlaneGeometry(len, r * 2);
      f.rotateX(Math.PI / 2);
      f.rotateX(rot);
      solids.add(f, mm.clone(), capCol, { aK: [3, 0, 0, 0] });
    }
  };
  // bearers across, then a stack of split juniper 5-4-3-2
  for (const x of [-0.24, 0.24]) {
    const g = new THREE.CylinderGeometry(0.045, 0.05, 0.7, 6);
    g.rotateX(Math.PI / 2);
    solids.add(g, at(M(x, 0.045, 0)), CP.barkDark, { aK: [3, 0, 0, 0] });
  }
  const rows = [[5, 0.12], [4, 0.215], [3, 0.31], [2, 0.405], [1, 0.5]];
  rows.forEach(([n, y], ri) => {
    for (let k = 0; k < n; k++) {
      const z = (k - (n - 1) / 2) * 0.112;
      const split = ri >= 3 && R() < 0.6;
      log((R() - 0.5) * 0.07, y, z, 0.66 + R() * 0.12, 0.054 + R() * 0.01, split, split ? Math.PI + (R() - 0.5) * 0.8 : 0);
    }
  });
  log(0.12, 0.035, 0.44, 0.55, 0.035, false, 0, 0.35);
  log(-0.05, 0.03, -0.4, 0.5, 0.03, true, Math.PI, -0.3);

  // dried yak-dung patties
  const patty = (mm, big = 1) => {
    const g = jitter(new THREE.CylinderGeometry(0.1 * big, 0.106 * big, 0.036, 9), 0.012, R() * 50, false);
    const topCol = R() < 0.6 ? CP.dungDry : CP.dung2;
    solids.add(g, mm, (i, p, n, l, nl) => (nl.y > 0.5 ? topCol : nl.y < -0.5 ? CP.dung : CP.dung2), { aK: [7, 0, 0, 0] });
  };
  // a neat column, like a stack of flat bread
  let py = 0.018;
  for (let k = 0; k < 13; k++) {
    patty(at(M(-0.6 + (R() - 0.5) * 0.035, py, -0.05 + (R() - 0.5) * 0.035, (R() - 0.5) * 0.08, R() * 3, (R() - 0.5) * 0.08)), 1.05);
    py += 0.034;
  }
  // wicker back-basket heaped with patties
  {
    const bx = 0.12, bz = -0.5, h = 0.42;
    const wick = (i, p, n, l) => ({ aK: [2, Math.atan2(l.z, l.x) * 0.19, l.y + h / 2, 0] });
    solids.add(new THREE.CylinderGeometry(0.19, 0.15, h, 12, 1, true), at(M(bx, h / 2, bz)), (i, p, n, l, nl) => (nl.y < -0.3 ? CP.wicker2 : CP.wicker), wick);
    const inner = new THREE.CylinderGeometry(0.182, 0.142, h - 0.01, 12, 1, true);
    inner.scale(-1, 1, 1);
    solids.add(inner, at(M(bx, h / 2, bz)), CP.wicker2, wick);
    solids.add(new THREE.CylinderGeometry(0.197, 0.197, 0.035, 12, 1, true), at(M(bx, h - 0.012, bz)), CP.wicker2, wick);
    solids.add(new THREE.CylinderGeometry(0.175, 0.175, 0.02, 10), at(M(bx, h - 0.03, bz)), CP.dung, { aK: [7, 0, 0, 0] });
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + 0.3;
      patty(at(M(bx + Math.cos(a) * 0.07, h + 0.01 + (k % 2) * 0.02, bz + Math.sin(a) * 0.07, 0.55 * Math.cos(a + 1), a, 0.55 * Math.sin(a + 1))), 0.9);
    }
  }
  // a few patties drying, propped against the stack
  for (let k = 0; k < 3; k++) patty(at(M(-0.3 + k * 0.16, 0.095, 0.3 + k * 0.02, 1.25 + k * 0.08, 0.3, 0)));
  return {};
}
