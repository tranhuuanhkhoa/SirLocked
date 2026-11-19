// Checks of the music library index (VUAN-5): every file exists with the recorded sha256 and size, licences are on the
// allowed list, every area of the three worlds has a song, shared moods are covered, sizes stay within budget, loop
// points are usable by the game. Plain node --test so CI runs it next to the other asset checks (npm run test:music).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loopPoints } from '../Client/js/game/atmosphere/musicCore.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, '..', 'public');
const repoRoot = path.resolve(here, '..', '..', '..');
const musicRoot = path.join(publicRoot, 'assets', 'audio', 'music');
const index = JSON.parse(readFileSync(path.join(musicRoot, 'index.json'), 'utf8'));
const tracks = index.tracks;

const MiB = 1024 * 1024;
const MAX_FILE_BYTES = 1.5 * MiB;
const MAX_TOTAL_BYTES = 40 * MiB;
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
/** Source -> licences it may carry (plan: OpenGameArt CC0 only, Kenney CC0, Pixabay licence, Claude's own songs). */
const ALLOWED = {
  opengameart: { 'CC0 1.0': CC0 },
  kenney: { 'Kenney CC0': CC0 },
  pixabay: { 'Pixabay Content License': 'https://pixabay.com/service/license-summary/' },
  'claude-8bit': { 'Sir Locked (tự sáng tác)': null },
};
/** The areas the plan asks for (VUAN-5 table), per world, and the shared moods. Kept here, not read from the index. */
const REQUIRED_AREAS = {
  HANG_DUONG_VICTORIAN: ['street', 'harbor', 'train_station', 'market', 'lake_park', 'villa_district',
    'shop', 'tavern', 'tea_room', 'police_station', 'theater', 'study'],
  TAISHO_JAPAN: ['lantern_street', 'tram_station', 'shrine_garden', 'tea_house', 'tatami_lodging', 'kabuki_backstage'],
  SHANGHAI_1930: ['concession_street', 'river_bund', 'shikumen_alley', 'tea_house', 'singing_hall', 'mahjong_parlor', 'detective_office'],
};
const SHARED_MOODS = ['dieu-tra-yen', 'cang-thang', 'bi-an', 'lat-mat', 'buon', 'ket-thuc'];

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const local = (url) => path.join(publicRoot, ...url.split('/').filter(Boolean));

test('index shape: version, licences, worlds, moods, 24-30 songs with unique ids', () => {
  assert.equal(index.version, 1);
  assert.ok(Array.isArray(tracks));
  assert.ok(tracks.length >= 24 && tracks.length <= 30, `${tracks.length} bài`);
  assert.equal(new Set(tracks.map((track) => track.id)).size, tracks.length, 'id trùng');
  for (const world of [...Object.keys(REQUIRED_AREAS), 'ALL']) assert.ok(index.worlds[world], world);
  for (const mood of SHARED_MOODS) assert.ok(index.moods[mood], mood);
  for (const [name, licence] of Object.entries(index.licenses)) {
    assert.ok(licence.summaryVi?.length > 10, `${name}: thiếu tóm tắt giấy phép`);
  }
});

for (const track of tracks) {
  test(`${track.id}: fields, licence, files, sha256, size, loop points`, () => {
    assert.match(track.id, /^[a-z0-9-]+$/);
    const world = index.worlds[track.world];
    assert.ok(world, `thế giới lạ ${track.world}`);
    const base = `/assets/audio/music/${world.folder}/`;
    assert.ok(track.file.startsWith(base) && track.file.endsWith('.ogg'), track.file);
    assert.equal(track.fallback, track.file.replace(/\.ogg$/, '.mp3'));
    for (const field of ['title', 'author', 'labelVi', 'source', 'sourceUrl', 'license']) {
      assert.equal(typeof track[field], 'string', field);
      assert.ok(track[field].trim().length > 0, field);
    }

    // Licence: only the allowed pairs, with the licence text link; CC0 sources keep the original's sha256 and date.
    const allowed = ALLOWED[track.source];
    assert.ok(allowed, `nguồn không cho phép: ${track.source}`);
    assert.ok(Object.hasOwn(allowed, track.license), `${track.source} không được dùng giấy phép ${track.license}`);
    assert.equal(track.licenseUrl ?? null, allowed[track.license]);
    assert.ok(index.licenses[track.license], `bảng giấy phép thiếu ${track.license}`);
    if (track.source === 'claude-8bit') {
      assert.match(track.sourceUrl, /^tools\/music-gen\/songs\/[a-z0-9-]+\.json$/);
      assert.ok(existsSync(path.join(repoRoot, track.sourceUrl)), track.sourceUrl);
    } else {
      const page = { opengameart: /^https:\/\/opengameart\.org\/content\/[a-z0-9-]+$/, kenney: /^https:\/\/kenney\.nl\//, pixabay: /^https:\/\/pixabay\.com\/music\// }[track.source];
      assert.match(track.sourceUrl, page);
      assert.match(track.original?.sha256 ?? '', /^[0-9a-f]{64}$/, 'thiếu sha256 file gốc');
      assert.match(track.original?.downloadedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, 'thiếu ngày tải');
      assert.match(track.original?.file ?? '', /^https:\/\//);
    }

    // Area, mood, tempo.
    assert.ok(Array.isArray(track.areas) && Array.isArray(track.moods) && track.moods.length > 0);
    for (const area of track.areas) assert.ok(world.areas[area], `${track.world} không có khu ${area}`);
    for (const mood of track.moods) assert.ok(index.moods[mood], `mood lạ ${mood}`);
    if (track.world === 'ALL') assert.deepEqual(track.areas, []);
    assert.ok(Number.isInteger(track.bpm) && track.bpm >= 40 && track.bpm <= 220, `bpm ${track.bpm}`);

    // Files: present, unchanged since the index was written, real Ogg Vorbis / MP3, within the size budget.
    const ogg = local(track.file), mp3 = local(track.fallback);
    assert.ok(existsSync(ogg), track.file);
    assert.ok(existsSync(mp3), track.fallback);
    assert.equal(sha256(ogg), track.sha256, `${track.file}: sha256 không khớp`);
    assert.equal(sha256(mp3), track.fallbackSha256, `${track.fallback}: sha256 không khớp`);
    assert.equal(statSync(ogg).size, track.bytes);
    assert.equal(statSync(mp3).size, track.fallbackBytes);
    assert.ok(track.bytes <= MAX_FILE_BYTES, `${track.file}: ${(track.bytes / MiB).toFixed(2)} MiB`);
    assert.ok(track.fallbackBytes <= MAX_FILE_BYTES, `${track.fallback}: ${(track.fallbackBytes / MiB).toFixed(2)} MiB`);
    const head = readFileSync(ogg).subarray(0, 64);
    assert.equal(head.subarray(0, 4).toString('latin1'), 'OggS');
    assert.ok(head.includes(Buffer.from('vorbis')), 'không phải Vorbis');
    const start = readFileSync(mp3).subarray(0, 3);
    assert.ok(start.toString('latin1') === 'ID3' || (start[0] === 0xff && (start[1] & 0xe0) === 0xe0), 'không phải MP3');

    // Loop points the game accepts as they are, a quiet but present level (-16 LUFS), a volume for the case JSON.
    assert.equal(track.loopStartSec, 0);
    assert.ok(track.durationSec > 8 && track.durationSec <= 100, `${track.durationSec}s`);
    assert.ok(Math.abs(track.loopEndSec - track.durationSec) < 0.01);
    assert.deepEqual(loopPoints(track, track.durationSec), { start: track.loopStartSec, end: track.loopEndSec });
    assert.ok(Math.abs(track.loudness.integratedLufs + 16) <= 1.5, `${track.loudness.integratedLufs} LUFS`);
    assert.ok(track.loudness.truePeakDb <= -1, `true peak ${track.loudness.truePeakDb}`);
    assert.ok(track.volume > 0 && track.volume <= 1);
  });
}

test('every world has a song for every area of the plan, shared moods have a song for every world', () => {
  for (const [world, areas] of Object.entries(REQUIRED_AREAS)) {
    for (const area of areas) {
      const found = tracks.filter((track) => track.world === world && track.areas.includes(area));
      assert.ok(found.length > 0, `${world} / ${area}: chưa có bài`);
    }
  }
  for (const mood of SHARED_MOODS) {
    assert.ok(tracks.some((track) => track.world === 'ALL' && track.moods.includes(mood)), `mood ${mood}: chưa có bài dùng chung`);
  }
});

test('size budget: total of every .ogg and .mp3 within 40 MiB; no file outside the index', () => {
  const listed = new Set(tracks.flatMap((track) => [local(track.file), local(track.fallback)]));
  const onDisk = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ogg|mp3|wav|flac)$/i.test(name)) onDisk.push(full);
    }
  };
  walk(musicRoot);
  for (const file of onDisk) assert.ok(listed.has(file), `file nhạc không có trong index: ${path.relative(publicRoot, file)}`);
  const total = onDisk.reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(total <= MAX_TOTAL_BYTES, `tổng ${(total / MiB).toFixed(1)} MiB`);
});

test('cases in the repository only point at music that is in the library', () => {
  const byUrl = new Map(tracks.map((track) => [track.file, track]));
  const folders = [path.join(repoRoot, 'src', 'BE', 'Tests', 'Fixtures'), path.join(repoRoot, 'src', 'BE', 'SeedData')];
  const files = folders.filter(existsSync).flatMap(function list(dir) {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? list(full) : name.endsWith('.json') ? [full] : [];
    });
  });
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('/assets/audio/music/')) continue;
    const json = JSON.parse(text);
    for (const scene of (json.stages ?? []).flatMap((stage) => stage.scenes ?? [])) {
      const music = scene.runtime?.audio?.music;
      if (!music) continue;
      const where = `${path.basename(file)} ${scene.sceneId}`;
      const track = byUrl.get(music.url);
      assert.ok(track, `${where}: ${music.url} không có trong thư viện`);
      // Same fields music_search hands out: a loop end rounded to milliseconds would cut the song a few samples early.
      assert.equal(music.fallbackUrl, track.fallback, where);
      assert.deepEqual([music.title, music.source, music.license], [track.title, track.source, track.license], where);
      assert.equal(music.loopStartSec, track.loopStartSec, where);
      assert.equal(music.loopEndSec, track.loopEndSec, where);
      checked++;
    }
  }
  assert.ok(checked > 0, 'vụ mẫu phải có nhạc từ thư viện');
});
