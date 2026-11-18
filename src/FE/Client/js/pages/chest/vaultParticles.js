/*
 * The drifting particles behind the chest in Mở hòm, from the approved design kho-ruong-sirlocked.html:
 * dust for the sealed case, glints for the bank safe, petals for the lacquer box.
 * Runs only while the canvas is on screen and the tab is visible; dispose() ends everything it started.
 */
export function createVaultParticles(canvas, { reduce }) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, ps = [], mode = 'dust', raf = 0, visible = true, last = 0, disposed = false;

  function make(anywhere) {
    const p = {
      x: Math.random() * w, y: anywhere ? Math.random() * h : (mode === 'petals' ? -20 : h + 10),
      s: 1 + Math.random() * 2.2, a: Math.random() * Math.PI * 2, v: 0.2 + Math.random() * 0.6, t: Math.random() * 6,
    };
    if (mode === 'petals') { p.s = 5 + Math.random() * 6; p.v = 0.5 + Math.random() * 0.8; p.r = Math.random() * 6; }
    if (mode === 'coins') { p.v = 0; p.life = 2 + Math.random() * 3; p.t = Math.random() * p.life; }
    return p;
  }
  function seed() {
    const n = mode === 'petals' ? 26 : mode === 'coins' ? 40 : 60;
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
    theme(next) {
      if (next === mode) return;
      mode = next;
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
