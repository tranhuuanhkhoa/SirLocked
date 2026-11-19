import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { zipSync } from 'fflate';
import {
  breatheFrames, checkSize, cleanText, cover, cutBackground, fit, idleSheet, inspect, maskFromShapes, npcCheck, npcFromZip, portrait, walkableFromMask,
} from '../src/image/process.js';
import { crop, encode, loadRgba, opaqueBounds, type Rgba } from '../src/image/raster.js';
import { assetProcess } from '../src/tools/assets.js';
import { paint, pixel, realRepoRoot, tempRepo, testContext } from './helpers.js';

/** A 96x96 chibi stand-in: transparent canvas, opaque body from y=20 to y=85. */
const crop9 = (image: Rgba, index: number) => crop(image, index * 128, 0, 128, 128);

const sprite = () => paint(96, 96, (x, y) => (x >= 30 && x < 66 && y >= 20 && y <= 85 ? [120 + (y % 7), 60, 40, 255] : [0, 0, 0, 0]));

describe('asset_process building blocks', () => {
  test('inspect and check_size report size, alpha and format', async () => {
    const info = await inspect(await encode(sprite(), 'png'));
    assert.equal(info.width, 96);
    assert.equal(info.hasAlpha, true);
    assert.equal(info.format, 'png');
    assert.deepEqual(info.opaqueBounds, { x0: 30, y0: 20, x1: 65, y1: 85 });
    assert.deepEqual(checkSize(info, { width: 96, height: 96, transparent: true }), []);
    assert.equal(checkSize(info, { width: 128, transparent: false }).length, 2);
  });

  test('cut_background removes only the border-connected background', () => {
    // Green background, red square, and a green hole inside the square that must stay.
    const image = paint(20, 20, (x, y) => {
      if (x >= 5 && x < 15 && y >= 5 && y < 15) return x >= 9 && x < 11 && y >= 9 && y < 11 ? [0, 200, 0, 255] : [200, 0, 0, 255];
      return [0, 200, 0, 255];
    });
    const { image: out, removed } = cutBackground(image, { tolerance: 10 });
    assert.equal(removed, 400 - 100);
    assert.equal(pixel(out, 0, 0)[3], 0);
    assert.equal(pixel(out, 6, 6)[3], 255);
    assert.equal(pixel(out, 9, 9)[3], 255, 'enclosed background is part of the picture');
  });

  test('clean_text paints lettering with the paper colour inside the rectangle only', () => {
    const paper = paint(32, 32, (x, y) => (x >= 4 && x < 28 && y >= 4 && y < 28 ? ((x === 10 || x === 12) && y >= 10 && y < 20 ? [40, 30, 20, 255] : [240, 210, 120, 255]) : [0, 0, 0, 0]));
    const { image, changed } = cleanText(paper, [{ x0: 8, y0: 8, x1: 14, y1: 22 }]);
    assert.equal(changed, 20);
    assert.deepEqual(pixel(image, 10, 15), [240, 210, 120, 255]);
    assert.deepEqual(pixel(image, 2, 2), [0, 0, 0, 0], 'outside pixels untouched');
  });

  test('idle sheet is 9 frames of 128x128 (1152x128) with the feet at y=104', () => {
    const sheet = idleSheet({ south: sprite(), idle: [] });
    assert.equal(sheet.source, 'code-breathing');
    assert.equal(sheet.image.width, 1152);
    assert.equal(sheet.image.height, 128);
    const bounds = opaqueBounds(sheet.image)!;
    assert.equal(bounds.y1, 104);
    // Frames 2-5 breathe: the head sits one pixel lower than in frame 0.
    const frames = breatheFrames(sprite());
    assert.equal(frames.length, 9);
    assert.equal(opaqueBounds(frames[0])!.y0, 20);
    assert.equal(pixel(frames[2], 40, 20)[3], 0);
    assert.equal(pixel(frames[2], 40, 21)[3], 255);
  });

  test('PixelLab idle frames play 0-1-2-3-3-2-1-0-0 and a character zip is read', async () => {
    const frame = (shade: number) => paint(96, 96, (x, y) => (x >= 30 && x < 66 && y >= 20 && y <= 85 ? [shade, shade, shade, 255] : [0, 0, 0, 0]));
    const zip = zipSync({
      'Idle/rotations/south.png': new Uint8Array(await encode(sprite(), 'png')),
      'Idle/rotations/north.png': new Uint8Array(await encode(sprite(), 'png')),
      ...Object.fromEntries(await Promise.all([10, 20, 30, 40].map(async (shade, index) => [
        `Idle/animations/idle/south/frame_00${index}.png`, new Uint8Array(await encode(frame(shade), 'png')),
      ]))),
    });
    const npc = await npcFromZip(zip);
    assert.equal(npc.idle.length, 4);
    const sheet = idleSheet(npc);
    assert.equal(sheet.source, 'pixellab-idle');
    const shades = Array.from({ length: 9 }, (_, index) => pixel(sheet.image, index * 128 + 16 + 40, 70)[0]);
    assert.deepEqual(shades, [10, 20, 30, 40, 40, 30, 20, 10, 10]);
  });

  test('a v3 idle of 9 frames on a 116 canvas plays in order with the feet at y=104, where the south sprite stands', async () => {
    // As PixelLab returns templates.json's character-idle: the 96 character centred on 116x116 (10 px of room).
    const frame = (shade: number) => paint(116, 116, (x, y) => (x >= 40 && x < 76 && y >= 30 && y <= 95 ? [shade, shade, shade, 255] : [0, 0, 0, 0]));
    const zip = zipSync({
      'Idle/rotations/south.png': new Uint8Array(await encode(sprite(), 'png')),
      ...Object.fromEntries(await Promise.all(Array.from({ length: 9 }, async (_, index) => [
        `Idle/animations/npc_idle_south/south/frame_00${index}.png`, new Uint8Array(await encode(frame(10 + index * 10), 'png')),
      ]))),
    });
    const npc = await npcFromZip(zip);
    assert.equal(npc.idle.length, 9);
    const sheet = idleSheet(npc);
    assert.equal(sheet.source, 'pixellab-idle');
    assert.equal(sheet.image.width, 1152);
    const shades = Array.from({ length: 9 }, (_, index) => pixel(sheet.image, index * 128 + 16 + 40, 70)[0]);
    assert.deepEqual(shades, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
    for (let index = 0; index < 9; index++) {
      const cell = opaqueBounds(crop9(sheet.image, index))!;
      // Same place as the code-breathing sheet of the same sprite: x 46..81, feet on y=104.
      assert.deepEqual([cell.x0, cell.x1, cell.y1], [46, 81, 104], `frame ${index}`);
    }
  });

  test('portrait is 288x288 nearest neighbour (each sprite pixel becomes 3x3)', () => {
    const face = portrait(sprite());
    assert.equal(face.width, 288);
    assert.deepEqual(pixel(face, 30 * 3, 20 * 3), pixel(sprite(), 30, 20));
    assert.deepEqual(pixel(face, 30 * 3 + 2, 20 * 3 + 2), pixel(sprite(), 30, 20));
  });

  test('cover is opaque 512x512 with the portraits on a dark band', () => {
    const scene = paint(512, 512, () => [200, 200, 200, 255]);
    const out = cover(scene, [portrait(sprite()), portrait(sprite()), portrait(sprite())]);
    assert.equal(out.width, 512);
    assert.equal(pixel(out, 5, 340)[0] < 120, true, 'band darkens the bottom');
    assert.deepEqual(pixel(out, 5, 5), [200, 200, 200, 255]);
    for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], 255);
  });
});

describe('fit a pixel picture into a slot', () => {
  test('contain scales by a whole factor and letterboxes; cover fills and crops', () => {
    const map = paint(512, 512, (x, y) => (x === 0 || y === 0 || x === 511 || y === 511 ? [10, 20, 30, 255] : [x % 256, y % 256, 90, 255]));
    const contain = fit(map, 1600, 900);
    assert.equal(contain.scale, 1);
    assert.deepEqual(pixel(contain.image, 0, 0), [10, 20, 30, 255], 'border colour fills the sides');
    assert.deepEqual(pixel(contain.image, 544 + 5, 194 + 7), pixel(map, 5, 7));
    const cover = fit(map, 1600, 900, { mode: 'cover' });
    assert.equal(cover.scale, 4);
    // 2048x2048 centred: left -224, top -574 -> output (0,0) is source pixel (56, 143).
    assert.deepEqual(pixel(cover.image, 0, 0), pixel(map, 56, 143));
    const small = fit(paint(64, 64, () => [1, 2, 3, 255]), 256, 256);
    assert.equal(small.scale, 4);
    const forced = fit(map, 1600, 900, { scale: 2 });
    assert.equal(forced.scale, 2);
    // 1024x1024 centred in 1600x900: left 288, top -62 -> output (288, 0) is source pixel (0, 31).
    assert.deepEqual(pixel(forced.image, 288, 0), pixel(map, 0, 31));
  });
});

describe('walkable area from a mask', () => {
  const fixture = path.join(realRepoRoot(), 'src', 'BE', 'Tests', 'Fixtures', 'case-pixel-dong-ho-dem-mua-vi.json');
  const scenes = existsSync(fixture)
    ? Object.fromEntries(JSON.parse(readFileSync(fixture, 'utf8')).stages.flatMap((stage: any) => stage.scenes).map((scene: any) => [scene.sceneId, scene]))
    : null;

  test('the harbour of the sample case: the same walkGrid as its hand-written rule', { skip: !scenes && 'fixture missing' }, () => {
    const rect = (x0: number, y0: number, x1: number, y1: number) => ({ rect: { x0, y0, x1, y1 } });
    const mask = maskFromShapes(512, 512,
      [rect(0, 84, 511, 120), rect(190, 118, 386, 300), rect(0, 288, 511, 346), rect(244, 340, 340, 511)],
      [rect(264, 164, 336, 284), rect(186, 172, 226, 242), rect(80, 278, 192, 334), rect(316, 92, 346, 120)]);
    const result = walkableFromMask(mask);
    const expected = scenes!['scene-dh-ben-cang'].runtime.render.walkGrid;
    assert.deepEqual(result.walkGrid, expected);
    assert.equal(result.walkGrid.data.join('').split('1').length - 1, 5041);
  });

  test('the isometric shop (diamond floor minus furniture): same grid as the sample', { skip: !scenes && 'fixture missing' }, () => {
    const rect = (x0: number, y0: number, x1: number, y1: number) => ({ rect: { x0, y0, x1, y1 } });
    const mask = maskFromShapes(512, 512, [{ diamond: { cx: 255, cy: 367, rx: 223, ry: 115, fill: 0.88, minY: 300 } }],
      [rect(55, 250, 190, 340), rect(40, 300, 100, 360), rect(220, 282, 392, 378), rect(395, 318, 470, 372),
        rect(255, 378, 296, 420), rect(298, 383, 338, 424), rect(185, 225, 240, 270), rect(260, 240, 470, 330)]);
    const result = walkableFromMask(mask);
    assert.deepEqual(result.walkGrid, scenes!['scene-dh-tiem-dong-ho'].runtime.render.walkGrid);
  });

  test('walkableArea is the walkable bounding box and obstacles cover the blocked cells inside it', () => {
    // Walkable 64..447 x 128..383 native, with a blocked table 200..263 x 200..263.
    const mask = paint(512, 512, (x, y) => {
      const walk = x >= 64 && x < 448 && y >= 128 && y < 384 && !(x >= 200 && x < 264 && y >= 200 && y < 264);
      return walk ? [255, 255, 255, 255] : [0, 0, 0, 255];
    });
    const result = walkableFromMask(mask);
    assert.deepEqual(result.walkableArea, { x: 256, y: 512, width: 1536, height: 1024 });
    assert.deepEqual(result.navigationObstacles, [{ x: 800, y: 800, width: 256, height: 256 }]);
    assert.equal(result.walkGrid.cols, 128);
    assert.equal(result.walkGrid.cellSize, 16);
    const inverted = walkableFromMask(paint(512, 512, (x) => (x < 256 ? [0, 0, 0, 255] : [255, 255, 255, 255])), { invert: true });
    assert.deepEqual(inverted.walkableArea, { x: 0, y: 0, width: 1024, height: 2048 });
  });

  test('an empty mask is an error, not an empty grid', () => {
    assert.throws(() => walkableFromMask(paint(16, 16, () => [0, 0, 0, 255])), /no walkable/);
  });
});

describe('asset_process tool', () => {
  test('NPC standard: style and 96x96 format are checked, never the height; a chibi or wrong-canvas NPC writes nothing', async () => {
    const figure = (top: number, bottom: number, size = 96) =>
      paint(size, size, (x, y) => (x >= 30 && x < 66 && y >= top && y <= bottom ? [90, 60, 40, 255] : [0, 0, 0, 0]));
    const zipOf = async (south: ReturnType<typeof figure>, prompt: string) => zipSync({
      'metadata.json': new TextEncoder().encode(JSON.stringify({ states: [{ character: { prompt, size: { width: 96, height: 96 } } }] })),
      'Idle/rotations/south.png': new Uint8Array(await encode(south, 'png')),
    });
    // Tall, average and short (a child) figures all pass: the height is the character's own.
    for (const [top, bottom] of [[2, 93], [10, 87], [40, 89]]) {
      assert.deepEqual(npcCheck({ south: figure(top, bottom), idle: [] }).problems, [], `${top}-${bottom}`);
    }
    // The prompt comes from the zip's metadata.json; a chibi one is refused whatever the size.
    const standard = await npcFromZip(await zipOf(figure(10, 87), 'plump 1930s Shanghai teahouse owner, black skullcap'));
    assert.equal(standard.prompt, 'plump 1930s Shanghai teahouse owner, black skullcap');
    assert.deepEqual(npcCheck(standard).problems, []);
    const chibi = await npcFromZip(await zipOf(figure(10, 87), 'Victorian police constable, chibi proportions with a slightly large head'));
    assert.deepEqual(npcCheck(chibi).problems.map((problem) => problem.code), ['NPC_STYLE']);
    assert.match(npcCheck(chibi).problems[0].message, /chibi.*character-front/);
    assert.deepEqual(npcCheck({ south: figure(20, 99, 128), idle: [] }).problems.map((problem) => problem.code), ['NPC_FORMAT']);

    const repo = tempRepo();
    try {
      const ctx = testContext(repo.root, 'https://sirlocked.id.vn');
      writeFileSync(path.join(repo.root, 'chibi.zip'), await zipOf(figure(10, 87), 'geisha, chibi proportions'));
      writeFileSync(path.join(repo.root, 'big.png'), await encode(figure(20, 99, 128), 'png'));
      for (const [input, code] of [['chibi.zip', 'NPC_STYLE'], ['big.png', 'NPC_FORMAT']]) {
        for (const op of ['npc_bundle', 'sprite_sheet', 'idle_breathe', 'portrait'] as const) {
          await assert.rejects(assetProcess(ctx, { op, input, output: `tmp/out-${op}` }),
            (error: any) => error.code === code && /character-front/.test(error.message), `${op} ${input}`);
          assert.equal(existsSync(path.join(repo.root, `tmp/out-${op}`)), false, `${op} wrote nothing`);
        }
      }
      writeFileSync(path.join(repo.root, 'tall.zip'), await zipOf(figure(2, 93), 'very tall thin lighthouse keeper, long grey coat'));
      const ok: any = await assetProcess(ctx, { op: 'npc_bundle', input: 'tall.zip' });
      assert.equal(ok.sprite, '96x96');
    } finally {
      repo.cleanup();
    }
  });

  test('npc_bundle writes sprite, 1152x128 idle sheet and 288x288 portrait as lossless WebP', async () => {
    const repo = tempRepo();
    try {
      const ctx = testContext(repo.root, 'https://sirlocked.id.vn');
      const file = path.join(repo.root, 'south.png');
      writeFileSync(file, await encode(sprite(), 'png'));
      const result: any = await assetProcess(ctx, { op: 'npc_bundle', input: file });
      const idle = await loadRgba(readFileSync(path.join(repo.root, result.files.idle)));
      const face = await loadRgba(readFileSync(path.join(repo.root, result.files.portrait)));
      const back = await loadRgba(readFileSync(path.join(repo.root, result.files.sprite)));
      assert.deepEqual([idle.width, idle.height, face.width, face.height], [1152, 128, 288, 288]);
      assert.ok(back.data.equals(sprite().data), 'WebP is lossless: every pixel and alpha kept');
      const walk: any = await assetProcess(ctx, {
        op: 'mask_from_shapes', output: 'tmp/mask.png', params: { width: 512, height: 512, walk: [{ rect: { x0: 0, y0: 256, x1: 511, y1: 511 } }] },
      });
      const grid: any = await assetProcess(ctx, { op: 'walkable', input: walk.output, params: { picture: 'south.png' } });
      assert.deepEqual(grid.walkableArea, { x: 0, y: 1024, width: 2048, height: 1024 });
      assert.ok(existsSync(path.join(repo.root, grid.overlay)));
      const checked: any = await assetProcess(ctx, { op: 'check_size', input: result.files.portrait, params: { width: 288, height: 288, transparent: true } });
      assert.equal(checked.ok, true);
    } finally {
      repo.cleanup();
    }
  });
});
