import { pageHead, segTabs } from '../components/admin/ui.js';
import { render } from '../utils/dom.js';
import { mountAnomalies, mountStuck } from './admin/players/economyWatch.js';
import { mountHistory, mountMarket } from './admin/players/economyMarket.js';
import { mountOverview } from './admin/players/economyOverview.js';
import { mountReviews, mountRooms } from './admin/players/roomsReviews.js';
import { routeParams, writeRouteParams } from './admin/players/shared.js';

const TABS = [
  { id: 'tongquan', label: 'Tổng quan', mount: mountOverview },
  { id: 'cho', label: 'Chợ', mount: mountMarket },
  { id: 'lichsu', label: 'Lịch sử & trao đổi', mount: mountHistory },
  { id: 'batthuong', label: 'Bất thường', mount: mountAnomalies },
  { id: 'ket', label: 'Giao dịch kẹt', mount: mountStuck },
  { id: 'phong', label: 'Phòng chơi', mount: mountRooms },
  { id: 'danhgia', label: 'Đánh giá', mount: mountReviews },
];

/** /admin/economy. The address keeps the open tab (?tab=), so a link can point straight at stuck operations or rooms. */
export async function renderAdminEconomyPage(app, { signal } = {}) {
  const fromAddress = routeParams().get('tab');
  let active = TABS.some((tab) => tab.id === fromAddress) ? fromAddress : 'tongquan';
  render(app, `
    <div class="page adp-page">
      ${pageHead({ title: 'Kinh tế & chợ' })}
      <div class="adp-page-tabs" data-adp-tabs></div>
      <section class="adp-body" data-adp-body></section>
    </div>`);
  const tabsHost = app.querySelector('[data-adp-tabs]');

  // Each tab draws its own controls, and abandons its listeners when another takes over.
  let view = null;
  const show = () => {
    view?.abort();
    view = new AbortController();
    const stop = () => view.abort();
    signal?.addEventListener('abort', stop, { once: true });
    tabsHost.innerHTML = segTabs(TABS.map((tab) => ({ key: tab.id, label: tab.label, active: tab.id === active })), 'Mục kinh tế');
    const old = app.querySelector('[data-adp-body]');
    const body = old.cloneNode(false);
    body.dataset.adpEconomy = active;
    old.replaceWith(body);
    TABS.find((tab) => tab.id === active).mount(body, { signal: view.signal });
  };
  tabsHost.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-adm-tab]');
    if (!tab || tab.dataset.admTab === active) return;
    active = tab.dataset.admTab;
    const address = new URLSearchParams(window.location.search);
    writeRouteParams(Object.fromEntries([...address.keys()].map((key) => [key, ''])));
    writeRouteParams({ tab: active === 'tongquan' ? '' : active });
    show();
  }, signal ? { signal } : undefined);
  show();
  return () => view?.abort();
}
