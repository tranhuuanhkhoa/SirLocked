import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePath, findApproachPath, findPath, isNavigable, nearestNavigablePoint, segmentIsClear }
  from '../Client/js/game/navigation.ts';

const floor = { x: 0, y: 0, width: 1000, height: 600 };
const empty = { bounds: floor, obstacles: [], padding: 14 };

test('empty rectangular legacy floor supports 2D movement, zero distance and rejects invalid points', () => {
  const from = { x: 80, y: 150 }, goal = { x: 870, y: 450 };
  assert.deepEqual(findPath(from, goal, empty), [goal]);
  assert.deepEqual(findPath(from, from, empty), []);
  assert.equal(findPath(from, { x: -1, y: 20 }, empty), null);
  assert.equal(findPath(from, { x: Number.NaN, y: 20 }, empty), null);
});

test('deterministic route bends around padded obstacles and every segment is collision-free', () => {
  const world = { ...empty, obstacles: [{ x: 400, y: 160, width: 180, height: 230 }] };
  const from = { x: 80, y: 250 }, goal = { x: 870, y: 250 };
  const path = findPath(from, goal, world);
  assert.ok(path && path.length > 1);
  assert.deepEqual(findPath(from, goal, world), path);
  let previous = from;
  for (const point of path) {
    assert.ok(isNavigable(point, world));
    assert.ok(segmentIsClear(previous, point, world));
    previous = point;
  }
  assert.deepEqual(path.at(-1), goal);
});

test('a wall crossing the whole floor makes the other side unreachable, including a nearby interaction', () => {
  const world = { ...empty, obstacles: [{ x: 430, y: -50, width: 20, height: 700 }] };
  assert.equal(findPath({ x: 300, y: 250 }, { x: 700, y: 250 }, world), null);
  assert.equal(findApproachPath({ x: 400, y: 250 }, { x: 475, y: 200, width: 30, height: 60 }, world, 100), null);
});

test('interaction approaches a reachable item slot edge and projects wall-mounted hotspots onto the floor', () => {
  const world = { ...empty, obstacles: [{ x: 700, y: 180, width: 70, height: 90 }] };
  const path = findApproachPath({ x: 80, y: 250 }, { x: 700, y: 180, width: 70, height: 90 }, world, 65);
  assert.ok(path && path.length > 0);
  assert.ok(isNavigable(path.at(-1), world));
  assert.ok(path.at(-1).x < 700);
  const aboveFloor = { bounds: { x: 0, y: 400, width: 1000, height: 200 }, obstacles: [], padding: 14 };
  const wallPath = findApproachPath({ x: 40, y: 500 }, { x: 800, y: 150, width: 100, height: 80 }, aboveFloor);
  assert.ok(wallPath && wallPath.length);
  assert.ok(isNavigable(wallPath.at(-1), aboveFloor));
});

test('blocked authored spawn is repaired deterministically without crossing floor bounds', () => {
  const world = { ...empty, obstacles: [{ x: 100, y: 100, width: 200, height: 200 }] };
  const repaired = nearestNavigablePoint({ x: 110, y: 150 }, world);
  assert.ok(repaired && isNavigable(repaired, world));
  assert.deepEqual(repaired, nearestNavigablePoint({ x: 110, y: 150 }, world));
  assert.equal(nearestNavigablePoint({ x: 80, y: 250 }, { ...empty, obstacles: [{ x: -50, y: -50, width: 1100, height: 700 }] }), null);
});

test('waypoint travel is frame-rate independent, consumes segments once and never overshoots', () => {
  const start = { x: 0, y: 0 }, path = [{ x: 30, y: 0 }, { x: 30, y: 40 }];
  const first = advancePath(start, path, 50);
  assert.deepEqual(first.position, { x: 30, y: 20 });
  assert.equal(first.arrived, false);
  const final = advancePath(first.position, first.remaining, 200);
  assert.deepEqual(final, { position: { x: 30, y: 40 }, remaining: [], arrived: true });
  let position = start, remaining = path;
  for (let index = 0; index < 10; index++) ({ position, remaining } = advancePath(position, remaining, 5));
  assert.deepEqual(position, first.position);
  assert.deepEqual(remaining, first.remaining);
  assert.deepEqual(path, [{ x: 30, y: 0 }, { x: 30, y: 40 }], 'caller path is immutable');
});
