import { expect, test, type Page } from '@playwright/test';

/**
 * Solves the lockpick, torn_paper, fingerprint and reagent_mix kinds in the dev puzzle lab like a player
 * (and fails each once), on desktop (1440×900) and phone (390×844). Needs the API in Development and Vite:
 *   SIRLOCKED_RUN_PUZZLE_LAB=true SIRLOCKED_PLAYWRIGHT_EXTERNAL_SERVER=1 \
 *   SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/puzzle-lab-kinds-a.spec.ts
 */
const enabled = process.env.SIRLOCKED_RUN_PUZZLE_LAB === 'true';
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function openLab(page: Page, kind: string, seed = 1, difficulty = 'EASY') {
  await page.goto(`/puzzle-lab.html?kind=${kind}`);
  await page.waitForSelector('.pz-sheet');
  if (seed !== 1 || difficulty !== 'EASY') {
    await page.evaluate(([s, d]) => {
      (document.getElementById('lab-seed') as HTMLInputElement).value = String(s);
      (document.getElementById('lab-diff') as HTMLSelectElement).value = String(d);
      (document.getElementById('lab-new') as HTMLButtonElement).click();
    }, [seed, difficulty]);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);
  // the lab toolbar sits over the bottom of the sheet on a phone
  await page.addStyleTag({ content: '.lab-bar{opacity:.5;pointer-events:none}' });
}
const status = (page: Page) => page.locator('.pz-status').innerText();
const debug = async (page: Page) => JSON.parse((await page.locator('#lab-debug').textContent()) || '{}');
async function until(fn: () => Promise<unknown>, timeout = 8000) {
  const t0 = Date.now();
  for (;;) { if (await fn()) return; if (Date.now() - t0 > timeout) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 80)); }
}
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => { const s = document.querySelector('.pz-sheet')!; return s.scrollWidth - s.clientWidth; })).toBeLessThanOrEqual(1);
}

test.describe('puzzle lab · P1 lockpick, P2 torn paper, P3 fingerprint, P10 reagent mix', () => {
  test.skip(!enabled, 'Set SIRLOCKED_RUN_PUZZLE_LAB=true with the API (Development) behind Vite.');

  for (const vp of [DESK, PHONE]) {
    const tag = vp.width < 600 ? 'phone' : 'desk';

    test(`lockpick · ${tag}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize(vp);
      await openLab(page, 'lockpick');
      const N = await page.locator('.lp-pip').count();
      const setCount = () => page.locator('.lp-pip.is-on').count();
      const feel = async () => { let f = ''; await until(async () => !/Đang dò/.test((f = await page.locator('[data-lp-feeltx]').innerText()))); return f; };
      const box = (await page.locator('[data-lp-stage]').boundingBox())!;
      const xOf = (pin: number) => box.x + ((140 + ((pin - 1) * 368) / (N - 1)) * box.width) / 800;
      const y0 = box.y + box.height * 0.72;
      await page.click('[data-lp-tension]');
      let failed = false;
      for (let guard = 0; guard < 40 && (await setCount()) < N; guard++) {
        const before = await setCount();
        for (let pin = 1; pin <= N; pin++) {
          await page.mouse.move(xOf(pin), y0);
          await page.mouse.down();
          if (!/Rung nhẹ/.test(await feel())) { await page.mouse.up(); continue; }
          let y = y0;
          while ((await setCount()) === before && y > y0 - 120) { y -= 4; await page.mouse.move(xOf(pin), y); }
          if (!failed) {
            while (!/QUÁ TAY/.test(await status(page)) && y > y0 - 200) { y -= 6; await page.mouse.move(xOf(pin), y); }
            await page.mouse.up();
            expect(await status(page)).toMatch(/QUÁ TAY/);
            await page.screenshot({ path: info.outputPath('lockpick-jam.png') });
            failed = true;
            await page.click('[data-lp-tension]');
            await page.waitForTimeout(900);
            await page.click('[data-lp-tension]');
            break;
          }
          await page.mouse.up();
          break;
        }
      }
      expect(await setCount()).toBe(N);
      await page.click('[data-lp-turn]');
      await expect(page.locator('.pzh-win')).toBeVisible({ timeout: 5000 });
      await page.screenshot({ path: info.outputPath('lockpick-solved.png') });
      await noSideScroll(page);
    });

    test(`torn_paper · ${tag}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize(vp);
      await openLab(page, 'torn_paper', 7);
      const read = () => page.evaluate(() => {
        const board = document.querySelector<HTMLElement>('[data-tp-board]')!;
        const frame = document.querySelector<HTMLElement>('[data-tp-frame]')!;
        const rect = board.getBoundingClientRect();
        const k = rect.width / parseFloat(board.style.width);
        return {
          k, left: rect.left, top: rect.top, fx: parseFloat(frame.style.left), fy: parseFloat(frame.style.top),
          pieces: [...document.querySelectorAll<HTMLElement>('[data-tp-pc]')].map((wrap) => {
            const id = Number(wrap.dataset.tpPc);
            const pts = document.querySelector(`[data-tp-tgt="${id}"]`)!.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number));
            const m = wrap.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) rotate\(([-\d.]+)deg\)/)!;
            return {
              id, placed: wrap.classList.contains('is-placed'), x: +m[1], y: +m[2], rot: +m[3], w: parseFloat(wrap.style.width), h: parseFloat(wrap.style.height),
              bx: Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), by: Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))),
              cx: pts.reduce((s, p) => s + p[0], 0) / pts.length, cy: pts.reduce((s, p) => s + p[1], 0) / pts.length,
            };
          }),
        };
      });
      let failed = false;
      for (let guard = 0; guard < 14; guard++) {
        await page.evaluate(() => { const s = document.querySelector('.pz-sheet')!; s.scrollTop += document.querySelector('[data-tp-board]')!.getBoundingClientRect().top - 60; });
        const st = await read();
        const p = st.pieces.find((q) => !q.placed);
        if (!p) break;
        const flipped = Math.round(p.rot / 180) % 2 !== 0;
        const lx = flipped ? p.w - (p.cx - p.bx) : p.cx - p.bx;
        const ly = flipped ? p.h - (p.cy - p.by) : p.cy - p.by;
        const sx = st.left + (p.x + lx) * st.k;
        const sy = st.top + (p.y + ly) * st.k;
        if (flipped) { await page.mouse.dblclick(sx, sy); await page.waitForTimeout(450); continue; }
        await page.mouse.move(sx, sy);
        await page.mouse.down();
        if (!failed) {
          await page.mouse.move(st.left + (st.fx + 200) * st.k, st.top + (st.fy + 142) * st.k, { steps: 8 });
          await page.mouse.up();
          if (/CHƯA KHỚP/.test(await status(page))) { failed = true; await page.screenshot({ path: info.outputPath('torn-wrong-drop.png') }); }
          continue;
        }
        await page.mouse.move(st.left + (st.fx + p.bx + lx) * st.k, st.top + (st.fy + p.by + ly) * st.k, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(450);
      }
      expect(failed).toBe(true);
      await expect(page.locator('.pzh-win')).toBeVisible({ timeout: 5000 });
      await page.screenshot({ path: info.outputPath('torn-solved.png') });
      await noSideScroll(page);
    });

    test(`fingerprint · ${tag}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize(vp);
      await openLab(page, 'fingerprint');
      const d = await debug(page);
      const correct = d.instance.solution.card;
      const wrong = d.instance.params.cards.find((c: any) => c.id !== correct).id;
      for (let i = 0; i < 14 && !(await page.locator('[data-pp-liftbtn]').isEnabled()); i++) { await page.click('[data-pp-pass]'); await page.waitForTimeout(900); }
      await page.click('[data-pp-liftbtn]');
      await until(async () => !(await page.locator('[data-pp-liftsvg]').evaluate((el) => (el as SVGElement).hidden)), 5000);
      await page.click(`[data-pp-card="${wrong}"]`);
      await until(async () => /KHÔNG KHỚP/.test(await status(page)), 6000);
      await page.screenshot({ path: info.outputPath('fingerprint-no-match.png') });
      await page.click(`[data-pp-card="${correct}"]`);
      await expect(page.locator('.pzh-win')).toBeVisible({ timeout: 6000 });
      await page.screenshot({ path: info.outputPath('fingerprint-match.png') });
      await noSideScroll(page);
    });

    test(`reagent_mix · ${tag}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize(vp);
      await openLab(page, 'reagent_mix');
      const recipe = (await debug(page)).instance.solution.recipe;
      const total = () => page.locator('[data-rg-total]').innerText();
      const add = async (mix: Record<string, number>) => {
        for (const k of ['y', 'b', 'r']) for (let i = 0; i < mix[k]; i++) await page.click(`[data-rg-bt="${k}"]`);
        const n = mix.y + mix.b + mix.r;
        await until(async () => (await total()).startsWith(`${n}/`), 20000);
        await page.waitForTimeout(800);
      };
      await add({ ...recipe, y: recipe.y + 1 });
      await page.click('[data-rg-sweep]');
      await until(async () => /SAI THUỐC/.test(await status(page)), 6000);
      await page.screenshot({ path: info.outputPath('reagent-stained.png') });
      await until(async () => (await page.locator('[data-rg-sweep]').getAttribute('aria-disabled')) === 'false', 5000);
      await page.click('[data-rg-pour]');
      await until(async () => (await total()).startsWith('0/'), 5000);
      await add(recipe);
      expect(await status(page)).toMatch(/KHỚP MẪU/);
      await page.click('[data-rg-sweep]');
      await expect(page.locator('.pzh-win')).toBeVisible({ timeout: 6000 });
      await page.screenshot({ path: info.outputPath('reagent-solved.png') });
      await noSideScroll(page);
    });
  }
});
