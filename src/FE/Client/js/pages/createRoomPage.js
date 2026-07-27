import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

export async function renderCreateRoomPage(app) {
  render(app, `<div class="page"><p class="muted">${tr('Loading published cases...', 'Đang tải các vụ án...')}</p></div>`);

  let cases = [];
  try {
    cases = await caseApi.published();
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  let selectedCaseId = cases[0]?.caseId ?? null;

  function draw() {
    const selected = cases.find((c) => c.caseId === selectedCaseId);
    const caseOptions = cases.map((c) => `
      <button class="case-select-row ${c.caseId === selectedCaseId ? 'is-selected' : ''}"
              data-select-case="${escapeHtml(c.caseId)}">
        <span>
          <strong>${escapeHtml(c.title)}</strong>
          <span class="muted small">${c.estimatedMinutes} ${tr('min', 'phút')} / ${c.sceneCount} ${tr('scenes', 'hiện trường')} / ${c.clueCount} ${tr('clues', 'manh mối')}</span>
        </span>
        <span class="chip">${escapeHtml(c.characterCount)} ${tr('suspects', 'nghi phạm')}</span>
      </button>`).join('');

    const preview = selected ? `
      <div class="case-preview">
        <div class="case-cover case-cover-lg card-media" style="${placeholderStyle(selected.caseId)}">
          <img src="${escapeHtml(selected.coverImageUrl)}" alt="" onerror="this.remove()">
          <span class="case-cover-title">${escapeHtml(selected.title)}</span>
        </div>
        <div>
          <h3>${escapeHtml(selected.title)}</h3>
          <p>${escapeHtml(selected.summary)}</p>
          <div class="case-meta">
            <span class="chip">${selected.estimatedMinutes} ${tr('min', 'phút')}</span>
            <span class="chip">${selected.sceneCount} ${tr('scenes', 'hiện trường')}</span>
            <span class="chip">${selected.characterCount} ${tr('suspects', 'nghi phạm')}</span>
            <span class="chip">${selected.clueCount} ${tr('clues', 'manh mối')}</span>
          </div>
          <div class="case-actions">
            <button class="btn btn-primary" id="create-room-submit">${tr('Create room', 'Tạo phòng')}</button>
            <a class="btn btn-ghost" href="#/cases/${encodeURIComponent(selected.caseId)}">${tr('Details', 'Chi tiết')}</a>
          </div>
        </div>
      </div>` : '';

    render(app, `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>${tr('Create Room', 'Tạo phòng')}</h2>
          <p class="muted">${tr('Choose a published case and open a two-player lobby.', 'Chọn một vụ án đã xuất bản và mở phòng chờ hai người.')}</p>
        </div>
        <a class="btn btn-ghost" href="#/join">${tr('Join with code', 'Vào bằng mã phòng')}</a>
      </div>

      ${cases.length === 0
        ? `<div class="empty-state">${tr('No published cases are available. Ask an admin to publish a case first.', 'Chưa có vụ án được xuất bản. Hãy yêu cầu quản trị viên xuất bản vụ án trước.')}</div>`
        : `<div class="create-room-grid">
            <section>
              <h3 class="section-title">${tr('Published cases', 'Vụ án đã xuất bản')}</h3>
              <div class="case-select-list">${caseOptions}</div>
            </section>
            <section>
              <h3 class="section-title">${tr('Room preview', 'Xem trước phòng')}</h3>
              ${preview}
            </section>
          </div>`}
    </div>`);

    app.querySelectorAll('[data-select-case]').forEach((button) =>
      button.addEventListener('click', () => {
        selectedCaseId = button.dataset.selectCase;
        draw();
      }));

    app.querySelector('#create-room-submit')?.addEventListener('click', async (buttonEvent) => {
      const button = buttonEvent.currentTarget;
      button.disabled = true;
      try {
        const room = await roomApi.create(selectedCaseId);
        toast(`Room ${room.roomCode} created.`, 'success');
        window.location.hash = `#/lobby/${room.roomId}`;
      } catch (err) {
        toast(err.message, 'error');
        button.disabled = false;
      }
    });
  }

  draw();
}
