import { get, post } from './http.js';

const enc = encodeURIComponent;

/** Every write carries an idempotency key: the caller keeps one per user action and resends it on a retry. */
export const chestApi = {
  list: () => get('/api/chests'),
  buyKey: (chestId, idempotencyKey) => post(`/api/chests/${enc(chestId)}/keys`, { idempotencyKey }),
  buyChest: (chestId, idempotencyKey) => post(`/api/chests/${enc(chestId)}/buy`, { idempotencyKey }),
  open: (chestId, idempotencyKey) => post(`/api/chests/${enc(chestId)}/open`, { idempotencyKey }),
};
