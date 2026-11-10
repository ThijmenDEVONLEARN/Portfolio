// The climb plays as short clips rendered in Blender: one per stretch between two stops, per direction
// (scripts/build-clips.mjs). A scroll moves the page to the next stop and the clip glides there; video is
// decoded by the graphics card, so it stays smooth. At rest a full still of the stop lies on top, sharp.
import { reduce, root, setStep, showHint, prog } from './climb.js';

// the scroll stops in index.astro, as climb progress, and the still each one rests on
const STOPS = [0, 0.0924, 0.2773, 0.4622, 0.6555, 1];
const STILL = ['000', '022', '066', '110', '156', '238'];
const LAST = STOPS.length - 1;
const seq = document.getElementById('seq');
const stage = seq.parentElement;
const portrait = matchMedia('(orientation: portrait)');
let set = portrait.matches ? 'p' : 'l';

// the stop the scroll position is nearest to
const wanted = () => {
  if (reduce) return LAST;
  const k = prog();
  let i = 0;
  STOPS.forEach((s, j) => Math.abs(s - k) < Math.abs(STOPS[i] - k) && (i = j));
  return i;
};

let lock = 0,
  at = wanted(), // the stop the picture is at, or left last
  playing = null,
  stills = [],
  clips = new Map();

// the dots fill one by one as the climb passes them, instead of switching on at once
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

// a clip is loaded and paused on its first frame, which is the still of the stop it leaves from
function clip(a, b) {
  const key = `${a}-${b}`;
  if (b < 0 || b > LAST || clips.has(key)) return clips.get(key);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.disablePictureInPicture = true;
  v.src = `/berg/${set}/clips/${key}.mp4`;
  seq.append(v);
  v.load();
  clips.set(key, v);
  return v;
}
const drop = (keep) =>
  clips.forEach((v, key) => {
    if (keep.includes(key)) return;
    v.removeAttribute('src');
    v.load();
    v.remove();
    clips.delete(key);
  });

// at rest: the sharp still on top, and the clips to both neighbours ready underneath
function rest() {
  playing = null;
  show(STOPS[at]);
  const here = at;
  const swap = () => {
    if (playing || at !== here) return;
    stills.forEach((img, i) => img.classList.toggle('on', i === at));
    root.classList.add('gl-on');
    if (reduce) return;
    // only now can the clip that just landed go: its last frame was the picture until the still was in
    drop([`${at}-${at + 1}`, `${at}-${at - 1}`]);
    clips.forEach((c) => c.classList.remove('on'));
  };
  stills[at].decode().then(swap, swap);
  if (reduce) return;
  clip(at, at + 1);
  clip(at, at - 1);
}

function go() {
  if (playing || reduce) return;
  const want = wanted();
  if (want === at) return;
  const dir = Math.sign(want - at);
  // more than one stop away (a dragged scrollbar, a reload further down): cut, then glide the last stretch
  if (Math.abs(want - at) > 1) at = want - dir;
  const from = at,
    to = at + dir;
  const v = clip(from, to);
  clip(to, to + dir); // in case the next scroll comes during this glide
  playing = v;
  const land = () => {
    if (playing !== v) return;
    at = to;
    playing = null;
    lock = performance.now() + 600; // a flick still coasting must not carry straight on
    if (wanted() === at) return rest();
    // straight on: keep this clip's last frame up until the next one runs
    stills.forEach((img) => img.classList.remove('on'));
    go();
  };
  v.onended = land;
  v.onerror = land;
  v.currentTime = 0;
  v.play().then(() => {
    if (playing !== v) return;
    // the clip's first frame is the picture already showing, so the swap is not seen
    clips.forEach((c) => c.classList.toggle('on', c === v));
    stills.forEach((img) => img.classList.remove('on'));
    const follow = () => {
      if (playing !== v) return;
      const u = Math.min(1, v.currentTime / (v.duration || 1));
      show(STOPS[from] + u * u * (3 - 2 * u) * (STOPS[to] - STOPS[from]));
      requestAnimationFrame(follow);
    };
    follow();
  }, land); // playback refused (a power saver): step to the still instead
}

// the stills of this orientation; the first one in fades the scene over the poster
function build() {
  playing = null;
  at = wanted();
  drop([]);
  stills.forEach((img) => img.remove());
  stills = STILL.map((name, i) => {
    const img = new Image();
    img.alt = '';
    img.src = `/berg/${set}/${name}.webp`;
    seq.append(img);
    return img;
  });
  rest();
}

addEventListener('scroll', go, { passive: true });

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
    // a flick keeps sending wheel events; a pause this long ends the gesture, and a new one
    // may only begin after the clip has landed, so the top (or any stop) takes a fresh scroll
    if (now < lock || now - held < 160) {
      held = now;
      return e.preventDefault();
    }
    let i = 0;
    ys.forEach((y, j) => Math.abs(y - scrollY) < Math.abs(ys[i] - scrollY) && (i = j));
    const next = i + Math.sign(e.deltaY);
    if (next < 0 || next >= ys.length) return; // past the top or into the intro: let it scroll on
    held = now;
    e.preventDefault();
    // between the stops the clips do the gliding; to and from the intro the page itself glides
    const intro = ys.length - 1;
    scrollTo({ top: ys[next], behavior: next === intro || i === intro ? 'smooth' : 'instant' });
  },
  { passive: false },
);
portrait.addEventListener('change', () => {
  set = portrait.matches ? 'p' : 'l';
  build();
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
