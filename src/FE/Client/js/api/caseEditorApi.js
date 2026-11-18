import { get, post, put } from './http.js';

const id = (caseId) => encodeURIComponent(caseId);

/** Case Studio (/admin/editor): admin only. Every call answers the editor version the server now holds. */
export const caseEditorApi = {
  open: (caseId) => get(`/api/admin/case-editor/${id(caseId)}`),
  /** Autosave (checkpoint false) or "Lưu phiên bản" (checkpoint true). A stale baseVersion answers 409 CASE_EDITOR_STALE. */
  save: (caseId, baseVersion, caseJson, { checkpoint = false, note = '' } = {}) =>
    put(`/api/admin/case-editor/${id(caseId)}`, { baseVersion, caseJson, checkpoint, note }),
  revisions: (caseId) => get(`/api/admin/case-editor/${id(caseId)}/revisions`),
  revision: (caseId, number) => get(`/api/admin/case-editor/${id(caseId)}/revisions/${Number(number)}`),
  restore: (caseId, number, baseVersion, note = '') =>
    post(`/api/admin/case-editor/${id(caseId)}/revisions/${Number(number)}/restore`, { baseVersion, note }),
  publish: (caseId, baseVersion, note = '') => post(`/api/admin/case-editor/${id(caseId)}/publish`, { baseVersion, note }),
  /** "Chơi thử cảnh này": the AI draft's playtest room, starting both detectives in sceneId. */
  playtest: (caseId, sceneId) => post(`/api/admin/case-editor/${id(caseId)}/playtest`, { sceneId }),
};
