import { expect, test, type Page, type Route } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * /admin/weekly: the Thử thách tuần form names a week by one day (the server snaps it to 07:00 Wednesday to
 * 07:00 Wednesday, Vietnam time) and only takes the running week or the next one. The Vụ án của tuần form keeps its
 * start and end. Mocked API, no backend behind Vite.
 */
const DAY = 86_400_000;
const REFUSED = 'Tuần này đã kết thúc; chỉ chọn được tuần đang chạy hoặc tuần sau.';
const HINT = 'Tuần thử thách chạy từ 07:00 thứ Tư đến 07:00 thứ Tư tuần sau. Chọn một ngày trong tuần đang chạy hoặc tuần sau.';

type SetReply = { status: number; json: unknown };

async function prepare(page: Page, setReply: SetReply) {
  const posts: Array<Record<string, unknown>> = [];
  await signInAs(page, 'ADMIN');
  const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/cases/published') return ok(route, [{ caseId: 'case-a', title: 'Vụ án đêm mưa' }, { caseId: 'case-b', title: 'Vụ án bến cảng' }]);
    if (path === '/api/admin/weekly' && request.method() === 'POST') {
      posts.push(request.postDataJSON());
      return route.fulfill(setReply);
    }
    return route.fallback();
  });
  return posts;
}

const challengeForm = (page: Page) => page.locator('.ws-weekly-form[data-type="WEEKLY_CHALLENGE"]');
const caseOfWeekForm = (page: Page) => page.locator('.ws-weekly-form[data-type="CASE_OF_WEEK"]');

const storedWeek = {
  type: 'WEEKLY_CHALLENGE', caseId: 'case-b', caseTitle: 'Vụ án bến cảng', summary: '', coverImageUrl: '', estimatedMinutes: 0,
  weekStart: '2026-11-25T00:00:00Z', weekEnd: '2026-12-02T00:00:00Z', weekKey: '2026-11-25', source: 'ADMIN', minScore: 80, drops: [],
};

test('the challenge form asks for one day of the week, with the week rule beside it', async ({ page }) => {
  await prepare(page, { status: 200, json: { success: true, data: storedWeek } });
  await page.goto('/admin/weekly');

  const form = challengeForm(page);
  await expect(form.locator('input[type="date"]')).toHaveCount(1);
  const day = form.getByLabel('Ngày trong tuần');
  await expect(day).toBeVisible();
  await expect(day).toHaveAttribute('type', 'date');
  await expect(form).toContainText(HINT);
  await expect(form.getByText('Kết thúc', { exact: true })).toHaveCount(0);

  // The case of the week keeps its own start and end.
  await expect(caseOfWeekForm(page).locator('input[type="date"]')).toHaveCount(2);
  await expect(caseOfWeekForm(page).getByLabel('Bắt đầu')).toBeVisible();
  await expect(caseOfWeekForm(page).getByLabel('Kết thúc')).toBeVisible();
  await expect(caseOfWeekForm(page)).not.toContainText(HINT);
});

test('saving sends the day as weekStart and weekEnd seven days later, then shows the week the server stored', async ({ page }) => {
  const posts = await prepare(page, { status: 200, json: { success: true, data: storedWeek } });
  await page.goto('/admin/weekly');

  const form = challengeForm(page);
  await form.getByRole('combobox').selectOption('case-b');
  await form.getByLabel('Ngày trong tuần').fill('2026-11-27');
  await form.getByRole('button', { name: 'Lưu' }).click();

  await expect.poll(() => posts.length).toBe(1);
  const body = posts[0];
  expect(body.type).toBe('WEEKLY_CHALLENGE');
  expect(body.caseId).toBe('case-b');
  expect(body.weekStart).toBe('2026-11-27T00:00:00.000Z');
  expect(body.weekEnd).toBe('2026-12-04T00:00:00.000Z');
  expect(Date.parse(String(body.weekEnd)) - Date.parse(String(body.weekStart))).toBe(7 * DAY);

  // What the server stored (Wednesday 07:00 to Wednesday 07:00, Vietnam time), not what was typed.
  const saved = challengeForm(page).locator('[data-weekly-saved]');
  await expect(saved).toBeVisible();
  await expect(saved).toContainText('Vụ án bến cảng');
  await expect(saved).toContainText('07:00 25/11/2026');
  await expect(saved).toContainText('07:00 02/12/2026');
  await expect(challengeForm(page).locator('[data-weekly-error]')).toBeHidden();
});

test('a week the server refuses shows its message and the form can be sent again', async ({ page }) => {
  const posts = await prepare(page, { status: 400, json: { success: false, message: REFUSED } });
  await page.goto('/admin/weekly');

  const form = challengeForm(page);
  await form.getByRole('combobox').selectOption('case-a');
  await form.getByLabel('Ngày trong tuần').fill('2026-11-01');
  await form.getByRole('button', { name: 'Lưu' }).click();

  await expect(form.getByRole('alert')).toHaveText(REFUSED);
  await expect(form.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  await expect(form.locator('[data-weekly-saved]')).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(Date.parse(String(posts[0].weekEnd)) - Date.parse(String(posts[0].weekStart))).toBe(7 * DAY);
});
