import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGateway, signSession, validSession } from './playtest-gateway.mjs';

const secret = 's'.repeat(64), password = 'p'.repeat(32);

test('signed access sessions reject forgery, expiry and distant expiry', () => {
  const now = Math.floor(Date.now()/1000);
  assert.equal(validSession(secret, signSession(secret, now+120), now), true);
  assert.equal(validSession(secret, signSession('other', now+120), now), false);
  assert.equal(validSession(secret, signSession(secret, now-1), now), false);
  assert.equal(validSession(secret, signSession(secret, now+86400), now), false);
});

test('remote gateway protects files, blocks admin/registration and proxies player HTTP and WebSocket', { timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sirlocked-gateway-'));
  await fs.writeFile(path.join(root, 'index.html'), '<title>Frozen game</title>');
  await fs.writeFile(path.join(root, 'secret.json'), '{"truth":"private"}');
  await fs.writeFile(path.join(root, '.env'), 'secret=private');
  const api = http.createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ path: request.url, cookie: request.headers.cookie || null, clientIp: request.headers['x-forwarded-for'] })); });
  const apiSockets = new Set();
  api.on('connection', socket => { apiSockets.add(socket); socket.on('close', () => apiSockets.delete(socket)); });
  api.on('upgrade', (request, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', data => socket.write(data));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const gateway = await createGateway({ root, apiPort: api.address().port, secret, accessPassword: password });
  t.after(async () => { for (const socket of apiSockets) socket.destroy(); await gateway.close(); await new Promise(resolve => api.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${gateway.port}`;
  assert.equal((await fetch(url + '/playtest/access')).headers.get('referrer-policy'), 'same-origin', 'Browser form POST must retain its same-origin Origin header');
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 303);
  assert.equal((await fetch(url + '/api/cases/published')).status, 401);
  assert.equal((await fetch(url + '/playtest/access', { method: 'POST', body: 'password=wrong' })).status, 401);
  const login = await fetch(url + '/playtest/access', { method: 'POST', body: `password=${password}`, headers: { 'x-forwarded-proto': 'https' }, redirect: 'manual' });
  assert.equal(login.status, 303);
  const header = login.headers.get('set-cookie');
  assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.match(header, /Secure/);
  const cookie = header.split(';')[0];
  const auth = { headers: { cookie } };
  assert.equal((await fetch(url, auth)).status, 200);
  for (const resource of ['/secret.json', '/.env', '/api/admin/users', '/api/admin/ai-cases', '/api/auth/register', '/swagger/index.html', '/api/%61dmin/users']) {
    assert.equal((await fetch(url + resource, auth)).status, 404, resource);
  }
  const response = await fetch(url + '/api/game/rooms/room/state', auth);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).cookie, null);
  const ip = await fetch(url + '/api/auth/me', { headers: { cookie, 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': 'attacker-controlled' } });
  assert.equal((await ip.json()).clientIp, '203.0.113.9', 'Remote players must retain their own login rate-limit partition');
  assert.equal((await fetch(url + '/api/rooms', { method: 'POST', headers: { cookie, origin: 'https://attacker.invalid' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/playtest/access', { method: 'POST', headers: { origin: 'https://attacker.invalid' }, body: `password=${password}` })).status, 403);
  const echoed = await new Promise((resolve, reject) => {
    const socket = net.connect(gateway.port, '127.0.0.1');
    let data = ''; socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('WebSocket proxy timeout')); });
    socket.on('connect', () => socket.write(`GET /hubs/game?access_token=fixture HTTP/1.1\r\nHost: 127.0.0.1:${gateway.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nCookie: ${cookie}\r\n\r\n`));
    socket.on('data', chunk => { data += chunk.toString(); if (data.includes('101 Switching Protocols') && !data.includes('probe')) socket.write('probe'); if (data.includes('probe')) { socket.destroy(); resolve(data); } });
    socket.on('error', reject);
  });
  assert.match(echoed, /101 Switching Protocols/);
});
