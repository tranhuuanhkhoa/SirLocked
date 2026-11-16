/**
 * asset_process: the local picture work of the studio (no PixelLab credit): inspect, cut background, WebP, size
 * checks, clean gibberish lettering, cover from scene + portraits, NPC idle sheet and portrait, walkable grid.
 */
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import {
  alphaComposite, blank, clone, countColors, crop, hasTransparency, loadRgba, opaqueBounds, resizeNearest, type Rgba,
} from './raster.js';
import { inpaintRect, type Rect } from './variant.js';

// ------------------------------------------------------------------------------------------------ inspect

export interface InspectResult {
  width: number;
  height: number;
  format: string;
  bytes: number;
  hasAlpha: boolean;
  transparentShare: number;
  colors: number;
  opaqueBounds: { x0: number; y0: number; x1: number; y1: number } | null;
}

export async function inspect(bytes: Buffer): Promise<InspectResult> {
  const meta = await sharp(bytes).metadata();
  const image = await loadRgba(bytes);
  let transparent = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] === 0) transparent++;
  return {
    width: image.width,
    height: image.height,
    format: meta.format ?? 'unknown',
    bytes: bytes.length,
    hasAlpha: hasTransparency(image),
    transparentShare: Math.round((transparent / (image.width * image.height)) * 1000) / 1000,
    colors: countColors(image),
    opaqueBounds: opaqueBounds(image),
  };
}

export interface SizeExpectation {
  width?: number;
  height?: number;
  transparent?: boolean;
  maxBytes?: number;
}

/** Problems against what a slot asks for; empty when everything fits. */
export function checkSize(info: InspectResult, expected: SizeExpectation): string[] {
  const problems: string[] = [];
  if (expected.width && info.width !== expected.width) problems.push(`rộng ${info.width}px, cần ${expected.width}px`);
  if (expected.height && info.height !== expected.height) problems.push(`cao ${info.height}px, cần ${expected.height}px`);
  if (expected.transparent === true && !info.hasAlpha) problems.push('cần nền trong suốt nhưng ảnh không có pixel trong suốt');
  if (expected.transparent === false && info.transparentShare > 0.02) problems.push('ảnh nền phải phủ kín nhưng có vùng trong suốt');
  if (expected.maxBytes && info.bytes > expected.maxBytes) problems.push(`${info.bytes} byte, tối đa ${expected.maxBytes}`);
  if (!['png', 'webp'].includes(info.format)) problems.push(`định dạng ${info.format}, chỉ nhận PNG hoặc WebP`);
  return problems;
}

// ------------------------------------------------------------------------------------------------ background

const distance = (data: Buffer, at: number, rgb: [number, number, number]) =>
  Math.max(Math.abs(data[at] - rgb[0]), Math.abs(data[at + 1] - rgb[1]), Math.abs(data[at + 2] - rgb[2]));

/**
 * Removes a flat background connected to the border (flood fill from every border pixel close to the reference
 * colour). The reference is the given colour or the most common corner colour.
 */
export function cutBackground(source: Rgba, options: { tolerance?: number; color?: [number, number, number] } = {}): { image: Rgba; removed: number } {
  const image = clone(source);
  const { width: W, height: H, data } = image;
  const tolerance = options.tolerance ?? 24;
  let reference = options.color;
  if (!reference) {
    const corners = [0, W - 1, (H - 1) * W, H * W - 1].map((i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]] as [number, number, number]);
    const votes = new Map<string, { rgb: [number, number, number]; n: number }>();
    for (const rgb of corners) {
      const key = rgb.join(',');
      votes.set(key, { rgb, n: (votes.get(key)?.n ?? 0) + 1 });
    }
    reference = [...votes.values()].sort((a, b) => b.n - a.n)[0].rgb;
  }
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  let removed = 0;
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i]) continue;
    seen[i] = 1;
    const at = i * 4;
    if (data[at + 3] !== 0 && distance(data, at, reference) > tolerance) continue;
    if (data[at + 3] !== 0) removed++;
    data[at + 3] = 0;
    const x = i % W, y = (i - x) / W;
    if (x > 0) stack.push(i - 1);
    if (x < W - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - W);
    if (y < H - 1) stack.push(i + W);
  }
  return { image, removed };
}

// ------------------------------------------------------------------------------------------------ clean text

/**
 * Removes gibberish lettering an image model drew on an item (ticket, label, paper): inside each rectangle the
 * dominant colour (the paper) replaces every opaque pixel that differs from it by more than the threshold ("fill"),
 * or the rectangle is rebuilt from its left and right neighbours ("inpaint").
 */
export function cleanText(source: Rgba, rects: Rect[], options: { threshold?: number; mode?: 'fill' | 'inpaint' } = {}): { image: Rgba; changed: number } {
  const image = clone(source);
  const { width: W, data } = image;
  const threshold = options.threshold ?? 40;
  let changed = 0;
  for (const rect of rects) {
    if (options.mode === 'inpaint') {
      inpaintRect(image, rect);
      changed += (rect.x1 - rect.x0 + 1) * (rect.y1 - rect.y0 + 1);
      continue;
    }
    const votes = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        const at = (y * W + x) * 4;
        if (at < 0 || at >= data.length || data[at + 3] === 0) continue;
        const key = ((data[at] >> 3) << 10) | ((data[at + 1] >> 3) << 5) | (data[at + 2] >> 3);
        const vote = votes.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        vote.n++; vote.r += data[at]; vote.g += data[at + 1]; vote.b += data[at + 2];
        votes.set(key, vote);
      }
    }
    const top = [...votes.values()].sort((a, b) => b.n - a.n)[0];
    if (!top) continue;
    const paper: [number, number, number] = [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)];
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        const at = (y * W + x) * 4;
        if (at < 0 || at >= data.length || data[at + 3] === 0) continue;
        if (distance(data, at, paper) > threshold) {
          data[at] = paper[0]; data[at + 1] = paper[1]; data[at + 2] = paper[2];
          changed++;
        }
      }
    }
  }
  return { image, changed };
}

// ------------------------------------------------------------------------------------------------ NPC

export interface NpcSources {
  south: Rgba;
  /** PixelLab idle frames (south), empty when the character has no animation yet. */
  idle: Rgba[];
  /** The character's PixelLab prompt (metadata.json of the zip), when there is one. */
  prompt?: string;
}

/** Reads a PixelLab character zip: rotations/south.png and animations/idle/south/frame_*.png. */
export async function npcFromZip(zip: Uint8Array): Promise<NpcSources> {
  const files = unzipSync(zip);
  const names = Object.keys(files);
  const southName = names.find((name) => /(^|\/)rotations\/south\.png$/.test(name));
  if (!southName) throw new Error('The character zip has no rotations/south.png.');
  const frameNames = names.filter((name) => /\/animations\/[^/]*idle[^/]*\/south\/[^/]+\.png$/i.test(name)).sort();
  const south = await loadRgba(Buffer.from(files[southName]));
  const idle: Rgba[] = [];
  for (const name of frameNames) idle.push(await loadRgba(Buffer.from(files[name])));
  let prompt: string | undefined;
  if (files['metadata.json']) {
    try {
      const metadata = JSON.parse(Buffer.from(files['metadata.json']).toString('utf8'));
      const value = metadata?.states?.[0]?.character?.prompt ?? metadata?.character?.prompt;
      if (typeof value === 'string') prompt = value;
    } catch {
      // A zip without readable metadata still has its pictures.
    }
  }
  return { south, idle, prompt };
}

/** Breathing done in code, 0 credits: the upper body (above 55% of the height) dips one pixel and comes back. */
export function breatheFrames(south: Rgba): Rgba[] {
  const bounds = opaqueBounds(south);
  if (!bounds) throw new Error('The south sprite is empty.');
  const hip = Math.trunc(bounds.y0 + (bounds.y1 - bounds.y0) * 0.55);
  const frames: Rgba[] = [];
  for (const offset of [0, 0, 1, 1, 1, 1, 0, 0, 0]) {
    const frame = blank(south.width, south.height);
    const lower = crop(south, 0, hip, south.width, south.height - hip);
    const upper = crop(south, 0, 0, south.width, hip);
    alphaComposite(frame, lower, 0, hip);
    alphaComposite(frame, upper, 0, offset);
    frames.push(frame);
  }
  return frames;
}

export const IDLE_SEQUENCE = [0, 1, 2, 3, 3, 2, 1, 0, 0];

/**
 * The 9 frames of the idle sheet. The templates.json idle (animate_character v3, 8 frames + the kept first frame)
 * already has 9 frames and plays in order; a 4-frame template clip plays 0-1-2-3-3-2-1-0-0; none: the code breathes.
 */
export function idleFrames(npc: NpcSources): Rgba[] {
  if (npc.idle.length === 0) return breatheFrames(npc.south);
  if (npc.idle.length >= 9) return npc.idle.slice(0, 9);
  return IDLE_SEQUENCE.map((index) => npc.idle[index % npc.idle.length]);
}

/**
 * The game's NPC idle sheet: 9 frames of 128x128 side by side (1152x128), feet at y=104 of each frame, x offset 16
 * (as in the two pixel cases). v3 animation frames sit on a larger canvas than the 96 sprite (108-116 px, the
 * character centred with room to move): each frame is shifted back by half the difference so the character lands
 * where its south sprite would, and clipped to its own cell.
 */
export function idleSheet(npc: NpcSources): { image: Rgba; source: 'pixellab-idle' | 'code-breathing'; anchorY: number } {
  const frames = idleFrames(npc);
  const sheet = blank(128 * 9, 128);
  const bounds = opaqueBounds(npc.south);
  const feet = bounds ? bounds.y1 : npc.south.height - 1;
  const dy = 104 - feet;
  frames.forEach((frame, index) => {
    const ox = Math.round((frame.width - npc.south.width) / 2);
    const oy = Math.round((frame.height - npc.south.height) / 2);
    const cell = blank(128, 128);
    alphaComposite(cell, frame, 16 - ox, dy - oy);
    alphaComposite(sheet, cell, index * 128, 0);
  });
  return { image: sheet, source: npc.idle.length > 0 ? 'pixellab-idle' : 'code-breathing', anchorY: Math.round((105 / 128) * 10000) / 10000 };
}

/** Portrait as the two pixel cases do it: the south sprite scaled to 288x288, nearest neighbour (96px x 3). */
export function portrait(south: Rgba, size = 288): Rgba {
  return resizeNearest(south, size, size);
}

// ------------------------------------------------------------------------------------------------ NPC standard

/**
 * NPC standard (ai-game-docs/visual-style-templates/pixellab): every NPC comes out of the PixelLab workflow of
 * templates.json (character-front with the Sherlock V3 96 style reference -> create_character v3 -> idle v3), so its
 * style matches Sherlock, Watson and the Lò thuốc NPCs by construction. The figure's height is the character's own
 * (tall, short, a child): it is never locked in pixels. What is refused:
 * - a south sprite that is not 96x96: 96 is the ceiling, the same canvas as Sherlock and Watson V3 96, so no NPC is drawn
 *   bigger than the two detectives (and the game's sheets and portraits are built from 96);
 * - a character whose PixelLab prompt asks for the chibi look (big head), as the first library batch did.
 */
export const NPC_CANVAS = 96;
export const CHIBI_WORDS = /\b(chibi|super[ -]?deformed|large head|big head|oversized head|bobblehead)\b/i;

export interface NpcCheck {
  /** Each one refuses the NPC: [code, message]. */
  problems: Array<{ code: 'NPC_FORMAT' | 'NPC_STYLE'; message: string }>;
}

const REDRAW = 'Vẽ lại theo templates.json: character-front (create_image_pro 96x96, ảnh Sherlock V3 96 làm mẫu phong cách) '
  + '-> create_character v3 từ ứng viên nhìn thẳng -> animate_character idle v3. Không sửa hay thu nhỏ ảnh cho lọt.';

export function npcCheck(npc: NpcSources): NpcCheck {
  const problems: NpcCheck['problems'] = [];
  if (npc.south.width !== NPC_CANVAS || npc.south.height !== NPC_CANVAS) {
    problems.push({ code: 'NPC_FORMAT', message: `Sprite south của NPC phải ${NPC_CANVAS}x${NPC_CANVAS} như PixelLab trả về, đang ${npc.south.width}x${npc.south.height}. ${REDRAW}` });
  } else if (!opaqueBounds(npc.south, 16)) {
    problems.push({ code: 'NPC_FORMAT', message: 'Sprite south của NPC trống.' });
  }
  const chibi = npc.prompt ? CHIBI_WORDS.exec(npc.prompt) : null;
  if (chibi) {
    problems.push({ code: 'NPC_STYLE', message: `Nhân vật PixelLab này tạo với prompt "${chibi[0]}": kiểu chibi đầu to, lệch phong cách game `
      + `(tỉ lệ người thật như Sherlock, Watson, NPC vụ Lò thuốc). ${REDRAW}` });
  }
  return { problems };
}

// ------------------------------------------------------------------------------------------------ cover

/**
 * Cover from a scene and portraits, 0 credits (as the sample case): a dark band over the bottom third and the
 * portraits side by side on it. Output is opaque.
 */
export function cover(scene: Rgba, portraits: Rgba[], options: { size?: number } = {}): Rgba {
  const size = options.size ?? 512;
  const base = scene.width === size && scene.height === size ? clone(scene) : resizeNearest(scene, size, size);
  const bandTop = Math.round(size * (330 / 512));
  const band = blank(size, size - bandTop, [8, 10, 24, 170]);
  alphaComposite(base, band, 0, bandTop);
  const count = Math.max(1, portraits.length);
  const portraitSize = Math.min(Math.round(size * (176 / 512)), Math.floor(size / count) + Math.round(size * (8 / 512)));
  const step = count > 1 ? Math.floor((size - portraitSize) / (count - 1)) : 0;
  portraits.forEach((picture, index) => {
    const scaled = resizeNearest(picture, portraitSize, portraitSize);
    const x = count === 1 ? Math.round((size - portraitSize) / 2) : index * step;
    alphaComposite(base, scaled, x, size - portraitSize);
  });
  for (let i = 3; i < base.data.length; i += 4) base.data[i] = 255;
  return base;
}

// ------------------------------------------------------------------------------------------------ fit

/**
 * Fits a pixel-art picture into a slot of another size without blurring: nearest-neighbour by a whole factor, then
 * "contain" (letterbox with a flat colour, default the average border colour) or "cover" (centre crop).
 * Example: a 512x512 library map into a 1600x900 background slot -> x1 = 512x512 centred (contain) or x4 cropped (cover).
 */
export function fit(source: Rgba, width: number, height: number, options: { mode?: 'contain' | 'cover'; background?: [number, number, number, number]; scale?: number } = {}): { image: Rgba; scale: number } {
  const mode = options.mode ?? 'contain';
  const forced = options.scale && Number.isInteger(options.scale) && options.scale >= 1 && options.scale <= 16 ? options.scale : 0;
  const ratio = forced || (mode === 'cover' ? Math.max(width / source.width, height / source.height) : Math.min(width / source.width, height / source.height));
  const scale = forced || (mode === 'cover' ? Math.max(1, Math.ceil(ratio)) : Math.max(1, Math.floor(ratio)));
  const scaled = ratio < 1 && mode === 'contain'
    ? resizeNearest(source, Math.max(1, Math.floor(source.width * ratio)), Math.max(1, Math.floor(source.height * ratio)))
    : resizeNearest(source, source.width * scale, source.height * scale);
  let background = options.background;
  if (!background) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let x = 0; x < source.width; x++) for (const y of [0, source.height - 1]) {
      const at = (y * source.width + x) * 4;
      r += source.data[at]; g += source.data[at + 1]; b += source.data[at + 2]; a += source.data[at + 3]; n++;
    }
    background = [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
  }
  const out = blank(width, height, background);
  const left = Math.round((width - scaled.width) / 2);
  const top = Math.round((height - scaled.height) / 2);
  for (let y = 0; y < scaled.height; y++) {
    const ty = y + top;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < scaled.width; x++) {
      const tx = x + left;
      if (tx < 0 || tx >= width) continue;
      scaled.data.copy(out.data, (ty * width + tx) * 4, (y * scaled.width + x) * 4, (y * scaled.width + x) * 4 + 4);
    }
  }
  return { image: out, scale: ratio < 1 && mode === 'contain' ? ratio : scale };
}

// ------------------------------------------------------------------------------------------------ foreground (VUAN-6B)

export interface ForegroundLayer {
  x: number;
  y: number;
  width: number;
  height: number;
  baseY: number;
}

/**
 * A foreground layer as in case-pixel-tram-hong-ngoc-vi.json (lamps, trees, carts): RGB from the NATIVE map, alpha
 * from the object mask (white = solid object) inside a native rectangle, cropped tight. The PNG stays native size; the
 * runtime box is native x pixelScale (16x74 lamp -> 64x296). baseY is the ground-contact line in runtime units: the
 * row under the lowest opaque pixel (or the bottom of the rectangle with tight: false), or params baseRow (native) for
 * objects whose foot is above the bottom of the cut.
 */
export function foregroundLayer(map: Rgba, mask: Rgba, rect: Rect, options: { pixelScale?: number; threshold?: number; invert?: boolean; baseRow?: number; tight?: boolean } = {}): { image: Rgba; layer: ForegroundLayer; pixels: number } {
  const scale = options.pixelScale ?? 4;
  const threshold = options.threshold ?? 128;
  const x0 = Math.max(0, Math.min(rect.x0, rect.x1)), x1 = Math.min(map.width - 1, Math.max(rect.x0, rect.x1));
  const y0 = Math.max(0, Math.min(rect.y0, rect.y1)), y1 = Math.min(map.height - 1, Math.max(rect.y0, rect.y1));
  const solid = (x: number, y: number) => {
    const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / map.width));
    const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / map.height));
    const at = (my * mask.width + mx) * 4;
    const luma = mask.data[at + 3] === 0 ? 0 : 0.299 * mask.data[at] + 0.587 * mask.data[at + 1] + 0.114 * mask.data[at + 2];
    return options.invert ? luma < threshold : luma >= threshold;
  };
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, pixels = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!solid(x, y) || map.data[(y * map.width + x) * 4 + 3] === 0) continue;
    pixels++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (pixels === 0) throw new Error('No solid pixel of the mask inside the rectangle (white = object; use invert if the mask is the other way round).');
  // tight: false keeps the rectangle as the canvas (as the bundled street layers), with the ground line at its bottom.
  if (options.tight === false) { minX = x0; maxX = x1; minY = y0; maxY = y1; }
  const image = blank(maxX - minX + 1, maxY - minY + 1);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (!solid(x, y)) continue;
    map.data.copy(image.data, ((y - minY) * image.width + (x - minX)) * 4, (y * map.width + x) * 4, (y * map.width + x) * 4 + 4);
  }
  const baseRow = options.baseRow !== undefined ? Math.max(minY, Math.min(maxY, options.baseRow)) : maxY;
  return {
    image,
    pixels,
    layer: { x: minX * scale, y: minY * scale, width: image.width * scale, height: image.height * scale, baseY: (baseRow + 1) * scale },
  };
}

// ------------------------------------------------------------------------------------------------ icon sheet (VUAN-6B)

/** Cuts a PixelLab icon-sheet (256x256, 4x4 grid of 64x64 cells, left to right, top to bottom) into its cells. */
export function iconSheetCells(sheet: Rgba, options: { columns?: number; rows?: number; cell?: number } = {}): { cell: number; row: number; col: number; image: Rgba; empty: boolean }[] {
  const columns = options.columns ?? 4, rows = options.rows ?? 4, size = options.cell ?? 64;
  if (sheet.width < columns * size || sheet.height < rows * size) {
    throw new Error(`The icon sheet is ${sheet.width}x${sheet.height}; a ${columns}x${rows} grid of ${size}px cells needs ${columns * size}x${rows * size}.`);
  }
  const cells = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const image = crop(sheet, col * size, row * size, size, size);
    let opaque = 0;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 0) opaque++;
    cells.push({ cell: row * columns + col, row: row + 1, col: col + 1, image, empty: opaque === 0 });
  }
  return cells;
}

// ------------------------------------------------------------------------------------------------ walkable

export interface WalkShape {
  /** Axis-aligned rectangle in native pixels (inclusive). */
  rect?: Rect;
  /** Isometric floor diamond: centre and half-diagonals in native pixels; `fill` scales it (default 1). */
  diamond?: { cx: number; cy: number; rx: number; ry: number; fill?: number; minY?: number };
}

/** Mask from shapes Claude reads off the picture: white = walkable, black = blocked. */
export function maskFromShapes(width: number, height: number, walk: WalkShape[], block: WalkShape[] = []): Rgba {
  const mask = blank(width, height, [0, 0, 0, 255]);
  const inside = (shape: WalkShape, x: number, y: number) => {
    if (shape.rect) return x >= shape.rect.x0 && x <= shape.rect.x1 && y >= shape.rect.y0 && y <= shape.rect.y1;
    if (shape.diamond) {
      const d = shape.diamond;
      return Math.abs(x - d.cx) / d.rx + Math.abs(y - d.cy) / d.ry <= (d.fill ?? 1) && (d.minY === undefined || y >= d.minY);
    }
    return false;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const walkable = walk.some((shape) => inside(shape, x, y)) && !block.some((shape) => inside(shape, x, y));
      if (walkable) mask.data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return mask;
}

export interface WalkGrid {
  cellSize: number;
  cols: number;
  rows: number;
  data: string[];
}

export interface WalkableResult {
  walkGrid: WalkGrid;
  walkableArea: { x: number; y: number; width: number; height: number };
  navigationObstacles: { x: number; y: number; width: number; height: number }[];
  walkableCells: number;
}

/**
 * Grid, walkable rectangle and obstacles in runtime units from a mask (white/opaque = walkable), the same shape as
 * case-pixel-tram-hong-ngoc-vi.json: runtime = native x pixelScale (512 x 4 = 2048), cells of 16 -> 128 x 128,
 * each cell sampled at its centre in native pixels. Obstacles are the blocked cells inside the walkable rectangle,
 * merged into rectangles.
 */
export function walkableFromMask(mask: Rgba, options: {
  nativeWidth?: number; nativeHeight?: number; pixelScale?: number; cellSize?: number; threshold?: number;
  invert?: boolean; channel?: 'luma' | 'alpha';
} = {}): WalkableResult {
  const nativeWidth = options.nativeWidth ?? 512;
  const nativeHeight = options.nativeHeight ?? 512;
  const scale = options.pixelScale ?? 4;
  const cellSize = options.cellSize ?? 16;
  const threshold = options.threshold ?? 128;
  const cols = Math.floor((nativeWidth * scale) / cellSize);
  const rows = Math.floor((nativeHeight * scale) / cellSize);
  const nativeCell = cellSize / scale;
  const walk = (gx: number, gy: number) => {
    const nx = gx * nativeCell + nativeCell / 2;
    const ny = gy * nativeCell + nativeCell / 2;
    const mx = Math.min(mask.width - 1, Math.floor((nx * mask.width) / nativeWidth));
    const my = Math.min(mask.height - 1, Math.floor((ny * mask.height) / nativeHeight));
    const at = (my * mask.width + mx) * 4;
    const value = options.channel === 'alpha'
      ? mask.data[at + 3]
      : mask.data[at + 3] === 0 ? 0 : 0.299 * mask.data[at] + 0.587 * mask.data[at + 1] + 0.114 * mask.data[at + 2];
    const open = value >= threshold;
    return options.invert ? !open : open;
  };
  const cells: boolean[][] = [];
  let minCol = cols, minRow = rows, maxCol = -1, maxRow = -1, count = 0;
  const data: string[] = [];
  for (let gy = 0; gy < rows; gy++) {
    const row: boolean[] = [];
    let text = '';
    for (let gx = 0; gx < cols; gx++) {
      const open = walk(gx, gy);
      row.push(open);
      text += open ? '1' : '0';
      if (open) {
        count++;
        if (gx < minCol) minCol = gx;
        if (gx > maxCol) maxCol = gx;
        if (gy < minRow) minRow = gy;
        if (gy > maxRow) maxRow = gy;
      }
    }
    cells.push(row);
    data.push(text);
  }
  if (count === 0) throw new Error('The mask has no walkable cell (white = walkable; use invert if it is the other way round).');
  const walkableArea = {
    x: minCol * cellSize, y: minRow * cellSize,
    width: (maxCol - minCol + 1) * cellSize, height: (maxRow - minRow + 1) * cellSize,
  };
  // Blocked runs per row inside the rectangle, merged downwards while the run repeats exactly.
  const obstacles: { x: number; y: number; width: number; height: number }[] = [];
  const open = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (let gy = minRow; gy <= maxRow + 1; gy++) {
    const runs = new Set<string>();
    if (gy <= maxRow) {
      let gx = minCol;
      while (gx <= maxCol) {
        if (cells[gy][gx]) { gx++; continue; }
        const start = gx;
        while (gx <= maxCol && !cells[gy][gx]) gx++;
        runs.add(`${start}:${gx - start}`);
      }
    }
    for (const [key, rect] of open) {
      if (!runs.has(key)) {
        obstacles.push(rect);
        open.delete(key);
      } else {
        rect.height += cellSize;
        runs.delete(key);
      }
    }
    for (const key of runs) {
      const [start, length] = key.split(':').map(Number);
      open.set(key, { x: start * cellSize, y: gy * cellSize, width: length * cellSize, height: cellSize });
    }
  }
  return { walkGrid: { cellSize, cols, rows, data }, walkableArea, navigationObstacles: obstacles, walkableCells: count };
}

/** The map with walkable cells tinted green and blocked cells red, for Claude to check the grid by eye. */
export function walkOverlay(picture: Rgba, grid: WalkGrid, nativeWidth = 512, nativeHeight = 512): Rgba {
  const out = clone(picture);
  const cellW = picture.width / grid.cols;
  const cellH = picture.height / grid.rows;
  for (let y = 0; y < picture.height; y++) {
    const gy = Math.min(grid.rows - 1, Math.floor(y / cellH));
    for (let x = 0; x < picture.width; x++) {
      const gx = Math.min(grid.cols - 1, Math.floor(x / cellW));
      const at = (y * picture.width + x) * 4;
      const walkable = grid.data[gy][gx] === '1';
      const tint = walkable ? [40, 220, 90] : [230, 40, 40];
      const k = walkable ? 0.35 : 0.22;
      for (let c = 0; c < 3; c++) out.data[at + c] = Math.round(out.data[at + c] * (1 - k) + tint[c] * k);
      out.data[at + 3] = 255;
    }
  }
  void nativeWidth; void nativeHeight;
  return out;
}
