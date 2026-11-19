/** asset_process and asset_variant: local picture work, 0 PixelLab credits. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { StudioError } from '../bridge-client.js';
import { display, readJsonFile, requireFile, resolveInput, tmpDir, writeJsonFile } from '../files.js';
import {
  checkSize, cleanText, cover, cutBackground, fit, foregroundLayer, iconSheetCells, idleSheet, inspect, maskFromShapes, npcCheck, npcFromZip,
  portrait, walkableFromMask, walkOverlay, type NpcSources, type WalkShape,
} from '../image/process.js';
import {
  inpaintCost, inpaintInputs, isTightMask, maskBounds, mergeInpaint, paintedPlacement, planInpaint, sceneMask, type InpaintPlan, type Point,
} from '../image/inpaint.js';
import { crop as cropRgba, loadRgba, resizeNearest, saveRgba, sideBySide, type Rgba } from '../image/raster.js';
import {
  afterRain, compose, dusk, mirror, night, recolor, snow, VARIANT_TYPES, type Rect, type VariantType,
} from '../image/variant.js';
import { emptyItem, loadIndex, saveIndex, upsertItem, type LibraryItem } from '../library/index-store.js';
import type { ToolContext } from './context.js';

export const PROCESS_OPS = [
  'inspect', 'cut_background', 'to_webp', 'check_size', 'clean_text', 'cover', 'idle_breathe', 'sprite_sheet', 'portrait',
  'npc_bundle', 'walkable', 'mask_from_shapes', 'foreground', 'icon_sheet', 'fit', 'inpaint_prep', 'inpaint_merge',
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

/** The NPC standard (96x96 south, no chibi prompt): every NPC op refuses an NPC outside it, before writing a file. */
function requireNpcStandard(npc: NpcSources): void {
  const { problems } = npcCheck(npc);
  if (problems.length) throw new StudioError(problems[0].code, problems.map((problem) => problem.message).join(' '));
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
      requireNpcStandard(npc);
      if (args.op === 'idle_breathe') npc.idle = [];
      const sheet = idleSheet(npc);
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'idle', '.png');
      await saveRgba(sheet.image, output);
      return { output: display(ctx.config, output), width: sheet.image.width, height: sheet.image.height, frames: 9, source: sheet.source, anchorY: sheet.anchorY, pixelLabCredits: 0 };
    }
    case 'portrait': {
      const npc = await loadNpc(ctx, args.input ?? '');
      requireNpcStandard(npc);
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, args.input, 'portrait', '.png');
      await saveRgba(portrait(npc.south, p.size ?? 288), output);
      return { output: display(ctx.config, output), width: p.size ?? 288, height: p.size ?? 288, scaling: 'nearest-neighbor' };
    }
    case 'npc_bundle': {
      const npc = await loadNpc(ctx, args.input ?? '');
      requireNpcStandard(npc);
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
    case 'foreground': {
      // VUAN-6B: a layer drawn over actors standing behind it (lamp, tree, cart), cut from the NATIVE map by the mask.
      const mapRef = p.map ?? args.input;
      if (!mapRef || !p.mask || !p.rect) {
        throw new StudioError('BAD_ARGS', 'foreground cần params.map (bản đồ NATIVE 512), params.mask (mask vật thể: trắng = vật) và params.rect [x0,y0,x1,y1] (pixel native bao quanh vật).');
      }
      const map = (await loadPicture(ctx, mapRef)).image;
      const mask = (await loadPicture(ctx, p.mask)).image;
      if (map.width !== 512 || map.height !== 512) {
        throw new StudioError('BAD_ARGS', `foreground cắt từ bản đồ NATIVE 512x512, không dùng bản phóng to (ảnh là ${map.width}x${map.height}).`);
      }
      const result = foregroundLayer(map, mask, asRect(p.rect), { pixelScale: p.pixelScale, threshold: p.threshold, invert: p.invert, baseRow: p.baseRow, tight: p.tight });
      const id = String(p.id ?? 'layer').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, mapRef.split('#')[0], `fg-${id}`, '.png');
      await saveRgba(result.image, output);
      return {
        output: display(ctx.config, output), native: `${result.image.width}x${result.image.height}`, pixels: result.pixels,
        layer: { id, url: `<URL sau khi tải lên thư viện: POST /api/bridge/library/files, role fg-${id}>`, ...result.layer },
        hint: 'Đưa layer vào foreground[] của câu trả lời bố cục (đơn vị runtime = native x 4). baseY là đường chạm đất; cây, cột đèn có gốc cao hơn đáy vết cắt thì truyền params.baseRow (hàng native của gốc).',
      };
    }
    case 'icon_sheet': {
      // VUAN-6B: a PixelLab icon-sheet (256x256, 4x4) -> one 64x64 PNG per item (items[].imageUrl).
      const { image } = await loadPicture(ctx, args.input ?? '');
      const names: (string | null | undefined)[] = p.names ?? [];
      const base = path.basename(args.input ?? 'icons').replace(/\.[^.]+$/, '');
      const dir = args.output ? resolveInput(ctx.config, args.output) : tmpDir(ctx.config, 'assets', base);
      const cells = iconSheetCells(image, { columns: p.columns, rows: p.rows, cell: p.cell });
      const files = [];
      for (const cell of cells) {
        const name = names[cell.cell] ?? null;
        if (cell.empty && !name) continue;
        const file = path.join(dir, `${name ?? `cell-${cell.cell}`}.png`);
        await saveRgba(cell.image, file);
        files.push({ cell: cell.cell, row: cell.row, col: cell.col, name, empty: cell.empty, file: display(ctx.config, file), size: '64x64' });
      }
      return { dir: display(ctx.config, dir), cells: files.length, files, hint: 'Đối chiếu từng ô với grid của request icons.N trong kế hoạch rồi asset_upload vào ô item:<itemId>.' };
    }
    case 'fit': {
      // Classic 1600x900 drafts only (made before VUAN-6B). Pixel drafts take the 512 / 1152x128 / 288 / 64 pictures as they are.
      if (!p.width || !p.height) throw new StudioError('BAD_ARGS', 'fit cần params.width và params.height (kích thước ô hình).');
      const { image } = await loadPicture(ctx, args.input ?? '');
      const result = fit(image, p.width, p.height, { mode: p.mode, background: p.background, scale: p.scale });
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
    case 'inpaint_prep': {
      // Yen 17/11/2026: create objects first (in the scene prompt). To add one over a finished scene, inpaint it properly:
      // a free-form mask drawn WIDE along the whole surface it rests on, never a small box around the object, never a pasted picture.
      const sceneRef = p.scene ?? args.input;
      if (!sceneRef || !(p.polygon || p.polygons || p.maskImage || p.rect || p.rects)) {
        throw new StudioError('BAD_ARGS', 'inpaint_prep cần params.scene (ảnh cảnh NATIVE 512) và vùng mask tô RỘNG theo cả mặt vật đứng lên (mặt bàn, ghế, kệ): '
          + 'polygon [[x,y],...] / polygons, hoặc maskImage (PNG cỡ cảnh, trắng = vẽ lại), hoặc rect/rects [x0,y0,x1,y1] (pixel native). '
          + 'Tùy chọn: description (tiếng Anh ASCII, kể MỌI vật phải có trên mặt đó), size 128|256|512, id.');
      }
      const scene = (await loadPicture(ctx, sceneRef)).image;
      if (scene.width !== 512 || scene.height !== 512) {
        throw new StudioError('BAD_ARGS', `inpaint_prep làm trên cảnh NATIVE 512x512, không dùng bản phóng to (ảnh là ${scene.width}x${scene.height}).`);
      }
      if (p.description !== undefined && !/^[\x20-\x7E]*$/.test(String(p.description))) {
        throw new StudioError('BAD_ARGS', 'description gửi PixelLab là tiếng Anh ASCII, không dấu, không tên nhân vật.');
      }
      const polygons: Point[][] = [...(p.polygon ? [p.polygon] : []), ...(p.polygons ?? [])];
      const rectList = [...(p.rect ? [p.rect] : []), ...(p.rects ?? [])].map(asRect);
      let sceneShape: Uint8Array;
      let plan: InpaintPlan;
      try {
        const image = p.maskImage ? (await loadPicture(ctx, p.maskImage)).image : undefined;
        sceneShape = sceneMask(scene.width, scene.height, { polygons, rects: rectList, image });
        const bounds = maskBounds(sceneShape, scene.width);
        if (!bounds) throw new Error('Mask rỗng: không có pixel nào được tô.');
        plan = planInpaint(scene.width, scene.height, { x0: bounds.x, y0: bounds.y, x1: bounds.x + bounds.width - 1, y1: bounds.y + bounds.height - 1 }, p.size);
      } catch (error) {
        throw new StudioError('BAD_ARGS', (error as Error).message);
      }
      const warnings: string[] = [];
      if (isTightMask(plan.mask)) {
        warnings.push(`MASK_TIGHT: mask ${plan.mask.width}x${plan.mask.height} ôm sát một vật nên PixelLab vẽ vật nhỏ hoặc nhòe. Tô rộng theo cả mặt vật nằm lên (mặt bàn, ghế, kệ) rồi kể mọi vật trên mặt đó trong description.`);
      }
      const id = String(p.id ?? 'vat').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      const base = path.basename(sceneRef.split('#')[0]).replace(/\.[^.]+$/, '');
      const dir = args.output ? resolveInput(ctx.config, args.output) : tmpDir(ctx.config, 'assets', `${base}-inpaint-${id}`);
      const inputs = inpaintInputs(scene, plan, sceneShape);
      const files = {
        source: path.join(dir, 'source.png'), mask: path.join(dir, 'mask.png'), context: path.join(dir, 'context.png'),
        preview: path.join(dir, 'preview.png'), plan: path.join(dir, 'plan.json'),
      };
      await saveRgba(inputs.source, files.source);
      await saveRgba(inputs.mask, files.mask, { opaque: true });
      await saveRgba(inputs.context, files.context);
      // What Claude looks at before spending: the canvas enlarged with the mask tinted red.
      const zoom = plan.crop.width >= 512 ? 2 : 4;
      const preview = resizeNearest(inputs.source, plan.crop.width * zoom, plan.crop.height * zoom);
      for (let y = 0; y < preview.height; y++) {
        for (let x = 0; x < preview.width; x++) {
          if (inputs.mask.data[(Math.floor(y / zoom) * plan.crop.width + Math.floor(x / zoom)) * 4] !== 255) continue;
          const i = (y * preview.width + x) * 4;
          preview.data[i] = Math.round(preview.data[i] * 0.5 + 255 * 0.5);
          preview.data[i + 1] = Math.round(preview.data[i + 1] * 0.5);
          preview.data[i + 2] = Math.round(preview.data[i + 2] * 0.5);
          preview.data[i + 3] = 255;
        }
      }
      await saveRgba(preview, files.preview);
      const description = String(p.description ?? '<tiếng Anh ASCII: mặt vật nằm lên và MỌI vật phải có trên đó, vd. "Wooden counter top with an open guest ledger, torn letter scraps and a tea tray with two cups">');
      const calls: any[] = [
        {
          tool: 'inpaint_image', name: 'Inpaint Pro (v3, REST /v2/inpaint-v3)', generations: inpaintCost('inpaint_image', plan.crop.width),
          params: { image_url: 'upload:<source.png>', mask_image_url: 'upload:<mask.png>', description, no_background: false, crop_to_mask: true },
        },
      ];
      if (plan.crop.width <= 256) {
        calls.push({
          tool: 'inpaint_image_pro_flash', generations: inpaintCost('inpaint_image_pro_flash', plan.crop.width),
          params: {
            image_url: 'upload:<source.png>', mask_image_url: 'upload:<mask.png>', description, no_background: false, output_method: 'Modify current layer',
            context_image: { url: 'upload:<context.png>', usage_description: 'the surrounding scene: match its perspective, lighting and palette' },
            bounding_box: plan.boundingBox,
          },
          when: 'Rẻ hơn nhưng hay ra vệt nhòe với vật nhỏ. Chỉ dùng khi chủ dự án đồng ý; lần gọi lại nào cũng phải hỏi trước.',
        });
      }
      if (plan.crop.width > 256) warnings.push('Khung 512 (cả cảnh): inpaint_image 25 lượt, PixelLab cần gói Tier 2 cho ảnh trên 256.');
      writeJsonFile(files.plan, {
        scene: sceneRef, polygons, rects: [...(p.rect ? [p.rect] : []), ...(p.rects ?? [])], maskImage: p.maskImage ?? null, maskFile: 'mask.png',
        ...plan, description: p.description ?? null, calls,
      });
      return {
        dir: display(ctx.config, dir), files: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, display(ctx.config, file)])),
        ...plan, maskPixels: inputs.mask.data.filter((_, i) => i % 4 === 0 && inputs.mask.data[i] === 255).length,
        calls, warnings, pixelLabCredits: 0,
        next: [
          `Mở ${display(ctx.config, files.preview)}: vùng đỏ là chỗ PixelLab vẽ lại (chỉ vùng này được thay). Vùng đỏ phải phủ rộng cả mặt bàn/ghế/kệ, không chỉ ôm vật.`,
          'description kể MỌI vật phải có trên mặt đó (kể cả vật cũ muốn giữ): trong mask PixelLab vẽ lại hết.',
          'PixelLab get_upload_url, tải source.png và mask.png lên (curl), thay upload:<...> trong calls[0] rồi gọi. Lần đầu theo yêu cầu thì chạy; vẽ lại phải hỏi chủ dự án.',
          'get_image(job_id) lấy URL tải PNG, lưu file, rồi asset_process { op: "inpaint_merge", params: { plan: "' + display(ctx.config, files.plan) + '", result: <file PNG>, boxes: { <itemId>: [x0,y0,x1,y1] } } }.',
        ],
      };
    }
    case 'inpaint_merge': {
      if (!p.result || (!p.plan && !(p.crop && p.mask))) {
        throw new StudioError('BAD_ARGS', 'inpaint_merge cần params.result (PNG PixelLab trả về) và params.plan (plan.json của inpaint_prep), hoặc params.crop {x,y,width,height} + params.mask {x,y,width,height} (+ maskFile).');
      }
      const planFile = p.plan ? requireFile(ctx.config, p.plan) : null;
      const plan = planFile ? readJsonFile(planFile) : { crop: p.crop, mask: p.mask, maskFile: p.maskFile };
      const sceneRef = p.scene ?? args.input ?? plan.scene;
      if (!sceneRef) throw new StudioError('BAD_ARGS', 'inpaint_merge cần params.scene (ảnh cảnh gốc).');
      const scene = (await loadPicture(ctx, sceneRef)).image;
      const result = (await loadPicture(ctx, p.result)).image;
      const maskRef = plan.maskFile ? (planFile && !path.isAbsolute(plan.maskFile) ? path.join(path.dirname(planFile), plan.maskFile) : plan.maskFile) : null;
      const maskPicture = maskRef ? (await loadPicture(ctx, maskRef)).image : undefined;
      let merged;
      try {
        merged = mergeInpaint(scene, result, plan, maskPicture);
      } catch (error) {
        throw new StudioError('BAD_ARGS', (error as Error).message);
      }
      if (!merged.drawn) {
        throw new StudioError('INPAINT_EMPTY', 'PixelLab gần như không vẽ gì trong vùng mask. Báo chủ dự án, đề xuất sửa description hoặc tô mask rộng hơn rồi chờ đồng ý trước khi gọi lại.');
      }
      const output = args.output ? resolveInput(ctx.config, args.output) : defaultOutput(ctx, sceneRef.split('#')[0], 've-vat', '.png');
      await saveRgba(merged.image, output);
      const compare = output.replace(/\.[^.]+$/, '-so-sanh.png');
      const zoom = (img: Rgba) => {
        const part = cropRgba(img, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height);
        const factor = part.width >= 512 ? 2 : 3;
        return resizeNearest(part, part.width * factor, part.height * factor);
      };
      await saveRgba(sideBySide(zoom(scene), zoom(merged.image)), compare);
      const pixelScale = p.pixelScale ?? 4;
      const placements: Record<string, ReturnType<typeof paintedPlacement>> = {};
      for (const [itemId, box] of Object.entries(p.boxes ?? {})) {
        const rect = asRect(box);
        placements[itemId] = paintedPlacement({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0 + 1, height: rect.y1 - rect.y0 + 1 }, pixelScale, p.pad ?? 2, scene.width);
      }
      const wide = !isTightMask(plan.mask);
      return {
        output: display(ctx.config, output), compare: display(ctx.config, compare),
        changedPixels: merged.changed, ignoredOutsideMask: merged.ignoredOutside, drawn: merged.drawn,
        // A wide mask repaints a whole surface: the box of each object comes from looking at the result (params.boxes).
        placement: wide ? null : paintedPlacement(merged.drawn, pixelScale, p.pad ?? 2, scene.width),
        placements,
        pixelLabCredits: 0,
        hint: [
          `Mở ${display(ctx.config, compare)} để tự xem trước/sau. Pixel ngoài mask giữ nguyên từng byte.`,
          wide
            ? 'Mask rộng vẽ lại cả mặt: nhìn ảnh so sánh, đo khung từng vật (pixel native) rồi gọi lại với params.boxes { itemId: [x0,y0,x1,y1] } để lấy placements.'
            : 'placement (đơn vị runtime = native x 4): ghi vào runtime.itemPlacements[] của vật (asset rỗng, hotspot phủ vật), hotspots[] của cảnh dùng cùng ô.',
          'Vật cũ trong mask (khay, chén...) có thể đổi chỗ: kiểm lại clueZones và ô bấm cũ trên mặt đó.',
          'Ảnh cảnh mới thay backgroundUrl: asset_upload vào ô background:<sceneId>. Giữ source/mask/context, PNG PixelLab và job ID.',
        ],
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
const puddles = (value: any) => (value ?? [])
  .map((entry: any) => (Array.isArray(entry) ? { x: entry[0], y: entry[1], rx: entry[2], ry: entry[3] } : entry))
  .filter((entry: any) => [entry?.x, entry?.y, entry?.rx, entry?.ry].every((n) => Number.isFinite(n)) && entry.rx > 0 && entry.ry > 0);

/** Yen 17/11/2026: pasting an item picture onto a map looks wrong. Items are painted by PixelLab instead. */
export const ITEM_PASTE_MESSAGE = 'Không dán ảnh vật lên cảnh (lệch phối cảnh, ánh sáng, nhìn rất xấu). '
  + 'Cảnh mới: ghi vật vào mô tả cảnh (visualDescription) để PixelLab vẽ luôn vào nền. '
  + 'Cảnh đã có: inpaint cho chuẩn: asset_process inpaint_prep với mask tô RỘNG theo cả mặt vật nằm lên (polygon) -> PixelLab inpaint_image (Inpaint Pro, mask_image) -> asset_process inpaint_merge. '
  + 'compose chỉ còn remove (xóa vật bằng nội suy).';

export async function assetVariant(ctx: ToolContext, args: VariantArgs) {
  if (!VARIANT_TYPES.includes(args.type)) throw new StudioError('BAD_ARGS', `type phải là một trong: ${VARIANT_TYPES.join(', ')}`);
  const p = args.params ?? {};
  if (args.type === 'compose' && (p.add ?? []).length > 0) throw new StudioError('ITEM_PASTE_FORBIDDEN', ITEM_PASTE_MESSAGE);
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
      image = await afterRain(source, { lights: lights(p.lights), puddles: puddles(p.puddles), darken: p.darken, palette: p.palette });
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
      if (!(p.remove ?? []).length) throw new StudioError('BAD_ARGS', 'compose cần params.remove [[x0,y0,x1,y1], ...]. ' + ITEM_PASTE_MESSAGE);
      image = compose(source, { remove: rects(p.remove) });
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
  night: 'ban đêm', dusk: 'hoàng hôn', snow: 'tuyết', after_rain: 'sau mưa', mirror: 'lật gương', recolor: 'đổi màu', compose: 'xóa bớt vật',
};
