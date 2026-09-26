import { badgeApi } from '../../api/badgeApi.js';
import { escapeHtml } from '../../utils/dom.js';
import { BadgeCheck, LightbulbOff, Timer, Target, Camera, Crown, createIcons } from 'lucide';

/**
 * Standalone achievement grid for a detective profile. Self-contained:
 *
 *   import { renderBadgeSection } from './pages/workshop/badgeSection.js';
 *   renderBadgeSection(userId, document.querySelector('#badges-mount'));
 *
 * Earned badges glow gold with their context; locked ones are dimmed and show how to earn them.
 */

const ICONS = { BadgeCheck, LightbulbOff, Timer, Target, Camera, Crown };

export async function renderBadgeSection(userId, mount) {
  if (!mount) return;
  mount.classList.add('ws-badge');
  mount.innerHTML = '<p class="ws-badge-loading">Đang tải huy hiệu…</p>';

  let badges;
  try {
    badges = await badgeApi.forUser(userId);
  } catch (err) {
    mount.innerHTML = `<p class="ws-badge-error">${escapeHtml(err.message || 'Không tải được huy hiệu.')}</p>`;
    return;
  }

  mount.innerHTML = `<div class="ws-badge-grid">${badges.map(badgeCard).join('')}</div>`;

  // Render lucide icons inside this section (best-effort; the grid still reads fine without them).
  try {
    createIcons({ icons: ICONS, attrs: { class: 'ws-badge-icon-svg', 'aria-hidden': 'true' } });
  } catch {
    /* icons are decorative */
  }
}

function badgeCard(b) {
  const tooltip = b.earned ? (b.earnedContext || b.name) : b.description;
  const sub = b.earned
    ? (b.earnedContext ? `<span class="ws-badge-context">${escapeHtml(b.earnedContext)}</span>` : '')
    : `<span class="ws-badge-howto">${escapeHtml(b.description)}</span>`;
  return `
    <div class="ws-badge-card ${b.earned ? 'is-earned' : 'is-locked'}" title="${escapeHtml(tooltip)}">
      <i data-lucide="${escapeHtml(b.iconKey)}" class="ws-badge-icon"></i>
      <span class="ws-badge-name">${escapeHtml(b.name)}</span>
      ${sub}
    </div>`;
}
