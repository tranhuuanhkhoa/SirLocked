import { expect, request, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * VUAN-3 end to end: the order form of /admin/ai against a running API (Development, loopback Mongo) whose bridge has a
 * key but no bot, so an ADMIN order stays "Chờ Claude" and nothing calls Claude or PixelLab. The library must already
 * hold pictures (PUT /api/bridge/library with the local key). Run with:
 *
 *   SIRLOCKED_RUN_AI_ORDER_FULL_STACK=true SIRLOCKED_TEST_API_URL=http://127.0.0.1:5293 \
 *   SIRLOCKED_TEST_ADMIN_EMAIL=admin@sirlocked.local SIRLOCKED_TEST_ADMIN_PASSWORD=LocalDemo123! \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5193 SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   SIRLOCKED_AI_ORDER_EVIDENCE_DIR="../../Claude outputs/vu-an-claude/anh-man-tao-vu" \
 *   npx playwright test tests/admin-ai-order-full-stack.spec.ts
 *
 * The API runs with Auth__AutoVerifyRegistrations=true; each run registers one fresh VIP and writes only to that database.
 */
type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string; fullName: string; role: string } };

const enabled = process.env.SIRLOCKED_RUN_AI_ORDER_FULL_STACK === 'true';
const evidenceDir = process.env.SIRLOCKED_AI_ORDER_EVIDENCE_DIR;
const failures: string[] = [];

async function login(api: APIRequestContext, email: string, password: string): Promise<Auth> {
  const response = await api.post('/api/auth/login', { data: { email, password } });
  const body = await response.text();
  expect(response.ok(), `login ${email}: ${response.status()} ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function call<T = any>(api: APIRequestContext, method: string, path: string, token: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: { Authorization: `Bearer ${token}` }, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function openAs(browser: Browser, auth: Auth, viewport = { width: 1440, height: 900 }): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`${auth.user.role} pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`${auth.user.role} console: ${message.text()}`); });
  page.on('dialog', (dialog) => {
    // Cancelling, approving and rejecting all ask inside the page: no browser dialog is expected at all.
    failures.push(`${auth.user.role} browser ${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await page.addInitScript((value) => {
    localStorage.setItem('sirlocked.token', value.token);
    localStorage.setItem('sirlocked.refreshToken', value.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', value.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(value.user));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  }, auth);
  return { page, context };
}

async function openForm(page: Page) {
  await page.goto('/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeVisible();
  await expect(page.locator('.bpa-rim')).toHaveCount(0, { timeout: 15_000 });
}

/** Waits until every picture on screen has really loaded (a broken one has naturalWidth 0). */
async function picturesLoaded(page: Page) {
  await page.evaluate(async () => {
    for (const image of [...document.images]) image.loading = 'eager';
    await Promise.all([...document.images].map((image) => (image.complete ? null : new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 15_000);
    }))));
  });
}

async function shot(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  await picturesLoaded(page);
  await page.mouse.move(0, 0);
  // A full-page shot of a scrolled page draws the sticky top bar in the middle: start from the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true });
}

const rowOf = (page: Page, draftId: string) => page.locator(`[data-draft-row="${draftId}"]`);

// Several sessions share this machine; give a busy page more than ten seconds.
test.setTimeout(240_000);

test('VUAN-3 order form: ADMIN and VIP orders straight to Claude, weekly limit, fast mode, phone and desktop', async ({ browser }) => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_AI_ORDER_FULL_STACK=true against a local API with a bridge key and no bot.');
  const apiUrl = process.env.SIRLOCKED_TEST_API_URL!;
  const api = await request.newContext({ baseURL: apiUrl });
  const admin = await login(api, process.env.SIRLOCKED_TEST_ADMIN_EMAIL!, process.env.SIRLOCKED_TEST_ADMIN_PASSWORD!);
  const library = await call<any[]>(api, 'GET', '/api/admin/ai-cases/library', admin.token);
  expect(library.length, 'seed the library first (PUT /api/bridge/library)').toBeGreaterThan(20);
  // Start from the default weekly limit.
  await call(api, 'PUT', '/api/admin/ai-cases/settings', admin.token, { vipWeeklyOrderLimit: 2 });

  // A fresh VIP: register, promote, sign in again so the token carries the VIP role.
  const stamp = Date.now().toString(36);
  const email = `vip-${stamp}@vuan3.sirlocked.local`;
  const password = 'Vuan3-order-1!';
  const registered = await api.post('/api/auth/register', {
    data: { fullName: 'Khách VIP thử', email, password },
    headers: { 'X-Forwarded-For': `10.83.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
  expect(registered.ok(), await registered.text()).toBe(true);
  const vipUserId = (await registered.json()).data.user.userId;
  await call(api, 'PATCH', `/api/admin/users/${vipUserId}/role?reason=${encodeURIComponent('VUAN-3 thử đơn VIP')}`, admin.token, { role: 'VIP' });
  const vip = await login(api, email, password);
  expect(vip.user.role).toBe('VIP');

  // ---------------------------------------------------------------- ADMIN, 1440 px: all seven cards
  const adminDesk = await openAs(browser, admin);
  const a = adminDesk.page;
  await openForm(a);
  await expect(a.locator('[data-world="HANG_DUONG_VICTORIAN"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(a.locator('#ai-pixellab-cap')).toHaveValue('30');
  await expect(a.locator('input[name="aai-review"][value="FULL"]')).toBeChecked();
  await expect(a.locator('input[name="aai-content"][value="LIGHT"]')).toBeChecked();
  await expect(a.locator('input[name="aai-weather"][value="AUTO"]')).toBeChecked();
  await expect(a.locator('input[name="aai-time"][value="AUTO"]')).toBeChecked();
  await picturesLoaded(a);
  for (const world of ['HANG_DUONG_VICTORIAN', 'TAISHO_JAPAN', 'SHANGHAI_1930']) {
    expect(await a.locator(`[data-world="${world}"] img`).evaluate((image: HTMLImageElement) => image.naturalWidth), `${world} thumbnail`).toBeGreaterThan(0);
  }
  await shot(a, 'admin-1440-mac-dinh');

  await a.locator('[data-world="TAISHO_JAPAN"]').focus();
  await a.keyboard.press('Enter');
  const taishoPlaces = library.filter((entry) => entry.world === 'TAISHO_JAPAN' && ['OUTDOOR_MAP', 'INTERIOR'].includes(entry.kind));
  const taishoNpcs = library.filter((entry) => entry.world === 'TAISHO_JAPAN' && entry.kind === 'NPC');
  await expect(a.locator('#ai-location-grid [data-location]')).toHaveCount(taishoPlaces.length);
  const outdoor = taishoPlaces.find((entry) => entry.kind === 'OUTDOOR_MAP')!;
  const indoor = taishoPlaces.find((entry) => entry.kind === 'INTERIOR')!;
  await a.locator(`[data-location="${outdoor.key}"]`).focus();
  await a.keyboard.press('Space');
  await a.locator(`[data-location="${indoor.key}"]`).click();
  await a.locator('[data-field="stageCount"] label', { hasText: '5' }).click();
  await a.locator('[data-field="playMinutes"] label', { hasText: '45 phút' }).click();
  await a.locator('label.aai-chip', { hasText: 'Mất tích' }).click();
  await a.locator('[data-field="suspectCount"] label', { hasText: '4' }).click();
  await a.locator(`[data-npc="${taishoNpcs[0].key}"]`).click();
  await a.locator(`[data-npc="${taishoNpcs[1].key}"]`).click();
  await a.locator('#ai-character-notes').fill('Bà chủ nhà trà biết mọi chuyện trong phố.');
  await a.locator('[data-field="weather"] label', { hasText: 'Mưa' }).click();
  await a.locator('[data-field="timeOfDay"] label', { hasText: 'Đêm' }).click();
  await a.locator('#ai-tone-lock').selectOption('melancholic');
  await a.locator('#ai-creator-direction').fill('Một geisha mất tích đêm lễ hội đèn lồng.');
  await a.locator('[data-idea-hint="secret"]').click();
  await a.keyboard.press('End');
  await a.keyboard.type('chiếc trâm bạc bị đánh tráo');
  await a.locator('#ai-mechanic-lock').selectOption('timeline');
  await a.locator('#ai-pixellab-cap').selectOption('0');
  await a.locator('[data-field="reviewMode"] label', { hasText: 'Nhanh' }).click();
  await expect(a.locator('#ai-review-steps li')).toHaveCount(2);
  await a.locator('[data-field="reviewMode"] label', { hasText: 'Đầy đủ 4 cổng' }).click();
  await expect(a.locator('#ai-review-steps li')).toHaveCount(5);
  await shot(a, 'admin-1440-da-dien-du-7-the');

  const sent = a.waitForRequest((req) => new URL(req.url()).pathname === '/api/admin/ai-cases' && req.method() === 'POST');
  const answered = a.waitForResponse((res) => new URL(res.url()).pathname === '/api/admin/ai-cases' && res.request().method() === 'POST');
  await a.locator('#quick-create-btn').click();
  const body = (await sent).postDataJSON();
  expect(body).toMatchObject({
    prompt: 'Một geisha mất tích đêm lễ hội đèn lồng.\nBí mật: chiếc trâm bạc bị đánh tráo',
    stageCount: 5, difficulty: 'medium', generationPreset: 'NORMAL_RANDOM', caseType: 'MISSING_PERSON',
    creativeConstraints: { settingId: '', toneId: 'melancholic', investigationMechanicId: 'timeline' },
    order: {
      world: 'TAISHO_JAPAN', locationIds: [outdoor.key, indoor.key], npcIds: [taishoNpcs[0].key, taishoNpcs[1].key], suspectCount: 4,
      characterNotes: 'Bà chủ nhà trà biết mọi chuyện trong phố.', weather: 'RAIN', timeOfDay: 'NIGHT', playMinutes: 45,
      contentLevel: 'LIGHT', pixelLabCap: 0, reviewMode: 'FULL',
    },
  });
  const created = (await (await answered).json()).data;
  expect(created.orderStatus).toBe('QUEUED_FOR_CLAUDE');
  // The server stored the order as sent.
  const stored = await call(api, 'GET', `/api/admin/ai-cases/${created.draftId}`, admin.token);
  expect(stored.order).toMatchObject({ world: 'TAISHO_JAPAN', weather: 'RAIN', timeOfDay: 'NIGHT', pixelLabCap: 0, reviewMode: 'FULL', npcIds: [taishoNpcs[0].key, taishoNpcs[1].key] });
  await expect(rowOf(a, created.draftId).locator('[data-order-status]')).toHaveText('Chờ Claude');
  await expect(rowOf(a, created.draftId).locator('[data-order-time]')).not.toBeEmpty();
  await expect(a.locator('#ai-output')).toContainText('Nhật Bản Taishō');

  // ---------------------------------------------------------------- VIP, 1440 px
  const vipDesk = await openAs(browser, vip);
  const v = vipDesk.page;
  await openForm(v);
  await expect(v.locator('#ai-pixellab-cap')).toHaveValue('-1');
  await expect(v.locator('input[name="aai-review"][value="FULL"]')).toBeChecked();
  await expect(v.locator('.aai-settings')).toHaveCount(0);
  await expect(v.locator('#ai-vip-quota')).toContainText('Đơn vào hàng chờ Claude ngay');
  await expect(v.locator('[data-quota-remaining]')).toHaveText('Còn 2/2 đơn trong tuần này.');
  await shot(v, 'vip-1440-mac-dinh');

  const vipOrders: string[] = [];
  for (const idea of ['Đơn VIP thứ nhất: trộm ở bến cảng.', 'Đơn VIP thứ hai: phá hoại tiệm đồng hồ.']) {
    await v.locator('#ai-creator-direction').fill(idea);
    const vipSent = v.waitForRequest((req) => new URL(req.url()).pathname === '/api/admin/ai-cases' && req.method() === 'POST');
    const vipAnswered = v.waitForResponse((res) => new URL(res.url()).pathname === '/api/admin/ai-cases' && res.request().method() === 'POST');
    await v.locator('#quick-create-btn').click();
    const vipBody = (await vipSent).postDataJSON();
    expect(vipBody.order).toMatchObject({ pixelLabCap: -1, reviewMode: 'FULL' });
    const vipDraft = (await (await vipAnswered).json()).data;
    expect(vipDraft.orderStatus).toBe('QUEUED_FOR_CLAUDE'); // a VIP order goes straight to Claude
    expect(vipDraft.order).toMatchObject({ pixelLabCap: -1, reviewMode: 'FULL' });
    vipOrders.push(vipDraft.draftId);
    await expect(rowOf(v, vipDraft.draftId).locator('[data-order-status]')).toHaveText('Chờ Claude');
  }
  await expect(v.locator('[data-quota-remaining]')).toHaveText('Còn 0/2 đơn trong tuần này.');
  await expect(v.locator('#quick-create-btn')).toBeDisabled();
  await expect(v.locator('#ai-submit-reason')).toContainText('Bạn đã dùng hết 2 đơn của tuần này');
  await expect(v.locator('[data-approve-order]')).toHaveCount(0);
  await shot(v, 'vip-1440-het-luot-tuan');

  // ---------------------------------------------------------------- ADMIN sees the VIP orders queued and raises the weekly limit
  await openForm(a);
  await expect(rowOf(a, vipOrders[0]).locator('[data-order-status]')).toHaveText('Chờ Claude');
  await expect(a.locator('[data-approve-order]')).toHaveCount(0);
  await a.locator('#ai-vip-weekly-limit').fill('3');
  await a.locator('#ai-save-settings').click();
  await expect(a.locator('#ai-settings-status')).toHaveText('Đã lưu: mỗi VIP được gửi 3 đơn mỗi tuần.');
  await openForm(v);
  await expect(v.locator('[data-quota-remaining]')).toHaveText('Còn 1/3 đơn trong tuần này.');
  await expect(v.locator('#quick-create-btn')).toBeEnabled();
  await call(api, 'PUT', '/api/admin/ai-cases/settings', admin.token, { vipWeeklyOrderLimit: 2 });

  // The ADMIN test order is cancelled again, as on production ("đặt thử 1 đơn rồi hủy").
  await rowOf(a, created.draftId).getByRole('button', { name: 'Hủy bản nháp' }).click();
  await a.locator('dialog.aai-cancel-dialog').getByRole('button', { name: 'Hủy bản nháp' }).click();
  await expect(rowOf(a, created.draftId).locator('[data-order-status]')).toHaveText('Đã hủy');
  await shot(a, 'admin-1440-bang-ban-nhap');

  // ---------------------------------------------------------------- 390 px phones
  for (const [auth, name] of [[admin, 'admin'], [vip, 'vip']] as const) {
    const phone = await openAs(browser, auth, { width: 390, height: 844 });
    await openForm(phone.page);
    expect(await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const formBox = (await phone.page.locator('.aai-form').boundingBox())!;
    const asideBox = (await phone.page.locator('.aai-aside').boundingBox())!;
    expect(asideBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height - 1);
    await phone.page.locator('[data-world="TAISHO_JAPAN"]').click();
    await phone.page.locator(`[data-location="${outdoor.key}"]`).click();
    await shot(phone.page, `${name}-390`);
    await phone.context.close();
  }

  // ---------------------------------------------------------------- English
  await a.locator('[data-ui-language="en"]').click();
  await expect(a.locator('#quick-create-btn')).toHaveText('Send order to Claude');
  await expect(a.locator('.aai-form .adm-card-title').first()).toHaveText('World and locations');
  await shot(a, 'admin-1440-tieng-anh');

  await adminDesk.context.close();
  await vipDesk.context.close();
  await api.dispose();
  // Pictures come from Cloudinary; a slow one is not an error, but nothing in the page may throw or log an error.
  expect(failures).toEqual([]);
});
