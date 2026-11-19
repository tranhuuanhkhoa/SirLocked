import { AU } from './chestAudio.js';

/*
 * The opening sequence of Mở hòm, after the approved design kho-ruong-sirlocked.html: the chest shakes and bursts,
 * a reel of items runs under a needle, then the item is shown on its own card.
 * One rule differs from the design, which knew its result up front: the stage knows nothing about the result until
 * resolve() delivers the server's item. The reel runs at a steady speed until then and only brakes afterwards,
 * so it can never land on anything but what the server gave. Everything it starts ends in dispose().
 */

const CRUISE_PX_PER_S = 2200;
const REDUCED_CRUISE_PX_PER_S = 260;
/** Cards between the needle and the winner when braking starts: far beyond the visible ones, so no card changes in view. */
const BRAKE_CARDS = 20;
const REDUCED_BRAKE_CARDS = 10;
const GAP_PX = 8;
const SHAKE_MS = 760;
const OPEN_MS = 1050;
const SWAP_MS = 260;
/** Cards kept ahead of the needle, and how many old ones are dropped at once while waiting. */
const AHEAD = 14;
const RECYCLE_AT = 40;
const RECYCLE_COUNT = 30;

/**
 * @param {object} o
 * @param {HTMLElement} o.root carries data-mode and data-revealed
 * @param {HTMLElement} o.chest the chest button on the podium
 * @param {HTMLElement} o.reel the window of the reel; o.track the moving strip inside it
 * @param {HTMLElement} o.reelLayer o.revealLayer the two overlays; o.burst the flash
 * @param {(item: object) => HTMLElement} o.makeCard one card of the reel
 * @param {() => object} o.filler one item for the reel, never the result
 * @param {() => boolean} o.reduce whether the player asked for less motion
 * @param {(mode: string) => void} o.onMode
 * @param {(item: object) => void} o.onReveal fills the card before it shows
 */
export function createVaultStage({ root, chest, reel, track, reelLayer, revealLayer, burst, makeCard, filler, reduce, onMode, onReveal }) {
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };
  let mode = 'idle';
  let disposed = false;
  let raf = 0;
  let swapTimer = 0;
  /** The current run: what the reel shows, where it is, and the result once known. */
  let run = null;

  function setMode(next) {
    mode = next;
    root.dataset.mode = next;
    delete root.dataset.revealed;
    onMode(next);
  }

  function flash(rgb) {
    if (rgb) burst.style.setProperty('--crgb', rgb);
    burst.classList.remove('qh-on');
    void burst.offsetWidth;
    burst.classList.add('qh-on');
  }

  function restoreChest() {
    chest.classList.remove('qh-shake', 'qh-gone');
    root.classList.remove('qh-opening');
  }

  function stopFrames() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ---------- reel ---------- */

  function addCards(count) {
    while (run.cards.length < count) {
      const item = filler();
      run.cards.push(item);
      track.append(makeCard(item));
    }
  }

  const needle = () => Math.floor((run.center - run.x) / run.cardW);

  function place() {
    track.style.transform = `translateX(${run.x}px)`;
  }

  function tickSound(now, speed) {
    const index = needle();
    if (index === run.lastIndex) return;
    if (run.lastIndex !== -1 && now - run.lastTick > 28) {
      AU.tick(speed / 3000);
      run.lastTick = now;
    }
    run.lastIndex = index;
  }

  function startSpin() {
    if (mode !== 'open' || !run) return;
    clearTimers();
    setMode('spin');
    track.replaceChildren();
    run.cards = [];
    reelLayer.hidden = false;
    addCards(AHEAD);
    run.cardW = track.children[0].getBoundingClientRect().width + GAP_PX;
    run.center = (reel.clientWidth || window.innerWidth) / 2;
    run.x = run.center - run.cardW * 3;
    run.speed = reduce() ? REDUCED_CRUISE_PX_PER_S : CRUISE_PX_PER_S;
    run.t = performance.now();
    place();
    AU.whoosh();
    raf = requestAnimationFrame(step);
    if (run.item) brake();
  }

  function step(now) {
    raf = 0;
    if (disposed || mode !== 'spin' || !run || run.landed) return;
    const dt = Math.min(0.05, Math.max(0, (now - run.t) / 1000));
    run.t = now;
    if (run.brake) {
      const { t0, x0, x1, duration } = run.brake;
      const u = Math.min(1, (now - t0) / duration);
      run.x = x0 + (x1 - x0) * (1 - (1 - u) ** 3);
      place();
      tickSound(now, run.speed * 3 * (1 - u) ** 2);
      if (u >= 1) {
        land();
        return;
      }
    } else {
      run.x -= run.speed * dt;
      // A long wait (retries can take a minute) must not grow the strip without end.
      if (needle() > RECYCLE_AT) {
        for (let k = 0; k < RECYCLE_COUNT; k++) track.firstElementChild?.remove();
        run.cards.splice(0, RECYCLE_COUNT);
        run.x += RECYCLE_COUNT * run.cardW;
        if (run.lastIndex !== -1) run.lastIndex -= RECYCLE_COUNT;
      }
      addCards(needle() + AHEAD);
      place();
      tickSound(now, run.speed);
    }
    raf = requestAnimationFrame(step);
  }

  /** The server's item is known: put it far ahead and brake onto it with the speed the reel has now. */
  function brake() {
    if (!run || run.brake || !run.item || mode !== 'spin') return;
    const win = needle() + (reduce() ? REDUCED_BRAKE_CARDS : BRAKE_CARDS);
    addCards(win + AHEAD);
    run.cards[win] = run.item;
    track.children[win].replaceWith(makeCard(run.item));
    const offset = (Math.random() - 0.5) * (run.cardW - 30);
    const x1 = run.center - (win * run.cardW + (run.cardW - GAP_PX) / 2) + offset;
    // Cubic ease-out starts at 3 × distance / duration: equal to the current speed, so the reel never jolts.
    const duration = reduce() ? 500 : Math.max(1200, (3 * (run.x - x1) / run.speed) * 1000);
    run.brake = { t0: performance.now(), x0: run.x, x1, duration };
    // Frames stop in a hidden tab; the result must still arrive.
    later(land, duration + 400);
  }

  function land() {
    if (!run?.brake || run.landed) return;
    run.landed = true;
    stopFrames();
    run.x = run.brake.x1;
    place();
    AU.land();
    later(reveal, 180);
  }

  function reveal() {
    if (!run) return;
    reelLayer.hidden = true;
    setMode('reveal');
    onReveal(run.item);
    revealLayer.hidden = false;
    root.dataset.revealed = '';
    flash(getComputedStyle(revealLayer).getPropertyValue('--crgb').trim());
    AU.sting(run.item.r);
    if (run.item.r === 'leg' || run.item.r === 'gold') AU.shimmer();
  }

  return {
    mode: () => mode,

    /** Starts the sequence. The result is unknown yet; resolve() or abort() ends it. */
    start() {
      if (mode !== 'idle' || disposed) return false;
      AU.init();
      clearTimeout(swapTimer);
      chest.classList.remove('qh-out-l', 'qh-out-r');
      run = { item: null, cards: [], lastIndex: -1, lastTick: 0 };
      setMode('open');
      if (reduce()) {
        startSpin();
        return true;
      }
      root.classList.add('qh-opening');
      chest.classList.add('qh-shake');
      AU.creak();
      later(() => {
        chest.classList.remove('qh-shake');
        chest.classList.add('qh-gone');
        flash(getComputedStyle(root).getPropertyValue('--accent-rgb').trim());
        AU.crack();
      }, SHAKE_MS);
      later(startSpin, OPEN_MS);
      return true;
    },

    /** The server's answer. The reel brakes onto exactly this item. */
    resolve(item) {
      if (!run) return;
      run.item = item;
      if (mode === 'spin') brake();
    },

    /** The server said no: back to the closed chest at once, then `done`. */
    abort(done) {
      clearTimers();
      stopFrames();
      reelLayer.hidden = true;
      revealLayer.hidden = true;
      restoreChest();
      run = null;
      if (mode !== 'idle') setMode('idle');
      done?.();
    },

    /** Fast-forward: the shaking ends at once; the reel jumps to its stop only once the result is known. */
    skip() {
      if (mode === 'open') {
        clearTimers();
        chest.classList.remove('qh-shake');
        chest.classList.add('qh-gone');
        startSpin();
      } else if (mode === 'spin' && run?.brake && !run.landed) {
        land();
      }
    },

    /** From the item card back to the chest. */
    toIdle() {
      if (mode !== 'reveal') return false;
      revealLayer.hidden = true;
      restoreChest();
      run = null;
      setMode('idle');
      return true;
    },

    /** Slides the chest out towards `dir`, lets `paint` change it, and slides the new one in from the other side. */
    swapChest(dir, paint) {
      clearTimeout(swapTimer);
      chest.classList.remove('qh-out-l', 'qh-out-r');
      if (reduce() || mode !== 'idle') {
        paint();
        return;
      }
      chest.classList.add(dir > 0 ? 'qh-out-l' : 'qh-out-r');
      swapTimer = setTimeout(() => {
        if (disposed) return;
        paint();
        chest.classList.remove('qh-out-l', 'qh-out-r');
        chest.classList.add(dir > 0 ? 'qh-out-r' : 'qh-out-l');
        void chest.offsetWidth;
        chest.classList.remove('qh-out-l', 'qh-out-r');
      }, SWAP_MS);
    },

    dispose() {
      disposed = true;
      clearTimers();
      clearTimeout(swapTimer);
      stopFrames();
      run = null;
      AU.close();
    },
  };
}
