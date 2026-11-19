import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { StudioError } from '../src/bridge-client.js';
import { assetDownload } from '../src/tools/draft.js';
import { encode } from '../src/image/raster.js';
import { paint, startFakeBridge, tempRepo, testContext, type FakeBridge } from './helpers.js';

async function expectStudioError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof StudioError, `expected StudioError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return;
  }
  assert.fail(`expected ${code}`);
}

describe('asset_download fetches a picture the draft already has', () => {
  const draftId = 'cccccccccccccccccccccccc';
  const repo = tempRepo();
  let bridge: FakeBridge;
  let pictures: http.Server;
  let fetched: string[];
  let ctx: ReturnType<typeof testContext>;

  before(async () => {
    const png = await encode(paint(8, 6, () => [10, 20, 30, 255]), 'png');
    fetched = [];
    pictures = http.createServer((req, res) => {
      fetched.push(req.url ?? '');
      if (req.url === '/bg.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png); }
      if (req.url === '/note.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('not a picture'); }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => pictures.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(pictures.address() as AddressInfo).port}`;
    bridge = await startFakeBridge({
      [`GET /api/bridge/drafts/${draftId}/assets-needed`]: () => ({
        body: {
          draftId, storageAvailable: true,
          slots: [
            { slotId: 'scene-bg:loc-a', kind: 'SCENE_BACKGROUND', targetId: 'loc-a', width: 512, height: 512, currentUrl: `${base}/bg.png` },
            { slotId: 'scene-bg:loc-empty', kind: 'SCENE_BACKGROUND', targetId: 'loc-empty', width: 512, height: 512 },
            { slotId: 'scene-bg:loc-text', kind: 'SCENE_BACKGROUND', targetId: 'loc-text', width: 512, height: 512, currentUrl: `${base}/note.txt` },
            { slotId: 'scene-bg:loc-far', kind: 'SCENE_BACKGROUND', targetId: 'loc-far', width: 512, height: 512, currentUrl: 'http://pictures.invalid/bg.png' },
            { slotId: 'scene-bg:loc-file', kind: 'SCENE_BACKGROUND', targetId: 'loc-file', width: 512, height: 512, currentUrl: 'file:///etc/passwd' },
          ],
        },
      }),
    });
    ctx = testContext(repo.root, bridge.url);
  });
  after(async () => {
    await bridge.close();
    await new Promise<void>((resolve) => pictures.close(() => resolve()));
    repo.cleanup();
  });

  test('saves the slot picture under tmp/bridge/<draftId>/assets', async () => {
    const result = await assetDownload(ctx, { draftId, slotId: 'scene-bg:loc-a' });
    assert.equal(result.file, `tmp/bridge/${draftId}/assets/scene-bg_loc-a.png`);
    assert.equal(result.width, 8);
    assert.equal(result.height, 6);
    assert.equal(result.targetId, 'loc-a');
    const saved = path.join(repo.root, 'tmp', 'bridge', draftId, 'assets', 'scene-bg_loc-a.png');
    assert.ok(existsSync(saved));
    assert.equal(readFileSync(saved).subarray(1, 4).toString('latin1'), 'PNG');
  });

  test('a slot the draft does not have is refused', async () => {
    await expectStudioError(assetDownload(ctx, { draftId, slotId: 'scene-bg:nowhere' }), 'SLOT_NOT_FOUND');
  });

  test('a slot with no picture yet is refused', async () => {
    await expectStudioError(assetDownload(ctx, { draftId, slotId: 'scene-bg:loc-empty' }), 'NO_PICTURE');
  });

  test('only https, or the bridge host itself, is fetched', async () => {
    const before = fetched.length;
    await expectStudioError(assetDownload(ctx, { draftId, slotId: 'scene-bg:loc-far' }), 'URL_NOT_ALLOWED');
    await expectStudioError(assetDownload(ctx, { draftId, slotId: 'scene-bg:loc-file' }), 'URL_NOT_ALLOWED');
    assert.equal(fetched.length, before);
  });

  test('a download that is not a picture is not saved', async () => {
    await expectStudioError(assetDownload(ctx, { draftId, slotId: 'scene-bg:loc-text' }), 'ASSET_FORMAT');
    assert.ok(!existsSync(path.join(repo.root, 'tmp', 'bridge', draftId, 'assets', 'scene-bg_loc-text.txt')));
  });
});
