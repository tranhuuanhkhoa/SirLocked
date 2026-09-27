// Builds the layered asset production plan (asset-prompts v2) for a SirLocked case.
// Usage: node scripts/build_asset_prompts.mjs <case.json> <output.json>
//
// Coordinate contract: hotspot percentages are converted to pixels on the
// 1600x900 logical frame. ITEM hotspots double as reserved empty slots in the
// background layer; CHARACTER hotspots are NPC standing gaps.

import { readFileSync, writeFileSync } from 'node:fs';

const FRAME_W = 1600;
const FRAME_H = 900;
const WALKWAY = { yTopPx: Math.round(0.70 * FRAME_H), yBottomPx: Math.round(0.85 * FRAME_H) };

const [, , caseFile, outFile] = process.argv;
if (!caseFile || !outFile) {
  console.error('Usage: node scripts/build_asset_prompts.mjs <case.json> <output.json>');
  process.exit(1);
}

const gameCase = JSON.parse(readFileSync(caseFile, 'utf8'));

const STYLE = {
  styleName: 'chibi-pixel-adventure',
  base:
    '2D cozy detective adventure game, chibi pixel art style: characters with oversized heads (about 40% of total height), ' +
    'short stubby bodies, large expressive eyes, clean dark outlines, flat cel shading with two tone steps, crisp pixel edges ' +
    '(nearest-neighbor look, no anti-aliasing, no blur), muted Victorian gaslight-era palette (deep teal, warm sepia, brass gold, oxblood red).',
  lighting: 'warm gaslight illumination, key light from the upper-left, soft amber wall sconces, gentle vignette at frame top and bottom',
  camera: 'single fixed side-view camera at standing eye level, flat orthographic feel, no perspective distortion',
  frame: { width: FRAME_W, height: FRAME_H },
  walkwayPx: WALKWAY,
};

const pct = (v, total) => Math.round((v / 100) * total);
const rectPx = (h) => ({
  x: pct(h.x, FRAME_W),
  y: pct(h.y, FRAME_H),
  width: pct(h.width, FRAME_W),
  height: pct(h.height, FRAME_H),
});

const slug = (id) => String(id).replace(/^(scene|char|item|clue|dlg|hotspot)-/, '');

const charactersById = new Map(gameCase.characters.map((c) => [c.characterId, c]));
const itemsById = new Map(gameCase.items.map((i) => [i.itemId, i]));

// ---------- background layer prompts (Google Nano Banana) ----------
// Furniture-only rewrites of the scene descriptions for the image model.
// The original case descriptions mention people and portable props (the body,
// the makeup kit, the cyanide bottle...) which the painter must NOT include -
// describing them at all confuses the model, so the art brief omits them.
const ART_DESCRIPTIONS = {
  'scene-dressing-room':
    'A plush Victorian dressing room dimly lit by warm gaslight sconces on the left wall. A large ornate gilt mirror and a vanity table with a completely bare tabletop stand against the back wall center-right. An empty red velvet chaise lounge sits against the left wall beneath a framed theater playbill. A small writing desk with a closed drawer and a bare top stands on the right. Rich crimson wallpaper, gold trim, deep shadows.',
  'scene-backstage-hallway':
    'A narrow backstage corridor. Empty props tables and a blank corkboard line the left wall; a costume rack with hanging Victorian costumes stands on the right. Wooden crates and faded theater posters along the walls. Overhead gaslight casts long shadows down the corridor.',
  'scene-owners-office':
    'A stately Victorian office dominated by a large mahogany desk in the center with a bare, empty desktop. An empty key rack hangs beside the door on the left wall. A brass desk lamp glows warmly at the desk corner. Heavy drapes frame a tall window behind the desk; bookshelves and framed certificates line the side walls.',
  'scene-props-room':
    'A cluttered theater props workshop lined with shelves of dusty prop bottles, masks and theatrical props. A sturdy wooden workbench with a bare, clear top stands beneath a flickering gas lamp. One middle shelf section is left conspicuously empty. Tools hang on the wall; the room feels dusty and warm.',
  'scene-theater-lobby':
    'The grand theater lobby with dimmed crystal chandeliers, red velvet curtains and gilded columns. A ticket booth stands on the left; a refreshments table with a bare top near the left-center; tall main entrance doors on the right; a decorative column right-of-center. Soft glow of a single gaslight, polished marble floor open across the entire foreground.',
};

const backgrounds = [];
for (const stage of gameCase.stages) {
  for (const scene of stage.scenes) {
    const itemSlots = scene.hotspots
      .filter((h) => h.type.toUpperCase() === 'ITEM')
      .map((h) => ({
        slotForItemId: h.targetId,
        label: h.label,
        ...rectPx(h),
      }));
    const npcGaps = scene.hotspots
      .filter((h) => h.type.toUpperCase() === 'CHARACTER')
      .map((h) => ({
        characterId: h.targetId,
        characterName: charactersById.get(h.targetId)?.name ?? h.targetId,
        ...rectPx(h),
      }));

    // Coordinates NEVER go into the image prompt (the model would paint the
    // rectangles and labels into the picture). They live only in the JSON
    // metadata for the compositing step. The prompt speaks natural language.
    const posWord = (centerXPx) => {
      const r = centerXPx / FRAME_W;
      if (r < 0.2) return 'far left';
      if (r < 0.4) return 'left';
      if (r < 0.62) return 'center';
      if (r < 0.82) return 'right';
      return 'far right';
    };
    const slotPositions = [...new Set(itemSlots.map((s) => posWord(s.x + s.width / 2)))];
    const emptySurfaceLine = slotPositions.length
      ? `The furniture surfaces on the ${slotPositions.join(', ')} of the frame each keep a completely bare, empty area with nothing standing on it. `
      : '';
    const gapPositions = [...new Set(npcGaps.map((g) => posWord(g.x + g.width / 2)))];
    const npcGapLine = gapPositions.length
      ? `Keep open floor space clear of furniture at the ${gapPositions.join(', ')} of the frame. `
      : '';

    backgrounds.push({
      sceneId: scene.sceneId,
      generator: 'google-nano-banana',
      target: scene.backgroundUrl,
      sizePx: { width: FRAME_W, height: FRAME_H },
      layers: {
        backgroundLayer: 'this image: fixed set dressing only, reserved slots left empty, walkway clear',
        overlayItemLayer: 'composited later from /assets/items sprites at the reserved slot coordinates',
        characterLayer: 'player + NPC sprites composited at runtime by the Phaser renderer',
      },
      reservedSlots: itemSlots,
      npcGaps,
      walkwayPx: WALKWAY,
      prompt:
        `Wide 2D side-scrolling adventure game interior set for "${scene.title}" in the Grand Lumiere Theater. ` +
        `${STYLE.camera}. 16:9 widescreen frame. ${STYLE.lighting}. ` +
        `Painted pixel-art hybrid environment that matches chibi pixel characters. ${STYLE.base} ` +
        `SET DESCRIPTION: ${ART_DESCRIPTIONS[scene.sceneId] ?? scene.description} ` +
        `STRICT RULES: This is an empty stage set. The room is completely unoccupied - absolutely no people, no characters, no figures, no bodies, no silhouettes, no animals anywhere in the image. ` +
        `Do not place any small portable props (no makeup kit, no letters, no papers, no vials, no photographs) on the bare surfaces - those arrive later as separate sprites. ` +
        emptySurfaceLine +
        npcGapLine +
        `The strip of floor running across the entire foreground of the room stays completely open and empty - flat floorboards or carpet only, no furniture standing on it. ` +
        `Render absolutely no text, no letters, no numbers, no labels, no captions, no boxes, no rectangles, no outlines, no highlight frames, no markers, no arrows, no UI elements, no grid lines and no watermark anywhere in the image.`,
    });
  }
}

// ---------- overlay item layer prompts (GPT image, transparent PNG) ----------
const itemSlotIndex = new Map();
for (const bg of backgrounds) {
  for (const s of bg.reservedSlots) itemSlotIndex.set(s.slotForItemId, { sceneId: bg.sceneId, ...s });
}

const itemOverlays = gameCase.items.map((item) => {
  const slot = itemSlotIndex.get(item.itemId);
  return {
    itemId: item.itemId,
    generator: 'gpt-image-transparent',
    target: item.imageUrl,
    sceneId: slot?.sceneId ?? null,
    targetSlotPx: slot ? { x: slot.x, y: slot.y, width: slot.width, height: slot.height } : null,
    prompt:
      `Single isolated game prop sprite: ${item.name}. ${item.description} ` +
      `Fully transparent background (PNG with alpha). Same fixed side-view eye-level camera as the scene sets, ` +
      `same warm gaslight key light from the upper-left, same chibi pixel adventure art style: clean dark outline, ` +
      `flat cel shading, crisp pixel edges, no anti-aliasing. No floor, no cast shadow outside the object silhouette, no text. ` +
      `The object must stay readable when scaled down small. Render no text, no labels, no boxes, no watermark.`,
  };
});

// ---------- character art: small in-scene chibi sprite + large dialogue portrait ----------
const characterArt = gameCase.characters.map((ch) => ({
  characterId: ch.characterId,
  name: ch.name,
  inSceneSprite: {
    generator: 'google-nano-banana',
    target: `/assets/characters/${slug(ch.characterId)}-sprite.png`,
    sizePx: { width: 256, height: 384 },
    chromaKey: '#00FF00',
    prompt:
      `Full-body chibi pixel game sprite of ${ch.name}, ${ch.role}: ${ch.description} ` +
      `Standing idle, side-view, facing left. ${STYLE.base} Victorian gaslight-era costume. ` +
      `Centered, whole body inside frame, feet near the bottom edge. ` +
      `SOLID UNIFORM CHROMA-KEY GREEN BACKGROUND (#00FF00), no ground line, no shadows, no props, no text.`,
  },
  dialoguePortrait: {
    generator: 'google-nano-banana',
    target: ch.imageUrl,
    sizePx: { width: 512, height: 512 },
    prompt:
      `Large pixel-art dialogue portrait of ${ch.name}, ${ch.role}: ${ch.description} ` +
      `Waist-up, three-quarter view facing left, detailed pixel shading, warm gaslight rim light from the upper-left, ` +
      `dark muted theater backdrop with soft vignette. Same chibi-inspired stylization as the in-scene sprites but with ` +
      `slightly more realistic proportions for close-up readability. Crisp pixel edges, no anti-aliasing, no text, no frame.`,
  },
}));

// ---------- fixed player characters: Sherlock & Watson sprites ----------
// Generated with GPT image (transparent PNG). A single clean side-view sprite
// per character; the walk motion is produced in-engine (bob + lean), because
// GPT keeps a single sprite consistent but drifts badly across sheet frames.
const playerSprites = [
  {
    role: 'INTERROGATOR',
    name: 'Sherlock Holmes',
    look:
      'tall lean young detective, sharp focused face, tousled dark brown hair under a brown deerstalker cap, ' +
      'long dark charcoal inverness overcoat, a deep plum-purple wool scarf around the neck',
  },
  {
    role: 'INVESTIGATOR',
    name: 'Dr John Watson',
    look:
      'shorter sturdy older doctor, neat grey hair, trimmed grey moustache, kind determined face, ' +
      'dark navy field jacket with a brown fur collar over a buttoned shirt, leather wristwatch',
  },
].map((p) => ({
  ...p,
  generator: 'gpt-image-transparent',
  target: `/assets/players/${p.name.split(' ').pop().toLowerCase()}.png`,
  sizePx: { width: 256, height: 448 },
  facing: 'right (the engine mirrors the sprite horizontally for left movement)',
  prompt:
    `Single full-body chibi pixel video-game character sprite of ${p.name}: ${p.look}. ${STYLE.base} ` +
    `Side profile view, facing right, mid-stride walking pose (one foot forward) so it reads as walking. ` +
    `Whole body inside the frame, head to feet, feet near the bottom edge, character vertically centered. ` +
    `Fully transparent background (PNG alpha), no ground line, no cast shadow, no text, no labels, no frame, no border. ` +
    `Same warm upper-left key light and muted Victorian gaslight palette as the game scenes.`,
}));

// ---------- cover ----------
const cover = {
  generator: 'google-nano-banana',
  target: gameCase.coverImageUrl,
  sizePx: { width: 1200, height: 675 },
  prompt:
    `Game cover illustration for "${gameCase.title}": ${gameCase.summary} ` +
    `${STYLE.base} ${STYLE.lighting}. A dramatic view of the Grand Lumiere Theater stage with the curtain half-drawn, ` +
    `title space left clear at the top third. No text.`,
};

const plan = {
  caseId: gameCase.caseId,
  title: gameCase.title,
  generatedAt: new Date().toISOString(),
  styleGuide: STYLE,
  workflow: {
    step1: 'generate ONE scene background first (dressing room), iterate until clean: no people, no painted-in props on the empty surfaces, no text/boxes',
    step2: 'use the approved background as a style-reference input image for the remaining 4 scenes so every scene shares the same palette, camera and lighting (Nano Banana accepts reference images)',
    step3: 'after a background is final, overlay the reservedSlots/npcGaps rectangles from this file on top of it and compare: if a furniture surface drifted away from its slot rectangle, update the hotspot x/y in case.json (percent coords) and re-import the case - do NOT regenerate the image to chase coordinates',
    step4: 'item overlay sprites and character sprites are generated independently; they only need to match style and lighting direction, the engine places them by coordinates',
    coordinateRule: 'pixel coordinates in this file are compositor/renderer metadata ONLY - never paste them into an image prompt, the model will paint the rectangles and labels into the picture',
  },
  compositing: {
    frame: { width: FRAME_W, height: FRAME_H },
    rule1: 'background layer is generated with reserved slots left empty; item overlay sprites are composited into reservedSlots rectangles by coordinates',
    rule2: 'NPC chibi sprites (chroma green removed) are placed by the renderer at npcGaps rectangles; dialogue popups use the large dialoguePortrait image',
    rule3: 'Sherlock and Watson walk horizontally inside the walkway band; all layers must share the same camera angle, lighting direction (upper-left key) and art style',
    rule4: 'no generated object may intrude into a reserved slot or NPC gap',
  },
  cover,
  backgrounds,
  itemOverlays,
  characterArt,
  playerSprites,
};

writeFileSync(outFile, JSON.stringify(plan, null, 2), 'utf8');
console.log(`Wrote ${outFile}`);
console.log(`backgrounds=${backgrounds.length} itemOverlays=${itemOverlays.length} characters=${characterArt.length} playerSprites=${playerSprites.length}`);
