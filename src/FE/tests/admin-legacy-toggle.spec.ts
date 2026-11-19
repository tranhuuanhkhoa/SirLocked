import { expect, test, type Page } from '@playwright/test';

/**
 * Older (non-pixel) cases are hidden by the API while CaseCatalog:PixelOnly is on. The admin pages must
 * (a) ask for the default list first, (b) offer a switch that asks for ?includeLegacy=true, and
 * (c) stop offering the buttons that recreate the older demo cases while they are hidden.
 */
const summary = (overrides: Record<string, unknown>) => ({
  status: 'PUBLISHED',
  language: 'vi',
  mechanicsVersion: 3,
  estimatedMinutes: 20,
  stageCount: 2,
  sceneCount: 3,
  clueCount: 8,
  isPixel: false,
  playerVisible: true,
  ...overrides,
});

const pixelCase = summary({ caseId: 'case-pixel-tram-hong-ngoc-vi', title: 'Trâm hồng ngọc mất tích', isPixel: true });
const oldCase = summary({ caseId: 'case-v3-broken-seal-vi', title: 'Con dấu vỡ', playerVisible: false });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sirlocked.token', 'admin-legacy-token');
    window.localStorage.setItem('sirlocked.uiLanguage', 'vi');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'admin-1', fullName: 'Admin', role: 'ADMIN', isEmailVerified: true,
    }));
  });
});

test('the case list hides older cases until the switch is on, then asks for includeLegacy', async ({ page }) => {
  const requested: string[] = [];
  await routeCapabilities(page);
  await page.route((url) => url.pathname === '/api/admin/cases', async (route) => {
    const includeLegacy = new URL(route.request().url()).searchParams.get('includeLegacy') === 'true';
    requested.push(includeLegacy ? 'legacy' : 'default');
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope(includeLegacy ? [pixelCase, oldCase] : [pixelCase]) });
  });

  await page.goto('/admin/cases');
  await expect(page.getByText('Trâm hồng ngọc mất tích')).toBeVisible();
  await expect(page.getByText('Con dấu vỡ')).toHaveCount(0);
  const toggle = page.locator('#show-legacy');
  await expect(toggle).not.toBeChecked();
  expect(requested).toEqual(['default']);

  await toggle.check();
  await expect(page.getByText('Con dấu vỡ')).toBeVisible();
  await expect(page.getByText('CŨ · ẩn với người chơi')).toBeVisible();
  await expect(page.locator('#show-legacy')).toBeChecked();
  expect(requested).toEqual(['default', 'legacy']);

  await page.locator('#show-legacy').uncheck();
  await expect(page.getByText('Con dấu vỡ')).toHaveCount(0);
  expect(requested).toEqual(['default', 'legacy', 'default']);
});

test('the dashboard stops offering to recreate older cases while they are hidden', async ({ page }) => {
  await routeDashboard(page, true);
  await page.goto('/admin');
  await expect(page.locator('#seed-pixel-demo')).toBeVisible();
  await expect(page.locator('#seed-sample')).toHaveCount(0);
  await expect(page.locator('#seed-demo')).toHaveCount(0);
  await expect(page.locator('#seed-crack-demo')).toHaveCount(0);
});

test('the dashboard keeps the older seed buttons when the pixel-only catalogue is off', async ({ page }) => {
  await routeDashboard(page, false);
  await page.goto('/admin');
  await expect(page.locator('#seed-pixel-demo')).toBeVisible();
  await expect(page.locator('#seed-sample')).toBeVisible();
  await expect(page.locator('#seed-demo')).toBeVisible();
  await expect(page.locator('#seed-crack-demo')).toBeVisible();
});

async function routeDashboard(page: Page, legacyCasesHidden: boolean) {
  await page.route('**/api/admin/dashboard', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({
      totalUsers: 3, totalCases: 2, publishedCases: 2, totalRooms: 1, activeRooms: 0, totalResults: 0, wins: 0, losses: 0,
      totalAiDrafts: 0, legacyCasesHidden,
    }) });
  });
  await page.route('**/api/admin/users', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope([]) });
  });
  await page.route('**/api/admin/playtest/**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'off' }) });
  });
}

async function routeCapabilities(page: Page) {
  await page.route('**/api/admin/ai-cases/capabilities', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({
      aiCaseV3PresetEnabled: true, gameplayV3Enabled: true, canCreateV3Draft: true, canPublishV3: true,
    }) });
  });
}

function envelope(data: unknown) {
  return JSON.stringify({ success: true, data });
}
