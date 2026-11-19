#!/usr/bin/env node
// Plays the Claude bot against a LOCAL API in bridge mode, end to end, with the server's deterministic mock answers:
// order -> every bridge request (JSON answers, image uploads) -> admin gates -> READY_TO_PUBLISH -> import (never publish).
//
// Start the API with: AiGeneration__MockAiResponses=false, Bridge__Key=<key>, Bridge__ExposeMockResponses=true,
// Bridge__AllowLocalAssetStorage=true (Development), e.g. scripts/start-local-demo.ps1 -Bridge.
// Then: node scripts/bridge-smoke.mjs
//   SIRLOCKED_BRIDGE_KEY   the same key the API runs with (read from the environment, never printed)
//   SMOKE_API_URL          default http://127.0.0.1:5216
//   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD   an ADMIN of that local database (defaults: the local demo admin)
//   SMOKE_PRESET / SMOKE_LANGUAGE              default SHORT_DEMO / vi
import { deflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

const api = (process.env.SMOKE_API_URL || 'http://127.0.0.1:5216').replace(/\/$/, '');
const key = process.env.SIRLOCKED_BRIDGE_KEY || process.env.BRIDGE_KEY || '';
const adminEmail = process.env.SMOKE_ADMIN_EMAIL || 'admin@sirlocked.local';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || 'LocalDemo123!';
const preset = process.env.SMOKE_PRESET || 'SHORT_DEMO';
const language = process.env.SMOKE_LANGUAGE || 'vi';
const deadline = Date.now() + Number(process.env.SMOKE_TIMEOUT_MS || 10 * 60_000);

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) {
  console.error('bridge-smoke only runs against a local API (127.0.0.1 or localhost).');
  process.exit(2);
}
if (key.length < 32) {
  console.error('Set SIRLOCKED_BRIDGE_KEY (32+ characters) to the key the local API runs with.');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let adminToken = '';

async function call(method, path, { bridge = false, body, form, expect = [200, 202] } = {}) {
  const headers = {};
  if (bridge) headers['X-Bridge-Key'] = key;
  else if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(`${api}${path}`, { method, headers, body: payload });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${path} -> HTTP ${response.status}: ${text.slice(0, 600)}`);
  }
  return { status: response.status, json, data: json?.data };
}

// ---------------------------------------------------------------- tiny PNG encoder (RGBA, no dependencies)
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(width, height, transparent) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 4;
      raw[at] = (x * 3) & 0xff; raw[at + 1] = (y * 5) & 0xff; raw[at + 2] = 140;
      raw[at + 3] = transparent && (x < 6 || y < 6) ? 0 : 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- the bot
const gates = {
  STORY_AWAITING_APPROVAL: 'approve',
  CASE_TRUTH_AWAITING_APPROVAL: 'approve-truth',
  FULL_LOGIC_AWAITING_APPROVAL: 'approve-full-logic',
  SCENE_LAYOUT_AWAITING_APPROVAL: 'approve-scene-layout',
};

// VUAN-6B pixel drafts: uploads wait for an asset plan within pixelLabCap. The smoke bot checks that an all-new plan is
// refused, then declares library pictures only (0 PixelLab generations).
const smokeLibrary = { OUTDOOR_MAP: 'smoke-pixel-map', INTERIOR: 'smoke-pixel-room', NPC: 'smoke-pixel-npc', ITEM: 'smoke-pixel-item' };
let capRefusal = '';
async function declarePixelPlan(draftId, pixel) {
  if (pixel.planAccepted) return;
  const refused = await call('PUT', `/api/bridge/drafts/${draftId}/asset-plan`, { bridge: true, body: { choices: [] }, expect: [409] });
  if (refused.json?.errors?.code !== 'AI_PIXELLAB_CAP_EXCEEDED') throw new Error(`An all-new plan was not refused: ${JSON.stringify(refused.json)}`);
  capRefusal = refused.json.message;
  await call('PUT', '/api/bridge/library', { bridge: true, body: { items: Object.entries(smokeLibrary).map(([kind, key]) => ({ key, kind, world: 'HANG_DUONG_VICTORIAN', url: `/assets/library/${key}.webp` })) } });
  const choices = pixel.subjects.map((subject) => ({ subject: subject.subject, source: 'LIBRARY', libraryKey: smokeLibrary[subject.libraryKind] }));
  const plan = (await call('PUT', `/api/bridge/drafts/${draftId}/asset-plan`, { bridge: true, body: { choices } })).data;
  if (plan.estimatedGenerations !== 0) throw new Error(`Library-only plan should need 0 generations: ${plan.estimatedGenerations}`);
  console.log(`   asset plan: ${choices.length} library pictures, 0 PixelLab generations (all-new plan refused: ${capRefusal.slice(0, 90)}...)`);
}

async function uploadRequestedImages(draftId) {
  const needed = (await call('GET', `/api/bridge/drafts/${draftId}/assets-needed`, { bridge: true })).data;
  if (needed.pixel) await declarePixelPlan(draftId, needed.pixel);
  let uploaded = 0;
  for (const slot of needed.slots.filter((item) => item.requestedNow)) {
    const form = new FormData();
    form.append('slotId', slot.slotId);
    // Pixel slots take exact sizes: 512 scenes, 1152x128 idle sheets, 288 portraits, 64 icons (transparent but scenes).
    const picture = needed.pixel ? png(slot.width, slot.height, slot.transparent || slot.kind !== 'background') : png(96, 54, slot.transparent);
    form.append('file', new Blob([picture], { type: 'image/png' }), `${slot.slotId.replace(/[^a-z0-9-]/gi, '-')}.png`);
    await call('POST', `/api/bridge/drafts/${draftId}/assets`, { bridge: true, form });
    uploaded++;
  }
  const complete = await call('POST', `/api/bridge/drafts/${draftId}/assets/complete`, { bridge: true });
  if (!complete.data.accepted) throw new Error(`assets/complete refused: ${JSON.stringify(complete.data.errors)}`);
  return uploaded;
}

async function main() {
  const started = Date.now();
  await call('GET', '/api/bridge/ping', { bridge: true });
  console.log('1. Bridge key accepted by the local API.');
  const login = await call('POST', '/api/auth/admin/login', { body: { email: adminEmail, password: adminPassword } });
  adminToken = login.data?.token || login.data?.accessToken;
  if (!adminToken) throw new Error('Admin login returned no token.');

  const created = await fetch(`${api}/api/admin/ai-cases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ prompt: 'Bridge smoke: một chiếc đồng hồ bỏ túi dừng lúc nửa đêm.', generationPreset: preset, language, order: { weather: 'RAIN', timeOfDay: 'NIGHT' } }),
  });
  const createdJson = await created.json();
  if (created.status !== 202) throw new Error(`Order refused: HTTP ${created.status} ${JSON.stringify(createdJson)}`);
  const draftId = createdJson.data.draftId;
  console.log(`2. Order ${draftId} placed (${createdJson.data.orderStatus}).`);

  const answered = { JSON: 0, ASSETS: 0, gates: 0, images: 0 };
  while (true) {
    if (Date.now() > deadline) throw new Error(`Timed out; answered ${JSON.stringify(answered)}.`);
    const draft = (await call('GET', `/api/admin/ai-cases/${draftId}`)).data;
    const idle = !draft.queueState || draft.queueState === 'NONE';
    if (idle && draft.status === 'READY_TO_PUBLISH') break;
    if (idle && ['GENERATED_INVALID', 'CASE_TRUTH_INVALID', 'CANCELLED'].includes(draft.status)) {
      throw new Error(`Draft ended ${draft.status} (${draft.failurePhase}): ${(draft.validationErrors || []).slice(0, 5).join(' | ')}`);
    }
    if (idle && gates[draft.status]) {
      await call('POST', `/api/admin/ai-cases/${draftId}/${gates[draft.status]}`);
      answered.gates++;
      console.log(`   gate ${draft.status} approved by the admin`);
      continue;
    }
    const pending = (await call('GET', '/api/bridge/requests?status=PENDING', { bridge: true })).data
      .filter((item) => item.draftId === draftId);
    for (const request of pending) {
      const taken = (await call('POST', `/api/bridge/requests/${request.requestId}/take`, { bridge: true })).data;
      if (taken.kind === 'ASSETS') {
        answered.images += await uploadRequestedImages(draftId);
        answered.ASSETS++;
        console.log(`   ${taken.step}: images uploaded`);
        continue;
      }
      if (!taken.devMockResponse) throw new Error('No mock answer: start the API with Bridge__ExposeMockResponses=true (not Production).');
      const result = (await call('POST', `/api/bridge/requests/${request.requestId}/submit`, { bridge: true, body: taken.devMockResponse })).data;
      if (!result.accepted) throw new Error(`${taken.step} refused by the schema check: ${JSON.stringify(result.errors)}`);
      answered.JSON++;
      console.log(`   ${taken.step}: answered`);
    }
    await sleep(pending.length ? 200 : 700);
  }
  console.log(`3. READY_TO_PUBLISH after ${answered.JSON} JSON answers, ${answered.ASSETS} image requests (${answered.images} images), ${answered.gates} gates.`);

  await call('PUT', `/api/bridge/drafts/${draftId}/report`, { bridge: true, body: { markdown: '# bridge-smoke\nAll steps answered with the server mock.' } });
  const imported = (await call('POST', `/api/bridge/drafts/${draftId}/import`, { bridge: true })).data;
  const published = (await call('GET', '/api/cases/published')).data || [];
  if (published.some((item) => item.caseId === imported.caseId)) throw new Error('The imported case is visible to players.');
  const publishRoute = await call('POST', `/api/bridge/drafts/${draftId}/publish`, { bridge: true, expect: [404, 405] });
  console.log(`4. Imported ${imported.caseId} as an unpublished draft (bridge publish route: HTTP ${publishRoute.status}).`);
  const caseJson = (await call('GET', `/api/bridge/drafts/${draftId}/case-json`, { bridge: true })).data.caseJson;
  const scenes = caseJson.stages.flatMap((stage) => stage.scenes);
  const pixel = scenes.every((scene) => scene.runtime?.render?.mode === 'pixel');
  if (!pixel) throw new Error('The imported AI case is not a pixel case (VUAN-6B).');
  const outdoor = scenes.filter((scene) => scene.runtime.render.projection === 'topdown');
  console.log(`   pixel case: ${scenes.map((scene) => `${scene.runtime.render.projection} ${scene.runtime.width}x${scene.runtime.height} actorScale ${scene.runtime.render.actorScale}`).join(' | ')}; `
    + `music ${scenes.every((scene) => scene.runtime.audio?.music?.url)}, rain outside ${outdoor.every((scene) => scene.runtime.weather?.type === 'RAIN')}, `
    + `blips ${caseJson.characters.every((character) => character.voice?.blip)}, hints 3 levels ${new Set(caseJson.hints.map((hint) => hint.order)).size === 3}.`);
  const requests = (await call('GET', '/api/bridge/requests?status=ACCEPTED&limit=500', { bridge: true })).data.filter((item) => item.draftId === draftId);
  const stale = (await call('GET', '/api/bridge/requests?status=STALE&limit=500', { bridge: true })).data.filter((item) => item.draftId === draftId);
  if (stale.length) throw new Error(`${stale.length} request(s) went stale: a replay changed its prompt.`);
  console.log(`5. ${requests.length} accepted bridge requests, 0 stale. Done in ${Math.round((Date.now() - started) / 1000)} s.`);
}

main().catch((error) => {
  console.error(`bridge-smoke FAILED: ${error.message}`);
  process.exit(1);
});
