// Speech blips of the characters (docs/case-audio-weather.md, characters[].voice.blip).
// Plain JavaScript with no DOM: the game, the unit tests (node --test) and the studio tool blip_preview
// (tools/studio-mcp, offline WAV render) all import this file, so the three hear the same thing.

/** @typedef {'square' | 'triangle' | 'sine' | 'sawtooth'} BlipWave */
/** @typedef {{ pitch?: number, speed?: number, wave?: string, variance?: number }} BlipFields */
/** @typedef {{ blip?: BlipFields | null } | null | undefined} CharacterVoice */
/**
 * @typedef {object} ResolvedBlipVoice
 * @property {string} characterId
 * @property {number} pitch     Hz, 80–1200
 * @property {number} speed     letters per second, 10–40
 * @property {BlipWave} wave
 * @property {number} variance  0–1, how far the pitch wanders between letters
 * @property {number} seed      fixed per character, so the same line always sounds the same
 * @property {boolean} authored true when the case wrote voice.blip, false for the default made from the id
 */
/**
 * @typedef {object} BlipStep
 * @property {string} char
 * @property {number} end      UTF-16 offset just after this character (text.slice(0, end) shows it)
 * @property {number} delayMs  wait after showing this character before the next one
 * @property {boolean} blip    letters and digits blip; spaces, punctuation and marks do not
 * @property {number} pitch    Hz of this blip (0 when blip is false)
 */

export const BLIP_WAVES = /** @type {const} */ (['square', 'triangle', 'sine', 'sawtooth']);
export const BLIP_LIMITS = { pitch: [80, 1200], speed: [10, 40], variance: [0, 1] };
/** Same envelope in the browser (WebAudio) and in the offline render. */
export const BLIP_ENVELOPE = { attack: 0.006, peak: 0.12, floor: 0.0008 };
/** A full stop, comma, question mark... holds the line for this many letter-times. */
export const PUNCTUATION_PAUSE = 5;
/** At most this many blips sound at once; extra blips are dropped, never queued. */
export const MAX_BLIP_VOICES = 3;

const DEFAULT_WAVES = /** @type {BlipWave[]} */ (['triangle', 'square', 'sine', 'triangle']);
const SPOKEN = /[\p{L}\p{N}]/u;
const MARK = /\p{M}/u;
const PAUSING = /[.,!?…:;—–。、！？，；：]/u;

const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** FNV-1a, 32 bit. */
export function hashString(text) {
  let hash = 2166136261;
  for (const ch of String(text ?? '')) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** xorshift32 in [0, 1). The same seed always gives the same sequence. */
export function seededRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

/** The voice a character gets when the case has no voice.blip: stable, made from the character id only. */
export function defaultBlipVoice(characterId) {
  const id = String(characterId ?? '');
  const random = seededRandom(hashString(`voice:${id}`));
  return {
    characterId: id,
    pitch: Math.round(140 + random() * 380),
    speed: Math.round(16 + random() * 12),
    wave: DEFAULT_WAVES[Math.floor(random() * DEFAULT_WAVES.length)],
    variance: Math.round((0.12 + random() * 0.2) * 100) / 100,
    seed: hashString(id),
    authored: false,
  };
}

/**
 * The voice to use for a character: the authored voice.blip, field by field, and the default for any field that
 * is missing or invalid.
 * @param {string} characterId
 * @param {CharacterVoice} voice
 * @returns {ResolvedBlipVoice}
 */
export function resolveBlipVoice(characterId, voice) {
  const fallback = defaultBlipVoice(characterId);
  const blip = voice && typeof voice === 'object' ? voice.blip : null;
  if (!blip || typeof blip !== 'object') return fallback;
  const wave = typeof blip.wave === 'string' ? blip.wave.toLowerCase() : '';
  return {
    characterId: fallback.characterId,
    pitch: finite(blip.pitch) ? clamp(blip.pitch, BLIP_LIMITS.pitch) : fallback.pitch,
    speed: finite(blip.speed) ? clamp(blip.speed, BLIP_LIMITS.speed) : fallback.speed,
    wave: /** @type {BlipWave} */ (BLIP_WAVES.includes(/** @type {any} */ (wave)) ? wave : fallback.wave),
    variance: finite(blip.variance) ? clamp(blip.variance, BLIP_LIMITS.variance) : fallback.variance,
    seed: fallback.seed,
    authored: true,
  };
}

export const isSpokenChar = (ch) => SPOKEN.test(ch);
export const isPausingPunctuation = (ch) => PAUSING.test(ch);

/**
 * How a line is typed out and which characters blip, with the pitch of each blip. Pitch wanders randomly by
 * `variance`, from a generator seeded by the character, so it is the same every time the line plays.
 * @param {string} text
 * @param {ResolvedBlipVoice} voice
 * @returns {BlipStep[]}
 */
export function blipPlan(text, voice) {
  const random = seededRandom(voice.seed);
  const letterMs = 1000 / voice.speed;
  /** @type {BlipStep[]} */
  const steps = [];
  let end = 0;
  for (const ch of String(text ?? '')) {
    end += ch.length;
    if (SPOKEN.test(ch)) {
      const pitch = voice.pitch * (1 + (random() - 0.5) * voice.variance);
      steps.push({ char: ch, end, delayMs: letterMs, blip: true, pitch: Math.round(pitch * 100) / 100 });
    } else if (MARK.test(ch)) {
      // A combining accent (decomposed Vietnamese) belongs to the letter before it: no extra time, no blip.
      steps.push({ char: ch, end, delayMs: 0, blip: false, pitch: 0 });
    } else {
      steps.push({ char: ch, end, delayMs: PAUSING.test(ch) ? letterMs * PUNCTUATION_PAUSE : letterMs, blip: false, pitch: 0 });
    }
  }
  return steps;
}

/** Length of one blip in seconds: short enough that consecutive letters never overlap. */
export function blipDuration(voice) {
  return Math.min(0.075, Math.max(0.025, 0.85 / voice.speed));
}

function waveSample(wave, phase) {
  const t = phase - Math.floor(phase);
  switch (wave) {
    case 'square': return t < 0.5 ? 1 : -1;
    case 'sawtooth': return 2 * t - 1;
    case 'triangle': return t < 0.5 ? 4 * t - 1 : 3 - 4 * t;
    default: return Math.sin(2 * Math.PI * t);
  }
}

/**
 * Offline render of a whole line: mono samples in [-1, 1]. Same plan, wave and envelope as the game.
 * @param {BlipStep[]} plan
 * @param {ResolvedBlipVoice} voice
 * @param {{ sampleRate?: number, gain?: number, tailSec?: number }} [options]
 */
export function renderBlips(plan, voice, options = {}) {
  const sampleRate = options.sampleRate ?? 22050;
  const gain = options.gain ?? 4;
  const duration = blipDuration(voice);
  const totalMs = plan.reduce((sum, step) => sum + step.delayMs, 0) + (options.tailSec ?? 0.3) * 1000;
  const samples = new Float32Array(Math.ceil(totalMs / 1000 * sampleRate));
  const { attack, peak, floor } = BLIP_ENVELOPE;
  const decay = Math.log(floor / peak);
  let at = 0;
  const active = [];
  for (const step of plan) {
    // Shown at `at`, blip starts there; the next character waits delayMs.
    if (step.blip) {
      while (active.length && active[0] <= at) active.shift();
      if (active.length < MAX_BLIP_VOICES) {
        active.push(at + duration);
        active.sort((a, b) => a - b);
        const start = Math.floor(at * sampleRate);
        const length = Math.floor(duration * sampleRate);
        for (let i = 0; i < length && start + i < samples.length; i++) {
          const t = i / sampleRate;
          const envelope = t < attack ? peak * (t / attack) : peak * Math.exp(decay * (t - attack) / Math.max(1e-6, duration - attack));
          samples[start + i] += waveSample(voice.wave, step.pitch * t) * envelope * gain;
        }
      }
    }
    at += step.delayMs / 1000;
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i]));
  return samples;
}

/** 16-bit PCM mono WAV file bytes. */
export function encodeWav(samples, sampleRate = 22050) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return bytes;
}
