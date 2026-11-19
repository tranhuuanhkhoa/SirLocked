/**
 * The automatic playtest: imports the case into a LOCAL stack (never production), two detectives play the
 * solution through the game API in the reachability simulator's order, Chromium shows both players and
 * captures each scene, and the run ends with the final accusation.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError, GameApi, sleep } from './http.js';
import { PlayerScreens, type PlayerSession } from './browser.js';
import { solidPng } from './png.js';
import {
  accusationMissing, accusationRequest, actionKey, canEnterScene, checkAudio, estimatePlayTime, missingForCondition,
  mergeProgress, orderedScenes, planScene, progressFromState, V3_PAIRED, type PlannedAction, type Progress, type Role,
} from './solver.js';
import { portsFromEnv, startStack, STACK_ADMIN_EMAIL, STACK_PASSWORD, type LocalStack } from './stack.js';
import type { Json, PlaytestOptions, PlaytestReport, PlaytestStep } from './types.js';

const LOCAL_DEMO_ADMIN = { email: 'admin@sirlocked.local', password: 'LocalDemo123!' };
const PLAYER_EMAILS: Record<Role, string> = {
  INVESTIGATOR: 'playtest-investigator@playtest.sirlocked.local',
  INTERROGATOR: 'playtest-interrogator@playtest.sirlocked.local',
};

interface Player extends PlayerSession {
  token: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function signature(progress: Progress): string {
  return [progress.unlockedClueIds, progress.inspectedItemIds, progress.collectedItemIds, progress.askedDialogueIds,
    progress.visitedConversationNodeIds, progress.solvedPuzzleIds, progress.usedInteractionIds, progress.resolvedChallengeIds,
    progress.solvedDeductionIds, progress.unlockedSceneIds, progress.completedSceneIds].map((list) => list.length).join('.');
}

function emptyReport(caseJson: Json): PlaytestReport {
  const estimate = estimatePlayTime(caseJson);
  return {
    ok: false, caseId: String(caseJson.caseId ?? ''), roomId: '', accusationSuccess: false, scenesVisited: [],
    screenshots: [], consoleErrors: [], pageErrors: [], failedRequests: [], pageApiErrors: [], steps: [],
    estimatedMinutes: estimate.minutes, estimateBreakdown: estimate.breakdown, durationMs: 0,
    audioChecks: checkAudio(caseJson), notes: [],
  };
}

export async function runPlaytest(options: PlaytestOptions): Promise<PlaytestReport> {
  const started = Date.now();
  const log = options.log ?? (() => undefined);
  const deadline = started + (options.timeoutMs ?? 20 * 60_000);
  const report = emptyReport(options.caseJson);
  mkdirSync(options.outDir, { recursive: true });
  let stack: LocalStack | null = null;
  let screens: PlayerScreens | null = null;
  const ports = {
    api: options.apiPort ?? portsFromEnv().api,
    web: options.webPort ?? portsFromEnv().web,
    mongo: options.mongoPort ?? portsFromEnv().mongo,
  };
  const step = (entry: PlaytestStep) => {
    report.steps.push(entry);
    log(`${entry.ok ? 'ok ' : 'NO '} ${entry.actor.padEnd(12)} ${entry.action} ${entry.target}${entry.error ? ` -> ${entry.error.slice(0, 160)}` : ''}`);
  };

  try {
    // ---------------------------------------------------------------- stack
    let apiUrl = options.apiUrl ?? process.env.PLAYTEST_API_URL ?? `http://127.0.0.1:${ports.api}`;
    let webUrl = options.webUrl ?? process.env.PLAYTEST_WEB_URL ?? `http://127.0.0.1:${ports.web}`;
    let api = new GameApi(apiUrl);
    let admin = {
      email: options.adminEmail ?? process.env.PLAYTEST_ADMIN_EMAIL ?? STACK_ADMIN_EMAIL,
      password: options.adminPassword ?? process.env.PLAYTEST_ADMIN_PASSWORD ?? STACK_PASSWORD,
    };
    if (!(await api.healthy())) {
      if (options.startStack === false) throw new Error(`${apiUrl} does not answer /health and startStack is off.`);
      const apiPort = Number(new URL(apiUrl).port) || ports.api;
      const webPort = Number(new URL(webUrl).port) || ports.web;
      stack = await startStack({
        repoRoot: options.repoRoot, apiPort, webPort, mongoPort: ports.mongo, web: options.screenshots !== false, log,
        detached: Boolean(options.keepStack),
      });
      apiUrl = stack.apiUrl;
      webUrl = stack.webUrl;
      api = new GameApi(apiUrl);
      admin = { email: stack.adminEmail, password: stack.adminPassword };
      report.notes.push(`Stack local tự dựng: API ${apiUrl}, web ${webUrl}, log ở ${stack.workDir}.`);
    } else {
      report.notes.push(`Dùng stack local đang chạy: API ${apiUrl}, web ${webUrl}.`);
    }

    // ---------------------------------------------------------------- import on the local stack only
    const adminToken = await adminLogin(api, admin);
    const caseId = String(options.caseJson.caseId ?? '');
    if (!caseId) throw new Error('The case JSON has no caseId.');
    const aiCase = Boolean(String(options.caseJson.sourceAiDraftId ?? '').trim() || String(options.caseJson.generationPreset ?? '').trim());
    // A case already on this local stack (e2e: the bridge imported the draft here, metadata intact) is played as is.
    const existing = options.reuseExistingCase === false
      ? null
      : await api.call<Json>('GET', `/api/admin/cases/${encodeURIComponent(caseId)}`, { token: adminToken }).catch(() => null);
    try {
      if (existing) {
        step({ action: 'reuse-local-case', actor: 'ADMIN', target: caseId, ok: true });
        report.notes.push(`Vụ ${caseId} đã có trên stack local (trạng thái ${existing.status}): chơi đúng bản đó, không import lại.`);
      } else {
        // preserveServerMetadata is read only by a server that supports it; the admin import otherwise resets
        // generationPreset and logicContractVersion, and a SHORT_DEMO AI case then fails the generic rules.
        await api.call('POST', '/api/admin/cases/import-json', {
          token: adminToken, body: { caseJson: options.caseJson, overwrite: true, ...(aiCase ? { preserveServerMetadata: true } : {}) },
        });
        step({ action: 'import', actor: 'ADMIN', target: caseId, ok: true });
      }
      if (String(existing?.status ?? '').toUpperCase() !== 'PUBLISHED') {
        await api.call('PATCH', `/api/admin/cases/${encodeURIComponent(caseId)}/publish`, { token: adminToken });
        step({ action: 'publish-local', actor: 'ADMIN', target: caseId, ok: true });
      }
    } catch (error) {
      step({ action: 'import/publish-local', actor: 'ADMIN', target: caseId, ok: false, error: message(error) });
      const hint = aiCase && error instanceof ApiError && [400, 422].includes(error.status)
        ? ' Vụ AI: import-json của admin bỏ metadata AI (generationPreset, logicContractVersion) nên luật chung có thể từ chối;'
          + ' chạy playtest trên stack đã import draft qua bridge (vụ có sẵn sẽ được dùng lại) hoặc cần server hỗ trợ preserveServerMetadata.'
        : '';
      throw new Error(`Import or local publish refused: ${message(error)}${hint}`);
    }
    // The stored case is the truth the server plays (it fills interactive puzzle solutions on import).
    const canon: Json = await api.call('GET', `/api/admin/cases/${encodeURIComponent(caseId)}`, { token: adminToken });
    const estimate = estimatePlayTime(canon);
    report.estimatedMinutes = estimate.minutes;
    report.estimateBreakdown = estimate.breakdown;
    report.audioChecks = checkAudio(canon);

    // ---------------------------------------------------------------- players and room
    const inv = await playerLogin(api, 'INVESTIGATOR');
    const int = await playerLogin(api, 'INTERROGATOR');
    const players: Record<Role, Player> = { INVESTIGATOR: inv, INTERROGATOR: int };
    const room = await createRoom(api, inv, int, caseId);
    report.roomId = room.roomId;
    step({ action: 'room-start', actor: 'SYSTEM', target: room.roomId, ok: true });
    const game = (path: string) => `/api/game/rooms/${room.roomId}${path}`;
    const stateOf = (player: Player) => api.call<Json>('GET', game('/state'), { token: player.token });

    if (options.screenshots !== false) {
      screens = await PlayerScreens.open({
        repoRoot: options.repoRoot, webUrl, roomId: room.roomId, players: [inv, int],
        outDir: options.outDir, headless: options.headless !== false, log,
      });
    }
    const sceneOf = (state: Json) => String(state.visibleScene?.sceneId || state.currentSceneId || '');
    for (const role of ['INVESTIGATOR', 'INTERROGATOR'] as Role[]) {
      const current = sceneOf(await stateOf(players[role]));
      if (current) await screens?.sync(role, current, 30_000);
    }

    const moveTo = async (role: Role, sceneId: string) => {
      const player = players[role];
      if (sceneOf(await stateOf(player)) !== sceneId) {
        try {
          await api.call('POST', game('/go-to-scene'), { token: player.token, body: { sceneId } });
          step({ action: 'go-to-scene', actor: role, target: sceneId, ok: true, sceneId });
        } catch (error) {
          step({ action: 'go-to-scene', actor: role, target: sceneId, ok: false, error: message(error), sceneId });
          return false;
        }
      }
      await screens?.sync(role, sceneId);
      return true;
    };

    // ---------------------------------------------------------------- play
    const scenes = orderedScenes(canon);
    const failedAt = new Map<string, string>();
    // An action the server accepted is never sent again, even when a projection hides its effect.
    const succeeded = new Set<string>();
    const roomProgress = async () => mergeProgress(progressFromState(await stateOf(inv)), progressFromState(await stateOf(int)));
    const execute = (action: PlannedAction, sceneId: string) =>
      executeAction(api, game, players, action, sceneId, canon, step, screens);
    for (let pass = 1; pass <= 40 && Date.now() < deadline; pass++) {
      let progressed = false;
      for (const scene of scenes) {
        if (Date.now() > deadline) break;
        let progress = await roomProgress();
        if (!canEnterScene(canon, progress, scene.sceneId)) continue;
        const skip = () => new Set([
          ...succeeded,
          ...[...failedAt].filter(([, sig]) => sig === signature(progress)).map(([key]) => key),
        ]);
        let actions = planScene(canon, scene, progress, skip());
        const needVisit = !progress.visitedSceneIds.includes(scene.sceneId);
        if (!actions.length && !needVisit) continue;
        const roles = new Set<Role>(['INVESTIGATOR']);
        if (needVisit || actions.some((action) => action.actor === 'INTERROGATOR' || action.kind === 'crack')) roles.add('INTERROGATOR');
        let moved = true;
        for (const role of roles) moved = (await moveTo(role, scene.sceneId)) && moved;
        if (!moved) continue;
        if (needVisit) progressed = true;
        for (let inner = 0; inner < 120 && Date.now() < deadline; inner++) {
          progress = await roomProgress();
          actions = planScene(canon, scene, progress, skip());
          if (!actions.length) break;
          const action = actions[0];
          if (action.actor === 'INTERROGATOR' && !roles.has('INTERROGATOR')) {
            roles.add('INTERROGATOR');
            await moveTo('INTERROGATOR', scene.sceneId);
          }
          const ok = await execute(action, scene.sceneId);
          if (ok) {
            progressed = true;
            succeeded.add(actionKey(action));
          } else failedAt.set(actionKey(action), signature(progress));
        }
      }
      if (!progressed) break;
    }

    // ---------------------------------------------------------------- accusation
    const lastScene = scenes[scenes.length - 1];
    await moveTo('INVESTIGATOR', lastScene.sceneId);
    await moveTo('INTERROGATOR', lastScene.sceneId);
    const invState = await stateOf(inv);
    const progress = await roomProgress();
    report.scenesVisited = progress.visitedSceneIds;
    if (!invState.availableForAccusation) {
      const firstOpen = scenes.find((scene) => !progress.completedSceneIds.includes(scene.sceneId));
      const missing = accusationMissing(canon, progress);
      if (firstOpen) {
        for (const line of missingForCondition(firstOpen.completeCondition, progress).missing) missing.push(`${firstOpen.sceneId}: ${line}`);
        if (!canEnterScene(canon, progress, firstOpen.sceneId)) missing.push(`${firstOpen.sceneId}: chưa mở được cảnh`);
      }
      report.stuck = { sceneId: firstOpen?.sceneId ?? lastScene.sceneId, missing: [...new Set(missing)] };
      throw new Error(`Stuck before the accusation: ${report.stuck.missing.slice(0, 6).join('; ')}`);
    }
    const body = accusationRequest(canon);
    let result: Json | null = null;
    const consensus = async () => {
      const proposed = await api.call<Json>('POST', game('/accusation'), { token: inv.token, body });
      step({ action: 'accusation-propose', actor: 'INVESTIGATOR', target: body.culpritId, ok: true });
      if (proposed.result) return proposed.result as Json;
      const attemptId = proposed.accusation?.attemptId;
      const confirmed = await api.call<Json>('POST', game(`/accusation/${attemptId}/confirm`), {
        token: int.token, body: { expectedRevision: proposed.accusation?.revision ?? 1 },
      });
      step({ action: 'accusation-confirm', actor: 'INTERROGATOR', target: String(attemptId), ok: true });
      return (confirmed.result as Json) ?? null;
    };
    try {
      if (Number(canon.mechanicsVersion ?? 1) >= V3_PAIRED) result = await consensus();
      else {
        try {
          result = await api.call<Json>('POST', game('/accuse'), { token: inv.token, body });
          step({ action: 'accuse', actor: 'INVESTIGATOR', target: body.culpritId, ok: true });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) result = await consensus();
          else throw error;
        }
      }
    } catch (error) {
      step({ action: 'accusation', actor: 'INVESTIGATOR', target: body.culpritId, ok: false, error: message(error) });
      throw error;
    }
    const final = await api.call<Json>('GET', game('/result'), { token: inv.token }).catch(() => result);
    report.accusationSuccess = Boolean(final?.success ?? result?.success);
    if (!report.accusationSuccess) report.notes.push(`Kết quả buộc tội: ${JSON.stringify(final ?? result).slice(0, 400)}`);
    await screens?.finalShot('INVESTIGATOR', 'ket-qua');
  } catch (error) {
    report.error = message(error);
    log(`playtest stopped: ${report.error}`);
  } finally {
    if (screens) {
      // The game page posts UI telemetry to /playtest-events even when the server has it switched off
      // (GameplayV3:PlaytestInstrumentationEnabled=false, the default): every stack answers 409. Not a case defect.
      const telemetry = (line: string) => line.includes('/playtest-events');
      const noise = screens.consoleErrors.filter(telemetry).length;
      if (noise) report.notes.push(`${noise} lỗi console 409 từ /playtest-events (game gửi đo đạc khi server tắt đo đạc; có trên mọi stack, không phải lỗi của vụ) đã tách khỏi consoleErrors.`);
      report.consoleErrors.push(...screens.consoleErrors.filter((line) => !telemetry(line)));
      report.pageErrors.push(...screens.pageErrors);
      report.failedRequests.push(...[...new Set(screens.failedRequests)]);
      report.pageApiErrors.push(...screens.apiErrors.filter((line) => !telemetry(line)));
      report.screenshots.push(...screens.screenshots);
      report.notes.push(...screens.notes);
      await screens.close();
    }
    if (stack && !options.keepStack) await stack.stop();
    else if (stack) {
      const pids = stack.detach();
      const how = process.platform === 'win32' ? pids.map((pid) => 'taskkill /PID ' + pid + ' /T /F').join(' ; ') : 'kill ' + pids.join(' ');
      report.notes.push('Stack local vẫn chạy (keepStack): ' + stack.apiUrl + ', ' + stack.webUrl + '. Dừng bằng: ' + how + ' (PIDs cũng ở ' + stack.workDir + '/pids.json).');
    }
    report.durationMs = Date.now() - started;
    report.ok = report.accusationSuccess && report.pageErrors.length === 0 && !report.error;
    writeFileSync(path.join(options.outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  }
  return report;
}

// -------------------------------------------------------------------- accounts and room

async function adminLogin(api: GameApi, admin: { email: string; password: string }): Promise<string> {
  const attempt = async (credentials: { email: string; password: string }) => {
    const data = await api.call<Json>('POST', '/api/auth/admin/login', { body: credentials, rateLimitWaitMs: 75_000 });
    return String(data?.token ?? '');
  };
  try {
    const token = await attempt(admin);
    if (token) return token;
  } catch (error) {
    if (!(error instanceof ApiError) || ![400, 401, 403].includes(error.status) || admin.email === LOCAL_DEMO_ADMIN.email) throw error;
  }
  // An external stack started by scripts/start-local-demo.ps1 seeds this loopback-only admin.
  const token = await attempt(LOCAL_DEMO_ADMIN);
  if (!token) throw new Error('Admin sign-in returned no token.');
  return token;
}

async function playerLogin(api: GameApi, role: Role): Promise<Player> {
  const email = PLAYER_EMAILS[role];
  const password = process.env.PLAYTEST_PLAYER_PASSWORD ?? STACK_PASSWORD;
  // Sign-ins are limited to 5 a minute and sign-ups to 3 per 5 minutes per address: sign in first, and register
  // (which signs the new account in) only when the account does not exist yet.
  let auth: Json | null = null;
  try {
    auth = await api.call<Json>('POST', '/api/auth/login', { body: { email, password }, rateLimitWaitMs: 75_000 });
  } catch (error) {
    if (!(error instanceof ApiError) || ![400, 401, 404].includes(error.status)) throw error;
    auth = await api.call<Json>('POST', '/api/auth/register', {
      body: { fullName: role === 'INVESTIGATOR' ? 'Điều tra viên thử' : 'Thẩm vấn viên thử', email, password },
      rateLimitWaitMs: 310_000,
    });
    if (!auth?.token) auth = await api.call<Json>('POST', '/api/auth/login', { body: { email, password }, rateLimitWaitMs: 75_000 });
  }
  if (!auth?.token) throw new Error(`Player sign-in for ${role} returned no token.`);
  return {
    role, token: auth.token,
    auth: { token: auth.token, refreshToken: auth.refreshToken, refreshTokenExpiry: auth.refreshTokenExpiry, user: auth.user },
  };
}

async function leaveRooms(api: GameApi, player: Player): Promise<void> {
  const mine = await api.call<Json[]>('GET', '/api/rooms/mine', { token: player.token }).catch(() => [] as Json[]);
  for (const room of Array.isArray(mine) ? mine : []) {
    const roomId = room.roomId ?? room.id;
    if (!roomId) continue;
    await api.call('POST', `/api/rooms/${roomId}/abandon`, { token: player.token }).catch(() => undefined);
    await api.call('POST', `/api/rooms/${roomId}/leave`, { token: player.token }).catch(() => undefined);
  }
}

async function createRoom(api: GameApi, inv: Player, int: Player, caseId: string): Promise<{ roomId: string; roomCode: string }> {
  let room: Json;
  try {
    room = await api.call<Json>('POST', '/api/rooms', { token: inv.token, body: { caseId } });
  } catch (error) {
    await leaveRooms(api, inv);
    await leaveRooms(api, int);
    room = await api.call<Json>('POST', '/api/rooms', { token: inv.token, body: { caseId } }).catch((second) => {
      throw new Error(`Room refused: ${message(error)} / ${message(second)}`);
    });
  }
  try {
    await api.call('POST', '/api/rooms/join', { token: int.token, body: { roomCode: room.roomCode } });
  } catch (error) {
    await leaveRooms(api, int);
    await api.call('POST', '/api/rooms/join', { token: int.token, body: { roomCode: room.roomCode } });
  }
  for (const player of [inv, int]) {
    await api.call('POST', `/api/rooms/${room.roomId}/select-role`, { token: player.token, body: { role: player.role } });
    await api.call('POST', `/api/rooms/${room.roomId}/ready`, { token: player.token, body: { isReady: true } });
  }
  await api.call('POST', `/api/rooms/${room.roomId}/start`, { token: inv.token });
  return { roomId: room.roomId, roomCode: room.roomCode };
}

// -------------------------------------------------------------------- actions

async function executeAction(
  api: GameApi,
  game: (path: string) => string,
  players: Record<Role, Player>,
  action: PlannedAction,
  sceneId: string,
  canon: Json,
  step: (entry: PlaytestStep) => void,
  screens: PlayerScreens | null,
): Promise<boolean> {
  const inv = players.INVESTIGATOR;
  const int = players.INTERROGATOR;
  const record = (target: string, ok: boolean, error?: string, actor: Role = action.actor) =>
    step({ action: action.kind, actor, target, ok, error, sceneId });
  try {
    switch (action.kind) {
      case 'inspect': {
        await api.call('POST', game('/inspect-item'), { token: inv.token, body: { itemId: action.itemId } });
        record(action.itemId, true);
        return true;
      }
      case 'interaction': {
        const interaction = action.interaction;
        const type = String(interaction.type).toUpperCase();
        if (type === 'COMBINE_ITEMS') {
          await api.call('POST', game('/combine-items'), { token: inv.token, body: { itemIds: interaction.requiredItemIds } });
        } else if (type === 'USE_ITEM_ON_TARGET') {
          await api.call('POST', game('/use-item'), {
            token: inv.token, body: { itemId: interaction.requiredItemIds[0], targetId: interaction.targetId },
          });
        } else {
          await api.call('POST', game(`/interactions/${encodeURIComponent(interaction.interactionId)}/activate`), { token: inv.token });
        }
        record(interaction.interactionId, true);
        return true;
      }
      case 'puzzle': {
        for (const payload of action.solution.probes) {
          await api.call('POST', game('/puzzle-probe'), { token: inv.token, body: { puzzleId: action.puzzle.puzzleId, payload } });
        }
        const response = await api.call<Json>('POST', game('/solve-puzzle'), { token: inv.token, body: action.solution.request });
        const solved = Array.isArray(response?.state?.solvedPuzzleIds) && response.state.solvedPuzzleIds.includes(action.puzzle.puzzleId);
        const label = `${action.puzzle.puzzleId} (${action.puzzle.kind || action.puzzle.type})`;
        record(label, solved, solved ? undefined : `server: ${response?.message ?? 'not solved'}`);
        return solved;
      }
      case 'ask': {
        await api.call('POST', game('/ask-dialogue'), { token: int.token, body: { dialogueId: action.dialogueId } });
        record(action.dialogueId, true);
        return true;
      }
      case 'converse': {
        const body: Json = { characterId: action.characterId, nodeId: action.nodeId };
        if (action.choiceId) body.choiceId = action.choiceId;
        await api.call('POST', game('/converse'), { token: int.token, body });
        record(`${action.characterId} -> ${action.targetNodeId}`, true);
        return true;
      }
      case 'crack':
        return await crack(api, game, inv, int, action.challenge, canon, record);
      case 'deduction': {
        await api.call('POST', game('/solve-deduction'), { token: inv.token, body: { deductionId: action.deductionId, optionId: action.optionId } });
        record(`${action.deductionId} = ${action.optionId}`, true);
        return true;
      }
      case 'camera': {
        const bounds = action.bounds;
        const form = new FormData();
        form.append('sceneId', action.sceneId);
        form.append('captureRect.x', String(bounds.x));
        form.append('captureRect.y', String(bounds.y));
        form.append('captureRect.width', String(bounds.width));
        form.append('captureRect.height', String(bounds.height));
        form.append('photo', new Blob([new Uint8Array(solidPng(96, 64))], { type: 'image/png' }), 'evidence.png');
        const response = await api.call<Json>('POST', game('/capture-clue'), { token: inv.token, form });
        const ok = String(response?.captureResult ?? '').toUpperCase() !== 'MISS' && String(response?.captureResult ?? '').toUpperCase() !== 'NEAR_MISS';
        record(action.clueId, ok, ok ? undefined : `capture ${response?.captureResult}`);
        if (ok) await screens?.capture('INVESTIGATOR', sceneId, `-anh-${action.clueId}`).catch(() => undefined);
        return ok;
      }
    }
  } catch (error) {
    const target = action.kind === 'inspect' ? action.itemId
      : action.kind === 'interaction' ? String(action.interaction.interactionId)
        : action.kind === 'puzzle' ? String(action.puzzle.puzzleId)
          : action.kind === 'ask' ? action.dialogueId
            : action.kind === 'converse' ? `${action.characterId} -> ${action.targetNodeId}`
              : action.kind === 'crack' ? String(action.challenge.challengeId)
                : action.kind === 'deduction' ? action.deductionId : action.clueId;
    record(target, false, message(error));
    return false;
  }
}

/** One Crack-the-Lie: the interrogator puts the lie up, the investigator the evidence, both confirm. */
async function crack(
  api: GameApi,
  game: (path: string) => string,
  inv: Player,
  int: Player,
  challenge: Json,
  canon: Json,
  record: (target: string, ok: boolean, error?: string, actor?: Role) => void,
): Promise<boolean> {
  const challengeId = String(challenge.challengeId);
  if (Number(canon.mechanicsVersion ?? 1) < V3_PAIRED) {
    await api.call('POST', game('/present-evidence'), {
      token: int.token, body: { challengeId, dialogueId: challenge.dialogueId, evidenceId: challenge.correctEvidenceId },
    });
    record(challengeId, true);
    return true;
  }
  const base = game('/paired-confrontations');
  const attemptId = randomUUID();
  let revision = 1;
  try {
    const startedAttempt = await api.call<Json>('POST', base, {
      token: int.token, body: { attemptId, testimonyFragmentId: challenge.testimonyFragmentId },
    });
    revision = Number(startedAttempt?.revision ?? 1);
  } catch (error) {
    // Not ready yet (the readiness sets are incomplete): retried after more progress.
    record(challengeId, false, `start: ${message(error)}`);
    return false;
  }
  try {
    const proposed = await api.call<Json>('PUT', `${base}/${attemptId}/evidence`, {
      token: inv.token, body: { evidenceId: challenge.correctEvidenceId, expectedRevision: revision },
    });
    revision = Number(proposed?.revision ?? revision);
    const first = await api.call<Json>('POST', `${base}/${attemptId}/confirm`, { token: int.token, body: { expectedRevision: revision } });
    revision = Number(first?.revision ?? revision);
    const second = await api.call<Json>('POST', `${base}/${attemptId}/confirm`, { token: inv.token, body: { expectedRevision: revision } });
    await sleep(100);
    const resolved = second?.state?.resolvedConfrontations?.some((entry: Json) => entry.challengeId === challengeId)
      ?? false;
    record(`${challengeId} (${challenge.correctEvidenceId})`, resolved, resolved ? undefined : `status ${second?.status}`);
    return resolved;
  } catch (error) {
    // Free the room: an open confrontation blocks moving between scenes.
    await api.call('POST', `${base}/${attemptId}/cancel`, { token: int.token, body: { expectedRevision: revision } }).catch(() => undefined);
    record(challengeId, false, message(error));
    return false;
  }
}
