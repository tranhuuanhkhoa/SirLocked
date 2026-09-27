import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sirlocked.token', 'admin-smoke-token');
    if (!window.localStorage.getItem('sirlocked.uiLanguage')) {
      window.localStorage.setItem('sirlocked.uiLanguage', 'en');
    }
    window.localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'admin-1',
      fullName: 'Admin Smoke',
      role: 'ADMIN',
      isEmailVerified: true,
    }));
  });

  await page.route('**/api/admin/ai-cases/capabilities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          aiCaseV3PresetEnabled: false,
          gameplayV3Enabled: false,
          canCreateV3Draft: false,
          canPublishV3: false,
        },
      }),
    });
  });

  // Keep the dashboard test isolated from whichever local API happens to be
  // running behind Vite. A real 401 here clears the mocked session before the
  // dashboard finishes rendering; telemetry is optional in this suite.
  await page.route('**/api/admin/playtest/summary', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Telemetry disabled in UI smoke tests.' }),
    });
  });

  await page.route('**/api/admin/ai-cases', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          draftId: 'draft-vi',
          provider: 'OpenAI',
          status: 'STORY_AWAITING_APPROVAL',
          settings: { generationPreset: 'NORMAL_RANDOM', language: 'vi' },
          storyPreview: {
            title: 'Tiếng Chuông Dưới Blackglass',
            summary: 'Một bí ẩn bằng tiếng Việt.',
            setting: 'Veymar',
            openingIncident: 'Alaric Vale biến mất.',
            tone: 'Trinh thám khí gas',
            playerPromise: 'Điều tra và suy luận.',
          },
        },
      }),
    });
  });
});

test('language switch translates the admin dashboard content, not only navigation', async ({ page }) => {
  await page.route('**/api/admin/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          totalUsers: 90,
          publishedCases: 9,
          totalCases: 15,
          activeRooms: 67,
          totalRooms: 119,
          wins: 22,
          losses: 23,
          totalAiDrafts: 37,
        },
      }),
    });
  });
  await page.route('**/api/admin/users', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
  await expect(page.locator('.stat-grid')).toContainText('9/15 published');

  await page.locator('[data-ui-language="vi"]').click();
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển quản trị' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tạo và xuất bản vụ án mẫu' })).toBeVisible();
  await expect(page.locator('.stat-grid')).toContainText('9/15 đã xuất bản');
  await expect(page.locator('.admin-table thead')).toContainText('Vai trò');
});

test('Vietnamese admin AI creator localizes presets and causal workflow guidance', async ({ page }) => {
  await page.goto('/#/admin/ai');
  await page.locator('[data-ui-language="vi"]').click();

  await expect(page.getByRole('heading', { name: 'Tạo vụ án bằng AI' })).toBeVisible();
  await expect(page.locator('#ai-preset-select')).toContainText('Ngẫu nhiên cân bằng');
  await expect(page.locator('#ai-preset-select')).toContainText('Bản thử ngắn');
  await expect(page.locator('#ai-preset-help')).toContainText('Cấu hình cân bằng');
  await expect(page.locator('#ai-case-type-select')).toContainText('Loại vụ án ngẫu nhiên');
  await expect(page.locator('#ai-case-type-select')).toContainText('Mất tích');
  await expect(page.getByText('nguồn sự thật nhân quả bất biến')).toBeVisible();

  await page.locator('#ai-preset-select').selectOption('SHORT_DEMO');
  await expect(page.locator('#ai-preset-help')).toContainText('Vụ án gọn');
});

test('queued premise appears as soon as polling reaches story approval without reloading', async ({ page }) => {
  await page.unroute('**/api/admin/ai-cases');
  const queuedDraft = {
    draftId: 'draft-poll',
    provider: 'OpenAI',
    status: 'GENERATING_STORY',
    queueState: 'RUNNING',
    settings: { generationPreset: 'NORMAL_RANDOM', language: 'en' },
  };
  const completedDraft = {
    ...queuedDraft,
    status: 'STORY_AWAITING_APPROVAL',
    queueState: 'NONE',
    storyPreview: {
      title: 'The Premise Appears Without Reload',
      summary: 'Polling returned a completed premise.',
      setting: 'Riverside theatre',
      openingIncident: 'A sealed prop case disappears.',
      tone: 'Fair-play mystery',
      playerPromise: 'Follow physical evidence.',
    },
  };
  const ok = (data: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  });

  await page.route('**/api/admin/ai-cases', async (route) => {
    if (route.request().method() === 'POST') await route.fulfill(ok(queuedDraft, 202));
    else await route.fulfill(ok([]));
  });
  await page.route('**/api/admin/ai-cases/draft-poll', async (route) => {
    await route.fulfill(ok(completedDraft));
  });

  await page.goto('/#/admin/ai');
  await page.locator('#quick-create-btn').click();

  await expect(page.getByRole('heading', { name: 'The Premise Appears Without Reload' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve story preview' })).toBeVisible();
});

test('failed drafts expose phase-specific retry actions and endpoints', async ({ page }) => {
  await page.unroute('**/api/admin/ai-cases');
  const drafts = [
    {
      draftId: 'draft-json', provider: 'OpenAI', status: 'GENERATED_INVALID',
      failurePhase: 'PRE_ASSET_VALIDATION', caseTitle: 'Unsafe JSON checkpoint', hasGeneratedJson: true,
      settings: { generationPreset: 'SHORT_DEMO', language: 'en' },
      validationErrors: ['VisualSafety scene-main: duty board requests readable marks.'],
    },
    {
      draftId: 'draft-vision', provider: 'OpenAI', status: 'GENERATED_INVALID',
      failurePhase: 'VISUAL_QA', failedAssetIds: ['scene-main-platform'],
      caseTitle: 'Failed background QA', hasGeneratedJson: true,
      settings: { generationPreset: 'SHORT_DEMO', language: 'en' },
      validationErrors: ['prohibitedTextFound=True'],
    },
  ];

  await page.route('**/api/admin/ai-cases', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: drafts }) });
  });
  await page.route('**/api/admin/ai-cases/*/retry-json', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: drafts[0] }) });
  });
  await page.route('**/api/admin/ai-cases/*/regenerate-failed-assets', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: drafts[1] }) });
  });

  await page.goto('/#/admin/ai');
  await expect(page.getByRole('button', { name: 'Retry JSON repair' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Regenerate failed scene' })).toBeVisible();

  const retryJsonRequest = page.waitForRequest((request) =>
    request.url().endsWith('/api/admin/ai-cases/draft-json/retry-json') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Retry JSON repair' }).click();
  await retryJsonRequest;

  const regenerateRequest = page.waitForRequest((request) =>
    request.url().endsWith('/api/admin/ai-cases/draft-vision/regenerate-failed-assets') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Regenerate failed scene' }).click();
  await regenerateRequest;
});

test('causal truth review renders structured gates and forwards scoped repair instructions', async ({ page }) => {
  await page.unroute('**/api/admin/ai-cases');
  const caseTruth = {
    schemaVersion: 'case-truth-v1',
    caseSeed: { crimeType: 'Murder', era: '1930s', difficulty: 'hard', estimatedMinutes: 45, suspectIds: ['suspect-a', 'suspect-b'], locationIds: ['study'], locationGraph: [], technologyConstraints: ['No digital records'] },
    coreTruth: { culpritId: 'suspect-a', targetId: 'victim', motive: 'Hide the forged will', method: 'Poisoned tea', preparationActionIds: ['event-1'], crimeActionIds: ['event-2'], concealmentActionIds: ['event-3'], culpritMistakeActionIds: ['event-2'] },
    trueTimeline: [{ eventId: 'event-2', actorId: 'suspect-a', locationId: 'study', startMinute: 20, endMinute: 24, travelFromPreviousMinutes: 3, action: 'Added poison to the tea', witnessIds: ['witness-1'], traceIds: ['trace-a', 'trace-b'] }],
    opportunityMatrix: [
      { characterId: 'suspect-a', hasMotive: true, accessIds: ['study-key'], toolIds: ['poison'], knowledgeIds: ['tea-routine'], availableFromMinute: 18, availableToMinute: 28, alibiEventIds: [], alibiVerified: false, identityLinkedToCrime: true, eliminationReason: '' },
      { characterId: 'suspect-b', hasMotive: false, accessIds: [], toolIds: [], knowledgeIds: [], availableFromMinute: 10, availableToMinute: 30, alibiEventIds: ['event-alibi'], alibiVerified: true, identityLinkedToCrime: false, eliminationReason: 'Verified at the station.' },
    ],
    traceLedger: [
      { traceId: 'trace-a', sourceActionId: 'event-2', createdByCharacterId: 'suspect-a', createdAtMinute: 22, locationId: 'study', physicalCause: 'Poison residue entered the cup.', persistenceReason: 'Residue survived rinsing.', proves: 'The cup was poisoned in the study.', doesNotProve: 'Motive by itself.', independentSourceGroup: 'chemical', supportsConclusionIds: ['motive', 'method', 'opportunity', 'identity', 'timeline'] },
      { traceId: 'trace-b', sourceActionId: 'event-2', createdByCharacterId: 'suspect-a', createdAtMinute: 23, locationId: 'study', physicalCause: 'A unique fiber caught on the tea cart.', persistenceReason: 'The cart was not moved.', proves: 'Suspect A handled the cart during the window.', doesNotProve: 'The poison type alone.', independentSourceGroup: 'fiber', supportsConclusionIds: ['motive', 'method', 'opportunity', 'identity', 'timeline'] },
    ],
    statementLedger: [{ statementId: 'statement-a', speakerId: 'suspect-a', truthStatus: 'FALSE', content: 'I never entered the study.', eventIds: ['event-2'], knowledgeSourceIds: ['tea-routine'], reasonForLie: 'Hide access to the cup.', contradictedByTraceIds: ['trace-b'], independentSourceGroup: 'testimony', supportsConclusionIds: ['identity'] }],
    proofGraph: { conclusions: ['MOTIVE', 'METHOD', 'OPPORTUNITY', 'IDENTITY', 'TIMELINE'].map((category) => ({ conclusionId: category.toLowerCase(), category, proposition: `${category} is causally established.`, supportingTraceIds: ['trace-a', 'trace-b'], supportingStatementIds: [], excludesSuspectIds: ['suspect-b'] })) },
    redHerringLedger: [{ redHerringId: 'red-1', suspectId: 'suspect-b', suspiciousReason: 'Owned a similar vial.', innocentExplanation: 'The vial contained medicine.', clearingTraceIds: ['trace-a'], clearingStatementIds: [] }],
  };
  const baseDraft = {
    draftId: 'draft-truth', provider: 'OpenAI', status: 'CASE_TRUTH_INVALID', logicContractVersion: 2,
    caseTitle: 'The Poisoned Study', settings: { generationPreset: 'SHORT_DEMO', language: 'en' }, canContinue: true,
    truthSummary: { schemaVersion: 'case-truth-v1', truthHash: 'a'.repeat(64), timelineEventCount: 1, traceCount: 2, statementCount: 1, proofConclusionCount: 5, reviewerStatus: 'FAILED', reviewerConfidence: .96, validationErrorCount: 1 },
    caseTruth,
    truthReviewerResult: {
      schemaVersion: 'case-truth-feasibility-review-v2',
      status: 'FAILED',
      confidence: .96,
      timelineFeasible: true,
      physicalCausalityFeasible: false,
      uniqueSolution: true,
      issues: [],
      findings: [{
        findingId: 'finding-clock-reset',
        code: 'PHYSICAL_CAUSALITY',
        relatedIds: ['event-2', 'trace-a'],
        message: 'The reset removes the mechanism required for the later delay.',
      }],
    },
    truthRepairPlan: {
      recommendedStartArtifact: 'TIMELINE',
      selectedStartArtifact: '',
      reasonCodes: ['PHYSICAL_CAUSALITY'],
      invalidArtifacts: ['TIMELINE'],
      staleArtifacts: ['OPPORTUNITY', 'EVIDENCE', 'STATEMENTS', 'PROOF_GRAPH'],
    },
    artifactProvenance: [
      { artifact: 'CORE_TRUTH', inputHash: '1'.repeat(64), outputHash: '2'.repeat(64), isStale: false, generatedAt: '2026-07-22T10:00:00Z' },
      { artifact: 'GAMEPLAY_PROJECTION', inputHash: '2'.repeat(64), outputHash: '3'.repeat(64), isStale: false, generatedAt: '2026-07-22T10:01:00Z' },
    ],
  };
  let currentDraft = baseDraft;
  const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

  await page.route('**/api/admin/ai-cases', async (route) => route.fulfill(ok([currentDraft])));
  await page.route('**/api/admin/ai-cases/draft-truth', async (route) => route.fulfill(ok(currentDraft)));
  await page.route('**/api/admin/ai-cases/draft-truth/repair-truth', async (route) => {
    currentDraft = { ...currentDraft, truthRepairStatus: 'CANDIDATE_READY', truthRepairCandidate: caseTruth, truthRepairValidationReport: [] };
    await route.fulfill(ok(currentDraft));
  });
  await page.route('**/api/admin/ai-cases/draft-truth/accept-truth-repair', async (route) => {
    currentDraft = {
      ...currentDraft,
      status: 'CASE_TRUTH_AWAITING_APPROVAL',
      canContinue: true,
      truthSummary: { ...currentDraft.truthSummary, validationErrorCount: 0 },
      truthRepairStatus: 'ACCEPTED',
      truthRepairCandidate: null,
      truthReviewerResult: {
        schemaVersion: 'case-truth-feasibility-review-v2',
        status: 'FAILED',
        confidence: .94,
        timelineFeasible: true,
        physicalCausalityFeasible: false,
        uniqueSolution: true,
        issues: [],
        findings: [{
          findingId: 'advisory-causality',
          code: 'PHYSICAL_CAUSALITY',
          relatedIds: ['event-2'],
          message: 'Advisory concern that does not override deterministic validation.',
        }],
      },
    };
    await route.fulfill(ok(currentDraft));
  });
  await page.route('**/api/admin/ai-cases/draft-truth/approve-truth', async (route) => {
    currentDraft = {
      ...currentDraft,
      status: 'FULL_LOGIC_AWAITING_APPROVAL',
      blindSolvabilityReview: { status: 'FAILED', culpritId: 'suspect-a', motive: 'Hide the forged will', method: 'Poisoned tea', timelineSummary: 'The tea was poisoned between minute 20 and 24.', evidenceChainIds: ['clue-1', 'clue-2', 'clue-3', 'clue-4', 'clue-5'], uniqueSolution: false, confidence: .64, issues: [], findings: [{ findingId: 'advisory-blind', code: 'SOLUTION_AMBIGUITY', relatedIds: ['clue-5'], message: 'Advisory ambiguity.' }] },
    };
    await route.fulfill(ok(currentDraft));
  });

  await page.goto('/#/admin/ai');
  await page.getByRole('button', { name: 'View' }).click();
  await expect(page.locator('[data-truth-review]')).toContainText('suspect-a');
  await expect(page.locator('[data-proof-coverage] .proof-coverage-card')).toHaveCount(5);
  await expect(page.locator('[data-truth-review]')).toContainText('Poison residue entered the cup');
  await expect(page.locator('[data-artifact-provenance]')).toContainText('CORE_TRUTH');
  await expect(page.locator('[data-truth-review]')).toContainText('Reviewer confidence: 96%');
  await expect(page.locator('[data-truth-review]')).toContainText('PHYSICAL_CAUSALITY');
  await expect(page.locator('[data-truth-review]')).toHaveClass(/notice-bad/);
  await expect(page.locator('[data-review-finding-group="TIMELINE"]')).toContainText('event-2');
  await expect(page.locator('[data-truth-repair-plan]')).toContainText('Recommended repair start: TIMELINE');
  await expect(page.locator('[data-truth-repair-scope]')).toHaveValue('TIMELINE');

  await page.locator('[data-truth-repair-instructions]').fill('Repair the witness timing only.');
  const repairRequest = page.waitForRequest((request) => request.url().endsWith('/repair-truth'));
  await page.getByRole('button', { name: 'Create scoped repair' }).click();
  expect((await repairRequest).postDataJSON()).toEqual({
    repairInstructions: 'Repair the witness timing only.',
    repairFromArtifact: 'TIMELINE',
  });
  await expect(page.getByRole('button', { name: 'Accept truth repair' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept truth repair' }).click();
  await expect(page.locator('[data-truth-review]')).toContainText('Advisory AI review');
  await expect(page.locator('#ai-output').getByRole('button', { name: 'Approve case truth' })).toBeVisible();

  const approveRequest = page.waitForRequest((request) => request.url().endsWith('/approve-truth'));
  await page.locator('#ai-output').getByRole('button', { name: 'Approve case truth' }).click();
  await approveRequest;
  await expect(page.locator('[data-blind-review]')).toContainText('Advisory blind solvability review');
  await expect(page.locator('[data-blind-review]')).toContainText('64%');
  await expect(page.locator('[data-blind-review]')).toContainText('clue-5');
});

test('V3 capability adds Crack to the selected V2 preset without exposing a second preset', async ({ page }) => {
  await page.unroute('**/api/admin/ai-cases/capabilities');
  await page.route('**/api/admin/ai-cases/capabilities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          aiCaseV3PresetEnabled: true,
          gameplayV3Enabled: false,
          canCreateV3Draft: true,
          canPublishV3: false,
        },
      }),
    });
  });

  await page.goto('/#/admin/ai');
  await expect(page.locator('#ai-preset-select')).not.toContainText('Crack the Lie V3');
  await expect(page.locator('#ai-include-crack')).toBeVisible();
  await expect(page.getByText('V3 gameplay is disabled.')).toBeVisible();
  await page.locator('#ai-preset-select').selectOption('FULL_FEATURE');
  await page.locator('#ai-case-type-select').selectOption('FRAUD');
  await page.locator('#ai-include-crack').check();
  await expect(page.locator('#ai-preset-help')).toContainText('added on top of this preset');
  await expect(page.locator('#ai-crack-badge')).toContainText('V3 · Crack');
  await expect(page.locator('#ai-crack-budget')).toContainText('2–3 Cracks');
  await expect(page.locator('#ai-crack-budget')).toContainText('target 3T × 5E');
  await expect(page.locator('#ai-crack-budget')).toContainText('60/case');
  await page.locator('#ai-creator-direction').fill('A rain-soaked station mystery with an object-state contradiction.');

  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith('/api/admin/ai-cases') && request.method() === 'POST');
  await page.locator('#quick-create-btn').click();
  const request = await requestPromise;

  expect(request.postDataJSON()).toMatchObject({
    generationPreset: 'FULL_FEATURE',
    stageCount: 6,
    difficulty: 'hard',
    includeCrackTheLie: true,
    caseType: 'FRAUD',
    prompt: 'A rain-soaked station mystery with an object-state contradiction.',
  });
});

test('V3 full-logic review shows one camera and two item evidence choices without logic-changing repair', async ({ page }) => {
  await page.unroute('**/api/admin/ai-cases/capabilities');
  await page.unroute('**/api/admin/ai-cases');

  const evidenceIds = ['evidence-wax', 'evidence-ticket', 'evidence-thread'];
  const fragmentIds = ['fragment-seal', 'fragment-bag', 'fragment-guard'];
  const generatedJson = JSON.stringify({
    evidenceChallenges: [{
      challengeId: 'challenge-seal',
      dialogueId: 'dialogue-clerk',
      testimonyFragmentId: 'fragment-seal',
      candidateTestimonyFragmentIds: fragmentIds,
      correctEvidenceId: 'evidence-wax',
      candidateEvidenceIds: evidenceIds,
      successResponse: 'The second wax layer disproves the intact-seal claim.',
      failureResponse: 'That pair does not establish a direct contradiction.',
      revealTitle: 'THE SEAL WAS REPLACED',
      unlockClueIds: ['reveal-resealed'],
    }],
    clues: [
      { clueId: 'evidence-wax', source: 'scene-archive', sourceType: 'camera', discoverMethod: 'camera', acquisitionMethod: 'CAMERA_CAPTURE', title: 'Overlapping wax', content: 'Two layers overlap.', visualDescription: 'A narrow blue wax overlap on the fixed packet clasp.' },
      { clueId: 'evidence-ticket', source: 'item-ticket', sourceType: 'item', discoverMethod: 'item', acquisitionMethod: 'ITEM_INSPECT', title: 'Ticket stub', content: 'A timeline trace.' },
      { clueId: 'evidence-thread', source: 'item-thread', sourceType: 'item', discoverMethod: 'item', acquisitionMethod: 'ITEM_INSPECT', title: 'Muddy thread', content: 'A corridor fiber.' },
      { clueId: 'reveal-resealed', title: 'Resealed packet', content: 'The packet was opened and resealed.' },
    ],
    items: [
      { itemId: 'item-ticket', name: 'Ticket stub', inspectText: 'The ticket was punched before closing.' },
      { itemId: 'item-thread', name: 'Muddy thread', inspectText: 'The thread came from a public corridor.' },
    ],
    testimonyFragments: fragmentIds.map((id, index) => ({ id, dialogueId: 'dialogue-clerk', text: `Witness claim ${index + 1}` })),
    dialogues: [{ dialogueId: 'dialogue-clerk', answer: 'One answer containing all three witness claims.' }],
  });
  const pairEvaluations = evidenceIds.flatMap((evidenceId) => fragmentIds.map((testimonyFragmentId) => ({
    evidenceId,
    testimonyFragmentId,
    isValidContradiction: evidenceId === 'evidence-wax' && testimonyFragmentId === 'fragment-seal',
    reason: 'Independent pair review.',
    confidence: 0.95,
  })));
  const draft = {
    draftId: 'draft-v3',
    provider: 'OpenAI',
    status: 'FULL_LOGIC_AWAITING_APPROVAL',
    caseTitle: 'The Resealed Packet',
    generatedJson,
    settings: { generationPreset: 'SHORT_DEMO', mechanicsVersion: 3, includeCrackTheLie: true, language: 'en' },
    v3SemanticReview: { status: 'PASSED', cracks: [{ challengeId: 'challenge-seal', pairEvaluations }] },
  };

  await page.route('**/api/admin/ai-cases/capabilities', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      aiCaseV3PresetEnabled: true, gameplayV3Enabled: true, canCreateV3Draft: true, canPublishV3: true,
    } }) });
  });
  await page.route('**/api/admin/ai-cases', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [draft] }) });
  });
  await page.route('**/api/admin/ai-cases/draft-v3', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: draft }) });
  });

  await page.goto('/#/admin/ai');
  await page.getByRole('button', { name: 'View' }).click();

  await expect(page.getByRole('heading', { name: /V3 Crack/ })).toBeVisible();
  await expect(page.locator('.v3-pair-matrix tbody td')).toHaveCount(9);
  await expect(page.locator('.v3-pair-correct')).toContainText('AUTHORED CORRECT');
  await expect(page.locator('.v3-pair-matrix')).toContainText('CAMERA_CAPTURE');
  await expect(page.locator('.v3-pair-matrix')).toContainText('ITEM_INSPECT');
  await expect(page.locator('.v3-pair-matrix')).toContainText('Ticket stub');
  await expect(page.locator('.v3-pair-matrix')).toContainText('Muddy thread');
  await expect(page.getByRole('button', { name: 'Approve full logic' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repair item evidence' })).toHaveCount(0);
});

for (const [testimonyCount, evidenceCount] of [[2, 3], [3, 4], [4, 6]]) {
  test(`admin review renders a dynamic ${testimonyCount}T x ${evidenceCount}E matrix`, async ({ page }) => {
    await page.unroute('**/api/admin/ai-cases/capabilities');
    await page.unroute('**/api/admin/ai-cases');
    const fragmentIds = Array.from({ length: testimonyCount }, (_, index) => `fragment-${index + 1}`);
    const evidenceIds = Array.from({ length: evidenceCount }, (_, index) => `evidence-${index + 1}`);
    const pairEvaluations = evidenceIds.flatMap((evidenceId) => fragmentIds.map((testimonyFragmentId) => ({
      evidenceId,
      testimonyFragmentId,
      isValidContradiction: evidenceId === evidenceIds[0] && testimonyFragmentId === fragmentIds[0],
      confidence: 0.95,
      reasonCode: evidenceId === evidenceIds[0] && testimonyFragmentId === fragmentIds[0] ? 'DIRECT_NEGATION' : 'RELATED_ONLY',
      reason: 'Dynamic Cartesian evaluation.',
    })));
    const generatedJson = JSON.stringify({
      evidenceChallenges: [{
        challengeId: 'challenge-dynamic', dialogueId: 'dialogue-dynamic', order: 1, isSignature: true,
        testimonyFragmentId: fragmentIds[0], candidateTestimonyFragmentIds: fragmentIds,
        correctEvidenceId: evidenceIds[0], candidateEvidenceIds: evidenceIds,
      }],
      clues: evidenceIds.map((clueId, index) => ({
        clueId, title: `Evidence ${index + 1}`, content: 'A physical observation.',
        source: 'scene-dynamic', sourceType: 'camera', acquisitionMethod: 'CAMERA_CAPTURE',
      })),
      testimonyFragments: fragmentIds.map((id, index) => ({ id, dialogueId: 'dialogue-dynamic', text: `Claim ${index + 1}` })),
      dialogues: [{ dialogueId: 'dialogue-dynamic', answer: fragmentIds.map((_, index) => `Claim ${index + 1}`).join('. ') }],
    });
    const draft = {
      draftId: `draft-${testimonyCount}-${evidenceCount}`,
      provider: 'OpenAI', status: 'FULL_LOGIC_AWAITING_APPROVAL', generatedJson,
      settings: { generationPreset: evidenceCount === 6 && testimonyCount === 4 ? 'FULL_FEATURE' : 'NORMAL_RANDOM', mechanicsVersion: 3, includeCrackTheLie: true },
      v3SemanticReview: { status: 'PASSED', cracks: [{ challengeId: 'challenge-dynamic', expectedPairCount: testimonyCount * evidenceCount, pairEvaluations }] },
    };
    await page.route('**/api/admin/ai-cases/capabilities', async (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { aiCaseV3PresetEnabled: true, gameplayV3Enabled: true } }),
    }));
    await page.route('**/api/admin/ai-cases', async (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [draft] }),
    }));
    await page.route(`**/api/admin/ai-cases/${draft.draftId}`, async (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: draft }),
    }));

    await page.goto('/#/admin/ai');
    await page.getByRole('button', { name: 'View' }).click();

    await expect(page.locator('.v3-pair-matrix tbody td')).toHaveCount(testimonyCount * evidenceCount);
    await expect(page.locator('.v3-ai-review')).toContainText(`${testimonyCount}T × ${evidenceCount}E = ${testimonyCount * evidenceCount} pairs`);
    await expect(page.locator('.v3-pair-reviewer-selected')).toHaveCount(1);
  });
}

test('V3 ready draft cannot publish from AI Creator while gameplay flag is disabled', async ({ page }) => {
  await page.unroute('**/api/admin/ai-cases/capabilities');
  await page.unroute('**/api/admin/ai-cases');
  const draft = {
    draftId: 'draft-ready-v3',
    provider: 'OpenAI',
    status: 'READY_TO_PUBLISH',
    caseTitle: 'Ready but disabled',
    hasGeneratedJson: true,
    generatedJson: '{}',
    settings: {
      generationPreset: 'CRACK_THE_LIE_V3',
      generationMode: 'PLACEMENT_FIRST',
      mechanicsVersion: 3,
      language: 'en',
    },
    v3SemanticReview: { status: 'PASSED', pairEvaluations: [] },
  };
  await page.route('**/api/admin/ai-cases/capabilities', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {
      aiCaseV3PresetEnabled: true, gameplayV3Enabled: false, canCreateV3Draft: true, canPublishV3: false,
    } }) });
  });
  await page.route('**/api/admin/ai-cases', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [draft] }) });
  });

  await page.goto('/#/admin/ai');

  await expect(page.getByRole('button', { name: 'Publish blocked' })).toBeDisabled();
  await expect(page.getByText('Review PASSED')).toBeVisible();
});

test('Vietnamese selector sends language and renders Vietnamese preview', async ({ page }) => {
  await page.goto('/#/admin/ai');
  await expect(page.locator('#ai-language-select')).toContainText('Tiếng Việt');
  await page.locator('#ai-language-select').selectOption('vi');
  await page.locator('#ai-case-type-select').selectOption('MISSING_PERSON');

  const generationRequest = page.waitForRequest((request) =>
    request.url().endsWith('/api/admin/ai-cases') && request.method() === 'POST');
  await page.locator('#quick-create-btn').click();
  const request = await generationRequest;

  expect(request.postDataJSON()).toMatchObject({ language: 'vi', caseType: 'MISSING_PERSON' });
  await expect(page.locator('#ai-language-select')).toHaveValue('vi');
  await expect(page.locator('#ai-case-type-select')).toHaveValue('MISSING_PERSON');
  await expect(page.locator('#ai-output')).toContainText('Tiếng Chuông Dưới Blackglass');
  await expect(page.locator('#ai-output')).toContainText('Language: Tiếng Việt');
});
