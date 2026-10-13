import { expect, request, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Auth = { token: string; refreshToken: string; refreshTokenExpiry: string; user: { userId: string } };
type Box = { x: number; y: number; width: number; height: number };
const enabled = process.env.SIRLOCKED_RUN_POINT_CLICK_FULL_STACK === 'true';

test('two detectives solve the authored point-and-click case through real scene clicks and UI', async ({ browser }, testInfo) => {
  test.skip(!enabled, 'Run scripts/test-v3-full-stack.ps1 -PointClick against loopback MongoDB.');
  test.setTimeout(600_000);
  const fixture = JSON.parse(await readFile(process.env.SIRLOCKED_TEST_CASE_PATH!, 'utf8'));
  const expectedWin = process.env.SIRLOCKED_TEST_ENDING !== 'loss';
  const api = await request.newContext({ baseURL: process.env.SIRLOCKED_TEST_API_URL });
  const pages: Page[] = [];
  const failures: string[] = [];
  try {
    const investigatorAuth = await login(api, 'it_investigator@tests.invalid');
    const interrogatorAuth = await login(api, 'it_interrogator@tests.invalid');
    const room = await call<any>(api, 'POST', '/api/rooms', investigatorAuth.token, { caseId: fixture.caseId });
    await call(api, 'POST', '/api/rooms/join', interrogatorAuth.token, { roomCode: room.roomCode });
    for (const [auth, role] of [[investigatorAuth, 'INVESTIGATOR'], [interrogatorAuth, 'INTERROGATOR']] as const) {
      await call(api, 'POST', `/api/rooms/${room.roomId}/select-role`, auth.token, { role });
      await call(api, 'POST', `/api/rooms/${room.roomId}/ready`, auth.token, { isReady: true });
    }
    await call(api, 'POST', `/api/rooms/${room.roomId}/start`, investigatorAuth.token);
    const investigator = await openPlayer(browser, investigatorAuth, room.roomId, fixture.language);
    pages.push(investigator);
    const interrogator = await openPlayer(browser, interrogatorAuth, room.roomId, fixture.language);
    pages.push(interrogator);
    for (const page of pages) page.on('pageerror', error => failures.push(error.message));
    // Exercise both semantic keyboard activation and an ordinary mouse click on the introduction.
    await investigator.locator('#intro-dismiss').focus();
    await investigator.keyboard.press('Enter');
    await interrogator.locator('#intro-dismiss').click();
    await Promise.all(pages.map(page => expect(page.locator('#intro-overlay')).toHaveCount(0)));
    await Promise.all(pages.map(waitForSceneInput));
    const readState = (auth: Auth) => call<any>(api, 'GET', `/api/game/rooms/${room.roomId}/state`, auth.token);
    const scenes = fixture.stages.flatMap((stage: any) => stage.scenes);
    let approachedTarget = false;

    let wrongChallengeChecked = false;
    const progressKey = (state: any) => JSON.stringify([
      state.inspectedItemIds, state.unlockedClueIds, state.collectedItemIds,
      state.capturedClueIds, state.askedDialogueIds, state.visitedConversationNodeIds,
      state.usedInteractionIds, state.solvedPuzzleIds, state.resolvedConfrontations, state.solvedDeductions,
    ]);
    const resolveReadyChallenges = async () => {
      for (const challenge of fixture.evidenceChallenges) {
        const inv = await readState(investigatorAuth);
        const int = await readState(interrogatorAuth);
        if (inv.resolvedConfrontations.some((entry: any) => entry.challengeId === challenge.challengeId)) continue;
        const requiredEvidence = challenge.startRequiredEvidenceIds?.length ? challenge.startRequiredEvidenceIds : challenge.candidateEvidenceIds;
        const requiredTestimony = challenge.startRequiredTestimonyFragmentIds?.length ? challenge.startRequiredTestimonyFragmentIds : challenge.candidateTestimonyFragmentIds;
        if (!requiredEvidence.every((id: string) => inv.privateEvidence.some((entry: any) => entry.clueId === id))
          || !requiredTestimony.every((id: string) => int.privateTestimonies.some((entry: any) => entry.testimonyFragmentId === id))) continue;
        const pair = async (evidenceId: string, correct: boolean) => {
          await ensureDrawer(interrogator, 'testimony');
          await interrogator.locator(`[data-v3-start-testimony="${challenge.testimonyFragmentId}"]`).first().click();
          await ensureDrawer(investigator, 'evidence');
          await investigator.locator(`[data-v3-propose-evidence="${evidenceId}"]`).click();
          await expect(interrogator.locator('.v3-joint-review')).toBeVisible();
          await investigator.locator('[data-v3-confirm]').click();
          await interrogator.locator('[data-v3-confirm]').click();
          for (const page of pages) {
            await expect(page.locator(`.v3-crack-overlay.is-${correct ? 'correct' : 'incorrect'}`)).toBeVisible();
            await page.locator('#v3-crack-dismiss').click();
          }
        };
        if (!wrongChallengeChecked) {
          const incorrect = challenge.candidateEvidenceIds.find((id: string) => id !== challenge.correctEvidenceId && inv.privateEvidence.some((entry: any) => entry.clueId === id));
          if (incorrect) {
            await pair(incorrect, false);
            const after = await readState(investigatorAuth);
            for (const id of challenge.unlockClueIds) expect(after.unlockedClueIds).not.toContain(id);
            wrongChallengeChecked = true;
          }
        }
        await pair(challenge.correctEvidenceId, true);
        await expect.poll(async () => (await readState(investigatorAuth)).resolvedConfrontations.some((entry: any) => entry.challengeId === challenge.challengeId)).toBe(true);
      }
      for (const page of pages) await closePanel(page);
      for (const deduction of fixture.deductions) {
        const current = (await readState(investigatorAuth)).deductions.find((entry: any) => entry.deductionId === deduction.deductionId);
        if (!current?.isAvailable || current.isSolved) continue;
        await ensureDrawer(investigator, 'contradictions');
        await investigator.locator(`[data-solve-deduction="${deduction.deductionId}"][data-option="${deduction.correctOptionId}"]`).click();
        await expect.poll(async () => (await readState(investigatorAuth)).solvedDeductions.some((entry: any) => entry.deductionId === deduction.deductionId)).toBe(true);
      }
      for (const page of pages) await closePanel(page);
    };

    for (const [index, scene] of scenes.entries()) {
      await expect.poll(async () => (await readState(investigatorAuth)).currentSceneId).toBe(scene.sceneId);
      await expect.poll(async () => (await readState(interrogatorAuth)).currentSceneId).toBe(scene.sceneId);
      await settledSceneScreenshot(investigator, testInfo.outputPath(`scene-${index + 1}-entry.png`));
      if ([0, 3, 5].includes(index)) {
        await investigator.setViewportSize({ width: 1366, height: 768 });
        await settledSceneScreenshot(investigator, testInfo.outputPath(`scene-${index + 1}-laptop.png`));
        await investigator.setViewportSize({ width: 1440, height: 960 });
        await waitForSceneInput(investigator);
      }
      // Revisit actions unlocked by local puzzles, joint challenges, and deductions.
      // State, never elapsed time, determines when the scene has reached a fixed point.
      for (let pass = 0; pass < 12; pass++) {
        const beforeProgress = JSON.stringify([progressKey(await readState(investigatorAuth)), progressKey(await readState(interrogatorAuth))]);
        await askScene(interrogator, scene, () => readState(interrogatorAuth));
        await visitConversationBranches(interrogator, fixture, scene, () => readState(interrogatorAuth), () => readState(investigatorAuth));
        const mechanismTargets = new Set([
          ...fixture.puzzles.map((puzzle: any) => puzzle.targetId),
          ...fixture.interactions.filter((interaction: any) => interaction.type === 'USE_ITEM_ON_TARGET').map((interaction: any) => interaction.targetId),
        ]);
        for (const itemId of scene.itemIds.filter((id: string) => !mechanismTargets.has(id))) {
          const current = await readState(investigatorAuth);
          const hotspot = current.visibleScene.hotspots.find((entry: any) => entry.targetId === itemId);
          if (!hotspot || hotspot.isLocked || current.inspectedItemIds.includes(itemId)) continue;
          const before = await pose(investigator);
          await clickTarget(investigator, itemId);
          await expect.poll(async () => (await readState(investigatorAuth)).inspectedItemIds.includes(itemId), { timeout: 20_000 }).toBe(true);
          const after = await pose(investigator);
          approachedTarget ||= Math.hypot(after.x - before.x, after.y - before.y) > 1;
          await clearDiscovery(investigator);
        }
        for (const zone of scene.runtime?.clueZones ?? []) {
          const current = await readState(investigatorAuth);
          if (current.capturedClueIds.includes(zone.clueId) || !(zone.requiredClueIds ?? []).every((id: string) => current.unlockedClueIds.includes(id))) continue;
          await clearDiscovery(investigator);
          await investigator.locator('#floating-camera-btn').click();
          const point = await investigator.evaluate((bounds: Box) => {
            const game = (window as any).__sirlockedGame;
            const renderer = game.scene.getScene('SirLockedPhaserScene');
            const screen = renderer.worldPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
            const canvas = game.canvas.getBoundingClientRect();
            return { x: canvas.x + screen.x * canvas.width / game.scale.width, y: canvas.y + screen.y * canvas.height / game.scale.height };
          }, zone.bounds);
          await investigator.mouse.move(point.x, point.y);
          await investigator.mouse.click(point.x, point.y);
          await expect.poll(async () => (await readState(investigatorAuth)).capturedClueIds.includes(zone.clueId), { timeout: 20_000 }).toBe(true);
          await clearDiscovery(investigator);
          if (await investigator.locator('#floating-camera-btn').getAttribute('aria-pressed') === 'true') {
            await investigator.locator('#floating-camera-btn').click();
          }
          await waitForSceneInput(investigator);
        }
        for (const recipe of fixture.interactions.filter((interaction: any) => interaction.type === 'COMBINE_ITEMS')) {
          const current = await readState(investigatorAuth);
          if (current.usedInteractionIds.includes(recipe.interactionId)
            || !recipe.requiredItemIds.every((id: string) => current.collectedItemIds.includes(id))
            || !(recipe.requiredClueIds ?? []).every((id: string) => current.unlockedClueIds.includes(id))) continue;
          await investigator.locator('#floating-bag-btn').click();
          await investigator.locator('#combine-mode-btn').click();
          for (const id of recipe.requiredItemIds) await investigator.locator(`[data-inventory="${id}"]`).click();
          await investigator.locator('#combine-submit-btn').click();
          await expect.poll(async () => {
            const collected = (await readState(investigatorAuth)).collectedItemIds;
            return recipe.unlockItemIds.every((id: string) => collected.includes(id));
          }).toBe(true);
          await closePanel(investigator);
          // Combining consumes inputs; their scene sprites must not respawn.
          for (const id of recipe.requiredItemIds.filter((id: string) => scene.itemIds.includes(id))) {
            if ((await readState(investigatorAuth)).collectedItemIds.includes(id)) continue;
            await expect.poll(() => investigator.evaluate(id => {
              const renderer = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
              return renderer.children.list.some((child: any) => child.texture?.key?.startsWith(`item:${id}:`));
            }, id)).toBe(false);
          }
        }
        for (const interaction of fixture.interactions.filter((entry: any) => entry.type === 'USE_ITEM_ON_TARGET' && scene.itemIds.includes(entry.targetId))) {
          const current = await readState(investigatorAuth);
          if (current.usedInteractionIds.includes(interaction.interactionId)
            || !interaction.requiredItemIds.every((id: string) => current.collectedItemIds.includes(id))
            || !(interaction.requiredClueIds ?? []).every((id: string) => current.unlockedClueIds.includes(id))) continue;
          await clearDiscovery(investigator);
          await investigator.locator('#floating-bag-btn').click();
          const itemId = interaction.requiredItemIds[0];
          await investigator.locator(`[data-inventory="${itemId}"]`).click();
          await investigator.locator(`[data-use-inventory="${itemId}"]`).click();
          await waitForSceneInput(investigator);
          await clickTarget(investigator, interaction.targetId);
          await expect.poll(async () => {
            const unlocked = (await readState(investigatorAuth)).unlockedClueIds;
            return interaction.unlockClueIds.every((id: string) => unlocked.includes(id));
          }, { timeout: 20_000 }).toBe(true);
        }
        for (const puzzle of fixture.puzzles.filter((entry: any) => scene.itemIds.includes(entry.targetId))) {
          const state = await readState(investigatorAuth);
          const visible = state.visibleScene.puzzles.find((entry: any) => entry.puzzleId === puzzle.puzzleId);
          if (!visible || visible.isLocked || visible.isSolved) continue;
          await clearDiscovery(investigator);
          await clickTarget(investigator, puzzle.targetId);
          await expect(investigator.locator('#puzzle-submit-btn')).toBeVisible({ timeout: 20_000 });
          const code = puzzle.type === 'CODE_PUZZLE';
          if (code) {
            await investigator.locator('#puzzle-code-answer').fill(puzzle.correctCode === '0000' ? '9999' : '0000');
          } else {
            const wrong = puzzle.correctSequence.map((answer: string) => puzzle.options.find((option: string) => option !== answer));
            for (const option of wrong) await investigator.locator(`[data-puzzle-option="${option}"]`).click();
          }
          const rejectedAnswer = investigator.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/solve-puzzle'));
          await investigator.locator('#puzzle-submit-btn').click();
          await rejectedAnswer;
          expect((await readState(investigatorAuth)).solvedPuzzleIds).not.toContain(puzzle.puzzleId);
          if (code) await investigator.locator('#puzzle-code-answer').fill(puzzle.correctCode);
          else {
            await investigator.locator('#puzzle-clear-btn').click();
            for (const option of puzzle.correctSequence) await investigator.locator(`[data-puzzle-option="${option}"]`).click();
          }
          await investigator.locator('#puzzle-submit-btn').click();
          await expect.poll(async () => (await readState(investigatorAuth)).solvedPuzzleIds.includes(puzzle.puzzleId)).toBe(true);
          await expect(investigator.locator('#puzzle-submit-btn')).toHaveCount(0);
          await clearDiscovery(investigator);
          await waitForSceneInput(investigator);
        }
        await askScene(interrogator, scene, () => readState(interrogatorAuth));
        await resolveReadyChallenges();
        const after = await readState(investigatorAuth);
        if (beforeProgress === JSON.stringify([progressKey(after), progressKey(await readState(interrogatorAuth))])) {
          expect(after.currentSceneCanComplete, `Scene blocked: ${scene.sceneId}; requirements: ${JSON.stringify(scene.completeCondition)}`).toBe(true);
          break;
        }
        expect(pass, `Scene did not settle: ${scene.sceneId}`).toBeLessThan(11);
      }
      for (const page of pages) { await clearDiscovery(page); await closePanel(page); }
      await settledSceneScreenshot(investigator, testInfo.outputPath(`scene-${index + 1}-investigator.png`));
      await interrogator.screenshot({ path: testInfo.outputPath(`scene-${index + 1}-interrogator.png`), fullPage: true });
      if (index + 1 < scenes.length) {
        for (const [page, auth] of [[investigator, investigatorAuth], [interrogator, interrogatorAuth]] as const) {
          await clearDiscovery(page);
          await expect.poll(async () => (await readState(auth)).currentSceneCanComplete).toBe(true);
          if (fixture.language === 'vi') {
            await expect(page.locator('#game-hud-slot')).not.toContainText('You have found everything');
            await expect(page.locator('#toast-root')).not.toContainText('is fully investigated');
          }
          await clickContinue(page);
          await expect.poll(async () => (await readState(auth)).currentSceneId, { timeout: 20_000 }).toBe(scenes[index + 1].sceneId);
          await waitForSceneInput(page);
        }
      }
    }

    expect(approachedTarget, 'Distant scene interactions must walk toward the target before discovery.').toBe(true);
    const privateEvidence = await readState(investigatorAuth);
    const privateTestimony = await readState(interrogatorAuth);
    expect(privateEvidence.privateTestimonies).toEqual([]);
    expect(privateTestimony.privateEvidence).toEqual([]);
    expect(privateEvidence.privateEvidence.length).toBeGreaterThanOrEqual(3);
    expect(privateTestimony.privateTestimonies.length).toBeGreaterThanOrEqual(2);
    expect(privateEvidence.resolvedConfrontations).toHaveLength(fixture.evidenceChallenges.length);
    expect(privateEvidence.solvedDeductions).toHaveLength(fixture.deductions.length);
    expect(privateEvidence.solvedPuzzleIds).toHaveLength(fixture.puzzles.length);
    expect(privateEvidence.visitedConversationNodeIds).toEqual([]);
    for (const node of fixture.conversationNodes) expect(privateTestimony.visitedConversationNodeIds).toContain(node.nodeId);
    expect(wrongChallengeChecked).toBe(true);
    await closePanel(investigator);
    await investigator.locator('#accuse-btn').click();
    const suspectId = expectedWin ? fixture.finalLogic.culpritId : fixture.characters.find((entry: any) => entry.characterId !== fixture.finalLogic.culpritId).characterId;
    await investigator.locator(`[data-suspect="${suspectId}"]`).click();
    await investigator.locator('#accuse-next').click();
    await investigator.locator(`[data-motive="${fixture.finalLogic.correctMotiveId}"]`).click();
    await investigator.locator('#accuse-next').click();
    await investigator.locator(`[data-method="${fixture.finalLogic.correctMethodId}"]`).click();
    await investigator.locator('#accuse-next').click();
    for (const link of fixture.finalLogic.requiredEvidenceLinks) {
      await investigator.locator(`[data-claim-slot="${link.claimType}"]`).click();
      await investigator.locator(`[data-assign-evidence="${link.evidenceId}"]`).click();
    }
    await investigator.locator('#accuse-next').click();
    await investigator.locator('#accuse-confirm').click();
    await expect(investigator.locator('#accusation-confirm')).toBeDisabled();
    await expect(interrogator.locator('#accusation-confirm')).toBeEnabled();
    await interrogator.locator('#accusation-confirm').click();
    for (const page of pages) {
      await expect(page).toHaveURL(/#\/result\//);
      await expect(page.locator('.result-banner')).toBeVisible();
    }
    const result = await call<any>(api, 'GET', `/api/game/rooms/${room.roomId}/result`, investigatorAuth.token);
    expect(result.success).toBe(expectedWin);
    if (fixture.language === 'vi') await expect(investigator.locator('.verdict-breakdown')).toContainText('Động cơ chứng cứ');
    expect(failures).toEqual([]);
    await investigator.screenshot({ path: testInfo.outputPath(expectedWin ? 'case-closed.png' : 'case-rejected.png'), fullPage: true });
    await testInfo.attach('point-click-flow', { contentType: 'application/json', body: JSON.stringify({
      caseId: fixture.caseId, scenes: scenes.length, discovery: 'Actual canvas mouse clicks with approach movement',
      combine: 'Inventory UI', useItem: 'Inventory plus canvas target', puzzle: 'Code, symbol, and sequence UI as authored',
      dialogue: 'NPC canvas plus question and branching conversation UI',
      cameraZones: scenes.reduce((count: number, entry: any) => count + (entry.runtime?.clueZones?.length ?? 0), 0),
      wrongPuzzleAnswersRejected: fixture.puzzles.length, wrongEvidencePairRejected: wrongChallengeChecked, stages: fixture.stages.length,
      twoPlayerConsensus: true, expectedEnding: expectedWin ? 'win' : 'loss', win: result.success,
      layout: 'Original authored layout', providerCalls: 0,
      note: 'Automated execution uses authored answers; independent human enjoyment and deduction are not measured.',
    }, null, 2) });
  } finally {
    await Promise.allSettled(pages.map(page => page.context().close()));
    await api.dispose();
  }
});

async function visitConversationBranches(page: Page, fixture: any, scene: any, readState: () => Promise<any>, readEvidence: () => Promise<any>) {
  for (const root of fixture.conversationNodes.filter((node: any) => node.isRoot && node.availableSceneIds.includes(scene.sceneId))) {
    for (const choice of root.choices) {
      const child = fixture.conversationNodes.find((node: any) => node.nodeId === choice.nextNodeId);
      const current = await readState();
      // Branch gates use team discoveries; role projections deliberately hide the
      // other detective's private clue IDs. Only the test oracle combines them.
      const teamClues = new Set([...current.unlockedClueIds, ...(await readEvidence()).unlockedClueIds]);
      if (!child || current.visitedConversationNodeIds.includes(child.nodeId)
        || ![...root.requiredClueIds, ...choice.requiredClueIds, ...child.requiredClueIds].every((id: string) => teamClues.has(id))) continue;
      await clickTarget(page, root.characterId);
      await expect(page.locator(`[data-converse-choice="${choice.choiceId}"]`)).toBeVisible({ timeout: 20_000 });
      await page.locator(`[data-converse-choice="${choice.choiceId}"]`).click();
      await expect.poll(async () => (await readState()).visitedConversationNodeIds.includes(child.nodeId)).toBe(true);
      const back = child.choices.find((entry: any) => !entry.nextNodeId || entry.nextNodeId === root.nodeId);
      if (back) await page.locator(`[data-converse-choice="${back.choiceId}"]`).click();
      await page.locator('[data-vn-close]').click();
      await waitForSceneInput(page);
    }
  }
}

async function askScene(page: Page, scene: any, readState: () => Promise<any>) {
  for (const characterId of scene.characterIds) {
    const available = (await readState()).visibleScene.availableDialogues.filter((entry: any) => entry.characterId === characterId && !entry.isAsked && !entry.isLocked);
    if (!available.length) continue;
    await clickTarget(page, characterId);
    await expect(page.locator('.vn-conversation')).toBeVisible({ timeout: 20_000 });
    for (const dialogue of available) {
      await page.locator(`[data-dialogue="${dialogue.dialogueId}"]`).click();
      await expect.poll(async () => (await readState()).visibleScene.availableDialogues.find((entry: any) => entry.dialogueId === dialogue.dialogueId)?.isAsked).toBe(true);
    }
    await page.locator('[data-vn-close]').click();
    await waitForSceneInput(page);
  }
}

async function login(api: APIRequestContext, email: string) {
  return call<Auth>(api, 'POST', '/api/auth/login', undefined, { email, password: process.env.SIRLOCKED_TEST_PASSWORD });
}

async function call<T>(api: APIRequestContext, method: string, path: string, token?: string, data?: unknown): Promise<T> {
  const response = await api.fetch(path, { method, headers: token ? { Authorization: `Bearer ${token}` } : undefined, data });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBe(true);
  return JSON.parse(body).data;
}

async function openPlayer(browser: Browser, auth: Auth, roomId: string, language: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(({ auth, language }) => {
    localStorage.setItem('sirlocked.token', auth.token);
    localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
    localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    localStorage.setItem('sirlocked.uiLanguage', language.toLowerCase());
  }, { auth, language });
  await page.goto(`/#/game/${roomId}`);
  await expect(page.locator('#intro-dismiss')).toBeVisible();
  return page;
}

async function pose(page: Page) {
  return page.evaluate(() => ({ ...(window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').localPose }));
}

async function settledSceneScreenshot(page: Page, path: string) {
  await waitForSceneInput(page);
  await page.mouse.move(20, 20);
  await expect(page.locator('#toast-root .toast')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').load.isLoading())).toBe(false);
  await page.screenshot({ path, fullPage: true });
}

async function waitForSceneInput(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__sirlockedGame?.scene.getScene('SirLockedPhaserScene')?.sceneInteractionEnabled))).toBe(true);
}

async function clickTarget(page: Page, targetId: string) {
  await waitForSceneInput(page);
  const point = await page.evaluate(targetId => {
    const game = (window as any).__sirlockedGame;
    const scene = game.scene.getScene('SirLockedPhaserScene');
    const runtime = scene.state.visibleScene.runtime;
    const placement = [...runtime.itemPlacements, ...runtime.characterPlacements].find(entry => entry.itemId === targetId || entry.characterId === targetId);
    if (!placement) throw new Error(`Missing authored placement: ${targetId}`);
    const box = placement.hotspot as Box;
    const screen = scene.worldPoint({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.x + screen.x * rect.width / game.scale.width, y: rect.y + screen.y * rect.height / game.scale.height };
  }, targetId);
  await page.mouse.click(point.x, point.y);
}

async function clickContinue(page: Page) {
  await waitForSceneInput(page);
  const point = await page.evaluate(() => {
    const game = (window as any).__sirlockedGame;
    const scene = game.scene.getScene('SirLockedPhaserScene');
    const rect = game.canvas.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + (game.scale.height - 112) * rect.height / game.scale.height };
  });
  await page.mouse.click(point.x, point.y);
}

async function clearDiscovery(page: Page) {
  const dismiss = page.locator('#discovery-dismiss-btn');
  if (await dismiss.isVisible()) await dismiss.click();
}

async function closePanel(page: Page) {
  const close = page.locator('.close-drawer-btn');
  if (await close.isVisible()) await close.click();
  else if (await page.locator('[data-close-overlay]').isVisible()) await page.locator('[data-close-overlay]').click();
  await waitForSceneInput(page);
}

async function ensureDrawer(page: Page, tab: string) {
  if (await page.locator('#v3-complete-review').isVisible()) await page.locator('#v3-complete-review').click();
  if (!(await page.locator('.case-file-drawer').isVisible())) await page.locator('#case-file-btn').click();
  await page.locator(`[data-case-tab="${tab}"]`).click();
}
