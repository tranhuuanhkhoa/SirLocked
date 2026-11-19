/**
 * Decides when to run the bot. Every run starts from an event (the server's WorkAvailable, a reconnect, or the
 * previous bot exiting) — never from a timer. One bot at a time. A request the bot cannot finish must not keep the
 * machine busy: after `maxRunsWithoutEvent` runs in a row with no new event, it waits for the next event.
 */
export function createScheduler({ pendingCount, runBot, log, maxRunsWithoutEvent = 3 }) {
  let running = false;
  let streak = 0;
  let idle = Promise.resolve();

  async function loop() {
    try {
      for (;;) {
        let count;
        try {
          count = await pendingCount();
        } catch (error) {
          log(`Không hỏi được số việc đang chờ: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        if (!(count > 0)) return;
        if (streak >= maxRunsWithoutEvent) {
          log(`Đã chạy bot ${maxRunsWithoutEvent} lần liền mà vẫn còn ${count} việc; chờ sự kiện mới từ server.`);
          return;
        }
        streak++;
        try {
          const code = await runBot();
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
      streak = 0; // a fresh event: the server has something new
      if (running) return; // the loop checks the queue again when the bot exits
      running = true;
      idle = loop();
    },
    whenIdle() {
      return idle;
    },
  };
}
