import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Mở hòm (/kho-ruong) with a mocked API. Reduced motion keeps the chest sequence short; the
 * rules under test do not depend on it: the server alone decides the result, the reel only stops
 * once that result is known, a retry reuses the idempotency key, and leaving the page stops everything.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const def = (id: string, name: string, rarity: string, iconKey: string, category = 'CURIO') => ({
  id, category, rarity, name, nameEn: name, description: `${name}.`, descriptionEn: `${name}.`, referencePrice: 100, iconKey,
});

const WATCH = def('VC-0217', 'Đồng hồ 2:17', 'MYSTERY', 'watch');
const NOTEBOOK = def('VC-0388', 'Sổ tay da bò', 'COMMON', 'notebook');
const CONTENTS = [
  NOTEBOOK, def('VC-0402', 'Phiếu vân tay', 'COMMON', 'fingerprint'), def('VC-0391', 'Đèn bão', 'RARE', 'lantern'),
  def('VC-0405', 'Huy hiệu sở', 'EPIC', 'badge'), def('VC-0430', 'Trâm hồng ngọc', 'LEGENDARY', 'hairpin'), WATCH,
];
const ODDS = [
  { rarity: 'COMMON', percent: 79.92 }, { rarity: 'RARE', percent: 15.98 }, { rarity: 'EPIC', percent: 3.2 },
  { rarity: 'LEGENDARY', percent: 0.64 }, { rarity: 'MYSTERY', percent: 0.26 },
];

type Counts = { chests: number; keys: number; balance: number };

const wallet = (counts: Counts) => ({
  balance: counts.balance, held: 0, slotsUsed: 5, slotCap: 12, itemCount: 5, reservedSlots: 0, feePercent: 5,
});

function listBody(counts: Counts, odds = ODDS) {
  const chest = (id: string, name: string, sub: string, keyName: string, iconKey: string, keyIconKey: string, chestPrice: number, keyPrice: number, own: boolean) => ({
    id, keyDefId: id.replace('chest', 'key'), name, nameEn: name, subtitle: sub, subtitleEn: sub, keyName, keyNameEn: keyName,
    iconKey, keyIconKey, chestPrice, keyPrice, chestCount: own ? counts.chests : 0, keyCount: own ? counts.keys : 0, contents: CONTENTS,
  });
  return {
    chests: [
      chest('chest_np', 'Hòm Niêm Phong', 'Bến Sương · Nº 07', 'chìa kính lúp', 'chest_seal', 'key_loupe', 120, 180, true),
      chest('chest_nb', 'Két Nhà Băng', 'Phố Tràng Tiền · Nº 12', 'chìa bánh răng', 'chest_bank', 'key_gear', 170, 250, false),
      chest('chest_sm', 'Tráp Sơn Mài', 'Phố Hàng Bạc · Nº 03', 'chìa ngọc bích', 'chest_lacquer', 'key_jade', 140, 210, false),
    ],
    odds,
    wallet: wallet(counts),
  };
}

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
const fail = (route: Route, status: number, code: string) =>
  route.fulfill({ status, json: { success: false, message: code, errors: { code, messageKey: `market.${code}` } } });

async function prepare(page: Page, counts: Counts, odds = ODDS) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'chest-test-token');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'chest-player', fullName: 'Chest Detective', role: 'PLAYER', isEmailVerified: true,
    }));
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    (window as any).__sirlockedNoSignalR = true;
  });
  const lists = { count: 0 };
  // Only the API: a glob like **/api/** would also swallow the Vite modules under Client/js/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => ok(route, null));
  await page.route('**/api/market/me', (route) => ok(route, wallet(counts)));
  await page.route('**/api/chests', (route) => { lists.count++; return ok(route, listBody(counts, odds)); });
  return lists;
}

const openResult = (counts: Counts, item = WATCH, itemId = 'reward-1') =>
  ({ chestId: 'chest_np', itemId, item, chestCount: counts.chests, keyCount: counts.keys, wallet: wallet(counts) });

const appMode = (page: Page) => page.locator('.qh-app');

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('the nav link sits next to Chợ đồ and the page shows what the API sends', async ({ page }) => {
  // These odds differ from the mock-up on purpose: the page must not carry its own copy.
  const customOdds = [{ rarity: 'COMMON', percent: 50.5 }, { rarity: 'MYSTERY', percent: 49.5 }];
  await prepare(page, { chests: 5, keys: 3, balance: 900 }, customOdds);
  const errors = collectPageErrors(page);
  await page.goto('/kho-ruong');

  const links = page.locator('#nav-root .bpa-shell-nav > a.bpa-shell-link');
  const labels = (await links.allInnerTexts()).map((text) => text.trim().toLocaleLowerCase('vi'));
  expect(labels.indexOf('mở hòm')).toBe(labels.indexOf('chợ đồ') + 1);
  await expect(page.locator('#nav-root a[href="/kho-ruong"]')).toHaveAttribute('aria-current', 'page');

  await expect(page.locator('#qh-caseName')).toHaveText('Hòm Niêm Phong');
  await expect(page.locator('#qh-nChest')).toHaveText('×5');
  await expect(page.locator('#qh-nKey')).toHaveText('3');
  await expect(page.locator('#qh-nCoin')).toHaveText('900');
  await expect(page.locator('#qh-contents .qh-it')).toHaveCount(CONTENTS.length);
  await expect(page.locator('#qh-contents .qh-it').first()).toContainText('Đồng hồ 2:17');

  await page.locator('#qh-oddsBtn').click();
  await expect(page.locator('#qh-odds')).toContainText('50,50%');
  await expect(page.locator('#qh-odds')).toContainText('49,50%');
  await expect(page.locator('#qh-odds')).not.toContainText('79,92%');

  await page.locator('#qh-nextBtn').click();
  await expect(page.locator('#qh-caseName')).toHaveText('Két Nhà Băng');
  await expect(page.locator('#qh-openLbl')).toContainText('Mua hòm');
  await expect(page.locator('#qh-openLbl')).toContainText('170');
  expect(errors).toEqual([]);
});

test('one click opens one chest: the reel keeps spinning until the server answers, then lands on its item', async ({ page }) => {
  const counts = { chests: 2, keys: 2, balance: 500 };
  await prepare(page, counts);
  const errors = collectPageErrors(page);
  const bodies: Array<{ idempotencyKey: string }> = [];
  let release!: () => void;
  const answer = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/chests/chest_np/open', async (route) => {
    bodies.push(route.request().postDataJSON());
    await answer;
    await ok(route, openResult({ ...counts, chests: 1, keys: 1 }));
  });
  await page.goto('/kho-ruong');
  await expect(page.locator('#qh-openLbl')).toHaveText('Mở');

  await page.locator('#qh-openBtn').dblclick();
  await expect(appMode(page)).toHaveAttribute('data-mode', 'spin');
  // Without an answer the reel never stops, however long it takes.
  await page.waitForTimeout(2500);
  await expect(appMode(page)).toHaveAttribute('data-mode', 'spin');
  await page.locator('#qh-skipBtn').click();
  await page.locator('.qh-stage').click({ force: true });
  await page.waitForTimeout(300);
  await expect(appMode(page)).toHaveAttribute('data-mode', 'spin');
  expect(bodies).toHaveLength(1);
  expect(bodies[0].idempotencyKey).toMatch(UUID);

  release();
  await expect(appMode(page)).toHaveAttribute('data-mode', 'reveal', { timeout: 15_000 });
  await expect(page.locator('#qh-gotName')).toHaveText('Đồng hồ 2:17');
  await expect(page.locator('#qh-gotRar')).toHaveText('Bí ẩn');
  expect(bodies).toHaveLength(1);

  await page.locator('#qh-keepBtn').click();
  await expect(appMode(page)).toHaveAttribute('data-mode', 'idle');
  // The numbers come from the server's answer, nothing was counted locally.
  await expect(page.locator('#qh-nChest')).toHaveText('×1');
  await expect(page.locator('#qh-nKey')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('a flaky connection retries with the same idempotency key and still gets the one result', async ({ page }) => {
  const counts = { chests: 1, keys: 1, balance: 500 };
  await prepare(page, counts);
  const keys: string[] = [];
  await page.route('**/api/chests/chest_np/open', async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (keys.length === 1) return route.abort('connectionreset');
    if (keys.length === 2) return route.fulfill({ status: 503, body: '' });
    if (keys.length === 3) return fail(route, 409, 'IN_PROGRESS');
    return ok(route, openResult({ ...counts, chests: 0, keys: 0 }, NOTEBOOK));
  });
  await page.goto('/kho-ruong');
  await page.locator('#qh-openBtn').click();

  await expect(appMode(page)).toHaveAttribute('data-mode', 'reveal', { timeout: 30_000 });
  await expect(page.locator('#qh-gotName')).toHaveText('Sổ tay da bò');
  expect(keys).toHaveLength(4);
  expect(new Set(keys).size).toBe(1);
  expect(keys[0]).toMatch(UUID);
});

for (const [code, message] of [
  ['KEY_NONE', 'Bạn không còn chìa cho loại hòm này.'],
  ['CHEST_NONE', 'Bạn không còn hòm loại này.'],
] as const) {
  test(`${code} stops the sequence softly, says why in Vietnamese and syncs the numbers`, async ({ page }) => {
    const counts = { chests: 1, keys: 1, balance: 500 };
    const lists = await prepare(page, counts);
    const errors = collectPageErrors(page);
    let calls = 0;
    await page.route('**/api/chests/chest_np/open', async (route) => {
      calls++;
      if (code === 'KEY_NONE') counts.keys = 0;
      else counts.chests = 0;
      await fail(route, 409, code);
    });
    await page.goto('/kho-ruong');
    await expect(page.locator('#qh-openLbl')).toHaveText('Mở');
    const before = lists.count;

    await page.locator('#qh-openBtn').click();

    await expect(page.locator('#toast-root')).toContainText(message);
    await expect(appMode(page)).toHaveAttribute('data-mode', 'idle');
    await expect.poll(() => lists.count).toBeGreaterThan(before);
    await expect(page.locator(code === 'KEY_NONE' ? '#qh-nKey' : '#qh-nChest')).toHaveText(code === 'KEY_NONE' ? '0' : '×0');
    expect(calls).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('an answer that fails while the reel already spins also stops it softly', async ({ page }) => {
  const counts = { chests: 1, keys: 1, balance: 500 };
  await prepare(page, counts);
  let release!: () => void;
  const answer = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/chests/chest_np/open', async (route) => {
    await answer;
    await fail(route, 409, 'KEY_NONE');
  });
  await page.goto('/kho-ruong');
  await page.locator('#qh-openBtn').click();
  await expect(appMode(page)).toHaveAttribute('data-mode', 'spin');

  release();

  await expect(appMode(page)).toHaveAttribute('data-mode', 'idle', { timeout: 10_000 });
  await expect(page.locator('#toast-root')).toContainText('Bạn không còn chìa cho loại hòm này.');
  await expect(page.locator('#qh-openBtn')).toBeEnabled();
});

test('buying a key and a chest calls the API with a fresh key each time and shows its numbers', async ({ page }) => {
  const counts = { chests: 0, keys: 0, balance: 1000 };
  await prepare(page, counts);
  const seen: Array<{ url: string; key: string }> = [];
  const shop = (kind: 'keys' | 'buy') => async (route: Route) => {
    seen.push({ url: kind, key: route.request().postDataJSON().idempotencyKey });
    if (kind === 'keys') { counts.keys++; counts.balance -= 180; } else { counts.chests++; counts.balance -= 120; }
    await ok(route, {
      chestId: 'chest_np', itemId: `bought-${seen.length}`, item: NOTEBOOK, chestCount: counts.chests, keyCount: counts.keys, wallet: wallet(counts),
    });
  };
  await page.route('**/api/chests/chest_np/keys', shop('keys'));
  await page.route('**/api/chests/chest_np/buy', shop('buy'));
  await page.goto('/kho-ruong');

  await expect(page.locator('#qh-openLbl')).toContainText('Mua hòm');
  await page.locator('#qh-openBtn').click();
  await expect(page.locator('#qh-nChest')).toHaveText('×1');
  await expect(page.locator('#qh-openLbl')).toContainText('Mua chìa');
  await page.waitForTimeout(450);
  await page.locator('#qh-openBtn').click();
  await expect(page.locator('#qh-nKey')).toHaveText('1');
  await expect(page.locator('#qh-openLbl')).toHaveText('Mở');
  await page.locator('[data-qh-buy="key"]').click();
  await expect(page.locator('#qh-nKey')).toHaveText('2');
  await page.locator('[data-qh-buy="chest"]').click();
  await expect(page.locator('#qh-nChest')).toHaveText('×2');
  await expect(page.locator('#qh-nCoin')).toHaveText('400');

  expect(seen.map((entry) => entry.url)).toEqual(['buy', 'keys', 'keys', 'buy']);
  expect(new Set(seen.map((entry) => entry.key)).size).toBe(4);
  seen.forEach((entry) => expect(entry.key).toMatch(UUID));
});

test('the second click of a double click on a buy button does not open the chest', async ({ page }) => {
  const counts = { chests: 1, keys: 0, balance: 1000 };
  await prepare(page, counts);
  let opens = 0;
  await page.route('**/api/chests/chest_np/keys', async (route) => {
    counts.keys++;
    await ok(route, { chestId: 'chest_np', itemId: 'k', item: NOTEBOOK, chestCount: counts.chests, keyCount: counts.keys, wallet: wallet(counts) });
  });
  await page.route('**/api/chests/chest_np/open', async (route) => { opens++; await fail(route, 409, 'KEY_NONE'); });
  await page.goto('/kho-ruong');
  await expect(page.locator('#qh-openLbl')).toContainText('Mua chìa');

  await page.locator('#qh-openBtn').dblclick();

  await expect(page.locator('#qh-nKey')).toHaveText('1');
  await page.waitForTimeout(300);
  expect(opens).toBe(0);
  await expect(appMode(page)).toHaveAttribute('data-mode', 'idle');
});

test('a coin shortage on the shop buttons shows the server error in Vietnamese', async ({ page }) => {
  const counts = { chests: 1, keys: 1, balance: 500 };
  await prepare(page, counts);
  await page.route('**/api/chests/chest_np/keys', (route) => fail(route, 409, 'FUNDS'));
  await page.goto('/kho-ruong');
  await page.locator('[data-qh-buy="key"]').click();
  await expect(page.locator('#toast-root')).toContainText('Bạn không đủ xu.');
});

test('swiping across the chest changes the chest type and never opens one', async ({ page }) => {
  const counts = { chests: 3, keys: 3, balance: 500 };
  await prepare(page, counts);
  let opens = 0;
  await page.route('**/api/chests/chest_np/open', async (route) => { opens++; await ok(route, openResult(counts)); });
  await page.goto('/kho-ruong');
  await expect(page.locator('#qh-openLbl')).toHaveText('Mở');

  const box = (await page.locator('.qh-spot').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('#qh-caseName')).toHaveText('Két Nhà Băng');
  await page.waitForTimeout(200);
  expect(opens).toBe(0);
  await expect(appMode(page)).toHaveAttribute('data-mode', 'idle');
});

test('leaving the page stops the loop, the sound, the timers and the key handler', async ({ page }) => {
  const counts = { chests: 1, keys: 1, balance: 500 };
  await page.addInitScript(() => {
    const w = window as any;
    w.__draws = 0;
    w.__closedAudio = 0;
    const fillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (...args: [number, number, number, number]) {
      w.__draws++;
      return fillRect.apply(this, args);
    };
    const close = AudioContext.prototype.close;
    AudioContext.prototype.close = function () {
      w.__closedAudio++;
      return close.call(this);
    };
  });
  await prepare(page, counts);
  const errors = collectPageErrors(page);
  let release!: () => void;
  const answer = new Promise<void>((resolve) => { release = resolve; });
  let opens = 0;
  await page.route('**/api/chests/chest_np/open', async (route) => {
    opens++;
    await answer;
    await route.fulfill({ status: 503, body: '' });
  });
  await page.route('**/api/market/items?*', (route) => ok(route, { rows: [], categoryCounts: {}, totalCount: 0 }));
  await page.goto('/kho-ruong');
  await page.locator('#qh-openBtn').click();
  await expect(appMode(page)).toHaveAttribute('data-mode', 'spin');
  await expect.poll(() => page.evaluate(() => (window as any).__draws)).toBeGreaterThan(0);

  await page.evaluate(() => { history.pushState(null, '', '/market'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('.qh-app')).toHaveCount(0);
  await page.waitForTimeout(150);
  const draws = await page.evaluate(() => (window as any).__draws);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__draws)).toBe(draws);
  expect(await page.evaluate(() => (window as any).__closedAudio)).toBe(1);

  // A late failure of the abandoned request neither retries nor touches the new page.
  release();
  await page.waitForTimeout(1200);
  expect(opens).toBe(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/\/market$/);
  expect(errors).toEqual([]);
});

test('the market lists the new categories, the Mystery rarity and the pixel icons', async ({ page }) => {
  const counts = { chests: 1, keys: 1, balance: 500 };
  await prepare(page, counts);
  const row = (entry: ReturnType<typeof def>) => ({
    def: entry, listedCount: 0, lowestAsk: null, highestBid: null, bidCount: 0, spark10: [], changePercent: null, volume30: 0,
  });
  const chestDef = def('chest_np', 'Hòm Niêm Phong', 'COMMON', 'chest_seal', 'CHEST');
  const keyDef = def('key_np', 'Chìa kính lúp', 'COMMON', 'key_loupe', 'KEY');
  await page.route('**/api/market/items?*', (route) => ok(route, {
    rows: [row(WATCH), row(chestDef), row(keyDef)], categoryCounts: { CHEST: 3, KEY: 3, CURIO: 30 }, totalCount: 3,
  }));
  await page.goto('/market');

  const rows = page.locator('#mk-rows');
  await expect(rows).toContainText('Đồng hồ 2:17');
  await expect(rows.locator('img.bpa-mk-icon[src^="data:image/png"]')).toHaveCount(3);
  await expect(rows).toContainText('Bí ẩn', { ignoreCase: true });
  await expect(page.locator('.bpa-mk-rarities')).toContainText('Bí ẩn');
  const sidebar = page.locator('#mk-cats');
  await expect(sidebar).toContainText('Hòm');
  await expect(sidebar).toContainText('Chìa');
  await expect(sidebar).toContainText('Vật phẩm sưu tầm');
});

test('the bag offers no USE button for collectibles, and shows their icon', async ({ page }) => {
  const counts = { chests: 1, keys: 1, balance: 500 };
  await prepare(page, counts);
  await page.route('**/api/market/inventory', (route) => ok(route, {
    items: [{
      itemId: 'reward-1', def: WATCH, locked: false, lockReason: null, listingId: null, listingPrice: null,
      equipped: false, source: 'CHEST', acquiredAt: new Date().toISOString(),
    }],
    wallet: wallet(counts),
    equipped: {},
  }));
  await page.route('**/api/market/items/*', (route) => ok(route, {
    def: WATCH, listedCount: 0, lowestAsk: null, bidCount: 0, highestBid: null, listings: [], bids: [],
    history: { days: [], line: [], low: null, high: null, changePercent: null, volume: 0 }, myListings: [], myOrders: [], ownedCount: 1,
  }));
  await page.goto('/market/sell');

  const tile = page.locator('#mk-grid').getByRole('button', { name: /Đồng hồ 2:17/ });
  await expect(tile.locator('img.bpa-mk-icon')).toHaveCount(1);
  await tile.click();
  await expect(page.locator('#mk-sellpanel')).toContainText('Đồng hồ 2:17');
  await expect(page.locator('#mk-sellpanel [data-act="equip"]')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the page fits under the shell without sideways scrolling', async ({ page }) => {
    const counts = { chests: 2, keys: 2, balance: 500 };
    await prepare(page, counts);
    await page.route('**/api/chests/chest_np/open', (route) => ok(route, openResult({ ...counts, chests: 1, keys: 1 })));
    await page.goto('/kho-ruong');
    await expect(page.locator('#qh-openLbl')).toHaveText('Mở');

    await expect(page.locator('#nav-root a[href="/kho-ruong"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('#qh-openBtn')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#qh-nextBtn')).toBeInViewport();

    await page.locator('#qh-openBtn').click();
    await expect(appMode(page)).toHaveAttribute('data-revealed', '', { timeout: 15_000 });
    await expect(page.locator('#qh-keepBtn')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#qh-againBtn')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
