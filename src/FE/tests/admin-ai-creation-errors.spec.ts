import { expect, test } from '@playwright/test';

const capabilities = {
  aiCaseV3PresetEnabled: true, gameplayV3Enabled: true,
  canCreateDraft: true, canCreateV3Draft: true, creationBlockers: [], v3CreationBlockers: [],
};
const draft = {
  draftId: 'creation-test', provider: 'OpenAI', status: 'STORY_AWAITING_APPROVAL', queueState: 'NONE',
  canCancel: true, settings: { generationPreset: 'SHORT_DEMO', language: 'vi' },
  storyPreview: { title: 'A preserved creative brief', summary: 'A deterministic test premise.' },
};
const envelope = (data: unknown) => ({ success: true, data });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sirlocked.token', 'mock-admin-token');
    localStorage.setItem('sirlocked.uiLanguage', 'en');
    localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'admin-creation-test', role: 'ADMIN', fullName: 'Test Admin', isEmailVerified: true,
    }));
  });
  // Every API route is intercepted: these tests must never create a real draft or paid call.
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ status: 404, json: { success: false, message: 'Unmocked test route.' } }));
  await page.route('**/api/admin/ai-cases/capabilities', (route) => route.fulfill({ json: envelope(capabilities) }));
  await page.route('**/api/admin/ai-cases', (route) => route.fulfill({
    json: envelope(route.request().method() === 'GET' ? [] : draft),
  }));
});

test('server readiness blockers stay visible in Vietnamese and retry preserves the brief', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));
  let checks = 0;
  let creations = 0;
  const blockers = ['AI_PROVIDER_UNCONFIGURED', 'AI_QUOTA_UNCONFIGURED', 'AI_ASSET_STORAGE_UNCONFIGURED', 'AI_USAGE_PRICE_REQUIRED']
    .map((code) => ({ code, message: 'Server configuration is incomplete.', messageKey: 'ai.setup' }));
  await page.route('**/api/admin/ai-cases/capabilities', (route) => route.fulfill({ json: envelope(
    ++checks === 1 ? { ...capabilities, canCreateDraft: false, creationBlockers: blockers } : capabilities,
  ) }));
  await page.route('**/api/admin/ai-cases', (route) => {
    if (route.request().method() === 'POST') creations++;
    return route.fulfill({ json: envelope([]) });
  });
  await page.goto('/#/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeDisabled();
  await expect(page.locator('#ai-readiness-error')).toContainText('Chưa thể tạo vụ án');
  await expect(page.locator('#ai-readiness-error')).toContainText('Máy chủ chưa cấu hình dịch vụ tạo AI');
  await expect(page.locator('#ai-readiness-error')).toContainText('Hạn mức và ngân sách');
  await expect(page.locator('#ai-readiness-error')).toContainText('Cloudinary');
  await expect(page.locator('#ai-readiness-error')).toContainText('giá mô hình AI');
  await page.screenshot({ path: testInfo.outputPath('ai-readiness-blockers-vi-desktop.png'), fullPage: true });
  await page.locator('#ai-creator-direction').fill('Giữ lại hướng điều tra ở nhà hát.');
  await page.locator('#ai-preset-select').selectOption('SHORT_DEMO');
  await page.locator('#ai-check-readiness').click();
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await expect(page.locator('#ai-readiness-error')).toHaveCount(0);
  await expect(page.locator('#ai-creator-direction')).toHaveValue('Giữ lại hướng điều tra ở nhà hát.');
  await expect(page.locator('#ai-preset-select')).toHaveValue('SHORT_DEMO');
  expect(creations).toBe(0);
});

test('capability failure blocks creation with retry while a legacy capability response remains usable', async ({ page }) => {
  let checks = 0;
  let lists = 0;
  await page.route('**/api/admin/ai-cases/capabilities', (route) => route.fulfill(++checks === 1
    ? { status: 503, json: { success: false, message: 'Service unavailable.' } }
    : { json: envelope({ aiCaseV3PresetEnabled: false, gameplayV3Enabled: false }) }));
  await page.route('**/api/admin/ai-cases', (route) => route.fulfill(route.request().method() === 'GET' && ++lists === 1
    ? { status: 503, json: { success: false, message: 'Service unavailable.' } }
    : { json: envelope(route.request().method() === 'GET' ? [] : draft) }));
  await page.goto('/#/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeDisabled();
  await expect(page.locator('#ai-readiness-error')).toContainText('Could not check AI availability');
  await expect(page.getByText('Could not load recent drafts.', { exact: true })).toBeVisible();
  await expect(page.getByText('No drafts yet.', { exact: true })).toHaveCount(0);
  await page.locator('#ai-check-readiness').click();
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await page.locator('#quick-create-btn').click();
  await expect(page.locator('#ai-output')).toContainText(draft.storyPreview.title);
});

test('creation errors remain visible and every entered field survives a successful retry', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sirlocked.uiLanguage', 'vi'));
  const requests: unknown[] = [];
  await page.route('**/api/admin/ai-cases', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: envelope([]) });
    requests.push(route.request().postDataJSON());
    return route.fulfill(requests.length === 1
      ? { status: 409, json: { success: false, message: 'Active draft limit.', errors: { code: 'AI_ACTIVE_DRAFT_LIMIT' } } }
      : { json: envelope(draft) });
  });
  await page.goto('/#/admin/ai');
  await page.locator('#ai-preset-select').selectOption('SHORT_DEMO');
  await page.locator('#ai-language-select').selectOption('vi');
  await page.locator('#ai-case-type-select').selectOption('THEFT');
  await page.locator('#ai-include-crack').check();
  await page.locator('#ai-creator-direction').fill('The <clock> vanishes from the theatre.');
  await page.locator('#ai-setting-lock').selectOption('theatre');
  await page.locator('#ai-tone-lock').selectOption('tense');
  await page.locator('#ai-mechanic-lock').selectOption('timeline');
  await page.locator('#quick-create-btn').click();
  await expect(page.locator('#ai-request-error')).toContainText('Hãy tiếp tục hoặc hủy');
  await expect(page.locator('#ai-request-error')).toContainText('AI_ACTIVE_DRAFT_LIMIT');
  await page.clock.install();
  await page.clock.fastForward(10_000);
  await expect(page.locator('#ai-request-error')).toBeVisible();
  await expect(page.locator('#ai-preset-select')).toHaveValue('SHORT_DEMO');
  await expect(page.locator('#ai-language-select')).toHaveValue('vi');
  await expect(page.locator('#ai-case-type-select')).toHaveValue('THEFT');
  await expect(page.locator('#ai-include-crack')).toBeChecked();
  await expect(page.locator('#ai-creator-direction')).toHaveValue('The <clock> vanishes from the theatre.');
  await expect(page.locator('#ai-setting-lock')).toHaveValue('theatre');
  await expect(page.locator('#ai-tone-lock')).toHaveValue('tense');
  await expect(page.locator('#ai-mechanic-lock')).toHaveValue('timeline');
  await page.locator('#quick-create-btn').click();
  await expect(page.locator('#ai-request-error')).toHaveCount(0);
  await expect(page.locator('#ai-output')).toContainText(draft.storyPreview.title);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test('Crack-specific readiness blocks only the selected extension', async ({ page }) => {
  await page.route('**/api/admin/ai-cases/capabilities', (route) => route.fulfill({ json: envelope({
    ...capabilities, canCreateV3Draft: false,
    v3CreationBlockers: [{ code: 'AI_USAGE_PRICE_REQUIRED', message: 'Review model pricing missing.' }],
  }) }));
  await page.goto('/#/admin/ai');
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await page.locator('#ai-include-crack').check();
  await expect(page.locator('#quick-create-btn')).toBeDisabled();
  await expect(page.locator('#ai-readiness-error')).toContainText('AI model pricing');
  await page.locator('#ai-include-crack').uncheck();
  await expect(page.locator('#quick-create-btn')).toBeEnabled();
  await expect(page.locator('#ai-readiness-error')).toHaveCount(0);
});

test('cancellable drafts require confirmation and cancelled drafts offer no cancellation or continuation', async ({ page }) => {
  let cancelled = false;
  let cancellations = 0;
  const cancelledDraft = { ...draft, status: 'CANCELLED', queueState: 'CANCELLED', canCancel: false, canContinue: false };
  await page.route('**/api/admin/ai-cases', (route) => route.fulfill({ json: envelope([
    cancelled ? cancelledDraft : draft,
    { ...draft, draftId: 'published-draft', status: 'PUBLISHED', canCancel: false, importedCaseId: 'published-case' },
  ]) }));
  await page.route('**/api/admin/ai-cases/creation-test/cancel', (route) => {
    cancellations++;
    cancelled = true;
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ json: envelope(cancelledDraft) });
  });
  await page.goto('/#/admin/ai');
  await expect(page.locator('[data-cancel-draft]')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('[data-cancel-draft]').click();
  expect(cancellations).toBe(0);
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain("does not reset today's creation limit");
    await dialog.accept();
  });
  await page.locator('[data-cancel-draft]').click();
  await expect(page.locator('#ai-output')).toContainText('Cancelled');
  await expect(page.locator('[data-cancel-draft]')).toHaveCount(0);
  await expect(page.locator('[data-continue], [data-approve-story]')).toHaveCount(0);
  expect(cancellations).toBe(1);
});

for (const status of [403, 404]) {
  test(`polling ${status} displays an actionable error and stops until explicit retry`, async ({ page }) => {
    let polls = 0;
    await page.route('**/api/admin/ai-cases', (route) => route.fulfill({ json: envelope(route.request().method() === 'GET'
      ? [] : { ...draft, status: 'GENERATING_STORY', queueState: 'PENDING', storyPreview: null }) }));
    await page.route('**/api/admin/ai-cases/creation-test', (route) => {
      polls++;
      return route.fulfill(polls === 1 ? { status, json: { success: false, message: 'Unavailable.' } }
        : { json: envelope({ ...draft, status: 'CANCELLED', queueState: 'CANCELLED', canCancel: false }) });
    });
    await page.goto('/#/admin/ai');
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    await page.locator('#quick-create-btn').click();
    await expect(page.locator('#ai-output')).toContainText('Generating story');
    await page.clock.fastForward(500);
    await expect(page.locator('#ai-poll-error')).toContainText(status === 403 ? 'does not have permission' : 'no longer available');
    await page.clock.fastForward(60_000);
    expect(polls).toBe(1);
    await page.locator('#ai-retry-status').click();
    await page.clock.fastForward(500);
    await expect(page.locator('#ai-output')).toContainText('Cancelled');
    await expect(page.locator('#ai-poll-error')).toHaveCount(0);
    await page.clock.fastForward(60_000);
    expect(polls).toBe(2);
  });
}

test('failed terminal generation shows the configuration issue without a success toast', async ({ page }) => {
  await page.route('**/api/admin/ai-cases', (route) => route.fulfill({ json: envelope(route.request().method() === 'GET'
    ? [] : { ...draft, status: 'GENERATED_INVALID', lastGenerationErrorCode: 'AI_USAGE_PRICE_REQUIRED', storyPreview: null }) }));
  await page.goto('/#/admin/ai');
  await page.locator('#quick-create-btn').click();
  await expect(page.locator('#ai-output')).toContainText('Generation invalid');
  await expect(page.locator('#ai-request-error')).toContainText('AI model pricing');
  await expect(page.locator('.toast-success')).toHaveCount(0);
});

test('a delayed terminal poll cannot replace the confirmed cancellation', async ({ page }) => {
  let listReads = 0;
  let releaseList: () => void;
  const cancelledDraft = { ...draft, status: 'CANCELLED', queueState: 'CANCELLED', canCancel: false };
  await page.route('**/api/admin/ai-cases', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: envelope({ ...draft, status: 'GENERATING_STORY', queueState: 'PENDING', storyPreview: null }) });
      return;
    }
    const read = ++listReads;
    if (read === 3) await new Promise<void>((resolve) => { releaseList = resolve; });
    await route.fulfill({ json: envelope(read >= 4 ? [cancelledDraft] : read === 3 ? [draft] : []) });
  });
  await page.route('**/api/admin/ai-cases/creation-test', (route) => route.fulfill({ json: envelope(draft) }));
  await page.route('**/api/admin/ai-cases/creation-test/cancel', (route) => route.fulfill({ json: envelope(cancelledDraft) }));
  await page.goto('/#/admin/ai');
  await page.locator('#quick-create-btn').click();
  await expect(page.locator('#ai-output')).toContainText('Generating story');
  await expect.poll(() => listReads).toBe(3);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#ai-output [data-cancel-draft]').click();
  await expect(page.locator('#ai-output')).toContainText('Cancelled');
  releaseList!();
  // With every API mocked, network idle confirms the delayed list read has completed.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#ai-output')).toContainText('Cancelled');
  await expect(page.locator('#ai-output [data-approve-story]')).toHaveCount(0);
});
