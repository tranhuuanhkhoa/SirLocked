import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// The game modules import each other as "./x.js" (Vite resolves that to x.ts); let node do the same.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(specifier.slice(0, -3) + '.ts', context);
    throw error;
  }
}`));

const {
  PLAYER_SKINS, SIGNATURE_IDLE_MS, SKIN_CATEGORY_OF_ROLE, footprintTrail, loadWornSkins, resolvePlayerSheet, skinFor,
  skinTextures, skinVariant, wornSkinIds,
} = await import('../Client/js/game/playerSkins.ts');
const { PIXEL_PLAYER_SHEETS, advanceMotion, motionFrame } = await import('../Client/js/game/pixelActors.ts');

const SHERLOCK = 'skin_sherlock_whitechapel';
const WATSON = 'skin_watson_whitechapel';
const all = () => true;
const none = () => false;

/** Width and height of a PNG, read from its header. */
function pngSize(file) {
  const bytes = readFileSync(new URL(`../public${file}`, import.meta.url));
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', `${file} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('the lantern is lit at dusk and at night', () => {
  assert.equal(skinVariant('NIGHT'), 'night');
  assert.equal(skinVariant('night'), 'night');
  assert.equal(skinVariant('DUSK'), 'night');
  assert.equal(skinVariant('dusk'), 'night');
  assert.equal(skinVariant('DAY'), 'day');
  assert.equal(skinVariant(undefined), 'day');
  assert.equal(skinVariant(null), 'day');
  assert.equal(skinVariant(''), 'day');
});

test('Sherlock carries the lantern at dusk and at night, and puts it away by day', () => {
  const night = resolvePlayerSheet('INTERROGATOR', [SHERLOCK], 'NIGHT', all);
  const day = resolvePlayerSheet('INTERROGATOR', [SHERLOCK], 'DAY', all);
  const dusk = resolvePlayerSheet('INTERROGATOR', [SHERLOCK], 'DUSK', all);
  const older = resolvePlayerSheet('INTERROGATOR', [SHERLOCK], undefined, all);
  assert.equal(night, PLAYER_SKINS[SHERLOCK].sheets.night);
  assert.ok(night.lantern, 'the night look carries a lantern light');
  assert.equal(day, PLAYER_SKINS[SHERLOCK].sheets.day);
  assert.equal(day.lantern, undefined, 'no lantern by day');
  assert.equal(dusk, night, 'dusk lights the lantern');
  assert.equal(older, day, 'a scene without a time of day is daytime');
});

test('Watson has one look for every time of day', () => {
  const sheet = PLAYER_SKINS[WATSON].sheets.day;
  for (const time of ['DAY', 'DUSK', 'NIGHT', undefined]) assert.equal(resolvePlayerSheet('INVESTIGATOR', [WATSON], time, all), sheet);
});

test('nothing worn, an unknown outfit or the other detective\'s outfit keeps the normal look', () => {
  assert.equal(resolvePlayerSheet('INTERROGATOR', [], 'NIGHT', all), PIXEL_PLAYER_SHEETS.INTERROGATOR);
  assert.equal(resolvePlayerSheet('INTERROGATOR', undefined, 'NIGHT', all), PIXEL_PLAYER_SHEETS.INTERROGATOR);
  assert.equal(resolvePlayerSheet('INTERROGATOR', ['skin_retired_or_unknown'], 'NIGHT', all), PIXEL_PLAYER_SHEETS.INTERROGATOR);
  // A player who owns the Sherlock outfit but plays Watson this time.
  assert.equal(resolvePlayerSheet('INVESTIGATOR', [SHERLOCK], 'NIGHT', all), PIXEL_PLAYER_SHEETS.INVESTIGATOR);
  assert.equal(resolvePlayerSheet('INTERROGATOR', [WATSON], 'DAY', all), PIXEL_PLAYER_SHEETS.INTERROGATOR);
  // Both worn: each role picks its own.
  assert.equal(resolvePlayerSheet('INVESTIGATOR', [SHERLOCK, WATSON], 'DAY', all), PLAYER_SKINS[WATSON].sheets.day);
  assert.equal(resolvePlayerSheet(null, [SHERLOCK], 'DAY', all), undefined);
  assert.equal(skinFor('INTERROGATOR', [WATSON, SHERLOCK]), PLAYER_SKINS[SHERLOCK]);
});

test('until its sheet has loaded, a player keeps the normal look', () => {
  assert.equal(resolvePlayerSheet('INTERROGATOR', [SHERLOCK], 'NIGHT', none), PIXEL_PLAYER_SHEETS.INTERROGATOR);
  const onlyDay = (key) => key === PLAYER_SKINS[SHERLOCK].sheets.day.textures[0].key;
  assert.equal(resolvePlayerSheet('INTERROGATOR', [SHERLOCK], 'DAY', onlyDay), PLAYER_SKINS[SHERLOCK].sheets.day);
  assert.equal(resolvePlayerSheet('INTERROGATOR', [SHERLOCK], 'NIGHT', onlyDay), PIXEL_PLAYER_SHEETS.INTERROGATOR);
});

test('both Sherlock variants load together, so the lantern swaps without a gap', () => {
  assert.deepEqual(skinTextures(PLAYER_SKINS[SHERLOCK]).map((texture) => texture.url).sort(), [
    '/assets/pixel/skins/whitechapel/sherlock-day.png',
    '/assets/pixel/skins/whitechapel/sherlock-night.png',
  ]);
  assert.deepEqual(skinTextures(PLAYER_SKINS[WATSON]).map((texture) => texture.url), ['/assets/pixel/skins/whitechapel/watson.png']);
});

test('every frame a skin plays lies inside its sheet, which ships in public/', () => {
  for (const skin of Object.values(PLAYER_SKINS)) {
    assert.equal(SKIN_CATEGORY_OF_ROLE[skin.role], skin.category);
    for (const sheet of [skin.sheets.day, skin.sheets.night].filter(Boolean)) {
      const [texture] = sheet.textures;
      const { width, height } = pngSize(texture.url);
      assert.equal(width, texture.columns * sheet.cell, `${texture.url} width`);
      const cells = texture.columns * (height / sheet.cell);
      assert.equal(height % sheet.cell, 0);
      const frames = [
        ...Object.values(sheet.standing).map((entry) => entry.frame),
        ...Object.values(sheet.clips).flatMap((byDirection) => Object.values(byDirection).flatMap((clip) => clip.frames)),
      ];
      for (const frame of frames) assert.ok(frame >= 0 && frame < cells, `${texture.url} frame ${frame}`);
      for (const direction of ['south', 'east', 'north', 'west']) {
        assert.equal(sheet.clips.idle[direction].frames.length, 9);
        assert.equal(sheet.clips.walking[direction].frames.length, 8);
        assert.equal(sheet.clips.signature[direction].frames.length, 13);
        assert.equal(sheet.clips.signature[direction].loop, false);
      }
      assert.ok(sheet.signatureEffect, 'every skin has a signature effect');
    }
  }
  for (const icon of ['/assets/pixel/skins/whitechapel/icon-sherlock.png', '/assets/pixel/skins/whitechapel/icon-watson.png']) {
    assert.deepEqual(pngSize(icon), { width: 192, height: 192 });
  }
});

test('feet stay where the normal look puts them', () => {
  assert.equal(PLAYER_SKINS[SHERLOCK].sheets.night.pivot.y, PIXEL_PLAYER_SHEETS.INTERROGATOR.pivot.y);
  assert.equal(PLAYER_SKINS[SHERLOCK].sheets.day.pivot.y, PIXEL_PLAYER_SHEETS.INTERROGATOR.pivot.y);
  assert.equal(PLAYER_SKINS[WATSON].sheets.day.cell, PIXEL_PLAYER_SHEETS.INVESTIGATOR.cell);
});

test('reading what a player wears: only outfits, and a failed answer just means none', async () => {
  const equipped = [
    { category: 'FRAME', itemId: 'a', def: { id: 'frame_kimlong' } },
    { category: 'SKIN_SHERLOCK', itemId: 'b', def: { id: SHERLOCK } },
    { category: 'SKIN_WATSON', itemId: 'c', def: { id: WATSON } },
    { category: 'SKIN_WATSON', itemId: 'd', def: null },
  ];
  assert.deepEqual(wornSkinIds(equipped), [SHERLOCK, WATSON]);
  assert.deepEqual(wornSkinIds(null), []);
  assert.deepEqual(wornSkinIds({}), []);

  const asked = [];
  const worn = await loadWornSkins(['u1', 'u2', 'u1', ''], async (userId) => {
    asked.push(userId);
    if (userId === 'u2') throw new Error('offline');
    return equipped;
  });
  assert.deepEqual(asked.sort(), ['u1', 'u2'], 'each player is asked once');
  assert.deepEqual(worn.get('u1'), [SHERLOCK, WATSON]);
  assert.deepEqual(worn.get('u2'), []);
});

test('stand still and the signature move plays once, then idling starts over', () => {
  const sheet = PLAYER_SKINS[SHERLOCK].sheets.night;
  let state = { action: 'idle', facing: 'south', since: 0, idleMs: 0 };
  let now = 0;
  const step = (ms, moving = false, facing = 'south') => {
    const next = advanceMotion(state, sheet, now + ms, ms, moving, facing);
    now += ms;
    state = next;
    return next;
  };
  for (let t = 0; t < SIGNATURE_IDLE_MS - 100; t += 100) step(100);
  assert.equal(state.action, 'idle');
  step(200);
  assert.equal(state.action, 'signature');
  const started = state.since;
  const clip = sheet.clips.signature.south;
  assert.equal(motionFrame(sheet, state, started + 1).frame, clip.frames[0]);
  assert.equal(motionFrame(sheet, state, started + 1000 * 12 / clip.fps + 5).frame, clip.frames[12]);
  step(1000);
  assert.equal(state.action, 'signature', 'still playing after a second');
  step(700);
  assert.equal(state.action, 'idle', 'back to idle after the 13 frames');
  assert.equal(state.idleMs, 0);
  step(100, true);
  assert.equal(state.action, 'walking', 'walking interrupts anything');
});

test('the normal Sherlock still draws his pipe and smokes; the normal Watson only idles', () => {
  const sherlock = PIXEL_PLAYER_SHEETS.INTERROGATOR;
  let state = { action: 'idle', facing: 'south', since: 0, idleMs: 14_950 };
  state = advanceMotion(state, sherlock, 100, 100, false, 'south');
  assert.equal(state.action, 'draw-pipe');
  state = advanceMotion(state, sherlock, 100 + 21 * 1000 / 12 + 10, 10, false, 'south');
  assert.equal(state.action, 'smoking');
  state = advanceMotion(state, sherlock, 60_000, 10, false, 'south');
  assert.equal(state.action, 'smoking', 'he keeps smoking');

  let watson = { action: 'idle', facing: 'south', since: 0, idleMs: 0 };
  watson = advanceMotion(watson, PIXEL_PLAYER_SHEETS.INVESTIGATOR, 60_000, 60_000, false, 'south');
  assert.equal(watson.action, 'idle');
});

test('a look that cannot play the current action falls back to idle (the outfit loaded mid-smoke)', () => {
  const smoking = { action: 'smoking', facing: 'west', since: 0, idleMs: 20_000 };
  const next = advanceMotion(smoking, PLAYER_SKINS[SHERLOCK].sheets.day, 500, 16, false, 'west');
  assert.equal(next.action, 'idle');
  assert.equal(next.idleMs, 0);
  const back = advanceMotion({ action: 'signature', facing: 'west', since: 0, idleMs: 0 }, PIXEL_PLAYER_SHEETS.INTERROGATOR, 500, 16, false, 'west');
  assert.equal(back.action, 'idle');
});

test('glowing footprints lead away the way Sherlock faces', () => {
  const south = footprintTrail('south');
  assert.equal(south.length, 6);
  assert.ok(south.every((print) => print.y > 0), 'facing the camera: prints below his feet');
  assert.ok(south.at(-1).y > south[0].y, 'and further away one after another');
  assert.ok(footprintTrail('north').every((print) => print.y < 0));
  assert.ok(footprintTrail('east').every((print) => print.x > 0));
  assert.ok(footprintTrail('west').every((print) => print.x < 0));
  const diagonal = footprintTrail('south-west');
  assert.ok(diagonal.at(-1).x < 0 && diagonal.at(-1).y > 0);
  // Left and right feet: the prints sit on both sides of the line the trail follows.
  const first = south[0], last = south.at(-1);
  const sides = south.slice(1, -1).map((print) => Math.sign((last.x - first.x) * (print.y - first.y) - (last.y - first.y) * (print.x - first.x)));
  assert.ok(new Set(sides).size > 1, 'left and right prints alternate');
});

test('the first footprint lands clear of Sherlock\'s body and name tag', () => {
  for (const facing of ['south', 'north', 'east', 'west', 'south-east', 'north-west']) {
    const [first] = footprintTrail(facing);
    const underTag = Math.abs(first.x) < 30 && first.y > 0 && first.y < 24;
    const behindBody = Math.abs(first.x) < 18 && first.y < 0 && first.y > -88;
    assert.ok(!underTag && !behindBody, `${facing}: first print at ${first.x.toFixed(1)},${first.y.toFixed(1)}`);
  }
});
