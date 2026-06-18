import { gameApi } from '../api/gameApi.js';
import { escapeHtml, render } from '../utils/dom.js';

const scoreBar = (label, value, max) => `
  <div class="score-row">
    <span class="muted small">${escapeHtml(label)}</span>
    <span class="score-track"><span class="score-fill" style="width:${Math.max(0, Math.min(100, (Number(value) / max) * 100))}%"></span></span>
    <strong>${escapeHtml(String(value))}/${max}</strong>
  </div>`;

const teamworkFlags = (score) => {
  const flags = [
    score.investigatorContribution ? '✓ Investigator' : '· Investigator',
    score.interrogatorContribution ? '✓ Interrogator' : '· Interrogator',
    score.crossRoleHandoff ? '✓ Handoff' : '· Handoff'
  ];
  return escapeHtml(flags.join('  '));
};

const scorePenalties = (score) => {
  const parts = [];
  if (score.wrongEvidencePenalty) parts.push(`−${score.wrongEvidencePenalty} wrong evidence`);
  if (score.wrongDeductionPenalty) parts.push(`−${score.wrongDeductionPenalty} wrong deductions`);
  if (score.cameraMissPenalty) parts.push(`−${score.cameraMissPenalty} camera misses`);
  if (parts.length === 0) return '';
  return `<div class="score-row score-row-penalty"><span class="muted small">Penalties</span><span class="muted small">${escapeHtml(parts.join('  '))}</span></div>`;
};

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
  const v2 = Boolean(result.culpritResult);
  const score = result.scoreSummary;
  const verdictRow = (label, value) => `
    <div class="verdict-row ${value.isCorrect ? 'is-correct' : 'is-wrong'}">
      <strong>${escapeHtml(label)}</strong>
      <span>Your answer: ${escapeHtml(value.selectedLabel || value.selectedEvidenceTitle || 'Not supplied')}</span>
      ${value.isCorrect ? '<span>Correct</span>' : `<span>Truth: ${escapeHtml(value.correctLabel || value.correctEvidenceTitle || '')}</span>`}
    </div>`;
  render(app, `
  <div class="page page-narrow result-page ${win ? 'result-win' : 'result-fail'}">
    <div class="result-banner">${win ? 'CASE CLOSED' : 'CASE COLD'}</div>
    <h2>${win ? 'The culprit is exposed.' : 'The culprit walks free.'}</h2>
    <p class="result-ending">${escapeHtml(result.ending)}</p>

    ${v2 ? `<div class="verdict-breakdown">
      ${verdictRow('Culprit', result.culpritResult)}
      ${verdictRow('Motive', result.motiveResult)}
      ${verdictRow('Method', result.methodResult)}
      ${result.evidenceResults.map((entry) => verdictRow(`${entry.claimType} evidence`, entry)).join('')}
    </div>` : ''}

    ${score ? `<div class="result-grid">
      <div class="result-box">
        <span class="muted small">SCORE</span>
        <strong>${escapeHtml(String(score.totalScore))}</strong>
        <span class="muted small">Rank ${escapeHtml(score.rank)}</span>
      </div>
      <div class="result-box">
        <span class="muted small">TEAMWORK</span>
        <strong>${escapeHtml(String(score.teamworkScore))}/15</strong>
        <span class="muted small">${teamworkFlags(score)}</span>
      </div>
    </div>
    <div class="score-breakdown">
      ${scoreBar('Evidence', score.evidenceCoverageScore, 40)}
      ${scoreBar('Contradictions', score.contradictionCoverageScore, 25)}
      ${scoreBar('Deductions', score.deductionCoverageScore, 20)}
      ${scoreBar('Teamwork', score.teamworkScore, 15)}
      ${scorePenalties(score)}
    </div>` : ''}

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
