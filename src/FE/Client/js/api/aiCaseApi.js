import { get, post, put } from './http.js';

export const aiCaseApi = {
  generate: (prompt, stageCount, difficulty, generationPreset = 'NORMAL_RANDOM', language = 'en') =>
    post('/api/admin/ai-cases', { prompt, stageCount, difficulty, generationPreset, language }),
  replaceJson: (draftId, caseJson, storyPreview = null) =>
    put(`/api/admin/ai-cases/${draftId}/case-json`, { caseJson, storyPreview }),
  approveDraft: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve`),
  approveFullLogic: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve-full-logic`),
  approveSceneLayout: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve-scene-layout`),
  continueDraft: (draftId) => post(`/api/admin/ai-cases/${draftId}/continue`),
  repairFullLogic: (draftId, repairInstructions = '') =>
    post(`/api/admin/ai-cases/${draftId}/repair-full-logic`, { repairInstructions }),
  acceptRepair: (draftId) => post(`/api/admin/ai-cases/${draftId}/accept-repair`),
  rejectRepair: (draftId) => post(`/api/admin/ai-cases/${draftId}/reject-repair`),
  retryJson: (draftId) => post(`/api/admin/ai-cases/${draftId}/retry-json`),
  regenerateFailedAssets: (draftId) => post(`/api/admin/ai-cases/${draftId}/regenerate-failed-assets`),
  drafts: () => get('/api/admin/ai-cases'),
  draft: (draftId) => get(`/api/admin/ai-cases/${draftId}`),
  importDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/import?overwrite=${overwrite}`),
  publishDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/publish?overwrite=${overwrite}`),
};
