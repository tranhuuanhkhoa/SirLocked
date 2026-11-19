import '../../../css/30-bpa-rooms.css';
import '../../../css/36-bpa-public-rooms.css';
import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { bindJoinForm, joinCardHtml } from './joinRoomPage.js';
import {
  VISIBILITY, bindVisibilityToggle, caseSelectHtml, createRoomAndOpen, visibilityNoteHtml, visibilityStampHtml, visibilityToggleHtml,
} from './roomCreateCard.js';
import { navigate } from '../services/navigation.js';

/**
 * /rooms — "Phòng điều tra" (Rooms.dc.html): the public room table with language / free-seat
 * filters and search, the create card (public or private) and the join-by-code card. VÀO joins
 * through the same POST /api/rooms/join as a typed code.
 */
const REFRESH_MS = 10_000;
const SEARCH_DEBOUNCE_MS = 300;
const FILTER_KEY = 'sirlocked.publicRoomFilters';

const ICON_SEARCH = `
  <svg class="bpa-prooms-searchicon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6"></circle><path d="M15 15l5.5 5.5"></path></svg>`;
const ICON_CHECK = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12l5 5L20 7"></path></svg>`;
const ICON_LOCK = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="10.5" width="14" height="10" rx="1.5"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path></svg>`;
const ICON_SPIN = `
  <svg class="bpa-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6"></circle><path d="M15 15l5.5 5.5"></path></svg>`;
const ICON_INFO = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5.5"></path><path d="M12 7.6v.01"></path></svg>`;
const ICON_REFRESH = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 5v6h-6"></path></svg>`;

function loadFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
    return {
      language: ['vi', 'en'].includes(saved?.language) ? saved.language : '',
      openOnly: saved?.openOnly === true,
    };
  } catch {
    return { language: '', openOnly: false };
  }
}

function saveFilters({ language, openOnly }) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify({ language, openOnly })); } catch { /* per-viewer convenience only */ }
}

const minutes = (row) => `${row.estimatedMinutes} ${row.language === 'en' ? 'min' : 'phút'}`;

function statusTag(row) {
  if (row.status === 'IN_PROGRESS') return `<span class="bpa-prooms-tag is-play">${tr('Playing', 'Đang chơi')}</span>`;
  return `<span class="bpa-prooms-tag is-wait">${tr('Waiting', 'Đang chờ')}</span>`;
}

function actionButton(row) {
  if (row.isMember) {
    return `<button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-join-code="${escapeHtml(row.roomCode)}">${tr('Open', 'Mở')}<span class="bpa-sr"> ${escapeHtml(row.roomCode)}</span></button>`;
  }
  if (!row.isJoinable) {
    return `<button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" disabled>${tr('Full', 'Đầy')}<span class="bpa-sr"> ${escapeHtml(row.roomCode)}</span></button>`;
  }
  return `<button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-join-code="${escapeHtml(row.roomCode)}">${tr('Join', 'Vào')}<span class="bpa-sr"> ${escapeHtml(row.roomCode)}</span></button>`;
}

function rowsHtml(rows) {
  return rows.map((row) => `
    <tr data-room-code="${escapeHtml(row.roomCode)}">
      <td class="bpa-prooms-code">${escapeHtml(row.roomCode)}</td>
      <td class="bpa-prooms-case">
        <strong>${escapeHtml(row.caseTitle)}</strong>
        <span>${escapeHtml(minutes(row))}<span class="bpa-prooms-sm"> · ${escapeHtml(row.language.toUpperCase())} · ${escapeHtml(row.hostUsername)}</span></span>
      </td>
      <td class="bpa-prooms-lg">${escapeHtml(row.hostUsername)}</td>
      <td class="bpa-prooms-num">${escapeHtml(row.playerCount)}/${escapeHtml(row.maxPlayers)}</td>
      <td class="bpa-prooms-lg">${escapeHtml(row.language.toUpperCase())}</td>
      <td>${statusTag(row)}</td>
      <td class="bpa-prooms-act">${actionButton(row)}</td>
    </tr>`).join('');
}

export async function renderRoomsPage(app, context = {}) {
  const signal = context.signal;
  const filters = { ...loadFilters(), q: '' };
  let rows = [];
  let loadError = '';
  let loading = true;
  let requestSeq = 0;
  let refreshTimer = 0;
  let searchTimer = 0;
  let joining = '';
  let visibility = VISIBILITY.PRIVATE;
  let cases = [];
  let casesError = '';
  let casesLoading = true;
  let selectedCaseId = null;

  const segPressed = (value) => String(filters.language === value);

  const createCard = () => {
    if (casesLoading) {
      return `
      <section class="bpa-paper bpa-paper--kraft bpa-rooms-card bpa-rooms-create" aria-labelledby="rooms-create-h">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <p class="bpa-kicker bpa-rooms-kick">${tr('Open a new file', 'Mở hồ sơ mới')}</p>
        <h2 id="rooms-create-h" class="bpa-rooms-h2">${tr('Create a room', 'Tạo phòng')}</h2>
        <p class="bpa-rooms-state" role="status">${ICON_SPIN}<span>${tr('Loading published cases...', 'Đang tải các vụ án...')}</span></p>
      </section>`;
    }
    if (casesError) {
      return `
      <section class="bpa-paper bpa-paper--kraft bpa-rooms-card bpa-rooms-create" aria-labelledby="rooms-create-h">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <p class="bpa-kicker bpa-rooms-kick">${tr('Open a new file', 'Mở hồ sơ mới')}</p>
        <h2 id="rooms-create-h" class="bpa-rooms-h2">${tr('Create a room', 'Tạo phòng')}</h2>
        <p class="bpa-rooms-state is-error" role="alert">${ICON_INFO}<span>${escapeHtml(casesError)}</span></p>
      </section>`;
    }
    return `
      <section class="bpa-paper bpa-paper--kraft bpa-rooms-card bpa-rooms-create" aria-labelledby="rooms-create-h">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        ${visibilityStampHtml(visibility)}
        <p class="bpa-kicker bpa-rooms-kick">${tr('Open a new file', 'Mở hồ sơ mới')}</p>
        <h2 id="rooms-create-h" class="bpa-rooms-h2">${tr('Create a room', 'Tạo phòng')}</h2>
        ${visibilityToggleHtml(visibility)}
        ${cases.length
          ? caseSelectHtml(cases, selectedCaseId)
          : `<p class="bpa-rooms-note">${tr('No published cases are available yet.', 'Chưa có vụ án được xuất bản.')}</p>`}
        <div id="room-visibility-note">${visibilityNoteHtml(visibility)}</div>
        <button type="button" class="bpa-btn bpa-btn--red bpa-btn--block bpa-rooms-createbtn" id="create-room-submit" ${cases.length ? '' : 'disabled'}>${tr('Create room', 'Tạo phòng')}</button>
      </section>`;
  };

  render(app, `
  <div class="bpa-container bpa-rooms-page bpa-prooms-page">
    <div class="bpa-rooms-top">
      <div class="bpa-label bpa-rooms-label">
        <p class="bpa-kicker">${tr('File 04 · Rooms', 'Hồ sơ 04 · Phòng')}</p>
        <h1 class="bpa-rooms-h1">${tr('Investigation Rooms', 'Phòng điều tra')}</h1>
      </div>
      <p class="bpa-rooms-lead">${tr(
        'Join a public room that is waiting for a partner, or open your own — public for everyone, or private for friends with the invite code.',
        'Vào một phòng công khai đang chờ người, hoặc tự mở phòng — công khai cho mọi người, hay riêng tư chỉ dành cho bạn bè có mã mời.',
      )}</p>
    </div>

    <div id="prooms-joining" aria-live="polite"></div>

    <div class="bpa-rooms-cols">
      <section class="bpa-paper bpa-paper--ledger bpa-rooms-ledger bpa-prooms-ledger" aria-labelledby="prooms-h">
        <span class="bpa-pin" aria-hidden="true"></span>
        <div class="bpa-prooms-head">
          <div>
            <h2 id="prooms-h" class="bpa-rooms-h2">${tr('Public rooms', 'Phòng công khai')}</h2>
            <p class="bpa-kicker bpa-rooms-count" id="prooms-count" aria-live="polite">&nbsp;</p>
          </div>
          <div class="bpa-prooms-filters">
            <div class="bpa-prooms-segs" role="group" aria-label="${tr('Case language', 'Ngôn ngữ vụ án')}">
              <button type="button" class="bpa-seg" data-lang="" aria-pressed="${segPressed('')}">${tr('All', 'Tất cả')}</button>
              <button type="button" class="bpa-seg" data-lang="vi" aria-pressed="${segPressed('vi')}">VI</button>
              <button type="button" class="bpa-seg" data-lang="en" aria-pressed="${segPressed('en')}">EN</button>
            </div>
            <button type="button" class="bpa-seg" id="prooms-open" aria-pressed="${filters.openOnly}">${ICON_CHECK}${tr('Seats free', 'Còn chỗ')}</button>
            <button type="button" class="bpa-seg" id="prooms-refresh" aria-label="${tr('Refresh the list', 'Làm mới danh sách')}" title="${tr('Refresh', 'Làm mới')}">${ICON_REFRESH}</button>
          </div>
        </div>
        <div class="bpa-prooms-search">
          ${ICON_SEARCH}
          <label for="prooms-find" class="bpa-sr">${tr('Search rooms', 'Tìm phòng')}</label>
          <input id="prooms-find" class="bpa-prooms-searchinput" type="search" maxlength="64" autocomplete="off"
                 placeholder="${tr('Search by room code, case or host…', 'Tìm theo mã phòng, vụ án hoặc chủ phòng…')}">
        </div>
        <div id="prooms-body" class="bpa-prooms-body"></div>
        <p class="bpa-rooms-foot">${ICON_LOCK}<span>${tr(
          'Private rooms are never listed — they can only be joined with the invite code.',
          'Phòng riêng tư không hiện trong danh sách — chỉ vào được bằng mã mời.',
        )}</span></p>
      </section>

      <div class="bpa-rooms-side">
        <div id="prooms-create">${createCard()}</div>
        ${joinCardHtml()}
      </div>
    </div>
  </div>`);
  bindJoinForm(app);

  // The background refresh repaints only when the list changed, so a VÀO press is never lost.
  let bodyKey = '';
  function paintBody() {
    const body = app.querySelector('#prooms-body');
    const count = app.querySelector('#prooms-count');
    if (!body || !count) return;
    const key = JSON.stringify([loading && !rows.length && !loadError, loadError, rows, filters.q, filters.language, filters.openOnly]);
    if (key === bodyKey) return;
    bodyKey = key;
    if (loading && !rows.length && !loadError) {
      body.innerHTML = `<p class="bpa-rooms-state" role="status">${ICON_SPIN}<span>${tr('Looking for open rooms…', 'Đang tìm các phòng đang mở…')}</span></p>`;
      return;
    }
    if (loadError) {
      count.textContent = ' ';
      body.innerHTML = `<p class="bpa-rooms-state is-error" role="alert">${ICON_INFO}<span>${escapeHtml(loadError)}</span>
        <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm" data-retry>${tr('Try again', 'Thử lại')}</button></p>`;
      body.querySelector('[data-retry]')?.addEventListener('click', () => load());
      return;
    }
    const open = rows.filter((row) => row.isJoinable).length;
    count.textContent = tr(`${rows.length} ${rows.length === 1 ? 'room' : 'rooms'} · ${open} with a free seat`, `${rows.length} phòng · ${open} còn chỗ`);
    if (!rows.length) {
      const filtered = filters.q || filters.language || filters.openOnly;
      body.innerHTML = `<p class="bpa-rooms-state" role="status">${ICON_INFO}<span>${filtered
        ? tr('No public room matches these filters.', 'Không có phòng công khai nào khớp bộ lọc.')
        : tr('No public rooms are open right now — open one and it shows up here.', 'Chưa có phòng công khai nào — hãy mở một phòng, nó sẽ hiện ở đây.')}</span></p>`;
      return;
    }
    body.innerHTML = `
      <div class="bpa-prooms-tablewrap">
        <table class="bpa-table bpa-prooms-table">
          <caption class="bpa-sr">${tr('Public rooms', 'Phòng công khai')}</caption>
          <thead>
            <tr>
              <th scope="col">${tr('Room code', 'Mã phòng')}</th>
              <th scope="col">${tr('Case', 'Vụ án')}</th>
              <th scope="col" class="bpa-prooms-lg">${tr('Host', 'Chủ phòng')}</th>
              <th scope="col">${tr('Players', 'Người')}</th>
              <th scope="col" class="bpa-prooms-lg">${tr('Language', 'Ngôn ngữ')}</th>
              <th scope="col">${tr('Status', 'Trạng thái')}</th>
              <th scope="col"><span class="bpa-sr">${tr('Action', 'Hành động')}</span></th>
            </tr>
          </thead>
          <tbody>${rowsHtml(rows)}</tbody>
        </table>
      </div>`;
    body.querySelectorAll('[data-join-code]').forEach((button) =>
      button.addEventListener('click', () => join(button.dataset.joinCode, button)));
  }

  function paintJoining() {
    const bar = app.querySelector('#prooms-joining');
    if (!bar) return;
    bar.innerHTML = joining
      ? `<div class="bpa-panel bpa-prooms-joinbar" role="status">${ICON_SPIN}<span>${escapeHtml(tr(`Joining room ${joining}…`, `Đang vào phòng ${joining}…`))}</span></div>`
      : '';
  }

  async function load({ quiet = false } = {}) {
    const seq = ++requestSeq;
    if (!quiet) { loading = true; paintBody(); }
    try {
      const result = await roomApi.publicRooms(filters);
      if (seq !== requestSeq || signal?.aborted || !app.isConnected) return;
      rows = Array.isArray(result) ? result : [];
      loadError = '';
    } catch (err) {
      if (seq !== requestSeq || signal?.aborted || !app.isConnected) return;
      // A failed background refresh keeps the rows already on screen.
      if (!quiet || !rows.length) loadError = err.message || tr('The room list could not be loaded.', 'Không tải được danh sách phòng.');
    } finally {
      if (seq === requestSeq) loading = false;
    }
    paintBody();
  }

  async function join(code, button) {
    if (joining) return;
    joining = code;
    paintJoining();
    if (button) button.disabled = true;
    try {
      const room = await roomApi.join(code);
      if (signal?.aborted || !app.isConnected) return;
      toast(tr(`Joined room ${room.roomCode}.`, `Đã vào phòng ${room.roomCode}.`), 'success');
      navigate(room.status === 'IN_PROGRESS' ? `/game/${room.roomId}` : `/lobby/${room.roomId}`);
    } catch (err) {
      if (signal?.aborted || !app.isConnected) return;
      toast(err.message, 'error');
      joining = '';
      paintJoining();
      if (button?.isConnected) button.disabled = false;
      load({ quiet: true });
    }
  }

  app.querySelectorAll('[data-lang]').forEach((button) =>
    button.addEventListener('click', () => {
      filters.language = button.dataset.lang;
      app.querySelectorAll('[data-lang]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      saveFilters(filters);
      load();
    }));
  app.querySelector('#prooms-open')?.addEventListener('click', (event) => {
    filters.openOnly = !filters.openOnly;
    event.currentTarget.setAttribute('aria-pressed', String(filters.openOnly));
    saveFilters(filters);
    load();
  });
  app.querySelector('#prooms-refresh')?.addEventListener('click', () => load());
  app.querySelector('#prooms-find')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.q = event.target.value.trim().slice(0, 64);
      load();
    }, SEARCH_DEBOUNCE_MS);
  });

  function bindCreate() {
    const card = app.querySelector('#prooms-create .bpa-rooms-create');
    if (!card) return;
    bindVisibilityToggle(card, { initial: visibility, onChange: (value) => { visibility = value; } });
    card.querySelector('#room-case-select')?.addEventListener('change', (event) => { selectedCaseId = event.target.value; });
    card.querySelector('#create-room-submit')?.addEventListener('click', (event) =>
      createRoomAndOpen(event.currentTarget, selectedCaseId, visibility, app));
  }

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (signal?.aborted || !app.isConnected) return;
      if (document.visibilityState === 'visible' && !joining) await load({ quiet: true });
      scheduleRefresh();
    }, REFRESH_MS);
  };

  paintBody();
  await Promise.all([
    load(),
    caseApi.published().then((list) => {
      cases = Array.isArray(list) ? list : [];
      selectedCaseId = cases[0]?.caseId ?? null;
    }).catch((err) => { casesError = err.message; }).finally(() => { casesLoading = false; }),
  ]);
  if (signal?.aborted || !app.isConnected) return () => {};
  const createSlot = app.querySelector('#prooms-create');
  if (createSlot) createSlot.innerHTML = createCard();
  bindCreate();
  scheduleRefresh();

  return () => {
    clearTimeout(refreshTimer);
    clearTimeout(searchTimer);
  };
}
