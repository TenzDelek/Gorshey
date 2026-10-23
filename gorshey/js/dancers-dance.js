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
const REST = [0.2, 0.55, 0.35, 0.0];
const SW_L = { L: [0.62, 1.2, 0.5, -0.25], T: [0.55, -0.5, 0.85, 0.2], tw: 0.16, lk: 0.12 };
const SW_T = { L: [0.55, -0.5, 0.85, 0.2], T: [0.62, 1.2, 0.5, -0.25], tw: -0.16, lk: -0.12 };
const PRE = { L: [0.8, 0.35, 1.0, 0.7], T: [0.8, 0.35, 1.0, 0.7], tw: 0, lk: 0 };
const FLICK = { L: [1.5, 0.75, 0.25, -1.0], T: [1.5, 0.75, 0.25, -1.0], tw: 0, lk: 0, hd: -0.08 };
const FALL = { L: [0.95, 0.85, 0.45, -0.25], T: [0.95, 0.85, 0.45, -0.25], tw: 0, lk: 0 };
const BACK = { L: [0.6, 2.4, 0.2, 0.3], T: [0.6, 2.4, 0.2, 0.3], tw: 0, lk: 0, ln: 0.12 };
const BACK2 = { L: [0.66, 2.55, 0.2, 0.4], T: [0.66, 2.55, 0.2, 0.4], tw: 0, lk: 0, ln: 0.14 };
const FWD = { L: [1.25, 0.25, 0.6, 0.25], T: [1.25, 0.25, 0.6, 0.25], tw: 0, lk: 0, ln: -0.03 };
const FWDF = { L: [1.5, 0.55, 0.3, -0.9], T: [1.5, 0.55, 0.3, -0.9], tw: 0, lk: 0, hd: -0.05 };
const OVER = { L: [2.75, 0.35, 0.3, -0.4], T: [2.75, 0.35, 0.3, -0.4], tw: 0, lk: 0, hd: -0.15, up: 1 };
const LUP = { L: [2.8, 0.22, 0.4, -0.35], T: [1.52, 1.5, 0.15, -0.2], tw: 0.1, lk: 0.3, hd: -0.1, up: 1 };
const TUP = { L: [1.52, 1.5, 0.15, -0.2], T: [2.8, 0.22, 0.4, -0.35], tw: -0.1, lk: -0.3, hd: -0.1, up: 1 };
const OPEN = { L: [1.45, 1.35, 0.2, -0.3], T: [1.45, 1.35, 0.2, -0.3], tw: 0.18, lk: 0.2, up: 1 };
const SHOUT = { L: [2.6, 0.6, 0.3, -0.6], T: [2.6, 0.6, 0.3, -0.6], tw: 0, lk: 0, hd: -0.2, up: 1 };
const D_L = { L: [1.05, 1.1, 0.4, -0.2], T: [0.85, -0.3, 0.85, 0.3], tw: 0.2, lk: 0.1 };
const D_T = { L: [0.85, -0.3, 0.85, 0.3], T: [1.05, 1.1, 0.4, -0.2], tw: -0.2, lk: -0.1 };
const D_UP = { L: [1.35, 1.25, 0.3, -0.6], T: [1.35, 1.25, 0.3, -0.6], tw: 0, lk: 0, hd: -0.05 };
const lerpPose = (a, b, k) => ({
  L: a.L.map((v, i) => lerp(v, b.L[i], k)), T: a.T.map((v, i) => lerp(v, b.T[i], k)),
  tw: lerp(a.tw ?? 0, b.tw ?? 0, k), lk: lerp(a.lk ?? 0, b.lk ?? 0, k), ln: lerp(a.ln ?? 0, b.ln ?? 0, k), hd: lerp(a.hd ?? 0, b.hd ?? 0, k), up: Math.max(a.up ?? 0, b.up ?? 0),
});

// ---- plan ----------------------------------------------------------------------------
// st: { stance, lift, liftTap, kC, kD, back }
function simulate(ell, st) {
  const w = st.stance;
  const toe = 0.14;
  const lat = (psi) => [Math.cos(psi), -Math.sin(psi)];
  const home = (f, psi) => { const k = (f === 'L' ? 0.5 : -0.5) * w; const l = lat(psi); return [l[0] * k, l[1] * k]; };
  const feet = { L: { s: w / 2, u: 0, pl: 0 }, T: { s: -w / 2, u: 0, pl: 0 } };
  const centre = (f) => { const h = home(f, feet[f].pl); return [feet[f].s - h[0], feet[f].u - h[1]]; };
  const other = (f) => (f === 'L' ? 'T' : 'L');
  const ev = { L: [], T: [] };
  const body = [], arms = [], hops = [], dips = [];
  let psi = 0, turns = 0;
  const ellD = ell * st.kD, ellC = ell * st.kC;

  function land(f, beat, c, kind, o = {}) {
    const h = home(f, psi);
    const prev = ev[f][ev[f].length - 1];
    let tUp = beat - (o.swing ?? 0.5);
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
  const at = (f, du = 0) => { const c = centre(f); return [c[0], c[1] + du]; };
  const key = (t, pose) => arms.push({ t, pose });

  for (let ph = 0; ph < SEQ.length; ph++) {
    const b0 = ph * 8, type = SEQ[ph];
    if (type === 'A') {
      psi = turns + PSI_A;
      land('L', b0 + 0, ahead('T', ell), 'step');
      land('T', b0 + 1, ahead('L', ell), 'step');
      land('L', b0 + 2, ahead('T', ell), 'step');
      land('T', b0 + 3, at('L'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
      land('T', b0 + 4, ahead('L', ell), 'step', { hold: 0.22 });
      land('L', b0 + 5, ahead('T', ell), 'step');
      land('T', b0 + 6, ahead('L', ell), 'step');
      land('L', b0 + 7, at('T'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
      key(b0 + 0, SW_L); key(b0 + 1, SW_T); key(b0 + 2, SW_L); key(b0 + 2.6, PRE); key(b0 + 3.08, FLICK); key(b0 + 3.5, FALL);
      key(b0 + 4, SW_T); key(b0 + 5, SW_L); key(b0 + 6, SW_T); key(b0 + 6.6, PRE); key(b0 + 7.08, FLICK); key(b0 + 7.5, FALL);
    } else if (type === 'B') {
      psi = turns;
      const bk = st.back;
      land('L', b0 + 0, at('T', -bk), 'step', { lift: st.lift * 0.8 });
      land('T', b0 + 1, at('L'), 'step', { lift: st.lift * 0.8 });
      land('L', b0 + 2, at('T', bk), 'step', { lift: st.lift });
      land('T', b0 + 3, at('L'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
      land('T', b0 + 4, at('L', -bk), 'step', { lift: st.lift * 0.8, hold: 0.22 });
      land('L', b0 + 5, at('T'), 'step', { lift: st.lift * 0.8 });
      land('T', b0 + 6, at('L', bk), 'step', { lift: st.lift });
      land('L', b0 + 7, at('T'), 'tap', { lift: st.liftTap, swing: 0.55, peak: 0.6 });
      key(b0 + 0, BACK); key(b0 + 1, BACK2); key(b0 + 2, FWD); key(b0 + 3.08, FWDF); key(b0 + 3.5, FALL);
      key(b0 + 4, BACK); key(b0 + 5, BACK2); key(b0 + 6, FWD); key(b0 + 6.55, lerpPose(FWD, OVER, 0.5)); key(b0 + 7.05, OVER); key(b0 + 7.55, lerpPose(OVER, FALL, 0.45));
    } else if (type === 'C') {
      psi = turns;
      land('L', b0 + 0, at('T'), 'step', { lift: st.lift * 0.7 });
      land('T', b0 + 1, at('L'), 'step', { lift: st.lift * 0.7 });
      land('L', b0 + 2, at('T'), 'step', { lift: st.lift * 0.7 });
      land('T', b0 + 3, at('L'), 'step', { lift: st.lift * 0.7 });
      // three-step turn toward the line of travel, then close with a stamp
      const a = at('T');
      psi = turns + TAU / 3; a[0] += ellC; land('L', b0 + 4, a.slice(), 'step', { lift: st.lift * 0.9, bias: 0.5 });
      psi = turns + 2 * TAU / 3; a[0] += ellC; land('T', b0 + 5, a.slice(), 'step', { lift: st.lift * 0.9, bias: 0.5 });
      psi = turns + TAU; a[0] += ellC; land('L', b0 + 6, a.slice(), 'step', { lift: st.lift * 0.9, bias: 0.5 });
      turns += TAU;
      land('T', b0 + 7, a.slice(), 'step', { lift: st.liftTap, swing: 0.6, dip: 1, bias: 0.5 });
      key(b0 + 0, LUP); key(b0 + 1, { ...LUP, L: [2.9, 0.15, 0.45, -0.6] }); key(b0 + 1.55, lerpPose(LUP, TUP, 0.5));
      key(b0 + 2, TUP); key(b0 + 3, { ...TUP, T: [2.9, 0.15, 0.45, -0.6] }); key(b0 + 3.55, lerpPose(TUP, OPEN, 0.6));
      key(b0 + 4, OPEN); key(b0 + 5, { ...OPEN, L: [1.55, 1.4, 0.2, -0.5], T: [1.35, 1.3, 0.25, -0.1] }); key(b0 + 6, OPEN);
      key(b0 + 6.55, lerpPose(OPEN, SHOUT, 0.5)); key(b0 + 7.05, SHOUT); key(b0 + 7.5, { ...SHOUT, L: [2.45, 0.7, 0.4, -0.2], T: [2.45, 0.7, 0.4, -0.2] });
    } else if (type === 'D') {
      psi = turns + PSI_D;
      for (let k = 0; k < 7; k++) {
        const f = k % 2 === 0 ? 'L' : 'T';
        land(f, b0 + k, ahead(other(f), ellD), 'step', { lift: st.lift * 1.7, swing: k === 0 ? 0.6 : 0.8, hold: 0.04, peak: 0.4 });
        hop(f, b0 + k);
        key(b0 + k, k % 2 === 0 ? D_L : D_T); key(b0 + k + 0.5, D_UP);
      }
      land('T', b0 + 7, at('L'), 'step', { lift: st.lift, swing: 0.6, hold: 0.04 });
      key(b0 + 7, SW_T); key(b0 + 7.55, lerpPose(SW_T, SW_L, 0.5));
    }
  }
  const sTotal = centre('T')[0];
  return { ev, body, arms, hops, dips, sTotal, turns, ell };
}

export function buildPlan(st, R) {
  const z = simulate(0, st).sTotal, a = simulate(1, st).sTotal - z;
  const ell = (TAU * R - z) / a;
  const plan = simulate(ell, st);
  plan.body.sort((x, y) => x.t - y.t);
  plan.bodyTrack = new Track(plan.body, NB, [plan.sTotal, 0, plan.turns]);
  // arm track channels: L e, az, el, wr, T e, az, el, wr, twist, look, lean, head pitch, up
  plan.armTrack = new Track(plan.arms.map((k) => ({ t: k.t, v: [...k.pose.L, ...k.pose.T, k.pose.tw ?? 0, k.pose.lk ?? 0, k.pose.ln ?? 0, k.pose.hd ?? 0, k.pose.up ?? 0] })), NB);
  plan.R = R;
  return plan;
}

// foot state at beat x: { s, u, y, yaw, pitch, swing (0..1 or -1 planted) }
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
  if (x < tUp) {
    out.s = pv.e.s + pv.ds; out.u = pv.e.u; out.y = 0; out.yaw = pv.e.yaw + pv.dy; out.pitch = 0; out.swing = -1;
    out.since = x - (pv.e.tDn + pv.dt);
    return out;
  }
  const k = clamp((x - tUp) / (tDn - tUp));
  const pk = nx.e.peak;
  const kh = k < pk ? 0.5 - 0.5 * Math.cos(Math.PI * k / pk) : 0.5 + 0.5 * Math.cos(Math.PI * (k - pk) / (1 - pk));
  const km = k * k * (3 - 2 * k);
  out.s = lerp(pv.e.s + pv.ds, nx.e.s + nx.ds, km);
  out.u = lerp(pv.e.u, nx.e.u, km);
  out.y = nx.e.lift * kh;
  out.yaw = lerp(pv.e.yaw + pv.dy, nx.e.yaw + nx.dy, km);
  out.pitch = (nx.e.kind === 'hop' ? 0.15 : 0.35) * Math.sin(Math.PI * Math.min(1, k * 1.15)) * (k < 0.5 ? 1 : 0.6);
  out.swing = k;
  out.since = 0;
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
  for (const d of plan.dips) {
    for (const o of [0, NB, -NB]) {
      const k = (xl - d.t - o + 0.1) / 0.6;
      if (k > 0 && k < 1) y -= st.bounce * 0.8 * d.a * Math.sin(Math.PI * k);
    }
  }
  return y;
}
