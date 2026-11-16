// Builds an ordered PixelLab request plan (the 8-step pixel workflow) for a SirLocked case.
// Usage:
//   node scripts/build_pixellab_requests.mjs <case.json> <out.json>
//        [--style-ref <url>] [--map-description <text>] [--players]
//
// The script never calls PixelLab or any network API; it only writes the plan.
// Prompt wording comes from ai-game-docs/visual-style-templates/pixellab/templates.json.
// Output is deterministic: same case + options => byte-identical plan (no timestamps).
//
// Prompts stay ASCII-safe English. Case text in other languages (Vietnamese names,
// titles, descriptions) is kept only as metadata; English art direction is read from the
// case's `visualDescription` fields. Anything still unknown is left as a {{placeholder}}
// and listed under `missingInputs` so a person can fill it before sending.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEMPLATES_URL = new URL('../ai-game-docs/visual-style-templates/pixellab/templates.json', import.meta.url);

/** Fixed player characters (already exist in PixelLab; never re-created by this plan). */
export const PLAYERS = [
  { key: 'holmes', role: 'INVESTIGATOR', label: 'Sherlock Holmes V3 96', characterId: null,
    runtimeSheet: '/assets/pixel/players/holmes96-normal.png' },
  // character_id from ai-game-docs/pixel-case-lo-thuoc-thu-nam/pixellab-requests.json (watson-rotate)
  { key: 'watson', role: 'INTERROGATOR', label: 'Dr. John Watson V3 96', characterId: '1d31d2ec-5be3-4d26-995e-3d4a6946e682',
    runtimeSheet: '/assets/pixel/players/watson96.png' },
];
const PLAYER_PATTERN = /\b(sherlock|holmes|watson)\b/i;
const FACINGS = new Set(['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']);
const BUILDING_POSITIONS = ['West', 'East', 'South-west', 'South-east', 'North-west', 'North-east', 'South', 'North'];
const ICON_GRID = { columns: 4, rows: 4, cell: 64, maxItems: 16 };
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

// Vietnamese keyword -> English art direction lives in templates.json (`glossaries`), shared with the server's
// PixelLabPlanBuilder. Matched on lower-case text WITH diacritics, in list order, title before description.
// Results are drafts: every request that uses them is flagged needsReview.
//   place: [keyword, exterior on the outdoor map, interior room subject]; area, time, role: [keyword, English]

// ------------------------------------------------------------------ text helpers

const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;

/** Returns ASCII-safe text (typographic punctuation normalised) or null when other characters remain. */
export function asciiText(value) {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/…/g, '...').replace(/[ \s]+/g, ' ').trim();
  return text && /^[\x20-\x7e]*$/.test(text) ? text : null;
}

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const lowerVi = (value) => String(value ?? '').normalize('NFC').toLowerCase();
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);
const stripPeriod = (text) => text.replace(/[.\s]+$/, '');
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const numberWord = (n) => NUMBER_WORDS[n] ?? String(n);
const stripPrefixes = (id, prefixes) => prefixes.reduce((acc, prefix) => (acc.startsWith(prefix) ? acc.slice(prefix.length) : acc), String(id));
export const sceneKey = (sceneId) => stripPrefixes(sceneId, ['scene-', 'px-']);
export const characterKey = (characterId) => stripPrefixes(characterId, ['char-', 'px-']);
export const itemKey = (itemId) => stripPrefixes(itemId, ['item-', 'px-']);
export const caseSlug = (caseId) => stripPrefixes(caseId, ['case-', 'pixel-']).replace(/-(vi|en)$/, '');

function glossaryLookup(glossary, ...texts) {
  for (const text of texts) {
    const haystack = lowerVi(text);
    if (!haystack) continue;
    const hit = glossary.find(([needle]) => haystack.includes(needle));
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------ templates

export function loadTemplates(path = TEMPLATES_URL) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const byId = Object.fromEntries(data.templates.map((template) => [template.id, template]));
  return { ...data, byId };
}

/**
 * Fills a template's promptParts. Missing values fall back to the placeholder default; with no default
 * the {{name}} token stays in the text. Parts with `when` are kept only when values[when] === true.
 */
export function renderTemplate(template, values = {}) {
  const defs = template.placeholders ?? {};
  const pick = (name, token) => {
    const value = values[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    if (defs[name] && 'default' in defs[name]) return String(defs[name].default);
    return token;
  };
  const parts = [];
  for (const raw of template.promptParts ?? []) {
    const part = typeof raw === 'string' ? { text: raw } : raw;
    if (part.when && values[part.when] !== true) continue;
    const text = part.text.replace(/\{\{([A-Za-z][\w-]*)\}\}/g, (token, name) => pick(name, token)).replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }
  return parts.join(' ');
}

const tokensIn = (value) => {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') for (const m of v.matchAll(PLACEHOLDER)) found.add(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
};

// ------------------------------------------------------------------ case reading

function orderedScenes(gameCase) {
  return [...(gameCase.stages ?? [])]
    .map((stage, index) => ({ stage, index }))
    .sort((a, b) => (a.stage.order ?? 0) - (b.stage.order ?? 0) || a.index - b.index)
    .flatMap(({ stage }) => stage.scenes ?? []);
}

function classifyScenes(scenes, warnings) {
  const projection = (scene) => (scene.runtime?.render?.mode === 'pixel' ? scene.runtime.render.projection : null);
  const pixel = scenes.filter((scene) => projection(scene));
  if (!pixel.length) {
    if (scenes.length) warnings.push('No scene has runtime.render (pixel). Assumed: first scene = outdoor map (topdown), other scenes = interiors (isometric).');
    return { maps: scenes.slice(0, 1), interiors: scenes.slice(1), assumed: true };
  }
  for (const scene of scenes.filter((s) => !projection(s))) {
    warnings.push(`Scene ${scene.sceneId} has no pixel render block (legacy renderer); it is not part of this plan.`);
  }
  const maps = pixel.filter((scene) => projection(scene) === 'topdown');
  const interiors = pixel.filter((scene) => projection(scene) === 'isometric');
  return { maps, interiors, assumed: false };
}

const linked = (a, b) => (a.runtime?.transitions ?? []).some((t) => t.targetSceneId === b.sceneId)
  || (b.runtime?.transitions ?? []).some((t) => t.targetSceneId === a.sceneId);

function npcFacing(gameCase, characterId) {
  for (const scene of orderedScenes(gameCase)) {
    const placement = (scene.runtime?.characterPlacements ?? []).find((p) => p.characterId === characterId);
    if (placement && FACINGS.has(placement.direction)) return placement.direction;
  }
  return 'south';
}

// ------------------------------------------------------------------ plan builder

/**
 * @param {object} gameCase parsed case JSON
 * @param {{styleRef?: string|null, mapDescription?: string|null, players?: boolean, templates?: object}} options
 */
export function buildPlan(gameCase, options = {}) {
  const templates = options.templates ?? loadTemplates();
  const T = templates.byId;
  const era = templates.shared.era;
  const {
    place: PLACE_GLOSSARY, area: AREA_GLOSSARY, time: TIME_GLOSSARY, role: ROLE_GLOSSARY,
  } = templates.glossaries;
  const styleRef = options.styleRef || templates.shared.styleReference.url;
  const slug = caseSlug(gameCase.caseId ?? 'case');
  const art = `art/${slug}`;
  const pub = `/assets/pixel/${slug}`;
  const warnings = [];
  const requests = [];
  const add = (request) => { requests.push(request); return request; };

  if (options.mapDescription != null && !asciiText(options.mapDescription)) {
    throw new Error('--map-description must be ASCII English text.');
  }

  const scenes = orderedScenes(gameCase);
  const { maps, interiors, assumed } = classifyScenes(scenes, warnings);
  const itemsById = new Map((gameCase.items ?? []).map((item) => [item.itemId, item]));
  const mapOf = (interior) => maps.find((map) => linked(map, interior)) ?? maps[0];
  if (maps.length > 1 && options.mapDescription) warnings.push('--map-description applies to the first outdoor map only.');
  if (!maps.length && interiors.length) warnings.push('No topdown scene: interiors have no outdoor map to crop an exterior reference from.');

  const paintedItems = (scene) => (scene.itemIds ?? []).map((id) => itemsById.get(id)).filter(Boolean).map((item) => ({
    itemId: item.itemId, name: item.name, visualDescription: asciiText(item.visualDescription) ?? '',
  }));

  const base = (template, extra) => ({
    tool: template.tool,
    template: template.id,
    params: { ...(template.fixedParams ?? {}) },
    promptParam: template.promptParam ?? null,
    ...extra,
  });

  // ---------------- step 1: outdoor map(s)
  const mapRequests = new Map();
  maps.forEach((scene, mapIndex) => {
    const key = sceneKey(scene.sceneId);
    const buildings = interiors.filter((interior) => (maps.length === 1 ? true : mapOf(interior) === scene));
    const hints = {};
    let needsReview = false;
    const buildingLines = buildings.map((interior, index) => {
      const ikey = sceneKey(interior.sceneId);
      const position = BUILDING_POSITIONS[index] ?? `Building ${index + 1}`;
      const hit = glossaryLookup(PLACE_GLOSSARY, interior.title, interior.description);
      const title = asciiText(interior.title);
      let exterior = hit?.[1] ?? (title ? `a building housing the ${title}` : null);
      if (hit) needsReview = true;
      if (!exterior) {
        exterior = `{{buildingExterior:${ikey}}}`;
        hints[`buildingExterior:${ikey}`] = { fillFrom: 'author', hint: 'English exterior of this building as seen from above: size, materials, roof, shopfront, one front door.',
          context: { sceneId: interior.sceneId, title: interior.title, description: interior.description } };
      }
      return `${index + 1}) ${position}: ${sentence(exterior)}`;
    });
    if (buildings.length > BUILDING_POSITIONS.length) warnings.push(`Map ${scene.sceneId}: ${buildings.length} buildings is crowded for one 512x512 map; consider merging or a bigger map.`);

    let areaDescription = mapIndex === 0 && options.mapDescription ? asciiText(options.mapDescription) : null;
    if (!areaDescription) {
      const area = glossaryLookup(AREA_GLOSSARY, scene.title, scene.description);
      const time = glossaryLookup(TIME_GLOSSARY, scene.title, scene.description);
      const title = asciiText(scene.title);
      if (area) { areaDescription = [area[1], time?.[1]].filter(Boolean).join(' '); needsReview = true; }
      else if (title) areaDescription = title;
    }
    if (!areaDescription) {
      hints.areaDescription = { fillFrom: '--map-description', hint: 'Short English phrase for the whole area with time of day, e.g. "riverside street block on a clear morning".',
        context: { sceneId: scene.sceneId, title: scene.title, description: scene.description } };
    }
    const layout = asciiText(scene.visualDescription);
    if (scene.visualDescription && !layout) warnings.push(`Scene ${scene.sceneId}: visualDescription is not ASCII English; ignored.`);
    // Pixel scenes paint investigation items into the background, so an outdoor map with items needs a layout text.
    const mustDescribe = !layout && paintedItems(scene).length > 0;
    if (mustDescribe) {
      hints.layoutDetails = { fillFrom: `scenes[sceneId=${scene.sceneId}].visualDescription`,
        hint: 'English sentences for the layout (edges, square, landmarks) that also paint every investigation item of this scene into the map.',
        context: { sceneId: scene.sceneId, title: scene.title, description: scene.description, paintedItems: paintedItems(scene) } };
    }
    const values = {
      era,
      areaDescription: areaDescription ?? undefined,
      layoutDetails: layout ? sentence(layout) : mustDescribe ? '{{layoutDetails}}' : '',
      buildingCountWord: cap(numberWord(buildings.length)),
      buildingList: buildingLines.join(' '),
      multipleBuildings: buildings.length >= 2,
      singleBuilding: buildings.length === 1,
    };
    const request = add(base(T['outdoor-map'], {
      id: `map.${key}`, step: 1, stage: 'outdoor-map',
      subject: { kind: 'scene', sceneId: scene.sceneId, title: scene.title, projection: 'topdown', assumedProjection: assumed || undefined },
      prompt: renderTemplate(T['outdoor-map'], values),
      references: [],
      dependsOn: [],
      estimatedGenerations: T['outdoor-map'].costGenerations,
      buildings: buildings.map((interior, index) => ({ sceneId: interior.sceneId, title: interior.title, position: BUILDING_POSITIONS[index] ?? `Building ${index + 1}` })),
      paintedItems: paintedItems(scene),
      needsReview,
      _hints: hints,
      outputs: [
        { kind: 'original', path: `${art}/map/${key}-512.png` },
        { kind: 'record', path: `${art}/map/${key}.request.json` },
        { kind: 'record', path: `${art}/map/${key}.receipt.json` },
        { kind: 'runtime', path: `${pub}/scenes/${key}.png` },
      ],
    }));
    mapRequests.set(scene.sceneId, request);
  });
  const firstMap = mapRequests.get(maps[0]?.sceneId);

  // ---------------- step 2: NPC front sprites, then v3 rotations
  const skippedCharacters = [];
  const npcs = [];
  for (const character of gameCase.characters ?? []) {
    if (PLAYER_PATTERN.test(character.name ?? '') || PLAYER_PATTERN.test(character.characterId ?? '')) {
      skippedCharacters.push({ characterId: character.characterId, name: character.name, reason: 'player character already exists in PixelLab' });
      continue;
    }
    npcs.push(character);
  }
  const npcInfo = npcs.map((character) => {
    const key = characterKey(character.characterId);
    const appearance = asciiText(character.visualDescription);
    if (character.visualDescription && !appearance) warnings.push(`Character ${character.characterId}: visualDescription is not ASCII English; ignored.`);
    if (appearance && character.name && fold(appearance).includes(fold(character.name))) {
      warnings.push(`Character ${character.characterId}: visualDescription contains the character name; names should stay out of prompts.`);
    }
    const roleEn = asciiText(character.role) ?? glossaryLookup(ROLE_GLOSSARY, character.role, character.description)?.[1] ?? null;
    const context = { characterId: character.characterId, name: character.name, role: character.role, description: character.description };
    const sceneIds = scenes.filter((scene) => (scene.characterIds ?? []).includes(character.characterId)).map((scene) => scene.sceneId);
    return { character, key, appearance, roleEn, context, sceneIds, facing: npcFacing(gameCase, character.characterId) };
  });
  const appearanceHint = (info, short) => ({
    fillFrom: `characters[characterId=${info.character.characterId}].visualDescription`,
    hint: `${short ? 'Short comma-separated' : 'One or two sentences of'} English ASCII appearance, no name${info.roleEn ? `, e.g. "a ${era} ${info.roleEn}, <age>, <build>, <hair and face>, <clothes>, <one held prop>"` : ''}.`,
    context: info.context,
  });
  for (const info of npcInfo) {
    const template = T['character-front'];
    const ref = template.references[0];
    add(base(template, {
      id: `front.${info.key}`, step: 2, stage: 'character-front',
      subject: { kind: 'npc', characterId: info.character.characterId, name: info.character.name, sceneIds: info.sceneIds },
      prompt: renderTemplate(template, { characterAppearance: info.appearance ? sentence(info.appearance) : undefined }),
      references: [{ param: ref.param, url: styleRef, usage: ref.usage, usageSent: ref.usageSent }],
      dependsOn: [],
      estimatedGenerations: template.costGenerations,
      expectedCandidates: template.expectedCandidates,
      _hints: { characterAppearance: appearanceHint(info, false) },
      outputs: [0, 1, 2, 3].map((n) => ({ kind: 'original', path: `${art}/chars/${info.key}/front-${n}.png` }))
        .concat([{ kind: 'record', path: `${art}/chars/${info.key}.front.request.json` }, { kind: 'record', path: `${art}/chars/${info.key}/front.receipt.json` }]),
    }));
  }
  for (const info of npcInfo) {
    const template = T['character-rotate'];
    const ref = template.references[0];
    add(base(template, {
      id: `rotate.${info.key}`, step: 2, stage: 'character-rotate',
      subject: { kind: 'npc', characterId: info.character.characterId, name: info.character.name },
      prompt: renderTemplate(template, { characterShortDescription: info.appearance ? stripPeriod(info.appearance) : undefined }),
      references: [{ param: ref.param, url: '{{frontCandidateUrl}}', usage: ref.usage, usageSent: ref.usageSent }],
      dependsOn: [`front.${info.key}`],
      estimatedGenerations: template.costGenerations,
      expectedResult: template.expectedResult,
      _hints: { characterShortDescription: appearanceHint(info, true) },
      _deps: { frontCandidateUrl: { from: `front.${info.key}`, how: 'Pick the straight-on south-facing candidate: https://api.pixellab.ai/mcp/images/<front job_id>/download?index=<n>.' } },
      outputs: [
        { kind: 'original', path: `${art}/chars/${info.key}/character.zip` },
        { kind: 'record', path: `${art}/chars/${info.key}/character.receipt.json` },
      ],
    }));
  }

  // ---------------- step 3: animations (NPC idle in the facing direction; players walk + idle on request)
  for (const info of npcInfo) {
    const template = T['character-idle'];
    add(base(template, {
      id: `idle.${info.key}`, step: 3, stage: 'character-idle',
      subject: { kind: 'npc', characterId: info.character.characterId, name: info.character.name },
      params: { ...template.fixedParams, character_id: '{{characterId}}', direction: info.facing },
      prompt: renderTemplate(template, {}),
      references: [],
      dependsOn: [`rotate.${info.key}`],
      calls: 1,
      estimatedGenerations: template.costPerDirection,
      _deps: { characterId: { from: `rotate.${info.key}`, how: 'character_id returned by create_character.' } },
      outputs: [
        { kind: 'original', path: `${art}/chars/${info.key}/spritesheet.zip` },
        { kind: 'record', path: `${art}/chars/${info.key}/idle.receipt.json` },
        { kind: 'runtime', path: `${pub}/characters/${info.key}-idle.png` },
        { kind: 'runtime', path: `${pub}/characters/${info.key}-portrait.png` },
      ],
    }));
  }
  if (options.players) {
    for (const player of PLAYERS) {
      for (const stage of ['character-walk', 'character-idle']) {
        const template = T[stage];
        add(base(template, {
          id: `${stage === 'character-walk' ? 'walk' : 'idle'}.${player.key}`, step: 3, stage,
          subject: { kind: 'player', role: player.role, label: player.label },
          params: { ...template.fixedParams, character_id: player.characterId ?? '{{characterId}}' },
          directions: ['south', 'east', 'north', 'west'],
          prompt: renderTemplate(template, {}),
          references: [],
          dependsOn: [],
          calls: 4,
          estimatedGenerations: template.costPerDirection * 4,
          _deps: player.characterId ? {} : { characterId: { from: 'existing', how: `character_id of the existing ${player.label} character in PixelLab (list_characters).` } },
          outputs: [{ kind: 'original', path: `art/players/${player.key}96/spritesheet.zip` }, { kind: 'runtime', path: player.runtimeSheet }],
        }));
      }
    }
  }

  // ---------------- step 5: object mask per outdoor map
  for (const scene of maps) {
    const key = sceneKey(scene.sceneId);
    const map = mapRequests.get(scene.sceneId);
    const template = T['object-mask'];
    const ref = template.references[0];
    add(base(template, {
      id: `mask.${key}`, step: 5, stage: 'object-mask',
      subject: { kind: 'scene', sceneId: scene.sceneId, title: scene.title },
      prompt: renderTemplate(template, {}),
      references: [{ param: ref.param, url: '{{mapImageUrl}}', usage: ref.usage, usageSent: ref.usageSent }],
      dependsOn: [map.id],
      estimatedGenerations: template.costGenerations,
      needsReview: true,
      reviewNote: 'Adjust objectList/groundList to what the generated map really shows before sending.',
      _deps: { mapImageUrl: { from: map.id, how: 'https://api.pixellab.ai/mcp/images/<map job_id>/download?index=0 (native 512, no upscale).' } },
      outputs: [
        { kind: 'original', path: `${art}/mask/${key}-mask-raw.png` },
        { kind: 'record', path: `${art}/mask/${key}.request.json` },
        { kind: 'record', path: `${art}/mask/${key}.receipt.json` },
      ],
    }));
  }

  // ---------------- step 7: interiors (one per isometric scene), then inventory icon sheets
  const interiorRequests = [];
  for (const scene of interiors) {
    const key = sceneKey(scene.sceneId);
    const map = mapRequests.get(mapOf(scene)?.sceneId) ?? firstMap;
    const template = T.interior;
    const ref = template.references[0];
    const hit = glossaryLookup(PLACE_GLOSSARY, scene.title, scene.description);
    const contents = asciiText(scene.visualDescription);
    if (scene.visualDescription && !contents) warnings.push(`Scene ${scene.sceneId}: visualDescription is not ASCII English; ignored.`);
    const roomSubject = hit?.[2] ?? asciiText(scene.title) ?? undefined;
    const items = paintedItems(scene);
    const hints = {};
    if (!roomSubject) hints.roomSubject = { fillFrom: 'author', hint: 'English room type, e.g. "apothecary shop".', context: { sceneId: scene.sceneId, title: scene.title, description: scene.description } };
    if (!contents) {
      hints.roomContents = { fillFrom: `scenes[sceneId=${scene.sceneId}].visualDescription`,
        hint: 'A few English sentences: furniture along the left wall, right wall and back corner, plus every investigation item of this scene painted into the room.',
        context: { sceneId: scene.sceneId, title: scene.title, description: scene.description, paintedItems: items } };
    }
    interiorRequests.push(add(base(template, {
      id: `interior.${key}`, step: 7, stage: 'interior',
      subject: { kind: 'scene', sceneId: scene.sceneId, title: scene.title, projection: 'isometric', assumedProjection: assumed || undefined },
      prompt: renderTemplate(template, { era, roomSubject, roomContents: contents ? sentence(contents) : undefined }),
      references: [{ param: ref.param, url: '{{exteriorCropRef}}', usage: ref.usage, usageSent: ref.usageSent,
        prepare: `Crop this building (roof, front wall and door) from the NATIVE 512 map of ${map?.id ?? 'the outdoor map'}, no upscale; upload it and pass the returned upload:<id> ref (uploads expire after a few days).` }],
      dependsOn: map ? [map.id] : [],
      estimatedGenerations: template.costGenerations,
      paintedItems: items,
      needsReview: Boolean(hit),
      _hints: hints,
      _deps: { exteriorCropRef: { from: map?.id ?? null, how: 'upload:<id> of the exterior crop.' } },
      outputs: [
        { kind: 'original', path: `${art}/interiors/${key}-512.png` },
        { kind: 'record', path: `${art}/interiors/${key}.request.json` },
        { kind: 'record', path: `${art}/interiors/${key}.receipt.json` },
        { kind: 'runtime', path: `${pub}/scenes/${key}.png` },
      ],
    })));
  }

  const iconCells = [];
  const iconIndex = new Map();
  for (const item of gameCase.items ?? []) {
    const url = typeof item.imageUrl === 'string' ? item.imageUrl.trim() : '';
    if (!url && item.isCollectible !== true) continue;
    const icon = /\/items\/([^/?#]+)\.png(?:[?#].*)?$/i.exec(url)?.[1] ?? itemKey(item.itemId);
    if (iconIndex.has(icon)) { iconIndex.get(icon).itemIds.push(item.itemId); continue; }
    const cell = { icon, itemIds: [item.itemId], name: item.name, visual: asciiText(item.visualDescription) };
    iconIndex.set(icon, cell);
    iconCells.push(cell);
  }
  const sheets = [];
  for (let i = 0; i < iconCells.length; i += ICON_GRID.maxItems) sheets.push(iconCells.slice(i, i + ICON_GRID.maxItems));
  const styleSource = interiorRequests[0] ?? firstMap;
  sheets.forEach((cells, sheetIndex) => {
    const n = sheetIndex + 1;
    const template = T['icon-sheet'];
    const ref = template.references[0];
    const hints = {};
    const grid = cells.map((cell, index) => {
      const token = `itemVisual:${cell.icon}`;
      if (!cell.visual) hints[token] = { fillFrom: `items[itemId=${cell.itemIds[0]}].visualDescription`, hint: 'Short English noun phrase for the icon, e.g. "small brown leather logbook".', context: { itemIds: cell.itemIds, name: cell.name } };
      const col = index % ICON_GRID.columns;
      const row = Math.floor(index / ICON_GRID.columns);
      return {
        cell: index, row: row + 1, col: col + 1,
        box: [col * ICON_GRID.cell, row * ICON_GRID.cell, (col + 1) * ICON_GRID.cell, (row + 1) * ICON_GRID.cell],
        icon: cell.icon, itemIds: cell.itemIds, name: cell.name,
        text: cell.visual ? stripPeriod(cell.visual) : `{{${token}}}`,
        runtimeAsset: `${pub}/items/${cell.icon}.png`,
      };
    });
    const rows = [];
    for (let r = 0; r * ICON_GRID.columns < grid.length; r++) {
      rows.push(`Row ${r + 1}: ${grid.slice(r * ICON_GRID.columns, (r + 1) * ICON_GRID.columns).map((g) => g.text).join('; ')}.`);
    }
    const empty = ICON_GRID.maxItems - cells.length;
    const values = {
      era,
      itemCountWord: numberWord(cells.length),
      gridRows: rows.join(' '),
      emptyCellsNote: empty > 0 ? `The remaining ${numberWord(empty)} cell${empty === 1 ? '' : 's'} after the last object stay${empty === 1 ? 's' : ''} empty.` : '',
    };
    const styleToken = styleSource?.stage === 'interior' ? 'interiorImageUrl' : 'mapImageUrl';
    add(base(template, {
      id: `icons.${n}`, step: 7, stage: 'icon-sheet',
      subject: { kind: 'items', sheet: n, count: cells.length },
      prompt: renderTemplate(template, values),
      references: [{ param: ref.param, url: `{{${styleToken}}}`, usage: ref.usage, usageSent: ref.usageSent }],
      dependsOn: styleSource ? [styleSource.id] : [],
      estimatedGenerations: template.costGenerations,
      grid,
      _hints: hints,
      _deps: { [styleToken]: { from: styleSource?.id ?? null, how: 'https://api.pixellab.ai/mcp/images/<job_id>/download?index=0 of that finished image.' } },
      outputs: [
        { kind: 'original', path: `${art}/items/sheet-${n}-256.png` },
        { kind: 'record', path: `${art}/items/sheet-${n}.request.json` },
        { kind: 'record', path: `${art}/items/sheet-${n}.receipt.json` },
        ...grid.map((g) => ({ kind: 'runtime', path: g.runtimeAsset })),
      ],
    }));
  });

  // ---------------- finalise requests: order, ASCII check, missing inputs
  let missingCount = 0;
  const finalRequests = requests.map((request, index) => {
    const { _hints = {}, _deps = {}, ...rest } = request;
    if (!/^[\x20-\x7e]*$/.test(rest.prompt)) throw new Error(`Prompt of ${rest.id} is not ASCII.`);
    const promptTokens = tokensIn(rest.prompt);
    const missingInputs = promptTokens.map((token) => ({ placeholder: `{{${token}}}`, ...(_hints[token] ?? { fillFrom: 'author', hint: 'Fill before sending.' }) }));
    missingCount += missingInputs.length;
    const depTokens = tokensIn([rest.params, rest.references]).filter((token) => !promptTokens.includes(token));
    const inputsFromDependencies = depTokens.map((token) => ({ placeholder: `{{${token}}}`, ...(_deps[token] ?? { from: null, how: 'Fill before sending.' }) }));
    return clean({
      id: rest.id,
      order: index + 1,
      step: rest.step,
      stage: rest.stage,
      tool: rest.tool,
      template: rest.template,
      subject: rest.subject,
      params: rest.params,
      directions: rest.directions,
      promptParam: rest.promptParam,
      prompt: rest.prompt,
      references: rest.references,
      dependsOn: rest.dependsOn,
      calls: rest.calls ?? 1,
      estimatedGenerations: rest.estimatedGenerations,
      expectedCandidates: rest.expectedCandidates,
      expectedResult: rest.expectedResult,
      buildings: rest.buildings,
      paintedItems: rest.paintedItems?.length ? rest.paintedItems : undefined,
      grid: rest.grid,
      needsReview: rest.needsReview || undefined,
      reviewNote: rest.reviewNote,
      missingInputs,
      inputsFromDependencies,
      rerollPolicy: 'ask-user-first',
      outputs: rest.outputs,
    });
  });

  // ---------------- local / optional steps (no AI calls planned)
  const localSteps = [];
  if (maps.length) {
    localSteps.push({
      id: 'ambient.optional', step: 4, kind: 'optional-pixellab', tool: T['ambient-animation'].tool, template: 'ambient-animation',
      dependsOn: [...mapRequests.values()].map((r) => r.id), estimatedGenerations: null,
      note: 'Optional. Choose a crop of the NATIVE map by eye (water, fountain, flags), send it as first and last frame, composite the frames back at the exact crop coordinates. Not planned automatically.',
    });
  }
  for (const scene of maps) {
    const key = sceneKey(scene.sceneId);
    localSteps.push({
      id: `layers.${key}`, step: 6, kind: 'local', template: 'local-layers', dependsOn: [`map.${key}`, `mask.${key}`],
      note: 'Fix the mask semantically (paving walkable, water blocked, trees/lamp posts block only at the base), cut foreground layers (RGB from map + alpha from mask), set baseY at ground contact, build the walk grid, approach points and door spawns.',
      outputs: [`runtime.render.walkGrid of ${scene.sceneId}`, `runtime.render.foreground[] -> ${pub}/fg/${key}-<id>.png`],
    });
  }
  for (const scene of interiors) {
    const key = sceneKey(scene.sceneId);
    localSteps.push({
      id: `layers.${key}`, step: 6, kind: 'local', template: 'local-layers', dependsOn: [`interior.${key}`],
      note: 'Cut the area outside the room to transparent; walk grid = floor polygon minus hand-placed furniture blocks; NPC feet, item hotspots, exit door and spawns placed on the image.',
      outputs: [`runtime.render.walkGrid of ${scene.sceneId}`, `${pub}/scenes/${key}.png`],
    });
  }
  localSteps.push({
    id: 'integrate', step: 8, kind: 'local', template: 'integrate', dependsOn: localSteps.filter((s) => s.kind === 'local').map((s) => s.id),
    note: 'Write runtime.render for every pixel scene, doors as runtime.transitions both ways, spawnPoints["from:<sceneId>"] at each doorway; validate with the backend before seeding.',
  });

  const count = (key) => finalRequests.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});
  const generationsByStep = finalRequests.reduce((acc, r) => ({ ...acc, [r.step]: (acc[r.step] ?? 0) + r.estimatedGenerations }), {});
  const workflowNames = ['outdoor-map', 'characters', 'character-animations', 'ambient-animation (optional)', 'object-mask', 'local-processing', 'interiors-and-icons', 'into-the-game'];
  const workflow = workflowNames.map((name, index) => ({
    step: index + 1, name,
    requestIds: finalRequests.filter((r) => r.step === index + 1).map((r) => r.id),
    localStepIds: localSteps.filter((s) => s.step === index + 1).map((s) => s.id),
  }));

  return clean({
    planVersion: 1,
    generator: 'scripts/build_pixellab_requests.mjs',
    templates: 'ai-game-docs/visual-style-templates/pixellab/templates.json',
    case: { caseId: gameCase.caseId, title: gameCase.title, slug, language: gameCase.language },
    options: { styleRef, mapDescription: options.mapDescription ?? null, players: Boolean(options.players) },
    policy: templates.shared.policy,
    styleReference: { url: styleRef, usage: templates.shared.styleReference.usage },
    conventions: {
      prompt: 'Send `prompt` as the tool parameter named in `promptParam`.',
      references: 'Put each reference url into the tool parameter named in `references[].param`; send `usage` only when usageSent is true.',
      placeholders: 'missingInputs = text an author must write (prefer English visualDescription fields in the case JSON, then rerun); inputsFromDependencies = IDs/URLs produced by earlier requests.',
      outputs: 'original/record paths are kept outside src/FE/public; runtime paths are what the game loads.',
    },
    workflow,
    requests: finalRequests,
    localSteps,
    skippedCharacters,
    summary: {
      requests: finalRequests.length,
      pixellabCalls: finalRequests.reduce((sum, r) => sum + r.calls, 0),
      byStage: count('stage'),
      byTool: count('tool'),
      maps: maps.length,
      interiors: interiors.length,
      npcs: npcInfo.length,
      players: options.players ? PLAYERS.length : 0,
      iconSheets: sheets.length,
      iconItems: iconCells.length,
      estimatedGenerations: finalRequests.reduce((sum, r) => sum + r.estimatedGenerations, 0),
      generationsByStep,
      missingInputs: missingCount,
      requestsNeedingInput: finalRequests.filter((r) => r.missingInputs.length).map((r) => r.id),
      warnings,
    },
  });
}

/** Drops undefined fields so the JSON stays compact and stable. */
function clean(value) {
  return JSON.parse(JSON.stringify(value));
}

// ------------------------------------------------------------------ CLI

const USAGE = 'Usage: node scripts/build_pixellab_requests.mjs <case.json> <out.json> [--style-ref <url>] [--map-description <text>] [--players]';

export function parseArgs(argv) {
  const positional = [];
  const options = { styleRef: null, mapDescription: null, players: false, help: false };
  const value = (flag, next) => {
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value.`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--style-ref') options.styleRef = value(arg, argv[++i]);
    else if (arg === '--map-description') options.mapDescription = value(arg, argv[++i]);
    else if (arg === '--players') options.players = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else positional.push(arg);
  }
  if (!options.help && positional.length !== 2) throw new Error('Expected <case.json> and <out.json>.');
  if (options.styleRef && !/^(https?:\/\/|upload:)\S+$/.test(options.styleRef)) throw new Error('--style-ref must be an http(s) URL or an upload:<id> ref.');
  return { caseFile: positional[0], outFile: positional[1], options };
}

export function formatSummary(plan, outFile) {
  const s = plan.summary;
  const lines = [
    `Wrote ${outFile}`,
    `requests=${s.requests} pixellabCalls=${s.pixellabCalls} maps=${s.maps} interiors=${s.interiors} npcs=${s.npcs} players=${s.players} masks=${s.byStage['object-mask'] ?? 0} iconSheets=${s.iconSheets} iconItems=${s.iconItems}`,
    `byTool: ${Object.entries(s.byTool).map(([tool, n]) => `${tool}=${n}`).join(' ')}`,
    `estimatedGenerations=${s.estimatedGenerations} (by step: ${Object.entries(s.generationsByStep).map(([step, n]) => `${step}=${n}`).join(' ')})`,
    `missingInputs=${s.missingInputs} in ${s.requestsNeedingInput.length} request(s)${s.missingInputs ? ' - fill English visualDescription fields in the case JSON (or pass --map-description) and rerun' : ''}`,
  ];
  for (const warning of s.warnings) lines.push(`warning: ${warning}`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 1;
  }
  if (args.options.help) { console.log(USAGE); return 0; }
  const gameCase = JSON.parse(readFileSync(resolve(args.caseFile), 'utf8'));
  const plan = buildPlan(gameCase, args.options);
  writeFileSync(resolve(args.outFile), `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  console.log(formatSummary(plan, args.outFile));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
