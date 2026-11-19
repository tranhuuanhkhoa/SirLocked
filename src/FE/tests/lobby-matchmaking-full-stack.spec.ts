import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Two real players against a real API: (a) quick match → both accept → the same lobby with
 * different roles; (b) a public room created by one player is listed for the other, who joins it.
 *
 * Run against a Development API with a throwaway database:
 *   Auth__AutoVerifyRegistrations=true on the API, then
 *   SIRLOCKED_RUN_LOBBY_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://localhost:5301
 *   SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 npx playwright test tests/lobby-matchmaking-full-stack.spec.ts
 * The players are registered on first use (auto-verified) and reused afterwards; the seeded
 * Development admin publishes the bundled demo cases.
 *
 * NOTE: these specs play the bundled older (non-pixel) cases. Since the pixel catalogue became the main game
 * the API hides them from players, so start the API with CaseCatalog__PixelOnly=false (and
 * CaseCatalog__SeedPixelOnStartup=false if you want a database without the pixel cases).
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string } };
const enabled = process.env.SIRLOCKED_RUN_LOBBY_FULL_STACK === 'true';
const password = process.env.SIRLOCKED_TEST_PASSWORD ?? 'Lobby-test-123';
const adminPassword = process.env.SIRLOCKED_TEST_ADMIN_PASSWORD ?? 'Admin123!';
const PLAYERS = {
  a: { email: 'lobby_a@tests.invalid', fullName: 'Thám tử An' },
  b: { email: 'lobby_b@tests.invalid', fullName: 'Thám tử Bình' },
};

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
let a: Auth;
let b: Auth;

test.beforeAll(async () => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_LOBBY_FULL_STACK=true against a Development API.');
  api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL ?? 'http://localhost:5301' });
  a = await loginOrRegister(api, PLAYERS.a);
  b = await loginOrRegister(api, PLAYERS.b);
  // Night Ledger (20 min, vi + en) gives the "short" bucket a case in both languages. Seeding is
  // skipped once it is published: a case referenced by an open room cannot be re-imported.
  const published = await call<any[]>(api, 'GET', '/api/cases/published', a.token);
  if (!published.some((c) => c.caseId === 'case-point-click-night-ledger-vi')) {
    const admin = await call<Auth>(api, 'POST', '/api/auth/login', undefined, { email: 'admin@sirlocked.local', password: adminPassword });
    await call(api, 'POST', '/api/admin/cases/seed-point-click-demo', admin.token);
  }
});

test.beforeEach(async () => {
  // Leftover tickets from an earlier run would pair the players with each other too early.
  for (const auth of [a, b]) await call(api, 'POST', '/api/matchmaking/cancel', auth.token);
});

test('quick match: both accept and land in the same lobby with different roles', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  // Player B runs without SignalR, so its side relies on the polling fallback alone.
  const pageA = await openPlayer(browser, a, '/find-game');
  const pageB = await openPlayer(browser, b, '/find-game', { noSignalR: true });

  for (const page of [pageA, pageB]) {
    await expect(page.getByRole('heading', { name: 'Tìm trận', exact: true })).toBeVisible();
    await expect(page.locator('#fg-status-title')).toHaveText('Sẵn sàng tìm đồng đội');
  }

  await pageA.getByRole('button', { name: 'Ghép nhanh' }).click();
  await pageA.getByRole('button', { name: 'Điều tra viên' }).click();
  await pageA.getByRole('button', { name: /Ngắn/ }).click();
  await pageA.getByRole('button', { name: 'Tiếng Việt' }).click();
  await pageA.getByRole('button', { name: 'Bắt đầu tìm' }).click();
  await expect(pageA.locator('#fg-status-title')).toHaveText('Đang tìm đồng đội');
  await expect(pageA.locator('#fg-cancel')).toContainText('Hủy tìm');
  // Settings are locked while searching.
  await expect(pageA.getByRole('button', { name: 'Thẩm vấn viên' })).toBeDisabled();
  await pageA.screenshot({ path: testInfo.outputPath('01-searching.png') });

  await pageB.getByRole('button', { name: 'Bất kỳ' }).click();
  await pageB.getByRole('button', { name: /Ngắn/ }).click();
  await pageB.getByRole('button', { name: 'Tiếng Việt' }).click();
  await pageB.getByRole('button', { name: 'Bắt đầu tìm' }).click();

  const foundA = pageA.getByRole('dialog', { name: PLAYERS.b.fullName });
  const foundB = pageB.getByRole('dialog', { name: PLAYERS.a.fullName });
  await expect(foundA).toBeVisible({ timeout: 15_000 });
  await expect(foundB).toBeVisible({ timeout: 15_000 });
  await expect(foundA).toContainText('Khớp!');
  await expect(foundA.locator('.bpa-fg-role').first()).toContainText('Điều tra viên');
  await expect(foundA.locator('.bpa-fg-role').nth(1)).toContainText('Thẩm vấn viên');
  await expect(foundB.locator('.bpa-fg-role').first()).toContainText('Thẩm vấn viên');
  await expect(foundA.locator('#fg-found-case')).toContainText(/Vụ án: .+ · \d+ phút · Tiếng Việt/);
  await expect(foundA.locator('#fg-accept')).toContainText(/Chấp nhận · \d+/);
  await pageA.screenshot({ path: testInfo.outputPath('02-found.png') });

  await pageA.locator('#fg-accept').click();
  await expect(pageA.locator('#fg-accept')).toContainText('Đã chấp nhận');
  await expect(pageA.locator('#fg-status-title')).toHaveText('Đang chờ đồng đội');
  await pageB.locator('#fg-accept').click();

  await expect(pageA).toHaveURL(/\/lobby\/[0-9a-f]{24}$/, { timeout: 15_000 });
  await expect(pageB).toHaveURL(/\/lobby\/[0-9a-f]{24}$/, { timeout: 15_000 });
  expect(pageA.url().split('#')[1]).toBe(pageB.url().split('#')[1]);
  await expect(pageA.locator('[data-role="INVESTIGATOR"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(pageB.locator('[data-role="INTERROGATOR"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(pageA.locator('#lobby-team-h')).toContainText('2/2');
  await pageA.screenshot({ path: testInfo.outputPath('03-lobby.png') });

  const roomId = pageA.url().split('/').pop()!;
  const room = await call<any>(api, 'GET', `/api/rooms/${roomId}`, a.token);
  expect(room.visibility).toBe('PRIVATE');
  expect(room.players.map((p: any) => p.role).sort()).toEqual(['INTERROGATOR', 'INVESTIGATOR']);
  for (const auth of [a, b]) await call(api, 'POST', `/api/rooms/${roomId}/leave`, auth.token).catch(() => {});
  await pageA.context().close();
  await pageB.context().close();
});

test('public room: created by one player, listed for the other, joined with VÀO', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const pageA = await openPlayer(browser, a, '/rooms');
  await expect(pageA.getByRole('heading', { name: 'Phòng điều tra', exact: true })).toBeVisible();
  const createCard = pageA.locator('.bpa-rooms-create');
  await expect(createCard.getByRole('button', { name: /Riêng tư/ })).toHaveAttribute('aria-pressed', 'true');
  await createCard.getByRole('button', { name: /Công khai/ }).click();
  await expect(createCard.getByRole('button', { name: /Công khai/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(createCard).toContainText('Phòng sẽ xuất hiện ngay trong danh sách công khai');
  await createCard.getByLabel('Vụ án').selectOption('case-point-click-night-ledger-vi');
  await createCard.getByRole('button', { name: 'Tạo phòng' }).click();
  await expect(pageA).toHaveURL(/\/lobby\/[0-9a-f]{24}$/);
  const code = (await pageA.locator('.bpa-lobby-code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  // A private room of the same host must never be listed.
  const hidden = await call<any>(api, 'POST', '/api/rooms', a.token, { caseId: 'case-point-click-night-ledger-vi' });

  const pageB = await openPlayer(browser, b, '/rooms');
  const row = pageB.locator(`tr[data-room-code="${code}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Đang chờ');
  await expect(row).toContainText('1/2');
  await expect(row).toContainText(PLAYERS.a.fullName);
  await expect(pageB.locator(`tr[data-room-code="${hidden.roomCode}"]`)).toHaveCount(0);
  // Filters: EN hides the Vietnamese case, search by code finds it again.
  const filters = pageB.locator('.bpa-prooms-filters');
  await filters.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(row).toHaveCount(0);
  await filters.getByRole('button', { name: 'Tất cả' }).click();
  await pageB.getByLabel('Tìm phòng').fill(code.toLowerCase());
  await expect(pageB.locator('tbody tr')).toHaveCount(1);
  await expect(row).toBeVisible();
  await pageB.screenshot({ path: testInfo.outputPath('04-public-rooms.png') });

  await row.getByRole('button', { name: new RegExp(`^Vào ${code}$`) }).click();
  await expect(pageB).toHaveURL(new RegExp(`${pageA.url().split('#')[1].replace(/\//g, '\\/')}$`));
  await expect(pageA.locator('#lobby-team-h')).toContainText('2/2', { timeout: 15_000 });
  await expect(pageB.locator('#lobby-team-h')).toContainText('2/2');

  // A full room leaves the "còn chỗ" listing.
  const listed = await call<any[]>(api, 'GET', '/api/rooms/public?openOnly=true', b.token);
  expect(listed.some((r) => r.roomCode === code)).toBe(false);

  const roomId = pageA.url().split('/').pop()!;
  for (const auth of [a, b]) await call(api, 'POST', `/api/rooms/${roomId}/leave`, auth.token).catch(() => {});
  await call(api, 'POST', `/api/rooms/${hidden.roomId}/leave`, a.token).catch(() => {});
  await pageA.context().close();
  await pageB.context().close();
});

test('declining sends the partner back to the queue; cancelling leaves it', async ({ browser }) => {
  test.setTimeout(90_000);
  const pageA = await openPlayer(browser, a, '/find-game');
  const pageB = await openPlayer(browser, b, '/find-game');
  for (const page of [pageA, pageB]) {
    await page.getByRole('button', { name: 'Bất kỳ' }).click();
    await page.getByRole('button', { name: /Ngắn/ }).click();
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByRole('button', { name: 'Xếp hạng' }).click();
  }
  await pageA.getByRole('button', { name: 'Bắt đầu tìm' }).click();
  await expect(pageA.locator('#fg-status-title')).toHaveText('Đang tìm đồng đội');
  await pageB.getByRole('button', { name: 'Bắt đầu tìm' }).click();
  await expect(pageB.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByRole('dialog')).toContainText('Xếp hạng');
  await expect(pageB.locator('#fg-found-case')).toContainText('English');

  await pageB.getByRole('button', { name: 'Từ chối' }).click();
  await expect(pageB.locator('#fg-notice')).toContainText('Bạn đã từ chối trận này.');
  await expect(pageB.locator('#fg-status-title')).toHaveText('Sẵn sàng tìm đồng đội');
  await expect(pageB.getByRole('button', { name: 'Bắt đầu tìm' })).toBeEnabled();
  await expect(pageA.locator('#fg-notice')).toContainText('Đồng đội đã từ chối', { timeout: 10_000 });
  await expect(pageA.locator('#fg-status-title')).toHaveText('Đang tìm đồng đội');
  await expect(pageA.getByRole('dialog')).toHaveCount(0);

  await pageA.locator('#fg-cancel').click();
  await expect(pageA.locator('#fg-status-title')).toHaveText('Sẵn sàng tìm đồng đội');
  const status = await call<any>(api, 'GET', '/api/matchmaking/status', a.token);
  expect(status.phase).toBe('ENDED');
  expect(status.endReason).toBe('CANCELLED');
  await pageA.context().close();
  await pageB.context().close();
});

test('an unanswered match times out: the accepter keeps searching, the silent player leaves', async ({ browser }) => {
  test.setTimeout(90_000);
  const pageA = await openPlayer(browser, a, '/find-game');
  const pageB = await openPlayer(browser, b, '/find-game');
  for (const page of [pageA, pageB]) {
    await page.getByRole('button', { name: 'Ghép nhanh' }).click();
    await page.getByRole('button', { name: 'Bất kỳ' }).click();
    await page.getByRole('button', { name: /Ngắn/ }).click();
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByRole('button', { name: 'Bắt đầu tìm' }).click();
  }
  await expect(pageA.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  await pageA.locator('#fg-accept').click();
  await expect(pageB.getByRole('dialog')).toContainText('đã chấp nhận');

  // 15 s window: the countdown reaches 0 and both pages ask the server.
  await expect(pageB.locator('#fg-notice')).toContainText('Bạn chưa xác nhận kịp', { timeout: 25_000 });
  await expect(pageB.locator('#fg-status-title')).toHaveText('Sẵn sàng tìm đồng đội');
  await expect(pageA.locator('#fg-notice')).toContainText('Đồng đội không xác nhận kịp', { timeout: 10_000 });
  await expect(pageA.locator('#fg-status-title')).toHaveText('Đang tìm đồng đội');
  // Leaving the page while searching takes the ticket out of the queue.
  await pageA.goto('/menu');
  await expect.poll(async () => (await call<any>(api, 'GET', '/api/matchmaking/status', a.token)).phase).toBe('ENDED');
  await pageA.context().close();
  await pageB.context().close();
});

async function openPlayer(browser: Browser, auth: Auth, path: string, { noSignalR = false } = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(({ auth, noSignalR }) => {
    localStorage.setItem('sirlocked.token', auth.token);
    localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    if (noSignalR) (window as any).__sirlockedNoSignalR = true;
  }, { auth, noSignalR });
  await page.goto(path);
  return page;
}

/**
 * The Development API trusts loopback forwarders, so each call presents its own client address and
 * the per-IP login/register limiters (5 and 3 per window) do not throttle repeated local runs.
 */
let forwarded = 0;
async function call<T>(api: APIRequestContext, method: string, path: string, token?: string, data?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Forwarded-For': `10.77.${Math.floor(++forwarded / 250) % 250}.${forwarded % 250}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await api.fetch(path, { method, headers, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function loginOrRegister(api: APIRequestContext, player: { email: string; fullName: string }): Promise<Auth> {
  const headers = { 'X-Forwarded-For': `10.78.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  const login = await api.post('/api/auth/login', { headers, data: { email: player.email, password } });
  if (login.ok()) return (await login.json()).data;
  return call<Auth>(api, 'POST', '/api/auth/register', undefined, { ...player, password });
}
