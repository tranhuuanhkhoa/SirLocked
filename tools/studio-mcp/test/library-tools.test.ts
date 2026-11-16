import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StudioError } from '../src/bridge-client.js';
import { encode } from '../src/image/raster.js';
import { emptyItem, fold, loadIndex, saveIndex, search, type LibraryItem } from '../src/library/index-store.js';
import { createStudioServer, TOOL_NAMES } from '../src/server.js';
import { librarySearch, librarySync } from '../src/tools/library.js';
import { paint, startFakeBridge, tempRepo, testContext, type FakeBridge } from './helpers.js';

function item(key: string, patch: Partial<LibraryItem>): LibraryItem {
  return { ...emptyItem(key, patch.kind ?? 'ITEM', patch.world ?? 'ALL'), ...patch };
}

describe('library index and search', () => {
  const items = [
    item('map-ben-cang', { kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Bến cảng', nameEn: 'Harbour', tags: ['ben-cang'] }),
    item('j-room-nha-tra', { kind: 'INTERIOR', world: 'TAISHO_JAPAN', nameVi: 'Nhà trà', nameEn: 'Teahouse' }),
    item('all-item-kinh-lup', { kind: 'ITEM', world: 'ALL', nameVi: 'Kính lúp', nameEn: 'Magnifying glass' }),
    item('all-item-trang-giay-trang', { kind: 'ITEM', world: 'ALL', nameVi: 'Trang giấy trắng', retired: true }),
  ];

  test('world includes shared items, kind filters, retired is hidden unless asked', () => {
    assert.deepEqual(search(items, { world: 'TAISHO_JAPAN' }).map((entry) => entry.key), ['j-room-nha-tra', 'all-item-kinh-lup']);
    assert.deepEqual(search(items, { kind: 'item' }).map((entry) => entry.key), ['all-item-kinh-lup']);
    assert.equal(search(items, { kind: 'ITEM', includeRetired: true }).length, 2);
  });

  test('words match without Vietnamese accents', () => {
    assert.equal(fold('Bến Cảng Đêm'), 'ben cang dem');
    assert.deepEqual(search(items, { query: 'ben cang' }).map((entry) => entry.key), ['map-ben-cang']);
    assert.deepEqual(search(items, { query: 'kính' }).map((entry) => entry.key), ['all-item-kinh-lup']);
  });
});

describe('library_search and library_sync against the bridge', () => {
  let bridge: FakeBridge;
  const repo = tempRepo();
  let storage = true;
  const uploads: string[] = [];
  let lastUpsert: any[] = [];
  let ctx: ReturnType<typeof testContext>;
  before(async () => {
    bridge = await startFakeBridge({
      'GET /api/bridge/ping': () => ({ body: { ok: true, assetStorage: storage } }),
      'POST /api/bridge/library/files': (request) => {
        const text = request.body.toString('latin1');
        const key = /name="key"\r\n\r\n([^\r]+)/.exec(text)![1];
        const role = /name="role"\r\n\r\n([^\r]+)/.exec(text)![1];
        uploads.push(`${key}#${role}`);
        return { body: { key, role, url: `https://res.cloudinary.com/demo/library/${key}/${role}.webp`, width: 8, height: 8 } };
      },
      'PUT /api/bridge/library': (request) => {
        lastUpsert = request.json.items;
        return { body: { received: lastUpsert.length, inserted: lastUpsert.length, updated: 0, unchanged: 0 } };
      },
      'GET /api/bridge/library': () => ({
        body: [
          { key: 'map-ben-cang', kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', url: 'https://res.cloudinary.com/demo/library/map-ben-cang/main.webp', files: {}, tags: [] },
          { key: 'server-only', kind: 'PROP', world: 'ALL', url: 'https://res.cloudinary.com/demo/p.webp', files: {}, tags: [], nameVi: 'Đèn khí' },
        ],
      }),
    });
    ctx = testContext(repo.root, bridge.url);
    const build = path.join(repo.root, 'tmp', 'library-build', 'map-ben-cang');
    mkdirSync(build, { recursive: true });
    writeFileSync(path.join(build, 'main.webp'), await encode(paint(8, 8, () => [10, 20, 30, 255]), 'webp'));
    writeFileSync(path.join(build, 'thumb.webp'), await encode(paint(4, 4, () => [10, 20, 30, 255]), 'webp'));
    mkdirSync(path.join(repo.root, 'src', 'FE', 'public', 'assets', 'pixel', 'x'), { recursive: true });
    writeFileSync(path.join(repo.root, 'src', 'FE', 'public', 'assets', 'pixel', 'x', 'pho.png'), await encode(paint(4, 4, () => [1, 2, 3, 255]), 'png'));
    saveIndex(ctx.config.libraryIndexPath, {
      version: 1, description: 'test', items: [
        item('map-ben-cang', {
          kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', nameVi: 'Bến cảng',
          local: { files: { main: 'tmp/library-build/map-ben-cang/main.webp', thumb: 'tmp/library-build/map-ben-cang/thumb.webp' } },
        }),
        item('v-case-pho', { kind: 'OUTDOOR_MAP', world: 'HANG_DUONG_VICTORIAN', url: '/assets/pixel/x/pho.png', nameVi: 'Phố' }),
      ],
    });
  });
  after(async () => { await bridge.close(); repo.cleanup(); });

  test('push refuses clearly when the server has no picture storage', async () => {
    storage = false;
    await assert.rejects(librarySync(ctx, { direction: 'push' }), (error: unknown) => error instanceof StudioError && error.code === 'ASSET_STORAGE_UNAVAILABLE');
    assert.equal(uploads.length, 0);
    storage = true;
  });

  test('push uploads new files once, then sends entries without the local block', async () => {
    const first: any = await librarySync(ctx, { direction: 'push' });
    assert.equal(first.push.filesUploaded, 2);
    assert.deepEqual(uploads.sort(), ['map-ben-cang#main', 'map-ben-cang#thumb']);
    assert.equal(lastUpsert.length, 2);
    assert.ok(lastUpsert.every((entry) => !('local' in entry)));
    const map = lastUpsert.find((entry) => entry.key === 'map-ben-cang');
    assert.equal(map.url, 'https://res.cloudinary.com/demo/library/map-ben-cang/main.webp');
    assert.equal(map.thumbUrl, 'https://res.cloudinary.com/demo/library/map-ben-cang/thumb.webp');
    // The shipped picture keeps its /assets/ URL and is not uploaded.
    assert.equal(lastUpsert.find((entry) => entry.key === 'v-case-pho').url, '/assets/pixel/x/pho.png');
    const second: any = await librarySync(ctx, { direction: 'push' });
    assert.equal(second.push.filesUploaded, 0, 'unchanged files are not sent again');
    const saved = JSON.parse(readFileSync(ctx.config.libraryIndexPath, 'utf8'));
    assert.ok(saved.items.find((entry: any) => entry.key === 'map-ben-cang').local.uploadedSha256.main);
  });

  test('pull merges server entries into the index', async () => {
    const result: any = await librarySync(ctx, { direction: 'pull' });
    assert.equal(result.pull.added, 1);
    assert.ok(loadIndex(ctx.config.libraryIndexPath).items.some((entry) => entry.key === 'server-only'));
  });

  test('library_search with download copies local and shipped files into tmp/library-cache', async () => {
    const result: any = await librarySearch(ctx, { world: 'HANG_DUONG_VICTORIAN', kind: 'OUTDOOR_MAP', download: true });
    const byKey = Object.fromEntries(result.results.map((row: any) => [row.key, row]));
    assert.equal(byKey['map-ben-cang'].cached.main, 'tmp/library-cache/map-ben-cang/main.webp');
    assert.equal(byKey['v-case-pho'].cached.main, 'tmp/library-cache/v-case-pho/main.png');
  });
});

describe('MCP registration', () => {
  test('every tool is listed and a call without a key returns an error result, not a crash', async () => {
    const repo = tempRepo();
    try {
      const server = createStudioServer(testContext(repo.root, 'https://sirlocked.id.vn', ''));
      const client = new Client({ name: 'test', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
      for (const tool of tools.tools) assert.ok((tool.description ?? '').length > 20, `${tool.name} has a description`);
      const result: any = await client.callTool({ name: 'bridge_list', arguments: {} });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /BRIDGE_KEY_MISSING/);
      assert.match(result.content[0].text, /SIRLOCKED_BRIDGE_KEY/);
      const bad: any = await client.callTool({ name: 'draft_approve_gate', arguments: { draftId: 'x', gate: 'TRUTH', allChecksPassed: true } });
      assert.equal(bad.isError, true); // TRUTH is not even in the tool's schema
      await client.close();
    } finally {
      repo.cleanup();
    }
  });
});
