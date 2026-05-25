import { apiRequest } from './apiClient';

export function getAdminUsers() {
  return apiRequest('/admin/users');
}

export function lockUser(id) {
  return apiRequest(`/admin/users/${id}/lock`, {
    method: 'PATCH',
  });
}

export function unlockUser(id) {
  return apiRequest(`/admin/users/${id}/unlock`, {
    method: 'PATCH',
  });
}
