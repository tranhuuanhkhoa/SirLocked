/** asset_process and asset_variant: local picture work, 0 PixelLab credits. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { StudioError } from '../bridge-client.js';
import { display, requireFile, resolveInput, tmpDir, writeJsonFile } from '../files.js';
import {
  checkSize, cleanText, cover, cutBackground, fit, idleSheet, inspect, maskFromShapes, npcFromZip, portrait, walkableFromMask,
  walkOverlay, type NpcSources, type WalkShape,
} from '../image/process.js';
import { loadRgba, resizeNearest, saveRgba, sideBySide, type Rgba } from '../image/raster.js';
import {
  afterRain, compose, dusk, mirror, night, recolor, snow, VARIANT_TYPES, type ComposeItem, type Rect, type VariantType,
} from '../image/variant.js';
import { emptyItem, loadIndex, saveIndex, upsertItem, type LibraryItem } from '../library/index-store.js';
import type { ToolContext } from './context.js';

export const PROCESS_OPS = [
  'inspect', 'cut_background', 'to_webp', 'check_size', 'clean_text', 'cover', 'idle_breathe', 'sprite_sheet', 'portrait',
  'npc_bundle', 'walkable', 'mask_from_shapes', 'fit',
] as const;
export type ProcessOp = (typeof PROCESS_OPS)[number];

function defaultOutput(ctx: ToolContext, input: string | undefined, suffix: string, ext: string): string {
  const base = input ? path.basename(input).replace(/\.[^.]+$/, '') : 'asset';
  return path.join(tmpDir(ctx.config, 'assets'), `${base}-${suffix}${ext}`);
}

/** A picture by path, or by library key (local build or cached download). */
async function loadPicture(ctx: ToolContext, ref: string): Promise<{ image: Rgba; file: string }> {
  const direct = resolveInput(ctx.config, ref);
  if (existsSync(direct)) return { image: await loadRgba(readFileSync(direct)), file: direct };
  const index = loadIndex(ctx.config.libraryIndexPath);
  const [key, role = 'main'] = ref.split('#');
  const item = index.items.find((entry) => entry.key === key);
  if (!item) throw new StudioError('FILE_NOT_FOUND', `Không thấy file hay mục thư viện "${ref}".`);
  const local = item.local?.files?.[role];
  if (local && existsSync(path.resolve(ctx.config.repoRoot, local))) {
    const file = path.resolve(ctx.config.repoRoot, local);
    return { image: await loadRgba(readFileSync(file)), file };
  }
  const url = role === 'main' ? item.url : item.files[role];
  if (!url) throw new StudioError('FILE_NOT_FOUND', `Mục "${key}" chưa có file "${role}" trên máy hay trên server.`);
  if (url.startsWith('/assets/') && existsSync(path.join(ctx.config.repoRoot, 'src', 'FE', 'public', url))) {
    const file = path.join(ctx.config.repoRoot, 'src', 'FE', 'public', url);
    return { image: await loadRgba(readFileSync(file)), file };
  }
  const { bytes } = await ctx.client.download(url);
  return { image: await loadRgba(bytes), file: url };
}

async function loadNpc(ctx: ToolContext, input: string): Promise<NpcSources> {
  const file = requireFile(ctx.config, input);
  if (file.toLowerCase().endsWith('.zip')) return npcFromZip(readFileSync(file));
  return { south: await loadRgba(readFileSync(file)), idle: [] };
}

const asRect = (value: any): Rect => {
  if (Array.isArray(value)) return { x0: value[0], y0: value[1], x1: value[2], y1: value[3] };
  return { x0: value.x0, y0: value.y0, x1: value.x1, y1: value.y1 };
};

export async function assetProcess(ctx: ToolContext, args: { op: ProcessOp; input?: string; inputs?: string[]; output?: string; params?: Record<string, any> }) {
  const p = args.params ?? {};
  switch (args.op) {
    case 'inspect': {
      const file = requireFile(ctx.config, args.input ?? '');
      return { file: display(ctx.config, file), ...(await inspect(readFileSync(file))) };
    }
    case 'check_size': {
      const file = requireFile(ctx.config, args.input ?? '');
      const info = await inspect(readFileSync(file));
      const problems = checkSize(info, { width: p.width, height: p.height, transparent: p.transparent, maxBytes: p.maxBytes ?? 5 * 1024 * 1024 });
      return { file: display(ctx.config, file), ok: problems.length === 0, problems, width: info.width, height: info.height, hasAlpha: info.hasAlpha, bytes: info.bytes };
    }
    case 'cut_background': {
      const { image } = await loadPicture(ctx, args.input ?? '');
      const result = cutBackground(image, { tolerance: p.tolerance, color: p.color });
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'nen-trong', '.png');
      await saveRgba(result.image, output);
      return { output: display(ctx.config, output), removedPixels: result.removed };
    }
    case 'to_webp': {
      const { image } = await loadPicture(ctx, args.input ?? '');
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'webp', '.webp');
      if (!output.toLowerCase().endsWith('.webp')) throw new StudioError('BAD_ARGS', 'output của to_webp phải là .webp');
      const bytes = await saveRgba(image, output);
      return { output: display(ctx.config, output), bytes, lossless: true };
    }
    case 'clean_text': {
      const { image } = await loadPicture(ctx, args.input ?? '');
      const rects: Rect[] = (p.rects ?? []).map(asRect);
      if (rects.length === 0) throw new StudioError('BAD_ARGS', 'clean_text cần params.rects: [[x0,y0,x1,y1], ...] (pixel của ảnh, Claude tự nhìn ảnh để chấm).');
      const result = cleanText(image, rects, { threshold: p.threshold, mode: p.mode });
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'sach-chu', '.png');
      await saveRgba(result.image, output);
      const compare = output.replace(/\.[^.]+$/, '-so-sanh.png');
      const zoom = (img: Rgba) => resizeNearest(img, img.width * 4, img.height * 4);
      await saveRgba(sideBySide(zoom(image), zoom(result.image)), compare);
      return { output: display(ctx.config, output), compare: display(ctx.config, compare), changedPixels: result.changed };
    }
    case 'cover': {
      const sceneRef = p.scene ?? args.input;
      if (!sceneRef) throw new StudioError('BAD_ARGS', 'cover cần params.scene (ảnh cảnh) và params.portraits[] (chân dung).');
      const scene = (await loadPicture(ctx, sceneRef)).image;
      const portraits: Rgba[] = [];
      for (const ref of p.portraits ?? args.inputs ?? []) portraits.push((await loadPicture(ctx, ref)).image);
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, sceneRef, 'bia', '.png');
      await saveRgba(cover(scene, portraits, { size: p.size }), output, { opaque: true });
      return { output: display(ctx.config, output), portraits: portraits.length, size: p.size ?? 512 };
    }
    case 'idle_breathe':
    case 'sprite_sheet': {
      const npc = await loadNpc(ctx, args.input ?? '');
      if (args.op === 'idle_breathe') npc.idle = [];
      const sheet = idleSheet(npc);
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'idle', '.png');
      await saveRgba(sheet.image, output);
      return { output: display(ctx.config, output), width: sheet.image.width, height: sheet.image.height, frames: 9, source: sheet.source, anchorY: sheet.anchorY, pixelLabCredits: 0 };
    }
    case 'portrait': {
      const npc = await loadNpc(ctx, args.input ?? '');
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'portrait', '.png');
      await saveRgba(portrait(npc.south, p.size ?? 288), output);
      return { output: display(ctx.config, output), width: p.size ?? 288, height: p.size ?? 288, scaling: 'nearest-neighbor' };
    }
    case 'npc_bundle': {
      const npc = await loadNpc(ctx, args.input ?? '');
      const dir = args.output ? resolveInput(ctx.config, args.output) : tmpDir(ctx.config, 'assets', path.basename(args.input ?? 'npc').replace(/\.[^.]+$/, ''));
      const ext = p.format === 'png' ? '.png' : '.webp';
      const sheet = idleSheet(npc);
      const files = {
        sprite: path.join(dir, `sprite${ext}`), idle: path.join(dir, `idle${ext}`), portrait: path.join(dir, `portrait${ext}`),
      };
      await saveRgba(npc.south, files.sprite);
      await saveRgba(sheet.image, files.idle);
      await saveRgba(portrait(npc.south), files.portrait);
      return {
        dir: display(ctx.config, dir), files: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, display(ctx.config, file)])),
        idleSource: sheet.source, anchorY: sheet.anchorY, sprite: `${npc.south.width}x${npc.south.height}`,
      };
    }
    case 'fit': {
      if (!p.width || !p.height) throw new StudioError('BAD_ARGS', 'fit cần params.width và params.height (kích thước ô hình).');
      const { image } = await loadPicture(ctx, args.input ?? '');
      const result = fit(image, p.width, p.height, { mode: p.mode, background: p.background });
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, `${p.width}x${p.height}`, '.png');
      await saveRgba(result.image, output);
      return { output: display(ctx.config, output), width: p.width, height: p.height, mode: p.mode ?? 'contain', scale: result.scale };
    }
    case 'mask_from_shapes': {
      const width = p.width ?? 512, height = p.height ?? 512;
      const mask = maskFromShapes(width, height, (p.walk ?? []) as WalkShape[], (p.block ?? []) as WalkShape[]);
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'mask', '.png');
      await saveRgba(mask, output, { opaque: true });
      return { output: display(ctx.config, output), width, height, next: 'asset_process { op: "walkable", input: <mask>, params: { picture: <ảnh cảnh> } }' };
    }
    case 'walkable': {
      const mask = (await loadPicture(ctx, args.input ?? '')).image;
      const result = walkableFromMask(mask, {
        nativeWidth: p.nativeWidth, nativeHeight: p.nativeHeight, pixelScale: p.pixelScale, cellSize: p.cellSize,
        threshold: p.threshold, invert: p.invert, channel: p.channel,
      });
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'walk', '.json');
      writeJsonFile(output, result);
      let overlay: string | undefined;
      if (p.picture) {
        const picture = (await loadPicture(ctx, p.picture)).image;
        const overlayFile = output.replace(/\.json$/, '-overlay.png');
        await saveRgba(walkOverlay(picture, result.walkGrid), overlayFile);
        overlay = display(ctx.config, overlayFile);
      }
      return {
        output: display(ctx.config, output), overlay, walkableArea: result.walkableArea, obstacles: result.navigationObstacles.length,
        walkableCells: result.walkableCells, grid: `${result.walkGrid.cols}x${result.walkGrid.rows} ô ${result.walkGrid.cellSize}`,
        hint: 'File JSON có walkGrid (đặt vào runtime.render.walkGrid), walkableArea và navigationObstacles (đặt vào runtime).',
      };
    }
    default:
      throw new StudioError('BAD_ARGS', `op phải là một trong: ${PROCESS_OPS.join(', ')}`);
  }
}

// ------------------------------------------------------------------------------------------------ asset_variant

export interface VariantArgs {
  type: VariantType;
  /** File path, or a library key (optionally key#role). */
  input: string;
  params?: Record<string, any>;
  /** Library key of the result (default <parentKey>-<type>). */
  key?: string;
  output?: string;
  saveToLibrary?: boolean;
  nameVi?: string;
  nameEn?: string;
  tags?: string[];
}

const lights = (value: any) => (value ?? []).map((light: any) => (Array.isArray(light) ? { x: light[0], y: light[1], r: light[2] } : light));
const rects = (value: any) => (value ?? []).map(asRect);

export async function assetVariant(ctx: ToolContext, args: VariantArgs) {
  if (!VARIANT_TYPES.includes(args.type)) throw new StudioError('BAD_ARGS', `type phải là một trong: ${VARIANT_TYPES.join(', ')}`);
  const p = args.params ?? {};
  const { image: source, file: sourceFile } = await loadPicture(ctx, args.input);
  const index = loadIndex(ctx.config.libraryIndexPath);
  const parent = index.items.find((item) => item.key === args.input.split('#')[0]);
  const parentKey = parent?.key ?? '';
  const key = (args.key ?? `${parentKey || path.basename(args.input).replace(/\.[^.]+$/, '')}-${args.type.replace('_', '-')}`)
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  let image: Rgba;
  const extra: Record<string, unknown> = {};
  switch (args.type) {
    case 'night':
      image = await night(source, { lights: lights(p.lights), windows: rects(p.windows), tint: p.tint, palette: p.palette });
      break;
    case 'dusk':
      image = await dusk(source, { strength: p.strength, shadowLength: p.shadowLength, lights: lights(p.lights), windows: rects(p.windows), palette: p.palette });
      break;
    case 'snow':
      image = await snow(source, { amount: p.amount, palette: p.palette });
      break;
    case 'after_rain':
      image = await afterRain(source, { lights: lights(p.lights), puddles: p.puddles, darken: p.darken, palette: p.palette });
      break;
    case 'mirror': {
      const result = mirror(source, { boxes: p.boxes, points: p.points, coordinateWidth: p.coordinateWidth });
      image = result.image;
      extra.boxes = result.boxes;
      extra.points = result.points;
      if (p.mask) {
        const mask = (await loadPicture(ctx, p.mask)).image;
        const maskOut = path.join(tmpDir(ctx.config, 'variants', key), `${key}-mask.png`);
        await saveRgba(mirror(mask).image, maskOut);
        extra.mask = display(ctx.config, maskOut);
      }
      break;
    }
    case 'recolor': {
      if (!Array.isArray(p.hueFrom) || typeof p.hueTo !== 'number') {
        throw new StudioError('BAD_ARGS', 'recolor cần params.hueFrom [min,max] (độ) và params.hueTo (độ), tùy chọn satMul, minSat, region.');
      }
      const result = recolor(source, { hueFrom: [Number(p.hueFrom[0]), Number(p.hueFrom[1])], hueTo: p.hueTo, satMul: p.satMul, minSat: p.minSat, region: p.region ? asRect(p.region) : undefined });
      image = result.image;
      extra.changedPixels = result.changed;
      break;
    }
    case 'compose': {
      const add: ComposeItem[] = [];
      for (const entry of p.add ?? []) {
        add.push({ image: (await loadPicture(ctx, entry.source)).image, x: entry.x, y: entry.y, scale: entry.scale, flip: entry.flip, shadow: entry.shadow });
      }
      image = compose(source, { add, remove: rects(p.remove) });
      extra.added = add.length;
      extra.removed = (p.remove ?? []).length;
      break;
    }
  }
  const dir = tmpDir(ctx.config, 'variants', key);
  const output = args.output ? resolveInput(ctx.config, args.output) : path.join(dir, `${key}.png`);
  await saveRgba(image!, output);
  const compareFile = path.join(dir, `${key}-so-sanh.png`);
  await saveRgba(sideBySide(source, image!), compareFile);
  const thumbFile = path.join(dir, `${key}-thumb.png`);
  const thumbSize = Math.max(1, Math.round(128 * Math.min(1, source.width / Math.max(source.width, source.height))));
  await saveRgba(resizeNearest(image!, thumbSize, Math.max(1, Math.round((thumbSize * image!.height) / image!.width))), thumbFile);
  const recipe = { type: args.type, params: p, parentKey, source: parentKey ? undefined : display(ctx.config, sourceFile) };
  writeJsonFile(path.join(dir, 'recipe.json'), recipe);
  let entry: LibraryItem | null = null;
  if (args.saveToLibrary !== false) {
    const base = parent ?? emptyItem(key, 'INTERIOR', 'ALL');
    entry = upsertItem(index, {
      ...emptyItem(key, base.kind, base.world),
      tags: [...new Set([...(base.tags ?? []), ...(args.tags ?? []), `bien-the:${args.type.replace('_', '-')}`])],
      nameVi: args.nameVi ?? (base.nameVi ? `${base.nameVi} (${VARIANT_NAMES_VI[args.type]})` : key),
      nameEn: args.nameEn ?? (base.nameEn ? `${base.nameEn} (${args.type.replace('_', ' ')})` : key),
      width: image!.width, height: image!.height, parentKey, source: 'VARIANT',
      variant: JSON.stringify({ type: args.type, ...p }).slice(0, 2000),
      prompt: base.prompt ?? '',
      local: { files: { main: display(ctx.config, output), thumb: display(ctx.config, thumbFile) }, origin: display(ctx.config, sourceFile) },
    });
    saveIndex(ctx.config.libraryIndexPath, index);
  }
  return {
    key, type: args.type, parentKey: parentKey || null, output: display(ctx.config, output), compare: display(ctx.config, compareFile),
    size: `${image!.width}x${image!.height}`, pixelLabCredits: 0, savedToLibrary: Boolean(entry), ...extra,
    next: `Mở ${display(ctx.config, compareFile)} để tự xem trước/sau. Dùng được thì library_sync { direction: "push", keys: ["${key}"] } để đưa lên server.`,
  };
}

const VARIANT_NAMES_VI: Record<VariantType, string> = {
  night: 'ban đêm', dusk: 'hoàng hôn', snow: 'tuyết', after_rain: 'sau mưa', mirror: 'lật gương', recolor: 'đổi màu', compose: 'bày lại',
};
