// Boots the diorama: renderer, scene modules, loop, drag-to-turn, theme sync.
// URL options (for testing): ?only=fire,dancers  ?t=3.5&static=1  ?mode=night  ?rows=300  ?az=45  ?grid=1  ?zoom=1.6&cx=0&cz=0
import * as THREE from 'three';
import * as core from './core.js';
import { createRenderer } from './render.js';

const MODULES = ['ground', 'fire', 'dancers', 'camp', 'life'];
const q = new URLSearchParams(location.search);
const only = q.get('only') ? q.get('only').split(',') : null;
const fixedT = q.has('t') ? parseFloat(q.get('t')) : null;
const isStatic = q.get('static') === '1' || fixedT !== null;
if (q.get('clean') === '1') document.documentElement.classList.add('clean');

const canvas = document.getElementById('scene');
const R = createRenderer(canvas, { rows: q.has('rows') ? +q.get('rows') : undefined, preserve: q.get('preserve') === '1' });
if (q.has('az')) R.view.azimuth = THREE.MathUtils.degToRad(+q.get('az'));
if (q.has('el')) R.view.elevation = THREE.MathUtils.degToRad(+q.get('el'));
if (q.has('zoom')) R.view.height /= +q.get('zoom');
if (q.has('cx') || q.has('cz')) R.view.target.set(+(q.get('cx') ?? 0), R.view.target.y, +(q.get('cz') ?? 0));

const ctx = { THREE, core, scene: R.scene, renderer: R.renderer, camera: R.camera, sun: R.sun, R, mode: 'day', shared: {} };
const parts = [];
const errors = [];

function showErrors() {
  const el = document.getElementById('errors');
  if (!el) return;
  el.hidden = errors.length === 0;
  el.textContent = errors.join('\n');
}

async function loadModules() {
  const list = only?.includes('base') ? ['base', ...MODULES] : MODULES;
  for (const name of list) {
    if (only ? !only.includes(name) : name === 'base') continue;
    try {
      const mod = await import(`./${name}.js`);
      const part = await mod.build(ctx);
      if (part?.group) R.scene.add(part.group);
      parts.push({ name, ...part });
    } catch (e) {
      console.error(`[${name}]`, e);
      errors.push(`${name}: ${e.message}`);
    }
  }
  if (q.get('grid') === '1') addGrid();
  showErrors();
}

function addGrid() {
  const g = new THREE.GridHelper(16, 16, 0xff3366, 0x8899aa);
  g.position.y = 0.01;
  R.scene.add(g);
  const mk = (x, z, c) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, 1.1, z); R.scene.add(m); };
  for (const [k, v] of Object.entries(core.LAYOUT)) if (v?.pos) mk(v.pos[0], v.pos[1], 0xff00aa);
  mk(0, 0, 0xff8800);
}

// ---- theme ---------------------------------------------------------------
function themeMode() {
  const forced = q.get('mode');
  if (forced === 'day' || forced === 'night') return forced;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return 'night';
  if (attr === 'light') return 'day';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
}
let userMode = null; // set by the toggle button
function syncMode(instant) {
  const m = userMode ?? themeMode();
  ctx.mode = m;
  document.documentElement.dataset.scene = m;
  R.setMode(m, instant);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => syncMode(false));
new MutationObserver(() => syncMode(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
document.getElementById('toggle-night')?.addEventListener('click', () => {
  userMode = (ctx.mode === 'night') ? 'day' : 'night';
  syncMode(false);
});

// ---- size ------------------------------------------------------------------
function fit() {
  const host = canvas.parentElement;
  const r = host.getBoundingClientRect();
  R.resize(Math.max(50, r.width), Math.max(50, r.height));
}
new ResizeObserver(fit).observe(canvas.parentElement);

// ---- drag to turn the diorama ------------------------------------------------
const baseAz = R.view.azimuth;
let drag = null, azVel = 0;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, az: R.view.azimuth }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const next = drag.az - (e.clientX - drag.x) * 0.008;
  azVel = next - R.view.azimuth;
  R.view.azimuth = next;
  R.updateCamera();
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', () => { R.view.azimuth = baseAz; azVel = 0; R.updateCamera(); });
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { R.view.azimuth += 0.15; R.updateCamera(); }
  if (e.key === 'ArrowRight') { R.view.azimuth -= 0.15; R.updateCamera(); }
});

// ---- loop ----------------------------------------------------------------------
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let paused = reduced && !isStatic;
const pauseBtn = document.getElementById('toggle-play');
function setPaused(p) {
  paused = p;
  if (pauseBtn) { pauseBtn.setAttribute('aria-pressed', String(!p)); pauseBtn.querySelector('span').textContent = p ? 'Play' : 'Pause'; }
}
pauseBtn?.addEventListener('click', () => setPaused(!paused));
setPaused(paused);

function frame(t, dt) {
  for (const p of parts) {
    try { p.update?.(t, ctx, dt); } catch (e) { if (!p.failed) { p.failed = true; console.error(`[${p.name}] update`, e); errors.push(`${p.name} update: ${e.message}`); showErrors(); } }
  }
  R.render(t, dt);
}

let simT = fixedT ?? 0, last = performance.now();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!drag && Math.abs(azVel) > 1e-4) { R.view.azimuth += azVel; azVel *= 0.9; R.updateCamera(); }
  if (!paused && !isStatic) simT = (simT + dt) % core.LOOP;
  frame(simT, isStatic ? 0 : dt);
  requestAnimationFrame(tick);
}

// For capture scripts: deterministic frame at time t (seconds).
window.__renderAt = (t) => { R.setMode(ctx.mode, true); frame(t, 0); return true; };
window.__setMode = (m) => { userMode = m; syncMode(true); };
window.__LOOP = core.LOOP;
// For agents/tests: draw calls + triangles of the last frame, and per-module object counts.
window.__info = () => {
  R.renderer.info.autoReset = false; R.renderer.info.reset(); frame(simT, 0);
  const i = R.renderer.info.render; R.renderer.info.autoReset = true;
  const counts = Object.fromEntries(parts.map((p) => { let n = 0; p.group?.traverse((o) => { if (o.isMesh) n++; }); return [p.name, n]; }));
  return { calls: i.calls, triangles: i.triangles, meshesPerModule: counts, lowRes: [R.state.lowW, R.state.lowH], errors };
};

syncMode(true);
fit();
await loadModules();
fit();
frame(simT, 0);
window.__ready = true;
document.documentElement.classList.add('ready');
if (!isStatic) requestAnimationFrame((n) => { last = n; tick(n); });
