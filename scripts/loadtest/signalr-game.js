import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';
import { BASE_URL, prepareUsers, freshToken, SEPARATOR } from './lib/auth.js';

const selected = __ENV.SCENARIO || 'smoke';
const requestedVus = Number(__ENV.VUS || 50);
const maxVus = Number(__ENV.MAX_VUS || 200);
const targetVus = selected === 'smoke' ? 2 : selected === 'load' ? requestedVus : maxVus;
const gameCommandLatency = new Trend('game_command_latency', true);
const gameCommandSamples = new Counter('game_command_samples');
const sessionSuccesses = new Rate('signalr_session_success');
const roomWaitMs = 90_000;
const stages = count => [{ duration: '1m', target: Math.max(2, Math.floor(count / 4) * 2) }, { duration: '1m', target: count }, { duration: '3m', target: count }];
if (!['smoke', 'load', 'stress'].includes(selected)) throw new Error('SCENARIO must be smoke, load, or stress.');
if (targetVus < 2 || targetVus % 2 !== 0) throw new Error('SignalR scenarios require an even VUS count of at least 2.');

export const options = {
  scenarios: {
    selected: selected === 'smoke'
      ? { executor: 'constant-vus', vus: 2, duration: '30s' }
      : selected === 'load'
        ? { executor: 'ramping-vus', startVUs: 2, stages: stages(requestedVus) }
        : { executor: 'ramping-vus', startVUs: 2, stages: [{ duration: '1m', target: 50 }, { duration: '1m', target: 100 }, { duration: '1m', target: 150 }, { duration: '30s', target: maxVus }, { duration: '1m30s', target: maxVus }] },
  },
  summaryTrendStats: ['min', 'med', 'avg', 'max', 'p(50)', 'p(95)', 'p(99)'],
  thresholds: {
    game_command_latency: ['p(95)<1000'],
    signalr_session_success: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

function call(method, path, token, body, kind = 'api') {
  const response = http.request(method, `${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    tags: { kind },
  });
  check(response, [`${method} ${path} returns 200`].reduce((result, key) => ({ ...result, [key]: r => r.status === 200 }), {}));
  return response;
}

function dataOf(response) {
  try { return response.json()?.data; } catch { return null; }
}

function prepareCase() {
  const adminResponse = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email: 'admin@sirlocked.local', password: 'Admin123!' }), {
    headers: { 'Content-Type': 'application/json' }, tags: { kind: 'setup' },
  });
  const admin = dataOf(adminResponse);
  check(adminResponse, { 'development admin login succeeds': r => r.status === 200 && Boolean(admin?.token) });
  if (!admin?.token) throw new Error('Development admin login failed.');
  const existingResponse = http.get(`${BASE_URL}/api/admin/cases/case-week2-manor`, {
    headers: { Authorization: `Bearer ${admin.token}` }, tags: { kind: 'setup' },
    responseCallback: http.expectedStatuses(200, 404),
  });
  let caseId = 'case-week2-manor';
  const existing = dataOf(existingResponse);
  if (existingResponse.status === 404) {
    const seededResponse = http.post(`${BASE_URL}/api/admin/cases/seed-sample?publish=false`, null, {
      headers: { Authorization: `Bearer ${admin.token}` }, tags: { kind: 'setup' },
    });
    const seeded = dataOf(seededResponse);
    check(seededResponse, { 'sample case is seeded': r => r.status === 200 && Boolean(seeded?.caseId) });
    if (!seeded?.caseId) throw new Error('Sample case could not be seeded.');
    caseId = seeded.caseId;
  } else if (existing?.status !== 'PUBLISHED' && existing?.status !== 'DRAFT') {
    throw new Error('Existing sample case has an unsupported status.');
  }
  if (existing?.status !== 'PUBLISHED') {
    const publishedResponse = http.patch(`${BASE_URL}/api/admin/cases/${caseId}/publish`, null, {
      headers: { Authorization: `Bearer ${admin.token}` }, tags: { kind: 'setup' },
    });
    check(publishedResponse, { 'sample case is published': r => r.status === 200 });
  }
  return caseId;
}

export function setup() {
  return { users: prepareUsers(targetVus), caseId: prepareCase(), startedAt: Date.now() };
}

function hostRoom(user, caseId) {
  const created = dataOf(call('POST', '/api/rooms', freshToken(user), { caseId, visibility: 'PUBLIC' }));
  if (!created?.roomId) throw new Error('Host could not create a room.');
  return created;
}

function joinHostRoom(user, hostName, startedAt) {
  const deadline = Date.now() + roomWaitMs;
  while (Date.now() < deadline) {
    const listing = dataOf(call('GET', `/api/rooms/public?openOnly=true&language=ALL&q=${encodeURIComponent(hostName)}&limit=100`, freshToken(user)));
    const candidate = listing?.find(room => room.hostUsername === hostName && room.isJoinable &&
      room.playerCount === 1 && Date.parse(room.createdAt) >= startedAt);
    if (candidate) {
      const joined = dataOf(call('POST', '/api/rooms/join', freshToken(user), { roomCode: candidate.roomCode }));
      if (!joined?.roomId) throw new Error('Partner could not join the room.');
      call('POST', `/api/rooms/${joined.roomId}/select-role`, freshToken(user), { role: 'INTERROGATOR' });
      call('POST', `/api/rooms/${joined.roomId}/ready`, freshToken(user), { isReady: true });
      return joined;
    }
    sleep(0.2);
  }
  throw new Error(`No open public room appeared for ${hostName}.`);
}

function roomUntil(user, roomId, predicate) {
  const deadline = Date.now() + roomWaitMs;
  while (Date.now() < deadline) {
    const room = dataOf(call('GET', `/api/rooms/${roomId}`, freshToken(user)));
    if (predicate(room)) return room;
    sleep(0.2);
  }
  throw new Error(`Room ${roomId} did not reach the expected state.`);
}

function connectAndJoin(user, roomId, isHost) {
  const token = freshToken(user);
  const hubUrl = `${BASE_URL.replace(/^http/, 'ws')}/hubs/game?access_token=${encodeURIComponent(token)}`;
  const state = { joined: false, completed: false, commandStarted: null, commandCount: 0, broadcast: false, failure: false };
  const response = ws.connect(hubUrl, { tags: { kind: 'signalr' } }, socket => {
    let handshake = false;
    let commandSent = false;
    const issueCommand = () => {
      const game = dataOf(call('GET', `/api/game/rooms/${roomId}/state`, freshToken(user)));
      const hotspot = game?.visibleScene?.hotspots?.find(item => item.type === 'ITEM' && !item.isLocked && !game.inspectedItemIds?.includes(item.targetId));
      if (!hotspot) {
        socket.close();
        return;
      }
      state.commandStarted = Date.now();
      state.commandCount += 1;
      const result = call('POST', `/api/game/rooms/${roomId}/inspect-item`, freshToken(user), { itemId: hotspot.targetId });
      if (result.status !== 200) state.failure = true;
    };
    const sendCommand = () => {
      if (!isHost || commandSent) return;
      commandSent = true;
      socket.setTimeout(issueCommand, 750);
    };
    socket.on('open', () => socket.send(`${JSON.stringify({ protocol: 'json', version: 1 })}${SEPARATOR}`));
    socket.on('message', message => {
      for (const record of String(message).split(SEPARATOR).filter(Boolean)) {
        let frame;
        try { frame = JSON.parse(record); } catch { state.failure = true; socket.close(); return; }
        if (!handshake) {
          if (frame.error) { state.failure = true; socket.close(); return; }
          handshake = true;
          socket.send(`${JSON.stringify({ type: 1, invocationId: 'join-room', target: 'JoinRoom', arguments: [roomId] })}${SEPARATOR}`);
          continue;
        }
        if (frame.type === 6) {
          socket.send(`${JSON.stringify({ type: 6 })}${SEPARATOR}`);
        } else if (frame.type === 1 && frame.target === 'RoomStateVersion' && frame.arguments?.[0]?.roomId === roomId) {
          state.joined = true;
          if (state.completed) sendCommand();
        } else if (frame.type === 3 && frame.invocationId === 'join-room') {
          if (frame.error) state.failure = true;
          state.completed = true;
          if (state.joined) sendCommand();
        } else if (frame.type === 1 && frame.target === 'GameStateUpdated' && frame.arguments?.[0]?.roomId === roomId) {
          state.broadcast = true;
          if (isHost && state.commandStarted !== null) {
            gameCommandLatency.add(Date.now() - state.commandStarted);
            gameCommandSamples.add(1);
            state.commandStarted = null;
            if (state.commandCount >= 3) socket.close();
            else socket.setTimeout(issueCommand, 100);
          }
        }
      }
    });
    socket.setTimeout(() => { if (!state.broadcast) state.failure = true; socket.close(); }, 30000);
  });
  check(response, { 'SignalR websocket connected': r => r && r.status === 101 });
  const successful = response?.status === 101 && state.joined && state.broadcast && !state.failure;
  sessionSuccesses.add(successful);
  check(null, { 'SignalR joined room and received game broadcast': () => successful });
}

export default function (data) {
  if (exec.vu.iterationInScenario > 0) {
    sleep(1);
    return;
  }
  const id = exec.vu.idInTest;
  const user = data.users[id - 1];
  if (id % 2 === 1) {
    const room = hostRoom(user, data.caseId);
    roomUntil(user, room.roomId, current => current?.players?.length === 2);
    call('POST', `/api/rooms/${room.roomId}/select-role`, freshToken(user), { role: 'INVESTIGATOR' });
    call('POST', `/api/rooms/${room.roomId}/ready`, freshToken(user), { isReady: true });
    roomUntil(user, room.roomId, current => current?.players?.length === 2 && current.players.every(player => player.isReady));
    const started = call('POST', `/api/rooms/${room.roomId}/start`, freshToken(user));
    if (started.status === 200) roomUntil(user, room.roomId, current => current?.status === 'IN_PROGRESS');
    connectAndJoin(user, room.roomId, true);
  } else {
    const hostName = data.users[id - 2].fullName;
    const room = joinHostRoom(user, hostName, data.startedAt);
    roomUntil(user, room.roomId, current => current?.status === 'IN_PROGRESS');
    connectAndJoin(user, room.roomId, false);
  }
}

export function handleSummary(data) {
  const values = name => data.metrics[name]?.values || {};
  const latency = values('game_command_latency');
  const failures = values('http_req_failed').rate;
  const text = [
    `SignalR scenario: ${selected}`,
    `Command-to-broadcast p50/p95/p99: ${latency['p(50)'] ?? 'n/a'} / ${latency['p(95)'] ?? 'n/a'} / ${latency['p(99)'] ?? 'n/a'} ms`,
    `HTTP RPS: ${values('http_reqs').rate ?? 'n/a'}`,
    `HTTP error %: ${failures === undefined ? 'n/a' : (failures * 100).toFixed(3)}`,
    `Max VUs: ${values('vus_max').max ?? 'n/a'}`,
    `Successful command samples: ${values('game_command_samples').count ?? 0}`,
  ].join('\n');
  const dir = __ENV.RESULTS_DIR || '/home/ubuntu/reports/loadtest/results';
  return {
    [`${dir}/signalr-game-${selected}.json`]: JSON.stringify(data, null, 2),
    [`${dir}/signalr-game-${selected}.txt`]: `${text}\n`,
    stdout: `${text}\n`,
  };
}
