import { get, post } from './http.js';

export const aiCaseApi = {
  generate: (prompt, stageCount, difficulty) =>
    post('/api/admin/ai-cases', { prompt, stageCount, difficulty }),
  approveDraft: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve`),
  drafts: () => get('/api/admin/ai-cases'),
  draft: (draftId) => get(`/api/admin/ai-cases/${draftId}`),
  importDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/import?overwrite=${overwrite}`),
  publishDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/publish?overwrite=${overwrite}`),
};
