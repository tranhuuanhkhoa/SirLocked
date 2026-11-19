/*
 * Moved as it is from the approved prototype (ho-so-src/stage.js): only imports and exports were added,
 * plus the changes listed in cosmetics/README.md. The drawing is not to be redrawn or simplified.
 */
import { forgetCanvas, paintFrame, picFailed, picImg, raysFx } from './frames.js';
import { EN, drawSword, drawWarp, drawWarpSoft, env, leafShape } from './fx.js';
import { SPR, TAU, clamp, drawWing, easeInOut, easeOut, glow, lerp, motes, retint, rng, smoke, ss, wob } from './lib.js';
import { T, setPlaqueMotion, titleHTML } from './titles.js';
import { chime, warmChime } from './chime.js';

const STG = { 'lang-le': [4.2, .6], 'anh-trang': [6.6, 1.5], 'mac-vu': [7, 2.3], 'truc-lam': [6.8, 1.8], 'van-kiem': [7.4, 2.1], 'huyet-nguyet': [7.2, 2.0], 'hac-duc': [7.2, 1.3], 'than-tham': [7.8, 3.3], 'kim-long': [8.2, 3.0], 'phuong-hoang': [8, 2.5], flipbook: [6, 1.4] }; // [duration, hero reveal]
/* which stage an entrance plays and for how long; an entrance made from a template borrows its stage */
const stageOf = id => EN[id]?.tpl || id;
const timingOf = id => { const [D, rv] = STG[stageOf(id)]; return [EN[id]?.duration || D, rv]; };
/* an entrance's own picture when it has one and it has come; what ships when it failed; nothing while it is on its way */
const artOf = (own, shipped) => { if (!own) return softImg(shipped); return softImg(own) || (picFailed(own) ? softImg(shipped) : null); };
const backOut = k => { k = clamp(k); const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
/* Pixels of the full-screen canvas. Its effects are soft, so 1.5x looks like 2x at about half the cost. A machine that
   falls behind steps down further while it plays, and the next entrance starts where this one ended; the hero's portrait,
   name and title are not on this canvas, so they stay sharp. */
const STAGE_MAX_DPR = 1.5, STAGE_MIN_DPR = .75, STAGE_SLOW_S = .04, STAGE_SLOW_FRAMES = 10;
let stageQuality = 1;
const stageDpr = () => Math.max(Math.min(STAGE_MIN_DPR, window.devicePixelRatio || 1), Math.min(STAGE_MAX_DPR, window.devicePixelRatio || 1) * stageQuality);
let stage = null;
const stageOpen = () => !!stage;
/* player: { name, frameId, titleId, avatar: () => Image }. onClose runs when the stage ends by itself or is skipped, not on a silent close. */
function openStage(id, player, { onClose, skipLabel = 'Bỏ qua', arrivedLabel = 'đã vào sảnh' } = {}) {
  closeStage(true);
  warmChime();
  const e = EN[id]; if (e.creature) picImg(e.creature); if (e.sword) picImg(e.sword); if (e.flip) picImg(e.flip.sheet);
  const el = document.createElement('div'); el.className = 'hs-stage'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Hiệu ứng vào sảnh ' + e.n);
  el.innerHTML = `<canvas class="hs-stc" aria-hidden="true"></canvas><div class="hs-hero hs-r-${e.r}"><canvas class="hs-hav" width="190" height="190" aria-hidden="true"></canvas><b class="hs-hn"></b><div class="hs-ht">${titleHTML(T[player.titleId] || T['tan-binh'], { maxW: Math.min(window.innerWidth - 32, 620) })}</div><small></small></div><i class="hs-lb hs-lb-t"></i><i class="hs-lb hs-lb-b"></i><button class="hs-skip" type="button"></button>`;
  el.querySelector('.hs-hn').textContent = player.name; el.querySelector('.hs-hero small').textContent = `${arrivedLabel} · ${e.n}`; el.querySelector('.hs-skip').textContent = skipLabel;
  document.body.append(el);
  const cv = el.querySelector('.hs-stc'), d = stageDpr(); cv.width = Math.round(innerWidth * d); cv.height = Math.round(innerHeight * d);
  // The entrance has the machine to itself: plaques on the page underneath rest until it ends (see css/48-cosmetics.css).
  document.body.classList.add('hs-stage-open');
  setPlaqueMotion(el.querySelector('.hs-ht'), true);
  stage = { el, cv, c: cv.getContext('2d'), d, id, player, onClose, slow: 0, lastAt: 0, hero: el.querySelector('.hs-hero'), hv: el.querySelector('.hs-hav'), heroAt: null, prevFocus: document.activeElement, t0: performance.now() / 1000, shown: false, parts: null };
  document.addEventListener('keydown', onStageKey); stageRaf = requestAnimationFrame(stageTick);
  requestAnimationFrame(() => el.classList.add('hs-on'));
  el.querySelector('.hs-skip').addEventListener('click', () => closeStage());
  el.addEventListener('click', ev => { if (ev.target === el || ev.target === cv) closeStage(); });
  setTimeout(() => el.querySelector('.hs-skip')?.focus(), 50);
}
function closeStage(silent) {
  if (!stage) return; const s = stage; stage = null; cancelAnimationFrame(stageRaf); document.removeEventListener('keydown', onStageKey);
  document.body.classList.remove('hs-stage-open');
  forgetCanvas(s.hv);
  s.el.classList.add('hs-out');
  if (s.prevFocus?.isConnected) s.prevFocus.focus?.({ preventScroll: true });
  // onClose waits for the fade: a queued entrance must not start on top of this one.
  setTimeout(() => { s.el.remove(); if (!silent) s.onClose?.(EN[s.id].r); }, silent ? 0 : 450);
}
function stageFrame(now) {
  if (!stage) return; const S = stage, t = now - S.t0, [D, rv] = timingOf(S.id);
  if (t > D) { closeStage(); return; }
  S.slow = S.lastAt && now - S.lastAt > STAGE_SLOW_S ? S.slow + 1 : Math.max(0, S.slow - 1); S.lastAt = now;
  if (S.slow >= STAGE_SLOW_FRAMES && S.d > STAGE_MIN_DPR) { stageQuality *= .75; S.d = stageDpr(); S.slow = 0; }
  const W = innerWidth, H = innerHeight, c = S.c;
  if (S.cv.width !== Math.round(W * S.d)) { S.cv.width = Math.round(W * S.d); S.cv.height = Math.round(H * S.d); }
  c.setTransform(S.d, 0, 0, S.d, 0, 0); c.clearRect(0, 0, W, H);
  // The hero stays centred while the camera scales it, so where it sits is read twice a second, not every frame.
  if (!S.heroAt || now - S.heroAt.at > .5) { const hr = S.hv.getBoundingClientRect(); S.heroAt = { at: now, x: hr.left + hr.width / 2, y: hr.top + hr.height / 2 }; }
  const hv = S.hv, cx = S.heroAt.x, cy = S.heroAt.y, m = Math.min(W, H);
  if (!S.shown && t >= rv) { S.shown = true; S.hero.classList.add('hs-show'); chime(EN[S.id].r); }
  if (t > D - .6) S.el.classList.add('hs-fading');
  // cinematic camera: slow push-in with a gentle drift, smooth (not jittery) shake
  const cam = 1 + .085 * easeInOut(t / D), dx = Math.sin(t * .35) * m * .012, dy = Math.cos(t * .27) * m * .008;
  const shA = S.shake ? S.shake(t) : 0, sx = shA * Math.sin(t * 47) * .6, sy = shA * Math.cos(t * 39) * .6;
  S.hero.style.scale = (1 + (cam - 1) * .6).toFixed(4);
  c.save(); c.translate(W / 2 + dx + sx, H / 2 + dy + sy); c.scale(cam, cam); c.translate(-W / 2, -H / 2);
  const ex = W / 2 + (cx - W / 2) / cam, ey = H / 2 + (cy - H / 2) / cam;
  drawStage(c, S, stageOf(S.id), t, { W, H, cx: ex, cy: ey, m, D, rv });
  c.restore();
  cinemaPost(c, S, t, W, H, cx, cy, m, D, rv);
  paintFrame(hv, S.player.frameId, now, S.player.avatar());
}
/* the stage owns its loop: it runs only while it is open and stops on the first error instead of freezing the screen */
let stageRaf = 0;
function stageTick() {
  if (!stage) return;
  try { stageFrame(performance.now() / 1000); } catch (e) { console.error(e); closeStage(); return; }
  if (stage) stageRaf = requestAnimationFrame(stageTick);
}
function onStageKey(e) { if (e.key === 'Escape') closeStage(); }
/* lens & film finishing: oval vignette, anamorphic flare at the reveal, light leak, fine grain */
let GRAIN = null;
function cinemaPost(c, S, t, W, H, cx, cy, m, D, rv) {
  const fin = env(t, 0, .4, D - .7, D);
  const v = c.createRadialGradient(W / 2, H / 2, m * .28, W / 2, H / 2, Math.hypot(W, H) * .62); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(.6, `rgba(0,0,0,${.35 * fin})`); v.addColorStop(1, `rgba(0,0,0,${.85 * fin})`); c.fillStyle = v; c.fillRect(0, 0, W, H);
  const col = EN[S.id].tint || { common: '220,226,240', rare: '170,200,255', myth: '200,160,255', leg: '255,150,110', gold: '255,214,140' }[EN[S.id].r];
  // light leak drifting across a corner
  glow(c, W * (.15 + .1 * Math.sin(t * .4)), H * .1, m * .7, col, .1 * fin, 'screen');
  // anamorphic streak + bloom when the hero appears
  const fl = env(t, rv - .15, rv + .05, rv + .25, rv + 1.3);
  if (fl > 0) { c.save(); c.globalCompositeOperation = 'lighter';
    for (const [h, a] of [[m * .012, .9], [m * .04, .35], [m * .1, .12]]) { const g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(.5, `rgba(${col},${a * fl})`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, W * .55, h, 0, 0, TAU); c.fill(); }
    c.restore(); glow(c, cx, cy, m * .35 * (1 + (1 - fl) * .5), '255,250,235', .55 * fl); }
  // a soft white dip right at the reveal
  const flash = env(t, rv - .08, rv, rv + .02, rv + .45); if (flash > 0) { c.fillStyle = `rgba(255,250,240,${.22 * flash})`; c.fillRect(0, 0, W, H); }
  // film grain
  if (!GRAIN) { GRAIN = document.createElement('canvas'); GRAIN.width = GRAIN.height = 192; const g = GRAIN.getContext('2d'), id = g.createImageData(192, 192); for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); }
  c.save(); c.globalAlpha = .055 * fin; c.globalCompositeOperation = 'overlay'; c.fillStyle = c.createPattern(GRAIN, 'repeat'); const o = (t * 997 % 192) | 0; c.translate(-o, -((o * 7) % 192)); c.fillRect(0, 0, W + 192, H + 192); c.restore();
}
/* painted art with feathered edges (no visible rectangles) */
const SOFT = {}, SOFT_MAX = 1400;
function softImg(key) { if (SOFT[key]) return SOFT[key]; const im = picImg(key); if (!im) return null;
  
  /* an uploaded picture may be far larger than the stage ever shows; what ships is not touched by this */
  const fit = Math.min(1, SOFT_MAX / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.round(im.naturalWidth * fit), h = Math.round(im.naturalHeight * fit), cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.drawImage(im, 0, 0, w, h);
  x.globalCompositeOperation = 'destination-in'; const f = Math.min(w, h) * .035;
  const gx = x.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(f / w, '#000'); gx.addColorStop(1 - f / w, '#000'); gx.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gx; x.fillRect(0, 0, w, h);
  const gy = x.createLinearGradient(0, 0, 0, h); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(f / h, '#000'); gy.addColorStop(1 - f / h, '#000'); gy.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gy; x.fillRect(0, 0, w, h);
  cv.naturalWidth = w; cv.naturalHeight = h; return (SOFT[key] = cv); }
/*
 * An entrance drawn by an artist as a sprite sheet: cols x rows cells read left to right, top to bottom, the first `frames`
 * of them played at `fps`, looping or holding the last one. `place` puts it around the arriving player (behind the portrait),
 * over the whole screen, flying across it, or dropping in from above. "add" lays it as light, for art drawn on black.
 */
function drawFlipbook(c, own, t, G, fin, dim) {
  const { W, H, cx, cy, m, D } = G, f = own.flip; if (!f) return;
  const col = own.tint || { common: '220,226,240', rare: '170,200,255', myth: '200,160,255', leg: '255,150,110', gold: '255,214,140' }[own.r] || '255,214,140';
  dim('6,8,12', .55);
  glow(c, cx, cy, m * .42, col, .2 * fin);
  const im = picImg(f.sheet); if (!im) return;
  const cols = f.cols || 1, rows = f.rows || 1, cells = cols * rows, frames = Math.max(1, Math.min(f.frames || cells, cells)), fps = f.fps || 12;
  const n = Math.floor(t * fps), k = f.loop === false ? Math.min(frames - 1, n) : n % frames;
  const fw = im.naturalWidth / cols, fh = im.naturalHeight / rows, sx = (k % cols) * fw, sy = Math.floor(k / cols) * fh, size = f.size || 1;
  let w, h, x, y;
  if (f.place === 'screen') { const s = Math.max(W / fw, H / fh) * size; w = fw * s; h = fh * s; x = (W - w) / 2; y = (H - h) / 2; }
  else {
    h = m * .55 * size; w = h * fw / fh;
    if (f.place === 'across') { const k2 = easeInOut(clamp(t / Math.max(1, D - .4))); x = lerp(W + 20, -w - 20, k2); y = cy - h / 2; }
    else if (f.place === 'drop') { const k2 = backOut(clamp(t / 1.5)); x = cx - w / 2; y = lerp(-h - 20, cy - h / 2, k2); }
    else { x = cx - w / 2; y = cy - h / 2; }
  }
  c.save(); c.globalAlpha = fin; if (f.blend === 'add') c.globalCompositeOperation = 'lighter';
  c.drawImage(im, sx, sy, fw, fh, x, y, w, h); c.restore();
}
/* ---- the effects ---- */
function drawStage(c, S, id, t, G) {
  const { W, H, cx, cy, m, D, rv } = G, fin = env(t, 0, .35, D - .7, D), R0 = rng(77), own = EN[S.id] || {}, P = col => retint(col, own.tint);
  const dim = (rgb, a) => { const g = c.createRadialGradient(cx, cy, m * .12, cx, cy, Math.hypot(W, H) * .7); g.addColorStop(0, `rgba(${rgb},${a * .5 * fin})`); g.addColorStop(1, `rgba(${rgb},${Math.min(1, a * 1.15) * fin})`); c.fillStyle = g; c.fillRect(-W * .2, -H * .2, W * 1.4, H * 1.4); };
  if (id === 'flipbook') { drawFlipbook(c, own, t, G, fin, dim); return; }
  if (id === 'lang-le') { dim(P('6,8,12'), .7); smoke(c, 10, 3, t * .5, [cx - m * .4, cy - m * .2, m * .8, m * .4], P('210,218,232'), m * .14 + t * 30, .5 * fin, 20); glow(c, cx, cy, m * .35, P('200,210,230'), .18 * fin); }

  if (id === 'anh-trang') { dim(P('4,8,20'), .8);
    const mr = m * .13, mx = W * .74, my = lerp(H * .42, H * .2, easeOut(t / 1.8));
    glow(c, mx, my, mr * 5, P('170,200,255'), .24 * fin); const g = c.createRadialGradient(mx - mr * .3, my - mr * .3, mr * .1, mx, my, mr); g.addColorStop(0, `rgba(${P('255,255,248')},${fin})`); g.addColorStop(.85, `rgba(${P('214,220,232')},${fin})`); g.addColorStop(1, `rgba(${P('170,180,200')},${fin})`); c.fillStyle = g; c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
    const tex = SPR.smoke(1, P('150,160,180'), 256); if (tex) { c.save(); c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.clip(); c.globalAlpha = .35 * fin; c.drawImage(tex, mx - mr, my - mr, mr * 2, mr * 2); c.restore(); }
    for (let i = 0; i < 6; i++) { const img = SPR.smoke(i % 3, P('190,200,224'), 256); if (!img) continue; const s = m * (.28 + i * .04), x = ((i * .23 + t * .04) % 1.4 - .2) * W, y = H * (.12 + i * .07); c.save(); c.globalAlpha = .17 * fin; c.drawImage(img, x - s, y - s * .45, s * 2, s * .9); c.restore(); }
    const b = ss(.5, 1.5, t) * fin, gw = c.createLinearGradient(0, 0, 0, cy + m * .2); gw.addColorStop(0, `rgba(${P('190,212,255')},0)`); gw.addColorStop(.7, `rgba(${P('200,220,255')},${.22 * b})`); gw.addColorStop(1, `rgba(${P('230,240,255')},${.4 * b})`);
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = gw; for (let L = 0; L < 7; L++) { const f = .35 + L * .11; c.globalAlpha = .075; c.beginPath(); c.moveTo(cx - m * .06 * f, 0); c.lineTo(cx + m * .06 * f, 0); c.lineTo(cx + m * .27 * f, cy + m * .2); c.lineTo(cx - m * .27 * f, cy + m * .2); c.closePath(); c.fill(); } c.restore(); glow(c, cx, cy + m * .17, m * .3, P('220,232,255'), .25 * b);
    for (let i = 0; i < 90; i++) { const x = R0() * W, sp = 18 + R0() * 34, y = (R0() * H + t * sp) % (H + 20) - 10, a = (.3 + .7 * Math.abs(Math.sin(t * 2 + i))) * fin; glow(c, x + Math.sin(t + i) * 6, y, 2.5 + R0() * 2.5, P('225,236,255'), a * .8); }
    for (let k = 0; k < 3; k++) { const r = (Math.max(0, t - rv) * 140 + k * 70) % 260; if (t > rv) { c.strokeStyle = `rgba(${P('210,228,255')},${(1 - r / 260) * .5 * fin})`; c.lineWidth = 2; c.beginPath(); c.ellipse(cx, cy + m * .17, r * 1.4, r * .35, 0, 0, TAU); c.stroke(); } }
  }

  if (id === 'mac-vu') { dim(P('4,4,6'), .55);
    for (let i = 0; i < 26; i++) { const img = SPR.smoke(i % 3, i % 4 ? P('14,14,18') : P('40,42,52'), 512); if (!img) continue;
      const k = easeOut(clamp((t - i * .025) / 1.3)), part = ss(1.9, 2.9, t), y0 = (i * 97 % 100) / 100 * H, x0 = lerp(-m * .6, ((i * 61) % 100) / 100 * W, k), dx = x0 - cx, dy = y0 - cy, dl = Math.hypot(dx, dy) || 1, s = m * (.32 + (i % 5) * .05) * (1 + t * .05);
      const x = x0 + dx / dl * part * m * .8, y = y0 + dy / dl * part * m * .5; c.save(); c.globalAlpha = .92 * fin * (1 - part * .85); c.translate(x, y); c.rotate(i + t * .06); c.drawImage(img, -s, -s, s * 2, s * 2); c.restore(); }
    for (let i = 0; i < 9; i++) { const st = .3 + i * .1, a = env(t, st, st + .12, 2.2, 3) * fin; if (a <= 0) continue; const x = W * (.1 + R0() * .8), y = H * (.1 + R0() * .8), r = m * (.02 + R0() * .04) * easeOut((t - st) / .25); c.fillStyle = `rgba(${P('6,6,8')},${a})`; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); for (let j = 0; j < 7; j++) { const an = R0() * TAU, d = r * (1.2 + R0() * 1.4); c.beginPath(); c.arc(x + Math.cos(an) * d, y + Math.sin(an) * d, r * (.12 + R0() * .2), 0, TAU); c.fill(); } }
    const ek = easeInOut(clamp((t - 2.1) / 1)); if (ek > 0) { const R = m * .2, a1 = -1.1, sweep = 5.6 * ek; c.save(); c.globalAlpha = fin; c.lineCap = 'round'; c.globalCompositeOperation = 'lighter';
      for (let j = 0; j < 40 && j / 40 < ek; j++) { const u = j / 40; c.strokeStyle = `rgba(${P('232,236,246')},${.85 - u * .4})`; c.lineWidth = m * .028 * (1 - u * .75); c.beginPath(); c.arc(cx, cy, R, a1 + 5.6 * u, a1 + 5.6 * Math.min(ek, (j + 1.15) / 40)); c.stroke(); }
      c.restore(); glow(c, cx, cy, R * 1.4, P('210,218,240'), .25 * ek * fin); }
    if (t > 3.1) { const k = easeOut((t - 3.1) / .25), s = lerp(2.4, 1, k); c.save(); c.translate(cx + m * .22, cy + m * .16); c.rotate(-.12); c.scale(s, s); c.globalAlpha = env(t, 3.1, 3.2, D - .7, D); c.fillStyle = P('#a3161c'); c.fillRect(-18, -18, 36, 36); c.strokeStyle = P('#f6e8e0'); c.lineWidth = 2.6; c.lineCap = 'round'; c.beginPath(); c.moveTo(-10, -10); c.lineTo(10, -10); c.moveTo(0, -14); c.lineTo(0, 14); c.moveTo(-10, 2); c.lineTo(10, 2); c.moveTo(-8, 9); c.lineTo(8, 13); c.stroke(); c.restore(); }
    smoke(c, 6, 9, t, [cx - m * .3, cy - m * .1, m * .6, m * .3], P('200,208,224'), m * .1, .3 * env(t, 2.4, 3, D - 1, D), 30);
  }

  if (id === 'truc-lam') { dim(P('4,10,6'), .65);
    const gr = easeOut(clamp(t / 1.6));
    for (const [x, hh, ph] of [[W * .04, 1, 0], [W * .11, .8, 1], [W * .18, .62, 2], [W * .96, 1, 3], [W * .89, .82, 4], [W * .82, .6, 5]]) { const top = H - H * hh * gr, sway = Math.sin(t * .9 + ph) * 18 * (1 - top / H);
      for (let y = H; y > top; y -= m * .09) { const k = (H - y) / (H * hh), xx = x + sway * k * k, seg = Math.min(m * .085, y - top); const g = c.createLinearGradient(xx - 10, 0, xx + 10, 0); g.addColorStop(0, `rgba(${P('40,80,30')},${fin})`); g.addColorStop(.45, `rgba(${P('130,190,90')},${fin})`); g.addColorStop(1, `rgba(${P('30,60,24')},${fin})`); c.fillStyle = g; c.beginPath(); if (c.roundRect) c.roundRect(xx - m * .013, y - seg, m * .026, seg - 2, m * .012); else c.rect(xx - m * .013, y - seg, m * .026, seg - 2); c.fill(); c.fillStyle = `rgba(${P('190,230,140')},${fin})`; c.fillRect(xx - m * .015, y - 3, m * .03, 3); } }
    glow(c, cx, cy, m * .45, P('120,220,120'), .25 * fin);
    for (let i = 0; i < 80; i++) { const sp = 180 + R0() * 220, st = R0() * 2.4, y0 = R0() * H, u = t - st; if (u < 0) continue; const x = -40 + u * sp * (W / 900), y = y0 + Math.sin(u * 1.6 + i) * 40 + u * 20; if (x > W + 40) continue; leafShape(c, x, y, u * 2.4 + i, m * (.012 + R0() * .012), R0() > .5 ? [P('#3e7a2a'), P('#a6d870')] : [P('#2a5a20'), P('#86c058')]); }
  }

  if (id === 'van-kiem') { dim(P('4,8,16'), .72);
    const N1 = 10, N2 = 14, launch = ss(3.9, 4.3, t);
    glow(c, cx, cy, m * .5, P('130,190,255'), .28 * env(t, 1.6, 2.1, D - 1, D));
    const pos = (i, tt) => { const inner = i < N1, n = inner ? N1 : N2, j = inner ? i : i - N1, R = m * (inner ? .23 : .37), arr = .15 + i * .07, k = easeOut(clamp((tt - arr) / 1.1)), ang0 = j / n * TAU, spin = (inner ? 1 : -1) * Math.max(0, tt - 1.8) * .7, a = ang0 + spin;
      const tx = cx + Math.cos(a) * R, ty = cy + Math.sin(a) * R * .55, e = i % 4, sx = e === 0 ? -80 : e === 1 ? W + 80 : (i * 131 % 100) / 100 * W, sy = e === 2 ? -80 : e === 3 ? H + 80 : (i * 71 % 100) / 100 * H;
      const bx = (sx + tx) / 2 + (ty - sy) * .35, by = (sy + ty) / 2 - (tx - sx) * .35, u = 1 - k; let x = u * u * sx + 2 * u * k * bx + k * k * tx, y = u * u * sy + 2 * u * k * by + k * k * ty;
      const L = Math.max(0, tt - 3.9 - i * .015); y -= L * L * 2600; return [x, y, a, k]; };
    for (let i = 0; i < N1 + N2; i++) { const [x, y, a, k] = pos(i, t), [px, py] = pos(i, t - .06); if (k <= 0) continue; const dir = k < 1 ? Math.atan2(y - py, x - px) : launch > 0 ? -Math.PI / 2 : a + Math.PI / 2;
      if (Math.hypot(x - px, y - py) > 4) { const g = c.createLinearGradient(px, py, x, y); g.addColorStop(0, `rgba(${P('160,210,255')},0)`); g.addColorStop(1, `rgba(${P('200,230,255')},${.55 * fin})`); c.strokeStyle = g; c.lineWidth = 3; c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke(); }
      drawSword(c, x, y, dir, m * .12, fin, ((t * .8 + i / 24) % 1), own.sword || 'kiem'); }
    const sw = t - 1.95; if (sw > 0 && sw < 1) { c.strokeStyle = `rgba(${P('190,226,255')},${(1 - sw) * .8})`; c.lineWidth = 4; c.beginPath(); c.ellipse(cx, cy, sw * m * .9, sw * m * .4, 0, 0, TAU); c.stroke(); glow(c, cx, cy, m * .3, P('220,240,255'), (1 - sw) * .5); }
    S.shake = tt => (tt > 1.95 && tt < 2.6) ? 9 * Math.pow(1 - (tt - 1.95) / .65, 2) : 0;
  }

  if (id === 'huyet-nguyet') { dim(P('26,0,4'), .62);
    const mr = m * .3, mx = W * .5, my = lerp(H + mr, H * .34, easeOut(t / 2.6));
    glow(c, mx, my, mr * 2.6, P('200,20,30'), .5 * fin); const g = c.createRadialGradient(mx - mr * .3, my - mr * .3, mr * .1, mx, my, mr); g.addColorStop(0, `rgba(${P('255,130,110')},${fin})`); g.addColorStop(.6, `rgba(${P('176,16,26')},${fin})`); g.addColorStop(1, `rgba(${P('70,0,8')},${fin})`); c.fillStyle = g; c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
    const tex = SPR.smoke(1, P('60,0,8'), 512); if (tex) { c.save(); c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.clip(); c.globalAlpha = .55 * fin; c.drawImage(tex, mx - mr, my - mr, mr * 2, mr * 2); c.restore(); }
    smoke(c, 10, 8, t, [0, H - m * .25, W, m * .25], P('130,10,24'), m * .2, .55 * fin, 18);
    for (let i = 0; i < 60; i++) { const st = R0() * 3, u = t - st; if (u < 0) continue; const x = R0() * W + u * 40, y = -10 + u * (60 + R0() * 60); c.save(); c.translate(x + Math.sin(u * 2 + i) * 14, y); c.rotate(u * 1.6 + i); c.globalAlpha = Math.min(1, u) * fin; c.fillStyle = i % 3 ? P('#9a0e22') : P('#d02a40'); c.beginPath(); c.ellipse(0, 0, m * .008, m * .005, 0, 0, TAU); c.fill(); c.restore(); }
  }

  if (id === 'hac-duc') { dim(P('8,4,16'), .78);
    const open = backOut(clamp((t - .4) / 1.3)), sz = m * .42;
    glow(c, cx, cy, m * .55, P('130,70,255'), .35 * fin);
    c.save(); c.globalAlpha = fin; drawWing(c, cx - m * .05, cy + m * .04, -1, sz, t, 'dark', { raise: lerp(-1.35, -0.05, open), seed: 2 }); drawWing(c, cx + m * .05, cy + m * .04, 1, sz, t, 'dark', { raise: lerp(-1.35, -0.05, open), seed: 8 }); c.restore();
    const img = SPR.fea('dark', 'cov', 64); if (img) for (let i = 0; i < 90; i++) { const st = .3 + R0() * .6, u = t - st; if (u < 0) continue; const an = R0() * TAU, sp = m * (.5 + R0() * .9), dec = 1 - Math.exp(-u * 2.2), x = cx + Math.cos(an) * sp * dec + Math.sin(u * 1.4 + i) * 20, y = cy + Math.sin(an) * sp * dec * .7 + u * u * 22, s = m * (.018 + R0() * .014);
      c.save(); c.translate(x, y); c.rotate(an + u * 1.2); c.globalAlpha = fin * Math.min(1, u * 3); c.drawImage(img, -s * .5, -s, s, s * 2); c.restore(); }
    if (t > .5 && t < 1) glow(c, cx, cy, m * .6, P('200,170,255'), (1 - (t - .5) / .5) * .4);
  }

  if (id === 'than-tham') { dim(P('4,3,2'), .8);
    const lr = m * .17, k = easeInOut(clamp(t / 3)), path = u => [lerp(-lr * 1.4, cx, u) + Math.sin(u * Math.PI) * m * .05, lerp(H * .78, cy, u) - Math.sin(u * Math.PI) * m * .25], [lx, ly] = path(k);
    const prints = Array.from({ length: 11 }, (_, i) => { const u = i / 11, [x, y] = path(u); return [x + (i % 2 ? 14 : -14), y + 40, u]; });
    for (const [x, y, u] of prints) { const seen = clamp((k - u) * 6); if (seen > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(${P('255,190,90')},${.5 * seen * fin})`; c.beginPath(); c.ellipse(x, y, 7, 12, .3, 0, TAU); c.fill(); c.beginPath(); c.ellipse(x + 8, y - 16, 5, 8, .3, 0, TAU); c.fill(); c.restore(); glow(c, x, y, 26, P('255,180,80'), .25 * seen * fin); } }
    c.save(); c.beginPath(); c.arc(lx, ly, lr, 0, TAU); c.clip(); c.fillStyle = `rgba(${P('255,236,200')},${.08 * fin})`; c.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
    for (const [x, y] of prints) { c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(${P('255,214,140')},${.8 * fin})`; c.beginPath(); c.ellipse(lx + (x - lx) * 1.4, ly + (y - ly) * 1.4, 10, 17, .3, 0, TAU); c.fill(); } c.restore();
    c.save(); c.globalAlpha = fin; c.translate(lx, ly); const rg = c.createLinearGradient(-lr, -lr, lr, lr); rg.addColorStop(0, P('#fbe6a6')); rg.addColorStop(.5, P('#b07a2c')); rg.addColorStop(1, P('#5a3a10')); c.strokeStyle = rg; c.lineWidth = lr * .14; c.beginPath(); c.arc(0, 0, lr, 0, TAU); c.stroke(); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, lr * .8, 3.6, 4.6); c.stroke();
    c.rotate(Math.PI / 4); const hg = c.createLinearGradient(0, -8, 0, 8); hg.addColorStop(0, P('#6a3a18')); hg.addColorStop(1, P('#2a1406')); c.fillStyle = hg; c.fillRect(lr * 1.07, -lr * .1, lr * 1.1, lr * .2); c.fillStyle = P('#d8a848'); c.fillRect(lr * 1.05, -lr * .13, lr * .12, lr * .26); c.restore();
    if (t > 3 && t < 3.6) glow(c, lx, ly, lr * 2, P('255,240,200'), (1 - (t - 3) / .6) * .6);
    if (t > 3.6) { const kk = backOut((t - 3.6) / .35), s = lerp(3, 1, clamp(kk)), a = env(t, 3.6, 3.7, D - .7, D); c.save(); c.translate(cx + m * .2, cy + m * .18); c.rotate(-.16); c.scale(s, s); c.globalAlpha = a; c.strokeStyle = P('#c8202e'); c.lineWidth = 5; c.strokeRect(-80, -28, 160, 56); c.lineWidth = 1.8; c.strokeRect(-72, -20, 144, 40); c.fillStyle = P('#c8202e'); c.font = '700 34px "Cormorant SC", Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PHÁ ÁN', 0, 2); c.restore(); }
    S.shake = tt => (tt > 3.6 && tt < 4.2) ? 8 * Math.pow(1 - (tt - 3.6) / .6, 2) : 0;
    motes(c, 18, 4, t, [0, H * .3, W, H * .7], P('255,210,130'), 1.8, .7, .8 * fin);
  }

  if (id === 'kim-long') { dim(P('14,8,2'), .62);
    for (let i = 0; i < 7; i++) { const img = SPR.smoke(i % 3, P('240,200,120'), 512); if (!img) continue; const s = m * (.3 + i * .05), x = ((i * .19 + t * .035 * (1 + i % 3)) % 1.5 - .25) * W, y = H * (.08 + i * .13); c.save(); c.globalAlpha = .2 * fin; c.drawImage(img, x - s, y - s * .4, s * 2, s * .8); c.restore(); }
    const b = ss(2.6, 3.2, t) * fin; if (b > 0) { raysFx(c, cx, cy, m * .1, m * .9, t, P('255,214,120'), .22 * b); glow(c, cx, cy, m * .45, P('255,200,90'), .4 * b); }
    const im = artOf(own.creature, 'rong-bay'); if (im) { const wide = Math.max(W * 1.05, 700), w = own.creature ? Math.min(wide, H * .85 * im.naturalWidth / im.naturalHeight) : wide, h = w * im.naturalHeight / im.naturalWidth, k = easeInOut(clamp(t / 6.4)), x = lerp(W + 40, -w - 40, k), y = cy - h * .55 + Math.sin(t * 1.2) * m * .03;
      c.save(); c.globalAlpha = fin; (own.creature ? drawWarpSoft : drawWarp)(c, im, x, y, w, h, t, { flip: true, amp: h * .05, waves: 1.3, speed: 2.4 }); c.restore(); }
    if (t > 2.9 && t < 3.5) glow(c, cx, cy, m * .7, P('255,240,200'), (1 - (t - 2.9) / .6) * .55);
    motes(c, 26, 12, t, [0, H * .2, W, H * .8], P('255,214,120'), 2, .9, .9 * fin);
  }

  if (id === 'phuong-hoang') { dim(P('18,4,2'), .64);
    const fw = env(t, .2, .8, D - 1, D);
    { const hb = m * .22 * fw, gb = c.createLinearGradient(0, H, 0, H - hb); gb.addColorStop(0, `rgba(${P('255,170,60')},${.55 * fw})`); gb.addColorStop(.45, `rgba(${P('230,70,20')},${.25 * fw})`); gb.addColorStop(1, `rgba(${P('160,20,10')},0)`); c.fillStyle = gb; c.fillRect(-W * .1, H - hb, W * 1.2, hb + 40);
      for (let i = 0; i < 22; i++) { const x = (i / 21) * W + Math.sin(t * .8 + i) * 20, hh = m * (.08 + .07 * (.5 + .5 * wob(t * 1.6, i))) * fw; glow(c, x, H - hh * .3, hh, i % 2 ? P('255,140,40') : P('255,90,30'), .28 * fw); } }
    const b = ss(2.3, 2.9, t) * fin; if (b > 0) { raysFx(c, cx, cy, m * .1, m * .9, t, P('255,160,70'), .24 * b); }
    glow(c, cx, cy, m * .55, P('255,110,40'), .35 * fin);
    const im = artOf(own.creature, 'phuong-xoe'); if (im) { const h = Math.min(m * .9, H * .78), w = h * im.naturalWidth / im.naturalHeight, k = easeOut(clamp(t / 2.4)), top = H * .13 + 6, py = lerp(-h * .7, Math.max(top + h / 2, cy - h * .12), k), flap = (1 - ss(2, 3, t)) * Math.sin(t * 5) * .08 + Math.sin(t * .9) * .02;
      c.save(); c.globalAlpha = fin; c.translate(cx, py); c.scale(1 + flap, 1 - flap * .35); c.drawImage(im, -w / 2, -h / 2, w, h); c.restore(); }
    const sw = t - 2.4; if (sw > 0 && sw < 1.1) { c.strokeStyle = `rgba(${P('255,170,70')},${(1 - sw / 1.1) * .8})`; c.lineWidth = 5; c.beginPath(); c.ellipse(cx, cy, sw * m, sw * m * .45, 0, 0, TAU); c.stroke(); }
    motes(c, 60, 21, t, [0, H * .3, W, H * .7], P('255,150,50'), 2, 1.1, fin);
    S.shake = tt => (tt > 2.4 && tt < 3) ? 7 * Math.pow(1 - (tt - 2.4) / .6, 2) : 0;
  }
}

/* one moment of an entrance on a small canvas, for the admin grid. Same drawing as the real thing, without the portrait */
function paintStageThumb(cv, id, seconds) {
  const [D, rv] = timingOf(id), t = seconds % D, W = cv.width, H = cv.height, c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
  drawStage(c, { id }, stageOf(id), t, { W, H, cx: W / 2, cy: H / 2, m: Math.min(W, H), D, rv });
}

export { closeStage, openStage, paintStageThumb, stageOpen };
