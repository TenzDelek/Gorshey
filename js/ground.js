// Ground: the meadow base of the diorama.
//   1. a dark soil plane that dissolves into the page through the Bayer dither at the patch rim,
//      painted with the trampled dance ring, the ash disc round the fire, worn prop footprints and faint paths;
//   2. ~62k grass blades in ONE InstancedMesh: camera-facing 1-art-px quads, dark base -> light tip,
//      per-blade value jitter, swaying tips (loop-periodic gWind), bases fixed. A sparse canopy layer
//      (long 1-px streaks) over a dense dark undergrowth layer, so the field reads as vertical striping;
//   3. wildflowers (potentilla / buttercup, gentian, edelweiss, a few lousewort) as 1-2 px heads on stalks,
//      in a few drifts toward the rim;
//   4. a handful of small, deeply sunk stones on the flanks.
// Ground owns pressed grass: core FOOTPRINTS (rug, its apron, tea table, yak, dog) are applied to the blade
// heights at placement time (ctx.shared.groundPressesGrass = true), so the colour ramp matches the real height.
import * as THREE from 'three';
import {
  mat, GLSL, LAYOUT, CLEAR, PATCH, FOOTPRINTS, patchRadius, footprintK, inFootprint, glslColor,
  fbm2, vnoise2, rng, smooth, clamp, lerp, isClear,
} from './core.js';

// ---- palette (sRGB hex, muted high-altitude meadow) ----------------------------------
const C = {
  soil: 0x263a14, soilDeep: 0x1c2b0f,
  turf: 0x4a6430,                         // short cropped turf under props
  rimTurf: 0x5c7539, rimPale: 0x7d9457,   // dissolve band: dots read as pale grass, not soil
  earth: 0x86735a, earthDark: 0x66573f, earthLight: 0xa08e70,   // packed dance ring
  ash: 0xa29d94, ashDark: 0x6a655e, char: 0x2e2a27, dust: 0x8c8274,
  // blade ramp
  bBase: 0x1c2713, bMid: 0x445f2a, bMid2: 0x597838,
  tipA: 0x8aa36a, tipB: 0xa9ba9a, tipDry: 0xb6ad78, tipWorn: 0x8f8b5c, wornBase: 0x4c4a2c,
  stalk: 0x46602a, under: 0x34491f,
  // stones: cool grey top, blue-grey sides (albedo; lit they land near #7d7f7c / #4a5560)
  stoneTop: 0x7a7c78, stoneSide: 0x4a5664,
};
const lin = (hex) => new THREE.Color().setHex(hex);
const v3 = glslColor;
const f = (v) => v.toFixed(4);

// Art pixel in world units at the default 1080² framing (fitW 15.2 m / 360 rows). Blade heights are world-fixed;
// these "art px" are for authoring only (the real one is U.uArtPx and varies a little with the viewport).
const PX = 15.2 / 360;
const EL = THREE.MathUtils.degToRad(33);
const PXV = PX / Math.cos(EL);   // world height of one screen pixel for a vertical blade
// The blade height recipe below was authored in px of the earlier 13.4 m framing (0.037 m); LEG converts those to
// today's art px so the world heights stay as they were.
const LEG = 0.037 / PX;
// Lit surfaces come out ~1.15x their diffuse colour (sun + sky); pre-compensate so the ramp lands on target.
const EXPO = 0.86;

// ---- zones (JS side; GLSL twins below use the same formulas) ------------------------
const RING_R = LAYOUT.path.r, RING_W = LAYOUT.path.width;
function ringF(x, z) {
  const d = Math.abs(Math.hypot(x, z) - RING_R)
    + (fbm2(x * 1.6 + 3.1, z * 1.6 - 7.2) - 0.5) * 0.34
    + (vnoise2(x * 7.0, z * 7.0) - 0.5) * 0.12;
  return 1 - smooth(RING_W * 0.30, RING_W * 0.56, d);
}
// Bare ground round the pit: fire's ash bed ends at 0.76 m and its stones at ~0.83 m; outside them a ~0.3 m band
// of trodden ash and earth, ragged where it meets the grass.
const ASH_R0 = 1.02, ASH_R1 = 1.34;
function fireF(x, z) {
  const d = Math.hypot(x, z) + (fbm2(x * 2.3 + 5.0, z * 2.3 + 1.0) - 0.5) * 0.32;
  return 1 - smooth(ASH_R0, ASH_R1, d);
}
// Round CLEAR spots other than the fire. The rug and the tea table are shaped FOOTPRINTS instead.
const samePos = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
const PROPS = CLEAR.slice(1).filter(([x, z]) => !samePos([x, z], LAYOUT.rug.pos) && !samePos([x, z], LAYOUT.teaTable.pos));
// Footprints. footprintK (core) gives the height multiplier; the rug's own edge is used for the apron ramp.
const RUG_C = Math.cos(LAYOUT.rug.ry), RUG_S = Math.sin(LAYOUT.rug.ry);
function rugDist(x, z) {   // metres outside the rug cloth itself (<= 0 on it)
  const dx = x - LAYOUT.rug.pos[0], dz = z - LAYOUT.rug.pos[1];
  const lx = dx * RUG_C - dz * RUG_S, lz = dx * RUG_S + dz * RUG_C;
  return Math.max(Math.abs(lx) - LAYOUT.rug.w / 2, Math.abs(lz) - LAYOUT.rug.d / 2);
}
// Pressed / grazed blade height (art px). Inside a footprint the blade is multiplied by k, but grazed ground
// (k 0.15-0.35) keeps a short 2-4 px turf; round the rug the grass rises with distance from the cloth (~10 px/m,
// out to 0.9 m) so no tip lies across it from any side.
function pressH(hpx, fk, rugD, r) {
  let h = fk < 0.999 ? Math.min(hpx, Math.max(hpx * fk, 2 + 2 * r)) : hpx;
  if (rugD < 0.9) h = Math.min(h, 0.6 + 10 * Math.max(0, rugD));
  return h;
}
function clearF(x, z) {
  let k = 0;
  const n = (vnoise2(x * 5.0 + 2.0, z * 5.0 - 3.0) - 0.5) * 0.22;
  for (const [cx, cz, r] of PROPS) {
    const d = Math.hypot(x - cx, z - cz) + n;
    k = Math.max(k, 1 - smooth(r * 0.62, r * 1.02, d));
  }
  return k;
}
// faint footpaths: ring -> mani stones, ring -> woodpile, ring -> tent door
function segFrom(target, rTarget) {
  const [tx, tz] = target; const L = Math.hypot(tx, tz); const ux = tx / L, uz = tz / L;
  return [ux * (RING_R + 0.25), uz * (RING_R + 0.25), tx - ux * rTarget, tz - uz * rTarget];
}
const PATHS = [
  segFrom(LAYOUT.mani.pos, 0.5),
  segFrom(LAYOUT.woodpile.pos, 0.55),
  segFrom(LAYOUT.tent.pos, 1.6),
];
function segDist(x, z, s) {
  const [ax, az, bx, bz] = s; const dx = bx - ax, dz = bz - az;
  const k = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
  return Math.hypot(x - ax - dx * k, z - az - dz * k);
}
function pathF(x, z) {
  let k = 0;
  const n = (vnoise2(x * 4.0 - 9.0, z * 4.0 + 4.0) - 0.5) * 0.12;
  for (const s of PATHS) k = Math.max(k, 1 - smooth(0.07, 0.19, segDist(x, z, s) + n));
  return k;
}

// GLSL twins of the zone functions (need GLSL.common).
const GLSL_ZONES = /* glsl */`
  float zRing(vec2 p) {
    float d = abs(length(p) - ${f(RING_R)}) + (gFbm2(p * 1.6 + vec2(3.1, -7.2)) - 0.5) * 0.34
            + (gNoise2(p * 7.0) - 0.5) * 0.12;
    return 1.0 - smoothstep(${f(RING_W * 0.30)}, ${f(RING_W * 0.56)}, d);
  }
  float zFire(vec2 p) {
    float d = length(p) + (gFbm2(p * 2.3 + vec2(5.0, 1.0)) - 0.5) * 0.32;
    return 1.0 - smoothstep(${f(ASH_R0)}, ${f(ASH_R1)}, d);
  }
  // twin of core footprintK: 1 untouched .. 0 no grass
  float zFoot(vec2 p) {
    float k = 1.0, e, w; vec2 d, l;
    ${FOOTPRINTS.map((fp) => {
      const c = Math.cos(fp.ry ?? 0), s = Math.sin(fp.ry ?? 0);
      const dist = fp.shape === 'rect'
        ? `e = max(abs(l.x) - ${f(fp.hx)}, abs(l.y) - ${f(fp.hz)});`
        : `e = (length(vec2((l.x - ${f(fp.cx ?? 0)}) / ${f(fp.hx)}, l.y / ${f(fp.hz)})) - 1.0) * ${f(Math.min(fp.hx, fp.hz))};`;
      return `d = p - vec2(${f(fp.pos[0])}, ${f(fp.pos[1])}); l = vec2(d.x * ${f(c)} - d.y * ${f(s)}, d.x * ${f(s)} + d.y * ${f(c)});
    ${dist} w = 1.0 - smoothstep(0.0, ${f(fp.soft)}, e); k = min(k, 1.0 - ${f(1 - fp.k)} * w);`;
    }).join('\n    ')}
    return k;
  }
  float zClear(vec2 p) {
    float k = 0.0;
    float n = (gNoise2(p * 5.0 + vec2(2.0, -3.0)) - 0.5) * 0.22;
    ${PROPS.map(([cx, cz, r]) => `k = max(k, 1.0 - smoothstep(${f(r * 0.62)}, ${f(r * 1.02)}, length(p - vec2(${f(cx)}, ${f(cz)})) + n));`).join('\n    ')}
    return k;
  }
  float zSeg(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a; float k = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    return length(p - a - ab * k);
  }
  float zPath(vec2 p) {
    float n = (gNoise2(p * 4.0 + vec2(-9.0, 4.0)) - 0.5) * 0.12;
    float k = 0.0;
    ${PATHS.map(([ax, az, bx, bz]) => `k = max(k, 1.0 - smoothstep(0.07, 0.19, zSeg(p, vec2(${f(ax)}, ${f(az)}), vec2(${f(bx)}, ${f(bz)})) + n));`).join('\n    ')}
    return k;
  }
`;

// Billboard + sway shared by blades and flower stalks. Needs GLSL.wind; widths use uArtPx (GLSL.common), the art
// pixel at zoom 1, so blades are one art px wide by default and keep their world width in ?zoom= close-ups.
const GLSL_BLADE = /* glsl */`
  vec3 gCamRight() { return normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0])); }
  float gSway(vec3 base, float phase) {
    float g = gWind(base.xz);
    float gust = 0.6 + 0.4 * sin(cycP(4.0) - base.x * 0.35 + base.z * 0.2);
    // gust field + a coherent travelling ripple + a little per-blade flutter
    float s = 0.95 * g * gust + 0.22 * sin(cycP(13.0) - base.x * 2.1 + base.z * 1.3) + 0.08 * sin(cycP(19.0) + phase * 6.2831);
    return clamp(s, -1.5, 1.5);
  }
`;

// ---- ground plane ------------------------------------------------------------------
function buildGround() {
  const geo = new THREE.PlaneGeometry(16.5, 14.5, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = mat(C.soil, {
    grain: 0,
    fragment: {
      head: GLSL.patch + GLSL_ZONES,
      body: /* glsl */`
        {
          vec2 p = vGWorld.xz;
          float pm = gPatchMask(p);
          if (pm < gBayer4(gl_FragCoord.xy)) discard;
          vec2 cell = floor(p * 27.0);                // ~one art pixel
          float h1 = gHash12(cell), h2 = gHash12(cell + 17.3);
          float nB = gFbm2(p * 0.9 + 4.0);
          vec3 col = mix(${v3(C.soilDeep)}, ${v3(C.soil)}, smoothstep(0.3, 0.7, nB));
          col *= 0.85 + 0.3 * h1;
          // rim band: dots of mid grass rather than soil
          float rimK = 1.0 - smoothstep(0.15, 0.8, pm);
          col = mix(col, mix(${v3(C.rimTurf)}, ${v3(C.rimPale)}, rimK * h2) * (0.85 + 0.3 * h1), rimK * 0.9);
          // worn footprints under props: short turf with bits of earth
          float cl = zClear(p);
          vec3 turf = ${v3(C.turf)} * (0.85 + 0.3 * h1);
          turf = mix(turf, ${v3(C.earthDark)}, step(0.9, h2) * 0.6);
          col = mix(col, turf, cl);
          // pressed / grazed footprints: cropped turf, darker right at the rug's edge
          float fk = zFoot(p);
          col = mix(col, mix(${v3(C.soilDeep)}, turf, 0.5 + 0.5 * smoothstep(0.0, 0.3, fk)), 1.0 - smoothstep(0.4, 0.95, fk));
          // faint footpaths
          float pa = zPath(p);
          col = mix(col, mix(${v3(C.earthDark)}, ${v3(C.turf)}, step(0.5, h1)), pa * 0.8);
          // trampled dance ring: packed earth, scuffs, pale dust, specks of worn grass
          float rg = zRing(p);
          float nE = gFbm2(p * 3.1 + 9.0);
          vec3 earth = mix(${v3(C.earthDark)}, ${v3(C.earth)}, smoothstep(0.3, 0.6, nE));
          earth = mix(earth, ${v3(C.earthLight)}, step(0.88, h1) * 0.9);
          earth = mix(earth, ${v3(C.earthDark)} * 0.8, step(0.93, h2));
          earth *= 0.95 + 0.1 * h2;
          col = mix(col, earth, smoothstep(0.1, 0.65, rg));
          // fire: ash disc, then a band of trodden ash and packed earth outside the pit stones
          float fr = zFire(p);
          float d = length(p);
          vec3 ash = mix(${v3(C.ashDark)}, ${v3(C.ash)}, smoothstep(0.25, 0.7, gFbm2(p * 4.5 + 2.0)) * (1.0 - smoothstep(0.35, 0.8, d)));
          ash = mix(ash, ${v3(C.dust)}, smoothstep(0.7, 0.95, d) * (0.55 + 0.45 * h1));
          ash = mix(ash, ${v3(C.char)}, step(0.84, h1) * (1.0 - smoothstep(0.55, 1.05, d)));
          vec3 trod = mix(earth, ${v3(C.dust)}, step(0.82, h2) * 0.7);
          vec3 bare = mix(ash, trod, smoothstep(0.92, 1.18, d + (h2 - 0.5) * 0.16));
          col = mix(col, bare, smoothstep(0.0, 0.45, fr));
          diffuseColor.rgb = col * ${f(EXPO)};
        }
      `,
    },
  });
  const ground = new THREE.Mesh(geo, m);
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.name = 'ground';
  return ground;
}

// ---- grass blades ------------------------------------------------------------------
// Two layers in one InstancedMesh:
//   canopy (sparse enough that each blade shows as a long 1-px vertical streak): class 0 body, 1 tall/light, 2 worn
//   undergrowth (dense, 1-3 px, dark): class 3 — fills the gaps with dark texture and gives the short turf under props
const STEP_C = 0.074;
const STEP_U = 0.045;
function zonesAt(px, pz, stones) {
  const ring = ringF(px, pz), fire = fireF(px, pz), clr = clearF(px, pz), path = pathF(px, pz);
  // surviving tufts in the ring, mostly toward its ragged edges
  const tuft = smooth(0.7, 0.84, vnoise2(px * 3.4 + 40, pz * 3.4 - 13)) * (1 - smooth(0.75, 1.0, ring));
  const ringK = ring * (1 - tuft * 0.75);
  // stones: the grass thins a little round them, but they stay sunk in it
  let st = 0;
  for (const [sx, sz, sr] of stones) { const d = Math.hypot(px - sx, pz - sz); if (d < sr * 3.0) st = Math.max(st, 1 - smooth(sr * 0.85, sr * 3.0, d)); }
  return { ring, ringK, fire, clr, path, st, worn: Math.max(ringK, path * 0.8) };
}
const FRINGE_MAX = 1.035;   // nothing grows past this patch radius (≈ 8 art px beyond the dither band)
function placeBlades(stones) {
  const out = { pos: [], b0: [], b1: [] };
  const push = (x, z, hpx, val, kind, lean, phase, nx, nz, cls) => {
    out.pos.push(x, z); out.b0.push(hpx * PXV, val, kind, lean); out.b1.push(phase, nx, nz, cls);
  };
  const X0 = -7.9, X1 = 7.9, Z0 = -6.9, Z1 = 6.9;
  for (const layer of ['under', 'canopy']) {
    const R = rng(layer === 'under' ? 1717 : 20240817);
    const S = layer === 'under' ? STEP_U : STEP_C;
    for (let z = Z0; z < Z1; z += S) {
      for (let x = X0; x < X1; x += S) {
        const px = x + (R() - 0.5) * S * 1.2, pz = z + (R() - 0.5) * S * 1.2;
        const r0 = R(), r1 = R(), r2 = R(), r3 = R(), r4 = R();
        const pr = patchRadius(px, pz);
        if (pr > FRINGE_MAX) continue;
        // pressed grass (rug, apron, tea table, yak, dog): nothing under the rug cloth
        const fk = footprintK(px, pz);
        if (fk < 0.05) continue;
        const rugD = rugDist(px, pz);
        const pm = 1 - smooth(1 - PATCH.edge, 1, pr);
        // rejection: mask plus clumpy noise -> ragged edge; isolated stems just past the rim (half as many
        // beyond pr 1.0, so the hairy fringe stays a fringe)
        const nE = vnoise2(px * 3.3 + 1.7, pz * 3.3 - 2.1);
        let p = smooth(0.08, 0.78, pm + (nE - 0.5) * 0.36 * (1 - pm));
        if (layer === 'canopy' && pr > 0.96) p = Math.max(p, 0.1 * (1 - smooth(0.96, 1.05, pr)) * (1 - 0.5 * smooth(0.99, 1.01, pr)));
        const Z = zonesAt(px, pz, stones);
        const rr = Math.hypot(px, pz);
        if (layer === 'under') {
          p *= 1 - Z.ringK * 0.8;
          p *= 1 - Z.fire * 0.97;
          p *= 1 - Z.path * 0.4;
          if (r0 >= p) continue;
          let hpx = 1.3 + r2 * 1.6 + r3 * 0.8;
          hpx *= 1 - Z.ringK * 0.5;
          hpx *= 1 - Z.fire * 0.5;
          hpx = clamp(hpx * (0.75 + 0.25 * pm), 0.8, 4);
          // under props the undergrowth is the visible short turf: a little taller and lighter there
          hpx += Z.clr * (0.8 + r4);
          hpx = pressH(hpx * LEG, fk, rugD, r4);
          const val = 1 + ((r2 + r3 + r4) / 3 - 0.5) * 0.6;
          const cen = 1 - smooth(1.8, 2.2, rr);
          const crop = Z.clr > 0.45 + (r1 - 0.5) * 0.3 || fk < 0.62 + (r1 - 0.5) * 0.3 || r3 < 0.45 * cen;
          const ucls = Z.worn > 0.4 ? 2 : (crop ? 4 : 3);
          push(px, pz, hpx, val, 0.9 * (1 - smooth(0.15, 0.75, pm)), (r3 - 0.5) * 0.6, r2, (r1 - 0.5) * 0.6, (r4 - 0.5) * 0.6, ucls);
          continue;
        }
        const fringe = smooth(0.9, 1.0, pr);
        p *= 1 - Z.ringK * 0.85;
        p *= 1 - Z.fire * 0.99;
        p *= 1 - Z.clr * 0.55;
        p *= 1 - Z.path * 0.45;
        p *= 1 - Z.st * 0.3;
        if (r0 >= p) continue;

        const cen = 1 - smooth(1.8, 2.2, rr);   // inner lawn: pit to the ring's inner edge
        const tallN = fbm2(px * 1.9 - 4.0, pz * 1.9 + 8.0);
        let cls = r1 < 0.2 + 0.24 * smooth(0.45, 0.7, tallN) ? 1 : 0;
        if (Z.worn > 0.4) cls = 2;
        if (fringe > 0.5 && cls === 1) cls = 0;
        if (cls === 1 && (fk < 0.7 || r3 < 0.7 * cen)) cls = 0;   // no long light streaks on grazed ground
        // height in (legacy) px: tussock noise + jitter, a few tall stems
        const hn = fbm2(px * 1.25 + 7.0, pz * 1.25 - 3.0);
        let hpx = cls === 1 ? 8.0 + 3.0 * hn + r2 * 2.5 : 4.4 + 4.6 * hn + (r2 - 0.5) * 3.0;
        if (cls === 1 && r3 > 0.93) hpx += 1.5 + r4 * 2.5;
        hpx *= 1 - Z.ringK * 0.85;
        hpx *= 1 - Z.fire * 0.75;
        hpx *= 1 - Z.clr * 0.6;
        hpx *= 1 - Z.path * 0.45;
        hpx *= 1 - Z.st * 0.52;
        hpx *= 0.7 + 0.3 * pm;                          // shorter toward the rim
        // keep the grass round the dance ring lower so boots read; the inner circle is half-trampled
        hpx *= 1 - 0.3 * (1 - smooth(0.45, 1.15, Math.abs(rr - RING_R)));
        if (rr < RING_R) hpx *= 0.72;
        hpx *= 0.35 + 0.65 * smooth(ASH_R0 + 0.1, 1.9, rr);   // short, scorched grass round the ash
        hpx = clamp(hpx, 0.8, 14.5) * LEG;               // -> art px
        // the inner lawn reads calm: short grazed blades of 3-6 art px (a touch shorter at the ash)
        if (cen > 0) {
          const hc = (3 + 3 * clamp((hpx - 1.8) / 4.2)) * (0.8 + 0.2 * smooth(ASH_R0, 1.7, rr));
          hpx = lerp(hpx, hc, cen);
        }
        hpx = pressH(hpx, fk, rugD, r4);

        // value jitter ±15 % (sum of three uniforms ~ gaussian), plus some shaded blades deep in the sward
        let val = 1 + ((r2 + r3 + r4) / 3 - 0.5) * 0.55;
        if (cls === 0 && r0 < p * 0.18 * (1 - 0.7 * cen)) val *= 0.62;
        // tip kind: 0 olive, 1 pale, 2 dry straw
        const dryN = fbm2(px * 0.7 - 11, pz * 0.7 + 5);
        let kind = r4 < 0.66 ? 0 : 1;
        if (r3 < 0.05 + 0.22 * smooth(0.55, 0.75, dryN) + 0.45 * Z.fire + 0.12 * cen) kind = 2;
        // kind carries the rim factor in its fraction (0 inside .. 0.9 at the outer rim)
        push(px, pz, hpx, val, kind + 0.9 * (1 - smooth(0.15, 0.75, pm)), (r3 - 0.5) * 1.2, r2, (r1 - 0.5) * 0.7, (r4 - 0.5) * 0.7, cls);
      }
    }
  }
  return out;
}

function instancedQuad(attrs, count, positions) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const n = positions.length / 3;
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(n).fill([0, 1, 0]).flat(), 3));
  const idx = [];
  for (let q = 0; q < n / 4; q++) { const o = q * 4; idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
  geo.setIndex(idx);
  for (const [k, [arr, size]] of Object.entries(attrs)) geo.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(arr), size));
  geo.instanceCount = count;
  return geo;
}
function fillTranslations(mesh, pos, ys) {
  const arr = mesh.instanceMatrix.array, N = mesh.count;
  for (let i = 0; i < N; i++) {
    const o = i * 16;
    arr[o] = 1; arr[o + 5] = 1; arr[o + 10] = 1; arr[o + 15] = 1;
    arr[o + 12] = pos[i * 2]; arr[o + 13] = ys ? ys[i] : 0; arr[o + 14] = pos[i * 2 + 1];
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function buildGrass(stones) {
  const P = placeBlades(stones);
  const N = P.pos.length / 2;
  // one quad: x in [-0.5, 0.5] art px, y in [0, 1] of blade height; wound to face the camera
  const geo = instancedQuad({ aB0: [P.b0, 4], aB1: [P.b1, 4] }, N, [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]);
  const m = mat(C.bMid, {
    grain: 0, flat: false,
    vertex: {
      head: /* glsl */`
        ${GLSL.wind}
        attribute vec4 aB0;   // height (m), value, tip kind, lean (px)
        attribute vec4 aB1;   // phase, normal tilt x, normal tilt z, class
        varying float vY;
        varying float vHpx;
        varying float vCen;
        varying vec4 vB;
        ${GLSL_BLADE}
      `,
      body: /* glsl */`
        {
          vec3 base = instanceMatrix[3].xyz;
          float y = position.y, h = aB0.x;
          float tip = y * y;
          float sway = gSway(base, aB1.x) * smoothstep(0.06, 0.22, h);
          transformed = gCamRight() * (position.x * uArtPx + aB0.w * uArtPx * tip)
                      + G_WIND_DIR * (sway * uArtPx * tip) + vec3(0.0, y * h, 0.0);
          vY = y;
          vHpx = h / ${f(PXV)};
          vCen = 1.0 - smoothstep(1.8, 2.2, length(base.xz));   // calm inner lawn
          vB = vec4(aB0.y, aB0.z, aB1.w, aB1.x);
          vNormal = normalize(normalMatrix * normalize(vec3(aB1.y, 1.0, aB1.z)));
        }
      `,
    },
    fragment: {
      head: /* glsl */`
        varying float vY;
        varying float vHpx;
        varying float vCen;
        varying vec4 vB;
      `,
      body: /* glsl */`
        {
          float y = clamp(vY, 0.0, 1.0);
          float kind = floor(vB.y + 0.001), cls = vB.z;
          float rim = fract(vB.y + 0.001) / 0.9;      // 1 at the outer rim
          vec3 tip = kind < 0.5 ? ${v3(C.tipA)} : kind < 1.5 ? ${v3(C.tipB)} : ${v3(C.tipDry)};
          tip = mix(tip, ${v3(C.tipDry)}, 0.3 * vCen);   // the inner lawn is a little drier
          // fragments low in absolute height sit in the dark undergrowth
          float under = 1.0 - smoothstep(0.0, min(2.5, 0.45 * vHpx), y * vHpx);
          vec3 c;
          if (cls < 0.5) {          // body blade: dark foot, mid green, faint light tip
            c = mix(${v3(C.bBase)}, ${v3(C.bMid)}, smoothstep(0.0, 0.5, y));
            c = mix(c, ${v3(C.bMid2)}, smoothstep(0.55, 0.95, y));
            c = mix(c, tip, smoothstep(0.85 - 0.2 * vCen, 1.0, y) * (0.3 + 0.2 * vCen));
          } else if (cls < 1.5) {   // tall blade: the light streaks
            c = mix(${v3(C.bBase)}, ${v3(C.bMid2)}, smoothstep(0.0, 0.45, y));
            c = mix(c, tip, smoothstep(0.45, 0.9, y));
          } else if (cls < 2.5) {   // worn: short, yellowed
            c = mix(${v3(C.wornBase)}, ${v3(C.tipWorn)}, smoothstep(0.0, 1.0, y));
            under *= 0.4;
          } else if (cls < 3.5) {   // undergrowth: dark, a touch lighter at the top
            c = mix(${v3(C.bBase)}, ${v3(C.under)}, smoothstep(0.0, 1.0, y));
            under = 0.0;
          } else {                  // cropped turf under props: short but lit
            c = mix(${v3(C.under)}, ${v3(C.bMid2)}, smoothstep(0.2, 1.0, y));
            c = mix(c, tip, step(0.99, y) * 0.25);
            under = 0.0;
          }
          // near the rim nothing stands in front of the blade feet: lift them so the edge has no dark outline
          // and the whole blade pales a little toward the rim, like the reference's edge
          c = mix(c, ${v3(C.bMid)} * 0.9, rim * 0.6 * (1.0 - smoothstep(0.0, 0.6, y)));
          c *= mix(1.0, 0.55, under * (1.0 - 0.75 * rim) * (1.0 - 0.3 * vCen));
          c = mix(c, ${v3(C.rimPale)}, rim * rim * 0.45);
          c *= vB.x;
          diffuseColor.rgb = c * ${f(EXPO)};
        }
      `,
    },
  });
  const mesh = new THREE.InstancedMesh(geo, m, N);
  fillTranslations(mesh, P.pos);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'grass';
  return mesh;
}

// ---- wildflowers -------------------------------------------------------------------
const FLOWERS = [
  // [sRGB colour, weight, head w px, head h px, stalk px min, max]
  [0xe2c24a, 0.30, 1, 1, 4, 8],    // potentilla / buttercup yellow
  [0xd9b23c, 0.14, 2, 1, 5, 8],    // yellow, wider head
  [0x3e5fb0, 0.22, 1, 2, 2, 5],    // gentian: low, deep blue trumpets
  [0x5a78c4, 0.08, 1, 1, 3, 6],    // paler gentian
  [0xe8e4d6, 0.16, 2, 1, 4, 7],    // edelweiss: woolly white star
  [0xb87a9e, 0.10, 1, 1, 4, 8],    // pink lousewort / primula
];
// Palette restraint: ~300 heads, gathered in a few drifts toward the rim by a low-frequency mask, a sparse
// scatter elsewhere, half as many again on the calm inner lawn, none on pressed ground.
function buildFlowers() {
  const R = rng(777);
  const pos = [], a0 = [], a1 = [];
  const wsum = FLOWERS.reduce((s, fl) => s + fl[1], 0);
  let tries = 0;
  while (pos.length / 2 < 300 && tries++ < 80000) {
    const x = (R() * 2 - 1) * 6.8, z = (R() * 2 - 1) * 5.8;
    const pr = patchRadius(x, z);
    const pm = 1 - smooth(1 - PATCH.edge, 1, pr);
    if (pm < 0.6) continue;
    if (ringF(x, z) > 0.08 || fireF(x, z) > 0.01 || clearF(x, z) > 0.2 || pathF(x, z) > 0.3) continue;
    if (footprintK(x, z) < 0.6) continue;
    const rr = Math.hypot(x, z);
    // drifts: a low-frequency mask, biased toward the rim
    const dn = fbm2(x * 0.42 + 21, z * 0.42 - 6, 3);
    const rimB = 0.25 + 0.75 * smooth(0.45, 0.82, pr);
    if (R() > smooth(0.5, 0.66, dn) * rimB + 0.025) continue;
    if (rr < 2.0 && R() < 0.5) continue;
    let w = R() * wsum, ti = 0;
    while (w > FLOWERS[ti][1]) { w -= FLOWERS[ti][1]; ti++; }
    // species clump: let the low-frequency noise bias the species too
    if (R() < 0.5) ti = Math.floor(vnoise2(x * 0.6 + 3, z * 0.6 + 9) * FLOWERS.length * 0.999);
    const [hex, , hw, hh, s0, s1] = FLOWERS[ti];
    const c = lin(hex);
    const k = 0.92 + R() * 0.16;
    const stalk = (s0 + R() * (s1 - s0)) * LEG * PXV * (rr < RING_R + 0.6 ? 0.75 : 1);
    pos.push(x, z);
    a0.push(stalk, hw, hh, (R() - 0.5) * 1.0);
    a1.push(c.r * k, c.g * k, c.b * k, R());
  }
  const N = pos.length / 2;
  // stalk quad (z = 0) + head quad (z = 1); head x in head-px units, y in head-px rows above the stalk top
  const geo = instancedQuad({ aF0: [a0, 4], aF1: [a1, 4] }, N, [
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    -0.5, 0, 1, 0.5, 0, 1, 0.5, 1, 1, -0.5, 1, 1,
  ]);
  const m = mat(C.stalk, {
    grain: 0, flat: false,
    vertex: {
      head: /* glsl */`
        ${GLSL.wind}
        attribute vec4 aF0;   // stalk height (m), head w px, head h px, lean px
        attribute vec4 aF1;   // head colour (linear), phase
        varying float vPart;
        varying float vFy;
        varying vec3 vHead;
        ${GLSL_BLADE}
      `,
      body: /* glsl */`
        {
          vec3 base = instanceMatrix[3].xyz;
          float head = position.z;
          float y = head > 0.5 ? 1.0 : position.y;
          float tip = y * y;
          float sway = gSway(base, aF1.w);
          vec3 off = gCamRight() * (aF0.w * uArtPx * tip) + G_WIND_DIR * (sway * uArtPx * tip);
          if (head > 0.5) {
            // head sits on top of the stalk, a whole number of art px
            off += gCamRight() * (position.x * aF0.y * uArtPx)
                 + vec3(0.0, aF0.x + position.y * aF0.z * uArtPx / ${f(Math.cos(EL))}, 0.0);
          } else {
            off += gCamRight() * (position.x * uArtPx) + vec3(0.0, y * aF0.x, 0.0);
          }
          transformed = off;
          vPart = head;
          vFy = y;
          vHead = aF1.rgb;
          vNormal = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
        }
      `,
    },
    fragment: {
      head: /* glsl */`
        varying float vPart;
        varying float vFy;
        varying vec3 vHead;
      `,
      body: /* glsl */`
        {
          vec3 stalk = mix(${v3(C.bBase)}, ${v3(C.stalk)}, smoothstep(0.0, 0.6, vFy));
          diffuseColor.rgb = (vPart > 0.5 ? vHead : stalk) * ${f(EXPO)};
        }
      `,
    },
  });
  const mesh = new THREE.InstancedMesh(geo, m, N);
  fillTranslations(mesh, pos);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'flowers';
  return mesh;
}

// ---- stones ------------------------------------------------------------------------
// [x, z, size] — placed before the grass so blades thin a little round them. Kept off footprints and the
// front centre (they caught the eye there), favouring the flanks.
function placeStones() {
  const R = rng(4242);
  const list = [];
  let tries = 0;
  // screen depth (toward the camera) and screen-across at the default azimuth: the order is
  // 0.707(x+z) > 2.5 && |0.707(x-z)| < 2; kept with a margin
  const front = (x, z) => 0.707 * (x + z) > 2.2 && Math.abs(0.707 * (x - z)) < 2.5;
  const ok = (x, z, pad) => !inFootprint(x, z, pad) && !isClear(x, z, pad) && !front(x, z);
  while (list.length < 16 && tries++ < 8000) {
    const x = (R() * 2 - 1) * 6.6, z = (R() * 2 - 1) * 5.6;
    const pm = 1 - smooth(1 - PATCH.edge, 1, patchRadius(x, z));
    if (pm < 0.7) continue;
    const big = R() < 0.4;
    const s = big ? 0.21 + R() * 0.11 : 0.12 + R() * 0.07;
    if (ringF(x, z) > 0.05 || Math.hypot(x, z) < 3.4 || !ok(x, z, 0.5 + s) || pathF(x, z) > 0.05) continue;
    if (R() > 0.3 + 0.7 * smooth(1.2, 3.8, Math.abs(0.707 * (x - z)))) continue;   // favour the flanks
    if (list.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 1.1)) continue;
    list.push([x, z, s]);
    if (R() < 0.5) {
      const a = R() * 6.283, px = x + Math.cos(a) * s * 1.9, pz = z + Math.sin(a) * s * 1.9, ps = 0.05 + R() * 0.04;
      if (ok(px, pz, 0.3)) list.push([px, pz, ps]);
    }
  }
  return list;
}
function buildStones(list) {
  const R = rng(99);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  // Flat faces: cool grey on top, blue-grey sides (world normal from screen derivatives). Instance colours are
  // a near-white tone jitter that multiplies this.
  const m = mat(0xffffff, {
    grain: 0.1, grainScale: 30,
    fragment: {
      head: '',
      body: /* glsl */`
        {
          vec3 nW = normalize(cross(dFdx(vGWorld), dFdy(vGWorld)));
          diffuseColor.rgb *= mix(${v3(C.stoneSide)}, ${v3(C.stoneTop)}, smoothstep(0.5, 0.85, abs(nW.y)));
        }`,
    },
  });
  const mesh = new THREE.InstancedMesh(geo, m, list.length);
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  const TONES = [0xfff8ee, 0xf2f2f2, 0xf4f8ff];   // faintly warm, neutral, faintly cool
  list.forEach(([x, z, s], i) => {
    const sy = s * (0.55 + R() * 0.25);
    o.position.set(x, sy * 0.18, z);               // a little deeper than before: blade tips overlap the top
    o.rotation.set((R() - 0.5) * 0.5, R() * Math.PI * 2, (R() - 0.5) * 0.5);
    o.scale.set(s * (0.95 + R() * 0.4), sy, s * (0.85 + R() * 0.3));
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    const g = 0.9 + R() * 0.16;
    const r = R();
    col.setHex(TONES[r < 0.3 ? 0 : r < 0.6 ? 1 : 2]).multiplyScalar(g);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'stones';
  return mesh;
}

export function build(ctx) {
  const group = new THREE.Group();
  group.name = 'ground';
  const stones = placeStones();
  group.add(buildGround());
  group.add(buildGrass(stones));
  group.add(buildFlowers());
  group.add(buildStones(stones));
  // Ground applies FOOTPRINTS to its own blades and flowers; nobody else touches the grass instances.
  if (ctx?.shared) ctx.shared.groundPressesGrass = true;
  // Everything moves in the shaders (uTime, uArtPx from core), so there is nothing to update per frame.
  return { group, update() {} };
}
