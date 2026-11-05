import { render } from '../utils/dom.js';

/** #/admin/items. ADMIN-1 replaces this placeholder. */
export async function renderAdminItemsPage(app) {
  render(app, `
    <div class="page" data-admin-placeholder>
      <h2>Vật phẩm</h2>
      <p class="muted">Đang xây dựng</p>
    </div>`);
}
