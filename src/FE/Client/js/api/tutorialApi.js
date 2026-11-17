import { get, post } from './http.js';

/** Màn tân thủ: the Kỳ cựu / Nhập môn choice, starting or resuming the solo tutorial room, its role switch. */
export const tutorialApi = {
  status: () => get('/api/tutorial/status'),
  choose: (path) => post('/api/tutorial/choice', { path }),
  start: () => post('/api/tutorial/start', {}),
  switchRole: (roomId, role) => post(`/api/tutorial/rooms/${encodeURIComponent(roomId)}/role`, { role }),
};
