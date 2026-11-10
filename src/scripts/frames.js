// The climb as two videos rendered in Blender, one forward and one backward (scripts/build-climb.mjs).
// Scrolling is free: the page works out which frame the scroll position is at, and the video plays toward
// it, fast when it is far behind and slowly as it arrives, so it follows the scroll without ever jumping.
// Video is decoded by the graphics card, which keeps this smooth. At rest on a stop, a sharp still lies on top.
import { reduce, root, setStep, showHint, prog } from './climb.js';

// the scroll stops (climb progress) and the frame each one rests on; 261 frames, 30 per second in the video
const STOPS = [0, 0.0924, 0.2773, 0.4622, 0.6555, 1];
const AT = [0, 44, 88, 132, 178, 260];
const STILL = ['000', '022', '066', '110', '156', '238'];
const N = 261,
  FPS = 30;
const seq = document.getElementById('seq');
const stage = seq.parentElement;
const portrait = matchMedia('(orientation: portrait)');
const track = document.getElementById('track');
const intro = document.querySelector('.home-intro');
let set = portrait.matches ? 'p' : 'l';

// frame at a climb progress, and back; even steps between the stops
const seg = (v, xs) => {
  let j = 1;
  while (j < xs.length - 1 && v > xs[j]) j++;
  return j;
};
const frameOf = (k) => {
  const j = seg(k, STOPS);
  const u = (k - STOPS[j - 1]) / (STOPS[j] - STOPS[j - 1]);
  return AT[j - 1] + Math.max(0, Math.min(1, u)) * (AT[j] - AT[j - 1]);
};
const progOf = (f) => {
  const j = seg(f, AT);
  const u = (f - AT[j - 1]) / (AT[j] - AT[j - 1]);
  return STOPS[j - 1] + Math.max(0, Math.min(1, u)) * (STOPS[j] - STOPS[j - 1]);
};

// the dots fill one by one as the climb passes them
const dots = [...document.querySelectorAll('#dots a')];
const show = (k) => {
  let near = 0;
  STOPS.forEach((s, j) => Math.abs(s - k) < Math.abs(STOPS[near] - k) && (near = j));
  setStep(near);
  showHint(k);
  dots.forEach((d, j) => {
    const f = (k - STOPS[j]) / (STOPS[j + 1] - STOPS[j]);
    d.style.setProperty('--f', Math.max(0, Math.min(1, f)).toFixed(3));
  });
};

let fwd, rev, stills, active, ready, switching, still;
const GAIN = 2.5, // frames per second per frame of distance: it closes in over about 0.4 seconds, a soft glide
  TOP_SPEED = 150, // frames per second at most
  JUMP = 90; // further than this behind or ahead (a dragged scrollbar, a reload): jump, then glide in

// where the video is, in frames
const pos = () => {
  const t = Math.max(0, Math.min(N - 1, active.currentTime * FPS));
  return active === fwd ? t : N - 1 - t;
};

// show one video, put it at a frame, and say when it is there
function put(v, frame, then) {
  if (v === rev) loadRev();
  const t = (v === fwd ? frame : N - 1 - frame) / FPS;
  switching = true;
  active.pause();
  const done = () => {
    v.removeEventListener('seeked', done);
    fwd.classList.toggle('on', v === fwd);
    rev.classList.toggle('on', v === rev);
    active = v;
    switching = false;
    root.classList.add('gl-on');
    then?.();
  };
  v.addEventListener('seeked', done);
  v.currentTime = t;
}

const loadRev = () => {
  const v = rev;
  if (!v.src) v.src = `/berg/${set}/climb-rev.mp4`;
};

let raf = 0;
const req = () => raf || (raf = requestAnimationFrame(tick));
function tick() {
  raf = 0;
  if (reduce) return restStill(frameOf(prog()));
  if (!ready || switching) return; // put() and the first load call req() when they are done
  const target = frameOf(prog());
  const p = pos();
  const d = target - p;
  const ad = Math.abs(d);
  show(progOf(p));
  if (ad > JUMP) {
    const dir = Math.sign(d);
    return put(dir > 0 ? fwd : rev, Math.max(0, Math.min(N - 1, target - dir * 30)), req);
  }
  if (ad < 0.5) {
    active.pause();
    restStill(p);
    return;
  }
  // the other way: only past a small margin, so a hair of overshoot does not flip the video
  const wantFwd = d > 0;
  if ((active === fwd) !== wantFwd) {
    if (ad < 1.5) return (active.pause(), restStill(p));
    return put(wantFwd ? fwd : rev, p, req);
  }
  hideStill();
  active.playbackRate = Math.max(3, Math.min(TOP_SPEED, ad * GAIN)) / FPS;
  if (active.paused) active.play().catch(() => {});
  req();
}

// at rest on a stop the sharp still replaces the video frame, so what stands still is as sharp as it gets
const hideStill = () => {
  if (still < 0) return;
  stills[still].classList.remove('on');
  still = -1;
};
function restStill(f) {
  let j = 0;
  AT.forEach((a, i) => Math.abs(a - f) < Math.abs(AT[j] - f) && (j = i));
  if (Math.abs(AT[j] - f) > 0.8 && !reduce) return hideStill();
  if (still === j) return;
  hideStill();
  stills[j].classList.add('on');
  still = j;
  show(STOPS[j]);
  root.classList.add('gl-on');
}

function build() {
  ready = false;
  switching = false;
  still = -1;
  seq.replaceChildren();
  const f0 = frameOf(prog());
  stills = STILL.map((name) => {
    const img = new Image();
    img.alt = '';
    img.src = `/berg/${set}/${name}.webp`;
    seq.append(img);
    return img;
  });
  [fwd, rev] = ['climb', 'climb-rev'].map((name) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    if (name === 'climb') v.src = `/berg/${set}/${name}.mp4`;
    seq.append(v);
    return v;
  });
  // the backward video is the same size again, so it waits until the forward one is in, or is asked for
  fwd.addEventListener('canplaythrough', () => setTimeout(loadRev, 2000), { once: true });
  active = fwd;
  // the nearest still is up as soon as it is decoded; scrolling works once the forward video can seek
  let near = 0;
  AT.forEach((a, i) => Math.abs(a - f0) < Math.abs(AT[near] - f0) && (near = i));
  stills[near].decode().then(
    () => restStill(AT[near]),
    () => {},
  );
  if (reduce) return;
  fwd.addEventListener(
    'loadeddata',
    () => {
      put(fwd, Math.round(f0), () => {
        ready = true;
        req();
      });
    },
    { once: true },
  );
}

portrait.addEventListener('change', () => {
  set = portrait.matches ? 'p' : 'l';
  build();
});
addEventListener('scroll', req, { passive: true });

// The end of the climb is a wall: scrolling is free up to it, and one more scroll is asked to go on
// into the page. Anything that carries past it (a coasting flick, a dragged scrollbar) stops there.
const endY = () => track.offsetHeight - innerHeight;
let unlocked = false,
  reached = 0,
  lastWheel = 0;
const atEnd = () => scrollY >= endY() - 2;
const fresh = (t) => t - reached > 500; // not the same push that brought us here
addEventListener(
  'scroll',
  () => {
    if (unlocked) return void (scrollY < endY() - 30 && (unlocked = false));
    if (scrollY > endY()) scrollTo(0, endY());
    if (atEnd() && !reached) reached = performance.now();
    if (!atEnd()) reached = 0;
  },
  { passive: true },
);
addEventListener(
  'wheel',
  (e) => {
    const gap = e.timeStamp - lastWheel;
    lastWheel = e.timeStamp;
    if (reduce || e.ctrlKey || e.deltaY <= 0 || unlocked) return;
    if (atEnd()) {
      e.preventDefault();
      // a new push, after the last one has died down for a good moment, opens the way
      if (gap > 350 && fresh(e.timeStamp)) {
        unlocked = true;
        scrollTo({ top: intro.offsetTop, behavior: 'smooth' });
      }
    } else if (e.deltaMode === 0 && e.deltaY > endY() - scrollY) {
      e.preventDefault();
      scrollTo(0, endY());
    }
  },
  { passive: false },
);
addEventListener('touchstart', () => atEnd() && fresh(performance.now()) && (unlocked = true), {
  passive: true,
});
addEventListener('keydown', (e) => {
  if (atEnd() && fresh(performance.now()) && ['ArrowDown', 'PageDown', 'End', ' '].includes(e.key))
    unlocked = true;
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

build();
