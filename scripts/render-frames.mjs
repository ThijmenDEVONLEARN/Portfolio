// Renders the stills the home page plays, from the live 3D scene at /berg-3d/.
// Usage: start `npm run dev` in one terminal, then `npm run frames` in another
// (or `npm run frames -- http://localhost:4322` for another server).
// Writes public/berg/l (landscape) and public/berg/p (portrait), COUNT frames each.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = `${process.argv[2] || 'http://localhost:4321'}/berg-3d/?hq`;
const COUNT = 120; // keep in sync with src/scripts/frames.js
// CSS size at 2x: 2560x1440 landscape, 1080x2340 portrait (sharp on retina screens and phones)
const SETS = {
  l: { width: 1280, height: 720 },
  p: { width: 540, height: 1170 },
};

// software WebGL: slower, but the same image on every machine
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
for (const [name, viewport] of Object.entries(SETS)) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  await page.goto(URL);
  await page.waitForFunction(() => document.documentElement.classList.contains('gl-on'), null, {
    timeout: 60000,
  });
  // only the scene: no text, no snapping, no fade
  await page.addStyleTag({
    content:
      ':root{scroll-snap-type:none!important}.stage > :not(#gl){display:none!important}#gl{transition:none!important}',
  });
  const run = await page.evaluate(
    () => document.getElementById('track').offsetHeight - innerHeight,
  );
  const dir = `public/berg/${name}`;
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < COUNT; i++) {
    await page.evaluate((y) => scrollTo(0, y), (i / (COUNT - 1)) * run);
    // the camera eases onto the scroll position; give it time to settle and draw sharp
    await page.waitForTimeout(3000);
    const png = await page.screenshot({ clip: { x: 0, y: 0, ...viewport } });
    const webp = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    }, png.toString('base64'));
    writeFileSync(`${dir}/${String(i).padStart(3, '0')}.webp`, Buffer.from(webp, 'base64'));
    process.stdout.write(`\r${name} ${i + 1}/${COUNT}`);
  }
  process.stdout.write('\n');
  await page.close();
}
await browser.close();
