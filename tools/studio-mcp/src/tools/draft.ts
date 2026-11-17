/** draft_get, draft_approve_gate, draft_import, draft_report, player_view, assets_needed, asset_upload, assets_complete. */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { StudioError } from '../bridge-client.js';
import { bridgeDir, display, requireFile, safeId, writeJsonFile } from '../files.js';
import { inspect } from '../image/process.js';
import { clip, type ToolContext } from './context.js';

export async function draftGet(ctx: ToolContext, args: { draftId: string }) {
  const draftId = safeId(args.draftId, 'draftId');
  const { data } = await ctx.client.call<any>('GET', `/api/bridge/drafts/${draftId}`);
  const file = path.join(bridgeDir(ctx.config, draftId), 'draft.json');
  writeJsonFile(file, data);
  const validator = data?.validator ?? {};
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  const errorText = (entry: any) => (typeof entry === 'string' ? entry : entry?.message ?? JSON.stringify(entry));
  return {
    draftId, status: data.status, queueState: data.queueState, orderStatus: data.orderStatus, waitingGate: data.waitingGate ?? null,
    nextAction: data.nextAction, reviewMode: data.order?.order?.reviewMode ?? data.order?.reviewMode ?? null,
    pixelLabCap: data.order?.order?.pixelLabCap ?? null, world: data.order?.order?.world ?? null,
    caseId: data.caseId, caseTitle: data.caseTitle, importedCaseId: data.importedCaseId || null,
    claudeWait: data.claudeWait ?? null,
    openRequests: list(data.openRequests),
    validator: {
      validationErrors: list(validator.validationErrors).length,
      blueprintErrors: list(validator.blueprintValidationErrors).length,
      truthReview: validator.truthReview?.status ?? null,
      semanticReview: validator.semanticReview ?? null,
      blindReview: validator.blindReview ?? null,
      firstErrors: [...list(validator.validationErrors), ...list(validator.blueprintValidationErrors), ...list(validator.lastAttemptErrors)]
        .slice(0, 12).map((entry) => clip(errorText(entry), 240)),
    },
    failure: data.failurePhase ? { phase: data.failurePhase, code: data.lastGenerationErrorCode, failedAssets: data.failedAssetIds } : null,
    hasReport: Boolean(data.hasReport),
    file: display(ctx.config, file),
  };
}

const BOT_GATES = new Set(['STORY', 'LOGIC', 'LAYOUT']);

export async function draftApproveGate(ctx: ToolContext, args: { draftId: string; gate: string; allChecksPassed: boolean }) {
  const draftId = safeId(args.draftId, 'draftId');
  const gate = String(args.gate ?? '').trim().toUpperCase();
  if (gate === 'TRUTH') throw new StudioError('GATE_FORBIDDEN', 'Cổng sự thật (TRUTH) luôn do Yen duyệt trên admin. Bot không bao giờ qua cổng này.');
  if (!BOT_GATES.has(gate)) throw new StudioError('BAD_ARGS', 'gate phải là STORY, LOGIC hoặc LAYOUT.');
  if (args.allChecksPassed !== true) {
    throw new StudioError('CHECKS_NOT_PASSED', 'Chỉ qua cổng khi mọi lớp kiểm tra (schema, validator, thám tử mù, biên tập) đều đạt. Chưa đạt thì để Yen duyệt.');
  }
  const draft = await draftGet(ctx, { draftId });
  if (draft.reviewMode !== 'FAST') {
    throw new StudioError('NOT_FAST_MODE', 'Đơn này ở chế độ duyệt đầy đủ (FULL): mọi cổng do Yen duyệt trên admin. Chờ Yen.');
  }
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/drafts/${draftId}/approve-gate`, { json: { gate } });
  return { draftId, gate, status: data?.status, queueState: data?.queueState, message: `Bot đã qua cổng ${gate} (chế độ nhanh).` };
}

/** The whole case JSON (solution included) saved for the local playtest; never handed to the blind detective. */
export async function fetchCaseJson(ctx: ToolContext, draftId: string): Promise<{ file: string; source: string; caseId: string }> {
  const { data } = await ctx.client.call<any>('GET', `/api/bridge/drafts/${safeId(draftId, 'draftId')}/case-json`);
  const file = path.join(bridgeDir(ctx.config, draftId), 'case.json');
  writeJsonFile(file, data.caseJson);
  return { file, source: data.source, caseId: data.caseId };
}

export async function draftImport(ctx: ToolContext, args: { draftId: string }) {
  const draftId = safeId(args.draftId, 'draftId');
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/drafts/${draftId}/import`);
  let caseFile: string | null = null;
  try {
    caseFile = display(ctx.config, (await fetchCaseJson(ctx, draftId)).file);
  } catch {
    caseFile = null; // older server without case-json: playtest can still take a casePath
  }
  return {
    draftId, caseId: data?.caseId, title: data?.title, status: data?.status, caseFile,
    message: 'Đã import bản nháp để chạy thử. KHÔNG publish: chỉ ADMIN bấm Xuất bản trên admin.',
    next: 'playtest { draftId }',
  };
}

export async function draftReport(ctx: ToolContext, args: { draftId: string; file?: string }) {
  const draftId = safeId(args.draftId, 'draftId');
  const file = requireFile(ctx.config, args.file ?? path.join(bridgeDir(ctx.config, draftId), 'report.md'));
  const markdown = readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!markdown.trim()) throw new StudioError('EMPTY_REPORT', 'report.md đang trống.');
  const { data } = await ctx.client.call<any>('PUT', `/api/bridge/drafts/${draftId}/report`, { json: { markdown } });
  return { draftId, length: data?.length, updatedAt: data?.updatedAt, file: display(ctx.config, file), message: 'Đã lưu report.md lên draft (admin xem trong chi tiết draft).' };
}

function countDeep(value: any, key: string): number {
  return Array.isArray(value?.[key]) ? value[key].length : 0;
}

export async function playerView(ctx: ToolContext, args: { draftId: string }) {
  const draftId = safeId(args.draftId, 'draftId');
  const { data } = await ctx.client.call<any>('GET', `/api/bridge/drafts/${draftId}/player-view`);
  const file = path.join(bridgeDir(ctx.config, draftId), 'player-view.json');
  writeJsonFile(file, data);
  const scenes = Array.isArray(data?.stages) ? data.stages.reduce((sum: number, stage: any) => sum + (stage?.scenes?.length ?? 0), 0) : 0;
  return {
    draftId, file: display(ctx.config, file), kilobytes: Math.round(statSync(file).size / 1024),
    counts: {
      characters: countDeep(data, 'characters'), clues: countDeep(data, 'clues'), items: countDeep(data, 'items'),
      dialogues: countDeep(data, 'dialogues'), scenes,
    },
    next: `Giao CHỈ file ${display(ctx.config, file)} cho agent tham-tu-mu (không đưa case.json hay prompt).`,
  };
}

export async function assetsNeeded(ctx: ToolContext, args: { draftId: string; onlyRequested?: boolean }) {
  const draftId = safeId(args.draftId, 'draftId');
  const { data } = await ctx.client.call<any>('GET', `/api/bridge/drafts/${draftId}/assets-needed`);
  const file = path.join(bridgeDir(ctx.config, draftId), 'assets-needed.json');
  writeJsonFile(file, data);
  const slots = (data?.slots ?? []).filter((slot: any) => !args.onlyRequested || slot.requestedNow || slot.mustReplace);
  const pixel = data?.pixel;
  let planFile: string | undefined;
  if (pixel?.plan) {
    planFile = path.join(bridgeDir(ctx.config, draftId), 'pixellab-plan.json');
    writeJsonFile(planFile, pixel.plan);
  }
  return {
    draftId, file: display(ctx.config, file), storageAvailable: data?.storageAvailable, maxBytes: data?.maxBytes, formats: data?.formats,
    // VUAN-6B pixel drafts: where each picture comes from, and the PixelLab request plan built from templates.json.
    pixel: pixel ? {
      pixelLabCap: pixel.pixelLabCap, planAccepted: pixel.planAccepted, estimatedGenerations: pixel.estimatedGenerations,
      withinCap: pixel.withinCap, planErrors: pixel.planErrors, next: pixel.next,
      planFile: planFile ? display(ctx.config, planFile) : undefined,
      requests: (pixel.plan?.requests ?? []).map((request: any) => ({
        id: request.id, order: request.order, tool: request.tool, estimatedGenerations: request.estimatedGenerations,
        dependsOn: request.dependsOn, dependsOnLibrary: request.dependsOnLibrary, missingInputs: (request.missingInputs ?? []).length,
        slots: request.target?.slots,
      })),
      subjects: (pixel.subjects ?? []).map((subject: any) => ({
        subject: subject.subject, kind: subject.kind, name: subject.name, projection: subject.projection ?? undefined,
        libraryKind: subject.libraryKind, slots: subject.slots, declared: subject.declared, source: subject.source,
        libraryKey: subject.libraryKey || undefined, parentKey: subject.parentKey || undefined, suggestions: subject.suggestions,
      })),
    } : null,
    openRequest: data?.openRequest ? { requestId: data.openRequest.requestId, step: data.openRequest.step, phase: data.openRequest.assetPhase } : null,
    total: data?.slots?.length ?? 0,
    requestedNow: (data?.slots ?? []).filter((slot: any) => slot.requestedNow).length,
    slots: slots.map((slot: any) => ({
      slotId: slot.slotId, kind: slot.kind, targetId: slot.targetId, name: slot.name, phase: slot.phase, size: `${slot.width}x${slot.height}`,
      transparent: slot.transparent, required: slot.required, requestedNow: slot.requestedNow, mustReplace: slot.mustReplace,
      hasPicture: Boolean(slot.currentUrl), art: clip(slot.artDirection, 160),
    })),
    hint: data?.storageAvailable === false ? 'Server chưa có nơi lưu ảnh (Cloudinary tắt): chưa tải được.' : 'Đủ ảnh cho mọi ô requestedNow thì gọi assets_complete.',
  };
}

export async function assetUpload(ctx: ToolContext, args: { draftId: string; slotId: string; file: string; width?: number; height?: number; transparent?: boolean }) {
  const draftId = safeId(args.draftId, 'draftId');
  if (!args.slotId) throw new StudioError('BAD_ARGS', 'Thiếu slotId (xem assets_needed).');
  const file = requireFile(ctx.config, args.file);
  const bytes = readFileSync(file);
  const info = await inspect(bytes);
  if (!['png', 'webp'].includes(info.format)) throw new StudioError('ASSET_FORMAT', `Chỉ nhận PNG hoặc WebP (file là ${info.format}).`);
  if (bytes.length > 5 * 1024 * 1024) throw new StudioError('ASSET_TOO_LARGE', 'Ảnh lớn hơn 5 MB.');
  const warnings: string[] = [];
  if (args.width && info.width !== args.width) warnings.push(`rộng ${info.width}, ô cần ${args.width}`);
  if (args.height && info.height !== args.height) warnings.push(`cao ${info.height}, ô cần ${args.height}`);
  if (args.transparent && !info.hasAlpha) warnings.push('ô cần nền trong suốt nhưng ảnh không có alpha');
  const form = new FormData();
  form.append('slotId', args.slotId);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: info.format === 'webp' ? 'image/webp' : 'image/png' }), path.basename(file));
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/drafts/${draftId}/assets`, { form });
  return { draftId, slotId: args.slotId, url: data?.url, width: data?.width, height: data?.height, hasAlpha: data?.hasAlpha, bytes: data?.bytes, warnings };
}

export async function assetsComplete(ctx: ToolContext, args: { draftId: string }) {
  const draftId = safeId(args.draftId, 'draftId');
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/drafts/${draftId}/assets/complete`);
  return {
    draftId, accepted: Boolean(data?.accepted), errors: (data?.errors ?? []).slice(0, 40), next: data?.next ?? null,
    hint: data?.accepted ? 'Server đi tiếp (bố cục, kiểm tra vị trí...). Xem bridge_list.' : 'Còn ô chưa có ảnh: tải nốt rồi gọi lại.',
  };
}

export interface AssetChoice {
  subject: string;
  source: 'LIBRARY' | 'VARIANT' | 'PIXELLAB';
  libraryKey?: string;
  parentKey?: string;
  variant?: string;
  /** LIBRARY/VARIANT scene: items the picture does not show yet, painted in by PixelLab inpaint (never pasted). */
  inpaintItems?: string[];
  note?: string;
}

/**
 * Pixel drafts (VUAN-6B): declares where every picture comes from. The server builds the PixelLab request plan from
 * templates.json; a plan over the order's pixelLabCap is refused (AI_PIXELLAB_CAP_EXCEEDED) and no upload is accepted
 * before a plan fits. Subjects left out count as new PixelLab pictures.
 */
export async function assetPlan(ctx: ToolContext, args: { draftId: string; choices: AssetChoice[] }) {
  const draftId = safeId(args.draftId, 'draftId');
  if (!Array.isArray(args.choices)) throw new StudioError('BAD_ARGS', 'choices là mảng { subject, source: LIBRARY|VARIANT|PIXELLAB, libraryKey, parentKey, variant } (xem subjects của assets_needed).');
  const { data } = await ctx.client.call<any>('PUT', `/api/bridge/drafts/${draftId}/asset-plan`, { json: { choices: args.choices } });
  const file = path.join(bridgeDir(ctx.config, draftId), 'pixellab-plan.json');
  writeJsonFile(file, data?.plan ?? {});
  const requests = (data?.plan?.requests ?? []) as any[];
  return {
    draftId, accepted: Boolean(data?.accepted), estimatedGenerations: data?.estimatedGenerations, pixelLabCap: data?.pixelLabCap,
    file: display(ctx.config, file),
    requests: requests.map((request) => ({
      id: request.id, order: request.order, tool: request.tool, size: request.params?.width && request.params?.height ? `${request.params.width}x${request.params.height}` : undefined,
      estimatedGenerations: request.estimatedGenerations, dependsOn: request.dependsOn, dependsOnLibrary: request.dependsOnLibrary,
      missingInputs: (request.missingInputs ?? []).map((entry: any) => entry.placeholder), slots: request.target?.slots,
    })),
    reused: (data?.plan?.reuse ?? []).length,
    next: requests.length
      ? 'Chạy từng request theo thứ tự (lần tạo đầu). Điền missingInputs bằng tiếng Anh, không tên người. Tạo lại/reroll phải hỏi Yen. Giữ PNG gốc, request, job ID ở tmp/pixellab/<draftId>/ (ngoài src/FE/public). '
        + 'Request item-inpaint: asset_process inpaint_prep trên nền 512 của cảnh -> PixelLab -> inpaint_merge; không bao giờ dán ảnh vật lên cảnh.'
      : 'Kế hoạch 0 lượt PixelLab: lấy ảnh thư viện/biến thể rồi asset_upload từng ô.',
  };
}
