import '../../../css/36-bpa-market.css';
import { marketApi } from '../api/marketApi.js';
import { session } from '../services/session.js';
import { tr } from '../services/i18n.js';
import { escapeHtml } from '../utils/dom.js';
import { COIN_SVG, fmt } from '../pages/market/marketKit.js';

/** Fired with a WalletDto whenever the market changes the caller's coins. */
export const WALLET_EVENT = 'sirlocked:wallet';
const REFRESH_MS = 20_000;

let cache = { userId: '', wallet: null, at: 0, pending: null };

export function publishWallet(wallet) {
  if (!wallet) return;
  window.dispatchEvent(new CustomEvent(WALLET_EVENT, { detail: wallet }));
}

function balanceText(wallet) {
  return wallet ? fmt(wallet.balance) : '…';
}

function chipLabel(wallet) {
  return wallet
    ? tr(`Wallet: ${fmt(wallet.balance)} coins`, `Ví: ${fmt(wallet.balance)} xu`)
    : tr('Wallet', 'Ví');
}

/** Header coin balance ("1.250 xu"); links to the market. */
export function walletChipMarkup() {
  const user = session.user();
  const wallet = user && cache.userId === user.userId ? cache.wallet : null;
  return `
    <a class="bpa-shell-iconbtn bpa-mk-chip" id="nav-wallet" href="/market" aria-label="${escapeHtml(chipLabel(wallet))}">
      ${COIN_SVG(18)}<span data-wallet-balance>${balanceText(wallet)}</span><span class="bpa-mk-chip-unit" aria-hidden="true">xu</span>
    </a>`;
}

function paint(wallet) {
  const chip = document.getElementById('nav-wallet');
  if (!chip || !wallet) return;
  chip.querySelector('[data-wallet-balance]').textContent = balanceText(wallet);
  chip.setAttribute('aria-label', chipLabel(wallet));
}

/** Fills the chip from the cache and refreshes it at most every 20 s (the market page pushes updates itself). */
export function hydrateWalletChip() {
  const user = session.user();
  if (!user) return;
  if (cache.userId !== user.userId) cache = { userId: user.userId, wallet: null, at: 0, pending: null };
  paint(cache.wallet);
  if (cache.pending || Date.now() - cache.at < REFRESH_MS) return;
  const userId = user.userId;
  cache.pending = marketApi.wallet()
    .then((wallet) => {
      if (cache.userId !== userId) return;
      cache.wallet = wallet;
      cache.at = Date.now();
      paint(wallet);
    })
    .catch(() => {
      // The chip keeps its last value; the market page shows its own errors.
    })
    .finally(() => {
      if (cache.userId === userId) cache.pending = null;
    });
}

window.addEventListener(WALLET_EVENT, (event) => {
  const user = session.user();
  if (!user) return;
  cache = { userId: user.userId, wallet: event.detail, at: Date.now(), pending: null };
  paint(event.detail);
});

/** "+120 xu phần thưởng" on the result page, once the reward for this room is known. */
export async function hydrateRewardChip(container, roomId) {
  if (!container || !roomId) return;
  let reward = null;
  try {
    reward = await marketApi.reward(roomId);
  } catch {
    return;
  }
  if (!reward || !container.isConnected) return;
  container.innerHTML = `${COIN_SVG(20)}<span>+${fmt(reward.amount)} xu</span><span class="bpa-sr"> ${tr('reward', 'phần thưởng')}</span><small aria-hidden="true">${tr('REWARD', 'PHẦN THƯỞNG')}</small>`;
  container.hidden = false;
  cache.at = 0;
  hydrateWalletChip();
}
