import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Trang kết quả: một dòng báo hòm Thử thách tuần theo từng trường hợp (status của GET .../challenge/reward/{roomId}).
 * Mocked API, no backend behind Vite: the page asks /api/game/rooms/{id}/result, /api/market/rewards/{id} and the
 * weekly reward of the room; everything else gets an empty success.
 */
const ROOM_ID = 'room-weekly-1';
const WEEKLY_PATH = `/api/workshop/weekly/challenge/reward/${ROOM_ID}`;
const TUTORIAL_CASE_ID = 'case-pixel-tan-thu-vi';
const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

const dropOf = (state: 'PENDING' | 'WAITING' | 'DONE', extra: Record<string, unknown> = {}) => ({
  id: 'drop-1', weekKey: '2026-11-18', chestId: 'chest_nb', chestName: 'Két Nhà Băng', chestNameEn: 'Bank Safe', iconKey: 'chest_bank',
  look: null, state, createdAt: '2026-11-19T01:00:00Z', ...extra,
});

type Server = {
  /** The reply of the weekly reward endpoint: a status body, or 'error' (500) / 'down' (connection refused). */
  weekly: { status: string; drop?: unknown; minScore?: number } | 'error' | 'down';
  /** Fields merged over the result body (caseId, isPlaytest, ...). */
  result: Record<string, unknown>;
};

async function prepare(page: Page, { language = 'vi', server = {} as Partial<Server> } = {}) {
  const state: Server = { weekly: { status: 'NOT_CHALLENGE', drop: null, minScore: 80 }, result: {}, ...server };
  const seen = { weeklyUrls: [] as string[], marketReads: 0 };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((language) => {
    localStorage.setItem('sirlocked.uiLanguage', language);
    localStorage.setItem('sirlocked.token', 'weekly-drop-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'weekly-player', fullName: 'Weekly Detective', role: 'PLAYER', isEmailVerified: true,
    }));
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, language);

  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/game/rooms/${ROOM_ID}/result`) {
      return ok(route, {
        roomId: ROOM_ID, caseId: 'case-weekly-1', caseTitle: 'Vụ án đêm mưa', success: true,
        selectedCulpritId: 'c1', selectedCulpritName: 'Bà Tư', correctCulpritId: 'c1', correctCulpritName: 'Bà Tư',
        ending: 'Chiếc ô đã về với chủ.', selectedEvidenceIds: [], requiredEvidenceIds: [], evidenceResults: [],
        completedAt: '2026-11-19T09:00:00Z', ...state.result,
      });
    }
    if (url.pathname === `/api/market/rewards/${ROOM_ID}`) {
      seen.marketReads++;
      return ok(route, null);
    }
    if (url.pathname.startsWith('/api/workshop/weekly/challenge/reward/')) {
      seen.weeklyUrls.push(url.pathname);
      if (state.weekly === 'down') return route.abort('connectionrefused');
      if (state.weekly === 'error') return route.fulfill({ status: 500, json: { success: false, message: 'Lỗi máy chủ.' } });
      return ok(route, state.weekly);
    }
    return ok(route, null);
  });
  return seen;
}

const notice = (page: Page) => page.locator('[data-weekly-drop]');

async function openResult(page: Page) {
  await page.goto(`/result/${ROOM_ID}`);
  await expect(page.locator('.bpa-result-foot')).toBeVisible();
}

test('GRANTED: the chest is named and a button leads to the Kho Rương', async ({ page }) => {
  const seen = await prepare(page, { server: { weekly: { status: 'GRANTED', drop: dropOf('DONE'), minScore: 80 } } });
  await openResult(page);

  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toContainText('Thử thách tuần: bạn nhận được Két Nhà Băng!');
  const open = notice(page).getByRole('link', { name: 'Mở ở Kho Rương' });
  await expect(open).toHaveAttribute('href', '/kho-ruong');
  // One button only: the key shop and the held chests are both on /kho-ruong.
  await expect(notice(page).locator('a')).toHaveCount(1);
  expect(seen.weeklyUrls).toEqual([WEEKLY_PATH]);
});

/** The chest's picture in the notice: the shared pixel sprite (a data URL), named by the chest. */
async function expectChestPicture(page: Page, alt: string) {
  const picture = notice(page).locator('img');
  await expect(picture).toHaveCount(1);
  await expect(picture).toHaveAttribute('alt', alt);
  await expect(picture).toHaveAttribute('src', /^data:image\/png/);
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const box = await picture.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(48);
  expect(box!.height).toBeLessThanOrEqual(48);
}

test('GRANTED: the notice shows the chest picture, named by the chest', async ({ page }) => {
  await prepare(page, { server: { weekly: { status: 'GRANTED', drop: dropOf('DONE'), minScore: 80 } } });
  await openResult(page);

  await expect(notice(page)).toBeVisible();
  await expectChestPicture(page, 'Két Nhà Băng');
});

test('GRANTED with no drop says "a chest" and shows no picture', async ({ page }) => {
  await prepare(page, { server: { weekly: { status: 'GRANTED', drop: null, minScore: 80 } } });
  await openResult(page);

  await expect(notice(page)).toContainText('Thử thách tuần: bạn nhận được một hòm!');
  await expect(notice(page).locator('img')).toHaveCount(0);
  await expect(notice(page).getByRole('link', { name: 'Mở ở Kho Rương' })).toBeVisible();
});

test('a chest whose icon cannot be drawn keeps the line and shows no picture', async ({ page }) => {
  await prepare(page, { server: { weekly: { status: 'GRANTED', drop: dropOf('DONE', { iconKey: '' }), minScore: 80 } } });
  await page.addInitScript(() => {
    // No canvas: every sprite comes back empty, as on a browser that blocks canvas reads.
    HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('blocked'); };
  });
  await openResult(page);

  await expect(notice(page)).toContainText('Thử thách tuần: bạn nhận được Két Nhà Băng!');
  await expect(notice(page).locator('img')).toHaveCount(0);
});

test('WAITING: a full bag says the chest waits on the Thử thách tuần page and links there', async ({ page }) => {
  const seen = await prepare(page, { server: { weekly: { status: 'WAITING', drop: dropOf('WAITING'), minScore: 80 } } });
  await openResult(page);

  await expect(notice(page)).toContainText('Thử thách tuần: túi đầy, Két Nhà Băng đang chờ ở trang Thử thách tuần.');
  await expect(notice(page).getByRole('link', { name: 'trang Thử thách tuần' })).toHaveAttribute('href', '/workshop/challenge');
  await expect(notice(page).getByRole('link', { name: 'Mở ở Kho Rương' })).toHaveCount(0);
  await expectChestPicture(page, 'Két Nhà Băng');
  expect(seen.weeklyUrls).toEqual([WEEKLY_PATH]);
});

test('WAITING with no drop shows no picture', async ({ page }) => {
  await prepare(page, { server: { weekly: { status: 'WAITING', drop: null, minScore: 80 } } });
  await openResult(page);

  await expect(notice(page)).toContainText('Thử thách tuần: túi đầy, một hòm đang chờ ở trang Thử thách tuần.');
  await expect(notice(page).locator('img')).toHaveCount(0);
});

const plainCases: Array<{ status: string; minScore?: number; text: string }> = [
  { status: 'LOW_SCORE', minScore: 85, text: 'Cần 85 điểm để nhận hòm Thử thách tuần.' },
  { status: 'NOT_SOLVED', text: 'Phải phá được vụ mới nhận hòm Thử thách tuần.' },
  { status: 'UNVERIFIED', text: 'Xác minh email để nhận hòm Thử thách tuần.' },
  { status: 'AUTHOR', text: 'Tác giả không nhận hòm từ vụ của mình.' },
  { status: 'ALREADY_THIS_WEEK', text: 'Bạn đã nhận hòm Thử thách tuần này.' },
];
for (const { status, minScore, text } of plainCases) {
  test(`${status}: says why there is no chest, with no link`, async ({ page }) => {
    const seen = await prepare(page, { server: { weekly: { status, drop: null, minScore: minScore ?? 80 } } });
    await openResult(page);

    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toHaveText(text);
    await expect(notice(page).locator('a')).toHaveCount(0);
    expect(seen.weeklyUrls).toEqual([WEEKLY_PATH]);
  });
}

for (const status of ['NOT_CHALLENGE', 'NO_CHEST']) {
  test(`${status}: the line stays hidden`, async ({ page }) => {
    const seen = await prepare(page, { server: { weekly: { status, drop: null, minScore: 80 } } });
    await openResult(page);

    await expect.poll(() => seen.weeklyUrls.length).toBe(1);
    await expect(notice(page)).toBeHidden();
    await expect(notice(page)).toHaveAttribute('hidden', '');
    await expect(notice(page)).toBeEmpty();
  });
}

const englishCases: Array<{ status: string; drop: unknown; text: string; link?: [string, string] }> = [
  { status: 'GRANTED', drop: dropOf('DONE'), text: 'Weekly Challenge: you got Bank Safe!', link: ['Open in the Chest Vault', '/kho-ruong'] },
  { status: 'WAITING', drop: dropOf('WAITING'), text: 'Weekly Challenge: your bag is full, Bank Safe is waiting on the Weekly Challenge page.', link: ['the Weekly Challenge page', '/workshop/challenge'] },
  { status: 'LOW_SCORE', drop: null, text: 'You need 80 points to get the Weekly Challenge chest.' },
  { status: 'NOT_SOLVED', drop: null, text: 'Solve the case to get the Weekly Challenge chest.' },
  { status: 'UNVERIFIED', drop: null, text: 'Verify your email to get the Weekly Challenge chest.' },
  { status: 'AUTHOR', drop: null, text: 'Authors do not get a chest from their own case.' },
  { status: 'ALREADY_THIS_WEEK', drop: null, text: "You already got this week's Weekly Challenge chest." },
];
for (const { status, drop, text, link } of englishCases) {
  test(`English twin of ${status}`, async ({ page }) => {
    await prepare(page, { language: 'en', server: { weekly: { status, drop, minScore: 80 } } });
    await openResult(page);

    await expect(notice(page)).toContainText(text);
    if (link) await expect(notice(page).getByRole('link', { name: link[0] })).toHaveAttribute('href', link[1]);
    else await expect(notice(page).locator('a')).toHaveCount(0);
    // The picture is named in the viewer's language.
    if (drop) await expect(notice(page).locator('img')).toHaveAttribute('alt', 'Bank Safe');
    else await expect(notice(page).locator('img')).toHaveCount(0);
  });
}

test('the tutorial case never asks for a weekly chest', async ({ page }) => {
  const seen = await prepare(page, { server: { result: { caseId: TUTORIAL_CASE_ID }, weekly: { status: 'GRANTED', drop: dropOf('DONE'), minScore: 80 } } });
  await openResult(page);

  // The coin reward is asked for in the same tick as the weekly one would be.
  await expect.poll(() => seen.marketReads).toBe(1);
  await expect(notice(page)).toBeHidden();
  expect(seen.weeklyUrls).toEqual([]);
});

test('a playtest of a draft never asks for a weekly chest', async ({ page }) => {
  const seen = await prepare(page, { server: { result: { isPlaytest: true }, weekly: { status: 'GRANTED', drop: dropOf('DONE'), minScore: 80 } } });
  await openResult(page);

  await expect(page.locator('[data-playtest-note]')).toBeVisible();
  await expect(notice(page)).toBeHidden();
  expect(seen.weeklyUrls).toEqual([]);
});

for (const failure of ['error', 'down'] as const) {
  test(`a failing reward call (${failure}) leaves the result page whole and the line hidden`, async ({ page }) => {
    const seen = await prepare(page, { server: { weekly: failure } });
    await openResult(page);

    await expect.poll(() => seen.weeklyUrls.length).toBe(1);
    await expect(notice(page)).toBeHidden();
    await expect(page.locator('.toast-error')).toHaveCount(0);
    await expect(page.locator('.bpa-result-headline')).toBeVisible();
  });
}

test('a chest name from the server is shown as text, not as markup', async ({ page }) => {
  await prepare(page, { server: { weekly: { status: 'GRANTED', drop: dropOf('DONE', { chestName: '<img src=x onerror="window.__xss=1">Hòm', chestNameEn: '' }), minScore: 80 } } });
  await openResult(page);

  await expect(notice(page)).toContainText('<img src=x onerror="window.__xss=1">Hòm');
  // The only picture is the chest's own, and the name sits in its alt as plain text.
  await expect(notice(page).locator('img')).toHaveCount(1);
  await expect(notice(page).locator('img[src="x"]')).toHaveCount(0);
  await expect(notice(page).locator('img')).toHaveAttribute('alt', '<img src=x onerror="window.__xss=1">Hòm');
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

for (const [label, width, height] of [['phone', 360, 740], ['small phone', 320, 640]] as const) {
  test(`on a ${label} the line wraps and the page does not scroll sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const longName = 'Két Nhà Băng Của Vị Thám Tử Siêu Dài Tên Để Thử Xuống Dòng';
    await prepare(page, { server: { weekly: { status: 'WAITING', drop: dropOf('WAITING', { chestName: longName }), minScore: 80 } } });
    await openResult(page);

    await expect(notice(page)).toContainText(longName);
    const box = await notice(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  });
}
