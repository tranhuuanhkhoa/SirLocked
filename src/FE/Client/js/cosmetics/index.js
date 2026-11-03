import { SPR, drawDragon, drawPhoenixFront, drawWing } from './lib.js';
import { installTitleDefs, wingCss } from './titles.js';

export { AVS, avatarFor, avatarImg } from './avatars.js';
export { EN, ENTRANCES } from './fx.js';
export { FR, GROUPS, LV_FRAMES, paintFrame } from './frames.js';
export { closeStage, openStage } from './stage.js';
export { T, TITLES, titleHTML } from './titles.js';
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

const RARITY_OF_SERVER = { COMMON: 'common', RARE: 'rare', EPIC: 'myth', LEGENDARY: 'leg', MYSTERY: 'gold' };
export const rarOf = (serverRarity) => RAR[RARITY_OF_SERVER[serverRarity]] ?? RAR.common;

/* The server's ids carry the category as a prefix; the drawing code knows the bare names. */
export const FRAME_PREFIX = 'frame_';
export const TITLE_PREFIX = 'title_';
export const ENTRANCE_PREFIX = 'entrance_';
const bare = (defId, prefix, fallback) => (defId?.startsWith(prefix) ? defId.slice(prefix.length) : fallback);
export const frameKey = (defId) => bare(defId, FRAME_PREFIX, 'none');
export const titleKey = (defId) => bare(defId, TITLE_PREFIX, 'tan-binh');
export const entranceKey = (defId) => bare(defId, ENTRANCE_PREFIX, 'lang-le');

const WING_RETRY_MS = 250;
const WING_RETRIES = 40;
let prepared = false;

/** Plaque defs, painted ornaments and the sprite cache; idempotent, and cheap to call on every page that shows cosmetics. */
export function prepareCosmetics() {
  if (prepared) return;
  prepared = true;
  installTitleDefs();
  // Warm the sprite cache so the first entrance plays without pop-in.
  const c = document.createElement('canvas').getContext('2d');
  drawDragon(c, [[0, 0], [100, 0]], { w: 30 });
  drawPhoenixFront(c, 0, 0, 90, 0);
  drawWing(c, 0, 0, 1, 190, 0, 'dark');
  for (let i = 0; i < 3; i++) { SPR.smoke(i, '26,28,36', 256); SPR.smoke(i, '210,218,232', 128); }
  SPR.smoke(1, '60,0,8', 256);
  SPR.fea('dark', 'cov', 64);
  // The wing ornaments of the gold titles are drawn from the living art once its sprites are ready.
  let tries = 0;
  const installWings = () => {
    if (wingCss() || ++tries >= WING_RETRIES) return;
    setTimeout(installWings, WING_RETRY_MS);
  };
  installWings();
}

/** A plaque's width comes from the text, so anything showing one redraws when the title font arrives. */
export function whenTitleFontReady() {
  return document.fonts?.load ? document.fonts.load('700 19px "Cormorant SC"').catch(() => {}) : Promise.resolve();
}
