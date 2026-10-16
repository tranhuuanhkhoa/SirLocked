import { expect, test, type Page } from '@playwright/test';

const player = { userId: 'invite-player', fullName: 'Invited Detective', email: 'detective@tests.invalid', role: 'PLAYER', isEmailVerified: true };
const auth = { token: 'invite-test-token', user: player };
const lobby = {
  roomId: 'invite-room', roomCode: 'ABC123', caseId: 'case-invite', caseTitle: 'The invitation case',
  hostUserId: player.userId, status: 'WAITING',
  players: [{ userId: player.userId, username: player.fullName, role: null, isReady: false, isConnected: true }],
};
const profile = {
  userId: player.userId, displayName: player.fullName, role: 'PLAYER', isEmailVerified: true, hasPassword: true,
  casesSolved: 0, casesPlayed: 0, successRate: 0, fastestSolveSeconds: null, creatorStats: null,
  rank: { tier: 'APPRENTICE', tierLabel: 'Tập sự', solved: 0, nextThreshold: 3, nextTierLabel: 'Thám tử', progressPercent: 0 },
};

async function setup(page: Page, signedIn = false) {
  await page.addInitScript(({ signedIn, auth }) => {
    localStorage.setItem('sirlocked.uiLanguage', 'en');
    if (signedIn) {
      localStorage.setItem('sirlocked.token', auth.token);
      localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    }
    (window as any).__sirlockedNoSignalR = true;
  }, { signedIn, auth });
  // No request may reach a local backend, running or not: it would reject the fixture token and end the session.
  // Every /api/ call nothing below mocks gets the dev proxy's "backend is down" answer. A predicate, not
  // **/api/**, so the modules under /Client/js/api/ still load. Later routes and page routes take precedence.
  await page.context().route((url) => url.pathname.startsWith('/api/'), (route) =>
    route.fulfill({ status: 502, contentType: 'text/plain', body: '' }));
  // The header asks for the profile and the lobby and case list for case details, for every tab.
  await page.context().route('**/api/profile/me', (route) => route.fulfill({ json: { success: true, data: profile } }));
  await page.context().route((url) => /^\/api\/cases\/(?!published$)[^/]+$/.test(url.pathname), (route) =>
    route.fulfill({ json: { success: true, data: {
      caseId: decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? ''),
      title: lobby.caseTitle, summary: '', estimatedMinutes: 10, sceneCount: 1, characterCount: 0, clueCount: 3, characters: [],
    } } }));
}

async function signIn(page: Page) {
  await page.route('**/api/auth/login', (route) => route.fulfill({ json: { success: true, data: auth } }));
  await page.locator('#form-login [name="email"]').fill(player.email);
  await page.locator('#form-login [name="password"]').fill('Fixture-password1');
  await page.locator('#form-login button[type="submit"]').click();
}

test('a logged-out invite survives login, prefills the code and joins only after confirmation', async ({ page, context }) => {
  await setup(page);
  let joins = 0;
  await page.route('**/api/rooms/join', async (route) => {
    joins += 1;
    expect(route.request().postDataJSON()).toEqual({ roomCode: 'ABC123' });
    await route.fulfill({ json: { success: true, data: lobby } });
  });
  await page.route('**/api/rooms/invite-room', (route) => route.fulfill({ json: { success: true, data: lobby } }));
  await page.goto('/#/join?code=abc123');
  await expect(page).toHaveURL(/#\/login$/);
  await signIn(page);
  await expect(page).toHaveURL(/#\/join\?code=ABC123$/);
  await expect(page.getByLabel('Room code', { exact: true })).toHaveValue('ABC123');
  expect(joins).toBe(0);
  await page.locator('#join-form button').click();
  await expect(page).toHaveURL(/#\/lobby\/invite-room$/);
  await expect(page.getByRole('heading', { name: 'Room Lobby' })).toBeVisible();
  expect(joins).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('sirlocked.pendingInvite'))).toBeNull();
  await expect(page.locator('#copy-code')).toBeVisible();
  const inviteUrl = new URL('/#/join?code=ABC123', page.url()).href;
  await expect(page.getByRole('textbox', { name: 'Invite your partner' })).toHaveValue(inviteUrl);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy invite link' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);
});

test('registration preserves the invite through email verification in another tab', async ({ page, context }) => {
  await setup(page);
  await page.route('**/api/auth/register', (route) => route.fulfill({ json: {
    success: true, data: { ...auth, user: { ...player, isEmailVerified: false } },
  } }));
  await context.route('**/api/auth/verify-email', (route) => route.fulfill({ json: { success: true, data: null } }));
  await page.goto('/#/join?code=ABC123');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.locator('#form-register [name="fullName"]').fill(player.fullName);
  await page.locator('#form-register [name="email"]').fill(player.email);
  await page.locator('#form-register [name="password"]').fill('Fixture-password1');
  await page.locator('#form-register button[type="submit"]').click();
  await expect(page).toHaveURL(/#\/verify-notice$/);
  await expect(page.locator('#saved-room-invite')).toBeVisible();

  const verification = await context.newPage();
  await verification.goto(new URL('/#/verify-email?token=fixture-verification', page.url()).href);
  const continueInvite = verification.getByRole('link', { name: 'Tiếp tục tới phòng được mời' });
  await expect(continueInvite).toHaveAttribute('href', '#/join?code=ABC123');
  await continueInvite.click();
  await expect(verification.getByLabel('Room code', { exact: true })).toHaveValue('ABC123');
  await verification.close();
});

test('stored destinations cannot redirect authentication outside the app', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem('sirlocked.pendingInvite', JSON.stringify({
    destination: 'https://untrusted.invalid/redirect', expiresAt: Date.now() + 60_000,
  })));
  await page.goto('/#/login');
  await signIn(page);
  await expect(page).toHaveURL(/#\/menu$/);
  await expect(page.locator('#title-menu-heading')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sirlocked.pendingInvite'))).toBeNull();
});

test('active room cards continue waiting rooms in the lobby and started games in gameplay', async ({ page }) => {
  await setup(page, true);
  await page.route('**/api/cases/published', (route) => route.fulfill({ json: { success: true, data: [] } }));
  await page.route('**/api/rooms/mine', (route) => route.fulfill({ json: { success: true, data: [
    lobby,
    { ...lobby, roomId: 'ready-room', status: 'READY' },
    { ...lobby, roomId: 'play-room', caseTitle: 'The ongoing case', status: 'IN_PROGRESS' },
    { ...lobby, roomId: 'finished-room', status: 'COMPLETED' },
  ] } }));
  await page.route('**/api/rooms/invite-room', (route) => route.fulfill({ json: { success: true, data: lobby } }));
  await page.route('**/api/game/rooms/play-room/state', (route) => route.fulfill({ status: 404,
    json: { success: false, message: 'Gameplay endpoint reached', errors: null },
  }));
  await page.goto('/#/cases');
  await expect(page.locator('[data-resume-room]')).toHaveCount(3);
  await expect(page.locator('[data-resume-room="ready-room"]')).toHaveAttribute('href', '#/lobby/ready-room');
  await page.locator('[data-resume-room="invite-room"]').click();
  await expect(page.getByRole('heading', { name: 'Room Lobby' })).toBeVisible();
  await page.locator('#nav-root a[href="#/cases"]').click();
  await page.locator('[data-resume-room="play-room"]').click();
  await expect(page).toHaveURL(/#\/game\/play-room$/);
  await expect(page.locator('#app')).toContainText('Gameplay endpoint reached');
});

for (const unavailable of [false, true]) {
  test(`published cases remain usable when active rooms are ${unavailable ? 'unavailable' : 'empty'}`, async ({ page }) => {
    await setup(page, true);
    await page.route('**/api/cases/published', (route) => route.fulfill({ json: { success: true, data: [{
      caseId: 'case-browse', title: 'A browseable case', summary: 'An available investigation',
      estimatedMinutes: 10, sceneCount: 1, characterCount: 1, clueCount: 3,
    }] } }));
    await page.route('**/api/rooms/mine', (route) => unavailable
      ? route.fulfill({ status: 503, json: { success: false, message: 'Unavailable' } })
      : route.fulfill({ json: { success: true, data: [] } }));
    await page.goto('/#/cases');
    await expect(page.locator('[data-case="case-browse"]')).toContainText('A browseable case');
    await expect(page.locator('#active-rooms-list')).toContainText(unavailable ? 'could not be loaded' : 'No active rooms');
    await expect(page.locator('#app a[href="#/join"]')).toBeVisible();
    await expect(page.locator('[data-create="case-browse"]')).toBeEnabled();
  });
}
