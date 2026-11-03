import { apiFetchForm, get, post } from './http.js';

const enc = encodeURIComponent;

/** Hồ sơ thám tử. An exchange carries an idempotency key: the caller keeps one per user action and resends it on a retry. */
export const progressApi = {
  me: () => get('/api/progress/me'),
  user: (userId) => get(`/api/progress/users/${enc(userId)}`),
  exchange: (itemIds, idempotencyKey) => post('/api/progress/exchange', { itemIds, idempotencyKey }),
  setAvatar: (avatar) => post('/api/progress/avatar', { avatar }),
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetchForm('/api/progress/avatar/upload', form);
  },
};
