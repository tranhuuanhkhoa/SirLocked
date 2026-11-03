/* Synthesised sound of Mở hòm, moved as it is from the approved mock-up (hom-niem-phong.html). */
const MUTE_KEY = 'sl-case-muted';
let muted = false; try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage unavailable */ }
export const AU = {
  ctx: null, out: null, noise: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.out = this.ctx.createGain(); this.out.gain.value = muted ? 0 : 0.7; this.out.connect(this.ctx.destination);
    const len = this.ctx.sampleRate; const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noise = b;
  },
  setMuted(m) { muted = m; try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) { /* storage unavailable */ } if (this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.02); },
  isMuted() { return muted; },
  close() { const c = this.ctx; this.ctx = null; this.out = null; this.noise = null; if (c) c.close().catch(() => {}); },
  ok() { return this.ctx && !muted; },
  env(node, t, a, peak, d) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); node.connect(g); g.connect(this.out); return g; },
  tone(type, f, t, a, peak, d, f2) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d); this.env(o, t, a, peak, d); o.start(t); o.stop(t + a + d + 0.05); },
  burst(t, dur, type, f, q, peak, f2) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q; s.connect(fl); this.env(fl, t, 0.005, peak, dur); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05); },
  tick(speed) { if (!this.ok()) return; const t = this.ctx.currentTime; this.tone('square', 2100 + Math.random() * 300, t, 0.001, 0.035, 0.025); this.burst(t, 0.03, 'highpass', 3000, 0.7, 0.05 + Math.min(speed, 1) * 0.04); },
  scrape() { if (!this.ok()) return; const t = this.ctx.currentTime; this.burst(t, 0.28, 'bandpass', 2600, 6, 0.12, 900); this.tone('triangle', 1400, t, 0.01, 0.02, 0.25, 700); },
  clack() { if (!this.ok()) return; const t = this.ctx.currentTime; this.tone('square', 900, t, 0.001, 0.08, 0.04); this.burst(t, 0.05, 'bandpass', 1800, 2, 0.2); this.tone('square', 620, t + 0.09, 0.001, 0.09, 0.05); this.burst(t + 0.09, 0.06, 'bandpass', 1300, 2, 0.24); },
  crack() { if (!this.ok()) return; const t = this.ctx.currentTime; this.burst(t, 0.22, 'lowpass', 1600, 0.8, 0.45, 300); this.tone('sine', 120, t, 0.004, 0.35, 0.3, 50); },
  creak() { if (!this.ok()) return; const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(92, t); o.frequency.linearRampToValueAtTime(150, t + 0.7);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 11; const lg = this.ctx.createGain(); lg.gain.value = 9; lfo.connect(lg); lg.connect(o.frequency);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3; o.connect(f); this.env(f, t, 0.08, 0.09, 0.7); o.start(t); lfo.start(t); o.stop(t + 0.9); lfo.stop(t + 0.9); },
  shimmer() { if (!this.ok()) return; const t = this.ctx.currentTime; [1318.5, 1661.2, 1975.5, 2489].forEach((f, i) => this.tone('sine', f, t + i * 0.07, 0.01, 0.05, 1.3));
    this.burst(t, 0.9, 'bandpass', 400, 1.2, 0.08, 4000); },
  whoosh() { if (!this.ok()) return; this.burst(this.ctx.currentTime, 0.55, 'bandpass', 300, 1.4, 0.16, 3200); },
  land() { if (!this.ok()) return; const t = this.ctx.currentTime; this.tone('sine', 150, t, 0.003, 0.3, 0.25, 70); this.burst(t, 0.08, 'lowpass', 900, 1, 0.2); },
  sting(rid) {
    if (!this.ok()) return; const t = this.ctx.currentTime + 0.02;
    const sets = { common: [523.3, 659.3], rare: [523.3, 659.3, 784], myth: [523.3, 622.3, 784, 932.3], leg: [440, 554.4, 659.3, 880, 1108.7], gold: [523.3, 659.3, 784, 987.8, 1174.7, 1568] };
    const ns = sets[rid]; ns.forEach((f, i) => { this.tone('triangle', f, t + i * 0.085, 0.01, 0.09, 0.9); this.tone('sine', f * 2, t + i * 0.085, 0.01, 0.025, 0.6); });
    if (rid === 'leg' || rid === 'gold') { this.tone('sine', 82, t, 0.01, 0.4, 1.1, 41); this.burst(t, 1.2, 'highpass', 5000, 0.5, rid === 'gold' ? 0.08 : 0.04); }
  },
};
