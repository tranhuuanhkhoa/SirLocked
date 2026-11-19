import '../../../css/36-bpa-market.css';
import { marketApi } from '../api/marketApi.js';
import { publishWallet } from '../components/walletChip.js';
import { tr } from '../services/i18n.js';
import { render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { RARITIES, COIN_SVG, errorText, fmt } from './market/marketKit.js';
import { mountBuyTab } from './market/buyTab.js';
import { mountSellTab } from './market/sellTab.js';
import { mountTradeTab } from './market/tradeTab.js';
import { mountOrdersTab } from './market/ordersTab.js';
import { replaceAddress } from '../services/navigation.js';

const TABS = [
  { key: 'buy', label: ['BUY', 'MUA'], mount: mountBuyTab },
  { key: 'sell', label: ['SELL', 'BÁN'], mount: mountSellTab },
  { key: 'trade', label: ['TRADE', 'TRAO ĐỔI'], mount: mountTradeTab },
  { key: 'orders', label: ['MY ORDERS', 'LỆNH CỦA TÔI'], mount: mountOrdersTab },
];

/** /market[/sell|/trade|/orders] — Chợ đồ (Market.dc.html). */
/** /market?q=… (the lobby's "see prices on the market" link) opens the buy tab already searching for that item. */
function initialQuery() {
  try {
    return (new URLSearchParams(window.location.search).get('q') ?? '').trim().slice(0, 60);
  } catch {
    return '';
  }
}

export async function renderMarketPage(app, tabParam) {
  const reducedMotion = (() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  })();
  const state = {
    tab: TABS.some((tab) => tab.key === tabParam) ? tabParam : 'buy',
    wallet: null,
    flip: false,
    // MUA
    q: initialQuery(), category: '', rarities: new Set(RARITIES), sort: 'popular', page: 1, browse: null, selectedDef: null, detail: null, detailFlip: false, bidOpen: false,
    // BÁN
    inventory: null, selectedItemId: null, price: '',
    // TRAO ĐỔI
    trade: null, trades: null,
    // LỆNH CỦA TÔI
    mine: null,
  };
  let disposed = false;
  let current = null;

  render(app, `
    <div class="bpa-container bpa-mk-page">
      <div class="bpa-mk-intro">
        <div class="bpa-label bpa-mk-head">
          <p class="bpa-kicker">${tr('FILE 05 · TRADING', 'HỒ SƠ 05 · GIAO DỊCH')}</p>
          <h1 class="bpa-mk-h1">${tr('Market', 'Chợ đồ')}</h1>
        </div>
        <p class="bpa-mk-lede">${tr(
    'Buy, sell and swap gear with other detectives. Players set every price.',
    'Mua, bán và trao đổi vật phẩm với các thám tử khác. Giá do người chơi tự đặt.')}</p>
        <div class="bpa-mk-wallet" role="status" aria-live="polite">
          ${COIN_SVG(28)}
          <div><span class="bpa-mk-walletk">${tr('YOUR WALLET', 'VÍ CỦA BẠN')}</span>
            <span class="bpa-mk-walletv"><span data-mk-balance>…</span> <span class="bpa-mk-walletu">xu</span></span>
            <span class="bpa-mk-walletheld" data-mk-held hidden></span></div>
        </div>
        <a class="bpa-btn" href="/payments">${tr('Top up coins', 'Nạp xu')} →</a>
      </div>
      <div class="bpa-mk-book-wrap">
        <div class="bpa-mk-tabs" role="tablist" aria-label="${tr('Market sections', 'Các mục của chợ')}">
          ${TABS.map((tab) => `<button type="button" role="tab" class="bpa-tab bpa-mk-tab" id="mk-tab-${tab.key}" data-tab="${tab.key}"
            aria-controls="mk-panel" aria-selected="${tab.key === state.tab}" tabindex="${tab.key === state.tab ? '0' : '-1'}">${tr(tab.label[0], tab.label[1])}</button>`).join('')}
        </div>
        <section class="bpa-mk-sheet bpa-paper" aria-label="${tr('Market', 'Nội dung chợ')}">
          <div id="mk-panel" role="tabpanel" aria-labelledby="mk-tab-${state.tab}"></div>
        </section>
      </div>
    </div>`);

  const balanceEl = app.querySelector('[data-mk-balance]');
  const heldEl = app.querySelector('[data-mk-held]');

  const ctx = {
    state,
    panel: null,
    reducedMotion,
    isActive: () => !disposed && app.isConnected,
    setWallet(wallet) {
      if (!wallet || disposed) return;
      state.wallet = wallet;
      balanceEl.textContent = fmt(wallet.balance);
      heldEl.hidden = !wallet.held;
      heldEl.textContent = wallet.held ? tr(`${fmt(wallet.held)} held by buy orders`, `${fmt(wallet.held)} xu đang giữ cho lệnh mua`) : '';
      publishWallet(wallet);
    },
    async refreshWallet() {
      try {
        ctx.setWallet(await marketApi.wallet());
      } catch {
        // Keep the last known balance.
      }
    },
    go(tab) {
      switchTab(tab, true);
    },
    /** Runs one user action: the button is disabled meanwhile and errors become a toast (or inline text). */
    async run(button, action, errorEl = null, onError = null) {
      if (button?.disabled || button?.getAttribute('aria-busy') === 'true') return;
      button?.setAttribute('aria-busy', 'true');
      if (button) button.disabled = true;
      if (errorEl) errorEl.textContent = '';
      try {
        await action();
      } catch (error) {
        const message = errorText(error);
        if (errorEl && errorEl.isConnected) errorEl.textContent = message;
        else toast(message, 'error');
        if (onError) await Promise.resolve(onError(error)).catch(() => {});
        ctx.refreshWallet();
      } finally {
        if (button?.isConnected) {
          button.removeAttribute('aria-busy');
          button.disabled = false;
        }
      }
    },
  };

  function switchTab(key, animate) {
    if (!TABS.some((tab) => tab.key === key)) key = 'buy';
    current?.dispose?.();
    state.tab = key;
    state.flip = !state.flip;
    app.querySelectorAll('[data-tab]').forEach((button) => {
      const selected = button.dataset.tab === key;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    const old = app.querySelector('#mk-panel');
    const panel = document.createElement('div');
    panel.id = 'mk-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `mk-tab-${key}`);
    if (animate && !reducedMotion) panel.className = state.flip ? 'bpa-wipe-b' : 'bpa-wipe-a';
    old.replaceWith(panel);
    ctx.panel = panel;
    const path = key === 'buy' ? '/market' : `/market/${key}`;
    if (window.location.pathname !== path) replaceAddress(path);
    current = TABS.find((tab) => tab.key === key).mount(ctx);
    // Someone else may have bought from us or filled our order meanwhile.
    if (animate) ctx.refreshWallet();
  }

  app.querySelector('.bpa-mk-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (button && button.dataset.tab !== state.tab) switchTab(button.dataset.tab, true);
  });
  app.querySelector('.bpa-mk-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.key === state.tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    switchTab(TABS[next].key, true);
    app.querySelector(`#mk-tab-${TABS[next].key}`)?.focus();
  });

  switchTab(state.tab, false);
  ctx.refreshWallet().then(() => {
    if (!state.wallet && !disposed) balanceEl.textContent = '—';
  });

  return () => {
    disposed = true;
    current?.dispose?.();
  };
}

