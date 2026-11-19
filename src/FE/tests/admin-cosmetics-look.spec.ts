import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * "Đồ có sẵn không được đổi hình": every frame, title and entrance drawn at fixed moments, so two versions of the code
 * can be compared pixel by pixel. Set SIRLOCKED_COSMETICS_LOOK_DIR to a folder, then:
 *   - SIRLOCKED_COSMETICS_LOOK_MODE=before saves the pictures of the code as it is,
 *   - SIRLOCKED_COSMETICS_LOOK_MODE=after draws them again, saves them beside the first set and fails on any difference.
 * The animation clock is the only thing that moves these pictures, and here it stands still.
 */
const dir = process.env.SIRLOCKED_COSMETICS_LOOK_DIR ?? '';
const mode = process.env.SIRLOCKED_COSMETICS_LOOK_MODE ?? '';
// A colour channel may differ this much: scaling a picture is not exactly repeatable between two browser runs.
const CHANNEL_TOLERANCE = 6;

async function open(page: Page) {
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    let fake: number | null = null;
    (window as any).__setNow = (value: number | null) => { fake = value; };
    performance.now = () => fake ?? realNow();
    let seed = 12345;
    Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
  });
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: null }),
  }));
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
}

function save(name: string, data: Buffer) {
  const folder = join(dir, mode);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), data);
}

/** Saves one picture and, on the second run, reports how many pixels moved from the first. */
async function record(page: Page, name: string, data: Buffer, differences: string[]) {
  save(name, data);
  if (mode !== 'after') return;
  const baseline = join(dir, 'before', name);
  if (!existsSync(baseline)) {
    differences.push(`${name}: no picture from before`);
    return;
  }
  const changed = await page.evaluate(async ({ a, b, tolerance }) => {
    const load = async (base64: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    };
    const [before, after] = await Promise.all([load(a), load(b)]);
    if (before.width !== after.width || before.height !== after.height) return -1;
    let count = 0;
    for (let i = 0; i < before.data.length; i += 4) {
      if (Math.abs(before.data[i] - after.data[i]) > tolerance || Math.abs(before.data[i + 1] - after.data[i + 1]) > tolerance
        || Math.abs(before.data[i + 2] - after.data[i + 2]) > tolerance || Math.abs(before.data[i + 3] - after.data[i + 3]) > tolerance) count++;
    }
    return count;
  }, { a: readFileSync(baseline).toString('base64'), b: data.toString('base64'), tolerance: CHANNEL_TOLERANCE });
  if (changed !== 0) differences.push(`${name}: ${changed === -1 ? 'different size' : `${changed} pixels differ`}`);
}

test.describe('the look of what already ships', () => {
  test.skip(!dir || !['before', 'after'].includes(mode), 'Set SIRLOCKED_COSMETICS_LOOK_DIR and SIRLOCKED_COSMETICS_LOOK_MODE.');

  test('frames', async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    const differences: string[] = [];
    const ids: string[] = await page.evaluate(async () => {
      const frames = await import('/Client/js/cosmetics/frames.js' as string);
      return Object.keys(frames.FR).filter((id) => !id.startsWith('__'));
    });
    expect(ids.length).toBeGreaterThanOrEqual(17);
    for (const id of ids) {
      for (const size of [160, 236]) {
        for (const moment of [1.3, 4.7]) {
          const url: string = await page.evaluate(async ({ id, size, moment }) => {
            const frames = await import('/Client/js/cosmetics/frames.js' as string);
            const avatars = await import('/Client/js/cosmetics/avatars.js' as string);
            document.querySelectorAll('[data-look]').forEach((el) => el.remove());
            const canvas = document.createElement('canvas');
            canvas.dataset.look = '1';
            canvas.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px;z-index:99999`;
            canvas.width = size;
            canvas.height = size;
            document.body.append(canvas);
            const paint = () => frames.paintFrame(canvas, id, moment, avatars.avatarImg('nonla'));
            const started = Date.now();
            for (;;) {
              paint();
              const avatar = avatars.avatarImg('nonla');
              if ((frames.frameArtReady(id, canvas.width) && avatar?.naturalWidth > 0) || Date.now() - started > 20000) break;
              await new Promise((resolve) => setTimeout(resolve, 60));
            }
            // Sprites made on demand arrive a little later than the layers.
            for (let i = 0; i < 4; i++) {
              await new Promise((resolve) => setTimeout(resolve, 60));
              paint();
            }
            return canvas.toDataURL('image/png');
          }, { id, size, moment });
          await record(page, `frame-${id}-${size}-${moment}.png`, Buffer.from(url.split(',')[1], 'base64'), differences);
        }
      }
    }
    expect(differences).toEqual([]);
  });

  test('titles', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1100, height: 700 });
    await open(page);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    const differences: string[] = [];
    const ids: string[] = await page.evaluate(async () => {
      const titles = await import('/Client/js/cosmetics/titles.js' as string);
      const index = await import('/Client/js/cosmetics/index.js' as string);
      index.prepareCosmetics();
      await index.whenTitleFontReady();
      return titles.TITLES.map((title: any) => title.id);
    });
    expect(ids.length).toBeGreaterThanOrEqual(25);
    for (const id of ids) {
      for (const bare of [false, true]) {
        await page.evaluate(async ({ id, bare }) => {
          const titles = await import('/Client/js/cosmetics/titles.js' as string);
          document.querySelectorAll('[data-look]').forEach((el) => el.remove());
          const host = document.createElement('div');
          host.dataset.look = '1';
          host.className = 'hs-root';
          host.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:360px;z-index:99999;display:grid;place-items:center;overflow:hidden;border-radius:0;margin:0';
          host.innerHTML = titles.titleHTML(titles.T[id], bare ? { scale: 0.74, bare: true } : { scale: 1.1, maxW: 1060 });
          document.body.append(host);
          host.querySelectorAll('svg.hs-plq').forEach((svg: any) => { svg.pauseAnimations(); svg.setCurrentTime(2.5); });
          await new Promise((resolve) => setTimeout(resolve, 80));
        }, { id, bare });
        const shot = await page.locator('[data-look]').screenshot();
        await record(page, `title-${id}-${bare ? 'bare' : 'full'}.png`, shot, differences);
      }
    }
    expect(differences).toEqual([]);
  });

  test('entrances', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page);
    // The page underneath moves and shows through the stage's dimming, so it is hidden: only the entrance is compared.
    await page.addStyleTag({ content: 'body>*:not(.hs-stage){visibility:hidden!important}body{background:#0a0c11!important}.hs-stage *,.hs-stage *::before,.hs-stage *::after{transition:none!important;animation:none!important}.hs-skip{visibility:hidden}' });
    const differences: string[] = [];
    const ids: string[] = await page.evaluate(async () => {
      const index = await import('/Client/js/cosmetics/index.js' as string);
      index.prepareCosmetics();
      await index.whenTitleFontReady();
      index.warmEntranceArt();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return index.ENTRANCES.map((entrance: any) => entrance.id);
    });
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      for (const moment of [1.6, 3.6]) {
        await page.evaluate(async ({ id, moment }) => {
          const stage = await import('/Client/js/cosmetics/stage.js' as string);
          const avatars = await import('/Client/js/cosmetics/avatars.js' as string);
          const frames = await import('/Client/js/cosmetics/frames.js' as string);
          (window as any).__setNow(1_000_000);
          stage.openStage(id, { name: 'Thám tử mẫu', frameId: 'kimlong', titleId: 'kim-long', avatar: () => avatars.avatarImg('nonla') });
          (window as any).__setNow(1_000_000 + moment * 1000);
          // Painted art and sprites arrive when they arrive, each new one asked for by a paint: wait until nothing is
          // missing any more. The clock stays put meanwhile, so what is on screen does not change.
          frames.picImg('rong-bay');
          frames.picImg('phuong-xoe');
          frames.picImg('kiem');
          const { IMG } = await import('/Client/js/cosmetics/lib.js' as string);
          const started = Date.now();
          let settled = 0;
          while (settled < 4 && Date.now() - started < 30000) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            settled = [...IMG.values()].every((image: any) => image.complete) ? settled + 1 : 0;
          }
        }, { id, moment });
        const shot = await page.screenshot();
        await record(page, `entrance-${id}-${moment}.png`, shot, differences);
        await page.evaluate(async () => {
          const stage = await import('/Client/js/cosmetics/stage.js' as string);
          stage.closeStage(true);
          await new Promise((resolve) => setTimeout(resolve, 60));
        });
      }
    }
    expect(differences).toEqual([]);
  });
});
