// The climb as a sequence of stills rendered from the live 3D scene (/berg-3d/).
// Scroll picks the frame; the frames sit close enough together that each one is shown whole.
import { reduce, root, setStep, showHint, prog, stepAt } from './climb.js';

const COUNT = 239;
// the scroll stops in index.astro, each on a whole frame: 0, 22, 66, 110, 156 and 238 of 238
const STOPS = [0, 0.0924, 0.2773, 0.4622, 0.6555, 1];
// climb progress per second at most
const MAX_SPEED = 0.3;
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
  const ease = (tk - k) * (1 - Math.pow(0.75, dt / (1000 / 60)));
  // a speed limit, so even a hard flick climbs at an easy pace the frames can keep up with
  const cap = (MAX_SPEED * dt) / 1000;
  k += Math.max(-cap, Math.min(cap, ease));
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

// one scroll per stop: each wheel gesture moves exactly one stop, and waits while the climb glides there
// the stops on the path, then the intro below the climb
const stopY = [...document.querySelectorAll('.snaps i'), document.querySelector('.home-intro')];
let held = 0;
const gliding = () => chained && !reduce;
addEventListener(
  'wheel',
  (e) => {
    if (reduce || e.ctrlKey || !e.deltaY) return;
    const now = performance.now();
    // a flick keeps sending wheel events; a pause this long ends the gesture
    const sameGesture = now - held < 160;
    const ys = stopY.map((el) => el.getBoundingClientRect().top + scrollY);
    if (scrollY > ys[ys.length - 1] + 2) return; // in the intro: plain scrolling
    if (gliding() || sameGesture) {
      held = now;
      return e.preventDefault();
    }
    let at = 0;
    ys.forEach((y, i) => Math.abs(y - scrollY) < Math.abs(ys[at] - scrollY) && (at = i));
    const to = at + Math.sign(e.deltaY);
    if (to < 0 || to >= ys.length) return; // past the top or into the intro: let it scroll on
    held = now;
    e.preventDefault();
    scrollTo({ top: ys[to], behavior: 'instant' });
  },
  { passive: false },
);
// a swipe already snaps one stop at a time; only hold the next one until the glide is done
addEventListener(
  'touchmove',
  (e) => {
    if (gliding() && e.cancelable) e.preventDefault();
  },
  { passive: false },
);
addEventListener('keydown', (e) => {
  if (gliding() && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Space'].includes(e.key))
    e.preventDefault();
});
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
