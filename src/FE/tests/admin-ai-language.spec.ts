import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sirlocked.token', 'admin-smoke-token');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'admin-1',
      fullName: 'Admin Smoke',
      role: 'ADMIN',
      isEmailVerified: true,
    }));
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

test('Vietnamese selector sends language and renders Vietnamese preview', async ({ page }) => {
  await page.goto('/#/admin/ai');
  await expect(page.locator('#ai-language-select')).toContainText('Tiếng Việt');
  await page.locator('#ai-language-select').selectOption('vi');

  const generationRequest = page.waitForRequest((request) =>
    request.url().endsWith('/api/admin/ai-cases') && request.method() === 'POST');
  await page.locator('#quick-create-btn').click();
  const request = await generationRequest;

  expect(request.postDataJSON()).toMatchObject({ language: 'vi' });
  await expect(page.locator('#ai-language-select')).toHaveValue('vi');
  await expect(page.locator('#ai-output')).toContainText('Tiếng Chuông Dưới Blackglass');
  await expect(page.locator('#ai-output')).toContainText('Language: Tiếng Việt');
});
