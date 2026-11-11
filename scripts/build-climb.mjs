// Builds the videos the home page scrubs with the scroll, from the frames in public/berg/<l|p>:
// climb.mp4 plays the whole climb forward, climb-rev.mp4 the same backward (a video cannot play in reverse).
// ffmpeg adds motion-interpolated frames: one between every two in the middle, three at the start and the
// end. Those two stretches are meant to pass slowly, and with the slowness in the file the page never has
// to play the video slower than its own pace, which is what stutters. 660 frames at 60 per second: the
// interpolation puts one lead-in frame before the first real one, so the climb itself runs from frame 1.
// Landscape also gets a lighter 1080p pair (climb-1080).
// Needs ffmpeg on the PATH. Usage, from the repo root: node scripts/build-climb.mjs [l|p]   (takes a while)
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// keep in step with src/scripts/frames.js
const COUNT = 261; // source frames; the first stretch has a frame between every two (000h ...)
// [first source frame, last source frame, frames per source step]: start, middle, end
const PARTS = [
  [0, 44, 4],
  [44, 235, 2],
  [235, 260, 4],
];
const file = (i) =>
  i < 44 ? String(i >> 1).padStart(3, '0') + (i & 1 ? 'h' : '') : String(i - 22).padStart(3, '0');
const run = promisify(execFile);
const MCI = 'mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none';

const enc = (name) => [
  ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p'],
  ...[
    '-g',
    '30',
    '-keyint_min',
    '30',
    '-sc_threshold',
    '0',
    '-movflags',
    '+faststart',
    '-an',
    name,
  ],
];
for (const set of process.argv[2] ? [process.argv[2]] : ['l', 'p']) {
  const src = path.resolve('public', 'berg', set);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'climb-'));
  // each part on its own, near lossless, the three side by side
  const parts = await Promise.all(
    PARTS.map(async ([a, b, per], n) => {
      const dir = path.join(tmp, String(n));
      fs.mkdirSync(dir);
      // two frames past the end, because the interpolation stops early; at the very end the last one again
      for (let i = a; i <= b + 2; i++)
        fs.symlinkSync(
          path.join(src, file(Math.min(i, COUNT - 1)) + '.webp'),
          path.join(dir, `${String(i - a).padStart(3, '0')}.webp`),
        );
      // the last part keeps its final frame, the others leave it to the part that follows
      const frames = (b - a) * per + (n === PARTS.length - 1 ? 1 : 0);
      const out = path.join(tmp, `${n}.mp4`);
      await run('ffmpeg', [
        ...['-v', 'error', '-y', '-framerate', '30', '-i', path.join(dir, '%03d.webp')],
        // every interpolated frame is kept and simply counted as one step at 60 per second
        ...[
          '-vf',
          `minterpolate=fps=${30 * per}:${MCI},setpts=N/60/TB`,
          '-frames:v',
          String(frames),
        ],
        ...['-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '6'],
        ...['-pix_fmt', 'yuv420p', '-an', out],
      ]);
      return out;
    }),
  );
  const wide = set === 'l';
  const join = `[0:v][1:v][2:v]concat=n=3:v=1,setpts=N/60/TB`;
  const graph = wide
    ? `${join},split=3[f][f2][r0];[f2]scale=1920:1080[fs];[r0]reverse,split=2[r][r2];[r2]scale=1920:1080[rs]`
    : `${join},split=2[f][r0];[r0]reverse[r]`;
  execFileSync(
    'ffmpeg',
    [
      ...['-v', 'error', '-y', ...parts.flatMap((p) => ['-i', p]), '-filter_complex', graph],
      ...['-map', '[f]', '-r', '60', ...enc(path.join(src, 'climb.mp4'))],
      ...['-map', '[r]', '-r', '60', ...enc(path.join(src, 'climb-rev.mp4'))],
      ...(wide
        ? [
            ...['-map', '[fs]', '-r', '60', ...enc(path.join(src, 'climb-1080.mp4'))],
            ...['-map', '[rs]', '-r', '60', ...enc(path.join(src, 'climb-1080-rev.mp4'))],
          ]
        : []),
    ],
    { stdio: 'inherit' },
  );
  fs.rmSync(tmp, { recursive: true });
  console.log(set, 'done');
}
