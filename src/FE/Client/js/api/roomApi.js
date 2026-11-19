import { get, post, put } from './http.js';

export const roomApi = {
  mine: () => get('/api/rooms/mine'),
  /** @param {string} caseId @param {'PUBLIC'|'PRIVATE'} [visibility] omitted = PRIVATE (invite only). */
  create: (caseId, visibility) => post('/api/rooms', visibility ? { caseId, visibility } : { caseId }),
  /** Public rooms: waiting rooms with a free seat plus public games in progress. */
  publicRooms: ({ language = '', openOnly = false, q = '' } = {}) => {
    const params = new URLSearchParams();
    if (language) params.set('language', language);
    if (openOnly) params.set('openOnly', 'true');
    if (q) params.set('q', q);
    const query = params.toString();
    return get(`/api/rooms/public${query ? `?${query}` : ''}`);
  },
  /** `inviteToken`: the secret of a playtest invite link; left out of the body for ordinary rooms. */
  join: (roomCode, inviteToken = '') => post('/api/rooms/join', inviteToken ? { roomCode, inviteToken } : { roomCode }),
  get: (roomId) => get(`/api/rooms/${roomId}`),
  leave: (roomId) => post(`/api/rooms/${roomId}/leave`),
  selectRole: (roomId, role) => post(`/api/rooms/${roomId}/select-role`, { role }),
  ready: (roomId, isReady) => post(`/api/rooms/${roomId}/ready`, { isReady }),
  /** Puts on one of the caller's outfits (itemId) or takes the detective's outfit off (null); answers the redrawn room. */
  wearOutfit: (roomId, category, itemId) => put(`/api/rooms/${roomId}/outfit`, { category, itemId: itemId ?? null }),
  start: (roomId) => post(`/api/rooms/${roomId}/start`),
  abandon: (roomId) => post(`/api/rooms/${roomId}/abandon`),
};
