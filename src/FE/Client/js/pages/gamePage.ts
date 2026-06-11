import Phaser from 'phaser';
import { gameApi } from '../api/gameApi.js';
import { session } from '../services/session.js';
import { createRoomConnection } from '../services/signalrClient.js';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';

const GENERATED_ASSETS = {
  bakerStreet: new URL('../../../assets/images/221b-baker-street.jpg', import.meta.url).href,
  observatoryMainHall: new URL('../../../assets/generated/observatory-main-hall.png', import.meta.url).href,
  drVega: new URL('../../../assets/generated/dr-vega.png', import.meta.url).href,
  janitorMiller: new URL('../../../assets/generated/janitor-miller.png', import.meta.url).href,
};

function isProjectPlaceholderAsset(value: string | undefined, folder: string) {
  return String(value ?? '').trim().toLowerCase().startsWith(`/assets/${folder}/`);
}

function defaultSceneBackgroundUrl(scene: VisibleScene) {
  const text = `${scene.sceneId} ${scene.title}`.toLowerCase();
  if (text.includes('observatory') || text.includes('main hall')) {
    return GENERATED_ASSETS.observatoryMainHall;
  }
  return GENERATED_ASSETS.bakerStreet;
}

function defaultCharacterPortraitUrl(character: SceneCharacter) {
  const text = `${character.characterId} ${character.name}`.toLowerCase();
  if (text.includes('vega')) return GENERATED_ASSETS.drVega;
  if (text.includes('miller') || text.includes('janitor')) return GENERATED_ASSETS.janitorMiller;
  return '';
}

function playableAssetUrl(value: string | undefined) {
  const url = String(value ?? '').trim();
  if (!url || url === '#' || url.toLowerCase() === 'placeholder') return '';
  return url;
}

function sceneBackgroundUrl(scene: VisibleScene) {
  const fallback = defaultSceneBackgroundUrl(scene);
  if (isProjectPlaceholderAsset(scene.backgroundUrl, 'scenes')) return fallback;
  return playableAssetUrl(scene.backgroundUrl) || fallback;
}

function characterPortraitUrl(character: SceneCharacter) {
  const fallback = defaultCharacterPortraitUrl(character);
  if (isProjectPlaceholderAsset(character.imageUrl, 'characters')) return fallback;
  return playableAssetUrl(character.imageUrl) || fallback;
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
};

type VisibleScene = {
  sceneId: string;
  title: string;
  description: string;
  backgroundUrl: string;
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
  unlockedClues: Clue[];
  evidenceClues: Clue[];
  suspects: SceneCharacter[];
  sceneMap: SceneMapEntry[];
  completedSceneIds: string[];
  availableForAccusation: boolean;
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
  onProceed: () => void;
  onScene: (sceneId: string) => void;
  onPose: (pose: PlayerPose) => void;
};

class SirLockedPhaserScene extends Phaser.Scene {
  private callbacks: PhaserCallbacks;
  private state: GameState | null = null;
  private selectedInventoryItemId: string | null = null;
  private ready = false;
  private loadingTextureKeys = new Set<string>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private localPose: PlayerPose | null = null;
  private localPlayer: Phaser.GameObjects.Container | null = null;
  private remotePlayers = new Map<string, Phaser.GameObjects.Container>();
  private promptText: Phaser.GameObjects.Text | null = null;
  private nearestHotspot: Hotspot | null = null;
  private lastPoseSentAt = 0;
  private lastSentPoseKey = '';

  constructor(callbacks: PhaserCallbacks) {
    super('SirLockedPhaserScene');
    this.callbacks = callbacks;
  }

  create() {
    this.ready = true;
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.keys = (this.input.keyboard?.addKeys('W,A,S,D,E') ?? {}) as Record<string, Phaser.Input.Keyboard.Key>;
    this.scale.on('resize', () => this.draw());
    this.draw();
  }

  update(time: number, delta: number) {
    if (!this.ready || !this.state || !this.localPose || !this.localPlayer) return;

    const axis = this.inputAxis();
    const moving = axis.x !== 0 || axis.y !== 0;
    const speed = 225;
    const seconds = delta / 1000;
    const bounds = this.walkBounds();

    if (moving) {
      this.localPose.x = Phaser.Math.Clamp(this.localPose.x + axis.x * speed * seconds, bounds.left, bounds.right);
      this.localPose.y = Phaser.Math.Clamp(this.localPose.y + axis.y * speed * seconds, bounds.top, bounds.bottom);
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
    if (this.ready) this.draw();
  }

  updateRemotePose(pose: PlayerPose) {
    this.callbacks.playerPoses.set(pose.userId, pose);
    if (!this.ready || !this.state || pose.userId === this.callbacks.localUserId) return;
    if (pose.sceneId !== this.state.currentSceneId) {
      this.remotePlayers.get(pose.userId)?.destroy(true);
      this.remotePlayers.delete(pose.userId);
      return;
    }

    const container = this.remotePlayers.get(pose.userId) ?? this.createPlayer(pose, false);
    this.remotePlayers.set(pose.userId, container);
    this.placePlayer(container, pose);
  }

  removeRemotePose(userId: string) {
    this.callbacks.playerPoses.delete(userId);
    this.remotePlayers.get(userId)?.destroy(true);
    this.remotePlayers.delete(userId);
  }

  private draw() {
    if (!this.ready || !this.state) return;

    this.children.removeAll(true);
    this.remotePlayers.clear();
    this.localPlayer = null;
    this.promptText = null;
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
  }

  private drawBackground(scene: VisibleScene, width: number, height: number) {
    const bgUrl = sceneBackgroundUrl(scene);
    const bgKey = `bg:${scene.sceneId}:${bgUrl}`;

    if (bgUrl && this.textures.exists(bgKey)) {
      this.add.image(width / 2, height / 2, bgKey).setDisplaySize(width, height);
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

  private drawSceneLighting(width: number, height: number) {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x02050c, 0.34);
    graphics.fillRect(0, 0, width, height * 0.2);
    graphics.fillStyle(0x02050c, 0.52);
    graphics.fillRect(0, height * 0.8, width, height * 0.2);
    graphics.fillStyle(0x02050c, 0.34);
    graphics.fillRect(0, 0, width * 0.08, height);
    graphics.fillRect(width * 0.92, 0, width * 0.08, height);
  }

  private drawHotspots(scene: VisibleScene, width: number, height: number) {
    for (const hotspot of scene.hotspots) {
      const type = hotspot.type.toUpperCase();
      if (type === 'CHARACTER') continue;

      const x = (hotspot.x / 100) * width;
      const y = (hotspot.y / 100) * height;
      const w = Math.max((hotspot.width / 100) * width, 36);
      const h = Math.max((hotspot.height / 100) * height, 30);
      const inspected = type === 'ITEM' && this.state?.inspectedItemIds.includes(hotspot.targetId);
      const color = hotspot.isLocked ? 0x9da2aa : inspected ? 0x65b975 : 0xc9a84c;
      const alpha = hotspot.isLocked ? 0.12 : inspected ? 0.11 : 0.16;

      const rect = this.add.rectangle(x + w / 2, y + h / 2, w, h, color, alpha)
        .setStrokeStyle(2, color, hotspot.isLocked ? 0.68 : 0.92)
        .setInteractive({ useHandCursor: true });
      rect.setData('label', hotspot.label);

      const label = this.add.text(x + w / 2, y - 8, hotspot.isLocked ? 'Locked' : inspected ? 'Found' : hotspot.label, {
        fontFamily: 'Crimson Text, serif',
        fontSize: '15px',
        color: '#f4dc8f',
        backgroundColor: 'rgba(10,22,40,0.88)',
        padding: { x: 8, y: 4 },
      }).setOrigin(0.5, 1).setVisible(false);

      rect.on('pointerover', () => {
        rect.setFillStyle(color, alpha + 0.1);
        label.setVisible(true);
      });
      rect.on('pointerout', () => {
        rect.setFillStyle(color, alpha);
        label.setVisible(false);
      });
      rect.on('pointerdown', () => {
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

    const positioned = scene.hotspots.filter((hotspot) => hotspot.type.toUpperCase() === 'CHARACTER');
    for (const hotspot of positioned) {
      const character = scene.characters.find((ch) => ch.characterId === hotspot.targetId);
      if (!character) continue;
      this.drawCharacterButton(character, (hotspot.x / 100) * width, (hotspot.y / 100) * height, width, height);
    }

    const implicit = scene.characters.filter((ch) => !hotspotCharacterIds.has(ch.characterId));
    const count = Math.max(implicit.length, 1);
    implicit.forEach((character, index) => {
      const x = width * (0.58 + (index * 0.3 / count));
      const y = height * (0.42 + (index % 2) * 0.05);
      this.drawCharacterButton(character, x, y, width, height);
    });
  }

  private drawCharacterButton(character: SceneCharacter, x: number, y: number, width: number, height: number) {
    const group = this.add.container(x, y);
    const bodyW = Phaser.Math.Clamp(width * 0.1, 88, 138);
    const bodyH = Phaser.Math.Clamp(height * 0.28, 150, 250);
    const fresh = this.state?.visibleScene.availableDialogues
      .filter((dialogue) => dialogue.characterId === character.characterId && !dialogue.isAsked && !dialogue.isLocked).length ?? 0;

    const portraitUrl = characterPortraitUrl(character);
    const portraitKey = portraitUrl ? `portrait:${character.characterId}:${portraitUrl}` : '';

    const body = this.add.rectangle(0, bodyH / 2, bodyW, bodyH, 0x251c36, 0.64)
      .setStrokeStyle(1, 0xc9a84c, 0.32)
      .setInteractive({ useHandCursor: true });
    const portrait = this.add.circle(0, 32, 34, this.colorFromId(character.characterId, 0x3a2a55), 1)
      .setStrokeStyle(2, 0xc9a84c, 0.62)
      .setInteractive({ useHandCursor: true });

    let portraitImage: Phaser.GameObjects.Image | null = null;
    if (portraitKey && this.textures.exists(portraitKey)) {
      portraitImage = this.add.image(0, 32, portraitKey)
        .setDisplaySize(68, 68)
        .setInteractive({ useHandCursor: true });
    } else if (portraitKey && portraitUrl) {
      this.queueTexture(portraitKey, portraitUrl);
    }

    const initialText = this.add.text(0, 32, initials(character.name), {
      fontFamily: 'Playfair Display, Georgia, serif',
      fontSize: '22px',
      color: '#f4dc8f',
      fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(!portraitImage);

    const name = this.add.text(0, bodyH + 14, fresh ? `${character.name} (${fresh})` : character.name, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '16px',
      color: '#f7efd7',
      backgroundColor: 'rgba(10,22,40,0.88)',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5);

    const open = () => this.callbacks.onCharacter(character.characterId);
    body.on('pointerdown', open);
    portrait.on('pointerdown', open);
    portraitImage?.on('pointerdown', open);
    body.on('pointerover', () => body.setStrokeStyle(2, 0xc9a84c, 0.86));
    body.on('pointerout', () => body.setStrokeStyle(1, 0xc9a84c, 0.32));

    group.add([body, portrait, ...(portraitImage ? [portraitImage] : []), initialText, name]);
  }

  private drawPlayers() {
    if (!this.state) return;
    const localPlayerInfo = this.state.players.find((p) => p.userId === this.callbacks.localUserId);
    this.localPose = this.callbacks.playerPoses.get(this.callbacks.localUserId) ?? this.spawnPose(localPlayerInfo, 0);
    this.localPose.sceneId = this.state.currentSceneId;
    this.localPlayer = this.createPlayer(this.localPose, true);
    this.placePlayer(this.localPlayer, this.localPose);
    this.callbacks.playerPoses.set(this.localPose.userId, { ...this.localPose });

    this.state.players
      .filter((player) => player.userId !== this.callbacks.localUserId)
      .forEach((player, index) => {
        const pose = this.callbacks.playerPoses.get(player.userId) ?? this.spawnPose(player, index + 1);
        if (pose.sceneId !== this.state!.currentSceneId) return;
        const container = this.createPlayer({ ...pose, username: player.username, role: player.role }, false);
        this.remotePlayers.set(player.userId, container);
        this.placePlayer(container, pose);
      });
  }

  private createPlayer(pose: PlayerPose, isLocal: boolean) {
    const color = this.playerColor(pose.role, isLocal);
    const label = this.playerLabel(pose);
    const container = this.add.container(pose.x, pose.y).setDepth(isLocal ? 80 : 70);
    const shadow = this.add.ellipse(0, 28, 54, 14, 0x000000, 0.38);
    const coat = this.add.rectangle(0, -10, 34, 58, color, isLocal ? 0.96 : 0.78)
      .setStrokeStyle(isLocal ? 2 : 1, isLocal ? 0xf4dc8f : 0x9da2aa, isLocal ? 0.9 : 0.55);
    const head = this.add.circle(0, -50, 16, 0xd7b98f, 1)
      .setStrokeStyle(1, 0x1d1624, 0.8);
    const hat = this.add.rectangle(0, -69, 42, 8, 0x17131c, 1);
    const brim = this.add.rectangle(0, -63, 54, 6, 0x17131c, 1);
    const name = this.add.text(0, 42, label, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '14px',
      color: isLocal ? '#f4dc8f' : '#d9d4c4',
      backgroundColor: 'rgba(10,22,40,0.82)',
      padding: { x: 7, y: 3 },
    }).setOrigin(0.5);

    container.add([shadow, coat, head, hat, brim, name]);
    return container;
  }

  private placePlayer(container: Phaser.GameObjects.Container, pose: PlayerPose) {
    container.setPosition(pose.x, pose.y);
    container.setScale(pose.direction === 'left' ? -1 : 1, 1);
    container.setDepth(Math.round(pose.y) + (pose.userId === this.callbacks.localUserId ? 100 : 80));
    const name = container.list[5] as Phaser.GameObjects.Text | undefined;
    name?.setScale(pose.direction === 'left' ? -1 : 1, 1);
    const coat = container.list[1] as Phaser.GameObjects.Rectangle | undefined;
    coat?.setRotation(pose.moving ? Math.sin(this.time.now / 90) * 0.035 : 0);
  }

  private drawControlHint(width: number, height: number) {
    this.add.text(18, height - 38, 'Move: WASD / Arrows    Interact: E or click', {
      fontFamily: 'Crimson Text, serif',
      fontSize: '15px',
      color: '#d9d4c4',
      backgroundColor: 'rgba(10,22,40,0.68)',
      padding: { x: 9, y: 5 },
    }).setDepth(120);

    this.promptText = this.add.text(width / 2, height - 126, '', {
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

    visited.slice(-2).forEach((entry, index) => {
      const x = index === 0 ? 92 : width - 92;
      const y = height * 0.52;
      this.drawButton(x, y, this.shorten(entry.title, 18), () => this.callbacks.onScene(entry.sceneId), 148);
    });

    const forwardLabel = completedCurrent && next ? `Go to ${this.shorten(next.title, 22)}` : 'Continue investigation';
    this.drawButton(width / 2, height - 54, forwardLabel, () => this.callbacks.onProceed(), 230, true);
  }

  private drawInventoryHint(width: number, height: number) {
    if (!this.selectedInventoryItemId) return;
    this.add.text(width / 2, height - 102, `Using: ${this.prettyId(this.selectedInventoryItemId)}`, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '17px',
      color: '#f4dc8f',
      backgroundColor: 'rgba(10,22,40,0.82)',
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5);
  }

  private drawButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
    buttonWidth = 160,
    isPrimary = false,
  ) {
    const button = this.add.rectangle(x, y, buttonWidth, 38, 0x0a1628, 0.86)
      .setStrokeStyle(1, 0xc9a84c, isPrimary ? 0.86 : 0.42)
      .setInteractive({ useHandCursor: true });
    const text = this.add.text(x, y, label, {
      fontFamily: 'Crimson Text, serif',
      fontSize: '16px',
      color: '#f4dc8f',
      align: 'center',
    }).setOrigin(0.5);

    button.on('pointerover', () => button.setFillStyle(0x2a2240, 0.9));
    button.on('pointerout', () => button.setFillStyle(0x0a1628, 0.86));
    button.on('pointerdown', onClick);

    return { button, text };
  }

  private inputAxis() {
    const left = this.cursors?.left?.isDown || this.keys.A?.isDown;
    const right = this.cursors?.right?.isDown || this.keys.D?.isDown;
    const up = this.cursors?.up?.isDown || this.keys.W?.isDown;
    const down = this.cursors?.down?.isDown || this.keys.S?.isDown;
    let x = Number(Boolean(right)) - Number(Boolean(left));
    let y = Number(Boolean(down)) - Number(Boolean(up));
    if (x !== 0 && y !== 0) {
      x *= 0.7071;
      y *= 0.7071;
    }
    return { x, y };
  }

  private walkBounds() {
    const width = this.scale.width;
    const height = this.scale.height;
    return {
      left: width * 0.08,
      right: width * 0.92,
      top: height * 0.56,
      bottom: height * 0.82,
    };
  }

  private spawnPose(player: RoomPlayer | undefined, slot: number): PlayerPose {
    const bounds = this.walkBounds();
    const x = Phaser.Math.Clamp(bounds.left + 120 + slot * 92, bounds.left, bounds.right);
    const y = bounds.bottom - slot * 18;
    return {
      userId: player?.userId ?? this.callbacks.localUserId,
      username: player?.username,
      role: player?.role,
      sceneId: this.state?.currentSceneId ?? '',
      x,
      y,
      direction: 'right',
      moving: false,
    };
  }

  private findNearestHotspot(pose: PlayerPose) {
    if (!this.state) return null;
    let nearest: Hotspot | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const hotspot of this.state.visibleScene.hotspots) {
      const type = hotspot.type.toUpperCase();
      if (type === 'CHARACTER') continue;
      const center = this.hotspotCenter(hotspot);
      const distance = Phaser.Math.Distance.Between(pose.x, pose.y, center.x, center.y);
      if (distance < 92 && distance < nearestDistance) {
        nearest = hotspot;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private hotspotCenter(hotspot: Hotspot) {
    const width = this.scale.width;
    const height = this.scale.height;
    return {
      x: ((hotspot.x + hotspot.width / 2) / 100) * width,
      y: ((hotspot.y + hotspot.height / 2) / 100) * height,
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
    if (poseKey === this.lastSentPoseKey || time - this.lastPoseSentAt < 80) return;
    this.lastPoseSentAt = time;
    this.lastSentPoseKey = poseKey;
    this.callbacks.onPose({ ...this.localPose });
  }

  private playerLabel(pose: PlayerPose) {
    if (pose.role === 'INVESTIGATOR') return 'Watson';
    if (pose.role === 'INTERROGATOR') return 'Sherlock';
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
    if (this.loadingTextureKeys.has(key) || this.textures.exists(key)) return;
    this.loadingTextureKeys.add(key);
    this.load.image(key, url);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.loadingTextureKeys.delete(key);
      this.draw();
    });
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
      this.loadingTextureKeys.delete(key);
    });
    if (!this.load.isLoading()) this.load.start();
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
  let stopped = false;
  let phaserGame: Phaser.Game | null = null;
  let phaserScene: SirLockedPhaserScene | null = null;
  const playerPoses = new Map<string, PlayerPose>();
  let poseErrorShown = false;

  const refetch = async () => applyState(await gameApi.state(roomId));

  function destroyPhaser() {
    if (phaserGame) {
      phaserGame.destroy(true);
      phaserGame = null;
      phaserScene = null;
    }
  }

  function applyState(fresh: GameState) {
    if (!fresh || (state && fresh.version < state.version)) return;
    state = fresh;
    if (state.roomStatus === 'COMPLETED') {
      window.location.hash = `#/result/${roomId}`;
      return;
    }
    draw();
  }

  const hub = createRoomConnection(roomId, {
    GameStateUpdated: (s: GameState) => applyState(s),
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
    SceneChanged: () => toast('You moved to a new location.', 'info'),
    StageChanged: ({ isFinalStageCompleted }: { isFinalStageCompleted: boolean }) => {
      toast(isFinalStageCompleted
        ? 'The final confrontation is ready.'
        : 'A new lead opens the next location.', 'success', 5500);
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
    destroyPhaser();
    const scene = state.visibleScene;

    render(app, `
    <div class="point-game point-game-phaser">
      <header class="game-hud">
        <div>
          <strong>${escapeHtml(scene.title)}</strong>
          <span class="muted small">${escapeHtml(state.caseTitle)} / Room ${escapeHtml(state.roomCode)}</span>
        </div>
        <div class="game-objective">${escapeHtml(state.currentObjective)}</div>
        <div class="game-players">${playersHtml()}</div>
      </header>

      <main class="scene-canvas phaser-scene-wrap">
        <div id="${hostId}" class="phaser-game-host"></div>
        <div class="scene-title-card">
          <h2>${escapeHtml(scene.title)}</h2>
          <p>${escapeHtml(scene.description)}</p>
        </div>
        <div class="scene-tools">
          <button class="round-tool" id="case-file-btn" title="Case file">Case File <span class="badge">${state.unlockedClues.length}</span></button>
          <button class="round-tool" id="map-btn" title="Locations">Map</button>
          <button class="round-tool" id="log-btn" title="Action log">Log</button>
          <button class="round-tool ${state.availableForAccusation ? 'is-hot' : ''}" id="accuse-btn" ${state.availableForAccusation ? '' : 'disabled'} title="Final accusation">Accuse</button>
        </div>
      </main>

      ${inventoryBar()}
      ${introOverlay(myRole())}
      ${overlayHtml()}
      ${accusationModal()}
    </div>`);

    bind();
    mountPhaser();
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
        overlay = { type: 'dialogue', characterId };
        draw();
      },
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
        width: host.clientWidth || 1280,
        height: host.clientHeight || 640,
      },
      scene: phaserScene,
      render: {
        antialias: true,
        pixelArt: false,
      },
    });

    phaserScene.updateGameState(state, selectedInventoryItemId);
  }

  function playersHtml() {
    return state!.players.map((p) => `
      <span class="chip ${p.userId === me.userId ? 'chip-gold' : ''}" title="${escapeHtml(p.username)}">
        ${escapeHtml(p.username.split(' ')[0])} / ${p.role === 'INVESTIGATOR' ? 'INV' : 'INT'}
      </span>`).join('');
  }

  function inventoryBar() {
    const itemsById = new Map(state!.visibleScene.items.map((i) => [i.itemId, i]));
    const collected = state!.collectedItemIds.map((id) => itemsById.get(id) ?? { itemId: id, name: prettyId(id), imageUrl: '' });
    return `
    <footer class="inventory-bar">
      <span class="inventory-title">Inventory</span>
      <div class="inventory-items">
        ${collected.length === 0
          ? '<span class="muted small">Collected items appear here.</span>'
          : collected.map((item) => `
            <button class="inventory-item ${selectedInventoryItemId === item.itemId ? 'is-selected' : ''}"
                    data-inventory="${escapeHtml(item.itemId)}" title="${escapeHtml(item.name)}">
              <span class="inventory-icon" style="${placeholderStyle(item.itemId)}">
                <img src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.remove()">
              </span>
              <span>${escapeHtml(item.name)}</span>
            </button>`).join('')}
      </div>
      <span class="muted small">${selectedInventoryItemId ? `Using: ${prettyId(selectedInventoryItemId)}` : 'Select an item, then click the scene.'}</span>
    </footer>`;
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
    if (overlay.type === 'puzzle') return puzzleOverlay(overlay.label, overlay.message);
    return '';
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

  function puzzleOverlay(label: string, message: string) {
    return `
    <div class="overlay">
      <div class="modal">
        <h2>${escapeHtml(label || 'Locked object')}</h2>
        <p>${escapeHtml(message || 'This needs another clue or item before it can be opened.')}</p>
        <div class="puzzle-pad">
          <button class="puzzle-key" disabled>1</button><button class="puzzle-key" disabled>2</button><button class="puzzle-key" disabled>3</button>
          <button class="puzzle-key" disabled>4</button><button class="puzzle-key" disabled>5</button><button class="puzzle-key" disabled>6</button>
        </div>
        <p class="muted small">Puzzle interactions can be backed by future hotspot JSON. For now this hotspot is gated by case conditions.</p>
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
                        data-dialogue="${escapeHtml(d.dialogueId)}" ${d.isLocked ? 'disabled' : ''}>
                  <span>${d.isLocked ? 'Locked' : d.isAsked ? 'Asked' : 'Ask'}</span>
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

  function bind() {
    app.querySelector('#intro-dismiss')?.addEventListener('click', () => {
      sessionStorage.setItem(introKey, '1');
      app.querySelector('#intro-overlay')?.remove();
    });

    app.querySelectorAll('[data-inventory]').forEach((button) =>
      button.addEventListener('click', () => {
        const element = button as HTMLElement;
        selectedInventoryItemId = selectedInventoryItemId === element.dataset.inventory ? null : element.dataset.inventory ?? null;
        draw();
      }));

    app.querySelector('#case-file-btn')?.addEventListener('click', () => { overlay = { type: 'case' }; draw(); });
    app.querySelector('#map-btn')?.addEventListener('click', () => { overlay = { type: 'map' }; draw(); });
    app.querySelector('#log-btn')?.addEventListener('click', () => { overlay = { type: 'log' }; draw(); });
    app.querySelector('#accuse-btn')?.addEventListener('click', () => {
      accusation = { step: 1, culpritId: null, evidenceIds: new Set(state!.evidenceClues.map((c) => c.clueId)) };
      draw();
    });

    app.querySelectorAll('[data-scene]').forEach((s) =>
      s.addEventListener('click', async () => {
        const sceneId = (s as HTMLElement).dataset.scene;
        if (sceneId) await goToScene(sceneId);
      }));

    app.querySelectorAll('[data-close-overlay]').forEach((button) =>
      button.addEventListener('click', () => { overlay = null; draw(); }));

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
    app.querySelector('#accuse-cancel')?.addEventListener('click', () => { accusation = null; draw(); });
    app.querySelector('#accuse-review')?.addEventListener('click', () => { if (accusation) accusation.step = 2; draw(); });
    app.querySelector('#accuse-back')?.addEventListener('click', () => { if (accusation) accusation.step = 1; draw(); });
    app.querySelector('#accuse-confirm')?.addEventListener('click', submitAccusation);
  }

  async function onHotspot({ type, target, locked, label }: HotspotClick) {
    if (selectedInventoryItemId) {
      toast(`Tried using ${prettyId(selectedInventoryItemId)} on ${label || prettyId(target)}. No reaction yet.`, 'info');
      selectedInventoryItemId = null;
      draw();
      return;
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

  async function completeScene() {
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
    destroyPhaser();
    return hub.stop();
  };
}
