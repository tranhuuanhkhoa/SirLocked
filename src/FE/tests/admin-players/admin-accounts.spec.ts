import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The account itself on /admin/players: create, edit name and email, set a new password, delete (soft) and restore,
 * against a faked API that records what the page asked for. The server side is covered by MongoAdminAccountsTests.
 */
const USER_ID = '507f1f77bcf86cd799439071';
const NEW_ID = '507f1f77bcf86cd799439099';

type Call = { method: string; path: string; search: URLSearchParams; body: any };

const account = (extra: Record<string, unknown> = {}) => ({
  userId: USER_ID, fullName: 'Thám tử An', email: 'an@tests.invalid', role: 'PLAYER', status: 'ACTIVE', isEmailVerified: true,
  hasPassword: true, hasSession: true, createdAt: '2026-10-01T03:00:00Z', updatedAt: '2026-10-02T03:00:00Z', ...extra,
});

const detail = (extra: Record<string, unknown> = {}) => ({
  account: account(extra),
  progress: { level: 3, xp: 0, xpToNext: 200, maxLevel: 50, avatar: 'kiem', avatarUrl: null, avatarUploadedAt: null },
  wallet: { hasAccount: true, balance: 500, held: 0, slotsUsed: 3, slotCap: 500, itemCount: 3, reservedSlots: 0 },
  look: { frameDefId: null, titleDefId: 'title_tan-binh', entranceDefId: 'entrance_lang-le' },
  inventory: [],
});

const answer = (call: Call, extra: Record<string, unknown> = {}) => ({
  userId: USER_ID, fullName: 'Thám tử An', email: 'an@tests.invalid', role: 'PLAYER', status: 'ACTIVE', isEmailVerified: true,
  createdAt: '2026-10-01T03:00:00Z', ...extra,
});

class Failure {
  constructor(public status: number, public message: string, public code = 'X') {}
}

async function fakeApi(page: Page, routes: Record<string, (call: Call, route: Route) => unknown>) {
  const calls: Call[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'admin-test-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'u1', fullName: 'Yến', role: 'ADMIN', isEmailVerified: true }));
  });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body = null;
    try { body = request.postDataJSON?.() ?? null; } catch { body = null; }
    const call: Call = { method: request.method(), path: url.pathname, search: url.searchParams, body };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    if (!handler) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }) });
    const result = await handler(call, route);
    if (result instanceof Failure) {
      return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify({ success: false, message: result.message, errors: { code: result.code } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: result }) });
  });
  return calls;
}

const dialog = (page: Page) => page.locator('dialog[open]');
const confirm = (page: Page) => dialog(page).locator('[data-confirm]');
const last = (calls: Call[], method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).at(-1);

test('tạo tài khoản: mật khẩu điền sẵn đúng luật, lỗi máy chủ hiện trong hộp, tạo xong mở trang người chơi mới', async ({ page }) => {
  let tries = 0;
  const calls = await fakeApi(page, {
    'GET /api/admin/players': () => ({ items: [], page: 1, pageSize: 25, total: 0 }),
    'POST /api/admin/players': (call) => {
      tries += 1;
      if (tries === 1) return new Failure(409, 'Email này đã có tài khoản (kể cả tài khoản đã xóa).', 'ADMIN_EMAIL_TAKEN');
      return answer(call, { userId: NEW_ID, fullName: call.body.fullName, email: call.body.email.toLowerCase(), role: call.body.role });
    },
    [`GET /api/admin/players/${NEW_ID}`]: () => detail({ userId: NEW_ID, fullName: 'Thám tử Mới', email: 'moi@tests.invalid', role: 'VIP' }),
  });
  await page.goto('/admin/players');
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Tạo tài khoản' })).toBeVisible();

  const password = await dialog(page).getByLabel('Mật khẩu').inputValue();
  expect(password).toMatch(/^(?=.*[A-Za-z])(?=.*\d).{6,100}$/);

  // Checked on the page first: nothing goes out while the form is wrong.
  await dialog(page).getByLabel('Lý do').fill('Tài khoản thử');
  await confirm(page).click();
  await expect(dialog(page).locator('.adp-dialog-error')).toContainText('Họ và tên');
  expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/players')).toBe(false);

  await dialog(page).getByLabel('Họ và tên').fill('Thám tử Mới');
  await dialog(page).getByLabel('Email').fill('Moi@tests.invalid');
  await dialog(page).getByLabel('Vai trò').selectOption('VIP');
  await confirm(page).click();
  await expect(dialog(page).locator('.adp-dialog-error')).toContainText('Email này đã có tài khoản');

  await confirm(page).click();
  await expect(page).toHaveURL(new RegExp(`/admin/players/${NEW_ID}$`));
  await expect(page.locator('.adp-name')).toHaveText('Thám tử Mới');
  expect(last(calls, 'POST', '/api/admin/players')!.body).toEqual({
    fullName: 'Thám tử Mới', email: 'Moi@tests.invalid', newPassword: password, role: 'VIP', reason: 'Tài khoản thử',
  });
});

test('trang người chơi: sửa thông tin, đặt mật khẩu mới, xóa rồi khôi phục', async ({ page }) => {
  const calls = await fakeApi(page, {
    [`GET /api/admin/players/${USER_ID}`]: () => detail(),
    [`PUT /api/admin/players/${USER_ID}/account`]: (call) => answer(call, { fullName: call.body.fullName, email: call.body.email }),
    [`POST /api/admin/players/${USER_ID}/password`]: (call) => answer(call),
    [`DELETE /api/admin/players/${USER_ID}`]: (call) => answer(call, { status: 'DELETED' }),
    [`POST /api/admin/players/${USER_ID}/restore`]: (call) => answer(call, { status: 'ACTIVE' }),
  });
  await page.goto(`/admin/players/${USER_ID}`);
  const actions = page.locator('[data-adp-actions]');
  await expect(actions.getByRole('button', { name: 'Sửa thông tin' })).toBeVisible();

  await actions.getByRole('button', { name: 'Sửa thông tin' }).click();
  await expect(dialog(page).getByLabel('Email')).toHaveValue('an@tests.invalid');
  await dialog(page).getByLabel('Họ và tên').fill('Thám tử An Mới');
  await dialog(page).getByLabel('Email').fill('an.moi@tests.invalid');
  await dialog(page).getByLabel('Lý do').fill('Người chơi đổi email');
  await confirm(page).click();
  await expect(page.locator('.adp-name')).toHaveText('Thám tử An Mới');
  await expect(page.locator('.adp-email')).toHaveText('an.moi@tests.invalid');
  expect(last(calls, 'PUT', `/api/admin/players/${USER_ID}/account`)!.body).toEqual({ fullName: 'Thám tử An Mới', email: 'an.moi@tests.invalid', reason: 'Người chơi đổi email' });

  await actions.getByRole('button', { name: 'Đặt mật khẩu mới' }).click();
  await dialog(page).getByLabel('Mật khẩu').fill('chiaKhoa2026');
  await dialog(page).getByLabel('Lý do').fill('Quên mật khẩu');
  await confirm(page).click();
  await expect(page.locator('[data-adp-head]')).toContainText('Không có phiên đăng nhập');
  expect(last(calls, 'POST', `/api/admin/players/${USER_ID}/password`)!.body).toEqual({ newPassword: 'chiaKhoa2026', reason: 'Quên mật khẩu' });

  await actions.getByRole('button', { name: 'Xóa tài khoản' }).click();
  await expect(dialog(page)).toContainText('khôi phục lại được');
  await dialog(page).getByLabel('Lý do').fill('Tài khoản rác');
  await confirm(page).click();
  await expect(page.locator('[data-adp-head]')).toContainText('Đã xóa');
  expect(last(calls, 'DELETE', `/api/admin/players/${USER_ID}`)!.search.get('reason')).toBe('Tài khoản rác');
  // A deleted account offers only its way back.
  await expect(actions.getByRole('button', { name: 'Sửa thông tin' })).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Khóa tài khoản' })).toHaveCount(0);

  await actions.getByRole('button', { name: 'Khôi phục tài khoản' }).click();
  await dialog(page).getByLabel('Lý do').fill('Xóa nhầm');
  await confirm(page).click();
  await expect(page.locator('[data-adp-head]')).toContainText('Đang hoạt động');
  await expect(actions.getByRole('button', { name: 'Xóa tài khoản' })).toBeVisible();
  expect(last(calls, 'POST', `/api/admin/players/${USER_ID}/restore`)!.body).toEqual({ reason: 'Xóa nhầm' });
});

test('tài khoản quản trị: sửa và đặt mật khẩu được, không có nút khóa; không tự xóa chính mình', async ({ page }) => {
  await fakeApi(page, {
    [`GET /api/admin/players/${USER_ID}`]: () => detail({ role: 'ADMIN' }),
    'GET /api/admin/players/u1': () => detail({ userId: 'u1', fullName: 'Yến', role: 'ADMIN' }),
  });
  await page.goto(`/admin/players/${USER_ID}`);
  const actions = page.locator('[data-adp-actions]');
  await expect(actions.getByRole('button', { name: 'Sửa thông tin' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Đặt mật khẩu mới' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Xóa tài khoản' })).toBeVisible();
  await expect(actions.getByRole('button', { name: /Khóa tài khoản/ })).toHaveCount(0);

  // The signed-in admin (u1) on their own page.
  await page.goto('/admin/players/u1');
  await expect(actions.getByRole('button', { name: 'Sửa thông tin' })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Xóa tài khoản' })).toHaveCount(0);
});

test('hai tab: "Người chơi" chỉ hỏi người chơi và VIP, "Quản trị" chỉ hỏi admin và tạo được tài khoản quản trị', async ({ page }) => {
  const admin = {
    userId: NEW_ID, fullName: 'Quản trị Hai', email: 'admin2@tests.invalid', role: 'ADMIN', status: 'ACTIVE', isEmailVerified: true,
    createdAt: '2026-10-01T03:00:00Z', level: 1, balance: 0, held: 0, avatar: 'kiem', avatarUrl: null,
  };
  const calls = await fakeApi(page, {
    'GET /api/admin/players': (call) => ({ items: call.search.get('scope') === 'ADMINS' ? [admin] : [], page: 1, pageSize: 25, total: call.search.get('scope') === 'ADMINS' ? 1 : 0 }),
    'POST /api/admin/players': (call) => answer(call, { userId: NEW_ID, fullName: call.body.fullName, email: call.body.email, role: call.body.role }),
    [`GET /api/admin/players/${NEW_ID}`]: () => detail({ userId: NEW_ID, fullName: 'Quản trị Ba', email: 'admin3@tests.invalid', role: 'ADMIN' }),
  });
  await page.goto('/admin/players');
  await expect.poll(() => last(calls, 'GET', '/api/admin/players')?.search.get('scope')).toBe('PLAYERS');
  await expect(page.getByLabel('Vai trò')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo tài khoản', exact: true })).toBeVisible();

  await page.locator('[data-adm-tab="quantri"]').click();
  await expect(page.getByText('Quản trị Hai')).toBeVisible();
  expect(last(calls, 'GET', '/api/admin/players')!.search.get('scope')).toBe('ADMINS');
  await expect(page).toHaveURL(/tab=quantri/);
  await expect(page.getByLabel('Vai trò')).toHaveCount(0);
  await expect(page.locator('table')).not.toContainText('Số xu');

  await page.getByRole('button', { name: 'Tạo tài khoản quản trị' }).click();
  await expect(dialog(page)).toContainText('toàn quyền');
  await expect(dialog(page).getByLabel('Vai trò')).toHaveCount(0);
  await dialog(page).getByLabel('Họ và tên').fill('Quản trị Ba');
  await dialog(page).getByLabel('Email').fill('admin3@tests.invalid');
  await dialog(page).getByLabel('Lý do').fill('Thêm người quản lý');
  await confirm(page).click();
  await expect(page).toHaveURL(new RegExp(`/admin/players/${NEW_ID}$`));
  expect(last(calls, 'POST', '/api/admin/players')!.body.role).toBe('ADMIN');

  // The tab is in the address, so a reload opens it again.
  await page.goto('/admin/players?tab=quantri');
  await expect.poll(() => last(calls, 'GET', '/api/admin/players')?.search.get('scope')).toBe('ADMINS');
  // The picture grid creates nothing.
  await page.locator('[data-adm-tab="anh"]').click();
  await expect(page.getByRole('button', { name: /Tạo tài khoản/ })).toBeHidden();
});

test('danh sách: lọc "Đã xóa" hỏi máy chủ, và dòng đã xóa chỉ có nút Khôi phục', async ({ page }) => {
  const deleted = {
    userId: USER_ID, fullName: 'Thám tử Đã Xóa', email: 'gone@tests.invalid', role: 'PLAYER', status: 'DELETED', isEmailVerified: true,
    createdAt: '2026-10-01T03:00:00Z', level: 1, balance: 500, held: 0, avatar: 'kiem', avatarUrl: null,
  };
  const calls = await fakeApi(page, {
    'GET /api/admin/players': (call) => ({ items: call.search.get('status') === 'DELETED' ? [deleted] : [], page: 1, pageSize: 25, total: call.search.get('status') === 'DELETED' ? 1 : 0 }),
    [`POST /api/admin/players/${USER_ID}/restore`]: () => ({ ...deleted, status: 'ACTIVE' }),
  });
  await page.goto('/admin/players');
  await page.getByLabel('Trạng thái').selectOption('DELETED');
  await expect(page.getByText('Thám tử Đã Xóa')).toBeVisible();
  expect(last(calls, 'GET', '/api/admin/players')!.search.get('status')).toBe('DELETED');
  const rowActions = page.locator('.adp-actions').last();
  await expect(rowActions.getByRole('button', { name: /Khóa|Lên VIP/ })).toHaveCount(0);

  await rowActions.getByRole('button', { name: 'Khôi phục Thám tử Đã Xóa' }).click();
  await dialog(page).getByLabel('Lý do').fill('Xóa nhầm');
  await confirm(page).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(last(calls, 'POST', `/api/admin/players/${USER_ID}/restore`)!.body).toEqual({ reason: 'Xóa nhầm' });
});
