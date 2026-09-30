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

test('witness reading progress and Phaser entities survive unrelated partner activity', async ({ page }) => {
  let state = structuredClone(interrogatorState);
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state } }));
  await page.route(`**/api/game/rooms/${roomId}/ask-dialogue`, async (route) => {
    state = { ...state, version: 2, visibleScene: { ...state.visibleScene, availableDialogues: state.visibleScene.availableDialogues.map((entry) => ({ ...entry, isAsked: true, answer: 'I remember the rain against the windows. '.repeat(20) })) } };
    await route.fulfill({ json: { success: true, data: { changed: true, unlockedClueIds: [], state } } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/game/${roomId}`);
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  // Canvas visibility precedes Phaser's first input frame. Wait for the witness's
  // actual interactive zone, then click its measured center after layout settles.
  const witnessPoint = () => page.evaluate(() => {
    const game = (window as any).__sirlockedGame;
    const scene = game?.scene.getScene('SirLockedPhaserScene');
    if (!scene?.input.enabled || game.loop.frame < 3) return null;
    const zone = scene.children.list.flatMap((child: any) => child.list || [])
      .find((child: any) => child.type === 'Zone' && child.input?.enabled);
    if (!zone) return null;
    const bounds = zone.getBounds();
    return { x: bounds.centerX / scene.scale.width, y: bounds.centerY / scene.scale.height };
  });
  await expect.poll(witnessPoint).not.toBeNull();
  await page.evaluate(() => {
    const w = window as any;
    w.__presentationPlayer = w.__sirlockedGame.scene.getScene('SirLockedPhaserScene').localPlayer;
  });
  const box = (await canvas.boundingBox())!;
  const witness = (await witnessPoint())!;
  await canvas.click({ position: { x: box.width * witness.x, y: box.height * witness.y } });
  await page.locator('[data-dialogue]').first().click();
  await expect(page.locator('.vn-current-text')).not.toBeEmpty();
  await page.locator('[data-vn-advance]').click();
  await page.locator('[data-vn-advance]').click();
  await expect(page.locator('.vn-current-text')).toContainText('I remember');
  const before = await page.locator('.vn-current-text').textContent();
  await page.evaluate(() => {
    const w = window as any;
    w.__presentationNode = document.querySelector('.vn-current-text');
    w.__presentationPlayer = w.__sirlockedGame.scene.getScene('SirLockedPhaserScene').localPlayer;
    w.__sirlockedEmitSignalR('InvestigationUpdate', { actorUserId: 'player-2', message: 'Looking around', type: 'ACTIVITY' });
  });
  expect(await page.evaluate(() => document.querySelector('.vn-current-text') === (window as any).__presentationNode)).toBe(true);
  expect(await page.evaluate(() => (window as any).__presentationPlayer === (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').localPlayer)).toBe(true);
  expect((await page.locator('.vn-current-text').textContent())!.length).toBeGreaterThanOrEqual(before!.length);
  const independentUpdates = await page.evaluate(() => {
    const w = window as any, scene = w.__sirlockedGame.scene.getScene('SirLockedPhaserScene');
    const player = scene.localPlayer;
    const npcBody = () => scene.children.list.find((child: any) => child.list?.some((item: any) => item.type === 'Zone'))
      ?.list.find((child: any) => child.type === 'Image' || child.type === 'Rectangle');
    const npc = npcBody();
    w.__sirlockedEmitSignalR('PlayerPresenceChanged', { userId: 'player-2', isConnected: false });
    scene.updateGameState(scene.state, null);
    const afterOffline = scene.localPlayer === player && npcBody() === npc;
    w.__sirlockedEmitSignalR('PlayerPresenceChanged', { userId: 'player-2', isConnected: true });
    scene.updateGameState(scene.state, 'item-key');
    const label = scene.inventorySelectionLabel;
    const selectedText = label?.text;
    scene.updateGameState(scene.state, 'item-note');
    const reusedLabel = scene.inventorySelectionLabel === label && label.text !== selectedText;
    scene.updateGameState(scene.state, null);
    return { npcExists: Boolean(npc), afterOffline, afterSelection: scene.localPlayer === player && npcBody() === npc,
      labelDisplayed: Boolean(selectedText), reusedLabel, labelRemoved: scene.inventorySelectionLabel === null };
  });
  expect(independentUpdates).toEqual({ npcExists: true, afterOffline: true, afterSelection: true,
    labelDisplayed: true, reusedLabel: true, labelRemoved: true });
  expect(await page.evaluate(() => document.querySelector('.vn-current-text') === (window as any).__presentationNode)).toBe(true);
  await page.locator('[data-vn-history]').click();
  await expect(page.locator('.vn-history')).toBeVisible();
  await expect(page.locator('.vn-history')).toContainText('I remember the rain');
  await page.keyboard.press('Escape');
  await expect(page.locator('.vn-overlay')).toHaveCount(0);
});

test('comic skip is local, survives reload, and reduced motion keeps the poster', async ({ page }) => {
  const state = { ...smokeState, presentation: { version: 'test-v1', cutscenes: [{ id: 'opening', trigger: 'INTRO', panels: [
    { id: 'one', imageUrl: '/assets/characters/eleanor-portrait.png', videoUrl: '/should-not-load.mp4', caption: 'The witness has a secret.' },
    { id: 'two', videoUrl: '/should-not-load-next.mp4', caption: 'A second secret.' },
  ] }] } };
  let videoRequests = 0;
  await page.route('**/should-not-load*.mp4', async (route) => { videoRequests++; await route.abort(); });
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('.comic-overlay')).toBeVisible();
  await expect(page.locator('.comic-caption')).toContainText('The witness has a secret.');
  await expect(page.locator('.comic-media img')).toBeVisible();
  expect(videoRequests).toBe(0);
  await page.locator('[data-comic-skip]').click();
  await expect(page.locator('.comic-overlay')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.locator('.comic-overlay')).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('sirlocked.presentation.smoke-room.player-1'));
  expect(saved).toContain('test-v1:opening');
});

test('comic preloads only the next permitted panel and reuses protected media until playback ends', async ({ page }) => {
  const mediaPath = `/api/game/rooms/${roomId}/presentation/media/`;
  const counts: Record<string, number> = {};
  const state = { ...smokeState, presentation: { version: 'preload-v1', cutscenes: [
    { id: 'opening', trigger: 'INTRO', panels: [
      { imageUrl: `${mediaPath}one`, caption: 'First panel' },
      { imageUrl: `${mediaPath}two`, videoUrl: `${mediaPath}two-video`, caption: 'Second panel' },
      { imageUrl: `${mediaPath}three`, caption: 'Third panel' },
    ] },
    { id: 'shared', trigger: 'REVEAL', panels: [{ imageUrl: `${mediaPath}reveal`, caption: 'An already shared truth' }] },
    { id: 'ending', trigger: 'ENDING', panels: [{ imageUrl: `${mediaPath}ending`, caption: 'Not yet permitted' }] },
  ] } };
  await page.addInitScript(() => {
    const w = window as any;
    w.__mediaCreated = []; w.__mediaRevoked = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); w.__mediaCreated.push(url); return url; };
    URL.revokeObjectURL = (url) => { w.__mediaRevoked.push(url); revoke(url); };
  });
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state } }));
  await page.route(`**${mediaPath}*`, async (route) => {
    const id = route.request().url().split('/').at(-1)!;
    counts[id] = (counts[id] || 0) + 1;
    expect(route.request().headers().authorization).toBe('Bearer smoke-token');
    // The intentionally unsupported clip also verifies the poster remains usable.
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="navy"/></svg>' });
  });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('.comic-caption')).toHaveText('First panel');
  await expect.poll(() => counts).toEqual({ one: 1, two: 1, 'two-video': 1 });
  await expect.poll(() => page.locator('.comic-media img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40);
  await page.locator('[data-comic-next]').click();
  await expect(page.locator('.comic-caption')).toHaveText('Second panel');
  await expect.poll(() => counts).toEqual({ one: 1, two: 1, 'two-video': 1, three: 1 });
  await expect.poll(() => page.locator('.comic-media img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40);
  await page.locator('[data-comic-next]').click();
  await expect(page.locator('.comic-caption')).toHaveText('Third panel');
  await expect.poll(() => counts.reveal).toBe(1);
  await page.locator('[data-comic-next]').click();
  await expect(page.locator('.comic-caption')).toHaveText('An already shared truth');
  await expect.poll(() => page.locator('.comic-media img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40);
  expect(counts).toEqual({ one: 1, two: 1, 'two-video': 1, three: 1, reveal: 1 });
  await page.locator('[data-comic-skip]').click();
  await expect(page.locator('.comic-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const w = window as any;
    return w.__mediaCreated.length > 0 && w.__mediaCreated.every((url: string) => w.__mediaRevoked.includes(url));
  })).toBe(true);
});

test('closing a comic aborts its pending next-panel preload', async ({ page }) => {
  const nextPoster = `/api/game/rooms/${roomId}/presentation/media/pending`;
  const state = { ...smokeState, presentation: { cutscenes: [{ id: 'pending', trigger: 'INTRO', panels: [
    { caption: 'Start investigating' }, { imageUrl: nextPoster, caption: 'Still loading' },
  ] }] } };
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    (window as any).__abortedMedia = [];
    window.fetch = (input, init) => {
      init?.signal?.addEventListener('abort', () => (window as any).__abortedMedia.push(String(input)));
      return original(input, init);
    };
  });
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state } }));
  let requested = false;
  await page.route(`**${nextPoster}`, () => { requested = true; });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('.comic-caption')).toHaveText('Start investigating');
  await expect.poll(() => requested).toBe(true);
  await page.locator('[data-comic-skip]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__abortedMedia)).toContain(nextPoster);
  await expect(page.locator('.comic-overlay')).toHaveCount(0);
});

test('team pings ignore the same user across tabs and disappear at server expiry', async ({ page }) => {
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.evaluate(() => {
    (window as any).__sirlockedEmitSignalR('TeamPing', {
      kind: 'COMPARE', senderUserId: 'player-1', expiresAt: new Date(Date.now() + 8000).toISOString(),
    });
  });
  await expect(page.locator('.partner-ping')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__sirlockedEmitSignalR('TeamPing', {
      kind: 'DISCOVERY', senderUserId: 'player-2', expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
  });
  await expect(page.locator('.partner-ping')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__sirlockedEmitSignalR('TeamPing', {
      kind: 'COMPARE', senderUserId: 'player-2', expiresAt: new Date(Date.now() + 900).toISOString(),
    });
  });
  await expect(page.locator('.partner-ping')).toContainText('Let’s compare');
  await expect(page.locator('.partner-ping')).toHaveCount(0, { timeout: 3000 });
});

for (const anchor of [
  { name: 'custom', input: { anchorX: 0.25, anchorY: 0.8 }, expected: { x: 0.25, y: 0.8 } },
  { name: 'clamped', input: { anchorX: -1, anchorY: 2 }, expected: { x: 0, y: 1 } },
  { name: 'default', input: {}, expected: { x: 0.5, y: 1 } },
]) test(`NPC sprite metadata uses ${anchor.name} artwork anchors without moving the interaction zone`, async ({ page }) => {
  const state = { ...interrogatorState, visibleScene: { ...interrogatorState.visibleScene,
    characters: interrogatorState.visibleScene.characters.map((character) => ({ ...character, presentation: { spriteSheet: { url: '/assets/players/holmes-sheet.png', frameWidth: 128, frameHeight: 192, frameCount: 6, fps: 6, idleFrames: [0, 1, 2, 3, 4, 5], ...anchor.input } } })) } };
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state } }));
  await page.goto(`/#/game/${roomId}`);
  const frame = () => page.evaluate(() => {
    const animation = (window as any).__sirlockedGame?.scene.getScene('SirLockedPhaserScene')?.npcAnimations?.[0];
    if (!animation) return null;
    const body = animation.body, zone = body.parentContainer.list.find((child: any) => child.type === 'Zone');
    return { frame: body.frame.name, x: body.x, y: body.y, originX: body.originX, originY: body.originY,
      zone: { x: zone.x, y: zone.y, width: zone.width, height: zone.height }, bodyHeight: body.displayHeight };
  });
  await expect.poll(frame).not.toBeNull();
  const before = (await frame())!;
  expect(before.originX).toBe(anchor.expected.x);
  expect(before.originY).toBe(anchor.expected.y);
  expect(before.zone.x).toBe(0);
  expect(before.zone.y).toBeCloseTo(-before.bodyHeight / 2);
  expect(before.zone.height).toBeCloseTo(before.bodyHeight);
  await expect.poll(async () => (await frame())?.frame).not.toBe(before.frame);
  expect((await frame())!.x).toBe(before.x);
  expect((await frame())!.y).toBe(before.y);
  expect((await frame())!.zone).toEqual(before.zone);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await frame())?.frame).toBe('npc-frame-0');
});

test('visual novel portrait media falls back safely and fits desktop and mobile', async ({ page }, testInfo) => {
  let authorizedVideoRequests = 0;
  const protectedVideo = `/api/game/rooms/${roomId}/presentation/media/portrait-fixture`;
  const state = { ...interrogatorState, visibleScene: { ...interrogatorState.visibleScene,
    backgroundUrl: '/assets/scenes/lobby.png',
    characters: interrogatorState.visibleScene.characters.map((character) => ({ ...character,
      name: 'Eleanor Whitmore', role: 'The leading actress',
      description: 'A practiced smile conceals a night she would rather forget.',
      imageUrl: '/assets/characters/eleanor-portrait.png',
      presentation: { portraitVideoUrl: protectedVideo } })) } };
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state } }));
  await page.route(`**${protectedVideo}`, async (route) => {
    expect(route.request().headers()['authorization']).toBe('Bearer smoke-token');
    authorizedVideoRequests++;
    await route.fulfill({ status: 404, body: '' });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/game/${roomId}`);
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').npcBreathing.length)).toBeGreaterThan(0);
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * .63, y: box.height * .81 } });
  await expect(page.locator('.vn-portrait-image')).toBeVisible();
  await expect.poll(() => authorizedVideoRequests).toBe(1);
  await expect(page.locator('.vn-portrait-video')).toBeHidden();
  await expect.poll(() => page.locator('.vn-portrait-image').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('dialogue-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.vn-speech-box')).toBeVisible();
  const bounds = (await page.locator('.vn-conversation').boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.waitForTimeout(100);
  await page.screenshot({ path: testInfo.outputPath('dialogue-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.vn-overlay')).toHaveCount(0);
});

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

test('Interrogator receives a large witness portrait and bottom speech panel', async ({ page }) => {
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
  expect(dialogueBox!.width).toBeGreaterThan(1440 * 0.7);
  expect(dialogueBox!.height).toBeLessThanOrEqual(900);
  await expect(page.locator('.vn-portrait-stage')).toBeVisible();
  const speech = await page.locator('.vn-speech-box').boundingBox();
  expect(speech!.y).toBeGreaterThan(900 * 0.4);
  await page.locator('[data-vn-close]').click();
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
  await expect(page.locator('#game-reconnect-wait')).toContainText('Syncing the reconnect deadline');
  await expect(page.locator('#abandon-game-btn')).toHaveCount(0);

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

test('offline countdown survives reload and waits for server confirmation at the five-minute deadline', async ({ page }, testInfo) => {
  const now = new Date('2026-09-28T02:00:00Z');
  const deadline = new Date(now.getTime() + 180_000).toISOString();
  let snapshot = {
    ...smokeState,
    players: smokeState.players.map((player) => ({
      ...player,
      isConnected: player.userId === 'player-1',
      // The server deadline also accounts for a game started after a disconnect.
      disconnectedAt: player.userId === 'player-2' ? new Date(now.getTime() - 600_000).toISOString() : null,
      reconnectGraceEndsAt: player.userId === 'player-2' ? deadline : null,
    })),
  };
  let requests = 0;
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => {
    requests++;
    return route.fulfill({ json: { success: true, data: snapshot } });
  });
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('03:00');
  await expect(page.locator('#game-reconnect-wait')).toContainText('ends automatically after 5 minutes');
  await expect(page.locator('#abandon-game-btn')).toHaveCount(0);
  await page.clock.runFor(32);
  await page.screenshot({ path: testInfo.outputPath('reconnect-countdown-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(32);
  await expect(page.locator('#game-reconnect-wait')).toBeVisible();
  const banner = (await page.locator('#game-reconnect-wait').boundingBox())!;
  expect(banner.x).toBeGreaterThanOrEqual(0);
  expect(banner.x + banner.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('reconnect-countdown-mobile.png') });

  await page.clock.fastForward(60_000);
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('02:00');
  await page.reload();
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('02:00');
  expect(requests).toBe(2);
  await page.clock.fastForward(119_000);
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('00:01');
  await page.clock.fastForward(1000);
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('00:00');
  await expect(page.locator('#game-reconnect-wait')).toContainText('Waiting for the server');
  await expect.poll(() => requests).toBe(3);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Room ended' })).toHaveCount(0);
  await page.clock.fastForward(30_000);
  expect(requests).toBe(3); // An elapsed client timer must neither end nor poll the room.

  snapshot = { ...snapshot, version: 2, roomStatus: 'ABANDONED' };
  await page.evaluate(() => (window as any).__sirlockedEmitSignalR('GameStateUpdated', { version: 2 }));
  await expect(page.getByRole('heading', { name: 'Room ended' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('#game-reconnect-wait')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to cases' })).toHaveAttribute('href', '#/cases');
  await page.clock.fastForward(600_000);
  expect(requests).toBe(4); // Ending the room disposes its countdown and state subscription.
});

test('reconnecting before the offline deadline cancels it and a later disconnect gets a fresh five minutes', async ({ page }) => {
  const now = new Date('2026-09-28T03:00:00Z');
  let requests = 0;
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => {
    requests++;
    return route.fulfill({ json: { success: true, data: smokeState } });
  });
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('#game-hud-slot .game-players')).toContainText('Partner');
  await page.evaluate(() => (window as any).__sirlockedEmitSignalR('PlayerPresenceChanged', {
    userId: 'player-2', isConnected: false, changedAt: new Date(Date.now()).toISOString(),
    graceEndsAt: new Date(Date.now() + 300_000).toISOString(),
  }));
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('05:00');
  await page.clock.fastForward(299_000);
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('00:01');
  await page.evaluate(() => (window as any).__sirlockedEmitSignalR('PlayerPresenceChanged', {
    userId: 'player-2', isConnected: true,
  }));
  await expect(page.locator('#game-reconnect-wait')).toHaveCount(0);
  await page.clock.fastForward(60_000);
  expect(requests).toBe(1);
  await expect(page.locator('canvas')).toHaveCount(1);

  // Older event contracts without graceEndsAt still use the persisted disconnect timestamp.
  await page.evaluate(() => (window as any).__sirlockedEmitSignalR('PlayerPresenceChanged', {
    userId: 'player-2', isConnected: false, changedAt: new Date(Date.now()).toISOString(),
  }));
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('05:00');
  await page.clock.fastForward(60_000);
  await expect(page.locator('#game-reconnect-countdown')).toHaveText('04:00');
  expect(requests).toBe(1);
});

test('both offline players returning to an ended room see the terminal screen for every mechanics version', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('sirlocked.uiLanguage', 'vi'));
  let mechanicsVersion = 1;
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: {
    success: true,
    data: {
      roomId, roomStatus: 'ABANDONED', version: 5, mechanicsVersion,
      players: smokeState.players.map((player) => ({ ...player, isConnected: false, disconnectedAt: '2026-09-28T00:00:00Z' })),
      // A terminal room does not need an active scene or private gameplay payload to render.
    },
  } }));
  for (mechanicsVersion of [1, 2, 3]) {
    await page.goto(`/#/game/${roomId}`);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Phòng đã kết thúc' })).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('mất kết nối liên tục 5 phút');
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('#game-reconnect-wait')).toHaveCount(0);
  }
});

test('a completed room keeps its result when returning players have old offline timestamps', async ({ page }) => {
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: {
    success: true,
    data: { ...smokeState, roomStatus: 'COMPLETED', players: smokeState.players.map((player) => ({
      ...player, isConnected: false, disconnectedAt: '2026-01-01T00:00:00Z',
    })) },
  } }));
  await page.route(`**/api/game/rooms/${roomId}/result`, (route) => route.fulfill({ json: {
    success: true,
    data: { success: true, ending: 'The case was already solved.', selectedEvidenceIds: [] },
  } }));
  await page.goto(`/#/game/${roomId}`);
  await expect(page).toHaveURL(new RegExp(`#/result/${roomId}$`));
  await expect(page.locator('.result-banner')).toHaveText('CASE CLOSED');
  await expect(page.locator('#game-reconnect-wait')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Room ended' })).toHaveCount(0);
});

test('failed room sync stops retrying and offers a working keyboard recovery action', async ({ page }, testInfo) => {
  let requests = 0;
  let healthy = false;
  await page.unroute(`**/api/game/rooms/${roomId}/state`);
  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    requests++;
    const success = requests === 1 || healthy;
    await route.fulfill({
      status: success ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(success
        ? { success: true, data: requests === 1 ? smokeState : progressedState }
        : { success: false, message: 'Temporarily unavailable.' }),
    });
  });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('#game-hud-slot .game-players')).toContainText('Partner');
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.evaluate(() => (window as any).__sirlockedEmitSignalR('GameStateUpdated', { version: 2 }));
  await expect(page.locator('.game-recovery')).toContainText('Restoring the latest room state');
  for (const [index, delay] of [500, 1000, 2000, 4000, 8000].entries()) {
    await page.clock.fastForward(delay);
    await expect.poll(() => requests).toBe(index + 3);
    await expect(page.locator('#game-recovery-retry')).toBeEnabled({ enabled: index === 4 });
  }
  await expect(page.locator('.game-recovery')).toContainText('could not be loaded');
  await page.clock.fastForward(60_000);
  expect(requests).toBe(7); // Initial page GET plus one attempt and five retries.
  await page.setViewportSize({ width: 390, height: 844 });
  const banner = await page.locator('.game-recovery').boundingBox();
  expect(banner!.x).toBeGreaterThanOrEqual(0);
  expect(banner!.x + banner!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('room-sync-recovery-mobile.png') });
  healthy = true;
  await page.locator('#game-recovery-retry').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#game-hud-slot .objective-brief')).toContainText('Investigate the unlocked hall.');
  await expect(page.locator('.game-recovery')).toHaveCount(0);
  expect(requests).toBe(8);
});

test('role guide tracks local actions, survives partner updates and reload, and can be dismissed or reopened', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/game/${roomId}`);
  const summary = page.locator('.role-guide-controls summary');
  await expect(summary).toContainText('0/3');
  await expect(page.locator('.role-guide-panel')).toBeHidden();
  await summary.click();
  await expect(page.locator('.role-guide-panel')).toContainText('Examine the scene');
  await expect(page.locator('.role-guide-panel li')).toHaveCount(3);
  await page.locator('[data-guide-dismiss]').click();
  await expect(summary).toBeFocused();
  await page.evaluate(() => (window as any).__sirlockedEmitSignalR('InvestigationUpdate', {
    type: 'ITEM_FOUND', actorUserId: 'player-2', actorRole: 'INTERROGATOR', message: 'Partner found a lead',
  }));
  await expect(summary).toContainText('0/3');
  await page.locator('#mobile-interact-btn').click();
  await expect(summary).toContainText('1/3');
  await page.locator('#discovery-case-file-btn').click();
  await expect(summary).toContainText('2/3');
  await page.keyboard.press('Escape');
  await page.locator('.team-ping-controls summary').click();
  await page.locator('[data-team-ping="COMPARE"]').click();
  await expect(summary).toContainText('3/3');
  await page.reload();
  await expect(summary).toContainText('3/3');
  await expect(page.locator('.role-guide-panel')).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.role-guide-panel')).toBeVisible();
  await expect(page.locator('.role-guide-panel .is-complete')).toHaveCount(3);
  const bounds = await page.locator('.role-guide-panel').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('role-guide-mobile.png') });
});

test('Interrogator guide checks questioning only after a successful local answer', async ({ page }) => {
  await page.unroute(`**/api/game/rooms/${roomId}/state`);
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: interrogatorState }),
  }));
  await page.route(`**/api/game/rooms/${roomId}/ask-dialogue`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { state: interrogatorState, changed: true, unlockedClueIds: [], message: 'Answered.' } }),
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('.role-guide-controls summary')).toContainText('0/3');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width * .63, y: box.height * .81 } });
  await expect(page.locator('.conversation-box')).toBeVisible();
  await expect(page.locator('[data-guide-progress]')).toHaveText('0/3');
  await page.locator('[data-dialogue]').first().click();
  await expect(page.locator('[data-guide-progress]')).toHaveText('1/3');
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

test('result screen plays only the eligible ending then shows verdict without overflow', async ({ page }) => {
  const resultRoomId = 'result-room';
  await page.route(`**/api/game/rooms/${resultRoomId}/result`, async (route) => {
    const row = (selectedLabel: string, correctLabel: string, isCorrect: boolean) => ({ selectedLabel, correctLabel, isCorrect });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {
        success: true,
        ending: 'The detectives connect the final contradiction and expose the culprit before dawn.',
        presentation: { version: 'ending-v1', cutscenes: [
          { id: 'ending', trigger: 'ENDING', panels: [{ caption: 'The city can sleep again.' }] },
          { id: 'old-intro', trigger: 'INTRO', panels: [{ caption: 'Do not replay the intro here.' }] },
        ] },
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
  await expect(page.locator('.comic-caption')).toHaveText('The city can sleep again.');
  await expect(page.locator('.comic-overlay')).not.toContainText('Do not replay');
  await page.locator('[data-comic-next]').click();
  await expect(page.locator('.comic-overlay')).toHaveCount(0);
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
