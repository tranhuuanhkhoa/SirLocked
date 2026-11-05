import { tr } from '../services/i18n.js';
import { avatarFor } from './avatars.js';
import { chime } from './chime.js';
import { EN, FXD, drawEntrance } from './fx.js';
import { reduce } from './lib.js';
import { closeStage, openStage } from './stage.js';
import { T, titleHTML } from './titles.js';
import { entranceKey, frameKey, loadCosmeticsIfUnknown, titleKey } from './index.js';

const QUIET_ENTRANCE = 'lang-le';
const STILL_BANNER_MS = 3200;

/** What the stage needs from a room player or a PlayerEntrance event. Names always reach the DOM as text. */
export function lookOf(player) {
  return {
    name: player.username ?? player.name ?? '',
    frameId: frameKey(player.frameDefId),
    titleId: titleKey(player.titleDefId),
    avatar: () => avatarFor(player),
  };
}

const arrivedLabel = () => tr('entered the lobby', 'đã vào sảnh');
const skipLabel = () => tr('Skip', 'Bỏ qua');

/** The cinematic full-screen entrance. Resolves when it ends by itself, is skipped, or is cancelled. */
function playStage(id, look) {
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  openStage(id, look, { onClose: () => finish(), skipLabel: skipLabel(), arrivedLabel: arrivedLabel() });
  return { done, cancel: () => { closeStage(true); finish(); } };
}

/** The default entrance stays small: a thin mist over the arriving player's seat, and the page stays usable. */
function playQuiet(id, seatOf) {
  const canvas = document.createElement('canvas');
  canvas.className = 'hs-fx hs-fx--page';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const context = canvas.getContext('2d');
  const start = performance.now() / 1000;
  let raf = 0;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const stop = () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    canvas.remove();
    finish();
  };
  const onKey = (event) => { if (event.key === 'Escape') stop(); };
  document.addEventListener('keydown', onKey);
  const tick = () => {
    const t = performance.now() / 1000 - start;
    if (t > FXD[id]) { stop(); return; }
    const d = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (canvas.width !== Math.round(W * d)) { canvas.width = Math.round(W * d); canvas.height = Math.round(H * d); }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const seat = seatOf()?.getBoundingClientRect();
    if (seat) {
      context.setTransform(d, 0, 0, d, 0, 0);
      drawEntrance(context, id, t, { W, H, ax: seat.left + 40, ay: seat.top + seat.height / 2, rw: seat.width });
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { done, cancel: stop };
}

/** With reduced motion nothing moves: one still line, then it goes away. */
function playStill(id, look) {
  const banner = document.createElement('div');
  banner.className = 'hs-banner hs-banner--page';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `${titleHTML(T[look.titleId] || T['tan-binh'], { scale: 0.9, maxW: Math.min(window.innerWidth - 32, 520) })}<small></small>`;
  banner.querySelector('small').textContent = `${look.name} ${arrivedLabel()} · ${EN[id].n}`;
  document.body.append(banner);
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const stop = () => {
    clearTimeout(timer);
    banner.remove();
    finish();
  };
  const timer = setTimeout(stop, STILL_BANNER_MS);
  return { done, cancel: stop };
}

/** Plays one entrance the way the current settings ask for. `seatOf` finds the player on the page, for the quiet one. */
export function playEntrance(id, look, { seatOf } = {}) {
  const entrance = EN[id] ? id : QUIET_ENTRANCE;
  if (reduce.matches) return playStill(entrance, look);
  if (entrance === QUIET_ENTRANCE && seatOf) {
    chime(EN[entrance].r);
    return playQuiet(entrance, seatOf);
  }
  return playStage(entrance, look);
}

/**
 * Entrances of one lobby, played one after another. `canPlay` is asked before each one: nothing plays once the
 * game has started. An entrance that arrives while the tab is hidden is dropped, not saved up for later.
 */
export function createEntranceQueue({ canPlay, seatFor, onPlayed }) {
  const waiting = [];
  let current = null;
  let stopped = false;
  let preparing = false;

  const next = async () => {
    if (stopped || current || preparing) return;
    const entrance = waiting.shift();
    if (!entrance) return;
    const playable = () => canPlay() && document.visibilityState === 'visible';
    if (!playable()) {
      next();
      return;
    }
    // What this player wears may have been made after this page loaded.
    preparing = true;
    await loadCosmeticsIfUnknown([entrance.entranceDefId, entrance.frameDefId, entrance.titleDefId]);
    preparing = false;
    if (stopped) return;
    if (!playable()) {
      next();
      return;
    }
    current = playEntrance(entranceKey(entrance.entranceDefId), lookOf(entrance), { seatOf: () => seatFor(entrance.userId) });
    current.done.then(() => {
      current = null;
      if (stopped) return;
      onPlayed?.(entrance);
      next();
    });
  };

  return {
    push(entrance) {
      if (stopped) return;
      waiting.push(entrance);
      next();
    },
    /** Ends what is playing and forgets the rest. */
    stop() {
      stopped = true;
      waiting.length = 0;
      current?.cancel();
      current = null;
    },
  };
}
