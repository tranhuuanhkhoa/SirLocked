import { forgetCanvas, frameArtReady, frameRevision, isAnimatedFrame, paintFrame } from './frames.js';
import { reduce } from './lib.js';
import { stageOpen } from './stage.js';

// Frames move slowly, so 30 paints a second look the same as 60 at half the cost. A little under 33 ms, so a
// 60 Hz screen does not fall to 20 paints a second whenever a frame arrives just early.
const PAINT_INTERVAL_MS = 29;
// Work per paint before the rest waits for the next one, so a page full of frames cannot stall the page.
const PAINT_BUDGET_MS = 8;
// A tile that cannot move is repainted slowly only until its art has arrived; then it needs nothing more.
const STILL_INTERVAL_MS = 400;
const STILL_GIVE_UP_MS = 15_000;
const STILL_T = 2.2;

/**
 * The one animation loop of a page that shows frames. requestAnimationFrame runs only while the tab is visible and
 * a canvas on screen can still change; dispose() on leaving the route stops everything. A running entrance has the
 * machine to itself: nothing here paints underneath it.
 */
export function createPainter() {
  const tiles = new Map();
  const extras = new Set();
  let raf = 0;
  let disposed = false;
  let lastPaint = -Infinity;
  let turn = 0;

  const moves = (tile) => !tile.still && !reduce.matches && isAnimatedFrame(tile.frame());

  /** A still tile is done once it has been painted with its art, its avatar and its current size. */
  const stillDone = (tile, canvas, now) => {
    const frame = tile.frame();
    const avatar = tile.avatar();
    const key = `${frame}|${avatar?.src ?? ''}|${canvas.width}|${frameRevision()}`;
    if (key !== tile.key) {
      tile.key = key;
      tile.since = now;
      tile.done = false;
    }
    return tile.done;
  };

  const needsPaint = (tile, canvas, now) => tile.visible && (moves(tile) || !stillDone(tile, canvas, now));

  const wanted = () => {
    if (disposed || document.visibilityState !== 'visible') return false;
    if (extras.size > 0) return true;
    const now = performance.now();
    for (const [canvas, tile] of tiles) if (needsPaint(tile, canvas, now)) return true;
    return false;
  };

  const paintStill = (canvas, tile, now) => {
    if (now - tile.painted < STILL_INTERVAL_MS) return;
    tile.painted = now;
    const avatar = tile.avatar();
    paintFrame(canvas, tile.frame(), STILL_T, avatar);
    const ready = frameArtReady(tile.frame(), canvas.width) && (!avatar || avatar.naturalWidth > 0);
    if (ready || now - tile.since > STILL_GIVE_UP_MS) tile.done = true;
    tile.key = `${tile.frame()}|${avatar?.src ?? ''}|${canvas.width}|${frameRevision()}`;
  };

  const tick = (ms) => {
    raf = 0;
    if (!wanted()) return;
    raf = requestAnimationFrame(tick);
    if (stageOpen() || ms - lastPaint < PAINT_INTERVAL_MS) return;
    lastPaint = ms;
    const now = performance.now();
    const seconds = now / 1000;
    const deadline = now + PAINT_BUDGET_MS;
    try {
      const list = [...tiles].filter(([canvas, tile]) => needsPaint(tile, canvas, now));
      for (let i = 0; i < list.length; i++) {
        // Every tile gets its turn: the next paint continues where this one ran out of budget.
        const [canvas, tile] = list[(turn + i) % list.length];
        if (moves(tile)) paintFrame(canvas, tile.frame(), seconds, tile.avatar());
        else paintStill(canvas, tile, now);
        if (performance.now() > deadline && i + 1 < list.length) {
          turn = (turn + i + 1) % list.length;
          break;
        }
      }
      for (const extra of extras) extra(seconds);
    } catch (error) {
      console.error(error);
    }
  };

  const wake = () => { if (!raf && wanted()) raf = requestAnimationFrame(tick); };

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const tile = tiles.get(entry.target);
        if (tile) tile.visible = entry.isIntersecting;
      }
      wake();
    })
    : null;

  const onVisibility = () => {
    if (document.visibilityState === 'visible') wake();
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  document.addEventListener('visibilitychange', onVisibility);

  // A new size needs a new paint, even for a tile that had finished.
  const onResize = () => {
    for (const tile of tiles.values()) { tile.done = false; tile.painted = -Infinity; }
    // The canvas learns its new size from a ResizeObserver, which runs after this event.
    requestAnimationFrame(wake);
  };
  window.addEventListener('resize', onResize);

  return {
    /** `frame` and `avatar` are read each paint, so a tile follows what the player wears. `still` freezes it: a frame not owned yet. */
    add(canvas, frame, avatar, { still = false } = {}) {
      if (disposed) return;
      tiles.set(canvas, { frame, avatar, still, visible: !observer, key: null, since: 0, painted: -Infinity, done: false });
      observer?.observe(canvas);
      wake();
    },
    /** Forgets every frame tile, before a redraw replaces the canvases. */
    clear() {
      for (const canvas of tiles.keys()) {
        observer?.unobserve(canvas);
        forgetCanvas(canvas);
      }
      tiles.clear();
    },
    /** Runs `callback(seconds)` on each paint; returns how to stop it. */
    onPaint(callback) {
      extras.add(callback);
      wake();
      return () => extras.delete(callback);
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      observer?.disconnect();
      for (const canvas of tiles.keys()) forgetCanvas(canvas);
      tiles.clear();
      extras.clear();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    },
  };
}
