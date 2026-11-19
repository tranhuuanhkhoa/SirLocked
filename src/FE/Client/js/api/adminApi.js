import { get, post, patch, put } from './http.js';

export const adminApi = {
  dashboard: () => get('/api/admin/dashboard'),
  users: () => get('/api/admin/users'),
  lockUser: (userId) => patch(`/api/admin/users/${userId}/lock`),
  unlockUser: (userId) => patch(`/api/admin/users/${userId}/unlock`),
  setUserRole: (userId, role) => patch(`/api/admin/users/${userId}/role`, { role }),

  // Older (non-pixel) cases are hidden by the server unless includeLegacy is set.
  cases: (includeLegacy = false) => get(includeLegacy ? '/api/admin/cases?includeLegacy=true' : '/api/admin/cases'),
  caseDetail: (caseId) => get(`/api/admin/cases/${encodeURIComponent(caseId)}`),
  validateCase: (caseJson) => post('/api/admin/cases/validate', { caseJson }),
  importCase: (caseJson, overwrite) => post('/api/admin/cases/import-json', { caseJson, overwrite }),
  publishCase: (caseId) => patch(`/api/admin/cases/${encodeURIComponent(caseId)}/publish`),
  unpublishCase: (caseId) => patch(`/api/admin/cases/${encodeURIComponent(caseId)}/unpublish`),
  cutscene: (caseId) => get(`/api/admin/cases/${encodeURIComponent(caseId)}/cutscene`),
  generateCutscene: (caseId, regenerate = false) => post(`/api/admin/cases/${encodeURIComponent(caseId)}/cutscene/generate`, { regenerate }),
  saveCutscene: (caseId, id, script) => put(`/api/admin/cases/${encodeURIComponent(caseId)}/cutscene/${encodeURIComponent(id)}/script`, { script }),
  approveCutscene: (caseId, id) => post(`/api/admin/cases/${encodeURIComponent(caseId)}/cutscene/${encodeURIComponent(id)}/approve`),
  disableCutscene: (caseId) => post(`/api/admin/cases/${encodeURIComponent(caseId)}/cutscene/disable`),
  seedSample: () => post('/api/admin/cases/seed-sample?publish=true'),
  seedDemo: () => post('/api/admin/cases/seed-demo'),
  seedCrackDemo: () => post('/api/admin/cases/seed-crack-demo'),
  seedPixelDemo: () => post('/api/admin/cases/seed-pixel-demo'),

  // 404 while playtest instrumentation is off; callers hide the panel instead of surfacing an error.
  playtestSummary: (from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return get(`/api/admin/playtest/summary${query ? `?${query}` : ''}`);
  },
};
