import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * Points a review of the admin re-skin found: the quick-search menu on browsers that do not focus links on click,
 * the theme staying inside the admin area, labels following the language switch, and the shell's landmarks.
 * The API is faked.
 */

const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

async function fakeDashboard(page: Page) {
  await page.route((url) => url.pathname === '/api/admin/dashboard', (route) => route.fulfill(ok({
    totalUsers: 2, totalCases: 1, publishedCases: 1, totalRooms: 0, activeRooms: 0, totalResults: 0, wins: 0, losses: 0, totalAiDrafts: 0, legacyCasesHidden: true,
  })));
  await page.route((url) => url.pathname === '/api/admin/users', (route) => route.fulfill(ok([
    { userId: 'u2', fullName: 'Thám tử An', email: 'an@example.com', role: 'PLAYER', status: 'ACTIVE' },
  ])));
}

test('a quick-search choice keeps focus in the box on mousedown, so Safari does not close the menu before the click', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/admin/audit');
  await page.getByRole('searchbox', { name: 'Tìm trong trang quản trị' }).fill('abc');
  const items = page.locator('#adm-search-menu a');
  await expect(items).toHaveCount(3);
  const prevented = await items.nth(1).evaluate((link) => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await items.nth(1).click();
  await expect(page).toHaveURL(/\/admin\/items\?q=abc$/);
});

test('the admin theme leaves .page-head alone outside the admin area', async ({ page }) => {
  await signInAs(page, 'PLAYER');
  await page.goto('/cases');
  await expect(page.locator('body')).not.toHaveAttribute('data-area', 'admin');
  const spacing = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'page-head';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const result = { marginBottom: style.marginBottom, gap: style.columnGap };
    probe.remove();
    return result;
  });
  expect(spacing.marginBottom).not.toBe('28px');
  expect(spacing.gap).not.toBe('20px');
});

test('dashboard pills, filters and the date line follow the language switch', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await fakeDashboard(page);
  await page.goto('/admin');
  const row = page.locator('[data-adp-users] tr', { hasText: 'Thám tử An' });
  await expect(row).toContainText('Người chơi');
  await expect(row).toContainText('Hoạt động');

  await page.locator('[data-ui-language="en"]').click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(row).toContainText('Player');
  await expect(row).toContainText('Active');
  await expect(page.locator('[data-adp-filter="all"]')).toContainText('All');
  await expect(page.locator('.adm-eyebrow')).not.toContainText('THỨ');
  await expect(page.locator('.adm-eyebrow')).not.toContainText('CHỦ NHẬT');
});

test('the shared pager speaks English on a bilingual page', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.route((url) => url.pathname === '/api/admin/cases', (route) => route.fulfill(ok([{
    caseId: 'case-pixel-tram-hong-ngoc-vi', title: 'Trâm hồng ngọc mất tích', status: 'PUBLISHED', language: 'vi', mechanicsVersion: 3,
    estimatedMinutes: 20, stageCount: 2, sceneCount: 3, clueCount: 8, isPixel: true, playerVisible: true,
  }])));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/capabilities', (route) => route.fulfill(ok({
    aiCaseV3PresetEnabled: false, gameplayV3Enabled: false, canCreateV3Draft: false, canPublishV3: false,
  })));
  await page.goto('/admin/cases');
  await expect(page.locator('.adm-pager')).toContainText('Hiển thị');
  await page.locator('[data-ui-language="en"]').click();
  await expect(page.locator('.adm-pager')).toContainText('Showing');
  await expect(page.locator('.adm-pager')).not.toContainText('Hiển thị');
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
});

test('the shell has one main landmark, one admin navigation, and a valid search box', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/admin/audit');
  await expect(page.getByRole('navigation', { name: 'Quản trị' })).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  const search = page.getByRole('searchbox', { name: 'Tìm trong trang quản trị' });
  await expect(search).toBeVisible();
  // aria-expanded and aria-controls belong to a combobox; a plain search box must not carry them.
  await expect(search).not.toHaveAttribute('aria-expanded', /.*/);
  await expect(search).not.toHaveAttribute('aria-controls', /.*/);
});

test('the admin sign-in page has a single main landmark', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.locator('#form-admin-login')).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
});
