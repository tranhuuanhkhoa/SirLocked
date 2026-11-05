import { render } from '../utils/dom.js';

/** #/admin/players và #/admin/players/:id. ADMIN-3 replaces this placeholder. */
export async function renderAdminPlayersPage(app) {
  render(app, `
    <div class="page" data-admin-placeholder>
      <h2>Người chơi</h2>
      <p class="muted">Đang xây dựng</p>
    </div>`);
}
