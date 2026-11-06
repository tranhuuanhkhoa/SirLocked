import { adminPlayersApi } from '../api/adminPlayersApi.js';
import { pageHead, segTabs } from '../components/admin/ui.js';
import { render } from '../utils/dom.js';
import { mountAvatarGrid } from './admin/players/avatarGrid.js';
import { mountPlayerDetail } from './admin/players/playerDetail.js';
import { mountPlayerList } from './admin/players/playerList.js';
import { routeParams, writeRouteParams } from './admin/players/shared.js';

const TABS = [
  { id: 'danhsach', label: 'Danh sách' },
  { id: 'anh', label: 'Duyệt ảnh đại diện' },
];

/** /admin/players (the list, ?tab=anh for the picture grid) and /admin/players/:id. */
export async function renderAdminPlayersPage(app, id, { signal } = {}) {
  if (id) return mountPlayerDetail(app, decodeURIComponent(id), { signal });

  let active = routeParams().get('tab') === 'anh' ? 'anh' : 'danhsach';
  // How many pictures wait for a decision, shown on their tab. Unknown until the server says.
  let pending = null;
  render(app, `
    <div class="page adp-page">
      ${pageHead({ title: 'Người chơi' })}
      <div class="adp-page-tabs" data-adp-tabs></div>
      <div class="adp-body" data-adp-body></div>
    </div>`);
  const tabsHost = app.querySelector('[data-adp-tabs]');
  const drawTabs = () => {
    tabsHost.innerHTML = segTabs(TABS.map((tab) => ({
      key: tab.id, label: tab.label, active: tab.id === active, count: tab.id === 'anh' ? pending : undefined,
    })), 'Mục người chơi');
  };

  // Only the total is wanted: one row is the smallest page the server gives.
  const countPending = () => adminPlayersApi.avatars({ pending: 'true', page: 1, pageSize: 1 })
    .then((data) => {
      if (signal?.aborted || typeof data?.total !== 'number') return;
      pending = data.total;
      drawTabs();
    })
    .catch(() => {});

  // Each tab draws its own controls, and abandons its listeners when another takes over.
  let views = null;
  const show = () => {
    views?.abort();
    views = new AbortController();
    const stop = () => views.abort();
    signal?.addEventListener('abort', stop, { once: true });
    drawTabs();
    const old = app.querySelector('[data-adp-body]');
    const body = old.cloneNode(false);
    old.replaceWith(body);
    if (active === 'anh') mountAvatarGrid(body, { signal: views.signal, onChange: countPending });
    else mountPlayerList(body, { signal: views.signal });
  };
  tabsHost.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-adm-tab]');
    if (!tab || tab.dataset.admTab === active) return;
    active = tab.dataset.admTab;
    writeRouteParams({ tab: active === 'anh' ? 'anh' : '', page: 1, q: '', role: '', status: '', sort: '', asc: '', all: '', size: '' });
    show();
  }, signal ? { signal } : undefined);
  show();
  countPending();
  return () => views?.abort();
}
