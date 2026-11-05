import { get } from './http.js';

/** The admin audit log. Filters: targetType, targetId, adminId, action, from, to, page, pageSize. Blank ones are left out. */
export const adminAuditApi = {
  list: (filters = {}) => {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ).toString();
    return get(`/api/admin/audit${query ? `?${query}` : ''}`);
  },
};
