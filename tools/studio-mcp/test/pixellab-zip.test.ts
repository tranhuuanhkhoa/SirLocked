import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { zipSync } from 'fflate';
import { StudioError } from '../src/bridge-client.js';
import { pixellabCharacterZip } from '../src/tools/pixellab.js';
import { encode } from '../src/image/raster.js';
import { paint, tempRepo, testContext } from './helpers.js';

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

describe('pixellab_character_zip saves a PixelLab character zip for npc_bundle', () => {
  const draftId = 'dddddddddddddddddddddddd';
  const good = '56bda86a-f412-4191-9f2e-408f17a9834d';
  const empty = '00000000-0000-4000-8000-000000000000';
  const repo = tempRepo();
  let server: http.Server;
  let paths: string[];
  let ctx: ReturnType<typeof testContext>;

  before(async () => {
    const png = await encode(paint(4, 4, () => [1, 2, 3, 255]), 'png');
    const zip = Buffer.from(zipSync({
      // Same layout as a real PixelLab download: everything under a state folder ("Idle/").
      'Idle/rotations/south.png': new Uint8Array(png),
      'Idle/animations/idle/south/frame_000.png': new Uint8Array(png),
      'Idle/animations/idle/south/frame_001.png': new Uint8Array(png),
      'metadata.json': new Uint8Array(Buffer.from('{}')),
    }));
    const noSouth = Buffer.from(zipSync({ 'rotations/north.png': new Uint8Array(png) }));
    paths = [];
    server = http.createServer((req, res) => {
      paths.push(req.url ?? '');
      if (req.url === `/mcp/characters/${good}/download`) { res.writeHead(200, { 'Content-Type': 'application/zip' }); return res.end(zip); }
      if (req.url === `/mcp/characters/${empty}/download`) { res.writeHead(200, { 'Content-Type': 'application/zip' }); return res.end(noSouth); }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    ctx = testContext(repo.root, 'http://127.0.0.1:1');
    ctx.config.pixellabBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    repo.cleanup();
  });

  test('saves character.zip under tmp/pixellab/<draftId>/chars/<npcId>', async () => {
    const result = await pixellabCharacterZip(ctx, { draftId, npcId: 'suspect-pho-khiem', characterId: good });
    assert.equal(result.file, `tmp/pixellab/${draftId}/chars/suspect-pho-khiem/character.zip`);
    assert.equal(result.idleFrames, 2);
    const saved = path.join(repo.root, 'tmp', 'pixellab', draftId, 'chars', 'suspect-pho-khiem', 'character.zip');
    assert.equal(readFileSync(saved).subarray(0, 2).toString('latin1'), 'PK');
  });

  test('a character id that is not a PixelLab uuid is refused before any request', async () => {
    const before = paths.length;
    await expectStudioError(pixellabCharacterZip(ctx, { draftId, npcId: 'x', characterId: '../../evil' }), 'BAD_ID');
    assert.equal(paths.length, before);
  });

  test('a zip without rotations/south.png is not saved', async () => {
    await expectStudioError(pixellabCharacterZip(ctx, { draftId, npcId: 'npc-empty', characterId: empty }), 'ZIP_INVALID');
    assert.ok(!existsSync(path.join(repo.root, 'tmp', 'pixellab', draftId, 'chars', 'npc-empty', 'character.zip')));
  });

  test('a character PixelLab does not have reports the status', async () => {
    await expectStudioError(
      pixellabCharacterZip(ctx, { draftId, npcId: 'npc-missing', characterId: '11111111-1111-4111-8111-111111111111' }), 'DOWNLOAD_FAILED');
  });
});
