#!/usr/bin/env node
/**
 * Chạy trọn vòng xưởng trên máy, không cần Claude thật, 0 lượt PixelLab:
 *   backend local ở chế độ bridge (Mongo + API + web tự dựng, như tool playtest) + MCP server thật (stdio),
 *   gọi các tool đúng thứ tự skill /tao-vu-an:
 *   bridge_list -> bridge_take -> bridge_check -> bridge_submit (JSON mock của server) -> ... cổng ...
 *   -> assets_needed -> ảnh thư viện (library_search, asset_variant, asset_process) -> asset_upload -> assets_complete
 *   -> player_view -> draft_import -> playtest -> draft_report; thêm library_sync lên server local.
 *
 *   cd tools/studio-mcp && npm run e2e:local            (đơn chế độ nhanh: bot qua cổng STORY/LOGIC/LAYOUT)
 *   node scripts/e2e-local.mjs --full                    (đơn đủ 4 cổng: người duyệt bằng API admin local)
 *   node scripts/e2e-local.mjs --keep                    (giữ stack chạy sau khi xong)
 * Cổng mặc định: API 5251, web 5252, Mongo 27051 (E2E_API_PORT, E2E_WEB_PORT, E2E_MONGO_PORT).
 * Khóa bridge của lần chạy là khóa ngẫu nhiên chỉ dùng cho stack local này, không in ra.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(here, '..');
const repo = path.resolve(studio, '..', '..');
const { startStack } = await import(pathToFileURL(path.join(studio, 'dist', 'src', 'playtest', 'stack.js')).href);

const full = process.argv.includes('--full');
const keep = process.argv.includes('--keep');
const ports = {
  api: Number(process.env.E2E_API_PORT) || 5251,
  web: Number(process.env.E2E_WEB_PORT) || 5252,
  mongo: Number(process.env.E2E_MONGO_PORT) || 27051,
};
const started = Date.now();
const deadline = started + 25 * 60_000;
const work = path.join(repo, 'tmp', 'e2e-local');
mkdirSync(work, { recursive: true });
const log = (line) => console.log(`[e2e ${String(Math.round((Date.now() - started) / 1000)).padStart(4)}s] ${line}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const calls = [];
const results = { order: full ? 'FULL' : 'FAST', jsonAnswers: 0, imageRequests: 0, images: 0, botGates: 0, adminGates: 0 };

// A throwaway key for this local stack only (the stack and the MCP server read it from the environment).
process.env.SIRLOCKED_BRIDGE_KEY = randomBytes(32).toString('hex');

let stack;
let client;
try {
  log(`Dựng stack local chế độ bridge (API ${ports.api}, web ${ports.web}, Mongo ${ports.mongo})...`);
  stack = await startStack({ repoRoot: repo, apiPort: ports.api, webPort: ports.web, mongoPort: ports.mongo, bridge: true, log: (line) => log(`  stack: ${line}`) });
  log(`Stack sẵn sàng: ${stack.apiUrl}`);

  // ------------------------------------------------------------------ admin (plays the creator)
  const admin = async (method, route, body, extraHeaders = {}) => {
    const response = await fetch(`${stack.apiUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${route} -> ${response.status} ${text.slice(0, 400)}`);
    return text ? JSON.parse(text).data : null;
  };
  let adminToken = '';
  adminToken = (await admin('POST', '/api/auth/admin/login', { email: stack.adminEmail, password: stack.adminPassword })).token;

  // ------------------------------------------------------------------ the real MCP server over stdio
  const indexCopy = path.join(work, 'library-index.json');
  copyFileSync(path.join(studio, 'library', 'index.json'), indexCopy);
  client = new Client({ name: 'e2e-local', version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(studio, 'dist', 'src', 'index.js')],
    cwd: repo,
    env: {
      ...process.env,
      SIRLOCKED_API: stack.apiUrl,
      SIRLOCKED_LIBRARY_INDEX: path.relative(repo, indexCopy),
      SIRLOCKED_REPO_ROOT: repo,
    },
    stderr: 'ignore',
  }));
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  log(`MCP sirlocked-studio: ${tools.length} tool (${tools.join(', ')})`);

  const tool = async (name, args = {}) => {
    const begun = Date.now();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30 * 60_000 });
    const text = result.content?.[0]?.text ?? '{}';
    const data = JSON.parse(text);
    calls.push({ tool: name, ms: Date.now() - begun, ok: !result.isError });
    if (result.isError) throw new Error(`${name}: ${data.error} ${data.message}`);
    return data;
  };

  // ------------------------------------------------------------------ 1. order (the creator, on /admin/ai)
  const order = await admin('POST', '/api/admin/ai-cases', {
    prompt: 'E2E xưởng: một chiếc đồng hồ bỏ túi dừng lúc nửa đêm ở bến cảng.',
    generationPreset: 'SHORT_DEMO', language: 'vi',
    order: { world: 'HANG_DUONG_VICTORIAN', weather: 'RAIN', timeOfDay: 'NIGHT', reviewMode: full ? 'FULL' : 'FAST', pixelLabCap: 0, contentLevel: 'LIGHT' },
  }, { 'Idempotency-Key': randomUUID() });
  const draftId = order.draftId;
  log(`1. Đơn ${draftId} (${order.orderStatus}), chế độ ${results.order}.`);

  // ------------------------------------------------------------------ library pictures used for the image slots
  const scenes = await tool('library_search', { world: 'HANG_DUONG_VICTORIAN', tags: ['vu-pixel-co-san'], limit: 50, download: true });
  const sceneFiles = scenes.results.filter((row) => row.kind !== 'NPC').map((row) => row.cached.main);
  const npcs = scenes.results.filter((row) => row.kind === 'NPC');
  let items = (await tool('library_search', { kind: 'ITEM', world: 'ALL', limit: 12, download: true })).results.filter((row) => row.cached?.main);
  if (!items.length) {
    // Library batch 0 not imported on this machine: the items that ship with the two pixel cases.
    const folder = 'src/FE/public/assets/pixel/lo-thuoc-thu-nam/items';
    items = ['kinh-lup', 'chia-khoa', 'so-tay', 'phieu-cam'].map((name) => ({ key: name, cached: { main: `${folder}/${name}.png` } }));
  }
  const variant = await tool('asset_variant', {
    type: 'night', input: 'v-case-pho', saveToLibrary: false, key: 'e2e-pho-dem',
    params: { lights: [[120, 200, 24], [380, 200, 24]], windows: [[60, 150, 90, 180]] },
  });
  log(`   Thư viện: ${sceneFiles.length} cảnh, ${npcs.length} NPC, ${items.length} vật phẩm; biến thể đêm ${variant.output} (0 lượt).`);
  const backgrounds = [variant.output, ...sceneFiles];
  const coverFile = (await tool('asset_process', {
    op: 'cover', output: path.relative(repo, path.join(work, 'cover.png')),
    params: { scene: variant.output, portraits: npcs.slice(0, 3).map((row) => row.cached.main) },
  })).output;

  // VUAN-6B: a pixel draft takes pictures in the sizes of "Tram hong ngoc" (512 scenes, 1152x128 idle sheets, 288
  // portraits, 64 icons) after an asset plan within pixelLabCap. This order has cap 0: library and a variant only.
  const pub = (url) => path.join(repo, 'src', 'FE', 'public', ...url.replace(/^\//, '').split('/'));
  const roomKeys = ['v-case-cam-do', 'v-case-hieu-thuoc', 'v-case-nha-so-7', 'v-case-nha-xe', 'v-case-hieu-anh'];
  const npcFaces = ['dang-buu', 'trinh-luc', 'ly-hanh', 'hoc-viec', 'to-khanh', 'lam-the-bao'];
  const pixelPick = new Map(); // subject -> { key, file(s) }
  async function declarePixelPlan(pixel) {
    if (pixel.planAccepted) return;
    const keys = ['v-case-pho', ...roomKeys, ...npcFaces.map((face) => `v-case-npc-${face}`), 'all-item-kinh-lup']
      .filter((key) => JSON.parse(readFileSync(indexCopy, 'utf8')).items.some((item) => item.key === key));
    await tool('library_sync', { direction: 'push', keys });
    // Everything new would cost PixelLab generations: refused on a 0 cap, nothing may start.
    try {
      await tool('asset_plan', { draftId, choices: [] });
      throw new Error('asset_plan với mọi hình mới lẽ ra phải bị chặn (pixelLabCap 0).');
    } catch (error) {
      if (!/AI_PIXELLAB_CAP_EXCEEDED/.test(String(error.message))) throw error;
      results.capRefusal = String(error.message).slice(0, 220);
    }
    let room = 0, face = 0;
    const choices = pixel.subjects.map((subject) => {
      if (subject.kind === 'scene' && subject.projection === 'topdown') {
        pixelPick.set(subject.subject, { file: variant.output });
        return { subject: subject.subject, source: 'VARIANT', parentKey: 'v-case-pho', variant: 'night' };
      }
      if (subject.kind === 'scene') {
        const key = roomKeys[room++ % roomKeys.length];
        pixelPick.set(subject.subject, { file: pub(`/assets/pixel/lo-thuoc-thu-nam/scenes/${key.replace('v-case-', '')}.png`) });
        return { subject: subject.subject, source: 'LIBRARY', libraryKey: key };
      }
      if (subject.kind === 'character') {
        const name = npcFaces[face++ % npcFaces.length];
        pixelPick.set(subject.subject, {
          sprite: pub(`/assets/pixel/lo-thuoc-thu-nam/characters/${name}-idle.png`),
          portrait: pub(`/assets/pixel/lo-thuoc-thu-nam/characters/${name}-portrait.png`),
        });
        return { subject: subject.subject, source: 'LIBRARY', libraryKey: `v-case-npc-${name}` };
      }
      pixelPick.set(subject.subject, { file: pub('/assets/pixel/lo-thuoc-thu-nam/items/kinh-lup.png') });
      return { subject: subject.subject, source: 'LIBRARY', libraryKey: 'all-item-kinh-lup' };
    });
    const plan = await tool('asset_plan', { draftId, choices });
    if (plan.estimatedGenerations !== 0 || plan.requests.length !== 0) throw new Error(`Kế hoạch thư viện lẽ ra 0 lượt: ${JSON.stringify(plan)}`);
    results.assetPlan = { subjects: choices.length, estimatedGenerations: plan.estimatedGenerations, reused: plan.reused };
    log(`   asset_plan: ${choices.length} hình từ thư viện/biến thể, 0 lượt PixelLab (kế hoạch toàn hình mới bị chặn đúng).`);
  }

  async function answerImages() {
    const needed = await tool('assets_needed', { draftId, onlyRequested: true });
    if (needed.pixel) await declarePixelPlan(needed.pixel);
    let index = 0;
    for (const slot of needed.slots) {
      let file;
      if (needed.pixel) {
        const subject = slot.kind === 'background' ? `scene:${slot.targetId}`
          : slot.kind.startsWith('character-') ? `character:${slot.targetId}` : `item:${slot.targetId}`;
        const pick = pixelPick.get(subject);
        file = slot.kind === 'character-sprite' ? pick.sprite : slot.kind === 'character-portrait' ? pick.portrait : pick.file;
      } else if (slot.kind === 'cover') file = coverFile;
      else if (slot.kind === 'background') file = backgrounds[index++ % backgrounds.length];
      else if (slot.kind === 'character-sprite') {
        const npc = npcs[(results.images + index++) % npcs.length];
        file = npc.cached.sprite ?? npc.cached.idle ?? npc.cached.main;
      } else if (slot.kind === 'character-portrait') file = npcs[(results.images + index++) % npcs.length].cached.main;
      else file = items[(results.images + index++) % items.length].cached.main;
      const [width, height] = slot.size.split('x').map(Number);
      const checked = await tool('asset_process', { op: 'check_size', input: file, params: needed.pixel ? { width, height } : { transparent: slot.transparent } });
      if (needed.pixel && !checked.ok) throw new Error(`${slot.slotId}: ${checked.problems.join('; ')}`);
      await tool('asset_upload', { draftId, slotId: slot.slotId, file });
      results.images++;
      if (!checked.ok) results.sizeNotes = (results.sizeNotes ?? 0) + 1;
    }
    const done = await tool('assets_complete', { draftId });
    if (!done.accepted) throw new Error(`assets_complete refused: ${done.errors.join('; ')}`);
    results.imageRequests++;
    log(`   ${needed.slots.length} ảnh thư viện đã tải lên, assets_complete đạt.`);
  }

  // ------------------------------------------------------------------ 2-8. the bot loop
  const adminGate = { STORY: 'approve', TRUTH: 'approve-truth', LOGIC: 'approve-full-logic', LAYOUT: 'approve-scene-layout' };
  let playerViewDone = false;
  while (true) {
    if (Date.now() > deadline) throw new Error(`Hết giờ: ${JSON.stringify(results)}`);
    const draft = await tool('draft_get', { draftId });
    if (draft.status === 'READY_TO_PUBLISH' && (!draft.queueState || draft.queueState === 'NONE')) break;
    if (['GENERATED_INVALID', 'CASE_TRUTH_INVALID', 'CANCELLED'].includes(draft.status) && (!draft.queueState || draft.queueState === 'NONE')) {
      throw new Error(`Draft dừng ở ${draft.status}: ${draft.validator.firstErrors.join(' | ')}`);
    }
    if (draft.waitingGate) {
      if (draft.waitingGate === 'TRUTH' || full) {
        await admin('POST', `/api/admin/ai-cases/${draftId}/${adminGate[draft.waitingGate]}`);
        results.adminGates++;
        log(`   Cổng ${draft.waitingGate}: người đặt đơn duyệt trên admin (API admin local).`);
      } else {
        if (draft.waitingGate === 'LOGIC' && !playerViewDone) {
          const view = await tool('player_view', { draftId });
          const text = readFileSync(path.join(repo, view.file), 'utf8');
          if (/"(finalLogic|culpritId|correctMotiveId|correctMethodId)"/.test(text)) throw new Error('player-view.json lộ lời giải.');
          playerViewDone = true;
          log(`   player_view: ${view.file} (${view.kilobytes} KB, không có lời giải) cho thám tử mù.`);
        }
        await tool('draft_approve_gate', { draftId, gate: draft.waitingGate, allChecksPassed: true });
        results.botGates++;
        log(`   Cổng ${draft.waitingGate}: bot qua (chế độ nhanh).`);
      }
      continue;
    }
    const pending = await tool('bridge_list', { draftId });
    for (const request of pending.requests) {
      let taken = await tool('bridge_take', { requestId: request.requestId });
      if (!results.decision && taken.kind === 'JSON') {
        // draft_ask once: the request leaves the bot's list, the creator answers in the browser (admin API here),
        // and the bot finds the choice in decisions.json when it takes the request again.
        const asked = await tool('draft_ask', {
          requestId: request.requestId, key: 'e2e-check', question: 'E2E: chọn một lựa chọn.',
          options: [{ id: 'a', label: 'Lựa chọn A' }, { id: 'b', label: 'Lựa chọn B', detail: 'Thư viện', generations: 0 }],
        });
        if ((await tool('bridge_list', { draftId })).requests.some((row) => row.requestId === request.requestId)) {
          throw new Error('Yêu cầu đang chờ người chọn lẽ ra phải rời danh sách PENDING.');
        }
        const waiting = await admin('GET', `/api/admin/ai-cases/${draftId}`);
        if (waiting.orderStatus !== 'AWAITING_DECISION') throw new Error(`Đơn lẽ ra AWAITING_DECISION, đang là ${waiting.orderStatus}.`);
        await admin('POST', `/api/admin/ai-cases/${draftId}/decisions/${asked.decisionId}`, { optionId: 'b' });
        taken = await tool('bridge_take', { requestId: request.requestId });
        const decisions = JSON.parse(readFileSync(path.join(repo, taken.files.decisions), 'utf8'));
        if (decisions[0]?.chosenOptionId !== 'b') throw new Error(`decisions.json sai: ${JSON.stringify(decisions)}`);
        results.decision = { decisionId: asked.decisionId, chosen: decisions[0].chosenOptionId };
        log(`   draft_ask ${asked.decisionId}: rời hàng chờ, người đặt đơn chọn "Lựa chọn B", bot đọc lại trong decisions.json.`);
      }
      if (taken.kind === 'ASSETS') {
        await answerImages();
        continue;
      }
      if (!taken.files.devMockAnswer) throw new Error('Server không trả JSON mock (cần Bridge__ExposeMockResponses=true, ngoài Production).');
      copyFileSync(path.join(repo, taken.files.devMockAnswer), path.join(repo, taken.files.answer));
      const check = await tool('bridge_check', { requestId: request.requestId });
      if (!check.valid) throw new Error(`bridge_check ${taken.step}: ${check.errors.join('; ')}`);
      const submitted = await tool('bridge_submit', { requestId: request.requestId });
      if (!submitted.accepted) throw new Error(`bridge_submit ${taken.step}: ${submitted.errors.join('; ')}`);
      results.jsonAnswers++;
      log(`   ${taken.step}: take -> check -> submit đạt (prompt ${taken.promptKB} KB nằm trong ${taken.dir}).`);
    }
    await sleep(pending.count ? 200 : 700);
  }
  log(`2-8. READY_TO_PUBLISH: ${results.jsonAnswers} JSON, ${results.imageRequests} lượt ảnh (${results.images} ảnh), bot qua ${results.botGates} cổng, người duyệt ${results.adminGates} cổng.`);
  if (!playerViewDone) await tool('player_view', { draftId });

  const stale = await tool('bridge_list', { draftId, status: 'STALE', limit: 500 });
  if (stale.count) throw new Error(`${stale.count} yêu cầu STALE.`);

  // ------------------------------------------------------------------ 9. import, playtest, report
  const imported = await tool('draft_import', { draftId });
  log(`9. draft_import: ${imported.caseId} (chưa đăng), case JSON ở ${imported.caseFile}.`);
  const publishRoute = await fetch(`${stack.apiUrl}/api/bridge/drafts/${draftId}/publish`, { method: 'POST', headers: { 'X-Bridge-Key': process.env.SIRLOCKED_BRIDGE_KEY } });
  if (publishRoute.status !== 404 && publishRoute.status !== 405) throw new Error(`bridge publish route answered ${publishRoute.status}`);
  const play = await tool('playtest', { draftId, apiUrl: stack.apiUrl, webUrl: stack.webUrl });
  results.playtest = {
    ok: play.ok, accusationSuccess: play.summary?.accusationSuccess, scenes: play.summary?.scenesVisited, screenshots: play.screenshots.length,
    consoleErrors: play.summary?.consoleErrors, pageErrors: play.summary?.pageErrors, estimatedMinutes: play.estimatedMinutes, report: play.report,
    audio: play.audioChecks,
  };
  log(`   playtest: ok=${play.ok}, buộc tội đúng=${play.summary?.accusationSuccess}, ${play.screenshots.length} ảnh, ước tính ${play.estimatedMinutes} phút, lỗi console ${play.summary?.consoleErrors}.`);
  if (!play.ok) throw new Error(`playtest không đạt: ${JSON.stringify(play.summary ?? play.error)}`);

  // VUAN-6B: the imported case is a pixel case in the shape of "Tram hong ngoc" (render, sprite sheets, walk grids).
  const caseJson = JSON.parse(readFileSync(path.join(repo, imported.caseFile), 'utf8'));
  const scenesOf = (gameCase) => gameCase.stages.flatMap((stage) => stage.scenes);
  const pixelScenes = scenesOf(caseJson);
  const render = (scene) => scene.runtime?.render ?? {};
  if (!pixelScenes.every((scene) => render(scene).mode === 'pixel')) throw new Error('Vụ import chưa phải vụ pixel.');
  const tram = JSON.parse(readFileSync(path.join(repo, 'src', 'BE', 'SeedData', 'V3', 'case-pixel-tram-hong-ngoc-vi.json'), 'utf8'));
  const reference = Object.fromEntries(scenesOf(tram).map((scene) => [render(scene).projection, render(scene)]));
  const fields = ['nativeWidth', 'nativeHeight', 'pixelScale', 'cameraZoom', 'actorScale', 'walkSpeed', 'interactRadius'];
  for (const scene of pixelScenes) {
    const expected = reference[render(scene).projection];
    const diff = fields.filter((field) => render(scene)[field] !== expected[field]);
    if (diff.length || scene.runtime.width !== 2048 || render(scene).walkGrid?.cols !== 128) throw new Error(`${scene.sceneId} khác Trâm hồng ngọc: ${diff.join(', ')}`);
  }
  results.pixelShape = {
    scenes: pixelScenes.map((scene) => `${scene.sceneId}:${render(scene).projection}`),
    music: pixelScenes.every((scene) => scene.runtime.audio?.music?.url),
    outdoorRain: pixelScenes.filter((scene) => render(scene).projection === 'topdown').every((scene) => scene.runtime.weather?.type === 'RAIN'),
    indoorDry: pixelScenes.filter((scene) => render(scene).projection === 'isometric').every((scene) => !scene.runtime.weather && scene.runtime.indoor === true),
    blips: caseJson.characters.every((character) => character.voice?.blip),
    spriteSheets: caseJson.characters.filter((character) => character.presentation?.spriteSheet).map((character) => `${character.presentation.spriteSheet.frameWidth}x${character.presentation.spriteSheet.frameHeight}x${character.presentation.spriteSheet.frameCount}@${character.presentation.spriteSheet.fps}`),
    acceptedEvidence: caseJson.finalLogic.requiredEvidenceLinks.map((link) => `${link.claimType}:${(link.acceptedEvidenceIds ?? []).length}`),
    cover: pixelScenes.some((scene) => scene.backgroundUrl === caseJson.coverImageUrl),
  };
  log(`   vụ pixel: ${JSON.stringify(results.pixelShape)}`);

  const reportFile = path.join(repo, 'tmp', 'bridge', draftId, 'report.md');
  writeFileSync(reportFile, [
    '# Báo cáo của bot (e2e-local)', '',
    '| Lớp | Kết quả | Ghi chú |', '| --- | --- | --- |',
    `| 1. Schema | Đạt | ${results.jsonAnswers} câu trả lời qua bridge_check rồi bridge_submit |`,
    '| 2. Validator server | Đạt | Draft tới READY_TO_PUBLISH |',
    '| 3. Thám tử mù | Bỏ qua | e2e không có Claude thật; player_view đã kiểm không lộ lời giải |',
    '| 4. Biên tập | Bỏ qua | e2e dùng JSON mock của server |',
    `| 5. Chạy thử | ${play.ok ? 'Đạt' : 'Trượt'} | ${play.summary?.scenesVisited} cảnh, ${play.screenshots.length} ảnh, ${play.summary?.consoleErrors} lỗi console, ước tính ${play.estimatedMinutes} phút |`,
    '', `Tài nguyên: ${results.images} ảnh từ thư viện, 1 biến thể đêm, 0 lượt PixelLab (kế hoạch asset_plan đạt trần 0).`,
  ].join('\n'));
  const pushed = await tool('draft_report', { draftId });
  log(`   draft_report: ${pushed.length} ký tự đã lưu lên draft.`);

  // ------------------------------------------------------------------ library sync with the (local) server
  const syncKeys = ['v-case-pho', 'v-case-npc-ly-hanh', 'map-ben-cang', 'v-npc-11-thuy-thu', 'all-item-kinh-lup', 'all-item-trang-giay-trang']
    .filter((key) => JSON.parse(readFileSync(indexCopy, 'utf8')).items.some((item) => item.key === key));
  const sync = await tool('library_sync', { direction: 'both', keys: syncKeys });
  const onServer = await tool('library_search', { fromServer: true, includeRetired: true, query: '', limit: 500 });
  results.librarySync = { keys: syncKeys.length, push: sync.push, pull: sync.pull };
  log(`   library_sync: ${sync.push.filesUploaded} file lên server local, upsert ${JSON.stringify(sync.push.upsert)}; library_search fromServer thấy ${onServer.count} mục.`);

  results.durationSec = Math.round((Date.now() - started) / 1000);
  results.toolCalls = calls.length;
  results.toolsUsed = [...new Set(calls.map((call) => call.tool))];
  writeFileSync(path.join(work, 'result.json'), `${JSON.stringify({ ...results, calls }, null, 2)}\n`);
  log(`XONG: ${JSON.stringify({ ...results, calls: undefined })}`);
} catch (error) {
  console.error(`[e2e] THẤT BẠI: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  if (stack) console.error(`[e2e] log stack: ${JSON.stringify(stack.logs)}`);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => undefined);
  if (stack && !keep) await stack.stop();
  if (stack && keep) log(`Giữ stack: API ${stack.apiUrl}, web ${stack.webUrl} (dừng: xem ${path.join(stack.workDir, 'pids.json')}).`);
}
