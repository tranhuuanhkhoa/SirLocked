import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Manual helper, not part of the normal run: renders frames of the opening comic for both pixel cases so a person can
// review how the engine looks. Run with CUTSCENE_CAPTURE=1. The script text is a generic placeholder (no AI is called).
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.CUTSCENE_CAPTURE_DIR ?? path.resolve(here, '../test-results/cutscene-frames');

for (const file of ['case-pixel-tram-hong-ngoc-vi.json', 'case-pixel-lo-thuoc-thu-nam-vi.json']) {
  test(`capture frames: ${file}`, async ({ page }) => {
    test.skip(process.env.CUTSCENE_CAPTURE !== '1', 'manual capture only');
    test.setTimeout(120_000);
    const data = JSON.parse(readFileSync(path.resolve(here, '../../BE/SeedData/V3', file), 'utf8'));
    const scenes = data.stages.flatMap((s: any) => s.scenes).filter((s: any) => s.backgroundUrl);
    const lines = ['Một buổi sáng nặng nề đè lên cả con phố này.', 'Mọi thứ trông bình thường, trừ một chi tiết lạ.', 'Có người đã nhìn thấy điều không nên thấy.',
      'Tôi chưa biết ai nói thật, và ai đang giấu.', 'Càng nhìn gần, mọi chuyện càng khó hiểu.', 'Còn một việc cuối cùng: bước vào và điều tra.'];
    let n = 0;
    const page3 = (layout: string, count: number) => ({
      layout,
      panels: Array.from({ length: count }, () => {
        const scene = scenes[n % scenes.length];
        const i = n++;
        return {
          art: { kind: 'scene', id: scene.sceneId, focus: [0.05, 0.1, 0.9, 0.8] }, weather: ['rain', 'fog', 'streetlight'][i % 3], enter: ['top', 'left', 'right', 'bottom'][i % 4],
          beats: [{ type: 'caption', text: `${scene.title}. ${lines[i % lines.length]}` }, { type: 'sfx', text: i % 2 ? 'ẦM!!' : 'CẠCH.', style: i % 2 ? 'impact' : 'soft' }], audio: [],
        };
      }),
    });
    const cutscene = {
      caseId: data.caseId, trigger: 'INTRO', version: 1,
      script: { format: 'motion-comic-v1', caseId: data.caseId, language: 'vi', title: { eyebrow: 'Hồ sơ 01', title: data.title, subtitle: 'Hai thám tử, một buổi sáng.' }, mood: 'rain-night',
        pages: [page3('wide-top-two-bottom', 3), page3('three-strips', 3), page3('splash-inset', 2)] },
      assets: {
        scenes: Object.fromEntries(scenes.map((s: any) => [s.sceneId, { title: s.title, url: s.backgroundUrl }])),
        characters: {}, items: {}, coverUrl: data.coverImageUrl,
      },
    };
    mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      localStorage.setItem('sirlocked.uiLanguage', 'vi');
      localStorage.setItem('sirlocked.audio.v1', JSON.stringify({ music: 0.2, effects: 0.35, muted: true }));
    });
    await page.goto('/login');
    await page.evaluate(async (c) => {
      const player = '/Client/js/game/cutscene/motionComic.ts';
      const settings = '/Client/js/game/cutscene/audioSettings.ts';
      const { playMotionComic } = await import(/* @vite-ignore */ player);
      const { storedAudioSettings } = await import(/* @vite-ignore */ settings);
      await playMotionComic({ cutscene: c, audio: storedAudioSettings(), finishLabel: 'Vào điều tra', onDone: () => {} });
    }, cutscene);
    await expect.poll(() => page.evaluate(() => (window as any).__motionComic?.state)).toBe('playing');
    const beats: { start: number; text: string }[] = await page.evaluate(() => (window as any).__motionComic.timeline.beats);
    const titleStart: number = await page.evaluate(() => (window as any).__motionComic.timeline.titleStart);
    const picks = [beats[0], beats[2], beats[4], beats[8], beats[12]].filter(Boolean);
    let k = 1;
    for (const beat of picks) {
      await page.evaluate((t) => (window as any).__motionComic.seek(t), beat.start + 2.2);
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(outDir, `${data.caseId}-${String(k++).padStart(2, '0')}.png`) });
    }
    await page.evaluate((t) => (window as any).__motionComic.seek(t), titleStart + 3.4);
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(outDir, `${data.caseId}-${String(k++).padStart(2, '0')}-title.png`) });
  });
}
