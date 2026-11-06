import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * The tab bar every admin page shares and the routes the next admin areas start from. This says nothing about what a
 * page shows, so it stays true as the pages are built. The API is faked.
 */
const TABS = [
  ['Tổng quan', '/admin'],
  ['Vụ án', '/admin/cases'],
  ['Tạo vụ án AI', '/admin/ai'],
  ['Hàng tuần', '/admin/weekly'],
  ['Hòm & vật phẩm', '/admin/chests'],
  ['Mỹ phẩm', '/admin/cosmetics'],
  ['Người chơi', '/admin/players'],
  ['Kinh tế & chợ', '/admin/economy'],
  ['Nhật ký', '/admin/audit'],
] as const;

const tabs = (page: Page) => page.locator('#admin-nav-root .admin-nav-tab');
const activeTab = (page: Page) => page.locator('#admin-nav-root .admin-nav-tab.is-active');

test('an admin sees the nine tabs on every admin page, old and new', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  for (const [label, href] of TABS) {
    await page.goto(href);
    await expect(tabs(page)).toHaveText(TABS.map(([name]) => name));
    await expect(activeTab(page)).toHaveText(label);
    await expect(page.locator('#admin-nav-root [aria-current="page"]')).toHaveAttribute('href', href);
  }
});

test('the tabs navigate, and the bar outlives each page render', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/admin');
  const bar = page.locator('#admin-nav-root');
  await bar.getByRole('link', { name: 'Hòm & vật phẩm' }).click();
  await expect(page).toHaveURL(/\/admin\/chests$/);
  await expect(activeTab(page)).toHaveText('Hòm & vật phẩm');
  await bar.getByRole('link', { name: 'Vụ án', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/cases$/);
  await expect(tabs(page)).toHaveCount(9);
});

const SUB_ROUTES: [string, string][] = [
  ['/admin/chests/chest_np', 'Hòm & vật phẩm'],
  ['/admin/items', 'Hòm & vật phẩm'],
  ['/admin/cosmetics/frame_kimlong', 'Mỹ phẩm'],
  ['/admin/players/u42', 'Người chơi'],
  ['/admin/import', 'Vụ án'],
  ['/admin/cases/some-case', 'Vụ án'],
];

for (const [address, tab] of SUB_ROUTES) {
  test(`${address} keeps the ${tab} tab lit`, async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto(address);
    await expect(activeTab(page)).toHaveText(tab);
    await expect(page).toHaveURL(new RegExp(`${address.replaceAll('/', '\\/')}$`));
  });
}

// A page reads its own filters from the address, so these must reach it rather than fall back to the home page.
const WITH_QUERY: [string, string][] = [
  ['/admin/chests?tab=stats', 'Hòm & vật phẩm'],
  ['/admin/chests/chest_np?tab=history', 'Hòm & vật phẩm'],
  ['/admin/items?q=kinh', 'Hòm & vật phẩm'],
  ['/admin/cosmetics?tab=titles', 'Mỹ phẩm'],
  ['/admin/cosmetics/frame_kimlong?tab=grant', 'Mỹ phẩm'],
  ['/admin/players?page=2', 'Người chơi'],
  ['/admin/players/u42?tab=inventory', 'Người chơi'],
  ['/admin/economy?days=30', 'Kinh tế & chợ'],
  ['/admin/audit?targetId=VC-0217', 'Nhật ký'],
];

for (const [address, tab] of WITH_QUERY) {
  test(`${address} stays on its page`, async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto(address);
    await expect(activeTab(page)).toHaveText(tab);
    const { pathname, search } = new URL(page.url());
    expect(`${pathname}${search}`).toBe(address);
  });
}

test('the bar disappears when an admin leaves the admin pages', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/admin/chests');
  await expect(tabs(page)).toHaveCount(9);
  await page.evaluate(() => { history.pushState(null, '', '/cases'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page).toHaveURL(/\/cases$/);
  await expect(page.locator('#admin-nav-root')).toBeHidden();
  await expect(tabs(page)).toHaveCount(0);
});

test('someone with AI access only gets their page and no bar', async ({ page }) => {
  await signInAs(page, 'VIP');
  await page.goto('/admin/ai');
  await expect(page).toHaveURL(/\/admin\/ai$/);
  await expect(page.locator('#admin-nav-root')).toBeHidden();
  await expect(tabs(page)).toHaveCount(0);
});

for (const address of ['/admin/chests', '/admin/cosmetics/frame_kimlong', '/admin/players', '/admin/economy', '/admin/audit', '/admin/items']) {
  test(`a player is sent away from ${address}`, async ({ page }) => {
    await signInAs(page, 'PLAYER');
    await page.goto(address);
    await expect(page).toHaveURL(/\/cases$/);
    await expect(page.locator('#admin-nav-root')).toBeHidden();
    await expect(tabs(page)).toHaveCount(0);
  });
}

test('on a phone the sidebar folds into a menu, the page does not scroll sideways, and the current tab is in reach', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, 'ADMIN');
  await page.goto('/admin/audit');
  const active = activeTab(page);
  await expect(active).toHaveText('Nhật ký');

  // The route's lens transition overflows for a moment on every page; measure once it is gone.
  await expect(page.locator('.bpa-rim')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The folded bar names the current page; opening it shows every tab with the current one in view.
  const toggle = page.locator('#admin-nav-root [data-adm-menu]');
  await expect(toggle).toContainText('Nhật ký');
  await expect(active).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tabs(page)).toHaveCount(9);
  await expect(active).toBeInViewport({ ratio: 1 });
  const box = await active.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
