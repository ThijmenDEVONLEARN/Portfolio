// The climb as a sequence of stills rendered from the live 3D scene (/berg-3d/).
// Scroll picks the frame; the frames sit close enough together that each one is shown whole.
import { reduce, root, setStep, showHint, prog, stepAt } from './climb.js';

const COUNT = 239;
// the scroll stops in index.astro, each on a whole frame: 0, 22, 66, 110, 156 and 238 of 238
const STOPS = [0, 0.0924, 0.2773, 0.4622, 0.6555, 1];
const cv = document.getElementById('seq');
const cx = cv.getContext('2d');
const stage = cv.parentElement;
const portrait = matchMedia('(orientation: portrait)');
const sets = { l: [], p: [] };
let set = portrait.matches ? 'p' : 'l';

// stops first, then ever finer passes, so scrubbing works before every frame is in
const order = [];
const add = (i) => !order.includes(i) && order.push(i);
STOPS.forEach((k) => add(Math.round(k * (COUNT - 1))));
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
    img.src = `/berg/${s}/${String(i).padStart(3, '0')}.webp`;
    img
      .decode()
      .then(() => {
        sets[s][i] = img;
        if (s === set) {
          dirty = true;
          req();
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
  const s = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
  const w = img.naturalWidth * s,
    h = img.naturalHeight * s;
  cx.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
};

let k = 0,
  shown = -1,
  dirty = true;
// one whole frame at a time: blending two frames shows double edges, which reads as blur
function draw() {
  const f = Math.round(k * (COUNT - 1));
  if (!dirty && f === shown) return;
  const img = sets[set][f] || nearest(sets[set], f);
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
};

// ease toward the scroll position by elapsed time, so the glide keeps its speed when frames drop
let queued = false,
  chained = false,
  last = 0,
  inView = true;
const tick = (now) => {
  queued = false;
  if (!inView) return;
  const tk = reduce ? 1 : prog();
  const dt = chained ? Math.min(100, now - last) : 1000 / 60;
  k += (tk - k) * (1 - Math.pow(0.75, dt / (1000 / 60)));
  if (Math.abs(tk - k) < 0.0004) k = tk;
  last = now;
  setStep(stepAt(k));
  showHint(k);
  chained = k !== tk;
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
addEventListener('resize', () => {
  size();
  req();
});
portrait.addEventListener('change', () => {
  set = portrait.matches ? 'p' : 'l';
  load(set);
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
