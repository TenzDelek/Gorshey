// Stable test bed for module agents: flat meadow patch with the dithered rim, no grass.
// Load with ?only=base,<module>. Not part of the final scene.
import * as THREE from 'three';
import { mat, GLSL } from './core.js';

export function build() {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(16, 14, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = mat(0x4d6b25, {
    grain: 0.12, grainScale: 22,
    fragment: { head: GLSL.patch, body: `if (gPatchMask(vGWorld.xz) < gBayer4(gl_FragCoord.xy)) discard;` },
  });
  const ground = new THREE.Mesh(geo, m);
  ground.receiveShadow = true;
  group.add(ground);
  return { group, update() {} };
}
