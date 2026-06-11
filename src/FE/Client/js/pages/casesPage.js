import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderCasesPage(app) {
  render(app, '<div class="page"><p class="muted">Loading published cases…</p></div>');

  let cases = [];
  try {
    cases = await caseApi.published();
  } catch (err) {
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return;
  }

  const cards = cases.map((c) => `
    <article class="case-card" data-case="${escapeHtml(c.caseId)}">
      <div class="case-cover" style="${placeholderStyle(c.caseId)}">
        <img src="${escapeHtml(c.coverImageUrl)}" alt="" loading="lazy"
             onerror="this.remove()">
        <span class="case-cover-title">${escapeHtml(c.title)}</span>
      </div>
      <div class="case-body">
        <h3>${escapeHtml(c.title)}</h3>
        <p class="case-summary">${escapeHtml(c.summary)}</p>
        <div class="case-meta">
          <span class="chip">${c.estimatedMinutes} min</span>
          <span class="chip">${c.sceneCount} scenes</span>
          <span class="chip">${c.characterCount} suspects</span>
          <span class="chip">${c.clueCount} clues</span>
        </div>
        <div class="case-actions">
          <a class="btn btn-ghost btn-sm" href="#/cases/${encodeURIComponent(c.caseId)}">Details</a>
          <button class="btn btn-primary btn-sm" data-create="${escapeHtml(c.caseId)}">Create room</button>
        </div>
      </div>
    </article>`).join('');

  render(app, `
  <div class="page">
    <div class="page-head">
      <h2>Published Cases</h2>
      <a class="btn btn-ghost" href="#/join">Have a room code?</a>
    </div>
    ${cases.length === 0
      ? '<div class="empty-state">No cases are published yet. Ask an admin to seed and publish the sample case.</div>'
      : `<div class="case-grid">${cards}</div>`}
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
