/*
 * The drifting particles behind the chest in Mở hòm, from the approved design kho-ruong-sirlocked.html:
 * dust for the sealed case, glints for the bank safe, petals for the lacquer box, embers for the Whitechapel case.
 * A scene an admin made adds two: a picture (or a soft dot of its colour) that rises or falls, and nothing at all.
 * Runs only while the canvas is on screen and the tab is visible; dispose() ends everything it started.
 */
export function createVaultParticles(canvas, { reduce }) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, ps = [], mode = 'dust', raf = 0, visible = true, last = 0, disposed = false;
  // A scene's own particle: its picture once it has loaded, and its colour as "r,g,b" for the dots meanwhile.
  let spriteUrl = '', sprite = null, tint = '';

  function make(anywhere) {
    const p = {
      x: Math.random() * w, y: anywhere ? Math.random() * h : (mode === 'petals' || mode === 'fall' ? -20 : h + 10),
      s: 1 + Math.random() * 2.2, a: Math.random() * Math.PI * 2, v: 0.2 + Math.random() * 0.6, t: Math.random() * 6,
    };
    if (mode === 'petals') { p.s = 5 + Math.random() * 6; p.v = 0.5 + Math.random() * 0.8; p.r = Math.random() * 6; }
    if (mode === 'coins') { p.v = 0; p.life = 2 + Math.random() * 3; p.t = Math.random() * p.life; }
    if (mode === 'embers') { p.v = 0.6 + Math.random() * 0.9; p.s = 0.8 + Math.random() * 1.6; p.hot = Math.random() < 0.35; }
    if (mode === 'rise' || mode === 'fall') { p.v = 0.4 + Math.random() * 0.8; p.s = 6 + Math.random() * 8; p.r = Math.random() * 6; }
    return p;
  }
  function seed() {
    const n = mode === 'none' ? 0 : mode === 'rise' || mode === 'fall' ? 28 : mode === 'petals' ? 26 : mode === 'coins' ? 40 : mode === 'embers' ? 46 : 60;
    ps = [];
    for (let i = 0; i < n; i++) ps.push(make(true));
  }
  function size() {
    const r = canvas.getBoundingClientRect(), d = Math.min(1.5, devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.max(1, Math.round(w * d)); canvas.height = Math.max(1, Math.round(h * d));
    ctx.setTransform(d, 0, 0, d, 0, 0);
    seed();
  }
  function frame(t) {
    raf = 0;
    if (disposed) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016; last = t;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]; p.t += dt;
      if (mode === 'dust') {
        p.y -= p.v * 12 * dt; p.x += Math.sin(p.t * 0.7 + p.a) * 0.25;
        if (p.y < -10) ps[i] = make(false);
        ctx.fillStyle = `rgba(255, 214, 150,${(0.18 + 0.25 * Math.abs(Math.sin(p.t + p.a))).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 0.7, 0, 6.283); ctx.fill();
      } else if (mode === 'embers') {
        // Sparks from the gaslight: they rise, sway and fade, crimson with a few amber ones.
        p.y -= p.v * 22 * dt; p.x += Math.sin(p.t * 1.6 + p.a) * 0.45;
        if (p.y < -10) ps[i] = make(false);
        const glow = 0.25 + 0.55 * Math.abs(Math.sin(p.t * 2.2 + p.a));
        ctx.fillStyle = p.hot ? `rgba(255, 196, 110,${glow.toFixed(2)})` : `rgba(226, 70, 88,${(glow * 0.85).toFixed(2)})`;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.max(1, Math.round(p.s * 1.4)), Math.max(1, Math.round(p.s * 1.4)));
      } else if (mode === 'rise' || mode === 'fall') {
        const dir = mode === 'rise' ? -1 : 1;
        p.y += dir * p.v * 30 * dt; p.x += Math.sin(p.t * 1.1 + p.a) * 0.5; p.r += dt * 0.8;
        if ((dir < 0 && p.y < -30) || (dir > 0 && p.y > h + 30)) ps[i] = make(false);
        const alpha = 0.35 + 0.45 * Math.abs(Math.sin(p.t + p.a));
        if (sprite) {
          ctx.save(); ctx.globalAlpha = alpha; ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.r) * 0.4);
          ctx.drawImage(sprite, -p.s, -p.s, p.s * 2, p.s * 2); ctx.restore();
        } else {
          ctx.fillStyle = `rgba(${tint || '255, 214, 150'},${alpha.toFixed(2)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 0.25, 0, 6.283); ctx.fill();
        }
      } else if (mode === 'coins') {
        if (p.t > p.life) { ps[i] = make(true); continue; }
        const k = Math.sin(Math.PI * p.t / p.life), sz = p.s * 3 * k;
        ctx.strokeStyle = `rgba(240, 210, 130,${(0.7 * k).toFixed(2)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x - sz, p.y); ctx.lineTo(p.x + sz, p.y); ctx.moveTo(p.x, p.y - sz); ctx.lineTo(p.x, p.y + sz); ctx.stroke();
      } else {
        p.y += p.v * 40 * dt; p.x += Math.sin(p.t * 1.2 + p.a) * 0.6; p.r += dt * 1.5;
        if (p.y > h + 20) ps[i] = make(false);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, 0.55 + 0.45 * Math.sin(p.t * 2 + p.a));
        ctx.fillStyle = 'rgba(244, 170, 190, .55)'; ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.6, 0, 0, 6.283); ctx.fill(); ctx.restore();
      }
    }
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    const run = visible && !reduce() && !disposed;
    if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, w, h); }
  }

  const listeners = new AbortController();
  window.addEventListener('resize', size, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; sync(); }, { signal: listeners.signal });
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => { visible = entries[0].isIntersecting && !document.hidden; sync(); })
    : null;
  observer?.observe(canvas);
  size();
  sync();

  return {
    /** `next` is one of the modes above; `scene` gives a scene's own particle: { image, rgb }. */
    theme(next, scene = {}) {
      const image = scene.image || '';
      if (next === mode && image === spriteUrl && (scene.rgb || '') === tint) return;
      mode = next;
      tint = scene.rgb || '';
      if (image !== spriteUrl) {
        spriteUrl = image;
        sprite = null;
        if (image) {
          const picture = new Image();
          picture.onload = () => { if (spriteUrl === image) sprite = picture; };
          picture.src = image;
        }
      }
      seed();
    },
    dispose() {
      disposed = true;
      listeners.abort();
      observer?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
