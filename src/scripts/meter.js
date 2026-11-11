// A small on-screen meter for the climb, shown with ?meter in the address. It counts where the picture
// stutters on this machine: the page itself (long gaps between screen updates), the video (late frames,
// dropped frames, waiting for data) and which graphics card the browser uses.
const seq = document.getElementById('seq');
const box = document.createElement('div');
box.style.cssText =
  'position:fixed;left:8px;bottom:8px;z-index:99;max-width:min(560px,calc(100vw - 16px));padding:10px 12px;' +
  'background:rgba(0,0,0,.82);color:#fff;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;border-radius:8px';
const out = document.createElement('div');
const copy = document.createElement('button');
copy.textContent = 'Kopieer';
copy.style.cssText = 'margin-top:6px;padding:4px 10px;font:inherit;cursor:pointer';
box.append(out, copy);
document.body.append(box);

const gpu = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  } catch {
    return 'onbekend';
  }
})();

// the page: gaps between screen updates
const page = { n: 0, late: 0, worst: 0, gaps: [] };
// the first seconds after the first scroll, apart from everything after: a cold start shows up there
let first = 0;
addEventListener('scroll', () => (first ||= performance.now()), { passive: true });
const early = () => first && performance.now() - first < 8000;
const cold = { page: 0, video: 0 };
let last = 0;
const frame = (t) => {
  if (last) {
    const g = t - last;
    page.n++;
    if (page.gaps.length < 600) page.gaps.push(g);
    if (g > 25) {
      page.late++;
      if (early()) cold.page++;
    }
    page.worst = Math.max(page.worst, g);
  }
  last = t;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
// a hidden tab pauses the updates; that is not a stutter
document.addEventListener('visibilitychange', () => (last = 0));

// the video: frames that reach the screen late while it plays at a real pace, per part of the climb
const zones = { begin: [0, 176], midden: [176, 558], top: [558, 660] };
const vid = { shown: 0, waiting: 0, seeks: 0, late: { begin: 0, midden: 0, top: 0 }, worst: 0 };
const zoneOf = (f) => Object.keys(zones).find((z) => f >= zones[z][0] && f < zones[z][1]) || 'top';
function watch(v) {
  if (v.__meter || !v.requestVideoFrameCallback) return;
  v.__meter = true;
  let prev = 0;
  const cb = (now, meta) => {
    const f = v.src.includes('rev') ? 659 - meta.mediaTime * 60 : meta.mediaTime * 60;
    // late: clearly longer than the pace the video plays at asks for
    const due = 1000 / (60 * v.playbackRate);
    if (prev && !v.paused && v.playbackRate * 60 >= 40) {
      const g = now - prev;
      vid.shown++;
      if (g > Math.max(34, 2.2 * due)) {
        vid.late[zoneOf(f)]++;
        if (early()) cold.video++;
        vid.worst = Math.max(vid.worst, g);
      }
    }
    prev = v.paused ? 0 : now;
    v.requestVideoFrameCallback(cb);
  };
  v.requestVideoFrameCallback(cb);
  v.addEventListener('waiting', () => vid.waiting++);
  v.addEventListener('seeking', () => vid.seeks++);
  v.addEventListener('pause', () => (prev = 0));
}
const hook = () => seq.querySelectorAll('video').forEach(watch);
new MutationObserver(hook).observe(seq, { childList: true });
hook();

const report = () => {
  const sorted = [...page.gaps].sort((a, b) => a - b);
  const hz = sorted.length ? Math.round(1000 / sorted[sorted.length >> 1]) : 0;
  const vs = [...seq.querySelectorAll('video')].map((v) => {
    const q = v.getVideoPlaybackQuality?.() || {};
    const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
    const name = v.src.includes('rev')
      ? 'achteruit'
      : v.src
        ? 'vooruit'
        : 'achteruit (nog niet geladen)';
    return `  ${name}: ${v.videoWidth}x${v.videoHeight}, geladen ${Math.round((end / (v.duration || 1)) * 100)}%, weggevallen ${q.droppedVideoFrames ?? '?'} van ${q.totalVideoFrames ?? '?'}`;
  });
  return [
    `videokaart: ${gpu}`,
    `scherm: ${innerWidth}x${innerHeight} @${devicePixelRatio}x, ${hz} Hz`,
    `pagina: ${page.late} hapers van ${page.n} beelden, ergste ${Math.round(page.worst)} ms`,
    `video: ${vid.late.begin + vid.late.midden + vid.late.top} late beelden van ${vid.shown}, ergste ${Math.round(vid.worst)} ms`,
    `  begin ${vid.late.begin} | midden ${vid.late.midden} | top ${vid.late.top}`,
    `  wachten op data: ${vid.waiting}x, sprongen: ${vid.seeks}x`,
    `eerste 8 s na de eerste scroll: pagina ${cold.page}, video ${cold.video}`,
    ...vs,
  ].join('\n');
};
setInterval(() => (out.textContent = report()), 500);
copy.onclick = () =>
  navigator.clipboard.writeText(report()).then(
    () => (copy.textContent = 'Gekopieerd'),
    () => getSelection().selectAllChildren(out), // no clipboard: select it for Ctrl+C
  );
