// Builds the videos the home page scrubs with the scroll, from the frames in public/berg/<l|p>:
// climb.mp4 plays the whole climb forward, climb-rev.mp4 the same backward (a video cannot play in reverse).
// ffmpeg puts a motion-interpolated frame between every two, so the 261 frames become 521 at 60 per second
// and the climb stays smooth where it plays slowly. Landscape also gets a lighter 1080p pair (climb-1080).
// Needs ffmpeg on the PATH. Usage, from the repo root: node scripts/build-climb.mjs [l|p]   (takes a while)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// keep in step with src/scripts/frames.js
const COUNT = 261; // source frames; the first stretch has a frame between every two (000h ...)
const OUT = 2 * COUNT - 1;
const file = (i) =>
  i < 44 ? String(i >> 1).padStart(3, '0') + (i & 1 ? 'h' : '') : String(i - 22).padStart(3, '0');

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
  // a clean numbered sequence; the last frame three times, because the interpolation ends two frames early
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'climb-'));
  for (let n = 0; n < COUNT + 2; n++)
    fs.symlinkSync(
      path.join(src, file(Math.min(n, COUNT - 1)) + '.webp'),
      path.join(tmp, `${String(n).padStart(3, '0')}.webp`),
    );
  const double = `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none,trim=end_frame=${OUT},setpts=PTS-STARTPTS`;
  const wide = set === 'l';
  const graph = wide
    ? `[0:v]${double},split=3[f][f2][r0];[f2]scale=1920:1080[fs];[r0]reverse,split=2[r][r2];[r2]scale=1920:1080[rs]`
    : `[0:v]${double},split=2[f][r0];[r0]reverse[r]`;
  execFileSync(
    'ffmpeg',
    [
      ...[
        '-v',
        'error',
        '-y',
        '-framerate',
        '30',
        '-i',
        path.join(tmp, '%03d.webp'),
        '-filter_complex',
        graph,
      ],
      ...['-map', '[f]', ...enc(path.join(src, 'climb.mp4'))],
      ...['-map', '[r]', ...enc(path.join(src, 'climb-rev.mp4'))],
      ...(wide
        ? [
            ...['-map', '[fs]', ...enc(path.join(src, 'climb-1080.mp4'))],
            ...['-map', '[rs]', ...enc(path.join(src, 'climb-1080-rev.mp4'))],
          ]
        : []),
    ],
    { stdio: 'inherit' },
  );
  fs.rmSync(tmp, { recursive: true });
  console.log(set, 'done');
}
