import { expect, test, type Page } from '@playwright/test';

/**
 * Màn tân thủ, the way in (API mocked): the Kỳ cựu / Nhập môn choice on the home screen, the gate that sends a
 * beginner from rooms and matchmaking to /tan-thu, and the /tan-thu page that starts the solo tutorial room.
 */
type Status = { path: string | null; needsChoice: boolean; required: boolean; completed: boolean; activeRoomId: string | null };

async function signIn(page: Page, status: Status, calls: string[]) {
  await page.addInitScript(() => {
    window.localStorage.setItem('sirlocked.token', 'smoke-token');
    window.localStorage.setItem('sirlocked.uiLanguage', 'vi');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'player-1', fullName: 'Người mới', role: 'PLAYER', isEmailVerified: true }));
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ json: { success: true, data: null } }));
  await page.route('**/api/tutorial/status', (route) => route.fulfill({ json: { success: true, data: { ...status, caseId: 'case-pixel-tan-thu-vi' } } }));
  await page.route('**/api/tutorial/choice', async (route) => {
    const path = route.request().postDataJSON().path;
    calls.push(`choice:${path}`);
    Object.assign(status, { path, needsChoice: false, required: path === 'BEGINNER' });
    await route.fulfill({ json: { success: true, data: { ...status } } });
  });
  await page.route('**/api/tutorial/start', async (route) => {
    calls.push('start');
    await route.fulfill({ json: { success: true, data: { roomId: 'tutorial-room', resumed: false } } });
  });
}

const fresh = (): Status => ({ path: null, needsChoice: true, required: false, completed: false, activeRoomId: null });

test('a new account picks Nhập môn on the home screen and lands on the tutorial page', async ({ page }) => {
  const calls: string[] = [];
  await signIn(page, fresh(), calls);
  await page.goto('/menu');
  const choice = page.locator('[data-testid="tutorial-choice"]');
  await expect(choice).toBeVisible();
  await expect(choice).toContainText('Nhập môn');
  await expect(choice).toContainText('Người chơi kỳ cựu');
  await choice.locator('[data-tt-path="BEGINNER"]').click();
  await expect(page).toHaveURL(/\/tan-thu$/);
  await expect(choice).toHaveCount(0);
  expect(calls).toEqual(['choice:BEGINNER']);
  await expect(page.locator('.tt-page-card')).toContainText('Ấm men lam');
  await expect(page.locator('.tt-page-card')).toContainText('mở khóa tạo phòng và tìm trận');
  // A beginner has no way back to the menu from here until the tutorial is done.
  await expect(page.locator('[data-tt-back]')).toHaveCount(0);
});

test('a veteran closes the choice and keeps playing; the tutorial stays in the menu', async ({ page }) => {
  const calls: string[] = [];
  await signIn(page, fresh(), calls);
  await page.goto('/menu');
  await page.locator('[data-tt-path="VETERAN"]').click();
  await expect(page.locator('[data-testid="tutorial-choice"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/menu$/);
  expect(calls).toEqual(['choice:VETERAN']);
  await page.goto('/find-game');
  await expect(page).toHaveURL(/\/find-game$/);
});

test('a beginner who has not finished the tutorial is sent to /tan-thu from rooms and matchmaking', async ({ page }) => {
  const calls: string[] = [];
  await signIn(page, { path: 'BEGINNER', needsChoice: false, required: true, completed: false, activeRoomId: null }, calls);
  for (const address of ['/find-game', '/create-room', '/rooms', '/join']) {
    await page.goto(address);
    await expect(page).toHaveURL(/\/tan-thu$/);
  }
  await expect(page.locator('[data-testid="tutorial-choice"]')).toHaveCount(0);
  // The home banner points at the tutorial.
  await page.goto('/menu');
  await expect(page.locator('#home-tutorial')).toContainText('Bạn chọn Nhập môn');
});

test('the tutorial page starts the solo room and opens the game', async ({ page }) => {
  const calls: string[] = [];
  await signIn(page, { path: 'BEGINNER', needsChoice: false, required: true, completed: false, activeRoomId: null }, calls);
  await page.goto('/tan-thu');
  await page.locator('[data-tt-start]').click();
  await expect(page).toHaveURL(/\/game\/tutorial-room$/);
  expect(calls).toEqual(['start']);
});

test('after the tutorial, rooms open and the page offers a replay', async ({ page }) => {
  const calls: string[] = [];
  await signIn(page, { path: 'BEGINNER', needsChoice: false, required: false, completed: true, activeRoomId: null }, calls);
  await page.goto('/find-game');
  await expect(page).toHaveURL(/\/find-game$/);
  await page.goto('/tan-thu');
  await expect(page.locator('[data-tt-start]')).toHaveText('Chơi lại màn tân thủ');
  await expect(page.locator('[data-tt-back]')).toBeVisible();
});
