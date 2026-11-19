/*
 * Moved as it is from the approved prototype (ho-so-src/frames.js): only imports and exports were added,
 * plus the changes listed in cosmetics/README.md. The drawing is not to be redrawn or simplified.
 */
import { ART, ARTM } from './art-manifest.js';
import { C, CLOUD, D2R, M, POLY, RING, RUNES, RUYI, SPR, SVG, TAU, around, bez, clamp, drawDragon, drawPhoenixFront, drawWing, easeInOut, f2, flame, flamePlume, glow, inc, lerp, matDefs, motes, patinaDef, polyPts, reduce, ribbonPath, rng, runeD, smoke, ss, svgImg, wob } from './lib.js';

const FR = {};
const CIRC = (r = 59) => ({ k: 'circle', x: 100, y: 100, r, box: [100 - r, 100 - r, 100 + r, 100 + r] });
function frame(id, d) { FR[id] = Object.assign({ id, hole: CIRC() }, d); }
const ARCH_IN = 'M60 154L60 96A57 57 0 0 1 100 41.6A57 57 0 0 1 140 96L140 154Z';

/* shared painters */
function silkTail(c, x0, y0, dir, len, w0, t, ph) {
  const n = 26, P = [];
  for (let i = 0; i <= n; i++) { const s = i / n, sw = Math.sin(t * 1.15 + ph - s * 3.2) * (1.5 + 7 * s * s), x = x0 + dir * s * len * 0.42 + sw, y = y0 + s * len; P.push([x, y, s]); }
  const L = [], R = [];
  for (let i = 0; i <= n; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(n, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1, s = P[i][2], tw = Math.cos(t * 0.9 + ph - s * 3.6), w = w0 * (1 - 0.25 * s) * (0.5 + 0.5 * Math.abs(tw)) / 2;
    L.push([P[i][0] - ty / l * w, P[i][1] + tx / l * w, tw]); R.push([P[i][0] + ty / l * w, P[i][1] - tx / l * w, tw]); }
  // shaded quads so the twist reads as light/dark silk
  for (let i = 0; i < n; i++) { const tw = (L[i][2] + L[i + 1][2]) / 2, lt = 0.5 + 0.5 * tw;
    c.fillStyle = `rgb(${Math.round(lerp(92, 196, lt))},${Math.round(lerp(10, 44, lt))},${Math.round(lerp(18, 52, lt))})`;
    c.beginPath(); c.moveTo(L[i][0], L[i][1]); c.lineTo(L[i + 1][0], L[i + 1][1]); c.lineTo(R[i + 1][0], R[i + 1][1]); c.lineTo(R[i][0], R[i][1]); c.closePath(); c.fill(); c.strokeStyle = c.fillStyle; c.lineWidth = .35; c.stroke(); }
  // forked tip
  const e = P[n], l = L[n], r = R[n]; c.fillStyle = '#7a1420'; c.beginPath(); c.moveTo(l[0], l[1]); c.lineTo(l[0] + (e[0] - P[n - 1][0]) * 2.4, l[1] + 5); c.lineTo(e[0], e[1] + 1); c.lineTo(r[0] + (e[0] - P[n - 1][0]) * 2.4, r[1] + 5); c.lineTo(r[0], r[1]); c.closePath(); c.fill();
  // embroidered gold thread
  c.setLineDash([1.6, 1.4]); c.strokeStyle = 'rgba(244,206,120,.75)'; c.lineWidth = .7; c.beginPath(); P.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](p[0], p[1])); c.stroke(); c.setLineDash([]);
}
function tassel(c, x, y, t, ph, len = 24) {
  const sw = Math.sin(t * 1.2 + ph) * 0.11 + Math.sin(t * 0.55 + ph * 2) * 0.04;
  for (let i = 0; i < 13; i++) {
    const u = i / 12 - 0.5, x0 = x + u * 4.4, a1 = sw * 0.55, a2 = sw * 1.15, L = len * (0.94 + 0.06 * Math.cos(i * 1.7));
    const g = c.createLinearGradient(x, y, x, y + L); g.addColorStop(0, '#b0141e'); g.addColorStop(.6, '#8a0e18'); g.addColorStop(1, 'rgba(70,4,10,.85)');
    c.strokeStyle = g; c.lineWidth = .9; c.beginPath(); c.moveTo(x0, y + 3);
    c.quadraticCurveTo(x0 + Math.sin(a1) * L * 0.5 + u * 1.5, y + 3 + Math.cos(a1) * L * 0.5, x0 + Math.sin(a2) * L + u * 3.6, y + 3 + Math.cos(a2) * L); c.stroke();
  }
  c.save(); c.translate(x, y + 3); c.rotate(sw * 0.3); const g2 = c.createLinearGradient(-3, 0, 3, 0); g2.addColorStop(0, '#7a4a12'); g2.addColorStop(.5, '#f2d07a'); g2.addColorStop(1, '#7a4a12'); c.fillStyle = g2; c.fillRect(-2.8, 1.5, 5.6, 2.6); c.restore();
}
function blossomSVG(x, y, r, rot) {
  let s = `<g transform="translate(${f2(x)} ${f2(y)}) rotate(${f2(rot)})">`;
  for (let i = 0; i < 5; i++) s += `<ellipse cx="0" cy="${f2(-r * 0.55)}" rx="${f2(r * 0.42)}" ry="${f2(r * 0.6)}" transform="rotate(${i * 72})" fill="url(#pt)"/>`;
  s += `<circle r="${f2(r * 0.28)}" fill="#c2455c"/>`;
  for (let i = 0; i < 7; i++) s += `<circle cx="${f2(Math.cos(i * 0.9) * r * 0.35)}" cy="${f2(Math.sin(i * 0.9) * r * 0.35)}" r="${f2(r * 0.07)}" fill="#f2c45a"/>`;
  return s + '</g>';
}
function roseSVG(x, y, r) {
  let s = `<g transform="translate(${x} ${y})">`;
  for (let i = 0; i < 6; i++) s += `<ellipse cx="0" cy="${f2(-r * 0.5)}" rx="${f2(r * 0.5)}" ry="${f2(r * 0.55)}" transform="rotate(${i * 60 + 15})" fill="url(#rs)"/>`;
  s += `<circle r="${f2(r * 0.55)}" fill="#7a0a1a"/><path d="M${f2(-r * .4)} 0A${f2(r * .4)} ${f2(r * .4)} 0 1 1 ${f2(r * .2)} ${f2(r * .3)}M${f2(-r * .15)} ${f2(-r * .05)}A${f2(r * .2)} ${f2(r * .2)} 0 1 1 ${f2(r * .1)} ${f2(r * .15)}" fill="none" stroke="#c42a3e" stroke-width="${f2(r * .14)}" stroke-linecap="round"/>`;
  return s + '</g>';
}
// light sweep masked to the artwork (material sheen)
let SCR = null;
function sheen(c, S, img, t, o) {
  if (!SCR) SCR = document.createElement('canvas'); if (SCR.width < S) { SCR.width = S; SCR.height = S; }
  const x = SCR.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, S, S);
  const per = o.period || 6, u = (t % per) / per, k = easeInOut(clamp(u / 0.55)), pos = lerp(-0.45, 1.45, k), a = (o.a || 0.5) * Math.sin(clamp(u / 0.55) * Math.PI);
  if (a <= 0.003) return;
  if (o.conic && x.createConicGradient) { const g = x.createConicGradient(t * 0.5, S / 2, S / 2); g.addColorStop(0, `rgba(${o.rgb},0)`); g.addColorStop(.06, `rgba(${o.rgb},${a})`); g.addColorStop(.12, `rgba(${o.rgb},0)`); g.addColorStop(1, `rgba(${o.rgb},0)`); x.fillStyle = g; }
  else { const g = x.createLinearGradient(S * (pos - 0.3), S * (pos - 0.3) * 0.6, S * (pos + 0.3), S * (pos + 0.3) * 0.6); g.addColorStop(0, `rgba(${o.rgb},0)`); g.addColorStop(.5, `rgba(${o.rgb},${a})`); g.addColorStop(1, `rgba(${o.rgb},0)`); x.fillStyle = g; }
  x.fillRect(0, 0, S, S); x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0, S, S);
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'screen'; c.drawImage(SCR, 0, 0, S, S, 0, 0, S, S); c.restore();
}

/* ---------- 0. none ---------- */
frame('none', { name: 'Không viền', rar: 'common', src: 'Mặc định',
  art: () => [matDefs('iron'), `<path fill-rule="evenodd" ${M('iron')} d="${RING(61, 57)}"/>`] });

/* ---------- Lv10 Đồng Cổ : bronze, patina, cloud scrolls · motion: slow sheen ---------- */
frame('dong', { name: 'Đồng Cổ', rar: 'common', lv: 10, src: 'Cấp 10', sheen: { period: 7, rgb: '255,214,160', a: .45 },
  art: () => [matDefs('bronze') + patinaDef() + `<clipPath id="cr"><path clip-rule="evenodd" d="${RING(74, 57)}"/></clipPath>`,
    `<path fill-rule="evenodd" ${M('bronze')} d="${RING(74, 57)}"/>
${inc(C(100, 100, 62.5), 1.1)}${inc(C(100, 100, 69.5), .9)}
<g ${M('bronze')}>${around(56, (i, a) => `<circle cx="100" cy="${100 - 72}" r="1.25" transform="rotate(${a} 100 100)"/>`)}</g>
<g filter="url(#m-bronze)" fill="none" stroke="#b07a42" stroke-width="1.5" stroke-linecap="round">${around(14, (i, a) => `<path d="${CLOUD}" transform="rotate(${a} 100 100) translate(100 ${100 - 66}) scale(.95)"/>`)}</g>
<rect width="200" height="200" filter="url(#patina)" clip-path="url(#cr)" opacity=".55"/>`] });

/* ---------- Lv20 Bạc Nguyệt : brushed silver, crescent, lotus · motion: moonlight breathing ---------- */
frame('bac', { name: 'Bạc Nguyệt', rar: 'rare', lv: 20, src: 'Cấp 20',
  art: () => [matDefs('silver') + `<mask id="cm"><rect width="200" height="200" fill="#fff"/><circle cx="107" cy="20" r="15" fill="#000"/></mask>`,
    `<path fill-rule="evenodd" ${M('silver')} d="${RING(70, 57)}"/>
${inc(C(100, 100, 60.5), .9)}${inc(C(100, 100, 66.5), .8)}
<g fill="#000" fill-opacity=".45">${around(16, (i, a) => `<path d="M100 ${100 - 63.6}l.9 1.6l1.6.9l-1.6.9l-.9 1.6l-.9-1.6l-1.6-.9l1.6-.9z" transform="rotate(${a + 11.25} 100 100)"/>`)}</g>
<g filter="url(#m-silver)"><g mask="url(#cm)"><circle cx="100" cy="26" r="17" fill="url(#g-silver)"/></g></g>
${inc('M88 16A14 14 0 0 0 108 39', .7, .35)}
<g ${M('silver')}>${[-56, -28, 0, 28, 56].map(a => `<path d="M0 0C-5-4-6-12 0-20C6-12 5-4 0 0Z" transform="translate(100 183) rotate(${a}) scale(${a ? .85 : 1})"/>`).join('')}<ellipse cx="100" cy="184" rx="12" ry="3"/></g>`],
  fx: (c, t) => { const b = 0.5 + 0.5 * Math.sin(t * 0.8); glow(c, 96, 26, 34, '170,200,255', 0.14 + 0.16 * b); glow(c, 92, 24, 10, '235,245,255', 0.12 + 0.12 * b); motes(c, 5, 21, t, [70, 10, 60, 40], '220,232,255', 1.1, 0.6, .7); } });

/* ---------- Lv30 Bích Ngọc : translucent jade, key-fret, silk bow · motion: ribbon sway ---------- */
frame('ngoc', { name: 'Bích Ngọc', rar: 'myth', lv: 30, src: 'Cấp 30',
  art: () => [matDefs('jade', 'gold') + `<radialGradient id="jg" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#8ae6bc"/><stop offset=".4" stop-color="#2f9a70"/><stop offset=".8" stop-color="#0d4a33"/><stop offset="1" stop-color="#07301f"/></radialGradient>`,
    `<path fill-rule="evenodd" filter="url(#m-jade)" fill="url(#jg)" d="${RING(71, 57)}"/>
<path fill-rule="evenodd" ${M('gold')} d="${RING(72.5, 70) + RING(59.5, 57)}"/>
<g fill="none" stroke="#04241a" stroke-opacity=".7" stroke-width="1.1" stroke-linecap="square">${around(24, (i, a) => `<path d="M-6 2.6V-2.6H3.2V1.4H-2.6V-.8H.8" transform="rotate(${a} 100 100) translate(100 ${100 - 64.8})"/>`)}</g>
<g fill="none" stroke="#c8ffe6" stroke-opacity=".28" stroke-width=".6">${around(24, (i, a) => `<path d="M-6 2.6V-2.6H3.2V1.4H-2.6V-.8H.8" transform="rotate(${a} 100 100) translate(100.5 ${100.6 - 64.8})"/>`)}</g>`],
  top: () => [matDefs('gold') + `<linearGradient id="sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d23a46"/><stop offset=".5" stop-color="#9a1824"/><stop offset="1" stop-color="#5a0a12"/></linearGradient>`,
    `<path d="M100 171C92 160 78 158 76 166C74 174 90 178 100 173Z" fill="url(#sk)"/><path d="M100 171C108 160 122 158 124 166C126 174 110 178 100 173Z" fill="url(#sk)"/>
<path d="M80 165C86 162 94 166 98 170M120 165C114 162 106 166 102 170" fill="none" stroke="#ffb0b8" stroke-opacity=".45" stroke-width=".9"/>
<rect x="95" y="166" width="10" height="9" rx="2.5" ${M('gold')}/>`],
  mid: (c, t) => { silkTail(c, 97, 173, -1, 24, 6.4, t, 0); silkTail(c, 103, 173, 1, 22, 6, t, 1.4); } });

/* ---------- Lv40 Hoàng Kim Bát Quái : antique gold octagon, trigrams, tassels · motion: tassel swing ---------- */
const TRI = [7, 3, 5, 1, 6, 2, 4, 0];
frame('vang', { name: 'Hoàng Kim Bát Quái', rar: 'leg', lv: 40, src: 'Cấp 40', hole: { k: 'oct', x: 100, y: 100, r: 64, rot: 22.5 * D2R, box: [36, 36, 164, 164] },
  art: () => { const out = polyPts(8, 79, 22.5 * D2R), inn = polyPts(8, 62, 22.5 * D2R);
    return [matDefs('gold', 'jade'),
      `<path fill-rule="evenodd" ${M('gold')} d="${POLY(out) + POLY(inn)}"/>
${inc(POLY(polyPts(8, 66, 22.5 * D2R)), 1)}${inc(POLY(polyPts(8, 75, 22.5 * D2R)), .8)}
<g>${TRI.map((b, k) => `<g transform="rotate(${k * 45} 100 100) translate(100 ${100 - 65.4})">${[0, 1, 2].map(j => (b >> j) & 1 ? `<rect x="-8" y="${-4.6 + j * 3.2}" width="16" height="1.7" fill="#2a1406" opacity=".8"/>` : `<rect x="-8" y="${-4.6 + j * 3.2}" width="6.6" height="1.7" fill="#2a1406" opacity=".8"/><rect x="1.4" y="${-4.6 + j * 3.2}" width="6.6" height="1.7" fill="#2a1406" opacity=".8"/>`).join('')}</g>`).join('')}</g>
<g ${M('jade')}>${out.map(p => `<circle cx="${f2(lerp(100, p[0], .955))}" cy="${f2(lerp(100, p[1], .955))}" r="3.3"/>`).join('')}</g>
<g fill="#fff" opacity=".7">${out.map(p => `<circle cx="${f2(lerp(100, p[0], .955) - 1)}" cy="${f2(lerp(100, p[1], .955) - 1.1)}" r=".8"/>`).join('')}</g>
<g ${M('gold')}><path d="${RUYI}" transform="translate(100 17) scale(1.25)"/></g><g ${M('jade')}><circle cx="100" cy="8.5" r="3.2"/></g>`]; },
  top: () => [matDefs('gold') + `<linearGradient id="kn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c22a34"/><stop offset="1" stop-color="#6a0a12"/></linearGradient>`,
    [[70.2, 172.2], [129.8, 172.2]].map(([x, y]) => `<circle cx="${x}" cy="${y + 1}" r="2.6" ${M('gold')}/><path d="M${x} ${y + 3}l3.2 3.2l-3.2 3.2l-3.2-3.2z" fill="url(#kn)"/>`).join('')],
  mid: (c, t) => { tassel(c, 70.2, 180, t, 0, 20); tassel(c, 129.8, 180, t, 0.9, 20); }, sheen: { period: 9, rgb: '255,236,180', a: .3 } });

/* ---------- Lv50 Thám Trưởng : blackened steel + gold, astrolabe ring · motion: slow rotation ---------- */
frame('truong', { name: 'Thám Trưởng', rar: 'gold', lv: 50, src: 'Cấp 50', rotSpeed: 0.07,
  art: () => [matDefs('steel', 'gold') + `<radialGradient id="am" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffe8a8"/><stop offset=".4" stop-color="#ff9a1a"/><stop offset="1" stop-color="#7a2a02"/></radialGradient>`,
    `<path fill-rule="evenodd" ${M('steel')} d="${RING(71, 57)}"/>
<path fill-rule="evenodd" ${M('gold')} d="${RING(72.5, 70) + RING(59.5, 57)}"/>
<g fill="none" stroke="#d8b060" stroke-width=".8" opacity=".85">${around(8, (i, a) => `<path d="M-9 0C-6-3-3-3 0 0C3 3 6 3 9 0" transform="rotate(${a + 22.5} 100 100) translate(100 ${100 - 64.8})"/>`)}</g>
<g ${M('steel')}>${[-1, 1].map(s => [0, 1, 2, 3].map(i => `<path d="M0 0C-2-8-1-16 3-22C5-14 5-6 2 0Z" transform="translate(${100 + s * 9} 30) scale(${s} 1) rotate(${-(40 + i * 16)}) scale(${1 - i * .1})"/>`).join('')).join('')}</g>
<g ${M('gold')}><ellipse cx="100" cy="24" rx="10.5" ry="12.5"/><path d="M84 178H116L112 186H88Z"/></g>
<ellipse cx="100" cy="24" rx="7.2" ry="9.2" fill="url(#am)"/><ellipse cx="97.5" cy="20" rx="2" ry="3" fill="#fff" opacity=".7"/>
${inc('M95 182a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0M99.6 184l4 3', .7, .5)}`],
  rot: () => [matDefs('gold'), `<path fill-rule="evenodd" ${M('gold')} d="${RING(84, 80.6)}"/>
<g stroke="#2a1806" stroke-opacity=".7">${around(72, (i, a) => `<path d="M100 ${100 - 80.8}V${100 - (i % 6 ? 82.2 : 83.6)}" stroke-width="${i % 6 ? .5 : .9}" transform="rotate(${a} 100 100)"/>`)}</g>
<g ${M('gold')}>${around(4, (i, a) => `<path d="M100 ${100 - 90}l2.4 4.4l-2.4 2.6l-2.4-2.6z" transform="rotate(${a + 45} 100 100)"/>`)}</g>`],
  fx: (c, t) => { const b = .5 + .5 * Math.sin(t * 1.1); glow(c, 100, 24, 18, '255,170,60', .12 + .14 * b); } });

/* ---------- Thạch Phù : carved stone octagon, runes · motion: runes kindle one after another ---------- */
frame('thach', { name: 'Thạch Phù', rar: 'rare', src: 'Ra từ Hòm Niêm Phong',
  art: () => { const out = polyPts(8, 81, 22.5 * D2R); return [matDefs('stone') + patinaDef('moss', [.28, .36, .26], .09, 1.6, 4) + `<clipPath id="cr"><path clip-rule="evenodd" d="${POLY(out) + C(100, 100, 57)}"/></clipPath>`,
    `<path fill-rule="evenodd" ${M('stone')} d="${POLY(out) + C(100, 100, 57)}"/>
${out.map(p => inc(`M${f2(lerp(100, p[0], .72))} ${f2(lerp(100, p[1], .72))}L${f2(lerp(100, p[0], .985))} ${f2(lerp(100, p[1], .985))}`, .9)).join('')}
${RUNES.map((g, k) => `<g transform="rotate(${k * 45} 100 100) translate(100 ${100 - 68.6}) scale(.82)">${inc(runeD(g), 1.5, .7)}</g>`).join('')}
${inc('M151 48L156 54L154 60M58 160L52 156L49 162M150 150L156 147', .6, .5)}
<rect width="200" height="200" filter="url(#moss)" clip-path="url(#cr)" opacity=".45"/>`]; },
  fx: (c, t) => {
    c.lineCap = 'round'; c.lineJoin = 'round';
    RUNES.forEach((g, k) => { const ph = ((t * 0.55 - k / 8) % 1 + 1) % 1, a = Math.pow(Math.max(0, Math.cos(ph * TAU)), 3) * 0.9 + 0.08; if (a < 0.02) return;
      c.save(); c.translate(100, 100); c.rotate(k * 45 * D2R); c.translate(0, -68.6); c.scale(.82, .82);
      glow(c, 0, 0, 14, '90,230,255', a * 0.35);
      c.globalCompositeOperation = 'lighter'; c.strokeStyle = `rgba(120,236,255,${a})`; c.lineWidth = 1.4; for (const l of g) { c.beginPath(); for (let i = 0; i < l.length; i += 2) c[i ? 'lineTo' : 'moveTo'](l[i], l[i + 1]); c.stroke(); } c.restore(); });
  } });

/* ---------- Mặc Ảnh : ink enso · motion: ink smoke drifting ---------- */
frame('mac', { name: 'Mặc Ảnh', rar: 'myth', src: 'Ra từ Tráp Sơn Mài',
  under: () => [`<radialGradient id="ms" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="#cdd4e2" stop-opacity="0"/><stop offset=".72" stop-color="#cdd4e2" stop-opacity=".3"/><stop offset=".9" stop-color="#cdd4e2" stop-opacity="0"/></radialGradient>`, `<rect width="200" height="200" fill="url(#ms)"/>`],
  art: () => { const pts = []; for (let i = 0; i <= 120; i++) { const s = i / 120, th = (-58 + s * 312) * D2R, r = 66 + 2 * Math.sin(th * 2 + 1); pts.push([100 + r * Math.cos(th), 100 + r * Math.sin(th)]); }
    const wf = s => s < .05 ? lerp(10, 16, s / .05) : 16 - 13.5 * Math.pow((s - .05) / .95, 1.5);
    return [`<filter id="ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="3" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"/></filter>
<linearGradient id="ik" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a94a8"/><stop offset=".35" stop-color="#3a404c"/><stop offset=".7" stop-color="#16181e"/><stop offset="1" stop-color="#08090b"/></linearGradient>
<mask id="dry"><rect width="200" height="200" fill="#fff"/><g fill="none" stroke="#000" stroke-width=".8">${[62, 64.5, 67, 69.5].map((r, i) => `<path d="M${f2(100 + r * Math.cos(150 * D2R))} ${f2(100 + r * Math.sin(150 * D2R))}A${r} ${r} 0 0 1 ${f2(100 + r * Math.cos(250 * D2R))} ${f2(100 + r * Math.sin(250 * D2R))}" stroke-dasharray="${18 + i * 5} ${3 + i} ${30 - i * 4} ${5 + i}"/>`).join('')}</g></mask>
<filter id="rough"><feTurbulence type="fractalNoise" baseFrequency=".3" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>`,
      `<g filter="url(#ink)" mask="url(#dry)"><path d="${ribbonPath(pts, wf)}" fill="url(#ik)"/></g>
<path d="${C(100, 100, 57.8)}" fill="none" stroke="#0a0b0e" stroke-width="2"/>
<g fill="#0c0d10">${[[160, 54, 1.6], [166, 62, 1], [156, 44, .8], [170, 50, .6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
<g transform="translate(150 152) rotate(-8)" filter="url(#rough)"><rect x="-9" y="-9" width="18" height="18" rx="1.5" fill="#a3161c"/><path d="M-5-5H5M0-7V7M-5 1H5M-4 4.5L4 6.5" stroke="#f6e8e0" stroke-width="1.5" stroke-linecap="round" fill="none"/></g>`]; },
  fx: (c, t, k) => { smoke(c, 8, 33, t * 0.8, [30, 20, 140, 60], '205,212,228', 24, 0.42, 30, k); } });

/* ---------- Hàn Băng : crystal shards · motion: refracted glint orbiting ---------- */
frame('bang', { name: 'Hàn Băng', rar: 'myth', src: 'Ra từ Tráp Sơn Mài', sheen: { conic: true, rgb: '220,244,255', a: .75, period: 6 },
  under: () => [`<radialGradient id="cg" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="#7cc8ff" stop-opacity="0"/><stop offset=".7" stop-color="#7cc8ff" stop-opacity=".22"/><stop offset="1" stop-color="#7cc8ff" stop-opacity="0"/></radialGradient>`, `<rect width="200" height="200" fill="url(#cg)"/>`],
  art: () => { const R = rng(41); let sh = '';
    for (let i = 0; i < 22; i++) { const a = i * (360 / 22) + (R() - .5) * 8, top = Math.cos(a * D2R) * .5 + .5, len = 9 + R() * 12 + (a < 45 || a > 315 ? 8 : 0), w = 5 + R() * 4;
      sh += `<g transform="rotate(${f2(a)} 100 100) translate(100 ${100 - 59})"><path d="M${-w / 2} 0L${-w / 2} ${f2(-len * .68)}L0 ${f2(-len)}L${w / 2} ${f2(-len * .74)}L${w / 2} 0Z" fill="url(#sh)" stroke="#f2fbff" stroke-opacity=".55" stroke-width=".5"/><path d="M0 0L0 ${f2(-len)}L${w / 2} ${f2(-len * .74)}L${w / 2} 0Z" fill="#0a2a4a" fill-opacity=".35"/></g>`; }
    return [matDefs('silver') + `<linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".92"/><stop offset=".45" stop-color="#a8dcff" stop-opacity=".55"/><stop offset="1" stop-color="#2a6aa8" stop-opacity=".45"/></linearGradient>`,
      sh + `<path fill-rule="evenodd" ${M('silver')} d="${RING(62, 57)}"/>${inc(C(100, 100, 59.5), .6, .4)}`]; },
  fx: (c, t) => { const R = rng(7); for (let i = 0; i < 3; i++) { const per = 4.5, ph = R() * per, u = ((t + ph) % per) / per, a = Math.sin(clamp(u / .35) * Math.PI); if (a <= 0) continue;
    const ang = R() * TAU, r = 72 + R() * 10, x = 100 + Math.cos(ang) * r, y = 100 + Math.sin(ang) * r; c.save(); c.translate(x, y); c.rotate(u * 1.2); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(230,248,255,${a})`;
    c.beginPath(); c.moveTo(0, -4); c.lineTo(.6, -.6); c.lineTo(4, 0); c.lineTo(.6, .6); c.lineTo(0, 4); c.lineTo(-.6, .6); c.lineTo(-4, 0); c.lineTo(-.6, -.6); c.closePath(); c.fill(); c.restore(); glow(c, x, y, 7, '190,230,255', a * .4); } } });

/* ---------- Sơn Mài : red lacquer, gold leaf, cherry branch · motion: petals drifting ---------- */
frame('sonmai', { name: 'Sơn Mài Anh Đào', rar: 'myth', src: 'Ra từ Tráp Sơn Mài',
  art: () => { const br = bez([18, 182], [12, 120], [22, 70], [52, 40], 30), tw = bez([30, 150], [60, 176], [96, 186], [128, 184], 20);
    return [matDefs('lacquer', 'gold', 'bark') + `<radialGradient id="pt" cx=".5" cy=".8" r=".9"><stop offset="0" stop-color="#d8687e"/><stop offset=".45" stop-color="#f6c4cf"/><stop offset="1" stop-color="#fff4f6"/></radialGradient>`,
      `<path fill-rule="evenodd" ${M('lacquer')} d="${RING(70, 59)}"/>
<path fill-rule="evenodd" ${M('gold')} d="${RING(73, 70) + RING(59.5, 57)}"/>
${inc('M130 50l4 3l2 5M154 112l3 3M70 152l4 2l3-1M48 96l-2 4', .5, .35)}
<g fill="none" stroke="#e6bf6a" stroke-width=".7" opacity=".75">${around(12, (i, a) => `<path d="M-5 1C-3-1-1-1 0 1C1 3 3 3 5 1" transform="rotate(${a + 15} 100 100) translate(100 ${100 - 64.5})"/>`)}</g>
<g ${M('bark')}><path d="${ribbonPath(br, s => 7 - s * 5)}"/><path d="${ribbonPath(tw, s => 4 - s * 3)}"/><path d="${ribbonPath(bez([24, 110], [10, 100], [8, 88], [12, 76], 10), s => 3 - s * 2.4)}"/></g>
${[[52, 40, 8, 10], [34, 62, 7, 40], [18, 96, 7.5, 70], [26, 132, 7, 20], [64, 172, 7, 50], [98, 184, 6.5, 10], [124, 182, 5.5, 30], [12, 78, 5, 0]].map(([x, y, r, a]) => blossomSVG(x, y, r, a)).join('')}
<g fill="#e88aa0">${[[44, 50], [16, 116], [84, 182], [8, 84]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.2" ry="3" />`).join('')}</g>`]; },
  fx: (c, t) => { const R = rng(12); for (let i = 0; i < 5; i++) { const per = 7 + R() * 3, ph = R() * per, u = ((t + ph) % per) / per, x0 = 20 + R() * 60, x = x0 + u * 60 + Math.sin(t * 0.9 + i) * 6, y = 40 + u * 150, a = Math.sin(u * Math.PI) * .9, flip = Math.cos(t * 1.6 + i * 2);
    c.save(); c.translate(x, y); c.rotate(t * 0.6 + i); c.scale(1, Math.max(.2, Math.abs(flip))); c.globalAlpha = a; const g = c.createRadialGradient(0, 1.5, 0, 0, 0, 3.6); g.addColorStop(0, '#d8687e'); g.addColorStop(1, '#fde2e8'); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 2.4, 3.4, 0, 0, TAU); c.fill(); c.restore(); } } });

/* ---------- U Linh Giáo Đường : gothic iron arch, thorns, roses · motion: candle flames ---------- */
frame('ulinh', { name: 'U Linh Giáo Đường', rar: 'leg', src: 'Ra từ Hòm Niêm Phong', hole: { k: 'arch', box: [60, 41, 140, 154] },
  art: () => { const vine = (s) => { const o = []; for (let i = 0; i <= 40; i++) { const u = i / 40, y = lerp(150, 40, u), x = s < 0 ? lerp(47, 92, ss(.55, 1, u)) - (1 - ss(.55, 1, u)) * 0 : lerp(153, 108, ss(.55, 1, u)); o.push([x + Math.sin(u * 22) * 2.2, y + (u > .55 ? -Math.sin((u - .55) / .45 * Math.PI / 2) * 6 : 0)]); } return o; };
    const vl = vine(-1), vr = vine(1), pathOf = p => 'M' + p.map(q => f2(q[0]) + ' ' + f2(q[1])).join('L');
    const thorns = p => p.filter((_, i) => i % 3 === 1).map((q, i) => `<path d="M${f2(q[0])} ${f2(q[1])}l${i % 2 ? 3 : -3} -1.2l${i % 2 ? -2.2 : 2.2} 2.4z"/>`).join('');
    return [matDefs('iron', 'stone') + `<radialGradient id="rs" cx=".5" cy=".7" r=".8"><stop offset="0" stop-color="#9a1428"/><stop offset=".7" stop-color="#5a0614"/><stop offset="1" stop-color="#2a020a"/></radialGradient><linearGradient id="cd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9a8e78"/><stop offset=".4" stop-color="#f4ead6"/><stop offset="1" stop-color="#8a7e68"/></linearGradient>`,
      `<g ${M('iron')}><rect x="40" y="86" width="8" height="70"/><rect x="152" y="86" width="8" height="70"/><path d="M38 88L44 64L50 88Z"/><path d="M150 88L156 64L162 88Z"/></g>
<path fill-rule="evenodd" ${M('iron')} d="M51 158L51 96A66 66 0 0 1 100 32.2A66 66 0 0 1 149 96L149 158ZM62 154L62 96A55 55 0 0 1 100 43.7A55 55 0 0 1 138 96L138 154Z"/>
${inc('M56 154V96A61 61 0 0 1 100 37.6A61 61 0 0 1 144 96V154', .8)}
<g ${M('iron')}><path d="M100 2L103 14L100 30L97 14Z"/><circle cx="100" cy="17" r="4.5"/><circle cx="94.5" cy="21" r="3.6"/><circle cx="105.5" cy="21" r="3.6"/></g>
<g fill="#0a0b0d" opacity=".9"><circle cx="100" cy="17" r="1.6"/><circle cx="94.5" cy="21" r="1.2"/><circle cx="105.5" cy="21" r="1.2"/></g>
<g ${M('stone')}><rect x="30" y="152" width="140" height="16" rx="1.5"/></g>${inc('M32 160H168', .6, .45)}
<g fill="none" stroke="#141c14" stroke-width="2.2" stroke-linecap="round"><path d="${pathOf(vl)}"/><path d="${pathOf(vr)}"/></g>
<g fill="#141c14">${thorns(vl)}${thorns(vr)}<ellipse cx="48" cy="120" rx="4" ry="2" transform="rotate(-30 48 120)"/><ellipse cx="152" cy="98" rx="4" ry="2" transform="rotate(30 152 98)"/></g>
${roseSVG(46, 108, 6.5)}${roseSVG(154, 128, 5.5)}${roseSVG(120, 36, 5)}
<g><rect x="36" y="136" width="8" height="17" rx="1.2" fill="url(#cd)"/><rect x="156" y="136" width="8" height="17" rx="1.2" fill="url(#cd)"/><path d="M36 138q2 4 1 7M163 139q-1 5 0 8" stroke="#f8f0e0" stroke-width="1.4" fill="none"/><path d="M40 136v-3M160 136v-3" stroke="#1a1208" stroke-width=".9"/></g>`]; },
  fx: (c, t) => { flame(c, 40, 133.5, 7.5, t, 1); flame(c, 160, 133.5, 7.5, t, 4); const w = .5 + .5 * wob(t * 1.6, 2); glow(c, 52, 128, 40, '255,150,70', .06 + .05 * w); glow(c, 148, 128, 40, '255,150,70', .06 + .05 * w); } });

/* ---------- Vạn Kiếm : swords radiating from a steel ring · motion: glint runs blade to blade ---------- */
frame('vankiem', { name: 'Vạn Kiếm', rar: 'leg', src: 'Ra từ Két Nhà Băng',
  under: () => ['', `<radialGradient id="mi" cx=".5" cy=".5" r=".5"><stop offset=".6" stop-color="#8a9ab4" stop-opacity=".0"/><stop offset=".8" stop-color="#8a9ab4" stop-opacity=".12"/><stop offset="1" stop-color="#8a9ab4" stop-opacity="0"/></radialGradient><rect width="200" height="200" fill="url(#mi)"/>`],
  art: () => [matDefs('steel', 'gold') + `<linearGradient id="bl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8eef6"/><stop offset=".48" stop-color="#a8b2c2"/><stop offset=".52" stop-color="#5a6272"/><stop offset="1" stop-color="#2a303a"/></linearGradient>`,
    around(12, (i, a) => { const tip = i % 2 ? 88 : 97; return `<g transform="rotate(${a} 100 100)"><path d="M97.4 ${100 - 72}L97.4 ${100 - tip + 9}L100 ${100 - tip}L102.6 ${100 - tip + 9}L102.6 ${100 - 72}Z" fill="url(#bl)" stroke="#0a0c10" stroke-width=".4"/><path d="M100 ${100 - 73}V${100 - tip + 12}" stroke="#2a303a" stroke-width=".7"/><path d="M92 ${100 - 71}Q100 ${100 - 75} 108 ${100 - 71}L108 ${100 - 69.5}Q100 ${100 - 72.5} 92 ${100 - 69.5}Z" ${M('gold')}/></g>`; }) +
    `<path fill-rule="evenodd" ${M('steel')} d="${RING(70, 57)}"/><path fill-rule="evenodd" ${M('gold')} d="${RING(59.5, 57)}"/>
<path d="${C(100, 100, 64.5)}" fill="none" stroke="#c9a04a" stroke-width="1.1" opacity=".85"/>${inc(C(100, 100, 67.5), .6, .4)}
<g ${M('gold')}>${around(12, (i, a) => `<circle cx="100" cy="${100 - 64.5}" r="1.7" transform="rotate(${a} 100 100)"/>`)}</g>`],
  fx: (c, t) => { for (let i = 0; i < 12; i++) { const ph = ((t * 0.5 - i / 12) % 1 + 1) % 1, a = ph < .12 ? Math.sin(ph / .12 * Math.PI) : 0; if (a <= 0) continue; const tip = i % 2 ? 88 : 97, d = lerp(74, tip - 4, ph / .12);
    c.save(); c.translate(100, 100); c.rotate(i * 30 * D2R); c.globalCompositeOperation = 'lighter'; const g = c.createLinearGradient(0, -d + 5, 0, -d - 5); g.addColorStop(0, 'rgba(220,235,255,0)'); g.addColorStop(.5, `rgba(240,248,255,${a * .95})`); g.addColorStop(1, 'rgba(220,235,255,0)'); c.fillStyle = g; c.fillRect(-2.4, -d - 5, 4.8, 10); c.restore();
    glow(c, 100 + Math.sin(i * 30 * D2R) * d, 100 - Math.cos(i * 30 * D2R) * d, 6, '200,225,255', a * .45); } } });

/* ---------- Hắc Dực : blackened steel, crimson gem, black wings · motion: wings breathing ---------- */
frame('hacduc', { name: 'Hắc Dực', rar: 'leg', src: 'Ra từ Hòm Niêm Phong',
  back: (c, t, k) => { drawWing(c, 66, 96, -1, 80, t, 'dark', { px: k, seed: 2, raise: -0.1 }); drawWing(c, 134, 96, 1, 80, t, 'dark', { px: k, seed: 8, raise: -0.1 }); },
  art: () => [matDefs('steel', 'silver') + `<radialGradient id="gm" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ff8a96"/><stop offset=".35" stop-color="#d0142a"/><stop offset=".8" stop-color="#5a0210"/><stop offset="1" stop-color="#2a0006"/></radialGradient>`,
    `<path fill-rule="evenodd" ${M('steel')} d="${RING(70, 57)}"/><path fill-rule="evenodd" ${M('silver')} d="${RING(59.5, 57)}"/>${inc(C(100, 100, 65), .7, .45)}
<g ${M('steel')}>${[-1, 1].map(s => `<path d="M${100 + s * 4} 40C${100 + s * 12} 34 ${100 + s * 13} 24 ${100 + s * 8} 16C${100 + s * 9} 24 ${100 + s * 7} 30 ${100 + s * 2} 34Z"/>`).join('')}<path d="M96 40L100 46L104 40Z"/><path d="M92 170L100 186L108 170Z"/></g>
<ellipse cx="100" cy="28" rx="7" ry="9.5" fill="url(#gm)" stroke="#120004" stroke-width=".6"/><ellipse cx="97.6" cy="24" rx="1.8" ry="2.8" fill="#fff" opacity=".65"/>`],
  fx: (c, t) => { glow(c, 100, 28, 16, '255,40,70', .1 + .08 * (.5 + .5 * Math.sin(t * 1.3))); } });

/* ---------- Kim Long : black lacquer ring, golden dragon climbing to the pearl · motion: dragon undulates ---------- */
frame('kimlong', { name: 'Kim Long', rar: 'gold', src: 'Bí ẩn · Két Nhà Băng',
  art: () => [matDefs('gold') + `<linearGradient id="lk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a2a22"/><stop offset=".5" stop-color="#120c0a"/><stop offset="1" stop-color="#050303"/></linearGradient>`,
    `<path fill-rule="evenodd" fill="url(#lk)" d="${RING(66, 57)}"/><path fill-rule="evenodd" ${M('gold')} d="${RING(67.5, 65) + RING(59.5, 57)}"/>
<g fill="none" stroke="#c9a04a" stroke-width=".9" opacity=".7">${around(10, (i, a) => `<path d="${CLOUD}" transform="rotate(${a} 100 100) translate(100 ${100 - 62.2}) scale(.7)"/>`)}</g>
<g ${M('gold')}><path d="${RUYI}" transform="translate(34 160) scale(1.6) rotate(-20)"/><path d="${RUYI}" transform="translate(56 182) scale(1.15)"/></g>`],
  mid: (c, t, k) => { const pts = []; for (let i = 0; i <= 60; i++) { const s = i / 60, th = (62 - s * 166) * D2R, r = 72 + 2.2 * Math.sin(s * 8 - t * 1.0); pts.push([100 + r * Math.cos(th), 100 + r * Math.sin(th)]); }
    drawDragon(c, pts, { w: 17, px: k, t, headScale: 3.2, belly: (x, y, a) => ((-Math.sin(a)) * (100 - x) + Math.cos(a) * (100 - y)) > 0 ? 1 : -1 }); },
  fx: (c, t, k) => { const x = 46, y = 38, b = .5 + .5 * Math.sin(t * 1.2); glow(c, x, y, 26, '255,190,90', .2 + .16 * b);
    c.save(); c.translate(x, y); for (let i = 0; i < 5; i++) { const a = t * 0.6 + i * TAU / 5; c.save(); c.rotate(a); c.globalCompositeOperation = 'lighter'; const g = c.createLinearGradient(0, -6, 0, -16); g.addColorStop(0, 'rgba(255,170,60,.55)'); g.addColorStop(1, 'rgba(255,90,20,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(-3, -5); c.quadraticCurveTo(-2, -11, Math.sin(t * 2 + i) * 2, -16 - b * 2); c.quadraticCurveTo(2, -11, 3, -5); c.fill(); c.restore(); } c.restore();
    const p = SPR.pearl(24 * k); if (p) c.drawImage(p, x - 12, y - 12, 24, 24); } });

/* ---------- Phượng Hoàng : antique gold + red lacquer, phoenix spreading over the ring · motion: wings & tail breathe ---------- */
frame('phuong', { name: 'Phượng Hoàng', rar: 'gold', src: 'Bí ẩn · Tráp Sơn Mài',
  back: (c, t, k) => {
    for (let i = 0; i < 8; i++) { const side = i % 2 ? 1 : -1, j = i >> 1, th0 = -70 + j * 6, th1 = 70 + j * 16, r0 = 70, r1 = 76 + j * 4;
      const pts = []; for (let q = 0; q <= 22; q++) { const u = q / 22, th = lerp(th0, th1, u) * D2R, r = lerp(r0, r1, u) + Math.sin(t * 1.1 - u * 4 + i) * 2.5 * u; pts.push([100 + side * r * Math.cos(th), 100 + r * Math.sin(th)]); }
      flamePlume(c, pts, 9 - j * 1.2, .95, false); }
    drawWing(c, 92, 40, -1, 58, t, 'fire', { px: k, seed: 3, raise: -0.62 }); drawWing(c, 108, 40, 1, 58, t, 'fire', { px: k, seed: 9, raise: -0.62 }); },
  art: () => [matDefs('gold', 'lacquer'), `<path fill-rule="evenodd" ${M('gold')} d="${RING(68, 57)}"/><path fill-rule="evenodd" ${M('lacquer')} d="${RING(65, 60)}"/>${inc(C(100, 100, 62.5), .5, .4)}`],
  mid: (c, t, k) => { const b = SPR.phF(80 * k); if (b) c.drawImage(b, 100 - 23, 6, 46, 64); },
  fx: (c, t) => { motes(c, 4, 77, t, [40, 20, 120, 60], '255,170,70', 1.2, .5, .7); } });


/* ===== painted artwork (from the AI illustrations) layered over the same rendering pipeline ===== */
const PICS = {}, UP = 'up:';
/* an uploaded picture has one entry however many cosmetics use it, so it is fetched once */
function uploadedPic(url) { const key = UP + url; ART[key] = url; return key; }
function picImg(key) { if (!ART[key]) return null; let im = PICS[key]; if (!im) { im = new Image(); if (key.startsWith(UP)) im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.src = ART[key]; PICS[key] = im; } return im.complete && im.naturalWidth ? im : null; }
/* a picture that was asked for and will never come, so the drawing can fall back to what ships with the game */
function picFailed(key) { const im = PICS[key]; return !!im && im.complete && !im.naturalWidth; }
const PU = (m, u, v) => [m.x + u * m.w, m.y + v * m.h];
let SCR2 = null;
function glowPass(c, S, img, m, a, shape) { // emissive layer, optionally swept by a rotating wedge
  if (!SCR2) SCR2 = document.createElement('canvas'); if (SCR2.width < S) { SCR2.width = S; SCR2.height = S; }
  const x = SCR2.getContext('2d'), k = S / 200; x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, S, S);
  x.drawImage(img, m.x * k, m.y * k, m.w * k, m.h * k);
  if (shape) { x.globalCompositeOperation = 'destination-in'; x.fillStyle = shape(x, k); x.fillRect(0, 0, S, S); }
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'lighter'; c.globalAlpha = a; c.drawImage(SCR2, 0, 0, S, S, 0, 0, S, S); c.restore();
}
Object.assign(FR.dong, { pic: 'vien-dong', picSheen: { period: 7, rgb: '255,226,180', a: .5 } });
Object.assign(FR.bac, { pic: 'vien-bac', picSheen: { period: 8, rgb: '235,244,255', a: .35 }, picFx: (c, t, m) => { const [x, y] = PU(m, .5, .12), b = .5 + .5 * Math.sin(t * .8); glow(c, x, y, 30, '180,205,255', .14 + .16 * b); motes(c, 5, 21, t, [x - 30, y - 10, 60, 40], '225,236,255', 1, .6, .7); } });
Object.assign(FR.ngoc, { pic: 'vien-ngoc', picSheen: { period: 8, rgb: '214,255,236', a: .4 } });
Object.assign(FR.vang, { pic: 'vien-vang', picSheen: { period: 7.5, rgb: '255,238,190', a: .45 } });
Object.assign(FR.truong, { pic: 'vien-truong', picRot: true, picSheen: { period: 9, rgb: '255,232,180', a: .35 }, picFx: (c, t, m) => { const [x, y] = PU(m, .5, .15), b = .5 + .5 * Math.sin(t * 1.1); glow(c, x, y, 20, '255,160,50', .14 + .2 * b); } });
Object.assign(FR.thach, { pic: 'vien-thach', picFx: (c, t, m, S) => { const g = picImg('vien-thach-glow'); if (!g) return; glowPass(c, S, g, m, .55, (x, k) => { const cg = x.createConicGradient ? x.createConicGradient(t * .7, 100 * k, 100 * k) : null; if (!cg) return 'rgba(255,255,255,.5)'; cg.addColorStop(0, 'rgba(255,255,255,1)'); cg.addColorStop(.12, 'rgba(255,255,255,.25)'); cg.addColorStop(.88, 'rgba(255,255,255,.25)'); cg.addColorStop(1, 'rgba(255,255,255,1)'); return cg; }); } });
Object.assign(FR.mac, { pic: 'vien-mac' });
Object.assign(FR.bang, { pic: 'vien-bang', picSheen: { conic: true, rgb: '226,246,255', a: .7, period: 6 } });
Object.assign(FR.sonmai, { pic: 'vien-sonmai', picSheen: { period: 9, rgb: '255,226,200', a: .3 } });
Object.assign(FR.ulinh, { pic: 'vien-ulinh', picUnder: (c, t, m) => { const b = .5 + .5 * wob(t * .7, 3); glow(c, m.hx, m.hy, m.hr * 1.65, '170,10,40', .16 + .14 * b, 'source-over'); } });
frame('tinhkhong', { name: 'Tinh Không Nguyệt Dạ', rar: 'myth', src: 'Ra từ Hòm Niêm Phong', pic: 'vien-tinhkhong',
  picFx: (c, t, m) => { const [x, y] = PU(m, .47, .1); glow(c, x, y, 26, '255,230,160', .12 + .1 * (.5 + .5 * Math.sin(t * .9)));
    const R = rng(5); for (let i = 0; i < 7; i++) { const per = 3.5 + R() * 2, u = ((t + R() * per) % per) / per, a = Math.sin(clamp(u / .5) * Math.PI); const an = R() * TAU, rr = m.hr + 6 + R() * 14, px = m.hx + Math.cos(an) * rr, py = m.hy + Math.sin(an) * rr;
      if (a > 0) { glow(c, px, py, 5, '230,236,255', a * .5); c.save(); c.translate(px, py); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,252,236,${a})`; c.beginPath(); c.moveTo(0, -3); c.lineTo(.5, -.5); c.lineTo(3, 0); c.lineTo(.5, .5); c.lineTo(0, 3); c.lineTo(-.5, .5); c.lineTo(-3, 0); c.lineTo(-.5, -.5); c.fill(); c.restore(); } } } });
frame('lua', { name: 'Hỏa Luân', rar: 'leg', src: 'Ra từ Két Nhà Băng', pic: 'vien-lua',
  picFx: (c, t, m, S) => { const g = picImg('vien-lua-glow'); if (g) glowPass(c, S, g, m, .22 + .2 * (.5 + .5 * wob(t * 1.4, 1))); motes(c, 7, 31, t, [m.hx - 60, m.hy - 70, 120, 130], '255,150,50', 1.1, .9, .75); } });
Object.assign(FR.kimlong, { pic: 'rong-cuon', picSheen: { period: 8, rgb: '255,236,180', a: .35 },
  picFx: (c, t, m, S) => { const [x, y] = PU(m, .477, .222), b = .5 + .5 * Math.sin(t * 1.2); glow(c, x, y, 22, '255,200,90', .2 + .2 * b); const g = picImg('rong-cuon-glow'); if (g) glowPass(c, S, g, m, .12 + .12 * b); } });
// phoenix frame: the painted phoenix spreads behind the vector gold ring; wings breathe
FR.phuong.back = (c, t, k) => { const im = picImg('phuong-xoe'); if (!im) return drawPhoenixFront(c, 100, 36, 54, t, { px: k, raise: -0.55, wing: 1.25, bodyless: true });
  const h = 198, w = h * im.naturalWidth / im.naturalHeight, br = 1 + 0.025 * Math.sin(t * 0.9); c.save(); c.translate(100, 60); c.scale(br, 1 + 0.01 * Math.sin(t * 0.9 + .6)); c.drawImage(im, -w / 2, -59, w, h); c.restore(); };
FR.phuong.mid = (c, t, k) => { if (picImg('phuong-xoe')) return; const b = SPR.phF(80 * k); if (b) c.drawImage(b, 100 - 23, 6, 46, 64); };
// copy the vector motion layers that still suit the painted art
FR.mac.picFx = FR.mac.fx; FR.bang.picFx = FR.bang.fx; FR.sonmai.picFx = FR.sonmai.fx;

const LV_FRAMES = ['dong', 'bac', 'ngoc', 'vang', 'truong'];
const GROUPS = [
  ['Theo cấp độ · mỗi 10 cấp một viền', ['none', ...LV_FRAMES]],
  ['Cổ vật · Hiếm & Quý', ['thach', 'mac', 'bang', 'sonmai', 'tinhkhong']],
  ['Huyền thoại', ['ulinh', 'lua', 'vankiem', 'hacduc']],
  ['Bí ẩn', ['kimlong', 'phuong']],
];


/* ===== living effects shared by every frame (scaled by rarity, each smooth and slow) ===== */
function auraFx(c, x, y, r, rgb, k, t) { const b = .5 + .5 * Math.sin(t * 1.05); glow(c, x, y, r * (1.55 + .08 * b), rgb, Math.min(.75, k * 1.55) * (.6 + .4 * b), 'lighter'); }
function raysFx(c, x, y, r0, r1, t, rgb, a) {
  c.save(); c.translate(x, y); c.rotate(t * .12); c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(0, 0, r0, 0, 0, r1); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g;
  const n = 18; for (let i = 0; i < n; i++) { const an = i / n * TAU, w = (i % 2 ? .05 : .09) * (1 + .3 * Math.sin(t * 1.3 + i)); c.beginPath(); c.moveTo(Math.cos(an - w) * r0, Math.sin(an - w) * r0); c.lineTo(Math.cos(an) * r1, Math.sin(an) * r1); c.lineTo(Math.cos(an + w) * r0, Math.sin(an + w) * r0); c.closePath(); c.fill(); }
  c.restore();
}
function cometFx(c, x, y, R, t, speed, rgb, n = 1, rx = 1) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const a0 = t * speed * TAU + i * TAU / n;
    for (let j = 30; j >= 0; j--) { const a = a0 - j * .026, k = 1 - j / 30, px = x + Math.cos(a) * R * rx, py = y + Math.sin(a) * R; c.fillStyle = `rgba(${rgb},${k * k * .7})`; c.beginPath(); c.arc(px, py, .5 + 2.2 * k, 0, TAU); c.fill(); }
    glow(c, x + Math.cos(a0) * R * rx, y + Math.sin(a0) * R, 13, rgb, .85); }
  c.restore();
}
function star4(c, x, y, s, a, rgb = '255,255,255') { if (a <= .01) return; glow(c, x, y, s * 2.4, rgb, a * .5); c.save(); c.translate(x, y); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(${rgb},${a})`; c.beginPath(); c.moveTo(0, -s); c.lineTo(s * .18, -s * .18); c.lineTo(s, 0); c.lineTo(s * .18, s * .18); c.lineTo(0, s); c.lineTo(-s * .18, s * .18); c.lineTo(-s, 0); c.lineTo(-s * .18, -s * .18); c.closePath(); c.fill(); c.restore(); }
function sparkFx(c, x, y, R, t, n, rgb, seed = 3) { const Rn = rng(seed); for (let i = 0; i < n; i++) { const per = 2.6 + Rn() * 2, ph = Rn() * per, u = ((t + ph) % per) / per, a = Math.sin(clamp(u / .45) * Math.PI), an = Rn() * TAU + Math.floor((t + ph) / per) * 2.4, rr = R * (.95 + Rn() * .3); star4(c, x + Math.cos(an) * rr, y + Math.sin(an) * rr, 3 + Rn() * 3, a, rgb); } }
function fallFx(c, kind, n, seed, t, box) {
  const R = rng(seed); const fea = kind === 'feather' ? SPR.fea('dark', 'cov', 64) : null;
  for (let i = 0; i < n; i++) { const per = 5 + R() * 3, ph = R() * per, u = ((t + ph) % per) / per, x0 = box[0] + R() * box[2], x = x0 + Math.sin(t * .9 + i * 1.7) * 6 + u * (R() - .4) * 16, y = box[1] + u * box[3], a = Math.sin(u * Math.PI), fl = Math.cos(t * 1.5 + i * 2);
    const hd = Math.hypot(x - box[0] - box[2] / 2, y - box[1] - box[3] / 2.2) / (box[2] / 2.6); const a2 = a * clamp((hd - .72) / .2); if (a2 <= .01) continue;
    c.save(); c.translate(x, y); c.rotate(t * .7 + i); c.globalAlpha = a2;
    if (kind === 'snow') { c.restore(); glow(c, x, y, 4, '230,246,255', a * .7); c.fillStyle = `rgba(245,252,255,${a})`; c.beginPath(); c.arc(x, y, 1.2, 0, TAU); c.fill(); continue; }
    c.scale(1, Math.max(.25, Math.abs(fl)));
    if (kind === 'feather' && fea) c.drawImage(fea, -3, -6, 6, 12);
    else { const col = kind === 'rose' ? ['#5a0614', '#c41e3a'] : ['#d8687e', '#fde2e8'], g = c.createRadialGradient(0, 1.2, 0, 0, 0, 3.6); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 2.4, 3.4, 0, 0, TAU); c.fill(); }
    c.restore(); }
}
function flameRingFx(c, x, y, R, t) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 30; i++) { const an = i / 30 * TAU + t * .12, h = 6 + 6 * (.5 + .5 * wob(t * 2.2, i * 1.3)), w = 3.2; c.save(); c.translate(x + Math.cos(an) * R, y + Math.sin(an) * R); c.rotate(an + Math.PI / 2 + wob(t * 1.7, i) * .25);
    const g = c.createLinearGradient(0, 0, 0, -h); g.addColorStop(0, 'rgba(255,220,120,.55)'); g.addColorStop(.5, 'rgba(255,110,30,.4)'); g.addColorStop(1, 'rgba(200,30,10,0)'); c.fillStyle = g;
    c.beginPath(); c.moveTo(-w, 0); c.quadraticCurveTo(-w * .6, -h * .6, 0, -h); c.quadraticCurveTo(w * .6, -h * .6, w, 0); c.closePath(); c.fill(); c.restore(); }
  c.restore();
}
/* per-frame living spec (rgb strings). R = ring radius in units, relative to the avatar hole */
const LIVE = {
  dong:   { aura: ['210,150,90', .14], spark: ['255,226,180', 2] },
  bac:    { aura: ['160,195,255', .22], comet: ['225,238,255', .16, 1], spark: ['235,244,255', 3] },
  ngoc:   { aura: ['70,230,165', .26], comet: ['200,255,230', .14, 1], spark: ['220,255,240', 3] },
  vang:   { aura: ['255,196,80', .3], rays: ['255,214,130', .14], comet: ['255,232,170', .18, 2], spark: ['255,244,210', 4] },
  truong: { aura: ['255,170,60', .3], rays: ['255,200,120', .16], comet: ['255,224,160', .15, 2], spark: ['255,240,200', 4] },
  thach:  { aura: ['70,215,255', .26], embers: ['140,236,255', 5] },
  mac:    { aura: ['200,210,230', .14], comet: ['235,240,250', .1, 1], spark: ['240,244,255', 2] },
  bang:   { aura: ['110,205,255', .3], fall: ['snow', 9], spark: ['225,246,255', 4] },
  sonmai: { aura: ['255,140,175', .22], fall: ['petal', 6], spark: ['255,230,240', 2] },
  tinhkhong: { aura: ['110,125,255', .28], comet: ['255,236,190', .2, 1], spark: ['255,244,210', 5] },
  ulinh:  { aura: ['200,20,50', .28], fall: ['rose', 6], embers: ['255,80,90', 3] },
  lua:    { aura: ['255,100,30', .38], flame: 1, embers: ['255,160,60', 9], breathe: .012 },
  vankiem:{ aura: ['140,195,255', .24], comet: ['220,236,255', .2, 2], spark: ['235,244,255', 3] },
  hacduc: { aura: ['140,80,255', .28], fall: ['feather', 5], spark: ['220,200,255', 2] },
  kimlong:{ aura: ['255,190,70', .36], rays: ['255,210,110', .18], comet: ['255,226,140', .17, 2], embers: ['255,190,90', 7], breathe: .008 },
  phuong: { aura: ['255,110,40', .36], rays: ['255,170,80', .18], embers: ['255,150,50', 9], spark: ['255,236,200', 3] },
};
function liveBack(c, id, x, y, R, t) { const L = LIVE[id]; if (!L || reduce.matches) return; if (L.rays) raysFx(c, x, y, R * .7, R * 1.75, t, L.rays[0], L.rays[1]); if (L.aura) auraFx(c, x, y, R, L.aura[0], L.aura[1], t); }
function liveFront(c, id, x, y, R, t) { const L = LIVE[id]; if (!L || reduce.matches) return;
  if (L.flame) flameRingFx(c, x, y, R * 1.08, t);
  if (L.comet) cometFx(c, x, y, R, t, L.comet[1], L.comet[0], L.comet[2]);
  if (L.spark) sparkFx(c, x, y, R, t, L.spark[1], L.spark[0], id.length);
  if (L.fall) fallFx(c, L.fall[0], L.fall[1], id.length * 3, t, [x - R * 1.3, y - R * 1.4, R * 2.6, R * 2.9]);
  if (L.embers) motes(c, L.embers[1], id.length * 5, t, [x - R, y - R * .4, R * 2, R * 1.3], L.embers[0], 1.2, .9, .85);
}

/* rasterised static layers */
function layer(id, name, S) { const own = FR[id].layerOf || id; return svgImg(`${own}.${name}@${S}`, () => { const [d, b] = FR[own][name](); return SVG(S, S, '0 0 200 200', d, b); }); }

/* avatar inside the frame hole */
function holePath(c, h) {
  c.beginPath();
  if (h.k === 'oct') { for (let i = 0; i < 8; i++) { const a = h.rot + i * TAU / 8; c[i ? 'lineTo' : 'moveTo'](h.x + h.r * Math.cos(a), h.y + h.r * Math.sin(a)); } c.closePath(); }
  else if (h.k === 'arch') { c.moveTo(60, 154); c.lineTo(60, 96); c.arc(117, 96, 57, Math.PI, Math.PI + Math.acos(17 / 57), false); c.arc(83, 96, 57, -Math.acos(17 / 57), 0, false); c.lineTo(140, 154); c.closePath(); }
  else c.arc(h.x, h.y, h.r, 0, TAU);
}
function drawAvatarIn(c, h, img) {
  c.save(); holePath(c, h); c.clip(); c.fillStyle = '#0c0e14'; c.fillRect(0, 0, 200, 200);
  const [x0, y0, x1, y1] = h.box, w = x1 - x0, hh = y1 - y0;
  if (img && img.naturalWidth) { const s = Math.max(w / img.naturalWidth, hh / img.naturalHeight), dw = img.naturalWidth * s, dh = img.naturalHeight * s; c.drawImage(img, x0 + (w - dw) / 2, y0 + (hh - dh) / 2, dw, dh); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(w, hh) / 2, g = c.createRadialGradient(cx, cy - r * .1, r * .55, cx, cy, r * 1.02); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = g; c.fillRect(x0, y0, w, hh);
  c.restore();
}
/* a canvas's layout width, kept by one observer: measuring it every frame would force a style pass per canvas, and
   a measured size follows CSS transforms, so a canvas under a moving camera would be reallocated on every frame */
const CSS_W = new WeakMap();
const sizes = 'ResizeObserver' in window ? new ResizeObserver(es => { for (const e of es) CSS_W.set(e.target, e.contentRect.width); }) : null;
function cssWidth(cv) {
  let w = CSS_W.get(cv);
  if (w === undefined) { w = cv.clientWidth; CSS_W.set(cv, w); sizes?.observe(cv); }
  return w;
}
function forgetCanvas(cv) { CSS_W.delete(cv); sizes?.unobserve(cv); }
/* false when nothing in this frame depends on time, so one paint is all it ever needs */
function isAnimatedFrame(id) {
  const f = FR[id] || FR.none;
  return !!(LIVE[id] || f.back || f.mid || f.rot || f.fx || f.sheen || f.picSheen || f.picFx || f.picRot || f.picUnder);
}
/* whether the art this frame draws has arrived, at this canvas size */
function frameArtReady(id, S) {
  const f = FR[id] || FR.none;
  if (f.pic) return !!picImg(f.pic) && (!f.picRot || !!layer(id, 'rot', S));
  return ['under', 'art', 'rot', 'top'].every(name => !f[name] || !!layer(id, name, S));
}
function paintFrame(cv, id, t, img) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), css = cssWidth(cv) || cv.width / dpr;
  const S = Math.max(32, Math.round(css * dpr)); if (cv.width !== S) { cv.width = S; cv.height = S; }
  const c = cv.getContext('2d'), k = S / 200, f = FR[id] || FR.none, tt = reduce.matches ? 2.2 : t;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, S, S); c.setTransform(k, 0, 0, k, 0, 0); c.imageSmoothingQuality = 'high';
  const pi = f.pic && picImg(f.pic);
  if (pi) { const m = f.picMeta ? f.picMeta(pi) : ARTM[f.pic], RR = m.hr * 1.2;
    liveBack(c, id, m.hx, m.hy, RR, tt);
    if (f.picUnder) { c.save(); f.picUnder(c, tt, m, S); c.restore(); }
    drawAvatarIn(c, { k: 'circle', x: m.hx, y: m.hy, r: m.hr + 2.5, box: [m.hx - m.hr - 2.5, m.hy - m.hr - 2.5, m.hx + m.hr + 2.5, m.hy + m.hr + 2.5] }, img);
    const br = (LIVE[id] && LIVE[id].breathe && !reduce.matches) ? 1 + LIVE[id].breathe * Math.sin(tt * 1.6) : 1;
    if (br !== 1) { c.save(); c.translate(m.hx, m.hy); c.scale(br, br); c.translate(-m.hx, -m.hy); c.drawImage(pi, m.x, m.y, m.w, m.h); c.restore(); } else c.drawImage(pi, m.x, m.y, m.w, m.h);
    if (f.picRot) { const ro = layer(id, 'rot', S); if (ro) { const sc = (m.hr * 1.5) / 84; c.save(); c.translate(m.hx, m.hy); c.rotate(tt * (f.rotSpeed || .07)); c.scale(sc, sc); c.drawImage(ro, -100, -100, 200, 200); c.restore(); } }
    if (f.picSheen && !reduce.matches) { if (!f._full || f._full.width !== S) { f._full = document.createElement('canvas'); f._full.width = S; f._full.height = S; f._full.getContext('2d').drawImage(pi, m.x * k, m.y * k, m.w * k, m.h * k); } sheen(c, S, f._full, tt, f.picSheen); }
    if (f.picFx) { c.save(); f.picFx(c, tt, m, S); c.restore(); }
    c.save(); liveFront(c, id, m.hx, m.hy, RR, tt); c.restore();
    return;
  }
  liveBack(c, id, 100, 100, 70, tt);
  if (f.back) { c.save(); f.back(c, tt, k); c.restore(); }
  const u = f.under && layer(id, 'under', S); if (u) c.drawImage(u, 0, 0, 200, 200);
  drawAvatarIn(c, f.hole, img);
  const a = f.art && layer(id, 'art', S); if (a) c.drawImage(a, 0, 0, 200, 200);
  if (f.mid) { c.save(); f.mid(c, tt, k); c.restore(); }
  const ro = f.rot && layer(id, 'rot', S); if (ro) { c.save(); c.translate(100, 100); c.rotate(tt * f.rotSpeed); c.drawImage(ro, -100, -100, 200, 200); c.restore(); }
  const tp = f.top && layer(id, 'top', S); if (tp) c.drawImage(tp, 0, 0, 200, 200);
  if (f.sheen && a && !reduce.matches) sheen(c, S, a, tt, f.sheen);
  if (f.fx) { c.save(); f.fx(c, tt, k); c.restore(); }
  c.save(); liveFront(c, id, 100, 100, 70, tt); c.restore();
}

/* ===== frames described by data (cosmetics/README.md), drawn by the same pipeline as the painted ones above ===== */
/* where a picture sits in the 200x200 box: the rule the shipped painted frames were placed by (ARTM). The hole is centred across and sized to the usual 57 units, unless the picture would then leave the box */
function fitPicture(hole, scale, iw, ih) {
  const s = Math.min(57 / hole.r * (scale || 1), 196 / ih, 98 / Math.max(hole.x, iw - hole.x, 1)), h = ih * s, y = Math.min(198 - h, Math.max(2, 100 - hole.y * s));
  return { s, x: 100 - hole.x * s, y, w: iw * s, h, hx: 100, hy: y + hole.y * s, hr: hole.r * s };
}
/* painted: { name, rar, src, lv, imageUrl, hole, scale, live, sheen, glowUrl }, clone: { name, rar, src, lv, base, live, sheen }. live and sheen left undefined: a clone keeps its base's, null: none */
function defineFrame(id, o) {
  const fresh = o.base ? { ...FR[o.base], layerOf: FR[o.base].layerOf || o.base, _full: null } : { hole: CIRC(), art: FR.none.art, layerOf: 'none' };
  const f = Object.assign(fresh, { id, name: o.name, rar: o.rar, src: o.src, lv: o.lv, made: true });
  if (o.imageUrl) {
    f.pic = uploadedPic(o.imageUrl);
    let memo = null; f.picMeta = im => (memo && memo.w0 === im.naturalWidth && memo.h0 === im.naturalHeight ? memo : (memo = Object.assign(fitPicture(o.hole, o.scale, im.naturalWidth, im.naturalHeight), { w0: im.naturalWidth, h0: im.naturalHeight })));
    if (o.sheen) f.picSheen = o.sheen;
    if (o.glowUrl) { const glowKey = uploadedPic(o.glowUrl); f.picFx = (c, t, m, S) => { const g = picImg(glowKey); if (g) glowPass(c, S, g, m, .22 + .2 * (.5 + .5 * wob(t * 1.4, 1))); }; }
  } else if (o.sheen !== undefined) { if (f.pic) f.picSheen = o.sheen; else f.sheen = o.sheen; }
  if (o.live !== undefined) { if (o.live) LIVE[id] = o.live; else delete LIVE[id]; }
  else if (o.base && LIVE[o.base]) LIVE[id] = LIVE[o.base]; else delete LIVE[id];
  FR[id] = f; revision++;
}
/* a shipped frame keeps its drawing and takes only its words from the server */
function refreshFrame(id, { name, rar, src, lv }) { Object.assign(FR[id], { name, rar, src, lv }); }
/* raised whenever a drawing changes, so a tile that had finished paints again */
let revision = 0;
const frameRevision = () => revision;
/* the effects a shipped frame comes with, for an editor to start from */
const liveOf = id => LIVE[id] || null;
const sheenOf = id => FR[id]?.picSheen || FR[id]?.sheen || null;

export { FR, GROUPS, LV_FRAMES, blossomSVG, defineFrame, fitPicture, forgetCanvas, frameArtReady, frameRevision, isAnimatedFrame, liveOf, paintFrame, picFailed, picImg, raysFx, refreshFrame, roseSVG, sheenOf, uploadedPic };
