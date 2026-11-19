import { get, post } from './http.js';

/** Chat and voice set-up between the two detectives of a match (TeamCommsController). */
export const teamCommsApi = {
  history: (roomId) => get(`/api/game/rooms/${encodeURIComponent(roomId)}/chat`),
  send: (roomId, text) => post(`/api/game/rooms/${encodeURIComponent(roomId)}/chat`, { text }),
  voice: (roomId) => get(`/api/game/rooms/${encodeURIComponent(roomId)}/voice`),
};
