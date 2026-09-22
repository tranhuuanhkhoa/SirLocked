import { get, post } from './http.js';

export const roomApi = {
  create: (caseId) => post('/api/rooms', { caseId }),
  join: (roomCode) => post('/api/rooms/join', { roomCode }),
  get: (roomId) => get(`/api/rooms/${roomId}`),
  leave: (roomId) => post(`/api/rooms/${roomId}/leave`),
  selectRole: (roomId, role) => post(`/api/rooms/${roomId}/select-role`, { role }),
  ready: (roomId, isReady) => post(`/api/rooms/${roomId}/ready`, { isReady }),
  start: (roomId) => post(`/api/rooms/${roomId}/start`),
  abandon: (roomId) => post(`/api/rooms/${roomId}/abandon`),
};
