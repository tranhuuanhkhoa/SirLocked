import { SPR, drawDragon, drawPhoenixFront, drawWing } from './lib.js';
import { warmChime } from './chime.js';
import { installTitleDefs } from './titles.js';

export { AVS, avatarFor, avatarImg } from './avatars.js';
export { EN, ENTRANCES } from './fx.js';
export { FR, GROUPS, LV_FRAMES, forgetCanvas, paintFrame } from './frames.js';
export { applyCosmetic, applyCosmeticCatalog, cosmeticDefaults, entranceList, frameGroups, isKnownCosmetic, isRetired, loadCosmeticCatalog, loadCosmeticsIfUnknown, titleList, xpRates } from './catalog.js';
export { closeStage, openStage } from './stage.js';
export { T, TITLES, setPlaqueMotion, titleHTML } from './titles.js';
export { reduce } from './lib.js';
export { chime } from './chime.js';

/** Rarity of the prototype: `common`, `rare`, `myth`, `leg`, `gold`. Colours come from the approved design. */
export const RAR = {
  common: { n: 'Thường', en: 'Common', c: '#9AA3B2' },
  rare: { n: 'Hiếm', en: 'Rare', c: '#5B8BE6' },
  myth: { n: 'Quý', en: 'Epic', c: '#A270F2' },
  leg: { n: 'Huyền thoại', en: 'Legendary', c: '#E2503F' },
  gold: { n: 'Bí ẩn', en: 'Mystery', c: '#E8B53A' },
};

export const RARITY_OF_SERVER = { COMMON: 'common', RARE: 'rare', EPIC: 'myth', LEGENDARY: 'leg', MYSTERY: 'gold' };
export const rarOf = (serverRarity) => RAR[RARITY_OF_SERVER[serverRarity]] ?? RAR.common;

/* The server's ids carry the category as a prefix; the drawing code knows the bare names. */
export const FRAME_PREFIX = 'frame_';
export const TITLE_PREFIX = 'title_';
export const ENTRANCE_PREFIX = 'entrance_';
const bare = (defId, prefix, fallback) => (defId?.startsWith(prefix) ? defId.slice(prefix.length) : fallback);
export const frameKey = (defId) => bare(defId, FRAME_PREFIX, 'none');
export const titleKey = (defId) => bare(defId, TITLE_PREFIX, 'tan-binh');
export const entranceKey = (defId) => bare(defId, ENTRANCE_PREFIX, 'lang-le');

let prepared = false;
let warmed = false;

/** Plaque defs, because plaques are about to be shown. Idempotent. */
export function prepareCosmetics() {
  if (prepared) return;
  prepared = true;
  installTitleDefs();
}

const idle = (work) => ('requestIdleCallback' in window ? requestIdleCallback(work, { timeout: 1500 }) : setTimeout(work, 100));

/**
 * So the first entrance plays without pop-in. Only where one can play, and one sprite at a time when the page has a
 * moment: decoding these is slow enough that doing them together would be felt. Idempotent.
 */
export function warmEntranceArt() {
  if (warmed) return;
  warmed = true;
  const c = document.createElement('canvas').getContext('2d');
  const steps = [
    () => drawDragon(c, [[0, 0], [100, 0]], { w: 30 }),
    () => drawPhoenixFront(c, 0, 0, 90, 0),
    () => drawWing(c, 0, 0, 1, 190, 0, 'dark'),
    ...[0, 1, 2].flatMap((i) => [() => SPR.smoke(i, '26,28,36', 256), () => SPR.smoke(i, '210,218,232', 128)]),
    () => SPR.smoke(1, '60,0,8', 256),
    () => SPR.fea('dark', 'cov', 64),
    // Browsers only let audio start after a click, so before that it would be wasted work and a console warning.
    () => { if (navigator.userActivation?.hasBeenActive) warmChime(); },
  ];
  const next = () => {
    steps.shift()?.();
    if (steps.length > 0) idle(next);
  };
  idle(next);
}

/** A plaque's width comes from the text, so anything showing one redraws when the title font arrives. */
export function whenTitleFontReady() {
  return document.fonts?.load ? document.fonts.load('700 19px "Cormorant SC"').catch(() => {}) : Promise.resolve();
}
