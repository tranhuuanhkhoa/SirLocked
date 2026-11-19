import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { medianCut } from '../src/image/quantize.js';
import { countColors, encode, loadRgba, type Rgba } from '../src/image/raster.js';
import {
  afterRain, compose, dusk, hsvToRgbPil, mirror, night, recolor, rgbToHsvPil, snow,
} from '../src/image/variant.js';
import { assetVariant } from '../src/tools/assets.js';
import { loadIndex } from '../src/library/index-store.js';
import { paint, pixel, realRepoRoot, tempRepo, testContext } from './helpers.js';
import { writeFileSync } from 'node:fs';

const lum = (p: number[]) => (p[0] + p[1] + p[2]) / 3;

/** A small town: grey road, brown roof band with dark outlines, light-yellow window, green wallpaper strip. */
const town = () => paint(64, 64, (x, y) => {
  if (y === 10 || y === 20) return [20, 20, 24, 255]; // outlines
  if (y > 10 && y < 20) return [150, 80, 50, 255]; // roof
  if (y >= 24 && y < 30 && x >= 8 && x < 16) return [230, 220, 160, 255]; // window glass
  if (y >= 34 && y < 40) return [60, 140, 70, 255]; // green wallpaper
  return [120, 120, 125, 255]; // road
});

describe('variants on synthetic pictures', () => {
  test('night: darker and bluer, warm window, bright lamp head and halo, ≤ 96 colours, alpha kept', async () => {
    const source = town();
    source.data[3] = 0; // one transparent pixel
    const out = await night(source, { lights: [{ x: 40, y: 50, r: 10 }], windows: [{ x0: 8, y0: 24, x1: 16, y1: 30 }] });
    const road = pixel(out, 5, 60), roadBefore = pixel(source, 5, 60);
    assert.ok(lum(road) < lum(roadBefore) * 0.6, 'night is darker');
    assert.ok(road[2] > road[0], 'night is blue');
    const glass = pixel(out, 10, 26);
    assert.ok(glass[0] > 200 && glass[2] < glass[0], 'lit window is warm');
    assert.ok(lum(pixel(out, 40, 50)) > 180, 'lamp head is bright');
    assert.ok(lum(pixel(out, 44, 50)) > lum(pixel(out, 5, 60)), 'halo brighter than the dark road');
    assert.ok(countColors(out) <= 96);
    assert.equal(out.data[3], 0);
  });

  test('dusk: warm highlights and purple shadows, stretched shadows', async () => {
    const out = await dusk(town());
    const road = pixel(out, 5, 60);
    assert.ok(road[2] > road[1], 'mid tones lean purple');
    const roof = pixel(out, 5, 15), roofBefore = pixel(town(), 5, 15);
    assert.ok(roof[0] >= roofBefore[0] * 0.9, 'warm tones keep their red');
  });

  test('snow: whitens flat upward surfaces, keeps outlines', async () => {
    const out = await snow(town(), { amount: 1 });
    let white = 0;
    for (let x = 0; x < 64; x++) if (lum(pixel(out, x, 60)) > 220) white++;
    assert.ok(white > 40, `road mostly white (${white}/64)`);
    assert.ok(lum(pixel(out, 5, 10)) < 60, 'outline stays dark');
  });

  test('after_rain: darker, streak of light under the lamp, puddle tinted', async () => {
    const source = town();
    const out = await afterRain(source, { lights: [{ x: 30, y: 40, r: 10 }], puddles: [{ x: 50, y: 56, rx: 6, ry: 3 }] });
    assert.ok(lum(pixel(out, 5, 60)) < lum(pixel(source, 5, 60)));
    // Streak pixels follow (yy + xx) % 3 == 0 below the lamp head.
    const streak = pixel(out, 30, 48);
    assert.ok(streak[0] > pixel(out, 5, 48)[0], 'streak is warmer than the plain road');
  });

  test('mirror flips the picture and the hotspots/points with it', () => {
    const source = paint(10, 4, (x) => [x * 20, 0, 0, 255]);
    const result = mirror(source, { boxes: [{ x: 1, y: 0, width: 3, height: 2 }], points: [{ x: 2, y: 1 }] });
    assert.deepEqual(pixel(result.image, 0, 0), pixel(source, 9, 0));
    assert.deepEqual(result.boxes, [{ x: 6, y: 0, width: 3, height: 2 }]);
    assert.deepEqual(result.points, [{ x: 8, y: 1 }]);
    const runtime = mirror(source, { boxes: [{ x: 100, y: 0, width: 300, height: 50 }], coordinateWidth: 2048 });
    assert.equal(runtime.boxes[0].x, 2048 - 100 - 300);
  });

  test('recolor moves only the chosen hue band (green wallpaper -> oxblood)', () => {
    const { image, changed } = recolor(town(), { hueFrom: [100, 200], hueTo: 350, satMul: 1.6, minSat: 15 });
    assert.equal(changed, 6 * 64);
    const wall = pixel(image, 5, 36);
    assert.ok(wall[0] > wall[1] && wall[0] > 100, `wall is red now (${wall})`);
    assert.deepEqual(pixel(image, 5, 15).slice(0, 3), pixel(town(), 5, 15).slice(0, 3).map((value, index) => pixel(image, 5, 15)[index]));
    const roofBefore = pixel(town(), 5, 15), roofAfter = pixel(image, 5, 15);
    assert.ok(Math.abs(roofBefore[0] - roofAfter[0]) <= 2, 'roof hue is outside the band');
  });

  test('Pillow HSV round trip is stable for greys and saturated colours', () => {
    for (const rgb of [[0, 0, 0], [128, 128, 128], [255, 0, 0], [60, 140, 70], [12, 200, 250]] as const) {
      const [h, s, v] = rgbToHsvPil(rgb[0], rgb[1], rgb[2]);
      const back = hsvToRgbPil(h, s, v);
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(back[c] - rgb[c]) <= 3, `${rgb} -> ${back}`);
    }
  });

  test('compose adds a prop with a shadow and removes a rectangle', () => {
    const base = paint(40, 40, () => [100, 100, 100, 255]);
    const prop = paint(6, 8, (x, y) => (y < 7 ? [200, 0, 0, 255] : [0, 0, 0, 0]));
    const out = compose(base, { add: [{ image: prop, x: 20, y: 30 }] });
    assert.deepEqual(pixel(out, 20, 28), [200, 0, 0, 255]);
    assert.ok(pixel(out, 18, 31)[0] < 100, 'shadow under the prop');
    const marked = paint(20, 5, (x) => (x >= 8 && x < 12 ? [0, 0, 0, 255] : [180, 180, 180, 255]));
    const cleaned = compose(marked, { remove: [{ x0: 8, y0: 0, x1: 11, y1: 4 }] });
    assert.deepEqual(pixel(cleaned, 10, 2), [180, 180, 180, 255]);
  });

  test('median cut keeps at most N colours and maps similar colours together', () => {
    const gradient = paint(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2, 255]);
    const out = medianCut(gradient, 16);
    assert.ok(countColors(out) <= 16);
    let error = 0;
    for (let i = 0; i < out.data.length; i += 4) error += Math.abs(out.data[i] - gradient.data[i]);
    assert.ok(error / (64 * 64) < 20, `mean error ${error / 4096}`);
  });
});

describe('golden pictures (harbour at night, clock shop wallpaper)', () => {
  const repo = realRepoRoot();
  const library = path.join(repo, 'Claude outputs', 'thu-vien-dot0', 'files');
  const reference = path.join(repo, 'Claude outputs', 'vu-an-claude', 'tham-khao');
  const available = existsSync(path.join(library, 'outdoor_map', 'map-ben-cang.png')) && existsSync(path.join(reference, 'ben-cang-ban-dem.png'));
  const why = 'ảnh gốc và ảnh mẫu chỉ có trên máy Yen (Claude outputs/, không vào git)';

  const compare = (a: Rgba, b: Rgba, channels: number) => {
    let sum = 0, big = 0;
    for (let i = 0; i < a.width * a.height; i++) {
      let worst = 0;
      for (let c = 0; c < channels; c++) {
        const d = Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
        sum += d;
        if (d > worst) worst = d;
      }
      if (worst > 32) big++;
    }
    return { mean: sum / (a.width * a.height * channels), bigShare: big / (a.width * a.height) };
  };

  test('night of map-ben-cang matches the prototype within a small tolerance', { skip: !available && why }, async () => {
    const map = await loadRgba(readFileSync(path.join(library, 'outdoor_map', 'map-ben-cang.png')));
    const lights = [[233, 145, 30], [233, 267, 30], [322, 342, 30], [484, 85, 26], [281, 250, 16]].map(([x, y, r]) => ({ x, y, r }));
    const windows = [[32, 203, 57, 229], [88, 203, 113, 229], [144, 203, 169, 229], [32, 245, 57, 271], [144, 245, 169, 271],
      [32, 425, 57, 452], [144, 425, 169, 452], [447, 196, 463, 214], [414, 396, 430, 412]].map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 }));
    const out = await night(map, { lights, windows });
    const result = compare(out, await loadRgba(readFileSync(path.join(reference, 'ben-cang-ban-dem.png'))), 3);
    assert.ok(result.mean < 1.5, `mean channel difference ${result.mean.toFixed(3)}`);
    assert.ok(result.bigShare < 0.02, `pixels off by more than 32: ${(result.bigShare * 100).toFixed(2)}%`);
  });

  test('mirror + recolor of room-tiem-dong-ho matches the prototype exactly', { skip: !available && why }, async () => {
    const room = await loadRgba(readFileSync(path.join(library, 'interior', 'room-tiem-dong-ho.png')));
    const { image } = recolor(mirror(room).image, { hueFrom: [100, 200], hueTo: 350, satMul: 1.6, minSat: 15 });
    const result = compare(image, await loadRgba(readFileSync(path.join(reference, 'tiem-dong-ho-bien-the.png'))), 4);
    assert.ok(result.mean < 0.05, `mean channel difference ${result.mean.toFixed(4)}`);
  });
});

describe('asset_variant tool', () => {
  test('writes the variant, a before/after picture and a library entry with parentKey and recipe', async () => {
    const repo = tempRepo();
    try {
      const ctx = testContext(repo.root, 'https://sirlocked.id.vn');
      const file = path.join(repo.root, 'tmp', 'library-build', 'map-x', 'main.png');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, await encode(town(), 'png'));
      writeFileSync(ctx.config.libraryIndexPath, JSON.stringify({ version: 1, description: '', items: [{
        key: 'map-x', kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', tags: ['ben-cang'], nameVi: 'Bến X', nameEn: 'X harbour', url: '', thumbUrl: '',
        width: 64, height: 64, parentKey: '', variant: '', source: 'PIXELLAB', pixelLabJobId: 'job', firstUsedByCaseId: '', prompt: 'p', files: {}, retired: false,
        local: { files: { main: 'tmp/library-build/map-x/main.png' } },
      }] }));
      const result: any = await assetVariant(ctx, { type: 'night', input: 'map-x', params: { lights: [[40, 50, 10]], windows: [[8, 24, 16, 30]] } });
      assert.equal(result.key, 'map-x-night');
      assert.equal(result.pixelLabCredits, 0);
      assert.ok(existsSync(path.join(repo.root, result.compare)));
      const compareImage = await loadRgba(readFileSync(path.join(repo.root, result.compare)));
      assert.equal(compareImage.width, 64 + 8 + 64);
      const entry = loadIndex(ctx.config.libraryIndexPath).items.find((item) => item.key === 'map-x-night')!;
      assert.equal(entry.parentKey, 'map-x');
      assert.equal(entry.source, 'VARIANT');
      assert.equal(entry.world, 'HANG_DUONG_VICTORIAN');
      assert.deepEqual(JSON.parse(entry.variant).type, 'night');
      assert.deepEqual(JSON.parse(entry.variant).lights, [[40, 50, 10]]);
      assert.equal(entry.nameVi, 'Bến X (ban đêm)');
      const mirrored: any = await assetVariant(ctx, { type: 'mirror', input: 'map-x', params: { boxes: [{ x: 4, y: 4, width: 10, height: 10 }] } });
      assert.deepEqual(mirrored.boxes, [{ x: 50, y: 4, width: 10, height: 10 }]);
      await assert.rejects(assetVariant(ctx, { type: 'recolor', input: 'map-x', params: {} }), /hueFrom/);
    } finally {
      repo.cleanup();
    }
  });
});
