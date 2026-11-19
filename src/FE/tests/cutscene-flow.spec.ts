import { expect, test, type Page } from '@playwright/test';
import { roomId, smokeState } from './helpers/smokeState';
import { caseId, playable } from './helpers/cutsceneFixture';

// The opening comic inside the real game page, the cases list and the admin page, with a mocked API (no AI is called).

const stateWithCase = { ...smokeState, caseId };
const ok = (data: unknown) => ({ json: { success: true, data } });

async function signIn(page: Page, userId = 'player-1', muted = true) {
  await page.addInitScript(([id, isMuted]) => {
    localStorage.setItem('sirlocked.token', 'smoke-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.audio.v1', JSON.stringify({ music: 0.2, effects: 0.35, muted: isMuted }));
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: id, fullName: 'Smoke Player', role: 'PLAYER', isEmailVerified: true }));
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, [userId, muted] as const);
}

async function mockGame(page: Page, intro: unknown | 'error' | 'slow') {
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill(ok(stateWithCase)));
  await page.route(`**/api/cases/${caseId}/intro-cutscene`, async (route) => {
    if (intro === 'error') return route.fulfill({ status: 500, json: { success: false, message: 'boom' } });
    if (intro === 'slow') await new Promise((resolve) => setTimeout(resolve, 4000));
    return route.fulfill(ok(intro === 'slow' ? playable() : intro));
  });
}

const comicTitleStart = (page: Page) => page.evaluate(() => (window as any).__motionComic.timeline.titleStart as number);
async function skipToEnd(page: Page) {
  await expect(page.locator('.mc-root')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__motionComic?.state)).toBe('playing');
  // Hold Esc: the real skip gesture.
  await page.keyboard.down('Escape');
  await page.waitForTimeout(1000);
  await page.keyboard.up('Escape');
  await page.evaluate((t) => (window as any).__motionComic.seek(t), (await comicTitleStart(page)) + 4.6);
  await expect(page.locator('[data-mc-finish]')).toBeVisible();
}

test('first visit: opening comic, then role briefing, then the investigation; saved per player', async ({ page }) => {
  await signIn(page);
  await mockGame(page, playable());
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('.mc-root')).toBeVisible();
  // The role briefing waits behind the comic.
  await expect(page.locator('#intro-overlay')).toHaveCount(0);
  await skipToEnd(page);
  await expect(page.locator('[data-mc-finish]')).toHaveText('Vào điều tra');
  await page.locator('[data-mc-finish]').click();
  await expect(page.locator('.mc-root')).toHaveCount(0);
  await expect(page.locator('#intro-overlay')).toBeVisible();
  await page.locator('#intro-dismiss').click();
  await expect(page.locator('#intro-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sirlocked.presentation.smoke-room.player-1'))).toContain('mc-intro:');
  // "Watch the opening again" is in the game's tools.
  await expect(page.locator('#game-replay-intro')).toBeVisible();
});

test('reload does not play it again; "Xem lại mở đầu" does, and ends back in the game', async ({ page }) => {
  await signIn(page);
  await mockGame(page, playable());
  await page.goto(`/game/${roomId}`);
  await skipToEnd(page);
  await page.locator('[data-mc-finish]').click();
  await page.locator('#intro-dismiss').click();

  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('.mc-root')).toHaveCount(0);
  await expect(page.locator('#intro-overlay')).toHaveCount(0);

  await page.locator('#game-replay-intro').click();
  await expect(page.locator('.mc-root')).toBeVisible();
  await skipToEnd(page);
  await page.locator('[data-mc-finish]').click();
  await expect(page.locator('.mc-root')).toHaveCount(0);
  await expect(page.locator('#intro-overlay')).toHaveCount(0); // the briefing was already dismissed in this tab
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('a case with no opening comic starts exactly as before', async ({ page }) => {
  await signIn(page);
  await mockGame(page, null);
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('#intro-overlay')).toBeVisible();
  await expect(page.locator('.mc-root')).toHaveCount(0);
  await expect(page.locator('#game-replay-intro')).toHaveCount(0);
});

test('a failing opening lookup never blocks the game', async ({ page }) => {
  await signIn(page);
  await mockGame(page, 'error');
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('#intro-overlay')).toBeVisible();
  await expect(page.locator('.mc-root')).toHaveCount(0);
});

test('a very slow opening lookup is abandoned after a few seconds instead of freezing the start', async ({ page }) => {
  await signIn(page);
  await mockGame(page, 'slow');
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('#intro-overlay')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.mc-root')).toHaveCount(0);
});

test('a script with bad art ids still lets the game continue (broken images fall back)', async ({ page }) => {
  await signIn(page);
  const broken = playable();
  broken.assets = { scenes: {}, characters: {}, items: {}, coverUrl: '' } as any;
  await mockGame(page, broken);
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('.mc-root')).toBeVisible();
  await skipToEnd(page);
  await page.locator('[data-mc-finish]').click();
  await expect(page.locator('#intro-overlay')).toBeVisible();
});

test('the partner watches on their own: one player finishing does not skip it for the other', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    await signIn(a, 'player-1'); await signIn(b, 'player-2');
    await mockGame(a, playable()); await mockGame(b, playable());
    await a.goto(`/game/${roomId}`); await b.goto(`/game/${roomId}`);
    await expect(a.locator('.mc-root')).toBeVisible();
    await expect(b.locator('.mc-root')).toBeVisible();
    await skipToEnd(a);
    await a.locator('[data-mc-finish]').click();
    await expect(a.locator('.mc-root')).toHaveCount(0);
    await expect(b.locator('.mc-root')).toBeVisible(); // still watching
    expect(await b.evaluate(() => (window as any).__motionComic?.state)).toBe('playing');
  } finally {
    await first.close(); await second.close();
  }
});

test('Esc during the opening is swallowed by the player and does not open game menus', async ({ page }) => {
  await signIn(page);
  await mockGame(page, playable());
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('.mc-root')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mc-root')).toBeVisible();
});

// ---------------------------------------------------------------- cases list

const publishedCases = [
  { caseId, title: 'Lọ thuốc thứ Năm', summary: 'Một buổi sáng ở phố Hàng Đường.', language: 'vi', estimatedMinutes: 30, status: 'PUBLISHED', isPixel: true, sceneCount: 6, characterCount: 6, clueCount: 12 },
  { caseId: 'case-without-intro', title: 'Vụ án chưa có mở đầu', summary: 'Không có cutscene.', language: 'vi', estimatedMinutes: 20, status: 'PUBLISHED', isPixel: true, sceneCount: 3, characterCount: 3, clueCount: 6 },
];

test('cases list: "Xem mở đầu" appears only for cases that have one and plays that case', async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/cases\/[^/]+$/, (route) => route.fulfill(ok({ characters: [] })));
  await page.route('**/api/cases/published', (route) => route.fulfill(ok(publishedCases))); // registered last, so it wins
  await page.route(`**/api/cases/${caseId}/intro-cutscene`, (route) => route.fulfill(ok(playable())));
  await page.route('**/api/cases/case-without-intro/intro-cutscene', (route) => route.fulfill(ok(null)));
  await page.goto('/cases');
  await expect(page.locator('.bpa-cases-file')).toHaveCount(2);

  await page.locator('[data-pick="0"]').click();
  await expect(page.locator('[data-cover-intro]')).toBeVisible();
  await expect(page.locator('[data-cover-intro]')).toContainText('Xem mở đầu');
  await page.locator('[data-cover-intro]').click();
  await expect(page.locator('.mc-root')).toBeVisible();
  await expect(page.locator('.mc-logo')).toContainText('Lọ thuốc thứ Năm');
  await expect.poll(() => page.evaluate(() => (window as any).__motionComic?.state)).toBe('playing');
  await page.evaluate(() => (window as any).__motionComic.seek((window as any).__motionComic.timeline.end - 0.1));
  await page.waitForTimeout(400);
  await expect(page.locator('[data-mc-finish]')).toHaveText('Đóng');
  await page.locator('[data-mc-finish]').click();
  await expect(page.locator('.mc-root')).toHaveCount(0);

  await page.locator('[data-pick="1"]').click();
  await expect(page.locator('[data-cover-intro]')).toBeHidden();
});

// ---------------------------------------------------------------- admin

function adminRig(page: Page) {
  const calls: string[] = [];
  const bodies: Record<string, any> = {};
  let versions: any[] = [];
  let script: any = null;
  const dto = () => ({
    caseId, versions, latest: versions[0] ?? null, script, assets: playable().assets,
  });
  const version = (n: number, status: string) => ({ id: `${caseId}:INTRO:v${n}`, version: n, status, source: 'AI', model: 'gpt-test', estimatedSeconds: 55, createdAt: new Date().toISOString(), approvedAt: null });
  return {
    calls, bodies,
    async install() {
      await page.route(`**/api/admin/cases/${caseId}`, (route) => route.fulfill(ok({ ...({} as any), caseId, title: 'Lọ thuốc thứ Năm', status: 'PUBLISHED', summary: 's', mechanicsVersion: 3 })));
      await page.route('**/api/admin/cases/validate', (route) => route.fulfill(ok({ isValid: true, errors: [] })));
      await page.route('**/api/admin/ai-cases/capabilities*', (route) => route.fulfill(ok({})));
      await page.route(`**/api/admin/cases/${caseId}/cutscene**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const key = `${req.method()} ${url.pathname.replace(`/api/admin/cases/${caseId}/cutscene`, '') || '/'}`;
        calls.push(key);
        if (req.method() === 'GET') return route.fulfill(ok(dto()));
        if (key === 'POST /generate') {
          bodies.generate = req.postDataJSON();
          if (versions.length && !req.postDataJSON().regenerate) return route.fulfill({ status: 409, json: { success: false, message: 'confirm' } });
          script = playable().script;
          versions = [version(versions.length + 1, 'DRAFT'), ...versions];
          return route.fulfill(ok(dto()));
        }
        if (req.method() === 'PUT') {
          bodies.save = req.postDataJSON();
          const text = JSON.stringify(bodies.save.script);
          if (text.includes('"text":"' + 'x'.repeat(91))) return route.fulfill({ status: 422, json: { success: false, message: 'The cutscene script is not valid.', errors: ['too long'] } });
          script = bodies.save.script;
          return route.fulfill(ok(dto()));
        }
        if (key.endsWith('/approve')) { versions = versions.map((v, i) => (i === 0 ? { ...v, status: 'APPROVED' } : v)); return route.fulfill(ok(dto())); }
        if (key === 'POST /disable') { versions = versions.map((v) => (v.status === 'APPROVED' ? { ...v, status: 'DISABLED' } : v)); return route.fulfill(ok(dto())); }
        return route.fulfill({ status: 404, json: { success: false } });
      });
    },
  };
}

test('admin: generate, preview, edit text (limits enforced), approve, hide, and regenerate asks first', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'admin-token'); localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.audio.v1', JSON.stringify({ music: 0.2, effects: 0.35, muted: true }));
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'admin-1', fullName: 'Admin', role: 'ADMIN', isEmailVerified: true }));
  });
  const rig = adminRig(page);
  await rig.install();
  await page.goto(`/admin/cases/${caseId}`);
  const panel = page.locator('#cutscene-panel');
  await expect(panel.locator('[data-cs-generate]')).toHaveText('Tạo bằng AI');
  await expect(panel.locator('[data-cs-approve]')).toBeDisabled();

  // First generation needs no confirmation.
  let dialogs = 0;
  page.on('dialog', (dialog) => { dialogs++; void dialog.accept(); });
  await panel.locator('[data-cs-generate]').click();
  await expect(panel.locator('[data-cs-status]')).toHaveText('Bản nháp');
  expect(dialogs).toBe(0);
  expect(rig.bodies.generate.regenerate).toBe(false);

  // Preview plays in the page.
  await panel.locator('[data-cs-preview]').click();
  await expect(page.locator('.mc-root')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__motionComic?.state)).toBe('playing');
  await page.evaluate(() => (window as any).__motionComic.seek((window as any).__motionComic.timeline.end - 0.1));
  await page.waitForTimeout(400);
  await page.locator('[data-mc-finish]').click();
  await expect(page.locator('.mc-root')).toHaveCount(0);

  // Editing: too long is blocked in the browser before any request.
  await panel.locator('[data-cs-edit]').click();
  const first = panel.locator('[data-beat="0.0.0"]');
  await first.fill('x'.repeat(91));
  await expect(panel.locator('[data-count-for="0.0.0"]')).toHaveText('91/90');
  await panel.locator('[data-cs-save]').click();
  await expect(panel.locator('.notice-bad')).toContainText('tối đa 90');
  expect(rig.calls.filter((c) => c.startsWith('PUT'))).toHaveLength(0);
  // A valid edit is saved.
  await first.fill('Một dòng đã sửa, vẫn đủ ngắn.');
  await panel.locator('[data-cs-save]').click();
  await expect(panel.locator('.notice-ok')).toContainText('Đã lưu');
  expect(JSON.stringify(rig.bodies.save)).toContain('Một dòng đã sửa, vẫn đủ ngắn.');

  await panel.locator('[data-cs-approve]').click();
  await expect(panel.locator('[data-cs-status]')).toHaveText('Đã duyệt');
  await expect(panel.locator('[data-cs-disable]')).toBeEnabled();
  await panel.locator('[data-cs-disable]').click();
  await expect(panel.locator('[data-cs-status]')).toHaveText('Đã tắt');

  // Generating again asks first; saying no sends nothing.
  page.removeAllListeners('dialog');
  let message = '';
  page.on('dialog', (dialog) => { message = dialog.message(); void dialog.dismiss(); });
  const before = rig.calls.filter((c) => c === 'POST /generate').length;
  await panel.locator('[data-cs-generate]').click();
  await expect.poll(() => message).toContain('tốn phí AI');
  expect(rig.calls.filter((c) => c === 'POST /generate').length).toBe(before);
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await panel.locator('[data-cs-generate]').click();
  await expect.poll(() => rig.calls.filter((c) => c === 'POST /generate').length).toBe(before + 1);
  expect(rig.bodies.generate.regenerate).toBe(true);
});
