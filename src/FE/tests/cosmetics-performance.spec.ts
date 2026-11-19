import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * What keeps Hồ sơ thám tử light: nothing draws unless it can change, painting never forces a style pass, and a
 * full-screen entrance has the machine to itself. These check the mechanisms, so a slow CI machine cannot fail them.
 */
// Trace snapshots read each canvas's bounding box and schedule their own frames, so these counters would count Playwright too.
test.use({ trace: 'off' });

const WALLET = { balance: 500, held: 0, slotsUsed: 3, slotCap: 12, itemCount: 3, reservedSlots: 0, feePercent: 5 };
const progress = (overrides: Record<string, unknown> = {}) => ({
  level: 1, xp: 0, xpToNext: 200, maxLevel: 50, isMaxLevel: false, avatar: 'nonla', avatarUrl: null, canUploadAvatar: false,
  frameDefId: null, titleDefId: 'title_tan-binh', entranceDefId: 'entrance_lang-le', exchangeable: [], owned: [], achievements: [], ...overrides,
});
const owned = (itemId: string, defId: string, category: string, equipped = false) => ({ itemId, defId, category, source: 'CHEST', locked: false, equipped });
const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

async function prepare(page: Page, me: ReturnType<typeof progress>) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'perf-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'player-1', fullName: 'Tuấn Yên', role: 'PLAYER', isEmailVerified: true }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
    (window as any).__raf = 0;
    (window as any).__measured = 0;
    const native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => { (window as any).__raf++; return native(callback); };
    const rect = HTMLCanvasElement.prototype.getBoundingClientRect;
    HTMLCanvasElement.prototype.getBoundingClientRect = function measured() { (window as any).__measured++; return rect.call(this); };
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
  await page.route('**/api/market/me', (route) => ok(route, WALLET));
  await page.route('**/api/profile/me', (route) => ok(route, { displayName: 'Tuấn Yên', role: 'PLAYER', isEmailVerified: true, hasPassword: true }));
  await page.route('**/api/progress/me', (route) => ok(route, me));
}

const raf = (page: Page) => page.evaluate(() => (window as any).__raf as number);
const pixels = (page: Page, selector: string) => page.locator(selector).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const runningOn = (page: Page, selector: string) => page.evaluate((s) =>
  document.getAnimations().filter((a) => a.playState === 'running' && (a.effect as KeyframeEffect)?.target?.closest?.(s)).length, selector);
const animationsOn = (page: Page, selector: string) => page.evaluate((s) =>
  document.getAnimations().filter((a) => (a.effect as KeyframeEffect)?.target?.closest?.(s)).length, selector);
const smilMoves = async (page: Page, selector: string) => {
  const clock = () => page.locator(`${selector} svg.hs-plq`).first().evaluate((svg: SVGSVGElement) => svg.getCurrentTime());
  const first = await clock();
  await page.waitForTimeout(250);
  return (await clock()) !== first;
};
const settle = (page: Page) => page.waitForTimeout(3500);

test('a portrait with nothing moving stops asking for frames', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/detective');
  await expect(page.locator('[data-hs-me]')).toBeVisible();
  await settle(page);

  const before = await raf(page);
  await page.waitForTimeout(600);
  expect(await raf(page)).toBe(before);
});

test('that portrait still gets its picture, even though nothing moves', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/detective');
  await settle(page);
  const painted = await page.locator('[data-hs-me]').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1);
    return data[3] > 0;
  });
  expect(painted).toBe(true);
});

test('a frame that does move keeps moving', async ({ page }) => {
  await prepare(page, progress({ frameDefId: 'frame_kimlong' }));
  await page.goto('/detective');
  await settle(page);

  const first = await pixels(page, '[data-hs-me]');
  await page.waitForTimeout(400);
  expect(await pixels(page, '[data-hs-me]')).not.toBe(first);
});

test('painting does not measure the canvas every frame, which would force a style pass', async ({ page }) => {
  await prepare(page, progress({ frameDefId: 'frame_kimlong' }));
  await page.goto('/detective');
  await settle(page);

  const before = await page.evaluate(() => (window as any).__measured as number);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__measured as number)).toBe(before);
});

test('moving frames are drawn about 30 times a second, not at the speed of the screen', async ({ page }) => {
  await prepare(page, progress({ frameDefId: 'frame_kimlong' }));
  await page.addInitScript(() => {
    (window as any).__draws = 0;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function counted(...args) {
      if (this.canvas.matches?.('[data-hs-me]')) (window as any).__draws++;
      return clear.apply(this, args);
    };
  });
  await page.goto('/detective');
  await settle(page);

  // Against the time that really passed: on a busy machine the wait below runs well over its second.
  const sample = () => page.evaluate(() => ({ draws: (window as any).__draws as number, at: performance.now() }));
  const before = await sample();
  await page.waitForTimeout(1000);
  const after = await sample();
  const perSecond = ((after.draws - before.draws) * 1000) / (after.at - before.at);
  expect(perSecond).toBeGreaterThan(5);
  // The painter's 29 ms interval allows 34.5; the speed of the screen would be 60 or more.
  expect(perSecond).toBeLessThanOrEqual(40);
});

test('a frame not owned yet is a still picture, a frame owned keeps its motion', async ({ page }) => {
  await prepare(page, progress({ owned: [owned('gold', 'frame_kimlong', 'FRAME')] }));
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Viền avatar' }).click();
  await page.locator('[data-hs-frame="phuong"]').scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 1400, height: 1400 });
  await settle(page);

  const locked = await pixels(page, '[data-hs-frame="phuong"] canvas');
  const mine = await pixels(page, '[data-hs-frame="kimlong"] canvas');
  await page.waitForTimeout(500);
  expect(await pixels(page, '[data-hs-frame="phuong"] canvas')).toBe(locked);
  expect(await pixels(page, '[data-hs-frame="kimlong"] canvas')).not.toBe(mine);
});

test('with no frame owned, the frames tab goes quiet too', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Viền avatar' }).click();
  await settle(page);

  const before = await raf(page);
  await page.waitForTimeout(600);
  expect(await raf(page)).toBe(before);
});

test('in the titles tab only the plaque under the pointer moves', async ({ page }) => {
  await prepare(page, progress({ titleDefId: 'title_kim-long', owned: [owned('t', 'title_kim-long', 'TITLE')] }));
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Danh hiệu' }).click();
  await expect(page.locator('.hs-ti')).toHaveCount(25);
  await page.waitForTimeout(300);

  // At rest a plaque has no animation at all: even a paused one would keep a GPU layer per particle.
  await expect.poll(() => animationsOn(page, '.hs-titles')).toBe(0);
  expect(await smilMoves(page, '[data-hs-title-id="long-phung"]')).toBe(false);
  expect(await smilMoves(page, '[data-hs-title-id="kim-long"]')).toBe(false);
  // The one in use still moves at the top of the page.
  expect(await runningOn(page, '[data-hs-title]')).toBeGreaterThan(0);
  expect(await smilMoves(page, '[data-hs-title]')).toBe(true);

  await page.locator('[data-hs-title-id="long-phung"]').hover();
  await expect.poll(() => runningOn(page, '[data-hs-title-id="long-phung"]')).toBeGreaterThan(0);
  expect(await smilMoves(page, '[data-hs-title-id="long-phung"]')).toBe(true);

  await page.locator('.hs-name').hover();
  await expect.poll(() => animationsOn(page, '.hs-titles')).toBe(0);
  expect(await smilMoves(page, '[data-hs-title-id="long-phung"]')).toBe(false);
});

test('keyboard focus wakes a plaque the same way the pointer does', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Danh hiệu' }).click();
  // Focus scrolls the list under the resting pointer, and a browser keeps that hover until the mouse next moves.
  await page.mouse.move(0, 0);
  await page.locator('[data-hs-title-id="long-phung"]').focus();
  await expect.poll(() => runningOn(page, '[data-hs-title-id="long-phung"]')).toBeGreaterThan(0);
  await page.locator('[data-hs-title-id="kim-long"]').focus();
  await expect.poll(() => runningOn(page, '[data-hs-title-id="long-phung"]')).toBe(0);
  await expect.poll(() => runningOn(page, '[data-hs-title-id="kim-long"]')).toBeGreaterThan(0);
});

test('the plaque in the header rests while it is scrolled off screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await prepare(page, progress({ titleDefId: 'title_kim-long' }));
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Danh hiệu' }).click();
  await expect.poll(() => runningOn(page, '[data-hs-title]')).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('[data-hs-title]')).not.toBeInViewport();
  await expect.poll(() => animationsOn(page, '[data-hs-title]')).toBe(0);
  expect(await smilMoves(page, '[data-hs-title]')).toBe(false);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => runningOn(page, '[data-hs-title]')).toBeGreaterThan(0);
  expect(await smilMoves(page, '[data-hs-title]')).toBe(true);
});

test('plaques at rest look like plaques: same size, with their art in place', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Danh hiệu' }).click();
  const plaque = page.locator('[data-hs-title-id="long-phung"] .hs-tl');
  await expect(plaque.locator('svg.hs-plq')).toBeVisible();
  await expect(plaque.locator('.hs-ob-dragon')).toHaveCount(1);
  expect((await plaque.boundingBox())!.width).toBeGreaterThan(100);
});

test('while an entrance plays, the page underneath stops drawing and resumes afterwards', async ({ page }) => {
  // Tall enough that the portrait stays on screen: off screen it would stop for another reason.
  await page.setViewportSize({ width: 1400, height: 1500 });
  await prepare(page, progress({ frameDefId: 'frame_kimlong', titleDefId: 'title_kim-long' }));
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await settle(page);
  await expect(page.locator('[data-hs-me]')).toBeInViewport();

  await page.locator('[data-hs-entrance="van-kiem"] [data-try]').click();
  await expect(page.locator('.hs-stage')).toBeVisible();
  await expect(page.locator('[data-hs-me]')).toBeInViewport();
  await page.waitForTimeout(200);
  const first = await pixels(page, '[data-hs-me]');
  await page.waitForTimeout(500);
  expect(await pixels(page, '[data-hs-me]')).toBe(first);
  expect(await animationsOn(page, '[data-hs-title]')).toBe(0);
  expect(await smilMoves(page, '[data-hs-title]')).toBe(false);
  // The plaque on the stage is the one that moves now.
  expect(await smilMoves(page, '.hs-stage .hs-ht')).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('.hs-stage')).toHaveCount(0);
  await expect.poll(() => runningOn(page, '[data-hs-title]')).toBeGreaterThan(0);
  expect(await smilMoves(page, '[data-hs-title]')).toBe(true);
  await page.waitForTimeout(100);
  const after = await pixels(page, '[data-hs-me]');
  await page.waitForTimeout(400);
  expect(await pixels(page, '[data-hs-me]')).not.toBe(after);
});

test('the portrait on the stage keeps one size while the camera moves, so its canvas is never reallocated', async ({ page }) => {
  await prepare(page, progress({ frameDefId: 'frame_kimlong' }));
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await page.locator('[data-hs-entrance="kim-long"] [data-try]').click();
  await expect(page.locator('.hs-hero.hs-show')).toBeVisible({ timeout: 8000 });

  const sizes = await page.evaluate(async () => {
    const hero = document.querySelector('.hs-hav') as HTMLCanvasElement;
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      seen.add(hero.width);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return [...seen];
  });
  expect(sizes).toHaveLength(1);
});

test('resizing still sharpens the portrait to its new size', async ({ page }) => {
  await prepare(page, progress({ frameDefId: 'frame_kimlong' }));
  await page.goto('/detective');
  await settle(page);
  const wide = await page.locator('[data-hs-me]').evaluate((canvas: HTMLCanvasElement) => canvas.width);

  await page.setViewportSize({ width: 390, height: 844 });

  await expect.poll(() => page.locator('[data-hs-me]').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThan(wide);
});

test('the sound of an entrance is prepared before the hero appears, not at that moment', async ({ page }) => {
  await prepare(page, progress());
  await page.addInitScript(() => {
    (window as any).__audioAt = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        (window as any).__audioAt.push(document.querySelector('.hs-hero.hs-show') ? 'after-reveal' : 'before-reveal');
      }
    };
  });
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await page.locator('[data-hs-entrance="kim-long"] [data-try]').click();
  await expect(page.locator('.hs-hero.hs-show')).toBeVisible({ timeout: 8000 });

  const created = await page.evaluate(() => (window as any).__audioAt as string[]);
  expect(created.length).toBeGreaterThan(0);
  expect(created).not.toContain('after-reveal');
});

test('plaques step their sweep about 30 times a second, not at the speed of the screen', async ({ page }) => {
  await prepare(page, progress({ titleDefId: 'title_kim-long' }));
  await page.goto('/detective');
  const svg = page.locator('[data-hs-title] svg.hs-plq');
  await expect(svg).toBeVisible();
  const ticks = await svg.evaluate(async (node: SVGSVGElement) => {
    let count = 0;
    const native = node.setCurrentTime.bind(node);
    node.setCurrentTime = (t) => { count++; native(t); };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    node.setCurrentTime = native;
    return { count, paused: node.animationsPaused() };
  });
  expect(ticks.paused).toBe(true);
  expect(ticks.count).toBeGreaterThan(10);
  expect(ticks.count).toBeLessThanOrEqual(34);
});

test('leaving the page stops the plaque clock', async ({ page }) => {
  await prepare(page, progress({ titleDefId: 'title_kim-long' }));
  await page.addInitScript(() => {
    (window as any).__intervals = new Set();
    const set = window.setInterval.bind(window);
    const clear = window.clearInterval.bind(window);
    window.setInterval = ((fn: TimerHandler, ms?: number) => { const id = set(fn, ms); if (ms === 33) (window as any).__intervals.add(id); return id; }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { (window as any).__intervals.delete(id); clear(id); }) as typeof window.clearInterval;
  });
  await page.goto('/detective');
  await expect(page.locator('[data-hs-title] svg.hs-plq')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__intervals.size)).toBe(1);

  await page.evaluate(() => { history.pushState(null, '', '/market'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.hs-root')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__intervals.size)).toBe(0);
});

test('a machine that cannot keep up gets a lighter stage, and the next entrance starts there', async ({ page }) => {
  await prepare(page, progress());
  // Every frame arrives late, as on a GPU that is falling behind.
  await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => native((time) => setTimeout(() => callback(performance.now()), 60) && undefined);
  });
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await page.locator('[data-hs-entrance="van-kiem"] [data-try]').click();
  const stage = page.locator('.hs-stc');
  await expect(stage).toBeVisible();
  const width = () => stage.evaluate((canvas: HTMLCanvasElement) => canvas.width);
  const first = await width();
  await expect.poll(width, { timeout: 15_000 }).toBeLessThan(first);
  // It still covers the whole screen.
  const box = (await stage.boundingBox())!;
  expect(box.width).toBeCloseTo(page.viewportSize()!.width, 0);
  const lowered = await width();

  await page.keyboard.press('Escape');
  await expect(page.locator('.hs-stage')).toHaveCount(0);
  await page.locator('[data-hs-entrance="anh-trang"] [data-try]').click();
  await expect(stage).toBeVisible();
  expect(await width()).toBeLessThanOrEqual(lowered);
});

test('the stage canvas never goes above 1.5 times the layout size, even on a sharper screen', async ({ browser }) => {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  await prepare(page, progress());
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await page.locator('[data-hs-entrance="van-kiem"] [data-try]').click();
  await expect(page.locator('.hs-stc')).toBeVisible();
  expect(await page.locator('.hs-stc').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThanOrEqual(1200);
  await context.close();
});

test('opening the first tab does not pay for art it does not show', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/detective');
  await expect(page.locator('.hs-name')).toBeVisible();
  await page.waitForTimeout(3000);
  // Neither the wing ornaments nor the entrance sprites: both are only needed further on.
  expect(await page.evaluate(() => document.head.innerHTML.includes('hs-ob-wingD'))).toBe(false);
});

test('a title with wings still gets them when it is shown', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Danh hiệu' }).click();
  const wing = page.locator('[data-hs-title-id="hac-duc"] .hs-ob-wingD');
  await expect(wing).toHaveCount(1);
  await expect.poll(() => wing.evaluate((el) => getComputedStyle(el).backgroundImage), { timeout: 15_000 }).toContain('data:image/png');
});

test('the art of the entrances is warmed when the entrance tab opens', async ({ page }) => {
  await prepare(page, progress());
  await page.addInitScript(() => {
    (window as any).__svgImages = 0;
    const describe = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...describe,
      set(value: string) { if (String(value).startsWith('data:image/svg')) (window as any).__svgImages++; describe.set!.call(this, value); },
    });
  });
  await page.goto('/detective');
  await expect(page.locator('.hs-name')).toBeVisible();
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => (window as any).__svgImages as number);

  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();

  await expect.poll(() => page.evaluate(() => (window as any).__svgImages as number), { timeout: 10_000 }).toBeGreaterThan(before + 4);
});

test('vector art is drawn from a finished bitmap, because replaying its filters every frame is what a GPU cannot keep up with', async ({ page }) => {
  await prepare(page, progress({ frameDefId: 'frame_dong' }));
  await page.addInitScript(() => {
    (window as any).__svgDraws = 0;
    const draw = CanvasRenderingContext2D.prototype.drawImage as (...args: unknown[]) => void;
    CanvasRenderingContext2D.prototype.drawImage = function counted(...args: unknown[]) {
      const source = args[0];
      if (source instanceof HTMLImageElement && source.src.startsWith('data:image/svg')) (window as any).__svgDraws++;
      return draw.apply(this, args);
    } as typeof CanvasRenderingContext2D.prototype.drawImage;
  });
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await page.locator('[data-hs-entrance="anh-trang"] [data-try]').click();
  await expect(page.locator('.hs-stage')).toBeVisible();
  await page.waitForTimeout(2000);

  // Baking a late sprite draws its SVG once; replaying them all would be hundreds of draws a second.
  const before = await page.evaluate(() => (window as any).__svgDraws as number);
  await page.waitForTimeout(1000);
  expect((await page.evaluate(() => (window as any).__svgDraws as number)) - before).toBeLessThan(5);
});

test('baked art still looks right: a level frame and the avatar in it are painted', async ({ page }) => {
  await prepare(page, progress({ frameDefId: 'frame_dong' }));
  await page.goto('/detective');
  await settle(page);
  const opaque = await page.locator('[data-hs-me]').evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 200) count++;
    return count / (canvas.width * canvas.height);
  });
  // Drawn from the SVG itself this frame covered 29% of its square.
  expect(opaque).toBeGreaterThan(0.25);
});
