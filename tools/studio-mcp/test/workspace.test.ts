import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { resolveInput, resolveOutput } from '../src/files.js';
import { readWorkspace, writeWorkspace } from '../src/tools/workspace.js';
import { tempRepo, testContext } from './helpers.js';

test('unattended file tools assemble an answer and reject paths outside the workflow', async () => {
  const repo = tempRepo();
  try {
    const ctx = testContext(repo.root, 'http://127.0.0.1');
    ctx.config.unattended = true;
    const file = 'tmp/bridge/req-1/answer.json';
    writeWorkspace(ctx, { file, text: '{"title":"Hồ' });
    writeWorkspace(ctx, { file, text: ' sơ"}', append: true });
    const result = await readWorkspace(ctx, { file });
    const content = result.content[0];
    assert.equal(content.type, 'text');
    assert.equal(JSON.parse(JSON.parse(content.text).text).title, 'Hồ sơ');
    assert.throws(() => writeWorkspace(ctx, { file: 'tmp/bridge/req-1/schema.json', text: '{}' }), /Chỉ ghi/);
    assert.throws(() => resolveOutput(ctx.config, 'docs/patch.json'), /ngoài vùng/);
    assert.throws(() => resolveInput(ctx.config, 'tmp/studio-runner/library.json'), /ngoài vùng/);
    assert.throws(() => resolveInput(ctx.config, './.env'), /ngoài vùng/);

    const privateDir = path.join(repo.root, 'private');
    mkdirSync(privateDir);
    writeFileSync(path.join(privateDir, 'secret.txt'), 'private');
    symlinkSync(privateDir, path.join(repo.root, 'tmp', 'linked'), 'junction');
    await assert.rejects(readWorkspace(ctx, { file: 'tmp/linked/secret.txt' }), /liên kết/);
  } finally {
    repo.cleanup();
  }
});
