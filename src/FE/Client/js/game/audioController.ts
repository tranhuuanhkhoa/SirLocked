import { BLIP_ENVELOPE, MAX_BLIP_VOICES, type ResolvedBlipVoice } from './atmosphere/blipCore.js';
import { effectiveWeather, weatherGain, WEATHER_SOUND, NONE as NO_WEATHER, type Weather } from './atmosphere/weatherCore.js';
import { cueCandidates, puzzleSfxBase, withFormats, PUZZLE_FALLBACK_CUE } from './atmosphere/sfxCatalog.js';
import { CROSSFADE_SEC, LEGACY_DUCK, loopPoints, musicBusLevel, musicTransition } from './atmosphere/musicCore.js';
import { renderMusicCredits } from './musicCredits.js';

/** `blips` is the character speech volume; `weatherEffects` false turns weather sound and particles off. */
export type AudioSettings = { music: number; effects: number; muted: boolean; blips: number; weatherEffects: boolean };
export type AudioCue = 'dialogue' | 'discovery' | 'reveal' | 'scene' | 'ping' | 'interact' | 'error';
export type PuzzleSoundEvent = 'tap' | 'probe' | 'solve' | 'wrong';
/** runtime.audio.music of a scene (docs/case-audio-weather.md). */
export type SceneMusic = {
  url: string; fallbackUrl?: string; title?: string; source?: string; license?: string;
  loopStartSec?: number | null; loopEndSec?: number | null; volume?: number;
};
export type SceneAudio = { ambienceUrl?: string; cues?: Partial<Record<AudioCue, string>>; music?: SceneMusic | null };
export type SceneWeatherInput = { type?: string; intensity?: number } | null | undefined;

const key = 'sirlocked.audio.v1';
const defaults: AudioSettings = { music: .2, effects: .35, muted: false, blips: .5, weatherEffects: true };
/** Authored music tracks are mastered louder than the quiet sine beds the music slider was tuned for. */
const MUSIC_LEVEL = 2.5;
const MUSIC_CACHE_LIMIT = 4;
const clamp = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
export function normalizeAudioSettings(value: Partial<AudioSettings> = {}): AudioSettings {
  return {
    music: clamp(value?.music, defaults.music), effects: clamp(value?.effects, defaults.effects),
    muted: typeof value?.muted === 'boolean' ? value.muted : defaults.muted,
    blips: clamp(value?.blips, defaults.blips),
    weatherEffects: typeof value?.weatherEffects === 'boolean' ? value.weatherEffects : defaults.weatherEffects,
  };
}
export function audioAssetUrl(value?: string): string {
  if (!value) return '';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.includes('\\') || decoded.startsWith('//') || /(^|\/)\.\.(\/|$)/.test(decoded)) return '';
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  }
  catch { return ''; }
}

type MusicTrack = { url: string; fallbackUrl: string; loopStart: number | null; loopEnd: number | null; volume: number };
type PlayingTrack = { track: MusicTrack; source: AudioBufferSourceNode; gain: GainNode };

/** A scene's music, or null when it has none or names an unsafe URL. Same quiet default volume as the doc. */
export function sceneMusicTrack(music: SceneMusic | null | undefined): MusicTrack | null {
  if (!music || typeof music !== 'object') return null;
  const url = audioAssetUrl(music.url);
  if (!url) return null;
  const { start, end } = loopPoints(music);
  return { url, fallbackUrl: audioAssetUrl(music.fallbackUrl), loopStart: start, loopEnd: end, volume: clamp(music.volume, .5) };
}
export { musicTransition };

export function createAudioController() {
  let settings = { ...defaults };
  try { settings = normalizeAudioSettings(JSON.parse(localStorage.getItem(key) || '{}')); } catch { /* Storage may be disabled. */ }
  let context: AudioContext | undefined;
  let musicGain: GainNode | undefined;
  let effectsGain: GainNode | undefined;
  let blipGain: GainNode | undefined;
  let ambience: HTMLAudioElement | undefined;
  const pendingPlayback = new WeakSet<HTMLAudioElement>();
  const activeEffects = new Set<HTMLAudioElement>();
  const activeTones = new Set<{ tone: OscillatorNode; gain: GainNode }>();
  let drone: OscillatorNode | undefined;
  let droneGain: GainNode | undefined;
  let activeScene = '';
  let currentUrl = '';
  let sceneRevision = 0;
  let cueUrls: SceneAudio['cues'] = {};
  let unlocked = false;
  let talking = false;
  let disposed = false;
  // Music of the area: decoded once per file (lazily, when an area that uses it is entered) and looped seamlessly.
  let musicWanted: MusicTrack | null = null;
  let musicPlaying: PlayingTrack | null = null;
  const musicFading = new Set<PlayingTrack>();
  const musicBuffers = new Map<string, Promise<AudioBuffer | null>>();
  const musicFailed = new Set<string>();
  let musicRevision = 0;
  // Weather bed: filtered noise, one graph at a time; thunder bursts are scheduled on the audio clock.
  let weatherInput: { weather: SceneWeatherInput; indoor: boolean } = { weather: null, indoor: false };
  let weatherNow: Weather = NO_WEATHER;
  let weatherGraph: { source: AudioBufferSourceNode; highpass: BiquadFilterNode; lowpass: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode; type: string } | null = null;
  let weatherBus: GainNode | undefined;
  let noiseBuffer: AudioBuffer | undefined;
  const thunders = new Set<{ source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }>();
  // Speech blips.
  const activeBlips = new Set<{ tone: OscillatorNode; gain: GainNode }>();
  const counters = { blips: 0, blipsDropped: 0, thunders: 0, crossfades: 0, sfxFiles: 0 };
  const recentBlips: { characterId: string; wave: string; pitch: number }[] = [];
  let canPlayOgg = true;
  // A detached <audio> element answers the question without creating a media player of the game's own.
  try { canPlayOgg = Boolean(document.createElement('audio').canPlayType?.('audio/ogg; codecs="vorbis"')); } catch { canPlayOgg = true; }
  const cues: Record<AudioCue, number[]> = { dialogue: [330], discovery: [392, 523.25], reveal: [261.63, 329.63, 392], scene: [196], ping: [440, 554.37], interact: [294], error: [220, 196] };
  const audible = () => unlocked && !disposed && !settings.muted && !document.hidden;
  const running = () => Boolean(context && context.state === 'running');
  function releaseMedia(media: HTMLAudioElement) {
    media.onended = null; media.onerror = null; media.pause(); media.removeAttribute('src'); media.load();
  }
  function stopEffects() {
    for (const effect of activeEffects) releaseMedia(effect);
    activeEffects.clear();
    for (const { tone, gain } of activeTones) {
      tone.onended = null;
      try { tone.stop(); } catch { /* Already ended. */ }
      tone.disconnect(); gain.disconnect();
    }
    activeTones.clear();
  }
  function synthCue(cue: AudioCue, revision: number) {
    if (!audible() || revision !== sceneRevision || !context || !effectsGain || context.state !== 'running') return;
    cues[cue].forEach((frequency, index) => {
      const tone = context!.createOscillator(), gain = context!.createGain();
      const entry = { tone, gain }; activeTones.add(entry);
      const at = context!.currentTime + index * .09;
      tone.type = 'sine'; tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.09, at + .015);
      gain.gain.exponentialRampToValueAtTime(.001, at + .18);
      tone.connect(gain).connect(effectsGain!); tone.start(at); tone.stop(at + .2);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); activeTones.delete(entry); };
    });
  }
  /** Plays the first file that loads; when none does, the synthesized cue. */
  function playFiles(candidates: string[], fallbackCue: AudioCue) {
    const revision = sceneRevision;
    const urls = candidates.map((url) => audioAssetUrl(url)).filter(Boolean);
    if (!urls.length) { synthCue(fallbackCue, revision); return; }
    const attempt = (index: number) => {
      if (disposed || revision !== sceneRevision) return;
      if (index >= urls.length) { synthCue(fallbackCue, revision); return; }
      if (activeEffects.size >= 6) { const oldest = activeEffects.values().next().value; if (oldest) { releaseMedia(oldest); activeEffects.delete(oldest); } }
      const effect = new Audio(urls[index]); effect.preload = 'none'; effect.volume = settings.effects;
      activeEffects.add(effect);
      const finish = () => { if (!activeEffects.delete(effect)) return; releaseMedia(effect); };
      const next = () => { if (!activeEffects.has(effect)) return; finish(); attempt(index + 1); };
      effect.onended = finish; effect.onerror = next;
      try {
        void Promise.resolve(effect.play()).then(() => {
          if (!activeEffects.has(effect)) { releaseMedia(effect); return; }
          counters.sfxFiles++;
          if (!audible() || revision !== sceneRevision) finish();
        }).catch(next);
      } catch { next(); }
    };
    attempt(0);
  }
  function startAmbience(media: HTMLAudioElement) {
    if (!audible() || ambience !== media || !media.paused || pendingPlayback.has(media)) return;
    pendingPlayback.add(media);
    let started = false;
    try {
      void Promise.resolve(media.play()).then(() => {
        started = true;
        if (!audible() || ambience !== media) media.pause();
      }).catch((error) => {
        if (disposed || ambience !== media || error?.name === 'NotAllowedError' || error?.name === 'AbortError') return;
        fallbackBed(media);
      }).finally(() => {
        pendingPlayback.delete(media);
        // A hide/show or mute/unmute can occur before the first play promise settles.
        if (started && audible() && ambience === media && media.paused && settings.music > 0) startAmbience(media);
      });
    } catch { pendingPlayback.delete(media); fallbackBed(media); }
  }
  const musicMode = () => Boolean(musicWanted && !musicFailed.has(musicWanted.url));
  function musicLevel() {
    return audible() ? musicBusLevel({ music: settings.music, talking, hasMusic: musicMode(), level: MUSIC_LEVEL }) : 0;
  }
  function apply() {
    if (disposed) return;
    const enabled = audible();
    const volume = enabled ? settings.music * (talking ? LEGACY_DUCK : 1) : 0;
    if (musicGain && context) musicGain.gain.setTargetAtTime(musicLevel(), context.currentTime, .12);
    if (effectsGain && context) effectsGain.gain.setTargetAtTime(enabled ? settings.effects : 0, context.currentTime, .02);
    if (blipGain && context) blipGain.gain.setTargetAtTime(enabled ? settings.blips : 0, context.currentTime, .02);
    if (ambience) { ambience.volume = volume; if (!enabled || settings.music === 0) ambience.pause(); else startAmbience(ambience); }
    for (const effect of activeEffects) effect.volume = enabled ? settings.effects : 0;
    if (!enabled || settings.effects === 0) stopEffects();
    syncWeather();
  }
  function startBed() {
    if (!audible() || !context || context.state !== 'running' || !musicGain || !activeScene || ambience || drone || musicMode()) return;
    drone = context.createOscillator();
    droneGain = context.createGain();
    let hash = 0;
    for (const character of activeScene) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    drone.type = 'sine';
    drone.frequency.value = [65.41, 73.42, 82.41][hash % 3];
    droneGain.gain.value = .06;
    drone.connect(droneGain).connect(musicGain);
    drone.start();
  }
  function stopBed() {
    try { drone?.stop(); } catch { /* Already stopped. */ }
    drone?.disconnect(); droneGain?.disconnect(); drone = undefined; droneGain = undefined;
    if (ambience) { releaseMedia(ambience); ambience = undefined; }
  }
  function fallbackBed(media: HTMLAudioElement) {
    if (disposed || ambience !== media) return;
    releaseMedia(media); ambience = undefined; startBed(); apply();
  }

  // ------------------------------------------------------------------ music
  async function decode(url: string): Promise<AudioBuffer | null> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    return await new Promise<AudioBuffer>((resolve, reject) => {
      const result = context!.decodeAudioData(data, resolve, reject);
      if (result && typeof (result as Promise<AudioBuffer>).then === 'function') (result as Promise<AudioBuffer>).then(resolve, reject);
    });
  }
  /** Decoded buffer of a track, Ogg first when the browser plays it, else the mp3; cached (a few tracks at most). */
  function loadTrack(track: MusicTrack): Promise<AudioBuffer | null> {
    const cached = musicBuffers.get(track.url);
    if (cached) { musicBuffers.delete(track.url); musicBuffers.set(track.url, cached); return cached; }
    const order = [track.url, track.fallbackUrl].filter(Boolean);
    if (!canPlayOgg && track.fallbackUrl) order.reverse();
    const promise = (async () => {
      for (const url of order) {
        try { return await decode(url); } catch { /* try the other format */ }
      }
      return null;
    })();
    musicBuffers.set(track.url, promise);
    while (musicBuffers.size > MUSIC_CACHE_LIMIT) {
      const oldest = musicBuffers.keys().next().value as string;
      if (oldest === track.url || oldest === musicPlaying?.track.url) break;
      musicBuffers.delete(oldest);
    }
    return promise;
  }
  function fadeOut(playing: PlayingTrack, seconds = CROSSFADE_SEC) {
    if (!context) return;
    musicFading.add(playing);
    const now = context.currentTime;
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + seconds);
    try { playing.source.stop(now + seconds + .05); } catch { /* already stopped */ }
    playing.source.onended = () => { playing.source.disconnect(); playing.gain.disconnect(); musicFading.delete(playing); };
  }
  function stopMusicNow() {
    for (const playing of [...musicFading, ...(musicPlaying ? [musicPlaying] : [])]) {
      playing.source.onended = null;
      try { playing.source.stop(); } catch { /* already stopped */ }
      playing.source.disconnect(); playing.gain.disconnect();
    }
    musicFading.clear();
    musicPlaying = null;
  }
  function syncMusic() {
    if (disposed || !context || !musicGain || !unlocked) return;
    const wanted = musicMode() ? musicWanted : null;
    const change = musicTransition(musicPlaying?.track ?? null, wanted);
    if (change === 'none') return;
    if (change === 'stop') { fadeOut(musicPlaying!); musicPlaying = null; return; }
    if (change === 'keep') {
      // Same song in the next area: keep playing; only an authored volume change moves its level (never mid fade-in).
      const volumeChanged = musicPlaying!.track.volume !== wanted!.volume;
      musicPlaying!.track = wanted!;
      if (volumeChanged) musicPlaying!.gain.gain.setTargetAtTime(wanted!.volume, context.currentTime, .3);
      return;
    }
    const revision = ++musicRevision;
    const track = wanted!;
    void loadTrack(track).then((buffer) => {
      if (disposed || !context || !musicGain || revision !== musicRevision || musicWanted?.url !== track.url) return;
      if (!buffer) {
        // Neither format decodes: this area falls back to the older bed, as a case without music.
        musicFailed.add(track.url);
        if (musicPlaying) { fadeOut(musicPlaying); musicPlaying = null; }
        if (currentUrl && !ambience) {
          ambience = new Audio(currentUrl); ambience.loop = true; ambience.preload = 'none';
          const media = ambience; media.onerror = () => fallbackBed(media);
        }
        startBed(); apply();
        return;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      if (track.loopStart !== null && track.loopStart < buffer.duration) source.loopStart = track.loopStart;
      if (track.loopEnd !== null && track.loopEnd <= buffer.duration + .01) source.loopEnd = Math.min(track.loopEnd, buffer.duration);
      const gain = context.createGain();
      const now = context.currentTime;
      const previous = musicPlaying;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(track.volume, now + (previous ? CROSSFADE_SEC : .4));
      source.connect(gain).connect(musicGain);
      source.start(now, track.loopStart ?? 0);
      musicPlaying = { track, source, gain };
      if (previous) { counters.crossfades++; fadeOut(previous); }
    });
  }

  // ------------------------------------------------------------------ weather
  function noise(): AudioBuffer {
    if (noiseBuffer) return noiseBuffer;
    const seconds = 2.5;
    noiseBuffer = context!.createBuffer(1, Math.floor(context!.sampleRate * seconds), context!.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }
  function stopThunders() {
    for (const thunder of thunders) {
      thunder.source.onended = null;
      try { thunder.source.stop(); } catch { /* not started yet or done */ }
      thunder.source.disconnect(); thunder.filter.disconnect(); thunder.gain.disconnect();
    }
    thunders.clear();
  }
  function stopWeatherGraph(fadeSec: number) {
    if (!weatherGraph || !context) return;
    const graph = weatherGraph;
    weatherGraph = null;
    const now = context.currentTime;
    graph.gain.gain.cancelScheduledValues(now);
    graph.gain.gain.setValueAtTime(graph.gain.gain.value, now);
    graph.gain.gain.linearRampToValueAtTime(0, now + fadeSec);
    try { graph.source.stop(now + fadeSec + .02); graph.lfo.stop(now + fadeSec + .02); } catch { /* stopped */ }
    graph.source.onended = () => {
      for (const node of [graph.source, graph.highpass, graph.lowpass, graph.gain, graph.lfo, graph.lfoGain]) node.disconnect();
    };
  }
  function syncWeather() {
    if (disposed) return;
    weatherNow = effectiveWeather({ weather: weatherInput.weather, indoor: weatherInput.indoor }, settings.weatherEffects);
    const wanted = audible() && settings.effects > 0 && weatherNow.type !== 'NONE' ? weatherNow : NO_WEATHER;
    if (wanted.type !== 'STORM') stopThunders();
    if (wanted.type === 'NONE') { stopWeatherGraph(.12); return; }
    if (!context || !effectsGain || !running()) return;
    if (!weatherBus) { weatherBus = context.createGain(); weatherBus.connect(effectsGain); }
    const profile = WEATHER_SOUND[wanted.type as keyof typeof WEATHER_SOUND];
    const now = context.currentTime;
    if (!weatherGraph) {
      const source = context.createBufferSource(); source.buffer = noise(); source.loop = true;
      const highpass = context.createBiquadFilter(); highpass.type = 'highpass';
      const lowpass = context.createBiquadFilter(); lowpass.type = 'lowpass';
      const gain = context.createGain(); gain.gain.value = 0;
      const lfo = context.createOscillator(); const lfoGain = context.createGain();
      lfo.connect(lfoGain).connect(lowpass.frequency);
      source.connect(highpass).connect(lowpass).connect(gain).connect(weatherBus);
      source.start(); lfo.start();
      weatherGraph = { source, highpass, lowpass, gain, lfo, lfoGain, type: wanted.type };
      highpass.frequency.value = profile.highpass; lowpass.frequency.value = profile.lowpass;
    }
    weatherGraph.type = wanted.type;
    weatherGraph.highpass.frequency.setTargetAtTime(profile.highpass, now, .3);
    weatherGraph.lowpass.frequency.setTargetAtTime(profile.lowpass, now, .3);
    weatherGraph.lfo.frequency.setTargetAtTime(profile.lfoRate, now, .3);
    weatherGraph.lfoGain.gain.setTargetAtTime(profile.lfoDepth, now, .3);
    weatherGraph.gain.gain.setTargetAtTime(weatherGain(wanted), now, .6);
  }
  /** A thunder clap `delayMs` after a lightning flash (storms only), on the audio clock. */
  function thunder(delayMs: number) {
    if (!audible() || !context || !effectsGain || !running() || weatherNow.type !== 'STORM' || settings.effects === 0) return false;
    if (!weatherBus) { weatherBus = context.createGain(); weatherBus.connect(effectsGain); }
    const at = context.currentTime + Math.min(3, Math.max(0, delayMs / 1000));
    const source = context.createBufferSource(); source.buffer = noise(); source.loop = true; source.playbackRate.value = .6;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 170;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(.9 * (.5 + .5 * weatherNow.intensity), at + .15);
    gain.gain.exponentialRampToValueAtTime(.001, at + 3.6);
    source.connect(filter).connect(gain).connect(weatherBus);
    source.start(at); source.stop(at + 3.8);
    const entry = { source, gain, filter };
    thunders.add(entry);
    counters.thunders++;
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); thunders.delete(entry); };
    return true;
  }

  function resume() {
    if (disposed || !unlocked || document.hidden) return;
    apply();
    if (context) void context.resume().then(() => {
      if (disposed) return;
      if (document.hidden) { void context?.suspend().catch(() => {}); return; }
      startBed(); apply(); syncMusic();
    }).catch(() => {});
  }
  const visibility = () => {
    if (disposed) return;
    if (document.hidden) { apply(); void context?.suspend().catch(() => {}); }
    else resume();
  };
  document.addEventListener('visibilitychange', visibility);
  return {
    unlock() {
      if (disposed) return;
      unlocked = true;
      try {
        if (!context) {
          context = new AudioContext();
          musicGain = context.createGain(); effectsGain = context.createGain(); blipGain = context.createGain();
          musicGain.connect(context.destination); effectsGain.connect(context.destination); blipGain.connect(context.destination);
        }
      } catch { /* Audio is optional on devices without Web Audio. */ }
      // Start HTML media during the gesture and re-apply state after Web Audio resumes.
      resume();
      syncMusic();
    },
    play(cue: AudioCue) {
      if (!audible() || settings.effects === 0) return;
      const candidates = cueCandidates(cue, cueUrls?.[cue], canPlayOgg);
      if (!candidates.length) { synthCue(cue, sceneRevision); return; }
      playFiles(candidates, cue);
    },
    /** A puzzle sound from the CC0 pack: each kind has its own tap, solve and wrong sounds. */
    puzzle(kind: string, event: PuzzleSoundEvent) {
      if (!audible() || settings.effects === 0) return;
      playFiles(withFormats(puzzleSfxBase(kind, event), canPlayOgg), PUZZLE_FALLBACK_CUE[event] as AudioCue ?? 'interact');
    },
    setScene(sceneId: string, audio: SceneAudio | string = {}) {
      if (disposed) return;
      const config = typeof audio === 'string' ? { ambienceUrl: audio } : audio ?? {};
      cueUrls = Object.fromEntries(Object.entries(config.cues ?? {}).filter(([cue]) => Object.hasOwn(cues, cue))
        .map(([cue, url]) => [cue, audioAssetUrl(url)]));
      const ambienceUrl = audioAssetUrl(config.ambienceUrl);
      const track = sceneMusicTrack(config.music);
      const sameMusic = (track?.url ?? '') === (musicWanted?.url ?? '');
      if (sceneId === activeScene && ambienceUrl === currentUrl && sameMusic) {
        if (track && musicWanted) musicWanted = track;
        apply(); syncMusic(); return;
      }
      sceneRevision++; stopEffects(); stopBed(); activeScene = sceneId; currentUrl = ambienceUrl;
      musicWanted = track;
      // An area with its own music plays only that; areas without music keep the ambience loop or the generated bed.
      if (ambienceUrl && !musicMode()) {
        ambience = new Audio(ambienceUrl); ambience.loop = true; ambience.preload = 'none';
        const media = ambience; media.onerror = () => fallbackBed(media);
      }
      startBed(); apply(); syncMusic();
    },
    /** Weather of the scene (runtime.weather, runtime.indoor). Indoors and with weather effects off it is silent. */
    setWeather(weather: SceneWeatherInput, indoor?: boolean | null) {
      if (disposed) return;
      weatherInput = { weather, indoor: indoor === true };
      syncWeather();
    },
    thunder,
    /** One speech blip; dropped (false) when MAX_BLIP_VOICES already sound, muted or the blip slider is at 0. */
    blip(voice: ResolvedBlipVoice, pitch: number, durationSec: number) {
      if (!audible() || settings.blips === 0 || !context || !blipGain || !running()) return false;
      if (activeBlips.size >= MAX_BLIP_VOICES) { counters.blipsDropped++; return false; }
      const tone = context.createOscillator(), gain = context.createGain();
      const entry = { tone, gain };
      activeBlips.add(entry);
      const at = context.currentTime;
      const { attack, peak, floor } = BLIP_ENVELOPE;
      tone.type = voice.wave; tone.frequency.value = Math.min(1200, Math.max(80, pitch));
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(peak, at + attack);
      gain.gain.exponentialRampToValueAtTime(floor, at + Math.max(attack + .005, durationSec));
      tone.connect(gain).connect(blipGain); tone.start(at); tone.stop(at + durationSec + .01);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); activeBlips.delete(entry); };
      counters.blips++;
      recentBlips.push({ characterId: voice.characterId, wave: voice.wave, pitch: Math.round(pitch) });
      if (recentBlips.length > 24) recentBlips.shift();
      return true;
    },
    setDialogueActive(active: boolean) { if (!disposed) { talking = active; apply(); } },
    getSettings: () => ({ ...settings }),
    setSettings(partial: Partial<AudioSettings>) {
      if (disposed) return;
      settings = normalizeAudioSettings({ ...settings, ...partial });
      try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Session-only settings still work. */ }
      startBed(); apply();
    },
    /** Read-only snapshot for tests and QA tools: gains, what runs, counters. Never changes anything. */
    inspect() {
      const value = (node?: GainNode) => node ? Math.round(node.gain.value * 1000) / 1000 : null;
      return {
        unlocked, contextState: context?.state ?? 'none', settings: { ...settings }, scene: activeScene,
        music: {
          mode: musicMode() ? 'music' : ambience ? 'ambience' : drone ? 'bed' : 'none',
          wanted: musicWanted?.url ?? null, playing: musicPlaying?.track.url ?? null, fading: musicFading.size,
          trackGain: value(musicPlaying?.gain), busGain: value(musicGain), busTarget: Math.round(musicLevel() * 1000) / 1000,
          ducked: talking, cached: [...musicBuffers.keys()], failed: [...musicFailed],
          loop: musicPlaying ? { start: musicPlaying.source.loopStart, end: musicPlaying.source.loopEnd, loop: musicPlaying.source.loop } : null,
        },
        weather: {
          scene: weatherInput, effective: weatherNow, running: Boolean(weatherGraph), type: weatherGraph?.type ?? 'NONE',
          gain: value(weatherGraph?.gain), target: weatherGraph ? Math.round(weatherGain(weatherNow) * 1000) / 1000 : 0,
          thunders: thunders.size,
        },
        blips: { active: activeBlips.size, busGain: value(blipGain), busTarget: audible() ? settings.blips : 0, recent: recentBlips.slice() },
        effects: { busGain: value(effectsGain), active: activeEffects.size },
        counters: { ...counters },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true; sceneRevision++; musicRevision++; stopBed(); stopEffects(); stopMusicNow(); stopThunders(); stopWeatherGraph(0);
      for (const { tone, gain } of activeBlips) { tone.onended = null; try { tone.stop(); } catch { /* ended */ } tone.disconnect(); gain.disconnect(); }
      activeBlips.clear();
      document.removeEventListener('visibilitychange', visibility);
      musicGain?.disconnect(); effectsGain?.disconnect(); blipGain?.disconnect(); weatherBus?.disconnect(); void context?.close().catch(() => {});
    }
  };
}
export type AudioController = ReturnType<typeof createAudioController>;

const percent = (value: number) => Math.round(value * 100);
export function renderAudioControls(settings: AudioSettings, tr: (en: string, vi: string) => string): string {
  const slider = (field: 'music' | 'effects' | 'blips', label: string) =>
    `<label>${label}<input type="range" min="0" max="100" value="${percent(settings[field])}" aria-valuetext="${percent(settings[field])}%" data-audio-${field}><output data-audio-level="${field}">${percent(settings[field])}%</output></label>`;
  return `<details class="game-audio-controls"><summary>${tr('Sound', 'Âm thanh')}</summary>
    <label><input type="checkbox" data-audio-muted ${settings.muted ? 'checked' : ''}> ${tr('Mute', 'Tắt âm')}</label>
    ${slider('music', tr('Music', 'Nhạc'))}
    ${slider('effects', tr('Effects', 'Hiệu ứng'))}
    ${slider('blips', tr('Character blips', 'Bíp nhân vật'))}
    <label><input type="checkbox" data-audio-weather-off ${settings.weatherEffects ? '' : 'checked'}> ${tr('Turn off weather effects', 'Tắt hiệu ứng thời tiết')}</label>
    ${renderMusicCredits(tr)}</details>`;
}
export function bindAudioControls(root: ParentNode, audio: ReturnType<typeof createAudioController>, onChange?: (settings: AudioSettings) => void): () => void {
  const controller = new AbortController();
  root.querySelector<HTMLInputElement>('[data-audio-muted]')?.addEventListener('change', (event) => {
    audio.unlock(); audio.setSettings({ muted: (event.target as HTMLInputElement).checked }); onChange?.(audio.getSettings());
  }, { signal: controller.signal });
  root.querySelector<HTMLInputElement>('[data-audio-weather-off]')?.addEventListener('change', (event) => {
    audio.unlock(); audio.setSettings({ weatherEffects: !(event.target as HTMLInputElement).checked }); onChange?.(audio.getSettings());
  }, { signal: controller.signal });
  for (const field of ['music', 'effects', 'blips'] as const)
    root.querySelector<HTMLInputElement>(`[data-audio-${field}]`)?.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      audio.unlock(); audio.setSettings({ [field]: Number(input.value) / 100 });
      input.setAttribute('aria-valuetext', `${input.value}%`);
      const output = root.querySelector<HTMLOutputElement>(`[data-audio-level="${field}"]`);
      if (output) output.value = `${input.value}%`;
      onChange?.(audio.getSettings());
    }, { signal: controller.signal });
  return () => controller.abort();
}
