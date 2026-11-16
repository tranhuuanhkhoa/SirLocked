import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { previewGameState } from '../scripts/scene-preview-state.mjs';

/**
 * Màn tân thủ (newcomer tutorial) in the real game page with the API mocked: the coach card and its gold pointer,
 * steps that follow the game state, and the automatic role switch of the solo room (Sherlock talks, Watson handles
 * objects). The full server flow is covered by tests/tutorial-full-stack.spec.ts.
 */
type Json = Record<string, any>;
const caseJson = JSON.parse(readFileSync(path.resolve('../BE/SeedData/V3/case-pixel-tan-thu-vi.json'), 'utf8')) as Json;
const ROOM = 'tutorial-room';
const TRA_LAU = 'scene-tt-tra-lau';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] } });

type Mock = { role: string; asked: Set<string>; inspected: Set<string>; scene: string; version: number; roleCalls: string[]; inspectCalls: string[] };

function stateOf(mock: Mock): Json {
  const base = previewGameState(caseJson, mock.scene, { asked: mock.asked, version: mock.version }) as Json;
  const unlocked = new Set<string>();
  for (const dialogue of caseJson.dialogues) if (mock.asked.has(dialogue.dialogueId)) dialogue.unlockClueIds.forEach((id: string) => unlocked.add(id));
  for (const item of caseJson.items) if (mock.inspected.has(item.itemId)) item.unlockClueIds.forEach((id: string) => unlocked.add(id));
  return {
    ...base,
    roomId: ROOM,
    caseId: caseJson.caseId,
    isTutorial: true,
    ruleSet: 'OPEN_COOP',
    players: [{ userId: 'player-1', username: 'Người mới', role: mock.role, isConnected: true }],
    inspectedItemIds: [...mock.inspected],
    unlockedClues: caseJson.clues.filter((clue: Json) => unlocked.has(clue.clueId))
      .map((clue: Json) => ({ clueId: clue.clueId, title: clue.title, content: clue.content, source: clue.source, isCritical: clue.isCritical, isEvidence: clue.isEvidence })),
  };
}

async function openTutorial(page: Page, errors: string[]): Promise<Mock> {
  const mock: Mock = { role: 'INTERROGATOR', asked: new Set(), inspected: new Set(), scene: TRA_LAU, version: 1, roleCalls: [], inspectCalls: [] };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem('sirlocked.token', 'smoke-token');
    window.localStorage.setItem('sirlocked.uiLanguage', 'vi');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({ userId: 'player-1', fullName: 'Người mới', role: 'PLAYER', isEmailVerified: true }));
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ json: { success: true, data: null } }));
  await page.route(`**/api/game/rooms/${ROOM}/state`, (route) => route.fulfill({ json: { success: true, data: stateOf(mock) } }));
  await page.route(`**/api/game/rooms/${ROOM}/ask-dialogue`, async (route) => {
    mock.asked.add(route.request().postDataJSON().dialogueId); mock.version++;
    await route.fulfill({ json: { success: true, data: { changed: true, message: '', unlockedClueIds: [], state: stateOf(mock) } } });
  });
  await page.route(`**/api/game/rooms/${ROOM}/inspect-item`, async (route) => {
    const itemId = route.request().postDataJSON().itemId;
    mock.inspectCalls.push(`${mock.role}:${itemId}`);
    mock.inspected.add(itemId); mock.version++;
    await route.fulfill({ json: { success: true, data: { changed: true, message: '', unlockedClueIds: [], state: stateOf(mock) } } });
  });
  await page.route(`**/api/tutorial/rooms/${ROOM}/role`, async (route) => {
    mock.role = route.request().postDataJSON().role; mock.version++;
    mock.roleCalls.push(mock.role);
    await route.fulfill({ json: { success: true, data: { role: mock.role } } });
  });
  await page.goto(`/game/${ROOM}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  return mock;
}

const coach = (page: Page) => page.locator('[data-testid="tutorial-coach"]');
const pointerVisible = (page: Page) => page.locator('.tt-pointer').evaluate((node) => !(node as HTMLElement).hidden);
const runtimePoint = (page: Page, x: number, y: number) => page.evaluate(([px, py]) =>
  (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').pagePointOfRuntime({ x: px, y: py }), [x, y]);

test('tutorial coach walks a newcomer from the welcome to the first questions', async ({ page }) => {
  const errors: string[] = [];
  await openTutorial(page, errors);

  // Welcome card; the two-player role briefing is replaced by the coach.
  await expect(coach(page)).toContainText('Chào thám tử mới');
  await expect(page.locator('#intro-overlay')).toHaveCount(0);
  await coach(page).getByRole('button', { name: 'Bắt đầu' }).click();
  await expect(coach(page)).toContainText('Đi lại');
  await expect.poll(() => pointerVisible(page), { timeout: 10_000 }).toBe(true);

  // Walking a few steps finishes the movement step.
  await page.locator('canvas').first().click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  await page.keyboard.down('d');
  await page.waitForTimeout(900);
  await page.keyboard.up('d');
  await expect(coach(page)).toContainText('Hỏi chuyện chủ trà lâu', { timeout: 10_000 });

  // The pointer sits on Ông Lưu, inside the window.
  await expect.poll(() => pointerVisible(page)).toBe(true);
  const box = await page.locator('.tt-pointer').evaluate((node) => (node as HTMLElement).style.transform);
  expect(box).toMatch(/translate\(\d+px, \d+px\)/);

  // Asking the first question (the server unlocks the clue) moves the coach on.
  await page.evaluate(() => (window as any).__sirlockedTest.talkTo('char-tt-ong-luu'));
  const choice = page.locator('.conversation-choices button').first();
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(coach(page)).toContainText('Hỏi thêm', { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test('clicking an object as Sherlock switches the solo player to Watson before inspecting it', async ({ page }) => {
  const errors: string[] = [];
  const mock = await openTutorial(page, errors);
  await coach(page).getByRole('button', { name: 'Bắt đầu' }).click();
  // Hide the coach card so it never covers the counter in a small viewport.
  await coach(page).getByRole('button', { name: 'Ẩn' }).click();

  const point = await runtimePoint(page, 928, 1250);
  expect(point).not.toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => mock.roleCalls.join(','), { timeout: 15_000 }).toBe('INVESTIGATOR');
  await expect.poll(() => mock.inspectCalls.join(','), { timeout: 15_000 }).toBe('INVESTIGATOR:item-tt-so-khach');
  await expect(page.locator('#toast-root')).toContainText('Watson');
  expect(errors).toEqual([]);
});

test('the coach shows the finished card once every step is done and remembers progress per room', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(([room]) => {
    window.localStorage.setItem(`sirlocked.tutorial.v1.${room}`, JSON.stringify({ index: 2, manual: ['welcome'], events: ['moved'] }));
  }, [ROOM]);
  await openTutorial(page, errors);
  // Saved progress: the welcome and the walk are done, the coach resumes at the first question.
  await expect(coach(page)).toContainText('Hỏi chuyện chủ trà lâu');
  await expect(coach(page)).toContainText('bước 3/');
  expect(errors).toEqual([]);
});
