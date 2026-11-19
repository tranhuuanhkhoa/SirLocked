/**
 * The lobby's outfit strip: once a player has a role, the outfits of that role's detective (Thẩm vấn viên = Sherlock,
 * Điều tra viên = Watson). "Thường" is the normal look; an owned outfit is worn with one click (the same slot as
 * "Dùng" in Kho đồ); an outfit the player does not have is shown locked with the chest it comes from. Which outfit is
 * worn always comes from the room the server sent (players[].skinDefIds), never from what was clicked.
 */
import { escapeHtml } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { NORMAL_LOOK, lookFor } from '../game/outfitPreview.ts';
import { PLAYER_SKINS, SKIN_CATEGORY_OF_ROLE } from '../game/playerSkins.ts';

export const DETECTIVE_OF_ROLE = { INTERROGATOR: 'Sherlock', INVESTIGATOR: 'Watson' };

const LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="10.5" width="16" height="11" rx="1.5"></rect><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"></path></svg>';
const OUT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 5h5v5"></path><path d="M19 5l-8 8"></path><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"></path></svg>';

/** Said to screen readers only: the links leave the lobby open in this tab. */
const NEW_TAB = () => `<span class="bpa-sr"> (${tr('opens in a new tab', 'mở trong tab mới')})</span>`;

/** "Sherlock · Kẻ Săn Bóng Đêm" → "Kẻ Săn Bóng Đêm": the strip's heading already names the detective. */
const shortName = (name) => {
  const parts = String(name ?? '').split(' · ');
  return parts.length > 1 ? parts.slice(1).join(' · ') : parts[0];
};
const defName = (def) => tr(def?.nameEn || def?.name || '', def?.name || def?.nameEn || '');

/** Every def the client knows by id: chest contents (to name outfits the player lacks) and the player's own items. */
function knownDefs({ inventory, chests }) {
  const defs = new Map();
  for (const chest of [...(chests?.chests ?? []), ...(chests?.offSale ?? [])]) for (const def of chest?.contents ?? []) if (def?.id) defs.set(def.id, def);
  for (const item of inventory?.items ?? []) if (item?.def?.id) defs.set(item.def.id, item.def);
  return defs;
}

/** The chest an outfit drops from, for the "Có trong …" line; null when no chest pays it out. */
function sourceChest(defId, chests) {
  return [...(chests?.chests ?? []), ...(chests?.offSale ?? [])].find((chest) => (chest?.contents ?? []).some((def) => def?.id === defId)) ?? null;
}

/**
 * What the strip offers for a role.
 * Card states: `free` (wearable: Thường or an owned outfit), `listed` (every copy is for sale), `busy` (every copy is in
 * a trade or another operation), `locked` (not owned).
 */
export function outfitChoices(role, { inventory, chests, skinDefIds }) {
  const category = SKIN_CATEGORY_OF_ROLE[role];
  if (!category) return null;
  const defs = knownDefs({ inventory, chests });
  const cards = [{ look: NORMAL_LOOK, state: 'free', itemId: null, name: tr('Classic', 'Thường') }];
  for (const skin of Object.values(PLAYER_SKINS)) {
    if (skin.category !== category) continue;
    const def = defs.get(skin.defId);
    if (!def) continue; // nothing to name it with yet
    const copies = (inventory?.items ?? []).filter((item) => item?.def?.id === skin.defId);
    const free = copies.filter((item) => !item.locked).sort((a, b) => Number(b.equipped) - Number(a.equipped));
    const state = free.length ? 'free' : copies.length === 0 ? 'locked' : copies.some((item) => item.lockReason === 'LISTED') ? 'listed' : 'busy';
    cards.push({ look: skin.defId, state, itemId: free[0]?.itemId ?? null, name: shortName(defName(def)), fullName: defName(def), chest: sourceChest(skin.defId, chests) });
  }
  return { category, detective: DETECTIVE_OF_ROLE[role], worn: lookFor(role, skinDefIds), cards };
}

/** A seat card's accessible name for its figure: "Sherlock · Kẻ Săn Bóng Đêm" or "Sherlock · trang phục thường". */
export function figureLabel(role, look, wardrobe) {
  const detective = DETECTIVE_OF_ROLE[role] ?? '';
  if (look === NORMAL_LOOK) return `${detective} · ${tr('classic outfit', 'trang phục thường')}`;
  const def = knownDefs(wardrobe).get(look);
  return `${detective} · ${def ? shortName(defName(def)) : tr('outfit', 'trang phục')}`;
}

const noteOf = (card, worn) => {
  if (card.look === worn) return `<span class="bpa-lobby-outfit-note is-worn">${tr('Wearing', 'Đang mặc')}</span>`;
  if (card.state === 'listed') return `<span class="bpa-lobby-outfit-note">${tr('For sale', 'Đang rao bán')}</span>`;
  if (card.state === 'busy') return `<span class="bpa-lobby-outfit-note">${tr('In a trade', 'Đang giao dịch')}</span>`;
  if (card.state === 'locked') return `<span class="bpa-lobby-outfit-note">${LOCK}${tr('Not owned', 'Chưa có')}</span>`;
  return '';
};

/** The strip's markup; `busy` while a change is on its way (every card waits for the server's answer). */
export function outfitStripHTML(choices, { busy = false } = {}) {
  if (!choices) return '';
  const cards = choices.cards.map((card) => {
    const worn = card.look === choices.worn;
    const unusable = card.state !== 'free';
    const classes = ['bpa-lobby-outfit', worn ? 'is-worn' : '', card.state === 'locked' ? 'is-locked' : '', unusable && card.state !== 'locked' ? 'is-held' : ''].filter(Boolean).join(' ');
    return `
      <button type="button" class="${classes}" data-outfit="${escapeHtml(card.look)}" aria-pressed="${worn}"${unusable || busy ? ' aria-disabled="true"' : ''}>
        <span class="bpa-lobby-outfit-stage"><canvas class="bpa-lobby-outfit-pv" data-outfit-preview="${escapeHtml(card.look)}" aria-hidden="true"></canvas></span>
        <span class="bpa-lobby-outfit-name">${escapeHtml(card.name)}</span>
        ${noteOf(card, choices.worn)}
      </button>`;
  }).join('');
  const sources = choices.cards.filter((card) => card.state === 'locked').map((card) => {
    const where = card.chest
      ? tr(`Found in the ${card.chest.nameEn || card.chest.name}`, `Có trong ${card.chest.name || card.chest.nameEn}`)
      : tr('Traded on the market', 'Có trên chợ đồ');
    const query = encodeURIComponent(card.fullName);
    return `
      <p class="bpa-lobby-outfit-src"><span class="bpa-lobby-outfit-lock">${LOCK}</span><strong>${escapeHtml(card.name)}</strong> · ${escapeHtml(where)}
        ${card.chest ? `· <a class="bpa-link bpa-link--gold" href="/kho-ruong" target="_blank" rel="noopener">${tr('Chest Vault', 'Kho Rương')}${OUT}${NEW_TAB()}</a>` : ''}
        · <a class="bpa-link bpa-link--gold" href="/market?q=${query}" target="_blank" rel="noopener">${tr('See prices on the market', 'Xem giá trên chợ')}${OUT}${NEW_TAB()}</a></p>`;
  }).join('');
  return `
    <div class="bpa-lobby-outfits" data-outfit-strip${busy ? ' aria-busy="true"' : ''}>
      <h3 class="bpa-lobby-outfits-h" id="lobby-outfits-h">${tr('Outfit', 'Trang phục')} · ${escapeHtml(choices.detective)}</h3>
      <div class="bpa-lobby-outfit-row" role="group" aria-labelledby="lobby-outfits-h">${cards}</div>
      ${sources}
    </div>`;
}
