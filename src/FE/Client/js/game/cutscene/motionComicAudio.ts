/* Web Audio synthesis for the motion-comic intro. Everything is generated, there are no audio files.
   Levels follow the game's shared sound settings (music, effects, mute) through `AudioSettingsAccess`. */

import type { AudioSettingsAccess } from './audioSettings.js';
export type { AudioSettingsAccess, AudioSettingsValue } from './audioSettings.js';

const DEFAULTS = { music: 0.2, effects: 0.35, muted: false };

function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const CHORDS = [
  { pad: [146.83, 174.61, 220.0, 329.63], bass: 73.42, mel: [587.33, 698.46, 880.0, 659.25] },
  { pad: [116.54, 146.83, 174.61, 220.0], bass: 58.27, mel: [587.33, 698.46, 523.25, 880.0] },
  { pad: [98.0, 116.54, 146.83, 164.81], bass: 49.0, mel: [587.33, 466.16, 698.46, 783.99] },
  { pad: [110.0, 138.59, 196.0, 233.08], bass: 55.0, mel: [554.37, 659.25, 466.16, 880.0] },
];
const MOOD_SEMITONES: Record<string, number> = { 'rain-night': 0, 'fog-morning': 3, 'warm-dusk': 5, 'neon-night': -2, 'clear-day': 7, 'storm-night': -5, 'candle-dark': 0 };

type Handle = { stop: () => void };

export class ComicAudio {
  private ctx: AudioContext | null = null;
  ready = false;
  private out!: GainNode; private bus!: GainNode; private send!: GainNode; private rev!: ConvolverNode; private mus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private scoped: { h: Handle; shot: number; name: string }[] = [];
  private musicOn = false; private mTimer: ReturnType<typeof setInterval> | null = null; private mStart = 0; private mNext = 0;
  private transpose = 1;
  private rainOn = false; private rainLP!: BiquadFilterNode; private rainGain!: GainNode; private rumble!: GainNode;
  private disposed = false;

  constructor(private settings: AudioSettingsAccess) {}

  /** Must run from a click or key press so the browser allows sound. Returns false when audio cannot start. */
  init(): boolean {
    if (this.disposed) return false;
    if (this.ctx) { void this.ctx.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    try {
      const c = this.ctx = new AC();
      this.out = c.createGain(); this.out.gain.value = 1;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.25;
      this.out.connect(comp); comp.connect(c.destination);
      this.bus = c.createGain(); this.bus.connect(this.out);
      this.rev = c.createConvolver(); this.rev.buffer = this.ir(2.6, 2.4);
      const ro = c.createGain(); ro.gain.value = 0.45; this.rev.connect(ro); ro.connect(this.out);
      this.send = c.createGain(); this.send.connect(this.rev);
      const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
      this.mus = c.createGain(); this.mus.gain.value = 0.0001; this.mus.connect(this.out);
      const ms = c.createGain(); ms.gain.value = 0.6; this.mus.connect(ms); ms.connect(this.rev);
      this.ready = true;
      void c.resume().catch(() => {});
      this.applyLevels();
      return true;
    } catch { this.ctx = null; return false; }
  }

  /** The context is "running" only if the browser let it start; false means autoplay was blocked. */
  get running() { return this.ctx?.state === 'running'; }

  /** Follow the shared settings: mute, effects level, music level. Cheap enough to call every frame. */
  applyLevels() {
    if (!this.ctx || !this.ready) return;
    const s = this.settings.get(), t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.05);
    this.bus.gain.setTargetAtTime(Math.min(2.5, s.effects / DEFAULTS.effects) * 0.85, t, 0.05);
    this.send.gain.setTargetAtTime(Math.min(2.5, s.effects / DEFAULTS.effects), t, 0.05);
    this.musicScale = Math.min(2.5, s.music / DEFAULTS.music);
    if (this.musicOn) this.duck(this.duckLevel, 0.1);
  }
  private musicScale = 1; private duckLevel = 0.5;

  suspend() { void this.ctx?.suspend().catch(() => {}); }
  resume() { void this.ctx?.resume().catch(() => {}); }
  dispose() {
    this.disposed = true;
    if (this.mTimer) clearInterval(this.mTimer);
    this.stopScopedBefore(Infinity);
    void this.ctx?.close().catch(() => {});
    this.ctx = null; this.ready = false;
  }

  private ir(sec: number, decay: number) {
    const c = this.ctx!, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  private now() { return this.ctx!.currentTime; }
  private noise() { const s = this.ctx!.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; return s; }
  private filt(type: BiquadFilterType, f: number, q?: number) { const x = this.ctx!.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q != null) x.Q.value = q; return x; }
  private gainEnv(t0: number, a: number, peak: number, d: number) {
    const gn = this.ctx!.createGain();
    gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    return gn;
  }
  private panner(v: number): AudioNode & { pan?: AudioParam } {
    const c = this.ctx!;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = v; return p; }
    return c.createGain();
  }
  private burst(t0: number, type: BiquadFilterType, f: number, q: number | null, peak: number, dec: number, toSend = false) {
    const n = this.noise(), fl = this.filt(type, f, q ?? undefined), gn = this.gainEnv(t0, 0.002, peak, dec);
    n.connect(fl); fl.connect(gn); gn.connect(this.bus); if (toSend) gn.connect(this.send);
    n.start(t0, Math.random()); n.stop(t0 + dec + 0.1);
  }

  // ---------------------------------------------------------------- ambience

  setMood(mood: string) { this.transpose = Math.pow(2, (MOOD_SEMITONES[mood] ?? 0) / 12); }

  setRain(on: boolean) {
    if (!this.ready) return;
    const c = this.ctx!;
    if (!this.rainOn && on) {
      this.rainOn = true;
      const n = this.noise(), hp = this.filt('highpass', 450);
      this.rainLP = this.filt('lowpass', 6500); this.rainGain = c.createGain(); this.rainGain.gain.value = 0.0001;
      n.connect(hp); hp.connect(this.rainLP); this.rainLP.connect(this.rainGain); this.rainGain.connect(this.bus); n.start();
      const n2 = this.noise(), lp2 = this.filt('lowpass', 260); this.rumble = c.createGain(); this.rumble.gain.value = 0.0001;
      n2.connect(lp2); lp2.connect(this.rumble); this.rumble.connect(this.bus); n2.start(c.currentTime, 0.7);
    }
    if (!this.rainOn) return;
    const t = this.now();
    this.rainLP.frequency.setTargetAtTime(on ? 6500 : 900, t, 0.5);
    this.rainGain.gain.setTargetAtTime(on ? 0.1 : 0.0001, t, 0.6);
    this.rumble.gain.setTargetAtTime(on ? 0.07 : 0.0001, t, 0.6);
  }

  startMusic() {
    if (this.musicOn || !this.ready) return;
    this.musicOn = true;
    const t = this.now();
    this.mus.gain.cancelScheduledValues(t); this.mus.gain.setValueAtTime(0.0001, t);
    this.mus.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * this.musicScale), t + 5);
    this.mStart = t + 0.2; this.mNext = 0;
    this.mTimer = setInterval(() => this.schedMusic(), 150); this.schedMusic();
  }
  private schedMusic() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const bar = 4, ahead = this.now() + 0.8;
    if (this.mStart + this.mNext * bar < this.now() - bar) this.mNext = Math.ceil((this.now() - this.mStart) / bar);
    while (this.mStart + this.mNext * bar < ahead) {
      const i = this.mNext, t = this.mStart + i * bar, ch = CHORDS[i % 4], r = mulberry(100 + i), k = this.transpose;
      this.pad(ch.pad.map((f) => f * k), t, bar, 0.05); this.bass(ch.bass * k, t);
      for (let n = 1; n < 8; n++) if (r() < 0.17) this.vibe(ch.mel[Math.floor(r() * ch.mel.length)] * k, t + n * bar / 8, 0.05 + r() * 0.04);
      this.mNext++;
    }
  }
  duck(level: number, tau: number) {
    if (!this.ready) return;
    this.duckLevel = level;
    const t = this.now();
    this.mus.gain.cancelScheduledValues(t);
    this.mus.gain.setTargetAtTime(Math.max(0.0001, level * this.musicScale), t, tau);
  }
  private pad(freqs: number[], t: number, dur: number, vol: number) {
    const c = this.ctx!, lp = this.filt('lowpass', 650, 0.7), gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 1.2); gn.gain.setValueAtTime(vol, t + dur - 0.6); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1);
    lp.connect(gn); gn.connect(this.mus);
    for (const f of freqs) for (const dt of [-7, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(lp); o.start(t); o.stop(t + dur + 1.1); }
  }
  private bass(f: number, t: number) {
    const c = this.ctx!, o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const lp = this.filt('lowpass', 400), gn = this.gainEnv(t, 0.01, 0.22, 2.2);
    o.connect(lp); lp.connect(gn); gn.connect(this.mus); o.start(t); o.stop(t + 2.4);
  }
  private vibe(f: number, t: number, v: number) {
    const c = this.ctx!, gn = this.gainEnv(t, 0.004, v, 2.6), trem = c.createGain(); trem.gain.value = 0.85;
    const l = c.createOscillator(); l.frequency.value = 5.2; const lg = c.createGain(); lg.gain.value = 0.15; l.connect(lg); lg.connect(trem.gain);
    const o1 = c.createOscillator(); o1.frequency.value = f; const o2 = c.createOscillator(); o2.frequency.value = f * 4;
    const g2 = c.createGain(); g2.gain.value = 0.12;
    o1.connect(trem); o2.connect(g2); g2.connect(trem); trem.connect(gn); gn.connect(this.mus);
    [o1, o2, l].forEach((o) => { o.start(t); o.stop(t + 2.8); });
  }

  // ---------------------------------------------------------------- effects

  /** Plays one named cue. Looping cues return a handle so the engine can stop them when the shot ends. */
  play(name: string, shot: number) {
    if (!this.ready || this.disposed || this.ctx?.state !== 'running') return;
    try {
      const h = this.cue(name);
      if (h) this.scoped.push({ h, shot, name });
    } catch { /* audio is best-effort */ }
  }
  private cue(name: string): Handle | void {
    switch (name) {
      case 'musicIn': return this.startMusic();
      case 'thump': return this.thump(1);
      case 'click': return this.click();
      case 'whoosh': return this.whoosh(0.6, 0.9, 0.5);
      case 'whooshSoft': return this.whoosh(0.9, 0.5, -0.3);
      case 'whooshLong': return this.whoosh(1.4, 1, 0.8);
      case 'ring': return this.ring(2);
      case 'siren': return this.siren();
      case 'shatter': return this.shatter();
      case 'ticking': return this.ticking();
      case 'thunder': return this.thunder(1);
      case 'titleHit': this.thump(1.6); this.thunder(0.5); this.duck(0.6, 0.4); this.pad([73.42, 146.83, 220, 293.66, 349.23, 440], this.now(), 4.5, 0.06); return;
    }
  }
  stopScopedBefore(shot: number) {
    this.scoped = this.scoped.filter((s) => {
      if (s.shot < shot) { try { s.h.stop(); } catch { /* already ended */ } return false; }
      return true;
    });
  }
  private thump(k: number) {
    const c = this.ctx!, t = this.now(), o = c.createOscillator();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const gn = this.gainEnv(t, 0.005, 0.6 * k, 0.4); o.connect(gn); gn.connect(this.bus); o.start(t); o.stop(t + 0.5);
    this.burst(t, 'lowpass', 900, null, 0.25 * k, 0.12);
  }
  private whoosh(dur: number, k: number, pan: number) {
    const c = this.ctx!, t = this.now(), n = this.noise(), f = this.filt('bandpass', 300, 1.1);
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2200, t + dur * 0.6); f.frequency.exponentialRampToValueAtTime(900, t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.2 * k, t + dur * 0.45); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.panner(-pan); p.pan?.linearRampToValueAtTime(pan, t + dur);
    n.connect(f); f.connect(gn); gn.connect(p); p.connect(this.bus); n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }
  private ring(count: number): Handle {
    const c = this.ctx!, t0 = this.now(), out = c.createGain(); out.gain.value = 0.0001;
    const bp = this.filt('bandpass', 2000, 0.8); out.connect(bp); bp.connect(this.bus);
    const am = c.createGain(); am.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 24;
    const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); am.connect(out);
    const nodes: OscillatorNode[] = [lfo];
    for (const f of [1460, 1830, 2470, 3120]) { const o = c.createOscillator(); o.frequency.value = f; const og = c.createGain(); og.gain.value = 0.25; o.connect(og); og.connect(am); o.start(t0); nodes.push(o); }
    lfo.start(t0);
    for (let i = 0; i < count; i++) { const s = t0 + i * 1.7; out.gain.setValueAtTime(0.0001, s); out.gain.exponentialRampToValueAtTime(0.3, s + 0.02); out.gain.setValueAtTime(0.3, s + 1.0); out.gain.exponentialRampToValueAtTime(0.0001, s + 1.08); }
    nodes.forEach((nd) => nd.stop(t0 + count * 1.7));
    return { stop: () => { const t = this.now(); out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0.0001, t, 0.015); } };
  }
  private click() {
    const t = this.now(); this.burst(t, 'bandpass', 1700, 2, 0.5, 0.05);
    const o = this.ctx!.createOscillator(); o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    const gn = this.gainEnv(t, 0.002, 0.3, 0.08); o.connect(gn); gn.connect(this.bus); o.start(t); o.stop(t + 0.14);
  }
  private siren(): Handle {
    const c = this.ctx!, t = this.now(), gn = c.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.03, t + 2);
    const lp = this.filt('lowpass', 1300), p = this.panner(-0.35); lp.connect(gn); gn.connect(p); p.connect(this.bus); p.connect(this.send);
    const nodes: OscillatorNode[] = [];
    for (const [base, rate, dep] of [[760, 0.32, 170], [640, 0.27, 120]]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = base;
      const l = c.createOscillator(); l.frequency.value = rate; const lg = c.createGain(); lg.gain.value = dep; l.connect(lg); lg.connect(o.frequency);
      o.connect(lp); o.start(t); l.start(t); nodes.push(o, l);
    }
    return { stop: () => { const t2 = this.now(); gn.gain.cancelScheduledValues(t2); gn.gain.setTargetAtTime(0.0001, t2, 0.5); nodes.forEach((nd) => nd.stop(t2 + 3)); } };
  }
  private shatter() {
    const c = this.ctx!, t = this.now();
    this.burst(t, 'highpass', 2200, null, 0.55, 0.45, true); this.burst(t, 'bandpass', 900, 0.6, 0.3, 0.2);
    for (let i = 0; i < 16; i++) {
      const tt = t + 0.04 + Math.random() * 0.9, o = c.createOscillator(); o.frequency.value = 2400 + Math.random() * 5200;
      const og = this.gainEnv(tt, 0.001, 0.05 + Math.random() * 0.06, 0.06 + Math.random() * 0.2), p = this.panner(Math.random() * 1.6 - 0.8);
      o.connect(og); og.connect(p); p.connect(this.bus); p.connect(this.send); o.start(tt); o.stop(tt + 0.4);
    }
  }
  private ticking(): Handle {
    const c = this.ctx!, t0 = this.now(), tg = c.createGain(); tg.gain.value = 1; tg.connect(this.bus); tg.connect(this.send);
    for (let i = 0; i < 8; i++) {
      const t = t0 + i, n = this.noise(), f = this.filt('bandpass', i % 2 ? 1500 : 2600, 4), gn = this.gainEnv(t, 0.001, 0.22, 0.03);
      n.connect(f); f.connect(gn); gn.connect(tg); n.start(t, Math.random()); n.stop(t + 0.08);
    }
    return { stop: () => { tg.gain.cancelScheduledValues(this.now()); tg.gain.setValueAtTime(0, this.now()); } };
  }
  private thunder(k: number) {
    const c = this.ctx!, t = this.now(); this.burst(t, 'highpass', 900, null, 0.5 * k, 0.35, true);
    const n = this.noise(), lp = this.filt('lowpass', 420); lp.frequency.exponentialRampToValueAtTime(110, t + 3);
    const am = c.createGain(); am.gain.value = 0.7; const l = c.createOscillator(); l.frequency.value = 3.3;
    const lg = c.createGain(); lg.gain.value = 0.3; l.connect(lg); lg.connect(am.gain);
    const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.9 * k, t + 0.12); g2.gain.exponentialRampToValueAtTime(0.25 * k, t + 1); g2.gain.exponentialRampToValueAtTime(0.0001, t + 3.8);
    n.connect(lp); lp.connect(am); am.connect(g2); g2.connect(this.bus); g2.connect(this.send); n.start(t, Math.random()); n.stop(t + 4); l.start(t); l.stop(t + 4);
  }
}
