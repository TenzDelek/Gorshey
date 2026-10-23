// Compare two PNGs pixel by pixel (decoded in headless Chrome, no image libraries needed).
// node tools/imgdiff.mjs a.png b.png   → prints the number of differing pixels and their bounding box.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [a, b] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage();
const r = await page.evaluate(async ([A, B]) => {
  const load = async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
  const p = await load(A), q = await load(B);
  if (p.width !== q.width || p.height !== q.height) return { sizeMismatch: [p.width, p.height, q.width, q.height] };
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, maxD = 0;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const i = (y * p.width + x) * 4;
    const d = Math.max(Math.abs(p.data[i] - q.data[i]), Math.abs(p.data[i + 1] - q.data[i + 1]), Math.abs(p.data[i + 2] - q.data[i + 2]));
    if (d) { n++; maxD = Math.max(maxD, d); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { differing: n, maxDelta: maxD, bbox: n ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null };
}, [fs.readFileSync(a).toString('base64'), fs.readFileSync(b).toString('base64')]);
console.log(JSON.stringify(r));
await browser.close();
process.exit(r.differing ? 1 : 0);
