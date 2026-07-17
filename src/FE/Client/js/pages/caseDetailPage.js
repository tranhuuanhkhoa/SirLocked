import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';

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
    <div class="char-card">
      <div class="char-avatar" style="${placeholderStyle(ch.characterId)}">
        <img src="${escapeHtml(ch.imageUrl)}" alt="" onerror="this.remove()">
        <span>${initials(ch.name)}</span>
      </div>
      <div>
        <strong>${escapeHtml(ch.name)}</strong>
        <p class="muted small">${escapeHtml(ch.description)}</p>
      </div>
    </div>`).join('');

  render(app, `
  <div class="page">
    <a class="muted small" href="#/cases">&larr; ${tr('All cases', 'Tất cả vụ án')}</a>
    <div class="case-detail-head">
      <div class="case-cover case-cover-lg" style="${placeholderStyle(detail.caseId)}">
        <img src="${escapeHtml(detail.coverImageUrl)}" alt="" onerror="this.remove()">
        <span class="case-cover-title">${escapeHtml(detail.title)}</span>
      </div>
      <div>
        <h2>${escapeHtml(detail.title)}</h2>
        <p>${escapeHtml(detail.summary)}</p>
        <div class="case-meta">
          <span class="chip">${detail.estimatedMinutes} ${tr('min', 'phút')}</span>
          <span class="chip">${detail.sceneCount} ${tr('scenes', 'hiện trường')}</span>
          <span class="chip">${detail.itemCount} ${tr('items', 'vật phẩm')}</span>
          <span class="chip">${detail.clueCount} ${tr('clues', 'manh mối')}</span>
          <span class="chip">${detail.dialogueCount} ${tr('questions', 'câu hỏi')}</span>
        </div>
        <div class="case-actions">
          <button class="btn btn-primary" id="create-room">${tr('Create room', 'Tạo phòng')}</button>
          <a class="btn btn-ghost" href="#/join">${tr('Join with code', 'Vào bằng mã phòng')}</a>
        </div>
      </div>
    </div>
    <h3 class="section-title">${tr('People of interest', 'Nhân vật liên quan')}</h3>
    <div class="char-grid">${characters}</div>
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
