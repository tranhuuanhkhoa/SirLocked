import { apiFetch, get } from './http.js';

export const weeklyApi = {
  caseOfWeek: () => get('/api/workshop/weekly/case-of-week'),
  challenge: () => get('/api/workshop/weekly/challenge'),
  challengeLeaderboard: (limit = 100) => get(`/api/workshop/weekly/challenge/leaderboard?limit=${limit}`),
  // Signed in: this week's chest and the ones waiting for room, the chest a room's game earned, and claiming a waiting one.
  reward: () => get('/api/workshop/weekly/challenge/reward'),
  rewardForRoom: (roomId) => get(`/api/workshop/weekly/challenge/reward/${encodeURIComponent(roomId)}`),
  claim: (dropId) => apiFetch('POST', `/api/workshop/weekly/challenge/reward/${encodeURIComponent(dropId)}/claim`),
  // Admin
  set: (payload) => apiFetch('POST', '/api/admin/weekly', payload),
  clear: (type) => apiFetch('DELETE', `/api/admin/weekly/${encodeURIComponent(type)}`),
};
