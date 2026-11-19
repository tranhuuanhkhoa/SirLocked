import { get, post } from './http.js';

/**
 * Find game (/find-game). Every call returns the caller's MatchmakingStatus:
 * { phase: IDLE|SEARCHING|FOUND|ACCEPTED|READY|ENDED, searchStartedAt, match, roomId, endReason, serverTime }.
 */
export const matchmakingApi = {
  /** @param {{ mode: string, preferredRole: string, caseLength: string, language: string }} preferences */
  enqueue: (preferences) => post('/api/matchmaking/queue', preferences),
  /** Polling also keeps a searching ticket alive. */
  status: () => get('/api/matchmaking/status'),
  cancel: () => post('/api/matchmaking/cancel'),
  accept: (matchId) => post(`/api/matchmaking/matches/${encodeURIComponent(matchId)}/accept`),
  decline: (matchId) => post(`/api/matchmaking/matches/${encodeURIComponent(matchId)}/decline`),
};
