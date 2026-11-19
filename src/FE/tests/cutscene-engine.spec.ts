import { expect, test, type Page } from '@playwright/test';
import { buildTimeline, estimateSeconds, maxFlashesPerSecond } from '../Client/js/game/cutscene/motionComicModel';
import { makeScript, playable } from './helpers/cutsceneFixture';

// Standalone engine tests: the real player runs on a plain page with a fixture script and the real pixel art.

async function open(page: Page, cutscene: unknown, options: { muted?: boolean; blockAudio?: boolean } = {}) {
  await page.addInitScript(({ muted, blockAudio }) => {
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.audio.v1', JSON.stringify({ music: 0.2, effects: 0.35, muted }));
    if (blockAudio) {
      // A browser that has not had a user gesture yet: the audio context stays suspended until resume() after a click.
      class BlockedAudioContext {
        state = 'suspended'; destination = {}; currentTime = 0; sampleRate = 44100;
        resume() { if ((window as any).__userGesture) this.state = 'running'; return Promise.resolve(); }
        suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
        createGain() { return { gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
        createDynamicsCompressor() { return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} }; }
        createConvolver() { return { connect() {}, buffer: null }; }
        createBuffer(ch: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
        createBufferSource() { return { connect() {}, start() {}, stop() {}, loop: false, buffer: null }; }
        createBiquadFilter() { return { frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, Q: {}, connect() {} }; }
        createOscillator() { return { frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, detune: {}, connect() {}, start() {}, stop() {} }; }
        createStereoPanner() { return { pan: { value: 0, linearRampToValueAtTime() {} }, connect() {} }; }
      }
      (window as any).AudioContext = BlockedAudioContext;
      window.addEventListener('pointerdown', () => { (window as any).__userGesture = true; }, true);
    }
  }, { muted: options.muted ?? true, blockAudio: options.blockAudio ?? false });
  await page.goto('/login');
  await page.evaluate(async (data) => {
    const player = '/Client/js/game/cutscene/motionComic.ts';
    const settings = '/Client/js/game/cutscene/audioSettings.ts';
    const { playMotionComic } = await import(/* @vite-ignore */ player);
    const { storedAudioSettings } = await import(/* @vite-ignore */ settings);
    const w = window as any;
    w.__done = [];
    await playMotionComic({ cutscene: data, audio: storedAudioSettings(), finishLabel: 'Vào điều tra', onDone: (reason: string) => { w.__done.push(reason); w.__motionComic.dispose(); } });
  }, cutscene);
  await expect(page.locator('.mc-root')).toBeVisible();
}

const state = (page: Page) => page.evaluate(() => (window as any).__motionComic?.state);
const time = (page: Page) => page.evaluate(() => (window as any).__motionComic?.time as number);
const titleStart = (page: Page) => page.evaluate(() => (window as any).__motionComic.timeline.titleStart as number);
const seek = (page: Page, t: number) => page.evaluate((x) => (window as any).__motionComic.seek(x), t);

test.describe('timeline model', () => {
  test('stays within 40-75 seconds, matches the server estimate, never flashes more than 3 times a second', () => {
    const script = makeScript();
    const seconds = estimateSeconds(script as any);
    expect(seconds).toBeGreaterThanOrEqual(40);
    expect(seconds).toBeLessThanOrEqual(75);
    const tl = buildTimeline(script as any);
    expect(tl.end).toBeCloseTo(seconds, 0);
    expect(maxFlashesPerSecond(tl)).toBeLessThanOrEqual(3);
    // A script that asks for a thunder cue in every panel is still throttled.
    const stormy = makeScript();
    for (const p of stormy.pages) for (const q of p.panels) q.audio = ['thunder', 'thunder'];
    expect(maxFlashesPerSecond(buildTimeline(stormy as any))).toBeLessThanOrEqual(3);
  });
});

test('plays on its own when sound is allowed, then offers to start the investigation', async ({ page }) => {
  await open(page, playable());
  await expect.poll(() => state(page)).toBe('playing');
  await page.waitForTimeout(1500);
  expect(await time(page)).toBeGreaterThan(0.8);
  await seek(page, await titleStart(page) + 4.6);
  await expect(page.locator('[data-mc-finish]')).toBeVisible();
  await expect(page.locator('[data-mc-finish]')).toHaveText('Vào điều tra');
  expect(await state(page)).toBe('ended');
  await page.locator('[data-mc-finish]').click();
  await expect(page.locator('.mc-root')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__done)).toEqual(['finished']);
});

test('blocked autoplay shows the start card with a "watch without sound" choice', async ({ page }) => {
  await open(page, playable(), { muted: false, blockAudio: true });
  await expect(page.locator('[data-mc-start]')).toBeVisible();
  await expect(page.locator('[data-mc-play]')).toHaveText('Bấm để xem');
  await expect(page.locator('[data-mc-play-muted]')).toHaveText('Xem không tiếng');
  expect(await state(page)).toBe('ready');
  await page.locator('[data-mc-play-muted]').click();
  await expect.poll(() => state(page)).toBe('playing');
  // "Without sound" is saved in the shared sound settings.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sirlocked.audio.v1')!).muted)).toBe(true);
});

test('Space and click skip ahead, M toggles the shared mute setting, holding Esc skips to the title', async ({ page }) => {
  await open(page, playable());
  await expect.poll(() => state(page)).toBe('playing');
  const before = await time(page);
  await page.keyboard.press('Space');
  const afterSpace = await time(page);
  expect(afterSpace).toBeGreaterThan(before + 0.2);
  await page.locator('.mc-stage').click({ position: { x: 300, y: 300 } });
  expect(await time(page)).toBeGreaterThan(afterSpace);

  await expect(page.locator('[data-mc-mute]')).toHaveAttribute('aria-pressed', 'true'); // the fixture starts muted
  await page.keyboard.press('m');
  await expect(page.locator('[data-mc-mute]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sirlocked.audio.v1')!).muted)).toBe(false);
  await page.keyboard.press('M');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sirlocked.audio.v1')!).muted)).toBe(true);

  const tStart = await titleStart(page);
  await page.keyboard.down('Escape');
  await page.waitForTimeout(1100);
  await page.keyboard.up('Escape');
  expect(await time(page)).toBeGreaterThanOrEqual(tStart);
  await seek(page, tStart + 4.6);
  await page.locator('[data-mc-finish]').click();
  expect(await page.evaluate(() => (window as any).__done)).toEqual(['skipped']);
});

test('a short Esc press does not skip; the hold ring needs about 0.75 seconds', async ({ page }) => {
  await open(page, playable());
  await expect.poll(() => state(page)).toBe('playing');
  const tStart = await titleStart(page);
  await page.keyboard.down('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.up('Escape');
  expect(await time(page)).toBeLessThan(tStart - 1);
});

test('reduced motion: nothing moves by itself, each click shows the next beat', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, playable());
  await expect.poll(() => state(page)).toBe('playing');
  const first = await time(page);
  await page.waitForTimeout(1500);
  expect(await time(page)).toBe(first);
  await page.locator('.mc-stage').click();
  const second = await time(page);
  expect(second).toBeGreaterThan(first);
  await page.waitForTimeout(800);
  expect(await time(page)).toBe(second);
  await expect(page.locator('[data-mc-hint]')).toContainText('khung kế');
  // Clicking through every beat reaches the end card.
  for (let i = 0; i < 40 && (await state(page)) === 'playing'; i++) await page.keyboard.press('Space');
  await expect(page.locator('[data-mc-finish]')).toBeVisible();
});

test('a missing image falls back to a paper card and never hangs or goes blank', async ({ page }) => {
  await page.route('**/assets/pixel/**', (route) => route.abort());
  await open(page, playable());
  await expect.poll(() => state(page)).toBe('playing');
  await seek(page, 12);
  await page.waitForTimeout(400);
  const distinct = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.mc-stage')!;
    const ctx = canvas.getContext('2d')!;
    const colors = new Set<string>();
    const w = canvas.width, h = canvas.height;
    for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 40))) for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) colors.add(Array.from(ctx.getImageData(x, y, 1, 1).data).join(','));
    return colors.size;
  });
  expect(distinct).toBeGreaterThan(8);
  await seek(page, await titleStart(page) + 4.6);
  await expect(page.locator('[data-mc-finish]')).toBeVisible();
});

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`phone ${size.width}x${size.height}: no sideways scroll, buttons are reachable, rotate hint only in portrait`, async ({ page }) => {
    await page.setViewportSize(size);
    await open(page, playable(), { muted: false, blockAudio: true });
    await expect(page.locator('[data-mc-start]')).toBeVisible();
    // The player is a fixed overlay: nothing inside it may be wider than the screen.
    const overflow = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.mc-root')!;
      const widest = Math.max(...[...root.querySelectorAll<HTMLElement>('*')].filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
        .map((el) => el.getBoundingClientRect().right));
      return Math.max(root.scrollWidth - root.clientWidth, widest - window.innerWidth);
    });
    expect(overflow).toBeLessThanOrEqual(1);
    for (const sel of ['[data-mc-play]', '[data-mc-play-muted]']) {
      const box = (await page.locator(sel).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    }
    await page.locator('[data-mc-play-muted]').click();
    await expect.poll(() => state(page)).toBe('playing');
    await seek(page, 9);
    for (const sel of ['[data-mc-mute]', '[data-mc-skip]']) {
      const box = (await page.locator(sel).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    }
    if (size.height > size.width) await expect(page.locator('[data-mc-rotate]')).toBeVisible();
    else await expect(page.locator('[data-mc-rotate]')).toBeHidden();
    await seek(page, await titleStart(page) + 4.6);
    await expect(page.locator('[data-mc-finish]')).toBeVisible();
    const box = (await page.locator('[data-mc-finish]').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
  });
}

test('Vietnamese diacritics render in captions, sound effects and the title (screenshots for review)', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, playable());
  await expect.poll(() => state(page)).toBe('playing');
  const tl = await page.evaluate(() => (window as any).__motionComic.timeline);
  const beat = (needle: string) => tl.beats.find((b: any) => b.text.includes(needle));
  const shots: [string, number][] = [
    ['caption', beat('Sương còn đọng').start + 1.8],
    ['sfx-am', beat('ẦM!!').start + 0.6],
    ['speech', beat('Ông ấy ngồi yên').start + 2.2],
    ['title', tl.titleStart + 3.6],
  ];
  for (const [name, t] of shots) {
    await seek(page, t);
    await page.waitForTimeout(350);
    const file = info.outputPath(`cutscene-${name}.png`);
    await page.screenshot({ path: file });
    await info.attach(`cutscene-${name}`, { path: file, contentType: 'image/png' });
  }
  const fonts = await page.evaluate(() => ['27px "Patrick Hand"', '40px "Bangers"'].map((f) => document.fonts.check(f, 'ẦM!! CẠCH. Sương Lọ thuốc')));
  info.annotations.push({ type: 'fonts-loaded', description: JSON.stringify(fonts) });
});

test('Tab stays inside the player and Esc on the end card closes it', async ({ page }) => {
  await open(page, playable());
  await seek(page, await titleStart(page) + 4.6);
  await expect(page.locator('[data-mc-finish]')).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const inside = await page.evaluate(() => !!document.activeElement?.closest('.mc-root'));
  expect(inside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.mc-root')).toHaveCount(0);
});
