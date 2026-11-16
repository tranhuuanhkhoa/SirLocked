import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  accusationMissing, accusationRequest, checkAudio, choiceTarget, conditionSatisfied, emptyProgress, estimatePlayTime,
  orderedScenes, planScene, progressFromState, solvePuzzle, type PlannedAction, type Progress,
} from '../src/playtest/solver.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const seed = (name: string) => JSON.parse(readFileSync(path.join(repoRoot, 'src', 'BE', 'SeedData', 'V3', name), 'utf8'));

test('solvePuzzle answers every interactive kind from its stored solution', () => {
  const kinds: Array<[string, Record<string, unknown>, Record<string, unknown>, unknown]> = [
    ['balance_scale', {}, { heavy: 3 }, { pick: 3 }],
    ['doc_forgery', {}, { marks: { date: 'uv', sign: 'rake' } }, { marks: { date: 'uv', sign: 'rake' } }],
    ['fingerprint', {}, { card: 'c2' }, { card: 'c2' }],
    ['gear_train', {}, { mount: { p1: 'g2' } }, { mount: { p1: 'g2' } }],
    ['lockpick', {}, { order: [3, 1, 2] }, { order: [3, 1, 2] }],
    ['music_box', {}, { melody: [5, 4, 3] }, { pins: [5, 4, 3] }],
    ['parallax_code', {}, { code: 'A7K' }, { code: 'A7K' }],
    ['reagent_mix', {}, { recipe: { y: 2, b: 1, r: 0 } }, { drops: { y: 2, b: 1, r: 0 } }],
    ['tilt_maze', {}, { moves: 'RDL' }, { moves: 'RDL' }],
  ];
  for (const [kind, params, solution, expected] of kinds) {
    const result = solvePuzzle({ puzzleId: `p-${kind}`, type: 'INTERACTIVE_PUZZLE', kind, params, solution });
    assert.ok(result, kind);
    assert.deepEqual(JSON.parse(result.request.answer), expected, kind);
    assert.deepEqual(result.probes, [], kind);
  }
  // Solutions stored as strings (paramsJson / solutionJson) are read too.
  const asString = solvePuzzle({ puzzleId: 'p', type: 'INTERACTIVE_PUZZLE', kind: 'fingerprint', solutionJson: '{"card":"c9"}' });
  assert.deepEqual(JSON.parse(asString!.request.answer), { card: 'c9' });
});

test('torn paper asks for the partner piece first and lays every piece upright at the origin', () => {
  const result = solvePuzzle({ puzzleId: 'p', type: 'INTERACTIVE_PUZZLE', kind: 'torn_paper', params: { pieceCount: 5, partnerPiece: 2 }, solution: {} });
  assert.deepEqual(result!.probes.map((probe) => JSON.parse(probe)), [{ handoff: true }]);
  const placed = JSON.parse(result!.request.answer).placed;
  assert.equal(placed.length, 5);
  assert.ok(placed.every((piece: any) => piece.x === 0 && piece.y === 0 && piece.r === 0));
  const solo = solvePuzzle({ puzzleId: 'p', type: 'INTERACTIVE_PUZZLE', kind: 'torn_paper', params: { pieceCount: 4, partnerPiece: 0 } });
  assert.deepEqual(solo!.probes, []);
});

test('classic puzzles use the code or the sequence; unknown kinds and missing solutions are not guessed', () => {
  assert.equal(solvePuzzle({ puzzleId: 'a', type: 'CODE_PUZZLE', correctCode: '2100' })!.request.answer, '2100');
  assert.deepEqual(solvePuzzle({ puzzleId: 'b', type: 'SEQUENCE_PUZZLE', correctSequence: ['x', 'y'] })!.request.answerSequence, ['x', 'y']);
  assert.equal(solvePuzzle({ puzzleId: 'c', type: 'INTERACTIVE_PUZZLE', kind: 'new_kind', solution: { any: 1 } }), null);
  assert.equal(solvePuzzle({ puzzleId: 'd', type: 'INTERACTIVE_PUZZLE', kind: 'lockpick', solution: {} }), null);
  assert.equal(solvePuzzle({ puzzleId: 'e', type: 'CODE_PUZZLE', correctCode: '' }), null);
});

test('complete conditions follow AND by default and OR by one fully met list', () => {
  const progress = { ...emptyProgress(), inspectedItemIds: ['i1'], unlockedClueIds: ['c1'] };
  assert.equal(conditionSatisfied({ requiredItemIds: ['i1'], requiredClueIds: ['c1'] }, progress), true);
  assert.equal(conditionSatisfied({ requiredItemIds: ['i1', 'i2'], requiredClueIds: ['c1'] }, progress), false);
  assert.equal(conditionSatisfied({ logic: 'OR', requiredItemIds: ['i2'], requiredClueIds: ['c1'] }, progress), true);
  assert.equal(conditionSatisfied({ logic: 'OR', requiredItemIds: ['i2'], requiredDialogueIds: ['d1'] }, progress), false);
  assert.equal(conditionSatisfied({}, progress), true);
});

test('conversation choices respect clue gates on the node, the choice and the target', () => {
  const root = { nodeId: 'r', characterId: 'ch', isRoot: true, requiredClueIds: [], choices: [] };
  const deep = { nodeId: 'n', characterId: 'ch', requiredClueIds: ['k'], choices: [] };
  const nodes = [root, deep];
  assert.equal(choiceTarget(root, { choiceId: 'x', nextNodeId: 'n', requiredClueIds: [] }, root, nodes, []), null);
  assert.equal(choiceTarget(root, { choiceId: 'x', nextNodeId: 'n', requiredClueIds: [] }, root, nodes, ['k'])?.nodeId, 'n');
  assert.equal(choiceTarget(root, { choiceId: 'x', nextNodeId: 'n', requiredClueIds: ['z'] }, root, nodes, ['k']), null);
  assert.equal(choiceTarget(deep, { choiceId: 'back', nextNodeId: '' }, root, nodes, ['k'])?.nodeId, 'r');
  assert.equal(choiceTarget(root, { choiceId: 'x', nextNodeId: 'missing' }, root, nodes, []), null);
});

test('progressFromState reads the game state API shape', () => {
  const progress = progressFromState({
    inspectedItemIds: ['i'], unlockedClueIds: ['c'], resolvedConfrontations: [{ challengeId: 'ch' }],
    solvedDeductions: [{ deductionId: 'd' }], visitedSceneIds: ['s'],
  });
  assert.deepEqual(progress.resolvedChallengeIds, ['ch']);
  assert.deepEqual(progress.solvedDeductionIds, ['d']);
  assert.deepEqual(progress.collectedItemIds, []);
});

test('the play-time estimate states its formula and grows with content', () => {
  const small = estimatePlayTime({ stages: [{ order: 1, scenes: [{ sceneId: 's1' }] }], finalLogic: {} });
  const big = estimatePlayTime(seed('case-pixel-lo-thuoc-thu-nam-vi.json'));
  assert.ok(big.minutes > small.minutes);
  assert.match(big.breakdown.formula, /chữ mỗi phút/);
  assert.equal(big.breakdown.counts.scenes, 6);
  assert.equal(big.breakdown.totalSeconds, Object.values(big.breakdown.seconds).reduce((sum, value) => sum + value, 0));
  assert.ok(big.minutes >= 15 && big.minutes <= 90, `estimate ${big.minutes} min`);
});

test('audio check: music per scene, weather outdoors only', () => {
  const caseJson = {
    stages: [{ order: 1, scenes: [
      { sceneId: 'out-rain', runtime: { indoor: false, weather: { type: 'RAIN', intensity: 0.7 }, audio: { music: { url: '/assets/a.ogg' } } } },
      { sceneId: 'out-dry', runtime: { indoor: false, audio: { music: { url: '/assets/b.ogg' } } } },
      { sceneId: 'in-wet', runtime: { indoor: true, weather: { type: 'SNOW', intensity: 0.3 } } },
      { sceneId: 'in-ok', runtime: { indoor: true, weather: { type: 'NONE' }, audio: { music: { url: '/assets/c.ogg' } } } },
    ] }],
  };
  const audio = checkAudio(caseJson);
  assert.deepEqual(audio.scenesWithoutMusic, ['in-wet']);
  assert.deepEqual(audio.outdoorScenesWithoutWeather, ['out-dry']);
  assert.deepEqual(audio.indoorScenesWithWeather, ['in-wet']);
  const old = checkAudio(seed('case-pixel-tram-hong-ngoc-vi.json'));
  assert.ok(old.notes.some((note) => note.includes('thời tiết')));
});

test('accusation request carries the final logic and the linked evidence', () => {
  const body = accusationRequest({
    finalLogic: {
      culpritId: 'c', correctMotiveId: 'm', correctMethodId: 'w', requiredEvidenceIds: ['e0'],
      requiredEvidenceLinks: [{ claimType: 'MOTIVE', evidenceId: 'e1' }, { claimType: 'METHOD', evidenceId: 'e0' }],
    },
  });
  assert.equal(body.culpritId, 'c');
  assert.deepEqual(body.evidenceIds, ['e0', 'e1']);
  assert.equal(body.evidenceLinks.length, 2);
});

/** A pure stand-in for the server rules, enough to replay the planner over a whole case. */
function simulate(caseJson: any): { progress: Progress; actions: PlannedAction[] } {
  const progress = emptyProgress();
  const scenes = orderedScenes(caseJson);
  const add = (list: string[], ids: unknown) => { for (const id of (Array.isArray(ids) ? ids : [])) if (!list.includes(id)) list.push(id); };
  progress.visitedSceneIds.push(scenes[0].sceneId);
  progress.unlockedSceneIds.push(scenes[0].sceneId);
  const done: PlannedAction[] = [];
  const complete = () => {
    for (const [index, scene] of scenes.entries()) {
      if (!progress.visitedSceneIds.includes(scene.sceneId) || progress.completedSceneIds.includes(scene.sceneId)) continue;
      if (!conditionSatisfied(scene.completeCondition, progress)) continue;
      progress.completedSceneIds.push(scene.sceneId);
      if (scenes[index + 1]) add(progress.unlockedSceneIds, [scenes[index + 1].sceneId]);
    }
  };
  for (let guard = 0; guard < 500; guard++) {
    let moved = false;
    for (const scene of scenes) {
      if (!progress.visitedSceneIds.includes(scene.sceneId) && !progress.unlockedSceneIds.includes(scene.sceneId)) continue;
      add(progress.visitedSceneIds, [scene.sceneId]);
      complete();
      const action = planScene(caseJson, scene, progress)[0];
      if (!action) continue;
      moved = true;
      done.push(action);
      switch (action.kind) {
        case 'inspect': {
          const item = caseJson.items.find((entry: any) => entry.itemId === action.itemId);
          add(progress.inspectedItemIds, [action.itemId]);
          if (item.isCollectible) add(progress.collectedItemIds, [action.itemId]);
          add(progress.unlockedClueIds, item.unlockClueIds);
          break;
        }
        case 'interaction':
          progress.usedInteractionIds.push(action.interaction.interactionId);
          progress.collectedItemIds = progress.collectedItemIds.filter((id) => !(action.interaction.consumeItemIds ?? []).includes(id));
          add(progress.collectedItemIds, action.interaction.unlockItemIds);
          add(progress.unlockedClueIds, action.interaction.unlockClueIds);
          add(progress.unlockedSceneIds, action.interaction.unlockSceneIds);
          break;
        case 'puzzle':
          progress.solvedPuzzleIds.push(action.puzzle.puzzleId);
          add(progress.collectedItemIds, action.puzzle.unlockItemIds);
          add(progress.unlockedClueIds, action.puzzle.unlockClueIds);
          add(progress.unlockedSceneIds, action.puzzle.unlockSceneIds);
          break;
        case 'ask': {
          const dialogue = caseJson.dialogues.find((entry: any) => entry.dialogueId === action.dialogueId);
          progress.askedDialogueIds.push(action.dialogueId);
          add(progress.unlockedClueIds, dialogue.unlockClueIds);
          break;
        }
        case 'converse': {
          const node = caseJson.conversationNodes.find((entry: any) => entry.nodeId === action.targetNodeId);
          progress.visitedConversationNodeIds.push(node.nodeId);
          add(progress.unlockedClueIds, node.unlockClueIds);
          if (node.sourceDialogueId) add(progress.askedDialogueIds, [node.sourceDialogueId]);
          break;
        }
        case 'crack':
          progress.resolvedChallengeIds.push(action.challenge.challengeId);
          add(progress.unlockedClueIds, action.challenge.unlockClueIds);
          break;
        case 'deduction': {
          const deduction = caseJson.deductions.find((entry: any) => entry.deductionId === action.deductionId);
          progress.solvedDeductionIds.push(action.deductionId);
          add(progress.unlockedClueIds, deduction.unlockClueIds);
          break;
        }
        case 'camera':
          progress.capturedClueIds.push(action.clueId);
          add(progress.unlockedClueIds, [action.clueId]);
          break;
      }
      complete();
    }
    if (!moved) break;
  }
  return { progress, actions: done };
}

for (const file of ['case-pixel-lo-thuoc-thu-nam-vi.json', 'case-pixel-tram-hong-ngoc-vi.json']) {
  test(`the planner alone reaches the accusation of ${file}`, () => {
    const caseJson = seed(file);
    // The seed leaves some interactive solutions empty: the server fills them on import (PuzzleKindRegistry.FillMissing),
    // and the playtest reads the stored case back. Stand in for that fill here.
    const stand = { heavy: 1, order: [1, 2, 3], card: 'c1', mount: { a: 'g1' }, melody: [1, 2], code: 'ABC', recipe: { y: 1, b: 0, r: 0 }, moves: 'R', marks: { a: 'uv' } };
    for (const puzzle of caseJson.puzzles) {
      if (puzzle.type === 'INTERACTIVE_PUZZLE' && !solvePuzzle(puzzle)) {
        puzzle.params = { ...(puzzle.params ?? {}), pieceCount: 4 };
        puzzle.solution = { ...(puzzle.solution ?? {}), ...stand };
        assert.ok(solvePuzzle(puzzle), `no answer for ${puzzle.kind}`);
      }
    }
    const { progress, actions } = simulate(caseJson);
    assert.deepEqual(accusationMissing(caseJson, progress), []);
    const kinds = new Set(actions.map((action) => action.kind));
    const expected = ['inspect', 'crack', ...(caseJson.deductions.length ? ['deduction'] : [])];
    for (const kind of expected) assert.ok(kinds.has(kind as any), `${file}: no ${kind}`);
    assert.ok(kinds.has('ask') || kinds.has('converse'), `${file}: nobody was questioned`);
    assert.ok(actions.filter((action) => action.kind === 'puzzle').length >= 1, `${file}: no puzzle`);
  });
}
