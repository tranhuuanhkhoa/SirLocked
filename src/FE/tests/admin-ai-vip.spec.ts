import { expect, test, type Page } from '@playwright/test';

/**
 * VUAN-7 on /admin/ai: a VIP picks "Nhanh" or "Tiết kiệm", may buy 30 more PixelLab pictures, sees the price and their
 * coins, confirms the hold in the page, and is sent to "Nạp xu" when short; ADMIN edits prices, models, hints and
 * author rewards, reads the cost report and revokes a payout with a reason typed in the page. Every API call is
 * answered here: nothing reaches a server, Claude or PixelLab.
 */

const envelope = (data: unknown) => ({ success: true, data });
const capabilities = { aiCaseV3PresetEnabled: true, gameplayV3Enabled: true, canCreateDraft: true, canCreateV3Draft: true, creationBlockers: [], v3CreationBlockers: [] };

interface Mock {
  posts: any[];
  quotes: string[];
  puts: any[];
  revokes: { id: string; body: any }[];
  balance: number;
  laneConfigured: boolean;
  dialogs: string[];
  errors: string[];
}

const SETTINGS = {
  vipWeeklyOrderLimit: 2,
  vipLaneConfigured: true,
  adsEnabled: false,
  vipPricing: {
    presets: [
      { preset: 'SHORT_DEMO', fastXu: 5000, saverXu: 2500, fastCostVnd: 41000, saverCostVnd: 22000 },
      { preset: 'NORMAL_RANDOM', fastXu: 8000, saverXu: 4500, fastCostVnd: 68000, saverCostVnd: 36000 },
    ],
    extraPixelLabGenerationXu: 15, vipMaxPixelLabCap: 60, usdToVnd: 26500, vndPerXu: 10, costCapMultiplier: 2, maxBonusShare: 0,
  },
  vipModels: { light: 'claude-haiku-5-5', main: 'claude-sonnet-5-5', rescue: 'claude-opus-5-5', rescueFromAttempt: 3, stepOverrides: {}, prices: [] },
  hintPricing: { level2Xu: 20, level3Xu: 50, level2PenaltyPercent: 5, level3PenaltyPercent: 15, vipFreeLevel2: false, adRevenueVndPerView: 53 },
  authorRewards: { revenueSharePercent: 30, holdDays: 7, monthlyCapXu: 20000, silverCompletions: 100, silverMinRatingPercent: 85, silverBonusXu: 1500,
    goldCompletions: 500, goldMinRatingPercent: 90, goldBonusXu: 5000, minAccountAgeDays: 7, minOtherCasesPlayed: 1, minPlayTimeRatio: 0.5 },
};

const REPORT = {
  usdToVnd: 26500, vndPerXu: 10,
  orders: [{ draftId: 'draft-000001', preset: 'NORMAL_RANDOM', speed: 'FAST', billingState: 'CHARGED', priceXu: 8000, chargedXu: 8000, refundedXu: 0,
    spentUsd: 2.4, spentVnd: 63600, pixelLabVnd: 3900, earnedVnd: 80000, profitVnd: 12500,
    models: [{ model: 'claude-sonnet-5-5', calls: 14, inputTokens: 420000, outputTokens: 90000, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 2.3, costVnd: 61000, batchCalls: 0 }] }],
  averages: [{ preset: 'NORMAL_RANDOM', speed: 'FAST', orders: 1, avgPriceXu: 8000, avgCostVnd: 67500, avgEarnedVnd: 80000, avgProfitVnd: 12500 }],
  cases: [{ caseId: 'case-1', title: 'Ấm men lam', authorUserId: 'vip-1', hintXu: 140, paidHints: 4, adViews: 20, adVnd: 1060, authorShareXu: 45 }],
  authors: { paidXu: 45, heldXu: 300, revokedXu: 0, clippedXu: 0, payouts: 2 },
};

async function setUp(page: Page, role: 'ADMIN' | 'VIP', overrides: Partial<Mock> = {}): Promise<Mock> {
  const mock: Mock = { posts: [], quotes: [], puts: [], revokes: [], balance: 50000, laneConfigured: true, dialogs: [], errors: [], ...overrides };
  page.on('dialog', (dialog) => { mock.dialogs.push(dialog.type()); void dialog.dismiss(); });
  page.on('pageerror', (error) => mock.errors.push(`pageerror: ${error.message}`));
  await page.addInitScript(({ userRole }) => {
    localStorage.setItem('sirlocked.token', 'vip-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: userRole === 'VIP' ? 'vip-1' : 'admin-1', fullName: 'Thám tử', role: userRole, isEmailVerified: true }));
  }, { userRole: role });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ json: envelope(null) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: envelope([]) });
    const body = route.request().postDataJSON();
    mock.posts.push(body);
    return route.fulfill({ status: 202, json: envelope({ draftId: 'new-1', status: 'GENERATING_STORY', queueState: 'NONE', orderStatus: 'AWAITING_OWNER_APPROVAL',
      orderStatusHistory: [{ status: 'AWAITING_OWNER_APPROVAL', at: '2026-11-18T07:00:00Z' }], createdByRole: role, settings: { generationPreset: 'NORMAL_RANDOM', language: 'vi' },
      vipOrder: { speed: body.order.speed, priceXu: 8000, state: 'HELD', refundedXu: 0, estimatedReadyAt: '2026-11-18T08:30:00Z' } }) });
  });
  await page.route((url) => url.pathname === '/api/admin/ai-cases/capabilities', (route) => route.fulfill({ json: envelope(capabilities) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/library', (route) => route.fulfill({ json: envelope([]) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/quota', (route) => route.fulfill({
    json: envelope({ role, unlimited: role === 'ADMIN', weeklyLimit: 2, usedThisWeek: 0, remaining: 2, weekStart: '2026-11-16' }) }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/vip-quote', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const speed = query.get('speed') === 'SAVER' ? 'SAVER' : 'FAST';
    const cap = Number(query.get('pixelLabCap') || 30);
    mock.quotes.push(`${speed}:${cap}`);
    const price = (speed === 'SAVER' ? 4500 : 8000) + Math.max(0, cap - 30) * 15;
    return route.fulfill({ json: envelope({ preset: 'NORMAL_RANDOM', speed, pixelLabCap: cap, priceXu: price, basePriceXu: price - Math.max(0, cap - 30) * 15,
      extraPixelLabXu: Math.max(0, cap - 30) * 15, balance: mock.balance, bonusBalance: 0, maxFromBonus: 0, canAfford: mock.balance >= price,
      pixelLabEnabled: true, laneConfigured: mock.laneConfigured, estimatedMinutes: speed === 'SAVER' ? 1440 : 90 }) });
  });
  await page.route((url) => url.pathname === '/api/admin/ai-cases/settings', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      mock.puts.push(body);
      return route.fulfill({ json: envelope({ ...SETTINGS, ...body }) });
    }
    return route.fulfill({ json: envelope(SETTINGS) });
  });
  await page.route((url) => url.pathname === '/api/admin/ai-cases/vip-report', (route) => route.fulfill({ json: envelope(REPORT) }));
  await page.route((url) => url.pathname === '/api/admin/authors', (route) => route.fulfill({ json: envelope([
    { userId: 'vip-1', name: 'Khách VIP', stats: { tier: 'SILVER', publishedCases: 1, bestCompletions: 120, bestRatingPercent: 88 }, paidXu: 45, heldXu: 300, revokedXu: 0 },
  ]) }));
  await page.route((url) => url.pathname === '/api/admin/authors/payouts', (route) => route.fulfill({ json: envelope([
    { id: 'share:case-1:1', kind: 'SHARE', caseId: 'case-1', xu: 300, clippedXu: 0, state: 'HELD', availableAt: '2026-11-25T07:00:00Z' },
  ]) }));
  await page.route((url) => /\/api\/admin\/authors\/payouts\/.+\/revoke$/.test(url.pathname), (route) => {
    mock.revokes.push({ id: decodeURIComponent(new URL(route.request().url()).pathname.split('/').slice(-2)[0]), body: route.request().postDataJSON() });
    return route.fulfill({ json: envelope({ id: 'share:case-1:1', state: 'REVOKED' }) });
  });
  return mock;
}

test('a VIP picks a speed and 30 more PixelLab pictures, sees the price, and confirms the hold in the page', async ({ page }) => {
  const mock = await setUp(page, 'VIP');
  await page.goto('/admin/ai');
  const panel = page.locator('#ai-vip-order');
  await expect(panel.locator('.aai-vip-speed')).toHaveCount(2);
  await expect(panel.locator('.aai-vip-speed').nth(0)).toContainText('8.000 xu');
  await expect(panel.locator('.aai-vip-speed').nth(1)).toContainText('4.500 xu');
  await expect(panel.locator('[data-vip-price]')).toHaveText('8.000 xu');
  await expect(panel.locator('[data-vip-balance]')).toHaveText('50.000 xu');

  await panel.locator('input[value="SAVER"]').check();
  await expect(page.locator('#ai-vip-order [data-vip-price]')).toHaveText('4.500 xu');
  await page.locator('#ai-vip-extra').check();
  await expect(page.locator('#ai-vip-order [data-vip-price]')).toHaveText('4.950 xu');
  expect(mock.quotes).toContain('SAVER:60');

  await page.locator('#quick-create-btn').click();
  const confirm = page.locator('.aai-vip-confirm');
  await expect(confirm).toContainText('Giữ 4.950 xu. Trả lại toàn bộ nếu đơn bị từ chối hoặc lỗi.');
  await confirm.locator('[data-vip-cancel]').first().click();
  await expect(confirm).toHaveCount(0);
  expect(mock.posts).toEqual([]);

  await page.locator('#quick-create-btn').click();
  await page.locator('.aai-vip-confirm [data-vip-confirm]').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  expect(mock.posts[0].order).toMatchObject({ speed: 'SAVER', vipExtraPixelLab: 30 });
  expect(mock.posts[0].order.pixelLabCap).toBeUndefined();
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});

test('a VIP short of coins is sent to "Nạp xu" and cannot send the order', async ({ page }) => {
  const mock = await setUp(page, 'VIP', { balance: 3000 });
  await page.goto('/admin/ai');
  await expect(page.locator('#ai-vip-order')).toContainText('Còn thiếu 5.000 xu.');
  await expect(page.locator('#ai-vip-topup')).toHaveAttribute('href', '/payments');
  await expect(page.locator('#quick-create-btn')).toBeDisabled();
  await expect(page.locator('#ai-submit-reason')).toHaveText('Không đủ xu cho đơn này. Hãy nạp xu trước.');
  expect(mock.errors).toEqual([]);
});

test('without the Claude API key a VIP order is free: no price, no hold, the VIP chooses the cap and the order runs on autopilot', async ({ page }) => {
  const mock = await setUp(page, 'VIP', { laneConfigured: false });
  await page.goto('/admin/ai');
  await expect(page.locator('#ai-vip-quota')).toContainText('Đơn vào hàng chờ Claude ngay');
  await expect(page.locator('#ai-vip-order')).toHaveCount(0);
  await expect(page.locator('#ai-pixellab-cap')).toHaveValue('-1');
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await page.locator('#quick-create-btn').click();
  await expect.poll(() => mock.posts.length).toBe(1);
  await expect(page.locator('.aai-vip-confirm')).toHaveCount(0);
  expect(mock.posts[0].order).toMatchObject({ pixelLabCap: -1 });
  // Every new order runs on autopilot: the form sends no review mode (the server sets AUTO).
  expect(mock.posts[0].order.reviewMode).toBeUndefined();
  expect(mock.posts[0].order.speed).toBeUndefined();
  expect(mock.errors).toEqual([]);
});

test('the VIP settings and report live on their own admin page, never on the order page', async ({ page }) => {
  await setUp(page, 'ADMIN');
  await page.goto('/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeVisible();
  await expect(page.locator('.aai-vip-settings, .aai-vip-report, .aai-settings')).toHaveCount(0);
  await page.locator('[data-vip-settings-link]').click();
  await expect(page).toHaveURL(/\/admin\/vip$/);
  await expect(page.locator('.aai-vip-settings')).toBeVisible();
  await expect(page.locator('.aai-vip-report')).toBeVisible();
  await expect(page.locator('.aai-settings')).toBeVisible();
});

test('a VIP sees neither the VIP settings nor the way to them, and cannot open /admin/vip', async ({ page }) => {
  await setUp(page, 'VIP');
  await page.goto('/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeVisible();
  await expect(page.locator('[data-vip-settings-link], .aai-vip-settings, .aai-vip-report, .aai-settings')).toHaveCount(0);
  await page.goto('/admin/vip');
  await expect(page).not.toHaveURL(/\/admin\/vip$/);
  await expect(page.locator('.aai-vip-settings, .aai-vip-report')).toHaveCount(0);
});

test('ADMIN edits VIP prices and hint prices, reads the cost report, and revokes a payout with a reason typed in the page', async ({ page }) => {
  const mock = await setUp(page, 'ADMIN');
  await page.goto('/admin/vip');
  const card = page.locator('.aai-vip-settings');
  await expect(card).toContainText('Đã đặt khóa Claude API');
  await card.locator('input[name="fast-NORMAL_RANDOM"]').fill('8500');
  await card.locator('input[name="level2Xu"]').fill('25');
  await card.locator('input[name="vipFreeLevel2"]').check();
  await card.locator('#ai-save-vip-settings').click();
  await expect.poll(() => mock.puts.length).toBe(1);
  expect(mock.puts[0].vipPricing.presets.find((row: any) => row.preset === 'NORMAL_RANDOM').fastXu).toBe(8500);
  expect(mock.puts[0].hintPricing).toMatchObject({ level2Xu: 25, vipFreeLevel2: true });
  expect(mock.puts[0].authorRewards.revenueSharePercent).toBe(30);
  await expect(page.locator('#ai-vip-settings-status')).toHaveText('Đã lưu.');

  const report = page.locator('#ai-vip-report');
  await expect(report).toContainText('67.500'); // real cost: Claude + PixelLab
  await expect(report).toContainText('12.500'); // profit
  await expect(report).toContainText('Ấm men lam');
  await expect(report).toContainText('Tác giả được yêu thích');
  await report.locator('[data-payout-action="revoke"]').click();
  await page.locator('dialog textarea').fill('Gian lận lượt chơi');
  await page.locator('dialog button[type="submit"]').click();
  await expect.poll(() => mock.revokes.length).toBe(1);
  expect(mock.revokes[0]).toEqual({ id: 'share:case-1:1', body: { reason: 'Gian lận lượt chơi' } });
  expect(mock.dialogs).toEqual([]);
  expect(mock.errors).toEqual([]);
});
