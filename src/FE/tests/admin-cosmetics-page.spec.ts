import { expect, test, type Page, type Route } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * /admin/cosmetics with the API answered here: what the page asks the server to do, and what it shows.
 * The same flows against a real server are in admin-cosmetics-full-stack.spec.ts.
 */
type Item = Record<string, any>;

const PICTURE = '/assets/cosmetics/vien-dong.webp';
const ok = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const refuse = (route: Route, status: number, code: string, message: string) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: false, message, errors: { code } }) });

const way = (mode: string, extra: Record<string, unknown> = {}) => ({ mode, level: null, metric: null, target: null, chests: [], ...extra });
const item = (id: string, category: string, name: string, extra: Item = {}): Item => ({
  id, category, name, nameEn: name, rarity: 'RARE', description: '', descriptionEn: '', displayDescription: name, referencePrice: 340, tradable: true, retired: false,
  sortOrder: 1, version: 1, updatedAt: '2026-11-05T00:00:00Z', updatedBy: null, owners: 0,
  visual: { iconKey: id, imageUrl: null, builtinId: id.replace(/^[a-z]+_/, ''), template: null, params: {} }, acquisition: way('admin'), ...extra,
});

function seedPage() {
  return {
    items: [
      item('frame_dong', 'FRAME', 'Đồng Cổ', { rarity: 'COMMON', tradable: false, owners: 3, acquisition: way('level', { level: 10 }) }),
      item('frame_kimlong', 'FRAME', 'Kim Long', { rarity: 'MYSTERY', owners: 7, acquisition: way('admin', { chests: [{ id: 'chest_nb', name: 'Két Nhà Băng', active: true }] }) }),
      item('frame_bang', 'FRAME', 'Hàn Băng', { rarity: 'EPIC', retired: true }),
      item('title_tan-binh', 'TITLE', 'Tân Binh', { rarity: 'COMMON', tradable: false, acquisition: way('default') }),
      item('title_kim-long', 'TITLE', 'Kim Long Phá Án', { rarity: 'MYSTERY' }),
      item('entrance_lang-le', 'ENTRANCE', 'Bước Vào Lặng Lẽ', { rarity: 'COMMON', tradable: false, acquisition: way('default') }),
      item('entrance_kim-long', 'ENTRANCE', 'Kim Long Giáng Thế', { rarity: 'MYSTERY' }),
    ],
    metrics: ['Played', 'Won', 'MidnightWins', 'NoHintWins', 'CluesFound', 'TestimoniesRecorded', 'OwnsWatch217'],
    rareXp: 150,
    epicXp: 600,
    maxLevel: 50,
    defaults: { frame: null, title: 'title_tan-binh', entrance: 'entrance_lang-le' },
    problems: [] as string[],
  };
}

/** A small server: remembers what the page saved and says what was sent. */
async function prepare(page: Page, options: { reduced?: boolean } = {}) {
  const state = { page: seedPage(), sent: [] as Array<{ method: string; path: string; body: any }>, uploads: 0 };
  if (options.reduced !== false) await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInAs(page, 'ADMIN');
  const find = (id: string) => state.page.items.find((entry) => entry.id === id)!;
  await page.route((url) => url.pathname.startsWith('/api/admin/cosmetics'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/admin/cosmetics', '');
    const method = request.method();
    const body = method === 'GET' || method === 'DELETE' ? null : request.postDataJSON();
    if (method !== 'GET') state.sent.push({ method, path: path + url.search, body });
    if (method === 'GET' && path === '') return ok(route, state.page);
    if (method === 'GET' && path === '/players') {
      return ok(route, url.searchParams.get('q')?.includes('Nam') ? [{ id: 'u9', fullName: 'Thám tử Nam', email: 'nam@tests.invalid', level: 7 }] : []);
    }
    if (method === 'PUT' && path === '/settings/xp') {
      state.page.rareXp = body.rareXp;
      state.page.epicXp = body.epicXp;
      return ok(route, { rareXp: body.rareXp, epicXp: body.epicXp });
    }
    if (method === 'POST' && path === '') {
      const prefix = { FRAME: 'frame_', TITLE: 'title_', ENTRANCE: 'entrance_' }[body.category as string];
      const created = item(`${prefix}moi`, body.category, body.name, {
        rarity: body.rarity, tradable: body.tradable, visual: { iconKey: `${prefix}moi`, imageUrl: body.visual.imageUrl, builtinId: null, template: body.visual.template, params: body.visual.params },
      });
      state.page.items.push(created);
      return ok(route, created);
    }
    const [, id, action] = path.split('/');
    const current = find(decodeURIComponent(id));
    if (method === 'PUT' && !action) {
      Object.assign(current, { name: body.name, rarity: body.rarity, tradable: body.tradable, version: current.version + 1 });
      if (body.visual && current.visual.template) current.visual = { ...current.visual, imageUrl: body.visual.imageUrl, template: body.visual.template, params: body.visual.params };
      return ok(route, current);
    }
    if (method === 'PUT' && action === 'acquisition') {
      current.acquisition = way(body.mode, body.mode === 'level' ? { level: body.level } : body.mode === 'achievement' ? { metric: body.metric, target: body.target } : {});
      if (body.mode !== 'admin') current.tradable = false;
      return ok(route, current);
    }
    if (method === 'PUT' && action === 'retired') {
      current.retired = body.retired;
      return ok(route, current);
    }
    if (method === 'DELETE') {
      state.page.items = state.page.items.filter((entry) => entry !== current);
      return ok(route, null);
    }
    if (method === 'POST' && action === 'grant') return ok(route, { userId: body.userId, defId: current.id, slotsUsed: 1, slotCap: 60 });
    return route.fallback();
  });
  await page.route((url) => url.pathname === '/api/admin/assets', (route) => {
    state.uploads += 1;
    return ok(route, { url: PICTURE, width: 247, height: 259 });
  });
  return state;
}

/** A PNG made in the page: transparent corners and an opaque ring, or fully opaque. */
async function picture(page: Page, { transparent = true } = {}) {
  const base64 = await page.evaluate((clear) => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const context = canvas.getContext('2d')!;
    if (!clear) { context.fillStyle = '#222'; context.fillRect(0, 0, 200, 200); }
    context.strokeStyle = '#c7a24b';
    context.lineWidth = 30;
    context.beginPath();
    context.arc(100, 100, 80, 0, Math.PI * 2);
    context.stroke();
    return canvas.toDataURL('image/png').split(',')[1];
  }, transparent);
  return { name: 'vien.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

const canvasHasPaint = (page: Page, selector: string) => page.locator(selector).first().evaluate((canvas: HTMLCanvasElement) => {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(canvas, 0, 0);
  const { data } = context.getImageData(0, 0, copy.width, copy.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
});

const hashOf = (page: Page) => page.evaluate(() => window.location.pathname + window.location.search);

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

// ------------------------------------------------------------------ the grid

test('the frames tab shows every live frame with its owners and how it is obtained', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics');

  await expect(page.getByRole('heading', { name: 'Mỹ phẩm', exact: true })).toBeVisible();
  const dong = page.locator('[data-card="frame_dong"]');
  await expect(dong).toContainText('Đồng Cổ');
  await expect(dong.locator('[data-owners]')).toHaveText('3 sở hữu');
  await expect(dong.locator('[data-way]')).toHaveText('Cấp 10');
  await expect(page.locator('[data-card="frame_kimlong"] [data-way]')).toContainText('Hòm: Két Nhà Băng');
  // Retired items wait behind the filter.
  await expect(page.locator('[data-card="frame_bang"]')).toHaveCount(0);
  await expect.poll(() => canvasHasPaint(page, '[data-card="frame_dong"] canvas')).toBe(true);
});

test('the filters narrow the grid by rarity, way of getting it and retired', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics');
  await expect(page.locator('[data-card]')).toHaveCount(2);

  await page.locator('[data-filter="rarity"]').selectOption('MYSTERY');
  await expect(page.locator('[data-card]')).toHaveCount(1);
  await page.locator('[data-filter="rarity"]').selectOption('');

  await page.locator('[data-filter="way"]').selectOption('level');
  await expect(page.locator('[data-card="frame_dong"]')).toBeVisible();
  await expect(page.locator('[data-card]')).toHaveCount(1);
  await page.locator('[data-filter="way"]').selectOption('chest');
  await expect(page.locator('[data-card="frame_kimlong"]')).toBeVisible();
  await page.locator('[data-filter="way"]').selectOption('');

  await page.locator('[data-filter="state"]').selectOption('retired');
  await expect(page.locator('[data-card="frame_bang"]')).toContainText('đã retire');
  await expect(page.locator('[data-card]')).toHaveCount(1);
  await page.locator('[data-filter="state"]').selectOption('live');
});

test('titles and entrances have their own tabs, drawn as players see them', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics?tab=TITLE');
  await expect(page.locator('[data-card="title_kim-long"] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Kim Long Phá Án');
  await expect(page.locator('[data-card="title_tan-binh"] [data-way]')).toHaveText('Mặc định');

  await page.getByRole('link', { name: 'Hiệu ứng vào sảnh' }).click();
  await expect(page.locator('[data-card="entrance_kim-long"]')).toBeVisible();
  await expect.poll(() => canvasHasPaint(page, '[data-card="entrance_kim-long"] canvas')).toBe(true);
});

test('a long list is paged, and the page size can be changed', async ({ page }) => {
  const state = await prepare(page);
  for (let n = 1; n <= 28; n++) state.page.items.push(item(`frame_moi-${n}`, 'FRAME', `Viền ${n}`));
  await page.goto('/admin/cosmetics');
  await expect(page.locator('[data-card]')).toHaveCount(24);
  await expect(page.locator('.adm-pager')).toContainText('Hiển thị 1–24 / 30 viền');

  await page.getByRole('button', { name: 'Trang 2' }).click();
  await expect(page.locator('[data-card]')).toHaveCount(6);
  await expect(page.locator('[data-card="frame_moi-28"]')).toBeVisible();

  await page.locator('[data-page-size]').selectOption('12');
  await expect(page.locator('[data-card]')).toHaveCount(12);
  await expect(page.locator('.adm-pager')).toContainText('Hiển thị 1–12 / 30 viền');
  // A filter starts again from the first page.
  await page.getByRole('button', { name: 'Trang 3' }).click();
  await expect(page.locator('[data-card]')).toHaveCount(6);
  await page.locator('[data-filter="rarity"]').selectOption('RARE');
  await expect(page.locator('.adm-pager')).toContainText('Hiển thị 1–12 / 28 viền');
});

test('the old tab names of the address land on the same tab', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics?tab=titles');
  await expect(page.locator('[data-card="title_kim-long"]')).toBeVisible();
  await expect(page.locator('.adm-seg [aria-current="page"]')).toHaveText('Danh hiệu');
});

test('what does not add up in the stored catalog is shown', async ({ page }) => {
  const state = await prepare(page);
  state.page.problems = ['Chest chest_np can roll MYSTERY but has no such item left.'];
  await page.goto('/admin/cosmetics');
  await expect(page.locator('.acf-problems')).toContainText('1 chỗ không khớp');
});

// ------------------------------------------------------------------ frames

test('a painted frame: upload, line up the hole, choose effects, save', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=FRAME');
  await page.locator('#acf-name').fill('Hắc Long');
  await page.locator('[data-picture]').setInputFiles(await picture(page));
  const area = page.locator('[data-align]');
  await expect(area).toBeVisible();
  expect(state.uploads).toBe(1);
  await expect(page.locator('[data-picture-status]')).not.toHaveClass(/is-warning/);

  // The ring starts in the middle of the picture; dragging moves it by the same distance in picture pixels.
  await expect(page.locator('[data-hole="x"]')).toHaveValue('124');
  await area.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  const ring = await page.locator('[data-ring]').boundingBox();
  const k = 247 / box!.width;
  await page.mouse.move(ring!.x + ring!.width / 2, ring!.y + ring!.height / 2);
  await page.mouse.down();
  await page.mouse.move(ring!.x + ring!.width / 2 + 20, ring!.y + ring!.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-hole="x"]')).toHaveValue(String(Math.round(123.5 + 20 * k)));

  // The handle changes only the radius.
  const handle = await page.locator('[data-handle]').boundingBox();
  const radiusBefore = Number(await page.locator('[data-hole="r"]').inputValue());
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 16, handle!.y + handle!.height / 2, { steps: 4 });
  await page.mouse.up();
  expect(Number(await page.locator('[data-hole="r"]').inputValue())).toBeGreaterThan(radiusBefore);

  await page.locator('[data-effect-on="spark"]').check();
  await page.locator('[data-effect-on="comet"]').check();
  await page.locator('[data-sheen="on"]').check();
  await page.locator('[data-effect-on="fall"]').check();
  await page.locator('[data-effect-kind="fall"]').selectOption('rose');
  await expect.poll(() => canvasHasPaint(page, '[data-preview-canvas]')).toBe(true);

  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/frame_moi');

  const created = state.sent.find((call) => call.method === 'POST')!.body;
  expect(created.category).toBe('FRAME');
  expect(created.visual.template).toBe('painted');
  expect(created.visual.imageUrl).toBe(PICTURE);
  expect(created.visual.params.hole.r).toBeGreaterThan(radiusBefore);
  expect(created.visual.params.live.aura[0]).toBe('255,190,90');
  expect(created.visual.params.live.spark).toEqual(['255,244,210', 3]);
  expect(created.visual.params.live.comet).toEqual(['255,232,170', 0.16, 1]);
  expect(created.visual.params.live.fall).toEqual(['rose', 6]);
  expect(created.visual.params.sheen.a).toBe(0.4);
});

test('a picture with no transparency is warned about, and one of the wrong type is refused', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=FRAME');

  await page.locator('[data-picture]').setInputFiles(await picture(page, { transparent: false }));
  await expect(page.locator('[data-picture-status]')).toHaveClass(/is-warning/);
  await expect(page.locator('[data-picture-status]')).toContainText('không có vùng trong suốt');
  expect(state.uploads).toBe(1);

  await page.locator('[data-picture]').setInputFiles({ name: 'a.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await expect(page.getByText('Chỉ nhận ảnh PNG hoặc WebP.')).toBeVisible();
  expect(state.uploads).toBe(1);
});

test('a missing image store is explained', async ({ page }) => {
  await prepare(page);
  await page.route((url) => url.pathname === '/api/admin/assets', (route) => refuse(route, 503, 'ASSET_STORAGE_UNAVAILABLE', 'no'));
  await page.goto('/admin/cosmetics/new?type=FRAME');
  await page.locator('[data-picture]').setInputFiles(await picture(page));
  await expect(page.getByText('Máy chủ chưa cấu hình nơi lưu ảnh')).toBeVisible();
});

test('a variant starts from the effects of the frame it borrows', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=FRAME');
  await page.locator('#acf-name').fill('Băng Long');
  await page.locator('input[name="acf-template"][value="builtin-clone"]').check();
  await page.locator('[data-base="bang"]').click();
  await expect(page.locator('[data-effect-on="fall"]')).toBeChecked();
  await expect(page.locator('[data-effect-kind="fall"]')).toHaveValue('snow');
  await page.locator('[data-effect-on="fall"]').uncheck();

  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/frame_moi');
  const body = state.sent.find((call) => call.method === 'POST')!.body;
  expect(body.visual.template).toBe('builtin-clone');
  expect(body.visual.params.base).toBe('bang');
  expect(body.visual.params.live.fall).toBeUndefined();
  expect(body.visual.params.live.aura[0]).toBe('110,205,255');
  expect(body.visual.params.sheen.conic).toBe(true);
});

test('a frame that ships keeps its drawing: only its words can be edited', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/frame_kimlong');
  await expect(page.locator('[data-picture]')).toHaveCount(0);
  await expect(page.locator('[data-effect]')).toHaveCount(0);
  await expect(page.locator('[data-chests] a')).toHaveAttribute('href', '/admin/chests/chest_nb');
  await expect(page.locator('[data-chests]')).toContainText('Đang nằm trong hòm: Két Nhà Băng');
  // Nobody may delete what ships with the game.
  await expect(page.locator('[data-delete]')).toHaveCount(0);

  await page.locator('#acf-name').fill('Kim Long Mới');
  await page.locator('[data-save]').click();
  await expect(page.getByRole('heading', { name: 'Kim Long Mới' })).toBeVisible();
  const body = state.sent.find((call) => call.method === 'PUT')!.body;
  expect(body.visual).toBeNull();
  expect(body.expectedVersion).toBe(1);
});

// ------------------------------------------------------------------ how it is obtained

test('how an item is obtained is saved and shown, and a level reward stops being tradable', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/frame_kimlong');
  await expect(page.locator('[data-field="tradable"]')).toBeChecked();

  await page.locator('input[name="acf-mode"][value="level"]').check();
  await page.locator('#acf-level').fill('5');
  await page.locator('[data-save-way]').click();
  // It stops being tradable for everyone holding a copy, so the page says so and asks why.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('không bán, trao đổi hay đổi KN được nữa');
  await dialog.locator('[data-cancel]').click();
  expect(state.sent).toEqual([]);
  await page.locator('[data-save-way]').click();
  await page.locator('#acf-reason').fill('Thưởng cấp 5');
  await dialog.locator('[data-confirm]').click();
  await expect(page.locator('[data-field="tradable"]')).not.toBeChecked();
  expect(state.sent.at(-1)).toMatchObject({ method: 'PUT', path: '/frame_kimlong/acquisition', body: { mode: 'level', level: 5, reason: 'Thưởng cấp 5' } });
  await expect(page.locator('input[name="acf-mode"][value="level"]')).toBeChecked();

  await page.locator('input[name="acf-mode"][value="achievement"]').check();
  await page.locator('#acf-metric').selectOption('Won');
  await page.locator('#acf-target').fill('25');
  await page.locator('[data-save-way]').click();
  await page.locator('#acf-reason').fill('Thành tích mới');
  await dialog.locator('[data-confirm]').click();
  await expect.poll(() => state.sent.at(-1)?.body?.mode).toBe('achievement');
  expect(state.sent.at(-1)?.body).toMatchObject({ metric: 'Won', target: 25 });
});

test('only the fields of the chosen way show', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics/frame_kimlong');
  await expect(page.locator('#acf-level')).toBeHidden();
  await page.locator('input[name="acf-mode"][value="level"]').check();
  await expect(page.locator('#acf-level')).toBeVisible();
  await expect(page.locator('#acf-metric')).toBeHidden();
  await page.locator('input[name="acf-mode"][value="achievement"]').check();
  await expect(page.locator('#acf-metric')).toBeVisible();
  await expect(page.locator('#acf-level')).toBeHidden();
});

test('a refusal from the server is shown as it is', async ({ page }) => {
  await prepare(page);
  await page.route((url) => url.pathname.endsWith('/acquisition'), (route) => refuse(route, 409, 'COSMETIC_DEFAULT_REQUIRED', 'Nhóm này luôn cần một món mặc định.'));
  await page.goto('/admin/cosmetics/title_tan-binh');
  await page.locator('input[name="acf-mode"][value="admin"]').check();
  await page.locator('[data-save-way]').click();
  await page.locator('#acf-reason').fill('Thử');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect(page.getByText('Nhóm này luôn cần một món mặc định.')).toBeVisible();
});

test('saving how an item is obtained, or retiring it, keeps what is still being edited', async ({ page }) => {
  const state = await prepare(page);
  state.page.items.push(item('frame_moi', 'FRAME', 'Đang Sửa', {
    visual: { iconKey: 'frame_moi', imageUrl: PICTURE, builtinId: null, template: 'painted', params: { hole: { x: 120, y: 120, r: 80 }, live: {} } },
  }));
  await page.goto('/admin/cosmetics/frame_moi');
  await page.locator('#acf-name').fill('Tên Chưa Lưu');
  await page.locator('[data-effect-on="spark"]').check();

  await page.locator('input[name="acf-mode"][value="level"]').check();
  await page.locator('#acf-level').fill('5');
  await page.locator('[data-save-way]').click();
  await page.locator('#acf-reason').fill('Thưởng cấp 5');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect(page.locator('input[name="acf-mode"][value="level"]')).toBeChecked();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.locator('[data-retire]').click();
  await page.locator('#acf-reason').fill('Hết mùa');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect(page.locator('[data-retire]')).toHaveText('Phát hành lại');

  await expect(page.locator('#acf-name')).toHaveValue('Tên Chưa Lưu');
  await expect(page.locator('[data-effect-on="spark"]')).toBeChecked();
  await page.locator('[data-save]').click();
  await expect(page.getByRole('heading', { name: 'Tên Chưa Lưu' })).toBeVisible();
  const saved = state.sent.filter((call) => call.path === '/frame_moi').at(-1)!.body;
  expect(saved.visual.params.live.spark).toBeTruthy();
});

test('turning trading on or off asks why, because it changes what players hold', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/frame_kimlong');
  await page.locator('[data-field="tradable"]').uncheck();
  await page.locator('[data-save]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('không bán');
  await dialog.locator('[data-cancel]').click();
  expect(state.sent).toEqual([]);

  await page.locator('[data-save]').click();
  await page.locator('#acf-reason').fill('Khóa giao dịch');
  await dialog.locator('[data-confirm]').click();
  await expect.poll(() => state.sent.at(-1)?.body?.reason).toBe('Khóa giao dịch');
  expect(state.sent.at(-1)?.body?.tradable).toBe(false);
});

test('a variant whose base has a sheen can switch it off, and the player sees the same', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=FRAME');
  await page.locator('#acf-name').fill('Băng Không Ánh');
  await page.locator('input[name="acf-template"][value="builtin-clone"]').check();
  await page.locator('[data-base="bang"]').click();
  await expect(page.locator('[data-sheen="on"]')).toBeChecked();
  await page.locator('[data-sheen="on"]').uncheck();
  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/frame_moi');

  const body = state.sent.find((call) => call.method === 'POST')!.body;
  expect(body.visual.params.sheen.a).toBe(0);
  const drawn = await page.evaluate(async (visual) => {
    const index = await import('/Client/js/cosmetics/index.js' as string);
    index.applyCosmetic({ id: 'frame_khong-anh', category: 'FRAME', rarity: 'RARE', name: 'x', visual });
    const sheen = index.FR['khong-anh'].picSheen;
    return sheen?.a ?? 0;
  }, body.visual);
  expect(drawn).toBe(0);
  // Opened again, the box stays unticked.
  await expect(page.locator('[data-sheen="on"]')).not.toBeChecked();
});

// ------------------------------------------------------------------ titles

test('a new title: the style grid shows the name being typed, in all 18 styles', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=TITLE');
  await expect(page.locator('[data-style]')).toHaveCount(18);

  await page.locator('#acf-name').fill('Hắc Long Thám Tử');
  await expect(page.locator('[data-style="ngan"] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Hắc Long Thám Tử');
  await expect(page.locator('[data-title-full] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Hắc Long Thám Tử');
  await expect(page.locator('[data-title-bare] .hs-bare')).toBeVisible();

  await page.locator('[data-style="kimlong"]').click();
  await expect(page.locator('[data-style="kimlong"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-glow-on]').check();
  await page.locator('[data-parts-on]').check();
  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/title_moi');

  const body = state.sent.find((call) => call.method === 'POST')!.body;
  expect(body.category).toBe('TITLE');
  expect(body.visual).toMatchObject({ template: 'style', params: { style: 'kimlong', glow: '255,200,90' } });
  expect(body.visual.params.parts).toEqual([['rise', 6, '255,214,120'], ['tw', 3, '255,248,220']]);
});

test('a new title painted from a picture: upload, draw the text box, save; the name is written on the picture', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=TITLE');
  await expect(page.locator('[data-painted-block]')).toBeHidden();

  await page.locator('[name="acf-title-kind"][value="painted"]').check();
  await expect(page.locator('[data-painted-block]')).toBeVisible();
  await expect(page.locator('[data-styles-block]')).toBeHidden();
  await page.locator('#acf-name').fill('Cú Đêm Phố Cổ');
  await page.locator('[data-title-input]').setInputFiles(await picture(page));

  // Dragging on the picture draws the box the name is written in.
  const area = page.locator('[data-tbox-area]');
  await expect(area).toBeVisible();
  await area.scrollIntoViewIfNeeded();
  const bounds = (await area.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + bounds.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.7, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-tbox="x"]')).not.toHaveValue('15');

  const full = page.locator('[data-title-full] .hs-tl');
  await expect(full).toHaveAttribute('aria-label', 'Danh hiệu Cú Đêm Phố Cổ');
  await expect(full.locator('image')).toHaveAttribute('href', PICTURE);
  await expect(full.locator('text').last()).toHaveText('Cú Đêm Phố Cổ');

  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/title_moi');
  const visual = state.sent.find((call) => call.method === 'POST')!.body.visual;
  expect(visual).toMatchObject({ template: 'painted', imageUrl: PICTURE, params: { size: { w: 247, h: 259 }, color: '255,240,200', scale: 1 } });
  expect(visual.params.textBaked).toBeUndefined();
  expect(visual.params.box.x).toBeCloseTo(0.1, 1);
  expect(visual.params.box.y).toBeCloseTo(0.2, 1);
  expect(visual.params.box.w).toBeCloseTo(0.8, 1);
  expect(visual.params.box.h).toBeCloseTo(0.5, 1);
});

test('a title whose picture already carries the words writes no name on it', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=TITLE');
  await page.locator('[name="acf-title-kind"][value="painted"]').check();
  await page.locator('#acf-name').fill('Thám Tử Sương Mù');
  await page.locator('[data-title-input]').setInputFiles(await picture(page));
  await page.locator('[data-title-baked]').check();

  await expect(page.locator('[data-tbox="w"]')).toBeDisabled();
  await expect(page.locator('[data-tbox-mark]')).toBeHidden();
  const full = page.locator('[data-title-full] .hs-tl');
  await expect(full).toHaveAttribute('aria-label', 'Danh hiệu Thám Tử Sương Mù');
  await expect(full.locator('image')).toHaveCount(1);
  await expect(full.locator('text')).toHaveCount(0);

  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/title_moi');
  const visual = state.sent.find((call) => call.method === 'POST')!.body.visual;
  expect(visual.params).toMatchObject({ textBaked: true, size: { w: 247, h: 259 } });
  expect(visual.params.box).toBeUndefined();
});

test('a saved painted title opens with its picture and box, and switching back to a style saves a style', async ({ page }) => {
  const state = await prepare(page);
  state.page.items.push(item('title_cu-dem', 'TITLE', 'Cú Đêm', {
    visual: { iconKey: 'title_cu-dem', imageUrl: PICTURE, builtinId: null, template: 'painted', params: { size: { w: 247, h: 259 }, box: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }, color: '250,230,180' } },
  }));
  await page.goto('/admin/cosmetics/title_cu-dem');
  await expect(page.locator('[name="acf-title-kind"][value="painted"]')).toBeChecked();
  await expect(page.locator('[data-tbox="w"]')).toHaveValue('60');
  await expect(page.locator('[data-title-full] .hs-tl image')).toHaveAttribute('href', PICTURE);

  await page.locator('[name="acf-title-kind"][value="style"]').check();
  await expect(page.locator('[data-title-full] .hs-tl image')).toHaveCount(0);
  await page.locator('[data-save]').click();
  await expect.poll(() => state.sent.filter((call) => call.method === 'PUT').length).toBe(1);
  expect(state.sent.find((call) => call.method === 'PUT')!.body.visual.template).toBe('style');
});

test('a name with markup stays text in the plaque', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics/new?type=TITLE');
  await page.locator('#acf-name').fill('<img src=x onerror=alert(1)>');
  await expect(page.locator('[data-title-full] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu <img src=x onerror=alert(1)>');
  await expect(page.locator('[data-title-full] img')).toHaveCount(0);
});

// ------------------------------------------------------------------ entrances

test('a new entrance: the template decides which picture it can change', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/new?type=ENTRANCE');
  await expect(page.locator('[data-creature]')).toBeVisible();
  await expect(page.locator('[data-sword]')).toBeHidden();

  await page.locator('[data-template]').selectOption('van-kiem');
  await expect(page.locator('[data-creature]')).toBeHidden();
  await expect(page.locator('[data-sword]')).toBeVisible();
  await page.locator('[data-template]').selectOption('lang-le');
  await expect(page.locator('[data-sword]')).toBeHidden();

  await page.locator('[data-template]').selectOption('kim-long');
  await page.locator('#acf-name').fill('Hắc Long Giáng Thế');
  await page.locator('#acf-desc').fill('Rồng đen lượn qua mây.');
  await page.locator('[data-tint-on]').check();
  await page.locator('[data-creature-input]').setInputFiles(await picture(page));
  await expect(page.locator('[data-creature-status]')).toHaveText('Đang dùng ảnh riêng.');

  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/entrance_moi');
  const body = state.sent.find((call) => call.method === 'POST')!.body;
  expect(body.description).toBe('Rồng đen lượn qua mây.');
  expect(body.visual).toEqual({ template: 'kim-long', imageUrl: null, params: { tint: '120,200,255', imageUrl: PICTURE } });
});

test('a new entrance from a sprite sheet: its grid, place and blend are saved, and it plays full screen', async ({ page }) => {
  const state = await prepare(page, { reduced: false });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
  await page.goto('/admin/cosmetics/new?type=ENTRANCE');
  await expect(page.locator('[data-flipbook]')).toBeHidden();

  await page.locator('[data-template]').selectOption('flipbook');
  await expect(page.locator('[data-flipbook]')).toBeVisible();
  await expect(page.locator('[data-creature]')).toBeHidden();
  await page.locator('#acf-name').fill('Cú Đêm Bay Về');
  await page.locator('[data-sheet-input]').setInputFiles(await picture(page));
  await expect(page.locator('[data-sheet-status]')).toHaveText('Đang dùng sprite sheet đã tải.');
  await page.locator('[data-flip="cols"]').fill('2');
  await page.locator('[data-flip="rows"]').fill('2');
  await page.locator('[data-flip="frames"]').fill('3');
  await page.locator('[data-flip="fps"]').fill('8');
  await expect(page.locator('.acf-sheet-col')).toHaveCount(1);
  await expect(page.locator('.acf-sheet-row')).toHaveCount(1);
  await expect(page.locator('[data-sheet] .acf-hint')).toContainText('chạy 3 khung');
  await page.locator('[data-flip-place]').selectOption('drop');
  await page.locator('[data-flip-blend]').selectOption('add');
  await page.locator('[data-flip-loop]').uncheck();
  await expect.poll(() => canvasHasPaint(page, '[data-thumb]')).toBe(true);

  await page.locator('[data-play]').click();
  const stage = page.locator('.hs-stage');
  await expect(stage).toBeVisible();
  await expect(stage.locator('.hs-show')).toBeVisible({ timeout: 8000 });
  await stage.locator('.hs-skip').click();
  await expect(stage).toHaveCount(0);

  await page.locator('[data-save]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics/entrance_moi');
  const body = state.sent.find((call) => call.method === 'POST')!.body;
  expect(body.visual).toEqual({
    template: 'flipbook', imageUrl: null,
    params: { sheetUrl: PICTURE, cols: 2, rows: 2, frames: 3, fps: 8, loop: false, place: 'drop', size: 1, blend: 'add' },
  });
  expect(failures).toEqual([]);
});

test('previewing an entrance runs the full-screen stage without a console error', async ({ page }) => {
  await prepare(page, { reduced: false });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
  await page.goto('/admin/cosmetics/new?type=ENTRANCE');
  await page.locator('[data-tint-on]').check();
  await page.locator('[data-creature-input]').setInputFiles(await picture(page));
  await expect(page.locator('[data-creature-status]')).toHaveText('Đang dùng ảnh riêng.');

  await page.locator('[data-play]').click();
  const stage = page.locator('.hs-stage');
  await expect(stage).toBeVisible();
  await expect(stage.locator('.hs-hn')).toHaveText('Thám tử mẫu');
  await expect(stage.locator('.hs-show')).toBeVisible({ timeout: 8000 });
  await stage.locator('.hs-skip').click();
  await expect(stage).toHaveCount(0);
  expect(failures).toEqual([]);
});

test('a picture that fails to load falls back to what ships, with no error', async ({ page }) => {
  await prepare(page, { reduced: false });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/admin');
  const fell = await page.evaluate(async () => {
    const frames = await import('/Client/js/cosmetics/frames.js' as string);
    const avatars = await import('/Client/js/cosmetics/avatars.js' as string);
    frames.defineFrame('__broken', { name: 'x', rar: 'rare', src: '', imageUrl: '/assets/khong-co.webp', hole: { x: 10, y: 10, r: 5 }, live: {}, sheen: null });
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    canvas.style.cssText = 'width:160px;height:160px';
    document.body.append(canvas);
    for (let i = 0; i < 40; i++) {
      frames.paintFrame(canvas, '__broken', 1, avatars.avatarImg('nonla'));
      if (frames.picFailed(frames.FR.__broken.pic)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    frames.paintFrame(canvas, '__broken', 1, avatars.avatarImg('nonla'));
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, 160, 160);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return { failed: frames.picFailed(frames.FR.__broken.pic), painted };
  });
  expect(fell.failed).toBe(true);
  expect(fell.painted).toBeGreaterThan(1000);
  expect(failures).toEqual([]);
});

test('a picture is fetched once, however many cosmetics and canvases use it', async ({ page }) => {
  await prepare(page);
  let fetched = 0;
  await page.route((url) => url.pathname === '/assets/cosmetics/vien-mac.webp', (route) => { fetched += 1; return route.continue(); });
  await page.goto('/admin');
  await page.evaluate(async () => {
    const frames = await import('/Client/js/cosmetics/frames.js' as string);
    const url = '/assets/cosmetics/vien-mac.webp?once';
    for (const id of ['__a', '__b']) frames.defineFrame(id, { name: id, rar: 'rare', src: '', imageUrl: url, hole: { x: 120, y: 120, r: 80 }, live: {}, sheen: null });
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:160px;height:160px';
    canvas.width = canvas.height = 160;
    document.body.append(canvas);
    for (let i = 0; i < 30; i++) {
      frames.paintFrame(canvas, '__a', i, null);
      frames.paintFrame(canvas, '__b', i, null);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  expect(fetched).toBe(1);
});

test('the slices of an uploaded creature leave no stripes in its soft parts', async ({ page }) => {
  await page.goto('/admin');
  const spread = await page.evaluate(async () => {
    const fx = await import('/Client/js/cosmetics/fx.js' as string);
    const source: any = document.createElement('canvas');
    source.width = 800;
    source.height = 200;
    source.naturalWidth = 800;
    source.naturalHeight = 200;
    const paint = source.getContext('2d');
    paint.fillStyle = 'rgba(255, 90, 30, 0.5)';
    paint.fillRect(0, 0, 800, 200);
    const measure = (draw: (c: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 300;
      const c = canvas.getContext('2d', { willReadFrequently: true })!;
      c.setTransform(1.37, 0, 0, 1.37, 0, 0);
      draw(c);
      const { data } = c.getImageData(100, 130, 700, 1);
      const alphas = [];
      for (let i = 3; i < data.length; i += 4) alphas.push(data[i]);
      return Math.max(...alphas) - Math.min(...alphas);
    };
    const options = { flip: true, amp: 4, waves: 1.3, speed: 2.4 };
    return {
      shipped: measure((c) => fx.drawWarp(c, source, 20.3, 30.7, 600, 150, 1.7, options)),
      soft: measure((c) => fx.drawWarpSoft(c, source, 20.3, 30.7, 600, 150, 1.7, options)),
    };
  });
  // The overlap the shipped art hides behind its hard edges is really there; the uploaded path has none.
  expect(spread.shipped).toBeGreaterThan(20);
  expect(spread.soft).toBeLessThanOrEqual(3);
});

test('placing a picture follows the rule the shipped frames were placed by', async ({ page }) => {
  await page.goto('/admin');
  const rows = await page.evaluate(async () => {
    const frames = await import('/Client/js/cosmetics/frames.js' as string);
    const { ARTM } = await import('/Client/js/cosmetics/art-manifest.js' as string);
    return Object.entries(ARTM as Record<string, any>).filter(([, m]) => m.hr).map(([name, m]) => {
      const iw = m.w / m.s;
      const ih = m.h / m.s;
      const hole = { x: (m.hx - m.x) / m.s, y: (m.hy - m.y) / m.s, r: m.hr / m.s };
      const fit = frames.fitPicture(hole, 1, iw, ih);
      return { name, dy: Math.abs(fit.hy - m.hy), dr: Math.abs(fit.hr - m.hr), dx: Math.abs(fit.x - m.x) };
    });
  });
  expect(rows.length).toBeGreaterThan(10);
  // Hand placement rounded some values; a unit in the 200 box is less than a pixel at 160 px.
  for (const row of rows) {
    expect(row.dr, `${row.name} radius`).toBeLessThan(1);
    expect(row.dy, `${row.name} height`).toBeLessThan(1);
    expect(row.dx, `${row.name} left`).toBeLessThan(1);
  }
});

// ------------------------------------------------------------------ retire, delete

test('retiring asks for a reason, and without one nothing is sent', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics/frame_kimlong');
  await page.locator('[data-retire]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Người đang dùng vẫn giữ nguyên');

  await dialog.locator('[data-cancel]').click();
  await expect(dialog).toHaveCount(0);
  expect(state.sent).toEqual([]);

  await page.locator('[data-retire]').click();
  await page.locator('#acf-reason').fill('Hết mùa');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect(page.locator('[data-retire]')).toHaveText('Phát hành lại');
  expect(state.sent.at(-1)).toMatchObject({ method: 'PUT', path: '/frame_kimlong/retired', body: { retired: true, reason: 'Hết mùa' } });
});

test('only an unowned item made here offers to be deleted', async ({ page }) => {
  const state = await prepare(page);
  state.page.items.push(item('frame_moi', 'FRAME', 'Tạo Nhầm', { visual: { iconKey: 'frame_moi', imageUrl: PICTURE, builtinId: null, template: 'painted', params: { hole: { x: 120, y: 120, r: 80 } } } }));
  await page.goto('/admin/cosmetics/frame_moi');
  await page.locator('[data-delete]').click();
  await page.locator('#acf-reason').fill('Tạo nhầm');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect.poll(() => hashOf(page)).toBe('/admin/cosmetics?tab=FRAME');
  expect(state.sent.at(-1)).toMatchObject({ method: 'DELETE', path: '/frame_moi?reason=T%E1%BA%A1o%20nh%E1%BA%A7m' });
});

// ------------------------------------------------------------------ tools

test('granting: find the player, choose the item, say why', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics?tab=grant&def=frame_kimlong');
  await expect(page.locator('[data-grant-item]')).toHaveValue('frame_kimlong');
  await expect(page.locator('[data-grant-send]')).toBeDisabled();

  await page.locator('[data-player-search]').fill('Nam');
  await page.getByRole('option', { name: /Thám tử Nam/ }).click();
  await expect(page.locator('[data-player-chosen]')).toContainText('Thám tử Nam');
  await page.locator('[data-grant-send]').click();
  await page.locator('#acf-reason').fill('Quà sự kiện');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect(page.getByText('Đã cấp cho Thám tử Nam.')).toBeVisible();
  expect(state.sent.at(-1)).toMatchObject({ method: 'POST', path: '/frame_kimlong/grant', body: { userId: 'u9', reason: 'Quà sự kiện' } });
});

test('XP rates need a reason, and the level curve is only shown', async ({ page }) => {
  const state = await prepare(page);
  await page.goto('/admin/cosmetics?tab=xp');
  await expect(page.locator('[data-rare]')).toHaveValue('150');
  await expect(page.locator('[data-xp]')).toContainText('200 + 40 × (cấp − 1)');
  await expect(page.locator('[data-xp] input')).toHaveCount(2);

  await page.locator('[data-rare]').fill('70');
  await page.locator('[data-epic]').fill('900');
  await page.locator('[data-save-xp]').click();
  await expect(page.getByRole('dialog')).toContainText('150 → 70');
  await page.locator('#acf-reason').fill('Cân bằng lại');
  await page.getByRole('dialog').locator('[data-confirm]').click();
  await expect(page.getByText('Đã lưu tỉ lệ kinh nghiệm.')).toBeVisible();
  expect(state.sent.at(-1)).toMatchObject({ method: 'PUT', path: '/settings/xp', body: { rareXp: 70, epicXp: 900, reason: 'Cân bằng lại' } });
});

// ------------------------------------------------------------------ the page around it

test('an item that does not exist says so', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics/frame_khong-co');
  await expect(page.getByText('Không tìm thấy mỹ phẩm này.')).toBeVisible();
});

test('a failed load says why', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.route((url) => url.pathname === '/api/admin/cosmetics', (route) => refuse(route, 500, 'BOOM', 'Máy chủ đang bận.'));
  await page.goto('/admin/cosmetics');
  await expect(page.getByText('Máy chủ đang bận.')).toBeVisible();
});

test('someone who is not an admin does not get the page', async ({ page }) => {
  await signInAs(page, 'PLAYER');
  let asked = false;
  await page.route((url) => url.pathname === '/api/admin/cosmetics', (route) => { asked = true; return route.abort(); });
  await page.goto('/admin/cosmetics');
  await expect(page.locator('.acf-page')).toHaveCount(0);
  expect(asked).toBe(false);
});

test('the admin tab bar stays above the page', async ({ page }) => {
  await prepare(page);
  await page.goto('/admin/cosmetics/frame_dong');
  await expect(page.locator('#admin-nav-root .admin-nav-tab.is-active')).toHaveText('Mỹ phẩm');
});

for (const [name, hash] of [
  ['grid', '/admin/cosmetics'],
  ['title grid', '/admin/cosmetics?tab=TITLE'],
  ['frame editor', '/admin/cosmetics/new?type=FRAME'],
  ['title editor', '/admin/cosmetics/new?type=TITLE'],
  ['entrance editor', '/admin/cosmetics/new?type=ENTRANCE'],
  ['saved frame', '/admin/cosmetics/frame_kimlong'],
  ['grant', '/admin/cosmetics?tab=grant'],
  ['xp', '/admin/cosmetics?tab=xp'],
] as const) {
  test(`on a 390×844 phone the ${name} fits with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    await page.goto(hash);
    await expect(page.locator('.acf-page')).toBeVisible();
    await page.waitForLoadState('networkidle');
    // .bpa-rim, the route's lens transition, overflows for a moment on every page.
    await page.waitForTimeout(900);
    await expectNoSidewaysScroll(page);
  });
}

test('the hole can be dragged by touch on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await prepare(page);
  await page.goto('/admin/cosmetics/new?type=FRAME');
  await page.locator('[data-picture]').setInputFiles(await picture(page));
  await expect(page.locator('[data-align]')).toBeVisible();
  await page.locator('[data-ring]').scrollIntoViewIfNeeded();
  const before = await page.locator('[data-hole="x"]').inputValue();
  const ring = await page.locator('[data-ring]').boundingBox();
  const client = await context.newCDPSession(page);
  const at = (x: number, y: number) => [{ x, y }];
  const cx = ring!.x + ring!.width / 2;
  const cy = ring!.y + ring!.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(cx, cy) });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(cx + 20, cy) });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(cx + 40, cy) });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('[data-hole="x"]')).not.toHaveValue(before);
  await context.close();
});

// ------------------------------------------------------------------ cosmetics made here, on players' pages

/** What /detective needs around the portrait. */
async function playerProfile(page: Page) {
  await page.route((url) => url.pathname === '/api/market/me', (route) => ok(route, { balance: 0, held: 0, slotsUsed: 0, slotCap: 60, itemCount: 0, reservedSlots: 0, feePercent: 5 }));
  await page.route((url) => url.pathname === '/api/profile/me', (route) => ok(route, {
    fullName: 'Tuấn Yên', email: 'a@tests.invalid', role: 'PLAYER', isEmailVerified: true, hasPassword: true,
    rank: { tier: 'APPRENTICE', tierLabel: 'Tập sự', solved: 0, nextThreshold: 3, nextTierLabel: 'Thám tử', progressPercent: 0 },
    stats: { totalGames: 0, wins: 0, losses: 0, winRate: 0, averageScore: 0, puzzlesSolved: 0, cluesFound: 0, casesSolved: 0 }, badges: [],
  }));
}

test('a player sees what was made here in the tabs of their profile, and wears it', async ({ page }) => {
  await signInAs(page, 'PLAYER');
  const painted = { iconKey: 'frame_moi', imageUrl: PICTURE, builtinId: null, template: 'painted', params: { hole: { x: 123.8, y: 129.8, r: 78.3 }, live: { aura: ['120,200,255', 0.3] } } };
  const entry = (id: string, category: string, name: string, visual: Item, extra: Item = {}) => ({
    id, category, rarity: 'RARE', name, nameEn: name, description: 'Viền avatar.', descriptionEn: 'x', tradable: false, retired: false, sortOrder: 90, visual,
    level: null, metric: null, target: null, achievementCountable: false, chests: [], activeChestCount: 3, ...extra,
  });
  const catalog = {
    items: [
      entry('frame_moi', 'FRAME', 'Hắc Long', painted, { level: 5 }),
      entry('frame_cu', 'FRAME', 'Viền Cũ', painted, { retired: true }),
      entry('title_moi', 'TITLE', 'Hắc Long Thám Tử', { iconKey: 'title_moi', imageUrl: null, builtinId: null, template: 'style', params: { style: 'kimlong' } }),
      entry('entrance_moi', 'ENTRANCE', 'Hắc Long Giáng Thế', { iconKey: 'entrance_moi', imageUrl: null, builtinId: null, template: 'kim-long', params: { tint: '120,200,255' } }, { description: 'Rồng đen lượn qua mây.' }),
    ],
    defaults: { frame: null, title: 'title_tan-binh', entrance: 'entrance_lang-le' },
    rareXp: 70,
    epicXp: 900,
  };
  const me = {
    level: 5, xp: 0, xpToNext: 360, maxLevel: 50, isMaxLevel: false, avatar: 'nonla', avatarUrl: null, canUploadAvatar: false,
    frameDefId: null as string | null, titleDefId: 'title_tan-binh', entranceDefId: 'entrance_lang-le',
    exchangeable: [],
    owned: [{ itemId: 'i1', defId: 'frame_moi', category: 'FRAME', source: 'LEVEL', locked: false, equipped: false }],
    achievements: [],
  };
  await page.route((url) => url.pathname === '/api/cosmetics/catalog', (route) => ok(route, catalog));
  await page.route((url) => url.pathname === '/api/progress/me', (route) => ok(route, me));
  await playerProfile(page);
  let equipped = '';
  await page.route((url) => url.pathname === '/api/market/inventory/equip' || url.pathname.endsWith('/equip'), (route) => {
    equipped = route.request().postDataJSON()?.itemId ?? 'sent';
    me.frameDefId = 'frame_moi';
    return ok(route, { items: [] });
  });
  await page.goto('/detective');

  // The exchange tab reads the rates of the catalog.
  await expect(page.locator('#hs-p-doi')).toContainText('70 KN');
  await expect(page.locator('#hs-p-doi')).toContainText('900 KN');

  await page.getByRole('tab', { name: 'Viền avatar' }).click();
  const made = page.locator('[data-hs-frame="moi"]');
  await expect(made).toContainText('Hắc Long');
  await expect(made).toContainText('Cấp 5');
  // Retired and not owned: gone for this player.
  await expect(page.locator('[data-hs-frame="cu"]')).toHaveCount(0);
  await made.click();
  await expect.poll(() => equipped).not.toBe('');
  await expect(made).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('tab', { name: 'Danh hiệu' }).click();
  await expect(page.locator('[data-hs-title-id="moi"] .hs-tl')).toHaveAttribute('aria-label', 'Danh hiệu Hắc Long Thám Tử');
  await expect(page.locator('[data-hs-title-id="moi"]')).toContainText('Chỉ admin cấp');

  await page.getByRole('tab', { name: 'Hiệu ứng vào sảnh' }).click();
  await expect(page.locator('[data-hs-entrance="moi"]')).toContainText('Rồng đen lượn qua mây.');
  await expect(page.locator('[data-hs-entrance="moi"] [data-use]')).toBeDisabled();
});

test('with a default frame of the admin\'s choice, the bare ring is gone and the default is free to wear', async ({ page }) => {
  await signInAs(page, 'PLAYER');
  const catalog = {
    items: [{
      id: 'frame_moi', category: 'FRAME', rarity: 'RARE', name: 'Viền Chung', nameEn: 'x', description: '', descriptionEn: '', tradable: false, retired: false, sortOrder: 1,
      visual: { iconKey: 'frame_moi', imageUrl: null, builtinId: null, template: 'builtin-clone', params: { base: 'bang' } }, level: null, metric: null, target: null, achievementCountable: false, chests: [], activeChestCount: 3,
    }],
    defaults: { frame: 'frame_moi', title: 'title_tan-binh', entrance: 'entrance_lang-le' },
    rareXp: 150,
    epicXp: 600,
  };
  await playerProfile(page);
  await page.route((url) => url.pathname === '/api/cosmetics/catalog', (route) => ok(route, catalog));
  await page.route((url) => url.pathname === '/api/progress/me', (route) => ok(route, {
    level: 1, xp: 0, xpToNext: 200, maxLevel: 50, isMaxLevel: false, avatar: 'nonla', avatarUrl: null, canUploadAvatar: false,
    frameDefId: 'frame_moi', titleDefId: 'title_tan-binh', entranceDefId: 'entrance_lang-le', exchangeable: [], owned: [], achievements: [],
  }));
  await page.goto('/detective');
  await page.getByRole('tab', { name: 'Viền avatar' }).click();
  await expect(page.locator('[data-hs-frame="moi"]')).not.toHaveClass(/hs-locked/);
  await expect(page.locator('[data-hs-frame="moi"]')).toContainText('Mặc định');
  await expect(page.locator('[data-hs-frame="none"]')).toHaveCount(0);
});

test('the market shows a painted frame with its own picture, and other cosmetics with the category drawing', async ({ page }) => {
  await page.goto('/admin');
  const html = await page.evaluate(async () => {
    const kit = await import('/Client/js/pages/market/marketKit.js' as string);
    return {
      painted: kit.itemIcon({ category: 'FRAME', rarity: 'RARE', iconKey: 'frame_moi', visual: { template: 'painted', imageUrl: '/assets/cosmetics/vien-dong.webp' } }),
      clone: kit.itemIcon({ category: 'FRAME', rarity: 'RARE', iconKey: 'frame_x', visual: { template: 'builtin-clone', params: { base: 'bang' } } }),
      shipped: kit.itemIcon({ category: 'FRAME', rarity: 'RARE', iconKey: 'frame_dong', visual: { builtinId: 'dong' } }),
      title: kit.itemIcon({ category: 'TITLE', rarity: 'RARE', iconKey: 'title_moi', visual: { template: 'style', params: { style: 'kimlong' } } }),
    };
  });
  expect(html.painted).toContain('src="/assets/cosmetics/vien-dong.webp"');
  expect(html.clone).toContain('<svg');
  expect(html.shipped).toContain('<svg');
  expect(html.title).toContain('<svg');
});

test('a painted title and a sprite-sheet entrance from the server are drawn wherever players see them', async ({ page }) => {
  await page.goto('/admin');
  const drawn = await page.evaluate(async () => {
    const catalog = await import('/Client/js/cosmetics/catalog.js' as string);
    const titles = await import('/Client/js/cosmetics/titles.js' as string);
    const fx = await import('/Client/js/cosmetics/fx.js' as string);
    catalog.applyCosmetic({
      id: 'title_cu-dem', category: 'TITLE', rarity: 'EPIC', name: 'Cú Đêm <b>Phố</b>',
      visual: { template: 'painted', imageUrl: '/assets/cosmetics/vien-dong.webp', params: { size: { w: 600, h: 150 }, box: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }, color: '250,230,180' } },
    });
    catalog.applyCosmetic({
      id: 'title_lan-sau', category: 'TITLE', rarity: 'RARE', name: 'Lần Sau',
      visual: { template: 'painted', imageUrl: 'javascript:alert(1)', params: { size: { w: 600, h: 150 }, textBaked: true } },
    });
    catalog.applyCosmetic({
      id: 'entrance_cu-bay', category: 'ENTRANCE', rarity: 'LEGENDARY', name: 'Cú Bay Về',
      visual: { template: 'flipbook', params: { sheetUrl: '/assets/cosmetics/vien-dong.webp', cols: 4, rows: 2, frames: 99, place: 'moon', blend: 'add' } },
    });
    const html = titles.titleHTML(titles.T['cu-dem']);
    return {
      html,
      unsafe: titles.titleHTML(titles.T['lan-sau']),
      entrance: { tpl: fx.EN['cu-bay'].tpl, frames: fx.EN['cu-bay'].flip.frames, place: fx.EN['cu-bay'].flip.place, blend: fx.EN['cu-bay'].flip.blend, fps: fx.EN['cu-bay'].flip.fps },
    };
  });
  expect(drawn.html).toContain('href="/assets/cosmetics/vien-dong.webp"');
  expect(drawn.html).toContain('Cú Đêm &lt;b&gt;Phố&lt;/b&gt;');
  expect(drawn.html).not.toContain('<b>');
  // A picture address the server would never send is not drawn: the title falls back to a plate.
  expect(drawn.unsafe).not.toContain('javascript:');
  expect(drawn.unsafe).not.toContain('<image');
  // What does not fit the sheet is brought back to what can be played.
  expect(drawn.entrance).toEqual({ tpl: 'flipbook', frames: 8, place: 'hero', blend: 'add', fps: 12 });
});

test('the chest reel draws a frame it has never heard of from the definition it is given', async ({ page }) => {
  await page.goto('/admin');
  const painted = await page.evaluate(async () => {
    const icons = await import('/Client/js/cosmetics/icons.js' as string);
    const frames = await import('/Client/js/cosmetics/frames.js' as string);
    const sprite = icons.cosmeticSprite({
      id: 'frame_tu-hom', category: 'FRAME', rarity: 'EPIC', name: 'Từ Hòm',
      visual: { template: 'painted', imageUrl: '/assets/cosmetics/vien-mac.webp', params: { hole: { x: 120, y: 120, r: 80 }, live: {} } },
    });
    return { known: Boolean(frames.FR['tu-hom']), pic: frames.FR['tu-hom']?.pic ?? '', smooth: sprite.smooth };
  });
  expect(painted.known).toBe(true);
  expect(painted.pic).toContain('vien-mac');
  expect(painted.smooth).toBe(true);
});

test('the chest page does not overwrite how a known item is obtained', async ({ page }) => {
  await page.goto('/admin');
  const words = await page.evaluate(async () => {
    const index = await import('/Client/js/cosmetics/index.js' as string);
    const icons = await import('/Client/js/cosmetics/icons.js' as string);
    index.applyCosmeticCatalog({
      items: [{ id: 'frame_thach', category: 'FRAME', rarity: 'RARE', name: 'Thạch Phù', description: '', visual: { builtinId: 'thach' }, chests: ['Hòm Niêm Phong'], activeChestCount: 3 }],
      defaults: {},
    });
    // What a chest sends for its contents says nothing about levels or chests.
    icons.cosmeticSprite({ id: 'frame_thach', category: 'FRAME', rarity: 'RARE', name: 'Thạch Phù', description: 'Viền avatar.', visual: { builtinId: 'thach' } });
    return index.FR.thach.src;
  });
  expect(words).toBe('Ra từ Hòm Niêm Phong');
});

test('an edited description of a shipped entrance reaches the profile', async ({ page }) => {
  await page.goto('/admin');
  const words = await page.evaluate(async () => {
    const index = await import('/Client/js/cosmetics/index.js' as string);
    index.applyCosmetic({ id: 'entrance_anh-trang', category: 'ENTRANCE', rarity: 'RARE', name: 'Ánh Trăng Soi Lối', description: 'Mô tả mới của admin.', visual: { builtinId: 'anh-trang' }, chests: ['Hòm Niêm Phong'], activeChestCount: 3 });
    const edited = index.EN['anh-trang'].d;
    // Empty on the server means "written from the chests", which leaves the effect's own line alone.
    index.applyCosmetic({ id: 'entrance_mac-vu', category: 'ENTRANCE', rarity: 'EPIC', name: 'Mặc Vụ Ẩn Thân', description: 'Hiệu ứng vào sảnh. Ra từ Tráp Sơn Mài.', visual: { builtinId: 'mac-vu' }, chests: ['Tráp Sơn Mài'], activeChestCount: 3 });
    return { edited, untouched: index.EN['mac-vu'].d };
  });
  expect(words.edited).toBe('Mô tả mới của admin.');
  expect(words.untouched).toBe('Khói mực cuộn qua rồi tan, lộ dáng người');
});

test('in the market, a painted frame whose picture fails falls back to the category drawing', async ({ page }) => {
  await page.goto('/admin');
  const swapped = await page.evaluate(async () => {
    const kit = await import('/Client/js/pages/market/marketKit.js' as string);
    const host = document.createElement('div');
    host.innerHTML = kit.itemIcon({ category: 'FRAME', rarity: 'RARE', visual: { template: 'painted', imageUrl: '/assets/khong-co.webp' } });
    document.body.append(host);
    for (let i = 0; i < 60 && host.querySelector('img'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    return { image: host.querySelectorAll('img').length, drawing: host.querySelectorAll('svg').length };
  });
  expect(swapped).toEqual({ image: 0, drawing: 1 });
});

test('with a tint, colours change hue and keep their lightness; without one they come back untouched', async ({ page }) => {
  await page.goto('/admin');
  const out = await page.evaluate(async () => {
    const { retint } = await import('/Client/js/cosmetics/lib.js' as string);
    return {
      same: [retint('255,214,120', null), retint('#9a0e22', null)],
      tinted: retint('255,214,120', '120,200,255'),
      hex: retint('#9a0e22', '120,200,255'),
    };
  });
  expect(out.same).toEqual(['255,214,120', '#9a0e22']);
  const [r, , b] = out.tinted.split(',').map(Number);
  expect(b).toBeGreaterThan(r);
  expect(out.hex).toMatch(/^#[0-9a-f]{6}$/);
});
