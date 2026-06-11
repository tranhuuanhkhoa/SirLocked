import { get } from './http.js';

export const caseApi = {
  published: () => get('/api/cases/published'),
  detail: (caseId) => get(`/api/cases/${encodeURIComponent(caseId)}`),
};
