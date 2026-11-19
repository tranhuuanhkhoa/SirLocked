import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The player, economy and audit admin pages against a faked API that keeps state, so a click can be followed through to
 * what the server was asked and what the page shows next. The real API is exercised in full-stack.spec.ts.
 */
const USER_ID = '507f1f77bcf86cd799439071';
const XSS = '<img src=x onerror="window.__xss=1">';

const def = (id: string, name = id, category = 'CURIO', rarity = 'RARE') => ({
  id, name, nameEn: name, category, rarity, description: '', descriptionEn: '', referencePrice: 340, tradable: true, visual: null,
});

type Call = { method: string; path: string; search: URLSearchParams; body: any };

const row = (i: number, extra: Record<string, unknown> = {}) => ({
  userId: i === 0 ? USER_ID : `507f1f77bcf86cd7994390${String(i).padStart(2, '0')}`,
  fullName: `Thám tử ${i}`,
  email: `tham.tu.${i}@tests.invalid`,
  role: 'PLAYER',
  status: 'ACTIVE',
  isEmailVerified: true,
  createdAt: '2026-10-01T03:00:00Z',
  level: 3 + i,
  balance: 500 + i,
  held: 0,
  avatar: 'nonla',
  avatarUrl: null,
  ...extra,
});

function detail() {
  return {
    account: {
      userId: USER_ID, fullName: 'Thám tử An', email: 'an@tests.invalid', role: 'PLAYER', status: 'ACTIVE', isEmailVerified: true,
      hasPassword: true, hasSession: true, createdAt: '2026-10-01T03:00:00Z', updatedAt: '2026-10-02T03:00:00Z',
    },
    progress: { level: 12, xp: 30, xpToNext: 640, maxLevel: 50, avatar: 'upload', avatarUrl: 'https://img.test/an.webp', avatarUploadedAt: '2026-10-03T03:00:00Z' },
    wallet: { hasAccount: true, balance: 900, held: 200, slotsUsed: 4, slotCap: 12, itemCount: 3, reservedSlots: 1 },
    look: { frameDefId: 'frame_dong', titleDefId: 'title_van-tay', entranceDefId: 'entrance_lang-le' },
    inventory: [
      { itemId: 'free1', def: def('VC-0391', 'Đèn bão'), locked: false, lockReason: null, listingId: null, listingPrice: null, equipped: false, source: 'GRANT', acquiredAt: '2026-10-03T03:00:00Z', openTradeIds: [] },
      { itemId: 'listed1', def: def('VC-0419', 'Mũ thợ săn'), locked: true, lockReason: 'LISTED', listingId: 'l1', listingPrice: 700, equipped: false, source: 'CHEST', acquiredAt: '2026-10-03T03:00:00Z', openTradeIds: [] },
      { itemId: 'traded1', def: def('VC-0436', 'Kính lúp đồng'), locked: false, lockReason: null, listingId: null, listingPrice: null, equipped: false, source: 'CHEST', acquiredAt: '2026-10-03T03:00:00Z', openTradeIds: ['t1'] },
      { itemId: 'worn1', def: def('frame_vip', 'Viền VIP', 'FRAME'), locked: false, lockReason: null, listingId: null, listingPrice: null, equipped: true, source: 'GRANT', acquiredAt: '2026-10-03T03:00:00Z', openTradeIds: [] },
      { itemId: 'earned1', def: def('frame_dong', 'Viền đồng', 'FRAME'), locked: false, lockReason: null, listingId: null, listingPrice: null, equipped: false, source: 'LEVEL', acquiredAt: '2026-10-03T03:00:00Z', openTradeIds: [] },
    ],
  };
}

const page1 = (items: unknown[], total = items.length, page = 1, pageSize = 25) => ({ items, page, pageSize, total });

/** Answers every API call from `routes`, records it, and reports anything the page asked for that nobody expected. */
async function fakeApi(page: Page, routes: Record<string, (call: Call, route: Route) => unknown>, role = 'ADMIN') {
  const calls: Call[] = [];
  await page.addInitScript((userRole) => {
    localStorage.setItem('sirlocked.token', 'admin-test-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'u1', fullName: 'Yến', role: userRole, isEmailVerified: true }));
  }, role);
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call: Call = { method: request.method(), path: url.pathname, search: url.searchParams, body: request.postDataJSON?.() ?? null };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    if (!handler) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) });
    const answer = await handler(call, route);
    if (answer === undefined) return undefined;
    if (answer instanceof Failure) {
      return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify({ success: false, message: answer.message, errors: { code: answer.code } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: answer }) });
  });
  return calls;
}

class Failure {
  constructor(public status: number, public message: string, public code = 'X') {}
}

const dialog = (page: Page) => page.locator('dialog[open]');
const confirm = (page: Page) => dialog(page).locator('[data-confirm]');

async function expectNoPhoneOverflow(page: Page) {
  // The route's lens overflows for a moment on every page; only what stays counts.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { timeout: 8000 }).toBeLessThanOrEqual(0);
}

// ------------------------------------------------------------------ list

test('bảng người dùng ở /admin có email dài không làm tràn màn điện thoại', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeApi(page, {
    'GET /api/admin/dashboard': () => ({ totalUsers: 1, publishedCases: 0, totalCases: 0, activeRooms: 0, totalRooms: 0, wins: 0, losses: 0, totalAiDrafts: 0, legacyCasesHidden: true }),
    'GET /api/admin/users': () => [{
      userId: 'u9', fullName: 'Thám tử Có Một Cái Tên Khá Dài Để Thử', email: 'mot.dia.chi.email.rat.dai.de.thu.bang@tests.invalid',
      role: 'PLAYER', status: 'ACTIVE', isEmailVerified: true,
    }],
  });
  await page.goto('/admin');
  await expect(page.locator('.admin-table')).toContainText('mot.dia.chi.email.rat.dai.de.thu.bang@tests.invalid');
  await expectNoPhoneOverflow(page);
});

test.describe('danh sách người chơi', () => {
  test('tìm, lọc, sắp xếp và phân trang đều hỏi máy chủ, và không tải toàn bộ người dùng', async ({ page }) => {
    const calls = await fakeApi(page, {
      'GET /api/admin/players': (call) => page1([row(Number(call.search.get('page') ?? 1) === 2 ? 7 : 0)], 60, Number(call.search.get('page') ?? 1)),
    });
    await page.goto('/admin/players');
    await expect(page.getByText('Thám tử 0')).toBeVisible();
    await expect(page.getByText('tham.tu.0@tests.invalid')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Tìm người chơi' }).fill('an@');
    await page.getByRole('button', { name: 'Tìm', exact: true }).click();
    await expect.poll(() => calls.filter((c) => c.path === '/api/admin/players').at(-1)?.search.get('q')).toBe('an@');

    await page.getByLabel('Vai trò').selectOption('VIP');
    await expect.poll(() => calls.filter((c) => c.path === '/api/admin/players').at(-1)?.search.get('role')).toBe('VIP');
    await page.getByLabel('Trạng thái').selectOption('UNVERIFIED');
    await expect.poll(() => calls.filter((c) => c.path === '/api/admin/players').at(-1)?.search.get('status')).toBe('UNVERIFIED');
    await page.getByLabel('Sắp xếp').selectOption('coins');
    await expect.poll(() => calls.filter((c) => c.path === '/api/admin/players').at(-1)?.search.get('sort')).toBe('coins');

    await page.getByRole('button', { name: 'Trang sau' }).click();
    await expect(page.getByText('Thám tử 7')).toBeVisible();
    expect(calls.filter((c) => c.path === '/api/admin/players').at(-1)?.search.get('page')).toBe('2');
    expect(calls.some((c) => c.path === '/api/admin/users')).toBe(false);
  });

  test('bộ lọc đọc từ địa chỉ trang để mở lại đúng chỗ', async ({ page }) => {
    const calls = await fakeApi(page, { 'GET /api/admin/players': () => page1([row(0)], 60, 3) });
    await page.goto('/admin/players?page=3&q=binh&status=LOCKED');
    await expect(page.getByText('Thám tử 0')).toBeVisible();
    const asked = calls.find((c) => c.path === '/api/admin/players')!.search;
    expect(asked.get('page')).toBe('3');
    expect(asked.get('q')).toBe('binh');
    expect(asked.get('status')).toBe('LOCKED');
    await expect(page.getByRole('searchbox', { name: 'Tìm người chơi' })).toHaveValue('binh');
  });

  test('khóa tài khoản dùng API cũ, phải xác nhận và nhập lý do', async ({ page }) => {
    let locked = false;
    const calls = await fakeApi(page, {
      'GET /api/admin/players': () => page1([row(0, { status: locked ? 'LOCKED' : 'ACTIVE' })]),
      [`PATCH /api/admin/users/${USER_ID}/lock`]: () => { locked = true; return { userId: USER_ID, status: 'LOCKED' }; },
    });
    await page.goto('/admin/players');
    await page.getByRole('button', { name: 'Khóa Thám tử 0' }).click();

    await dialog(page).getByRole('button', { name: 'Hủy' }).click();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    await page.getByRole('button', { name: 'Khóa Thám tử 0' }).click();
    await confirm(page).click();
    await expect(dialog(page).getByRole('alert')).toContainText('lý do');
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    await dialog(page).getByLabel('Lý do').fill('Gian lận');
    await confirm(page).click();
    await expect(page.getByRole('button', { name: 'Mở khóa Thám tử 0' })).toBeVisible();
    expect(calls.find((c) => c.method === 'PATCH')!.search.get('reason')).toBe('Gian lận');
  });

  test('tên người chơi là dữ liệu, không bao giờ chạy như mã', async ({ page }) => {
    await fakeApi(page, {
      'GET /api/admin/players': () => page1([row(0, { fullName: XSS, email: XSS })]),
    });
    await page.goto('/admin/players');
    await expect(page.locator('.adp-table').getByText(XSS).first()).toBeVisible();
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });

  test('không có người chơi nào thì nói rõ, không để trang trắng', async ({ page }) => {
    await fakeApi(page, { 'GET /api/admin/players': () => page1([]) });
    await page.goto('/admin/players');
    await expect(page.getByText('Không có người chơi nào')).toBeVisible();
  });

  test('lỗi máy chủ hiện ra thành lời', async ({ page }) => {
    await fakeApi(page, { 'GET /api/admin/players': () => new Failure(500, 'Máy chủ gặp sự cố.') });
    await page.goto('/admin/players');
    await expect(page.getByRole('alert').first()).toContainText('Máy chủ gặp sự cố.');
  });
});

// ------------------------------------------------------------------ detail

test.describe('chi tiết người chơi', () => {
  const routes = () => ({ [`GET /api/admin/players/${USER_ID}`]: () => detail() });

  test('người chơi đang mặc mỹ phẩm do admin tạo: vẽ đúng, tên đúng, trang không lỗi', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const made = (id: string, category: string, name: string, template: string, params: Record<string, unknown>) => ({
      id, category, name, rarity: 'RARE', retired: false, visual: { iconKey: null, imageUrl: null, builtinId: null, template, params },
    });
    await fakeApi(page, {
      [`GET /api/admin/players/${USER_ID}`]: () => ({ ...detail(), look: { frameDefId: 'frame_tu-lam', titleDefId: 'title_tu-lam', entranceDefId: 'entrance_tu-lam' } }),
      'GET /api/cosmetics/catalog': () => ({
        defaults: {}, rareXp: 150, epicXp: 600,
        items: [
          made('frame_tu-lam', 'FRAME', 'Viền Tự Làm', 'builtin-clone', { base: 'dong' }),
          made('title_tu-lam', 'TITLE', 'Danh Hiệu Tự Làm', 'style', { style: 'ngoc' }),
          made('entrance_tu-lam', 'ENTRANCE', 'Bước Tự Làm', 'lang-le', {}),
        ],
      }),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    const look = page.locator('[data-adp-look]');
    await expect(look.locator('[data-adp-title] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Danh Hiệu Tự Làm');
    await expect(look).toContainText('Bước Tự Làm');
    // The painter runs on its own clock: an unknown frame throws on each repaint, not at once.
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('hiện đủ tài khoản, cấp, xu, kho đồ và mỹ phẩm đang mặc', async ({ page }) => {
    await fakeApi(page, routes());
    await page.goto(`/admin/players/${USER_ID}`);
    await expect(page.getByRole('heading', { name: 'Thám tử An' })).toBeVisible();
    await expect(page.getByText('an@tests.invalid')).toBeVisible();
    const summary = page.locator('[data-adp-summary]');
    await expect(summary).toContainText('12');
    await expect(summary).toContainText('900');
    await expect(summary).toContainText('200');
    await expect(summary).toContainText('4/12');
    // Drawn by the cosmetics module, read-only.
    await expect(page.locator('[data-adp-look] canvas')).toBeVisible();
    await expect(page.locator('[data-adp-look] [data-adp-title]')).not.toBeEmpty();
    await expect(page.locator('[data-adp-look]').locator('button')).toHaveCount(0);

    const inventory = page.locator('[data-adp-panel="kho"]');
    await expect(inventory.getByText('Đèn bão')).toBeVisible();
    await expect(inventory.locator('tr', { hasText: 'Mũ thợ săn' })).toContainText('Đang rao bán');
    await expect(inventory.locator('tr', { hasText: 'Mũ thợ săn' })).toContainText('700');
    await expect(inventory.locator('tr', { hasText: 'Kính lúp đồng' })).toContainText('Trong đề nghị trao đổi');
    await expect(inventory.locator('tr', { hasText: 'Viền VIP' })).toContainText('Đang dùng');
    await expect(inventory.locator('tr', { hasText: 'Viền đồng' }).getByRole('button', { name: /Thu hồi/ })).toHaveCount(0);
  });

  test('cộng xu: bắt nhập lý do, gửi khóa chống trùng, số dư đổi ngay', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/coins`]: () => ({ operationId: 'a:k', kind: 'COINS', userId: USER_ID, balance: 1150, held: 200, slotsUsed: 4, level: 12, xp: 30, grantedRewardDefIds: [], keptRewardDefIds: [] }),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await dialog(page).getByLabel('Số xu').fill('250');
    await confirm(page).click();
    await expect(dialog(page).getByRole('alert')).toContainText('lý do');

    await dialog(page).getByLabel('Lý do').fill('Bù lỗi sự kiện');
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('[data-adp-summary]')).toContainText('1.150');
    const sent = calls.find((c) => c.path.endsWith('/coins'))!.body;
    expect(sent.amount).toBe(250);
    expect(sent.reason).toBe('Bù lỗi sự kiện');
    expect(sent.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  test('người chưa mở ví: nói trước rằng ví được tạo kèm quà khởi đầu', async ({ page }) => {
    const fresh = detail();
    fresh.wallet = { hasAccount: false, balance: 0, held: 0, slotsUsed: 0, slotCap: 12, itemCount: 0, reservedSlots: 0 };
    await fakeApi(page, { [`GET /api/admin/players/${USER_ID}`]: () => fresh });
    await page.goto(`/admin/players/${USER_ID}`);
    await expect(page.locator('[data-adp-summary]')).toContainText('Chưa mở ví');
    await page.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await expect(dialog(page)).toContainText('500 xu quà khởi đầu');
  });

  test('mất mạng giữa chừng: thử lại dùng đúng khóa cũ nên không cộng hai lần', async ({ page }) => {
    let attempts = 0;
    const calls = await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/coins`]: (_call, route) => {
        attempts += 1;
        if (attempts === 1) { void route.abort('failed'); return undefined; }
        return { operationId: 'a:k', balance: 1000, held: 200, slotsUsed: 4, level: 12, xp: 30, grantedRewardDefIds: [], keptRewardDefIds: [] };
      },
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await dialog(page).getByLabel('Số xu').fill('100');
    await dialog(page).getByLabel('Lý do').fill('Bù lỗi sự kiện');
    await confirm(page).click();
    await expect(dialog(page).getByRole('alert')).not.toBeEmpty();
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    const keys = calls.filter((c) => c.path.endsWith('/coins')).map((c) => c.body.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('máy chủ từ chối hẳn: lần sau là thao tác mới với khóa mới, thông báo giữ nguyên trong hộp', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/coins`]: () => new Failure(409, 'Người chơi không đủ xu.', 'ADMIN_COINS_INSUFFICIENT'),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await dialog(page).getByLabel('Số xu').fill('-99999');
    await dialog(page).getByLabel('Lý do').fill('Phạt gian lận');
    await confirm(page).click();
    await expect(dialog(page).getByRole('alert')).toContainText('không đủ xu');
    await confirm(page).click();
    await expect.poll(() => calls.filter((c) => c.path.endsWith('/coins')).length).toBe(2);
    const keys = calls.filter((c) => c.path.endsWith('/coins')).map((c) => c.body.idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test('bấm đúp không gửi hai lần', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/coins`]: async () => {
        await new Promise((resolve) => { setTimeout(resolve, 300); });
        return { operationId: 'a:k', balance: 1000, held: 200, slotsUsed: 4, level: 12, xp: 30, grantedRewardDefIds: [], keptRewardDefIds: [] };
      },
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    await dialog(page).getByLabel('Số xu').fill('100');
    await dialog(page).getByLabel('Lý do').fill('Bù lỗi sự kiện');
    await confirm(page).dblclick();
    await expect(dialog(page)).toHaveCount(0);
    expect(calls.filter((c) => c.path.endsWith('/coins'))).toHaveLength(1);
  });

  test('cấp vật phẩm chọn theo danh mục', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      'GET /api/market/catalog': () => [def('VC-0391', 'Đèn bão'), def('VC-0405', 'Huy hiệu sở', 'CURIO', 'EPIC')],
      [`POST /api/admin/players/${USER_ID}/items`]: () => ({ operationId: 'a:k', balance: 900, held: 200, slotsUsed: 5, level: 12, xp: 30, itemId: 'new', defId: 'VC-0405', grantedRewardDefIds: [], keptRewardDefIds: [] }),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Cấp vật phẩm' }).click();
    await dialog(page).getByLabel('Vật phẩm').selectOption('VC-0405');
    await dialog(page).getByLabel('Lý do').fill('Quà sự kiện');
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(calls.find((c) => c.path.endsWith('/items'))!.body.defId).toBe('VC-0405');
  });

  test('thu hồi món đang rao bán: nói trước sẽ hủy tin rao', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/items/listed1/revoke`]: () => ({ operationId: 'a:k', balance: 900, held: 200, slotsUsed: 3, level: 12, xp: 30, cancelledListingId: 'l1', grantedRewardDefIds: [], keptRewardDefIds: [] }),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Thu hồi Mũ thợ săn' }).click();
    await expect(dialog(page)).toContainText('hủy tin rao');
    await dialog(page).getByLabel('Lý do').fill('Vật phẩm cấp nhầm');
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(calls.find((c) => c.path.endsWith('/revoke'))!.body.reason).toBe('Vật phẩm cấp nhầm');
  });

  test('thu hồi món đang trang bị: nói trước sẽ gỡ', async ({ page }) => {
    await fakeApi(page, routes());
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Thu hồi Viền VIP' }).click();
    await expect(dialog(page)).toContainText('gỡ trang bị');
  });

  test('thu hồi món đang trao đổi: bị từ chối thì báo rõ', async ({ page }) => {
    await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/items/traded1/revoke`]: () => new Failure(409, 'Vật phẩm đang nằm trong một đề nghị trao đổi.', 'ADMIN_ITEM_IN_TRADE'),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Thu hồi Kính lúp đồng' }).click();
    await dialog(page).getByLabel('Lý do').fill('Vật phẩm cấp nhầm');
    await confirm(page).click();
    await expect(dialog(page).getByRole('alert')).toContainText('đề nghị trao đổi');
  });

  test('đặt cấp: báo phần thưởng được bù và đồ giữ lại khi hạ cấp', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/progress`]: () => ({ operationId: 'a:k', balance: 900, held: 200, slotsUsed: 4, level: 5, xp: 0, grantedRewardDefIds: [], keptRewardDefIds: ['frame_dong'] }),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Đặt cấp / KN' }).click();
    await dialog(page).getByLabel('Cấp', { exact: true }).fill('5');
    await dialog(page).getByLabel('KN', { exact: true }).fill('0');
    await dialog(page).getByLabel('Lý do').fill('Hỗ trợ người chơi');
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('#toast-root')).toContainText('frame_dong');
    expect(calls.find((c) => c.path.endsWith('/progress'))!.body.level).toBe(5);
  });

  test('xóa ảnh đại diện và ép đăng xuất cùng đi qua hộp xác nhận', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      [`POST /api/admin/players/${USER_ID}/avatar/remove`]: () => ({ userId: USER_ID, avatar: 'nonla', fileRemoved: false }),
      [`POST /api/admin/players/${USER_ID}/force-logout`]: () => true,
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Xóa ảnh đại diện' }).click();
    await dialog(page).getByRole('button', { name: 'Ảnh phản cảm' }).click();
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(calls.find((c) => c.path.endsWith('/avatar/remove'))!.body.reason).toBe('Ảnh phản cảm');
    await expect(page.locator('#toast-root')).toContainText('Cloudinary');

    await page.getByRole('button', { name: 'Ép đăng xuất' }).click();
    await dialog(page).getByLabel('Lý do').fill('Tài khoản bị lộ');
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(calls.find((c) => c.path.endsWith('/force-logout'))!.body.reason).toBe('Tài khoản bị lộ');
  });

  test('các lịch sử chỉ tải khi mở tab, có phân trang', async ({ page }) => {
    const calls = await fakeApi(page, {
      ...routes(),
      [`GET /api/admin/players/${USER_ID}/games`]: () => page1([{ resultId: 'r', roomId: 'room', caseId: 'c', caseTitle: 'Vụ án A', success: true, ending: '', score: 80, rank: 'A', at: '2026-10-03T03:00:00Z' }], 60),
      [`GET /api/admin/players/${USER_ID}/chest-openings`]: () => page1([{ id: 'o', chestDefId: 'chest_np', chestName: 'Hòm Niêm Phong', reward: def('VC-0391', 'Đèn bão'), state: 'DONE', at: '2026-10-03T03:00:00Z' }]),
      [`GET /api/admin/players/${USER_ID}/sales`]: () => page1([{ id: 's', side: 'SOLD', def: def('VC-0391', 'Đèn bão'), itemId: 'i', price: 340, fee: 17, otherId: 'x', otherName: 'Bình', at: '2026-10-03T03:00:00Z' }]),
      [`GET /api/admin/players/${USER_ID}/trades`]: () => page1([{ id: 't', fromId: 'x', fromName: 'Bình', toId: USER_ID, toName: 'An', fromItems: [def('VC-0391', 'Đèn bão')], toItems: [], fromCoins: 10, toCoins: 0, message: '', status: 'PENDING', failReason: null, createdAt: '2026-10-03T03:00:00Z', respondedAt: null }]),
      [`GET /api/admin/players/${USER_ID}/audit`]: () => page1([{ id: 'e', at: '2026-10-03T03:00:00Z', adminId: 'u1', adminName: 'Yến', action: 'player.coins', targetType: 'user', targetId: USER_ID, before: { balance: 1 }, after: { balance: 2 }, reason: 'Bù lỗi' }]),
    });
    await page.goto(`/admin/players/${USER_ID}`);
    await expect(page.getByRole('heading', { name: 'Thám tử An' })).toBeVisible();
    expect(calls.some((c) => c.path.endsWith('/games'))).toBe(false);

    await page.getByRole('tab', { name: 'Lịch sử trận' }).click();
    await expect(page.locator('[data-adp-panel="tran"]').getByText('Vụ án A')).toBeVisible();
    await expect(page).toHaveURL(/tab=tran/);
    await page.getByRole('tab', { name: 'Lịch sử trận' }).click();
    await page.getByRole('button', { name: 'Trang sau' }).click();
    await expect.poll(() => calls.filter((c) => c.path.endsWith('/games')).at(-1)?.search.get('page')).toBe('2');

    await page.getByRole('tab', { name: 'Mở hòm' }).click();
    await expect(page.getByText('Hòm Niêm Phong')).toBeVisible();
    await page.getByRole('tab', { name: 'Giao dịch chợ' }).click();
    await expect(page.locator('[data-adp-panel="cho"]').getByText('Bình')).toBeVisible();
    await page.getByRole('tab', { name: 'Trao đổi' }).click();
    await expect(page.locator('[data-adp-panel="traodoi"]').getByText('Đang chờ')).toBeVisible();
    await page.getByRole('tab', { name: 'Nhật ký admin' }).click();
    await expect(page.locator('[data-adp-panel="nhatky"]').getByText('Bù lỗi')).toBeVisible();
  });

  test('id không có thật thì báo không tìm thấy', async ({ page }) => {
    await fakeApi(page, { 'GET /api/admin/players/u404': () => new Failure(404, 'Không tìm thấy người chơi này.') });
    await page.goto('/admin/players/u404');
    await expect(page.getByRole('alert').first()).toContainText('Không tìm thấy');
  });
});

// ------------------------------------------------------------------ avatars

test('duyệt ảnh: lưới có phân trang, xóa nhanh bằng lý do có sẵn, duyệt thì bớt khỏi danh sách', async ({ page }) => {
  const items = [
    { userId: USER_ID, fullName: 'Thám tử An', email: 'an@tests.invalid', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', uploadedAt: '2026-10-03T03:00:00Z', approved: false },
    { userId: '507f1f77bcf86cd799439072', fullName: 'Thám tử Bình', email: 'binh@tests.invalid', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', uploadedAt: '2026-10-02T03:00:00Z', approved: false },
    { userId: '507f1f77bcf86cd799439073', fullName: 'Thám tử Châu', email: 'chau@tests.invalid', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', uploadedAt: '2026-10-01T03:00:00Z', approved: false },
  ];
  const calls = await fakeApi(page, {
    'GET /api/admin/players/avatars': (call) => page1(items, 40, Number(call.search.get('page') ?? 1)),
    [`POST /api/admin/players/${USER_ID}/avatar/remove`]: () => { items.shift(); return { userId: USER_ID, avatar: 'nonla', fileRemoved: true }; },
    'POST /api/admin/players/507f1f77bcf86cd799439072/avatar/approve': () => { items.shift(); return true; },
  });
  await page.goto('/admin/players?tab=anh');
  const grid = page.locator('[data-adp-avatars]');
  await expect(grid.getByText('Thám tử An')).toBeVisible();
  await expect(grid.locator('img')).toHaveCount(3);

  await grid.locator('[data-adp-avatar]', { hasText: 'Thám tử An' }).getByRole('button', { name: 'Xóa ảnh' }).click();
  await dialog(page).getByRole('button', { name: 'Ảnh phản cảm' }).click();
  await confirm(page).click();
  await expect(grid.getByText('Thám tử An')).toHaveCount(0);
  expect(calls.find((c) => c.path.endsWith('/avatar/remove'))!.body.reason).toBe('Ảnh phản cảm');

  await grid.locator('[data-adp-avatar]', { hasText: 'Thám tử Bình' }).getByRole('button', { name: 'Duyệt' }).click();
  await expect(grid.getByText('Thám tử Bình')).toHaveCount(0);

  await page.getByRole('button', { name: 'Trang sau' }).click();
  await expect.poll(() => calls.filter((c) => c.path.endsWith('/avatars')).at(-1)?.search.get('page')).toBe('2');
});

// ------------------------------------------------------------------ economy

const overview = (days: number) => ({
  coinsInCirculation: 123456,
  coinsHeld: 7890,
  itemsByRarity: [{ key: 'COMMON', count: 40 }, { key: 'RARE', count: 9 }],
  itemsByCategory: [{ key: 'CURIO', count: 30 }, { key: 'CHEST', count: 19 }],
  days: Array.from({ length: days }, (_, i) => ({
    day: `2026-10-${String(i + 1).padStart(2, '0')}`, starter: 500, gameRewards: 120, adminIn: 50, chestShop: 300, marketFees: 17, adminOut: 20, net: 333,
  })),
  totals: { starter: 500 * days, gameRewards: 120 * days, adminIn: 50 * days, chestShop: 300 * days, marketFees: 17 * days, adminOut: 20 * days, net: 333 * days },
  richest: [{ userId: USER_ID, fullName: 'Đại gia', balance: 99000, held: 100 }],
});

test.describe('kinh tế và chợ', () => {
  test('tổng quan hiện xu, vật phẩm, dòng xu 7/30 ngày và người giàu nhất', async ({ page }) => {
    const calls = await fakeApi(page, { 'GET /api/admin/economy/overview': (call) => overview(Number(call.search.get('days') ?? 7)) });
    await page.goto('/admin/economy');
    const panel = page.locator('[data-adp-economy="tongquan"]');
    await expect(panel).toContainText('123.456');
    await expect(panel).toContainText('7.890');
    await expect(panel.locator('[data-adp-flow] tbody tr')).toHaveCount(7);
    await expect(panel.getByText('Đại gia')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Đại gia' })).toHaveAttribute('href', `/admin/players/${USER_ID}`);
    await panel.getByRole('button', { name: '30 ngày' }).click();
    await expect(panel.locator('[data-adp-flow] tbody tr')).toHaveCount(30);
    expect(calls.at(-1)!.search.get('days')).toBe('30');
  });

  const listing = (extra = {}) => ({ id: 'l1', itemId: 'i1', def: def('VC-0391', 'Đèn bão'), userId: USER_ID, userName: 'An', price: 3400, referencePrice: 340, priceFlag: 'HIGH', status: 'ACTIVE', createdAt: '2026-10-03T03:00:00Z', ...extra });

  test('gỡ listing: lọc theo máy chủ, xác nhận, nhập lý do', async ({ page }) => {
    let removed = false;
    const calls = await fakeApi(page, {
      'GET /api/admin/economy/listings': () => page1(removed ? [] : [listing()]),
      'GET /api/admin/economy/orders': () => page1([]),
      'POST /api/admin/economy/listings/l1/remove': () => { removed = true; return { listingId: 'l1', status: 'CANCELLED' }; },
    });
    await page.goto('/admin/economy?tab=cho');
    const row1 = page.locator('[data-adp-listings] tr', { hasText: 'Đèn bão' });
    await expect(row1).toContainText('3.400');
    await expect(row1).toContainText('Giá cao bất thường');
    await page.locator('[data-adp-listings-filter]').getByLabel('Người bán').fill('An');
    await page.locator('[data-adp-listings-filter]').getByRole('button', { name: 'Lọc' }).click();
    await expect.poll(() => calls.filter((c) => c.path.endsWith('/listings')).at(-1)?.search.get('user')).toBe('An');

    await row1.getByRole('button', { name: 'Gỡ' }).click();
    await dialog(page).getByLabel('Lý do').fill('Giá bất thường');
    await confirm(page).click();
    await expect(page.locator('[data-adp-listings]').getByText('Đèn bão')).toHaveCount(0);
    expect(calls.find((c) => c.method === 'POST')!.body.reason).toBe('Giá bất thường');
  });

  test('hủy lệnh mua trả xu', async ({ page }) => {
    let cancelled = false;
    const calls = await fakeApi(page, {
      'GET /api/admin/economy/listings': () => page1([]),
      'GET /api/admin/economy/orders': () => page1(cancelled ? [] : [{ id: 'o1', def: def('VC-0391', 'Đèn bão'), userId: USER_ID, userName: 'An', price: 300, referencePrice: 340, priceFlag: null, status: 'ACTIVE', createdAt: '2026-10-03T03:00:00Z' }]),
      'POST /api/admin/economy/orders/o1/cancel': () => { cancelled = true; return { orderId: 'o1', status: 'CANCELLED' }; },
    });
    await page.goto('/admin/economy?tab=cho');
    await page.locator('[data-adp-orders] tr', { hasText: 'Đèn bão' }).getByRole('button', { name: 'Hủy lệnh' }).click();
    await expect(dialog(page)).toContainText('trả');
    await dialog(page).getByLabel('Lý do').fill('Lệnh mua giá ảo');
    await confirm(page).click();
    await expect(page.locator('[data-adp-orders]').getByText('Đèn bão')).toHaveCount(0);
    expect(calls.find((c) => c.method === 'POST')!.path).toContain('/orders/o1/cancel');
  });

  test('lịch sử bán lọc được và xuất CSV kèm bộ lọc', async ({ page }) => {
    const calls = await fakeApi(page, {
      'GET /api/admin/economy/sales': () => page1([{ id: 's1', def: def('VC-0391', 'Đèn bão'), itemId: 'i', price: 340, fee: 17, priceFlag: null, sellerId: USER_ID, sellerName: 'An', buyerId: 'x', buyerName: 'Bình', listingId: 'l', orderId: null, at: '2026-10-03T03:00:00Z' }]),
      'GET /api/admin/economy/trades': () => page1([]),
      'GET /api/admin/economy/sales/export': (_call, route) => {
        void route.fulfill({ status: 200, contentType: 'text/csv', body: 'at,defId\r\n', headers: { 'Content-Disposition': 'attachment; filename="lich-su.csv"' } });
        return undefined;
      },
    });
    await page.goto('/admin/economy?tab=lichsu');
    await expect(page.locator('[data-adp-sales]').getByText('Đèn bão')).toBeVisible();
    await page.locator('[data-adp-sales-filter]').getByLabel('Người mua hoặc bán').fill('An');
    await page.locator('[data-adp-sales-filter]').getByRole('button', { name: 'Lọc' }).click();
    await expect.poll(() => calls.filter((c) => c.path.endsWith('/sales')).at(-1)?.search.get('user')).toBe('An');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Xuất CSV' }).click();
    expect((await download).suggestedFilename()).toContain('.csv');
    expect(calls.find((c) => c.path.endsWith('/export'))!.search.get('user')).toBe('An');
  });

  test('cảnh báo bất thường chỉ đánh dấu: không có nút tự xử lý', async ({ page }) => {
    await fakeApi(page, {
      'GET /api/admin/economy/anomalies': () => ({
        prices: [{ kind: 'LISTING', listingId: 'l1', saleId: null, def: def('VC-0391', 'Đèn bão'), price: 3400, referencePrice: 340, flag: 'HIGH', userId: USER_ID, userName: 'An', at: '2026-10-03T03:00:00Z' }],
        funnels: [{ receiverId: USER_ID, receiverName: 'Tài khoản chính', coins: 900, items: 1, giverIds: ['n'], giverNames: ['Tài khoản mới'], tradeIds: ['t'] }],
        repeatedPairs: [{ firstId: 'a', firstName: 'Một', secondId: 'b', secondName: 'Hai', trades: 6, lastAt: '2026-10-03T03:00:00Z' }],
        since: '2026-09-28T03:00:00Z',
        truncated: false,
      }),
    });
    await page.goto('/admin/economy?tab=batthuong');
    const panel = page.locator('[data-adp-economy="batthuong"]');
    await expect(panel.getByText('Đèn bão')).toBeVisible();
    await expect(panel.getByText('Tài khoản chính')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Tài khoản mới' })).toBeVisible();
    await expect(panel.locator('tr', { hasText: 'Một' })).toContainText('6');
    await expect(panel.getByRole('button')).toHaveCount(0);
  });

  test('giao dịch kẹt: liệt kê, chạy khôi phục có lý do, báo kết quả', async ({ page }) => {
    let recovered = false;
    const calls = await fakeApi(page, {
      'GET /api/admin/economy/stuck': () => ({
        items: recovered ? [] : [{ kind: 'CHEST_OPENING', id: 'u:k', state: 'PENDING', userId: USER_ID, updatedAt: '2026-10-03T03:00:00Z', ageSeconds: 600, detail: 'chest_np' }],
        stuckAfterMinutes: 5,
        truncated: false,
      }),
      'POST /api/admin/economy/recover': () => { recovered = true; return { resumed: 1, stillStuck: 0 }; },
    });
    await page.goto('/admin/economy?tab=ket');
    const panel = page.locator('[data-adp-economy="ket"]');
    await expect(panel.locator('tr', { hasText: 'chest_np' })).toContainText('Lượt mở hòm');
    await panel.getByRole('button', { name: 'Chạy khôi phục' }).click();
    await dialog(page).getByLabel('Lý do').fill('Chạy tay sau sự cố');
    await confirm(page).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(panel.getByText('Không có giao dịch nào bị kẹt')).toBeVisible();
    await expect(page.locator('#toast-root')).toContainText('1');
    expect(calls.find((c) => c.method === 'POST')!.body.reason).toBe('Chạy tay sau sự cố');
  });

  test('phòng chơi: thấy ai còn kết nối, đóng phòng treo có xác nhận', async ({ page }) => {
    let closed = false;
    const calls = await fakeApi(page, {
      'GET /api/admin/rooms': () => page1(closed ? [] : [{
        roomId: 'r1', roomCode: 'ABC123', caseId: 'c', caseTitle: 'Vụ án A', status: 'IN_PROGRESS', visibility: 'PRIVATE', hostUserId: USER_ID,
        players: [{ userId: USER_ID, username: 'An', role: 'INVESTIGATOR', isReady: true, isConnected: false, disconnectedAt: '2026-10-03T03:00:00Z' }, { userId: 'b', username: 'Bình', role: 'INTERROGATOR', isReady: true, isConnected: true, disconnectedAt: null }],
        createdAt: '2026-10-03T02:00:00Z', startedAt: '2026-10-03T02:30:00Z', lastActivityAt: '2026-10-03T03:00:00Z', looksHung: true,
      }]),
      'POST /api/admin/rooms/r1/close': () => { closed = true; return { roomId: 'r1', status: 'ABANDONED' }; },
    });
    await page.goto('/admin/economy?tab=phong');
    const panel = page.locator('[data-adp-economy="phong"]');
    const room = panel.locator('tr', { hasText: 'ABC123' });
    await expect(room).toContainText('Vụ án A');
    await expect(room).toContainText('An');
    await expect(room).toContainText('Mất kết nối');
    await expect(room).toContainText('Có vẻ treo');
    await room.getByRole('button', { name: 'Đóng phòng' }).click();
    await dialog(page).getByLabel('Lý do').fill('Phòng treo sau sự cố');
    await confirm(page).click();
    await expect(panel.getByText('ABC123')).toHaveCount(0);
    expect(calls.find((c) => c.method === 'POST')!.body.reason).toBe('Phòng treo sau sự cố');
  });

  test('đánh giá: lọc theo vụ án, ẩn, hiện lại, xóa, đều có lý do', async ({ page }) => {
    const review = { id: 'v1', caseId: 'case-a', caseTitle: 'Vụ án A', userId: USER_ID, authorDisplay: 'An', rating: 1, reviewText: 'Lời lẽ vi phạm', containsSpoiler: false, resultLabel: 'SOLVED', hidden: false, hiddenReason: null, hiddenAt: null, createdAt: '2026-10-03T03:00:00Z', updatedAt: '2026-10-03T03:00:00Z' };
    let current: any = { ...review };
    const calls = await fakeApi(page, {
      'GET /api/admin/reviews': () => page1(current ? [current] : []),
      'POST /api/admin/reviews/v1/hide': () => { current = { ...review, hidden: true, hiddenReason: 'Ngôn từ xúc phạm' }; return current; },
      'POST /api/admin/reviews/v1/unhide': () => { current = { ...review }; return current; },
      'DELETE /api/admin/reviews/v1': () => { current = null; return true; },
    });
    await page.goto('/admin/economy?tab=danhgia');
    const panel = page.locator('[data-adp-economy="danhgia"]');
    await expect(panel.getByText('Lời lẽ vi phạm')).toBeVisible();

    await panel.locator('[data-adp-reviews-filter]').getByLabel('Mã vụ án').fill('case-a');
    await panel.locator('[data-adp-reviews-filter]').getByRole('button', { name: 'Lọc' }).click();
    await expect.poll(() => calls.filter((c) => c.path === '/api/admin/reviews' && c.method === 'GET').at(-1)?.search.get('caseId')).toBe('case-a');

    await panel.getByRole('button', { name: 'Ẩn' }).click();
    await dialog(page).getByLabel('Lý do').fill('Ngôn từ xúc phạm');
    await confirm(page).click();
    await expect(panel.locator('tr', { hasText: 'Lời lẽ vi phạm' })).toContainText('Đang ẩn');

    await panel.getByRole('button', { name: 'Hiện lại' }).click();
    await dialog(page).getByLabel('Lý do').fill('Ẩn nhầm');
    await confirm(page).click();
    await expect(panel.getByRole('button', { name: 'Ẩn' })).toBeVisible();

    await panel.getByRole('button', { name: 'Xóa' }).click();
    await dialog(page).getByLabel('Lý do').fill('Spam quảng cáo');
    await confirm(page).click();
    await expect(panel.getByText('Lời lẽ vi phạm')).toHaveCount(0);
    expect(calls.find((c) => c.method === 'DELETE')!.body.reason).toBe('Spam quảng cáo');
  });
});

// ------------------------------------------------------------------ audit

test.describe('nhật ký admin', () => {
  const entry = {
    id: 'e1', at: '2026-10-03T03:00:00Z', adminId: 'u1', adminName: 'Yến', action: 'player.coins', targetType: 'user', targetId: USER_ID,
    before: { balance: 500, held: 0, nested: { a: 1 } }, after: { balance: 750, held: 0, nested: { a: 2 } }, reason: 'Bù lỗi sự kiện',
  };

  test('lọc theo admin, thao tác, đối tượng, ngày đều hỏi máy chủ', async ({ page }) => {
    const calls = await fakeApi(page, { 'GET /api/admin/audit': (call) => page1([entry], 120, Number(call.search.get('page') ?? 1)) });
    await page.goto('/admin/audit');
    await expect(page.getByText('Bù lỗi sự kiện')).toBeVisible();

    const form = page.locator('[data-adp-audit-filter]');
    await form.getByLabel('Mã admin').fill('u1');
    await form.getByLabel('Thao tác').fill('player.coins');
    await form.getByLabel('Loại đối tượng').selectOption('user');
    await form.getByLabel('Mã đối tượng').fill(USER_ID);
    await form.getByLabel('Từ ngày').fill('2026-10-01');
    await form.getByLabel('Đến ngày').fill('2026-10-05');
    await form.getByRole('button', { name: 'Lọc' }).click();

    await expect.poll(() => calls.at(-1)!.search.get('adminId')).toBe('u1');
    const asked = calls.at(-1)!.search;
    expect(asked.get('action')).toBe('player.coins');
    expect(asked.get('targetType')).toBe('user');
    expect(asked.get('targetId')).toBe(USER_ID);
    // A day on the players' calendar, sent as the UTC instants it starts and ends at.
    expect(asked.get('from')).toBe('2026-09-30T17:00:00.000Z');
    expect(asked.get('to')).toBe('2026-10-05T16:59:59.999Z');

    await page.getByRole('button', { name: 'Trang sau' }).click();
    await expect.poll(() => calls.at(-1)!.search.get('page')).toBe('2');
  });

  test('xem chi tiết so sánh trước và sau, tô phần đổi', async ({ page }) => {
    await fakeApi(page, { 'GET /api/admin/audit': () => page1([entry]) });
    await page.goto('/admin/audit');
    await page.getByRole('button', { name: 'Xem chi tiết' }).click();
    const diff = page.locator('[data-adp-diff]');
    const balance = diff.locator('tr', { hasText: 'balance' });
    await expect(balance).toHaveClass(/is-changed/);
    await expect(balance).toContainText('500');
    await expect(balance).toContainText('750');
    await expect(diff.locator('tr', { hasText: 'held' })).not.toHaveClass(/is-changed/);
    await expect(diff.locator('tr', { hasText: 'nested.a' })).toHaveClass(/is-changed/);
  });

  test('thao tác không có trước/sau vẫn mở được', async ({ page }) => {
    await fakeApi(page, { 'GET /api/admin/audit': () => page1([{ ...entry, before: null, after: { url: 'x' }, reason: null }]) });
    await page.goto('/admin/audit');
    await page.getByRole('button', { name: 'Xem chi tiết' }).click();
    await expect(page.locator('[data-adp-diff]').locator('tr', { hasText: 'url' })).toHaveClass(/is-changed/);
  });
});

// ------------------------------------------------------------------ dashboard

test('trang tổng quan có các thẻ số liệu mới dẫn tới đúng trang', async ({ page }) => {
  await fakeApi(page, {
    'GET /api/admin/dashboard': () => ({ totalUsers: 1, totalCases: 1, publishedCases: 1, totalRooms: 1, activeRooms: 0, totalResults: 0, wins: 0, losses: 0, totalAiDrafts: 0, legacyCasesHidden: true }),
    'GET /api/admin/users': () => [],
    'GET /api/admin/economy/dashboard': () => ({ newPlayersToday: 11, gamesToday: 22, chestOpensToday: 33, coinsInCirculation: 44444, stuckOperations: 2, pendingAvatars: 5 }),
  });
  await page.goto('/admin');
  const cards = page.locator('[data-adp-cards]');
  const expectCard = async (label: string, value: string, href: string) => {
    const card = cards.getByRole('link', { name: new RegExp(label) });
    await expect(card).toContainText(value);
    await expect(card).toHaveAttribute('href', href);
  };
  await expectCard('Người chơi mới', '11', '/admin/players');
  await expectCard('Trận đã chơi', '22', '/admin/economy?tab=phong');
  await expectCard('Lượt mở hòm', '33', '/admin/economy');
  await expectCard('Xu lưu hành', '44.444', '/admin/economy');
  await expectCard('Giao dịch kẹt', '2', '/admin/economy?tab=ket');
  await expectCard('Ảnh chờ duyệt', '5', '/admin/players?tab=anh');
});

test('thẻ số liệu lỗi không làm hỏng trang tổng quan', async ({ page }) => {
  await fakeApi(page, {
    'GET /api/admin/dashboard': () => ({ totalUsers: 1, totalCases: 1, publishedCases: 1, totalRooms: 1, activeRooms: 0, totalResults: 0, wins: 0, losses: 0, totalAiDrafts: 0, legacyCasesHidden: true }),
    'GET /api/admin/users': () => [],
    'GET /api/admin/economy/dashboard': () => new Failure(500, 'Hỏng'),
  });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Tổng quan', exact: true })).toBeVisible();
  await expect(page.locator('[data-adp-cards]')).toHaveCount(0);
});

// ------------------------------------------------------------------ access and phones

test('hộp xác nhận nằm giữa màn hình', async ({ page }) => {
  await fakeApi(page, { [`GET /api/admin/players/${USER_ID}`]: () => detail() });
  await page.goto(`/admin/players/${USER_ID}`);
  await page.getByRole('button', { name: 'Cộng / trừ xu' }).click();
  const box = (await dialog(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(1);
});

test('người chơi thường không vào được các trang này', async ({ page }) => {
  await fakeApi(page, {}, 'PLAYER');
  for (const hash of ['/admin/players', `/admin/players/${USER_ID}`, '/admin/economy', '/admin/audit']) {
    await page.goto(hash);
    await expect(page).not.toHaveURL(/\/admin/);
  }
});

test.describe('màn điện thoại 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const everything = {
    'GET /api/admin/players': () => page1([row(0, { fullName: 'Một cái tên rất dài của thám tử để thử xem có tràn không', email: 'mot.dia.chi.thu.dien.tu.that.dai@tests.invalid' }), row(1)], 60),
    [`GET /api/admin/players/${USER_ID}`]: () => detail(),
    'GET /api/admin/players/avatars': () => page1([{ userId: USER_ID, fullName: 'An', email: 'an@tests.invalid', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', uploadedAt: '2026-10-03T03:00:00Z', approved: false }]),
    'GET /api/admin/economy/overview': () => overview(7),
    'GET /api/admin/economy/listings': () => page1([{ id: 'l1', itemId: 'i1', def: def('VC-0391', 'Đèn bão'), userId: USER_ID, userName: 'An', price: 3400, referencePrice: 340, priceFlag: 'HIGH', status: 'ACTIVE', createdAt: '2026-10-03T03:00:00Z' }]),
    'GET /api/admin/economy/orders': () => page1([]),
    'GET /api/admin/economy/stuck': () => ({ items: [{ kind: 'CHEST_OPENING', id: `${USER_ID}:a-long-idempotency-key-that-could-overflow`, state: 'PENDING', userId: USER_ID, updatedAt: '2026-10-03T03:00:00Z', ageSeconds: 600, detail: 'chest_np' }], stuckAfterMinutes: 5, truncated: false }),
    'GET /api/admin/audit': () => page1([{ id: 'e1', at: '2026-10-03T03:00:00Z', adminId: 'u1', adminName: 'Yến', action: 'player.coins', targetType: 'user', targetId: USER_ID, before: { balance: 500 }, after: { balance: 750 }, reason: 'Bù lỗi' }]),
  };

  for (const hash of ['/admin/players', '/admin/players?tab=anh', `/admin/players/${USER_ID}`, '/admin/economy', '/admin/economy?tab=cho', '/admin/economy?tab=ket', '/admin/audit']) {
    test(`${hash} không tràn ngang`, async ({ page }) => {
      await fakeApi(page, everything);
      await page.goto(hash);
      await expect(page.locator('#app .page').first()).toBeVisible();
      await expect(page.locator('[data-adp-loaded]').first()).toBeVisible();
      await expectNoPhoneOverflow(page);
    });
  }

  test('hộp xác nhận vừa màn hình và nút đủ lớn để bấm', async ({ page }) => {
    await fakeApi(page, everything);
    await page.goto(`/admin/players/${USER_ID}`);
    await page.getByRole('button', { name: 'Cộng / trừ xu' }).click();
    const box = await dialog(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    const button = await confirm(page).boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(40);
  });
});
