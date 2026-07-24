import { expect, test, type Page } from '@playwright/test';

const roomId = 'v3-ui-room';
const investigatorSecret = 'INV_SECRET_SENTINEL_7F91';
const interrogatorSecret = 'INT_SECRET_SENTINEL_42AC';

const evidence = {
  clueId: 'evidence-blue-wax',
  title: `Overlapping wax ${investigatorSecret}`,
  content: 'Two layers show that the packet was opened and resealed.',
  source: 'item-blue-wax',
  sourceType: 'item',
  sceneId: 'scene-archive',
  inventoryDescription: 'The lower seal is broken beneath fresh wax.',
  narrativeMeaning: 'This can contradict an intact-seal claim.',
  photoUrl: `/api/game/rooms/${roomId}/evidence/evidence-blue-wax/photo`,
};

const testimony = {
  testimonyFragmentId: 'fragment-seal-intact',
  dialogueId: 'dialogue-mara',
  characterId: 'char-mara',
  characterName: 'Mara Vale',
  text: `The seal remained intact and I never returned. ${interrogatorSecret}`,
};

function v3State(role: 'INVESTIGATOR' | 'INTERROGATOR', overrides: Record<string, unknown> = {}) {
  return {
    roomId,
    roomCode: 'V3UI01',
    hostUserId: 'player-1',
    caseId: 'case-v3-broken-seal-en',
    caseTitle: 'The Broken Seal',
    caseSummary: 'A V3 UI fixture.',
    language: 'en',
    mechanicsVersion: 3,
    roomStatus: 'IN_PROGRESS',
    currentSceneId: 'scene-archive',
    version: 1,
    players: [
      { userId: 'player-1', username: 'Local Player', role, isConnected: true },
      { userId: 'player-2', username: 'Partner', role: role === 'INVESTIGATOR' ? 'INTERROGATOR' : 'INVESTIGATOR', isConnected: true },
    ],
    visibleScene: {
      sceneId: 'scene-archive',
      title: 'Archive Office',
      description: 'Compare private notes with your partner.',
      backgroundUrl: '',
      runtime: {
        width: 1600,
        height: 900,
        floorY: 720,
        walkableArea: { x: 80, y: 620, width: 1440, height: 180 },
        spawnPoints: { default: { x: 400, y: 720, direction: 'right' } },
        itemPlacements: [],
        characterPlacements: [],
        transitions: [],
        clueZones: [],
      },
      hotspots: [],
      items: [],
      characters: [],
      availableDialogues: [],
      conversationTreeCharacterIds: [],
      conversationTranscript: [],
      puzzles: [],
    },
    unlockedSceneIds: ['scene-archive'],
    inspectedItemIds: [],
    collectedItemIds: [],
    capturedClueIds: [],
    usedInteractionIds: [],
    solvedPuzzleIds: [],
    wrongPuzzleCount: 0,
    collectedItems: [],
    unlockedClues: [],
    evidenceClues: [],
    resolvedConfrontations: [],
    deductions: [],
    testimonies: [],
    suspects: [],
    sceneMap: [{
      sceneId: 'scene-archive',
      title: 'Archive Office',
      isCurrent: true,
      isVisited: true,
      isUnlocked: true,
      isCompleted: false,
      pendingRequirementCount: 1,
    }],
    completedSceneIds: [],
    availableForAccusation: false,
    currentSceneCanComplete: false,
    currentSceneMissingRequirements: { requiredItemIds: [], requiredClueIds: [], requiredDialogueIds: [] },
    currentObjective: role === 'INVESTIGATOR' ? 'Find physical evidence.' : 'Question the witness.',
    isCaseComplete: false,
    actionLog: [],
    privateEvidence: role === 'INVESTIGATOR' ? [evidence] : [{ ...evidence, title: investigatorSecret }],
    privateTestimonies: role === 'INTERROGATOR' ? [testimony] : [{ ...testimony, text: interrogatorSecret }],
    sharedKnowledge: { attemptHistory: [], resolvedTruths: [] },
    activeConfrontation: null,
    ...overrides,
  };
}

function reviewState(role: 'INVESTIGATOR' | 'INTERROGATOR', overrides: Record<string, unknown> = {}) {
  return v3State(role, {
    version: 3,
    privateEvidence: [],
    privateTestimonies: [],
    activeConfrontation: {
      attemptId: 'f39167f2-d68e-44d1-b593-906224f4cf71',
      revision: 2,
      status: 'ReadyForReview',
      evidence,
      testimony,
      partnerHasProposed: true,
      confirmedByMe: false,
      partnerConfirmed: false,
      partnerConnected: true,
      canEdit: true,
      canConfirm: true,
      canCancel: true,
    },
    sharedKnowledge: {
      attemptHistory: [{
        attemptId: 'f39167f2-d68e-44d1-b593-906224f4cf71',
        revision: 2,
        status: 'ATTEMPT_DISCLOSED',
        evidence,
        testimony,
        reveals: [],
        disclosedAt: '2026-07-19T08:00:00Z',
      }],
      resolvedTruths: [],
    },
    ...overrides,
  });
}

function correctTerminalState(role: 'INVESTIGATOR' | 'INTERROGATOR') {
  const pair = {
    attemptId: 'f39167f2-d68e-44d1-b593-906224f4cf71',
    revision: 2,
    status: 'RESOLVED_SHARED_TRUTH',
    evidence,
    testimony,
    feedback: 'The overlapping layers prove the packet was resealed.',
    revealTitle: 'CRACKED: THE SEAL WAS REPLACED',
    reveals: [{
      clueId: 'reveal-resealed',
      title: 'The archive was resealed',
      content: 'Someone opened the packet and imitated the original seal.',
      narrativeMeaning: 'The contradiction is now shared truth.',
    }],
    disclosedAt: '2026-07-19T08:00:00Z',
    resolvedAt: '2026-07-19T08:01:00Z',
  };
  return reviewState(role, {
    version: 5,
    currentObjective: 'Archive Office is the final location. The final confrontation is ready when every requirement is complete.',
    isCaseComplete: undefined,
    activeConfrontation: null,
    sharedKnowledge: { attemptHistory: [], resolvedTruths: [pair] },
  });
}

function exhaustedRetryState(role: 'INVESTIGATOR' | 'INTERROGATOR') {
  const attempts = [0, 1, 2].map((index) => ({
    attemptId: `failed-attempt-${index + 1}`,
    revision: 2,
    status: 'ResolvedIncorrect',
    evidence: {
      ...evidence,
      clueId: `evidence-${index + 1}`,
      title: `Evidence option ${index + 1}`,
    },
    testimony: {
      ...testimony,
      testimonyFragmentId: `testimony-${index + 1}`,
      text: `Testimony option ${index + 1}`,
    },
    feedback: 'This pair does not establish a direct contradiction.',
    reveals: [],
    disclosedAt: `2026-07-19T08:0${index}:00Z`,
    resolvedAt: `2026-07-19T08:0${index}:30Z`,
  }));
  return v3State(role, {
    version: 8,
    privateEvidence: [],
    privateTestimonies: [],
    sharedKnowledge: { attemptHistory: attempts, resolvedTruths: [] },
    activeConfrontation: null,
  });
}

async function prepare(page: Page, initialState: ReturnType<typeof v3State>) {
  await page.addInitScript(([id]) => {
    window.localStorage.setItem('sirlocked.token', 'v3-ui-token');
    window.localStorage.setItem('sirlocked.uiLanguage', 'en');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'player-1',
      fullName: 'Local Player',
      role: 'PLAYER',
      isEmailVerified: true,
    }));
    window.sessionStorage.setItem(`sirlocked.intro.${id}`, '1');
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, [roomId]);
  await page.route(`**/api/game/rooms/${roomId}/state`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: initialState }) });
  });
  await page.route(`**/api/game/rooms/${roomId}/playtest-events`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body).not.toHaveProperty('evidenceId');
    expect(body).not.toHaveProperty('fragmentId');
    expect(body).not.toHaveProperty('content');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: true }) });
  });
  await page.route(`**/api/game/rooms/${roomId}/evidence/*/photo`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#315d9a"/></svg>',
    });
  });
}

test('role-private notebooks never render partner sentinels before Joint Review', async ({ browser }) => {
  const investigatorContext = await browser.newContext();
  const investigatorPage = await investigatorContext.newPage();
  await prepare(investigatorPage, v3State('INVESTIGATOR'));
  await investigatorPage.goto(`/#/game/${roomId}`);
  await investigatorPage.locator('#case-file-btn').click();
  await expect(investigatorPage.locator('[data-private-evidence-card]')).toContainText(investigatorSecret);
  await expect(investigatorPage.locator('.v3-private-photo')).toHaveAttribute('src', /^blob:/);
  await investigatorPage.locator('[data-case-tab="testimony"]').click();
  await expect(investigatorPage.locator('body')).not.toContainText(interrogatorSecret);

  const interrogatorContext = await browser.newContext();
  const interrogatorPage = await interrogatorContext.newPage();
  await prepare(interrogatorPage, v3State('INTERROGATOR'));
  await interrogatorPage.goto(`/#/game/${roomId}`);
  await interrogatorPage.locator('#case-file-btn').click();
  await expect(interrogatorPage.locator('body')).not.toContainText(investigatorSecret);
  await expect(interrogatorPage.locator('.v3-private-photo')).toHaveCount(0);
  await interrogatorPage.locator('[data-case-tab="testimony"]').click();
  await expect(interrogatorPage.locator('[data-private-testimony-card]')).toContainText(interrogatorSecret);

  await investigatorContext.close();
  await interrogatorContext.close();
});

test('all disclosed wrong options remain reusable from each owner notebook', async ({ browser }) => {
  const interrogatorContext = await browser.newContext();
  const interrogatorPage = await interrogatorContext.newPage();
  await prepare(interrogatorPage, exhaustedRetryState('INTERROGATOR'));
  await interrogatorPage.goto(`/#/game/${roomId}`);
  await interrogatorPage.locator('#case-file-btn').click();
  await interrogatorPage.locator('[data-case-tab="testimony"]').click();
  await expect(interrogatorPage.locator('[data-private-testimony-card]')).toHaveCount(3);
  const startButtons = interrogatorPage.locator('[data-v3-start-testimony]');
  await expect(startButtons).toHaveCount(3);
  await expect(startButtons.first()).toBeEnabled();
  await expect(interrogatorPage.locator('.v3-private-list')).toContainText('SHARED BEFORE');

  const investigatorContext = await browser.newContext();
  const investigatorPage = await investigatorContext.newPage();
  await prepare(investigatorPage, exhaustedRetryState('INVESTIGATOR'));
  await investigatorPage.goto(`/#/game/${roomId}`);
  await investigatorPage.locator('#case-file-btn').click();
  await expect(investigatorPage.locator('[data-private-evidence-card]')).toHaveCount(3);
  await expect(investigatorPage.locator('.v3-private-list')).toContainText('Waiting for a testimony proposal');

  await interrogatorContext.close();
  await investigatorContext.close();
});

test('Joint Review discloses exactly the pair and correct confirmation presents shared payoff', async ({ page }) => {
  const initial = reviewState('INVESTIGATOR');
  const terminal = correctTerminalState('INVESTIGATOR');
  await prepare(page, initial);
  await page.route(`**/api/game/rooms/${roomId}/paired-confrontations/*/confirm`, async (route) => {
    const request = route.request().postDataJSON();
    expect(request.expectedRevision).toBe(2);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          state: terminal,
          changed: true,
          attemptId: initial.activeConfrontation.attemptId,
          revision: 2,
          status: 'ResolvedCorrect',
          isTerminal: true,
        },
      }),
    });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/#/game/${roomId}`);
  await page.locator('#case-file-btn').click();
  await page.locator('[data-case-tab="contradictions"]').click();
  await expect(page.locator('.v3-joint-review')).toContainText(interrogatorSecret);
  await expect(page.locator('.v3-joint-review')).toContainText(investigatorSecret);
  await expect(page.locator('.v3-pair-photo')).toHaveAttribute('src', /^blob:/);
  await page.locator('[data-v3-confirm]').click();

  const payoff = page.locator('.v3-crack-overlay');
  await expect(payoff).toBeVisible();
  await expect(payoff).toContainText('CRACKED: THE SEAL WAS REPLACED');
  await expect(payoff).toContainText('The archive was resealed');
  await expect(payoff.locator('.v3-crack-photo')).toHaveAttribute('src', /^blob:/);
  const box = await payoff.locator('.v3-crack-stage').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeLessThanOrEqual(728);
  await expect(page.locator('#v3-crack-dismiss')).toBeFocused();
  await page.locator('#v3-crack-dismiss').click();
  await expect(payoff).toHaveCount(0);
  const completed = page.locator('.v3-case-complete-overlay');
  await expect(completed).toHaveCount(0);
  await expect(page.locator('#game-hud-slot .objective-brief')).toContainText('final location');
  await expect(page.locator('.v3-shared-history')).toContainText('RESOLVED SHARED TRUTH');
  await expect(page.locator('.v3-shared-history')).toContainText(investigatorSecret);
  await expect(page.locator('.v3-history-photo')).toHaveAttribute('src', /^blob:/);
});

test('reduced motion keeps the payoff accessible without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page, reviewState('INVESTIGATOR'));
  await page.route(`**/api/game/rooms/${roomId}/paired-confrontations/*/confirm`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { state: correctTerminalState('INVESTIGATOR'), changed: true } }),
    });
  });
  await page.goto(`/#/game/${roomId}`);
  await page.locator('#case-file-btn').click();
  await page.locator('[data-case-tab="contradictions"]').click();
  await page.locator('[data-v3-confirm]').click();
  await expect(page.locator('.v3-crack-overlay')).toBeVisible();
  await expect(page.locator('.v3-crack-overlay')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.v3-crack-stage')).toHaveCSS('animation-name', 'none');
});
