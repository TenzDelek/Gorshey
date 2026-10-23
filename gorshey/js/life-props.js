// Rug (khaden) and the low painted tea table (choktse) with thermos, butter tea, chang and khapse,
// plus a wooden butter-tea churn (dongmo).
import * as THREE from 'three';
import { mat, PAL } from './core.js';
import { StaticSet, gBox, gCyl, gSeg, paint, paintSegments, woodMat } from './life-rig.js';

const glc = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

// ---- rug ----------------------------------------------------------------------------------------
export const RUG = { w: 1.6, d: 1.0, h: 0.022 };
const RC = {
  field: 0x8a2723, fieldDk: 0x74201e, indigo: 0x2b3866, indigoDk: 0x1f2747, saffron: 0xc98a2e, cream: 0xd9cdb0, edge: 0x2a2232,
};
export function buildRug() {
  const { w, d, h } = RUG;
  const body = new THREE.BoxGeometry(w, h, d);
  body.translate(0, h / 2, 0);
  // fringe: flat strips beyond both short ends (threads cut out in the shader)
  const geos = [body.toNonIndexed()];
  for (const sx of [-1, 1]) {
    const f = new THREE.PlaneGeometry(0.075, d * 0.94);
    f.rotateX(-Math.PI / 2);
    f.translate(sx * (w / 2 + 0.0375), 0.006, 0);
    geos.push(f.toNonIndexed());
  }
  for (const g of geos) { g.deleteAttribute('uv'); }
  const geo = mergeAll(geos);
  const m = mat(RC.field, {
    grain: 0.0,
    fragment: {
      head: /* glsl */`
        float rStep(float a, float x) { return step(a, x); }
      `,
      body: /* glsl */`
        {
          vec2 p = vGLocal.xz;                          // u along the length, v across
          vec2 hs = vec2(${(w / 2).toFixed(3)}, ${(d / 2).toFixed(3)});
          vec2 ap = abs(p);
          vec3 c;
          float h1 = gHash12(floor(p * 26.0) + 7.0);
          if (ap.x > hs.x) {
            // warp-thread fringe: cream threads with gaps, ragged ends
            float th = step(0.45, fract(p.y * 30.0));
            float len = (ap.x - hs.x) / 0.075;
            if (th < 0.5 || len > 0.55 + 0.45 * gHash12(vec2(floor(p.y * 30.0), 3.0))) discard;
            c = ${glc(RC.cream)} * (0.9 + 0.15 * h1);
          } else {
            float de = min(hs.x - ap.x, hs.y - ap.y);   // distance to the outer edge
            if (de < 0.022) c = ${glc(RC.edge)};
            else if (de < 0.12) {
              // indigo border with a run of saffron key motifs
              c = ${glc(RC.indigo)};
              float s = (hs.x - ap.x < hs.y - ap.y) ? p.y : p.x;
              float q = de - 0.022;
              float m = step(abs(q - 0.049), 0.018) * step(fract(s / 0.085), 0.42);
              m = max(m, step(abs(q - 0.049), 0.006));
              if (m > 0.5) c = ${glc(RC.saffron)};
            }
            else if (de < 0.14) c = ${glc(RC.saffron)};
            else if (de < 0.155) c = ${glc(RC.indigoDk)};
            else {
              // red field with abrash (row-wise dye variation)
              c = mix(${glc(RC.field)}, ${glc(RC.fieldDk)}, step(0.62, gNoise2(vec2(p.x * 6.0, 0.5))));
              // corner spandrels
              vec2 cp = hs - vec2(0.155) - ap;
              float cr = length(max(vec2(0.24, 0.17) - cp, 0.0) / vec2(0.24, 0.17));
              float kc = length(cp / vec2(0.24, 0.17));
              if (kc < 1.0) { c = ${glc(RC.indigo)}; if (kc > 0.8) c = ${glc(RC.saffron)}; }
              // central medallion: a stepped round medallion, saffron ring, red heart, cream centre
              float md = length(p / vec2(0.3, 0.22));
              float lz = (ap.x / 0.36 + ap.y / 0.26);
              if (md < 1.0 || lz < 0.82) {
                c = ${glc(RC.indigo)};
                if (md < 0.74) c = ${glc(RC.saffron)};
                if (md < 0.58) c = ${glc(RC.field)};
                if (lz < 0.28) c = ${glc(RC.cream)};
                // four little saffron petals in the indigo ring
                vec2 pp = p / vec2(0.3, 0.22);
                float pet = step(0.86, abs(cos(atan(pp.y, pp.x) * 2.0))) * step(0.76, md) * step(md, 0.92);
                if (pet > 0.5) c = ${glc(RC.saffron)};
              }
            }
            c *= 0.93 + 0.12 * h1;                       // wool pile speckle
          }
          diffuseColor.rgb = c;
        }
      `,
    },
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'rug';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function mergeAll(geos) {
  // tiny local merge (avoid a second import of BufferGeometryUtils here)
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

// ---- tea table set ----------------------------------------------------------------------------------
const TC = {
  lacquer: 0x8c2f22, lacquerDk: 0x6a2219, gold: 0xc79a3c, green: 0x3f7350, blue: 0x2f5487, red: 0xa83a2c,
  pink: 0xd48a9a, pinkDk: 0xb86d7f, chrome: 0xc2c0b8, flowerR: 0xb8323c, flowerY: 0xe0bb4c, leaf: 0x4a7a3c,
  porcelain: 0xe6e0d2, porcelainBlue: 0x4a6aa0, silver: 0xbab6ac, tea: 0xc9a57a, teaDk: 0xb48e62,
  bowlWood: 0x7a4a2a, brass: 0xc29a48, brassDk: 0x9a7432, copper: 0xa8683a, chang: 0xe2dcc6,
  plate: 0xe2ddd0, khapse: 0xcf9a46, khapseDk: 0xa8742e,
  churn: 0x74492a, churnDk: 0x5a3820,
};
// Table: long axis along local z (0.72 m), depth along x (0.42 m), top at 0.38 m.
export function buildTeaSet() {
  const S = new StaticSet();
  const L = 0.72, D = 0.42, H = 0.38, top = 0.035;
  // top board with a gilt edge
  S.box(TC.lacquer, D, top, L, 0, H - top / 2, 0);
  S.box(TC.gold, D + 0.006, 0.01, L + 0.006, 0, H - top - 0.002, 0);
  // carcass and legs
  S.box(TC.lacquerDk, D - 0.04, 0.27, L - 0.04, 0, 0.065 + 0.135, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.box(TC.lacquer, 0.045, H - top, 0.045, sx * (D / 2 - 0.022), (H - top) / 2, sz * (L / 2 - 0.022));
  S.box(TC.lacquer, D, 0.03, L, 0, 0.05, 0);                       // bottom rail
  // carved, painted panels on all four faces: gold frame, green/blue fields, red centre flowers
  const panel = (cx, cz, nx, nz, len) => {
    // n = outward normal (x or z); panel spans `len` along the face
    const along = nz === 0 ? [0, 1] : [1, 0];
    const off = 0.003;
    const fx = cx + nx * off, fz = cz + nz * off;
    const W = (a) => (nz === 0 ? [0.01, a] : [a, 0.01]);
    // frame
    S.box(TC.gold, ...sz3(W(len - 0.02), 0.012), fx, 0.32, fz);
    S.box(TC.gold, ...sz3(W(len - 0.02), 0.012), fx, 0.085, fz);
    const halves = 2;
    const pw = (len - 0.06) / halves;
    for (let i = 0; i < halves; i++) {
      const o = -len / 2 + 0.03 + pw * (i + 0.5);
      const px = fx + along[0] * o, pz = fz + along[1] * o;
      S.box(i % 2 ? TC.blue : TC.green, ...sz3(W(pw - 0.03), 0.19), px, 0.2, pz);
      S.box(TC.red, ...sz3(W(0.05), 0.05), px + nx * 0.004, 0.2, pz + nz * 0.004);
      S.box(TC.gold, ...sz3(W(0.022), 0.022), px + nx * 0.007, 0.2, pz + nz * 0.007);
    }
    for (const o of [-len / 2 + 0.03, 0, len / 2 - 0.03]) S.box(TC.gold, ...sz3(W(0.012), 0.24), fx + along[0] * o, 0.2, fz + along[1] * o);
  };
  const sz3 = (wd, h) => [wd[0], h, wd[1]];
  panel(D / 2 - 0.02, 0, 1, 0, L - 0.04);
  panel(-(D / 2 - 0.02), 0, -1, 0, L - 0.04);
  panel(0, L / 2 - 0.02, 0, 1, D - 0.04);
  panel(0, -(L / 2 - 0.02), 0, -1, D - 0.04);

  const y0 = H;
  // flower-print thermos: pink shell, chrome foot ring and shoulder, red cap
  const tx = 0.05, tz = -0.2;
  S.add(gCyl(0.056, 0.056, 0.245, 8, tx, y0 + 0.02 + 0.1225, tz), TC.pink);
  S.add(gCyl(0.058, 0.058, 0.022, 8, tx, y0 + 0.011, tz), TC.chrome);
  S.add(gCyl(0.036, 0.056, 0.035, 8, tx, y0 + 0.265 + 0.0175, tz), TC.chrome);
  S.add(gCyl(0.04, 0.04, 0.05, 8, tx, y0 + 0.3 + 0.025, tz), TC.red);
  S.add(gCyl(0.03, 0.04, 0.012, 8, tx, y0 + 0.356, tz), TC.red);
  // printed flowers: a few 1-px blossoms and leaves on the camera-facing side
  const fl = [[0.4, 0.07, TC.flowerR], [1.1, 0.12, TC.flowerY], [0.9, 0.19, TC.flowerR], [-0.2, 0.15, TC.flowerR], [1.6, 0.05, TC.flowerR], [0.2, 0.2, TC.leaf], [1.3, 0.17, TC.leaf], [0.7, 0.1, TC.leaf], [-0.5, 0.08, TC.flowerY]];
  for (const [a, h, c] of fl) S.add(gBox(0.03, 0.03, 0.03, tx + Math.cos(a) * 0.056, y0 + 0.02 + h, tz + Math.sin(a) * 0.056, 0, -a, 0), c);
  // porcelain cup on a silver stand with a silver lid
  const cup = (x, z, lid) => {
    S.add(gCyl(0.04, 0.045, 0.014, 8, x, y0 + 0.007, z), TC.silver);
    S.add(gCyl(0.044, 0.03, 0.05, 8, x, y0 + 0.014 + 0.025, z), TC.porcelain);
    S.add(gCyl(0.0445, 0.0445, 0.01, 8, x, y0 + 0.056, z), TC.porcelainBlue);
    if (lid) { S.add(gCyl(0.03, 0.046, 0.018, 8, x, y0 + 0.07, z), TC.silver); S.add(gCyl(0.008, 0.012, 0.02, 6, x, y0 + 0.088, z), TC.silver); }
    else S.add(gCyl(0.04, 0.04, 0.006, 8, x, y0 + 0.058, z), TC.tea);
  };
  cup(-0.1, -0.13, true);
  cup(0.12, 0.0, false);
  // wooden tea bowl, butter tea inside
  S.add(gCyl(0.055, 0.036, 0.045, 8, -0.08, y0 + 0.0225, 0.07), TC.bowlWood);
  S.add(gCyl(0.05, 0.05, 0.006, 8, -0.08, y0 + 0.04, 0.07), TC.tea);
  // chang jug: brass body, neck, spout, handle
  const jx = -0.02, jz = 0.23;
  S.add(gCyl(0.05, 0.062, 0.11, 8, jx, y0 + 0.055, jz), TC.brass);
  S.add(gCyl(0.065, 0.065, 0.016, 8, jx, y0 + 0.07, jz), TC.brassDk);
  S.add(gCyl(0.03, 0.05, 0.045, 8, jx, y0 + 0.132, jz), TC.brass);
  S.add(gCyl(0.036, 0.03, 0.02, 8, jx, y0 + 0.164, jz), TC.brassDk);
  S.add(gSeg([jx + 0.045, y0 + 0.09, jz], [jx + 0.1, y0 + 0.15, jz], 0.022, 0.022), TC.brass);
  S.add(gSeg([jx - 0.05, y0 + 0.14, jz], [jx - 0.075, y0 + 0.06, jz], 0.016, 0.02), TC.brassDk);
  // plate of khapse: golden fried pastries piled on a plate
  const kx = 0.11, kz = 0.17;
  S.add(gCyl(0.085, 0.07, 0.012, 10, kx, y0 + 0.006, kz), TC.plate);
  const kh = [[-0.03, -0.02, 0.4, 0], [0.03, -0.01, -0.5, 0], [0.0, 0.03, 1.2, 0], [-0.02, 0.01, 2.1, 1], [0.025, 0.02, 0.2, 1], [0.0, -0.01, -1.0, 2]];
  for (const [x, z, r, lv] of kh) S.add(gBox(0.07, 0.022, 0.034, kx + x, y0 + 0.024 + lv * 0.02, kz + z, 0, r, 0.15), lv === 1 ? TC.khapseDk : TC.khapse);

  // dongmo: tall wooden butter-tea churn with brass bands and its plunger, standing at the table's end
  const cx = 0.02, cz = L / 2 + 0.17, ch = 0.78;
  S.add(paintSegments(gCyl(0.075, 0.08, ch, 8, cx, ch / 2, cz), [TC.churn, TC.churnDk, TC.churn, TC.churn, TC.churnDk, TC.churn, TC.churn, TC.churnDk], TC.churn));
  for (const by of [0.05, 0.3, 0.55, 0.76]) S.add(gCyl(0.082 + (by < 0.1 ? 0.004 : 0), 0.082 + (by < 0.1 ? 0.004 : 0), 0.028, 8, cx, by, cz), TC.brass);
  S.add(gCyl(0.012, 0.012, 0.28, 5, cx, ch + 0.12, cz), TC.churnDk);
  S.add(gBox(0.022, 0.022, 0.13, cx, ch + 0.26, cz), TC.churnDk);

  return S.build(woodMat(), 'teaset');
}
