import { gameApi } from '../api/gameApi.js';
import { escapeHtml, render } from '../utils/dom.js';
import { tr } from '../services/i18n.js';

const scoreBar = (label, value, max) => `
  <div class="score-row">
    <span class="muted small">${escapeHtml(label)}</span>
    <span class="score-track"><span class="score-fill" style="width:${Math.max(0, Math.min(100, (Number(value) / max) * 100))}%"></span></span>
    <strong>${escapeHtml(String(value))}/${max}</strong>
  </div>`;

const teamworkFlags = (score) => {
  const flags = [
    score.investigatorContribution ? `✓ ${tr('Investigator', 'Điều tra viên')}` : `· ${tr('Investigator', 'Điều tra viên')}`,
    score.interrogatorContribution ? `✓ ${tr('Interrogator', 'Thẩm vấn viên')}` : `· ${tr('Interrogator', 'Thẩm vấn viên')}`,
    score.crossRoleHandoff ? `✓ ${tr('Handoff', 'Phối hợp')}` : `· ${tr('Handoff', 'Phối hợp')}`
  ];
  return escapeHtml(flags.join('  '));
};

const scorePenalties = (score) => {
  const parts = [];
  if (score.wrongEvidencePenalty) parts.push(`−${score.wrongEvidencePenalty} ${tr('wrong evidence', 'chứng cứ sai')}`);
  if (score.wrongDeductionPenalty) parts.push(`−${score.wrongDeductionPenalty} ${tr('wrong deductions', 'suy luận sai')}`);
  if (score.cameraMissPenalty) parts.push(`−${score.cameraMissPenalty} ${tr('camera misses', 'lần chụp trượt')}`);
  if (parts.length === 0) return '';
  return `<div class="score-row score-row-penalty"><span class="muted small">${tr('Penalties', 'Điểm trừ')}</span><span class="muted small">${escapeHtml(parts.join('  '))}</span></div>`;
};

export async function renderResultPage(app, roomId) {
  render(app, `<div class="page"><p class="muted">${tr('Loading the verdict…', 'Đang tải phán quyết…')}</p></div>`);

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
      <span>${tr('Your answer:', 'Câu trả lời:')} ${escapeHtml(value.selectedLabel || value.selectedEvidenceTitle || tr('Not supplied', 'Chưa cung cấp'))}</span>
      ${value.isCorrect ? `<span>${tr('Correct', 'Chính xác')}</span>` : `<span>${tr('Truth:', 'Sự thật:')} ${escapeHtml(value.correctLabel || value.correctEvidenceTitle || '')}</span>`}
    </div>`;
  render(app, `
  <div class="page result-page ${win ? 'result-win' : 'result-fail'}">
    <header class="result-hero">
      <div class="result-banner">${win ? tr('CASE CLOSED', 'PHÁ ÁN THÀNH CÔNG') : tr('CASE COLD', 'VỤ ÁN BẾ TẮC')}</div>
      <h2>${win ? tr('The culprit is exposed.', 'Hung thủ đã bị vạch mặt.') : tr('The culprit walks free.', 'Hung thủ vẫn ngoài vòng pháp luật.')}</h2>
      <p class="result-ending">${escapeHtml(result.ending)}</p>
    </header>

    <div class="result-layout ${v2 ? '' : 'is-legacy'}">
      ${v2 ? `<section class="result-panel result-verdict-panel">
        <div class="result-section-heading"><span>${tr('CASE REVIEW', 'TỔNG KẾT VỤ ÁN')}</span><h3>${tr('Accusation breakdown', 'Phân tích cáo buộc')}</h3></div>
        <div class="verdict-breakdown">
          ${verdictRow(tr('Culprit', 'Hung thủ'), result.culpritResult)}
          ${verdictRow(tr('Motive', 'Động cơ'), result.motiveResult)}
          ${verdictRow(tr('Method', 'Phương thức'), result.methodResult)}
          ${result.evidenceResults.map((entry) => verdictRow(`${entry.claimType} ${tr('evidence', 'chứng cứ')}`, entry)).join('')}
        </div>
      </section>` : ''}

      <aside class="result-panel result-score-panel">
        <div class="result-section-heading"><span>${tr('PERFORMANCE', 'HIỆU SUẤT')}</span><h3>${tr('Detective score', 'Điểm điều tra')}</h3></div>
        ${score ? `<div class="result-stat-grid">
          <div class="result-box result-stat"><span class="muted small">${tr('SCORE', 'ĐIỂM')}</span><strong>${escapeHtml(String(score.totalScore))}</strong><span class="muted small">${tr('Rank', 'Hạng')} ${escapeHtml(score.rank)}</span></div>
          <div class="result-box result-stat"><span class="muted small">${tr('TEAMWORK', 'PHỐI HỢP')}</span><strong>${escapeHtml(String(score.teamworkScore))}/15</strong><span class="muted small">${teamworkFlags(score)}</span></div>
        </div>
        <div class="score-breakdown">
          ${scoreBar(tr('Evidence', 'Chứng cứ'), score.evidenceCoverageScore, 40)}
          ${scoreBar(tr('Contradictions', 'Mâu thuẫn'), score.contradictionCoverageScore, 25)}
          ${scoreBar(tr('Deductions', 'Suy luận'), score.deductionCoverageScore, 20)}
          ${scoreBar(tr('Teamwork', 'Phối hợp'), score.teamworkScore, 15)}
          ${scorePenalties(score)}
        </div>` : `<p class="muted">${tr('No score summary was recorded for this case.', 'Vụ án này không có bảng điểm.')}</p>`}
      </aside>
    </div>

    <section class="result-comparison" aria-label="${tr('Accusation compared with the truth', 'So sánh cáo buộc và sự thật')}">
      <div class="result-box"><span class="muted small">${tr('YOUR ACCUSATION', 'CÁO BUỘC CỦA BẠN')}</span><strong>${escapeHtml(result.selectedCulpritName || result.selectedCulpritId)}</strong><span class="muted small">${result.selectedEvidenceIds.length} ${tr('piece(s) of evidence presented', 'chứng cứ đã trình bày')}</span></div>
      <div class="result-box result-truth-box"><span class="muted small">${tr('THE TRUTH', 'SỰ THẬT')}</span><strong>${escapeHtml(result.correctCulpritName || result.correctCulpritId)}</strong><span class="muted small"><b>${tr('Motive:', 'Động cơ:')}</b> ${escapeHtml(result.motive)}</span><span class="muted small"><b>${tr('Method:', 'Phương thức:')}</b> ${escapeHtml(result.method)}</span></div>
    </section>

    <div class="case-actions result-actions"><a class="btn btn-gold" href="#/cases">${tr('Back to cases', 'Quay lại danh sách vụ án')}</a></div>
  </div>`);
}
