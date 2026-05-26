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

export function askDialogue(roomId, dialogueId) {
  return apiRequest(`/game/rooms/${roomId}/ask-dialogue`, {
    method: 'POST',
    body: JSON.stringify({ dialogueId }),
  });
}

export function presentEvidence(roomId, dialogueId, evidenceId) {
  return apiRequest(`/game/rooms/${roomId}/present-evidence`, {
    method: 'POST',
    body: JSON.stringify({ dialogueId, evidenceId }),
  });
}

export function completeScene(roomId) {
  return apiRequest(`/game/rooms/${roomId}/complete-scene`, {
    method: 'POST',
  });
}

export function completeStage(roomId) {
  return apiRequest(`/game/rooms/${roomId}/complete-stage`, {
    method: 'POST',
  });
}

export function accuse(roomId, payload) {
  return apiRequest(`/game/rooms/${roomId}/accuse`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
