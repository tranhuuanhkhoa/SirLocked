import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Sảnh chờ (/lobby) with a mocked API and a fake hub: every seat shows the look the server sent, and a
 * PlayerEntrance event plays that player's entrance: one at a time, skippable, never once the game has started.
 */
const ROOM_ID = 'room-1';

const player = (userId: string, username: string, overrides: Record<string, unknown> = {}) => ({
  userId, username, role: null, isReady: false, isConnected: true,
  level: 1, avatar: 'nonla', avatarUrl: null, frameDefId: null, titleDefId: 'title_tan-binh', entranceDefId: 'entrance_lang-le',
  ...overrides,
});

const room = (status = 'WAITING', players = [player('me', 'Tuấn Yên'), player('b', 'Bảo Ngọc', { frameDefId: 'frame_bac', titleDefId: 'title_van-tay', avatar: 'nu' })]) => ({
  roomId: ROOM_ID, roomCode: 'ABC123', caseId: 'case-1', caseTitle: 'Vụ án thử', hostUserId: 'me', status, visibility: 'PRIVATE', players, createdAt: new Date().toISOString(),
});

const entrance = (userId: string, username: string, entranceDefId: string, overrides: Record<string, unknown> = {}) => ({
  roomId: ROOM_ID, userId, username, level: 5, avatar: 'kiem', avatarUrl: null, frameDefId: 'frame_bac', titleDefId: 'title_van-tay', entranceDefId, ...overrides,
});

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

async function prepare(page: Page, { reduced = false, currentRoom = room() } = {}) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'lobby-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'me', fullName: 'Tuấn Yên', role: 'PLAYER', isEmailVerified: true }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
  await page.route(`**/api/rooms/${ROOM_ID}`, (route) => ok(route, currentRoom));
}

const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(([name, data]) => (window as any).__sirlockedEmitSignalR?.(name, data), [event, payload] as const);

async function openLobby(page: Page) {
  await page.goto(`/lobby/${ROOM_ID}`);
  await expect(page.locator('.bpa-lobby-pair')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__sirlockedEmitSignalR)).toBe('function');
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('every seat shows a framed portrait and a small title from what the server sent', async ({ page }) => {
  await prepare(page);
  const errors = collectPageErrors(page);
  await openLobby(page);

  await expect(page.locator('canvas[data-seat-avatar]')).toHaveCount(2);
  const guest = page.locator('[data-seat-user="b"]');
  await expect(guest).toContainText('Bảo Ngọc');
  await expect(guest.locator('.hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Chuyên Gia Vân Tay');
  await expect(guest.locator('.hs-tl')).toHaveClass(/hs-bare/);
  await expect(page.locator('[data-seat-user="me"] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Tân Binh');
  expect(errors).toEqual([]);
});

test('the longest title fits inside its seat instead of being cut off', async ({ page }) => {
  await prepare(page, { currentRoom: room('WAITING', [player('me', 'Tuấn Yên', { titleDefId: 'title_long-phung' }), player('b', 'Thám Tử Có Tên Rất Là Dài', { titleDefId: 'title_long-phung' })]) });
  await openLobby(page);
  await expect(page.locator('.bpa-rim')).toHaveCount(0);

  for (const seat of await page.locator('.hs-seat-title').all()) {
    const fits = await seat.evaluate((el) => {
      const plaque = el.querySelector('.hs-tl')!.getBoundingClientRect();
      const card = el.closest('.bpa-lobby-id')!.getBoundingClientRect();
      return plaque.width > 0 && plaque.right <= card.right;
    });
    expect(fits).toBe(true);
  }
});

test('an arrival refreshes the room, so a partner who just connected does not look offline', async ({ page }) => {
  let online = false;
  await prepare(page);
  await page.route(`**/api/rooms/${ROOM_ID}`, (route) => ok(route, room('WAITING', [player('me', 'Tuấn Yên'), player('b', 'Bảo Ngọc', { isConnected: online })])));
  await openLobby(page);
  await expect(page.locator('[data-seat-user="b"]')).toContainText('Mất kết nối');

  online = true;
  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_lang-le'));

  await expect(page.locator('[data-seat-user="b"]')).not.toContainText('Mất kết nối');
});

test('a room from an older server still renders, with the defaults', async ({ page }) => {
  await prepare(page, { currentRoom: room('WAITING', [{ userId: 'me', username: 'Tuấn Yên', role: null, isReady: false, isConnected: true } as any]) });
  const errors = collectPageErrors(page);
  await openLobby(page);
  await expect(page.locator('canvas[data-seat-avatar]')).toHaveCount(1);
  await expect(page.locator('[data-seat-user="me"] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Tân Binh');
  expect(errors).toEqual([]);
});

test('an entrance plays full screen for everyone, with that player\'s name and look, and can be skipped', async ({ page }) => {
  await prepare(page);
  const errors = collectPageErrors(page);
  await openLobby(page);

  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_kim-long'));

  const stage = page.locator('.hs-stage');
  await expect(stage).toBeVisible();
  await expect(stage.locator('.hs-hn')).toHaveText('Bảo Ngọc');
  await expect(stage.locator('.hs-hero small')).toHaveText('đã vào sảnh · Kim Long Giáng Thế');
  await expect(stage.locator('.hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Chuyên Gia Vân Tay');
  await stage.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(stage).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Esc ends an entrance too', async ({ page }) => {
  await prepare(page);
  await openLobby(page);
  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_van-kiem'));
  await expect(page.locator('.hs-stage')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hs-stage')).toHaveCount(0);
});

test('several arrivals wait in line and never overlap', async ({ page }) => {
  await prepare(page);
  await openLobby(page);

  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_kim-long'));
  await emit(page, 'PlayerEntrance', entrance('me', 'Tuấn Yên', 'entrance_van-kiem'));

  await expect(page.locator('.hs-stage')).toHaveCount(1);
  await expect(page.locator('.hs-stage .hs-hn')).toHaveText('Bảo Ngọc');
  await page.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(page.locator('.hs-stage:not(.hs-out) .hs-hn')).toHaveText('Tuấn Yên');
  await expect(page.locator('.hs-stage:not(.hs-out)')).toHaveCount(1);
  await page.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(page.locator('.hs-stage')).toHaveCount(0);
});

test('an entrance ending by itself lets the next one start', async ({ page }) => {
  await prepare(page);
  await openLobby(page);
  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_anh-trang'));
  await emit(page, 'PlayerEntrance', entrance('me', 'Tuấn Yên', 'entrance_anh-trang'));
  await expect(page.locator('.hs-stage .hs-hn')).toHaveText('Bảo Ngọc');
  // Ánh Trăng Soi Lối lasts 6.6 s.
  await expect(page.locator('.hs-stage:not(.hs-out) .hs-hn')).toHaveText('Tuấn Yên', { timeout: 12_000 });
});

test('the default entrance stays a light effect in the lobby, not the full screen', async ({ page }) => {
  await prepare(page);
  const errors = collectPageErrors(page);
  await openLobby(page);

  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_lang-le'));

  await expect(page.locator('.hs-fx--page')).toHaveCount(1);
  await expect(page.locator('.hs-stage')).toHaveCount(0);
  // The page stays usable underneath.
  await page.getByRole('button', { name: /Sao chép$/ }).click();
  // It goes away by itself after about three seconds.
  await expect(page.locator('.hs-fx--page')).toHaveCount(0, { timeout: 6000 });
  expect(errors).toEqual([]);
});

test('with reduced motion an arrival is a still banner', async ({ page }) => {
  await prepare(page, { reduced: true });
  await openLobby(page);
  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_kim-long'));

  await expect(page.locator('.hs-banner--page')).toContainText('Bảo Ngọc đã vào sảnh · Kim Long Giáng Thế');
  await expect(page.locator('.hs-stage')).toHaveCount(0);
  await expect(page.locator('.hs-fx--page')).toHaveCount(0);
});

test('nothing plays once the game has started', async ({ page }) => {
  await prepare(page);
  await page.route(`**/api/rooms/${ROOM_ID}`, (route) => ok(route, room()));
  await openLobby(page);

  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_kim-long'));
  await emit(page, 'PlayerEntrance', entrance('me', 'Tuấn Yên', 'entrance_van-kiem'));
  await expect(page.locator('.hs-stage')).toBeVisible();

  await emit(page, 'GameStarted', { roomId: ROOM_ID, room: room('IN_PROGRESS') });

  await expect(page.locator('.hs-stage')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/game/${ROOM_ID}$`));
});

test('an event from another room is ignored', async ({ page }) => {
  await prepare(page);
  await openLobby(page);
  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_kim-long', { roomId: 'other-room' }));
  await page.waitForTimeout(300);
  await expect(page.locator('.hs-stage')).toHaveCount(0);
});

test('a hostile name reaches the screen as plain text', async ({ page }) => {
  await prepare(page);
  const errors = collectPageErrors(page);
  await openLobby(page);
  await emit(page, 'PlayerEntrance', entrance('b', '<img src=x onerror="window.__xss=1">', 'entrance_kim-long'));
  await expect(page.locator('.hs-stage .hs-hn')).toHaveText('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('an unknown entrance id falls back to the quiet one instead of failing', async ({ page }) => {
  await prepare(page);
  const errors = collectPageErrors(page);
  await openLobby(page);
  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_khong-co'));
  await expect(page.locator('.hs-fx--page')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('leaving the lobby ends the entrance and everything drawn for it', async ({ page }) => {
  await prepare(page);
  await openLobby(page);
  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_kim-long'));
  await expect(page.locator('.hs-stage')).toBeVisible();

  await page.evaluate(() => { history.pushState(null, '', '/market'); dispatchEvent(new PopStateEvent('popstate')); });

  await expect(page.locator('.hs-stage')).toHaveCount(0);
  await expect(page.locator('.hs-fx--page')).toHaveCount(0);
});

test('a phone shows the seat and the stage without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await openLobby(page);
  await expect(page.locator('canvas[data-seat-avatar]').first()).toBeVisible();
  // The route's lens transition overflows on its own for a moment, on every page; measure after it.
  await expect(page.locator('.bpa-rim')).toHaveCount(0);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await emit(page, 'PlayerEntrance', entrance('b', 'Bảo Ngọc', 'entrance_phuong-hoang'));
  await expect(page.locator('.hs-stage')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ qua' })).toBeInViewport();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
