/**
 * Pure rules of the automatic player: the order of actions mirrors
 * CaseValidationService.ValidatePlaythroughReachability (src/BE), the answers come from the case itself.
 * Nothing here talks to the network, so it is unit-tested directly.
 */
import type { AudioChecks, EstimateBreakdown, Json } from './types.js';

export const V3_PAIRED = 3;
export const CAUSAL_FIVE_CLAIM = 2;

export type Role = 'INVESTIGATOR' | 'INTERROGATOR';

/** Shared progress of a room, as the game state API returns it. */
export interface Progress {
  inspectedItemIds: string[];
  collectedItemIds: string[];
  unlockedClueIds: string[];
  usedInteractionIds: string[];
  solvedPuzzleIds: string[];
  askedDialogueIds: string[];
  visitedConversationNodeIds: string[];
  capturedClueIds: string[];
  visitedSceneIds: string[];
  unlockedSceneIds: string[];
  completedSceneIds: string[];
  resolvedChallengeIds: string[];
  solvedDeductionIds: string[];
}

export function progressFromState(state: Json): Progress {
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  return {
    inspectedItemIds: list(state.inspectedItemIds),
    collectedItemIds: list(state.collectedItemIds),
    unlockedClueIds: list(state.unlockedClueIds),
    usedInteractionIds: list(state.usedInteractionIds),
    solvedPuzzleIds: list(state.solvedPuzzleIds),
    askedDialogueIds: list(state.askedDialogueIds),
    visitedConversationNodeIds: list(state.visitedConversationNodeIds),
    capturedClueIds: list(state.capturedClueIds),
    visitedSceneIds: list(state.visitedSceneIds),
    unlockedSceneIds: list(state.unlockedSceneIds),
    completedSceneIds: list(state.completedSceneIds),
    resolvedChallengeIds: (Array.isArray(state.resolvedConfrontations) ? state.resolvedConfrontations : [])
      .map((entry: Json) => String(entry.challengeId)),
    solvedDeductionIds: (Array.isArray(state.solvedDeductions) ? state.solvedDeductions : [])
      .map((entry: Json) => String(entry.deductionId)),
  };
}

/**
 * V3 rooms show each detective only their own discoveries (V3KnowledgeProjector), so the room's progress is
 * the union of both players' states.
 */
export function mergeProgress(...parts: Progress[]): Progress {
  const merged = emptyProgress();
  for (const part of parts) {
    for (const key of Object.keys(merged) as Array<keyof Progress>) {
      for (const id of part[key]) if (!merged[key].includes(id)) merged[key].push(id);
    }
  }
  return merged;
}

export function emptyProgress(): Progress {
  return {
    inspectedItemIds: [], collectedItemIds: [], unlockedClueIds: [], usedInteractionIds: [], solvedPuzzleIds: [],
    askedDialogueIds: [], visitedConversationNodeIds: [], capturedClueIds: [], visitedSceneIds: [], unlockedSceneIds: [],
    completedSceneIds: [], resolvedChallengeIds: [], solvedDeductionIds: [],
  };
}

const arr = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const eqi = (a: unknown, b: string) => str(a).trim().toUpperCase() === b;

export function orderedScenes(caseJson: Json): Json[] {
  return arr(caseJson.stages)
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .flatMap((stage) => arr(stage.scenes));
}

export function isOpenCoop(caseJson: Json): boolean {
  return eqi(caseJson.ruleSet, 'OPEN_COOP');
}

export function canEnterScene(caseJson: Json, progress: Progress, sceneId: string): boolean {
  return progress.visitedSceneIds.includes(sceneId) || progress.unlockedSceneIds.includes(sceneId)
    || (isOpenCoop(caseJson) && orderedScenes(caseJson).some((scene) => scene.sceneId === sceneId));
}

export function isTargetInScene(scene: Json, targetId: string): boolean {
  return arr(scene.itemIds).includes(targetId)
    || arr(scene.characterIds).includes(targetId)
    || arr(scene.hotspots).some((hotspot) => hotspot.targetId === targetId)
    || arr(scene.runtime?.transitions).some((transition) => transition.transitionId === targetId || transition.targetSceneId === targetId);
}

/** CompleteConditionProgress.Evaluate: AND by default; OR is satisfied by one fully met non-empty list. */
export function conditionSatisfied(condition: Json | undefined, progress: Progress): boolean {
  return missingForCondition(condition, progress).satisfied;
}

export function missingForCondition(condition: Json | undefined, progress: Progress): { satisfied: boolean; missing: string[] } {
  const items = arr(condition?.requiredItemIds).map(str);
  const clues = arr(condition?.requiredClueIds).map(str);
  const dialogues = arr(condition?.requiredDialogueIds).map(str);
  const missingItems = items.filter((id) => !progress.inspectedItemIds.includes(id));
  const missingClues = clues.filter((id) => !progress.unlockedClueIds.includes(id));
  const missingDialogues = dialogues.filter((id) => !progress.askedDialogueIds.includes(id));
  const missing = [
    ...missingItems.map((id) => `item ${id}`),
    ...missingClues.map((id) => `clue ${id}`),
    ...missingDialogues.map((id) => `dialogue ${id}`),
  ];
  if (!eqi(condition?.logic, 'OR')) return { satisfied: missing.length === 0, missing };
  const alternatives = [
    items.length ? missingItems.length : -1,
    dialogues.length ? missingDialogues.length : -1,
    clues.length ? missingClues.length : -1,
  ].filter((count) => count >= 0);
  return { satisfied: alternatives.some((count) => count === 0), missing };
}

// ------------------------------------------------------------------ puzzles

export interface PuzzleSolution {
  /** Body for POST solve-puzzle. */
  request: { puzzleId: string; answer: string; answerSequence: string[] };
  /** Payloads for POST puzzle-probe before the answer (JSON strings). */
  probes: string[];
}

function objectOf(value: unknown): Json {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
}

export const PUZZLE_KINDS = ['balance_scale', 'doc_forgery', 'fingerprint', 'gear_train', 'lockpick', 'music_box',
  'parallax_code', 'reagent_mix', 'tilt_maze', 'torn_paper'] as const;

/**
 * The winning answer of one puzzle, read from the stored case (the server fills missing solutions on import,
 * so use the case read back from the admin API). Null when the kind is unknown or the solution is missing.
 */
export function solvePuzzle(puzzle: Json): PuzzleSolution | null {
  const puzzleId = str(puzzle.puzzleId);
  const type = str(puzzle.type).trim().toUpperCase();
  if (type === 'CODE_PUZZLE') {
    const code = str(puzzle.correctCode);
    return code ? { request: { puzzleId, answer: code, answerSequence: [] }, probes: [] } : null;
  }
  if (type !== 'INTERACTIVE_PUZZLE') {
    const sequence = arr(puzzle.correctSequence).map(str);
    return sequence.length ? { request: { puzzleId, answer: '', answerSequence: sequence }, probes: [] } : null;
  }
  const params = objectOf(puzzle.params ?? puzzle.paramsJson);
  const solution = objectOf(puzzle.solution ?? puzzle.solutionJson);
  const kind = str(puzzle.kind).trim();
  let answer: Json | null = null;
  const probes: string[] = [];
  switch (kind) {
    case 'balance_scale': answer = solution.heavy !== undefined ? { pick: Number(solution.heavy) } : null; break;
    case 'doc_forgery': answer = solution.marks ? { marks: solution.marks } : null; break;
    case 'fingerprint': answer = solution.card ? { card: str(solution.card) } : null; break;
    case 'gear_train': answer = solution.mount ? { mount: solution.mount } : null; break;
    case 'lockpick': answer = Array.isArray(solution.order) ? { order: solution.order } : null; break;
    case 'music_box': answer = Array.isArray(solution.melody) ? { pins: solution.melody } : null; break;
    case 'parallax_code': answer = solution.code ? { code: str(solution.code) } : null; break;
    case 'reagent_mix': answer = solution.recipe ? { drops: solution.recipe } : null; break;
    case 'tilt_maze': answer = solution.moves ? { moves: str(solution.moves) } : null; break;
    case 'torn_paper': {
      const count = Number(params.pieceCount ?? 0);
      if (count > 0) {
        if (Number(params.partnerPiece ?? 0) > 0) probes.push(JSON.stringify({ handoff: true }));
        answer = { placed: Array.from({ length: count }, (_, index) => ({ id: index + 1, x: 0, y: 0, r: 0 })) };
      }
      break;
    }
    default: answer = null;
  }
  return answer ? { request: { puzzleId, answer: JSON.stringify(answer), answerSequence: [] }, probes } : null;
}

// ------------------------------------------------------------------ conversations

export function sceneConversationNodes(caseJson: Json, scene: Json, characterId: string): Json[] {
  const contract = Number(caseJson.logicContractVersion ?? 0);
  return arr(caseJson.conversationNodes)
    .filter((node) => node.characterId === characterId)
    .filter((node) => contract < CAUSAL_FIVE_CLAIM || arr(node.availableSceneIds).includes(scene.sceneId));
}

/** GameplayConversationRules.ResolveTransition: null when the choice is locked or leads nowhere. */
export function choiceTarget(current: Json, choice: Json, root: Json, nodes: Json[], unlocked: string[]): Json | null {
  const has = (ids: unknown) => arr(ids).every((id) => unlocked.includes(str(id)));
  if (!has(current.requiredClueIds) || !has(choice.requiredClueIds)) return null;
  let reached = root;
  if (str(choice.nextNodeId)) {
    const target = nodes.find((node) => node.nodeId === choice.nextNodeId);
    if (!target) return null;
    reached = target;
  }
  if (reached.characterId !== current.characterId || !has(reached.requiredClueIds)) return null;
  return reached;
}

// ------------------------------------------------------------------ planning

export type PlannedAction =
  | { kind: 'inspect'; actor: Role; itemId: string }
  | { kind: 'interaction'; actor: Role; interaction: Json }
  | { kind: 'puzzle'; actor: Role; puzzle: Json; solution: PuzzleSolution }
  | { kind: 'ask'; actor: Role; dialogueId: string }
  | { kind: 'converse'; actor: Role; characterId: string; nodeId: string; choiceId?: string; targetNodeId: string }
  | { kind: 'crack'; actor: Role; challenge: Json }
  | { kind: 'deduction'; actor: Role; deductionId: string; optionId: string }
  | { kind: 'camera'; actor: Role; sceneId: string; clueId: string; bounds: Json };

export function actionKey(action: PlannedAction): string {
  switch (action.kind) {
    case 'inspect': return `inspect:${action.itemId}`;
    case 'interaction': return `interaction:${action.interaction.interactionId}`;
    case 'puzzle': return `puzzle:${action.puzzle.puzzleId}`;
    case 'ask': return `ask:${action.dialogueId}`;
    case 'converse': return `converse:${action.nodeId}:${action.choiceId ?? ''}`;
    case 'crack': return `crack:${action.challenge.challengeId}`;
    case 'deduction': return `deduction:${action.deductionId}`;
    case 'camera': return `camera:${action.clueId}`;
  }
}

function discoverMethod(clue: Json): string {
  return (str(clue.discoverMethod).trim() || str(clue.sourceType).trim()).toLowerCase();
}

/** Every action that the rules allow right now in one scene, in the reachability simulator's order. */
export function planScene(caseJson: Json, scene: Json, progress: Progress, skip: ReadonlySet<string> = new Set()): PlannedAction[] {
  const actions: PlannedAction[] = [];
  const unlocked = progress.unlockedClueIds;
  const has = (ids: unknown) => arr(ids).every((id) => unlocked.includes(str(id)));
  const push = (action: PlannedAction) => { if (!skip.has(actionKey(action))) actions.push(action); };
  const contract = Number(caseJson.logicContractVersion ?? 0);
  const items = new Map(arr(caseJson.items).map((item) => [item.itemId, item]));

  for (const itemId of arr(scene.itemIds).map(str)) {
    if (progress.inspectedItemIds.includes(itemId) || !items.has(itemId)) continue;
    const hotspot = arr(scene.hotspots).find((entry) => eqi(entry.type, 'ITEM') && entry.targetId === itemId);
    if (hotspot && !has(hotspot.requiredClueIds)) continue;
    push({ kind: 'inspect', actor: 'INVESTIGATOR', itemId });
  }

  for (const interaction of arr(caseJson.interactions)) {
    if (progress.usedInteractionIds.includes(interaction.interactionId)) continue;
    if (!arr(interaction.requiredItemIds).every((id) => progress.collectedItemIds.includes(str(id)))) continue;
    if (!has(interaction.requiredClueIds)) continue;
    const type = str(interaction.type).toUpperCase();
    if (type === 'COMBINE_ITEMS') {
      if (arr(interaction.requiredItemIds).length < 2) continue;
    } else if (type === 'USE_ITEM_ON_TARGET' || type === 'INSPECT_ENVIRONMENT') {
      if (!isTargetInScene(scene, str(interaction.targetId))) continue;
      if (type === 'USE_ITEM_ON_TARGET' && arr(interaction.requiredItemIds).length === 0) continue;
    } else continue;
    push({ kind: 'interaction', actor: 'INVESTIGATOR', interaction });
  }

  for (const puzzle of arr(caseJson.puzzles)) {
    if (progress.solvedPuzzleIds.includes(puzzle.puzzleId)) continue;
    if (!isTargetInScene(scene, str(puzzle.targetId))) continue;
    if (!arr(puzzle.requiredItemIds).every((id) => progress.collectedItemIds.includes(str(id)))) continue;
    if (!has(puzzle.requiredClueIds)) continue;
    const solution = solvePuzzle(puzzle);
    if (solution) push({ kind: 'puzzle', actor: 'INVESTIGATOR', puzzle, solution });
  }

  const sceneCharacters = arr(scene.characterIds).map(str);
  for (const dialogue of arr(caseJson.dialogues)) {
    if (progress.askedDialogueIds.includes(dialogue.dialogueId)) continue;
    if (!sceneCharacters.includes(dialogue.characterId)) continue;
    if (contract >= CAUSAL_FIVE_CLAIM && !arr(dialogue.availableSceneIds).includes(scene.sceneId)) continue;
    const linked = arr(caseJson.conversationNodes).filter((node) => node.sourceDialogueId === dialogue.dialogueId);
    if (linked.length > 0 && !linked.some((node) => progress.visitedConversationNodeIds.includes(node.nodeId))) continue;
    if (!has(dialogue.requiredClueIds)) continue;
    push({ kind: 'ask', actor: 'INTERROGATOR', dialogueId: dialogue.dialogueId });
  }

  for (const characterId of sceneCharacters) {
    const nodes = sceneConversationNodes(caseJson, scene, characterId);
    const root = nodes.find((node) => node.isRoot);
    if (!root) continue;
    const visited = (id: string) => progress.visitedConversationNodeIds.includes(id);
    if (!visited(root.nodeId)) {
      if (has(root.requiredClueIds)) push({ kind: 'converse', actor: 'INTERROGATOR', characterId, nodeId: root.nodeId, targetNodeId: root.nodeId });
      continue;
    }
    for (const current of nodes.filter((node) => visited(node.nodeId))) {
      for (const choice of arr(current.choices)) {
        const reached = choiceTarget(current, choice, root, nodes, unlocked);
        if (!reached || visited(reached.nodeId)) continue;
        push({ kind: 'converse', actor: 'INTERROGATOR', characterId, nodeId: current.nodeId, choiceId: choice.choiceId, targetNodeId: reached.nodeId });
      }
    }
  }

  for (const challenge of arr(caseJson.evidenceChallenges)) {
    if (progress.resolvedChallengeIds.includes(challenge.challengeId)) continue;
    const dialogue = arr(caseJson.dialogues).find((entry) => entry.dialogueId === challenge.dialogueId);
    if (!dialogue || !sceneCharacters.includes(dialogue.characterId)) continue;
    if (contract >= CAUSAL_FIVE_CLAIM && !arr(dialogue.availableSceneIds).includes(scene.sceneId)) continue;
    const opened = progress.askedDialogueIds.includes(dialogue.dialogueId)
      || arr(caseJson.conversationNodes).some((node) => node.characterId === dialogue.characterId
        && node.challengeId === challenge.challengeId && progress.visitedConversationNodeIds.includes(node.nodeId));
    if (!opened || !unlocked.includes(str(challenge.correctEvidenceId))) continue;
    push({ kind: 'crack', actor: 'INTERROGATOR', challenge });
  }

  for (const deduction of arr(caseJson.deductions)) {
    if (progress.solvedDeductionIds.includes(deduction.deductionId)) continue;
    if (!has(deduction.requiredClueIds)) continue;
    if (!arr(deduction.requiredChallengeIds).every((id) => progress.resolvedChallengeIds.includes(str(id)))) continue;
    const optionId = str(deduction.correctOptionId);
    if (!optionId) continue;
    push({ kind: 'deduction', actor: 'INVESTIGATOR', deductionId: deduction.deductionId, optionId });
  }

  const clues = new Map(arr(caseJson.clues).map((clue) => [clue.clueId, clue]));
  for (const zone of arr(scene.runtime?.clueZones)) {
    const clue = clues.get(zone.clueId);
    if (!clue || progress.capturedClueIds.includes(zone.clueId) || unlocked.includes(zone.clueId)) continue;
    if (discoverMethod(clue) !== 'camera' || !has(zone.requiredClueIds) || !zone.bounds) continue;
    push({ kind: 'camera', actor: 'INVESTIGATOR', sceneId: scene.sceneId, clueId: zone.clueId, bounds: zone.bounds });
  }
  return actions;
}

/** What the final accusation still lacks (GameRules.IsAccusationAvailable), in words for the report. */
export function accusationMissing(caseJson: Json, progress: Progress): string[] {
  const missing: string[] = [];
  const scenes = orderedScenes(caseJson);
  for (const scene of scenes) {
    if (!progress.completedSceneIds.includes(scene.sceneId)) missing.push(`scene ${scene.sceneId} chưa hoàn tất`);
  }
  const finalLogic = caseJson.finalLogic ?? {};
  const mechanics = Number(caseJson.mechanicsVersion ?? 1);
  const evidence = mechanics >= 2
    ? arr(finalLogic.requiredEvidenceLinks).map((link) => str(link.evidenceId))
    : arr(finalLogic.requiredEvidenceIds).map(str);
  for (const id of evidence) if (!progress.unlockedClueIds.includes(id)) missing.push(`chứng cứ ${id} chưa mở`);
  for (const id of arr(finalLogic.requiredDeductionIds).map(str)) {
    if (!progress.solvedDeductionIds.includes(id)) missing.push(`suy luận ${id} chưa giải`);
  }
  if (mechanics >= V3_PAIRED) {
    for (const challenge of arr(caseJson.evidenceChallenges)) {
      if (!progress.resolvedChallengeIds.includes(challenge.challengeId)) missing.push(`đối chất ${challenge.challengeId} chưa phá`);
    }
  }
  if (Number(caseJson.logicContractVersion ?? 0) >= CAUSAL_FIVE_CLAIM) {
    for (const puzzle of arr(caseJson.puzzles)) {
      if (eqi(puzzle.progressionRole, 'REQUIRED') && !progress.solvedPuzzleIds.includes(puzzle.puzzleId)) {
        missing.push(`câu đố bắt buộc ${puzzle.puzzleId} chưa giải`);
      }
    }
  }
  return missing;
}

export function accusationRequest(caseJson: Json): Json {
  const finalLogic = caseJson.finalLogic ?? {};
  const links = arr(finalLogic.requiredEvidenceLinks).map((link) => ({ claimType: str(link.claimType), evidenceId: str(link.evidenceId) }));
  const evidenceIds = [...new Set([...arr(finalLogic.requiredEvidenceIds).map(str), ...links.map((link) => link.evidenceId)])];
  return {
    culpritId: str(finalLogic.culpritId),
    motiveId: str(finalLogic.correctMotiveId),
    methodId: str(finalLogic.correctMethodId),
    motive: str(finalLogic.motive),
    method: str(finalLogic.method),
    evidenceLinks: links,
    evidenceIds,
  };
}

// ------------------------------------------------------------------ estimate

export const READING_WORDS_PER_MINUTE = 180;
export const SECONDS = {
  sceneExplore: 45,
  sceneTransition: 20,
  inspect: 15,
  interaction: 20,
  camera: 30,
  questionOverhead: 8,
  conversationNodeOverhead: 6,
  crack: 90,
  deduction: 60,
  accusation: 150,
  puzzle: {
    CODE_PUZZLE: 60, SEQUENCE_PUZZLE: 75, SYMBOL_MATCH_PUZZLE: 60,
    fingerprint: 90, lockpick: 120, music_box: 150, parallax_code: 120, reagent_mix: 150,
    tilt_maze: 120, torn_paper: 150, gear_train: 180, balance_scale: 150, doc_forgery: 150, other: 120,
  } as Record<string, number>,
};

export function countWords(text: unknown): number {
  return str(text).split(/\s+/).filter(Boolean).length;
}

/** Play time estimate from the content alone (no player is that fast on a first run; this is the expected pace). */
export function estimatePlayTime(caseJson: Json): { minutes: number; breakdown: EstimateBreakdown } {
  const scenes = orderedScenes(caseJson);
  const dialogues = arr(caseJson.dialogues);
  const nodes = arr(caseJson.conversationNodes);
  const items = arr(caseJson.items);
  const puzzles = arr(caseJson.puzzles);
  const words = countWords(caseJson.summary)
    + scenes.reduce((sum, scene) => sum + countWords(scene.description), 0)
    + dialogues.reduce((sum, dialogue) => sum + countWords(dialogue.question) + countWords(dialogue.answer), 0)
    + nodes.reduce((sum, node) => sum + arr(node.lines).reduce((total, line) => total + countWords(line.text), 0), 0)
    + items.reduce((sum, item) => sum + countWords(item.inspectText), 0)
    + arr(caseJson.clues).filter((clue) => clue.isEvidence).reduce((sum, clue) => sum + countWords(clue.content), 0);
  const cameraZones = scenes.reduce((sum, scene) => sum + arr(scene.runtime?.clueZones).length, 0);
  const puzzleSeconds = puzzles.reduce((sum, puzzle) => {
    const type = str(puzzle.type).toUpperCase();
    const key = type === 'INTERACTIVE_PUZZLE' ? str(puzzle.kind) : type;
    return sum + (SECONDS.puzzle[key] ?? SECONDS.puzzle.other);
  }, 0);
  const counts = {
    scenes: scenes.length,
    transitions: Math.max(0, scenes.length - 1),
    items: items.length,
    interactions: arr(caseJson.interactions).length,
    cameraZones,
    puzzles: puzzles.length,
    questions: dialogues.length,
    conversationNodes: nodes.length,
    cracks: arr(caseJson.evidenceChallenges).length,
    deductions: arr(caseJson.deductions).length,
    words,
  };
  const seconds = {
    reading: Math.round((words / READING_WORDS_PER_MINUTE) * 60),
    exploring: counts.scenes * SECONDS.sceneExplore,
    transitions: counts.transitions * SECONDS.sceneTransition,
    items: counts.items * SECONDS.inspect,
    interactions: counts.interactions * SECONDS.interaction,
    camera: counts.cameraZones * SECONDS.camera,
    puzzles: puzzleSeconds,
    questions: counts.questions * SECONDS.questionOverhead + counts.conversationNodes * SECONDS.conversationNodeOverhead,
    cracks: counts.cracks * SECONDS.crack,
    deductions: counts.deductions * SECONDS.deduction,
    accusation: SECONDS.accusation,
  };
  const totalSeconds = Object.values(seconds).reduce((sum, value) => sum + value, 0);
  const formula = `số chữ/${READING_WORDS_PER_MINUTE} chữ mỗi phút + cảnh×${SECONDS.sceneExplore}s + chuyển cảnh×${SECONDS.sceneTransition}s`
    + ` + vật phẩm×${SECONDS.inspect}s + tương tác×${SECONDS.interaction}s + vùng chụp ảnh×${SECONDS.camera}s`
    + ` + giải đố theo loại (mã 60s, chuỗi 75s, tương tác 90–180s) + câu hỏi×${SECONDS.questionOverhead}s + nút hội thoại×${SECONDS.conversationNodeOverhead}s`
    + ` + đối chất×${SECONDS.crack}s + suy luận×${SECONDS.deduction}s + buộc tội ${SECONDS.accusation}s`;
  return { minutes: Math.max(1, Math.round(totalSeconds / 60)), breakdown: { formula, counts, seconds, totalSeconds } };
}

// ------------------------------------------------------------------ audio

/** Music per area, weather outdoors only (docs/case-audio-weather.md). */
export function checkAudio(caseJson: Json): AudioChecks {
  const scenes = orderedScenes(caseJson);
  const result: AudioChecks = { scenesWithoutMusic: [], outdoorScenesWithoutWeather: [], indoorScenesWithWeather: [], notes: [] };
  const weatherType = (scene: Json) => str(scene.runtime?.weather?.type).trim().toUpperCase();
  const caseHasWeather = scenes.some((scene) => weatherType(scene) && weatherType(scene) !== 'NONE');
  let unknownIndoor = 0;
  for (const scene of scenes) {
    const runtime = scene.runtime ?? {};
    if (!str(runtime.audio?.music?.url)) result.scenesWithoutMusic.push(scene.sceneId);
    if (runtime.indoor === true) {
      if (weatherType(scene) && weatherType(scene) !== 'NONE') result.indoorScenesWithWeather.push(scene.sceneId);
    } else if (runtime.indoor === false) {
      if (caseHasWeather && (!weatherType(scene) || weatherType(scene) === 'NONE')) result.outdoorScenesWithoutWeather.push(scene.sceneId);
    } else unknownIndoor++;
  }
  if (!caseHasWeather) result.notes.push('Vụ không đặt thời tiết cho cảnh nào (runtime.weather).');
  if (unknownIndoor) result.notes.push(`${unknownIndoor} cảnh không ghi runtime.indoor nên không kiểm được luật thời tiết.`);
  if (result.scenesWithoutMusic.length === scenes.length && scenes.length) result.notes.push('Chưa cảnh nào có nhạc (runtime.audio.music).');
  return result;
}
