import '../../../css/32-bpa-cases.css';
import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { plural, tr } from '../services/i18n.js';
import { activeRoomDestination, inviteDestination, normalizeRoomCode } from '../services/roomInvites.js';
import { session } from '../services/session.js';
import {
  caseDossierMarkup, coverArt, countOf, fileNumber, icons, peopleMarkup, sealedPeopleMarkup,
} from './caseDetailPage.js';

const ROLE_LABELS = {
  INVESTIGATOR: () => tr('Investigator', 'Điều tra viên'),
  INTERROGATOR: () => tr('Interrogator', 'Thẩm vấn viên'),
};

const PAPERCLIP = '<svg class="bpa-cases-clip" width="12" height="34" viewBox="0 0 12 34" aria-hidden="true" focusable="false"><path d="M8.5 9V26.5a3.5 3.5 0 0 1-7 0V6a2.75 2.75 0 0 1 5.5 0V24a1.25 1.25 0 0 1-2.5 0V9" fill="none" stroke="#d3dade" stroke-width="1.4" stroke-linecap="round"/></svg>';

const EMPTY_FOLDER = `<svg class="bpa-cases-empty-art" width="60" height="60" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path d="M8 18h16l4 5h28v29H8z" fill="rgba(239,212,134,.04)" stroke="#c7a24b" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M8 29h48" stroke="rgba(199,162,75,.55)" stroke-width="1.4" stroke-dasharray="3 3"/>
  <path d="M46.5 46.5L55 55" stroke="#3b2716" stroke-width="6" stroke-linecap="round"/>
  <path d="M46.5 46.5L55 55" stroke="#8a5a34" stroke-width="3" stroke-linecap="round"/>
  <circle cx="40" cy="40" r="9" fill="rgba(190,225,235,.12)" stroke="#efd486" stroke-width="2.6"/>
</svg>`;

/** One "continue" row. The whole row is the link, so the hit target is the full strip. */
function roomRow(room, userId) {
  const playing = room.status === 'IN_PROGRESS';
  const players = Array.isArray(room.players) ? room.players : [];
  const count = room.players?.length ?? 0;
  const me = players.find((p) => p.userId === userId);
  const myRole = me?.role && ROLE_LABELS[me.role] ? ROLE_LABELS[me.role]() : '';
  const note = playing
    ? (myRole ? tr(`Your role: ${myRole}`, `Vai của bạn: ${myRole}`) : '')
    : (count < 2
      ? tr('Waiting for your partner to join', 'Đang chờ đồng đội vào phòng')
      : tr('Both detectives are in the lobby', 'Cả hai thám tử đã ở phòng chờ'));
  const seats = [0, 1].map((i) => (players[i]
    ? `<span class="bpa-cases-seat">${escapeHtml(initials(players[i].username))}</span>`
    : '<span class="bpa-cases-seat is-empty"></span>')).join('');
  const names = players.map((p) => p.username).filter(Boolean).join(', ');
  return `
    <li>
      <a class="bpa-cases-run" data-resume-room="${escapeHtml(room.roomId)}" href="${escapeHtml(activeRoomDestination(room))}">
        <span class="bpa-cases-rcode"><span class="bpa-cases-codek">${tr('Room code', 'Mã phòng')}</span><span class="bpa-cases-codev">${escapeHtml(room.roomCode)}</span></span>
        <span class="bpa-cases-rcase">
          <span class="bpa-cases-rtitle">${escapeHtml(room.caseTitle)}</span>
          <span class="bpa-cases-rsub">
            <span class="bpa-cases-tag ${playing ? 'is-play' : 'is-wait'}">${playing ? '<span class="bpa-cases-live" aria-hidden="true"></span>' : ''}${playing ? tr('In progress', 'Đang điều tra') : tr('Lobby', 'Phòng chờ')}</span>
            ${note ? `<span>${escapeHtml(note)}</span>` : ''}
          </span>
        </span>
        <span class="bpa-cases-who">
          <span class="bpa-cases-seats" aria-hidden="true">${seats}</span>
          <span class="bpa-cases-n">${count}/2${names ? `<span class="bpa-sr"> ${tr('detectives', 'thám tử')}: ${escapeHtml(names)}</span>` : ''}</span>
        </span>
        <span class="bpa-btn ${playing ? 'bpa-btn--red' : 'bpa-btn--gold'} bpa-cases-rgo">${playing ? tr('Resume', 'Tiếp tục') : tr('Return to lobby', 'Về phòng chờ')}${playing ? icons.arrow() : ''}</span>
      </a>
    </li>`;
}

function roomNotice(text, stamp) {
  return `
    <div class="bpa-cases-empty">
      ${EMPTY_FOLDER}
      <p>${text}</p>
      ${stamp ? `<span class="bpa-cases-estampbox" aria-hidden="true"><span class="bpa-cases-estamp">${stamp}</span></span>` : ''}
    </div>`;
}

/** One folder in the drawer. */
function fileMarkup(c, index) {
  const title = escapeHtml(c.title);
  const minutes = countOf(c.estimatedMinutes);
  const facts = [
    [countOf(c.sceneCount), (n) => tr(plural(n, 'scene', 'scenes'), 'hiện trường')],
    [countOf(c.characterCount), (n) => tr(plural(n, 'suspect', 'suspects'), 'nghi phạm')],
    [countOf(c.clueCount), (n) => tr(plural(n, 'clue', 'clues'), 'manh mối')],
  ].filter(([n]) => n !== null).map(([n, label]) => `<span>${n} ${label(n)}</span>`);
  if (minutes !== null) facts.unshift(`<b>${minutes} ${tr('min', 'phút')}</b>`);
  return `
    <li class="bpa-cases-file" data-case="${escapeHtml(c.caseId)}" data-index="${index}">
      <span class="bpa-cases-tab" aria-hidden="true"><span class="bpa-cases-tabdot"></span>${fileNumber(index)}</span>
      <article class="bpa-cases-fbody" aria-labelledby="bpa-cases-t${index}">
        <span class="bpa-cases-thumb" aria-hidden="true">${coverArt(c, 'bpa-cases-thumb-img')}${PAPERCLIP}</span>
        <div class="bpa-cases-fmain">
          <h4 id="bpa-cases-t${index}" class="bpa-cases-ftitle">${title}</h4>
          ${c.summary ? `<p class="bpa-cases-fsum">${escapeHtml(c.summary)}</p>` : ''}
          ${facts.length ? `<p class="bpa-cases-fstats">${facts.join(' · ')}</p>` : ''}
        </div>
        <div class="bpa-cases-facts">
          <a class="bpa-btn bpa-btn--ink bpa-btn--sm bpa-cases-pick" href="#/cases/${encodeURIComponent(c.caseId)}" data-pick="${index}" aria-controls="bpa-cases-cover">${icons.eye()}${tr('Details', 'Chi tiết')}<span class="bpa-sr">: ${title}</span></a>
          <button type="button" class="bpa-btn bpa-btn--red bpa-btn--sm" data-create="${escapeHtml(c.caseId)}">${icons.plus()}${tr('Create room', 'Tạo phòng')}<span class="bpa-sr">: ${title}</span></button>
        </div>
      </article>
    </li>`;
}

export async function renderCasesPage(app) {
  render(app, `
    <div class="bpa-container bpa-cases-page">
      <div class="bpa-cases-intro">
        <div class="page-head bpa-label bpa-cases-head">
          <p class="bpa-kicker">${tr('Case library', 'Thư viện hồ sơ')}<span data-cases-total></span></p>
          <h2>${tr('Published Cases', 'Vụ án đã xuất bản')}</h2>
        </div>
        <p class="bpa-cases-lede">${tr('Pick a case file, open a room and invite your partner — or return to a game in progress.', 'Chọn một hồ sơ, mở phòng và mời đồng đội — hoặc quay lại ván đang dang dở.')}</p>
      </div>

      <div class="bpa-cases-top">
        <section class="bpa-cases-resume" aria-labelledby="active-rooms-heading">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <p class="bpa-kicker bpa-cases-kick is-gold">${tr('Games in progress', 'Ván dang dở')}<span data-rooms-total></span></p>
          <h3 class="bpa-cases-h is-light" id="active-rooms-heading">${tr('Continue a game', 'Tiếp tục ván đang chơi')}</h3>
          <div id="active-rooms-list" class="bpa-cases-swap" aria-live="polite">
            <p class="bpa-cases-wait"><span class="bpa-cases-spinner bpa-spin" aria-hidden="true"></span>${tr('Loading your rooms…', 'Đang tải phòng của bạn…')}</p>
          </div>
        </section>

        <section class="bpa-cases-join bpa-paper bpa-paper--ledger" aria-labelledby="bpa-cases-join-h">
          <span class="bpa-pin" aria-hidden="true"></span>
          <p class="bpa-kicker bpa-cases-kick">${tr('Invite code · join your partner', 'Mã mời · vào cùng đồng đội')}</p>
          <h3 class="bpa-cases-h" id="bpa-cases-join-h">${tr('Have a room code?', 'Đã có mã phòng?')}</h3>
          <p class="bpa-cases-joinp">${tr('Enter the 6-character code your partner sent you.', 'Nhập mã 6 ký tự đồng đội gửi cho bạn.')}</p>
          <form class="bpa-cases-codeform" novalidate>
            <div class="bpa-cases-codehead">
              <label for="bpa-cases-code" class="bpa-field-label">${tr('Room code', 'Mã phòng')}</label>
              <span class="bpa-cases-count" aria-hidden="true"><span data-code-count>0</span>/6</span>
            </div>
            <div class="bpa-cases-coderow">
              <input id="bpa-cases-code" class="bpa-code bpa-cases-code" type="text" maxlength="6" placeholder="ABC123"
                     autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="bpa-cases-code-hint">
              <a class="bpa-btn bpa-btn--red bpa-cases-go" href="#/join">${tr('Join', 'Vào')}</a>
            </div>
            <p id="bpa-cases-code-hint" class="bpa-cases-hint">${tr('6 characters: letters A–Z and digits 0–9.', 'Gồm 6 ký tự: chữ A–Z và số 0–9.')}</p>
          </form>
        </section>
      </div>

      <div class="bpa-cases-main">
        <section id="bpa-cases-list" class="bpa-cases-drawer" aria-labelledby="bpa-cases-list-h">
          <div class="bpa-cases-dhead">
            <div>
              <p class="bpa-kicker bpa-cases-kick is-gold">${tr('Archive drawer', 'Ngăn lưu trữ')}<span data-files-total></span></p>
              <h3 id="bpa-cases-list-h" class="bpa-cases-h is-light">${tr('All cases', 'Tất cả vụ án')}</h3>
            </div>
            <span class="bpa-cases-plate" aria-hidden="true" hidden><span data-plate></span></span>
          </div>
          <div id="published-cases-list" class="bpa-cases-drawer-body">
            <p class="bpa-cases-wait"><span class="bpa-cases-spinner bpa-spin" aria-hidden="true"></span>${tr('Loading published cases…', 'Đang tải các vụ án…')}</p>
          </div>
        </section>
      </div>
      <p class="bpa-sr" role="status" data-cases-live></p>
    </div>`);

  const caseList = app.querySelector('#published-cases-list');
  const roomList = app.querySelector('#active-rooms-list');
  const main = app.querySelector('.bpa-cases-main');
  const live = app.querySelector('[data-cases-live]');
  const joinCard = app.querySelector('.bpa-cases-join');
  const codeInput = app.querySelector('#bpa-cases-code');
  const codeGo = app.querySelector('.bpa-cases-go');
  const codeHint = app.querySelector('#bpa-cases-code-hint');
  const codeCount = app.querySelector('[data-code-count]');
  const hintText = codeHint.textContent;

  /* ---- join by code: the link carries the code to the join page ---- */
  const syncCode = () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    codeCount.textContent = String(codeInput.value.length);
    codeGo.setAttribute('href', inviteDestination(codeInput.value) || '#/join');
    if (codeInput.getAttribute('aria-invalid') === 'true') {
      codeInput.removeAttribute('aria-invalid');
      codeHint.textContent = hintText;
      codeHint.classList.remove('is-error');
    }
  };
  const followCode = (event) => {
    const code = codeInput.value;
    if (!code || normalizeRoomCode(code)) {
      if (event.type === 'submit') {
        event.preventDefault();
        window.location.hash = inviteDestination(code) || '#/join';
      }
      return;
    }
    event.preventDefault();
    codeInput.setAttribute('aria-invalid', 'true');
    codeHint.textContent = tr('The room code has 6 characters.', 'Mã phòng cần đủ 6 ký tự.');
    codeHint.classList.add('is-error');
    codeInput.focus();
  };
  codeInput.addEventListener('input', syncCode);
  codeGo.addEventListener('click', followCode);
  app.querySelector('.bpa-cases-codeform').addEventListener('submit', followCode);

  // A slow/unavailable room lookup must not prevent browsing published cases.
  const userId = session.user()?.userId;
  void roomApi.mine().then((response) => {
    const rooms = (Array.isArray(response) ? response : []).filter((room) => activeRoomDestination(room));
    const total = app.querySelector('[data-rooms-total]');
    if (total) total.textContent = ` · ${tr(`${rooms.length} ${plural(rooms.length, 'room', 'rooms')}`, `${rooms.length} phòng`)}`;
    roomList.classList.add('bpa-wipe-a');
    render(roomList, rooms.length
      ? `<ul class="bpa-cases-runs">${rooms.map((room) => roomRow(room, userId)).join('')}</ul>`
      : roomNotice(tr('No active rooms. Create a room or join your partner.', 'Chưa có ván đang chơi. Hãy tạo phòng hoặc vào cùng đồng đội.'), tr('Empty', 'Trống')));
  }).catch(() => {
    roomList.classList.add('bpa-wipe-a');
    render(roomList, roomNotice(tr('Your rooms could not be loaded. You can still join with a room code.', 'Chưa tải được phòng của bạn. Bạn vẫn có thể vào phòng bằng mã.'), ''));
  });

  let cases = [];
  try {
    cases = await caseApi.published();
  } catch (err) {
    render(caseList, `<div class="bpa-cases-drawer-note" role="alert">${escapeHtml(err.message)}</div>`);
    main.classList.add('is-bare');
    return;
  }
  cases = Array.isArray(cases) ? cases : [];

  const n = cases.length;
  const caseTotal = app.querySelector('[data-cases-total]');
  caseTotal.textContent = ` · ${tr(`${n} ${plural(n, 'case', 'cases')}`, `${n} vụ án`)}`;
  app.querySelector('[data-files-total]').textContent = ` · ${tr(`${n} ${plural(n, 'file', 'files')}`, `${n} hồ sơ`)}`;
  if (n) {
    const plate = app.querySelector('.bpa-cases-plate');
    plate.querySelector('[data-plate]').textContent = n === 1 ? fileNumber(0) : `${fileNumber(0)} — ${String(n).padStart(2, '0')}`;
    plate.hidden = false;
  }

  if (!n) {
    main.classList.add('is-bare');
    render(caseList, `<div class="bpa-cases-drawer-note">${tr('No cases are published yet. Ask an admin to publish a case.', 'Chưa có vụ án nào được xuất bản. Hãy yêu cầu quản trị viên xuất bản một vụ án.')}</div>`);
    return;
  }

  render(caseList, `<ol class="bpa-cases-files">${cases.map(fileMarkup).join('')}</ol>`);
  // A short drawer keeps its own height instead of stretching to the dossier.
  main.classList.toggle('is-short', n < 4);
  main.insertAdjacentHTML('beforeend', `
    <section id="bpa-cases-cover" class="bpa-cases-cover" aria-labelledby="bpa-cases-cover-title">
      <span class="bpa-cases-dtab" aria-hidden="true"><span class="bpa-cases-tabdot"></span><span data-cover-num></span></span>
      <span class="bpa-cases-under" aria-hidden="true"></span>
      <div class="bpa-cases-sheet bpa-paper">
        <span class="bpa-cases-margin" aria-hidden="true"></span>
        <div class="bpa-cases-dc" data-cover-body></div>
        <span class="bpa-cases-lens" aria-hidden="true"></span>
      </div>
    </section>
    <svg class="bpa-cases-thread bpa-cases-thr0" width="80" height="48" viewBox="0 0 80 48" aria-hidden="true" focusable="false">
      <defs><radialGradient id="bpa-cases-pinr" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#f3a291"/><stop offset=".45" stop-color="#c0392b"/><stop offset="1" stop-color="#6e1a12"/></radialGradient></defs>
      <path class="bpa-cases-ln" pathLength="1" d="M12 24Q41 39 70 24" transform="translate(2 5)" stroke="rgba(0,0,0,.45)" stroke-width="2.8"/>
      <path class="bpa-cases-ln" pathLength="1" d="M12 24Q41 39 70 24" stroke="#bf3b2c" stroke-width="2.1"/>
      <g class="bpa-cases-pn bpa-cases-pn1"><circle cx="13.5" cy="27.5" r="7.5" fill="rgba(0,0,0,.38)"/><circle cx="12" cy="24" r="7.5" fill="url(#bpa-cases-pinr)"/></g>
      <g class="bpa-cases-pn bpa-cases-pn2"><circle cx="71.5" cy="27.5" r="7.5" fill="rgba(0,0,0,.38)"/><circle cx="70" cy="24" r="7.5" fill="url(#bpa-cases-pinr)"/></g>
    </svg>`);

  const cover = main.querySelector('#bpa-cases-cover');
  const coverBody = cover.querySelector('[data-cover-body]');
  const coverNum = cover.querySelector('[data-cover-num]');
  const lens = cover.querySelector('.bpa-cases-lens');
  const thread = main.querySelector('.bpa-cases-thread');
  const files = [...caseList.querySelectorAll('.bpa-cases-file')];
  const wide = window.matchMedia('(min-width: 1240px)');
  const details = new Map();
  let selected = -1;
  let flip = null;

  const createRoom = async (button, caseId) => {
    button.disabled = true;
    try {
      const room = await roomApi.create(caseId);
      if (!app.isConnected) return;
      toast(tr(`Room ${room.roomCode} created.`, `Đã tạo phòng ${room.roomCode}.`), 'success');
      window.location.hash = `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  };

  // Layout offsets (not getBoundingClientRect) so the shell's page-transition zoom
  // and the folders' own tilt never skew the measurement.
  const topWithin = (el, ancestor) => {
    let top = 0;
    for (let node = el; node && node !== ancestor; node = node.offsetParent) top += node.offsetTop;
    return top;
  };
  // Places the red thread and the lens at the height of the open folder (desktop only).
  const placeThread = () => {
    const file = files[selected];
    if (!file || !wide.matches) {
      coverBody.style.setProperty('--oy', '0px');
      lens.style.top = '0px';
      return;
    }
    const sheet = lens.parentElement;
    const centre = topWithin(file, main) + file.offsetHeight / 2;
    const sheetTop = topWithin(sheet, main);
    thread.style.top = `${Math.round(centre - 24)}px`;
    lens.style.top = `${Math.round(centre - sheetTop)}px`;
    coverBody.style.setProperty('--oy', `${Math.round(centre - sheetTop - coverBody.offsetTop)}px`);
  };

  const people = (c) => {
    const known = details.get(c.caseId);
    if (known?.state === 'ready') return peopleMarkup(known.characters);
    return sealedPeopleMarkup(c.characterCount, known?.state === 'error' ? 'error' : 'loading');
  };

  const fillPeople = (index) => {
    const c = cases[index];
    const slot = coverBody.querySelector('[data-dossier-people]');
    if (!slot) return;
    const markup = people(c);
    slot.hidden = !markup;
    slot.querySelector('.bpa-cases-pslot').innerHTML = markup;
  };

  const loadPeople = (index) => {
    const c = cases[index];
    if (details.has(c.caseId) && details.get(c.caseId).state !== 'error') return;
    details.set(c.caseId, { state: 'loading' });
    caseApi.detail(c.caseId).then((detail) => {
      details.set(c.caseId, { state: 'ready', characters: Array.isArray(detail?.characters) ? detail.characters : [] });
    }).catch(() => {
      details.set(c.caseId, { state: 'error' });
    }).finally(() => {
      if (app.isConnected && selected === index) fillPeople(index);
    });
  };

  const pick = (index, { focus = false, animate = true } = {}) => {
    const c = cases[index];
    if (!c) return;
    if (index !== selected) {
      selected = index;
      files.forEach((file, i) => {
        const on = i === index;
        file.classList.toggle('is-open', on);
        const link = file.querySelector('[data-pick]');
        if (on) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      coverNum.textContent = tr(`File ${fileNumber(index)}`, `Hồ sơ ${fileNumber(index)}`);
      if (animate) flip = !flip;
      const ab = flip === null ? '' : (flip ? 'b' : 'a');
      coverBody.className = `bpa-cases-dc ${ab ? `bpa-cases-pop-${ab} bpa-cases-st-${ab}` : 'bpa-cases-st0'}`;
      lens.className = `bpa-cases-lens${ab ? ` bpa-cases-lens-${ab}` : ''}`;
      thread.setAttribute('class', `bpa-cases-thread ${ab ? `bpa-cases-thr-${ab}` : 'bpa-cases-thr0'}`);
      coverBody.innerHTML = caseDossierMarkup(c, {
        level: 3,
        titleId: 'bpa-cases-cover-title',
        number: fileNumber(index),
        people: people(c),
        actions: `
          <button type="button" class="bpa-btn bpa-btn--red" data-cover-create>${icons.plus(15)}${tr('Create room', 'Tạo phòng')}<span class="bpa-sr">: ${escapeHtml(c.title)}</span></button>
          <button type="button" class="bpa-btn bpa-btn--ink" data-cover-join aria-controls="bpa-cases-code">${icons.key()}${tr('Join with code', 'Vào bằng mã phòng')}</button>`,
      });
      placeThread();
      loadPeople(index);
      if (animate) live.textContent = tr(`Viewing case file: ${c.title}`, `Đang xem hồ sơ: ${c.title}`);
    }
    if (focus) {
      const title = coverBody.querySelector('#bpa-cases-cover-title');
      // Beside the drawer the dossier is already in view; below it (narrow screens) focus scrolls to it.
      title?.focus({ preventScroll: window.matchMedia('(min-width: 900px)').matches });
    }
  };

  app.querySelectorAll('[data-create]').forEach((button) =>
    button.addEventListener('click', () => createRoom(button, button.dataset.create)));

  caseList.addEventListener('click', (event) => {
    const link = event.target.closest('[data-pick]');
    if (link) {
      // Modified clicks keep the link's own behaviour (new tab / window) for the full page.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      pick(Number(link.dataset.pick), { focus: true });
      return;
    }
    if (event.target.closest('a, button')) return;
    const file = event.target.closest('.bpa-cases-file');
    if (file) pick(Number(file.dataset.index));
  });

  coverBody.addEventListener('click', (event) => {
    const c = cases[selected];
    if (!c) return;
    const create = event.target.closest('[data-cover-create]');
    if (create) {
      createRoom(create, c.caseId);
      return;
    }
    if (event.target.closest('[data-cover-join]')) {
      joinCard.classList.remove('bpa-cases-ping-a', 'bpa-cases-ping-b');
      void joinCard.offsetWidth;
      joinCard.classList.add(joinCard.dataset.ping === 'a' ? 'bpa-cases-ping-b' : 'bpa-cases-ping-a');
      joinCard.dataset.ping = joinCard.dataset.ping === 'a' ? 'b' : 'a';
      codeInput.focus();
      return;
    }
    const back = event.target.closest('[data-dossier-back]');
    if (back && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
      event.preventDefault();
      files[selected]?.querySelector('[data-pick]')?.focus();
    }
  });

  const onResize = () => { if (app.isConnected) placeThread(); };
  window.addEventListener('resize', onResize);
  wide.addEventListener?.('change', onResize);

  pick(0, { animate: false });

  return () => {
    window.removeEventListener('resize', onResize);
    wide.removeEventListener?.('change', onResize);
  };
}
