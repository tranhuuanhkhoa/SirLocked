import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScheduler } from '../src/scheduler.mjs';

/** A bot run the test finishes by hand, so it can send events while the bot is still running. */
function controlledBot() {
  const runs = [];
  return {
    runs,
    runBot: () => new Promise((resolve) => { runs.push(resolve); }),
    finish: async (index, code = 0) => { runs[index](code); await new Promise((resolve) => setImmediate(resolve)); },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('runs once when work is available', async () => {
  const bot = controlledBot();
  let pending = 1;
  const scheduler = createScheduler({ pendingCount: async () => pending, runBot: bot.runBot, log: () => {} });
  scheduler.onWorkAvailable();
  await settle();
  assert.equal(bot.runs.length, 1);
  pending = 0;
  await bot.finish(0);
  await scheduler.whenIdle();
  assert.equal(bot.runs.length, 1);
});

test('does nothing when pendingCount is 0', async () => {
  let runs = 0;
  const scheduler = createScheduler({ pendingCount: async () => 0, runBot: async () => { runs++; return 0; }, log: () => {} });
  scheduler.onWorkAvailable();
  await scheduler.whenIdle();
  assert.equal(runs, 0);
});

test('an event during a run triggers exactly one more run afterwards', async () => {
  const bot = controlledBot();
  let pending = 1;
  const scheduler = createScheduler({ pendingCount: async () => pending, runBot: bot.runBot, log: () => {} });
  scheduler.onWorkAvailable();
  await settle();
  scheduler.onWorkAvailable();
  await bot.finish(0);
  await settle();
  assert.equal(bot.runs.length, 2);
  pending = 0;
  await bot.finish(1);
  await scheduler.whenIdle();
  assert.equal(bot.runs.length, 2);
});

test('never runs two bots at once', async () => {
  const bot = controlledBot();
  let pending = 1;
  let running = 0;
  let most = 0;
  const scheduler = createScheduler({
    pendingCount: async () => pending,
    runBot: async () => { running++; most = Math.max(most, running); const code = await bot.runBot(); running--; return code; },
    log: () => {},
  });
  scheduler.onWorkAvailable();
  await settle();
  scheduler.onWorkAvailable();
  scheduler.onWorkAvailable();
  scheduler.onWorkAvailable();
  await bot.finish(0);
  await settle();
  pending = 0;
  await bot.finish(1);
  await scheduler.whenIdle();
  assert.equal(bot.runs.length, 2);
  assert.equal(most, 1);
});

test('stops after 3 runs without a new event while work stays pending', async () => {
  let runs = 0;
  const lines = [];
  const scheduler = createScheduler({ pendingCount: async () => 1, runBot: async () => { runs++; return 1; }, log: (line) => lines.push(line) });
  scheduler.onWorkAvailable();
  await scheduler.whenIdle();
  assert.equal(runs, 3);
  assert.ok(lines.some((line) => /3/.test(line)), lines.join('\n'));
  scheduler.onWorkAvailable(); // a fresh event resets the count
  await scheduler.whenIdle();
  assert.equal(runs, 6);
});

test('a reconnect checks the backlog', async () => {
  let runs = 0;
  let pending = 2;
  const scheduler = createScheduler({ pendingCount: async () => pending, runBot: async () => { runs++; pending = 0; return 0; }, log: () => {} });
  scheduler.onWorkAvailable(); // what onreconnected calls
  await scheduler.whenIdle();
  assert.equal(runs, 1);
});

test('errors are logged and the scheduler keeps working', async () => {
  const lines = [];
  let fail = true;
  let runs = 0;
  const scheduler = createScheduler({
    pendingCount: async () => { if (fail) throw new Error('hub down'); return runs === 0 ? 1 : 0; },
    runBot: async () => { runs++; return 0; },
    log: (line) => lines.push(line),
  });
  scheduler.onWorkAvailable();
  await scheduler.whenIdle();
  assert.equal(runs, 0);
  assert.ok(lines.some((line) => line.includes('hub down')));
  fail = false;
  scheduler.onWorkAvailable();
  await scheduler.whenIdle();
  assert.equal(runs, 1);
});
