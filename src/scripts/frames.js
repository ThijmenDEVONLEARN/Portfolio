// The climb as a sequence of stills rendered from the live 3D scene (/berg-3d/).
// Scroll picks the frame; the frames sit close enough together that each one is shown whole.
import { reduce, root, setStep, showHint, prog, stepAt } from './climb.js';

// the scroll stops in index.astro, as climb progress, and the frame each one rests on
const STOPS = [0, 0.0924, 0.2773, 0.4622, 0.6555, 1];
const AT = [0, 44, 88, 132, 178, 260];
const COUNT = 261;
// The first stretch is short, so it has a frame between every two (000h between 000 and 001):
// frames 0 to 44 are 000, 000h, 001 ... 022, and from there frame i is file i - 22.
const file = (i) =>
  i < 44 ? String(i >> 1).padStart(3, '0') + (i & 1 ? 'h' : '') : String(i - 22).padStart(3, '0');
// the frame at a climb progress: even steps between the two stops around it
const frameAt = (k) => {
  let j = 1;
  while (j < STOPS.length - 1 && k > STOPS[j]) j++;
  const u = (k - STOPS[j - 1]) / (STOPS[j] - STOPS[j - 1]);
  return Math.round(AT[j - 1] + Math.max(0, Math.min(1, u)) * (AT[j] - AT[j - 1]));
};
const cv = document.getElementById('seq');
const cx = cv.getContext('2d');
const stage = cv.parentElement;
const portrait = matchMedia('(orientation: portrait)');
const sets = { l: [], p: [] };
let set = portrait.matches ? 'p' : 'l';

// stops first, then the whole first stretch, then ever finer passes over the rest,
// so the first scroll is smooth early and scrubbing works before every frame is in
const order = [];
const add = (i) => !order.includes(i) && order.push(i);
AT.forEach(add);
for (let i = 0; i <= AT[1]; i++) add(i);
for (let step = 16; step >= 1; step /= 2) for (let i = 0; i < COUNT; i += step) add(i);

const loading = { l: false, p: false };
function load(s) {
  if (loading[s]) return;
  loading[s] = true;
  const queue = [...order];
  const next = () => {
    const i = queue.shift();
    if (i === undefined) return;
    const img = new Image();
    img.src = `/berg/${s}/${file(i)}.webp`;
    img
      .decode()
      .then(() => {
        sets[s][i] = img;
        if (s === set) {
          dirty = true;
          req();
          warmSoon();
        }
      })
      .catch(() => {})
      .finally(next);
  };
  for (let n = 0; n < 6; n++) next();
}

const nearest = (list, i) => {
  for (let d = 0; d < COUNT; d++) {
    if (list[i - d]) return list[i - d];
    if (list[i + d]) return list[i + d];
  }
  return null;
};

// draw like object-fit: cover, centred, so it lines up with the poster underneath
const cover = (img) => {
  // an image has natural sizes, a decoded bitmap plain ones
  const iw = img.naturalWidth || img.width,
    ih = img.naturalHeight || img.height;
  const s = Math.max(cv.width / iw, cv.height / ih);
  const w = iw * s,
    h = ih * s;
  cx.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
};

let k = 0,
  shown = -1,
  dirty = true;

// Drawing an image decodes it again on every draw, far too slow for a glide. So while the climb rests,
// the frames up to the stops on either side are decoded once into bitmaps, and a glide draws those.
const bmp = new Map();
const weak =
  matchMedia('(max-width: 760px)').matches ||
  (navigator.hardwareConcurrency || 8) <= 4 ||
  (navigator.deviceMemory || 8) <= 4;
// pixels per bitmap: up to 128 of them are held at once, so this caps the memory
const BMP_PIXELS = weak ? 0.7e6 : 1.6e6;
let gen = 0,
  pending = [],
  busy = 0,
  warmTimer = 0;
const dropBitmaps = () => {
  gen++;
  bmp.forEach((b) => b.close());
  bmp.clear();
  pending = [];
};
function pump() {
  while (busy < 3 && pending.length) {
    const i = pending.shift();
    const img = sets[set][i];
    if (!img || bmp.has(i)) continue;
    const g = gen;
    const s = Math.min(
      1,
      Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight),
      Math.sqrt(BMP_PIXELS / (img.naturalWidth * img.naturalHeight)),
    );
    busy++;
    // from the cached file rather than the image, so the decoding happens off the main thread
    fetch(img.src)
      .then((r) => r.blob())
      .then((blob) =>
        createImageBitmap(blob, {
          resizeWidth: Math.round(img.naturalWidth * s),
          resizeHeight: Math.round(img.naturalHeight * s),
          resizeQuality: 'medium',
        }),
      )
      .then((b) => (g === gen && !bmp.has(i) ? bmp.set(i, b) : b.close()))
      .catch(() => {})
      .finally(() => {
        busy--;
        pump();
      });
  }
}
function warm() {
  if (!window.createImageBitmap || chained) return;
  const f = frameAt(k);
  const lo = Math.max(0, ...AT.filter((s) => s < f));
  const hi = Math.min(COUNT - 1, ...AT.filter((s) => s > f));
  bmp.forEach((b, i) => {
    if (i < lo || i > hi) {
      b.close();
      bmp.delete(i);
    }
  });
  // nearest first: a glide starts slowly, so those are needed soonest
  pending = [];
  for (let d = 1; f - d >= lo || f + d <= hi; d++) {
    if (f + d <= hi) pending.push(f + d);
    if (f - d >= lo) pending.push(f - d);
  }
  pump();
}
const warmSoon = () => {
  warmTimer ||= setTimeout(() => {
    warmTimer = 0;
    warm();
  }, 250);
};
// while gliding: the decoded frame, or a decoded neighbour, rather than a slow image
const moving = (f) => {
  for (let d = 0; d <= 3; d++) {
    const b = bmp.get(f - d) || bmp.get(f + d);
    if (b) return b;
  }
  return null;
};
// one whole frame at a time: blending two frames shows double edges, which reads as blur
function draw() {
  const f = frameAt(k);
  if (!dirty && f === shown) return;
  const img = (chained && moving(f)) || sets[set][f] || nearest(sets[set], f);
  if (!img) return;
  cover(img);
  shown = f;
  dirty = false;
  root.classList.add('gl-on');
}

const size = () => {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(stage.clientWidth * dpr);
  cv.height = Math.round(stage.clientHeight * dpr);
  dirty = true;
  dropBitmaps();
  warmSoon();
};

// each new scroll position starts a glide that eases in and out, carrying over the speed of a glide
// already under way, so the climb never jerks to a stop; it runs on the clock, so dropped frames skip ahead
let queued = false,
  chained = false,
  inView = true;
let from = 0,
  v0 = 0,
  to = 0,
  t0 = 0,
  T = 1;
// a cubic from (from, v0) to (to, 0): position and speed at u in 0..1
const at = (u) => [
  (2 * u ** 3 - 3 * u ** 2 + 1) * from +
    (u ** 3 - 2 * u ** 2 + u) * v0 * T +
    (3 * u ** 2 - 2 * u ** 3) * to,
  ((6 * u ** 2 - 6 * u) * from + (3 * u ** 2 - 4 * u + 1) * v0 * T + (6 * u - 6 * u ** 2) * to) / T,
];
const tick = (now) => {
  queued = false;
  if (!inView) return;
  const tk = reduce ? 1 : prog();
  if (Math.abs(tk - to) > 1e-4) {
    const u = chained ? Math.min(1, (now - t0) / 1000 / T) : 1;
    const v = chained ? at(u)[1] : 0;
    [from, v0, to, t0] = [k, v, tk, now];
    // seconds: a short hop still glides, the long last leg takes a little longer
    T = 0.75 + 1.4 * Math.abs(tk - k);
  }
  const u = Math.min(1, (now - t0) / 1000 / T);
  k = u < 1 ? Math.max(0, Math.min(1, at(u)[0])) : to;
  setStep(stepAt(k));
  showHint(k);
  const was = chained;
  chained = u < 1;
  // at rest: the full image again, sharp, and the bitmaps for the next glide
  if (was && !chained) {
    dirty = true;
    warmSoon();
  }
  draw();
  if (chained) req();
};
const req = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(tick);
};

new IntersectionObserver(([e]) => {
  inView = e.isIntersecting;
  if (inView) req();
}).observe(cv);
addEventListener('scroll', req, { passive: true });

// one scroll per stop: each wheel gesture moves exactly one stop
// the stops on the path, then the intro below the climb
const stopY = [...document.querySelectorAll('.snaps i'), document.querySelector('.home-intro')];
let held = 0;
addEventListener(
  'wheel',
  (e) => {
    if (reduce || e.ctrlKey || !e.deltaY) return;
    // the time of the input itself, so a busy page cannot split one flick into two
    const now = e.timeStamp;
    const ys = stopY.map((el) => el.getBoundingClientRect().top + scrollY);
    if (scrollY > ys[ys.length - 1] + 2) return; // in the intro: plain scrolling
    // a flick keeps sending wheel events; a pause this long ends the gesture
    if (now - held < 160) {
      held = now;
      return e.preventDefault();
    }
    let i = 0;
    ys.forEach((y, j) => Math.abs(y - scrollY) < Math.abs(ys[i] - scrollY) && (i = j));
    const next = i + Math.sign(e.deltaY);
    if (next < 0 || next >= ys.length) return; // past the top or into the intro: let it scroll on
    held = now;
    e.preventDefault();
    // between the stops the frames do the gliding; to and from the intro the page itself glides
    const intro = ys.length - 1;
    scrollTo({ top: ys[next], behavior: next === intro || i === intro ? 'smooth' : 'instant' });
  },
  { passive: false },
);
addEventListener('resize', () => {
  size();
  req();
});
portrait.addEventListener('change', () => {
  set = portrait.matches ? 'p' : 'l';
  dropBitmaps();
  load(set);
  warmSoon();
  dirty = true;
  req();
});

// a slight shift with the pointer or the tilt of the phone, so the still scene feels like a place
if (!reduce) {
  let px = 0,
    py = 0,
    moved = false;
  const lean = (x, y) => {
    px = Math.max(-1, Math.min(1, x));
    py = Math.max(-1, Math.min(1, y));
    if (moved) return;
    moved = true;
    requestAnimationFrame(() => {
      moved = false;
      stage.style.setProperty('--px', px.toFixed(3));
      stage.style.setProperty('--py', py.toFixed(3));
    });
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse')
      lean((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  });
  // fires without a prompt on Android; iOS asks for permission, so it simply stays still there
  addEventListener('deviceorientation', (e) => {
    if (e.gamma != null) lean(e.gamma / 25, (e.beta - 45) / 25);
  });
}

size();
load(set);
req();
