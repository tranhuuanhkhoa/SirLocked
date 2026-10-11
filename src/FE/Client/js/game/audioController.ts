export type AudioSettings = { music: number; effects: number; muted: boolean };
export type AudioCue = 'dialogue' | 'discovery' | 'reveal' | 'scene' | 'ping';
const key = 'sirlocked.audio.v1';
const defaults: AudioSettings = { music: .2, effects: .35, muted: false };
const clamp = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
export function normalizeAudioSettings(value: Partial<AudioSettings> = {}): AudioSettings {
  return { music: clamp(value.music, defaults.music), effects: clamp(value.effects, defaults.effects), muted: typeof value.muted === 'boolean' ? value.muted : defaults.muted };
}
export function createAudioController() {
  let settings = { ...defaults };
  try { settings = normalizeAudioSettings(JSON.parse(localStorage.getItem(key) || '{}')); } catch { /* Storage may be disabled. */ }
  let context: AudioContext | undefined;
  let musicGain: GainNode | undefined;
  let effectsGain: GainNode | undefined;
  let ambience: HTMLAudioElement | undefined;
  let drone: OscillatorNode | undefined;
  let droneGain: GainNode | undefined;
  let activeScene = '';
  let currentUrl = '';
  let talking = false;
  let disposed = false;
  const cues: Record<AudioCue, number[]> = { dialogue: [330], discovery: [392, 523.25], reveal: [261.63, 329.63, 392], scene: [196], ping: [440, 554.37] };
  function apply() {
    const audible = !settings.muted && !document.hidden;
    const volume = audible ? settings.music * (talking ? .3 : 1) : 0;
    if (musicGain && context) musicGain.gain.setTargetAtTime(volume, context.currentTime, .12);
    if (effectsGain && context) effectsGain.gain.setTargetAtTime(audible ? settings.effects : 0, context.currentTime, .02);
    if (ambience) { ambience.volume = volume; if (!audible) ambience.pause(); else if (context?.state === 'running') void ambience.play().catch(() => {}); }
  }
  function startBed() {
    if (!context || !musicGain || !activeScene || currentUrl || drone) return;
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
    if (ambience) { ambience.pause(); ambience.removeAttribute('src'); ambience.load(); ambience = undefined; }
  }
  const visibility = () => { apply(); if (document.hidden) void context?.suspend(); else if (context) void context.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', visibility);
  return {
    unlock() {
      if (disposed) return;
      try {
        if (!context) {
          context = new AudioContext();
          musicGain = context.createGain(); effectsGain = context.createGain();
          musicGain.connect(context.destination); effectsGain.connect(context.destination);
        }
        void context.resume().then(() => { if (disposed) return; startBed(); apply(); }).catch(() => {});
      } catch { /* Audio is optional on devices without Web Audio. */ }
    },
    play(cue: AudioCue) {
      if (disposed || !context || !effectsGain || context.state !== 'running' || settings.muted || document.hidden) return;
      cues[cue].forEach((frequency, index) => {
        const tone = context!.createOscillator(); const gain = context!.createGain();
        const at = context!.currentTime + index * .09;
        tone.type = 'sine'; tone.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.11, at + .015);
        gain.gain.exponentialRampToValueAtTime(.001, at + .18);
        tone.connect(gain).connect(effectsGain!); tone.start(at); tone.stop(at + .2);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      });
    },
    setScene(sceneId: string, ambienceUrl = '') {
      if (disposed || sceneId === activeScene && ambienceUrl === currentUrl) return;
      stopBed(); activeScene = sceneId; currentUrl = ambienceUrl;
      if (ambienceUrl) { ambience = new Audio(ambienceUrl); ambience.loop = true; ambience.preload = 'none'; }
      startBed(); apply();
    },
    setDialogueActive(active: boolean) { talking = active; apply(); },
    getSettings: () => ({ ...settings }),
    setSettings(partial: Partial<AudioSettings>) {
      settings = normalizeAudioSettings({ ...settings, ...partial });
      try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Session-only settings still work. */ }
      apply();
    },
    dispose() {
      disposed = true; stopBed(); document.removeEventListener('visibilitychange', visibility);
      musicGain?.disconnect(); effectsGain?.disconnect(); void context?.close().catch(() => {});
    }
  };
}

export function renderAudioControls(settings: AudioSettings, tr: (en: string, vi: string) => string): string {
  return `<details class="game-audio-controls"><summary>${tr('Sound', 'Âm thanh')}</summary>
    <label><input type="checkbox" data-audio-muted ${settings.muted ? 'checked' : ''}> ${tr('Mute', 'Tắt âm')}</label>
    <label>${tr('Ambience', 'Âm nền')}<input type="range" min="0" max="100" value="${Math.round(settings.music * 100)}" data-audio-music></label>
    <label>${tr('Effects', 'Hiệu ứng')}<input type="range" min="0" max="100" value="${Math.round(settings.effects * 100)}" data-audio-effects></label></details>`;
}
export function bindAudioControls(root: ParentNode, audio: ReturnType<typeof createAudioController>): () => void {
  const controller = new AbortController();
  root.querySelector<HTMLInputElement>('[data-audio-muted]')?.addEventListener('change', (event) => {
    audio.unlock(); audio.setSettings({ muted: (event.target as HTMLInputElement).checked });
  }, { signal: controller.signal });
  for (const field of ['music', 'effects'] as const)
    root.querySelector<HTMLInputElement>(`[data-audio-${field}]`)?.addEventListener('input', (event) => {
      audio.unlock(); audio.setSettings({ [field]: Number((event.target as HTMLInputElement).value) / 100 });
    }, { signal: controller.signal });
  return () => controller.abort();
}
