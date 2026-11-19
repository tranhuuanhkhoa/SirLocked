import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { roomId, smokeState } from './helpers/smokeState';
import { previewGameState } from '../scripts/scene-preview-state.mjs';

/**
 * VUAN-4: speech blips, area music, weather and time of day in the real game page (API mocked).
 * Sound is checked through the audio controller's read-only state (gains, running nodes), not by listening.
 *
 * Scenes come from the sample case "Đồng hồ bỏ túi đêm mưa" (harbour in the rain + clock shop indoors, two songs,
 * three voices) and from a copy of the pixel case "Lọ thuốc thứ Năm" with a storm, rain and indoor scenes
 * (tests/fixtures/case-pixel-thoi-tiet-thu-vi.json).
 */
type Json = Record<string, any>;
const readJson = (file: string) => JSON.parse(readFileSync(path.resolve(file), 'utf8')) as Json;
const sampleCase = readJson('../BE/Tests/Fixtures/case-pixel-dong-ho-dem-mua-vi.json');
const weatherCase = readJson('tests/fixtures/case-pixel-thoi-tiet-thu-vi.json');
const DOCK = 'scene-dh-ben-cang', SHOP = 'scene-dh-tiem-dong-ho';

// Real Web Audio in headless Chromium without a click on every test.
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] } });

const gameState = (caseJson: Json, sceneId: string, asked: Set<string>, version: number) =>
  previewGameState(caseJson, sceneId, { asked, version }) as Json;

/** Mocks every API call of the game page; go-to-scene and ask-dialogue answer with the next state. */
type StateFor = (asked: Set<string>, version: number) => Json;
async function openGame(page: Page, caseJson: Json, firstScene: string, errors: string[], legacyState?: StateFor) {
  const asked = new Set<string>();
  let current = firstScene;
  let version = 1;
  const state = () => legacyState ? legacyState(asked, version) : gameState(caseJson, current, asked, version);
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(([id]) => {
    window.localStorage.setItem('sirlocked.token', 'smoke-token');
    window.localStorage.setItem('sirlocked.uiLanguage', 'vi');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'player-1', fullName: 'Thẩm vấn', role: 'PLAYER', isEmailVerified: true }));
    window.sessionStorage.setItem(`sirlocked.intro.${id}`, '1');
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, [roomId]);
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ json: { success: true, data: null } }));
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state() } }));
  await page.route(`**/api/game/rooms/${roomId}/go-to-scene`, async (route) => {
    current = route.request().postDataJSON().sceneId; version++;
    await route.fulfill({ json: { success: true, data: { changed: true, message: '', unlockedClueIds: [], state: state() } } });
  });
  await page.route(`**/api/game/rooms/${roomId}/ask-dialogue`, async (route) => {
    asked.add(route.request().postDataJSON().dialogueId); version++;
    await route.fulfill({ json: { success: true, data: { changed: true, message: '', unlockedClueIds: [], state: state() } } });
  });
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  // The first gesture unlocks sound, as a player's first click does.
  await page.keyboard.press('Shift');
  await expect.poll(() => audio(page).then((value) => value.contextState), { timeout: 15_000 }).toBe('running');
}

const weather = (page: Page) => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').weatherState());
const audio = (page: Page) => page.evaluate(() => (window as any).__sirlockedAudio?.inspect() ?? { contextState: 'none' });
const goTo = async (page: Page, sceneId: string) => {
  await page.evaluate((id) => (window as any).__sirlockedTest.goToScene(id), sceneId);
  await expect.poll(() => page.evaluate(() => (window as any).__sirlockedTest.state()?.currentSceneId)).toBe(sceneId);
};
/** Opens a witness, asks the first question and waits for its answer to blip. */
async function askFirst(page: Page, characterId: string) {
  await page.evaluate((id) => (window as any).__sirlockedTest.talkTo(id), characterId);
  const choice = page.locator('.conversation-choices button').first();
  await expect(choice).toBeVisible();
  await choice.click();
  // The detective's question types first; continuing shows the witness's answer, which blips.
  const speaking = page.locator('.vn-overlay.is-npc-speaking');
  for (let i = 0; i < 8 && !(await speaking.count()); i++) {
    await page.waitForTimeout(350);
    if (await speaking.count()) break;
    await page.locator('[data-vn-advance]').click();
  }
  await expect.poll(async () => (await audio(page)).blips.recent.filter((blip: Json) => blip.characterId === characterId).length,
    { timeout: 15_000 }).toBeGreaterThan(3);
  const duringSpeech = await audio(page);
  await page.keyboard.press('Escape');
  return duringSpeech;
}

test('harbour rain and its own music; entering the shop stops the rain and changes the song; back outside it rains again; three voices', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  await openGame(page, sampleCase, DOCK, errors);

  // Outdoors in the rain: particles on the pixel grid and the rain bed running.
  await expect.poll(async () => (await weather(page)).particles, { timeout: 15_000 }).toBeGreaterThan(20);
  const dock = await weather(page);
  expect(dock).toMatchObject({ type: 'RAIN', intensity: 0.7, active: true, drawn: true, indoor: false });
  expect(dock.unit).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await audio(page)).weather.running).toBe(true);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 20_000 }).toContain('/hang-duong/ben-cang-dem-mua.ogg');
  const outside = await audio(page);
  expect(outside.music.mode).toBe('music');
  expect(outside.music.loop).toEqual({ start: 0, end: 50.526327, loop: true });
  expect(outside.weather).toMatchObject({ type: 'RAIN', effective: { type: 'RAIN', intensity: 0.7 } });
  expect(outside.weather.target).toBeGreaterThan(0);

  // Indoors: no particle, no weather sound at all; the shop's own song cross-fades in.
  await goTo(page, SHOP);
  await expect.poll(async () => (await weather(page)).active).toBe(false);
  expect(await weather(page)).toMatchObject({ type: 'NONE', particles: 0, drawn: false, indoor: true });
  await expect.poll(async () => (await audio(page)).weather.running).toBe(false);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 20_000 }).toContain('/hang-duong/tiem-hop-nhac.ogg');
  const inside = await audio(page);
  expect(inside.counters.crossfades).toBe(1);
  expect(inside.weather.effective.type).toBe('NONE');
  const shopkeeper = await askFirst(page, 'char-dh-ong-tu');
  // Dialogue lowers the music to 40 %.
  expect(shopkeeper.music.ducked).toBe(true);
  expect(shopkeeper.music.busTarget).toBeCloseTo(inside.music.busTarget * 0.4, 3);

  // Back outside: rain and the harbour song return.
  await goTo(page, DOCK);
  await expect.poll(async () => (await weather(page)).particles).toBeGreaterThan(20);
  await expect.poll(async () => (await audio(page)).weather.running).toBe(true);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 20_000 }).toContain('/hang-duong/ben-cang-dem-mua.ogg');
  expect((await audio(page)).counters.crossfades).toBe(2);

  // Three characters, three voices: wave and pitch as the case wrote them.
  await askFirst(page, 'char-dh-co-hanh');
  const last = await askFirst(page, 'char-dh-anh-bay');
  const voices = new Map<string, { wave: string; pitches: number[] }>();
  for (const blip of last.blips.recent.concat(shopkeeper.blips.recent)) {
    const entry = voices.get(blip.characterId) ?? { wave: blip.wave, pitches: [] };
    entry.pitches.push(blip.pitch);
    voices.set(blip.characterId, entry);
  }
  expect(voices.get('char-dh-ong-tu')?.wave).toBe('triangle');
  expect(voices.get('char-dh-co-hanh')?.wave).toBe('sine');
  expect(voices.get('char-dh-anh-bay')?.wave).toBe('square');
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
  expect(Math.abs(median(voices.get('char-dh-co-hanh')!.pitches) - 520)).toBeLessThan(70);
  expect(Math.abs(median(voices.get('char-dh-ong-tu')!.pitches) - 170)).toBeLessThan(20);
  expect(Math.abs(median(voices.get('char-dh-anh-bay')!.pitches) - 140)).toBeLessThan(30);
  expect(errors).toEqual([]);
});

test('the blip slider and the weather switch work from the sound panel and are remembered', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, sampleCase, DOCK, errors);
  await expect.poll(async () => (await weather(page)).particles, { timeout: 15_000 }).toBeGreaterThan(20);
  await page.locator('.game-audio-controls > summary').click();
  const blips = page.locator('[data-audio-blips]');
  await expect(blips).toBeVisible();
  await expect(page.locator('.game-audio-controls')).toContainText('Bíp nhân vật');
  await expect(page.locator('.game-audio-controls')).toContainText('Nhạc');
  await blips.fill('0');
  await expect.poll(async () => (await audio(page)).blips.busTarget).toBe(0);
  await expect(page.locator('[data-audio-level="blips"]')).toHaveText('0%');
  await blips.fill('80');
  await expect.poll(async () => (await audio(page)).settings.blips).toBe(0.8);
  expect((await audio(page)).blips.busTarget).toBe(0.8);

  const weatherOff = page.locator('[data-audio-weather-off]');
  await weatherOff.check();
  await expect.poll(async () => (await weather(page)).active).toBe(false);
  expect(await weather(page)).toMatchObject({ particles: 0, drawn: false, enabled: false });
  await expect.poll(async () => (await audio(page)).weather.running).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sirlocked.audio.v1')!))).toMatchObject({ blips: 0.8, weatherEffects: false });
  await weatherOff.uncheck();
  await expect.poll(async () => (await weather(page)).particles).toBeGreaterThan(20);
  await expect.poll(async () => (await audio(page)).weather.running).toBe(true);
  expect(errors).toEqual([]);
});

test('the sound panel credits the songs heard: title, author, licence, link to the original page; own songs say so', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, sampleCase, DOCK, errors);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 20_000 }).toContain('/hang-duong/ben-cang-dem-mua.ogg');
  // The first area's song is credited too, though it loaded before the sound panel was drawn.
  const credits = page.locator('[data-audio-credits]');
  await page.locator('.game-audio-controls > summary').click();
  await expect(credits.locator('li')).toHaveCount(1);
  await page.locator('.game-audio-controls > summary').click();
  await goTo(page, SHOP);
  await expect.poll(async () => (await audio(page)).music.playing ?? '', { timeout: 20_000 }).toContain('/hang-duong/tiem-hop-nhac.ogg');
  await page.locator('.game-audio-controls > summary').click();
  await expect(credits).toBeVisible();
  await expect(credits).toContainText('Âm nhạc');
  const items = credits.locator('li');
  await expect(items).toHaveCount(2);
  // Newest first: the shop's music box (CC0, from OpenGameArt), then the harbour song written for the game.
  await expect(items.nth(0)).toContainText('Music Box: Cute Tune');
  await expect(items.nth(0)).toContainText('Aureolus_Omicron');
  await expect(items.nth(0)).toContainText('CC0 1.0');
  await expect(items.nth(0).locator('a')).toHaveAttribute('href', 'https://opengameart.org/content/4-music-box-tracks');
  await expect(items.nth(0).locator('a')).toHaveAttribute('rel', /noopener/);
  await expect(items.nth(1)).toContainText('Bến cảng đêm mưa');
  await expect(items.nth(1)).toContainText('Sir Locked tự sáng tác');
  // Under the sliders, not over them.
  const last = await page.locator('.game-audio-controls > label').last().boundingBox();
  const box = await credits.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(last!.y + last!.height - 1);
  expect(errors).toEqual([]);
});

test('a storm flashes the screen and thunder follows; reduced motion keeps the thunder without the flash', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, weatherCase, 'scene-px-nha-xe', errors);
  await expect.poll(async () => (await weather(page)).particles, { timeout: 15_000 }).toBeGreaterThan(20);
  expect(await weather(page)).toMatchObject({ type: 'STORM', intensity: 0.9 });
  const boltNow = () => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').stormBoltSoon());
  // A natural bolt may already have come (the first one is 2–5 s in); one bolt now puts the next natural one 6–12 s away.
  await boltNow();
  await expect.poll(async () => (await weather(page)).bolts).toBeGreaterThanOrEqual(1);
  const start = await weather(page);
  const before = await audio(page);
  await boltNow();
  await expect.poll(async () => (await weather(page)).flashes).toBe(start.flashes + 1);
  await expect.poll(async () => (await audio(page)).counters.thunders).toBe(before.counters.thunders + 1);
  const after = await weather(page);
  expect(after.nextBoltInMs).toBeGreaterThanOrEqual(5000);
  // Dusk: characters carry the warm tint (no tint on older scenes).
  const npcTints = () => page.evaluate(() => {
    const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    return scene.children.list.flatMap((child: any) => child.list ?? [child])
      .filter((child: any) => typeof child.texture?.key === 'string' && child.texture.key.startsWith('npc:'))
      .map((child: any) => child.tintTopLeft);
  });
  await expect.poll(async () => (await npcTints()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  for (const tint of await npcTints()) expect(tint).toBe(0xffd2a8);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calm = await weather(page);
  const calmAudio = await audio(page);
  await boltNow();
  await expect.poll(async () => (await weather(page)).bolts).toBe(calm.bolts + 1);
  expect((await weather(page)).flashes).toBe(calm.flashes);
  await expect.poll(async () => (await audio(page)).counters.thunders).toBe(calmAudio.counters.thunders + 1);

  // An indoor scene of the same case: nothing.
  await goTo(page, 'scene-px-hieu-thuoc');
  await expect.poll(async () => (await weather(page)).active).toBe(false);
  await expect.poll(async () => (await audio(page)).weather.running).toBe(false);
  expect((await audio(page)).weather.thunders).toBe(0);
  // The rainy street with the authored second voice.
  await goTo(page, 'scene-px-pho');
  await expect.poll(async () => (await weather(page)).type).toBe('RAIN');
  expect(errors).toEqual([]);
});

test('an older case without the new fields plays as before: no weather, no music, its own ambience and cues', async ({ page }) => {
  const errors: string[] = [];
  const legacy: StateFor = (asked, version) => ({
    ...smokeState, version,
    players: [
      { userId: 'player-1', username: 'Smoke Player', role: 'INTERROGATOR', isConnected: true },
      { userId: 'player-2', username: 'Partner', role: 'INVESTIGATOR', isConnected: true },
    ],
    visibleScene: {
      ...smokeState.visibleScene,
      runtime: { ...smokeState.visibleScene.runtime,
        audio: { ambienceUrl: '/assets/audio/point-click/ambience-study.wav', cues: { discovery: '/assets/audio/point-click/discovery.wav' } } },
      availableDialogues: smokeState.visibleScene.availableDialogues.map((dialogue) => ({ ...dialogue, isAsked: asked.has(dialogue.dialogueId) })),
    },
  });
  await openGame(page, sampleCase, DOCK, errors, legacy);
  await expect.poll(async () => (await audio(page)).music.mode).toBe('ambience');
  const state = await audio(page);
  expect(state.music.playing).toBeNull();
  expect(state.weather).toMatchObject({ running: false, effective: { type: 'NONE' } });
  expect(await weather(page)).toMatchObject({ type: 'NONE', particles: 0, drawn: false });
  // Characters without voice.blip still blip, with the default voice of their id, at the original typing pace.
  const witness = await askFirst(page, 'char-witness');
  expect(witness.blips.recent.every((blip: Json) => blip.characterId === 'char-witness')).toBe(true);
  expect(errors).toEqual([]);
});

test('area music in the controller: same song keeps playing, loop points, cached files, legacy fallback', async ({ page }) => {
  await page.route('**/test-atmosphere', (route) => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  await page.goto('/test-atmosphere');
  const result = await page.evaluate(async () => {
    const { createAudioController } = await import('/Client/js/game/audioController.ts');
    localStorage.removeItem('sirlocked.audio.v1');
    const wait = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 50)); };
    const audio = createAudioController();
    const harbor = { url: '/assets/audio/music/hang-duong/ben-cang-dem-mua.ogg', fallbackUrl: '/assets/audio/music/hang-duong/ben-cang-dem-mua.mp3',
      title: 'Bến cảng đêm mưa', source: 'claude-8bit', license: 'x', loopStartSec: 0, loopEndSec: 50.526, volume: .55 };
    const requests: string[] = [];
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) requests.push(entry.name); });
    observer.observe({ type: 'resource', buffered: false });
    audio.setScene('dock', { music: harbor });
    const beforeUnlock = audio.inspect().music.playing;
    audio.unlock();
    await wait(() => Boolean(audio.inspect().music.playing));
    const first = audio.inspect();
    audio.setScene('street', { music: { ...harbor, volume: .4 } });
    await new Promise((r) => setTimeout(r, 300));
    const same = audio.inspect();
    audio.setScene('hall', { ambienceUrl: '/assets/audio/point-click/ambience-hall.wav' });
    const legacy = audio.inspect();
    audio.setScene('dock-again', { music: harbor });
    await wait(() => Boolean(audio.inspect().music.playing));
    const back = audio.inspect();
    // A song neither format of which exists: the area falls back to the generated bed.
    audio.setScene('broken', { music: { url: '/assets/audio/music/missing.ogg', fallbackUrl: '/assets/audio/music/missing.mp3', volume: .5 } as any });
    await wait(() => audio.inspect().music.failed.length > 0);
    const broken = audio.inspect();
    observer.disconnect();
    audio.dispose();
    return { beforeUnlock, first, same, legacy, back, broken, harborFetches: requests.filter((name) => name.includes('ben-cang-dem-mua')).length };
  });
  expect(result.beforeUnlock).toBeNull();
  expect(result.first.music).toMatchObject({ mode: 'music', loop: { start: 0, end: 50.526, loop: true } });
  expect(result.same.counters.crossfades).toBe(0);
  expect(result.same.music.playing).toBe(result.first.music.playing);
  expect(result.legacy.music).toMatchObject({ mode: 'ambience', playing: null });
  expect(result.back.music.playing).toContain('ben-cang-dem-mua.ogg');
  // Decoded once: coming back to the area does not download the song again.
  expect(result.harborFetches).toBeLessThanOrEqual(1);
  expect(result.broken.music.mode).toBe('bed');
});

test('puzzle and interface sounds come from the CC0 pack; old sine cues are mapped to it', async ({ page }) => {
  await page.route('**/test-atmosphere', (route) => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  const fetched: string[] = [];
  page.on('requestfinished', (request) => { if (request.url().includes('/assets/audio/')) fetched.push(new URL(request.url()).pathname); });
  await page.goto('/test-atmosphere');
  const counters = await page.evaluate(async () => {
    const { createAudioController } = await import('/Client/js/game/audioController.ts');
    localStorage.removeItem('sirlocked.audio.v1');
    const audio = createAudioController();
    audio.setScene('pho', { cues: { discovery: '/assets/audio/point-click/discovery.wav' } });
    audio.unlock();
    for (let i = 0; i < 100 && audio.inspect().contextState !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    audio.play('discovery');
    audio.puzzle('lockpick', 'tap');
    audio.puzzle('fingerprint', 'solve');
    audio.puzzle('classic', 'wrong');
    for (let i = 0; i < 100 && audio.inspect().counters.sfxFiles < 4; i++) await new Promise((r) => setTimeout(r, 30));
    const result = audio.inspect().counters;
    audio.dispose();
    return result;
  });
  expect(counters.sfxFiles).toBe(4);
  expect(fetched).toEqual(expect.arrayContaining([
    '/assets/audio/sfx/ui/discovery.ogg', '/assets/audio/sfx/puzzle/lockpick-tap.ogg',
    '/assets/audio/sfx/puzzle/fingerprint-solve.ogg', '/assets/audio/sfx/puzzle/classic-wrong.ogg',
  ]));
  expect(fetched).not.toContain('/assets/audio/point-click/discovery.wav');
});
