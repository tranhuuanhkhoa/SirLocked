import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { StudioError } from '../bridge-client.js';
import { display, safeId, studioPath, tmpDir } from '../files.js';
import type { ToolContext } from './context.js';
import { PIXELLAB_BASE } from './pixellab.js';

const maxImageBytes = 5 * 1024 * 1024;
const images = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const textFiles = new Set(['.md', '.json', '.jsonl', '.txt']);

export async function readWorkspace(ctx: ToolContext, args: { file: string; offset?: number }) {
  const file = studioPath(ctx.config, args.file);
  const info = statSync(file, { throwIfNoEntry: false });
  if (!info?.isFile()) throw new StudioError('FILE_NOT_FOUND', 'Không thấy file trong vùng làm việc của studio.');
  if (info.size > maxImageBytes) throw new StudioError('FILE_TOO_LARGE', 'File lớn hơn 5 MB.');
  const name = display(ctx.config, file);
  const ext = path.extname(file).toLowerCase();
  if (images.has(ext)) {
    const image = sharp(file, { limitInputPixels: 16_000_000 });
    const { width, height } = await image.metadata();
    const preview = await image.resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return { content: [
      { type: 'text' as const, text: JSON.stringify({ file: name, width, height }) },
      { type: 'image' as const, data: preview.toString('base64'), mimeType: 'image/png' },
    ] };
  }
  if (!textFiles.has(ext)) throw new StudioError('BAD_PATH', 'Chỉ đọc tài liệu Markdown, JSON, văn bản và ảnh.');
  const body = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const offset = args.offset ?? 0;
  const text = body.slice(offset, offset + 14_000);
  return { content: [{ type: 'text' as const, text: JSON.stringify({
    file: name, offset, nextOffset: offset + text.length < body.length ? offset + text.length : null, text,
  }) }] };
}

export function writeWorkspace(ctx: ToolContext, args: { file: string; text: string; append?: boolean }) {
  const file = studioPath(ctx.config, args.file, true);
  const relative = path.relative(ctx.config.tmpRoot, file).split(path.sep).join('/');
  if (!/^(?:bridge\/[a-z0-9_-]+\/(?:answer\.json|report\.md)|pixellab\/[a-z0-9_-]+\/receipts\.json)$/i.test(relative)) {
    throw new StudioError('BAD_PATH', 'Chỉ ghi answer.json, report.md hoặc receipts.json trong thư mục của yêu cầu.');
  }
  const current = args.append ? statSync(file, { throwIfNoEntry: false }) : undefined;
  if ((current?.size ?? 0) + Buffer.byteLength(args.text) > maxImageBytes) {
    throw new StudioError('FILE_TOO_LARGE', 'File lớn hơn 5 MB.');
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, args.text, { encoding: 'utf8', flag: args.append ? 'a' : 'w' });
  return { file: display(ctx.config, file), bytes: (current?.size ?? 0) + Buffer.byteLength(args.text) };
}

export async function pixelLabImageDownload(ctx: ToolContext, args: { draftId: string; jobId: string; index?: number }) {
  const draftId = safeId(args.draftId, 'draftId');
  const jobId = safeId(args.jobId, 'jobId');
  const index = args.index ?? 0;
  const url = `${PIXELLAB_BASE}/mcp/images/${jobId}/download?index=${index}`;
  const result = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(ctx.config.httpTimeoutMs) });
  if (!result.ok) throw new StudioError('DOWNLOAD_FAILED', `PixelLab tải ảnh trả HTTP ${result.status}.`);
  const bytes = Buffer.from(await result.arrayBuffer());
  if (bytes.length > maxImageBytes) throw new StudioError('FILE_TOO_LARGE', 'Ảnh lớn hơn 5 MB.');
  const image = sharp(bytes, { limitInputPixels: 16_000_000 });
  const { width, height } = await image.metadata();
  const file = studioPath(ctx.config, path.join(tmpDir(ctx.config, 'pixellab', draftId), `${jobId}-${index}.png`), true);
  await image.png().toFile(file);
  return { file: display(ctx.config, file), url, width, height };
}

export async function pixelLabImageUpload(ctx: ToolContext, args: { file: string; url: string }) {
  const url = new URL(args.url);
  if (url.origin !== PIXELLAB_BASE || url.username || url.password || !/^\/v2\/uploads(?:\/|$)/.test(url.pathname)) {
    throw new StudioError('URL_NOT_ALLOWED', 'Cần URL từ công cụ PixelLab get_upload_url.');
  }
  const file = studioPath(ctx.config, args.file, true);
  if (!images.has(path.extname(file).toLowerCase())) throw new StudioError('BAD_PATH', 'Chỉ tải ảnh trong tmp/.');
  const info = statSync(file, { throwIfNoEntry: false });
  if (!info?.isFile() || info.size > maxImageBytes) throw new StudioError('BAD_PATH', 'Cần file ảnh không quá 5 MB.');
  const png = await sharp(file, { limitInputPixels: 16_000_000 }).png().toBuffer();
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'studio.png');
  const result = await fetch(url, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(ctx.config.httpTimeoutMs) });
  if (!result.ok) throw new StudioError('UPLOAD_FAILED', `PixelLab tải ảnh lên trả HTTP ${result.status}.`);
  const { ref } = await result.json() as { ref?: string };
  if (!ref?.startsWith('upload:')) throw new StudioError('UPLOAD_FAILED', 'PixelLab không trả mã upload.');
  return { ref };
}
