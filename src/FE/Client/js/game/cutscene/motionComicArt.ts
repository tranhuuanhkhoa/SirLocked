/* Draws one comic panel from a pixel-art image: crop to the focus area, slow push-in, halftone, mood and weather. */
import type { ComicArt, ComicAssets } from './motionComicModel.js';

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Same-origin image URL, or '' for anything else. The art only ever comes from the case's own pixel assets. */
export function safeImageUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function artUrl(art: ComicArt, assets: ComicAssets): string {
  const ref = art.kind === 'scene' ? assets.scenes[art.id] : art.kind === 'character' ? assets.characters[art.id] : art.kind === 'item' ? assets.items[art.id] : undefined;
  return safeImageUrl(art.kind === 'cover' ? assets.coverUrl : ref?.url);
}

export function artTitle(art: ComicArt, assets: ComicAssets): string {
  const ref = art.kind === 'scene' ? assets.scenes[art.id] : art.kind === 'character' ? assets.characters[art.id] : art.kind === 'item' ? assets.items[art.id] : undefined;
  return ref?.title ?? '';
}

/** Loads every image once. A failed or slow image becomes `null`; the panel then draws a paper placeholder. */
export function loadImages(urls: string[], timeoutMs = 8000): Promise<Map<string, HTMLImageElement | null>> {
  const result = new Map<string, HTMLImageElement | null>();
  return Promise.all([...new Set(urls.filter(Boolean))].map((url) => new Promise<void>((resolve) => {
    const img = new Image();
    const done = (ok: boolean) => { result.set(url, ok && img.naturalWidth > 0 ? img : null); resolve(); };
    const timer = window.setTimeout(() => done(false), timeoutMs);
    img.onload = () => { window.clearTimeout(timer); done(true); };
    img.onerror = () => { window.clearTimeout(timer); done(false); };
    img.decoding = 'async';
    img.src = url;
  }))).then(() => result);
}

const MOOD_TINT: Record<string, [string, number]> = {
  'rain-night': ['rgba(40,60,110,', 0.32], 'storm-night': ['rgba(25,35,80,', 0.4], 'fog-morning': ['rgba(190,205,225,', 0.2],
  'warm-dusk': ['rgba(220,120,50,', 0.24], 'neon-night': ['rgba(120,40,110,', 0.28], 'clear-day': ['rgba(255,235,190,', 0.1],
  'candle-dark': ['rgba(120,60,20,', 0.34],
};

export type ArtFrame = { t: number; A: number; weather: string; mood: string; flash: number; reduced: boolean; seed: number };

let halftone: CanvasPattern | null = null;
function halftonePattern(g: CanvasRenderingContext2D) {
  if (halftone) return halftone;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const x = c.getContext('2d')!; x.fillStyle = 'rgba(0,0,0,0.5)';
  for (const [a, b] of [[0.25, 0.25], [0.75, 0.75]]) { x.beginPath(); x.arc(a * 16, b * 16, 2.4, 0, TAU); x.fill(); }
  halftone = g.createPattern(c, 'repeat');
  return halftone;
}

function rain(g: CanvasRenderingContext2D, w: number, h: number, A: number, seed: number) {
  const r = mulberry(seed), H = h + 200, tx = 0.18;
  g.beginPath();
  for (let i = 0; i < 150; i++) {
    const x0 = -w * 0.2 + r() * w * 1.4, y0 = r() * H, l = 14 + r() * 30, s = 520 + r() * 520;
    const y = ((y0 + A * s) % H) - 100, x = x0 + (y + 100) * tx;
    g.moveTo(x, y); g.lineTo(x + l * tx, y + l);
  }
  g.strokeStyle = 'rgba(205,220,240,0.32)'; g.lineWidth = 1.6; g.lineCap = 'round'; g.stroke();
}

function fog(g: CanvasRenderingContext2D, w: number, h: number, A: number, seed: number) {
  const r = mulberry(seed);
  for (let i = 0; i < 7; i++) {
    const sp = 6 + r() * 10, span = w + 500, cx = ((r() * span + A * sp) % span) - 250, cy = h * (0.3 + r() * 0.7);
    const rx = 180 + r() * 260, ry = 40 + r() * 60;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
    gr.addColorStop(0, 'rgba(205,215,230,0.26)'); gr.addColorStop(1, 'rgba(205,215,230,0)');
    g.save(); g.translate(cx, cy); g.scale(1, ry / rx); g.translate(-cx, -cy); g.fillStyle = gr; g.fillRect(cx - rx, cy - rx, rx * 2, rx * 2); g.restore();
  }
}

function drawWeather(g: CanvasRenderingContext2D, w: number, h: number, f: ArtFrame) {
  switch (f.weather) {
    case 'rain': rain(g, w, h, f.reduced ? 0 : f.A, f.seed); break;
    case 'fog': fog(g, w, h, f.reduced ? 0 : f.A, f.seed); break;
    case 'streetlight': {
      const gr = g.createRadialGradient(w * 0.22, h * 0.08, 0, w * 0.22, h * 0.08, Math.max(w, h) * 0.8);
      gr.addColorStop(0, 'rgba(255,196,110,0.5)'); gr.addColorStop(1, 'rgba(255,196,110,0)');
      g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore();
      break;
    }
    case 'sunrise': {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,170,80,0.42)'); gr.addColorStop(0.6, 'rgba(255,200,130,0.1)'); gr.addColorStop(1, 'rgba(255,200,130,0)');
      g.save(); g.globalCompositeOperation = 'screen'; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore();
      break;
    }
    case 'night':
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(45,65,120,0.55)'; g.fillRect(0, 0, w, h); g.restore();
      break;
    default: break;
  }
}

/** Paper card shown while an image is missing, so a broken file never leaves a blank or hanging panel. */
function placeholder(g: CanvasRenderingContext2D, w: number, h: number, label: string, font: string) {
  g.fillStyle = '#1A1A22'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(228,219,198,0.08)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(228,219,198,0.28)'; g.lineWidth = 3; g.strokeRect(14, 14, w - 28, h - 28);
  if (label) {
    g.fillStyle = 'rgba(228,219,198,0.8)'; g.font = `${Math.max(22, Math.min(56, w * 0.06))}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2, w - 60); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }
}

/**
 * Paints the panel art into the box (0,0,w,h), which the caller has already clipped. `progress` is the time since
 * the reveal in seconds; it drives the slow push-in (none under reduced motion).
 */
export function drawPanelArt(g: CanvasRenderingContext2D, img: HTMLImageElement | null, art: ComicArt, w: number, h: number,
  f: ArtFrame, label: string, labelFont: string) {
  if (!img) { placeholder(g, w, h, label, labelFont); }
  else if (art.kind === 'item' || Math.max(img.naturalWidth, img.naturalHeight) <= 160) {
    // A small sprite (an item): show the whole object, big and sharp, on a dark card instead of cropping into a few blurry pixels.
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const bg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
    bg.addColorStop(0, '#2B2E3B'); bg.addColorStop(1, '#10121A');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const k = Math.max(1, Math.floor(Math.min(w * 0.8 / iw, h * 0.8 / ih))), dw = iw * k, dh = ih * k;
    const dx = Math.round((w - dw) / 2), dy = Math.round((h - dh) / 2) + (f.reduced ? 0 : Math.round(Math.sin(f.A * 1.4) * 3));
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(w / 2, dy + dh + 6, dw * 0.38, 9, 0, 0, TAU); g.fill();
    g.imageSmoothingEnabled = false;
    g.drawImage(img, dx, dy, dw, dh);
  } else {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const [fx, fy, fw, fh] = art.focus.length === 4 ? art.focus : [0, 0, 1, 1];
    const fwPx = Math.max(8, fw * iw), fhPx = Math.max(8, fh * ih);
    const zoom = f.reduced ? 1 : 1 + clamp(f.t / 14, 0, 1) * 0.07;
    let s = Math.max(w / fwPx, h / fhPx) * zoom;
    s = Math.max(s, Math.max(w / iw, h / ih));
    const sw = w / s, sh = h / s;
    const drift = f.reduced ? 0 : Math.sin(f.t * 0.35 + f.seed) * 0.012;
    const cx = fx * iw + fwPx / 2 + drift * iw, cy = fy * ih + fhPx / 2;
    const sx = clamp(cx - sw / 2, 0, Math.max(0, iw - sw)), sy = clamp(cy - sh / 2, 0, Math.max(0, ih - sh));
    g.imageSmoothingEnabled = false; // keep the pixel art crisp
    g.drawImage(img, sx, sy, Math.min(sw, iw), Math.min(sh, ih), 0, 0, w, h);
  }
  const tint = MOOD_TINT[f.mood] ?? MOOD_TINT['rain-night'];
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = tint[0] + tint[1] + ')'; g.fillRect(0, 0, w, h); g.restore();
  drawWeather(g, w, h, f);
  const dots = halftonePattern(g);
  if (dots) { g.save(); g.globalAlpha = 0.16; g.fillStyle = dots; g.fillRect(0, 0, w, h); g.restore(); }
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  if (f.flash > 0.01) { g.fillStyle = `rgba(210,225,255,${Math.min(0.3, f.flash * 0.3)})`; g.fillRect(0, 0, w, h); }
}
