import { expect, test, type Page } from '@playwright/test';

const envelope = (data: unknown) => ({ success: true, data });
const truth = {
  coreTruth: { culpritId: 'suspect-a', targetId: 'deed', motive: 'Protect an inheritance', method: 'Swap the deed' },
  trueTimeline: [], opportunityMatrix: [], traceLedger: [], statementLedger: [], proofGraph: { conclusions: [] },
};
const passedReview = { status: 'PASSED', confidence: .95, timelineFeasible: true, physicalCausalityFeasible: true, uniqueSolution: true, findings: [] };
const failedReview = { ...passedReview, status: 'FAILED', physicalCausalityFeasible: false, findings: [
  { code: 'PROOF_SCOPE', message: 'The inheritance motive has no supporting evidence.', relatedIds: ['motive'] },
] };
const baseDraft = {
  draftId: 'truth-repair', provider: 'OpenAI', status: 'FULL_LOGIC_AWAITING_APPROVAL', queueState: 'NONE',
  caseTitle: 'Truth repair case', canCancel: true, canContinue: true, logicContractVersion: 2,
  settings: { generationPreset: 'SHORT_DEMO', language: 'en', mechanicsVersion: 3, includeCrackTheLie: true },
  v3SemanticReview: { status: 'PASSED' },
  truthSummary: { schemaVersion: 'case-truth-v1', truthHash: 'a'.repeat(64), validationErrorCount: 0, reviewerStatus: 'FAILED', timelineEventCount: 0, traceCount: 0, statementCount: 0, proofConclusionCount: 0 },
  caseTruth: truth, truthReviewerResult: failedReview, truthValidationReport: [],
  truthRepairPlan: { recommendedStartArtifact: 'EVIDENCE', reasonCodes: ['PROOF_SCOPE'], staleArtifacts: ['GAMEPLAY_PROJECTION'] },
};
const candidateDraft = { ...baseDraft, truthRepairStatus: 'CANDIDATE_READY', truthRepairCandidate: truth, truthRepairValidationReport: [], truthRepairReviewerResult: failedReview };
const invalidCandidateDraft = { ...candidateDraft, truthRepairStatus: 'CANDIDATE_INVALID',
  truthRepairValidationReport: ['PROOF_GRAPH: Method needs two independent sources.'],
  truthRepairCandidatePlan: { recommendedStartArtifact: 'PROOF_GRAPH', reasonCodes: ['PROOF_COVERAGE'], staleArtifacts: ['GAMEPLAY_PROJECTION'] },
};
const cancelledDraft = { ...baseDraft, status: 'CANCELLED', queueState: 'CANCELLED', canCancel: false, canContinue: false };
const otherDraft = { ...baseDraft, draftId: 'other-truth', caseTitle: 'Another selected case' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function arrange(page: Page, initial: object = baseDraft) {
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'mock-admin-token');
    localStorage.setItem('sirlocked.uiLanguage', 'en');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'mock-admin', role: 'ADMIN', fullName: 'Test Admin', isEmailVerified: true }));
  });
  // Mock every API request: no real generation, account change, or provider call.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ status: 404, json: { success: false, message: 'Unmocked route.' } }));
  await page.route('**/api/admin/ai-cases/capabilities', (route) => route.fulfill({ json: envelope({ aiCaseV3PresetEnabled: true, gameplayV3Enabled: true, canCreateDraft: true, canCreateV3Draft: true }) }));
  await page.route('**/api/admin/ai-cases', (route) => route.fulfill({ json: envelope([initial, otherDraft]) }));
  await page.route('**/api/admin/ai-cases/truth-repair', (route) => route.fulfill({ json: envelope(initial) }));
  await page.route('**/api/admin/ai-cases/other-truth', (route) => route.fulfill({ json: envelope(otherDraft) }));
  await page.route('**/api/admin/ai-cases/truth-repair/cancel', (route) => route.fulfill({ json: envelope(cancelledDraft) }));
}

async function openDraft(page: Page) {
  await page.goto('/#/admin/ai');
  await page.locator('[data-view="truth-repair"]').click();
  await expect(page.locator('#ai-output')).toContainText('Truth repair case');
}

test('full logic exposes scoped repair and shows candidate findings independently before acceptance', async ({ page }, testInfo) => {
  await arrange(page, { ...baseDraft, truthReviewerResult: passedReview });
  let currentDraft: object = baseDraft;
  await page.route('**/api/admin/ai-cases', (route) => route.fulfill({ json: envelope([currentDraft, otherDraft]) }));
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ repairInstructions: 'Add evidence of the inheritance.', repairFromArtifact: 'EVIDENCE' });
    currentDraft = { ...candidateDraft, truthReviewerResult: passedReview };
    await route.fulfill({ json: envelope(currentDraft) });
  });
  await page.route('**/api/admin/ai-cases/truth-repair/accept-truth-repair', (route) => {
    currentDraft = { ...baseDraft, status: 'CASE_TRUTH_AWAITING_APPROVAL', truthRepairStatus: 'ACCEPTED', truthRepairCandidate: null };
    return route.fulfill({ json: envelope(currentDraft) });
  });
  await openDraft(page);
  await expect(page.locator('#ai-output [data-approve-full-logic]')).toBeVisible();
  await page.locator('[data-truth-repair-instructions]').fill('Add evidence of the inheritance.');
  await page.locator('[data-truth-review] [data-repair-truth]').click();
  const review = page.locator('[data-truth-repair-review]');
  await expect(review).toContainText('Candidate story review (advisory): FAILED');
  await expect(review).toContainText('inheritance motive has no supporting evidence');
  await expect(review).toContainText('Structure passed; review the content');
  await expect(review).toContainText('requires gameplay to be generated again');
  await expect(page.locator('[data-ai-quality-summary]')).toContainText('Story review (advisory): PASSED');
  await expect(page.locator('#ai-output [data-approve-full-logic]')).toHaveCount(0);
  await expect(page.locator('[data-truth-review] [data-repair-truth]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('truth-repair-review-desktop.png'), fullPage: true });
  await page.locator('[data-accept-truth-repair]').click();
  await expect(page.locator('[data-ai-quality-summary]')).toContainText('Story review (advisory): FAILED');
  // Semantic review stays advisory; structural validity still allows gameplay approval.
  await expect(page.locator('#ai-output [data-approve-truth]')).toBeVisible();
});

test('Vietnamese copy distinguishes valid structure from an unreviewed candidate', async ({ page }) => {
  await arrange(page, { ...candidateDraft, truthReviewerResult: { status: 'NOT_RUN' }, truthRepairReviewerResult: null });
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));
  await openDraft(page);
  await expect(page.locator('[data-ai-quality-summary]')).toContainText('Chất lượng cốt truyện chưa được đánh giá');
  await expect(page.locator('[data-truth-repair-review]')).toContainText('Đánh giá cốt truyện bản sửa (tham khảo): NOT_RUN');
  await expect(page.locator('[data-truth-repair-review]')).toContainText('Cấu trúc hợp lệ');
  await expect(page.locator('[data-accept-truth-repair]')).toBeEnabled();
});

test('invalid candidate continuation uses its own repair scope and keeps current truth separate', async ({ page }, testInfo) => {
  await arrange(page, invalidCandidateDraft);
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      repairInstructions: 'Connect the existing method evidence.', repairFromArtifact: 'PROOF_GRAPH', useRepairCandidate: true,
    });
    await route.fulfill({ json: envelope(candidateDraft) });
  });
  await openDraft(page);
  await expect(page.locator('[data-truth-repair-validation]')).toContainText('Method needs two independent sources.');
  await expect(page.locator('[data-truth-repair-continuation]')).toContainText('current truth and gameplay stay unchanged');
  await expect(page.locator('[data-candidate-repair-scope]')).toHaveValue('PROOF_GRAPH');
  await expect(page.locator('[data-truth-repair-scope]')).toHaveValue('EVIDENCE');
  await expect(page.locator('[data-accept-truth-repair]')).toHaveCount(0);
  await page.locator('[data-truth-repair-review]').screenshot({ path: testInfo.outputPath('candidate-continuation-desktop.png') });
  await page.locator('[data-candidate-repair-instructions]').fill('Connect the existing method evidence.');
  await page.locator('[data-continue-truth-repair]').click();
  await expect(page.locator('[data-accept-truth-repair]')).toBeEnabled();
  await expect(page.locator('[data-continue-truth-repair]')).toHaveCount(0);
});

test('a fresh repair from an invalid candidate screen explicitly uses the current checkpoint', async ({ page }) => {
  await arrange(page, invalidCandidateDraft);
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      repairInstructions: 'Rebuild current evidence.', repairFromArtifact: 'EVIDENCE',
    });
    await route.fulfill({ json: envelope(candidateDraft) });
  });
  await openDraft(page);
  await page.locator('[data-candidate-repair-instructions]').fill('Do not send this instruction.');
  await page.locator('[data-truth-repair-instructions]').fill('Rebuild current evidence.');
  await page.locator('[data-truth-review] [data-repair-truth]').click();
  await expect(page.locator('[data-accept-truth-repair]')).toBeVisible();
});

test('candidate continuation scope allows earlier evidence repair but excludes later artifacts', async ({ page }) => {
  await arrange(page, { ...invalidCandidateDraft, truthRepairCandidatePlan: { recommendedStartArtifact: 'STATEMENTS', reasonCodes: ['STATEMENT_SCOPE'] } });
  await openDraft(page);
  await expect(page.locator('[data-candidate-repair-scope]')).toHaveValue('STATEMENTS');
  await expect(page.locator('[data-candidate-repair-scope] option[value="PROOF_GRAPH"]')).toHaveCount(0);
  await page.locator('[data-candidate-repair-scope]').selectOption('EVIDENCE');
  await expect(page.locator('[data-candidate-repair-scope]')).toHaveValue('EVIDENCE');
});

for (const candidateState of [
  { truthRepairStatus: 'CANDIDATE_READY' },
  { truthRepairCandidate: null },
  { queueState: 'RUNNING' },
  { importedCaseId: 'existing-case' },
]) {
  test(`candidate continuation is hidden for ${JSON.stringify(candidateState)}`, async ({ page }) => {
    await arrange(page, { ...invalidCandidateDraft, ...candidateState });
    await openDraft(page);
    await expect(page.locator('[data-continue-truth-repair]')).toHaveCount(0);
  });
}

test('a stale candidate error explains recovery in Vietnamese and preserves candidate details', async ({ page }) => {
  await arrange(page, invalidCandidateDraft);
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', (route) => route.fulfill({
    status: 409, json: { success: false, message: 'Stale candidate.', errors: { code: 'AI_TRUTH_REPAIR_CANDIDATE_STALE' } },
  }));
  await openDraft(page);
  await page.locator('[data-continue-truth-repair]').click();
  await expect(page.locator('.toast-error')).toContainText('tạo bản sửa mới từ sự thật hiện tại');
  await expect(page.locator('[data-truth-repair-validation]')).toContainText('Method needs two independent sources.');
  await expect(page.locator('[data-continue-truth-repair]')).toBeEnabled();
});

test('a late candidate continuation cannot replace a newly selected draft', async ({ page }) => {
  await arrange(page, invalidCandidateDraft);
  const pending = deferred();
  let started = false;
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', async (route) => {
    started = true;
    await pending.promise;
    await route.fulfill({ json: envelope(candidateDraft) });
  });
  await openDraft(page);
  await page.locator('[data-continue-truth-repair]').click();
  await expect.poll(() => started).toBe(true);
  await expect(page.locator('[data-truth-review] [data-repair-truth]')).toBeDisabled();
  await expect(page.locator('[data-reject-truth-repair]')).toBeDisabled();
  await page.locator('[data-view="other-truth"]').click();
  await expect(page.locator('#ai-output')).toContainText(otherDraft.caseTitle);
  pending.resolve();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#ai-output')).toContainText(otherDraft.caseTitle);
  await expect(page.locator('#ai-output')).not.toContainText(baseDraft.caseTitle);
});

test('a pending truth repair conflict gives a translated next step', async ({ page }) => {
  await arrange(page);
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));
  await page.route('**/api/admin/ai-cases/truth-repair/approve-full-logic', (route) => route.fulfill({
    status: 409, json: { success: false, message: 'Pending truth repair.', errors: { code: 'AI_TRUTH_REPAIR_PENDING' } },
  }));
  await openDraft(page);
  await page.locator('#ai-output [data-approve-full-logic]').click();
  await expect(page.locator('.toast-error')).toContainText('chấp nhận hoặc từ chối bản sửa truth');
});

for (const state of [{ status: 'PUBLISHED', importedCaseId: 'published-case' }, { queueState: 'RUNNING' }]) {
  test(`truth repair is absent for ${state.status || state.queueState}`, async ({ page }) => {
    await arrange(page, { ...baseDraft, ...state });
    await openDraft(page);
    await expect(page.locator('[data-truth-review] [data-repair-truth]')).toHaveCount(0);
    await expect(page.locator('#ai-output [data-approve-full-logic]')).toHaveCount(0);
  });
}

test('a late repair response cannot replace a confirmed cancellation', async ({ page }) => {
  await arrange(page);
  const pending = deferred();
  let repairStarted = false;
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', async (route) => {
    repairStarted = true;
    await pending.promise;
    await route.fulfill({ json: envelope(candidateDraft) });
  });
  await openDraft(page);
  await page.locator('[data-truth-review] [data-repair-truth]').click();
  await expect.poll(() => repairStarted).toBe(true);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#ai-output [data-cancel-draft]').click();
  await expect(page.locator('#ai-output')).toContainText('Cancelled');
  pending.resolve();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#ai-output')).toContainText('Cancelled');
  await expect(page.locator('[data-accept-truth-repair]')).toHaveCount(0);
  await expect(page.locator('.toast').filter({ hasText: 'Repair structure passed' })).toHaveCount(0);
});

test('a late repair list refresh cannot restore stale action buttons after cancellation', async ({ page }) => {
  await arrange(page);
  const pending = deferred();
  let lists = 0;
  await page.route('**/api/admin/ai-cases', async (route) => {
    const read = ++lists;
    if (read === 2) await pending.promise;
    await route.fulfill({ json: envelope([read >= 3 ? cancelledDraft : candidateDraft, otherDraft]) });
  });
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', (route) => route.fulfill({ json: envelope(candidateDraft) }));
  await openDraft(page);
  await page.locator('[data-truth-review] [data-repair-truth]').click();
  await expect.poll(() => lists).toBe(2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#ai-output [data-cancel-draft]').click();
  await expect(page.locator('#ai-output')).toContainText('Cancelled');
  pending.resolve();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#ai-output')).toContainText('Cancelled');
  await expect(page.locator('[data-cancel-draft="truth-repair"]')).toHaveCount(0);
});

for (const action of ['accept', 'reject']) {
  test(`a late ${action} response cannot replace a newly selected draft`, async ({ page }) => {
    await arrange(page, candidateDraft);
    const pending = deferred();
    let started = false;
    await page.route(`**/api/admin/ai-cases/truth-repair/${action}-truth-repair`, async (route) => {
      started = true;
      await pending.promise;
      await route.fulfill({ json: envelope(baseDraft) });
    });
    await openDraft(page);
    await page.locator(`[data-${action}-truth-repair]`).click();
    await expect.poll(() => started).toBe(true);
    await page.locator('[data-view="other-truth"]').click();
    await expect(page.locator('#ai-output')).toContainText(otherDraft.caseTitle);
    pending.resolve();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#ai-output')).toContainText(otherDraft.caseTitle);
    await expect(page.locator('#ai-output')).not.toContainText(baseDraft.caseTitle);
  });
}

test('a late repair failure after leaving the route produces no stale error toast', async ({ page }) => {
  await arrange(page);
  const pending = deferred();
  let started = false;
  await page.route('**/api/admin/ai-cases/truth-repair/repair-truth', async (route) => {
    started = true;
    await pending.promise;
    await route.fulfill({ status: 409, json: { success: false, message: 'Obsolete repair failure.' } });
  });
  await openDraft(page);
  await page.locator('[data-truth-review] [data-repair-truth]').click();
  await expect.poll(() => started).toBe(true);
  await page.evaluate(() => { location.hash = '#/login'; });
  await expect(page.locator('#ai-output')).toHaveCount(0);
  pending.resolve();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.toast').filter({ hasText: 'Obsolete repair failure' })).toHaveCount(0);
  await expect(page.locator('#ai-output')).toHaveCount(0);
});

test('a late draft detail read cannot replace the last selected draft', async ({ page }) => {
  await arrange(page);
  const pending = deferred();
  let started = false;
  await page.route('**/api/admin/ai-cases/truth-repair', async (route) => {
    started = true;
    await pending.promise;
    await route.fulfill({ json: envelope(baseDraft) });
  });
  await page.goto('/#/admin/ai');
  await page.locator('[data-view="truth-repair"]').click();
  await expect.poll(() => started).toBe(true);
  await page.locator('[data-view="other-truth"]').click();
  await expect(page.locator('#ai-output')).toContainText(otherDraft.caseTitle);
  pending.resolve();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#ai-output')).toContainText(otherDraft.caseTitle);
});
