import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { createContext } from '../src/tools/context.js';
import { libraryMusic, musicSearch } from '../src/tools/music.js';
import { realRepoRoot, testConfig } from './helpers.js';

// Reads the game's real music index (src/FE/public/assets/audio/music/index.json).
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'studio-music-'));
const ctx = createContext({ ...testConfig(realRepoRoot(), 'http://127.0.0.1:9'), tmpRoot });
after(() => rmSync(tmpRoot, { recursive: true, force: true }));
const MUSIC_KEYS = ['fallbackUrl', 'license', 'loopEndSec', 'loopStartSec', 'source', 'title', 'url', 'volume'];

describe('music_search', () => {
  test('world + area: the area song first, with a music object ready for atmosphere.audio.music and a licence summary', () => {
    const found = musicSearch(ctx, { world: 'HANG_DUONG_VICTORIAN', area: 'harbor' });
    assert.ok(found.total >= 2);
    for (const entry of found.results) {
      assert.equal(entry.world, 'HANG_DUONG_VICTORIAN');
      assert.ok(entry.areas.includes('harbor'));
      assert.equal(entry.match, 'area');
      assert.deepEqual(Object.keys(entry.music).sort(), MUSIC_KEYS);
      assert.match(entry.music.url, /^\/assets\/audio\/music\/hang-duong\/[a-z0-9-]+\.ogg$/);
      assert.equal(entry.music.fallbackUrl, entry.music.url.replace(/\.ogg$/, '.mp3'));
      assert.ok(entry.music.loopEndSec > entry.music.loopStartSec);
      assert.ok(entry.licenseSummary.length > 10);
      const file = path.join(realRepoRoot(), 'src', 'FE', 'public', ...entry.url.split('/').filter(Boolean));
      assert.ok(existsSync(file), file);
    }
    assert.ok(found.results.some((entry) => entry.source === 'claude-8bit'), 'bản 8-bit của vụ mẫu vẫn là một lựa chọn');
  });

  test('the area may be a Vietnamese name or a picture library key/tag, accents optional', () => {
    const byKey = musicSearch(ctx, { area: 'j-map-pho-den-long' });
    assert.equal(byKey.results[0].world, 'TAISHO_JAPAN');
    assert.ok(byKey.results[0].areas.includes('lantern_street'));
    const byVi = musicSearch(ctx, { world: 'thuong-hai', area: 'tra lau' });
    assert.deepEqual(byVi.areasMatched, [{ world: 'SHANGHAI_1930', area: 'tea_house' }]);
    assert.ok(byVi.results.every((entry) => entry.world === 'SHANGHAI_1930'));
    const byTag = musicSearch(ctx, { area: 'ben-cang' });
    assert.ok(byTag.results.every((entry) => entry.areas.includes('harbor')));
    // tea_house exists in two worlds: without a world both answer.
    const both = musicSearch(ctx, { area: 'tea_house', limit: 20 });
    assert.deepEqual(new Set(both.results.map((entry) => entry.world)), new Set(['TAISHO_JAPAN', 'SHANGHAI_1930']));
  });

  test('area + mood: area songs with the mood first, then shared songs of that mood', () => {
    const found = musicSearch(ctx, { world: 'SHANGHAI_1930', area: 'detective_office', mood: 'cang-thang', limit: 20 });
    assert.equal(found.results[0].areas.includes('detective_office'), true);
    const shared = found.results.filter((entry) => entry.match === 'mood');
    assert.ok(shared.length > 0);
    for (const entry of shared) {
      assert.equal(entry.world, 'ALL');
      assert.ok(entry.moods.includes('cang-thang'));
    }
  });

  test('mood alone (slug or Vietnamese) and world alone: a world lists its own songs before the shared ones', () => {
    const sad = musicSearch(ctx, { mood: 'buồn', limit: 50 });
    assert.ok(sad.total > 0 && sad.results.every((entry) => entry.moods.includes('buon')));
    const world = musicSearch(ctx, { world: 'TAISHO_JAPAN', limit: 100 });
    const firstShared = world.results.findIndex((entry) => entry.world === 'ALL');
    assert.ok(firstShared > 0);
    assert.ok(world.results.slice(firstShared).every((entry) => entry.world === 'ALL'));
    assert.ok(world.results.every((entry) => ['TAISHO_JAPAN', 'ALL'].includes(entry.world)));
    const query = musicSearch(ctx, { query: 'harpsichord' });
    assert.ok(query.results.some((entry) => /harpsichord/i.test(entry.title + entry.labelVi)));
  });

  test('every song of the library is reachable, licences are from the allowed list', () => {
    const all = musicSearch(ctx, { limit: 100 });
    assert.ok(all.total >= 24 && all.total <= 30);
    for (const entry of all.results) {
      assert.ok(['CC0 1.0', 'Kenney CC0', 'Pixabay Content License', 'Sir Locked (tự sáng tác)'].includes(entry.license), entry.license);
    }
  });

  test('libraryMusic gives the same music object by id (weather_preview musicId)', () => {
    const first = musicSearch(ctx, { world: 'TAISHO_JAPAN', area: 'lantern_street' }).results[0];
    assert.deepEqual(libraryMusic(ctx, first.id), first.music);
    assert.throws(() => libraryMusic(ctx, 'khong-co-bai-nay'), /Không có bài/);
  });

  test('unknown world, area or mood is a clear error, not an empty list', () => {
    assert.throws(() => musicSearch(ctx, { world: 'ATLANTIS' }), /Thế giới lạ/);
    assert.throws(() => musicSearch(ctx, { area: 'moon_base' }), /Khu lạ/);
    assert.throws(() => musicSearch(ctx, { world: 'TAISHO_JAPAN', area: 'harbor' }), /Khu lạ/);
    assert.throws(() => musicSearch(ctx, { mood: 'hype' }), /Mood lạ/);
  });
});
