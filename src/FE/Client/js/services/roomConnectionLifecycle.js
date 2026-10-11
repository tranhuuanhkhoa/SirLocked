/** A room is connected only after JoinRoom succeeds; terminal failure waits for manual retry. */
export function createRoomConnectionLifecycle(connection, roomId, {
  onReconnected = () => {},
  onClose = (_error) => {},
  onStatusChange = (_status) => {},
} = {}) {
  let disposed = false;
  let pending = null;
  let stoppingFailedJoin = false;

  async function closeTransport() {
    try { await connection.stop(); } catch { /* Nothing left to recover when closing. */ }
  }

  function establish(recovering) {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    onStatusChange(recovering ? 'reconnecting' : 'connecting');
    pending = (async () => {
      try {
        if (connection.state !== 'Connected') await connection.start();
        if (disposed) { await closeTransport(); return; }
        await connection.invoke('JoinRoom', roomId);
        if (disposed) { await closeTransport(); return; }
        onStatusChange('connected');
        if (recovering) onReconnected();
      } catch (error) {
        if (!disposed) {
          // A live transport without room membership misses all gameplay events.
          stoppingFailedJoin = true;
          await closeTransport();
          stoppingFailedJoin = false;
          if (!disposed) {
            onStatusChange('disconnected');
            onClose(error);
          }
        }
        if (!disposed) throw error;
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  connection.onreconnecting(() => {
    if (!disposed) onStatusChange('reconnecting');
  });
  connection.onreconnected(() => {
    if (!disposed) void establish(true).catch(() => {});
  });
  connection.onclose((error) => {
    if (disposed || stoppingFailedJoin) return;
    onStatusChange('disconnected');
    onClose(error);
  });

  return {
    start: () => establish(false),
    restart: () => establish(true),
    async stop() {
      if (disposed) return;
      disposed = true;
      await closeTransport();
    },
  };
}
