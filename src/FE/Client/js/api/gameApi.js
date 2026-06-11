import { get, post } from './http.js';

export const gameApi = {
  state: (roomId) => get(`/api/game/rooms/${roomId}/state`),
  inspectItem: (roomId, itemId) => post(`/api/game/rooms/${roomId}/inspect-item`, { itemId }),
  askDialogue: (roomId, dialogueId) => post(`/api/game/rooms/${roomId}/ask-dialogue`, { dialogueId }),
  presentEvidence: (roomId, dialogueId, evidenceId) =>
    post(`/api/game/rooms/${roomId}/present-evidence`, { dialogueId, evidenceId }),
  completeScene: (roomId) => post(`/api/game/rooms/${roomId}/complete-scene`),
  completeStage: (roomId) => post(`/api/game/rooms/${roomId}/complete-stage`),
  goToScene: (roomId, sceneId) => post(`/api/game/rooms/${roomId}/go-to-scene`, { sceneId }),
  accuse: (roomId, culpritId, motive, method, evidenceIds) =>
    post(`/api/game/rooms/${roomId}/accuse`, { culpritId, motive, method, evidenceIds }),
  result: (roomId) => get(`/api/game/rooms/${roomId}/result`),
};
