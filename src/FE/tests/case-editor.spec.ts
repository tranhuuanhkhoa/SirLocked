import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './helpers/adminSession';

/**
 * Case Studio (/admin/editor/:caseId) against a faked editor API holding the tutorial case (the pixel standard):
 * dragging, autosave with versions, undo, the walk grid and "Kiểm đường đi", evidence deletion with its dependencies,
 * dialogue with preview, an NPC face from the library, the hint rule blocking publish, publishing after approval,
 * a stale save, "Chơi thử cảnh này" and the read-only view of a published case.
 */
const CASE_ID = 'case-ai-editor-demo';
const tutorial = () => {
  const gameCase = JSON.parse(readFileSync(new URL('../../BE/SeedData/V3/case-pixel-tan-thu-vi.json', import.meta.url), 'utf8'));
  gameCase.caseId = CASE_ID;
  gameCase.title = 'Toa cáp treo trống';
  return gameCase;
};

const LIBRARY = [
  {
    key: 'v-npc-thu-nghiem', kind: 'NPC', world: 'ALL', nameVi: 'Cô Lan (thư viện)', tags: ['nu'],
    url: '/assets/pixel/tan-thu/characters/co-lan-portrait.png',
    files: { idle: '/assets/pixel/tan-thu/characters/co-lan-idle.png', portrait: '/assets/pixel/tan-thu/characters/co-lan-portrait.png' },
  },
  { key: 'v-npc-khong-idle', kind: 'NPC', world: 'ALL', nameVi: 'Thiếu sheet', url: '/assets/x.png', files: {} },
];

/** The scene hint rule of the server, enough for the fake: every scene needs hints at order 1, 2 and 3. */
function hintErrors(gameCase: any) {
  const errors: any[] = [];
  for (const scene of gameCase.stages.flatMap((stage) => stage.scenes)) {
    const orders = (gameCase.hints ?? []).filter((hint) => hint.contextType === 'SCENE' && hint.targetId === scene.sceneId && hint.text?.trim())
      .map((hint) => hint.order);
    const missing = [1, 2, 3].filter((order) => !orders.includes(order));
    if (missing.length) {
      errors.push({ code: 'MissingHintLevel', path: `hints[SCENE:${scene.sceneId}]`, refId: scene.sceneId,
        message: `SCENE '${scene.sceneId}' needs hints at order 1, 2 and 3; missing order ${missing.join(', ')}.` });
    }
  }
  return errors;
}

type Fake = {
  gameCase: any;
  version: number;
  status: string;
  saves: any[];
  publishes: any[];
  playtests: any[];
  revisions: any[];
  staleNext: boolean;
};

async function openEditor(page: Page, options: { status?: string; mutate?: (gameCase: any) => void; extraErrors?: any[] } = {}) {
  await signInAs(page, 'ADMIN');
  const gameCase = tutorial();
  options.mutate?.(gameCase);
  const fake: Fake = {
    gameCase, version: 1, status: options.status ?? 'DRAFT', saves: [], publishes: [], playtests: [], staleNext: false,
    revisions: [{ number: 1, kind: 'ORIGINAL', note: 'Bản bot nhập vào', title: gameCase.title, editorVersion: 1, errorCount: 0, warningCount: 0, createdAt: '2026-11-18T08:00:00Z', createdByName: 'Yến' }],
  };
  const original = JSON.parse(JSON.stringify(gameCase));
  const validation = () => {
    const errors = [...hintErrors(fake.gameCase), ...(options.extraErrors ?? [])];
    return { canPublish: errors.length === 0 && fake.status === 'DRAFT', errors, warnings: [] };
  };
  const json = (data: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(status < 400 ? { success: true, data } : data) });
  const openBody = () => ({
    caseId: CASE_ID, title: fake.gameCase.title, status: fake.status, canEdit: fake.status === 'DRAFT', sourceAiDraftId: 'draft-1',
    world: 'HANG_DUONG_VICTORIAN', canPlaytest: fake.status === 'DRAFT', version: fake.version, updatedAt: '2026-11-18T08:00:00Z',
    updatedByName: 'Yến', case: fake.gameCase, validation: validation(), revisions: fake.revisions,
  });
  await page.route((url) => url.pathname.startsWith('/api/admin/case-editor/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON?.() ?? null;
    if (request.method() === 'GET' && path.endsWith(`/case-editor/${CASE_ID}`)) return route.fulfill(json(openBody()));
    if (request.method() === 'PUT') {
      fake.saves.push(body);
      if (fake.staleNext) {
        return route.fulfill(json({ success: false, message: 'Vụ vừa được lưu ở nơi khác.', errors: { code: 'CASE_EDITOR_STALE', currentVersion: fake.version + 1, updatedByName: 'Kiệt' } }, 409));
      }
      if (body.baseVersion !== fake.version) {
        return route.fulfill(json({ success: false, message: 'stale', errors: { code: 'CASE_EDITOR_STALE', currentVersion: fake.version } }, 409));
      }
      fake.gameCase = body.caseJson;
      fake.version += 1;
      let revision = null;
      if (body.checkpoint) {
        revision = { number: fake.revisions.length + 1, kind: 'CHECKPOINT', note: body.note, title: fake.gameCase.title, editorVersion: fake.version, errorCount: 0, warningCount: 0, createdAt: '2026-11-18T09:00:00Z', createdByName: 'Yến' };
        fake.revisions = [revision, ...fake.revisions];
      }
      return route.fulfill(json({ version: fake.version, updatedAt: '2026-11-18T09:00:00Z', validation: validation(), revision, revisions: fake.revisions }));
    }
    if (request.method() === 'GET' && /\/revisions\/1$/.test(path)) {
      return route.fulfill(json({ revision: fake.revisions.at(-1), case: original }));
    }
    if (request.method() === 'POST' && path.endsWith('/publish')) {
      fake.publishes.push(body);
      fake.status = 'PUBLISHED';
      fake.version += 1;
      return route.fulfill(json({ case: { caseId: CASE_ID, status: 'PUBLISHED' }, version: fake.version, revision: { number: 9, kind: 'PUBLISH' } }));
    }
    if (request.method() === 'POST' && path.endsWith('/playtest')) {
      fake.playtests.push(body);
      return route.fulfill(json({ roomId: 'room-playtest-1', roomCode: 'PT0001' }));
    }
    return route.fulfill(json(null));
  });
  await page.route((url) => url.pathname === '/api/admin/ai-cases/library', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: LIBRARY }),
  }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/admin/editor/${CASE_ID}`);
  await expect(page.locator('#cse-canvas')).toBeVisible();
  await page.waitForFunction(() => (window as any).__caseEditor?.state().imagesSettled);
  return fake;
}

/** Screen point of a runtime point on the scene canvas. */
async function screenPoint(page: Page, x: number, y: number) {
  const box = (await page.locator('#cse-canvas').boundingBox())!;
  const state = await page.evaluate(() => (window as any).__caseEditor.state());
  return { x: box.x + state.ox + x * state.scale, y: box.y + state.oy + y * state.scale };
}

const placement = (gameCase: any, characterId: string) => gameCase.stages.flatMap((stage) => stage.scenes)
  .flatMap((scene) => scene.runtime.characterPlacements).find((entry) => entry.characterId === characterId);

test('opens the bot case with its scene drawn and every object listed', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#cse-title')).toHaveText('Toa cáp treo trống');
  await expect(page.locator('#cse-save')).toContainText('Đã lưu · bản 1');
  await expect(page.locator('.cse-scene')).toHaveCount(2);
  await expect(page.locator('.cse-object--npc')).toHaveCount(2);
  await expect(page.locator('.cse-object--item')).toHaveCount(2);
  await expect(page.locator('.cse-object--door')).toHaveCount(1);
  await expect(page.locator('#cse-publish')).toHaveText('Duyệt & xuất bản');
  await expect(page.locator('#cse-publish')).toBeEnabled();
  await page.screenshot({ path: 'test-results/case-editor-open.png' });
});

test('dragging an NPC autosaves a snapped position as a new version, and Ctrl+Z puts it back', async ({ page }) => {
  const fake = await openEditor(page);
  const before = placement(fake.gameCase, 'char-tt-ong-luu');
  const from = await screenPoint(page, before.hotspot.x + before.hotspot.width / 2, before.hotspot.y + before.hotspot.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 15, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#cse-save')).toContainText('bản 2', { timeout: 6000 });
  const saved = fake.saves.at(-1);
  expect(saved.baseVersion).toBe(1);
  const moved = placement(saved.caseJson, 'char-tt-ong-luu');
  expect(moved.position.x).not.toBe(before.position.x);
  expect(moved.position.x % 4).toBe(0);
  expect(moved.hotspot.x - before.hotspot.x).toBe(moved.position.x - before.position.x);
  await expect(page.locator('.cse-panel h3')).toContainText('Ông Lưu');

  await page.locator('#cse-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#cse-save')).toContainText('bản 3', { timeout: 6000 });
  expect(placement(fake.saves.at(-1).caseJson, 'char-tt-ong-luu').position).toEqual(before.position);
  await page.keyboard.press('Control+y');
  await expect(page.locator('#cse-save')).toContainText('bản 4', { timeout: 6000 });
  expect(placement(fake.saves.at(-1).caseJson, 'char-tt-ong-luu').position).toEqual(moved.position);
});

test('painting obstacles cuts an item off and "Kiểm đường đi" marks it red', async ({ page }) => {
  const fake = await openEditor(page);
  await page.locator('#cse-reach').click();
  await expect(page.locator('#cse-reach-result')).toHaveText(/đều đi tới được/);
  const item = fake.gameCase.stages[0].scenes[0].runtime.itemPlacements.find((entry) => entry.itemId === 'item-tt-so-khach');
  const cx = item.hotspot.x + item.hotspot.width / 2, cy = item.hotspot.y + item.hotspot.height;
  await page.locator('[data-tool="wall"]').click();
  await page.locator('#cse-brush').selectOption('15');
  // A ring of obstacles: four strokes around the bottom of the item, leaving its own floor inside.
  for (const [dx, dy] of [[-15, -15], [15, -15], [15, 15], [-15, 15], [-15, -15]]) {
    const point = await screenPoint(page, cx + dx * 16, cy + dy * 16);
    if (dx === -15 && dy === -15 && !(await page.evaluate(() => (window as any).__painting))) {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.evaluate(() => { (window as any).__painting = true; });
    } else {
      await page.mouse.move(point.x, point.y, { steps: 30 });
    }
  }
  await page.mouse.up();
  await expect(page.locator('#cse-reach-result')).toContainText('không đi tới được');
  await expect(page.locator('.cse-object--item.is-bad').first()).toBeVisible();
  await expect(page.locator('#cse-save')).toContainText('bản 2', { timeout: 6000 });
  const grid = fake.saves.at(-1).caseJson.stages[0].scenes[0].runtime.render.walkGrid;
  expect(grid.data).toHaveLength(128);
  expect(grid.data.every((row) => row.length === 128 && /^[01]+$/.test(row))).toBe(true);
  await page.screenshot({ path: 'test-results/case-editor-reach.png' });
});

test('deleting evidence lists what still uses it first; the deletion autosaves', async ({ page }) => {
  const fake = await openEditor(page);
  await page.locator('[data-tab="evidence"]').click();
  await page.locator('[data-delete-evidence="clue:evidence-tt-so-khach"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('chỗ khác còn dùng nó');
  await expect(dialog).toContainText('evidenceChallenges[0].correctEvidenceId');
  await dialog.getByRole('button', { name: 'Thôi' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(fake.saves).toHaveLength(0);

  await page.locator('[data-delete-evidence="clue:clue-tt-vong-nuoc"]').click();
  await expect(page.getByRole('dialog')).toContainText('Không chỗ nào khác dùng nó');
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa' }).click();
  await expect(page.locator('#cse-save')).toContainText('bản 2', { timeout: 6000 });
  const saved = fake.saves.at(-1).caseJson;
  expect(saved.clues.some((clue) => clue.clueId === 'clue-tt-vong-nuoc')).toBe(false);
  expect(saved.stages[0].scenes[0].runtime.clueZones).toHaveLength(0);
});

test('editing a line shows it in the preview and saves the text', async ({ page }) => {
  const fake = await openEditor(page);
  await page.locator('.cse-object--npc', { hasText: 'Ông Lưu' }).click();
  await page.locator('[data-goto-lines="char-tt-ong-luu"]').click();
  const answer = page.locator('textarea[data-path$=".answer"]').first();
  await answer.fill('Tôi đứng quầy suốt buổi, chẳng thấy ai lạ.');
  await expect(page.locator('#cse-preview .cse-bubble')).toContainText('chẳng thấy ai lạ');
  await expect(page.locator('#cse-preview .cse-bubble strong')).toHaveText('Ông Lưu');
  await page.screenshot({ path: 'test-results/case-editor-lines.png' });
  await expect(page.locator('#cse-save')).toContainText('bản 2', { timeout: 6000 });
  const path = await answer.getAttribute('data-path');
  const index = Number(/dialogues\[(\d+)\]/.exec(path!)![1]);
  expect(fake.saves.at(-1).caseJson.dialogues[index].answer).toBe('Tôi đứng quầy suốt buổi, chẳng thấy ai lạ.');
});

test('an NPC takes a face from the library and keeps its id and lines', async ({ page }) => {
  const fake = await openEditor(page);
  const lines = JSON.stringify(fake.gameCase.dialogues);
  await page.locator('.cse-object--npc', { hasText: 'Ông Lưu' }).click();
  await expect(page.locator('.cse-npc')).toHaveCount(1); // the entry without an idle sheet is not offered
  await page.screenshot({ path: 'test-results/case-editor-npc.png' });
  await page.locator('[data-swap="v-npc-thu-nghiem"]').click();
  await expect(page.locator('#cse-save')).toContainText('bản 2', { timeout: 6000 });
  const saved = fake.saves.at(-1).caseJson;
  const character = saved.characters.find((entry) => entry.characterId === 'char-tt-ong-luu');
  expect(character.name).toBe('Ông Lưu');
  expect(character.imageUrl).toBe('/assets/pixel/tan-thu/characters/co-lan-portrait.png');
  expect(character.presentation.spriteSheet).toMatchObject({ url: '/assets/pixel/tan-thu/characters/co-lan-idle.png', frameCount: 9, anchorY: 0.8203 });
  expect(JSON.stringify(saved.dialogues)).toBe(lines);
});

test('missing hints block publishing until they are written; then the owner approves and publishes', async ({ page }) => {
  const fake = await openEditor(page, { mutate: (gameCase) => { gameCase.hints = gameCase.hints.filter((hint) => !(hint.targetId === 'scene-tt-ngo' && hint.order === 2)); } });
  await expect(page.locator('#cse-publish')).toHaveText('Còn 1 lỗi');
  await expect(page.locator('#cse-publish')).toBeDisabled();
  await page.locator('[data-tab="check"]').click();
  await expect(page.locator('.cse-hints')).toContainText('Thiếu gợi ý — chặn xuất bản');
  await page.screenshot({ path: 'test-results/case-editor-hints.png' });
  await page.locator('[data-new-hint="SCENE|scene-tt-ngo|2"]').fill('Thử xem cái hòm gỗ ở góc ngõ.');
  await page.locator('[data-add-hint="SCENE|scene-tt-ngo|2"]').click();
  await expect(page.locator('#cse-save')).toContainText('bản 2', { timeout: 6000 });
  await expect(page.locator('#cse-publish')).toHaveText('Duyệt & xuất bản');
  await expect(page.locator('#cse-publish')).toBeEnabled();

  await page.locator('#cse-publish').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Toa cáp treo trống');
  await dialog.locator('[data-dialog-note]').fill('Yến duyệt sau khi chơi thử');
  await dialog.getByRole('button', { name: 'Xuất bản' }).click();
  await expect(page.locator('#cse-banner')).toContainText('Vụ đã xuất bản nên chỉ xem được');
  expect(fake.publishes).toEqual([{ baseVersion: 2, note: 'Yến duyệt sau khi chơi thử' }]);
  await expect(page.locator('#cse-publish')).toHaveText('Đã xuất bản');
  await expect(page.locator('#cse-publish')).toBeDisabled();
});

test('a complete case lists every hint; removing one blocks publishing until it is written again (E3)', async ({ page }) => {
  const fake = await openEditor(page);
  await page.locator('[data-tab="check"]').click();
  await expect(page.locator('.cse-hints')).toHaveCount(0);
  await page.locator('.cse-all-hints summary').click();
  const ngo = page.locator('.cse-all-hints .cse-hint-target', { hasText: 'Ngõ Thạch Khố Môn' });
  await ngo.getByRole('button', { name: 'Xóa gợi ý mức 2' }).click();
  await expect(page.locator('#cse-save')).toContainText('bản 2', { timeout: 6000 });
  await expect(page.locator('.cse-hints')).toContainText('Ngõ Thạch Khố Môn');
  await expect(page.locator('#cse-publish')).toHaveText('Còn 1 lỗi');
  await page.locator('.cse-hints [data-new-hint="SCENE|scene-tt-ngo|2"]').fill('Nhìn xe kéo của A Phúc.');
  await page.locator('.cse-hints [data-add-hint="SCENE|scene-tt-ngo|2"]').click();
  await expect(page.locator('#cse-save')).toContainText('bản 3', { timeout: 6000 });
  await expect(page.locator('#cse-publish')).toHaveText('Duyệt & xuất bản');
  expect(fake.saves.at(-1).caseJson.hints.filter((hint) => hint.targetId === 'scene-tt-ngo').map((hint) => hint.order).sort()).toEqual([1, 2, 3]);
});

test('a save refused as stale stops autosave and offers to load the newer version', async ({ page }) => {
  const fake = await openEditor(page);
  fake.staleNext = true;
  await page.locator('.cse-object--door').click();
  await page.locator('#cse-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#cse-banner')).toContainText('Vụ vừa được lưu ở nơi khác (bởi Kiệt)', { timeout: 6000 });
  await expect(page.locator('#cse-save')).toContainText('Có bản mới hơn');
  await expect(page.locator('#cse-publish')).toBeDisabled();
  const count = fake.saves.length;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(2200);
  expect(fake.saves.length).toBe(count);
  fake.staleNext = false;
  await page.locator('#cse-reload').click();
  await expect(page.locator('#cse-save')).toContainText('Đã lưu');
});

test('"Chơi thử cảnh này" opens the playtest room starting in the open scene', async ({ page }) => {
  const fake = await openEditor(page);
  await page.locator('.cse-scene', { hasText: 'Ngõ' }).click();
  await page.locator('#cse-playtest').click();
  await expect(page).toHaveURL(/\/lobby\/room-playtest-1$/);
  expect(fake.playtests).toEqual([{ sceneId: 'scene-tt-ngo' }]);
});

test('clicking a validation error opens the scene and selects the object it is about', async ({ page }) => {
  await openEditor(page, {
    mutate: (gameCase) => { gameCase.hints = []; },
    extraErrors: [{ code: 'HotspotUnreachable', path: 'scene:scene-tt-ngo.runtime.itemPlacements[item-tt-hom-go]', refId: 'scene-tt-ngo',
      message: 'The floor cell nearest the bottom of this box is not reachable from the spawn.' }],
  });
  await page.locator('[data-tab="check"]').click();
  await expect(page.locator('.cse-hints .cse-hint-target')).toHaveCount(2);
  await expect(page.locator('#cse-publish')).toHaveText('Còn 3 lỗi');
  await page.locator('.cse-issue', { hasText: 'HotspotUnreachable' }).click();
  await expect(page.locator('.cse-scene.is-active')).toContainText('Ngõ');
  await expect(page.locator('.cse-object--item.is-active.is-bad')).toBeVisible();
  await expect(page.locator('.cse-panel .adm-eyebrow').first()).toHaveText('Vật phẩm');
  await expect(page.locator('.cse-panel .cse-issues')).toContainText('HotspotUnreachable');
  expect(await page.evaluate(() => (window as any).__caseEditor.state().selected)).toEqual({ kind: 'item', id: 'item-tt-hom-go' });
});

test('a published case opens read only', async ({ page }) => {
  const fake = await openEditor(page, { status: 'PUBLISHED' });
  await expect(page.locator('#cse-banner')).toContainText('chỉ xem được');
  await expect(page.locator('#cse-save')).toContainText('Chỉ xem');
  await expect(page.locator('#cse-publish')).toBeDisabled();
  await expect(page.locator('#cse-checkpoint')).toBeDisabled();
  await expect(page.locator('[data-tool="wall"]')).toBeDisabled();
  await page.locator('[data-tab="evidence"]').click();
  await expect(page.locator('.cse-panel textarea').first()).toBeDisabled();
  const before = placement(fake.gameCase, 'char-tt-ong-luu');
  const from = await screenPoint(page, before.hotspot.x + 20, before.hotspot.y + 20);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
  expect(fake.saves).toHaveLength(0);
});
