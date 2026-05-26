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

export function getRoomMessages(roomId) {
  return apiRequest(`/rooms/${roomId}/messages`);
}

export function setReady(roomId, isReady) {
  return apiRequest(`/rooms/${roomId}/ready`, {
    method: 'PATCH',
    body: JSON.stringify({ isReady }),
  });
}

export function selectRole(roomId, gameRole) {
  return apiRequest(`/rooms/${roomId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ gameRole }),
  });
}

export function startRoom(roomId) {
  return apiRequest(`/rooms/${roomId}/start`, {
    method: 'POST',
  });
}

export function leaveRoom(roomId) {
  return apiRequest(`/rooms/${roomId}/leave`, {
    method: 'POST',
  });
}
