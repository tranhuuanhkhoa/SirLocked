/*
 * Moved as it is from the approved prototype (ho-so-src/fx.js): only imports and exports were added,
 * plus the changes listed in cosmetics/README.md. The drawing is not to be redrawn or simplified.
 */
import { picImg, uploadedPic } from './frames.js';
import { SPR, TAU, clamp, drawDragon, drawPhoenixFront, drawWing, easeInOut, easeOut, glow, lerp, motes, rng, smoke, ss } from './lib.js';

const ENTRANCES = [
  { id: 'lang-le', n: 'Bước Vào Lặng Lẽ', r: 'common', src: 'Mặc định', d: 'Sương mỏng tan dần', ic: 'M12 3v18M6 9l6-6 6 6' },
  { id: 'anh-trang', n: 'Ánh Trăng Soi Lối', r: 'rare', src: 'Ra từ Hòm Niêm Phong', d: 'Một vệt trăng rọi xuống, bụi bạc rơi chậm', ic: 'M16 3a9 9 0 1 0 5 15A8 8 0 0 1 16 3z' },
  { id: 'mac-vu', n: 'Mặc Vụ Ẩn Thân', r: 'myth', src: 'Ra từ Tráp Sơn Mài', d: 'Khói mực cuộn qua rồi tan, lộ dáng người', ic: 'M3 14c3-3 6 0 9-3s6 0 9-3M3 19c3-3 6 0 9-3s6 0 9-3' },
  { id: 'truc-lam', n: 'Trúc Lâm Phong Vũ', r: 'myth', src: 'Ra từ Tráp Sơn Mài', d: 'Gió rừng trúc thổi lá bay ngang', ic: 'M8 2v20M16 2v20M5 6c2 0 3 1 3 3M19 12c-2 0-3 1-3 3' },
  { id: 'van-kiem', n: 'Vạn Kiếm Quy Tông', r: 'leg', src: 'Ra từ Két Nhà Băng', d: 'Kiếm lượn về vây quanh rồi vút lên', ic: 'M4 20L20 4M16 4h4v4M4 4l16 16M4 16v4h4' },
  { id: 'huyet-nguyet', n: 'Huyết Nguyệt', r: 'leg', src: 'Ra từ Két Nhà Băng', d: 'Trăng máu mọc chậm sau lưng, sương đỏ', ic: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z' },
  { id: 'hac-duc', n: 'Hắc Dực Giáng Lâm', r: 'leg', src: 'Ra từ Hòm Niêm Phong', d: 'Đôi cánh đen mở ra, lông vũ rơi', ic: 'M2 12c4-4 7-3 10 0c3-3 6-4 10 0c-4-1-7 0-10 4c-3-4-6-5-10-4z' },
  { id: 'than-tham', n: 'Thần Thám Soi Án', r: 'leg', src: 'Ra từ Hòm Niêm Phong', d: 'Kính lúp đồng soi ra dấu chân, đóng dấu phá án', ic: 'M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM15 15l6 6' },
  { id: 'kim-long', n: 'Kim Long Giáng Thế', r: 'gold', src: 'Bí ẩn · Két Nhà Băng', d: 'Rồng vàng lượn qua mây, cuộn quanh bạn', ic: 'M3 14c3-6 7 2 10-3s5-6 8-4M17 5l3-2M18 8l3 1' },
  { id: 'phuong-hoang', n: 'Phượng Hoàng Niết Bàn', r: 'gold', src: 'Bí ẩn · Tráp Sơn Mài', d: 'Phượng hoàng sà xuống, xòe cánh lửa', ic: 'M12 4c-1 3-1 5 0 8c1-3 1-5 0-8zM12 12c-5-2-8-6-9-9c3 3 6 5 9 6c3-1 6-3 9-6c-1 3-4 7-9 9zM12 12c-2 4-3 7-6 9M12 12c2 4 3 7 6 9' },
];
const EN = Object.fromEntries(ENTRANCES.map(e => [e.id, e]));
const FXD = { 'lang-le': 3, 'anh-trang': 4.4, 'mac-vu': 4.6, 'truc-lam': 4.8, 'van-kiem': 5, 'huyet-nguyet': 5.4, 'hac-duc': 5.2, 'than-tham': 5, 'kim-long': 6.8, 'phuong-hoang': 5.8 };
const env = (t, a, b, c, d) => t < a ? 0 : t < b ? ss(a, b, t) : t < c ? 1 : t < d ? 1 - ss(c, d, t) : 0;

function swordPath(c, len) { c.beginPath(); c.moveTo(-len * .5, -2.2); c.lineTo(len * .4, -2.2); c.lineTo(len * .5, 0); c.lineTo(len * .4, 2.2); c.lineTo(-len * .5, 2.2); c.closePath(); }
function drawSword(c, x, y, ang, len, a, glint, art = 'kiem') {
  const im = picImg(art) || picImg('kiem');
  if (im) { const L = len * 1.9, h = L * im.naturalHeight / im.naturalWidth; c.save(); c.translate(x, y); c.rotate(ang);
    c.save(); c.globalAlpha = a * .5; c.globalCompositeOperation = 'lighter'; c.scale(1, .22); const g = c.createRadialGradient(L * .15, 0, 0, L * .15, 0, L * .55); g.addColorStop(0, 'rgba(120,190,255,.55)'); g.addColorStop(1, 'rgba(120,190,255,0)'); c.fillStyle = g; c.fillRect(-L * .5, -L * .6, L * 1.3, L * 1.2); c.restore();
    c.globalAlpha = a; c.drawImage(im, -L / 2, -h / 2, L, h);
    if (glint > 0) { const gx = lerp(-L * .05, L * .48, glint), ga = Math.sin(glint * Math.PI) * a; c.globalCompositeOperation = 'lighter'; const gg = c.createRadialGradient(gx, 0, 0, gx, 0, h * 1.4); gg.addColorStop(0, `rgba(240,250,255,${.9 * ga})`); gg.addColorStop(1, 'rgba(200,230,255,0)'); c.fillStyle = gg; c.fillRect(gx - h * 1.4, -h * 1.4, h * 2.8, h * 2.8); }
    c.restore(); return; }

  c.save(); c.translate(x, y); c.rotate(ang); c.globalAlpha = a;
  const g = c.createLinearGradient(0, -2.2, 0, 2.2); g.addColorStop(0, '#f2f6fc'); g.addColorStop(.5, '#9aa4b4'); g.addColorStop(1, '#3a414c'); c.fillStyle = g; swordPath(c, len); c.fill();
  if (glint > 0) { const gx = lerp(-len * .5, len * .45, glint), gg = c.createLinearGradient(gx - 8, 0, gx + 8, 0); gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(.5, 'rgba(255,255,255,.95)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gg; swordPath(c, len); c.fill(); }
  const gg2 = c.createLinearGradient(0, -6, 0, 6); gg2.addColorStop(0, '#f2d07a'); gg2.addColorStop(1, '#7a4a12'); c.fillStyle = gg2; c.fillRect(-len * .5 - 3, -6.5, 3.5, 13);
  c.fillStyle = '#2a0c0c'; c.fillRect(-len * .5 - 14, -1.9, 11, 3.8); c.fillStyle = '#d8a848'; c.beginPath(); c.arc(-len * .5 - 15, 0, 2.6, 0, TAU); c.fill();
  c.restore();
}
function leafShape(c, x, y, rot, s, col) { c.save(); c.translate(x, y); c.rotate(rot); const g = c.createLinearGradient(-s, 0, s, 0); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]); c.fillStyle = g; c.beginPath(); c.moveTo(-s, 0); c.quadraticCurveTo(0, -s * .38, s, 0); c.quadraticCurveTo(0, s * .3, -s, 0); c.fill(); c.strokeStyle = 'rgba(20,40,10,.4)'; c.lineWidth = .6; c.beginPath(); c.moveTo(-s, 0); c.lineTo(s, 0); c.stroke(); c.restore(); }

/* painted creature with a travelling body wave: the image is drawn in thin vertical slices offset by a sine */
function drawWarp(c, img, x, y, w, h, t, o = {}) {
  const N = 56, iw = img.naturalWidth, ih = img.naturalHeight, flip = o.flip ? -1 : 1;
  c.save(); c.translate(x + w / 2, y); c.scale(flip, 1);
  for (let i = 0; i < N; i++) { const u = i / N, head = o.headRight === false ? u : 1 - u, env = Math.pow(head, .8), dy = (o.amp || 10) * env * Math.sin(u * (o.waves || 1.6) * TAU - t * (o.speed || 2.4));
    c.drawImage(img, u * iw, 0, iw / N + 1, ih, -w / 2 + u * w, dy, w / N + .8, h); }
  c.restore();
}
/* The same travelling wave for an uploaded picture. Hand-drawn art can be soft all over, and there the overlap of the
   slices above would show as stripes, so each slice lands on whole pixels of a canvas of its own and touches the next. */
let WARP = null;
function drawWarpSoft(c, img, x, y, w, h, t, o = {}) {
  const N = 56, iw = img.naturalWidth, ih = img.naturalHeight, flip = o.flip ? -1 : 1, amp = o.amp || 10;
  // The camera scales this a little more every frame: in half steps, so the canvas is not reallocated each time.
  const res = Math.min(2, Math.max(1, Math.ceil(Math.abs(c.getTransform().a) * 2) / 2)), W = Math.ceil(w * res), H = Math.ceil((h + amp * 2) * res);
  if (!WARP) WARP = document.createElement('canvas');
  const x2 = WARP.getContext('2d');
  if (WARP.width !== W || WARP.height !== H) { WARP.width = W; WARP.height = H; } else x2.clearRect(0, 0, W, H);
  for (let i = 0; i < N; i++) { const u = i / N, head = o.headRight === false ? u : 1 - u, env = Math.pow(head, .8), dy = amp * env * Math.sin(u * (o.waves || 1.6) * TAU - t * (o.speed || 2.4)), left = Math.round(u * W), right = Math.round((i + 1) / N * W);
    x2.drawImage(img, u * iw, 0, iw / N, ih, left, (amp + dy) * res, right - left, h * res); }
  c.save(); c.translate(x + w / 2, y); c.scale(flip, 1); c.drawImage(WARP, -w / 2, -amp, w, h + amp * 2); c.restore();
}
/* draw one frame of the active entrance. G = { W, H, ax, ay (avatar centre), rw (row width) } */
function drawEntrance(c, id, t, G) {
  const { W, H, ax, ay } = G, R = rng(91), D = FXD[id];
  if (id === 'lang-le') { const a = env(t, 0, .3, 1.2, 2.8); smoke(c, 5, 3, t * 0.6, [ax - 60, ay - 20, 220, 40], '210,218,232', 46 + t * 14, .45 * a, 10); }
  if (id === 'anh-trang') {
    const a = env(t, 0, .9, 2.8, 4.2), drop = easeOut(t / 1.1);
    const g = c.createLinearGradient(0, 0, 0, ay + 30); g.addColorStop(0, 'rgba(180,205,255,0)'); g.addColorStop(.6, `rgba(190,212,255,${.16 * a})`); g.addColorStop(1, `rgba(220,232,255,${.3 * a})`);
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.moveTo(ax - 30, 0); c.lineTo(ax + 30, 0); c.lineTo(ax + 70, (ay + 30) * drop); c.lineTo(ax - 70, (ay + 30) * drop); c.closePath(); c.fill(); c.restore();
    glow(c, ax, ay, 90, '190,212,255', .3 * a * drop);
    for (let i = 0; i < 18; i++) { const x = ax + (R() - .5) * 140, sp = 18 + R() * 20, y = -10 + ((t * sp + R() * 200) % (ay + 40)), al = a * (.4 + R() * .6); glow(c, x + Math.sin(t + i) * 4, y, 4, '230,240,255', al * .7); }
  }
  if (id === 'mac-vu') {
    const a = env(t, 0, .3, 2.2, 4.2);
    for (let i = 0; i < 9; i++) { const img = SPR.smoke(i % 3, '26,28,36', 256); if (!img) continue; const k = easeOut(clamp((t - i * .06) / 1.6)), x = lerp(-160, ax - 40 + (i % 3) * 70, k) + t * 14, y = ay - 30 + ((i * 37) % 70) - 20, s = 90 + i * 8 + t * 18;
      c.save(); c.globalAlpha = .85 * a; c.translate(x, y); c.rotate(i + t * .08); c.drawImage(img, -s, -s, s * 2, s * 2); c.restore(); }
    smoke(c, 4, 5, t, [ax - 80, ay - 30, 220, 50], '200,208,224', 40, .25 * env(t, 1.4, 2.2, 3.2, 4.4), 18);
  }
  if (id === 'truc-lam') {
    const a = env(t, 0, .4, 3.2, 4.6); glow(c, ax, ay, 110, '120,200,120', .18 * a);
    for (let i = 0; i < 26; i++) { const sp = 160 + R() * 120, st = R() * 1.6, y0 = R() * H, u = t - st; if (u < 0) continue; const x = -30 + u * sp, y = y0 + Math.sin(u * 1.8 + i) * 26 + u * 12; if (x > W + 30) continue;
      leafShape(c, x, y, u * 2.2 + i, 9 + R() * 5, R() > .5 ? ['#3e7a2a', '#9ad06a'] : ['#2a5a20', '#7ab850']); }
  }
  if (id === 'van-kiem') {
    const a = env(t, 0, .2, 3.6, 4.8), n = 8;
    glow(c, ax, ay, 120, '150,200,255', .2 * env(t, .8, 1.4, 3.2, 4.4));
    for (let i = 0; i < n; i++) { const ang0 = i / n * TAU, k = easeOut(clamp((t - i * .08) / 1.5)), orbit = ang0 + t * .35, rx = 120, ry = 40, tx = ax + Math.cos(orbit) * rx, ty = ay + Math.sin(orbit) * ry;
      const sx = W / 2 + Math.cos(ang0) * W * .9, sy = H / 2 + Math.sin(ang0) * H * 1.2, rise = Math.max(0, t - 3.2), x = lerp(sx, tx, k), y = lerp(sy, ty, k) - rise * rise * 160, dir = k < 1 ? Math.atan2(ty - sy, tx - sx) : -Math.PI / 2 * ss(3.2, 3.6, t) + (1 - ss(3.2, 3.6, t)) * (orbit + Math.PI / 2);
      drawSword(c, x, y, dir, 56, a, ((t * .7 + i / n) % 1)); }
  }
  if (id === 'huyet-nguyet') {
    const a = env(t, 0, 1, 3.8, 5.2), rise = easeOut(t / 2.4), mx = W * .72, my = lerp(H + 120, H * .34, rise), mr = Math.min(W, H) * .3;
    c.save(); c.fillStyle = `rgba(30,0,4,${.45 * a})`; c.fillRect(0, 0, W, H); c.restore();
    glow(c, mx, my, mr * 2.4, '200,20,30', .4 * a);
    const g = c.createRadialGradient(mx - mr * .3, my - mr * .3, mr * .1, mx, my, mr); g.addColorStop(0, `rgba(255,130,110,${a})`); g.addColorStop(.6, `rgba(176,16,26,${a})`); g.addColorStop(1, `rgba(70,0,8,${a})`); c.fillStyle = g; c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
    const tex = SPR.smoke(1, '60,0,8', 256); if (tex) { c.save(); c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.clip(); c.globalAlpha = .55 * a; c.drawImage(tex, mx - mr, my - mr, mr * 2, mr * 2); c.restore(); }
    smoke(c, 6, 8, t, [0, H - 60, W, 60], '120,10,24', 70, .5 * a, 14);
    for (let i = 0; i < 16; i++) { const st = .8 + R() * 2, u = t - st; if (u < 0) continue; const x = R() * W + u * 30, y = -10 + u * (40 + R() * 30), al = Math.min(1, u) * a; c.save(); c.translate(x + Math.sin(u * 2 + i) * 10, y); c.rotate(u * 1.4 + i); c.globalAlpha = al; c.fillStyle = '#9a0e22'; c.beginPath(); c.ellipse(0, 0, 5, 3, 0, 0, TAU); c.fill(); c.restore(); }
  }
  if (id === 'hac-duc') {
    const a = env(t, 0, .3, 3.8, 5.2), open = easeOut(clamp((t - .2) / 1.4)), sz = Math.min(H * .34, 150), wy = Math.max(ay + 6, sz * 1.38);
    glow(c, ax, ay, 150, '120,60,180', .22 * a);
    c.save(); c.globalAlpha = a; drawWing(c, ax - 18, wy, -1, sz, t, 'dark', { raise: lerp(-1.25, -0.05, open), seed: 2 }); drawWing(c, ax + 18, wy, 1, sz, t, 'dark', { raise: lerp(-1.25, -0.05, open), seed: 8 }); c.restore();
    const img = SPR.fea('dark', 'cov', 64); if (img) for (let i = 0; i < 14; i++) { const st = .9 + R() * 2.2, u = t - st; if (u < 0) continue; const x = ax + (R() - .5) * W * .8 + Math.sin(u * 1.6 + i) * 18, y = ay - 120 + u * (36 + R() * 20); c.save(); c.translate(x, y); c.rotate(Math.sin(u * 1.4 + i) * .8); c.globalAlpha = Math.min(1, u * 1.5) * a; c.drawImage(img, -5, -8, 10, 16); c.restore(); }
  }
  if (id === 'than-tham') {
    const a = env(t, 0, .3, 3.8, 5), k = easeInOut(clamp(t / 2.2)), mx = lerp(-60, ax + 10, k), my = lerp(H * .3, ay, k) + Math.sin(k * Math.PI) * -40, lr = 54;
    c.save(); c.fillStyle = `rgba(6,5,3,${.35 * a})`; c.fillRect(0, 0, W, H); c.restore();
    c.save(); c.beginPath(); c.arc(mx, my, lr, 0, TAU); c.clip(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) { const fx = 30 + i * (W / 12), fy = H * .55 + Math.sin(i * 1.3) * 30; c.fillStyle = 'rgba(255,200,120,.55)'; c.beginPath(); c.ellipse(fx, fy, 5, 9, .3, 0, TAU); c.fill(); c.beginPath(); c.ellipse(fx + 9, fy - 14, 4, 7, .3, 0, TAU); c.fill(); }
    glow(c, mx, my, lr, '200,230,255', .25); c.restore();
    c.save(); c.globalAlpha = a; c.translate(mx, my); const rg = c.createLinearGradient(-lr, -lr, lr, lr); rg.addColorStop(0, '#f6dc96'); rg.addColorStop(.5, '#a87028'); rg.addColorStop(1, '#5a3a10'); c.strokeStyle = rg; c.lineWidth = 7; c.beginPath(); c.arc(0, 0, lr, 0, TAU); c.stroke();
    c.rotate(Math.PI / 4); const hg = c.createLinearGradient(0, -5, 0, 5); hg.addColorStop(0, '#6a3a18'); hg.addColorStop(1, '#2a1406'); c.fillStyle = hg; c.fillRect(lr + 3, -6, 52, 12); c.fillStyle = '#d8a848'; c.fillRect(lr + 2, -7.5, 6, 15); c.restore();
    if (t > 2.4) { const s = 2.2 - 1.2 * easeOut((t - 2.4) / .3), ea = env(t, 2.4, 2.6, 4, 5); c.save(); c.translate(Math.min(W - 90, ax + 200), ay); c.rotate(-.16); c.scale(s, s); c.globalAlpha = ea; c.strokeStyle = '#c8202e'; c.lineWidth = 3.5; c.strokeRect(-56, -20, 112, 40); c.lineWidth = 1.2; c.strokeRect(-50, -14, 100, 28); c.fillStyle = '#c8202e'; c.font = '700 24px "Cormorant SC", Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PHÁ ÁN', 0, 1); c.restore(); }
  }
  if (id === 'kim-long' && picImg('rong-bay')) {
    const im = picImg('rong-bay'), a = env(t, 0, .4, 5.8, 6.8), w = Math.min(W * .9, 620), h = w * im.naturalHeight / im.naturalWidth, k = easeInOut(clamp(t / 6.6)), x = lerp(W + 30, -w - 30, k), y = clamp(ay - h * .45, 4, H - h - 4) + Math.sin(t * 1.3) * 10;
    glow(c, x + w * .5, y + h * .5, w * .55, '255,170,70', .16 * a);
    c.save(); c.globalAlpha = a; drawWarp(c, im, x, y, w, h, t, { flip: true, amp: h * .06, waves: 1.4, speed: 2.6 }); c.restore();
    const hx = x + w * .08; if (Math.abs(hx - ax) < 70) glow(c, ax, ay, 90, '255,226,160', .45 * (1 - Math.abs(hx - ax) / 70));
  }
  else if (id === 'kim-long') {
    const a = env(t, 0, .3, 4.8, 6), cx = Math.min(ax + 60, W * .45), cy = ay;
    for (let i = 0; i < 6; i++) smoke(c, 1, 40 + i, t * .3, [((i * 160 + t * 30) % (W + 200)) - 100, 20 + (i * 53) % (H - 40), 1, 1], '232,190,110', 60, .22 * a, 0);
    glow(c, cx, cy, 200, '255,190,90', .28 * env(t, 1.6, 2.4, 4.4, 5.6));
    const P = τ => { const enter = clamp(τ / 1.8), ex = lerp(W + 160, cx + 150, easeOut(enter)), ey = H * .3 + Math.sin(τ * 3) * 30; const an = (τ - 1.8) * 1.9, lx = cx + Math.cos(an) * 150, ly = cy + Math.sin(an) * 52; const k = ss(1.5, 2.1, τ); return [lerp(ex, lx, k), lerp(ey, ly, k)]; };
    const pts = []; for (let i = 60; i >= 0; i--) pts.push(P(Math.max(0, t - i * .016)));
    c.save(); c.globalAlpha = a; drawDragon(c, pts, { w: 30, t }); c.restore();
    if (t > 4.2) glow(c, cx, cy - 10, 60, '255,240,200', .5 * env(t, 4.2, 4.4, 4.6, 5.2));
  }
  if (id === 'phuong-hoang' && picImg('phuong-xoe')) {
    const im = picImg('phuong-xoe'), a = env(t, 0, .3, 4.6, 5.8), k = easeOut(clamp(t / 2.2)), h = Math.min(H * .86, 360), w = h * im.naturalWidth / im.naturalHeight, cx = Math.min(ax + 90, W * .42), cy = lerp(-h * .6, clamp(ay + 20, h / 2 + 4, H - h / 2), k);
    const flap = (1 - ss(1.4, 2.6, t)) * Math.sin(t * 5.2) * .07 + Math.sin(t * .9) * .015;
    glow(c, cx, cy, h * .7, '255,110,40', .3 * a); glow(c, ax, ay, 150, '255,160,60', .22 * env(t, 1.6, 2.2, 4.2, 5.4));
    c.save(); c.globalAlpha = a; c.translate(cx, cy); c.scale(1 + flap, 1 - flap * .35); c.drawImage(im, -w / 2, -h / 2, w, h); c.restore();
    motes(c, 12, 55, t, [cx - w / 2, cy, w, h * .5], '255,160,60', 1.6, .8, a);
  }
  else if (id === 'phuong-hoang') {
    const a = env(t, 0, .3, 4.6, 5.8), k = easeOut(clamp(t / 2)), px = Math.min(ax + 40, W * .4), py = lerp(-120, ay - 20, k), s = Math.min(90, H * .3);
    glow(c, px, py + 30, 220, '255,120,40', .32 * a); glow(c, ax, ay, 160, '255,160,60', .22 * env(t, 1.6, 2.2, 4.2, 5.4));
    const flap = (1 - ss(1.6, 2.4, t)) * Math.sin(t * 7) * .45;
    c.save(); c.globalAlpha = a; drawPhoenixFront(c, px, py, s, t, { raise: -0.15 + flap, wing: 1.2 }); c.restore();
    motes(c, 10, 55, t, [px - 120, py, 240, 120], '255,160,60', 1.6, .8, a);
  }
}

/* "flipbook": an entrance an artist drew as a sprite sheet (frames left to right, top to bottom), played by stage.js */
const FLIPBOOK = { d: 'Ảnh động do họa sĩ vẽ', ic: 'M4 4h16v16H4zM4 12h16M12 4v16', seconds: 6 };

/* an entrance described by data: one of the stages, with its own words, colour and pictures. { n, r, src, d, tpl, tint, imageUrl, swordUrl, duration, flip }
   flip (tpl "flipbook"): { sheetUrl, cols, rows, frames, fps, loop, place, size, blend } */
function defineEntrance(id, o, { listed = true } = {}) {
  const flip = o.tpl === 'flipbook' && o.flip?.sheetUrl ? o.flip : null;
  const tpl = flip ? 'flipbook' : EN[o.tpl] && !EN[o.tpl].made ? o.tpl : 'lang-le', base = flip ? FLIPBOOK : EN[tpl], e = EN[id] || { id };
  Object.assign(e, { n: o.n, r: o.r, src: o.src, d: o.d || base.d, ic: base.ic, made: true, tpl, tint: o.tint || null, duration: o.duration || null, creature: o.imageUrl ? uploadedPic(o.imageUrl) : null, sword: o.swordUrl ? uploadedPic(o.swordUrl) : null,
    flip: flip ? { ...flip, sheet: uploadedPic(flip.sheetUrl) } : null });
  FXD[id] = flip ? FLIPBOOK.seconds : FXD[tpl];
  if (!EN[id]) { EN[id] = e; if (listed) ENTRANCES.push(e); }
}

export { EN, ENTRANCES, FXD, defineEntrance, drawEntrance, drawSword, drawWarp, drawWarpSoft, env, leafShape };
