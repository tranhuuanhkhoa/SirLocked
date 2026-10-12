import type { CharacterPresentation } from './presentationMedia.js';

/** Keep frame selection independent of rendering and collision coordinates. */
export function idleFrameAt(sheet: NonNullable<CharacterPresentation['spriteSheet']>, time: number, phase = 0) {
  const count = Math.max(1, Math.floor(sheet.frameCount));
  const frames = (sheet.idleFrames ?? []).filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < count);
  const sequence = frames.length ? frames : Array.from({ length: count }, (_, index) => index);
  const fps = Math.max(1, Math.min(12, sheet.fps || 5));
  return sequence[Math.floor(Math.max(0, time + phase) * fps / 1000) % sequence.length];
}

export function usableSpriteSheet(sheet?: CharacterPresentation['spriteSheet']) {
  return Boolean(sheet?.url && sheet.frameWidth > 0 && sheet.frameHeight > 0
    && Number.isInteger(sheet.frameWidth) && Number.isInteger(sheet.frameHeight)
    && Number.isInteger(sheet.frameCount) && sheet.frameCount >= 1 && sheet.frameCount <= 64);
}
