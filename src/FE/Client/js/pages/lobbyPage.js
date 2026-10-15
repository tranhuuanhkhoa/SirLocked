import '../../../css/31-bpa-lobby.css';
import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { escapeHtml, initials, placeholderStyle, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { plural, tr } from '../services/i18n.js';
import { roomInviteUrl } from '../services/roomInvites.js';

// The server owns the room lifecycle; the lobby only reacts to the status/code it is told.
const TERMINAL_STATUSES = new Set(['COMPLETED', 'ABANDONED']);
const ROOM_ENDED_CODE = 'ROOM_ENDED';

const svgIcon = (body, { size = 18, stroke = 2, cls = '' } = {}) => `
  <svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

// Decorative only; the taken state is also carried by text and the disabled attribute.
const LOCK_ICON = svgIcon('<rect x="4" y="10.5" width="16" height="11" rx="1.5"></rect><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"></path><circle cx="12" cy="16" r="1.4"></circle>', { size: 20, stroke: 1.6, cls: 'bpa-lobby-lock-icon' });
const ICON = {
  copy: svgIcon('<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"></rect><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"></path>', { size: 16, cls: 'bpa-lobby-ic-copy' }),
  copied: svgIcon('<path d="M5 12.5l4.5 4.5L19 7"></path>', { size: 16, stroke: 2.4, cls: 'bpa-lobby-ic-done' }),
  link: svgIcon('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"></path><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"></path>', { stroke: 1.9 }),
  leave: svgIcon('<path d="M13.5 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h7"></path><path d="M10 12h10"></path><path d="M16.5 8.5L20 12l-3.5 3.5"></path>', { stroke: 1.9 }),
  key: svgIcon('<circle cx="7.5" cy="12" r="3.5"></circle><path d="M11 12h10M17.5 12v3.5M21 12v2.5"></path>', { size: 13, stroke: 2.2 }),
  check: svgIcon('<path d="M5 12.5l4.5 4.5L19 7"></path>', { stroke: 2.3 }),
  cross: svgIcon('<path d="M7 7l10 10M17 7L7 17"></path>', { stroke: 2.3 }),
  lens: svgIcon('<circle cx="10.5" cy="10.5" r="6"></circle><path d="M15 15l5.5 5.5"></path>'),
  warn: svgIcon('<path d="M12 3.5L2.8 19.5h18.4z"></path><path d="M12 9.5v4.5"></path><path d="M12 17v.01"></path>', { stroke: 1.9 }),
  ok: svgIcon('<circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.8 2.8L16.5 9.5"></path>', { stroke: 2.1 }),
  arrow: svgIcon('<path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path>'),
  spin: svgIcon('<circle cx="10.5" cy="10.5" r="6"></circle><path d="M15 15l5.5 5.5"></path>', { size: 24, stroke: 1.8, cls: 'bpa-spin' }),
};

// Prop illustrations for the two roles (no people): evidence tag, fingerprint card,
// magnifier and camera for the Investigator; speech bubbles, notebook and pen for the Interrogator.
const INVESTIGATOR_ART = () => `
  <svg class="bpa-lobby-banner" viewBox="0 0 400 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="400" height="80" fill="#15110e"></rect>
    <ellipse cx="200" cy="80" rx="180" ry="16" fill="rgba(239,212,134,.08)"></ellipse>
    <path d="M0 72H400" stroke="#3a2e24" stroke-width="2"></path>
    <path d="M66 48C46 60 36 68 12 74" fill="none" stroke="#bf3b2c" stroke-width="1.6" stroke-linecap="round"></path>
    <g transform="translate(58 18) rotate(-8)">
      <path d="M0 10L10 0H66V40H10L0 30Z" fill="#d9c49a"></path>
      <circle cx="10" cy="20" r="3" fill="#15110e"></circle>
      <text x="19" y="17" font-family="'Source Code Pro', monospace" font-size="7" font-weight="700" letter-spacing="1" fill="#4f4536">${escapeHtml(tr('EVIDENCE', 'VẬT CHỨNG'))}</text>
      <text x="19" y="32" font-family="'Source Code Pro', monospace" font-size="11" font-weight="700" fill="#9e3f2a">Nº 04</text>
    </g>
    <g transform="translate(150 9) rotate(4)">
      <rect width="80" height="58" fill="#fbf6ed"></rect>
      <path d="M8 10H42" stroke="#b9a77f" stroke-width="2"></path>
      <g fill="none" stroke="#8f8676" stroke-width="1.3" stroke-linecap="round">
        <path d="M20 40a20 19 0 0 1 40 0"></path><path d="M24 44a16 15 0 0 1 32 0"></path><path d="M28 46a12 11 0 0 1 24 0"></path>
        <path d="M32 48a8 7 0 0 1 16 0"></path><path d="M36 49a4 3.5 0 0 1 8 0"></path>
      </g>
    </g>
    <g transform="translate(214 44) rotate(-38)">
      <circle r="18" fill="rgba(200,230,255,.18)" stroke="#c7a24b" stroke-width="4"></circle>
      <path d="M-9 -6a11 11 0 0 1 8-7" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6" stroke-linecap="round"></path>
      <rect x="20" y="-4" width="34" height="8" rx="3" fill="#5a3b22"></rect>
    </g>
    <g transform="translate(290 20)">
      <rect x="8" y="-7" width="16" height="8" fill="#5a4a3a"></rect>
      <rect width="70" height="46" rx="3" fill="#3a2e24" stroke="#8a6e2e" stroke-width="1.5"></rect>
      <path d="M0 14H70" stroke="#2a211b" stroke-width="1.5"></path>
      <circle cx="35" cy="26" r="13" fill="#0d1014" stroke="#c7a24b" stroke-width="3"></circle>
      <circle cx="35" cy="26" r="5" fill="#2f6363"></circle>
      <circle cx="31" cy="22" r="2" fill="rgba(255,255,255,.6)"></circle>
      <circle cx="60" cy="8" r="3.5" fill="#efd486"></circle>
    </g>
  </svg>`;

const INTERROGATOR_ART = () => `
  <svg class="bpa-lobby-banner" viewBox="0 0 400 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="400" height="80" fill="#15110e"></rect>
    <path d="M246 0L194 72H342L290 0Z" fill="rgba(239,212,134,.09)"></path>
    <path d="M242 0H294L285 10H251Z" fill="#8a6e2e"></path>
    <ellipse cx="268" cy="10" rx="17" ry="3" fill="#efd486" opacity=".85"></ellipse>
    <path d="M0 72H400" stroke="#3a2e24" stroke-width="2"></path>
    <g transform="translate(218 34) rotate(-3)">
      <path d="M0 4Q25 0 50 4V36Q25 32 0 36Z" fill="#e9dcc0"></path>
      <path d="M50 4Q75 0 100 4V36Q75 32 50 36Z" fill="#f4ecd8"></path>
      <path d="M8 13H42M8 20H42M8 27H32M58 13H92M58 20H84" stroke="#8f8676" stroke-width="1.5"></path>
      <path d="M60 28C66 23 72 31 80 26" fill="none" stroke="#b8382b" stroke-width="1.4"></path>
    </g>
    <g transform="translate(330 50) rotate(-18)">
      <rect width="44" height="6" fill="#c7a24b"></rect>
      <path d="M44 0L52 3L44 6Z" fill="#e9dcc0"></path>
      <rect x="-6" width="6" height="6" fill="#b8382b"></rect>
    </g>
    <g transform="translate(40 10)">
      <path d="M0 7a7 7 0 0 1 7-7h46a7 7 0 0 1 7 7v20a7 7 0 0 1-7 7H26l-12 10V34H7a7 7 0 0 1-7-7z" fill="#fbf6ed"></path>
      <text x="30" y="25" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="21" font-weight="700" fill="#7a3f27">?</text>
    </g>
    <g transform="translate(112 24)">
      <path d="M0 7a7 7 0 0 1 7-7h50a7 7 0 0 1 7 7v16a7 7 0 0 1-7 7H40l10 10-20-10H7a7 7 0 0 1-7-7z" fill="#2a211b" stroke="#c7a24b" stroke-width="1.5"></path>
      <circle cx="21" cy="15" r="2.6" fill="#efd486"></circle><circle cx="32" cy="15" r="2.6" fill="#efd486"></circle><circle cx="43" cy="15" r="2.6" fill="#efd486"></circle>
    </g>
  </svg>`;

// The two roles are the asymmetric core of the game, so each carries its own prop
// illustration and accent colour; `modifier` selects both in CSS.
const ROLES = [
  { id: 'INVESTIGATOR', modifier: 'inv', title: 'Investigator', viTitle: 'Điều tra viên', blurb: 'Examines the scene: inspects items and gathers physical evidence.', viBlurb: 'Khám nghiệm hiện trường: kiểm tra vật phẩm và thu thập chứng cứ vật lý.', tags: [['CAMERA', 'MÁY ẢNH'], ['EVIDENCE', 'VẬT CHỨNG']], art: INVESTIGATOR_ART },
  { id: 'INTERROGATOR', modifier: 'int', title: 'Interrogator', viTitle: 'Thẩm vấn viên', blurb: 'Questions suspects: asks dialogue and exposes contradictions.', viBlurb: 'Thẩm vấn nghi phạm: đặt câu hỏi và vạch ra mâu thuẫn.', tags: [['WITNESSES', 'HỎI NHÂN CHỨNG'], ['TESTIMONY', 'LỜI KHAI']], art: INTERROGATOR_ART },
];

// Generic dossier photo for the case cover (the room only knows the case id and title).
const caseArt = (seal) => `
  <svg class="bpa-lobby-art" viewBox="0 0 440 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect width="440" height="140" fill="rgba(13,16,20,.5)"></rect>
    <ellipse cx="220" cy="134" rx="170" ry="9" fill="rgba(239,212,134,.14)"></ellipse>
    <path d="M0 127H440" stroke="rgba(239,212,134,.16)" stroke-width="2"></path>
    <g transform="translate(112 34) rotate(-6) scale(.78)">
      <rect width="160" height="100" fill="#e9dcc0"></rect>
      <path d="M0 0L80 54L160 0" fill="none" stroke="#b9a77f" stroke-width="2"></path>
      <circle cx="80" cy="54" r="15" fill="#b8382b"></circle>
      <text x="80" y="59" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="13" font-weight="700" fill="#f3c7b8">${escapeHtml(seal)}</text>
    </g>
    <g transform="translate(236 28) rotate(8) scale(.78)">
      <rect width="120" height="82" fill="#fbf6ed"></rect>
      <path d="M10 18H80M10 32H108M10 44H90M10 56H70" stroke="#8f8676" stroke-width="2"></path>
      <path d="M70 68C80 58 92 78 108 64" fill="none" stroke="#b8382b" stroke-width="1.6"></path>
    </g>
    <g transform="translate(348 92) rotate(-38)">
      <circle r="17" fill="rgba(200,230,255,.16)" stroke="#c7a24b" stroke-width="4"></circle>
      <rect x="19" y="-4" width="32" height="8" rx="3" fill="#5a3b22"></rect>
    </g>
  </svg>`;

const roleById = (id) => ROLES.find((role) => role.id === id);

export async function renderLobbyPage(app, roomId, { signal } = {}) {
  if (signal?.aborted) return;
  render(app, `
  <div class="bpa-container bpa-lobby-page">
    <div class="bpa-lobby-top">
      <div class="bpa-label bpa-lobby-label">
        <div><p class="bpa-kicker">${tr('Lobby', 'Phòng chờ')}</p><h1 class="bpa-lobby-h1">${tr('Room Lobby', 'Phòng chờ')}</h1></div>
      </div>
    </div>
    <p class="bpa-lobby-state" role="status">${ICON.spin}<span>${tr('Loading lobby…', 'Đang tải phòng chờ…')}</span></p>
  </div>`);

  let room;
  let leaving = false;
  let endedMessage = null;
  let disposed = false;
  const me = session.user();
  // Case details only decorate the dossier cover; the lobby works without them.
  let caseInfo = null;
  let caseRequested = false;
  // What the previous draw showed, so stamps and the red string animate only when they change.
  let shown = null;

  const refresh = async () => {
    if (disposed) return;
    const fresh = await roomApi.get(roomId);
    if (disposed) return;
    room = fresh;
    if (room.status === 'IN_PROGRESS') {
      window.location.hash = `#/game/${roomId}`;
      return;
    }
    draw();
  };

  const loadCase = () => {
    if (caseRequested || !room?.caseId) return;
    caseRequested = true;
    caseApi.detail(room.caseId)
      .then((detail) => {
        if (disposed || !detail) return;
        caseInfo = detail;
        draw();
      })
      .catch(() => { /* Non-fatal: the cover keeps just the case title. */ });
  };

  // A terminal room is a dead end: show what the server said and offer the way out
  // instead of leaving the player clicking buttons that can only fail.
  const handleActionError = (err) => {
    if (disposed) return;
    if (err?.errors?.code === ROOM_ENDED_CODE) {
      endedMessage = err.message;
      draw();
      return;
    }
    toast(err.message, 'error');
  };

  const hub = createRoomConnection(roomId, {
    PlayerJoined: ({ room: r }) => { if (disposed) return; room = r; draw(); toast(tr('Your partner joined the room.', 'Đồng đội đã vào phòng.'), 'info'); },
    PlayerLeft: ({ room: r }) => { if (disposed) return; room = r; draw(); toast(tr('A player left the room.', 'Một người chơi đã rời phòng.'), 'info'); },
    RolesUpdated: ({ room: r }) => { if (disposed) return; room = r; draw(); },
    ReadyUpdated: ({ room: r }) => { if (disposed) return; room = r; draw(); },
    GameStarted: () => { if (!disposed) window.location.hash = `#/game/${roomId}`; },
    RoomError: ({ message }) => { if (!disposed) toast(message, 'error'); },
  }, { onReconnected: () => refresh().catch(() => {}) });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', cleanup);
    return hub.stop();
  };
  signal?.addEventListener('abort', cleanup, { once: true });

  try {
    await refresh();
    if (disposed || !room || room.status === 'IN_PROGRESS') return cleanup;
    await hub.start();
  } catch (err) {
    if (disposed) return cleanup;
    render(app, `
    <div class="bpa-container bpa-lobby-page">
      <div class="bpa-lobby-top">
        <div class="bpa-label bpa-lobby-label">
          <div><p class="bpa-kicker">${tr('Lobby', 'Phòng chờ')}</p><h1 class="bpa-lobby-h1">${tr('Room Lobby', 'Phòng chờ')}</h1></div>
        </div>
      </div>
      <p class="bpa-lobby-state is-error" role="alert">${ICON.warn}<span>${escapeHtml(err.message)}</span></p>
    </div>`);
    return cleanup;
  }

  function topRow({ closed }) {
    const title = room.caseTitle || caseInfo?.title || '';
    return `
    <div class="bpa-lobby-top">
      <div class="bpa-label bpa-lobby-label">
        <div>
          <p class="bpa-kicker">${tr('Lobby', 'Phòng chờ')} · ${closed ? `<s>${escapeHtml(room.roomCode)}</s>` : escapeHtml(room.roomCode)}</p>
          <h1 class="bpa-lobby-h1">${tr('Room Lobby', 'Phòng chờ')}</h1>
        </div>
      </div>
      <p class="bpa-lobby-lead">${tr('Case:', 'Vụ án:')} <strong>${escapeHtml(title)}</strong>${closed ? '' : ` — ${tr('waiting for two ready detectives.', 'đang chờ hai thám tử sẵn sàng.')}`}</p>
      ${closed ? '' : `<button type="button" class="bpa-btn bpa-btn--gold bpa-lobby-leave" id="leave-btn">${ICON.leave}${tr('Leave room', 'Rời phòng')}</button>`}
    </div>`;
  }

  function caseDossier() {
    const title = room.caseTitle || caseInfo?.title || '';
    const info = caseInfo || {};
    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const stats = [
      [num(info.estimatedMinutes), tr('min', 'phút')],
      [num(info.stageCount) || null, tr(plural(info.stageCount, 'act', 'acts'), 'hồi')],
      [num(info.sceneCount), tr(plural(info.sceneCount, 'scene', 'scenes'), 'hiện trường')],
      [num(info.characterCount), tr(plural(info.characterCount, 'suspect', 'suspects'), 'nghi phạm')],
      [num(info.clueCount), tr(plural(info.clueCount, 'clue', 'clues'), 'manh mối')],
    ].filter(([value]) => value !== null);
    const mechanics = num(info.mechanicsVersion);
    const mechanicsChip = mechanics ? (mechanics === 3 ? 'V3 · CRACK' : `V${mechanics}`) : '';
    const seal = initials(title).slice(0, 1) || '?';
    return `
    <section class="bpa-lobby-case" aria-labelledby="lobby-case-h">
      <span class="bpa-lobby-back" aria-hidden="true"></span>
      <div class="bpa-lobby-sheet">
        <span class="bpa-pin" aria-hidden="true"></span>
        <figure class="bpa-lobby-photo" style="${placeholderStyle(room.caseId || title)}" aria-hidden="true">
          ${caseArt(seal)}
          ${info.coverImageUrl ? `<img class="bpa-lobby-cover" src="${escapeHtml(info.coverImageUrl)}" alt="" onerror="this.remove()">` : ''}
          <span class="bpa-tape bpa-lobby-tape bpa-lobby-tape--a"></span>
          <span class="bpa-tape bpa-lobby-tape bpa-lobby-tape--b"></span>
        </figure>
        <div class="bpa-lobby-casehead">
          <div class="bpa-lobby-casetitle">
            <p class="bpa-kicker bpa-lobby-kick">${tr('Case file', 'Hồ sơ vụ án')}</p>
            <h2 id="lobby-case-h" class="bpa-lobby-h2">${escapeHtml(title)}</h2>
          </div>
          ${mechanicsChip ? `<span class="bpa-chip bpa-chip--dark">${mechanicsChip}</span>` : ''}
        </div>
        ${info.summary ? `<p class="bpa-lobby-sum">${escapeHtml(info.summary)}</p>` : ''}
        ${stats.length ? `<dl class="bpa-lobby-stats" style="--bpa-lobby-cols: ${stats.length}">
          ${stats.map(([value, label]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
        </dl>` : ''}
      </div>
    </section>`;
  }

  function drawEnded(message) {
    const fresh = !shown?.closed;
    const intro = !shown;
    shown = { closed: true };
    const players = room?.players ?? [];
    const leftMono = escapeHtml(initials(players[0]?.username) || '?');
    const rightMono = escapeHtml(initials(players[1]?.username) || '?');
    render(app, `
    <div class="bpa-container bpa-lobby-page is-closed${intro ? ' is-intro' : ''}">
      ${topRow({ closed: true })}
      <div class="bpa-lobby-grid">
        <div class="bpa-lobby-colL">${caseDossier()}</div>
        <div class="bpa-lobby-colR">
          <section class="bpa-paper bpa-lobby-closed${fresh ? ' is-fresh' : ''}" aria-labelledby="lobby-closed-h">
            <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
            <span class="bpa-stamp bpa-lobby-cstamp${fresh ? ' bpa-lobby-slam' : ''}" aria-hidden="true">${tr('CLOSED', 'ĐÃ ĐÓNG')}</span>
            <p class="bpa-kicker bpa-lobby-kick">${tr('Lobby', 'Phòng chờ')} · <s>${escapeHtml(room?.roomCode ?? '')}</s></p>
            <svg class="bpa-lobby-snap" viewBox="0 0 520 112" aria-hidden="true" focusable="false">
              <g transform="translate(2 5)" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="2.8" stroke-linecap="round">
                <path class="bpa-lobby-snapthread" pathLength="1" d="M88 46Q170 52 222 62Q238 66 236 88"></path>
                <path class="bpa-lobby-snapthread" pathLength="1" d="M432 46Q350 52 298 62Q282 66 284 88"></path>
              </g>
              <g fill="none" stroke="#bf3b2c" stroke-width="2.1" stroke-linecap="round">
                <path class="bpa-lobby-snapthread" pathLength="1" d="M88 46Q170 52 222 62Q238 66 236 88"></path>
                <path class="bpa-lobby-snapthread" pathLength="1" d="M432 46Q350 52 298 62Q282 66 284 88"></path>
                <g class="bpa-lobby-fray" stroke-width="1.3">
                  <path d="M236 88l-4 8M236 88l1 9M236 88l5 7"></path>
                  <path d="M284 88l-5 7M284 88l-1 9M284 88l4 8"></path>
                </g>
              </g>
              <circle cx="56" cy="46" r="32" fill="#1a2c42" stroke="#c7a24b" stroke-width="2.5"></circle>
              <circle cx="56" cy="46" r="36" fill="none" stroke="rgba(26,44,66,.35)" stroke-width="1"></circle>
              <text x="56" y="55" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="25" font-weight="700" fill="#efd486">${leftMono}</text>
              <circle cx="464" cy="46" r="32" fill="#1a2c42" stroke="#c7a24b" stroke-width="2.5"></circle>
              <circle cx="464" cy="46" r="36" fill="none" stroke="rgba(26,44,66,.35)" stroke-width="1"></circle>
              <text x="464" y="55" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="25" font-weight="700" fill="#efd486">${rightMono}</text>
              <circle cx="89.5" cy="49.5" r="7" fill="rgba(0,0,0,.28)"></circle>
              <circle cx="88" cy="46" r="7" fill="#c0392b" stroke="#6e1a12" stroke-width="1"></circle>
              <circle cx="433.5" cy="49.5" r="7" fill="rgba(0,0,0,.28)"></circle>
              <circle cx="432" cy="46" r="7" fill="#c0392b" stroke="#6e1a12" stroke-width="1"></circle>
            </svg>
            <h2 id="lobby-closed-h" class="bpa-lobby-ctitle">${tr('Room closed', 'Phòng đã đóng')}</h2>
            <p class="bpa-lobby-ctext">${escapeHtml(message)}</p>
            <p class="bpa-lobby-cnote">${tr('Start a new room from the case list to play again.', 'Hãy mở phòng mới từ danh sách vụ án để chơi lại.')}</p>
            <button type="button" class="bpa-btn bpa-btn--red bpa-lobby-back-btn" id="back-to-cases">${tr('Back to cases', 'Về danh sách vụ án')}${ICON.arrow}</button>
          </section>
        </div>
      </div>
    </div>`);

    qs('#back-to-cases', app)?.addEventListener('click', () => {
      window.location.hash = '#/cases';
    });
  }

  function draw() {
    if (disposed || !room || leaving) return;
    loadCase();
    if (endedMessage) {
      drawEnded(endedMessage);
      return;
    }
    if (TERMINAL_STATUSES.has(room.status)) {
      drawEnded(tr('This room has already ended and cannot be reused.', 'Phòng này đã kết thúc và không thể dùng lại.'));
      return;
    }
    const my = room.players.find((p) => p.userId === me.userId);
    const isHost = room.hostUserId === me.userId;
    const bothReady = room.players.length === 2 && room.players.every((p) => p.isReady && p.role);

    // Me first, then the partner (or an empty seat while waiting).
    const partner = room.players.find((p) => p.userId !== me.userId);
    const seats = [my ?? room.players[0], my ? partner : room.players[1]].filter(Boolean);
    const twoSeats = seats.length === 2;
    const readyCount = room.players.filter((p) => p.isReady).length;

    const now = {
      closed: false,
      ready: Object.fromEntries(room.players.map((p) => [p.userId, !!p.isReady])),
      linked: bothReady,
      myRole: my?.role ?? null,
    };
    const before = shown && !shown.closed ? shown : { ready: {}, linked: false, myRole: null };
    const intro = !shown;
    const fx = {
      stamp: (p) => now.ready[p.userId] && !before.ready[p.userId],
      link: now.linked && !before.linked,
      mine: !!now.myRole && now.myRole !== before.myRole,
    };
    shown = now;

    const seatCard = (p, side) => {
      const isMe = p.userId === me.userId;
      const role = roleById(p.role);
      const offline = !isMe && p.isConnected === false;
      return `
      <article class="bpa-paper bpa-lobby-id bpa-lobby-id--${side}${p.isReady ? ' is-ready' : ''}" aria-labelledby="lobby-seat-${side}">
        <span class="bpa-pin" aria-hidden="true"></span>
        ${twoSeats ? `<span class="bpa-pin bpa-pin--red bpa-lobby-epin" aria-hidden="true"></span>` : ''}
        <div class="bpa-lobby-idhead">
          <span class="bpa-lobby-mini">${tr('Detective card', 'Thẻ thám tử')}</span>
          ${offline ? `<span class="bpa-lobby-mini is-off">${tr('Disconnected', 'Mất kết nối')}</span>` : ''}
        </div>
        <div class="bpa-lobby-who">
          <span class="bpa-avatar bpa-lobby-mono" aria-hidden="true">${escapeHtml(initials(p.username))}</span>
          <div class="bpa-lobby-whotxt">
            <h3 id="lobby-seat-${side}" class="bpa-lobby-name">${escapeHtml(p.username)}</h3>
            <div class="bpa-lobby-tags">
              ${isMe ? `<span class="bpa-chip bpa-chip--teal">${tr('YOU', 'BẠN')}</span>` : `<span class="bpa-chip bpa-chip--rust">${tr('PARTNER', 'ĐỒNG ĐỘI')}</span>`}
              ${p.userId === room.hostUserId ? `<span class="bpa-chip bpa-chip--dark">${ICON.key}${tr('HOST', 'CHỦ PHÒNG')}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="bpa-lobby-idfoot">
          <div class="bpa-lobby-rolebox">
            <span class="bpa-lobby-mini">${tr('Role', 'Vai trò')}</span>
            ${role
              ? `<span class="bpa-lobby-rolev"><span class="bpa-lobby-dot bpa-lobby-dot--${role.modifier}" aria-hidden="true"></span>${tr(role.title, role.viTitle)}</span>`
              : `<span class="bpa-lobby-rolev is-pending">${tr('choosing role', 'đang chọn vai')}<span class="bpa-lobby-dots" aria-hidden="true">…</span></span>`}
          </div>
          <div class="bpa-lobby-status">
            ${p.isReady
              ? `<span class="bpa-stamp bpa-stamp--teal bpa-lobby-idstamp${fx.stamp(p) ? ' bpa-lobby-slam' : ''}" style="--r: ${side === 'a' ? '-6deg' : '5deg'}">${tr('READY', 'SẴN SÀNG')}</span>`
              : `<span class="bpa-lobby-wait"><i aria-hidden="true"></i>${tr('WAITING', 'ĐANG CHỜ')}</span>`}
          </div>
        </div>
      </article>`;
    };

    const emptySeat = `
      <article class="bpa-lobby-id bpa-lobby-id--b bpa-lobby-id--empty" aria-labelledby="lobby-seat-b">
        <div class="bpa-lobby-idhead"><span class="bpa-lobby-mini">${tr('Detective card', 'Thẻ thám tử')}</span></div>
        <div class="bpa-lobby-who">
          <span class="bpa-lobby-ghost" aria-hidden="true">
            <svg viewBox="0 0 60 60" width="60" height="60" focusable="false"><circle cx="30" cy="23" r="10"></circle><path d="M12 52c2-11 9-17 18-17s16 6 18 17z"></path></svg>
          </span>
          <div class="bpa-lobby-whotxt">
            <h3 id="lobby-seat-b" class="bpa-lobby-name is-pending">${tr('Waiting for your partner', 'Đang chờ đồng đội')}<span class="bpa-lobby-dots" aria-hidden="true">…</span></h3>
            <p class="bpa-lobby-emptynote">${tr('Share the room code or the invite link.', 'Gửi mã phòng hoặc liên kết mời cho đồng đội.')}</p>
          </div>
        </div>
      </article>`;

    const link = `
      <div class="bpa-lobby-link${bothReady ? ' is-linked' : ''}" aria-hidden="true">
        <svg class="bpa-lobby-link-h" viewBox="0 0 170 120" focusable="false">
          <path class="bpa-lobby-pencil" d="M0 60Q85 76 170 60"></path>
          ${bothReady ? `
          <path class="bpa-string bpa-string--shadow${fx.link ? ' bpa-string--draw' : ''}" pathLength="1" d="M0 60Q85 76 170 60"></path>
          <path class="bpa-string${fx.link ? ' bpa-string--draw' : ''}" pathLength="1" d="M0 60Q85 76 170 60"></path>` : ''}
        </svg>
        <svg class="bpa-lobby-link-v" viewBox="0 0 120 96" focusable="false">
          <path class="bpa-lobby-pencil" d="M60 0Q72 48 60 96"></path>
          ${bothReady ? `
          <path class="bpa-string bpa-string--shadow${fx.link ? ' bpa-string--draw' : ''}" pathLength="1" d="M60 0Q72 48 60 96"></path>
          <path class="bpa-string${fx.link ? ' bpa-string--draw' : ''}" pathLength="1" d="M60 0Q72 48 60 96"></path>` : ''}
        </svg>
        ${bothReady ? `<span class="bpa-lobby-teamtag${fx.link ? ' is-new' : ''}"><span class="bpa-stamp bpa-stamp--teal${fx.link ? ' bpa-lobby-slam' : ''}" style="--r: -4deg">${tr('FULL TEAM', 'ĐỦ ĐỘI')}</span></span>` : ''}
      </div>`;

    const roleCards = ROLES.map((role) => {
      const takenBy = room.players.find((p) => p.role === role.id);
      const mine = my?.role === role.id;
      const blocked = takenBy && takenBy.userId !== me.userId;
      const marker = mine || blocked
        ? `<span class="bpa-avatar bpa-lobby-rpin${blocked ? ' bpa-avatar--rust' : ''}" aria-hidden="true">${escapeHtml(initials((mine ? my : takenBy).username))}</span>`
        : `<span class="bpa-pin" aria-hidden="true"></span>`;
      return `
      <button type="button" class="bpa-lobby-role bpa-lobby-role--${role.modifier}${mine ? ' is-mine' : ''}${blocked ? ' is-taken' : ''}"
              data-role="${role.id}" aria-pressed="${mine}" ${blocked ? 'disabled' : ''}>
        ${marker}
        ${role.art()}
        <span class="bpa-lobby-rbody">
          <span class="bpa-lobby-rname"><span class="bpa-lobby-dot bpa-lobby-dot--${role.modifier}" aria-hidden="true"></span>${tr(role.title, role.viTitle)}</span>
          <span class="bpa-lobby-rdesc">${tr(role.blurb, role.viBlurb)}</span>
          <span class="bpa-lobby-rfoot">
            ${blocked
              ? `<span class="bpa-lobby-taken"><span class="bpa-avatar bpa-avatar--rust bpa-lobby-mm" aria-hidden="true">${escapeHtml(initials(takenBy.username))}</span>${tr('Taken by', 'Đã được chọn bởi')} ${escapeHtml(takenBy.username)}</span>`
              : role.tags.map(([en, vi]) => `<span class="bpa-chip">${tr(en, vi)}</span>`).join('')}
          </span>
        </span>
        ${blocked ? `<span class="bpa-lobby-lock">${LOCK_ICON}</span>` : ''}
        ${mine ? `<span class="bpa-stamp bpa-lobby-rstamp${fx.mine ? ' bpa-lobby-slam' : ''}" style="--r: -7deg">${tr('YOUR ROLE', 'VAI CỦA BẠN')}</span>` : ''}
      </button>`;
    }).join('');

    render(app, `
    <div class="bpa-container bpa-lobby-page${intro ? ' is-intro' : ''}">
      ${topRow({ closed: false })}

      <div class="bpa-lobby-grid">
        <div class="bpa-lobby-colL">
          <div class="bpa-lobby-o5">${caseDossier()}</div>

          <section class="bpa-panel bpa-lobby-invite bpa-lobby-o4" aria-labelledby="lobby-code-h">
            <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
            <h2 id="lobby-code-h" class="bpa-kicker bpa-lobby-kick-gold">${tr('Room code', 'Mã phòng')}</h2>
            <div class="bpa-lobby-coderow">
              <span class="bpa-lobby-code">${escapeHtml(room.roomCode)}</span>
              <button type="button" class="bpa-btn bpa-btn--gold bpa-lobby-copy" id="copy-code">${ICON.copy}${ICON.copied}${tr('Copy', 'Sao chép')}</button>
            </div>
            <div class="bpa-lobby-invrule" aria-hidden="true"></div>
            <div class="bpa-lobby-invhead">
              <label class="bpa-lobby-h3" id="room-invite-heading" for="room-invite-link">${tr('Invite your partner', 'Mời đồng đội')}</label>
              <button type="button" class="bpa-btn bpa-btn--gold bpa-lobby-linkbtn" id="copy-invite">${ICON.link}${tr('Copy invite link', 'Sao chép liên kết mời')}</button>
            </div>
            <input class="bpa-lobby-linkfield" id="room-invite-link" type="url" readonly value="${escapeHtml(roomInviteUrl(room.roomCode))}" aria-describedby="lobby-invite-help">
            <p class="bpa-lobby-help" id="lobby-invite-help">${tr('Your partner can sign in, then choose to join.', 'Đồng đội đăng nhập rồi bấm vào phòng.')}</p>
          </section>
        </div>

        <div class="bpa-lobby-colR">
          <section class="bpa-lobby-o1" aria-labelledby="lobby-team-h">
            <div class="bpa-lobby-sechead"><h2 id="lobby-team-h" class="bpa-lobby-tapelabel">${tr('Detectives', 'Thám tử')} (${room.players.length}/2)</h2></div>
            <div class="bpa-lobby-pair">
              ${seats[0] ? seatCard(seats[0], 'a') : ''}
              ${link}
              ${seats[1] ? seatCard(seats[1], 'b') : emptySeat}
            </div>
          </section>

          <section class="bpa-lobby-o2" aria-labelledby="lobby-roles-h">
            <div class="bpa-lobby-sechead"><h2 id="lobby-roles-h" class="bpa-lobby-tapelabel">${tr('Pick your role', 'Chọn vai trò')}</h2></div>
            <div class="bpa-lobby-roles" role="group" aria-labelledby="lobby-roles-h">${roleCards}</div>
          </section>

          <section class="bpa-panel bpa-lobby-bar bpa-lobby-o3" aria-labelledby="lobby-bar-k">
            <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
            <div class="bpa-lobby-bartxt">
              <p id="lobby-bar-k" class="bpa-kicker bpa-lobby-kick-gold">${tr('Ready', 'Sẵn sàng')} ${readyCount}/2</p>
              <p class="bpa-lobby-barnote">${tr('The host starts the game when everyone is ready.', 'Chủ phòng sẽ bắt đầu khi mọi người đã sẵn sàng.')}</p>
              <p id="lobby-req" class="bpa-lobby-req${bothReady ? ' is-ok' : ''}">${bothReady ? ICON.ok : ICON.warn}<span>${tr('Both players must pick different roles and ready up.', 'Cả hai người phải chọn vai khác nhau và sẵn sàng.')}</span></p>
            </div>
            <div class="bpa-lobby-btns">
              <button type="button" class="bpa-btn ${my?.isReady ? 'bpa-btn--gold' : 'bpa-lobby-btn-ok'}" id="ready-btn" ${my?.role ? '' : `disabled title="${tr('Pick a role first', 'Hãy chọn vai trước')}"`}>
                ${my?.isReady ? ICON.cross : ICON.check}${my?.isReady ? tr('Cancel ready', 'Hủy sẵn sàng') : tr('Ready up', 'Sẵn sàng')}
              </button>
              ${isHost ? `<button type="button" class="bpa-btn bpa-btn--red bpa-lobby-start${bothReady && fx.link ? ' is-go' : ''}" id="start-btn" ${bothReady ? '' : `disabled title="${tr('Both players must pick different roles and ready up', 'Cả hai người phải chọn vai khác nhau và sẵn sàng')}" aria-describedby="lobby-req"`}>${ICON.lens}${tr('Start investigation', 'Bắt đầu điều tra')}</button>` : ''}
            </div>
          </section>
        </div>
      </div>
    </div>`);

    qs('#copy-invite', app)?.addEventListener('click', async () => {
      const input = qs('#room-invite-link', app);
      try {
        await navigator.clipboard.writeText(input.value);
        if (!disposed) toast(tr('Invite link copied.', 'Đã sao chép liên kết mời.'), 'success');
      } catch {
        if (disposed) return;
        input.focus();
        input.select();
        toast(tr('Select and copy the invite link above.', 'Hãy sao chép liên kết đã chọn ở trên.'), 'info');
      }
    });

    qs('#copy-code', app)?.addEventListener('click', async (event) => {
      // Visual acknowledgement only — no new copy, no string change.
      const button = event.currentTarget;
      button.classList.add('is-copied');
      window.setTimeout(() => button.classList.remove('is-copied'), 1200);
      try {
        await navigator.clipboard.writeText(room.roomCode);
        toast(tr('Room code copied.', 'Đã sao chép mã phòng.'), 'success');
      } catch {
        toast(tr(`Room code: ${room.roomCode}`, `Mã phòng: ${room.roomCode}`), 'info');
      }
    });

    app.querySelectorAll('[data-role]').forEach((card) =>
      card.addEventListener('click', async () => {
        try {
          room = await roomApi.selectRole(roomId, card.dataset.role);
          draw();
        } catch (err) {
          handleActionError(err);
        }
      }));

    qs('#ready-btn', app)?.addEventListener('click', async () => {
      try {
        room = await roomApi.ready(roomId, !my?.isReady);
        draw();
      } catch (err) {
        handleActionError(err);
      }
    });

    qs('#start-btn', app)?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try {
        await roomApi.start(roomId);
        if (!disposed) window.location.hash = `#/game/${roomId}`;
      } catch (err) {
        handleActionError(err);
        draw();
      }
    });

    qs('#leave-btn', app)?.addEventListener('click', async () => {
      leaving = true;
      try {
        await roomApi.leave(roomId);
      } catch {
        /* leaving anyway */
      }
      if (!disposed) window.location.hash = '#/cases';
    });
  }

  return cleanup;
}
