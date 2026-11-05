import { render } from '../utils/dom.js';

/** #/admin/audit. ADMIN-3 replaces this placeholder. */
export async function renderAdminAuditPage(app) {
  render(app, `
    <div class="page" data-admin-placeholder>
      <h2>Nhật ký</h2>
      <p class="muted">Đang xây dựng</p>
    </div>`);
}
