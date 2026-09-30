import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collectCaseAssetPaths, createCaseAssetManifest } from './case-assets.mjs';

test('collects and deduplicates only local public assets without copying private media routes', () => {
  const paths = collectCaseAssetPaths({ cover: '/assets/cover.png?v=2', scenes: [{ url: '/assets/cover.png' }],
    video: '/api/game/rooms/room/presentation/media/secret', external: 'https://example.org/asset.png' });
  assert.deepEqual([...paths], ['assets/cover.png']);
});
test('includes derived scene NPC sprites and excludes unrelated generated cases', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sirlocked-assets-'));
  try {
    const publicRoot = path.join(directory, 'public');
    const generated = path.join(publicRoot, 'assets', 'ai-generated');
    await fs.mkdir(generated, { recursive: true });
    for (const file of ['witness-portrait.png', 'witness-study-sprite.png', 'unrelated.png']) await fs.writeFile(path.join(generated, file), file);
    const file = path.join(directory, 'case.json');
    await fs.writeFile(file, JSON.stringify({ caseId: 'case', stages: [{ scenes: [{ sceneId: 'study' }] }], characters: [{ imageUrl: '/assets/ai-generated/witness-portrait.png' }] }));
    const manifest = await createCaseAssetManifest(publicRoot, [file]);
    assert.deepEqual(manifest.assets.map((asset) => asset.path), ['assets/ai-generated/witness-portrait.png', 'assets/ai-generated/witness-study-sprite.png']);
    assert.ok(manifest.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('sirlocked-assets-'));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
test('rejects plain and encoded path traversal before any copy', () => {
  for (const path of ['/assets/../secret', '/assets/%2e%2e/secret', '/assets/sub\\..\\secret'])
    assert.throws(() => collectCaseAssetPaths(path), /Unsafe/);
});
