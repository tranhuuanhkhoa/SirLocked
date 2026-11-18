import { get } from '../api/http.js';
import { FR, GROUPS, defineFrame, refreshFrame } from './frames.js';
import { ENTRANCES, EN, defineEntrance } from './fx.js';
import { ENTRANCE_PREFIX, FRAME_PREFIX, RARITY_OF_SERVER, TITLE_PREFIX } from './index.js';
import { T, TITLES, defineTitle } from './titles.js';

/*
 * Cosmetics are described by the server (visual, in docs/admin-cosmetics.md); this turns those descriptions into the
 * tables the drawing code reads: FR, T, EN. What ships with the game keeps its drawing and only takes the name, the
 * rarity and how it is obtained. Until the first answer arrives, or when it cannot arrive, the tables hold what ships.
 */
const FRESH_MS = 60_000;
const UNKNOWN_RETRY_MS = 10_000;
const RGB = /^(\d{1,3}),(\d{1,3}),(\d{1,3})$/;
const FALL_KINDS = new Set(['snow', 'petal', 'rose', 'feather']);
const PARTICLES = new Set(['tw', 'rise', 'leaf', 'snow', 'petal', 'smoke', 'ember', 'feather', 'wfeather']);
const URL_OK = /^(https:\/\/|\/assets\/)[^\s"'<>()\\]+$/;
const GROUP_OF_RARITY = { common: 1, rare: 1, myth: 1, leg: 2, gold: 3 };
const DEFAULTS = Object.freeze({ frame: 'none', title: 'tan-binh', entrance: 'lang-le' });

const METRIC_TEXT = {
  Played: (n) => `Chơi ${n} vụ`,
  Won: (n) => `Thắng ${n} vụ`,
  MidnightWins: (n) => (n > 1 ? `Phá ${n} án lúc nửa đêm` : 'Phá án lúc nửa đêm'),
  NoHintWins: (n) => (n > 1 ? `Phá ${n} án không dùng gợi ý` : 'Phá án không dùng gợi ý'),
  CluesFound: (n) => `Tìm ${n} manh mối`,
  TestimoniesRecorded: (n) => `Ghi ${n} lời khai`,
  OwnsWatch217: () => 'Sở hữu Đồng hồ 2:17',
};

let defaults = { ...DEFAULTS };
let rates = { rare: 150, epic: 600 };
const retired = new Set();
const madeFrames = new Map();
let loading = null;
let loadedAt = 0;
let askedForUnknownAt = 0;

/* ---- what the server sent is checked again here: a value that reaches a canvas colour stop unchecked stops the whole paint ---- */

export const cleanRgb = (value) => {
  const match = typeof value === 'string' ? value.match(RGB) : null;
  return match && [1, 2, 3].every((group) => Number(match[group]) <= 255) ? value : null;
};
const inRange = (value, min, max) => (typeof value === 'number' && value >= min && value <= max ? value : null);
const cleanUrl = (value) => (typeof value === 'string' && URL_OK.test(value) ? value : null);

function cleanLive(live) {
  if (!live || typeof live !== 'object') return null;
  const out = {};
  const pair = (key, min, max) => {
    const entry = live[key];
    if (Array.isArray(entry) && cleanRgb(entry[0]) && inRange(entry[1], min, max) !== null) out[key] = [entry[0], entry[1]];
  };
  pair('aura', 0, 0.6);
  pair('rays', 0, 0.4);
  pair('spark', 1, 10);
  pair('embers', 1, 16);
  const { comet, fall, flame, breathe } = live;
  if (Array.isArray(comet) && cleanRgb(comet[0]) && inRange(comet[1], 0.02, 0.6) !== null && inRange(comet[2], 1, 4) !== null) out.comet = [comet[0], comet[1], comet[2]];
  if (Array.isArray(fall) && FALL_KINDS.has(fall[0]) && inRange(fall[1], 1, 16) !== null) out.fall = [fall[0], fall[1]];
  if (flame === 1) out.flame = 1;
  if (inRange(breathe, 0, 0.03) !== null) out.breathe = breathe;
  return out;
}

function cleanSheen(sheen) {
  if (!sheen || !cleanRgb(sheen.rgb) || inRange(sheen.a, 0, 1) === null) return null;
  return { rgb: sheen.rgb, a: sheen.a, period: inRange(sheen.period, 2, 20) ?? 7, conic: sheen.conic === true };
}

function cleanParts(parts) {
  if (!Array.isArray(parts)) return null;
  return parts.filter((row) => Array.isArray(row) && PARTICLES.has(row[0]) && inRange(row[1], 1, 12) !== null && cleanRgb(row[2])).map((row) => [row[0], row[1], row[2]]);
}

/* ---- the words for "how to get it", the same words the prototype wrote by hand ---- */

function howText(entry, fallback, levelWord) {
  if (entry.isDefault) return 'Mặc định';
  if (entry.level) return `${levelWord} ${entry.level}`;
  if (entry.metric && METRIC_TEXT[entry.metric]) return METRIC_TEXT[entry.metric](entry.target);
  // Listed as an achievement, but nothing counts it yet.
  if (entry.target && !entry.achievementCountable) return fallback ?? 'Chưa mở';
  const chests = entry.chests ?? [];
  if (chests.length === 0) return 'Chỉ admin cấp';
  const everywhere = chests.length === entry.activeChestCount && chests.length > 1;
  if (entry.rarity === 'MYSTERY') return `Bí ẩn · ${everywhere ? 'mọi hòm' : chests.join(', ')}`;
  return `Ra từ ${chests.join(', ')}`;
}

/* ---- one entry into the drawing tables ---- */

const bareId = (id, prefix) => (id?.startsWith(prefix) ? id.slice(prefix.length) : null);

function applyFrame(entry, rar) {
  const key = bareId(entry.id, FRAME_PREFIX);
  if (!key) return;
  const visual = entry.visual;
  const params = visual?.params ?? {};
  const shipped = FR[key] && !FR[key].made;
  const looks = { name: entry.name, rar, src: howText(entry, FR[key]?.src, 'Cấp'), lv: entry.level ?? undefined };
  if (shipped && (!visual?.builtinId || visual.builtinId === key)) {
    refreshFrame(key, looks);
    return;
  }
  const effects = { live: 'live' in params ? cleanLive(params.live) : undefined, sheen: 'sheen' in params ? cleanSheen(params.sheen) : undefined };
  if (visual?.template === 'painted' && cleanUrl(visual.imageUrl) && inRange(params.hole?.r, 0.001, 20000) !== null) {
    defineFrame(key, { ...looks, ...effects, imageUrl: visual.imageUrl, hole: params.hole, scale: inRange(params.scale, 0.5, 1.5) ?? 1, glowUrl: cleanUrl(params.glowUrl) });
  } else {
    // A clone, a shipped drawing under another id, or a picture that cannot be used: the fallback is the plain ring.
    const base = visual?.template === 'builtin-clone' ? params.base : visual?.builtinId;
    defineFrame(key, { ...looks, ...effects, base: FR[base] && !FR[base].made ? base : 'none' });
  }
  madeFrames.set(key, entry.level ? 0 : GROUP_OF_RARITY[rar]);
}

/** A box inside a picture, in fractions of it, or null. */
function cleanBox(box) {
  if (!box || typeof box !== 'object') return null;
  const x = inRange(box.x, 0, 1), y = inRange(box.y, 0, 1), w = inRange(box.w, 0.02, 1), h = inRange(box.h, 0.02, 1);
  return x !== null && y !== null && w !== null && h !== null && x + w <= 1.0001 && y + h <= 1.0001 ? { x, y, w, h } : null;
}

/** A nameplate painted from an uploaded picture (template "painted"), or null when it cannot be drawn. */
export function paintedTitleOf(visual) {
  if (visual?.template !== 'painted') return null;
  const params = visual.params ?? {};
  const url = cleanUrl(visual.imageUrl);
  const w = inRange(params.size?.w, 8, 8000), h = inRange(params.size?.h, 8, 8000);
  const baked = params.textBaked === true;
  const box = baked ? null : cleanBox(params.box);
  if (!url || w === null || h === null || (!baked && !box)) return null;
  return { url, w, h, box, baked, color: cleanRgb(params.color), scale: inRange(params.scale, 0.5, 2) ?? 1 };
}

function applyTitle(entry, rar) {
  const key = bareId(entry.id, TITLE_PREFIX);
  if (!key) return;
  const params = entry.visual?.params ?? {};
  const shipped = T[key] && !T[key].made;
  const styled = entry.visual?.template === 'style';
  const pic = shipped ? null : paintedTitleOf(entry.visual);
  const own = styled || Boolean(pic);
  defineTitle(key, {
    n: entry.name,
    r: rar,
    src: howText(entry, T[key]?.src, 'Đạt cấp'),
    made: !shipped,
    sty: styled ? params.style : T[key]?.sty,
    glow: own ? cleanRgb(params.glow) : null,
    parts: own ? cleanParts(params.parts) : null,
    pic,
  });
}

const FLIPBOOK_PLACES = ['hero', 'screen', 'across', 'drop'];

/** A flipbook entrance's sheet and how it plays, or null when the sheet cannot be used. */
function flipbookOf(params) {
  const sheetUrl = cleanUrl(params?.sheetUrl);
  if (!sheetUrl) return null;
  const cols = inRange(params.cols, 1, 16) ?? 1, rows = inRange(params.rows, 1, 16) ?? 1;
  return {
    sheetUrl,
    cols,
    rows,
    frames: inRange(params.frames, 1, cols * rows) ?? cols * rows,
    fps: inRange(params.fps, 1, 60) ?? 12,
    loop: params.loop !== false,
    place: FLIPBOOK_PLACES.includes(params.place) ? params.place : 'hero',
    size: inRange(params.size, 0.3, 3) ?? 1,
    blend: params.blend === 'add' ? 'add' : 'normal',
  };
}

function applyEntrance(entry, rar) {
  const key = bareId(entry.id, ENTRANCE_PREFIX);
  if (!key) return;
  const params = entry.visual?.params ?? {};
  const shipped = EN[key] && !EN[key].made;
  const looks = { n: entry.name, r: rar, src: howText(entry, EN[key]?.src, 'Đạt cấp') };
  // Empty on the server means "write it from the chests", which says nothing about the effect itself.
  const own = entry.description && !entry.description.startsWith('Hiệu ứng vào sảnh.') ? entry.description : '';
  if (shipped) {
    Object.assign(EN[key], looks, own ? { d: own } : {});
    return;
  }
  defineEntrance(key, {
    ...looks,
    d: own,
    tpl: entry.visual?.template,
    tint: cleanRgb(params.tint),
    imageUrl: cleanUrl(params.imageUrl),
    swordUrl: cleanUrl(params.swordUrl),
    duration: inRange(params.duration, 4, 12),
    flip: entry.visual?.template === 'flipbook' ? flipbookOf(params) : null,
  });
}

/** Draws one definition from now on. Reads only what it is given, so a chest's contents can bring their own. */
export function applyCosmetic(entry) {
  const rar = RARITY_OF_SERVER[entry?.rarity];
  if (!rar) return;
  if (entry.category === 'FRAME') applyFrame(entry, rar);
  else if (entry.category === 'TITLE') applyTitle(entry, rar);
  else if (entry.category === 'ENTRANCE') applyEntrance(entry, rar);
}

/** Takes the whole answer of GET /api/cosmetics/catalog. */
export function applyCosmeticCatalog(catalog) {
  defaults = {
    frame: bareId(catalog.defaults?.frame, FRAME_PREFIX) ?? DEFAULTS.frame,
    title: bareId(catalog.defaults?.title, TITLE_PREFIX) ?? DEFAULTS.title,
    entrance: bareId(catalog.defaults?.entrance, ENTRANCE_PREFIX) ?? DEFAULTS.entrance,
  };
  rates = { rare: catalog.rareXp ?? rates.rare, epic: catalog.epicXp ?? rates.epic };
  retired.clear();
  for (const entry of catalog.items) {
    if (entry.retired) retired.add(entry.id);
    applyCosmetic({ ...entry, isDefault: catalog.defaults && Object.values(catalog.defaults).includes(entry.id) });
  }
}

/** Resolves to true when the tables changed. Never rejects: without an answer the page shows what ships with the game. */
export function loadCosmeticCatalog({ force = false } = {}) {
  if (loading) return loading;
  if (!force && loadedAt && Date.now() - loadedAt < FRESH_MS) return Promise.resolve(false);
  loading = get('/api/cosmetics/catalog')
    .then((catalog) => {
      if (!catalog?.items) return false;
      applyCosmeticCatalog(catalog);
      loadedAt = Date.now();
      return true;
    })
    .catch(() => false)
    .finally(() => { loading = null; });
  return loading;
}

export const isKnownCosmetic = (defId) => {
  const frame = bareId(defId, FRAME_PREFIX);
  if (frame) return !!FR[frame];
  const title = bareId(defId, TITLE_PREFIX);
  if (title) return !!T[title];
  const entrance = bareId(defId, ENTRANCE_PREFIX);
  return entrance ? !!EN[entrance] : true;
};

/** Someone may wear what was made after this page loaded. Asks again, but not on every redraw. Resolves to true when the tables changed. */
export function loadCosmeticsIfUnknown(defIds) {
  if (defIds.every((defId) => !defId || isKnownCosmetic(defId))) return Promise.resolve(false);
  if (loading) return loading;
  if (Date.now() - askedForUnknownAt < UNKNOWN_RETRY_MS) return Promise.resolve(false);
  askedForUnknownAt = Date.now();
  return loadCosmeticCatalog({ force: true });
}

export const cosmeticDefaults = () => defaults;
export const xpRates = () => rates;
export const isRetired = (defId) => retired.has(defId);

/* ---- the lists a detective sees: retired items only for whoever still has them ---- */

export function frameGroups(owns) {
  const visible = (id) => !retired.has(FRAME_PREFIX + id) || owns(FRAME_PREFIX + id);
  // With a real default frame there is no way back to no frame at all, so that tile would only mislead.
  const shown = (id) => visible(id) && (id !== 'none' || defaults.frame === 'none');
  return GROUPS
    .map(([label, ids], index) => [label, [...ids, ...[...madeFrames].filter(([, group]) => group === index).map(([id]) => id)].filter(shown)])
    .filter(([, ids]) => ids.length > 0);
}

export const titleList = (owns) => TITLES.filter((title) => !retired.has(TITLE_PREFIX + title.id) || owns(TITLE_PREFIX + title.id));

export const entranceList = (owns) => ENTRANCES.filter((entry) => !retired.has(ENTRANCE_PREFIX + entry.id) || owns(ENTRANCE_PREFIX + entry.id));
