// Adds a frame between every two of the first stretch of the climb (frames 000 to 022), with RIFE.
// Run after double-frames.mjs. Usage, from the repo root:
//   node scripts/first-stretch-frames.mjs <rife-ncnn-vulkan dir> <work dir>
// Writes public/berg/<l|p>/000h.webp to 021h.webp; the numbered frames stay as they are.
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [rifeArg, workArg] = process.argv.slice(2);
if (!rifeArg || !workArg) throw new Error('usage: first-stretch-frames.mjs <rife dir> <work dir>');
const rifeDir = path.resolve(rifeArg);
const exe = path.join(
  rifeDir,
  process.platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan',
);
const model = path.join(rifeDir, 'rife-v4.6');
for (const p of [exe, model]) if (!fs.existsSync(p)) throw new Error(`missing ${p}`);

const LAST = 22; // the frame of the first stop, see AT in src/scripts/frames.js
const n3 = (i) => String(i).padStart(3, '0');
for (const set of ['l', 'p']) {
  const src = path.resolve('public', 'berg', set);
  const work = path.join(path.resolve(workArg), set, 'first');
  fs.mkdirSync(work, { recursive: true });
  for (let i = 0; i <= LAST; i++)
    await sharp(path.join(src, `${n3(i)}.webp`))
      .png()
      .toFile(path.join(work, `${n3(i)}.png`));
  for (let i = 0; i < LAST; i++) {
    const mid = path.join(work, `${n3(i)}h.png`);
    execFileSync(
      exe,
      [
        '-0',
        path.join(work, `${n3(i)}.png`),
        '-1',
        path.join(work, `${n3(i + 1)}.png`),
        '-o',
        mid,
        '-m',
        model,
      ],
      { stdio: 'ignore' },
    );
    await sharp(mid)
      .webp({ quality: 80 })
      .toFile(path.join(src, `${n3(i)}h.webp`));
  }
  const made = fs.readdirSync(src).filter((f) => /^\d{3}h\.webp$/.test(f)).length;
  if (made !== LAST) throw new Error(`${src}: expected ${LAST} in-between frames, found ${made}`);
  console.log(set, 'done', made);
}
