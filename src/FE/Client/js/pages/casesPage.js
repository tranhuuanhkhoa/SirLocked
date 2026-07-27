import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { plural, tr } from '../services/i18n.js';

/**
 * A metadata stat, presented as a value + label plate instead of a grey pill.
 * The two spans hold exactly the words the flat chip held, so the joined text
 * content — and every i18n assertion over it — is unchanged.
 */
const stat = (value, label) => `
          <span class="chip chip--stat">
            <span class="chip-stat-value">${value}</span>
            <span class="chip-stat-label">${label}</span>
          </span>`;

export async function renderCasesPage(app) {
  render(app, `<div class="page"><p class="muted">${tr('Loading published cases…', 'Đang tải các vụ án…')}</p></div>`);

  let cases = [];
  try {
    cases = await caseApi.published();
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  // The case title lives in one place only: the plate across the cover art.
  const cards = cases.map((c) => `
    <article class="case-card card panel--dossier" data-case="${escapeHtml(c.caseId)}">
      <div class="case-cover card-media" style="${placeholderStyle(c.caseId)}">
        <img src="${escapeHtml(c.coverImageUrl)}" alt="" loading="lazy"
             onerror="this.remove()">
        <span class="case-cover-title">${escapeHtml(c.title)}</span>
      </div>
      <div class="case-body card-body">
        <p class="case-summary card-text">${escapeHtml(c.summary)}</p>
        <div class="case-meta cluster">
          ${stat(c.estimatedMinutes, tr('min', 'phút'))}
          ${stat(c.sceneCount, tr(plural(c.sceneCount, 'scene', 'scenes'), 'hiện trường'))}
          ${stat(c.characterCount, tr(plural(c.characterCount, 'suspect', 'suspects'), 'nghi phạm'))}
          ${stat(c.clueCount, tr(plural(c.clueCount, 'clue', 'clues'), 'manh mối'))}
        </div>
      </div>
      <div class="case-actions card-foot">
        <a class="btn btn-ghost btn-sm" href="#/cases/${encodeURIComponent(c.caseId)}">${tr('Details', 'Chi tiết')}</a>
        <button class="btn btn-primary btn-sm" data-create="${escapeHtml(c.caseId)}">${tr('Create room', 'Tạo phòng')}</button>
      </div>
    </article>`).join('');

  // One case is the real data shape today, so the solo layout is not a fallback:
  // the board centres itself and the single file opens out instead of sitting in
  // a corner of an empty grid.
  const solo = cases.length === 1;

  render(app, `
  <div class="page page-board">
    <div class="page-head">
      <h2>${tr('Published Cases', 'Vụ án đã xuất bản')}</h2>
      <div class="case-actions">
        <a class="btn btn-ghost" href="#/join">${tr('Have a room code?', 'Đã có mã phòng?')}</a>
      </div>
    </div>
    ${cases.length === 0
      ? `<div class="empty-state">${tr('No cases are published yet. Ask an admin to publish a case.', 'Chưa có vụ án nào được xuất bản. Hãy yêu cầu quản trị viên xuất bản một vụ án.')}</div>`
      : `<div class="case-board${solo ? ' is-solo' : ''}">
          <div class="case-grid grid-auto${solo ? ' is-solo' : ''}">${cards}</div>
        </div>`}
  </div>`);

  app.querySelectorAll('[data-create]').forEach((button) =>
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const room = await roomApi.create(button.dataset.create);
        toast(`Room ${room.roomCode} created.`, 'success');
        window.location.hash = `#/lobby/${room.roomId}`;
      } catch (err) {
        toast(err.message, 'error');
        button.disabled = false;
      }
    }));
}
