import { expect, test, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { roomId } from './helpers/smokeState';
import { previewGameState } from '../scripts/scene-preview-state.mjs';

/**
 * Outfits in the real game page (API mocked): the Whitechapel Sherlock with his lantern at night and without it by
 * day, the signature moves with their effects, Watson's plague-doctor look, and the normal look whenever the market
 * says nothing (or fails). Scenes come from the pixel case copy in tests/fixtures/case-pixel-thoi-tiet-thu-vi.json;
 * one of its scenes is turned to DAY here.
 */
type Json = Record<string, any>;
const weatherCase = JSON.parse(readFileSync(path.resolve('tests/fixtures/case-pixel-thoi-tiet-thu-vi.json'), 'utf8')) as Json;
const NIGHT_STREET = 'scene-px-pho';
const DAY_GARAGE = 'scene-px-nha-xe';
const DUSK_HOUSE = 'scene-px-nha-so-7';
const SHOTS = process.env.SKIN_SHOTS_DIR;

function caseWithDayGarage(): Json {
  const copy = structuredClone(weatherCase);
  for (const stage of copy.stages ?? []) {
    for (const scene of stage.scenes ?? []) {
      if (scene.sceneId === DAY_GARAGE) scene.runtime = { ...scene.runtime, timeOfDay: 'DAY', weather: { type: 'NONE', intensity: 0 } };
      if (scene.sceneId === DUSK_HOUSE) scene.runtime = { ...scene.runtime, timeOfDay: 'DUSK' };
    }
  }
  return copy;
}

const SHERLOCK_OUTFIT = { category: 'SKIN_SHERLOCK', itemId: 'it-1', def: { id: 'skin_sherlock_whitechapel', category: 'SKIN_SHERLOCK', rarity: 'LEGENDARY' } };
const WATSON_OUTFIT = { category: 'SKIN_WATSON', itemId: 'it-2', def: { id: 'skin_watson_whitechapel', category: 'SKIN_WATSON', rarity: 'LEGENDARY' } };
const FRAME = { category: 'FRAME', itemId: 'it-3', def: { id: 'frame_kimlong', category: 'FRAME', rarity: 'EPIC' } };

type Options = { me?: 'player-1' | 'player-2'; firstScene?: string; equipped?: (userId: string) => unknown[] | 'fail' };

async function openGame(page: Page, errors: string[], { me = 'player-1', firstScene = NIGHT_STREET, equipped = () => [] }: Options = {}) {
  const caseJson = caseWithDayGarage();
  let current = firstScene;
  let version = 1;
  const asked: string[] = [];
  const state = () => previewGameState(caseJson, current, { asked: new Set(), version }) as Json;
  // Web fonts and other outside hosts may be unreachable where tests run; that is not this feature's error.
  page.on('console', (message) => { if (message.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(message.text())) errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(([id, userId]) => {
    window.localStorage.setItem('sirlocked.token', 'smoke-token');
    window.localStorage.setItem('sirlocked.uiLanguage', 'vi');
    window.localStorage.setItem('sirlocked.user', JSON.stringify({ userId, fullName: 'Thám tử', role: 'PLAYER', isEmailVerified: true }));
    window.sessionStorage.setItem(`sirlocked.intro.${id}`, '1');
    (window as unknown as { __sirlockedNoSignalR?: boolean }).__sirlockedNoSignalR = true;
  }, [roomId, me]);
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({ json: { success: true, data: null } }));
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: state() } }));
  await page.route(`**/api/game/rooms/${roomId}/go-to-scene`, async (route) => {
    current = route.request().postDataJSON().sceneId; version++;
    await route.fulfill({ json: { success: true, data: { changed: true, message: '', unlockedClueIds: [], state: state() } } });
  });
  await page.route('**/api/market/equipped/*', async (route) => {
    const userId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    asked.push(userId);
    const answer = equipped(userId);
    if (answer === 'fail') await route.fulfill({ status: 500, json: { success: false, message: 'boom', data: null } });
    else await route.fulfill({ json: { success: true, data: answer } });
  });
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('canvas').first()).toBeVisible();
  return { asked, goTo: (sceneId: string) => { current = sceneId; } };
}

/** Both Sherlock sheets are in and nothing else is loading, so no redraw wipes an effect mid-test. */
const settled = (page: Page) => page.evaluate(() => {
  const scene = (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene');
  return !scene.load.isLoading() && ['skin-whitechapel-sherlock-day', 'skin-whitechapel-sherlock-night'].every((key) => scene.textures.exists(key));
});

/** Texture and lantern together: right after a redraw the new container gets its light on the next frame. */
const lookOf = async (page: Page, userId: string) => {
  const look = await myLook(page, userId);
  return look ? `${look.texture}${look.lantern ? '+lantern' : ''}` : null;
};

const looks = (page: Page) => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').playerLooks());
const myLook = async (page: Page, userId: string) => (await looks(page)).find((look: any) => look.userId === userId);

/** The partner walked both detectives into another scene: the new state reaches the Phaser scene. */
async function enterScene(page: Page, sceneId: string) {
  const next = previewGameState(caseWithDayGarage(), sceneId, { asked: new Set(), version: 50 }) as Json;
  await page.evaluate((state) => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').updateGameState(state, null), next);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.locator('canvas').first().screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

test('at night the Whitechapel Sherlock carries his lantern, and its light', async ({ page }) => {
  const errors: string[] = [];
  const { asked } = await openGame(page, errors, { equipped: (userId) => (userId === 'player-1' ? [FRAME, SHERLOCK_OUTFIT] : []) });

  await expect.poll(() => lookOf(page, 'player-1'), { timeout: 15_000 }).toBe('skin-whitechapel-sherlock-night+lantern');
  const look = await myLook(page, 'player-1');
  expect(look.signatureEffect).toBe('footprints');
  expect(asked).toContain('player-1');
  expect(asked.filter((id) => id === 'player-1')).toHaveLength(1);
  await shot(page, '1-sherlock-dem');
  expect(errors).toEqual([]);
});

test('in a day scene the lantern is put away; it is lit again at dusk and at night', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, errors, { firstScene: DAY_GARAGE, equipped: () => [SHERLOCK_OUTFIT] });

  await expect.poll(() => lookOf(page, 'player-1'), { timeout: 15_000 }).toBe('skin-whitechapel-sherlock-day');
  await shot(page, '2-sherlock-ngay');

  await enterScene(page, DUSK_HOUSE);
  await expect.poll(() => lookOf(page, 'player-1'), { timeout: 15_000 }).toBe('skin-whitechapel-sherlock-night+lantern');
  await enterScene(page, DAY_GARAGE);
  await expect.poll(() => lookOf(page, 'player-1'), { timeout: 15_000 }).toBe('skin-whitechapel-sherlock-day');
  await enterScene(page, NIGHT_STREET);
  await expect.poll(() => lookOf(page, 'player-1'), { timeout: 15_000 }).toBe('skin-whitechapel-sherlock-night+lantern');
  expect(errors).toEqual([]);
});

test('standing still, Sherlock raises his magnifier and glowing footprints appear', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, errors, { equipped: () => [SHERLOCK_OUTFIT] });
  await expect.poll(async () => (await myLook(page, 'player-1'))?.texture, { timeout: 15_000 }).toBe('skin-whitechapel-sherlock-night');
  await expect.poll(() => settled(page), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(300);

  await page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').idleLongerSoon());
  await expect.poll(async () => (await myLook(page, 'player-1'))?.action, { timeout: 5_000 }).toBe('signature');
  // Footprints: ellipses the effect adds to the scene, gone again once it ends.
  const prints = () => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').children.list
    .filter((child: any) => child.type === 'Ellipse' && child.fillColor === 0xfff2c4).length);
  await expect.poll(prints, { timeout: 5_000 }).toBe(6);
  await page.waitForTimeout(1200);
  await shot(page, '3-sherlock-chieu-kinh-lup');
  await expect.poll(async () => (await myLook(page, 'player-1'))?.action, { timeout: 5_000 }).toBe('idle');
  await expect.poll(prints, { timeout: 6_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('the Whitechapel Watson shakes a potion and herbal smoke rises from the mask', async ({ page }) => {
  const errors: string[] = [];
  await openGame(page, errors, { me: 'player-2', equipped: (userId) => (userId === 'player-2' ? [WATSON_OUTFIT] : []) });

  await expect.poll(() => lookOf(page, 'player-2'), { timeout: 15_000 }).toBe('skin-whitechapel-watson');
  await shot(page, '4-watson');
  const before = await page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').children.list.length);
  await page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').idleLongerSoon());
  await expect.poll(async () => (await myLook(page, 'player-2'))?.action, { timeout: 5_000 }).toBe('signature');
  await expect.poll(() => page.evaluate(() => (window as any).__sirlockedGame.scene.getScene('SirLockedPhaserScene').children.list.length), { timeout: 3_000 })
    .toBeGreaterThanOrEqual(before + 5);
  await page.waitForTimeout(1100);
  await shot(page, '5-watson-khoi-thao-duoc');
  expect(errors).toEqual([]);
});

test('no outfit, the other detective\'s outfit, or a failed answer: the normal look', async ({ page }) => {
  const errors: string[] = [];
  // Player 1 plays Sherlock but owns only the Watson outfit.
  await openGame(page, errors, { equipped: (userId) => (userId === 'player-1' ? [WATSON_OUTFIT] : 'fail') });
  await page.waitForTimeout(1500);
  const look = await myLook(page, 'player-1');
  expect(look.texture).toBe('pixel-holmes96-normal');
  expect(look.lantern).toBe(false);
  // The failed answer for player 2 is only logged by the browser as a failed request, never thrown.
  expect(errors.filter((error) => !/500|Failed to load resource/.test(error))).toEqual([]);
});

test('the market lists both outfits under their own categories, with their icons', async ({ page }) => {
  await page.goto('/');
  const labels = await page.evaluate(async () => {
    const kit = await import('/Client/js/pages/market/marketKit.js');
    const icon = kit.itemIcon({ id: 'skin_sherlock_whitechapel', category: 'SKIN_SHERLOCK', rarity: 'LEGENDARY', name: 'Sherlock · Kẻ Săn Bóng Đêm',
      visual: { imageUrl: '/assets/pixel/skins/whitechapel/icon-sherlock.png' } }, 34);
    const loads = await Promise.all(['icon-sherlock.png', 'icon-watson.png', 'sherlock-night.png', 'sherlock-day.png', 'watson.png']
      .map((file) => fetch(`/assets/pixel/skins/whitechapel/${file}`).then((response) => response.status)));
    return { all: kit.CATEGORIES, sherlock: kit.categoryLabel('SKIN_SHERLOCK'), watson: kit.categoryLabel('SKIN_WATSON'), equip: kit.isEquippable('SKIN_WATSON'), icon, loads };
  });
  expect(labels.icon).toContain('src="/assets/pixel/skins/whitechapel/icon-sherlock.png"');
  expect(labels.loads).toEqual([200, 200, 200, 200, 200]);
  expect(labels.all).toEqual(expect.arrayContaining(['SKIN_SHERLOCK', 'SKIN_WATSON']));
  expect(labels.sherlock).toMatch(/Sherlock/);
  expect(labels.watson).toMatch(/Watson/);
  expect(labels.equip).toBe(true);
});
