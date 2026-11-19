/**
 * Small looping previews of a detective outside the game (the lobby's outfit strip and seat cards). They play the
 * idle clip facing the viewer from the very sheets the game draws, so a card shows exactly how the player will look.
 * One animation-frame loop serves every canvas; a canvas that has left the page is dropped at the next tick.
 */
import { PIXEL_PLAYER_SHEETS, type PixelActorSheet, type PixelClip } from './pixelActors.js';
import { PLAYER_SKINS, skinFor } from './playerSkins.js';

/** The look of a detective without an outfit. */
export const NORMAL_LOOK = 'normal';

/** Part of a 128 px cell the preview shows: the whole figure from hat to feet, square. */
const CROP = { x: 8, y: 4, size: 112 };

/** The outfit of this role's detective the player wears (one the game can draw), else NORMAL_LOOK. */
export function lookFor(role: string | null | undefined, skinDefIds: readonly string[] | null | undefined): string {
  return skinFor(role, skinDefIds ?? [])?.defId ?? NORMAL_LOOK;
}

/** The daytime sheet of an outfit of this role, or the role's normal sheet; undefined for a role without pixel sheets. */
export function previewSheet(role: string | null | undefined, look: string | null | undefined): PixelActorSheet | undefined {
  const skin = look && look !== NORMAL_LOOK ? PLAYER_SKINS[look] : undefined;
  if (skin && skin.role === role) return skin.sheets.day;
  return role ? PIXEL_PLAYER_SHEETS[role] : undefined;
}

/** The clip a preview plays: idle facing south, or the south standing frame for a sheet without one. */
function previewClip(sheet: PixelActorSheet): PixelClip {
  const idle = sheet.clips.idle?.south;
  if (idle?.frames.length) return idle;
  const standing = sheet.standing.south;
  return { texture: standing.texture, frames: [standing.frame], fps: 1, loop: true };
}

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${url}`));
      image.src = url;
    });
    // A failed sheet may load on a later visit; do not keep the failure.
    pending.catch(() => images.delete(url));
    images.set(url, pending);
  }
  return pending;
}

type Entry = {
  canvas: HTMLCanvasElement;
  sheet: PixelActorSheet;
  clip: PixelClip;
  columns: number;
  started: number;
  image?: HTMLImageElement;
  drawn: number;
};

export type OutfitAnimator = {
  /** Plays a sheet on a canvas from now on; the canvas is sized to the crop. */
  add(canvas: HTMLCanvasElement, sheet: PixelActorSheet): void;
  /** Forgets every canvas (before a redraw replaces them). */
  clear(): void;
  dispose(): void;
};

export function createOutfitAnimator({ reducedMotion = false }: { reducedMotion?: boolean } = {}): OutfitAnimator {
  let entries: Entry[] = [];
  let frame = 0;
  let disposed = false;

  const paint = (entry: Entry, now: number) => {
    if (!entry.image) return;
    const step = reducedMotion ? 0 : Math.floor(((now - entry.started) * entry.clip.fps) / 1000) % entry.clip.frames.length;
    if (step === entry.drawn) return;
    entry.drawn = step;
    const cell = entry.clip.frames[step];
    const context = entry.canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, CROP.size, CROP.size);
    const size = entry.sheet.cell;
    context.drawImage(entry.image,
      (cell % entry.columns) * size + CROP.x, Math.floor(cell / entry.columns) * size + CROP.y, CROP.size, CROP.size,
      0, 0, CROP.size, CROP.size);
  };

  const tick = (now: number) => {
    frame = 0;
    entries = entries.filter((entry) => entry.canvas.isConnected);
    for (const entry of entries) paint(entry, now);
    if (!disposed && !reducedMotion && entries.some((entry) => entry.image)) frame = requestAnimationFrame(tick);
  };
  const schedule = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(tick);
  };

  return {
    add(canvas, sheet) {
      if (disposed) return;
      const clip = previewClip(sheet);
      const texture = sheet.textures.find((candidate) => candidate.key === clip.texture);
      if (!texture) return;
      canvas.width = CROP.size;
      canvas.height = CROP.size;
      const entry: Entry = { canvas, sheet, clip, columns: texture.columns, started: performance.now(), drawn: -1 };
      entries.push(entry);
      loadImage(texture.url).then((image) => {
        entry.image = image;
        schedule();
      }).catch(() => { /* The card keeps its name; the picture is a bonus. */ });
    },
    clear() {
      entries = [];
    },
    dispose() {
      disposed = true;
      entries = [];
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
