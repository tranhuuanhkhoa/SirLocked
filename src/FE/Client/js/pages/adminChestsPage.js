import { render } from '../utils/dom.js';
import { renderChestDetail } from './admin/chests/chestDetail.js';
import { renderChestGrant } from './admin/chests/chestGrant.js';
import { renderChestList } from './admin/chests/chestList.js';
import { renderChestLog } from './admin/chests/chestLog.js';
import { routeParam, subNav } from './admin/chests/shared.js';

/** /admin/chests (?tab=nhat-ky, ?tab=cap) and /admin/chests/:id. */
export async function renderAdminChestsPage(app, id, { signal } = {}) {
  if (id) return renderChestDetail(app, decodeURIComponent(id), { signal });

  const tab = routeParam('tab');
  const active = tab === 'nhat-ky' ? 'log' : tab === 'cap' ? 'grant' : 'chests';
  render(app, `<div class="page ac-page">${subNav(active)}<div data-ac-tab-content><p class="muted">Đang tải…</p></div></div>`);
  const content = app.querySelector('[data-ac-tab-content]');
  if (active === 'log') return renderChestLog(content, { signal });
  if (active === 'grant') return renderChestGrant(content, { signal });
  return renderChestList(content, { signal });
}
