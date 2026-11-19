import { get, post, put } from './http.js';

const newIdempotencyKey = () => typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const aiCaseApi = {
  capabilities: () => get('/api/admin/ai-cases/capabilities'),
  /**
   * A new order: the level decides the size of the case on the server. Sends only
   * { prompt, difficulty, leaning, language, caseType, order }: no stage count, preset or Crack toggle.
   */
  createOrder: ({ prompt = '', difficulty = 'medium', leaning = 'BALANCED', language = 'en', caseType = 'RANDOM', order }, idempotencyKey = newIdempotencyKey()) =>
    post('/api/admin/ai-cases', { prompt, difficulty, leaning, language, caseType, order }, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  /** The caller's orders left this week (VIP); ADMIN answers { unlimited: true }. */
  quota: () => get('/api/admin/ai-cases/quota'),
  replaceJson: (draftId, caseJson, storyPreview = null) =>
    put(`/api/admin/ai-cases/${draftId}/case-json`, { caseJson, storyPreview }),
  approveDraft: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve`),
  approveTruth: (draftId) => post(`/api/admin/ai-cases/${draftId}/approve-truth`),
  /** Answers a question the bot asked with draft_ask; the bot then continues. */
  answerDecision: (draftId, decisionId, optionId) => post(`/api/admin/ai-cases/${draftId}/decisions/${decisionId}`, { optionId }),
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
  /** VUAN-7: any of vipPricing, vipModels, hintPricing, authorRewards (each section is saved and logged on its own). */
  saveVipSettings: (sections) => put('/api/admin/ai-cases/settings', sections),
  /** VUAN-7: price of a VIP order, the caller's coins and whether the Claude API lane is open. Nothing is held. */
  vipQuote: (preset, speed, pixelLabCap) =>
    get(`/api/admin/ai-cases/vip-quote?preset=${encodeURIComponent(preset)}&speed=${encodeURIComponent(speed)}&pixelLabCap=${encodeURIComponent(pixelLabCap)}`),
  vipReport: (days = 30) => get(`/api/admin/ai-cases/vip-report?days=${encodeURIComponent(days)}`),
  authors: () => get('/api/admin/authors'),
  authorPayouts: (state = '') => get(`/api/admin/authors/payouts?state=${encodeURIComponent(state)}&limit=100`),
  holdPayout: (id, reason) => post(`/api/admin/authors/payouts/${encodeURIComponent(id)}/hold`, { reason }),
  releasePayout: (id) => post(`/api/admin/authors/payouts/${encodeURIComponent(id)}/release`),
  revokePayout: (id, reason) => post(`/api/admin/authors/payouts/${encodeURIComponent(id)}/revoke`, { reason }),
  library: (world = '', kind = '') => get(`/api/admin/ai-cases/library?world=${encodeURIComponent(world)}&kind=${encodeURIComponent(kind)}`),
  importDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/import?overwrite=${overwrite}`),
  publishDraft: (draftId, overwrite = true) => post(`/api/admin/ai-cases/${draftId}/publish?overwrite=${overwrite}`),
};
