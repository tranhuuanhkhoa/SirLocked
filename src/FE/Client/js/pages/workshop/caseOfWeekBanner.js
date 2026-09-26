import { weeklyApi } from '../../api/weeklyApi.js';
import { escapeHtml } from '../../utils/dom.js';

/**
 * Standalone "Case of the Week" banner. Self-contained:
 *
 *   import { renderCaseOfWeekBanner } from './pages/workshop/caseOfWeekBanner.js';
 *   renderCaseOfWeekBanner(document.querySelector('#cow-mount'));
 *
 * Renders nothing (and hides the mount) when no case of the week is active, so it never takes space.
 */
export async function renderCaseOfWeekBanner(mount) {
  if (!mount) return;

  let feature;
  try {
    feature = await weeklyApi.caseOfWeek();
  } catch {
    hide(mount); // non-critical banner; fail quietly
    return;
  }

  if (!feature) {
    hide(mount);
    return;
  }

  mount.style.display = '';
  mount.classList.add('ws-weekly');
  mount.innerHTML = `
    <div class="ws-weekly-banner">
      <div class="ws-weekly-banner-media">
        <img src="${escapeHtml(feature.coverImageUrl)}" alt="" onerror="this.remove()">
      </div>
      <div class="ws-weekly-banner-body">
        <span class="ws-weekly-tag">Vụ án của tuần</span>
        <h3 class="ws-weekly-title">${escapeHtml(feature.caseTitle)}</h3>
        <p class="ws-weekly-summary">${escapeHtml(feature.summary)}</p>
        <a class="ws-weekly-cta" href="#/cases/${encodeURIComponent(feature.caseId)}">Chơi ngay</a>
      </div>
    </div>`;
}

function hide(mount) {
  mount.innerHTML = '';
  mount.style.display = 'none';
}
