import { apiRequest } from './apiClient';

export function createAiCaseDraft(data) {
  return apiRequest('/admin/ai-cases', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
