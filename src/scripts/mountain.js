import * as THREE from 'three';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = document.documentElement;
const steps = [
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
steps.slice(1).forEach((s) => {
  const a = document.createElement('a');
  a.href = s.href;
  a.innerHTML = `<i></i><span>${s.t}</span>`;
  dotsEl.appendChild(a);
});
const dots = [...dotsEl.children];
let lastStep = -1;
const setStep = (i) => {
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
  onStep(i);
};

// accent picker
const btns = [...document.querySelectorAll('.picker button')];
let onAccent = () => {};
let onStep = () => {};
const setA = (a) => {
  a === 'oranje' ? root.removeAttribute('data-a') : root.setAttribute('data-a', a);
  btns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.a === a));
  try {
    localStorage.setItem('acc3d', a);
  } catch (e) {}
  onAccent();
};
btns.forEach((b) => (b.onclick = () => setA(b.dataset.a)));

// device tier: phones and weak devices get a lighter scene
const small = matchMedia('(max-width: 760px)').matches;
const weak =
  small || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
const Q = weak
  ? {
      seg: 140,
      dpr: Math.min(devicePixelRatio, 1.5),
      shadows: false,
      trees: 260,
      aa: false,
    }
  : {
      seg: 200,
      dpr: Math.min(devicePixelRatio, 1.25),
      shadows: true,
      trees: 900,
      aa: true,
    };

// noise
const perm = new Uint8Array(512);
{
  let s = 1337;
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10),
  lerp = (a, b, t) => a + (b - a) * t;
const grad = (h, x, y) => {
  const v = h & 7;
  const u = v < 4 ? x : y,
    w = v < 4 ? y : x;
  return (v & 1 ? -u : u) + (v & 2 ? -2 * w : 2 * w);
};
const noise = (x, y) => {
  const X = Math.floor(x) & 255,
    Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = fade(x),
    v = fade(y),
    a = perm[X] + Y,
    b = perm[X + 1] + Y;
  return (
    lerp(
      lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u),
      lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u),
      v,
    ) * 0.35
  );
};
const fbm = (x, y, o = 5) => {
  let s = 0,
    a = 1,
    f = 1,
    n = 0;
  for (let i = 0; i < o; i++) {
    s += a * noise(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
};
const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const PEAK = { x: 0, z: -1 };
const H = (x, z) => {
  const g = (cx, cz, r, h) => {
    const d = Math.hypot(x - cx, z - cz);
    return Math.exp(-(d / r) * (d / r)) * h;
  };
  const mount =
    g(PEAK.x, PEAK.z, 3.0, 4.5) +
    g(3.4, 1.2, 2.0, 2.3) +
    g(-3.6, 0, 2.3, 2.1) +
    g(1.5, -4.5, 2.6, 1.8);
  const rid =
    Math.pow(1 - Math.abs(fbm(x * 0.32 + 5, z * 0.32, 5) * 2.2), 3) * 0.85 * ss(0.4, 3, mount);
  const hills = fbm(x * 0.16 + 11, z * 0.16 + 3, 4) * 1.2;
  const det = fbm(x * 1.6, z * 1.6, 3) * 0.12;
  return mount + rid + hills + det;
};

(() => {
  let gl = null;
  try {
    const c = document.createElement('canvas');
    gl = c.getContext('webgl') || c.getContext('experimental-webgl');
  } catch (e) {}
  if (!gl) {
    root.classList.add('no3d');
    const up = () => {
      const k = prog();
      setStep(stepAt(k));
    };
    addEventListener('scroll', up, { passive: true });
    up();
    return;
  }
  const cv = document.getElementById('gl');
  const r = new THREE.WebGLRenderer({
    canvas: cv,
    antialias: Q.aa,
    powerPreference: 'high-performance',
  });
  r.setPixelRatio(Q.dpr);
  r.shadowMap.enabled = Q.shadows;
  r.shadowMap.type = THREE.PCFShadowMap;
  // the shadow map is redrawn only when the sun has moved enough (see render)
  r.shadowMap.autoUpdate = false;
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  const sc = new THREE.Scene(),
    cam = new THREE.PerspectiveCamera(46, 1, 0.1, 120);

  // terrain
  const SIZE = 26,
    geo = new THREE.PlaneGeometry(SIZE, SIZE, Q.seg, Q.seg);
  geo.rotateX(-Math.PI / 2);
  const P = geo.attributes.position;
  for (let i = 0; i < P.count; i++) P.setY(i, H(P.getX(i), P.getZ(i)));
  geo.computeVertexNormals();
  const N = geo.attributes.normal,
    col = new Float32Array(P.count * 3);
  const C = (h) => new THREE.Color(h).convertSRGBToLinear();
  const scree = C('#9b958c'),
    rockD = C('#4a4642'),
    grass1 = C('#2f6d24'),
    grass2 = C('#5a8a2e'),
    meadow = C('#829f45'),
    rock1 = C('#625c56'),
    rock2 = C('#8e877f'),
    snow = C('#f7fafc'),
    dirt = C('#6f5c42');
  const tmp = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i),
      y = P.getY(i),
      z = P.getZ(i),
      slope = 1 - N.getY(i),
      n = fbm(x * 0.8, z * 0.8, 3);
    tmp
      .copy(grass1)
      .lerp(grass2, ss(-0.15, 0.2, n))
      .lerp(meadow, ss(0.15, 0.35, fbm(x * 0.25 + 2, z * 0.25, 3)) * 0.6);
    const rockLine = 2.0 + n * 1.2;
    const rk = Math.max(ss(rockLine - 0.5, rockLine + 0.4, y), ss(0.38, 0.62, slope));
    const band = 0.5 + 0.5 * Math.sin(y * 6 + n * 3);
    const rc = tmp
      .clone()
      .copy(rock1)
      .lerp(rock2, ss(-0.2, 0.3, fbm(x * 3, z * 3, 2)))
      .lerp(rockD, band * 0.2 + ss(0.6, 0.85, slope) * 0.25);
    tmp.lerp(rc, rk);
    tmp.lerp(
      scree,
      ss(rockLine - 0.7, rockLine - 0.3, y) * (1 - ss(rockLine - 0.3, rockLine + 0.1, y)) * 0.3,
    );
    tmp.lerp(dirt, ss(0.25, 0.4, slope) * (1 - rk) * 0.5);
    const snowLine = 3.9 + n * 0.9;
    tmp.lerp(
      snow,
      Math.max(
        ss(snowLine - 0.15, snowLine + 0.15, y) * (1 - ss(0.5, 0.68, slope)),
        ss(3.1, 3.4, y) * (1 - ss(0.18, 0.3, slope)),
      ),
    );
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // fine grain: tiled noise texture multiplied with the vertex colours
  const dc = document.createElement('canvas');
  dc.width = dc.height = 128;
  const dx = dc.getContext('2d'),
    dd = dx.createImageData(128, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const v = 200 + 40 * (fbm(x / 9, y / 9, 4) * 2.4) + Math.random() * 22;
      const o = (y * 128 + x) * 4;
      dd.data[o] = dd.data[o + 1] = dd.data[o + 2] = Math.max(150, Math.min(255, v));
      dd.data[o + 3] = 255;
    }
  dx.putImageData(dd, 0, 0);
  const detail = new THREE.CanvasTexture(dc);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.repeat.set(36, 36);
  detail.encoding = THREE.sRGBEncoding;
  detail.anisotropy = Math.min(4, r.capabilities.getMaxAnisotropy());
  const mat = weak
    ? new THREE.MeshLambertMaterial({ vertexColors: true, map: detail })
    : new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: detail,
        roughness: 0.95,
        metalness: 0,
      });
  const land = new THREE.Mesh(geo, mat);
  land.receiveShadow = true;
  land.castShadow = Q.shadows;
  sc.add(land);

  // trees on the grassland
  const tg = new THREE.ConeGeometry(0.09, 0.36, 6);
  tg.translate(0, 0.18, 0);
  const tm = weak
    ? new THREE.MeshLambertMaterial({ color: C('#244a22') })
    : new THREE.MeshStandardMaterial({ color: C('#244a22'), roughness: 1 });
  const trees = new THREE.InstancedMesh(tg, tm, Q.trees);
  // trees only receive shadows: casting 900 instances into the shadow map costs more than it shows
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    sv = new THREE.Vector3();
  let placed = 0,
    seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let tries = 0; tries < Q.trees * 12 && placed < Q.trees; tries++) {
    const x = (rnd() - 0.5) * SIZE * 0.9,
      z = (rnd() - 0.5) * SIZE * 0.9,
      y = H(x, z);
    const sl = Math.abs(H(x + 0.1, z) - y) + Math.abs(H(x, z + 0.1) - y);
    if (y > 2.2 || sl > 0.06 || fbm(x * 0.35 + 20, z * 0.35, 3) < -0.02) continue;
    const s = 0.7 + rnd() * 0.8;
    m4.compose(new THREE.Vector3(x, y - 0.02, z), q, sv.set(s, s * (0.9 + rnd() * 0.5), s));
    trees.setMatrixAt(placed++, m4);
  }
  trees.count = placed;
  sc.add(trees);

  // path: spiral from the valley to the peak
  const pts = [];
  const a0 = -2.55;
  for (let i = 0; i <= 220; i++) {
    const t = i / 220,
      a = a0 + t * 3.4,
      rad = 7.2 * Math.pow(1 - t, 1.1) + 0.05;
    const x = PEAK.x + Math.cos(a) * rad,
      z = PEAK.z + Math.sin(a) * rad;
    pts.push(new THREE.Vector3(x, H(x, z) + 0.05, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, weak ? 240 : 480, 0.032, 5, false);
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xff7a3d, toneMapped: false });
  const path = new THREE.Mesh(tube, tubeMat);
  sc.add(path);
  const ghost = new THREE.Mesh(
    tube,
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }),
  );
  sc.add(ghost);
  const idxCount = tube.index.count,
    segTris = 5 * 6;
  const me = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff7a3d, toneMapped: false }),
  );
  sc.add(me);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff7a3d,
      transparent: true,
      opacity: 0.25,
      toneMapped: false,
    }),
  );
  sc.add(halo);

  // milestone markers on the path; the one you are at grows
  const stepK = (i) => (i < 5 ? 0.06 + ((i - 1) * 0.94) / 5 : 0.999);
  const markGeo = new THREE.SphereGeometry(0.075, 16, 12);
  const marks = [1, 2, 3, 4, 5].map((i) => {
    const m = new THREE.Mesh(
      markGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    );
    m.position.copy(curve.getPointAt(stepK(i)));
    m.position.y += 0.06;
    sc.add(m);
    return m;
  });
  let accColor = new THREE.Color(0xff7a3d);
  onStep = (now) => {
    marks.forEach((m, j) => {
      const i = j + 1;
      m.scale.setScalar(i === now ? 2.6 : i < now ? 1.3 : 1);
      m.material.color.copy(i <= now ? accColor : new THREE.Color(0xffffff));
    });
  };

  // sky as a gradient texture
  const sky = document.createElement('canvas');
  sky.width = 2;
  sky.height = 256;
  const sx = sky.getContext('2d');
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.encoding = THREE.sRGBEncoding;
  sc.background = skyTex;
  const cA = {
    top: new THREE.Color('#0e1736'),
    mid: new THREE.Color('#4a3f6b'),
    hor: new THREE.Color('#ee8d5c'),
  };
  const cB = {
    top: new THREE.Color('#3f78bf'),
    mid: new THREE.Color('#86b4e0'),
    hor: new THREE.Color('#f4dcbc'),
  };
  const fog = new THREE.Fog(0xffffff, 24, 62);
  sc.fog = fog;
  // sun glow sprite
  const gc = document.createElement('canvas');
  gc.width = gc.height = 128;
  const gx = gc.getContext('2d');
  const glowTex = new THREE.CanvasTexture(gc);
  const drawGlow = (acc) => {
    gx.clearRect(0, 0, 128, 128);
    const g = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(0.18, '#fff1d6');
    g.addColorStop(0.32, acc + 'cc');
    g.addColorStop(1, acc + '00');
    gx.fillStyle = g;
    gx.fillRect(0, 0, 128, 128);
    glowTex.needsUpdate = true;
  };
  const sunSpr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, fog: false, transparent: true }),
  );
  sunSpr.scale.set(9, 9, 1);
  sc.add(sunSpr);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = Q.shadows;
  if (Q.shadows) {
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -13,
      right: 13,
      top: 13,
      bottom: -13,
      near: 1,
      far: 80,
    });
    sun.shadow.bias = -0.0008;
  }
  sc.add(sun);
  sc.add(sun.target);
  sun.target.position.set(PEAK.x, 0, PEAK.z);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2f3b22, 0.5);
  sc.add(hemi);

  onAccent = () => {
    const a = getComputedStyle(root).getPropertyValue('--acc').trim();
    const c = new THREE.Color(a).convertSRGBToLinear();
    tubeMat.color = c;
    me.material.color = c;
    halo.material.color = c;
    accColor = c;
    onStep(lastStep);
    drawGlow(a);
    render();
  };

  const size = () => {
    const w = cv.clientWidth,
      h = cv.clientHeight;
    r.setSize(w, h, false);
    cam.aspect = w / h;
    cam.fov = w < h ? 60 : 46;
    cam.updateProjectionMatrix();
  };
  // reused every frame so scrolling does not churn the garbage collector
  const tmpC = new THREE.Color(),
    tmpM = new THREE.Color(),
    tmpH = new THREE.Color(),
    tmpD = new THREE.Vector3(),
    tmpS = new THREE.Vector3(),
    FOG_DAY = new THREE.Color('#9fb3c8');
  let k = 0,
    shadowK = -1;
  function render(settled) {
    if (r.shadowMap.enabled && (settled ? k !== shadowK : Math.abs(k - shadowK) > 0.015)) {
      r.shadowMap.needsUpdate = true;
      shadowK = k;
    }
    // sky colors
    const e = ss(0, 1, k);
    const top = tmpC.copy(cA.top).lerp(cB.top, e).getStyle(),
      mid = tmpM.copy(cA.mid).lerp(cB.mid, e).getStyle(),
      hor = tmpH.copy(cA.hor).lerp(cB.hor, e);
    const g = sx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top);
    g.addColorStop(0.55, mid);
    g.addColorStop(0.85, hor.getStyle());
    g.addColorStop(1, hor.getStyle());
    sx.fillStyle = g;
    sx.fillRect(0, 0, 2, 256);
    skyTex.needsUpdate = true;
    fog.color.copy(hor).lerp(FOG_DAY, e * 0.5);
    // camera
    const port = cam.aspect < 1,
      ca = -2.3 + k * 3.4,
      cd = (15 - k * 3.5) * (port ? 1.45 : 1);
    cam.position.set(
      PEAK.x + Math.cos(ca) * cd,
      6 + k * 3.6 + (port ? 2.5 : 0),
      PEAK.z + Math.sin(ca) * cd,
    );
    cam.lookAt(PEAK.x, 1.2 + k * 2.4, PEAK.z);
    // sun behind the mountain, rising
    const dir = tmpD.set(PEAK.x - cam.position.x, 0, PEAK.z - cam.position.z).normalize();
    const sp = tmpS.set(PEAK.x + dir.x * 30 + dir.z * 8, 0, PEAK.z + dir.z * 30 - dir.x * 8);
    sp.y = -1 + k * 8.5;
    sunSpr.position.copy(sp);
    sun.position.copy(sp);
    sun.intensity = 0.7 + k * 1.2;
    sun.color.setHSL(0.07 + k * 0.04, 0.8 - k * 0.5, 0.65 + k * 0.25);
    hemi.intensity = 0.55 + k * 0.4;
    hemi.color.copy(cA.mid).lerp(cB.mid, e);
    // path progress
    const segs = Math.floor((idxCount / segTris) * k) * segTris;
    path.geometry.setDrawRange(0, segs);
    const p = curve.getPointAt(Math.min(0.999, k));
    me.position.copy(p);
    halo.position.copy(p);
    r.render(sc, cam);
  }
  // render on demand only
  // ease k toward the scroll position so the camera glides instead of jumping
  let queued = false;
  const tick = (now) => {
    queued = false;
    if (!inView) return;
    const tk = reduce ? 1 : prog();
    // ease by elapsed time, not per frame, so the glide keeps its speed when frames drop
    const dt = chained ? Math.min(100, now - last) : 1000 / 60;
    k += (tk - k) * (1 - Math.pow(0.8, dt / (1000 / 60)));
    if (Math.abs(tk - k) < 0.0004) k = tk;
    setStep(stepAt(k));
    hint.style.opacity = k > 0.03 ? 0 : 1;
    if (chained) watchFrame(now - last);
    last = now;
    chained = k !== tk;
    render(!chained);
    root.classList.add('gl-on');
    if (chained) req();
  };
  // if the GPU cannot keep up, step down once: lower resolution, no shadows
  // measured between back-to-back animation frames, so GPU time counts too
  let slow = 0,
    frames = 0,
    last = 0,
    chained = false,
    lowered = false;
  const watchFrame = (ms) => {
    if (lowered || ++frames < 10) return;
    slow = ms > 25 ? slow + 1 : Math.max(0, slow - 1);
    if (slow < 8) return;
    lowered = true;
    r.setPixelRatio(1);
    r.shadowMap.enabled = false;
    sun.castShadow = false;
    sc.traverse((o) => o.material && (o.material.needsUpdate = true));
    size();
  };
  const req = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(tick);
  };
  // the page below the mountain scrolls too: draw nothing while the canvas is off screen
  let inView = true;
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView) req();
  }).observe(cv);
  addEventListener('scroll', req, { passive: true });
  addEventListener('resize', () => {
    size();
    req();
  });
  size();
  onAccent();
  req();
  path.geometry.setDrawRange(0, 0);
})();

function prog() {
  const t = document.getElementById('track');
  const m = t.offsetHeight - innerHeight;
  return m > 0 ? Math.min(1, Math.max(0, scrollY / m)) : 0;
}
function stepAt(k) {
  return k < 0.06 ? 0 : Math.min(5, 1 + Math.floor(((k - 0.06) / 0.94) * 5 * 0.999));
}
let sv = null;
try {
  sv = localStorage.getItem('acc3d');
} catch (e) {}
setA(sv || 'oranje');
setStep(0);
