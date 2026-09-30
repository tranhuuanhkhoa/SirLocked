import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoleGuide, roleGuideSteps } from '../Client/js/game/roleGuide.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('role guide advances only for valid local role actions; unrelated events do not complete steps', () => {
  const options = { storage: storage(), roomId: 'room', userId: 'a', role: 'INVESTIGATOR' };
  const guide = createRoleGuide(options);
  for (const event of ['ask', 'GameStateUpdated', 'PartnerDiscovered', 'photo-miss']) assert.equal(guide.record(event), false);
  assert.deepEqual(guide.snapshot().completed, []);
  assert.equal(guide.record('inspect'), true);
  assert.equal(guide.record('photo'), false, 'a second discovery must not mark a different step');
  assert.equal(guide.record('notebook'), true);
  assert.equal(guide.record('compare'), true);
  assert.deepEqual(guide.snapshot().completed, ['investigate', 'notebook', 'compare']);
  const interrogator = createRoleGuide({ ...options, role: 'INTERROGATOR' });
  assert.equal(interrogator.record('inspect'), false);
  assert.equal(interrogator.record('ask'), true);
});

test('progress and dismissal survive reload and are isolated by room, user and role', () => {
  const options = { storage: storage(), roomId: 'room', userId: 'a', role: 'INVESTIGATOR' };
  const first = createRoleGuide(options);
  first.record('inspect');
  first.setDismissed(true);
  assert.deepEqual(createRoleGuide(options).snapshot(), { completed: ['investigate'], dismissed: true });
  for (const difference of [{ roomId: 'other' }, { userId: 'b' }, { role: 'INTERROGATOR' }]) {
    assert.deepEqual(createRoleGuide({ ...options, ...difference }).snapshot(), { completed: [], dismissed: true });
  }
  first.setDismissed(false);
  assert.equal(createRoleGuide(options).snapshot().dismissed, false);
});

test('invalid or unavailable storage cannot prevent playing and labels contain no case answer IDs', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const guide = createRoleGuide({ storage: blocked, roomId: 'room', userId: 'a', role: 'INTERROGATOR' });
  assert.equal(guide.record('ask'), true);
  guide.setDismissed(true);
  assert.equal(guide.snapshot().dismissed, true);
  for (const role of ['INVESTIGATOR', 'INTERROGATOR']) {
    const steps = roleGuideSteps(role, (en) => en);
    assert.equal(steps.length, 3);
    assert.deepEqual(steps.map(({ id }) => id), ['investigate', 'notebook', 'compare']);
  }
});
