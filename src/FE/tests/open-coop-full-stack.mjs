// Full two-player run of the open co-op test case "Trâm hồng ngọc mất tích": every puzzle mounts in
// the real game, both roles solve, the wall is pinned, the timeline placed, lies cracked, the first
// accusation is rejected and the second wins.
// Needs a Development API (seeded admin) and the Vite dev server (the dev-only test hook):
//   API_URL=http://localhost:5299 WEB_URL=http://127.0.0.1:5173 OUT=./test-results/open-coop node tests/open-coop-full-stack.mjs
// Optional: PW_CHROMIUM=/path/to/chrome when Playwright's own browser is not installed.
import { chromium, request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
const API = process.env.API_URL ?? 'http://localhost:5299', WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173', OUT = process.env.OUT ?? './test-results/open-coop';
mkdirSync(OUT, { recursive: true });
const api = await request.newContext({ baseURL: API });
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(method, path, token, data) {
  const headers = { 'X-Forwarded-For': ip(), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const r = await api.fetch(path, { method, headers, data });
  const t = await r.text(); if (!r.ok()) throw new Error(`${method} ${path} ${r.status()} ${t.slice(0, 300)}`); return JSON.parse(t).data;
}
const fails = [];
const check = (ok, label) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); if (!ok) fails.push(label); };
const pw = 'PixelTest12345';
async function user(n) {
  const email = `full${n}_${Date.now()}@tests.invalid`;
  await call('POST', '/api/auth/register', null, { fullName: `Thám tử ${n}`, email, password: pw });
  return call('POST', '/api/auth/login', null, { email, password: pw });
}
const admin = await call('POST', '/api/auth/login', null, { email: 'admin@sirlocked.local', password: 'Admin123!' });
await call('POST', '/api/admin/cases/seed-pixel-demo', admin.token).catch((e) => console.log('seed:', e.message.slice(0, 90)));
const gameCase = await call('GET', '/api/admin/cases/case-pixel-tram-hong-ngoc-vi', admin.token);
const parse = (v) => (typeof v === 'string' ? JSON.parse(v || '{}') : v ?? {});
const inv = await user('w'), int = await user('s');
const room = await call('POST', '/api/rooms', inv.token, { caseId: 'case-pixel-tram-hong-ngoc-vi' });
await call('POST', '/api/rooms/join', int.token, { roomCode: room.roomCode });
for (const [a, role] of [[inv, 'INVESTIGATOR'], [int, 'INTERROGATOR']]) { await call('POST', `/api/rooms/${room.roomId}/select-role`, a.token, { role }); await call('POST', `/api/rooms/${room.roomId}/ready`, a.token, { isReady: true }); }
await call('POST', `/api/rooms/${room.roomId}/start`, inv.token);
const R = `/api/game/rooms/${room.roomId}`;
const st = (a) => call('GET', `${R}/state`, a.token);
let s = await st(inv);
check(s.ruleSet === 'OPEN_COOP' && s.unlockedSceneIds.length === 6, 'open co-op: every place open from the start');
check(!s.availableForAccusation, 'accusation closed before the first evidence');

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors = [];
async function open(a, label, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { errors.push(`${label}: ${e.message}`); console.log('PAGEERROR', label, e.message); });
  await page.addInitScript((auth) => { localStorage.setItem('sirlocked.token', auth.token); localStorage.setItem('sirlocked.refreshToken', auth.refreshToken); localStorage.setItem('sirlocked.refreshExpiry', auth.refreshTokenExpiry); localStorage.setItem('sirlocked.user', JSON.stringify(auth.user)); localStorage.setItem('sirlocked.uiLanguage', 'vi'); }, a);
  await page.goto(`${WEB}/game/${room.roomId}`);
  try { await page.locator('#intro-dismiss').click({ timeout: 20000 }); } catch { await page.reload(); await page.locator('#intro-dismiss').click({ timeout: 30000 }); }
  await page.waitForTimeout(1200);
  return page;
}
const w = await open(inv, 'watson'), sh = await open(int, 'sherlock');
const go = (a, sceneId) => call('POST', `${R}/go-to-scene`, a.token, { sceneId });

// prerequisites: the pharmacy book (balance scale) and the blank letter (reagent mix)
await go(inv, 'scene-tn-hieu-thuoc'); await call('POST', `${R}/inspect-item`, inv.token, { itemId: 'item-tn-so-gui' });
await go(inv, 'scene-tn-cam-do'); await call('POST', `${R}/inspect-item`, inv.token, { itemId: 'item-tn-la-thu-trang' });
s = await st(inv);
check(s.availableForAccusation, 'accusation opens with the first evidence');
check(s.collectedItemIds.includes('item-tn-la-thu-trang'), 'blank letter collected');

// every puzzle mounts in the real game (Watson), then gets solved over the API — alternating roles
const answerFor = (p) => {
  const sol = parse(p.solution), par = parse(p.params);
  switch (p.kind) {
    case 'lockpick': return { order: sol.order };
    case 'torn_paper': return { placed: Array.from({ length: par.pieceCount }, (_, i) => ({ id: i + 1, x: 0, y: 0, r: 0 })) };
    case 'fingerprint': return { card: sol.card };
    case 'doc_forgery': return { marks: sol.marks };
    case 'music_box': return { pins: sol.melody };
    case 'gear_train': return { mount: sol.mount };
    case 'balance_scale': return { pick: sol.heavy };
    case 'parallax_code': return { code: sol.code };
    case 'tilt_maze': return { moves: sol.moves };
    case 'reagent_mix': return { drops: sol.recipe };
    default: return {};
  }
};
const sceneOf = (targetId) => gameCase.stages.flatMap((stage) => stage.scenes).find((scene) => (scene.hotspots ?? []).some((h) => h.targetId === targetId) || (scene.itemIds ?? []).includes(targetId) || (scene.items ?? []).some((i) => (i.itemId ?? i) === targetId))?.sceneId;
const slotEmpty = async () => w.locator('#game-puzzle-slot').evaluate((el) => el.innerHTML.trim().length === 0);
const openPuzzle = async (id, wait = 800) => { await w.evaluate((x) => window.__sirlockedTest.openPuzzle(x), id); await w.waitForTimeout(wait); };
let n = 0;
for (const p of gameCase.puzzles) {
  const scene = sceneOf(p.targetId);
  await go(inv, scene);
  await w.waitForTimeout(2600);
  await w.evaluate((id) => window.__sirlockedTest.openPuzzle(id), p.puzzleId);
  await w.waitForTimeout(1300);
  const mounted = await w.locator(`[data-pzh-puzzle="${p.puzzleId}"] [data-pzh-body] *`).count();
  const missing = await w.locator('.pzh-missing').count();
  check(mounted > 0 && missing === 0, `${p.kind} mounts in the game (${scene})`);
  await w.screenshot({ path: `${OUT}/p-${String(++n).padStart(2, '0')}-${p.kind}.png` });
  // Close button, then Esc: the sheet must really leave the page (it used to stay until some other redraw).
  await w.locator(`[data-pzh-puzzle="${p.puzzleId}"] .pz-head-act [data-pzh-close]`).click();
  await w.waitForTimeout(500);
  check(await slotEmpty(), `${p.kind}: the Close button closes the puzzle`);
  await openPuzzle(p.puzzleId);
  await w.keyboard.press('Escape'); await w.waitForTimeout(500);
  check(await slotEmpty(), `${p.kind}: Esc closes the puzzle`);
  const solver = n % 2 ? inv : int;
  if (solver === int) await go(int, scene);
  const partnerSolves = solver === int;
  if (partnerSolves) await openPuzzle(p.puzzleId); // Watson has it open while Sherlock solves it
  if (p.kind === 'torn_paper' && parse(p.params).partnerPiece) await call('POST', `${R}/puzzle-probe`, solver.token, { puzzleId: p.puzzleId, payload: JSON.stringify({ handoff: true }) });
  const res = await call('POST', `${R}/solve-puzzle`, solver.token, { puzzleId: p.puzzleId, answer: JSON.stringify(answerFor(p)) }).catch((e) => ({ error: e.message }));
  if (partnerSolves) {
    // The partner just solved it while Watson has it open. Whether or not the SOLVED card has appeared yet
    // (it covers the header Close button on purpose), Esc must close the sheet and nothing may pop back up.
    await w.waitForTimeout(250);
    await w.keyboard.press('Escape');
    await w.waitForTimeout(1800);
    const left = await w.locator('#game-puzzle-slot').evaluate((el) => el.innerHTML.trim().slice(0, 160));
    check(left === '' && (await w.locator('.pzh-win').count()) === 0, `${p.kind}: Esc right after the partner solved it leaves nothing behind${left ? ' — left: ' + left.replace(/\s+/g, ' ') : ''}`);
  }
  const solved = (res.state?.solvedPuzzleIds ?? []).includes(p.puzzleId) || res.state?.visibleScene?.puzzles?.find?.((x) => x.puzzleId === p.puzzleId)?.isSolved;
  check(!res.error && solved !== false, `${p.kind} solved by ${solver === inv ? 'Watson' : 'Sherlock'}${res.error ? ' — ' + res.error.slice(0, 120) : ''}`);
  // A solved puzzle reopens on its SOLVED card; "Back to the investigation" and Esc both close it.
  await w.waitForTimeout(1500);
  await openPuzzle(p.puzzleId, 900);
  const winBtn = w.locator(`[data-pzh-puzzle="${p.puzzleId}"] .pzh-win [data-pzh-close]`);
  check((await winBtn.count()) > 0, `${p.kind}: a solved puzzle shows the SOLVED card`);
  await winBtn.click().catch(() => {});
  await w.waitForTimeout(500);
  check(await slotEmpty(), `${p.kind}: "Back to the investigation" closes the solved puzzle`);
  await openPuzzle(p.puzzleId, 900);
  await w.keyboard.press('Escape'); await w.waitForTimeout(500);
  check(await slotEmpty(), `${p.kind}: Esc closes the solved puzzle`);
  check((await w.locator('#game-puzzle-slot').count()) === 1 && (await w.evaluate(() => window.__sirlockedTest.state()?.currentSceneId)) === scene, `${p.kind}: the game is back to exploring`);
}
s = await st(inv);
const puzzleEvidence = gameCase.puzzles.flatMap((p) => p.unlockClueIds);
check(puzzleEvidence.every((id) => s.unlockedClueIds.includes(id)), 'every puzzle unlocked its evidence');

// Sherlock questions everyone
for (const d of gameCase.dialogues) {
  const scene = gameCase.stages.flatMap((stage) => stage.scenes).find((sc) => (sc.characterIds ?? sc.characters ?? []).some?.((c) => (c.characterId ?? c) === d.characterId))?.sceneId
    ?? (d.characterId.includes('buu') ? 'scene-tn-cam-do' : 'scene-tn-nha-xe');
  await go(int, scene);
  await call('POST', `${R}/ask-dialogue`, int.token, { dialogueId: d.dialogueId }).catch((e) => console.log('ask', d.dialogueId, e.message.slice(0, 100)));
}
await go(inv, 'scene-tn-nha-xe'); await call('POST', `${R}/inspect-item`, inv.token, { itemId: 'item-tn-so-sua-xe' });
s = await st(int);
check(s.privateTestimonies.length === gameCase.testimonyFragments.length, `Sherlock heard every statement (${s.privateTestimonies.length}/${gameCase.testimonyFragments.length})`);
check(s.board.envelope.length > 10, `envelope holds the found cards (${s.board.envelope.length})`);

// the wall on both screens
await w.waitForTimeout(3000);
for (const page of [w, sh]) { if (!(await page.locator('.ocw-wall').count())) { await page.locator('#case-file-btn').click().catch(() => {}); await page.waitForTimeout(1200); } }
await w.screenshot({ path: `${OUT}/w-01-watson-envelope.png` });
await sh.screenshot({ path: `${OUT}/w-02-sherlock-envelope.png` });

// pin everything: statements on their speaker, evidence on who it points to
const speaker = (fragmentId) => gameCase.dialogues.find((d) => d.dialogueId === gameCase.testimonyFragments.find((f) => f.id === fragmentId).dialogueId).characterId;
const owner = (id) => (id.startsWith('frag-') ? speaker(id) : gameCase.clues.find((c) => c.clueId === id).relatedCharacterIds[0] ?? 'case');
const wrongTarget = (id) => (owner(id) === 'char-tn-dang-buu' ? 'char-tn-trinh-luc' : 'char-tn-dang-buu');
const first = s.board.envelope[0];
const wrong = await call('POST', `${R}/board/pin`, inv.token, { itemId: first, targetId: wrongTarget(first) });
check(parse(wrong.puzzleFeedback).correct === false, 'a wrong pin is refused');
const hint = await call('POST', `${R}/board/hint`, int.token);
check(parse(hint.puzzleFeedback).targetId === owner(parse(hint.puzzleFeedback).itemId), 'the hint names the right person');
for (const [i, id] of s.board.envelope.entries()) {
  const r = await call('POST', `${R}/board/pin`, i % 2 ? int.token : inv.token, { itemId: id, targetId: owner(id) });
  if (parse(r.puzzleFeedback).correct !== true) check(false, `pin ${id}`);
}
s = await st(inv);
check(s.board.envelope.length === 0 && s.board.pins.length === s.board.totalItems - 1, `wall pinned (${s.board.pins.length}/${s.board.totalItems}, the camera photo is still out there)`);
check(s.board.links.length >= 4, `authored strings visible (${s.board.links.length})`);
await w.waitForTimeout(2500);
await w.screenshot({ path: `${OUT}/w-03-watson-pinned.png` });
await sh.screenshot({ path: `${OUT}/w-04-sherlock-pinned.png` });

// timeline: place the open cards in order
for (let guard = 0; guard < 6; guard++) {
  s = await st(inv);
  const open = s.timeline.open; if (!open.length) break;
  const card = open[0];
  const truth = gameCase.timeline.events;
  const key = truth.find((e) => e.eventId === card.eventId).sortKey;
  const before = s.timeline.placed.filter((e) => truth.find((t) => t.eventId === e.eventId).sortKey < key).at(-1);
  const r = await call('POST', `${R}/timeline/place`, int.token, { eventId: card.eventId, afterEventId: before?.eventId ?? null });
  check(parse(r.puzzleFeedback).correct === true, `timeline: ${card.label}`);
}
s = await st(inv);
check(s.unlockedClueIds.includes('fact-tn-gio-that'), 'timeline revealed the true night');

// Crack the Lie: Sherlock drafts, Watson brings the evidence, both confirm
for (const ch of gameCase.evidenceChallenges) {
  const attemptId = randomUUID();
  let c = await call('POST', `${R}/paired-confrontations`, int.token, { attemptId, testimonyFragmentId: ch.testimonyFragmentId });
  c = await call('PUT', `${R}/paired-confrontations/${attemptId}/evidence`, inv.token, { evidenceId: ch.correctEvidenceId, expectedRevision: c.revision });
  c = await call('POST', `${R}/paired-confrontations/${attemptId}/confirm`, inv.token, { expectedRevision: c.revision });
  c = await call('POST', `${R}/paired-confrontations/${attemptId}/confirm`, int.token, { expectedRevision: c.revision });
  check(c.status === 'ResolvedCorrect' || c.status === 'RESOLVED_CORRECT' || c.status === 2, `cracked ${ch.challengeId} (${c.status})`);
}
await w.waitForTimeout(6000);
for (const page of [w, sh]) { if (!(await page.locator('.ocw-wall').count())) { await page.locator('#case-file-btn').click().catch(() => {}); await page.waitForTimeout(1200); } }
await w.screenshot({ path: `${OUT}/w-05-cracked.png` });

// accusation 1: wrong person → rejected, one attempt left, both told
const fl = gameCase.finalLogic;
const links = fl.requiredEvidenceLinks;
const proposal = (culpritId) => ({ culpritId, motiveId: fl.correctMotiveId, methodId: fl.correctMethodId, evidenceLinks: links, evidenceIds: links.map((l) => l.evidenceId) });
let a = await call('POST', `${R}/accusation`, inv.token, proposal('char-tn-trinh-luc'));
a = await call('POST', `${R}/accusation/${a.accusation.attemptId}/confirm`, int.token, { expectedRevision: a.accusation.revision });
check(a.rejected === true && !a.result, 'first wrong accusation is rejected, case goes on');
await w.waitForTimeout(1500);
await w.screenshot({ path: `${OUT}/a-01-watson-rejected.png` });
await sh.screenshot({ path: `${OUT}/a-02-sherlock-rejected.png` });
s = await st(inv);
check(s.accusationAttemptsLeft === 1 && s.roomStatus !== 'COMPLETED', 'one accusation left');
// accusation 2: right
a = await call('POST', `${R}/accusation`, int.token, proposal('char-tn-dang-buu'));
a = await call('POST', `${R}/accusation/${a.accusation.attemptId}/confirm`, inv.token, { expectedRevision: a.accusation.revision });
check(Boolean(a.result) && a.result.isCorrect !== false, `second accusation solves the case (score ${a.result?.score ?? a.result?.scoreSummary?.total ?? '?'})`);
console.log('score summary', JSON.stringify(a.result?.scoreSummary ?? a.result?.score ?? {}).slice(0, 400));
await w.waitForTimeout(3000);
await w.screenshot({ path: `${OUT}/a-03-watson-result.png` });
check(errors.length === 0, `no page errors (${errors.length})`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nALL CHECKS PASSED');
process.exitCode = fails.length ? 1 : 0;
