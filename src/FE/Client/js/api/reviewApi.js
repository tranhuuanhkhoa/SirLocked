import { apiFetch, get, post } from './http.js';

const base = (caseId) => `/api/workshop/cases/${encodeURIComponent(caseId)}/reviews`;

export const reviewApi = {
  list: (caseId, page = 1, pageSize = 10) =>
    get(`${base(caseId)}?page=${page}&pageSize=${pageSize}`),
  summary: (caseId) => get(`${base(caseId)}/summary`),
  eligibility: (caseId) => get(`${base(caseId)}/eligibility`),
  submit: (caseId, payload) => post(base(caseId), payload),
  deleteMine: (caseId) => apiFetch('DELETE', `${base(caseId)}/mine`),
};
