// Motion probe for the dancers: steps the loop frame by frame and checks feet, hips, arms and sleeves.
// node tools/motion-probe.mjs [--q "only=base,dancers"] [--from 0] [--to 48] [--fps 30] [--dancer name]
//                             [--out shots/motion/probe] [--report-only]
// Loads index.html?static=1&debug=1&<q>, waits for the page to be ready, renders t = from, from + 1/fps, ... to
// with window.__renderAt(t), and reads window.gorshey.debug.dancers (or the legacy window.__dancers):
// an array of { spec: { name }, rig: { bones, mesh }, D } (bone names: BONE_NAMES in gorshey/js/dancers-rig.js).
// Checks per dancer (failures exit 1 unless --report-only):
//   1. hips Δy > 3 cm between frames (frames where both soles are > 1 cm up are skipped)
//   2. planted sole drift > 0.3 cm per frame (heel/toe point below 1 cm in both frames)
//   3. minimum sole y < -0.5 cm (sinking into the ground)
//   4. neighbour (i, i±1) arm / forearm / hand / sleeve segments closer than 4 cm (worst pairs + times)
//   5. own sleeve points inside the torso (elliptic torso of half-widths D.torsoW/2, D.torsoD/2 around
//      the hips-spine-chest-neck polyline)
//   6. head-y range per 6 s phrase (SEQ A B A C | A D A C), reported only
// Writes <out>.json and prints a table.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? '1' : arr[i + 1]]] : a), []));
const base = args.base ?? 'http://localhost:8787/gorshey/index.html';
const q = args.q ?? 'only=base,dancers';
const from = +(args.from ?? 0), to = +(args.to ?? 48), fps = +(args.fps ?? 30);
const out = args.out ?? 'shots/motion/probe';
const only = args.dancer ?? null;
const reportOnly = !!args['report-only'];

const TH = { hipsDy: 0.03, airborne: 0.01, planted: 0.01, drift: 0.003, soleMin: -0.005, neighbour: 0.04 };

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?static=1&debug=1&t=${from}${q ? '&' + q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.gorshey?.ready === true || window.__ready === true, null, { timeout: 90000 });

// ---- in-page sampler ------------------------------------------------------------------------
const setup = await page.evaluate(async () => {
  const THREE = await import('three');
  let SEQ = ['A', 'B', 'A', 'C', 'A', 'D', 'A', 'C'];
  try { SEQ = (await import('./js/dancers-dance.js')).SEQ ?? SEQ; } catch { /* keep the default */ }
  const list = window.gorshey?.debug?.dancers ?? window.__dancers;
  if (!Array.isArray(list) || !list.length) return { error: 'no dancers exposed (window.gorshey.debug.dancers / window.__dancers)' };
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const ARM = (S) => [['arm' + S, 'fore' + S, 'arm'], ['fore' + S, 'hand' + S, 'forearm'], ['hand' + S, 'slv' + S + '1', 'hand'], ['slv' + S + '1', 'slv' + S + '2', 'sleeve']];
  const SEGS = [...ARM('L').map((s) => [...s, 'L']), ...ARM('R').map((s) => [...s, 'R'])];
  const TORSO = ['hips', 'spine', 'chest', 'neck'];
  const info = list.map((d, i) => {
    const D = d.D ?? d.rig?.dims ?? {};
    const L = 0.24 * (D.child ? 0.85 : 1);
    const hx = D.hipX ?? 0.083;
    return {
      i, name: d.spec?.name ?? `dancer${i}`,
      torsoW: D.torsoW ?? 0.28, torsoD: D.torsoD ?? 0.19,
      // sole points in model (bind) space: heel and toe of each foot, on y = 0
      sole: { L: [[hx, 0, 0.055 - L / 2], [hx, 0, 0.055 + L / 2]], R: [[-hx, 0, 0.055 - L / 2], [-hx, 0, 0.055 + L / 2]] },
    };
  });
  window.__probe = {
    sample(t) {
      window.__renderAt(t);
      return list.map((d, i) => {
        const B = d.rig.bones, mesh = d.rig.mesh, sk = mesh.skeleton;
        const wp = (n) => { B[n].getWorldPosition(v); return [v.x, v.y, v.z]; };
        const soles = [];
        for (const S of ['L', 'R']) {
          const bone = B['foot' + S];
          const bi = sk.bones.indexOf(bone);
          bone.updateWorldMatrix(true, false);
          m.copy(bone.matrixWorld).multiply(sk.boneInverses[bi]).multiply(mesh.bindMatrix);
          for (const p of info[i].sole[S]) { v.set(p[0], p[1], p[2]).applyMatrix4(m); soles.push([v.x, v.y, v.z]); }
        }
        const torso = TORSO.map(wp);
        const torsoQ = TORSO.slice(0, 3).map((n) => { B[n].getWorldQuaternion(q); return [q.x, q.y, q.z, q.w]; });
        return {
          hipsY: torso[0][1], headY: wp('head')[1], soles,
          segs: SEGS.map(([a, b]) => [wp(a), wp(b)]),
          slv: ['slvL1', 'slvL2', 'slvR1', 'slvR2'].map(wp),
          torso, torsoQ,
        };
      });
    },
  };
  return { SEQ, info: info.map(({ i, name, torsoW, torsoD }) => ({ i, name, torsoW, torsoD })), segNames: SEGS.map((s) => `${s[2]}${s[3]}`) };
});
if (setup.error) { console.error(setup.error); await browser.close(); process.exit(2); }
const { SEQ, info, segNames } = setup;
const N = info.length;

// ---- geometry -----------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function segSegDist(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t;
  if (a < 1e-12 && e < 1e-12) return Math.sqrt(dot(r, r));
  if (a < 1e-12) { s = 0; t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e < 1e-12) { t = 0; s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  const d = sub(c1, c2);
  return Math.sqrt(dot(d, d));
}
// rotate v by the inverse of quaternion q = [x, y, z, w]
function invRot(v, [x, y, z, w]) {
  x = -x; y = -y; z = -z;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
// normalised elliptic distance of point p from the torso polyline (< 1 = inside)
function torsoE(p, s, d) {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = s.torso[k], b = s.torso[k + 1], ab = sub(b, a);
    const t = clamp01(dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab)));
    const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const o = invRot(sub(p, c), s.torsoQ[k]);
    const e = Math.hypot(o[0] / (d.torsoW / 2), o[2] / (d.torsoD / 2));
    if (e < best) best = e;
  }
  return best;
}

// ---- run ----------------------------------------------------------------------------------
const nF = Math.max(1, Math.round((to - from) * fps));
const R = info.map((d) => ({
  name: d.name, i: d.i,
  hipsDy: { max: 0, t: null, fails: 0 },
  drift: { max: 0, t: null, fails: 0, point: null },
  soleMin: { min: Infinity, t: null },
  neighbour: { min: Infinity, t: null, with: null, segs: null, fails: 0, worst: [] },
  sleeveInside: { minE: Infinity, t: null, point: null, fails: 0 },
  headY: {},
}));
const SOLE_NAMES = ['heelL', 'toeL', 'heelR', 'toeR'];
const SLV_NAMES = ['slvL1', 'slvL2', 'slvR1', 'slvR2'];
const pairWorst = new Map();   // "i-j" -> [{d, t, segs}]
let prev = null;
const t0 = Date.now();
for (let f = 0; f <= nF; f++) {
  const t = +(from + f / fps).toFixed(6);
  const S = await page.evaluate((tt) => window.__probe.sample(tt), t);
  for (let i = 0; i < N; i++) {
    const s = S[i], r = R[i], p = prev?.[i];
    const footUp = (k) => Math.min(s.soles[k][1], s.soles[k + 1][1]);
    const air = footUp(0) > TH.airborne && footUp(2) > TH.airborne;
    s.air = air;
    // 3. penetration
    for (let k = 0; k < 4; k++) if (s.soles[k][1] < r.soleMin.min) { r.soleMin.min = s.soles[k][1]; r.soleMin.t = t; r.soleMin.point = SOLE_NAMES[k]; }
    if (p) {
      // 1. hips
      if (!air && !p.air) {
        const dy = Math.abs(s.hipsY - p.hipsY);
        if (dy > r.hipsDy.max) { r.hipsDy.max = dy; r.hipsDy.t = t; }
        if (dy > TH.hipsDy) r.hipsDy.fails++;
      }
      // 2. planted drift
      for (let k = 0; k < 4; k++) {
        if (s.soles[k][1] < TH.planted && p.soles[k][1] < TH.planted) {
          const dd = Math.hypot(s.soles[k][0] - p.soles[k][0], s.soles[k][2] - p.soles[k][2]);
          if (dd > r.drift.max) { r.drift.max = dd; r.drift.t = t; r.drift.point = SOLE_NAMES[k]; }
          if (dd > TH.drift) r.drift.fails++;
        }
      }
    }
    // 5. sleeves inside own torso
    for (let k = 0; k < 4; k++) {
      const e = torsoE(s.slv[k], s, info[i]);
      if (e < r.sleeveInside.minE) { r.sleeveInside.minE = e; r.sleeveInside.t = t; r.sleeveInside.point = SLV_NAMES[k]; }
      if (e < 1) r.sleeveInside.fails++;
    }
    // 6. head y per phrase
    const ph = Math.floor((((t % 48) + 48) % 48) / 6);
    const key = `${ph}${SEQ[ph % SEQ.length]}`;
    const h = (r.headY[key] ??= { min: Infinity, max: -Infinity });
    h.min = Math.min(h.min, s.headY); h.max = Math.max(h.max, s.headY);
  }
  // 4. neighbours (i, i+1) with wrap
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    if (j === i) continue;
    let best = { d: Infinity };
    for (let a = 0; a < S[i].segs.length; a++) for (let b = 0; b < S[j].segs.length; b++) {
      const d = segSegDist(S[i].segs[a][0], S[i].segs[a][1], S[j].segs[b][0], S[j].segs[b][1]);
      if (d < best.d) best = { d, a, b };
    }
    const key = `${i}-${j}`;
    const arr = pairWorst.get(key) ?? [];
    if (best.d < TH.neighbour) { arr.push({ d: best.d, t, segs: `${segNames[best.a]}/${segNames[best.b]}` }); R[i].neighbour.fails++; R[j].neighbour.fails++; }
    pairWorst.set(key, arr);
    for (const [me, other] of [[i, j], [j, i]]) {
      const nb = R[me].neighbour;
      if (best.d < nb.min) { nb.min = best.d; nb.t = t; nb.with = info[other].name; nb.segs = me === i ? `${segNames[best.a]}/${segNames[best.b]}` : `${segNames[best.b]}/${segNames[best.a]}`; }
    }
  }
  prev = S;
  if (f % 240 === 0) process.stdout.write(`  t=${t.toFixed(2)} (${f}/${nF})\n`);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);

// ---- report -------------------------------------------------------------------------------
const cm = (x) => (x === Infinity || x === -Infinity || x == null ? '-' : (x * 100).toFixed(2));
const failsOf = (r) => ({
  hips: r.hipsDy.max > TH.hipsDy, drift: r.drift.max > TH.drift, sink: r.soleMin.min < TH.soleMin,
  neighbour: r.neighbour.min < TH.neighbour, sleeve: r.sleeveInside.minE < 1,
});
const shown = R.filter((r) => !only || r.name === only);
const pad = (s, n) => String(s).padEnd(n);
console.log(`\nmotion probe: ${N} dancers, t ${from}..${to} @ ${fps} fps (${nF + 1} frames, ${secs}s)  q="${q}"`);
console.log(`thresholds: hipsΔy ${TH.hipsDy * 100} cm, drift ${TH.drift * 100} cm/frame, sole ≥ ${TH.soleMin * 100} cm, neighbour ≥ ${TH.neighbour * 100} cm, sleeve e ≥ 1\n`);
console.log(pad('dancer', 14) + pad('hipsΔy cm @t', 18) + pad('drift cm @t', 22) + pad('soleMin cm @t', 18) + pad('neighbour cm @t (with, segs)', 46) + pad('sleeve e @t', 22) + 'FAIL');
let anyFail = false;
for (const r of shown) {
  const F = failsOf(r);
  const bad = Object.entries(F).filter(([, v]) => v).map(([k]) => k);
  if (bad.length) anyFail = true;
  console.log(
    pad(r.name, 14)
    + pad(`${cm(r.hipsDy.max)} @${r.hipsDy.t ?? '-'}`, 18)
    + pad(`${cm(r.drift.max)} @${r.drift.t ?? '-'} ${r.drift.point ?? ''}`, 22)
    + pad(`${cm(r.soleMin.min)} @${r.soleMin.t ?? '-'}`, 18)
    + pad(`${cm(r.neighbour.min)} @${r.neighbour.t ?? '-'} (${r.neighbour.with}, ${r.neighbour.segs})`, 46)
    + pad(`${r.sleeveInside.minE === Infinity ? '-' : r.sleeveInside.minE.toFixed(2)} @${r.sleeveInside.t ?? '-'} ${r.sleeveInside.point ?? ''}`, 22)
    + (bad.length ? bad.join(',') : 'ok'));
}
console.log('\nhead-y range per phrase (cm):');
const phKeys = [...new Set(shown.flatMap((r) => Object.keys(r.headY)))].sort((a, b) => parseInt(a) - parseInt(b));
console.log(pad('dancer', 14) + phKeys.map((k) => pad(k, 7)).join(''));
for (const r of shown) console.log(pad(r.name, 14) + phKeys.map((k) => pad(r.headY[k] ? cm(r.headY[k].max - r.headY[k].min) : '-', 7)).join(''));
const worstPairs = [...pairWorst.entries()].map(([k, arr]) => {
  const [i, j] = k.split('-').map(Number);
  const sorted = arr.sort((a, b) => a.d - b.d);
  return { pair: `${info[i].name}~${info[j].name}`, frames: arr.length, worst: sorted.slice(0, 5).map((w) => ({ cm: +(w.d * 100).toFixed(2), t: w.t, segs: w.segs })) };
}).filter((p) => p.frames > 0 && (!only || p.pair.split('~').includes(only))).sort((a, b) => a.worst[0].cm - b.worst[0].cm);
if (worstPairs.length) {
  console.log('\nneighbour contacts < 4 cm (worst first):');
  for (const p of worstPairs) console.log(`  ${pad(p.pair, 28)} ${String(p.frames).padStart(4)} frames  ` + p.worst.map((w) => `${w.cm}cm@${w.t} ${w.segs}`).join('  '));
}
const json = {
  when: new Date().toISOString(), q, from, to, fps, frames: nF + 1, thresholds: TH, SEQ,
  dancers: shown.map((r) => ({ ...r, fails: failsOf(r) })), neighbourPairs: worstPairs, logs,
};
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(`${out}.json`, JSON.stringify(json, (k, v) => (v === Infinity ? null : v), 1));
console.log(`\nwrote ${out}.json`);
if (logs.length) console.log('PAGE LOGS:\n' + logs.join('\n'));
await browser.close();
process.exit(anyFail && !reportOnly ? 1 : 0);
