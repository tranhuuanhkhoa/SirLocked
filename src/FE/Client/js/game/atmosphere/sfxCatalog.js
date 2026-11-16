// Where the CC0 sound pack lives (src/FE/public/assets/audio/sfx/, licences in LICENSES.json there) and which file
// each interface cue and each puzzle kind plays. Every file exists as .ogg and .mp3; browsers without Ogg get the mp3.
// Built by src/FE/scripts/build-sfx-pack.mjs. Plain JavaScript: the build script and the unit tests import it too.

export const SFX_ROOT = '/assets/audio/sfx';
export const UI_CUES = /** @type {const} */ (['dialogue', 'discovery', 'reveal', 'scene', 'ping', 'interact', 'error']);
/** The ten interactive kinds (src/BE/Services/PuzzleKinds) and the classic code / sequence / symbol puzzles. */
export const PUZZLE_KINDS = /** @type {const} */ ([
  'balance_scale', 'doc_forgery', 'fingerprint', 'gear_train', 'lockpick', 'music_box',
  'parallax_code', 'reagent_mix', 'tilt_maze', 'torn_paper', 'classic',
]);
/** tap: the player handles the puzzle; probe: a server query (weighing, testing a pin); solve; wrong answer. */
export const PUZZLE_EVENTS = /** @type {const} */ (['tap', 'probe', 'solve', 'wrong']);
/** Kinds that ask the server mid-puzzle have their own probe sound; the others reuse tap. */
export const PUZZLE_PROBE_KINDS = ['balance_scale', 'lockpick'];
/** The earlier sine-wave placeholders, still named by published cases: they now play the CC0 pack. */
const LEGACY_SINE = /^\/assets\/audio\/point-click\/(dialogue|discovery|reveal|scene|ping|interact|error)\.wav$/;
const OWN_SFX = new RegExp(`^${SFX_ROOT.replace(/\//g, '\\/')}\\/(?:[a-z0-9_-]+\\/)*[a-z0-9_.-]+\\.(?:ogg|mp3)$`);

/** Pack file of an interface cue, without extension. */
export const uiCueBase = (cue) => `${SFX_ROOT}/ui/${cue}`;
/** The self-synthesized set of the sample case, kept as a fallback for the CC0 interface cues. */
export const synthCueBase = (cue) => `${SFX_ROOT}/tu-tong-hop/${cue}`;

/** Pack file of a puzzle sound, without extension. Unknown kinds use the classic set. */
export function puzzleSfxBase(kind, event) {
  const known = PUZZLE_KINDS.includes(/** @type {any} */ (kind)) ? kind : 'classic';
  const name = event === 'probe' && !PUZZLE_PROBE_KINDS.includes(known) ? 'tap' : event;
  return `${SFX_ROOT}/puzzle/${known}-${PUZZLE_EVENTS.includes(/** @type {any} */ (name)) ? name : 'tap'}`;
}

/** The two formats of a pack file, best first. */
export function withFormats(base, canPlayOgg = true) {
  return canPlayOgg ? [`${base}.ogg`, `${base}.mp3`] : [`${base}.mp3`];
}

function pathOf(url) {
  try { return new URL(url, 'http://local.invalid').pathname; } catch { return ''; }
}

/**
 * Files to try, in order, for an interface cue a scene names. Empty when the scene names none (the game then
 * synthesizes the cue, as before). After the last file fails the game synthesizes too.
 */
export function cueCandidates(cue, url, canPlayOgg = true) {
  if (!url) return [];
  const path = pathOf(url);
  if (LEGACY_SINE.test(path)) return [...withFormats(uiCueBase(cue), canPlayOgg), url];
  if (OWN_SFX.test(path)) {
    const base = path.replace(/\.(ogg|mp3)$/, '');
    const own = withFormats(base, canPlayOgg);
    return path.startsWith(`${SFX_ROOT}/ui/`) ? [...own, ...withFormats(synthCueBase(cue), canPlayOgg)] : own;
  }
  return [url];
}

/** Synthesized tone used when no file plays for a puzzle event. */
export const PUZZLE_FALLBACK_CUE = { tap: 'interact', probe: 'interact', solve: 'reveal', wrong: 'error' };
