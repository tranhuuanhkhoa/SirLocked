// The pixel catalogue over HTTP: with CaseCatalog:PixelOnly on (the default) players only see and play
// pixel cases, the older cases stay for admins, and an English search is still matched.
//   API_URL=http://localhost:5499 node tests/pixel-catalog-api.mjs
import { request } from '@playwright/test';
const API = process.env.API_URL ?? 'http://localhost:5299';
const api = await request.newContext({ baseURL: API });
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function raw(method, path, token, data) {
  const r = await api.fetch(path, { method, headers: { 'X-Forwarded-For': ip(), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, data });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status(), body, data: body?.data, errors: body?.errors };
}
const fails = [];
const check = (ok, label) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); if (!ok) fails.push(label); };
const PIXEL = ['case-pixel-lo-thuoc-thu-nam-vi', 'case-pixel-tram-hong-ngoc-vi'];
const OLD = 'case-v3-broken-seal-vi';
const pw = 'PixelTest12345';
async function user(n) {
  const email = `cat${n}_${Date.now()}@tests.invalid`;
  await raw('POST', '/api/auth/register', null, { fullName: `Thám tử ${n}`, email, password: pw });
  return (await raw('POST', '/api/auth/login', null, { email, password: pw })).data;
}
const admin = (await raw('POST', '/api/auth/login', null, { email: 'admin@sirlocked.local', password: 'Admin123!' })).data;
const a = await user('a'), b = await user('b');

// the API seeded the pixel cases by itself when it started; add the older ones so there is something to hide
await raw('POST', '/api/admin/cases/seed-crack-demo', admin.token);
await raw('POST', '/api/admin/cases/seed-point-click-demo', admin.token);

const published = (await raw('GET', '/api/cases/published', a.token)).data;
check(published.length === 2 && PIXEL.every((id) => published.some((c) => c.caseId === id)), `players list only the pixel cases (${published.map((c) => c.caseId).join(', ')})`);
check(published.every((c) => c.isPixel === true), 'every listed case says isPixel');

// Older cases are hidden from the admin list by default and come back with ?includeLegacy=true
const adminDefault = (await raw('GET', '/api/admin/cases', admin.token)).data;
check(adminDefault.length === 2 && adminDefault.every((c) => c.isPixel === true), `the admin list shows only the pixel cases by default (${adminDefault.map((c) => c.caseId).join(', ')})`);
const adminList = (await raw('GET', '/api/admin/cases?includeLegacy=true', admin.token)).data;
check(adminList.length >= 6, `?includeLegacy=true shows every case again (${adminList.length})`);
const old = adminList.filter((c) => !c.isPixel && c.status === 'PUBLISHED');
check(old.length >= 4 && old.every((c) => c.playerVisible === false), `older cases are flagged hidden for players (${old.length})`);
check(adminList.filter((c) => c.isPixel).every((c) => c.playerVisible === true), 'pixel cases are flagged visible');
const board = (await raw('GET', '/api/admin/dashboard', admin.token)).data;
check(board?.legacyCasesHidden === true && board.totalCases === 2, `the dashboard counts only pixel cases and says legacy ones are hidden (${board?.totalCases}, ${board?.legacyCasesHidden})`);

check((await raw('GET', `/api/cases/${OLD}`, a.token)).status === 404, 'an older case detail is 404 for players');
check((await raw('GET', `/api/cases/${PIXEL[1]}`, a.token)).data?.isPixel === true, 'a pixel case detail opens');
check((await raw('GET', `/api/admin/cases/${OLD}`, admin.token)).status === 200, 'admin can still open the older case');

const oldReviews = await raw('GET', `/api/workshop/cases/${OLD}/reviews/summary`, a.token);
check(oldReviews.status === 200 && oldReviews.data?.totalReviews === 0, 'reviews of an older case read as empty');
const oldBoard = await raw('GET', `/api/workshop/cases/${OLD}/leaderboard`, a.token);
check(oldBoard.status === 200 && oldBoard.data?.totalRanked === 0, 'the leaderboard of an older case reads as empty');
check((await raw('GET', `/api/workshop/cases/${OLD}/reviews/eligibility`, a.token)).status === 404, 'reviewing an older case is 404');
check((await raw('GET', '/api/profile/me', a.token)).status !== 500, 'the profile still loads');
const refused = await raw('POST', '/api/rooms', a.token, { caseId: OLD, visibility: 'PRIVATE' });
check(refused.status === 422 && refused.errors?.code === 'CASE_NOT_PLAYABLE', `a room for an older case is refused (${refused.status} ${refused.errors?.code})`);
const room = await raw('POST', '/api/rooms', a.token, { caseId: PIXEL[1], visibility: 'PUBLIC' });
check(room.status === 200 && room.data?.caseId === PIXEL[1], 'a room for a pixel case is created');
const open = (await raw('GET', '/api/rooms/public?openOnly=true', b.token)).data;
check(Array.isArray(open) && open.some((r) => r.roomCode === room.data.roomCode), 'the public room is listed');

// English + long: nothing fits exactly, the search widens
await raw('POST', '/api/matchmaking/cancel', a.token); await raw('POST', '/api/matchmaking/cancel', b.token);
const prefs = { mode: 'QUICK', preferredRole: 'ANY', caseLength: 'LONG', language: 'en' };
const q1 = await raw('POST', '/api/matchmaking/queue', a.token, prefs);
const q2 = await raw('POST', '/api/matchmaking/queue', b.token, prefs);
check(q1.status === 200 && q2.status === 200 && q2.data?.phase === 'FOUND', `an English / long search is still matched (${q2.status} ${q2.data?.phase})`);
check(PIXEL.includes(q2.data?.match?.caseId) && q2.data?.match?.language === 'vi', `...with a Vietnamese pixel case (${q2.data?.match?.caseId}, ${q2.data?.match?.language})`);
await raw('POST', `/api/matchmaking/matches/${q2.data.match.matchId}/decline`, a.token);
await raw('POST', '/api/matchmaking/cancel', a.token); await raw('POST', '/api/matchmaking/cancel', b.token);

const shop = (await raw('GET', '/api/workshop/cases?pageSize=48', a.token)).data;
check(shop.total === 2 && shop.items.every((c) => PIXEL.includes(c.caseId)), `the workshop lists only pixel cases (${shop.total})`);
check((await raw('GET', `/api/workshop/cases/${OLD}/stats`, a.token)).status === 404, 'workshop stats of an older case are 404');

const featuredOld = await raw('POST', '/api/admin/weekly', admin.token, { type: 'CASE_OF_WEEK', caseId: OLD, weekStart: new Date(Date.now() - 864e5).toISOString(), weekEnd: new Date(Date.now() + 6 * 864e5).toISOString() });
check(featuredOld.status === 400, `an older case cannot be the case of the week (${featuredOld.status})`);
const featuredPixel = await raw('POST', '/api/admin/weekly', admin.token, { type: 'CASE_OF_WEEK', caseId: PIXEL[1], weekStart: new Date(Date.now() - 864e5).toISOString(), weekEnd: new Date(Date.now() + 6 * 864e5).toISOString() });
check(featuredPixel.status === 200, `a pixel case can be (${featuredPixel.status})`);
check((await raw('GET', '/api/workshop/weekly/case-of-week', a.token)).data?.caseId === PIXEL[1], 'the home page reads the pixel case of the week');

// the admin button refreshes the pixel cases even while a room is playing one of them
const refresh = await raw('POST', '/api/admin/cases/seed-pixel-demo', admin.token);
check(refresh.status === 200 && refresh.data.length === 2, 'the admin "create / refresh pixel cases" button works');
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
