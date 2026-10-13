export type AudioSettings = { music: number; effects: number; muted: boolean };
export type AudioCue = 'dialogue' | 'discovery' | 'reveal' | 'scene' | 'ping' | 'interact' | 'error';
export type SceneAudio = { ambienceUrl?: string; cues?: Partial<Record<AudioCue, string>> };
const key = 'sirlocked.audio.v1';
const defaults: AudioSettings = { music: .2, effects: .35, muted: false };
const clamp = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
export function normalizeAudioSettings(value: Partial<AudioSettings> = {}): AudioSettings {
  return { music: clamp(value?.music, defaults.music), effects: clamp(value?.effects, defaults.effects), muted: typeof value?.muted === 'boolean' ? value.muted : defaults.muted };
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
export function createAudioController() {
  let settings = { ...defaults };
  try { settings = normalizeAudioSettings(JSON.parse(localStorage.getItem(key) || '{}')); } catch { /* Storage may be disabled. */ }
  let context: AudioContext | undefined;
  let musicGain: GainNode | undefined;
  let effectsGain: GainNode | undefined;
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
  const cues: Record<AudioCue, number[]> = { dialogue: [330], discovery: [392, 523.25], reveal: [261.63, 329.63, 392], scene: [196], ping: [440, 554.37], interact: [294], error: [220, 196] };
  const audible = () => unlocked && !disposed && !settings.muted && !document.hidden;
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
  function apply() {
    if (disposed) return;
    const enabled = audible();
    const volume = enabled ? settings.music * (talking ? .3 : 1) : 0;
    if (musicGain && context) musicGain.gain.setTargetAtTime(volume, context.currentTime, .12);
    if (effectsGain && context) effectsGain.gain.setTargetAtTime(enabled ? settings.effects : 0, context.currentTime, .02);
    if (ambience) { ambience.volume = volume; if (!enabled || settings.music === 0) ambience.pause(); else startAmbience(ambience); }
    for (const effect of activeEffects) effect.volume = enabled ? settings.effects : 0;
    if (!enabled || settings.effects === 0) stopEffects();
  }
  function startBed() {
    if (!audible() || !context || context.state !== 'running' || !musicGain || !activeScene || ambience || drone) return;
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
  function resume() {
    if (disposed || !unlocked || document.hidden) return;
    apply();
    if (context) void context.resume().then(() => {
      if (disposed) return;
      if (document.hidden) { void context?.suspend().catch(() => {}); return; }
      startBed(); apply();
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
          musicGain = context.createGain(); effectsGain = context.createGain();
          musicGain.connect(context.destination); effectsGain.connect(context.destination);
        }
      } catch { /* Audio is optional on devices without Web Audio. */ }
      // Start HTML media during the gesture and re-apply state after Web Audio resumes.
      resume();
    },
    play(cue: AudioCue) {
      if (!audible() || settings.effects === 0) return;
      const revision = sceneRevision;
      const url = cueUrls?.[cue];
      if (!url) { synthCue(cue, revision); return; }
      if (activeEffects.size >= 6) { const oldest = activeEffects.values().next().value; if (oldest) { releaseMedia(oldest); activeEffects.delete(oldest); } }
      const effect = new Audio(url); effect.preload = 'none'; effect.volume = settings.effects;
      activeEffects.add(effect);
      const finish = () => { if (!activeEffects.delete(effect)) return; releaseMedia(effect); };
      const fallback = () => { if (!activeEffects.has(effect)) return; finish(); synthCue(cue, revision); };
      effect.onended = finish; effect.onerror = fallback;
      try { void Promise.resolve(effect.play()).then(() => {
        if (!activeEffects.has(effect)) { releaseMedia(effect); return; }
        if (!audible() || revision !== sceneRevision) finish();
      }).catch(fallback); }
      catch { fallback(); }
    },
    setScene(sceneId: string, audio: SceneAudio | string = {}) {
      if (disposed) return;
      const config = typeof audio === 'string' ? { ambienceUrl: audio } : audio ?? {};
      cueUrls = Object.fromEntries(Object.entries(config.cues ?? {}).filter(([cue]) => Object.hasOwn(cues, cue))
        .map(([cue, url]) => [cue, audioAssetUrl(url)]));
      const ambienceUrl = audioAssetUrl(config.ambienceUrl);
      if (sceneId === activeScene && ambienceUrl === currentUrl) { apply(); return; }
      sceneRevision++; stopEffects(); stopBed(); activeScene = sceneId; currentUrl = ambienceUrl;
      if (ambienceUrl) {
        ambience = new Audio(ambienceUrl); ambience.loop = true; ambience.preload = 'none';
        const media = ambience; media.onerror = () => fallbackBed(media);
      }
      startBed(); apply();
    },
    setDialogueActive(active: boolean) { if (!disposed) { talking = active; apply(); } },
    getSettings: () => ({ ...settings }),
    setSettings(partial: Partial<AudioSettings>) {
      if (disposed) return;
      settings = normalizeAudioSettings({ ...settings, ...partial });
      try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Session-only settings still work. */ }
      startBed(); apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true; sceneRevision++; stopBed(); stopEffects(); document.removeEventListener('visibilitychange', visibility);
      musicGain?.disconnect(); effectsGain?.disconnect(); void context?.close().catch(() => {});
    }
  };
}

export function renderAudioControls(settings: AudioSettings, tr: (en: string, vi: string) => string): string {
  return `<details class="game-audio-controls"><summary>${tr('Sound', 'Âm thanh')}</summary>
    <label><input type="checkbox" data-audio-muted ${settings.muted ? 'checked' : ''}> ${tr('Mute', 'Tắt âm')}</label>
    <label>${tr('Ambience', 'Âm nền')}<input type="range" min="0" max="100" value="${Math.round(settings.music * 100)}" aria-valuetext="${Math.round(settings.music * 100)}%" data-audio-music><output data-audio-level="music">${Math.round(settings.music * 100)}%</output></label>
    <label>${tr('Effects', 'Hiệu ứng')}<input type="range" min="0" max="100" value="${Math.round(settings.effects * 100)}" aria-valuetext="${Math.round(settings.effects * 100)}%" data-audio-effects><output data-audio-level="effects">${Math.round(settings.effects * 100)}%</output></label></details>`;
}
export function bindAudioControls(root: ParentNode, audio: ReturnType<typeof createAudioController>): () => void {
  const controller = new AbortController();
  root.querySelector<HTMLInputElement>('[data-audio-muted]')?.addEventListener('change', (event) => {
    audio.unlock(); audio.setSettings({ muted: (event.target as HTMLInputElement).checked });
  }, { signal: controller.signal });
  for (const field of ['music', 'effects'] as const)
    root.querySelector<HTMLInputElement>(`[data-audio-${field}]`)?.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      audio.unlock(); audio.setSettings({ [field]: Number(input.value) / 100 });
      input.setAttribute('aria-valuetext', `${input.value}%`);
      const output = root.querySelector<HTMLOutputElement>(`[data-audio-level="${field}"]`);
      if (output) output.value = `${input.value}%`;
    }, { signal: controller.signal });
  return () => controller.abort();
}
