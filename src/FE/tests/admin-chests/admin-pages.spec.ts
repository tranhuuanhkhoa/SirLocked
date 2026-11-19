import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * The chests and items admin pages with a small in-memory API. The server's rules are tested in the backend suites;
 * these check what the pages send, show and refuse, on a computer and on a 390x844 phone.
 */
type Json = Record<string, any>;

const visual = (iconKey: string | null, imageUrl: string | null = null) => ({ iconKey, imageUrl, builtinId: null, template: null, params: {} });

const item = (id: string, name: string, rarity: string, extra: Json = {}): Json => ({
  id, category: 'CURIO', rarity, name, nameEn: `${name} EN`, description: `${name}.`, descriptionEn: `${name}.`,
  displayDescription: `${name}.`, displayDescriptionEn: `${name}.`, referencePrice: 100, tradable: true, retired: false,
  sortOrder: 0, version: 1, iconKey: 'lantern', visual: visual('lantern'), circulating: 0, chests: [], editable: true, deletable: false,
  ...extra,
});

const def = (source: Json) => ({
  id: source.id, category: source.category, rarity: source.rarity, name: source.name, nameEn: source.nameEn,
  description: source.description, descriptionEn: source.descriptionEn, referencePrice: source.referencePrice,
  iconKey: source.iconKey, tradable: source.tradable, visual: source.visual,
});

function state() {
  const items: Json[] = [
    item('VC-0388', 'Sổ tay da bò', 'COMMON', { circulating: 3, chests: [{ id: 'chest_np', name: 'Hòm Niêm Phong' }] }),
    item('VC-0402', 'Phiếu vân tay', 'COMMON', { chests: [{ id: 'chest_np', name: 'Hòm Niêm Phong' }] }),
    item('VC-0391', 'Đèn bão', 'RARE', { chests: [{ id: 'chest_np', name: 'Hòm Niêm Phong' }] }),
    item('VC-0217', 'Đồng hồ 2:17', 'MYSTERY', { iconKey: 'watch', visual: visual('watch'), chests: [{ id: 'chest_np', name: 'Hòm Niêm Phong' }] }),
    item('VC-0500', 'Mũ cũ', 'RARE', { deletable: true }),
    item('VC-0600', 'Đèn hỏng', 'EPIC', { retired: true }),
    item('frame_dong', 'Viền Đồng', 'RARE', { category: 'FRAME', iconKey: 'frame_dong', visual: visual('frame_dong'), editable: false, chests: [{ id: 'chest_np', name: 'Hòm Niêm Phong' }] }),
    item('title_tan-binh', 'Tân binh', 'EPIC', { category: 'TITLE', iconKey: 'title_tan-binh', visual: visual('title_tan-binh'), editable: false }),
    item('chest_np', 'Hòm Niêm Phong', 'COMMON', { category: 'CHEST', iconKey: 'chest_seal', visual: visual('chest_seal'), editable: false }),
    item('key_np', 'Chìa kính lúp', 'COMMON', { category: 'KEY', iconKey: 'key_loupe', visual: visual('key_loupe'), editable: false }),
  ];
  const chest: Json = {
    id: 'chest_np', keyDefId: 'key_np', name: 'Hòm Niêm Phong', nameEn: 'Sealed Case', subtitle: 'Bến Sương', subtitleEn: 'Fog Wharf',
    keyName: 'chìa kính lúp', keyNameEn: 'loupe key', iconKey: 'chest_seal', keyIconKey: 'key_loupe',
    look: { template: 'seal', light: '240,164,58', hi: '255,222,150', core: '255,236,190' },
    chestPrice: 120, keyPrice: 180, active: true, sortOrder: 0, version: 2,
    challengeWeight: 60, challengePercent: 60,
    dropWeights: { COMMON: 8000, RARE: 1500, EPIC: 0, LEGENDARY: 0, MYSTERY: 500 },
    poolIds: ['VC-0388', 'VC-0402', 'VC-0391', 'frame_dong', 'VC-0217'],
    expectedValue: 100, cost: 300, problems: [],
  };
  return {
    items, chest,
    nextCurioId: 'CU-0007',
    /** More chests for the list, beside the one every test edits. */
    otherChests: [] as Json[],
    /** Opening scenes admins made (Kiểu hòm). */
    styles: [] as Json[],
    requests: [] as { method: string; path: string; body: Json | null }[],
    stockAvailable: true,
    versions: [
      { version: 2, action: 'update', at: '2026-11-04T08:00:00Z', adminName: 'Yến', reason: 'Tăng giá', current: true, chestPrice: 120, keyPrice: 180, challengeWeight: 60, dropWeights: chest.dropWeights, poolCount: 5, diff: { added: [], removed: [], weights: [], fields: [{ field: 'prices.chest', before: '100', after: '120' }, { field: 'challengeWeight', before: '30', after: '60' }], reordered: false, isEmpty: false } },
      { version: 1, action: 'base', at: '2026-11-01T08:00:00Z', adminName: null, reason: null, current: false, chestPrice: 100, keyPrice: 180, challengeWeight: 30, dropWeights: chest.dropWeights, poolCount: 5, diff: { added: [], removed: [], weights: [], fields: [], reordered: false, isEmpty: true } },
    ],
    openings: Array.from({ length: 3 }, (_, index) => ({
      id: `u:${index}`, at: `2026-11-0${index + 1}T08:00:00Z`, playerId: 'u1', playerName: index === 2 ? 'Thám tử Bình' : 'Thám tử An',
      chestId: 'chest_np', chestName: 'Hòm Niêm Phong', item: def(item('VC-0217', 'Đồng hồ 2:17', 'MYSTERY', { iconKey: 'watch', visual: visual('watch') })), state: 'DONE',
    })),
  };
}
type State = ReturnType<typeof state>;

function detail(s: State) {
  const { poolIds, ...chest } = s.chest;
  const total = (rarity: string) => poolIds.filter((id: string) => s.items.find((i) => i.id === id)?.rarity === rarity).length;
  return {
    ...chest,
    pool: poolIds.map((id: string) => {
      const source = s.items.find((i) => i.id === id)!;
      return { def: def(source), retired: source.retired, ratePercent: (chest.dropWeights[source.rarity] ?? 0) / 100 / Math.max(1, total(source.rarity)) };
    }),
  };
}

function checkOf(s: State, draft: Json) {
  const total = Object.values(draft.dropWeights as Record<string, number>).reduce((sum, weight) => sum + weight, 0);
  const violations: Json[] = [];
  if (total !== 10000) violations.push({ code: 'CHEST_WEIGHTS_TOTAL', message: `Tổng trọng số phải bằng 10.000, hiện là ${total.toLocaleString('vi-VN')}.` });
  const added = draft.pool.filter((id: string) => !s.chest.poolIds.includes(id));
  const removed = s.chest.poolIds.filter((id: string) => !draft.pool.includes(id));
  const weights = Object.keys(draft.dropWeights)
    .filter((rarity) => draft.dropWeights[rarity] !== s.chest.dropWeights[rarity])
    .map((rarity) => ({ rarity, before: s.chest.dropWeights[rarity] / 100, after: draft.dropWeights[rarity] / 100 }));
  const fields = [
    ...(draft.chestPrice !== s.chest.chestPrice ? [{ field: 'prices.chest', before: String(s.chest.chestPrice), after: String(draft.chestPrice) }] : []),
    ...(draft.challengeWeight !== s.chest.challengeWeight ? [{ field: 'challengeWeight', before: String(s.chest.challengeWeight), after: String(draft.challengeWeight) }] : []),
  ];
  return {
    violations, expectedValue: 111, cost: draft.chestPrice + draft.keyPrice, totalWeight: total,
    rates: Object.fromEntries(draft.pool.map((id: string) => {
      const rarity = s.items.find((i) => i.id === id)!.rarity;
      const peers = draft.pool.filter((other: string) => s.items.find((i) => i.id === other)!.rarity === rarity).length;
      return [id, (draft.dropWeights[rarity] ?? 0) / 100 / peers];
    })),
    diff: { added, removed, weights, fields, reordered: false, isEmpty: !added.length && !removed.length && !weights.length && !fields.length },
  };
}

/** What the server says of a chest that does not exist yet: measured against nothing, so a name is needed too. */
function newCheckOf(draft: Json) {
  const total = Object.values(draft.dropWeights as Record<string, number>).reduce((sum, weight) => sum + weight, 0);
  const violations: Json[] = [];
  if (!String(draft.name ?? '').trim()) violations.push({ code: 'ADMIN_TEXT_INVALID', message: 'Tên hòm không được để trống.' });
  if (total !== 10000) violations.push({ code: 'CHEST_WEIGHTS_TOTAL', message: `Tổng trọng số phải bằng 10.000, hiện là ${total.toLocaleString('vi-VN')}.` });
  return {
    violations, expectedValue: 90, cost: draft.chestPrice + draft.keyPrice, totalWeight: total, rates: {},
    diff: { added: draft.pool, removed: [], weights: [], fields: draft.name ? [{ field: 'name', before: '', after: draft.name }] : [], reordered: false, isEmpty: false },
  };
}

const ok = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
const refuse = (route: Route, status: number, code: string, message: string, violations: Json[] = []) =>
  route.fulfill({ status, json: { success: false, message, errors: { code, violations } } });

async function prepare(page: Page, s: State, role = 'ADMIN') {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((userRole) => {
    localStorage.setItem('sirlocked.token', 'admin-test-token');
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'u1', fullName: 'Yến', role: userRole, isEmailVerified: true }));
    (window as any).__sirlockedNoSignalR = true;
  }, role);
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = method === 'GET' || !request.postData() || path === '/api/admin/assets' ? null : request.postDataJSON();
    s.requests.push({ method, path: `${path}${url.search}`, body });

    if (method === 'GET' && path === '/api/admin/items') return ok(route, { items: s.items, nextCurioId: s.nextCurioId, problems: [] });
    if (method === 'POST' && path === '/api/admin/items') {
      const created = item(s.nextCurioId, body.name, body.rarity, { ...body, iconKey: body.iconKey ?? null, visual: visual(body.iconKey ?? null, body.imageUrl ?? null), deletable: true });
      s.items.push(created);
      s.nextCurioId = 'CU-0008';
      return ok(route, created);
    }
    const itemMatch = path.match(/^\/api\/admin\/items\/([^/]+)(?:\/(retire|delete))?$/);
    if (itemMatch) {
      const target = s.items.find((i) => i.id === itemMatch[1])!;
      if (itemMatch[2] === 'retire') { target.retired = body.retired; target.version += 1; return ok(route, target); }
      if (itemMatch[2] === 'delete') { s.items.splice(s.items.indexOf(target), 1); return ok(route, true); }
      Object.assign(target, body, { version: target.version + 1, visual: visual(body.iconKey ?? null, body.imageUrl ?? null), iconKey: body.iconKey ?? null });
      return ok(route, target);
    }
    if (path === '/api/admin/assets') {
      if (!s.stockAvailable) return refuse(route, 503, 'ASSET_STORAGE_UNAVAILABLE', 'Storage is not configured.');
      return ok(route, { url: 'https://res.cloudinary.com/demo/image/upload/sirlocked/admin/moi.webp', width: 64, height: 64 });
    }
    if (method === 'GET' && path === '/api/admin/chests') {
      const { poolIds, ...chest } = s.chest;
      return ok(route, { chests: [{ ...chest, opensLast7Days: 12, poolCount: poolIds.length }, ...s.otherChests], problems: [] });
    }
    if (path === '/api/admin/chests/openings') {
      const page_ = Number(url.searchParams.get('page') ?? 1);
      const player = url.searchParams.get('player');
      const rows = s.openings.filter((row) => !player || row.playerName.includes(player));
      return ok(route, { items: rows.slice((page_ - 1) * 2, page_ * 2), page: page_, pageSize: 2, total: rows.length });
    }
    if (path === '/api/admin/chests/players') return ok(route, [{ id: 'u9', fullName: 'Thám tử An', email: 'an@example.test' }]);
    if (path === '/api/admin/chests/grant') return ok(route, { balance: 0, held: 0, slotsUsed: 5, slotCap: 12, itemCount: 5, reservedSlots: 0, feePercent: 5 });
    if (method === 'GET' && path === '/api/admin/chest-styles') return ok(route, { styles: s.styles });
    if (method === 'POST' && path === '/api/admin/chest-styles') {
      const created = { ...body, id: `style_00${s.styles.length + 1}`, version: 1, updatedAt: '2026-11-19T12:00:00Z', usedBy: [] };
      s.styles.push(created);
      return ok(route, created);
    }
    if (method === 'POST' && path === '/api/admin/chests/check') return ok(route, newCheckOf(body));
    if (method === 'POST' && path === '/api/admin/chests') {
      return ok(route, { ...detail(s), id: 'chest_001', keyDefId: 'key_001', name: body.name, active: body.active, version: 1 });
    }
    if (method === 'GET' && path === '/api/admin/chests/chest_np') return ok(route, detail(s));
    if (method === 'PUT' && path === '/api/admin/chests/chest_np') {
      Object.assign(s.chest, {
        name: body.name, chestPrice: body.chestPrice, keyPrice: body.keyPrice, active: body.active, look: body.look,
        dropWeights: body.dropWeights, poolIds: body.pool, version: s.chest.version + 1,
        // Omitting the field keeps the old value, like the server. The other chests weigh 40 together, so the share is weight / (weight + 40).
        ...(body.challengeWeight === undefined ? {} : {
          challengeWeight: body.challengeWeight,
          challengePercent: body.challengeWeight > 0 ? Math.round((body.challengeWeight / (body.challengeWeight + 40)) * 10000) / 100 : 0,
        }),
      });
      return ok(route, detail(s));
    }
    if (path === '/api/admin/chests/chest_np/check') return ok(route, checkOf(s, body));
    if (path === '/api/admin/chests/chest_np/clone') {
      return ok(route, { ...detail(s), id: 'chest_001', keyDefId: 'key_001', name: body.name, active: false, version: 1 });
    }
    if (path === '/api/admin/chests/chest_np/versions') return ok(route, s.versions);
    if (path.endsWith('/restore')) { s.chest.version += 1; s.chest.chestPrice = 100; return ok(route, detail(s)); }
    if (path === '/api/admin/chests/chest_np/stats') {
      const days = Number(url.searchParams.get('days'));
      return ok(route, {
        chestId: 'chest_np', days, opens: days === 30 ? 40 : 10, coinsFromChests: 1200, coinsFromKeys: 1800,
        rates: [
          { rarity: 'COMMON', count: 8, actualPercent: 80, configuredPercent: 80 },
          { rarity: 'RARE', count: 1, actualPercent: 10, configuredPercent: 15 },
          { rarity: 'EPIC', count: 0, actualPercent: 0, configuredPercent: 0 },
          { rarity: 'LEGENDARY', count: 0, actualPercent: 0, configuredPercent: 0 },
          { rarity: 'MYSTERY', count: 1, actualPercent: 10, configuredPercent: 5 },
        ],
        topItems: [{ def: def(s.items[0]), count: 8 }],
        rareDrops: [{ def: def(s.items[3]), playerId: 'u1', playerName: 'Thám tử An', at: '2026-11-03T08:00:00Z' }],
      });
    }
    if (path === '/api/admin/chests/chest_np/preview') {
      const live = detail(s);
      return ok(route, {
        chests: [{ ...live, chestCount: 99, keyCount: 99, contents: live.pool.map((entry: Json) => entry.def), odds: [{ rarity: 'COMMON', percent: 80 }, { rarity: 'RARE', percent: 15 }, { rarity: 'MYSTERY', percent: 5 }] }],
        odds: [], offSale: [], wallet: { balance: 0, held: 0, slotsUsed: 0, slotCap: 12, itemCount: 0, reservedSlots: 0, feePercent: 5 },
      });
    }
    if (path === '/api/admin/chests/chest_np/preview/open') {
      return ok(route, { chestId: 'chest_np', itemId: 'preview', item: def(s.items[3]), chestCount: 99, keyCount: 99, wallet: { balance: 0, held: 0, slotsUsed: 0, slotCap: 12, itemCount: 0, reservedSlots: 0, feePercent: 5 } });
    }
    return route.fulfill({ status: 200, json: { success: true, data: null } });
  });
}

const sent = (s: State, method: string, fragment: string) => s.requests.filter((r) => r.method === method && r.path.includes(fragment));

/** The chest of the Whitechapel collection as the list gives it: its own drawing, which is what makes the showcase. */
const whitechapelChest = (extra: Json = {}): Json => ({
  id: 'chest_wc', keyDefId: 'key_wc', name: 'Hòm Đêm Whitechapel', nameEn: 'Whitechapel Night Chest', subtitle: 'Phố Whitechapel · Nº 1888',
  subtitleEn: 'Whitechapel · Nº 1888', keyName: 'chìa kính lúp bạc', keyNameEn: 'silver loupe key', iconKey: 'chest_whitechapel', keyIconKey: 'key_loupe',
  look: { template: 'whitechapel', light: '190,52,58', hi: '255,150,140', core: '255,222,214' },
  chestPrice: 180, keyPrice: 260, active: true, sortOrder: 9, version: 1, challengeWeight: 0, challengePercent: 0,
  opensLast7Days: 0, poolCount: 17, expectedValue: 260, cost: 440, ...extra,
});

/** Makes the chest every test edits the Whitechapel one, keeping its id so the routes still answer. */
function dressAsWhitechapel(s: State) {
  Object.assign(s.chest, { iconKey: 'chest_whitechapel', subtitle: 'Phố Whitechapel · Nº 1888', look: { template: 'whitechapel', light: '190,52,58', hi: '255,150,140', core: '255,222,214' } });
}

async function expectNoSidewaysScroll(page: Page) {
  await page.waitForTimeout(500); // The route's lens transition overflows for a moment on every page.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

// ------------------------------------------------------------------ items

test.describe('/admin/items', () => {
  test('lists every item type with what an admin needs, and filters them', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');

    const row = page.locator('tr[data-item-id="VC-0388"]');
    await expect(row).toContainText('Sổ tay da bò');
    await expect(row).toContainText('Thường');
    await expect(row).toContainText('100');
    await expect(row).toContainText('Hòm Niêm Phong');
    await expect(row.locator('[data-ac-copies]')).toHaveText('3');
    await expect(page.locator('tr[data-item-id]')).toHaveCount(10);

    await page.locator('[data-ac-search]').fill('vân tay');
    await expect(page.locator('tr[data-item-id]')).toHaveCount(1);
    await page.locator('[data-ac-search]').fill('vc-0391');
    await expect(page.locator('tr[data-item-id="VC-0391"]')).toBeVisible();
    await page.locator('[data-ac-search]').fill('');

    await page.locator('[data-ac-filter="rarity"]').selectOption('MYSTERY');
    await expect(page.locator('tr[data-item-id]')).toHaveCount(1);
    await page.locator('[data-ac-filter="rarity"]').selectOption('');

    await page.locator('[data-ac-filter="category"]').selectOption('FRAME');
    await expect(page.locator('tr[data-item-id]')).toHaveCount(1);
    await page.locator('[data-ac-filter="category"]').selectOption('');

    await page.locator('[data-ac-filter="status"]').selectOption('retired');
    await expect(page.locator('tr[data-item-id]')).toHaveCount(1);
    await expect(page.locator('tr[data-item-id="VC-0600"]')).toBeVisible();
  });

  test('creates a curio with a sprite, showing the id it will get before saving', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');

    await page.locator('[data-ac-new-item]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog.locator('[data-ac-next-id]')).toHaveText('CU-0007');

    await dialog.locator('[name="name"]').fill('Bùa may mắn');
    await dialog.locator('[name="nameEn"]').fill('Lucky charm');
    await dialog.locator('[name="description"]').fill('Một lá bùa cũ.');
    await dialog.locator('[name="descriptionEn"]').fill('An old charm.');
    await dialog.locator('[name="rarity"]').selectOption('EPIC');
    await dialog.locator('[name="referencePrice"]').fill('2500');
    await dialog.locator('[data-icon-key="pendant"]').click();
    await expect(dialog.locator('[data-icon-key="pendant"]')).toHaveAttribute('aria-pressed', 'true');
    await dialog.locator('[data-ac-submit]').click();

    await expect(page.locator('tr[data-item-id="CU-0007"]')).toContainText('Bùa may mắn');
    const body = sent(s, 'POST', '/api/admin/items')[0].body!;
    expect(body).toMatchObject({ name: 'Bùa may mắn', nameEn: 'Lucky charm', rarity: 'EPIC', referencePrice: 2500, tradable: true, iconKey: 'pendant' });
    expect(body.imageUrl ?? null).toBeNull();
  });

  test('the sprite picker offers chest, key and cosmetic sprites too', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');
    await page.locator('[data-ac-new-item]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');

    await dialog.locator('[data-icon-group="keys"]').click();
    await expect(dialog.locator('[data-icon-key="key_jade"]')).toBeVisible();
    await dialog.locator('[data-icon-group="chests"]').click();
    await expect(dialog.locator('[data-icon-key="chest_bank"]')).toBeVisible();
    await dialog.locator('[data-icon-group="frames"]').click();
    await expect(dialog.locator('[data-icon-key="frame_dong"]')).toBeVisible();
    await dialog.locator('[data-icon-group="titles"]').click();
    await expect(dialog.locator('[data-icon-key="title_tan-binh"]')).toBeVisible();
  });

  test('creates a curio with an uploaded picture', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');
    await page.locator('[data-ac-new-item]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="name"]').fill('Bức ảnh');
    await dialog.locator('[name="nameEn"]').fill('Photo');
    await dialog.locator('[name="referencePrice"]').fill('300');

    await dialog.locator('input[type="file"]').setInputFiles({ name: 'moi.png', mimeType: 'image/png', buffer: Buffer.from('fake') });
    await expect(dialog.locator('[data-ac-image-preview]')).toHaveAttribute('src', /moi\.webp$/);
    await dialog.locator('[data-ac-submit]').click();

    await expect(page.locator('tr[data-item-id="CU-0007"]')).toBeVisible();
    expect(sent(s, 'POST', '/api/admin/items')[0].body).toMatchObject({ imageUrl: 'https://res.cloudinary.com/demo/image/upload/sirlocked/admin/moi.webp' });
    expect(sent(s, 'POST', '/api/admin/items')[0].body!.iconKey ?? null).toBeNull();
  });

  test('a picture larger than the limit is refused before it is sent, and a missing storage is explained', async ({ page }) => {
    const s = state();
    s.stockAvailable = false;
    await prepare(page, s);
    await page.goto('/admin/items');
    await page.locator('[data-ac-new-item]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');

    await dialog.locator('input[type="file"]').setInputFiles({ name: 'to.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await expect(dialog.locator('.ac-errors')).toContainText('5 MB');
    expect(sent(s, 'POST', '/api/admin/assets')).toHaveLength(0);

    await dialog.locator('input[type="file"]').setInputFiles({ name: 'nho.png', mimeType: 'image/png', buffer: Buffer.from('fake') });
    await expect(dialog.locator('.ac-errors')).toContainText('Cloudinary');
  });

  test('a new item without a picture is stopped with a message in Vietnamese', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');
    await page.locator('[data-ac-new-item]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="name"]').fill('Không ảnh');
    await dialog.locator('[name="nameEn"]').fill('No picture');
    await dialog.locator('[name="referencePrice"]').fill('300');

    await dialog.locator('[data-ac-submit]').click();

    await expect(dialog.locator('.ac-errors')).toContainText('sprite');
    expect(sent(s, 'POST', '/api/admin/items')).toHaveLength(0);
  });

  test('changing the rarity of an owned item warns and demands a reason', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');
    await page.locator('tr[data-item-id="VC-0388"] [data-ac-edit]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');

    await expect(dialog.locator('[data-ac-rarity-warning]')).toBeHidden();
    await dialog.locator('[name="rarity"]').selectOption('RARE');
    await expect(dialog.locator('[data-ac-rarity-warning]')).toContainText('3 bản');
    await expect(dialog.locator('[data-ac-rarity-warning]')).toContainText('đổi KN');

    await dialog.locator('[data-ac-submit]').click();
    await expect(dialog.locator('.ac-errors')).toContainText('lý do');
    expect(sent(s, 'PUT', '/api/admin/items/VC-0388')).toHaveLength(0);

    await dialog.locator('[name="reason"]').fill('Hiếm hơn dự kiến');
    await dialog.locator('[data-ac-submit]').click();
    await expect(page.locator('tr[data-item-id="VC-0388"]')).toContainText('Hiếm');
    expect(sent(s, 'PUT', '/api/admin/items/VC-0388')[0].body).toMatchObject({ rarity: 'RARE', reason: 'Hiếm hơn dự kiến', expectedVersion: 1 });
  });

  test('stopping the sale of an owned item warns and demands a reason', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');
    await page.locator('tr[data-item-id="VC-0388"] [data-ac-edit]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');

    await expect(dialog.locator('[data-ac-tradable-warning]')).toBeHidden();
    await dialog.locator('[name="tradable"]').uncheck();
    await expect(dialog.locator('[data-ac-tradable-warning]')).toContainText('3 bản');
    await expect(dialog.locator('[data-ac-tradable-warning]')).toContainText('không bán');

    await dialog.locator('[data-ac-submit]').click();
    await expect(dialog.locator('.ac-errors')).toContainText('lý do');
    expect(sent(s, 'PUT', '/api/admin/items/VC-0388')).toHaveLength(0);

    await dialog.locator('[name="reason"]').fill('Món sự kiện');
    await dialog.locator('[data-ac-submit]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
    expect(sent(s, 'PUT', '/api/admin/items/VC-0388')[0].body).toMatchObject({ tradable: false, reason: 'Món sự kiện' });
  });

  test('an owned item can only be retired; one nobody owns can also be deleted, after confirming', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');

    await expect(page.locator('tr[data-item-id="VC-0388"] [data-ac-delete]')).toHaveCount(0);
    await page.locator('tr[data-item-id="VC-0388"] [data-ac-retire]').click();
    const retire = page.locator('dialog.ac-dialog[open]');
    await retire.locator('[data-ac-confirm]').click();
    await expect(retire.locator('.ac-errors')).toContainText('lý do');
    await retire.locator('[name="reason"]').fill('Hết mùa');
    await retire.locator('[data-ac-confirm]').click();
    await expect(page.locator('tr[data-item-id="VC-0388"]')).toContainText('Đã ngừng');
    expect(sent(s, 'POST', '/api/admin/items/VC-0388/retire')[0].body).toEqual({ retired: true, reason: 'Hết mùa' });

    await page.locator('tr[data-item-id="VC-0500"] [data-ac-delete]').click();
    const remove = page.locator('dialog.ac-dialog[open]');
    await expect(remove).toContainText('Mũ cũ');
    await remove.locator('[name="reason"]').fill('Tạo nhầm');
    await remove.locator('[data-ac-confirm]').click();
    await expect(page.locator('tr[data-item-id="VC-0500"]')).toHaveCount(0);
  });

  test('cosmetics, chests and keys cannot be edited here, and point at their own page', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');

    const frame = page.locator('tr[data-item-id="frame_dong"]');
    await expect(frame.locator('[data-ac-edit], [data-ac-retire], [data-ac-delete]')).toHaveCount(0);
    await expect(frame.locator('a[href="/admin/cosmetics/frame_dong"]')).toBeVisible();
    const chest = page.locator('tr[data-item-id="chest_np"]');
    await expect(chest.locator('a[href="/admin/chests/chest_np"]')).toBeVisible();
    const key = page.locator('tr[data-item-id="key_np"]');
    await expect(key.locator('[data-ac-edit]')).toHaveCount(0);
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/items');
    await expect(page.locator('tr[data-item-id="VC-0388"]')).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.locator('[data-ac-new-item]').click();
    await expect(page.locator('dialog.ac-dialog[open] [data-ac-submit]')).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});

// ------------------------------------------------------------------ chests

test.describe('/admin/chests', () => {
  test('a cosmetic made on the cosmetics page is drawn in the content list the way players see it', async ({ page }) => {
    const s = state();
    const made = (template: string, params: Json) => ({ iconKey: null, imageUrl: null, builtinId: null, template, params });
    s.items.push(
      item('frame_tu-lam', 'Viền Tự Làm', 'RARE', { category: 'FRAME', iconKey: null, visual: made('builtin-clone', { base: 'dong' }), editable: false }),
      item('title_tu-lam', 'Danh Hiệu Tự Làm', 'RARE', { category: 'TITLE', iconKey: null, visual: made('style', { style: 'ngoc' }), editable: false }),
    );
    s.chest.poolIds.push('frame_tu-lam', 'title_tu-lam');
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=bang-roi');
    await expect(page.locator('[data-pool-item="frame_tu-lam"] canvas.ac-pool-frame')).toBeVisible();
    await expect(page.locator('[data-pool-item="title_tu-lam"] [data-ac-title-art]')).toContainText('Danh Hiệu Tự Làm');
  });

  test('lists chests with their price, opens and expected value', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests');

    const row = page.locator('[data-chest-id="chest_np"]');
    await expect(row).toContainText('Hòm Niêm Phong');
    await expect(row).toContainText('120');
    await expect(row).toContainText('180');
    await expect(row.locator('[data-ac-opens]')).toHaveText('12');
    await expect(row.locator('[data-ac-ev]')).toContainText('100');
    await expect(row.locator('[data-ac-ev]')).toContainText('300');
    await expect(row.locator('img')).toHaveAttribute('src', /^data:image\/png/);
    await expect(row.locator('h2 a[href="/admin/chests/chest_np"]')).toBeVisible();
  });

  test('the list shows the chest\'s share of the weekly challenge drops', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests');
    await expect(page.locator('[data-chest-id="chest_np"] [data-ac-challenge]')).toHaveText('Thử thách tuần: 60%');
  });

  test('a chest with weight 0 in the weekly challenge is listed as not dropping', async ({ page }) => {
    const s = state();
    s.chest.challengeWeight = 0;
    s.chest.challengePercent = 0;
    await prepare(page, s);
    await page.goto('/admin/chests');
    const label = page.locator('[data-chest-id="chest_np"] [data-ac-challenge]');
    await expect(label).toContainText('Không rớt');
    await expect(label).not.toContainText('%');
  });

  test('switching a chest off asks for a reason and sends the whole chest', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests');

    await page.locator('[data-chest-id="chest_np"] [data-ac-toggle]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog).toContainText('vẫn mở được');
    await dialog.locator('[name="reason"]').fill('Tạm ngừng');
    await dialog.locator('[data-ac-confirm]').click();

    await expect(page.locator('[data-chest-id="chest_np"]')).toContainText('Đang tắt');
    expect(sent(s, 'PUT', '/api/admin/chests/chest_np')[0].body).toMatchObject({ active: false, reason: 'Tạm ngừng', expectedVersion: 2, chestPrice: 120, challengeWeight: 60 });
  });

  test('a new chest is cloned from an existing one and opens switched off', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests');

    await page.locator('[data-chest-id="chest_np"] [data-ac-clone]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog).toContainText('mặc định tắt');
    await dialog.locator('[name="name"]').fill('Két Mùa Đông');
    await dialog.locator('[name="nameEn"]').fill('Winter Safe');
    await dialog.locator('[data-ac-confirm]').click();

    await expect(page).toHaveURL(/\/admin\/chests\/chest_001/);
    expect(sent(s, 'POST', '/clone')[0].body).toMatchObject({ name: 'Két Mùa Đông', nameEn: 'Winter Safe' });
  });

  test('a new chest is made from scratch: an empty form checked by the server, then created with a reason', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests');

    await page.locator('[data-ac-new]').click();
    await expect(page).toHaveURL(/\/admin\/chests\/moi$/);
    await expect(page.locator('[data-ac-heading]')).toHaveText('Hòm mới');
    // Nothing to look back on or try out before the chest exists.
    await expect(page.locator('[data-ac-tab="lich-su"]')).toHaveCount(0);
    await expect(page.locator('[data-ac-tab="thong-ke"]')).toHaveCount(0);
    await expect(page.locator('[data-ac-preview]')).toHaveCount(0);
    await expect(page.locator('[data-ac-save]')).toHaveText('Tạo hòm');
    await expect(page.locator('[data-ac-save]')).toBeDisabled();
    // An empty form is not a list of mistakes: nothing is listed before the admin tries to create the chest.
    await expect.poll(() => sent(s, 'POST', '/api/admin/chests/check').length).toBeGreaterThan(0);
    await expect(page.locator('[data-ac-violations]')).toBeEmpty();

    await page.locator('input[name="name"]').fill('Hòm Gió Mùa');
    await page.locator('input[name="nameEn"]').fill('Monsoon Chest');
    await page.locator('input[name="keyName"]').fill('chìa gió');
    await page.locator('input[name="keyNameEn"]').fill('wind key');
    await page.locator('input[name="chestPrice"]').fill('150');
    await page.locator('input[name="keyPrice"]').fill('200');
    await expect.poll(() => sent(s, 'POST', '/api/admin/chests/check').at(-1)?.body?.keyPrice).toBe(200);
    await expect(page.locator('[data-ac-violations]')).toBeEmpty();

    // Trying to create a chest that is not ready lists what is missing, and asks nothing yet.
    await page.locator('[data-ac-save]').click();
    await expect(page.locator('[data-ac-violations]')).toContainText('Tổng trọng số phải bằng 10.000');
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);

    await page.locator('[data-ac-tab="bang-roi"]').click();
    await page.locator('[data-ac-add-item]').click();
    const picker = page.locator('dialog.ac-dialog[open]');
    await picker.locator('[data-pick-item="VC-0388"]').click();
    await page.locator('dialog.ac-dialog[open] [data-ac-dialog-close]').click();
    await page.locator('input[data-weight="COMMON"]').fill('100');
    // Once listed, the list follows the form: fixed, it is gone.
    await expect(page.locator('[data-ac-violations]')).toBeEmpty();
    await expect(page.locator('[data-ac-save]')).toBeEnabled();

    await page.locator('[data-ac-save]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog).toContainText('Tạo Hòm Gió Mùa');
    await expect(dialog).toContainText('Sổ tay da bò');
    await dialog.locator('[data-ac-confirm]').click();
    await expect(dialog.locator('.ac-errors')).toContainText('lý do');
    expect(sent(s, 'POST', '/api/admin/chests').filter((r) => r.path === '/api/admin/chests')).toHaveLength(0);
    await dialog.locator('[name="reason"]').fill('Sự kiện mùa mưa');
    await dialog.locator('[data-ac-confirm]').click();

    await expect(page).toHaveURL(/\/admin\/chests\/chest_001/);
    const body = sent(s, 'POST', '/api/admin/chests').find((r) => r.path === '/api/admin/chests')!.body!;
    expect(body).toMatchObject({
      name: 'Hòm Gió Mùa', nameEn: 'Monsoon Chest', keyName: 'chìa gió', keyNameEn: 'wind key', chestPrice: 150, keyPrice: 200,
      active: false, pool: ['VC-0388'], reason: 'Sự kiện mùa mưa',
    });
    expect(body.dropWeights).toMatchObject({ COMMON: 10000 });
    expect(sent(s, 'POST', '/api/admin/chests/check').length).toBeGreaterThan(0);
  });

  test('a brand-new opening scene is made on the Kiểu hòm tab from uploaded pictures, then chosen for a chest', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.route('https://res.cloudinary.com/**', (route) => route.fulfill({ contentType: 'image/png', body: png }));
    const at = (name: string) => `https://res.cloudinary.com/demo/image/upload/sirlocked/admin/${name}`;
    const uploads = [at('ben-cang.png'), at('hom-gio-mua.png'), at('chia-gio-mua.png'), at('giot-mua.png')];
    await page.route((url) => url.pathname === '/api/admin/assets', (route) => route.fulfill({ json: { success: true, data: { url: uploads.shift(), width: 256, height: 256 } } }));
    await page.goto('/admin/chests?tab=kieu-hom');

    await expect(page.locator('.ac-area-title [aria-current="page"], .ac-area-title .is-active').first()).toContainText('Kiểu hòm');
    await expect(page.getByText('Chưa có kiểu tự tạo nào.')).toBeVisible();
    await page.locator('[data-ac-style-new]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog).toContainText('Tạo kiểu hòm mới');
    await dialog.locator('input[name="name"]').fill('Bến cảng gió mùa');
    await dialog.locator('input[name="nameEn"]').fill('Monsoon Wharf');
    await dialog.locator('input[name="stampText"]').fill('GIÓ MÙA');
    await dialog.locator('select[name="particles"]').selectOption('fall');
    await dialog.locator('[data-style-picture-input="backdropUrl"]').setInputFiles({ name: 'ben-cang.png', mimeType: 'image/png', buffer: png });
    await expect(dialog.locator('[data-style-preview-art]')).toHaveAttribute('style', /ben-cang\.png/);
    await dialog.locator('[data-style-picture-input="chestImageUrl"]').setInputFiles({ name: 'hom.png', mimeType: 'image/png', buffer: png });
    await dialog.locator('[data-style-picture-input="keyImageUrl"]').setInputFiles({ name: 'chia.png', mimeType: 'image/png', buffer: png });
    await dialog.locator('[data-style-picture-input="particleUrl"]').setInputFiles({ name: 'giot.png', mimeType: 'image/png', buffer: png });
    await expect(dialog.locator('[data-style-preview-art] img')).toHaveAttribute('src', /hom-gio-mua\.png$/);
    await expect(dialog.locator('[data-style-preview-art]')).toContainText('GIÓ MÙA');
    await dialog.locator('[data-style-save]').click();

    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
    const card = page.locator('[data-style-id="style_001"]');
    await expect(card).toContainText('Bến cảng gió mùa');
    await expect(card).toContainText('Chưa hòm nào dùng');
    expect(sent(s, 'POST', '/api/admin/chest-styles')[0].body).toMatchObject({
      name: 'Bến cảng gió mùa', nameEn: 'Monsoon Wharf', stampText: 'GIÓ MÙA', particles: 'fall',
      backdropUrl: at('ben-cang.png'), chestImageUrl: at('hom-gio-mua.png'), keyImageUrl: at('chia-gio-mua.png'), particleUrl: at('giot-mua.png'),
    });

    // The chest's Kiểu hòm field offers it; the preview shows its chest picture.
    await page.goto('/admin/chests/chest_np');
    await expect(page.locator('select[name="template"] optgroup[label="Kiểu tự tạo"] option')).toHaveText(['Bến cảng gió mùa']);
    await page.locator('select[name="template"]').selectOption('style_001');
    await expect(page.locator('[data-ac-look-preview] img')).toHaveAttribute('src', /hom-gio-mua\.png$/);
    await expect.poll(() => sent(s, 'POST', '/api/admin/chests/chest_np/check').at(-1)?.body?.look?.template).toBe('style_001');
  });

  test('percentages become weights out of 10,000, and a wrong total blocks saving with the server\'s message', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=bang-roi');

    const common = page.locator('input[data-weight="COMMON"]');
    await expect(common).toHaveValue('80');
    await expect(page.locator('[data-ac-total]')).toContainText('100');

    await common.fill('79.5');
    await expect(page.locator('[data-ac-total]')).toContainText('99,5');
    await expect(page.locator('[data-ac-total]')).toHaveAttribute('data-valid', 'false');
    await expect(page.locator('.ac-errors')).toContainText('Tổng trọng số phải bằng 10.000');
    await expect(page.locator('[data-ac-save]')).toBeDisabled();

    await page.locator('input[data-weight="RARE"]').fill('15.5');
    await expect(page.locator('[data-ac-total]')).toHaveAttribute('data-valid', 'true');
    await expect(page.locator('.ac-errors')).toHaveCount(0);
    await expect(page.locator('[data-ac-save]')).toBeEnabled();
    await expect(page.locator('[data-ac-ev]')).toContainText('111');
    await expect(page.locator('[data-ac-cost]')).toContainText('300');
    const lastCheck = sent(s, 'POST', '/check').at(-1)!.body!;
    expect(lastCheck.dropWeights).toMatchObject({ COMMON: 7950, RARE: 1550 });
  });

  test('the pool is split by rarity, adding excludes what cannot go in, and each item shows its real rate', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=bang-roi');

    await expect(page.locator('[data-pool-column="COMMON"] [data-pool-item]')).toHaveCount(2);
    await expect(page.locator('[data-pool-column="RARE"] [data-pool-item]')).toHaveCount(2);
    await expect(page.locator('[data-pool-item="VC-0388"] [data-ac-rate]')).toContainText('40');

    await page.locator('[data-ac-add-item]').click();
    const picker = page.locator('dialog.ac-dialog[open]');
    await expect(picker.locator('[data-pick-item="VC-0500"]')).toBeVisible();
    await expect(picker.locator('[data-pick-item="title_tan-binh"]')).toBeVisible();
    await expect(picker.locator('[data-pick-item="VC-0388"]')).toHaveCount(0); // Already in.
    await expect(picker.locator('[data-pick-item="VC-0600"]')).toHaveCount(0); // Retired.
    await expect(picker.locator('[data-pick-item="chest_np"]')).toHaveCount(0);
    await expect(picker.locator('[data-pick-item="key_np"]')).toHaveCount(0);

    await picker.locator('[data-ac-pick-search]').fill('tân binh');
    await expect(picker.locator('[data-pick-item]')).toHaveCount(1);
    await picker.locator('[data-pick-item="title_tan-binh"]').click();
    await page.locator('dialog.ac-dialog[open] [data-ac-dialog-close]').click();

    const column = page.locator('[data-pool-column="EPIC"]');
    await expect(column.locator('[data-pool-item="title_tan-binh"]')).toBeVisible();
    // The title's own plaque, drawn in the art cell (the remove button beside it is an svg too).
    await expect(column.locator('[data-pool-item="title_tan-binh"] .ac-pool-art').locator('.hs-plaque, svg').first()).toBeVisible();
    await expect.poll(() => sent(s, 'POST', '/check').at(-1)!.body!.pool).toContain('title_tan-binh');

    await page.locator('[data-pool-item="VC-0402"] [data-ac-remove]').click();
    await expect(page.locator('[data-pool-item="VC-0402"]')).toHaveCount(0);
  });

  test('saving shows what changes, demands a reason, and applies', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=bang-roi');

    await expect(page.locator('[data-ac-save]')).toBeDisabled(); // Nothing to save yet.
    await page.locator('[data-pool-item="VC-0402"] [data-ac-remove]').click();
    await page.locator('input[data-weight="COMMON"]').fill('70');
    await page.locator('input[data-weight="RARE"]').fill('25');
    await expect(page.locator('[data-ac-save]')).toBeEnabled();
    await page.locator('[data-ac-save]').click();

    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog).toContainText('Phiếu vân tay'); // The item removed, by name.
    await expect(dialog).toContainText('Thường');
    await expect(dialog).toContainText('70');

    await dialog.locator('[data-ac-confirm]').click();
    await expect(dialog.locator('.ac-errors')).toContainText('lý do');
    expect(sent(s, 'PUT', '/api/admin/chests/chest_np')).toHaveLength(0);

    await dialog.locator('[name="reason"]').fill('Cân lại tỉ lệ');
    await dialog.locator('[data-ac-confirm]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);

    const body = sent(s, 'PUT', '/api/admin/chests/chest_np')[0].body!;
    expect(body).toMatchObject({ reason: 'Cân lại tỉ lệ', expectedVersion: 2 });
    expect(body.dropWeights).toMatchObject({ COMMON: 7000, RARE: 2500, MYSTERY: 500 });
    expect(body.pool).not.toContain('VC-0402');
    await expect(page.locator('[data-ac-save]')).toBeDisabled();
  });

  test('the weekly challenge weight sits beside the order, shows the saved share, and is saved with the chest', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');

    const weight = page.locator('input[name="challengeWeight"]');
    await expect(page.getByText('Trọng số rớt ở Thử thách tuần')).toBeVisible();
    await expect(weight).toHaveValue('60');
    await expect(weight).toHaveAttribute('type', 'number');
    await expect(weight).toHaveAttribute('min', '0');
    await expect(weight).toHaveAttribute('max', '10000');
    await expect(weight).toHaveAttribute('step', '1');
    await expect(page.locator('[data-ac-challenge-hint]')).toHaveText('Hiện chiếm 60% số hòm rớt ở Thử thách tuần. 0 = không rớt.');
    await expect(page.locator('[data-ac-save]')).toBeDisabled(); // Showing the weight is not a change.

    await weight.fill('25');
    await expect(page.locator('[data-ac-save]')).toBeEnabled();
    expect(sent(s, 'POST', '/check').at(-1)!.body!.challengeWeight).toBe(25);
    await page.locator('[data-ac-save]').click();

    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog).toContainText('Trọng số Thử thách tuần'); // Named in the "what changes" list.
    await expect(dialog).toContainText('60 → 25');
    await dialog.locator('[name="reason"]').fill('Giảm hòm thường');
    await dialog.locator('[data-ac-confirm]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);

    expect(sent(s, 'PUT', '/api/admin/chests/chest_np')[0].body).toMatchObject({ challengeWeight: 25, reason: 'Giảm hòm thường', expectedVersion: 2 });
    // The share under the box is the server's, for what was saved.
    await expect(weight).toHaveValue('25');
    await expect(page.locator('[data-ac-challenge-hint]')).toContainText('38,46%');
  });

  test('a chest that never drops in the weekly challenge says so under the weight box', async ({ page }) => {
    const s = state();
    s.chest.challengeWeight = 0;
    s.chest.challengePercent = 0;
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');

    await expect(page.locator('input[name="challengeWeight"]')).toHaveValue('0');
    await expect(page.locator('[data-ac-challenge-hint]')).toHaveText('Hiện chiếm 0% số hòm rớt ở Thử thách tuần. 0 = không rớt.');
  });

  test('a save refused by the server stays open with its reasons', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.route('**/api/admin/chests/chest_np', (route) => route.request().method() === 'PUT'
      ? refuse(route, 400, 'ADMIN_VALIDATION', 'Giá trị kỳ vọng quá cao.', [{ code: 'CHEST_EXPECTED_VALUE_TOO_HIGH', message: 'Giá trị kỳ vọng quá cao.' }])
      : route.fallback());
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');

    await page.locator('[name="chestPrice"]').fill('2');
    await expect(page.locator('[data-ac-save]')).toBeEnabled();
    await page.locator('[data-ac-save]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="reason"]').fill('Thử');
    await dialog.locator('[data-ac-confirm]').click();

    await expect(dialog.locator('.ac-errors')).toContainText('Giá trị kỳ vọng quá cao');
  });

  test('a collection\'s chest stands out in the list with its night street, its outfits and a legend ribbon', async ({ page }) => {
    const s = state();
    s.otherChests.push(whitechapelChest());
    await prepare(page, s);
    await page.goto('/admin/chests');

    const plain = page.locator('[data-chest-id="chest_np"]');
    const card = page.locator('[data-chest-id="chest_wc"]');
    await expect(card).toHaveClass(/ac-chest-card--showcase/);
    await expect(plain).not.toHaveClass(/ac-chest-card--showcase/);
    await expect(plain.locator('.ac-show-figure, .ac-show-ribbon, .ac-show-sky')).toHaveCount(0);

    await expect(card.locator('.ac-show-ribbon')).toHaveText(/Bộ sưu tập Huyền thoại/);
    await expect(card.locator('.ac-show-era')).toHaveText('Phố Whitechapel · Nº 1888');
    await expect(card.locator('.ac-show-figure--l')).toHaveAttribute('src', '/assets/pixel/skins/whitechapel/icon-sherlock.png');
    await expect(card.locator('.ac-show-figure--r')).toHaveAttribute('src', '/assets/pixel/skins/whitechapel/icon-watson.png');
    await expect(card.locator('.ac-show-figure--l')).toHaveAttribute('title', 'Sherlock · Kẻ Săn Bóng Đêm');
    for (const figure of await card.locator('.ac-show-figure').all()) {
      await expect.poll(() => figure.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(192);
    }
    // Its own drawing, not the seal chest's.
    const art = card.locator('.ac-chest-art img');
    await expect(art).toHaveAttribute('src', /^data:image\/png/);
    expect(await art.getAttribute('src')).not.toBe(await plain.locator('.ac-chest-art img').getAttribute('src'));

    // The same facts and buttons as every card.
    await expect(card.locator('h2 a[href="/admin/chests/chest_wc"]')).toHaveText('Hòm Đêm Whitechapel');
    await expect(card.locator('[data-ac-ev]')).toContainText('260 / 440');
    await expect(card.locator('[data-ac-challenge]')).toContainText('Không rớt');
    await expect(card.locator('[data-ac-toggle]')).toHaveText('Tắt');
    await expect(card.locator('[data-ac-clone]')).toBeVisible();

    // A night card as wide as the list, the outfits standing either side of the chest.
    const grid = await page.locator('.ac-chest-grid').boundingBox();
    const box = await card.boundingBox();
    expect(Math.abs(box!.width - grid!.width)).toBeLessThan(2);
    const left = await card.locator('.ac-show-figure--l').boundingBox();
    const chestBox = await card.locator('.ac-chest-art').boundingBox();
    const right = await card.locator('.ac-show-figure--r').boundingBox();
    expect(left!.x).toBeLessThan(chestBox!.x);
    expect(chestBox!.x).toBeLessThan(right!.x);
    expect(await card.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient');
    expect(await plain.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  });

  test('cloning the showcase chest asks for a name, like any chest', async ({ page }) => {
    const s = state();
    s.otherChests.push(whitechapelChest());
    await prepare(page, s);
    await page.goto('/admin/chests');
    await page.locator('[data-chest-id="chest_wc"] [data-ac-clone]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toBeVisible();
  });

  test('the edit page of a collection\'s chest opens on its night street, and goes plain when another drawing is saved', async ({ page }) => {
    const s = state();
    dressAsWhitechapel(s);
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');

    const head = page.locator('[data-ac-head]');
    await expect(head).toHaveClass(/ac-detail-head--showcase/);
    await expect(head.locator('.ac-show-ribbon')).toHaveText(/Bộ sưu tập Huyền thoại/);
    await expect(head.locator('.ac-show-figure')).toHaveCount(2);
    await expect(head.locator('.ac-show-sky')).toHaveCount(1);
    const left = await head.locator('.ac-show-figure--l').boundingBox();
    const chestBox = await head.locator('[data-ac-head-art]').boundingBox();
    const right = await head.locator('.ac-show-figure--r').boundingBox();
    expect(left!.x).toBeLessThan(chestBox!.x);
    expect(chestBox!.x).toBeLessThan(right!.x);
    await expect(page.locator('[name="template"]')).toHaveValue('whitechapel');
    await expect(page.locator('[name="template"] option[value="whitechapel"]')).toHaveText('Hòm đêm Whitechapel (bộ sưu tập)');

    // Saving the seal drawing: the head becomes the plain one, with nothing of the night left behind.
    await page.locator('[name="template"]').selectOption('seal');
    await page.locator('[data-ac-save]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="reason"]').fill('Về hình thường');
    await dialog.locator('[data-ac-confirm]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
    expect(sent(s, 'PUT', '/api/admin/chests/chest_np')[0].body!.look).toMatchObject({ template: 'seal' });
    await expect(head).not.toHaveClass(/ac-detail-head--showcase/);
    await expect(head.locator('.ac-show-figure, .ac-show-ribbon, .ac-show-sky')).toHaveCount(0);
    await expect(head.locator('.ac-head-ribbon')).toBeHidden();
  });

  test('an everyday chest\'s head is laid out as before the showcase existed', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np');
    const head = page.locator('[data-ac-head]');
    await expect(head.locator('h1')).toHaveText('Hòm Niêm Phong');
    // The empty slots of the showcase take no room: the art sits at the left edge and the title starts 18 px after it.
    const headBox = await head.boundingBox();
    const art = await head.locator('[data-ac-head-art]').boundingBox();
    const title = await head.locator('.ac-detail-title').boundingBox();
    expect(Math.abs(art!.x - headBox!.x)).toBeLessThan(1);
    expect(Math.abs(title!.x - (art!.x + art!.width + 18))).toBeLessThan(1);
    expect(Math.abs((await head.locator('.ac-detail-name').boundingBox())!.y - title!.y)).toBeLessThan(1);
  });

  test('the showcase fits a phone, and its lamps and glow stay still when the player asks for less motion', async ({ page }) => {
    const s = state();
    s.otherChests.push(whitechapelChest());
    await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page, s);
    await page.goto('/admin/chests');
    const card = page.locator('[data-chest-id="chest_wc"]');
    await expect(card.locator('.ac-show-figure')).toHaveCount(2);
    await expectNoSidewaysScroll(page);
    const stage = await card.locator('.ac-show-stage').boundingBox();
    const body = await card.locator('.ac-show-body').boundingBox();
    expect(body!.y).toBeGreaterThanOrEqual(stage!.y + stage!.height - 1);
    for (const selector of ['.ac-show-figure--l', '.ac-chest-art', '.ac-show-figure--r']) {
      const box = (await card.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(stage!.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1);
    }
    const animation = () => card.locator('.ac-chest-art img').evaluate((img) => getComputedStyle(img).animationName);
    expect(await animation()).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(animation).toBe('ac-show-glow');

    dressAsWhitechapel(s);
    await page.goto('/admin/chests/chest_np');
    await expect(page.locator('[data-ac-head]')).toHaveClass(/ac-detail-head--showcase/);
    await expectNoSidewaysScroll(page);
  });

  test('the look shows the real sprite and follows the choice', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');

    const preview = page.locator('[data-ac-look-preview] img');
    const before = await preview.getAttribute('src');
    await page.locator('[name="template"]').selectOption('bank');
    await expect.poll(() => preview.getAttribute('src')).not.toBe(before);

    await page.locator('[name="light"]').fill('#112233');
    await expect(page.locator('[data-ac-look-preview]')).toHaveAttribute('style', /17, ?34, ?51/);
    await expect(page.locator('[data-ac-save]')).toBeEnabled();
    await page.locator('[data-ac-save]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="reason"]').fill('Đổi hình');
    await dialog.locator('[data-ac-confirm]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
    expect(sent(s, 'PUT', '/api/admin/chests/chest_np')[0].body!.look).toMatchObject({ template: 'bank', light: '17,34,51' });
  });

  test('the chest and its key get their own uploaded pictures, saved with the chest and shown when trying it out', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    // A tiny PNG for every picture the browser fetches, so nothing leaves the machine.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.route('https://res.cloudinary.com/**', (route) => route.fulfill({ contentType: 'image/png', body: png }));
    const uploads = ['https://res.cloudinary.com/demo/image/upload/sirlocked/admin/hom-wc.png', 'https://res.cloudinary.com/demo/image/upload/sirlocked/admin/chia-wc.png'];
    await page.route((url) => url.pathname === '/api/admin/assets', (route) => route.fulfill({ json: { success: true, data: { url: uploads.shift(), width: 256, height: 256 } } }));
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');

    const rows = page.locator('[data-ac-pictures]');
    await expect(rows.locator('[data-ac-picture-row="imageUrl"]')).toContainText('Tải ảnh lên');
    await expect(rows.locator('[data-ac-picture-remove]')).toHaveCount(0);

    // A JPEG is refused before it is sent: a chest needs a transparent background.
    await page.locator('[data-ac-picture-input="imageUrl"]').setInputFiles({ name: 'hom.jpg', mimeType: 'image/jpeg', buffer: png });
    await expect(page.locator('#toast-root')).toContainText('PNG hoặc WebP');
    await expect(page.locator('[data-ac-look-preview] img')).not.toHaveClass(/is-picture/);

    await page.locator('[data-ac-picture-input="imageUrl"]').setInputFiles({ name: 'hom.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('[data-ac-look-preview] img')).toHaveAttribute('src', /hom-wc\.png$/);
    await expect(page.locator('[data-ac-look-preview] img')).toHaveClass(/is-picture/);
    await page.locator('[data-ac-picture-input="keyImageUrl"]').setInputFiles({ name: 'chia.webp', mimeType: 'image/webp', buffer: png });
    await expect(rows.locator('[data-ac-picture-row="keyImageUrl"] img')).toHaveAttribute('src', /chia-wc\.png$/);
    // The check the server makes on every change already carries both pictures.
    await expect.poll(() => sent(s, 'POST', '/api/admin/chests/chest_np/check').at(-1)?.body?.look?.keyImageUrl).toBe('https://res.cloudinary.com/demo/image/upload/sirlocked/admin/chia-wc.png');

    // The key's picture goes again: the template's key comes back.
    await rows.locator('[data-ac-picture-remove="keyImageUrl"]').click();
    await expect(rows.locator('[data-ac-picture-row="keyImageUrl"] img')).toHaveCount(0);

    await expect(page.locator('[data-ac-save]')).toBeEnabled();
    await page.locator('[data-ac-save]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="reason"]').fill('Ảnh riêng cho hòm');
    await dialog.locator('[data-ac-confirm]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
    expect(sent(s, 'PUT', '/api/admin/chests/chest_np')[0].body!.look).toMatchObject({
      template: 'seal', imageUrl: 'https://res.cloudinary.com/demo/image/upload/sirlocked/admin/hom-wc.png', keyImageUrl: null,
    });
    await expect(page.locator('[data-ac-head-art] img')).toHaveAttribute('src', /hom-wc\.png$/);

    // Players see the picture in the chest's place, in the template's room.
    await page.locator('[data-ac-preview]').click();
    const overlay = page.locator('.ac-preview');
    await expect(overlay.locator('#qh-chestImg')).toHaveAttribute('src', /hom-wc\.png$/);
    await expect(overlay.locator('#qh-chestImg')).toHaveClass(/qh-custom/);
    await expect(overlay.locator('#qh-chestImg')).not.toHaveClass(/qh-px/);
  });

  test('saving stays closed while any picture is still uploading, even when the other one has landed', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.route('https://res.cloudinary.com/**', (route) => route.fulfill({ contentType: 'image/png', body: png }));
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    await page.route((url) => url.pathname === '/api/admin/assets', async (route) => {
      const call = ++calls;
      if (call === 1) await held; // The chest's picture is slow; the key's lands at once.
      return route.fulfill({ json: { success: true, data: { url: `https://res.cloudinary.com/demo/image/upload/sirlocked/admin/p${call}.png`, width: 64, height: 64 } } });
    });
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');

    await page.locator('[data-ac-picture-input="imageUrl"]').setInputFiles({ name: 'hom.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('[data-ac-picture-row="imageUrl"]')).toContainText('Đang tải ảnh');
    await page.locator('[data-ac-picture-input="keyImageUrl"]').setInputFiles({ name: 'chia.png', mimeType: 'image/png', buffer: png });
    await expect(page.locator('[data-ac-picture-row="keyImageUrl"] img')).toHaveAttribute('src', /p2\.png$/);
    await expect.poll(() => sent(s, 'POST', '/api/admin/chests/chest_np/check').length).toBeGreaterThan(0);
    await expect(page.locator('[data-ac-save]')).toBeDisabled();
    await expect(page.locator('[data-ac-picture-row="imageUrl"]')).toContainText('Đang tải ảnh');

    release();
    await expect(page.locator('[data-ac-picture-row="imageUrl"] img')).toHaveAttribute('src', /p1\.png$/);
    await expect(page.locator('[data-ac-save]')).toBeEnabled();
  });

  test('a check still on its way when the draft changes again cannot open saving', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    const gates: Array<() => void> = [];
    const heldAt = (call: number) => new Promise<void>((resolve) => { gates[call] = resolve; });
    const held = [heldAt(0), heldAt(1)];
    let checks = 0;
    await page.route('**/api/admin/chests/chest_np/check', async (route) => {
      checks += 1;
      // The first check comes with the page; the next two belong to the test.
      if (checks >= 2) await held[checks - 2];
      await route.fallback();
    });
    await page.goto('/admin/chests/chest_np?tab=thiet-lap');
    await expect(page.locator('[name="chestPrice"]')).toHaveValue('120');

    await page.locator('[name="chestPrice"]').fill('130');
    await expect.poll(() => checks).toBe(2);
    await page.locator('[name="chestPrice"]').fill('140');
    gates[0](); // The answer about 130 arrives, while 140 waits its turn.
    await page.waitForTimeout(500);
    await expect(page.locator('[data-ac-save]')).toBeDisabled();

    await expect.poll(() => checks).toBe(3);
    gates[1]();
    await expect(page.locator('[data-ac-save]')).toBeEnabled();
    await expect(page.locator('[data-ac-cost]')).toContainText('320');
  });

  test('history lists versions and restores an older one after confirming', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=lich-su');

    await expect(page.locator('[data-version="2"]')).toContainText('Tăng giá');
    await expect(page.locator('[data-version="2"]')).toContainText('Yến');
    await expect(page.locator('[data-version="2"] [data-ac-restore]')).toHaveCount(0); // It is the current one.
    await expect(page.locator('[data-version="2"] .ac-version-sum')).toContainText('thử thách 60');
    await expect(page.locator('[data-version="1"] .ac-version-sum')).toContainText('thử thách 30');
    await expect(page.locator('[data-version="2"] .ac-diff')).toContainText('Trọng số Thử thách tuần'); // Not the raw field name.

    await page.locator('[data-version="1"] [data-ac-restore]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="reason"]').fill('Giá cũ tốt hơn');
    await dialog.locator('[data-ac-confirm]').click();

    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
    expect(sent(s, 'POST', '/versions/1/restore')[0].body).toEqual({ expectedVersion: 2, reason: 'Giá cũ tốt hơn' });
  });

  test('the header save button goes away on the history tab, like the save bar, and comes back on the settings tab', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=lich-su');
    await expect(page.locator('[data-version="2"]')).toBeVisible();
    await expect(page.locator('[data-ac-savebar]')).toBeHidden();
    await expect(page.locator('[data-ac-save-head]')).toBeHidden();
    await page.locator('[data-ac-tab="thiet-lap"]').click();
    await expect(page.locator('[data-ac-save-head]')).toBeVisible();
  });

  test('trying a chest out plays the real screen against the preview API and spends nothing', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np');

    await page.locator('[data-ac-preview]').click();
    const overlay = page.locator('.ac-preview');
    await expect(overlay.locator('#qh-caseName')).toHaveText('Hòm Niêm Phong');
    await expect(overlay.locator('#qh-contents .qh-it')).toHaveCount(5);
    await expect(overlay.locator('#qh-odds')).toContainText('15,00%');
    await expect(overlay.locator('#qh-buy')).toBeHidden();
    await expect(overlay.locator('#qh-openLbl')).toHaveText('Mở hòm');

    await overlay.locator('#qh-openBtn').click();
    await expect(overlay.locator('#qh-gotName')).toHaveText('Đồng hồ 2:17', { timeout: 20_000 });
    expect(sent(s, 'POST', '/preview/open')).toHaveLength(1);
    expect(s.requests.filter((r) => r.path.startsWith('/api/chests'))).toHaveLength(0);

    await overlay.locator('[data-ac-preview-close]').click();
    await expect(page.locator('.ac-preview')).toHaveCount(0);
    await expect(page.locator('[data-ac-preview]')).toBeVisible();
  });

  test('asking to try a chest out twice opens one screen, and leaving the page closes it', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np');

    await page.locator('[data-ac-preview]').click();
    await expect(page.locator('.ac-preview #qh-caseName')).toHaveText('Hòm Niêm Phong');
    await page.evaluate(() => (document.querySelector('[data-ac-preview]') as HTMLElement).click());
    await expect(page.locator('.ac-preview')).toHaveCount(1);

    await page.evaluate(() => { history.pushState(null, '', '/admin/items'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.locator('.ac-preview')).toHaveCount(0);
  });

  test('statistics compare real and configured rates, over 7 or 30 days', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests/chest_np?tab=thong-ke');

    await expect(page.locator('[data-ac-stat="opens"]')).toHaveText('10');
    await expect(page.locator('[data-ac-stat="chests"]')).toContainText('1.200');
    await expect(page.locator('[data-ac-stat="keys"]')).toContainText('1.800');
    const rare = page.locator('[data-rate="RARE"]');
    await expect(rare).toContainText('10');
    await expect(rare).toContainText('15');
    await expect(rare.locator('[data-bar="actual"]')).toHaveAttribute('style', /width:\s*10%/);
    await expect(page.locator('[data-ac-top]')).toContainText('Sổ tay da bò');
    await expect(page.locator('[data-ac-rare-drops]')).toContainText('Thám tử An');

    await page.locator('[data-ac-days="30"]').click();
    await expect(page.locator('[data-ac-stat="opens"]')).toHaveText('40');
  });

  test('the opening log filters and pages', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests?tab=nhat-ky');

    await expect(page.locator('[data-opening]')).toHaveCount(2);
    await page.locator('[data-ac-next-page]').click();
    await expect(page.locator('[data-opening]')).toHaveCount(1);
    await expect(page.locator('[data-opening]')).toContainText('Thám tử Bình');

    await page.locator('[name="player"]').fill('Bình');
    await page.locator('[data-ac-log-apply]').click();
    await expect(page.locator('[data-opening]')).toHaveCount(1);
    expect(sent(s, 'GET', 'player=')[0].path).toContain(`player=${encodeURIComponent('Bình')}`);
  });

  test('an older search answering late does not replace the newer one', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.route('**/api/admin/chests/openings*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('player') === 'An') await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fallback();
    });
    await page.goto('/admin/chests?tab=nhat-ky');
    await expect(page.locator('[data-opening]')).toHaveCount(2);

    await page.locator('[name="player"]').fill('An');
    await page.locator('[data-ac-log-apply]').click();
    await page.locator('[name="player"]').fill('Bình');
    await page.locator('[data-ac-log-apply]').click();
    await expect(page.locator('[data-opening]')).toHaveCount(1);

    await page.waitForTimeout(1200);
    await expect(page.locator('[data-opening]')).toHaveCount(1);
    await expect(page.locator('[data-opening]')).toContainText('Bình');
  });

  test('a grant sent again after a failure keeps its request id, so the server gives once', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    const ids: string[] = [];
    await page.route('**/api/admin/chests/grant', async (route) => {
      ids.push(route.request().postDataJSON().requestId);
      if (ids.length === 1) return route.fulfill({ status: 500, json: { success: false, message: 'Mất kết nối' } });
      return route.fallback();
    });
    await page.goto('/admin/chests?tab=cap');
    await page.locator('[data-ac-player-search]').fill('an');
    await page.locator('[data-ac-player="u9"]').click();
    await page.locator('[data-ac-grant]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await dialog.locator('[name="reason"]').fill('Đền bù');

    await dialog.locator('[data-ac-confirm]').click();
    await expect(dialog.locator('.ac-errors')).toBeVisible();
    await dialog.locator('[data-ac-confirm]').click();
    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(new Set(ids).size).toBe(1);
  });

  test('granting finds a player by name, then sends chests, keys and a reason', async ({ page }) => {
    const s = state();
    await prepare(page, s);
    await page.goto('/admin/chests?tab=cap');

    await page.locator('[data-ac-player-search]').fill('an');
    await page.locator('[data-ac-player="u9"]').click();
    await page.locator('[name="chests"]').fill('2');
    await page.locator('[name="keys"]').fill('1');
    await page.locator('[data-ac-grant]').click();
    const dialog = page.locator('dialog.ac-dialog[open]');
    await expect(dialog).toContainText('Thám tử An');
    await dialog.locator('[name="reason"]').fill('Đền bù');
    await dialog.locator('[data-ac-confirm]').click();

    await expect(page.locator('dialog.ac-dialog[open]')).toHaveCount(0);
    expect(sent(s, 'POST', '/api/admin/chests/grant')[0].body).toEqual({ userId: 'u9', chestId: 'chest_np', chests: 2, keys: 1, reason: 'Đền bù', requestId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/) });
  });

  for (const hash of ['/admin/chests', '/admin/chests?tab=nhat-ky', '/admin/chests?tab=cap', '/admin/chests/chest_np?tab=thiet-lap', '/admin/chests/chest_np?tab=bang-roi', '/admin/chests/chest_np?tab=lich-su', '/admin/chests/chest_np?tab=thong-ke']) {
    test(`${hash} fits a phone`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const s = state();
      await prepare(page, s);
      await page.goto(hash);
      await expect(page.locator('.ac-page')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expectNoSidewaysScroll(page);
    });
  }

  test('someone who is not an admin does not get the page', async ({ page }) => {
    const s = state();
    await prepare(page, s, 'PLAYER');
    await page.goto('/admin/chests');
    await expect(page.locator('.ac-page')).toHaveCount(0);
    expect(sent(s, 'GET', '/api/admin/chests')).toHaveLength(0);
  });
});
