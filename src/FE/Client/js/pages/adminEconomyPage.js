import { render } from '../utils/dom.js';

/** #/admin/economy. ADMIN-3 replaces this placeholder. */
export async function renderAdminEconomyPage(app) {
  render(app, `
    <div class="page" data-admin-placeholder>
      <h2>Kinh tế &amp; chợ</h2>
      <p class="muted">Đang xây dựng</p>
    </div>`);
}
