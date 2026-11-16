import { expect, test, type Page } from '@playwright/test';

/**
 * VUAN-3: the order form of /admin/ai (seven cards, the summary, the drafts table, VIP orders, the weekly limit and
 * the bot's report). Every API call is answered here: nothing reaches a server, a bot or PixelLab.
 */

const envelope = (data: unknown) => ({ success: true, data });
// A 1x1 PNG served for every library picture, so thumbnails load without the network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const pic = (name: string) => `https://library.sirlocked.test/${name}.png`;

const LIBRARY = [
  { key: 'h-map-ben-cang', kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Bến cảng', nameEn: 'Harbour', thumbUrl: pic('h-map-ben-cang'), url: pic('h-map-ben-cang') },
  { key: 'h-map-pho-chinh', kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Phố chính', nameEn: 'High street', thumbUrl: pic('h-map-pho-chinh'), url: pic('h-map-pho-chinh') },
  { key: 'h-room-tiem-dong-ho', kind: 'INTERIOR', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Tiệm đồng hồ', nameEn: 'Watch shop', thumbUrl: pic('h-room-tiem-dong-ho'), url: pic('h-room-tiem-dong-ho') },
  { key: 'h-npc-01-tho-dong-ho', kind: 'NPC', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Thợ đồng hồ', nameEn: 'Watchmaker', url: pic('h-npc-01'), files: { portrait: pic('h-npc-01-portrait') } },
  { key: 'h-npc-02-co-dao', kind: 'NPC', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Cô đào', nameEn: 'Actress', url: pic('h-npc-02'), files: { portrait: pic('h-npc-02-portrait') } },
  { key: 'j-map-pho-den-long', kind: 'OUTDOOR_MAP', world: 'TAISHO_JAPAN', nameVi: 'Phố đèn lồng', nameEn: 'Lantern street', thumbUrl: pic('j-map-pho-den-long'), url: pic('j-map-pho-den-long') },
  { key: 'j-map-ga-tau-dien', kind: 'OUTDOOR_MAP', world: 'TAISHO_JAPAN', nameVi: 'Ga tàu điện', nameEn: 'Tram stop', thumbUrl: pic('j-map-ga-tau-dien'), url: pic('j-map-ga-tau-dien') },
  { key: 'j-room-nha-tra', kind: 'INTERIOR', world: 'TAISHO_JAPAN', nameVi: 'Nhà trà', nameEn: 'Tea house', thumbUrl: pic('j-room-nha-tra'), url: pic('j-room-nha-tra') },
  ...Array.from({ length: 8 }, (_, index) => ({
    key: `j-npc-0${index + 1}`, kind: 'NPC', world: 'TAISHO_JAPAN', nameVi: `Người Taishō ${index + 1}`, nameEn: `Taishō person ${index + 1}`,
    url: pic(`j-npc-0${index + 1}`), files: { portrait: pic(`j-npc-0${index + 1}-portrait`) },
  })),
  { key: 'c-map-ben-song', kind: 'OUTDOOR_MAP', world: 'SHANGHAI_1930', nameVi: 'Bến sông', nameEn: 'Riverside bund', thumbUrl: pic('c-map-ben-song'), url: pic('c-map-ben-song') },
  { key: 'item-dong-ho-bo-tui', kind: 'ITEM', world: 'ALL', nameVi: 'Đồng hồ bỏ túi', nameEn: 'Pocket watch', thumbUrl: pic('item'), url: pic('item') },
  { key: 'h-map-hong', kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Ảnh hỏng', nameEn: 'Broken', thumbUrl: pic('broken'), url: pic('broken'), retired: true },
];

const capabilities = {
  aiCaseV3PresetEnabled: true, gameplayV3Enabled: true, canCreateDraft: true, canCreateV3Draft: true,
  creationBlockers: [], v3CreationBlockers: [],
};

type Role = 'ADMIN' | 'VIP';
type Draft = Record<string, any>;

function draftOf(id: string, role: Role, orderStatus: string, extra: Draft = {}): Draft {
  const at = '2026-11-16T07:30:00Z';
  return {
    draftId: id, status: 'GENERATING_STORY', queueState: orderStatus === 'AWAITING_OWNER_APPROVAL' ? 'NONE' : 'PENDING',
    createdByRole: role, createdByUserId: role === 'VIP' ? 'vip-1' : 'admin-1', canCancel: true,
    settings: { generationPreset: 'NORMAL_RANDOM', language: 'vi', caseType: 'MURDER' },
    prompt: 'Một geisha mất tích đêm lễ hội',
    order: { world: 'TAISHO_JAPAN', locationIds: ['j-map-pho-den-long'], npcIds: [], suspectCount: 4, characterNotes: '', weather: 'RAIN', timeOfDay: 'NIGHT', playMinutes: 30, contentLevel: 'LIGHT', pixelLabCap: 30, reviewMode: 'FULL' },
    orderStatus, orderStatusHistory: [{ status: orderStatus, at }],
    ...extra,
  };
}

interface Mock {
  drafts: Draft[];
  posts: any[];
  postHeaders: Record<string, string>[];
  approve: string[];
  reject: { id: string; body: any }[];
  settingsPuts: any[];
  quota: { unlimited: boolean; weeklyLimit: number; usedThisWeek: number; remaining: number; weekStart: string };
  createResponse?: (body: any) => { status: number; json: unknown };
  dialogs: string[];
  errors: string[];
}

async function setUp(page: Page, role: Role, language: 'vi' | 'en' = 'vi', overrides: Partial<Mock> = {}): Promise<Mock> {
  const mock: Mock = {
    drafts: [], posts: [], postHeaders: [], approve: [], reject: [], settingsPuts: [],
    quota: { unlimited: false, weeklyLimit: 2, usedThisWeek: 0, remaining: 2, weekStart: '2026-11-16' },
    dialogs: [], errors: [],
    ...overrides,
  };
  page.on('dialog', (dialog) => { mock.dialogs.push(dialog.type()); void dialog.dismiss(); });
  page.on('pageerror', (error) => mock.errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') mock.errors.push(`console: ${message.text()}`); });
  await page.addInitScript(({ userRole, uiLanguage }) => {
    localStorage.setItem('sirlocked.token', 'order-form-token');
    localStorage.setItem('sirlocked.uiLanguage', uiLanguage);
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: userRole === 'VIP' ? 'vip-1' : 'admin-1', fullName: userRole === 'VIP' ? 'Khách VIP' : 'Yến', role: userRole, isEmailVerified: true,
    }));
  }, { userRole: role, uiLanguage: language });
  await page.route('https://library.sirlocked.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  // Anything not answered below gets an empty success, never a real server.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ json: envelope(null) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/capabilities', (route) => route.fulfill({ json: envelope(capabilities) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/library', (route) => route.fulfill({ json: envelope(LIBRARY) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/quota', (route) => route.fulfill(role === 'ADMIN'
    ? { json: envelope({ role, unlimited: true, weeklyLimit: 0, usedThisWeek: 0, remaining: 0, weekStart: '2026-11-16' }) }
    : { json: envelope({ role, ...mock.quota }) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/settings', async (route) => {
    if (role !== 'ADMIN') return route.fulfill({ status: 403, json: { success: false, message: 'Forbidden' } });
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      mock.settingsPuts.push(body);
      return route.fulfill({ json: envelope({ id: 'aiCases', vipWeeklyOrderLimit: body.vipWeeklyOrderLimit }) });
    }
    return route.fulfill({ json: envelope({ id: 'aiCases', vipWeeklyOrderLimit: 2 }) });
  });
  await page.route((url) => url.pathname === '/api/admin/ai-cases', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: envelope(mock.drafts) });
    const body = request.postDataJSON();
    mock.posts.push(body);
    mock.postHeaders.push(await request.allHeaders());
    if (mock.createResponse) {
      const answer = mock.createResponse(body);
      return route.fulfill({ status: answer.status, json: answer.json });
    }
    const created = draftOf(`new-${mock.posts.length}`, role, role === 'VIP' ? 'AWAITING_OWNER_APPROVAL' : 'QUEUED_FOR_CLAUDE', {
      prompt: body.prompt, order: body.order, settings: { generationPreset: body.generationPreset, language: body.language, caseType: body.caseType },
    });
    mock.drafts = [created, ...mock.drafts];
    if (role === 'VIP') mock.quota = { ...mock.quota, usedThisWeek: mock.quota.usedThisWeek + 1, remaining: Math.max(0, mock.quota.remaining - 1) };
    return route.fulfill({ status: 202, json: envelope(created) });
  });
  await page.route((url) => /^\/api\/admin\/ai-cases\/[^/]+$/.test(url.pathname)
    && !['capabilities', 'library', 'quota', 'settings'].includes(url.pathname.split('/').pop()!), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    const draft = mock.drafts.find((item) => item.draftId === id);
    return route.fulfill(draft ? { json: envelope(draft) } : { status: 404, json: { success: false, message: 'Not found' } });
  });
  await page.route((url) => /\/approve-order$/.test(url.pathname), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').slice(-2)[0];
    mock.approve.push(id);
    mock.drafts = mock.drafts.map((draft) => draft.draftId === id
      ? { ...draft, orderStatus: 'QUEUED_FOR_CLAUDE', queueState: 'PENDING', orderStatusHistory: [...draft.orderStatusHistory, { status: 'QUEUED_FOR_CLAUDE', at: '2026-11-16T08:00:00Z' }] }
      : draft);
    return route.fulfill({ json: envelope(mock.drafts.find((draft) => draft.draftId === id)) });
  });
  await page.route((url) => /\/reject-order$/.test(url.pathname), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').slice(-2)[0];
    const body = route.request().postDataJSON();
    mock.reject.push({ id, body });
    mock.drafts = mock.drafts.map((draft) => draft.draftId === id
      ? { ...draft, status: 'CANCELLED', queueState: 'CANCELLED', canCancel: false, orderStatus: 'REJECTED', orderRejectReason: body.reason, orderStatusHistory: [...draft.orderStatusHistory, { status: 'REJECTED', at: '2026-11-16T08:05:00Z', reason: body.reason }] }
      : draft);
    return route.fulfill({ json: envelope(mock.drafts.find((draft) => draft.draftId === id)) });
  });
  return mock;
}

/** Waits for the form and its library pictures. */
async function open(page: Page) {
  await page.goto('/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeVisible();
  await expect(page.locator('[data-location="h-map-ben-cang"] img')).toHaveJSProperty('complete', true);
}

const pressed = (page: Page, selector: string) => page.locator(selector);

test('an ADMIN order fills all seven cards with the keyboard and mouse, sends the exact order body and shows "Chờ Claude"', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);

  // Card order of plan section 6, and the defaults Yen settled on.
  await expect(page.locator('.aai-form .adm-card-title')).toHaveText([
    'Thế giới và địa điểm', 'Cấu hình tạo', 'Ngôn ngữ và loại vụ án', 'Nhân vật', 'Không khí', 'Mở rộng gameplay', 'Ý tưởng',
  ]);
  await expect(page.locator('.aai-form .aai-step-num')).toHaveText(['01', '02', '03', '04', '05', '06', '07']);
  await expect(pressed(page, '[data-world="HANG_DUONG_VICTORIAN"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('input[name="aai-weather"][value="AUTO"]')).toBeChecked();
  await expect(page.locator('input[name="aai-time"][value="AUTO"]')).toBeChecked();
  await expect(page.locator('input[name="aai-content"][value="LIGHT"]')).toBeChecked();
  await expect(page.locator('#ai-pixellab-cap')).toHaveValue('30');
  await expect(page.locator('input[name="aai-review"][value="FULL"]')).toBeChecked();
  await expect(page.locator('#quick-create-btn')).toHaveText('Gửi đơn cho Claude');
  await expect(page.locator('#ai-setting-lock')).toHaveCount(0);
  await expect(page.locator('[data-location="h-map-hong"]')).toHaveCount(0); // retired pictures never show
  await expect(page.locator('[data-world="HANG_DUONG_VICTORIAN"] img')).toHaveAttribute('src', pic('h-map-ben-cang'));

  // 01 World and places, by keyboard: Tab moves between the world cards, Enter and Space pick.
  await page.mouse.move(0, 0);
  await page.locator('[data-world="HANG_DUONG_VICTORIAN"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-world="TAISHO_JAPAN"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-world="TAISHO_JAPAN"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-world="HANG_DUONG_VICTORIAN"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-world="TAISHO_JAPAN"]')).toHaveAttribute('aria-label', /Nhật Bản Taishō/);
  await page.locator('[data-location="j-map-pho-den-long"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-location="j-map-pho-den-long"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-location="j-map-ga-tau-dien"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.locator('[data-location-kind="INTERIOR"]').click();
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveCount(1);
  await page.locator('[data-location="j-room-nha-tra"]').click();
  await page.locator('[data-location-kind=""]').click();
  await expect(page.locator('#ai-location-count')).toHaveText('đã chọn 3');

  // 02 Preset with stages, difficulty and play time.
  await page.locator('label.aai-preset', { hasText: 'Nặng câu đố' }).click();
  await expect(page.locator('input[name="aai-stages"][value="5"]')).toBeChecked();
  await expect(page.locator('input[name="aai-stages"][value="4"]')).toBeDisabled();
  await expect(page.locator('input[name="aai-difficulty"][value="easy"]')).toBeDisabled();
  await page.locator('label.aai-preset', { hasText: 'Ngẫu nhiên cân bằng' }).click();
  await expect(page.locator('input[name="aai-stages"][value="4"]')).toBeEnabled();
  await page.locator('[data-field="stageCount"] label', { hasText: '5' }).click();
  await page.locator('[data-field="difficulty"] label', { hasText: 'Khó' }).click();
  await page.locator('[data-field="playMinutes"] label', { hasText: '45 phút' }).click();

  // 03 Language, case type, content level.
  await page.locator('#ai-language-select').selectOption('vi');
  await page.locator('label.aai-chip', { hasText: 'Án mạng' }).click();
  await page.locator('[data-field="contentLevel"] label', { hasText: 'Thường' }).click();
  await expect(page.locator('#ai-content-help')).toContainText('Trinh thám cổ điển');

  // 04 Characters: suspects, NPC portraits of this world, notes.
  await page.locator('[data-field="suspectCount"] label', { hasText: '5' }).click();
  await expect(page.locator('#ai-npc-grid [data-npc]')).toHaveCount(8);
  await page.locator('[data-npc="j-npc-01"]').click();
  await page.locator('[data-npc="j-npc-02"]').click();
  await expect(page.locator('#ai-npc-count')).toHaveText('2 / 8');
  await page.locator('#ai-character-notes').fill('Một ông chủ nhà trà biết mọi chuyện.');

  // 05 Atmosphere.
  await page.locator('[data-field="weather"] label', { hasText: 'Mưa' }).click();
  await page.locator('[data-field="timeOfDay"] label', { hasText: 'Đêm' }).click();
  await page.locator('#ai-tone-lock').selectOption('tense');

  // 06 Crack the Lie, 07 idea with a hint chip, and the mechanic lock.
  await page.locator('#ai-include-crack').check();
  await page.locator('#ai-creator-direction').fill('Một geisha mất tích đêm lễ hội.');
  await page.locator('[data-idea-hint="victim"]').click();
  await page.keyboard.type('cô Hana');
  await expect(page.locator('#ai-creator-direction')).toHaveValue('Một geisha mất tích đêm lễ hội.\nNạn nhân: cô Hana');
  await page.locator('#ai-mechanic-lock').selectOption('timeline');

  // ADMIN-only summary controls.
  await page.locator('#ai-pixellab-cap').selectOption('60');
  await page.locator('[data-field="reviewMode"] label', { hasText: 'Nhanh' }).click();

  const summary = page.locator('.aai-summary-list');
  await expect(summary.locator('[data-aai-sum="world"]')).toHaveText('Nhật Bản Taishō');
  await expect(summary.locator('[data-aai-sum="locations"]')).toHaveText('Phố đèn lồng, Ga tàu điện, Nhà trà');
  await expect(summary.locator('[data-aai-sum="characters"]')).toHaveText('5 nghi phạm · Người Taishō 1, Người Taishō 2');
  await expect(summary.locator('[data-aai-sum="weather"]')).toHaveText('Mưa');
  await expect(summary.locator('[data-aai-sum="timeOfDay"]')).toHaveText('Đêm');
  await expect(summary.locator('[data-aai-sum="scope"]')).toHaveText('5 chặng · Khó · 45 phút');

  await page.locator('#quick-create-btn').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0]).toEqual({
    prompt: 'Một geisha mất tích đêm lễ hội.\nNạn nhân: cô Hana',
    stageCount: 5,
    difficulty: 'hard',
    generationPreset: 'NORMAL_RANDOM',
    language: 'vi',
    includeCrackTheLie: true,
    caseType: 'MURDER',
    creativeConstraints: { settingId: '', toneId: 'tense', investigationMechanicId: 'timeline' },
    order: {
      world: 'TAISHO_JAPAN',
      locationIds: ['j-map-pho-den-long', 'j-map-ga-tau-dien', 'j-room-nha-tra'],
      npcIds: ['j-npc-01', 'j-npc-02'],
      suspectCount: 5,
      characterNotes: 'Một ông chủ nhà trà biết mọi chuyện.',
      weather: 'RAIN',
      timeOfDay: 'NIGHT',
      playMinutes: 45,
      contentLevel: 'STANDARD',
      pixelLabCap: 60,
      reviewMode: 'FAST',
    },
  });
  expect(mock.postHeaders[0]['idempotency-key']).toBeTruthy();
  const row = page.locator('.aai-drafts-table tbody tr', { has: page.locator('[data-order-status]') }).first();
  await expect(row.locator('[data-order-status="QUEUED_FOR_CLAUDE"]')).toHaveText('Chờ Claude');
  await expect(row.locator('[data-order-time]')).not.toBeEmpty();
  await expect(page.locator('.aai-drafts-table thead')).toContainText('Người đặt');
  await expect(page.locator('.aai-drafts-table thead')).toContainText('Trạng thái đơn');
  await expect(page.locator('.aai-drafts-table thead')).not.toContainText('Nhà cung cấp');
  // The choices survive the redraw after sending.
  await expect(page.locator('[data-world="TAISHO_JAPAN"]')).toHaveAttribute('aria-pressed', 'true');
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('a VIP never sees the PixelLab cap or review mode, orders wait for Yen, and the last weekly order locks the button with a reason', async ({ page }) => {
  const mock = await setUp(page, 'VIP', 'vi', { quota: { unlimited: false, weeklyLimit: 2, usedThisWeek: 1, remaining: 1, weekStart: '2026-11-16' } });
  await open(page);
  await expect(page.locator('#ai-pixellab-cap')).toHaveCount(0);
  await expect(page.locator('input[name="aai-review"]')).toHaveCount(0);
  await expect(page.locator('.aai-settings')).toHaveCount(0);
  await expect(page.locator('#ai-vip-quota')).toContainText('Đơn sẽ chờ Yen duyệt');
  await expect(page.locator('#ai-vip-quota [data-quota-remaining]')).toHaveText('Còn 1/2 đơn trong tuần này.');
  await expect(page.locator('#ai-review-steps li')).toHaveCount(5);

  await page.locator('[data-location="h-map-ben-cang"]').click();
  await page.locator('#quick-create-btn').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].order).toEqual({
    world: 'HANG_DUONG_VICTORIAN', locationIds: ['h-map-ben-cang'], npcIds: [], suspectCount: 4, characterNotes: '',
    weather: 'AUTO', timeOfDay: 'AUTO', playMinutes: 30, contentLevel: 'LIGHT',
  });
  await expect(page.locator('.aai-drafts-table [data-order-status="AWAITING_OWNER_APPROVAL"]')).toHaveText('Chờ Yen duyệt');
  await expect(page.locator('.aai-drafts-table [data-approve-order]')).toHaveCount(0);
  // No polling for an order only an admin can move.
  await expect(page.locator('#generation-progress')).toBeHidden();

  await expect(page.locator('#ai-vip-quota [data-quota-remaining]')).toHaveText('Còn 0/2 đơn trong tuần này.');
  await expect(page.locator('#quick-create-btn')).toBeDisabled();
  await expect(page.locator('#ai-submit-reason')).toHaveText('Bạn đã dùng hết 2 đơn của tuần này. Tuần mới bắt đầu từ thứ Hai (giờ Việt Nam).');
  await expect(page.locator('#quick-create-btn')).toHaveAttribute('aria-describedby', 'ai-submit-reason');
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('ADMIN approves one VIP order and rejects another with a reason typed in the page, never a browser dialog', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  mock.drafts = [draftOf('vip-a', 'VIP', 'AWAITING_OWNER_APPROVAL'), draftOf('vip-b', 'VIP', 'AWAITING_OWNER_APPROVAL', { prompt: 'Vụ thứ hai' })];
  await open(page);
  const rowA = page.locator('[data-draft-row="vip-a"]');
  const rowB = page.locator('[data-draft-row="vip-b"]');
  await expect(rowA.locator('[data-order-status]')).toHaveText('Chờ Yen duyệt');

  await rowA.getByRole('button', { name: 'Duyệt đơn' }).click();
  await expect(rowA.locator('[data-order-status]')).toHaveText('Chờ Claude');
  expect(mock.approve).toEqual(['vip-a']);

  await rowB.getByRole('button', { name: 'Từ chối' }).click();
  const dialog = page.locator('dialog.aai-reject-dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Từ chối đơn VIP' })).toBeVisible();
  await expect(dialog.getByLabel('Lý do')).toBeFocused();
  await dialog.getByRole('button', { name: 'Từ chối đơn' }).click();
  await expect(dialog.locator('#aai-reject-error')).toHaveText('Hãy ghi lý do cho VIP.');
  expect(mock.reject).toEqual([]);
  // Cancelling leaves the order untouched.
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(page.locator('dialog.aai-reject-dialog')).toHaveCount(0);
  await expect(rowB.locator('[data-order-status]')).toHaveText('Chờ Yen duyệt');

  await rowB.getByRole('button', { name: 'Từ chối' }).click();
  await page.locator('dialog.aai-reject-dialog[open]').getByLabel('Lý do').fill('Ý tưởng trùng vụ tuần trước.');
  await page.locator('dialog.aai-reject-dialog[open]').getByRole('button', { name: 'Từ chối đơn' }).click();
  await expect(page.locator('dialog.aai-reject-dialog')).toHaveCount(0);
  await expect(rowB.locator('[data-order-status]')).toHaveText('Đã từ chối');
  expect(mock.reject).toEqual([{ id: 'vip-b', body: { reason: 'Ý tưởng trùng vụ tuần trước.' } }]);
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('fast review mode shortens the review steps to two, full mode brings back five', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  const steps = page.locator('#ai-review-steps li');
  await expect(steps).toHaveCount(5);
  await expect(page.locator('#ai-review-note')).toBeHidden();
  await page.locator('[data-field="reviewMode"] label', { hasText: 'Nhanh' }).click();
  await expect(steps).toHaveText(['1Duyệt sự thật vụ án', '2Chơi thử bản cuối rồi xuất bản']);
  await expect(page.locator('#ai-review-note')).toBeVisible();
  await page.locator('[data-field="reviewMode"] label', { hasText: 'Đầy đủ 4 cổng' }).click();
  await expect(steps).toHaveCount(5);
  expect(mock.errors).toEqual([]);
});

test('changing the world swaps the places and NPCs and drops the picks of the old world', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveCount(3);
  await page.locator('[data-location="h-map-ben-cang"]').click();
  await page.locator('[data-npc="h-npc-01-tho-dong-ho"]').click();
  await expect(page.locator('[data-aai-sum="locations"]')).toHaveText('Bến cảng');

  await page.locator('[data-world="TAISHO_JAPAN"]').click();
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveText(['Phố đèn lồng', 'Ga tàu điện', 'Nhà trà']);
  await expect(page.locator('#ai-npc-grid [data-npc]')).toHaveCount(8);
  await expect(page.locator('[data-location="h-map-ben-cang"]')).toHaveCount(0);
  await expect(page.locator('[data-aai-sum="locations"]')).toHaveText('Để bot chọn trong thư viện');
  await expect(page.locator('#ai-location-count')).toHaveText('đã chọn 0');
  await expect(page.locator('#ai-npc-count')).toHaveText('0 / 7');

  await page.locator('[data-world="SHANGHAI_1930"]').click();
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveText(['Bến sông']);
  await expect(page.locator('#ai-npc-grid')).toContainText('Thư viện chưa có nhân vật của thế giới này');

  await page.locator('[data-world="NEW_WORLD"]').click();
  await expect(page.locator('#ai-new-world-note')).toBeVisible();
  await expect(page.locator('#ai-new-world-note')).toContainText('bot sẽ báo số lượt cần vẽ trước khi làm');
  await expect(page.locator('#ai-location-grid')).toContainText('Thế giới mới chưa có địa điểm');
  await page.locator('[data-world="HANG_DUONG_VICTORIAN"]').click();
  await expect(page.locator('#ai-new-world-note')).toBeHidden();
  // The old picks are gone for good, not just hidden.
  await expect(page.locator('[data-location="h-map-ben-cang"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#quick-create-btn').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].order).toMatchObject({ world: 'HANG_DUONG_VICTORIAN', locationIds: [], npcIds: [] });
  expect(mock.errors).toEqual([]);
});

test('the idea stops at 2,000 characters with a counter, and character notes at 600', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  const idea = page.locator('#ai-creator-direction');
  await expect(page.locator('#ai-idea-count')).toHaveText('0 / 2.000 ký tự');
  await idea.fill('a'.repeat(2100));
  await expect(idea).toHaveValue('a'.repeat(2000));
  await expect(page.locator('#ai-idea-count')).toHaveText('2.000 / 2.000 ký tự');
  await expect(page.locator('#ai-idea-count')).toHaveClass(/is-full/);
  await page.locator('[data-idea-hint="weapon"]').click();
  await expect(page.locator('[data-field-error="prompt"]')).toContainText('Ý tưởng đã đủ 2.000 ký tự');
  await expect(idea).toHaveValue('a'.repeat(2000));
  await idea.fill('b'.repeat(1990));
  await expect(page.locator('#ai-idea-count')).toHaveClass(/is-near/);
  await expect(page.locator('[data-field-error="prompt"]')).toBeHidden();

  const notes = page.locator('#ai-character-notes');
  await notes.fill('c'.repeat(650));
  await expect(notes).toHaveValue('c'.repeat(600));
  await expect(page.locator('#ai-character-notes-count')).toHaveText('600 / 600 ký tự');
  await page.locator('#quick-create-btn').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].prompt).toHaveLength(1990);
  expect(mock.posts[0].order.characterNotes).toHaveLength(600);
  expect(mock.errors).toEqual([]);
});

test('NPC picks stop at suspects + 3, and fewer suspects than picks locks the order with a reason', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  await page.locator('[data-world="TAISHO_JAPAN"]').click();
  await page.locator('[data-field="suspectCount"] label', { hasText: '3' }).click();
  for (let index = 1; index <= 6; index += 1) await page.locator(`[data-npc="j-npc-0${index}"]`).click();
  await expect(page.locator('#ai-npc-count')).toHaveText('6 / 6');
  await page.locator('[data-npc="j-npc-07"]').click();
  await expect(page.locator('[data-npc="j-npc-07"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-field-error="npcIds"]')).toHaveText('3 nghi phạm chỉ chọn được tối đa 6 NPC. Bỏ bớt một NPC hoặc tăng số nghi phạm.');

  await page.locator('[data-field="suspectCount"] label', { hasText: '4' }).click();
  await expect(page.locator('[data-field-error="npcIds"]')).toBeHidden();
  await page.locator('[data-npc="j-npc-07"]').click();
  await expect(page.locator('#ai-npc-count')).toHaveText('7 / 7');
  await expect(page.locator('#quick-create-btn')).toBeEnabled();

  await page.locator('[data-field="suspectCount"] label', { hasText: '3' }).click();
  await expect(page.locator('#ai-npc-count')).toHaveText('7 / 6');
  await expect(page.locator('#quick-create-btn')).toBeDisabled();
  await expect(page.locator('#ai-submit-reason')).toContainText('Đang chọn 7 NPC');
  await expect(page.locator('[data-field-error="npcIds"]')).toBeVisible();
  await page.locator('[data-npc="j-npc-07"]').click();
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await expect(page.locator('#ai-submit-reason')).toBeHidden();
  expect(mock.posts).toHaveLength(0);
  expect(mock.errors).toEqual([]);
});

test('a refusal of the server shows next to the field it names and keeps every choice', async ({ page }) => {
  let answer = 0;
  const mock = await setUp(page, 'ADMIN', 'vi', {
    createResponse: () => (++answer === 1
      ? { status: 400, json: { success: false, message: 'npcIds accepts at most 7 entries for 4 suspects.', errors: { code: 'AI_ORDER_INVALID', messageKey: 'ai.order.invalid', field: 'order.npcIds' } } }
      : { status: 400, json: { success: false, message: 'The field Prompt must be a string with a maximum length of 2000.', errors: { Prompt: ['The field Prompt must be a string with a maximum length of 2000.'] } } }),
  });
  // A second, unrelated console error (the 400 of the browser) is expected here.
  await open(page);
  await page.locator('[data-npc="h-npc-01-tho-dong-ho"]').click();
  await page.locator('[data-field="weather"] label', { hasText: 'Tuyết' }).click();
  await page.locator('#quick-create-btn').click();
  await expect(page.locator('[data-field-error="npcIds"]')).toContainText('Quá nhiều NPC so với số nghi phạm');
  await expect(page.locator('[data-field-error="npcIds"]')).toContainText('npcIds accepts at most 7 entries');
  await expect(page.locator('[data-field="npcIds"]')).toHaveClass(/has-error/);
  await expect(page.locator('#ai-request-error')).toContainText('AI_ORDER_INVALID');
  await expect(page.locator('[data-npc="h-npc-01-tho-dong-ho"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('input[name="aai-weather"][value="SNOW"]')).toBeChecked();

  await page.locator('#quick-create-btn').click();
  await expect(page.locator('[data-field-error="prompt"]')).toContainText('Ý tưởng tối đa 2.000 ký tự');
  await expect(page.locator('[data-field-error="npcIds"]')).toBeHidden();
  expect(mock.errors.filter((line) => !/status of 400/.test(line))).toEqual([]);
});

test('the language switch translates every new label, and English orders read the same', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN', 'en');
  await open(page);
  await expect(page.locator('.aai-form .adm-card-title')).toHaveText([
    'World and locations', 'Generation preset', 'Language and case type', 'Characters', 'Atmosphere', 'Gameplay extension', 'Idea',
  ]);
  await expect(page.locator('#quick-create-btn')).toHaveText('Send order to Claude');
  await expect(page.locator('.aai-summary')).toContainText('Max PixelLab generations');
  await expect(page.locator('.aai-summary')).toContainText('Review mode');
  await expect(page.locator('[data-field="weather"]')).toContainText('Let the bot choose');
  await expect(page.locator('#ai-idea-count')).toHaveText('0 / 2,000 characters');
  await expect(page.locator('.aai-settings')).toContainText('Orders per VIP each week');
  await expect(page.locator('[data-location="h-map-ben-cang"]')).toHaveAttribute('aria-label', 'Harbour (Outdoor)');

  await page.locator('[data-ui-language="vi"]').click();
  await expect(page.locator('.aai-form .adm-card-title').first()).toHaveText('Thế giới và địa điểm');
  await expect(page.locator('#quick-create-btn')).toHaveText('Gửi đơn cho Claude');
  await expect(page.locator('.aai-summary')).toContainText('Lượt PixelLab tối đa');
  await expect(page.locator('.aai-summary')).toContainText('Chế độ duyệt');
  await expect(page.locator('[data-field="weather"]')).toContainText('Để bot chọn');
  await expect(page.locator('[data-location="h-map-ben-cang"]')).toHaveAttribute('aria-label', 'Bến cảng (Ngoài trời)');
  await page.locator('[data-ui-language="en"]').click();
  await expect(page.locator('#quick-create-btn')).toHaveText('Send order to Claude');
  expect(mock.errors).toEqual([]);
});

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  for (const role of ['ADMIN', 'VIP'] as const) {
    test(`${role} form fits ${width} px: cards stack, the summary sits ${width < 900 ? 'below' : 'beside'} them, nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const mock = await setUp(page, role);
      await open(page);
      const form = await page.locator('.aai-form').boundingBox();
      const aside = await page.locator('.aai-aside').boundingBox();
      if (width < 900) expect(aside!.y).toBeGreaterThanOrEqual(form!.y + form!.height - 1);
      else expect(aside!.x).toBeGreaterThan(form!.x + form!.width - 1);
      // The lens transition of the router overflows for a moment on every page: measure after it is gone.
      await expect(page.locator('.bpa-rim')).toHaveCount(0, { timeout: 15_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const cards = page.locator('.aai-form > .adm-card');
      const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map((box) => ({ x: box.x, y: box.y, w: box.width, b: box.bottom })));
      for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].b - 1);
      for (const box of boxes) expect(box.x + box.w).toBeLessThanOrEqual(width);
      // Touch targets: world and place cards are at least 44 px tall.
      const worldHeight = (await page.locator('[data-world]').first().boundingBox())!.height;
      expect(worldHeight).toBeGreaterThanOrEqual(44);
      expect(mock.errors).toEqual([]);
    });
  }
}

test('the bot report renders as safe Markdown in the draft detail: tables and lists, never the report\'s own HTML', async ({ page }) => {
  const report = [
    '# Báo cáo vụ "Đồng hồ đêm mưa"',
    '',
    '5/5 lớp **đạt**. Xem [hướng dẫn](https://sirlocked.id.vn/docs) và `bridge_check`.',
    '',
    '| Lớp | Kết quả |',
    '| --- | --- |',
    '| Schema | đạt |',
    '| Thám tử mù | đạt |',
    '',
    '- [x] Chạy thử không lỗi console',
    '- [ ] Yen chơi thử',
    '',
    '<script>window.__reportXss = 1</script>',
    '<img src="x" onerror="window.__reportXss = 2">',
    '[bấm](javascript:window.__reportXss=3)',
    '',
    '```',
    '<b>không in đậm</b>',
    '```',
  ].join('\n');
  const mock = await setUp(page, 'ADMIN');
  mock.drafts = [draftOf('with-report', 'ADMIN', 'AWAITING_GATE', {
    status: 'STORY_AWAITING_APPROVAL', queueState: 'NONE', bridgeReport: report, bridgeReportUpdatedAt: '2026-11-16T09:00:00Z',
    storyPreview: { title: 'Đồng hồ đêm mưa', summary: 'Một vụ thử.' },
  })];
  await open(page);
  await page.locator('[data-draft-row="with-report"]').getByRole('button', { name: 'Xem' }).click();
  const panel = page.locator('[data-bridge-report]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Báo cáo của bot (report.md)');
  const body = panel.locator('.aai-report');
  await expect(body.locator('h3')).toHaveText('Báo cáo vụ "Đồng hồ đêm mưa"');
  await expect(body.locator('table tbody tr')).toHaveCount(2);
  await expect(body.locator('strong')).toHaveText('đạt');
  await expect(body.locator('a')).toHaveCount(1);
  await expect(body.locator('a')).toHaveAttribute('href', 'https://sirlocked.id.vn/docs');
  await expect(body.locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(body.locator('li')).toHaveCount(2);
  await expect(body.locator('script, img, b, [onerror]')).toHaveCount(0);
  await expect(body).toContainText('<script>window.__reportXss = 1</script>');
  await expect(body.locator('pre code')).toHaveText('<b>không in đậm</b>');
  expect(await page.evaluate(() => (window as any).__reportXss)).toBeUndefined();
  expect(mock.errors).toEqual([]);
});

test('ADMIN sets the VIP weekly limit through the settings API; a wrong value never leaves the page', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  const input = page.locator('#ai-vip-weekly-limit');
  await expect(input).toHaveValue('2');
  await page.locator('#ai-creator-direction').fill('Giữ nguyên ý tưởng này.');
  await input.fill('99');
  await page.locator('#ai-save-settings').click();
  await expect(page.locator('#ai-settings-status')).toHaveText('Giới hạn mỗi tuần phải là số nguyên từ 0 đến 50.');
  expect(mock.settingsPuts).toEqual([]);
  await input.fill('3');
  await input.press('Enter');
  await expect(page.locator('#ai-settings-status')).toHaveText('Đã lưu: mỗi VIP được gửi 3 đơn mỗi tuần.');
  expect(mock.settingsPuts).toEqual([{ vipWeeklyOrderLimit: 3 }]);
  await expect(page.locator('#ai-vip-weekly-limit')).toHaveValue('3');
  await expect(page.locator('#ai-creator-direction')).toHaveValue('Giữ nguyên ý tưởng này.');
  expect(mock.errors).toEqual([]);
});

test('a library that cannot be read leaves the order usable and offers a retry', async ({ page }) => {
  let reads = 0;
  const mock = await setUp(page, 'ADMIN');
  await page.route((url) => url.pathname === '/api/admin/ai-cases/library', (route) => (++reads === 1
    ? route.fulfill({ status: 503, json: { success: false, message: 'Library down.' } })
    : route.fulfill({ json: envelope(LIBRARY) })));
  await page.goto('/admin/ai');
  await expect(page.locator('#ai-location-grid')).toContainText('Không tải được thư viện hình');
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await page.locator('#ai-location-grid [data-reload-library]').click();
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveCount(3);
  await expect(page.locator('#ai-npc-grid [data-npc]')).toHaveCount(2);
  expect(mock.errors.filter((line) => !/status of 503/.test(line))).toEqual([]);
});

