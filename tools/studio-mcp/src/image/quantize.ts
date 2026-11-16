/**
 * Median-cut colour reduction, close to Pillow's quantize(method=MEDIANCUT) without dithering: boxes holding the most
 * pixels split first along their widest channel at the pixel median, every box becomes its average colour and each
 * pixel takes the colour of its own box. Keeps the "pixel art" look after the lighting maths of the variants.
 */
import type { Rgba } from './raster.js';

interface Box {
  colors: number[]; // packed 0xRRGGBB
  pixels: number;
}

function channel(color: number, axis: number): number {
  return (color >> (16 - axis * 8)) & 0xff;
}

export function medianCut(image: Rgba, maxColors: number): Rgba {
  const count = new Map<number, number>();
  const total = image.width * image.height;
  for (let i = 0; i < total; i++) {
    const at = i * 4;
    const color = (image.data[at] << 16) | (image.data[at + 1] << 8) | image.data[at + 2];
    count.set(color, (count.get(color) ?? 0) + 1);
  }
  if (count.size <= maxColors) return { width: image.width, height: image.height, data: Buffer.from(image.data) };

  const boxes: Box[] = [{ colors: [...count.keys()], pixels: total }];
  while (boxes.length < maxColors) {
    // The splittable box with the most pixels goes next.
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colors.length < 2) continue;
      if (pick < 0 || boxes[i].pixels > boxes[pick].pixels) pick = i;
    }
    if (pick < 0) break;
    const box = boxes[pick];
    let axis = 0;
    let widest = -1;
    for (let a = 0; a < 3; a++) {
      let min = 255, max = 0;
      for (const color of box.colors) {
        const value = channel(color, a);
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (max - min > widest) {
        widest = max - min;
        axis = a;
      }
    }
    box.colors.sort((left, right) => channel(left, axis) - channel(right, axis) || left - right);
    let running = 0;
    let cut = 1;
    for (let i = 0; i < box.colors.length - 1; i++) {
      running += count.get(box.colors[i])!;
      cut = i + 1;
      if (running * 2 >= box.pixels) break;
    }
    const low = box.colors.slice(0, cut);
    const high = box.colors.slice(cut);
    const lowPixels = low.reduce((sum, color) => sum + count.get(color)!, 0);
    boxes.splice(pick, 1, { colors: low, pixels: lowPixels }, { colors: high, pixels: box.pixels - lowPixels });
  }

  const mapping = new Map<number, [number, number, number]>();
  for (const box of boxes) {
    let r = 0, g = 0, b = 0;
    for (const color of box.colors) {
      const n = count.get(color)!;
      r += channel(color, 0) * n;
      g += channel(color, 1) * n;
      b += channel(color, 2) * n;
    }
    const average: [number, number, number] = [
      Math.round(r / box.pixels), Math.round(g / box.pixels), Math.round(b / box.pixels),
    ];
    for (const color of box.colors) mapping.set(color, average);
  }
  const out = Buffer.from(image.data);
  for (let i = 0; i < total; i++) {
    const at = i * 4;
    const color = (image.data[at] << 16) | (image.data[at + 1] << 8) | image.data[at + 2];
    const mapped = mapping.get(color)!;
    out[at] = mapped[0];
    out[at + 1] = mapped[1];
    out[at + 2] = mapped[2];
  }
  return { width: image.width, height: image.height, data: out };
}
