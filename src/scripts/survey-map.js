// Draws the survey map (contours by marching squares over a noisy hill) and wires the stops.
export function initSurveyMap(root) {
  if (!root) return;
  const stops = JSON.parse(root.dataset.stops);
  const pins = [...root.querySelectorAll('.pin')];
  const $ = (id) => root.querySelector('#' + id);
  let cur = stops.length - 1;

  function open(i) {
    cur = (i + stops.length) % stops.length;
    const s = stops[cur];
    $('e-kind').textContent = s.kind;
    $('e-step').textContent = `${cur + 1} van ${stops.length}`;
    $('e-title').textContent = s.title;
    $('e-text').textContent = s.text;
    pins.forEach((p, j) => p.setAttribute('aria-pressed', String(j === cur)));
  }
  pins.forEach((p, i) => p.addEventListener('click', () => open(i)));
  $('e-prev').addEventListener('click', () => open(cur - 1));
  $('e-next').addEventListener('click', () => open(cur + 1));

  const cv = $('survey');
  const draw = () => drawMap(cv, stops);
  let t;
  addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(draw, 150);
  });
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(draw);
}

// Squares are cut by level L; each case lists the edge points to join, in pairs.
const CASES = {
  1: ['L', 'T'],
  2: ['T', 'R'],
  3: ['L', 'R'],
  4: ['R', 'B'],
  5: ['L', 'T', 'R', 'B'],
  6: ['T', 'B'],
  7: ['L', 'B'],
  8: ['L', 'B'],
  9: ['T', 'B'],
  10: ['T', 'R', 'L', 'B'],
  11: ['R', 'B'],
  12: ['L', 'R'],
  13: ['T', 'R'],
  14: ['L', 'T'],
};

function drawMap(cv, stops) {
  if (!cv || !cv.offsetWidth) return;
  const W = cv.offsetWidth;
  const H = cv.offsetHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = W * dpr;
  cv.height = H * dpr;
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const tok = (n) => css.getPropertyValue(n).trim();

  // seeded, so the hill looks the same on every visit
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const G = 64;
  const grid = Array.from({ length: G * G }, rnd);
  const sm = (t) => t * t * (3 - 2 * t);
  const g = (a, b) => grid[(((b % G) + G) % G) * G + (((a % G) + G) % G)];
  const noise = (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      xf = sm(x - xi),
      yf = sm(y - yi);
    const a = g(xi, yi),
      b = g(xi + 1, yi),
      d = g(xi, yi + 1),
      e = g(xi + 1, yi + 1);
    return a + (b - a) * xf + (d - a) * yf + (a - b - d + e) * xf * yf;
  };

  const phone = W < 700;
  const px = phone ? 0.62 : 0.64,
    py = phone ? 0.34 : 0.38;
  const R = Math.max(W, H) * (phone ? 0.55 : 0.42);
  const h = (x, y) => {
    const dx = (x - px * W) / R,
      dy = (y - py * H) / (R * 0.85);
    return (
      Math.exp(-(dx * dx + dy * dy) * 1.6) * 1.1 +
      noise(x / 170, y / 170) * 0.28 +
      noise(x / 55, y / 55) * 0.05
    );
  };
  const st = phone ? 7 : 8;
  const cols = Math.ceil(W / st) + 1,
    rows = Math.ceil(H / st) + 1;
  const v = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = h(i * st, j * st);

  c.fillStyle = tok('--color-paper');
  c.fillRect(0, 0, W, H);
  c.strokeStyle = tok('--color-contour');
  let n = 0;
  for (let L = 0.16; L < 1.4; L += 0.055, n++) {
    c.beginPath();
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < cols - 1; i++) {
        const a = v[j * cols + i],
          b = v[j * cols + i + 1],
          d = v[(j + 1) * cols + i + 1],
          e = v[(j + 1) * cols + i];
        const k = (a > L) | ((b > L) << 1) | ((d > L) << 2) | ((e > L) << 3);
        if (k === 0 || k === 15) continue;
        const x = i * st,
          y = j * st,
          f = (p, q) => (L - p) / (q - p);
        const P = {
          T: [x + st * f(a, b), y],
          R: [x + st, y + st * f(b, d)],
          B: [x + st * f(e, d), y + st],
          L: [x, y + st * f(a, e)],
        };
        const seg = CASES[k];
        for (let m = 0; m < seg.length; m += 2) {
          c.moveTo(...P[seg[m]]);
          c.lineTo(...P[seg[m + 1]]);
        }
      }
    const index = n % 5 === 4; // every fifth contour is heavier, as on a survey map
    c.globalAlpha = index ? 0.9 : 0.5;
    c.lineWidth = index ? 1.5 : 0.8;
    c.stroke();
  }
  c.globalAlpha = 1;

  // a stream in the low ground and two hedges
  c.strokeStyle = tok('--color-water');
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(W * 0.08, -4);
  c.bezierCurveTo(W * 0.22, H * 0.35, W * 0.12, H * 0.62, W * 0.3, H + 4);
  c.stroke();
  c.strokeStyle = tok('--color-hedge');
  c.lineWidth = 2.2;
  c.lineCap = 'round';
  c.setLineDash([0.1, 6]);
  c.beginPath();
  c.moveTo(W * 0.36, H);
  c.lineTo(W * 0.4, H * 0.78);
  c.lineTo(W * 0.62, H * 0.84);
  c.lineTo(W * 0.7, H);
  c.stroke();
  c.beginPath();
  c.moveTo(W * 0.82, H);
  c.lineTo(W * 0.86, H * 0.7);
  c.lineTo(W, H * 0.66);
  c.stroke();

  // the route between the stops
  const pts = stops.map((p) => [(p.x / 100) * W, (p.y / 100) * H]);
  c.setLineDash([6, 6]);
  c.lineCap = 'butt';
  c.strokeStyle = tok('--color-ink');
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(...pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1],
      [x1, y1] = pts[i];
    c.quadraticCurveTo(x0 + (x1 - x0) * 0.9, y0 + (y1 - y0) * 0.2, x1, y1);
  }
  c.stroke();
  c.setLineDash([]);

  // fold creases and paper grain
  c.fillStyle = tok('--color-sheet');
  c.globalAlpha = 0.5;
  c.fillRect(W * 0.5, 0, 1, H);
  c.fillRect(0, H * 0.5, W, 1);
  c.fillStyle = tok('--color-ink');
  c.globalAlpha = 0.06;
  c.fillRect(W * 0.5 + 1, 0, 1, H);
  c.fillRect(0, H * 0.5 + 1, W, 1);
  c.globalAlpha = 0.05;
  for (let i = 0; i < (W * H) / 90; i++) c.fillRect(rnd() * W, rnd() * H, 1, 1);
  c.globalAlpha = 1;

  // calm ground on the left so the heading reads cleanly
  if (!phone) {
    const paper = tok('--color-paper');
    const grad = c.createLinearGradient(0, 0, W * 0.5, 0);
    grad.addColorStop(0, paper);
    grad.addColorStop(0.55, paper);
    grad.addColorStop(1, paper.replace(')', ' / 0)'));
    c.fillStyle = grad;
    c.fillRect(0, 0, W * 0.5, H);
  }
}
