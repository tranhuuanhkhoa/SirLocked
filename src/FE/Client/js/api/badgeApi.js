import { get } from './http.js';

export const badgeApi = {
  forUser: (userId) => get(`/api/profile/${encodeURIComponent(userId)}/badges`),
};
