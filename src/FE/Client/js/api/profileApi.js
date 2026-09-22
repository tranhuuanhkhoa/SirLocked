import { get } from './http.js';

export const profileApi = {
  get: (userId) => get(`/api/profile/${encodeURIComponent(userId)}`),
  me: () => get('/api/profile/me'),
};
