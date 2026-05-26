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

export function getAdminCaseDetail(caseId) {
  return apiRequest(`/admin/cases/${caseId}`);
}

export function importCaseJson(gameCase) {
  return apiRequest('/admin/cases/import-json', {
    method: 'POST',
    body: JSON.stringify({ case: gameCase }),
  });
}

export function publishCase(caseId) {
  return apiRequest(`/admin/cases/${caseId}/publish`, {
    method: 'PATCH',
  });
}

export function unpublishCase(caseId) {
  return apiRequest(`/admin/cases/${caseId}/unpublish`, {
    method: 'PATCH',
  });
}

export function seedSampleCase() {
  return apiRequest('/admin/cases/seed-sample', {
    method: 'POST',
  });
}

export function seedDemoCases() {
  return apiRequest('/admin/cases/seed-demo', {
    method: 'POST',
  });
}
