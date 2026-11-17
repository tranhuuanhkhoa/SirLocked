/**
 * Items painted into a pixel scene with PixelLab inpaint (Yen, 17/11/2026: never paste an item picture onto a map).
 * Create objects first: a new scene lists its objects in the PixelLab prompt. To add an object over a finished scene,
 * inpaint it properly: a FREE-FORM mask drawn wide along the whole surface the object rests on (the table top, the
 * seat, the shelf), the description naming everything that should stand on that surface, then copy ONLY the mask back.
 * planInpaint cuts the source canvas and context, inpaintInputs draws the mask, mergeInpaint copies the masked pixels.
 */
import { blank, clone, crop, type Rgba } from './raster.js';
import type { Rect } from './variant.js';

export interface Box { x: number; y: number; width: number; height: number }
export type Point = [number, number];

/** Where PixelLab may repaint, in scene pixels: rectangles (inclusive), polygons, or a painted mask (white = repaint). */
export interface MaskShape { rects?: Rect[]; polygons?: Point[][]; image?: Rgba }

export interface InpaintPlan {
  /** Where the source canvas is cut from the scene (size x size). */
  crop: Box;
  /** Bounding box of the repainted area, in source-canvas pixels. */
  mask: Box;
  /** The surrounding scene for inpaint_image_pro_flash (at most 3x the source), in scene pixels. */
  context: Box;
  /** The source canvas inside the context picture (Pro Flash bounding_box). */
  boundingBox: Box;
}

/**
 * Canvas sizes: 128 and 256 (inpaint_image 10, Pro Flash 6 / 9) and the whole 512 scene for a very wide surface
 * (inpaint_image 25; PixelLab needs a Tier 2 plan above 256).
 */
export const INPAINT_SIZES = [128, 256, 512] as const;
/** Scene pixels kept around the mask so PixelLab sees what surrounds the surface. */
export const INPAINT_MARGIN = 24;
/** Below this the mask hugs one object: PixelLab draws it tiny or smudged. Draw the mask along the whole surface. */
export const TIGHT_MASK = { width: 40, height: 24 } as const;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Generations of one call, from the PixelLab price notes (the canvas sets the price, not the mask). */
export function inpaintCost(tool: 'inpaint_image' | 'inpaint_image_pro_flash', size: number): number {
  if (tool === 'inpaint_image_pro_flash') return size <= 96 ? 5 : size <= 208 ? 6 : 9;
  return size <= 256 ? 10 : size <= 341 ? 15 : 25;
}

function insidePolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Scene-size mask, 1 = repaint. A pixel belongs to a polygon when its centre lies inside it. */
export function sceneMask(width: number, height: number, shape: MaskShape): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (shape.image) {
    if (shape.image.width !== width || shape.image.height !== height) {
      throw new Error(`Ảnh mask ${shape.image.width}x${shape.image.height} phải đúng cỡ cảnh ${width}x${height} (trắng = vẽ lại, đen = giữ).`);
    }
    const data = shape.image.data;
    for (let i = 0; i < width * height; i++) {
      if (data[i * 4 + 3] > 0 && data[i * 4] > 127 && data[i * 4 + 1] > 127 && data[i * 4 + 2] > 127) mask[i] = 1;
    }
  }
  for (const rect of shape.rects ?? []) {
    const x0 = clamp(Math.round(Math.min(rect.x0, rect.x1)), 0, width - 1), x1 = clamp(Math.round(Math.max(rect.x0, rect.x1)), 0, width - 1);
    const y0 = clamp(Math.round(Math.min(rect.y0, rect.y1)), 0, height - 1), y1 = clamp(Math.round(Math.max(rect.y0, rect.y1)), 0, height - 1);
    for (let y = y0; y <= y1; y++) mask.fill(1, y * width + x0, y * width + x1 + 1);
  }
  for (const polygon of shape.polygons ?? []) {
    if (polygon.length < 3) throw new Error('Mỗi polygon cần ít nhất 3 đỉnh [x,y] (pixel native).');
    const xs = polygon.map(([x]) => x), ys = polygon.map(([, y]) => y);
    const x0 = clamp(Math.floor(Math.min(...xs)), 0, width - 1), x1 = clamp(Math.ceil(Math.max(...xs)), 0, width - 1);
    const y0 = clamp(Math.floor(Math.min(...ys)), 0, height - 1), y1 = clamp(Math.ceil(Math.max(...ys)), 0, height - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (insidePolygon(x + 0.5, y + 0.5, polygon)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

export function maskBounds(mask: Uint8Array, width: number): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width, y = Math.floor(i / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** True when the mask hugs a single object instead of covering the surface it rests on. */
export const isTightMask = (bounds: Box) => bounds.width < TIGHT_MASK.width || bounds.height < TIGHT_MASK.height;

/** rect is inclusive scene pixels [x0..x1] x [y0..y1] (the bounding box of the mask). */
export function planInpaint(sceneWidth: number, sceneHeight: number, rect: Rect, size?: number): InpaintPlan {
  const x0 = clamp(Math.round(Math.min(rect.x0, rect.x1)), 0, sceneWidth - 1);
  const x1 = clamp(Math.round(Math.max(rect.x0, rect.x1)), 0, sceneWidth - 1);
  const y0 = clamp(Math.round(Math.min(rect.y0, rect.y1)), 0, sceneHeight - 1);
  const y1 = clamp(Math.round(Math.max(rect.y0, rect.y1)), 0, sceneHeight - 1);
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  const need = Math.max(width, height) + 2 * INPAINT_MARGIN;
  const canvas = size ?? INPAINT_SIZES.find((candidate) => candidate >= need && candidate <= Math.min(sceneWidth, sceneHeight))
    ?? (Math.max(width, height) <= Math.min(sceneWidth, sceneHeight, 512) ? Math.min(sceneWidth, sceneHeight, 512) : undefined);
  if (!canvas) throw new Error(`Vùng ${width}x${height} quá to cho một lần inpaint: vẽ lại cảnh với vật ghi sẵn trong mô tả.`);
  if (!(INPAINT_SIZES as readonly number[]).includes(canvas)) throw new Error(`size phải là ${INPAINT_SIZES.join(', ')}.`);
  if (canvas > sceneWidth || canvas > sceneHeight) throw new Error(`Cảnh ${sceneWidth}x${sceneHeight} nhỏ hơn khung inpaint ${canvas}.`);
  if (width > canvas || height > canvas) throw new Error(`Vùng ${width}x${height} không lọt khung ${canvas}.`);
  const cropX = clamp(Math.round((x0 + x1 + 1) / 2 - canvas / 2), 0, sceneWidth - canvas);
  const cropY = clamp(Math.round((y0 + y1 + 1) / 2 - canvas / 2), 0, sceneHeight - canvas);
  const contextWidth = Math.min(canvas * 3, sceneWidth), contextHeight = Math.min(canvas * 3, sceneHeight);
  const contextX = clamp(Math.round(cropX + canvas / 2 - contextWidth / 2), 0, sceneWidth - contextWidth);
  const contextY = clamp(Math.round(cropY + canvas / 2 - contextHeight / 2), 0, sceneHeight - contextHeight);
  return {
    crop: { x: cropX, y: cropY, width: canvas, height: canvas },
    mask: { x: x0 - cropX, y: y0 - cropY, width, height },
    context: { x: contextX, y: contextY, width: contextWidth, height: contextHeight },
    boundingBox: { x: cropX - contextX, y: cropY - contextY, width: canvas, height: canvas },
  };
}

/**
 * The pictures to upload: source canvas, its mask (pure white = repaint, black = keep, exactly the canvas size, as
 * PixelLab's mask_image wants) and the context. Without a scene mask the mask is the plan's rectangle.
 */
export function inpaintInputs(scene: Rgba, plan: InpaintPlan, mask?: Uint8Array): { source: Rgba; mask: Rgba; context: Rgba } {
  const source = crop(scene, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height);
  const picture = blank(plan.crop.width, plan.crop.height, [0, 0, 0, 255]);
  for (let y = 0; y < plan.crop.height; y++) {
    for (let x = 0; x < plan.crop.width; x++) {
      const inside = mask
        ? mask[(plan.crop.y + y) * scene.width + plan.crop.x + x] === 1
        : x >= plan.mask.x && x < plan.mask.x + plan.mask.width && y >= plan.mask.y && y < plan.mask.y + plan.mask.height;
      if (inside) picture.data.set([255, 255, 255, 255], (y * picture.width + x) * 4);
    }
  }
  const context = crop(scene, plan.context.x, plan.context.y, plan.context.width, plan.context.height);
  return { source, mask: picture, context };
}

export interface MergeResult {
  image: Rgba;
  /** Mask pixels whose colour changed. */
  changed: number;
  /** Pixels of the PixelLab answer outside the mask that differ from the scene (never copied; a white or transparent rim is normal). */
  ignoredOutside: number;
  /** Scene box of the clearly repainted pixels, or null when PixelLab drew nothing. */
  drawn: Box | null;
}

/**
 * Copies only the masked pixels of the PixelLab answer into the scene: the mask picture (canvas size, white = repaint)
 * when given, else the plan's rectangle. A mask pixel that came back (partly) transparent is laid over the scene pixel
 * instead of punching a hole. Every pixel outside the mask stays byte for byte.
 */
export function mergeInpaint(scene: Rgba, result: Rgba, plan: Pick<InpaintPlan, 'crop' | 'mask'>, maskPicture?: Rgba, strong = 60): MergeResult {
  if (result.width !== plan.crop.width || result.height !== plan.crop.height) {
    throw new Error(`Ảnh PixelLab ${result.width}x${result.height}, khung đã cắt ${plan.crop.width}x${plan.crop.height}: không ghép được.`);
  }
  if (maskPicture && (maskPicture.width !== result.width || maskPicture.height !== result.height)) {
    throw new Error(`Mask ${maskPicture.width}x${maskPicture.height} khác cỡ khung ${result.width}x${result.height}.`);
  }
  const image = clone(scene);
  let changed = 0, ignoredOutside = 0;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const sx = plan.crop.x + x, sy = plan.crop.y + y;
      if (sx < 0 || sy < 0 || sx >= scene.width || sy >= scene.height) continue;
      const r = (y * result.width + x) * 4, s = (sy * scene.width + sx) * 4;
      const inside = maskPicture
        ? maskPicture.data[r] > 127
        : x >= plan.mask.x && x < plan.mask.x + plan.mask.width && y >= plan.mask.y && y < plan.mask.y + plan.mask.height;
      if (!inside) {
        if (result.data.compare(scene.data, s, s + 4, r, r + 4) !== 0) ignoredOutside++;
        continue;
      }
      const alpha = result.data[r + 3] / 255;
      if (alpha === 0) continue;
      const out = [0, 0, 0, 255];
      for (let c = 0; c < 3; c++) out[c] = Math.round(result.data[r + c] * alpha + scene.data[s + c] * (1 - alpha));
      out[3] = Math.max(scene.data[s + 3], result.data[r + 3]);
      const diff = Math.abs(out[0] - scene.data[s]) + Math.abs(out[1] - scene.data[s + 1]) + Math.abs(out[2] - scene.data[s + 2]);
      if (diff > 0 || out[3] !== scene.data[s + 3]) changed++;
      if (diff > strong) {
        minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
      }
      image.data.set(out, s);
    }
  }
  const drawn = maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { image, changed, ignoredOutside, drawn };
}

/**
 * The item placement over a drawn object, in runtime units (native x pixelScale): no picture (asset ""), a box over
 * the object with a little padding, position at the bottom centre of the box (Lo thuoc thu Nam, Tram hong ngoc).
 */
export function paintedPlacement(drawn: Box, pixelScale = 4, pad = 2, sceneSize = 512) {
  const left = Math.max(0, drawn.x - pad), top = Math.max(0, drawn.y - pad);
  const right = Math.min(sceneSize, drawn.x + drawn.width + pad), bottom = Math.min(sceneSize, drawn.y + drawn.height + pad);
  const x = left * pixelScale, y = top * pixelScale;
  const width = (right - left) * pixelScale, height = (bottom - top) * pixelScale;
  return {
    asset: '',
    position: { x: x + width / 2, y: y + height, anchor: 'bottom-center' },
    // The validator caps an item's size at 160x160 (OversizedCutout); the box itself covers the whole object.
    size: { width: Math.min(width, 160), height: Math.min(height, 160) },
    hotspot: { x, y, width, height },
    anchor: 'bottom-center',
  };
}
