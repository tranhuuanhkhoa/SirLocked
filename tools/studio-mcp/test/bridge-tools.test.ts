import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { StudioError } from '../src/bridge-client.js';
import { normalizeApiBase } from '../src/config.js';
import { bridgeCheck, bridgeList, bridgeRelease, bridgeSubmit, bridgeTake } from '../src/tools/bridge.js';
import {
  assetsComplete, assetsNeeded, assetUpload, draftApproveGate, draftGet, draftImport, draftReport, playerView,
} from '../src/tools/draft.js';
import { encode } from '../src/image/raster.js';
import { KEY, paint, startFakeBridge, tempRepo, testContext, type FakeBridge } from './helpers.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'stages'],
  properties: {
    title: { type: 'string', minLength: 3 },
    stages: { type: 'array', minItems: 1, items: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } },
  },
};

const takeBody = (requestId: string) => ({
  requestId, kind: 'JSON', ownerType: 'CASE_DRAFT', draftId: '6650a1b2c3d4e5f601234567', caseId: 'case-x', step: 'StoryPreview',
  schemaVersion: 'v1', attemptNumber: 1, instructions: 'Return only JSON.', prompt: 'P'.repeat(150_000), schema: SCHEMA,
  lengthHintTokens: 4000, leaseExpiresAt: '2026-11-16T20:00:00Z', previousErrors: ['$.title: too short (minLength)'],
  order: { order: { world: 'HANG_DUONG_VICTORIAN' } }, devMockResponse: JSON.stringify({ title: 'Mock', stages: [{ title: 'S1' }] }),
});

async function expectStudioError(promise: Promise<unknown> | (() => unknown), code: string): Promise<StudioError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    assert.ok(error instanceof StudioError, `expected StudioError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return error;
  }
  assert.fail(`expected ${code}`);
}

describe('key handling', () => {
  let bridge: FakeBridge;
  const repo = tempRepo();
  before(async () => {
    bridge = await startFakeBridge({ 'GET /api/bridge/requests': () => ({ body: [] }) });
  });
  after(async () => { await bridge.close(); repo.cleanup(); });

  test('without a key every tool refuses with instructions and makes no HTTP call', async () => {
    const ctx = testContext(repo.root, bridge.url, '');
    const error = await expectStudioError(bridgeList(ctx, {}), 'BRIDGE_KEY_MISSING');
    assert.match(error.message, /SIRLOCKED_BRIDGE_KEY/);
    assert.match(error.message, /Windows/);
    assert.match(error.message, /Linux/);
    await expectStudioError(bridgeTake(ctx, { requestId: 'r1' }), 'BRIDGE_KEY_MISSING');
    await expectStudioError(draftGet(ctx, { draftId: 'd1' }), 'BRIDGE_KEY_MISSING');
    assert.equal(bridge.requests.length, 0);
  });

  test('a wrong key comes back as BRIDGE_KEY_INVALID with the same instructions', async () => {
    const ctx = testContext(repo.root, bridge.url, 'x'.repeat(40));
    const error = await expectStudioError(bridgeList(ctx, {}), 'BRIDGE_KEY_INVALID');
    assert.match(error.message, /401/);
    assert.ok(!error.message.includes('x'.repeat(40)), 'the key is never echoed');
  });

  test('a too short key is refused before any call', async () => {
    const ctx = testContext(repo.root, bridge.url, 'short');
    await expectStudioError(bridgeList(ctx, {}), 'BRIDGE_KEY_INVALID');
  });

  test('the key travels only in X-Bridge-Key', async () => {
    const ctx = testContext(repo.root, bridge.url);
    await bridgeList(ctx, {});
    const last = bridge.requests.at(-1)!;
    assert.equal(last.headers['x-bridge-key'], KEY);
    assert.ok(!last.query.toString().includes(KEY));
  });

  test('plain http to another host is refused (the key would travel in clear)', () => {
    assert.throws(() => normalizeApiBase('http://sirlocked.id.vn'), /https/);
    assert.equal(normalizeApiBase('http://localhost:5000/'), 'http://localhost:5000');
    assert.equal(normalizeApiBase(undefined), 'https://sirlocked.id.vn');
  });
});

describe('bridge requests', () => {
  let bridge: FakeBridge;
  const repo = tempRepo();
  const requestId = '6650a1b2c3d4e5f6aaaaaaaa';
  let ctx: ReturnType<typeof testContext>;
  before(async () => {
    bridge = await startFakeBridge({
      'GET /api/bridge/requests': () => ({
        body: [
          { requestId, kind: 'JSON', step: 'StoryPreview', draftId: 'draft-a', promptBytes: 150_000 },
          { requestId: 'other', kind: 'ASSETS', step: 'FinalAssets', draftId: 'draft-b', assetSlotIds: ['s1', 's2'] },
        ],
      }),
      [`POST /api/bridge/requests/${requestId}/take`]: () => ({ body: takeBody(requestId) }),
      'POST /api/bridge/requests/taken-elsewhere/take': () => ({
        status: 409,
        body: { success: false, message: 'This request is taken until 2026-11-16T20:00:00Z. Release it first or wait for the lease to expire.', errors: { code: 'BRIDGE_REQUEST_NOT_TAKEABLE' } },
      }),
      [`POST /api/bridge/requests/${requestId}/submit`]: (request) => ({
        body: request.json?.json?.title === 'Rejected by server'
          ? { accepted: false, errors: ['$.stages[0].title: must be string (type)'], next: null }
          : { accepted: true, errors: [], next: { draftId: 'draft-a', status: 'STORY_AWAITING_APPROVAL', nextAction: 'Wait for an admin to approve the story preview.' } },
      }),
      'POST /api/bridge/requests/expired/submit': () => ({
        status: 409, body: { success: false, message: 'This request is STALE and no longer accepts answers.', errors: { code: 'BRIDGE_REQUEST_CLOSED' } },
      }),
      'POST /api/bridge/requests/expired/release': () => ({
        status: 409, body: { success: false, message: 'Only a taken request can be released.', errors: { code: 'BRIDGE_REQUEST_NOT_TAKEN' } },
      }),
      [`POST /api/bridge/requests/${requestId}/release`]: () => ({ body: { requestId, status: 'PENDING' } }),
    });
    ctx = testContext(repo.root, bridge.url);
  });
  after(async () => { await bridge.close(); repo.cleanup(); });

  test('bridge_list summarises and filters by draft', async () => {
    const all = await bridgeList(ctx, {});
    assert.equal(all.count, 2);
    assert.equal(all.requests[0].promptKB, 146);
    const one = await bridgeList(ctx, { draftId: 'draft-b' });
    assert.deepEqual(one.requests.map((row) => row.requestId), ['other']);
    assert.equal(bridge.requests.at(-1)!.query.get('status'), 'PENDING');
  });

  test('bridge_take writes the big parts to files and returns only paths', async () => {
    const result = await bridgeTake(ctx, { requestId });
    const text = JSON.stringify(result);
    assert.ok(text.length < 3000, `tool result stays small (${text.length})`);
    assert.ok(!text.includes('PPPPPPPPPP'));
    const dir = path.join(repo.root, 'tmp', 'bridge', requestId);
    for (const file of ['prompt.md', 'schema.json', 'order.json', 'instructions.md', 'dev-mock-answer.json']) {
      assert.ok(existsSync(path.join(dir, file)), file);
    }
    assert.equal(readFileSync(path.join(dir, 'prompt.md'), 'utf8').trim().length, 150_000);
    assert.match(readFileSync(path.join(dir, 'instructions.md'), 'utf8'), /too short/);
    assert.equal(result.files.answer, `tmp/bridge/${requestId}/answer.json`);
    assert.equal(result.previousErrors, 1);
  });

  test('a request taken by someone else explains the lease', async () => {
    const error = await expectStudioError(bridgeTake(ctx, { requestId: 'taken-elsewhere' }), 'BRIDGE_REQUEST_NOT_TAKEABLE');
    assert.match(error.message, /lease/);
    assert.equal(error.status, 409);
  });

  test('bridge_check reports field paths for a JSON that breaks the schema', async () => {
    const answer = path.join(repo.root, 'tmp', 'bridge', requestId, 'answer.json');
    writeFileSync(answer, JSON.stringify({ title: 'ab', stages: [{ title: 5 }], extra: true }));
    const result = bridgeCheck(ctx, { requestId });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((line) => line.startsWith('$.title:') && line.includes('minLength')), result.errors.join('\n'));
    assert.ok(result.errors.some((line) => line.startsWith('$.stages[0].title:') && line.includes('(type)')));
    assert.ok(result.errors.some((line) => line.startsWith('$.extra:') && line.includes('additionalProperties')));
  });

  test('bridge_check refuses a file that is not JSON', async () => {
    const answer = path.join(repo.root, 'tmp', 'bridge', requestId, 'answer.json');
    writeFileSync(answer, '{ "title": ');
    assert.throws(() => bridgeCheck(ctx, { requestId }), (error: unknown) => error instanceof StudioError && error.code === 'INVALID_JSON');
  });

  test('bridge_submit does not send an answer that fails the local check', async () => {
    const before = bridge.requests.length;
    const answer = path.join(repo.root, 'tmp', 'bridge', requestId, 'answer.json');
    writeFileSync(answer, JSON.stringify({ title: 'x', stages: [] }));
    const result = await bridgeSubmit(ctx, { requestId });
    assert.equal(result.submitted, false);
    assert.equal(bridge.requests.length, before);
  });

  test('bridge_submit reads the file, wraps it and returns the server verdict', async () => {
    const answer = path.join(repo.root, 'tmp', 'bridge', requestId, 'answer.json');
    // Markdown fences around the JSON are tolerated, like on the server.
    writeFileSync(answer, '```json\n' + JSON.stringify({ title: 'Đồng hồ đêm mưa', stages: [{ title: 'Bến cảng' }] }) + '\n```');
    const result = await bridgeSubmit(ctx, { requestId });
    assert.equal(result.accepted, true);
    const sent = bridge.requests.at(-1)!;
    assert.deepEqual(sent.json, { json: { title: 'Đồng hồ đêm mưa', stages: [{ title: 'Bến cảng' }] } });
    assert.ok(existsSync(path.join(repo.root, 'tmp', 'bridge', requestId, 'submit-result.json')));
  });

  test('bridge_submit passes the server schema errors back when the server refuses', async () => {
    const answer = path.join(repo.root, 'tmp', 'bridge', requestId, 'answer.json');
    writeFileSync(answer, JSON.stringify({ title: 'Rejected by server', stages: [{ title: 'x' }] }));
    const result = await bridgeSubmit(ctx, { requestId });
    assert.equal(result.accepted, false);
    assert.deepEqual(result.errors, ['$.stages[0].title: must be string (type)']);
  });

  test('an answer after the lease expired (request no longer open) is a clear error', async () => {
    const dir = path.join(repo.root, 'tmp', 'bridge', 'expired');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'answer.json'), JSON.stringify({ title: 'Late answer', stages: [{ title: 'x' }] }));
    const error = await expectStudioError(bridgeSubmit(ctx, { requestId: 'expired', skipLocalCheck: true }), 'BRIDGE_REQUEST_CLOSED');
    assert.match(error.message, /no longer accepts/);
    await expectStudioError(bridgeRelease(ctx, { requestId: 'expired' }), 'BRIDGE_REQUEST_NOT_TAKEN');
  });

  test('bridge_release returns the request to the queue', async () => {
    const result = await bridgeRelease(ctx, { requestId });
    assert.equal(result.status, 'PENDING');
  });

  test('ids are checked before they become folders or URLs', async () => {
    await expectStudioError(bridgeTake(ctx, { requestId: '../../etc' }), 'BAD_ID');
  });
});

describe('drafts, gates, report, player view, pictures', () => {
  let bridge: FakeBridge;
  const repo = tempRepo();
  const fast = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const full = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  let ctx: ReturnType<typeof testContext>;
  const draft = (id: string, mode: string) => ({
    draftId: id, status: 'STORY_AWAITING_APPROVAL', queueState: 'NONE', orderStatus: 'AWAITING_GATE', waitingGate: 'STORY',
    nextAction: 'Fast mode: run your checks, then approve-gate STORY.', order: { order: { reviewMode: mode, pixelLabCap: 30, world: 'TAISHO_JAPAN' } },
    validator: { validationErrors: [{ message: 'one' }], blueprintValidationErrors: [], lastAttemptErrors: ['two'] }, openRequests: [],
  });
  before(async () => {
    bridge = await startFakeBridge({
      [`GET /api/bridge/drafts/${fast}`]: () => ({ body: draft(fast, 'FAST') }),
      [`GET /api/bridge/drafts/${full}`]: () => ({ body: draft(full, 'FULL') }),
      [`POST /api/bridge/drafts/${fast}/approve-gate`]: (request) => ({ body: { draftId: fast, gate: request.json.gate, status: 'TRUTH_GENERATING', queueState: 'PENDING' } }),
      [`PUT /api/bridge/drafts/${fast}/report`]: (request) => ({ body: { draftId: fast, length: request.json.markdown.length, updatedAt: '2026-11-16T10:00:00Z' } }),
      [`GET /api/bridge/drafts/${fast}/player-view`]: () => ({ body: { title: 'T', characters: [{}, {}], clues: [{}], stages: [{ scenes: [{}, {}] }] } }),
      [`POST /api/bridge/drafts/${fast}/import`]: () => ({ body: { caseId: 'case-ai-1', title: 'T', status: 'Draft' } }),
      [`GET /api/bridge/drafts/${fast}/case-json`]: () => ({ body: { draftId: fast, source: 'IMPORTED', caseId: 'case-ai-1', caseJson: { caseId: 'case-ai-1', finalLogic: { culpritId: 'c1' } } } }),
      [`GET /api/bridge/drafts/${fast}/assets-needed`]: () => ({
        body: {
          draftId: fast, storageAvailable: true, maxBytes: 5242880, formats: ['image/png', 'image/webp'], openRequest: { requestId: 'r', step: 'FinalAssets', assetPhase: 'FINAL_ASSETS' },
          slots: [
            { slotId: 'cover', kind: 'COVER', name: 'Bìa', width: 512, height: 512, transparent: false, required: true, requestedNow: true, artDirection: 'A'.repeat(500) },
            { slotId: 'item:x', kind: 'ITEM', name: 'X', width: 64, height: 64, transparent: true, required: true, requestedNow: false, currentUrl: 'https://res.cloudinary.com/x.png' },
          ],
        },
      }),
      [`POST /api/bridge/drafts/${fast}/assets`]: (request) => ({ body: { slotId: 'cover', url: 'https://res.cloudinary.com/demo/cover.png', width: 4, height: 4, hasAlpha: false, bytes: request.body.length } }),
      [`POST /api/bridge/drafts/${fast}/assets/complete`]: () => ({ body: { accepted: true, errors: [], next: { status: 'SCENE_LAYOUT_PLANNING' } } }),
    });
    ctx = testContext(repo.root, bridge.url);
  });
  after(async () => { await bridge.close(); repo.cleanup(); });

  test('draft_get keeps the summary short and saves the full answer', async () => {
    const result = await draftGet(ctx, { draftId: fast });
    assert.equal(result.reviewMode, 'FAST');
    assert.equal(result.waitingGate, 'STORY');
    assert.deepEqual(result.validator.firstErrors, ['one', 'two']);
    assert.ok(existsSync(path.join(repo.root, 'tmp', 'bridge', fast, 'draft.json')));
  });

  test('the truth gate is never passed by the bot', async () => {
    await expectStudioError(draftApproveGate(ctx, { draftId: fast, gate: 'TRUTH', allChecksPassed: true }), 'GATE_FORBIDDEN');
  });

  test('a gate needs every check passed and fast mode', async () => {
    await expectStudioError(draftApproveGate(ctx, { draftId: fast, gate: 'STORY', allChecksPassed: false }), 'CHECKS_NOT_PASSED');
    await expectStudioError(draftApproveGate(ctx, { draftId: full, gate: 'STORY', allChecksPassed: true }), 'NOT_FAST_MODE');
    const result = await draftApproveGate(ctx, { draftId: fast, gate: 'story', allChecksPassed: true });
    assert.equal(result.gate, 'STORY');
    assert.deepEqual(bridge.requests.at(-1)!.json, { gate: 'STORY' });
  });

  test('draft_report pushes the markdown file', async () => {
    const file = path.join(repo.root, 'tmp', 'bridge', fast, 'report.md');
    writeFileSync(file, '# Báo cáo\n5/5 lớp đạt\n');
    const result = await draftReport(ctx, { draftId: fast });
    assert.equal(result.length, '# Báo cáo\n5/5 lớp đạt\n'.length);
    assert.equal(bridge.requests.at(-1)!.json.markdown, '# Báo cáo\n5/5 lớp đạt\n');
  });

  test('player_view writes the file for the blind detective', async () => {
    const result = await playerView(ctx, { draftId: fast });
    assert.equal(result.file, `tmp/bridge/${fast}/player-view.json`);
    assert.deepEqual(result.counts, { characters: 2, clues: 1, items: 0, dialogues: 0, scenes: 2 });
  });

  test('draft_import saves the case JSON for the playtest and never publishes', async () => {
    const result = await draftImport(ctx, { draftId: fast });
    assert.equal(result.caseFile, `tmp/bridge/${fast}/case.json`);
    assert.ok(!bridge.requests.some((request) => request.path.endsWith('/publish')));
  });

  test('assets_needed lists the slots, asset_upload sends multipart, assets_complete continues', async () => {
    const needed = await assetsNeeded(ctx, { draftId: fast, onlyRequested: true });
    assert.equal(needed.slots.length, 1);
    assert.ok(needed.slots[0].art.length < 220);
    const file = path.join(repo.root, 'cover.png');
    writeFileSync(file, await encode(paint(4, 4, () => [200, 100, 50, 255]), 'png'));
    const uploaded = await assetUpload(ctx, { draftId: fast, slotId: 'cover', file, width: 512, height: 512 });
    assert.equal(uploaded.url, 'https://res.cloudinary.com/demo/cover.png');
    assert.equal(uploaded.warnings.length, 2); // 4x4 is not 512x512: warned, still sent
    const multipart = bridge.requests.at(-1)!;
    assert.match(String(multipart.headers['content-type']), /multipart\/form-data/);
    assert.match(multipart.body.toString('latin1'), /name="slotId"\r\n\r\ncover/);
    const done = await assetsComplete(ctx, { draftId: fast });
    assert.equal(done.accepted, true);
  });

  test('asset_upload refuses a file that is not PNG or WebP', async () => {
    const file = path.join(repo.root, 'note.txt');
    writeFileSync(file, 'not a picture');
    await assert.rejects(assetUpload(ctx, { draftId: fast, slotId: 'cover', file }));
  });
});
