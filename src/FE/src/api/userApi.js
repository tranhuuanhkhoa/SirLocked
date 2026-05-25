import { apiRequest } from './apiClient';

export function getMe() {
  return apiRequest('/users/me');
}

export function updateProfile(data) {
  return apiRequest('/users/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
