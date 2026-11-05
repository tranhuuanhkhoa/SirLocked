import { apiFetchForm } from './http.js';

/** Picture uploads, shared by every admin page. Resolves to { url, width, height }. */
export const adminAssetsApi = {
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetchForm('/api/admin/assets', form);
  },
};
