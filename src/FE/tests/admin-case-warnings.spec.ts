import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * VUAN-6: the import page shows the hint rule. A new case missing a hint level is refused with the exact target;
 * an existing case only gets a non-blocking warning, on "Kiểm tra" and after the import. The API is faked.
 */
const HINT_WARNING = {
  code: 'MissingHintLevel',
  path: 'hints[SCENE:scene-dh-ben-cang]',
  message: "SCENE 'scene-dh-ben-cang' needs hints at order 1, 2 and 3; missing order 2.",
  refId: 'scene-dh-ben-cang',
};

const CASE = { caseId: 'case-hint-demo', title: 'Đồng hồ bỏ túi đêm mưa' };

async function openImport(page: Page, answers: { validate: unknown; importCase?: { status: number; body: unknown } }) {
  await signInAs(page, 'ADMIN');
  await page.route((url) => url.pathname === '/api/admin/cases/validate', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: answers.validate }),
  }));
  await page.route((url) => url.pathname === '/api/admin/cases/import-json', (route) => route.fulfill({
    status: answers.importCase?.status ?? 200,
    contentType: 'application/json',
    body: JSON.stringify(answers.importCase?.body ?? { success: true, data: CASE }),
  }));
  await page.goto('/admin/import');
  await page.locator('#json-input').fill(JSON.stringify(CASE));
}

test('an existing case missing a hint level validates with a visible, non-blocking warning', async ({ page }) => {
  await openImport(page, {
    validate: { isValid: true, errors: [], warnings: [HINT_WARNING] },
    importCase: { status: 200, body: { success: true, data: { ...CASE, validationWarnings: [HINT_WARNING] } } },
  });

  await page.locator('#validate-btn').click();
  const output = page.locator('#import-output');
  await expect(output.locator('.notice-ok')).toContainText('Kiểm tra thành công');
  const warning = output.locator('.notice-warn');
  await expect(warning).toContainText('1 cảnh báo, không chặn');
  await expect(warning).toContainText('MissingHintLevel');
  await expect(warning).toContainText('hints[SCENE:scene-dh-ben-cang]');

  await page.locator('#import-btn').click();
  await expect(output.locator('.notice-ok')).toContainText('Đã nhập');
  await expect(output.locator('.notice-warn')).toContainText('missing order 2');
});

test('a new case missing a hint level is refused at the exact target', async ({ page }) => {
  await openImport(page, {
    validate: { isValid: false, errors: [HINT_WARNING], warnings: [] },
    importCase: { status: 422, body: { success: false, message: 'Case validation failed.', errors: [HINT_WARNING] } },
  });

  await page.locator('#validate-btn').click();
  const output = page.locator('#import-output');
  await expect(output.locator('.notice-bad')).toContainText('1 lỗi kiểm tra');
  await expect(output.locator('.notice-bad')).toContainText('hints[SCENE:scene-dh-ben-cang]');
  await expect(output.locator('.notice-warn')).toHaveCount(0);

  await page.locator('#import-btn').click();
  await expect(output.locator('.notice-bad')).toContainText('MissingHintLevel');
  await expect(output.locator('.notice-ok')).toHaveCount(0);
});

test('a clean case shows no warning block', async ({ page }) => {
  await openImport(page, { validate: { isValid: true, errors: [], warnings: [] } });
  await page.locator('#validate-btn').click();
  await expect(page.locator('#import-output .notice-ok')).toBeVisible();
  await expect(page.locator('#import-output .notice-warn')).toHaveCount(0);
});
