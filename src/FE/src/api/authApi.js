import { apiRequest } from './apiClient';

export function registerUser(data) {
  return apiRequest('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function loginUser(data) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function logoutUser() {
  return apiRequest('/auth/logout', {
    method: 'POST',
  });
}
