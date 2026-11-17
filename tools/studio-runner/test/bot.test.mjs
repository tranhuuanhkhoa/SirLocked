import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { buildBotCommand, checkPrerequisites } from '../src/bot.mjs';

test('buildBotCommand runs /tao-vu-an headless with the studio tools only', () => {
  const repoRoot = path.resolve('repo');
  const command = buildBotCommand({ repoRoot });
  assert.equal(command.file, 'claude.cmd');
  assert.equal(command.cwd, repoRoot);
  assert.deepEqual(command.args, [
    '-p', '/tao-vu-an', '--permission-mode', 'dontAsk', '--allowedTools',
    'mcp__sirlocked-studio', 'mcp__pixellab', 'Read', 'Glob', 'Grep', 'Write(tmp/**)', 'Edit(tmp/**)', 'Agent',
  ]);
  assert.ok(!command.args.some((arg) => /^(Bash|PowerShell)/.test(arg)), 'no shell for a bot that reads VIP orders');
});

test('checkPrerequisites is ok when sirlocked-studio is connected', async () => {
  const result = await checkPrerequisites(async () => [
    'Checking MCP server health…',
    'pixellab: https://api.pixellab.ai/mcp (HTTP) - √ Connected',
    'sirlocked-studio: node tools/studio-mcp/dist/src/index.js - √ Connected',
  ].join('\n'));
  assert.deepEqual(result, { ok: true });
});

test('checkPrerequisites explains how to approve a pending MCP server', async () => {
  const result = await checkPrerequisites(async () =>
    'sirlocked-studio: node tools/studio-mcp/dist/src/index.js - ⏸ Pending approval (run `claude` to approve)');
  assert.equal(result.ok, false);
  assert.match(result.reason, /claude\.cmd/);
});

test('checkPrerequisites reports a failed listing', async () => {
  const result = await checkPrerequisites(async () => { throw new Error('spawn claude.cmd ENOENT'); });
  assert.equal(result.ok, false);
  assert.match(result.reason, /ENOENT/);
});
