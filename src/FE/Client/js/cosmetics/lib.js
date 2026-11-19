/*
 * Moved as it is from the approved prototype (ho-so-src/lib.js): only imports and exports were added,
 * plus the changes listed in cosmetics/README.md. The drawing is not to be redrawn or simplified.
 */

const $ = id => document.getElementById(id);
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const easeInOut = k => { k = clamp(k); return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const f2 = v => (+v).toFixed(2);
function rng(seed) { let s = (seed >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
const wob = (x, s = 0) => Math.sin(x + s) * 0.55 + Math.sin(x * 2.17 + s * 1.7) * 0.3 + Math.sin(x * 3.71 + s * 2.3) * 0.15; // smooth noise -1..1

/* svg -> image cache: vector art rasterised once per pixel size, then composited every frame. The bitmap matters: an
   <img> of an SVG is replayed on every draw, filters included, which on a GPU canvas costs far more than the pixels do. */
const IMG = new Map();
// One at a time, when the page has a moment: a burst of sprites arriving together must not be felt. Until then the <img> works.
const whenIdle = work => ('requestIdleCallback' in window ? requestIdleCallback(work, { timeout: 1000 }) : setTimeout(work, 50));
function bakeSvg(key, im) {
  if (!im.naturalWidth) return;
  const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  cv.getContext('2d').drawImage(im, 0, 0);
  cv.complete = true; cv.naturalWidth = im.naturalWidth; cv.naturalHeight = im.naturalHeight;
  IMG.set(key, cv);
}
function svgImg(key, build) {
  let im = IMG.get(key);
  if (!im) { im = new Image(); im.decoding = 'async'; im.addEventListener('load', () => whenIdle(() => bakeSvg(key, im)), { once: true }); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(build()); IMG.set(key, im); }
  return im.complete && im.naturalWidth ? im : null;
}
const SVG = (w, h, vb, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="${vb}"><defs>${defs}</defs>${body}</svg>`;

/* ================= materials: real lighting, micro-roughness, no plastic gloss ================= */
const MAT = {
  gold:    { base: ['#5a3a0e', '#b9862e', '#f1d58c', '#c3923a', '#6e4812'], spec: '#fff2cf', exp: 16, sc: 3.2, rough: .12, freq: '.9', k3: .62, blur: 1.3 },
  bronze:  { base: ['#3a2612', '#875a2c', '#c08a52', '#7a4e24', '#2c1c0c'], spec: '#ffd8a6', exp: 12, sc: 3, rough: .24, freq: '.75', k3: .38, blur: 1.4 },
  silver:  { base: ['#3e4552', '#a6afbd', '#eef2f7', '#8d97a6', '#363c47'], spec: '#ffffff', exp: 22, sc: 2.6, rough: .14, freq: '.015 .9', k3: .55, blur: 1.2 },
  steel:   { base: ['#101217', '#323843', '#5e6672', '#262a32', '#0b0c0f'], spec: '#d6e2ff', exp: 26, sc: 3, rough: .1, freq: '.8', k3: .5, blur: 1.3 },
  jade:    { base: ['#0a3324', '#1f7a57', '#62c89c', '#2a8a63', '#082a1d'], spec: '#eafff5', exp: 10, sc: 2, rough: .05, freq: '.4', k3: .32, blur: 1.6 },
  stone:   { base: ['#262b31', '#48515b', '#6c7580', '#3a424b', '#1b1f24'], spec: '#dde6ee', exp: 7, sc: 3.6, rough: .5, freq: '.55', k3: .14, blur: 1.4 },
  lacquer: { base: ['#2c0507', '#6e0e13', '#a3232b', '#640b10', '#230305'], spec: '#ffd9c9', exp: 24, sc: 2, rough: .05, freq: '.6', k3: .42, blur: 1.2 },
  bark:    { base: ['#1a100b', '#3a261a', '#55392a', '#2c1c13', '#140c08'], spec: '#e8c8a8', exp: 8, sc: 2.6, rough: .4, freq: '.9', k3: .16, blur: .9 },
  iron:    { base: ['#0d0e11', '#262a31', '#43474f', '#1c1f24', '#08090b'], spec: '#c8d0dc', exp: 14, sc: 3.2, rough: .3, freq: '.85', k3: .32, blur: 1.2 },
};
function fMat(id, m) {
  return `<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="${m.freq}" numOctaves="2" seed="7" result="n"/>
<feGaussianBlur in="SourceAlpha" stdDeviation="${m.blur}" result="b0"/>
<feComposite in="n" in2="b0" operator="arithmetic" k1="0" k2="${m.rough}" k3="1" k4="0" result="b"/>
<feDiffuseLighting in="b" surfaceScale="${m.sc}" diffuseConstant="1.18" lighting-color="#ffffff" result="d"><feDistantLight azimuth="225" elevation="50"/></feDiffuseLighting>
<feSpecularLighting in="b" surfaceScale="${m.sc}" specularConstant="1" specularExponent="${m.exp}" lighting-color="${m.spec}" result="s"><feDistantLight azimuth="225" elevation="36"/></feSpecularLighting>
<feComposite in="SourceGraphic" in2="d" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="lit"/>
<feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/>
<feComposite in="lit" in2="s2" operator="arithmetic" k1="0" k2="1" k3="${m.k3}" k4="0" result="o"/>
<feComposite in="o" in2="SourceAlpha" operator="in"/></filter>`;
}
function gMat(id, m, x2 = 1, y2 = 1) { return `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${m.base.map((c, i) => `<stop offset="${f2(i / (m.base.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient>`; }
const matDefs = (...names) => names.map(n => fMat('m-' + n, MAT[n]) + gMat('g-' + n, MAT[n])).join('');
const M = n => `filter="url(#m-${n})" fill="url(#g-${n})"`;
const patinaDef = (id = 'patina', rgb = [.30, .56, .47], freq = .06, cut = 1.45, seed = 11) => `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}"/><feColorMatrix type="matrix" values="0 0 0 0 ${rgb[0]}  0 0 0 0 ${rgb[1]}  0 0 0 0 ${rgb[2]}  3.2 0 0 0 -${cut}"/></filter>`;

/* geometry */
const C = (cx, cy, r) => `M${f2(cx + r)} ${f2(cy)}A${r} ${r} 0 1 0 ${f2(cx - r)} ${f2(cy)}A${r} ${r} 0 1 0 ${f2(cx + r)} ${f2(cy)}Z`;
const RING = (ro, ri, cx = 100, cy = 100) => C(cx, cy, ro) + C(cx, cy, ri);
function polyPts(n, r, rot = 0, cx = 100, cy = 100) { const a = []; for (let i = 0; i < n; i++) { const t = rot + i * TAU / n; a.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return a; }
const POLY = pts => 'M' + pts.map(p => f2(p[0]) + ' ' + f2(p[1])).join('L') + 'Z';
const around = (n, fn) => Array.from({ length: n }, (_, i) => fn(i, i * 360 / n)).join('');
// incised line: dark groove + light lip on the lit side
const inc = (d, w = 1, a = .55) => `<path d="${d}" fill="none" stroke="#000" stroke-opacity="${a}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#fff4dc" stroke-opacity="${a * .45}" stroke-width="${w * .6}" stroke-linecap="round" stroke-linejoin="round" transform="translate(.45 .55)"/>`;
// outline polygon around a spine (array of [x,y]) with width function w(s)
function ribbonPath(pts, wf, closeTip = true) {
  const L = [], R = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1, nx = -ty / l, ny = tx / l, w = wf(i / (n - 1)) / 2;
    L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); R.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  const all = L.concat(R.reverse());
  return 'M' + all.map(p => f2(p[0]) + ' ' + f2(p[1])).join('L') + (closeTip ? 'Z' : '');
}
function bez(p0, p1, p2, p3, n) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; }

/* motifs */
const CLOUD = 'M-5 1.5C-5.6-1.6-2.5-3.1-.8-1.2C-.2-3.7 3.6-3.9 4.7-1.4C5.5.6 3.6 2.2 2 1.2C1 .6 1.4-.8 2.6-.4M-5 1.5C-2.6 2.8 1.2 2.7 5.2 2.2';
const RUYI = 'M0-9C-6-9-9-4-6 0C-11-1-14 4-10 7H10C14 4 11-1 6 0C9-4 6-9 0-9Z';
const RUNES = [
  [[0, -6, 0, 6], [0, -5, 4, -2], [0, -1, 4, 2]],
  [[-3, -6, -3, 6], [-3, -6, 3, -1, -3, 4]],
  [[0, -6, 0, 6], [-4, -6, 0, -2, 4, -6]],
  [[-3, 6, -3, -6, 3, 0, -3, 6]],
  [[0, -6, 0, 6], [-4, -3, 4, 3], [-4, 3, 4, -3]],
  [[-3, -6, 3, 6], [3, -6, -3, 6]],
  [[-3, -6, -3, 6], [3, -6, 3, 6], [-3, -2, 3, 2]],
  [[0, -6, 0, 6], [0, -6, -4, -2], [0, 0, 4, 4]],
];
const runeD = g => g.map(l => 'M' + l.reduce((s, v, i) => s + (i % 2 ? ' ' : (i ? 'L' : '')) + v, '')).join('');

/* ================= sprite art (vector, rasterised once) ================= */
/* dragon: smooth tube + staggered fish scales + belly plates + flame crest, head drawn as an illustration */
const DRG = {
  tube: () => SVG(40, 100, '0 0 40 100', `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3608"/><stop offset=".1" stop-color="#b47a1e"/><stop offset=".28" stop-color="#f0cf78"/><stop offset=".44" stop-color="#d49a32"/><stop offset=".54" stop-color="#a86a18"/><stop offset=".58" stop-color="#dcc088"/><stop offset=".74" stop-color="#f2dfb2"/><stop offset=".92" stop-color="#d4b476"/><stop offset="1" stop-color="#9a7a40"/></linearGradient>`,
    `<rect x="0" y="0" width="40" height="100" rx="20" ry="50" fill="url(#b)"/>`),
  scale: () => SVG(40, 36, '0 0 40 36', `<radialGradient id="g" cx=".72" cy=".38" r=".85"><stop offset="0" stop-color="#fff0b8"/><stop offset=".4" stop-color="#f0c45a"/><stop offset=".8" stop-color="#b47a1c"/><stop offset="1" stop-color="#6a420a"/></radialGradient>`,
    `<path d="M40 1C22 1 3 7 2 18C3 29 22 35 40 35Z" fill="url(#g)"/><path d="M38 3C22 4 6 9 4.5 18C6 27 22 32 38 33" fill="none" stroke="#5a3404" stroke-opacity=".6" stroke-width="1.5"/><path d="M30 6C18 8 9 12 8 18" fill="none" stroke="#fffae6" stroke-opacity=".75" stroke-width="1.4" stroke-linecap="round"/>`),
  belly: () => SVG(30, 50, '0 0 30 50', `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcc088"/><stop offset=".45" stop-color="#f4e2b6"/><stop offset="1" stop-color="#c9a464"/></linearGradient>`,
    `<path d="M30 0C20 1 8 1 2 0C0 16 0 34 2 50C8 49 20 49 30 50Z" fill="url(#g)"/><path d="M2.5 1C1 17 1 33 2.5 49" fill="none" stroke="#9a7a40" stroke-opacity=".75" stroke-width="1.8"/><path d="M6 2C4.6 17 4.6 33 6 48" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="1.2"/>`),
  tuft: v => { // flame-fur tuft, root at bottom-right, strands sweep up and back
    const R = rng(17 + v * 31); let body = '';
    for (let i = 0; i < 11; i++) {
      const k = i / 10, rx = 44 - k * 10 + (R() - .5) * 4, ry = 78, len = 50 + R() * 26 - Math.abs(k - .45) * 30, ang = (-60 - k * 70 + (R() - .5) * 14) * D2R;
      const tx = rx + Math.cos(ang) * len, ty = ry + Math.sin(ang) * len, cx = rx + Math.cos(ang + .5) * len * .55, cy = ry + Math.sin(ang + .5) * len * .55;
      const pts = bez([rx, ry], [cx, cy], [lerp(cx, tx, .6) - 6, lerp(cy, ty, .6)], [tx, ty], 14);
      body += `<path d="${ribbonPath(pts, s => (1 - s) * (7 + R() * 2) + .2)}" fill="url(#g${i % 3})"/>`;
    }
    return SVG(60, 80, '0 0 60 80', [0, 1, 2].map(j => `<linearGradient id="g${j}" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${['#ffd25a', '#ffc040', '#ffe07a'][j]}"/><stop offset=".35" stop-color="${['#ff7a1e', '#f45a18', '#ff8a2a'][j]}"/><stop offset=".75" stop-color="${['#c8201a', '#a81414', '#d62a1a'][j]}"/><stop offset="1" stop-color="#6a0606" stop-opacity=".2"/></linearGradient>`).join(''), body);
  },
  fin: () => SVG(40, 50, '0 0 40 50', `<linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb23e"/><stop offset=".4" stop-color="#e2501e"/><stop offset="1" stop-color="#8a0e10"/></linearGradient>`,
    `<path d="M14 50C14 36 10 20 0 4C12 10 24 22 32 36C35 41 37 46 38 50Z" fill="url(#g)"/><path d="M16 49C16 37 12 25 5 12M25 49C25 41 21 32 15 24" fill="none" stroke="#4a0406" stroke-opacity=".4" stroke-width="1"/><path d="M0 4C12 10 24 22 32 36" fill="none" stroke="#ffe0a0" stroke-opacity=".55" stroke-width="1.1"/>`),
  leg: () => SVG(50, 80, '0 0 50 80', `<linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6a400e"/><stop offset=".45" stop-color="#e6bd6a"/><stop offset="1" stop-color="#835414"/></linearGradient><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6de"/><stop offset="1" stop-color="#9c7e50"/></linearGradient><linearGradient id="r" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a30"/><stop offset="1" stop-color="#8a0e10"/></linearGradient>`,
    `<path d="M12 6C4 14 2 24 4 34C0 30-2 34 0 28C1 20 5 12 12 6Z M16 30C10 34 8 40 9 46C6 42 6 36 9 32Z" fill="url(#r)"/><path d="M15 0C9 16 12 30 21 39L28 62L37 60L32 38C37 26 36 12 36 0Z" fill="url(#g)" stroke="#3a2004" stroke-opacity=".5" stroke-width="1"/><path d="M18 10Q26 13 34 9M19 20Q27 23 34 19M21 30Q28 33 34 29M25 44Q29 46 33 44M27 52Q30 54 34 52" fill="none" stroke="#4a2c06" stroke-opacity=".5" stroke-width="1.1"/>
<g fill="url(#c)" stroke="#4a3418" stroke-width=".6"><path d="M28 60C30 68 36 72 44 72C38 69 35 66 34 61Z"/><path d="M31 61C35 70 42 75 49 74C42 71 38 67 36 61Z"/><path d="M29 61C27 70 30 76 36 79C32 74 32 68 33 62Z"/><path d="M27 59C20 62 17 68 18 74C21 68 24 64 29 62Z"/></g>`),
  tail: () => SVG(80, 60, '0 0 80 60', `<linearGradient id="g" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffb43e"/><stop offset=".45" stop-color="#d8401a"/><stop offset="1" stop-color="#5a0608" stop-opacity="0"/></linearGradient>`,
    `<g fill="url(#g)"><path d="M80 30C62 18 40 6 6 2C30 14 46 22 58 28Z"/><path d="M80 30C58 26 30 26 0 30C28 34 46 36 60 33Z"/><path d="M80 30C62 40 40 52 8 58C30 46 46 38 58 32Z"/><path d="M80 30C66 14 50 6 30 0C46 10 56 20 66 28Z" opacity=".75"/><path d="M80 30C66 44 50 54 32 60C46 50 56 40 66 33Z" opacity=".75"/></g>`),
  head: () => SVG(200, 140, '0 0 200 140', matDefs('gold') + `<linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8e0a0"/><stop offset=".42" stop-color="#d49e3c"/><stop offset="1" stop-color="#7a4a10"/></linearGradient>
<linearGradient id="jg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ecc983"/><stop offset="1" stop-color="#8a5a18"/></linearGradient>
<linearGradient id="mn" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#ffb444"/><stop offset=".4" stop-color="#d6401c"/><stop offset=".85" stop-color="#7a0a0c" stop-opacity=".6"/><stop offset="1" stop-color="#5a0608" stop-opacity="0"/></linearGradient>
<linearGradient id="bd" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb444"/><stop offset=".5" stop-color="#cc3618"/><stop offset="1" stop-color="#5a0608" stop-opacity="0"/></linearGradient>
<linearGradient id="hn" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff5da"/><stop offset=".55" stop-color="#dcbc84"/><stop offset="1" stop-color="#8a6a3a"/></linearGradient>
<radialGradient id="ey" cx=".45" cy=".45" r=".6"><stop offset="0" stop-color="#fff8c8"/><stop offset=".45" stop-color="#ffc030"/><stop offset="1" stop-color="#b84a06"/></radialGradient>
<radialGradient id="ms" cx=".7" cy=".4" r=".8"><stop offset="0" stop-color="#8a1414"/><stop offset="1" stop-color="#260303"/></radialGradient>
<radialGradient id="ns" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fbe6ad"/><stop offset="1" stop-color="#b9842c"/></radialGradient>`,
    `<g fill="url(#mn)">
<path d="M78 44C62 34 42 38 28 30C16 24 8 16 2 14C12 22 18 32 30 38C44 46 60 48 74 54Z"/>
<path d="M72 58C56 52 36 58 22 54C12 51 6 46 0 46C8 54 16 62 28 64C42 66 58 64 70 68Z"/>
<path d="M72 74C58 72 40 82 26 82C16 82 8 78 2 78C10 86 20 92 32 92C46 92 60 86 72 84Z"/>
<path d="M78 88C66 92 54 104 42 108C32 111 24 110 18 112C28 116 40 118 50 114C62 110 72 100 82 94Z"/>
<path d="M82 34C72 22 56 18 42 10C50 20 58 28 70 36Z" opacity=".85"/></g>
<path d="M112 32C104 18 88 8 66 4C54 2 44 4 36 8C46 8 60 10 70 14C84 20 94 28 100 38Z" fill="#7a5a2e" opacity=".9"/>
<path d="M74 12C72 6 68 2 62 0C66 6 66 10 66 16Z" fill="#7a5a2e" opacity=".9"/>
<g fill="url(#bd)"><path d="M106 104C98 114 86 122 70 126C84 118 94 110 98 102Z"/><path d="M124 110C118 122 106 130 90 136C104 126 114 116 116 108Z"/><path d="M142 116C138 126 130 134 116 140C128 130 134 122 134 114Z"/><path d="M94 92C84 102 72 108 56 110C70 102 80 96 84 88Z"/></g>
<path d="M100 94C116 98 134 104 150 108C160 111 168 114 172 118C168 124 156 124 146 120C128 114 112 106 100 100Z" fill="url(#jg)" stroke="#3a1e04" stroke-opacity=".6" stroke-width="1.1"/>
<path d="M182 80C170 80 150 82 132 84C120 86 108 90 100 94C116 98 134 104 150 108C162 111 170 108 176 98C180 92 182 86 182 80Z" fill="url(#ms)"/>
<path d="M148 104C162 102 178 104 188 112C194 116 196 122 196 128C192 122 188 120 184 122C186 116 180 112 172 110C162 108 154 108 148 106Z" fill="#c8242a"/>
<g fill="#fffaf0" stroke="#5a4428" stroke-width=".5"><path d="M168 80L171.5 95L175 80Z"/><path d="M154 82L156 91L158 82Z"/><path d="M141 84L142.5 90L144 84Z"/><path d="M160 112L163 98L166 113Z"/><path d="M146 107L148 100L150 108Z"/></g>
<g filter="url(#m-gold)"><path d="M60 74C58 56 68 40 86 32C98 26 112 26 122 32C132 38 138 44 146 46C154 48 162 44 170 42C180 40 190 46 190 56C190 64 184 68 178 70C182 72 184 76 182 80C176 80 168 78 160 80L132 84C120 86 108 90 98 94C82 98 64 90 60 74Z" fill="url(#hg)"/></g>
<path d="M60 74C58 56 68 40 86 32C98 26 112 26 122 32C132 38 138 44 146 46C154 48 162 44 170 42C180 40 190 46 190 56C190 64 184 68 178 70C182 72 184 76 182 80C176 80 168 78 160 80L132 84C120 86 108 90 98 94C82 98 64 90 60 74Z" fill="none" stroke="#3a1e04" stroke-opacity=".6" stroke-width="1.2"/>
<path d="M118 36C110 22 94 12 72 8C60 6 50 8 42 12C52 12 66 14 76 18C90 24 100 32 106 42Z" fill="url(#hn)" stroke="#5a4020" stroke-opacity=".6" stroke-width=".8"/>
<path d="M80 16C78 10 74 4 68 2C72 8 72 14 72 20Z" fill="url(#hn)" stroke="#5a4020" stroke-opacity=".5" stroke-width=".6"/>
<ellipse cx="178" cy="52" rx="11" ry="9.5" fill="url(#ns)" stroke="#3a1e04" stroke-opacity=".5"/><path d="M183 56C187 52 184 47 179 48C175 49 176 54 180 54" fill="none" stroke="#2a1004" stroke-width="1.7" stroke-linecap="round"/>
<g fill="url(#mn)"><path d="M104 42C98 32 88 24 74 22C84 28 90 36 92 44Z"/><path d="M116 38C114 28 108 20 98 16C104 24 106 32 106 40Z"/></g>
<g filter="url(#m-gold)" fill="url(#hg)"><path d="M100 48C108 34 126 32 138 42C130 43 120 46 112 52Z"/></g>
<path d="M108 58C113 50 127 48 135 54C128 60 116 62 108 58Z" fill="#1e0a02"/><path d="M110.5 57.2C115 51.5 126 50.5 132 54.2C126 58.5 116 60 110.5 57.2Z" fill="url(#ey)"/><ellipse cx="122" cy="54.8" rx="1.3" ry="3.4" fill="#120400"/><circle cx="118.6" cy="53.2" r="1.1" fill="#fff"/>
<path d="M106 55C114 46 130 45 138 52" fill="none" stroke="#7a1406" stroke-width="1.8" stroke-linecap="round"/>
<g fill="none" stroke="#4a2a06" stroke-opacity=".45" stroke-width="1.1" stroke-linecap="round"><path d="M144 54Q148 58 144 62M153 53Q157 57 153 61M162 52Q166 56 162 60M72 70C82 74 94 76 106 74M78 82C88 84 100 82 112 80M140 70C150 72 160 72 170 70"/></g>
<path d="M68 48C78 38 92 34 104 34" fill="none" stroke="#fff4cc" stroke-opacity=".55" stroke-width="1.5" stroke-linecap="round"/><path d="M170 44C178 41 186 44 188 50" fill="none" stroke="#fff4cc" stroke-opacity=".75" stroke-width="1.4" stroke-linecap="round"/>
<g fill="url(#bd)"><path d="M90 88C84 98 74 106 60 110C72 102 80 94 82 86Z"/></g>`),
  pearlFlame: () => SVG(64, 64, '0 0 64 64', `<radialGradient id="p" cx=".4" cy=".38" r=".62"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#fff2c4"/><stop offset=".8" stop-color="#f0b84a"/><stop offset="1" stop-color="#a8681a"/></radialGradient>`,
    `<circle cx="32" cy="32" r="13" fill="url(#p)"/><path d="M26 25C28 22 33 21 36 23" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="1.6" stroke-linecap="round"/>`),
};
/* phoenix bodies */
const PHX = {
  front: () => SVG(100, 140, '0 0 100 140', `<radialGradient id="ch" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#ffe28a"/><stop offset=".45" stop-color="#ff8a24"/><stop offset=".85" stop-color="#c8281a"/><stop offset="1" stop-color="#6a0808"/></radialGradient>
<linearGradient id="nk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffcf6a"/><stop offset=".6" stop-color="#f06420"/><stop offset="1" stop-color="#a81818"/></linearGradient>
<linearGradient id="cr" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#ffd25a"/><stop offset=".5" stop-color="#ff6a1a"/><stop offset="1" stop-color="#b01414" stop-opacity=".2"/></linearGradient>
<linearGradient id="bk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c8"/><stop offset="1" stop-color="#b8862e"/></linearGradient>`,
    `<g fill="url(#cr)"><path d="M48 18C54 8 66 2 80 2C70 6 62 12 58 20Z"/><path d="M50 20C58 14 70 12 84 14C72 16 64 20 58 26Z"/><path d="M50 24C58 22 68 24 78 30C66 28 58 28 54 30Z"/></g>
<path d="M28 36C18 48 22 64 34 72C26 84 24 98 30 112C38 128 50 138 50 138C50 138 62 128 70 112C76 98 74 84 66 72C78 64 82 48 72 36C62 30 38 30 28 36Z" fill="url(#ch)"/>
<path d="M34 30C30 40 32 52 42 62C46 54 48 44 50 34C48 26 40 24 34 30Z" fill="url(#nk)"/>
${Array.from({ length: 6 }, (_, r) => Array.from({ length: 4 + (r % 2) }, (_, i) => { const y = 74 + r * 9, x = 50 + (i - (3 + (r % 2)) / 2) * 7.5; return `<path d="M${x - 4} ${y}Q${x} ${y + 6} ${x + 4} ${y}" fill="none" stroke="#7a1206" stroke-opacity=".45" stroke-width="1"/><path d="M${x - 3} ${y + 1}Q${x} ${y + 4.5} ${x + 3} ${y + 1}" fill="none" stroke="#fff0b0" stroke-opacity=".4" stroke-width=".7"/>`; }).join('')).join('')}
<circle cx="40" cy="26" r="9.5" fill="url(#nk)"/><path d="M31 24C26 24 20 26 17 30C22 30 26 31 31 31Z" fill="url(#bk)"/><path d="M17 30C19 32 22 32 24 31" fill="none" stroke="#6a4a1a" stroke-width="1"/>
<path d="M34 24C36 21 41 20 44 22C42 25 37 26 34 24Z" fill="#2a0604"/><circle cx="39.5" cy="23" r="1.6" fill="#ffd040"/><circle cx="39.5" cy="23" r=".7" fill="#120200"/>
<path d="M32 32C34 38 38 40 42 40" fill="none" stroke="#ffe08a" stroke-opacity=".7" stroke-width="1.4"/>`),
  side: () => SVG(170, 90, '0 0 170 90', `<linearGradient id="bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a30"/><stop offset=".5" stop-color="#e2401a"/><stop offset="1" stop-color="#8a1010"/></linearGradient><linearGradient id="nk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e2401a"/><stop offset="1" stop-color="#ffc84a"/></linearGradient><linearGradient id="cr" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffd25a"/><stop offset=".5" stop-color="#ff6a1a"/><stop offset="1" stop-color="#b01414" stop-opacity=".2"/></linearGradient><linearGradient id="bk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c8"/><stop offset="1" stop-color="#b8862e"/></linearGradient>`,
    `<g fill="url(#cr)"><path d="M140 24C130 12 116 6 100 6C112 10 120 16 126 24Z"/><path d="M138 28C126 22 112 22 98 26C110 28 120 30 128 32Z"/></g>
<path d="M20 52C40 36 80 34 112 42C126 46 134 50 138 52C130 62 110 68 86 68C58 68 36 62 20 52Z" fill="url(#bd)"/>
<path d="M104 46C116 36 126 28 136 26C144 26 148 30 146 36C142 44 132 50 120 54Z" fill="url(#nk)"/>
<circle cx="142" cy="30" r="9" fill="url(#nk)"/><path d="M150 28C156 28 162 30 166 34C160 35 156 35 150 35Z" fill="url(#bk)"/>
<path d="M140 27C142 24 147 24 149 26C147 29 142 30 140 27Z" fill="#2a0604"/><circle cx="145" cy="26.6" r="1.5" fill="#ffd040"/>
${Array.from({ length: 5 }, (_, i) => `<path d="M${50 + i * 14} 50Q${56 + i * 14} 56 ${50 + i * 14} 62" fill="none" stroke="#fff0b0" stroke-opacity=".35" stroke-width=".9"/>`).join('')}`),
};
// whisker anchor points & neck in head-sprite space
const HEAD = { w: 200, h: 140, neck: [66, 74], snout: [[188, 62], [182, 74]] };

/* feathers */
const FEA = {
  fire: { a: '#ffe7a0', b: '#ff9a2a', c: '#d23a14', d: '#5a0606', r: '#fff1c8', e: '#ffd890' },
  dark: { a: '#4a405e', b: '#2a2238', c: '#15111d', d: '#08060c', r: '#a898c4', e: '#9a88b8' },
  ash:  { a: '#f4f1ea', b: '#cfc8bb', c: '#8c8478', d: '#3a352e', r: '#ffffff', e: '#ffffff' },
};
function featherSVG(p, kind) {
  if (kind === 'cov') return SVG(40, 60, '0 0 40 60', `<linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${p.a}"/><stop offset=".55" stop-color="${p.b}"/><stop offset="1" stop-color="${p.c}"/></linearGradient>`,
    `<path d="M20 60C8 50 2 30 6 14C9 4 16 0 20 0C24 0 31 4 34 14C38 30 32 50 20 60Z" fill="url(#g)"/><path d="M20 58V6" stroke="${p.r}" stroke-opacity=".55" stroke-width="1.2"/><path d="M6 14C9 4 16 0 20 0C24 0 31 4 34 14" fill="none" stroke="${p.e}" stroke-opacity=".55" stroke-width="1"/>`);
  if (kind === 'tail') return SVG(40, 240, '0 0 40 240', `<linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${p.a}"/><stop offset=".45" stop-color="${p.b}"/><stop offset=".8" stop-color="${p.c}"/><stop offset="1" stop-color="${p.d}"/></linearGradient><radialGradient id="e" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0a1a4a"/><stop offset=".35" stop-color="#1a5ab8"/><stop offset=".55" stop-color="#22b8a8"/><stop offset=".72" stop-color="#ffd76a"/><stop offset=".9" stop-color="#c8501a"/><stop offset="1" stop-color="#c8501a" stop-opacity="0"/></radialGradient>`,
    `<path d="M20 240C17 180 10 110 8 60C7 30 12 8 20 2C28 8 33 30 32 60C30 110 23 180 20 240Z" fill="url(#g)"/>${Array.from({ length: 22 }, (_, i) => { const y = 40 + i * 9; return `<path d="M20 ${y}L${8 + i * .3} ${y - 8}M20 ${y}L${32 - i * .3} ${y - 8}" stroke="${p.d}" stroke-opacity=".28" stroke-width=".8"/>`; }).join('')}<path d="M20 238V8" stroke="${p.r}" stroke-opacity=".55" stroke-width="1"/><ellipse cx="20" cy="34" rx="12" ry="17" fill="url(#e)"/>`);
  return SVG(40, 200, '0 0 40 200', `<linearGradient id="g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${p.a}"/><stop offset=".4" stop-color="${p.b}"/><stop offset=".8" stop-color="${p.c}"/><stop offset="1" stop-color="${p.d}"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>`,
    `<path d="M20 200C10 160 3 100 6 50C8 20 14 4 20 0C26 4 33 22 35 52C37 100 30 160 20 200Z" fill="url(#g)"/><path d="M20 200C10 160 3 100 6 50C8 20 14 4 20 0C26 4 33 22 35 52C37 100 30 160 20 200Z" fill="url(#s)"/>${Array.from({ length: 16 }, (_, i) => { const y = 30 + i * 10; return `<path d="M20 ${y}L${9 + i * .35} ${y - 10}M20 ${y}L${32 - i * .3} ${y - 9}" stroke="${p.d}" stroke-opacity=".25" stroke-width=".8"/>`; }).join('')}<path d="M20 198V4" stroke="${p.r}" stroke-opacity=".6" stroke-width="1.1"/><path d="M6 50C8 20 14 4 20 0" fill="none" stroke="${p.e}" stroke-opacity=".5" stroke-width=".9"/>`);
}
/* the noise filter outputs white; tint it with a flood */
const smokeTint = (seed, rgb) => SVG(160, 160, '0 0 160 160', `<filter id="t" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".024" numOctaves="4" seed="${seed}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.8 0 0 0 -1.15" result="a"/><feFlood flood-color="rgb(${rgb})"/><feComposite in2="a" operator="in"/></filter><radialGradient id="r" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="m"><rect width="160" height="160" fill="url(#r)"/></mask>`,
  `<g mask="url(#m)"><rect width="160" height="160" filter="url(#t)"/></g>`);

/* sprite fetch at a pixel size bucket */
function spr(name, build, px) { const b = px <= 64 ? 64 : px <= 128 ? 128 : px <= 256 ? 256 : 512; return svgImg(name + '@' + b, () => build().replace(/width="\d+" height="\d+"/, m => { const [w, h] = m.match(/\d+/g).map(Number), s = b / Math.max(w, h); return `width="${Math.round(w * s)}" height="${Math.round(h * s)}"`; })); }
const SPR = {
  tube: px => spr('dtube', DRG.tube, px), tuft0: px => spr('dtuft0', () => DRG.tuft(0), px), tuft1: px => spr('dtuft1', () => DRG.tuft(1), px), scale: px => spr('dscale', DRG.scale, px), belly: px => spr('dbelly', DRG.belly, px),
  fin: px => spr('dfin', DRG.fin, px), leg: px => spr('dleg', DRG.leg, px), tail: px => spr('dtail', DRG.tail, px),
  head: px => spr('dhead', DRG.head, px), phF: px => spr('phF', PHX.front, px), phS: px => spr('phS', PHX.side, px), pearl: px => spr('dpearl', DRG.pearlFlame, px),
  fea: (pal, kind, px) => spr('fea-' + pal + kind, () => featherSVG(FEA[pal], kind), px),
  smoke: (i, rgb, px) => spr('smk' + i + rgb, () => smokeTint(3 + i * 7, rgb), px),
};

/* ================= living renderers (canvas, every frame) ================= */
// sample a polyline by arc length
function arcSampler(pts) {
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = L[L.length - 1];
  return { total, at(d) { d = clamp(d, 0, total); let i = 1; while (i < L.length - 1 && L[i] < d) i++; const k = (d - L[i - 1]) / ((L[i] - L[i - 1]) || 1), a = pts[i - 1], b = pts[i]; return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), a: Math.atan2(b[1] - a[1], b[0] - a[0]) }; } };
}
/* dragon. pts: spine tail->head. o: { w: body width, belly: (x,y,a)=>+1|-1 (which side the belly is on), px: device px per unit, t, headScale } */
function drawDragon(c, pts, o) {
  const S = arcSampler(pts), W = o.w, px = o.px || 1, T = S.total, t = o.t || 0;
  const prof = s => W * (0.14 + 0.86 * ss(0, 0.5, s)) * (1 - 0.12 * ss(0.86, 1, s));
  const I = { tube: SPR.tube(W * px), sc: SPR.scale(W * 0.5 * px), be: SPR.belly(W * 0.6 * px), t0: SPR.tuft0(W * 1.2 * px), t1: SPR.tuft1(W * 1.2 * px), leg: SPR.leg(W * 1.6 * px), head: SPR.head(W * 3.6 * px) };
  for (const k in I) if (!I[k]) return;
  const flipOf = p => (o.belly ? o.belly(p.x, p.y, p.a) : (Math.cos(p.a) >= 0 ? 1 : -1));
  const put = (img, p, dx, dy, w, h, f, rot = 0) => { c.save(); c.translate(p.x, p.y); c.rotate(p.a); if (f < 0) c.scale(1, -1); if (rot) c.rotate(rot); c.drawImage(img, dx, dy, w, h); c.restore(); };
  const sway = (k) => Math.sin(t * 1.3 + k) * 0.08;
  // tail flame: a fan of tufts at the tip
  { const p = S.at(W * 0.15), f = flipOf(p); for (const [r, sc, im] of [[2.5, 1.5, I.t0], [3.0, 1.7, I.t1], [3.5, 1.4, I.t0], [2.1, 1.2, I.t1]]) put(im, p, -W * 0.9 * sc, -W * 0.95 * sc, W * 0.9 * sc, W * 1.2 * sc, f, r + sway(r)); }
  // flame tufts along the spine, behind the body
  let k = 0; for (let d = W * 1.2; d < T - W * 1.6; d += W * 1.05, k++) { const s = d / T, p = S.at(d), w = prof(s), sc = k % 2 ? 0.85 : 1.1; put(k % 2 ? I.t1 : I.t0, p, -w * 0.95 * sc, -w * 0.35 - w * 1.05 * sc, w * 0.85 * sc, w * 1.1 * sc, flipOf(p), sway(k) - 0.15); }
  // legs with flame elbows
  const legs = [[0.36, -0.55], [0.44, 0.25], [0.72, -0.5], [0.8, 0.3]];
  const leg = (s, sw, near) => { const p = S.at(s * T), w = prof(s), f = flipOf(p), wig = Math.sin(t * 1.2 + s * 9) * 0.12;
    if (!near) c.globalAlpha = 0.82; put(I.leg, p, -w * 0.38, w * 0.0, w * 1.05, w * 1.75, f, sw + wig); c.globalAlpha = 1;
    put(I.t1, p, -w * 1.1, -w * 0.05, w * 0.9, w * 1.15, f, sw + wig + 2.5); };
  leg(0.36, -0.55, false); leg(0.72, -0.5, false);
  // smooth tube with pale belly
  for (let d = 0; d <= T; d += W * 0.08) { const s = d / T, p = S.at(d), w = prof(s); put(I.tube, p, -w * 0.2, -w / 2, w * 0.4, w, flipOf(p)); }
  // segmented belly plates
  for (let d = W * 0.4; d <= T - W * 0.3; d += W * 0.24) { const s = d / T, p = S.at(d), w = prof(s); put(I.be, p, -w * 0.13, w * 0.07, w * 0.26, w * 0.42, flipOf(p)); }
  // staggered fish scales over back and flanks
  let row = 0;
  for (let d = W * 0.2; d <= T - W * 0.2; d += W * 0.17, row++) {
    const s = d / T, p = S.at(d), w = prof(s), f = flipOf(p);
    for (const off of (row % 2 ? [-0.38, -0.17, 0.04] : [-0.28, -0.07])) put(I.sc, p, -w * 0.13, w * off - w * 0.14, w * 0.32, w * 0.28, f);
  }
  leg(0.45, 0.25, true); leg(0.81, 0.3, true);
  // head: mane tufts behind, whiskers, then the head illustration
  const ph = S.at(T), fh = flipOf(ph), hs = W * (o.headScale || 3.5) / HEAD.w;
  c.save(); c.translate(ph.x, ph.y); c.rotate(ph.a); if (fh < 0) c.scale(1, -1); c.scale(hs, hs); c.translate(-HEAD.neck[0], -HEAD.neck[1]);
  for (const [x, y, r, s, im] of [[70, 20, -0.5, 70, I.t0], [62, 56, -1.1, 80, I.t1], [70, 84, -1.7, 70, I.t0], [84, 30, -0.2, 56, I.t1], [76, 100, -2.2, 54, I.t1]]) { c.save(); c.translate(x, y); c.rotate(r + sway(x) * 0.8); c.drawImage(im, -s * 0.75, -s, s * 0.75, s); c.restore(); }
  c.lineCap = 'round';
  HEAD.snout.forEach(([x, y], k) => {
    const tt = t * 1.1 + k * 1.9; c.strokeStyle = k ? 'rgba(236,196,116,.85)' : 'rgba(255,234,172,.95)'; c.lineWidth = 2.6 - k * 0.6; c.beginPath(); c.moveTo(x, y);
    c.bezierCurveTo(x + 14, y + 6 + Math.sin(tt) * 5, x - 10 + Math.sin(tt + 1) * 8, y + 40 + k * 8, x - 60 + Math.sin(tt + 2) * 12, y + 50 + k * 20 + Math.sin(tt + 1.4) * 9); c.stroke();
  });
  c.drawImage(I.head, 0, 0, HEAD.w, HEAD.h);
  c.restore();
}
/* bird wing built on a real wing skeleton: shoulder -> elbow -> wrist -> tip; feathers hang from the leading edge */
function drawWing(c, x, y, side, size, t, pal, o = {}) {
  const px = o.px || 1, prim = SPR.fea(pal, 'pri', size * 0.8 * px), cov = SPR.fea(pal, 'cov', size * 0.3 * px); if (!prim || !cov) return;
  const breath = o.breath ?? Math.sin(t * 0.9) * 0.05, raise = (o.raise ?? 0) + breath; // radians
  const bones = o.bones || [[0, 0], [0.3, -0.26], [0.5, -0.56], [0.58, -0.8]];
  const L = [0]; for (let i = 1; i < bones.length; i++) L.push(L[i - 1] + Math.hypot(bones[i][0] - bones[i - 1][0], bones[i][1] - bones[i - 1][1]));
  const edge = u => { const d = u * L[L.length - 1]; let i = 1; while (i < L.length - 1 && L[i] < d) i++; const k = (d - L[i - 1]) / (L[i] - L[i - 1]); return [lerp(bones[i - 1][0], bones[i][0], k), lerp(bones[i - 1][1], bones[i][1], k)]; };
  c.save(); c.translate(x, y); c.scale(side * size, size); c.rotate(-raise);
  const feather = (img, u, ang, len, wid) => { const [ex, ey] = edge(u); c.save(); c.translate(ex, ey); c.rotate(ang + Math.PI / 2); c.drawImage(img, -wid / 2, -len, wid, len); c.restore(); };
  const J = rng(o.seed || 5);
  const fan = (n, img, lenF, widF, angF, u0 = 0, u1 = 1) => { for (let i = 0; i < n; i++) { const u = lerp(u0, u1, i / (n - 1)), ja = (J() - .5) * 0.07, jl = 1 + (J() - .5) * 0.1; feather(img, u, angF(u) + breath * u * 0.8 + ja, lenF(u) * jl, widF(u)); } };
  // primaries & secondaries: from pointing down (shoulder) to pointing up-out (tip)
  const ang = u => lerp(78, -48, Math.pow(u, 0.85)) * D2R;
  fan(o.n || 17, prim, u => lerp(0.42, 0.78, ss(0, 0.75, u)) * (1 - 0.12 * ss(0.9, 1, u)), u => 0.1, ang, 0.02, 1);
  fan(13, prim, u => lerp(0.26, 0.42, u), u => 0.09, u => ang(u) - 0.12, 0.02, 0.92);
  fan(14, prim, u => lerp(0.17, 0.26, u), u => 0.085, u => ang(u) - 0.22, 0.0, 0.86);
  fan(12, cov, u => lerp(0.13, 0.16, u), u => 0.1, u => ang(u) - 0.4, 0.0, 0.78);
  fan(9, cov, u => 0.085, u => 0.08, u => ang(u) - 0.65, 0.0, 0.62);
  c.restore();
}
/* flowing tail plume: spine via a function returning points; tapered with barbs and an eye */
function drawPlume(c, pts, w0, pal, px) {
  const img = SPR.fea(pal, 'tail', w0 * 12 * (px || 1)); if (!img) return;
  // stamp the long feather sprite along the curve as slices for a smooth bend
  const S = arcSampler(pts), L = S.total, n = 26, sw = img.naturalWidth, sh = img.naturalHeight;
  for (let i = 0; i < n; i++) {
    const d0 = L * i / n, d1 = L * (i + 1) / n, p = S.at((d0 + d1) / 2), segL = (d1 - d0) * 1.25;
    const sy = sh * (1 - (i + 1) / n), sH = sh / n; // feather sprite base at bottom -> stamp from base (start of curve) to tip
    c.save(); c.translate(p.x, p.y); c.rotate(p.a + Math.PI / 2); c.drawImage(img, 0, sy, sw, sH * 1.25, -w0 / 2, -segL / 2, w0, segL); c.restore();
  }
}
// tapered ribbon spine helper for plumes/ribbons: base point, end point, sway
function swayCurve(x0, y0, x1, y1, bx, by, amp, t, phase, n = 24) {
  const o = []; for (let i = 0; i <= n; i++) { const s = i / n, u = 1 - s; let x = u * u * x0 + 2 * u * s * bx + s * s * x1, y = u * u * y0 + 2 * u * s * by + s * s * y1;
    const tx = 2 * u * (bx - x0) + 2 * s * (x1 - bx), ty = 2 * u * (by - y0) + 2 * s * (y1 - by), l = Math.hypot(tx, ty) || 1, off = Math.sin(t - s * 4.2 + phase) * amp * s * s;
    o.push([x - ty / l * off, y + tx / l * off]); } return o;
}
function glow(c, x, y, r, rgb, a, mode = 'lighter') { if (r <= 0 || a <= 0.002) return; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(.4, `rgba(${rgb},${a * .45})`); g.addColorStop(1, `rgba(${rgb},0)`); const p = c.globalCompositeOperation; c.globalCompositeOperation = mode; c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r); c.globalCompositeOperation = p; }
/* slow drifting motes: deterministic, smooth fade, no flicker */
function motes(c, n, seed, t, box, rgb, size, speed, a = .8) {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const life = 4 + R() * 3, ph = R() * life, u = ((t * speed + ph) % life) / life, x0 = box[0] + R() * box[2], y0 = box[1] + R() * box[3], dx = (R() - .5) * 14, dy = -(10 + R() * 18);
    const x = x0 + dx * u + Math.sin(t * .7 + i) * 2, y = y0 + dy * u, al = Math.sin(u * Math.PI) * a, s = size * (0.6 + R() * 0.7);
    glow(c, x, y, s * 3.2, rgb, al * 0.5); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(${rgb},${al})`; c.beginPath(); c.arc(x, y, s * 0.55, 0, TAU); c.fill(); c.globalCompositeOperation = 'source-over';
  }
}
/* drifting smoke wisps */
function smoke(c, n, seed, t, box, rgb, size, alpha, rise = 12, px = 1) {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    const img = SPR.smoke(i % 3, rgb, size * 2 * px); if (!img) continue;
    const life = 6 + R() * 4, ph = R() * life, u = ((t + ph) % life) / life, x = box[0] + R() * box[2] + Math.sin(t * .3 + i) * 6 + u * (R() - .3) * 18, y = box[1] + R() * box[3] - u * rise, s = size * (0.7 + u * 0.8), a = Math.sin(u * Math.PI) * alpha;
    c.save(); c.globalAlpha = a; c.translate(x, y); c.rotate(i + t * 0.05 * (i % 2 ? 1 : -1)); c.drawImage(img, -s, -s, s * 2, s * 2); c.restore();
  }
}
/* candle flame: smooth, organic */
function flame(c, x, y, h, t, seed) {
  const f = 1 + wob(t * 2.2, seed) * 0.12, lean = wob(t * 1.3, seed + 5) * 0.12, H = h * f;
  glow(c, x, y - H * 0.45, h * 3.2, '255,150,60', 0.22 + 0.06 * wob(t * 2, seed));
  c.save(); c.translate(x, y); c.rotate(lean);
  const g = c.createLinearGradient(0, 0, 0, -H); g.addColorStop(0, 'rgba(255,248,220,.95)'); g.addColorStop(.35, 'rgba(255,214,120,.9)'); g.addColorStop(.75, 'rgba(255,120,40,.65)'); g.addColorStop(1, 'rgba(200,40,20,0)');
  c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(h * .32, -H * .1, h * .26, -H * .55, 0, -H); c.bezierCurveTo(-h * .26, -H * .55, -h * .32, -H * .1, 0, 0); c.fill();
  c.fillStyle = 'rgba(120,170,255,.45)'; c.beginPath(); c.ellipse(0, -H * 0.08, h * 0.1, H * 0.1, 0, 0, TAU); c.fill();
  c.restore();
}

/* phoenix, facing the viewer with wings raised (frames, landing, flying toward camera) */
function drawPhoenixFront(c, x, y, s, t, o = {}) {
  const px = o.px || 1, body = SPR.phF(s * 1.4 * px); if (!body) return;
  const br = o.breath ?? Math.sin(t * 0.9) * 0.045;
  if (!o.noTail) for (let i = 0; i < 9; i++) { const k = i / 8, side = k < .45 ? -1 : 1, ex = x + lerp(-0.75, 0.95, k) * s, ey = y + s * (1.15 + Math.sin(k * 3) * 0.2);
    flamePlume(c, swayCurve(x + (k - .5) * s * 0.1, y + s * 0.5, ex, ey, x + lerp(-0.2, 0.35, k) * s, y + s * 1.05, s * 0.1, t * 1.1, i * 0.8, 20), s * (0.16 - Math.abs(k - .5) * 0.08), 0.95); }
  drawWing(c, x - s * 0.1, y + s * 0.02, -1, s * (o.wing || 1.15), t, 'fire', { px, breath: br, seed: 3, raise: o.raise || 0 });
  drawWing(c, x + s * 0.1, y + s * 0.02, 1, s * (o.wing || 1.15), t, 'fire', { px, breath: br, seed: 9, raise: o.raise || 0 });
  if (!o.bodyless) c.drawImage(body, x - s * 0.42, y - s * 0.42, s * 0.84, s * 1.18);
}
/* phoenix flying sideways (entrance) : flap 0..1 phase */
function drawPhoenixSide(c, x, y, s, t, flap, o = {}) {
  const px = o.px || 1, body = SPR.phS(s * 1.6 * px); if (!body) return;
  const dir = o.dir || 1;
  c.save(); c.translate(x, y); c.scale(dir, 1);
  for (let i = 0; i < 6; i++) { const k = i / 5; drawPlume(c, swayCurve(-s * 0.4, s * 0.06, -s * (1.5 + k * 0.6), s * (0.1 + (k - .5) * 0.5), -s * 0.95, s * (0.05 + (k - .5) * 0.2), s * 0.09, t * 2, i), s * (0.12 - k * 0.02), 'fire', px); }
  const up = Math.sin(flap * TAU) ; // -1..1
  drawWing(c, -s * 0.05, -s * 0.05, 1, s * 1.0, t, 'fire', { px, breath: 0, raise: -0.9 + up * 0.75, seed: 4, bones: [[0, 0], [0.32, -0.2], [0.55, -0.46], [0.66, -0.66]] });
  c.drawImage(body, -s * 0.7, -s * 0.33, s * 1.05, s * 0.56);
  drawWing(c, s * 0.08, -s * 0.02, 1, s * 1.05, t, 'fire', { px, breath: 0, raise: -1.1 + up * 0.85, seed: 7 });
  c.restore();
}

/* flowing flame plume (phoenix tail): tapered ribbon, warm gradient, splits into licks at the tip */
function flamePlume(c, pts, w0, a = 1, licks = true) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)], tx = q[0] - p[0], ty = q[1] - p[1], l = Math.hypot(tx, ty) || 1, s = i / (n - 1), w = w0 * Math.sin(Math.PI * (0.1 + s * 0.88)) * (1 - 0.55 * s) / 2;
    L.push([pts[i][0] - ty / l * w, pts[i][1] + tx / l * w]); R.push([pts[i][0] + ty / l * w, pts[i][1] - tx / l * w]); }
  const g = c.createLinearGradient(pts[0][0], pts[0][1], pts[n - 1][0], pts[n - 1][1]);
  g.addColorStop(0, `rgba(255,214,96,${a})`); g.addColorStop(.3, `rgba(255,140,36,${a})`); g.addColorStop(.68, `rgba(214,46,22,${a * .9})`); g.addColorStop(1, 'rgba(120,8,8,0)');
  c.fillStyle = g; c.beginPath(); c.moveTo(L[0][0], L[0][1]); for (const p of L) c.lineTo(p[0], p[1]); for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]); c.closePath(); c.fill();
  // rachis highlight
  c.strokeStyle = `rgba(255,240,190,${0.5 * a})`; c.lineWidth = Math.max(0.4, w0 * 0.05); c.beginPath(); for (let i = 0; i < n * 0.75; i++) c[i ? 'lineTo' : 'moveTo'](pts[i][0], pts[i][1]); c.stroke();
  if (!licks) return;
  // licks at the tip
  const e = pts[n - 1], m = pts[Math.floor(n * 0.72)];
  for (let k = -1; k <= 1; k++) { const dx = e[0] - m[0], dy = e[1] - m[1]; c.strokeStyle = `rgba(255,130,50,${0.22 * a})`; c.lineWidth = w0 * 0.06; c.beginPath(); c.moveTo(m[0], m[1]); c.quadraticCurveTo(e[0] + k * dy * 0.25, e[1] - k * dx * 0.25, e[0] + dx * 0.12 + k * dy * 0.3, e[1] + dy * 0.12 - k * dx * 0.3); c.stroke(); }
}

/* a colour with the hue of a tint and its own lightness, so what was dark stays dark. Without a tint it comes back untouched. */
const TINTED = new Map();
function retint(color, tint) {
  if (!tint) return color;
  const key = tint + '|' + color; let out = TINTED.get(key); if (out) return out;
  const hex = color[0] === '#', rgb = hex ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : color.split(',').map(Number);
  const hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0; let h = 0; if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h, s, l]; };
  const [, cs, cl] = hsl(rgb), [th, ts] = hsl(tint.split(',').map(Number)), sat = ts * Math.min(1, .35 + cs), q = (1 - Math.abs(2 * cl - 1)) * sat, x = q * (1 - Math.abs(th % 2 - 1)), m = cl - q / 2;
  const [r1, g1, b1] = [[q, x, 0], [x, q, 0], [0, q, x], [0, x, q], [x, 0, q], [q, 0, x]][Math.floor(th) % 6], res = [r1, g1, b1].map(v => Math.round((v + m) * 255));
  out = hex ? '#' + res.map(v => v.toString(16).padStart(2, '0')).join('') : res.join(',');
  TINTED.set(key, out); return out;
}

export { $, C, CLOUD, D2R, IMG, M, POLY, RING, RUNES, RUYI, SPR, SVG, TAU, around, bez, clamp, drawDragon, drawPhoenixFront, drawWing, easeInOut, easeOut, f2, flame, flamePlume, glow, inc, lerp, matDefs, motes, patinaDef, polyPts, reduce, retint, ribbonPath, rng, runeD, smoke, ss, svgImg, wob };
