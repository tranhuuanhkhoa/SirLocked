import { expect, type Locator, test } from '@playwright/test';

const roomId = 'smoke-room';

const smokeState = {
  roomId,
  roomCode: 'SMOKE1',
  hostUserId: 'player-1',
  caseTitle: 'Smoke Case',
  caseSummary: 'A deterministic UI smoke case.',
  language: 'en',
  mechanicsVersion: 2,
  roomStatus: 'IN_PROGRESS',
  currentSceneId: 'scene-smoke',
  version: 1,
  players: [
    { userId: 'player-1', username: 'Smoke Player', role: 'INVESTIGATOR', isConnected: true },
    { userId: 'player-2', username: 'Partner', role: 'INTERROGATOR', isConnected: true },
  ],
  visibleScene: {
    sceneId: 'scene-smoke',
    title: 'Smoke Study',
    description: 'A controlled room for UI smoke testing.',
    backgroundUrl: '',
    runtime: {
      width: 1600,
      height: 900,
      floorY: 720,
      walkableArea: { x: 80, y: 660, width: 1440, height: 180 },
      spawnPoints: {
        default: { x: 940, y: 805, direction: 'right' },
      },
      itemPlacements: [],
      characterPlacements: [],
      transitions: [],
      clueZones: [],
    },
    hotspots: [
      {
        hotspotId: 'hotspot-note',
        type: 'ITEM',
        targetId: 'item-note',
        x: 54,
        y: 71,
        width: 14,
        height: 18,
        zIndex: 2,
        label: 'Folded Note',
        isLocked: false,
      },
      {
        hotspotId: 'hotspot-witness',
        type: 'CHARACTER',
        targetId: 'char-witness',
        x: 56,
        y: 72,
        width: 14,
        height: 18,
        zIndex: 1,
        label: 'Witness',
        isLocked: false,
      },
    ],
    items: [
      {
        itemId: 'item-note',
        name: 'Folded Note',
        description: 'A note left beside the witness.',
        inspectText: 'The handwriting matches the warning in the case file.',
        imageUrl: '',
      },
    ],
    characters: [
      {
        characterId: 'char-witness',
        name: 'Witness',
        role: 'Witness',
        imageUrl: '',
        description: 'A witness with one available question.',
      },
    ],
    availableDialogues: [
      {
        dialogueId: 'dlg-shadow',
        characterId: 'char-witness',
        question: 'What did you see?',
        answer: 'I saw a shadow leave the study.',
        isAsked: false,
        isLocked: false,
        evidenceChallenges: [],
      },
    ],
    conversationTreeCharacterIds: [],
    conversationTranscript: [],
    puzzles: [],
  },
  unlockedSceneIds: ['scene-smoke'],
  inspectedItemIds: [],
  collectedItemIds: ['item-key'],
  capturedClueIds: [],
  usedInteractionIds: [],
  solvedPuzzleIds: [],
  wrongPuzzleCount: 0,
  collectedItems: [
    {
      itemId: 'item-key',
      name: 'Study Key',
      description: 'A brass key from the study.',
      inspectText: 'The key is tagged for the west cabinet.',
      imageUrl: '',
    },
  ],
  unlockedClues: [],
  evidenceClues: [],
  resolvedConfrontations: [],
  deductions: [],
  testimonies: [],
  suspects: [
    {
      characterId: 'char-witness',
      name: 'Witness',
      role: 'Witness',
      imageUrl: '',
      description: 'A witness with one available question.',
    },
  ],
  sceneMap: [
    {
      sceneId: 'scene-smoke',
      title: 'Smoke Study',
      isCurrent: true,
      isVisited: true,
      isUnlocked: true,
      isCompleted: false,
      pendingRequirementCount: 0,
    },
    {
      sceneId: 'scene-hall',
      title: 'Unknown location',
      isCurrent: false,
      isVisited: false,
      isUnlocked: false,
      isCompleted: false,
      pendingRequirementCount: 0,
    },
    {
      sceneId: 'scene-vault',
      title: 'Unknown location',
      isCurrent: false,
      isVisited: false,
      isUnlocked: false,
      isCompleted: false,
      pendingRequirementCount: 0,
    },
  ],
  completedSceneIds: [],
  availableForAccusation: false,
  currentSceneCanComplete: true,
  currentSceneMissingRequirements: {
    requiredItemIds: [],
    requiredClueIds: [],
    requiredDialogueIds: [],
  },
  currentObjective: 'Talk to the witness.',
  actionLog: [],
};

const progressedState = {
  ...smokeState,
  currentSceneId: 'scene-hall',
  version: 2,
  visibleScene: {
    ...smokeState.visibleScene,
    sceneId: 'scene-hall',
    title: 'Unlocked Hall',
    description: 'The next authored location is now open.',
    hotspots: [],
    characters: [],
    availableDialogues: [],
  },
  unlockedSceneIds: ['scene-smoke', 'scene-hall'],
  completedSceneIds: ['scene-smoke'],
  currentSceneCanComplete: false,
  currentObjective: 'Investigate the unlocked hall.',
  sceneMap: [
    {
      sceneId: 'scene-smoke',
      title: 'Smoke Study',
      isCurrent: false,
      isVisited: true,
      isUnlocked: true,
      isCompleted: true,
      pendingRequirementCount: 0,
    },
    {
      sceneId: 'scene-hall',
      title: 'Unlocked Hall',
      isCurrent: true,
      isVisited: true,
      isUnlocked: true,
      isCompleted: false,
      pendingRequirementCount: 0,
    },
    {
      sceneId: 'scene-vault',
      title: 'Unknown location',
      isCurrent: false,
      isVisited: false,
      isUnlocked: false,
      isCompleted: false,
      pendingRequirementCount: 0,
    },
  ],
};

const interrogatorState = {
  ...smokeState,
  players: [
    { userId: 'player-1', username: 'Smoke Player', role: 'INTERROGATOR', isConnected: true },
    { userId: 'player-2', username: 'Partner', role: 'INVESTIGATOR', isConnected: true },
  ],
  visibleScene: {
    ...smokeState.visibleScene,
    hotspots: smokeState.visibleScene.hotspots.filter((hotspot) => hotspot.type === 'CHARACTER'),
    items: [],
  },
};

const accusationReadyState = {
  ...smokeState,
  availableForAccusation: true,
  currentSceneCanComplete: false,
  currentObjective: 'Name the culprit and prove the case.',
  accusationConfig: {
    motiveOptions: [{ id: 'motive-1', label: 'Silence the witness' }],
    methodOptions: [{ id: 'method-1', label: 'Use the hidden passage' }],
    claimTypes: ['MOTIVE', 'METHOD', 'OPPORTUNITY'],
  },
  evidenceClues: [
    { clueId: 'clue-a', title: 'Marked Letter', content: 'A letter naming the meeting place.', source: 'ITEM', isCritical: true, isEvidence: true },
    { clueId: 'clue-b', title: 'Mud Print', content: 'A print from the hidden passage.', source: 'PHOTO', isCritical: true, isEvidence: true },
    { clueId: 'clue-c', title: 'Broken Watch', content: 'The stopped time confirms the opportunity.', source: 'ITEM', isCritical: true, isEvidence: true },
  ],
};

const causalAccusationReadyState = {
  ...accusationReadyState,
  accusationConfig: {
    ...accusationReadyState.accusationConfig,
    claimTypes: ['MOTIVE', 'METHOD', 'OPPORTUNITY', 'IDENTITY', 'TIMELINE'],
  },
  evidenceClues: [
    ...accusationReadyState.evidenceClues,
    { clueId: 'clue-d', title: 'Unique Fiber', content: 'The fiber links the culprit to the crime action.', source: 'PHOTO', isCritical: true, isEvidence: true },
    { clueId: 'clue-e', title: 'Station Clock', content: 'The clock reconstructs the exact crime window.', source: 'PHOTO', isCritical: true, isEvidence: true },
  ],
};

const evidenceGalleryState = {
  ...smokeState,
  unlockedClues: [
    { clueId: 'clue-1', title: 'Marked Letter', content: 'A letter naming the meeting place.', source: 'ITEM', isCritical: true, isEvidence: true },
    { clueId: 'clue-2', title: 'Mud Print', content: 'A print from the hidden passage.', source: 'PHOTO', isCritical: true, isEvidence: true },
    { clueId: 'clue-3', title: 'Broken Watch', content: 'The stopped time confirms the opportunity.', source: 'ITEM', isCritical: true, isEvidence: true },
    { clueId: 'clue-4', title: 'Service Map', content: 'A map showing the concealed service route.', source: 'PHOTO', isCritical: false, isEvidence: true },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([id]) => {
    window.localStorage.setItem('sirlocked.token', 'smoke-token');
    if (!window.localStorage.getItem('sirlocked.uiLanguage')) {
      window.localStorage.setItem('sirlocked.uiLanguage', 'en');
    }
    window.localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'player-1',
      fullName: 'Smoke Player',
      role: 'PLAYER',
      isEmailVerified: true,
    }));
    window.sessionStorage.setItem(`sirlocked.intro.${id}`, '1');
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, [roomId]);

  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: smokeState }),
    });
  });
  await page.route(`**/api/game/rooms/${roomId}/complete-scene`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { state: progressedState, changed: true, message: 'Continued to Unlocked Hall.' },
      }),
    });
  });
  await page.route(`**/api/game/rooms/${roomId}/inspect-item`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          state: smokeState,
          changed: true,
          message: 'A new lead was added.',
          detail: 'The handwriting matches the warning in the case file.',
          unlockedClueIds: ['clue-note'],
        },
      }),
    });
  });
});

test('Investigator shell keeps the scene primary and reports discoveries without a modal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/game/${roomId}`);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect(page.locator('#game-hud-slot .objective-brief')).toContainText('Talk to the witness.');
  await expect(page.locator('#game-hud-slot .scene-progress')).toContainText('Route forward available');
  await expect(page.locator('.investigation-tool-dock')).toBeVisible();
  await expect(page.locator('.mobile-movement-dock')).toBeVisible();
  await expect(page.locator('#mobile-camera-btn')).toBeVisible();
  await expect(page.locator('#mobile-inventory-btn')).toBeVisible();
  await expect(page.locator('.context-action')).toContainText('Inspect');
  await expect(page.locator('.context-action')).toContainText('Folded Note');

  await expect.poll(async () => canvasHasNonBlankPixels(canvas), {
    message: 'canvas should contain rendered scene pixels',
  }).toBe(true);

  await page.locator('#mobile-camera-btn').click();
  await expect(page.locator('#mobile-camera-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mobile-camera-btn').click();
  await expect(page.locator('#mobile-camera-btn')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#mobile-inventory-btn').click();
  await expect(page.locator('.inventory-drawer')).toBeVisible();
  await expect(page.locator('.inventory-drawer-slot.is-filled')).toHaveCount(1);
  await expect(page.locator('.case-file-drawer')).toHaveCount(0);

  await page.locator('.close-drawer-btn').click();
  await page.locator('#mobile-interact-btn').click();
  await expect(page.locator('.discovery-card')).toBeVisible();
  await expect(page.locator('.discovery-card')).toContainText('Folded Note');
  await expect(page.locator('.overlay:not(#intro-overlay)')).toHaveCount(0);

  await page.locator('#discovery-case-file-btn').click();
  await expect(page.locator('.case-file-drawer')).toBeVisible();
  await expect(page.locator('.inventory-drawer')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.case-file-drawer')).toHaveCount(0);

  await page.locator('#case-file-btn').click();
  await expect(page.locator('.case-file-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#case-file-btn')).toBeFocused();
});

test('Interrogator receives role-specific tools and questions in a scene-preserving side panel', async ({ page }) => {
  await page.unroute(`**/api/game/rooms/${roomId}/state`);
  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: interrogatorState }) });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('#floating-camera-btn')).toHaveCount(0);
  await expect(page.locator('#floating-bag-btn')).toHaveCount(0);
  await expect(page.locator('#case-file-btn')).toBeVisible();
  await expect(page.locator('.context-action')).toHaveCount(0);

  const canvas = page.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await canvas.click({ position: { x: canvasBox!.width * 0.63, y: canvasBox!.height * 0.81 } });
  const dialogue = page.locator('.conversation-box');
  await expect(dialogue).toBeVisible();
  await expect(page.locator('.conversation-choices')).toContainText('What did you see?');
  const dialogueBox = await dialogue.boundingBox();
  expect(dialogueBox).not.toBeNull();
  expect(dialogueBox!.width).toBeLessThanOrEqual(1440 * 0.4 + 2);
  expect(dialogueBox!.height).toBeLessThanOrEqual(720);
  await page.locator('[data-close-overlay]').click();
  await expect(dialogue).toHaveCount(0);

  await page.waitForTimeout(220);
  const playerX = async () => page.evaluate(() => {
    const game = (window as unknown as { __sirlockedGame?: { scene?: { getScene?: (key: string) => unknown } } }).__sirlockedGame;
    return Number((game?.scene?.getScene?.('SirLockedPhaserScene') as { localPose?: { x?: number } } | undefined)?.localPose?.x ?? 0);
  });
  const beforeMove = await playerX();
  await page.keyboard.down('d');
  await page.waitForTimeout(260);
  await page.keyboard.up('d');
  await expect.poll(playerX, { message: 'Phaser movement must resume after closing dialogue' }).toBeGreaterThan(beforeMove);

  const beforePassingNpc = await playerX();
  await page.keyboard.down('a');
  await page.waitForTimeout(800);
  await page.keyboard.up('a');
  const afterPassingNpc = await playerX();
  expect(beforePassingNpc - afterPassingNpc).toBeGreaterThan(100);
});

test('final accusation appears as a ready event instead of a permanently disabled tool', async ({ page }) => {
  await page.unroute(`**/api/game/rooms/${roomId}/state`);
  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: accusationReadyState }) });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('.final-confrontation-callout')).toContainText('Final confrontation ready');
  await expect(page.locator('.investigation-tool-dock #accuse-btn')).toHaveCount(0);
  await page.locator('.final-confrontation-callout').click();
  await expect(page.locator('.overlay .modal h2')).toHaveText('Final Accusation');
  const accusationBox = await page.locator('.accusation-modal').boundingBox();
  expect(accusationBox).not.toBeNull();
  expect(accusationBox!.width).toBeGreaterThan(900);
  await expect(page.locator('.suspect-portrait')).toHaveCount(accusationReadyState.suspects.length);
  await page.locator('[data-suspect]').first().click();
  await page.locator('#accuse-next').click();
  await page.locator('[data-motive]').click();
  await page.locator('#accuse-next').click();
  await page.locator('[data-method]').click();
  await page.locator('#accuse-next').click();
  await expect(page.locator('.accusation-evidence-card')).toHaveCount(3);
  await expect(page.locator('.claim-drop-zone')).toHaveCount(3);
  await page.locator('[data-assign-evidence="clue-a"]').dragTo(page.locator('[data-claim-drop="MOTIVE"]'));
  await expect(page.locator('[data-claim-drop="MOTIVE"]')).toHaveClass(/is-filled/);
  await page.locator('[data-assign-evidence="clue-b"]').click();
  await expect(page.locator('[data-claim-drop="METHOD"]')).toHaveClass(/is-filled/);
  await page.locator('[data-assign-evidence="clue-c"]').click();
  await expect(page.locator('[data-claim-drop="OPPORTUNITY"]')).toHaveClass(/is-filled/);
  await expect(page.locator('#accuse-next')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.overlay .modal')).toHaveCount(0);
});

test('causal contract renders and requires all five accusation claims', async ({ page }) => {
  await page.unroute(`**/api/game/rooms/${roomId}/state`);
  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: causalAccusationReadyState }) });
  });

  await page.goto(`/#/game/${roomId}`);
  await page.locator('.final-confrontation-callout').click();
  await page.locator('[data-suspect]').click();
  await page.locator('#accuse-next').click();
  await page.locator('[data-motive]').click();
  await page.locator('#accuse-next').click();
  await page.locator('[data-method]').click();
  await page.locator('#accuse-next').click();

  await expect(page.locator('.claim-drop-zone')).toHaveCount(5);
  await expect(page.locator('[data-claim-drop="IDENTITY"]')).toContainText('Identity');
  await expect(page.locator('[data-claim-drop="TIMELINE"]')).toContainText('Timeline');
  for (const clueId of ['clue-a', 'clue-b', 'clue-c', 'clue-d', 'clue-e']) {
    await page.locator(`[data-assign-evidence="${clueId}"]`).click();
  }
  await expect(page.locator('#accuse-next')).toBeEnabled();
});

test('case file shows square evidence in two columns and opens a large detail view', async ({ page }) => {
  await page.unroute(`**/api/game/rooms/${roomId}/state`);
  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: evidenceGalleryState }) });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/game/${roomId}`);
  await page.locator('#case-file-btn').click();
  await expect(page.locator('.case-file-clue-card')).toHaveCount(4);
  const cards = page.locator('.case-file-clue-card');
  const cardCount = await cards.count();
  expect(cardCount).toBe(4);
  const firstCard = cards.nth(0);
  const secondCard = cards.nth(1);
  const firstBox = await firstCard.boundingBox();
  const secondBox = await secondCard.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs(firstBox!.y - secondBox!.y)).toBeLessThan(2);
  const artBox = await firstCard.locator('.clue-card-art').boundingBox();
  expect(artBox).not.toBeNull();
  expect(Math.abs(artBox!.width - artBox!.height)).toBeLessThan(2);

  await firstCard.click();
  await expect(page.locator('.case-file-evidence-detail')).toBeVisible();
  const detailArt = await page.locator('.evidence-detail-art').boundingBox();
  expect(detailArt).not.toBeNull();
  expect(Math.abs(detailArt!.width - detailArt!.height)).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('.case-file-clue-card')).toHaveCount(4);
  await expect(page.locator('.case-file-drawer')).toBeVisible();
});

test('locked authored scenes stay hidden until Continue applies server movement', async ({ page }) => {
  let goToSceneRequests = 0;
  await page.route(`**/api/game/rooms/${roomId}/go-to-scene`, async (route) => {
    goToSceneRequests++;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(`/#/game/${roomId}`);
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();

  await page.locator('#map-btn').click();
  const lockedEntries = page.locator('.map-entry:disabled').filter({ hasText: 'Unknown location' });
  await expect(lockedEntries).toHaveCount(2);
  await expect(lockedEntries).toHaveText([/Unknown location/, /Unknown location/]);
  await page.locator('.map-drawer .close-drawer-btn').click();

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width / 2, y: box!.height - 112 } });

  await expect(page.locator('#game-hud-slot .objective-brief')).toContainText('Investigate the unlocked hall.');
  expect(goToSceneRequests).toBe(0);

  await page.locator('#map-btn').click();
  await expect(page.locator('.map-entry').filter({ hasText: 'Unlocked Hall' })).toHaveCount(1);
  await expect(page.locator('.map-entry:disabled').filter({ hasText: 'Unknown location' })).toHaveCount(1);
});

test('interface language switch changes English and Vietnamese and persists', async ({ page }) => {
  await page.route('**/api/cases/published', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/#/cases');
  await expect(page.locator('.page-head h2')).toHaveText('Published Cases');
  await expect(page.locator('[data-ui-language="en"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-ui-language="vi"]').click();
  await expect(page.locator('.page-head h2')).toHaveText('Vụ án đã xuất bản');
  await expect(page.locator('.nav-links')).toContainText('Tạo phòng');
  await expect(page.locator('[data-ui-language="vi"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('sirlocked.uiLanguage'))).toBe('vi');

  await page.reload();
  await expect(page.locator('.page-head h2')).toHaveText('Vụ án đã xuất bản');
  await page.locator('[data-ui-language="en"]').click();
  await expect(page.locator('.page-head h2')).toHaveText('Published Cases');
});

test('Vietnamese language applies inside gameplay overlays', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('sirlocked.uiLanguage', 'vi'));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('.scene-progress')).toContainText('Đã mở lối điều tra tiếp theo');

  await page.locator('#case-file-btn').click();
  await expect(page.locator('.case-file-modal h2')).toHaveText('Hồ sơ vụ án');
  await expect(page.locator('.case-file-tabs')).toContainText('Chứng cứ');
  await expect(page.locator('.case-file-modal')).toContainText('Chưa thu thập được chứng cứ nào.');
  await expect(page.getByRole('button', { name: 'Đóng' })).toBeVisible();
});

test('two-player presence recovers and version events coalesce to one state refetch', async ({ page }) => {
  let stateRequests = 0;
  await page.unroute(`**/api/game/rooms/${roomId}/state`);
  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    stateRequests++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: stateRequests === 1 ? smokeState : progressedState }),
    });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('#game-hud-slot .game-players')).toContainText('Partner');
  await expect(page.locator('#game-hud-slot .game-players')).toContainText('INT');

  await page.evaluate(() => {
    const emit = (window as unknown as { __sirlockedEmitSignalR: (event: string, payload: unknown) => void }).__sirlockedEmitSignalR;
    emit('PlayerPoseUpdated', { userId: 'player-2', username: 'Partner', role: 'INTERROGATOR', sceneId: 'scene-smoke', x: 920, y: 805, direction: 'right', moving: true });
  });
  const remoteIsMoving = () => page.evaluate(() => {
    const game = (window as unknown as { __sirlockedGame?: { scene?: { getScene?: (key: string) => unknown } } }).__sirlockedGame;
    const scene = game?.scene?.getScene?.('SirLockedPhaserScene') as { remotePlayers?: Map<string, { getData: (key: string) => unknown }> } | undefined;
    return Boolean(scene?.remotePlayers?.get('player-2')?.getData('moving'));
  });
  await expect.poll(remoteIsMoving).toBe(true);
  await expect.poll(remoteIsMoving, { timeout: 2500, message: 'stale remote movement must settle without changing scenes' }).toBe(false);

  await page.evaluate(() => {
    const emit = (window as unknown as { __sirlockedEmitSignalR: (event: string, payload: unknown) => void }).__sirlockedEmitSignalR;
    emit('PlayerPresenceChanged', { userId: 'player-2', isConnected: false });
  });
  await expect(page.locator('#game-hud-slot .game-players')).toContainText('OFFLINE');
  await expect(page.locator('#abandon-game-btn')).toBeVisible();

  await page.evaluate(() => {
    const emit = (window as unknown as { __sirlockedEmitSignalR: (event: string, payload: unknown) => void }).__sirlockedEmitSignalR;
    emit('InvestigationUpdate', {
      type: 'ITEM_FOUND',
      actorUserId: 'player-2',
      actorRole: 'INTERROGATOR',
      sceneId: 'scene-smoke',
      message: 'Partner found a new statement',
    });
  });
  await expect(page.locator('.partner-activity')).toHaveText('Partner found a new statement');
  expect(stateRequests).toBe(1);

  await page.evaluate(() => {
    const emit = (window as unknown as { __sirlockedEmitSignalR: (event: string, payload: unknown) => void }).__sirlockedEmitSignalR;
    emit('GameStateUpdated', { version: 2 });
    emit('GameStateUpdated', { version: 2 });
    emit('GameStateUpdated', { version: 2 });
  });

  await expect(page.locator('#game-hud-slot .objective-brief')).toContainText('Investigate the unlocked hall.');
  expect(stateRequests).toBe(2);

  await page.evaluate(() => {
    const emit = (window as unknown as { __sirlockedEmitSignalR: (event: string, payload: unknown) => void }).__sirlockedEmitSignalR;
    emit('PlayerPresenceChanged', { userId: 'player-2', isConnected: true });
  });
  await expect(page.locator('#game-hud-slot .game-players')).not.toContainText('OFFLINE');
});

test('PC game shell fits supported desktop resolutions', async ({ page }) => {
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/#/game/${roomId}`);
    await expect(page.locator('canvas').first()).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
  }
});

test('result screen groups verdict, score and truth without horizontal overflow', async ({ page }) => {
  const resultRoomId = 'result-room';
  await page.route(`**/api/game/rooms/${resultRoomId}/result`, async (route) => {
    const row = (selectedLabel: string, correctLabel: string, isCorrect: boolean) => ({ selectedLabel, correctLabel, isCorrect });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {
        success: true,
        ending: 'The detectives connect the final contradiction and expose the culprit before dawn.',
        selectedCulpritId: 'culprit-a',
        selectedCulpritName: 'Marta Quill',
        correctCulpritId: 'culprit-a',
        correctCulpritName: 'Marta Quill',
        selectedEvidenceIds: ['clue-a', 'clue-b', 'clue-c'],
        motive: 'Protect the hidden agreement.',
        method: 'Enter through the service passage and remove the orchid.',
        culpritResult: row('Marta Quill', 'Marta Quill', true),
        motiveResult: row('Protect the agreement', 'Protect the agreement', true),
        methodResult: row('Use the service passage', 'Use the service passage', true),
        evidenceResults: [
          { claimType: 'MOTIVE', selectedEvidenceTitle: 'Marked Letter', correctEvidenceTitle: 'Marked Letter', isCorrect: true },
          { claimType: 'METHOD', selectedEvidenceTitle: 'Mud Print', correctEvidenceTitle: 'Mud Print', isCorrect: true },
          { claimType: 'OPPORTUNITY', selectedEvidenceTitle: 'Broken Watch', correctEvidenceTitle: 'Broken Watch', isCorrect: true },
        ],
        scoreSummary: {
          totalScore: 94,
          rank: 'A',
          evidenceCoverageScore: 40,
          contradictionCoverageScore: 24,
          deductionCoverageScore: 20,
          teamworkScore: 10,
          investigatorContribution: true,
          interrogatorContribution: true,
          crossRoleHandoff: true,
          wrongEvidencePenalty: 0,
          wrongDeductionPenalty: 0,
          cameraMissPenalty: 0,
        },
      } }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/result/${resultRoomId}`);
  await expect(page.locator('.result-layout')).toBeVisible();
  await expect(page.locator('.result-verdict-panel')).toContainText('Accusation breakdown');
  await expect(page.locator('.result-score-panel')).toContainText('Detective score');
  await expect(page.locator('.result-comparison')).toContainText('Marta Quill');
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(hasHorizontalOverflow).toBe(false);
});

async function canvasHasNonBlankPixels(canvas: Locator) {
  return canvas.evaluate((node) => {
    const canvasNode = node as HTMLCanvasElement;
    const rect = canvasNode.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return false;

    const gl = canvasNode.getContext('webgl2', { preserveDrawingBuffer: true })
      ?? canvasNode.getContext('webgl', { preserveDrawingBuffer: true })
      ?? canvasNode.getContext('experimental-webgl', { preserveDrawingBuffer: true });

    if (gl) {
      const context = gl as WebGLRenderingContext;
      const width = context.drawingBufferWidth;
      const height = context.drawingBufferHeight;
      const points = [
        [Math.floor(width * 0.25), Math.floor(height * 0.25)],
        [Math.floor(width * 0.5), Math.floor(height * 0.5)],
        [Math.floor(width * 0.75), Math.floor(height * 0.75)],
      ];
      const pixel = new Uint8Array(4);
      return points.some(([x, y]) => {
        context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        return pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 0;
      });
    }

    const ctx = canvasNode.getContext('2d');
    if (!ctx) return false;
    const sample = ctx.getImageData(
      Math.floor(canvasNode.width / 2),
      Math.floor(canvasNode.height / 2),
      1,
      1,
    ).data;
    return sample[0] !== 0 || sample[1] !== 0 || sample[2] !== 0 || sample[3] !== 0;
  });
}
