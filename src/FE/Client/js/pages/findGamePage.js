import '../../../css/37-bpa-find-game.css';
import { matchmakingApi } from '../api/matchmakingApi.js';
import { createUserHubConnection } from '../services/userHub.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr, uiLanguage } from '../services/i18n.js';
import { navigate } from '../services/navigation.js';

/**
 * /find-game — "Tìm trận" (FindGame.dc.html). The server owns the queue: this page sends the
 * settings, then mirrors GET /api/matchmaking/status, refreshed by polling and by the
 * "MatchmakingUpdated" push on /hubs/game. Phases: IDLE → SEARCHING → FOUND (accept within the
 * countdown) → ACCEPTED (waiting for the partner) → READY (go to the lobby).
 */
const PREFS_KEY = 'sirlocked.findGamePrefs';
const POLL_SEARCHING_MS = 3000;
const POLL_FOUND_MS = 1000;
const REDIRECT_DELAY_MS = 1200;
const LIVE_PHASES = new Set(['SEARCHING', 'FOUND', 'ACCEPTED']);

const OPTIONS = {
  mode: ['QUICK', 'RANKED'],
  preferredRole: ['INVESTIGATOR', 'INTERROGATOR', 'ANY'],
  caseLength: ['SHORT', 'MEDIUM', 'LONG'],
  language: ['vi', 'en'],
};
const DEFAULT_PREFS = { mode: 'QUICK', preferredRole: 'ANY', caseLength: 'MEDIUM', language: 'vi' };

const roleName = (role) => (role === 'INVESTIGATOR'
  ? tr('Investigator', 'Điều tra viên')
  : role === 'INTERROGATOR' ? tr('Interrogator', 'Thẩm vấn viên') : tr('Any', 'Bất kỳ'));
const languageName = (language) => (language === 'en' ? 'English' : 'Tiếng Việt');
const modeName = (mode) => (mode === 'RANKED' ? tr('Ranked', 'Xếp hạng') : tr('Quick match', 'Ghép nhanh'));

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {};
    // First visit: cases in the interface language.
    const prefs = { ...DEFAULT_PREFS, language: uiLanguage() === 'en' ? 'en' : 'vi' };
    for (const key of Object.keys(OPTIONS)) if (OPTIONS[key].includes(saved[key])) prefs[key] = saved[key];
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* per-viewer convenience only */ }
}

const ICON_LENS = (size = 20, stroke = 2) => `
  <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6"></circle><path d="M15 15l5.5 5.5"></path></svg>`;

/** The London case map behind the search (decorative). */
function mapSvg() {
  const label = (x, y, text, extra = '') =>
    `<text x="${x}" y="${y}" class="bpa-fg-maplabel" ${extra}>${escapeHtml(text)}</text>`;
  return `
  <svg class="bpa-fg-mapart" aria-hidden="true" focusable="false" viewBox="0 0 820 600" preserveAspectRatio="xMidYMid slice">
    <rect width="820" height="600" fill="#e7ddc5"></rect>
    <rect x="262" y="34" width="190" height="110" rx="10" fill="#c9d3b2" opacity=".8"></rect>
    ${label(357, 94, tr("REGENT'S PARK", 'CÔNG VIÊN REGENT'), 'fill="#5c6b4c" text-anchor="middle"')}
    <path d="M-10 452C110 410 220 488 340 458S560 378 660 428S800 492 830 462" fill="none" stroke="#a9c7c3" stroke-width="38"></path>
    <path d="M-10 452C110 410 220 488 340 458S560 378 660 428S800 492 830 462" fill="none" stroke="#8fb4b0" stroke-width="1.5" stroke-dasharray="2 6"></path>
    ${label(520, 430, tr('RIVER THAMES', 'SÔNG THAMES'), 'fill="#4c7470" font-size="10" letter-spacing="4"')}
    <g fill="none" stroke="#c9b892" stroke-width="1.4">
      <path d="M0 80H820M0 130H820M0 205H820M0 270H820M0 330H820M0 380H820M0 530H820M0 575H820"></path>
      <path d="M60 0V600M120 0V600M200 0V420M290 0V600M370 0V440M450 0V600M530 0V400M610 0V600M690 0V600M760 0V600"></path>
      <path d="M370 205L530 330M610 130L760 270M120 330L290 205M450 530L610 575"></path>
    </g>
    <g fill="none" stroke="#f3ecd9" stroke-width="7"><path d="M0 170H820M240 0V600M560 0V600"></path></g>
    <g fill="none" stroke="#b9a77f" stroke-width="1"><path d="M0 166H820M0 174H820M236 0V600M244 0V600M556 0V600M564 0V600"></path></g>
    ${label(70, 163, tr('BAKER STREET', 'PHỐ BAKER'), 'fill="#6b5f4b"')}
    ${label(430, 250, 'SOHO', 'fill="#8a7b60" font-size="10" letter-spacing="3"')}
    ${label(372, 520, 'WESTMINSTER', 'fill="#8a7b60" font-size="10" letter-spacing="3"')}
    ${label(640, 318, 'WHITECHAPEL', 'fill="#8a7b60" font-size="10" letter-spacing="3"')}
    <g transform="translate(748 540)" fill="none" stroke="#6b5f4b" stroke-width="1.4">
      <circle r="24"></circle><path d="M0 -20L6 0L0 20L-6 0Z" fill="#6b5f4b"></path>
      <text y="-30" class="bpa-fg-maplabel" fill="#6b5f4b" stroke="none" text-anchor="middle" font-size="10">${tr('N', 'B')}</text>
    </g>
    <g>
      <path class="bpa-fg-thread t1" pathLength="1" d="M248 178L468 140"></path>
      <path class="bpa-fg-thread t2" pathLength="1" d="M248 178L604 236"></path>
      <path class="bpa-fg-thread t3 is-match" pathLength="1" d="M248 178L560 330"></path>
      <path class="bpa-fg-thread t4" pathLength="1" d="M248 178L380 300"></path>
      <path class="bpa-fg-thread t5" pathLength="1" d="M248 178L690 520"></path>
      <path class="bpa-fg-thread t6" pathLength="1" d="M248 178L150 520"></path>
    </g>
    <g fill="#c7a24b" stroke="#5e4a1c" stroke-width="1.2">
      <circle class="bpa-fg-dpin" cx="468" cy="140" r="7"></circle>
      <circle class="bpa-fg-dpin" cx="604" cy="236" r="7"></circle>
      <circle class="bpa-fg-dpin" cx="560" cy="330" r="7"></circle>
      <circle class="bpa-fg-dpin" cx="380" cy="300" r="7"></circle>
      <circle class="bpa-fg-dpin" cx="690" cy="520" r="7"></circle>
      <circle class="bpa-fg-dpin" cx="150" cy="520" r="7"></circle>
    </g>
    <g transform="translate(248 178)">
      <circle r="11" fill="#c0392b" stroke="#6e1a12" stroke-width="1.5"></circle>
      <circle cx="-3" cy="-3" r="3" fill="rgba(255,255,255,.55)"></circle>
      <rect x="14" y="-28" width="76" height="20" fill="#0d1014"></rect>
      <text x="52" y="-14" class="bpa-fg-maplabel" font-size="10" font-weight="700" letter-spacing="1.5" fill="#efd486" text-anchor="middle">${tr('221B · YOU', '221B · BẠN')}</text>
    </g>
  </svg>`;
}

function optionButton(group, value, label, { sub = '', dot = '' } = {}) {
  return `
    <button type="button" class="bpa-fg-opt${sub || dot ? ' is-tall' : ''}" data-fg-group="${group}" data-fg-value="${value}" aria-pressed="false">
      ${dot ? `<span class="bpa-fg-dot bpa-fg-dot--${dot}" aria-hidden="true"></span>` : ''}
      <span>${label}</span>
      ${sub ? `<small>${sub}</small>` : ''}
    </button>`;
}

function setupHtml() {
  return `
  <section class="bpa-paper bpa-paper--card bpa-fg-setup" aria-labelledby="fg-setup-h">
    <span class="bpa-pin" aria-hidden="true"></span>
    <h2 id="fg-setup-h" class="bpa-fg-setuph">${tr('Matchmaking setup', 'Thiết lập tìm trận')}</h2>

    <div class="bpa-fg-field" role="group" aria-labelledby="fg-mode-l">
      <span class="bpa-fg-fieldl" id="fg-mode-l">01 — ${tr('Mode', 'Chế độ')}</span>
      <div class="bpa-fg-grid bpa-fg-grid--2">
        ${optionButton('mode', 'QUICK', tr('Quick match', 'Ghép nhanh'))}
        ${optionButton('mode', 'RANKED', tr('Ranked', 'Xếp hạng'))}
      </div>
    </div>

    <div class="bpa-fg-field" role="group" aria-labelledby="fg-role-l">
      <span class="bpa-fg-fieldl" id="fg-role-l">02 — ${tr('Preferred role', 'Vai trò mong muốn')}</span>
      <div class="bpa-fg-grid bpa-fg-grid--3">
        ${optionButton('preferredRole', 'INVESTIGATOR', tr('Investigator', 'Điều tra viên'), { dot: 'inv' })}
        ${optionButton('preferredRole', 'INTERROGATOR', tr('Interrogator', 'Thẩm vấn viên'), { dot: 'int' })}
        ${optionButton('preferredRole', 'ANY', tr('Any', 'Bất kỳ'), { dot: 'any' })}
      </div>
    </div>

    <div class="bpa-fg-field" role="group" aria-labelledby="fg-length-l">
      <span class="bpa-fg-fieldl" id="fg-length-l">03 — ${tr('Case length', 'Độ dài vụ án')}</span>
      <div class="bpa-fg-grid bpa-fg-grid--3">
        ${optionButton('caseLength', 'SHORT', tr('Short', 'Ngắn'), { sub: tr('≤ 20 min', '≤ 20 phút') })}
        ${optionButton('caseLength', 'MEDIUM', tr('Medium', 'Vừa'), { sub: tr('~ 35 min', '~ 35 phút') })}
        ${optionButton('caseLength', 'LONG', tr('Long', 'Dài'), { sub: tr('60+ min', '60+ phút') })}
      </div>
    </div>

    <div class="bpa-fg-field" role="group" aria-labelledby="fg-lang-l">
      <span class="bpa-fg-fieldl" id="fg-lang-l">04 — ${tr('Case language', 'Ngôn ngữ vụ án')}</span>
      <div class="bpa-fg-grid bpa-fg-grid--2">
        ${optionButton('language', 'vi', 'Tiếng Việt')}
        ${optionButton('language', 'en', 'English')}
      </div>
    </div>

    <div class="bpa-fg-actions">
      <div id="fg-notice" aria-live="polite"></div>
      <div id="fg-action"></div>
      <a class="bpa-link bpa-fg-friends" href="/rooms">${tr('Playing with friends? Create a private room', 'Muốn chơi với bạn bè? Tạo phòng riêng')}</a>
    </div>
  </section>`;
}

export async function renderFindGamePage(app, context = {}) {
  const signal = context.signal;
  const state = {
    phase: 'IDLE',
    prefs: loadPrefs(),
    status: null,
    offsetMs: 0,
    lastServerTime: 0,
    busy: false,
    notice: null,
    readyRoomId: null,
  };
  let disposed = false;
  let pollTimer = 0;
  let redirectTimer = 0;
  let expiryPolled = '';

  render(app, `
  <div class="bpa-container bpa-fg-page">
    <div class="bpa-fg-top">
      <div class="bpa-label">
        <p class="bpa-kicker">${tr('File 03 · Matchmaking', 'Hồ sơ 03 · Ghép đôi')}</p>
        <h1 class="bpa-fg-h1">${tr('Find a game', 'Tìm trận')}</h1>
      </div>
      <p class="bpa-fg-lead">${tr(
        'Two detectives, one case. Choose how you want to play and we will pair you with a fitting partner.',
        'Hai thám tử, một vụ án. Chọn cách bạn muốn chơi, hệ thống sẽ ghép bạn với một người phù hợp.',
      )}</p>
    </div>
    <div class="bpa-fg-cols">
      ${setupHtml()}
      <section class="bpa-fg-map is-idle" id="fg-map" aria-label="${tr('Matchmaking map', 'Bản đồ ghép đôi')}">
        ${mapSvg()}
        <div class="bpa-fg-lens" aria-hidden="true"></div>
        <div class="bpa-fg-bar">
          <div class="bpa-fg-bartext">
            <span class="bpa-fg-bartitle" id="fg-status-title"></span>
            <span class="bpa-fg-barsub" id="fg-status-text"></span>
          </div>
          <span class="bpa-fg-timer" id="fg-timer">00:00</span>
        </div>
        <p class="bpa-sr" role="status" id="fg-sr"></p>
        <div id="fg-overlay"></div>
      </section>
    </div>
  </div>`);

  const $ = (selector) => app.querySelector(selector);
  const serverNow = () => Date.now() + state.offsetMs;
  const locked = () => state.phase !== 'IDLE' || state.busy;

  function elapsedText() {
    const started = Date.parse(state.status?.searchStartedAt || '');
    const secs = LIVE_PHASES.has(state.phase) && Number.isFinite(started) ? Math.max(0, Math.floor((serverNow() - started) / 1000)) : 0;
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }

  function secondsLeft() {
    const expires = Date.parse(state.status?.match?.expiresAt || '');
    return Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - serverNow()) / 1000)) : 0;
  }

  function statusCopy() {
    const match = state.status?.match;
    switch (state.phase) {
      case 'SEARCHING':
        return [tr('Searching for a partner', 'Đang tìm đồng đội'), tr('Following the trail of fitting detectives…', 'Đang lần theo các thám tử phù hợp…')];
      case 'FOUND':
        return [tr('Partner found', 'Đã tìm thấy đồng đội'), tr('Accept to go to the lobby.', 'Xác nhận để vào phòng chờ.')];
      case 'ACCEPTED':
        return match?.partnerAccepted
          ? [tr('Matched', 'Đã ghép đôi'), tr('Opening the case file…', 'Đang mở hồ sơ vụ án…')]
          : [tr('Waiting for your partner', 'Đang chờ đồng đội'), tr('You accepted. Waiting for your partner to confirm…', 'Bạn đã chấp nhận. Đang chờ đồng đội xác nhận…')];
      case 'READY':
        return [tr('Matched', 'Đã ghép đôi'), tr('Opening the case file…', 'Đang mở hồ sơ vụ án…')];
      default:
        return [tr('Ready to find a partner', 'Sẵn sàng tìm đồng đội'), tr('Pick your settings, then start searching.', 'Chọn thiết lập rồi bấm Bắt đầu tìm.')];
    }
  }

  function paintOptions() {
    app.querySelectorAll('[data-fg-group]').forEach((button) => {
      button.setAttribute('aria-pressed', String(state.prefs[button.dataset.fgGroup] === button.dataset.fgValue));
      button.disabled = locked();
    });
  }

  // Polls repaint often; the buttons are only rebuilt when they change, so a press in progress
  // is never swapped out from under the pointer.
  let actionKey = '';
  function paintAction() {
    const slot = $('#fg-action');
    if (!slot) return;
    const key = `${state.phase}:${state.busy}`;
    if (key === actionKey) return;
    actionKey = key;
    if (state.phase === 'IDLE') {
      slot.innerHTML = `
        <button type="button" class="bpa-btn bpa-btn--red bpa-btn--block bpa-fg-start" id="fg-start" ${state.busy ? 'disabled' : ''}>
          ${ICON_LENS()}${state.busy ? tr('Starting…', 'Đang bắt đầu…') : tr('Start searching', 'Bắt đầu tìm')}
        </button>`;
      $('#fg-start')?.addEventListener('click', start);
    } else if (state.phase === 'SEARCHING') {
      slot.innerHTML = `
        <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--block bpa-fg-cancel" id="fg-cancel" ${state.busy ? 'disabled' : ''}>
          ${tr('Cancel search', 'Hủy tìm')} · <span data-fg-elapsed>${elapsedText()}</span>
        </button>`;
      $('#fg-cancel')?.addEventListener('click', cancel);
    } else {
      slot.innerHTML = '';
    }
  }

  let shownNotice;
  function paintNotice() {
    const slot = $('#fg-notice');
    if (!slot || shownNotice === state.notice) return;
    shownNotice = state.notice;
    const notice = state.notice;
    if (!notice) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <p class="bpa-fg-notice is-${notice.tone}" role="${notice.tone === 'error' ? 'alert' : 'status'}">
        <span>${escapeHtml(notice.text)}</span>
        ${notice.roomId ? `<a class="bpa-btn bpa-btn--ink bpa-btn--sm" href="/lobby/${encodeURIComponent(notice.roomId)}">${tr('Open lobby', 'Vào phòng chờ')}</a>` : ''}
      </p>`;
  }

  function foundCardHtml() {
    const match = state.status.match;
    const accepted = state.phase === 'ACCEPTED';
    return `
      <div class="bpa-fg-found" role="dialog" aria-modal="false" aria-labelledby="fg-found-name" aria-describedby="fg-found-case">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <span class="bpa-stamp bpa-fg-stamp" aria-hidden="true">${tr('Match!', 'Khớp!')}</span>
        <p class="bpa-fg-kick">${tr('Partner found', 'Đã tìm thấy đồng đội')}</p>
        <h2 class="bpa-fg-name" id="fg-found-name">${escapeHtml(match.partnerUsername || tr('Detective', 'Thám tử'))}</h2>
        <p class="bpa-fg-kick bpa-fg-sub">${tr('Detective', 'Thám tử')} · ${escapeHtml(modeName(match.mode))}${match.partnerAccepted ? ` · ${tr('accepted', 'đã chấp nhận')}` : ''}</p>
        <div class="bpa-fg-roles">
          <div class="bpa-fg-role bpa-fg-role--${match.yourRole === 'INVESTIGATOR' ? 'inv' : 'int'}"><span>${tr('You', 'Bạn')}</span><strong>${escapeHtml(roleName(match.yourRole))}</strong></div>
          <div class="bpa-fg-role bpa-fg-role--${match.partnerRole === 'INVESTIGATOR' ? 'inv' : 'int'}"><span>${tr('Partner', 'Đồng đội')}</span><strong>${escapeHtml(roleName(match.partnerRole))}</strong></div>
        </div>
        <p class="bpa-fg-case" id="fg-found-case">${tr('Case', 'Vụ án')}: <strong>${escapeHtml(match.caseTitle)}</strong> · ${escapeHtml(match.estimatedMinutes)} ${tr('min', 'phút')} · ${escapeHtml(languageName(match.language))}</p>
        <div class="bpa-fg-btns">
          <button type="button" class="bpa-btn bpa-btn--red bpa-fg-accept" id="fg-accept" ${accepted || state.busy ? 'disabled' : ''}>
            ${accepted ? tr('Accepted · waiting', 'Đã chấp nhận · chờ') : tr('Accept', 'Chấp nhận')} · <span data-fg-countdown>${secondsLeft()}</span>
          </button>
          <button type="button" class="bpa-btn bpa-btn--ink" id="fg-decline" ${state.busy ? 'disabled' : ''}>${tr('Decline', 'Từ chối')}</button>
        </div>
      </div>`;
  }

  function readyCardHtml() {
    const roomId = state.status?.roomId;
    return `
      <div class="bpa-fg-ready" role="status">
        <span class="bpa-spin bpa-fg-readyicon">${ICON_LENS(44, 1.6)}</span>
        <p class="bpa-fg-readyk">${tr('Opening the case file…', 'Đang mở hồ sơ vụ án…')}</p>
        <p class="bpa-fg-readyt">${tr('Your partner is ready. Heading to the lobby.', 'Đồng đội đã sẵn sàng. Chuẩn bị vào phòng chờ.')}</p>
        ${roomId
          ? `<a class="bpa-btn bpa-btn--red" id="fg-enter-lobby" href="/lobby/${encodeURIComponent(roomId)}">${tr('Enter the lobby', 'Vào phòng chờ')}</a>`
          : `<span class="bpa-btn bpa-btn--red" aria-disabled="true">${tr('Opening the lobby…', 'Đang mở phòng chờ…')}</span>`}
      </div>`;
  }

  let overlayKey = '';
  function paintOverlay() {
    const slot = $('#fg-overlay');
    if (!slot) return;
    const match = state.status?.match;
    const showReady = state.phase === 'READY' || (state.phase === 'ACCEPTED' && match?.partnerAccepted);
    const key = showReady
      ? `ready:${state.status?.roomId || ''}`
      : (state.phase === 'FOUND' || state.phase === 'ACCEPTED') && match
        ? `found:${match.matchId}:${state.phase}:${match.partnerAccepted}:${state.busy}`
        : '';
    if (key === overlayKey) return;
    const wasFound = overlayKey.startsWith(`found:${match?.matchId}:`);
    overlayKey = key;
    if (!key) { slot.innerHTML = ''; return; }
    slot.innerHTML = showReady ? readyCardHtml() : foundCardHtml();
    // Re-paints of the same match keep the card still; only a new match animates in.
    if (wasFound) slot.firstElementChild?.classList.add('is-static');
    $('#fg-accept')?.addEventListener('click', accept);
    $('#fg-decline')?.addEventListener('click', decline);
    // Focusing also scrolls the card into view where the map sits below the settings (phones).
    if (!wasFound && state.phase === 'FOUND') $('#fg-accept')?.focus();
  }

  function paint() {
    if (disposed || !app.isConnected) return;
    const map = $('#fg-map');
    const visual = state.phase === 'READY' || (state.phase === 'ACCEPTED' && state.status?.match?.partnerAccepted)
      ? 'accepted' : state.phase.toLowerCase();
    if (map) map.className = `bpa-fg-map is-${visual === 'accepted' ? 'accepted' : visual}`;
    const [title, text] = statusCopy();
    $('#fg-status-title').textContent = title;
    $('#fg-status-text').textContent = text;
    $('#fg-sr').textContent = `${title}. ${text}`;
    paintOptions();
    paintAction();
    paintNotice();
    paintOverlay();
    tick();
  }

  /** Text-only updates, four times a second. */
  function tick() {
    if (disposed || !app.isConnected) return;
    const elapsed = elapsedText();
    const timer = $('#fg-timer');
    if (timer) timer.textContent = elapsed;
    app.querySelectorAll('[data-fg-elapsed]').forEach((node) => { node.textContent = elapsed; });
    const left = secondsLeft();
    app.querySelectorAll('[data-fg-countdown]').forEach((node) => { node.textContent = String(left); });
    // When the window closes, ask the server instead of waiting for the next poll.
    const matchId = state.status?.match?.matchId;
    if (left === 0 && matchId && (state.phase === 'FOUND' || state.phase === 'ACCEPTED') && expiryPolled !== matchId) {
      expiryPolled = matchId;
      poll();
    }
  }
  const ticker = setInterval(tick, 250);

  const ENDED_TEXT = {
    TIMEOUT: () => tr('You did not accept in time, so you left the queue.', 'Bạn chưa xác nhận kịp nên đã rời hàng chờ.'),
    DECLINED_BY_YOU: () => tr('You declined this match.', 'Bạn đã từ chối trận này.'),
    STALE: () => tr('Your search expired. Start again when you are ready.', 'Phiên tìm trận đã hết hạn. Hãy tìm lại khi sẵn sàng.'),
  };
  const REQUEUE_TEXT = {
    DECLINED_BY_PARTNER: () => tr('Your partner declined — searching for someone else.', 'Đồng đội đã từ chối — đang tìm người khác cho bạn.'),
    PARTNER_TIMEOUT: () => tr('Your partner did not confirm in time — searching again.', 'Đồng đội không xác nhận kịp — đang tìm người khác.'),
    ROOM_FAILED: () => tr('That case could not be opened — searching again.', 'Không mở được vụ án đó — đang tìm lại.'),
  };

  /** Applies one server status. Older snapshots (a slow poll overtaken by a push) are ignored. */
  function applyStatus(status, { initial = false } = {}) {
    if (disposed || !status) return;
    const serverTime = Date.parse(status.serverTime || '');
    if (Number.isFinite(serverTime)) {
      if (serverTime < state.lastServerTime) return;
      state.lastServerTime = serverTime;
      state.offsetMs = serverTime - Date.now();
    }
    const previous = state.phase;
    let next = status.phase;
    if (next === 'ENDED' || next === 'IDLE' || !next) next = 'IDLE';
    if (next === 'READY' && (initial || previous === 'IDLE')) {
      // A room matched earlier: offer it, but do not jump there on arrival.
      state.notice = status.roomId
        ? { tone: 'info', text: tr('Your last match already has a lobby.', 'Trận vừa ghép đã có phòng chờ.'), roomId: status.roomId }
        : null;
      next = 'IDLE';
    } else if (!initial) {
      if (next === 'SEARCHING' && (previous === 'FOUND' || previous === 'ACCEPTED')) {
        const text = REQUEUE_TEXT[status.endReason]?.() ?? tr('The match fell through — searching again.', 'Trận ghép bị hủy — đang tìm lại.');
        state.notice = { tone: 'warn', text };
        toast(text, 'info');
      } else if (status.phase === 'ENDED' && LIVE_PHASES.has(previous)) {
        const text = ENDED_TEXT[status.endReason]?.();
        state.notice = text ? { tone: 'warn', text } : null;
      } else if (next === 'FOUND' && previous !== 'FOUND') {
        state.notice = null;
      }
    }
    if (next !== 'IDLE' && status.mode) {
      // Resumed or pushed state shows the settings the ticket was queued with.
      state.prefs = {
        mode: status.mode, preferredRole: status.preferredRole, caseLength: status.caseLength, language: status.language,
      };
    }
    state.status = status;
    state.phase = next;
    paint();
    if (next === 'READY' && status.roomId && previous !== 'READY') {
      clearTimeout(redirectTimer);
      redirectTimer = setTimeout(() => {
        if (!disposed && app.isConnected) navigate(`/lobby/${status.roomId}`);
      }, REDIRECT_DELAY_MS);
    }
    schedulePoll();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (disposed) return;
    const delay = state.phase === 'SEARCHING' ? POLL_SEARCHING_MS
      : state.phase === 'FOUND' || state.phase === 'ACCEPTED' ? POLL_FOUND_MS
        : 0;
    if (delay) pollTimer = setTimeout(poll, delay);
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (disposed) return;
    try {
      applyStatus(await matchmakingApi.status());
    } catch {
      // Keep the current view; the next poll retries.
      schedulePoll();
    }
  }

  function errorNotice(err) {
    const code = err?.errors?.code;
    if (code === 'MATCH_NO_CASES') {
      return tr('No published case fits this length and language yet. Try another setting.',
        'Chưa có vụ án nào phù hợp với độ dài và ngôn ngữ này. Hãy đổi thiết lập.');
    }
    if (code === 'MATCH_CLOSED') return tr('This match is no longer available.', 'Trận này không còn hiệu lực.');
    if (code === 'MATCH_CONFIRMED') return tr('Both players already accepted this match.', 'Cả hai đã chấp nhận trận này.');
    if (err?.status === 403) return err.message;
    return err?.message || tr('Something went wrong. Please try again.', 'Có lỗi xảy ra. Vui lòng thử lại.');
  }

  async function run(action, { refetchOnConflict = true } = {}) {
    if (state.busy) return;
    state.busy = true;
    paint();
    try {
      const status = await action();
      state.busy = false;
      applyStatus(status);
    } catch (err) {
      state.busy = false;
      if (disposed) return;
      state.notice = { tone: 'error', text: errorNotice(err) };
      paint();
      if (refetchOnConflict && err?.status === 409) await poll();
    }
  }

  function start() {
    savePrefs(state.prefs);
    state.notice = null;
    return run(() => matchmakingApi.enqueue(state.prefs));
  }
  const cancel = () => run(() => matchmakingApi.cancel());
  const accept = () => {
    const matchId = state.status?.match?.matchId;
    return matchId ? run(() => matchmakingApi.accept(matchId)) : undefined;
  };
  const decline = () => {
    const matchId = state.status?.match?.matchId;
    return matchId ? run(() => matchmakingApi.decline(matchId)) : undefined;
  };

  app.querySelectorAll('[data-fg-group]').forEach((button) =>
    button.addEventListener('click', () => {
      if (locked()) return;
      state.prefs = { ...state.prefs, [button.dataset.fgGroup]: button.dataset.fgValue };
      savePrefs(state.prefs);
      paintOptions();
    }));

  const hub = createUserHubConnection({ MatchmakingUpdated: (status) => applyStatus(status) });

  paint();
  try {
    applyStatus(await matchmakingApi.status(), { initial: true });
  } catch (err) {
    state.notice = { tone: 'error', text: errorNotice(err) };
    paint();
  }
  if (signal?.aborted || disposed) {
    await hub.stop();
    return () => {};
  }
  void hub.start();

  return async () => {
    disposed = true;
    clearInterval(ticker);
    clearTimeout(pollTimer);
    clearTimeout(redirectTimer);
    await hub.stop();
    // Leaving mid-search frees the partner instead of leaving them a match that will time out.
    // Re-rendering the same route (a UI language switch) keeps the search going.
    const stillHere = window.location.pathname === '/find-game';
    if (LIVE_PHASES.has(state.phase) && !stillHere) {
      try { await matchmakingApi.cancel(); } catch { /* best effort */ }
    }
  };
}
