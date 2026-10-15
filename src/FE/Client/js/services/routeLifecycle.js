/**
 * Each navigation owns a separate root and abort signal. Legacy pages may still
 * finish a request after navigation, but can only render into their detached
 * root. Pages with global resources should listen for abort before awaiting IO.
 *
 * A new root also opens through the magnifier lens (`.bpa-enter` + `.bpa-rim`
 * from 20-bpa-foundation.css) unless the caller opts out or the user prefers
 * reduced motion.
 */
const LENS_FALLBACK_MS = 1600;

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function playLens(app) {
  const rim = document.createElement('div');
  rim.className = 'bpa-rim';
  rim.setAttribute('aria-hidden', 'true');
  let timer = 0;
  const finish = () => {
    clearTimeout(timer);
    app.removeEventListener('animationend', onEnd);
    app.classList.remove('bpa-enter');
    rim.remove();
  };
  // Children run bpaZoom and bubble their own animationend; only the root's lens ends the effect.
  const onEnd = (event) => {
    if (event.target === app && event.animationName === 'bpaLens') finish();
  };
  app.addEventListener('animationend', onEnd);
  app.classList.add('bpa-enter');
  document.body.append(rim);
  // A detached or hidden root never fires animationend.
  timer = setTimeout(finish, LENS_FALLBACK_MS);
  return finish;
}

export function createRouteLifecycle() {
  let current = null;
  let finishLens = null;

  const disposeSafely = (cleanup) => {
    try {
      // Disposal must start synchronously; a slow connection shutdown must not
      // hold the next page hostage or take ownership of its eventual cleanup.
      Promise.resolve(cleanup()).catch(() => {});
    } catch {
      // Page disposal is best effort, including on a failed mount.
    }
  };

  return {
    begin(container, { transition = true } = {}) {
      current?.dispose();
      finishLens?.();
      finishLens = null;
      const app = container.cloneNode(false);
      app.classList.remove('bpa-enter');
      container.replaceWith(app);
      if (transition && !prefersReducedMotion()) finishLens = playLens(app);
      const controller = new AbortController();
      let cleanup = null;
      let disposed = false;
      const mount = {
        app,
        signal: controller.signal,
        get active() { return current === mount && !disposed; },
        setCleanup(callback) {
          if (typeof callback !== 'function') return;
          if (disposed) disposeSafely(callback);
          else cleanup = callback;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          controller.abort();
          if (cleanup) disposeSafely(cleanup);
          cleanup = null;
        },
      };
      current = mount;
      return mount;
    },
  };
}
