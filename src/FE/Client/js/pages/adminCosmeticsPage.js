import { render } from '../utils/dom.js';

/** #/admin/cosmetics và #/admin/cosmetics/:defId. ADMIN-2 replaces this placeholder. */
export async function renderAdminCosmeticsPage(app) {
  render(app, `
    <div class="page" data-admin-placeholder>
      <h2>Mỹ phẩm</h2>
      <p class="muted">Đang xây dựng</p>
    </div>`);
}
