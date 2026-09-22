import { get } from './http.js';

export const workshopApi = {
  cases: ({ search = '', sort = 'hot', page = 1, pageSize = 12 } = {}) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return get(`/api/workshop/cases?${params.toString()}`);
  },
  stats: (caseId) => get(`/api/workshop/cases/${encodeURIComponent(caseId)}/stats`),
};
