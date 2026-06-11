import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderCaseDetailPage(app, caseId) {
  render(app, '<div class="page"><p class="muted">Loading case…</p></div>');

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
    <a class="muted small" href="#/cases">&larr; All cases</a>
    <div class="case-detail-head">
      <div class="case-cover case-cover-lg" style="${placeholderStyle(detail.caseId)}">
        <img src="${escapeHtml(detail.coverImageUrl)}" alt="" onerror="this.remove()">
        <span class="case-cover-title">${escapeHtml(detail.title)}</span>
      </div>
      <div>
        <h2>${escapeHtml(detail.title)}</h2>
        <p>${escapeHtml(detail.summary)}</p>
        <div class="case-meta">
          <span class="chip">${detail.estimatedMinutes} min</span>
          <span class="chip">${detail.sceneCount} scenes</span>
          <span class="chip">${detail.itemCount} items</span>
          <span class="chip">${detail.clueCount} clues</span>
          <span class="chip">${detail.dialogueCount} questions</span>
        </div>
        <div class="case-actions">
          <button class="btn btn-primary" id="create-room">Create room</button>
          <a class="btn btn-ghost" href="#/join">Join with code</a>
        </div>
      </div>
    </div>
    <h3 class="section-title">People of interest</h3>
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
