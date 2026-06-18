import Phaser from 'phaser';
import { Camera, Briefcase, X, FolderSearch, Map as MapIcon, Gavel, createIcons } from 'lucide';
import { gameApi } from '../api/gameApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

// Real assets live under src/FE/public/assets/... and are served at /assets/...
// Case JSON URLs point straight at them; no placeholder redirection anymore.
const PLAYER_SHEETS: Record<string, { key: string; url: string }> = {
  INVESTIGATOR: { key: 'player-holmes', url: '/assets/players/holmes-sheet.png' },
  INTERROGATOR: { key: 'player-watson', url: '/assets/players/watson-sheet.png' },
};
// Sheets are 1024x192 with eight 128x192 frames.
const PLAYER_FRAME = { width: 128, height: 192, sourceX: 0 };

function playableAssetUrl(value: string | undefined) {
  const url = String(value ?? '').trim();
  if (!url || url === '#' || url.toLowerCase() === 'placeholder') return '';
  return url;
}

function sceneBackgroundUrl(scene: VisibleScene) {
  return playableAssetUrl(scene.backgroundUrl);
}

function characterPortraitUrl(character: SceneCharacter) {
  return playableAssetUrl(character.imageUrl);
}

// In-scene chibi sprite sits next to the dialogue portrait by naming convention.
function characterSpriteUrl(character: SceneCharacter) {
  const portrait = playableAssetUrl(character.imageUrl);
  if (!portrait || !portrait.includes('-portrait')) return '';
  return portrait.replace('-portrait', '-sprite');
}

function sceneCharacterSpriteUrl(character: SceneCharacter, sceneId: string | undefined) {
  const portrait = playableAssetUrl(character.imageUrl);
  if (!portrait || !portrait.includes('-portrait') || !sceneId) return '';
  return portrait.replace('-portrait', `-${sceneId}-sprite`);
}

type RoomPlayer = {
  userId: string;
  username: string;
  role: string;
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
  isCompleted: boolean;
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
  caseTitle: string;
  caseSummary: string;
  roomStatus: string;
  currentSceneId: string;
  version: number;
  players: RoomPlayer[];
  visibleScene: VisibleScene;
  inspectedItemIds: string[];
  collectedItemIds: string[];
  capturedClueIds: string[];
  collectedItems: SceneItem[];
  unlockedClues: Clue[];
  evidenceClues: Clue[];
  suspects: SceneCharacter[];
  sceneMap: SceneMapEntry[];
  completedSceneIds: string[];
  availableForAccusation: boolean;
  currentSceneCanComplete: boolean;
  currentSceneMissingRequirements: MissingRequirements;
  currentObjective: string;
  actionLog: ActionLogEntry[];
};

type Overlay =
  | null
  | { type: 'case' }
  | { type: 'map' }
  | { type: 'log' }
  | { type: 'dialogue'; characterId: string }
  | { type: 'inspect'; itemId: string; detail: string; unlockedClueIds: string[] }
  | { type: 'photo'; clueId: string; detail: string }
  | { type: 'inventory'; itemId: string }
  | { type: 'puzzle'; label: string; message: string };

type Accusation = null | {
  step: number;
  culpritId: string | null;
  evidenceIds: Set<string>;
};

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

type PhaserCallbacks = {
  localUserId: string;
  playerPoses: Map<string, PlayerPose>;
  onHotspot: (hotspot: HotspotClick) => void;
  onCharacter: (characterId: string) => void;
  onCapture: (captureRect: RuntimeBox, photo: Blob) => void;
  onCameraError: (message: string) => void;
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
    this.sceneInteractionEnabled = enabled;
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

  updateRemotePose(pose: PlayerPose) {
    this.callbacks.playerPoses.set(pose.userId, pose);
    this.remoteTargets.set(pose.userId, pose);
    const existing = this.remotePlayers.get(pose.userId);
    if (!this.state || pose.sceneId !== this.state.currentSceneId) {
      existing?.destroy(true);
      this.remotePlayers.delete(pose.userId);
      this.remoteDisplayPoses.delete(pose.userId);
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
    const fresh = this.state?.visibleScene.availableDialogues
      .filter((dialogue) => dialogue.characterId === character.characterId && !dialogue.isAsked && !dialogue.isLocked).length ?? 0;

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

    const name = this.add.text(0, 8, fresh ? `${character.name} (${fresh})` : character.name, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '16px',
      color: fresh ? '#f4dc8f' : '#f7efd7',
      backgroundColor: 'rgba(10,22,40,0.88)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 0);

    const open = () => this.callbacks.onCharacter(character.characterId);
    body.on('pointerdown', open);
    body.on('pointerover', () => { if (body instanceof Phaser.GameObjects.Image) body.setTint(0xffe9b0); });
    body.on('pointerout', () => { if (body instanceof Phaser.GameObjects.Image) body.clearTint(); });

    group.add([shadow, body, initialText, name]);
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
    this.add.text(18, height - 104, 'Move: A / D    Interact: E or click', {
      fontFamily: 'Crimson Text, serif',
      fontSize: '15px',
      color: '#d9d4c4',
      backgroundColor: 'rgba(10,22,40,0.68)',
      padding: { x: 9, y: 5 },
    }).setDepth(120);

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
    const next = this.state.sceneMap[currentIndex + 1];
    const completedCurrent = this.state.completedSceneIds.includes(this.state.currentSceneId);
    const canProceed = Boolean(this.state.currentSceneCanComplete);
    const runtimeTransitions = this.sceneRuntime()?.transitions ?? [];

    if (runtimeTransitions.length > 0) {
      runtimeTransitions.forEach((transition) => {
        const targetEntry = this.state!.sceneMap.find((entry) => entry.sceneId === transition.targetSceneId);
        const canRevisit = Boolean(targetEntry?.isVisited && !targetEntry.isCurrent);
        const opensNext = Boolean(canProceed && next?.sceneId === transition.targetSceneId);
        if (!canRevisit && !opensNext) return;

        const box = this.worldRect(transition.hotspot);
        const label = transition.label || targetEntry?.title || 'Move';
        const action = canRevisit
          ? () => this.callbacks.onScene(transition.targetSceneId)
          : () => this.callbacks.onProceed();
        this.drawButton(box.x + box.w / 2, box.y + box.h / 2, this.shorten(label, 18), action, Math.max(148, Math.min(box.w, 240)), opensNext);
      });

      // Fallback: always show a visible proceed button at the bottom so the
      // player is never stuck when a transition hotspot is hidden behind the HUD.
      if (canProceed) {
        const forwardLabel = completedCurrent && next
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
      : completedCurrent && next
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
      current.moving = target.moving;
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
      x: Number(Boolean(right)) - Number(Boolean(left)),
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
      return;
    }

    const prefix = this.nearestHotspot.isLocked ? 'Locked' : 'Press E';
    this.promptText
      .setText(`${prefix}: ${this.nearestHotspot.label || this.prettyId(this.nearestHotspot.targetId)}`)
      .setVisible(true);
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
  let overlay: Overlay = null;
  let selectedInventoryItemId: string | null = null;
  let accusation: Accusation = null;
  let cameraMode = false;
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
  let inventoryOpen = false;
  let sceneIntroActive = true; // Show on initial load
  let sceneIntroTimeout: ReturnType<typeof setTimeout> | null = null;

  const handleKeydown = (e: KeyboardEvent) => {
    if (stopped || !state) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'Escape') {
      if (inventoryOpen || cameraMode || overlay || accusation) {
        inventoryOpen = false;
        cameraMode = false;
        overlay = null;
        accusation = null;
        draw();
        return;
      }
    }

    if (isSceneInputBlocked()) return;

    if (e.key.toLowerCase() === 'b') {
      inventoryOpen = !inventoryOpen;
      draw();
    } else if (e.key.toLowerCase() === 'z') {
      if (myRole() === 'INVESTIGATOR') {
        cameraMode = !cameraMode;
        draw();
      }
    }
  };
  window.addEventListener('keydown', handleKeydown);

  const refetch = async () => applyState(await gameApi.state(roomId));

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
    state = fresh;
    if (myRole() !== 'INVESTIGATOR') cameraMode = false;
    
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
    draw();
  }

  const hub = createRoomConnection(roomId, {
    GameStateUpdated: () => {
      refetch().catch((err: any) => console.warn('State refetch failed', err));
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
    GameCompleted: (result: unknown) => {
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
      window.location.hash = `#/result/${roomId}`;
    },
    RoomError: ({ message }: { message: string }) => toast(message, 'error'),
  }, {
    onReconnected: () => {
      poseErrorShown = false;
      toast('Reconnected. Syncing the room...', 'info');
      refetch().catch(() => {});
    },
  });

  try {
    state = await gameApi.state(roomId);
    if (state?.roomStatus === 'COMPLETED') {
      window.location.hash = `#/result/${roomId}`;
      return () => hub.stop();
    }
    await hub.start();
    if (stopped || !state) return () => hub.stop();
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

  function draw() {
    if (stopped || !state) return;
    mountShell();
    const scene = state.visibleScene;
    const hud = app.querySelector('#game-hud-slot');
    if (hud) hud.innerHTML = '';

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
    if (inventory) inventory.innerHTML = inventoryDrawer() + investigationToolDock();
    const transient = app.querySelector('#game-transient-slot');
    if (transient) transient.innerHTML = `${introOverlay(myRole())}${overlayHtml()}${accusationModal()}`;

    const sceneNeedsUpdate = appliedStateVersion !== state.version
      || appliedSceneId !== state.currentSceneId
      || appliedInventoryItemId !== selectedInventoryItemId;
    if (sceneNeedsUpdate && phaserScene) {
      phaserScene.updateGameState(state, selectedInventoryItemId);
      appliedStateVersion = state.version;
      appliedSceneId = state.currentSceneId;
      appliedInventoryItemId = selectedInventoryItemId;
    }
    phaserScene?.setSceneInteractionEnabled(!isSceneInputBlocked());
    phaserScene?.setCameraMode(cameraMode && !isSceneInputBlocked());
    bind();
    createIcons({
      icons: {
        Camera,
        Briefcase,
        X,
        FolderSearch,
        Map: MapIcon,
        Gavel,
      },
    });
    hydrateEvidenceImages();
  }

  function mountPhaser() {
    if (!state) return;
    const host = document.getElementById(hostId);
    if (!host) return;

    phaserScene = new SirLockedPhaserScene({
      localUserId: me.userId,
      playerPoses,
      onHotspot,
      onCharacter: (characterId) => {
        if (isSceneInputBlocked()) return;
        overlay = { type: 'dialogue', characterId };
        draw();
      },
      onCapture: (captureRect, photo) => captureClue(captureRect, photo),
      onCameraError: (message) => toast(message, 'error'),
      onProceed: () => completeScene(),
      onScene: (sceneId) => goToScene(sceneId),
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
    phaserScene.setSceneInteractionEnabled(!isSceneInputBlocked());
    phaserScene.setCameraMode(cameraMode && !isSceneInputBlocked());
    // Debug handle for QA tooling (canvas snapshots, state inspection).
    (window as unknown as Record<string, unknown>).__sirlockedGame = phaserGame;
  }

  function playersHtml() {
    return state!.players.map((p) => `
      <span class="chip ${p.userId === me.userId ? 'chip-gold' : ''}" title="${escapeHtml(p.username)}">
        ${escapeHtml(p.username.split(' ')[0])} / ${p.role === 'INVESTIGATOR' ? 'INV' : 'INT'}
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

  function investigationToolDock() {
    const isInv = myRole() === 'INVESTIGATOR';
    const cameraHtml = isInv ? `
      <button class="floating-btn camera-tool ${cameraMode ? 'is-hot' : ''}" id="floating-camera-btn" title="Camera (Z)">
        <i data-lucide="camera" aria-hidden="true"></i>
        <span class="hotkey-label">Z</span>
        <span class="camera-badge">${state!.capturedClueIds?.length ?? 0}</span>
      </button>
    ` : '';

    return `
      <div class="investigation-tool-dock">
        <button class="floating-btn" id="case-file-btn" title="Case File" aria-label="Case File">
          <i data-lucide="folder-search"></i>
          <span class="tool-badge">${state!.unlockedClues.length}</span>
        </button>
        <button class="floating-btn" id="map-btn" title="Locations" aria-label="Locations"><i data-lucide="map"></i></button>
        ${cameraHtml}
        <button class="floating-btn bag-tool ${inventoryOpen ? 'is-open' : ''}" id="floating-bag-btn" title="Inventory (B)">
          <i data-lucide="briefcase" aria-hidden="true"></i>
          <span class="hotkey-label">B</span>
          ${state!.collectedItemIds.length > 0 ? `<span class="camera-badge">${state!.collectedItemIds.length}</span>` : ''}
        </button>
        <button class="floating-btn ${state!.availableForAccusation ? 'is-hot' : ''}" id="accuse-btn" ${state!.availableForAccusation ? '' : 'disabled'}
                title="${state!.availableForAccusation ? 'Make the final accusation' : 'Unlocks once every required piece of evidence has been found'}" aria-label="Accuse">
          <i data-lucide="gavel"></i>
        </button>
      </div>
    `;
  }

  function HintChip() {
    if (!state?.currentObjective) return '';
    return `<div class="hint-chip" title="${escapeHtml(state.currentObjective)}">${escapeHtml(state.currentObjective)}</div>`;
  }

  function inventoryDrawer() {
    if (!inventoryOpen) return '';

    const itemsById = new Map(state!.visibleScene.items.map((i) => [i.itemId, i]));
    for (const item of state!.collectedItems ?? []) itemsById.set(item.itemId, item);
    const collected = state!.collectedItemIds.map((id) => itemsById.get(id) ?? { itemId: id, name: prettyId(id), imageUrl: '' });
    
    const totalSlots = 12;
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const item = collected[i];
      if (item) {
        slots.push(`
          <button class="inventory-drawer-slot is-filled ${overlay?.type === 'inventory' && overlay.itemId === item.itemId ? 'is-selected' : ''}"
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
      <div class="inventory-drawer">
        <div class="inventory-drawer-header">
          <span>Bag</span>
          <button class="close-drawer-btn" title="Close (Esc)"><i data-lucide="x"></i></button>
        </div>
        <div class="inventory-drawer-grid">
          ${slots.join('')}
        </div>
      </div>
    `;
  }

  function introOverlay(role: string | null) {
    if (sessionStorage.getItem(introKey)) return '';
    return `
    <div class="overlay" id="intro-overlay">
      <div class="modal">
        <h2>${escapeHtml(state!.caseTitle)}</h2>
        <p>${escapeHtml(state!.caseSummary)}</p>
        <p class="muted">${role === 'INVESTIGATOR'
          ? 'You are the Investigator. Search the scene, inspect objects, and collect physical evidence.'
          : 'You are the Interrogator. Click people, question them, and use evidence to unlock contradictions.'}</p>
        <button class="btn btn-gold btn-block" id="intro-dismiss">Enter the scene</button>
      </div>
    </div>`;
  }

  function overlayHtml() {
    if (!overlay) return '';
    if (overlay.type === 'case') return caseFileOverlay();
    if (overlay.type === 'map') return mapOverlay();
    if (overlay.type === 'log') return logOverlay();
    if (overlay.type === 'dialogue') return dialogueOverlay(overlay.characterId);
    if (overlay.type === 'inspect') return inspectOverlay(overlay.itemId, overlay.detail, overlay.unlockedClueIds ?? []);
    if (overlay.type === 'photo') return photoOverlay(overlay.clueId, overlay.detail);
    if (overlay.type === 'inventory') return inventoryDetailOverlay(overlay.itemId);
    if (overlay.type === 'puzzle') return puzzleOverlay(overlay.label, overlay.message);
    return '';
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

  function caseFileOverlay() {
    const clues = state!.unlockedClues.slice().reverse();
    return `
    <div class="overlay">
      <div class="modal modal-wide case-file-modal">
        <h2>Case File</h2>
        <p class="muted">Evidence and clues discovered by both players.</p>
        ${clues.length === 0
          ? '<div class="empty-state small">No evidence has been collected yet.</div>'
          : `<div class="case-file-grid">${clues.map((c) => `
              <article class="clue-card ${c.isEvidence ? 'clue-evidence' : ''}">
                ${evidencePhotoMarkup(c, 'clue-photo')}
                <div class="clue-head">
                  <strong>${escapeHtml(c.title)}</strong>
                  ${c.isEvidence ? '<span class="chip chip-gold">EVIDENCE</span>' : ''}
                  ${c.isCritical && !c.isEvidence ? '<span class="chip">KEY</span>' : ''}
                </div>
                <p>${escapeHtml(c.content)}</p>
                <span class="muted small">Source: ${escapeHtml(prettyId(c.source))}</span>
              </article>`).join('')}</div>`}
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
      </div>
    </div>`;
  }

  function mapOverlay() {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>Investigation Map</h2>
        <p class="muted">Move through places the investigation has already opened.</p>
        <div class="map-list">${state!.sceneMap.map((s) => `
          <button class="map-entry ${s.isCurrent ? 'is-current' : ''} ${s.isCompleted ? 'is-done' : ''}"
                  data-scene="${escapeHtml(s.sceneId)}" ${s.isVisited && !s.isCurrent ? '' : 'disabled'}>
            <span>${s.isCompleted ? 'Done' : s.isCurrent ? 'Here' : s.isVisited ? 'Open' : 'Locked'}</span>
            <span>${s.isVisited ? escapeHtml(s.title) : 'Unknown location'}</span>
          </button>`).join('')}</div>
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
      </div>
    </div>`;
  }

  function logOverlay() {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>Co-op Log</h2>
        ${state!.actionLog.length === 0
          ? '<div class="empty-state small">Nothing logged yet.</div>'
          : `<div class="log-list">${state!.actionLog.slice().reverse().map((l) => `
              <div class="log-entry">
                <span class="log-time">${new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span>${escapeHtml(l.message)}</span>
              </div>`).join('')}</div>`}
        <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
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
    <div class="overlay">
      <div class="modal modal-wide inspect-modal">
        <div class="inspect-art" style="${placeholderStyle(item.itemId)}">
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">` : ''}
          <span>${escapeHtml(item.name)}</span>
        </div>
        <div class="inspect-copy">
          <h2>${escapeHtml(item.name)}</h2>
          ${item.description ? `<p class="muted">${escapeHtml(item.description)}</p>` : ''}
          <p>${escapeHtml(finding)}</p>
          ${clue
            ? `<p class="clue-flash">Evidence logged: ${escapeHtml(clue.title)}</p>`
            : ''}
          <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
        </div>
      </div>
    </div>`;
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

  function dialogueOverlay(characterId: string) {
    const character = state!.visibleScene.characters.find((c) => c.characterId === characterId);
    if (!character) return '';
    const role = myRole();
    const dialogues = state!.visibleScene.availableDialogues.filter((d) => d.characterId === characterId);
    const imageUrl = characterPortraitUrl(character);
    return `
    <div class="overlay dialogue-overlay">
      <div class="dialogue-box">
        <div class="dialogue-portrait" style="${placeholderStyle(character.characterId)}">
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" onerror="this.remove()">` : ''}
          <span>${initials(character.name)}</span>
        </div>
        <div class="dialogue-copy">
          <h2>${escapeHtml(character.name)}</h2>
          <p class="muted">${escapeHtml(character.role)}. ${escapeHtml(character.description)}</p>
          ${role !== 'INTERROGATOR'
            ? '<p class="notice">Only the Interrogator can ask questions. You can still read the testimony.</p>'
            : ''}
          <div class="dialogue-list">
            ${dialogues.length === 0
              ? '<p class="muted small">There is nothing useful to ask right now.</p>'
              : dialogues.map((d) => `
                <button class="dialogue-row ${d.isAsked ? 'is-asked' : ''} ${d.isLocked ? 'is-locked' : ''}"
                        data-dialogue="${escapeHtml(d.dialogueId)}" ${d.isLocked ? 'disabled' : ''}
                        ${d.isLocked ? `title="Needs ${d.missingClueIds?.length || 'more'} more clue(s) before this can be asked"` : ''}>
                  <span>${d.isLocked ? `Locked${d.missingClueIds?.length ? ` (${d.missingClueIds.length} clue${d.missingClueIds.length > 1 ? 's' : ''} missing)` : ''}` : d.isAsked ? 'Asked' : 'Ask'}</span>
                  <span>${escapeHtml(d.question)}</span>
                </button>
                ${d.isAsked && d.answer ? `<div class="dialogue-answer">"${escapeHtml(d.answer)}"</div>` : ''}`).join('')}
          </div>
          <div class="modal-actions"><button class="btn btn-gold" data-close-overlay>Close</button></div>
        </div>
      </div>
    </div>`;
  }

  function accusationModal() {
    if (!accusation) return '';
    const evidence = state!.evidenceClues;
    if (accusation.step === 1) {
      return `
      <div class="overlay">
        <div class="modal modal-wide">
          <h2>Final Accusation</h2>
          <p class="muted">Choose the culprit and the evidence. A wrong accusation ends the case.</p>
          <h3 class="section-title">Suspects</h3>
          <div class="suspect-grid">${state!.suspects.map((sus) => `
            <button class="suspect-card ${accusation!.culpritId === sus.characterId ? 'is-selected' : ''}" data-suspect="${escapeHtml(sus.characterId)}">
              <span class="char-avatar" style="${placeholderStyle(sus.characterId)}">
                ${characterPortraitUrl(sus) ? `<img src="${escapeHtml(characterPortraitUrl(sus))}" alt="" onerror="this.remove()">` : ''}
                <span>${initials(sus.name)}</span>
              </span>
              <strong>${escapeHtml(sus.name)}</strong>
              <span class="muted small">${escapeHtml(sus.role)}</span>
            </button>`).join('')}</div>
          <h3 class="section-title">Evidence</h3>
          <div class="evidence-list">${evidence.length === 0
            ? '<div class="empty-state small">No evidence-grade clues unlocked yet.</div>'
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
        <h2>Confirm the accusation</h2>
        <p>You are about to accuse <strong>${escapeHtml(culprit?.name ?? '')}</strong> with ${chosen.length} evidence clue(s).</p>
        <ul class="review-list">${chosen.map((c) => `<li>${escapeHtml(c.title)}</li>`).join('') || '<li class="muted">No evidence selected</li>'}</ul>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="accuse-back">Go back</button>
          <button class="btn btn-gold" id="accuse-confirm">Accuse ${escapeHtml(culprit?.name ?? '')}</button>
        </div>
      </div>
    </div>`;
  }

  function isSceneInputBlocked() {
    return Boolean(overlay || accusation) ||
      !sessionStorage.getItem(introKey) ||
      Date.now() < sceneInputBlockedUntil;
  }

  function bind() {
    app.querySelectorAll('.overlay').forEach((layer) => {
      ['pointerdown', 'pointerup', 'click'].forEach((eventName) => {
        layer.addEventListener(eventName, (event) => {
          if (!(event.target instanceof Element) || !event.target.closest('.modal, .dialogue-box')) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
        layer.addEventListener(eventName, (event) => {
          event.stopPropagation();
        });
      });
    });

    app.querySelector('#intro-dismiss')?.addEventListener('pointerdown', (event) => {
      sessionStorage.setItem(introKey, '1');
      dismissOverlayWithShield(event.currentTarget as HTMLElement, event);
    });

    app.querySelectorAll('[data-inventory]').forEach((button) =>
      button.addEventListener('click', () => {
        const itemId = (button as HTMLElement).dataset.inventory;
        if (!itemId) return;
        // Toggle the detail view: clicking the open item (or its overlay) closes it.
        overlay = overlay?.type === 'inventory' && overlay.itemId === itemId ? null : { type: 'inventory', itemId };
        draw();
      }));

    app.querySelector('#case-file-btn')?.addEventListener('click', () => { overlay = { type: 'case' }; draw(); });
    app.querySelector('#floating-camera-btn')?.addEventListener('click', () => {
      if (myRole() !== 'INVESTIGATOR') {
        toast('Only the Investigator can capture scene clues.', 'info');
        return;
      }
      overlay = null;
      accusation = null;
      cameraMode = !cameraMode;
      draw();
    });
    app.querySelector('#floating-bag-btn')?.addEventListener('click', () => {
      inventoryOpen = !inventoryOpen;
      draw();
    });
    app.querySelector('.close-drawer-btn')?.addEventListener('click', () => {
      inventoryOpen = false;
      draw();
    });
    app.querySelector('#map-btn')?.addEventListener('click', () => { overlay = { type: 'map' }; draw(); });
    app.querySelector('#accuse-btn')?.addEventListener('click', () => {
      accusation = { step: 1, culpritId: null, evidenceIds: new Set(state!.evidenceClues.map((c) => c.clueId)) };
      draw();
    });

    app.querySelectorAll('[data-scene]').forEach((s) =>
      s.addEventListener('click', async () => {
        const sceneId = (s as HTMLElement).dataset.scene;
        if (sceneId) await goToScene(sceneId);
      }));

    app.querySelectorAll('[data-close-overlay]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        overlay = null;
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
        try {
          const dialogueId = (button as HTMLElement).dataset.dialogue;
          const res = await gameApi.askDialogue(roomId, dialogueId);
          if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
          applyState(res.state);
        } catch (err: any) {
          toast(err.message, 'error');
        }
      }));

    app.querySelectorAll('[data-suspect]').forEach((button) =>
      button.addEventListener('click', () => {
        if (!accusation) return;
        accusation.culpritId = (button as HTMLElement).dataset.suspect ?? null;
        draw();
      }));
    app.querySelectorAll('[data-evidence]').forEach((box) =>
      box.addEventListener('change', () => {
        if (!accusation) return;
        const input = box as HTMLInputElement;
        const evidenceId = input.dataset.evidence;
        if (!evidenceId) return;
        if (input.checked) accusation.evidenceIds.add(evidenceId);
        else accusation.evidenceIds.delete(evidenceId);
      }));
    app.querySelector('#accuse-cancel')?.addEventListener('pointerdown', (event) => {
      accusation = null;
      dismissOverlayWithShield(event.currentTarget as HTMLElement, event);
    });
    app.querySelector('#accuse-review')?.addEventListener('click', () => { if (accusation) accusation.step = 2; draw(); });
    app.querySelector('#accuse-back')?.addEventListener('click', () => { if (accusation) accusation.step = 1; draw(); });
    app.querySelector('#accuse-confirm')?.addEventListener('click', submitAccusation);
  }

  function dismissOverlayWithShield(control: HTMLElement, event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const layer = control.closest('.overlay') as HTMLElement | null;
    if (!layer || layer.dataset.dismissing === 'true') return;
    layer.dataset.dismissing = 'true';
    layer.classList.add('is-closing-shield');

    sceneInputBlockedUntil = Date.now() + 800;
    phaserScene?.setSceneInteractionEnabled(false);

    let finished = false;
    let fallbackTimer = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      sceneInputBlockedUntil = Date.now() + 120;
      window.setTimeout(() => {
        layer.remove();
        if (!isSceneInputBlocked()) {
          phaserScene?.setSceneInteractionEnabled(true);
        }
      }, 130);
    };

    window.addEventListener('pointerup', finish, { capture: true, once: true });
    window.addEventListener('pointercancel', finish, { capture: true, once: true });
    fallbackTimer = window.setTimeout(finish, 800);
  }

  async function onHotspot({ type, target, locked, label }: HotspotClick) {
    if (isSceneInputBlocked()) return;

    if (selectedInventoryItemId) {
      // Using an item never blocks the normal interaction: locks are driven by
      // missing clues on the backend, so explain that and continue as a plain click.
      const usedItem = selectedInventoryItemId;
      selectedInventoryItemId = null;
      if (locked === 'true') {
        overlay = {
          type: 'puzzle',
          label,
          message: `${prettyId(usedItem)} has no effect here. This is sealed by a missing clue - keep investigating.`,
        };
        draw();
        return;
      }
      toast(`You put ${prettyId(usedItem)} away and take a closer look.`, 'info');
    }

    if (type === 'CHARACTER') {
      overlay = { type: 'dialogue', characterId: target };
      draw();
      return;
    }

    if (locked === 'true') {
      overlay = { type: 'puzzle', label, message: 'This interaction is locked by missing evidence.' };
      draw();
      return;
    }

    if (type !== 'ITEM' && type !== 'OBJECT' && type !== 'CLUE') {
      overlay = { type: 'puzzle', label, message: 'This hotspot is waiting for a case-specific interaction.' };
      draw();
      return;
    }

    if (myRole() !== 'INVESTIGATOR') {
      toast('Only the Investigator can inspect objects. Tell your partner to check it.', 'info');
      draw();
      return;
    }

    try {
      const res = await gameApi.inspectItem(roomId, target);
      overlay = { type: 'inspect', itemId: target, detail: res.detail, unlockedClueIds: res.unlockedClueIds };
      if (res.changed && res.unlockedClueIds.length > 0) toast(res.message, 'success');
      applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function captureClue(captureRect: RuntimeBox, photo: Blob) {
    if (!state || captureInFlight || !cameraMode || isSceneInputBlocked()) return;
    if (myRole() !== 'INVESTIGATOR') {
      toast('Only the Investigator can capture scene clues.', 'info');
      return;
    }

    captureInFlight = true;
    try {
      const res = await gameApi.captureClue(roomId, state.currentSceneId, captureRect, photo);
      const result = String(res.captureResult || '').toUpperCase();
      if (result === 'HIT') {
        cameraMode = false;
        const clueId = res.matchedClueId || res.unlockedClueIds?.[0] || '';
        overlay = { type: 'photo', clueId, detail: res.detail || res.message || 'Photo evidence added.' };
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

  async function completeScene() {
    if (!state?.currentSceneCanComplete) {
      const missing = state?.currentSceneMissingRequirements;
      const parts = [];
      if (missing?.requiredItemIds?.length) parts.push(`${missing.requiredItemIds.length} object(s)`);
      if (missing?.requiredDialogueIds?.length) parts.push(`${missing.requiredDialogueIds.length} conversation(s)`);
      if (missing?.requiredClueIds?.length) parts.push(`${missing.requiredClueIds.length} clue(s)`);
      toast(parts.length ? `Not yet. Still missing ${parts.join(', ')}.` : 'Keep searching this scene first.', 'info', 4200);
      return;
    }

    try {
      const res = await gameApi.completeScene(roomId);
      toast(res.message, 'success', 5500);
      overlay = null;
      applyState(res.state);
    } catch (err: any) {
      const missing = err.errors?.missing;
      if (missing) {
        const parts = [];
        if (missing.requiredItemIds?.length) parts.push(`${missing.requiredItemIds.length} object(s)`);
        if (missing.requiredDialogueIds?.length) parts.push(`${missing.requiredDialogueIds.length} conversation(s)`);
        if (missing.requiredClueIds?.length) parts.push(`${missing.requiredClueIds.length} clue(s)`);
        toast(`Not yet. Still missing ${parts.join(', ')}.`, 'error', 5500);
      } else {
        toast(err.message, 'error');
      }
      draw();
    }
  }

  async function goToScene(sceneId: string) {
    try {
      const res = await gameApi.goToScene(roomId, sceneId);
      overlay = null;
      applyState(res.state);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  }

  async function submitAccusation(event: Event) {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const result = await gameApi.accuse(roomId, accusation!.culpritId, '', '', [...accusation!.evidenceIds]);
      sessionStorage.setItem(`sirlocked.result.${roomId}`, JSON.stringify(result));
      window.location.hash = `#/result/${roomId}`;
    } catch (err: any) {
      toast(err.message, 'error');
      accusation = null;
      draw();
    }
  }

  function prettyId(id: string) {
    return String(id ?? '')
      .replace(/^(item|clue|char|dlg|scene|hotspot)-/i, '')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  return () => {
    stopped = true;
    window.removeEventListener('keydown', handleKeydown);
    destroyPhaser();
    for (const objectUrl of evidencePhotoObjectUrls.values()) URL.revokeObjectURL(objectUrl);
    evidencePhotoObjectUrls.clear();
    return hub.stop();
  };
}
