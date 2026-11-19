import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, loadTemplates, renderTemplate, parseArgs, PLAYERS } from './build_pixellab_requests.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'build_pixellab_requests.mjs');
const CASE_FILE = join(ROOT, 'src', 'BE', 'SeedData', 'V3', 'case-pixel-lo-thuoc-thu-nam-vi.json');
const RECORD_FILE = join(ROOT, 'ai-game-docs', 'pixel-case-lo-thuoc-thu-nam', 'pixellab-requests.json');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const gameCase = readJson(CASE_FILE);
const templates = loadTemplates();
const scenes = gameCase.stages.flatMap((stage) => stage.scenes);
const isometric = scenes.filter((scene) => scene.runtime?.render?.projection === 'isometric');
const topdown = scenes.filter((scene) => scene.runtime?.render?.projection === 'topdown');
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

function runCli(extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'pixellab-plan-'));
  try {
    const out = join(dir, 'plan.json');
    const result = spawnSync(process.execPath, [SCRIPT, CASE_FILE, out, ...extraArgs], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return { stdout: result.stdout, text: readFileSync(out, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cli = runCli();
const plan = JSON.parse(cli.text);
const byId = new Map(plan.requests.map((request) => [request.id, request]));

test('CLI writes the plan and prints a summary with counts and total generations', () => {
  assert.match(cli.stdout, /^Wrote /m);
  assert.match(cli.stdout, /requests=\d+ pixellabCalls=\d+ maps=1 interiors=5 npcs=6/);
  assert.match(cli.stdout, new RegExp(`estimatedGenerations=${plan.summary.estimatedGenerations}\\b`));
});

test('requests follow the workflow order: map, fronts, rotations, animations, mask, interiors, icon sheets', () => {
  plan.requests.forEach((request, index) => assert.equal(request.order, index + 1));
  const steps = plan.requests.map((request) => request.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b), 'steps never go backwards');
  assert.equal(plan.requests[0].stage, 'outdoor-map');
  assert.equal(plan.requests.at(-1).stage, 'icon-sheet');
  const rank = ['outdoor-map', 'character-front', 'character-rotate', 'character-walk', 'character-idle', 'object-mask', 'interior', 'icon-sheet'];
  const stageRanks = plan.requests.map((request) => rank.indexOf(request.stage));
  assert.ok(stageRanks.every((r) => r >= 0), 'only known stages');
  assert.deepEqual(stageRanks, [...stageRanks].sort((a, b) => a - b), 'stages grouped in workflow order');
  for (const request of plan.requests) {
    for (const dep of request.dependsOn) {
      assert.ok(byId.has(dep), `${request.id} depends on unknown ${dep}`);
      assert.ok(byId.get(dep).order < request.order, `${request.id} must come after ${dep}`);
    }
  }
  assert.deepEqual(plan.workflow.map((w) => w.step), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('one outdoor map from the topdown scene, and its mask depends on it', () => {
  const maps = plan.requests.filter((request) => request.stage === 'outdoor-map');
  assert.equal(maps.length, topdown.length);
  const [map] = maps;
  assert.equal(map.subject.sceneId, topdown[0].sceneId);
  assert.equal(map.tool, 'create_image_pro');
  assert.deepEqual(map.params, { width: 512, height: 512, no_background: false, seed: 707 });
  assert.ok(map.prompt.startsWith('Top-down, front-facing pixel art map, not isometric. '));
  assert.match(map.prompt, /No people, no animals, no readable text/);
  assert.equal(map.buildings.length, isometric.length);
  const mask = plan.requests.find((request) => request.stage === 'object-mask');
  assert.equal(mask.tool, 'edit_image');
  assert.deepEqual(mask.dependsOn, [map.id]);
  assert.equal(mask.references[0].param, 'image_urls');
});

test('every isometric scene has an interior request that depends on the map and uses the exterior crop', () => {
  const map = plan.requests.find((request) => request.stage === 'outdoor-map');
  for (const scene of isometric) {
    const interior = plan.requests.find((request) => request.stage === 'interior' && request.subject.sceneId === scene.sceneId);
    assert.ok(interior, `interior request for ${scene.sceneId}`);
    assert.deepEqual(interior.dependsOn, [map.id]);
    assert.equal(interior.tool, 'create_image_pro');
    assert.deepEqual(interior.params, { width: 512, height: 512, no_background: false, seed: 707 });
    assert.equal(interior.references[0].param, 'reference_images');
    assert.equal(interior.references[0].url, '{{exteriorCropRef}}');
    assert.equal(interior.references[0].usage, templates.byId.interior.references[0].usage);
    assert.match(interior.prompt, /Isometric 2:1 pixel art interior cutaway room/);
    assert.match(interior.prompt, /No people, no animals, no readable text or letters\./);
    assert.ok(interior.outputs.some((o) => o.kind === 'runtime' && o.path === scene.backgroundUrl), `runtime path matches ${scene.backgroundUrl}`);
  }
  assert.equal(plan.requests.filter((request) => request.stage === 'interior').length, isometric.length);
});

test('every NPC gets front -> rotate -> idle, with the Sherlock style reference on the front sprite', () => {
  const usage = templates.shared.styleReference.usage;
  assert.match(usage, /^art style reference only/);
  assert.match(usage, /do NOT copy his face, hat, coat or identity/);
  for (const character of gameCase.characters) {
    const key = character.characterId.replace(/^char-/, '').replace(/^px-/, '');
    const front = byId.get(`front.${key}`);
    const rotate = byId.get(`rotate.${key}`);
    const idle = byId.get(`idle.${key}`);
    assert.ok(front && rotate && idle, `chain for ${character.characterId}`);
    assert.ok(front.order < rotate.order && rotate.order < idle.order);
    assert.deepEqual(rotate.dependsOn, [front.id]);
    assert.deepEqual(idle.dependsOn, [rotate.id]);
    assert.equal(front.tool, 'create_image_pro');
    assert.deepEqual(front.params, { width: 96, height: 96, no_background: true, seed: 707 });
    assert.equal(front.expectedCandidates, 4);
    assert.equal(front.references.length, 1);
    assert.equal(front.references[0].usage, usage);
    assert.equal(front.references[0].url, templates.shared.styleReference.url);
    assert.match(front.prompt, /facing the viewer \(south-facing, straight-on\)/);
    assert.equal(rotate.tool, 'create_character');
    assert.equal(rotate.params.mode, 'v3');
    assert.equal(rotate.params.n_directions, 8);
    assert.equal(rotate.references[0].param, 'reference_image_url');
    assert.equal(idle.tool, 'animate_character');
    assert.equal(idle.params.mode, 'v3');
    assert.equal(idle.params.frame_count, 8);
    assert.equal(idle.params.direction, 'south');
    assert.equal(idle.prompt, templates.byId['character-idle'].promptParts[0]);
    assert.equal(idle.inputsFromDependencies[0].from, rotate.id);
  }
  assert.ok(!plan.requests.some((request) => request.stage === 'character-walk'), 'no walk cycles without --players');
});

test('icon sheets hold at most 16 items, cover every icon item once and list the cell order', () => {
  const sheets = plan.requests.filter((request) => request.stage === 'icon-sheet');
  assert.ok(sheets.length >= 1);
  const covered = sheets.flatMap((sheet) => sheet.grid.flatMap((cell) => cell.itemIds));
  const expected = gameCase.items.filter((item) => item.imageUrl?.trim() || item.isCollectible).map((item) => item.itemId);
  assert.deepEqual([...covered].sort(), [...expected].sort());
  assert.equal(new Set(covered).size, covered.length);
  const firstInterior = plan.requests.find((request) => request.stage === 'interior');
  for (const sheet of sheets) {
    assert.ok(sheet.grid.length >= 1 && sheet.grid.length <= 16);
    assert.deepEqual(sheet.params, { width: 256, height: 256, no_background: true, seed: 707 });
    sheet.grid.forEach((cell, index) => {
      assert.equal(cell.cell, index);
      assert.equal(cell.row, Math.floor(index / 4) + 1);
      assert.equal(cell.col, (index % 4) + 1);
      assert.deepEqual(cell.box, [(index % 4) * 64, Math.floor(index / 4) * 64, (index % 4) * 64 + 64, Math.floor(index / 4) * 64 + 64]);
    });
    assert.deepEqual(sheet.dependsOn, [firstInterior.id]);
    assert.equal(sheet.references[0].param, 'style_image_url');
  }
  for (const item of gameCase.items.filter((i) => i.imageUrl)) {
    const cell = sheets.flatMap((sheet) => sheet.grid).find((c) => c.itemIds.includes(item.itemId));
    assert.equal(cell.runtimeAsset, item.imageUrl);
  }
});

test('icon items are chunked into sheets of 16', () => {
  const many = structuredClone(gameCase);
  many.items = Array.from({ length: 35 }, (_, i) => ({ itemId: `item-x-${i}`, name: `x${i}`, imageUrl: '', isCollectible: true }));
  const big = buildPlan(many, { templates });
  const sheets = big.requests.filter((request) => request.stage === 'icon-sheet');
  assert.deepEqual(sheets.map((sheet) => sheet.grid.length), [16, 16, 3]);
  assert.match(sheets[2].prompt, /three separate small objects/);
  assert.match(sheets[2].prompt, /The remaining thirteen cells after the last object stay empty\./);
});

test('total estimated generations is positive and equals the sum of the requests', () => {
  const total = plan.requests.reduce((sum, request) => sum + request.estimatedGenerations, 0);
  assert.ok(total > 0);
  assert.equal(plan.summary.estimatedGenerations, total);
  assert.equal(plan.summary.requests, plan.requests.length);
  // 1 map + 6 x (front 10 + rotate 2 + idle 2) + mask + 5 interiors + 1 icon sheet
  assert.equal(total, 25 + 6 * 14 + 25 + 5 * 25 + 10);
});

test('output is deterministic: two runs are byte-identical', () => {
  const again = runCli();
  assert.equal(again.text, cli.text);
  assert.deepEqual(buildPlan(gameCase, { templates }), buildPlan(gameCase, { templates }));
  assert.ok(!/generatedAt|\d{4}-\d{2}-\d{2}T\d{2}:/.test(cli.text), 'no timestamps');
});

test('prompts are ASCII English and never contain character names', () => {
  for (const request of plan.requests) {
    assert.match(request.prompt, /^[\x20-\x7e]*$/, `${request.id} prompt is ASCII`);
    for (const character of gameCase.characters) {
      assert.ok(!fold(request.prompt).includes(fold(character.name)), `${request.id} mentions ${character.name}`);
    }
  }
  // Vietnamese text survives as metadata only.
  assert.equal(byId.get('front.ly-hanh').subject.name, 'Lý Hạnh');
  assert.equal(byId.get('front.ly-hanh').missingInputs[0].context.name, 'Lý Hạnh');
});

test('placeholders are reported: author text as missingInputs, earlier outputs as inputsFromDependencies', () => {
  const front = byId.get('front.ly-hanh');
  assert.deepEqual(front.missingInputs.map((m) => m.placeholder), ['{{characterAppearance}}']);
  assert.equal(front.missingInputs[0].fillFrom, 'characters[characterId=char-px-ly-hanh].visualDescription');
  const rotate = byId.get('rotate.ly-hanh');
  assert.deepEqual(rotate.inputsFromDependencies.map((m) => m.placeholder), ['{{frontCandidateUrl}}']);
  const missing = plan.requests.reduce((sum, request) => sum + request.missingInputs.length, 0);
  assert.equal(plan.summary.missingInputs, missing);
});

test('with English visualDescription fields the plan has no missing inputs', () => {
  const filled = structuredClone(gameCase);
  for (const character of filled.characters) character.visualDescription = `a Victorian townsperson ${character.characterId.length} with a dark coat`;
  for (const item of filled.items) item.visualDescription = `small object ${item.itemId.length}`;
  for (const stage of filled.stages) {
    for (const scene of stage.scenes) scene.visualDescription = `Room or street details for ${scene.sceneId.replace(/[^a-z-]/g, '')} with a cast-iron clock post`;
  }
  const full = buildPlan(filled, { templates, mapDescription: 'riverside street block on a clear morning' });
  assert.equal(full.summary.missingInputs, 0, JSON.stringify(full.summary.requestsNeedingInput));
  assert.ok(full.requests.every((request) => !/\{\{/.test(request.prompt)));
  assert.match(full.requests[0].prompt, /A compact Victorian riverside street block on a clear morning, one complete scene/);
  const front = full.requests.find((request) => request.stage === 'character-front');
  assert.ok(front.prompt.startsWith('a Victorian townsperson'));
  const rotate = full.requests.find((request) => request.stage === 'character-rotate');
  assert.ok(!rotate.prompt.endsWith('.'));
});

test('--players adds walk + idle (4 directions) for both players; player characters in the case are skipped', () => {
  const withPlayers = JSON.parse(runCli(['--players']).text);
  for (const player of PLAYERS) {
    const walk = withPlayers.requests.find((request) => request.id === `walk.${player.key}`);
    const idle = withPlayers.requests.find((request) => request.id === `idle.${player.key}`);
    assert.ok(walk && idle);
    assert.equal(walk.prompt, 'walking');
    assert.equal(walk.params.keep_first_frame, false);
    assert.deepEqual(walk.directions, ['south', 'east', 'north', 'west']);
    assert.equal(walk.calls, 4);
    assert.equal(walk.estimatedGenerations, 8);
    assert.equal(idle.params.keep_first_frame, true);
    assert.ok(!withPlayers.requests.some((request) => request.id === `front.${player.key}`));
  }
  assert.equal(withPlayers.summary.estimatedGenerations, plan.summary.estimatedGenerations + 32);
  const withCast = structuredClone(gameCase);
  withCast.characters.push({ characterId: 'char-px-watson', name: 'Dr. John Watson', role: 'Detective', description: '' });
  const castPlan = buildPlan(withCast, { templates });
  assert.ok(!castPlan.requests.some((request) => request.id.endsWith('.watson')));
  assert.equal(castPlan.skippedCharacters[0].characterId, 'char-px-watson');
});

test('--style-ref and --map-description are applied; bad arguments are rejected', () => {
  const custom = JSON.parse(runCli(['--style-ref', 'upload:style-1', '--map-description', 'harbour quay at dusk']).text);
  assert.ok(custom.requests.filter((r) => r.stage === 'character-front').every((r) => r.references[0].url === 'upload:style-1'));
  assert.match(custom.requests[0].prompt, /A compact Victorian harbour quay at dusk, one complete scene/);
  assert.throws(() => parseArgs(['only-one.json']), /Expected/);
  assert.throws(() => parseArgs(['a.json', 'b.json', '--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['a.json', 'b.json', '--style-ref', 'ftp://x']), /style-ref/);
  assert.throws(() => buildPlan(gameCase, { templates, mapDescription: 'phố cổ' }), /ASCII/);
});

test('templates reproduce the prompts that were actually sent for this case', () => {
  const record = readJson(RECORD_FILE);
  const sent = new Map(record.requests.map((request) => [request.id, request]));
  let checked = 0;
  for (const template of templates.templates.filter((t) => t.example)) {
    const request = sent.get(template.example.requestId);
    assert.ok(request, `record has ${template.example.requestId}`);
    assert.equal(request.tool.split(' ')[0], template.tool, `${template.id} tool`);
    assert.equal(renderTemplate(template, template.example.values), request.prompt, `${template.id} reproduces ${request.id}`);
    checked++;
  }
  assert.ok(checked >= 8);
  // Fixed interior wording is identical for all five rooms.
  const suffix = renderTemplate(templates.byId.interior, { roomSubject: 'x', roomContents: 'y' }).split(' y ')[1];
  for (const request of record.requests.filter((r) => r.stage === 'interior')) assert.ok(request.prompt.endsWith(suffix), request.id);
});

// The server's PixelLabPlanBuilder (C#) is a port of this builder for new AI drafts. Both are tied to one golden file:
// this test checks the JS plan of the sample case against it, src/BE/Tests/PixelLabPlanTests.cs checks the C# plan.
// Regenerate after a deliberate wording change: UPDATE_PIXELLAB_GOLDEN=1 node --test scripts/build_pixellab_requests.test.mjs
const SAMPLE_CASE = join(ROOT, 'src', 'BE', 'Tests', 'Fixtures', 'case-pixel-dong-ho-dem-mua-vi.json');
const GOLDEN_FILE = join(ROOT, 'src', 'BE', 'Tests', 'Fixtures', 'pixellab-plan-dong-ho.golden.json');

function goldenSubset(fullPlan) {
  return fullPlan.requests.map((request) => ({
    id: request.id, order: request.order, step: request.step, stage: request.stage, tool: request.tool, template: request.template,
    params: request.params, promptParam: request.promptParam, prompt: request.prompt,
    references: request.references.map((ref) => ({ param: ref.param, url: ref.url, usage: ref.usage, usageSent: ref.usageSent, prepare: ref.prepare ?? null })),
    dependsOn: request.dependsOn, calls: request.calls, estimatedGenerations: request.estimatedGenerations,
    needsReview: Boolean(request.needsReview),
    missingInputs: request.missingInputs.map((entry) => entry.placeholder),
    inputsFromDependencies: request.inputsFromDependencies.map((entry) => entry.placeholder),
    buildings: (request.buildings ?? []).map((building) => `${building.sceneId}@${building.position}`),
    grid: (request.grid ?? []).map((cell) => ({ cell: cell.cell, row: cell.row, col: cell.col, box: cell.box, icon: cell.icon, itemIds: cell.itemIds, text: cell.text })),
  }));
}

test('the sample case plan matches the golden file shared with the server builder', () => {
  const subset = goldenSubset(buildPlan(readJson(SAMPLE_CASE), { templates }));
  const text = `${JSON.stringify(subset, null, 2)}\n`;
  if (process.env.UPDATE_PIXELLAB_GOLDEN === '1') writeFileSync(GOLDEN_FILE, text, 'utf8');
  assert.deepEqual(subset, readJson(GOLDEN_FILE));
  assert.ok(subset.length >= 10, 'map, 3 NPCs x 3, mask, interior, icon sheet');
});

test('the consolidated record of sent requests is internally consistent', () => {
  const record = readJson(RECORD_FILE);
  assert.equal(record.caseId, gameCase.caseId);
  const total = record.requests.reduce((sum, request) => sum + request.cost_generations, 0);
  assert.equal(record.totals.cost_generations, total);
  record.requests.forEach((request, index) => assert.equal(request.seq, index + 1));
  const steps = record.requests.map((request) => request.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
  for (const request of record.requests) {
    assert.ok(request.job_id || request.character_id || request.jobs, `${request.id} has an ID`);
    assert.ok(Number.isFinite(request.cost_generations) && request.cost_generations > 0, `${request.id} cost`);
  }
});
