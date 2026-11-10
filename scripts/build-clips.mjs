// Builds the short clips the home page plays between two stops of the climb, from the frames in
// public/berg/<l|p>. One clip per stretch and direction, with the ease in and out baked into its timing.
// Needs ffmpeg on the PATH. Usage, from the repo root: node scripts/build-clips.mjs
// Writes public/berg/<l|p>/clips/<from>-<to>.mp4 (H.264), stops numbered 0 to 5.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// keep in step with src/scripts/frames.js
const STOPS = [0, 0.0924, 0.2773, 0.4622, 0.6555, 1];
const AT = [0, 44, 88, 132, 178, 260];
const FPS = 60;
const file = (i) =>
  i < 44 ? String(i >> 1).padStart(3, '0') + (i & 1 ? 'h' : '') : String(i - 22).padStart(3, '0');
// seconds: a short hop still glides, the long last stretch takes a little longer
export const seconds = (a, b) => 0.75 + 1.4 * Math.abs(STOPS[b] - STOPS[a]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));
for (const set of ['l', 'p']) {
  const src = path.resolve('public', 'berg', set);
  const out = path.join(src, 'clips');
  fs.mkdirSync(out, { recursive: true });
  for (let a = 0; a < AT.length; a++)
    for (const b of [a + 1, a - 1]) {
      if (b < 0 || b >= AT.length) continue;
      const n = Math.round(seconds(a, b) * FPS);
      const lines = [];
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const e = u * u * (3 - 2 * u);
        const f = Math.round(AT[a] + e * (AT[b] - AT[a]));
        lines.push(`file '${path.join(src, file(f) + '.webp')}'`, `duration ${1 / FPS}`);
      }
      const list = path.join(tmp, `${set}-${a}-${b}.txt`);
      fs.writeFileSync(list, lines.join('\n') + '\n');
      const input = [
        '-v',
        'error',
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-r',
        String(FPS),
        '-an',
      ];
      const name = path.join(out, `${a}-${b}`);
      // the frames' own size, so a glide is as sharp as the still it lands on
      execFileSync('ffmpeg', [
        ...input,
        ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p'],
        ...['-movflags', '+faststart', `${name}.mp4`],
      ]);
      console.log(set, `${a}-${b}`, n, 'frames');
    }
}
fs.rmSync(tmp, { recursive: true });
