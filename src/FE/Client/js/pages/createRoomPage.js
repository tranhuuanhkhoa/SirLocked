import '../../../css/30-bpa-rooms.css';
import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { plural, tr } from '../services/i18n.js';
import { bindJoinForm, joinCardHtml } from './joinRoomPage.js';

const ICON_SPIN = `
  <svg class="bpa-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6"></circle><path d="M15 15l5.5 5.5"></path></svg>`;
const ICON_INFO = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
       stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5.5"></path><path d="M12 7.6v.01"></path></svg>`;
const ICON_CHECK = `
  <svg class="bpa-rooms-tick" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>`;

const minutesText = (c) => `${c.estimatedMinutes} ${tr('min', 'phút')}`;
const metaText = (c) => [
  minutesText(c),
  `${c.sceneCount} ${tr(plural(c.sceneCount, 'scene', 'scenes'), 'hiện trường')}`,
  `${c.characterCount} ${tr(plural(c.characterCount, 'suspect', 'suspects'), 'nghi phạm')}`,
  `${c.clueCount} ${tr(plural(c.clueCount, 'clue', 'clues'), 'manh mối')}`,
].map((part) => `<span class="bpa-rooms-nowrap">${escapeHtml(part)}</span>`).join(' · ');

function pageShell(ledgerHtml, sideHtml) {
  return `
  <div class="bpa-container bpa-rooms-page">
    <div class="bpa-rooms-top">
      <div class="bpa-label bpa-rooms-label">
        <p class="bpa-kicker">${tr('File 04 · Rooms', 'Hồ sơ 04 · Phòng')}</p>
        <h1 class="bpa-rooms-h1">${tr('Investigation Rooms', 'Phòng điều tra')}</h1>
      </div>
      <p class="bpa-rooms-lead">${tr('Choose a published case and open a two-player lobby — or enter the code your partner sent you.', 'Chọn một vụ án đã xuất bản để mở phòng chờ hai người, hoặc nhập mã mà đồng đội gửi cho bạn.')}</p>
    </div>
    <div class="bpa-rooms-cols">
      <section class="bpa-paper bpa-paper--ledger bpa-rooms-ledger" aria-labelledby="rooms-cases-h">
        <span class="bpa-pin" aria-hidden="true"></span>
        ${ledgerHtml}
      </section>
      <div class="bpa-rooms-side">
        ${sideHtml}
        ${joinCardHtml()}
      </div>
    </div>
  </div>`;
}

const ledgerHead = (countLine = '') => `
  <div class="bpa-rooms-ledhead">
    <h2 id="rooms-cases-h" class="bpa-rooms-h2">${tr('Published cases', 'Vụ án đã xuất bản')}</h2>
    ${countLine ? `<p class="bpa-kicker bpa-rooms-count">${countLine}</p>` : ''}
  </div>`;

export async function renderCreateRoomPage(app) {
  render(app, pageShell(`
    ${ledgerHead()}
    <p class="bpa-rooms-state" role="status">${ICON_SPIN}<span>${tr('Loading published cases...', 'Đang tải các vụ án...')}</span></p>`, ''));
  bindJoinForm(app);

  let cases = [];
  try {
    cases = await caseApi.published();
  } catch (err) {
    render(app, pageShell(`
      ${ledgerHead()}
      <p class="bpa-rooms-state is-error" role="alert">${ICON_INFO}<span>${escapeHtml(err.message)}</span></p>`, ''));
    bindJoinForm(app);
    return;
  }

  let selectedCaseId = cases[0]?.caseId ?? null;
  let flip = false;

  function selectedHtml() {
    const selected = cases.find((c) => c.caseId === selectedCaseId);
    if (!selected) return '';
    return `
      <span class="bpa-field-label">${tr('Selected case', 'Vụ án đã chọn')}</span>
      <div class="bpa-rooms-selcase">
        <figure class="bpa-rooms-thumb" style="${placeholderStyle(selected.caseId)}" aria-hidden="true">
          ${selected.coverImageUrl ? `<img src="${escapeHtml(selected.coverImageUrl)}" alt="" onerror="this.remove()">` : ''}
        </figure>
        <div class="bpa-rooms-selbody">
          <h3 class="bpa-rooms-h3">${escapeHtml(selected.title)}</h3>
          <p class="bpa-rooms-meta">${metaText(selected)}</p>
        </div>
      </div>
      ${selected.summary ? `<p class="bpa-rooms-sum">${escapeHtml(selected.summary)}</p>` : ''}
      <a class="bpa-link bpa-rooms-details" href="#/cases/${encodeURIComponent(selected.caseId)}">${tr('Case details', 'Chi tiết vụ án')}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>
      </a>`;
  }

  function rowsHtml() {
    return cases.map((c) => {
      const on = c.caseId === selectedCaseId;
      return `
      <tr class="bpa-rooms-row${on ? ' is-selected' : ''}" data-row-case="${escapeHtml(c.caseId)}">
        <th scope="row" class="bpa-rooms-cell-title">
          <span class="bpa-rooms-ctitle">${escapeHtml(c.title)}</span>
          <span class="bpa-rooms-csub"><span class="bpa-rooms-lg">${minutesText(c)}</span><span class="bpa-rooms-sm">${metaText(c)}</span></span>
        </th>
        <td class="bpa-rooms-num bpa-rooms-lg">${escapeHtml(c.sceneCount)}</td>
        <td class="bpa-rooms-num bpa-rooms-lg">${escapeHtml(c.characterCount)}</td>
        <td class="bpa-rooms-num bpa-rooms-lg">${escapeHtml(c.clueCount)}</td>
        <td class="bpa-rooms-act">
          <button type="button" class="bpa-btn bpa-btn--ink bpa-btn--sm bpa-rooms-pick" data-select-case="${escapeHtml(c.caseId)}" aria-pressed="${on}">
            ${ICON_CHECK}<span class="bpa-rooms-pick-on">${tr('Selected', 'Đã chọn')}</span><span class="bpa-rooms-pick-off">${tr('Select', 'Chọn')}</span><span class="bpa-sr"> — ${escapeHtml(c.title)}</span>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  const count = cases.length;
  const ledgerHtml = count === 0
    ? `${ledgerHead()}
       <p class="bpa-rooms-state" role="status">${ICON_INFO}<span>${tr('No published cases are available. Ask an admin to publish a case first.', 'Chưa có vụ án được xuất bản. Hãy yêu cầu quản trị viên xuất bản vụ án trước.')}</span></p>`
    : `${ledgerHead(`${count} ${tr(plural(count, 'case ready', 'cases ready'), 'vụ án sẵn sàng')}`)}
       <div class="bpa-rooms-tablewrap">
         <table class="bpa-table bpa-rooms-table">
           <caption class="bpa-sr">${tr('Choose the case for your room', 'Chọn vụ án cho phòng của bạn')}</caption>
           <thead>
             <tr>
               <th scope="col">${tr('Case', 'Vụ án')}</th>
               <th scope="col" class="bpa-rooms-num bpa-rooms-lg">${tr('Scenes', 'Hiện trường')}</th>
               <th scope="col" class="bpa-rooms-num bpa-rooms-lg">${tr('Suspects', 'Nghi phạm')}</th>
               <th scope="col" class="bpa-rooms-num bpa-rooms-lg">${tr('Clues', 'Manh mối')}</th>
               <th scope="col"><span class="bpa-sr">${tr('Select', 'Chọn')}</span></th>
             </tr>
           </thead>
           <tbody id="rooms-case-rows">${rowsHtml()}</tbody>
         </table>
       </div>
       <p class="bpa-rooms-foot">${ICON_INFO}<span>${tr('The room code is issued when the room opens. You pick roles together in the lobby.', 'Mã phòng được cấp khi phòng mở. Hai người chọn vai trong phòng chờ.')}</span></p>`;

  const createHtml = count === 0 ? '' : `
    <section class="bpa-paper bpa-paper--kraft bpa-rooms-card bpa-rooms-create" aria-labelledby="rooms-create-h">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <p class="bpa-kicker bpa-rooms-kick">${tr('Open a new file', 'Mở hồ sơ mới')}</p>
      <h2 id="rooms-create-h" class="bpa-rooms-h2">${tr('Create a room', 'Tạo phòng')}</h2>
      <div class="bpa-rooms-selected" id="rooms-selected" aria-live="polite">${selectedHtml()}</div>
      <div class="bpa-rooms-codeslot">
        <span class="bpa-rooms-codeslot-k">${tr('Invite code', 'Mã mời')}</span>
        <span class="bpa-rooms-codeslot-t">${tr('Issued as soon as the room opens — share it from the lobby.', 'Có ngay khi phòng mở — gửi cho đồng đội từ phòng chờ.')}</span>
      </div>
      <button type="button" class="bpa-btn bpa-btn--red bpa-btn--block bpa-rooms-createbtn" id="create-room-submit">${tr('Create room', 'Tạo phòng')}</button>
    </section>`;

  render(app, pageShell(ledgerHtml, createHtml));
  bindJoinForm(app);

  // Selection only repaints the rows and the selected-case block, so a code typed
  // into the join card (and keyboard focus) survives picking another case.
  function draw() {
    const rows = app.querySelector('#rooms-case-rows');
    if (rows) {
      rows.querySelectorAll('[data-row-case]').forEach((row) => {
        const on = row.dataset.rowCase === selectedCaseId;
        row.classList.toggle('is-selected', on);
        row.querySelector('[data-select-case]')?.setAttribute('aria-pressed', String(on));
      });
    }
    const block = app.querySelector('#rooms-selected');
    if (block) {
      flip = !flip;
      block.innerHTML = selectedHtml();
      block.classList.remove('bpa-wipe-a', 'bpa-wipe-b');
      block.classList.add(flip ? 'bpa-wipe-b' : 'bpa-wipe-a');
    }
  }

  app.querySelectorAll('[data-row-case]').forEach((row) =>
    row.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      const id = row.dataset.rowCase;
      if (id === selectedCaseId) return;
      selectedCaseId = id;
      draw();
    }));

  app.querySelector('#create-room-submit')?.addEventListener('click', async (buttonEvent) => {
    const button = buttonEvent.currentTarget;
    button.disabled = true;
    try {
      const room = await roomApi.create(selectedCaseId);
      toast(tr(`Room ${room.roomCode} created.`, `Đã tạo phòng ${room.roomCode}.`), 'success');
      window.location.hash = `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
}
