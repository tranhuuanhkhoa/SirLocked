import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Hồ sơ thám tử (#/detective) with a mocked API: what is owned, worn and earned comes from the server, an
 * exchange is confirmed and carries one idempotency key per action, and leaving the page stops every animation.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const def = (id: string, name: string, rarity: string) => ({
  id, category: 'CURIO', rarity, name, nameEn: name, description: '', descriptionEn: '', referencePrice: 100, iconKey: 'lantern', tradable: true,
});
const LANTERN = def('VC-0391', 'Đèn bão', 'RARE');
const BADGE = def('VC-0405', 'Huy hiệu sở', 'EPIC');

const WALLET = { balance: 500, held: 0, slotsUsed: 3, slotCap: 12, itemCount: 3, reservedSlots: 0, feePercent: 5 };

const achievements = (overrides: Record<string, unknown>[] = []) => [
  { titleDefId: 'title_khach-quen', countable: true, count: 3, target: 10, earned: false },
  { titleDefId: 'title_tho-khoa', countable: false, count: 0, target: 25, earned: false },
  { titleDefId: 'title_bach-nguyet', countable: true, count: 0, target: 1, earned: false },
  ...overrides,
];

type Progress = ReturnType<typeof progress>;
const progress = (overrides: Record<string, unknown> = {}) => ({
  level: 9, xp: 120, xpToNext: 520, maxLevel: 50, isMaxLevel: false,
  avatar: 'nonla', avatarUrl: null as string | null, canUploadAvatar: false,
  frameDefId: null as string | null, titleDefId: 'title_tan-binh', entranceDefId: 'entrance_lang-le',
  exchangeable: [
    { itemId: 'lamp-1', def: LANTERN, xp: 150 },
    { itemId: 'lamp-2', def: LANTERN, xp: 150 },
    { itemId: 'badge-1', def: BADGE, xp: 600 },
  ],
  owned: [] as Array<Record<string, unknown>>,
  achievements: achievements(),
  ...overrides,
});

const owned = (itemId: string, defId: string, category: string, equipped = false) => ({ itemId, defId, category, source: 'CHEST', locked: false, equipped });

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
const fail = (route: Route, status: number, code: string) =>
  route.fulfill({ status, json: { success: false, message: code, errors: { code, messageKey: `market.${code}` } } });

async function prepare(page: Page, me: Progress, { reduced = true } = {}) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'profile-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'player-1', fullName: 'Tuấn Yên', role: 'PLAYER', isEmailVerified: true,
    }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
    // Counts animation frames, so a test can tell whether anything still draws.
    (window as any).__raf = 0;
    const native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => { (window as any).__raf++; return native(callback); };
  });
  const state = { me, calls: { exchange: [] as any[], equip: [] as string[], unequip: [] as string[], avatar: [] as string[] } };
  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
  await page.route('**/api/market/me', (route) => ok(route, WALLET));
  await page.route('**/api/profile/me', (route) => ok(route, {
    displayName: 'Tuấn Yên', role: 'PLAYER', casesPlayed: 0, casesSolved: 0, successRate: 0, isEmailVerified: true, hasPassword: false,
    rank: { tier: 'APPRENTICE', tierLabel: 'Tập sự', solved: 0, nextThreshold: 3, nextTierLabel: 'Thám tử', progressPercent: 0 },
  }));
  await page.route('**/api/progress/me', (route) => ok(route, state.me));
  await page.route(/\/api\/market\/inventory\/[^/]+\/equip$/, (route) => {
    const itemId = route.request().url().split('/').at(-2)!;
    state.calls.equip.push(itemId);
    const item = state.me.owned.find((entry) => entry.itemId === itemId)!;
    const slot = { FRAME: 'frameDefId', TITLE: 'titleDefId', ENTRANCE: 'entranceDefId' }[item.category as string]!;
    state.me = { ...state.me, [slot]: item.defId };
    return ok(route, { items: [], wallet: WALLET, equipped: {} });
  });
  await page.route(/\/api\/market\/equipped\/[A-Z]+$/, (route) => {
    const category = route.request().url().split('/').at(-1)!;
    state.calls.unequip.push(category);
    if (category === 'FRAME') state.me = { ...state.me, frameDefId: null };
    if (category === 'TITLE') state.me = { ...state.me, titleDefId: 'title_tan-binh' };
    if (category === 'ENTRANCE') state.me = { ...state.me, entranceDefId: 'entrance_lang-le' };
    return ok(route, { items: [], wallet: WALLET, equipped: {} });
  });
  await page.route('**/api/progress/avatar', (route) => {
    const { avatar } = route.request().postDataJSON();
    state.calls.avatar.push(avatar);
    state.me = { ...state.me, avatar };
    return ok(route, state.me);
  });
  return state;
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name });

test('the profile keeps what it had and adds the portrait with four tabs', async ({ page }) => {
  await prepare(page, progress());
  const errors = collectPageErrors(page);
  await page.goto('/#/detective');

  await expect(page.locator('.hs-name')).toHaveText('Tuấn Yên');
  await expect(page.locator('[data-hs-level]')).toHaveText('9');
  await expect(page.locator('[data-hs-xp]')).toHaveText('120 / 520 KN');
  await expect(page.locator('[data-hs-title] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Tân Binh');
  await expect(page.getByRole('tab')).toHaveText(['Đổi kinh nghiệm', 'Viền avatar', 'Danh hiệu', 'Hiệu ứng vào sảnh']);
  // What was on the page before.
  await expect(page.locator('.bpa-profile-id')).toBeVisible();
  await expect(page.locator('.bpa-profile-cabinet')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the title font is requested for the plaques', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/#/detective');
  await expect(page.locator('link[href*="fonts.googleapis.com"]').first()).toHaveAttribute('href', /Cormorant\+SC/);
});

test('exchanging one item sends its id with a fresh key and shows the new level', async ({ page }) => {
  const state = await prepare(page, progress());
  await page.route('**/api/progress/exchange', (route) => {
    state.calls.exchange.push(route.request().postDataJSON());
    state.me = progress({ xp: 270, exchangeable: state.me.exchangeable.filter((item) => item.itemId !== 'lamp-1') });
    return ok(route, { level: 9, xp: 270, xpToNext: 520, isMaxLevel: false, xpGained: 150, newFrameDefIds: [], newTitleDefIds: [], wallet: WALLET });
  });
  await page.goto('/#/detective');

  const row = page.locator('.hs-ex', { hasText: 'Đèn bão' });
  await expect(row).toContainText('Hiếm · ×2 · +150 KN mỗi món');
  await row.getByRole('button', { name: 'Đổi 1' }).click();

  await expect(page.locator('[data-hs-xp]')).toHaveText('270 / 520 KN');
  await expect(row).toContainText('×1');
  expect(state.calls.exchange).toHaveLength(1);
  expect(state.calls.exchange[0].itemIds).toEqual(['lamp-1']);
  expect(state.calls.exchange[0].idempotencyKey).toMatch(UUID);
});

test('exchanging everything asks first, because the items are gone for good', async ({ page }) => {
  const state = await prepare(page, progress());
  await page.route('**/api/progress/exchange', (route) => {
    state.calls.exchange.push(route.request().postDataJSON());
    state.me = progress({ level: 10, xp: 0, xpToNext: 560, exchangeable: [] });
    return ok(route, { level: 10, xp: 0, xpToNext: 560, isMaxLevel: false, xpGained: 900, newFrameDefIds: [], newTitleDefIds: [], wallet: WALLET });
  });
  await page.goto('/#/detective');

  await page.getByRole('button', { name: /Đổi tất cả · \+900 KN/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Đổi 3 vật phẩm lấy 900 KN?');
  await expect(dialog).toContainText('mất vĩnh viễn');

  await dialog.getByRole('button', { name: 'Giữ lại' }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.calls.exchange).toHaveLength(0);

  await page.getByRole('button', { name: /Đổi tất cả/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.calls.exchange).toHaveLength(0);

  await page.getByRole('button', { name: /Đổi tất cả/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Đổi', exact: true }).click();
  await expect(page.locator('[data-hs-level]')).toHaveText('10');
  expect(state.calls.exchange).toHaveLength(1);
  expect([...state.calls.exchange[0].itemIds].sort()).toEqual(['badge-1', 'lamp-1', 'lamp-2']);
  await expect(page.getByRole('button', { name: 'Hết vật phẩm để đổi' })).toBeDisabled();
});

test('near the top level, the confirmation warns that XP beyond it is lost', async ({ page }) => {
  // 120 XP short of level 50, with 900 XP on offer: 780 XP would go nowhere.
  await prepare(page, progress({ level: 49, xp: 2000, xpToNext: 2120 }));
  await page.goto('/#/detective');
  await page.getByRole('button', { name: /Đổi tất cả/ }).click();
  await expect(page.getByRole('dialog')).toContainText('780 KN dư sẽ mất');
});

test('far from the top level, the confirmation does not mention lost XP', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/#/detective');
  await page.getByRole('button', { name: /Đổi tất cả/ }).click();
  await expect(page.getByRole('dialog')).toContainText('mất vĩnh viễn');
  await expect(page.getByRole('dialog')).not.toContainText('KN dư');
});

test('a lost connection resends the same key, so a retry cannot pay twice', async ({ page }) => {
  const state = await prepare(page, progress());
  const keys: string[] = [];
  await page.route('**/api/progress/exchange', (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (keys.length === 1) return route.abort();
    state.me = progress({ xp: 270 });
    return ok(route, { level: 9, xp: 270, xpToNext: 520, isMaxLevel: false, xpGained: 150, newFrameDefIds: [], newTitleDefIds: [], wallet: WALLET });
  });
  await page.goto('/#/detective');

  const row = page.locator('.hs-ex', { hasText: 'Đèn bão' });
  await row.getByRole('button', { name: 'Đổi 1' }).click();
  await expect(page.locator('#toast-root')).toContainText('Không kết nối được máy chủ');
  await row.getByRole('button', { name: 'Đổi 1' }).click();
  await expect(page.locator('[data-hs-xp]')).toHaveText('270 / 520 KN');
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('a refusal from the server shows why and starts a new action next time', async ({ page }) => {
  await prepare(page, progress());
  const keys: string[] = [];
  await page.route('**/api/progress/exchange', (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    return fail(route, 409, 'XP_ITEM_EQUIPPED');
  });
  await page.goto('/#/detective');

  const row = page.locator('.hs-ex', { hasText: 'Đèn bão' });
  await row.getByRole('button', { name: 'Đổi 1' }).click();
  await expect(page.locator('#toast-root')).toContainText('Hãy bỏ dùng vật phẩm trước khi đổi');
  await row.getByRole('button', { name: 'Đổi 1' }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).not.toBe(keys[0]);
});

test('at the highest level nothing can be exchanged', async ({ page }) => {
  await prepare(page, progress({ level: 50, xp: 0, xpToNext: 0, isMaxLevel: true }));
  await page.goto('/#/detective');

  await expect(page.locator('[data-hs-xp]')).toHaveText('Cấp tối đa');
  await expect(page.locator('#hs-p-doi')).toContainText('Bạn đã đạt cấp cao nhất');
  await expect(page.locator('.hs-ex').first().getByRole('button', { name: 'Đổi 1' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Đổi tất cả/ })).toBeDisabled();
});

test('with nothing to exchange the page points at the chests', async ({ page }) => {
  await prepare(page, progress({ exchangeable: [] }));
  await page.goto('/#/detective');
  await expect(page.locator('#hs-p-doi a[href="#/kho-ruong"]')).toBeVisible();
});

test('a new frame opens the unlock screen, and "use now" equips it', async ({ page }) => {
  const state = await prepare(page, progress());
  await page.route('**/api/progress/exchange', (route) => {
    state.me = progress({ level: 10, xp: 0, xpToNext: 560, owned: [owned('frame-1', 'frame_dong', 'FRAME')] });
    return ok(route, { level: 10, xp: 0, xpToNext: 560, isMaxLevel: false, xpGained: 600, newFrameDefIds: ['frame_dong'], newTitleDefIds: [], wallet: WALLET });
  });
  await page.goto('/#/detective');

  await page.locator('.hs-ex', { hasText: 'Huy hiệu sở' }).getByRole('button', { name: 'Đổi 1' }).click();

  const dialog = page.getByRole('dialog', { name: 'Mở khóa viền mới' });
  await expect(dialog).toContainText('Cấp 10 · mở khóa viền mới');
  await expect(dialog.getByRole('heading')).toHaveText('Đồng Cổ');
  await dialog.getByRole('button', { name: 'Dùng ngay' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.calls.equip).toEqual(['frame-1']);
  await expect.poll(() => state.me.frameDefId).toBe('frame_dong');
});

test('the frames tab shows every frame, locks what is not owned, and equips what is', async ({ page }) => {
  const state = await prepare(page, progress({
    owned: [owned('stone', 'frame_thach', 'FRAME'), owned('gold', 'frame_kimlong', 'FRAME')],
  }));
  await page.goto('/#/detective');
  await tab(page, 'Viền avatar').click();

  await expect(page.locator('.hs-fr')).toHaveCount(17);
  await expect(page.locator('.hs-group-label')).toHaveCount(4);
  const dragon = page.locator('[data-hs-frame="kimlong"]');
  await expect(dragon).not.toHaveClass(/hs-locked/);
  const silver = page.locator('[data-hs-frame="bac"]');
  await expect(silver).toHaveClass(/hs-locked/);
  await expect(silver).toContainText('Cấp 20');
  await expect(page.locator('[data-hs-frame="ulinh"]')).toContainText('Ra từ Hòm Niêm Phong');
  await expect(page.locator('[data-hs-frame="none"]')).toHaveAttribute('aria-pressed', 'true');

  await silver.click();
  expect(state.calls.equip).toEqual([]);
  await expect(page.locator('[data-hs-live]')).toContainText('Bạc Nguyệt chưa mở');

  await dragon.click();
  await expect.poll(() => state.calls.equip).toEqual(['gold']);
  await expect(page.locator('[data-hs-frame="kimlong"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-hs-frame="none"]').click();
  await expect.poll(() => state.calls.unequip).toEqual(['FRAME']);
  await expect(page.locator('[data-hs-frame="none"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the titles tab shows progress, and a title the record cannot count says so', async ({ page }) => {
  const state = await prepare(page, progress({ owned: [owned('t-1', 'title_long-phung', 'TITLE')] }));
  await page.goto('/#/detective');
  await tab(page, 'Danh hiệu').click();

  await expect(page.locator('.hs-ti')).toHaveCount(25);
  await expect(page.locator('[data-hs-title-id="khach-quen"]')).toContainText('Chơi 10 vụ · 3 / 10');
  await expect(page.locator('[data-hs-title-id="tho-khoa"]')).toContainText('Chưa mở · Giải 25 câu đố ổ khóa');
  await expect(page.locator('[data-hs-title-id="tho-khoa"]')).toHaveClass(/hs-locked/);

  await page.locator('[data-hs-title-id="tho-khoa"]').click();
  expect(state.calls.equip).toEqual([]);

  await page.locator('[data-hs-title-id="long-phung"]').click();
  await expect.poll(() => state.calls.equip).toEqual(['t-1']);
  await expect(page.locator('[data-hs-title] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Long Phụng Thần Thám');

  await page.locator('[data-hs-title-id="tan-binh"]').click();
  await expect.poll(() => state.calls.unequip).toEqual(['TITLE']);
});

test('the entrance tab says what really happens, and only owned entrances can be used', async ({ page }) => {
  const state = await prepare(page, progress({ owned: [owned('e-1', 'entrance_anh-trang', 'ENTRANCE')] }));
  await page.goto('/#/detective');
  await tab(page, 'Hiệu ứng vào sảnh').click();

  await expect(page.locator('.hs-en')).toHaveCount(10);
  const hint = page.locator('#hs-p-sanh .hs-hint');
  await expect(hint).toContainText('mọi người trong phòng đều thấy');
  await expect(hint).not.toContainText('vào trận');
  await expect(page.locator('[data-hs-entrance="lang-le"] [data-use]')).toHaveText('Đang dùng');
  await expect(page.locator('[data-hs-entrance="kim-long"] [data-use]')).toBeDisabled();
  await expect(page.locator('[data-hs-entrance="kim-long"] [data-use]')).toHaveText('Chưa có');

  await page.locator('[data-hs-entrance="anh-trang"] [data-use]').click();
  await expect.poll(() => state.calls.equip).toEqual(['e-1']);
  await expect(page.locator('[data-hs-entrance="anh-trang"] [data-use]')).toHaveText('Đang dùng');
});

test('previewing runs the full-screen stage even for an entrance not owned, and can be skipped', async ({ page }) => {
  await prepare(page, progress(), { reduced: false });
  const errors = collectPageErrors(page);
  await page.goto('/#/detective');
  await tab(page, 'Hiệu ứng vào sảnh').click();

  await page.locator('[data-hs-entrance="kim-long"] [data-try]').click();
  const stage = page.locator('.hs-stage');
  await expect(stage).toBeVisible();
  await expect(stage.locator('.hs-hn')).toHaveText('Tuấn Yên');
  await expect(stage.locator('.hs-hero small')).toHaveText('đã vào sảnh · Kim Long Giáng Thế');
  await stage.getByRole('button', { name: 'Bỏ qua' }).click();
  await expect(stage).toHaveCount(0);

  await page.locator('[data-hs-entrance="van-kiem"] [data-try]').click();
  await expect(stage).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(stage).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const id of ['lang-le', 'anh-trang', 'mac-vu', 'truc-lam', 'van-kiem', 'huyet-nguyet', 'hac-duc', 'than-tham', 'kim-long', 'phuong-hoang']) {
  test(`the ${id} stage plays without errors`, async ({ page }) => {
    await prepare(page, progress(), { reduced: false });
    const errors = collectPageErrors(page);
    await page.goto('/#/detective');
    await tab(page, 'Hiệu ứng vào sảnh').click();
    await page.locator(`[data-hs-entrance="${id}"] [data-try]`).click();
    await expect(page.locator('.hs-stage')).toBeVisible();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await expect(page.locator('.hs-stage')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('with reduced motion a preview is a still banner, never the full-screen stage', async ({ page }) => {
  await prepare(page, progress());
  await page.goto('/#/detective');
  await tab(page, 'Hiệu ứng vào sảnh').click();

  await page.locator('[data-hs-entrance="kim-long"] [data-try]').click();
  await expect(page.locator('.hs-banner--page')).toContainText('Tuấn Yên đã vào sảnh · Kim Long Giáng Thế');
  await expect(page.locator('.hs-stage')).toHaveCount(0);
});

test('the avatar picker offers the presets, remembers the choice, and hides upload without an image host', async ({ page }) => {
  const state = await prepare(page, progress());
  await page.goto('/#/detective');

  await page.getByRole('button', { name: 'Đổi ảnh đại diện' }).click();
  await expect(page.locator('[data-hs-avatar]')).toHaveCount(4);
  await expect(page.locator('[data-hs-upload]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Kiếm khách' }).click();
  await expect(page.getByRole('button', { name: 'Kiếm khách' })).toHaveAttribute('aria-pressed', 'true');
  expect(state.calls.avatar).toEqual(['kiem']);
});

test('with an image host the picker can upload, and refuses a wrong file on the spot', async ({ page }) => {
  const state = await prepare(page, progress({ canUploadAvatar: true }));
  let uploads = 0;
  await page.route('**/api/progress/avatar/upload', (route) => {
    uploads++;
    state.me = progress({ canUploadAvatar: true, avatar: 'upload', avatarUrl: 'https://res.cloudinary.com/test/a.webp' });
    return ok(route, state.me);
  });
  await page.goto('/#/detective');
  await page.getByRole('button', { name: 'Đổi ảnh đại diện' }).click();

  await page.locator('[data-hs-upload]').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.locator('#toast-root')).toContainText('JPG, PNG hoặc WebP');
  expect(uploads).toBe(0);

  await page.locator('[data-hs-upload]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await expect(page.locator('#toast-root')).toContainText('2 MB');
  expect(uploads).toBe(0);

  await page.locator('[data-hs-upload]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) });
  await expect(page.locator('[data-hs-avatar="upload"]')).toHaveAttribute('aria-pressed', 'true');
  expect(uploads).toBe(1);
});

test('a colleague sees the portrait and the level, but no tabs or buttons', async ({ page }) => {
  await prepare(page, progress());
  await page.route('**/api/profile/colleague-7', (route) => ok(route, {
    displayName: 'Bảo Ngọc', role: 'PLAYER', casesPlayed: 0, casesSolved: 0, successRate: 0,
    rank: { tier: 'APPRENTICE', tierLabel: 'Tập sự', solved: 0, nextThreshold: 3, nextTierLabel: 'Thám tử', progressPercent: 0 },
  }));
  await page.route('**/api/progress/users/colleague-7', (route) => ok(route, {
    level: 31, avatar: 'nu', avatarUrl: null, frameDefId: 'frame_ngoc', titleDefId: 'title_van-tay', entranceDefId: 'entrance_lang-le',
  }));
  await page.goto('/#/detective/colleague-7');

  await expect(page.locator('.hs-name')).toHaveText('Bảo Ngọc');
  await expect(page.locator('[data-hs-xp]')).toHaveText('Cấp 31');
  await expect(page.locator('[data-hs-title] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Chuyên Gia Vân Tay');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đổi ảnh đại diện' })).toHaveCount(0);
});

test('when the portrait cannot load, the rest of the profile still works', async ({ page }) => {
  await prepare(page, progress());
  await page.route('**/api/progress/me', (route) => fail(route, 500, 'BOOM'));
  await page.goto('/#/detective');

  await expect(page.locator('.hs-unavailable')).toBeVisible();
  await expect(page.locator('.bpa-profile-id')).toBeVisible();
});

test('leaving the page stops every animation and removes its overlays', async ({ page }) => {
  await prepare(page, progress(), { reduced: false });
  await page.goto('/#/detective');
  await tab(page, 'Hiệu ứng vào sảnh').click();
  await page.locator('[data-hs-entrance="kim-long"] [data-try]').click();
  await expect(page.locator('.hs-stage')).toBeVisible();

  await page.evaluate(() => { window.location.hash = '#/market'; });
  await expect(page.locator('.hs-root')).toHaveCount(0);
  await expect(page.locator('.hs-stage')).toHaveCount(0);

  // The route transition's lens may finish a few frames; after that nothing asks for another.
  await page.waitForTimeout(2000);
  const before = await page.evaluate(() => (window as any).__raf);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as any).__raf)).toBe(before);
});

test('tiles off screen do not keep the page animating, and going back and forth leaks nothing', async ({ page }) => {
  await prepare(page, progress(), { reduced: false });
  await page.goto('/#/detective');
  await expect(page.locator('[data-hs-me]')).toBeVisible();

  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { window.location.hash = '#/market'; });
    await expect(page.locator('.hs-root')).toHaveCount(0);
    await page.evaluate(() => { window.location.hash = '#/detective'; });
    await expect(page.locator('[data-hs-me]')).toBeVisible();
  }

  // One painter alive: about one requestAnimationFrame per display frame, not five.
  await page.waitForTimeout(1200);
  const start = await page.evaluate(() => (window as any).__raf);
  const elapsed = await page.evaluate(() => new Promise<number>((resolve) => {
    const t0 = performance.now();
    let frames = 0;
    const count = () => { if (++frames === 30) resolve(frames); else requestAnimationFrame(count); };
    requestAnimationFrame(count);
    void t0;
  }));
  const asked = (await page.evaluate(() => (window as any).__raf)) - start - elapsed;
  expect(asked).toBeLessThanOrEqual(45);

  // Scrolled out of view, the painter stops asking.
  await page.setViewportSize({ width: 1280, height: 200 });
  await page.evaluate(() => {
    document.documentElement.style.height = '6000px';
    window.scrollTo(0, 5000);
  });
  await page.waitForTimeout(700);
  const quiet = await page.evaluate(() => (window as any).__raf);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__raf)).toBe(quiet);
});

test('the page fits a phone, without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, progress({ owned: [owned('t-1', 'title_long-phung', 'TITLE')], titleDefId: 'title_long-phung' }));
  await page.goto('/#/detective');
  await expect(page.locator('.hs-name')).toBeVisible();

  for (const name of ['Đổi kinh nghiệm', 'Viền avatar', 'Danh hiệu', 'Hiệu ứng vào sảnh']) {
    await tab(page, name).click();
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${name} must not scroll sideways`).toBeLessThanOrEqual(0);
  }
});

for (const [id, category, name] of [
  ['frame_kimlong', 'FRAME', 'Kim Long'],
  ['title_long-phung', 'TITLE', 'Long Phụng Thần Thám'],
  ['entrance_kim-long', 'ENTRANCE', 'Kim Long Giáng Thế'],
] as const) {
  test(`opening a chest can reveal a ${category.toLowerCase()}, drawn with its own art`, async ({ page }) => {
    await prepare(page, progress());
    const errors = collectPageErrors(page);
    const cosmetic = { ...def(id, name, 'MYSTERY'), category, iconKey: id };
    const chest = (chestCount: number, keyCount: number) => ({
      id: 'chest_nb', keyDefId: 'key_nb', name: 'Két Nhà Băng', nameEn: 'Bank Safe', subtitle: 'Phố Tràng Tiền', subtitleEn: 'Trang Tien Street',
      keyName: 'chìa bánh răng', keyNameEn: 'gear key', iconKey: 'chest_bank', keyIconKey: 'key_gear', chestPrice: 170, keyPrice: 250, chestCount, keyCount,
      contents: [def('NB-1101', 'Đồng xu lỗ vuông', 'COMMON'), cosmetic],
    });
    await page.route('**/api/chests', (route) => ok(route, { chests: [chest(1, 1)], odds: [{ rarity: 'COMMON', percent: 50 }, { rarity: 'MYSTERY', percent: 50 }], wallet: WALLET }));
    await page.route('**/api/chests/chest_nb/open', (route) => ok(route, { chestId: 'chest_nb', itemId: 'reward', item: cosmetic, chestCount: 0, keyCount: 0, wallet: WALLET }));
    await page.goto('/#/kho-ruong');

    await expect(page.locator('#qh-contents .qh-it', { hasText: name })).toBeVisible();
    await page.locator('#qh-openBtn').click();

    await expect(page.locator('.qh-app')).toHaveAttribute('data-mode', 'reveal', { timeout: 30_000 });
    await expect(page.locator('#qh-gotName')).toHaveText(name);
    expect(errors).toEqual([]);
  });
}

test('the market shows cosmetic categories, and an earned item has no sell form', async ({ page }) => {
  const state = await prepare(page, progress());
  void state;
  const earned = { ...def('frame_dong', 'Đồng Cổ', 'COMMON'), category: 'FRAME', tradable: false };
  await page.route('**/api/market/inventory', (route) => ok(route, {
    items: [{ itemId: 'x', def: earned, locked: false, lockReason: null, listingId: null, listingPrice: null, equipped: false, source: 'GRANT', acquiredAt: new Date().toISOString() }],
    wallet: WALLET,
    equipped: {},
  }));
  await page.route('**/api/market/items**', (route) => ok(route, { rows: [], categoryCounts: {}, total: 0 }));
  await page.route('**/api/market/mine', (route) => ok(route, { listings: [], orders: [], history: [] }));
  await page.goto('/#/market');
  await expect(page.locator('[data-category="FRAME"]')).toContainText('Viền avatar');
  await expect(page.locator('[data-category="TITLE"]')).toContainText('Danh hiệu');
  await expect(page.locator('[data-category="ENTRANCE"]')).toContainText('Hiệu ứng vào sảnh');

  await page.goto('/#/market/sell');
  await page.locator('#mk-grid').getByRole('button', { name: /Đồng Cổ/ }).click();
  await expect(page.locator('#mk-sellpanel')).toContainText('không bán hay trao đổi được');
  await expect(page.locator('#mk-sellform')).toHaveCount(0);
});
