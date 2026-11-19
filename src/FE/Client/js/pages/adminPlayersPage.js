import { adminPlayersApi } from '../api/adminPlayersApi.js';
import { pageHead, segTabs } from '../components/admin/ui.js';
import { render } from '../utils/dom.js';
import { navigate } from '../services/navigation.js';
import { toast } from '../utils/toast.js';
import { createAccountDialog } from './admin/players/accountDialogs.js';
import { mountAvatarGrid } from './admin/players/avatarGrid.js';
import { mountPlayerDetail } from './admin/players/playerDetail.js';
import { mountPlayerList } from './admin/players/playerList.js';
import { routeParams, writeRouteParams } from './admin/players/shared.js';

const TABS = [
  { id: 'danhsach', label: 'Người chơi' },
  { id: 'quantri', label: 'Quản trị' },
  { id: 'anh', label: 'Duyệt ảnh đại diện' },
];

/** /admin/players: players and VIPs, ?tab=quantri for the admin accounts, ?tab=anh for the picture grid; /admin/players/:id. */
export async function renderAdminPlayersPage(app, id, { signal } = {}) {
  if (id) return mountPlayerDetail(app, decodeURIComponent(id), { signal });

  const asked = routeParams().get('tab');
  let active = TABS.some((tab) => tab.id === asked) ? asked : 'danhsach';
  // How many pictures wait for a decision, shown on their tab. Unknown until the server says.
  let pending = null;
  render(app, `
    <div class="page adp-page">
      ${pageHead({ title: 'Người chơi', actionsHtml: '<button class="btn btn-primary" type="button" data-adp-create>Tạo tài khoản</button>' })}
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
    // The create button makes what the tab lists: a player or VIP, or an admin; the picture grid creates nothing.
    const create = app.querySelector('[data-adp-create]');
    create.style.display = active === 'anh' ? 'none' : '';
    create.textContent = active === 'quantri' ? 'Tạo tài khoản quản trị' : 'Tạo tài khoản';
    if (active === 'anh') mountAvatarGrid(body, { signal: views.signal, onChange: countPending });
    else mountPlayerList(body, { signal: views.signal, scope: active === 'quantri' ? 'admins' : 'players' });
  };
  app.querySelector('[data-adp-create]').addEventListener('click', async () => {
    const account = await createAccountDialog({ signal, admin: active === 'quantri' });
    if (!account) return;
    toast(`Đã tạo tài khoản ${account.email}.`, 'success');
    navigate(`/admin/players/${encodeURIComponent(account.userId)}`);
  }, signal ? { signal } : undefined);
  tabsHost.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-adm-tab]');
    if (!tab || tab.dataset.admTab === active) return;
    active = tab.dataset.admTab;
    writeRouteParams({ tab: active === 'danhsach' ? '' : active, page: 1, q: '', role: '', status: '', sort: '', asc: '', all: '', size: '' });
    show();
  }, signal ? { signal } : undefined);
  show();
  countPending();
  return () => views?.abort();
}
