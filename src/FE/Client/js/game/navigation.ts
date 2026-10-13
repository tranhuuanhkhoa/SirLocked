/** Engine-neutral navigation in scene pixels. Actor positions are feet centres. */
export type NavigationPoint = { x: number; y: number };
export type NavigationRect = NavigationPoint & { width: number; height: number };
export type NavigationWorld = { bounds: NavigationRect; obstacles: NavigationRect[]; padding?: number };

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
