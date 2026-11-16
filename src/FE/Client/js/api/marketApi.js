import { apiFetch, get, post } from './http.js';

const enc = encodeURIComponent;

/** A fresh id per user action: a retried request (double click, flaky network) is applied once. */
export function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export const marketApi = {
  wallet: () => get('/api/market/me'),
  browse: ({ q = '', category = '', rarities = [], sort = 'popular', page = 1, pageSize = 0 } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    if (rarities.length) params.set('rarity', rarities.join(','));
    if (sort) params.set('sort', sort);
    if (pageSize > 0) {
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
    }
    return get(`/api/market/items?${params}`);
  },
  item: (defId) => get(`/api/market/items/${enc(defId)}`),
  buyLowest: (defId, maxPrice, requestId = newRequestId()) => post(`/api/market/items/${enc(defId)}/buy`, { maxPrice, requestId }),
  buyListing: (listingId, requestId = newRequestId()) => post(`/api/market/listings/${enc(listingId)}/buy`, { requestId }),
  createListing: (itemId, price, requestId = newRequestId()) => post('/api/market/listings', { itemId, price, requestId }),
  cancelListing: (listingId) => apiFetch('DELETE', `/api/market/listings/${enc(listingId)}`),
  placeOrder: (defId, price, requestId = newRequestId()) => post('/api/market/orders', { defId, price, requestId }),
  cancelOrder: (orderId) => apiFetch('DELETE', `/api/market/orders/${enc(orderId)}`),
  mine: () => get('/api/market/mine'),
  inventory: () => get('/api/market/inventory'),
  userInventory: (userId) => get(`/api/market/users/${enc(userId)}/inventory`),
  equip: (itemId) => post(`/api/market/inventory/${enc(itemId)}/equip`),
  unequip: (category) => apiFetch('DELETE', `/api/market/equipped/${enc(category)}`),
  equipped: (userId) => get(`/api/market/equipped/${enc(userId)}`),
  trades: () => get('/api/market/trades'),
  createTrade: (terms, requestId = newRequestId()) => post('/api/market/trades', { ...terms, requestId }),
  acceptTrade: (offerId) => post(`/api/market/trades/${enc(offerId)}/accept`),
  declineTrade: (offerId) => post(`/api/market/trades/${enc(offerId)}/decline`),
  cancelTrade: (offerId) => post(`/api/market/trades/${enc(offerId)}/cancel`),
  counterTrade: (offerId, terms, requestId = newRequestId()) => post(`/api/market/trades/${enc(offerId)}/counter`, { ...terms, requestId }),
  reward: (roomId) => get(`/api/market/rewards/${enc(roomId)}`),
  searchUsers: (q) => get(`/api/users/search?q=${enc(q)}`),
};
