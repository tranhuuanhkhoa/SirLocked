import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SNAP, LIBRARY_FEET_ANCHOR, orderedScenes, sceneObjects, getGeometry, translateGeometry, resizeGeometry, setGeometry,
  hitTest, onResizeHandle, sceneGrid, paintGrid, reachability, findReferences, evidenceDependencies, deleteEvidence,
  swapNpcLook, libraryLook, safeAssetUrl, characterLines, writeText, readPath, issueTarget, issuesByObject, createHistory,
  hintIssues, objectKey,
} from '../Client/js/editor/model.ts';

/** The tutorial case: the pixel standard every editor rule is checked against. */
const tutorial = () => JSON.parse(readFileSync(new URL('../../BE/SeedData/V3/case-pixel-tan-thu-vi.json', import.meta.url), 'utf8'));
const tea = (gameCase) => orderedScenes(gameCase).find((scene) => scene.sceneId === 'scene-tt-tra-lau');

test('a scene lists its NPCs, items, clue zones, doors and spawn points with names', () => {
  const gameCase = tutorial();
  const objects = sceneObjects(gameCase, tea(gameCase));
  const kinds = objects.map((object) => object.kind);
  assert.equal(kinds.filter((kind) => kind === 'npc').length, 2);
  assert.equal(kinds.filter((kind) => kind === 'item').length, 2);
  assert.equal(kinds.filter((kind) => kind === 'clue').length, 1);
  assert.equal(kinds.filter((kind) => kind === 'door').length, 1);
  assert.equal(kinds.filter((kind) => kind === 'spawn').length, 4);
  const luu = objects.find((object) => object.id === 'char-tt-ong-luu');
  assert.equal(luu.label, gameCase.characters.find((entry) => entry.characterId === 'char-tt-ong-luu').name);
  assert.deepEqual(luu.point, { x: 820, y: 1712 });
  assert.equal(luu.resizable, false);
  assert.ok(objects.find((object) => object.kind === 'door').resizable);
});

test('dragging snaps to the native pixel grid, stays in the scene and moves an NPC with its talk box', () => {
  const gameCase = tutorial();
  const scene = tea(gameCase);
  const start = getGeometry(scene, { kind: 'npc', id: 'char-tt-ong-luu' });
  const moved = translateGeometry(start, 101, -37);
  assert.equal(moved.box.x % SNAP, 0);
  assert.equal(moved.box.y % SNAP, 0);
  assert.equal(moved.point.x - start.point.x, moved.box.x - start.box.x);
  assert.equal(moved.point.y - start.point.y, moved.box.y - start.box.y);
  const far = translateGeometry(start, 99999, 99999);
  assert.equal(far.box.x + far.box.width, 2048);
  assert.equal(far.box.y + far.box.height, 2048);
  const back = translateGeometry(start, -99999, -99999);
  assert.deepEqual([back.box.x, back.box.y], [0, 0]);

  assert.ok(setGeometry(scene, { kind: 'npc', id: 'char-tt-ong-luu' }, moved));
  const placement = scene.runtime.characterPlacements.find((entry) => entry.characterId === 'char-tt-ong-luu');
  assert.deepEqual(placement.hotspot, moved.box);
  assert.equal(placement.position.x, moved.point.x);
  const hotspot = scene.hotspots.find((entry) => entry.targetId === 'char-tt-ong-luu');
  assert.equal(hotspot.x, Math.round(moved.box.x / 2048 * 100 * 1000) / 1000);
});

test('an item box keeps its anchor at its bottom centre; resizing snaps and keeps a minimum size', () => {
  const gameCase = tutorial();
  const scene = tea(gameCase);
  const ref = { kind: 'item', id: scene.runtime.itemPlacements[0].itemId };
  const start = getGeometry(scene, ref);
  const bigger = resizeGeometry(start, 33, 18);
  assert.equal(bigger.box.width % SNAP, 0);
  assert.equal(bigger.box.height % SNAP, 0);
  const tiny = resizeGeometry(start, -5000, -5000);
  assert.deepEqual([tiny.box.width, tiny.box.height], [16, 16]);
  setGeometry(scene, ref, bigger);
  const placement = scene.runtime.itemPlacements[0];
  assert.equal(placement.position.x, bigger.box.x + bigger.box.width / 2);
  assert.equal(placement.position.y, bigger.box.y + bigger.box.height);
  assert.equal(scene.hotspots.find((entry) => entry.targetId === ref.id).width, Math.round(bigger.box.width / 2048 * 100000) / 1000);
});

test('hit testing prefers the smallest box under the pointer and finds the resize corner', () => {
  const objects = [
    { kind: 'door', id: 'big', box: { x: 0, y: 0, width: 400, height: 400 }, resizable: true },
    { kind: 'clue', id: 'small', box: { x: 100, y: 100, width: 40, height: 40 }, resizable: true },
  ];
  assert.equal(hitTest(objects, { x: 120, y: 120 }).id, 'small');
  assert.equal(hitTest(objects, { x: 300, y: 300 }).id, 'big');
  assert.equal(hitTest(objects, { x: 500, y: 500 }), null);
  assert.ok(onResizeHandle(objects[1], { x: 139, y: 141 }, 8));
  assert.ok(!onResizeHandle(objects[1], { x: 110, y: 110 }, 8));
  assert.ok(!onResizeHandle({ ...objects[1], resizable: false }, { x: 140, y: 140 }, 8));
});

test('the bundled tutorial passes "Kiểm đường đi" like it passes the server gate', () => {
  const gameCase = tutorial();
  for (const scene of orderedScenes(gameCase)) {
    const result = reachability(scene);
    assert.ok(result.checked, scene.sceneId);
    assert.ok(result.spawnOk, scene.sceneId);
    assert.deepEqual([...result.unreachable], [], scene.sceneId);
  }
});

test('painting obstacles makes an item unreachable and painting the floor back fixes it', () => {
  const gameCase = tutorial();
  const scene = tea(gameCase);
  const grid = sceneGrid(scene);
  const placement = scene.runtime.itemPlacements.find((entry) => entry.itemId === 'item-tt-so-khach');
  const box = placement.hotspot;
  const key = objectKey({ kind: 'item', id: placement.itemId });
  const before = grid.data.slice();

  // An island: a ring of obstacles around the bottom of the box with floor inside it, cut off from the spawn.
  const cx = box.x + box.width / 2, cy = box.y + box.height;
  const spawn = scene.runtime.spawnPoints.default;
  assert.ok(Math.abs(spawn.x - cx) > 15 * 16 || Math.abs(spawn.y - cy) > 15 * 16, 'the spawn stays outside the ring');
  const changed = paintGrid(grid, cx, cy, 31, '0');
  assert.ok(changed > 0);
  assert.equal(paintGrid(grid, cx, cy, 31, '0'), 0, 'painting the same again changes nothing');
  paintGrid(grid, cx, cy, 15, '1');
  assert.ok(grid.data.every((row) => row.length === grid.cols && /^[01]+$/.test(row)));
  const blocked = reachability(scene);
  assert.ok(blocked.unreachable.has(key));
  assert.ok(!blocked.unreachable.has('door:scene-tt-ngo'), 'the rest of the room is still reachable');

  grid.data.splice(0, grid.data.length, ...before);
  assert.ok(!reachability(scene).unreachable.has(key));
});

test('a default spawn on a blocked cell marks everything unreachable', () => {
  const gameCase = tutorial();
  const scene = tea(gameCase);
  const spawn = scene.runtime.spawnPoints.default;
  paintGrid(sceneGrid(scene), spawn.x, spawn.y, 1, '0');
  const result = reachability(scene);
  assert.ok(result.checked);
  assert.equal(result.spawnOk, false);
  assert.ok(result.unreachable.has('spawn:default'));
  assert.ok(result.unreachable.size >= sceneObjects(gameCase, scene).length - 0);
});

test('before deleting a clue the owner sees what still uses it; deleting removes its zone too', () => {
  const gameCase = tutorial();
  const zone = orderedScenes(gameCase).flatMap((scene) => scene.runtime.clueZones)[0];
  const clueId = zone.clueId;
  const all = findReferences(gameCase, clueId, `clues[${gameCase.clues.findIndex((clue) => clue.clueId === clueId)}]`);
  assert.ok(all.some((reference) => /clueZones\[\d+\]\.clueId$/.test(reference.path)));
  assert.ok(!all.some((reference) => /^clues\[\d+\]\.clueId$/.test(reference.path)), 'its own id is not a use');

  assert.deepEqual(evidenceDependencies(gameCase, 'clue', clueId), [], 'its scene zone goes with it, so it is no warning');
  const used = evidenceDependencies(gameCase, 'clue', 'evidence-tt-so-khach').map((reference) => reference.path);
  assert.ok(used.includes('evidenceChallenges[0].correctEvidenceId'));
  assert.ok(used.includes('finalLogic.requiredEvidenceLinks[2].evidenceId'));
  assert.ok(used.includes('items[0].unlockClueIds[0]'));

  assert.ok(deleteEvidence(gameCase, 'clue', clueId));
  assert.ok(!gameCase.clues.some((clue) => clue.clueId === clueId));
  assert.ok(!orderedScenes(gameCase).some((scene) => scene.runtime.clueZones.some((entry) => entry.clueId === clueId)));
  assert.equal(deleteEvidence(gameCase, 'clue', clueId), false);
});

test('deleting an item removes its box, its percent hotspot and its scene listing', () => {
  const gameCase = tutorial();
  const scene = tea(gameCase);
  const itemId = scene.runtime.itemPlacements[0].itemId;
  assert.ok(deleteEvidence(gameCase, 'item', itemId));
  assert.ok(!gameCase.items.some((item) => item.itemId === itemId));
  assert.ok(!scene.runtime.itemPlacements.some((entry) => entry.itemId === itemId));
  assert.ok(!scene.hotspots.some((entry) => entry.targetId === itemId));
  assert.ok(!scene.itemIds.includes(itemId));
});

test('an NPC takes a library face and keeps its id, name and lines', () => {
  const gameCase = tutorial();
  const character = gameCase.characters[0];
  const { characterId, name } = character;
  const lines = JSON.stringify(characterLines(gameCase, characterId));
  const entry = {
    key: 'v-npc-quan-gia', kind: 'NPC', url: '/assets/pixel/library/npc/v-npc-quan-gia/portrait.png',
    files: { idle: '/assets/pixel/library/npc/v-npc-quan-gia/idle.png', portrait: '/assets/pixel/library/npc/v-npc-quan-gia/portrait.png' },
  };
  assert.ok(swapNpcLook(gameCase, characterId, entry));
  assert.equal(character.characterId, characterId);
  assert.equal(character.name, name);
  assert.equal(character.imageUrl, entry.files.portrait);
  assert.deepEqual(character.presentation.spriteSheet, {
    url: entry.files.idle, frameWidth: 128, frameHeight: 128, frameCount: 9, fps: 6, idleFrames: [], anchorX: 0.5, anchorY: LIBRARY_FEET_ANCHOR,
  });
  assert.equal(JSON.stringify(characterLines(gameCase, characterId)), lines);

  assert.equal(libraryLook({ ...entry, files: {} }), null, 'no idle sheet, no swap');
  assert.equal(libraryLook({ ...entry, retired: true }), null);
  assert.equal(libraryLook({ ...entry, kind: 'PROP' }), null);
  assert.equal(swapNpcLook(gameCase, characterId, { ...entry, files: { idle: 'javascript:alert(1)', portrait: entry.url } }), false);
  assert.equal(swapNpcLook(gameCase, 'char-khong-co', entry), false);
  assert.ok(safeAssetUrl('https://res.cloudinary.com/x.png'));
  assert.ok(!safeAssetUrl('http://x.example/a.png'));
  assert.ok(!safeAssetUrl('/assets/../etc/passwd'));
});

test('lines of a character are listed with their paths and written back as text only', () => {
  const gameCase = tutorial();
  const characterId = gameCase.dialogues[0].characterId;
  const lines = characterLines(gameCase, characterId);
  assert.ok(lines.length >= 2);
  const answer = lines.find((line) => line.path.endsWith('.answer'));
  assert.equal(readPath(gameCase, answer.path), answer.text);
  assert.ok(writeText(gameCase, answer.path, 'Câu trả lời mới.'));
  assert.equal(readPath(gameCase, answer.path), 'Câu trả lời mới.');
  assert.equal(writeText(gameCase, 'dialogues[0].requiredClueIds', 'x'), false, 'not a text field');
  assert.equal(writeText(gameCase, 'dialogues[0].khongCo', 'x'), false, 'no new keys');
  assert.equal(writeText(gameCase, 'dialogues[999].answer', 'x'), false);
  assert.equal(writeText(gameCase, 'bad path!', 'x'), false);
});

test('validation errors point at the object they are about', () => {
  const gameCase = tutorial();
  const scene = tea(gameCase);
  const itemId = scene.runtime.itemPlacements[0].itemId;
  assert.deepEqual(issueTarget(gameCase, { path: `scene:${scene.sceneId}.runtime.itemPlacements[${itemId}].hotspot` }),
    { type: 'object', sceneId: scene.sceneId, ref: { kind: 'item', id: itemId } });
  assert.deepEqual(issueTarget(gameCase, { path: `scene:${scene.sceneId}.runtime.transitions[scene-tt-ngo].hotspot` }),
    { type: 'object', sceneId: scene.sceneId, ref: { kind: 'door', id: 'scene-tt-ngo' } });
  assert.deepEqual(issueTarget(gameCase, { path: `scene:${scene.sceneId}.runtime.spawnPoints.default` }),
    { type: 'object', sceneId: scene.sceneId, ref: { kind: 'spawn', id: 'default' } });
  assert.deepEqual(issueTarget(gameCase, { path: `scene:${scene.sceneId}.runtime.render.walkGrid` }),
    { type: 'scene', sceneId: scene.sceneId, part: 'grid' });
  assert.deepEqual(issueTarget(gameCase, { path: 'stages[0].scenes[0].runtime.characterPlacements[1].hotspot' }).type, 'object');
  assert.deepEqual(issueTarget(gameCase, { path: 'items[0].imageUrl' }), { type: 'evidence', kind: 'item', id: gameCase.items[0].itemId });
  assert.deepEqual(issueTarget(gameCase, { path: 'characters[1].presentation.spriteSheet' }), { type: 'character', id: gameCase.characters[1].characterId });
  assert.equal(issueTarget(gameCase, { path: 'dialogues[0].answer' }).type, 'lines');
  assert.deepEqual(issueTarget(gameCase, { path: 'hints[SCENE:scene-tt-ngo]', code: 'MissingHintLevel' }), { type: 'hints' });
  assert.deepEqual(issueTarget(gameCase, { path: 'finalLogic', refId: scene.sceneId }), { type: 'scene', sceneId: scene.sceneId, part: 'scene' });
  assert.deepEqual(issueTarget(gameCase, { path: 'whatever' }), { type: 'case' });

  const marks = issuesByObject(gameCase, [
    { code: 'HotspotUnreachable', path: `scene:${scene.sceneId}.runtime.itemPlacements[${itemId}]` },
    { code: 'PortraitMissing', path: `characters[${gameCase.characters.findIndex((entry) => entry.characterId === 'char-tt-ong-luu')}].imageUrl` },
    { code: 'Other', path: 'scene:scene-tt-ngo.runtime.transitions[scene-tt-tra-lau].hotspot' },
  ], scene.sceneId);
  assert.ok(marks.has(`item:${itemId}`));
  assert.ok(marks.has('npc:char-tt-ong-luu'));
  assert.equal(marks.size, 2);
  assert.equal(hintIssues([{ code: 'MissingHintLevel' }, { code: 'DuplicateHintLevel' }, { code: 'Other', path: 'hints' }]).length, 2);
});

test('undo and redo walk the snapshots one gesture at a time', () => {
  const history = createHistory('a', 3);
  assert.equal(history.canUndo(), false);
  assert.equal(history.push('a'), false, 'same state is no step');
  history.push('b');
  history.push('c');
  assert.equal(history.undo(), 'b');
  assert.equal(history.undo(), 'a');
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), 'b');
  history.push('x');
  assert.equal(history.canRedo(), false, 'a new edit drops the redo branch');
  for (const state of ['d', 'e', 'f', 'g']) history.push(state);
  let steps = 0;
  while (history.undo() !== null) steps++;
  assert.equal(steps, 3, 'only the newest snapshots are kept');
  history.reset('z');
  assert.equal(history.current, 'z');
  assert.equal(history.canUndo(), false);
});

test('two saved copies are compared by the parts the owner edits', async () => {
  const { changedSections } = await import('../Client/js/editor/model.ts');
  const a = tutorial();
  const b = tutorial();
  assert.deepEqual(changedSections(a, b), []);
  b.title = 'Khác';
  b.dialogues[0].answer = 'Khác';
  orderedScenes(b)[0].runtime.itemPlacements[0].hotspot.x += 4;
  b.status = 'PUBLISHED';
  assert.deepEqual(changedSections(a, b), ['tên vụ', 'bố cục cảnh', 'lời thoại']);
});

test('a missing hint level is read from the issue and filled in with a unique id', async () => {
  const { parseHintIssue, hintsFor, addHint, removeHint } = await import('../Client/js/editor/model.ts');
  const gameCase = tutorial();
  const issue = { code: 'MissingHintLevel', path: 'hints[SCENE:scene-tt-ngo]', message: "SCENE 'scene-tt-ngo' needs hints at order 1, 2 and 3; missing order 1, 3." };
  assert.deepEqual(parseHintIssue(issue), { contextType: 'SCENE', targetId: 'scene-tt-ngo', missing: [1, 3] });
  assert.deepEqual(parseHintIssue({ code: 'DuplicateHintLevel', path: 'hints[DEDUCTION:d-1]', message: '' }), { contextType: 'DEDUCTION', targetId: 'd-1', missing: [] });
  assert.equal(parseHintIssue({ path: 'puzzles[0].solution.hints' }), null);

  const before = hintsFor(gameCase, 'SCENE', 'scene-tt-ngo');
  assert.ok(before.length >= 3);
  assert.deepEqual(before.map(({ hint }) => hint.order), [...before.map(({ hint }) => hint.order)].sort((a, b) => a - b));
  const id = addHint(gameCase, 'SCENE', 'scene-tt-ngo', 2, '  Nhìn kỹ hòm gỗ.  ');
  assert.ok(id);
  const again = addHint(gameCase, 'SCENE', 'scene-tt-ngo', 2, 'Lần nữa');
  assert.notEqual(again, id);
  assert.equal(addHint(gameCase, 'SCENE', 'scene-tt-ngo', 4, 'x'), null);
  assert.equal(addHint(gameCase, 'SCENE', 'scene-tt-ngo', 1, '   '), null);
  const after = hintsFor(gameCase, 'SCENE', 'scene-tt-ngo');
  assert.equal(after.length, before.length + 2);
  assert.equal(after.find(({ hint }) => hint.hintId === id).hint.text, 'Nhìn kỹ hòm gỗ.');
  assert.ok(removeHint(gameCase, after.find(({ hint }) => hint.hintId === again).index));
  assert.equal(removeHint(gameCase, 9999), false);
});

test('every scene, confrontation and deduction is a hint target; missing levels are found locally', async () => {
  const { hintTargets, missingHintLevels } = await import('../Client/js/editor/model.ts');
  const gameCase = tutorial();
  const targets = hintTargets(gameCase);
  assert.ok(targets.some((target) => target.contextType === 'SCENE' && target.targetId === 'scene-tt-ngo'));
  assert.equal(targets.filter((target) => target.contextType === 'SCENE').length, 2);
  assert.equal(targets.filter((target) => target.contextType === 'CONFRONTATION').length, gameCase.evidenceChallenges.length);
  for (const target of targets) assert.deepEqual(missingHintLevels(gameCase, target.contextType, target.targetId), [], `${target.contextType}:${target.targetId}`);
  const hint = gameCase.hints.find((entry) => entry.targetId === 'scene-tt-ngo' && entry.order === 2);
  hint.text = '   ';
  assert.deepEqual(missingHintLevels(gameCase, 'SCENE', 'scene-tt-ngo'), [2]);
});
