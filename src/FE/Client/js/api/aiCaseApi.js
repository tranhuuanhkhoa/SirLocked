import { get, post, put } from './http.js';

const newIdempotencyKey = () => typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const aiCaseApi = {
  capabilities: () => get('/api/admin/ai-cases/capabilities'),
  /** `order` is the AiCaseOrder of the Claude bot (world, places, cast, weather...); left out when null. */
  generate: (prompt, stageCount, difficulty, generationPreset = 'NORMAL_RANDOM', language = 'en', includeCrackTheLie = false, caseType = 'RANDOM', idempotencyKey = newIdempotencyKey(), creativeConstraints = null, order = null) =>
    post('/api/admin/ai-cases', { prompt, stageCount, difficulty, generationPreset, language, includeCrackTheLie, caseType, creativeConstraints, ...(order ? { order } : {}) }, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  /** The caller's orders left this week (VIP); ADMIN answers { unlimited: true }. */
  quota: () => get('/api/admin/ai-cases/quota'),
  replaceJson: (draftId, caseJson, storyPreview = null) =>
    put(`/api/admin/ai-cases/${draftId}/case-json`, { caseJson, storyPreview }),
  approveDraft: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve`),
  approveTruth: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve-truth`),
  repairTruth: (draftId, repairInstructions = '', repairFromArtifact = null, useRepairCandidate = false) =>
    post(`/api/admin/ai-cases/${draftId}/repair-truth`, { repairInstructions, repairFromArtifact, ...(useRepairCandidate ? { useRepairCandidate: true } : {}) }),
  acceptTruthRepair: (draftId) => post(`/api/admin/ai-cases/${draftId}/accept-truth-repair`),
  rejectTruthRepair: (draftId) => post(`/api/admin/ai-cases/${draftId}/reject-truth-repair`),
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
  cancelDraft: (draftId) => post(`/api/admin/ai-cases/${draftId}/cancel`),
  /** "Chơi thử": the caller's private playtest room of an imported, unpublished draft (ADMIN or the draft's author). */
  playtest: (draftId) => post(`/api/admin/ai-cases/${encodeURIComponent(draftId)}/playtest`),
  approveOrder: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve-order`),
  rejectOrder: (draftId, reason) => post(`/api/admin/ai-cases/${draftId}/reject-order`, { reason }),
  settings: () => get('/api/admin/ai-cases/settings'),
  saveSettings: (vipWeeklyOrderLimit) => put('/api/admin/ai-cases/settings', { vipWeeklyOrderLimit }),
  library: (world = '', kind = '') => get(`/api/admin/ai-cases/library?world=${encodeURIComponent(world)}&kind=${encodeURIComponent(kind)}`),
  importDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/import?overwrite=${overwrite}`),
  publishDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/publish?overwrite=${overwrite}`),
};
