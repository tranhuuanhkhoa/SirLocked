import { avatarImg } from './avatars.js';
import { EN } from './fx.js';
import { FR, paintFrame } from './frames.js';
import { RAR, applyCosmetic, frameKey, isKnownCosmetic, titleKey, entranceKey } from './index.js';
import { T } from './titles.js';

/*
 * Cosmetics as sprites for the chest reel and its content list, which draw every item from a canvas. They are
 * painted smoothly at high resolution (`smooth` tells the reel not to pixelate them), and art that is still
 * loading repaints the same canvas, so the reel picks it up by itself.
 */
const SIZE = 192;
const LOGICAL = 48;
const FRAME_REPAINTS_MS = [200, 600, 1500, 3500];
const memo = new Map();

function sprite(paint) {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  paint(c);
  return { c, w: LOGICAL, h: LOGICAL, smooth: true };
}

function frameSprite(id) {
  return sprite((canvas) => {
    const paint = () => paintFrame(canvas, id, 2.2, avatarImg('nonla'));
    paint();
    for (const delay of FRAME_REPAINTS_MS) setTimeout(paint, delay);
  });
}

function wrap(context, text, maxWidth) {
  const lines = [];
  for (const word of text.split(' ')) {
    const last = lines[lines.length - 1];
    if (last && context.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function titleSprite(id) {
  const title = T[id] ?? T['tan-binh'];
  const color = RAR[title.r]?.c ?? RAR.common.c;
  return sprite((canvas) => {
    const x = canvas.getContext('2d');
    x.fillStyle = '#12100d';
    x.strokeStyle = color;
    x.lineWidth = 7;
    x.beginPath();
    x.moveTo(26, 30); x.lineTo(166, 30); x.lineTo(184, 96); x.lineTo(166, 162); x.lineTo(26, 162); x.lineTo(8, 96); x.closePath();
    x.fill();
    x.stroke();
    x.fillStyle = '#F2EAD8';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '700 32px "Cormorant SC", Georgia, serif';
    const lines = wrap(x, title.n, 150);
    lines.forEach((line, index) => x.fillText(line, 96, 96 + (index - (lines.length - 1) / 2) * 36));
  });
}

function entranceSprite(id) {
  const entrance = EN[id] ?? EN['lang-le'];
  const color = RAR[entrance.r]?.c ?? RAR.common.c;
  return sprite((canvas) => {
    const x = canvas.getContext('2d');
    const glow = x.createRadialGradient(70, 62, 8, 96, 96, 88);
    glow.addColorStop(0, color);
    glow.addColorStop(1, '#07080C');
    x.fillStyle = glow;
    x.strokeStyle = color;
    x.lineWidth = 6;
    x.beginPath();
    x.arc(96, 96, 84, 0, Math.PI * 2);
    x.fill();
    x.stroke();
    x.save();
    x.translate(36, 36);
    x.scale(5, 5);
    x.fillStyle = 'transparent';
    x.strokeStyle = '#F2EAD8';
    x.lineWidth = 1.6;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.stroke(new Path2D(entrance.ic));
    x.restore();
  });
}

/** The sprite of a FRAME, TITLE or ENTRANCE item definition. */
export function cosmeticSprite(def) {
  if (!memo.has(def.id)) {
    // Made after this page loaded, perhaps: its definition is right here. It says nothing about levels or chests, so it does not touch what is known.
    if (def.visual && !isKnownCosmetic(def.id)) applyCosmetic(def);
    const make = def.category === 'FRAME'
      ? () => frameSprite(FR[frameKey(def.id)] ? frameKey(def.id) : 'none')
      : def.category === 'TITLE'
        ? () => titleSprite(titleKey(def.id))
        : () => entranceSprite(entranceKey(def.id));
    memo.set(def.id, make());
  }
  return memo.get(def.id);
}

export const isCosmeticDef = (def) => ['FRAME', 'TITLE', 'ENTRANCE'].includes(def?.category);
