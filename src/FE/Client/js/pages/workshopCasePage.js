import { workshopApi } from '../api/workshopApi.js';
import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { renderReviewSection } from './workshop/reviewSection.js';
import { renderLeaderboardSection } from './workshop/leaderboardSection.js';

function pct(fraction) {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

function statTile(value, label, hint, tone) {
  return `
    <div class="ws-stat${tone ? ` ws-stat-${tone}` : ''}">
      <div class="ws-stat-value">${escapeHtml(value)}</div>
      <div class="ws-stat-label">${escapeHtml(label)}</div>
      ${hint ? `<div class="ws-stat-hint muted small">${escapeHtml(hint)}</div>` : ''}
    </div>`;
}

export async function renderWorkshopCasePage(app, caseId) {
  render(app, '<div class="page"><p class="muted">Đang tải hồ sơ vụ án…</p></div>');

  let stats;
  let detail;
  try {
    // stats is the source of truth; case detail is supplementary cover/summary, so its failure is non-fatal.
    [stats, detail] = await Promise.all([
      workshopApi.stats(caseId),
      caseApi.detail(caseId).catch(() => null),
    ]);
  } catch (err) {
    render(app, `
      <div class="page">
        <div class="empty-state">${escapeHtml(err.message)}</div>
        <a class="btn btn-ghost" href="#/workshop">← Về Workshop</a>
      </div>`);
    return;
  }

  const title = detail?.title || stats.title || caseId;
  const summary = detail?.summary || '';
  const cover = detail?.coverImageUrl || '';

  const tiles = [];
  if (stats.totalPlays > 0) {
    tiles.push(statTile(pct(stats.wrongCulpritRate), 'Buộc tội nhầm hung thủ', 'Tỉ lệ đội chọn sai thủ phạm', 'bad'));
    tiles.push(statTile(pct(stats.successRate), 'Phá án thành công', 'Tỉ lệ thắng', 'ok'));
    tiles.push(statTile(pct(stats.correctEvidenceRate), 'Tìm đúng bằng chứng', 'Chọn đủ bằng chứng bắt buộc'));
    if (stats.correctWeaponRate != null) {
      tiles.push(statTile(pct(stats.correctWeaponRate), 'Đúng hung khí', 'Chọn đúng phương thức gây án'));
    }
    if (stats.correctMotiveRate != null) {
      tiles.push(statTile(pct(stats.correctMotiveRate), 'Đúng động cơ', 'Chọn đúng động cơ gây án'));
    }
    if (stats.avgSolveTimeMinutes != null) {
      tiles.push(statTile(`${stats.avgSolveTimeMinutes}′`, 'Thời gian phá án TB', `Trên ${stats.solveTimeSampleSize} ván có dữ liệu`));
    }
    if (stats.averageScore != null) {
      tiles.push(statTile(`${stats.averageScore}`, 'Điểm trung bình', 'Thang điểm 0–100'));
    }
  }

  render(app, `
  <div class="page">
    <div class="page-head">
      <a class="btn btn-ghost btn-sm" href="#/workshop">← Workshop</a>
    </div>

    <div class="ws-detail-head">
      <div class="case-cover case-cover-lg ws-detail-cover" style="${placeholderStyle(caseId)}">
        ${cover ? `<img src="${escapeHtml(cover)}" alt="" onerror="this.remove()">` : ''}
        <span class="case-cover-title">${escapeHtml(title)}</span>
      </div>
      <div class="ws-detail-meta">
        <h2>${escapeHtml(title)}</h2>
        ${summary ? `<p class="case-summary">${escapeHtml(summary)}</p>` : ''}
        <div class="case-meta">
          <span class="chip">${stats.totalPlays} lượt chơi</span>
          ${detail ? `<span class="chip">${detail.characterCount} nghi phạm</span>` : ''}
          ${detail ? `<span class="chip">${detail.estimatedMinutes} phút</span>` : ''}
        </div>
        <div class="case-actions">
          <button class="btn btn-primary" id="ws-play" type="button">Chơi vụ án này</button>
          <a class="btn btn-ghost" href="#/cases/${encodeURIComponent(caseId)}">Xem chi tiết case</a>
        </div>
      </div>
    </div>

    <div class="ws-detail-tabs" role="tablist" aria-label="Nội dung vụ án">
      <button type="button" class="ws-detail-tab is-active" data-tab="stats" role="tab" aria-selected="true">Thống kê</button>
      <button type="button" class="ws-detail-tab" data-tab="reviews" role="tab" aria-selected="false">Đánh giá</button>
      <button type="button" class="ws-detail-tab" data-tab="leaderboard" role="tab" aria-selected="false">Bảng xếp hạng</button>
    </div>

    <div class="ws-detail-panel" data-panel="stats">
      ${stats.totalPlays === 0
        ? '<div class="empty-state">Chưa có ai phá án này — hãy là đội đầu tiên ghi tên vào hồ sơ!</div>'
        : `<div class="ws-stat-grid">${tiles.join('')}</div>`}
    </div>
    <div class="ws-detail-panel" data-panel="reviews" hidden>
      <div id="ws-review-mount"></div>
    </div>
    <div class="ws-detail-panel" data-panel="leaderboard" hidden>
      <div id="ws-leaderboard-mount"></div>
    </div>
  </div>`);

  // Lazy-mount each tab's widget on first open (avoid fetching review + leaderboard up front).
  const mounted = new Set();
  function failPanel(el, what, err) {
    console.error(`workshop detail: ${what} mount failed`, err);
    if (el) el.innerHTML = `<p class="muted">Không tải được ${what}.</p>`;
  }
  function mountOnce(tab) {
    if (mounted.has(tab)) return;
    mounted.add(tab);
    if (tab === 'reviews') {
      const el = app.querySelector('#ws-review-mount');
      try {
        Promise.resolve(renderReviewSection(caseId, el)).catch((err) => failPanel(el, 'đánh giá', err));
      } catch (err) {
        failPanel(el, 'đánh giá', err);
      }
    } else if (tab === 'leaderboard') {
      const el = app.querySelector('#ws-leaderboard-mount');
      try {
        Promise.resolve(renderLeaderboardSection(caseId, el)).catch((err) => failPanel(el, 'bảng xếp hạng', err));
      } catch (err) {
        failPanel(el, 'bảng xếp hạng', err);
      }
    }
  }
  function showTab(name) {
    app.querySelectorAll('.ws-detail-tab').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    app.querySelectorAll('.ws-detail-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== name;
    });
    mountOnce(name);
  }
  app.querySelectorAll('.ws-detail-tab').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab)));

  app.querySelector('#ws-play').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const room = await roomApi.create(caseId);
      toast(`Đã tạo phòng ${room.roomCode}.`, 'success');
      window.location.hash = `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });
}
