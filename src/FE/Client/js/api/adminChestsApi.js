import { get, post, put } from './http.js';

const enc = encodeURIComponent;

const query = (filters) => {
  const text = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ).toString();
  return text ? `?${text}` : '';
};

/** Chests and items admin API. Refusals carry errors.code and, for broken rules, errors.violations with messages to show as they are. */
export const adminChestsApi = {
  items: () => get('/api/admin/items'),
  createItem: (body) => post('/api/admin/items', body),
  updateItem: (id, body) => put(`/api/admin/items/${enc(id)}`, body),
  retireItem: (id, retired, reason) => post(`/api/admin/items/${enc(id)}/retire`, { retired, reason }),
  deleteItem: (id, reason) => post(`/api/admin/items/${enc(id)}/delete`, { reason }),

  chests: () => get('/api/admin/chests'),
  chest: (id) => get(`/api/admin/chests/${enc(id)}`),
  check: (id, draft) => post(`/api/admin/chests/${enc(id)}/check`, draft),
  save: (id, draft) => put(`/api/admin/chests/${enc(id)}`, draft),
  clone: (id, body) => post(`/api/admin/chests/${enc(id)}/clone`, body),
  versions: (id) => get(`/api/admin/chests/${enc(id)}/versions`),
  restore: (id, version, body) => post(`/api/admin/chests/${enc(id)}/versions/${enc(version)}/restore`, body),
  preview: (id) => get(`/api/admin/chests/${enc(id)}/preview`),
  previewOpen: (id) => post(`/api/admin/chests/${enc(id)}/preview/open`),

  stats: (id, days) => get(`/api/admin/chests/${enc(id)}/stats${query({ days })}`),
  openings: (filters = {}) => get(`/api/admin/chests/openings${query(filters)}`),
  players: (text) => get(`/api/admin/chests/players${query({ q: text })}`),
  grant: (body) => post('/api/admin/chests/grant', body),
};
