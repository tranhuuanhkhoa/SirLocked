import { gameApi } from '../api/gameApi.js';
import { escapeHtml, render } from '../utils/dom.js';

export async function renderResultPage(app, roomId) {
  render(app, '<div class="page"><p class="muted">Loading the verdict…</p></div>');

  let result = null;
  const cached = sessionStorage.getItem(`sirlocked.result.${roomId}`);
  if (cached) {
    try {
      result = JSON.parse(cached);
    } catch {
      /* fall through to API */
    }
  }
  if (!result) {
    try {
      result = await gameApi.result(roomId);
    } catch (err) {
      render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
      return;
    }
  }

  const win = result.success;
  render(app, `
  <div class="page page-narrow result-page ${win ? 'result-win' : 'result-fail'}">
    <div class="result-banner">${win ? 'CASE CLOSED' : 'CASE COLD'}</div>
    <h2>${win ? 'The culprit is exposed.' : 'The culprit walks free.'}</h2>
    <p class="result-ending">${escapeHtml(result.ending)}</p>

    <div class="result-grid">
      <div class="result-box">
        <span class="muted small">YOUR ACCUSATION</span>
        <strong>${escapeHtml(result.selectedCulpritName || result.selectedCulpritId)}</strong>
        <span class="muted small">${result.selectedEvidenceIds.length} piece(s) of evidence presented</span>
      </div>
      <div class="result-box">
        <span class="muted small">THE TRUTH</span>
        <strong>${escapeHtml(result.correctCulpritName || result.correctCulpritId)}</strong>
        <span class="muted small">Motive: ${escapeHtml(result.motive)}</span>
        <span class="muted small">Method: ${escapeHtml(result.method)}</span>
      </div>
    </div>

    <div class="case-actions" style="justify-content:center">
      <a class="btn btn-primary" href="#/cases">Back to cases</a>
    </div>
  </div>`);
}
