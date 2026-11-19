// Doubles the 120 Blender frames in public/berg/<set> to 239 with RIFE frame interpolation.
// Usage, from the repo root: node scripts/double-frames.mjs <rife-ncnn-vulkan dir> <l|p> <work dir> [--dry]
// Original frame i lands at 2i (bytes unchanged, so the poster stays), the RIFE middle of i and i+1 at 2i+1.
// --dry converts two frames and prints the rife command and mapping without running rife or touching public/.
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const [rifeArg, set, workArg] = args.filter((a) => a !== '--dry');
if (!['l', 'p'].includes(set)) throw new Error(`set must be l or p, got ${set}`);
const rifeDir = path.resolve(rifeArg);
const work = path.resolve(workArg);

const exe = path.join(
  rifeDir,
  process.platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan',
);
const model = path.join(rifeDir, 'rife-v4.6');
const src = path.resolve('public', 'berg', set);
const png = path.join(work, set, 'png');
const out = path.join(work, set, 'out');
for (const p of [exe, model, src]) if (!fs.existsSync(p)) throw new Error(`missing ${p}`);
fs.mkdirSync(png, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const n3 = (i) => String(i).padStart(3, '0');
const N = fs.readdirSync(src).filter((f) => /^\d{3}\.webp$/.test(f)).length;
if (N !== 120) throw new Error(`expected the 120 Blender frames in ${src}, found ${N}`);
const todo = dry ? 2 : N;

for (let i = 0; i < todo; i++) {
  await sharp(path.join(src, `${n3(i)}.webp`))
    .png()
    .toFile(path.join(png, `${n3(i)}.png`));
  fs.copyFileSync(path.join(src, `${n3(i)}.webp`), path.join(out, `${n3(2 * i)}.webp`));
}
for (let i = 0; i < todo - 1; i++) {
  const mid = path.join(png, `mid${n3(i)}.png`);
  const cmd = [
    '-0',
    path.join(png, `${n3(i)}.png`),
    '-1',
    path.join(png, `${n3(i + 1)}.png`),
    '-o',
    mid,
    '-m',
    model,
  ];
  if (dry) {
    console.log('would run:', exe, cmd.join(' '));
    console.log(
      `mapping: ${n3(i)} -> ${n3(2 * i)}, middle -> ${n3(2 * i + 1)}, ${n3(i + 1)} -> ${n3(2 * i + 2)}`,
    );
    continue;
  }
  execFileSync(exe, cmd, { stdio: 'ignore' });
  await sharp(mid)
    .webp({ quality: 80 })
    .toFile(path.join(out, `${n3(2 * i + 1)}.webp`));
  if (i % 20 === 0) console.log(set, i);
}
if (dry) process.exit(0);

const files = fs
  .readdirSync(out)
  .filter((f) => f.endsWith('.webp'))
  .sort();
if (files.length !== 2 * N - 1 || files.at(-1) !== `${n3(2 * N - 2)}.webp`)
  throw new Error(`${out} is not 000..238`);
for (let i = 0; i < N; i++)
  if (
    !fs
      .readFileSync(path.join(out, `${n3(2 * i)}.webp`))
      .equals(fs.readFileSync(path.join(src, `${n3(i)}.webp`)))
  )
    throw new Error(`frame ${n3(2 * i)} does not match source ${n3(i)}`);

// checks passed: replace the 120 frames with the 239
for (const f of fs.readdirSync(src)) if (f.endsWith('.webp')) fs.rmSync(path.join(src, f));
for (const f of files) fs.copyFileSync(path.join(out, f), path.join(src, f));
console.log(set, 'done', files.length);
