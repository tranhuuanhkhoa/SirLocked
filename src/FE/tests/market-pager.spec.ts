import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Chợ đồ, tab MUA: the ledger comes one page at a time. The mocked server cuts the list like the real one
 * (filter, then page, a page past the end answers with the last page) and records what the page asked for.
 */
const def = (index: number, category = 'CURIO') => {
  const name = `Món số ${String(index).padStart(2, '0')}`;
  return {
    id: `item_${index}`, category, rarity: 'COMMON', name, nameEn: `Item ${index}`, description: `${name}.`, descriptionEn: `Item ${index}.`,
    referencePrice: 100 + index, iconKey: 'watch',
  };
};

// 30 curios and 5 frames: three pages in "All", one in "Frame".
const DEFS = [...Array.from({ length: 30 }, (_, i) => def(i + 1)), ...Array.from({ length: 5 }, (_, i) => def(31 + i, 'FRAME'))];

const row = (entry: ReturnType<typeof def>) => ({
  def: entry, listedCount: 1, lowestAsk: entry.referencePrice, highestBid: null, bidCount: 0, spark10: [], changePercent: null, volume30: 0,
});

const detailOf = (entry: ReturnType<typeof def>) => ({
  def: entry, listedCount: 0, lowestAsk: null, bidCount: 0, highestBid: null, listings: [], bids: [],
  history: { days: [], line: [], low: null, high: null, changePercent: null, volume: 0 }, myListings: [], myOrders: [], ownedCount: 0,
});

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });

type Asked = { page: string | null; pageSize: string | null; category: string | null; q: string | null };

async function prepare(page: Page, { paged = true } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'market-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'market-player', fullName: 'Market Detective', role: 'PLAYER', isEmailVerified: true,
    }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  const asked: Asked[] = [];
  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
  await page.route('**/api/market/me', (route) => ok(route, {
    balance: 500, held: 0, slotsUsed: 0, slotCap: 12, itemCount: 0, reservedSlots: 0, feePercent: 5,
  }));
  await page.route('**/api/market/items/*', (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
    return ok(route, detailOf(DEFS.find((entry) => entry.id === id) || DEFS[0]));
  });
  await page.route('**/api/market/items?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push({ page: params.get('page'), pageSize: params.get('pageSize'), category: params.get('category'), q: params.get('q') });
    const q = (params.get('q') || '').toLowerCase();
    const searched = DEFS.filter((entry) => !q || entry.name.toLowerCase().includes(q));
    const category = params.get('category');
    const matches = category ? searched.filter((entry) => entry.category === category) : searched;
    const categoryCounts = { CURIO: searched.filter((e) => e.category === 'CURIO').length, FRAME: searched.filter((e) => e.category === 'FRAME').length };
    if (!paged) return ok(route, { rows: matches.map(row), categoryCounts, totalCount: searched.length });
    const size = Number(params.get('pageSize'));
    const last = Math.max(1, Math.ceil(matches.length / size));
    const current = Math.min(Math.max(1, Number(params.get('page')) || 1), last);
    return ok(route, {
      rows: matches.slice((current - 1) * size, current * size).map(row),
      categoryCounts, totalCount: searched.length, matchCount: matches.length, page: current, pageSize: size,
    });
  });
  return asked;
}

const rows = (page: Page) => page.locator('#mk-rows .bpa-mk-row');
const pager = (page: Page) => page.locator('#mk-pager');

test('the ledger shows 12 rows per page and the pager turns pages on the server', async ({ page }) => {
  const asked = await prepare(page);
  await page.goto('/market');

  await expect(rows(page)).toHaveCount(12);
  await expect(rows(page).first()).toContainText('Món số 01');
  await expect(pager(page)).toBeVisible();
  await expect(page.locator('#mk-pageinfo')).toHaveText('1–12 trên 35 vật phẩm');
  await expect(pager(page).getByRole('button', { name: 'Trang 1' })).toHaveAttribute('aria-current', 'page');
  await expect(pager(page).getByRole('button', { name: 'Trang trước' })).toBeDisabled();
  expect(asked.at(-1)).toMatchObject({ page: '1', pageSize: '12' });
  // The first row is opened in the detail.
  await expect(page.locator('#mk-detail')).toContainText('Món số 01');

  await pager(page).getByRole('button', { name: 'Trang sau' }).click();
  await expect(rows(page).first()).toContainText('Món số 13');
  await expect(rows(page)).toHaveCount(12);
  await expect(page.locator('#mk-pageinfo')).toHaveText('13–24 trên 35 vật phẩm');
  expect(asked.at(-1)).toMatchObject({ page: '2', pageSize: '12' });
  // Turning a page keeps what the detail shows, and the focus stays on the pager.
  await expect(page.locator('#mk-detail')).toContainText('Món số 01');
  await expect(pager(page).getByRole('button', { name: 'Trang sau' })).toBeFocused();

  await pager(page).getByRole('button', { name: 'Trang 3' }).click();
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator('#mk-pageinfo')).toHaveText('25–35 trên 35 vật phẩm');
  await expect(pager(page).getByRole('button', { name: 'Trang sau' })).toBeDisabled();

  // Picking a row of this page opens it.
  await rows(page).filter({ hasText: 'Món số 30' }).click();
  await expect(page.locator('#mk-detail')).toContainText('Món số 30');
  await expect(rows(page).filter({ hasText: 'Món số 30' })).toHaveAttribute('aria-pressed', 'true');
});

test('a new category, search or sort starts again from page 1', async ({ page }) => {
  const asked = await prepare(page);
  await page.goto('/market');
  await pager(page).getByRole('button', { name: 'Trang 3' }).click();
  await expect(page.locator('#mk-pageinfo')).toHaveText('25–35 trên 35 vật phẩm');

  await page.locator('#mk-sort').selectOption('name');
  await expect(page.locator('#mk-pageinfo')).toHaveText('1–12 trên 35 vật phẩm');
  expect(asked.at(-1)).toMatchObject({ page: '1' });

  await pager(page).getByRole('button', { name: 'Trang 2' }).click();
  await expect(page.locator('#mk-pageinfo')).toHaveText('13–24 trên 35 vật phẩm');
  await page.locator('#mk-cats [data-category="FRAME"]').click();
  await expect(rows(page)).toHaveCount(5);
  expect(asked.at(-1)).toMatchObject({ page: '1', category: 'FRAME' });
  // One page only: no pager.
  await expect(pager(page)).toBeHidden();

  await page.locator('#mk-cats [data-category=""]').click();
  await pager(page).getByRole('button', { name: 'Trang 2' }).click();
  await expect(page.locator('#mk-pageinfo')).toHaveText('13–24 trên 35 vật phẩm');
  await page.locator('#mk-q').fill('số 1');
  await expect(rows(page)).toHaveCount(10);
  expect(asked.at(-1)).toMatchObject({ page: '1', q: 'số 1' });
  await expect(pager(page)).toBeHidden();
  // The search moved the detail to its first match.
  await expect(page.locator('#mk-detail')).toContainText('Món số 10');
});

test('the page comes back from the other tabs as it was', async ({ page }) => {
  await prepare(page);
  await page.goto('/market');
  await pager(page).getByRole('button', { name: 'Trang 2' }).click();
  await expect(rows(page).first()).toContainText('Món số 13');
  await page.getByRole('tab', { name: 'LỆNH CỦA TÔI' }).click();
  await page.getByRole('tab', { name: 'MUA' }).click();
  await expect(rows(page).first()).toContainText('Món số 13');
  await expect(pager(page).getByRole('button', { name: 'Trang 2' })).toHaveAttribute('aria-current', 'page');
});

test('a server without paging fields shows every row and no pager', async ({ page }) => {
  await prepare(page, { paged: false });
  await page.goto('/market');
  await expect(rows(page)).toHaveCount(35);
  await expect(pager(page)).toBeHidden();
});

test('pageList keeps first, last, current and neighbours and never hides a single page', async ({ page }) => {
  await page.goto('/login');
  const lists = await page.evaluate(async () => {
    const { pageList } = await import('/Client/js/pages/market/buyTab.js' as string);
    return {
      small: pageList(2, 7),
      start: pageList(1, 10),
      four: pageList(4, 10),
      middle: pageList(5, 10),
      end: pageList(10, 10),
      phoneMiddle: pageList(5, 10, 0),
      phoneStart: pageList(3, 10, 0),
      phoneSmall: pageList(1, 5, 0),
    };
  });
  expect(lists.small).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(lists.start).toEqual([1, 2, 3, 4, 5, null, 10]);
  expect(lists.four).toEqual([1, 2, 3, 4, 5, null, 10]);
  expect(lists.middle).toEqual([1, null, 4, 5, 6, null, 10]);
  expect(lists.end).toEqual([1, null, 6, 7, 8, 9, 10]);
  expect(lists.phoneMiddle).toEqual([1, null, 5, null, 10]);
  expect(lists.phoneStart).toEqual([1, 2, 3, null, 10]);
  expect(lists.phoneSmall).toEqual([1, 2, 3, 4, 5]);
});

test('on a phone the pager fits the width with 44 px buttons', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await prepare(page);
  await page.goto('/market');
  await expect(pager(page)).toBeVisible();
  await pager(page).getByRole('button', { name: 'Trang 2' }).click();
  await expect(page.locator('#mk-pageinfo')).toHaveText('13–24 trên 35 vật phẩm');
  const box = await pager(page).getByRole('button', { name: 'Trang 2' }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  const pagerBox = await page.locator('#mk-pages').boundingBox();
  expect((pagerBox?.x ?? 0) + (pagerBox?.width ?? 0)).toBeLessThanOrEqual(375 - 16);
  // Wait for the route's lens transition before measuring the page width.
  await expect(page.locator('.bpa-rim')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
