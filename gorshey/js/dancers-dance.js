// Choreography for the gorshey circle: a footstep plan in "ring coordinates" plus smooth tracks.
//   s = arc length along the line of travel (m), u = offset toward the fire (m), psi = facing,
//   0 = facing the fire, + = turned toward the line of travel (so the turn mirrors with DIR).
//   "lead" foot/arm = the one on the travelling side (the dancer's LEFT when DIR = 1).
// Times are in beats (BEAT = 0.75 s), 64 beats = one loop, 8 phrases of 8 counts: A B A C | A D A C
//   A  "three steps and a change": step, step, step, tap-lift (+ arm flick) — travelling, turned ~40° toward travel
//   B  step back / tread forward in place, facing the fire, arms down-back then forward-up, both up on 8
//   C  one arm up / other out (alternating), then a three-step turn toward travel and a stamp + shout (both arms up)
//   D  step-hop (skip) travelling, bigger arms
// Stamps on counts where the same foot steps next are weightless taps. Travel is solved so each dancer
// makes exactly one revolution per loop and feet never slide (each foot is fixed while planted).
// A child (st.dbl) covers the adults' distance in every phrase (so he keeps his place in the ring) with twice
// the steps: two quick steps per beat in A and two skips per beat in D, ~0.24 m each (≈ 0.46 × his leg).
import { TAU, clamp, lerp } from './core.js';

export const NB = 64;
export const SEQ = ['A', 'B', 'A', 'C', 'A', 'D', 'A', 'C'];
const PSI_A = 0.68, PSI_D = 0.9;

// ---- monotone (PCHIP) cyclic track -------------------------------------------------------
export class Track {
  // keys: [{ t, v: [...] }]; period P; wrap: per-channel delta added each period
  constructor(keys, P, wrap) {
    keys = keys.slice().sort((a, b) => a.t - b.t);
    // merge near-duplicate times
    const k2 = [];
    for (const k of keys) { if (k2.length && Math.abs(k.t - k2[k2.length - 1].t) < 1e-4) k2[k2.length - 1] = k; else k2.push(k); }
    this.t = k2.map((k) => k.t);
    this.v = k2.map((k) => k.v);
    this.N = k2.length; this.P = P; this.C = k2[0].v.length;
    this.wrap = wrap ?? new Array(this.C).fill(0);
    this.m = this.t.map(() => new Array(this.C).fill(0));
    for (let j = 0; j < this.N; j++) {
      for (let c = 0; c < this.C; c++) {
        const t0 = this.T(j - 1), t1 = this.T(j), t2 = this.T(j + 1);
        const v0 = this.V(j - 1, c), v1 = this.V(j, c), v2 = this.V(j + 1, c);
        const h0 = t1 - t0, h1 = t2 - t1;
        const d0 = (v1 - v0) / h0, d1 = (v2 - v1) / h1;
        let m = 0;
        if (d0 * d1 > 0) { const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m = (w1 + w2) / (w1 / d0 + w2 / d1); }
        this.m[j][c] = m;
      }
    }
    this.out = new Array(this.C).fill(0);
  }
  T(j) { const n = Math.floor(j / this.N); return this.t[j - n * this.N] + n * this.P; }
  V(j, c) { const n = Math.floor(j / this.N); return this.v[j - n * this.N][c] + n * this.wrap[c]; }
  M(j, c) { const n = Math.floor(j / this.N); return this.m[j - n * this.N][c]; }
  eval(x, out = this.out) {
    const n = Math.floor((x - this.t[0]) / this.P);
    const xl = x - n * this.P;               // in [t0, t0 + P)
    let j = 0;
    while (j < this.N - 1 && this.t[j + 1] <= xl) j++;
    const t0 = this.T(j), t1 = this.T(j + 1);
    const h = t1 - t0, s = (xl - t0) / h;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    for (let c = 0; c < this.C; c++) {
      out[c] = h00 * this.V(j, c) + h10 * h * this.M(j, c) + h01 * this.V(j + 1, c) + h11 * h * this.M(j + 1, c) + n * this.wrap[c];
    }
    return out;
  }
}

// ---- arm vocabulary (lead arm, trail arm): [e, az, el, wr] + torso [twist, look, lean, liftHead] ----------------
// e = elevation from hanging, az = 0 forward .. PI/2 out to the side. `dw` = 1 marks the D (step-hop) and turn poses,
// where the men's extra arm width is reduced (dancers.js: st.wideD).
const REST = [0.2, 0.55, 0.35, 0.0];
const BASE = {
  SW_L: { L: [0.62, 1.2, 0.5, -0.25], T: [0.55, -0.5, 0.85, 0.2], tw: 0.16, lk: 0.12 },
  SW_T: { L: [0.55, -0.5, 0.85, 0.2], T: [0.62, 1.2, 0.5, -0.25], tw: -0.16, lk: -0.12 },
  PRE: { L: [0.8, 0.35, 1.0, 0.7], T: [0.8, 0.35, 1.0, 0.7] },
  FLICK: { L: [1.5, 0.75, 0.25, -1.0], T: [1.5, 0.75, 0.25, -1.0], hd: -0.08 },
  FALL: { L: [0.92, 0.55, 0.45, -0.25], T: [0.92, 0.55, 0.45, -0.25] },
  // arms passing low by the hips between a back and a forward position (not sweeping out at shoulder height)
  DN: { L: [0.3, 1.45, 0.3, 0.1], T: [0.3, 1.45, 0.3, 0.1], ln: 0.04 },
  // B: arms down-back then forward-up. Back and forward, not out toward the neighbours (who are only 1.3 m away).
  BACK: { L: [0.6, 2.6, 0.2, 0.3], T: [0.6, 2.6, 0.2, 0.3], ln: 0.12 },
  BACK2: { L: [0.66, 2.75, 0.2, 0.4], T: [0.66, 2.75, 0.2, 0.4], ln: 0.14 },
  FWD: { L: [1.25, 0.08, 0.6, 0.25], T: [1.25, 0.08, 0.6, 0.25], ln: -0.03 },
  FWDF: { L: [1.55, 0.38, 0.3, -0.9], T: [1.55, 0.38, 0.3, -0.9], hd: -0.05 },
  OVER: { L: [2.75, 0.35, 0.3, -0.4], T: [2.75, 0.35, 0.3, -0.4], hd: -0.15, up: 1 },
  // C: one arm up, the other out. The 'out' arm is ~1.0 rad from forward (was 1.35-1.5: long sleeves crossed the
  // neighbours'), with a little more elevation instead, which also keeps the sleeves above the flames.
  LUP: { L: [2.8, 0.22, 0.4, -0.35], T: [1.6, 1.02, 0.15, -0.2], tw: 0.1, lk: 0.3, hd: -0.1, up: 1 },
  TUP: { L: [1.6, 1.02, 0.15, -0.2], T: [2.8, 0.22, 0.4, -0.35], tw: -0.1, lk: -0.3, hd: -0.1, up: 1 },
  // the turn: arms open, elbows soft, so a spinning arm does not sweep into the neighbour
  OPEN: { L: [1.55, 0.98, 0.45, -0.3], T: [1.55, 0.98, 0.45, -0.3], tw: 0.18, lk: 0.2, up: 1, dw: 1 },
  OPEN5: { L: [1.64, 1.05, 0.45, -0.5], T: [1.46, 0.92, 0.5, -0.1], tw: 0.18, lk: 0.2, up: 1, dw: 1 },
  SHOUT: { L: [2.6, 0.6, 0.3, -0.6], T: [2.6, 0.6, 0.3, -0.6], hd: -0.2, up: 1 },
  // D: the body is turned ~52° toward travel, so the dancer ahead is ~53° to the left of forward: the lead arm
  // swings up and forward rather than out at them
  D_L: { L: [1.2, 0.62, 0.4, -0.2], T: [0.85, -0.3, 0.85, 0.3], tw: 0.2, lk: 0.1, dw: 1 },
  D_T: { L: [0.85, -0.3, 0.85, 0.3], T: [1.2, 0.62, 0.4, -0.2], tw: -0.2, lk: -0.1, dw: 1 },
  D_UP: { L: [1.75, 0.45, 0.3, -0.6], T: [1.75, 0.45, 0.3, -0.6], hd: -0.05, dw: 1 },
};
const clonePose = (p) => ({ ...p, L: p.L.slice(), T: p.T.slice() });
const lerpPose = (a, b, k) => ({
  L: a.L.map((v, i) => lerp(v, b.L[i], k)), T: a.T.map((v, i) => lerp(v, b.T[i], k)),
  tw: lerp(a.tw ?? 0, b.tw ?? 0, k), lk: lerp(a.lk ?? 0, b.lk ?? 0, k), ln: lerp(a.ln ?? 0, b.ln ?? 0, k), hd: lerp(a.hd ?? 0, b.hd ?? 0, k),
  up: Math.max(a.up ?? 0, b.up ?? 0), dw: lerp(a.dw ?? 0, b.dw ?? 0, k),
});
// the vocabulary as this dancer performs it
function vocab(st) {
  const V = Object.fromEntries(Object.entries(BASE).map(([k, p]) => [k, clonePose(p)]));
  if (st.long) {
    // long-sleeved women: reach forward and slightly in, not out toward the neighbours (sleeves crossed);
    // the C 'out' arm a little narrower again and higher
    for (const a of [V.FWD.L, V.FWD.T]) a[1] = -0.05;
    for (const a of [V.FWDF.L, V.FWDF.T]) a[1] = 0.25;
    for (const a of [V.LUP.T, V.TUP.L]) { a[1] *= 0.84; a[0] += 0.14; }
    for (const a of [V.OPEN.L, V.OPEN.T, V.OPEN5.L, V.OPEN5.T]) { a[0] -= 0.1; a[1] *= 0.72; a[2] += 0.35; }
  }
  else {
    // men: the turn's open arms a little narrower and softer too
    for (const a of [V.OPEN.L, V.OPEN.T, V.OPEN5.L, V.OPEN5.T]) { a[0] -= 0.15; a[1] *= 0.84; a[2] += 0.2; }
  }
  if (st.dbl) {
    // the child's quick trot: smaller arm swings
    const R = { L: REST, T: REST };
    V.SW_L = { ...lerpPose(R, V.SW_L, 0.65), tw: 0.1, lk: 0.08 };
    V.SW_T = { ...lerpPose(R, V.SW_T, 0.65), tw: -0.1, lk: -0.08 };
  }
  return V;
}

// ---- plan ----------------------------------------------------------------------------
// st: { stance, lift, liftTap, kC, kD, back, kB, dbl, long }
function simulate(ell, st) {
  const w = st.stance;
  const toe = 0.14;
  const V = vocab(st);
  const lat = (psi) => [Math.cos(psi), -Math.sin(psi)];
  const home = (f, psi) => { const k = (f === 'L' ? 0.5 : -0.5) * w; const l = lat(psi); return [l[0] * k, l[1] * k]; };
  const feet = { L: { s: w / 2, u: 0, pl: 0 }, T: { s: -w / 2, u: 0, pl: 0 } };
  const centre = (f) => { const h = home(f, feet[f].pl); return [feet[f].s - h[0], feet[f].u - h[1]]; };
  const other = (f) => (f === 'L' ? 'T' : 'L');
  const ev = { L: [], T: [] };
  const body = [], arms = [], hops = [], dips = [], phrasePsi = [];
  let psi = 0, turns = 0;
  const ellD = ell * st.kD, ellC = ell * st.kC, adv = ell * (st.kB ?? 0);

  function land(f, beat, c, kind, o = {}) {
    const h = home(f, psi);
    const prev = ev[f][ev[f].length - 1];
    let tUp = beat - (o.swing ?? 0.55);
    if (prev) tUp = Math.max(tUp, prev.tDn + (o.hold ?? 0.12));
    feet[f] = { s: c[0] + h[0], u: c[1] + h[1], pl: psi };
    ev[f].push({ tUp, tDn: beat, s: feet[f].s, u: feet[f].u, yaw: psi + (f === 'L' ? toe : -toe), lift: o.lift ?? st.lift, kind, peak: o.peak ?? 0.45 });
    const g = other(f);
    if (kind === 'step') {
      const b = o.bias ?? 0.6;
      body.push({ t: beat + 0.06, v: [lerp(feet[g].s, feet[f].s, b), lerp(feet[g].u, feet[f].u, b), psi] });
    } else if (kind === 'tap') {
      body.push({ t: beat + 0.06, v: [lerp(feet[g].s, feet[f].s, 0.12), lerp(feet[g].u, feet[f].u, 0.12), psi] });
    }
    if (o.dip) dips.push({ t: beat, a: o.dip });
  }
  const hop = (f, beat) => {
    const prev = ev[f][ev[f].length - 1];
    ev[f].push({ tUp: beat + 0.3, tDn: beat + 0.62, s: prev.s, u: prev.u, yaw: prev.yaw, lift: st.hop, kind: 'hop', peak: 0.5 });
    hops.push({ t0: beat + 0.2, t1: beat + 0.7 });
  };
  const ahead = (f, d) => { const c = centre(f); return [c[0] + d, c[1]]; };
  const at = (f, du = 0, ds = 0) => { const c = centre(f); return [c[0] + ds, c[1] + du]; };
  const key = (t, pose) => arms.push({ t, pose });

  for (let ph = 0; ph < SEQ.length; ph++) {
    const b0 = ph * 8, type = SEQ[ph];
    if (type === 'A') {
      psi = turns + PSI_A;
      if (st.dbl) {
        // child: two quick steps per beat, a tap on 4 and 8 with the same foot that steps next
        const half = (start) => {
          let f = 'L';
          for (let k = 0; k < 6; k++) { land(f, start + k * 0.5, ahead(other(f), ell * 0.5), 'step', { swing: 0.4, hold: 0.06, peak: 0.42, bias: 0.45 }); f = other(f); }
          land('L', start + 3, at('T'), 'tap', { lift: st.liftTap, swing: 0.42, peak: 0.6, hold: 0.06 });
        };
        half(b0); half(b0 + 4);
        for (const o of [0, 4]) {
          key(b0 + o, V.SW_L); key(b0 + o + 0.5, V.SW_T); key(b0 + o + 1, V.SW_L); key(b0 + o + 1.5, V.SW_T); key(b0 + o + 2, V.SW_L);
          key(b0 + o + 2.6, V.PRE); key(b0 + o + 3.08, V.FLICK); key(b0 + o + 3.5, V.FALL);
        }
      } else {
        // travelling side-steps: the body settles between the feet before the trailing foot leaves (bias < 0.6),
        // so the trailing leg is never stretched far behind
        const o = { bias: 0.45 };
        land('L', b0 + 0, ahead('T', ell), 'step', o);
        land('T', b0 + 1, ahead('L', ell), 'step', o);
        land('L', b0 + 2, ahead('T', ell), 'step', o);
        land('T', b0 + 3, at('L'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
        land('T', b0 + 4, ahead('L', ell), 'step', { hold: 0.22, bias: 0.45 });
        land('L', b0 + 5, ahead('T', ell), 'step', o);
        land('T', b0 + 6, ahead('L', ell), 'step', o);
        land('L', b0 + 7, at('T'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
        key(b0 + 0, V.SW_L); key(b0 + 1, V.SW_T); key(b0 + 2, V.SW_L); key(b0 + 2.6, V.PRE); key(b0 + 3.08, V.FLICK); key(b0 + 3.5, V.FALL);
        key(b0 + 4, V.SW_T); key(b0 + 5, V.SW_L); key(b0 + 6, V.SW_T); key(b0 + 6.6, V.PRE); key(b0 + 7.08, V.FLICK); key(b0 + 7.5, V.FALL);
      }
    } else if (type === 'B') {
      psi = turns;
      const bk = st.back;
      land('L', b0 + 0, at('T', -bk, adv), 'step', { lift: st.lift * 0.8 });
      land('T', b0 + 1, at('L', 0, adv), 'step', { lift: st.lift * 0.8 });
      land('L', b0 + 2, at('T', bk, adv), 'step', { lift: st.lift });
      land('T', b0 + 3, at('L'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
      land('T', b0 + 4, at('L', -bk, adv), 'step', { lift: st.lift * 0.8, hold: 0.22 });
      land('L', b0 + 5, at('T', 0, adv), 'step', { lift: st.lift * 0.8 });
      land('T', b0 + 6, at('L', bk, adv), 'step', { lift: st.lift });
      land('L', b0 + 7, at('T'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
      key(b0 - 0.22, V.DN); key(b0 + 0, V.BACK); key(b0 + 1, V.BACK2); key(b0 + 1.55, V.DN); key(b0 + 2, V.FWD); key(b0 + 3.08, V.FWDF); key(b0 + 3.5, V.FALL);
      key(b0 + 3.8, V.DN); key(b0 + 4, V.BACK); key(b0 + 5, V.BACK2); key(b0 + 5.55, V.DN); key(b0 + 6, V.FWD); key(b0 + 6.55, lerpPose(V.FWD, V.OVER, 0.5)); key(b0 + 7.05, V.OVER); key(b0 + 7.55, lerpPose(V.OVER, V.FALL, 0.45));
    } else if (type === 'C') {
      psi = turns;
      land('L', b0 + 0, at('T', 0, adv), 'step', { lift: st.lift * 0.7 });
      land('T', b0 + 1, at('L', 0, adv), 'step', { lift: st.lift * 0.7 });
      land('L', b0 + 2, at('T', 0, adv), 'step', { lift: st.lift * 0.7 });
      land('T', b0 + 3, at('L', 0, adv), 'step', { lift: st.lift * 0.7 });
      // three-step turn toward the line of travel, then close with a stamp
      const a = at('T');
      // (long swings: the trailing foot leaves early, before the turning body winds the legs across each other)
      psi = turns + TAU / 3; a[0] += ellC; land('L', b0 + 4, a.slice(), 'step', { lift: st.lift * 0.9, bias: 0.5, swing: 0.75 });
      psi = turns + 2 * TAU / 3; a[0] += ellC; land('T', b0 + 5, a.slice(), 'step', { lift: st.lift * 0.9, bias: 0.5, swing: 0.8, hold: 0.1 });
      psi = turns + TAU; a[0] += ellC; land('L', b0 + 6, a.slice(), 'step', { lift: st.lift * 0.9, bias: 0.5, swing: 0.8, hold: 0.1 });
      turns += TAU;
      land('T', b0 + 7, a.slice(), 'step', { lift: st.liftTap, swing: 0.6, dip: 1, bias: 0.5 });
      key(b0 + 0, V.LUP); key(b0 + 1, { ...V.LUP, L: [2.9, 0.15, 0.45, -0.6] }); key(b0 + 1.55, lerpPose(V.LUP, V.TUP, 0.5));
      key(b0 + 2, V.TUP); key(b0 + 3, { ...V.TUP, T: [2.9, 0.15, 0.45, -0.6] }); key(b0 + 3.55, lerpPose(V.TUP, V.OPEN, 0.6));
      key(b0 + 4, V.OPEN); key(b0 + 5, V.OPEN5); key(b0 + 6, V.OPEN);
      key(b0 + 6.55, lerpPose(V.OPEN, V.SHOUT, 0.5)); key(b0 + 7.05, V.SHOUT); key(b0 + 7.5, { ...V.SHOUT, L: [2.45, 0.7, 0.4, -0.2], T: [2.45, 0.7, 0.4, -0.2] });
    } else if (type === 'D' && st.dbl) {
      // child: quick skips on every half beat, the same distance as the adults' seven step-hops
      psi = turns + PSI_D;
      const n = 13;
      for (let k = 0; k < n; k++) {
        const f = k % 2 === 0 ? 'L' : 'T', bt = b0 + k * 0.5;
        land(f, bt, ahead(other(f), ellD * 7 / n), 'step', { lift: st.lift * 1.4, swing: k === 0 ? 0.45 : 0.4, hold: 0.03, peak: 0.4 });
        const prev = ev[f][ev[f].length - 1];
        ev[f].push({ tUp: bt + 0.15, tDn: bt + 0.31, s: prev.s, u: prev.u, yaw: prev.yaw, lift: st.hop, kind: 'hop', peak: 0.5 });
        hops.push({ t0: bt + 0.1, t1: bt + 0.35 });
      }
      land('T', b0 + 7, at('L'), 'step', { lift: st.lift, swing: 0.5, hold: 0.04 });
      for (let k = 0; k < 7; k++) { key(b0 + k, k % 2 === 0 ? V.D_L : V.D_T); key(b0 + k + 0.5, V.D_UP); }
      key(b0 + 7, V.SW_T); key(b0 + 7.55, lerpPose(V.SW_T, V.SW_L, 0.5));
    } else if (type === 'D') {
      psi = turns + PSI_D;
      for (let k = 0; k < 7; k++) {
        const f = k % 2 === 0 ? 'L' : 'T';
        land(f, b0 + k, ahead(other(f), ellD), 'step', { lift: st.lift * 1.7, swing: k === 0 ? 0.6 : 0.8, hold: 0.04, peak: 0.4 });
        hop(f, b0 + k);
        key(b0 + k, k % 2 === 0 ? V.D_L : V.D_T); key(b0 + k + 0.5, V.D_UP);
      }
      land('T', b0 + 7, at('L'), 'step', { lift: st.lift, swing: 0.6, hold: 0.04 });
      key(b0 + 7, V.SW_T); key(b0 + 7.55, lerpPose(V.SW_T, V.SW_L, 0.5));
    }
    phrasePsi.push(type === 'C' ? turns - TAU : psi);
  }
  const sTotal = centre('T')[0];
  return { ev, body, arms, hops, dips, phrasePsi, sTotal, turns, ell };
}

export function buildPlan(st, R) {
  const z = simulate(0, st).sTotal, a = simulate(1, st).sTotal - z;
  const ell = (TAU * R - z) / a;
  const plan = simulate(ell, st);
  plan.body.sort((x, y) => x.t - y.t);
  plan.bodyTrack = new Track(plan.body, NB, [plan.sTotal, 0, plan.turns]);
  // arm track channels: L e, az, el, wr, T e, az, el, wr, twist, look, lean, head pitch, up, D-weight
  plan.armTrack = new Track(plan.arms.map((k) => ({ t: k.t, v: [...k.pose.L, ...k.pose.T, k.pose.tw ?? 0, k.pose.lk ?? 0, k.pose.ln ?? 0, k.pose.hd ?? 0, k.pose.up ?? 0, k.pose.dw ?? 0] })), NB);
  plan.R = R;
  return plan;
}

// foot state at beat x (x in [0, NB)):
//   planted: { s, u, yaw, swing: -1 }
//   swing:   { swing: k in 0..1, s0/u0/yaw0 (take-off footprint), s1/u1/yaw1 (landing footprint), tUp, tDn (beats,
//              on the same unwrapped axis as x), lift, peak, kind }
// The trajectory itself (toe-off pivot, toe arc, landing) is built in dancers.js, where the body frame is known.
export function evalFoot(plan, f, x, out) {
  const E = plan.ev[f], N = E.length;
  const n = Math.floor(x / NB), xl = x - n * NB;
  const S = plan.sTotal, Y = plan.turns;
  const get = (j, o) => { const q = Math.floor(j / N); const e = E[j - q * N]; o.e = e; o.dt = (q + n) * NB; o.ds = (q + n) * S; o.dy = (q + n) * Y; return o; };
  // first event with tDn > xl
  let j = 0;
  while (j < N && E[j].tDn <= xl) j++;
  const nx = get(j, _a), pv = get(j - 1, _b);
  const tUp = nx.e.tUp + nx.dt, tDn = nx.e.tDn + nx.dt;
  out.s = out.s0 = pv.e.s + pv.ds; out.u = out.u0 = pv.e.u; out.yaw = out.yaw0 = pv.e.yaw + pv.dy;
  if (x < tUp) { out.swing = -1; return out; }
  out.swing = clamp((x - tUp) / (tDn - tUp));
  out.s1 = nx.e.s + nx.ds; out.u1 = nx.e.u; out.yaw1 = nx.e.yaw + nx.dy;
  out.tUp = tUp; out.tDn = tDn; out.lift = nx.e.lift; out.peak = nx.e.peak; out.kind = nx.e.kind;
  return out;
}
const _a = {}, _b = {};

// vertical body offset at beat x (bounce + hops + stamps); amp scales the bounce
export function bodyLift(plan, x, st) {
  const xl = ((x % NB) + NB) % NB;
  // soft knee bounce: lowest just after each beat, up on the "and"
  let y = -st.bounce * (0.5 + 0.5 * Math.cos(TAU * (xl - 0.08)));
  for (const h of plan.hops) {
    for (const o of [0, NB, -NB]) {
      const k = (xl - h.t0 - o) / (h.t1 - h.t0);
      if (k > 0 && k < 1) y += st.hopBody * Math.sin(Math.PI * k);
    }
  }
  y -= dipAt(plan, xl, st);
  return y;
}
// depth of the deliberate stamp dip (C count 8) at beat x, >= 0
export function dipAt(plan, x, st) {
  const xl = ((x % NB) + NB) % NB;
  let y = 0;
  for (const d of plan.dips) {
    for (const o of [0, NB, -NB]) {
      const k = (xl - d.t - o + 0.1) / 0.6;
      if (k > 0 && k < 1) y += st.bounce * 0.8 * d.a * Math.sin(Math.PI * k);
    }
  }
  return y;
}
