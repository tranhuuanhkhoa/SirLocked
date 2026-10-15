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

export type CaseFileStepState = 'done' | 'now' | 'lock';

export type CaseFileProgress = {
  /** Requirements still open across the locations the team can already reach. */
  openLeads: number;
  solvedDeductions: number;
  totalDeductions: number;
  crackedCount: number;
  steps: { evidence: CaseFileStepState; crack: CaseFileStepState; deduction: CaseFileStepState; accusation: CaseFileStepState };
  accusationReady: boolean;
};

type CaseFileProgressInput = {
  sceneMap: Array<Omit<UiSceneMapEntry, 'sceneId'> & { isVisited?: boolean; isUnlocked?: boolean }>;
  deductions: { isSolved: boolean }[];
  crackedCount: number;
  crackInProgress: boolean;
  availableForAccusation: boolean;
  accusationProposed: boolean;
};

/**
 * The case file's progress line: evidence → crack the lie → deduction → accusation.
 * Every count comes from server state; the line only orders them.
 */
export function buildCaseFileProgress(input: CaseFileProgressInput): CaseFileProgress {
  const openLeads = input.sceneMap
    .filter((entry) => !entry.isCompleted && (entry.isVisited || entry.isUnlocked || entry.isCurrent))
    .reduce((total, entry) => total + Math.max(0, entry.pendingRequirementCount ?? 0), 0);
  const totalDeductions = input.deductions.length;
  const solvedDeductions = input.deductions.filter((deduction) => deduction.isSolved).length;
  const ready = input.availableForAccusation;
  const evidenceDone = ready || openLeads === 0;
  const crackDone = ready || (input.crackedCount > 0 && !input.crackInProgress);
  const deductionDone = ready || (totalDeductions > 0 ? solvedDeductions === totalDeductions : crackDone);
  const done = [evidenceDone, crackDone, deductionDone, input.accusationProposed];
  const firstOpen = done.findIndex((value) => !value);
  const stateAt = (index: number): CaseFileStepState => (done[index] ? 'done' : index === firstOpen ? 'now' : 'lock');
  return {
    openLeads,
    solvedDeductions,
    totalDeductions,
    crackedCount: input.crackedCount,
    steps: { evidence: stateAt(0), crack: stateAt(1), deduction: stateAt(2), accusation: stateAt(3) },
    accusationReady: ready,
  };
}

export function isCameraMode(mode: GameUiMode): boolean {
  return mode.kind === 'CAMERA';
}

export function isScenePanelOpen(mode: GameUiMode): boolean {
  return mode.kind !== 'EXPLORE' && mode.kind !== 'CAMERA';
}
