/** Raw RGBA pictures on top of sharp: load, save (PNG or lossless WebP), crop, nearest resize, compositing. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export interface Rgba {
  width: number;
  height: number;
  /** width * height * 4 bytes, row-major RGBA. */
  data: Buffer;
}

export function blank(width: number, height: number, rgba: [number, number, number, number] = [0, 0, 0, 0]): Rgba {
  const data = Buffer.alloc(width * height * 4);
  if (rgba.some((value) => value !== 0)) {
    for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  }
  return { width, height, data };
}

export function clone(image: Rgba): Rgba {
  return { width: image.width, height: image.height, data: Buffer.from(image.data) };
}

export async function loadRgba(input: string | Buffer): Promise<Rgba> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error(`Expected 4 channels, got ${info.channels}.`);
  return { width: info.width, height: info.height, data };
}

export type OutputFormat = 'png' | 'webp';

export function formatOf(file: string): OutputFormat {
  return path.extname(file).toLowerCase() === '.webp' ? 'webp' : 'png';
}

/** Encodes losslessly: pixel art must keep every pixel. Fully transparent pixels keep their RGB (PNG) as given. */
export async function encode(image: Rgba, format: OutputFormat, options: { opaque?: boolean } = {}): Promise<Buffer> {
  let pipeline = sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } });
  if (options.opaque) pipeline = pipeline.removeAlpha();
  return format === 'webp'
    ? pipeline.webp({ lossless: true, effort: 6, exact: true }).toBuffer()
    : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

/** Writes the picture in the format of the file extension (.webp lossless, otherwise PNG); returns the byte size. */
export async function saveRgba(image: Rgba, file: string, options: { opaque?: boolean } = {}): Promise<number> {
  mkdirSync(path.dirname(file), { recursive: true });
  const bytes = await encode(image, formatOf(file), options);
  writeFileSync(file, bytes);
  return bytes.length;
}

export function crop(image: Rgba, x: number, y: number, width: number, height: number): Rgba {
  const out = blank(width, height);
  for (let row = 0; row < height; row++) {
    const sy = y + row;
    if (sy < 0 || sy >= image.height) continue;
    for (let col = 0; col < width; col++) {
      const sx = x + col;
      if (sx < 0 || sx >= image.width) continue;
      image.data.copy(out.data, (row * width + col) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
    }
  }
  return out;
}

/** Nearest-neighbour scaling, the only scaling allowed for pixel art. */
export function resizeNearest(image: Rgba, width: number, height: number): Rgba {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      image.data.copy(out.data, (y * width + x) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
    }
  }
  return out;
}

export function flipHorizontal(image: Rgba): Rgba {
  const out = blank(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      image.data.copy(out.data, (y * image.width + (image.width - 1 - x)) * 4, (y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
    }
  }
  return out;
}

/** Porter-Duff "over" (straight alpha), like PIL's alpha_composite at an integer offset. */
export function alphaComposite(base: Rgba, top: Rgba, offsetX = 0, offsetY = 0): void {
  for (let y = 0; y < top.height; y++) {
    const by = y + offsetY;
    if (by < 0 || by >= base.height) continue;
    for (let x = 0; x < top.width; x++) {
      const bx = x + offsetX;
      if (bx < 0 || bx >= base.width) continue;
      const t = (y * top.width + x) * 4;
      const ta = top.data[t + 3] / 255;
      if (ta === 0) continue;
      const b = (by * base.width + bx) * 4;
      const ba = base.data[b + 3] / 255;
      const outA = ta + ba * (1 - ta);
      for (let c = 0; c < 3; c++) {
        const value = (top.data[t + c] * ta + base.data[b + c] * ba * (1 - ta)) / outA;
        base.data[b + c] = Math.max(0, Math.min(255, Math.round(value)));
      }
      base.data[b + 3] = Math.round(outA * 255);
    }
  }
}

/** Bounding box of pixels with alpha above the threshold, or null when the picture is empty. */
export function opaqueBounds(image: Rgba, threshold = 0): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = image.width, y0 = image.height, x1 = -1, y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function countColors(image: Rgba): number {
  const seen = new Set<number>();
  for (let i = 0; i < image.width * image.height; i++) {
    if (image.data[i * 4 + 3] === 0) continue;
    seen.add(image.data.readUInt32BE(i * 4));
  }
  return seen.size;
}

export function hasTransparency(image: Rgba): boolean {
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i] < 255) return true;
  return false;
}

/** Side by side "before | after" picture (scaled to the same height) for Claude to look at. */
export function sideBySide(left: Rgba, right: Rgba, gap = 8, background: [number, number, number, number] = [24, 24, 32, 255]): Rgba {
  const height = Math.max(left.height, right.height);
  const out = blank(left.width + gap + right.width, height, background);
  alphaComposite(out, left, 0, Math.floor((height - left.height) / 2));
  alphaComposite(out, right, left.width + gap, Math.floor((height - right.height) / 2));
  return out;
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
