import { RARITIES } from './shared.js';

/** What a save sends, from what the server answered. Every rarity is spelled out, so the form has a field for each. */
export function draftOf(chest) {
  return {
    name: chest.name,
    nameEn: chest.nameEn,
    subtitle: chest.subtitle,
    subtitleEn: chest.subtitleEn,
    keyName: chest.keyName,
    keyNameEn: chest.keyNameEn,
    chestPrice: chest.chestPrice,
    keyPrice: chest.keyPrice,
    active: chest.active,
    sortOrder: chest.sortOrder,
    challengeWeight: chest.challengeWeight ?? 0,
    look: { ...chest.look },
    dropWeights: Object.fromEntries(RARITIES.map((rarity) => [rarity, chest.dropWeights?.[rarity] ?? 0])),
    pool: (chest.pool ?? []).map((entry) => entry.def.id),
    expectedVersion: chest.version,
  };
}

/** "1,2,3" and "#010203", the stored colour and the one an input speaks. */
export const toHex = (rgb) => `#${String(rgb ?? '').split(',').map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
export const fromHex = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(',');

/** A percentage with up to two decimals, as a weight out of 10,000. Rounding here keeps 79.92 from becoming 7991.999. */
export const weightOf = (percentText) => Math.round(Number(percentText || 0) * 100);
