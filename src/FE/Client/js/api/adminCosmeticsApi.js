import { apiFetch, get, post, put } from './http.js';

const item = (id) => `/api/admin/cosmetics/${encodeURIComponent(id)}`;

/** Frames, titles, lobby entrances and XP rates for /admin/cosmetics. Every call needs an admin session. */
export const adminCosmeticsApi = {
  /** { items, metrics, rareXp, epicXp, maxLevel, defaults, problems } */
  list: () => get('/api/admin/cosmetics'),
  get: (id) => get(item(id)),
  create: (body) => post('/api/admin/cosmetics', body),
  update: (id, body) => put(item(id), body),
  /** { mode: level | achievement | default | admin, level, metric, target, reason } */
  setAcquisition: (id, body) => put(`${item(id)}/acquisition`, body),
  setRetired: (id, retired, reason) => put(`${item(id)}/retired`, { retired, reason }),
  remove: (id, reason) => apiFetch('DELETE', `${item(id)}?reason=${encodeURIComponent(reason)}`),
  grant: (id, userId, reason) => post(`${item(id)}/grant`, { userId, reason }),
  searchPlayers: (query) => get(`/api/admin/cosmetics/players?q=${encodeURIComponent(query)}`),
  setXp: (rareXp, epicXp, reason) => put('/api/admin/cosmetics/settings/xp', { rareXp, epicXp, reason }),
};
