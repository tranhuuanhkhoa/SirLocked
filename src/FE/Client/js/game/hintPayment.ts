// VUAN-7 part G: paid hint levels. Level 1 is free; level 2 is a rewarded ad (Google H5 Games Ads, when the server has
// ads on) or coins; level 3 is coins. Each paid level takes a share of the case score. The server answers 402
// HINT_PAYMENT_REQUIRED with the price; the player chooses in the page (never a browser dialog), then the same request
// is sent again with the payment. An ad only counts once the SDK reports it watched to the end.
import { gameApi } from '../api/gameApi.js';
import { tr } from '../services/i18n.js';
import { escapeHtml } from '../utils/dom.js';

export interface HintPaymentAsk {
  tier: number;
  priceXu: number;
  adAvailable: boolean;
  penaltyPercent: number;
}

export interface HintPaymentChoice {
  payWith: 'XU' | 'AD';
  adTicketId?: string;
}

interface HintEconomy {
  adsEnabled: boolean;
  publisherId: string;
  adsTestMode: boolean;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    adBreak?: (options: Record<string, unknown>) => void;
    adConfig?: (options: Record<string, unknown>) => void;
  }
}

let economy: HintEconomy | null = null;
let economyLoad: Promise<HintEconomy | null> | null = null;
let adsScript: Promise<boolean> | null = null;

/** The error of a paid level the player has not chosen how to pay for, or null. */
export function paymentAsk(error: any): HintPaymentAsk | null {
  const details = error?.errors;
  if (error?.status !== 402 || details?.code !== 'HINT_PAYMENT_REQUIRED') return null;
  return {
    tier: Number(details.tier) || 2,
    priceXu: Number(details.priceXu) || 0,
    adAvailable: Boolean(details.adAvailable),
    penaltyPercent: Number(details.penaltyPercent) || 0,
  };
}

async function loadEconomy(): Promise<HintEconomy | null> {
  if (economy) return economy;
  economyLoad ??= (gameApi as any).hintEconomy().then((value: HintEconomy) => (economy = value)).catch(() => null);
  return economyLoad;
}

/** Loads the H5 Games Ads script once (Ad Placement API); false when ads are off or the script cannot load. */
async function ensureAds(): Promise<boolean> {
  const config = await loadEconomy();
  if (!config?.adsEnabled || !config.publisherId) return false;
  adsScript ??= new Promise<boolean>((resolve) => {
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = (options: Record<string, unknown>) => { (window.adsbygoogle as unknown[]).push(options); };
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.publisherId)}`;
    script.crossOrigin = 'anonymous';
    script.dataset.adFrequencyHint = '30s';
    if (config.adsTestMode) script.dataset.adbreakTest = 'on';
    script.onload = () => {
      window.adConfig?.({ preloadAdBreaks: 'on', sound: 'on' });
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
  return adsScript;
}

/**
 * Shows one rewarded ad. Resolves the confirmed ticket id once the ad was watched to the end, or null (skipped,
 * failed, blocked by an ad blocker or not filled); the player can then pay with coins instead.
 */
async function rewardedAd(roomId: string): Promise<string | null> {
  if (!(await ensureAds()) || !window.adBreak) return null;
  const ticket = await (gameApi as any).hintAd(roomId);
  const watched = await new Promise<boolean>((resolve) => {
    let done = false;
    let offered = false;
    const finish = (value: boolean) => { if (!done) { done = true; resolve(value); } };
    window.adBreak!({
      type: 'reward',
      name: 'hint-level-2',
      beforeReward: (showAdFn: () => void) => { offered = true; showAdFn(); },
      adDismissed: () => finish(false),
      adViewed: () => finish(true),
      adBreakDone: (placement: { breakStatus?: string }) => { if (!offered || placement?.breakStatus !== 'viewed') finish(false); },
    });
    // No ad at all (no fill, blocked): give up after a while so the player can pay with coins.
    window.setTimeout(() => finish(false), 120_000);
  });
  if (!watched) return null;
  await (gameApi as any).hintAdViewed(roomId, ticket.id);
  return ticket.id as string;
}

/** The in-page choice: watch an ad (level 2, ads on) or pay coins; null when the player cancels. */
function chooseDialog(ask: HintPaymentAsk): Promise<'XU' | 'AD' | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'hint-pay-dialog';
    dialog.setAttribute('aria-labelledby', 'hint-pay-title');
    dialog.setAttribute('aria-describedby', 'hint-pay-text');
    dialog.innerHTML = `
      <h2 id="hint-pay-title">${escapeHtml(tr(`Hint level ${ask.tier}`, `Gợi ý mức ${ask.tier}`))}</h2>
      <p id="hint-pay-text">${escapeHtml(tr(
        `This level takes ${ask.penaltyPercent}% of the case score.`,
        `Mức này trừ ${ask.penaltyPercent}% điểm vụ.`))}</p>
      <div class="hint-pay-actions">
        ${ask.adAvailable ? `<button type="button" class="btn btn-primary" data-pay="AD">${escapeHtml(tr('Watch an ad', 'Xem quảng cáo'))}</button>` : ''}
        <button type="button" class="btn ${ask.adAvailable ? 'btn-secondary' : 'btn-primary'}" data-pay="XU">${escapeHtml(tr(`Pay ${ask.priceXu} coins`, `Trả ${ask.priceXu.toLocaleString('vi-VN')} xu`))}</button>
        <button type="button" class="btn btn-ghost" data-pay="">${escapeHtml(tr('Cancel', 'Hủy'))}</button>
      </div>`;
    document.body.append(dialog);
    const finish = (value: 'XU' | 'AD' | null) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.querySelectorAll<HTMLButtonElement>('[data-pay]').forEach((button) => button.addEventListener('click', () => {
      const value = button.dataset.pay;
      finish(value === 'XU' || value === 'AD' ? value : null);
    }));
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-pay]')?.focus();
  });
}

/**
 * Runs a hint request; when the level is paid, asks the player and sends it again with the chosen payment. Resolves
 * null when the player cancels or the ad was not finished (the message explains it).
 */
export async function withHintPayment<T>(
  roomId: string,
  call: (payment?: HintPaymentChoice) => Promise<T>,
  notify: (message: string, tone: 'info' | 'error') => void,
): Promise<T | null> {
  try {
    return await call(undefined);
  } catch (error) {
    const ask = paymentAsk(error);
    if (!ask) throw error;
    const choice = await chooseDialog(ask);
    if (!choice) return null;
    if (choice === 'AD') {
      const ticket = await rewardedAd(roomId).catch(() => null);
      if (!ticket) {
        notify(tr('The ad did not finish, so no hint was used. Try again or pay with coins.',
          'Quảng cáo chưa xem xong nên chưa dùng gợi ý. Hãy thử lại hoặc trả bằng xu.'), 'info');
        return null;
      }
      return call({ payWith: 'AD', adTicketId: ticket });
    }
    try {
      return await call({ payWith: 'XU' });
    } catch (paid: any) {
      if (paid?.errors?.code === 'HINT_INSUFFICIENT_COINS') {
        notify(tr(`Not enough coins (${ask.priceXu} needed). Top up in Market → Top up coins.`,
          `Không đủ xu (cần ${ask.priceXu.toLocaleString('vi-VN')} xu). Nạp xu ở Chợ đồ → Nạp xu.`), 'error');
        return null;
      }
      throw paid;
    }
  }
}
