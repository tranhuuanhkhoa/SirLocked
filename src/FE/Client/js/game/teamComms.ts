import '../../../css/56-team-comms.css';
import { teamCommsApi } from '../api/teamCommsApi.js';

/*
 * "Đàm thoại & điện tín": voice and chat between the two detectives of a match.
 *
 * Chat lines go through the server (stored, then pushed to the room as "TeamChatMessage").
 * Voice goes browser to browser over WebRTC. The server only checks who may talk and passes the set-up messages:
 *   1. "Loa" opens the player's voice channel (hub VoiceJoin). Nothing connects before that, so a player who never turns
 *      voice on never shares a network address with the partner.
 *   2. When both have voice open, the player with the smaller user id sends an offer; the other answers; ICE candidates
 *      follow (hub VoiceSignal). STUN finds a direct path; a TURN relay (if the server has one) covers strict networks.
 *   3. "Mic" asks the browser for the microphone and puts its track on the already-open connection (replaceTrack), so
 *      turning it on or off never renegotiates. Turning the speaker off also turns the mic off and closes the connection.
 */

type Translator = (en: string, vi: string) => string;

export type CommsPlayer = { userId: string; username: string; role?: string | null; isConnected?: boolean };
export type TeamChatLine = { id: string; roomId: string; userId: string; username: string; role?: string | null; text: string; sentAt: string };
/** `fresh`: the player just opened voice (again), so any old connection to them is stale. */
export type VoiceStatePayload = { roomId: string; userId: string; inVoice: boolean; micOn: boolean; fresh?: boolean; replaced?: boolean };
export type VoiceSignalPayload = {
  roomId: string; fromUserId: string; kind: 'offer' | 'answer' | 'candidate';
  sdp?: string | null; candidate?: string | null; sdpMid?: string | null; sdpMLineIndex?: number | null;
};
type IceConfig = { iceServers: { urls: string[]; username?: string | null; credential?: string | null }[]; hasRelay: boolean; relayOnly: boolean };
type CommsApi = {
  history: (roomId: string) => Promise<TeamChatLine[]>;
  send: (roomId: string, text: string) => Promise<TeamChatLine>;
  voice: (roomId: string) => Promise<IceConfig>;
};

export type TeamCommsOptions = {
  roomId: string;
  me: { userId: string };
  tr: Translator;
  /** Calls a GameHub method on the live connection. */
  invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
  api?: CommsApi;
  /** A sound for a partner's message or for the partner opening their microphone. */
  onCue?: (kind: 'message' | 'voice') => void;
};

export const MAX_CHAT_LENGTH = 300;
const SPEAKER_PREF = 'sirlocked.comms.speaker';
const SEEN_PREFIX = 'sirlocked.comms.seen.';
const SPEAKING_LEVEL = 0.035;
/** Speech has gaps between words: "speaking" holds this long after the last loud moment, so the light does not flicker. */
const SPEAKING_HOLD_MS = 700;
const RECONNECT_TRIES = 2;

const ICONS: Record<string, string> = {
  speaker: '<path d="M4 9.5v5h3.5L12.5 19V5L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  speakerOff: '<path d="M4 9.5v5h3.5L12.5 19V5L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M9 7.5h2M9 10.5h2"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/>',
  micOff: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/><path d="M4 4l16 16"/>',
  telegram: '<rect x="3" y="5.5" width="18" height="13" rx="1.2"/><path d="M3.6 6.4 12 12.8l8.4-6.4"/><path d="M3.6 17.6l6-5.2M20.4 17.6l-6-5.2"/>',
  send: '<path d="M4.5 11.6 19.5 4.5 15 19.5l-3.6-5.9z"/><path d="M11.4 13.6 19.5 4.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  retry: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
};

const icon = (name: string, className = 'tc-ic') =>
  `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Characters as a person counts them (an emoji is one), like the server's limit. */
export function visibleLength(text: string) {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: object) => { segment(text: string): Iterable<unknown> } }).Segmenter;
  if (!Segmenter) return Array.from(text).length;
  let count = 0;
  for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) count += 1;
  return count;
}

function readStorage(storage: 'local' | 'session', key: string) {
  try { return (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key); } catch { return null; }
}
function writeStorage(storage: 'local' | 'session', key: string, value: string | null) {
  try {
    const target = storage === 'local' ? window.localStorage : window.sessionStorage;
    if (value === null) target.removeItem(key); else target.setItem(key, value);
  } catch { /* private mode: the preference just isn't kept */ }
}

/** Sherlock questions people (INTERROGATOR), Watson handles objects (INVESTIGATOR). */
function detectiveOf(role?: string | null): 'sherlock' | 'watson' | null {
  return role === 'INTERROGATOR' ? 'sherlock' : role === 'INVESTIGATOR' ? 'watson' : null;
}

export function createTeamComms(options: TeamCommsOptions) {
  const { roomId, me, tr } = options;
  const api: CommsApi = options.api ?? {
    history: (id) => teamCommsApi.history(id),
    send: (id, text) => teamCommsApi.send(id, text),
    voice: (id) => teamCommsApi.voice(id),
  };
  const lifetime = new AbortController();
  let host: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let disposed = false;
  let connected = false;
  let everConnected = false;
  let players: CommsPlayer[] = [];
  let playersKey = '';
  let enabled = false;

  // chat
  const lines: TeamChatLine[] = [];
  const lineIds = new Set<string>();
  let chatOpen = false;
  let unread = 0;
  let historyRequested = false;
  let sending = false;
  let seenAt = Date.parse(readStorage('session', SEEN_PREFIX + roomId) ?? '') || 0;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  // voice
  let speakerOn = readStorage('local', SPEAKER_PREF) === '1';
  let micOn = false;
  let micProblem: 'denied' | 'missing' | 'insecure' | null = null;
  let joined = false;
  let joining: Promise<void> | null = null;
  let partnerVoice = { inVoice: false, micOn: false };
  let link: 'idle' | 'waiting' | 'connecting' | 'connected' | 'failed' = 'idle';
  let note: string | null = null;
  let ice: IceConfig | null = null;
  let pc: RTCPeerConnection | null = null;
  let pcPeer: string | null = null;
  let makingOffer = false;
  let failures = 0;
  let pendingCandidates: RTCIceCandidateInit[] = [];
  let localStream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let localMeter: (() => number) | null = null;
  let remoteMeter: (() => number) | null = null;
  let meterTimer: ReturnType<typeof setInterval> | undefined;
  let meSpeaking = false;
  let partnerSpeaking = false;
  let meLoudAt = 0;
  let partnerLoudAt = 0;
  let audioBlocked = false;

  const partner = () => players.find((player) => player.userId !== me.userId) ?? null;
  const partnerName = () => partner()?.username?.trim().split(/\s+/)[0] || tr('your partner', 'đồng đội');
  const $ = <T extends Element = HTMLElement>(selector: string) => root?.querySelector<T>(selector) ?? null;

  // ------------------------------------------------------------------ rendering

  function shell() {
    return `
      <aside class="tc" data-tc aria-label="${escape(tr('Voice and telegrams with your partner', 'Đàm thoại và điện tín với đồng đội'))}">
        <div class="tc-dock" data-tc-dock>
          <div class="tc-status" data-tc-status role="status" aria-live="polite"></div>
          <div class="tc-tools" role="group" aria-label="${escape(tr('Voice and telegrams', 'Đàm thoại và điện tín'))}">
            <button type="button" class="tc-tool" data-tc-speaker aria-pressed="false"></button>
            <button type="button" class="tc-tool" data-tc-mic aria-pressed="false"></button>
            <button type="button" class="tc-tool" data-tc-chat aria-expanded="false" aria-controls="tc-panel" aria-keyshortcuts="T">
              ${icon('telegram')}<span class="tc-lbl">${escape(tr('Telegram', 'Điện tín'))}</span>
              <span class="tc-badge" data-tc-badge hidden></span>
            </button>
          </div>
          <button type="button" class="tc-preview" data-tc-preview hidden></button>
        </div>
        <section class="tc-panel" id="tc-panel" data-tc-panel hidden aria-labelledby="tc-panel-title">
          <header class="tc-panel-hd">
            <span class="tc-seal" aria-hidden="true">${icon('telegram')}</span>
            <div class="tc-panel-tt">
              <span class="tc-kick">${escape(tr('Telegrams', 'Điện tín'))}</span>
              <h2 id="tc-panel-title" data-tc-title></h2>
            </div>
            <button type="button" class="tc-x" data-tc-close aria-label="${escape(tr('Close telegrams', 'Đóng điện tín'))}">${icon('x')}</button>
          </header>
          <ol class="tc-log" data-tc-log aria-live="polite" aria-relevant="additions"></ol>
          <form class="tc-form" data-tc-form novalidate>
            <label class="tc-sr" for="tc-input">${escape(tr('Message to your partner', 'Lời nhắn cho đồng đội'))}</label>
            <textarea id="tc-input" class="tc-input" data-tc-input rows="1" maxlength="${MAX_CHAT_LENGTH * 2}" autocomplete="off" spellcheck="true"
              placeholder="${escape(tr('Write a telegram… (Enter to send)', 'Viết điện tín… (Enter để gửi)'))}"></textarea>
            <button type="submit" class="tc-send" data-tc-send aria-label="${escape(tr('Send', 'Gửi'))}" title="${escape(tr('Send', 'Gửi'))}">${icon('send')}</button>
            <p class="tc-form-msg" data-tc-form-msg role="status" aria-live="polite"></p>
          </form>
        </section>
        <audio data-tc-audio autoplay playsinline hidden></audio>
      </aside>`;
  }

  function paint() {
    if (!root) return;
    root.hidden = !enabled;
    if (!enabled) return;
    const name = partnerName();
    const detective = detectiveOf(partner()?.role);

    const speaker = $<HTMLButtonElement>('[data-tc-speaker]')!;
    speaker.setAttribute('aria-pressed', String(speakerOn));
    speaker.dataset.state = speakerOn ? 'on' : (!joined && partnerVoice.micOn ? 'calling' : 'off');
    speaker.title = speakerOn
      ? tr('Speaker on: you hear your partner. Click to leave voice.', 'Loa đang bật: bạn nghe được đồng đội. Bấm để tắt đàm thoại.')
      : tr('Turn the speaker on to hear your partner', 'Bật loa để nghe đồng đội');
    speaker.innerHTML = `${icon(speakerOn ? 'speaker' : 'speakerOff')}<span class="tc-lbl">${escape(tr('Speaker', 'Loa'))}</span>`;

    const mic = $<HTMLButtonElement>('[data-tc-mic]')!;
    mic.setAttribute('aria-pressed', String(micOn));
    mic.dataset.state = micProblem ? 'problem' : micOn ? (meSpeaking ? 'speaking' : 'on') : 'off';
    mic.title = micProblem === 'denied'
      ? tr('The browser blocked the microphone. Allow it in the address bar (padlock icon), then try again.', 'Trình duyệt đang chặn mic. Bấm biểu tượng ổ khóa trên thanh địa chỉ, cho phép Micro, rồi bấm lại.')
      : micProblem === 'missing'
        ? tr('No microphone was found on this device.', 'Không tìm thấy mic trên máy này.')
        : micProblem === 'insecure'
          ? tr('The microphone only works on a secure (https) page.', 'Mic chỉ dùng được trên trang https.')
          : micOn ? tr('Mic on: your partner hears you. Click to mute.', 'Mic đang bật: đồng đội nghe bạn nói. Bấm để tắt.')
            : tr('Turn the mic on to talk to your partner', 'Bật mic để nói với đồng đội');
    mic.innerHTML = `${icon(micOn ? 'mic' : 'micOff')}<span class="tc-lbl">${escape(tr('Mic', 'Mic'))}</span>${micOn ? '<span class="tc-level" aria-hidden="true"><i></i><i></i><i></i></span>' : ''}`;

    const chat = $<HTMLButtonElement>('[data-tc-chat]')!;
    chat.setAttribute('aria-expanded', String(chatOpen));
    chat.dataset.unread = unread > 0 ? 'true' : 'false';
    chat.title = tr('Telegrams with your partner (T)', 'Điện tín với đồng đội (phím T)');
    const badge = $<HTMLElement>('[data-tc-badge]')!;
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    chat.setAttribute('aria-label', unread > 0
      ? tr(`Telegrams, ${unread} unread`, `Điện tín, ${unread} tin chưa đọc`)
      : tr('Telegrams', 'Điện tín'));

    const status = $<HTMLElement>('[data-tc-status]')!;
    status.dataset.link = speakerOn ? link : 'off';
    status.dataset.speaking = partnerSpeaking ? 'true' : 'false';
    const face = detective ? `<span class="tc-face is-${detective}" aria-hidden="true"></span>` : '';
    const partnerMic = partnerVoice.inVoice
      ? `<span class="tc-pmic ${partnerVoice.micOn ? 'is-on' : ''}" title="${escape(partnerVoice.micOn ? tr('Partner mic on', 'Đồng đội đang bật mic') : tr('Partner mic off', 'Đồng đội đang tắt mic'))}">${icon(partnerVoice.micOn ? 'mic' : 'micOff')}</span>`
      : '';
    status.innerHTML = `${face}<span class="tc-status-txt"><span class="tc-kick">${escape(tr('Field line', 'Đàm thoại'))}</span><span class="tc-line">${escape(statusText(name))}</span></span>${partnerMic}${speakerOn && link === 'failed' ? `<button type="button" class="tc-retry" data-tc-retry title="${escape(tr('Try again', 'Thử lại'))}" aria-label="${escape(tr('Try connecting again', 'Thử nối lại'))}">${icon('retry')}</button>` : ''}${partnerSpeaking ? '<span class="tc-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : ''}`;

    const title = $<HTMLElement>('[data-tc-title]');
    if (title) title.textContent = tr(`To ${name}`, `Gửi ${name}`);
    const panel = $<HTMLElement>('[data-tc-panel]')!;
    panel.hidden = !chatOpen;
  }

  function statusText(name: string) {
    if (note) return note;
    if (!speakerOn) {
      return partnerVoice.micOn
        ? tr(`${name} is talking. Turn the speaker on.`, `${name} đang bật mic. Bật loa để nghe.`)
        : tr('Speaker off', 'Loa đang tắt');
    }
    if (audioBlocked) return tr('Click anywhere to hear your partner', 'Bấm vào màn hình để nghe đồng đội');
    if (link === 'failed') return tr('Could not connect. Try again.', 'Không nối được máy. Thử lại.');
    if (!partnerVoice.inVoice) return tr(`Waiting for ${name} to turn the speaker on…`, `Chờ ${name} bật loa…`);
    if (link === 'connected') {
      if (partnerSpeaking) return tr(`${name} is speaking`, `${name} đang nói`);
      return micOn ? tr(`On the line with ${name}`, `Đã nối máy với ${name}`) : tr(`Listening to ${name}`, `Đang nghe ${name}`);
    }
    return tr('Connecting…', 'Đang nối máy…');
  }

  function lineHtml(line: TeamChatLine) {
    const mine = line.userId === me.userId;
    const time = new Date(line.sentAt);
    const clock = Number.isFinite(time.getTime()) ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    const who = mine ? tr('You', 'Bạn') : (line.username?.trim().split(/\s+/)[0] || tr('Partner', 'Đồng đội'));
    const detective = detectiveOf(line.role);
    return `<li class="tc-msg ${mine ? 'is-mine' : 'is-theirs'}${detective ? ` is-${detective}` : ''}" data-tc-line="${escape(line.id)}">
      <span class="tc-who">${escape(who)}${clock ? ` · <time datetime="${escape(line.sentAt)}">${escape(clock)}</time>` : ''}</span>
      <p class="tc-text">${escape(line.text)}</p>
    </li>`;
  }

  function paintLog(scroll: 'bottom' | 'keep' = 'bottom') {
    const log = $<HTMLOListElement>('[data-tc-log]');
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.innerHTML = lines.length
      ? lines.map(lineHtml).join('')
      : `<li class="tc-empty">${escape(tr('No telegrams yet. Send the first one to your partner.', 'Chưa có điện tín nào. Gửi lời đầu tiên cho đồng đội.'))}</li>`;
    if (scroll === 'bottom' || nearBottom) log.scrollTop = log.scrollHeight;
  }

  function showPreview(line: TeamChatLine) {
    const preview = $<HTMLButtonElement>('[data-tc-preview]');
    if (!preview) return;
    const who = line.username?.trim().split(/\s+/)[0] || tr('Partner', 'Đồng đội');
    preview.innerHTML = `<b>${escape(who)}:</b> ${escape(line.text.length > 90 ? `${line.text.slice(0, 88)}…` : line.text)}`;
    preview.hidden = false;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { preview.hidden = true; }, 5000);
  }

  /** The dock sits just under the objective card, whatever height that card has now. */
  function place() {
    if (!root || !host) return;
    const scene = host.closest<HTMLElement>('.point-game-phaser');
    const objective = scene?.querySelector<HTMLElement>('.objective-brief');
    if (!scene || !objective) return;
    const bottom = objective.getBoundingClientRect().bottom - scene.getBoundingClientRect().top;
    if (bottom > 0) root.style.setProperty('--tc-top', `${Math.round(bottom + 14)}px`);
  }

  // ------------------------------------------------------------------ chat

  function addLine(line: TeamChatLine, fromLive: boolean) {
    if (!line?.id || line.roomId !== roomId || lineIds.has(line.id)) return false;
    lineIds.add(line.id);
    lines.push(line);
    lines.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    if (lines.length > 200) lineIds.delete(lines.shift()!.id);
    const theirs = line.userId !== me.userId;
    // A line pushed live is news by definition; one from the history only if it is newer than the last read.
    if (theirs && (!chatOpen || document.hidden) && (fromLive || Date.parse(line.sentAt) > seenAt)) {
      unread += 1;
      if (fromLive) {
        if (!chatOpen) showPreview(line);
        options.onCue?.('message');
      }
    }
    if (!theirs || (chatOpen && !document.hidden)) markSeen();
    return true;
  }

  function markSeen() {
    const latest = lines.at(-1)?.sentAt;
    if (!latest) return;
    seenAt = Math.max(seenAt, Date.parse(latest) || 0);
    writeStorage('session', SEEN_PREFIX + roomId, new Date(seenAt).toISOString());
  }

  async function loadHistory() {
    if (historyRequested || !enabled || disposed) return;
    historyRequested = true;
    try {
      const history = await api.history(roomId);
      if (disposed) return;
      let changed = false;
      for (const line of history ?? []) changed = addLine(line, false) || changed;
      if (changed) { paintLog(); paint(); }
    } catch {
      historyRequested = false; // tried again on the next reconnect or when the panel opens
    }
  }

  function setChatOpen(open: boolean, focusInput = open) {
    chatOpen = open;
    if (open) {
      unread = 0;
      markSeen();
      $<HTMLElement>('[data-tc-preview]')?.setAttribute('hidden', '');
      if (!historyRequested) void loadHistory();
    }
    paint();
    if (open) {
      paintLog();
      if (focusInput) requestAnimationFrame(() => $<HTMLTextAreaElement>('[data-tc-input]')?.focus({ preventScroll: true }));
    }
  }

  async function sendDraft() {
    const input = $<HTMLTextAreaElement>('[data-tc-input]');
    const message = $<HTMLElement>('[data-tc-form-msg]');
    if (!input || sending) return;
    const text = input.value.trim();
    if (!text) return;
    if (visibleLength(text) > MAX_CHAT_LENGTH) {
      if (message) message.textContent = tr(`At most ${MAX_CHAT_LENGTH} characters.`, `Tối đa ${MAX_CHAT_LENGTH} ký tự.`);
      return;
    }
    sending = true;
    $<HTMLButtonElement>('[data-tc-send]')!.disabled = true;
    if (message) message.textContent = '';
    try {
      const sent = await api.send(roomId, text);
      if (disposed) return;
      input.value = '';
      autoSize(input);
      updateCounter();
      if (addLine(sent, false)) paintLog();
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (message) {
        message.textContent = status === 429
          ? tr('Slow down a little, then send again.', 'Gửi chậm lại một chút rồi gửi tiếp.')
          : status === 409 || status === 403
            ? tr('This match is over; telegrams are closed.', 'Ván đã kết thúc, không gửi điện tín được nữa.')
            : tr('Could not send. Check the connection and try again.', 'Chưa gửi được. Kiểm tra mạng rồi thử lại.');
      }
    } finally {
      sending = false;
      const send = $<HTMLButtonElement>('[data-tc-send]');
      if (send) send.disabled = false;
    }
  }

  function autoSize(input: HTMLTextAreaElement) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function updateCounter() {
    const input = $<HTMLTextAreaElement>('[data-tc-input]');
    const message = $<HTMLElement>('[data-tc-form-msg]');
    if (!input || !message) return;
    const length = visibleLength(input.value.trim());
    message.dataset.over = length > MAX_CHAT_LENGTH ? 'true' : 'false';
    message.textContent = length > MAX_CHAT_LENGTH - 60 ? `${length}/${MAX_CHAT_LENGTH}` : '';
  }

  // ------------------------------------------------------------------ voice: channel

  async function joinVoice() {
    if (joined || disposed || !enabled || !connected) return;
    if (joining) return joining;
    joining = (async () => {
      try {
        if (!ice) ice = await api.voice(roomId);
        const result = await options.invoke('VoiceJoin', roomId, micOn) as { peers?: { userId: string; micOn: boolean }[] } | undefined;
        if (disposed) return;
        joined = true;
        note = null;
        const peer = (result?.peers ?? []).find((entry) => entry.userId !== me.userId);
        if (peer) partnerVoice = { inVoice: true, micOn: Boolean(peer.micOn) };
        link = partnerVoice.inVoice ? 'connecting' : 'waiting';
        // The partner may have opened voice while this join was on its way: their announcement then came first.
        const peerId = peer?.userId ?? (partnerVoice.inVoice ? partner()?.userId : null);
        if (peerId) connectTo(peerId);
      } catch {
        if (disposed) return;
        joined = false;
        speakerOn = false;
        note = tr('Voice is unavailable right now.', 'Chưa mở được đàm thoại.');
        stopMic(false);
      } finally {
        joining = null;
        paint();
      }
    })();
    return joining;
  }

  function leaveVoice() {
    if (joined) void options.invoke('VoiceLeave', roomId).catch(() => undefined);
    joined = false;
    closePeer();
    link = 'idle';
  }

  async function setSpeaker(on: boolean) {
    note = null;
    speakerOn = on;
    writeStorage('local', SPEAKER_PREF, on ? '1' : null);
    unlockAudio();
    if (on) {
      paint();
      await joinVoice();
    } else {
      stopMic(false);
      leaveVoice();
    }
    paint();
  }

  // ------------------------------------------------------------------ voice: microphone

  async function startMic() {
    micProblem = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      micProblem = window.isSecureContext ? 'missing' : 'insecure';
      paint();
      return false;
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (error) {
      const name = (error as DOMException)?.name;
      micProblem = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'missing';
      paint();
      return false;
    }
    if (disposed) { localStream.getTracks().forEach((track) => track.stop()); return false; }
    micOn = true;
    localMeter = meterFor(localStream);
    await attachMicTrack();
    startMeters();
    return true;
  }

  function stopMic(announce = true) {
    const wasOn = micOn;
    micOn = false;
    meSpeaking = false;
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    localMeter = null;
    void attachMicTrack();
    if (announce && wasOn && joined) void options.invoke('VoiceMic', roomId, false).catch(() => undefined);
  }

  async function setMic(on: boolean) {
    note = null;
    unlockAudio();
    if (!on) {
      stopMic();
      paint();
      return;
    }
    if (!(await startMic())) return;
    if (!speakerOn) {
      speakerOn = true;
      writeStorage('local', SPEAKER_PREF, '1');
    }
    if (joined) await options.invoke('VoiceMic', roomId, true).catch(() => undefined);
    else await joinVoice();
    paint();
  }

  async function attachMicTrack() {
    const track = localStream?.getAudioTracks()[0] ?? null;
    const transceiver = pc?.getTransceivers().find((entry) => entry.receiver.track?.kind === 'audio');
    if (!transceiver) return;
    try { await transceiver.sender.replaceTrack(track); } catch { /* the connection closed meanwhile */ }
  }

  // ------------------------------------------------------------------ voice: the WebRTC connection

  function createPeer(peerId: string) {
    closePeer();
    const connection = new RTCPeerConnection({
      iceServers: (ice?.iceServers ?? []).map((server) => ({
        urls: server.urls,
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {}),
      })),
      iceTransportPolicy: ice?.relayOnly ? 'relay' : 'all',
    });
    pc = connection;
    pcPeer = peerId;
    pendingCandidates = [];
    connection.onicecandidate = ({ candidate }) => {
      if (pc !== connection) return;
      const value = candidate ? candidate.toJSON() : { candidate: '', sdpMid: null, sdpMLineIndex: null };
      void signal(peerId, { kind: 'candidate', candidate: value.candidate ?? '', sdpMid: value.sdpMid ?? null, sdpMLineIndex: value.sdpMLineIndex ?? null });
    };
    connection.ontrack = (event) => {
      if (pc !== connection) return;
      remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      const audio = $<HTMLAudioElement>('[data-tc-audio]');
      if (audio) {
        audio.srcObject = remoteStream;
        void playRemote();
      }
      remoteMeter = meterFor(remoteStream);
      startMeters();
    };
    connection.onconnectionstatechange = () => {
      if (pc !== connection) return;
      const state = connection.connectionState;
      if (state === 'connected') {
        link = 'connected';
        failures = 0;
      } else if (state === 'failed') {
        void recover();
      } else if (state === 'connecting' || state === 'new') {
        link = 'connecting';
      }
      paint();
    };
    return connection;
  }

  /** The caller (smaller user id) restarts ICE a couple of times; the other side waits for the new offer. */
  async function recover() {
    failures += 1;
    if (failures > RECONNECT_TRIES || !pc || !pcPeer) {
      link = 'failed';
      paint();
      return;
    }
    link = 'connecting';
    if (me.userId < pcPeer) {
      try {
        pc.restartIce();
        await sendOffer(pc, pcPeer, true);
      } catch {
        link = 'failed';
      }
    }
    paint();
  }

  function closePeer() {
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try { pc.close(); } catch { /* already closed */ }
    }
    pc = null;
    pcPeer = null;
    pendingCandidates = [];
    remoteStream = null;
    remoteMeter = null;
    partnerSpeaking = false;
    const audio = $<HTMLAudioElement>('[data-tc-audio]');
    if (audio) audio.srcObject = null;
  }

  function connectTo(peerId: string) {
    if (!joined || !partnerVoice.inVoice || disposed) return;
    if (pc && pcPeer === peerId && pc.connectionState !== 'closed' && pc.connectionState !== 'failed') return;
    failures = 0;
    link = 'connecting';
    if (me.userId < peerId) void call(peerId);
    // Otherwise the partner calls; their offer creates the connection here.
  }

  async function call(peerId: string) {
    const connection = createPeer(peerId);
    connection.addTransceiver('audio', { direction: 'sendrecv' });
    await attachMicTrack();
    try {
      await sendOffer(connection, peerId, false);
    } catch {
      if (pc === connection) { link = 'failed'; paint(); }
    }
  }

  async function sendOffer(connection: RTCPeerConnection, peerId: string, iceRestart: boolean) {
    makingOffer = true;
    try {
      const offer = await connection.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (pc !== connection) return;
      await connection.setLocalDescription(offer);
      await signal(peerId, { kind: 'offer', sdp: connection.localDescription?.sdp ?? offer.sdp });
    } finally {
      makingOffer = false;
    }
  }

  function signal(peerId: string, payload: Omit<VoiceSignalPayload, 'roomId' | 'fromUserId'>) {
    return options.invoke('VoiceSignal', roomId, peerId, payload).catch(() => undefined);
  }

  async function onSignal(payload: VoiceSignalPayload) {
    if (disposed || !joined || payload?.roomId !== roomId || !payload.fromUserId || payload.fromUserId === me.userId) return;
    const from = payload.fromUserId;
    try {
      if (payload.kind === 'offer' && payload.sdp) {
        // Perfect negotiation: if both sides offered at once, the side with the larger id gives way.
        const polite = me.userId > from;
        const collision = pc && pcPeer === from && (makingOffer || pc.signalingState !== 'stable');
        if (collision && !polite) return;
        const connection = pc && pcPeer === from && pc.connectionState !== 'closed' ? pc : createPeer(from);
        await connection.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        const transceiver = connection.getTransceivers().find((entry) => entry.receiver.track?.kind === 'audio');
        if (transceiver) transceiver.direction = 'sendrecv';
        await attachMicTrack();
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        await flushCandidates(connection);
        await signal(from, { kind: 'answer', sdp: connection.localDescription?.sdp ?? answer.sdp });
        link = connection.connectionState === 'connected' ? 'connected' : 'connecting';
        paint();
      } else if (payload.kind === 'answer' && payload.sdp && pc && pcPeer === from && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
        await flushCandidates(pc);
      } else if (payload.kind === 'candidate' && pc && pcPeer === from) {
        const candidate: RTCIceCandidateInit = { candidate: payload.candidate ?? '', sdpMid: payload.sdpMid ?? null, sdpMLineIndex: payload.sdpMLineIndex ?? null };
        if (!pc.remoteDescription) pendingCandidates.push(candidate);
        else await pc.addIceCandidate(candidate).catch(() => undefined);
      }
    } catch {
      // A broken exchange: the caller's restart (or the retry button) sets it up again.
    }
  }

  async function flushCandidates(connection: RTCPeerConnection) {
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of queued) await connection.addIceCandidate(candidate).catch(() => undefined);
  }

  function onVoiceState(payload: VoiceStatePayload) {
    if (disposed || payload?.roomId !== roomId) return;
    if (payload.userId === me.userId) {
      if (!payload.replaced) return;
      // This player opened voice in another tab: this tab hands it over.
      stopMic(false);
      joined = false;
      closePeer();
      speakerOn = false;
      link = 'idle';
      note = tr('Voice moved to your other tab.', 'Đàm thoại đã chuyển sang tab khác của bạn.');
      paint();
      return;
    }
    const wasTalking = partnerVoice.micOn;
    partnerVoice = { inVoice: Boolean(payload.inVoice), micOn: Boolean(payload.inVoice && payload.micOn) };
    if (!partnerVoice.inVoice) {
      closePeer();
      if (joined) link = 'waiting';
    } else if (joined) {
      // A fresh join (a reload or a reconnect on their side) means the old connection is gone at their end.
      if (payload.fresh && pcPeer === payload.userId) closePeer();
      connectTo(payload.userId);
    }
    if (partnerVoice.micOn && !wasTalking && !speakerOn) options.onCue?.('voice');
    paint();
  }

  // ------------------------------------------------------------------ audio level meters

  function meterFor(stream: MediaStream): (() => number) | null {
    try {
      const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      audioContext ??= new AudioCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      return () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) sum += value * value;
        return Math.sqrt(sum / samples.length);
      };
    } catch {
      return null;
    }
  }

  function startMeters() {
    if (meterTimer) return;
    meterTimer = setInterval(() => {
      if (disposed) return;
      const now = performance.now();
      if (micOn && localMeter && localMeter() > SPEAKING_LEVEL) meLoudAt = now;
      if (remoteMeter && partnerVoice.micOn && remoteMeter() > SPEAKING_LEVEL) partnerLoudAt = now;
      const mine = micOn && Boolean(localMeter) && now - meLoudAt < SPEAKING_HOLD_MS;
      const theirs = partnerVoice.micOn && Boolean(remoteMeter) && now - partnerLoudAt < SPEAKING_HOLD_MS;
      if (mine !== meSpeaking || theirs !== partnerSpeaking) {
        meSpeaking = mine;
        partnerSpeaking = theirs;
        root?.setAttribute('data-me-speaking', String(mine));
        root?.setAttribute('data-partner-speaking', String(theirs));
        paint();
      }
      if (!localMeter && !remoteMeter) { clearInterval(meterTimer); meterTimer = undefined; }
    }, 100);
  }

  async function playRemote() {
    const audio = $<HTMLAudioElement>('[data-tc-audio]');
    if (!audio?.srcObject) return;
    try {
      await audio.play();
      audioBlocked = false;
    } catch {
      // Autoplay needs a click first (speaker remembered from last time, no click yet on this page).
      audioBlocked = true;
    }
    paint();
  }

  function unlockAudio() {
    if (audioContext?.state === 'suspended') void audioContext.resume().catch(() => undefined);
    if (audioBlocked) void playRemote();
  }

  // ------------------------------------------------------------------ events

  function bind() {
    if (!root) return;
    const { signal: abort } = lifetime;
    root.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('[data-tc-speaker]')) void setSpeaker(!speakerOn);
      else if (target.closest('[data-tc-mic]')) void setMic(!micOn);
      else if (target.closest('[data-tc-chat]')) setChatOpen(!chatOpen);
      else if (target.closest('[data-tc-close]')) { setChatOpen(false); $<HTMLButtonElement>('[data-tc-chat]')?.focus(); }
      else if (target.closest('[data-tc-preview]')) setChatOpen(true);
      else if (target.closest('[data-tc-retry]')) {
        // Closing and reopening voice makes the partner drop their side too, then both connect afresh.
        failures = 0;
        leaveVoice();
        void joinVoice();
        paint();
      }
    }, { signal: abort });
    const form = $<HTMLFormElement>('[data-tc-form]');
    form?.addEventListener('submit', (event) => { event.preventDefault(); void sendDraft(); }, { signal: abort });
    const input = $<HTMLTextAreaElement>('[data-tc-input]');
    // Typing must not walk the detective (the scene listens for W, A, S, D and E on the window).
    const keep = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setChatOpen(false);
        $<HTMLButtonElement>('[data-tc-chat]')?.focus();
        return;
      }
      event.stopPropagation();
      if (event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void sendDraft();
      }
    };
    input?.addEventListener('keydown', keep, { signal: abort });
    input?.addEventListener('keyup', (event) => event.stopPropagation(), { signal: abort });
    input?.addEventListener('input', () => { autoSize(input); updateCounter(); }, { signal: abort });
    // Escape inside the panel (not only in the box) closes it.
    $<HTMLElement>('[data-tc-panel]')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && event.target !== input) {
        event.stopPropagation();
        setChatOpen(false);
        $<HTMLButtonElement>('[data-tc-chat]')?.focus();
      }
    }, { signal: abort });
    // T opens the telegrams, unless the player is typing or a dialog holds the screen.
    window.addEventListener('keydown', (event) => {
      if (!enabled || event.key.toLowerCase() !== 't' || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setChatOpen(true);
    }, { signal: abort });
    window.addEventListener('resize', place, { signal: abort });
    // The first click on the page may be what the browser needs to play the partner's voice.
    window.addEventListener('pointerdown', unlockAudio, { signal: abort, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && chatOpen) { markSeen(); unread = 0; paint(); }
    }, { signal: abort });
    window.addEventListener('pagehide', () => { if (joined) void options.invoke('VoiceLeave', roomId).catch(() => undefined); }, { signal: abort });
  }

  // ------------------------------------------------------------------ public

  return {
    /** Puts the dock in `slot` (once). */
    mount(slot: HTMLElement | null) {
      if (!slot || host === slot || disposed) return;
      host = slot;
      host.innerHTML = shell();
      root = host.querySelector<HTMLElement>('[data-tc]');
      bind();
      paint();
      paintLog();
    },

    /** The match's players: chat and voice exist only in a running two-player match. */
    setPlayers(next: CommsPlayer[], options: { isTutorial?: boolean; inProgress?: boolean } = {}) {
      place();
      const list = Array.isArray(next) ? next : [];
      const key = `${options.isTutorial ? 1 : 0}${options.inProgress === false ? 0 : 1}|${list.map((player) => `${player.userId}:${player.role ?? ''}:${player.username ?? ''}`).join('|')}`;
      if (key === playersKey) return;
      playersKey = key;
      players = list;
      const nowEnabled = players.length >= 2 && !options.isTutorial && options.inProgress !== false && Boolean(partner());
      const changed = nowEnabled !== enabled;
      enabled = nowEnabled;
      if (!enabled && joined) { stopMic(false); leaveVoice(); }
      if (enabled && changed) {
        void loadHistory();
        if (speakerOn) void joinVoice();
      }
      paint();
    },

    /** The hub connection is up (true) or down (false). */
    setConnected(next: boolean) {
      connected = next;
      // The first connection opens voice if the player left the speaker on last time; reconnects go through onReconnected.
      if (next && !everConnected) {
        everConnected = true;
        if (enabled && speakerOn) void joinVoice();
      }
    },

    /** After a reconnect the server forgot this connection's voice channel and may hold chat lines this tab missed. */
    onReconnected() {
      connected = true;
      historyRequested = false;
      void loadHistory();
      if (joined || speakerOn) {
        joined = false;
        closePeer();
        partnerVoice = { inVoice: false, micOn: false };
        void joinVoice();
      }
      paint();
    },

    onChatMessage(line: TeamChatLine) {
      if (disposed || !addLine(line, true)) return;
      paintLog(line.userId === me.userId ? 'bottom' : 'keep');
      paint();
    },
    onVoiceState,
    onVoiceSignal: (payload: VoiceSignalPayload) => { void onSignal(payload); },

    /** Leaves voice, releases the microphone and removes the dock. */
    dispose() {
      if (disposed) return;
      stopMic(false);
      leaveVoice();
      disposed = true;
      lifetime.abort();
      clearTimeout(previewTimer);
      clearInterval(meterTimer);
      void audioContext?.close().catch(() => undefined);
      audioContext = null;
      if (host) host.innerHTML = '';
      host = null;
      root = null;
    },
  };
}

export type TeamComms = ReturnType<typeof createTeamComms>;
