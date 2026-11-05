import { expect, test, type Page } from '@playwright/test';
import { roomId, smokeState } from './helpers/smokeState';

// The loading screen: while a scene's art downloads (or a scene change is in flight) the scene is covered, so characters
// never show before their background.

const ok = (data: unknown) => ({ json: { success: true, data } });
const BG = '/assets/pixel/lo-thuoc-thu-nam/scenes/pho.png';
const BG2 = '/assets/pixel/lo-thuoc-thu-nam/scenes/nha-so-7.png';

async function signIn(page: Page) {
  await page.addInitScript(([id]) => {
    localStorage.setItem('sirlocked.token', 'smoke-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'player-1', fullName: 'Smoke Player', role: 'PLAYER', isEmailVerified: true }));
    sessionStorage.setItem(`sirlocked.intro.${id}`, '1');
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, [roomId]);
}

const withBackground = (url: string) => ({ ...smokeState, visibleScene: { ...smokeState.visibleScene, backgroundUrl: url } });

/** Holds the response for `ms`, so a test can look at the page while the image is "still downloading". */
async function slow(page: Page, glob: string, ms: number) {
  await page.route(glob, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test('the scene is covered by the loading screen until its background has arrived', async ({ page }) => {
  await signIn(page);
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill(ok(withBackground(BG))));
  await slow(page, `**${BG}`, 1800);
  await page.goto(`/game/${roomId}`);
  const loading = page.locator('#game-loading');
  await expect(loading).toHaveClass(/is-on/);
  await expect(loading).toBeVisible();
  await expect(loading).toContainText('Đang tải cảnh');
  // It covers the whole scene area, not a corner.
  const wrap = (await page.locator('.phaser-scene-wrap').boundingBox())!;
  const cover = (await loading.boundingBox())!;
  expect(cover.width).toBeGreaterThanOrEqual(wrap.width - 2);
  expect(cover.height).toBeGreaterThanOrEqual(wrap.height - 2);
  // Nothing under it can be clicked while it is up.
  const hit = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!.getBoundingClientRect();
    return document.elementFromPoint(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)?.closest('#game-loading')?.id;
  });
  expect(hit).toBe('game-loading');
  await expect(loading).not.toHaveClass(/is-on/, { timeout: 8000 });
});

test('a scene whose art is already cached shows no loading screen at all after the first draw', async ({ page }) => {
  await signIn(page);
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill(ok(smokeState)));
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('#game-loading')).not.toHaveClass(/is-on/, { timeout: 8000 });
});

test('a background that fails to load never traps the player behind the loading screen', async ({ page }) => {
  await signIn(page);
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill(ok(withBackground('/assets/pixel/does-not-exist.png'))));
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('#game-loading')).not.toHaveClass(/is-on/, { timeout: 8000 });
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('changing scene shows the loading screen for the request and for the new scene art', async ({ page }) => {
  await signIn(page);
  const unlocked = {
    ...smokeState,
    sceneMap: smokeState.sceneMap.map((entry) => (entry.sceneId === 'scene-hall' ? { ...entry, title: 'Hall', isUnlocked: true } : entry)),
  };
  const hall = {
    ...unlocked, version: 2, currentSceneId: 'scene-hall',
    visibleScene: { ...unlocked.visibleScene, sceneId: 'scene-hall', title: 'Hall', backgroundUrl: BG2, hotspots: [], items: [], characters: [], availableDialogues: [] },
    sceneMap: unlocked.sceneMap.map((entry) => ({ ...entry, isCurrent: entry.sceneId === 'scene-hall' })),
  };
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill(ok(unlocked)));
  await page.route(`**/api/game/rooms/${roomId}/go-to-scene`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill(ok({ state: hall, message: 'Moved.' }));
  });
  await slow(page, `**${BG2}`, 1500);
  await page.goto(`/game/${roomId}`);
  const loading = page.locator('#game-loading');
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(loading).not.toHaveClass(/is-on/, { timeout: 8000 });

  await page.locator('#map-btn').click();
  await page.locator('.map-entry').filter({ hasText: 'Hall' }).click();
  await expect(loading).toHaveClass(/is-on/);
  // It stays up through the new scene's image, not just the request.
  await page.waitForTimeout(1200);
  await expect(loading).toHaveClass(/is-on/);
  await expect(loading).not.toHaveClass(/is-on/, { timeout: 8000 });
  await expect(page.locator('#game-hud-slot')).toContainText('Hall');
});

test('reduced motion keeps the loading screen but stops the spinner', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill(ok(withBackground(BG))));
  await slow(page, `**${BG}`, 1500);
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('#game-loading')).toBeVisible();
  expect(await page.locator('.game-loading-spinner').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});
