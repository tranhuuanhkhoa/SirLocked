import { expect, type Locator, test } from '@playwright/test';

const roomId = 'smoke-room';

const smokeState = {
  roomId,
  roomCode: 'SMOKE1',
  caseTitle: 'Smoke Case',
  caseSummary: 'A deterministic UI smoke case.',
  mechanicsVersion: 2,
  roomStatus: 'IN_PROGRESS',
  currentSceneId: 'scene-smoke',
  version: 1,
  players: [
    { userId: 'player-1', username: 'Smoke Player', role: 'INVESTIGATOR' },
    { userId: 'player-2', username: 'Partner', role: 'INTERROGATOR' },
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
    items: [],
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
    },
  ],
  completedSceneIds: [],
  availableForAccusation: false,
  currentSceneCanComplete: false,
  currentSceneMissingRequirements: {
    requiredItemIds: [],
    requiredClueIds: [],
    requiredDialogueIds: [],
  },
  currentObjective: 'Talk to the witness.',
  actionLog: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([id]) => {
    window.localStorage.setItem('sirlocked.token', 'smoke-token');
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
});

test('game screen renders canvas, HUD, inventory, dialogue, and mobile controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/game/${roomId}`);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect(page.locator('#game-hud-slot .game-objective')).toContainText('Talk to the witness.');
  await expect(page.locator('.investigation-tool-dock')).toBeVisible();
  await expect(page.locator('.mobile-movement-dock')).toBeVisible();
  await expect(page.locator('#mobile-camera-btn')).toBeVisible();
  await expect(page.locator('#mobile-inventory-btn')).toBeVisible();

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

  await page.locator('.close-drawer-btn').click();
  await page.locator('#mobile-interact-btn').click();
  await expect(page.locator('.conversation-box')).toBeVisible();
  await expect(page.locator('.conversation-choices')).toContainText('Waiting for the Interrogator');
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
