import { paintFrame } from './frames.js';
import { reduce } from './lib.js';

// With reduced motion paintFrame draws one still image; repainting slowly only lets late-loading art appear.
const STILL_INTERVAL_MS = 400;

/**
 * The one animation loop of a page that shows frames. requestAnimationFrame runs only while the tab is
 * visible and at least one canvas is on screen; dispose() on leaving the route stops everything.
 */
export function createPainter() {
  const tiles = new Map();
  const extras = new Set();
  let raf = 0;
  let disposed = false;
  let lastStill = 0;

  const wanted = () => !disposed
    && document.visibilityState === 'visible'
    && (extras.size > 0 || [...tiles.values()].some((tile) => tile.visible));

  const tick = (ms) => {
    raf = 0;
    if (!wanted()) return;
    raf = requestAnimationFrame(tick);
    if (reduce.matches && ms - lastStill < STILL_INTERVAL_MS) return;
    lastStill = ms;
    const now = performance.now() / 1000;
    try {
      for (const [canvas, tile] of tiles) if (tile.visible) paintFrame(canvas, tile.frame(), now, tile.avatar());
      for (const extra of extras) extra(now);
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

  return {
    /** `frame` and `avatar` are read each paint, so a tile follows what the player wears. */
    add(canvas, frame, avatar) {
      if (disposed) return;
      tiles.set(canvas, { frame, avatar, visible: !observer });
      observer?.observe(canvas);
      wake();
    },
    /** Forgets every frame tile, before a redraw replaces the canvases. */
    clear() {
      for (const canvas of tiles.keys()) observer?.unobserve(canvas);
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
      tiles.clear();
      extras.clear();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
