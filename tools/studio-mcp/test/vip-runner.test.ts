import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { saveRgba } from '../src/image/raster.js';
import { libraryUrlFor, runOnce, VIP_LANE } from '../src/vipRunner.js';
import { paint, startFakeBridge, tempRepo, testContext, type FakeBridge } from './helpers.js';

/**
 * VUAN-7: the VIP image runner takes only VIP-lane image requests, copies library pictures and makes variants into
 * the requested slots, uploads them and completes the request; a plan that needs PixelLab is released, not run.
 */
describe('VIP image runner', () => {
  let repo: ReturnType<typeof tempRepo>;
  let pictures: Record<string, Uint8Array>;
  const silent = { info: () => undefined, warn: () => undefined };

  before(async () => {
    repo = tempRepo();
    const make = async (name: string, width: number, height: number) => {
      const file = path.join(os.tmpdir(), `vip-runner-${name}-${process.pid}.png`);
      await saveRgba(paint(width, height, (x, y) => [(x * 7) % 255, (y * 5) % 255, 120, 255]), file);
      return new Uint8Array(readFileSync(file));
    };
    pictures = {
      'https://cdn.test/scene.png': await make('scene', 512, 512),
      'https://cdn.test/npc-idle.png': await make('idle', 1152, 128),
      'https://cdn.test/npc-portrait.png': await make('portrait', 288, 288),
    };
  });
  after(() => repo.cleanup());

  const library = [
    { key: 'h-room-tiem', url: 'https://cdn.test/scene.png' },
    { key: 'h-npc-01', url: 'https://cdn.test/npc.png', files: { idle: 'https://cdn.test/npc-idle.png', portrait: 'https://cdn.test/npc-portrait.png' } },
  ];

  function bridge(subjects: unknown[], slots: unknown[]): Promise<FakeBridge> {
    return startFakeBridge({
      'GET /api/bridge/requests': () => ({ body: [{ requestId: 'req-1', kind: 'ASSETS', draftId: 'draft-1' }] }),
      'POST /api/bridge/requests/req-1/take': () => ({ body: { requestId: 'req-1' } }),
      'POST /api/bridge/requests/req-1/release': () => ({ body: { released: true } }),
      'GET /api/bridge/drafts/draft-1/assets-needed': () => ({ body: { pixel: { subjects }, slots } }),
      'GET /api/bridge/library': () => ({ body: library }),
      'POST /api/bridge/drafts/draft-1/assets': () => ({ body: { url: 'https://res.cloudinary.test/x.png', width: 512, height: 512, hasAlpha: true } }),
      'POST /api/bridge/drafts/draft-1/assets/complete': () => ({ body: { accepted: true } }),
    });
  }

  it('fills library and variant slots, then completes the request, all on the VIP lane', async () => {
    const fake = await bridge(
      [
        { subject: 'scene:a', slots: ['background:a'], source: 'LIBRARY', libraryKey: 'h-room-tiem' },
        { subject: 'scene:b', slots: ['background:b'], source: 'VARIANT', parentKey: 'h-room-tiem', variant: 'night' },
        { subject: 'character:c1', slots: ['character-sprite:c1', 'character-portrait:c1'], source: 'LIBRARY', libraryKey: 'h-npc-01' },
      ],
      [
        { slotId: 'background:a', width: 512, height: 512, requestedNow: true },
        { slotId: 'background:b', width: 512, height: 512, requestedNow: true },
        { slotId: 'character-sprite:c1', width: 1152, height: 128, transparent: true, requestedNow: true },
        { slotId: 'character-portrait:c1', width: 288, height: 288, requestedNow: true },
        { slotId: 'item:x', width: 64, height: 64, requestedNow: false },
      ]);
    try {
      const downloads: string[] = [];
      const result = await runOnce(testContext(repo.root, fake.url), silent, async (url) => { downloads.push(url); return pictures[url]; });

      assert.deepEqual(result.completed, ['draft-1']);
      assert.equal(result.uploaded, 4);
      assert.deepEqual(result.released, []);
      const list = fake.requests.find((item) => item.path === '/api/bridge/requests')!;
      assert.equal(list.query.get('lane'), VIP_LANE);
      const take = fake.requests.find((item) => item.path.endsWith('/take'))!;
      assert.equal(take.query.get('lane'), VIP_LANE);
      const uploads = fake.requests.filter((item) => item.path === '/api/bridge/drafts/draft-1/assets');
      assert.equal(uploads.length, 4);
      for (const slot of ['background:a', 'background:b', 'character-sprite:c1', 'character-portrait:c1'])
        assert.ok(uploads.some((item) => item.body.toString('latin1').includes(slot)), `uploaded ${slot}`);
      assert.ok(downloads.includes('https://cdn.test/npc-idle.png'));
      assert.ok(fake.requests.some((item) => item.path.endsWith('/assets/complete')));
    } finally {
      await fake.close();
    }
  });

  it('releases a request whose plan needs PixelLab, without uploading or completing', async () => {
    const fake = await bridge(
      [{ subject: 'character:c2', slots: ['character-sprite:c2'], source: 'PIXELLAB' }],
      [{ slotId: 'character-sprite:c2', width: 1152, height: 128, requestedNow: true }]);
    try {
      const result = await runOnce(testContext(repo.root, fake.url), silent, async (url) => pictures[url]);

      assert.deepEqual(result.completed, []);
      assert.equal(result.released.length, 1);
      assert.match(result.released[0].reason, /PixelLab/);
      assert.ok(fake.requests.some((item) => item.path.endsWith('/release')));
      assert.ok(!fake.requests.some((item) => item.path.endsWith('/assets/complete')));
      assert.ok(!fake.requests.some((item) => item.path === '/api/bridge/drafts/draft-1/assets'));
    } finally {
      await fake.close();
    }
  });

  it('picks the right library file for each slot kind', () => {
    const npc = { key: 'n', url: 'u', files: { idle: 'i', portrait: 'p' } };
    assert.equal(libraryUrlFor('character-sprite:x', npc), 'i');
    assert.equal(libraryUrlFor('character-portrait:x', npc), 'p');
    assert.equal(libraryUrlFor('background:x', npc), 'u');
    assert.equal(libraryUrlFor('item:x', { key: 'k', url: 'icon' }), 'icon');
  });
});
