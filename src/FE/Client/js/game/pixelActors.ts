/**
 * Pixel-mode player sheets (PixelLab V3 96 px characters exported as 128 px pivot-centred cells).
 * Frame indices follow the PixelLab spritesheet export: row 0 holds the eight rotations
 * (south, south-east, east, north-east, north, north-west, west, south-west), then one row per clip/direction.
 */
export type Facing = 'south' | 'south-east' | 'east' | 'north-east' | 'north' | 'north-west' | 'west' | 'south-west';
export type Cardinal = 'south' | 'east' | 'north' | 'west';
export type PixelClip = { texture: string; frames: number[]; fps: number; loop: boolean };
export type PixelActorSheet = {
  textures: { key: string; url: string; columns: number }[];
  cell: number;
  pivot: { x: number; y: number };
  standing: Record<Facing, { texture: string; frame: number }>;
  clips: Partial<Record<'idle' | 'walking' | 'draw-pipe' | 'smoking', Partial<Record<Cardinal, PixelClip>>>>;
  /** Idle time before the optional draw-pipe -> smoking routine starts (Sherlock only). */
  idleDelayMs?: number;
};

export const FACINGS: Facing[] = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

const range = (start: number, count: number) => Array.from({ length: count }, (_, index) => start + index);
const rotations = (texture: string) => Object.fromEntries(FACINGS.map((facing, frame) => [facing, { texture, frame }])) as PixelActorSheet['standing'];
const rows = (texture: string, columns: number, firstRow: Record<Cardinal, number>, count: number, fps: number, loop = true) =>
  Object.fromEntries(Object.entries(firstRow).map(([direction, row]) =>
    [direction, { texture, frames: range(row * columns, count), fps, loop }])) as Record<Cardinal, PixelClip>;

const HOLMES = 'pixel-holmes96-normal';
const HOLMES_SMOKING = 'pixel-holmes96-smoking';
const WATSON = 'pixel-watson96';

export const PIXEL_PLAYER_SHEETS: Record<string, PixelActorSheet> = {
  // Watson works the scene (camera, objects); Sherlock questions people.
  INTERROGATOR: {
    textures: [
      { key: HOLMES, url: '/assets/pixel/players/holmes96-normal.png', columns: 21 },
      { key: HOLMES_SMOKING, url: '/assets/pixel/players/holmes96-smoking.png', columns: 41 },
    ],
    cell: 128,
    pivot: { x: 64, y: 109 },
    standing: rotations(HOLMES),
    clips: {
      idle: rows(HOLMES, 21, { south: 1, east: 2, north: 3, west: 4 }, 9, 6),
      walking: rows(HOLMES, 21, { south: 5, east: 6, north: 7, west: 8 }, 8, 10),
      'draw-pipe': rows(HOLMES, 21, { south: 9, east: 10, north: 11, west: 12 }, 21, 12, false),
      smoking: rows(HOLMES_SMOKING, 41, { south: 1, east: 2, north: 3, west: 4 }, 41, 10),
    },
    idleDelayMs: 15000,
  },
  INVESTIGATOR: {
    textures: [{ key: WATSON, url: '/assets/pixel/players/watson96.png', columns: 9 }],
    cell: 128,
    pivot: { x: 64, y: 105 },
    standing: rotations(WATSON),
    clips: {
      walking: rows(WATSON, 9, { south: 1, east: 2, north: 3, west: 4 }, 8, 10),
      idle: rows(WATSON, 9, { south: 5, east: 6, north: 7, west: 8 }, 9, 6),
    },
  },
};

/** Eight-way facing from a movement vector (screen y grows downwards). */
export function facingFromVector(dx: number, dy: number, fallback: Facing = 'south'): Facing {
  if (Math.hypot(dx, dy) < 1e-6) return fallback;
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'] as Facing[])[(sector + 8) % 8];
}

/** Clips exist for the four cardinals; diagonals borrow the horizontal side so walking never moonwalks. */
export function clipDirection(facing: Facing): Cardinal {
  if (facing === 'north' || facing === 'south') return facing;
  return facing.includes('east') ? 'east' : 'west';
}

export function isFacing(value: unknown): value is Facing {
  return typeof value === 'string' && (FACINGS as string[]).includes(value);
}

export type PixelMotionState = { action: 'idle' | 'walking' | 'draw-pipe' | 'smoking'; facing: Facing; since: number; idleMs: number };

/** Sherlock's routine (idle 15 s -> draw pipe -> smoke) from the SceneTest prototype, frame-rate independent. */
export function advanceMotion(state: PixelMotionState, sheet: PixelActorSheet, now: number, deltaMs: number, moving: boolean, facing: Facing): PixelMotionState {
  if (moving) return state.action === 'walking' && state.facing === facing ? state : { action: 'walking', facing, since: now, idleMs: 0 };
  if (state.action === 'walking' || state.facing !== facing) return { action: 'idle', facing, since: now, idleMs: 0 };
  if (state.action === 'idle') {
    const idleMs = state.idleMs + Math.max(0, deltaMs);
    if (sheet.idleDelayMs && sheet.clips['draw-pipe'] && idleMs >= sheet.idleDelayMs) return { action: 'draw-pipe', facing, since: now, idleMs };
    return { ...state, idleMs };
  }
  if (state.action === 'draw-pipe') {
    const clip = sheet.clips['draw-pipe']?.[clipDirection(facing)];
    if (clip && now - state.since >= clip.frames.length * 1000 / clip.fps) return { action: 'smoking', facing, since: now, idleMs: state.idleMs };
  }
  return state;
}

/** Texture + frame to show for a motion state at a given time. Diagonal idles hold the rotation frame. */
export function motionFrame(sheet: PixelActorSheet, state: PixelMotionState, now: number, reducedMotion = false): { texture: string; frame: number } {
  const direction = clipDirection(state.facing);
  const diagonal = direction !== state.facing;
  const clip = state.action === 'walking' ? sheet.clips.walking?.[direction]
    : state.action === 'idle' ? (diagonal ? undefined : sheet.clips.idle?.[direction])
      : sheet.clips[state.action]?.[direction];
  if (!clip || reducedMotion && state.action !== 'walking') return sheet.standing[state.facing];
  const elapsed = Math.max(0, now - state.since);
  const step = Math.floor(elapsed * clip.fps / 1000);
  const index = clip.loop ? step % clip.frames.length : Math.min(step, clip.frames.length - 1);
  return { texture: clip.texture, frame: clip.frames[index] };
}
