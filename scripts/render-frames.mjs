// Renders the stills the home page plays, from the live 3D scene at /berg-3d/.
// Usage: start `npm run dev` in one terminal, then `npm run frames` in another.
// Writes public/berg/l (landscape) and public/berg/p (portrait), COUNT frames each.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4321/berg-3d/';
const COUNT = 120; // keep in sync with src/scripts/frames.js
const SETS = {
  l: { width: 1600, height: 900 },
  // wider than 760px so the scene renders at full quality, still a phone shape
  p: { width: 770, height: 1668 },
};

// software WebGL: slower, but the same image on every machine
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
for (const [name, viewport] of Object.entries(SETS)) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
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
    await page.waitForTimeout(2500);
    const png = await page.screenshot({ clip: { x: 0, y: 0, ...viewport } });
    const webp = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.7));
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
