import { apiRequest } from './apiClient';

export function getPublishedCases() {
  return apiRequest('/cases/published');
}

export function getCaseDetail(caseId) {
  return apiRequest(`/cases/${caseId}`);
}

export function getAdminCases() {
  return apiRequest('/admin/cases');
}

export function importCaseJson(gameCase) {
  return apiRequest('/admin/cases/import-json', {
    method: 'POST',
    body: JSON.stringify({ case: gameCase }),
  });
}
