import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { buildBotCommand, checkPrerequisites } from '../src/bot.mjs';

const server = (name, enabled = true) => ({ name, enabled });

test('the runner launches Codex without shell or unrelated MCP servers', () => {
  const repoRoot = path.resolve('repo');
  const command = buildBotCommand({ repoRoot, executable: 'codex.exe', servers: ['sirlocked-studio', 'pixellab', 'node_repl'] });
  assert.equal(command.file, 'codex.exe');
  assert.equal(command.cwd, repoRoot);
  assert.ok(command.args.includes('gpt-6.2-sol'));
  assert.ok(command.args.includes('read-only'));
  assert.ok(command.args.includes('shell_tool'));
  assert.ok(command.args.includes('mcp_servers.node_repl.enabled=false'));
  assert.match(command.args.at(-1), /WorkAvailable.*\$tao-vu-an/);
});

test('preflight requires both enabled production MCP servers', async () => {
  const listed = async () => JSON.stringify([server('sirlocked-studio'), server('pixellab'), server('node_repl')]);
  assert.deepEqual(await checkPrerequisites(listed), { ok: true, servers: ['sirlocked-studio', 'pixellab', 'node_repl'] });
  const disabled = async () => JSON.stringify([server('sirlocked-studio'), server('pixellab', false)]);
  const result = await checkPrerequisites(disabled);
  assert.equal(result.ok, false);
  assert.match(result.reason, /pixellab/);
});

test('preflight reports when Codex cannot list MCP servers', async () => {
  const result = await checkPrerequisites(async () => { throw new Error('spawn codex ENOENT'); });
  assert.equal(result.ok, false);
  assert.match(result.reason, /ENOENT/);
});
