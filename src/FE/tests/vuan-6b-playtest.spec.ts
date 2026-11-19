import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * VUAN-6B part C and D in the browser, every API mocked (no backend): the "Chơi thử" button on /admin/ai, the
 * playtest lobby and its single-use invite link, the join page with the invite secret, the playtest result page,
 * and the in-page confirmation that replaced confirm() when a draft is cancelled.
 */

const TOKEN = 'Pt0ken_Pt0ken-Pt0kenPt0k';
const CASE_ID = 'case-ai-draft-vi';
const ROOM_ID = 'playtest-room';
const envelope = (data: unknown) => ({ success: true, data });
const ok = (route: Route, data: unknown) => route.fulfill({ json: envelope(data) });

const capabilities = {
  aiCaseV3PresetEnabled: true, gameplayV3Enabled: true,
  canCreateDraft: true, canCreateV3Draft: true, creationBlockers: [], v3CreationBlockers: [],
};
const base = {
  provider: 'Claude', queueState: 'NONE', canCancel: false, canContinue: false, createdByRole: 'VIP',
  createdByUserId: 'vip-author', orderStatus: 'SUBMITTED', settings: { generationPreset: 'SHORT_DEMO', language: 'vi' },
};
const imported = { ...base, draftId: 'draft-imported', status: 'IMPORTED', importedCaseId: CASE_ID, caseId: CASE_ID, caseTitle: 'Chiếc ô bị bỏ quên' };
const published = { ...base, draftId: 'draft-published', status: 'PUBLISHED', importedCaseId: 'case-published', caseId: 'case-published', caseTitle: 'Vụ đã đăng' };
const ready = { ...base, draftId: 'draft-ready', status: 'READY_TO_PUBLISH', importedCaseId: null, caseId: 'case-ready', caseTitle: 'Vụ chờ import' };

type User = { userId: string; fullName: string; role: 'ADMIN' | 'VIP' | 'PLAYER' };
const ADMIN: User = { userId: 'admin-yen', fullName: 'Yen', role: 'ADMIN' };
const VIP: User = { userId: 'vip-author', fullName: 'Tác giả VIP', role: 'VIP' };
const PLAYER: User = { userId: 'friend', fullName: 'Bạn được mời', role: 'PLAYER' };

const lobbyRoom = (host: User, playtest: Record<string, unknown> = { draftId: imported.draftId, inviteClaimed: false, inviteToken: TOKEN }, players = [host]) => ({
  roomId: ROOM_ID, roomCode: 'PTA234', caseId: CASE_ID, caseTitle: imported.caseTitle, hostUserId: host.userId,
  status: 'WAITING', visibility: 'PRIVATE', createdAt: '2026-11-17T08:00:00Z', playtest,
  players: players.map((player) => ({ userId: player.userId, username: player.fullName, role: null, isReady: false, isConnected: true })),
});

async function signIn(page: Page, user: User | null, language: 'vi' | 'en' = 'vi') {
  await page.addInitScript(({ user, language }) => {
    localStorage.setItem('sirlocked.uiLanguage', language);
    if (user) {
      localStorage.setItem('sirlocked.token', `token-${user.userId}`);
      localStorage.setItem('sirlocked.user', JSON.stringify({ ...user, email: `${user.userId}@tests.invalid`, isEmailVerified: true }));
    }
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, { user, language });
  // Anything not answered below gets an empty success, never a real server.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
}

async function mockAdminAi(page: Page, user: User, drafts: unknown[]) {
  await page.route((url) => url.pathname === '/api/admin/ai-cases/capabilities', (route) => ok(route, capabilities));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/library', (route) => ok(route, []));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/quota', (route) => ok(route, user.role === 'ADMIN'
    ? { role: 'ADMIN', unlimited: true, weeklyLimit: 0, usedThisWeek: 0, remaining: 0, weekStart: '2026-11-16' }
    : { role: 'VIP', unlimited: false, weeklyLimit: 2, usedThisWeek: 1, remaining: 1, weekStart: '2026-11-16' }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/settings', (route) => user.role === 'ADMIN'
    ? ok(route, { id: 'aiCases', vipWeeklyOrderLimit: 2 })
    : route.fulfill({ status: 403, json: { success: false, message: 'Forbidden' } }));
  await page.route((url) => url.pathname === '/api/admin/ai-cases', (route) => ok(route, drafts));
}

/** The lobby of the playtest room, as the server would answer it, with the case read through the room. */
async function mockLobby(page: Page, room: unknown) {
  const caseReads: string[] = [];
  await page.route((url) => url.pathname === `/api/rooms/${ROOM_ID}`, (route) => ok(route, room));
  await page.route((url) => url.pathname === `/api/cases/${CASE_ID}`, (route) => {
    caseReads.push(new URL(route.request().url()).search);
    return ok(route, { caseId: CASE_ID, title: imported.caseTitle, summary: 'Một bản nháp AI chưa đăng.', estimatedMinutes: 20, sceneCount: 2, characterCount: 3, clueCount: 4, characters: [] });
  });
  return caseReads;
}

test('ADMIN: only an imported, unpublished draft offers "Chơi thử", which opens the private lobby with a single-use invite link', async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  await mockAdminAi(page, ADMIN, [imported, published, ready]);
  const posts: string[] = [];
  await page.route((url) => url.pathname.startsWith('/api/admin/ai-cases/') && url.pathname.endsWith('/playtest'), (route) => {
    expect(route.request().method()).toBe('POST');
    posts.push(new URL(route.request().url()).pathname);
    return ok(route, lobbyRoom(ADMIN));
  });
  const caseReads = await mockLobby(page, lobbyRoom(ADMIN));

  await page.goto('/admin/ai');
  const row = (id: string) => page.locator(`[data-draft-row="${id}"]`);
  await expect(row(imported.draftId)).toBeVisible();
  await row(imported.draftId).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('admin-ai-playtest-row.png') });
  await expect(page.locator('[data-playtest-draft]')).toHaveCount(1);
  await expect(row(imported.draftId).getByRole('button', { name: 'Chơi thử' })).toBeVisible();
  // An unpublished case has no public page, so its row no longer links to one; a published case still does.
  await expect(row(imported.draftId).getByRole('link', { name: 'Mở vụ án' })).toHaveCount(0);
  await expect(row(published.draftId).getByRole('link', { name: 'Mở vụ án' })).toBeVisible();
  await expect(row(ready.draftId).getByRole('button', { name: 'Chơi thử' })).toHaveCount(0);

  await row(imported.draftId).getByRole('button', { name: 'Chơi thử' }).click();
  await expect(page).toHaveURL(new RegExp(`/lobby/${ROOM_ID}$`));
  expect(posts).toEqual([`/api/admin/ai-cases/${imported.draftId}/playtest`]);
  await expect(page.locator('#lobby-playtest')).toContainText('Chơi thử');
  await expect(page.locator('#lobby-playtest')).toContainText('không tính xếp hạng và không nhận thưởng');
  await expect(page.getByText('Mời một người chơi thử', { exact: true })).toBeVisible();
  const inviteUrl = new URL(`/join?code=PTA234&invite=${TOKEN}`, page.url()).href;
  await expect(page.locator('#room-invite-link')).toHaveValue(inviteUrl);
  await expect(page.locator('#lobby-invite-help')).toContainText('chỉ dùng được cho một người');
  // The unpublished case is read through the playtest room.
  await expect.poll(() => caseReads).toContain(`?roomId=${ROOM_ID}`);
  await expect(page.locator('.bpa-rim')).toHaveCount(0, { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('playtest-lobby-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.locator('#lobby-playtest').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('playtest-lobby-390.png') });
});

test('ADMIN: the draft card leads to Case Studio, offers "Chơi thử" and explains it; a refusal is shown in Vietnamese and keeps the page', async ({ page }) => {
  await signIn(page, ADMIN);
  await mockAdminAi(page, ADMIN, [imported]);
  await page.route((url) => url.pathname === `/api/admin/ai-cases/${imported.draftId}`, (route) => ok(route, imported));
  await page.route((url) => url.pathname === `/api/admin/ai-cases/${imported.draftId}/playtest`, (route) => route.fulfill({
    status: 403,
    json: { success: false, message: 'Only an admin or the author of this draft can playtest it.', errors: { code: 'PLAYTEST_FORBIDDEN', messageKey: 'room.playtest.forbidden' } },
  }));

  await page.goto('/admin/ai');
  await page.locator(`[data-draft-row="${imported.draftId}"]`).getByRole('button', { name: 'Xem' }).click();
  const card = page.locator('#ai-output');
  // Case Studio comes first for the owner: fix the imported case, playtest it, then publish from the editor.
  await expect(card.locator('[data-editor-link].btn-primary')).toHaveAttribute('href', `/admin/editor/${CASE_ID}`);
  await expect(card.locator('[data-playtest-draft]')).toBeVisible();
  await expect(card.locator('[data-playtest-help]')).toContainText('một người được mời bằng liên kết');
  await expect(card).not.toContainText('Mở vụ án đã xuất bản');
  await expect(card.getByRole('link', { name: 'Xem trong quản trị vụ án' })).toHaveAttribute('href', `/admin/cases/${CASE_ID}`);

  await card.locator('[data-playtest-draft]').click();
  await expect(page.locator('.toast-error')).toHaveText('Chỉ ADMIN hoặc tác giả bản nháp mới chơi thử được.');
  await expect(page).toHaveURL(/\/admin\/ai$/);
  await expect(card.locator('[data-playtest-draft]')).toBeEnabled();
});

test('VIP: the author playtests their own imported draft from /admin/ai', async ({ page }) => {
  await signIn(page, VIP);
  await mockAdminAi(page, VIP, [imported]);
  let posts = 0;
  await page.route((url) => url.pathname === `/api/admin/ai-cases/${imported.draftId}/playtest`, (route) => { posts++; return ok(route, lobbyRoom(VIP)); });
  await mockLobby(page, lobbyRoom(VIP));

  await page.goto('/admin/ai');
  // A VIP author has no Case Studio: publishing stays the owner's decision.
  await expect(page.locator('[data-editor-link]')).toHaveCount(0);
  await page.locator(`[data-draft-row="${imported.draftId}"]`).getByRole('button', { name: 'Chơi thử' }).click();
  await expect(page).toHaveURL(new RegExp(`/lobby/${ROOM_ID}$`));
  expect(posts).toBe(1);
  await expect(page.locator('#room-invite-link')).toHaveValue(new RegExp(`invite=${TOKEN}$`));
});

test('the invited player joins with the secret of the link; a refusal reads in Vietnamese; another code never carries it', async ({ page }) => {
  await signIn(page, PLAYER);
  const bodies: unknown[] = [];
  let answer: 'missing' | 'forbidden' | 'joined' = 'missing';
  await page.route((url) => url.pathname === '/api/rooms/join', (route) => {
    bodies.push(route.request().postDataJSON());
    if (answer === 'missing') return route.fulfill({ status: 404, json: { success: false, message: 'No room with this code was found.' } });
    if (answer === 'forbidden') return route.fulfill({ status: 403, json: {
      success: false, message: 'This room is a private playtest of an unpublished case.',
      errors: { code: 'PLAYTEST_FORBIDDEN', messageKey: 'room.playtest.forbidden' },
    } });
    return ok(route, lobbyRoom(ADMIN, { draftId: imported.draftId, inviteClaimed: true, inviteToken: null }, [ADMIN, PLAYER]));
  });
  await mockLobby(page, lobbyRoom(ADMIN, { draftId: imported.draftId, inviteClaimed: true, inviteToken: null }, [ADMIN, PLAYER]));

  await page.goto(`/join?code=PTA234&invite=${TOKEN}`);
  await expect(page.locator('#join-room-code')).toHaveValue('PTA234');
  await expect(page.locator('#invite-playtest')).toContainText('chơi thử một vụ án chưa đăng');

  // Typing another code: the secret stays behind.
  await page.locator('#join-room-code').fill('XYZ234');
  await page.locator('#join-form button').click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toEqual({ roomCode: 'XYZ234' });

  answer = 'forbidden';
  await page.locator('#join-room-code').fill('PTA234');
  await page.locator('#join-form button').click();
  await expect(page.locator('.toast-error').last()).toHaveText('Phòng này là phòng chơi thử một vụ án chưa đăng. Chỉ ADMIN, tác giả và người được mời mới vào được.');
  expect(bodies[1]).toEqual({ roomCode: 'PTA234', inviteToken: TOKEN });

  answer = 'joined';
  await page.locator('#join-form button').click();
  await expect(page).toHaveURL(new RegExp(`/lobby/${ROOM_ID}$`));
  expect(bodies[2]).toEqual({ roomCode: 'PTA234', inviteToken: TOKEN });
  // Once claimed, the lobby shows no invite link, only who may come in.
  await expect(page.locator('#lobby-playtest')).toBeVisible();
  await expect(page.locator('#room-invite-link')).toHaveCount(0);
  await expect(page.locator('#lobby-invite-help')).toHaveText('Lời mời đã có người nhận. Chỉ ADMIN, tác giả và người được mời mới vào được phòng này.');
});

test('a logged-out playtest invite keeps its secret through sign-in, and a malformed secret is dropped', async ({ page }) => {
  await signIn(page, null);
  await page.goto(`/join?code=pta234&invite=${TOKEN}`);
  await expect(page).toHaveURL(/\/login$/);
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sirlocked.pendingInvite') || 'null')?.destination ?? null);
  expect(await saved()).toBe(`/join?code=PTA234&invite=${TOKEN}`);

  await page.goto('/join?code=PTA234&invite=%3Cscript%3E');
  await expect(page).toHaveURL(/\/login$/);
  expect(await saved()).toBe('/join?code=PTA234');
});

test('a playtest result says it was not ranked or rewarded, offers no review, and leads the author back to the drafts', async ({ page }) => {
  await signIn(page, VIP);
  let rewardReads = 0;
  await page.route((url) => url.pathname.startsWith('/api/market/rewards/'), (route) => { rewardReads++; return ok(route, { amount: 120 }); });
  await page.route((url) => url.pathname === `/api/game/rooms/${ROOM_ID}/result`, (route) => ok(route, {
    roomId: ROOM_ID, caseId: CASE_ID, caseTitle: imported.caseTitle, success: true, isPlaytest: true,
    selectedCulpritId: 'c1', selectedCulpritName: 'Bà Tư', correctCulpritId: 'c1', correctCulpritName: 'Bà Tư',
    ending: 'Chiếc ô đã về với chủ.', selectedEvidenceIds: ['e1'], requiredEvidenceIds: ['e1'], evidenceResults: [],
    completedAt: '2026-11-17T09:00:00Z',
  }));
  await page.goto(`/result/${ROOM_ID}`);
  await expect(page.locator('[data-playtest-note]')).toHaveText('Ván chơi thử bản nháp chưa đăng: không tính xếp hạng, không nhận thưởng.');
  await expect(page.locator(`a[href="/workshop/${CASE_ID}"]`)).toHaveCount(0);
  await expect(page.locator(`a[href="/cases/${CASE_ID}"]`)).toHaveCount(0);
  await expect(page.locator('[data-playtest-back]')).toHaveAttribute('href', '/admin/ai');
  await expect(page.locator('[data-market-reward]')).toHaveCount(0);
  expect(rewardReads).toBe(0);
});

test('an ordinary result is unchanged: review and replay links, and the reward is asked for', async ({ page }) => {
  await signIn(page, PLAYER, 'en');
  let rewardReads = 0;
  await page.route((url) => url.pathname.startsWith('/api/market/rewards/'), (route) => { rewardReads++; return ok(route, null); });
  await page.route((url) => url.pathname === '/api/game/rooms/room-1/result', (route) => ok(route, {
    roomId: 'room-1', caseId: 'case-pixel-tram-hong-ngoc-vi', caseTitle: 'Trâm hồng ngọc mất tích', success: true,
    selectedCulpritId: 'c1', selectedCulpritName: 'A', correctCulpritId: 'c1', correctCulpritName: 'A', ending: 'Solved.',
    selectedEvidenceIds: [], requiredEvidenceIds: [], evidenceResults: [], completedAt: '2026-11-17T09:00:00Z',
  }));
  await page.goto('/result/room-1');
  await expect(page.locator('a[href="/workshop/case-pixel-tram-hong-ngoc-vi"]')).toBeVisible();
  await expect(page.locator('a[href="/cases/case-pixel-tram-hong-ngoc-vi"]')).toBeVisible();
  await expect(page.locator('[data-playtest-note]')).toHaveCount(0);
  await expect.poll(() => rewardReads).toBe(1);
});

test('cancelling a draft asks in a dialog of the page, in Vietnamese, and only "Hủy bản nháp" cancels', async ({ page }, testInfo) => {
  await signIn(page, ADMIN);
  const cancellable = { ...base, draftId: 'draft-running', status: 'STORY_AWAITING_APPROVAL', canCancel: true, caseTitle: 'Bản nháp đang làm', storyPreview: { title: 'Bản nháp đang làm', summary: 'Tiền đề.' } };
  let cancelled = false;
  let cancels = 0;
  await mockAdminAi(page, ADMIN, []);
  await page.route((url) => url.pathname === '/api/admin/ai-cases', (route) => ok(route, [cancelled
    ? { ...cancellable, status: 'CANCELLED', queueState: 'CANCELLED', canCancel: false }
    : cancellable]));
  await page.route((url) => url.pathname === '/api/admin/ai-cases/draft-running/cancel', (route) => {
    cancels++;
    cancelled = true;
    return ok(route, { ...cancellable, status: 'CANCELLED', queueState: 'CANCELLED', canCancel: false });
  });
  const nativeDialogs: string[] = [];
  page.on('dialog', (dialog) => { nativeDialogs.push(dialog.type()); void dialog.dismiss(); });

  await page.goto('/admin/ai');
  const cancel = page.locator('[data-draft-row="draft-running"] [data-cancel-draft]');
  await expect(cancel).toHaveText('Hủy bản nháp');
  await cancel.click();
  const dialog = page.getByRole('dialog', { name: 'Hủy bản nháp này?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Hủy bản nháp không đặt lại hạn mức tạo hôm nay.');
  await page.screenshot({ path: testInfo.outputPath('cancel-dialog-1440.png') });
  await dialog.getByRole('button', { name: 'Giữ bản nháp' }).click();
  await expect(dialog).toHaveCount(0);
  expect(cancels).toBe(0);

  await cancel.click();
  await dialog.getByRole('button', { name: 'Hủy bản nháp' }).click();
  await expect(page.locator('#ai-output')).toContainText('Đã hủy');
  await expect(page.locator('.toast-success')).toContainText('Đã hủy bản nháp.');
  expect(cancels).toBe(1);
  expect(nativeDialogs).toEqual([]);
});
