// Renders one seamless loop of the diorama to MP4.
// node tools/capture.mjs [--size 1080] [--fps 30] [--mode day|night] [--out gorshey-day.mp4] [--seconds 24]
// Frames are rendered deterministically with window.__renderAt(t), so the loop is exact.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? '1' : arr[i + 1]]] : a), []));
const size = +(args.size ?? 1080);
const fps = +(args.fps ?? 30);
const mode = args.mode ?? 'day';
const out = path.resolve(args.out ?? `gorshey-${mode}.mp4`);
const base = args.base ?? 'http://localhost:8787/index.html';
const extra = args.q ? '&' + args.q : '';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`${base}?static=1&t=0&clean=1&mode=${mode}${extra}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const loop = await page.evaluate(() => window.__LOOP);
const seconds = +(args.seconds ?? loop);
const n = Math.round(seconds * fps);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gorshey-frames-'));
const canvas = await page.$('#scene');
console.log(`rendering ${n} frames (${seconds}s @ ${fps}fps, ${mode}) → ${dir}`);
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.__renderAt(t), (i / fps) % loop);
  await canvas.screenshot({ path: path.join(dir, `${String(i).padStart(5, '0')}.png`) });
  if (i % 60 === 0) process.stdout.write(`  ${i}/${n}\n`);
}
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%05d.png'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
fs.rmSync(dir, { recursive: true, force: true });
console.log('wrote', out);
