import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

const investigatorSentinel = 'INV_SECRET_SENTINEL_7F91';
const interrogatorSentinel = 'INT_SECRET_SENTINEL_42AC';

type Role = 'INVESTIGATOR' | 'INTERROGATOR';
type Confirmation = { role: Role; userId: string };
type Disclosure = { revision: number; evidenceId: string; testimonyId: string; disclosedAt: string };

const evidenceChoices = [
  { clueId: 'evidence-blue-wax', title: `Overlapping wax ${investigatorSentinel}`, inventoryDescription: 'Two wax layers overlap.', content: 'The packet was resealed.' },
  { clueId: 'evidence-ticket', title: 'Ticket stub', inventoryDescription: 'A plausible timeline clue.', content: 'A tram ticket.' },
  { clueId: 'evidence-thread', title: 'Muddy thread', inventoryDescription: 'A transferable corridor fiber.', content: 'A loose thread.' },
];

const testimonyChoices = [
  { testimonyFragmentId: 'fragment-seal-intact', text: `The seal remained intact. ${interrogatorSentinel}` },
  { testimonyFragmentId: 'fragment-no-bag', text: 'I carried no bag.' },
  { testimonyFragmentId: 'fragment-guard-round', text: 'The guard began rounds after closing.' },
].map((fragment) => ({
  ...fragment,
  dialogueId: 'dialogue-mara',
  characterId: 'char-mara',
  characterName: 'Mara Vale',
}));

class SharedV3Flow {
  readonly roomId: string;
  version = 1;
  discoveredEvidence = false;
  discoveredTestimony = false;
  active: null | {
    attemptId: string;
    revision: number;
    testimonyId: string;
    evidenceId: string | null;
    confirmations: Confirmation[];
    disclosures: Disclosure[];
  } = null;
  terminals: Array<{
    attemptId: string;
    revision: number;
    status: 'ResolvedIncorrect' | 'RESOLVED_SHARED_TRUTH';
    evidenceId: string;
    testimonyId: string;
    feedback: string;
    revealTitle?: string;
    disclosures: Disclosure[];
    resolvedAt: string;
  }> = [];

  constructor(run: number) {
    this.roomId = `v3-two-browser-${run}`;
  }

  project(role: Role) {
    const userId = role === 'INVESTIGATOR' ? 'investigator-user' : 'interrogator-user';
    const disclosedEvidence = new Set(this.terminals.flatMap((terminal) => terminal.disclosures.map((entry) => entry.evidenceId)));
    const disclosedTestimony = new Set(this.terminals.flatMap((terminal) => terminal.disclosures.map((entry) => entry.testimonyId)));
    for (const disclosure of this.active?.disclosures ?? []) {
      disclosedEvidence.add(disclosure.evidenceId);
      disclosedTestimony.add(disclosure.testimonyId);
    }
    const reviewVisible = Boolean(this.active?.evidenceId);
    const activeView = this.active ? {
      attemptId: this.active.attemptId,
      revision: this.active.revision,
      status: reviewVisible
        ? (this.active.confirmations.length > 0 ? 'AwaitingSecondConfirmation' : 'ReadyForReview')
        : 'CollectingProposals',
      evidence: this.active.evidenceId && (reviewVisible || role === 'INVESTIGATOR')
        ? this.evidence(this.active.evidenceId)
        : null,
      testimony: reviewVisible || role === 'INTERROGATOR'
        ? this.testimony(this.active.testimonyId)
        : null,
      partnerHasProposed: role === 'INVESTIGATOR' ? true : Boolean(this.active.evidenceId),
      confirmedByMe: this.active.confirmations.some((entry) => entry.userId === userId),
      partnerConfirmed: this.active.confirmations.some((entry) => entry.userId !== userId),
      partnerConnected: true,
      canEdit: true,
      canConfirm: reviewVisible && !this.active.confirmations.some((entry) => entry.userId === userId),
      canCancel: true,
    } : null;

    const history = [
      ...this.terminals.flatMap((terminal) => terminal.disclosures
        .filter((entry) => terminal.status !== 'RESOLVED_SHARED_TRUTH' || entry.revision !== terminal.revision)
        .map((entry) => this.pair(terminal.attemptId, entry, entry.revision === terminal.revision ? terminal.status : 'ATTEMPT_DISCLOSED',
          entry.revision === terminal.revision ? terminal.feedback : null,
          entry.revision === terminal.revision ? terminal.resolvedAt : null))),
      ...(this.active?.disclosures.map((entry) => this.pair(this.active!.attemptId, entry, 'ATTEMPT_DISCLOSED', null, null)) ?? []),
    ];
    const truths = this.terminals
      .filter((terminal) => terminal.status === 'RESOLVED_SHARED_TRUTH')
      .map((terminal) => {
        const finalDisclosure = terminal.disclosures.find((entry) => entry.revision === terminal.revision)!;
        return {
          ...this.pair(terminal.attemptId, finalDisclosure, terminal.status, terminal.feedback, terminal.resolvedAt),
          revealTitle: terminal.revealTitle,
          reveals: [{
            clueId: 'reveal-resealed',
            title: 'The archive was resealed',
            content: 'Someone opened the packet and imitated the seal.',
            narrativeMeaning: 'A shared truth.',
          }],
        };
      });

    return {
      roomId: this.roomId,
      roomCode: 'V3FLOW',
      hostUserId: 'investigator-user',
      caseId: 'case-v3-broken-seal-en',
      caseTitle: 'The Broken Seal',
      caseSummary: 'Two-browser deterministic V3 flow.',
      language: 'en',
      mechanicsVersion: 3,
      roomStatus: 'IN_PROGRESS',
      currentSceneId: 'scene-archive',
      version: this.version,
      players: [
        { userId: 'investigator-user', username: 'Investigator', role: 'INVESTIGATOR', isConnected: true },
        { userId: 'interrogator-user', username: 'Interrogator', role: 'INTERROGATOR', isConnected: true },
      ],
      visibleScene: {
        sceneId: 'scene-archive', title: 'Archive Office', description: 'Compare private notes.', backgroundUrl: '',
        runtime: { width: 1600, height: 900, floorY: 720, walkableArea: { x: 80, y: 620, width: 1440, height: 180 }, spawnPoints: { default: { x: 400, y: 720, direction: 'right' } }, itemPlacements: [], characterPlacements: [], transitions: [], clueZones: [] },
        hotspots: [], items: [], characters: [], availableDialogues: [], conversationTreeCharacterIds: [], conversationTranscript: [], puzzles: [],
      },
      unlockedSceneIds: ['scene-archive'], inspectedItemIds: [], collectedItemIds: [], capturedClueIds: [], usedInteractionIds: [], solvedPuzzleIds: [], wrongPuzzleCount: 0,
      collectedItems: [], unlockedClues: [], evidenceClues: [], resolvedConfrontations: [], deductions: [], testimonies: [], suspects: [],
      sceneMap: [{ sceneId: 'scene-archive', title: 'Archive Office', isCurrent: true, isVisited: true, isUnlocked: true, isCompleted: false, pendingRequirementCount: 1 }],
      completedSceneIds: [], availableForAccusation: false, currentSceneCanComplete: false,
      currentSceneMissingRequirements: { requiredItemIds: [], requiredClueIds: [], requiredDialogueIds: [] },
      currentObjective: role === 'INVESTIGATOR' ? 'Find physical evidence.' : 'Question the witness.', actionLog: [],
      privateEvidence: role === 'INVESTIGATOR' && this.discoveredEvidence
        ? evidenceChoices.filter((entry) => !disclosedEvidence.has(entry.clueId)).map((entry) => ({ ...entry, source: `item-${entry.clueId}`, sourceType: 'item', sceneId: 'scene-archive', narrativeMeaning: entry.content }))
        : [],
      privateTestimonies: role === 'INTERROGATOR' && this.discoveredTestimony
        ? testimonyChoices.filter((entry) => !disclosedTestimony.has(entry.testimonyFragmentId))
        : [],
      sharedKnowledge: { attemptHistory: history, resolvedTruths: truths },
      activeConfrontation: activeView,
    };
  }

  async route(role: Role, route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const userId = role === 'INVESTIGATOR' ? 'investigator-user' : 'interrogator-user';
    const success = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    const failure = (status: number, code: string) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'This confrontation action is not available.', errors: { code, messageKey: 'game.confrontation.notAvailable' } }),
    });

    if (request.method() === 'GET' && path.endsWith('/state')) return success(this.project(role));
    if (path.endsWith('/inspect-item')) {
      if (role !== 'INVESTIGATOR') return failure(403, 'CONFRONTATION_WRONG_ROLE');
      this.discoveredEvidence = true;
      this.version++;
      return success({ state: this.project(role), changed: true, unlockedClueIds: evidenceChoices.map((entry) => entry.clueId) });
    }
    if (path.endsWith('/ask-dialogue')) {
      if (role !== 'INTERROGATOR') return failure(403, 'CONFRONTATION_WRONG_ROLE');
      this.discoveredTestimony = true;
      this.version++;
      return success({ state: this.project(role), changed: true, unlockedClueIds: [] });
    }

    const body = request.postDataJSON() ?? {};
    if (request.method() === 'POST' && path.endsWith('/paired-confrontations')) {
      if (role !== 'INTERROGATOR') return failure(403, 'CONFRONTATION_WRONG_ROLE');
      this.active = { attemptId: body.attemptId, revision: 1, testimonyId: body.testimonyFragmentId, evidenceId: null, confirmations: [], disclosures: [] };
      this.version++;
      return success(this.command(role, true));
    }
    if (!this.active) return failure(409, 'CONFRONTATION_NOT_AVAILABLE');
    if (path.endsWith('/evidence')) {
      if (role !== 'INVESTIGATOR') return failure(403, 'CONFRONTATION_WRONG_ROLE');
      this.active.revision++;
      this.active.evidenceId = body.evidenceId;
      this.active.confirmations = [];
      this.disclose();
      this.version++;
      return success(this.command(role, true));
    }
    if (path.endsWith('/testimony')) {
      if (role !== 'INTERROGATOR') return failure(403, 'CONFRONTATION_WRONG_ROLE');
      this.active.revision++;
      this.active.testimonyId = body.testimonyFragmentId;
      this.active.confirmations = [];
      this.disclose();
      this.version++;
      return success(this.command(role, true));
    }
    if (path.endsWith('/confirm')) {
      if (this.active.confirmations.some((entry) => entry.role === role)) return success(this.command(role, false));
      this.active.confirmations.push({ role, userId });
      this.version++;
      if (this.active.confirmations.length < 2) return success(this.command(role, true));

      const correct = this.active.evidenceId === 'evidence-blue-wax' && this.active.testimonyId === 'fragment-seal-intact';
      const terminal = {
        attemptId: this.active.attemptId,
        revision: this.active.revision,
        status: correct ? 'RESOLVED_SHARED_TRUTH' as const : 'ResolvedIncorrect' as const,
        evidenceId: this.active.evidenceId!,
        testimonyId: this.active.testimonyId,
        feedback: correct ? 'The overlapping wax proves the packet was resealed.' : 'That pair does not establish a direct contradiction.',
        revealTitle: correct ? 'CRACKED: THE SEAL WAS REPLACED' : undefined,
        disclosures: [...this.active.disclosures],
        resolvedAt: new Date(Date.now() + this.version).toISOString(),
      };
      this.terminals.push(terminal);
      const attemptId = this.active.attemptId;
      const revision = this.active.revision;
      this.active = null;
      return success({ state: this.project(role), changed: true, attemptId, revision, status: correct ? 'ResolvedCorrect' : 'ResolvedIncorrect', isTerminal: true });
    }
    if (path.endsWith('/cancel')) {
      this.active = null;
      this.version++;
      return success({ state: this.project(role), changed: true, status: 'Cancelled', isTerminal: true });
    }
    return failure(404, 'CONFRONTATION_NOT_AVAILABLE');
  }

  private disclose() {
    if (!this.active?.evidenceId) return;
    this.active.disclosures.push({
      revision: this.active.revision,
      evidenceId: this.active.evidenceId,
      testimonyId: this.active.testimonyId,
      disclosedAt: new Date(Date.now() + this.version).toISOString(),
    });
  }

  private command(role: Role, changed: boolean) {
    return {
      state: this.project(role),
      changed,
      attemptId: this.active?.attemptId,
      revision: this.active?.revision,
      status: this.active?.evidenceId ? 'ReadyForReview' : 'CollectingProposals',
      isTerminal: false,
    };
  }

  private evidence(id: string) {
    const value = evidenceChoices.find((entry) => entry.clueId === id)!;
    return { ...value, source: `item-${id}`, sourceType: 'item', sceneId: 'scene-archive', narrativeMeaning: value.content };
  }

  private testimony(id: string) {
    return testimonyChoices.find((entry) => entry.testimonyFragmentId === id)!;
  }

  private pair(attemptId: string, disclosure: Disclosure, status: string, feedback: string | null, resolvedAt: string | null) {
    return {
      attemptId,
      revision: disclosure.revision,
      status,
      evidence: this.evidence(disclosure.evidenceId),
      testimony: this.testimony(disclosure.testimonyId),
      feedback,
      reveals: [],
      disclosedAt: disclosure.disclosedAt,
      resolvedAt,
    };
  }
}

async function contextFor(browser: Browser, flow: SharedV3Flow, role: Role) {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  const userId = role === 'INVESTIGATOR' ? 'investigator-user' : 'interrogator-user';
  await page.addInitScript(({ roomId, userId }) => {
    window.localStorage.setItem('sirlocked.token', `${userId}-token`);
    window.localStorage.setItem('sirlocked.uiLanguage', 'en');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({ userId, fullName: userId, role: 'PLAYER', isEmailVerified: true }));
    window.sessionStorage.setItem(`sirlocked.intro.${roomId}`, '1');
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, { roomId: flow.roomId, userId });
  await page.route(`**/api/game/rooms/${flow.roomId}/**`, (route) => flow.route(role, route));
  await page.goto(`/#/game/${flow.roomId}`);
  return { context, page };
}

async function emitState(page: Page, version: number) {
  await page.evaluate(({ version }) => {
    (window as unknown as { __sirlockedEmitSignalR?: (event: string, payload: unknown) => void })
      .__sirlockedEmitSignalR?.('GameStateUpdated', { version });
  }, { version });
}

async function discover(page: Page, roomId: string, route: 'inspect-item' | 'ask-dialogue') {
  const response = await page.evaluate(async ({ roomId, route }) => {
    const result = await fetch(`/api/game/rooms/${roomId}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route === 'inspect-item' ? { itemId: 'all-three' } : { dialogueId: 'dialogue-mara' }),
    });
    return { status: result.status, text: await result.text() };
  }, { roomId, route });
  expect(response.status).toBe(200);
}

for (const run of [1, 2, 3]) {
  test(`two-browser V3 loop is deterministic without fixed sleeps (run ${run})`, async ({ browser }) => {
    const flow = new SharedV3Flow(run);
    const investigator = await contextFor(browser, flow, 'INVESTIGATOR');
    const interrogator = await contextFor(browser, flow, 'INTERROGATOR');

    await discover(investigator.page, flow.roomId, 'inspect-item');
    await discover(interrogator.page, flow.roomId, 'ask-dialogue');
    await emitState(investigator.page, flow.version);
    await emitState(interrogator.page, flow.version);

    await interrogator.page.locator('#case-file-btn').click();
    await interrogator.page.locator('[data-case-tab="testimony"]').click();
    await interrogator.page.locator('[data-v3-start-testimony="fragment-seal-intact"]').click();
    await emitState(investigator.page, flow.version);

    await investigator.page.locator('#case-file-btn').click();
    await investigator.page.locator('[data-v3-propose-evidence="evidence-ticket"]').click();
    await emitState(interrogator.page, flow.version);
    await expect(investigator.page.locator('.v3-joint-review')).toContainText('Ticket stub');
    await expect(interrogator.page.locator('.v3-joint-review')).toContainText(interrogatorSentinel);

    await investigator.page.locator('[data-v3-confirm]').click();
    await emitState(interrogator.page, flow.version);
    await interrogator.page.locator('[data-v3-confirm]').click();
    await expect(interrogator.page.locator('.v3-crack-overlay.is-incorrect')).toBeVisible();
    await interrogator.page.locator('#v3-crack-dismiss').click();
    await emitState(investigator.page, flow.version);
    await investigator.page.locator('#v3-crack-dismiss').click();

    await interrogator.page.locator('[data-case-tab="testimony"]').click();
    await interrogator.page.locator('[data-v3-start-testimony="fragment-seal-intact"]').click();
    await emitState(investigator.page, flow.version);
    await investigator.page.locator('[data-case-tab="evidence"]').click();
    await investigator.page.locator('[data-v3-propose-evidence="evidence-blue-wax"]').click();
    await investigator.page.locator('[data-v3-confirm]').click();
    await emitState(interrogator.page, flow.version);

    await interrogator.page.locator('[data-case-tab="testimony"]').click();
    const noBagSaved = interrogator.page.waitForResponse((response) =>
      response.request().method() === 'PUT' && response.url().endsWith('/testimony'));
    await interrogator.page.locator('[data-v3-edit-testimony="fragment-no-bag"]').click();
    await noBagSaved;
    await interrogator.page.locator('[data-case-tab="contradictions"]').click();
    await expect(interrogator.page.locator('.v3-joint-review')).toContainText('I carried no bag.');
    await emitState(investigator.page, flow.version);
    await expect(investigator.page.locator('.v3-confirmation-state')).toContainText('○ You');

    await interrogator.page.locator('[data-case-tab="testimony"]').click();
    const sealSaved = interrogator.page.waitForResponse((response) =>
      response.request().method() === 'PUT' && response.url().endsWith('/testimony'));
    await interrogator.page.locator('[data-v3-edit-testimony="fragment-seal-intact"]').click();
    await sealSaved;
    await investigator.page.reload();
    await expect(investigator.page.locator('#case-file-btn')).toBeVisible();
    await investigator.page.locator('#case-file-btn').click();
    await investigator.page.locator('[data-case-tab="contradictions"]').click();
    await expect(investigator.page.locator('.v3-joint-review')).toContainText('Overlapping wax');

    await interrogator.page.locator('[data-v3-confirm]').click();
    await emitState(investigator.page, flow.version);
    await investigator.page.locator('[data-v3-confirm]').click();
    await emitState(interrogator.page, flow.version);

    await expect(investigator.page.locator('.v3-crack-overlay.is-correct')).toContainText('CRACKED: THE SEAL WAS REPLACED');
    await expect(interrogator.page.locator('.v3-crack-overlay.is-correct')).toContainText('The archive was resealed');

    const wrongRoleResponse = await investigator.page.evaluate(async ({ roomId }) => {
      const response = await fetch(`/api/game/rooms/${roomId}/paired-confrontations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId: crypto.randomUUID(), testimonyFragmentId: 'fragment-secret' }),
      });
      return { status: response.status, text: await response.text() };
    }, { roomId: flow.roomId });
    expect(wrongRoleResponse.status).toBe(403);
    expect(wrongRoleResponse.text).not.toContain(investigatorSentinel);
    expect(wrongRoleResponse.text).not.toContain(interrogatorSentinel);

    await investigator.context.close();
    await interrogator.context.close();
  });
}
