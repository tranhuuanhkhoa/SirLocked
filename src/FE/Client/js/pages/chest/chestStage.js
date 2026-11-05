import { AU } from './chestAudio.js';

/*
 * The canvas of Mở hòm, moved from the approved mock-up (hom-niem-phong.html): the room, the key flight,
 * the three opening mechanisms, the reel and the reveal. Two things differ. The stage knows nothing about
 * the result until resolve() delivers the server's item: the reel spins at full speed until then and only
 * starts to brake afterwards. And everything it starts (frame loop, observers, timers, sound) ends in dispose().
 */

/** Items between the moment the reel starts braking and the winner: 47, as in the mock-up's strip. */
const STOP_DISTANCE = 47;
const ABORT_SECONDS = 1.1;

const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const E = { out: t => 1 - Math.pow(1 - t, 3), inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  back: t => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }, spin: t => 1 - Math.pow(1 - t, 3) };
const seg = (t, a, b) => clamp((t - a) / (b - a));
const now = () => performance.now() / 1000;

/**
 * @param {object} options
 * @param {HTMLElement} options.app the positioned root the canvas fills
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.spot the free area the chest and reel are centred in
 * @param {HTMLElement} options.keyIcon where the key starts its flight from
 * @param {object} options.chest the first chest to show: chestLook() plus its items
 * @param {object} options.rarities prototype rarity id → { color, name }
 * @param {() => object} options.filler one cosmetic item for the reel (never the result)
 * @param {(mode: string) => void} options.onMode
 * @param {(item: object) => void} options.onReveal
 */
export function createChestStage({ app, canvas: cv, spot, keyIcon, chest, rarities: R, filler, onMode, onReveal }) {
  const ctx = cv.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  let cur = chest;
  let W = 0, H = 0, DPR = 1, L = {};
  let raf = 0, disposed = false;

  // Offsets, not getBoundingClientRect: the route's lens transition scales the page while it mounts.
  function layout() {
    DPR = Math.min(3, window.devicePixelRatio || 1);
    W = app.clientWidth; H = app.clientHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    const sx = spot.offsetLeft, sy0 = spot.offsetTop, sw = spot.offsetWidth, sh = spot.offsetHeight;
    let S = Math.min(sw * 0.78 / 48, sh * 0.8 / 43, 9);
    S = S >= 4 ? Math.floor(S) : Math.max(1.5, Math.floor(S * 2) / 2);
    const cx = sx + sw / 2, sy = sy0 + sh / 2 - 2 * S;
    const ch = Math.max(140, Math.min(sh * 0.66, 300, W * 0.62)), cw = ch * 0.78;
    L = { S, cx, sy, portrait: W / H < 1, floor: sy + 23 * S, reelY: sy0 + sh / 2, card: { w: cw, h: ch, gap: Math.round(cw * 0.06) } };
    initMotes();
  }
  const motes = [];
  function initMotes() { motes.length = 0; for (let i = 0; i < 22; i++) motes.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.6, v: 0.006 + Math.random() * 0.018, ph: Math.random() * 6.28 }); }
  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(app);
  resizeObserver.observe(spot);

  /* particles */
  const parts = [];
  function burst(x, y, n, colors, opt = {}) {
    for (let i = 0; i < n; i++) {
      const a = (opt.a0 ?? 0) + (opt.spread ?? Math.PI * 2) * Math.random(), sp = (opt.sp ?? 260) * (0.35 + Math.random() * 0.8);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: opt.g ?? 520, life: 0, max: (opt.life ?? 1.1) * (0.6 + Math.random() * 0.6),
        s: (opt.size ?? 4) * (0.6 + Math.random() * 0.8), c: colors[i % colors.length], kind: opt.kind ?? 'sq', rot: Math.random() * 6, vr: (Math.random() - .5) * 10 });
    }
  }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life += dt; if (p.life > p.max) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt; p.vx *= 1 - 0.9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
  }
  function drawParts() {
    for (const p of parts) {
      const a = 1 - p.life / p.max; ctx.globalAlpha = a;
      if (p.kind === 'spark') { ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = p.c; ctx.lineWidth = p.s * 0.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; }
      else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
  }

  /* drawing helpers */
  function blit(sp, x, y, s) {
    if (!sp.smooth) { ctx.drawImage(sp.c, x, y, sp.w * s, sp.h * s); return; }
    // Cosmetics are painted, not pixel art.
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(sp.c, x, y, sp.w * s, sp.h * s); ctx.restore();
  }
  const buf = document.createElement('canvas'), bx = buf.getContext('2d');
  function drawClosedChest(x0, y0, S, shine, c = cur, alpha = 1) {
    // composited off-screen so the glint only touches the chest itself
    const bw = Math.ceil(50 * S * DPR), bh = Math.ceil(43 * S * DPR);
    if (buf.width !== bw || buf.height !== bh) { buf.width = bw; buf.height = bh; }
    bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, bw, bh); bx.imageSmoothingEnabled = false;
    const s = S * DPR;
    const P = c.sp;
    if (c.mech === 'door') { bx.drawImage(P.frame.c, 0, 0, P.frame.w * s, P.frame.h * s); bx.drawImage(P.door.c, 6 * s, 5 * s, P.door.w * s, P.door.h * s); }
    else { bx.drawImage(P.lid.c, 0, 0, P.lid.w * s, P.lid.h * s); bx.drawImage(P.body.c, 0, 18 * s, P.body.w * s, P.body.h * s); }
    if (shine > 0 && shine < 1) {
      bx.globalCompositeOperation = 'source-atop';
      const gx = lerp(-0.4, 1.4, shine) * bw;
      const gr = bx.createLinearGradient(gx - bw * 0.18, 0, gx + bw * 0.18, bh);
      gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, 'rgba(255,240,200,0.42)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
      bx.fillStyle = gr; bx.fillRect(0, 0, bw, bh); bx.globalCompositeOperation = 'source-over';
    }
    ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(buf, x0, y0, bw / DPR, bh / DPR); ctx.restore();
  }
  function drawKey(tipX, tipY, ang, s, squash = 1, alpha = 1) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(tipX, tipY); ctx.rotate(ang); ctx.scale(1, squash);
    blit(cur.sp.key, -39.5 * s, -9.5 * s, s); ctx.restore();
  }
  function keyTipFromCenter(cx, cy, ang, s) { const d = (39.5 - 21) * s; return [cx + Math.cos(ang) * d, cy + Math.sin(ang) * d]; }

  function drawRoom(t, dim) {
    const { cx, sy, S, floor } = L;
    ctx.fillStyle = '#090B10'; ctx.fillRect(0, 0, W, H);
    const flick = 0.94 + 0.06 * Math.sin(t * 6.1) * Math.sin(t * 1.7);
    let g = ctx.createRadialGradient(cx, sy, 0, cx, sy, Math.max(W, H) * 0.62);
    g.addColorStop(0, `rgba(${cur.light},${0.12 * flick})`); g.addColorStop(0.4, 'rgba(70,52,36,0.10)'); g.addColorStop(1, 'rgba(9,11,16,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    g = ctx.createRadialGradient(cx, floor, 2, cx, floor, 44 * S); g.addColorStop(0, `rgba(${cur.light},${0.16 * flick})`); g.addColorStop(1, `rgba(${cur.light},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, floor, 44 * S, 7 * S, 0, 0, Math.PI * 2); ctx.fill();
    for (const m of motes) {
      if (!reduce.matches) { m.y -= m.v * 0.012; if (m.y < 0) { m.y = 1; m.x = Math.random(); } }
      const xx = cx + (m.x * 2 - 1) * 34 * S + Math.sin(t * 0.5 + m.ph) * 5, yy = floor - m.y * 60 * S;
      ctx.fillStyle = `rgba(255,226,170,${(0.1 + 0.18 * Math.sin(t * 1.5 + m.ph) ** 2) * m.y})`; ctx.fillRect(xx, yy, m.s, m.s);
    }
    ctx.restore();
    if (dim > 0) { ctx.fillStyle = `rgba(6,7,10,${dim})`; ctx.fillRect(0, 0, W, H); }
  }
  function vignette() {
    const g = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  /* ================= state machine ================= */
  const st = { mode: 'idle', t0: 0, item: null, strip: [], winIdx: 0, lastIdx: -1, lastTick: 0, flash: 0, revealed: false, sealBroken: false, spinT: 6.4, switchDir: 1, switchAt: 0, stop: null, skipped: false, afterAbort: null };
  function setMode(m) { st.mode = m; st.t0 = now(); app.dataset.mode = m; delete app.dataset.revealed; onMode(m); }

  /** Starts the sequence. The result is unknown yet; resolve() or abort() ends it. */
  function start() {
    if (st.mode !== 'idle') return false;
    AU.init();
    st.item = null; st.stop = null; st.skipped = false; st.afterAbort = null;
    st.sealBroken = false; st.flash = 0; st.revealed = false; st.sounds = {};
    st.keyStart = keyFromButton();
    st.strip = [];
    st.landing = (Math.random() * 0.76 - 0.38);
    setMode('open');
    return true;
  }
  /** The server's answer. The reel starts to brake on its next frame and lands on exactly this item. */
  function resolve(item) { st.item = item; }
  /** The server said no: back to the closed chest without a jolt, then `done`. */
  function abort(done) {
    st.afterAbort = done;
    if (st.mode !== 'spin') { finishAbort(); return; }
    const t = now() - st.t0, G = reelGeom(), u = reelUnits(t, G), v = cardsPerSecond();
    st.stop = { t0: t, T: ABORT_SECONDS, u0: u, u1: () => u + v * ABORT_SECONDS / 3, abort: true };
  }
  function finishAbort() {
    st.item = null; st.stop = null; st.flash = 0; st.sealBroken = false; parts.length = 0;
    st.switchFrom = null; st.switchAt = now();
    setMode('idle');
    const done = st.afterAbort; st.afterAbort = null;
    done?.();
  }
  function toIdle() { if (st.mode !== 'reveal' || !st.item) return false; st.item = null; setMode('idle'); return true; }

  const cardsPerSecond = () => 3 * STOP_DISTANCE / st.spinT;
  function ensureStrip(length) { while (st.strip.length < length) st.strip.push(filler()); }
  function startSpin() { setMode('spin'); st.spinT = reduce.matches ? 1.6 : 5.6; st.stop = null; st.lastIdx = -1; AU.whoosh(); }
  /** Reel position in cards: constant speed while the result is unknown, cubic braking (same speed at the seam) after. */
  function reelUnits(t, G) {
    if (!st.stop) return cardsPerSecond() * t;
    return lerp(st.stop.u0, st.stop.u1(G), E.spin(clamp((t - st.stop.t0) / st.stop.T)));
  }
  function beginStop(t, G) {
    const u = reelUnits(t, G), win = Math.round(u) + 3 + STOP_DISTANCE;
    // Far beyond the visible cards, so the reel never shows a card changing.
    ensureStrip(win + 8);
    st.winIdx = win; st.strip[win] = st.item;
    // a near-miss right after the winner keeps the tension honest-looking
    if (st.item.r !== 'gold' && Math.random() < 0.5) st.strip[win + 1] = cur.items.find(i => i.r === (Math.random() < .5 ? 'gold' : 'leg')) ?? st.strip[win + 1];
    const u1 = (geom) => geom.posOf(win, st.landing) / geom.P;
    const T = 3 * (u1(G) - u) / cardsPerSecond();
    st.stop = { t0: st.skipped ? t - Math.max(0, T - 0.5) : t, T, u0: u, u1 };
  }
  function finishSpin() { setMode('reveal'); st.revealed = false; }
  function skip() {
    if (st.mode === 'open') { st.skipped = true; startSpin(); }
    else if (st.mode === 'spin') {
      st.skipped = true;
      if (st.stop && !st.stop.abort) { const left = st.stop.t0 + st.stop.T - (now() - st.t0); if (left > 0.5) st.stop.t0 -= left - 0.5; }
    }
  }

  /* ---------- opening sequence ---------- */
  function drawOpen(t) {
    const { S, cx, sy } = L, rm = reduce.matches;
    const T = rm ? { fly: [0, .01], ins: [0, .01], turn: [0, .01], brk: [0, .2], lid: [.2, .7], glow: [.3, 1.1], end: 1.2 }
                 : { fly: [0, .85], ins: [.85, 1.05], turn: [1.05, 1.45], brk: [1.45, 1.95], lid: [1.95, 2.9], glow: [2.1, 3.3], end: 3.45 };
    const once = (k, at, fn) => { if (t >= at && !st.sounds[k]) { st.sounds[k] = 1; fn(); } };
    const gx = v => cx - 24 * S + (v + 0.5) * S, gy = v => sy - 18 * S + (v + 0.3) * S;
    const holeX = gx(cur.hole[0]), holeY = gy(cur.hole[1]), door = cur.mech === 'door';
    // shake
    const shk = rm ? 0 : seg(t, T.brk[0], T.brk[1]) > 0 && t < T.lid[0] + 0.2 ? Math.sin(t * 70) * S * 0.55 * (1 - seg(t, T.brk[0], T.lid[0] + 0.2)) : 0;
    const lidA = E.back(seg(t, T.lid[0], T.lid[1]));
    const glowA = seg(t, T.lid[0] + 0.1, T.glow[1]);

    drawRoom(t + st.t0, seg(t, T.glow[0], T.end) * 0.55);
    // floor shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(cx, L.floor + S * 0.5, 27 * S, 2.4 * S, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save(); ctx.translate(shk, 0);
    if (door) {
      // safe: frame and its lit interior, then the door swings on its left hinge
      blit(cur.sp.frame, cx - 25 * S, sy - 19 * S, S);
      if (glowA > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const ig = ctx.createRadialGradient(cx, sy, 2, cx, sy, 22 * S); ig.addColorStop(0, `rgba(${cur.core},${0.55 * glowA})`); ig.addColorStop(1, `rgba(${cur.light},0)`); ctx.fillStyle = ig; ctx.fillRect(cx - 18 * S, sy - 13 * S, 36 * S, 28 * S); ctx.restore(); }
      const c = Math.cos(clamp(lidA, 0, 1.08) * Math.PI * 0.62), hx = cx - 18 * S;
      ctx.save(); ctx.translate(hx, 0); ctx.scale(c >= 0 ? Math.max(0.001, c) : c, 1);
      blit(c >= 0 ? cur.sp.door : cur.sp.doorBack, -S, sy - 14 * S, S); ctx.restore();
    } else if (lidA < 0.5) {
      ctx.save(); ctx.translate(cx - 25 * S, sy); ctx.scale(1, Math.max(0.001, Math.cos(lidA * Math.PI))); blit(cur.sp.lid, 0, -19 * S, S); ctx.restore();
    } else {
      const u = Math.sin(clamp((lidA - 0.5) * 2, 0, 1.1) * Math.PI / 2) * 0.92;
      ctx.save(); ctx.translate(cx - 25 * S, sy); ctx.scale(1, Math.max(0.001, u)); blit(cur.sp.under, 0, -15 * S, S); ctx.restore();
    }
    // light from inside
    if (glowA > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const rays = 13, len = Math.max(W, H) * 0.9, base = t * 0.25;
      for (let i = 0; i < rays; i++) {
        const a = -Math.PI + (i + 0.5) / rays * Math.PI + Math.sin(base + i) * 0.04, wd = 0.045 + 0.03 * Math.sin(t * 2 + i * 1.7);
        const g = ctx.createLinearGradient(cx, sy, cx + Math.cos(a) * len, sy + Math.sin(a) * len);
        g.addColorStop(0, `rgba(${cur.hi},${0.28 * glowA})`); g.addColorStop(1, `rgba(${cur.hi},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, sy); ctx.lineTo(cx + Math.cos(a - wd) * len, sy + Math.sin(a - wd) * len); ctx.lineTo(cx + Math.cos(a + wd) * len, sy + Math.sin(a + wd) * len); ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, sy, 2, cx, sy, 34 * S); g.addColorStop(0, `rgba(${cur.core},${0.9 * glowA})`); g.addColorStop(0.35, `rgba(${cur.light},${0.35 * glowA})`); g.addColorStop(1, `rgba(${cur.light},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, sy, 34 * S, 20 * S, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // body
    if (!door) blit(st.sealBroken ? cur.sp.bodyBare : cur.sp.body, cx - 25 * S, sy - S, S);
    if (glowA > 0 && !door) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(${cur.core},${0.85 * glowA})`; ctx.fillRect(cx - 20 * S, sy - S * 0.6, 40 * S, S * 0.9); ctx.restore(); }
    ctx.restore();

    // key flight -> insert -> turn
    if (!rm && t < T.brk[1]) {
      const k0 = st.keyStart, p = E.inOut(seg(t, T.fly[0], T.fly[1]));
      const s = lerp(k0.s, S * 0.5, p), ang = lerp(k0.ang, Math.PI / 2, E.out(seg(t, T.fly[0] + 0.1, T.fly[1])));
      const approachY = holeY - 3 * S, ctrl = [lerp(k0.tip[0], holeX, 0.5), Math.min(k0.tip[1], approachY) - 22 * S];
      const tx = (1 - p) ** 2 * k0.tip[0] + 2 * (1 - p) * p * ctrl[0] + p * p * holeX;
      let ty = (1 - p) ** 2 * k0.tip[1] + 2 * (1 - p) * p * ctrl[1] + p * p * approachY;
      ty += E.inOut(seg(t, T.ins[0], T.ins[1])) * 5.5 * S;
      const sq = 1 - 0.82 * E.inOut(seg(t, T.turn[0], T.turn[1]));
      const fade = 1 - seg(t, T.brk[0] + 0.15, T.brk[1]);
      once('scrape', T.ins[0], () => AU.scrape());
      once('clack', T.turn[1] - 0.06, () => { AU.clack(); burst(holeX, holeY, 10, ['#FFE58F', '#F0A43A'], { kind: 'spark', sp: 240, g: 0, life: 0.45, size: 4 }); });
      ctx.save();
      if (t >= T.ins[0] - 0.02) { ctx.beginPath(); ctx.rect(0, 0, W, holeY + 0.4 * S); ctx.clip(); }
      drawKey(tx + shk, ty, ang, s, sq, fade);
      ctx.restore();
    }
    once('break', T.brk[0], () => {
      st.sealBroken = true;
      if (door) { AU.clack(); later(() => AU.clack(), 160); later(() => AU.clack(), 320); burst(gx(cur.brk[0]), gy(cur.brk[1]), rm ? 6 : 18, cur.shards, { kind: 'spark', sp: 260, g: 0, life: 0.6, size: 4 }); }
      else { AU.crack(); burst(gx(cur.brk[0]), gy(cur.brk[1]), rm ? 6 : 22, cur.shards, { sp: 300, g: 900, life: 1.2, size: S * 0.9, a0: -Math.PI, spread: Math.PI }); }
    });
    once('creak', T.lid[0], () => { AU.creak(); if (door) AU.land(); });
    once('shimmer', T.lid[0] + 0.35, () => { AU.shimmer(); if (!rm) burst(cx, door ? sy + 4 * S : sy, 40, [`rgb(${cur.hi})`, `rgb(${cur.core})`, '#FFFFFF'], { kind: 'spark', sp: 520, g: -60, life: 1.3, size: 5, a0: -Math.PI, spread: Math.PI }); });
    // amber-white flash that carries us into the reel
    if (!rm) { const f = seg(t, T.glow[1] - 0.2, T.end); ctx.fillStyle = `rgba(${cur.core},${f * 0.92})`; ctx.fillRect(0, 0, W, H); }
    if (t >= T.end) { st.flash = rm ? 0 : 1; startSpin(); }
  }
  function keyFromButton() {
    const ar = app.getBoundingClientRect(), r = keyIcon.getBoundingClientRect(), s = r.width / cur.sp.key.w;
    const cx = r.left - ar.left + r.width / 2, cy = r.top - ar.top + r.height / 2;
    return { s, ang: 0, tip: keyTipFromCenter(cx, cy, 0, s) };
  }
  function drawIdle(t) {
    const { S, cx, sy } = L, rm = reduce.matches;
    drawRoom(t, 0);
    const bob = rm ? 0 : Math.round(Math.sin(t * 1.5) * S * 0.6 * 2) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(cx, L.floor + S * 0.5, (26 - bob / S) * S, 2.2 * S, 0, 0, Math.PI * 2); ctx.fill();
    const sw = st.switchAt ? clamp((t - st.switchAt) / 0.42) : 1, e = E.out(sw), off = (1 - e) * Math.min(W * 0.3, 60 * S) * st.switchDir;
    if (sw < 1 && st.switchFrom) drawClosedChest(cx - 25 * S - e * Math.min(W * 0.3, 60 * S) * st.switchDir, sy - 19 * S + bob, S, 0, st.switchFrom, 1 - e);
    drawClosedChest(cx - 25 * S + off, sy - 19 * S + bob, S, rm || sw < 1 ? 0 : (t % 4.6) / 0.9, cur, e);
  }

  /* ---------- reel ---------- */
  function reelGeom() {
    const { w, h, gap } = L.card, P = w + gap, needle = L.cx, base = L.cx - w / 2 - 3 * P;
    const posOf = (i, off) => base + i * P + w / 2 - needle - off * w;
    return { w, h, gap, P, needle, base, y: L.reelY - h / 2, posOf };
  }
  function drawCard(it, x, y, w, h, opt = {}) {
    const r = R[it.r], a = opt.alpha ?? 1, blur = opt.blur ?? 0;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = '#151922'; ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(0, y + h * 0.42, 0, y + h); g.addColorStop(0, r.color + '00'); g.addColorStop(1, r.color + (opt.win ? '70' : '48'));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = opt.win ? r.color : 'rgba(228,219,198,0.14)'; ctx.lineWidth = opt.win ? 2.5 : 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
    ctx.fillStyle = r.color; ctx.fillRect(x + 1, y + h - Math.max(4, h * 0.03), w - 2, Math.max(4, h * 0.03) - 1);
    ctx.fillRect(x + w - 14, y + 11, 6, 6);
    const fs = Math.max(9, Math.round(h * 0.048));
    const textA = clamp(1 - blur / 26, 0.12, 1);
    ctx.globalAlpha = a * textA; ctx.font = `400 ${fs}px "IBM Plex Mono", monospace`; ctx.fillStyle = '#8E9AAE'; ctx.textAlign = 'left'; ctx.fillText(it.id, x + 10, y + 10 + fs * 0.8);
    // pixel icon, smeared by speed
    const is = Math.max(2, Math.floor(w * 0.6 / it.sp.w)), iw = it.sp.w * is, ix = Math.round(x + (w - iw) / 2), iy = Math.round(y + h * 0.4 - iw / 2);
    ctx.globalAlpha = a;
    if (blur > 1) { const n = Math.min(6, Math.ceil(blur / 6)); for (let k = n; k >= 1; k--) { ctx.globalAlpha = a * 0.22; blit(it.sp, ix + (k / n) * blur, iy, is); } ctx.globalAlpha = a * 0.75; }
    blit(it.sp, ix, iy, is);
    ctx.globalAlpha = a * textA; ctx.textAlign = 'center';
    ctx.font = `600 ${Math.max(11, Math.round(h * 0.075))}px Jura, sans-serif`; ctx.fillStyle = '#E4DBC6'; ctx.fillText(it.name, x + w / 2, y + h * 0.79, w - 12);
    ctx.font = `600 ${Math.max(9, Math.round(h * 0.045))}px "IBM Plex Mono", monospace`; ctx.fillStyle = r.color;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px'; ctx.fillText(r.name.toUpperCase(), x + w / 2, y + h * 0.88, w - 12); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
  }
  function drawBand(G) {
    const pad = G.h * 0.09, y0 = G.y - pad, y1 = G.y + G.h + pad;
    ctx.fillStyle = 'rgba(12,14,20,0.96)'; ctx.fillRect(0, y0, W, y1 - y0);
    ctx.fillStyle = 'rgba(228,219,198,0.30)'; ctx.fillRect(0, y0, W, 1); ctx.fillRect(0, y1 - 1, W, 1);
    ctx.fillStyle = 'rgba(228,219,198,0.16)';
    for (let x = (W / 2) % 14; x < W; x += 14) { ctx.fillRect(Math.round(x), y0, 1, 6); ctx.fillRect(Math.round(x), y1 - 6, 1, 6); }
    return { y0, y1 };
  }
  function drawEdgeFades(y0, y1) {
    const fw = Math.min(W * 0.22, 260);
    let g = ctx.createLinearGradient(0, 0, fw, 0); g.addColorStop(0, 'rgba(12,14,20,1)'); g.addColorStop(1, 'rgba(12,14,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, y0 + 1, fw, y1 - y0 - 2);
    g = ctx.createLinearGradient(W, 0, W - fw, 0); g.addColorStop(0, 'rgba(12,14,20,1)'); g.addColorStop(1, 'rgba(12,14,20,0)'); ctx.fillStyle = g; ctx.fillRect(W - fw, y0 + 1, fw, y1 - y0 - 2);
  }
  function drawNeedle(y0, y1, a = 1) {
    const x = L.cx; ctx.save(); ctx.globalAlpha = a;
    ctx.shadowColor = 'rgba(240,164,58,0.9)'; ctx.shadowBlur = 14; ctx.fillStyle = '#F0A43A';
    ctx.fillRect(x - 1.5, y0 - 14, 3, y1 - y0 + 28);
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(x - 11, y0 - 26); ctx.lineTo(x + 11, y0 - 26); ctx.lineTo(x, y0 - 10); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 11, y1 + 26); ctx.lineTo(x + 11, y1 + 26); ctx.lineTo(x, y1 + 10); ctx.fill();
    ctx.restore();
  }
  function drawSpin(t) {
    const G = reelGeom();
    if (st.item && !st.stop) beginStop(t, G);
    const pos = reelUnits(t, G) * G.P, speed = Math.abs(pos - reelUnits(Math.max(0, t - 1 / 60), G) * G.P) * 60;
    drawRoom(t + st.t0, 0.72);
    // the open chest glowing faintly behind the reel
    ctx.save(); ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(L.cx, L.reelY, 10, L.cx, L.reelY, Math.max(W, H) * 0.6); g.addColorStop(0, 'rgba(240,164,58,0.35)'); g.addColorStop(1, 'rgba(240,164,58,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    const { y0, y1 } = drawBand(G);
    const first = Math.max(0, Math.floor((pos - G.base) / G.P) - 2), last = first + Math.ceil(W / G.P) + 8;
    ensureStrip(last);
    for (let i = first; i < last; i++) {
      const x = G.base + i * G.P - pos; if (x > W || x + G.w < 0) continue;
      drawCard(st.strip[i], x, G.y, G.w, G.h, { blur: Math.min(40, speed / 60) });
    }
    drawEdgeFades(y0, y1);
    drawNeedle(y0, y1);
    // tick each time a card edge passes the needle
    const idx = Math.floor((pos + G.needle - G.base + G.gap / 2) / G.P);
    if (idx !== st.lastIdx) { if (st.lastIdx !== -1) { const n = now(); if (n - st.lastTick > 0.028) { AU.tick(speed / 3000); st.lastTick = n; } } st.lastIdx = idx; }
    if (st.flash > 0) { ctx.fillStyle = `rgba(${cur.core},${st.flash * st.flash * 0.8})`; ctx.fillRect(0, 0, W, H); st.flash = Math.max(0, st.flash - 0.07); }
    if (st.stop && t >= st.stop.t0 + st.stop.T) {
      if (st.stop.abort) finishAbort();
      else { AU.land(); finishSpin(); }
    }
  }
  function drawReveal(t) {
    const G = reelGeom(), r = R[st.item.r], rm = reduce.matches;
    const pos = G.posOf(st.winIdx, st.landing);
    const k = rm ? 1 : E.out(seg(t, 0.15, 0.95));
    drawRoom(t + st.t0, 0.78);
    ctx.save(); ctx.globalAlpha = 1 - k; const { y0, y1 } = drawBand(G); ctx.restore();
    // rays in the rarity colour
    if (k > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const cx = L.cx, cy = L.reelY, len = Math.max(W, H) * 0.8;
      const n = st.item.r === 'gold' ? 18 : 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (rm ? 0 : t * 0.22), wd = 0.07;
        const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.addColorStop(0, r.color + '55'); g.addColorStop(1, r.color + '00');
        ctx.globalAlpha = k; ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a - wd) * len, cy + Math.sin(a - wd) * len); ctx.lineTo(cx + Math.cos(a + wd) * len, cy + Math.sin(a + wd) * len); ctx.fill();
      }
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, G.h * 0.95); g.addColorStop(0, r.color + '66'); g.addColorStop(1, r.color + '00'); ctx.globalAlpha = k; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    for (let i = st.winIdx - 4; i <= st.winIdx + 4; i++) {
      if (i === st.winIdx || i < 0 || i >= st.strip.length) continue;
      const x = G.base + i * G.P - pos; drawCard(st.strip[i], x, G.y, G.w, G.h, { alpha: 1 - 0.9 * k });
    }
    ctx.save(); ctx.globalAlpha = 1 - k; drawEdgeFades(y0, y1); ctx.restore();
    drawNeedle(y0, y1, 1 - k);
    // winner lifts to the centre
    const x0 = G.base + st.winIdx * G.P - pos, sc = lerp(1, 1.14, k), w = G.w * sc, h = G.h * sc;
    const x = lerp(x0, L.cx - G.w / 2, k) - (w - G.w) / 2, y = G.y - (h - G.h) / 2;
    if (k > 0) { ctx.save(); ctx.shadowColor = r.color; ctx.shadowBlur = 40 * k; ctx.fillStyle = '#151922'; ctx.fillRect(x, y, w, h); ctx.restore(); }
    drawCard(st.item, x, y, w, h, { win: true });
    if (!st.revealed && t >= (rm ? 0 : 0.15)) {
      st.revealed = true;
      const counts = { common: 14, rare: 26, myth: 40, leg: 70, gold: 110 }, n = rm ? 0 : counts[st.item.r];
      const cols = st.item.r === 'gold' ? ['#E8B53A', '#FFE58F', '#FFFFFF', '#F4D27C'] : [r.color, '#E4DBC6'];
      burst(L.cx, L.reelY, n, cols, { sp: 520, g: 380, life: 1.6, size: Math.max(4, L.S * 0.9) });
      if (st.item.r === 'leg' || st.item.r === 'gold') burst(L.cx, L.reelY, n / 2, cols, { kind: 'spark', sp: 700, g: 0, life: 0.9, size: 6 });
      AU.sting(st.item.r);
      app.dataset.revealed = '';
      onReveal(st.item);
    }
  }

  /* ================= loop ================= */
  let last = now();
  function frame() {
    if (disposed) return;
    const n = now(), dt = Math.min(0.05, n - last); last = n;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.imageSmoothingEnabled = false;
    const t = n - st.t0;
    // keep the loop alive whatever happens in one frame, and never let a stage hang
    try {
      if (st.mode === 'idle') drawIdle(n);
      else if (st.mode === 'open') { drawOpen(t); if (st.mode === 'open' && t > 6) startSpin(); }
      else if (st.mode === 'spin') { drawSpin(t); if (st.mode === 'spin' && st.stop && t > st.stop.t0 + st.stop.T + 1) { if (st.stop.abort) finishAbort(); else finishSpin(); } }
      else drawReveal(t);
      stepParts(dt); drawParts(); vignette();
    } catch (err) {
      console.error(err);
      if (st.mode === 'open') startSpin();
      else if (st.mode === 'spin' && st.stop) { if (st.stop.abort) finishAbort(); else finishSpin(); }
      else if (st.mode === 'reveal' && !('revealed' in app.dataset)) { app.dataset.revealed = ''; onReveal(st.item); }
    }
    raf = requestAnimationFrame(frame);
  }

  setMode('idle');
  layout();
  raf = requestAnimationFrame(frame);

  return {
    mode: () => st.mode,
    start,
    resolve,
    abort,
    skip,
    toIdle,
    relayout: () => requestAnimationFrame(() => { if (!disposed) layout(); }),
    /** The same chest with fresh numbers or colours: nothing moves. */
    setChest(next) {
      cur = next;
    },
    /** Slides `chest` in; `from` slides out towards the opposite side of `dir`. */
    showChest(next, from, dir) {
      st.switchFrom = from; st.switchDir = dir; st.switchAt = now();
      cur = next;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      timers.forEach(clearTimeout);
      timers.clear();
      AU.close();
    },
  };
}
