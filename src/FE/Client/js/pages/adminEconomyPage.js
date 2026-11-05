import { render } from '../utils/dom.js';
import { mountAnomalies, mountStuck } from './admin/players/economyWatch.js';
import { mountHistory, mountMarket } from './admin/players/economyMarket.js';
import { mountOverview } from './admin/players/economyOverview.js';
import { mountReviews, mountRooms } from './admin/players/roomsReviews.js';
import { routeParams, tabsHtml, writeRouteParams } from './admin/players/shared.js';

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
      <div class="page-head"><h2>Kinh tế &amp; chợ</h2></div>
      <div data-adp-tabs></div>
      <section data-adp-body></section>
    </div>`);

  // Each tab draws its own controls, and abandons its listeners when another takes over.
  let view = null;
  const show = () => {
    view?.abort();
    view = new AbortController();
    const stop = () => view.abort();
    signal?.addEventListener('abort', stop, { once: true });
    app.querySelector('[data-adp-tabs]').innerHTML = tabsHtml(TABS, active, 'Mục kinh tế');
    const old = app.querySelector('[data-adp-body]');
    const body = old.cloneNode(false);
    body.dataset.adpEconomy = active;
    old.replaceWith(body);
    TABS.find((tab) => tab.id === active).mount(body, { signal: view.signal });
  };
  app.querySelector('[data-adp-tabs]').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab || tab.dataset.tab === active) return;
    active = tab.dataset.tab;
    const address = new URLSearchParams(window.location.search);
    writeRouteParams(Object.fromEntries([...address.keys()].map((key) => [key, ''])));
    writeRouteParams({ tab: active === 'tongquan' ? '' : active });
    show();
  }, signal ? { signal } : undefined);
  show();
  return () => view?.abort();
}
