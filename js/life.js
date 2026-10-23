// Life at the edge of the dance: a khaden rug on the ring's left flank with the dranyen player, a
// grandmother spinning her prayer wheel and a little girl clapping; the painted tea table with thermos,
// butter tea, chang and khapse; a grazing yak; a black-and-tan mastiff lying by the tent.
// Every figure/animal is one SkinnedMesh (life-rig.js), so the whole module is 7 meshes.
// Placements come from LAYOUT only (the ground module presses the grass from FOOTPRINTS, tied to the
// same LAYOUT entries), so nothing here is offset privately.
import * as THREE from 'three';
import { LAYOUT } from './core.js';
import { buildMusician, buildElder, buildChild, RIM } from './life-people.js';
import { buildYak, buildDog } from './life-animals.js';
import { buildRug, buildTeaSet, RUG } from './life-props.js';

const facing = (x, z, tx = 0, tz = 0) => Math.atan2(tx - x, tz - z);   // ry that points local +z at (tx, tz)
// local (u along local x, v along local z) -> world, for an object at (x, z) turned by ry
const toWorld = ([x, z], ry, u, v) => [x + Math.cos(ry) * u + Math.sin(ry) * v, z - Math.sin(ry) * u + Math.cos(ry) * v];
const toLocal = ([x, z], ry, wx, wz) => { const dx = wx - x, dz = wz - z; return [dx * Math.cos(ry) - dz * Math.sin(ry), dx * Math.sin(ry) + dz * Math.cos(ry)]; };

// Seats in rug space (u along the rug's length, screen down-right; v across it, + away from the fire, screen
// down-left). Rug centre on screen ≈ +42·u − 57·v px right, +31·u + 23·v px down (1080², zoom 1).
// The three are staggered so their heads never stack and the red field shows between them: the musician on
// the inner (fire) corner, the grandmother at the back on the outer half with the wheel on her camera side,
// the girl in the front between them, below the grandmother's knees and behind the musician's back.
const SEATS = {
  musician: { u: null, v: null, ry: LAYOUT.musician.ry },   // LAYOUT.musician: facing the fire, 0.1 rad back toward profile
  elder: { u: -0.55, v: -0.02, ry: 1.4 },                    // three-quarters to the camera, toward the fire and the musician
  child: { u: 0.62, v: 0.32, ry: 1.2 },                      // three-quarters to the camera, watching the musician and the ring
};
[SEATS.musician.u, SEATS.musician.v] = toLocal(LAYOUT.rug.pos, LAYOUT.rug.ry, ...LAYOUT.musician.pos);

export function build(ctx) {
  const group = new THREE.Group();
  group.name = 'life';

  // ---- rug and the people on it ------------------------------------------------------------------
  const R0 = LAYOUT.rug;
  const rug = buildRug();
  rug.position.set(R0.pos[0], 0, R0.pos[1]);
  rug.rotation.y = R0.ry;
  group.add(rug);

  const place = (fig, s) => {
    const [x, z] = toWorld(R0.pos, R0.ry, s.u, s.v);
    fig.mesh.position.set(x, RUG.h, z);
    fig.mesh.rotation.y = s.ry ?? facing(x, z);
    group.add(fig.mesh);
  };
  const musician = buildMusician();
  place(musician, SEATS.musician);
  const elder = buildElder();
  place(elder, SEATS.elder);
  const child = buildChild();
  place(child, SEATS.child);

  // ---- tea table: on the grass beside the rug's outer long edge, the churn past its far end -----------
  const tea = buildTeaSet();
  tea.position.set(LAYOUT.teaTable.pos[0], 0, LAYOUT.teaTable.pos[1]);
  tea.rotation.y = LAYOUT.teaTable.ry;
  group.add(tea);

  // ---- yak: front right, true profile, head (model +x) to screen-left, grazing ------------------------
  const yak = buildYak(-1);                            // model -z is the camera side at ry -2.36
  yak.mesh.position.set(LAYOUT.yak.pos[0], 0, LAYOUT.yak.pos[1]);
  yak.mesh.rotation.y = LAYOUT.yak.ry;
  group.add(yak.mesh);
  yak.lookY.v = localYaw(LAYOUT.yak.pos, LAYOUT.yak.ry, [0, 0], 0.55);   // glances toward the fire when it looks up

  // ---- dog: lying off the tent's left side, head toward the dance ----------------------------------
  const dog = buildDog(1);                             // model +z is the camera side at ry 0.79
  dog.mesh.position.set(LAYOUT.dog.pos[0], 0, LAYOUT.dog.pos[1]);
  dog.mesh.rotation.y = LAYOUT.dog.ry;
  dog.mesh.scale.setScalar(1.15);                      // a big do-khyi
  group.add(dog.mesh);
  dog.look.yaw = localYaw(LAYOUT.dog.pos, LAYOUT.dog.ry, [0, 0], 0.95);   // the fire lies toward the camera side

  ctx.expose('life', { group, musician, elder, child, yak, dog });
  const parts = [musician, elder, child, yak, dog];
  function update(t, c) {
    // the night rim flickers with the fire light (fire publishes its flicker as a pure function of t)
    const fl = (c ?? ctx).shared.fireFlicker;
    RIM.value = typeof fl === 'function' ? fl(t) : 1;
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
