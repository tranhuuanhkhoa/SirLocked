import { expect, test, type Page } from '@playwright/test';

async function preparePlayer(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'route-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'route-player', fullName: 'Route Detective', role: 'PLAYER', isEmailVerified: true,
    }));
    localStorage.setItem('sirlocked.uiLanguage', 'en');
    (window as any).__sirlockedNoSignalR = true;
  });
}

test('a late case response cannot replace the page selected afterward', async ({ page }) => {
  await preparePlayer(page);
  let release!: () => void;
  let requested!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('**/api/cases/slow-case', async (route) => {
    requested();
    await responseGate;
    await route.fulfill({ json: { success: true, data: {
      caseId: 'slow-case', title: 'The stale case', summary: 'Delayed response', characters: [],
      estimatedMinutes: 10, sceneCount: 1, itemCount: 1, clueCount: 1, dialogueCount: 1,
    } } });
  });

  await page.goto('/#/cases/slow-case');
  await requestSeen;
  await page.evaluate(() => {
    (window as any).__previousRouteRoot = document.getElementById('app');
    window.location.hash = '#/menu';
  });
  await expect(page.locator('#title-menu-heading')).toBeVisible();
  release();
  // Prove the old render finished, rather than asserting before its response.
  await expect.poll(() => page.evaluate(() =>
    (window as any).__previousRouteRoot?.textContent?.includes('The stale case'))).toBe(true);
  await expect(page.locator('#title-menu-heading')).toBeVisible();
  await expect(page.locator('#app')).not.toContainText('The stale case');
  await expect(page).toHaveURL(/#\/menu$/);
});

test('a late lobby response cannot redirect the newly selected page into a game', async ({ page }) => {
  await preparePlayer(page);
  let release!: () => void;
  let requested!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('**/api/rooms/slow-room', async (route) => {
    requested();
    await responseGate;
    await route.fulfill({ json: { success: true, data: { roomId: 'slow-room', status: 'IN_PROGRESS' } } });
  });
  await page.goto('/#/lobby/slow-room');
  await requestSeen;
  await page.evaluate(() => { window.location.hash = '#/menu'; });
  await expect(page.locator('#title-menu-heading')).toBeVisible();
  const response = page.waitForResponse('**/api/rooms/slow-room');
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/#\/menu$/);
  await expect(page.locator('#title-menu-heading')).toBeVisible();
});

test('late cleanup belongs to its original mount and never replaces current cleanup', async ({ page }) => {
  await preparePlayer(page);
  await page.goto('/#/menu');
  const outcome = await page.evaluate(async () => {
    // Exercise the production lifecycle with actual DOM roots and async cleanup.
    const modulePath = '/Client/js/services/routeLifecycle.js';
    const { createRouteLifecycle } = await import(modulePath);
    const lifecycle = createRouteLifecycle();
    const root = document.createElement('main');
    document.body.append(root);
    const calls: string[] = [];
    const first = lifecycle.begin(root);
    first.app.textContent = 'first';
    const second = lifecycle.begin(first.app);
    second.app.textContent = 'second';
    second.setCleanup(() => { calls.push('second'); return Promise.resolve(); });
    first.setCleanup(() => { calls.push('first'); });
    first.dispose();
    const beforeLeavingSecond = [...calls];
    const third = lifecycle.begin(second.app);
    third.app.textContent = 'third';
    third.setCleanup(() => { calls.push('third'); });
    third.dispose();
    third.dispose();
    const result = { beforeLeavingSecond, calls, firstAborted: first.signal.aborted,
      secondAborted: second.signal.aborted, firstDetached: !first.app.isConnected,
      secondDetached: !second.app.isConnected, finalText: third.app.textContent };
    third.app.remove();
    return result;
  });
  expect(outcome).toEqual({ beforeLeavingSecond: ['first'], calls: ['first', 'second', 'third'],
    firstAborted: true, secondAborted: true, firstDetached: true, secondDetached: true, finalText: 'third' });
});

test('leaving a pending game disposes keyboard input and ignores its late completed state', async ({ page }) => {
  await preparePlayer(page);
  await page.addInitScript(() => {
    const handlers = new Set();
    (window as any).__routeKeydownHandlers = handlers;
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = ((type: string, listener: any, options: any) => {
      if (type === 'keydown') handlers.add(listener);
      add(type, listener, options);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, listener: any, options: any) => {
      if (type === 'keydown') handlers.delete(listener);
      remove(type, listener, options);
    }) as typeof window.removeEventListener;
  });
  let release!: () => void;
  let requested!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route('**/api/game/rooms/slow-game/state', async (route) => {
    requested();
    await responseGate;
    await route.fulfill({ json: { success: true, data: { roomStatus: 'COMPLETED' } } });
  });

  await page.goto('/#/menu');
  const initialListeners = await page.evaluate(() => (window as any).__routeKeydownHandlers.size);
  await page.evaluate(() => { window.location.hash = '#/game/slow-game'; });
  await requestSeen;
  expect(await page.evaluate(() => (window as any).__routeKeydownHandlers.size)).toBeGreaterThan(initialListeners);
  await page.evaluate(() => { window.location.hash = '#/menu'; });
  await expect(page.locator('#title-menu-heading')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__routeKeydownHandlers.size)).toBe(initialListeners);
  const response = page.waitForResponse('**/api/game/rooms/slow-game/state');
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/#\/menu$/);
  await expect(page.locator('#title-menu-heading')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__routeKeydownHandlers.size)).toBe(initialListeners);
});
