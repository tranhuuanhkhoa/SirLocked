import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { blipPreview, sfxSearch, weatherPreview } from '../src/tools/atmosphere.js';
import { createContext } from '../src/tools/context.js';
import { realRepoRoot, testConfig } from './helpers.js';

// These tools read the game's own code and sound pack, so they run against the real repository; files go to a temp tmp/.
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'studio-atmosphere-'));
const ctx = createContext({ ...testConfig(realRepoRoot(), 'http://127.0.0.1:9'), tmpRoot });
const sample = 'src/BE/Tests/Fixtures/case-pixel-dong-ho-dem-mua-vi.json';
after(() => rmSync(tmpRoot, { recursive: true, force: true }));

describe('blip_preview', () => {
  test('one WAV per character, rendered with the game code; the three voices of the sample case differ', async () => {
    const result = await blipPreview(ctx, { casePath: sample });
    assert.equal(result.characters.length, 3);
    assert.deepEqual(result.similarVoices, []);
    const waves = result.characters.map((entry) => entry.voice.wave).sort();
    assert.deepEqual(waves, ['sine', 'square', 'triangle']);
    for (const entry of result.characters) {
      assert.equal(entry.authored, true);
      assert.ok(entry.blips > 10);
      const file = path.isAbsolute(entry.file) ? entry.file : path.resolve(realRepoRoot(), entry.file);
      assert.ok(existsSync(file), file);
      const bytes = readFileSync(file);
      assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
      assert.ok(bytes.length > 44 + 22050);
    }
  });

  test('a character without voice.blip gets the default voice of its id; the same text renders the same file', async () => {
    const first = await blipPreview(ctx, { casePath: 'src/BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json', characterIds: ['char-px-ly-hanh'], text: 'Tôi không thấy ai.' });
    const second = await blipPreview(ctx, { casePath: 'src/BE/SeedData/V3/case-pixel-lo-thuoc-thu-nam-vi.json', characterIds: ['char-px-ly-hanh'], text: 'Tôi không thấy ai.' });
    assert.equal(first.characters[0].authored, false);
    assert.deepEqual(first.characters[0].voice, second.characters[0].voice);
    await assert.rejects(() => blipPreview(ctx, { casePath: sample, characterIds: ['nobody'] }), /Không có nhân vật/);
    await assert.rejects(() => blipPreview(ctx, {}), /casePath/);
  });
});

describe('sfx_search', () => {
  test('finds sounds by puzzle kind, cue and accent-free label, with source and CC0 licence', () => {
    const lockpick = sfxSearch(ctx, { kind: 'lockpick' });
    assert.deepEqual(lockpick.results.map((entry) => entry.use.event).sort(), ['probe', 'solve', 'tap', 'wrong']);
    for (const entry of lockpick.results) assert.match(entry.license, /^CC0/);
    const discovery = sfxSearch(ctx, { cue: 'discovery' });
    assert.equal(discovery.total, 1);
    assert.equal(discovery.results[0].file, '/assets/audio/sfx/ui/discovery.ogg');
    const paper = sfxSearch(ctx, { query: 'giay' });
    assert.ok(paper.results.some((entry) => entry.use.puzzleKind === 'doc_forgery'));
    assert.ok(paper.results.some((entry) => entry.use.puzzleKind === 'torn_paper'));
    const withFallback = sfxSearch(ctx, { query: 'du phong', includeFallback: true });
    assert.ok(withFallback.results.some((entry) => entry.file.includes('/tu-tong-hop/')));
    assert.equal(sfxSearch(ctx, { query: 'du phong' }).total, 0);
  });
});

describe('weather_preview', () => {
  test('refuses a remote web address and bad values before starting anything', async () => {
    await assert.rejects(() => weatherPreview(ctx, { casePath: sample, webUrl: 'https://sirlocked.id.vn' }), /máy này/);
    await assert.rejects(() => weatherPreview(ctx, { casePath: sample, weather: 'HAIL' as any }), /weather phải là/);
    await assert.rejects(() => weatherPreview(ctx, { casePath: sample, sceneId: 'scene-none' }), /Không có cảnh/);
    await assert.rejects(() => weatherPreview(ctx, { casePath: sample, musicId: 'khong-co-bai-nay' }), /Không có bài/);
  });
});
