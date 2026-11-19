// Weather and time of day of a scene (docs/case-audio-weather.md: runtime.weather, runtime.indoor, runtime.timeOfDay).
// Plain JavaScript with no DOM or Phaser, so node --test checks the rules and the Phaser layer only draws.

/** @typedef {'NONE' | 'RAIN' | 'WIND' | 'SNOW' | 'STORM'} WeatherType */
/** @typedef {{ type: WeatherType, intensity: number }} Weather */
/** @typedef {{ x: number, y: number, s: number, p: number }} Particle */
/** @typedef {{ x: number, y: number, life: number }} Splash */

export const WEATHER_TYPES = /** @type {const} */ (['NONE', 'RAIN', 'WIND', 'SNOW', 'STORM']);
/** Particles at full quality and intensity 1 (a 512 x 512 native-pixel view; scaled by the view area). */
export const BASE_PARTICLES = { RAIN: 420, STORM: 650, SNOW: 260, WIND: 90 };
/** Particle budget steps: full, half, quarter. */
export const QUALITY_LEVELS = [1, 0.5, 0.25];
/** Character and item tint so sprites match the night or dusk background variant. */
export const TIME_TINTS = { NIGHT: 0x8c9ad0, DUSK: 0xffd2a8 };
export const NONE = /** @type {Weather} */ ({ type: 'NONE', intensity: 0 });

const REFERENCE_AREA = 512 * 512;

/** @returns {Weather} */
export function normalizeWeather(weather) {
  if (!weather || typeof weather !== 'object') return NONE;
  const type = String(weather.type ?? '').toUpperCase();
  const intensity = typeof weather.intensity === 'number' && Number.isFinite(weather.intensity)
    ? Math.min(1, Math.max(0, weather.intensity)) : 0.6;
  if (!WEATHER_TYPES.includes(/** @type {any} */ (type)) || type === 'NONE' || intensity <= 0) return NONE;
  return { type: /** @type {WeatherType} */ (type), intensity };
}

/**
 * The weather actually shown and heard: none indoors, none when the player turned weather effects off, none when
 * the scene has no weather (every case made before the field existed).
 * @param {{ weather?: unknown, indoor?: boolean | null } | null | undefined} runtime
 * @param {boolean} [enabled]
 * @returns {Weather}
 */
export function effectiveWeather(runtime, enabled = true) {
  if (!enabled || !runtime || runtime.indoor === true) return NONE;
  return normalizeWeather(runtime.weather);
}

/** @returns {number | null} tint colour, or null for day (and for scenes without timeOfDay). */
export function timeOfDayTint(runtime) {
  const time = String(runtime?.timeOfDay ?? '').toUpperCase();
  return time === 'NIGHT' ? TIME_TINTS.NIGHT : time === 'DUSK' ? TIME_TINTS.DUSK : null;
}

/** Number of particles for a weather, its intensity, the quality level and the view size in native pixels. */
export function particleCount(type, intensity, quality = 1, area = REFERENCE_AREA) {
  const base = BASE_PARTICLES[type] ?? 0;
  if (!base || intensity <= 0) return 0;
  const areaScale = Math.min(2.5, Math.max(0.35, area / REFERENCE_AREA));
  return Math.max(1, Math.round(base * (0.35 + 0.65 * intensity) * quality * areaScale));
}

/**
 * Starting quality: a small screen on a device with few cores starts at half the particles, very few cores at a
 * quarter. The frame-rate governor can lower it further.
 */
export function initialQuality({ width = 1280, height = 720, cores = 8 } = {}) {
  const small = Math.min(width, height) < 500 || width * height < 420_000;
  if (cores > 0 && cores <= 2) return small ? QUALITY_LEVELS[2] : QUALITY_LEVELS[1];
  if (small && cores > 0 && cores <= 4) return QUALITY_LEVELS[1];
  return QUALITY_LEVELS[0];
}

/**
 * Watches the frame rate during the first seconds of weather. Every window whose median frame rate is below
 * `lowFps` halves the particles (full -> half -> quarter). After `maxWindows` windows it stops measuring.
 * The median ignores single long frames (texture loads, a tab switch).
 */
export function createFpsGovernor({ quality = 1, windowMs = 2000, maxWindows = 4, lowFps = 40, maxDeltaMs = 250 } = {}) {
  let level = Math.max(0, QUALITY_LEVELS.indexOf(quality));
  let frames = [];
  let elapsed = 0;
  let windows = 0;
  const history = [];
  return {
    get quality() { return QUALITY_LEVELS[level]; },
    get measuring() { return windows < maxWindows; },
    history,
    /** Feed one frame; returns the new quality when it dropped, otherwise null. */
    sample(deltaMs) {
      if (windows >= maxWindows || !(deltaMs > 0)) return null;
      if (deltaMs > maxDeltaMs) return null;
      frames.push(deltaMs);
      elapsed += deltaMs;
      if (elapsed < windowMs) return null;
      const sorted = frames.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const fps = Math.round(1000 / median * 10) / 10;
      frames = [];
      elapsed = 0;
      windows++;
      const before = QUALITY_LEVELS[level];
      if (fps < lowFps && level < QUALITY_LEVELS.length - 1) level++;
      history.push({ fps, quality: before, next: QUALITY_LEVELS[level] });
      return QUALITY_LEVELS[level] !== before ? QUALITY_LEVELS[level] : null;
    },
    /** A new scene starts the measurement again from the current level. */
    restart() { frames = []; elapsed = 0; windows = 0; },
  };
}

/** Thunder follows the flash after 1–3 s. */
export function thunderDelayMs(random = Math.random) {
  return Math.round(1000 + Math.min(1, Math.max(0, random())) * 2000);
}

/**
 * Storm lightning: one short flash, then quiet for 6–12 s (the first bolt 2–5 s after the storm starts), so it
 * never flickers continuously.
 */
export function createLightning(random = Math.random, nowMs = 0, { firstMs = [2000, 5000], gapMs = [6000, 12000] } = {}) {
  const between = ([min, max]) => min + random() * (max - min);
  let nextAt = nowMs + between(firstMs);
  return {
    get nextAt() { return nextAt; },
    /** @returns {{ at: number, thunderDelayMs: number } | null} */
    poll(now) {
      if (now < nextAt) return null;
      const bolt = { at: now, thunderDelayMs: thunderDelayMs(random) };
      nextAt = now + between(gapMs);
      return bolt;
    },
  };
}

/** Particles over a w x h native-pixel view. */
export function seedParticles(type, count, width, height, random = Math.random) {
  /** @type {Particle[]} */
  const particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({ x: random() * width, y: random() * height, s: 0.6 + random() * 0.6, p: random() * Math.PI * 2 });
  }
  return particles;
}

/**
 * Moves every particle by dt seconds (speeds in native pixels per second) and wraps it around the view.
 * Rain drops that reach their ground line leave a splash.
 * @param {WeatherType} type
 * @param {Particle[]} particles
 * @param {Splash[]} splashes
 */
export function stepParticles(type, particles, splashes, dt, width, height, random = Math.random) {
  if (type === 'RAIN' || type === 'STORM') {
    const fall = type === 'STORM' ? 460 : 380;
    const drift = type === 'STORM' ? 130 : 90;
    for (const q of particles) {
      q.y += fall * q.s * dt;
      q.x -= drift * q.s * dt;
      // Each drop lands somewhere on the (top-down) ground: its own line from p.
      const ground = height * (0.35 + 0.65 * (q.p / (Math.PI * 2)));
      if (q.y > ground) {
        if (splashes.length < 160 && random() < 0.5) splashes.push({ x: q.x, y: ground, life: 0.14 });
        q.y = -4 - random() * 20;
        q.x = random() * (width + 60);
        q.p = random() * Math.PI * 2;
      }
      if (q.x < -4) q.x += width + 40;
    }
  } else if (type === 'SNOW') {
    for (const q of particles) {
      q.p += dt * 1.4;
      q.y += 24 * q.s * dt;
      q.x += Math.sin(q.p) * 12 * dt - 6 * dt;
      if (q.y > height + 2) { q.y = -3; q.x = random() * width; }
      if (q.x < -3) q.x += width + 3;
    }
  } else if (type === 'WIND') {
    for (const q of particles) {
      q.p += dt * 5;
      q.x += 160 * q.s * dt;
      q.y += Math.sin(q.p) * 20 * dt;
      if (q.x > width + 4) { q.x = -6; q.y = random() * height; }
    }
  }
  for (let i = splashes.length - 1; i >= 0; i--) {
    splashes[i].life -= dt;
    if (splashes[i].life <= 0) splashes.splice(i, 1);
  }
}

/** Filter settings of the synthesized weather sound: noise through a high-pass and a low-pass, wind with an LFO. */
export const WEATHER_SOUND = {
  RAIN: { highpass: 400, lowpass: 1500, lfoDepth: 0, lfoRate: 0.17, gain: 0.35 },
  STORM: { highpass: 250, lowpass: 1800, lfoDepth: 0, lfoRate: 0.17, gain: 0.55 },
  WIND: { highpass: 120, lowpass: 520, lfoDepth: 380, lfoRate: 0.17, gain: 0.32 },
  SNOW: { highpass: 90, lowpass: 380, lfoDepth: 220, lfoRate: 0.11, gain: 0.2 },
};

/** Loudness of the weather bed for an intensity: never silent while it rains, full at intensity 1. */
export function weatherGain(weather) {
  const profile = WEATHER_SOUND[weather?.type];
  return profile ? profile.gain * (0.4 + 0.6 * weather.intensity) : 0;
}
