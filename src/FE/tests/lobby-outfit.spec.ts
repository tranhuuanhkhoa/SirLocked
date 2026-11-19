import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Phòng chờ: once a player has a role, an outfit strip under "Chọn vai trò" offers that detective's outfits
 * (Thẩm vấn viên = Sherlock, Điều tra viên = Watson). Owned ones are worn with PUT /api/rooms/{id}/outfit, missing
 * ones show where they come from, and every seat card draws its player in the outfit the server says they wear.
 */
const ROOM_ID = 'room-1';
const SHERLOCK = 'skin_sherlock_whitechapel';
const WATSON = 'skin_watson_whitechapel';

const player = (userId: string, username: string, overrides: Record<string, unknown> = {}) => ({
  userId, username, role: null, isReady: false, isConnected: true,
  level: 1, avatar: 'nonla', avatarUrl: null, frameDefId: null, titleDefId: 'title_tan-binh', entranceDefId: 'entrance_lang-le', skinDefIds: [],
  ...overrides,
});

const room = (players = [player('me', 'Tuấn Yên'), player('b', 'Bảo Ngọc')]) => ({
  roomId: ROOM_ID, roomCode: 'ABC123', caseId: 'case-1', caseTitle: 'Vụ án thử', hostUserId: 'me', status: 'WAITING', visibility: 'PRIVATE', players, createdAt: new Date().toISOString(),
});

const def = (id: string, category: string, name: string, nameEn: string) => ({
  id, category, rarity: 'LEGENDARY', name, nameEn, description: '', descriptionEn: '', referencePrice: 5200, iconKey: null, tradable: true,
  visual: { iconKey: null, imageUrl: `/assets/pixel/skins/whitechapel/icon-${category === 'SKIN_SHERLOCK' ? 'sherlock' : 'watson'}.png`, builtinId: null, template: null, params: {} },
});
const SHERLOCK_DEF = def(SHERLOCK, 'SKIN_SHERLOCK', 'Sherlock · Kẻ Săn Bóng Đêm', 'Sherlock · Night Hunter');
const WATSON_DEF = def(WATSON, 'SKIN_WATSON', 'Watson · Bác Sĩ Mỏ Quạ', 'Watson · Plague Doctor');

const chests = {
  chests: [{ id: 'chest_wc', name: 'Hòm Đêm Whitechapel', nameEn: 'Whitechapel Night Case', contents: [SHERLOCK_DEF, WATSON_DEF] }],
  odds: [], offSale: [], wallet: { coins: 0 }, chestsForSale: false,
};

const owned = (itemId: string, d: typeof SHERLOCK_DEF, overrides: Record<string, unknown> = {}) => ({
  itemId, def: d, locked: false, lockReason: null, listingId: null, listingPrice: null, equipped: false, source: 'CHEST', acquiredAt: new Date().toISOString(),
  ...overrides,
});

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

type Setup = { currentRoom?: ReturnType<typeof room>; items?: unknown[]; equipped?: Record<string, string> };

async function prepare(page: Page, { currentRoom = room(), items = [], equipped = {} }: Setup = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'lobby-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'me', fullName: 'Tuấn Yên', role: 'PLAYER', isEmailVerified: true }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  let current = currentRoom;
  const puts: { category: string; itemId: string | null }[] = [];
  const calls = { inventory: 0 };
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === `/api/rooms/${ROOM_ID}` && method === 'GET') return ok(route, current);
    if (url.pathname === `/api/rooms/${ROOM_ID}/select-role` && method === 'POST') {
      const { role } = route.request().postDataJSON();
      current = { ...current, players: current.players.map((p) => (p.userId === 'me' ? { ...p, role } : p)) };
      return ok(route, current);
    }
    if (url.pathname === `/api/rooms/${ROOM_ID}/outfit` && method === 'PUT') {
      const body = route.request().postDataJSON();
      puts.push(body);
      const wornDef = body.itemId ? (items as any[]).find((item) => item.itemId === body.itemId)?.def.id : null;
      current = {
        ...current,
        players: current.players.map((p) => (p.userId === 'me'
          ? { ...p, skinDefIds: [...(p.skinDefIds as string[]).filter((id) => !id.startsWith(body.category === 'SKIN_SHERLOCK' ? 'skin_sherlock' : 'skin_watson')), ...(wornDef ? [wornDef] : [])] }
          : p)),
      };
      return ok(route, current);
    }
    if (url.pathname === '/api/market/inventory') {
      calls.inventory += 1;
      return ok(route, { items, wallet: { coins: 0 }, equipped });
    }
    if (url.pathname === '/api/chests') return ok(route, chests);
    return ok(route, null);
  });
  return { puts, calls };
}

/** Whether a canvas has any painted pixel: the animator really drew the sheet. */
const painted = (page: Page, selector: string) => page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d');
  if (!context || !canvas.width) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return true;
  return false;
});

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

const strip = (page: Page) => page.locator('[data-outfit-strip]');
const card = (page: Page, defId: string) => strip(page).locator(`[data-outfit="${defId}"]`);

test('no role yet: no outfit strip and no figure on the seats', async ({ page }) => {
  await prepare(page);
  const errors = collectPageErrors(page);
  await openLobby(page);

  await expect(page.locator('.bpa-lobby-roles')).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator('canvas[data-seat-figure]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('picking Thẩm vấn viên shows Sherlock\'s outfits, a missing one locked with where it comes from', async ({ page }) => {
  await prepare(page);
  const errors = collectPageErrors(page);
  await openLobby(page);

  await page.locator('[data-role="INTERROGATOR"]').click();

  await expect(strip(page)).toBeVisible();
  await expect(strip(page)).toContainText('Trang phục · Sherlock');
  await expect(card(page, 'normal')).toHaveAttribute('aria-pressed', 'true');
  const locked = card(page, SHERLOCK);
  await expect(locked).toContainText('Kẻ Săn Bóng Đêm');
  await expect(locked).toHaveAttribute('aria-disabled', 'true');
  await expect(locked).toHaveClass(/is-locked/);
  await expect(strip(page)).toContainText('Có trong Hòm Đêm Whitechapel');
  await expect(strip(page).locator('a[href="/kho-ruong"]')).toHaveAttribute('target', '_blank');
  await expect(strip(page).locator('a[href="/kho-ruong"]')).toContainText('mở trong tab mới');
  await expect(strip(page).locator(`a[href^="/market?q="]`)).toHaveAttribute('target', '_blank');
  await expect(card(page, WATSON)).toHaveCount(0);
  await expect(strip(page).locator('canvas[data-outfit-preview]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('picking Điều tra viên shows Watson\'s outfits instead', async ({ page }) => {
  await prepare(page, { currentRoom: room([player('me', 'Tuấn Yên', { role: 'INVESTIGATOR' }), player('b', 'Bảo Ngọc')]) });
  await openLobby(page);

  await expect(strip(page)).toContainText('Trang phục · Watson');
  await expect(card(page, WATSON)).toContainText('Bác Sĩ Mỏ Quạ');
  await expect(card(page, SHERLOCK)).toHaveCount(0);
});

test('an owned outfit is worn with one click and the seat card shows it; Thường takes it off', async ({ page }) => {
  const { puts } = await prepare(page, {
    currentRoom: room([player('me', 'Tuấn Yên', { role: 'INTERROGATOR' }), player('b', 'Bảo Ngọc')]),
    items: [owned('it-1', SHERLOCK_DEF), owned('it-2', SHERLOCK_DEF)],
  });
  const errors = collectPageErrors(page);
  await openLobby(page);

  await expect(card(page, SHERLOCK)).toHaveCount(1); // two copies, one card
  await expect(card(page, SHERLOCK)).not.toHaveClass(/is-locked/);
  await expect(page.locator('[data-seat-user="me"] canvas[data-seat-figure]')).toHaveAttribute('data-look', 'normal');

  await card(page, SHERLOCK).click();

  await expect.poll(() => puts).toEqual([{ category: 'SKIN_SHERLOCK', itemId: 'it-1' }]);
  await expect(card(page, SHERLOCK)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'normal')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-seat-user="me"] canvas[data-seat-figure]')).toHaveAttribute('data-look', SHERLOCK);
  await expect.poll(() => painted(page, '[data-seat-user="me"] canvas[data-seat-figure]')).toBe(true);
  await expect.poll(() => painted(page, `[data-outfit-preview="${SHERLOCK}"]`)).toBe(true);

  await card(page, 'normal').click();

  await expect.poll(() => puts.length).toBe(2);
  expect(puts[1]).toEqual({ category: 'SKIN_SHERLOCK', itemId: null });
  await expect(card(page, 'normal')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-seat-user="me"] canvas[data-seat-figure]')).toHaveAttribute('data-look', 'normal');
  expect(errors).toEqual([]);
});

test('an outfit that is for sale says so and cannot be worn', async ({ page }) => {
  const { puts } = await prepare(page, {
    currentRoom: room([player('me', 'Tuấn Yên', { role: 'INTERROGATOR' }), player('b', 'Bảo Ngọc')]),
    items: [owned('it-1', SHERLOCK_DEF, { locked: true, lockReason: 'LISTED', listingId: 'l-1', listingPrice: 6000 })],
  });
  await openLobby(page);

  await expect(card(page, SHERLOCK)).toContainText('Đang rao bán');
  await expect(card(page, SHERLOCK)).toHaveAttribute('aria-disabled', 'true');
  await card(page, SHERLOCK).click({ force: true });
  await page.waitForTimeout(200);
  expect(puts).toEqual([]);
});

test('the partner\'s seat follows the outfit the room says they wear', async ({ page }) => {
  await prepare(page, { currentRoom: room([player('me', 'Tuấn Yên'), player('b', 'Bảo Ngọc', { role: 'INVESTIGATOR' })]) });
  await openLobby(page);
  const figure = page.locator('[data-seat-user="b"] canvas[data-seat-figure]');
  await expect(figure).toHaveAttribute('data-look', 'normal');

  await emit(page, 'RolesUpdated', { room: room([player('me', 'Tuấn Yên'), player('b', 'Bảo Ngọc', { role: 'INVESTIGATOR', skinDefIds: [WATSON] })]) });

  await expect(figure).toHaveAttribute('data-look', WATSON);
});

test('a refused change shows the server\'s reason, keeps the old outfit and asks for the inventory again', async ({ page }) => {
  const { calls } = await prepare(page, {
    currentRoom: room([player('me', 'Tuấn Yên', { role: 'INTERROGATOR' }), player('b', 'Bảo Ngọc')]),
    items: [owned('it-1', SHERLOCK_DEF)],
  });
  await page.route(`**/api/rooms/${ROOM_ID}/outfit`, (route) => route.fulfill({
    status: 409, json: { success: false, message: 'Món này đang được rao bán.', data: null, errors: null },
  }));
  await openLobby(page);
  await expect(card(page, SHERLOCK)).not.toHaveClass(/is-locked/);
  const before = calls.inventory;

  await card(page, SHERLOCK).click();

  await expect(page.getByText('Món này đang được rao bán.')).toBeVisible();
  await expect(card(page, 'normal')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => calls.inventory).toBe(before + 1); // it may have been listed or sold in another tab
});

test('choosing with the keyboard keeps focus on the chosen card', async ({ page }) => {
  await prepare(page, {
    currentRoom: room([player('me', 'Tuấn Yên', { role: 'INTERROGATOR' }), player('b', 'Bảo Ngọc')]),
    items: [owned('it-1', SHERLOCK_DEF)],
  });
  await openLobby(page);
  await expect(card(page, SHERLOCK)).not.toHaveClass(/is-locked/);

  await card(page, SHERLOCK).focus();
  await page.keyboard.press('Enter');

  await expect(card(page, SHERLOCK)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, SHERLOCK)).toBeFocused();
});

test('coming back to the tab with nothing new leaves the page as it was', async ({ page }) => {
  const { calls } = await prepare(page, { currentRoom: room([player('me', 'Tuấn Yên', { role: 'INTERROGATOR' }), player('b', 'Bảo Ngọc')]) });
  await openLobby(page);
  await expect(card(page, SHERLOCK)).toBeVisible();
  await strip(page).evaluate((el) => { (el as any).__sameNode = true; });
  const before = calls.inventory;

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect.poll(() => calls.inventory).toBe(before + 1);
  await page.waitForTimeout(300);
  expect(await strip(page).evaluate((el) => (el as any).__sameNode === true)).toBe(true);
});

test('in English the strip is in English', async ({ page }) => {
  await prepare(page, { currentRoom: room([player('me', 'Tuấn Yên', { role: 'INTERROGATOR' }), player('b', 'Bảo Ngọc')]) });
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'en'));
  await openLobby(page);

  await expect(strip(page)).toContainText('Outfit · Sherlock');
  await expect(card(page, SHERLOCK)).toContainText('Night Hunter');
  await expect(strip(page)).toContainText('Found in the Whitechapel Night Case');
});

test('the market link opens the buy tab already searching for that outfit', async ({ page }) => {
  await prepare(page);
  const searches: string[] = [];
  await page.route((url) => url.pathname === '/api/market/items', (route) => {
    searches.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    return ok(route, { items: [], total: 0, page: 1, pageSize: 24 });
  });
  await page.goto(`/market?q=${encodeURIComponent('Sherlock · Kẻ Săn Bóng Đêm')}`);

  await expect(page.locator('#mk-q')).toHaveValue('Sherlock · Kẻ Săn Bóng Đêm');
  await expect.poll(() => searches).toContain('Sherlock · Kẻ Săn Bóng Đêm');
});

test('coming back to the lobby tab (after opening a chest elsewhere) unlocks the outfit just won', async ({ page }) => {
  const items: unknown[] = [];
  await prepare(page, { currentRoom: room([player('me', 'Tuấn Yên', { role: 'INTERROGATOR' }), player('b', 'Bảo Ngọc')]), items });
  await openLobby(page);
  await expect(card(page, SHERLOCK)).toHaveClass(/is-locked/);

  items.push(owned('it-9', SHERLOCK_DEF));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(card(page, SHERLOCK)).not.toHaveClass(/is-locked/);
  await expect(card(page, SHERLOCK)).not.toHaveAttribute('aria-disabled', 'true');
});
