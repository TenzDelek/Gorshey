// Boots the diorama: renderer, scene modules, loop, drag-to-turn, theme sync.
// URL options (for testing): ?only=fire,dancers  ?t=3.5&static=1  ?mode=night  ?rows=300  ?az=45  ?el=33
//   ?grid=1 (1 m grid, LAYOUT markers, CLEAR circles, FOOTPRINTS)  ?zoom=1.6&cx=0&cz=0  ?clean=1  ?debug=1
// The query is parsed once here; modules read ctx.params / ctx.zoom / ctx.debug, never location.search.
import * as THREE from 'three';
import * as core from './core.js';
import { createRenderer } from './render.js';

const MODULES = ['ground', 'fire', 'dancers', 'camp', 'life'];
const params = new URLSearchParams(location.search);
const num = (k, d) => { const v = parseFloat(params.get(k)); return Number.isFinite(v) ? v : d; };
const only = params.get('only') ? params.get('only').split(',') : null;
const fixedT = params.has('t') ? num('t', 0) : null;
const isStatic = params.get('static') === '1' || fixedT !== null;
const debug = params.get('debug') === '1';
const zoom = num('zoom', 1) > 0 ? num('zoom', 1) : 1;
const centred = params.has('zoom') || params.has('cx') || params.has('cz');   // close-ups: no framing offsets
if (params.get('clean') === '1') document.documentElement.classList.add('clean');

// ---- public handle for tools (window.gorshey) + legacy aliases -------------------
const pub = { ready: false, LOOP: core.LOOP };
window.gorshey = pub;
window.__LOOP = core.LOOP;
function expose(name, value) {
  if (!debug) return;
  (pub.debug ??= {})[name] = value;
}

const canvas = document.getElementById('scene');
const loadingEl = document.querySelector('.loading');
const errors = [];
function showErrors() {
  const el = document.getElementById('errors');
  if (!el) return;
  el.hidden = !debug || errors.length === 0;   // the on-page box is a debugging aid; the console always gets them
  el.textContent = errors.join('\n');
}

let R;
try {
  R = createRenderer(canvas, { rows: params.has('rows') ? num('rows', 380) : undefined, preserve: params.get('preserve') === '1' });
} catch (e) {
  console.error('[render] WebGL unavailable', e);
  if (loadingEl) loadingEl.textContent = 'This diorama needs WebGL.';
  document.documentElement.classList.add('failed');
  throw e;
}
if (params.has('az')) R.view.azimuth = THREE.MathUtils.degToRad(num('az', 45));
if (params.has('el')) R.view.elevation = THREE.MathUtils.degToRad(num('el', 33));
R.view.zoom = zoom;
if (centred) { R.view.centred = true; R.view.shiftY = 0; }
if (params.has('cx') || params.has('cz')) R.view.target.set(num('cx', 0), R.view.target.y, num('cz', 0));

const ctx = {
  THREE, core, scene: R.scene, renderer: R.renderer, camera: R.camera, sun: R.sun, R,
  mode: 'day', shared: {}, params, zoom, debug, expose,
};
const parts = [];
expose('R', R);        // ?debug=1: renderer handle for tools (view, state, render)
expose('ctx', ctx);

// ---- render on demand ----------------------------------------------------------
// While playing, every animation frame renders. Paused (or reduced motion), a frame is drawn only
// when something changed: drag, inertia, resize, theme/mode change, or the day/night ease.
let dirty = true;
const invalidate = () => { dirty = true; };

async function loadModules() {
  const list = (only?.includes('base') ? ['base', ...MODULES] : MODULES).filter((n) => (only ? only.includes(n) : n !== 'base'));
  // fetch + evaluate in parallel, build strictly in order (later modules read ctx.shared from earlier ones)
  const mods = await Promise.all(list.map((n) => import(`./${n}.js`).catch((e) => e)));
  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    try {
      const mod = mods[i];
      if (mod instanceof Error) throw mod;
      const part = await mod.build(ctx);
      if (part?.group) R.scene.add(part.group);
      parts.push({ name, ...part });
    } catch (e) {
      console.error(`[${name}]`, e);
      errors.push(`${name}: ${e.message}`);
    }
  }
  if (params.get('grid') === '1') addGrid();
  showErrors();
}

// Test overlay: 1 m grid, LAYOUT markers (magenta posts, fire orange), CLEAR circles (cyan),
// FOOTPRINTS (yellow), and the dancers' maximum reach (orange ring, 3.62 m).
function addGrid() {
  const g = new THREE.GridHelper(16, 16, 0xff3366, 0x8899aa);
  g.position.y = 0.01;
  R.scene.add(g);
  const mk = (x, z, c) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, 1.1, z); R.scene.add(m); };
  for (const v of Object.values(core.LAYOUT)) if (v?.pos) mk(v.pos[0], v.pos[1], 0xff00aa);
  mk(0, 0, 0xff8800);
  // outlines draw on top of the grass (no depth test) so footprints stay readable
  const loop = (pts, c) => { const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 0.03, z))), new THREE.LineBasicMaterial({ color: c, depthTest: false })); l.renderOrder = 10; R.scene.add(l); };
  const ring = (cx, cz, r, c) => loop(Array.from({ length: 48 }, (_, i) => [cx + r * Math.cos((i / 48) * core.TAU), cz + r * Math.sin((i / 48) * core.TAU)]), c);
  for (const [x, z, r] of core.CLEAR) ring(x, z, r, 0x00e5ff);
  ring(0, 0, 3.62, 0xff8800);
  const toW = (f, u, v) => { const c = Math.cos(f.ry ?? 0), s = Math.sin(f.ry ?? 0); return [f.pos[0] + c * u + s * v, f.pos[1] - s * u + c * v]; };
  for (const f of core.FOOTPRINTS ?? []) {
    if (f.shape === 'rect') loop([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toW(f, a * f.hx, b * f.hz)), 0xffee00);
    else loop(Array.from({ length: 40 }, (_, i) => toW(f, (f.cx ?? 0) + f.hx * Math.cos((i / 40) * core.TAU), f.hz * Math.sin((i / 40) * core.TAU))), 0xffee00);
  }
}

// ---- theme ---------------------------------------------------------------
const forcedMode = params.get('mode') === 'day' || params.get('mode') === 'night' ? params.get('mode') : null;
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function themeMode() {
  if (forcedMode) return forcedMode;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return 'night';
  if (attr === 'light') return 'day';
  return darkMQ.matches ? 'night' : 'day';
}
let userMode = null; // set by the toggle button; a host/OS theme change clears it
const nightBtn = document.getElementById('toggle-night');
function syncMode(instant) {
  const m = userMode ?? themeMode();
  ctx.mode = m;
  document.documentElement.dataset.scene = m;
  nightBtn?.setAttribute('aria-pressed', String(m === 'night'));
  R.setMode(m, instant);
  invalidate();
}
darkMQ.addEventListener('change', () => { userMode = null; syncMode(false); });
new MutationObserver(() => { userMode = null; syncMode(false); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
nightBtn?.addEventListener('click', () => {
  userMode = (ctx.mode === 'night') ? 'day' : 'night';
  syncMode(false);
});

// ---- size ------------------------------------------------------------------
const overlayEl = document.querySelector('.overlay');
let fittedDpr = 0;
function fit() {
  fittedDpr = window.devicePixelRatio || 1;
  const host = canvas.parentElement;
  const r = host.getBoundingClientRect();
  // the caption + controls cover the bottom of the canvas; portrait framing centres the patch above them
  let bottom = 0;
  if (!centred && overlayEl) {
    const o = overlayEl.getBoundingClientRect();
    if (o.height > 0) bottom = Math.max(0, r.bottom - o.top);
  }
  R.view.insets.bottom = bottom;
  R.resize(Math.max(50, r.width), Math.max(50, r.height));
  invalidate();
}
const ro = new ResizeObserver(fit);
ro.observe(canvas.parentElement);
if (overlayEl) ro.observe(overlayEl);
R.watchDpr(fit);   // browser zoom / moving to another screen (the loop below also checks, as a fallback)

// ---- drag to turn the diorama ------------------------------------------------
// One pointer at a time (a second finger is ignored), primary button only. Sensitivity: half a turn
// per canvas width. Release inertia only if the pointer was still moving in the last 60 ms.
const baseAz = R.view.azimuth;
const MAX_VEL = 0.06;                 // rad per 60 Hz frame
let drag = null, azVel = 0;
const clampVel = (v) => Math.max(-MAX_VEL, Math.min(MAX_VEL, v));
canvas.addEventListener('pointerdown', (e) => {
  if (drag || e.button !== 0) return;
  drag = { id: e.pointerId, x: e.clientX, az: R.view.azimuth, lastT: performance.now() };
  azVel = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const now = performance.now();
  const w = canvas.getBoundingClientRect().width || 1;
  const next = drag.az - (e.clientX - drag.x) * (Math.PI / w);
  const dtMs = Math.max(4, now - drag.lastT);
  azVel = clampVel(((next - R.view.azimuth) / dtMs) * (1000 / 60));
  drag.lastT = now;
  R.view.azimuth = next;
  R.updateCamera();
  invalidate();
});
const endDrag = (e) => {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  if (!e || e.type !== 'pointerup' || performance.now() - drag.lastT > 60) azVel = 0;
  drag = null;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
canvas.addEventListener('dblclick', () => { R.view.azimuth = baseAz; azVel = 0; R.updateCamera(); invalidate(); });
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { R.view.azimuth += 0.15; R.updateCamera(); invalidate(); }
  if (e.key === 'ArrowRight') { R.view.azimuth -= 0.15; R.updateCamera(); invalidate(); }
});

// ---- loop ----------------------------------------------------------------------
const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
let userPaused = null;                 // set once the viewer presses Play/Pause
let paused = reducedMQ.matches && !isStatic;
const pauseBtn = document.getElementById('toggle-play');
function setPaused(p) {
  paused = p;
  const label = pauseBtn?.querySelector('span');
  if (label) label.textContent = p ? 'Play' : 'Pause';
  invalidate();
}
pauseBtn?.addEventListener('click', () => { userPaused = !paused; setPaused(userPaused); });
reducedMQ.addEventListener('change', () => { if (userPaused === null && !isStatic) setPaused(reducedMQ.matches); });
setPaused(paused);

function frame(t, dt) {
  for (const p of parts) {
    try { p.update?.(t, ctx, dt); } catch (e) { if (!p.failed) { p.failed = true; console.error(`[${p.name}] update`, e); errors.push(`${p.name} update: ${e.message}`); showErrors(); } }
  }
  R.render(t, dt);
}

let simT = fixedT ?? 0, last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if ((window.devicePixelRatio || 1) !== fittedDpr) fit();
  if (!drag && Math.abs(azVel) > 1e-4) {
    R.view.azimuth += azVel * dt * 60;
    azVel *= Math.pow(0.9, dt * 60);
    R.updateCamera();
    dirty = true;
  } else if (!drag) azVel = 0;
  const playing = !paused && !isStatic;
  if (playing) simT = (simT + dt) % core.LOOP;
  const easing = R.state.night !== (R.state.mode === 'night' ? 1 : 0);
  if (playing || dirty || easing) {
    dirty = false;
    frame(simT, isStatic ? 0 : dt);
  }
  requestAnimationFrame(tick);
}

// For capture scripts: deterministic frame at time t (seconds).
function renderAt(t) { R.setMode(ctx.mode, true); frame(t, 0); return true; }
function setMode(m) { userMode = m; syncMode(true); }
// For agents/tests: draw calls + triangles of the last frame, and per-module object counts.
function info() {
  R.renderer.info.autoReset = false; R.renderer.info.reset(); frame(simT, 0);
  const i = R.renderer.info.render; R.renderer.info.autoReset = true;
  const counts = Object.fromEntries(parts.map((p) => { let n = 0; p.group?.traverse((o) => { if (o.isMesh) n++; }); return [p.name, n]; }));
  return { calls: i.calls, triangles: i.triangles, meshesPerModule: counts, lowRes: [R.state.lowW, R.state.lowH], px: R.state.px, artPx: core.U.uArtPx.value, errors };
}
Object.assign(pub, { renderAt, setMode, info });
window.__renderAt = renderAt;
window.__setMode = setMode;
window.__info = info;

syncMode(true);
fit();
await loadModules();
fit();
frame(simT, 0);
dirty = false;
pub.ready = true;
window.__ready = true;
document.documentElement.classList.add('ready');
if (!isStatic) requestAnimationFrame((n) => { last = n; tick(n); });
