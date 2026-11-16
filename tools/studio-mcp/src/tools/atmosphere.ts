/**
 * Sound and weather tools of the studio (VUAN-4):
 *  - blip_preview: one WAV per character of a case, rendered offline with the game's own blip code
 *    (src/FE/Client/js/game/atmosphere/blipCore.js), so Claude can check that the voices differ;
 *  - weather_preview: records 5–20 s of one scene in the real game page (local Vite, API mocked) with a given
 *    weather and time of day, as WebM (MP4 when ffmpeg is available), with the page's own sound (area music,
 *    weather, thunder) when ffmpeg can mux it; musicId puts a song of the music library on the scene first;
 *  - sfx_search: searches the CC0 sound pack (src/FE/public/assets/audio/sfx/LICENSES.json) by cue, puzzle kind, label.
 * Nothing here talks to the real server.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StudioError } from '../bridge-client.js';
import { display, readJsonFile, requireFile, resolveInput, safeId, tmpDir } from '../files.js';
import { fold } from '../library/index-store.js';
import { loadPlaywright } from '../playtest/browser.js';
import { urlAnswers, waitFor } from '../playtest/http.js';
import { fetchCaseJson } from './draft.js';
import type { ToolContext } from './context.js';
import { libraryMusic } from './music.js';

type Json = Record<string, any>;
export const WEATHER_TYPES = ['NONE', 'RAIN', 'WIND', 'SNOW', 'STORM'] as const;
export const TIMES_OF_DAY = ['DAY', 'DUSK', 'NIGHT'] as const;

async function importFrontend<T = any>(ctx: ToolContext, ...parts: string[]): Promise<T> {
  const file = path.join(ctx.config.repoRoot, 'src', 'FE', ...parts);
  if (!existsSync(file)) throw new StudioError('FRONTEND_MISSING', `Thiếu ${display(ctx.config, file)}: cần bản repo có VUAN-4.`);
  return await import(pathToFileURL(file).href) as T;
}

async function loadCase(ctx: ToolContext, args: { casePath?: string; draftId?: string }): Promise<{ caseJson: Json; source: string }> {
  if (args.casePath) {
    const file = requireFile(ctx.config, args.casePath);
    return { caseJson: readJsonFile(file), source: display(ctx.config, file) };
  }
  if (args.draftId) {
    const fetched = await fetchCaseJson(ctx, args.draftId);
    return { caseJson: readJsonFile(fetched.file), source: display(ctx.config, fetched.file) };
  }
  throw new StudioError('BAD_ARGS', 'Cần casePath (file case JSON) hoặc draftId (lấy case JSON qua bridge).');
}

/** Output folder: under tmp/ by default, or a folder inside the repository the caller names (e.g. Claude outputs/...). */
function outputDir(ctx: ToolContext, requested: string | undefined, ...fallback: string[]): string {
  if (!requested) return tmpDir(ctx.config, ...fallback);
  const dir = resolveInput(ctx.config, requested);
  const relative = path.relative(ctx.config.repoRoot, dir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new StudioError('BAD_PATH', 'outDir phải nằm trong repo.');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const fileSafe = (text: string) => String(text).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';

// ---------------------------------------------------------------- blip_preview
export interface BlipPreviewArgs { casePath?: string; draftId?: string; characterIds?: string[]; text?: string; outDir?: string }

export async function blipPreview(ctx: ToolContext, args: BlipPreviewArgs) {
  const { caseJson, source } = await loadCase(ctx, args);
  const core = await importFrontend(ctx, 'Client', 'js', 'game', 'atmosphere', 'blipCore.js');
  const wanted = new Set(args.characterIds ?? []);
  const characters: Json[] = (caseJson.characters ?? []).filter((character: Json) => !wanted.size || wanted.has(character.characterId));
  if (!characters.length) throw new StudioError('NOT_FOUND', 'Không có nhân vật nào khớp characterIds.');
  const dir = outputDir(ctx, args.outDir, 'blip-preview', fileSafe(caseJson.caseId ?? 'case'));
  const sampleRate = 22050;
  const results = characters.map((character) => {
    const voice = core.resolveBlipVoice(character.characterId, character.voice);
    const answer = (caseJson.dialogues ?? []).find((dialogue: Json) => dialogue.characterId === character.characterId)?.answer;
    const line = String(args.text || answer || `Tôi là ${character.name}.`).slice(0, 140);
    const plan = core.blipPlan(line, voice);
    const samples = core.renderBlips(plan, voice, { sampleRate });
    const file = path.join(dir, `${fileSafe(character.characterId)}.wav`);
    writeFileSync(file, core.encodeWav(samples, sampleRate));
    return {
      characterId: character.characterId, name: character.name,
      voice: { pitch: voice.pitch, speed: voice.speed, wave: voice.wave, variance: voice.variance },
      authored: voice.authored, blips: plan.filter((step: Json) => step.blip).length,
      seconds: Math.round(samples.length / sampleRate * 10) / 10, line, file: display(ctx.config, file),
    };
  });
  const signature = (entry: Json) => `${entry.voice.wave}:${Math.round(entry.voice.pitch / 40)}:${Math.round(entry.voice.speed / 4)}`;
  const clashes = results.filter((entry, index) => results.findIndex((other) => signature(other) === signature(entry)) !== index)
    .map((entry) => entry.characterId);
  return {
    case: source, characters: results,
    similarVoices: clashes,
    hint: clashes.length
      ? 'Có nhân vật nghe gần giống nhau (cùng sóng, cao độ và tốc độ gần nhau): đổi pitch hoặc wave trong characters[].voice.blip.'
      : 'Mỗi nhân vật một giọng. Nhân vật không có voice.blip dùng giọng mặc định sinh từ characterId (authored: false).',
  };
}

// ---------------------------------------------------------------- sfx_search
export interface SfxSearchArgs { query?: string; cue?: string; kind?: string; event?: string; includeFallback?: boolean; limit?: number }

export function sfxSearch(ctx: ToolContext, args: SfxSearchArgs) {
  const file = path.join(ctx.config.repoRoot, 'src', 'FE', 'public', 'assets', 'audio', 'sfx', 'LICENSES.json');
  if (!existsSync(file)) throw new StudioError('FILE_NOT_FOUND', 'Chưa có gói tiếng: thiếu src/FE/public/assets/audio/sfx/LICENSES.json.');
  const licenses = readJsonFile<Json>(file);
  const entries: Json[] = [...(licenses.sfx ?? []), ...(args.includeFallback ? licenses.fallback ?? [] : [])];
  const words = fold(args.query ?? '').split(/\s+/).filter(Boolean);
  const matches = entries.filter((entry) => {
    if (args.cue && entry.use?.cue !== args.cue) return false;
    if (args.kind && entry.use?.puzzleKind !== args.kind) return false;
    if (args.event && entry.use?.event !== args.event) return false;
    if (!words.length) return true;
    const haystack = fold([entry.file, entry.sourceFile, entry.source, ...(entry.labels ?? []), entry.use?.cue, entry.use?.puzzleKind, entry.use?.event].join(' '));
    return words.every((word) => haystack.includes(word));
  });
  const limit = Math.max(1, Math.min(200, args.limit ?? 40));
  return {
    total: matches.length,
    results: matches.slice(0, limit).map((entry) => ({
      file: entry.file, fallback: entry.fallback, use: entry.use, labels: entry.labels,
      source: entry.source, sourceFile: entry.sourceFile, link: entry.link, license: entry.license,
    })),
    note: 'Dùng trong case: runtime.audio.cues.<cue> = file (.ogg; game tự dùng .mp3 khi trình duyệt không phát Ogg). '
      + 'Tiếng giải đố do game tự chọn theo kind, không cần ghi vào case.',
  };
}

// ---------------------------------------------------------------- weather_preview
export interface WeatherPreviewArgs {
  casePath?: string; draftId?: string; sceneId?: string;
  weather?: (typeof WEATHER_TYPES)[number]; intensity?: number; timeOfDay?: (typeof TIMES_OF_DAY)[number];
  backgroundUrl?: string; seconds?: number; width?: number; height?: number; webUrl?: string; outDir?: string; name?: string;
  format?: 'webm' | 'mp4';
  /** Particle quality of the clip: 1 (full, default), .5 or .25 as a slow phone would get. */
  quality?: number;
  /** A song of the music library (music_search id) for the scene, instead of the case's own music. */
  musicId?: string;
  /** Record the page's sound into the clip (default true; needs ffmpeg to mux). */
  sound?: boolean;
}

/**
 * Init script: every node connected to an AudioContext's speakers is also connected to a MediaStream tap, so a
 * MediaRecorder can record what a player would hear (music, weather noise, thunder, blips) without a sound card.
 */
const SOUND_TAP = () => {
  // Runs in the page: the studio tsconfig has no DOM types, so browser objects go through `g`.
  const g = globalThis as any;
  const taps: any[] = [];
  const known = new WeakMap<object, any>();
  const connect = g.AudioNode.prototype.connect as (...args: any[]) => any;
  g.AudioNode.prototype.connect = function (this: any, destination: any, ...rest: any[]) {
    const result = connect.call(this, destination, ...rest);
    if (destination instanceof g.AudioDestinationNode && this.context instanceof g.AudioContext) {
      let tap = known.get(this.context);
      if (!tap) { tap = this.context.createMediaStreamDestination(); known.set(this.context, tap); taps.push(tap); }
      connect.call(this, tap);
    }
    return result;
  };
  // Phaser has its own (silent here) context besides the game's audio controller: record every context, mix later.
  g.__previewSound = {
    start() {
      if (!taps.length) return 0;
      const recordings = taps.map((tap) => {
        const chunks: any[] = [];
        const recorder = new g.MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 160_000 });
        recorder.ondataavailable = (event: any) => { if (event.data.size) chunks.push(event.data); };
        recorder.start(250);
        return { recorder, chunks };
      });
      g.__previewSound.stop = () => Promise.all(recordings.map(({ recorder, chunks }) => new Promise<string>((resolve) => {
        recorder.onstop = async () => {
          const bytes = new Uint8Array(await new g.Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          resolve(g.btoa(binary));
        };
        recorder.stop();
      })));
      return recordings.length;
    },
  };
};

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

function findFfmpeg(): string | null {
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  return null;
}

function stopChild(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}

export async function weatherPreview(ctx: ToolContext, args: WeatherPreviewArgs) {
  const { caseJson, source } = await loadCase(ctx, args);
  const preview = await importFrontend(ctx, 'scripts', 'scene-preview-state.mjs');
  const scenes: Json[] = preview.scenesOf(caseJson);
  if (!scenes.length) throw new StudioError('BAD_CASE', 'Case không có cảnh nào.');
  const scene = args.sceneId
    ? scenes.find((candidate) => candidate.sceneId === args.sceneId)
    : scenes.find((candidate) => candidate.runtime?.indoor !== true && candidate.runtime?.render?.mode === 'pixel') ?? scenes[0];
  if (!scene) throw new StudioError('NOT_FOUND', `Không có cảnh ${args.sceneId}.`);
  if (args.weather && !WEATHER_TYPES.includes(args.weather)) throw new StudioError('BAD_ARGS', `weather phải là ${WEATHER_TYPES.join(', ')}.`);
  if (args.timeOfDay && !TIMES_OF_DAY.includes(args.timeOfDay)) throw new StudioError('BAD_ARGS', `timeOfDay phải là ${TIMES_OF_DAY.join(', ')}.`);
  const weather = args.weather ? { type: args.weather, intensity: Math.min(1, Math.max(0, args.intensity ?? 0.7)) } : undefined;
  const caseCopy = preview.withAtmosphere(caseJson, scene.sceneId, { weather, timeOfDay: args.timeOfDay, backgroundUrl: args.backgroundUrl });
  if (args.musicId) {
    const target = preview.scenesOf(caseCopy).find((candidate: Json) => candidate.sceneId === scene.sceneId);
    target.runtime = target.runtime ?? {};
    target.runtime.audio = { ...(target.runtime.audio ?? {}), music: libraryMusic(ctx, args.musicId) };
  }
  const seconds = Math.min(20, Math.max(5, args.seconds ?? 6));
  const width = Math.min(1920, Math.max(390, args.width ?? 1280)), height = Math.min(1080, Math.max(400, args.height ?? 720));
  const outDir = outputDir(ctx, args.outDir, 'weather-preview');
  const effective = caseCopy.stages.flatMap((stage: Json) => stage.scenes).find((candidate: Json) => candidate.sceneId === scene.sceneId).runtime;
  const name = fileSafe(args.name ?? `${caseJson.caseId}-${scene.sceneId}-${effective.weather?.type ?? 'NONE'}-${effective.timeOfDay ?? 'DAY'}`);

  let vite: ChildProcess | null = null;
  let webUrl = args.webUrl;
  if (webUrl) {
    const host = new URL(webUrl).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new StudioError('NOT_LOCAL', 'webUrl phải là máy này (127.0.0.1/localhost).');
  } else {
    const viteJs = path.join(ctx.config.repoRoot, 'src', 'FE', 'node_modules', 'vite', 'bin', 'vite.js');
    if (!existsSync(viteJs)) throw new StudioError('FRONTEND_MISSING', 'Chưa cài src/FE: chạy npm ci trong src/FE.');
    const port = await freePort();
    webUrl = `http://127.0.0.1:${port}`;
    // Proxy target nobody listens on: every API call is answered by the page routes below.
    vite = spawn(process.execPath, [viteJs, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: path.join(ctx.config.repoRoot, 'src', 'FE'), env: { ...process.env, VITE_API_URL: 'http://127.0.0.1:9' }, stdio: 'ignore', windowsHide: true,
    });
    if (!(await waitFor(() => urlAnswers(webUrl!), 60_000, 500))) { stopChild(vite); throw new StudioError('VITE_FAILED', 'Vite không chạy được.'); }
  }

  const playwright = loadPlaywright(ctx.config.repoRoot);
  const videoDir = tmpDir(ctx.config, 'weather-preview', 'raw', `${Date.now()}`);
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors: string[] = [];
  let state: Json = {};
  let audio: Json = {};
  let readyAtSec = 0;
  let soundFiles: string[] = [];
  const wantSound = args.sound !== false;
  const shot = path.join(outDir, `${name}.png`);
  try {
    const context = await browser.newContext({ viewport: { width, height }, recordVideo: { dir: videoDir, size: { width, height } } });
    const page = await context.newPage();
    const opened = Date.now();
    page.on('console', (message: any) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.addInitScript(([id]: string[]) => {
      localStorage.setItem('sirlocked.token', 'preview-token');
      localStorage.setItem('sirlocked.uiLanguage', 'vi');
      localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'player-1', fullName: 'Xem thử', role: 'PLAYER', isEmailVerified: true }));
      sessionStorage.setItem(`sirlocked.intro.${id}`, '1');
      (globalThis as any).__sirlockedNoSignalR = true;
    }, [preview.PREVIEW_ROOM_ID]);
    if (wantSound) await page.addInitScript(SOUND_TAP);
    const gameState = preview.previewGameState(caseCopy, scene.sceneId);
    await page.route((url: URL) => url.pathname.startsWith('/api/'), (route: any) => route.fulfill({ json: { success: true, data: null } }));
    await page.route(`**/api/game/rooms/${preview.PREVIEW_ROOM_ID}/state`, (route: any) => route.fulfill({ json: { success: true, data: gameState } }));
    await page.goto(`${webUrl}/game/${preview.PREVIEW_ROOM_ID}`);
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.keyboard.press('Shift');
    const weatherState = () => page.evaluate(() => (globalThis as any).__sirlockedGame?.scene?.getScene('SirLockedPhaserScene')?.weatherState?.() ?? null);
    await waitFor(async () => {
      const value = await weatherState().catch(() => null);
      const loading = await page.locator('#game-loading.is-on').count().catch(() => 0);
      return Boolean(value) && (value.type === 'NONE' || value.particles > 0) && loading === 0;
    }, 60_000, 250);
    // A recording browser runs slower than a player's: keep the chosen particle quality instead of lowering it.
    await page.evaluate((quality: number) => (globalThis as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').pinWeatherQuality?.(quality), args.quality ?? 1);
    await page.waitForTimeout(600);
    if (wantSound && effective.audio?.music) {
      // The area song is decoded lazily: start the clip once it plays, as a player entering the area hears it.
      await waitFor(async () => Boolean((await page.evaluate(() => (globalThis as any).__sirlockedAudio?.inspect())?.music?.playing)), 15_000, 200);
    }
    readyAtSec = (Date.now() - opened) / 1000;
    const recording = wantSound ? await page.evaluate(() => (globalThis as any).__previewSound?.start() ?? false) : false;
    if (effective.weather?.type === 'STORM') {
      await page.waitForTimeout(1200);
      await page.evaluate(() => (globalThis as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').stormBoltSoon());
      await page.waitForTimeout(90);
      await page.screenshot({ path: shot });
      await page.waitForTimeout(seconds * 1000 - 1290);
    } else {
      await page.waitForTimeout(seconds * 1000 / 2);
      await page.screenshot({ path: shot });
      await page.waitForTimeout(seconds * 1000 / 2);
    }
    state = await weatherState() ?? {};
    audio = await page.evaluate(() => (globalThis as any).__sirlockedAudio?.inspect() ?? {});
    if (recording) {
      const recorded: string[] = await page.evaluate(() => (globalThis as any).__previewSound.stop());
      soundFiles = recorded.map((base64, index) => {
        const file = path.join(videoDir, `sound-${index}.webm`);
        writeFileSync(file, Buffer.from(base64, 'base64'));
        return file;
      }).filter((file) => statSync(file).size > 1000);
    }
    await context.close();
  } finally {
    await browser.close();
    stopChild(vite);
  }
  const raw = readdirSync(videoDir).filter((file) => file.endsWith('.webm')).map((file) => path.join(videoDir, file))
    .sort((a, b) => statSync(b).size - statSync(a).size)[0];
  if (!raw) throw new StudioError('NO_VIDEO', 'Playwright không ghi được video.');
  const ffmpeg = findFfmpeg();
  const format = args.format === 'mp4' && ffmpeg ? 'mp4' : 'webm';
  const output = path.join(outDir, `${name}.${format}`);
  let withSound = false;
  if (ffmpeg) {
    // Cut the page loading off the start so the clip is the scene only; the sound recording starts at that moment.
    const codec = format === 'mp4' ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : ['-c:v', 'libvpx', '-b:v', '2M'];
    const soundInput = soundFiles.flatMap((file) => ['-i', file]);
    // Every context mixed as the speakers would; the clip is brought to -18 LUFS so it can be heard on a laptop
    // (the game itself starts at 20 % music volume), the balance of music, rain and thunder stays the game's.
    const inputs = soundFiles.map((_, index) => `[${index + 1}:a]`).join('');
    const mixer = soundFiles.length > 1 ? `${inputs}amix=inputs=${soundFiles.length}:normalize=0,` : inputs;
    const mix = ['-filter_complex', `${mixer}loudnorm=I=-18:TP=-1.5:LRA=11[mix]`, '-map', '0:v:0', '-map', '[mix]'];
    const soundCodec = soundFiles.length
      ? [...mix, ...(format === 'mp4' ? ['-c:a', 'aac', '-b:a', '160k'] : ['-c:a', 'libopus', '-b:a', '160k'])]
      : ['-an'];
    const cut = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', readyAtSec.toFixed(2), '-i', raw, ...soundInput,
      '-t', String(seconds), ...codec, ...soundCodec, output], { encoding: 'utf8', windowsHide: true });
    withSound = cut.status === 0 && soundInput.length > 0;
    if (cut.status !== 0) copyFileSync(raw, path.join(outDir, `${name}.webm`));
  } else {
    copyFileSync(raw, output);
  }
  const video = existsSync(output) ? output : path.join(outDir, `${name}.webm`);
  return {
    case: source, sceneId: scene.sceneId,
    weather: effective.weather ?? { type: 'NONE', intensity: 0 }, indoor: effective.indoor === true, timeOfDay: effective.timeOfDay ?? 'DAY',
    video: display(ctx.config, video), screenshot: display(ctx.config, shot), seconds,
    trimmed: Boolean(ffmpeg), sceneStartsAtSec: ffmpeg ? 0 : Math.round(readyAtSec * 10) / 10,
    layer: { type: state.type, particles: state.particles, quality: state.quality, flashes: state.flashes, unit: state.unit },
    sound: { weatherRunning: audio.weather?.running ?? null, music: audio.music?.playing ?? null, thunders: audio.counters?.thunders ?? 0, inVideo: withSound },
    consoleErrors: errors.slice(0, 10),
    hint: ffmpeg ? 'Mở video để xem.' : `Không có ffmpeg: video giữ đoạn tải trang, cảnh bắt đầu ở giây ${Math.round(readyAtSec * 10) / 10}.`,
  };
}
