import { apiRequest } from './apiClient';

export function getGameState(roomId) {
  return apiRequest(`/game/rooms/${roomId}/state`);
}

export function inspectItem(roomId, itemId) {
  return apiRequest(`/game/rooms/${roomId}/inspect-item`, {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}
