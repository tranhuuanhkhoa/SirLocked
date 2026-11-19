import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { commsGameState, commsRoomId } from './fixtures/commsGameState';

/**
 * "Đàm thoại & điện tín": the chat and voice dock of a match.
 * Chat runs against a mocked API. Voice runs for real: two browsers with fake microphones connect over WebRTC, and the
 * test passes the hub messages between them the way GameHub does.
 */
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      // Host candidates as plain IPs: the container cannot resolve the .local names Chrome uses otherwise.
      '--disable-features=WebRtcHideLocalIpsWithMdns',
    ],
  },
});

type Json = Record<string, any>;
const roomId = commsRoomId;
const ME = { userId: 'player-1', fullName: 'Smoke Player' };
const PARTNER = { userId: 'player-2', fullName: 'Partner' };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const line = (id: string, userId: string, text: string, sentAt: string): Json => ({
  id, roomId, userId, username: userId === ME.userId ? 'Smoke Player' : 'Partner', role: userId === ME.userId ? 'INVESTIGATOR' : 'INTERROGATOR', text, sentAt,
});

async function open(page: Page, options: { user?: typeof ME; state?: Json; history?: Json[]; reducedMotion?: boolean } = {}) {
  const user = options.user ?? ME;
  if (options.reducedMotion !== false) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(([id, u]) => {
    localStorage.setItem('sirlocked.token', `token-${u.userId}`);
    localStorage.setItem('sirlocked.uiLanguage', 'vi');
    localStorage.setItem('sirlocked.user', JSON.stringify({ userId: u.userId, fullName: u.fullName, role: 'PLAYER', isEmailVerified: true }));
    sessionStorage.setItem(`sirlocked.intro.${id}`, '1');
    (window as any).__sirlockedNoSignalR = true;
  }, [roomId, user] as const);
  const sent: Json[] = [];
  await page.route(`**/api/game/rooms/${roomId}/state`, (route) => route.fulfill({ json: { success: true, data: options.state ?? commsGameState } }));
  await page.route(`**/api/game/rooms/${roomId}/chat`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      sent.push(body);
      if (body.text === 'quá nhanh') return route.fulfill({ status: 429, json: { success: false, message: 'Too fast.' } });
      return route.fulfill({ json: { success: true, data: line(`sent-${sent.length}`, user.userId, body.text, new Date().toISOString()) } });
    }
    return route.fulfill({ json: { success: true, data: options.history ?? [] } });
  });
  await page.route(`**/api/game/rooms/${roomId}/voice`, (route) =>
    route.fulfill({ json: { success: true, data: { iceServers: [], hasRelay: false, relayOnly: false } } }));
  await page.goto(`/game/${roomId}`);
  await expect(page.locator('[data-tc-chat]')).toBeVisible();
  return { sent };
}

/** The voice-channel calls the page made of the hub (the WebRTC set-up messages left out unless asked for). */
const invocations = (page: Page, withSignals = false) => page.evaluate((signals) => ((window as any).__sirlockedSignalRInvocations ?? [])
  .filter((call: Json) => String(call.method).startsWith('Voice') && (signals || call.method !== 'VoiceSignal'))
  .map((call: Json) => ({ method: call.method, args: call.args })), withSignals);
const emit = (page: Page, event: string, payload: Json) =>
  page.evaluate(([e, p]) => (window as any).__sirlockedEmitSignalR(e, p), [event, payload] as const);

// ------------------------------------------------------------------ chat

test('a partner\'s telegram blinks a red seal and a preview; opening the drawer reads it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { reducedMotion: false, history: [line('h1', ME.userId, 'Mình vào phòng khách rồi.', minutesAgo(3))] });
  const chat = page.locator('[data-tc-chat]');
  const badge = page.locator('[data-tc-badge]');
  // The player's own earlier line is not news.
  await expect(badge).toBeHidden();
  await expect(chat).toHaveAttribute('data-unread', 'false');

  await emit(page, 'TeamChatMessage', line('p1', PARTNER.userId, 'Xem đồng hồ trên lò sưởi, kim dừng ở 2:17.', new Date().toISOString()));
  await expect(badge).toHaveText('1');
  await expect(chat).toHaveAttribute('data-unread', 'true');
  await expect(chat).toHaveAttribute('aria-label', 'Điện tín, 1 tin chưa đọc');
  // It blinks: the seal pulses and the button flashes red.
  expect(await badge.evaluate((el) => getComputedStyle(el).animationName)).toBe('tc-seal');
  expect(await chat.evaluate((el) => getComputedStyle(el).animationName)).toBe('tc-alarm');
  const preview = page.locator('[data-tc-preview]');
  await expect(preview).toContainText('Partner: Xem đồng hồ trên lò sưởi');
  // The same line pushed twice (a retry of the hub) counts once.
  await emit(page, 'TeamChatMessage', line('p1', PARTNER.userId, 'Xem đồng hồ trên lò sưởi, kim dừng ở 2:17.', new Date().toISOString()));
  await expect(badge).toHaveText('1');
  // A line of another room is not this room's.
  await emit(page, 'TeamChatMessage', { ...line('other', PARTNER.userId, 'phòng khác', new Date().toISOString()), roomId: 'another-room' });
  await expect(badge).toHaveText('1');

  await preview.click();
  const panel = page.locator('[data-tc-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h2')).toHaveText('Gửi Partner');
  await expect(panel.locator('.tc-msg')).toHaveCount(2);
  await expect(panel.locator('.tc-msg.is-theirs.is-sherlock')).toContainText('kim dừng ở 2:17');
  await expect(panel.locator('.tc-msg.is-mine')).toContainText('Mình vào phòng khách rồi.');
  await expect(badge).toBeHidden();
  await expect(chat).toHaveAttribute('data-unread', 'false');
  await expect(page.locator('[data-tc-input]')).toBeFocused();
  // While the drawer is open, a new line is read at once.
  await emit(page, 'TeamChatMessage', line('p2', PARTNER.userId, 'Nhanh lên!', new Date().toISOString()));
  await expect(panel.locator('.tc-msg')).toHaveCount(3);
  await expect(badge).toBeHidden();
});

test('history unread since the last visit is counted after a reload, and only once', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const history = [line('h1', PARTNER.userId, 'Ở đây!', minutesAgo(5)), line('h2', PARTNER.userId, 'Thấy chưa?', minutesAgo(4))];
  await open(page, { history });
  await expect(page.locator('[data-tc-badge]')).toHaveText('2');
  await page.locator('[data-tc-chat]').click();
  await expect(page.locator('[data-tc-badge]')).toBeHidden();
  await page.reload();
  await expect(page.locator('[data-tc-chat]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-tc-badge]')).toBeHidden();
});

test('typing a telegram never walks the detective; Enter sends, Shift+Enter breaks the line, Escape closes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { sent } = await open(page);
  // T opens the drawer from the scene.
  await page.locator('canvas').first().click({ position: { x: 700, y: 300 } });
  await page.keyboard.press('t');
  const input = page.locator('[data-tc-input]');
  await expect(input).toBeFocused();
  await page.keyboard.type('wasd e dấu bùn');
  await expect(input).toHaveValue('wasd e dấu bùn');
  await page.waitForTimeout(400);
  // Had the scene seen W, A, S or D, the detective would have walked and told the hub so.
  const walked = await page.evaluate(() => ((window as any).__sirlockedSignalRInvocations ?? [])
    .filter((call: any) => call.method === 'UpdatePlayerPose' && call.args[1]?.moving).length);
  expect(walked).toBe(0);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('ở cửa sổ');
  await page.keyboard.press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ text: 'wasd e dấu bùn\nở cửa sổ' });
  await expect(input).toHaveValue('');
  const mine = page.locator('.tc-msg.is-mine');
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.tc-text')).toHaveText('wasd e dấu bùn\nở cửa sổ');
  // The server also pushes the sender's own line: still one.
  const id = await mine.getAttribute('data-tc-line');
  await emit(page, 'TeamChatMessage', line(id!, ME.userId, 'wasd e dấu bùn\nở cửa sổ', new Date().toISOString()));
  await expect(mine).toHaveCount(1);
  // An empty line is not sent.
  await input.fill('   ');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  expect(sent.length).toBe(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-tc-panel]')).toBeHidden();
  await expect(page.locator('[data-tc-chat]')).toBeFocused();
});

test('a line too long is stopped before sending, and sending too fast is explained', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { sent } = await open(page);
  await page.locator('[data-tc-chat]').click();
  const input = page.locator('[data-tc-input]');
  const message = page.locator('[data-tc-form-msg]');
  await input.fill('a'.repeat(250));
  await expect(message).toHaveText('250/300');
  await input.fill('b'.repeat(301));
  await expect(message).toHaveText('301/300');
  await expect(message).toHaveAttribute('data-over', 'true');
  await page.keyboard.press('Enter');
  await expect(message).toHaveText('Tối đa 300 ký tự.');
  expect(sent).toHaveLength(0);
  // Emoji count as one character each, like on the server.
  await input.fill('🕵️'.repeat(300));
  await page.keyboard.press('Enter');
  await expect.poll(() => sent.length).toBe(1);

  await input.fill('quá nhanh');
  await page.keyboard.press('Enter');
  await expect(message).toHaveText('Gửi chậm lại một chút rồi gửi tiếp.');
  await expect(input).toHaveValue('quá nhanh');
});

test('the solo tutorial has no dock and no T shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { state: { ...commsGameState, isTutorial: true, players: [commsGameState.players[0]] } }).catch(() => undefined);
  await expect(page.locator('[data-tc]')).toBeHidden();
  await page.keyboard.press('t');
  await expect(page.locator('[data-tc-panel]')).toBeHidden();
});

// ------------------------------------------------------------------ voice controls (hub mocked)

test('speaker and mic open the voice channel through the hub; speaker off closes both and frees the mic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const speaker = page.locator('[data-tc-speaker]');
  const mic = page.locator('[data-tc-mic]');
  const status = page.locator('[data-tc-status]');
  await expect(speaker).toHaveAttribute('aria-pressed', 'false');
  await expect(status).toContainText('Loa đang tắt');

  // The partner turns their mic on while this player's speaker is off: the speaker asks for attention.
  await emit(page, 'VoiceState', { roomId, userId: PARTNER.userId, inVoice: true, micOn: true, fresh: true });
  await expect(speaker).toHaveAttribute('data-state', 'calling');
  await expect(status).toContainText('Partner đang bật mic. Bật loa để nghe.');

  await page.evaluate(() => { (window as any).__sirlockedSignalRInvoke = (method: string) => method === 'VoiceJoin' ? { peers: [] } : undefined; });
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => invocations(page)).toEqual([{ method: 'VoiceJoin', args: [roomId, false] }]);
  // The partner already had voice open and this player has the smaller id: this side calls, with an offer for audio.
  await expect.poll(async () => (await invocations(page, true)).find((call) => call.method === 'VoiceSignal')?.args.slice(0, 2)).toEqual([roomId, PARTNER.userId]);
  const offer = (await invocations(page, true)).find((call) => call.method === 'VoiceSignal')!.args[2];
  expect(offer.kind).toBe('offer');
  expect(offer.sdp).toContain('m=audio');
  // Remembered for the next match.
  expect(await page.evaluate(() => localStorage.getItem('sirlocked.comms.speaker'))).toBe('1');

  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await invocations(page)).at(-1)).toEqual({ method: 'VoiceMic', args: [roomId, true] });

  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await invocations(page)).at(-1)).toEqual({ method: 'VoiceMic', args: [roomId, false] });

  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-pressed', 'false');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await invocations(page)).at(-1)).toEqual({ method: 'VoiceLeave', args: [roomId] });
  expect(await page.evaluate(() => localStorage.getItem('sirlocked.comms.speaker'))).toBeNull();
});

test('a blocked microphone says how to allow it, and nothing is sent', async ({ browser }) => {
  // A context without the microphone permission and without the auto-accepting fake prompt.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  });
  await open(page);
  const mic = page.locator('[data-tc-mic]');
  await mic.click();
  await expect(mic).toHaveAttribute('data-state', 'problem');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect(mic).toHaveAttribute('title', /ổ khóa trên thanh địa chỉ/);
  expect(await invocations(page)).toEqual([]);
  await context.close();
});

// ------------------------------------------------------------------ a real call between two browsers

type Seat = { context: BrowserContext; page: Page; user: typeof ME };

/** Two players, each in their own browser context, their hub messages passed between them like GameHub does. */
async function twoPlayers(browser: Browser, width = 1440, height = 900) {
  const seats: Seat[] = [];
  const voice = new Map<string, boolean>();
  for (const user of [ME, PARTNER]) {
    const context = await browser.newContext({ viewport: { width, height }, permissions: ['microphone'] });
    const page = await context.newPage();
    // Keeps every microphone stream the page opens, to check later that it was released.
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).__tcStreams = [];
      const Native = window.RTCPeerConnection;
      (window as any).__tcPcs = [];
      (window as any).RTCPeerConnection = function (this: unknown, ...args: any[]) {
        const pc = new (Native as any)(...args);
        (window as any).__tcPcs.push(pc);
        return pc;
      } as any;
      (window as any).RTCPeerConnection.prototype = Native.prototype;
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        (window as any).__tcStreams.push(stream);
        return stream;
      };
    });
    seats.push({ context, page, user });
  }
  const other = (seat: Seat) => seats.find((entry) => entry !== seat)!;
  for (const seat of seats) {
    await seat.page.exposeFunction('__sirlockedSignalRInvoke', async (method: string, args: any[]) => {
      const to = other(seat).page;
      if (method === 'VoiceJoin') {
        voice.set(seat.user.userId, args[1]);
        const peers = [...voice].filter(([id]) => id !== seat.user.userId).map(([id, micOn]) => ({ userId: id, micOn }));
        await emit(to, 'VoiceState', { roomId, userId: seat.user.userId, inVoice: true, micOn: args[1], fresh: true });
        return { peers };
      }
      if (method === 'VoiceMic') {
        voice.set(seat.user.userId, args[1]);
        await emit(to, 'VoiceState', { roomId, userId: seat.user.userId, inVoice: true, micOn: args[1] });
      }
      if (method === 'VoiceLeave') {
        voice.delete(seat.user.userId);
        await emit(to, 'VoiceState', { roomId, userId: seat.user.userId, inVoice: false, micOn: false });
      }
      if (method === 'VoiceSignal' && voice.has(other(seat).user.userId)) {
        await emit(to, 'VoiceSignal', { roomId, fromUserId: seat.user.userId, ...args[2] });
      }
      return undefined;
    });
    await open(seat.page, { user: seat.user, reducedMotion: false });
  }
  return { seats, voice, close: () => Promise.all(seats.map((seat) => seat.context.close())) };
}

const remoteAudio = (page: Page) => page.locator('[data-tc-audio]').evaluate((audio: HTMLAudioElement) => {
  const stream = audio.srcObject as MediaStream | null;
  const track = stream?.getAudioTracks()[0];
  return track ? { state: track.readyState, playing: !audio.paused } : null;
});

test('two players hear each other over a real WebRTC connection, and either side can hang up', async ({ browser }) => {
  test.setTimeout(90_000);
  const { seats, voice, close } = await twoPlayers(browser);
  const [firstSide, secondSide] = seats;
  try {
    // Player 1 listens first; player 2 then turns the mic on, which opens their speaker too.
    await firstSide.page.locator('[data-tc-speaker]').click();
    await expect(firstSide.page.locator('[data-tc-status]')).toContainText('Chờ Partner bật loa…');
    await secondSide.page.locator('[data-tc-mic]').click();
    await expect(secondSide.page.locator('[data-tc-speaker]')).toHaveAttribute('aria-pressed', 'true');

    for (const seat of seats) {
      await expect(seat.page.locator('[data-tc-status]')).toHaveAttribute('data-link', 'connected', { timeout: 20_000 });
    }
    // Each sees the other by name: player 1's partner is "Partner", player 2's is "Smoke Player".
    await expect(firstSide.page.locator('[data-tc-status]')).toContainText(/Đang nghe Partner|Partner đang nói/);
    await expect(secondSide.page.locator('[data-tc-status]')).toContainText(/Đã nối máy với Smoke|Smoke đang nói/);
    // Player 1 receives player 2's microphone, and plays it.
    await expect.poll(() => remoteAudio(firstSide.page), { timeout: 15_000 }).toEqual({ state: 'live', playing: true });
    // The fake microphone beeps: player 1 sees their partner speaking, and player 2 their own level.
    await expect(firstSide.page.locator('[data-tc]')).toHaveAttribute('data-partner-speaking', 'true', { timeout: 15_000 });
    await expect(secondSide.page.locator('[data-tc-mic]')).toHaveAttribute('data-state', /on|speaking/);
    await expect(firstSide.page.locator('.tc-pmic.is-on')).toBeVisible();

    // Player 2 mutes: the connection stays, the partner's mic shows off.
    await secondSide.page.locator('[data-tc-mic]').click();
    await expect(firstSide.page.locator('.tc-pmic')).not.toHaveClass(/is-on/);
    await expect(firstSide.page.locator('[data-tc-status]')).toHaveAttribute('data-link', 'connected');
    // And turns it back on without a new handshake.
    await secondSide.page.locator('[data-tc-mic]').click();
    await expect(firstSide.page.locator('[data-tc]')).toHaveAttribute('data-partner-speaking', 'true', { timeout: 15_000 });

    // Player 1 hangs up: player 2 waits again, player 1's audio is released.
    await firstSide.page.locator('[data-tc-speaker]').click();
    expect(voice.has(ME.userId)).toBe(false);
    await expect(secondSide.page.locator('[data-tc-status]')).toContainText('Chờ Smoke bật loa…');
    expect(await remoteAudio(firstSide.page)).toBeNull();

    // Player 1 comes back: they connect again.
    await firstSide.page.locator('[data-tc-speaker]').click();
    for (const seat of seats) {
      await expect(seat.page.locator('[data-tc-status]')).toHaveAttribute('data-link', 'connected', { timeout: 20_000 });
    }
  } finally {
    await close();
  }
});

test('a partner who reloads comes back on the line by themselves, mic off, speaker remembered', async ({ browser }) => {
  test.setTimeout(90_000);
  const { seats, voice, close } = await twoPlayers(browser);
  const [firstSide, secondSide] = seats;
  try {
    await firstSide.page.locator('[data-tc-mic]').click();
    await secondSide.page.locator('[data-tc-speaker]').click();
    for (const seat of seats) await expect(seat.page.locator('[data-tc-status]')).toHaveAttribute('data-link', 'connected', { timeout: 20_000 });

    await secondSide.page.reload();
    await expect(secondSide.page.locator('[data-tc-speaker]')).toHaveAttribute('aria-pressed', 'true');
    await expect(secondSide.page.locator('[data-tc-mic]')).toHaveAttribute('aria-pressed', 'false');
    // The reloaded side announced a fresh join: the other side dropped the old connection and called again.
    for (const seat of seats) await expect(seat.page.locator('[data-tc-status]')).toHaveAttribute('data-link', 'connected', { timeout: 20_000 });
    expect(voice.has(PARTNER.userId)).toBe(true);
    await expect.poll(() => remoteAudio(secondSide.page), { timeout: 15_000 }).toEqual({ state: 'live', playing: true });
    await expect(secondSide.page.locator('[data-tc]')).toHaveAttribute('data-partner-speaking', 'true', { timeout: 15_000 });
  } finally {
    await close();
  }
});

test('leaving the match frees the microphone and leaves voice', async ({ browser }) => {
  test.setTimeout(60_000);
  const { seats, voice, close } = await twoPlayers(browser);
  const [first] = seats;
  try {
    await first.page.locator('[data-tc-mic]').click();
    await expect(first.page.locator('[data-tc-mic]')).toHaveAttribute('aria-pressed', 'true');
    const liveTracks = () => first.page.evaluate(() => ((window as any).__tcStreams as MediaStream[])
      .flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === 'live').length);
    expect(await liveTracks()).toBe(1);
    expect(voice.has(ME.userId)).toBe(true);
    // Leaving through the app (no page reload), as the menu link does.
    await first.page.evaluate(() => { history.pushState({}, '', '/menu'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect.poll(() => voice.has(ME.userId)).toBe(false);
    expect(await liveTracks()).toBe(0);
    await expect(first.page.locator('[data-tc]')).toHaveCount(0);
  } finally {
    await close();
  }
});

// ------------------------------------------------------------------ phone

test('on a phone the dock is three round buttons and the drawer a sheet above the tools', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { history: [line('h1', PARTNER.userId, 'Ở đây!', minutesAgo(2))] });
  const tools = page.locator('.tc-tool');
  await expect(tools).toHaveCount(3);
  for (const tool of await tools.all()) {
    const box = (await tool.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await expect(page.locator('[data-tc-badge]')).toHaveText('1');
  await page.locator('[data-tc-chat]').click();
  const panel = page.locator('[data-tc-panel]');
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  // The sheet is on top: what is under its middle belongs to it, not to the tool tray.
  const onTop = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('[data-tc-panel]')), [box.x + box.width / 2, box.y + box.height - 30] as const);
  expect(onTop).toBe(true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
