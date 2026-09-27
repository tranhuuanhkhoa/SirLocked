import { expect, test, type Page } from '@playwright/test';

const baseCase = {
  caseId: 'case-v3-ai',
  title: 'The Resealed Packet',
  summary: 'A generated V3 contradiction sandbox.',
  language: 'en',
  status: 'DRAFT',
  mechanicsVersion: 3,
  generationMode: 'CAMERA_EMBEDDED',
  generationPreset: 'NORMAL_RANDOM',
  aiSemanticReviewStatus: 'PASSED',
  hasSourceAiDraft: true,
  sourceAiDraftId: 'draft-v3-source',
  estimatedMinutes: 10,
  stageCount: 4,
  sceneCount: 4,
  clueCount: 10,
  stages: [],
  characters: [],
  items: [],
  clues: [],
  dialogues: [],
  evidenceChallenges: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('sirlocked.token', 'admin-v3-gate-token');
    window.localStorage.setItem('sirlocked.uiLanguage', 'en');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({
      userId: 'admin-1',
      fullName: 'Admin Gate',
      role: 'ADMIN',
      isEmailVerified: true,
    }));
  });
});

test('admin case list shows V3 metadata and blocks publish when gameplay V3 is disabled', async ({ page }) => {
  await routeCapabilities(page, false);
  await page.route('**/api/admin/cases', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope([baseCase]) });
  });

  await page.goto('/#/admin/cases');

  await expect(page.getByText('V3 · Crack')).toBeVisible();
  await expect(page.getByText('Review PASSED')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish blocked' })).toBeDisabled();
  await expect(page.locator('.v3-gate-reason')).toContainText('Gameplay V3 feature flag');
});

test('admin case detail exposes every publish gate and deterministic errors', async ({ page }) => {
  await routeCapabilities(page, true);
  await page.route('**/api/admin/cases/case-v3-ai', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope(baseCase) });
  });
  await page.route('**/api/admin/cases/validate', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: envelope({
        isValid: false,
        errors: [{ code: 'PresetContract', path: 'evidenceChallenges[0]', message: 'Candidate matrix is incomplete.' }],
      }),
    });
  });

  await page.goto('/#/admin/cases/case-v3-ai');

  await expect(page.getByRole('heading', { name: 'V3 case profile' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Publish gate' })).toBeVisible();
  await expect(page.locator('.v3-gate-fail').filter({ hasText: 'Deterministic validation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish blocked' })).toBeDisabled();
  await expect(page.locator('#validation-output')).toContainText('PresetContract');
  await expect(page.locator('#validation-output')).toContainText('Candidate matrix is incomplete.');
});

test('admin case detail enables publish only when every V3 gate passes', async ({ page }) => {
  await routeCapabilities(page, true);
  await page.route('**/api/admin/cases/case-v3-ai', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope(baseCase) });
  });
  await page.route('**/api/admin/cases/validate', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({ isValid: true, errors: [] }) });
  });
  await page.route('**/api/admin/cases/case-v3-ai/publish', async (route) => {
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({
      success: false,
      message: 'V3 gameplay was disabled after the page loaded.',
      errors: { code: 'V3_NOT_ENABLED', messageKey: 'game.confrontation.disabled' },
    }) });
  });

  await page.goto('/#/admin/cases/case-v3-ai');

  await expect(page.locator('.v3-publish-gate')).toContainText('READY');
  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.locator('#validation-output')).toContainText('V3_NOT_ENABLED');
  await expect(page.locator('#validation-output')).toContainText('game.confrontation.disabled');
});

async function routeCapabilities(page: Page, gameplayV3Enabled: boolean) {
  await page.route('**/api/admin/ai-cases/capabilities', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: envelope({
      aiCaseV3PresetEnabled: true,
      gameplayV3Enabled,
      canCreateV3Draft: true,
      canPublishV3: gameplayV3Enabled,
    }) });
  });
}

function envelope(data: unknown) {
  return JSON.stringify({ success: true, data });
}
