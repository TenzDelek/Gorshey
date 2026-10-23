// Geometry + rigging helpers for the life module.
// Every figure / animal is ONE SkinnedMesh: its parts are boxes and low-poly cylinders, coloured per
// vertex, merged into one geometry, each part rigidly weighted to one bone. Bones are posed in update().
// One mesh = one draw call per pass, and three's shadow/distance materials skin it for free, so a
// figure costs 1 + 1 (sun) + 6 (fire cube faces at night) calls however many parts it has.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from './core.js';

const M4 = new THREE.Matrix4(), EUL = new THREE.Euler(), QT = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const V3 = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

// ---- geometry makers (all in model space) ------------------------------------------------
export function gBox(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(M4.makeRotationFromEuler(EUL.set(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
// Box whose long axis runs from a to b; cross-section w (x) by d (z) before alignment. roll twists it.
export function gSeg(a, b, w, d = w, roll = 0, ext = 0) {
  const A = V3(a), B = V3(b);
  const dir = B.clone().sub(A);
  const len = dir.length() + ext;
  const g = new THREE.BoxGeometry(w, len, d);
  if (roll) g.rotateY(roll);
  QT.setFromUnitVectors(UP, dir.normalize());
  g.applyMatrix4(M4.makeRotationFromQuaternion(QT));
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}
export function gCyl(rt, rb, h, seg, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg ?? 8);
  if (rx || ry || rz) g.applyMatrix4(M4.makeRotationFromEuler(EUL.set(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}
// Cylinder from a (radius ra) to b (radius rb).
export function gCylSeg(a, b, ra, rb, seg = 6) {
  const A = V3(a), B = V3(b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(rb, ra, dir.length(), seg);
  QT.setFromUnitVectors(UP, dir.normalize());
  g.applyMatrix4(M4.makeRotationFromQuaternion(QT));
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}
// Apply an arbitrary matrix (e.g. an instrument's local frame) to a geometry.
export const gXform = (g, m) => { g.applyMatrix4(m); return g; };

// ---- colouring ----------------------------------------------------------------------------
const _c = new THREE.Color(), _c2 = new THREE.Color();
function prep(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  return g;
}
export function paint(geo, hex) {
  const g = prep(geo);
  _c.setHex(hex);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
// Vertical two-tone: colour from hexTop at y >= y1 to hexBot at y <= y0 (per vertex).
export function paintY(geo, hexBot, hexTop, y0, y1) {
  const g = prep(geo);
  _c.setHex(hexBot); _c2.setHex(hexTop);
  const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    a[i * 3] = _c.r + (_c2.r - _c.r) * k; a[i * 3 + 1] = _c.g + (_c2.g - _c.g) * k; a[i * 3 + 2] = _c.b + (_c2.b - _c.b) * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
// Per-face colours for a (non-indexed) cylinder: side segment i gets cols[i % cols.length]; caps get cap.
export function paintSegments(geo, cols, cap) {
  const g = prep(geo);
  const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3);
  const nrm = g.attributes.normal;
  for (let tri = 0; tri < n / 3; tri++) {
    // centroid angle picks the segment; flat caps (|ny| ~ 1) use the cap colour
    let cx = 0, cz = 0, ny = 0;
    for (let k = 0; k < 3; k++) { cx += p.getX(tri * 3 + k); cz += p.getZ(tri * 3 + k); ny += Math.abs(nrm.getY(tri * 3 + k)); }
    let hex = cap;
    if (ny / 3 < 0.9) {
      const ang = (Math.atan2(cz, cx) + Math.PI * 2) % (Math.PI * 2);
      hex = cols[Math.floor((ang / (Math.PI * 2)) * cols.length) % cols.length];
    }
    _c.setHex(hex);
    for (let k = 0; k < 3; k++) { const i = tri * 3 + k; a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ---- skinned rig ---------------------------------------------------------------------------
export class Rig {
  constructor() { this.bones = []; this.b = {}; this.geos = []; }
  // pos is the bone's MODEL-space bind position; bind rotations are identity, so part geometry is
  // simply authored in model space and rotations in update() are about model-aligned axes.
  bone(name, parent, pos) {
    const bn = new THREE.Bone();
    bn.name = name;
    bn.userData.bind = V3(pos);
    bn.userData.index = this.bones.length;
    const p = parent ? this.b[parent] : null;
    if (p) { p.add(bn); bn.position.copy(bn.userData.bind).sub(p.userData.bind); }
    else bn.position.copy(bn.userData.bind);
    bn.userData.rest = bn.position.clone();
    this.bones.push(bn); this.b[name] = bn;
    return bn;
  }
  // add a coloured part rigidly bound to `bone`
  add(bone, geo, hex) {
    const g = hex === undefined ? prep(geo) : paint(geo, hex);
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const bi = this.b[bone].userData.index;
    for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.geos.push(g);
    return g;
  }
  box(bone, hex, w, h, d, x, y, z, rx, ry, rz) { return this.add(bone, gBox(w, h, d, x, y, z, rx, ry, rz), hex); }
  seg(bone, hex, a, b, w, d, roll, ext) { return this.add(bone, gSeg(a, b, w, d, roll, ext), hex); }
  build(material, name) {
    const geo = mergeGeometries(this.geos);
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.name = name ?? 'rig';
    mesh.add(this.bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.bones = this.b;
    return mesh;
  }
}

// Static (non-skinned) merged set of coloured parts.
export class StaticSet {
  constructor() { this.geos = []; }
  add(geo, hex) { const g = hex === undefined ? prep(geo) : paint(geo, hex); this.geos.push(g); return g; }
  box(hex, w, h, d, x, y, z, rx, ry, rz) { return this.add(gBox(w, h, d, x, y, z, rx, ry, rz), hex); }
  build(material, name) {
    const mesh = new THREE.Mesh(mergeGeometries(this.geos), material);
    mesh.name = name ?? 'set';
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
}

// Shared materials
export const clothMat = () => mat(0xffffff, { vertexColors: true, grain: 0.05 });
export const furMat = () => mat(0xffffff, { vertexColors: true, grain: 0.11, grainScale: 30 });
export const woodMat = () => mat(0xffffff, { vertexColors: true, grain: 0.07, grainScale: 26 });

// Reset every bone of a rig to its bind pose (call at the top of update).
export function resetPose(mesh) {
  for (const bn of mesh.skeleton.bones) { bn.position.copy(bn.userData.rest); bn.quaternion.identity(); bn.scale.set(1, 1, 1); }
}

// Lofted body along +x: stations [x, yTop, yBot, halfWidth]; cross-section is a superellipse ring
// (p < 1 squarer, p = 1 ellipse) with `seg` sides. Returns a non-indexed geometry with caps.
export function gLoft(stations, seg = 10, p = 0.7) {
  const ring = (s) => {
    const [x, yt, yb, hw] = s;
    const yc = (yt + yb) / 2, hy = (yt - yb) / 2;
    const pts = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2 + Math.PI / seg;
      const c = Math.cos(a), sn = Math.sin(a);
      pts.push([x, yc + hy * Math.sign(sn) * Math.pow(Math.abs(sn), p), hw * Math.sign(c) * Math.pow(Math.abs(c), p)]);
    }
    return pts;
  };
  const R = stations.map(ring);
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < R.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = R[i][j], b = R[i][(j + 1) % seg], c = R[i + 1][(j + 1) % seg], d = R[i + 1][j];
      tri(a, c, b); tri(a, d, c);
    }
  }
  // caps
  const cap = (r, flip) => {
    const cx = r.reduce((s, q) => s + q[0], 0) / seg, cy = r.reduce((s, q) => s + q[1], 0) / seg, cz = r.reduce((s, q) => s + q[2], 0) / seg;
    for (let j = 0; j < seg; j++) { const a = r[j], b = r[(j + 1) % seg]; if (flip) tri([cx, cy, cz], a, b); else tri([cx, cy, cz], b, a); }
  };
  cap(R[0], true); cap(R[R.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
