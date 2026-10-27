import { get } from './http.js';

export const caseApi = {
  published: () => get('/api/cases/published'),
  detail: (caseId) => get(`/api/cases/${encodeURIComponent(caseId)}`),
  /** Approved intro cutscene of a playable case, or null/undefined when it has none. */
  introCutscene: (caseId) => get(`/api/cases/${encodeURIComponent(caseId)}/intro-cutscene`),
};
