import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { plural, tr } from '../services/i18n.js';

const stat = (value, label) => `
          <span class="chip chip--stat">
            <span class="chip-stat-value">${value}</span>
            <span class="chip-stat-label">${label}</span>
          </span>`;

export async function renderCaseDetailPage(app, caseId) {
  render(app, `<div class="page"><p class="muted">${tr('Loading case…', 'Đang tải vụ án…')}</p></div>`);

  let detail;
  try {
    detail = await caseApi.detail(decodeURIComponent(caseId));
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const characters = detail.characters.map((ch) => `
    <article class="char-card card">
      <div class="char-avatar" style="${placeholderStyle(ch.characterId)}">
        <img src="${escapeHtml(ch.imageUrl)}" alt="" onerror="this.remove()">
        <span>${initials(ch.name)}</span>
      </div>
      <div class="char-info">
        <strong>${escapeHtml(ch.name)}</strong>
        <p class="muted small">${escapeHtml(ch.description)}</p>
      </div>
    </article>`).join('');

  // One suspect is the common shape today; widen the card instead of leaving it
  // stranded at a quarter of the container.
  const soloChar = detail.characters.length === 1;

  // The title appears once, as the dossier heading. The cover is artwork only.
  render(app, `
  <div class="page page-board">
    <a class="case-back muted small" href="#/cases">&larr; ${tr('All cases', 'Tất cả vụ án')}</a>
    <div class="case-detail-head case-detail-grid">
      <div class="case-cover case-cover-lg card-media" style="${placeholderStyle(detail.caseId)}">
        <img src="${escapeHtml(detail.coverImageUrl)}" alt="" onerror="this.remove()">
      </div>
      <div class="case-dossier panel panel--dossier">
        <h2>${escapeHtml(detail.title)}</h2>
        <p class="case-summary">${escapeHtml(detail.summary)}</p>
        <div class="case-meta cluster">
          ${stat(detail.estimatedMinutes, tr('min', 'phút'))}
          ${stat(detail.sceneCount, tr(plural(detail.sceneCount, 'scene', 'scenes'), 'hiện trường'))}
          ${stat(detail.itemCount, tr(plural(detail.itemCount, 'item', 'items'), 'vật phẩm'))}
          ${stat(detail.clueCount, tr(plural(detail.clueCount, 'clue', 'clues'), 'manh mối'))}
          ${stat(detail.dialogueCount, tr(plural(detail.dialogueCount, 'question', 'questions'), 'câu hỏi'))}
        </div>
        <div class="case-actions case-actions--cta">
          <button class="btn btn-primary" id="create-room">${tr('Create room', 'Tạo phòng')}</button>
          <a class="btn btn-ghost btn-sm" href="#/join">${tr('Join with code', 'Vào bằng mã phòng')}</a>
        </div>
      </div>
    </div>
    <h3 class="section-title">${tr('People of interest', 'Nhân vật liên quan')}</h3>
    <div class="char-grid grid-auto${soloChar ? ' is-solo' : ''}">${characters}</div>
  </div>`);

  app.querySelector('#create-room').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const room = await roomApi.create(detail.caseId);
      toast(`Room ${room.roomCode} created.`, 'success');
      window.location.hash = `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  });
}
