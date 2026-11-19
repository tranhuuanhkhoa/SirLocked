/**
 * Outfits ("skin") of the two detectives. A skin is an inventory item (category SKIN_SHERLOCK or SKIN_WATSON, see
 * SkinCatalog.cs) that the player puts on in Kho đồ; the game asks the market which skin each player wears and draws
 * that skin's sheets instead of the normal ones. A def id the game does not know, a skin for the other detective or a
 * sheet that has not finished loading all fall back to the normal look, so nothing here can hide a player.
 *
 * Sheets: PixelLab V3 96 px characters laid out like the normal ones, 128 px cells, 13 columns:
 * row 0 the eight rotations, rows 1-4 idle (south, east, north, west, 9 frames), rows 5-8 walking (8 frames),
 * rows 9-12 the signature move (13 frames).
 */
import { PIXEL_PLAYER_SHEETS, type Cardinal, type Facing, type PixelActorSheet, type PixelClip } from './pixelActors.js';

export type SkinRole = 'INTERROGATOR' | 'INVESTIGATOR';
export type SkinCategory = 'SKIN_SHERLOCK' | 'SKIN_WATSON';
export type SkinVariant = 'day' | 'night';
/** Native-pixel offset from the feet (the sheet pivot) to a point on the body, per clip direction. */
export type BodyAnchors = Record<Cardinal, { x: number; y: number }>;

export type PlayerSkin = {
  defId: string;
  role: SkinRole;
  category: SkinCategory;
  /** A skin with a night variant swaps sheets with the scene's time of day; otherwise `day` is used everywhere. */
  sheets: { day: PixelActorSheet; night?: PixelActorSheet };
};

export const SKIN_CATEGORY_OF_ROLE: Record<SkinRole, SkinCategory> = { INTERROGATOR: 'SKIN_SHERLOCK', INVESTIGATOR: 'SKIN_WATSON' };
export const SKIN_CATEGORIES: readonly SkinCategory[] = ['SKIN_SHERLOCK', 'SKIN_WATSON'];

const COLUMNS = 13;
const CELL = 128;
const FOLDER = '/assets/pixel/skins/whitechapel/';
/** Stand still this long and the signature move plays, then again after the same wait. */
export const SIGNATURE_IDLE_MS = 10_000;

const range = (start: number, count: number) => Array.from({ length: count }, (_, index) => start + index);
const DIRECTIONS: Cardinal[] = ['south', 'east', 'north', 'west'];
const clips = (texture: string, firstRow: number, count: number, fps: number, loop: boolean) =>
  Object.fromEntries(DIRECTIONS.map((direction, index) =>
    [direction, { texture, frames: range((firstRow + index) * COLUMNS, count), fps, loop }])) as Record<Cardinal, PixelClip>;

function whitechapelSheet(key: string, file: string, pivotY: number, extra: Partial<PixelActorSheet>): PixelActorSheet {
  return {
    textures: [{ key, url: FOLDER + file, columns: COLUMNS }],
    cell: CELL,
    pivot: { x: 64, y: pivotY },
    standing: Object.fromEntries((['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'] as const)
      .map((facing, frame) => [facing, { texture: key, frame }])) as PixelActorSheet['standing'],
    clips: {
      idle: clips(key, 1, 9, 6, true),
      walking: clips(key, 5, 8, 10, true),
      signature: clips(key, 9, 13, 8, false),
    },
    idleDelayMs: SIGNATURE_IDLE_MS,
    ...extra,
  };
}

/** Measured on the sheets: the lantern Sherlock carries at night, and the beak of Watson's mask. */
export const LANTERN_ANCHORS: BodyAnchors = { south: { x: 15, y: -54 }, east: { x: 6, y: -58 }, north: { x: -23, y: -45 }, west: { x: -12, y: -47 } };
export const BEAK_ANCHORS: BodyAnchors = { south: { x: 2, y: -60 }, east: { x: 18, y: -62 }, north: { x: 0, y: -68 }, west: { x: -18, y: -62 } };

export const PLAYER_SKINS: Record<string, PlayerSkin> = {
  skin_sherlock_whitechapel: {
    defId: 'skin_sherlock_whitechapel',
    role: 'INTERROGATOR',
    category: 'SKIN_SHERLOCK',
    sheets: {
      day: whitechapelSheet('skin-whitechapel-sherlock-day', 'sherlock-day.png', 109, { signatureEffect: 'footprints' }),
      night: whitechapelSheet('skin-whitechapel-sherlock-night', 'sherlock-night.png', 109, { signatureEffect: 'footprints', lantern: LANTERN_ANCHORS }),
    },
  },
  skin_watson_whitechapel: {
    defId: 'skin_watson_whitechapel',
    role: 'INVESTIGATOR',
    category: 'SKIN_WATSON',
    sheets: {
      day: whitechapelSheet('skin-whitechapel-watson', 'watson.png', 104, { signatureEffect: 'herbal-smoke', effectAnchors: BEAK_ANCHORS }),
    },
  },
};

/** Dusk and night light the lantern; day and a scene without a time of day do not. */
export function skinVariant(timeOfDay: unknown): SkinVariant {
  const time = String(timeOfDay ?? '').toUpperCase();
  return time === 'NIGHT' || time === 'DUSK' ? 'night' : 'day';
}

/** The skin a player wears for the role they play in this room, if the game knows it. */
export function skinFor(role: string | null | undefined, wornDefIds: readonly string[] | undefined): PlayerSkin | null {
  if (!role || !wornDefIds?.length) return null;
  for (const defId of wornDefIds) {
    const skin = PLAYER_SKINS[defId];
    if (skin && skin.role === role) return skin;
  }
  return null;
}

/** Every texture a skin may need, both variants: loaded together so day and night swap without a gap. */
export function skinTextures(skin: PlayerSkin): { key: string; url: string }[] {
  const all = [skin.sheets.day, skin.sheets.night].filter((sheet): sheet is PixelActorSheet => Boolean(sheet));
  const seen = new Map<string, string>();
  for (const sheet of all) for (const texture of sheet.textures) seen.set(texture.key, texture.url);
  return [...seen].map(([key, url]) => ({ key, url }));
}

/**
 * The sheet to draw a player with: their skin for this time of day once its textures are in, else the normal sheet
 * of their role. Undefined only for a role without pixel sheets (older cases draw those players another way).
 */
export function resolvePlayerSheet(
  role: string | null | undefined,
  wornDefIds: readonly string[] | undefined,
  timeOfDay: unknown,
  textureReady: (key: string) => boolean,
): PixelActorSheet | undefined {
  const normal = role ? PIXEL_PLAYER_SHEETS[role] : undefined;
  const skin = skinFor(role, wornDefIds);
  if (!skin) return normal;
  const wanted = skinVariant(timeOfDay) === 'night' && skin.sheets.night ? skin.sheets.night : skin.sheets.day;
  return wanted.textures.every((texture) => textureReady(texture.key)) ? wanted : normal;
}

type EquippedEntry = { category?: string; def?: { id?: string } | null };

/** The skin def ids in a GET /api/market/equipped/{userId} answer. */
export function wornSkinIds(equipped: unknown): string[] {
  if (!Array.isArray(equipped)) return [];
  return (equipped as EquippedEntry[])
    .filter((entry) => SKIN_CATEGORIES.includes(entry?.category as SkinCategory) && typeof entry?.def?.id === 'string')
    .map((entry) => entry.def!.id!);
}

/**
 * Asks the market what every player in the room wears. A player whose answer fails keeps the normal look; the
 * game never waits for this.
 */
export async function loadWornSkins(userIds: readonly string[], fetchEquipped: (userId: string) => Promise<unknown>): Promise<Map<string, string[]>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const answers = await Promise.all(unique.map(async (userId) => {
    try {
      return [userId, wornSkinIds(await fetchEquipped(userId))] as const;
    } catch {
      return [userId, [] as string[]] as const;
    }
  }));
  return new Map(answers);
}

// ---------------------------------------------------------------- effect geometry (drawn by skinEffects.ts)

const STEP: Record<Cardinal, { x: number; y: number }> = {
  south: { x: 0, y: 1 }, north: { x: 0, y: -1 }, east: { x: 1, y: 0 }, west: { x: -1, y: 0 },
};

/** Screen direction of an eight-way facing, for the footprint trail. */
export function facingStep(facing: Facing): { x: number; y: number } {
  const x = facing.includes('east') ? 1 : facing.includes('west') ? -1 : 0;
  const y = facing.startsWith('south') ? 1 : facing.startsWith('north') ? -1 : 0;
  const length = Math.hypot(x, y) || 1;
  return x === 0 && y === 0 ? STEP.south : { x: x / length, y: y / length };
}

/**
 * Where the footprints go, in native pixels from the feet: a trail of alternating prints that starts clear of the
 * detective (and of his name tag under his feet) and leads away the way he faces. Facing the camera or away from it,
 * the trail bends off to one side so his own body does not hide it. Pure, so tests can check it.
 */
export function footprintTrail(facing: Facing, count = 6): { x: number; y: number; angle: number }[] {
  const straight = facingStep(facing);
  const vertical = straight.x === 0;
  // 30 degrees off the vertical: down-left facing the camera, up-right facing away.
  const turn = vertical ? (straight.y > 0 ? 1 : -1) * Math.PI / 6 : 0;
  const step = { x: straight.x * Math.cos(turn) - straight.y * Math.sin(turn), y: straight.x * Math.sin(turn) + straight.y * Math.cos(turn) };
  const side = { x: -step.y, y: step.x };
  const angle = Math.atan2(step.y, step.x) + Math.PI / 2;
  return Array.from({ length: count }, (_, index) => {
    const along = 44 + index * 12;
    const sway = (index % 2 === 0 ? -1 : 1) * 3.5;
    // A gentle bend, as if someone walked past without looking back.
    const bend = Math.sin(index / 2) * 5;
    return { x: step.x * along + side.x * (sway + bend), y: step.y * along * 0.75 + side.y * (sway + bend), angle };
  });
}
