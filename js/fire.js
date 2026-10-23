// Bonfire at the origin: stone ring, ash bed, log teepee, embers, layered pixel flames,
// sparks, smoke, the warm fire light and a dithered night light-pool on the ground.
// Everything animated is a pure function of t with integer cycles per LOOP.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat, PAL, LAYOUT, LOOP as LOOP48, cyc, CYC_BASE, TAU, wind, rng, frac, clamp, lerp, smooth, hash2, U, WIND_DIR, glslColor as glc } from './core.js';
// Particle lives were tuned against a 24 s period; core LOOP is 48 s = 2 × CYC_BASE, so these stay seamless.
const LOOP = CYC_BASE;

const [FX, FZ] = LAYOUT.fire;
// Prevailing wind on the ground plane is core WIND_DIR (core.wind() only gives a scalar gust).
// Smoke and sparks drift toward screen-right at the default camera.
const WX = WIND_DIR.x, WZ = WIND_DIR.z;
const FLAME_S = 1.1;    // overall flame height scale
const FLAME_H = 1.04 * FLAME_S;   // nominal flame height (m)


// Fire colours (sRGB hex; ramps go from hot core to cool tip)
const FC = {
  core: PAL.flameCore, hot: 0xffd866, flame: PAL.flame, warm: 0xf08326, deep: PAL.flameDeep, tip: 0xa8321c,
  ember: 0xff7a1e, emberDeep: 0x9a2410,
  ash: 0x5e5852, ashLight: 0x8f877c, ashDark: 0x3f3934,
};

// Shared GLSL: loop-periodic value noise (period P lattice cells in y) + ember crackle.
const FIRE_GLSL = /* glsl */`
  float fHashP(vec2 i, float P) { i.y = mod(i.y, P); return gHash12(i); }
  float fNoiseP(vec2 p, float P) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHashP(i, P), fHashP(i + vec2(1, 0), P), u.x),
               mix(fHashP(i + vec2(0, 1), P), fHashP(i + vec2(1, 1), P), u.x), u.y);
  }
  // Glowing ember cells (~1 art px) that pulse at integer cycles per loop. k = 0..1 coverage.
  vec3 emberGlow(vec3 wp, float k) {
    vec3 cell = floor(wp * 24.0);
    float h = gHash13(cell + 17.0);
    float h2 = gHash13(cell + 91.0);
    float n = 6.0 + floor(h2 * 14.0);
    float pulse = 0.5 + 0.5 * sin(cycP(n) + h * 6.2831);
    float on = step(1.0 - k, h);
    vec3 c = mix(${glc(FC.emberDeep)}, ${glc(FC.ember)}, pulse);
    c = mix(c, ${glc(FC.hot)}, step(0.86, pulse) * step(0.7, k));
    return c * on * (0.35 + 0.65 * pulse);
  }
`;

export function build(ctx) {
  const group = new THREE.Group();
  group.name = 'fire';
  group.position.set(FX, 0, FZ);
  const R = rng(2024);

  // ---------------------------------------------------------------- ash bed
  {
    const g = new THREE.RingGeometry(0.0, 0.76, 22, 5);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const r = Math.hypot(x, z), a = Math.atan2(z, x);
      const wob = 1 + (hash2(Math.round(a * 30) + 3, 7) - 0.5) * 0.14;
      const rr = r * wob;
      const s = r > 1e-4 ? rr / r : 1;
      p.setXYZ(i, x * s, 0.006 + 0.05 * Math.pow(1 - clamp(rr / 0.76), 1.6), z * s);
    }
    g.computeVertexNormals();
    const m = mat(FC.ash, {
      grain: 0.16, grainScale: 26,
      fragment: {
        head: FIRE_GLSL,
        body: /* glsl */`
          {
            float r = length(vGWorld.xz);
            float b = gBayer4(gl_FragCoord.xy);
            float sp = gHash12(floor(vGWorld.xz * 26.0) + 3.0);
            vec3 c = ${glc(FC.ash)};
            c = mix(c, ${glc(FC.ashLight)}, step(0.8, sp));
            // charred centre, dithered into the grey ash
            float charK = 1.0 - smoothstep(0.16, 0.44, r);
            if (charK > b) c = ${glc(PAL.charcoal)} * (0.8 + 0.5 * sp);
            // earthy rim under / outside the stones
            float rim = smoothstep(0.5, 0.74, r);
            if (rim > b) c = mix(${glc(PAL.earthDark)}, ${glc(FC.ashDark)}, sp);
            diffuseColor.rgb = c * (1.0 + (sp - 0.5) * 0.2);
            totalEmissiveRadiance += emberGlow(vGWorld, 0.55 * (1.0 - smoothstep(0.1, 0.34, r)));
          }`,
      },
    });
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
    const ash = new THREE.Mesh(g, m);
    ash.receiveShadow = true; ash.castShadow = false;
    group.add(ash);
  }

  // ---------------------------------------------------------------- stone ring
  {
    const geos = [];
    const N = 11;
    const tints = [PAL.stone, 0xa39e93, 0x9b958a, PAL.stoneDark, 0x857f75, 0xb2ada1];
    const col = new THREE.Color(), soot = new THREE.Color(0x35302c);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + (R() - 0.5) * 0.3;
      const rr = 0.68 + (R() - 0.5) * 0.06;
      const sx = 0.1 + R() * 0.05, sy = 0.08 + R() * 0.06, sz = 0.085 + R() * 0.04;
      const g = new THREE.IcosahedronGeometry(1, 0);
      const p = g.attributes.position;
      const seed = i * 13.7;
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
        const j = 1 + (hash2(Math.round(x * 50) + seed, Math.round(y * 50) * 3.1 + Math.round(z * 50)) - 0.5) * 0.45;
        p.setXYZ(v, x * j, Math.max(y * j, -0.3), z * j);
      }
      g.scale(sx, sy, sz);
      g.rotateY(-a + (R() - 0.5) * 0.6);
      g.translate(Math.cos(a) * rr, sy * 0.45, Math.sin(a) * rr);
      g.computeVertexNormals();
      const base = col.setHex(tints[i % tints.length]).clone();
      const cols = new Float32Array(p.count * 3);
      const n = g.attributes.normal;
      for (let v = 0; v < p.count; v++) {
        // inner faces blackened by soot
        const px = p.getX(v), pz = p.getZ(v);
        const inward = -(n.getX(v) * px + n.getZ(v) * pz) / Math.max(1e-4, Math.hypot(px, pz));
        const c = base.clone().lerp(soot, clamp(inward * 0.9 - 0.15) * 0.7);
        cols[v * 3] = c.r; cols[v * 3 + 1] = c.g; cols[v * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geos.push(g);
    }
    const m = mat(0xffffff, { grain: 0.1, grainScale: 30, fragment: { head: '', body: '' } });
    m.vertexColors = true;
    const stones = new THREE.Mesh(mergeGeometries(geos), m);
    stones.castShadow = true; stones.receiveShadow = true;
    group.add(stones);
  }

  // ---------------------------------------------------------------- logs (teepee + crossing)
  {
    const geos = [];
    const up = new THREE.Vector3(0, 1, 0);
    const addLog = (a, b, rad) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(rad * 0.85, rad, len, 6, 3);
      const p = g.attributes.position, n = g.attributes.normal;
      const along = new Float32Array(p.count), cap = new Float32Array(p.count);
      for (let v = 0; v < p.count; v++) {
        along[v] = p.getY(v) / len + 0.5;
        cap[v] = Math.abs(n.getY(v)) > 0.9 ? 1 : 0;
      }
      g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
      g.setAttribute('aCap', new THREE.BufferAttribute(cap, 1));
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
      geos.push(g);
    };
    const NL = 6;
    for (let i = 0; i < NL; i++) {
      const ang = (i / NL) * TAU + 0.4 + (R() - 0.5) * 0.4;
      const ro = 0.52 + R() * 0.1;
      const a = new THREE.Vector3(Math.cos(ang) * ro, 0.04, Math.sin(ang) * ro);
      const ang2 = ang + Math.PI + (R() - 0.5) * 0.5;
      const ri = 0.04 + R() * 0.04;
      const b = new THREE.Vector3(Math.cos(ang2) * ri, 0.36 + R() * 0.12, Math.sin(ang2) * ri);
      addLog(a, b, 0.044 + R() * 0.012);
    }
    // two half-burnt logs lying across the coals
    addLog(new THREE.Vector3(-0.44, 0.05, 0.2), new THREE.Vector3(0.34, 0.08, -0.12), 0.05);
    addLog(new THREE.Vector3(0.12, 0.05, 0.46), new THREE.Vector3(-0.1, 0.09, -0.36), 0.046);
    const m = mat(PAL.wood, {
      grain: 0.1, grainScale: 30,
      vertex: { head: 'attribute float aAlong; attribute float aCap; varying float vAlong; varying float vCap;', body: 'vAlong = aAlong; vCap = aCap;' },
      fragment: {
        head: 'varying float vAlong; varying float vCap;' + FIRE_GLSL,
        body: /* glsl */`
          {
            float b = gBayer4(gl_FragCoord.xy);
            float sp = gHash13(floor(vGWorld * 30.0) + 5.0);
            vec3 c = mix(${glc(PAL.wood)}, ${glc(0x5c3a22)}, step(0.7, sp));
            c *= 0.92 + 0.16 * step(0.5, fract(vAlong * 9.0 + sp * 0.3));   // bark rings
            if (vCap > 0.5 && vAlong < 0.5) c = mix(${glc(PAL.woodLight)}, ${glc(0xc79a64)}, sp);  // cut end
            float charK = smoothstep(0.36, 0.6, vAlong) + (sp - 0.5) * 0.25;
            if (charK > b) c = ${glc(PAL.charcoal)} * (0.75 + 0.6 * sp);
            diffuseColor.rgb = c;
            totalEmissiveRadiance += emberGlow(vGWorld, 0.7 * smoothstep(0.6, 0.9, vAlong));
          }`,
      },
    });
    const logs = new THREE.Mesh(mergeGeometries(geos), m);
    logs.castShadow = true; logs.receiveShadow = true;
    group.add(logs);
  }

  // ---------------------------------------------------------------- coal heap + ember chunks
  {
    const geos = [];
    const heap = new THREE.SphereGeometry(0.3, 10, 4, 0, TAU, 0, Math.PI / 2);
    heap.scale(1, 0.28, 1);
    geos.push(heap.toNonIndexed());
    const chunks = [[0.33, 0.27, 0.05], [0.28, 0.4, 0.04], [-0.3, 0.24, 0.04], [0.44, 0.06, 0.035], [0.1, 0.38, 0.03], [-0.18, -0.3, 0.04], [0.22, -0.2, 0.035]];
    for (const [x, z, r] of chunks) {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.scale(1.2, 0.7, 1);
      g.translate(x, r * 0.5 + 0.02, z);
      geos.push(g);
    }
    const m = mat(PAL.charcoal, {
      grain: 0.2, grainScale: 26,
      fragment: { head: FIRE_GLSL, body: `totalEmissiveRadiance += emberGlow(vGWorld, 0.8) * (1.0 + 0.3 * uNight);` },
    });
    const coals = new THREE.Mesh(mergeGeometries(geos), m);
    coals.castShadow = false; coals.receiveShadow = true;
    group.add(coals);
  }

  // ---------------------------------------------------------------- flames
  // Unit cone, base at y = 0, tip at y = 1, open bottom. Each instance = one tongue.
  const tongueGeo = new THREE.ConeGeometry(1, 1, 7, 6, true);
  tongueGeo.translate(0, 0.5, 0);
  const TONGUES = [];
  {
    // [offX, offZ, radius, height, rampShift, bend, splay, kind]  kind: 0 body, 1 tongue, 2 core, 3 lick
    const spec = [
      [0.0, 0.0, 0.32, 0.46, -0.22, 0.25, 0.0, 0],    // wide base body
      [0.0, 0.0, 0.15, 1.04, 0.0, 0.55, 0.0, 1],      // main tongue
      [-0.1, -0.06, 0.13, 0.86, 0.02, 0.65, 0.14, 1],
      [0.11, -0.05, 0.12, 0.8, 0.02, 0.65, 0.17, 1],
      [-0.07, 0.11, 0.12, 0.72, 0.0, 0.7, 0.2, 1],
      [0.08, 0.1, 0.11, 0.66, 0.0, 0.7, 0.22, 1],
      [0.18, 0.07, 0.09, 0.52, 0.06, 0.8, 0.32, 1],
      [-0.18, 0.04, 0.09, 0.54, 0.06, 0.8, 0.32, 1],
      [0.02, -0.18, 0.1, 0.6, 0.06, 0.8, 0.26, 1],
      [-0.13, -0.14, 0.09, 0.46, 0.08, 0.8, 0.3, 1],
      [0.06, 0.08, 0.13, 0.42, -0.42, 0.45, 0.05, 2],  // bright core, toward camera
      [0.1, 0.0, 0.1, 0.36, -0.48, 0.45, 0.1, 2],
      [-0.03, 0.1, 0.1, 0.48, -0.36, 0.5, 0.08, 2],
      [0.0, 0.0, 0.055, 1.18, 0.04, 1.1, 0.05, 3],     // thin flickering licks (born/die)
      [0.07, -0.04, 0.05, 1.06, 0.06, 1.1, 0.16, 3],
      [-0.07, 0.04, 0.05, 0.98, 0.06, 1.1, 0.18, 3],
    ];
    spec.forEach((s) => {
      TONGUES.push({
        x: s[0], z: s[1], r: s[2], h: s[3], shift: s[4], bend: s[5], splay: s[6], kind: s[7],
        sdir: Math.atan2(s[1], s[0]),
        n1: 37 + Math.floor(R() * 40), n2: 89 + Math.floor(R() * 60), n3: 150 + Math.floor(R() * 60),
        p1: R() * TAU, p2: R() * TAU, p3: R() * TAU,
        k: 40 + 8 * Math.floor(R() * 4), ph: R(),
        wn: 16 + Math.floor(R() * 20), wp: R() * TAU,
      });
    });
  }
  const NT = TONGUES.length;
  const aSeed = new Float32Array(NT * 4);
  TONGUES.forEach((tg, i) => {
    aSeed[i * 4] = R() * TAU;                     // phase
    aSeed[i * 4 + 1] = 48 + Math.floor(R() * 40); // integer cycles / loop for the bend wave
    aSeed[i * 4 + 2] = tg.shift;                  // ramp shift
    aSeed[i * 4 + 3] = tg.bend;                   // bend amplitude
  });
  tongueGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  const tFade = new THREE.InstancedBufferAttribute(new Float32Array(NT).fill(1), 1);
  tongueGeo.setAttribute('aFade', tFade);
  const flameMat = mat(0x000000, {
    flat: false, grain: 0, instFade: true,
    vertex: {
      head: 'attribute vec4 aSeed; varying float vH; varying vec4 vSeed;',
      body: /* glsl */`
        float fh = clamp(position.y, 0.0, 1.0);
        float fa = atan(position.z, position.x);
        float fw = sin(fh * 4.2 - cycP(aSeed.y) + aSeed.x) * aSeed.w;
        float fw2 = cos(fh * 3.1 - cycP(aSeed.y + 13.0) + aSeed.x * 1.7) * aSeed.w * 0.6;
        transformed.x += fw * fh * fh;
        transformed.z += fw2 * fh * fh;
        transformed.xz *= 1.0 + 0.2 * sin(cycP(96.0) + fa * 2.0 + fh * 7.0 + aSeed.x);
        vH = fh; vSeed = aSeed;`,
    },
    fragment: {
      head: 'varying float vH; varying vec4 vSeed;' + FIRE_GLSL,
      body: /* glsl */`
        {
          float b = gBayer4(gl_FragCoord.xy);
          // rising, loop-periodic noise in view space (screen aligned): 30 periods per loop
          vec2 vp = -vViewPosition.xy;
          float scroll = uTime / 24.0 * 8.0 * 30.0;
          float n = fNoiseP(vec2(vp.x * 9.0, vp.y * 6.0 - scroll), 8.0);
          float n2 = fNoiseP(vec2(vp.x * 19.0 + 5.0, vp.y * 12.0 - scroll * 2.0), 8.0);
          float nn = n * 0.6 + n2 * 0.4;
          float h = vH;
          float wy = clamp(vGWorld.y / ${FLAME_H.toFixed(2)}, 0.0, 1.2);
          // tips dissolve into loose pixels; only the top of each tongue erodes
          float erode = smoothstep(0.55, 1.0, h) * 0.62;
          float keep = (1.0 - smoothstep(0.72, 1.0, h)) * vFade;
          if (nn < erode || keep < b) discard;
          float facing = clamp(normalize(vNormal).z, 0.0, 1.0);
          float v = wy * 0.55 + h * 0.4 + (1.0 - facing) * 0.42 + vSeed.z + (0.5 - nn) * 0.22;
          float lv = v * 4.0 + (b - 0.5) * 0.8;
          vec3 c = ${glc(FC.core)};
          if (lv > 1.1) c = ${glc(FC.hot)};
          if (lv > 2.0) c = ${glc(FC.flame)};
          if (lv > 2.9) c = ${glc(FC.warm)};
          if (lv > 3.6) c = ${glc(FC.deep)};
          if (lv > 4.4) c = ${glc(FC.tip)};
          diffuseColor.rgb = vec3(0.0);
          totalEmissiveRadiance = c;
        }`,
    },
  });
  const flames = new THREE.InstancedMesh(tongueGeo, flameMat, NT);
  flames.castShadow = false; flames.receiveShadow = false;
  flames.frustumCulled = false;
  group.add(flames);

  // Emissive colour taken from the per-instance colour (diffuse unused).
  const emissiveFromInstance = `totalEmissiveRadiance = diffuseColor.rgb; diffuseColor.rgb = vec3(0.0);`;

  // ---------------------------------------------------------------- loose flame bits
  const NB = 8;
  const bitGeo = new THREE.OctahedronGeometry(1, 0);
  const bitFade = new THREE.InstancedBufferAttribute(new Float32Array(NB).fill(1), 1);
  bitGeo.setAttribute('aFade', bitFade);
  const bitMat = mat(0xffffff, { grain: 0, instFade: true, fragment: { head: '', body: emissiveFromInstance } });
  const bits = new THREE.InstancedMesh(bitGeo, bitMat, NB);
  bits.castShadow = false; bits.receiveShadow = false; bits.frustumCulled = false;
  const BITS = Array.from({ length: NB }, (_, i) => ({ k: 36 + 4 * Math.floor(R() * 5), ph: i / NB + R() * 0.05 }));
  for (let i = 0; i < NB; i++) bits.setColorAt(i, new THREE.Color(FC.flame));
  group.add(bits);

  // ---------------------------------------------------------------- sparks
  const NS = 56;
  const sparkGeo = new THREE.BoxGeometry(1, 1, 1);
  const sparkFade = new THREE.InstancedBufferAttribute(new Float32Array(NS).fill(1), 1);
  sparkGeo.setAttribute('aFade', sparkFade);
  const sparkMat = mat(0xffffff, { grain: 0, instFade: true, fragment: { head: '', body: emissiveFromInstance } });
  const sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, NS);
  sparks.castShadow = false; sparks.receiveShadow = false; sparks.frustumCulled = false;
  // k = lives per 48 s loop: 24 / 32 / 40 → 2 / 1.5 / 1.2 s lives
  const SPARKS = Array.from({ length: NS }, (_, i) => ({ k: [24, 32, 40][Math.floor(R() * 3)], ph: i / NS, s: i * 7.13 + 1 }));
  for (let i = 0; i < NS; i++) sparks.setColorAt(i, new THREE.Color(FC.hot));
  group.add(sparks);

  // ---------------------------------------------------------------- smoke
  // A thin wisp that only shows high above the pit. The back row of the ring sits behind the column on
  // screen, so the smoke is gated on the pixel's screen height above the pit base, expressed in metres of
  // height at the pit (hq). hq = view-space y relative to the pit, / cos(elevation), so it holds for any
  // azimuth and zoom. At the default 33° elevation the dancers behind the fire reach hq ≈ 3.52 m (raised
  // sleeves; hat tops ≈ 3.46 m) over the whole loop (shots/polish/fire/headsweep.mjs), so nothing below
  // SMOKE_G0 is drawn.
  const SMOKE_G0 = 3.58, SMOKE_G1 = 3.85;
  const NM = 14;
  const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
  const smokeFade = new THREE.InstancedBufferAttribute(new Float32Array(NM).fill(0), 1);
  smokeGeo.setAttribute('aFade', smokeFade);
  const smokeMat = mat(0xffffff, {
    flat: false, grain: 0.03, grainScale: 14, instFade: true,
    fragment: {
      head: '',
      body: /* glsl */`
        {
          float hq = (-vViewPosition.y - (viewMatrix * vec4(${FX.toFixed(3)}, 0.0, ${FZ.toFixed(3)}, 1.0)).y) / max(viewMatrix[1].y, 0.2);
          float gate = smoothstep(${SMOKE_G0.toFixed(2)}, ${SMOKE_G1.toFixed(2)}, hq);
          // denser in the middle of each puff, thin at its rim
          float sf = clamp(normalize(vNormal).z, 0.0, 1.0);
          if (vFade * gate * (0.25 + 0.95 * sf * sf) < gBayer4(gl_FragCoord.xy)) discard;
          // cool grey, a touch lighter as it thins out higher up; mostly self-coloured so it reads as smoke
          float up = smoothstep(${SMOKE_G0.toFixed(2)}, 5.4, hq);
          vec3 dayC = mix(${glc(0x6c7886)}, ${glc(0x8c96a2)}, up);
          vec3 nightC = mix(${glc(0x5d6680)}, ${glc(0x6e7896)}, up);
          vec3 c = mix(dayC, nightC, uNight);
          diffuseColor.rgb = c * mix(0.3, 0.8, uNight);
          totalEmissiveRadiance = c * mix(0.66, 0.32, uNight);
        }`,
    },
  });
  const smoke = new THREE.InstancedMesh(smokeGeo, smokeMat, NM);
  smoke.castShadow = false; smoke.receiveShadow = false; smoke.frustumCulled = false;
  group.add(smoke);

  // ---------------------------------------------------------------- fire light
  const light = new THREE.PointLight(0xff9446, 1, 8.5, 1.0);
  light.position.set(0, 1.3, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = 7;
  light.shadow.bias = -0.004;
  light.shadow.normalBias = 0.03;
  light.shadow.autoUpdate = false;
  light.shadow.intensity = 0;
  // Render the cube shadow once in main.js's pre-ready frame, so its depth programs compile at load and
  // the first switch to night doesn't hitch. castShadow stays on; night only flips autoUpdate + intensity.
  light.shadow.needsUpdate = true;
  group.add(light);
  // three's shadow pass runs before the renderer gathers the frame's lights, so on the very first frame the
  // cube-shadow depth programs would be keyed to an empty light state and compile again on the first night
  // frame anyway. Once the fire is in the scene, gather the scene's lights once (compile() of an empty
  // object compiles no materials; its lights come from the target scene) so that first pass builds the
  // same programs night uses.
  let lightsGathered = false;
  const gatherLights = () => {
    let root = light;
    while (root.parent) root = root.parent;
    if (root !== ctx.scene || !ctx.renderer) return;
    ctx.renderer.compile(new THREE.Object3D(), ctx.camera, ctx.scene);
    lightsGathered = true;
  };

  // The two slow components carry the flicker and the fast ones are small, so lit surfaces step about one
  // dither band at a time.
  const flicker = (t) => 1 + 0.05 * Math.sin(cyc(t, 83)) + 0.02 * Math.sin(cyc(t, 131) + 1.3) + 0.01 * Math.sin(cyc(t, 197) + 2.1) + 0.05 * Math.sin(cyc(t, 37) + 0.4);
  // ctx.shared.fireFlicker(t) → flicker factor at time t (a pure function of t). Read as a number
  // (+ctx.shared.fireFlicker) it gives the factor of the frame fire last updated.
  let flNow = flicker(0);
  const fireFlicker = (t) => flicker(t);
  fireFlicker.valueOf = () => flNow;
  ctx.shared.fireFlicker = fireFlicker;

  // ---------------------------------------------------------------- night light pool on the ground
  // Sparse warm stipple on the ground, densest near the pit, thinning out in Bayer steps.
  const glowU = { uGlow: { value: 1 } };
  {
    const g = new THREE.RingGeometry(0.72, 3.3, 48, 3);
    g.rotateX(-Math.PI / 2);
    const m = mat(0x000000, {
      grain: 0, uniforms: glowU,
      fragment: {
        head: 'uniform float uGlow;',
        body: /* glsl */`
          {
            float r = length(vGWorld.xz);
            float b = gBayer4(gl_FragCoord.xy);
            float k = uNight * uGlow * (1.0 - smoothstep(0.8, 3.2, r));
            float dens = k * k * 0.3;
            if (dens < b) discard;
            float lv = k * 2.0 + (b - 0.5) * 0.5;
            vec3 c = ${glc(0x4a2210)};
            if (lv > 0.9) c = ${glc(0x6e3414)};
            if (lv > 1.5) c = ${glc(0x8c4618)};
            diffuseColor.rgb = vec3(0.0);
            totalEmissiveRadiance = c;
          }`,
      },
    });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
    const pool = new THREE.Mesh(g, m);
    pool.position.y = 0.012;
    pool.castShadow = false; pool.receiveShadow = false;
    group.add(pool);
  }

  // ---------------------------------------------------------------- update
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), AX = new THREE.Vector3();
  const C = new THREE.Color();
  const stops = [FC.core, FC.hot, FC.flame, FC.deep, FC.tip].map((h) => new THREE.Color(h));
  const ramp = (k, out) => {
    const x = clamp(k) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    return out.copy(stops[i]).lerp(stops[i + 1], x - i);
  };
  const cycIndex = (u, k) => ((Math.floor(u) % k) + k) % k;   // per-cycle id, loop periodic

  function update(t) {
    if (!lightsGathered) gatherLights();
    const night = U.uNight.value;
    const gust = wind(t, FX, FZ);
    const lean = 0.09 + 0.07 * gust;               // radians toward WIND_DIR
    const fl = flicker(t);
    flNow = fl;

    // tongues
    TONGUES.forEach((tg, i) => {
      let hm = 1 + 0.14 * Math.sin(cyc(t, tg.n1) + tg.p1) + 0.08 * Math.sin(cyc(t, tg.n2) + tg.p2) + 0.05 * Math.sin(cyc(t, tg.n3) + tg.p3);
      const rm = 1 + 0.08 * Math.sin(cyc(t, tg.n2) + tg.p1);
      let fade = 1;
      if (tg.kind === 0) hm = 1 + 0.06 * Math.sin(cyc(t, tg.n1) + tg.p1);
      if (tg.kind === 3) {
        const a = frac((t * tg.k) / LOOP + tg.ph);
        const env = Math.sin(Math.PI * a);
        hm *= 0.3 + 0.8 * env;
        fade = clamp(env * 1.6);
      }
      const sway = 0.07 * Math.sin(cyc(t, tg.wn) + tg.wp);
      const sp = tg.splay * (1 + 0.25 * Math.sin(cyc(t, tg.wn + 5) + tg.p2));
      const lx = WX * lean + Math.cos(tg.sdir) * sp + sway * 0.6;
      const lz = WZ * lean + Math.sin(tg.sdir) * sp + sway * 0.4;
      // rotate +Y toward (lx, lz): axis = (lz, 0, -lx)
      AX.set(lz, 0, -lx).normalize();
      Q.setFromAxisAngle(AX, Math.hypot(lx, lz));
      const jx = 0.012 * Math.sin(cyc(t, tg.n1 + 7) + tg.p3), jz = 0.012 * Math.cos(cyc(t, tg.n2 + 3) + tg.p2);
      P.set(tg.x + jx, 0.05, tg.z + jz);
      S.set(tg.r * rm, tg.h * hm * FLAME_S, tg.r * rm);
      M.compose(P, Q, S);
      flames.setMatrixAt(i, M);
      tFade.setX(i, fade);
    });
    flames.instanceMatrix.needsUpdate = true;
    tFade.needsUpdate = true;

    // loose flame bits breaking off the tips
    BITS.forEach((bt, i) => {
      const u = (t * bt.k) / LOOP + bt.ph;
      const a = frac(u), ci = cycIndex(u, bt.k);
      const h1 = hash2(i * 3.1 + 0.5, ci * 1.7 + 2.3), h2 = hash2(i * 5.7 + 1.5, ci * 2.9 + 0.7), h3 = hash2(i * 1.3 + 9.1, ci * 4.1 + 5.5);
      const live = h3 < 0.7;
      const ang = h1 * TAU, rr = 0.02 + h2 * 0.12;
      const y = (0.62 + h2 * 0.32) * FLAME_S + a * (0.28 + 0.2 * h1);
      const drift = (lean + 0.05) * y;
      P.set(Math.cos(ang) * rr + WX * drift, y, Math.sin(ang) * rr + WZ * drift);
      const s = live ? (0.03 - 0.016 * a) * (0.85 + 0.4 * h3) : 0;
      S.set(s, s * 1.6, s);
      M.compose(P, Q.identity(), S);
      bits.setMatrixAt(i, M);
      bits.setColorAt(i, ramp(0.62 + a * 0.38, C));
      bitFade.setX(i, 1 - smooth(0.35, 1, a));
    });
    bits.instanceMatrix.needsUpdate = true; bits.instanceColor.needsUpdate = true; bitFade.needsUpdate = true;

    // sparks: shoot up out of the flames, slow down, spiral a little in a narrow column right over the
    // pit, and are gone by ~2.2 m (below the back row's waists on screen); cool from yellow to deep red
    SPARKS.forEach((sp, i) => {
      const u = (t * sp.k) / LOOP48 + sp.ph;
      const a = frac(u), ci = cycIndex(u, sp.k);
      const h1 = hash2(sp.s, ci * 1.31 + 0.2), h2 = hash2(sp.s + 3.3, ci * 2.17 + 1.1), h3 = hash2(sp.s + 7.7, ci * 0.73 + 4.4);
      const live = h3 < 0.4;
      const y0 = 0.7 + h2 * 0.24;
      const H = 0.82 + h1 * 0.42;                    // top y0 + H ≤ 2.18 m
      const y = y0 + H * (1 - Math.pow(1 - a, 2.4));
      const spin = (h1 < 0.5 ? -1 : 1) * (0.4 + h2 * 0.8);
      const th = h1 * TAU + spin * a * TAU;
      const rr = 0.025 + 0.05 * h2 + 0.06 * a;
      const drift = a * (0.12 + 0.08 * gust) * (0.6 + h3 * 1.5);
      const zig = 0.012 * Math.sin(cyc(t, 144) + i * 1.7) * a;
      P.set(Math.cos(th) * rr + WX * drift + zig, y, Math.sin(th) * rr + WZ * drift);
      const s = live ? 0.04 : 0;
      S.set(s, s * (a < 0.25 ? 1.8 : 1), s);
      M.compose(P, Q.identity(), S);
      sparks.setMatrixAt(i, M);
      sparks.setColorAt(i, ramp(0.15 + a * 0.85, C));
      sparkFade.setX(i, 1 - smooth(0.6, 1, a));
    });
    sparks.instanceMatrix.needsUpdate = true; sparks.instanceColor.needsUpdate = true; sparkFade.needsUpdate = true;

    // smoke: a thin dithered wisp (≤ 3 art px wide where it appears) that widens, thins and leans downwind
    for (let i = 0; i < NM; i++) {
      const a = frac((t * 3) / LOOP + i / NM);
      const y = 3.2 + a * 2.3;
      const r = 0.04 + 0.32 * Math.pow(a, 1.6);
      const drift = a * 0.8 + a * a * 1.1 * (0.75 + 0.25 * gust);
      const wob = 0.1 * Math.sin(cyc(t, 5) + i * 2.1) * a;
      P.set(WX * drift + wob, y, WZ * drift - wob * 0.5);
      S.set(r, Math.max(r * 0.8, 0.1), r);
      Q.setFromAxisAngle(AX.set(0, 1, 0), i * 1.3 + a * 1.5);
      M.compose(P, Q, S);
      smoke.setMatrixAt(i, M);
      smokeFade.setX(i, lerp(0.25, 0.46, night) * smooth(0, 0.1, a) * (1 - smooth(0.4, 1, a)));
    }
    smoke.instanceMatrix.needsUpdate = true; smokeFade.needsUpdate = true;

    // light: subtle by day, the main light at night; loop-periodic flicker and a little wander
    light.intensity = lerp(0.9, 9.5, night) * fl;
    light.position.set(0.03 * Math.sin(cyc(t, 61)), 1.3 + 0.05 * Math.sin(cyc(t, 89)), 0.03 * Math.cos(cyc(t, 73)));
    const shadowOn = night > 0.3;
    light.shadow.autoUpdate = shadowOn;
    light.shadow.intensity = shadowOn ? smooth(0.3, 0.8, night) * 0.85 : 0;
    glowU.uGlow.value = fl;
  }

  update(0);
  return { group, update };
}
