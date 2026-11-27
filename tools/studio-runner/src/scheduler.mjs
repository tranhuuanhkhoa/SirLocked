/**
 * Decides when to run the bot. Every run starts from an event (the server's WorkAvailable, a reconnect, or the
 * previous bot exiting) — never from a timer. One bot at a time. A request the bot cannot finish must not keep the
 * machine busy: after `maxRunsWithoutEvent` runs in a row without progress, it waits for the next event.
 */
export function createScheduler({ pendingCount, pendingSnapshot, runBot, log, maxRunsWithoutEvent = 3 }) {
  let running = false;
  let streak = 0;
  let lastSignature = null;
  let workArrived = false;
  let idle = Promise.resolve();

  async function readPending() {
    if (pendingSnapshot) return await pendingSnapshot();
    const count = await pendingCount();
    return { count, signature: null };
  }

  async function loop() {
    try {
      for (;;) {
        workArrived = false;
        let state;
        try {
          state = await readPending();
        } catch (error) {
          log(`Không hỏi được số việc đang chờ: ${error instanceof Error ? error.message : String(error)}`);
          if (workArrived) continue;
          return;
        }
        if (!(state.count > 0)) {
          if (workArrived) continue;
          lastSignature = null;
          return;
        }
        if (state.signature !== null && lastSignature !== null && state.signature !== lastSignature) {
          streak = 0; // the pending queue changed: real progress, not the same released request
        }
        lastSignature = state.signature;
        if (streak >= maxRunsWithoutEvent) {
          if (workArrived) continue;
          log(`Đã chạy bot ${maxRunsWithoutEvent} lần liền mà vẫn còn ${state.count} việc; chờ sự kiện mới từ server.`);
          return;
        }
        streak++;
        try {
          const code = await runBot(state);
          log(`Bot thoát với mã ${code}.`);
        } catch (error) {
          log(`Không chạy được bot: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    onWorkAvailable() {
      workArrived = true;
      // While the bot is running, a WorkAvailable event may be caused by the bot's own bridge_release on a stuck
      // request. When `pendingSnapshot` is provided, progress is measured by the pending request IDs changing.
      if (!running || !pendingSnapshot) streak = 0;
      if (running) return; // the loop checks the queue again when the bot exits
      running = true;
      idle = loop();
    },
    whenIdle() {
      return idle;
    },
  };
}
