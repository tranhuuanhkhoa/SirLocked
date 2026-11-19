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

/** The three levels exactly as the server's AiDifficultyProfiles sends them in the capabilities. */
const LEVELS = [
  { difficulty: 'easy', playMinutes: { min: 10, max: 15 }, estimatedMinutes: 12, scenes: { min: 2, max: 3 }, suspects: 3, cracks: 1, puzzles: { min: 1, max: 2 }, redHerrings: { min: 0, max: 1 }, requiredEvidence: 2, pixelLab: { newWorld: { min: 60, max: 120 }, libraryWorld: { min: 10, max: 40 } } },
  { difficulty: 'medium', playMinutes: { min: 20, max: 30 }, estimatedMinutes: 25, scenes: { min: 4, max: 5 }, suspects: 4, cracks: 2, puzzles: { min: 2, max: 3 }, redHerrings: { min: 1, max: 2 }, requiredEvidence: 3, pixelLab: { newWorld: { min: 150, max: 220 }, libraryWorld: { min: 30, max: 80 } } },
  { difficulty: 'hard', playMinutes: { min: 40, max: 60 }, estimatedMinutes: 50, scenes: { min: 6, max: 8 }, suspects: 5, cracks: 3, puzzles: { min: 4, max: 6 }, redHerrings: { min: 2, max: 3 }, requiredEvidence: 4, pixelLab: { newWorld: { min: 300, max: 450 }, libraryWorld: { min: 60, max: 150 } } },
];

const capabilities = {
  aiCaseV3PresetEnabled: true, gameplayV3Enabled: true, canCreateDraft: true, canCreateV3Draft: true,
  creationBlockers: [], v3CreationBlockers: [], difficultyProfiles: LEVELS,
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
  answers: { id: string; decisionId: string; body: any }[];
  answerStatus?: number;
  /** VUAN-7: the server has the Claude API key, so a VIP order is paid and waits for an admin. */
  vipLaneOpen: boolean;
  settingsPuts: any[];
  quota: { unlimited: boolean; weeklyLimit: number; usedThisWeek: number; remaining: number; weekStart: string };
  createResponse?: (body: any) => { status: number; json: unknown };
  capabilities?: Record<string, unknown>;
  dialogs: string[];
  errors: string[];
}

async function setUp(page: Page, role: Role, language: 'vi' | 'en' = 'vi', overrides: Partial<Mock> = {}): Promise<Mock> {
  const mock: Mock = {
    drafts: [], posts: [], postHeaders: [], approve: [], reject: [], answers: [], settingsPuts: [], vipLaneOpen: false,
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
  await page.route((url) => url.pathname === '/api/admin/ai-cases/capabilities', (route) => route.fulfill({ json: envelope(mock.capabilities ?? capabilities) }));
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
    const created = draftOf(`new-${mock.posts.length}`, role, role === 'VIP' && mock.vipLaneOpen ? 'AWAITING_OWNER_APPROVAL' : 'QUEUED_FOR_CLAUDE', {
      prompt: body.prompt, order: body.order, settings: { pipelineVersion: 'OPEN_COOP_1', difficulty: body.difficulty, language: body.language, caseType: body.caseType },
    });
    mock.drafts = [created, ...mock.drafts];
    if (role === 'VIP') mock.quota = { ...mock.quota, usedThisWeek: mock.quota.usedThisWeek + 1, remaining: Math.max(0, mock.quota.remaining - 1) };
    return route.fulfill({ status: 202, json: envelope(created) });
  });
  await page.route((url) => /^\/api\/admin\/ai-cases\/[^/]+$/.test(url.pathname)
    && !['capabilities', 'library', 'quota', 'settings', 'vip-quote', 'vip-report'].includes(url.pathname.split('/').pop()!), (route) => {
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
  await page.route((url) => /\/decisions\/[^/]+$/.test(url.pathname), (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts.at(-3)!;
    const decisionId = parts.at(-1)!;
    const body = route.request().postDataJSON();
    mock.answers.push({ id, decisionId, body });
    if (mock.answerStatus && mock.answerStatus !== 200) {
      return route.fulfill({ status: mock.answerStatus, json: { success: false, message: 'Câu hỏi này đã được trả lời rồi.', errors: { code: 'AI_DECISION_CLOSED' } } });
    }
    mock.drafts = mock.drafts.map((draft) => draft.draftId === id
      ? { ...draft, orderStatus: 'QUEUED_FOR_CLAUDE', decisions: draft.decisions.map((item: Draft) => item.id === decisionId ? { ...item, status: 'ANSWERED', chosenOptionId: body.optionId } : item) }
      : draft);
    return route.fulfill({ json: envelope(mock.drafts.find((draft) => draft.draftId === id)) });
  });
  // VUAN-7: what a paid VIP order costs (Normal Random: 8.000 xu "Nhanh", 4.500 xu "Tiết kiệm"); plenty of coins.
  // laneConfigured follows mock.vipLaneOpen: closed (the default, as on production today) means VIP orders are free.
  await page.route((url) => url.pathname === '/api/admin/ai-cases/vip-quote', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const speed = query.get('speed') === 'SAVER' ? 'SAVER' : 'FAST';
    const cap = Number(query.get('pixelLabCap') || 30);
    const base = speed === 'SAVER' ? 4500 : 8000;
    const extra = Math.max(0, cap - 30) * 15;
    return route.fulfill({ json: envelope({ preset: 'NORMAL_RANDOM', speed, pixelLabCap: cap, priceXu: base + extra, basePriceXu: base,
      extraPixelLabXu: extra, balance: 50000, bonusBalance: 0, maxFromBonus: 0, canAfford: true, pixelLabEnabled: true, laneConfigured: mock.vipLaneOpen, estimatedMinutes: 90 }) });
  });
  return mock;
}

/** Waits for the form and the world pictures (the library pickers sit folded under "Tùy chọn thêm"). */
async function open(page: Page) {
  await page.goto('/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeVisible();
  await expect(page.locator('[data-world="HANG_DUONG_VICTORIAN"] img')).toHaveJSProperty('complete', true);
}

/** Opens "Tùy chọn thêm" (library places and NPCs, notes, language, content, PixelLab, review). */
async function openMore(page: Page) {
  const more = page.locator('#ai-more');
  if (!(await more.evaluate((node) => (node as HTMLDetailsElement).open))) await more.locator('summary').click();
  await expect(page.locator('#ai-location-grid')).toBeVisible();
}

const pressed = (page: Page, selector: string) => page.locator(selector);
const bar = (page: Page) => page.locator('.aai-order-bar');

test('an ADMIN order picks a level and a setting with the keyboard and mouse, sends only the new order shape and shows "Chờ Claude"', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);

  // Defaults: Medium, the first world, the bot picks weather and time, balanced, no fixed PixelLab cap; the bot runs to the end.
  await expect(page.locator('.aai-order-title')).toHaveText('Đặt vụ án mới');
  await expect(page.getByRole('radio', { name: /Trung bình/ })).toBeChecked();
  await expect(pressed(page, '[data-world="HANG_DUONG_VICTORIAN"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('input[name="aai-weather"][value="AUTO"]')).toBeChecked();
  await expect(page.locator('input[name="aai-time"][value="AUTO"]')).toBeChecked();
  await expect(page.locator('input[name="aai-leaning"][value="BALANCED"]')).toBeChecked();
  await expect(page.locator('#quick-create-btn')).toHaveText('Tạo vụ án');
  await expect(page.locator('#ai-more')).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-world="HANG_DUONG_VICTORIAN"] img')).toHaveAttribute('src', pic('h-map-ben-cang'));

  // Level and world by keyboard: Tab moves between the world cards, Enter picks.
  await page.locator('[data-level="hard"]').click();
  await page.mouse.move(0, 0);
  await page.locator('[data-world="HANG_DUONG_VICTORIAN"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-world="TAISHO_JAPAN"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-world="TAISHO_JAPAN"]')).toHaveAttribute('aria-pressed', 'true');

  // The rows: case type, atmosphere, what it leans towards, the idea with a hint chip.
  await page.locator('label.aai-chip', { hasText: 'Án mạng' }).click();
  await page.locator('[data-field="weather"] label', { hasText: 'Mưa' }).click();
  await page.locator('[data-field="timeOfDay"] label', { hasText: 'Đêm' }).click();
  await page.locator('label.aai-chip', { hasText: 'Giải đố nhiều hơn' }).click();
  await page.locator('#ai-creator-direction').fill('Một geisha mất tích đêm lễ hội.');
  await page.locator('[data-idea-hint="victim"]').click();
  await page.keyboard.type('cô Hana');
  await expect(page.locator('#ai-creator-direction')).toHaveValue('Một geisha mất tích đêm lễ hội.\nNạn nhân: cô Hana');

  // "Tùy chọn thêm": places and NPCs of this world, notes, language, content, PixelLab cap, review.
  await openMore(page);
  await page.locator('[data-location="j-map-pho-den-long"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-location="j-map-pho-den-long"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-location-kind="INTERIOR"]').click();
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveCount(1);
  await page.locator('[data-location="j-room-nha-tra"]').click();
  await page.locator('[data-location-kind=""]').click();
  await expect(page.locator('#ai-location-count')).toHaveText('đã chọn 2');
  await expect(page.locator('#ai-npc-grid [data-npc]')).toHaveCount(8);
  await page.locator('[data-npc="j-npc-01"]').click();
  await page.locator('[data-npc="j-npc-02"]').click();
  await expect(page.locator('#ai-npc-count')).toHaveText('2 / 8');
  await page.locator('#ai-character-notes').fill('Một ông chủ nhà trà biết mọi chuyện.');
  await page.locator('[data-field="contentLevel"] label', { hasText: 'Thường' }).click();
  await expect(page.locator('#ai-content-help')).toContainText('Trinh thám cổ điển');
  await page.locator('label', { hasText: 'Tiếng Việt' }).click();
  await page.locator('#ai-pixellab-cap').selectOption('60');

  await expect(bar(page).locator('[data-aai-sum="headline"]')).toHaveText('Khó · Nhật Bản Taishō · Án mạng');
  await expect(bar(page).locator('[data-aai-sum="facts"]')).toHaveText('~40–60 phút chơi · tối đa 60 lượt PixelLab · tự chạy đến hết');

  await page.locator('#quick-create-btn').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0]).toEqual({
    prompt: 'Một geisha mất tích đêm lễ hội.\nNạn nhân: cô Hana',
    difficulty: 'hard',
    leaning: 'PUZZLE',
    language: 'vi',
    caseType: 'MURDER',
    order: {
      world: 'TAISHO_JAPAN',
      locationIds: ['j-map-pho-den-long', 'j-room-nha-tra'],
      npcIds: ['j-npc-01', 'j-npc-02'],
      characterNotes: 'Một ông chủ nhà trà biết mọi chuyện.',
      weather: 'RAIN',
      timeOfDay: 'NIGHT',
      contentLevel: 'STANDARD',
      pixelLabCap: 60,
    },
  });
  expect(mock.postHeaders[0]['idempotency-key']).toBeTruthy();
  const row = page.locator('.aai-drafts-table tbody tr', { has: page.locator('[data-order-status]') }).first();
  await expect(row.locator('[data-order-status="QUEUED_FOR_CLAUDE"]')).toHaveText('Chờ Claude');
  await expect(row.locator('[data-order-time]')).not.toBeEmpty();
  await expect(page.locator('.aai-drafts-table thead')).toContainText('Người đặt');
  await expect(page.locator('.aai-drafts-table thead')).toContainText('Trạng thái đơn');
  // The choices survive the redraw after sending.
  await expect(page.locator('[data-world="TAISHO_JAPAN"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radio', { name: /Khó/ })).toBeChecked();
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('three level cards show the server numbers and drive the bar under the form', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN', 'vi', {
    // The server is the source: a changed number on the server shows on the card, not a number built into the page.
    capabilities: { ...capabilities, difficultyProfiles: LEVELS.map((level) => level.difficulty === 'hard' ? { ...level, playMinutes: { min: 45, max: 70 } } : level) },
  });
  await open(page);
  await expect(page.locator('[data-level="easy"]')).toContainText('10–15 phút');
  await expect(page.locator('[data-level="easy"]')).toContainText('2–3 cảnh · 3 nghi phạm · 1 đối chất · 1–2 câu đố');
  await expect(page.locator('[data-level="hard"]')).toContainText('45–70 phút');
  await expect(page.locator('[data-level="hard"]')).toContainText('6–8 cảnh · 5 nghi phạm · 3 đối chất · 4–6 câu đố');
  await expect(bar(page).locator('[data-aai-sum="facts"]')).toHaveText('~20–30 phút chơi · ước 30–80 lượt PixelLab · tự chạy đến hết');

  await page.locator('[data-level="hard"]').click();
  await page.locator('[data-world="NEW_WORLD"]').click();
  await expect(bar(page).locator('[data-aai-sum="headline"]')).toHaveText('Khó · Thế giới mới · Ngẫu nhiên');
  await expect(bar(page).locator('[data-aai-sum="facts"]')).toHaveText('~45–70 phút chơi · ước 300–450 lượt PixelLab · tự chạy đến hết');
  expect(mock.errors).toEqual([]);
});

test('changing the level changes no other choice', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  await page.locator('label.aai-chip', { hasText: 'Bắt cóc' }).click();
  await page.locator('label.aai-chip', { hasText: 'Giải đố nhiều hơn' }).click();
  await page.locator('[data-field="weather"] label', { hasText: 'Tuyết' }).click();
  for (const level of ['easy', 'hard', 'medium']) {
    await page.locator(`[data-level="${level}"]`).click();
    await expect(page.locator('input[name="aai-case-type"][value="KIDNAPPING"]')).toBeChecked();
    await expect(page.locator('input[name="aai-leaning"][value="PUZZLE"]')).toBeChecked();
    await expect(page.locator('input[name="aai-weather"][value="SNOW"]')).toBeChecked();
  }
  expect(mock.errors).toEqual([]);
});

test('the old controls are gone: no V3 switch, presets, stages, suspects, play time or review mode', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  await openMore(page);
  await expect(page.getByText(/V3 · Crack|Phá Vỡ Lời Dối|Số chặng|Số nghi phạm|Thời lượng chơi|Cấu hình tạo|Mở rộng gameplay/)).toHaveCount(0);
  await expect(page.locator('#ai-include-crack, #ai-preset-select, input[name="aai-stages"], input[name="aai-suspects"], input[name="aai-minutes"], input[name="aai-review"]')).toHaveCount(0);
  await expect(page.getByText(/Cách duyệt|Duyệt từng cổng|Duyệt nhanh/)).toHaveCount(0);
  await expect(page.locator('.aai-order .adm-card')).toHaveCount(0); // no card inside the form card
  expect(mock.errors).toEqual([]);
});

test('a VIP chooses the PixelLab cap like an admin, the order goes straight to Claude, and the last weekly order locks the button with a reason', async ({ page }) => {
  const mock = await setUp(page, 'VIP', 'vi', { quota: { unlimited: false, weeklyLimit: 2, usedThisWeek: 1, remaining: 1, weekStart: '2026-11-16' } });
  await open(page);
  await openMore(page);
  await expect(page.locator('#ai-pixellab-cap')).toHaveValue('-1');
  await expect(page.locator('#ai-pixellab-cap option:checked')).toHaveText('Không giới hạn');
  await expect(page.locator('.aai-settings')).toHaveCount(0);
  await expect(page.locator('#ai-vip-quota')).toContainText('Đơn vào hàng chờ Claude ngay');
  await expect(page.locator('#ai-vip-quota [data-quota-remaining]')).toHaveText('Còn 1/2 đơn trong tuần này.');

  // The Claude API lane is closed: the order is free, so there is no price, speed or hold.
  await expect(page.locator('#ai-vip-order')).toHaveCount(0);

  await page.locator('[data-location="h-map-ben-cang"]').click();
  await page.locator('#quick-create-btn').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  await expect(page.locator('.aai-vip-confirm')).toHaveCount(0);
  expect(mock.posts[0]).toEqual({
    prompt: '', difficulty: 'medium', leaning: 'BALANCED', language: 'en', caseType: 'RANDOM',
    order: {
      world: 'HANG_DUONG_VICTORIAN', locationIds: ['h-map-ben-cang'], npcIds: [], characterNotes: '',
      weather: 'AUTO', timeOfDay: 'AUTO', contentLevel: 'LIGHT', pixelLabCap: -1,
    },
  });
  await expect(page.locator('.aai-drafts-table [data-order-status="QUEUED_FOR_CLAUDE"]')).toHaveText('Chờ Claude');
  await expect(page.locator('.aai-drafts-table [data-approve-order]')).toHaveCount(0);

  await expect(page.locator('#ai-vip-quota [data-quota-remaining]')).toHaveText('Còn 0/2 đơn trong tuần này.');
  await expect(page.locator('#quick-create-btn')).toBeDisabled();
  await expect(page.locator('#ai-submit-reason')).toHaveText('Bạn đã dùng hết 2 đơn của tuần này. Tuần mới bắt đầu từ thứ Hai (giờ Việt Nam).');
  await expect(page.locator('#quick-create-btn')).toHaveAttribute('aria-describedby', 'ai-submit-reason');
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('with the Claude API lane open a VIP never sees the PixelLab cap, confirms the hold in the page, and the order waits for an admin', async ({ page }) => {
  const mock = await setUp(page, 'VIP', 'vi', { vipLaneOpen: true, quota: { unlimited: false, weeklyLimit: 2, usedThisWeek: 1, remaining: 1, weekStart: '2026-11-16' } });
  await open(page);
  await openMore(page);
  await expect(page.locator('#ai-pixellab-cap')).toHaveCount(0);
  await expect(page.locator('#ai-vip-quota')).toContainText('Đơn sẽ chờ admin duyệt');
  await expect(page.locator('#ai-vip-order [data-vip-price]')).toHaveText('8.000 xu');
  // The bar says what the server will do with a paid order: 30 generations and every gate reviewed.
  await expect(page.locator('[data-aai-sum="facts"]')).toContainText('tối đa 30 lượt PixelLab · duyệt từng cổng');

  await page.locator('[data-location="h-map-ben-cang"]').click();
  await page.locator('#quick-create-btn').click();
  // VUAN-7: the price is held when the order is sent; the page asks first (never a browser dialog).
  await expect(page.locator('.aai-vip-confirm')).toContainText('Giữ 8.000 xu. Trả lại toàn bộ nếu đơn bị từ chối hoặc lỗi.');
  await page.locator('.aai-vip-confirm [data-vip-confirm]').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].order).toEqual({
    world: 'HANG_DUONG_VICTORIAN', locationIds: ['h-map-ben-cang'], npcIds: [], characterNotes: '',
    weather: 'AUTO', timeOfDay: 'AUTO', contentLevel: 'LIGHT', speed: 'FAST', vipExtraPixelLab: 0,
  });
  await expect(page.locator('.aai-drafts-table [data-order-status="AWAITING_OWNER_APPROVAL"]')).toHaveText('Chờ admin duyệt');
  await expect(page.locator('.aai-drafts-table [data-approve-order]')).toHaveCount(0);
  // No polling for an order only an admin can move.
  await expect(page.locator('#generation-progress')).toBeHidden();
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('ADMIN approves one VIP order and rejects another with a reason typed in the page, never a browser dialog', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  mock.drafts = [draftOf('vip-a', 'VIP', 'AWAITING_OWNER_APPROVAL'), draftOf('vip-b', 'VIP', 'AWAITING_OWNER_APPROVAL', { prompt: 'Vụ thứ hai' })];
  await open(page);
  const rowA = page.locator('[data-draft-row="vip-a"]');
  const rowB = page.locator('[data-draft-row="vip-b"]');
  await expect(rowA.locator('[data-order-status]')).toHaveText('Chờ admin duyệt');

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
  await expect(rowB.locator('[data-order-status]')).toHaveText('Chờ admin duyệt');

  await rowB.getByRole('button', { name: 'Từ chối' }).click();
  await page.locator('dialog.aai-reject-dialog[open]').getByLabel('Lý do').fill('Ý tưởng trùng vụ tuần trước.');
  await page.locator('dialog.aai-reject-dialog[open]').getByRole('button', { name: 'Từ chối đơn' }).click();
  await expect(page.locator('dialog.aai-reject-dialog')).toHaveCount(0);
  await expect(rowB.locator('[data-order-status]')).toHaveText('Đã từ chối');
  expect(mock.reject).toEqual([{ id: 'vip-b', body: { reason: 'Ý tưởng trùng vụ tuần trước.' } }]);
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('works at 375 px with the keyboard only', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const mock = await setUp(page, 'VIP');
  await open(page);
  await expect(page.locator('.bpa-rim')).toHaveCount(0, { timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByRole('radio', { name: /Dễ/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Trung bình/ })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Khó/ })).toBeChecked();
  await page.locator('#ai-more > summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ai-pixellab-cap')).toBeVisible();
  // The three level cards stack, and the bar stays inside the screen.
  const boxes = await page.locator('.aai-level').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].bottom - 1);
  const barBox = (await bar(page).boundingBox())!;
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(375);
  await page.locator('#quick-create-btn').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].difficulty).toBe('hard');
  expect(mock.errors).toEqual([]);
});

test('changing the world swaps the places and NPCs and drops the picks of the old world', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  await openMore(page);
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveCount(3);
  await page.locator('[data-location="h-map-ben-cang"]').click();
  await page.locator('[data-npc="h-npc-01-tho-dong-ho"]').click();

  await page.locator('[data-world="TAISHO_JAPAN"]').click();
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveText(['Phố đèn lồng', 'Ga tàu điện', 'Nhà trà']);
  await expect(page.locator('#ai-npc-grid [data-npc]')).toHaveCount(8);
  await expect(page.locator('[data-location="h-map-ben-cang"]')).toHaveCount(0);
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

  await openMore(page);
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

test('NPC picks stop at the level\'s suspects + 3, and a smaller level than the picks locks the order with a reason', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await open(page);
  await page.locator('[data-world="TAISHO_JAPAN"]').click();
  await page.locator('[data-level="easy"]').click();
  await openMore(page);
  for (let index = 1; index <= 6; index += 1) await page.locator(`[data-npc="j-npc-0${index}"]`).click();
  await expect(page.locator('#ai-npc-count')).toHaveText('6 / 6');
  await page.locator('[data-npc="j-npc-07"]').click();
  await expect(page.locator('[data-npc="j-npc-07"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-field-error="npcIds"]')).toHaveText('Mức Dễ chỉ chọn được tối đa 6 NPC. Bỏ bớt một NPC hoặc chọn mức lớn hơn.');

  await page.locator('[data-level="medium"]').click();
  await expect(page.locator('[data-field-error="npcIds"]')).toBeHidden();
  await page.locator('[data-npc="j-npc-07"]').click();
  await expect(page.locator('#ai-npc-count')).toHaveText('7 / 7');
  await expect(page.locator('#quick-create-btn')).toBeEnabled();

  await page.locator('[data-level="easy"]').click();
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
  await openMore(page);
  await page.locator('[data-npc="h-npc-01-tho-dong-ho"]').click();
  await page.locator('[data-field="weather"] label', { hasText: 'Tuyết' }).click();
  await page.locator('#quick-create-btn').click();
  await expect(page.locator('[data-field-error="npcIds"]')).toContainText('Quá nhiều NPC so với mức độ này');
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
  await expect(page.locator('.aai-order-title')).toHaveText('Order a new case');
  await expect(page.locator('[data-level="hard"]')).toContainText('40–60 min');
  await expect(page.locator('#quick-create-btn')).toHaveText('Create case');
  await expect(page.locator('#ai-more summary')).toContainText('More options');
  await expect(page.locator('[data-field="weather"]')).toContainText('Let the bot choose');
  await expect(page.locator('#ai-idea-count')).toHaveText('0 / 2,000 characters');
  // The VIP settings are on /admin/vip; an admin reaches them from here.
  await expect(page.locator('[data-vip-settings-link]')).toHaveText('VIP settings');
  await openMore(page);
  await expect(page.locator('[data-location="h-map-ben-cang"]')).toHaveAttribute('aria-label', 'Harbour (Outdoor)');

  await page.locator('[data-ui-language="vi"]').click();
  await expect(page.locator('.aai-order-title')).toHaveText('Đặt vụ án mới');
  await expect(page.locator('#quick-create-btn')).toHaveText('Tạo vụ án');
  await expect(page.locator('#ai-more summary')).toContainText('Tùy chọn thêm');
  await expect(page.locator('[data-field="weather"]')).toContainText('Để bot chọn');
  await expect(page.locator('[data-location="h-map-ben-cang"]')).toHaveAttribute('aria-label', 'Bến cảng (Ngoài trời)');
  await page.locator('[data-ui-language="en"]').click();
  await expect(page.locator('#quick-create-btn')).toHaveText('Create case');
  expect(mock.errors).toEqual([]);
});

for (const [width, height] of [[1440, 900], [390, 844]] as const) {
  for (const role of ['ADMIN', 'VIP'] as const) {
    test(`${role} form fits ${width} px: the level cards ${width < 640 ? 'stack' : 'sit in a row'}, nothing scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const mock = await setUp(page, role);
      await open(page);
      // The lens transition of the router overflows for a moment on every page: measure after it is gone.
      await expect(page.locator('.bpa-rim')).toHaveCount(0, { timeout: 15_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const boxes = await page.locator('.aai-level').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
      if (width < 640) for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].bottom - 1);
      else for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].right - 1);
      for (const box of boxes) expect(box.x + box.width).toBeLessThanOrEqual(width);
      // Touch targets: world cards are at least 44 px tall.
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

test('ADMIN sets the VIP weekly limit on /admin/vip through the settings API; a wrong value never leaves the page', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await page.goto('/admin/vip');
  const input = page.locator('#ai-vip-weekly-limit');
  await expect(input).toHaveValue('2');
  await input.fill('99');
  await page.locator('#ai-save-settings').click();
  await expect(page.locator('#ai-settings-status')).toHaveText('Giới hạn mỗi tuần phải là số nguyên từ 0 đến 50.');
  expect(mock.settingsPuts).toEqual([]);
  await input.fill('3');
  await input.press('Enter');
  await expect(page.locator('#ai-settings-status')).toHaveText('Đã lưu: mỗi VIP được gửi 3 đơn mỗi tuần.');
  expect(mock.settingsPuts).toEqual([{ vipWeeklyOrderLimit: 3 }]);
  await expect(page.locator('#ai-vip-weekly-limit')).toHaveValue('3');
  expect(mock.errors).toEqual([]);
});

test('a library that cannot be read leaves the order usable and offers a retry', async ({ page }) => {
  let reads = 0;
  const mock = await setUp(page, 'ADMIN');
  await page.route((url) => url.pathname === '/api/admin/ai-cases/library', (route) => (++reads === 1
    ? route.fulfill({ status: 503, json: { success: false, message: 'Library down.' } })
    : route.fulfill({ json: envelope(LIBRARY) })));
  await page.goto('/admin/ai');
  await page.locator('#ai-more > summary').click();
  await expect(page.locator('#ai-location-grid')).toContainText('Không tải được thư viện hình');
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await page.locator('#ai-location-grid [data-reload-library]').click();
  await expect(page.locator('#ai-location-grid [data-location]')).toHaveCount(3);
  await expect(page.locator('#ai-npc-grid [data-npc]')).toHaveCount(2);
  expect(mock.errors.filter((line) => !/status of 503/.test(line))).toEqual([]);
});

const QUESTION = {
  id: 'q1', key: 'asset-budget', status: 'OPEN', question: 'Màn này cần 180 lượt. Làm sao?',
  options: [
    { id: 'draw', label: 'Vẽ mới', detail: 'Đúng ý đơn', generations: 180 },
    { id: 'library', label: 'Dùng thư viện', detail: 'Tiết kiệm', generations: 25 },
  ],
};

test('a draft waiting for a choice shows the question; one click answers it and locks the buttons', async ({ page }) => {
  const mock = await setUp(page, 'VIP');
  mock.drafts = [draftOf('asking', 'VIP', 'AWAITING_DECISION', { decisions: [QUESTION] })];
  await open(page);
  await expect(page.locator('[data-draft-row="asking"] [data-order-status]')).toHaveText('Chờ bạn chọn');
  await page.locator('[data-draft-row="asking"]').getByRole('button', { name: 'Xem' }).click();
  const card = page.locator('[data-decision-card="q1"]');
  await expect(card).toContainText('Bot cần bạn chọn');
  await expect(card).toContainText('Màn này cần 180 lượt. Làm sao?');
  await expect(card.locator('[data-decision-option="draw"]')).toContainText('180 lượt');
  await card.locator('[data-decision-option="library"]').click();
  await expect(card).toContainText('Đã chọn: Dùng thư viện');
  await expect(card).toContainText('bot đang làm tiếp');
  expect(mock.answers).toEqual([{ id: 'asking', decisionId: 'q1', body: { optionId: 'library' } }]);
  await expect(card.locator('[data-decision-option]')).toHaveCount(0);
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('a refused answer keeps the buttons usable and shows the error in the card', async ({ page }) => {
  const mock = await setUp(page, 'VIP', 'vi', { answerStatus: 409 });
  mock.drafts = [draftOf('asking', 'VIP', 'AWAITING_DECISION', { decisions: [QUESTION] })];
  await open(page);
  await page.locator('[data-draft-row="asking"]').getByRole('button', { name: 'Xem' }).click();
  const card = page.locator('[data-decision-card="q1"]');
  await card.locator('[data-decision-option="draw"]').click();
  await expect(card.locator('[data-decision-error]')).toHaveText('Câu hỏi này đã được trả lời rồi.');
  await expect(card.locator('[data-decision-option="draw"]')).toBeEnabled();
  await expect(card.locator('[data-decision-option="library"]')).toBeEnabled();
  expect(mock.answers).toHaveLength(1);
  expect(mock.dialogs).toEqual([]);
});
