/**
 * Both detectives in Chromium, using the repository's own Playwright (src/FE/node_modules): screenshots of
 * every scene each role reaches, console errors, page errors and failed asset requests.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PlaytestScreenshot } from './types.js';
import type { Role } from './solver.js';

export interface PlayerSession {
  role: Role;
  auth: { token: string; refreshToken: string; refreshTokenExpiry: string; user: unknown };
}

const ASSET = /\.(png|jpe?g|webp|gif|svg|js|mjs|css|ogg|mp3|wav|m4a|woff2?|ttf)(\?|$)/i;

export function loadPlaywright(repoRoot: string): any {
  const require = createRequire(path.join(repoRoot, 'src', 'FE', 'package.json'));
  try {
    return require('@playwright/test');
  } catch {
    return require('playwright');
  }
}

/**
 * First visit of a room: the opening motion comic (when the case has one), then the role briefing, then the
 * investigation. Skips the comic with the real gesture (hold Esc) and closes the briefing.
 */
async function enterInvestigation(page: any): Promise<{ ok: boolean; comic: boolean }> {
  const deadline = Date.now() + 75_000;
  let comic = false;
  let skipped = 0;
  while (Date.now() < deadline) {
    const dismiss = page.locator('#intro-dismiss');
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click().catch(() => undefined);
      await page.waitForTimeout(500);
      if (!(await dismiss.isVisible().catch(() => false))) return { ok: true, comic };
      continue;
    }
    const finish = page.locator('[data-mc-finish]');
    if (await finish.isVisible().catch(() => false)) {
      await finish.click().catch(() => undefined);
      await page.waitForTimeout(500);
      continue;
    }
    if (await page.locator('.mc-root').isVisible().catch(() => false)) {
      comic = true;
      if (skipped < 4) {
        skipped++;
        await page.keyboard.down('Escape');
        await page.waitForTimeout(1200);
        await page.keyboard.up('Escape');
        // Jump to the title card so the finish button shows (as tests/cutscene-flow.spec.ts does).
        await page.evaluate(() => {
          const comicApi = (globalThis as any).__motionComic;
          const start = comicApi?.timeline?.titleStart;
          if (typeof start === 'number' && typeof comicApi.seek === 'function') comicApi.seek(start + 4.6);
        }).catch(() => undefined);
      }
    }
    await page.waitForTimeout(500);
  }
  return { ok: false, comic };
}

export class PlayerScreens {
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly failedRequests: string[] = [];
  /** API calls the game page itself made that the server refused (method, path, status). */
  readonly apiErrors: string[] = [];
  readonly screenshots: PlaytestScreenshot[] = [];
  readonly notes: string[] = [];
  private readonly lastScene = new Map<Role, string>();
  private counter = 0;

  private constructor(
    private readonly browser: any,
    private readonly pages: Map<Role, any>,
    private readonly outDir: string,
    private readonly log: (line: string) => void,
  ) {}

  static async open(options: {
    repoRoot: string; webUrl: string; roomId: string; players: PlayerSession[];
    outDir: string; headless: boolean; log: (line: string) => void;
  }): Promise<PlayerScreens> {
    const { chromium } = loadPlaywright(options.repoRoot);
    const browser = await chromium.launch({ headless: options.headless });
    mkdirSync(options.outDir, { recursive: true });
    const screens = new PlayerScreens(browser, new Map(), options.outDir, options.log);
    try {
      for (const player of options.players) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', baseURL: options.webUrl });
        const page = await context.newPage();
        const tag = player.role === 'INVESTIGATOR' ? 'inv' : 'int';
        page.on('console', (message: any) => {
          if (message.type() !== 'error') return;
          let where = '';
          try {
            const url = message.location()?.url;
            if (url) where = ` <${new URL(url).pathname}>`;
          } catch { /* no location */ }
          screens.consoleErrors.push(`[${tag}] ${message.text().slice(0, 500)}${where}`);
        });
        page.on('pageerror', (error: any) => screens.pageErrors.push(`[${tag}] ${String(error?.message ?? error).slice(0, 500)}`));
        page.on('response', (response: any) => {
          if (response.status() < 400) return;
          const pathname = new URL(response.url()).pathname;
          if (ASSET.test(response.url())) screens.failedRequests.push(`[${tag}] ${response.status()} ${pathname}`);
          else if (pathname.startsWith('/api/')) screens.apiErrors.push(`[${tag}] ${response.status()} ${response.request().method()} ${pathname}`);
        });
        page.on('requestfailed', (request: any) => {
          const failure = request.failure()?.errorText ?? '';
          if (ASSET.test(request.url()) && !/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure)) {
            screens.failedRequests.push(`[${tag}] ${failure} ${new URL(request.url()).pathname}`);
          }
        });
        await page.addInitScript(({ auth }: { auth: PlayerSession['auth'] }) => {
          (globalThis as any).localStorage.setItem('sirlocked.token', auth.token);
          (globalThis as any).localStorage.setItem('sirlocked.refreshToken', auth.refreshToken);
          (globalThis as any).localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
          (globalThis as any).localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
          (globalThis as any).localStorage.setItem('sirlocked.uiLanguage', 'vi');
        }, { auth: player.auth });
        await page.goto(`/game/${options.roomId}`);
        const entered = await enterInvestigation(page);
        if (entered.comic) screens.notes.push(`[${tag}] Có cutscene mở đầu: đã giữ Esc để bỏ qua như người chơi.`);
        if (!entered.ok) screens.notes.push(`[${tag}] Không vào được màn điều tra (#intro-dismiss) trong 75 s.`);
        screens.pages.set(player.role, page);
      }
    } catch (error) {
      await screens.close();
      throw error;
    }
    return screens;
  }

  /** The scene the game canvas shows for a role, or null when the renderer is not ready. */
  async visibleScene(role: Role): Promise<string | null> {
    const page = this.pages.get(role);
    if (!page) return null;
    try {
      return await page.evaluate(() => {
        const scene = (globalThis as any).__sirlockedGame?.scene?.getScene('SirLockedPhaserScene');
        return scene?.state?.visibleScene?.sceneId ?? null;
      });
    } catch {
      return null;
    }
  }

  private async settle(page: any): Promise<void> {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const ready = await page.evaluate(() => {
        const scene = (globalThis as any).__sirlockedGame?.scene?.getScene('SirLockedPhaserScene');
        if (!scene) return true;
        const loading = typeof scene.load?.isLoading === 'function' ? scene.load.isLoading() : false;
        return Boolean(scene.sceneInteractionEnabled) && !loading;
      }).catch(() => true);
      if (ready) break;
      await page.waitForTimeout(300);
    }
    // The travel card between rooms (.bpa-g-tr, about 2.5 s) covers the scene: wait until it is gone.
    await page.waitForFunction(() => !(globalThis as any).document.querySelector('.bpa-g-tr, .bpa-g-tr-shot'), null, { timeout: 8000 })
      .catch(() => undefined);
    await page.waitForTimeout(500);
  }

  /**
   * Waits until the role's canvas shows the expected scene (after an API move), then captures it once per
   * scene and role. A UI that does not follow within the timeout is noted, not fatal.
   */
  async sync(role: Role, expectedSceneId: string, timeoutMs = 15_000): Promise<void> {
    const page = this.pages.get(role);
    if (!page || this.lastScene.get(role) === expectedSceneId) return;
    const deadline = Date.now() + timeoutMs;
    let shown = await this.visibleScene(role);
    while (shown !== expectedSceneId && Date.now() < deadline) {
      await page.waitForTimeout(400);
      shown = await this.visibleScene(role);
    }
    if (shown !== expectedSceneId) {
      this.notes.push(`[${role}] Giao diện chưa chuyển sang ${expectedSceneId} sau ${Math.round(timeoutMs / 1000)} s (đang ở ${shown ?? 'không rõ'}).`);
      return;
    }
    await this.capture(role, expectedSceneId);
  }

  async capture(role: Role, sceneId: string, suffix = ''): Promise<void> {
    const page = this.pages.get(role);
    if (!page) return;
    await this.settle(page);
    const name = `${String(++this.counter).padStart(2, '0')}-${role === 'INVESTIGATOR' ? 'inv' : 'int'}-${sceneId}${suffix}.png`
      .replace(/[^a-zA-Z0-9._-]/g, '-');
    const file = path.join(this.outDir, name);
    try {
      await page.screenshot({ path: file });
      this.screenshots.push({ sceneId, role, file });
      this.lastScene.set(role, sceneId);
      this.log(`screenshot ${name}`);
    } catch (error) {
      this.notes.push(`[${role}] Chụp ${sceneId} lỗi: ${String((error as Error).message).slice(0, 200)}`);
    }
  }

  /** Last picture (the result page after the accusation). */
  async finalShot(role: Role, label: string): Promise<void> {
    const page = this.pages.get(role);
    if (!page) return;
    try {
      await page.waitForURL(/\/result\//, { timeout: 30_000 });
    } catch {
      this.notes.push(`[${role}] Không tới trang kết quả /result/ trong 30 s.`);
    }
    await page.waitForTimeout(1500);
    const name = `${String(++this.counter).padStart(2, '0')}-${role === 'INVESTIGATOR' ? 'inv' : 'int'}-${label}.png`;
    const file = path.join(this.outDir, name);
    try {
      await page.screenshot({ path: file, fullPage: true });
      this.screenshots.push({ sceneId: label, role, file });
    } catch (error) {
      this.notes.push(`[${role}] Chụp ${label} lỗi: ${String((error as Error).message).slice(0, 200)}`);
    }
  }

  async close(): Promise<void> {
    try { await this.browser.close(); } catch { /* already closed */ }
  }
}
