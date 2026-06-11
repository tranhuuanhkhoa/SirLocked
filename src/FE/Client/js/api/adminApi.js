import { get, post, patch } from './http.js';

export const adminApi = {
  dashboard: () => get('/api/admin/dashboard'),
  users: () => get('/api/admin/users'),
  lockUser: (userId) => patch(`/api/admin/users/${userId}/lock`),
  unlockUser: (userId) => patch(`/api/admin/users/${userId}/unlock`),
  setUserRole: (userId, role) => patch(`/api/admin/users/${userId}/role`, { role }),

  cases: () => get('/api/admin/cases'),
  caseDetail: (caseId) => get(`/api/admin/cases/${encodeURIComponent(caseId)}`),
  validateCase: (caseJson) => post('/api/admin/cases/validate', { caseJson }),
  importCase: (caseJson, overwrite) => post('/api/admin/cases/import-json', { caseJson, overwrite }),
  publishCase: (caseId) => patch(`/api/admin/cases/${encodeURIComponent(caseId)}/publish`),
  unpublishCase: (caseId) => patch(`/api/admin/cases/${encodeURIComponent(caseId)}/unpublish`),
  seedSample: () => post('/api/admin/cases/seed-sample?publish=true'),
  seedDemo: () => post('/api/admin/cases/seed-demo'),
};
