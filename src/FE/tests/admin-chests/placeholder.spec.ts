import { expect, test } from '@playwright/test';
import { signInAs } from '../helpers/adminSession';

/** ADMIN-1: remove a route when its real page replaces the placeholder, and this file with the last one. */
const ROUTES: [string, string][] = [
  ['#/admin/chests', 'Hòm & vật phẩm'],
  ['#/admin/chests/chest_np', 'Hòm & vật phẩm'],
  ['#/admin/items', 'Vật phẩm'],
];

for (const [hash, heading] of ROUTES) {
  test(`${hash} says it is under construction`, async ({ page }) => {
    await signInAs(page, 'ADMIN');
    await page.goto(`/${hash}`);
    await expect(page.locator('[data-admin-placeholder] h2')).toHaveText(heading);
    await expect(page.locator('[data-admin-placeholder]')).toContainText('Đang xây dựng');
  });
}
