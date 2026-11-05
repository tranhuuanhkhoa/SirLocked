import { expect, test, type Page } from '@playwright/test';

/**
 * The tab bar every admin page shares, and the placeholder pages the next three admin areas start from.
 * The API is faked: this is about the frame around the pages, not what they load.
 */
const TABS = [
  ['Tổng quan', '#/admin'],
  ['Vụ án', '#/admin/cases'],
  ['Tạo vụ án AI', '#/admin/ai'],
  ['Hàng tuần', '#/admin/weekly'],
  ['Hòm & vật phẩm', '#/admin/chests'],
  ['Mỹ phẩm', '#/admin/cosmetics'],
  ['Người chơi', '#/admin/players'],
  ['Kinh tế & chợ', '#/admin/economy'],
  ['Nhật ký', '#/admin/audit'],
] as const;

async function signIn(page: Page, role: string) {
  await page.addInitScript((userRole) => {
    localStorage.setItem('sirlocked.token', 'admin-nav-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'u1', fullName: 'Yến', role: userRole, isEmailVerified: true }));
  }, role);
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: null }),
  }));
}

const tabs = (page: Page) => page.locator('#admin-nav-root .admin-nav-tab');

test('an admin sees the nine tabs on every admin page, old and new', async ({ page }) => {
  await signIn(page, 'ADMIN');
  for (const [label, href] of TABS) {
    await page.goto(`/${href}`);
    await expect(tabs(page)).toHaveText(TABS.map(([name]) => name));
    await expect(page.locator('#admin-nav-root .admin-nav-tab.is-active')).toHaveText(label);
    await expect(page.locator('#admin-nav-root [aria-current="page"]')).toHaveAttribute('href', href);
  }
});

test('the tabs navigate, and the bar outlives each page render', async ({ page }) => {
  await signIn(page, 'ADMIN');
  await page.goto('/#/admin');
  const bar = page.locator('#admin-nav-root');
  await bar.getByRole('link', { name: 'Hòm & vật phẩm' }).click();
  await expect(page).toHaveURL(/#\/admin\/chests$/);
  await expect(page.locator('#app')).toContainText('Đang xây dựng');
  await bar.getByRole('link', { name: 'Vụ án', exact: true }).click();
  await expect(page).toHaveURL(/#\/admin\/cases$/);
  await expect(tabs(page)).toHaveCount(9);
});

const PLACEHOLDERS: [string, string, string][] = [
  ['#/admin/chests', 'Hòm & vật phẩm', 'Hòm & vật phẩm'],
  ['#/admin/chests/chest_np', 'Hòm & vật phẩm', 'Hòm & vật phẩm'],
  ['#/admin/items', 'Vật phẩm', 'Hòm & vật phẩm'],
  ['#/admin/cosmetics', 'Mỹ phẩm', 'Mỹ phẩm'],
  ['#/admin/cosmetics/frame_kimlong', 'Mỹ phẩm', 'Mỹ phẩm'],
  ['#/admin/players', 'Người chơi', 'Người chơi'],
  ['#/admin/players/u42', 'Người chơi', 'Người chơi'],
  ['#/admin/economy', 'Kinh tế & chợ', 'Kinh tế & chợ'],
  ['#/admin/audit', 'Nhật ký', 'Nhật ký'],
];

for (const [hash, heading, tab] of PLACEHOLDERS) {
  test(`${hash} says it is under construction`, async ({ page }) => {
    await signIn(page, 'ADMIN');
    await page.goto(`/${hash}`);
    await expect(page.locator('[data-admin-placeholder] h2')).toHaveText(heading);
    await expect(page.locator('[data-admin-placeholder]')).toContainText('Đang xây dựng');
    await expect(page.locator('#admin-nav-root .admin-nav-tab.is-active')).toHaveText(tab);
  });
}

test('case sub-pages keep the Vụ án tab lit', async ({ page }) => {
  await signIn(page, 'ADMIN');
  for (const hash of ['#/admin/import', '#/admin/cases/some-case']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('#admin-nav-root .admin-nav-tab.is-active')).toHaveText('Vụ án');
  }
});

test('the bar disappears when an admin leaves the admin pages', async ({ page }) => {
  await signIn(page, 'ADMIN');
  await page.goto('/#/admin/chests');
  await expect(tabs(page)).toHaveCount(9);
  await page.evaluate(() => { window.location.hash = '#/cases'; });
  await expect(page).toHaveURL(/#\/cases$/);
  await expect(page.locator('#admin-nav-root')).toBeHidden();
  await expect(tabs(page)).toHaveCount(0);
});

for (const hash of ['#/admin/chests', '#/admin/cosmetics/frame_kimlong', '#/admin/players', '#/admin/economy', '#/admin/audit', '#/admin/items']) {
  test(`a player is sent away from ${hash}`, async ({ page }) => {
    await signIn(page, 'PLAYER');
    await page.goto(`/${hash}`);
    await expect(page).toHaveURL(/#\/cases$/);
    await expect(page.locator('#admin-nav-root')).toBeHidden();
    await expect(page.locator('[data-admin-placeholder]')).toHaveCount(0);
  });
}

test('on a phone the bar scrolls by itself, the page does not, and the current tab is in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'ADMIN');
  await page.goto('/#/admin/audit');
  const active = page.locator('#admin-nav-root .admin-nav-tab.is-active');
  await expect(active).toHaveText('Nhật ký');
  await expect(active).toBeInViewport({ ratio: 1 });

  // The route's lens transition overflows for a moment on every page; measure once it is gone.
  await expect(page.locator('.bpa-rim')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const scroller = page.locator('.admin-nav-scroll');
  const { scrollWidth, clientWidth } = await scroller.evaluate((node) => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  const box = await active.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
