import Phaser from 'phaser';
import { Camera, Briefcase, X, FolderSearch, Map as MapIcon, Lightbulb, createIcons } from 'lucide';
import { gameApi } from '../api/gameApi.js';
import { roomApi } from '../api/roomApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr, uiLanguage } from '../services/i18n.js';
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
  renderContextAction,
  renderDiscoveryCard,
  renderFinalConfrontationCallout,
  renderGameHud,
} from '../game/gameShell.js';
import {
  buildPairedConfrontationViewModel,
  renderJointReviewPanel,
  renderPrivateEvidencePanel,
  renderPrivateTestimonyPanel,
  type ActivePairedConfrontation,
  type DisclosedPair,
  type PrivateEvidence,
  type PrivateTestimony,
} from '../game/pairedConfrontation.js';
import { newestTerminalPair, renderCrackPayoff, renderV3CaseComplete } from '../game/crackPayoff.js';
import {
  accusationRevisionKey,
  buildAccusationConsensusModel,
  renderAccusationConsensus,
  type AccusationProposal,
} from '../game/accusationConsensus.js';

type RoomPlayer = {
  userId: string;
  username: string;
  role: string;
  isConnected: boolean;
  disconnectedAt?: string | null;
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
  spawnPoints?: Record<string, RuntimePoint>;
  itemPlacements?: RuntimeItemPlacement[];
  characterPlacements?: RuntimeCharacterPlacement[];
  transitions?: RuntimeTransition[];
  clueZones?: RuntimeClueZone[];
  cameraRules?: CameraRules;
};

type SceneItem = {
  itemId: string;
  name: string;
  description: string;
  inspectText?: string;
  imageUrl: string;
};

type SceneCharacter = {
  characterId: string;
  name: string;
  role: string;
  imageUrl: string;
  description: string;
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
  private callbacks: PhaserCallbacks;
  private state: GameState | null = null;
  private selectedInventoryItemId: string | null = null;
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
  private mobileMoveX = 0;
  private lastContextActionKey = '';

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
    // Remember 404s so a missing asset doesn't trigger an endless reload loop.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: { key?: string }) => {
      if (file?.key) this.failedTextureKeys.add(file.key);
    });
    this.scale.on('resize', () => this.draw());
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.cameraMode || !this.ready) return;
      const pointerKey = `${Math.round(pointer.x / 3)},${Math.round(pointer.y / 3)}`;
      if (pointerKey === this.lastCameraPointerKey) return;
      this.lastCameraPointerKey = pointerKey;
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
    this.interpolateRemotePlayers(delta);
    this.updateDebugPointerText();
    if (this.keys.F2 && Phaser.Input.Keyboard.JustDown(this.keys.F2)) {
      this.debugLayout = !this.debugLayout;
      this.draw();
      return;
    }
    if (!this.state || !this.localPose || !this.localPlayer) return;

    if (!this.sceneInteractionEnabled) {
      this.localPose.moving = false;
      this.localPlayer.setData('moving', false);
      this.nearestHotspot = null;
      this.updateInteractionPrompt();
      return;
    }

    const axis = this.inputAxis();
    const moving = axis.x !== 0 || axis.y !== 0;
    const speed = 225;
    const seconds = delta / 1000;
    const bounds = this.walkBounds();

    if (moving) {
      const magnitude = Math.hypot(axis.x, axis.y) || 1;
      const dx = (axis.x / magnitude) * speed * seconds;
      const dy = (axis.y / magnitude) * speed * seconds;
      const startedInsideObstacle = this.collidesAt(this.localPose.x, this.localPose.y);
      const nextX = Phaser.Math.Clamp(this.localPose.x + dx, bounds.left, bounds.right);
      if (startedInsideObstacle || !this.collidesAt(nextX, this.localPose.y)) this.localPose.x = nextX;
      const nextY = Phaser.Math.Clamp(this.localPose.y + dy, bounds.top, bounds.bottom);
      if (startedInsideObstacle || !this.collidesAt(this.localPose.x, nextY)) this.localPose.y = nextY;
      if (axis.x < 0) this.localPose.direction = 'left';
      if (axis.x > 0) this.localPose.direction = 'right';
    }

    this.localPose.moving = moving;
    this.localPose.sceneId = this.state.currentSceneId;
    this.callbacks.playerPoses.set(this.localPose.userId, { ...this.localPose });
    this.placePlayer(this.localPlayer, this.localPose);
    this.nearestHotspot = this.findNearestHotspot(this.localPose);
    this.updateInteractionPrompt();
    this.maybeSendPose(time);

    if (this.nearestHotspot && this.keys.E && Phaser.Input.Keyboard.JustDown(this.keys.E)) {
      this.triggerHotspot(this.nearestHotspot);
    }
  }

  updateGameState(state: GameState, selectedInventoryItemId: string | null) {
    this.state = state;
    this.selectedInventoryItemId = selectedInventoryItemId;
    if (this.ready) this.refreshCameraOverlay();
  }

  setSceneInteractionEnabled(enabled: boolean) {
    const wasEnabled = this.sceneInteractionEnabled;
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
    this.cameraMode = enabled;
    if (enabled) {
      this.sceneInteractionEnabled = false;
      if (this.input) {
        this.input.enabled = true;
        this.input.resetPointers();
      }
      if (this.game?.input) {
        this.game.input.enabled = true;
      }
    }
    if (this.ready) this.draw();
  }

  setMobileMoveX(value: number) {
    this.mobileMoveX = Phaser.Math.Clamp(Math.trunc(value), -1, 1);
  }

  triggerPrimaryInteraction() {
    if (!this.sceneInteractionEnabled || this.cameraMode || !this.nearestHotspot) return;
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
    this.remotePlayers.clear();
    this.localPlayer = null;
    this.promptText = null;
    this.cameraGraphics = null;
    this.cameraLabel = null;
    this.cameraCaptureZone = null;
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

      const { x, y, w, h } = this.hotspotRect(hotspot);
      const inspected = type === 'ITEM' && this.state?.inspectedItemIds.includes(hotspot.targetId);
      const collected = type === 'ITEM' && this.state?.collectedItemIds.includes(hotspot.targetId);

      // Overlay item layer: composite the item sprite into its reserved slot.
      // Collected items leave the scene (they live in the inventory bar).
      const sceneItem = this.state?.visibleScene.items.find((i) => i.itemId === hotspot.targetId);
      const itemUrl = playableAssetUrl(sceneItem?.imageUrl);
      const itemKey = itemUrl ? `item:${hotspot.targetId}:${itemUrl}` : '';
      const placement = this.itemPlacement(hotspot.targetId);
      let itemImage: Phaser.GameObjects.Image | null = null;
      if (itemKey && !collected) {
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

      const label = this.add.text(x + w / 2, y - 8, hotspot.isLocked ? 'Locked' : inspected ? 'Found' : hotspot.label, {
        fontFamily: 'Crimson Text, serif',
        fontSize: '15px',
        color: '#f4dc8f',
        backgroundColor: 'rgba(10,22,40,0.88)',
        padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 1).setDepth(28).setVisible(false);

      hitbox.on('pointerover', () => {
        itemImage?.setTint(0xffe9b0);
        label.setVisible(true);
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
    const group = this.add.container(x, y).setDepth(placement?.depth ?? Math.round(y));
    // Keep NPCs roughly in scale with the player chibis (height * 0.26 -> ~230px)
    // so they read as people standing in the room, not looming over it.
    const npcH = placementSize?.height ?? Phaser.Math.Clamp(height * 0.27, 140, 235);
    const npcW = placementSize?.width ?? npcH * (256 / 384);
    const askable = this.state?.visibleScene.availableDialogues
      .filter((dialogue) => dialogue.characterId === character.characterId && !dialogue.isAsked && !dialogue.isLocked).length ?? 0;
    const newlyUnlocked = this.callbacks.newDialogueCount(character.characterId);

    const spriteUrls = [
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
        .setOrigin(0.5, 1)
        .setInteractive({ useHandCursor: true });
      (body as Phaser.GameObjects.Image).setDisplaySize(npcW, npcH);
      (body as Phaser.GameObjects.Image).setFlipX(placement?.direction === 'right');
    } else {
      for (const url of spriteUrls) {
        this.queueTexture(`npc:${character.characterId}:${url}`, url);
      }
      body = this.add.rectangle(0, 0, npcW, npcH, this.colorFromId(character.characterId, 0x3a2a55), 0.6)
        .setOrigin(0.5, 1)
        .setStrokeStyle(1, 0xc9a84c, 0.4)
        .setInteractive({ useHandCursor: true });
    }

    const initialText = this.add.text(0, -npcH / 2, initials(character.name), {
      fontFamily: 'Playfair Display, Georgia, serif',
      fontSize: '22px',
      color: '#f4dc8f',
      fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(body instanceof Phaser.GameObjects.Rectangle);

    const name = this.add.text(0, 8, askable ? `${character.name} (${askable})` : character.name, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '16px',
      color: askable ? '#f4dc8f' : '#f7efd7',
      backgroundColor: 'rgba(10,22,40,0.88)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 0);

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
      this.tweens.add({
        targets: newBadge,
        scale: { from: 0.92, to: 1.08 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    const open = () => this.callbacks.onCharacter(character.characterId);
    body.on('pointerdown', open);
    body.on('pointerover', () => { if (body instanceof Phaser.GameObjects.Image) body.setTint(0xffe9b0); });
    body.on('pointerout', () => { if (body instanceof Phaser.GameObjects.Image) body.clearTint(); });

    group.add(newBadge ? [shadow, body, initialText, name, newBadge] : [shadow, body, initialText, name]);
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
    const spriteH = Phaser.Math.Clamp(this.scale.height * 0.26, 120, 230);
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
      color: isLocal ? '#f4dc8f' : '#d9d4c4',
      backgroundColor: 'rgba(10,22,40,0.82)',
      padding: { x: 7, y: 3 },
    }).setOrigin(0.5, 0);

    container.add([shadow, body, name]);
    container.setData('body', body);
    container.setData('sheetKey', sheetKey);
    container.setData('frameIndex', 0);
    return container;
  }

  private placePlayer(container: Phaser.GameObjects.Container, pose: PlayerPose) {
    const screen = this.worldPoint(pose);
    container.setPosition(screen.x, screen.y);
    container.setDepth(Math.round(screen.y) + (pose.userId === this.callbacks.localUserId ? 100 : 80));
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

  private drawControlHint(width: number, height: number) {
    if (width > 720) {
      this.add.text(18, height - 104, 'Move: A / D    Interact: E or click', {
        fontFamily: 'Crimson Text, serif',
        fontSize: '15px',
        color: '#d9d4c4',
        backgroundColor: 'rgba(10,22,40,0.68)',
        padding: { x: 9, y: 5 },
      }).setDepth(120);
    }

    this.promptText = this.add.text(width / 2, height - 166, '', {
      fontFamily: 'Crimson Text, serif',
      fontSize: '17px',
      color: '#f4dc8f',
      backgroundColor: 'rgba(10,22,40,0.84)',
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setDepth(120).setVisible(false);
  }

  private drawSceneNavigation(width: number, height: number) {
    if (!this.state) return;

    const visited = this.state.sceneMap.filter((entry) => entry.isVisited && !entry.isCurrent);
    const currentIndex = this.state.sceneMap.findIndex((entry) => entry.isCurrent);
    const next = currentIndex >= 0 ? this.state.sceneMap[currentIndex + 1] : undefined;
    const completedCurrent = this.state.completedSceneIds.includes(this.state.currentSceneId);
    const canProceed = Boolean(this.state.currentSceneCanComplete);
    const runtimeTransitions = this.sceneRuntime()?.transitions ?? [];

    if (runtimeTransitions.length > 0) {
      runtimeTransitions.forEach((transition) => {
        const targetEntry = this.state!.sceneMap.find((entry) => entry.sceneId === transition.targetSceneId);
        const canRevisit = Boolean(targetEntry?.isVisited && !targetEntry.isCurrent);
        const canUseUnlockedPath = Boolean(targetEntry?.isUnlocked && !targetEntry.isCurrent);
        if (!canRevisit && !canUseUnlockedPath) return;

        const box = this.worldRect(transition.hotspot);
        const label = transition.label || targetEntry?.title || 'Move';
        const isAuthoredSuccessor = Boolean(canProceed && next?.sceneId === transition.targetSceneId);
        this.drawButton(
          box.x + box.w / 2,
          box.y + box.h / 2,
          this.shorten(label, 18),
          () => this.callbacks.onScene(transition.targetSceneId),
          Math.max(148, Math.min(box.w, 240)),
          isAuthoredSuccessor,
        );
      });

      // Fallback: always show a visible proceed button at the bottom so the
      // player is never stuck when a transition hotspot is hidden behind the HUD.
      if (canProceed) {
        const forwardLabel = completedCurrent && next?.isUnlocked
          ? `Go to ${this.shorten(next.title, 22)}`
          : 'Continue investigation';
        this.drawButton(width / 2, height - 112, forwardLabel, () => this.callbacks.onProceed(), 230, true);
      }

      return;
    }

    visited.slice(-2).forEach((entry, index) => {
      const x = index === 0 ? 92 : width - 92;
      const y = height * 0.52;
      this.drawButton(x, y, this.shorten(entry.title, 18), () => this.callbacks.onScene(entry.sceneId), 148);
    });

    const forwardLabel = !canProceed
      ? 'Keep searching'
      : completedCurrent && next?.isUnlocked
        ? `Go to ${this.shorten(next.title, 22)}`
        : 'Continue investigation';
    if (canProceed) {
      this.drawButton(width / 2, height - 112, forwardLabel, () => this.callbacks.onProceed(), 230, true);
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

  private drawInventoryHint(width: number, height: number) {
    if (!this.selectedInventoryItemId) return;
    this.add.text(width / 2, height - 158, `Using: ${this.prettyId(this.selectedInventoryItemId)}`, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '17px',
      color: '#f4dc8f',
      backgroundColor: 'rgba(10,22,40,0.82)',
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5);
  }

  private drawCameraOverlay(width: number, height: number) {
    if (!this.cameraMode) return;
    this.refreshCameraOverlay(width, height);
  }

  private refreshCameraOverlay(width = this.scale.width, height = this.scale.height) {
    if (!this.ready) return;
    if (!this.cameraMode) {
      this.cameraGraphics?.destroy();
      this.cameraLabel?.destroy();
      this.cameraCaptureZone?.destroy();
      this.cameraGraphics = null;
      this.cameraLabel = null;
      this.cameraCaptureZone = null;
      return;
    }

    const rect = this.cameraScreenRect(width, height);
    const graphics = this.cameraGraphics ?? this.add.graphics().setDepth(240);
    this.cameraGraphics = graphics;
    graphics.clear();
    graphics.fillStyle(0x6d7178, 0.2);
    graphics.fillRect(0, 0, width, height);
    graphics.fillStyle(0x000000, 0.18);
    graphics.fillRect(0, 0, width, rect.y);
    graphics.fillRect(0, rect.y + rect.height, width, height - rect.y - rect.height);
    graphics.fillRect(0, rect.y, rect.x, rect.height);
    graphics.fillRect(rect.x + rect.width, rect.y, width - rect.x - rect.width, rect.height);
    graphics.lineStyle(2, 0xf4dc8f, 0.96);
    graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);
    graphics.lineStyle(5, 0xf4dc8f, 0.92);
    const corner = Math.min(34, rect.width * 0.22, rect.height * 0.22);
    graphics.lineBetween(rect.x, rect.y, rect.x + corner, rect.y);
    graphics.lineBetween(rect.x, rect.y, rect.x, rect.y + corner);
    graphics.lineBetween(rect.x + rect.width, rect.y, rect.x + rect.width - corner, rect.y);
    graphics.lineBetween(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + corner);
    graphics.lineBetween(rect.x, rect.y + rect.height, rect.x + corner, rect.y + rect.height);
    graphics.lineBetween(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - corner);
    graphics.lineBetween(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - corner, rect.y + rect.height);
    graphics.lineBetween(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height - corner);

    if (!this.cameraLabel) this.cameraLabel = this.add.text(width / 2, rect.y - 14, 'Camera', {
      fontFamily: 'Crimson Text, serif',
      fontSize: '17px',
      color: '#f4dc8f',
      backgroundColor: 'rgba(10,22,40,0.84)',
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5, 1).setDepth(245);
    this.cameraLabel.setPosition(width / 2, rect.y - 14);

    if (!this.cameraCaptureZone) {
      this.cameraCaptureZone = this.add.zone(width / 2, height / 2, width, height)
        .setDepth(250)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.captureCameraFrame());
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
    const pointer = this.input.activePointer;
    const fallbackX = frame.x + frame.width / 2;
    const fallbackY = frame.y + frame.height / 2;
    const pointerInsideCanvas = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= width && pointer.y <= height;
    const centerX = Phaser.Math.Clamp(pointerInsideCanvas ? pointer.x : fallbackX, frame.x, frame.x + frame.width);
    const centerY = Phaser.Math.Clamp(pointerInsideCanvas ? pointer.y : fallbackY, frame.y, frame.y + frame.height);
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
      this.cameraCaptureZone?.setInteractive({ useHandCursor: true });
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
    const button = this.add.rectangle(x, y, buttonWidth, 38, 0x0a1628, 0.86)
      .setStrokeStyle(1, 0xc9a84c, isPrimary ? 0.86 : 0.42)
      .setAlpha(enabled ? 1 : 0.52);
    if (enabled) button.setInteractive({ useHandCursor: true });
    const text = this.add.text(x, y, label, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '16px',
      color: enabled ? '#f4dc8f' : '#b7ad92',
      align: 'center',
    }).setOrigin(0.5).setAlpha(enabled ? 1 : 0.78);

    if (enabled) {
      button.on('pointerover', () => button.setFillStyle(0x2a2240, 0.9));
      button.on('pointerout', () => button.setFillStyle(0x0a1628, 0.86));
      button.on('pointerdown', onClick);
    }

    return { button, text };
  }

  private inputAxis() {
    const left = this.keys.A?.isDown || this.keys.LEFT?.isDown;
    const right = this.keys.D?.isDown || this.keys.RIGHT?.isDown;
    return {
      x: this.mobileMoveX || Number(Boolean(right)) - Number(Boolean(left)),
      y: 0,
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
    const padding = 14;
    const obstacles = [
      ...(this.sceneRuntime()?.itemPlacements ?? []).map((placement) => placement.reservedSlot),
    ].filter((box): box is RuntimeBox => Boolean(box));
    return obstacles.some((box) =>
      x >= box.x - padding && x <= box.x + box.width + padding
      && y >= box.y - padding && y <= box.y + box.height + padding);
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
    return {
      userId: player?.userId ?? this.callbacks.localUserId,
      username: player?.username,
      role: player?.role,
      sceneId: this.state?.currentSceneId ?? '',
      x,
      y,
      direction: spawn?.direction ?? 'right',
      moving: false,
    };
  }

  private findNearestHotspot(pose: PlayerPose) {
    if (!this.state) return null;
    let nearest: Hotspot | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const hotspot of this.state.visibleScene.hotspots) {
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
      return {
        x: runtimeBox.x + runtimeBox.width / 2,
        y: runtimeBox.y + runtimeBox.height / 2,
      };
    }
    return {
      x: ((hotspot.x + hotspot.width / 2) / 100) * this.runtimeWidth(),
      y: ((hotspot.y + hotspot.height / 2) / 100) * this.runtimeHeight(),
    };
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
    this.callbacks.onHotspot({
      type: hotspot.type.toUpperCase(),
      target: hotspot.targetId,
      locked: String(hotspot.isLocked),
      label: hotspot.label,
    });
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

export async function renderGamePage(app: HTMLElement, roomId: string) {
  render(app, '<div class="page"><p class="muted">Opening the Phaser case file...</p></div>');

  const me = session.user();
  const introKey = `sirlocked.intro.${roomId}`;
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
  let combineMode = false;
  const combineSelection = new Set<string>();
  const puzzleDrafts = new Map<string, string[]>();
  let contextAction: ContextAction | null = null;
  let partnerActivity: PartnerActivity | null = null;
  let discoveryNotice: DiscoveryNotice | null = null;
  let discoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let partnerActivityTimer: ReturnType<typeof setTimeout> | null = null;
  let returnFocusId: string | null = null;
  let finalReadyAnnounced = false;
  let sceneIntroActive = true; // Show on initial load
  let sceneIntroTimeout: ReturnType<typeof setTimeout> | null = null;
  let stateRefetchPromise: Promise<void> | null = null;
  let stateRefetchRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let stateRefetchRetryCount = 0;
  let requestedStateVersion = 0;
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
  let convRevealedCount = 0; // lines [0, convRevealedCount) are shown instantly; the rest type out
  let convTimer: ReturnType<typeof setInterval> | null = null;
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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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

  const refetch = async () => applyState(await gameApi.state(roomId));

  function queueStateRefetch(version = 0) {
    if (version > 0 && state && version <= state.version) return;
    requestedStateVersion = Math.max(requestedStateVersion, version);
    if (stateRefetchPromise) return;

    const requestedVersion = requestedStateVersion;
    stateRefetchPromise = Promise.resolve()
      .then(async () => {
        requestedStateVersion = 0;
        await refetch();
        stateRefetchRetryCount = 0;
      })
      .catch((err: any) => {
        requestedStateVersion = Math.max(requestedStateVersion, requestedVersion);
        stateRefetchRetryCount += 1;
        console.warn('State refetch failed', err);
        if (stateRefetchRetryCount <= 5 && !stopped) {
          const delay = Math.min(8000, 500 * 2 ** (stateRefetchRetryCount - 1));
          if (stateRefetchRetryTimer) clearTimeout(stateRefetchRetryTimer);
          stateRefetchRetryTimer = setTimeout(() => {
            stateRefetchRetryTimer = null;
            queueStateRefetch(requestedStateVersion);
          }, delay);
        } else if (!stopped) {
          toast(tr('Connection restored, but the room state could not be loaded. Try again.', 'Đã kết nối lại nhưng chưa tải được trạng thái phòng. Hãy thử lại.'), 'error', 7000);
        }
      })
      .finally(() => {
        stateRefetchPromise = null;
        // A failed request already has an exponential retry timer. Do not start
        // a second request from finally while that timer is pending.
        if (!stateRefetchRetryTimer && requestedStateVersion > (state?.version ?? 0)) {
          queueStateRefetch(requestedStateVersion);
        }
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
      </div>`);
    shellMounted = true;
    mountPhaser();
  }

  function applyState(fresh: GameState) {
    if (!fresh || (state && fresh.version < state.version)) return;
    const isNewScene = state && state.currentSceneId !== fresh.currentSceneId;
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
        toast(`${entry?.title ?? 'A location'} is fully investigated.`, 'success', 4500);
      }
    }
    rememberAskableDialogues(fresh);
    rememberAccusationRevision(fresh);
    state = fresh;
    if (myRole() !== 'INVESTIGATOR' && uiMode.kind === 'CAMERA') uiMode = { kind: 'EXPLORE' };
    if (fresh.availableForAccusation && !finalReadyAnnounced) {
      finalReadyAnnounced = true;
      toast(tr('The final confrontation is ready.', 'Đối chất cuối cùng đã sẵn sàng.'), 'success', 5500);
    }
    
    if (isNewScene) {
      sceneIntroActive = true;
      if (sceneIntroTimeout) clearTimeout(sceneIntroTimeout);
      sceneIntroTimeout = setTimeout(() => {
        sceneIntroActive = false;
        draw();
      }, 3000);
    }
    if (state.roomStatus === 'COMPLETED') {
      window.location.hash = `#/result/${roomId}`;
      return;
    }
    if (state.roomStatus === 'ABANDONED') {
      destroyPhaser();
      render(app, `<div class="page"><div class="empty-state"><h2>${escapeHtml(tr('Room ended', 'Phòng đã kết thúc'))}</h2><p>${escapeHtml(tr('This game was abandoned after the reconnect grace period expired.', 'Trận đấu đã bị hủy sau khi hết thời gian chờ kết nối lại.'))}</p><a class="btn btn-gold" href="#/cases">${escapeHtml(tr('Back to cases', 'Quay lại danh sách vụ án'))}</a></div></div>`);
      return;
    }
    for (const itemId of [...combineSelection]) {
      if (!fresh.collectedItemIds.includes(itemId)) combineSelection.delete(itemId);
    }
    if (selectedInventoryItemId && !fresh.collectedItemIds.includes(selectedInventoryItemId)) {
      selectedInventoryItemId = null;
    }
    draw();
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
    discoveryNotice = notice;
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
    PlayerPresenceChanged: ({ userId, isConnected }: { userId: string; isConnected: boolean }) => {
      const player = state?.players.find((entry) => entry.userId === userId);
      if (player) player.isConnected = isConnected;
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
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
      window.location.hash = `#/result/${roomId}`;
    },
    RoomError: ({ message }: { message: string }) => toast(message, 'error'),
  }, {
    onReconnected: () => {
      poseErrorShown = false;
      toast('Reconnected. Syncing the room...', 'info');
      queueStateRefetch();
    },
    onClose: () => {
      if (!stopped) toast(tr('Connection lost. Trying to reconnect…', 'Mất kết nối. Đang thử kết nối lại…'), 'info', 5000);
    },
  });

  try {
    state = await gameApi.state(roomId);
    if (state?.roomStatus === 'COMPLETED') {
      window.location.hash = `#/result/${roomId}`;
      return () => hub.stop();
    }
    if (state?.roomStatus === 'ABANDONED') {
      applyState(state);
      return () => hub.stop();
    }
    await hub.start();
    if (stopped || !state) return () => hub.stop();
    recordV3UiEvent('ReconnectRestored');
    sceneIntroTimeout = setTimeout(() => { sceneIntroActive = false; draw(); }, 3000);
    draw();
  } catch (err: any) {
    if (err.message?.includes('not started')) {
      window.location.hash = `#/lobby/${roomId}`;
      return undefined;
    }
    render(app, `<div class="page"><div class="empty-state">${escapeHtml(err.message)}</div></div>`);
    return () => hub.stop();
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
    if (uiMode.kind !== 'DIALOGUE') resetConversation();
    const model = uiModel();
    const scene = state.visibleScene;
    const hud = app.querySelector('#game-hud-slot');
    if (hud) {
      const canAbandon = state.hostUserId === me.userId
        && state.players.some((player) => player.userId !== me.userId && player.isConnected === false);
      hud.innerHTML = renderGameHud(model, state.caseTitle, me.userId, canAbandon, tr);
    }

    const introSlot = app.querySelector('#scene-intro-slot');
    if (introSlot) {
      if (sceneIntroActive) {
        const locationTitle = locationTitleParts(scene.title);
        introSlot.innerHTML = `
          <div class="scene-intro-toast">
            <h2>${escapeHtml(locationTitle.area)}</h2>
            ${locationTitle.scene ? `<p>${escapeHtml(locationTitle.scene)}</p>` : ''}
          </div>
        `;
      } else {
        introSlot.innerHTML = '';
      }
    }

    const inventory = app.querySelector('#inventory-slot');
    if (inventory) inventory.innerHTML = inventoryDrawer() + caseFileDrawer() + investigationToolDock(model) + mobileMovementDock(model);
    const transient = app.querySelector('#game-transient-slot');
    const completedTruth = state.sharedKnowledge?.resolvedTruths?.at(-1) ?? null;
    const caseComplete = isV3CaseComplete();
    const showCaseComplete = caseComplete
      && !crackPayoffPair
      && !caseCompleteDismissed;
    if (transient) transient.innerHTML = `${introOverlay(myRole())}${overlayHtml()}${accusationModal()}${accusationConsensusPanel()}${renderCrackPayoff(crackPayoffPair, escapeHtml, tr, caseComplete)}${renderV3CaseComplete(showCaseComplete, completedTruth, escapeHtml, tr)}${renderContextAction(model, tr)}${renderDiscoveryCard(discoveryNotice, tr)}${renderFinalConfrontationCallout(model, tr)}`;

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
    if (crackPayoffPair) window.requestAnimationFrame(() => app.querySelector<HTMLButtonElement>('#v3-crack-dismiss')?.focus());
    else if (showCaseComplete) window.requestAnimationFrame(() => app.querySelector<HTMLButtonElement>('#v3-complete-review')?.focus());
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
    hydrateDialogueTypewriter();
  }

  function mountPhaser() {
    if (!state) return;
    const host = document.getElementById(hostId);
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

  function investigationToolDock(model: ReturnType<typeof buildGameUiModel>) {
    const cameraHtml = model.canUseCamera ? `
      <button class="floating-btn camera-tool ${model.mode.kind === 'CAMERA' ? 'is-hot' : ''}" id="floating-camera-btn" title="${tr('Camera', 'Máy ảnh')} (Z)" aria-pressed="${model.mode.kind === 'CAMERA'}">
        <i data-lucide="camera" aria-hidden="true"></i>
        <span class="hotkey-label">Z</span>
        <span class="camera-badge">${state!.capturedClueIds?.length ?? 0}</span>
      </button>
    ` : '';

    return `
      <div class="investigation-tool-dock">
        <button class="floating-btn ${model.mode.kind === 'CASE_FILE' && model.mode.section !== 'map' ? 'is-open' : ''}" id="case-file-btn" title="${tr('Case File', 'Hồ sơ vụ án')}" aria-label="${tr('Case File', 'Hồ sơ vụ án')}">
          <i data-lucide="folder-search"></i>
          <span class="tool-badge">${model.role === 'INTERROGATOR' && model.newQuestionCount > 0 ? model.newQuestionCount : state!.unlockedClues.length}</span>
        </button>
        <button class="floating-btn ${model.mode.kind === 'CASE_FILE' && model.mode.section === 'map' ? 'is-open' : ''}" id="map-btn" title="${tr('Locations', 'Địa điểm')}" aria-label="${tr('Locations', 'Địa điểm')}"><i data-lucide="map"></i></button>
        <button class="floating-btn" id="hint-btn" title="${tr('Request a hint', 'Yêu cầu gợi ý')}" aria-label="${tr('Hint', 'Gợi ý')}"><i data-lucide="lightbulb"></i></button>
        ${cameraHtml}
        ${model.canUseInventory ? `<button class="floating-btn bag-tool ${model.mode.kind === 'INVENTORY' ? 'is-open' : ''}" id="floating-bag-btn" title="${tr('Inventory', 'Túi đồ')} (B)" aria-pressed="${model.mode.kind === 'INVENTORY'}">
          <i data-lucide="briefcase" aria-hidden="true"></i>
          <span class="hotkey-label">B</span>
          ${state!.collectedItemIds.length > 0 ? `<span class="camera-badge">${state!.collectedItemIds.length}</span>` : ''}
        </button>` : ''}
      </div>
    `;
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

  function inventoryDrawer() {
    if (uiMode.kind !== 'INVENTORY') return '';

    const itemsById = new Map(state!.visibleScene.items.map((i) => [i.itemId, i]));
    for (const item of state!.collectedItems ?? []) itemsById.set(item.itemId, item);
    const collected = state!.collectedItemIds.map((id) => itemsById.get(id) ?? { itemId: id, name: prettyId(id), imageUrl: '' });
    
    const totalSlots = Math.max(12, collected.length);
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const item = collected[i];
      if (item) {
        slots.push(`
          <button class="inventory-drawer-slot is-filled ${uiMode.itemId === item.itemId ? 'is-selected' : ''} ${combineSelection.has(item.itemId) ? 'is-combine-selected' : ''}"
                  data-inventory="${escapeHtml(item.itemId)}" title="${escapeHtml(item.name)}">
            <span class="inventory-icon" style="${placeholderStyle(item.itemId)}">
              ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">` : ''}
            </span>
          </button>
        `);
      } else {
        slots.push(`<div class="inventory-drawer-slot is-empty"></div>`);
      }
    }

    return `
      <div class="inventory-drawer panel panel--dossier">
        <div class="inventory-drawer-header">
          <span>${tr('Bag', 'Túi đồ')}</span>
          <button class="btn btn-ghost btn-sm ${combineMode ? 'is-active' : ''}" id="combine-mode-btn">${combineMode ? tr('Combining', 'Đang kết hợp') : tr('Combine', 'Kết hợp')}</button>
          ${combineMode ? `<button class="btn btn-gold btn-sm" id="combine-submit-btn" ${combineSelection.size >= 2 ? '' : 'disabled'}>${tr('Use', 'Dùng')} ${combineSelection.size}</button>` : ''}
          <button class="close-drawer-btn" title="${tr('Close', 'Đóng')} (Esc)"><i data-lucide="x"></i></button>
        </div>
        <div class="inventory-drawer-grid">
          ${slots.join('')}
        </div>
        ${uiMode.itemId ? inventoryDetailOverlay(uiMode.itemId) : ''}
      </div>
    `;
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
        `Dùng ${cap('A')}/${cap('D')} để di chuyển trái/phải`,
        'Nhấp vật thể hoặc nhân vật để tương tác',
        'Chia sẻ chứng cứ qua Case File và phối hợp với đồng đội',
        'Hoàn thành suy luận trước khi đưa ra cáo buộc cuối',
      ]
      : [
        `Use ${cap('A')}/${cap('D')} to move left and right`,
        'Click an object or character to interact',
        'Share evidence through the Case File and coordinate with your partner',
        'Complete deductions before the final accusation',
      ];
    return `
    <div class="overlay" id="intro-overlay">
      <div class="modal panel panel--dossier intro-dossier">
        <h2 class="intro-title">${escapeHtml(state!.caseTitle)}</h2>
        <p class="intro-premise">${escapeHtml(state!.caseSummary)}</p>
        <p class="intro-role" data-role="${escapeHtml(role ?? '')}">${roleGuide}</p>
        <ol class="tutorial-steps">
          ${steps.map((step) => `<li><span class="tutorial-step-copy">${step}</span></li>`).join('')}
        </ol>
        <button class="btn btn-gold btn-block" id="intro-dismiss">${vi ? 'Bắt đầu điều tra' : 'Enter the scene'}</button>
      </div>
    </div>`;
  }

  function overlayHtml() {
    if (uiMode.kind === 'DIALOGUE') return dialogueOverlay(uiMode.characterId);
    if (uiMode.kind === 'PUZZLE' && uiMode.view === 'LOCKED') return puzzleOverlay(uiMode.label, uiMode.message);
    if (uiMode.kind === 'PUZZLE' && uiMode.view === 'SOLVE') return puzzleSolveOverlay(uiMode.puzzleId);
    return '';
  }

  function caseFileDrawer() {
    if (uiMode.kind !== 'CASE_FILE') return '';
    return uiMode.section === 'map' ? mapOverlay() : caseFileOverlay(uiMode.section);
  }

  function evidencePhotoMarkup(clue: Clue, className: string) {
    return clue.photoUrl
      ? `<img class="${className}" data-auth-image="${escapeHtml(clue.photoUrl)}" alt="Captured view of ${escapeHtml(clue.title)}">`
      : '';
  }

  function hydrateEvidenceImages() {
    app.querySelectorAll<HTMLImageElement>('img[data-auth-image]').forEach((image) => {
      const path = image.dataset.authImage;
      if (!path || image.getAttribute('src')) return;
      const cached = evidencePhotoObjectUrls.get(path);
      if (cached) {
        image.src = cached;
        return;
      }
      gameApi.evidencePhoto(path).then((blob: Blob) => {
        const objectUrl = URL.createObjectURL(blob);
        evidencePhotoObjectUrls.set(path, objectUrl);
        app.querySelectorAll<HTMLImageElement>('img[data-auth-image]')
          .forEach((target) => {
            if (target.dataset.authImage === path) target.src = objectUrl;
          });
      }).catch(() => image.remove());
    });
  }

  function caseFileOverlay(tab: 'evidence' | 'testimony' | 'contradictions') {
    if (state!.mechanicsVersion === 3) {
      const model = buildPairedConfrontationViewModel(state!, myRole());
      const tabs = `
        <div class="case-file-tabs">
          <button class="${tab === 'evidence' ? 'is-active' : ''}" data-case-tab="evidence">${tr('Physical Evidence', 'Chứng cứ vật lý')}</button>
          <button class="${tab === 'testimony' ? 'is-active' : ''}" data-case-tab="testimony">${tr('Testimony', 'Lời khai')}</button>
          <button class="${tab === 'contradictions' ? 'is-active' : ''}" data-case-tab="contradictions">${tr('Joint Review', 'Cùng xem xét')}</button>
        </div>`;
      const supportingClues = state!.unlockedClues.filter((clue) => !clue.isEvidence);
      const deductionHtml = state!.deductions.map((deduction) => `
        <article class="deduction-card ${deduction.isSolved ? 'is-solved' : deduction.isAvailable ? 'is-available' : 'is-locked'}">
          <div class="clue-head"><strong>${escapeHtml(deduction.prompt)}</strong><span class="chip">${deduction.isSolved ? tr('SOLVED', 'ĐÃ GIẢI') : deduction.isAvailable ? tr('READY', 'SẴN SÀNG') : tr('LOCKED', 'ĐANG KHÓA')}</span></div>
          ${deduction.isSolved
            ? `<blockquote>${escapeHtml(deduction.resolution ?? '')}</blockquote>`
            : deduction.isAvailable
              ? `<div class="deduction-options">${deduction.options.map((option) => `<button class="btn btn-ghost" data-solve-deduction="${escapeHtml(deduction.deductionId)}" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>`).join('')}</div>`
              : `<p class="muted">${tr('Continue investigating and resolve the required Crack loops.', 'Tiếp tục điều tra và giải quyết các vòng Phá Vỡ Lời Dối cần thiết.')}</p>`}
        </article>`).join('');
      const content = tab === 'evidence'
        ? `${renderPrivateEvidencePanel(model, escapeHtml, tr)}${supportingClues.length > 0 ? `<section class="notebook-list"><h3>${tr('Supporting leads', 'Manh mối hỗ trợ')}</h3>${supportingClues.map((clue) => `<article><strong>${escapeHtml(clue.title)}</strong><p>${escapeHtml(clue.content)}</p></article>`).join('')}</section>` : ''}`
        : tab === 'testimony'
          ? renderPrivateTestimonyPanel(model, escapeHtml, tr)
          : `${renderJointReviewPanel(model, escapeHtml, tr)}${state!.deductions.length > 0 ? `<section class="notebook-list"><h3>${tr('Deductions', 'Suy luận')}</h3>${deductionHtml}</section>` : ''}`;
      return `
        <aside class="case-file-drawer case-file-modal v3-case-file panel panel--dossier" aria-label="${tr('Private Case File', 'Hồ sơ riêng')}">
          <div class="drawer-title-row"><div><span>${tab === 'contradictions' ? tr('INTENTIONAL DISCLOSURE', 'CHIA SẺ CÓ CHỦ ĐÍCH') : tr('ROLE-PRIVATE NOTEBOOK', 'SỔ TAY RIÊNG THEO VAI')}</span><h2>${tr('Crack the Lie', 'Phá Vỡ Lời Dối')}</h2></div><button class="close-drawer-btn" type="button" title="${tr('Close', 'Đóng')} (Esc)"><i data-lucide="x"></i></button></div>
          ${tabs}
          ${content}
        </aside>`;
    }

    const clues = state!.unlockedClues.slice().reverse();
    const selectedClueId = uiMode.kind === 'CASE_FILE' ? uiMode.clueId : undefined;
    const selectedClue = selectedClueId
      ? clues.find((clue) => clue.clueId === selectedClueId)
      : undefined;
    const tabs = `
      <div class="case-file-tabs">
        <button class="${tab === 'evidence' ? 'is-active' : ''}" data-case-tab="evidence">${tr('Evidence', 'Chứng cứ')}</button>
        <button class="${tab === 'testimony' ? 'is-active' : ''}" data-case-tab="testimony">${tr('Testimony', 'Lời khai')}</button>
        <button class="${tab === 'contradictions' ? 'is-active' : ''}" data-case-tab="contradictions">${tr('Contradictions', 'Mâu thuẫn')}</button>
      </div>`;
    const content = tab === 'evidence'
      ? (clues.length === 0
        ? `<div class="empty-state small">${tr('No evidence has been collected yet.', 'Chưa thu thập được chứng cứ nào.')}</div>`
        : selectedClue
          ? `<section class="case-file-evidence-detail" aria-label="${escapeHtml(selectedClue.title)}">
              <button class="evidence-detail-back" id="evidence-detail-back" type="button">← ${tr('Back to evidence', 'Trở lại danh sách chứng cứ')}</button>
              <div class="evidence-detail-art">
                ${evidencePhotoMarkup(selectedClue, 'evidence-photo-large') || `<span class="evidence-visual-placeholder" aria-hidden="true">${initials(selectedClue.title)}</span>`}
              </div>
              <div class="clue-head"><h3>${escapeHtml(selectedClue.title)}</h3>${selectedClue.isEvidence ? `<span class="chip chip-gold">${tr('EVIDENCE', 'CHỨNG CỨ')}</span>` : ''}</div>
              <p>${escapeHtml(selectedClue.content)}</p>
            </section>`
          : `<div class="case-file-grid">${clues.map((c) => `
            <button class="clue-card case-file-clue-card ${c.isEvidence ? 'clue-evidence' : ''}" data-evidence-detail="${escapeHtml(c.clueId)}" type="button" aria-label="${tr('Open evidence', 'Mở chứng cứ')}: ${escapeHtml(c.title)}">
              <span class="clue-card-art">${evidencePhotoMarkup(c, 'clue-photo') || `<span class="evidence-visual-placeholder" aria-hidden="true">${initials(c.title)}</span>`}</span>
              <span class="clue-head"><strong>${escapeHtml(c.title)}</strong>${c.isEvidence ? `<span class="chip chip-gold">${tr('EVIDENCE', 'CHỨNG CỨ')}</span>` : ''}</span>
              <span class="clue-card-summary">${escapeHtml(c.content)}</span>
            </button>`).join('')}</div>`)
      : tab === 'testimony'
        ? (state!.testimonies.length === 0
          ? `<div class="empty-state small">${tr('No testimony has been recorded yet.', 'Chưa ghi nhận lời khai nào.')}</div>`
          : `<div class="notebook-list">${state!.testimonies.map((entry) => `
              <article><strong>${escapeHtml(entry.characterName)}</strong><p>${escapeHtml(entry.question)}</p><blockquote>${escapeHtml(entry.answer)}</blockquote></article>`).join('')}</div>`)
        : `<div class="notebook-list">
            ${state!.resolvedConfrontations.length === 0 ? `<div class="empty-state small">${tr('No contradictions have been exposed yet.', 'Chưa phát hiện mâu thuẫn nào.')}</div>` : state!.resolvedConfrontations.map((record) => `
              <article><strong>${escapeHtml(record.prompt)}</strong><p>${escapeHtml(record.evidenceTitle)}</p><blockquote>${escapeHtml(record.resolution)}</blockquote></article>`).join('')}
            ${state!.deductions.map((deduction) => `
              <article class="deduction-card ${deduction.isSolved ? 'is-solved' : deduction.isAvailable ? 'is-available' : 'is-locked'}">
                <div class="clue-head"><strong>${escapeHtml(deduction.prompt)}</strong><span class="chip">${deduction.isSolved ? tr('SOLVED', 'ĐÃ GIẢI') : deduction.isAvailable ? tr('READY', 'SẴN SÀNG') : tr('LOCKED', 'ĐANG KHÓA')}</span></div>
                ${deduction.isSolved
                  ? `<blockquote>${escapeHtml(deduction.resolution ?? '')}</blockquote>`
                  : deduction.isAvailable
                    ? `<div class="deduction-options">${deduction.options.map((option) => `<button class="btn btn-ghost" data-solve-deduction="${escapeHtml(deduction.deductionId)}" data-option="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>`).join('')}</div>
                       <button class="btn btn-ghost" data-deduction-hint="${escapeHtml(deduction.deductionId)}">${tr('Hint', 'Gợi ý')}</button>`
                    : `<p class="muted">${tr('Missing', 'Còn thiếu')} ${deduction.missingClueIds.length} ${tr('clue(s) and', 'manh mối và')} ${deduction.missingChallengeIds.length} ${tr('contradiction(s).', 'mâu thuẫn.')}</p>`}
              </article>`).join('')}
          </div>`;
    return `
    <aside class="case-file-drawer case-file-modal panel panel--dossier" aria-label="${tr('Case File', 'Hồ sơ vụ án')}">
        <div class="drawer-title-row"><div><span>${tr('Shared investigation', 'Điều tra chung')}</span><h2>${tr('Case File', 'Hồ sơ vụ án')}</h2></div><button class="close-drawer-btn" type="button" title="${tr('Close', 'Đóng')} (Esc)"><i data-lucide="x"></i></button></div>
        ${tabs}
        ${content}
    </aside>`;
  }

  function mapOverlay() {
    return `
    <aside class="case-file-drawer map-drawer panel panel--dossier" aria-label="${tr('Investigation Map', 'Bản đồ điều tra')}">
        <div class="drawer-title-row"><div><span>${tr('Shared investigation', 'Điều tra chung')}</span><h2>${tr('Investigation Map', 'Bản đồ điều tra')}</h2></div><button class="close-drawer-btn" type="button" title="${tr('Close', 'Đóng')} (Esc)"><i data-lucide="x"></i></button></div>
        <p class="muted">${tr('Move through places the investigation has already opened.', 'Di chuyển giữa các địa điểm đã được mở trong quá trình điều tra.')}</p>
        <div class="map-list">${state!.sceneMap.map((s) => `
          <button class="map-entry ${s.isCurrent ? 'is-current' : ''} ${s.isCompleted ? 'is-done' : ''}"
                  data-scene="${escapeHtml(s.sceneId)}" ${(s.isVisited || s.isUnlocked) && !s.isCurrent ? '' : 'disabled'}>
            <span>${s.isCompleted ? tr('Done', 'Hoàn tất') : s.isCurrent ? tr('Here', 'Hiện tại') : s.isVisited || s.isUnlocked ? tr('Open', 'Đã mở') : tr('Locked', 'Đang khóa')}</span>
            <span>${s.isVisited || s.isUnlocked ? escapeHtml(s.title) : tr('Unknown location', 'Địa điểm chưa biết')}${!s.isCompleted && (s.isVisited || s.isUnlocked) && s.pendingRequirementCount > 0 ? ` <em class="muted small">· ${s.pendingRequirementCount} ${tr('left', 'còn lại')}</em>` : ''}</span>
          </button>`).join('')}</div>
        <button class="btn btn-ghost btn-sm" id="map-case-file-btn" type="button">${tr('Back to case file', 'Trở lại hồ sơ')}</button>
    </aside>`;
  }

  function logOverlay() {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>${tr('Co-op Log', 'Nhật ký phối hợp')}</h2>
        ${state!.actionLog.length === 0
          ? `<div class="empty-state small">${tr('Nothing logged yet.', 'Chưa có hoạt động nào được ghi lại.')}</div>`
          : `<div class="log-list">${state!.actionLog.slice().reverse().map((l) => `
              <div class="log-entry">
                <span class="log-time">${new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>${escapeHtml(l.message)}</span>
              </div>`).join('')}</div>`}
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>${tr('Close', 'Đóng')}</button></div>
      </div>
    </div>`;
  }

  function inspectOverlay(itemId: string, detail: string, unlockedClueIds: string[]) {
    const item = state!.visibleScene.items.find((i) => i.itemId === itemId) ?? { itemId, name: prettyId(itemId), imageUrl: '', description: '' };
    const inspectedText = detail ?? item.inspectText ?? item.description;
    return `
    <div class="overlay">
      <div class="modal modal-wide inspect-modal">
        <div class="inspect-art" style="${placeholderStyle(item.itemId)}">
          <img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">
          <span>${escapeHtml(item.name)}</span>
        </div>
        <div class="inspect-copy">
          <h2>${escapeHtml(item.name)}</h2>
          <p>${escapeHtml(inspectedText)}</p>
          ${unlockedClueIds.length
            ? `<p class="clue-flash">${unlockedClueIds.length} clue(s) added to the case file.</p>`
            : '<p class="muted small">No new evidence found.</p>'}
          <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
        </div>
      </div>
    </div>`;
  }

  function photoOverlay(clueId: string, detail: string) {
    const clue = state!.unlockedClues.find((c) => c.clueId === clueId) ?? state!.evidenceClues.find((c) => c.clueId === clueId);
    return `
    <div class="overlay">
      <div class="modal">
        <h2>${escapeHtml(clue?.title ?? 'Photographic evidence')}</h2>
        ${clue ? evidencePhotoMarkup(clue, 'evidence-photo-large') : ''}
        <p>${escapeHtml(detail || clue?.inventoryDescription || clue?.content || 'A scene clue has been added to the case file.')}</p>
        ${clue?.narrativeMeaning ? `<p class="muted">${escapeHtml(clue.narrativeMeaning)}</p>` : ''}
        <p class="clue-flash">Photo captured and logged.</p>
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
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
    const finding = item.inspectText || item.description || 'You collected this item during the investigation.';
    const clue = state!.unlockedClues.find((c) => c.source === itemId);
    return `
      <section class="inventory-detail-inline">
        <div class="inventory-detail-art" style="${placeholderStyle(item.itemId)}">
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">` : ''}
          <span>${escapeHtml(item.name)}</span>
        </div>
        <div class="inspect-copy">
          <h3>${escapeHtml(item.name)}</h3>
          ${item.description ? `<p class="muted">${escapeHtml(item.description)}</p>` : ''}
          <p>${escapeHtml(finding)}</p>
          ${clue
            ? `<p class="clue-flash">Evidence logged: ${escapeHtml(clue.title)}</p>`
            : ''}
          <div class="modal-actions">
            ${myRole() === 'INVESTIGATOR' ? `<button class="btn btn-gold" data-use-inventory="${escapeHtml(item.itemId)}">Use</button>` : ''}
            <button class="btn btn-ghost" id="inventory-detail-close" type="button">${tr('Back', 'Quay lại')}</button>
          </div>
        </div>
      </section>`;
  }

  function puzzleOverlay(label: string, message: string) {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>${escapeHtml(label || 'Locked object')}</h2>
        <p>${escapeHtml(message || 'This needs another clue before it can be opened.')}</p>
        <p class="muted small">Missing clues usually hide in unexamined objects or unasked questions. Compare notes with your partner - the Investigator searches, the Interrogator questions.</p>
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
      </div>
    </div>`;
  }

  function puzzleSolveOverlay(puzzleId: string) {
    const puzzle = state!.visibleScene.puzzles?.find((candidate) => candidate.puzzleId === puzzleId);
    if (!puzzle) return '';
    const draft = puzzleDrafts.get(puzzle.puzzleId) ?? [];
    const missing = [...(puzzle.missingItemIds ?? []), ...(puzzle.missingClueIds ?? [])];
    const title = puzzle.prompt || prettyId(puzzle.puzzleId);
    const solved = puzzle.isSolved;
    const locked = puzzle.isLocked;
    const body = solved
      ? '<p class="clue-flash">Solved.</p>'
      : locked
        ? `<p class="muted">Locked: ${missing.map(prettyId).map(escapeHtml).join(', ') || 'missing requirement'}.</p>`
        : puzzle.type === 'CODE_PUZZLE'
          ? `<input class="form-control" id="puzzle-code-answer" maxlength="32" autocomplete="off" placeholder="Code">`
          : `<div class="deduction-options">${(puzzle.options ?? []).map((option) => `
              <button class="btn btn-ghost" data-puzzle-option="${escapeHtml(option)}">${escapeHtml(prettyId(option))}</button>`).join('')}</div>
             <p class="muted small">${draft.length > 0 ? escapeHtml(draft.map(prettyId).join(' -> ')) : 'No symbols selected.'}</p>`;

    return `
    <div class="overlay">
      <div class="modal">
        <h2>${escapeHtml(title)}</h2>
        ${body}
        <div class="modal-actions">
          ${!solved && !locked ? '<button class="btn btn-ghost" id="puzzle-clear-btn">Clear</button><button class="btn btn-gold" id="puzzle-submit-btn">Submit</button>' : ''}
          <button class="btn btn-ghost" data-close-overlay>Close</button>
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
    if (convTimer) { clearInterval(convTimer); convTimer = null; }
    convCharacterId = null;
    convLog = [];
    convRevealedCount = 0;
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

  function hydrateDialogueTypewriter() {
    if (convTimer) { clearInterval(convTimer); convTimer = null; }
    if (uiMode.kind !== 'DIALOGUE') return;
    const logEl = app.querySelector<HTMLElement>('.conv-scroll');
    logEl?.scrollTo({ top: logEl.scrollHeight });
    const pending = Array.from(app.querySelectorAll<HTMLElement>('.conv-text.is-typing'));
    if (pending.length === 0) { convRevealedCount = convLog.length; return; }
    let idx = 0;
    let charCount = 0;
    convTimer = setInterval(() => {
      const el = pending[idx];
      if (!el) {
        if (convTimer) clearInterval(convTimer);
        convTimer = null;
        convRevealedCount = convLog.length;
        return;
      }
      const full = el.getAttribute('data-full') ?? '';
      charCount += 1;
      el.textContent = full.slice(0, charCount);
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
      if (charCount >= full.length) {
        el.classList.remove('is-typing');
        idx += 1;
        charCount = 0;
      }
    }, 16);
  }

  function conversationLogHtml(characterName: string) {
    if (convLog.length === 0) {
      return '<p class="conv-empty muted small">Choose a topic below to begin questioning.</p>';
    }
    // Group consecutive lines from the same speaker into a single turn (one label,
    // one bubble with multiple lines). The flat index is preserved per line so the
    // typewriter still reveals only the newest lines.
    type Turn = { speaker: 'SIRLOCKED' | 'NPC'; lines: { text: string; index: number }[] };
    const turns: Turn[] = [];
    convLog.forEach((line, index) => {
      const last = turns[turns.length - 1];
      if (last && last.speaker === line.speaker) last.lines.push({ text: line.text, index });
      else turns.push({ speaker: line.speaker, lines: [{ text: line.text, index }] });
    });
    return turns.map((turn) => {
      const speaker = turn.speaker === 'SIRLOCKED' ? 'SirLocked' : characterName;
      const cls = turn.speaker === 'SIRLOCKED' ? 'conv-turn conv-mine' : 'conv-turn conv-npc';
      const bubble = turn.lines.map((l) => {
        const typing = l.index >= convRevealedCount;
        return `<p class="conv-text ${typing ? 'is-typing' : ''}" data-full="${escapeHtml(l.text)}">${typing ? '' : escapeHtml(l.text)}</p>`;
      }).join('');
      return `<div class="${cls}">
          <div class="conv-speaker">${escapeHtml(speaker)}</div>
          <div class="conv-bubble">${bubble}</div>
        </div>`;
    }).join('');
  }

  function renderChallengePanel(challenge: EvidenceChallenge, role: string | null | undefined) {
    return `
      <section class="evidence-challenge conv-challenge">
        <div class="conv-challenge-head">
          <span class="conv-challenge-tag">Present evidence</span>
          <button class="btn btn-ghost btn-sm" data-challenge-hint="${escapeHtml(challenge.challengeId)}">Hint</button>
        </div>
        <strong>${escapeHtml(challenge.prompt)}</strong>
        ${role === 'INTERROGATOR'
          ? `<div class="challenge-actions">${state!.evidenceClues.map((clue) => `
              <button class="btn btn-ghost evidence-choice" data-present-challenge="${escapeHtml(challenge.challengeId)}" data-present-evidence="${escapeHtml(clue.clueId)}">
                ${escapeHtml(clue.title)}
              </button>`).join('')}</div>`
          : '<p class="muted small">Only the Interrogator can present evidence.</p>'}
      </section>`;
  }

  function dialogueOverlay(characterId: string) {
    const character = state!.visibleScene.characters.find((c) => c.characterId === characterId);
    if (!character) return '';
    const role = myRole();
    const dialogues = state!.visibleScene.availableDialogues.filter((d) => d.characterId === characterId);
    const imageUrl = characterPortraitUrl(character);

    const freshOpen = convCharacterId !== characterId;
    if (freshOpen) convCharacterId = characterId;
    convLog = buildConversation(characterId);
    if (freshOpen) convRevealedCount = convLog.length; // existing history shows instantly
    else convRevealedCount = Math.min(convRevealedCount, convLog.length); // newly added lines type out

    const tree = isTreeCharacter(characterId);
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
        const dialogueButtons = askable.map((d) => `
            <button class="conv-choice ${newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId) ? 'is-new' : ''}" data-dialogue="${escapeHtml(d.dialogueId)}">
              <span class="conv-choice-tag">${newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId) ? tr('New', 'Mới') : tr('Ask', 'Hỏi')}</span><span class="conv-choice-text">${escapeHtml(d.question)}</span>
            </button>`).join('');
        topicsHtml = `${dialogueButtons}${choices.filter((c) => !c.isLocked).map((c) => {
            const isNew = isTreeCueHighlighted(characterId, c.choiceId);
            return `<button class="conv-choice ${isNew ? 'is-new' : ''}" data-converse-node="${escapeHtml(convTreeNodeId ?? '')}" data-converse-choice="${escapeHtml(c.choiceId)}">
              <span class="conv-choice-tag">${isNew ? tr('New', 'Mới') : tr('Ask', 'Hỏi')}</span><span class="conv-choice-text">${escapeHtml(c.label ?? '')}</span>
            </button>`;
          }).join('')}
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
          : `${askable.map((d) => `
              <button class="conv-choice ${newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId) ? 'is-new' : ''}" data-dialogue="${escapeHtml(d.dialogueId)}">
                <span class="conv-choice-tag">${newDialogueIds.has(d.dialogueId) || visibleNewDialogueIds.has(d.dialogueId) ? tr('New', 'Mới') : tr('Ask', 'Hỏi')}</span><span class="conv-choice-text">${escapeHtml(d.question)}</span>
              </button>`).join('')}
            ${lockedCount > 0
              ? `<p class="conv-locked">${lockedCount > 1
                ? tr(`${lockedCount} more questions locked — find stronger evidence first.`, `${lockedCount} câu hỏi khác đang bị khóa — hãy tìm chứng cứ mạnh hơn.`)
                : tr('Locked — find stronger evidence before pressing further.', 'Đang bị khóa — hãy tìm chứng cứ mạnh hơn trước khi hỏi tiếp.')}</p>`
              : ''}`;

      challengeHtml = activeChallenges.map((challenge) => renderChallengePanel(challenge, role)).join('');
    }

    return `
    <div class="overlay dialogue-overlay">
      <div class="conversation-box panel panel--dossier">
        <aside class="conv-portrait-col">
          <div class="conv-portrait" style="${placeholderStyle(character.characterId)}">
            ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" onerror="this.remove()">` : ''}
            <span>${initials(character.name)}</span>
          </div>
          <div class="conv-portrait-caption">
            <strong>${escapeHtml(character.name)}</strong>
            <span>${escapeHtml(character.role)}</span>
          </div>
        </aside>
        <div class="conv-main">
          <header class="conv-header">
            <div class="conv-header-top">
              <span class="conv-section-label">${tr('Witness interview', 'Thẩm vấn nhân chứng')}</span>
              ${role !== 'INTERROGATOR'
                ? `<span class="conv-badge">${tr('Viewing testimony — Interrogator controls questioning.', 'Chỉ xem lời khai — Thẩm vấn viên điều khiển cuộc hỏi.')}</span>`
                : ''}
            </div>
            <p class="conv-desc">${escapeHtml(character.description)}</p>
          </header>
          <div class="conv-scroll">
            <div class="conversation-log">${conversationLogHtml(character.name)}</div>
            ${challengeHtml ? `<div class="conversation-challenges">${challengeHtml}</div>` : ''}
            ${newLeadHtml}
            <div class="conversation-choices">${topicsHtml}</div>
          </div>
          <footer class="conv-footer">
            <button class="btn btn-gold" data-close-overlay>${tr('Leave', 'Rời đi')}</button>
          </footer>
        </div>
      </div>
    </div>`;
  }

  function accusationModal() {
    if (uiMode.kind !== 'ACCUSATION') return '';
    const accusation = uiMode.draft;
    const evidence = state!.evidenceClues;
    const v2 = state!.mechanicsVersion >= 2 && state!.accusationConfig;

    if (v2) {
      const config = state!.accusationConfig!;
      const steps = [tr('Suspect', 'Nghi phạm'), tr('Motive', 'Động cơ'), tr('Method', 'Phương thức'), tr('Evidence', 'Chứng cứ'), tr('Review', 'Xem lại')];
      const header = `<div class="accusation-steps">${steps.map((label, index) => `<span class="${accusation!.step === index + 1 ? 'is-active' : ''}">${label}</span>`).join('')}</div>`;
      let body = '';
      let canContinue = false;
      if (accusation.step === 1) {
        canContinue = Boolean(accusation.culpritId);
        body = `<div class="suspect-grid">${state!.suspects.map((suspect) => `
          <button class="suspect-card ${accusation!.culpritId === suspect.characterId ? 'is-selected' : ''}" data-suspect="${escapeHtml(suspect.characterId)}">
            <span class="suspect-portrait" style="${placeholderStyle(suspect.characterId)}">
              ${characterPortraitUrl(suspect) ? `<img src="${escapeHtml(characterPortraitUrl(suspect))}" alt="" onerror="this.remove()">` : ''}
              <span>${initials(suspect.name)}</span>
            </span>
            <span class="suspect-copy"><strong>${escapeHtml(suspect.name)}</strong><span class="muted small">${escapeHtml(suspect.role)}</span></span>
          </button>`).join('')}</div>`;
      } else if (accusation.step === 2) {
        canContinue = Boolean(accusation.motiveId);
        body = optionPicker(config.motiveOptions, accusation.motiveId, 'motive');
      } else if (accusation.step === 3) {
        canContinue = Boolean(accusation.methodId);
        body = optionPicker(config.methodOptions, accusation.methodId, 'method');
      } else if (accusation.step === 4) {
        canContinue = config.claimTypes.every((claim) => Boolean(accusation!.evidenceLinks[claim]))
          && new Set(Object.values(accusation.evidenceLinks)).size === config.claimTypes.length;
        const activeClaim = config.claimTypes.includes(accusation.activeClaimType ?? '')
          ? accusation.activeClaimType!
          : config.claimTypes.find((claim) => !accusation.evidenceLinks[claim]) ?? config.claimTypes[0];
        body = `<div class="accusation-evidence-workspace">
          <section class="accusation-claim-column" aria-label="${tr('Accusation claims', 'Các luận điểm cáo buộc')}">
            <div class="accusation-workspace-heading"><strong>${tr('Claims', 'Luận điểm')}</strong><span>${tr('Choose a slot, then click or drag evidence into it.', 'Chọn một ô, sau đó bấm hoặc kéo chứng cứ vào.')}</span></div>
            ${config.claimTypes.map((claim) => {
              const selectedClue = evidence.find((clue) => clue.clueId === accusation!.evidenceLinks[claim]);
              return `<div class="claim-drop-zone ${activeClaim === claim ? 'is-active' : ''} ${selectedClue ? 'is-filled' : ''}" data-claim-drop="${escapeHtml(claim)}">
                <button class="claim-slot-button" data-claim-slot="${escapeHtml(claim)}" type="button" aria-pressed="${activeClaim === claim}">
                  <span class="claim-slot-label">${escapeHtml(accusationClaimLabel(claim))}</span>
                  <span class="claim-slot-preview ${selectedClue ? '' : 'is-empty'}">
                    ${selectedClue ? evidencePhotoMarkup(selectedClue, 'evidence-photo-thumb') : ''}
                    <span class="claim-slot-mark" aria-hidden="true">${selectedClue ? '✓' : '+'}</span>
                  </span>
                  <span class="claim-slot-copy">${selectedClue ? `<strong>${escapeHtml(selectedClue.title)}</strong>` : `<strong>${tr('Drop evidence here', 'Thả chứng cứ vào đây')}</strong>`}</span>
                </button>
                ${selectedClue ? `<button class="claim-slot-clear" data-clear-claim="${escapeHtml(claim)}" type="button" aria-label="${tr('Remove evidence from', 'Gỡ chứng cứ khỏi')} ${escapeHtml(accusationClaimLabel(claim))}">×</button>` : ''}
              </div>`;
            }).join('')}
          </section>
          <section class="accusation-evidence-library" aria-label="${tr('Collected evidence', 'Chứng cứ đã thu thập')}">
            <div class="accusation-workspace-heading"><strong>${tr('Collected evidence', 'Chứng cứ đã thu thập')}</strong><span>${evidence.length} ${tr('available', 'có sẵn')}</span></div>
            <div class="accusation-evidence-gallery">${evidence.map((clue) => {
              const assignedClaim = config.claimTypes.find((claim) => accusation!.evidenceLinks[claim] === clue.clueId);
              return `<button class="accusation-evidence-card ${assignedClaim ? 'is-assigned' : ''}" data-assign-evidence="${escapeHtml(clue.clueId)}" draggable="true" type="button" aria-label="${tr('Assign evidence', 'Gán chứng cứ')}: ${escapeHtml(clue.title)}">
                <span class="accusation-evidence-art">${evidencePhotoMarkup(clue, 'evidence-photo-thumb') || `<span class="evidence-visual-placeholder" aria-hidden="true">${initials(clue.title)}</span>`}</span>
                <span class="accusation-evidence-copy"><strong>${escapeHtml(clue.title)}</strong><small>${assignedClaim ? `${tr('Assigned to', 'Đã gán cho')} ${escapeHtml(accusationClaimLabel(assignedClaim))}` : tr('Click to assign', 'Bấm để gán')}</small></span>
              </button>`;
            }).join('')}</div>
          </section>
        </div>
          ${Object.values(accusation.evidenceLinks).filter(Boolean).length === config.claimTypes.length && !canContinue ? `<p class="notice">${tr('Each claim must use different evidence.', 'Mỗi luận điểm phải dùng chứng cứ khác nhau.')}</p>` : ''}`;
      } else {
        const culprit = state!.suspects.find((suspect) => suspect.characterId === accusation!.culpritId);
        const motive = config.motiveOptions.find((option) => option.id === accusation!.motiveId);
        const method = config.methodOptions.find((option) => option.id === accusation!.methodId);
        canContinue = true;
        body = `<div class="accusation-review">
          <p><strong>${tr('Suspect', 'Nghi phạm')}:</strong> ${escapeHtml(culprit?.name ?? '')}</p>
          <p><strong>${tr('Motive', 'Động cơ')}:</strong> ${escapeHtml(motive?.label ?? '')}</p>
          <p><strong>${tr('Method', 'Phương thức')}:</strong> ${escapeHtml(method?.label ?? '')}</p>
          ${config.claimTypes.map((claim) => `<p><strong>${escapeHtml(accusationClaimLabel(claim))}:</strong> ${escapeHtml(evidence.find((clue) => clue.clueId === accusation!.evidenceLinks[claim])?.title ?? '')}</p>`).join('')}
          <p class="notice">${tr('A wrong accusation ends the case.', 'Cáo buộc sai sẽ kết thúc vụ án.')}</p>
        </div>`;
      }

      return `<div class="overlay"><div class="modal modal-wide accusation-modal">
        <h2>${tr('Final Accusation', 'Cáo buộc cuối cùng')}</h2>${header}${body}
        <div class="modal-actions">
          ${accusation.step === 1 ? '<button class="btn btn-ghost" id="accuse-cancel">Not yet</button>' : '<button class="btn btn-ghost" id="accuse-back">Back</button>'}
          ${accusation.step < 5
            ? `<button class="btn btn-gold" id="accuse-next" ${canContinue ? '' : 'disabled'}>${tr('Continue', 'Tiếp tục')}</button>`
            : '<button class="btn btn-gold" id="accuse-confirm">Make accusation</button>'}
        </div>
      </div></div>`;
    }

    if (accusation.step === 1) {
      return `
      <div class="overlay">
        <div class="modal modal-wide">
          <h2>${tr('Final Accusation', 'Cáo buộc cuối cùng')}</h2>
          <p class="muted">Choose the culprit and the evidence. A wrong accusation ends the case.</p>
          <h3 class="section-title">${tr('Suspects', 'Nghi phạm')}</h3>
          <div class="suspect-grid">${state!.suspects.map((sus) => `
            <button class="suspect-card ${accusation!.culpritId === sus.characterId ? 'is-selected' : ''}" data-suspect="${escapeHtml(sus.characterId)}">
              <span class="char-avatar" style="${placeholderStyle(sus.characterId)}">
                ${characterPortraitUrl(sus) ? `<img src="${escapeHtml(characterPortraitUrl(sus))}" alt="" onerror="this.remove()">` : ''}
                <span>${initials(sus.name)}</span>
              </span>
              <strong>${escapeHtml(sus.name)}</strong>
              <span class="muted small">${escapeHtml(sus.role)}</span>
            </button>`).join('')}</div>
          <h3 class="section-title">${tr('Evidence', 'Chứng cứ')}</h3>
          <div class="evidence-list">${evidence.length === 0
            ? `<div class="empty-state small">${tr('No evidence-grade clues unlocked yet.', 'Chưa mở khóa manh mối đủ giá trị làm chứng cứ.')}</div>`
            : evidence.map((c) => `
              <label class="evidence-row">
                <input type="checkbox" data-evidence="${escapeHtml(c.clueId)}" ${accusation!.evidenceIds.has(c.clueId) ? 'checked' : ''}>
                ${evidencePhotoMarkup(c, 'evidence-photo-thumb')}
                <span><strong>${escapeHtml(c.title)}</strong><br><span class="muted small">${escapeHtml(c.content)}</span></span>
              </label>`).join('')}</div>
          <div class="modal-actions">
            <button class="btn btn-ghost" id="accuse-cancel">Not yet</button>
            <button class="btn btn-gold" id="accuse-review" ${accusation.culpritId ? '' : 'disabled'}>Review accusation</button>
          </div>
        </div>
      </div>`;
    }

    const culprit = state!.suspects.find((sus) => sus.characterId === accusation!.culpritId);
    const chosen = evidence.filter((c) => accusation!.evidenceIds.has(c.clueId));
    return `
    <div class="overlay">
      <div class="modal">
        <h2>${tr('Confirm the accusation', 'Xác nhận cáo buộc')}</h2>
        <p>You are about to accuse <strong>${escapeHtml(culprit?.name ?? '')}</strong> with ${chosen.length} evidence clue(s).</p>
        <ul class="review-list">${chosen.map((c) => `<li>${escapeHtml(c.title)}</li>`).join('') || `<li class="muted">${tr('No evidence selected', 'Chưa chọn chứng cứ')}</li>`}</ul>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="accuse-back">Go back</button>
          <button class="btn btn-gold" id="accuse-confirm">Accuse ${escapeHtml(culprit?.name ?? '')}</button>
        </div>
      </div>
    </div>`;
  }

  // Joint review of the standing proposal. The accusation modal owns drafting; this owns agreeing.
  function accusationConsensusPanel() {
    const proposal = state!.activeAccusation;
    if (!proposal || uiMode.kind === 'ACCUSATION') return '';

    const partner = state!.players.find((player) => player.userId !== me.userId);
    const model = buildAccusationConsensusModel({
      proposal,
      localUserId: me.userId,
      rows: accusationSummaryRows(proposal),
      proposerName: state!.players.find((player) => player.userId === proposal.proposedByUserId)?.username
        ?? tr('Your partner', 'Đồng đội'),
      partnerName: partner?.username ?? tr('Partner', 'Đồng đội'),
      acknowledgedKey: acknowledgedAccusationKey,
    });
    return renderAccusationConsensus(model, escapeHtml, tr);
  }

  function accusationSummaryRows(proposal: AccusationProposal) {
    const rows = [{
      label: tr('Suspect', 'Nghi phạm'),
      value: state!.suspects.find((suspect) => suspect.characterId === proposal.culpritId)?.name ?? proposal.culpritId,
    }];
    const config = state!.accusationConfig;
    if (config) {
      rows.push({
        label: tr('Motive', 'Động cơ'),
        value: config.motiveOptions.find((option) => option.id === proposal.motiveId)?.label ?? proposal.motiveId ?? '',
      });
      rows.push({
        label: tr('Method', 'Phương thức'),
        value: config.methodOptions.find((option) => option.id === proposal.methodId)?.label ?? proposal.methodId ?? '',
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
      });
    }
    for (const evidenceId of proposal.evidenceIds ?? []) {
      rows.push({ label: tr('Evidence', 'Chứng cứ'), value: clueTitle(evidenceId) });
    }
    return rows;
  }

  function optionPicker(options: AccusationOption[], selectedId: string | null, kind: 'motive' | 'method') {
    return `<div class="accusation-options">${options.map((option) => `
      <button class="option-row ${selectedId === option.id ? 'is-selected' : ''}" data-${kind}="${escapeHtml(option.id)}">${escapeHtml(option.label)}</button>`).join('')}</div>`;
  }

  function isSceneInputBlocked() {
    return isScenePanelOpen(uiMode) ||
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
    if (!phaserScene) return;
    const blocked = isSceneInputBlocked();
    const cameraEnabled = isCameraMode(uiMode) && !blocked;
    phaserScene.setSceneInteractionEnabled(!blocked);
    phaserScene.setCameraMode(cameraEnabled);
  }

  function bind() {
    app.querySelector('#abandon-game-btn')?.addEventListener('click', async () => {
      try {
        await roomApi.abandon(roomId);
        toast('Game abandoned.', 'info');
        window.location.hash = '#/cases';
      } catch (err: any) {
        toast(err.message, 'error');
      }
    });
    app.querySelectorAll('.overlay').forEach((layer) => {
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

    app.querySelector('#intro-dismiss')?.addEventListener('pointerdown', (event) => {
      sessionStorage.setItem(introKey, '1');
      dismissOverlayWithShield(event.currentTarget as HTMLElement, event);
    });
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
      toast(`Using ${prettyId(itemId)}. Choose a target in the scene.`, 'info');
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
      const tab = (button as HTMLElement).dataset.caseTab as 'evidence' | 'testimony' | 'contradictions';
      setUiMode({ kind: 'CASE_FILE', section: tab });
    }));
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
      button.addEventListener('pointerdown', (event) => {
        closeOverlay();
        app.querySelectorAll('.inventory-item.is-selected').forEach((item) => item.classList.remove('is-selected'));
        dismissOverlayWithShield(button as HTMLElement, event);
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      });
    });

    app.querySelectorAll('[data-dialogue]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (myRole() !== 'INTERROGATOR') {
          toast('Only the Interrogator can ask questions.', 'info');
          return;
        }
        const askButton = button as HTMLButtonElement;
        if (askButton.dataset.asking === '1') return; // guard against double-clicks
        askButton.dataset.asking = '1';
        try {
          const dialogueId = askButton.dataset.dialogue;
          clearNewDialogue(dialogueId);
          const res = await gameApi.askDialogue(roomId, dialogueId);
          if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
          applyState(res.state); // log rebuilds deterministically from state
        } catch (err: any) {
          toast(err.message, 'error');
        }
      }));

    app.querySelectorAll('[data-converse-choice]').forEach((button) => button.addEventListener('click', async () => {
      if (myRole() !== 'INTERROGATOR') {
        toast('Only the Interrogator can ask questions.', 'info');
        return;
      }
      const target = button as HTMLElement;
      await chooseConversation(target.dataset.converseNode ?? '', target.dataset.converseChoice ?? '');
    }));

    app.querySelectorAll('[data-present-challenge]').forEach((button) => button.addEventListener('click', async () => {
      const target = button as HTMLElement;
      await presentEvidence(target.dataset.presentChallenge ?? '', target.dataset.presentEvidence ?? '');
    }));
    app.querySelectorAll('[data-challenge-hint]').forEach((button) => button.addEventListener('click', async () => {
      await requestHint('CONFRONTATION', (button as HTMLElement).dataset.challengeHint ?? '');
    }));
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
        draw();
      }));
    app.querySelectorAll('[data-motive]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const accusation = uiMode.draft;
      accusation.motiveId = (button as HTMLElement).dataset.motive ?? null;
      draw();
    }));
    app.querySelectorAll('[data-method]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const accusation = uiMode.draft;
      accusation.methodId = (button as HTMLElement).dataset.method ?? null;
      draw();
    }));
    app.querySelectorAll('[data-claim-slot]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      uiMode.draft.activeClaimType = (button as HTMLElement).dataset.claimSlot ?? null;
      draw();
    }));
    app.querySelectorAll('[data-clear-claim]').forEach((button) => button.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      const claim = (button as HTMLElement).dataset.clearClaim;
      if (!claim) return;
      delete uiMode.draft.evidenceLinks[claim];
      uiMode.draft.activeClaimType = claim;
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
    app.querySelector('#accuse-cancel')?.addEventListener('pointerdown', (event) => {
      amendedAccusation = null;
      uiMode = { kind: 'EXPLORE' };
      dismissOverlayWithShield(event.currentTarget as HTMLElement, event);
    });
    app.querySelector('#accuse-review')?.addEventListener('click', () => { if (uiMode.kind === 'ACCUSATION') uiMode.draft.step = 2; draw(); });
    app.querySelector('#accuse-next')?.addEventListener('click', () => {
      if (uiMode.kind !== 'ACCUSATION') return;
      uiMode.draft.step++;
      if (uiMode.draft.step === 4) uiMode.draft.activeClaimType = state!.accusationConfig?.claimTypes[0] ?? null;
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
      toast('Only the Investigator can capture scene clues.', 'info');
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

    window.addEventListener('pointerup', finish, { capture: true, once: true });
    window.addEventListener('pointercancel', finish, { capture: true, once: true });
    fallbackTimer = window.setTimeout(finish, 800);
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
        toast('Only the Investigator can operate scene puzzles.', 'info');
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
      toast('Only the Investigator can inspect objects. Tell your partner to check it.', 'info');
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
      toast('Only the Investigator can use inventory items.', 'info');
      selectedInventoryItemId = null;
      draw();
      return;
    }

    const itemId = selectedInventoryItemId;
    selectedInventoryItemId = null;
    try {
      const res = await gameApi.useItem(roomId, itemId, targetId);
      toast(res.detail || res.message || 'Item used.', res.changed ? 'success' : 'info', 4800);
      applyState(res.state);
    } catch (err: any) {
      toast(err.message || 'That item does not work here.', 'error');
      draw();
    }
  }

  async function combineItems() {
    const itemIds = [...combineSelection];
    if (itemIds.length < 2) return;
    if (myRole() !== 'INVESTIGATOR') {
      toast('Only the Investigator can combine inventory items.', 'info');
      return;
    }

    try {
      const res = await gameApi.combineItems(roomId, itemIds);
      toast(res.detail || res.message || 'Items combined.', res.changed ? 'success' : 'info', 4800);
      combineSelection.clear();
      combineMode = false;
      applyState(res.state);
    } catch (err: any) {
      toast(err.message || 'Those items do not combine.', 'error');
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
      toast('Only the Investigator can capture scene clues.', 'info');
      return;
    }

    captureInFlight = true;
    try {
      const res = await gameApi.captureClue(roomId, state.currentSceneId, captureRect, photo);
      const result = String(res.captureResult || '').toUpperCase();
      if (result === 'HIT') {
        const clueId = res.matchedClueId || res.unlockedClueIds?.[0] || '';
        const clue = res.state?.unlockedClues?.find((candidate: Clue) => candidate.clueId === clueId)
          ?? state.unlockedClues.find((candidate) => candidate.clueId === clueId);
        uiMode = { kind: 'EXPLORE' };
        showDiscovery({
          id: `photo:${clueId || Date.now()}`,
          kind: 'PHOTO',
          title: clue?.title || tr('Photographic evidence', 'Chứng cứ ảnh'),
          detail: res.detail || res.message || tr('Photo evidence added to the case file.', 'Chứng cứ ảnh đã được thêm vào hồ sơ.'),
          imageUrl: clue?.photoUrl,
          clueCount: res.unlockedClueIds?.length ?? 1,
        });
        toast(res.message || 'Photo evidence captured.', 'success');
        applyState(res.state);
        return;
      }

      if (result === 'NEAR_MISS') {
        toast(res.message || 'Close, but the clue is not framed clearly enough.', 'info', 3600);
      } else {
        toast(res.message || 'Nothing noteworthy in that frame.', 'info', 3200);
      }
      if (res.state) applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      captureInFlight = false;
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

  async function runPairedCommand(command: () => Promise<any>, openJointReview = true) {
    if (pairedCommandInFlight) return;
    pairedCommandInFlight = true;
    try {
      const response = await command();
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
    }));
  }

  async function editPairedTestimony(testimonyFragmentId: string) {
    const active = state?.activeConfrontation;
    if (!active || !testimonyFragmentId || myRole() !== 'INTERROGATOR') return;
    await runPairedCommand(() => gameApi.editPairedTestimony(roomId, active.attemptId, {
      testimonyFragmentId,
      expectedRevision: active.revision,
    }));
  }

  async function submitPairedEvidence(evidenceId: string) {
    const active = state?.activeConfrontation;
    if (!active || !evidenceId || myRole() !== 'INVESTIGATOR') return;
    await runPairedCommand(() => gameApi.submitPairedEvidence(roomId, active.attemptId, {
      evidenceId,
      expectedRevision: active.revision,
    }));
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
      toast('You do not have enough grounds to leave this location yet. Request a hint if you are stuck.', 'info', 4200);
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
        toast('An important trace or statement still needs to be verified.', 'error', 5500);
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

  return () => {
    stopped = true;
    if (convTimer) { clearInterval(convTimer); convTimer = null; }
    if (crackPayoffTimer) { clearTimeout(crackPayoffTimer); crackPayoffTimer = null; }
    if (stateRefetchRetryTimer) { clearTimeout(stateRefetchRetryTimer); stateRefetchRetryTimer = null; }
    window.removeEventListener('keydown', handleKeydown);
    destroyPhaser();
    for (const objectUrl of evidencePhotoObjectUrls.values()) URL.revokeObjectURL(objectUrl);
    evidencePhotoObjectUrls.clear();
    return hub.stop();
  };
}
