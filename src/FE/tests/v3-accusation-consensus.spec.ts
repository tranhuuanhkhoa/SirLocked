import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

type Role = 'INVESTIGATOR' | 'INTERROGATOR';

const investigatorUserId = 'investigator-user';
const interrogatorUserId = 'interrogator-user';

const suspects = [
  { characterId: 'char-mara', name: 'Mara Vale', role: 'Archivist', imageUrl: '', description: '' },
  { characterId: 'char-jonas', name: 'Jonas Reed', role: 'Night guard', imageUrl: '', description: '' },
];

const evidenceClues = [
  { clueId: 'evidence-blue-wax', title: 'Overlapping wax', content: 'The packet was resealed.', isEvidence: true },
  { clueId: 'evidence-ticket', title: 'Ticket stub', content: 'A tram ticket.', isEvidence: true },
  { clueId: 'evidence-thread', title: 'Muddy thread', content: 'A corridor fiber.', isEvidence: true },
];

const claimTypes = ['MOTIVE', 'METHOD', 'OPPORTUNITY'];

type Proposal = {
  attemptId: string;
  revision: number;
  proposedByUserId: string;
  culpritId: string;
  motiveId: string;
  methodId: string;
  evidenceIds: string[];
  evidenceLinks: Array<{ claimType: string; evidenceId: string }>;
  confirmedUserIds: string[];
};

/**
 * A deterministic stand-in for the accusation consensus endpoints. It mirrors the backend rules that
 * matter to the UI: the author counts as confirmed, an amend voids every earlier confirmation, and
 * the case only completes once both players confirm the same revision.
 */
class SharedAccusationFlow {
  readonly roomId: string;
  version = 1;
  active: Proposal | null = null;
  completed = false;

  constructor(run: number) {
    this.roomId = `v3-accusation-consensus-${run}`;
  }

  project() {
    return {
      roomId: this.roomId,
      roomCode: 'ACCUSE',
      hostUserId: investigatorUserId,
      caseId: 'case-v3-broken-seal-en',
      caseTitle: 'The Broken Seal',
      caseSummary: 'Two-browser accusation consensus.',
      language: 'en',
      mechanicsVersion: 3,
      roomStatus: this.completed ? 'COMPLETED' : 'IN_PROGRESS',
      currentSceneId: 'scene-archive',
      version: this.version,
      players: [
        { userId: investigatorUserId, username: 'Investigator', role: 'INVESTIGATOR', isConnected: true },
        { userId: interrogatorUserId, username: 'Interrogator', role: 'INTERROGATOR', isConnected: true },
      ],
      visibleScene: {
        sceneId: 'scene-archive', title: 'Archive Office', description: 'Close the case.', backgroundUrl: '',
        runtime: { width: 1600, height: 900, floorY: 720, walkableArea: { x: 80, y: 620, width: 1440, height: 180 }, spawnPoints: { default: { x: 400, y: 720, direction: 'right' } }, itemPlacements: [], characterPlacements: [], transitions: [], clueZones: [] },
        hotspots: [], items: [], characters: [], availableDialogues: [], conversationTreeCharacterIds: [], conversationTranscript: [], puzzles: [],
      },
      unlockedSceneIds: ['scene-archive'], inspectedItemIds: [], collectedItemIds: [], capturedClueIds: [],
      usedInteractionIds: [], solvedPuzzleIds: [], wrongPuzzleCount: 0, collectedItems: [],
      unlockedClues: evidenceClues, evidenceClues, resolvedConfrontations: [], deductions: [], testimonies: [],
      accusationConfig: {
        motiveOptions: [{ id: 'motive-debt', label: 'Silencing a creditor' }],
        methodOptions: [{ id: 'method-opener', label: 'A letter opener' }],
        claimTypes,
      },
      suspects,
      sceneMap: [{ sceneId: 'scene-archive', title: 'Archive Office', isCurrent: true, isVisited: true, isUnlocked: true, isCompleted: true, pendingRequirementCount: 0 }],
      completedSceneIds: ['scene-archive'], availableForAccusation: !this.completed, currentSceneCanComplete: true,
      currentSceneMissingRequirements: { requiredItemIds: [], requiredClueIds: [], requiredDialogueIds: [] },
      currentObjective: 'Name the culprit together.', actionLog: [],
      privateEvidence: [], privateTestimonies: [],
      sharedKnowledge: { attemptHistory: [], resolvedTruths: [] },
      activeConfrontation: null,
      activeAccusation: this.active,
    };
  }

  async route(role: Role, route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const userId = role === 'INVESTIGATOR' ? investigatorUserId : interrogatorUserId;
    const success = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    const failure = (status: number, code: string, message: string) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message, errors: { code, messageKey: 'game.accusation.notActive' } }),
    });

    if (request.method() === 'GET' && path.endsWith('/state')) return success(this.project());
    if (request.method() === 'GET' && path.endsWith('/result')) return success(this.result());
    if (path.endsWith('/playtest-events')) return success({ recorded: true });

    const body = request.postDataJSON() ?? {};
    if (request.method() === 'POST' && path.endsWith('/accusation')) {
      if (this.active) return failure(409, 'ACCUSATION_NOT_ACTIVE', 'A final accusation proposal is already open.');
      this.active = {
        attemptId: 'attempt-1',
        revision: 1,
        proposedByUserId: userId,
        culpritId: body.culpritId,
        motiveId: body.motiveId,
        methodId: body.methodId,
        evidenceIds: body.evidenceIds ?? [],
        evidenceLinks: body.evidenceLinks ?? [],
        confirmedUserIds: [userId],
      };
      this.version++;
      return success({ state: this.project(), changed: true, accusation: this.active, result: null });
    }
    if (!this.active) return failure(409, 'ACCUSATION_NOT_ACTIVE', 'This accusation proposal is not the active one.');
    if (body.expectedRevision !== this.active.revision) {
      return failure(409, 'ACCUSATION_STALE_REVISION', 'The proposal changed; review it again before confirming.');
    }

    if (request.method() === 'PUT') {
      this.active = {
        ...this.active,
        revision: this.active.revision + 1,
        culpritId: body.culpritId,
        motiveId: body.motiveId,
        methodId: body.methodId,
        evidenceIds: body.evidenceIds ?? [],
        evidenceLinks: body.evidenceLinks ?? [],
        // An amend is a different decision, so only its author has agreed to it.
        confirmedUserIds: [userId],
      };
      this.version++;
      return success({ state: this.project(), changed: true, accusation: this.active, result: null });
    }
    if (path.endsWith('/cancel')) {
      const cancelled = { ...this.active, status: 'Cancelled' };
      this.active = null;
      this.version++;
      return success({ state: this.project(), changed: true, accusation: cancelled, result: null });
    }
    if (path.endsWith('/confirm')) {
      if (this.active.confirmedUserIds.includes(userId)) {
        return success({ state: this.project(), changed: false, accusation: this.active, result: null });
      }
      this.active.confirmedUserIds.push(userId);
      this.version++;
      if (this.active.confirmedUserIds.length < 2) {
        return success({ state: this.project(), changed: true, accusation: this.active, result: null });
      }
      const resolved = { ...this.active, status: 'Resolved' };
      this.completed = true;
      this.active = null;
      this.version++;
      return success({ state: this.project(), changed: true, accusation: resolved, result: this.result() });
    }
    return failure(404, 'ACCUSATION_NOT_ACTIVE', 'This accusation proposal is not the active one.');
  }

  private result() {
    return {
      roomId: this.roomId,
      caseId: 'case-v3-broken-seal-en',
      caseTitle: 'The Broken Seal',
      selectedCulpritId: 'char-jonas',
      selectedCulpritName: 'Jonas Reed',
      selectedEvidenceIds: evidenceClues.map((clue) => clue.clueId),
      success: true,
      ending: 'The seal is broken.',
      correctCulpritId: 'char-jonas',
      correctCulpritName: 'Jonas Reed',
      motive: 'Silencing a creditor',
      method: 'A letter opener',
      requiredEvidenceIds: evidenceClues.map((clue) => clue.clueId),
      evidenceResults: [],
      scoreSummary: null,
      completedAt: new Date().toISOString(),
    };
  }
}

async function contextFor(browser: Browser, flow: SharedAccusationFlow, role: Role) {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  const userId = role === 'INVESTIGATOR' ? investigatorUserId : interrogatorUserId;
  await page.addInitScript(({ roomId, userId }) => {
    window.localStorage.setItem('sirlocked.token', `${userId}-token`);
    window.localStorage.setItem('sirlocked.uiLanguage', 'en');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({ userId, fullName: userId, role: 'PLAYER', isEmailVerified: true }));
    window.sessionStorage.setItem(`sirlocked.intro.${roomId}`, '1');
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, { roomId: flow.roomId, userId });
  // A throw while drawing leaves the previous overlay on screen and looks like nothing happened,
  // so the consensus modal is only trustworthy if the page raised nothing at all.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`**/api/game/rooms/${flow.roomId}/**`, (route) => flow.route(role, route));
  await page.goto(`/#/game/${flow.roomId}`);
  return { context, page, errors };
}

async function emitState(page: Page, version: number) {
  await page.evaluate(({ version }) => {
    (window as unknown as { __sirlockedEmitSignalR?: (event: string, payload: unknown) => void })
      .__sirlockedEmitSignalR?.('GameStateUpdated', { version });
  }, { version });
}

/** Walks the five-step accusation wizard and submits it. */
async function buildAccusation(page: Page, culpritId: string) {
  await page.locator(`[data-suspect="${culpritId}"]`).click();
  await page.locator('#accuse-next').click();
  await page.locator('[data-motive="motive-debt"]').click();
  await page.locator('#accuse-next').click();
  await page.locator('[data-method="method-opener"]').click();
  await page.locator('#accuse-next').click();
  for (const [index, claim] of claimTypes.entries()) {
    await page.locator(`[data-claim-slot="${claim}"]`).click();
    await page.locator(`[data-assign-evidence="${evidenceClues[index].clueId}"]`).click();
  }
  await page.locator('#accuse-next').click();
  await page.locator('#accuse-confirm').click();
}

test('one detective cannot end the case; both must confirm the same revision', async ({ browser }) => {
  const flow = new SharedAccusationFlow(1);
  const investigator = await contextFor(browser, flow, 'INVESTIGATOR');
  const interrogator = await contextFor(browser, flow, 'INTERROGATOR');

  // A proposes the whole accusation.
  await investigator.page.locator('#accuse-btn').click();
  const proposed = investigator.page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/accusation'));
  await buildAccusation(investigator.page, 'char-mara');
  await proposed;

  // A authored it, so A already counts as confirmed and is simply waiting.
  await expect(investigator.page.locator('[data-accusation-attempt="attempt-1"]')).toContainText('Mara Vale');
  await expect(investigator.page.locator('.v3-waiting')).toBeVisible();
  await expect(investigator.page.locator('#accusation-confirm')).toBeDisabled();

  // B sees the same proposal and disagrees about the suspect.
  await emitState(interrogator.page, flow.version);
  const panel = interrogator.page.locator('[data-accusation-attempt="attempt-1"]');
  await expect(panel).toContainText('Mara Vale');
  await expect(panel).toContainText('Overlapping wax');
  const amended = interrogator.page.waitForResponse((response) => response.request().method() === 'PUT');
  await interrogator.page.locator('#accusation-amend').click();
  await buildAccusation(interrogator.page, 'char-jonas');
  await amended;
  await expect(interrogator.page.locator('[data-accusation-revision="2"]')).toContainText('Jonas Reed');

  // A must re-read before the stale confirm button comes back.
  await emitState(investigator.page, flow.version);
  await expect(investigator.page.locator('[data-accusation-revision-warning]')).toBeVisible();
  await expect(investigator.page.locator('#accusation-confirm')).toHaveCount(0);
  await expect(investigator.page.locator('[data-accusation-revision="2"]')).toContainText('Jonas Reed');
  await investigator.page.locator('#accusation-review').click();

  // A confirms revision 2, which is the second agreement and closes the case for both.
  await investigator.page.locator('#accusation-confirm').click();
  await expect(investigator.page).toHaveURL(new RegExp(`#/result/${flow.roomId}$`));

  await emitState(interrogator.page, flow.version);
  await expect(interrogator.page).toHaveURL(new RegExp(`#/result/${flow.roomId}$`));

  expect(investigator.errors).toEqual([]);
  expect(interrogator.errors).toEqual([]);
  await investigator.context.close();
  await interrogator.context.close();
});

test('withdrawing a proposal reopens the accusation for either detective', async ({ browser }) => {
  const flow = new SharedAccusationFlow(2);
  const investigator = await contextFor(browser, flow, 'INVESTIGATOR');
  const interrogator = await contextFor(browser, flow, 'INTERROGATOR');

  await investigator.page.locator('#accuse-btn').click();
  const proposed = investigator.page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/accusation'));
  await buildAccusation(investigator.page, 'char-mara');
  await proposed;

  await emitState(interrogator.page, flow.version);
  const withdrawn = interrogator.page.waitForResponse((response) => response.url().endsWith('/cancel'));
  await interrogator.page.locator('#accusation-cancel').click();
  await withdrawn;

  await expect(interrogator.page.locator('[data-accusation-attempt="attempt-1"]')).toHaveCount(0);
  await expect(interrogator.page.locator('#accuse-btn')).toBeVisible();

  await emitState(investigator.page, flow.version);
  await expect(investigator.page.locator('#accuse-btn')).toBeVisible();

  expect(investigator.errors).toEqual([]);
  expect(interrogator.errors).toEqual([]);
  await investigator.context.close();
  await interrogator.context.close();
});
