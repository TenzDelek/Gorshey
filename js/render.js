// Pixel-art render pipeline.
// 1. The scene renders into a small render target (one texel = one art pixel), no MSAA.
// 2. A full-screen pass upscales it with nearest sampling, darkens depth edges a touch,
//    and quantises colour with a 4x4 ordered dither, so gradients break into pixel patterns.
import * as THREE from 'three';
import { U, LOOP } from './core.js';

const POST_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const POST_FS = /* glsl */`
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;          // low-res size in art pixels
  uniform vec3 uBg;           // background (sRGB)
  uniform float uEdge;        // depth-edge darkening 0..1
  uniform float uEdgeThresh;  // depth difference that counts as an edge (0..1 depth units)
  uniform float uLevels;      // colour levels per channel
  uniform float uDither;      // per-channel posterise dither amplitude in levels
  uniform float uBands;       // luma bands
  uniform float uBandDither;  // dither amplitude at the luma band snap only (low = flat faces stay one tone)
  uniform float uBandMix;     // 0 = off, 1 = full banding
  uniform float uCool;        // cool shift in shadows
  uniform float uWarm;        // warm shift in highlights
  varying vec2 vUv;

  float bayer4(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    int idx = i.x + i.y * 4;
    float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
    return (m[idx] + 0.5) / 16.0;
  }
  vec3 toSRGB(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float depthAt(vec2 px) { return texture2D(tDepth, (px + 0.5) / uRes).r; }

  void main() {
    vec2 px = floor(vUv * uRes);
    vec2 uv = (px + 0.5) / uRes;
    float d = depthAt(px);
    if (d >= 0.99999) { gl_FragColor = vec4(uBg, 1.0); return; }
    vec3 c = toSRGB(texture2D(tColor, uv).rgb);

    // Depth edges: a pixel on the near side of a depth jump gets darker.
    float dl = depthAt(px + vec2(-1, 0)), dr = depthAt(px + vec2(1, 0));
    float du = depthAt(px + vec2(0, 1)), dd = depthAt(px + vec2(0, -1));
    float far = max(max(dl, dr), max(du, dd));
    float onBg = step(0.99999, far);
    float jump = step(uEdgeThresh, far - d) * (1.0 - onBg);
    c *= 1.0 - uEdge * jump;

    float b = bayer4(px) - 0.5;

    // Banded value: snap luma to uBands steps, dithering each band boundary (toon ramp look).
    float L = max(dot(c, vec3(0.299, 0.587, 0.114)), 1e-4);
    float Lq = floor(L * uBands + 0.5 + b * uBandDither) / uBands;
    Lq = max(Lq, 0.5 / uBands);
    c *= mix(1.0, Lq / L, uBandMix);
    // Hue shift: darks go cool, highlights go warm.
    float Ls = dot(c, vec3(0.299, 0.587, 0.114));
    float cool = (1.0 - smoothstep(0.08, 0.5, Ls)) * uCool;
    c = mix(c, c * vec3(0.80, 0.92, 1.16), cool);
    float warm = smoothstep(0.62, 0.95, Ls) * uWarm;
    c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.9), warm);

    // Ordered-dither posterise per channel to tie colours together
    c = floor(c * uLevels + 0.5 + b * uDither) / uLevels;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export const MODES = {
  day: {
    bg: '#fbfbf8',
    hemiSky: 0xc9d8ee, hemiGround: 0x5d6640, hemi: 1.45,
    sun: 0xfff0d6, sunI: 2.9, sunPos: [3.2, 12, -4.4],
    ambient: 0xffffff, ambientI: 0.15,
  },
  night: {
    // neutral slate moonlight with a slight blue cast, so the fire's orange owns the colour
    bg: '#0e1220',
    hemiSky: 0x3a4256, hemiGround: 0x15181e, hemi: 0.55,
    sun: 0xa2aed0, sunI: 0.72, sunPos: [6, 12, -5],
    ambient: 0x2a2f3c, ambientI: 0.2,
  },
};

export function createRenderer(canvas, opts = {}) {
  // The scene renders into `rt` (which has its own depth); the canvas only receives the post pass.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); // we size the canvas in device pixels ourselves
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // post pass does the sRGB encode itself

  const scene = new THREE.Scene();
  const bgColor = new THREE.Color();

  // Camera: orthographic, classic diorama angle. azimuth/elevation in radians.
  // Fit model: the visible height is hView = max(height, fitW / aspect) / zoom, so landscape frames keep
  // `height` metres of scene vertically and square/portrait frames keep `fitW` metres horizontally.
  // shiftY moves the content DOWN on screen by that fraction of the frame (the tall tent makes the patch
  // read top-heavy); insets.bottom (CSS px, portrait only) centres the patch in the area above the caption.
  // `centred` (close-ups: ?zoom/?cx/?cz) turns both off.
  const view = {
    azimuth: Math.PI / 4, elevation: THREE.MathUtils.degToRad(33),
    height: opts.viewHeight ?? 12.6, fitW: opts.fitW ?? 15.2, zoom: 1, shiftY: 0.035,
    insets: { bottom: 0 }, centred: false,
    target: new THREE.Vector3(0, 0.55, 0.15),
  };
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const ambient = new THREE.AmbientLight(0xffffff, 0.1);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 0.5; sc.far = 40;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(hemi, ambient, sun, sun.target);

  // Low-res target with a depth texture
  const depthTex = new THREE.DepthTexture(1, 1);
  depthTex.type = THREE.FloatType;
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, depthTexture: depthTex, samples: 0,
  });
  depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;

  const post = new THREE.ShaderMaterial({
    vertexShader: POST_VS, fragmentShader: POST_FS,
    uniforms: {
      tColor: { value: rt.texture }, tDepth: { value: depthTex },
      uRes: { value: new THREE.Vector2(1, 1) }, uBg: { value: new THREE.Vector3(1, 1, 1) },
      uEdge: { value: opts.edge ?? 0.0 }, uEdgeThresh: { value: 0.012 },
      uLevels: { value: opts.levels ?? 24 }, uDither: { value: opts.dither ?? 0.7 },
      uBands: { value: opts.bands ?? 11 }, uBandMix: { value: opts.bandMix ?? 0.85 }, uBandDither: { value: opts.bandDither ?? 0.42 },
      uCool: { value: 0.55 }, uWarm: { value: 0.6 },
    },
    depthTest: false, depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const postMesh = new THREE.Mesh(tri, post);
  postMesh.frustumCulled = false;
  postScene.add(postMesh);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const state = { w: 1, h: 1, cssW: 1, cssH: 1, lowW: 1, lowH: 1, px: 3, rows: opts.rows ?? 380, mode: 'day', night: 0 };

  function resize(wCss, hCss, dpr = window.devicePixelRatio || 1) {
    const w = Math.max(2, Math.round(wCss * dpr)), h = Math.max(2, Math.round(hCss * dpr));
    state.w = w; state.h = h; state.cssW = wCss; state.cssH = hCss;
    // integer art-pixel size so every art pixel is the same size on screen (never 1:1, which reads as a render)
    state.px = Math.max(2, Math.round(Math.min(h, w * 0.9) / state.rows));
    state.lowW = Math.ceil(w / state.px); state.lowH = Math.ceil(h / state.px);
    renderer.setSize(w, h, false);
    canvas.style.width = wCss + 'px'; canvas.style.height = hCss + 'px';
    rt.setSize(state.lowW, state.lowH);
    post.uniforms.uRes.value.set(state.lowW, state.lowH);
    updateCamera();
  }

  const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _p = new THREE.Vector3();
  function updateCamera() {
    const aspect = state.lowW / state.lowH;
    const zoom = view.zoom > 0 ? view.zoom : 1;
    const hFit = Math.max(view.height, view.fitW / aspect);   // metres visible vertically at zoom 1
    const hView = hFit / zoom;
    const wView = hView * aspect;
    camera.left = -wView / 2; camera.right = wView / 2; camera.top = hView / 2; camera.bottom = -hView / 2;
    const r = 30;
    const ce = Math.cos(view.elevation);
    camera.position.set(
      view.target.x + r * ce * Math.sin(view.azimuth),
      view.target.y + r * Math.sin(view.elevation),
      view.target.z + r * ce * Math.cos(view.azimuth));
    camera.lookAt(view.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    _right.setFromMatrixColumn(camera.matrixWorld, 0);
    _up.setFromMatrixColumn(camera.matrixWorld, 1);
    const p = _p.copy(camera.position);
    // Framing offset along camera-up (raising the look point moves the content down on screen).
    // shiftY is a fraction of the frame height, capped at the square-frame height in portrait so it
    // stays a content-relative nudge there.
    if (!view.centred) {
      let off = view.shiftY * Math.min(hFit, view.fitW) / zoom;
      if (aspect < 0.8 && view.insets.bottom > 0) off -= 0.5 * (view.insets.bottom / state.cssH) * hView;
      p.addScaledVector(_up, off);
    }
    // Snap the camera to the art-pixel grid so static pixels never shimmer.
    const worldPerPx = hView / state.lowH;
    const sx = p.dot(_right), sy = p.dot(_up);
    p.addScaledVector(_right, Math.round(sx / worldPerPx) * worldPerPx - sx);
    p.addScaledVector(_up, Math.round(sy / worldPerPx) * worldPerPx - sy);
    camera.position.copy(p);
    camera.updateMatrixWorld();
    U.uArtPx.value = hFit / state.lowH;   // = hView * zoom / lowH: one art pixel in metres at zoom 1
  }

  // Insets (CSS px) of page chrome over the canvas; only `bottom` is used, and only in portrait.
  function setInsets({ bottom = 0 } = {}) {
    if (Math.abs(bottom - view.insets.bottom) < 0.5) return;
    view.insets.bottom = bottom;
    updateCamera();
  }

  // Call cb whenever devicePixelRatio changes (browser zoom, moving to another screen). Re-armed each time.
  function watchDpr(cb) {
    let mq = null;
    const on = () => { arm(); cb(); };
    const arm = () => {
      mq?.removeEventListener?.('change', on);
      try { mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); mq.addEventListener?.('change', on); } catch { mq = null; }
    };
    arm();
  }

  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  function applyLighting(night) {
    const D = MODES.day, N = MODES.night;
    const mix = (a, b) => tmpA.set(a).lerp(tmpB.set(b), night).getHex();
    hemi.color.setHex(mix(D.hemiSky, N.hemiSky));
    hemi.groundColor.setHex(mix(D.hemiGround, N.hemiGround));
    hemi.intensity = THREE.MathUtils.lerp(D.hemi, N.hemi, night);
    ambient.color.setHex(mix(D.ambient, N.ambient));
    ambient.intensity = THREE.MathUtils.lerp(D.ambientI, N.ambientI, night);
    sun.color.setHex(mix(D.sun, N.sun));
    sun.intensity = THREE.MathUtils.lerp(D.sunI, N.sunI, night);
    sun.position.set(...D.sunPos.map((v, i) => THREE.MathUtils.lerp(v, N.sunPos[i], night)));
    sun.target.position.set(0, 0, 0);
    bgColor.set(D.bg).lerp(tmpB.set(N.bg), night);
    const s = bgColor.clone().convertLinearToSRGB(); // Color works in linear; the post pass outputs sRGB
    post.uniforms.uBg.value.set(s.r, s.g, s.b);
    renderer.setClearColor(0x000000, 1);
    post.uniforms.uCool.value = THREE.MathUtils.lerp(0.55, 0.30, night);   // less blue push in night shadows
    U.uNight.value = night;
  }

  function setMode(mode, instant = false) {
    state.mode = mode;
    if (instant) { state.night = mode === 'night' ? 1 : 0; applyLighting(state.night); }
  }

  function render(t, dt = 0) {
    U.uTime.value = ((t % LOOP) + LOOP) % LOOP;
    const goal = state.mode === 'night' ? 1 : 0;
    if (state.night !== goal) {
      state.night = dt > 0 ? THREE.MathUtils.clamp(state.night + Math.sign(goal - state.night) * dt * 1.6, 0, 1) : goal;
      applyLighting(state.night);
    }
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  applyLighting(0);
  return { renderer, scene, camera, view, sun, hemi, ambient, state, post, resize, updateCamera, setInsets, watchDpr, setMode, render, applyLighting };
}
