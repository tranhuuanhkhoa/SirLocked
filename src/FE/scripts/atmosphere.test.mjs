// Unit tests of the sound and weather rules (VUAN-4). Plain node --test: the rules live in plain JavaScript modules
// that the game, the build script and the studio tools share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blipPlan, blipDuration, defaultBlipVoice, encodeWav, hashString, renderBlips, resolveBlipVoice, seededRandom,
  BLIP_LIMITS, PUNCTUATION_PAUSE,
} from '../Client/js/game/atmosphere/blipCore.js';
import {
  createFpsGovernor, createLightning, effectiveWeather, initialQuality, normalizeWeather, particleCount, seedParticles,
  stepParticles, thunderDelayMs, timeOfDayTint, weatherGain, TIME_TINTS,
} from '../Client/js/game/atmosphere/weatherCore.js';
import { loopPoints, musicBusLevel, musicTransition, MUSIC_DUCK, LEGACY_DUCK } from '../Client/js/game/atmosphere/musicCore.js';
import {
  cueCandidates, puzzleSfxBase, withFormats, PUZZLE_KINDS, PUZZLE_PROBE_KINDS, UI_CUES,
} from '../Client/js/game/atmosphere/sfxCatalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, '..', 'public');
const sample = { pitch: 520, speed: 24, wave: 'sine', variance: 0.25 };

// ---------------------------------------------------------------- blips
test('blip plan skips spaces and punctuation, and punctuation holds the line longer', () => {
  const voice = resolveBlipVoice('char-a', { blip: sample });
  const plan = blipPlan('Ai đó, tối qua.', voice);
  const letterMs = 1000 / 24;
  for (const step of plan) {
    if (step.char === ' ') { assert.equal(step.blip, false); assert.equal(step.delayMs, letterMs); }
    else if (step.char === ',' || step.char === '.') { assert.equal(step.blip, false); assert.equal(step.delayMs, letterMs * PUNCTUATION_PAUSE); }
    else { assert.equal(step.blip, true); assert.ok(step.pitch > 0); }
  }
  assert.equal(plan.filter((step) => step.blip).length, 'Aiđótốiqua'.length);
  assert.equal(plan.at(-1).end, 'Ai đó, tối qua.'.length);
});

test('blip pitch wanders within variance, seeded by the character: same line same melody, other character other melody', () => {
  const a = resolveBlipVoice('char-a', { blip: sample });
  const b = resolveBlipVoice('char-b', { blip: sample });
  const line = 'Tôi chỉ đứng ngoài hiên suốt buổi tối';
  const pitches = (voice) => blipPlan(line, voice).filter((step) => step.blip).map((step) => step.pitch);
  assert.deepEqual(pitches(a), pitches(resolveBlipVoice('char-a', { blip: sample })));
  assert.notDeepEqual(pitches(a), pitches(b));
  for (const pitch of pitches(a)) assert.ok(Math.abs(pitch - 520) <= 520 * 0.25 / 2 + 0.01, String(pitch));
  const flat = resolveBlipVoice('char-a', { blip: { ...sample, variance: 0 } });
  assert.ok(pitches(flat).every((pitch) => pitch === 520));
  assert.deepEqual([seededRandom(7)(), seededRandom(7)()], [seededRandom(7)(), seededRandom(7)()]);
});

test('a character without voice.blip gets a stable default made from its id, in range', () => {
  const first = resolveBlipVoice('char-px-ly-hanh', undefined);
  assert.deepEqual(first, resolveBlipVoice('char-px-ly-hanh', null));
  assert.deepEqual(first, defaultBlipVoice('char-px-ly-hanh'));
  assert.equal(first.authored, false);
  const other = resolveBlipVoice('char-px-ong-ba', {});
  assert.notDeepEqual([first.pitch, first.speed, first.wave], [other.pitch, other.speed, other.wave]);
  for (const id of ['a', 'b', 'char-x', 'nhân-vật-1', '']) {
    const voice = defaultBlipVoice(id);
    assert.ok(voice.pitch >= BLIP_LIMITS.pitch[0] && voice.pitch <= BLIP_LIMITS.pitch[1]);
    assert.ok(voice.speed >= BLIP_LIMITS.speed[0] && voice.speed <= BLIP_LIMITS.speed[1]);
    assert.ok(['square', 'triangle', 'sine', 'sawtooth'].includes(voice.wave));
    assert.ok(voice.variance >= 0 && voice.variance <= 1);
  }
  assert.equal(hashString('abc'), hashString('abc'));
});

test('authored voices are clamped field by field; a bad field falls back to the default', () => {
  const voice = resolveBlipVoice('char-a', { blip: { pitch: 5000, speed: 2, wave: 'NOISE', variance: -1 } });
  const fallback = defaultBlipVoice('char-a');
  assert.equal(voice.pitch, 1200);
  assert.equal(voice.speed, 10);
  assert.equal(voice.wave, fallback.wave);
  assert.equal(voice.variance, 0);
  assert.equal(voice.authored, true);
  assert.equal(resolveBlipVoice('char-a', { blip: { wave: 'Square' } }).wave, 'square');
});

test('decomposed accents add no time and no blip; blips never overlap at full speed', () => {
  const voice = resolveBlipVoice('char-a', { blip: { ...sample, speed: 40 } });
  const plan = blipPlan('tói', voice);
  assert.deepEqual(plan.map((step) => [step.blip, step.delayMs]), [[true, 25], [true, 25], [false, 0], [true, 25]]);
  assert.ok(blipDuration(voice) <= 1 / 40 + 1e-9 || blipDuration(voice) === 0.025);
  assert.ok(blipDuration(resolveBlipVoice('x', { blip: { ...sample, speed: 10 } })) <= 0.075);
});

test('offline blip render (blip_preview) is deterministic, audible and a valid WAV', () => {
  const voice = resolveBlipVoice('char-dh-co-hanh', { blip: sample });
  const plan = blipPlan('Tối nay tôi bán hoa ở bến.', voice);
  const a = renderBlips(plan, voice), b = renderBlips(plan, voice);
  assert.deepEqual(a, b);
  const peak = a.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(peak > 0.1 && peak <= 1, String(peak));
  const wav = encodeWav(a, 22050);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(wav.length, 44 + a.length * 2);
});

// ---------------------------------------------------------------- music
test('music changes: same song keeps playing, another song cross-fades, no music falls back', () => {
  const harbor = { url: '/assets/audio/music/hang-duong/ben-cang-dem-mua.ogg' };
  const shop = { url: '/assets/audio/music/hang-duong/tiem-dong-ho.ogg' };
  assert.equal(musicTransition(harbor, { ...harbor }), 'keep');
  assert.equal(musicTransition(harbor, shop), 'crossfade');
  assert.equal(musicTransition(null, shop), 'start');
  assert.equal(musicTransition(harbor, null), 'stop');
  assert.equal(musicTransition(null, null), 'none');
  assert.deepEqual(loopPoints({ loopStartSec: 0, loopEndSec: 50.526 }), { start: 0, end: 50.526 });
  assert.deepEqual(loopPoints({ loopStartSec: 10, loopEndSec: 5 }), { start: 10, end: null });
  assert.deepEqual(loopPoints({}), { start: null, end: null });
  assert.deepEqual(loopPoints({ loopStartSec: 2, loopEndSec: 99 }, 40), { start: 2, end: 40 });
});

test('dialogue ducks music to 40 % and the older beds to 30 % as before', () => {
  assert.equal(MUSIC_DUCK, 0.4);
  assert.equal(LEGACY_DUCK, 0.3);
  assert.equal(musicBusLevel({ music: 0.2, talking: false, hasMusic: false }), 0.2);
  assert.ok(Math.abs(musicBusLevel({ music: 0.2, talking: true, hasMusic: false }) - 0.06) < 1e-9);
  const full = musicBusLevel({ music: 0.5, talking: false, hasMusic: true, level: 2 });
  const ducked = musicBusLevel({ music: 0.5, talking: true, hasMusic: true, level: 2 });
  assert.ok(Math.abs(ducked / full - 0.4) < 1e-9);
});

// ---------------------------------------------------------------- weather
test('weather is off indoors, off when the player turns it off, off for older cases without the field', () => {
  const rain = { type: 'RAIN', intensity: 0.7 };
  assert.deepEqual(effectiveWeather({ weather: rain, indoor: false }), { type: 'RAIN', intensity: 0.7 });
  assert.equal(effectiveWeather({ weather: rain, indoor: true }).type, 'NONE');
  assert.equal(effectiveWeather({ weather: rain }, false).type, 'NONE');
  assert.equal(effectiveWeather({}).type, 'NONE');
  assert.equal(effectiveWeather(undefined).type, 'NONE');
  assert.equal(effectiveWeather({ weather: { type: 'NONE', intensity: 1 } }).type, 'NONE');
  assert.equal(effectiveWeather({ weather: { type: 'HAIL', intensity: 1 } }).type, 'NONE');
  assert.deepEqual(normalizeWeather({ type: 'storm', intensity: 4 }), { type: 'STORM', intensity: 1 });
  assert.equal(weatherGain({ type: 'NONE', intensity: 0 }), 0);
  assert.ok(weatherGain({ type: 'STORM', intensity: 1 }) > weatherGain({ type: 'RAIN', intensity: 0.2 }));
});

test('time of day tints sprites only at night and dusk', () => {
  assert.equal(timeOfDayTint({ timeOfDay: 'NIGHT' }), TIME_TINTS.NIGHT);
  assert.equal(timeOfDayTint({ timeOfDay: 'DUSK' }), TIME_TINTS.DUSK);
  assert.equal(timeOfDayTint({ timeOfDay: 'DAY' }), null);
  assert.equal(timeOfDayTint({}), null);
});

test('particles scale with intensity and quality: half, then a quarter', () => {
  const full = particleCount('RAIN', 1, 1);
  assert.equal(particleCount('RAIN', 1, 0.5), Math.round(full / 2));
  assert.equal(particleCount('RAIN', 1, 0.25), Math.round(full / 4));
  assert.ok(particleCount('STORM', 1, 1) > full);
  assert.ok(particleCount('RAIN', 0.2, 1) < full);
  assert.equal(particleCount('NONE', 1, 1), 0);
});

test('low frame rate in the first seconds halves the particles, then quarters them; good frame rate keeps them', () => {
  const slow = createFpsGovernor({ quality: 1, windowMs: 1000, maxWindows: 4 });
  const drops = [];
  for (let i = 0; i < 4 * 40; i++) { const next = slow.sample(1000 / 24); if (next !== null) drops.push(next); }
  assert.deepEqual(drops, [0.5, 0.25]);
  assert.equal(slow.quality, 0.25);
  assert.equal(slow.measuring, false);
  assert.equal(slow.history[0].fps, 24);
  const fast = createFpsGovernor({ quality: 1, windowMs: 1000 });
  for (let i = 0; i < 400; i++) assert.equal(fast.sample(1000 / 60), null);
  assert.equal(fast.quality, 1);
  // Long single frames (a texture load, a hidden tab) are ignored, not counted as slow.
  const hitch = createFpsGovernor({ quality: 1, windowMs: 1000 });
  for (let i = 0; i < 120; i++) hitch.sample(i % 10 === 0 ? 600 : 1000 / 60);
  assert.equal(hitch.quality, 1);
});

test('small screens with few cores start with fewer particles', () => {
  assert.equal(initialQuality({ width: 1920, height: 1080, cores: 8 }), 1);
  assert.equal(initialQuality({ width: 390, height: 844, cores: 4 }), 0.5);
  assert.equal(initialQuality({ width: 390, height: 844, cores: 8 }), 1);
  assert.equal(initialQuality({ width: 390, height: 844, cores: 2 }), 0.25);
  assert.equal(initialQuality({ width: 1366, height: 768, cores: 2 }), 0.5);
});

test('storm lightning: thunder 1–3 s after the flash, bolts 6–12 s apart, never continuous', () => {
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lightning = createLightning(random, 0);
  assert.ok(lightning.nextAt >= 2000 && lightning.nextAt <= 5000);
  const bolts = [];
  for (let now = 0; now <= 120_000; now += 16) { const bolt = lightning.poll(now); if (bolt) bolts.push(bolt); }
  assert.ok(bolts.length >= 9 && bolts.length <= 21, String(bolts.length));
  for (let i = 1; i < bolts.length; i++) {
    const gap = bolts[i].at - bolts[i - 1].at;
    assert.ok(gap >= 6000 && gap <= 12_016, String(gap));
  }
  for (const bolt of bolts) assert.ok(bolt.thunderDelayMs >= 1000 && bolt.thunderDelayMs <= 3000);
  assert.equal(thunderDelayMs(() => 0), 1000);
  assert.equal(thunderDelayMs(() => 0.9999999), 3000);
});

test('particles stay on the view and rain splashes on the ground', () => {
  const random = seededRandom(3);
  for (const type of ['RAIN', 'STORM', 'SNOW', 'WIND']) {
    const particles = seedParticles(type, 50, 200, 120, random);
    const splashes = [];
    for (let i = 0; i < 300; i++) stepParticles(type, particles, splashes, 1 / 60, 200, 120, random);
    for (const q of particles) {
      assert.ok(q.x > -20 && q.x < 260, `${type} x ${q.x}`);
      assert.ok(q.y > -30 && q.y < 130, `${type} y ${q.y}`);
    }
    if (type === 'RAIN' || type === 'STORM') assert.ok(splashes.length > 0);
    else assert.equal(splashes.length, 0);
  }
});

// ---------------------------------------------------------------- CC0 sound pack
test('published cases that name the old sine cues get the CC0 pack, with the old file last', () => {
  assert.deepEqual(cueCandidates('discovery', '/assets/audio/point-click/discovery.wav'),
    ['/assets/audio/sfx/ui/discovery.ogg', '/assets/audio/sfx/ui/discovery.mp3', '/assets/audio/point-click/discovery.wav']);
  assert.deepEqual(cueCandidates('discovery', '/assets/audio/point-click/discovery.wav', false),
    ['/assets/audio/sfx/ui/discovery.mp3', '/assets/audio/point-click/discovery.wav']);
  // The sample case names the CC0 pack; its self-synthesized set is the fallback.
  assert.deepEqual(cueCandidates('scene', '/assets/audio/sfx/ui/scene.ogg'),
    ['/assets/audio/sfx/ui/scene.ogg', '/assets/audio/sfx/ui/scene.mp3', '/assets/audio/sfx/tu-tong-hop/scene.ogg', '/assets/audio/sfx/tu-tong-hop/scene.mp3']);
  assert.deepEqual(cueCandidates('scene', 'https://res.cloudinary.com/x/y.ogg'), ['https://res.cloudinary.com/x/y.ogg']);
  assert.deepEqual(cueCandidates('scene', ''), []);
  assert.deepEqual(cueCandidates('scene', undefined), []);
  assert.equal(puzzleSfxBase('lockpick', 'probe'), '/assets/audio/sfx/puzzle/lockpick-probe');
  assert.equal(puzzleSfxBase('fingerprint', 'probe'), '/assets/audio/sfx/puzzle/fingerprint-tap');
  assert.equal(puzzleSfxBase('unknown_kind', 'solve'), '/assets/audio/sfx/puzzle/classic-solve');
  assert.deepEqual(withFormats('/a/b'), ['/a/b.ogg', '/a/b.mp3']);
});

test('every cue and every puzzle kind has its files, each listed CC0 in LICENSES.json, under 3 MB in all', () => {
  const licenses = JSON.parse(readFileSync(path.join(publicRoot, 'assets/audio/sfx/LICENSES.json'), 'utf8'));
  const listed = new Map(licenses.sfx.map((entry) => [entry.file, entry]));
  const needed = [
    ...UI_CUES.map((cue) => `/assets/audio/sfx/ui/${cue}`),
    ...PUZZLE_KINDS.flatMap((kind) => ['tap', 'solve', 'wrong', ...(PUZZLE_PROBE_KINDS.includes(kind) ? ['probe'] : [])]
      .map((event) => puzzleSfxBase(kind, event))),
  ];
  assert.equal(PUZZLE_KINDS.length, 11);
  for (const base of needed) {
    for (const file of withFormats(base)) assert.ok(existsSync(path.join(publicRoot, file)), file);
    const entry = listed.get(`${base}.ogg`);
    assert.ok(entry, `${base} not in LICENSES.json`);
    assert.match(entry.license, /^CC0/);
    assert.match(entry.link, /^https:\/\/kenney\.nl\//);
  }
  // Each kind has its own tap and solve sounds.
  const tapSources = PUZZLE_KINDS.map((kind) => listed.get(`${puzzleSfxBase(kind, 'tap')}.ogg`).sourceFile);
  assert.equal(new Set(tapSources).size, PUZZLE_KINDS.length);
  for (const cue of UI_CUES) assert.ok(existsSync(path.join(publicRoot, `assets/audio/sfx/tu-tong-hop/${cue}.ogg`)), cue);
  let total = 0;
  const walk = (dir) => { for (const name of readdirSync(dir)) { const full = path.join(dir, name); if (statSync(full).isDirectory()) walk(full); else total += statSync(full).size; } };
  walk(path.join(publicRoot, 'assets/audio/sfx'));
  assert.ok(total <= 3 * 1024 * 1024, String(total));
});
