// A game state for one scene of a case JSON, as the game page receives it from GET /api/game/rooms/{id}/state.
// Used where the real API is not needed to look at a scene: the Playwright atmosphere tests and the studio tool
// weather_preview (tools/studio-mcp), which records a few seconds of a scene with a given weather and time of day.
// It is a projection good enough to draw and talk; the server stays the only judge of a real game.

export const PREVIEW_ROOM_ID = 'smoke-room';

export function scenesOf(caseJson) {
  return (caseJson?.stages ?? []).flatMap((stage) => stage.scenes ?? []);
}

/** visibleScene of a case scene; `asked` holds dialogue ids already asked (their answers show in the dialogue). */
export function previewVisibleScene(caseJson, sceneId, asked = new Set()) {
  const scene = scenesOf(caseJson).find((candidate) => candidate.sceneId === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} is not in case ${caseJson?.caseId}.`);
  const placed = new Set((scene.runtime?.characterPlacements ?? []).map((placement) => placement.characterId));
  const characters = (caseJson.characters ?? []).filter((character) => placed.has(character.characterId));
  return {
    sceneId,
    title: scene.title,
    description: scene.description ?? '',
    backgroundUrl: scene.backgroundUrl ?? '',
    runtime: scene.runtime,
    hotspots: (scene.hotspots ?? []).map((hotspot) => ({ ...hotspot, isLocked: false })),
    items: (caseJson.items ?? []).filter((item) => (scene.itemIds ?? []).includes(item.itemId)).map((item) => ({
      itemId: item.itemId, name: item.name, description: item.description, inspectText: item.inspectText, imageUrl: item.imageUrl,
    })),
    characters: characters.map((character) => ({
      characterId: character.characterId, name: character.name, role: character.role, imageUrl: character.imageUrl,
      description: character.description, presentation: character.presentation, ...(character.voice ? { voice: character.voice } : {}),
    })),
    availableDialogues: (caseJson.dialogues ?? []).filter((dialogue) => placed.has(dialogue.characterId)).map((dialogue) => ({
      dialogueId: dialogue.dialogueId, characterId: dialogue.characterId, question: dialogue.question, answer: dialogue.answer,
      isAsked: asked.has(dialogue.dialogueId), isLocked: false, evidenceChallenges: [],
    })),
    conversationTreeCharacterIds: [],
    conversationTranscript: [],
    puzzles: [],
  };
}

/** Whole game state: the local player questions witnesses (INTERROGATOR), every scene is open. */
export function previewGameState(caseJson, sceneId, { asked = new Set(), version = 1 } = {}) {
  const scenes = scenesOf(caseJson);
  return {
    roomId: PREVIEW_ROOM_ID,
    roomCode: 'XEMTHU',
    hostUserId: 'player-1',
    caseTitle: caseJson.title ?? '',
    caseSummary: caseJson.summary ?? '',
    language: caseJson.language === 'en' ? 'en' : 'vi',
    mechanicsVersion: 2,
    roomStatus: 'IN_PROGRESS',
    currentSceneId: sceneId,
    version,
    players: [
      { userId: 'player-1', username: 'Thẩm vấn', role: 'INTERROGATOR', isConnected: true },
      { userId: 'player-2', username: 'Điều tra', role: 'INVESTIGATOR', isConnected: true },
    ],
    visibleScene: previewVisibleScene(caseJson, sceneId, asked),
    unlockedSceneIds: scenes.map((scene) => scene.sceneId),
    inspectedItemIds: [],
    collectedItemIds: [],
    capturedClueIds: [],
    usedInteractionIds: [],
    solvedPuzzleIds: [],
    wrongPuzzleCount: 0,
    collectedItems: [],
    unlockedClues: [],
    evidenceClues: [],
    resolvedConfrontations: [],
    deductions: [],
    testimonies: [],
    suspects: (caseJson.characters ?? []).map((character) => ({
      characterId: character.characterId, name: character.name, role: character.role, imageUrl: character.imageUrl, description: character.description,
    })),
    sceneMap: scenes.map((scene) => ({
      sceneId: scene.sceneId, title: scene.title, isCurrent: scene.sceneId === sceneId,
      isVisited: true, isUnlocked: true, isCompleted: false, pendingRequirementCount: 0,
    })),
    completedSceneIds: [],
    availableForAccusation: false,
    currentSceneCanComplete: false,
    currentSceneMissingRequirements: { requiredItemIds: [], requiredClueIds: [], requiredDialogueIds: [] },
    currentObjective: '',
    actionLog: [],
  };
}

/** A copy of the case with one scene's weather and time of day replaced (indoor scenes become outdoor). */
export function withAtmosphere(caseJson, sceneId, { weather, timeOfDay, indoor, backgroundUrl } = {}) {
  const copy = JSON.parse(JSON.stringify(caseJson));
  const scene = scenesOf(copy).find((candidate) => candidate.sceneId === sceneId);
  if (!scene) throw new Error(`Scene ${sceneId} is not in case ${copy?.caseId}.`);
  scene.runtime = scene.runtime ?? {};
  if (weather) { scene.runtime.weather = weather; if (weather.type !== 'NONE') scene.runtime.indoor = false; }
  if (typeof indoor === 'boolean') scene.runtime.indoor = indoor;
  if (timeOfDay) scene.runtime.timeOfDay = timeOfDay;
  if (backgroundUrl) scene.backgroundUrl = backgroundUrl;
  return copy;
}
