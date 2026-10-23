// Life at the edge of the dance: a khaden rug with the dranyen player, a grandmother spinning her
// prayer wheel and a little girl clapping; the painted tea table with thermos, butter tea, chang and
// khapse; a grazing yak; a black-and-tan mastiff dozing by the tent.
// Every figure/animal is one SkinnedMesh (life-rig.js), so the whole module is 7 meshes.
import * as THREE from 'three';
import { LAYOUT, smooth } from './core.js';
import { buildMusician, buildElder, buildChild } from './life-people.js';
import { buildYak, buildDog } from './life-animals.js';
import { buildRug, buildTeaSet, RUG } from './life-props.js';

const facing = (x, z, tx = 0, tz = 0) => Math.atan2(tx - x, tz - z);   // ry that points local +z at (tx, tz)
// local (u along local x, v along local z) -> world, for an object at (x, z) turned by ry
const toWorld = ([x, z], ry, u, v) => [x + Math.cos(ry) * u + Math.sin(ry) * v, z - Math.sin(ry) * u + Math.cos(ry) * v];
const toLocal = ([x, z], ry, wx, wz) => { const dx = wx - x, dz = wz - z; return [dx * Math.cos(ry) - dz * Math.sin(ry), dx * Math.sin(ry) + dz * Math.cos(ry)]; };

// placements
const RUGP = { pos: LAYOUT.rug.pos, ry: LAYOUT.rug.ry };
const TEA = { pos: LAYOUT.teaTable.pos, ry: LAYOUT.teaTable.ry };
const YAK = { pos: [-4.3, 1.75], ry: 0.75 };   // LAYOUT.yak nudged inward (its rump hung over the rim) and turned a touch toward the camera
// The dog lies on open ground off the tent's left side, beyond its guy-rope stakes. (At LAYOUT.dog,
// behind the flag lines beside the sangbum, flags hid it; in front of the tent the dancers' heads did.)
// Side-on to the camera, head toward the dance; it lifts and turns its head to watch.
const DOG = { pos: [-4.88, -1.06], ry: 0.79 };

// Pressed grass. Published as ctx.shared.grassPress = [{ shape, pos, ry, hx, hz, k, soft }]: inside the
// shape blade height is multiplied by k (0 = gone, flattened under a rug); `soft` m of falloff outside.
// If the ground module sets ctx.shared.groundPressesGrass = true it owns this; otherwise we apply it once
// to its blade instances (y-scale of the instance matrix only).
const PRESS = [
  { shape: 'rect', pos: RUGP.pos, ry: RUGP.ry, hx: RUG.w / 2 + 0.1, hz: RUG.d / 2 + 0.04, k: 0, soft: 0.12 },
  { shape: 'rect', pos: TEA.pos, ry: TEA.ry, hx: 0.25, hz: 0.58, k: 0, soft: 0.1 },
  { shape: 'ellipse', pos: YAK.pos, ry: YAK.ry, hx: 1.75, hz: 0.9, k: 0.24, soft: 0.6, cx: 0.3 },    // grazed short
  { shape: 'ellipse', pos: DOG.pos, ry: DOG.ry, hx: 0.82, hz: 0.5, k: 0.2, soft: 0.5, cx: 0.08 },    // the dog's bed (body is scaled 1.15)
];
function pressK(x, z) {
  let k = 1;
  for (const p of PRESS) {
    const [lx, lz] = toLocal(p.pos, p.ry, x, z);
    let d;   // signed-ish distance outside the shape (m), <= 0 inside
    if (p.shape === 'rect') d = Math.max(Math.abs(lx) - p.hx, Math.abs(lz) - p.hz);
    else { const r = Math.hypot((lx - (p.cx ?? 0)) / p.hx, lz / p.hz); d = (r - 1) * Math.min(p.hx, p.hz); }
    const w = 1 - smooth(0, p.soft, d);
    k = Math.min(k, 1 - (1 - p.k) * w);
  }
  return k;
}
function pressGrass(ctx) {
  ctx.shared.grassPress = PRESS;
  ctx.shared.grassPressK = pressK;
  if (ctx.shared.groundPressesGrass) return;
  const q = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } })();
  if (q.get('lifepress') === '0') return;
  ctx.scene.traverse((o) => {
    if (!o.isInstancedMesh || (o.name !== 'grass' && o.name !== 'flowers')) return;
    const a = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      const j = i * 16;
      const k = pressK(a[j + 12], a[j + 14]);
      if (k < 0.999) a[j + 5] *= k;
    }
    o.instanceMatrix.needsUpdate = true;
  });
}

export function build(ctx) {
  const group = new THREE.Group();
  group.name = 'life';
  pressGrass(ctx);

  // ---- rug and the people on it (rug space: u along its length, v across) -------------------------
  const onRug = (u, v) => toWorld(RUGP.pos, RUGP.ry, u, v);
  const rug = buildRug();
  rug.position.set(RUGP.pos[0], 0, RUGP.pos[1]);
  rug.rotation.y = RUGP.ry;
  group.add(rug);
  const RUG_TOP = RUG.h;

  const seat = (fig, [x, z], turn) => {
    fig.mesh.position.set(x, RUG_TOP, z);
    fig.mesh.rotation.y = facing(x, z) + turn;
    group.add(fig.mesh);
  };
  const musician = buildMusician();
  seat(musician, onRug(-0.2, 0.24), 0.1);
  const elder = buildElder();
  seat(elder, onRug(0.26, -0.3), -0.55);
  const child = buildChild();
  seat(child, onRug(0.5, 0.27), 0);
  child.mesh.rotation.y = 2.25;                        // turned to watch grandmother and the musician

  // ---- tea table ---------------------------------------------------------------------------------
  const tea = buildTeaSet();
  tea.position.set(TEA.pos[0], 0, TEA.pos[1]);
  tea.rotation.y = TEA.ry;
  group.add(tea);

  // ---- yak: in profile to the camera, head toward the fire --------------------------------------
  const yak = buildYak(1);
  yak.mesh.position.set(YAK.pos[0], 0, YAK.pos[1]);
  yak.mesh.rotation.y = YAK.ry;
  group.add(yak.mesh);
  yak.lookY.v = localYaw(YAK.pos, YAK.ry, [0, 0], 0.55);

  // ---- dog: lying along the tent side, head toward the middle of the scene -------------------------
  const dog = buildDog(1);
  dog.mesh.position.set(DOG.pos[0], 0, DOG.pos[1]);
  dog.mesh.rotation.y = DOG.ry;
  dog.mesh.scale.setScalar(1.15);                      // a big do-khyi
  group.add(dog.mesh);
  dog.look.yaw = localYaw(DOG.pos, DOG.ry, [0, 0], 0.95);

  if (ctx.shared.groundStones && /lifedebug=1/.test(location.search)) {
    for (const [x, z, r] of ctx.shared.groundStones) if (pressK(x, z) < 0.9) console.warn('[life] ground stone under a footprint', x.toFixed(2), z.toFixed(2), r.toFixed(2));
  }
  const parts = [musician, elder, child, yak, dog];
  function update(t) {
    for (const p of parts) p.update(t);
  }
  update(0);
  return { group, update };
}

// yaw (about +y, local +x forward) that turns a head toward world point `to`, clamped
function localYaw(pos, ry, [tx, tz], lim) {
  const [lx, lz] = toLocal(pos, ry, tx, tz);
  return Math.max(-lim, Math.min(lim, Math.atan2(-lz, lx)));
}
