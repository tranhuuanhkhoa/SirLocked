import { get } from './http.js';

export const leaderboardApi = {
  /** metric: 'fastest' | 'topScore' */
  get: (caseId, metric = 'fastest', limit = 100) =>
    get(`/api/workshop/cases/${encodeURIComponent(caseId)}/leaderboard?metric=${encodeURIComponent(metric)}&limit=${limit}`),
};
