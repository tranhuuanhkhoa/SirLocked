import { apiRequest } from './apiClient';

export function getAdminUsers() {
  return apiRequest('/admin/users');
}

export function getAdminRooms() {
  return apiRequest('/admin/rooms');
}

export function getAdminLogs() {
  return apiRequest('/admin/logs');
}

export function getAdminResults() {
  return apiRequest('/admin/results');
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
