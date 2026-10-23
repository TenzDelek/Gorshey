// Camp: the lingka picnic camp around the dance — white appliquéd tent, prayer-flag pole with lungta
// strings, mani-stone cairn with a khata, whitewashed sangbum with juniper smoke, and a woodpile of
// split juniper and dried yak-dung patties.
// Everything static is merged into three meshes (canvas, solids, cloth) plus one instanced smoke mesh,
// so the module costs ~4 draw calls per pass. All motion is loop-periodic (cyc / integer k per 24 s).
import * as THREE from 'three';
import { mat, GLSL, LOOP, cyc, wind, frac, smooth, hash2, rng, U, WIND_DIR } from './core.js';
import { Acc } from './camp-lib.js';
import { buildTent, canvasGLSL, CANVAS_FRAG, tentInteriorGLSL, TENT_INTERIOR_FRAG } from './camp-tent.js';
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
  // The canvas is smooth-shaded with its baked panel normals (flat: false): the wind flex moves the
  // outline but never re-shades a face, so each face stays one value band after the post pass.
  const uGlow = { value: 1 };
  const canvasMat = mat(0xffffff, {
    vertexColors: true, grain: 0.0, flat: false,
    vertex: {
      head: GLSL.wind + 'attribute vec2 aUV; attribute vec4 aP; varying vec2 vUV; varying vec4 vP; varying vec3 vNW;',
      body: /* glsl */`
        vUV = aUV; vP = aP;
        vNW = normalize(mat3(modelMatrix) * objectNormal);
        if (aP.y > 0.0) {
          float g = gWind(transformed.xz);
          float w = 0.6 * g + 0.4 * sin(cycP(23.0) + aP.z * 6.2831853 + transformed.x * 1.7 - transformed.z * 1.1);
          transformed += normal * (aP.y * 0.028 * w);
        }`,
    },
    fragment: { head: canvasGLSL(ctx.zoom ?? 1), body: CANVAS_FRAG },
  });
  // firelight on the canvas: tint the point light (the fire) per fragment, see campFireTint
  {
    const base = canvasMat.onBeforeCompile;
    canvasMat.onBeforeCompile = (sh, r) => {
      base(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getPointLightInfo( pointLight, geometryPosition, directLight );',
        'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tdirectLight.color = campFireTint( directLight.color );'));
    };
  }
  canvasMat.shadowSide = THREE.DoubleSide;
  const canvasMesh = new THREE.Mesh(canvas.build(), canvasMat);
  canvasMesh.name = 'tent-canvas';

  const solidMat = mat(0xffffff, {
    vertexColors: true, grain: 0.07, grainScale: 27,
    uniforms: { uGlow },
    vertex: { head: 'attribute vec4 aK; varying vec4 vK;', body: 'vK = aK;' },
    fragment: { head: SOLID_GLSL + tentInteriorGLSL(tent.frame), body: SOLID_FRAG + TENT_INTERIOR_FRAG },
  });
  const solidMesh = new THREE.Mesh(solids.build(), solidMat);
  solidMesh.name = 'camp-solids';

  const clothMesh = new THREE.Mesh(cloth.build(), clothMaterial());
  clothMesh.name = 'camp-cloth';
  clothMesh.frustumCulled = false;

  for (const me of [canvasMesh, solidMesh, clothMesh]) { me.castShadow = true; me.receiveShadow = true; group.add(me); }

  // ---- juniper smoke from the sangbum: a few small soft clumps drifting downwind ----
  // Same recipe as the fire's smoke: each clump is a little cluster of blobs (spheres). A blob's dither
  // coverage is aFade (its density, 1 at birth, thinning a little as it rises) in the core and falls to 0 over its outer SMOKE_EDGE art px,
  // measured on screen from the blob's projected centre, so a clump reads as one solid-ish soft shape that
  // only breaks into single pixels at its rim (never a thin 1-px lattice). Overlapping blobs share the Bayer
  // threshold, so their coverage is a union, never a sum. Clumps shrink away at the end of their life, so
  // they dissolve from the rim inward.
  const SMOKE_EDGE = 1.1;                 // art px of falloff inside each blob's silhouette
  const NC = 3, NBL = 3, NM = NC * NBL;   // clumps × blobs per clump (3 in flight: a light plume, clumps 2 s apart)
  const SMOKE_K = 8;                      // lives per 48 s loop (6 s each); clumps are staggered by 1/NC
  const PXW = 1 / (ctx.zoom > 0 ? ctx.zoom : 1);   // one art px in world m = uArtPx · PXW
  const smokeGeo = new THREE.IcosahedronGeometry(1, 2);
  const smokeFade = new THREE.InstancedBufferAttribute(new Float32Array(NM).fill(0), 1);
  smokeGeo.setAttribute('aFade', smokeFade);
  const smokeMat = mat(0xece9e2, {
    flat: false, grain: 0.03, grainScale: 14, instFade: true,
    vertex: {
      head: 'varying vec3 vSmC; varying float vSmR;',
      // view-space centre and radius of this blob (instances are uniformly scaled spheres)
      body: 'vSmC = (modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vSmR = length(instanceMatrix[0].xyz);',
    },
    fragment: {
      head: 'varying vec3 vSmC; varying float vSmR;',
      body: /* glsl */`
        {
          float rim = (vSmR - length(-vViewPosition.xy - vSmC.xy)) / (uArtPx * ${PXW.toFixed(4)});
          float cov = vFade * clamp((rim + 0.15) / ${SMOKE_EDGE.toFixed(2)}, 0.0, 1.0);
          if (cov < gBayer4(gl_FragCoord.xy)) discard;
          // by day the high sun would burn the lit face to page white and split the clump into many value
          // bands: keep it mostly self-coloured, one light warm grey with a slightly lighter top. At night the
          // fire lights the face the camera sees and would warm it to mauve: keep it self-coloured too, so it
          // lands on the fire smoke's blue-grey
          diffuseColor.rgb *= mix(0.3, 0.3, uNight);
          totalEmissiveRadiance *= mix(2.0, 1.0, uNight);
        }`,
    },
  });
  const smoke = new THREE.InstancedMesh(smokeGeo, smokeMat, NM);
  smoke.castShadow = false; smoke.receiveShadow = false; smoke.frustumCulled = false;
  smoke.name = 'sangbum-smoke';
  group.add(smoke);
  const SM_DAY = new THREE.Color(0xeeebe4), SM_NIGHT = new THREE.Color(0x707892);
  const SM_DAY_E = new THREE.Color(0x87837b), SM_NIGHT_E = new THREE.Color(0x2a3350);
  const mouth = sang.mouth;
  const side = new THREE.Vector3(-WIND_DIR.z, 0, WIND_DIR.x);
  const SR = rng(4242);
  const CLUMPS = Array.from({ length: NC }, (_, i) => ({ ph: i / NC + (SR() - 0.5) * 0.08, s: 13.3 + i * 5.71 }));
  const cycIndex = (u, k) => ((Math.floor(u) % k) + k) % k;   // per-life id, loop periodic
  const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();

  function update(t, c) {
    const night = U.uNight.value;
    const fl = c?.shared?.fireFlicker;
    uGlow.value = typeof fl === 'function' ? fl(t) : 1;
    const gust = wind(t, mouth.x, mouth.z);
    // a clump is born small and dense at the mouth, swells a little and loosens as it rises and leans
    // downwind, then shrinks away; per-life variation (size, rise, blob layout) comes from the life index
    CLUMPS.forEach((cl, i) => {
      const u = (t * SMOKE_K) / LOOP + cl.ph;
      const a = frac(u), ci = cycIndex(u, SMOKE_K);
      const h1 = hash2(cl.s, ci * 1.37 + 0.4), h2 = hash2(cl.s + 4.1, ci * 2.03 + 1.9), h3 = hash2(cl.s + 8.3, ci * 0.61 + 3.7);
      const y = mouth.y + 0.04 + (1.35 + 0.3 * h2) * (0.7 * a + 0.3 * (1 - (1 - a) * (1 - a)));
      const drift = 0.04 + a * 0.3 + a * a * 0.75 * (0.8 + 0.2 * gust);
      const curl = 0.05 * Math.sin(cyc(t, 5) + i * 1.9 + a * 5.0) * (0.3 + a) + (h3 - 0.5) * 0.1 * a;
      const cx = mouth.x + WIND_DIR.x * drift + side.x * curl, cz = mouth.z + WIND_DIR.z * drift + side.z * curl;
      const r0 = 0.15 * (0.85 + 0.3 * h1) * (0.5 + 0.6 * a) * Math.sqrt(smooth(0, 0.12, a)) * (1 - smooth(0.66, 1, a));
      const dens = (1 - 0.1 * a) * smooth(0, 0.06, a) * (1 - 0.15 * smooth(0.75, 1, a));
      const spread = 1 + 0.45 * a;
      const th = h1 * Math.PI * 2;
      for (let j = 0; j < NBL; j++) {
        let ox = 0, oy = 0, oz = 0, rs = 1;
        if (j === 1) { ox = Math.cos(th) * 0.85; oz = Math.sin(th) * 0.85; oy = (h2 - 0.5) * 0.4; rs = 0.75; }
        if (j === 2) { const ang = th + Math.PI + (h3 - 0.5) * 1.6; ox = Math.cos(ang) * 0.75; oz = Math.sin(ang) * 0.75; oy = 0.35; rs = 0.65; }
        const k = r0 * spread;
        P.set(cx + ox * k, y + oy * k, cz + oz * k);
        const r = r0 * rs;
        S.set(r, r, r);
        Mx.compose(P, Q, S);
        smoke.setMatrixAt(i * NBL + j, Mx);
        smokeFade.setX(i * NBL + j, r > 1e-4 ? dens : 0);
      }
    });
    smoke.instanceMatrix.needsUpdate = true; smokeFade.needsUpdate = true;
    smokeMat.color.copy(SM_DAY).lerp(SM_NIGHT, night);
    smokeMat.emissive.copy(SM_DAY_E).lerp(SM_NIGHT_E, night);
  }
  update(0, ctx);
  return { group, update };
}
