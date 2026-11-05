import { get, post } from './http.js';

const enc = encodeURIComponent;

/** Every write carries an idempotency key: the caller keeps one per user action and resends it on a retry. */
export const chestApi = {
  list: () => get('/api/chests'),
  // expectedPrice is the price on screen: if the shop's has moved since, the server refuses instead of charging it.
  buyKey: (chestId, idempotencyKey, expectedPrice) => post(`/api/chests/${enc(chestId)}/keys`, { idempotencyKey, expectedPrice }),
  buyChest: (chestId, idempotencyKey, expectedPrice) => post(`/api/chests/${enc(chestId)}/buy`, { idempotencyKey, expectedPrice }),
  open: (chestId, idempotencyKey) => post(`/api/chests/${enc(chestId)}/open`, { idempotencyKey }),
};
