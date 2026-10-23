// Headless screenshots of the diorama at fixed times.
// node tools/shot.mjs --q "only=fire&mode=night" --t 0,6,12 --out /path/prefix [--w 1200 --h 900] [--crop x,y,w,h]
// Writes <prefix>-t<time>.png for each time and prints console errors from the page.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? '1' : arr[i + 1]]] : a), []));
const base = args.base ?? 'http://localhost:8787/gorshey/index.html';
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
for (const t of times) {
  await page.evaluate((tt) => window.__renderAt?.(tt), t);
  await page.waitForTimeout(60);
  const file = `${out}-t${String(t).replace('.', '_')}.png`;
  const opts = { path: file };
  if (args.crop) { const [x, y, cw, ch] = args.crop.split(',').map(Number); opts.clip = { x, y, width: cw, height: ch }; }
  await page.screenshot(opts);
  console.log('wrote', file);
}
if (args.info) console.log('INFO', JSON.stringify(await page.evaluate(() => window.__info?.())));
if (logs.length) console.log('PAGE LOGS:\n' + logs.join('\n'));
else console.log('no page errors');
await browser.close();
