import { expect, test, type Page } from '@playwright/test';

const roomId = 'navigation-room';
function fixture() {
  return {
    roomId, roomCode: 'NAV1', hostUserId: 'local', caseTitle: 'Navigation case', caseSummary: '',
    language: 'en', mechanicsVersion: 2, roomStatus: 'IN_PROGRESS', currentSceneId: 'study', version: 1,
    players: [{ userId: 'local', username: 'Detective', role: 'INVESTIGATOR', isConnected: true },
      { userId: 'partner', username: 'Partner', role: 'INTERROGATOR', isConnected: true }],
    visibleScene: {
      sceneId: 'study', title: 'Study', description: 'Inspect the cabinet.', backgroundUrl: '',
      runtime: { width: 1600, height: 900, floorY: 730, walkableArea: { x: 80, y: 480, width: 1440, height: 340 },
        spawnPoints: { default: { x: 200, y: 730, direction: 'right' } },
        navigationObstacles: [{ x: 620, y: 570, width: 160, height: 150 }],
        itemPlacements: [{ itemId: 'cabinet', position: { x: 1250, y: 680 }, size: { width: 100, height: 140 },
          hotspot: { x: 1200, y: 540, width: 100, height: 140 }, reservedSlot: { x: 1200, y: 540, width: 100, height: 140 } }],
        characterPlacements: [], transitions: [{ transitionId: 'door', targetSceneId: 'hall', label: 'Hall',
          hotspot: { x: 1400, y: 540, width: 120, height: 80 } }], clueZones: [] },
      hotspots: [{ hotspotId: 'cabinet-hotspot', type: 'ITEM', targetId: 'cabinet', label: 'Cabinet',
        x: 75, y: 60, width: 6.25, height: 15.55, zIndex: 2, isLocked: false }],
      items: [{ itemId: 'cabinet', name: 'Cabinet', imageUrl: '', inspectText: 'A sealed cabinet.' }],
      characters: [], availableDialogues: [], conversationTreeCharacterIds: [], conversationTranscript: [], puzzles: [] },
    unlockedSceneIds: ['study', 'hall'], inspectedItemIds: [], collectedItemIds: [], capturedClueIds: [],
    usedInteractionIds: [], solvedPuzzleIds: [], wrongPuzzleCount: 0, collectedItems: [], unlockedClues: [], evidenceClues: [],
    resolvedConfrontations: [], deductions: [], testimonies: [], suspects: [], completedSceneIds: [],
    availableForAccusation: false, currentSceneCanComplete: false,
    currentSceneMissingRequirements: { requiredItemIds: [], requiredClueIds: [], requiredDialogueIds: [] },
    sceneMap: [{ sceneId: 'study', title: 'Study', isCurrent: true, isVisited: true, isUnlocked: true },
      { sceneId: 'hall', title: 'Hall', isCurrent: false, isVisited: true, isUnlocked: true }],
    currentObjective: 'Inspect the cabinet.', actionLog: [] };
}

async function readPose(page: Page) {
  return page.evaluate(() => {
    const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    return { x: scene.localPose.x, y: scene.localPose.y, moving: scene.localPose.moving,
      pending: Boolean(scene.navigation), action: Boolean(scene.navigation?.action),
      waypoints: scene.navigation?.path.map((point: any) => ({ ...point })) ?? [], enabled: scene.sceneInteractionEnabled };
  });
}

async function clickWorld(page: Page, x: number, y: number) {
  const point = await page.evaluate(({ x, y }) =>
    (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').worldPoint({ x, y }), { x, y });
  const bounds = await page.locator('canvas').first().boundingBox();
  if (!bounds) throw new Error('The scene canvas is not visible.');
  // Physical clicks can land on the inert background without activating it.
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
}

async function prepare(page: Page, state = fixture()) {
  let current = state, inspected = 0, moved = 0, captured = 0;
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(({ roomId }) => {
    localStorage.setItem('sirlocked.token', 'navigation-token');
    localStorage.setItem('sirlocked.uiLanguage', 'en');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'local', fullName: 'Detective', role: 'PLAYER', isEmailVerified: true }));
    sessionStorage.setItem(`sirlocked.intro.${roomId}`, '1');
    (window as any).__sirlockedNoSignalR = true;
  }, { roomId });
  await page.route(`**/api/game/rooms/${roomId}/state`, route => route.fulfill({ json: { success: true, data: current } }));
  await page.route(`**/api/game/rooms/${roomId}/inspect-item`, async route => {
    inspected++;
    current = { ...current, version: current.version + 1, inspectedItemIds: ['cabinet'] };
    await route.fulfill({ json: { success: true, data: { state: current, changed: true, detail: 'Cabinet inspected.' } } });
  });
  await page.route(`**/api/game/rooms/${roomId}/go-to-scene`, async route => {
    moved++;
    current = { ...current, version: current.version + 1, currentSceneId: 'hall',
      visibleScene: { ...current.visibleScene, sceneId: 'hall', title: 'Hall' } };
    await route.fulfill({ json: { success: true, data: { state: current, changed: true } } });
  });
  await page.route(`**/api/game/rooms/${roomId}/capture-clue`, async route => {
    captured++;
    await route.fulfill({ json: { success: true, data: { state: current, changed: false, captureResult: 'MISS', message: 'No clue here.' } } });
  });
  await page.goto(`/#/game/${roomId}`);
  await expect.poll(async () => page.evaluate(() => {
    const scene = (window as any).__sirlockedGame?.scene.getScene('SirLockedPhaserScene');
    return Boolean(scene?.ready && scene?.localPose && scene?.sceneInteractionEnabled);
  })).toBe(true);
  return { inspected: () => inspected, moved: () => moved, captured: () => captured,
    async update(next: ReturnType<typeof fixture>) {
      current = next;
      await page.evaluate(version => (window as any).__sirlockedEmitSignalR('GameStateUpdated', { version }), next.version);
    } };
}

test('real floor clicks route in 2D around obstacles and settle at the selected destination', async ({ page }) => {
  await prepare(page);
  await clickWorld(page, 1050, 680);
  const pending = await readPose(page);
  expect(pending.pending).toBe(true);
  expect(pending.action).toBe(false);
  expect(pending.waypoints.length).toBeGreaterThan(1);
  await expect.poll(async () => (await readPose(page)).pending).toBe(false);
  const arrived = await readPose(page);
  expect(arrived.x).toBeCloseTo(1050, 0);
  expect(arrived.y).toBeCloseTo(680, 0);
  expect(arrived.moving).toBe(false);
});

test('item click approaches before executing the existing inspect command exactly once', async ({ page }) => {
  const api = await prepare(page);
  await clickWorld(page, 1250, 610);
  expect((await readPose(page)).action).toBe(true);
  expect(api.inspected()).toBe(0);
  await expect.poll(api.inspected).toBe(1);
  expect((await readPose(page)).pending).toBe(false);
  await page.waitForTimeout(350);
  expect(api.inspected()).toBe(1);
});

test('the latest ground click replaces a queued interaction and Escape cancels the next one', async ({ page }) => {
  const api = await prepare(page);
  await clickWorld(page, 1250, 610);
  await clickWorld(page, 350, 760);
  expect((await readPose(page)).action).toBe(false);
  await expect.poll(async () => (await readPose(page)).pending).toBe(false);
  expect(api.inspected()).toBe(0);
  await clickWorld(page, 1250, 610);
  await page.keyboard.press('Escape');
  expect((await readPose(page)).pending).toBe(false);
  const stopped = await readPose(page);
  await page.waitForTimeout(300);
  expect((await readPose(page)).x).toBeCloseTo(stopped.x, 1);
  expect(api.inspected()).toBe(0);
});

test('keyboard controls cancel mouse interaction and provide up/down movement', async ({ page }) => {
  const api = await prepare(page);
  await clickWorld(page, 1250, 610);
  const before = await readPose(page);
  await page.keyboard.down('w');
  await expect.poll(async () => (await readPose(page)).y).toBeLessThan(before.y - 15);
  await page.keyboard.up('w');
  expect((await readPose(page)).pending).toBe(false);
  expect(api.inspected()).toBe(0);
  const above = await readPose(page);
  await page.keyboard.down('ArrowDown');
  await expect.poll(async () => (await readPose(page)).y).toBeGreaterThan(above.y + 15);
  await page.keyboard.up('ArrowDown');
});

test('inventory panel and camera cancel queued actions; camera canvas clicks never navigate', async ({ page }) => {
  const api = await prepare(page);
  await clickWorld(page, 1250, 610);
  await page.keyboard.press('b');
  await expect(page.locator('.inventory-drawer')).toBeVisible();
  expect((await readPose(page)).pending).toBe(false);
  await clickWorld(page, 350, 540);
  expect((await readPose(page)).pending).toBe(false);
  await page.keyboard.press('Escape');
  await clickWorld(page, 1250, 610);
  await page.keyboard.press('z');
  const before = await readPose(page);
  expect(before.pending).toBe(false);
  await clickWorld(page, 400, 620);
  await page.waitForTimeout(200);
  const after = await readPose(page);
  expect(after.pending).toBe(false);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
  expect(api.inspected()).toBe(0);
});

test('blocked destinations show a distinct rejection and dispatch no interaction', async ({ page }) => {
  const state = fixture();
  state.visibleScene.runtime.navigationObstacles = [{ x: 600, y: 300, width: 60, height: 700 }];
  const api = await prepare(page, state);
  await clickWorld(page, 1250, 610);
  await expect(page.locator('.toast')).toContainText('no reachable path');
  expect((await readPose(page)).pending).toBe(false);
  expect(await page.evaluate(() => Boolean((window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').rejectedDestination))).toBe(true);
  expect(api.inspected()).toBe(0);
});

test('a new authoritative scene cancels an approach, and authored exit clicks execute once after arrival', async ({ page }) => {
  const api = await prepare(page);
  await clickWorld(page, 1250, 610);
  const next = fixture();
  next.currentSceneId = 'hall'; next.version = 2; next.visibleScene.sceneId = 'hall'; next.visibleScene.title = 'Hall';
  await api.update(next);
  await expect.poll(async () => (await readPose(page)).pending).toBe(false);
  expect(api.inspected()).toBe(0);
  await page.goto(`/#/game/${roomId}`);
  // Restart the original scene through a new page mount rather than mutating Phaser state.
  const fresh = fixture(); fresh.version = 3;
  await api.update(fresh);
  await expect.poll(async () => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').state.currentSceneId)).toBe('study');
  await clickWorld(page, 1460, 580);
  expect(api.moved()).toBe(0);
  await expect.poll(api.moved).toBe(1);
  await page.waitForTimeout(250);
  expect(api.moved()).toBe(1);
});
