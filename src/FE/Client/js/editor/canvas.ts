/**
 * Case Studio canvas: draws a scene as the game does (background at runtime size with no smoothing, NPCs as frame 0 of
 * their idle sheet anchored at the feet, foreground cut-outs over actors behind their ground line) and the editor's
 * overlays on top: talk boxes, item boxes, clue zones, doors, spawn points and the walk grid.
 */
import { objectKey, sceneGrid, sceneObjects, sceneProfile, type Point, type Reachability, type SceneObject } from './model';

export type Overlays = { boxes: boolean; labels: boolean; grid: boolean; reach: boolean };
export type DrawState = {
  overlays: Overlays;
  selected: string | null;
  hover: string | null;
  issues: Map<string, any[]>;
  reach: Reachability | null;
  brush: { x: number; y: number; cells: number; value: '0' | '1' } | null;
};

const KIND_COLOR: Record<string, string> = {
  npc: '#5b9dff',
  item: '#e2bd66',
  clue: '#c08cff',
  door: '#2fd1b8',
  spawn: '#f6eedf',
};
const BAD = '#ff5a4f';

type ImageSlot = { image: HTMLImageElement; ready: boolean; failed: boolean };

export class SceneCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly images = new Map<string, ImageSlot>();
  private gridCanvas: HTMLCanvasElement | null = null;
  scale = 0.3;
  ox = 0;
  oy = 0;
  onImageReady: () => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  /** Matches the backing store to the element size (sharp on high-DPI screens). */
  resize(): void {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /** Fits the whole scene in the canvas with a small margin. */
  fit(sceneWidth: number, sceneHeight: number): void {
    this.resize();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = this.canvas.width / ratio, height = this.canvas.height / ratio;
    this.scale = Math.max(0.05, Math.min((width - 24) / sceneWidth, (height - 24) / sceneHeight));
    this.ox = (width - sceneWidth * this.scale) / 2;
    this.oy = (height - sceneHeight * this.scale) / 2;
  }

  /** Zooms around a screen point (CSS pixels of the canvas). */
  zoomAt(factor: number, sx: number, sy: number): void {
    const next = Math.max(0.05, Math.min(4, this.scale * factor));
    const rx = (sx - this.ox) / this.scale, ry = (sy - this.oy) / this.scale;
    this.scale = next;
    this.ox = sx - rx * next;
    this.oy = sy - ry * next;
  }

  /** Runtime units under a pointer event. */
  toRuntime(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - this.ox) / this.scale, y: (clientY - rect.top - this.oy) / this.scale };
  }

  private image(url: string): ImageSlot | null {
    if (!url) return null;
    let slot = this.images.get(url);
    if (!slot) {
      const image = new Image();
      slot = { image, ready: false, failed: false };
      const current = slot;
      image.onload = () => { current.ready = true; this.onImageReady(); };
      image.onerror = () => { current.failed = true; this.onImageReady(); };
      image.src = url;
      this.images.set(url, slot);
    }
    return slot;
  }

  /** True once every picture the scene needs has loaded or failed (used by tests and the "đang tải ảnh" note). */
  imagesSettled(): boolean {
    return [...this.images.values()].every((slot) => slot.ready || slot.failed);
  }

  draw(gameCase: any, scene: any, state: DrawState): void {
    this.resize();
    const ctx = this.ctx;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#1a1712';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!scene) return;
    const profile = sceneProfile(scene);
    ctx.setTransform(ratio * this.scale, 0, 0, ratio * this.scale, ratio * this.ox, ratio * this.oy);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = scene.runtime?.render?.backdropColor || '#11100e';
    ctx.fillRect(0, 0, profile.width, profile.height);
    const background = this.image(scene.backgroundUrl);
    if (background?.ready) ctx.drawImage(background.image, 0, 0, profile.width, profile.height);

    this.drawActors(gameCase, scene);
    if (state.overlays.grid || state.overlays.reach) this.drawGrid(scene, state.overlays.reach ? state.reach : null);
    if (state.brush) this.drawBrush(scene, state.brush);
    if (state.overlays.boxes) this.drawBoxes(gameCase, scene, state);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** NPCs and foreground layers sorted by their ground line, as the game's depth does. */
  private drawActors(gameCase: any, scene: any): void {
    const ctx = this.ctx;
    const runtime = scene.runtime ?? {};
    const layers: { y: number; draw: () => void }[] = [];
    for (const placement of runtime.characterPlacements ?? []) {
      const character = (gameCase.characters ?? []).find((entry) => entry.characterId === placement.characterId);
      const sheet = character?.presentation?.spriteSheet;
      const width = placement.size?.width || 128 * sceneProfile(scene).actorScale;
      const height = placement.size?.height || width;
      const anchorX = Number.isFinite(sheet?.anchorX) ? sheet.anchorX : 0.5;
      const anchorY = Number.isFinite(sheet?.anchorY) ? sheet.anchorY : 1;
      const x = placement.position?.x ?? 0, y = placement.position?.y ?? 0;
      layers.push({
        y,
        draw: () => {
          const slot = sheet?.url ? this.image(sheet.url) : null;
          ctx.save();
          ctx.translate(x, y);
          if (placement.direction === 'right') ctx.scale(-1, 1);
          if (slot?.ready) {
            ctx.drawImage(slot.image, 0, 0, sheet.frameWidth || 128, sheet.frameHeight || 128,
              -anchorX * width, -anchorY * height, width, height);
          } else {
            ctx.fillStyle = 'rgba(91, 157, 255, 0.35)';
            ctx.fillRect(-width * 0.15, -height * 0.6, width * 0.3, height * 0.6);
          }
          ctx.restore();
        },
      });
    }
    for (const layer of runtime.render?.foreground ?? []) {
      layers.push({
        y: layer.baseY,
        draw: () => {
          const slot = this.image(layer.url);
          if (slot?.ready) ctx.drawImage(slot.image, layer.x, layer.y, layer.width, layer.height);
        },
      });
    }
    layers.sort((a, b) => a.y - b.y).forEach((layer) => layer.draw());
  }

  /** One pixel per cell, scaled up without smoothing: blocked red, reachable green, cut-off floor amber. */
  private drawGrid(scene: any, reach: Reachability | null): void {
    const grid = sceneGrid(scene);
    if (!grid) return;
    if (!this.gridCanvas) this.gridCanvas = document.createElement('canvas');
    const canvas = this.gridCanvas;
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const context = canvas.getContext('2d')!;
    const pixels = context.createImageData(grid.cols, grid.rows);
    for (let row = 0; row < grid.rows; row++) {
      const line = grid.data[row] ?? '';
      for (let col = 0; col < grid.cols; col++) {
        const at = (row * grid.cols + col) * 4;
        const open = line[col] === '1';
        let rgba: [number, number, number, number];
        if (!open) rgba = [220, 60, 50, 92];
        else if (!reach) rgba = [0, 0, 0, 0];
        else if (reach.reachableCells.has(row * grid.cols + col)) rgba = [60, 200, 120, 60];
        else rgba = [240, 170, 40, 110];
        pixels.data[at] = rgba[0];
        pixels.data[at + 1] = rgba[1];
        pixels.data[at + 2] = rgba[2];
        pixels.data[at + 3] = rgba[3];
      }
    }
    context.putImageData(pixels, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(canvas, 0, 0, grid.cols * grid.cellSize, grid.rows * grid.cellSize);
  }

  private drawBrush(scene: any, brush: { x: number; y: number; cells: number; value: '0' | '1' }): void {
    const grid = sceneGrid(scene);
    if (!grid) return;
    const half = Math.floor(brush.cells / 2);
    const col = Math.floor(brush.x / grid.cellSize) - half, row = Math.floor(brush.y / grid.cellSize) - half;
    this.ctx.strokeStyle = brush.value === '1' ? '#5ee08a' : BAD;
    this.ctx.lineWidth = 2 / this.scale;
    this.ctx.strokeRect(col * grid.cellSize, row * grid.cellSize, brush.cells * grid.cellSize, brush.cells * grid.cellSize);
  }

  private drawBoxes(gameCase: any, scene: any, state: DrawState): void {
    const ctx = this.ctx;
    const objects = sceneObjects(gameCase, scene);
    const px = 1 / this.scale;
    for (const object of objects) {
      const key = objectKey(object);
      const bad = state.issues.has(key) || Boolean(state.reach?.unreachable.has(key));
      const selected = state.selected === key;
      const color = bad ? BAD : KIND_COLOR[object.kind];
      const { x, y, width, height } = object.box;
      ctx.save();
      if (object.kind === 'spawn' && object.point) {
        ctx.fillStyle = color;
        ctx.strokeStyle = '#10203a';
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.arc(object.point.x, object.point.y, 10 * px + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = hexAlpha(color, selected ? 0.22 : 0.1);
        ctx.fillRect(x, y, width, height);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = (selected ? 3 : bad ? 2.5 : 1.5) * px;
      if (object.kind === 'clue' || (bad && !selected)) ctx.setLineDash([6 * px, 4 * px]);
      if (object.kind !== 'spawn' || selected) ctx.strokeRect(x, y, width, height);
      ctx.setLineDash([]);
      if (object.kind === 'npc' && object.point) {
        ctx.beginPath();
        ctx.moveTo(object.point.x - 10 * px, object.point.y);
        ctx.lineTo(object.point.x + 10 * px, object.point.y);
        ctx.moveTo(object.point.x, object.point.y - 10 * px);
        ctx.lineTo(object.point.x, object.point.y + 10 * px);
        ctx.stroke();
      }
      if (selected && object.resizable) {
        const handle = 10 * px;
        ctx.fillStyle = '#fffdf9';
        ctx.fillRect(x + width - handle / 2, y + height - handle / 2, handle, handle);
        ctx.strokeRect(x + width - handle / 2, y + height - handle / 2, handle, handle);
      }
      // Spawn points sit on top of each other at doors: their names show on hover or selection only.
      if ((state.overlays.labels && object.kind !== 'spawn') || selected || state.hover === key || (bad && object.kind === 'spawn')) {
        this.label(object, color, bad);
      }
      ctx.restore();
    }
  }

  private label(object: SceneObject, color: string, bad: boolean): void {
    const ctx = this.ctx;
    const px = 1 / this.scale;
    const text = `${bad ? '⚠ ' : ''}${object.label}`;
    ctx.font = `${12 * px}px 'Be Vietnam Pro', system-ui, sans-serif`;
    const width = ctx.measureText(text).width + 10 * px;
    const height = 18 * px;
    const x = object.box.x;
    const y = Math.max(0, object.box.y - height - 2 * px);
    ctx.fillStyle = 'rgba(16, 32, 58, 0.86)';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = bad ? '#ffd2cc' : color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 5 * px, y + height / 2);
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16), g = parseInt(value.slice(2, 4), 16), b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
