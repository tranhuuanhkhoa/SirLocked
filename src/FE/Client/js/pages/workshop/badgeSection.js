import { badgeApi } from '../../api/badgeApi.js';
import { escapeHtml } from '../../utils/dom.js';
import { tr } from '../../services/i18n.js';
import { BadgeCheck, LightbulbOff, Timer, Target, Camera, Crown, createIcons } from 'lucide';

/**
 * Standalone medal cabinet for a detective profile. Self-contained:
 *
 *   import { renderBadgeSection } from './pages/workshop/badgeSection.js';
 *   renderBadgeSection(userId, document.querySelector('#badges-mount'));
 *
 * Renders the "earned / total" counter and one hanging medal per badge. Earned medals are gold
 * with their context; locked ones are dark with a padlock and say how to earn them.
 * Styles live in css/33-bpa-profile.css (imported by detectivePage.js).
 */

const ICONS = { BadgeCheck, LightbulbOff, Timer, Target, Camera, Crown };

// Ribbon colours for earned medals: [ribbon, centre stripe]. Decorative, picked by position.
const RIBBONS = [
  ['#1a2c42', '#c7a24b'],
  ['#2f6363', '#e9dcc0'],
  ['#9e3f2a', '#efd486'],
  ['#4b3a7a', '#b9a6e6'],
  ['#7a3f27', '#efd486'],
  ['#8a6420', '#fbf6ed'],
];

const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"></path></svg>';
const LOCK_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path></svg>';

// Gradients shared by every medal of the cabinet (one copy per page).
const DEFS_SVG = `
  <svg class="bpa-profile-defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="bpa-profile-g-gold" cx=".36" cy=".3" r=".78">
        <stop offset="0" stop-color="#fff3c9"></stop><stop offset=".38" stop-color="#dcbb62"></stop>
        <stop offset=".74" stop-color="#a9862f"></stop><stop offset="1" stop-color="#6d5420"></stop>
      </radialGradient>
      <radialGradient id="bpa-profile-g-dim" cx=".62" cy=".7" r=".75">
        <stop offset="0" stop-color="#2e2924"></stop><stop offset=".65" stop-color="#1a1714"></stop>
        <stop offset="1" stop-color="#0b0a09"></stop>
      </radialGradient>
    </defs>
  </svg>`;

export async function renderBadgeSection(userId, mount) {
  if (!mount) return;
  mount.classList.add('bpa-profile-badge-mount');
  mount.innerHTML = `
    <p class="bpa-profile-badge-msg" role="status">
      <span class="bpa-profile-badge-spinner bpa-spin" aria-hidden="true"></span>
      ${escapeHtml(tr('Loading badges…', 'Đang tải huy hiệu…'))}
    </p>`;

  let badges;
  try {
    badges = await badgeApi.forUser(userId);
  } catch (err) {
    mount.innerHTML = `<p class="bpa-profile-badge-msg is-error" role="alert">${escapeHtml(err.message || tr('Could not load badges.', 'Không tải được huy hiệu.'))}</p>`;
    return;
  }

  const list = Array.isArray(badges) ? badges : [];
  if (list.length === 0) {
    mount.innerHTML = `<p class="bpa-profile-badge-msg">${escapeHtml(tr('No badges to show yet.', 'Chưa có huy hiệu nào.'))}</p>`;
    return;
  }

  const earnedCount = list.filter((b) => b.earned).length;
  const countText = tr(`${earnedCount} / ${list.length} earned`, `${earnedCount} / ${list.length} đã đạt`);
  mount.innerHTML = `
    ${DEFS_SVG}
    <div class="bpa-profile-badge-count">
      <span class="bpa-profile-badge-dots" aria-hidden="true">${list.map((b) => `<span${b.earned ? '' : ' class="is-off"'}></span>`).join('')}</span>
      <span class="bpa-profile-badge-total">${escapeHtml(countText)}</span>
    </div>
    <ul class="bpa-profile-badges">${list.map(badgeCard).join('')}</ul>`;

  // Render lucide icons inside this section (best-effort; the cabinet still reads fine without them).
  try {
    createIcons({ icons: ICONS, root: mount, attrs: { class: 'bpa-profile-medal-glyph-svg', 'aria-hidden': 'true' } });
  } catch {
    /* icons are decorative */
  }
}

function medalSvg(earned, index) {
  if (!earned) {
    return `
      <svg class="bpa-profile-medal-art" viewBox="0 0 96 124" aria-hidden="true" focusable="false">
        <path d="M30 0H66V40L48 51L30 40Z" fill="#221e1a"></path>
        <path d="M43 0H53V47.9L48 51L43 47.9Z" fill="#2f2a24"></path>
        <path d="M30 0H66V6H30Z" fill="rgba(0,0,0,.35)"></path>
        <circle cx="48" cy="55" r="5.5" fill="none" stroke="#4a443b" stroke-width="2.4"></circle>
        <circle cx="48" cy="91" r="31" fill="url(#bpa-profile-g-dim)" stroke="#3b352d" stroke-width="2"></circle>
        <path d="M23.5 108a31 31 0 0 0 49 0" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="2"></path>
        <circle cx="48" cy="91" r="25" fill="none" stroke="rgba(239,212,134,.2)" stroke-width="1.2" stroke-dasharray="3 3"></circle>
        <g transform="translate(70 111)">
          <circle r="10.5" fill="#0d1014" stroke="#b3a794" stroke-width="1.4"></circle>
          <rect x="-4.5" y="-1.5" width="9" height="7" rx="1.2" fill="#b3a794"></rect>
          <path d="M-2.8 -1.5V-3.8a2.8 2.8 0 0 1 5.6 0V-1.5" fill="none" stroke="#b3a794" stroke-width="1.5"></path>
        </g>
      </svg>`;
  }
  const [ribbon, stripe] = RIBBONS[index % RIBBONS.length];
  return `
    <svg class="bpa-profile-medal-art" viewBox="0 0 96 124" aria-hidden="true" focusable="false">
      <path d="M30 0H66V40L48 51L30 40Z" fill="${ribbon}"></path>
      <path d="M43 0H53V47.9L48 51L43 47.9Z" fill="${stripe}"></path>
      <path d="M30 0H66V6H30Z" fill="rgba(0,0,0,.35)"></path>
      <circle cx="48" cy="55" r="5.5" fill="none" stroke="#c7a24b" stroke-width="2.4"></circle>
      <circle cx="48" cy="91" r="31" fill="url(#bpa-profile-g-gold)" stroke="#5e4a1c" stroke-width="2"></circle>
      <circle cx="48" cy="91" r="25" fill="none" stroke="#8a6e2e" stroke-width="1.4"></circle>
      <circle cx="48" cy="91" r="28" fill="none" stroke="rgba(255,241,194,.5)" stroke-width="1" stroke-dasharray="1.2 2.8"></circle>
    </svg>`;
}

function badgeCard(b, index) {
  const earned = !!b.earned;
  const tooltip = earned ? (b.earnedContext || b.name) : b.description;
  const state = earned
    ? `${CHECK_SVG}${escapeHtml(tr('Earned', 'Đã đạt'))}`
    : `${LOCK_SVG}${escapeHtml(tr('Locked', 'Chưa đạt'))}`;
  const context = earned && b.earnedContext
    ? `<span class="bpa-profile-badge-context">${escapeHtml(b.earnedContext)}</span>`
    : '';
  return `
    <li class="bpa-profile-badge ${earned ? 'is-earned' : 'is-locked'}" title="${escapeHtml(tooltip)}">
      <span class="bpa-profile-medal" aria-hidden="true">
        ${medalSvg(earned, index)}
        <span class="bpa-profile-medal-glyph"><i data-lucide="${escapeHtml(b.iconKey)}"></i></span>
      </span>
      <h3 class="bpa-profile-badge-name">${escapeHtml(b.name)}</h3>
      <span class="bpa-profile-badge-state">${state}</span>
      ${b.description ? `<p class="bpa-profile-badge-desc">${escapeHtml(b.description)}</p>` : ''}
      ${context}
    </li>`;
}
