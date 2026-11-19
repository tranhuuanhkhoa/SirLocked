import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Trang Thử thách tuần: khối "Phần thưởng tuần này" (tỷ lệ rớt từng hòm, trạng thái của người xem, nhận hòm đang chờ).
 * Mocked API, no backend behind Vite: the page asks only /api/workshop/weekly/challenge{,/leaderboard,/reward,/reward/{id}/claim}.
 */
const DAY = 86_400_000;

/** The next Wednesday 00:00 UTC after now (= 07:00 Vietnam), the way the server closes a challenge week. */
function weekWindow() {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ahead = ((3 - new Date(midnight).getUTCDay() + 7) % 7) || 7;
  const end = midnight + ahead * DAY;
  return { weekStart: new Date(end - 7 * DAY).toISOString(), weekEnd: new Date(end).toISOString() };
}

const dropsOf = [
  { chestId: 'chest_np', name: 'Hòm Ngân Phiếu', nameEn: 'Banknote Chest', iconKey: 'chest_seal', look: null, percent: 60 },
  { chestId: 'chest_sm', name: 'Hòm Sắt Mòn', nameEn: 'Worn Iron Chest', iconKey: 'chest_lacquer', look: null, percent: 30 },
  { chestId: 'chest_nb', name: 'Két Nhà Băng', nameEn: 'Bank Safe', iconKey: 'chest_bank', look: null, percent: 10 },
];

const challengeBody = (drops: unknown[] = dropsOf) => ({
  type: 'CHALLENGE', caseId: 'case-weekly-1', caseTitle: 'Vụ án đêm mưa', summary: 'Một vụ án trong đêm mưa.', coverImageUrl: null,
  estimatedMinutes: 25, ...weekWindow(), weekKey: '2026-11-18', source: 'AUTO', minScore: 80, drops,
});

const drop = (id: string, state: 'PENDING' | 'WAITING' | 'DONE', extra: Record<string, unknown> = {}) => ({
  id, weekKey: '2026-11-18', chestId: 'chest_nb', chestName: 'Két Nhà Băng', chestNameEn: 'Bank Safe', iconKey: 'chest_bank', look: null,
  state, createdAt: '2026-11-19T01:00:00Z', ...extra,
});

type Reward = { weekKey: string; minScore: number; thisWeek: ReturnType<typeof drop> | null; waiting: ReturnType<typeof drop>[] };
const rewardOf = (thisWeek: Reward['thisWeek'], waiting: Reward['waiting'] = []): Reward =>
  ({ weekKey: '2026-11-18', minScore: 80, thisWeek, waiting });

type Server = {
  /** false: the week has no challenge (the server answers null). */
  hasChallenge: boolean;
  drops: unknown[];
  reward: Reward | null;
  /** One reply per claim, in order: the last one repeats. */
  claimReplies: Array<'ok' | 'full' | 'gone' | 'down'>;
  /** A reply (and a delay) for one drop id, ahead of the queue above. */
  claimById: Record<string, 'ok' | 'full' | 'gone' | 'down'>;
  claimDelayById: Record<string, number>;
  claims: string[];
  rewardCalls: number;
  claimDelayMs: number;
};

async function prepare(page: Page, { signedIn = true, language = 'vi', server = {} as Partial<Server> } = {}) {
  const state: Server = { hasChallenge: true, drops: dropsOf, reward: null, claimReplies: ['ok'], claimById: {}, claimDelayById: {}, claims: [], rewardCalls: 0, claimDelayMs: 0, ...server };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(({ signedIn, language }) => {
    // /workshop/challenge is a signed-in route, so a "guest" here is a token with no user record (session.user() is null).
    localStorage.setItem('sirlocked.token', 'weekly-reward-token');
    if (signedIn) {
      localStorage.setItem('sirlocked.user', JSON.stringify({
        userId: 'weekly-player', fullName: 'Weekly Detective', role: 'PLAYER', isEmailVerified: true,
      }));
    }
    localStorage.setItem('sirlocked.uiLanguage', language);
    (window as any).__sirlockedNoSignalR = true;
  }, { signedIn, language });

  const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/workshop/weekly/challenge') return ok(route, state.hasChallenge ? challengeBody(state.drops) : null);
    if (path === '/api/workshop/weekly/challenge/leaderboard') return ok(route, { metric: 'fastest', entries: [], totalRanked: 0 });
    if (path === '/api/workshop/weekly/challenge/reward') {
      state.rewardCalls++;
      return ok(route, state.reward);
    }
    const claim = /^\/api\/workshop\/weekly\/challenge\/reward\/([^/]+)\/claim$/.exec(path);
    if (claim && request.method() === 'POST') {
      const id = decodeURIComponent(claim[1]);
      state.claims.push(id);
      const delay = state.claimDelayById[id] ?? state.claimDelayMs;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const reply = state.claimById[id] ?? (state.claimReplies.length > 1 ? state.claimReplies.shift()! : state.claimReplies[0]);
      if (reply === 'down') return route.abort('connectionrefused');
      if (reply === 'full') {
        return route.fulfill({ status: 409, json: { success: false, message: 'Túi đầy.', errors: { code: 'SLOTS_FULL' } } });
      }
      if (reply === 'gone') {
        return route.fulfill({ status: 404, json: { success: false, message: 'Không có hòm.', errors: { code: 'WEEKLY_DROP_NOT_FOUND' } } });
      }
      return ok(route, drop(decodeURIComponent(claim[1]), 'DONE'));
    }
    return ok(route, null);
  });
  return state;
}

const box = (page: Page) => page.locator('[data-weekly-reward]');

test('a guest sees the three chests with their odds and the sign-in line, and no reward call is made', async ({ page }) => {
  const server = await prepare(page, { signedIn: false });
  await page.goto('/workshop/challenge');

  await expect(box(page).getByRole('heading', { name: 'Phần thưởng tuần này' })).toBeVisible();
  await expect(box(page)).toContainText('Đạt từ 80 điểm và phá được vụ: nhận 1 hòm (mỗi tuần 1 lần).');
  const rows = box(page).locator('[data-weekly-chest]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Hòm Ngân Phiếu');
  await expect(rows.nth(0)).toContainText('60%');
  await expect(rows.nth(1)).toContainText('30%');
  await expect(rows.nth(2)).toContainText('Két Nhà Băng');
  await expect(rows.nth(2)).toContainText('10%');
  // Each chest has its pixel icon (a data URL drawn by the shared chest sprites).
  await expect(rows.nth(0).locator('img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(box(page).getByText('Đăng nhập để nhận hòm')).toBeVisible();
  await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toHaveCount(0);
  await expect(box(page).getByRole('link', { name: 'Xem đồ trong hòm ở Kho Rương' })).toHaveAttribute('href', '/kho-ruong');
  expect(server.rewardCalls).toBe(0);
});

test('a signed-in player who already got this week\'s chest sees which one', async ({ page }) => {
  await prepare(page, { server: { reward: rewardOf(drop('drop-done', 'DONE')) } });
  await page.goto('/workshop/challenge');

  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Đã nhận: Két Nhà Băng');
  await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toHaveCount(0);
  await expect(box(page).getByText('Đăng nhập để nhận hòm')).toHaveCount(0);
});

test('a signed-in player with no chest yet sees "Chưa nhận"', async ({ page }) => {
  await prepare(page, { server: { reward: rewardOf(null) } });
  await page.goto('/workshop/challenge');

  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Chưa nhận');
  await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toHaveCount(0);
});

test('a chest still being handed over says so', async ({ page }) => {
  await prepare(page, { server: { reward: rewardOf(drop('drop-pending', 'PENDING')) } });
  await page.goto('/workshop/challenge');

  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Đang trao hòm: Két Nhà Băng…');
  await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toHaveCount(0);
});

test('a waiting chest is claimed with one click, once, and turns into "Đã nhận"', async ({ page }) => {
  const waiting = drop('drop-wait-1', 'WAITING');
  const server = await prepare(page, { server: { reward: rewardOf(waiting, [waiting]), claimDelayMs: 300 } });
  await page.goto('/workshop/challenge');

  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Túi đầy — dọn túi rồi bấm Nhận hòm');
  // This week's chest is in both thisWeek and waiting: one claim button, not two.
  const claim = box(page).getByRole('button', { name: 'Nhận hòm' });
  await expect(claim).toHaveCount(1);

  await claim.dblclick();
  await expect(box(page).locator('[data-weekly-drop="drop-wait-1"]').getByText('Đã nhận', { exact: true })).toBeVisible();
  await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toHaveCount(0);
  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Đã nhận: Két Nhà Băng');
  expect(server.claims).toEqual(['drop-wait-1']);
});

test('a bag that is still full says so and the claim can be tried again', async ({ page }) => {
  const waiting = drop('drop-wait-2', 'WAITING');
  const server = await prepare(page, { server: { reward: rewardOf(waiting, [waiting]), claimReplies: ['full', 'ok'] } });
  await page.goto('/workshop/challenge');

  const claim = box(page).getByRole('button', { name: 'Nhận hòm' });
  await claim.click();
  await expect(box(page).getByText('Túi vẫn đầy.')).toBeVisible();
  await expect(claim).toBeEnabled();
  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Túi đầy — dọn túi rồi bấm Nhận hòm');

  await claim.click();
  await expect(box(page).locator('[data-weekly-drop="drop-wait-2"]').getByText('Đã nhận', { exact: true })).toBeVisible();
  await expect(box(page).getByText('Túi vẫn đầy.')).toHaveCount(0);
  expect(server.claims).toEqual(['drop-wait-2', 'drop-wait-2']);
});

test('chests waiting from earlier weeks each get their own button and name their week', async ({ page }) => {
  const older = drop('drop-old', 'WAITING', { weekKey: '2026-11-11', chestName: 'Hòm Sắt Mòn', chestNameEn: 'Worn Iron Chest', chestId: 'chest_sm' });
  const server = await prepare(page, { server: { reward: rewardOf(null, [older]) } });
  await page.goto('/workshop/challenge');

  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Chưa nhận');
  const row = box(page).locator('[data-weekly-drop="drop-old"]');
  await expect(row).toContainText('Hòm Sắt Mòn');
  await expect(row).toContainText('2026-11-11');
  await row.getByRole('button', { name: 'Nhận hòm' }).click();
  await expect(row.getByText('Đã nhận', { exact: true })).toBeVisible();
  // It was last week's chest: this week's line stays as it was.
  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Chưa nhận');
  expect(server.claims).toEqual(['drop-old']);
});

test('a chest that is no longer there says so instead of failing silently', async ({ page }) => {
  const waiting = drop('drop-gone', 'WAITING');
  await prepare(page, { server: { reward: rewardOf(waiting, [waiting]), claimReplies: ['gone'] } });
  await page.goto('/workshop/challenge');

  await box(page).getByRole('button', { name: 'Nhận hòm' }).click();
  await expect(box(page).getByRole('alert')).toContainText('Không tìm thấy hòm này.');
  await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toBeEnabled();
});

test('a claim that is still on its way keeps its row when another chest is claimed meanwhile', async ({ page }) => {
  const first = drop('drop-a', 'WAITING', { chestName: 'Hòm Sắt Mòn', chestNameEn: 'Worn Iron Chest', chestId: 'chest_sm' });
  const second = drop('drop-b', 'WAITING', { weekKey: '2026-11-11' });
  const server = await prepare(page, {
    server: {
      reward: rewardOf(first, [first, second]),
      claimById: { 'drop-a': 'ok', 'drop-b': 'full' },
      // A is answered first (and repaints its row) while B is still on its way.
      claimDelayById: { 'drop-a': 400, 'drop-b': 1200 },
    },
  });
  await page.goto('/workshop/challenge');

  const rowA = box(page).locator('[data-weekly-drop="drop-a"]');
  const rowB = box(page).locator('[data-weekly-drop="drop-b"]');
  await rowA.getByRole('button', { name: 'Nhận hòm' }).click();
  await rowB.getByRole('button', { name: 'Nhận hòm' }).click();
  await expect(rowB.getByRole('button', { name: 'Nhận hòm' })).toBeDisabled();

  await expect(rowA.getByText('Đã nhận', { exact: true })).toBeVisible();
  // A is done and B is still waiting for its answer: B keeps its disabled button.
  await expect(rowB.getByRole('button', { name: 'Nhận hòm' })).toBeDisabled();
  // B's refusal reaches the live row: the message shows and the button works again.
  await expect(rowB.getByText('Túi vẫn đầy.')).toBeVisible();
  await expect(rowB.getByRole('button', { name: 'Nhận hòm' })).toBeEnabled();
  // The success of A did not wipe or strand anything else.
  await expect(rowA.getByText('Đã nhận', { exact: true })).toBeVisible();
  expect(server.claims).toEqual(['drop-a', 'drop-b']);
});

test('an error under one chest stays when another chest is claimed afterwards', async ({ page }) => {
  const first = drop('drop-a', 'WAITING', { chestName: 'Hòm Sắt Mòn', chestNameEn: 'Worn Iron Chest', chestId: 'chest_sm' });
  const second = drop('drop-b', 'WAITING', { weekKey: '2026-11-11' });
  await prepare(page, { server: { reward: rewardOf(first, [first, second]), claimById: { 'drop-a': 'ok', 'drop-b': 'full' } } });
  await page.goto('/workshop/challenge');

  const rowA = box(page).locator('[data-weekly-drop="drop-a"]');
  const rowB = box(page).locator('[data-weekly-drop="drop-b"]');
  await rowB.getByRole('button', { name: 'Nhận hòm' }).click();
  await expect(rowB.getByText('Túi vẫn đầy.')).toBeVisible();
  await rowA.getByRole('button', { name: 'Nhận hòm' }).click();
  await expect(rowA.getByText('Đã nhận', { exact: true })).toBeVisible();
  await expect(rowB.getByText('Túi vẫn đầy.')).toBeVisible();
  await expect(rowB.getByRole('button', { name: 'Nhận hòm' })).toBeEnabled();
});

test('a network failure is told in Vietnamese, not in the HTTP client\'s English', async ({ page }) => {
  const waiting = drop('drop-down', 'WAITING');
  await prepare(page, { server: { reward: rewardOf(waiting, [waiting]), claimReplies: ['down'] } });
  await page.goto('/workshop/challenge');

  await box(page).getByRole('button', { name: 'Nhận hòm' }).click();
  await expect(box(page).getByRole('alert')).toHaveText('Không kết nối được máy chủ, thử lại sau.');
  await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toBeEnabled();
});

test('in English a network failure says so in English', async ({ page }) => {
  const waiting = drop('drop-down-en', 'WAITING');
  await prepare(page, { language: 'en', server: { reward: rewardOf(waiting, [waiting]), claimReplies: ['down'] } });
  await page.goto('/workshop/challenge');

  await box(page).getByRole('button', { name: 'Claim chest' }).click();
  await expect(box(page).getByRole('alert')).toHaveText('Could not reach the server, please try again.');
});

test.describe('percent format follows the UI language', () => {
  const thirds = [
    { ...dropsOf[0], percent: 33.34 },
    { ...dropsOf[1], percent: 33.33 },
    { ...dropsOf[2], percent: 33.33 },
  ];

  test('Vietnamese: a comma before the decimals, whole numbers unchanged', async ({ page }) => {
    await prepare(page, { signedIn: false, server: { drops: [...thirds, { ...dropsOf[0], chestId: 'chest_whole', percent: 60 }] } });
    await page.goto('/workshop/challenge');

    const pct = box(page).locator('.bpa-ch-rw-pct');
    await expect(pct).toHaveText(['33,34%', '33,33%', '33,33%', '60%']);
  });

  test('English: a point before the decimals', async ({ page }) => {
    await prepare(page, { signedIn: false, language: 'en', server: { drops: [...thirds, { ...dropsOf[0], chestId: 'chest_whole', percent: 60 }] } });
    await page.goto('/workshop/challenge');

    const pct = box(page).locator('.bpa-ch-rw-pct');
    await expect(pct).toHaveText(['33.34%', '33.33%', '33.33%', '60%']);
  });
});

test('a week with no chest in the pool says so', async ({ page }) => {
  await prepare(page, { signedIn: false, server: { drops: [] } });
  await page.goto('/workshop/challenge');

  await expect(box(page)).toContainText('Tuần này chưa có hòm nào rớt.');
  await expect(box(page).locator('[data-weekly-chest]')).toHaveCount(0);
});

test('server names are shown as text, never as markup', async ({ page }) => {
  const hostile = '<img src=x onerror="window.__weeklyPwned=1">Hòm lạ';
  const drops = [{ ...dropsOf[0], name: hostile, nameEn: hostile }];
  const waiting = drop('drop-xss', 'WAITING', { chestName: hostile, chestNameEn: hostile });
  await prepare(page, { server: { drops, reward: rewardOf(waiting, [waiting]) } });
  await page.goto('/workshop/challenge');

  await expect(box(page).locator('[data-weekly-chest]')).toContainText(hostile);
  await expect(box(page).locator('[data-weekly-drop]')).toContainText(hostile);
  expect(await page.evaluate(() => (window as any).__weeklyPwned)).toBeUndefined();
  await expect(box(page).locator('img[src="x"]')).toHaveCount(0);
});

test('in English the box uses the English chest names and texts', async ({ page }) => {
  const waiting = drop('drop-en', 'WAITING');
  await prepare(page, { language: 'en', server: { reward: rewardOf(waiting, [waiting]), claimReplies: ['full'] } });
  await page.goto('/workshop/challenge');

  await expect(box(page).getByRole('heading', { name: 'This week\'s reward' })).toBeVisible();
  await expect(box(page)).toContainText('Score 80 or more and solve the case: get 1 chest (once a week).');
  await expect(box(page).locator('[data-weekly-chest]').nth(0)).toContainText('Banknote Chest');
  await expect(box(page).locator('[data-weekly-state]')).toHaveText('Bag full — clear some room, then press Claim chest');
  await expect(box(page).getByRole('link', { name: 'See what is inside the chests in the Chest Vault' })).toHaveAttribute('href', '/kho-ruong');
  await box(page).getByRole('button', { name: 'Claim chest' }).click();
  await expect(box(page).getByText('Your bag is still full.')).toBeVisible();
});

test.describe('a week with no challenge', () => {
  const blankMessage = (page: Page) => page.getByRole('heading', { name: /Hiện chưa có thử thách tuần nào/ });

  test('a chest still waiting can be claimed from the blank page, with no odds shown', async ({ page }) => {
    const older = drop('drop-old', 'WAITING', { weekKey: '2026-11-11', chestName: 'Hòm Sắt Mòn', chestNameEn: 'Worn Iron Chest', chestId: 'chest_sm' });
    const server = await prepare(page, { server: { hasChallenge: false, reward: rewardOf(null, [older]) } });
    await page.goto('/workshop/challenge');

    await expect(blankMessage(page)).toBeVisible();
    const row = box(page).locator('[data-weekly-drop="drop-old"]');
    await expect(row).toContainText('Hòm Sắt Mòn');
    await expect(row).toContainText('2026-11-11');
    const claim = row.getByRole('button', { name: 'Nhận hòm' });
    await expect(claim).toBeVisible();
    // No challenge, so no drop table and no odds.
    await expect(box(page).locator('[data-weekly-chest]')).toHaveCount(0);
    await expect(box(page)).not.toContainText('%');
    await expect(box(page)).not.toContainText('Tuần này chưa có hòm nào rớt.');

    await claim.click();
    await expect(row.getByText('Đã nhận', { exact: true })).toBeVisible();
    expect(server.claims).toEqual(['drop-old']);
  });

  test('a bag that is still full says so under the chest', async ({ page }) => {
    const older = drop('drop-old-full', 'WAITING', { weekKey: '2026-11-11' });
    const server = await prepare(page, { server: { hasChallenge: false, reward: rewardOf(null, [older]), claimReplies: ['full'] } });
    await page.goto('/workshop/challenge');

    await box(page).getByRole('button', { name: 'Nhận hòm' }).click();
    await expect(box(page).getByRole('alert')).toHaveText('Túi vẫn đầy.');
    await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toBeEnabled();
    expect(server.claims).toEqual(['drop-old-full']);
  });

  test('nothing waiting: only the blank page', async ({ page }) => {
    const server = await prepare(page, { server: { hasChallenge: false, reward: rewardOf(null, []) } });
    await page.goto('/workshop/challenge');

    await expect(blankMessage(page)).toBeVisible();
    await expect.poll(() => server.rewardCalls).toBe(1);
    await expect(box(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Nhận hòm' })).toHaveCount(0);
  });

  test('a guest gets the blank page and no reward call', async ({ page }) => {
    const server = await prepare(page, { signedIn: false, server: { hasChallenge: false } });
    await page.goto('/workshop/challenge');

    await expect(blankMessage(page)).toBeVisible();
    await expect(box(page)).toBeHidden();
    await expect(page.getByText('Đăng nhập để nhận hòm')).toHaveCount(0);
    expect(server.rewardCalls).toBe(0);
  });

  test('in English the waiting chest reads in English', async ({ page }) => {
    const older = drop('drop-old-en', 'WAITING', { weekKey: '2026-11-11' });
    await prepare(page, { language: 'en', server: { hasChallenge: false, reward: rewardOf(null, [older]) } });
    await page.goto('/workshop/challenge');

    await expect(box(page).locator('[data-weekly-drop="drop-old-en"]')).toContainText('Bank Safe');
    await expect(box(page).getByRole('button', { name: 'Claim chest' })).toBeVisible();
  });

  test('no sideways scroll at 390 px with a long chest name', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const longName = 'Hòm Siêu Dài Của Tuần Lễ Đặc Biệt Nhất Từ Trước Đến Nay Không Hề Ngắn';
    const waiting = [drop('drop-w-1', 'WAITING', { weekKey: '2026-11-11', chestName: longName }), drop('drop-w-2', 'WAITING', { weekKey: '2026-11-04' })];
    await prepare(page, { server: { hasChallenge: false, reward: rewardOf(null, waiting) } });
    await page.goto('/workshop/challenge');

    await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toHaveCount(2);
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-weekly-reward]') as HTMLElement;
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        box: el.scrollWidth - el.clientWidth,
        right: Math.round(el.getBoundingClientRect().right),
        width: window.innerWidth,
      };
    });
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.box).toBeLessThanOrEqual(0);
    expect(overflow.right).toBeLessThanOrEqual(overflow.width);
  });
});

test('the page still shows the case and the closing time (07:00 Vietnam time) next to the box', async ({ page }) => {
  await prepare(page, { signedIn: false });
  await page.goto('/workshop/challenge');

  await expect(page.locator('#ch-case-h')).toHaveText('Vụ án đêm mưa');
  await expect(page.locator('.bpa-ch-stand')).toContainText('Kết thúc');
  await expect(box(page)).toBeVisible();
});

test.describe('closing time in Vietnam', () => {
  test.use({ timezoneId: 'Asia/Ho_Chi_Minh' });

  test('the schedule reads 07:00', async ({ page }) => {
    await prepare(page, { signedIn: false });
    await page.goto('/workshop/challenge');
    await expect(page.locator('.bpa-ch-stand')).toContainText('07:00');
  });
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const signedIn of [false, true]) {
    test(`no sideways scroll at 390 px (${signedIn ? 'with waiting chests' : 'guest'})`, async ({ page }) => {
      const longName = 'Hòm Siêu Dài Của Tuần Lễ Đặc Biệt Nhất Từ Trước Đến Nay Không Hề Ngắn';
      const drops = dropsOf.map((entry, index) => (index === 0 ? { ...entry, name: longName } : entry));
      const waiting = [drop('drop-w-1', 'WAITING', { chestName: longName }), drop('drop-w-2', 'WAITING', { weekKey: '2026-11-11' })];
      await prepare(page, { signedIn, server: { drops, reward: rewardOf(waiting[0], waiting) } });
      await page.goto('/workshop/challenge');

      await expect(box(page)).toBeVisible();
      if (signedIn) await expect(box(page).getByRole('button', { name: 'Nhận hòm' })).toHaveCount(2);
      else await expect(box(page).getByText('Đăng nhập để nhận hòm')).toBeVisible();
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        box: (() => {
          const el = document.querySelector('[data-weekly-reward]') as HTMLElement;
          return el.scrollWidth - el.clientWidth;
        })(),
        right: Math.round((document.querySelector('[data-weekly-reward]') as HTMLElement).getBoundingClientRect().right),
        width: window.innerWidth,
      }));
      expect(overflow.doc).toBeLessThanOrEqual(0);
      expect(overflow.box).toBeLessThanOrEqual(0);
      expect(overflow.right).toBeLessThanOrEqual(overflow.width);
    });
  }
});
