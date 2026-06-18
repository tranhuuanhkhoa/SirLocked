import { apiFetchBlob, apiFetchForm, get, post } from './http.js';

export const gameApi = {
  state: (roomId) => get(`/api/game/rooms/${roomId}/state`),
  inspectItem: (roomId, itemId) => post(`/api/game/rooms/${roomId}/inspect-item`, { itemId }),
  captureClue: (roomId, sceneId, captureRect, photo) => {
    const form = new FormData();
    form.append('sceneId', sceneId);
    form.append('captureRect.x', String(captureRect.x));
    form.append('captureRect.y', String(captureRect.y));
    form.append('captureRect.width', String(captureRect.width));
    form.append('captureRect.height', String(captureRect.height));
    form.append('photo', photo, 'evidence.webp');
    return apiFetchForm(`/api/game/rooms/${roomId}/capture-clue`, form);
  },
  evidencePhoto: (photoUrl) => apiFetchBlob(photoUrl),
  askDialogue: (roomId, dialogueId) => post(`/api/game/rooms/${roomId}/ask-dialogue`, { dialogueId }),
  presentEvidence: (roomId, payload) => post(`/api/game/rooms/${roomId}/present-evidence`, payload),
  hint: (roomId, contextType, targetId) => post(`/api/game/rooms/${roomId}/hint`, { contextType, targetId }),
  solveDeduction: (roomId, deductionId, optionId) => post(`/api/game/rooms/${roomId}/solve-deduction`, { deductionId, optionId }),
  completeScene: (roomId) => post(`/api/game/rooms/${roomId}/complete-scene`),
  completeStage: (roomId) => post(`/api/game/rooms/${roomId}/complete-stage`),
  goToScene: (roomId, sceneId) => post(`/api/game/rooms/${roomId}/go-to-scene`, { sceneId }),
  accuse: (roomId, payload) => post(`/api/game/rooms/${roomId}/accuse`, payload),
  result: (roomId) => get(`/api/game/rooms/${roomId}/result`),
};
