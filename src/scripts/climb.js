// The stops on the climb and the text beside them, used by the frame player.
// reduced motion, or the browser asks to save data: stills only, no videos
export const reduce =
  matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData === true;
export const root = document.documentElement;
export const steps = [
  { t: '', s: 'Ik bouw websites en automatiseringen. Scroll en klim mee.' },
  {
    t: 'Start',
    s: 'Software Developer N4 aan het ROC van Twente.',
    href: '/over-mij/',
    go: 'Over mij',
  },
  {
    t: 'Stage',
    s: 'Barnhoorn ICT, mijn eerste echte team.',
    href: '/over-mij/#stage',
    go: 'Mijn stage',
  },
  {
    t: 'Eigen projecten',
    s: 'Doelen-canvas, dashboard en mijn Claude-brein.',
    href: '/projecten/',
    go: 'Bekijk projecten',
  },
  {
    t: 'AI en n8n',
    s: 'Automatiseringen, nog volop aan het leren.',
    href: '/ai/',
    go: 'Zo werk ik met AI',
  },
  {
    t: 'De top',
    s: 'Jouw project is de volgende top.',
    href: '/contact/',
    go: 'Neem contact op',
    cta: true,
  },
];
const sub = document.getElementById('sub'),
  dotsEl = document.getElementById('dots'),
  hint = document.getElementById('hint');
export const showHint = (k) => (hint.style.opacity = k > 0.03 ? 0 : 1);
steps.slice(1).forEach((s) => {
  const a = document.createElement('a');
  a.href = s.href;
  a.innerHTML = `<i></i><span>${s.t}</span>`;
  dotsEl.appendChild(a);
});
const dots = [...dotsEl.children];
let lastStep = -1;
export const setStep = (i) => {
  if (i === lastStep) return;
  lastStep = i;
  const s = steps[i];
  const link = s.href
    ? `<br><a class="${s.cta ? 'cta' : 'go'}" href="${s.href}">${s.go} →</a>`
    : '';
  sub.innerHTML = (s.t ? `<b>${s.t}</b>` : '') + s.s + link;
  sub.classList.remove('pop');
  void sub.offsetWidth; // restart the arrival animation
  if (i) sub.classList.add('pop');
  dots.forEach((d, j) => {
    d.classList.toggle('on', j < i);
    d.classList.toggle('now', j === i - 1);
  });
};

export function prog() {
  const t = document.getElementById('track');
  const m = t.offsetHeight - innerHeight;
  return m > 0 ? Math.min(1, Math.max(0, scrollY / m)) : 0;
}
setStep(0);
