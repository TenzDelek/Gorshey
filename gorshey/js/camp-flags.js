// Prayer flags: a tall darchog pole with one long printed flag and a gilded finial, and lungta strings
// running from the pole top to the tent's ridge-pole tip and to two ground stakes. Strings are 1-art-px
// camera-facing ribbons; flags are small squares repeating blue, white, red, green, yellow along
// every string, fluttering in the vertex shader (gWind + per-flag phase, wind (1, 0, -0.55)).
import * as THREE from 'three';
import { mat, GLSL, LAYOUT, rng, patchMask } from './core.js';
import { CP, M, WIND_DIR, glc, insidePatch, jitter } from './camp-lib.js';

// cloth vertex format: aF = (kind, hang 0..1, phase, sag weight | ribbon side), aT = flutter normal | tangent, aUV
// kinds: 0 string ribbon, 1 lungta flag, 2 darchog flag, 3 khata
export function ribbon(acc, pts, color, sag) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const sa = sag[i] ?? 0, sb = sag[i + 1] ?? sa;
    const A = (side, s) => ({ aF: [0, s, 0, side], aT: [t.x, t.y, t.z] });
    acc.quad(a, b, b, a, color, [A(-0.5, sa), A(-0.5, sb), A(0.5, sb), A(0.5, sa)]);
  }
}

// one hanging cloth panel: top edge a->b, hanging along `hang` (unit) by height h, subdivided nu x nv
function hangPanel(acc, a, b, hang, h, color, kind, phase, sagA, sagB, nu = 2, nv = 2, colorFn = null) {
  const n = new THREE.Vector3().subVectors(b, a).cross(hang).normalize();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const c = [[i / nu, j / nv], [(i + 1) / nu, j / nv], [(i + 1) / nu, (j + 1) / nv], [i / nu, (j + 1) / nv]];
    const P = c.map(([s, t]) => new THREE.Vector3().lerpVectors(a, b, s).addScaledVector(hang, h * t));
    const at = c.map(([s, t]) => ({ aF: [kind, t, phase, sagA + (sagB - sagA) * s], aT: [n.x, n.y, n.z], aUV: [s, t] }));
    const col = colorFn ? c.map(([s, t]) => colorFn(s, t)) : color;
    acc.quad(P[0], P[1], P[2], P[3], col, at);
  }
}

// a vertical flag fixed along one edge (the pole), extending along `out`; hang weight grows with distance from the pole
function poleFlag(acc, base, out, w, h, color, kind, phase, nu = 5, nv = 10) {
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3().crossVectors(out, up).normalize();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const c = [[i / nu, j / nv], [(i + 1) / nu, j / nv], [(i + 1) / nu, (j + 1) / nv], [i / nu, (j + 1) / nv]];
    // free edge droops a little and the cloth narrows slightly toward the tail
    const P = c.map(([s, t]) => base.clone().addScaledVector(out, w * s).addScaledVector(up, h * t - 0.1 * s * s + 0.04 * s * (t - 0.5)));
    const at = c.map(([s, t]) => ({ aF: [kind, s, phase + t * 0.15, 0], aT: [n.x, n.y, n.z], aUV: [s, t] }));
    acc.quad(P[0], P[1], P[2], P[3], color, at);
  }
}

export function clothMaterial(uPx) {
  const m = mat(0xffffff, {
    vertexColors: true, grain: 0.04, grainScale: 30, side: THREE.DoubleSide,
    uniforms: { uPx },
    vertex: {
      head: GLSL.wind + /* glsl */`
        uniform float uPx;
        attribute vec4 aF; attribute vec3 aT; attribute vec2 aUV;
        varying vec4 vF; varying vec2 vUV;
      `,
      body: /* glsl */`
        {
          vF = aF; vUV = aUV;
          vec3 wd = normalize(vec3(1.0, 0.0, -0.55));
          float g = gWind(transformed.xz);
          if (aF.x < 0.5) {
            // 1-art-px ribbon: offset across the line in screen space
            vec3 back = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
            vec3 perp = cross(aT, back);
            float pl = length(perp);
            perp = pl > 1e-4 ? perp / pl : vec3(0.0, 1.0, 0.0);
            transformed += perp * aF.w * uPx;
            transformed += (wd * 0.8 + vec3(0.0, 0.25, 0.0)) * (aF.y * 0.035 * g);
          } else {
            float h = aF.y, ph = aF.z * 6.2831853;
            float sag = aF.x < 1.5 ? aF.w : 0.0;
            transformed += (wd * 0.8 + vec3(0.0, 0.25, 0.0)) * (sag * 0.035 * g);
            float gust = 0.55 + 0.45 * g;
            float amp = aF.x < 1.5 ? 0.05 : (aF.x < 2.5 ? 0.07 : 0.06);
            float k = aF.x < 1.5 ? 2.4 : 3.6;
            float fl = 0.65 * sin(cycP(29.0) + ph - h * k) + 0.35 * sin(cycP(47.0) + ph * 1.7 - h * k * 1.6);
            transformed += aT * (h * amp * fl * (0.6 + 0.4 * gust));
            transformed += wd * (h * 0.025 * g);
          }
        }
      `,
    },
    fragment: {
      head: /* glsl */`varying vec4 vF; varying vec2 vUV;`,
      body: /* glsl */`
        {
          float kind = floor(vF.x + 0.5);
          vec2 uv = vUV;
          float mk = 0.0;
          if (kind == 1.0) {
            // block print: wind-horse in the middle, a line of text above and below
            mk = step(abs(uv.x - 0.5), 0.2) * step(abs(uv.y - 0.52), 0.17);
            mk = max(mk, step(abs(uv.y - 0.14), 0.05) * step(0.5, fract(uv.x * 3.0 + 0.2)) * step(abs(uv.x - 0.5), 0.36));
            mk = max(mk, step(abs(uv.y - 0.86), 0.05) * step(0.5, fract(uv.x * 3.0 + 0.6)) * step(abs(uv.x - 0.5), 0.36));
            diffuseColor.rgb *= 1.0 - 0.42 * mk;
          } else if (kind == 2.0) {
            // long darchog: rows of printed text inside a margin, a framed panel in the middle
            float inX = step(0.1, uv.x) * step(uv.x, 0.9);
            float row = step(fract(uv.y * 15.0), 0.3) * inX * step(0.05, uv.y) * step(uv.y, 0.95);
            float gap = step(0.35, fract(uv.x * 3.0 + floor(uv.y * 15.0) * 0.37));
            mk = row * gap;
            float panel = step(abs(uv.x - 0.5), 0.24) * step(abs(uv.y - 0.55), 0.075);
            mk = max(mk * (1.0 - step(abs(uv.x - 0.5), 0.3) * step(abs(uv.y - 0.55), 0.1)), panel * 0.8);
            diffuseColor.rgb *= 1.0 - 0.3 * mk;
          }
          // sunlit cloth glows a little through (the sun is behind the scene)
          if (kind > 0.5) totalEmissiveRadiance += diffuseColor.rgb * 0.42 * (1.0 - uNight);
        }
      `,
    },
  });
  return m;
}

// ---- prayer flag pole + strings -------------------------------------------------------------
const POLE_H = 4.75;
export function buildFlags({ solids, cloth, tentTip, cairnTop }) {
  const R = rng(5150);
  const [px, pz] = LAYOUT.flagPole.pos;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // pole: a slightly tapered, crooked trunk
  {
    const g = new THREE.CylinderGeometry(0.042, 0.06, POLE_H, 6, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / POLE_H + 0.5;
      p.setX(i, p.getX(i) + 0.03 * Math.sin(y * 3.1 + 0.4));
      p.setZ(i, p.getZ(i) + 0.02 * Math.sin(y * 4.3));
    }
    solids.add(g, M(px, POLE_H / 2, pz), (i, q, n) => (n.x - n.z > 0.3 ? CP.pole : CP.poleDark), { aK: [3, 0, 0, 0] });
    // finial: gilded ball and spear point, a bundle of juniper below it
    solids.add(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6), M(px + 0.03 * Math.sin(3.5), POLE_H + 0.02, pz), CP.brass);
    solids.add(new THREE.SphereGeometry(0.065, 7, 5), M(px + 0.03 * Math.sin(3.5), POLE_H + 0.1, pz), CP.brass);
    solids.add(new THREE.ConeGeometry(0.045, 0.2, 5), M(px + 0.03 * Math.sin(3.5), POLE_H + 0.26, pz), CP.brass);
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3, r = 0.07;
      const g2 = jitter(new THREE.IcosahedronGeometry(0.075, 0), 0.03, k * 3.3, false);
      solids.add(g2, M(px + Math.cos(a) * r + 0.03 * Math.sin(3.4), POLE_H - 0.12 - k * 0.035, pz + Math.sin(a) * r, 0, a, 0, 1, 1.3, 1), k % 2 ? CP.juniper : CP.juniperLight);
    }
    // stone cairn round the foot, a few whitewashed / quartz stones
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + R() * 0.4, r = 0.17 + R() * 0.1;
      const s = 0.07 + R() * 0.06;
      const g3 = jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, k * 7.1, false);
      const col = k % 4 === 0 ? CP.quartz : R() < 0.5 ? CP.fieldStone : CP.fieldStone2;
      solids.add(g3, M(px + Math.cos(a) * r, s * 0.45 + (k > 7 ? 0.08 : 0), pz + Math.sin(a) * r, R(), R() * 3, R(), s * 1.2, s * 0.8, s), col, { aK: [0, 0, 0, 0] });
    }
  }

  // the long vertical flag (single colour, block-printed), flying downwind from the pole
  {
    const out = WIND_DIR.clone();
    const base = V(px + 0.03 * Math.sin(2.4) + out.x * 0.04, 2.55, pz + out.z * 0.04);
    poleFlag(cloth, base, out, 0.56, 1.85, CP.darchog, 2, 0.13);
    // ties binding the flag to the pole
    for (let k = 0; k <= 4; k++) solids.add(new THREE.CylinderGeometry(0.058, 0.058, 0.03, 6), M(px + 0.03 * Math.sin(2.4 + k * 0.4), 2.58 + k * 0.45, pz), CP.edgeRed);
  }

  // lungta strings from the pole top
  const top = V(px + 0.03 * Math.sin(3.3), POLE_H - 0.26, pz);
  // anchor 0: the tent's ridge-pole tip. Anchor 2 lies beside the mani cairn, so that line is tied to the
  // cairn's stick, as lungta lines often are. Anchor 1 is a ground stake, nudged inside the patch and a little
  // to screen-left so its line does not run straight down the pole in the default view.
  const anchors = LAYOUT.flagAnchors.map(([x, z], i) => {
    if (i === 0 && tentTip) return tentTip.clone();
    if (cairnTop && Math.hypot(x - cairnTop.x, z - cairnTop.z) < 0.8) return cairnTop.clone().add(V(0, -0.06, 0));
    const [ax, az] = insidePatch(x - 0.42, z + 0.42, 0.66);
    return V(ax, 0.2, az);
  });
  anchors.forEach((E, si) => {
    const ground = E.y < 0.5;
    if (ground) {
      // wooden stake with a few stones piled on it
      solids.add(new THREE.BoxGeometry(0.05, 0.3, 0.05), M(E.x, 0.12, E.z, 0.15, 0.6, -0.2), CP.poleDark, { aK: [3, 0, 0, 0] });
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7 + si, r = 0.09 + 0.03 * k;
        const s = 0.06 + 0.02 * (k % 2);
        const g3 = jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, si * 9 + k, false);
        solids.add(g3, M(E.x + Math.cos(a) * r, s * 0.45, E.z + Math.sin(a) * r, k, k * 2, 0, s * 1.3, s * 0.8, s), k === 2 ? CP.quartz : CP.fieldStone, { aK: [0, 0, 0, 0] });
      }
    }
    const A = top.clone().add(V(0, -0.06 * si, 0));
    const len = A.distanceTo(E);
    const sag = ground ? 0.22 + 0.04 * len : 0.12 * len;
    const N = Math.max(12, Math.ceil(len / 0.08));
    const P = (s) => new THREE.Vector3().lerpVectors(A, E, s).add(V(0, -sag * 4 * s * (1 - s), 0));
    const pts = [], sw = [];
    for (let i = 0; i <= N; i++) { pts.push(P(i / N)); sw.push(4 * (i / N) * (1 - i / N)); }
    ribbon(cloth, pts, CP.rope, sw);

    // flags along the string at a fixed arc-length pitch, starting a little off the pole
    const arc = [0];
    for (let i = 1; i <= N; i++) arc.push(arc[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = arc[N];
    const at = (d) => { let i = 1; while (i < N && arc[i] < d) i++; const k = (d - arc[i - 1]) / (arc[i] - arc[i - 1]); return { p: new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], k), s: (i - 1 + k) / N }; };
    const FW = 0.22, PITCH = 0.265;
    let idx = 0;
    for (let d = 0.28; d + FW < total - 0.15; d += PITCH, idx++) {
      const a = at(d), b = at(d + FW);
      if (Math.min(a.p.y, b.p.y) < 0.9) break;     // flags never come near the ground
      const tng = new THREE.Vector3().subVectors(b.p, a.p).normalize();
      // hang straight down, lifted a little downwind about the string
      const nrm = new THREE.Vector3().crossVectors(tng, V(0, -1, 0)).normalize();
      const wperp = WIND_DIR.dot(nrm);
      const lift = 0.32 * wperp + (R() - 0.5) * 0.12;
      const hang = nrm.clone().multiplyScalar(Math.sin(lift)).setY(-Math.cos(lift)).normalize();
      const col = CP.lungta[idx % 5];
      const ph = R();
      hangPanel(cloth, a.p, b.p, hang, 0.22, col, 1, ph, 4 * a.s * (1 - a.s), 4 * b.s * (1 - b.s), 2, 2);
    }
  });
  return { top };
}

// khata: a white scarf tied to the top of a stick, hanging and lifting downwind
export function khata(cloth, top, len = 0.42) {
  const out = WIND_DIR.clone().multiplyScalar(0.35).add(new THREE.Vector3(0, -1, 0)).normalize();
  const side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).normalize();
  const a = top.clone().addScaledVector(side, -0.04), b = top.clone().addScaledVector(side, 0.04);
  hangPanel(cloth, a, b, out, len, CP.khata, 3, 0.4, 0, 0, 1, 5);
}
