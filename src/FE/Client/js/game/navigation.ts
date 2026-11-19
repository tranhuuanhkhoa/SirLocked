/** Engine-neutral navigation in scene pixels. Actor positions are feet centres. */
export type NavigationPoint = { x: number; y: number };
export type NavigationRect = NavigationPoint & { width: number; height: number };
export type NavigationWorld = { bounds: NavigationRect; obstacles: NavigationRect[]; padding?: number; grid?: NavigationGrid };
/** Pixel scenes: one byte per cell, 1 = walkable feet position. Cells are square in scene pixels. */
export type NavigationGrid = { cellSize: number; cols: number; rows: number; cells: Uint8Array };

/** Parse the authored '0'/'1' row strings once per scene. Invalid data yields null (legacy movement). */
export function parseNavigationGrid(grid: { cellSize: number; cols: number; rows: number; data: string[] } | null | undefined): NavigationGrid | null {
  if (!grid || !(grid.cellSize > 0) || !Number.isInteger(grid.cols) || !Number.isInteger(grid.rows)
    || grid.cols <= 0 || grid.rows <= 0 || !Array.isArray(grid.data) || grid.data.length !== grid.rows) return null;
  const cells = new Uint8Array(grid.cols * grid.rows);
  for (let row = 0; row < grid.rows; row++) {
    const line = grid.data[row];
    if (typeof line !== 'string' || line.length !== grid.cols) return null;
    for (let col = 0; col < grid.cols; col++) cells[row * grid.cols + col] = line.charCodeAt(col) === 49 ? 1 : 0;
  }
  return { cellSize: grid.cellSize, cols: grid.cols, rows: grid.rows, cells };
}

function gridCell(grid: NavigationGrid, point: NavigationPoint) {
  return { col: Math.floor(point.x / grid.cellSize), row: Math.floor(point.y / grid.cellSize) };
}

function gridOpen(grid: NavigationGrid, col: number, row: number) {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows && grid.cells[row * grid.cols + col] === 1;
}

function gridWalkable(grid: NavigationGrid, point: NavigationPoint) {
  if (!finitePoint(point)) return false;
  const { col, row } = gridCell(grid, point);
  return gridOpen(grid, col, row);
}

function cellCentre(grid: NavigationGrid, col: number, row: number): NavigationPoint {
  return { x: (col + 0.5) * grid.cellSize, y: (row + 0.5) * grid.cellSize };
}

/** Sample the segment at quarter-cell steps; every sample must stand on a walkable cell. */
function gridSegmentClear(grid: NavigationGrid, from: NavigationPoint, to: NavigationPoint) {
  if (!gridWalkable(grid, from) || !gridWalkable(grid, to)) return false;
  const steps = Math.ceil(distance(from, to) / (grid.cellSize / 4));
  for (let index = 1; index < steps; index++) {
    const t = index / steps;
    if (!gridWalkable(grid, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })) return false;
  }
  return true;
}

/** Nearest walkable cell centre by breadth-first search (bounded), or null. */
function gridNearest(grid: NavigationGrid, point: NavigationPoint, maxCells = 96): NavigationPoint | null {
  if (!finitePoint(point)) return null;
  if (gridWalkable(grid, point)) return { ...point };
  const start = gridCell(grid, point);
  const col0 = Math.max(0, Math.min(grid.cols - 1, start.col)), row0 = Math.max(0, Math.min(grid.rows - 1, start.row));
  const seen = new Uint8Array(grid.cols * grid.rows);
  const queue: number[] = [row0 * grid.cols + col0];
  seen[queue[0]] = 1;
  let best: NavigationPoint | null = null, bestDistance = Number.POSITIVE_INFINITY;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head], col = index % grid.cols, row = Math.floor(index / grid.cols);
    if (Math.abs(col - col0) > maxCells || Math.abs(row - row0) > maxCells) continue;
    if (grid.cells[index] === 1) {
      const centre = cellCentre(grid, col, row), d = distance(centre, point);
      if (d < bestDistance) { best = centre; bestDistance = d; }
      // BFS rings grow by one cell; once a ring beyond the best distance is reached nothing closer remains.
      if (best && (Math.abs(col - col0) + Math.abs(row - row0)) * grid.cellSize > bestDistance + grid.cellSize * 2) break;
      continue;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const next = r * grid.cols + c;
      if (seen[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return best;
}

/** 8-connected A* without corner cutting, then string-pulled so routes are not stair-stepped. */
function gridFindPath(grid: NavigationGrid, from: NavigationPoint, destination: NavigationPoint): NavigationPoint[] | null {
  if (!gridWalkable(grid, from) || !gridWalkable(grid, destination)) return null;
  if (distance(from, destination) < 1e-6) return [];
  if (gridSegmentClear(grid, from, destination)) return [{ ...destination }];
  const start = gridCell(grid, from), goal = gridCell(grid, destination);
  const size = grid.cols * grid.rows, startIndex = start.row * grid.cols + start.col, goalIndex = goal.row * grid.cols + goal.col;
  const cost = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const heap: [number, number][] = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0;) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const left = i * 2 + 1, right = left + 1;
        let smallest = i;
        if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
        if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
        if (smallest === i) break;
        [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
        i = smallest;
      }
    }
    return top;
  };
  const heuristic = (col: number, row: number) => {
    const dx = Math.abs(col - goal.col), dy = Math.abs(row - goal.row);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  cost[startIndex] = 0;
  push([heuristic(start.col, start.row), startIndex]);
  while (heap.length) {
    const [, index] = pop();
    if (closed[index]) continue;
    closed[index] = 1;
    if (index === goalIndex) break;
    const col = index % grid.cols, row = Math.floor(index / grid.cols);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const c = col + dc, r = row + dr;
      if (!gridOpen(grid, c, r)) continue;
      if (dr && dc && (!gridOpen(grid, col + dc, row) || !gridOpen(grid, col, row + dr))) continue;
      const next = r * grid.cols + c;
      const candidate = cost[index] + (dr && dc ? Math.SQRT2 : 1);
      if (candidate < cost[next]) {
        cost[next] = candidate;
        previous[next] = index;
        push([candidate + heuristic(c, r), next]);
      }
    }
  }
  if (!closed[goalIndex]) return null;
  const cells: NavigationPoint[] = [];
  for (let index = previous[goalIndex]; index >= 0 && index !== startIndex; index = previous[index]) {
    cells.unshift(cellCentre(grid, index % grid.cols, Math.floor(index / grid.cols)));
  }
  const raw = [...cells, { ...destination }];
  const smoothed: NavigationPoint[] = [];
  let anchor = from;
  for (let index = 0; index < raw.length;) {
    let furthest = index;
    for (let probe = raw.length - 1; probe > index; probe--) {
      if (gridSegmentClear(grid, anchor, raw[probe])) { furthest = probe; break; }
    }
    smoothed.push(raw[furthest]);
    anchor = raw[furthest];
    index = furthest + 1;
  }
  return smoothed;
}

const EPSILON = 0.5;
const distance = (a: NavigationPoint, b: NavigationPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const finitePoint = (point: NavigationPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const validRect = (rect: NavigationRect) => finitePoint(rect)
  && Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0;

export function clampToBounds(point: NavigationPoint, bounds: NavigationRect): NavigationPoint {
  return { x: Math.max(bounds.x, Math.min(point.x, bounds.x + bounds.width)),
    y: Math.max(bounds.y, Math.min(point.y, bounds.y + bounds.height)) };
}

export function insideBounds(point: NavigationPoint, bounds: NavigationRect): boolean {
  return finitePoint(point) && validRect(bounds) && point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function expandedObstacles(world: NavigationWorld): NavigationRect[] {
  const padding = Number.isFinite(world.padding) ? Math.max(0, world.padding!) : 0;
  return world.obstacles.filter(validRect).map(rect => ({ x: rect.x - padding, y: rect.y - padding,
    width: rect.width + padding * 2, height: rect.height + padding * 2 }));
}

function insideRect(point: NavigationPoint, rect: NavigationRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function isNavigable(point: NavigationPoint, world: NavigationWorld): boolean {
  if (world.grid) return gridWalkable(world.grid, point);
  return insideBounds(point, world.bounds) && !expandedObstacles(world).some(rect => insideRect(point, rect));
}

/** Closed rectangle intersection: a wall touching a boundary cannot be bypassed along that edge. */
function crossesRect(from: NavigationPoint, to: NavigationPoint, rect: NavigationRect): boolean {
  let enter = 0, leave = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = to[axis] - from[axis];
    const low = rect[axis], high = low + (axis === 'x' ? rect.width : rect.height);
    if (Math.abs(delta) < 1e-9) {
      if (from[axis] < low || from[axis] > high) return false;
    } else {
      const a = (low - from[axis]) / delta, b = (high - from[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return false;
    }
  }
  return enter <= leave;
}

export function segmentIsClear(from: NavigationPoint, to: NavigationPoint, world: NavigationWorld): boolean {
  if (world.grid) return gridSegmentClear(world.grid, from, to);
  return insideBounds(from, world.bounds) && insideBounds(to, world.bounds)
    && !expandedObstacles(world).some(rect => crossesRect(from, to, rect));
}

function obstacleVertices(rect: NavigationRect): NavigationPoint[] {
  return [
    { x: rect.x - EPSILON, y: rect.y - EPSILON },
    { x: rect.x + rect.width + EPSILON, y: rect.y - EPSILON },
    { x: rect.x + rect.width + EPSILON, y: rect.y + rect.height + EPSILON },
    { x: rect.x - EPSILON, y: rect.y + rect.height + EPSILON },
  ];
}

/** Visibility graph + deterministic Dijkstra. Returns waypoints excluding the starting point. */
export function findPath(from: NavigationPoint, destination: NavigationPoint, world: NavigationWorld): NavigationPoint[] | null {
  if (world.grid) return gridFindPath(world.grid, from, destination);
  if (!isNavigable(from, world) || !isNavigable(destination, world)) return null;
  if (distance(from, destination) < 1e-6) return [];
  if (segmentIsClear(from, destination, world)) return [{ ...destination }];
  const obstacles = expandedObstacles(world);
  const vertices = obstacles.flatMap(obstacleVertices).filter(point => insideBounds(point, world.bounds)
    && !obstacles.some(rect => insideRect(point, rect)));
  const nodes = [from, destination, ...vertices];
  const cost = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  cost[0] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let index = 0; index < nodes.length; index++) {
      if (!visited.has(index) && Number.isFinite(cost[index]) && (current < 0 || cost[index] < cost[current])) current = index;
    }
    if (current < 0) return null;
    if (current === 1) {
      const path: NavigationPoint[] = [];
      for (let index = 1; index !== 0; index = previous[index]) path.unshift({ ...nodes[index] });
      return path;
    }
    visited.add(current);
    for (let next = 0; next < nodes.length; next++) {
      if (visited.has(next) || next === current || obstacles.some(rect => crossesRect(nodes[current], nodes[next], rect))) continue;
      const candidate = cost[current] + distance(nodes[current], nodes[next]);
      if (candidate < cost[next]) { cost[next] = candidate; previous[next] = current; }
    }
  }
  return null;
}

function pathLength(from: NavigationPoint, path: NavigationPoint[]): number {
  let length = 0, last = from;
  for (const point of path) { length += distance(last, point); last = point; }
  return length;
}

/** A wall-mounted hotspot projects onto the floor boundary below it. Reach remains bounded in floor space. */
export function findApproachPath(from: NavigationPoint, target: NavigationRect, world: NavigationWorld,
  reach = 100): NavigationPoint[] | null {
  if (!finitePoint(target) || !Number.isFinite(target.width) || !Number.isFinite(target.height)
    || target.width < 0 || target.height < 0 || !Number.isFinite(reach) || reach < 0) return null;
  if (world.grid) {
    // Pixel scenes: objects sit on walls and furniture; walk to the floor cell nearest their base.
    const approach = gridApproachPoint(world.grid, target);
    if (!approach) return null;
    if (gridWalkable(world.grid, from) && distance(from, approach) <= reach) return [];
    return gridFindPath(world.grid, from, approach);
  }
  const a = clampToBounds(target, world.bounds);
  const b = clampToBounds({ x: target.x + target.width, y: target.y + target.height }, world.bounds);
  const projected = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  const nearTarget = (point: NavigationPoint) => distance(point, clampToBounds(point, projected)) <= reach + 1e-6;
  const visibleTarget = (point: NavigationPoint) => {
    const end = clampToBounds(point, projected);
    // A solid object can be approached at its edge; intervening walls still block interaction.
    return !expandedObstacles(world).some(rect => !insideRect(end, rect) && crossesRect(point, end, rect));
  };
  if (isNavigable(from, world) && nearTarget(from) && visibleTarget(from)) return [];
  const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const nearest = clampToBounds(from, projected);
  const direction = distance(from, nearest);
  const candidates: NavigationPoint[] = [nearest, centre, a, b,
    { x: a.x, y: b.y }, { x: b.x, y: a.y }];
  if (direction > 0) candidates.unshift({ x: nearest.x + (from.x - nearest.x) * reach / direction,
    y: nearest.y + (from.y - nearest.y) * reach / direction });
  // Edge projections and corners also cover objects located inside a padded blocking slot.
  for (const rect of expandedObstacles(world)) {
    candidates.push(...obstacleVertices(rect),
      { x: rect.x - EPSILON, y: Math.max(rect.y - EPSILON, Math.min(centre.y, rect.y + rect.height + EPSILON)) },
      { x: rect.x + rect.width + EPSILON, y: Math.max(rect.y - EPSILON, Math.min(centre.y, rect.y + rect.height + EPSILON)) },
      { x: Math.max(rect.x - EPSILON, Math.min(centre.x, rect.x + rect.width + EPSILON)), y: rect.y - EPSILON },
      { x: Math.max(rect.x - EPSILON, Math.min(centre.x, rect.x + rect.width + EPSILON)), y: rect.y + rect.height + EPSILON });
  }
  // Sample the interaction perimeter so a partially covered target still has an accessible approach.
  for (let index = 0; index < 16; index++) {
    const angle = index * Math.PI / 8;
    candidates.push({ x: centre.x + Math.cos(angle) * reach, y: centre.y + Math.sin(angle) * reach });
  }
  let best: NavigationPoint[] | null = null, bestLength = Number.POSITIVE_INFINITY;
  for (const candidate of candidates.map(point => clampToBounds(point, world.bounds))) {
    if (!nearTarget(candidate) || !visibleTarget(candidate)) continue;
    const path = findPath(from, candidate, world);
    if (!path) continue;
    const length = pathLength(from, path);
    if (length < bestLength) { best = path; bestLength = length; }
  }
  return best;
}

/** Deterministically repair an authored spawn outside the floor or inside a legacy artwork slot. */
export function nearestNavigablePoint(point: NavigationPoint, world: NavigationWorld): NavigationPoint | null {
  if (world.grid) return gridNearest(world.grid, point);
  const clamped = clampToBounds(point, world.bounds);
  if (isNavigable(clamped, world)) return clamped;
  const candidates = expandedObstacles(world).flatMap(rect => [ ...obstacleVertices(rect),
    { x: rect.x - EPSILON, y: clamped.y }, { x: rect.x + rect.width + EPSILON, y: clamped.y },
    { x: clamped.x, y: rect.y - EPSILON }, { x: clamped.x, y: rect.y + rect.height + EPSILON } ]);
  const bounds = world.bounds;
  candidates.push({ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
  return candidates.filter(candidate => isNavigable(candidate, world))
    .sort((a, b) => distance(clamped, a) - distance(clamped, b))[0] ?? null;
}

/** Advance along every consumed segment; movement stays frame-rate independent and never overshoots. */
export function advancePath(from: NavigationPoint, path: NavigationPoint[], travel: number): {
  position: NavigationPoint; remaining: NavigationPoint[]; arrived: boolean;
} {
  let position = { ...from }, remaining = path.map(point => ({ ...point }));
  let budget = Number.isFinite(travel) ? Math.max(0, travel) : 0;
  while (remaining.length) {
    const next = remaining[0], length = distance(position, next);
    if (length > budget && length > 1e-6) {
      position = { x: position.x + (next.x - position.x) * budget / length,
        y: position.y + (next.y - position.y) * budget / length };
      break;
    }
    position = remaining.shift()!;
    budget -= length;
  }
  return { position, remaining, arrived: remaining.length === 0 };
}

/** Pixel scenes: the floor point a player walks to before using an object (its base, or the nearest floor). */
export function gridApproachPoint(grid: NavigationGrid, target: NavigationRect): NavigationPoint | null {
  return gridNearest(grid, { x: target.x + target.width / 2, y: target.y + target.height - 1 });
}
