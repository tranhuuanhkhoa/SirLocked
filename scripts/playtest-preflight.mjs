// Technical rehearsal only. It never writes observations, interviews or human-gate evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] || '');
if (!root.startsWith(path.join(repo, 'tmp', 'playtest') + path.sep)) throw new Error('Expected a managed playtest batch.');
const { chromium, expect } = createRequire(path.join(repo, 'src/FE/package.json'))('@playwright/test');
const state = JSON.parse(await fs.readFile(path.join(root, 'processes.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const credentials = JSON.parse(await fs.readFile(path.join(root, 'private/credentials.json'), 'utf8'));
const baseURL = process.env.SIRLOCKED_PREFLIGHT_URL || state.gatewayUrl;
const browser = await chromium.launch({ headless: true });
const errors = [];
const failedAssets = [];
const probes = [];
const technicalRoomIds = [];
let room, investigator, interrogator, invAuth, intAuth;

async function player(email) {
  const account = credentials.accounts.find(a => a.email === email);
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && /\.(png|jpg|webp|js|css)(\?|$)/.test(response.url())) failedAssets.push(new URL(response.url()).pathname); });
  await page.goto('/playtest/access');
  await page.locator('input[name=password]').fill(credentials.accessPassword);
  await page.locator('button').click();
  try { await page.waitForURL('**/#/login', { timeout: 10000 }); }
  catch (error) {
    console.error('Access navigation:', page.url(), (await page.locator('body').innerText()).slice(0, 500), 'cookie names:', (await context.cookies()).map(c => c.name));
    throw error;
  }
  const response = await context.request.post('/api/auth/login', { data: { email: account.email, password: account.password } });
  const payload = await response.json();
  assert.equal(response.status(), 200, `Dedicated player login: ${payload.message}`);
  const auth = payload.data;
  return { context, page, auth };
}
async function call(player, method, route, data) {
  const response = await player.context.request.fetch(route, { method, data, headers: { Authorization: `Bearer ${player.auth.token}` } });
  if (!response.ok()) throw new Error(`${method} ${route.replace(/rooms\/[^/]+/, 'rooms/<id>')} returned ${response.status()}`);
  return (await response.json()).data;
}
async function openGame(player) {
  const initialize = ({ auth, roomId }) => {
    localStorage.setItem('sirlocked.token', auth.token); localStorage.setItem('sirlocked.user', JSON.stringify(auth.user));
    localStorage.setItem('sirlocked.refreshToken', auth.refreshToken); localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry);
    localStorage.setItem('sirlocked.uiLanguage', 'en'); sessionStorage.setItem(`sirlocked.intro.${roomId}`, '1');
  };
  await player.page.addInitScript(initialize, { auth: player.auth, roomId: room.roomId });
  await player.page.evaluate(initialize, { auth: player.auth, roomId: room.roomId });
  await player.page.goto(`/#/game/${room.roomId}`);
  await expect(player.page.locator('#case-file-btn')).toBeVisible({ timeout: 20000 });
}

try {
  const unauth = await browser.newContext({ baseURL });
  assert.equal((await unauth.request.get('/api/cases/published')).status(), 401);
  await unauth.close(); probes.push('Unauthenticated API blocked');
  investigator = await player('a03-investigator@playtest.invalid');
  interrogator = await player('a03-interrogator@playtest.invalid');
  invAuth = investigator.auth; intAuth = interrogator.auth;
  for (const route of ['/api/admin/users', '/api/admin/ai-cases', '/swagger/index.html', '/.env', '/case-assets.json'])
    assert.equal((await investigator.context.request.get(route)).status(), 404);
  assert.equal((await investigator.context.request.post('/api/auth/register', { data: {} })).status(), 404);
  probes.push('Admin/AI/registration/secret files blocked through gateway');
  const cases = await call(investigator, 'GET', '/api/cases/published');
  assert.deepEqual(cases.map(c => c.caseId).sort(), manifest.cases.map(c => c.caseId).sort());
  probes.push('Published catalogue matches all selected frozen cases');
  room = await call(investigator, 'POST', '/api/rooms', { caseId: 'case-v3-broken-seal-en' });
  technicalRoomIds.push(room.roomId);
  await call(interrogator, 'POST', '/api/rooms/join', { roomCode: room.roomCode });
  for (const [actor, role] of [[investigator, 'INVESTIGATOR'], [interrogator, 'INTERROGATOR']]) {
    await call(actor, 'POST', `/api/rooms/${room.roomId}/select-role`, { role });
    await call(actor, 'POST', `/api/rooms/${room.roomId}/ready`, { isReady: true });
  }
  await call(investigator, 'POST', `/api/rooms/${room.roomId}/start`);
  const outsider = await player('a02-investigator@playtest.invalid');
  const forbidden = await outsider.context.request.get(`/api/game/rooms/${room.roomId}/state`, { headers: { Authorization: `Bearer ${outsider.auth.token}` } });
  assert.ok([403, 404].includes(forbidden.status()));
  await outsider.context.close(); probes.push('Non-member cannot read game state');
  for (const itemId of ['item-blue-wax-en', 'item-ticket-en', 'item-thread-en'])
    await call(investigator, 'POST', `/api/game/rooms/${room.roomId}/inspect-item`, { itemId });
  await call(interrogator, 'POST', `/api/game/rooms/${room.roomId}/ask-dialogue`, { dialogueId: 'dlg-mara-statement-en' });
  const invState = await call(investigator, 'GET', `/api/game/rooms/${room.roomId}/state`);
  const intState = await call(interrogator, 'GET', `/api/game/rooms/${room.roomId}/state`);
  assert.ok(invState.privateEvidence.length > 0); assert.equal(invState.privateTestimonies.length, 0);
  assert.ok(intState.privateTestimonies.length > 0); assert.equal(intState.privateEvidence.length, 0);
  probes.push('Role-private knowledge remains separated');
  await openGame(investigator); await openGame(interrogator);
  await expect.poll(async () => (await call(investigator, 'GET', `/api/rooms/${room.roomId}`)).players.every(p => p.isConnected), { timeout: 20000 }).toBe(true);
  probes.push('Two real browser sessions connect through SignalR gateway');
  for (const actor of [investigator, interrogator])
    await call(actor, 'POST', `/api/game/rooms/${room.roomId}/playtest-events`, { eventType: 'WaitingEnded', durationMs: 1000 });
  await investigator.page.reload();
  await expect(investigator.page.locator('#case-file-btn')).toBeVisible();
  await expect.poll(async () => (await call(investigator, 'GET', `/api/rooms/${room.roomId}`)).players.every(p => p.isConnected)).toBe(true);
  probes.push('Reload reconnects to the same room');
  await interrogator.context.close();
  await expect.poll(async () => (await call(investigator, 'GET', `/api/rooms/${room.roomId}`)).players.find(p => p.role === 'INTERROGATOR').isConnected).toBe(false);
  interrogator = await player('a03-interrogator@playtest.invalid'); await openGame(interrogator);
  await expect.poll(async () => (await call(investigator, 'GET', `/api/rooms/${room.roomId}`)).players.every(p => p.isConnected)).toBe(true);
  probes.push('Partner disconnect/reconnect restores presence through gateway');
  assert.deepEqual(errors, [], 'No browser script errors'); assert.deepEqual(failedAssets, [], 'No missing packaged assets');
  probes.push('Game assets load without browser errors');
  await investigator.page.screenshot({ path: path.join(root, 'logs/preflight-investigator.png'), fullPage: true });
  for (const fixture of manifest.cases.filter(c => !c.caseId.startsWith('case-v3-broken-seal-'))) {
    // Abandon intentionally requires a disconnected partner and the recovery grace
    // period. Probe rooms remain technical evidence; never bypass those game rules.
    room = await call(investigator, 'POST', '/api/rooms', { caseId: fixture.caseId });
    technicalRoomIds.push(room.roomId);
    await call(interrogator, 'POST', '/api/rooms/join', { roomCode: room.roomCode });
    for (const [actor, role] of [[investigator, 'INVESTIGATOR'], [interrogator, 'INTERROGATOR']]) {
      await call(actor, 'POST', `/api/rooms/${room.roomId}/select-role`, { role });
      await call(actor, 'POST', `/api/rooms/${room.roomId}/ready`, { isReady: true });
    }
    await call(investigator, 'POST', `/api/rooms/${room.roomId}/start`);
    await openGame(investigator); await openGame(interrogator);
    await expect.poll(async () => (await call(investigator, 'GET', `/api/rooms/${room.roomId}`)).players.every(p => p.isConnected), { timeout: 20000 }).toBe(true);
    const document = JSON.parse(await fs.readFile(path.join(root, fixture.path), 'utf8'));
    const media = new Set();
    function collect(value) {
      if (typeof value === 'string' && value.startsWith('/assets/')) media.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    }
    collect(document);
    for (const url of media) {
      const asset = await investigator.context.request.head(url);
      assert.equal(asset.status(), 200, `Selected case asset: ${url}`);
    }
    assert.deepEqual(errors, [], 'No browser errors in selected case');
    assert.deepEqual(failedAssets, [], 'No missing selected case assets');
    await investigator.page.screenshot({ path: path.join(root, `logs/preflight-${fixture.caseId}.png`), fullPage: true });
    probes.push(`${document.title}: both roles enter the first scene; all ${media.size} referenced media files available`);
  }
  await fs.writeFile(path.join(root, 'logs/preflight.json'), JSON.stringify({ status: 'PASS', technicalOnly: true, humanGate: 'NOT RUN', testedUrl: baseURL, completedUtc: new Date().toISOString(), technicalRoomIds, probes }, null, 2));
  console.log(`Technical preflight PASS: ${probes.length} checks, two browser contexts. Human gate: NOT RUN.`);
} finally {
  if (room && investigator) { try { await call(investigator, 'POST', `/api/rooms/${room.roomId}/abandon`); } catch {} }
  await browser.close();
}
