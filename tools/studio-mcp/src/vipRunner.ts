import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ToolContext } from './tools/context.js';
import { assetUpload, assetsComplete } from './tools/draft.js';
import { assetVariant } from './tools/assets.js';

/**
 * VUAN-7: the image runner of paid VIP orders, on the studio VPS. No AI: the server already chose every picture with
 * one Claude API call (library, variant or PixelLab, within the order's cap). The runner takes only VIP-lane image
 * requests (lane=VIP_RUNNER, never the ADMIN bot's), copies library pictures into their slots, makes variants with the
 * studio's code (asset_variant), uploads them and reports the request complete. PixelLab requests are not run here:
 * such a request is released and reported (the server keeps PixelLab off for VIP orders until it is set on).
 * Keys on the VPS: SIRLOCKED_BRIDGE_KEY (bridge) only.
 */

export const VIP_LANE = 'VIP_RUNNER';

export interface RunnerLog {
  info(message: string): void;
  warn(message: string): void;
}

export interface RunnerResult {
  completed: string[];
  released: { draftId: string; reason: string }[];
  uploaded: number;
}

interface Slot { slotId: string; width?: number; height?: number; transparent?: boolean; requestedNow?: boolean }
interface Subject { subject: string; slots: string[]; source: string; libraryKey?: string; parentKey?: string; variant?: string }
interface LibraryEntry { key: string; url?: string; files?: Record<string, string>; retired?: boolean }

/** The library file a slot takes: scene and item pictures are the entry itself; NPCs have an idle sheet and a portrait. */
export function libraryUrlFor(slotId: string, entry: LibraryEntry): string | undefined {
  if (slotId.startsWith('character-sprite:')) return entry.files?.idle ?? entry.files?.sprite;
  if (slotId.startsWith('character-portrait:')) return entry.files?.portrait;
  return entry.url;
}

export async function runOnce(
  ctx: ToolContext,
  log: RunnerLog,
  download: (url: string) => Promise<Uint8Array> = defaultDownload,
): Promise<RunnerResult> {
  const result: RunnerResult = { completed: [], released: [], uploaded: 0 };
  const { data: requests } = await ctx.client.call<any[]>('GET', `/api/bridge/requests?status=PENDING&lane=${VIP_LANE}&limit=20`);
  for (const request of requests ?? []) {
    if (request.kind !== 'ASSETS' || !request.draftId) continue;
    const draftId: string = request.draftId;
    await ctx.client.call('POST', `/api/bridge/requests/${encodeURIComponent(request.requestId)}/take?lane=${VIP_LANE}`);
    try {
      const { data: needed } = await ctx.client.call<any>('GET', `/api/bridge/drafts/${encodeURIComponent(draftId)}/assets-needed`);
      const subjects: Subject[] = needed?.pixel?.subjects ?? [];
      const slots: Slot[] = (needed?.slots ?? []).filter((slot: Slot) => slot.requestedNow);
      const { data: library } = await ctx.client.call<LibraryEntry[]>('GET', '/api/bridge/library?includeRetired=false');
      const byKey = new Map((library ?? []).map((entry) => [entry.key, entry]));
      const pixelLab = slots.filter((slot) => (subjects.find((subject) => subject.slots.includes(slot.slotId))?.source ?? 'PIXELLAB') === 'PIXELLAB');
      if (pixelLab.length > 0) {
        await release(ctx, request.requestId);
        const reason = `needs PixelLab for ${pixelLab.map((slot) => slot.slotId).join(', ')}`;
        result.released.push({ draftId, reason });
        log.warn(`Draft ${draftId}: ${reason}; released.`);
        continue;
      }
      const dir = path.join(ctx.config.repoRoot, 'tmp', 'vip-runner', draftId);
      mkdirSync(dir, { recursive: true });
      for (const slot of slots) {
        const subject = subjects.find((item) => item.slots.includes(slot.slotId))!;
        const key = subject.source === 'VARIANT' ? subject.parentKey : subject.libraryKey;
        const entry = key ? byKey.get(key) : undefined;
        const url = entry ? libraryUrlFor(slot.slotId, entry) : undefined;
        if (!url) throw new Error(`${slot.slotId}: library picture '${key}' has no file for this slot.`);
        const safe = slot.slotId.replace(/[^a-z0-9-]+/gi, '_');
        let file = path.join(dir, `${safe}.png`);
        writeFileSync(file, await download(url));
        if (subject.source === 'VARIANT') {
          const made = await assetVariant(ctx, {
            type: subject.variant as any,
            input: file,
            output: path.join(dir, `${safe}-${subject.variant}.png`),
            saveToLibrary: false,
          });
          file = path.resolve(ctx.config.repoRoot, made.output);
        }
        await assetUpload(ctx, { draftId, slotId: slot.slotId, file, width: slot.width, height: slot.height, transparent: slot.transparent });
        result.uploaded++;
      }
      await assetsComplete(ctx, { draftId });
      result.completed.push(draftId);
      log.info(`Draft ${draftId}: ${slots.length} picture(s) uploaded, request complete.`);
    } catch (error) {
      await release(ctx, request.requestId).catch(() => undefined);
      const reason = error instanceof Error ? error.message : String(error);
      result.released.push({ draftId, reason });
      log.warn(`Draft ${draftId}: ${reason}; released.`);
    }
  }
  return result;
}

async function release(ctx: ToolContext, requestId: string) {
  await ctx.client.call('POST', `/api/bridge/requests/${encodeURIComponent(requestId)}/release`);
}

async function defaultDownload(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}
