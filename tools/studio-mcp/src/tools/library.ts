/** library_search and library_sync: the local index (git) and the server's assetLibrary (Cloudinary URLs). */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StudioError } from '../bridge-client.js';
import { display, tmpDir } from '../files.js';
import {
  loadIndex, mergeFromServer, saveIndex, search, toServerEntry, type LibraryIndex, type LibraryItem,
} from '../library/index-store.js';
import type { ToolContext } from './context.js';

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function extensionOf(url: string, contentType: string): string {
  const fromUrl = path.extname(new URL(url, 'https://x.invalid').pathname).toLowerCase();
  if (['.png', '.webp', '.jpg', '.jpeg'].includes(fromUrl)) return fromUrl;
  return contentType.includes('webp') ? '.webp' : '.png';
}

/** Copies (local build) or downloads (server URL) every file of an item into tmp/library-cache/<key>/. */
async function cacheItem(ctx: ToolContext, item: LibraryItem): Promise<Record<string, string>> {
  const dir = tmpDir(ctx.config, 'library-cache', item.key);
  const out: Record<string, string> = {};
  const roles: Record<string, string> = { main: item.url, ...item.files };
  for (const [role, url] of Object.entries(roles)) {
    const local = item.local?.files?.[role];
    if (local && existsSync(path.resolve(ctx.config.repoRoot, local))) {
      const target = path.join(dir, `${role}${path.extname(local)}`);
      copyFileSync(path.resolve(ctx.config.repoRoot, local), target);
      out[role] = display(ctx.config, target);
      continue;
    }
    if (url?.startsWith('/assets/') && existsSync(path.join(ctx.config.repoRoot, 'src', 'FE', 'public', url))) {
      // Pictures that ship with the game (the two pixel cases): read them from the repo.
      const source = path.join(ctx.config.repoRoot, 'src', 'FE', 'public', url);
      const target = path.join(dir, `${role}${path.extname(source)}`);
      copyFileSync(source, target);
      out[role] = display(ctx.config, target);
      continue;
    }
    if (!url) continue;
    const { bytes, contentType } = await ctx.client.download(url);
    const target = path.join(dir, `${role}${extensionOf(url, contentType)}`);
    writeFileSync(target, bytes);
    out[role] = display(ctx.config, target);
  }
  return out;
}

export async function librarySearch(ctx: ToolContext, args: {
  world?: string; kind?: string; tags?: string[]; query?: string; includeRetired?: boolean; parentKey?: string;
  limit?: number; download?: boolean; fromServer?: boolean;
}) {
  const index = loadIndex(ctx.config.libraryIndexPath);
  let items = index.items;
  let serverNote = 'chỉ index local (tools/studio-mcp/library/index.json)';
  if (args.fromServer) {
    const { data } = await ctx.client.call<any[]>('GET', '/api/bridge/library', { query: { includeRetired: true } });
    const merged: LibraryIndex = { ...index, items: index.items.map((item) => ({ ...item })) };
    mergeFromServer(merged, data ?? []);
    items = merged.items;
    serverNote = `index local + ${data?.length ?? 0} mục trên server`;
  }
  const found = search(items, args);
  const results = [];
  for (const item of found) {
    const row: Record<string, unknown> = {
      key: item.key, kind: item.kind, world: item.world, nameVi: item.nameVi, nameEn: item.nameEn, tags: item.tags,
      size: item.width ? `${item.width}x${item.height}` : undefined, url: item.url || undefined, thumbUrl: item.thumbUrl || undefined,
      roles: Object.keys(item.files ?? {}), parentKey: item.parentKey || undefined, variant: item.variant || undefined,
      source: item.source, retired: item.retired || undefined, uploaded: Boolean(item.url),
      idle: item.local?.idleSource, localFiles: item.local?.files,
    };
    if (args.download) row.cached = await cacheItem(ctx, item);
    results.push(row);
  }
  return {
    count: results.length, searched: serverNote, results,
    hint: args.download ? 'Ảnh đã chép/tải vào tmp/library-cache/<key>/.' : 'Cần file thì gọi lại với download: true.',
  };
}

/** Uploads every processed file of an item that the server does not have yet; returns the role -> URL map. */
async function uploadItemFiles(ctx: ToolContext, item: LibraryItem): Promise<{ uploaded: number; skipped: number }> {
  const local = item.local?.files ?? {};
  let uploaded = 0, skipped = 0;
  item.local = item.local ?? {};
  item.local.uploadedSha256 = item.local.uploadedSha256 ?? {};
  for (const [role, relative] of Object.entries(local)) {
    const file = path.resolve(ctx.config.repoRoot, relative);
    if (!existsSync(file)) { skipped++; continue; }
    const hash = sha256(file);
    const current = role === 'main' ? item.url : item.files[role];
    const remoteOk = current && (current.startsWith('https://') || isShippedAsset(ctx, current));
    if (remoteOk && item.local.uploadedSha256[role] === hash) { skipped++; continue; }
    const form = new FormData();
    form.append('key', item.key);
    form.append('role', role);
    const type = file.endsWith('.webp') ? 'image/webp' : 'image/png';
    form.append('file', new Blob([new Uint8Array(readFileSync(file))], { type }), path.basename(file));
    const { data } = await ctx.client.call<any>('POST', '/api/bridge/library/files', { form });
    if (role === 'main') item.url = data.url;
    else item.files[role] = data.url;
    if (role === 'thumb') item.thumbUrl = data.url;
    item.local.uploadedSha256[role] = hash;
    uploaded++;
  }
  if (item.files.thumb && !item.thumbUrl) item.thumbUrl = item.files.thumb;
  // NPC: main is the 288x288 portrait (also the thumbnail); items are their own thumbnail.
  if (item.kind === 'NPC' && item.url) {
    item.files.portrait = item.url;
    item.thumbUrl = item.url;
  }
  if ((item.kind === 'ITEM' || item.kind === 'PROP') && item.url) item.thumbUrl = item.url;
  return { uploaded, skipped };
}

function isShippedAsset(ctx: ToolContext, url: string): boolean {
  return url.startsWith('/assets/pixel/') && existsSync(path.join(ctx.config.repoRoot, 'src', 'FE', 'public', url));
}

export async function librarySync(ctx: ToolContext, args: { direction?: 'pull' | 'push' | 'both'; keys?: string[]; dryRun?: boolean }) {
  const direction = args.direction ?? 'both';
  const index = loadIndex(ctx.config.libraryIndexPath);
  const report: Record<string, unknown> = { api: ctx.client.apiBase, direction, dryRun: Boolean(args.dryRun) };
  if (direction === 'push' || direction === 'both') {
    const { data: ping } = await ctx.client.call<any>('GET', '/api/bridge/ping');
    const targets = index.items.filter((item) => !args.keys?.length || args.keys.includes(item.key));
    const needsUpload = targets.filter((item) => Object.keys(item.local?.files ?? {}).length > 0);
    if (ping?.assetStorage === false && needsUpload.some((item) => !item.url)) {
      throw new StudioError('ASSET_STORAGE_UNAVAILABLE',
        'Server chưa có nơi lưu ảnh (Cloudinary tắt) nên chưa đẩy được thư viện. Yen chạy bash scripts/set-cloudinary.sh rồi chạy lại library_sync.');
    }
    let uploaded = 0, skipped = 0, failed: string[] = [];
    if (!args.dryRun) {
      for (const item of needsUpload) {
        try {
          const result = await uploadItemFiles(ctx, item);
          uploaded += result.uploaded;
          skipped += result.skipped;
        } catch (error) {
          failed.push(`${item.key}: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Save as we go: a long upload interrupted halfway keeps what reached the server.
        saveIndex(ctx.config.libraryIndexPath, index);
      }
    }
    const ready = targets.filter((item) => item.url);
    const missing = targets.filter((item) => !item.url).map((item) => item.key);
    let upsert = { received: 0, inserted: 0, updated: 0, unchanged: 0 };
    if (!args.dryRun) {
      for (let start = 0; start < ready.length; start += 200) {
        const { data } = await ctx.client.call<any>('PUT', '/api/bridge/library', { json: { items: ready.slice(start, start + 200).map(toServerEntry) } });
        upsert = {
          received: upsert.received + (data?.received ?? 0), inserted: upsert.inserted + (data?.inserted ?? 0),
          updated: upsert.updated + (data?.updated ?? 0), unchanged: upsert.unchanged + (data?.unchanged ?? 0),
        };
      }
    }
    report.push = {
      itemsConsidered: targets.length, filesUploaded: uploaded, filesAlreadyCurrent: skipped, entriesSent: args.dryRun ? 0 : ready.length,
      wouldSend: ready.length, upsert, notUploadedYet: missing.slice(0, 30), missingCount: missing.length, failed: failed.slice(0, 20),
    };
  }
  if (direction === 'pull' || direction === 'both') {
    const { data } = await ctx.client.call<any[]>('GET', '/api/bridge/library', { query: { includeRetired: true } });
    const merged = args.dryRun ? { added: 0, updated: 0 } : mergeFromServer(index, data ?? []);
    report.pull = { serverItems: data?.length ?? 0, ...merged };
  }
  if (!args.dryRun) saveIndex(ctx.config.libraryIndexPath, index);
  const byWorld: Record<string, Record<string, number>> = {};
  for (const item of index.items.filter((entry) => !entry.retired)) {
    byWorld[item.world] = byWorld[item.world] ?? {};
    byWorld[item.world][item.kind] = (byWorld[item.world][item.kind] ?? 0) + 1;
  }
  report.index = { file: display(ctx.config, ctx.config.libraryIndexPath), items: index.items.length, retired: index.items.filter((item) => item.retired).length, byWorld };
  return report;
}
