// Headless screenshots of the diorama at fixed times.
// node tools/shot.mjs --q "only=fire&mode=night" --t 0,6,12 --out /path/prefix [--w 1200 --h 900] [--dpr 3] [--crop x,y,w,h]
//   [--info 1]   print window.__info() (draw calls, triangles, meshes per module)
//   [--bbox 1]   measure the bounding box of non-background pixels (overlay hidden while measuring) and
//                print it in CSS px and as fractions of the viewport, with the caption/controls rects
//   [--sample x,y[;x,y...]]  print the sRGB colour of these CSS-px points (overlay hidden)
//   [--scale k]  nearest-neighbour upscale the saved image k× (handy with --crop)
// Writes <prefix>-t<time>.png for each time and prints console errors from the page.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? '1' : arr[i + 1]]] : a), []));
const base = args.base ?? 'http://localhost:8787/index.html';
const q = args.q ?? '';
const times = (args.t ?? '3').split(',').map(Number);
const out = args.out ?? 'shot';
const w = +(args.w ?? 1200), h = +(args.h ?? 900);
const dpr = +(args.dpr ?? 1);

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const exe = CHROME.find((p) => fs.existsSync(p));
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const url = `${base}?static=1&t=${times[0]}${q ? '&' + q : ''}`;
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
} catch {
  logs.push('[timeout] window.__ready never became true');
}
await page.evaluate(() => document.fonts?.ready);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

// Decode a PNG (as base64) in the page and measure it there (no image libraries needed in node).
async function measure(buf, samples) {
  return page.evaluate(async ({ b64, samples, dpr }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const { data, width: W, height: H } = g.getImageData(0, 0, cv.width, cv.height);
    const bg = [data[0], data[1], data[2]];
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > 10) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const hex = (i) => '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    const pts = (samples ?? []).map(([sx, sy]) => [sx, sy, hex((Math.round(sy * dpr) * W + Math.round(sx * dpr)) * 4)]);
    const vw = W / dpr, vh = H / dpr;
    if (x1 < 0) return { empty: true, bg: hex(0), samples: pts };
    const b = { x: x0 / dpr, y: y0 / dpr, w: (x1 - x0 + 1) / dpr, h: (y1 - y0 + 1) / dpr };
    const f = (v) => +(v * 100).toFixed(1);
    return {
      bg: hex(0),
      bboxCss: [b.x, b.y, b.w, b.h].map((v) => +v.toFixed(1)),
      pct: { left: f(b.x / vw), right: f(1 - (b.x + b.w) / vw), top: f(b.y / vh), bottom: f(1 - (b.y + b.h) / vh), width: f(b.w / vw), height: f(b.h / vh), centreX: f((b.x + b.w / 2) / vw - 0.5) },
      samples: pts,
    };
  }, { b64: buf.toString('base64'), samples, dpr });
}
const samples = args.sample ? args.sample.split(';').map((s) => s.split(',').map(Number)) : null;

for (const t of times) {
  await page.evaluate((tt) => window.__renderAt?.(tt), t);
  await page.waitForTimeout(60);
  const file = `${out}-t${String(t).replace('.', '_')}.png`;
  const opts = { path: file };
  if (args.crop) { const [x, y, cw, ch] = args.crop.split(',').map(Number); opts.clip = { x, y, width: cw, height: ch }; }
  if (args.scale && +args.scale > 1) {
    // nearest-neighbour upscale (for inspecting crops pixel by pixel)
    const buf = await page.screenshot({ ...opts, path: undefined });
    const b64 = await page.evaluate(async ({ b64, k }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.naturalWidth * k; cv.height = img.naturalHeight * k;
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png').split(',')[1];
    }, { b64: buf.toString('base64'), k: Math.round(+args.scale) });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  } else await page.screenshot(opts);
  console.log('wrote', file);
  if (args.bbox || samples) {
    const rects = await page.evaluate(() => {
      const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
      return { caption: rect('.caption'), controls: rect('.controls'), overlay: rect('.overlay') };
    });
    await page.evaluate(() => document.documentElement.classList.add('clean'));
    await page.waitForTimeout(30);
    const buf = await page.screenshot();
    console.log('BBOX', JSON.stringify({ ...(await measure(buf, samples)), ...rects }));
    await page.evaluate(() => document.documentElement.classList.remove('clean'));
  }
}
if (args.info) console.log('INFO', JSON.stringify(await page.evaluate(() => window.__info?.())));
if (logs.length) console.log('PAGE LOGS:\n' + logs.join('\n'));
else console.log('no page errors');
await browser.close();
