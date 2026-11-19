// Area music rules (runtime.audio.music): one song per area, looped; the same song keeps playing across areas,
// another song cross-fades; an area without music falls back to the older ambience beds. Plain JavaScript so
// node --test checks the rules without a browser.

export const CROSSFADE_SEC = 1.5;
/** Music level under dialogue (about 40 %); the older ambience beds keep their 30 %. */
export const MUSIC_DUCK = 0.4;
export const LEGACY_DUCK = 0.3;

/**
 * What a scene change does to the music.
 * @param {{ url: string } | null | undefined} current  the song playing now
 * @param {{ url: string } | null | undefined} next     the song of the new area (null: none)
 * @returns {'keep' | 'crossfade' | 'start' | 'stop' | 'none'}
 */
export function musicTransition(current, next) {
  if (!next) return current ? 'stop' : 'none';
  if (!current) return 'start';
  return current.url === next.url ? 'keep' : 'crossfade';
}

/** Loop points in seconds, or null to loop the whole file; invalid or reversed points are ignored. */
export function loopPoints(music, duration = Infinity) {
  const start = typeof music?.loopStartSec === 'number' && Number.isFinite(music.loopStartSec) && music.loopStartSec >= 0 && music.loopStartSec < duration
    ? music.loopStartSec : null;
  const end = typeof music?.loopEndSec === 'number' && Number.isFinite(music.loopEndSec) && music.loopEndSec > (start ?? 0)
    ? Math.min(music.loopEndSec, duration) : null;
  return { start, end };
}

/** Music bus level: the player's music volume, ducked while someone talks. */
export function musicBusLevel({ music, talking, hasMusic, level = 2.5 }) {
  const duck = talking ? (hasMusic ? MUSIC_DUCK : LEGACY_DUCK) : 1;
  return music * duck * (hasMusic ? level : 1);
}
