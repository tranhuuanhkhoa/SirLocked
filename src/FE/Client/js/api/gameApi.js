import { apiFetchBlob, apiFetchForm, get, post, put } from './http.js';

export const gameApi = {
  state: (roomId) => get(`/api/game/rooms/${roomId}/state`),
  inspectItem: (roomId, itemId) => post(`/api/game/rooms/${roomId}/inspect-item`, { itemId }),
  useItem: (roomId, itemId, targetId) => post(`/api/game/rooms/${roomId}/use-item`, { itemId, targetId }),
  combineItems: (roomId, itemIds) => post(`/api/game/rooms/${roomId}/combine-items`, { itemIds }),
  activateEnvironmentInteraction: (roomId, interactionId) =>
    post(`/api/game/rooms/${roomId}/interactions/${interactionId}/activate`),
  solvePuzzle: (roomId, puzzleId, answer, answerSequence = []) =>
    post(`/api/game/rooms/${roomId}/solve-puzzle`, { puzzleId, answer, answerSequence }),
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
  converse: (roomId, payload) => post(`/api/game/rooms/${roomId}/converse`, payload),
  presentEvidence: (roomId, payload) => post(`/api/game/rooms/${roomId}/present-evidence`, payload),
  startPairedConfrontation: (roomId, payload) => post(`/api/game/rooms/${roomId}/paired-confrontations`, payload),
  editPairedTestimony: (roomId, attemptId, payload) => put(`/api/game/rooms/${roomId}/paired-confrontations/${attemptId}/testimony`, payload),
  submitPairedEvidence: (roomId, attemptId, payload) => put(`/api/game/rooms/${roomId}/paired-confrontations/${attemptId}/evidence`, payload),
  confirmPairedConfrontation: (roomId, attemptId, payload) => post(`/api/game/rooms/${roomId}/paired-confrontations/${attemptId}/confirm`, payload),
  cancelPairedConfrontation: (roomId, attemptId, payload) => post(`/api/game/rooms/${roomId}/paired-confrontations/${attemptId}/cancel`, payload),
  recordPlaytestEvent: (roomId, payload) => post(`/api/game/rooms/${roomId}/playtest-events`, payload),
  hint: (roomId, contextType, targetId) => post(`/api/game/rooms/${roomId}/hint`, { contextType, targetId }),
  solveDeduction: (roomId, deductionId, optionId) => post(`/api/game/rooms/${roomId}/solve-deduction`, { deductionId, optionId }),
  completeScene: (roomId) => post(`/api/game/rooms/${roomId}/complete-scene`),
  completeStage: (roomId) => post(`/api/game/rooms/${roomId}/complete-stage`),
  goToScene: (roomId, sceneId) => post(`/api/game/rooms/${roomId}/go-to-scene`, { sceneId }),
  accuse: (roomId, payload) => post(`/api/game/rooms/${roomId}/accuse`, payload),
  proposeAccusation: (roomId, payload) => post(`/api/game/rooms/${roomId}/accusation`, payload),
  amendAccusation: (roomId, attemptId, payload) => put(`/api/game/rooms/${roomId}/accusation/${attemptId}`, payload),
  confirmAccusation: (roomId, attemptId, payload) => post(`/api/game/rooms/${roomId}/accusation/${attemptId}/confirm`, payload),
  cancelAccusation: (roomId, attemptId, payload) => post(`/api/game/rooms/${roomId}/accusation/${attemptId}/cancel`, payload),
  result: (roomId) => get(`/api/game/rooms/${roomId}/result`),
};
