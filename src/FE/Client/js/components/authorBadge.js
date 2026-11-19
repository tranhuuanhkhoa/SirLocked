// VUAN-7: the "Tác giả" badge of a VIP author (case cards, the case page, the detective profile).
import { escapeHtml } from '../utils/dom.js';
import { tr } from '../services/i18n.js';

const TIERS = {
  AUTHOR: ['Author', 'Tác giả'],
  SILVER: ['Loved author', 'Tác giả được yêu thích'],
  GOLD: ['Gold author', 'Tác giả vàng'],
};

/** The badge for a tier; an author name is added when given ("Tác giả: Minh"). Empty without a tier. */
export function authorBadge(tier, name = '') {
  const labels = TIERS[tier];
  if (!labels) return '';
  const label = tr(labels[0], labels[1]);
  return `<span class="author-badge" data-tier="${escapeHtml(tier)}" title="${escapeHtml(label)}">✒ ${escapeHtml(name ? `${label}: ${name}` : label)}</span>`;
}
