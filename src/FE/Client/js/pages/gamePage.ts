import Phaser from 'phaser';
import { Camera, Briefcase, X, FolderSearch, Map as MapIcon, Lightbulb, createIcons } from 'lucide';
import { gameApi } from '../api/gameApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { createStateRefetcher } from '../services/stateRefetcher.js';
import { createRoleGuide, roleGuideSteps } from '../game/roleGuide.js';
import '../../../css/game-recovery.css';
import '../../../css/40-bpa-game.css';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr, uiLanguage } from '../services/i18n.js';
import { DialoguePresenter } from '../game/dialoguePresenter.js';
import { createModalFocusManager } from '../game/modalFocus.js';
import { CutsceneController } from '../game/cutsceneController.js';
import { idleFrameAt, usableSpriteSheet } from '../game/npcAnimator.js';
import { advancePath, findApproachPath, findPath, insideBounds, isNavigable, nearestNavigablePoint,
  segmentIsClear, type NavigationPoint, type NavigationWorld } from '../game/navigation.js';
import type { CharacterPresentation, CasePresentation } from '../game/presentationMedia.js';
import { createAudioController, renderAudioControls, bindAudioControls, type SceneAudio } from '../game/audioController.js';
import { renderPingControls, bindPingControls, renderPartnerPing, type TeamPing } from '../game/cooperativePing.js';
import {
  PLAYER_FRAME,
  PLAYER_SHEETS,
  characterPortraitUrl,
  characterSpriteUrl,
  playableAssetUrl,
  sceneBackgroundUrl,
  sceneCharacterSpriteUrl,
} from '../game/gameAssets.js';
import {
  buildGameUiModel,
  isCameraMode,
  isScenePanelOpen,
  type ContextAction,
  type DiscoveryNotice,
  type GameUiMode,
  type PartnerActivity,
} from '../game/gameUiModel.js';
import {
  clockText,
  gameIcon,
  renderContextAction,
  renderDiscoveryCard,
  renderFinalConfrontationCallout,
  renderGameHud,
  reconnectWait,
  renderReconnectWait,
  roleName,
  romanNumeral,
  type HudExtras,
} from '../game/gameShell.js';
import {
  bpaIcons,
  bpaMono,
  buildPairedConfrontationViewModel,
  renderJointReviewPanel,
  renderPrivateEvidencePanel,
  renderPrivateTestimonyPanel,
  type ActivePairedConfrontation,
  type CaseFileRenderContext,
  type DisclosedPair,
  type PairedConfrontationViewModel,
  type PrivateEvidence,
  type PrivateTestimony,
} from '../game/pairedConfrontation.js';
import { newestTerminalPair, renderCrackPayoff, renderV3CaseComplete } from '../game/crackPayoff.js';
import {
  accusationRevisionKey,
  buildAccusationConsensusModel,
  renderAccusationConsensus,
  renderAccusationHeader,
  renderAccusationSheet,
  type AccusationProposal,
  type AccusationSummaryRow,
} from '../game/accusationConsensus.js';
import { buildCaseFileProgress, type AccusationDraft, type CaseFileSection } from '../game/gameUiModel.js';

type RoomPlayer = {
  userId: string;
  username: string;
  role: string;
  isConnected: boolean;
  disconnectedAt?: string | null;
  reconnectGraceEndsAt?: string | null;
};

type Hotspot = {
  hotspotId: string;
  type: string;
  targetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  label: string;
  isLocked: boolean;
};

type RuntimeBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RuntimePoint = {
  x: number;
  y: number;
  anchor?: string;
  direction?: 'left' | 'right';
};

type RuntimeSize = {
  width: number;
  height: number;
};

type RuntimeItemPlacement = {
  itemId: string;
  asset?: string;
  position: RuntimePoint;
  size: RuntimeSize;
  hotspot: RuntimeBox;
  reservedSlot?: RuntimeBox;
  anchor?: string;
  depth?: number;
};

type RuntimeCharacterPlacement = {
  characterId: string;
  asset?: string;
  position: RuntimePoint;
  size: RuntimeSize;
  hotspot: RuntimeBox;
  reservedSlot?: RuntimeBox;
  anchor?: string;
  direction?: 'left' | 'right';
  depth?: number;
};

type RuntimeTransition = {
  transitionId: string;
  targetSceneId: string;
  label: string;
  hotspot: RuntimeBox;
  depth?: number;
};

type RuntimeClueZone = {
  clueId: string;
  label?: string;
  bounds: RuntimeBox;
  shape?: string;
  visibility?: string;
  detectionDifficulty?: string;
};

type CameraRules = {
  captureRectWidth?: number;
  captureRectHeight?: number;
  minClueCoverage?: number;
  nearMissCoverage?: number;
  requireCaptureCenterInside?: boolean;
};

type SceneRuntime = {
  width?: number;
  height?: number;
  floorY?: number;
  walkableArea?: RuntimeBox;
  navigationObstacles?: RuntimeBox[];
  spawnPoints?: Record<string, RuntimePoint>;
  itemPlacements?: RuntimeItemPlacement[];
  characterPlacements?: RuntimeCharacterPlacement[];
  transitions?: RuntimeTransition[];
  clueZones?: RuntimeClueZone[];
  cameraRules?: CameraRules;
  audio?: SceneAudio;
};

type SceneItem = {
  itemId: string;
  name: string;
  description: string;
  inspectText?: string;
  imageUrl: string;
  isCollectible?: boolean;
};

type SceneCharacter = {
  characterId: string;
  name: string;
  role: string;
  imageUrl: string;
  description: string;
  presentation?: CharacterPresentation;
};

type SceneDialogue = {
  dialogueId: string;
  characterId: string;
  question: string;
  answer: string;
  isAsked: boolean;
  isLocked: boolean;
  missingClueIds?: string[];
  evidenceChallenges: EvidenceChallenge[];
};

type EvidenceChallenge = {
  challengeId: string;
  dialogueId: string;
  prompt: string;
  isResolved: boolean;
  resolution?: string;
};

type ScenePuzzle = {
  puzzleId: string;
  type: 'CODE_PUZZLE' | 'SEQUENCE_PUZZLE' | 'SYMBOL_MATCH_PUZZLE' | string;
  targetId: string;
  prompt: string;
  options: string[];
  answerLength: number;
  requiredItemIds: string[];
  requiredClueIds: string[];
  isLocked: boolean;
  isSolved: boolean;
  missingItemIds: string[];
  missingClueIds: string[];
};

type ResolvedConfrontation = {
  challengeId: string;
  evidenceId: string;
  evidenceTitle: string;
  prompt: string;
  resolution: string;
  resolvedByUserId: string;
  resolvedAt: string;
};

type Testimony = { dialogueId: string; characterName: string; question: string; answer: string };

type Deduction = {
  deductionId: string;
  prompt: string;
  missingClueIds: string[];
  missingChallengeIds: string[];
  options: AccusationOption[];
  isAvailable: boolean;
  isSolved: boolean;
  resolution?: string;
};

type AccusationOption = { id: string; label: string };
type AccusationConfig = {
  motiveOptions: AccusationOption[];
  methodOptions: AccusationOption[];
  claimTypes: string[];
};

type ConversationLine = { speaker: 'NPC' | 'DETECTIVE'; text: string };
type ConversationTranscriptEntry = {
  nodeId: string;
  characterId: string;
  lines: ConversationLine[];
  challenge?: EvidenceChallenge | null;
};
type ConversationNode = {
  nodeId: string;
  characterId: string;
  isRoot: boolean;
  lines: ConversationLine[];
  challengeId?: string | null;
};
type ConversationChoice = { choiceId: string; label?: string | null; isLocked: boolean };
type ConverseResponse = {
  node: ConversationNode;
  choices: ConversationChoice[];
  challenge?: EvidenceChallenge | null;
  unlockedClueIds: string[];
  state: GameState;
  changed: boolean;
};

type VisibleScene = {
  sceneId: string;
  title: string;
  description: string;
  backgroundUrl: string;
  runtime?: SceneRuntime;
  hotspots: Hotspot[];
  items: SceneItem[];
  characters: SceneCharacter[];
  availableDialogues: SceneDialogue[];
  conversationTreeCharacterIds: string[];
  conversationTranscript: ConversationTranscriptEntry[];
  puzzles: ScenePuzzle[];
};

type Clue = {
  clueId: string;
  title: string;
  content: string;
  source: string;
  isCritical: boolean;
  isEvidence: boolean;
  inventoryDescription?: string;
  narrativeMeaning?: string;
  discoverMethod?: string;
  photoUrl?: string;
};

type SceneMapEntry = {
  sceneId: string;
  title: string;
  isCurrent: boolean;
  isVisited: boolean;
  isUnlocked: boolean;
  isCompleted: boolean;
  pendingRequirementCount: number;
};

type ActionLogEntry = {
  actionType: string;
  message: string;
  userId: string;
  createdAt: string;
};

type MissingRequirements = {
  requiredItemIds: string[];
  requiredClueIds: string[];
  requiredDialogueIds: string[];
};

type GameState = {
  presentation?: CasePresentation;
  roomId: string;
  roomCode: string;
  hostUserId: string;
  caseTitle: string;
  caseSummary: string;
  language: 'en' | 'vi';
  mechanicsVersion: number;
  roomStatus: string;
  currentSceneId: string;
  version: number;
  players: RoomPlayer[];
  visibleScene: VisibleScene;
  unlockedSceneIds: string[];
  inspectedItemIds: string[];
  collectedItemIds: string[];
  capturedClueIds: string[];
  usedInteractionIds: string[];
  solvedPuzzleIds: string[];
  wrongPuzzleCount: number;
  collectedItems: SceneItem[];
  unlockedClues: Clue[];
  evidenceClues: Clue[];
  resolvedConfrontations: ResolvedConfrontation[];
  deductions: Deduction[];
  testimonies: Testimony[];
  accusationConfig?: AccusationConfig;
  suspects: SceneCharacter[];
  sceneMap: SceneMapEntry[];
  completedSceneIds: string[];
  availableForAccusation: boolean;
  currentSceneCanComplete: boolean;
  currentSceneMissingRequirements: MissingRequirements;
  currentObjective: string;
  isCaseComplete?: boolean;
  actionLog: ActionLogEntry[];
  privateEvidence: PrivateEvidence[];
  privateTestimonies: PrivateTestimony[];
  sharedKnowledge: {
    attemptHistory: DisclosedPair[];
    resolvedTruths: DisclosedPair[];
  };
  activeConfrontation?: ActivePairedConfrontation | null;
  activeAccusation?: AccusationProposal | null;
};

function accusationClaimLabel(claimType: string) {
  switch (claimType) {
    case 'MOTIVE': return tr('Motive', 'Động cơ');
    case 'METHOD': return tr('Method', 'Phương thức');
    case 'OPPORTUNITY': return tr('Opportunity', 'Cơ hội');
    case 'IDENTITY': return tr('Identity', 'Danh tính');
    case 'TIMELINE': return tr('Timeline', 'Dòng thời gian');
    default: return claimType;
  }
}

type HotspotClick = {
  type: string;
  target: string;
  locked: string;
  label: string;
};

type PlayerPose = {
  userId: string;
  username?: string;
  role?: string | null;
  sceneId: string;
  x: number;
  y: number;
  direction: 'left' | 'right';
  moving: boolean;
  updatedAt?: string;
};

type InvestigationUpdatePayload = {
  type?: string;
  actorUserId: string;
  actorRole?: string;
  sceneId?: string;
  targetId?: string;
  characterId?: string;
  message: string;
  version?: number;
};

type PhaserCallbacks = {
  localUserId: string;
  playerPoses: Map<string, PlayerPose>;
  tr: (english: string, vietnamese: string) => string;
  newDialogueCount: (characterId: string) => number;
  onHotspot: (hotspot: HotspotClick) => void;
  onCharacter: (characterId: string) => void;
  onCapture: (captureRect: RuntimeBox, photo: Blob) => void;
  onCameraError: (message: string) => void;
  onNavigationError: (message: string) => void;
  onContextAction: (action: ContextAction | null) => void;
  onProceed: () => void;
  onScene: (sceneId: string) => void;
  onPose: (pose: PlayerPose) => void;
};

type SceneFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

class SirLockedPhaserScene extends Phaser.Scene {
  private sceneRenderKey = '';
  private npcAnimations: { body: Phaser.GameObjects.Image; sheet: NonNullable<CharacterPresentation['spriteSheet']>; phase: number; lastFrame: number }[] = [];
  private npcBreathing: { body: Phaser.GameObjects.Image; scaleX: number; scaleY: number; phase: number }[] = [];
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private callbacks: PhaserCallbacks;
  private state: GameState | null = null;
  private selectedInventoryItemId: string | null = null;
  private inventorySelectionLabel: Phaser.GameObjects.Text | null = null;
  private ready = false;
  private loadingTextureKeys = new Set<string>();
  private attemptedTextureKeys = new Set<string>();
  private pendingTextures = new Map<string, string>();
  private failedTextureKeys = new Set<string>();
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private localPose: PlayerPose | null = null;
  private localPlayer: Phaser.GameObjects.Container | null = null;
  private remotePlayers = new Map<string, Phaser.GameObjects.Container>();
  private remoteTargets = new Map<string, PlayerPose>();
  private remoteDisplayPoses = new Map<string, PlayerPose>();
  private remotePoseReceivedAt = new Map<string, number>();
  private promptText: Phaser.GameObjects.Text | null = null;
  private debugPointerText: Phaser.GameObjects.Text | null = null;
  private nearestHotspot: Hotspot | null = null;
  private lastPoseSentAt = 0;
  private lastSentPoseKey = '';
  private sceneInteractionEnabled = true;
  private debugLayout = false;
  private cameraMode = false;
  private lastCameraPointerKey = '';
  private cameraGraphics: Phaser.GameObjects.Graphics | null = null;
  private cameraLabel: Phaser.GameObjects.Text | null = null;
  private cameraCaptureZone: Phaser.GameObjects.Zone | null = null;
  private cameraCapturePending = false;
  // Camera frame: aimed by mouse, touch drag or WASD/arrows; brackets fly in on open and out on close.
  private cameraAim: { x: number; y: number } | null = null;
  private cameraOpenedAt = 0;
  private cameraClosingAt = 0;
  private cameraClosingRect: { x: number; y: number; width: number; height: number } | null = null;
  private keySpace: Phaser.Input.Keyboard.Key | null = null;
  private keyShift: Phaser.Input.Keyboard.Key | null = null;
  private heldItemImage: Phaser.GameObjects.Image | null = null;
  private mobileMoveX = 0;
  private lastContextActionKey = '';
  private navigation: { sceneId: string; path: NavigationPoint[]; destination: NavigationPoint;
    action?: () => void; valid?: () => boolean; inventoryItemId: string | null } | null = null;
  private destinationMarker: Phaser.GameObjects.Graphics | null = null;
  private rejectedDestination: NavigationPoint | null = null;
  private rejectedDestinationUntil = 0;

  constructor(callbacks: PhaserCallbacks) {
    super('SirLockedPhaserScene');
    this.callbacks = callbacks;
  }

  preload() {
    for (const sheet of Object.values(PLAYER_SHEETS)) {
      if (!this.textures.exists(sheet.key)) {
        this.load.image(sheet.key, sheet.url);
      }
    }
  }

  create() {
    this.ready = true;
    this.definePlayerFrames();
    this.debugLayout = window.location.href.includes('debugLayout=1');
    this.keys = (this.input.keyboard?.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E,F2') ?? {}) as Record<string, Phaser.Input.Keyboard.Key>;
    // Not captured: Space and Shift keep working on focused buttons; the camera only reads them.
    this.keySpace = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false) ?? null;
    this.keyShift = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT, false) ?? null;
    // The key's own event: a tap whose keyup lands in the same frame would be missed by JustDown.
    this.keySpace?.on('down', () => {
      const focused = document.activeElement;
      const onControl = focused instanceof HTMLElement && focused.matches('button, a, input, textarea, select, summary, [contenteditable="true"]');
      if (this.cameraMode && !onControl) void this.captureCameraFrame();
    });
    // Remember 404s so a missing asset doesn't trigger an endless reload loop.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: { key?: string }) => {
      if (file?.key) this.failedTextureKeys.add(file.key);
    });
    this.scale.on('resize', () => this.draw());
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (!this.sceneInteractionEnabled || this.cameraMode || objects.length || !pointer.leftButtonDown()) return;
      this.navigateTo(this.screenToWorld(pointer.x, pointer.y));
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.ready) return;
      this.positionHeldItem(pointer.x, pointer.y);
      if (!this.cameraMode) {
        if (!this.input.manager?.canvas || this.input.manager.canvas.style.cursor === 'pointer') return;
        this.input.setDefaultCursor(this.sceneInteractionEnabled && isNavigable(this.screenToWorld(pointer.x, pointer.y), this.navigationWorld())
          ? 'crosshair' : 'default');
        return;
      }
      // A mouse aims on hover; a finger moves the frame only while it drags.
      if (pointer.wasTouch && !pointer.isDown) return;
      const pointerKey = `${Math.round(pointer.x / 3)},${Math.round(pointer.y / 3)}`;
      if (pointerKey === this.lastCameraPointerKey) return;
      this.lastCameraPointerKey = pointerKey;
      this.cameraAim = { x: pointer.x, y: pointer.y };
      this.refreshCameraOverlay();
    });
    this.draw();
  }

  private definePlayerFrames() {
    for (const sheet of Object.values(PLAYER_SHEETS)) {
      const texture = this.textures.get(sheet.key);
      for (let frame = 0; frame < 8; frame++) {
        const frameName = `player-frame-${frame}`;
        if (!texture.has(frameName)) {
          texture.add(
            frameName,
            0,
            PLAYER_FRAME.sourceX + frame * PLAYER_FRAME.width,
            0,
            PLAYER_FRAME.width,
            PLAYER_FRAME.height,
          );
        }
      }
    }
  }

  update(time: number, delta: number) {
    if (!this.ready) return;
    this.animatePlayers(time);
    for (const animation of this.npcAnimations) {
      const frame = this.reducedMotion.matches ? 0 : idleFrameAt(animation.sheet, time, animation.phase);
      if (animation.lastFrame !== frame) { animation.body.setFrame(`npc-frame-${frame}`); animation.lastFrame = frame; }
    }
    for (const idle of this.npcBreathing) {
      const breath = this.reducedMotion.matches ? 1 : 1 + Math.sin((time + idle.phase) / 900) * .007;
      idle.body.setScale(idle.scaleX, idle.scaleY * breath);
    }
    this.interpolateRemotePlayers(delta);
    this.updateDebugPointerText();
    if (this.rejectedDestination && time >= this.rejectedDestinationUntil) {
      this.rejectedDestination = null;
      this.drawDestinationMarker();
    }
    if (this.keys.F2 && Phaser.Input.Keyboard.JustDown(this.keys.F2)) {
      this.debugLayout = !this.debugLayout;
      this.draw();
      return;
    }
    if (this.cameraMode || this.cameraClosingAt) this.updateCamera(time, delta);
    if (!this.state || !this.localPose || !this.localPlayer) return;

    if (!this.sceneInteractionEnabled) {
      this.localPose.moving = false;
      this.localPlayer.setData('moving', false);
      this.nearestHotspot = null;
      this.updateInteractionPrompt();
      return;
    }

    const axis = this.inputAxis();
    const keyboardMoving = axis.x !== 0 || axis.y !== 0;
    const speed = 225 * this.runtimeWidth() / 1600;
    const seconds = Math.min(delta, 100) / 1000;
    const bounds = this.walkBounds();
    let moving = keyboardMoving;
    let completedAction: (() => void) | undefined;

    if (keyboardMoving) {
      this.cancelNavigation();
      const magnitude = Math.hypot(axis.x, axis.y) || 1;
      const dx = (axis.x / magnitude) * speed * seconds;
      const dy = (axis.y / magnitude) * speed * seconds;
      const startedInsideObstacle = this.collidesAt(this.localPose.x, this.localPose.y);
      const nextX = Phaser.Math.Clamp(this.localPose.x + dx, bounds.left, bounds.right);
      if (startedInsideObstacle || segmentIsClear(this.localPose, { x: nextX, y: this.localPose.y }, this.navigationWorld())) this.localPose.x = nextX;
      const nextY = Phaser.Math.Clamp(this.localPose.y + dy, bounds.top, bounds.bottom);
      if (startedInsideObstacle || segmentIsClear(this.localPose, { x: this.localPose.x, y: nextY }, this.navigationWorld())) this.localPose.y = nextY;
      if (axis.x < 0) this.localPose.direction = 'left';
      if (axis.x > 0) this.localPose.direction = 'right';
    } else if (this.navigation) {
      const pending = this.navigation;
      if (pending.sceneId !== this.state.currentSceneId || pending.inventoryItemId !== this.selectedInventoryItemId
        || (pending.valid && !pending.valid())) this.cancelNavigation();
      else {
        const step = advancePath(this.localPose, pending.path, speed * seconds);
        if (step.position.x < this.localPose.x) this.localPose.direction = 'left';
        if (step.position.x > this.localPose.x) this.localPose.direction = 'right';
        moving = Math.hypot(step.position.x - this.localPose.x, step.position.y - this.localPose.y) > 0.001;
        this.localPose.x = step.position.x;
        this.localPose.y = step.position.y;
        pending.path = step.remaining;
        if (step.arrived) {
          completedAction = pending.action;
          this.navigation = null; // Consume before calling UI/server code; it can immediately open a panel.
          moving = false;
          this.drawDestinationMarker();
        }
      }
    }

    this.localPose.moving = moving;
    this.localPose.sceneId = this.state.currentSceneId;
    this.callbacks.playerPoses.set(this.localPose.userId, { ...this.localPose });
    this.placePlayer(this.localPlayer, this.localPose);
    this.nearestHotspot = this.findNearestHotspot(this.localPose);
    this.updateInteractionPrompt();
    this.maybeSendPose(time);

    if (this.nearestHotspot && this.keys.E && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      this.cancelNavigation();
      this.triggerHotspot(this.nearestHotspot);
      return;
    }
    completedAction?.();
  }

  updateGameState(state: GameState, selectedInventoryItemId: string | null) {
    if (this.state && (this.state.currentSceneId !== state.currentSceneId
      || JSON.stringify([this.state.visibleScene.runtime?.walkableArea, this.state.visibleScene.runtime?.navigationObstacles,
        this.state.visibleScene.runtime?.itemPlacements]) !== JSON.stringify([state.visibleScene.runtime?.walkableArea,
        state.visibleScene.runtime?.navigationObstacles, state.visibleScene.runtime?.itemPlacements])
      || this.selectedInventoryItemId !== selectedInventoryItemId)) this.cancelNavigation();
    const renderKey = JSON.stringify([state.currentSceneId, state.visibleScene, state.inspectedItemIds,
      state.collectedItemIds, state.sceneMap, state.completedSceneIds, state.currentSceneCanComplete,
      state.players.map((player) => [player.userId, player.username, player.role]),
      state.visibleScene.characters.map((character) => this.callbacks.newDialogueCount(character.characterId))]);
    const changed = renderKey !== this.sceneRenderKey;
    this.sceneRenderKey = renderKey;
    this.state = state;
    const selectionChanged = this.selectedInventoryItemId !== selectedInventoryItemId;
    this.selectedInventoryItemId = selectedInventoryItemId;
    if (this.ready && changed) this.draw();
    else if (this.ready && selectionChanged) this.drawInventoryHint(this.scale.width, this.scale.height);
  }

  setSceneInteractionEnabled(enabled: boolean) {
    if (!enabled) this.cancelNavigation();
    const wasEnabled = this.sceneInteractionEnabled;
    if (wasEnabled === enabled) return;
    this.sceneInteractionEnabled = enabled;
    if (wasEnabled !== enabled) {
      this.mobileMoveX = 0;
      this.input?.keyboard?.resetKeys();
    }
    if (!enabled && wasEnabled && this.localPose?.moving) {
      this.localPose.moving = false;
      this.callbacks.playerPoses.set(this.localPose.userId, { ...this.localPose });
      if (this.localPlayer) this.placePlayer(this.localPlayer, this.localPose);
      this.lastSentPoseKey = '';
      this.callbacks.onPose({ ...this.localPose });
    }
    if (this.input) {
      this.input.enabled = enabled;
      this.input.resetPointers();
    }
    if (this.game?.input) {
      this.game.input.enabled = enabled;
    }
  }

  setCameraMode(enabled: boolean) {
    if (this.cameraMode === enabled) return;
    this.cameraMode = enabled;
    if (enabled) {
      this.cancelNavigation();
      this.sceneInteractionEnabled = false;
      if (this.input) {
        this.input.enabled = true;
        this.input.resetPointers();
      }
      if (this.game?.input) {
        this.game.input.enabled = true;
      }
      this.keySpace?.reset();
      this.cameraClosingAt = 0;
      this.cameraClosingRect = null;
      this.cameraOpenedAt = this.time?.now ?? 0;
      const pointer = this.input?.activePointer;
      this.cameraAim = pointer && !pointer.wasTouch && pointer.x > 0 && pointer.y > 0
        && pointer.x < this.scale.width && pointer.y < this.scale.height ? { x: pointer.x, y: pointer.y } : null;
      if (this.ready) this.draw();
      return;
    }
    // Leaving: the capture area goes at once, the brackets fly back out, then the overlay unmounts.
    this.cameraCaptureZone?.destroy();
    this.cameraCaptureZone = null;
    if (this.ready && this.cameraGraphics && !this.reducedMotion.matches) {
      this.cameraClosingRect = this.cameraScreenRect(this.scale.width, this.scale.height);
      this.cameraClosingAt = this.time.now || 1;
    } else {
      this.cameraClosingAt = 0;
    }
    // Redraw brings the doorway buttons back (hidden while framing); the closing frame redraws with it.
    if (this.ready) this.draw();
    else this.refreshCameraOverlay();
  }

  /** Shutter button / keyboard: photograph the frame being aimed. */
  shoot() {
    if (this.cameraMode) void this.captureCameraFrame();
  }

  /** Screen point (canvas px) of the doorway leading to a scene, for the room transition. */
  transitionPoint(targetSceneId: string | null | undefined) {
    if (!this.ready || !this.state) return null;
    const transition = this.sceneRuntime()?.transitions?.find((candidate) => candidate.targetSceneId === targetSceneId);
    if (!transition) return null;
    const box = this.worldRect(transition.hotspot);
    return { x: box.x + box.w / 2, y: box.y + box.h * 0.45 };
  }

  setMobileMoveX(value: number) {
    this.mobileMoveX = Phaser.Math.Clamp(Math.trunc(value), -1, 1);
  }

  triggerPrimaryInteraction() {
    if (!this.sceneInteractionEnabled || this.cameraMode || !this.nearestHotspot) return;
    this.cancelNavigation();
    this.triggerHotspot(this.nearestHotspot);
  }

  updateRemotePose(pose: PlayerPose) {
    this.callbacks.playerPoses.set(pose.userId, pose);
    this.remoteTargets.set(pose.userId, pose);
    this.remotePoseReceivedAt.set(pose.userId, this.time.now);
    const existing = this.remotePlayers.get(pose.userId);
    if (!this.state || pose.sceneId !== this.state.currentSceneId) {
      existing?.destroy(true);
      this.remotePlayers.delete(pose.userId);
      this.remoteDisplayPoses.delete(pose.userId);
      this.remotePoseReceivedAt.delete(pose.userId);
      return;
    }

    if (existing) return;

    const displayPose = { ...pose };
    this.remoteDisplayPoses.set(pose.userId, displayPose);
    const remote = this.createPlayer(displayPose, false);
    this.placePlayer(remote, displayPose);
    this.remotePlayers.set(pose.userId, remote);
  }

  removeRemotePose(userId: string) {
    this.callbacks.playerPoses.delete(userId);
    this.remoteTargets.delete(userId);
    this.remoteDisplayPoses.delete(userId);
    this.remotePoseReceivedAt.delete(userId);
    this.remotePlayers.get(userId)?.destroy(true);
    this.remotePlayers.delete(userId);
  }

  private draw() {
    if (!this.ready || !this.state) return;

    this.children.removeAll(true);
    this.inventorySelectionLabel = null;
    this.heldItemImage = null;
    this.npcAnimations = [];
    this.npcBreathing = [];
    this.remotePlayers.clear();
    this.localPlayer = null;
    this.promptText = null;
    this.cameraGraphics = null;
    this.cameraLabel = null;
    this.cameraCaptureZone = null;
    this.destinationMarker = null;
    this.nearestHotspot = null;

    const width = this.scale.width;
    const height = this.scale.height;
    const scene = this.state.visibleScene;

    this.drawBackground(scene, width, height);
    this.drawSceneLighting(width, height);
    this.drawHotspots(scene, width, height);
    this.drawCharacters(scene, width, height);
    this.drawPlayers();
    this.drawSceneNavigation(width, height);
    this.drawInventoryHint(width, height);
    this.drawControlHint(width, height);
    this.drawCameraOverlay(width, height);
    this.drawDebugOverlay(scene, width, height);
    this.drawDestinationMarker();
    this.flushTextures();
  }

  private sceneFrame(scene = this.state?.visibleScene): SceneFrame {
    const width = this.scale.width;
    const height = this.scale.height;
    let assetWidth = 1600;
    let assetHeight = 900;

    const runtime = scene?.runtime;
    if (runtime?.width && runtime?.height) {
      assetWidth = runtime.width;
      assetHeight = runtime.height;
    } else if (scene) {
      const bgUrl = sceneBackgroundUrl(scene);
      const bgKey = `bg:${scene.sceneId}:${bgUrl}`;
      if (bgUrl && this.textures.exists(bgKey)) {
        const source = this.textures.get(bgKey).getSourceImage() as { width?: number; height?: number };
        assetWidth = source.width || assetWidth;
        assetHeight = source.height || assetHeight;
      }
    }

    const scale = Math.max(width / assetWidth, height / assetHeight);
    const frameWidth = assetWidth * scale;
    const frameHeight = assetHeight * scale;
    return {
      x: (width - frameWidth) / 2,
      y: (height - frameHeight) / 2,
      width: frameWidth,
      height: frameHeight,
    };
  }

  private hotspotRect(hotspot: Hotspot) {
    const runtimeBox = this.runtimeHotspotBox(hotspot);
    if (runtimeBox) return this.worldRect(runtimeBox);

    const frame = this.sceneFrame();
    return {
      x: frame.x + (hotspot.x / 100) * frame.width,
      y: frame.y + (hotspot.y / 100) * frame.height,
      w: Math.max((hotspot.width / 100) * frame.width, 36),
      h: Math.max((hotspot.height / 100) * frame.height, 30),
    };
  }

  private sceneRuntime() {
    return this.state?.visibleScene.runtime ?? null;
  }

  private runtimeWidth() {
    const width = this.sceneRuntime()?.width;
    return width && width > 0 ? width : 1600;
  }

  private runtimeHeight() {
    const height = this.sceneRuntime()?.height;
    return height && height > 0 ? height : 900;
  }

  private worldPoint(point: RuntimePoint) {
    const frame = this.sceneFrame();
    return {
      x: frame.x + (point.x / this.runtimeWidth()) * frame.width,
      y: frame.y + (point.y / this.runtimeHeight()) * frame.height,
    };
  }

  private worldSize(size: RuntimeSize) {
    const frame = this.sceneFrame();
    return {
      width: (size.width / this.runtimeWidth()) * frame.width,
      height: (size.height / this.runtimeHeight()) * frame.height,
    };
  }

  private worldRect(box: RuntimeBox) {
    const point = this.worldPoint({ x: box.x, y: box.y });
    const size = this.worldSize({ width: box.width, height: box.height });
    return { x: point.x, y: point.y, w: Math.max(size.width, 1), h: Math.max(size.height, 1) };
  }

  private screenToWorld(x: number, y: number) {
    const frame = this.sceneFrame();
    return {
      x: ((x - frame.x) / frame.width) * this.runtimeWidth(),
      y: ((y - frame.y) / frame.height) * this.runtimeHeight(),
    };
  }

  private originForAnchor(anchor: string | undefined) {
    switch ((anchor ?? 'bottom-center').toLowerCase()) {
      case 'top-left': return { x: 0, y: 0 };
      case 'top-center': return { x: 0.5, y: 0 };
      case 'center':
      case 'center-center': return { x: 0.5, y: 0.5 };
      case 'bottom-left': return { x: 0, y: 1 };
      case 'bottom-right': return { x: 1, y: 1 };
      case 'bottom-center':
      default: return { x: 0.5, y: 1 };
    }
  }

  private itemPlacement(itemId: string) {
    return this.sceneRuntime()?.itemPlacements?.find((placement) => placement.itemId === itemId) ?? null;
  }

  private characterPlacement(characterId: string) {
    return this.sceneRuntime()?.characterPlacements?.find((placement) => placement.characterId === characterId) ?? null;
  }

  private runtimeHotspotBox(hotspot: Hotspot) {
    const type = hotspot.type.toUpperCase();
    if (type === 'ITEM') return this.itemPlacement(hotspot.targetId)?.hotspot ?? null;
    if (type === 'CHARACTER') return this.characterPlacement(hotspot.targetId)?.hotspot ?? null;
    return null;
  }

  private drawBackground(scene: VisibleScene, width: number, height: number) {
    const bgUrl = sceneBackgroundUrl(scene);
    const bgKey = `bg:${scene.sceneId}:${bgUrl}`;

    if (bgUrl && this.textures.exists(bgKey)) {
      const frame = this.sceneFrame(scene);
      this.add.image(frame.x, frame.y, bgKey)
        .setOrigin(0, 0)
        .setDisplaySize(frame.width, frame.height);
      return;
    }

    this.add.rectangle(width / 2, height / 2, width, height, this.colorFromId(scene.sceneId, 0x13213a));
    this.add.rectangle(width * 0.5, height * 0.54, width * 0.72, height * 0.56, 0x0d1424, 0.42);
    this.add.text(width / 2, height / 2, scene.title, {
      fontFamily: 'Playfair Display, Georgia, serif',
      fontSize: '32px',
      color: '#f7efd7',
      align: 'center',
    }).setOrigin(0.5).setAlpha(0.28);

    if (bgUrl) this.queueTexture(bgKey, bgUrl);
  }

  private drawSceneLighting(_width: number, _height: number) {
    // Scene artwork already includes lighting; keep runtime from adding dark scrims.
  }

  private drawHotspots(scene: VisibleScene, width: number, height: number) {
    for (const hotspot of scene.hotspots) {
      const type = hotspot.type.toUpperCase();
      if (type === 'CHARACTER') continue;
      if (this.isCollectedSceneItem(hotspot)) continue;

      const { x, y, w, h } = this.hotspotRect(hotspot);
      const inspected = type === 'ITEM' && this.state?.inspectedItemIds.includes(hotspot.targetId);
      const collected = type === 'ITEM' && this.state?.collectedItemIds.includes(hotspot.targetId);

      // Overlay item layer: composite the item sprite into its reserved slot.
      // Collected items leave the scene (they live in the inventory bar).
      const sceneItem = this.state?.visibleScene.items.find((i) => i.itemId === hotspot.targetId);
      // Inventory loses consumed recipe inputs, while inspection history persists.
      const removedFromScene = collected || (sceneItem?.isCollectible === true && inspected);
      const itemUrl = playableAssetUrl(sceneItem?.imageUrl);
      const itemKey = itemUrl ? `item:${hotspot.targetId}:${itemUrl}` : '';
      const placement = this.itemPlacement(hotspot.targetId);
      let itemImage: Phaser.GameObjects.Image | null = null;
      if (itemKey && !removedFromScene) {
        if (this.textures.exists(itemKey)) {
          const anchor = this.originForAnchor(placement?.anchor ?? placement?.position?.anchor ?? 'center');
          const point = placement ? this.worldPoint(placement.position) : { x: x + w / 2, y: y + h / 2 };
          const size = placement ? this.worldSize(placement.size) : { width: w, height: h };
          const image = this.add.image(point.x, point.y, itemKey)
            .setOrigin(anchor.x, anchor.y)
            .setDepth(placement?.depth ?? 5);
          image.setDisplaySize(size.width, size.height);
          itemImage = image;
        } else {
          this.queueTexture(itemKey, itemUrl);
        }
      }

      const hitbox = this.add.zone(x + w / 2, y + h / 2, w, h)
        .setDepth(20)
        .setInteractive({ useHandCursor: true });
      hitbox.setData('label', hotspot.label);

      const tr = this.callbacks.tr;
      const isObject = type === 'ITEM' || type === 'OBJECT' || type === 'CLUE';
      const kicker = hotspot.isLocked ? tr('Locked', 'Đang khóa')
        : inspected ? tr('Examined', 'Đã khám nghiệm')
          : isObject ? tr('Inspect', 'Khám nghiệm') : tr('Interact', 'Tương tác');
      const note = hotspot.isLocked
        ? tr('Needs another lead.', 'Cần thêm manh mối.')
        : this.localRole() !== 'INVESTIGATOR' && (isObject || type === 'ENVIRONMENT')
          ? tr('Your Investigator partner examines objects.', 'Đồng đội Điều tra viên phụ trách khám nghiệm vật thể.')
          : '';
      const label = this.createHoverTag(kicker, hotspot.label || this.prettyId(hotspot.targetId), note);

      hitbox.on('pointerover', () => {
        itemImage?.setTint(0xffe9b0);
        this.placeHoverTag(label, x + w / 2, y - 6);
      });
      hitbox.on('pointerout', () => {
        itemImage?.clearTint();
        label.setVisible(false);
      });
      hitbox.on('pointerdown', () => {
        this.triggerHotspot(hotspot);
      });
    }
  }

  private drawCharacters(scene: VisibleScene, width: number, height: number) {
    const hotspotCharacterIds = new Set(
      scene.hotspots
        .filter((hotspot) => hotspot.type.toUpperCase() === 'CHARACTER')
        .map((hotspot) => hotspot.targetId),
    );
    const renderedCharacterIds = new Set<string>();

    for (const character of scene.characters) {
      const placement = this.characterPlacement(character.characterId);
      if (!placement) continue;
      const feet = this.worldPoint(placement.position);
      const size = this.worldSize(placement.size);
      this.drawCharacterButton(character, feet.x, feet.y, height, placement, size);
      renderedCharacterIds.add(character.characterId);
    }

    // CHARACTER hotspots are the NPC standing gaps: feet at the rect bottom-center.
    const positioned = scene.hotspots.filter((hotspot) => hotspot.type.toUpperCase() === 'CHARACTER');
    for (const hotspot of positioned) {
      const character = scene.characters.find((ch) => ch.characterId === hotspot.targetId);
      if (!character || renderedCharacterIds.has(character.characterId)) continue;
      const { x, y, w, h } = this.hotspotRect(hotspot);
      const feetX = x + w / 2;
      const feetY = Math.min(y + h, height - 112);
      this.drawCharacterButton(character, feetX, feetY, height);
      renderedCharacterIds.add(character.characterId);
    }

    const implicit = scene.characters.filter((ch) => !hotspotCharacterIds.has(ch.characterId) && !renderedCharacterIds.has(ch.characterId));
    const count = Math.max(implicit.length, 1);
    const frame = this.sceneFrame(scene);
    implicit.forEach((character, index) => {
      const x = frame.x + frame.width * (0.58 + (index * 0.3 / count));
      const y = Math.min(frame.y + frame.height * 0.8, height - 112);
      this.drawCharacterButton(character, x, y, height);
    });
  }

  // x,y = feet position of the NPC.
  private drawCharacterButton(
    character: SceneCharacter,
    x: number,
    y: number,
    height: number,
    placement?: RuntimeCharacterPlacement,
    placementSize?: RuntimeSize,
  ) {
    const group = this.add.container(x, y).setDepth(placement?.depth ?? this.actorDepth(y));
    // Keep NPCs roughly in scale with the player chibis (height * 0.26 -> ~230px)
    // so they read as people standing in the room, not looming over it.
    const npcH = placementSize?.height ?? Phaser.Math.Clamp(height * 0.27, 140, 235);
    const npcW = placementSize?.width ?? npcH * (256 / 384);
    const askable = this.state?.visibleScene.availableDialogues
      .filter((dialogue) => dialogue.characterId === character.characterId && !dialogue.isAsked && !dialogue.isLocked).length ?? 0;
    const newlyUnlocked = this.callbacks.newDialogueCount(character.characterId);

    const spriteUrls = [
      usableSpriteSheet(character.presentation?.spriteSheet) ? character.presentation!.spriteSheet!.url : '',
      playableAssetUrl(placement?.asset),
      sceneCharacterSpriteUrl(character, this.state?.currentSceneId),
      characterSpriteUrl(character),
    ].filter((url, index, urls) => url && urls.indexOf(url) === index);
    const readySpriteUrl = spriteUrls.find((url) => this.textures.exists(`npc:${character.characterId}:${url}`));
    const spriteUrl = readySpriteUrl ?? spriteUrls[0] ?? '';
    const spriteKey = spriteUrl ? `npc:${character.characterId}:${spriteUrl}` : '';
    const shadow = this.add.ellipse(0, -2, npcH * 0.4, npcH * 0.08, 0x000000, 0.32);

    let body: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    if (spriteKey && this.textures.exists(spriteKey)) {
      body = this.add.image(0, 0, spriteKey)
        .setOrigin(0.5, 1);
      (body as Phaser.GameObjects.Image).setDisplaySize(npcW, npcH);
      (body as Phaser.GameObjects.Image).setFlipX(placement?.direction === 'right');
      const sheet = character.presentation?.spriteSheet;
      if (usableSpriteSheet(sheet) && spriteUrl === sheet!.url) {
        const texture = this.textures.get(spriteKey);
        const source = texture.getSourceImage() as { width?: number; height?: number };
        const columns = Math.floor((source.width || 0) / sheet!.frameWidth);
        const rows = Math.floor((source.height || 0) / sheet!.frameHeight);
        if (columns > 0 && columns * rows >= sheet!.frameCount) {
          for (let frame = 0; frame < sheet!.frameCount; frame++) {
            if (!texture.has(`npc-frame-${frame}`)) texture.add(`npc-frame-${frame}`, 0,
              frame % columns * sheet!.frameWidth, Math.floor(frame / columns) * sheet!.frameHeight,
              sheet!.frameWidth, sheet!.frameHeight);
          }
          (body as Phaser.GameObjects.Image).setFrame('npc-frame-0').setDisplaySize(npcW, npcH)
            .setOrigin(Number.isFinite(sheet!.anchorX) ? Phaser.Math.Clamp(sheet!.anchorX!, 0, 1) : 0.5,
              Number.isFinite(sheet!.anchorY) ? Phaser.Math.Clamp(sheet!.anchorY!, 0, 1) : 1);
          this.npcAnimations.push({ body: body as Phaser.GameObjects.Image, sheet: sheet!,
            phase: [...character.characterId].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 19, lastFrame: 0 });
        }
      }
      if (!this.npcAnimations.some((animation) => animation.body === body)) {
        this.npcBreathing.push({ body: body as Phaser.GameObjects.Image, scaleX: body.scaleX,
          scaleY: body.scaleY, phase: [...character.characterId].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 19 });
      }
    } else {
      for (const url of spriteUrls) {
        this.queueTexture(`npc:${character.characterId}:${url}`, url);
      }
      body = this.add.rectangle(0, 0, npcW, npcH, this.colorFromId(character.characterId, 0x3a2a55), 0.6)
        .setOrigin(0.5, 1)
        .setStrokeStyle(1, 0xc9a84c, 0.4);
    }

    const initialText = this.add.text(0, -npcH / 2, initials(character.name), {
      fontFamily: 'Playfair Display, Georgia, serif',
      fontSize: '22px',
      color: '#f4dc8f',
      fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(body instanceof Phaser.GameObjects.Rectangle);

    const tr = this.callbacks.tr;
    const name = this.createHoverTag(
      tr('Question', 'Hỏi'),
      character.role ? `${character.name} — ${character.role}` : character.name,
      this.localRole() !== 'INTERROGATOR'
        ? tr('Your Interrogator partner questions witnesses.', 'Đồng đội Thẩm vấn viên phụ trách hỏi nhân chứng.')
        : askable ? tr(`${askable} question(s) to ask`, `${askable} câu hỏi có thể hỏi`) : '',
    );

    let newBadge: Phaser.GameObjects.Container | null = null;
    if (newlyUnlocked > 0) {
      const badgeBg = this.add.ellipse(npcW * 0.34, -npcH * 0.72, 30, 30, 0xf4dc8f, 0.95)
        .setStrokeStyle(2, 0x0a1628, 0.9);
      const badgeText = this.add.text(npcW * 0.34, -npcH * 0.72, '?', {
        fontFamily: 'Source Code Pro, monospace',
        fontSize: '18px',
        color: '#0a1628',
        fontStyle: 'bold',
      }).setOrigin(0.5);
      newBadge = this.add.container(0, 0, [badgeBg, badgeText]);
      if (!this.reducedMotion.matches) this.tweens.add({
        targets: newBadge,
        scale: { from: 0.92, to: 1.08 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    const open = () => {
      const topLeft = this.screenToWorld(x - npcW / 2, y - npcH);
      const bottomRight = this.screenToWorld(x + npcW / 2, y);
      const target = this.characterPlacement(character.characterId)?.hotspot ?? {
        ...topLeft, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
      this.approachTarget(target, () => {
        if (this.selectedInventoryItemId) this.callbacks.onHotspot({ type: 'CHARACTER', target: character.characterId,
          label: character.name, locked: 'false' });
        else this.callbacks.onCharacter(character.characterId);
      }, () => Boolean(this.state?.visibleScene.characters.some(candidate => candidate.characterId === character.characterId)));
    };
    const interactionZone = this.add.zone(0, -npcH / 2, npcW, npcH).setInteractive({ useHandCursor: true });
    interactionZone.on('pointerdown', open);
    interactionZone.on('pointerover', () => { this.placeHoverTag(name, x, y - npcH - 6); if (body instanceof Phaser.GameObjects.Image) body.setTint(0xffe9b0); });
    interactionZone.on('pointerout', () => { name.setVisible(false); if (body instanceof Phaser.GameObjects.Image) body.clearTint(); });

    group.add(newBadge ? [shadow, body, initialText, newBadge, interactionZone] : [shadow, body, initialText, interactionZone]);
  }

  private drawPlayers() {
    if (!this.state) return;
    const localPlayerInfo = this.state.players.find((p) => p.userId === this.callbacks.localUserId);
    const existingPose = this.callbacks.playerPoses.get(this.callbacks.localUserId);
    this.localPose = existingPose?.sceneId === this.state.currentSceneId
      ? existingPose
      : this.spawnPose(localPlayerInfo, 0);
    this.localPose.sceneId = this.state.currentSceneId;
    this.localPlayer = this.createPlayer(this.localPose, true);
    this.placePlayer(this.localPlayer, this.localPose);
    this.callbacks.playerPoses.set(this.localPose.userId, { ...this.localPose });

    for (const player of this.state.players) {
      if (player.userId === this.callbacks.localUserId) continue;
      const pose = this.callbacks.playerPoses.get(player.userId);
      if (!pose || pose.sceneId !== this.state.currentSceneId) continue;
      const displayPose = {
        ...pose,
        username: pose.username ?? player.username,
        role: pose.role ?? player.role,
      };
      this.remoteTargets.set(player.userId, displayPose);
      this.remoteDisplayPoses.set(player.userId, { ...displayPose });
      this.remotePoseReceivedAt.set(player.userId, this.time.now);
      const remote = this.createPlayer(displayPose, false);
      this.placePlayer(remote, displayPose);
      this.remotePlayers.set(player.userId, remote);
    }
  }

  // pose.x/pose.y is the character's feet position in scene runtime coordinates.
  private createPlayer(pose: PlayerPose, isLocal: boolean) {
    const container = this.add.container(pose.x, pose.y).setDepth(isLocal ? 80 : 70);
    const spriteH = this.worldSize({ width: 160, height: 240 }).height;
    const shadow = this.add.ellipse(0, -2, spriteH * 0.42, spriteH * 0.09, 0x000000, 0.35);

    const sheet = pose.role ? PLAYER_SHEETS[pose.role] : undefined;
    const sheetKey = sheet && this.textures.exists(sheet.key) ? sheet.key : '';
    // Phaser 4.1 fails to render Sprite objects in this setup, so player
    // characters are Images and the walk/idle cycle flips frames manually.
    let body: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
    if (sheetKey) {
      const image = this.add.image(0, 0, sheetKey, 'player-frame-0').setOrigin(0.5, 1);
      image.setDisplaySize(spriteH * (PLAYER_FRAME.width / PLAYER_FRAME.height), spriteH);
      body = image;
    } else {
      body = this.add.rectangle(0, 0, spriteH * 0.4, spriteH, this.playerColor(pose.role, isLocal), 0.9)
        .setOrigin(0.5, 1)
        .setStrokeStyle(isLocal ? 2 : 1, isLocal ? 0xf4dc8f : 0x9da2aa, isLocal ? 0.9 : 0.55);
    }

    const name = this.add.text(0, 8, this.playerLabel(pose), {
      fontFamily: 'Crimson Text, serif',
      fontSize: '14px',
      color: isLocal ? '#efd486' : '#e9dfcc',
      backgroundColor: 'rgba(13,16,20,0.86)',
      padding: { x: 7, y: 3 },
    }).setOrigin(0.5, 0);

    container.add([shadow, body, name]);
    container.setData('body', body);
    container.setData('sheetKey', sheetKey);
    container.setData('frameIndex', 0);
    return container;
  }

  private actorDepth(screenY: number) {
    // Keep feet sorting below scene HUD (120) and the camera overlay (240).
    return 30 + Phaser.Math.Clamp(screenY / this.scale.height, 0, 1) * 60;
  }

  private placePlayer(container: Phaser.GameObjects.Container, pose: PlayerPose) {
    const screen = this.worldPoint(pose);
    container.setPosition(screen.x, screen.y);
    container.setDepth(this.actorDepth(screen.y));
    container.setData('moving', pose.moving);
    const body = container.getData('body');
    const sheetKey = container.getData('sheetKey') as string;
    if (sheetKey && body instanceof Phaser.GameObjects.Image) {
      body.setFlipX(pose.direction === 'left');
    } else if (body instanceof Phaser.GameObjects.Rectangle) {
      body.setRotation(pose.moving ? Math.sin(this.time.now / 90) * 0.035 : 0);
    }
  }

  // Manual frame animation: frames 0-1 idle breathing, frames 2-7 walk cycle.
  private animatePlayers(time: number) {
    const idleFrame = Math.floor(time / 450) % 2;
    const walkFrame = 2 + (Math.floor(time / 110) % 6);
    const apply = (container: Phaser.GameObjects.Container | null) => {
      if (!container) return;
      const body = container.getData('body');
      if (!(body instanceof Phaser.GameObjects.Image) || !container.getData('sheetKey')) return;
      const frame = container.getData('moving') ? walkFrame : idleFrame;
      if (container.getData('frameIndex') !== frame) {
        body.setFrame(`player-frame-${frame}`);
        container.setData('frameIndex', frame);
      }
    };
    apply(this.localPlayer);
    for (const remote of this.remotePlayers.values()) apply(remote);
  }

  // The key hint lives in the DOM tray (above the tools); only the hidden prompt object stays here.
  private drawControlHint(width: number, height: number) {
    this.promptText = this.add.text(width / 2, height - 166, '', {
      fontFamily: 'Crimson Text, serif',
      fontSize: '17px',
      color: '#f4dc8f',
      backgroundColor: 'rgba(10,22,40,0.84)',
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setDepth(120).setVisible(false);
  }

  private drawSceneNavigation(width: number, height: number) {
    if (!this.state || this.cameraMode) return;

    const visited = this.state.sceneMap.filter((entry) => entry.isVisited && !entry.isCurrent);
    const currentIndex = this.state.sceneMap.findIndex((entry) => entry.isCurrent);
    const next = currentIndex >= 0 ? this.state.sceneMap[currentIndex + 1] : undefined;
    const completedCurrent = this.state.completedSceneIds.includes(this.state.currentSceneId);
    const canProceed = Boolean(this.state.currentSceneCanComplete);
    const runtimeTransitions = this.sceneRuntime()?.transitions ?? [];
    // Phones stack the movement dock over the tool tray, so the proceed button rides above both.
    const proceedY = height - (width <= 900 ? 214 : 112);

    if (runtimeTransitions.length > 0) {
      runtimeTransitions.forEach((transition) => {
        const targetEntry = this.state!.sceneMap.find((entry) => entry.sceneId === transition.targetSceneId);
        const canRevisit = Boolean(targetEntry?.isVisited && !targetEntry.isCurrent);
        const canUseUnlockedPath = Boolean(targetEntry?.isUnlocked && !targetEntry.isCurrent);
        if (!canRevisit && !canUseUnlockedPath) return;

        const box = this.worldRect(transition.hotspot);
        const label = transition.label || targetEntry?.title || this.callbacks.tr('Move', 'Di chuyển');
        const isAuthoredSuccessor = Boolean(canProceed && next?.sceneId === transition.targetSceneId);
        this.drawButton(
          box.x + box.w / 2,
          box.y + box.h / 2,
          this.shorten(label, 18),
          () => this.approachTarget(transition.hotspot, () => this.callbacks.onScene(transition.targetSceneId),
            () => Boolean(this.state?.sceneMap.some(entry => entry.sceneId === transition.targetSceneId && entry.isUnlocked))),
          Math.max(148, Math.min(box.w, 240)),
          isAuthoredSuccessor,
        );
      });

      // Fallback: always show a visible proceed button at the bottom so the
      // player is never stuck when a transition hotspot is hidden behind the HUD.
      if (canProceed) {
        const forwardLabel = completedCurrent && next?.isUnlocked
          ? this.callbacks.tr(`Go to ${this.shorten(next.title, 22)}`, `Đến ${this.shorten(next.title, 22)}`)
          : this.callbacks.tr('Continue investigation', 'Tiếp tục điều tra');
        this.drawButton(width / 2, proceedY, forwardLabel,
          () => this.approachScreenExit(width / 2, proceedY, () => this.callbacks.onProceed()), 230, true);
      }

      return;
    }

    visited.slice(-2).forEach((entry, index) => {
      const x = index === 0 ? 92 : width - 92;
      const y = height * 0.52;
      this.drawButton(x, y, this.shorten(entry.title, 18),
        () => this.approachScreenExit(x, y, () => this.callbacks.onScene(entry.sceneId)), 148);
    });

    const forwardLabel = !canProceed
      ? this.callbacks.tr('Keep searching', 'Tiếp tục tìm kiếm')
      : completedCurrent && next?.isUnlocked
        ? this.callbacks.tr(`Go to ${this.shorten(next.title, 22)}`, `Đến ${this.shorten(next.title, 22)}`)
        : this.callbacks.tr('Continue investigation', 'Tiếp tục điều tra');
    if (canProceed) {
      this.drawButton(width / 2, proceedY, forwardLabel,
        () => this.approachScreenExit(width / 2, proceedY, () => this.callbacks.onProceed()), 230, true);
    }
  }

  private interpolateRemotePlayers(delta: number) {
    const blend = 1 - Math.exp(-Math.max(delta, 0) / 90);
    for (const [userId, target] of this.remoteTargets) {
      const container = this.remotePlayers.get(userId);
      if (!container || target.sceneId !== this.state?.currentSceneId) continue;
      const current = this.remoteDisplayPoses.get(userId) ?? { ...target };
      current.x = Phaser.Math.Linear(current.x, target.x, blend);
      current.y = Phaser.Math.Linear(current.y, target.y, blend);
      current.direction = target.direction;
      const poseAge = this.time.now - (this.remotePoseReceivedAt.get(userId) ?? this.time.now);
      current.moving = target.moving && poseAge < 1250;
      current.sceneId = target.sceneId;
      this.remoteDisplayPoses.set(userId, current);
      this.placePlayer(container, current);
    }
  }

  // "Đang dùng": the item in hand follows the pointer while the player picks a target.
  private drawInventoryHint(width: number, height: number) {
    if (!this.selectedInventoryItemId) {
      this.inventorySelectionLabel?.destroy();
      this.inventorySelectionLabel = null;
      this.heldItemImage?.destroy();
      this.heldItemImage = null;
      return;
    }
    const itemId = this.selectedInventoryItemId;
    const item = this.state?.collectedItems?.find((candidate) => candidate.itemId === itemId)
      ?? this.state?.visibleScene.items.find((candidate) => candidate.itemId === itemId);
    const text = item?.name || this.prettyId(itemId);
    const url = playableAssetUrl(item?.imageUrl);
    const key = url ? `held:${itemId}:${url}` : '';
    if (key && !this.textures.exists(key)) {
      this.queueTexture(key, url);
      this.flushTextures();
    }
    if (this.heldItemImage && this.heldItemImage.texture.key !== key) {
      this.heldItemImage.destroy();
      this.heldItemImage = null;
    }
    if (!this.heldItemImage && key && this.textures.exists(key)) {
      this.heldItemImage = this.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(32, 32).setDepth(286);
    }
    const padding = { left: this.heldItemImage ? 42 : 10, right: 10, top: 9, bottom: 9 };
    if (this.inventorySelectionLabel) {
      this.inventorySelectionLabel.setText(text).setPadding(padding);
    } else {
      this.inventorySelectionLabel = this.add.text(0, 0, text, {
        fontFamily: 'Crimson Text, serif',
        fontSize: '15px',
        color: '#fbf6ed',
        backgroundColor: 'rgba(13,16,20,0.92)',
        padding,
      }).setDepth(285);
    }
    const pointer = this.input?.activePointer;
    const inside = pointer && !pointer.wasTouch && pointer.x > 0 && pointer.y > 0 && pointer.x < width && pointer.y < height;
    this.positionHeldItem(inside ? pointer.x : width / 2 - this.inventorySelectionLabel.width / 2 - 16, inside ? pointer.y : height - 260);
  }

  private positionHeldItem(x: number, y: number) {
    if (!this.inventorySelectionLabel) return;
    const left = Phaser.Math.Clamp(x + 16, 4, Math.max(4, this.scale.width - this.inventorySelectionLabel.width - 4));
    const top = Phaser.Math.Clamp(y + 14, 4, Math.max(4, this.scale.height - this.inventorySelectionLabel.height - 4));
    this.inventorySelectionLabel.setPosition(left, top);
    this.heldItemImage?.setPosition(left + 4, top + (this.inventorySelectionLabel.height - 32) / 2);
  }

  // Dark tag above whatever the pointer is over: what the action is, the name, and an optional note.
  private createHoverTag(kicker: string, title: string, note = '') {
    const padX = 10;
    const padY = 6;
    const kick = this.add.text(padX, padY, kicker.toUpperCase(), {
      fontFamily: 'Source Code Pro, monospace', fontSize: '10px', fontStyle: 'bold', color: '#efd486', letterSpacing: 1.8,
    } as Phaser.Types.GameObjects.Text.TextStyle);
    const name = this.add.text(padX, kick.y + kick.height + 2, title, {
      fontFamily: 'Crimson Text, Georgia, serif', fontSize: '16px', color: '#fbf6ed', wordWrap: { width: 262 },
    });
    let bottom = name.y + name.height;
    let noteText: Phaser.GameObjects.Text | null = null;
    let ruleY = 0;
    if (note) {
      ruleY = bottom + 5;
      noteText = this.add.text(padX, ruleY + 5, note, {
        fontFamily: 'Crimson Text, Georgia, serif', fontSize: '15px', color: '#d9cdb8', wordWrap: { width: 262 },
      });
      bottom = noteText.y + noteText.height;
    }
    const width = Math.ceil(Math.min(282, Math.max(kick.width, name.width, noteText?.width ?? 0) + padX * 2));
    const height = Math.ceil(bottom + padY + 1);
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.35).fillRect(3, 6, width, height);
    bg.fillStyle(0x0d1014, 1).fillRect(0, 0, width, height);
    bg.lineStyle(1, 0xefd486, 0.4).strokeRect(0.5, 0.5, width - 1, height - 1);
    if (noteText) {
      bg.lineStyle(1, 0xefd486, 0.28);
      for (let x = padX; x < width - padX; x += 5) bg.lineBetween(x, ruleY, Math.min(x + 2.5, width - padX), ruleY);
    }
    const tag = this.add.container(0, 0, noteText ? [bg, kick, name, noteText] : [bg, kick, name])
      .setDepth(280).setVisible(false);
    tag.setSize(width, height);
    return tag;
  }

  private placeHoverTag(tag: Phaser.GameObjects.Container, centerX: number, bottomY: number) {
    const x = Phaser.Math.Clamp(centerX - tag.width / 2, 8, Math.max(8, this.scale.width - tag.width - 8));
    tag.setPosition(Math.round(x), Math.round(Math.max(8, bottomY - tag.height))).setVisible(true);
  }

  private localRole() {
    return this.state?.players.find((player) => player.userId === this.callbacks.localUserId)?.role ?? null;
  }

  private drawCameraOverlay(width: number, height: number) {
    if (!this.cameraMode && !this.cameraClosingAt) return;
    this.refreshCameraOverlay(width, height);
  }

  private updateCamera(time: number, delta: number) {
    if (!this.cameraMode) {
      this.refreshCameraOverlay();
      return;
    }
    const axis = this.inputAxis();
    let moved = false;
    if (axis.x || axis.y) {
      const step = (this.keyShift?.isDown ? 900 : 360) * Math.min(delta, 100) / 1000;
      const current = this.cameraAim ?? this.cameraCentre();
      this.cameraAim = { x: current.x + axis.x * step, y: current.y + axis.y * step };
      const rect = this.cameraScreenRect(this.scale.width, this.scale.height);
      this.cameraAim = {
        x: Phaser.Math.Clamp(rect.x + rect.width / 2, rect.width / 2, this.scale.width - rect.width / 2),
        y: Phaser.Math.Clamp(rect.y + rect.height / 2, rect.height / 2, this.scale.height - rect.height / 2),
      };
      moved = true;
    }
    if (moved || time - this.cameraOpenedAt < 1150) this.refreshCameraOverlay();
  }

  private cameraCentre() {
    const frame = this.sceneFrame();
    return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  }

  // Veil over the scene, darker outside the frame, gold frame with four brackets, a label and a centre dot.
  // Opening: the brackets fly in from the screen corners and lock on; closing plays it back quickly.
  private refreshCameraOverlay(width = this.scale.width, height = this.scale.height) {
    if (!this.ready) return;
    const now = this.time.now;
    const closing = !this.cameraMode && this.cameraClosingAt > 0;
    const closeT = closing ? Math.min(1, (now - this.cameraClosingAt) / 220) : 0;
    if ((!this.cameraMode && !closing) || closeT >= 1) {
      this.cameraGraphics?.destroy();
      this.cameraLabel?.destroy();
      this.cameraCaptureZone?.destroy();
      this.cameraGraphics = null;
      this.cameraLabel = null;
      this.cameraCaptureZone = null;
      this.cameraClosingAt = 0;
      this.cameraClosingRect = null;
      return;
    }

    const rect = closing && this.cameraClosingRect ? this.cameraClosingRect : this.cameraScreenRect(width, height);
    const seconds = this.reducedMotion.matches ? 10 : (now - this.cameraOpenedAt) / 1000;
    const ramp = (start: number, duration: number) => Phaser.Math.Clamp((seconds - start) / duration, 0, 1);
    let veil = ramp(0.24, 0.3);
    let shade = ramp(0.29, 0.22);
    let fly = 1 - Math.pow(1 - ramp(0.22, 0.5), 3);
    let detail = ramp(0.62, 0.25);
    if (closing) {
      veil = 1 - closeT;
      shade = 1 - closeT;
      fly = 1 - closeT * closeT;
      detail = 0;
    }

    const graphics = this.cameraGraphics ?? this.add.graphics().setDepth(240);
    this.cameraGraphics = graphics;
    graphics.clear();
    graphics.fillStyle(0xc4c1bc, 0.13 * veil);
    graphics.fillRect(0, 0, width, height);
    graphics.fillStyle(0x09090b, 0.44 * shade);
    graphics.fillRect(0, 0, width, rect.y);
    graphics.fillRect(0, rect.y + rect.height, width, height - rect.y - rect.height);
    graphics.fillRect(0, rect.y, rect.x, rect.height);
    graphics.fillRect(rect.x + rect.width, rect.y, width - rect.x - rect.width, rect.height);
    graphics.lineStyle(1.5, 0xefd486, 0.9 * shade);
    graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);

    const size = 22 * (1 + 0.8 * (1 - fly));
    const thick = 4;
    const corners = [
      { tx: rect.x - 6, ty: rect.y - 6, sx: 0, sy: 0, dx: 1, dy: 1 },
      { tx: rect.x + rect.width + 6, ty: rect.y - 6, sx: width, sy: 0, dx: -1, dy: 1 },
      { tx: rect.x - 6, ty: rect.y + rect.height + 6, sx: 0, sy: height, dx: 1, dy: -1 },
      { tx: rect.x + rect.width + 6, ty: rect.y + rect.height + 6, sx: width, sy: height, dx: -1, dy: -1 },
    ];
    for (const corner of corners) {
      const cx = Phaser.Math.Linear(corner.sx, corner.tx, fly);
      const cy = Phaser.Math.Linear(corner.sy, corner.ty, fly);
      const across = corner.dx > 0 ? cx : cx - size;
      const down = corner.dy > 0 ? cy : cy - size;
      const barX = corner.dx > 0 ? cx : cx - thick;
      const barY = corner.dy > 0 ? cy : cy - thick;
      graphics.fillStyle(0x000000, 0.65 * fly);
      graphics.fillRect(across, barY + 1, size, thick);
      graphics.fillRect(barX, down + 1, thick, size);
      graphics.fillStyle(0xefd486, fly);
      graphics.fillRect(across, barY, size, thick);
      graphics.fillRect(barX, down, thick, size);
    }

    if (detail > 0) {
      graphics.fillStyle(0x000000, 0.35 * detail);
      graphics.fillCircle(rect.x + rect.width / 2, rect.y + rect.height / 2, 5);
      graphics.fillStyle(0xefd486, detail);
      graphics.fillCircle(rect.x + rect.width / 2, rect.y + rect.height / 2, 3);
    }

    if (!this.cameraLabel) this.cameraLabel = this.add.text(0, 0, this.callbacks.tr('Camera', 'Máy ảnh').toUpperCase(), {
      fontFamily: 'Source Code Pro, monospace',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#efd486',
      letterSpacing: 1.8,
      backgroundColor: 'rgba(13,16,20,0.9)',
      padding: { x: 7, y: 3 },
    } as Phaser.Types.GameObjects.Text.TextStyle).setDepth(245);
    const labelAbove = rect.y - this.cameraLabel.height - 7 >= 4;
    const labelX = labelAbove ? rect.x - 1.5 : rect.x + 7;
    const labelY = labelAbove ? rect.y - this.cameraLabel.height - 7 : rect.y + 7;
    this.cameraLabel.setPosition(labelX, labelY).setAlpha(detail);
    if (detail > 0) {
      graphics.lineStyle(1, 0xefd486, 0.35 * detail);
      graphics.strokeRect(labelX + 0.5, labelY + 0.5, this.cameraLabel.width - 1, this.cameraLabel.height - 1);
    }

    if (!this.cameraMode) return;
    if (!this.cameraCaptureZone) {
      this.cameraCaptureZone = this.add.zone(width / 2, height / 2, width, height)
        .setDepth(250)
        .setInteractive({ cursor: 'crosshair' })
        .on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          // A finger places the frame (the bar's shutter takes the photo); a mouse click shoots.
          this.cameraAim = { x: pointer.x, y: pointer.y };
          if (pointer.wasTouch) { this.refreshCameraOverlay(); return; }
          void this.captureCameraFrame();
        });
    } else {
      this.cameraCaptureZone.setPosition(width / 2, height / 2).setSize(width, height);
    }
  }

  private cameraScreenRect(width: number, height: number) {
    const rules = this.sceneRuntime()?.cameraRules ?? {};
    const size = this.worldSize({
      width: rules.captureRectWidth && rules.captureRectWidth > 0 ? rules.captureRectWidth : 180,
      height: rules.captureRectHeight && rules.captureRectHeight > 0 ? rules.captureRectHeight : 140,
    });
    const frame = this.sceneFrame();
    const captureWidth = Phaser.Math.Clamp(size.width * 0.85, 102, Math.min(width * 0.72, frame.width, 357));
    const captureHeight = Phaser.Math.Clamp(size.height * 0.85, 78, Math.min(height * 0.62, frame.height, 272));
    // The aim follows the mouse, a dragging finger or WASD; without one the frame starts centred.
    const aim = this.cameraAim ?? this.cameraCentre();
    const centerX = Phaser.Math.Clamp(aim.x, frame.x, frame.x + frame.width);
    const centerY = Phaser.Math.Clamp(aim.y, frame.y, frame.y + frame.height);
    return {
      x: Phaser.Math.Clamp(centerX - captureWidth / 2, frame.x, frame.x + frame.width - captureWidth),
      y: Phaser.Math.Clamp(centerY - captureHeight / 2, frame.y, frame.y + frame.height - captureHeight),
      width: captureWidth,
      height: captureHeight,
    };
  }

  private cameraWorldRect(rect: RuntimeBox): RuntimeBox {
    const topLeft = this.screenToWorld(rect.x, rect.y);
    const bottomRight = this.screenToWorld(rect.x + rect.width, rect.y + rect.height);
    const x = Phaser.Math.Clamp(Math.min(topLeft.x, bottomRight.x), 0, this.runtimeWidth());
    const y = Phaser.Math.Clamp(Math.min(topLeft.y, bottomRight.y), 0, this.runtimeHeight());
    const right = Phaser.Math.Clamp(Math.max(topLeft.x, bottomRight.x), 0, this.runtimeWidth());
    const bottom = Phaser.Math.Clamp(Math.max(topLeft.y, bottomRight.y), 0, this.runtimeHeight());
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
  }

  private async captureCameraFrame() {
    if (this.cameraCapturePending || !this.cameraMode) return;
    this.cameraCapturePending = true;
    const screenRect = this.cameraScreenRect(this.scale.width, this.scale.height);
    const worldRect = this.cameraWorldRect(screenRect);
    try {
      this.cameraGraphics?.setVisible(false);
      this.cameraLabel?.setVisible(false);
      this.cameraCaptureZone?.disableInteractive();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      const source = this.game.canvas;
      const scaleX = source.width / this.scale.width;
      const scaleY = source.height / this.scale.height;
      const sx = Math.max(0, Math.round(screenRect.x * scaleX));
      const sy = Math.max(0, Math.round(screenRect.y * scaleY));
      const sw = Math.max(1, Math.min(source.width - sx, Math.round(screenRect.width * scaleX)));
      const sh = Math.max(1, Math.min(source.height - sy, Math.round(screenRect.height * scaleY)));
      const outputScale = Math.min(1, 640 / Math.max(sw, sh));
      const output = document.createElement('canvas');
      output.width = Math.max(1, Math.round(sw * outputScale));
      output.height = Math.max(1, Math.round(sh * outputScale));
      const context = output.getContext('2d');
      if (!context) throw new Error('Camera canvas is unavailable.');
      context.imageSmoothingEnabled = false;
      context.drawImage(source, sx, sy, sw, sh, 0, 0, output.width, output.height);
      const photo = await new Promise<Blob>((resolve, reject) => {
        output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Camera image could not be encoded.')), 'image/webp', 0.82);
      });
      this.callbacks.onCapture(worldRect, photo);
    } catch (error: any) {
      this.callbacks.onCameraError(error?.message ?? 'The camera could not capture this frame.');
    } finally {
      this.cameraGraphics?.setVisible(true);
      this.cameraLabel?.setVisible(true);
      this.cameraCaptureZone?.setInteractive({ cursor: 'crosshair' });
      this.cameraCapturePending = false;
    }
  }

  private drawDebugOverlay(scene: VisibleScene, width: number, height: number) {
    if (!this.debugLayout) {
      this.debugPointerText = null;
      return;
    }

    const graphics = this.add.graphics().setDepth(300);
    const frame = this.sceneFrame(scene);
    graphics.lineStyle(2, 0xffffff, 0.9);
    graphics.strokeRect(frame.x, frame.y, frame.width, frame.height);

    graphics.lineStyle(1, 0xffffff, 0.14);
    for (let x = 0; x <= this.runtimeWidth(); x += 100) {
      const a = this.worldPoint({ x, y: 0 });
      const b = this.worldPoint({ x, y: this.runtimeHeight() });
      graphics.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = 0; y <= this.runtimeHeight(); y += 100) {
      const a = this.worldPoint({ x: 0, y });
      const b = this.worldPoint({ x: this.runtimeWidth(), y });
      graphics.lineBetween(a.x, a.y, b.x, b.y);
    }

    const runtime = this.sceneRuntime();
    if (runtime?.walkableArea) {
      this.debugBox(graphics, runtime.walkableArea, 0x3aa7ff, 0.18, 'walkable');
    }
    if (runtime?.floorY) {
      const a = this.worldPoint({ x: 0, y: runtime.floorY });
      const b = this.worldPoint({ x: this.runtimeWidth(), y: runtime.floorY });
      graphics.lineStyle(2, 0xff4fd8, 0.8);
      graphics.lineBetween(a.x, a.y, b.x, b.y);
    }

    for (const placement of runtime?.itemPlacements ?? []) {
      if (placement.reservedSlot) this.debugBox(graphics, placement.reservedSlot, 0x40e0d0, 0.34, `slot ${placement.itemId}`);
      this.debugBox(graphics, placement.hotspot, 0xffd447, 0.42, `hotspot ${placement.itemId}`);
      this.debugAnchor(graphics, placement.position, 0x71ff71);
    }

    for (const placement of runtime?.characterPlacements ?? []) {
      if (placement.reservedSlot) this.debugBox(graphics, placement.reservedSlot, 0xbe7dff, 0.32, `gap ${placement.characterId}`);
      this.debugBox(graphics, placement.hotspot, 0xffd447, 0.42, `hotspot ${placement.characterId}`);
      this.debugAnchor(graphics, placement.position, 0xff4fd8);
    }

    for (const transition of runtime?.transitions ?? []) {
      this.debugBox(graphics, transition.hotspot, 0x6fa8ff, 0.45, `exit ${transition.targetSceneId}`);
    }

    for (const zone of runtime?.clueZones ?? []) {
      this.debugBox(graphics, zone.bounds, 0x7cff9b, 0.5, `clue ${zone.clueId}`);
    }

    if (!runtime) {
      for (const hotspot of scene.hotspots) {
        const rect = this.hotspotRect(hotspot);
        graphics.lineStyle(2, 0xffd447, 0.5);
        graphics.strokeRect(rect.x, rect.y, rect.w, rect.h);
      }
    }

    this.debugPointerText = this.add.text(12, height - 142, '', {
      fontFamily: 'Source Code Pro, monospace',
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.72)',
      padding: { x: 8, y: 6 },
    }).setDepth(310);
    this.updateDebugPointerText();
  }

  private debugBox(graphics: Phaser.GameObjects.Graphics, box: RuntimeBox, color: number, alpha: number, label: string) {
    const rect = this.worldRect(box);
    graphics.lineStyle(2, color, alpha);
    graphics.strokeRect(rect.x, rect.y, rect.w, rect.h);
    this.add.text(rect.x + 4, rect.y + 4, label, {
      fontFamily: 'Source Code Pro, monospace',
      fontSize: '11px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.54)',
      padding: { x: 3, y: 2 },
    }).setDepth(305);
  }

  private debugAnchor(graphics: Phaser.GameObjects.Graphics, point: RuntimePoint, color: number) {
    const p = this.worldPoint(point);
    graphics.lineStyle(2, color, 0.94);
    graphics.lineBetween(p.x - 8, p.y, p.x + 8, p.y);
    graphics.lineBetween(p.x, p.y - 8, p.x, p.y + 8);
  }

  private updateDebugPointerText() {
    if (!this.debugPointerText) return;
    const pointer = this.input.activePointer;
    const world = this.screenToWorld(pointer.x, pointer.y);
    this.debugPointerText.setText(`screen ${Math.round(pointer.x)},${Math.round(pointer.y)} | world ${Math.round(world.x)},${Math.round(world.y)} | F2 layout`);
  }

  private drawButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    buttonWidth = 160,
    isPrimary = false,
    enabled = true,
  ) {
    const text = this.add.text(x, y, label.toUpperCase(), {
      fontFamily: 'Source Code Pro, monospace',
      fontSize: '11px',
      fontStyle: 'bold',
      color: enabled ? '#efd486' : '#b3a794',
      align: 'center',
      letterSpacing: 1.6,
    } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setAlpha(enabled ? 1 : 0.78).setDepth(26);
    const button = this.add.rectangle(x, y, Math.max(buttonWidth, text.width + 32), 40, 0x0d1014, 0.88)
      .setStrokeStyle(isPrimary ? 1.5 : 1, 0xefd486, isPrimary ? 0.8 : 0.4)
      .setAlpha(enabled ? 1 : 0.52)
      .setDepth(25);
    if (enabled) button.setInteractive({ useHandCursor: true });

    if (enabled) {
      button.on('pointerover', () => { button.setFillStyle(0x1d1a14, 0.96); text.setColor('#fbf6ed'); });
      button.on('pointerout', () => { button.setFillStyle(0x0d1014, 0.88); text.setColor('#efd486'); });
      button.on('pointerdown', onClick);
    }

    return { button, text };
  }

  private inputAxis() {
    const left = this.keys.A?.isDown || this.keys.LEFT?.isDown;
    const right = this.keys.D?.isDown || this.keys.RIGHT?.isDown;
    const up = this.keys.W?.isDown || this.keys.UP?.isDown;
    const down = this.keys.S?.isDown || this.keys.DOWN?.isDown;
    return {
      x: this.mobileMoveX || Number(Boolean(right)) - Number(Boolean(left)),
      y: Number(Boolean(down)) - Number(Boolean(up)),
    };
  }

  private walkBounds() {
    const runtime = this.sceneRuntime();
    if (runtime?.walkableArea) {
      return {
        left: runtime.walkableArea.x,
        right: runtime.walkableArea.x + runtime.walkableArea.width,
        top: runtime.walkableArea.y,
        bottom: runtime.walkableArea.y + runtime.walkableArea.height,
      };
    }

    return {
      left: this.runtimeWidth() * 0.08,
      right: this.runtimeWidth() * 0.92,
      top: this.runtimeHeight() * 0.62,
      bottom: this.runtimeHeight() * 0.88,
    };
  }

  private collidesAt(x: number, y: number) {
    return !isNavigable({ x, y }, this.navigationWorld());
  }

  private navigationWorld(): NavigationWorld {
    const bounds = this.walkBounds();
    const authored = this.sceneRuntime()?.navigationObstacles;
    const obstacles = authored ?? (this.sceneRuntime()?.itemPlacements ?? [])
      .filter(placement => !this.state?.collectedItemIds.includes(placement.itemId))
      .map(placement => placement.reservedSlot).filter((box): box is RuntimeBox => Boolean(box));
    return { bounds: { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top },
      obstacles, padding: 14 * this.runtimeWidth() / 1600 };
  }

  cancelNavigation() {
    if (!this.navigation && !this.rejectedDestination) return;
    this.navigation = null;
    this.rejectedDestination = null;
    this.destinationMarker?.destroy();
    this.destinationMarker = null;
    if (this.localPose?.moving) {
      this.localPose.moving = false;
      this.localPlayer?.setData('moving', false);
      this.callbacks.playerPoses.set(this.localPose.userId, { ...this.localPose });
      this.lastSentPoseKey = '';
      this.callbacks.onPose({ ...this.localPose });
    }
  }

  private rejectNavigation(point: NavigationPoint) {
    this.rejectedDestination = point;
    this.rejectedDestinationUntil = this.time.now + 1800;
    this.drawDestinationMarker();
    this.callbacks.onNavigationError(this.callbacks.tr('There is no reachable path to that point.', 'Không có đường đi tới điểm này.'));
  }

  private navigateTo(destination: NavigationPoint) {
    if (!this.state || !this.localPose || !this.sceneInteractionEnabled || this.cameraMode) return;
    this.cancelNavigation();
    const path = findPath(this.localPose, destination, this.navigationWorld());
    if (!path) { this.rejectNavigation(destination); return; }
    this.queueNavigation(path);
  }

  private approachTarget(target: RuntimeBox, action: () => void, valid?: () => boolean) {
    if (!this.state || !this.localPose || !this.sceneInteractionEnabled || this.cameraMode) return;
    this.cancelNavigation();
    const path = findApproachPath(this.localPose, target, this.navigationWorld(), 100 * this.runtimeWidth() / 1600);
    if (!path) { this.rejectNavigation({ x: target.x + target.width / 2, y: target.y + target.height }); return; }
    if (path.length === 0) { if (!valid || valid()) action(); return; }
    this.queueNavigation(path, action, valid);
  }

  private approachScreenExit(x: number, y: number, action: () => void) {
    const point = this.screenToWorld(x, y);
    this.approachTarget({ ...point, width: 0, height: 0 }, action);
  }

  private queueNavigation(path: NavigationPoint[], action?: () => void, valid?: () => boolean) {
    if (!this.state || !this.localPose || !path.length) return;
    this.navigation = { sceneId: this.state.currentSceneId, path, destination: { ...path[path.length - 1] },
      action, valid, inventoryItemId: this.selectedInventoryItemId };
    this.drawDestinationMarker();
  }

  private drawDestinationMarker() {
    this.destinationMarker?.destroy();
    this.destinationMarker = null;
    const destination = this.rejectedDestination ?? this.navigation?.destination;
    if (!this.ready || !destination) return;
    const point = this.worldPoint(destination);
    const marker = this.add.graphics().setDepth(29);
    marker.lineStyle(2, this.rejectedDestination ? 0xff7979 : this.navigation?.action ? 0xf4dc8f : 0x80e5cd, 0.95);
    marker.strokeEllipse(point.x, point.y, 26, 12);
    if (this.rejectedDestination) {
      marker.lineBetween(point.x - 7, point.y - 7, point.x + 7, point.y + 7);
      marker.lineBetween(point.x - 7, point.y + 7, point.x + 7, point.y - 7);
    } else {
      marker.lineBetween(point.x, point.y - 11, point.x, point.y + 11);
      marker.lineBetween(point.x - 13, point.y, point.x + 13, point.y);
    }
    this.destinationMarker = marker;
  }

  private spawnPose(player: RoomPlayer | undefined, slot: number): PlayerPose {
    const bounds = this.walkBounds();
    const runtime = this.sceneRuntime();
    const roleSpawn = player?.role ? runtime?.spawnPoints?.[player.role] : null;
    const defaultSpawn = runtime?.spawnPoints?.default;
    const spawn = roleSpawn ?? defaultSpawn;
    const x = spawn
      ? Phaser.Math.Clamp(spawn.x + slot * 18, bounds.left, bounds.right)
      : Phaser.Math.Clamp(bounds.left + 120 + slot * 92, bounds.left, bounds.right);
    const y = spawn
      ? Phaser.Math.Clamp(spawn.y + slot * 18, bounds.top, bounds.bottom)
      : Phaser.Math.Clamp(bounds.top + (bounds.bottom - bounds.top) * 0.7 - slot * 18, bounds.top, bounds.bottom);
    const safe = nearestNavigablePoint({ x, y }, this.navigationWorld()) ?? { x, y };
    return {
      userId: player?.userId ?? this.callbacks.localUserId,
      username: player?.username,
      role: player?.role,
      sceneId: this.state?.currentSceneId ?? '',
      x: safe.x,
      y: safe.y,
      direction: spawn?.direction ?? 'right',
      moving: false,
    };
  }

  private isCollectedSceneItem(hotspot: Hotspot) {
    return hotspot.type.toUpperCase() === 'ITEM'
      && this.state?.visibleScene.items.some(item => item.itemId === hotspot.targetId && item.isCollectible === true)
      && (this.state.inspectedItemIds.includes(hotspot.targetId) || this.state.collectedItemIds.includes(hotspot.targetId));
  }

  private findNearestHotspot(pose: PlayerPose) {
    if (!this.state) return null;
    let nearest: Hotspot | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const hotspot of this.state.visibleScene.hotspots) {
      if (this.isCollectedSceneItem(hotspot)) continue;
      const center = this.hotspotWorldCenter(hotspot);
      const distance = Phaser.Math.Distance.Between(pose.x, pose.y, center.x, center.y);
      const radius = hotspot.type.toUpperCase() === 'CHARACTER' ? 150 : 115;
      if (distance < radius && distance < nearestDistance) {
        nearest = hotspot;
        nearestDistance = distance;
      }
    }

    const explicitCharacterIds = new Set(
      this.state.visibleScene.hotspots
        .filter((hotspot) => hotspot.type.toUpperCase() === 'CHARACTER')
        .map((hotspot) => hotspot.targetId),
    );
    const implicitCharacters = this.state.visibleScene.characters.filter((character) => !explicitCharacterIds.has(character.characterId));
    const implicitCount = Math.max(implicitCharacters.length, 1);
    implicitCharacters.forEach((character, index) => {
      const x = this.runtimeWidth() * (0.58 + (index * 0.3 / implicitCount));
      const y = this.runtimeHeight() * 0.8;
      const distance = Phaser.Math.Distance.Between(pose.x, pose.y, x, y);
      if (distance < 130 && distance < nearestDistance) {
        nearest = {
          hotspotId: `virtual-character-${character.characterId}`,
          type: 'CHARACTER',
          targetId: character.characterId,
          x: (x / this.runtimeWidth()) * 100,
          y: (y / this.runtimeHeight()) * 100,
          width: 0,
          height: 0,
          zIndex: 1,
          label: character.name,
          isLocked: false,
        };
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  private hotspotCenter(hotspot: Hotspot) {
    const { x, y, w, h } = this.hotspotRect(hotspot);
    if (hotspot.type.toUpperCase() === 'CHARACTER') {
      return {
        x: x + w / 2,
        y: Math.min(y + h, this.scale.height - 112),
      };
    }
    return {
      x: x + w / 2,
      y: y + h / 2,
    };
  }

  private hotspotWorldCenter(hotspot: Hotspot) {
    const runtimeBox = this.runtimeHotspotBox(hotspot);
    if (runtimeBox) {
      return nearestNavigablePoint({
        x: runtimeBox.x + runtimeBox.width / 2,
        y: hotspot.type.toUpperCase() === 'CHARACTER' ? runtimeBox.y + runtimeBox.height : runtimeBox.y + runtimeBox.height / 2,
      }, this.navigationWorld()) ?? { x: runtimeBox.x, y: runtimeBox.y };
    }
    return nearestNavigablePoint({
      x: ((hotspot.x + hotspot.width / 2) / 100) * this.runtimeWidth(),
      y: ((hotspot.y + hotspot.height / 2) / 100) * this.runtimeHeight(),
    }, this.navigationWorld()) ?? { x: 0, y: 0 };
  }

  private updateInteractionPrompt() {
    if (!this.promptText || !this.nearestHotspot) {
      this.promptText?.setVisible(false);
      if (this.lastContextActionKey) {
        this.lastContextActionKey = '';
        this.callbacks.onContextAction(null);
      }
      return;
    }

    const hotspot = this.nearestHotspot;
    const type = hotspot.type.toUpperCase();
    const role = this.state?.players.find((player) => player.userId === this.callbacks.localUserId)?.role;
    const roleAllowed = type === 'CHARACTER'
      ? role === 'INTERROGATOR'
      : type === 'ITEM' || type === 'OBJECT' || type === 'CLUE' || type === 'ENVIRONMENT'
        ? role === 'INVESTIGATOR'
        : true;
    const enabled = !hotspot.isLocked && roleAllowed;
    const reason = hotspot.isLocked
      ? this.callbacks.tr('Needs another lead', 'Cần thêm manh mối')
      : roleAllowed
        ? undefined
        : type === 'CHARACTER'
          ? this.callbacks.tr('Interrogator action', 'Hành động của Thẩm vấn viên')
          : this.callbacks.tr('Investigator action', 'Hành động của Điều tra viên');
    const actionLabel = type === 'CHARACTER'
      ? this.callbacks.tr('Question', 'Hỏi')
      : type === 'ITEM' || type === 'OBJECT' || type === 'CLUE' || type === 'ENVIRONMENT'
        ? this.callbacks.tr('Inspect', 'Khám nghiệm')
        : this.callbacks.tr('Interact', 'Tương tác');
    const action: ContextAction = {
      targetId: hotspot.targetId,
      targetType: type,
      label: hotspot.label || this.prettyId(hotspot.targetId),
      actionLabel,
      keyLabel: 'E',
      enabled,
      reason,
    };
    const actionKey = `${action.targetId}:${action.enabled}:${action.reason ?? ''}`;
    if (actionKey !== this.lastContextActionKey) {
      this.lastContextActionKey = actionKey;
      this.callbacks.onContextAction(action);
    }
    this.promptText
      .setText(`${enabled ? 'E' : '—'}  ${actionLabel}: ${action.label}${reason ? ` · ${reason}` : ''}`)
      .setColor(enabled ? '#f4dc8f' : '#d9d4c4')
      .setVisible(false);
  }

  private triggerHotspot(hotspot: Hotspot) {
    if (this.isCollectedSceneItem(hotspot)) return;
    const box = this.runtimeHotspotBox(hotspot) ?? {
      x: hotspot.x / 100 * this.runtimeWidth(), y: hotspot.y / 100 * this.runtimeHeight(),
      width: hotspot.width / 100 * this.runtimeWidth(), height: hotspot.height / 100 * this.runtimeHeight() };
    this.approachTarget(box, () => {
      if (this.isCollectedSceneItem(hotspot)) return;
      const current = this.state?.visibleScene.hotspots.find(candidate => candidate.hotspotId === hotspot.hotspotId) ?? hotspot;
      this.callbacks.onHotspot({
        type: current.type.toUpperCase(), target: current.targetId, locked: String(current.isLocked), label: current.label,
      });
    }, () => hotspot.hotspotId.startsWith('virtual-character-')
      ? Boolean(this.state?.visibleScene.characters.some(character => character.characterId === hotspot.targetId))
      : Boolean(this.state?.visibleScene.hotspots.some(candidate => candidate.hotspotId === hotspot.hotspotId)));
  }

  private maybeSendPose(time: number) {
    if (!this.localPose) return;
    const poseKey = [
      Math.round(this.localPose.x),
      Math.round(this.localPose.y),
      this.localPose.direction,
      this.localPose.moving ? 1 : 0,
      this.localPose.sceneId,
    ].join(':');
    const elapsed = time - this.lastPoseSentAt;
    const unchanged = poseKey === this.lastSentPoseKey;
    if ((unchanged && elapsed < 1000) || (!unchanged && elapsed < 80)) return;
    this.lastPoseSentAt = time;
    this.lastSentPoseKey = poseKey;
    this.callbacks.onPose({ ...this.localPose });
  }

  private playerLabel(pose: PlayerPose) {
    if (pose.role === 'INVESTIGATOR') return 'Sherlock';
    if (pose.role === 'INTERROGATOR') return 'Watson';
    return pose.username?.split(' ')[0] || 'Detective';
  }

  private playerColor(role: string | null | undefined, isLocal: boolean) {
    if (role === 'INVESTIGATOR') return isLocal ? 0x355f78 : 0x29485b;
    if (role === 'INTERROGATOR') return isLocal ? 0x4f3d67 : 0x392d4b;
    return isLocal ? 0x5a5144 : 0x423b32;
  }

  private colorFromId(id: string, fallback: number) {
    let hash = 0;
    for (const ch of String(id || '')) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
    return hash ? Phaser.Display.Color.HSLToColor((hash % 360) / 360, 0.32, 0.24).color : fallback;
  }

  private shorten(value: string, maxLength: number) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  private prettyId(id: string) {
    return String(id ?? '')
      .replace(/^(item|clue|char|dlg|scene|hotspot)-/i, '')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  private queueTexture(key: string, url: string) {
    if (
      this.loadingTextureKeys.has(key) ||
      this.attemptedTextureKeys.has(key) ||
      this.failedTextureKeys.has(key) ||
      this.pendingTextures.has(key) ||
      this.textures.exists(key)
    ) return;
    this.pendingTextures.set(key, url);
  }

  // The loader ignores files added while a load is already in flight, so
  // requested textures are buffered and loaded batch by batch instead.
  private flushTextures() {
    if (this.load.isLoading() || this.pendingTextures.size === 0) return;
    for (const [key, url] of this.pendingTextures) {
      this.attemptedTextureKeys.add(key);
      this.loadingTextureKeys.add(key);
      this.load.image(key, url);
    }
    this.pendingTextures.clear();
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.loadingTextureKeys.clear();
      this.draw();
      this.flushTextures();
    });
    this.load.start();
  }

}

export async function renderGamePage(app: HTMLElement, roomId: string, { signal }: { signal?: AbortSignal } = {}) {
  if (signal?.aborted) return () => {};
  render(app, '<div class="page"><p class="muted">Opening the Phaser case file...</p></div>');

  const me = session.user();
  const introKey = `sirlocked.intro.${roomId}`;
  const audio = createAudioController();
  const modalFocus = createModalFocusManager(app);
  const unlockAudio = () => audio.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  let disposeAudioControls: (() => void) | undefined;
  let disposePingControls: (() => void) | undefined;
  let partnerPingTimer: ReturnType<typeof setTimeout> | undefined;
  const dialoguePresenter = new DialoguePresenter(() => closeUiMode());
  const cutscenes = new CutsceneController(roomId, me.userId, () => {
    if (!stopped) { audio.setDialogueActive(cutscenes.active || uiMode.kind === 'DIALOGUE'); syncPhaserInputState(); }
  });
  const hostId = `phaser-game-${roomId.replace(/[^a-z0-9_-]/gi, '')}`;

  let state: GameState | null = null;
  let uiMode: GameUiMode = { kind: 'EXPLORE' };
  let selectedInventoryItemId: string | null = null;
  let captureInFlight = false;
  let stopped = false;
  let phaserGame: Phaser.Game | null = null;
  let phaserScene: SirLockedPhaserScene | null = null;
  let sceneInputBlockedUntil = 0;
  const playerPoses = new Map<string, PlayerPose>();
  let poseErrorShown = false;
  let shellMounted = false;
  let appliedStateVersion = -1;
  let appliedSceneId = '';
  let appliedInventoryItemId: string | null = null;
  const evidencePhotoObjectUrls = new Map<string, string>();
  const evidencePhotoRequests = new Map<string, AbortController>();
  let combineMode = false;
  const combineSelection = new Set<string>();
  const puzzleDrafts = new Map<string, string[]>();
  let contextAction: ContextAction | null = null;
  let partnerActivity: PartnerActivity | null = null;
  let discoveryNotice: DiscoveryNotice | null = null;
  let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let partnerActivityTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectWaitTimer: ReturnType<typeof setInterval> | null = null;
  let requestedReconnectDeadline: number | null = null;
  let returnFocusId: string | null = null;
  let finalReadyAnnounced = false;
  let sceneIntroActive = true; // Show on initial load
  let sceneIntroTimeout: ReturnType<typeof setTimeout> | null = null;
  let connectionStatus = 'connecting';
  let stateSyncStatus = 'idle';
  let syncRecoveryActive = false;
  let roleGuide: ReturnType<typeof createRoleGuide> | null = null;
  let pairedCommandInFlight = false;
  let crackPayoffPair: DisclosedPair | null = null;
  let crackPayoffTimer: ReturnType<typeof setTimeout> | null = null;
  let caseFileOpenedAt: number | null = null;
  let waitingStartedAt: number | null = null;
  let crackPayoffShownAt: number | null = null;
  let caseCompleteDismissed = false;
  // The `attemptId:revision` this client has actually looked at; a partner's edit invalidates it.
  let acknowledgedAccusationKey: string | null = null;
  let amendedAccusation: { attemptId: string; expectedRevision: number } | null = null;
  let accusationCommandInFlight = false;
  // Kept on the consensus sheet for a moment once both detectives confirm, before the result page.
  let filedAccusation: AccusationProposal | null = null;

  // ----- "Bảng phá án" HUD: presentation-only state (never sent to the server) -----
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The server does not report CameraMissCount yet, so misses are counted here and kept for the tab's session.
  const cameraMissKey = `sirlocked.cameraMisses.${roomId}.${me.userId}`;
  let cameraMisses = Number(sessionStorage.getItem(cameraMissKey)) || 0;
  let cameraShots = 0;
  let cameraPrint: { url: string; kind: 'NEAR_MISS' | 'MISS'; caption: string; startedAt: number; outAt: number | null } | null = null;
  const cameraPrintTimers: ReturnType<typeof setTimeout>[] = [];
  let cameraFxShown = false;
  let cameraFxTimer: ReturnType<typeof setTimeout> | null = null;
  let bagWasOpen = false;
  let bagOpenedAt = 0;
  let bagGhost: { startedAt: number; liftItemId: string | null; itemId: string | null } | null = null;
  let bagGhostTimer: ReturnType<typeof setTimeout> | null = null;
  let bagThudAt = 0;
  let detailItemShown: string | null = null;
  let detailOpenedAt = 0;
  const knownInventoryIds = new Set<string>();
  const newInventoryIds = new Set<string>();
  let inventorySeeded = false;
  let discoveryShownAt = 0;
  let discoveryPhotoUrl: string | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  const clockKey = `sirlocked.gameClock.${roomId}`;
  let clockStartedAt = 0;
  let travelTimers: ReturnType<typeof setTimeout>[] = [];
  let travelTyping: ReturnType<typeof setInterval> | null = null;
  let hudKeysBound = false;
  const codeDrafts = new Map<string, string[]>();
  let trayAboveKind = '';
  let trayAboveSince = 0;

  type UiPlaytestEvent =
    | 'ReconnectRestored'
    | 'PrivateNotebookOpened'
    | 'PrivateNotebookClosed'
    | 'ConfrontationOverlayOpened'
    | 'ProposalSelectionDwell'
    | 'WaitingStarted'
    | 'WaitingEnded'
    | 'RevealDisplayed'
    | 'RevealDismissed';

  function recordV3UiEvent(
    eventType: UiPlaytestEvent,
    active = state?.activeConfrontation,
    durationMs?: number,
  ) {
    if (state?.mechanicsVersion !== 3) return;
    void gameApi.recordPlaytestEvent(roomId, {
      eventType,
      attemptId: active?.attemptId ?? undefined,
      revision: active?.revision ?? undefined,
      durationMs: durationMs === undefined ? undefined : Math.max(0, Math.round(durationMs)),
    }).catch(() => undefined);
  }

  function dismissCrackPayoff() {
    if (!crackPayoffPair) return;
    recordV3UiEvent(
      'RevealDismissed',
      undefined,
      crackPayoffShownAt === null ? undefined : performance.now() - crackPayoffShownAt,
    );
    crackPayoffPair = null;
    crackPayoffShownAt = null;
    if (crackPayoffTimer) clearTimeout(crackPayoffTimer);
    draw();
  }

  // ----- Conversation view state (dialogue overlay) -----
  type ConvLine = { speaker: 'SIRLOCKED' | 'NPC'; text: string };
  let convCharacterId: string | null = null;
  let convLog: ConvLine[] = [];
  // Conversation tree (Phase C) — current node/choices for the open tree NPC (Interrogator only).
  let convTreeNodeId: string | null = null;
  let convTreeChoices: ConversationChoice[] = [];
  let convTreeChallenge: EvidenceChallenge | null = null;
  let convTreeBusy = false;
  let convAutoRefreshPending = false;
  let convLastAutoRefreshKey = '';
  const seenAskableDialogueIds = new Set<string>();
  const newDialogueIds = new Set<string>();
  const visibleNewDialogueIds = new Set<string>();
  let hasSeededAskableDialogues = false;

  const handleKeydown = (e: KeyboardEvent) => {
    if (stopped || !state) return;
    if (modalFocus.handleKey(e)) return;
    if (e.key !== 'Escape' && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
    phaserScene?.cancelNavigation();
    if (cutscenes.handleKey(e)) return;
    if (uiMode.kind === 'DIALOGUE' && dialoguePresenter.handleKey(e)) return;

    if (e.key === 'Escape') {
      if (crackPayoffPair) {
        dismissCrackPayoff();
        return;
      }
      if (uiMode.kind === 'CASE_FILE' && uiMode.clueId) {
        setUiMode({ kind: 'CASE_FILE', section: uiMode.section });
        return;
      }
      if (uiMode.kind !== 'EXPLORE') {
        closeUiMode();
        return;
      }
    }

    if (isSceneInputBlocked()) return;

    if (e.key.toLowerCase() === 'b') {
      if (myRole() === 'INVESTIGATOR') {
        setUiMode(uiMode.kind === 'INVENTORY' ? { kind: 'EXPLORE' } : { kind: 'INVENTORY' }, 'floating-bag-btn');
      }
    } else if (e.key.toLowerCase() === 'z') {
      if (myRole() === 'INVESTIGATOR') {
        setUiMode(uiMode.kind === 'CAMERA' ? { kind: 'EXPLORE' } : { kind: 'CAMERA' }, 'floating-camera-btn');
      }
    }
  };
  window.addEventListener('keydown', handleKeydown);

  const stateRefetcher = createStateRefetcher({
    fetchState: () => gameApi.state(roomId),
    applyState,
    getVersion: () => state?.version ?? 0,
    onStatusChange: (status: string) => {
      stateSyncStatus = status;
      if (status === 'retrying' || status === 'failed') syncRecoveryActive = true;
      if (status === 'idle') syncRecoveryActive = false;
      renderRecoveryStatus();
      syncPhaserInputState();
    },
  });
  const queueStateRefetch = (version = 0) => stateRefetcher.queue(version);

  function renderReconnectWaitStatus() {
    if (stopped || !state) return;
    const slot = app.querySelector<HTMLElement>('#game-reconnect-wait-slot');
    if (!slot) return;
    const waiting = state.roomStatus === 'IN_PROGRESS' ? reconnectWait(state.players) : null;
    if (!waiting) {
      slot.replaceChildren();
      delete slot.dataset.waitKey;
      if (reconnectWaitTimer) clearInterval(reconnectWaitTimer);
      reconnectWaitTimer = null;
      requestedReconnectDeadline = null;
      return;
    }
    const key = `${waiting.deadline}:${waiting.seconds === 0}:${uiLanguage()}`;
    if (slot.dataset.waitKey !== key) {
      slot.dataset.waitKey = key;
      slot.innerHTML = renderReconnectWait(waiting, tr);
    }
    const timer = slot.querySelector('#game-reconnect-countdown');
    if (timer && waiting.seconds !== null) {
      timer.textContent = `${Math.floor(waiting.seconds / 60).toString().padStart(2, '0')}:${(waiting.seconds % 60).toString().padStart(2, '0')}`;
    }
    reconnectWaitTimer ??= setInterval(renderReconnectWaitStatus, 1000);
    // The clock only prompts one authoritative refresh per deadline. It never
    // ends the room; the server may have accepted a reconnect just before it.
    if (waiting.seconds === 0 && waiting.deadline !== requestedReconnectDeadline) {
      requestedReconnectDeadline = waiting.deadline;
      queueStateRefetch();
    }
  }

  function renderRecoveryStatus() {
    if (stopped) return;
    const slot = app.querySelector<HTMLElement>('#game-recovery-slot');
    if (!slot) return;
    const disconnected = connectionStatus === 'disconnected';
    const connecting = connectionStatus === 'connecting' || connectionStatus === 'reconnecting';
    const failed = stateSyncStatus === 'failed';
    const visible = disconnected || connecting || syncRecoveryActive;
    const key = `${connectionStatus}:${stateSyncStatus}:${visible}:${uiLanguage()}`;
    if (slot.dataset.recoveryKey === key) return;
    slot.dataset.recoveryKey = key;
    if (!visible) { slot.replaceChildren(); return; }
    const message = disconnected
      ? tr('Connection lost. Reconnect to sync with your partner.', 'Đã mất kết nối. Kết nối lại để đồng bộ với đồng đội.')
      : connecting
        ? tr('Reconnecting to your partner…', 'Đang kết nối lại với đồng đội…')
        : failed
          ? tr('The latest room state could not be loaded. Try again.', 'Chưa tải được trạng thái mới nhất của phòng. Hãy thử lại.')
          : tr('Restoring the latest room state…', 'Đang khôi phục trạng thái mới nhất của phòng…');
    slot.innerHTML = `<aside class="game-recovery" role="status" aria-live="polite">
      ${gameIcon(disconnected || connecting ? 'wifiOff' : 'info')}
      <span>${escapeHtml(message)}</span>
      <button class="bpa-btn bpa-btn--gold bpa-btn--sm" id="game-recovery-retry" type="button" ${!disconnected && (connecting || !failed) ? 'disabled' : ''}>${disconnected ? tr('Reconnect', 'Kết nối lại') : tr('Try again', 'Thử lại')}</button>
    </aside>`;
    slot.querySelector('#game-recovery-retry')?.addEventListener('click', () => {
      if (stopped) return;
      if (connectionStatus === 'disconnected') void hub.restart().catch(() => {});
      else stateRefetcher.retry();
    });
  }

  function getRoleGuide() {
    const role = myRole();
    if (!role || stopped) return null;
    roleGuide ??= createRoleGuide({ storage: window.localStorage, roomId, userId: me.userId, role });
    return roleGuide;
  }

  function recordGuideAction(action: string) {
    if (getRoleGuide()?.record(action)) renderRoleGuide();
  }

  function renderRoleGuide() {
    if (stopped) return;
    const slot = app.querySelector<HTMLElement>('#game-role-guide-slot');
    const guide = getRoleGuide();
    if (!slot || !guide) return;
    const progress = guide.snapshot();
    const key = `${progress.completed.join(',')}:${progress.dismissed}:${uiLanguage()}`;
    if (slot.dataset.guideKey === key) return;
    slot.dataset.guideKey = key;
    const steps = roleGuideSteps(myRole(), tr);
    const nextStep = steps.find((step) => !progress.completed.includes(step.id))?.id;
    slot.innerHTML = `<details class="role-guide-controls" ${progress.dismissed ? '' : 'open'}>
      <summary>${gameIcon('help')}<span class="bpa-g-lbl">${tr('Help', 'Hướng dẫn')}</span> <span class="bpa-g-guide-count" data-guide-progress aria-live="polite">${progress.completed.length}/3</span></summary>
      <section class="role-guide-panel bpa-g-pop is-end" aria-label="${tr('Your role guide', 'Hướng dẫn vai trò của bạn')}">
        <div class="bpa-g-kick">${tr('Guide', 'Hướng dẫn')} · ${escapeHtml(roleName(myRole(), tr))}</div>
        <ol>${steps.map((step) => `<li class="${progress.completed.includes(step.id) ? 'is-complete' : ''}" ${step.id === nextStep ? 'aria-current="step"' : ''}>
          <strong>${escapeHtml(step.title)} ${progress.completed.includes(step.id) ? `<span>— ${tr('Done', 'Đã làm')}</span>` : ''}</strong><p>${escapeHtml(step.text)}</p>
        </li>`).join('')}</ol>
        <p class="role-guide-note">${tr('Only your own actions check off these steps. You can keep playing with this guide open.', 'Chỉ thao tác của chính bạn mới đánh dấu các bước. Bạn vẫn chơi bình thường khi mở hướng dẫn.')}</p>
        <button class="bpa-btn bpa-btn--gold bpa-btn--sm" type="button" data-guide-dismiss>${tr('Close guide', 'Đóng hướng dẫn')}</button>
      </section>
    </details>`;
    const details = slot.querySelector<HTMLDetailsElement>('details')!;
    details.addEventListener('toggle', () => {
      if (!stopped && details.isConnected) guide.setDismissed(!details.open);
    });
    slot.querySelector('[data-guide-dismiss]')?.addEventListener('click', () => {
      guide.setDismissed(true);
      details.open = false;
      details.querySelector<HTMLElement>('summary')?.focus();
    });
  }

  function currentAskableDialogues(fresh = state) {
    return fresh?.visibleScene.availableDialogues.filter((dialogue) => !dialogue.isAsked && !dialogue.isLocked) ?? [];
  }

  function rememberAskableDialogues(fresh: GameState) {
    const askable = currentAskableDialogues(fresh);
    const askableIds = new Set(askable.map((dialogue) => dialogue.dialogueId));

    if (!hasSeededAskableDialogues) {
      askable.forEach((dialogue) => seenAskableDialogueIds.add(dialogue.dialogueId));
      hasSeededAskableDialogues = true;
      return;
    }

    for (const dialogue of askable) {
      if (!seenAskableDialogueIds.has(dialogue.dialogueId)) {
        newDialogueIds.add(dialogue.dialogueId);
      }
      seenAskableDialogueIds.add(dialogue.dialogueId);
    }

    for (const dialogueId of [...newDialogueIds]) {
      const current = fresh.visibleScene.availableDialogues.find((dialogue) => dialogue.dialogueId === dialogueId);
      if (current && (current.isAsked || current.isLocked || !askableIds.has(dialogueId))) {
        newDialogueIds.delete(dialogueId);
        visibleNewDialogueIds.delete(dialogueId);
      }
    }
    for (const dialogueId of [...visibleNewDialogueIds]) {
      const current = fresh.visibleScene.availableDialogues.find((dialogue) => dialogue.dialogueId === dialogueId);
      if (current && (current.isAsked || current.isLocked)) visibleNewDialogueIds.delete(dialogueId);
    }
  }

  function dialogueCharacter(dialogueId: string) {
    const dialogue = state?.visibleScene.availableDialogues.find((candidate) => candidate.dialogueId === dialogueId);
    if (!dialogue) return null;
    const character = state?.visibleScene.characters.find((candidate) => candidate.characterId === dialogue.characterId);
    return character ? { dialogue, character } : null;
  }

  function newDialogueCount(characterId: string) {
    return currentAskableDialogues()
      .filter((dialogue) => dialogue.characterId === characterId && newDialogueIds.has(dialogue.dialogueId))
      .length
      + treeCueBadgeCount(characterId);
  }

  function markCharacterDialoguesVisible(characterId: string) {
    for (const dialogue of currentAskableDialogues()) {
      if (dialogue.characterId !== characterId || !newDialogueIds.has(dialogue.dialogueId)) continue;
      visibleNewDialogueIds.add(dialogue.dialogueId);
      newDialogueIds.delete(dialogue.dialogueId);
    }
    markTreeCuesVisible(characterId);
  }

  function clearNewDialogue(dialogueId: string | undefined) {
    if (!dialogueId) return;
    newDialogueIds.delete(dialogueId);
    visibleNewDialogueIds.delete(dialogueId);
    seenAskableDialogueIds.add(dialogueId);
  }

  function clearVisibleDialoguesForCharacter(characterId: string) {
    for (const dialogue of currentAskableDialogues()) {
      if (dialogue.characterId === characterId) visibleNewDialogueIds.delete(dialogue.dialogueId);
    }
    visibleTreeCueByCharacter.get(characterId)?.clear();
  }

  // ----- Conversation tree "new" cues (Phase B parity for tree NPCs) -----
  const newTreeCueByCharacter = new Map<string, Set<string>>();
  const visibleTreeCueByCharacter = new Map<string, Set<string>>();

  function addTreeCue(characterId?: string, targetId?: string) {
    if (!characterId || !targetId) return;
    let set = newTreeCueByCharacter.get(characterId);
    if (!set) { set = new Set<string>(); newTreeCueByCharacter.set(characterId, set); }
    set.add(targetId);
  }

  function markTreeCuesVisible(characterId: string) {
    const fresh = newTreeCueByCharacter.get(characterId);
    if (!fresh || fresh.size === 0) return;
    let vis = visibleTreeCueByCharacter.get(characterId);
    if (!vis) { vis = new Set<string>(); visibleTreeCueByCharacter.set(characterId, vis); }
    for (const id of fresh) vis.add(id);
    fresh.clear();
  }

  function isTreeCueHighlighted(characterId: string, targetId: string) {
    return (newTreeCueByCharacter.get(characterId)?.has(targetId) ?? false)
      || (visibleTreeCueByCharacter.get(characterId)?.has(targetId) ?? false);
  }

  function treeCueBadgeCount(characterId: string) {
    return newTreeCueByCharacter.get(characterId)?.size ?? 0;
  }

  function clearTreeCue(characterId: string, targetId: string) {
    newTreeCueByCharacter.get(characterId)?.delete(targetId);
    visibleTreeCueByCharacter.get(characterId)?.delete(targetId);
  }

  function setUiMode(next: GameUiMode, triggerId?: string) {
    if (uiMode.kind === 'DIALOGUE' && (next.kind !== 'DIALOGUE' || next.characterId !== uiMode.characterId)) {
      clearVisibleDialoguesForCharacter(uiMode.characterId);
    }
    if (triggerId) returnFocusId = triggerId;
    uiMode = next;
    if (next.kind === 'CASE_FILE' && next.section !== 'map') recordGuideAction('notebook');
    if (next.kind !== 'INVENTORY') {
      combineMode = false;
      combineSelection.clear();
    }
    draw();
  }

  function closeUiMode() {
    const focusId = returnFocusId;
    if (uiMode.kind === 'DIALOGUE') clearVisibleDialoguesForCharacter(uiMode.characterId);
    uiMode = { kind: 'EXPLORE' };
    combineMode = false;
    combineSelection.clear();
    returnFocusId = null;
    draw();
    if (focusId) window.requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }

  function closeOverlay() {
    if (uiMode.kind === 'DIALOGUE') clearVisibleDialoguesForCharacter(uiMode.characterId);
    uiMode = { kind: 'EXPLORE' };
  }

  function destroyPhaser() {
    if (phaserGame) {
      phaserScene?.cancelNavigation();
      phaserGame.destroy(true);
      phaserGame = null;
      phaserScene = null;
    }
  }

  function mountShell() {
    if (shellMounted) return;
    render(app, `
      <div class="point-game point-game-phaser">
        <main class="scene-canvas phaser-scene-wrap">
          <div id="${hostId}" class="phaser-game-host"></div>
          <header id="game-hud-slot" class="game-hud game-hud-overlay"></header>
          <div id="inventory-slot"></div>
        </main>
        <div id="scene-intro-slot"></div>
        <div id="game-transient-slot"></div>
        <div id="game-dialogue-slot"></div>
        <div id="game-cutscene-slot"></div>
        <div id="game-coop-tools" class="game-coop-tools">${renderPingControls(tr)}${renderAudioControls(audio.getSettings(), tr)}<div id="game-role-guide-slot"></div></div>
        <div id="partner-ping-slot"></div>
        <div id="game-recovery-slot"></div>
      </div>`);
    shellMounted = true;
    mountPhaser();
    disposeAudioControls = bindAudioControls(app, audio);
    disposePingControls = bindPingControls(app, async (kind) => {
      await hub.sendPing(kind);
      if (kind === 'COMPARE') recordGuideAction('compare');
    });
  }

  function applyState(fresh: GameState) {
    if (stopped || !fresh || (state && fresh.version < state.version)) return;
    if (fresh.roomStatus === 'COMPLETED') {
      state = fresh;
      void cleanupGamePage();
      window.location.hash = `#/result/${roomId}`;
      return;
    }
    if (fresh.roomStatus === 'ABANDONED') {
      state = fresh;
      void cleanupGamePage();
      render(app, `<div class="page"><div class="empty-state"><h2>${escapeHtml(tr('Room ended', 'Phòng đã kết thúc'))}</h2><p>${escapeHtml(tr('This room is no longer active. Games end automatically when a detective stays offline for 5 minutes.', 'Phòng này không còn hoạt động. Ván chơi tự kết thúc khi một thám tử mất kết nối liên tục 5 phút.'))}</p><a class="btn btn-gold" href="#/cases">${escapeHtml(tr('Back to cases', 'Quay lại danh sách vụ án'))}</a></div></div>`);
      return;
    }
    const isNewScene = state && state.currentSceneId !== fresh.currentSceneId;
    // Changing rooms: keep a picture of the room being left and where its door is before the scene redraws.
    const travelStart = isNewScene ? captureTravelStart(state!, fresh) : null;
    const previousClueKey = clueKey(state);
    const freshClueKey = clueKey(fresh);
    const unlockedCluesChanged = previousClueKey !== freshClueKey;
    if (fresh.mechanicsVersion === 3) {
      const wasWaiting = state?.activeConfrontation?.status === 'AwaitingSecondConfirmation';
      const isWaiting = fresh.activeConfrontation?.status === 'AwaitingSecondConfirmation';
      if (!wasWaiting && isWaiting) {
        waitingStartedAt = performance.now();
        recordV3UiEvent('WaitingStarted', fresh.activeConfrontation);
      } else if (wasWaiting && !isWaiting) {
        recordV3UiEvent(
          'WaitingEnded',
          state?.activeConfrontation,
          waitingStartedAt === null ? undefined : performance.now() - waitingStartedAt,
        );
        waitingStartedAt = null;
      }
      const previousTerminal = state ? newestTerminalPair(state) : null;
      const freshTerminal = newestTerminalPair(fresh);
      const previousKey = previousTerminal ? `${previousTerminal.attemptId}:${previousTerminal.revision}:${previousTerminal.status}` : '';
      const freshKey = freshTerminal ? `${freshTerminal.attemptId}:${freshTerminal.revision}:${freshTerminal.status}` : '';
      if (freshTerminal && freshKey !== previousKey) {
        audio.play('reveal');
        crackPayoffPair = freshTerminal;
        crackPayoffShownAt = performance.now();
        recordV3UiEvent('RevealDisplayed', undefined);
        if (crackPayoffTimer) clearTimeout(crackPayoffTimer);
        crackPayoffTimer = setTimeout(() => {
          dismissCrackPayoff();
        }, 4500);
      }
    }
    // Scenes complete themselves server-side once every requirement is met; surface that here.
    if (state) {
      const previouslyCompleted = new Set(state.completedSceneIds);
      for (const sceneId of fresh.completedSceneIds) {
        if (previouslyCompleted.has(sceneId)) continue;
        const entry = fresh.sceneMap?.find((s) => s.sceneId === sceneId);
        const title = entry?.title ?? tr('A location', 'Một địa điểm');
        toast(tr(`${title} is fully investigated.`, `Đã hoàn tất điều tra tại ${title}.`), 'success', 4500);
      }
    }
    rememberAskableDialogues(fresh);
    rememberAccusationRevision(fresh);
    state = fresh;
    audio.setScene(fresh.currentSceneId, fresh.visibleScene.runtime?.audio);
    if (myRole() !== 'INVESTIGATOR' && uiMode.kind === 'CAMERA') uiMode = { kind: 'EXPLORE' };
    if (fresh.availableForAccusation && !finalReadyAnnounced) {
      finalReadyAnnounced = true;
      toast(tr('The final confrontation is ready.', 'Đối chất cuối cùng đã sẵn sàng.'), 'success', 5500);
    }
    
    if (isNewScene) {
      audio.play('scene');
      // The room transition's title card replaces the old location toast.
      sceneIntroActive = false;
      if (sceneIntroTimeout) clearTimeout(sceneIntroTimeout);
    }
    for (const itemId of [...combineSelection]) {
      if (!fresh.collectedItemIds.includes(itemId)) combineSelection.delete(itemId);
    }
    if (selectedInventoryItemId && !fresh.collectedItemIds.includes(selectedInventoryItemId)) {
      selectedInventoryItemId = null;
    }
    draw();
    if (travelStart) playRoomTravel(travelStart);
    if (unlockedCluesChanged) queueConversationRefreshAfterClueUnlock(fresh);
  }

  function queueConversationRefreshAfterClueUnlock(fresh: GameState) {
    if (uiMode.kind !== 'DIALOGUE' || !isTreeCharacter(uiMode.characterId) || !convTreeNodeId) return;
    const characterId = uiMode.characterId;
    const key = `${fresh.version}:${characterId}:${convTreeNodeId}:${clueKey(fresh)}`;
    if (convAutoRefreshPending || convLastAutoRefreshKey === key) return;

    convAutoRefreshPending = true;
    convLastAutoRefreshKey = key;
    window.setTimeout(async () => {
      try {
        if (uiMode.kind === 'DIALOGUE' && uiMode.characterId === characterId) {
          await refreshConverseDefaultNode(characterId);
        }
      } finally {
        convAutoRefreshPending = false;
      }
    }, 0);
  }

  // A proposal is acknowledged the first time we see it; only a later edit forces a re-read.
  function rememberAccusationRevision(fresh: GameState) {
    const proposal = fresh.activeAccusation;
    if (!proposal) {
      acknowledgedAccusationKey = null;
      return;
    }
    const seenThisAttempt = acknowledgedAccusationKey?.startsWith(`${proposal.attemptId}:`) ?? false;
    if (!seenThisAttempt) {
      acknowledgedAccusationKey = accusationRevisionKey(proposal);
      return;
    }
    if (acknowledgedAccusationKey !== accusationRevisionKey(proposal)
      && !(proposal.confirmedUserIds ?? []).includes(me.userId)) {
      toast(tr('Your partner edited the accusation.', 'Đồng đội đã sửa cáo buộc.'), 'info', 5000);
    }
  }

  function clueKey(snapshot: GameState | null | undefined) {
    return snapshot?.unlockedClues.map((clue) => clue.clueId).join('|') ?? '';
  }

  function showDiscovery(notice: DiscoveryNotice) {
    audio.play('discovery');
    // A camera hit shows the photo just taken (a blob URL); the previous one is released here.
    if (discoveryPhotoUrl && discoveryPhotoUrl !== notice.imageUrl) URL.revokeObjectURL(discoveryPhotoUrl);
    discoveryPhotoUrl = notice.imageUrl?.startsWith('blob:') ? notice.imageUrl : null;
    discoveryNotice = notice;
    discoveryShownAt = performance.now();
    if (discoveryTimer) clearTimeout(discoveryTimer);
    discoveryTimer = setTimeout(() => {
      if (discoveryNotice?.id !== notice.id) return;
      discoveryNotice = null;
      draw();
    }, 6500);
  }

  function showPartnerActivity(update: InvestigationUpdatePayload) {
    if (!state || update.actorUserId === me.userId) return;
    const actor = state.players.find((player) => player.userId === update.actorUserId);
    partnerActivity = {
      actorUserId: update.actorUserId,
      actorName: actor?.username.split(' ')[0] || tr('Partner', 'Đồng đội'),
      actorRole: update.actorRole,
      message: update.message || tr('opened a new lead', 'vừa mở một manh mối mới'),
      sceneId: update.sceneId,
      createdAt: Date.now(),
    };
    if (partnerActivityTimer) clearTimeout(partnerActivityTimer);
    partnerActivityTimer = setTimeout(() => {
      partnerActivity = null;
      draw();
    }, 6000);
    draw();
  }

  const hub = createRoomConnection(roomId, {
    TeamPing: (payload: TeamPing) => {
      if (payload.senderUserId === me.userId) return;
      const slot = app.querySelector<HTMLElement>('#partner-ping-slot');
      if (!slot) return;
      slot.innerHTML = renderPartnerPing(payload, tr);
      if (!slot.innerHTML) return;
      audio.play('ping');
      if (partnerPingTimer) clearTimeout(partnerPingTimer);
      partnerPingTimer = setTimeout(() => { slot.innerHTML = ''; }, Math.max(0, Math.min(8000, Date.parse(payload.expiresAt) - Date.now())));
    },
    GameStateUpdated: ({ version }: { version: number }) => {
      queueStateRefetch(version);
    },
    ItemFound: ({ userId }: { userId: string }) => {
      if (userId !== me.userId) toast('Your partner found something.', 'info');
    },
    ClueUnlocked: ({ clueId, userId }: { clueId: string; userId: string }) => {
      if (userId !== me.userId) {
        const clue = state?.unlockedClues.find((c) => c.clueId === clueId);
        toast(`Evidence added to the case file${clue ? `: ${clue.title}` : '.'}`, 'success');
      }
    },
    DialogueAnswered: ({ userId }: { userId: string }) => {
      if (userId !== me.userId) toast('Your partner unlocked new testimony.', 'info');
    },
    InvestigationUpdate: (update: InvestigationUpdatePayload) => {
      showPartnerActivity(update);
      const namedCharacter = update.characterId
        ? state?.visibleScene.characters.find((c) => c.characterId === update.characterId)?.name
        : undefined;
      if (update.type === 'DIALOGUE_UNLOCKED' && update.targetId) {
        newDialogueIds.add(update.targetId);
        const name = namedCharacter ?? dialogueCharacter(update.targetId)?.character.name;
        toast(`New testimony available${name ? ` from ${name}` : ''}.`, update.actorUserId === me.userId ? 'success' : 'info', 4800);
      } else if ((update.type === 'CONVERSATION_NODE_UNLOCKED' || update.type === 'CONVERSATION_CHOICE_UNLOCKED') && update.targetId) {
        addTreeCue(update.characterId, update.targetId);
        toast(`New conversation lead${namedCharacter ? ` from ${namedCharacter}` : ''}.`, update.actorUserId === me.userId ? 'success' : 'info', 4800);
      } else if (update.actorUserId !== me.userId) {
        toast(update.message || 'The investigation has a new lead.', 'info', 4200);
      }
      // The version-only GameStateUpdated event performs the single authoritative refetch.
    },
    SceneChanged: ({ userId }: { userId: string }) => {
      toast(userId === me.userId ? 'You moved to a new location.' : 'Your partner moved to another location.', 'info');
    },
    StageChanged: ({ isFinalStageCompleted, userId }: { isFinalStageCompleted: boolean; userId: string }) => {
      if (isFinalStageCompleted) {
        toast('The final confrontation is ready.', 'success', 5500);
        return;
      }
      toast(userId === me.userId ? 'A new lead opens the next location.' : 'Your partner opened a new lead.', 'success', 5500);
    },
    PlayerPoseUpdated: (pose: PlayerPose) => {
      if (!pose?.userId || pose.userId === me.userId) return;
      playerPoses.set(pose.userId, pose);
      phaserScene?.updateRemotePose(pose);
    },
    PlayerPoseLeft: ({ userId }: { userId: string }) => {
      if (!userId) return;
      playerPoses.delete(userId);
      phaserScene?.removeRemotePose(userId);
    },
    PlayerPresenceChanged: ({ userId, isConnected, changedAt, graceEndsAt }: { userId: string; isConnected: boolean; changedAt?: string; graceEndsAt?: string | null }) => {
      if (stopped) return;
      const player = state?.players.find((entry) => entry.userId === userId);
      if (player) {
        player.isConnected = isConnected;
        player.disconnectedAt = isConnected ? null : (changedAt || player.disconnectedAt);
        player.reconnectGraceEndsAt = isConnected ? null : (graceEndsAt || player.reconnectGraceEndsAt);
      }
      if (userId !== me.userId) {
        toast(isConnected ? 'Your partner reconnected.' : 'Your partner disconnected. Waiting for reconnect...', isConnected ? 'success' : 'info', 5000);
      }
      draw();
    },
    RoomStateVersion: ({ version }: { version: number }) => {
      if (Number.isFinite(version) && version > (state?.version ?? 0)) {
        queueStateRefetch(version);
      }
    },
    GameCompleted: (result: unknown) => {
      if (stopped) return;
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
      window.location.hash = `#/result/${roomId}`;
    },
    RoomError: ({ message }: { message: string }) => toast(message, 'error'),
  }, {
    onReconnected: () => {
      if (stopped) return;
      phaserScene?.cancelNavigation();
      syncRecoveryActive = true;
      poseErrorShown = false;
      toast('Reconnected. Syncing the room...', 'info');
      stateRefetcher.retry();
    },
    onStatusChange: (status: string) => {
      if (status !== 'connected') phaserScene?.cancelNavigation();
      connectionStatus = status;
      renderRecoveryStatus();
      syncPhaserInputState();
    },
  });

  signal?.addEventListener('abort', cleanupGamePage, { once: true });
  try {
    state = await gameApi.state(roomId);
    if (stopped) return cleanupGamePage;
    if (state?.roomStatus === 'COMPLETED') {
      window.location.hash = `#/result/${roomId}`;
      return cleanupGamePage;
    }
    if (state?.roomStatus === 'ABANDONED') {
      applyState(state);
      return cleanupGamePage;
    }
    await hub.start();
    if (stopped || !state) return cleanupGamePage;
    recordV3UiEvent('ReconnectRestored');
    sceneIntroTimeout = setTimeout(() => { sceneIntroActive = false; draw(); }, 3000);
    draw();
  } catch (err: any) {
    if (stopped) return cleanupGamePage;
    if (err.message?.includes('not started')) {
      window.location.hash = `#/lobby/${roomId}`;
      return cleanupGamePage;
    }
    if (state) draw(); // Keep the saved scene visible with an explicit reconnect action.
    else {
      render(app, `<div class="page"><div class="empty-state"><p role="alert">${escapeHtml(err.message)}</p><button class="btn btn-gold" id="game-load-retry">${tr('Try again', 'Thử lại')}</button></div></div>`);
      app.querySelector('#game-load-retry')?.addEventListener('click', () => window.location.reload());
    }
    return cleanupGamePage;
  }

  function myRole() {
    return state?.players.find((p) => p.userId === me.userId)?.role ?? null;
  }

  function isV3CaseComplete(current = state) {
    return Boolean(current?.roomStatus === 'COMPLETED');
  }

  function uiModel() {
    const latestPartnerLog = state!.actionLog.find((entry) => entry.userId !== me.userId);
    const fallbackPartnerActivity = latestPartnerLog
      ? {
          actorUserId: latestPartnerLog.userId,
          actorName: state!.players.find((player) => player.userId === latestPartnerLog.userId)?.username.split(' ')[0] || tr('Partner', 'Đồng đội'),
          actorRole: state!.players.find((player) => player.userId === latestPartnerLog.userId)?.role,
          message: latestPartnerLog.message,
          createdAt: new Date(latestPartnerLog.createdAt).getTime(),
        }
      : null;
    const completed = isV3CaseComplete();
    return buildGameUiModel({
      mode: uiMode,
      localUserId: me.userId,
      players: state!.players,
      objective: completed
        ? tr(
            'Case complete. The final contradiction is cracked and the truth is shared.',
            'Vụ án đã hoàn tất. Mâu thuẫn cuối cùng đã được phá và sự thật đã được chia sẻ.',
          )
        : state!.currentObjective || state!.visibleScene.description || state!.visibleScene.title,
      currentSceneId: state!.currentSceneId,
      currentSceneCanComplete: state!.currentSceneCanComplete,
      completedSceneIds: state!.completedSceneIds,
      sceneMap: state!.sceneMap,
      newQuestionCount: newDialogueIds.size,
      partnerActivity: partnerActivity ?? fallbackPartnerActivity,
      contextAction,
      discovery: discoveryNotice,
      availableForAccusation: state!.availableForAccusation,
    });
  }

  function draw() {
    if (stopped || !state) return;
    mountShell();
    ensureHudLayers();
    const root = app.querySelector('.point-game-phaser');
    root?.classList.toggle('is-dialogue', uiMode.kind === 'DIALOGUE');
    root?.classList.toggle('bpa-g-has-proceed', Boolean(state.currentSceneCanComplete));
    audio.setDialogueActive(uiMode.kind === 'DIALOGUE' || cutscenes.active);
    if (uiMode.kind !== 'DIALOGUE') resetConversation();
    const model = uiModel();
    const scene = state.visibleScene;
    audio.setScene(state.currentSceneId, scene.runtime?.audio);
    const hud = app.querySelector('#game-hud-slot');
    if (hud) {
      hud.innerHTML = renderGameHud(model, state.caseTitle, me.userId, tr, hudExtras());
    }
    startClock();
    renderReconnectWaitStatus();
    renderRecoveryStatus();
    renderRoleGuide();

    // A changed room now announces itself with the title card of the room transition.
    const introSlot = app.querySelector('#scene-intro-slot');
    if (introSlot) introSlot.innerHTML = '';

    trackInventory();
    const bagOpen = uiMode.kind === 'INVENTORY';
    if (bagOpen && !bagWasOpen) {
      bagOpenedAt = performance.now();
      clearBagGhost();
    }
    if (!bagOpen && bagWasOpen) startBagGhost();
    bagWasOpen = bagOpen;
    const detailId = bagOpen && !combineMode ? uiMode.kind === 'INVENTORY' ? uiMode.itemId ?? null : null : null;
    let focusAfterDraw = '';
    if (detailId !== detailItemShown) {
      detailOpenedAt = performance.now();
      if (detailId) focusAfterDraw = '.bpa-g-dcard [data-use-inventory], #inventory-detail-close';
      else if (bagOpen && detailItemShown) focusAfterDraw = `[data-inventory="${CSS.escape(detailItemShown)}"]`;
      detailItemShown = detailId;
    }

    const inventory = app.querySelector('#inventory-slot');
    if (inventory) inventory.innerHTML = (bagOpen ? inventoryDrawer() : inventoryDrawer(bagGhost)) + caseFileDrawer() + mobileMovementDock(model);
    renderTray(model);
    const transient = app.querySelector('#game-transient-slot');
    const completedTruth = state.sharedKnowledge?.resolvedTruths?.at(-1) ?? null;
    const caseComplete = isV3CaseComplete();
    const showCaseComplete = caseComplete
      && !crackPayoffPair
      && !caseCompleteDismissed;
    const discoveryCard = renderDiscoveryCard(discoveryNotice, tr, {
      privateRole: state.mechanicsVersion === 3 ? myRole() : null,
      elapsedMs: discoveryNotice ? performance.now() - discoveryShownAt : 0,
    });
    if (transient) transient.innerHTML = `${introOverlay(myRole())}${overlayHtml()}${accusationModal()}${accusationConsensusPanel()}${renderCrackPayoff(crackPayoffPair, escapeHtml, tr, caseComplete)}${renderV3CaseComplete(showCaseComplete, completedTruth, escapeHtml, tr)}${renderContextAction(model, tr)}${discoveryCard}${renderFinalConfrontationCallout(model, tr)}`;
    syncCameraFx();
    if (uiMode.kind === 'DIALOGUE') dialogueOverlay(uiMode.characterId);
    else dialoguePresenter.clear();
    const cinematicHost = app.querySelector<HTMLElement>('#game-cutscene-slot');
    if (cinematicHost && sessionStorage.getItem(introKey)) cutscenes.update(cinematicHost, state.presentation, ['INTRO', 'REVEAL']);

    const sceneNeedsUpdate = appliedStateVersion !== state.version
      || appliedSceneId !== state.currentSceneId
      || appliedInventoryItemId !== selectedInventoryItemId;
    if (sceneNeedsUpdate && phaserScene) {
      phaserScene.updateGameState(state, selectedInventoryItemId);
      appliedStateVersion = state.version;
      appliedSceneId = state.currentSceneId;
      appliedInventoryItemId = selectedInventoryItemId;
    }
    syncPhaserInputState();
    bind();
    bindHud();
    alignBagOrigin();
    if (!cutscenes.active && crackPayoffPair) window.requestAnimationFrame(() => app.querySelector<HTMLButtonElement>('#v3-crack-dismiss')?.focus());
    else if (!cutscenes.active && showCaseComplete) window.requestAnimationFrame(() => app.querySelector<HTMLButtonElement>('#v3-complete-review')?.focus());
    createIcons({
      icons: {
        Camera,
        Briefcase,
        X,
        FolderSearch,
        Map: MapIcon,
        Lightbulb,
      },
    });
    hydrateEvidenceImages();
    modalFocus.sync();
    // The item card takes focus on its Use button; closing it returns focus to the item's slot.
    if (focusAfterDraw) app.querySelector<HTMLElement>(focusAfterDraw)?.focus({ preventScroll: true });
  }

  function mountPhaser() {
    if (!state) return;
    const host = app.querySelector<HTMLElement>(`#${hostId}`);
    if (!host) return;

    phaserScene = new SirLockedPhaserScene({
      localUserId: me.userId,
      playerPoses,
      tr,
      newDialogueCount,
      onHotspot,
      onCharacter: (characterId) => {
        if (isSceneInputBlocked()) return;
        if (myRole() !== 'INTERROGATOR') {
          toast(tr('Your Interrogator partner handles witness questioning.', 'Đồng đội Thẩm vấn viên phụ trách hỏi nhân chứng.'), 'info');
          return;
        }
        markCharacterDialoguesVisible(characterId);
        if (isTreeCharacter(characterId) && myRole() === 'INTERROGATOR') {
          openConversation(characterId);
          return;
        }
        setUiMode({ kind: 'DIALOGUE', characterId });
      },
      onCapture: (captureRect, photo) => captureClue(captureRect, photo),
      onCameraError: (message) => toast(message, 'error'),
      onNavigationError: (message) => { audio.play('error'); toast(message, 'info'); },
      onContextAction: (action) => {
        const previousKey = contextAction ? `${contextAction.targetType}:${contextAction.targetId}:${contextAction.enabled}:${contextAction.reason ?? ''}` : '';
        const nextKey = action ? `${action.targetType}:${action.targetId}:${action.enabled}:${action.reason ?? ''}` : '';
        const previousWasVisible = Boolean(contextAction && contextAction.targetType !== 'CHARACTER');
        const nextIsVisible = Boolean(action && action.targetType !== 'CHARACTER');
        contextAction = action;
        if (previousKey !== nextKey && (previousWasVisible || nextIsVisible)) draw();
      },
      onProceed: () => {
        if (isSceneInputBlocked() || discoveryNotice) return;
        completeScene();
      },
      onScene: (sceneId) => {
        if (isSceneInputBlocked() || discoveryNotice) return;
        goToScene(sceneId);
      },
      onPose: (pose) => {
        if (hub.connection.state !== 'Connected') return;
        hub.connection.invoke('UpdatePlayerPose', roomId, {
          sceneId: pose.sceneId,
          x: pose.x,
          y: pose.y,
          direction: pose.direction,
          moving: pose.moving,
        }).catch((err: any) => {
          if (!poseErrorShown) {
            poseErrorShown = true;
            toast(`Realtime movement sync failed: ${err?.message ?? 'hub error'}`, 'error', 5500);
          }
          console.warn('UpdatePlayerPose failed', err);
        });
      },
    });

    phaserGame = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      backgroundColor: '#050812',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.NO_CENTER,
        width: 1600,
        height: 900,
      },
      scene: phaserScene,
      render: {
        antialias: false,
        pixelArt: true,
        preserveDrawingBuffer: true,
      },
    });

    phaserScene.updateGameState(state, selectedInventoryItemId);
    appliedStateVersion = state.version;
    appliedSceneId = state.currentSceneId;
    appliedInventoryItemId = selectedInventoryItemId;
    syncPhaserInputState();
    // Debug handle for QA tooling (canvas snapshots, state inspection).
    (window as unknown as Record<string, unknown>).__sirlockedGame = phaserGame;
  }

  function playersHtml() {
    return state!.players.map((p) => `
      <span class="chip ${p.userId === me.userId ? 'chip-gold' : ''}" title="${escapeHtml(p.username)}">
        ${escapeHtml(p.username.split(' ')[0])} / ${p.role === 'INVESTIGATOR' ? 'INV' : 'INT'}${p.isConnected === false ? ` / ${tr('OFFLINE', 'MẤT KẾT NỐI')}` : ''}
      </span>`).join('');
  }

  function locationTitleParts(title: string) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 2) return { area: title.toUpperCase(), scene: '' };
    return {
      area: words.slice(0, 2).join(' ').toUpperCase(),
      scene: words.slice(2).join(' '),
    };
  }

  // ----- "Bảng phá án" HUD helpers -----

  // Layers that outlive redraws: the tool tray (which adopts the co-op tools), the camera
  // open/close effect and a status line for screen readers.
  function ensureHudLayers() {
    const sceneCanvas = app.querySelector<HTMLElement>('.point-game-phaser .scene-canvas');
    const root = app.querySelector<HTMLElement>('.point-game-phaser');
    if (!sceneCanvas || !root || sceneCanvas.querySelector('#bpa-g-tray')) return;
    const blade = '<g class="bpa-g-bl"><path d="M-320 0H320V320H-320Z"/><path class="is-e" d="M-320 0H320"/></g>';
    const fx = document.createElement('div');
    fx.id = 'bpa-g-camfx';
    fx.className = 'bpa-g-camfx';
    fx.hidden = true;
    fx.setAttribute('aria-hidden', 'true');
    fx.innerHTML = `<span class="bpa-g-lb is-t"></span><span class="bpa-g-lb is-b"></span>
      <svg class="bpa-g-ap" viewBox="-100 -100 200 200"><defs><linearGradient id="bpa-g-blg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d342a"/><stop offset=".1" stop-color="#1c1814"/><stop offset="1" stop-color="#0d0b09"/></linearGradient></defs>
      ${[0, 60, 120, 180, 240, 300].map((angle) => `<g transform="rotate(${angle})">${blade}</g>`).join('')}</svg>
      <span class="bpa-g-flash"></span>`;
    sceneCanvas.querySelector('#game-hud-slot')?.before(fx);
    const tray = document.createElement('div');
    tray.id = 'bpa-g-tray';
    tray.className = 'bpa-g-dock';
    tray.innerHTML = `<div class="bpa-g-dock-above" id="bpa-g-tray-above"></div>
      <nav class="bpa-g-tools" aria-label="${tr('Investigation tools', 'Công cụ điều tra')}"><div class="investigation-tool-dock bpa-g-tools-main" id="bpa-g-tray-main"></div></nav>`;
    sceneCanvas.append(tray);
    const coop = app.querySelector<HTMLElement>('#game-coop-tools');
    if (coop) {
      coop.classList.add('bpa-g-coop');
      tray.querySelector('.bpa-g-tools')?.append(coop);
    }
    const status = document.createElement('p');
    status.id = 'bpa-g-sr';
    status.className = 'bpa-sr';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(status);
  }

  function renderTray(model: ReturnType<typeof buildGameUiModel>) {
    const main = app.querySelector<HTMLElement>('#bpa-g-tray-main');
    if (main) keepFocus(main, () => { main.innerHTML = investigationToolDock(model); });
    renderTrayAbove(model);
  }

  // Redraws replace the tray's buttons; a keyboard user keeps their place (matched by id).
  function keepFocus(container: HTMLElement, rerender: () => void) {
    const focused = document.activeElement instanceof HTMLElement && container.contains(document.activeElement)
      ? document.activeElement.id : '';
    rerender();
    if (focused) container.querySelector<HTMLElement>(`#${CSS.escape(focused)}`)?.focus({ preventScroll: true });
  }

  function renderTrayAbove(model = uiModel()) {
    const above = app.querySelector<HTMLElement>('#bpa-g-tray-above');
    if (!above) return;
    const kind = model.mode.kind === 'CAMERA' ? 'camera' : selectedInventoryItemId && model.mode.kind === 'EXPLORE' ? `use:${selectedInventoryItemId}` : 'hint';
    if (kind !== trayAboveKind) { trayAboveKind = kind; trayAboveSince = performance.now(); }
    const offset = `--bpa-t: -${Math.round(performance.now() - trayAboveSince)}ms`;
    keepFocus(above, () => {
      above.innerHTML = kind === 'camera'
        ? cameraBarHtml(offset)
        : kind === 'hint'
          ? `<p class="bpa-g-hintbar">${tr('Click to walk / interact · WASD / arrows · E interact · Esc cancel', 'Bấm để đi / tương tác · WASD / mũi tên · E tương tác · Esc hủy')}</p>`
          : useBarHtml(offset);
    });
    bindTrayAbove();
  }

  function cameraBarHtml(offset: string) {
    const now = performance.now();
    const print = cameraPrint
      ? `<div class="bpa-g-print is-${cameraPrint.kind === 'NEAR_MISS' ? 'near' : 'miss'} ${cameraPrint.outAt ? 'is-out' : ''}" aria-hidden="true"
          style="--bpa-t: -${Math.round(now - cameraPrint.startedAt)}ms; --bpa-t-out: -${cameraPrint.outAt ? Math.round(now - cameraPrint.outAt) : 0}ms">
          <img src="${escapeHtml(cameraPrint.url)}" alt="">
          <span class="bpa-g-print-cap">${escapeHtml(cameraPrint.caption)}</span>
          <span class="bpa-g-print-stamp">${cameraPrint.kind === 'NEAR_MISS' ? tr('UNCLEAR', 'CHƯA RÕ') : tr('MISSED', 'CHỤP TRƯỢT')}</span>
        </div>`
      : '';
    return `<div class="bpa-g-modewrap">${print}
      <section class="bpa-g-modebar bpa-g-glass" aria-label="${tr('Camera', 'Máy ảnh')}" style="--bpa-g-bar-delay: 300ms; ${offset}">
        <span class="bpa-g-mb-ic" aria-hidden="true">${gameIcon('camera')}</span>
        <div class="bpa-g-mb-txt">
          <span class="bpa-g-kick">${tr('Camera', 'Máy ảnh')}</span>
          <span class="bpa-g-mb-help bpa-g-fine">${tr('Move the mouse or', 'Rê chuột hoặc')} <kbd>WASD</kbd> ${tr('to aim', 'để ngắm')} · ${tr('Click or', 'Bấm hoặc')} <kbd>Space</kbd> ${tr('to shoot', 'để chụp')}</span>
          <span class="bpa-g-mb-help bpa-g-coarse">${tr('Tap or drag to place the frame · Press the shutter', 'Chạm hoặc kéo để đặt khung · Bấm nút chụp')}</span>
        </div>
        <span class="bpa-g-mb-sep" aria-hidden="true"></span>
        <div class="bpa-g-mb-count">
          <span class="bpa-g-mb-nums"><span>${tr('Captured', 'Đã chụp')} <b>${state!.capturedClueIds?.length ?? 0}</b></span><span class="is-miss">${tr('Missed', 'Chụp trượt')} <b>${cameraMisses}</b></span></span>
          <span class="bpa-g-mb-note">${tr('Each missed shot costs investigation points.', 'Mỗi lần chụp trượt bị trừ điểm điều tra.')}</span>
        </div>
        <div class="bpa-g-mb-act">
          <button type="button" class="bpa-g-shut" id="bpa-g-shutter" aria-label="${tr('Photograph the framed area', 'Chụp khung đang ngắm')}" aria-keyshortcuts="Space" ${captureInFlight ? 'disabled' : ''}><span></span></button>
          <button type="button" class="bpa-btn bpa-btn--gold bpa-btn--sm" id="bpa-g-camera-exit" aria-keyshortcuts="Escape">${tr('Exit', 'Thoát')} <kbd>Esc</kbd></button>
        </div>
      </section></div>`;
  }

  function useBarHtml(offset: string) {
    const item = collectedItem(selectedInventoryItemId!);
    const picture = item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">` : escapeHtml(initials(item.name));
    return `<div class="bpa-g-modewrap">
      <section class="bpa-g-modebar bpa-g-glass" aria-label="${tr('Using an item', 'Đang dùng vật phẩm')}" style="${offset}">
        <span class="bpa-g-mb-item" aria-hidden="true">${picture}</span>
        <div class="bpa-g-mb-txt">
          <span class="bpa-g-mb-main">${tr('Using', 'Đang dùng')}: <b>${escapeHtml(item.name)}</b></span>
          <span class="bpa-g-mb-help">${tr('Choose a target in the scene', 'Chọn đích trong cảnh')} · <kbd>Esc</kbd> ${tr('cancel', 'hủy')}</span>
        </div>
        <div class="bpa-g-mb-act"><button type="button" class="bpa-btn bpa-btn--gold bpa-btn--sm" id="bpa-g-use-cancel" aria-keyshortcuts="Escape">${tr('Cancel', 'Hủy')}</button></div>
      </section></div>`;
  }

  function collectedItem(itemId: string): SceneItem {
    const item = state!.collectedItems?.find((candidate) => candidate.itemId === itemId)
      ?? state!.visibleScene.items.find((candidate) => candidate.itemId === itemId);
    return item ?? { itemId, name: prettyId(itemId), description: '', imageUrl: '' };
  }

  function bindTrayAbove() {
    app.querySelector('#bpa-g-shutter')?.addEventListener('click', () => phaserScene?.shoot());
    app.querySelector('#bpa-g-camera-exit')?.addEventListener('click', () => closeUiMode());
    app.querySelector('#bpa-g-use-cancel')?.addEventListener('click', cancelItemUse);
  }

  function bindHud() {
    app.querySelectorAll<HTMLElement>('[data-bpa-locked-tool]').forEach((button) => button.addEventListener('click', () => {
      toast(button.dataset.bpaLockedTool === 'camera'
        ? tr('Only the Investigator can capture scene clues.', 'Chỉ Điều tra viên có thể chụp manh mối hiện trường.')
        : tr('Only the Investigator can use inventory items.', 'Chỉ Điều tra viên có thể dùng đồ trong túi.'), 'info');
    }));
    bindCodeCells();
    if (hudKeysBound) return;
    hudKeysBound = true;
    // Esc puts the item in hand back; outside clicks close the sound panel like the other tray menus.
    window.addEventListener('keydown', (event) => {
      if (stopped || event.key !== 'Escape' || !selectedInventoryItemId || uiMode.kind !== 'EXPLORE') return;
      cancelItemUse();
    }, { signal });
    document.addEventListener('pointerdown', (event) => {
      const open = app.querySelector<HTMLDetailsElement>('.bpa-g-coop .game-audio-controls[open]');
      if (open && event.target instanceof Node && !open.contains(event.target)) open.open = false;
    }, { capture: true, signal });
  }

  function cancelItemUse() {
    if (!selectedInventoryItemId) return;
    selectedInventoryItemId = null;
    draw();
    window.requestAnimationFrame(() => app.querySelector<HTMLElement>('#floating-bag-btn')?.focus());
  }

  // Investigation clock: from the first moment this room was seen on this device or its oldest log entry.
  function startClock() {
    const firstLog = (state?.actionLog ?? []).reduce((min, entry) => Math.min(min, Date.parse(entry.createdAt) || Infinity), Infinity);
    if (!clockStartedAt) {
      let stored = NaN;
      try { stored = Number(localStorage.getItem(clockKey)); } catch { /* storage may be blocked */ }
      clockStartedAt = Math.min(stored > 0 ? stored : Infinity, Date.now());
    }
    if (firstLog < clockStartedAt) clockStartedAt = firstLog;
    try { localStorage.setItem(clockKey, String(clockStartedAt)); } catch { /* memory-only clock */ }
    clockTimer ??= setInterval(() => {
      if (stopped) { if (clockTimer) clearInterval(clockTimer); clockTimer = null; return; }
      const clock = app.querySelector('#bpa-g-clock');
      if (clock) clock.textContent = clockText((Date.now() - clockStartedAt) / 1000);
    }, 1000);
  }

  function hudExtras(): HudExtras {
    if (!clockStartedAt) startClock();
    const sceneIndex = state!.sceneMap.findIndex((entry) => entry.sceneId === state!.currentSceneId || entry.isCurrent);
    const whereabouts: Record<string, string> = {};
    for (const player of state!.players) {
      if (player.userId === me.userId) { whereabouts[player.userId] = state!.visibleScene.title; continue; }
      const sceneId = playerPoses.get(player.userId)?.sceneId;
      const entry = sceneId ? state!.sceneMap.find((candidate) => candidate.sceneId === sceneId) : null;
      whereabouts[player.userId] = entry?.title ?? roleName(player.role, tr);
    }
    return {
      sceneTitle: state!.visibleScene.title,
      actNumber: sceneIndex >= 0 ? sceneIndex + 1 : 1,
      roomCode: state!.roomCode,
      clockSeconds: (Date.now() - clockStartedAt) / 1000,
      progress: sceneProgress(),
      whereabouts,
    };
  }

  // Role-shaped progress in this location: objects examined (Investigator) or statements taken (Interrogator).
  function sceneProgress(): HudExtras['progress'] {
    const scene = state!.visibleScene;
    if (myRole() === 'INTERROGATOR') {
      const total = scene.availableDialogues.length;
      return total ? { done: scene.availableDialogues.filter((dialogue) => dialogue.isAsked).length, total, unit: 'TESTIMONY' } : null;
    }
    const targets = new Set<string>();
    const done = new Set<string>();
    for (const hotspot of scene.hotspots) {
      if (!['ITEM', 'OBJECT', 'CLUE', 'ENVIRONMENT'].includes(hotspot.type.toUpperCase())) continue;
      targets.add(hotspot.targetId);
      if (state!.inspectedItemIds.includes(hotspot.targetId) || state!.collectedItemIds.includes(hotspot.targetId)
        || state!.usedInteractionIds?.includes(hotspot.targetId) || state!.usedInteractionIds?.includes(hotspot.hotspotId)) done.add(hotspot.targetId);
    }
    for (const zone of scene.runtime?.clueZones ?? []) {
      targets.add(`clue:${zone.clueId}`);
      if (state!.capturedClueIds?.includes(zone.clueId)) done.add(`clue:${zone.clueId}`);
    }
    return targets.size ? { done: done.size, total: targets.size, unit: 'EVIDENCE' } : null;
  }

  // Items that arrived since the satchel was last opened get a "new" mark.
  function trackInventory() {
    const ids = state!.collectedItemIds ?? [];
    if (!inventorySeeded) {
      ids.forEach((id) => knownInventoryIds.add(id));
      inventorySeeded = true;
      return;
    }
    for (const id of ids) {
      if (knownInventoryIds.has(id)) continue;
      knownInventoryIds.add(id);
      newInventoryIds.add(id);
    }
    for (const id of [...newInventoryIds]) if (!ids.includes(id)) newInventoryIds.delete(id);
  }

  // The satchel closes back into its button: its DOM stays ≈300 ms (400 ms when an item is lifted out for use).
  function startBagGhost() {
    newInventoryIds.clear();
    clearBagGhost();
    if (reducedMotion.matches) return;
    const liftItemId = selectedInventoryItemId;
    bagGhost = { startedAt: performance.now(), liftItemId, itemId: detailItemShown };
    bagGhostTimer = setTimeout(() => {
      bagGhost = null;
      bagGhostTimer = null;
      app.querySelector('.bpa-g-bag-ghost')?.remove();
      bagThudAt = performance.now();
      const tool = app.querySelector<HTMLElement>('[data-bpa-tool="bag"]');
      if (tool) { tool.classList.remove('is-thud'); void tool.offsetWidth; tool.classList.add('is-thud'); }
    }, liftItemId ? 400 : 300);
  }

  function clearBagGhost() {
    if (bagGhostTimer) clearTimeout(bagGhostTimer);
    bagGhostTimer = null;
    bagGhost = null;
  }

  // The satchel grows out of its tray button.
  function alignBagOrigin() {
    const bag = app.querySelector<HTMLElement>('#inventory-slot .bpa-g-bag');
    const tool = app.querySelector<HTMLElement>('[data-bpa-tool="bag"]');
    const slot = app.querySelector<HTMLElement>('#inventory-slot');
    if (!bag || !tool || !slot || window.matchMedia('(max-width: 900px)').matches) return;
    const toolBox = tool.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    const originX = toolBox.left + toolBox.width / 2 - slotBox.left - (bag.offsetLeft - bag.offsetWidth / 2);
    bag.style.setProperty('--bpa-g-origin-x', `${Math.round(originX)}px`);
  }

  // Camera open/close effect: six-blade aperture blink and letterbox bars (the brackets live in Phaser).
  function syncCameraFx() {
    const on = uiMode.kind === 'CAMERA';
    const fx = app.querySelector<HTMLElement>('#bpa-g-camfx');
    if (!fx || on === cameraFxShown) return;
    cameraFxShown = on;
    if (cameraFxTimer) clearTimeout(cameraFxTimer);
    cameraFxTimer = null;
    if (on) {
      fx.hidden = false;
      fx.className = 'bpa-g-camfx';
      void fx.offsetWidth;
      fx.classList.add('is-in');
      return;
    }
    clearCameraPrint();
    fx.className = 'bpa-g-camfx is-out';
    cameraFxTimer = setTimeout(() => { fx.hidden = true; fx.className = 'bpa-g-camfx'; }, reducedMotion.matches ? 0 : 340);
  }

  function flashCamera() {
    const flash = app.querySelector<HTMLElement>('#bpa-g-camfx .bpa-g-flash');
    if (!flash || reducedMotion.matches) return;
    flash.classList.remove('is-on');
    void flash.offsetWidth;
    flash.classList.add('is-on');
  }

  // The print of a near miss or miss slides up behind the camera bar, then drops away.
  function showCameraPrint(photo: Blob, kind: 'NEAR_MISS' | 'MISS', caption: string) {
    clearCameraPrint();
    cameraPrint = { url: URL.createObjectURL(photo), kind, caption, startedAt: performance.now(), outAt: null };
    cameraPrintTimers.push(setTimeout(() => {
      if (!cameraPrint || stopped) return;
      cameraPrint.outAt = performance.now();
      if (uiMode.kind === 'CAMERA') renderTrayAbove();
    }, 2700));
    cameraPrintTimers.push(setTimeout(() => {
      clearCameraPrint();
      if (!stopped && uiMode.kind === 'CAMERA') renderTrayAbove();
    }, 3150));
  }

  function clearCameraPrint() {
    cameraPrintTimers.splice(0).forEach((timer) => clearTimeout(timer));
    if (cameraPrint) URL.revokeObjectURL(cameraPrint.url);
    cameraPrint = null;
  }

  function announce(message: string) {
    const status = app.querySelector('#bpa-g-sr');
    if (status) status.textContent = message;
  }

  // Code lock cells: one character per cell, arrows roll digits, typing moves on; the hidden field keeps the answer.
  function bindCodeCells() {
    const cells = [...app.querySelectorAll<HTMLInputElement>('[data-code-cell]')];
    const answer = app.querySelector<HTMLInputElement>('#puzzle-code-answer');
    if (!answer) return;
    const puzzleId = answer.dataset.puzzleId ?? '';
    // Capture phase: the cells must be emptied before the existing Clear handler redraws the lock.
    app.querySelector('#puzzle-clear-btn')?.addEventListener('click', () => codeDrafts.delete(puzzleId), { capture: true });
    const sync = () => {
      const draft = cells.length ? cells.map((cell) => cell.value.slice(-1)) : [answer.value];
      answer.value = draft.join('').trim();
      codeDrafts.set(puzzleId, draft);
    };
    if (!cells.length) {
      answer.addEventListener('input', sync);
      answer.addEventListener('keydown', (event) => { if (event.key === 'Enter') app.querySelector<HTMLButtonElement>('#puzzle-submit-btn')?.click(); });
      return;
    }
    const roll = (index: number, step: number) => {
      const cell = cells[index];
      const digit = /^\d$/.test(cell.value) ? Number(cell.value) : step > 0 ? -1 : 0;
      cell.value = String((digit + step + 10) % 10);
      sync();
    };
    cells.forEach((cell, index) => {
      cell.addEventListener('input', () => {
        cell.value = cell.value.slice(-1).toUpperCase();
        sync();
        if (cell.value) cells[index + 1]?.focus();
      });
      cell.addEventListener('focus', () => cell.select());
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { roll(index, event.key === 'ArrowUp' ? 1 : -1); event.preventDefault(); }
        else if (event.key === 'ArrowLeft') { cells[index - 1]?.focus(); event.preventDefault(); }
        else if (event.key === 'ArrowRight') { cells[index + 1]?.focus(); event.preventDefault(); }
        else if (event.key === 'Backspace' && !cell.value) { cells[index - 1]?.focus(); }
        else if (event.key === 'Enter') { app.querySelector<HTMLButtonElement>('#puzzle-submit-btn')?.click(); event.preventDefault(); }
      });
    });
    app.querySelectorAll<HTMLButtonElement>('[data-code-roll]').forEach((button) => button.addEventListener('click', () => {
      const [index, step] = (button.dataset.codeRoll ?? '0:1').split(':').map(Number);
      roll(index, step);
      cells[index]?.focus();
    }));
  }

  // Room transition: push into the doorway → iris closes → act title card with a red string from the old
  // room to the new one → iris opens on the new room. Reduced motion: fade to black, card, fade out.
  type TravelStart = { fromTitle: string; fromSceneId: string; snapshot: string; door: { x: number; y: number } };

  function captureTravelStart(previous: GameState, fresh: GameState): TravelStart {
    const root = app.querySelector<HTMLElement>('.point-game-phaser');
    const canvas = app.querySelector<HTMLCanvasElement>(`#${hostId} canvas`);
    const width = root?.clientWidth || window.innerWidth;
    const height = root?.clientHeight || window.innerHeight;
    let snapshot = '';
    if (!reducedMotion.matches) {
      try { snapshot = canvas?.toDataURL('image/jpeg', 0.82) ?? ''; } catch { snapshot = ''; }
    }
    const door = phaserScene?.transitionPoint(fresh.currentSceneId)
      ?? { x: width / 2, y: height - (width <= 900 ? 214 : 112) };
    return { fromTitle: previous.visibleScene.title, fromSceneId: previous.currentSceneId, snapshot, door };
  }

  function playRoomTravel(start: TravelStart) {
    const root = app.querySelector<HTMLElement>('.point-game-phaser');
    if (!root || !state) return;
    travelTimers.splice(0).forEach((timer) => clearTimeout(timer));
    if (travelTyping) clearInterval(travelTyping);
    travelTyping = null;
    root.querySelector('.bpa-g-tr')?.remove();
    const reduce = reducedMotion.matches;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const iris = (point: { x: number; y: number }) => Math.round(2 * Math.hypot(Math.max(point.x, width - point.x), Math.max(point.y, height - point.y)) + 280);
    const sceneIndex = state.sceneMap.findIndex((entry) => entry.sceneId === state!.currentSceneId);
    const act = `${tr('Act', 'Hồi')} ${romanNumeral(sceneIndex >= 0 ? sceneIndex + 1 : 1)}`;
    const title = state.visibleScene.title;
    const door = start.door;
    // The old room's picture zooms into its doorway under the HUD; the iris and the card cover everything.
    root.querySelector('.bpa-g-tr-shot')?.remove();
    let shot: HTMLImageElement | null = null;
    if (start.snapshot) {
      shot = document.createElement('img');
      shot.className = 'bpa-g-tr-shot';
      shot.alt = '';
      shot.setAttribute('aria-hidden', 'true');
      shot.src = start.snapshot;
      shot.style.transformOrigin = `${Math.round(door.x)}px ${Math.round(door.y)}px`;
      root.querySelector('#game-hud-slot')?.before(shot);
    }
    const layer = document.createElement('div');
    layer.className = 'bpa-g-tr is-push';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = `<span class="bpa-g-tr-iris" style="left: ${Math.round(door.x)}px; top: ${Math.round(door.y)}px; width: ${iris(door)}px; height: ${iris(door)}px"></span>
      <div class="bpa-g-tc">
        <div class="bpa-g-tc-card"><span class="bpa-pin bpa-pin--red"></span><span class="bpa-g-tc-kick">${escapeHtml(`${act} — ${state.caseTitle}`)}</span><span class="bpa-g-tc-ttl"><span class="bpa-g-tc-typed"></span><span class="bpa-g-tc-caret"></span></span></div>
        <div class="bpa-g-tc-route">
          <svg viewBox="0 0 300 64"><path class="is-sh" d="M32 17Q150 66 268 17" pathLength="1"/><path class="is-st" d="M30 14Q150 63 270 14" pathLength="1"/></svg>
          <span class="bpa-g-tc-tag is-a"><span class="bpa-pin bpa-pin--red"></span>${escapeHtml(start.fromTitle)}</span>
          <span class="bpa-g-tc-tag is-b"><span class="bpa-pin bpa-pin--red"></span>${escapeHtml(title)}</span>
        </div>
      </div>`;
    root.append(layer);
    announce(tr(`Moving to ${title}.`, `Đang di chuyển tới ${title}.`));
    // Presentation only: the scene keeps taking input underneath (clicks pass through the overlay).
    const total = reduce ? 2000 : 2460;
    const typed = layer.querySelector<HTMLElement>('.bpa-g-tc-typed')!;
    travelTimers.push(setTimeout(() => {
      layer.className = 'bpa-g-tr is-card';
      shot?.remove();
      if (reduce) { typed.textContent = title; return; }
      let shown = 0;
      travelTimers.push(setTimeout(() => {
        travelTyping = setInterval(() => {
          shown += 1;
          typed.textContent = title.slice(0, shown);
          if (shown >= title.length && travelTyping) { clearInterval(travelTyping); travelTyping = null; }
        }, 30);
      }, 160));
    }, reduce ? 320 : 850));
    travelTimers.push(setTimeout(() => {
      typed.textContent = title;
      if (travelTyping) clearInterval(travelTyping);
      travelTyping = null;
      const arrival = phaserScene?.transitionPoint(start.fromSceneId) ?? { x: width / 2, y: height / 2 };
      const opening = layer.querySelector<HTMLElement>('.bpa-g-tr-iris');
      if (opening) Object.assign(opening.style, { left: `${Math.round(arrival.x)}px`, top: `${Math.round(arrival.y)}px`, width: `${iris(arrival)}px`, height: `${iris(arrival)}px` });
      layer.className = 'bpa-g-tr is-open';
    }, reduce ? 1700 : 1800));
    travelTimers.push(setTimeout(() => {
      layer.remove();
      announce(tr(`Arrived at ${title}. ${act}.`, `Đã tới ${title}. ${act}.`));
    }, total));
  }

  function investigationToolDock(model: ReturnType<typeof buildGameUiModel>) {
    const locked = (tool: 'camera' | 'bag', icon: string, label: string, tip: string) => `<button type="button" class="bpa-g-tool is-locked" data-bpa-tool="${tool}" data-bpa-locked-tool="${tool}"
        aria-label="${label}" aria-disabled="true" aria-describedby="bpa-g-tip-${tool}">${gameIcon(icon)}<span class="bpa-g-lbl">${label}</span>
        <span class="bpa-g-lock" aria-hidden="true">${gameIcon('lock')}</span><span class="bpa-g-tip" id="bpa-g-tip-${tool}" role="tooltip">${tip}</span></button>`;
    const camera = model.canUseCamera
      ? `<button type="button" class="bpa-g-tool" id="floating-camera-btn" data-bpa-tool="camera" aria-label="${tr('Camera', 'Máy ảnh')}" aria-pressed="${model.mode.kind === 'CAMERA'}" aria-keyshortcuts="Z">${gameIcon('camera')}<span class="bpa-g-lbl">${tr('Camera', 'Máy ảnh')}</span><span class="bpa-g-key" aria-hidden="true">Z</span></button>`
      : locked('camera', 'camera', tr('Camera', 'Máy ảnh'), tr('Only the Investigator can capture scene clues.', 'Chỉ Điều tra viên có thể chụp manh mối hiện trường.'));
    const hasNew = newInventoryIds.size > 0 && model.mode.kind !== 'INVENTORY';
    const thud = performance.now() - bagThudAt < 360;
    const bag = model.canUseInventory
      ? `<button type="button" class="bpa-g-tool ${hasNew ? 'has-new' : ''} ${thud ? 'is-thud' : ''}" id="floating-bag-btn" data-bpa-tool="bag" aria-label="${hasNew ? tr('Inventory, new item', 'Túi đồ, có vật phẩm mới') : tr('Inventory', 'Túi đồ')}" aria-pressed="${model.mode.kind === 'INVENTORY'}" aria-keyshortcuts="B" style="${thud ? `--bpa-t: -${Math.round(performance.now() - bagThudAt)}ms` : ''}">${gameIcon('bag')}<span class="bpa-g-lbl">${tr('Inventory', 'Túi đồ')}</span><span class="bpa-g-key" aria-hidden="true">B</span></button>`
      : locked('bag', 'bag', tr('Inventory', 'Túi đồ'), tr('Only the Investigator can use inventory items.', 'Chỉ Điều tra viên có thể dùng đồ trong túi.'));
    const caseCount = model.role === 'INTERROGATOR' && model.newQuestionCount > 0 ? model.newQuestionCount : state!.unlockedClues.length;
    const caseOpen = model.mode.kind === 'CASE_FILE' && model.mode.section !== 'map';
    const mapOpen = model.mode.kind === 'CASE_FILE' && model.mode.section === 'map';
    return `${camera}${bag}
      <button type="button" class="bpa-g-tool" id="case-file-btn" data-bpa-tool="case-file" aria-label="${tr('Case File', 'Hồ sơ vụ án')}" aria-pressed="${caseOpen}">${gameIcon('file')}<span class="bpa-g-lbl">${tr('Case File', 'Hồ sơ vụ án')}</span>${caseCount ? `<span class="bpa-g-count tool-badge" aria-hidden="true">${caseCount}</span>` : ''}</button>
      <button type="button" class="bpa-g-tool" id="map-btn" data-bpa-tool="map" aria-label="${tr('Locations', 'Địa điểm')}" aria-pressed="${mapOpen}">${gameIcon('map')}<span class="bpa-g-lbl">${tr('Locations', 'Địa điểm')}</span></button>
      <span class="bpa-g-sep" aria-hidden="true"></span>
      <button type="button" class="bpa-g-tool" id="hint-btn" data-bpa-tool="hint" aria-label="${tr('Hint', 'Gợi ý')}">${gameIcon('hint')}<span class="bpa-g-lbl">${tr('Hint', 'Gợi ý')}</span></button>`;
  }

  function mobileMovementDock(model: ReturnType<typeof buildGameUiModel>) {
    const cameraHtml = model.canUseCamera
      ? `<button class="mobile-action-btn ${model.mode.kind === 'CAMERA' ? 'is-hot' : ''}" id="mobile-camera-btn" aria-label="Camera" aria-pressed="${model.mode.kind === 'CAMERA'}">
          <i data-lucide="camera" aria-hidden="true"></i>
        </button>`
      : '';

    return `
      <div class="mobile-movement-dock" aria-label="Movement controls">
        <button class="mobile-move-btn" data-mobile-move="-1" aria-label="Move left"><span aria-hidden="true">&lsaquo;</span></button>
        <button class="mobile-interact-btn" id="mobile-interact-btn" aria-label="Interact">E</button>
        <button class="mobile-move-btn" data-mobile-move="1" aria-label="Move right"><span aria-hidden="true">&rsaquo;</span></button>
        ${cameraHtml}
        ${model.canUseInventory ? `<button class="mobile-action-btn ${model.mode.kind === 'INVENTORY' ? 'is-hot' : ''}" id="mobile-inventory-btn" aria-label="Inventory" aria-pressed="${model.mode.kind === 'INVENTORY'}">
          <i data-lucide="briefcase" aria-hidden="true"></i>
          ${state!.collectedItemIds.length > 0 ? `<span class="mobile-action-badge">${state!.collectedItemIds.length}</span>` : ''}
        </button>` : ''}
      </div>
    `;
  }

  function HintChip() {
    if (!state?.currentObjective) return '';
    return `<div class="hint-chip" title="${escapeHtml(state.currentObjective)}">${escapeHtml(state.currentObjective)}</div>`;
  }

  // Túi đồ: a leather satchel with twelve slots. `ghost` renders the inert copy that plays the closing
  // flap after the bag's state has already closed (no ids or data hooks, so nothing can act on it).
  function inventoryDrawer(ghost: typeof bagGhost = null) {
    if (!ghost && uiMode.kind !== 'INVENTORY') return '';
    const live = !ghost;

    const itemsById = new Map(state!.visibleScene.items.map((i) => [i.itemId, i]));
    for (const item of state!.collectedItems ?? []) itemsById.set(item.itemId, item);
    const collected = state!.collectedItemIds.map((id) => itemsById.get(id) ?? { itemId: id, name: prettyId(id), imageUrl: '' });
    const detailId = live ? uiMode.kind === 'INVENTORY' ? uiMode.itemId : undefined : ghost.itemId;
    const now = performance.now();
    const opening = live && now - bagOpenedAt < 900 && !reducedMotion.matches;
    const offset = ghost ? now - ghost.startedAt : opening ? now - bagOpenedAt : 0;

    const totalSlots = Math.max(12, Math.ceil(collected.length / 6) * 6);
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const item = collected[i];
      if (item) {
        const isNew = newInventoryIds.has(item.itemId);
        const name = escapeHtml(item.name);
        const classes = [
          live ? 'inventory-drawer-slot' : '', 'bpa-g-slot is-filled',
          live && uiMode.kind === 'INVENTORY' && uiMode.itemId === item.itemId && !combineMode ? 'is-selected is-out' : '',
          live && combineSelection.has(item.itemId) ? 'is-combine-selected' : '',
          ghost?.liftItemId === item.itemId ? 'is-lift' : '',
        ].filter(Boolean).join(' ');
        slots.push(`<li><button type="button" class="${classes}" style="--bpa-g-i: ${i}"
            ${live ? `data-inventory="${escapeHtml(item.itemId)}"` : 'tabindex="-1"'}
            ${live && i === 0 ? 'data-modal-autofocus' : ''}
            ${combineMode && live ? `aria-pressed="${combineSelection.has(item.itemId)}"` : ''}
            aria-label="${combineMode ? tr('Select to combine', 'Chọn để kết hợp') : tr('View details', 'Xem chi tiết')}: ${name}${isNew ? ` (${tr('new', 'mới')})` : ''}">
            ${isNew ? `<span class="bpa-g-slot-new" aria-hidden="true">${tr('NEW', 'MỚI')}</span>` : ''}
            <span class="bpa-g-slot-ck" aria-hidden="true">${gameIcon('check')}</span>
            <span class="inventory-icon bpa-g-slot-pic" style="${item.imageUrl ? '' : placeholderStyle(item.itemId)}" aria-hidden="true">
              ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">` : ''}<span>${escapeHtml(initials(item.name))}</span>
            </span>
            <span class="bpa-g-slot-name">${name}</span>
          </button></li>`);
      } else {
        slots.push(`<li aria-hidden="true"><span class="${live ? 'inventory-drawer-slot ' : ''}bpa-g-slot is-empty"></span></li>`);
      }
    }

    const note = combineMode && live
      ? tr('Choose the items to combine, then press Use.', 'Chọn các vật phẩm muốn ghép, rồi bấm Dùng.')
      : collected.length
        ? tr('Choose an item to see its details.', 'Chọn một vật phẩm để xem chi tiết.')
        : tr('The bag is empty. Examine objects in the scene to collect them.', 'Túi đồ đang trống. Khám nghiệm vật thể trong hiện trường để thu thập.');
    const classes = [
      live ? 'inventory-drawer' : 'bpa-g-bag-ghost', 'bpa-g-bag',
      live && combineMode ? 'is-combining' : '', opening ? 'is-opening' : '',
      ghost ? 'is-closing' : '', ghost?.liftItemId ? 'is-lift' : '',
    ].filter(Boolean).join(' ');
    return `
      <section class="${classes}" ${live ? `aria-label="${tr('Inventory', 'Túi đồ')}" data-modal-key="inventory"` : 'aria-hidden="true" inert'} style="${offset ? `--bpa-t: -${Math.round(offset)}ms` : ''}">
        ${live && detailId && !combineMode ? inventoryDetailOverlay(detailId) : ''}
        <span class="bpa-g-bag-face" aria-hidden="true"></span>
        <span class="bpa-g-grab" aria-hidden="true"></span>
        <span class="bpa-g-rivet is-a" aria-hidden="true"></span><span class="bpa-g-rivet is-b" aria-hidden="true"></span><span class="bpa-g-rivet is-c" aria-hidden="true"></span><span class="bpa-g-rivet is-d" aria-hidden="true"></span>
        <div class="inventory-drawer-header bpa-g-bag-hd">
          <div class="bpa-g-bag-ttl">${gameIcon('bag')}<h2>${tr('Inventory', 'Túi đồ')}</h2><span class="bpa-g-mute">${collected.length}/${totalSlots}</span></div>
          <div class="bpa-g-bag-act">
            <button type="button" class="bpa-g-bbtn" ${live ? 'id="combine-mode-btn"' : 'tabindex="-1"'} aria-pressed="${combineMode && live}">${gameIcon('merge')}${combineMode && live ? tr('Combining', 'Đang kết hợp') : tr('Combine', 'Kết hợp')}</button>
            ${combineMode && live ? `<button type="button" class="bpa-g-bbtn is-go" id="combine-submit-btn" ${combineSelection.size >= 2 ? '' : 'disabled'}>${tr('Use', 'Dùng')} ${combineSelection.size}</button>` : ''}
            <button type="button" class="${live ? 'close-drawer-btn ' : ''}bpa-g-x" ${live ? '' : 'tabindex="-1"'} aria-label="${tr('Close inventory', 'Đóng túi đồ')}" aria-keyshortcuts="Escape">${gameIcon('x')}</button>
          </div>
        </div>
        <p class="bpa-g-bag-note">${note}</p>
        <ul class="${live ? 'inventory-drawer-grid ' : ''}bpa-g-grid" aria-label="${tr('Items in the bag', 'Vật phẩm trong túi')}">${slots.join('')}</ul>
        <span class="bpa-g-flap" aria-hidden="true"><i></i></span>
      </section>`;
  }

  function introOverlay(role: string | null) {
    if (sessionStorage.getItem(introKey)) return '';
    const vi = uiLanguage() === 'vi';
    const roleGuide = role === 'INVESTIGATOR'
      ? (vi
        ? 'Bạn là Điều tra viên: khám nghiệm hiện trường, kiểm tra vật thể và chụp chứng cứ.'
        : 'You are the Investigator: inspect the scene, examine objects, and photograph evidence.')
      : (vi
        ? 'Bạn là Thẩm vấn viên: hỏi nhân chứng, đưa chứng cứ và tìm mâu thuẫn.'
        : 'You are the Interrogator: question witnesses, present evidence, and expose contradictions.');
    // Presentation only: the movement keys are wrapped in key caps so the step
    // reads like a briefing sheet. Concatenated textContent is unchanged.
    const cap = (key: string) => `<kbd class="key-cap">${key}</kbd>`;
    const steps = vi
      ? [
        `Dùng ${cap('W')}${cap('A')}${cap('S')}${cap('D')} hoặc phím mũi tên để di chuyển`,
        'Nhấp sàn để đi; nhấp vật thể hoặc nhân chứng để đến gần và tương tác',
        'Ghép và dùng đồ trong Túi đồ (B); đối chiếu với đồng đội qua Hồ sơ vụ án',
        'Hoàn thành suy luận trước khi đưa ra cáo buộc cuối',
      ]
      : [
        `Use ${cap('W')}${cap('A')}${cap('S')}${cap('D')} or arrow keys to move`,
        'Click the floor to walk; click objects or witnesses to approach and interact',
        'Combine and use items in your Bag (B); compare notes with your partner in the Case File',
        'Complete deductions before the final accusation',
      ];
    return `
    <div class="overlay bpa-g-overlay" id="intro-overlay">
      <div class="modal intro-dossier bpa-g-brief">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <p class="bpa-g-brief-kick">${tr('Case file', 'Hồ sơ vụ án')} · ${escapeHtml(roleName(role, tr))}</p>
        <h2 class="intro-title">${escapeHtml(state!.caseTitle)}</h2>
        <p class="intro-premise">${escapeHtml(state!.caseSummary)}</p>
        <p class="intro-role" data-role="${escapeHtml(role ?? '')}">${roleGuide}</p>
        <ol class="tutorial-steps">
          ${steps.map((step) => `<li><span class="tutorial-step-copy">${step}</span></li>`).join('')}
        </ol>
        <button class="bpa-btn bpa-btn--red bpa-btn--block" id="intro-dismiss">${vi ? 'Bắt đầu điều tra' : 'Enter the scene'}</button>
      </div>
    </div>`;
  }

  function overlayHtml() {
    if (uiMode.kind === 'DIALOGUE') return '';
    if (uiMode.kind === 'PUZZLE' && uiMode.view === 'LOCKED') return puzzleOverlay(uiMode.label, uiMode.message);
    if (uiMode.kind === 'PUZZLE' && uiMode.view === 'SOLVE') return puzzleSolveOverlay(uiMode.puzzleId);
    return '';
  }

  function caseFileDrawer() {
    if (uiMode.kind !== 'CASE_FILE') return '';
    return caseFileOverlay(uiMode.section);
  }

  function evidencePhotoMarkup(clue: Clue, className: string) {
    return clue.photoUrl
      ? `<img class="${className}" data-auth-image="${escapeHtml(clue.photoUrl)}" alt="${escapeHtml(tr(`Captured view of ${clue.title}`, `Ảnh chụp: ${clue.title}`))}">`
      : '';
  }

  function hydrateEvidenceImages() {
    if (stopped) return;
    app.querySelectorAll<HTMLImageElement>('img[data-auth-image]').forEach((image) => {
      const path = image.dataset.authImage;
      if (!path || image.getAttribute('src')) return;
      const cached = evidencePhotoObjectUrls.get(path);
      if (cached) {
        image.src = cached;
        return;
      }
      if (evidencePhotoRequests.has(path)) return;
      const request = new AbortController();
      evidencePhotoRequests.set(path, request);
      gameApi.evidencePhoto(path, request.signal).then((blob: Blob) => {
        if (stopped || request.signal.aborted) return;
        const objectUrl = URL.createObjectURL(blob);
        evidencePhotoObjectUrls.set(path, objectUrl);
        app.querySelectorAll<HTMLImageElement>('img[data-auth-image]')
          .forEach((target) => {
            if (target.dataset.authImage === path) target.src = objectUrl;
          });
      }).catch(() => {
        if (stopped || request.signal.aborted) return;
        app.querySelectorAll<HTMLImageElement>('img[data-auth-image]')
          .forEach((target) => { if (target.dataset.authImage === path) target.remove(); });
      }).finally(() => evidencePhotoRequests.delete(path));
    });
  }

  // The case file is one manila folder: index tabs on the left, one page per section.
  function caseFileOverlay(section: CaseFileSection) {
    const current = state!;
    const v3 = current.mechanicsVersion === 3;
    const model = v3 ? buildPairedConfrontationViewModel(current, myRole()) : null;
    const previous = app.querySelector<HTMLElement>('.case-file-drawer');
    const changedSection = Boolean(previous) && previous!.dataset.caseSection !== section;
    const keptScroll = previous && !changedSection ? previous.querySelector<HTMLElement>('.bpa-cf-page')?.scrollTop ?? 0 : 0;
    if (keptScroll) {
      // Every state update redraws the folder; keep the reader on the line they were reading.
      queueMicrotask(() => {
        const page = app.querySelector<HTMLElement>('.bpa-cf-page');
        if (page) page.scrollTop = keptScroll;
      });
    }
    const wide = Boolean(model && section === 'contradictions' && model.active);
    // Redraws for unrelated state (a partner moving, a timer) must not replay entrance motion.
    const active = model?.active;
    const renderKey = [section, active ? `${active.attemptId}:${active.revision}:${active.status}:${active.confirmedByMe}:${active.partnerConfirmed}` : '-',
      current.actionLog.length, model?.resolvedTruths.length ?? current.resolvedConfrontations.length].join('|');
    const settled = Boolean(previous) && previous!.dataset.renderKey === renderKey;
    const tabs = caseFileTabs(section, model);
    const tabIndex = Math.max(0, tabs.order.indexOf(section));
    const label = section === 'map' ? tr('Investigation Map', 'Bản đồ điều tra') : tr('Case File', 'Hồ sơ vụ án');
    return `<div class="bpa-cf-veil${previous ? '' : ' is-opening'}" aria-hidden="true"></div>
      <aside class="case-file-drawer case-file-modal bpa-cf${v3 ? ' v3-case-file' : ''}${section === 'map' ? ' map-drawer' : ''}${wide ? ' is-wide' : ''}${previous ? '' : ' is-opening'}${settled ? ' is-settled' : ''}" data-modal-key="case-file" data-case-section="${section}" data-render-key="${escapeHtml(renderKey)}" aria-label="${label}">
        <button class="close-drawer-btn bpa-cf-close" type="button" title="${tr('Close', 'Đóng')} (Esc)" aria-keyshortcuts="Escape">${tr('Close', 'Đóng')}<kbd class="bpa-esc" aria-hidden="true">Esc</kbd></button>
        <p class="bpa-cf-ftab" aria-hidden="true"><b>${escapeHtml(current.caseTitle)}</b>${v3 ? `<i>${tr('CRACK THE LIE', 'PHÁ VỠ LỜI DỐI')}</i>` : ''}</p>
        <div class="bpa-cf-scroll">
        <header class="bpa-cf-head">
          <div class="bpa-cf-label"><span class="bpa-pin" aria-hidden="true"></span><p class="bpa-cf-labkick">${escapeHtml(current.visibleScene.title)}</p><h2>${tr('Case File', 'Hồ sơ vụ án')}</h2></div>
          ${caseFileProgressMarkup(model)}
        </header>
        <div class="bpa-cf-body">
          <div class="bpa-cf-side">
            <div class="case-file-tabs bpa-cf-tabs" role="tablist" aria-label="${tr('Case file sections', 'Các mục hồ sơ')}">${tabs.html}</div>
            ${caseFileTeamMarkup(v3)}
          </div>
          <div class="bpa-cf-pagewrap">
            <svg class="bpa-cf-clip" viewBox="0 0 20 58" aria-hidden="true" focusable="false"><path d="M6 50V10a4 4 0 0 1 8 0v36a6 6 0 0 1-12 0V12" fill="none" stroke="#a7adb3" stroke-width="2.4" stroke-linecap="round"/></svg>
            <section class="bpa-cf-page${changedSection ? ' bpa-wipe-a' : ''}" id="bpa-cf-panel" role="tabpanel" aria-labelledby="bpa-cf-tab-${section}" tabindex="0" style="--bpa-cf-tab-y:${36 + tabIndex * 63}px">
              ${wide ? '' : caseFilePageHead(section, model)}
              ${caseFileSectionMarkup(section, model)}
            </section>
          </div>
        </div>
        </div>
      </aside>`;
  }

  function caseFileContext(): CaseFileRenderContext {
    const current = state!;
    const mine = current.players.find((player) => player.userId === me.userId);
    const partner = current.players.find((player) => player.userId !== me.userId);
    return {
      escape: escapeHtml,
      tr,
      people: {
        myName: mine?.username ?? tr('You', 'Bạn'),
        myInitials: initials(mine?.username ?? '?'),
        partnerName: partner?.username ?? tr('Partner', 'Đồng đội'),
        partnerInitials: initials(partner?.username ?? '?'),
      },
      selectedEvidenceId: uiMode.kind === 'CASE_FILE' ? uiMode.clueId ?? null : null,
      sceneTitle: (sceneId) => current.sceneMap.find((scene) => scene.sceneId === sceneId)?.title ?? '',
      witnessRole: (characterId) => (current.suspects.find((character) => character.characterId === characterId)
        ?? current.visibleScene.characters.find((character) => character.characterId === characterId))?.role ?? '',
      formatTime: caseFileClock,
    };
  }

  function caseFileClock(iso: string | null | undefined) {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function caseFileTabs(section: CaseFileSection, model: PairedConfrontationViewModel | null) {
    const current = state!;
    const role = myRole();
    const cracked = model
      ? model.resolvedTruths.filter((pair) => pair.status === 'RESOLVED_SHARED_TRUTH').length
      : current.resolvedConfrontations.length;
    const solved = current.deductions.filter((deduction) => deduction.isSolved).length;
    const deductionOpen = current.deductions.some((deduction) => deduction.isAvailable && !deduction.isSolved);
    const reachable = current.sceneMap.filter((scene) => scene.isVisited || scene.isUnlocked).length;
    const dot = '<span class="bpa-cf-dot" aria-hidden="true"></span>';
    const tabs: Array<{ key: CaseFileSection; name: string; sub: string; status: string }> = [
      {
        key: 'evidence',
        name: model ? tr('Physical Evidence', 'Chứng cứ vật lý') : tr('Evidence', 'Chứng cứ'),
        sub: model
          ? role === 'INVESTIGATOR'
            ? `${model.privateEvidence.length} ${tr('ITEMS', 'MỤC')} · ${model.disclosedEvidenceIds.size} ${tr('SHARED', 'CHIA SẺ')}`
            : `${model.sharedEvidence.length} ${tr('SHARED', 'ĐÃ CHIA SẺ')}`
          : `${current.unlockedClues.length} ${tr('ITEMS', 'MỤC')}`,
        status: model?.active?.canEdit && role === 'INVESTIGATOR' && !model.active.evidence ? dot : '',
      },
      {
        key: 'testimony',
        name: tr('Testimony', 'Lời khai'),
        sub: model
          ? role === 'INTERROGATOR'
            ? `${model.privateTestimonies.length} ${tr('FRAGMENTS', 'ĐOẠN')} · ${model.disclosedTestimonyIds.size} ${tr('SHARED', 'CHIA SẺ')}`
            : `${model.sharedTestimonies.length} ${tr('SHARED', 'ĐOẠN ĐÃ CHIA SẺ')}`
          : `${current.testimonies.length} ${tr('STATEMENTS', 'LỜI KHAI')}`,
        status: '',
      },
      {
        key: 'contradictions',
        name: model ? tr('Crack the Lie', 'Phá Vỡ Lời Dối') : tr('Contradictions', 'Mâu thuẫn'),
        sub: model?.active ? tr('UNDER REVIEW', 'ĐANG XEM XÉT') : `${cracked} ${tr('CRACKED', 'ĐÃ PHÁ')}`,
        status: model?.active ? dot : cracked > 0 ? `<span class="bpa-cf-tabok">${bpaIcons.check}</span>` : '',
      },
      {
        key: 'deductions',
        name: tr('Deductions', 'Suy luận'),
        sub: current.deductions.length === 0
          ? tr('NONE YET', 'CHƯA CÓ')
          : solved === current.deductions.length
            ? tr('SOLVED', 'ĐÃ GIẢI')
            : deductionOpen
              ? `${solved}/${current.deductions.length} ${tr('SOLVED', 'ĐÃ GIẢI')}`
              : tr('LOCKED', 'ĐANG KHÓA'),
        status: current.deductions.length && solved === current.deductions.length
          ? `<span class="bpa-cf-tabok">${bpaIcons.check}</span>`
          : deductionOpen ? dot : current.deductions.length ? bpaIcons.lock : '',
      },
      {
        key: 'map',
        name: tr('Investigation Map', 'Bản đồ điều tra'),
        sub: `${reachable}/${current.sceneMap.length} ${tr('LOCATIONS', 'ĐỊA ĐIỂM')}`,
        status: '',
      },
      {
        key: 'log',
        name: tr('Co-op Log', 'Nhật ký phối hợp'),
        sub: `${current.actionLog.length} ${tr('ENTRIES', 'HOẠT ĐỘNG')}`,
        status: '',
      },
    ];
    return {
      order: tabs.map((tab) => tab.key),
      html: tabs.map((tab, index) => {
        const selected = tab.key === section;
        return `<button class="bpa-cf-tab${selected ? ' is-active' : ''}" type="button" role="tab" id="bpa-cf-tab-${tab.key}" aria-selected="${selected}" aria-controls="bpa-cf-panel" data-case-tab="${tab.key}">
          <span class="bpa-cf-tabno" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
          <span class="bpa-cf-tabtxt"><span class="bpa-cf-tabname">${tab.name}</span><span class="bpa-cf-tabsub">${tab.sub}</span></span>
          <span class="bpa-cf-tabst">${tab.status}</span>
        </button>`;
      }).join(''),
    };
  }

  function caseFileProgressMarkup(model: PairedConfrontationViewModel | null) {
    const current = state!;
    const progress = buildCaseFileProgress({
      sceneMap: current.sceneMap,
      deductions: current.deductions,
      crackedCount: model
        ? model.resolvedTruths.filter((pair) => pair.status === 'RESOLVED_SHARED_TRUTH').length
        : current.resolvedConfrontations.length,
      crackInProgress: Boolean(model?.active),
      availableForAccusation: current.availableForAccusation,
      accusationProposed: Boolean(current.activeAccusation),
    });
    if (progress.accusationReady && !current.activeAccusation) {
      return `<div class="bpa-cf-finwrap">
        <span class="bpa-cf-tail is-l" aria-hidden="true"></span><span class="bpa-cf-tail is-r" aria-hidden="true"></span>
        <div class="bpa-cf-finface">
          <span class="bpa-cf-shine" aria-hidden="true"></span>
          <span class="bpa-cf-medal" aria-hidden="true">${bpaIcons.scale}</span>
          <div class="bpa-cf-fintext"><p class="bpa-cf-finkick">${tr('FINAL ACCUSATION', 'CÁO BUỘC CUỐI CÙNG')}</p><p class="bpa-cf-fintitle">${tr('The final confrontation is ready', 'Đối chất cuối cùng đã sẵn sàng')}</p><p class="bpa-cf-finsub">${current.mechanicsVersion >= 3
            ? tr('Both detectives must confirm the same revision.', 'Cả hai thám tử phải xác nhận cùng một phiên bản.')
            : tr('A wrong accusation ends the case.', 'Cáo buộc sai sẽ kết thúc vụ án.')}</p></div>
          <button class="bpa-btn bpa-btn--red bpa-cf-finbtn" id="case-file-accuse-btn" type="button">${tr('Build the accusation', 'Lập cáo buộc')}${bpaIcons.arrow}</button>
        </div>
      </div>`;
    }
    const unsolved = progress.totalDeductions - progress.solvedDeductions;
    const missing: string[] = [];
    if (progress.openLeads > 0) missing.push(`<b>${progress.openLeads} ${tr(progress.openLeads === 1 ? 'open lead' : 'open leads', 'manh mối')}</b>`);
    if (unsolved > 0) missing.push(`<b>${unsolved} ${tr(unsolved === 1 ? 'deduction' : 'deductions', 'suy luận')}</b>`);
    const line = current.activeAccusation
      ? tr('An accusation is waiting for both confirmations.', 'Một cáo buộc đang chờ cả hai xác nhận.')
      : missing.length
        ? `${tr('Still missing', 'Còn thiếu')} ${missing.join(` ${tr('and', 'và')} `)}.`
        : model
          ? tr('Crack the lie together to open the accusation.', 'Cùng phá vỡ lời dối để mở cáo buộc.')
          : tr('Keep investigating to open the accusation.', 'Tiếp tục điều tra để mở cáo buộc.');
    const reason = current.activeAccusation
      ? ''
      : unsolved > 0
        ? tr(`Solve ${unsolved} more deduction(s) first.`, `Cần giải thêm ${unsolved} suy luận.`)
        : progress.openLeads > 0
          ? tr(`Follow ${progress.openLeads} more lead(s) first.`, `Cần điều tra thêm ${progress.openLeads} manh mối.`)
          : model
            ? tr('Crack the lie together to unlock it.', 'Cần cùng phá vỡ lời dối để mở.')
            : tr('Unlocks when the case file is complete.', 'Mở khi hồ sơ đủ cơ sở.');
    const step = (state: string, label: string) => `<li class="is-${state}"${state === 'now' ? ' aria-current="step"' : ''}><span class="bpa-cf-node" aria-hidden="true"></span>${label}</li>`;
    return `<div class="bpa-cf-prog">
        <p class="bpa-cf-mini">${tr('CASE PROGRESS', 'TIẾN ĐỘ HỒ SƠ')}</p>
        <p class="bpa-cf-progline">${line}</p>
        <ol class="bpa-cf-path" aria-label="${tr('Case progress', 'Tiến độ hồ sơ')}">
          ${step(progress.steps.evidence, tr('Evidence', 'Chứng cứ'))}
          ${step(progress.steps.crack, `${model ? tr('Crack', 'Phá vỡ') : tr('Contradictions', 'Mâu thuẫn')} ${progress.crackedCount}`)}
          ${step(progress.steps.deduction, `${tr('Deduction', 'Suy luận')}${progress.totalDeductions ? ` ${progress.solvedDeductions}/${progress.totalDeductions}` : ''}`)}
          ${step(progress.steps.accusation, tr('Accusation', 'Cáo buộc'))}
        </ol>
      </div>
      <div class="bpa-cf-acc">
        ${current.activeAccusation
          ? `<button class="bpa-btn bpa-btn--red bpa-cf-accbtn" id="case-file-accuse-btn" type="button">${bpaIcons.scale}${tr('Read the proposal', 'Đọc đề xuất')}</button>`
          : `<button class="bpa-btn bpa-btn--red bpa-cf-accbtn" id="case-file-accuse-btn" type="button" aria-disabled="true" aria-describedby="bpa-cf-accwhy" data-reason="${escapeHtml(reason)}">${bpaIcons.lock}${tr('Build accusation', 'Lập cáo buộc')}</button>
             <p class="bpa-cf-accwhy" id="bpa-cf-accwhy">${reason}</p>`}
      </div>`;
  }

  function caseFileTeamMarkup(v3: boolean) {
    const current = state!;
    return `<section class="bpa-cf-team" aria-label="${tr('Investigation team', 'Đội điều tra')}">
      <p class="bpa-cf-mini">${tr('TEAM', 'ĐỘI ĐIỀU TRA')} · ${escapeHtml(current.roomCode)}</p>
      ${current.players.map((player) => {
        const mine = player.userId === me.userId;
        return `<div class="bpa-cf-member">${bpaMono(initials(player.username), mine ? 'me' : 'partner')}<p><b>${mine ? tr('You', 'Bạn') : escapeHtml(player.username)}</b><i>${roleName(player.role, tr)}${player.isConnected === false ? ` · ${tr('offline', 'mất kết nối')}` : ''}</i></p><span class="bpa-cf-sw is-${mine ? 'me' : 'partner'}" aria-hidden="true"></span></div>`;
      }).join('')}
      ${v3 ? `<div class="bpa-cf-legend">
        <p><b class="bpa-tag is-mine">${bpaIcons.lock}${tr('PRIVATE', 'RIÊNG')}</b>${tr('only the finder', 'chỉ người tìm thấy')}</p>
        <p><b class="bpa-tag is-mine is-shared">${bpaIcons.shared}${tr('SHARED', 'ĐÃ CHIA SẺ')}</b>${tr('the whole team', 'cả đội thấy')}</p>
      </div>` : ''}
    </section>`;
  }

  function caseFilePageHead(section: CaseFileSection, model: PairedConfrontationViewModel | null) {
    const current = state!;
    const role = myRole();
    const partnerName = escapeHtml(current.players.find((player) => player.userId !== me.userId)?.username ?? tr('your partner', 'đồng đội'));
    const number = (index: number) => `${tr('SECTION', 'MỤC')} ${String(index).padStart(2, '0')}`;
    let kicker = '';
    let title = '';
    let note = '';
    if (section === 'evidence') {
      kicker = `${number(1)} · ${model ? role === 'INVESTIGATOR' ? tr('YOUR EXHIBITS', 'VẬT CHỨNG CỦA BẠN') : tr('SHARED WITH YOU', 'ĐỒNG ĐỘI ĐÃ CHIA SẺ') : tr('COLLECTED', 'ĐÃ THU THẬP')}`;
      title = model ? tr('Physical Evidence', 'Chứng cứ vật lý') : tr('Evidence', 'Chứng cứ');
      note = model && role === 'INVESTIGATOR'
        ? tr(`${model.privateEvidence.length} exhibits · ${model.disclosedEvidenceIds.size} shared with ${partnerName}`, `${model.privateEvidence.length} chứng cứ · ${model.disclosedEvidenceIds.size} đã chia sẻ với ${partnerName}`)
        : model
          ? tr(`${model.sharedEvidence.length} exhibits ${partnerName} has shared with you`, `${model.sharedEvidence.length} chứng cứ ${partnerName} đã chia sẻ với bạn`)
          : tr(`${current.unlockedClues.length} leads in the shared file`, `${current.unlockedClues.length} manh mối trong hồ sơ chung`);
    } else if (section === 'testimony') {
      kicker = `${number(2)} · ${model ? role === 'INTERROGATOR' ? tr('YOUR INTERVIEWS', 'TỪ THẨM VẤN VIÊN') : tr('SHARED WITH YOU', 'ĐỒNG ĐỘI ĐÃ CHIA SẺ') : tr('RECORDED', 'ĐÃ GHI NHẬN')}`;
      title = tr('Testimony', 'Lời khai');
      note = model && role !== 'INTERROGATOR'
        ? tr(`${model.sharedTestimonies.length} fragment(s) ${partnerName} has shared with you`, `${model.sharedTestimonies.length} đoạn lời khai ${partnerName} đã chia sẻ với bạn`)
        : model
          ? tr(`${model.privateTestimonies.length} fragment(s) · ${model.disclosedTestimonyIds.size} shared`, `${model.privateTestimonies.length} đoạn · ${model.disclosedTestimonyIds.size} đã chia sẻ`)
          : tr(`${current.testimonies.length} statement(s)`, `${current.testimonies.length} lời khai`);
    } else if (section === 'contradictions') {
      kicker = `${number(3)} · ${tr('JOINT REVIEW', 'CÙNG XEM XÉT')}`;
      title = model ? tr('Crack the Lie', 'Phá Vỡ Lời Dối') : tr('Contradictions', 'Mâu thuẫn');
      const cracked = model ? model.resolvedTruths.filter((pair) => pair.status === 'RESOLVED_SHARED_TRUTH').length : current.resolvedConfrontations.length;
      note = model
        ? tr(`${cracked} cracked · ${model.attemptHistory.length + model.resolvedTruths.length} shared attempt(s)`, `${cracked} lời dối đã phá · ${model.attemptHistory.length + model.resolvedTruths.length} lượt thử đã chia sẻ`)
        : tr(`${cracked} contradiction(s) exposed`, `${cracked} mâu thuẫn đã phát hiện`);
    } else if (section === 'deductions') {
      kicker = `${number(4)} · ${tr('REASONING', 'LẬP LUẬN')}`;
      title = tr('Deductions', 'Suy luận');
      const solved = current.deductions.filter((deduction) => deduction.isSolved).length;
      note = current.deductions.length
        ? tr(`${solved} of ${current.deductions.length} solved`, `Đã giải ${solved}/${current.deductions.length}`)
        : '';
    } else if (section === 'map') {
      kicker = `${number(5)} · ${escapeHtml(current.visibleScene.title)}`;
      title = tr('Investigation Map', 'Bản đồ điều tra');
      note = tr('Move through places the investigation has already opened.', 'Di chuyển giữa các địa điểm đã được mở trong quá trình điều tra.');
    } else {
      kicker = `${number(6)} · ${tr('TEAM ACTIVITY', 'HOẠT ĐỘNG CỦA ĐỘI')}`;
      title = tr('Co-op Log', 'Nhật ký phối hợp');
      note = `${bpaIcons.clock}${tr('Your local time · newest first', 'Giờ trên máy bạn · mới nhất ở trên')}`;
    }
    return `<div class="bpa-cf-ph"><div><p class="bpa-cf-kick">${kicker}</p><h3 class="bpa-cf-h2">${title}</h3></div>${note ? `<p class="bpa-cf-phnote">${note}</p>` : ''}</div>`;
  }

  function caseFileSectionMarkup(section: CaseFileSection, model: PairedConfrontationViewModel | null) {
    if (section === 'map') return mapOverlay();
    if (section === 'log') return logOverlay();
    if (section === 'deductions') return caseFileDeductions(Boolean(model));
    if (model) {
      const context = caseFileContext();
      if (section === 'evidence') {
        const supportingClues = state!.unlockedClues.filter((clue) => !clue.isEvidence);
        return `${renderPrivateEvidencePanel(model, escapeHtml, tr, context)}${supportingClues.length ? `<section class="notebook-list bpa-cf-leads"><h3 class="bpa-cf-h3">${tr('Supporting leads', 'Manh mối hỗ trợ')}</h3><ul>${supportingClues.map((clue) => `<li><b>${escapeHtml(clue.title)}</b><p>${escapeHtml(clue.content)}</p></li>`).join('')}</ul></section>` : ''}`;
      }
      if (section === 'testimony') return renderPrivateTestimonyPanel(model, escapeHtml, tr, context);
      return renderJointReviewPanel(model, escapeHtml, tr, context);
    }
    if (section === 'testimony') return caseFileLegacyTestimony();
    if (section === 'contradictions') return caseFileLegacyContradictions();
    return caseFileLegacyEvidence();
  }

  function caseFileLegacyEvidence() {
    const clues = state!.unlockedClues.slice().reverse();
    if (clues.length === 0) return `<p class="bpa-cf-empty empty-state small">${tr('No evidence has been collected yet.', 'Chưa thu thập được chứng cứ nào.')}</p>`;
    const selectedClueId = uiMode.kind === 'CASE_FILE' ? uiMode.clueId : undefined;
    const selectedClue = selectedClueId ? clues.find((clue) => clue.clueId === selectedClueId) : undefined;
    const keyMark = `<b class="bpa-mark is-key">${tr('EVIDENCE', 'CHỨNG CỨ')}</b>`;
    const cards = clues.map((clue) => `
      <button class="clue-card case-file-clue-card bpa-cf-polcard${clue.isEvidence ? ' clue-evidence' : ''}${selectedClue?.clueId === clue.clueId ? ' is-selected' : ''}" data-evidence-detail="${escapeHtml(clue.clueId)}" type="button" aria-pressed="${selectedClue?.clueId === clue.clueId}" aria-label="${tr('Open evidence', 'Mở chứng cứ')}: ${escapeHtml(clue.title)}">
        <span class="clue-card-art">${evidencePhotoMarkup(clue, 'clue-photo') || `<span class="evidence-visual-placeholder" aria-hidden="true">${initials(clue.title)}</span>`}</span>
        <span class="clue-head"><strong>${escapeHtml(clue.title)}</strong>${clue.isEvidence ? keyMark : ''}</span>
        <span class="clue-card-summary">${escapeHtml(clue.content)}</span>
      </button>`).join('');
    const detail = selectedClue
      ? `<section class="case-file-evidence-detail bpa-cf-detwrap" aria-label="${escapeHtml(selectedClue.title)}">
          <article class="bpa-cf-det">
            <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
            <button class="evidence-detail-back bpa-cf-back" id="evidence-detail-back" type="button">${bpaIcons.back}${tr('Back to evidence', 'Trở lại danh sách chứng cứ')}</button>
            <div class="evidence-detail-art bpa-cf-plate is-square">
              ${evidencePhotoMarkup(selectedClue, 'evidence-photo-large') || `<span class="bpa-cf-platemono" aria-hidden="true">${initials(selectedClue.title)}</span>`}
            </div>
            <div class="clue-head"><h3 class="bpa-cf-dettitle">${escapeHtml(selectedClue.title)}</h3>${selectedClue.isEvidence ? keyMark : ''}</div>
            <p class="bpa-cf-detdesc">${escapeHtml(selectedClue.content)}</p>
            ${selectedClue.inventoryDescription && selectedClue.inventoryDescription !== selectedClue.content ? `<p class="bpa-cf-insp"><b>${tr('INSPECTION NOTE', 'GHI CHÚ KHÁM NGHIỆM')}</b>${escapeHtml(selectedClue.inventoryDescription)}</p>` : ''}
            ${selectedClue.narrativeMeaning ? `<p class="bpa-cf-insp is-teal"><b>${tr('WHY IT MATTERS', 'Ý NGHĨA')}</b>${escapeHtml(selectedClue.narrativeMeaning)}</p>` : ''}
          </article>
        </section>`
      : `<section class="bpa-cf-detwrap is-placeholder"><p class="bpa-cf-detempty">${bpaIcons.search}${tr('Pick an exhibit to read its full notes.', 'Chọn một chứng cứ để xem chi tiết.')}</p></section>`;
    return `<div class="bpa-cf-evgrid is-legacy"><div class="case-file-grid bpa-cf-polgrid">${cards}</div>${detail}</div>`;
  }

  function caseFileLegacyTestimony() {
    const entries = state!.testimonies;
    if (entries.length === 0) return `<p class="bpa-cf-empty empty-state small">${tr('No testimony has been recorded yet.', 'Chưa ghi nhận lời khai nào.')}</p>`;
    const groups = new Map<string, Testimony[]>();
    entries.forEach((entry) => groups.set(entry.characterName, [...(groups.get(entry.characterName) ?? []), entry]));
    return `<div class="notebook-list bpa-cf-wgrid">${[...groups.entries()].map(([name, items]) => `
      <section class="bpa-cf-wit">
        <div class="bpa-cf-who">${bpaMono(initials(name), 'witness', 'lg')}<div><h3 class="bpa-cf-whoname">${escapeHtml(name)}</h3></div></div>
        ${items.map((entry, index) => `<article class="bpa-cf-slip${index % 2 ? ' is-tilt' : ''}">
          <p class="bpa-cf-ask">${bpaIcons.chat}${escapeHtml(entry.question)}</p>
          <blockquote class="bpa-cf-quote"><span class="bpa-cf-qt">${escapeHtml(entry.answer)}</span></blockquote>
        </article>`).join('')}
      </section>`).join('')}</div>`;
  }

  function caseFileLegacyContradictions() {
    const records = state!.resolvedConfrontations;
    if (records.length === 0) return `<p class="bpa-cf-empty empty-state small">${tr('No contradictions have been exposed yet.', 'Chưa phát hiện mâu thuẫn nào.')}</p>`;
    return `<section class="notebook-list bpa-cf-facts">
      <h3 class="bpa-cf-h3">${tr('Exposed contradictions', 'Mâu thuẫn đã phát hiện')}</h3>
      <ul class="bpa-cf-factlist">${records.map((record) => `<li class="bpa-cf-fact">
        <span class="bpa-cf-factseal" aria-hidden="true">${bpaIcons.check}</span>
        <div><p class="bpa-cf-factname">${escapeHtml(record.prompt)}</p><p class="bpa-cf-factdesc">${escapeHtml(record.resolution)}</p></div>
        <span class="bpa-cf-facttag">${escapeHtml(record.evidenceTitle)}${caseFileClock(record.resolvedAt) ? ` · ${caseFileClock(record.resolvedAt)}` : ''}</span>
      </li>`).join('')}</ul>
    </section>`;
  }

  function caseFileDeductions(v3: boolean) {
    const deductions = state!.deductions;
    if (deductions.length === 0) return `<p class="bpa-cf-empty">${tr('No deductions are open in this case yet.', 'Vụ án chưa mở suy luận nào.')}</p>`;
    const letter = (index: number) => String.fromCharCode(65 + index);
    return `<div class="bpa-cf-deds">${deductions.map((deduction) => {
      const stateClass = deduction.isSolved ? 'is-solved' : deduction.isAvailable ? 'is-available' : 'is-locked';
      const stamp = deduction.isSolved
        ? `<b class="bpa-cf-pstamp is-ok">${tr('SOLVED', 'ĐÃ GIẢI')}</b>`
        : deduction.isAvailable
          ? `<b class="bpa-cf-pstamp is-ready">${tr('READY', 'SẴN SÀNG')}</b>`
          : `<b class="bpa-cf-pstamp is-lock">${tr('LOCKED', 'ĐANG KHÓA')}</b>`;
      const body = deduction.isSolved
        ? `<div class="bpa-cf-opt is-picked"><span class="bpa-cf-optltr" aria-hidden="true">${bpaIcons.check}</span><span>${escapeHtml(deduction.resolution ?? '')}</span></div>`
        : deduction.isAvailable
          ? `<p class="bpa-cf-mini">${deduction.options.length} ${tr('EXPLANATIONS', 'CÁCH GIẢI THÍCH')}</p>
             <ul class="bpa-cf-opts deduction-options">${deduction.options.map((option, index) => `<li><button class="bpa-cf-opt is-open" type="button" data-solve-deduction="${escapeHtml(deduction.deductionId)}" data-option="${escapeHtml(option.id)}"><span class="bpa-cf-optltr" aria-hidden="true">${letter(index)}</span><span>${escapeHtml(option.label)}</span>${bpaIcons.arrow}</button></li>`).join('')}</ul>
             ${v3 ? '' : `<button class="bpa-btn bpa-btn--ink bpa-btn--sm bpa-cf-dedhint" type="button" data-deduction-hint="${escapeHtml(deduction.deductionId)}">${bpaIcons.bulb}${tr('Hint', 'Gợi ý')}</button>`}`
          : `<p class="bpa-cf-lockline">${bpaIcons.lock}${v3
              ? tr('Continue investigating and resolve the required Crack loops.', 'Tiếp tục điều tra và giải quyết các vòng Phá Vỡ Lời Dối cần thiết.')
              : `${tr('Missing', 'Còn thiếu')} ${deduction.missingClueIds.length} ${tr('clue(s) and', 'manh mối và')} ${deduction.missingChallengeIds.length} ${tr('contradiction(s).', 'mâu thuẫn.')}`}</p>`;
      return `<article class="deduction-card bpa-cf-ded ${stateClass}">
        <div class="bpa-cf-dedhead"><p class="bpa-cf-q">${escapeHtml(deduction.prompt)}</p>${stamp}</div>
        ${body}
      </article>`;
    }).join('')}</div>`;
  }

  function mapOverlay() {
    const current = state!;
    const mine = current.players.find((player) => player.userId === me.userId);
    const partner = current.players.find((player) => player.userId !== me.userId);
    const partnerScene = partner ? playerPoses.get(partner.userId)?.sceneId : undefined;
    const currentPhoto = sceneBackgroundUrl(current.visibleScene);
    const places = current.sceneMap.map((scene, index) => {
      const known = scene.isVisited || scene.isUnlocked;
      const reachable = known && !scene.isCurrent;
      const [statusKey, statusLabel] = scene.isCompleted
        ? ['done', tr('Done', 'Hoàn tất')]
        : scene.isCurrent
          ? ['now', tr('Here', 'Hiện tại')]
          : known ? ['open', tr('Open', 'Đã mở')] : ['lock', tr('Locked', 'Đang khóa')];
      const who = [
        scene.isCurrent && mine ? bpaMono(initials(mine.username), 'me', 'sm') : '',
        partner && partnerScene === scene.sceneId ? bpaMono(initials(partner.username), 'partner', 'sm') : '',
      ].join('');
      const photo = !known
        ? '<span class="bpa-cf-unknown" aria-hidden="true">?</span>'
        : scene.isCurrent && currentPhoto
          ? `<img src="${escapeHtml(currentPhoto)}" alt="" onerror="this.remove()">`
          : `<span class="bpa-cf-photomono" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>`;
      return `<li class="bpa-cf-place is-${statusKey}">
        <span class="bpa-cf-placepin" aria-hidden="true"></span>
        <button class="map-entry bpa-cf-placebtn${scene.isCurrent ? ' is-current' : ''}${scene.isCompleted ? ' is-done' : ''}" type="button" data-scene="${escapeHtml(scene.sceneId)}" ${reachable ? '' : 'disabled'}>
          <span class="bpa-cf-photo">${photo}</span>
          <span class="bpa-cf-plabel">
            <span class="bpa-cf-plname">${known ? escapeHtml(scene.title) : tr('Unknown location', 'Địa điểm chưa biết')}</span>
            <span class="bpa-cf-plact">${tr('LOCATION', 'ĐỊA ĐIỂM')} ${index + 1}</span>
            <span class="bpa-cf-plrow"><b class="bpa-cf-pst is-${statusKey}">${statusLabel}</b>${who ? `<span class="bpa-cf-plwho">${who}</span>` : ''}</span>
            ${!scene.isCompleted && known && scene.pendingRequirementCount > 0 ? `<em class="bpa-cf-plline">${scene.pendingRequirementCount} ${tr('left', 'còn lại')}</em>` : ''}
            ${reachable ? `<span class="bpa-cf-go">${tr('Go here', 'Đến đây')}${bpaIcons.arrow}</span>` : ''}
          </span>
        </button>
      </li>`;
    }).join('');
    return `<div class="bpa-cf-mapboard">
        <ol class="map-list bpa-cf-route">${places}</ol>
        <p class="bpa-cf-mapkey"><b class="bpa-cf-mapkeyk">${tr('STATUS', 'TRẠNG THÁI')}</b><b class="bpa-cf-pst is-done">${tr('Done', 'Hoàn tất')}</b><b class="bpa-cf-pst is-now">${tr('Here', 'Hiện tại')}</b><b class="bpa-cf-pst is-open">${tr('Open', 'Đã mở')}</b><b class="bpa-cf-pst is-lock">${tr('Locked', 'Đang khóa')}</b></p>
      </div>
      <button class="bpa-cf-back" id="map-case-file-btn" type="button">${bpaIcons.back}${tr('Back to case file', 'Trở lại hồ sơ')}</button>`;
  }

  function logOverlay() {
    const current = state!;
    const entries = current.actionLog.slice().reverse();
    const count = (types: string[]) => current.actionLog.filter((entry) => types.includes(entry.actionType)).length;
    const actionIcon = (type: string) => {
      if (type === 'CLUE_UNLOCKED' || type === 'CAPTURE_CLUE' || type.startsWith('INSPECT')) return bpaIcons.search;
      if (type === 'ASK_DIALOGUE' || type === 'CONVERSE') return bpaIcons.chat;
      if (type === 'PRESENT_EVIDENCE' || type === 'CONTRADICTION_RESOLVED') return bpaIcons.stamp;
      if (type.includes('SCENE')) return bpaIcons.map;
      if (type.startsWith('PUZZLE') || type === 'USE_ITEM' || type === 'COMBINE_ITEMS') return bpaIcons.key;
      if (type === 'DEDUCTION_SOLVED' || type === 'HINT_USED') return bpaIcons.bulb;
      if (type === 'ACCUSE') return bpaIcons.scale;
      return bpaIcons.flag;
    };
    const keyTypes = new Set(['CONTRADICTION_RESOLVED', 'DEDUCTION_SOLVED', 'ACCUSE', 'COMPLETE_SCENE']);
    const players = new Map(current.players.map((player) => [player.userId, player]));
    const rows = entries.map((entry) => {
      const actor = players.get(entry.userId);
      const tone = !actor ? 'team' : actor.userId === me.userId ? 'me' : 'partner';
      return `<li class="log-entry bpa-cf-logrow${keyTypes.has(entry.actionType) ? ' is-key' : ''}">
        <time class="log-time bpa-cf-logt" datetime="${escapeHtml(entry.createdAt)}">${caseFileClock(entry.createdAt)}</time>
        <span class="bpa-cf-logpin is-${tone}" aria-hidden="true"></span>
        <span class="bpa-cf-logwho">${actor ? bpaMono(initials(actor.username), tone === 'me' ? 'me' : 'partner', 'sm') : ''}<span class="bpa-sr">${actor ? escapeHtml(actor.username) : tr('Team', 'Cả đội')}</span></span>
        <p class="bpa-cf-logtxt">${actionIcon(entry.actionType)}<span>${escapeHtml(entry.message)}</span></p>
      </li>`;
    }).join('');
    const cracked = current.mechanicsVersion === 3
      ? (current.sharedKnowledge?.resolvedTruths ?? []).filter((pair) => pair.status === 'RESOLVED_SHARED_TRUTH').length
      : current.resolvedConfrontations.length;
    const partner = current.players.find((player) => player.userId !== me.userId);
    return `<div class="bpa-cf-loggrid">
      <div class="bpa-cf-logwrap">
        ${entries.length
          ? `<span class="bpa-cf-logline" aria-hidden="true"></span><ol class="log-list bpa-cf-log">${rows}</ol>`
          : `<p class="bpa-cf-empty empty-state small">${tr('Nothing logged yet.', 'Chưa có hoạt động nào được ghi lại.')}</p>`}
      </div>
      <aside class="bpa-cf-logstats" aria-label="${tr('Co-op summary', 'Tóm tắt phối hợp')}">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <p class="bpa-cf-mini">${tr('CO-OP SUMMARY', 'TÓM TẮT PHỐI HỢP')}</p>
        <dl class="bpa-cf-stats">
          <div class="bpa-cf-stat"><dt>${tr('Logged actions', 'Hoạt động đã ghi')}</dt><dd>${current.actionLog.length}</dd></div>
          <div class="bpa-cf-stat"><dt>${tr('Leads unlocked', 'Manh mối đã mở')}</dt><dd>${count(['CLUE_UNLOCKED']) || current.unlockedClues.length}</dd></div>
          <div class="bpa-cf-stat"><dt>${tr('Lies cracked', 'Lời dối đã phá')}</dt><dd>${cracked}</dd></div>
          <div class="bpa-cf-stat"><dt>${tr('Deductions solved', 'Suy luận đã giải')}</dt><dd>${current.deductions.filter((deduction) => deduction.isSolved).length}</dd></div>
        </dl>
        <ul class="bpa-cf-whokey">
          <li><span class="bpa-cf-logpin is-me" aria-hidden="true"></span>${tr('You', 'Bạn')} · ${roleName(myRole(), tr)}</li>
          ${partner ? `<li><span class="bpa-cf-logpin is-partner" aria-hidden="true"></span>${escapeHtml(partner.username)} · ${roleName(partner.role, tr)}</li>` : ''}
          <li><span class="bpa-cf-logpin is-team" aria-hidden="true"></span>${tr('Whole team', 'Cả đội')}</li>
        </ul>
      </aside>
    </div>`;
  }

  function inspectOverlay(itemId: string, detail: string, unlockedClueIds: string[]) {
    const item = state!.visibleScene.items.find((i) => i.itemId === itemId) ?? { itemId, name: prettyId(itemId), imageUrl: '', description: '' };
    const inspectedText = detail ?? item.inspectText ?? item.description;
    return `
    <div class="overlay bpa-g-overlay">
      <div class="modal modal-wide inspect-modal bpa-g-paper-modal">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <div class="inspect-art bpa-g-d-pic" aria-hidden="true">
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">` : ''}<span>${escapeHtml(initials(item.name))}</span>
        </div>
        <div class="inspect-copy">
          <span class="bpa-g-d-k">${tr('Examination', 'Khám nghiệm')}</span>
          <h2>${escapeHtml(item.name)}</h2>
          <p>${escapeHtml(inspectedText)}</p>
          ${unlockedClueIds.length
            ? `<p class="bpa-g-disc-count"><b>+${unlockedClueIds.length}</b>${tr('new case-file lead(s)', 'manh mối mới trong hồ sơ')}</p>`
            : `<p class="bpa-g-d-desc">${tr('No new evidence found.', 'Không có chứng cứ mới.')}</p>`}
          <div class="modal-actions"><button class="bpa-btn bpa-btn--ink bpa-btn--sm" data-close-overlay>${tr('Close', 'Đóng')}</button></div>
        </div>
      </div>
    </div>`;
  }

  function photoOverlay(clueId: string, detail: string) {
    const clue = state!.unlockedClues.find((c) => c.clueId === clueId) ?? state!.evidenceClues.find((c) => c.clueId === clueId);
    return `
    <div class="overlay bpa-g-overlay">
      <div class="modal bpa-g-paper-modal">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <span class="bpa-g-d-k">${tr('Photographic evidence', 'Chứng cứ ảnh')}</span>
        <h2>${escapeHtml(clue?.title ?? tr('Photographic evidence', 'Chứng cứ ảnh'))}</h2>
        ${clue ? `<figure class="bpa-g-photo"><span class="bpa-g-tape" aria-hidden="true"></span>${evidencePhotoMarkup(clue, 'evidence-photo-large')}</figure>` : ''}
        <p>${escapeHtml(detail || clue?.inventoryDescription || clue?.content || tr('A scene clue has been added to the case file.', 'Một manh mối hiện trường đã được thêm vào hồ sơ.'))}</p>
        ${clue?.narrativeMeaning ? `<p class="bpa-g-d-desc">${escapeHtml(clue.narrativeMeaning)}</p>` : ''}
        <p class="bpa-g-disc-count"><b>+1</b>${tr('Photo captured and logged.', 'Đã chụp và ghi vào hồ sơ.')}</p>
        <div class="modal-actions"><button class="bpa-btn bpa-btn--ink bpa-btn--sm" data-close-overlay>${tr('Close', 'Đóng')}</button></div>
      </div>
    </div>`;
  }

  // Detail view for an item already collected into the inventory. Pulls the
  // full metadata (and the clue it produced) from the collected-items list so
  // the player can review what they found at any time, in any scene.
  function inventoryDetailOverlay(itemId: string) {
    const byId = new Map(state!.visibleScene.items.map((i) => [i.itemId, i]));
    for (const i of state!.collectedItems ?? []) byId.set(i.itemId, i);
    const item = byId.get(itemId) ?? { itemId, name: prettyId(itemId), imageUrl: '', description: '', inspectText: '' };
    const finding = item.inspectText || item.description || tr('You collected this item during the investigation.', 'Bạn đã thu thập vật phẩm này trong quá trình điều tra.');
    const clue = state!.unlockedClues.find((c) => c.source === itemId);
    const elapsed = reducedMotion.matches ? 0 : Math.round(performance.now() - detailOpenedAt);
    // A paper card slides up out of the satchel.
    return `
      <section class="inventory-detail-inline bpa-g-dcard" role="group" aria-labelledby="bpa-g-d-name" style="--bpa-t-d: -${elapsed}ms">
        <div class="inventory-detail-art bpa-g-d-pic" aria-hidden="true">
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">` : ''}<span>${escapeHtml(initials(item.name))}</span>
        </div>
        <div class="bpa-g-d-txt">
          <h3 class="bpa-g-d-name" id="bpa-g-d-name">${escapeHtml(item.name)}</h3>
          ${item.description && item.description !== finding ? `<p class="bpa-g-d-desc">${escapeHtml(item.description)}</p>` : ''}
          <span class="bpa-g-d-k">${tr('Examination', 'Khám nghiệm')}</span>
          <p class="bpa-g-d-insp">${escapeHtml(finding)}</p>
          ${clue ? `<p class="bpa-g-d-clue">${gameIcon('file')}${tr('Logged in the case file:', 'Đã ghi vào hồ sơ:')} <b>${escapeHtml(clue.title)}</b></p>` : ''}
          <div class="bpa-g-d-act">
            ${myRole() === 'INVESTIGATOR' ? `<button class="bpa-btn bpa-btn--red bpa-btn--sm" type="button" data-use-inventory="${escapeHtml(item.itemId)}">${tr('Use', 'Dùng')}</button>` : ''}
            <button class="bpa-btn bpa-btn--ink bpa-btn--sm" id="inventory-detail-close" type="button">${tr('Back', 'Quay lại')}</button>
          </div>
        </div>
      </section>`;
  }

  // Locked object: the brass lock panel with what is still missing.
  function puzzleOverlay(label: string, message: string) {
    return `
    <div class="overlay bpa-g-overlay">
      <div class="modal bpa-g-lk">
        <span class="bpa-g-rivet is-a" aria-hidden="true"></span><span class="bpa-g-rivet is-b" aria-hidden="true"></span><span class="bpa-g-rivet is-c" aria-hidden="true"></span><span class="bpa-g-rivet is-d" aria-hidden="true"></span>
        <div class="bpa-g-lk-hd">
          <span class="bpa-g-lk-ic" aria-hidden="true">${gameIcon('lock')}</span>
          <div class="bpa-g-lk-ttl"><span class="bpa-g-kick">${tr('Locked', 'Đang khóa')}</span><h2>${escapeHtml(label || tr('Locked object', 'Vật thể đang khóa'))}</h2></div>
        </div>
        <p class="bpa-g-lk-p">${escapeHtml(message || tr('This needs another clue before it can be opened.', 'Cần thêm manh mối trước khi mở được vật này.'))}</p>
        <p class="bpa-g-lk-note">${tr('Missing clues usually hide in unexamined objects or unasked questions. Compare notes with your partner: the Investigator searches, the Interrogator questions.', 'Manh mối còn thiếu thường nằm ở vật chưa khám nghiệm hoặc câu chưa hỏi. Hãy đối chiếu với đồng đội: Điều tra viên tìm kiếm, Thẩm vấn viên đặt câu hỏi.')}</p>
        <div class="bpa-g-lk-act"><button class="bpa-btn bpa-btn--gold bpa-btn--sm" data-close-overlay>${tr('Close', 'Đóng')}</button></div>
      </div>
    </div>`;
  }

  // Puzzle on a scene object. Codes get one brass cell per character (arrows roll digits); the hidden
  // #puzzle-code-answer carries the joined answer to the existing submit handler.
  function puzzleSolveOverlay(puzzleId: string) {
    const puzzle = state!.visibleScene.puzzles?.find((candidate) => candidate.puzzleId === puzzleId);
    if (!puzzle) return '';
    const draft = puzzleDrafts.get(puzzle.puzzleId) ?? [];
    const missing = [...(puzzle.missingItemIds ?? []), ...(puzzle.missingClueIds ?? [])];
    const target = state!.visibleScene.items.find((item) => item.itemId === puzzle.targetId);
    const title = target?.name || prettyId(puzzle.targetId || puzzle.puzzleId);
    const solved = puzzle.isSolved;
    const locked = puzzle.isLocked;
    const kind = puzzle.type === 'CODE_PUZZLE' ? tr('Puzzle code', 'Mã câu đố')
      : puzzle.type === 'SEQUENCE_PUZZLE' ? tr('Sequence', 'Thứ tự') : tr('Symbols', 'Ký hiệu');
    let body: string;
    if (solved) body = `<p class="bpa-g-solved">${gameIcon('check')} ${tr('Solved.', 'Đã giải.')}</p>`;
    else if (locked) body = `<p class="bpa-g-lk-note">${tr('Locked', 'Đang khóa')}: ${missing.map(prettyId).map(escapeHtml).join(', ') || tr('missing requirement', 'còn thiếu điều kiện')}.</p>`;
    else if (puzzle.type === 'CODE_PUZZLE') {
      const length = puzzle.answerLength;
      const code = codeDrafts.get(puzzle.puzzleId) ?? [];
      if (length > 0 && length <= 10) {
        const cells = Array.from({ length }, (_, index) => `<div class="bpa-g-dial">
            <button type="button" class="bpa-g-dial-b bpa-g-up" tabindex="-1" data-code-roll="${index}:1" aria-label="${tr(`Increase character ${index + 1}`, `Tăng ký tự thứ ${index + 1}`)}">${gameIcon('next')}</button>
            <input class="bpa-g-dial-w" data-code-cell="${index}" maxlength="1" autocomplete="off" autocapitalize="characters" spellcheck="false" ${index === 0 ? 'data-modal-autofocus' : ''}
              aria-label="${tr(`Character ${index + 1} of ${length}`, `Ký tự thứ ${index + 1}/${length}`)}" value="${escapeHtml(code[index] ?? '')}">
            <button type="button" class="bpa-g-dial-b bpa-g-down" tabindex="-1" data-code-roll="${index}:-1" aria-label="${tr(`Decrease character ${index + 1}`, `Giảm ký tự thứ ${index + 1}`)}">${gameIcon('next')}</button>
          </div>`).join('');
        body = `<div class="bpa-g-dials ${length > 6 ? 'is-long' : ''}" role="group" aria-label="${kind}">${cells}</div>
          <input type="hidden" id="puzzle-code-answer" data-puzzle-id="${escapeHtml(puzzle.puzzleId)}" value="${escapeHtml(code.join(''))}">`;
      } else {
        body = `<input class="bpa-g-code-wide" id="puzzle-code-answer" data-puzzle-id="${escapeHtml(puzzle.puzzleId)}" data-modal-autofocus maxlength="32" autocomplete="off" spellcheck="false"
          placeholder="${tr('Code', 'Mã')}" aria-label="${kind}" value="${escapeHtml(code.join(''))}">`;
      }
    } else {
      body = `<div class="bpa-g-opts">${(puzzle.options ?? []).map((option) => `
          <button class="bpa-btn bpa-btn--gold bpa-btn--sm" type="button" data-puzzle-option="${escapeHtml(option)}">${escapeHtml(prettyId(option))}</button>`).join('')}</div>
        <p class="bpa-g-seq" role="status">${draft.length > 0 ? escapeHtml(draft.map(prettyId).join(' → ')) : tr('No symbols selected.', 'Chưa chọn ký hiệu nào.')}</p>`;
    }

    return `
    <div class="overlay bpa-g-overlay">
      <div class="modal bpa-g-lk">
        <span class="bpa-g-rivet is-a" aria-hidden="true"></span><span class="bpa-g-rivet is-b" aria-hidden="true"></span><span class="bpa-g-rivet is-c" aria-hidden="true"></span><span class="bpa-g-rivet is-d" aria-hidden="true"></span>
        <div class="bpa-g-lk-hd">
          <span class="bpa-g-lk-ic" aria-hidden="true">${gameIcon(solved ? 'unlock' : 'lock')}</span>
          <div class="bpa-g-lk-ttl"><span class="bpa-g-kick">${kind}</span><h2>${escapeHtml(title)}</h2></div>
          <button class="bpa-g-x" type="button" data-close-overlay aria-label="${tr('Close', 'Đóng')}" aria-keyshortcuts="Escape">${gameIcon('x')}</button>
        </div>
        ${puzzle.prompt ? `<p class="bpa-g-lk-p">${escapeHtml(puzzle.prompt)}</p>` : ''}
        ${body}
        <div class="bpa-g-lk-act">
          ${!solved && !locked ? `<button class="bpa-btn bpa-btn--gold bpa-btn--sm" type="button" id="puzzle-clear-btn">${tr('Clear', 'Xóa')}</button><button class="bpa-btn bpa-btn--red bpa-btn--sm" type="button" id="puzzle-submit-btn">${tr('Submit', 'Xác nhận')}</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  // ----- Conversation helpers (Phase A dialogue view) -----

  function splitSentences(text: string): string[] {
    if (!text) return [];
    const matches = text.match(/[^.!?]+[.!?]+(?:["'’”)]+)?|\S[^.!?]*$/g);
    const parts = (matches ?? [text]).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [text.trim()];
  }

  function resetConversation() {
    convCharacterId = null;
    convLog = [];
    convTreeNodeId = null;
    convTreeChoices = [];
    convTreeChallenge = null;
  }

  function isTreeCharacter(characterId: string): boolean {
    return state!.visibleScene.conversationTreeCharacterIds?.includes(characterId) ?? false;
  }

  // Deterministically derive the conversation log from authoritative state. Pure and
  // idempotent: rebuilding from the same state always yields the same log, so re-renders,
  // reconnects, or repeated actions can never duplicate lines. Tree NPCs rebuild from the
  // visited-node transcript; flat NPCs rebuild from asked Q&A + resolved confrontations.
  function buildConversation(characterId: string): ConvLine[] {
    const lines: ConvLine[] = [];
    if (isTreeCharacter(characterId)) {
      const entries = state!.visibleScene.conversationTranscript?.filter((e) => e.characterId === characterId) ?? [];
      for (const entry of entries) {
        for (const line of entry.lines) {
          lines.push({ speaker: line.speaker === 'DETECTIVE' ? 'SIRLOCKED' : 'NPC', text: line.text });
        }
        if (entry.challenge?.isResolved && entry.challenge.resolution) {
          for (const l of splitSentences(entry.challenge.resolution)) lines.push({ speaker: 'NPC', text: l });
        }
      }
      return lines;
    }
    const dialogues = state!.visibleScene.availableDialogues.filter((d) => d.characterId === characterId && d.isAsked);
    for (const d of dialogues) {
      lines.push({ speaker: 'SIRLOCKED', text: d.question });
      for (const line of splitSentences(d.answer)) lines.push({ speaker: 'NPC', text: line });
      for (const challenge of d.evidenceChallenges ?? []) {
        if (challenge.isResolved && challenge.resolution) {
          for (const line of splitSentences(challenge.resolution)) lines.push({ speaker: 'NPC', text: line });
        }
      }
    }
    return lines;
  }

  function renderChallengePanel(challenge: EvidenceChallenge, role: string | null | undefined) {
    return `
      <section class="evidence-challenge conv-challenge bpa-chal">
        <div class="conv-challenge-head bpa-chal-head">
          <span class="conv-challenge-tag bpa-chal-tag">${bpaIcons.stamp}${tr('Present evidence', 'Đưa chứng cứ')}</span>
          <button class="bpa-btn bpa-btn--ink bpa-btn--sm bpa-chal-hint" type="button" data-challenge-hint="${escapeHtml(challenge.challengeId)}">${bpaIcons.bulb}${tr('Hint', 'Gợi ý')}</button>
        </div>
        <p class="bpa-chal-prompt">${escapeHtml(challenge.prompt)}</p>
        ${role === 'INTERROGATOR'
          ? state!.evidenceClues.length
            ? `<div class="challenge-actions bpa-chal-list">${state!.evidenceClues.map((clue) => `
              <button class="evidence-choice bpa-chal-ev" type="button" data-present-challenge="${escapeHtml(challenge.challengeId)}" data-present-evidence="${escapeHtml(clue.clueId)}">
                <span class="bpa-chal-tile" aria-hidden="true">${initials(clue.title)}</span><span>${escapeHtml(clue.title)}</span>
              </button>`).join('')}</div>`
            : `<p class="bpa-chal-note">${tr('No evidence-grade clues unlocked yet.', 'Chưa mở khóa manh mối đủ giá trị làm chứng cứ.')}</p>`
          : `<p class="bpa-chal-note">${tr('Only the Interrogator can present evidence.', 'Chỉ Thẩm vấn viên có thể đưa chứng cứ.')}</p>`}
      </section>`;
  }

  function dialogueOverlay(characterId: string) {
    const character = state!.visibleScene.characters.find((c) => c.characterId === characterId);
    if (!character) return '';
    const role = myRole();
    const dialogues = state!.visibleScene.availableDialogues.filter((d) => d.characterId === characterId);

    const freshOpen = convCharacterId !== characterId;
    if (freshOpen) convCharacterId = characterId;
    convLog = buildConversation(characterId);

    const tree = isTreeCharacter(characterId);
    // Numbered question cards: the number is also the keyboard shortcut; new leads carry a "Mới" tag.
    let topicNumber = 0;
    const topic = (attributes: string, text: string, isNew: boolean) => {
      topicNumber += 1;
      return `<button type="button" class="conv-choice ${isNew ? 'is-new' : ''}" ${attributes}>${topicNumber <= 9 ? `<kbd aria-hidden="true">${topicNumber}</kbd>` : ''}<span class="conv-choice-text">${escapeHtml(text)}</span>${isNew ? `<em class="conv-choice-tag">${tr('New', 'Mới')}</em>` : ''}</button>`;
    };
    let topicsHtml: string;
    let challengeHtml: string;
    let newLeadHtml: string;

    if (tree) {
      const choices = convTreeChoices;
      const askable = dialogues.filter((d) => !d.isAsked && !d.isLocked);
      const hasNewChoice = choices.some((c) => !c.isLocked && isTreeCueHighlighted(characterId, c.choiceId))
        || askable.some((d) => newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId));
      newLeadHtml = hasNewChoice
        ? `<p class="conv-new-lead">${escapeHtml(character.name)} ${tr('seems willing to say more.', 'có vẻ sẵn sàng tiết lộ thêm.')}</p>`
        : '';

      if (role !== 'INTERROGATOR') {
        topicsHtml = `<p class="conv-readonly muted small">${tr('Waiting for the Interrogator to continue questioning.', 'Đang chờ Thẩm vấn viên tiếp tục đặt câu hỏi.')}</p>`;
      } else if (choices.length === 0 && askable.length === 0) {
        topicsHtml = `<p class="conv-readonly muted small">${tr('There is nothing left to ask right now.', 'Hiện không còn câu hỏi nào để hỏi.')}</p>`;
      } else {
        const lockedTree = choices.filter((c) => c.isLocked).length + dialogues.filter((d) => d.isLocked).length;
        const dialogueButtons = askable.map((d) => topic(`data-dialogue="${escapeHtml(d.dialogueId)}"`, d.question,
          newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId))).join('');
        topicsHtml = `${dialogueButtons}${choices.filter((c) => !c.isLocked).map((c) => topic(
            `data-converse-node="${escapeHtml(convTreeNodeId ?? '')}" data-converse-choice="${escapeHtml(c.choiceId)}"`,
            c.label ?? '', isTreeCueHighlighted(characterId, c.choiceId))).join('')}
          ${lockedTree > 0
            ? `<p class="conv-locked">${lockedTree > 1
              ? tr(`${lockedTree} more options locked — find stronger evidence first.`, `${lockedTree} lựa chọn khác đang bị khóa — hãy tìm chứng cứ mạnh hơn.`)
              : tr('Locked — find stronger evidence before pressing further.', 'Đang bị khóa — hãy tìm chứng cứ mạnh hơn trước khi hỏi tiếp.')}</p>`
            : ''}`;
      }

      const currentEntry = state!.visibleScene.conversationTranscript?.find((e) => e.nodeId === convTreeNodeId);
      const nodeChallenge = currentEntry?.challenge ?? convTreeChallenge;
      challengeHtml = nodeChallenge && !nodeChallenge.isResolved ? renderChallengePanel(nodeChallenge, role) : '';
    } else {
      const askable = dialogues.filter((d) => !d.isAsked && !d.isLocked);
      const highlighted = askable.filter((d) => newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId));
      const lockedCount = dialogues.filter((d) => d.isLocked).length;
      const activeChallenges = dialogues
        .filter((d) => d.isAsked)
        .flatMap((d) => (d.evidenceChallenges ?? []).filter((c) => !c.isResolved));

      newLeadHtml = highlighted.length > 0
        ? `<p class="conv-new-lead">${escapeHtml(character.name)} ${tr('seems willing to say more.', 'có vẻ sẵn sàng tiết lộ thêm.')}</p>`
        : '';

      topicsHtml = role !== 'INTERROGATOR'
        ? `<p class="conv-readonly muted small">${tr('Waiting for the Interrogator to continue questioning.', 'Đang chờ Thẩm vấn viên tiếp tục đặt câu hỏi.')}</p>`
        : askable.length === 0 && lockedCount === 0
          ? `<p class="conv-readonly muted small">${tr('There is nothing left to ask right now.', 'Hiện không còn câu hỏi nào để hỏi.')}</p>`
          : `${askable.map((d) => topic(`data-dialogue="${escapeHtml(d.dialogueId)}"`, d.question,
              newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId))).join('')}
            ${lockedCount > 0
              ? `<p class="conv-locked">${lockedCount > 1
                ? tr(`${lockedCount} more questions locked — find stronger evidence first.`, `${lockedCount} câu hỏi khác đang bị khóa — hãy tìm chứng cứ mạnh hơn.`)
                : tr('Locked — find stronger evidence before pressing further.', 'Đang bị khóa — hãy tìm chứng cứ mạnh hơn trước khi hỏi tiếp.')}</p>`
              : ''}`;

      challengeHtml = activeChallenges.map((challenge) => renderChallengePanel(challenge, role)).join('');
    }

    const host = app.querySelector<HTMLElement>('#game-dialogue-slot');
    if (host) dialoguePresenter.update(host, { character, lines: convLog, topicsHtml, challengeHtml,
      newLeadHtml, readonly: role !== 'INTERROGATOR', context: state!.visibleScene.title });
    return '';
  }

  // One board for the whole accusation (Accuse.html). `draft.step` marks the section being
  // worked on; Continue walks the sections in order and step 5 is the read-back before filing.
  function accusationModal() {
    if (uiMode.kind !== 'ACCUSATION') return '';
    const accusation = uiMode.draft;
    const current = state!;
    const config = current.mechanicsVersion >= 2 ? current.accusationConfig : undefined;
    const reviewing = config ? accusation.step >= 5 : accusation.step >= 2;
    const previous = app.querySelector<HTMLElement>('.bpa-ac.is-draft');
    const stepChanged = Boolean(previous) && previous!.dataset.accusationStep !== String(accusation.step);
    const phaseChanged = Boolean(previous) && previous!.classList.contains('is-reviewing') !== reviewing;
    const keptScroll = previous && !stepChanged ? previous.querySelector<HTMLElement>('.bpa-ac-body')?.scrollTop ?? 0 : 0;
    if (previous) {
      queueMicrotask(() => {
        const body = app.querySelector<HTMLElement>('.bpa-ac.is-draft .bpa-ac-body');
        if (!body) return;
        if (keptScroll) body.scrollTop = keptScroll;
        else if (stepChanged && !phaseChanged) body.querySelector<HTMLElement>('.bpa-ac-sec.is-current')?.scrollIntoView({ block: 'nearest' });
      });
    }
    const header = renderAccusationHeader({
      escape: escapeHtml,
      tr,
      phase: 'draft',
      caseTitle: current.caseTitle,
      sceneTitle: amendedAccusation
        ? `${tr('EDITING THE PROPOSAL', 'SỬA ĐỀ XUẤT')} · ${tr('REVISION', 'PHIÊN BẢN')} ${amendedAccusation.expectedRevision}`
        : current.visibleScene.title,
      closable: true,
    });
    const body = reviewing
      ? accusationReviewMarkup(accusation, config ?? null)
      : config
        ? accusationBoardMarkup(accusation, config)
        : accusationLegacyBoardMarkup(accusation);
    const settled = Boolean(previous) && previous!.dataset.culprit === (accusation.culpritId ?? '');
    return `<div class="overlay bpa-ac-veil${previous ? '' : ' is-opening'}" data-modal-key="accusation-draft"><div class="modal modal-wide accusation-modal bpa-ac is-draft${reviewing ? ' is-reviewing' : ''}${previous ? '' : ' is-opening'}${settled ? ' is-settled' : ''}" data-accusation-step="${accusation.step}" data-culprit="${escapeHtml(accusation.culpritId ?? '')}">
      ${header}
      <div class="bpa-ac-body${phaseChanged ? ' bpa-wipe-a' : ''}">${body}</div>
      ${reviewing ? '' : accusationFooterMarkup(accusation, config ?? null)}
    </div></div>`;
  }

  function accusationClaimsComplete(accusation: AccusationDraft, config: AccusationConfig) {
    return config.claimTypes.every((claim) => Boolean(accusation.evidenceLinks[claim]))
      && new Set(config.claimTypes.map((claim) => accusation.evidenceLinks[claim])).size === config.claimTypes.length;
  }

  function accusationActiveClaim(accusation: AccusationDraft, config: AccusationConfig) {
    return config.claimTypes.includes(accusation.activeClaimType ?? '')
      ? accusation.activeClaimType!
      : config.claimTypes.find((claim) => !accusation.evidenceLinks[claim]) ?? config.claimTypes[0];
  }

  function accusationLineup(accusation: AccusationDraft) {
    const suspects = state!.suspects;
    return `<div class="bpa-ac-lineup suspect-grid" style="--bpa-ac-n:${Math.max(1, suspects.length)}">
      <div class="bpa-ac-wall" aria-hidden="true"><span style="top:8px">190</span><span style="top:28px">180</span><span style="top:48px">170</span><span style="top:68px">160</span></div>
      ${suspects.map((suspect, index) => {
        const selected = accusation.culpritId === suspect.characterId;
        const portrait = characterPortraitUrl(suspect);
        return `<button class="suspect-card bpa-ac-sus${selected ? ' is-selected' : ''}" type="button" data-suspect="${escapeHtml(suspect.characterId)}" aria-pressed="${selected}">
          <span class="bpa-ac-sno" aria-hidden="true">Nº ${index + 1}</span>
          <span class="suspect-portrait bpa-ac-figure${portrait ? ' has-portrait' : ''}" aria-hidden="true">
            ${portrait ? `<img src="${escapeHtml(portrait)}" alt="" onerror="this.remove()">` : ''}
            <svg class="bpa-ac-sil" viewBox="0 0 100 86" focusable="false"><circle cx="50" cy="22" r="15"/><path d="M42 35h16l1.5 9c16 3 27 13 30 30v12H10.5V74c3-17 14-27 30-30z"/></svg>
          </span>
          <span class="bpa-ac-sign"><span class="bpa-ac-signtop">${bpaMono(initials(suspect.name), 'witness', 'sm')}<span class="bpa-ac-signname">${escapeHtml(suspect.name)}</span></span><span class="bpa-ac-signrole">${escapeHtml(suspect.role)}</span></span>
          <span class="bpa-ac-spin" aria-hidden="true"></span>
        </button>`;
      }).join('')}
    </div>`;
  }

  // Red string from the chosen name plate down to every claim it is pinned to.
  function accusationStrings(accusation: AccusationDraft, config: AccusationConfig, activeClaim: string) {
    const suspects = state!.suspects;
    const index = suspects.findIndex((suspect) => suspect.characterId === accusation.culpritId);
    if (index < 0 || config.claimTypes.length === 0) return '<div class="bpa-ac-strings" aria-hidden="true"></div>';
    const from = ((index + 0.5) / suspects.length) * 1000;
    const paths = config.claimTypes.map((claim, claimIndex) => {
      const to = ((claimIndex + 0.5) / config.claimTypes.length) * 1000;
      const d = `M${from.toFixed(1)} 0C${from.toFixed(1)} 58 ${to.toFixed(1)} 42 ${to.toFixed(1)} 100`;
      if (accusation.evidenceLinks[claim]) return `<path class="bpa-ac-str" d="${d}"/>`;
      return claim === activeClaim ? `<path class="bpa-ac-pend" d="${d}"/>` : '';
    }).join('');
    return `<div class="bpa-ac-strings" aria-hidden="true"><svg viewBox="0 0 1000 100" preserveAspectRatio="none" focusable="false">${paths}</svg></div>`;
  }

  function accusationBoardMarkup(accusation: AccusationDraft, config: AccusationConfig) {
    const evidence = state!.evidenceClues;
    const activeClaim = accusationActiveClaim(accusation, config);
    const filled = config.claimTypes.filter((claim) => Boolean(accusation.evidenceLinks[claim])).length;
    const duplicate = filled === config.claimTypes.length && !accusationClaimsComplete(accusation, config);
    const claims = config.claimTypes.map((claim, index) => {
      const selectedClue = evidence.find((clue) => clue.clueId === accusation.evidenceLinks[claim]);
      const active = activeClaim === claim;
      return `<div class="claim-drop-zone bpa-ac-slot${active ? ' is-active' : ''}${selectedClue ? ' is-filled' : ''}" data-claim-drop="${escapeHtml(claim)}">
        <span class="bpa-ac-cpin ${selectedClue ? 'is-on' : 'is-off'}" aria-hidden="true"></span>
        <button class="claim-slot-button bpa-ac-slotbtn" data-claim-slot="${escapeHtml(claim)}" type="button" aria-pressed="${active}">
          <span class="bpa-ac-slotk">${tr('CLAIM', 'LUẬN ĐIỂM')} ${index + 1}</span>
          <span class="claim-slot-label bpa-ac-slott">${escapeHtml(accusationClaimLabel(claim))}</span>
        </button>
        ${selectedClue
          ? `<span class="claim-slot-copy bpa-ac-chip">${evidencePhotoMarkup(selectedClue, 'evidence-photo-thumb')}<strong>${escapeHtml(selectedClue.title)}</strong></span>
             <button class="claim-slot-clear bpa-ac-unpin" data-clear-claim="${escapeHtml(claim)}" type="button" aria-label="${tr('Remove evidence from', 'Gỡ chứng cứ khỏi')} ${escapeHtml(accusationClaimLabel(claim))}">${bpaIcons.plus}</button>`
          : `<span class="bpa-ac-drop">${tr('Drop evidence here', 'Thả chứng cứ vào đây')}</span>`}
      </div>`;
    }).join('');
    const cards = evidence.map((clue) => {
      const assignedClaim = config.claimTypes.find((claim) => accusation.evidenceLinks[claim] === clue.clueId);
      return `<li><button class="accusation-evidence-card bpa-ac-ev${assignedClaim ? ' is-assigned is-used' : ''}" data-assign-evidence="${escapeHtml(clue.clueId)}" draggable="true" type="button" aria-label="${tr('Assign evidence', 'Gán chứng cứ')}: ${escapeHtml(clue.title)}">
        <span class="accusation-evidence-art bpa-ac-evic">${evidencePhotoMarkup(clue, 'evidence-photo-thumb') || bpaIcons.doc}</span>
        <span class="accusation-evidence-copy bpa-ac-evb">
          <span class="bpa-ac-evt">${escapeHtml(clue.title)}</span>
          <small class="bpa-ac-evst">${assignedClaim ? `${bpaIcons.check}${tr('Assigned to', 'Đã gán cho')} ${escapeHtml(accusationClaimLabel(assignedClaim))}` : `${bpaIcons.plus}${tr('Click to assign', 'Bấm để gán')}`}</small>
        </span>
        <span class="bpa-ac-evpin" aria-hidden="true"></span>
      </button></li>`;
    }).join('');
    return `<div class="bpa-ac-board">
      <section class="bpa-ac-left bpa-ac-paper" aria-label="${tr('Suspects and claims', 'Nghi phạm và luận điểm')}">
        <span class="bpa-ac-margin" aria-hidden="true"></span>
        <div class="bpa-ac-lab is-sus"><h3 class="bpa-ac-labh">${tr('SUSPECT', 'NGHI PHẠM')}</h3><p class="bpa-ac-labsub">${tr('Pick one name plate.', 'Chọn một bảng tên.')}</p></div>
        <div class="bpa-ac-sec is-lineup${accusation.step === 1 ? ' is-current' : ''}" data-step="1">${accusationLineup(accusation)}</div>
        ${accusationStrings(accusation, config, activeClaim)}
        <div class="bpa-ac-lab is-claims"><h3 class="bpa-ac-labh">${tr('CLAIMS OF THE ACCUSATION', 'CÁC LUẬN ĐIỂM CÁO BUỘC')}</h3><p class="bpa-ac-prog"><b class="bpa-ac-progn">${filled}<small>/${config.claimTypes.length}</small></b><span class="bpa-ac-mini">${tr('ASSIGNED', 'ĐÃ GÁN')}</span></p></div>
        <div class="bpa-ac-sec is-claims${accusation.step === 4 ? ' is-current' : ''}" data-step="4">
          <div class="bpa-ac-claims accusation-claim-column" style="--bpa-ac-m:${Math.max(1, config.claimTypes.length)}" aria-label="${tr('Accusation claims', 'Các luận điểm cáo buộc')}">${claims}</div>
        </div>
        <div class="bpa-ac-caps">
          <p class="bpa-ac-help is-it">${bpaIcons.cursor}${tr('Choose a slot, then click or drag evidence into it.', 'Chọn một ô, sau đó bấm hoặc kéo chứng cứ vào.')}</p>
          <p class="bpa-ac-help">${bpaIcons.neq}${tr('Each claim must use different evidence.', 'Mỗi luận điểm phải dùng chứng cứ khác nhau.')}</p>
          ${duplicate ? `<p class="notice bpa-ac-alert is-paper" role="alert">${bpaIcons.warn}${tr('Each claim must use different evidence.', 'Mỗi luận điểm phải dùng chứng cứ khác nhau.')}</p>` : ''}
        </div>
      </section>
      <section class="bpa-ac-right bpa-ac-paper" aria-label="${tr('Motive and method', 'Động cơ và phương thức')}">
        <span class="bpa-ac-margin" aria-hidden="true"></span>
        <div class="bpa-ac-sec bpa-ac-group${accusation.step === 2 ? ' is-current' : ''}" data-step="2">
          <div class="bpa-ac-ghead"><h3>${tr('MOTIVE', 'ĐỘNG CƠ')}</h3>${accusation.motiveId ? `<b class="bpa-ac-ok">${bpaIcons.check}</b>` : ''}</div>
          ${optionPicker(state!.accusationConfig!.motiveOptions, accusation.motiveId, 'motive')}
        </div>
        <div class="bpa-ac-sec bpa-ac-group${accusation.step === 3 ? ' is-current' : ''}" data-step="3">
          <div class="bpa-ac-ghead"><h3>${tr('METHOD', 'PHƯƠNG THỨC')}</h3>${accusation.methodId ? `<b class="bpa-ac-ok">${bpaIcons.check}</b>` : ''}</div>
          ${optionPicker(state!.accusationConfig!.methodOptions, accusation.methodId, 'method')}
        </div>
      </section>
      <section class="bpa-ac-tray accusation-evidence-library${accusation.step === 4 ? ' is-current' : ''}" aria-label="${tr('Collected evidence', 'Chứng cứ đã thu thập')}">
        <ul class="bpa-ac-evs accusation-evidence-gallery">
          <li class="bpa-ac-trayhead">
            <p class="bpa-ac-kick is-gold">${tr('COLLECTED EVIDENCE', 'CHỨNG CỨ ĐÃ THU THẬP')}</p>
            <p class="bpa-ac-cnt"><b>${evidence.length}</b>${tr('available', 'có sẵn')}</p>
            <p class="bpa-ac-tgt"><span class="bpa-ac-tgtk">${tr('ASSIGNING TO', 'GÁN CHỨNG CỨ')}</span><span class="bpa-ac-tgtv">${bpaIcons.arrow}${escapeHtml(accusationClaimLabel(activeClaim))}</span></p>
          </li>
          ${evidence.length ? cards : `<li class="bpa-ac-none">${tr('No evidence-grade clues unlocked yet.', 'Chưa mở khóa manh mối đủ giá trị làm chứng cứ.')}</li>`}
        </ul>
      </section>
    </div>`;
  }

  function accusationLegacyBoardMarkup(accusation: AccusationDraft) {
    const evidence = state!.evidenceClues;
    return `<div class="bpa-ac-board is-legacy">
      <section class="bpa-ac-left bpa-ac-paper" aria-label="${tr('Suspects', 'Nghi phạm')}">
        <span class="bpa-ac-margin" aria-hidden="true"></span>
        <div class="bpa-ac-lab is-sus"><h3 class="bpa-ac-labh">${tr('SUSPECT', 'NGHI PHẠM')}</h3><p class="bpa-ac-labsub">${tr('Choose the culprit and the evidence. A wrong accusation ends the case.', 'Chọn thủ phạm và chứng cứ. Cáo buộc sai sẽ kết thúc vụ án.')}</p></div>
        <div class="bpa-ac-sec is-lineup is-current" data-step="1">${accusationLineup(accusation)}</div>
      </section>
      <section class="bpa-ac-tray" aria-label="${tr('Evidence', 'Chứng cứ')}">
        <ul class="bpa-ac-evs evidence-list">
          <li class="bpa-ac-trayhead"><p class="bpa-ac-kick is-gold">${tr('EVIDENCE', 'CHỨNG CỨ')}</p><p class="bpa-ac-cnt"><b>${evidence.length}</b>${tr('available', 'có sẵn')}</p></li>
          ${evidence.length === 0
            ? `<li class="bpa-ac-none">${tr('No evidence-grade clues unlocked yet.', 'Chưa mở khóa manh mối đủ giá trị làm chứng cứ.')}</li>`
            : evidence.map((clue) => `<li><label class="evidence-row bpa-ac-ev bpa-ac-check">
                <input type="checkbox" data-evidence="${escapeHtml(clue.clueId)}" ${accusation.evidenceIds.has(clue.clueId) ? 'checked' : ''}>
                <span class="bpa-ac-evic">${evidencePhotoMarkup(clue, 'evidence-photo-thumb') || bpaIcons.doc}</span>
                <span class="bpa-ac-evb"><span class="bpa-ac-evt">${escapeHtml(clue.title)}</span><span class="bpa-ac-evnote">${escapeHtml(clue.content)}</span></span>
              </label></li>`).join('')}
        </ul>
      </section>
    </div>`;
  }

  function accusationFooterMarkup(accusation: AccusationDraft, config: AccusationConfig | null) {
    if (!config) {
      return `<footer class="bpa-ac-foot">
        <p class="bpa-ac-ck${accusation.culpritId ? ' is-ok' : ''}">${accusation.culpritId ? bpaIcons.check : '<i class="bpa-ac-cko" aria-hidden="true"></i>'}${tr('Suspect', 'Nghi phạm')}</p>
        <div class="bpa-ac-footr">
          <button class="bpa-btn bpa-btn--ink" id="accuse-cancel" type="button">${tr('Not yet', 'Để sau')}</button>
          <button class="bpa-btn bpa-btn--red bpa-ac-send" id="accuse-review" type="button" ${accusation.culpritId ? '' : 'disabled'}>${tr('Review accusation', 'Xem lại cáo buộc')}${bpaIcons.arrow}</button>
        </div>
      </footer>`;
    }
    const done = [
      Boolean(accusation.culpritId),
      Boolean(accusation.motiveId),
      Boolean(accusation.methodId),
      accusationClaimsComplete(accusation, config),
    ];
    const filled = config.claimTypes.filter((claim) => Boolean(accusation.evidenceLinks[claim])).length;
    const canContinue = accusation.step < 4 ? done[accusation.step - 1] : done.every(Boolean);
    const checks = [tr('Suspect', 'Nghi phạm'), tr('Motive', 'Động cơ'), tr('Method', 'Phương thức'), `${tr('Claims', 'Luận điểm')} <b>${filled}/${config.claimTypes.length}</b>`];
    return `<footer class="bpa-ac-foot">
      <ul class="bpa-ac-checks" aria-label="${tr('Accusation checklist', 'Danh sách kiểm tra cáo buộc')}">${checks.map((label, index) => `<li><button class="bpa-ac-ck${done[index] ? ' is-ok' : ''}${accusation.step === index + 1 ? ' is-now' : ''}" type="button" data-accuse-step="${index + 1}" aria-current="${accusation.step === index + 1 ? 'step' : 'false'}">${done[index] ? bpaIcons.check : '<i class="bpa-ac-cko" aria-hidden="true"></i>'}${label}</button></li>`).join('')}</ul>
      <div class="bpa-ac-footr">
        <button class="bpa-btn bpa-btn--ink" id="accuse-cancel" type="button">${tr('Not yet', 'Để sau')}</button>
        <button class="bpa-btn bpa-btn--red bpa-ac-send" id="accuse-next" type="button" ${canContinue ? '' : 'disabled'}>${accusation.step >= 4 ? tr('Review accusation', 'Xem lại cáo buộc') : tr('Continue', 'Tiếp tục')}${bpaIcons.arrow}</button>
      </div>
    </footer>`;
  }

  function accusationReviewMarkup(accusation: AccusationDraft, config: AccusationConfig | null) {
    const current = state!;
    const rows = accusationSummaryRows({
      culpritId: accusation.culpritId ?? '',
      motiveId: config ? accusation.motiveId : null,
      methodId: config ? accusation.methodId : null,
      evidenceLinks: config
        ? config.claimTypes.filter((claim) => accusation.evidenceLinks[claim]).map((claimType) => ({ claimType, evidenceId: accusation.evidenceLinks[claimType] }))
        : [],
      evidenceIds: config ? [] : [...accusation.evidenceIds],
    }, Boolean(config));
    const culprit = current.suspects.find((suspect) => suspect.characterId === accusation.culpritId);
    const label = amendedAccusation
      ? tr('Send the edited proposal', 'Gửi đề xuất đã sửa')
      : config
        ? tr('Make accusation', 'Đưa ra cáo buộc')
        : `${tr('Accuse', 'Cáo buộc')} ${escapeHtml(culprit?.name ?? '')}`;
    return `<div class="bpa-ac-review">
      ${renderAccusationSheet({ escape: escapeHtml, tr, rows, revision: amendedAccusation ? amendedAccusation.expectedRevision + 1 : null, meta: accusationMeta() })}
      <section class="bpa-ac-confirm" aria-label="${tr('Last check', 'Kiểm tra lần cuối')}">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <div class="bpa-ac-chead">
          <p class="bpa-ac-kick is-gold">${tr('LAST CHECK', 'KIỂM TRA LẦN CUỐI')}</p>
          <h3 class="bpa-ac-both">${tr('Read the accusation once more before you file it.', 'Đọc lại cáo buộc một lần nữa trước khi nộp.')}</h3>
          <p class="notice bpa-ac-alert">${bpaIcons.warn}${tr('A wrong accusation ends the case.', 'Cáo buộc sai sẽ kết thúc vụ án.')}</p>
        </div>
        ${current.mechanicsVersion >= 3 ? `<p class="bpa-ac-status">${tr('Your partner then reads the same revision, and the case closes only when both of you confirm it.', 'Sau đó đồng đội đọc lại cùng phiên bản; vụ án chỉ khép lại khi cả hai cùng xác nhận.')}</p>` : ''}
        <div class="bpa-ac-ctrl">
          <button class="bpa-btn bpa-btn--red bpa-ac-go" id="accuse-confirm" type="button">${bpaIcons.stamp}${label}</button>
          <button class="bpa-btn bpa-btn--gold" id="accuse-back" type="button">${bpaIcons.back}${tr('Back to edit', 'Quay lại sửa')}</button>
        </div>
      </section>
    </div>`;
  }

  function accusationMeta() {
    const current = state!;
    return [current.visibleScene.title, `${tr('ROOM', 'PHÒNG')} ${current.roomCode}`];
  }

  // Joint review of the standing proposal. The accusation modal owns drafting; this owns agreeing.
  function accusationConsensusPanel() {
    const proposal = filedAccusation ?? state!.activeAccusation;
    if (!proposal || uiMode.kind === 'ACCUSATION') return '';

    const players = state!.players;
    const previous = app.querySelector<HTMLElement>('.bpa-ac.is-consensus');
    const renderKey = `${proposal.attemptId}:${proposal.revision}:${(proposal.confirmedUserIds ?? []).join(',')}:${Boolean(filedAccusation)}`;
    const mine = players.find((player) => player.userId === me.userId);
    const partner = players.find((player) => player.userId !== me.userId);
    const proposer = players.find((player) => player.userId === proposal.proposedByUserId);
    const person = (player: RoomPlayer | undefined) => (player
      ? { name: player.username, initials: initials(player.username), role: roleName(player.role, tr) }
      : undefined);
    const model = buildAccusationConsensusModel({
      proposal,
      localUserId: me.userId,
      rows: accusationSummaryRows(proposal),
      proposerName: proposer?.username ?? tr('Your partner', 'Đồng đội'),
      partnerName: partner?.username ?? tr('Partner', 'Đồng đội'),
      acknowledgedKey: acknowledgedAccusationKey,
      me: person(mine),
      partner: person(partner),
      proposerInitials: proposer ? initials(proposer.username) : undefined,
      filed: Boolean(filedAccusation),
      resultHref: `#/result/${roomId}`,
      caseTitle: state!.caseTitle,
      sceneTitle: state!.visibleScene.title,
      meta: accusationMeta(),
      renderKey,
      settled: previous?.dataset.renderKey === renderKey,
    });
    return renderAccusationConsensus(model, escapeHtml, tr);
  }

  function accusationSummaryRows(
    proposal: Pick<AccusationProposal, 'culpritId' | 'motiveId' | 'methodId' | 'evidenceLinks' | 'evidenceIds'>,
    withMotiveAndMethod = Boolean(state!.accusationConfig),
  ) {
    const suspect = state!.suspects.find((candidate) => candidate.characterId === proposal.culpritId);
    const rows: AccusationSummaryRow[] = [{
      label: tr('Suspect', 'Nghi phạm'),
      value: suspect?.name ?? proposal.culpritId,
      kind: 'suspect',
      detail: suspect?.role,
    }];
    const config = state!.accusationConfig;
    if (config && withMotiveAndMethod) {
      rows.push({
        label: tr('Motive', 'Động cơ'),
        value: config.motiveOptions.find((option) => option.id === proposal.motiveId)?.label ?? proposal.motiveId ?? '',
        kind: 'motive',
      });
      rows.push({
        label: tr('Method', 'Phương thức'),
        value: config.methodOptions.find((option) => option.id === proposal.methodId)?.label ?? proposal.methodId ?? '',
        kind: 'method',
      });
    }
    // A claim your partner backed with a clue only they found arrives without its id on purpose.
    const undisclosed = tr('Evidence only your partner has seen', 'Chứng cứ chỉ đồng đội đã thấy');
    const clueTitle = (evidenceId: string | null | undefined) =>
      (evidenceId
        ? state!.evidenceClues.find((clue) => clue.clueId === evidenceId)?.title
          ?? state!.unlockedClues.find((clue) => clue.clueId === evidenceId)?.title
          ?? evidenceId
        : undisclosed);
    // This modal stands between the pair and the end of the case; it must never fail to render.
    for (const link of proposal.evidenceLinks ?? []) {
      rows.push({
        label: accusationClaimLabel(link.claimType),
        value: link.isUndisclosed ? undisclosed : clueTitle(link.evidenceId),
        kind: 'claim',
        undisclosed: Boolean(link.isUndisclosed || !link.evidenceId),
      });
    }
    for (const evidenceId of proposal.evidenceIds ?? []) {
      rows.push({ label: tr('Evidence', 'Chứng cứ'), value: clueTitle(evidenceId), kind: 'evidence' });
    }
    return rows;
  }

  function optionPicker(options: AccusationOption[], selectedId: string | null, kind: 'motive' | 'method') {
    return `<div class="accusation-options bpa-ac-opts" role="group" aria-label="${kind === 'motive' ? tr('Motive', 'Động cơ') : tr('Method', 'Phương thức')}">${options.map((option) => `
      <button class="option-row bpa-ac-opt${selectedId === option.id ? ' is-selected' : ''}" type="button" data-${kind}="${escapeHtml(option.id)}" aria-pressed="${selectedId === option.id}"><span class="bpa-ac-radio" aria-hidden="true"></span><span>${escapeHtml(option.label)}</span></button>`).join('')}</div>`;
  }

  function isSceneInputBlocked() {
    return cutscenes.active || isScenePanelOpen(uiMode) ||
      connectionStatus !== 'connected' || syncRecoveryActive ||
      !sessionStorage.getItem(introKey) ||
      Date.now() < sceneInputBlockedUntil;
  }

  function assignEvidenceToClaim(claimType: string, evidenceId: string) {
    if (uiMode.kind !== 'ACCUSATION' || !state?.accusationConfig) return;
    const accusation = uiMode.draft;
    if (!state.accusationConfig.claimTypes.includes(claimType)
      || !state.evidenceClues.some((clue) => clue.clueId === evidenceId)) return;
    for (const [claim, assignedEvidenceId] of Object.entries(accusation.evidenceLinks)) {
      if (claim !== claimType && assignedEvidenceId === evidenceId) delete accusation.evidenceLinks[claim];
    }
    accusation.evidenceLinks[claimType] = evidenceId;
    accusation.activeClaimType = state.accusationConfig.claimTypes.find((claim) => !accusation.evidenceLinks[claim]) ?? claimType;
    draw();
  }

  function syncPhaserInputState() {
    modalFocus.sync();
    if (!phaserScene) return;
    const blocked = isSceneInputBlocked();
    const cameraEnabled = isCameraMode(uiMode) && !blocked;
    phaserScene.setSceneInteractionEnabled(!blocked && !cameraEnabled);
    phaserScene.setCameraMode(cameraEnabled);
  }

  function bind() {
    app.querySelectorAll('.overlay').forEach((layer) => {
      if (layer.hasAttribute('data-events-bound')) return;
      layer.setAttribute('data-events-bound', 'true');
      ['pointerdown', 'pointerup', 'click'].forEach((eventName) => {
        layer.addEventListener(eventName, (event) => {
          if (!(event.target instanceof Element) || !event.target.closest('.modal, .dialogue-box, .conversation-box')) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
        layer.addEventListener(eventName, (event) => {
          event.stopPropagation();
        });
      });
    });
    app.querySelectorAll('.discovery-card, .final-confrontation-callout').forEach((control) => {
      ['pointerdown', 'pointerup', 'click'].forEach((eventName) => {
        control.addEventListener(eventName, (event) => event.stopPropagation());
      });
    });

    const dismissIntro = (event: Event) => {
      sessionStorage.setItem(introKey, '1');
      dismissOverlayWithShield(event.currentTarget as HTMLElement, event);
    };
    const introDismiss = app.querySelector('#intro-dismiss');
    introDismiss?.addEventListener('pointerdown', dismissIntro);
    introDismiss?.addEventListener('click', dismissIntro);
    bindMobileMovementControls();

    app.querySelectorAll('[data-inventory]').forEach((button) =>
      button.addEventListener('click', () => {
        const itemId = (button as HTMLElement).dataset.inventory;
        if (!itemId) return;
        if (combineMode) {
          if (combineSelection.has(itemId)) combineSelection.delete(itemId);
          else combineSelection.add(itemId);
          draw();
          return;
        }
        if (uiMode.kind !== 'INVENTORY') return;
        uiMode = uiMode.itemId === itemId ? { kind: 'INVENTORY' } : { kind: 'INVENTORY', itemId };
        draw();
      }));
    app.querySelector('#combine-mode-btn')?.addEventListener('click', () => {
      combineMode = !combineMode;
      if (!combineMode) combineSelection.clear();
      if (uiMode.kind === 'INVENTORY') uiMode = { kind: 'INVENTORY' };
      draw();
    });
    app.querySelector('#combine-submit-btn')?.addEventListener('click', combineItems);
    app.querySelectorAll('[data-use-inventory]').forEach((button) => button.addEventListener('click', () => {
      const itemId = (button as HTMLElement).dataset.useInventory;
      if (!itemId) return;
      selectedInventoryItemId = itemId;
      combineMode = false;
      combineSelection.clear();
      closeOverlay();
      const itemName = state?.collectedItems?.find(item => item.itemId === itemId)?.name || prettyId(itemId);
      toast(tr(`Using ${itemName}. Choose a target in the scene.`, `Đang dùng ${itemName}. Chọn đích trong cảnh.`), 'info');
      draw();
    }));

    app.querySelector('#case-file-btn')?.addEventListener('click', () => {
      const closing = uiMode.kind === 'CASE_FILE' && uiMode.section !== 'map';
      if (closing) {
        recordV3UiEvent('PrivateNotebookClosed');
        caseFileOpenedAt = null;
      } else {
        caseFileOpenedAt = performance.now();
        recordV3UiEvent('PrivateNotebookOpened');
      }
      setUiMode(closing ? { kind: 'EXPLORE' } : { kind: 'CASE_FILE', section: 'evidence' }, 'case-file-btn');
    });
    app.querySelectorAll('[data-case-tab]').forEach((button) => button.addEventListener('click', () => {
      const tab = (button as HTMLElement).dataset.caseTab as CaseFileSection;
      setUiMode({ kind: 'CASE_FILE', section: tab });
    }));
    app.querySelectorAll('[data-case-goto]').forEach((button) => button.addEventListener('click', () => {
      const section = (button as HTMLElement).dataset.caseGoto as CaseFileSection;
      if (section) setUiMode({ kind: 'CASE_FILE', section });
    }));
    app.querySelector('#case-file-accuse-btn')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLElement;
      if (button.getAttribute('aria-disabled') === 'true') {
        if (button.dataset.reason) toast(button.dataset.reason, 'info', 4500);
        return;
      }
      // A standing proposal is read in the consensus sheet; drafting a rival one would only be refused.
      if (state!.activeAccusation) {
        setUiMode({ kind: 'EXPLORE' }, 'case-file-btn');
        return;
      }
      amendedAccusation = null;
      setUiMode({ kind: 'ACCUSATION', draft: { step: 1, culpritId: null, motiveId: null, methodId: null, evidenceIds: new Set(), evidenceLinks: {}, activeClaimType: null } }, 'case-file-btn');
    });
    app.querySelectorAll('[data-v3-start-testimony]').forEach((button) => button.addEventListener('click', () => {
      recordV3UiEvent('ProposalSelectionDwell', undefined, caseFileOpenedAt === null ? undefined : performance.now() - caseFileOpenedAt);
      void startPairedConfrontation((button as HTMLElement).dataset.v3StartTestimony ?? '');
    }));
    app.querySelectorAll('[data-v3-edit-testimony]').forEach((button) => button.addEventListener('click', () => {
      recordV3UiEvent('ProposalSelectionDwell', undefined, caseFileOpenedAt === null ? undefined : performance.now() - caseFileOpenedAt);
      void editPairedTestimony((button as HTMLElement).dataset.v3EditTestimony ?? '');
    }));
    app.querySelectorAll('[data-v3-propose-evidence]').forEach((button) => button.addEventListener('click', () => {
      recordV3UiEvent('ProposalSelectionDwell', undefined, caseFileOpenedAt === null ? undefined : performance.now() - caseFileOpenedAt);
      void submitPairedEvidence((button as HTMLElement).dataset.v3ProposeEvidence ?? '');
    }));
    app.querySelector('[data-v3-confirm]')?.addEventListener('click', () => void confirmPairedConfrontation());
    app.querySelectorAll('[data-v3-cancel]').forEach((button) => button.addEventListener('click', () => void cancelPairedConfrontation()));
    app.querySelector('#v3-crack-dismiss')?.addEventListener('click', () => {
      dismissCrackPayoff();
    });
    app.querySelector('#v3-complete-review')?.addEventListener('click', () => {
      caseCompleteDismissed = true;
      setUiMode({ kind: 'CASE_FILE', section: 'contradictions' }, 'case-file-btn');
    });
    app.querySelectorAll('[data-evidence-detail]').forEach((button) => button.addEventListener('click', () => {
      const clueId = (button as HTMLElement).dataset.evidenceDetail;
      if (clueId) setUiMode({ kind: 'CASE_FILE', section: 'evidence', clueId });
    }));
    app.querySelector('#evidence-detail-back')?.addEventListener('click', () => {
      setUiMode({ kind: 'CASE_FILE', section: 'evidence' });
    });
    app.querySelector('#hint-btn')?.addEventListener('click', () => requestHint('SCENE', state!.currentSceneId));
    app.querySelector('#floating-camera-btn')?.addEventListener('click', toggleCameraMode);
    app.querySelector('#floating-bag-btn')?.addEventListener('click', () => {
      setUiMode(uiMode.kind === 'INVENTORY' ? { kind: 'EXPLORE' } : { kind: 'INVENTORY' }, 'floating-bag-btn');
    });
    app.querySelectorAll('.close-drawer-btn').forEach((button) => button.addEventListener('click', closeUiMode));
    app.querySelector('#inventory-detail-close')?.addEventListener('click', () => setUiMode({ kind: 'INVENTORY' }));
    app.querySelector('#map-case-file-btn')?.addEventListener('click', () => setUiMode({ kind: 'CASE_FILE', section: 'evidence' }));
    app.querySelector('#map-btn')?.addEventListener('click', () => setUiMode(
      uiMode.kind === 'CASE_FILE' && uiMode.section === 'map' ? { kind: 'EXPLORE' } : { kind: 'CASE_FILE', section: 'map' },
      'map-btn',
    ));
    app.querySelector('#accuse-btn')?.addEventListener('click', () => {
      // A standing proposal owns the accusation; drafting a rival one would only be refused.
      if (state!.activeAccusation) {
        setUiMode({ kind: 'EXPLORE' }, 'accuse-btn');
        return;
      }
      amendedAccusation = null;
      setUiMode({ kind: 'ACCUSATION', draft: { step: 1, culpritId: null, motiveId: null, methodId: null, evidenceIds: new Set(), evidenceLinks: {}, activeClaimType: null } }, 'accuse-btn');
    });
    app.querySelector('#discovery-case-file-btn')?.addEventListener('click', () => {
      discoveryNotice = null;
      setUiMode({ kind: 'CASE_FILE', section: 'evidence' }, 'discovery-case-file-btn');
    });
    app.querySelector('#discovery-dismiss-btn')?.addEventListener('click', () => {
      discoveryNotice = null;
      draw();
    });

    app.querySelectorAll('[data-scene]').forEach((s) =>
      s.addEventListener('click', async () => {
        const sceneId = (s as HTMLElement).dataset.scene;
        if (sceneId) await goToScene(sceneId);
      }));

    app.querySelectorAll('[data-close-overlay]').forEach((button) => {
      const dismiss = (event: Event) => {
        closeOverlay();
        app.querySelectorAll('.inventory-item.is-selected').forEach((item) => item.classList.remove('is-selected'));
        dismissOverlayWithShield(button as HTMLElement, event);
      };
      button.addEventListener('pointerdown', dismiss);
      button.addEventListener('click', dismiss);
    });

    app.querySelectorAll('[data-dialogue]').forEach((button) =>
      { if (button.hasAttribute('data-events-bound')) return; button.setAttribute('data-events-bound', 'true'); button.addEventListener('click', async () => {
        if (myRole() !== 'INTERROGATOR') {
          toast(tr('Only the Interrogator can ask questions.', 'Chỉ Thẩm vấn viên có thể đặt câu hỏi.'), 'info');
          return;
        }
        const askButton = button as HTMLButtonElement;
        if (askButton.dataset.asking === '1') return; // guard against double-clicks
        askButton.dataset.asking = '1';
        try {
          const dialogueId = askButton.dataset.dialogue;
          clearNewDialogue(dialogueId);
          const res = await gameApi.askDialogue(roomId, dialogueId);
          if (stopped) return;
          recordGuideAction('ask');
          audio.play('dialogue');
          if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
          applyState(res.state); // log rebuilds deterministically from state
        } catch (err: any) {
          toast(err.message, 'error');
        }
      }); });

    app.querySelectorAll('[data-converse-choice]').forEach((button) => { if (button.hasAttribute('data-events-bound')) return; button.setAttribute('data-events-bound', 'true'); button.addEventListener('click', async () => {
      if (myRole() !== 'INTERROGATOR') {
        toast(tr('Only the Interrogator can ask questions.', 'Chỉ Thẩm vấn viên có thể đặt câu hỏi.'), 'info');
        return;
      }
      const target = button as HTMLElement;
      await chooseConversation(target.dataset.converseNode ?? '', target.dataset.converseChoice ?? '');
    }); });

    app.querySelectorAll('[data-present-challenge]').forEach((button) => { if (button.hasAttribute('data-events-bound')) return; button.setAttribute('data-events-bound', 'true'); button.addEventListener('click', async () => {
      const target = button as HTMLElement;
      await presentEvidence(target.dataset.presentChallenge ?? '', target.dataset.presentEvidence ?? '');
    }); });
    app.querySelectorAll('[data-challenge-hint]').forEach((button) => { if (button.hasAttribute('data-events-bound')) return; button.setAttribute('data-events-bound', 'true'); button.addEventListener('click', async () => {
      await requestHint('CONFRONTATION', (button as HTMLElement).dataset.challengeHint ?? '');
    }); });
    app.querySelectorAll('[data-deduction-hint]').forEach((button) => button.addEventListener('click', async () => {
      await requestHint('DEDUCTION', (button as HTMLElement).dataset.deductionHint ?? '');
    }));
    app.querySelectorAll('[data-solve-deduction]').forEach((button) => button.addEventListener('click', async () => {
      const target = button as HTMLElement;
      await solveDeduction(target.dataset.solveDeduction ?? '', target.dataset.option ?? '');
    }));
    app.querySelectorAll('[data-puzzle-option]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'PUZZLE' || uiMode.view !== 'SOLVE') return;
      const puzzleId = uiMode.puzzleId;
      const puzzle = state!.visibleScene.puzzles.find((candidate) => candidate.puzzleId === puzzleId);
      if (!puzzle) return;
      const option = (button as HTMLElement).dataset.puzzleOption;
      if (!option) return;
      const draft = puzzleDrafts.get(puzzle.puzzleId) ?? [];
      if (draft.length < Math.max(1, puzzle.answerLength || 1)) draft.push(option);
      puzzleDrafts.set(puzzle.puzzleId, draft);
      draw();
    }));
    app.querySelector('#puzzle-clear-btn')?.addEventListener('click', () => {
      if (uiMode.kind === 'PUZZLE' && uiMode.view === 'SOLVE') puzzleDrafts.delete(uiMode.puzzleId);
      draw();
    });
    app.querySelector('#puzzle-submit-btn')?.addEventListener('click', solveOpenPuzzle);

    app.querySelectorAll('[data-suspect]').forEach((button) =>
      button.addEventListener('click', () => {
        if (uiMode.kind !== 'ACCUSATION') return;
        const accusation = uiMode.draft;
        accusation.culpritId = (button as HTMLElement).dataset.suspect ?? null;
        if (accusation.step < 5 && state!.accusationConfig && state!.mechanicsVersion >= 2) accusation.step = 1;
        draw();
      }));
    app.querySelectorAll('[data-motive]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const accusation = uiMode.draft;
      accusation.motiveId = (button as HTMLElement).dataset.motive ?? null;
      accusation.step = 2;
      draw();
    }));
    app.querySelectorAll('[data-method]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const accusation = uiMode.draft;
      accusation.methodId = (button as HTMLElement).dataset.method ?? null;
      accusation.step = 3;
      draw();
    }));
    app.querySelectorAll('[data-claim-slot]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      uiMode.draft.activeClaimType = (button as HTMLElement).dataset.claimSlot ?? null;
      uiMode.draft.step = 4;
      draw();
    }));
    app.querySelectorAll('[data-clear-claim]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const claim = (button as HTMLElement).dataset.clearClaim;
      if (!claim) return;
      delete uiMode.draft.evidenceLinks[claim];
      uiMode.draft.activeClaimType = claim;
      uiMode.draft.step = 4;
      draw();
    }));
    app.querySelectorAll('[data-assign-evidence]').forEach((button) => {
      button.addEventListener('click', () => {
        if (uiMode.kind !== 'ACCUSATION' || !state?.accusationConfig) return;
        const evidenceId = (button as HTMLElement).dataset.assignEvidence;
        const draft = uiMode.draft;
        const claim = draft.activeClaimType
          ?? state.accusationConfig.claimTypes.find((candidate) => !draft.evidenceLinks[candidate])
          ?? state.accusationConfig.claimTypes[0];
        draft.step = 4;
        if (evidenceId && claim) assignEvidenceToClaim(claim, evidenceId);
      });
      button.addEventListener('dragstart', (event) => {
        const evidenceId = (button as HTMLElement).dataset.assignEvidence;
        if (evidenceId && event instanceof DragEvent) event.dataTransfer?.setData('text/plain', evidenceId);
      });
    });
    app.querySelectorAll('[data-claim-drop]').forEach((slot) => {
      slot.addEventListener('dragover', (event) => {
        event.preventDefault();
        slot.classList.add('is-drag-over');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('is-drag-over'));
      slot.addEventListener('drop', (event) => {
        event.preventDefault();
        slot.classList.remove('is-drag-over');
        if (!(event instanceof DragEvent)) return;
        const claim = (slot as HTMLElement).dataset.claimDrop;
        const evidenceId = event.dataTransfer?.getData('text/plain');
        if (uiMode.kind === 'ACCUSATION') uiMode.draft.step = 4;
        if (claim && evidenceId) assignEvidenceToClaim(claim, evidenceId);
      });
    });
    app.querySelectorAll('[data-evidence]').forEach((box) =>
      box.addEventListener('change', () => {
        if (uiMode.kind !== 'ACCUSATION') return;
        const accusation = uiMode.draft;
        const input = box as HTMLInputElement;
        const evidenceId = input.dataset.evidence;
        if (!evidenceId) return;
        if (input.checked) accusation.evidenceIds.add(evidenceId);
        else accusation.evidenceIds.delete(evidenceId);
      }));
    const putAccusationAway = (event: Event) => {
      amendedAccusation = null;
      uiMode = { kind: 'EXPLORE' };
      dismissOverlayWithShield(event.currentTarget as HTMLElement, event);
    };
    app.querySelectorAll('#accuse-cancel, [data-accuse-close]').forEach((button) => {
      button.addEventListener('pointerdown', putAccusationAway);
      button.addEventListener('click', putAccusationAway);
    });
    app.querySelectorAll('[data-accuse-step]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const draft = uiMode.draft;
      const step = Number((button as HTMLElement).dataset.accuseStep);
      if (!step) return;
      draft.step = step;
      if (step === 4 && !draft.activeClaimType) {
        const claimTypes = state!.accusationConfig?.claimTypes ?? [];
        draft.activeClaimType = claimTypes.find((claim) => !draft.evidenceLinks[claim]) ?? claimTypes[0] ?? null;
      }
      draw();
    }));
    app.querySelector('#accuse-review')?.addEventListener('click', () => { if (uiMode.kind === 'ACCUSATION') uiMode.draft.step = 2; draw(); });
    app.querySelector('#accuse-next')?.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const draft = uiMode.draft;
      draft.step++;
      if (draft.step === 4) {
        const claimTypes = state!.accusationConfig?.claimTypes ?? [];
        draft.activeClaimType = claimTypes.find((claim) => !draft.evidenceLinks[claim]) ?? claimTypes[0] ?? null;
      }
      draw();
    });
    app.querySelector('#accuse-back')?.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const accusation = uiMode.draft;
      accusation.step = state!.mechanicsVersion >= 2 ? Math.max(1, accusation.step - 1) : 1;
      draw();
    });
    app.querySelector('#accuse-confirm')?.addEventListener('click', submitAccusation);

    app.querySelector('#accusation-confirm')?.addEventListener('click', () => {
      const proposal = state!.activeAccusation;
      if (!proposal) return;
      runAccusationCommand(() => gameApi.confirmAccusation(roomId, proposal.attemptId, {
        expectedRevision: proposal.revision,
      }));
    });
    app.querySelector('#accusation-cancel')?.addEventListener('click', () => {
      const proposal = state!.activeAccusation;
      if (!proposal) return;
      runAccusationCommand(() => gameApi.cancelAccusation(roomId, proposal.attemptId, {
        expectedRevision: proposal.revision,
      }));
    });
    app.querySelector('#accusation-amend')?.addEventListener('click', openAccusationAmendment);
    app.querySelector('#accusation-review')?.addEventListener('click', () => {
      if (!state!.activeAccusation) return;
      acknowledgedAccusationKey = accusationRevisionKey(state!.activeAccusation);
      draw();
    });
  }

  function bindMobileMovementControls() {
    app.querySelectorAll<HTMLElement>('[data-mobile-move]').forEach((button) => {
      const value = Number(button.dataset.mobileMove ?? '0');
      const start = (event: Event) => {
        event.preventDefault();
        if (isSceneInputBlocked()) return;
        phaserScene?.setMobileMoveX(value);
      };
      const stop = (event: Event) => {
        event.preventDefault();
        phaserScene?.setMobileMoveX(0);
      };
      button.addEventListener('pointerdown', start);
      button.addEventListener('pointerup', stop);
      button.addEventListener('pointercancel', stop);
      button.addEventListener('pointerleave', stop);
    });

    app.querySelector('#mobile-interact-btn')?.addEventListener('click', (event) => {
      event.preventDefault();
      if (isSceneInputBlocked()) return;
      phaserScene?.triggerPrimaryInteraction();
    });

    app.querySelector('#mobile-camera-btn')?.addEventListener('click', (event) => {
      event.preventDefault();
      toggleCameraMode();
    });

    app.querySelector('#mobile-inventory-btn')?.addEventListener('click', (event) => {
      event.preventDefault();
      setUiMode(uiMode.kind === 'INVENTORY' ? { kind: 'EXPLORE' } : { kind: 'INVENTORY' }, 'mobile-inventory-btn');
    });
  }

  function toggleCameraMode() {
    if (myRole() !== 'INVESTIGATOR') {
      toast(tr('Only the Investigator can capture scene clues.', 'Chỉ Điều tra viên có thể chụp manh mối hiện trường.'), 'info');
      return;
    }
    setUiMode(uiMode.kind === 'CAMERA' ? { kind: 'EXPLORE' } : { kind: 'CAMERA' }, 'floating-camera-btn');
  }

  function dismissOverlayWithShield(control: HTMLElement, event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const layer = control.closest('.overlay') as HTMLElement | null;
    if (!layer || layer.dataset.dismissing === 'true') return;
    layer.dataset.dismissing = 'true';
    layer.classList.add('is-closing-shield');

    sceneInputBlockedUntil = Date.now() + 800;
    syncPhaserInputState();

    let finished = false;
    let fallbackTimer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      sceneInputBlockedUntil = Date.now() + 140;
      window.setTimeout(() => {
        layer.remove();
        sceneInputBlockedUntil = 0;
        syncPhaserInputState();
      }, 150);
    };

    if (event.type === 'pointerdown') {
      window.addEventListener('pointerup', finish, { capture: true, once: true });
      window.addEventListener('pointercancel', finish, { capture: true, once: true });
      fallbackTimer = window.setTimeout(finish, 800);
    } else {
      finish();
    }
  }

  async function onHotspot({ type, target, locked, label }: HotspotClick) {
    if (isSceneInputBlocked()) return;

    if (selectedInventoryItemId) {
      await useSelectedItemOnTarget(target);
      return;
    }

    if (type === 'CHARACTER') {
      if (myRole() !== 'INTERROGATOR') {
        toast(tr('Your Interrogator partner handles witness questioning.', 'Đồng đội Thẩm vấn viên phụ trách hỏi nhân chứng.'), 'info');
        return;
      }
      markCharacterDialoguesVisible(target);
      if (isTreeCharacter(target) && myRole() === 'INTERROGATOR') {
        openConversation(target);
        return;
      }
      setUiMode({ kind: 'DIALOGUE', characterId: target });
      return;
    }

    if (locked === 'true') {
      toast(tr('This interaction needs another lead. Compare notes with your partner.', 'Tương tác này cần thêm manh mối. Hãy đối chiếu với đồng đội.'), 'info', 4200);
      return;
    }

    // A locked puzzle must not swallow the click: the target often has to be
    // inspected/collected first (which is what unlocks the puzzle later on).
    const puzzle = state!.visibleScene.puzzles?.find((candidate) => candidate.targetId === target && !candidate.isSolved && !candidate.isLocked);
    if (puzzle) {
      if (myRole() !== 'INVESTIGATOR') {
        toast(tr('Only the Investigator can operate scene puzzles.', 'Chỉ Điều tra viên có thể giải câu đố hiện trường.'), 'info');
        return;
      }
      setUiMode({ kind: 'PUZZLE', view: 'SOLVE', puzzleId: puzzle.puzzleId });
      return;
    }

    if (type !== 'ITEM' && type !== 'OBJECT' && type !== 'CLUE' && type !== 'ENVIRONMENT') {
      toast(tr('This point is waiting for a case-specific interaction.', 'Điểm này đang chờ một tương tác riêng của vụ án.'), 'info');
      return;
    }

    if (myRole() !== 'INVESTIGATOR') {
      toast(tr('Only the Investigator can inspect objects. Tell your partner to check it.', 'Chỉ Điều tra viên có thể khám nghiệm vật thể. Hãy nhờ đồng đội kiểm tra.'), 'info');
      draw();
      return;
    }

    if (type === 'ENVIRONMENT') {
      try {
        const res = await gameApi.activateEnvironmentInteraction(roomId, target);
        showDiscovery({
          id: `environment:${target}:${Date.now()}`,
          kind: 'CLUE',
          title: label || prettyId(target),
          detail: res.message || tr('A useful environmental detail was uncovered.', 'Một chi tiết hiện trường hữu ích đã được phát hiện.'),
          clueCount: res.unlockedClueIds?.length ?? 0,
        });
        applyState(res.state);
      } catch (err: any) {
        toast(err.message, 'error');
      }
      return;
    }

    try {
      const item = state!.visibleScene.items.find((candidate) => candidate.itemId === target);
      const res = await gameApi.inspectItem(roomId, target);
      if (stopped) return;
      recordGuideAction('inspect');
      showDiscovery({
        id: `item:${target}:${Date.now()}`,
        kind: 'ITEM',
        title: item?.name || prettyId(target),
        detail: res.detail || item?.inspectText || item?.description || tr('The object has been examined.', 'Vật thể đã được khám nghiệm.'),
        imageUrl: item?.imageUrl,
        clueCount: res.unlockedClueIds?.length ?? 0,
      });
      applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function useSelectedItemOnTarget(targetId: string) {
    if (!selectedInventoryItemId) return;
    if (myRole() !== 'INVESTIGATOR') {
      toast(tr('Only the Investigator can use inventory items.', 'Chỉ Điều tra viên có thể dùng đồ trong túi.'), 'info');
      selectedInventoryItemId = null;
      draw();
      return;
    }

    const itemId = selectedInventoryItemId;
    selectedInventoryItemId = null;
    try {
      const res = await gameApi.useItem(roomId, itemId, targetId);
      toast(res.detail || res.message || tr('Item used.', 'Đã dùng vật phẩm.'), res.changed ? 'success' : 'info', 4800);
      applyState(res.state);
    } catch (err: any) {
      toast(err.message || tr('That item does not work here.', 'Không thể dùng vật phẩm đó ở đây.'), 'error');
      draw();
    }
  }

  async function combineItems() {
    const itemIds = [...combineSelection];
    if (itemIds.length < 2) return;
    if (myRole() !== 'INVESTIGATOR') {
      toast(tr('Only the Investigator can combine inventory items.', 'Chỉ Điều tra viên có thể kết hợp vật phẩm.'), 'info');
      return;
    }

    try {
      const res = await gameApi.combineItems(roomId, itemIds);
      toast(res.detail || res.message || tr('Items combined.', 'Đã kết hợp vật phẩm.'), res.changed ? 'success' : 'info', 4800);
      combineSelection.clear();
      combineMode = false;
      applyState(res.state);
    } catch (err: any) {
      toast(err.message || tr('Those items do not combine.', 'Không thể kết hợp các vật phẩm đó.'), 'error');
    }
  }

  async function solveOpenPuzzle() {
    if (uiMode.kind !== 'PUZZLE' || uiMode.view !== 'SOLVE') return;
    const puzzleId = uiMode.puzzleId;
    const puzzle = state!.visibleScene.puzzles.find((candidate) => candidate.puzzleId === puzzleId);
    if (!puzzle || puzzle.isLocked || puzzle.isSolved) return;

    const input = app.querySelector<HTMLInputElement>('#puzzle-code-answer');
    const answer = puzzle.type === 'CODE_PUZZLE' ? input?.value?.trim() ?? '' : '';
    const answerSequence = puzzle.type === 'CODE_PUZZLE' ? [] : (puzzleDrafts.get(puzzle.puzzleId) ?? []);
    try {
      const res = await gameApi.solvePuzzle(roomId, puzzle.puzzleId, answer, answerSequence);
      const solved = Boolean(res.state?.solvedPuzzleIds?.includes(puzzle.puzzleId));
      toast(res.detail || res.message || 'Puzzle checked.', solved ? 'success' : 'info', 5200);
      if (solved) {
        puzzleDrafts.delete(puzzle.puzzleId);
        closeOverlay();
      }
      applyState(res.state);
    } catch (err: any) {
      toast(err.message || 'Puzzle answer failed.', 'error');
    }
  }

  async function captureClue(captureRect: RuntimeBox, photo: Blob) {
    if (!state || captureInFlight || uiMode.kind !== 'CAMERA' || isSceneInputBlocked()) return;
    if (myRole() !== 'INVESTIGATOR') {
      toast(tr('Only the Investigator can capture scene clues.', 'Chỉ Điều tra viên có thể chụp manh mối hiện trường.'), 'info');
      return;
    }

    captureInFlight = true;
    flashCamera();
    app.querySelector('#bpa-g-shutter')?.setAttribute('disabled', '');
    const shotNumber = ++cameraShots;
    const shotTime = clockText((Date.now() - clockStartedAt) / 1000);
    // Camera feedback is shown in the interface language even when the server answers in English.
    const say = (serverMessage: string | undefined, english: string, vietnamese: string) =>
      uiLanguage() === 'vi' ? vietnamese : serverMessage || english;
    try {
      const res = await gameApi.captureClue(roomId, state.currentSceneId, captureRect, photo);
      const result = String(res.captureResult || '').toUpperCase();
      if (stopped) return;
      if (result === 'HIT') {
        recordGuideAction('photo');
        const clueId = res.matchedClueId || res.unlockedClueIds?.[0] || '';
        const clue = res.state?.unlockedClues?.find((candidate: Clue) => candidate.clueId === clueId)
          ?? state.unlockedClues.find((candidate) => candidate.clueId === clueId);
        uiMode = { kind: 'EXPLORE' };
        showDiscovery({
          id: `photo:${clueId || Date.now()}`,
          kind: 'PHOTO',
          title: clue?.title || tr('Photographic evidence', 'Chứng cứ ảnh'),
          detail: res.detail || res.message || tr('Photo evidence added to the case file.', 'Chứng cứ ảnh đã được thêm vào hồ sơ.'),
          imageUrl: URL.createObjectURL(photo),
          clueCount: res.unlockedClueIds?.length ?? 1,
        });
        toast(say(res.message, 'Photo evidence captured.', 'Đã chụp chứng cứ.'), 'success');
        applyState(res.state);
        return;
      }

      if (result === 'NEAR_MISS') {
        toast(say(res.message, 'Close, but the clue is not framed clearly enough.', 'Có gì đó đáng chú ý ở đây. Hãy căn khung kỹ hơn.'), 'info', 3600);
      } else {
        cameraMisses += 1;
        try { sessionStorage.setItem(cameraMissKey, String(cameraMisses)); } catch { /* the count stays in memory */ }
        toast(say(res.message, 'Nothing noteworthy in that frame.', 'Không phát hiện chi tiết quan trọng nào.'), 'info', 3200);
      }
      showCameraPrint(photo, result === 'NEAR_MISS' ? 'NEAR_MISS' : 'MISS', `${tr('Photo', 'Ảnh')} ${String(shotNumber).padStart(2, '0')} · ${shotTime}`);
      captureInFlight = false;
      if (res.state) applyState(res.state);
      else draw();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      captureInFlight = false;
      app.querySelector('#bpa-g-shutter')?.removeAttribute('disabled');
    }
  }

  // ----- Conversation tree (Phase C) -----

  async function openConversation(characterId: string) {
    try {
      const res: ConverseResponse = await gameApi.converse(roomId, { characterId });
      convTreeNodeId = res.node.nodeId;
      convTreeChoices = res.choices;
      convTreeChallenge = res.challenge ?? null;
      uiMode = { kind: 'DIALOGUE', characterId };
      applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  // Re-fetch the current node (no choice) so its choices reflect freshly-unlocked gates.
  async function refreshConverseNode(characterId: string, nodeId: string) {
    try {
      const res: ConverseResponse = await gameApi.converse(roomId, { characterId, nodeId });
      convTreeNodeId = res.node.nodeId;
      convTreeChoices = res.choices;
      convTreeChallenge = res.challenge ?? null;
      applyState(res.state);
    } catch {
      /* keep the existing view */
    }
  }

  async function refreshConverseDefaultNode(characterId: string) {
    try {
      const res: ConverseResponse = await gameApi.converse(roomId, { characterId });
      convTreeNodeId = res.node.nodeId;
      convTreeChoices = res.choices;
      convTreeChallenge = res.challenge ?? null;
      applyState(res.state);
    } catch {
      /* keep the existing view */
    }
  }

  async function chooseConversation(nodeId: string, choiceId: string) {
    if (!nodeId || !choiceId || convTreeBusy) return;
    const characterId = uiMode.kind === 'DIALOGUE' ? uiMode.characterId : convCharacterId;
    if (!characterId) return;
    convTreeBusy = true;
    try {
      const res: ConverseResponse = await gameApi.converse(roomId, { characterId, nodeId, choiceId });
      if (stopped) return;
      recordGuideAction('ask');
      convTreeNodeId = res.node.nodeId;
      convTreeChoices = res.choices;
      convTreeChallenge = res.challenge ?? null;
      clearTreeCue(characterId, choiceId);
      applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      convTreeBusy = false;
    }
  }

  async function presentEvidence(challengeId: string, evidenceId: string) {
    if (!challengeId || !evidenceId) return;
    try {
      const res = await gameApi.presentEvidence(roomId, { challengeId, evidenceId, dialogueId: '' });
      // On success the resolved-confrontation response is rebuilt into the log from
      // state; toast gives transient feedback (and surfaces failure responses).
      toast(res.detail || res.message, res.changed && res.unlockedClueIds?.length ? 'success' : 'info', 5000);
      applyState(res.state);
      // In tree mode a resolved challenge may open gated follow-ups; refresh the node's choices.
      if (uiMode.kind === 'DIALOGUE' && isTreeCharacter(uiMode.characterId) && convTreeNodeId) {
        await refreshConverseNode(uiMode.characterId, convTreeNodeId);
      }
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function runPairedCommand(command: () => Promise<any>, openJointReview = true, contributes = false) {
    if (pairedCommandInFlight) return;
    pairedCommandInFlight = true;
    try {
      const response = await command();
      if (stopped) return;
      if (contributes) recordGuideAction('compare');
      applyState(response.state);
      if (openJointReview) {
        setUiMode({ kind: 'CASE_FILE', section: 'contradictions' });
        recordV3UiEvent('ConfrontationOverlayOpened', response.state?.activeConfrontation);
      }
    } catch (err: any) {
      if (err.errors?.code === 'CONFRONTATION_STALE') queueStateRefetch();
      toast(err.message || tr('The confrontation command failed.', 'Lệnh đối chất thất bại.'), 'error');
    } finally {
      pairedCommandInFlight = false;
    }
  }

  async function startPairedConfrontation(testimonyFragmentId: string) {
    if (!testimonyFragmentId || myRole() !== 'INTERROGATOR') return;
    await runPairedCommand(() => gameApi.startPairedConfrontation(roomId, {
      attemptId: crypto.randomUUID(),
      testimonyFragmentId,
    }), true, true);
  }

  async function editPairedTestimony(testimonyFragmentId: string) {
    const active = state?.activeConfrontation;
    if (!active || !testimonyFragmentId || myRole() !== 'INTERROGATOR') return;
    await runPairedCommand(() => gameApi.editPairedTestimony(roomId, active.attemptId, {
      testimonyFragmentId,
      expectedRevision: active.revision,
    }), true, true);
  }

  async function submitPairedEvidence(evidenceId: string) {
    const active = state?.activeConfrontation;
    if (!active || !evidenceId || myRole() !== 'INVESTIGATOR') return;
    await runPairedCommand(() => gameApi.submitPairedEvidence(roomId, active.attemptId, {
      evidenceId,
      expectedRevision: active.revision,
    }), true, true);
  }

  async function confirmPairedConfrontation() {
    const active = state?.activeConfrontation;
    if (!active?.canConfirm) return;
    await runPairedCommand(() => gameApi.confirmPairedConfrontation(roomId, active.attemptId, {
      expectedRevision: active.revision,
    }));
  }

  async function cancelPairedConfrontation() {
    const active = state?.activeConfrontation;
    if (!active?.canCancel) return;
    if (!window.confirm(tr('Cancel this confrontation attempt? There is no penalty.', 'Hủy lượt đối chất này? Sẽ không có hình phạt.'))) return;
    await runPairedCommand(() => gameApi.cancelPairedConfrontation(roomId, active.attemptId, {
      expectedRevision: active.revision,
    }));
  }

  async function solveDeduction(deductionId: string, optionId: string) {
    if (!deductionId || !optionId) return;
    try {
      const res = await gameApi.solveDeduction(roomId, deductionId, optionId);
      toast(res.detail || res.message, res.changed && res.unlockedClueIds?.length ? 'success' : 'info', 5000);
      applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function requestHint(contextType: 'SCENE' | 'CONFRONTATION' | 'DEDUCTION', targetId: string) {
    if (!targetId) return;
    try {
      const res = await gameApi.hint(roomId, contextType, targetId);
      toast(res.message, 'info', 6500);
      if (res.state) applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function completeScene() {
    if (!state?.currentSceneCanComplete) {
      toast(tr('You do not have enough grounds to leave this location yet. Request a hint if you are stuck.', 'Chưa đủ cơ sở để rời địa điểm này. Hãy xem gợi ý nếu đang bị kẹt.'), 'info', 4200);
      return;
    }

    try {
      // The server chooses the immediate authored successor and moves only this player.
      const res = await gameApi.completeScene(roomId);
      closeOverlay();
      applyState(res.state);
      toast(res.message, 'success', 5500);
    } catch (err: any) {
      const missing = err.errors?.missing;
      if (missing) {
        toast(tr('An important trace or statement still needs to be verified.', 'Vẫn còn dấu vết hoặc lời khai quan trọng cần xác minh.'), 'error', 5500);
      } else {
        toast(err.message, 'error');
      }
      draw();
    }
  }

  async function goToScene(sceneId: string) {
    try {
      const res = await gameApi.goToScene(roomId, sceneId);
      closeOverlay();
      applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function submitAccusation(event: Event) {
    if (uiMode.kind !== 'ACCUSATION') return;
    const accusation = uiMode.draft;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    const payload = state!.mechanicsVersion >= 2
      ? {
          culpritId: accusation.culpritId,
          motiveId: accusation.motiveId,
          methodId: accusation.methodId,
          evidenceLinks: Object.entries(accusation.evidenceLinks).map(([claimType, evidenceId]) => ({ claimType, evidenceId })),
          evidenceIds: [],
        }
      : { culpritId: accusation.culpritId, motive: '', method: '', evidenceIds: [...accusation.evidenceIds], evidenceLinks: [] };
    const amend = amendedAccusation;
    try {
      if (amend) {
        await applyAccusationCommand(gameApi.amendAccusation(roomId, amend.attemptId, {
          ...payload,
          expectedRevision: amend.expectedRevision,
        }));
        return;
      }
      if (state!.mechanicsVersion >= 3) {
        await applyAccusationCommand(gameApi.proposeAccusation(roomId, payload));
        return;
      }
      await finishUnilateralAccusation(payload);
    } catch (err: any) {
      // The server decides whether this case needs consensus; follow it rather than guessing.
      // Both directions must be recoverable, because Accusation__RequireConsensus can force either
      // behaviour on any mechanics version and the version guess above is only a first attempt.
      const code = err?.errors?.code;
      if (code === 'ACCUSATION_CONSENSUS_REQUIRED' || code === 'ACCUSATION_CONSENSUS_NOT_REQUIRED') {
        try {
          if (code === 'ACCUSATION_CONSENSUS_REQUIRED') {
            await applyAccusationCommand(gameApi.proposeAccusation(roomId, payload));
          } else {
            await finishUnilateralAccusation(payload);
          }
          return;
        } catch (routedErr: any) {
          toast(routedErr.message, 'error');
        }
      } else {
        toast(err.message, 'error');
      }
      amendedAccusation = null;
      uiMode = { kind: 'EXPLORE' };
      draw();
    }
  }

  async function finishUnilateralAccusation(payload: unknown) {
    const result = await gameApi.accuse(roomId, payload);
    sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
    window.location.hash = `#/result/${roomId}`;
  }

  // Every consensus command answers with the authoritative state, so the client never patches its own.
  async function applyAccusationCommand(command: Promise<any>) {
    const response = await command;
    amendedAccusation = null;
    uiMode = { kind: 'EXPLORE' };
    if (response?.accusation) acknowledgedAccusationKey = accusationRevisionKey(response.accusation);
    if (response?.result) {
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(response.result));
      // Both detectives agreed: stamp the sheet they just read before the result page takes over.
      const filed = response.accusation ?? state?.activeAccusation ?? null;
      if (filed && !stopped && state?.activeAccusation) {
        filedAccusation = filed;
        draw();
        const pause = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 900 : 1700;
        await new Promise((resolve) => window.setTimeout(resolve, pause));
        filedAccusation = null;
      }
    }
    applyState(response.state);
  }

  async function runAccusationCommand(command: () => Promise<any>) {
    if (accusationCommandInFlight) return;
    accusationCommandInFlight = true;
    try {
      await applyAccusationCommand(command());
    } catch (err: any) {
      toast(err.message, 'error');
      // A stale revision means the partner edited it; the refetched state carries the new one.
      queueStateRefetch();
    } finally {
      accusationCommandInFlight = false;
    }
  }

  function openAccusationAmendment() {
    const proposal = state!.activeAccusation;
    if (!proposal) return;
    amendedAccusation = { attemptId: proposal.attemptId, expectedRevision: proposal.revision };
    setUiMode({
      kind: 'ACCUSATION',
      draft: {
        step: 1,
        culpritId: proposal.culpritId,
        motiveId: proposal.motiveId ?? null,
        methodId: proposal.methodId ?? null,
        evidenceIds: new Set(proposal.evidenceIds ?? []),
        // Claims backed by evidence this player cannot see start empty; they must cite their own.
        evidenceLinks: Object.fromEntries((proposal.evidenceLinks ?? [])
          .filter((link) => Boolean(link.evidenceId))
          .map((link) => [link.claimType, link.evidenceId as string])),
        activeClaimType: null,
      },
    }, 'accusation-amend');
  }

  function prettyId(id: string) {
    return String(id ?? '')
      .replace(/^(item|clue|char|dlg|scene|hotspot)-/i, '')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function cleanupGamePage() {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener('abort', cleanupGamePage);
    stateRefetcher.dispose();
    audio.dispose();
    modalFocus.dispose();
    disposeAudioControls?.();
    disposePingControls?.();
    if (partnerPingTimer) clearTimeout(partnerPingTimer);
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    dialoguePresenter.dispose();
    cutscenes.dispose();
    if (crackPayoffTimer) { clearTimeout(crackPayoffTimer); crackPayoffTimer = null; }
    if (discoveryTimer) clearTimeout(discoveryTimer);
    if (partnerActivityTimer) clearTimeout(partnerActivityTimer);
    if (reconnectWaitTimer) clearInterval(reconnectWaitTimer);
    reconnectWaitTimer = null;
    if (sceneIntroTimeout) clearTimeout(sceneIntroTimeout);
    window.removeEventListener('keydown', handleKeydown);
    destroyPhaser();
    for (const request of evidencePhotoRequests.values()) request.abort();
    evidencePhotoRequests.clear();
    for (const objectUrl of evidencePhotoObjectUrls.values()) URL.revokeObjectURL(objectUrl);
    evidencePhotoObjectUrls.clear();
    return hub.stop();
  }
  return cleanupGamePage;
}
