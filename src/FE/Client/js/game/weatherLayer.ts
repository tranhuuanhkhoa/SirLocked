import Phaser from 'phaser';
import {
  createFpsGovernor, createLightning, effectiveWeather, initialQuality, particleCount, seedParticles, stepParticles,
  NONE, type Particle, type Splash, type Weather,
} from './atmosphere/weatherCore.js';

/**
 * Rain, snow, wind and storm drawn over the Phaser scene (above actors and props, below the doorway labels and the
 * HUD) as square pixels on the scene's own pixel grid, never smoothed. Only outdoors: an indoor scene, a scene
 * without weather (every older case) and the player's "weather effects off" draw nothing at all.
 */
export type WeatherLayerOptions = {
  /** The player's weather-effects setting, read every frame. */
  enabled: () => boolean;
  reducedMotion: () => boolean;
  /** A lightning flash happened; thunder should follow after the given delay (1–3 s). */
  onBolt?: (thunderDelayMs: number) => void;
  random?: () => number;
  /** Starting particle quality (1, .5, .25); default from the screen size and CPU cores. */
  quality?: number;
};

const DEPTH = 92;
const COLORS = {
  rain: { color: 0xb0c4ec, alpha: .55 },
  storm: { color: 0xb8c8ee, alpha: .62 },
  splash: { color: 0xd8e2f6, alpha: .7 },
  snow: { color: 0xf0f4ff, alpha: .9 },
  leafA: { color: 0x9c7846, alpha: .95 },
  leafB: { color: 0x6e8c5a, alpha: .9 },
  dust: { color: 0xc8d2e6, alpha: .18 },
  flash: { color: 0xdce6ff, alpha: .55 },
};

export class WeatherLayer {
  private runtime: { weather?: unknown; indoor?: boolean | null } | null = null;
  private weather: Weather = NONE;
  private particles: Particle[] = [];
  private splashes: Splash[] = [];
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private unit = 4;
  private view = { width: 0, height: 0 };
  private quality: number;
  private governor;
  private lightning: ReturnType<typeof createLightning> | null = null;
  private flash = 0;
  private enabledState = true;
  private clock = 0;
  private stats = { bolts: 0, flashes: 0, frames: 0 };
  private readonly random: () => number;

  constructor(private options: WeatherLayerOptions) {
    this.random = options.random ?? Math.random;
    this.quality = options.quality ?? initialQuality({
      width: window.innerWidth, height: window.innerHeight, cores: navigator.hardwareConcurrency || 4,
    });
    this.governor = createFpsGovernor({ quality: this.quality });
  }

  /** A new scene (or new runtime of the same scene): weather switches at once, no fade. */
  setRuntime(runtime: { weather?: unknown; indoor?: boolean | null } | null | undefined) {
    this.runtime = runtime ?? null;
    this.refresh(true);
  }

  /** Draw objects die with every scene redraw; the particles live on. */
  attach(scene: Phaser.Scene, unit: number) {
    this.graphics = scene.add.graphics().setDepth(DEPTH).setScrollFactor(0);
    this.unit = Math.max(1, Math.round(unit));
    this.resize(scene.scale.width, scene.scale.height);
    this.paint();
  }

  update(deltaMs: number, nowMs: number) {
    this.clock = nowMs;
    const enabled = this.options.enabled();
    if (enabled !== this.enabledState) { this.enabledState = enabled; this.refresh(true); }
    if (this.weather.type === 'NONE') return;
    if (!this.graphics?.active) return;
    this.stats.frames++;
    const dropped = this.governor.sample(deltaMs);
    if (dropped !== null) { this.quality = dropped; this.particles.length = Math.min(this.particles.length, this.targetCount()); }
    const dt = Math.min(deltaMs, 50) / 1000;
    stepParticles(this.weather.type, this.particles, this.splashes, dt, this.view.width, this.view.height, this.random);
    if (this.lightning) {
      const bolt = this.lightning.poll(nowMs);
      if (bolt) {
        this.stats.bolts++;
        if (!this.options.reducedMotion()) { this.flash = 1; this.stats.flashes++; }
        this.options.onBolt?.(bolt.thunderDelayMs);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.paint();
  }

  /** Read-only state for tests and QA tools. */
  inspect() {
    return {
      type: this.weather.type, intensity: this.weather.intensity, active: this.weather.type !== 'NONE',
      enabled: this.enabledState, indoor: this.runtime?.indoor === true,
      particles: this.particles.length, splashes: this.splashes.length, quality: this.quality,
      measuring: this.governor.measuring, fpsHistory: this.governor.history.slice(),
      bolts: this.stats.bolts, flashes: this.stats.flashes, flashAlpha: Math.round(this.flash * 100) / 100,
      nextBoltInMs: this.lightning ? Math.max(0, Math.round(this.lightning.nextAt - this.clock)) : null,
      unit: this.unit, view: { ...this.view }, drawn: Boolean(this.graphics?.active && this.graphics.visible),
    };
  }

  /** Previews and tests: fixed particle quality (1, .5 or .25), no frame-rate measuring. */
  pinQuality(quality: number) {
    this.quality = [1, .5, .25].includes(quality) ? quality : 1;
    this.governor = createFpsGovernor({ quality: this.quality, maxWindows: 0 });
    this.refresh(true);
  }

  /** Test hook: the next storm bolt comes now. */
  boltSoon() { if (this.lightning) this.lightning = createLightning(this.random, this.clock - 6000, { firstMs: [0, 0], gapMs: [6000, 12000] }); }

  destroy() { this.graphics = null; this.particles = []; this.splashes = []; }

  private targetCount() {
    return particleCount(this.weather.type, this.weather.intensity, this.quality, this.view.width * this.view.height);
  }

  private refresh(force: boolean) {
    const next = effectiveWeather(this.runtime, this.enabledState && this.options.enabled());
    if (!force && next.type === this.weather.type && next.intensity === this.weather.intensity) return;
    const typeChanged = next.type !== this.weather.type;
    this.weather = next;
    this.splashes = [];
    this.flash = 0;
    this.particles = next.type === 'NONE' ? [] : seedParticles(next.type, this.targetCount(), this.view.width, this.view.height, this.random);
    this.lightning = next.type === 'STORM' ? createLightning(this.random, this.clock) : null;
    if (typeChanged && next.type !== 'NONE') this.governor.restart();
    this.paint();
  }

  private resize(screenWidth: number, screenHeight: number) {
    const width = Math.ceil(screenWidth / this.unit), height = Math.ceil(screenHeight / this.unit);
    if (width === this.view.width && height === this.view.height) return;
    this.view = { width, height };
    if (this.weather.type !== 'NONE') this.particles = seedParticles(this.weather.type, this.targetCount(), width, height, this.random);
  }

  private paint() {
    const g = this.graphics;
    if (!g?.active) return;
    g.clear();
    const type = this.weather.type;
    if (type === 'NONE') { g.setVisible(false); return; }
    g.setVisible(true);
    const u = this.unit;
    const px = (value: number) => Math.round(value) * u;
    if (type === 'RAIN' || type === 'STORM') {
      const style = type === 'STORM' ? COLORS.storm : COLORS.rain;
      const length = type === 'STORM' ? 5 : 4;
      g.fillStyle(style.color, style.alpha);
      // A drop is a short slanted streak: the lower half one pixel left of the upper, as the wind pushes it.
      for (const q of this.particles) {
        const x = px(q.x), y = px(q.y);
        g.fillRect(x, y - length * u, u, Math.ceil(length / 2) * u);
        g.fillRect(x - u, y - Math.floor(length / 2) * u, u, Math.floor(length / 2) * u);
      }
      g.fillStyle(COLORS.splash.color, COLORS.splash.alpha);
      for (const s of this.splashes) g.fillRect(px(s.x) - u, px(s.y), u * 3, u);
      if (this.flash > 0) {
        g.fillStyle(COLORS.flash.color, COLORS.flash.alpha * this.flash);
        g.fillRect(0, 0, this.view.width * u, this.view.height * u);
      }
    } else if (type === 'SNOW') {
      g.fillStyle(COLORS.snow.color, COLORS.snow.alpha);
      for (const q of this.particles) {
        const size = q.s > .9 ? 2 * u : u;
        g.fillRect(px(q.x), px(q.y), size, size);
      }
    } else if (type === 'WIND') {
      for (const q of this.particles) {
        const style = q.s > .9 ? COLORS.leafA : COLORS.leafB;
        g.fillStyle(style.color, style.alpha);
        g.fillRect(px(q.x), px(q.y), 2 * u, u);
        g.fillStyle(COLORS.dust.color, COLORS.dust.alpha);
        g.fillRect(px(q.x) - 14 * u, px(q.y) + 3 * u, 10 * u, u);
      }
    }
  }
}
