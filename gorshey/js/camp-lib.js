// Shared helpers for the camp module: a geometry accumulator that merges many coloured parts
// into one non-indexed BufferGeometry (one draw call per pass), plus the camp palette.
import * as THREE from 'three';
import { patchMask } from './core.js';

// ---- palette (sRGB hex, muted to sit with the finished grass and fire) -------------
export const CP = {
  canvas: 0xebe6da, canvasWarm: 0xe6ddca, liner: 0x3a322b, linerDeep: 0x2b2521,
  appBlue: 0x26457f, appBlueDeep: 0x1d3566,
  edgeRed: 0xb5463a, edgeYellow: 0xd9b24a, edgeGreen: 0x5e8a4a,
  pole: 0x6a4a30, poleDark: 0x4e3524, rope: 0x3b332c, ropeLight: 0x5a5046, brass: 0xc9a24a,
  // lungta: blue, white, red, green, yellow (sky, wind, fire, water, earth)
  lungta: [0x3e6e9e, 0xe8e2d0, 0xb5463a, 0x5e8a4a, 0xd9b24a],
  darchog: 0xdcb44e, khata: 0xf1eee6,
  slate: 0x6c7377, slate2: 0x7d8386, slate3: 0x61676b, slateLight: 0x8a8f90,
  fieldStone: 0x8e8a80, fieldStone2: 0x9c978b, quartz: 0xd8d4ca,
  white: 0xe6e0d2, whiteShade: 0xd2cbbb, soot: 0x3c3833, ochre: 0x9c6a48,
  juniper: 0x34502c, juniperLight: 0x4d6a36,
  bark: 0x6e4a33, barkDark: 0x553826, splitWood: 0xe6caa0, splitWood2: 0xd9b58a,
  dung: 0x54412f, dung2: 0x6a5540, dungDry: 0x8c7860,
  wicker: 0xa8844e, wicker2: 0x7d5c34,
  rugRed: 0x7a2a2a, rugBlue: 0x2b3a5c, rugGold: 0xb08a3e,
  cushion: 0x6e1f2a, cushion2: 0xa2742e,
};

export const WIND_DIR = new THREE.Vector3(1, 0, -0.55).normalize();

// Move a point toward the fire until it sits inside the patch (mask >= minMask), at most maxStep metres.
export function insidePatch(x, z, minMask = 0.62, maxStep = 0.8) {
  const L = Math.hypot(x, z) || 1;
  const ux = -x / L, uz = -z / L;
  for (let s = 0; s <= maxStep + 1e-6; s += 0.025) {
    const px = x + ux * s, pz = z + uz * s;
    if (patchMask(px, pz) >= minMask) return [px, pz];
  }
  return [x + ux * maxStep, z + uz * maxStep];
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

// Accumulates triangles. `spec` = { attrName: itemSize } for custom attributes (defaults 0).
export class Acc {
  constructor(spec = {}) {
    this.spec = spec;
    this.pos = []; this.col = []; this.nrm = [];
    this.attr = Object.fromEntries(Object.keys(spec).map((k) => [k, []]));
    this.customNormal = false;
  }
  get count() { return this.pos.length / 3; }
  // push one vertex. a = { attrName: array|number }
  vert(p, colorHex, a = {}, n = null) {
    this.pos.push(p.x, p.y, p.z);
    _c.set(colorHex);
    this.col.push(_c.r, _c.g, _c.b);
    if (n) { this.nrm.push(n.x, n.y, n.z); this.customNormal = true; } else this.nrm.push(0, 1, 0);
    for (const [k, size] of Object.entries(this.spec)) {
      const v = a[k];
      if (v === undefined) for (let i = 0; i < size; i++) this.attr[k].push(0);
      else if (typeof v === 'number') { this.attr[k].push(v); for (let i = 1; i < size; i++) this.attr[k].push(0); }
      else for (let i = 0; i < size; i++) this.attr[k].push(v[i] ?? 0);
    }
  }
  // Add a three.js geometry transformed by matrix m.
  // color: hex | (i, p, n) => hex ; attrs: object | (i, p, n, local) => object
  add(geo, m, color, attrs = {}, keepNormals = false) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.attributes.position, N = g.attributes.normal;
    if (m) _nm.getNormalMatrix(m);
    const local = new THREE.Vector3(), nl = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      local.fromBufferAttribute(P, i);
      _v.copy(local); if (m) _v.applyMatrix4(m);
      if (N) { nl.fromBufferAttribute(N, i); _n.copy(nl); if (m) _n.applyMatrix3(_nm).normalize(); } else { nl.set(0, 1, 0); _n.set(0, 1, 0); }
      const ch = typeof color === 'function' ? color(i, _v, _n, local, nl) : color;
      const at = typeof attrs === 'function' ? attrs(i, _v, _n, local, nl) : attrs;
      this.vert(_v, ch, at, keepNormals ? _n : null);
    }
    return this;
  }
  // Triangle from three points with per-vertex colour/attrs (arrays of 3) or shared values.
  tri(a, b, c, color, attrs = {}, n = null) {
    const cs = Array.isArray(color) ? color : [color, color, color];
    const as = Array.isArray(attrs) ? attrs : [attrs, attrs, attrs];
    this.vert(a, cs[0], as[0], n); this.vert(b, cs[1], as[1], n); this.vert(c, cs[2], as[2], n);
  }
  // Quad a-b-c-d (counter-clockwise seen from the front)
  quad(a, b, c, d, color, attrs = {}, n = null) {
    const cs = Array.isArray(color) ? color : [color, color, color, color];
    const as = Array.isArray(attrs) ? attrs : [attrs, attrs, attrs, attrs];
    this.tri(a, b, c, [cs[0], cs[1], cs[2]], [as[0], as[1], as[2]], n);
    this.tri(a, c, d, [cs[0], cs[2], cs[3]], [as[0], as[2], as[3]], n);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    for (const [k, size] of Object.entries(this.spec)) g.setAttribute(k, new THREE.Float32BufferAttribute(this.attr[k], size));
    if (this.customNormal) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    else g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// Matrix helper: position, euler (xyz order), scale
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}

// Jitter the vertices of a (low-poly) geometry by a hash of their rounded position (keeps shared corners together).
export function jitter(geo, amt, seed = 0, keepBottom = true) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = Math.round(x * 97 + seed) * 7.13 + Math.round(y * 89) * 3.71 + Math.round(z * 83) * 1.37;
    const h = (n) => { const s = Math.sin(k * 12.9898 + n * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };
    p.setXYZ(i, x + h(1) * amt, keepBottom && y <= -0.49 ? y : y + h(2) * amt, z + h(3) * amt);
  }
  geo.computeVertexNormals();
  return geo;
}

export const glc = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
