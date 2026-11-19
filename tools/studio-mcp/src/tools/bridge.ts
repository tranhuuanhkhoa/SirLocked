/** bridge_list, bridge_take, bridge_check, bridge_submit, bridge_release. Big data goes to tmp/bridge/<requestId>/. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { StudioError } from '../bridge-client.js';
import { bridgeDir, display, readJsonFile, requireFile, safeId, writeJsonFile, writeTextFile } from '../files.js';
import { checkAgainstSchema } from '../schema-check.js';
import { clip, type ToolContext } from './context.js';

export async function bridgeList(ctx: ToolContext, args: { status?: string; draftId?: string; limit?: number }) {
  const status = (args.status ?? 'PENDING').toUpperCase();
  const { data } = await ctx.client.call<any[]>('GET', '/api/bridge/requests', { query: { status, limit: args.limit ?? 100 } });
  const rows = (data ?? []).filter((row) => !args.draftId || row.draftId === args.draftId);
  return {
    api: ctx.client.apiBase,
    status,
    count: rows.length,
    requests: rows.map((row) => ({
      requestId: row.requestId, kind: row.kind, step: row.step, ownerType: row.ownerType, draftId: row.draftId, caseId: row.caseId,
      attempt: row.attemptNumber, preset: row.preset, language: row.language, world: row.world, reviewMode: row.reviewMode,
      orderedByRole: row.orderedByRole, promptKB: Math.round((row.promptBytes ?? 0) / 1024), assetPhase: row.assetPhase || undefined,
      assetSlots: row.assetSlotIds?.length || undefined, createdAt: row.createdAt, leaseExpiresAt: row.leaseExpiresAt || undefined,
      lastErrors: row.errors?.length ? row.errors.slice(0, 3) : undefined,
    })),
    hint: rows.length ? 'Nhận một yêu cầu bằng bridge_take { requestId }.' : 'Không có yêu cầu nào đang chờ.',
  };
}

export async function bridgeTake(ctx: ToolContext, args: { requestId: string }) {
  const requestId = safeId(args.requestId, 'requestId');
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/requests/${requestId}/take`);
  const dir = bridgeDir(ctx.config, requestId);
  const promptFile = path.join(dir, 'prompt.md');
  const schemaFile = path.join(dir, 'schema.json');
  const orderFile = path.join(dir, 'order.json');
  const instructionsFile = path.join(dir, 'instructions.md');
  const answerFile = path.join(dir, 'answer.json');
  const decisionsFile = path.join(dir, 'decisions.json');
  const decisions: { key: string; chosen?: string }[] = data.decisions ?? [];
  writeJsonFile(decisionsFile, decisions);
  writeTextFile(promptFile, String(data.prompt ?? ''));
  writeJsonFile(schemaFile, data.schema ?? {});
  writeJsonFile(orderFile, {
    requestId: data.requestId, kind: data.kind, ownerType: data.ownerType, draftId: data.draftId, caseId: data.caseId,
    step: data.step, schemaVersion: data.schemaVersion, attempt: data.attemptNumber, lengthHintTokens: data.lengthHintTokens,
    assetPhase: data.assetPhase, assetSlotIds: data.assetSlotIds, assetRegenerateSlotIds: data.assetRegenerateSlotIds,
    leaseExpiresAt: data.leaseExpiresAt, previousErrors: data.previousErrors ?? [], order: data.order ?? null,
  });
  const previous: string[] = data.previousErrors ?? [];
  writeTextFile(instructionsFile, [
    `# Yêu cầu ${data.requestId} — bước ${data.step} (${data.kind})`,
    '',
    `- Draft: ${data.draftId ?? '-'} · case: ${data.caseId ?? '-'} · lần thử ${data.attemptNumber}`,
    `- Giữ yêu cầu tới: ${data.leaseExpiresAt} (hết hạn thì người khác nhận được; làm xong thì nộp, bỏ dở thì bridge_release).`,
    data.kind === 'ASSETS'
      ? '- Đây là yêu cầu HÌNH: không nộp JSON. Xem assets_needed, tải từng ô bằng asset_upload rồi gọi assets_complete.'
      : `- Viết câu trả lời (MỘT object JSON, đúng schema.json) vào: ${display(ctx.config, answerFile)}, rồi bridge_check rồi bridge_submit.`,
    data.lengthHintTokens ? `- Độ dài gợi ý: khoảng ${data.lengthHintTokens} token.` : '',
    '',
    '## Chỉ dẫn hệ thống (instructions)',
    '',
    String(data.instructions ?? '(không có)'),
    previous.length ? '\n## Lỗi của lần nộp trước (sửa hết trước khi nộp lại)\n' : '',
    ...previous.map((line) => `- ${line}`),
    decisions.length ? '\n## Người đặt đơn đã chọn (làm theo các lựa chọn này)\n' : '',
    ...decisions.map((item) => `- ${item.key}: ${item.chosen ?? '?'}`),
  ].filter((line) => line !== '').join('\n'));
  const files: Record<string, string> = {
    prompt: display(ctx.config, promptFile), schema: display(ctx.config, schemaFile), order: display(ctx.config, orderFile),
    instructions: display(ctx.config, instructionsFile), answer: display(ctx.config, answerFile),
    decisions: display(ctx.config, decisionsFile),
  };
  if (data.devMockResponse) {
    // Development/Testing servers only (never Production): the server's own mock answer, for local runs.
    const mockFile = path.join(dir, 'dev-mock-answer.json');
    try { writeJsonFile(mockFile, JSON.parse(String(data.devMockResponse))); }
    catch { writeTextFile(mockFile, String(data.devMockResponse)); }
    files.devMockAnswer = display(ctx.config, mockFile);
  }
  return {
    requestId: data.requestId, kind: data.kind, step: data.step, draftId: data.draftId, caseId: data.caseId,
    attempt: data.attemptNumber, leaseExpiresAt: data.leaseExpiresAt, dir: display(ctx.config, dir), files,
    promptKB: Math.round(Buffer.byteLength(String(data.prompt ?? '')) / 1024),
    schemaKB: Math.round(Buffer.byteLength(JSON.stringify(data.schema ?? {})) / 1024),
    previousErrors: previous.length, assetSlots: data.assetSlotIds?.length || undefined,
    next: data.kind === 'ASSETS' ? 'assets_needed { draftId }' : `Đọc ${files.instructions} và ${files.prompt}, viết ${files.answer}, rồi bridge_check.`,
  };
}

function answerPath(ctx: ToolContext, requestId: string, file?: string): string {
  return file ? requireFile(ctx.config, file) : requireFile(ctx.config, path.join(bridgeDir(ctx.config, requestId), 'answer.json'));
}

export function bridgeCheck(ctx: ToolContext, args: { requestId?: string; file?: string; schemaFile?: string }) {
  if (!args.requestId && !args.schemaFile) throw new StudioError('BAD_ARGS', 'Cần requestId (đã bridge_take) hoặc schemaFile.');
  const requestId = args.requestId ? safeId(args.requestId, 'requestId') : '';
  const schemaFile = args.schemaFile
    ? requireFile(ctx.config, args.schemaFile)
    : path.join(bridgeDir(ctx.config, requestId), 'schema.json');
  if (!existsSync(schemaFile)) throw new StudioError('FILE_NOT_FOUND', `Chưa có schema.json cho ${requestId}: gọi bridge_take trước.`);
  if (!args.file && !requestId) throw new StudioError('BAD_ARGS', 'Cần file khi không có requestId.');
  const file = answerPath(ctx, requestId, args.file);
  const answer = readJsonFile(file);
  const result = checkAgainstSchema(readJsonFile(schemaFile), answer);
  return {
    file: display(ctx.config, file), valid: result.valid, errorCount: result.errorCount, errors: result.errors,
    next: result.valid ? 'bridge_submit { requestId }' : 'Sửa các lỗi trên trong file rồi bridge_check lại.',
  };
}

export async function bridgeSubmit(ctx: ToolContext, args: { requestId: string; file?: string; skipLocalCheck?: boolean }) {
  const requestId = safeId(args.requestId, 'requestId');
  const file = answerPath(ctx, requestId, args.file);
  const answer = readJsonFile(file);
  const schemaFile = path.join(bridgeDir(ctx.config, requestId), 'schema.json');
  if (!args.skipLocalCheck && existsSync(schemaFile)) {
    const local = checkAgainstSchema(readJsonFile(schemaFile), answer);
    if (!local.valid) {
      return {
        submitted: false, accepted: false, file: display(ctx.config, file), errorCount: local.errorCount, errors: local.errors,
        next: 'Kiểm trên máy chưa đạt nên CHƯA nộp. Sửa file rồi nộp lại.',
      };
    }
  }
  // Always wrapped, so an answer that itself has a single "json" property is never unwrapped by the server.
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/requests/${requestId}/submit`, { json: { json: answer } });
  writeJsonFile(path.join(bridgeDir(ctx.config, requestId), 'submit-result.json'), data);
  return {
    submitted: true, accepted: Boolean(data?.accepted), errorCount: data?.errors?.length ?? 0, errors: (data?.errors ?? []).slice(0, 40),
    next: data?.next ?? null,
    hint: data?.accepted ? 'Server đã nhận. Xem việc tiếp theo bằng draft_get hoặc bridge_list.' : 'Server từ chối theo schema: sửa rồi nộp lại (yêu cầu vẫn mở).',
  };
}

export async function bridgeRelease(ctx: ToolContext, args: { requestId: string }) {
  const requestId = safeId(args.requestId, 'requestId');
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/requests/${requestId}/release`);
  return { requestId, status: data?.status, message: 'Đã trả lại yêu cầu; người khác (hoặc lần sau) nhận lại được.' };
}

export interface AskOption { id: string; label: string; detail?: string; generations?: number }

/** draft_ask: puts a question with 2-4 options to the creator on /admin/ai; the request waits until they answer. */
export async function bridgeAsk(ctx: ToolContext, args: { requestId: string; key: string; question: string; options: AskOption[] }) {
  const requestId = safeId(args.requestId, 'requestId');
  if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 4) {
    throw new StudioError('BAD_ARGS', 'draft_ask cần 2–4 lựa chọn.');
  }
  const { data } = await ctx.client.call<any>('POST', `/api/bridge/requests/${requestId}/ask`, {
    json: {
      key: args.key,
      question: args.question,
      options: args.options.map((option) => ({ id: option.id, label: option.label, detail: option.detail ?? '', generations: option.generations })),
    },
  });
  return {
    requestId, decisionId: String(data?.decisionId ?? ''), status: String(data?.status ?? ''),
    next: 'Đã gửi câu hỏi lên trang /admin/ai. Dừng lượt chạy này; khi người đặt đơn chọn xong, bot được gọi lại và đọc decisions.json.',
  };
}

export { clip };
