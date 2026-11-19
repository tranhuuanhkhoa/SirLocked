import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { previewGameState } from '../scripts/scene-preview-state.mjs';

/**
 * Màn tân thủ (newcomer tutorial) in the real game page with the API mocked: the coach card and its gold pointer,
 * steps that follow the game state, and the hand switch between the two detectives (Sherlock talks, Watson handles
 * objects) that only the tutorial room has. The full server flow is covered by tests/tutorial-full-stack.spec.ts.
 */
type Json = Record<string, any>;
const caseJson = JSON.parse(readFileSync(path.resolve('../BE/SeedData/V3/case-pixel-tan-thu-vi.json'), 'utf8')) as Json;
const ROOM = 'tutorial-room';
const TRA_LAU = 'scene-tt-tra-lau';

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] } });

type Mock = { role: string; asked: Set<string>; inspected: Set<string>; scene: string; version: number; roleCalls: string[]; inspectCalls: string[]; tutorial: boolean };

function stateOf(mock: Mock): Json {
  const base = previewGameState(caseJson, mock.scene, { asked: mock.asked, version: mock.version }) as Json;
  const unlocked = new Set<string>();
  for (const dialogue of caseJson.dialogues) if (mock.asked.has(dialogue.dialogueId)) dialogue.unlockClueIds.forEach((id: string) => unlocked.add(id));
  for (const item of caseJson.items) if (mock.inspected.has(item.itemId)) item.unlockClueIds.forEach((id: string) => unlocked.add(id));
  return {
    ...base,
    roomId: ROOM,
    caseId: caseJson.caseId,
    isTutorial: mock.tutorial,
    ruleSet: 'OPEN_COOP',
    players: [{ userId: 'player-1', username: 'Người mới', role: mock.role, isConnected: true }],
    inspectedItemIds: [...mock.inspected],
    unlockedClues: caseJson.clues.filter((clue: Json) => unlocked.has(clue.clueId))
      .map((clue: Json) => ({ clueId: clue.clueId, title: clue.title, content: clue.content, source: clue.source, isCritical: clue.isCritical, isEvidence: clue.isEvidence })),
  };
}

async function openTutorial(page: Page, errors: string[], tutorial = true): Promise<Mock> {
  const mock: Mock = { role: 'INTERROGATOR', asked: new Set(), inspected: new Set(), scene: TRA_LAU, version: 1, roleCalls: [], inspectCalls: [], tutorial };
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
/** The texture and role of the local detective's sprite in the Phaser scene. */
const localSprite = (page: Page) => page.evaluate(() => {
  const scene = (window as any).__sirlockedGame?.scene?.getScene('SirLockedPhaserScene');
  const sheet = scene?.localPlayer?.getData('pixelSheet');
  return { texture: sheet?.textures?.[0]?.key ?? '', role: scene?.localPose?.role ?? '' };
});
/** The gold pointer stands over the element (its tip is drawn at the top centre of the target). */
const pointerOn = (page: Page, selector: string) => page.evaluate((sel) => {
  const pointer = document.querySelector<HTMLElement>('.tt-pointer');
  const target = document.querySelector<HTMLElement>(sel);
  if (!pointer || pointer.hidden || !target) return false;
  const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(pointer.style.transform);
  if (!match) return false;
  const box = target.getBoundingClientRect();
  return Math.abs(Number(match[1]) - (box.left + box.width / 2)) <= 2 && Math.abs(Number(match[2]) - box.top) <= 2;
}, selector);
const runtimePoint = (page: Page, x: number, y: number) => page.evaluate(([px, py]) =>
  (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').pagePointOfRuntime({ x: px, y: py }), [x, y]);

test('tutorial coach walks a newcomer from the welcome to the first questions', async ({ page }) => {
  const errors: string[] = [];
  await openTutorial(page, errors);

  // Welcome card; the two-player role briefing is replaced by the coach.
  await expect(coach(page)).toContainText('Chào thám tử mới');
  await expect(page.locator('#intro-overlay')).toHaveCount(0);
  await coach(page).getByRole('button', { name: 'Bắt đầu' }).click();

  // The two roles: the pointer sits on the "Đổi nhân vật" tray tool, which only the tutorial has.
  await expect(coach(page)).toContainText('Chơi thử cả hai vai');
  await expect(coach(page)).toContainText('đang là Sherlock');
  await expect(page.locator('#tutorial-role-btn')).toBeVisible();
  await expect.poll(() => pointerOn(page, '#tutorial-role-btn'), { timeout: 10_000 }).toBe(true);
  await coach(page).getByRole('button', { name: 'Tiếp' }).click();
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

test('Sherlock cannot handle objects: the coach points at the switch tool and the player switches by hand (button and Q)', async ({ page }) => {
  const errors: string[] = [];
  // Saved progress: the welcome, the two roles, the walk and the first questions are behind; the guestbook is next.
  await page.addInitScript(([room]) => {
    window.localStorage.setItem(`sirlocked.tutorial.v1.${room}`, JSON.stringify({ index: 5, manual: ['welcome', 'roles'], events: ['moved'] }));
  }, [ROOM]);
  const mock = await openTutorial(page, errors);
  await expect(coach(page)).toContainText('Tìm vật chứng');
  const need = page.locator('[data-testid="tutorial-role-need"]');
  await expect(need).toContainText('Bước này cần Watson (Điều tra viên)');
  await expect.poll(() => pointerOn(page, '#tutorial-role-btn'), { timeout: 10_000 }).toBe(true);
  // Hidden card: the pointer still shows the switch tool, and the card never covers the counter.
  await coach(page).getByRole('button', { name: 'Ẩn' }).click();
  await expect.poll(() => pointerOn(page, '#tutorial-role-btn'), { timeout: 10_000 }).toBe(true);

  // The guestbook as Sherlock: nothing is inspected, nothing switches; the game says who does it.
  const point = await runtimePoint(page, 708, 1314);
  expect(point).not.toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#toast-root')).toContainText('việc của Watson', { timeout: 10_000 });
  await expect(page.locator('#tutorial-role-btn')).toHaveClass(/is-flash/);
  await page.waitForTimeout(600);
  expect(mock.roleCalls).toEqual([]);
  expect(mock.inspectCalls).toEqual([]);
  // The camera key (Z) as Sherlock gives the same answer.
  await page.keyboard.press('z');
  await expect(page.locator('#floating-camera-btn')).toHaveCount(0);

  // The switch tool: Watson now, and the guestbook opens.
  await expect(page.locator('#tutorial-role-btn')).toHaveAttribute('aria-label', 'Đổi sang Watson');
  await page.locator('#tutorial-role-btn').click();
  await expect.poll(() => mock.roleCalls.join(','), { timeout: 15_000 }).toBe('INVESTIGATOR');
  await expect(page.locator('#toast-root')).toContainText('Giờ bạn là Watson');
  await expect(page.locator('#tutorial-role-btn')).toHaveAttribute('aria-label', 'Đổi sang Sherlock');
  await expect(page.locator('#floating-camera-btn')).toBeVisible();
  await coach(page).getByRole('button', { name: 'Hiện' }).click();
  await expect(coach(page)).toContainText('đang là Watson');
  await expect(need).toHaveCount(0);
  await coach(page).getByRole('button', { name: 'Ẩn' }).click();
  // The first click walked Sherlock toward the counter and the camera may have followed: aim again.
  const again = await runtimePoint(page, 708, 1314);
  await page.mouse.click(again.x, again.y);
  await expect.poll(() => mock.inspectCalls.join(','), { timeout: 15_000 }).toBe('INVESTIGATOR:item-tt-so-khach');
  // The detective on screen is Watson now (his own sprite and name tag).
  await expect.poll(() => localSprite(page)).toEqual({ texture: 'pixel-watson96', role: 'INVESTIGATOR' });

  // Watson cannot question people: Ông Lưu answers only Sherlock.
  const askedBefore = mock.asked.size;
  const luu = await runtimePoint(page, 820, 1440);
  await page.mouse.click(luu.x, luu.y);
  await expect(page.locator('#toast-root')).toContainText('việc của Sherlock', { timeout: 10_000 });
  expect(mock.asked.size).toBe(askedBefore);

  // Q switches back to Sherlock.
  await page.keyboard.press('q');
  await expect.poll(() => mock.roleCalls.join(','), { timeout: 15_000 }).toBe('INVESTIGATOR,INTERROGATOR');
  await expect(page.locator('#tutorial-role-btn')).toHaveAttribute('aria-label', 'Đổi sang Watson');
  await expect.poll(() => localSprite(page)).toEqual({ texture: 'pixel-holmes96-normal', role: 'INTERROGATOR' });
  expect(errors).toEqual([]);
});

test('a normal two-player room has no switch tool and Q never switches detective', async ({ page }) => {
  const errors: string[] = [];
  const mock = await openTutorial(page, errors, false);
  const dismiss = page.locator('#intro-dismiss');
  if (await dismiss.isVisible({ timeout: 5_000 }).catch(() => false)) await dismiss.click();
  await expect(page.locator('#bpa-g-tray-main')).toBeVisible();
  await expect(page.locator('#tutorial-role-btn')).toHaveCount(0);
  await expect(coach(page)).toHaveCount(0);
  await page.keyboard.press('q');
  const point = await runtimePoint(page, 708, 1314);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#toast-root')).toContainText('Chỉ Điều tra viên', { timeout: 10_000 });
  await page.waitForTimeout(600);
  expect(mock.roleCalls).toEqual([]);
  expect(mock.inspectCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('the coach shows the finished card once every step is done and remembers progress per room', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(([room]) => {
    window.localStorage.setItem(`sirlocked.tutorial.v1.${room}`, JSON.stringify({ index: 2, manual: ['welcome', 'roles'], events: ['moved'] }));
  }, [ROOM]);
  await openTutorial(page, errors);
  // Saved progress: the welcome, the two roles and the walk are done, the coach resumes at the first question.
  await expect(coach(page)).toContainText('Hỏi chuyện chủ trà lâu');
  await expect(coach(page)).toContainText('bước 4/18');
  expect(errors).toEqual([]);
});

test('the finished card says both detectives were played and real cases keep one role each', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(([room]) => {
    window.localStorage.setItem(`sirlocked.tutorial.v1.${room}`, JSON.stringify({ index: 18, manual: ['welcome', 'roles'], events: ['moved', 'caseFile', 'bag', 'hint', 'camera'] }));
  }, [ROOM]);
  await openTutorial(page, errors);
  await expect(coach(page)).toContainText('Phá án xong!');
  await expect(coach(page)).toContainText('chơi thử cả Sherlock lẫn Watson');
  await expect(coach(page)).toContainText('không đổi được');
  expect(errors).toEqual([]);
});
