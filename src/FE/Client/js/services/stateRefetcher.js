/** Coalesce version events, bound retries, and ignore responses after the page is disposed. */
export function createStateRefetcher({
  fetchState,
  applyState,
  getVersion,
  onStatusChange = (_status, _error) => {},
  retryDelays = [500, 1000, 2000, 4000, 8000],
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let disposed = false;
  let inFlight = false;
  let timer = null;
  let requestedVersion = 0;
  let forceRefresh = false;
  let failures = 0;
  let exhausted = false;

  function pump() {
    if (disposed || inFlight || timer !== null || exhausted) return;
    if (!forceRefresh && requestedVersion <= getVersion()) return;
    const versionAtStart = requestedVersion;
    forceRefresh = false;
    inFlight = true;
    onStatusChange('loading');
    Promise.resolve()
      .then(() => disposed ? undefined : fetchState())
      .then((snapshot) => {
        if (disposed) return;
        applyState(snapshot);
        if (disposed) return;
        // A stale successful response must not create an unbounded tight loop either.
        if (getVersion() < versionAtStart) throw new Error('The room state is still behind the announced version.');
        failures = 0;
        onStatusChange('idle');
      })
      .catch((error) => {
        if (disposed) return;
        forceRefresh = true;
        if (failures < retryDelays.length) {
          const delay = retryDelays[failures++];
          timer = schedule(() => {
            timer = null;
            pump();
          }, delay);
          onStatusChange('retrying', error);
        } else {
          exhausted = true;
          onStatusChange('failed', error);
        }
      })
      .finally(() => {
        inFlight = false;
        pump();
      });
  }

  return {
    queue(version = 0) {
      if (disposed) return;
      if (version > 0) requestedVersion = Math.max(requestedVersion, version);
      else forceRefresh = true;
      pump();
    },
    // Only an explicit user retry or a restored connection starts a new retry budget.
    retry() {
      if (disposed) return;
      if (timer !== null) cancel(timer);
      timer = null;
      failures = 0;
      exhausted = false;
      forceRefresh = true;
      pump();
    },
    dispose() {
      disposed = true;
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}
