/**
 * Free variants of library pictures (0 PixelLab credits), ported from the Python prototype
 * (Claude outputs/vu-an-claude/tham-khao/variant.py) on raw pixels. They change light, colour, season and props,
 * never the shape of a place: a new floor, room shape or door needs PixelLab.
 */
import sharp from 'sharp';
import { medianCut } from './quantize.js';
import { alphaComposite, blank, clone, flipHorizontal, resizeNearest, type Rgba } from './raster.js';

export interface Light { x: number; y: number; r: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

const clip255 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);
const toByte = (value: number) => Math.trunc(clip255(value)); // numpy astype('uint8') after clip: truncation

function luminanceMean(data: Buffer, at: number): number {
  return (data[at] + data[at + 1] + data[at + 2]) / 3;
}

async function gaussianBlurGray(values: Float64Array, width: number, height: number, sigma: number): Promise<Float64Array> {
  const bytes = Buffer.alloc(width * height);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.trunc(clip255(values[i] * 255));
  const blurred = await sharp(bytes, { raw: { width, height, channels: 1 } }).blur(sigma).raw().toBuffer();
  const out = new Float64Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = blurred[i] / 255;
  return out;
}

/** Re-applies the original alpha after colour maths and median-cut quantisation (Pillow: quantize then putalpha). */
function quantizeKeepAlpha(image: Rgba, palette: number, alpha: Buffer): Rgba {
  const quantized = palette > 0 ? medianCut(image, palette) : clone(image);
  for (let i = 0; i < quantized.width * quantized.height; i++) quantized.data[i * 4 + 3] = alpha[i];
  return quantized;
}

function alphaOf(image: Rgba): Buffer {
  const alpha = Buffer.alloc(image.width * image.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = image.data[i * 4 + 3];
  return alpha;
}

// ------------------------------------------------------------------------------------------------ night

export interface NightParams {
  lights?: Light[];
  windows?: Rect[];
  tint?: [number, number, number];
  palette?: number;
}

/** Dark blue night, warm lit windows, glow and a pool of light under each lamp head, ~96 colours. */
export async function night(source: Rgba, params: NightParams = {}): Promise<Rgba> {
  const { width: W, height: H, data } = source;
  const tint = params.tint ?? [0.30, 0.36, 0.58];
  const out = new Float64Array(W * H * 3);
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = data[i * 4 + c] * tint[c];
  const lit = new Float64Array(W * H);
  for (const win of params.windows ?? []) {
    const x0 = Math.max(0, win.x0), y0 = Math.max(0, win.y0), x1 = Math.min(W, win.x1), y1 = Math.min(H, win.y1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        const lum = luminanceMean(data, i * 4);
        if (lum > 95) {
          out[i * 3] = 255;
          out[i * 3 + 1] = clip255(180 + lum * 0.25);
          out[i * 3 + 2] = clip255(90 + lum * 0.15);
          lit[i] = Math.max(lit[i], 0.55);
        }
      }
    }
  }
  const glow = new Float64Array(W * H);
  for (const light of params.lights ?? []) {
    const { x: lx, y: ly, r } = light;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = Math.sqrt((x - lx) ** 2 + (y - ly) ** 2);
        const halo = Math.max(0, Math.min(1, 1 - d / r)) ** 1.6;
        if (halo > glow[i]) glow[i] = halo;
        const pool = Math.sqrt(((x - lx) / (r * 1.1)) ** 2 + ((y - (ly + r * 0.9)) / (r * 0.55)) ** 2);
        const poolGlow = Math.max(0, Math.min(1, 1 - pool)) ** 1.4 * 0.7;
        if (poolGlow > glow[i]) glow[i] = poolGlow;
        if (Math.abs(x - lx) <= 2 && Math.abs(y - ly) <= 3) {
          out[i * 3] = 255;
          out[i * 3 + 1] = 226;
          out[i * 3 + 2] = 150;
        }
      }
    }
  }
  const windowGlow = (params.windows?.length ?? 0) > 0 ? await gaussianBlurGray(lit, W, H, 5) : new Float64Array(W * H);
  const warm = [1.0, 0.82, 0.55];
  const result = blank(W, H);
  for (let i = 0; i < W * H; i++) {
    const g = Math.max(glow[i], windowGlow[i] * 0.8);
    for (let c = 0; c < 3; c++) {
      const value = out[i * 3 + c] * (1 - g * 0.15) + data[i * 4 + c] * warm[c] * g * 0.95;
      result.data[i * 4 + c] = toByte(value);
    }
    result.data[i * 4 + 3] = data[i * 4 + 3];
  }
  return quantizeKeepAlpha(result, params.palette ?? 96, alphaOf(source));
}

// ------------------------------------------------------------------------------------------------ dusk

export interface DuskParams {
  /** 0..1, how strong the orange/purple grade is (default 0.85). */
  strength?: number;
  /** Shadow length in pixels, cast toward the east and slightly south (default 6). */
  shadowLength?: number;
  lights?: Light[];
  windows?: Rect[];
  palette?: number;
}

/** Orange highlights, purple shadows, longer shadows; optional lamps and windows already lit (night params). */
export async function dusk(source: Rgba, params: DuskParams = {}): Promise<Rgba> {
  const { width: W, height: H, data } = source;
  const strength = params.strength ?? 0.85;
  const length = Math.max(0, Math.round(params.shadowLength ?? 6));
  const lum = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  // Existing shadows (darker than their surroundings) are stretched along the low sun's direction.
  const shadow = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const around = (lum[i - 1] + lum[i + 1] + lum[i - W] + lum[i + W]) / 4;
      if (data[i * 4 + 3] > 0 && lum[i] < 90 && lum[i] < around - 12) shadow[i] = 1;
    }
  }
  const stretched = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (shadow[y * W + x]) continue;
      for (let k = 1; k <= length; k++) {
        const sx = x - k, sy = y - Math.round(k / 2);
        if (sx < 0 || sy < 0) break;
        if (shadow[sy * W + sx]) { stretched[y * W + x] = 1; break; }
      }
    }
  }
  const purple = [0.62, 0.52, 0.86];
  const orange = [1.18, 0.86, 0.6];
  const graded = blank(W, H);
  for (let i = 0; i < W * H; i++) {
    const t = Math.min(1, lum[i] / 200);
    for (let c = 0; c < 3; c++) {
      const mul = purple[c] + (orange[c] - purple[c]) * t;
      let value = data[i * 4 + c] * (1 - strength + strength * mul);
      if (stretched[i]) value *= 0.72;
      graded.data[i * 4 + c] = toByte(value);
    }
    graded.data[i * 4 + 3] = data[i * 4 + 3];
  }
  if ((params.lights?.length ?? 0) > 0 || (params.windows?.length ?? 0) > 0) {
    // Lamps already burning at dusk: the night lighting on top of the graded picture, at a lower tint.
    return night(graded, { lights: params.lights, windows: params.windows, tint: [0.92, 0.88, 0.92], palette: params.palette ?? 96 });
  }
  return quantizeKeepAlpha(graded, params.palette ?? 96, alphaOf(source));
}

// ------------------------------------------------------------------------------------------------ snow

export interface SnowParams {
  /** 0..1 share of flat surfaces covered (default 0.8). */
  amount?: number;
  palette?: number;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16);

/**
 * Snow on the surfaces seen from above in these maps: grey ground, stone, slate roofs and ledges (low saturation)
 * get covered; coloured walls (brick, wood), grass and water keep their colour under a cool winter tint; dark
 * outlines and strong edges stay. Full cover where the surface is clearly grey, a 4x4 Bayer dither only on the
 * borders, and the stone pattern shows faintly through the snow, so the result stays pixel art.
 */
export async function snow(source: Rgba, params: SnowParams = {}): Promise<Rgba> {
  const { width: W, height: H, data } = source;
  const amount = Math.max(0, Math.min(1, params.amount ?? 0.8));
  const lum = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const out = blank(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const at = i * 4;
      const r0 = data[at], g0 = data[at + 1], b0 = data[at + 2];
      out.data[at + 3] = data[at + 3];
      // Cool, slightly dim winter light everywhere.
      out.data[at] = toByte(r0 * 0.88); out.data[at + 1] = toByte(g0 * 0.93); out.data[at + 2] = toByte(Math.min(255, b0 * 1.05 + 8));
      if (data[at + 3] === 0 || x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
      if (lum[i] < 55) continue; // outlines
      const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const water = b0 > r0 + 25 && b0 >= g0 && saturation > 0.2;
      if (water) continue;
      const edge = Math.abs(lum[i] - lum[i - 1]) + Math.abs(lum[i] - lum[i + 1]) + Math.abs(lum[i] - lum[i - W]) + Math.abs(lum[i] - lum[i + W]);
      if (edge > 110) continue;
      const grey = Math.max(0, 1 - saturation / 0.3);
      const bright = Math.max(0, Math.min(1, (lum[i] - 55) / 110));
      // Snow piles on the top edge of a surface (right under a dark outline) even on coloured parts.
      const cap = lum[i - W] < 55 && lum[i - 2 * W] < 55 ? 0.6 : lum[i - W] < 55 ? 0.45 : 0;
      const cover = Math.min(1, amount * (grey * (0.55 + 0.45 * bright) + cap) * (1 - Math.min(1, edge / 160)));
      const threshold = BAYER4[(y % 4) * 4 + (x % 4)];
      const covered = cover >= 0.62 || (cover > 0.3 && (cover - 0.3) / 0.32 > threshold);
      if (!covered) continue;
      // Keep a little of the surface pattern: brighter stones stay a touch brighter under the snow.
      const around = (lum[i - 1] + lum[i + 1] + lum[i - W] + lum[i + W]) / 4;
      const shade = Math.round(234 + Math.max(-14, Math.min(10, (lum[i] - around) * 0.35)));
      out.data[at] = toByte(shade - 4); out.data[at + 1] = toByte(shade); out.data[at + 2] = toByte(Math.min(255, shade + 12));
    }
  }
  return quantizeKeepAlpha(out, params.palette ?? 96, alphaOf(source));
}

// ------------------------------------------------------------------------------------------------ after rain

export interface AfterRainParams {
  /** Lamp heads whose light streaks down the wet ground (same coordinates as night). */
  lights?: Light[];
  /** Puddles as ellipses (centre and radii). */
  puddles?: { x: number; y: number; rx: number; ry: number }[];
  /** Overall darkening (default 0.86). */
  darken?: number;
  palette?: number;
}

/** Slightly darker and cooler, light streaks under lamps (as in the sample case), reflective puddles. */
export async function afterRain(source: Rgba, params: AfterRainParams = {}): Promise<Rgba> {
  const { width: W, height: H, data } = source;
  const darken = params.darken ?? 0.86;
  const out = blank(W, H);
  for (let i = 0; i < W * H; i++) {
    out.data[i * 4] = toByte(data[i * 4] * darken * 0.96);
    out.data[i * 4 + 1] = toByte(data[i * 4 + 1] * darken);
    out.data[i * 4 + 2] = toByte(data[i * 4 + 2] * darken * 1.06);
    out.data[i * 4 + 3] = data[i * 4 + 3];
  }
  for (const puddle of params.puddles ?? []) {
    for (let y = Math.max(0, puddle.y - puddle.ry); y <= Math.min(H - 1, puddle.y + puddle.ry); y++) {
      for (let x = Math.max(0, puddle.x - puddle.rx); x <= Math.min(W - 1, puddle.x + puddle.rx); x++) {
        const d = ((x - puddle.x) / puddle.rx) ** 2 + ((y - puddle.y) / puddle.ry) ** 2;
        if (d > 1) continue;
        const at = (y * W + x) * 4;
        // A puddle mirrors what stands above it, tinted like the sky, with a lighter rim.
        const my = Math.max(0, puddle.y - puddle.ry - (y - (puddle.y - puddle.ry)));
        const src = (my * W + x) * 4;
        const rim = d > 0.72 ? 1 : 0;
        const sky = [150, 168, 196];
        for (let c = 0; c < 3; c++) {
          const mirrored = data[src + c] * darken * 0.7;
          out.data[at + c] = toByte(mirrored * 0.35 + sky[c] * 0.65 + rim * 28);
        }
      }
    }
  }
  for (const light of params.lights ?? []) {
    for (let yy = light.y + 8; yy < Math.min(H - 1, light.y + 44); yy++) {
      for (let xx = light.x - 2; xx <= light.x + 2; xx++) {
        if (xx < 0 || xx >= W) continue;
        const k = 0.55 * (1 - (yy - light.y - 8) / 36);
        if ((yy + xx) % 3 !== 0) continue;
        const at = (yy * W + xx) * 4;
        const warm = [255, 200, 120];
        for (let c = 0; c < 3; c++) out.data[at + c] = toByte(out.data[at + c] * (1 - k) + warm[c] * k);
      }
    }
  }
  return quantizeKeepAlpha(out, params.palette ?? 96, alphaOf(source));
}

// ------------------------------------------------------------------------------------------------ mirror

export interface Box { x: number; y: number; width: number; height: number }

export interface MirrorParams {
  /** Hotspots / placements in the picture's own pixels, flipped with it. */
  boxes?: Box[];
  points?: { x: number; y: number }[];
  /**
   * Coordinates given in runtime units (for example 2048 for a 512 picture at pixelScale 4): set the runtime width so
   * boxes and points flip around the runtime width instead of the picture width.
   */
  coordinateWidth?: number;
}

export interface MirrorResult {
  image: Rgba;
  boxes: Box[];
  points: { x: number; y: number }[];
}

/** Flips left to right; hotspots and points flip with it (x' = W - x - width), a mask is flipped the same way. */
export function mirror(source: Rgba, params: MirrorParams = {}): MirrorResult {
  const width = params.coordinateWidth ?? source.width;
  return {
    image: flipHorizontal(source),
    boxes: (params.boxes ?? []).map((box) => ({ ...box, x: width - box.x - box.width })),
    points: (params.points ?? []).map((point) => ({ ...point, x: width - point.x })),
  };
}

// ------------------------------------------------------------------------------------------------ recolor (Pillow HSV)

/** Pillow's RGB -> HSV (bytes), Convert.c rgb2hsv, with its float32 intermediates (Math.fround). */
export function rgbToHsvPil(r: number, g: number, b: number): [number, number, number] {
  const f = Math.fround;
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  if (minc === maxc) return [0, 0, maxc];
  const cr = f(maxc - minc);
  const s = f(cr / f(maxc));
  const rc = f(f(maxc - r) / cr), gc = f(f(maxc - g) / cr), bc = f(f(maxc - b) / cr);
  let h: number;
  if (r === maxc) h = f(bc - gc);
  else if (g === maxc) h = f(2.0 + rc - bc);
  else h = f(4.0 + gc - rc);
  h = f((h / 6.0 + 1.0) % 1.0);
  const clip8 = (v: number) => Math.max(0, Math.min(255, v));
  return [clip8(Math.trunc(h * 255.0)), clip8(Math.trunc(s * 255.0)), maxc];
}

/** Pillow's HSV -> RGB (bytes), Convert.c hsv2rgb, with its float32 intermediates. */
export function hsvToRgbPil(h: number, s: number, v: number): [number, number, number] {
  if (s === 0) return [v, v, v];
  const f32 = Math.fround;
  const i = Math.floor((f32(h) * 6.0) / 255.0);
  const fr = f32((f32(h) * 6.0) / 255.0 - i);
  const fs = f32(f32(s) / 255.0);
  const clip8 = (value: number) => Math.max(0, Math.min(255, value));
  const cRound = (value: number) => Math.sign(value) * Math.round(Math.abs(value));
  const p = clip8(cRound(f32(v) * (1.0 - fs)));
  const q = clip8(cRound(f32(v) * (1.0 - fs * fr)));
  const t = clip8(cRound(f32(v) * (1.0 - fs * (1.0 - fr))));
  switch (((i % 6) + 6) % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

export interface RecolorParams {
  /** Hue band to replace, in degrees 0-360 (inclusive). */
  hueFrom: [number, number];
  /** New hue in degrees. */
  hueTo: number;
  satMul?: number;
  /** Pixels less saturated than this (0-255) keep their colour: greys, outlines, wood. */
  minSat?: number;
  /** Only inside this rectangle (default: the whole picture). */
  region?: Rect;
}

/** Moves one hue band to another (for example moss-green wallpaper 100-200 degrees to oxblood 350). */
export function recolor(source: Rgba, params: RecolorParams): { image: Rgba; changed: number } {
  const { width: W, height: H, data } = source;
  const satMul = params.satMul ?? 1.25;
  const minSat = params.minSat ?? 20;
  const [from, to] = params.hueFrom;
  const region = params.region ?? { x0: 0, y0: 0, x1: W, y1: H };
  const newHue = Math.trunc((params.hueTo * 255) / 360);
  const out = clone(source);
  let changed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = (y * W + x) * 4;
      let [h, s, v] = rgbToHsvPil(data[at], data[at + 1], data[at + 2]);
      const hueDeg = (h * 360) / 255;
      const inside = x >= region.x0 && x < region.x1 && y >= region.y0 && y < region.y1;
      if (inside && hueDeg >= from && hueDeg <= to && s >= minSat && data[at + 3] > 0) {
        h = newHue;
        s = Math.trunc(Math.min(255, Math.max(0, s * satMul)));
        changed++;
      }
      const [r, g, b] = hsvToRgbPil(h, s, v);
      out.data[at] = r; out.data[at + 1] = g; out.data[at + 2] = b;
    }
  }
  return { image: out, changed };
}

// ------------------------------------------------------------------------------------------------ compose

export interface ComposeItem {
  image: Rgba;
  /** Bottom-centre anchor in the picture's pixels. */
  x: number;
  y: number;
  scale?: number;
  flip?: boolean;
  shadow?: boolean;
}

/**
 * Fills a rectangle from its surroundings: each row is interpolated between the pixels just left and right of the
 * rectangle (good for removing a prop from a wall or floor, or gibberish lettering on paper).
 */
export function inpaintRect(image: Rgba, rect: Rect): void {
  const { width: W, height: H, data } = image;
  const x0 = Math.max(0, rect.x0), x1 = Math.min(W - 1, rect.x1);
  const y0 = Math.max(0, rect.y0), y1 = Math.min(H - 1, rect.y1);
  for (let y = y0; y <= y1; y++) {
    const left = Math.max(0, x0 - 1), right = Math.min(W - 1, x1 + 1);
    const la = (y * W + left) * 4, ra = (y * W + right) * 4;
    for (let x = x0; x <= x1; x++) {
      const t = right === left ? 0 : (x - left) / (right - left);
      const at = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) data[at + c] = Math.round(data[la + c] * (1 - t) + data[ra + c] * t);
    }
  }
}

/** Adds props from the library with a simple soft shadow, and removes others (inpaint). */
export function compose(source: Rgba, params: { add?: ComposeItem[]; remove?: Rect[] }): Rgba {
  const out = clone(source);
  for (const rect of params.remove ?? []) inpaintRect(out, rect);
  for (const item of params.add ?? []) {
    let prop = item.image;
    const scale = item.scale ?? 1;
    if (scale !== 1) prop = resizeNearest(prop, Math.max(1, Math.round(prop.width * scale)), Math.max(1, Math.round(prop.height * scale)));
    if (item.flip) prop = flipHorizontal(prop);
    // Feet of the prop: lowest opaque row.
    let feet = prop.height - 1;
    outer: for (let y = prop.height - 1; y >= 0; y--) {
      for (let x = 0; x < prop.width; x++) if (prop.data[(y * prop.width + x) * 4 + 3] > 0) { feet = y; break outer; }
    }
    const left = Math.round(item.x - prop.width / 2);
    const top = Math.round(item.y - feet);
    if (item.shadow !== false) {
      const rx = Math.max(3, Math.round(prop.width * 0.38)), ry = Math.max(2, Math.round(prop.width * 0.12));
      for (let y = -ry; y <= ry; y++) {
        for (let x = -rx; x <= rx; x++) {
          const d = (x / rx) ** 2 + (y / ry) ** 2;
          if (d > 1) continue;
          const px = Math.round(item.x + x), py = Math.round(item.y + y);
          if (px < 0 || py < 0 || px >= out.width || py >= out.height) continue;
          const at = (py * out.width + px) * 4;
          const k = 0.35 * (1 - d * 0.5);
          for (let c = 0; c < 3; c++) out.data[at + c] = Math.round(out.data[at + c] * (1 - k));
        }
      }
    }
    alphaComposite(out, prop, left, top);
  }
  return out;
}

export const VARIANT_TYPES = ['night', 'dusk', 'snow', 'after_rain', 'mirror', 'recolor', 'compose'] as const;
export type VariantType = (typeof VARIANT_TYPES)[number];
