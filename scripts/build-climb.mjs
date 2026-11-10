// Builds the two videos the home page scrubs with the scroll, from the frames in public/berg/<l|p>:
// climb.mp4 plays the whole climb forward, climb-rev.mp4 the same backward (a video cannot play in reverse).
// Every frame is one step at 30 fps, and a keyframe every 24 frames keeps the jump between the two cheap.
// Needs ffmpeg on the PATH. Usage, from the repo root: node scripts/build-climb.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// keep in step with src/scripts/frames.js: 261 frames, the first stretch with a frame between every two
const COUNT = 261;
const FPS = 30;
export const file = (i) =>
  i < 44 ? String(i >> 1).padStart(3, '0') + (i & 1 ? 'h' : '') : String(i - 22).padStart(3, '0');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'climb-'));
for (const set of ['l', 'p']) {
  const src = path.resolve('public', 'berg', set);
  for (const [name, order] of [
    ['climb', [...Array(COUNT).keys()]],
    ['climb-rev', [...Array(COUNT).keys()].reverse()],
  ]) {
    const list = path.join(tmp, `${set}-${name}.txt`);
    fs.writeFileSync(
      list,
      order
        .map((i) => `file '${path.join(src, file(i) + '.webp')}'\nduration ${1 / FPS}`)
        .join('\n') + '\n',
    );
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-r', String(FPS), '-an'],
      ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p'],
      ...['-g', '24', '-keyint_min', '24', '-sc_threshold', '0'],
      ...['-movflags', '+faststart', path.join(src, `${name}.mp4`)],
    ]);
    console.log(set, name, order.length, 'frames');
  }
}
fs.rmSync(tmp, { recursive: true });
