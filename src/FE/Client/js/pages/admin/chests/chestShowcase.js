import { escapeHtml } from '../../../utils/dom.js';

/*
 * A chest made for a collection gets a showcase in the admin: its own night scene, a legend ribbon and the outfits it
 * pays out, so it stands apart from the everyday chests at a glance. Chosen by the chest's drawing (look.template),
 * so a chest an admin clones from it, or switches to that drawing, looks the same.
 */
const SHOWCASES = {
  whitechapel: {
    ribbon: 'Bộ sưu tập Huyền thoại',
    era: 'Đêm Whitechapel · 1888',
    figures: [
      { src: '/assets/pixel/skins/whitechapel/icon-sherlock.png', name: 'Sherlock · Kẻ Săn Bóng Đêm' },
      { src: '/assets/pixel/skins/whitechapel/icon-watson.png', name: 'Watson · Bác Sĩ Mỏ Quạ' },
    ],
  },
};

export const showcaseOf = (chest) => SHOWCASES[chest?.look?.template] ?? null;

/** The night behind the chest: blood moon, rooftops with lit windows (drawn in the stylesheet), gaslight, fog. Purely decorative. */
export const showcaseSky = () => `
  <span class="ac-show-sky" aria-hidden="true">
    <i class="ac-show-moon"></i>
    <i class="ac-show-roofs"></i>
    <i class="ac-show-gas ac-show-gas--l"></i><i class="ac-show-gas ac-show-gas--r"></i>
    <i class="ac-show-fog"></i><i class="ac-show-fog ac-show-fog--2"></i>
  </span>`;

/** One outfit standing by the chest, on its left (`l`) or right (`r`). */
export const showcaseFigure = (figure, side) =>
  `<img class="ac-show-figure ac-show-figure--${side}" src="${escapeHtml(figure.src)}" alt="" title="${escapeHtml(figure.name)}" draggable="false">`;

/** The outfits standing by the chest: the first on its left, the others on its right. */
export const showcaseFigures = (showcase) => showcase.figures.map((figure, index) => showcaseFigure(figure, index ? 'r' : 'l')).join('');

export const showcaseRibbon = (showcase) =>
  `<span class="ac-show-ribbon"><span aria-hidden="true">✦</span> ${escapeHtml(showcase.ribbon)} <span aria-hidden="true">✦</span></span>`;
