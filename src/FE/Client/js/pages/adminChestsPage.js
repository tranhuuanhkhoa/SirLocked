import { render } from '../utils/dom.js';

/** #/admin/chests và #/admin/chests/:id. ADMIN-1 replaces this placeholder. */
export async function renderAdminChestsPage(app) {
  render(app, `
    <div class="page" data-admin-placeholder>
      <h2>Hòm &amp; vật phẩm</h2>
      <p class="muted">Đang xây dựng</p>
    </div>`);
}
