/**
 * Each navigation owns a separate root and abort signal. Legacy pages may still
 * finish a request after navigation, but can only render into their detached
 * root. Pages with global resources should listen for abort before awaiting IO.
 */
export function createRouteLifecycle() {
  let current = null;

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
    begin(container) {
      current?.dispose();
      const app = container.cloneNode(false);
      container.replaceWith(app);
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
