/* The game's shared sound settings, as the cutscene player needs them. Kept tiny: it loads with the game, the player does not. */

export type AudioSettingsValue = { music: number; effects: number; muted: boolean };
export type AudioSettingsAccess = { get(): AudioSettingsValue; set(partial: Partial<AudioSettingsValue>): void };

const STORAGE_KEY = 'sirlocked.audio.v1';
const DEFAULTS: AudioSettingsValue = { music: 0.2, effects: 0.35, muted: false };
const unit = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** Reads and writes the same stored settings the game uses, for places that have no audio controller (cases list, admin). */
export function storedAudioSettings(): AudioSettingsAccess {
  const read = (): AudioSettingsValue => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { music: unit(raw?.music, DEFAULTS.music), effects: unit(raw?.effects, DEFAULTS.effects), muted: typeof raw?.muted === 'boolean' ? raw.muted : DEFAULTS.muted };
    } catch { return { ...DEFAULTS }; }
  };
  return {
    get: read,
    // Keeps the game's other stored fields (character blips, weather effects) that this reader does not know.
    set(partial) {
      try {
        let stored: Record<string, unknown> = {};
        try { const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); if (raw && typeof raw === 'object') stored = raw; } catch { /* corrupt value */ }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, ...read(), ...partial }));
      } catch { /* session-only */ }
    },
  };
}
