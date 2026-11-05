import { render } from '../utils/dom.js';
import { mountAvatarGrid } from './admin/players/avatarGrid.js';
import { mountPlayerDetail } from './admin/players/playerDetail.js';
import { mountPlayerList } from './admin/players/playerList.js';
import { routeParams, tabsHtml, writeRouteParams } from './admin/players/shared.js';

const TABS = [
  { id: 'danhsach', label: 'Danh sách' },
  { id: 'anh', label: 'Duyệt ảnh đại diện' },
];

/** /admin/players (the list, ?tab=anh for the picture grid) and /admin/players/:id. */
export async function renderAdminPlayersPage(app, id, { signal } = {}) {
  if (id) return mountPlayerDetail(app, decodeURIComponent(id), { signal });

  let active = routeParams().get('tab') === 'anh' ? 'anh' : 'danhsach';
  render(app, `
    <div class="page adp-page">
      <div class="page-head"><h2>Người chơi</h2></div>
      <div data-adp-tabs></div>
      <section data-adp-body></section>
    </div>`);

  // Each tab draws its own controls, and abandons its listeners when another takes over.
  let views = null;
  const show = () => {
    views?.abort();
    views = new AbortController();
    const stop = () => views.abort();
    signal?.addEventListener('abort', stop, { once: true });
    app.querySelector('[data-adp-tabs]').innerHTML = tabsHtml(TABS, active, 'Mục người chơi');
    const old = app.querySelector('[data-adp-body]');
    const body = old.cloneNode(false);
    old.replaceWith(body);
    (active === 'anh' ? mountAvatarGrid : mountPlayerList)(body, { signal: views.signal });
  };
  app.querySelector('[data-adp-tabs]').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab || tab.dataset.tab === active) return;
    active = tab.dataset.tab;
    writeRouteParams({ tab: active === 'anh' ? 'anh' : '', page: 1, q: '', role: '', status: '', sort: '', asc: '', all: '' });
    show();
  }, signal ? { signal } : undefined);
  show();
  return () => views?.abort();
}
