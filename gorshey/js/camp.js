// Camp: the lingka picnic camp around the dance — white appliquéd tent, prayer-flag pole with lungta
// strings, mani-stone cairn with a khata, whitewashed sangbum with juniper smoke, and a woodpile of
// split juniper and dried yak-dung patties.
// Everything static is merged into three meshes (canvas, solids, cloth) plus one instanced smoke mesh,
// so the module costs ~4 draw calls per pass. All motion is loop-periodic (cyc / integer k per 24 s).
import * as THREE from 'three';
import { mat, GLSL, CYC_BASE, cyc, wind, frac, smooth, lerp, U } from './core.js';
import { Acc, CP, WIND_DIR } from './camp-lib.js';
import { buildTent, canvasGLSL, CANVAS_FRAG } from './camp-tent.js';
import { buildFlags, clothMaterial, ribbon } from './camp-flags.js';
import { buildMani, buildSangbum, buildWoodpile, SOLID_GLSL, SOLID_FRAG } from './camp-props.js';

export function build(ctx) {
  const group = new THREE.Group();
  group.name = 'camp';

  const canvas = new Acc({ aUV: 2, aP: 4 });
  const solids = new Acc({ aK: 4 });
  const cloth = new Acc({ aF: 4, aT: 3, aUV: 2 });

  const tent = buildTent({ canvas, solids, cloth, ribbon });
  const mani = buildMani({ solids, cloth });
  buildFlags({ solids, cloth, tentTip: tent.tipFront, cairnTop: mani.stickTop });
  const sang = buildSangbum({ solids });
  buildWoodpile({ solids });

  // ---- meshes ----
  const canvasMat = mat(0xffffff, {
    vertexColors: true, grain: 0.0,
    vertex: {
      head: GLSL.wind + 'attribute vec2 aUV; attribute vec4 aP; varying vec2 vUV; varying vec4 vP;',
      body: /* glsl */`
        vUV = aUV; vP = aP;
        if (aP.y > 0.0) {
          float g = gWind(transformed.xz);
          float w = 0.6 * g + 0.4 * sin(cycP(23.0) + aP.z * 6.2831853 + transformed.x * 1.7 - transformed.z * 1.1);
          transformed += normal * (aP.y * 0.028 * w);
        }`,
    },
    fragment: { head: canvasGLSL(), body: CANVAS_FRAG },
  });
  canvasMat.shadowSide = THREE.DoubleSide;
  const canvasMesh = new THREE.Mesh(canvas.build(), canvasMat);
  canvasMesh.name = 'tent-canvas';

  const solidMat = mat(0xffffff, {
    vertexColors: true, grain: 0.07, grainScale: 27,
    vertex: { head: 'attribute vec4 aK; varying vec4 vK;', body: 'vK = aK;' },
    fragment: { head: SOLID_GLSL, body: SOLID_FRAG },
  });
  const solidMesh = new THREE.Mesh(solids.build(), solidMat);
  solidMesh.name = 'camp-solids';

  const uPx = { value: 0.037 };
  const clothMesh = new THREE.Mesh(cloth.build(), clothMaterial(uPx));
  clothMesh.name = 'camp-cloth';
  clothMesh.frustumCulled = false;

  for (const me of [canvasMesh, solidMesh, clothMesh]) { me.castShadow = true; me.receiveShadow = true; group.add(me); }

  // ---- juniper smoke from the sangbum: thin pale wisps drifting downwind ----
  const NS = 12;
  const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
  const smokeFade = new THREE.InstancedBufferAttribute(new Float32Array(NS).fill(0), 1);
  smokeGeo.setAttribute('aFade', smokeFade);
  const smokeMat = mat(0xece9e2, {
    flat: false, grain: 0.03, grainScale: 14, instFade: true,
    fragment: { head: '', body: `{ float sf = clamp(normalize(vNormal).z, 0.0, 1.0); if (vFade * (0.3 + 0.9 * sf * sf) < gBayer4(gl_FragCoord.xy)) discard; }` },
  });
  const smoke = new THREE.InstancedMesh(smokeGeo, smokeMat, NS);
  smoke.castShadow = false; smoke.receiveShadow = false; smoke.frustumCulled = false;
  smoke.name = 'sangbum-smoke';
  group.add(smoke);
  const SM_DAY = new THREE.Color(0xeeebe4), SM_NIGHT = new THREE.Color(0x707892);
  const SM_DAY_E = new THREE.Color(0x87837b), SM_NIGHT_E = new THREE.Color(0x1e2332);
  const mouth = sang.mouth;
  const side = new THREE.Vector3(-WIND_DIR.z, 0, WIND_DIR.x);
  const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), AX = new THREE.Vector3(0, 1, 0);

  const zoom = (() => { try { const z = parseFloat(new URLSearchParams(location.search).get('zoom')); return z > 0 ? z : 1; } catch { return 1; } })();

  function update(t, c) {
    const cam = c?.camera, st = c?.R?.state;
    if (cam && st) uPx.value = ((cam.top - cam.bottom) / st.lowH) * zoom;
    const night = U.uNight.value;
    const gust = wind(t, mouth.x, mouth.z);
    for (let i = 0; i < NS; i++) {
      const a = frac((t * 3) / CYC_BASE + i / NS);
      const y = mouth.y + 0.02 + a * 1.75;
      const drift = (a * a * 1.05 + a * 0.12) * (0.8 + 0.2 * gust);
      const curl = 0.07 * Math.sin(cyc(t, 5) + i * 1.9 + a * 5.0) * (0.3 + a);
      P.copy(mouth).setY(y).addScaledVector(WIND_DIR, drift).addScaledVector(side, curl);
      const r = 0.045 + a * 0.2;
      S.set(r, r * 0.8, r);
      Q.setFromAxisAngle(AX, i * 1.7 + a * 2.0);
      Mx.compose(P, Q, S);
      smoke.setMatrixAt(i, Mx);
      smokeFade.setX(i, lerp(0.34, 0.4, night) * smooth(0, 0.12, a) * (1 - smooth(0.3, 1, a)));
    }
    smoke.instanceMatrix.needsUpdate = true; smokeFade.needsUpdate = true;
    smokeMat.color.copy(SM_DAY).lerp(SM_NIGHT, night);
    smokeMat.emissive.copy(SM_DAY_E).lerp(SM_NIGHT_E, night);
  }
  update(0, ctx);
  ctx.shared.tent = { pos: [tent.frame.x, tent.frame.z], ry: tent.frame.ry };
  return { group, update };
}
