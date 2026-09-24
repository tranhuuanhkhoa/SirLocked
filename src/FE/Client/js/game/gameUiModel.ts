export type CaseFileSection = 'evidence' | 'testimony' | 'contradictions' | 'map';

export type AccusationDraft = {
  step: number;
  culpritId: string | null;
  evidenceIds: Set<string>;
  motiveId: string | null;
  methodId: string | null;
  evidenceLinks: Record<string, string>;
  activeClaimType: string | null;
};

export type GameUiMode =
  | { kind: 'EXPLORE' }
  | { kind: 'CAMERA' }
  | { kind: 'INVENTORY'; itemId?: string }
  | { kind: 'CASE_FILE'; section: CaseFileSection; clueId?: string }
  | { kind: 'DIALOGUE'; characterId: string }
  | { kind: 'PUZZLE'; view: 'LOCKED'; label: string; message: string }
  | { kind: 'PUZZLE'; view: 'SOLVE'; puzzleId: string }
  | { kind: 'ACCUSATION'; draft: AccusationDraft };

export type ContextAction = {
  targetId: string;
  targetType: string;
  label: string;
  actionLabel: string;
  keyLabel: string;
  enabled: boolean;
  reason?: string;
};

export type PartnerActivity = {
  actorUserId: string;
  actorName: string;
  actorRole?: string;
  message: string;
  sceneId?: string;
  createdAt: number;
};

export type DiscoveryNotice = {
  id: string;
  kind: 'ITEM' | 'PHOTO' | 'CLUE';
  title: string;
  detail: string;
  imageUrl?: string;
  clueCount: number;
};

type UiPlayer = {
  userId: string;
  username: string;
  role: string;
  isConnected: boolean;
};

type UiSceneMapEntry = {
  sceneId: string;
  isCurrent: boolean;
  isCompleted: boolean;
  pendingRequirementCount: number;
};

export type GameUiModel = {
  mode: GameUiMode;
  role: string | null;
  objective: string;
  sceneProgressLabel: string;
  sceneProgressRemaining: number;
  sceneProgressState: 'SEARCHING' | 'READY' | 'COMPLETE';
  canUseCamera: boolean;
  canUseInventory: boolean;
  newQuestionCount: number;
  players: UiPlayer[];
  partnerActivity: PartnerActivity | null;
  contextAction: ContextAction | null;
  discovery: DiscoveryNotice | null;
  finalConfrontationReady: boolean;
};

type BuildGameUiModelInput = {
  mode: GameUiMode;
  localUserId: string;
  players: UiPlayer[];
  objective: string;
  currentSceneId: string;
  currentSceneCanComplete: boolean;
  completedSceneIds: string[];
  sceneMap: UiSceneMapEntry[];
  newQuestionCount: number;
  partnerActivity: PartnerActivity | null;
  contextAction: ContextAction | null;
  discovery: DiscoveryNotice | null;
  availableForAccusation: boolean;
};

export function buildGameUiModel(input: BuildGameUiModelInput): GameUiModel {
  const role = input.players.find((player) => player.userId === input.localUserId)?.role ?? null;
  const currentScene = input.sceneMap.find((entry) => entry.sceneId === input.currentSceneId || entry.isCurrent);
  const isCompleted = input.completedSceneIds.includes(input.currentSceneId) || Boolean(currentScene?.isCompleted);
  const remaining = Math.max(0, currentScene?.pendingRequirementCount ?? 0);
  const sceneProgressState = isCompleted
    ? 'COMPLETE'
    : input.currentSceneCanComplete
      ? 'READY'
      : 'SEARCHING';
  const sceneProgressLabel = sceneProgressState === 'COMPLETE'
    ? 'Location investigated'
    : sceneProgressState === 'READY'
      ? 'Route forward available'
      : remaining > 0
        ? `${remaining} lead${remaining === 1 ? '' : 's'} still open`
        : 'Follow the current lead';

  return {
    mode: input.mode,
    role,
    objective: input.objective,
    sceneProgressLabel,
    sceneProgressRemaining: remaining,
    sceneProgressState,
    canUseCamera: role === 'INVESTIGATOR',
    canUseInventory: role === 'INVESTIGATOR',
    newQuestionCount: input.newQuestionCount,
    players: input.players,
    partnerActivity: input.partnerActivity,
    contextAction: input.contextAction,
    discovery: input.discovery,
    finalConfrontationReady: input.availableForAccusation,
  };
}

export function isCameraMode(mode: GameUiMode): boolean {
  return mode.kind === 'CAMERA';
}

export function isScenePanelOpen(mode: GameUiMode): boolean {
  return mode.kind !== 'EXPLORE' && mode.kind !== 'CAMERA';
}
