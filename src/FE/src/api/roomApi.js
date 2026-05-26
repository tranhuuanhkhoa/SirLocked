import { apiRequest } from './apiClient';

export function createRoom(caseId) {
  return apiRequest('/rooms', {
    method: 'POST',
    body: JSON.stringify({ caseId }),
  });
}

export function joinRoom(roomCode) {
  return apiRequest('/rooms/join', {
    method: 'POST',
    body: JSON.stringify({ roomCode }),
  });
}

export function getRoom(roomId) {
  return apiRequest(`/rooms/${roomId}`);
}
