# Gorshey · སྒོར་གཞས།

A tiny animated pixel-art diorama of an imagined summer gathering on the Tibetan grassland. **Gorshey**
(སྒོར་གཞས།) is a sung circle dance: the dancers form one ring and step around it while they sing, and each
song has its own steps. Here twelve men, women, elders and children in chuba dance around a campfire at an
evening lingka (a summer picnic); beside the ring a neighbour strums the dranyen on a khaden rug while a
grandmother turns her prayer wheel, a white picnic tent and lungta prayer flags stand behind, a yak grazes
and a mastiff keeps watch. The scene is a composite of a lingka picnic and a fireside gorshey: the fire and
the lute belong to the evening, not to the dance, which is just as often danced in daylight around a jug of
chang or to a speaker. Light theme is a golden afternoon; dark theme is a firelit night. Drag to turn the diorama.

**Live:** https://tenzdelek.github.io/Gorshey/

Style inspired by [shawn (@zzzzshawn)](https://x.com/zzzzshawn)'s *Small plays* series. Built with Claude Code.

## How it works

- `gorshey/js/render.js` renders the three.js scene into a low-resolution target (one texel = one art pixel),
  then upscales it with nearest sampling, banding the luma with a 4×4 ordered dither and shifting darks cool
  and highlights warm. The camera fits the patch to ~87 % of the frame width on square and portrait screens.
- The meadow base dissolves into the page with Bayer-dithered discards; grass is ~60k one-pixel blades.
- Every motion is a pure, integer-periodic function of time, so the 48 s loop (one full turn of the circle)
  is seamless.
- Modules: `ground` (meadow, grass, flowers), `fire` (pit, flames, sparks, smoke, firelight), `dancers`
  (rig, footstep planner, choreography), `camp` (tent, prayer flags, mani stones, sangbum, woodpile),
  `life` (musician, grandmother, girl, tea table, yak, dog). Shared helpers live in `core.js`.
- The circle's direction is one constant: `DIR` in `gorshey/js/dancers.js` (1 = clockwise from above).

## Run locally

```bash
python3 -m http.server 8787
# open http://localhost:8787/gorshey/
```

Useful query options: `?mode=night`, `?only=ground,fire`, `?t=12&static=1`, `?zoom=3&cx=0&cz=2`, `?az=135`.

## Screenshots and video

```bash
npm install                       # playwright-core, drives your installed Google Chrome
node tools/shot.mjs --t 0,12 --out shots/frame --w 1080 --h 1080
node tools/capture.mjs --mode day --out gorshey-day.mp4      # one seamless 48 s loop, needs ffmpeg
node tools/capture.mjs --mode night --out gorshey-night.mp4
node tools/motion-probe.mjs --report-only                    # foot / hip / arm checks for the dancers
```

## Cultural notes

`ref/gorshey-culture.json` and `ref/gorshey-culture-review.md` hold the research behind costumes, setting and
movement (chuba wrapped left over right, men's chuba at the knee with the right arm out, women's sleeveless
chuba over long-sleeved blouses, pangden, lungta order blue-white-red-green-yellow). The scene is a composite
of a lingka picnic and an evening bonfire; the step pattern is a stylised approximation, since every gorshey
song has its own steps.
