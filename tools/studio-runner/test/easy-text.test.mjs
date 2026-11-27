import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { answerTaken, applyEditorial, isScriptStep } from '../../studio-mcp/scripts/easy-text.mjs';

test('two editorial corrections update only their exact strings, atomically', () => {
  const before = '{"characters":{"c":{"id":"c","description":"old"}},"title":"old","finalLogic":{"winEnding":"old ending","failEnding":"unchanged"},"lines":["one","two"]}';
  const string = { type: 'string' };
  const schema = { properties: { characters: { properties: { c: { properties: { id: string, description: string } } } },
    title: string, finalLogic: { properties: { winEnding: string, failEnding: { ...string, readOnly: true } } },
    lines: { type: 'array', items: string } } };
  const edit = { path: ['characters', 'c', 'description'], before: 'old', replacement: 'new' };
  const ending = { path: ['finalLogic', 'winEnding'], before: 'old ending', replacement: 'new ending' };
  const line = { path: ['lines', 1], before: 'two', replacement: 'three' };
  assert.deepEqual(JSON.parse(applyEditorial(before, [edit, ending, line], schema)), {
    characters: { c: { id: 'c', description: 'new' } }, title: 'old',
    finalLogic: { winEnding: 'new ending', failEnding: 'unchanged' }, lines: ['one', 'three'],
  });
  assert.equal(applyEditorial(before, [edit, { ...ending, before: 'other version' }], schema), null);
  assert.equal(applyEditorial(before, [{ path: ['characters', 'c', 'id'], before: 'c', replacement: 'another' }], schema), null);
  assert.equal(applyEditorial(before, [{ path: ['finalLogic', 'failEnding'], before: 'unchanged', replacement: 'change' }], schema), null);
  assert.equal(applyEditorial(before, [{ path: ['lines', 2], before: 'missing', replacement: 'extra' }], schema), null);
  for (const lock of [{ enum: ['old'] }, { const: 'old' }]) {
    const locked = { ...schema, properties: { ...schema.properties, title: { ...string, ...lock } } };
    assert.equal(applyEditorial(before, [{ path: ['title'], before: 'old', replacement: 'new' }], locked), null);
  }
});

test('a winEnding edit is validated and retried without calling the gameplay author again', async t => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'sirlocked-editor-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const files = { answer: 'answer.json', instructions: 'instructions.md', prompt: 'prompt.md', schema: 'schema.json', order: 'order.json' };
  const original = { board: { summary: 'before' }, finalLogic: { winEnding: 'old', failEnding: 'same' } };
  const text = { type: 'string' };
  const schema = { type: 'object', properties: { board: { properties: { summary: text } },
    finalLogic: { properties: { winEnding: { ...text, maxLength: 12 }, failEnding: text } } } };
  for (const [key, value] of Object.entries({ instructions: 'write', prompt: 'gameplay', schema: JSON.stringify(schema), order: '{"order":{}}' }))
    writeFileSync(path.join(repo, files[key]), value);
  for (const guide of ['.agents/skills/tao-vu-an/references/bien-tap-vien.md', 'docs/case-style-guide.md']) {
    const file = path.join(repo, guide);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'editorial guide');
  }
  const requests = [];
  let writes = 0, reviews = 0;
  const run = { repo, taken: { step: 'GenerateFullCaseJson', requestId: '1', files },
    generate: async ({ effort }, prompt) => {
      if (effort === 'medium') { writes++; return JSON.stringify(original); }
      if (++reviews === 2) {
        assert.match(prompt, /merged patch failed schema validation/);
        assert.deepEqual(JSON.parse(readFileSync(path.join(repo, files.answer))), original);
      }
      return JSON.stringify({ required: [
        { path: ['board', 'summary'], before: 'before', replacement: 'after' },
        { path: ['finalLogic', 'winEnding'], before: 'old', replacement: reviews === 1 ? 'a very long new ending' : 'new ending' },
      ], suggestions: [] });
    },
    tool: async name => {
      requests.push(name);
      const current = JSON.parse(readFileSync(path.join(repo, files.answer)));
      if (name === 'bridge_check') return current.finalLogic.winEnding.length > 12
        ? { valid: false, errors: ['$.finalLogic.winEnding: too long'] } : { valid: true };
      assert.deepEqual(current, { board: { summary: 'after' }, finalLogic: { winEnding: 'new ending', failEnding: 'same' } });
      return { accepted: true };
    },
  };
  await answerTaken(run);
  await answerTaken(run); // the same MCP request can be taken again after a lost submission
  assert.equal(writes, 1);
  assert.equal(reviews, 2);
  assert.deepEqual(requests, ['bridge_check', 'bridge_check', 'bridge_check', 'bridge_submit', 'bridge_submit']);
});

test('the script worker leaves images, scenes and unknown steps to the studio worker', () => {
  assert.equal(isScriptStep('RepairTruthFindings:a1b2'), true);
  assert.equal(isScriptStep('ReviewBlindSolvability:Retry'), true);
  for (const step of ['UploadAssets', 'PlanScenePlacement:scene-tiem', 'Unknown']) assert.equal(isScriptStep(step), false);
});

test('blind solver sees only its assigned data and retries on the exact bridge rejection', async t => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'sirlocked-blind-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const files = { answer: 'answer.json', instructions: 'instructions.md', prompt: 'prompt.md', schema: 'schema.json', order: 'order.json' };
  for (const [name, value] of Object.entries({ instructions: 'solve', prompt: 'player clue A', schema: '{}', order: 'SECRET SOLUTION' })) {
    writeFileSync(path.join(repo, files[name]), value);
  }
  const prompts = [], submissions = [];
  await answerTaken({ repo, taken: { step: 'ReviewBlindSolvability', requestId: '1', files },
    generate: async (_, prompt) => { prompts.push(prompt); return JSON.stringify({ index: prompts.length }); },
    tool: async name => {
      assert.equal(name, 'bridge_submit');
      submissions.push(JSON.parse(readFileSync(path.join(repo, files.answer))));
      return { accepted: submissions.length === 2, errors: ['specific clue missing'] };
    },
  });
  assert.deepEqual(submissions, [{ index: 1 }, { index: 2 }]);
  assert.ok(prompts.every(prompt => prompt.includes('player clue A') && !prompt.includes('SECRET SOLUTION')));
  assert.match(prompts[1], /specific clue missing/);
});

test('a rejected earlier stage resubmits a single corrected field and preserves every other value', async t => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'sirlocked-stage-fix-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const files = { answer: 'answer.json', instructions: 'instructions.md', prompt: 'prompt.md', schema: 'schema.json' };
  for (const [key, value] of Object.entries({ instructions: 'write', prompt: 'timeline', schema: '{}' }))
    writeFileSync(path.join(repo, files[key]), value);
  const original = { trueTimeline: [{ eventId: 'a', startMinute: -1, endMinute: 4 }, { eventId: 'b', startMinute: 5 }] };
  const replies = [
    JSON.stringify(original),
    '{"edits":[{"path":["trueTimeline","0","startMinute"],"value":0}]}',
  ];
  let submissions = 0;
  await answerTaken({ repo, taken: { step: 'BuildTrueTimeline', requestId: '1', files },
    generate: async (_, prompt) => {
      if (submissions) assert.match(prompt, /Repair exactly the listed paths/);
      return replies.shift();
    },
    tool: async () => {
      const current = JSON.parse(readFileSync(path.join(repo, files.answer)));
      if (++submissions === 1)
        return { accepted: false, errors: ['$.trueTimeline[0].startMinute: must be >= 0 (minimum)'] };
      assert.deepEqual(current, { trueTimeline: [{ ...original.trueTimeline[0], startMinute: 0 }, original.trueTimeline[1]] });
      return { accepted: true };
    },
  });
  assert.equal(submissions, 2);
});
