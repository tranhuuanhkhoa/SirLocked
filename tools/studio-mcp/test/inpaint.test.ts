import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { inpaintCost, inpaintInputs, isTightMask, maskBounds, mergeInpaint, paintedPlacement, planInpaint, sceneMask } from '../src/image/inpaint.js';
import { crop, encode, loadRgba } from '../src/image/raster.js';
import { assetProcess, assetVariant, PROCESS_OPS } from '../src/tools/assets.js';
import { paint, pixel, realRepoRoot, tempRepo, testContext } from './helpers.js';

/**
 * Items are painted into pixel scenes by PixelLab (Yen, 17/11/2026), never pasted: inpaint_prep cuts what to send,
 * inpaint_merge copies only the mask back, and compose refuses to paste a picture.
 */
const scene = () => paint(512, 512, (x, y) => [(x * 3) % 200, (y * 5) % 200, 90, 255]);

describe('inpaint plan', () => {
  test('a small object gets a 128 canvas centred on it, a 3x context and the source box inside it', () => {
    const plan = planInpaint(512, 512, { x0: 322, y0: 210, x1: 341, y1: 225 });
    assert.deepEqual(plan.crop, { x: 268, y: 154, width: 128, height: 128 });
    assert.deepEqual(plan.mask, { x: 54, y: 56, width: 20, height: 16 });
    assert.deepEqual(plan.context, { x: 128, y: 26, width: 384, height: 384 });
    assert.deepEqual(plan.boundingBox, { x: 140, y: 128, width: 128, height: 128 });
  });

  test('the canvas stays inside the scene near an edge, a bigger surface takes 256, a very wide one the whole 512', () => {
    const corner = planInpaint(512, 512, { x0: 2, y0: 500, x1: 12, y1: 511 });
    assert.deepEqual(corner.crop, { x: 0, y: 384, width: 128, height: 128 });
    assert.deepEqual(corner.mask, { x: 2, y: 116, width: 11, height: 12 });
    const big = planInpaint(512, 512, { x0: 100, y0: 100, x1: 189, y1: 160 });
    assert.equal(big.crop.width, 256);
    // A 256 canvas: the context is the whole 512 scene (3x would be 768).
    assert.deepEqual(big.context, { x: 0, y: 0, width: 512, height: 512 });
    // Wider than 208: the whole 512 scene is the canvas (inpaint_image 25, Tier 2).
    assert.deepEqual(planInpaint(512, 512, { x0: 0, y0: 0, x1: 300, y1: 40 }).crop, { x: 0, y: 0, width: 512, height: 512 });
    assert.throws(() => planInpaint(1024, 1024, { x0: 0, y0: 0, x1: 700, y1: 40 }), /quá to/);
  });

  test('cost follows the PixelLab price notes (canvas, not mask)', () => {
    assert.equal(inpaintCost('inpaint_image_pro_flash', 128), 6);
    assert.equal(inpaintCost('inpaint_image_pro_flash', 256), 9);
    assert.equal(inpaintCost('inpaint_image', 128), 10);
    assert.equal(inpaintCost('inpaint_image', 256), 10);
    assert.equal(inpaintCost('inpaint_image', 512), 25);
  });

  test('a free-form mask follows the surface: polygons, rectangles or a painted mask picture, pixel centres inside', () => {
    // A slanted counter top (isometric), like the tea-house counter of the tutorial.
    const counter: [number, number][] = [[113, 314], [157, 305], [203, 296], [243, 305], [252, 316], [250, 322], [157, 361], [114, 340]];
    const mask = sceneMask(512, 512, { polygons: [counter] });
    const bounds = maskBounds(mask, 512)!;
    assert.deepEqual(bounds, { x: 113, y: 296, width: 139, height: 65 });
    assert.equal(isTightMask(bounds), false);
    assert.equal(mask[330 * 512 + 180], 1, 'middle of the counter top');
    assert.equal(mask[300 * 512 + 120], 0, 'inside the box but off the slanted top');
    const plan = planInpaint(512, 512, { x0: bounds.x, y0: bounds.y, x1: bounds.x + bounds.width - 1, y1: bounds.y + bounds.height - 1 });
    assert.deepEqual(plan.crop, { x: 55, y: 201, width: 256, height: 256 });
    const inputs = inpaintInputs(scene(), plan, mask);
    let white = 0;
    for (let i = 0; i < inputs.mask.data.length; i += 4) if (inputs.mask.data[i] === 255) white++;
    assert.equal(white, mask.reduce((sum, value) => sum + value, 0), 'the mask picture is exactly the polygon');
    assert.deepEqual(pixel(inputs.mask, 0, 0), [0, 0, 0, 255]);
    // Rectangles and a painted picture (white = repaint) add up.
    const painted = paint(512, 512, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 15 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const both = sceneMask(512, 512, { image: painted, rects: [{ x0: 30, y0: 30, x1: 31, y1: 31 }] });
    assert.equal(both.reduce((sum, value) => sum + value, 0), 50 + 4);
    assert.throws(() => sceneMask(512, 512, { image: paint(64, 64, () => [255, 255, 255, 255]) }), /đúng cỡ cảnh/);
    assert.throws(() => sceneMask(512, 512, { polygons: [[[1, 1], [2, 2]]] }), /3 đỉnh/);
    assert.equal(isTightMask({ x: 0, y: 0, width: 26, height: 17 }), true, 'the 26x17 box around the first guestbook was too tight');
  });

  test('inputs: the source is the scene crop and the mask is pure white on black', () => {
    const picture = scene();
    const plan = planInpaint(512, 512, { x0: 200, y0: 300, x1: 215, y1: 309 });
    const { source, mask, context } = inpaintInputs(picture, plan);
    assert.ok(source.data.equals(crop(picture, plan.crop.x, plan.crop.y, 128, 128).data));
    assert.deepEqual(pixel(mask, plan.mask.x, plan.mask.y), [255, 255, 255, 255]);
    assert.deepEqual(pixel(mask, plan.mask.x - 1, plan.mask.y), [0, 0, 0, 255]);
    let white = 0;
    for (let i = 0; i < mask.data.length; i += 4) {
      assert.ok(mask.data[i] === 0 || mask.data[i] === 255);
      if (mask.data[i] === 255) white++;
    }
    assert.equal(white, 16 * 10);
    assert.deepEqual([context.width, context.height], [384, 384]);
  });
});

describe('inpaint merge', () => {
  test('only the mask comes back: the rest of the PixelLab answer (a white rim) is ignored', () => {
    const picture = scene();
    const plan = planInpaint(512, 512, { x0: 200, y0: 300, x1: 215, y1: 309 });
    // The answer: a dark red book in the mask, everything else flattened to white (no_background false on a transparent input).
    const answer = paint(128, 128, (x, y) => {
      const inside = x >= plan.mask.x && x < plan.mask.x + plan.mask.width && y >= plan.mask.y && y < plan.mask.y + plan.mask.height;
      if (!inside) return [255, 255, 255, 255];
      return x < plan.mask.x + 12 && y < plan.mask.y + 8 ? [150, 20, 20, 255] : [...pixel(picture, plan.crop.x + x, plan.crop.y + y)] as any;
    });
    const merged = mergeInpaint(picture, answer, plan);
    assert.equal(merged.changed, 12 * 8);
    assert.ok(merged.ignoredOutside > 1000);
    assert.deepEqual(merged.drawn, { x: 200, y: 300, width: 12, height: 8 });
    assert.deepEqual(pixel(merged.image, 200, 300), [150, 20, 20, 255]);
    // Every pixel outside the mask is the scene, byte for byte.
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        if (x >= 200 && x <= 215 && y >= 300 && y <= 309) continue;
        const i = (y * 512 + x) * 4;
        if (picture.data.compare(merged.image.data, i, i + 4, i, i + 4) !== 0) assert.fail(`pixel ${x},${y} changed`);
      }
    }
  });

  test('a transparent mask pixel never punches a hole in the scene; a wrong-size answer is refused', () => {
    const picture = scene();
    const plan = planInpaint(512, 512, { x0: 10, y0: 10, x1: 19, y1: 19 });
    const clear = paint(128, 128, () => [0, 0, 0, 0]);
    const merged = mergeInpaint(picture, clear, plan);
    assert.equal(merged.changed, 0);
    assert.equal(merged.drawn, null);
    assert.ok(merged.image.data.equals(picture.data));
    assert.throws(() => mergeInpaint(picture, paint(256, 256, () => [0, 0, 0, 255]), plan), /không ghép được/);
  });

  test('placement over the drawn object: asset empty, box padded, position at the bottom centre (runtime x4)', () => {
    const placement = paintedPlacement({ x: 198, y: 329, width: 12, height: 15 });
    assert.equal(placement.asset, '');
    assert.deepEqual(placement.hotspot, { x: 784, y: 1308, width: 64, height: 76 });
    assert.deepEqual(placement.position, { x: 816, y: 1384, anchor: 'bottom-center' });
    assert.deepEqual(placement.size, { width: 64, height: 76 });
  });
});

describe('asset_process inpaint_prep / inpaint_merge and compose', () => {
  test('prep writes source, mask, context, preview and a plan with both PixelLab calls; merge paints the scene', async () => {
    assert.ok(PROCESS_OPS.includes('inpaint_prep') && PROCESS_OPS.includes('inpaint_merge'));
    const repo = tempRepo();
    try {
      const ctx = testContext(repo.root, 'https://sirlocked.id.vn');
      const picture = scene();
      writeFileSync(path.join(repo.root, 'ngo.png'), await encode(picture, 'png'));
      await assert.rejects(assetProcess(ctx, { op: 'inpaint_prep', input: 'ngo.png' }), /RỘNG theo cả mặt/);
      await assert.rejects(assetProcess(ctx, { op: 'inpaint_prep', input: 'ngo.png', params: { rect: [322, 210, 341, 225], description: 'hòm gỗ' } }), /ASCII/);
      writeFileSync(path.join(repo.root, 'big.png'), await encode(paint(1024, 1024, () => [1, 2, 3, 255]), 'png'));
      await assert.rejects(assetProcess(ctx, { op: 'inpaint_prep', input: 'big.png', params: { rect: [1, 1, 5, 5] } }), /NATIVE 512/);

      const prep: any = await assetProcess(ctx, {
        op: 'inpaint_prep', input: 'ngo.png', params: { rect: [322, 210, 341, 225], id: 'hom-go', description: 'a dark wooden chest with iron bands on the rickshaw seat' },
      });
      for (const file of Object.values(prep.files) as string[]) assert.ok(existsSync(path.join(repo.root, file)), file);
      // Inpaint Pro (v3) with the mask picture first; Pro Flash (cheaper, smudges small things) only as an option.
      assert.equal(prep.calls[0].tool, 'inpaint_image');
      assert.equal(prep.calls[0].generations, 10);
      assert.equal(prep.calls[0].params.mask_image_url, 'upload:<mask.png>');
      assert.equal(prep.calls[0].params.no_background, false);
      assert.equal(prep.calls[1].tool, 'inpaint_image_pro_flash');
      assert.equal(prep.calls[1].generations, 6);
      assert.deepEqual(prep.calls[1].params.bounding_box, { x: 140, y: 128, width: 128, height: 128 });
      assert.equal(prep.calls[1].params.mask_image_url, 'upload:<mask.png>');
      assert.deepEqual([prep.mask.x, prep.mask.y, prep.mask.width, prep.mask.height], [54, 56, 20, 16]);
      // A 20x16 box hugs one object: warned (here it is the whole rickshaw seat, so it stays).
      assert.ok(prep.warnings.some((warning: string) => warning.startsWith('MASK_TIGHT')));
      assert.equal(prep.pixelLabCredits, 0);
      const mask = await loadRgba(readFileSync(path.join(repo.root, prep.files.mask)));
      assert.deepEqual(pixel(mask, 54, 56), [255, 255, 255, 255]);

      // PixelLab's answer: the source with a chest in the mask.
      const source = await loadRgba(readFileSync(path.join(repo.root, prep.files.source)));
      const answer = paint(128, 128, (x, y) => (x >= 56 && x < 72 && y >= 58 && y < 70 ? [60, 40, 20, 255] : [...pixel(source, x, y)] as any));
      writeFileSync(path.join(repo.root, 'answer.png'), await encode(answer, 'png'));
      const merged: any = await assetProcess(ctx, { op: 'inpaint_merge', output: 'tmp/ngo-ve.png', params: { plan: prep.files.plan, result: 'answer.png' } });
      assert.deepEqual(merged.drawn, { x: 324, y: 212, width: 16, height: 12 });
      assert.deepEqual(merged.placement.hotspot, { x: 1288, y: 840, width: 80, height: 64 });
      assert.equal(merged.placement.asset, '');
      assert.equal(merged.ignoredOutsideMask, 0);
      assert.ok(existsSync(path.join(repo.root, merged.compare)));
      const out = await loadRgba(readFileSync(path.join(repo.root, 'tmp/ngo-ve.png')));
      assert.deepEqual(pixel(out, 330, 215), [60, 40, 20, 255]);
      assert.deepEqual(pixel(out, 0, 0), pixel(picture, 0, 0));

      // Nothing drawn: refused, so the bot reports instead of placing a box over an empty counter.
      writeFileSync(path.join(repo.root, 'empty.png'), await encode(source, 'png'));
      await assert.rejects(assetProcess(ctx, { op: 'inpaint_merge', params: { plan: prep.files.plan, result: 'empty.png' } }),
        (error: any) => error.code === 'INPAINT_EMPTY');
    } finally {
      repo.cleanup();
    }
  });

  test('a wide polygon mask over a whole counter top: only the polygon comes back, boxes give one placement per object', async () => {
    const repo = tempRepo();
    try {
      const ctx = testContext(repo.root, 'https://sirlocked.id.vn');
      const picture = scene();
      writeFileSync(path.join(repo.root, 'tra-lau.png'), await encode(picture, 'png'));
      const counter = [[113, 314], [157, 305], [203, 296], [243, 305], [252, 316], [250, 322], [157, 361], [114, 340]];
      const prep: any = await assetProcess(ctx, {
        op: 'inpaint_prep', input: 'tra-lau.png', output: 'tmp/quay',
        params: { polygon: counter, id: 'quay', description: 'Wooden counter top with torn letter scraps, an open guest ledger and a tea tray' },
      });
      assert.deepEqual(prep.crop, { x: 55, y: 201, width: 256, height: 256 });
      assert.deepEqual(prep.warnings, []);
      assert.equal(prep.calls[0].tool, 'inpaint_image');
      const plan = JSON.parse(readFileSync(path.join(repo.root, prep.files.plan), 'utf8'));
      assert.equal(plan.maskFile, 'mask.png');
      assert.deepEqual(plan.polygons, [counter]);

      // PixelLab repaints everything it was given: the merge keeps only the polygon.
      const answer = paint(256, 256, () => [200, 30, 30, 255]);
      writeFileSync(path.join(repo.root, 'answer.png'), await encode(answer, 'png'));
      await assert.rejects(assetProcess(ctx, { op: 'inpaint_merge', params: { plan: prep.files.plan, result: 'tra-lau.png' } }), /không ghép được/);
      const merged: any = await assetProcess(ctx, {
        op: 'inpaint_merge', output: 'tmp/tra-lau-ve.png',
        params: { plan: prep.files.plan, result: 'answer.png', boxes: { 'item-so': [141, 306, 213, 350], 'item-thu': [112, 316, 140, 340] } },
      });
      assert.equal(merged.changedPixels, prep.maskPixels);
      assert.equal(merged.placement, null, 'a wide mask has no single object');
      assert.deepEqual(merged.placements['item-so'].hotspot, { x: 556, y: 1216, width: 308, height: 196 });
      assert.deepEqual(merged.placements['item-thu'].position, { x: 506, y: 1372, anchor: 'bottom-center' });
      const out = await loadRgba(readFileSync(path.join(repo.root, 'tmp/tra-lau-ve.png')));
      assert.deepEqual(pixel(out, 180, 330), [200, 30, 30, 255]);
      assert.deepEqual(pixel(out, 120, 300), pixel(picture, 120, 300), 'inside the box, off the counter: untouched');
      assert.deepEqual(pixel(out, 60, 210), pixel(picture, 60, 210));
    } finally {
      repo.cleanup();
    }
  });

  test('compose never pastes an item picture onto a scene; removing still works', async () => {
    const repo = tempRepo();
    try {
      const ctx = testContext(repo.root, 'https://sirlocked.id.vn');
      writeFileSync(path.join(repo.root, 'map.png'), await encode(paint(64, 64, (x) => [x * 3, 80, 80, 255]), 'png'));
      writeFileSync(path.join(repo.root, 'prop.png'), await encode(paint(8, 8, () => [200, 0, 0, 255]), 'png'));
      await assert.rejects(assetVariant(ctx, { type: 'compose', input: 'map.png', params: { add: [{ source: 'prop.png', x: 10, y: 10 }] }, saveToLibrary: false }),
        (error: any) => error.code === 'ITEM_PASTE_FORBIDDEN' && /inpaint_prep/.test(error.message));
      assert.equal(existsSync(path.join(repo.root, 'tmp', 'variants')), false, 'nothing written');
      await assert.rejects(assetVariant(ctx, { type: 'compose', input: 'map.png', params: {}, saveToLibrary: false }), /remove/);
      const removed: any = await assetVariant(ctx, { type: 'compose', input: 'map.png', params: { remove: [[10, 10, 14, 14]] }, saveToLibrary: false });
      assert.equal(removed.removed, 1);
      assert.equal(removed.added, undefined);
    } finally {
      repo.cleanup();
    }
  });

  test('the tutorial scenes carry their inpainted objects exactly as the recipe says', { skip: !existsSync(path.join(realRepoRoot(), 'ai-game-docs', 'pixel-case-tan-thu', 'inpaint', 'recipe.json')) && 'recipe missing' }, async () => {
    const root = realRepoRoot();
    const dir = path.join(root, 'ai-game-docs', 'pixel-case-tan-thu', 'inpaint');
    const recipe = JSON.parse(readFileSync(path.join(dir, 'recipe.json'), 'utf8'));
    for (const patch of recipe.patches) {
      const sceneFile = path.join(root, 'src', 'FE', 'public', 'assets', 'pixel', 'tan-thu', patch.scene);
      const picture = await loadRgba(readFileSync(sceneFile));
      const answer = await loadRgba(readFileSync(path.join(dir, patch.output)));
      const crop = { x: patch.crop.x, y: patch.crop.y, width: patch.crop.size, height: patch.crop.size };
      const maskPicture = patch.maskFile ? await loadRgba(readFileSync(path.join(dir, patch.maskFile))) : undefined;
      const plan = { crop, mask: patch.mask ?? { x: 0, y: 0, width: crop.width, height: crop.height } };
      // Merging again changes nothing: the scene already holds the masked pixels of the PixelLab answer.
      const merged = mergeInpaint(picture, answer, plan, maskPicture);
      assert.equal(merged.changed, 0, patch.id);
      if (patch.maskFile) {
        // The counter: one wide mask drawn along the whole counter top, matching its polygon.
        const fromPolygon = sceneMask(512, 512, { polygons: [patch.polygon] });
        let same = 0, white = 0;
        for (let y = 0; y < crop.height; y++) {
          for (let x = 0; x < crop.width; x++) {
            const on = maskPicture!.data[(y * crop.width + x) * 4] > 127;
            if (on) white++;
            if (on === (fromPolygon[(crop.y + y) * 512 + crop.x + x] === 1)) same++;
          }
        }
        assert.equal(same, crop.width * crop.height, `${patch.id}: mask.png is the recipe polygon`);
        assert.equal(isTightMask(maskBounds(fromPolygon, 512)!), false);
        assert.ok(white > 4000);
      }
    }
  });
});
