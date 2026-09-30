import { expect, test } from '@playwright/test';

test('storyboard edits invalidate quote approval and generation submits exactly the saved revision', async ({ page }) => {
  let generated: any = null;
  let state: any = {
    draftId: 'draft', version: 1, status: 'DRAFT', generationEnabled: true,
    estimate: { configured: true, totalUsd: .42, model: 'mock-video', pricingVersion: 'test-only' },
    clips: [{ id: 'opening', kind: 'INTRO', sourceImageUrl: '/assets/scene.png', prompt: 'Slow motion', caption: 'An unexplained disappearance.', durationSeconds: 6, generateVideo: true, status: 'DRAFT' }]
  };
  await page.route('**/test-editor', (route) => route.fulfill({ contentType: 'text/html', body: '<main id="editor"></main>' }));
  await page.route('**/api/admin/ai-cases/draft/presentation', async (route) => {
    if (route.request().method() === 'PUT') {
      const data = route.request().postDataJSON();
      expect(data.expectedVersion).toBe(1);
      state = { ...state, version: 2, clips: data.clips, estimate: { ...state.estimate, totalUsd: .45 } };
    }
    await route.fulfill({ json: { success: true, data: state } });
  });
  await page.route('**/api/admin/ai-cases/draft/presentation/generate', async (route) => {
    generated = route.request().postDataJSON();
    state = { ...state, version: 3, clips: state.clips.map((clip: any) => ({ ...clip, status: 'QUEUED' })) };
    await route.fulfill({ json: { success: true, data: state } });
  });
  await page.goto('/test-editor');
  await page.evaluate(async () => { const { mountPresentationEditor } = await import('/Client/js/pages/adminPresentation.js'); mountPresentationEditor(document.querySelector('#editor'), 'draft'); });
  await expect(page.locator('[data-generate-video]')).toBeDisabled();
  await page.locator('[data-approve-budget]').check();
  await expect(page.locator('[data-generate-video]')).toBeEnabled();
  await page.locator('[data-clip-field="prompt"]').fill('Camera locked, subtle blink.');
  await expect(page.locator('[data-approve-budget]')).not.toBeChecked();
  await expect(page.locator('[data-generate-video]')).toBeDisabled();
  await page.locator('[data-save-storyboard]').click();
  await expect(page.locator('.presentation-budget')).toContainText('$0.4500');
  await page.locator('[data-approve-budget]').check();
  await page.locator('[data-generate-video]').click();
  await expect.poll(() => generated).toEqual({ expectedVersion: 2, approvedBudgetUsd: .45 });
  await expect(page.locator('[data-save-storyboard]')).toBeDisabled();
});

test('unknown generation and costs stay explicit and never trigger an automatic resubmission', async ({ page }) => {
  let posts = 0;
  await page.route('**/test-editor', (route) => route.fulfill({ contentType: 'text/html', body: '<main id="editor"></main>' }));
  await page.route('**/api/admin/ai-cases/draft/presentation', (route) => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: { success: true, data: {
      draftId: 'draft', version: 1, status: 'DRAFT', generationEnabled: false, disabledReason: 'Submission status needs review.',
      estimate: { configured: false, totalUsd: null },
      clips: [{ id: 'opening', kind: 'INTRO', prompt: '<script>window.injected=true</script>', sourceImageUrl: '', durationSeconds: 6, generateVideo: true, status: 'SUBMISSION_UNKNOWN', errorCode: 'SUBMISSION_UNKNOWN' }]
    } } });
  });
  await page.route('**/api/admin/ai-cases/draft/usage', (route) => route.fulfill({ json: { success: true, data: {
    calls: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, measuredCostUsd: 0, calculatedCostUsd: 0, unknownCalls: 1, reservedUsd: .5,
    events: [{ step: 'GenerateVideo', model: 'mock', state: 'UNKNOWN', costUsd: null, costSource: 'UNKNOWN' }]
  } } }));
  await page.goto('/test-editor');
  await page.evaluate(async () => { const { mountPresentationEditor } = await import('/Client/js/pages/adminPresentation.js'); mountPresentationEditor(document.querySelector('#editor'), 'draft'); });
  await expect(page.locator('[data-generate-video]')).toBeDisabled();
  await expect(page.locator('[data-clip-field="prompt"]')).toHaveValue('<script>window.injected=true</script>');
  expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
  await page.locator('.presentation-usage summary').click();
  await page.locator('[data-load-usage]').click();
  await expect(page.locator('[data-usage-output]')).toContainText('Unknown calls: 1');
  await expect(page.locator('[data-usage-output] tbody')).toContainText('Unknown');
  expect(posts).toBe(0);
});

test('optional sound and ping helpers keep settings bounded and reject private or expired content', async ({ page }) => {
  await page.route('**/test-editor', (route) => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  await page.goto('/test-editor');
  const result = await page.evaluate(async () => {
    const audio = await import('/Client/js/game/audioController.ts');
    const ping = await import('/Client/js/game/cooperativePing.ts');
    const translate = (en: string) => en;
    return {
      settings: audio.normalizeAudioSettings({ music: 20, effects: -2, muted: false }),
      invalid: ping.renderPartnerPing({ kind: 'PRIVATE_CLUE', senderUserId: 'x', expiresAt: new Date(Date.now() + 8000).toISOString() }, translate),
      expired: ping.renderPartnerPing({ kind: 'DISCOVERY', senderUserId: 'x', expiresAt: new Date(0).toISOString() }, translate),
      valid: ping.renderPartnerPing({ kind: 'COMPARE', senderUserId: 'x', expiresAt: new Date(Date.now() + 8000).toISOString() }, translate)
    };
  });
  expect(result.settings).toEqual({ music: 1, effects: 0, muted: false });
  expect(result.invalid).toBe(''); expect(result.expired).toBe('');
  expect(result.valid).toContain('Let’s compare');
});

test('regeneration approves only one clip and unknown submissions resume their existing request', async ({ page }) => {
  const calls: any[] = [];
  const clips = [
    { id: 'portrait', kind: 'PORTRAIT', estimatedUsd: .12, durationSeconds: 4, status: 'READY', approved: true, generateVideo: true },
    { id: 'ending', kind: 'ENDING', estimatedUsd: .18, durationSeconds: 6, status: 'READY', generateVideo: true }
  ];
  await page.route('**/test-editor', (route) => route.fulfill({ contentType: 'text/html', body: '<main id="editor"></main>' }));
  await page.route('**/api/admin/ai-cases/draft/presentation**', (route) => {
    if (route.request().method() === 'POST') {
      calls.push({ path: new URL(route.request().url()).pathname, ...route.request().postDataJSON() });
      clips[1].status = 'SUBMISSION_UNKNOWN';
    }
    return route.fulfill({ json: { success: true, data: { version: 8, generationEnabled: true, status: 'DRAFT', clips, estimate: { totalUsd: .3 } } } });
  });
  await page.goto('/test-editor');
  await page.evaluate(async () => {
    localStorage.setItem('sirlocked.user', JSON.stringify({ role: 'ADMIN' }));
    const { mountPresentationEditor } = await import('/Client/js/pages/adminPresentation.js');
    mountPresentationEditor(document.querySelector('#editor'), 'draft');
  });
  const portrait = page.locator('[data-clip-id="portrait"]');
  await portrait.locator('[data-approve-clip-budget]').check();
  await portrait.locator('[data-generate-clip]').click();
  await expect.poll(() => calls[0]).toEqual({ path: '/api/admin/ai-cases/draft/presentation/clips/portrait/generate', expectedVersion: 8, approvedBudgetUsd: .12 });
  const recovery = page.locator('.presentation-recovery');
  await expect(portrait.locator('[data-approve-clip-budget]')).toBeDisabled();
  await recovery.locator('summary').click();
  await recovery.locator('[data-recovery-id]').fill('existing-request-123');
  await recovery.locator('[data-recover-clip]').click();
  await expect.poll(() => calls[1]).toEqual({ path: '/api/admin/ai-cases/draft/presentation/clips/ending/recover', providerRequestId: 'existing-request-123' });
  expect(calls).toHaveLength(2);
});
