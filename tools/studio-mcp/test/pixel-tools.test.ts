/**
 * VUAN-6B: the local picture steps of the PixelLab workflow produce exactly what "Tram hong ngoc mat tich" uses:
 * foreground layers cut from the native map with baseY, 64x64 icons from a 4x4 sheet, 1152x128 idle sheets and
 * 288x288 portraits; and asset_plan declares the picture sources to the server.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { StudioError } from '../src/bridge-client.js';
import { foregroundLayer, iconSheetCells, idleSheet, portrait } from '../src/image/process.js';
import { blank, loadRgba, type Rgba } from '../src/image/raster.js';
import { assetProcess } from '../src/tools/assets.js';
import { assetPlan, assetsNeeded } from '../src/tools/draft.js';
import { paint, pixel, realRepoRoot, startFakeBridge, tempRepo, testContext, type FakeBridge } from './helpers.js';

const repo = realRepoRoot();
const caseFile = path.join(repo, 'src', 'BE', 'SeedData', 'V3', 'case-pixel-tram-hong-ngoc-vi.json');
const publicFile = (url: string) => path.join(repo, 'src', 'FE', 'public', ...url.replace(/^\//, '').split('/'));
const haveFixtures = existsSync(caseFile) && existsSync(publicFile('/assets/pixel/lo-thuoc-thu-nam/scenes/pho.png'));

describe('pixel pictures in the shape of Tram hong ngoc', { skip: !haveFixtures && 'repo fixtures not present' }, () => {
  test('foreground: the lamp of the street map comes out exactly as the case has it (box x4, baseY at the foot)', async () => {
    const tram = JSON.parse(readFileSync(caseFile, 'utf8'));
    const street = tram.stages[0].scenes.find((scene: any) => scene.sceneId === 'scene-tn-pho');
    const lamp = street.runtime.render.foreground.find((layer: any) => layer.id === 'lamp-1');
    const map = await loadRgba(readFileSync(publicFile(street.backgroundUrl)));
    const cut = await loadRgba(readFileSync(publicFile(lamp.url)));
    assert.equal(map.width, 512);
    // The object mask of the bundled case, rebuilt from the lamp's alpha: white where the lamp is.
    const x0 = lamp.x / 4, y0 = lamp.y / 4;
    const mask = blank(512, 512, [0, 0, 0, 255]);
    for (let y = 0; y < cut.height; y++) for (let x = 0; x < cut.width; x++) {
      if (cut.data[(y * cut.width + x) * 4 + 3] === 0) continue;
      mask.data.set([255, 255, 255, 255], ((y0 + y) * 512 + x0 + x) * 4);
    }
    // The bundled layer keeps its cut rectangle as the canvas: same box, same baseY, same visible pixels.
    const canvas = foregroundLayer(map, mask, { x0, y0, x1: x0 + cut.width - 1, y1: y0 + cut.height - 1 }, { tight: false });
    assert.deepEqual(canvas.layer, { x: lamp.x, y: lamp.y, width: lamp.width, height: lamp.height, baseY: lamp.baseY });
    assert.deepEqual([canvas.image.width, canvas.image.height], [cut.width, cut.height]);
    for (let i = 0; i < cut.data.length; i += 4) {
      assert.equal(canvas.image.data[i + 3] > 0, cut.data[i + 3] > 0, 'same alpha shape');
      if (cut.data[i + 3] > 0) assert.deepEqual([...canvas.image.data.subarray(i, i + 3)], [...cut.data.subarray(i, i + 3)], 'RGB from the native map');
    }
    // Default: cropped tight to the object, still native x4 and baseY under its lowest pixel (y + height).
    const result = foregroundLayer(map, mask, { x0: x0 - 6, y0: y0 - 6, x1: x0 + cut.width + 6, y1: y0 + cut.height + 6 });
    assert.equal(result.layer.baseY, result.layer.y + result.layer.height);
    assert.equal(result.layer.width, result.image.width * 4);
    assert.ok(result.layer.x >= lamp.x && result.layer.y >= lamp.y && result.layer.baseY <= lamp.baseY);
    // A tree whose trunk base is above the bottom of the cut: baseRow moves the ground line.
    const raised = foregroundLayer(map, mask, { x0: x0 - 6, y0: y0 - 6, x1: x0 + cut.width + 6, y1: y0 + cut.height + 6 }, { baseRow: y0 + 50 });
    assert.equal(raised.layer.baseY, (y0 + 51) * 4);
  });

  test('npc_bundle numbers: idle sheet 1152x128 (9 frames of 128, feet at 104 -> anchorY 0.8203), portrait 288x288', () => {
    const south = paint(96, 96, (x, y) => (x >= 30 && x < 66 && y >= 20 && y <= 85 ? [120, 60, 40, 255] : [0, 0, 0, 0]));
    const sheet = idleSheet({ south, idle: [] });
    assert.deepEqual([sheet.image.width, sheet.image.height], [1152, 128]);
    assert.equal(sheet.anchorY, 0.8203);
    const face = portrait(south);
    assert.deepEqual([face.width, face.height], [288, 288]);
    const tram = JSON.parse(readFileSync(caseFile, 'utf8'));
    assert.ok(tram.characters.some((character: any) => character.presentation.spriteSheet.anchorY === sheet.anchorY));
  });

  test('icon_sheet cuts a 256x256 4x4 PixelLab sheet into named 64x64 icons, skipping empty cells', async () => {
    const colours: Record<number, [number, number, number, number]> = { 0: [200, 40, 40, 255], 1: [40, 200, 40, 255], 5: [40, 40, 200, 255] };
    const sheet = paint(256, 256, (x, y) => {
      const cell = Math.floor(y / 64) * 4 + Math.floor(x / 64);
      const inside = x % 64 >= 16 && x % 64 < 48 && y % 64 >= 16 && y % 64 < 48;
      return colours[cell] && inside ? colours[cell] : [0, 0, 0, 0];
    });
    const cells = iconSheetCells(sheet);
    assert.equal(cells.length, 16);
    assert.deepEqual(cells.filter((cell) => !cell.empty).map((cell) => cell.cell), [0, 1, 5]);
    assert.deepEqual(pixel(cells[5].image, 20, 20), [40, 40, 200, 255]);
    assert.throws(() => iconSheetCells(blank(128, 128)), /needs 256x256/);

    const temp = tempRepo();
    try {
      const ctx = testContext(temp.root, 'http://127.0.0.1:9');
      const { encode } = await import('../src/image/raster.js');
      const file = path.join(temp.root, 'sheet-1-256.png');
      (await import('node:fs')).writeFileSync(file, await encode(sheet, 'png'));
      const result: any = await assetProcess(ctx, { op: 'icon_sheet', input: file, params: { names: ['kinh-lup', 'chia-khoa', null, null, null, 'so-tay'] } });
      assert.equal(result.cells, 3);
      assert.deepEqual(result.files.map((entry: any) => entry.name), ['kinh-lup', 'chia-khoa', 'so-tay']);
      const icon: Rgba = await loadRgba(readFileSync(path.join(temp.root, result.files[2].file)));
      assert.deepEqual([icon.width, icon.height], [64, 64]);
      // foreground refuses an upscaled map: masks and crops come from the NATIVE 512 picture.
      await assert.rejects(assetProcess(ctx, { op: 'foreground', params: { map: file, mask: file, rect: [0, 0, 10, 10] } }), /NATIVE 512x512/);
    } finally {
      temp.cleanup();
    }
  });
});

describe('asset_plan and the pixel part of assets_needed', () => {
  const draftId = '64b64c0f0f0f0f0f0f0f0f99';
  let bridge: FakeBridge;
  const temp = tempRepo();
  const plan = {
    requests: [{ id: 'front.npc', order: 1, tool: 'create_image_pro', params: { width: 96, height: 96 }, estimatedGenerations: 10, dependsOn: [],
      missingInputs: [{ placeholder: '{{characterAppearance}}' }], target: undefined }],
    reuse: [{ subject: 'scene:scene-a' }],
    summary: { estimatedGenerations: 10 },
  };
  before(async () => {
    bridge = await startFakeBridge({
      [`PUT /api/bridge/drafts/${draftId}/asset-plan`]: (request) => request.json.choices.length === 0
        ? { status: 409, body: { success: false, message: 'The picture plan needs 64 PixelLab generations but this order allows 30 (pixelLabCap).', errors: { code: 'AI_PIXELLAB_CAP_EXCEEDED', estimatedGenerations: 64, pixelLabCap: 30 } } }
        : { body: { draftId, accepted: true, estimatedGenerations: 10, pixelLabCap: 30, requests: 1, plan } },
      [`GET /api/bridge/drafts/${draftId}/assets-needed`]: () => ({
        body: {
          draftId, storageAvailable: true, maxBytes: 5242880, formats: ['image/png'], openRequest: null,
          pixel: {
            pixelLabCap: 30, planAccepted: false, estimatedGenerations: 64, withinCap: false, planErrors: [], next: 'Declare...',
            subjects: [{ subject: 'scene:scene-a', kind: 'scene', name: 'A', projection: 'topdown', libraryKind: 'OUTDOOR_MAP', slots: ['background:scene-a'], declared: false, source: 'PIXELLAB', libraryKey: '', parentKey: '', suggestions: ['v-case-pho'] }],
            plan,
          },
          slots: [{ slotId: 'background:scene-a', kind: 'background', targetId: 'scene-a', name: 'A', phase: 'SCENE_LAYOUT', artDirection: 'Outdoor map', width: 512, height: 512, transparent: false, required: true, currentUrl: '', requestedNow: true, mustReplace: false }],
        },
      }),
    });
  });
  after(async () => { await bridge.close(); temp.cleanup(); });

  test('assets_needed shows the subjects with library suggestions and saves the PixelLab plan', async () => {
    const ctx = testContext(temp.root, bridge.url);
    const needed: any = await assetsNeeded(ctx, { draftId });
    assert.equal(needed.slots[0].size, '512x512');
    assert.equal(needed.pixel.pixelLabCap, 30);
    assert.deepEqual(needed.pixel.subjects[0].suggestions, ['v-case-pho']);
    assert.equal(needed.pixel.requests[0].id, 'front.npc');
    assert.ok(existsSync(path.join(temp.root, needed.pixel.planFile)));
  });

  test('asset_plan sends the choices; over the cap the server code comes back as the tool error', async () => {
    const ctx = testContext(temp.root, bridge.url);
    const accepted: any = await assetPlan(ctx, { draftId, choices: [{ subject: 'scene:scene-a', source: 'LIBRARY', libraryKey: 'v-case-pho' }] });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.requests[0].size, '96x96');
    assert.deepEqual(accepted.requests[0].missingInputs, ['{{characterAppearance}}']);
    assert.deepEqual(bridge.requests.at(-1)!.json.choices[0], { subject: 'scene:scene-a', source: 'LIBRARY', libraryKey: 'v-case-pho' });
    // A library scene that does not show an item yet: the item is painted in (inpaint), sent as declared.
    await assetPlan(ctx, { draftId, choices: [{ subject: 'scene:scene-a', source: 'LIBRARY', libraryKey: 'v-case-pho', inpaintItems: ['item-so'] }] });
    assert.deepEqual(bridge.requests.at(-1)!.json.choices[0].inpaintItems, ['item-so']);
    await assert.rejects(assetPlan(ctx, { draftId, choices: [] }), (error: unknown) =>
      error instanceof StudioError && error.code === 'AI_PIXELLAB_CAP_EXCEEDED' && /allows 30/.test(error.message));
  });
});
