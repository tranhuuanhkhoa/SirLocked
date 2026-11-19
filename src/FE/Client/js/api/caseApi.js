import { get } from './http.js';

export const caseApi = {
  published: () => get('/api/cases/published'),
  /** `playtestRoomId`: a playtest room the player sits in, so an unpublished draft can be read. */
  detail: (caseId, playtestRoomId = '') =>
    get(`/api/cases/${encodeURIComponent(caseId)}${playtestRoomId ? `?roomId=${encodeURIComponent(playtestRoomId)}` : ''}`),
  /** Approved intro cutscene of a playable case (or of the draft of a playtest room), or null/undefined when it has none. */
  introCutscene: (caseId, playtestRoomId = '') =>
    get(`/api/cases/${encodeURIComponent(caseId)}/intro-cutscene${playtestRoomId ? `?roomId=${encodeURIComponent(playtestRoomId)}` : ''}`),
};
