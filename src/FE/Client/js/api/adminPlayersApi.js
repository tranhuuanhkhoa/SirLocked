import { apiFetch, apiFetchBlob, get, patch, post } from './http.js';

/** Blank filters are left out, so the address stays readable and the server applies its own defaults. */
function query(filters = {}) {
  const text = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ).toString();
  return text ? `?${text}` : '';
}

const player = (userId) => `/api/admin/players/${encodeURIComponent(userId)}`;
const reasonQuery = (reason) => query({ reason });

/** Players, economy, rooms and reviews of the admin. Writes that move coins or items carry an idempotency key. */
export const adminPlayersApi = {
  list: (filters) => get(`/api/admin/players${query(filters)}`),
  detail: (userId) => get(player(userId)),
  games: (userId, page) => get(`${player(userId)}/games${query({ page })}`),
  chestOpenings: (userId, page) => get(`${player(userId)}/chest-openings${query({ page })}`),
  sales: (userId, page) => get(`${player(userId)}/sales${query({ page })}`),
  trades: (userId, page) => get(`${player(userId)}/trades${query({ page })}`),
  audit: (userId, page) => get(`${player(userId)}/audit${query({ page })}`),

  // Locking and roles stay on the older routes, which take the reason in the query string.
  lock: (userId, reason) => patch(`/api/admin/users/${encodeURIComponent(userId)}/lock${reasonQuery(reason)}`),
  unlock: (userId, reason) => patch(`/api/admin/users/${encodeURIComponent(userId)}/unlock${reasonQuery(reason)}`),
  setRole: (userId, role, reason) => patch(`/api/admin/users/${encodeURIComponent(userId)}/role${reasonQuery(reason)}`, { role }),

  adjustCoins: (userId, body) => post(`${player(userId)}/coins`, body),
  grantItem: (userId, body) => post(`${player(userId)}/items`, body),
  revokeItem: (userId, itemId, body) => post(`${player(userId)}/items/${encodeURIComponent(itemId)}/revoke`, body),
  setProgress: (userId, body) => post(`${player(userId)}/progress`, body),
  removeAvatar: (userId, reason) => post(`${player(userId)}/avatar/remove`, { reason }),
  approveAvatar: (userId) => post(`${player(userId)}/avatar/approve`),
  forceLogout: (userId, reason) => post(`${player(userId)}/force-logout`, { reason }),

  avatars: (filters) => get(`/api/admin/players/avatars${query(filters)}`),
  catalog: () => get('/api/market/catalog'),

  overview: (days) => get(`/api/admin/economy/overview${query({ days })}`),
  dashboardCounts: () => get('/api/admin/economy/dashboard'),
  listings: (filters) => get(`/api/admin/economy/listings${query(filters)}`),
  removeListing: (id, reason) => post(`/api/admin/economy/listings/${encodeURIComponent(id)}/remove`, { reason }),
  orders: (filters) => get(`/api/admin/economy/orders${query(filters)}`),
  cancelOrder: (id, reason) => post(`/api/admin/economy/orders/${encodeURIComponent(id)}/cancel`, { reason }),
  marketSales: (filters) => get(`/api/admin/economy/sales${query(filters)}`),
  exportSales: (filters) => apiFetchBlob(`/api/admin/economy/sales/export${query(filters)}`),
  marketTrades: (filters) => get(`/api/admin/economy/trades${query(filters)}`),
  anomalies: () => get('/api/admin/economy/anomalies'),
  stuck: () => get('/api/admin/economy/stuck'),
  recover: (reason) => post('/api/admin/economy/recover', { reason }),

  rooms: (filters) => get(`/api/admin/rooms${query(filters)}`),
  closeRoom: (id, reason) => post(`/api/admin/rooms/${encodeURIComponent(id)}/close`, { reason }),

  reviews: (filters) => get(`/api/admin/reviews${query(filters)}`),
  hideReview: (id, reason) => post(`/api/admin/reviews/${encodeURIComponent(id)}/hide`, { reason }),
  unhideReview: (id, reason) => post(`/api/admin/reviews/${encodeURIComponent(id)}/unhide`, { reason }),
  deleteReview: (id, reason) => apiFetch('DELETE', `/api/admin/reviews/${encodeURIComponent(id)}`, { reason }),
};
