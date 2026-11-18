/**
 * Case Studio (/admin/editor): the pure part of the editor. Everything here works on the case JSON as the server
 * stores it (camelCase) and follows the game's numbers: a pixel scene is 512x512 native pixels drawn at x4 (2048x2048
 * runtime units), its walk grid is 128x128 cells of 16, NPCs are 128px frames drawn at actorScale (4 in rooms, 1.5
 * outside) and anchored at the feet. No DOM here, so it is tested with node --test (scripts/case-editor.test.mjs).
 */

export const RUNTIME_SIZE = 2048;
export const NATIVE_SIZE = 512;
export const PIXEL_SCALE = 4;
export const CELL_SIZE = 16;
export const GRID_CELLS = RUNTIME_SIZE / CELL_SIZE;
export const FRAME_SIZE = 128;
export const FRAME_COUNT = 9;
export const FRAME_FPS = 6;
/** Feet line of the library NPC sheets (row 104 of 128): the anchorY the game draws them with. */
export const LIBRARY_FEET_ANCHOR = 0.8203;
/** Every box moves and resizes on the native pixel grid: one native pixel is 4 runtime units. */
export const SNAP = PIXEL_SCALE;
export const MIN_BOX = 16;

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type ObjectKind = 'npc' | 'item' | 'clue' | 'door' | 'spawn';
export type ObjectRef = { kind: ObjectKind; id: string };
export type SceneObject = ObjectRef & { label: string; box: Box; point?: Point; resizable: boolean };
export type Geometry = { box: Box; point?: Point };

export const KIND_LABEL: Record<ObjectKind, string> = {
  npc: 'NPC',
  item: 'Vật phẩm',
  clue: 'Manh mối',
  door: 'Cửa',
  spawn: 'Điểm xuất hiện',
};

/* ---------------------------------------------------------------- scenes and objects */

export function orderedScenes(gameCase: any): any[] {
  return [...(gameCase?.stages ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .flatMap((stage) => stage.scenes ?? []);
}

export function findScene(gameCase: any, sceneId: string): any | null {
  return orderedScenes(gameCase).find((scene) => scene.sceneId === sceneId) ?? null;
}

export function isPixelScene(scene: any): boolean {
  return scene?.runtime?.render?.mode === 'pixel';
}

/** Topdown outside, isometric in rooms: the game's actorScale and interactRadius of the scene. */
export function sceneProfile(scene: any) {
  const render = scene?.runtime?.render ?? {};
  const topdown = render.projection === 'topdown';
  return {
    projection: topdown ? 'topdown' : 'isometric',
    actorScale: Number(render.actorScale) > 0 ? Number(render.actorScale) : (topdown ? 1.5 : 4),
    interactRadius: Number(render.interactRadius) > 0 ? Number(render.interactRadius) : (topdown ? 120 : 104),
    width: Number(scene?.runtime?.width) > 0 ? Number(scene.runtime.width) : RUNTIME_SIZE,
    height: Number(scene?.runtime?.height) > 0 ? Number(scene.runtime.height) : RUNTIME_SIZE,
  };
}

function nameOf(list: any[], key: string, id: string, field = 'name'): string {
  const found = (list ?? []).find((entry) => entry?.[key] === id);
  return (found?.[field] || id) as string;
}

const SPAWN_BOX = 48;

/** The things that can be selected and dragged in a scene, in drawing order. */
export function sceneObjects(gameCase: any, scene: any): SceneObject[] {
  const runtime = scene?.runtime;
  if (!runtime) return [];
  const result: SceneObject[] = [];
  for (const door of runtime.transitions ?? []) {
    result.push({ kind: 'door', id: door.targetSceneId, label: door.label || `→ ${nameOf(orderedScenes(gameCase), 'sceneId', door.targetSceneId, 'title')}`,
      box: { ...door.hotspot }, resizable: true });
  }
  for (const zone of runtime.clueZones ?? []) {
    result.push({ kind: 'clue', id: zone.clueId, label: zone.label || nameOf(gameCase.clues, 'clueId', zone.clueId, 'title'),
      box: { ...zone.bounds }, resizable: true });
  }
  for (const placement of runtime.itemPlacements ?? []) {
    result.push({ kind: 'item', id: placement.itemId, label: nameOf(gameCase.items, 'itemId', placement.itemId),
      box: { ...placement.hotspot }, resizable: true });
  }
  for (const placement of runtime.characterPlacements ?? []) {
    result.push({ kind: 'npc', id: placement.characterId, label: nameOf(gameCase.characters, 'characterId', placement.characterId),
      box: { ...placement.hotspot }, point: { x: placement.position?.x ?? 0, y: placement.position?.y ?? 0 }, resizable: false });
  }
  for (const [name, spawn] of Object.entries<any>(runtime.spawnPoints ?? {})) {
    result.push({ kind: 'spawn', id: name, label: name === 'default' ? 'Xuất hiện (mặc định)' : `Xuất hiện: ${name}`,
      box: { x: spawn.x - SPAWN_BOX / 2, y: spawn.y - SPAWN_BOX, width: SPAWN_BOX, height: SPAWN_BOX },
      point: { x: spawn.x, y: spawn.y }, resizable: false });
  }
  return result;
}

export function objectKey(ref: ObjectRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function snap(value: number): number {
  return Math.round(value / SNAP) * SNAP;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getGeometry(scene: any, ref: ObjectRef): Geometry | null {
  const runtime = scene?.runtime;
  if (!runtime) return null;
  switch (ref.kind) {
    case 'npc': {
      const placement = (runtime.characterPlacements ?? []).find((entry) => entry.characterId === ref.id);
      return placement ? { box: { ...placement.hotspot }, point: { x: placement.position.x, y: placement.position.y } } : null;
    }
    case 'item': {
      const placement = (runtime.itemPlacements ?? []).find((entry) => entry.itemId === ref.id);
      return placement ? { box: { ...placement.hotspot } } : null;
    }
    case 'clue': {
      const zone = (runtime.clueZones ?? []).find((entry) => entry.clueId === ref.id);
      return zone ? { box: { ...zone.bounds } } : null;
    }
    case 'door': {
      const door = (runtime.transitions ?? []).find((entry) => entry.targetSceneId === ref.id);
      return door ? { box: { ...door.hotspot } } : null;
    }
    case 'spawn': {
      const spawn = runtime.spawnPoints?.[ref.id];
      return spawn ? { box: { x: spawn.x - SPAWN_BOX / 2, y: spawn.y - SPAWN_BOX, width: SPAWN_BOX, height: SPAWN_BOX },
        point: { x: spawn.x, y: spawn.y } } : null;
    }
    default:
      return null;
  }
}

/**
 * Moves a shape by (dx, dy) runtime units from where a drag started, snapped to the native pixel grid and kept inside
 * the scene. An NPC moves its feet and its talk box together, so the box stays where the sprite is.
 */
export function translateGeometry(start: Geometry, dx: number, dy: number, size = RUNTIME_SIZE): Geometry {
  const box = start.box;
  const nx = clamp(snap(box.x + dx), 0, Math.max(0, size - box.width));
  const ny = clamp(snap(box.y + dy), 0, Math.max(0, size - box.height));
  const moved = { box: { ...box, x: nx, y: ny } } as Geometry;
  if (start.point) moved.point = { x: start.point.x + (nx - box.x), y: start.point.y + (ny - box.y) };
  return moved;
}

/** Resizes a box from its bottom-right corner, snapped, at least MIN_BOX and inside the scene. */
export function resizeGeometry(start: Geometry, dw: number, dh: number, size = RUNTIME_SIZE): Geometry {
  const box = start.box;
  const width = clamp(snap(box.width + dw), MIN_BOX, size - box.x);
  const height = clamp(snap(box.height + dh), MIN_BOX, size - box.y);
  return { box: { ...box, width, height }, point: start.point ? { ...start.point } : undefined };
}

/** Writes a shape back into the scene runtime (and the percent hotspot the classic layer reads). */
export function setGeometry(scene: any, ref: ObjectRef, geometry: Geometry): boolean {
  const runtime = scene?.runtime;
  if (!runtime) return false;
  const box = { x: geometry.box.x, y: geometry.box.y, width: geometry.box.width, height: geometry.box.height };
  switch (ref.kind) {
    case 'npc': {
      const placement = (runtime.characterPlacements ?? []).find((entry) => entry.characterId === ref.id);
      if (!placement) return false;
      placement.hotspot = box;
      if (geometry.point) placement.position = { ...placement.position, x: geometry.point.x, y: geometry.point.y };
      break;
    }
    case 'item': {
      const placement = (runtime.itemPlacements ?? []).find((entry) => entry.itemId === ref.id);
      if (!placement) return false;
      placement.hotspot = box;
      // The item is painted into the background: its anchor stays at the bottom centre of its box.
      placement.position = { ...(placement.position ?? {}), x: box.x + box.width / 2, y: box.y + box.height, anchor: 'bottom-center' };
      break;
    }
    case 'clue': {
      const zone = (runtime.clueZones ?? []).find((entry) => entry.clueId === ref.id);
      if (!zone) return false;
      zone.bounds = box;
      break;
    }
    case 'door': {
      const door = (runtime.transitions ?? []).find((entry) => entry.targetSceneId === ref.id);
      if (!door) return false;
      door.hotspot = box;
      break;
    }
    case 'spawn': {
      const spawn = runtime.spawnPoints?.[ref.id];
      if (!spawn || !geometry.point) return false;
      spawn.x = snap(geometry.point.x);
      spawn.y = snap(geometry.point.y);
      break;
    }
    default:
      return false;
  }
  syncSceneHotspots(scene);
  return true;
}

/** Same as the server's PixelCasePipeline.SyncSceneHotspots: percent hotspots follow the runtime boxes. */
export function syncSceneHotspots(scene: any): void {
  const runtime = scene?.runtime;
  if (!runtime) return;
  const width = Number(runtime.width) > 0 ? Number(runtime.width) : RUNTIME_SIZE;
  const percent = (value: number) => Math.round(value / width * 100 * 1000) / 1000;
  for (const hotspot of scene.hotspots ?? []) {
    const box = String(hotspot.type).toUpperCase() === 'CHARACTER'
      ? (runtime.characterPlacements ?? []).find((entry) => entry.characterId === hotspot.targetId)?.hotspot
      : (runtime.itemPlacements ?? []).find((entry) => entry.itemId === hotspot.targetId)?.hotspot;
    if (!box) continue;
    hotspot.x = percent(box.x);
    hotspot.y = percent(box.y);
    hotspot.width = percent(box.width);
    hotspot.height = percent(box.height);
  }
}

export function hitTest(objects: SceneObject[], point: Point): SceneObject | null {
  // Smaller boxes win over bigger ones under the pointer (a clue inside a door, a spawn on the floor).
  const under = objects.filter((object) => point.x >= object.box.x && point.x <= object.box.x + object.box.width
    && point.y >= object.box.y && point.y <= object.box.y + object.box.height);
  under.sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
  return under[0] ?? null;
}

/** True when the pointer is on the bottom-right resize handle of a resizable object (handle in runtime units). */
export function onResizeHandle(object: SceneObject | null, point: Point, handle: number): boolean {
  if (!object?.resizable) return false;
  const right = object.box.x + object.box.width;
  const bottom = object.box.y + object.box.height;
  return Math.abs(point.x - right) <= handle && Math.abs(point.y - bottom) <= handle;
}

/* ---------------------------------------------------------------- walk grid */

export type Grid = { cellSize: number; cols: number; rows: number; data: string[] };

export function sceneGrid(scene: any): Grid | null {
  const grid = scene?.runtime?.render?.walkGrid;
  if (!grid || !Array.isArray(grid.data) || !(grid.cellSize > 0)) return null;
  return grid as Grid;
}

export function walkable(grid: Grid, col: number, row: number): boolean {
  return row >= 0 && col >= 0 && row < grid.rows && col < grid.cols && row < grid.data.length
    && col < (grid.data[row]?.length ?? 0) && grid.data[row][col] === '1';
}

export function cellAt(grid: Grid, x: number, y: number): [number, number] {
  return [Math.floor(x / grid.cellSize), Math.floor(y / grid.cellSize)];
}

/**
 * Paints walkable ('1') or blocked ('0') cells in a square brush centred on a runtime point. Returns how many cells
 * changed, so a stroke that changes nothing leaves no undo step.
 */
export function paintGrid(grid: Grid, x: number, y: number, brushCells: number, value: '0' | '1'): number {
  const [col0, row0] = cellAt(grid, x, y);
  const half = Math.floor(Math.max(1, brushCells) / 2);
  let changed = 0;
  for (let row = row0 - half; row < row0 - half + Math.max(1, brushCells); row++) {
    if (row < 0 || row >= grid.rows || row >= grid.data.length) continue;
    const cells = grid.data[row].split('');
    let rowChanged = false;
    for (let col = col0 - half; col < col0 - half + Math.max(1, brushCells); col++) {
      if (col < 0 || col >= grid.cols || col >= cells.length || cells[col] === value) continue;
      cells[col] = value;
      rowChanged = true;
      changed++;
    }
    if (rowChanged) grid.data[row] = cells.join('');
  }
  return changed;
}

/** Cells reachable on foot (4-neighbour) from the cell under a point; empty when that cell is blocked. */
export function component(grid: Grid, x: number, y: number): Set<number> {
  const result = new Set<number>();
  const [col, row] = cellAt(grid, x, y);
  if (!walkable(grid, col, row)) return result;
  const key = (c: number, r: number) => r * grid.cols + c;
  const queue: [number, number][] = [[col, row]];
  result.add(key(col, row));
  for (let head = 0; head < queue.length; head++) {
    const [c, r] = queue[head];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (!walkable(grid, nc, nr) || result.has(key(nc, nr))) continue;
      result.add(key(nc, nr));
      queue.push([nc, nr]);
    }
  }
  return result;
}

/** The walkable cell whose centre is nearest to a point (the game's gridNearest), or null. */
export function nearestCell(grid: Grid, x: number, y: number): { col: number; row: number; distance: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const [col0, row0] = cellAt(grid, x, y);
  if (walkable(grid, col0, row0)) return { col: col0, row: row0, distance: 0 };
  let best: { col: number; row: number; distance: number } | null = null;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!walkable(grid, col, row)) continue;
      const cx = col * grid.cellSize + grid.cellSize / 2, cy = row * grid.cellSize + grid.cellSize / 2;
      const distance = Math.hypot(cx - x, cy - y);
      if (!best || distance < best.distance) best = { col, row, distance };
    }
  }
  return best;
}

/** The floor point a player walks to before using an object: the walkable cell nearest the bottom of its box. */
export function approachCell(grid: Grid, box: Box) {
  return nearestCell(grid, box.x + box.width / 2, box.y + box.height - 1);
}

function boxTouches(grid: Grid, box: Box, reach: Set<number>): boolean {
  const [c0, r0] = cellAt(grid, box.x, box.y);
  const [c1, r1] = cellAt(grid, box.x + box.width - 1, box.y + box.height - 1);
  for (let row = Math.max(0, r0); row <= Math.min(grid.rows - 1, r1); row++) {
    for (let col = Math.max(0, c0); col <= Math.min(grid.cols - 1, c1); col++) {
      if (reach.has(row * grid.cols + col)) return true;
    }
  }
  return false;
}

export type Reachability = {
  /** False when the scene has no usable walk grid or the default spawn is not on the floor. */
  checked: boolean;
  spawnOk: boolean;
  /** objectKey() of every object the player cannot walk up to. */
  unreachable: Set<string>;
  reachableCells: Set<number>;
};

/**
 * "Kiểm đường đi": the same rules as the server's pixel layout gate (PixelDraftRules). Doors must touch the floor
 * reachable from the default spawn or be within interactRadius of it; NPCs and items need their approach cell on it;
 * every spawn point must stand on it.
 */
export function reachability(scene: any): Reachability {
  const grid = sceneGrid(scene);
  const runtime = scene?.runtime;
  const empty: Reachability = { checked: false, spawnOk: false, unreachable: new Set(), reachableCells: new Set() };
  if (!grid || !runtime) return empty;
  const origin = runtime.spawnPoints?.default;
  if (!origin) return { ...empty, checked: true };
  const reach = component(grid, origin.x, origin.y);
  if (reach.size === 0) {
    const unreachable = new Set<string>(sceneObjects({}, scene).map(objectKey));
    return { checked: true, spawnOk: false, unreachable, reachableCells: reach };
  }
  const unreachable = new Set<string>();
  const key = (cell: { col: number; row: number }) => cell.row * grid.cols + cell.col;
  for (const [name, spawn] of Object.entries<any>(runtime.spawnPoints ?? {})) {
    const [col, row] = cellAt(grid, spawn.x, spawn.y);
    if (!reach.has(row * grid.cols + col)) unreachable.add(objectKey({ kind: 'spawn', id: name }));
  }
  const radius = sceneProfile(scene).interactRadius;
  for (const door of runtime.transitions ?? []) {
    const approach = approachCell(grid, door.hotspot);
    const near = approach !== null && reach.has(key(approach)) && approach.distance <= radius;
    if (!boxTouches(grid, door.hotspot, reach) && !near) unreachable.add(objectKey({ kind: 'door', id: door.targetSceneId }));
  }
  for (const placement of runtime.itemPlacements ?? []) {
    const approach = approachCell(grid, placement.hotspot);
    if (!approach || !reach.has(key(approach))) unreachable.add(objectKey({ kind: 'item', id: placement.itemId }));
  }
  for (const placement of runtime.characterPlacements ?? []) {
    const approach = approachCell(grid, placement.hotspot);
    if (!approach || !reach.has(key(approach))) unreachable.add(objectKey({ kind: 'npc', id: placement.characterId }));
  }
  return { checked: true, spawnOk: true, unreachable, reachableCells: reach };
}

/* ---------------------------------------------------------------- references (C2) */

export type Reference = { path: string; value: string };

/**
 * Every place in the case that names `id` (string values and dictionary keys), except the field that defines the
 * object itself (`definitionPath`.clueId and the like). A path reads like `dialogues[3].unlockClueIds[0]`. Used before
 * deleting evidence, so the owner sees what would break.
 */
export function findReferences(gameCase: any, id: string, definitionPath = ''): Reference[] {
  const found: Reference[] = [];
  const own = definitionPath ? `${definitionPath}.${definitionKey(definitionPath)}` : '';
  const walk = (node: any, path: string) => {
    if (typeof node === 'string') {
      if (node === id && path !== own) found.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        // Dictionary keys may name it too (spawnPoints "from:scene-x", cue maps).
        if (key === id) found.push({ path: childPath, value: key });
        walk(child, childPath);
      }
    }
  };
  walk(gameCase, '');
  return found;
}

function definitionKey(definitionPath: string): string {
  if (definitionPath.startsWith('clues[')) return 'clueId';
  if (definitionPath.startsWith('items[')) return 'itemId';
  if (definitionPath.startsWith('characters[')) return 'characterId';
  return 'id';
}

/** References that only place the evidence in a scene: deleting the evidence removes them with it. */
export function isPlacementReference(path: string): boolean {
  return /\.runtime\.(clueZones|itemPlacements)\[\d+\]/.test(path)
    || /\.scenes\[\d+\]\.(itemIds|hotspots)\[\d+\]/.test(path)
    || /\.placementPlan\./.test(path);
}

/** References the deletion would leave pointing at nothing, so the owner is warned before deleting. */
export function evidenceDependencies(gameCase: any, kind: 'item' | 'clue', id: string): Reference[] {
  const list = kind === 'item' ? gameCase.items : gameCase.clues;
  const index = (list ?? []).findIndex((entry) => entry[kind === 'item' ? 'itemId' : 'clueId'] === id);
  const definition = index >= 0 ? `${kind === 'item' ? 'items' : 'clues'}[${index}]` : '';
  return findReferences(gameCase, id, definition)
    .filter((reference) => !reference.path.startsWith(`${definition}.`) && !isPlacementReference(reference.path));
}

/** Deletes an item or clue with its places in the scenes. Other references stay; the validator then lists them. */
export function deleteEvidence(gameCase: any, kind: 'item' | 'clue', id: string): boolean {
  const key = kind === 'item' ? 'itemId' : 'clueId';
  const list = kind === 'item' ? gameCase.items : gameCase.clues;
  const index = (list ?? []).findIndex((entry) => entry[key] === id);
  if (index < 0) return false;
  list.splice(index, 1);
  for (const scene of orderedScenes(gameCase)) {
    if (kind === 'item') {
      scene.itemIds = (scene.itemIds ?? []).filter((itemId) => itemId !== id);
      scene.hotspots = (scene.hotspots ?? []).filter((hotspot) => !(hotspot.targetId === id && String(hotspot.type).toUpperCase() !== 'CHARACTER'));
      if (scene.runtime) scene.runtime.itemPlacements = (scene.runtime.itemPlacements ?? []).filter((entry) => entry.itemId !== id);
    } else if (scene.runtime) {
      scene.runtime.clueZones = (scene.runtime.clueZones ?? []).filter((entry) => entry.clueId !== id);
    }
  }
  return true;
}

/* ---------------------------------------------------------------- NPC look from the library (D1) */

export type LibraryNpc = { key: string; kind?: string; nameVi?: string; nameEn?: string; url?: string; thumbUrl?: string;
  files?: Record<string, string>; world?: string; tags?: string[]; retired?: boolean };

export function libraryLook(entry: LibraryNpc): { idle: string; portrait: string } | null {
  if (!entry || entry.retired || (entry.kind && entry.kind !== 'NPC')) return null;
  const idle = entry.files?.idle ?? '';
  const portrait = entry.files?.portrait || entry.url || '';
  if (!safeAssetUrl(idle) || !safeAssetUrl(portrait)) return null;
  return { idle, portrait };
}

/** Pictures may come from the site (/assets/...) or HTTPS only, as the server requires on save. */
export function safeAssetUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/assets/')) return !url.includes('..');
  return /^https:\/\/[^/]/i.test(url);
}

/**
 * Gives a character the face of a library NPC: its portrait and idle sheet, drawn as the game draws library NPCs.
 * The character keeps its id, name, role and every line it says.
 */
export function swapNpcLook(gameCase: any, characterId: string, entry: LibraryNpc): boolean {
  const character = (gameCase.characters ?? []).find((candidate) => candidate.characterId === characterId);
  const look = libraryLook(entry);
  if (!character || !look) return false;
  character.imageUrl = look.portrait;
  character.presentation = {
    ...(character.presentation ?? {}),
    spriteSheet: {
      url: look.idle,
      frameWidth: FRAME_SIZE,
      frameHeight: FRAME_SIZE,
      frameCount: FRAME_COUNT,
      fps: FRAME_FPS,
      idleFrames: [],
      anchorX: 0.5,
      anchorY: LIBRARY_FEET_ANCHOR,
    },
  };
  return true;
}

/* ---------------------------------------------------------------- lines (E1) */

export type LineRef = { path: string; label: string; text: string; speaker: string };

/** Everything a character says or is asked, with the JSON path the editor writes back to. */
export function characterLines(gameCase: any, characterId: string): LineRef[] {
  const lines: LineRef[] = [];
  const name = nameOf(gameCase.characters, 'characterId', characterId);
  (gameCase.dialogues ?? []).forEach((dialogue, index) => {
    if (dialogue.characterId !== characterId) return;
    lines.push({ path: `dialogues[${index}].question`, label: `Câu hỏi · ${dialogue.dialogueId}`, text: dialogue.question ?? '', speaker: 'Thám tử' });
    lines.push({ path: `dialogues[${index}].answer`, label: `Trả lời · ${dialogue.dialogueId}`, text: dialogue.answer ?? '', speaker: name });
    (gameCase.testimonyFragments ?? []).forEach((fragment, fragmentIndex) => {
      if (fragment.dialogueId !== dialogue.dialogueId) return;
      lines.push({ path: `testimonyFragments[${fragmentIndex}].text`, label: `Lời khai · ${fragment.id}`, text: fragment.text ?? '', speaker: name });
    });
  });
  (gameCase.conversationNodes ?? []).forEach((node, nodeIndex) => {
    if (node.characterId !== characterId) return;
    (node.lines ?? []).forEach((line, lineIndex) => {
      lines.push({ path: `conversationNodes[${nodeIndex}].lines[${lineIndex}].text`, label: `Hội thoại · ${node.nodeId} #${lineIndex + 1}`,
        text: line.text ?? '', speaker: String(line.speaker).toUpperCase() === 'DETECTIVE' ? 'Thám tử' : name });
    });
    (node.choices ?? []).forEach((choice, choiceIndex) => {
      lines.push({ path: `conversationNodes[${nodeIndex}].choices[${choiceIndex}].label`, label: `Lựa chọn · ${node.nodeId}`,
        text: choice.label ?? '', speaker: 'Thám tử' });
    });
  });
  return lines;
}

function pathSteps(path: string): (string | number)[] {
  const steps: (string | number)[] = [];
  for (const part of path.split('.')) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) return [];
    steps.push(match[1]);
    for (const index of match[2].matchAll(/\[(\d+)\]/g)) steps.push(Number(index[1]));
  }
  return steps;
}

export function readPath(root: any, path: string): any {
  let node = root;
  for (const step of pathSteps(path)) {
    if (node === null || node === undefined) return undefined;
    node = node[step];
  }
  return node;
}

/** Writes a text field by its JSON path; only an existing string field can be written (no new keys). */
export function writeText(root: any, path: string, value: string): boolean {
  const steps = pathSteps(path);
  if (steps.length === 0) return false;
  let node = root;
  for (const step of steps.slice(0, -1)) {
    node = node?.[step];
    if (node === null || typeof node !== 'object') return false;
  }
  const last = steps[steps.length - 1];
  if (typeof node[last] !== 'string') return false;
  node[last] = value;
  return true;
}

/* ---------------------------------------------------------------- validation → objects (A2) */

export type IssueTarget =
  | { type: 'object'; sceneId: string; ref: ObjectRef }
  | { type: 'scene'; sceneId: string; part: 'background' | 'grid' | 'render' | 'scene' }
  | { type: 'evidence'; kind: 'item' | 'clue'; id: string }
  | { type: 'character'; id: string }
  | { type: 'lines'; characterId: string; path: string }
  | { type: 'hints' }
  | { type: 'case' };

const RUNTIME_KIND: Record<string, ObjectKind> = {
  itemPlacements: 'item', characterPlacements: 'npc', clueZones: 'clue', transitions: 'door',
};

/** Where a validation error belongs, so clicking it selects the object (paths of CaseValidationService and PixelDraftRules). */
export function issueTarget(gameCase: any, issue: { path?: string; refId?: string | null; code?: string }): IssueTarget {
  const path = String(issue?.path ?? '');
  const scenes = orderedScenes(gameCase);
  let match = /^scene:([^.]+)\.(.*)$/.exec(path);
  if (match) {
    const [, sceneId, rest] = match;
    const runtime = /^runtime\.(itemPlacements|characterPlacements|clueZones|transitions)\[([^\]]+)\]/.exec(rest);
    if (runtime) return { type: 'object', sceneId, ref: { kind: RUNTIME_KIND[runtime[1]], id: runtime[2] } };
    const spawn = /^runtime\.spawnPoints\.(.+)$/.exec(rest);
    if (spawn) return { type: 'object', sceneId, ref: { kind: 'spawn', id: spawn[1] } };
    if (rest.startsWith('backgroundUrl')) return { type: 'scene', sceneId, part: 'background' };
    if (rest.startsWith('runtime.render.walkGrid')) return { type: 'scene', sceneId, part: 'grid' };
    if (rest.startsWith('runtime.render')) return { type: 'scene', sceneId, part: 'render' };
    return { type: 'scene', sceneId, part: 'scene' };
  }
  match = /^stages\[(\d+)\]\.scenes\[(\d+)\](.*)$/.exec(path);
  if (match) {
    const stage = [...(gameCase.stages ?? [])][Number(match[1])];
    const scene = stage?.scenes?.[Number(match[2])];
    if (scene) {
      const rest = match[3];
      const runtime = /^\.runtime\.(itemPlacements|characterPlacements|clueZones|transitions)\[(\d+)\]/.exec(rest);
      if (runtime) {
        const entry = scene.runtime?.[runtime[1]]?.[Number(runtime[2])];
        const id = entry?.itemId ?? entry?.characterId ?? entry?.clueId ?? entry?.targetSceneId;
        if (id) return { type: 'object', sceneId: scene.sceneId, ref: { kind: RUNTIME_KIND[runtime[1]], id } };
      }
      if (rest.includes('walkGrid')) return { type: 'scene', sceneId: scene.sceneId, part: 'grid' };
      return { type: 'scene', sceneId: scene.sceneId, part: 'scene' };
    }
  }
  match = /^(items|clues|characters)\[(\d+)\]/.exec(path);
  if (match) {
    const entry = gameCase[match[1]]?.[Number(match[2])];
    if (match[1] === 'characters' && entry) return { type: 'character', id: entry.characterId };
    if (entry) return { type: 'evidence', kind: match[1] === 'items' ? 'item' : 'clue', id: entry.itemId ?? entry.clueId };
  }
  match = /^(dialogues|conversationNodes|testimonyFragments)\[(\d+)\]/.exec(path);
  if (match) {
    const entry = gameCase[match[1]]?.[Number(match[2])];
    const dialogue = match[1] === 'testimonyFragments'
      ? (gameCase.dialogues ?? []).find((candidate) => candidate.dialogueId === entry?.dialogueId)
      : entry;
    if (dialogue?.characterId) return { type: 'lines', characterId: dialogue.characterId, path };
  }
  if (path.startsWith('hints')) return { type: 'hints' };
  const refId = issue?.refId ?? '';
  if (refId) {
    if (scenes.some((scene) => scene.sceneId === refId)) return { type: 'scene', sceneId: refId, part: 'scene' };
    if ((gameCase.characters ?? []).some((entry) => entry.characterId === refId)) return { type: 'character', id: refId };
    if ((gameCase.items ?? []).some((entry) => entry.itemId === refId)) return { type: 'evidence', kind: 'item', id: refId };
    if ((gameCase.clues ?? []).some((entry) => entry.clueId === refId)) return { type: 'evidence', kind: 'clue', id: refId };
  }
  return { type: 'case' };
}

/** Problems per object of a scene, for the red marks on the canvas and in the object list. */
export function issuesByObject(gameCase: any, issues: any[], sceneId: string): Map<string, any[]> {
  const result = new Map<string, any[]>();
  for (const issue of issues ?? []) {
    const target = issueTarget(gameCase, issue);
    let key = '';
    if (target.type === 'object' && target.sceneId === sceneId) key = objectKey(target.ref);
    else if (target.type === 'character' && findScene(gameCase, sceneId)?.runtime?.characterPlacements?.some((entry) => entry.characterId === target.id)) {
      key = objectKey({ kind: 'npc', id: target.id });
    } else if (target.type === 'evidence') {
      const scene = findScene(gameCase, sceneId);
      const placed = target.kind === 'item'
        ? scene?.runtime?.itemPlacements?.some((entry) => entry.itemId === target.id)
        : scene?.runtime?.clueZones?.some((entry) => entry.clueId === target.id);
      if (placed) key = objectKey({ kind: target.kind, id: target.id });
    }
    if (!key) continue;
    if (!result.has(key)) result.set(key, []);
    result.get(key)!.push(issue);
  }
  return result;
}

/* ---------------------------------------------------------------- undo / redo (A3) */

/**
 * Snapshots of the whole case as JSON text. A drag or a paint stroke pushes one snapshot when it ends, so one Ctrl+Z
 * undoes one gesture. The oldest snapshots fall off past `limit`.
 */
export function createHistory(initial: string, limit = 60) {
  const past: string[] = [];
  const future: string[] = [];
  let current = initial;
  return {
    get current() { return current; },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    /** Records a new state; returns false when it is the same as the current one. */
    push(next: string): boolean {
      if (next === current) return false;
      past.push(current);
      if (past.length > limit) past.shift();
      current = next;
      future.length = 0;
      return true;
    },
    undo(): string | null {
      if (past.length === 0) return null;
      future.push(current);
      current = past.pop()!;
      return current;
    },
    redo(): string | null {
      if (future.length === 0) return null;
      past.push(current);
      current = future.pop()!;
      return current;
    },
    /** After a restore or reload: the loaded case becomes the only state. */
    reset(state: string) {
      past.length = 0;
      future.length = 0;
      current = state;
    },
  };
}

/** The hint rule codes of the server (CaseHintCodes): with E3 they are errors that block publishing. */
export const HINT_CODES = new Set(['MissingHintLevel', 'DuplicateHintLevel', 'MissingPuzzleHints']);

export function hintIssues(issues: any[]): any[] {
  return (issues ?? []).filter((issue) => HINT_CODES.has(issue.code));
}

/* ---------------------------------------------------------------- comparing saved copies (A1) */

export const SECTION_LABEL: Record<string, string> = {
  title: 'tên vụ', summary: 'tóm tắt', stages: 'bố cục cảnh', characters: 'nhân vật', items: 'vật phẩm', clues: 'manh mối',
  dialogues: 'lời thoại', testimonyFragments: 'lời khai', conversationNodes: 'hội thoại', hints: 'gợi ý',
  evidenceChallenges: 'thử thách bằng chứng', deductions: 'suy luận', finalLogic: 'kết luận', puzzles: 'giải đố',
  timeline: 'dòng thời gian', board: 'sơ đồ vụ án', interactions: 'tương tác', requiredTeamworkChains: 'chuỗi phối hợp',
  alternateRewardPaths: 'đường thưởng phụ', coverImageUrl: 'ảnh bìa', estimatedMinutes: 'thời lượng',
};

/** Parts of the case that differ between two copies, named for the owner (server-owned fields are left out). */
export function changedSections(a: any, b: any): string[] {
  const keys = Object.keys(SECTION_LABEL);
  return keys.filter((key) => JSON.stringify(a?.[key] ?? null) !== JSON.stringify(b?.[key] ?? null))
    .map((key) => SECTION_LABEL[key]);
}

/* ---------------------------------------------------------------- hints (E3) */

export type HintTarget = { contextType: string; targetId: string; missing: number[] };

/** Reads `hints[SCENE:scene-x]` and "missing order 1, 3." of a MissingHintLevel issue. */
export function parseHintIssue(issue: { path?: string; message?: string; code?: string }): HintTarget | null {
  const match = /^hints\[([A-Z_]+):(.+)\]$/.exec(String(issue?.path ?? ''));
  if (!match) return null;
  const missing = issue.code === 'MissingHintLevel'
    ? [...String(/missing order ([\d,\s]+)/.exec(issue.message ?? '')?.[1] ?? '').matchAll(/\d+/g)].map((value) => Number(value[0]))
    : [];
  return { contextType: match[1], targetId: match[2], missing };
}

export function hintsFor(gameCase: any, contextType: string, targetId: string): { index: number; hint: any }[] {
  return (gameCase.hints ?? [])
    .map((hint, index) => ({ index, hint }))
    .filter(({ hint }) => String(hint.contextType ?? '').toUpperCase() === contextType.toUpperCase() && hint.targetId === targetId)
    .sort((a, b) => (a.hint.order ?? 0) - (b.hint.order ?? 0));
}

/** Adds one hint (order 1 general direction, 2 where to look, 3 almost the answer) with a unique hintId. */
export function addHint(gameCase: any, contextType: string, targetId: string, order: number, text: string): string | null {
  const clean = String(text ?? '').trim();
  if (!clean || ![1, 2, 3].includes(order)) return null;
  gameCase.hints = gameCase.hints ?? [];
  const base = `hint-${targetId}-${order}`.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const taken = new Set(gameCase.hints.map((hint) => hint.hintId));
  let hintId = base;
  for (let n = 2; taken.has(hintId); n++) hintId = `${base}-${n}`;
  gameCase.hints.push({ hintId, contextType, targetId, order, text: clean });
  return hintId;
}

export function removeHint(gameCase: any, index: number): boolean {
  if (!Array.isArray(gameCase.hints) || index < 0 || index >= gameCase.hints.length) return false;
  gameCase.hints.splice(index, 1);
  return true;
}

/** Every question of the case that needs hints 1-3: scenes, confrontations and deductions (CaseHintRules). */
export function hintTargets(gameCase: any): { contextType: string; targetId: string }[] {
  return [
    ...orderedScenes(gameCase).map((scene) => ({ contextType: 'SCENE', targetId: scene.sceneId })),
    ...(gameCase.evidenceChallenges ?? []).map((challenge) => ({ contextType: 'CONFRONTATION', targetId: challenge.challengeId })),
    ...(gameCase.deductions ?? []).map((deduction) => ({ contextType: 'DEDUCTION', targetId: deduction.deductionId })),
  ].filter((target) => target.targetId);
}

/** Levels 1-3 that have no written hint yet for one target. */
export function missingHintLevels(gameCase: any, contextType: string, targetId: string): number[] {
  const written = hintsFor(gameCase, contextType, targetId).filter(({ hint }) => String(hint.text ?? '').trim()).map(({ hint }) => hint.order);
  return [1, 2, 3].filter((level) => !written.includes(level));
}
