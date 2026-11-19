/**
 * What the outfits add on top of their sprite sheets (see playerSkins.ts): the warm light of Sherlock's lantern at
 * night, the glowing footprints his magnifier finds, and the herbal smoke from Watson's mask. Everything is drawn in
 * code, scaled like the player, and cleans itself up; nothing here changes where a player stands or what they can do.
 */
import Phaser from 'phaser';
import { clipDirection, type Cardinal, type Facing } from './pixelActors.js';
import { footprintTrail } from './playerSkins.js';

const GLOW_TEXTURE = 'skin-fx-glow';

/** A soft round light, drawn once per game. */
export function ensureGlowTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(GLOW_TEXTURE)) return GLOW_TEXTURE;
  const size = 64;
  const canvas = scene.textures.createCanvas(GLOW_TEXTURE, size, size);
  const context = canvas?.getContext();
  if (canvas && context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    canvas.refresh();
  }
  return GLOW_TEXTURE;
}

/** Glowing footprints that fade in one after another while Sherlock peers through the magnifier. */
export function spawnFootprints(scene: Phaser.Scene, feet: { x: number; y: number }, scale: number, facing: Facing, depth: number) {
  const glow = ensureGlowTexture(scene);
  footprintTrail(facing).forEach((print, index) => {
    const x = feet.x + print.x * scale;
    const y = feet.y + print.y * scale;
    const halo = scene.add.image(x, y, glow).setDepth(depth).setTint(0xf6c860).setAlpha(0)
      .setDisplaySize(16 * scale, 12 * scale).setBlendMode(Phaser.BlendModes.ADD);
    const sole = scene.add.ellipse(x, y, 4 * scale, 7 * scale, 0xfff2c4, 1).setDepth(depth).setAlpha(0).setRotation(print.angle);
    // A redraw of the scene removes everything; the tweens must not keep animating what is gone.
    halo.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(halo));
    sole.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(sole));
    const delay = 450 + index * 150;
    scene.tweens.add({ targets: [halo, sole], alpha: { from: 0, to: 0.9 }, duration: 260, delay });
    scene.tweens.add({
      targets: [halo, sole], alpha: 0, duration: 700, delay: 2900 + index * 60,
      onComplete: () => { halo.destroy(); sole.destroy(); },
    });
  });
}

/** Puffs of pale green herbal smoke from the beak of Watson's mask while he shakes the potion. */
export function spawnHerbalSmoke(scene: Phaser.Scene, feet: { x: number; y: number }, scale: number, facing: Facing,
  anchors: Partial<Record<Cardinal, { x: number; y: number }>> | undefined, depth: number) {
  const glow = ensureGlowTexture(scene);
  const direction = clipDirection(facing);
  const anchor = anchors?.[direction] ?? { x: 0, y: -62 };
  const drift = direction === 'east' ? 1 : direction === 'west' ? -1 : 0;
  for (let index = 0; index < 7; index += 1) {
    const puff = scene.add.image(feet.x + anchor.x * scale, feet.y + anchor.y * scale, glow)
      .setDepth(depth).setTint(index % 2 ? 0x9fe0a4 : 0x7fd08c).setAlpha(0).setDisplaySize(6 * scale, 6 * scale);
    puff.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf(puff));
    const delay = 650 + index * 130;
    const size = (14 + index * 1.5) * scale;
    scene.tweens.add({ targets: puff, alpha: { from: 0, to: 0.6 }, duration: 220, delay });
    scene.tweens.add({
      targets: puff,
      x: puff.x + (drift * 10 + (index % 3 - 1) * 5) * scale,
      y: puff.y - (16 + index * 2) * scale,
      displayWidth: size,
      displayHeight: size,
      duration: 1500,
      delay,
      ease: 'Sine.easeOut',
    });
    scene.tweens.add({ targets: puff, alpha: 0, duration: 700, delay: delay + 900, onComplete: () => puff.destroy() });
  }
}

/** The lantern's light: a warm glow that follows the lantern and flickers a little. */
export function lanternLight(scene: Phaser.Scene, scale: number): Phaser.GameObjects.Image {
  return scene.add.image(0, 0, ensureGlowTexture(scene)).setTint(0xffb54a).setBlendMode(Phaser.BlendModes.ADD)
    .setDisplaySize(64 * scale, 52 * scale).setAlpha(0.38);
}

/** Moves the lantern light to the lantern for this facing; `time` drives the flicker. */
export function placeLanternLight(light: Phaser.GameObjects.Image, anchors: Partial<Record<Cardinal, { x: number; y: number }>>,
  facing: Facing, scale: number, time: number, steady = false) {
  const anchor = anchors[clipDirection(facing)] ?? { x: 0, y: -50 };
  light.setPosition(anchor.x * scale, anchor.y * scale);
  // Facing east he holds the lantern on the far side, half hidden by the coat, so its light is weaker.
  const base = clipDirection(facing) === 'east' ? 0.26 : 0.38;
  light.setAlpha(steady ? base : base + Math.sin(time / 90) * 0.03 + Math.sin(time / 37) * 0.02);
}
