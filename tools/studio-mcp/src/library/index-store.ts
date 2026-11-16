/**
 * The committed library index (tools/studio-mcp/library/index.json). Server fields mirror AssetLibraryEntry; the
 * `local` block (processed files under tmp/, origin of the PixelLab file, hashes) never goes to the server.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type LibraryKind = 'OUTDOOR_MAP' | 'INTERIOR' | 'NPC' | 'ITEM' | 'PROP';
export const WORLDS = ['HANG_DUONG_VICTORIAN', 'TAISHO_JAPAN', 'SHANGHAI_1930', 'NEW_WORLD', 'ALL'] as const;
export const KINDS: LibraryKind[] = ['OUTDOOR_MAP', 'INTERIOR', 'NPC', 'ITEM', 'PROP'];

export interface LocalInfo {
  /** Processed files by role, repo-relative (tmp/library-build/<key>/...). Not committed files, only paths. */
  files?: Record<string, string>;
  /** sha256 of each processed file, to know whether the server copy is current. */
  sha256?: Record<string, string>;
  /** sha256 of each file at the moment it was uploaded. */
  uploadedSha256?: Record<string, string>;
  /** Where the original came from (repo-relative). */
  origin?: string;
  styleRef?: string;
  idleSource?: 'pixellab-idle' | 'code-breathing';
  /** Walkable grid etc. for maps and rooms, when known. */
  walk?: unknown;
  notes?: string[];
}

export interface LibraryItem {
  key: string;
  kind: LibraryKind;
  world: string;
  tags: string[];
  nameVi: string;
  nameEn: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  parentKey: string;
  variant: string;
  source: 'PIXELLAB' | 'VARIANT';
  pixelLabJobId: string;
  firstUsedByCaseId: string;
  prompt: string;
  files: Record<string, string>;
  retired: boolean;
  local?: LocalInfo;
}

export interface LibraryIndex {
  version: 1;
  description: string;
  items: LibraryItem[];
}

export function emptyItem(key: string, kind: LibraryKind, world: string): LibraryItem {
  return {
    key, kind, world, tags: [], nameVi: '', nameEn: '', url: '', thumbUrl: '', width: 0, height: 0, parentKey: '', variant: '',
    source: 'PIXELLAB', pixelLabJobId: '', firstUsedByCaseId: '', prompt: '', files: {}, retired: false,
  };
}

export function loadIndex(file: string): LibraryIndex {
  if (!existsSync(file)) {
    return { version: 1, description: 'Thu vien hinh dung chung cua xuong vu an (xem docs/studio-vps.md).', items: [] };
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as LibraryIndex;
  parsed.items = (parsed.items ?? []).map((item) => ({ ...emptyItem(item.key, item.kind, item.world), ...item }));
  return parsed;
}

/** Sorted by key, two-space JSON, LF: stable diffs in git. */
export function saveIndex(file: string, index: LibraryIndex): void {
  index.items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

export function upsertItem(index: LibraryIndex, item: LibraryItem): LibraryItem {
  const at = index.items.findIndex((entry) => entry.key === item.key);
  if (at >= 0) {
    index.items[at] = { ...index.items[at], ...item, local: { ...index.items[at].local, ...item.local } };
    return index.items[at];
  }
  index.items.push(item);
  return item;
}

/** Lowercase, no Vietnamese accents: "Bến cảng" matches "ben cang". */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export interface SearchQuery {
  world?: string;
  kind?: string;
  tags?: string[];
  query?: string;
  includeRetired?: boolean;
  parentKey?: string;
  limit?: number;
}

export function search(items: LibraryItem[], q: SearchQuery): LibraryItem[] {
  const world = q.world?.trim().toUpperCase();
  const kind = q.kind?.trim().toUpperCase();
  const tags = (q.tags ?? []).map((tag) => fold(tag.trim())).filter(Boolean);
  const words = fold(q.query ?? '').split(/[\s,]+/).filter(Boolean);
  const results = items.filter((item) => {
    if (item.retired && !q.includeRetired) return false;
    if (world && world !== 'ALL' && item.world !== world && item.world !== 'ALL') return false;
    if (world === 'ALL' && item.world !== 'ALL') return false;
    if (kind && item.kind !== kind) return false;
    if (q.parentKey && item.parentKey !== q.parentKey) return false;
    const itemTags = item.tags.map(fold);
    if (tags.some((tag) => !itemTags.includes(tag))) return false;
    if (words.length) {
      const haystack = fold([item.key, item.nameVi, item.nameEn, item.prompt, item.variant, ...item.tags].join(' '));
      if (words.some((word) => !haystack.includes(word))) return false;
    }
    return true;
  });
  // Exact world first, then shared items; within that by key.
  results.sort((a, b) => Number(a.world === 'ALL') - Number(b.world === 'ALL') || (a.key < b.key ? -1 : 1));
  return results.slice(0, Math.max(1, Math.min(500, q.limit ?? 20)));
}

/** The server's AssetLibraryEntry fields only. */
export function toServerEntry(item: LibraryItem): Record<string, unknown> {
  return {
    key: item.key, kind: item.kind, world: item.world, tags: item.tags, nameVi: item.nameVi, nameEn: item.nameEn,
    url: item.url, thumbUrl: item.thumbUrl, width: item.width, height: item.height, parentKey: item.parentKey,
    variant: item.variant, source: item.source, pixelLabJobId: item.pixelLabJobId, firstUsedByCaseId: item.firstUsedByCaseId,
    prompt: item.prompt, files: item.files, retired: item.retired,
  };
}

/** Merges what the server has into the local index: server URLs and flags win, local-only data stays. */
export function mergeFromServer(index: LibraryIndex, entries: any[]): { added: number; updated: number } {
  let added = 0, updated = 0;
  for (const entry of entries) {
    if (!entry?.key) continue;
    const existing = index.items.find((item) => item.key === entry.key);
    const fromServer: Partial<LibraryItem> = {
      kind: entry.kind, world: entry.world, tags: entry.tags ?? [], nameVi: entry.nameVi ?? '', nameEn: entry.nameEn ?? '',
      url: entry.url ?? '', thumbUrl: entry.thumbUrl ?? '', width: entry.width ?? 0, height: entry.height ?? 0,
      parentKey: entry.parentKey ?? '', variant: entry.variant ?? '', source: entry.source ?? 'PIXELLAB',
      pixelLabJobId: entry.pixelLabJobId ?? '', firstUsedByCaseId: entry.firstUsedByCaseId ?? '', prompt: entry.prompt ?? '',
      files: entry.files ?? {}, retired: Boolean(entry.retired),
    };
    if (existing) {
      const before = JSON.stringify(toServerEntry(existing));
      Object.assign(existing, fromServer);
      if (JSON.stringify(toServerEntry(existing)) !== before) updated++;
    } else {
      index.items.push({ ...emptyItem(entry.key, entry.kind, entry.world), ...fromServer } as LibraryItem);
      added++;
    }
  }
  return { added, updated };
}
