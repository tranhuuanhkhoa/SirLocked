import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

export async function renderCreateRoomPage(app) {
  render(app, '<div class="page"><p class="muted">Loading published cases...</p></div>');

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
          <span class="muted small">${c.estimatedMinutes} min / ${c.sceneCount} scenes / ${c.clueCount} clues</span>
        </span>
        <span class="chip">${escapeHtml(c.characterCount)} suspects</span>
      </button>`).join('');

    const preview = selected ? `
      <div class="case-preview">
        <div class="case-cover case-cover-lg" style="${placeholderStyle(selected.caseId)}">
          <img src="${escapeHtml(selected.coverImageUrl)}" alt="" onerror="this.remove()">
          <span class="case-cover-title">${escapeHtml(selected.title)}</span>
        </div>
        <div>
          <h3>${escapeHtml(selected.title)}</h3>
          <p>${escapeHtml(selected.summary)}</p>
          <div class="case-meta">
            <span class="chip">${selected.estimatedMinutes} min</span>
            <span class="chip">${selected.sceneCount} scenes</span>
            <span class="chip">${selected.characterCount} suspects</span>
            <span class="chip">${selected.clueCount} clues</span>
          </div>
          <div class="case-actions">
            <button class="btn btn-primary" id="create-room-submit">Create room</button>
            <a class="btn btn-ghost" href="#/cases/${encodeURIComponent(selected.caseId)}">Details</a>
          </div>
        </div>
      </div>` : '';

    render(app, `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>Create Room</h2>
          <p class="muted">Choose a published case and open a two-player lobby.</p>
        </div>
        <a class="btn btn-ghost" href="#/join">Join with code</a>
      </div>

      ${cases.length === 0
        ? '<div class="empty-state">No published cases are available. Ask an admin to seed and publish a case first.</div>'
        : `<div class="create-room-grid">
            <section>
              <h3 class="section-title">Published cases</h3>
              <div class="case-select-list">${caseOptions}</div>
            </section>
            <section>
              <h3 class="section-title">Room preview</h3>
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
