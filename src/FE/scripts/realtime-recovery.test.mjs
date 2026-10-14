import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateRefetcher } from '../Client/js/services/stateRefetcher.js';
import { createRoomConnectionLifecycle } from '../Client/js/services/roomConnectionLifecycle.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function refetchFixture(fetch) {
  let version = 1, calls = 0, nextTimer = 0;
  const timers = new Map(), delays = [], statuses = [], applied = [];
  const controller = createStateRefetcher({
    fetchState: () => { calls++; return fetch(); },
    applyState: (state) => { version = state.version; applied.push(state.version); },
    getVersion: () => version,
    onStatusChange: (status) => statuses.push(status),
    schedule: (fn, delay) => { delays.push(delay); timers.set(++nextTimer, fn); return nextTimer; },
    cancel: (id) => timers.delete(id),
  });
  return {
    controller, timers, delays, statuses, applied,
    get calls() { return calls; },
    async tick() {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
      await flush();
    },
  };
}

test('prolonged state failure stops after five delayed retries; events cannot bypass backoff or cap', async () => {
  const f = refetchFixture(async () => { throw new Error('503'); });
  f.controller.queue(2);
  await flush();
  for (let i = 0; i < 5; i++) {
    f.controller.queue(3 + i);
    await flush();
    assert.equal(f.calls, i + 1, 'version events must not bypass the pending timer');
    await f.tick();
  }
  assert.equal(f.calls, 6);
  assert.deepEqual(f.delays, [500, 1000, 2000, 4000, 8000]);
  assert.equal(f.timers.size, 0);
  f.controller.queue(100);
  f.controller.queue();
  await flush();
  assert.equal(f.calls, 6, 'an exhausted cycle must wait for an explicit retry');
  assert.equal(f.statuses.filter((status) => status === 'failed').length, 1);
});

test('manual recovery resets the budget, loads the latest pending version, and resumes normal updates', async () => {
  let healthy = false, nextVersion = 2;
  const f = refetchFixture(async () => {
    if (!healthy) throw new Error('offline');
    return { version: nextVersion };
  });
  f.controller.queue(2);
  await flush();
  while (f.timers.size) await f.tick();
  healthy = true;
  f.controller.retry();
  await flush();
  assert.deepEqual(f.applied, [2]);
  assert.equal(f.statuses.at(-1), 'idle');
  nextVersion = 3;
  f.controller.queue(3);
  await flush();
  assert.deepEqual(f.applied, [2, 3]);
});

test('events received during a request coalesce into one follow-up for the newest version', async () => {
  const first = deferred();
  let initial = true;
  const f = refetchFixture(() => { if (initial) { initial = false; return first.promise; } return { version: 4 }; });
  f.controller.queue(2);
  await flush();
  f.controller.queue(3);
  f.controller.queue(4);
  f.controller.queue(4);
  first.resolve({ version: 2 });
  await flush();
  assert.equal(f.calls, 2);
  assert.deepEqual(f.applied, [2, 4]);
  assert.equal(f.timers.size, 0);
});

test('stale successful state responses use the same bounded backoff instead of spinning', async () => {
  const f = refetchFixture(async () => ({ version: 1 }));
  f.controller.queue(2);
  await flush();
  while (f.timers.size) await f.tick();
  assert.equal(f.calls, 6);
  assert.equal(f.statuses.at(-1), 'failed');
});

for (const outcome of ['resolve', 'reject']) {
  test(`disposal ignores late ${outcome} and never recreates timers`, async () => {
    const pending = deferred();
    const f = refetchFixture(() => pending.promise);
    f.controller.queue(2);
    await flush();
    f.controller.dispose();
    const statusCount = f.statuses.length;
    pending[outcome](outcome === 'resolve' ? { version: 2 } : new Error('503'));
    await flush();
    f.controller.queue(3);
    f.controller.retry();
    await flush();
    assert.equal(f.calls, 1);
    assert.deepEqual(f.applied, []);
    assert.equal(f.statuses.length, statusCount);
    assert.equal(f.timers.size, 0);
  });
}

test('disposal cancels backoff; disposal before the first microtask sends no request', async () => {
  const f = refetchFixture(async () => { throw new Error('503'); });
  f.controller.queue(2);
  await flush();
  assert.equal(f.timers.size, 1);
  f.controller.dispose();
  assert.equal(f.timers.size, 0);
  const early = refetchFixture(async () => ({ version: 2 }));
  early.controller.queue(2);
  early.controller.dispose();
  await flush();
  assert.equal(early.calls, 0);
});

function connectionFixture() {
  const events = {}, statuses = [], invocations = [];
  let starts = 0, stops = 0, restored = 0, closed = 0;
  const connection = {
    state: 'Disconnected',
    startGate: null,
    joinGate: null,
    async start() { starts++; if (this.startGate) await this.startGate; this.state = 'Connected'; },
    async stop() { stops++; this.state = 'Disconnected'; events.close?.(); },
    async invoke(method, room) { invocations.push([method, room]); if (this.joinGate) await this.joinGate; },
    onreconnected: (callback) => { events.reconnected = callback; },
    onreconnecting: (callback) => { events.reconnecting = callback; },
    onclose: (callback) => { events.close = callback; },
  };
  const controller = createRoomConnectionLifecycle(connection, 'room-1', {
    onStatusChange: (status) => statuses.push(status),
    onReconnected: () => restored++,
    onClose: () => closed++,
  });
  return {
    connection, controller, events, statuses, invocations,
    get starts() { return starts; }, get stops() { return stops; },
    get restored() { return restored; }, get closed() { return closed; },
  };
}

test('terminal SignalR close stays disconnected until one deduplicated manual restart rejoins and refetches', async () => {
  const f = connectionFixture();
  await f.controller.start();
  f.connection.state = 'Disconnected';
  f.events.close(new Error('retry policy exhausted'));
  await flush();
  assert.equal(f.statuses.at(-1), 'disconnected');
  assert.equal(f.starts, 1, 'terminal failure must not start an unbounded reconnect loop');
  const gate = deferred();
  f.connection.startGate = gate.promise;
  const first = f.controller.restart();
  const second = f.controller.restart();
  assert.equal(first, second);
  assert.equal(f.starts, 2);
  gate.resolve();
  await first;
  assert.deepEqual(f.invocations, [['JoinRoom', 'room-1'], ['JoinRoom', 'room-1']]);
  assert.equal(f.restored, 1);
  assert.equal(f.statuses.at(-1), 'connected');
});

test('automatic reconnect waits for successful room rejoin before marking connected or refetching', async () => {
  const f = connectionFixture();
  await f.controller.start();
  const gate = deferred();
  f.connection.joinGate = gate.promise;
  f.events.reconnecting();
  f.events.reconnected();
  f.events.reconnected();
  await flush();
  assert.equal(f.statuses.at(-1), 'reconnecting');
  assert.equal(f.restored, 0);
  gate.resolve();
  await flush();
  assert.equal(f.starts, 1);
  assert.equal(f.invocations.length, 2);
  assert.equal(f.restored, 1);
});

test('failed JoinRoom closes the orphan transport and leaves a manual recovery path', async () => {
  const f = connectionFixture();
  await f.controller.start();
  const gate = deferred();
  f.connection.joinGate = gate.promise;
  f.events.reconnected();
  gate.reject(new Error('join interrupted'));
  await flush();
  assert.equal(f.restored, 0);
  assert.equal(f.stops, 1);
  assert.equal(f.closed, 1);
  assert.equal(f.statuses.at(-1), 'disconnected');
  f.connection.joinGate = null;
  await f.controller.restart();
  assert.equal(f.restored, 1);
});

test('dispose during start closes a late connection and never joins or notifies the old page', async () => {
  const f = connectionFixture();
  const gate = deferred();
  f.connection.startGate = gate.promise;
  const start = f.controller.start();
  await f.controller.stop();
  const statusCount = f.statuses.length;
  gate.resolve();
  await start;
  f.events.reconnected();
  f.events.reconnecting();
  f.events.close();
  await f.controller.restart();
  assert.equal(f.connection.state, 'Disconnected');
  assert.equal(f.starts, 1);
  assert.equal(f.invocations.length, 0);
  assert.equal(f.restored, 0);
  assert.equal(f.closed, 0);
  assert.equal(f.statuses.length, statusCount);
});
