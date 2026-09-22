import { apiFetch, get } from './http.js';

export const weeklyApi = {
  caseOfWeek: () => get('/api/workshop/weekly/case-of-week'),
  challenge: () => get('/api/workshop/weekly/challenge'),
  challengeLeaderboard: (limit = 100) => get(`/api/workshop/weekly/challenge/leaderboard?limit=${limit}`),
  // Admin
  set: (payload) => apiFetch('POST', '/api/admin/weekly', payload),
  clear: (type) => apiFetch('DELETE', `/api/admin/weekly/${encodeURIComponent(type)}`),
};
