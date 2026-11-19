/**
 * music_search (VUAN-5): finds area music in the game's library index (src/FE/public/assets/audio/music/index.json,
 * built by tools/music-gen/build_library.py) by world, area and mood. Each result carries a `music` object ready for
 * scenes[].atmosphere.audio.music of a case (docs/case-audio-weather.md), plus the licence summary for the report.
 * Nothing here talks to the server.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { StudioError } from '../bridge-client.js';
import { readJsonFile } from '../files.js';
import { fold } from '../library/index-store.js';
import type { ToolContext } from './context.js';

type Json = Record<string, any>;

export interface MusicSearchArgs {
  /** HANG_DUONG_VICTORIAN | TAISHO_JAPAN | SHANGHAI_1930 | ALL, or the folder name (hang-duong, taisho, thuong-hai, chung). */
  world?: string;
  /** Area id (street, harbor, tea_house...), its Vietnamese name (bến cảng), a picture library key (j-map-pho-den-long) or tag (ben-cang). */
  area?: string;
  /** Mood slug (bi-an, cang-thang...) or its Vietnamese name (bí ẩn). */
  mood?: string;
  /** Free words matched against title, author, Vietnamese label, areas and moods (accents optional). */
  query?: string;
  limit?: number;
}

export function musicIndexFile(ctx: ToolContext): string {
  return path.join(ctx.config.repoRoot, 'src', 'FE', 'public', 'assets', 'audio', 'music', 'index.json');
}

function loadIndex(ctx: ToolContext): Json {
  const file = musicIndexFile(ctx);
  if (!existsSync(file)) throw new StudioError('FILE_NOT_FOUND', 'Chưa có thư viện nhạc: thiếu src/FE/public/assets/audio/music/index.json (tools/music-gen/build_library.py).');
  return readJsonFile<Json>(file);
}

function resolveWorld(index: Json, value?: string): string | undefined {
  if (!value) return undefined;
  const wanted = fold(value.trim());
  for (const [code, world] of Object.entries<Json>(index.worlds)) {
    if (fold(code) === wanted || fold(world.folder) === wanted || fold(world.nameVi ?? '').startsWith(wanted)) return code;
  }
  throw new StudioError('BAD_ARGS', `Thế giới lạ: ${value}. Dùng ${Object.keys(index.worlds).join(', ')}.`);
}

/** Areas (per world) an area word stands for: the id itself, its Vietnamese name, or a picture library key/tag. */
function resolveArea(index: Json, value: string, world?: string): Array<{ world: string; area: string }> {
  const wanted = fold(value.trim()).replace(/\s+/g, ' ');
  const found: Array<{ world: string; area: string }> = [];
  for (const [code, info] of Object.entries<Json>(index.worlds)) {
    if (world && code !== world) continue;
    for (const [area, meta] of Object.entries<Json>(info.areas ?? {})) {
      const names = [area, meta.vi ?? '', ...(meta.libraryKeys ?? []), ...(meta.libraryTags ?? [])].map((name: string) => fold(name));
      if (names.includes(wanted) || fold(area).replace(/_/g, ' ') === wanted) found.push({ world: code, area });
    }
  }
  if (!found.length) {
    const known = Object.entries<Json>(index.worlds).filter(([code]) => !world || code === world)
      .flatMap(([, info]) => Object.keys(info.areas ?? {}));
    throw new StudioError('BAD_ARGS', `Khu lạ: ${value}. Khu có nhạc: ${[...new Set(known)].join(', ')} (hoặc key/nhãn thư viện hình).`);
  }
  return found;
}

function resolveMood(index: Json, value?: string): string | undefined {
  if (!value) return undefined;
  const wanted = fold(value.trim());
  for (const [slug, name] of Object.entries<string>(index.moods)) {
    if (fold(slug) === wanted || fold(name) === wanted) return slug;
  }
  throw new StudioError('BAD_ARGS', `Mood lạ: ${value}. Dùng ${Object.keys(index.moods).join(', ')}.`);
}

function result(index: Json, track: Json, match: string) {
  const licence = index.licenses?.[track.license] ?? {};
  return {
    id: track.id, title: track.title, labelVi: track.labelVi, author: track.author,
    world: track.world, areas: track.areas, moods: track.moods, bpm: track.bpm, durationSec: track.durationSec,
    url: track.file, fallbackUrl: track.fallback,
    source: track.source, sourceUrl: track.sourceUrl, license: track.license, licenseUrl: track.licenseUrl ?? null,
    licenseSummary: licence.summaryVi ?? '',
    match,
    /** Paste into scenes[].atmosphere.audio.music. */
    music: {
      url: track.file, fallbackUrl: track.fallback, title: track.title, source: track.source, license: track.license,
      loopStartSec: track.loopStartSec, loopEndSec: track.loopEndSec, volume: track.volume ?? 0.55,
    },
  };
}

/** The atmosphere.audio.music object of one library song, by id (weather_preview musicId). */
export function libraryMusic(ctx: ToolContext, id: string) {
  const index = loadIndex(ctx);
  const track = (index.tracks ?? []).find((candidate: Json) => candidate.id === id);
  if (!track) throw new StudioError('NOT_FOUND', `Không có bài ${id} trong thư viện nhạc (music_search để xem id).`);
  return result(index, track, 'id').music;
}

export function musicSearch(ctx: ToolContext, args: MusicSearchArgs) {
  const index = loadIndex(ctx);
  const tracks: Json[] = index.tracks ?? [];
  const world = resolveWorld(index, args.world);
  const mood = resolveMood(index, args.mood);
  const areas = args.area ? resolveArea(index, args.area, world) : [];
  const words = fold(args.query ?? '').split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(100, args.limit ?? 10));

  const textOk = (track: Json) => {
    if (!words.length) return true;
    const moodNames = (track.moods ?? []).map((slug: string) => index.moods?.[slug] ?? slug);
    const haystack = fold([track.id, track.title, track.author, track.labelVi, ...(track.areas ?? []), ...(track.moods ?? []), ...moodNames].join(' '));
    return words.every((word) => haystack.includes(word));
  };
  const moodOk = (track: Json) => !mood || (track.moods ?? []).includes(mood);
  const worldOk = (track: Json) => !world || track.world === world || track.world === 'ALL';

  const picked = new Map<string, ReturnType<typeof result>>();
  const take = (track: Json, match: string) => { if (!picked.has(track.id)) picked.set(track.id, result(index, track, match)); };
  if (areas.length) {
    // Songs written for the area first (mood first among them), then shared songs of the mood as a second choice.
    const forArea = tracks.filter((track) => areas.some((entry) => entry.world === track.world && (track.areas ?? []).includes(entry.area)) && textOk(track));
    forArea.filter(moodOk).forEach((track) => take(track, mood ? 'area+mood' : 'area'));
    forArea.forEach((track) => take(track, 'area'));
    if (mood) tracks.filter((track) => track.world === 'ALL' && moodOk(track) && textOk(track)).forEach((track) => take(track, 'mood'));
  } else {
    const pool = tracks.filter((track) => worldOk(track) && moodOk(track) && textOk(track));
    // A world's own songs before the shared ones.
    [...pool.filter((track) => track.world !== 'ALL'), ...pool.filter((track) => track.world === 'ALL')]
      .forEach((track) => take(track, mood ? 'mood' : words.length ? 'query' : 'world'));
  }
  const results = [...picked.values()];
  return {
    total: results.length,
    results: results.slice(0, limit),
    areasMatched: areas,
    note: 'Ghi results[i].music vào scenes[].atmosphere.audio.music (mỗi khu một bài; hai khu cạnh nhau cùng bài thì game phát tiếp). '
      + 'Bài Pixabay có thể bị YouTube/TikTok nhận nhầm bản quyền: giữ sourceUrl trong report. Không có bài hợp: viết bài 8-bit bằng tools/music-gen.',
  };
}
