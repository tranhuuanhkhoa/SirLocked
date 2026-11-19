// VUAN-7 on /admin/ai: the VIP order panel (speed, price, coins, in-page hold confirmation, progress), and for ADMIN
// the settings card (VIP prices, models, hint prices, author rewards) and the cost/revenue report with author payouts.
import { aiCaseApi } from '../api/aiCaseApi.js';
import { escapeHtml } from '../utils/dom.js';
import { tr } from '../services/i18n.js';
import { icon, pill } from '../components/admin/ui.js';

export const VIP_SPEEDS = {
  FAST: ['Fast · 1–2 hours', 'Nhanh · 1–2 giờ'],
  SAVER: ['Saver · within 24 hours', 'Tiết kiệm · trong 24 giờ'],
};
const PRESET_NAMES = {
  SHORT_DEMO: ['Short demo', 'Short Demo'],
  NORMAL_RANDOM: ['Normal', 'Normal Random'],
  PUZZLE_HEAVY: ['Puzzle heavy', 'Puzzle Heavy'],
  DIALOGUE_HEAVY: ['Dialogue heavy', 'Dialogue Heavy'],
  FULL_FEATURE: ['Full feature', 'Full Feature'],
  CRACK_THE_LIE_V3: ['Crack the lie', 'Phá Vỡ Lời Dối'],
};
const BILLING_STATES = {
  HOLDING: ['Holding coins', 'Đang giữ xu'],
  HELD: ['Coins held', 'Đang giữ xu'],
  CHARGED: ['Paid', 'Đã trừ xu'],
  REFUNDED: ['Refunded', 'Đã hoàn xu'],
  PARTIALLY_REFUNDED: ['Partly refunded', 'Đã hoàn phần chưa dùng'],
  NOT_HELD: ['Not enough coins', 'Không đủ xu'],
};
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const PAYOUT_STATES = { HELD: ['Held 7 days', 'Đang giữ 7 ngày'], ON_HOLD: ['Stopped by admin', 'Admin tạm giữ'], PAID: ['Paid', 'Đã trả'], REVOKED: ['Revoked', 'Đã thu hồi'] };
const TIERS = { AUTHOR: ['Author', 'Tác giả'], SILVER: ['Loved author', 'Tác giả được yêu thích'], GOLD: ['Gold author', 'Tác giả vàng'] };

const pair = (labels, fallback = '') => (labels ? tr(labels[0], labels[1]) : fallback);
export const formatXu = (value) => Number(value || 0).toLocaleString('vi-VN');
const formatVnd = (value) => `${Number(value || 0).toLocaleString('vi-VN')} ₫`;
const formatTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};

// ------------------------------------------------------------------ VIP order panel

/** Quotes for both speeds, so the radio buttons show both prices. */
export async function loadVipQuotes(form) {
  const cap = 30 + Number(form.vipExtraPixelLab || 0);
  // Every new (OPEN_COOP_1) order runs on the Normal Random preset whatever its level: the server prices it so.
  const preset = form.preset || 'NORMAL_RANDOM';
  const [fast, saver] = await Promise.all([
    aiCaseApi.vipQuote(preset, 'FAST', cap),
    aiCaseApi.vipQuote(preset, 'SAVER', cap),
  ]);
  return { FAST: fast, SAVER: saver };
}

export function vipOrderPanelHtml(quotes, form, error) {
  // The VIP API lane is closed: the order is free (bridge bot), so no speed, price or hold is shown.
  if (!error && quotes?.FAST?.laneConfigured === false) return '';
  if (error) return `<div class="aai-vip-order" id="ai-vip-order"><p class="aai-field-error" role="alert">${escapeHtml(error.message || tr('Could not read the price.', 'Chưa đọc được giá.'))}</p></div>`;
  const quote = quotes?.[form.speed] || quotes?.FAST;
  if (!quote) return `<div class="aai-vip-order" id="ai-vip-order"><p>${tr('Reading the price…', 'Đang đọc giá…')}</p></div>`;
  const speeds = Object.entries(VIP_SPEEDS).map(([value, labels]) => `
      <label class="aai-vip-speed${form.speed === value ? ' is-selected' : ''}">
        <input type="radio" name="vipSpeed" value="${value}" ${form.speed === value ? 'checked' : ''}>
        <span>${pair(labels)}</span>
        <strong>${formatXu(quotes[value]?.priceXu)} xu</strong>
      </label>`).join('');
  const missing = Math.max(0, Number(quote.priceXu) - Number(quote.balance) - Number(quote.maxFromBonus || 0));
  return `
    <div class="aai-vip-order" id="ai-vip-order">
      <fieldset class="aai-vip-speeds">
        <legend class="aai-summary-label">${tr('Speed', 'Tốc độ')}</legend>
        ${speeds}
      </fieldset>
      ${quote.pixelLabEnabled ? `<label class="aai-vip-extra">
        <input type="checkbox" id="ai-vip-extra" ${Number(form.vipExtraPixelLab) > 0 ? 'checked' : ''}>
        <span>${tr('30 more PixelLab pictures', 'Thêm 30 lượt PixelLab')} (+${formatXu(Number(quote.extraPixelLabXu) > 0 ? quote.extraPixelLabXu : 450)} xu)</span>
      </label>` : `<p class="aai-help">${tr('Pictures come from the shared library and its variants.', 'Hình lấy từ thư viện chung và biến thể của nó.')}</p>`}
      <dl class="aai-vip-price">
        <div><dt>${tr('Price', 'Giá')}</dt><dd data-vip-price>${formatXu(quote.priceXu)} xu</dd></div>
        <div><dt>${tr('Your coins', 'Số dư xu nạp')}</dt><dd data-vip-balance>${formatXu(quote.balance)} xu</dd></div>
        ${Number(quote.maxFromBonus) > 0 ? `<div><dt>${tr('Bonus coins usable', 'Xu thưởng được dùng')}</dt><dd>${formatXu(quote.maxFromBonus)} xu</dd></div>` : ''}
      </dl>
      ${!quote.canAfford ? `<p class="aai-vip-short" role="status">${tr(`You need ${formatXu(missing)} more coins.`, `Còn thiếu ${formatXu(missing)} xu.`)}
        <a class="btn btn-sm btn-primary" href="/payments" data-link id="ai-vip-topup">${icon('plus', 14)}${tr('Top up coins', 'Nạp xu')}</a></p>` : ''}
      <p class="aai-help">${tr('The price is held when you send the order and goes back in full if the order is rejected or fails.', 'Giá được giữ khi gửi đơn và trả lại toàn bộ nếu đơn bị từ chối hoặc lỗi.')}</p>
    </div>`;
}

/** Why a paid VIP order cannot be sent (price not read yet, not enough coins), or ''. */
export function vipBlockReason(quotes, form) {
  // The VIP API lane is closed: the order is free and runs on the bridge bot like an ADMIN order.
  if (quotes?.FAST?.laneConfigured === false) return '';
  const quote = quotes?.[form.speed];
  if (!quote) return tr('Reading the price…', 'Đang đọc giá…');
  if (!quote.canAfford) return tr('Not enough coins for this order. Top up coins first.', 'Không đủ xu cho đơn này. Hãy nạp xu trước.');
  return '';
}

/** "Giữ X xu. Trả lại toàn bộ nếu đơn bị từ chối hoặc lỗi." in the page (never window.confirm). */
export function confirmVipHold(quote, abortSignal) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ac-dialog aai-vip-confirm';
    dialog.setAttribute('aria-labelledby', 'aai-vip-confirm-title');
    dialog.setAttribute('aria-describedby', 'aai-vip-confirm-text');
    dialog.innerHTML = `
      <header class="ac-dialog-head">
        <div class="ac-dialog-heading">
          <h2 id="aai-vip-confirm-title">${tr('Send this order?', 'Gửi đơn này?')}</h2>
          <p class="ac-dialog-sub" id="aai-vip-confirm-text">${tr(`Hold ${formatXu(quote.priceXu)} coins. Everything goes back if the order is rejected or fails.`, `Giữ ${formatXu(quote.priceXu)} xu. Trả lại toàn bộ nếu đơn bị từ chối hoặc lỗi.`)}</p>
        </div>
        <button type="button" class="ac-dialog-close" data-vip-cancel aria-label="${tr('Close', 'Đóng')}">${icon('x', 20)}</button>
      </header>
      <div class="ac-dialog-body">
        <div class="ac-dialog-actions">
          <button type="button" class="btn btn-ghost" data-vip-cancel>${tr('Cancel', 'Hủy')}</button>
          <button type="button" class="btn btn-primary" data-vip-confirm>${tr(`Hold ${formatXu(quote.priceXu)} coins and send`, `Giữ ${formatXu(quote.priceXu)} xu và gửi đơn`)}</button>
        </div>
      </div>`;
    document.body.append(dialog);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener('abort', cancel);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const cancel = () => finish(false);
    abortSignal?.addEventListener('abort', cancel, { once: true });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); cancel(); });
    dialog.querySelectorAll('[data-vip-cancel]').forEach((button) => button.addEventListener('click', cancel));
    dialog.querySelector('[data-vip-confirm]').addEventListener('click', () => finish(true));
    dialog.showModal();
    dialog.querySelector('[data-vip-confirm]').focus();
  });
}

/** One line under a VIP order: speed, price, what happened to the coins, and when it should be ready. */
export function vipDraftLine(draft) {
  const order = draft?.vipOrder;
  if (!order) return '';
  const state = pair(BILLING_STATES[order.state], order.state);
  const parts = [pair(VIP_SPEEDS[order.speed], order.speed), `${formatXu(order.priceXu)} xu`, state];
  if (order.state === 'HELD' && order.estimatedReadyAt) parts.push(tr(`expected by ${formatTime(order.estimatedReadyAt)}`, `dự kiến xong ${formatTime(order.estimatedReadyAt)}`));
  if (order.refundedXu > 0) parts.push(tr(`${formatXu(order.refundedXu)} refunded`, `đã hoàn ${formatXu(order.refundedXu)} xu`));
  return `<p class="aai-draft-meta aai-vip-line" data-vip-order="${escapeHtml(order.state)}">${icon('coins', 14)} ${parts.map(escapeHtml).join(' · ')}</p>`;
}

// ------------------------------------------------------------------ ADMIN settings

const num = (name, value, attrs = '') =>
  `<input class="field-input" type="number" inputmode="decimal" name="${name}" value="${escapeHtml(value ?? '')}" ${attrs}>`;

export function vipSettingsCardHtml(settings, status = '') {
  if (!settings) return '';
  const pricing = settings.vipPricing || {};
  const models = settings.vipModels || {};
  const hints = settings.hintPricing || {};
  const authors = settings.authorRewards || {};
  const rows = (pricing.presets || []).map((row) => `
      <tr data-preset="${escapeHtml(row.preset)}">
        <th scope="row">${escapeHtml(pair(PRESET_NAMES[row.preset], row.preset))}</th>
        <td>${num(`fast-${row.preset}`, row.fastXu, 'min="1" step="1"')}</td>
        <td>${num(`saver-${row.preset}`, row.saverXu, 'min="1" step="1"')}</td>
        <td>${num(`fastCost-${row.preset}`, row.fastCostVnd, 'min="1" step="1000"')}</td>
        <td>${num(`saverCost-${row.preset}`, row.saverCostVnd, 'min="1" step="1000"')}</td>
      </tr>`).join('');
  const select = (name, value) => `<select class="field-input" name="${name}">${MODELS.map((model) => `<option value="${model}" ${model === value ? 'selected' : ''}>${model}</option>`).join('')}</select>`;
  const overrides = Object.entries(models.stepOverrides || {}).map(([step, model]) => `${step}=${model}`).join('\n');
  const field = (label, control, help = '') => `<label class="ac-field"><span>${label}</span>${control}${help ? `<small class="aai-help">${help}</small>` : ''}</label>`;
  return `
    <section class="adm-card aai-vip-settings" aria-labelledby="aai-vip-settings-title">
      <h2 class="aai-flow-title" id="aai-vip-settings-title">${tr('Paid VIP orders, hints and authors', 'Đơn VIP trả xu, gợi ý và tác giả')}</h2>
      <p class="aai-help">${settings.vipLaneConfigured ? pill(tr('Claude API key set', 'Đã đặt khóa Claude API'), 'ok', { dot: true }) : pill(tr('No Claude API key', 'Chưa có khóa Claude API'), 'gold', { dot: true })}
        ${settings.adsEnabled ? pill(tr('Rewarded ads on', 'Quảng cáo thưởng đang bật'), 'ok', { dot: true }) : pill(tr('Ads off: level 2 costs coins only', 'Quảng cáo tắt: mức 2 chỉ trả bằng xu'), '', { dot: true })}</p>
      ${settings.vipLaneConfigured ? '' : `<p class="aai-help" data-vip-lane-closed>${tr('VIP orders are free for now: they go straight to the bridge bot like an ADMIN order. The prices below apply once the key is set.', 'Đơn VIP đang miễn phí: vào thẳng hàng chờ bot qua bridge như đơn ADMIN. Bảng giá dưới đây áp dụng khi đã đặt khóa.')}</p>`}
      <form id="ai-vip-settings-form" class="aai-vip-settings-form" novalidate>
        <h3>${tr('Price of a VIP order (coins)', 'Giá tạo vụ VIP (xu)')}</h3>
        <div class="adm-table-wrap"><table class="adm-table">
          <thead><tr><th scope="col">${tr('Preset', 'Cấu hình')}</th><th scope="col">${tr('Fast', 'Nhanh')}</th><th scope="col">${tr('Saver', 'Tiết kiệm')}</th><th scope="col">${tr('Cost, fast (VND)', 'Vốn nhanh (VND)')}</th><th scope="col">${tr('Cost, saver (VND)', 'Vốn tiết kiệm (VND)')}</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="aai-vip-grid">
          ${field(tr('Each PixelLab picture over 30 (coins)', 'Mỗi lượt PixelLab vượt 30 (xu)'), num('extraPixelLabGenerationXu', pricing.extraPixelLabGenerationXu, 'min="0"'))}
          ${field(tr('Largest PixelLab cap a VIP may buy', 'Trần PixelLab VIP được mua'), num('vipMaxPixelLabCap', pricing.vipMaxPixelLabCap, 'min="30" max="100" step="30"'))}
          ${field('USD → VND', num('usdToVnd', pricing.usdToVnd, 'min="1000"'))}
          ${field(tr('VND per coin', 'VND mỗi xu'), num('vndPerXu', pricing.vndPerXu, 'min="1"'))}
          ${field(tr('Cost cap (× estimated cost)', 'Trần chi phí (× vốn ước tính)'), num('costCapMultiplier', pricing.costCapMultiplier, 'min="1" max="10" step="0.5"'))}
          ${field(tr('Share bonus coins may pay (0–0.3)', 'Tỷ lệ xu thưởng được trả (0–0,3)'), num('maxBonusShare', pricing.maxBonusShare, 'min="0" max="0.3" step="0.05"'))}
          <label class="ac-field ac-check"><input type="checkbox" name="pixelLabEnabled" ${pricing.pixelLabEnabled ? 'checked' : ''}><span>${tr('New PixelLab pictures for VIP orders (needs the PixelLab runner)', 'PixelLab cho đơn VIP (cần trình chạy PixelLab)')}</span></label>
        </div>
        <h3>${tr('Models', 'Model')}</h3>
        <div class="aai-vip-grid">
          ${field(tr('Light work (brief, JSON repair)', 'Việc nhẹ (brief, sửa JSON)'), select('light', models.light))}
          ${field(tr('Main writer', 'Làm chính'), select('main', models.main))}
          ${field(tr('Rescue (third try)', 'Cứu lỗi (lần thử 3)'), select('rescue', models.rescue))}
          ${field(tr('Rescue from try', 'Cứu lỗi từ lần'), num('rescueFromAttempt', models.rescueFromAttempt, 'min="2" max="10"'))}
        </div>
        ${field(tr('Step overrides, one per line: StepPrefix=model', 'Đổi model theo bước, mỗi dòng: TiềnTốBước=model'),
          `<textarea class="field-input" name="stepOverrides" rows="3" placeholder="PlanScenePlacement=claude-opus-5-5">${escapeHtml(overrides)}</textarea>`)}
        <h3>${tr('Hints', 'Gợi ý')}</h3>
        <div class="aai-vip-grid">
          ${field(tr('Level 2 (coins)', 'Mức 2 (xu)'), num('level2Xu', hints.level2Xu, 'min="0"'))}
          ${field(tr('Level 3 (coins)', 'Mức 3 (xu)'), num('level3Xu', hints.level3Xu, 'min="0"'))}
          ${field(tr('Level 2 score cut (%)', 'Mức 2 trừ điểm (%)'), num('level2PenaltyPercent', hints.level2PenaltyPercent, 'min="0" max="50"'))}
          ${field(tr('Level 3 score cut (%)', 'Mức 3 trừ điểm (%)'), num('level3PenaltyPercent', hints.level3PenaltyPercent, 'min="0" max="50"'))}
          ${field(tr('One ad view is worth (VND)', 'Một lượt xem quảng cáo (VND)'), num('adRevenueVndPerView', hints.adRevenueVndPerView, 'min="0"'))}
          <label class="ac-field ac-check"><input type="checkbox" name="vipFreeLevel2" ${hints.vipFreeLevel2 ? 'checked' : ''}><span>${tr('VIP players open level 2 free', 'VIP mở mức 2 miễn phí')}</span></label>
        </div>
        <h3>${tr('Authors', 'Tác giả')}</h3>
        <div class="aai-vip-grid">
          ${field(tr('Revenue share (%)', 'Tỷ lệ chia (%)'), num('revenueSharePercent', authors.revenueSharePercent, 'min="0" max="50"'))}
          ${field(tr('Hold before paying (days)', 'Giữ trước khi trả (ngày)'), num('holdDays', authors.holdDays, 'min="0" max="60"'))}
          ${field(tr('Monthly cap per author (coins)', 'Trần mỗi tháng một tác giả (xu)'), num('monthlyCapXu', authors.monthlyCapXu, 'min="0"'))}
          ${field(tr('Silver: completions', 'Bạc: người chơi xong'), num('silverCompletions', authors.silverCompletions, 'min="1"'))}
          ${field(tr('Silver: rating (%)', 'Bạc: điểm đánh giá (%)'), num('silverMinRatingPercent', authors.silverMinRatingPercent, 'min="0" max="100"'))}
          ${field(tr('Silver bonus (coins)', 'Thưởng bạc (xu)'), num('silverBonusXu', authors.silverBonusXu, 'min="0"'))}
          ${field(tr('Gold: completions', 'Vàng: người chơi xong'), num('goldCompletions', authors.goldCompletions, 'min="1"'))}
          ${field(tr('Gold: rating (%)', 'Vàng: điểm đánh giá (%)'), num('goldMinRatingPercent', authors.goldMinRatingPercent, 'min="0" max="100"'))}
          ${field(tr('Gold bonus (coins)', 'Thưởng vàng (xu)'), num('goldBonusXu', authors.goldBonusXu, 'min="0"'))}
          ${field(tr('Account age (days)', 'Tuổi tài khoản (ngày)'), num('minAccountAgeDays', authors.minAccountAgeDays, 'min="0"'))}
          ${field(tr('Other cases played', 'Đã chơi vụ khác'), num('minOtherCasesPlayed', authors.minOtherCasesPlayed, 'min="0"'))}
          ${field(tr('Play time ratio (0–1)', 'Tỷ lệ thời gian chơi (0–1)'), num('minPlayTimeRatio', authors.minPlayTimeRatio, 'min="0" max="1" step="0.1"'))}
        </div>
        <div class="ac-dialog-actions">
          <button class="btn btn-primary" type="submit" id="ai-save-vip-settings">${tr('Save', 'Lưu')}</button>
        </div>
        <p class="aai-settings-status" id="ai-vip-settings-status" role="status">${escapeHtml(status)}</p>
      </form>
    </section>`;
}

/** Reads the settings form into the four sections the API takes (unchanged fields keep their values). */
export function readVipSettings(formNode, settings) {
  const value = (name) => formNode.elements[name]?.value;
  const number = (name, fallback) => {
    const raw = value(name);
    const parsed = Number(raw);
    return raw === undefined || raw === '' || Number.isNaN(parsed) ? fallback : parsed;
  };
  const pricing = { ...settings.vipPricing };
  pricing.presets = (pricing.presets || []).map((row) => ({
    ...row,
    fastXu: number(`fast-${row.preset}`, row.fastXu),
    saverXu: number(`saver-${row.preset}`, row.saverXu),
    fastCostVnd: number(`fastCost-${row.preset}`, row.fastCostVnd),
    saverCostVnd: number(`saverCost-${row.preset}`, row.saverCostVnd),
  }));
  for (const key of ['extraPixelLabGenerationXu', 'vipMaxPixelLabCap', 'usdToVnd', 'vndPerXu', 'costCapMultiplier', 'maxBonusShare'])
    pricing[key] = number(key, pricing[key]);
  pricing.pixelLabEnabled = Boolean(formNode.elements.pixelLabEnabled?.checked);
  const stepOverrides = {};
  for (const line of String(value('stepOverrides') || '').split('\n')) {
    const [step, model] = line.split('=').map((part) => part?.trim());
    if (step && model) stepOverrides[step] = model;
  }
  const models = { ...settings.vipModels, light: value('light'), main: value('main'), rescue: value('rescue'),
    rescueFromAttempt: number('rescueFromAttempt', settings.vipModels?.rescueFromAttempt), stepOverrides };
  const hints = { ...settings.hintPricing, vipFreeLevel2: Boolean(formNode.elements.vipFreeLevel2?.checked) };
  for (const key of ['level2Xu', 'level3Xu', 'level2PenaltyPercent', 'level3PenaltyPercent', 'adRevenueVndPerView']) hints[key] = number(key, hints[key]);
  const authors = { ...settings.authorRewards };
  for (const key of ['revenueSharePercent', 'holdDays', 'monthlyCapXu', 'silverCompletions', 'silverMinRatingPercent', 'silverBonusXu',
    'goldCompletions', 'goldMinRatingPercent', 'goldBonusXu', 'minAccountAgeDays', 'minOtherCasesPlayed', 'minPlayTimeRatio'])
    authors[key] = number(key, authors[key]);
  return { vipPricing: pricing, vipModels: models, hintPricing: hints, authorRewards: authors };
}

// ------------------------------------------------------------------ ADMIN report and authors

export async function loadVipReport() {
  const [report, authors, payouts] = await Promise.all([
    aiCaseApi.vipReport(30),
    aiCaseApi.authors().catch(() => []),
    aiCaseApi.authorPayouts().catch(() => []),
  ]);
  return { report, authors, payouts };
}

export function vipReportCardHtml(data, error) {
  if (error) return `<section class="adm-card" id="ai-vip-report"><p class="aai-field-error">${escapeHtml(error.message || '')}</p></section>`;
  if (!data) return `<section class="adm-card" id="ai-vip-report"><p>${tr('Loading the VIP report…', 'Đang tải báo cáo VIP…')}</p></section>`;
  const report = data.report || {};
  const authors = Array.isArray(data.authors) ? data.authors : [];
  const payouts = Array.isArray(data.payouts) ? data.payouts : [];
  const orders = (report.orders || []).map((order) => `
      <tr>
        <td>${escapeHtml(order.draftId.slice(-6))}</td>
        <td>${escapeHtml(pair(PRESET_NAMES[order.preset], order.preset))} · ${escapeHtml(pair(VIP_SPEEDS[order.speed], order.speed))}</td>
        <td>${escapeHtml(pair(BILLING_STATES[order.billingState], order.billingState))}</td>
        <td>${formatXu(order.priceXu)} / ${formatXu(order.chargedXu)}</td>
        <td>${(order.models || []).map((model) => `${escapeHtml(model.model.replace('claude-', ''))}: ${formatVnd(model.costVnd)} (${model.inputTokens.toLocaleString('vi-VN')}/${model.outputTokens.toLocaleString('vi-VN')} tok)`).join('<br>')}</td>
        <td>${formatVnd(order.spentVnd + order.pixelLabVnd)}</td>
        <td class="${order.profitVnd < 0 ? 'is-loss' : ''}">${formatVnd(order.profitVnd)}</td>
      </tr>`).join('') || `<tr><td colspan="7">${tr('No VIP order in 30 days.', 'Chưa có đơn VIP trong 30 ngày.')}</td></tr>`;
  const averages = (report.averages || []).map((item) => `
      <tr><td>${escapeHtml(pair(PRESET_NAMES[item.preset], item.preset))} · ${escapeHtml(pair(VIP_SPEEDS[item.speed], item.speed))}</td>
        <td>${item.orders}</td><td>${formatXu(item.avgPriceXu)} xu</td><td>${formatVnd(item.avgCostVnd)}</td><td>${formatVnd(item.avgProfitVnd)}</td></tr>`).join('')
    || `<tr><td colspan="5">${tr('No settled order yet.', 'Chưa có đơn đã tất toán.')}</td></tr>`;
  const cases = (report.cases || []).slice(0, 20).map((item) => `
      <tr><td>${escapeHtml(item.title)}</td><td>${item.paidHints} · ${formatXu(item.hintXu)} xu</td><td>${item.adViews} · ${formatVnd(item.adVnd)}</td><td>${formatXu(item.authorShareXu)} xu</td></tr>`).join('')
    || `<tr><td colspan="4">${tr('No paid hint or ad view yet.', 'Chưa có gợi ý trả phí hay lượt xem quảng cáo.')}</td></tr>`;
  const authorRows = (authors || []).map((row) => `
      <tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(pair(TIERS[row.stats.tier], row.stats.tier))}</td><td>${row.stats.publishedCases}</td>
        <td>${row.stats.bestCompletions} · ${row.stats.bestRatingPercent}%</td><td>${formatXu(row.paidXu)} / ${formatXu(row.heldXu)}</td></tr>`).join('')
    || `<tr><td colspan="5">${tr('No author yet.', 'Chưa có tác giả.')}</td></tr>`;
  const payoutRows = (payouts || []).map((payout) => `
      <tr data-payout="${escapeHtml(payout.id)}">
        <td>${escapeHtml(payout.kind === 'TIER' ? `${pair(TIERS[payout.tier], payout.tier)}` : payout.caseId)}</td>
        <td>${formatXu(payout.xu)} xu${payout.clippedXu ? ` (${tr('cap cut', 'trần cắt')} ${formatXu(payout.clippedXu)})` : ''}</td>
        <td>${escapeHtml(pair(PAYOUT_STATES[payout.state], payout.state))}</td>
        <td>${escapeHtml(formatTime(payout.availableAt))}</td>
        <td class="adm-table-actions">
          ${payout.state === 'HELD' ? `<button class="btn btn-sm btn-ghost" data-payout-action="hold">${tr('Hold', 'Tạm giữ')}</button>` : ''}
          ${payout.state === 'ON_HOLD' ? `<button class="btn btn-sm btn-ghost" data-payout-action="release">${tr('Release', 'Thả')}</button>` : ''}
          ${payout.state !== 'REVOKED' ? `<button class="btn btn-sm ac-btn-danger" data-payout-action="revoke">${tr('Revoke', 'Thu hồi')}</button>` : ''}
        </td>
      </tr>`).join('') || `<tr><td colspan="5">${tr('No payout yet.', 'Chưa có khoản thưởng.')}</td></tr>`;
  const totals = report.authors || {};
  return `
    <section class="adm-card aai-vip-report" id="ai-vip-report" aria-labelledby="aai-vip-report-title">
      <h2 class="aai-flow-title" id="aai-vip-report-title">${tr('VIP cost and revenue (30 days)', 'Chi phí và doanh thu VIP (30 ngày)')}</h2>
      <h3>${tr('VIP orders', 'Đơn VIP')}</h3>
      <div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tr('Order', 'Đơn')}</th><th>${tr('Preset · speed', 'Cấu hình · tốc độ')}</th><th>${tr('Coins', 'Xu')}</th><th>${tr('Price / taken', 'Giá / đã thu')}</th><th>${tr('Claude by model', 'Claude theo model')}</th><th>${tr('Real cost', 'Chi phí thật')}</th><th>${tr('Profit', 'Lời/lỗ')}</th></tr></thead>
        <tbody>${orders}</tbody></table></div>
      <h3>${tr('Averages by preset and speed', 'Trung bình theo cấu hình và tốc độ')}</h3>
      <div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tr('Preset · speed', 'Cấu hình · tốc độ')}</th><th>${tr('Orders', 'Số đơn')}</th><th>${tr('Price', 'Giá')}</th><th>${tr('Cost', 'Chi phí')}</th><th>${tr('Profit', 'Lời/lỗ')}</th></tr></thead>
        <tbody>${averages}</tbody></table></div>
      <h3>${tr('Hint and ad revenue by case', 'Doanh thu gợi ý và quảng cáo theo vụ')}</h3>
      <div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tr('Case', 'Vụ')}</th><th>${tr('Paid hints', 'Gợi ý trả xu')}</th><th>${tr('Ad views', 'Lượt xem quảng cáo')}</th><th>${tr('Author share', 'Chia tác giả')}</th></tr></thead>
        <tbody>${cases}</tbody></table></div>
      <p class="aai-help">${tr(`Authors: ${formatXu(totals.paidXu)} paid, ${formatXu(totals.heldXu)} held, ${formatXu(totals.revokedXu)} revoked, ${formatXu(totals.clippedXu)} cut by the monthly cap.`,
        `Tác giả: đã trả ${formatXu(totals.paidXu)} xu, đang giữ ${formatXu(totals.heldXu)} xu, thu hồi ${formatXu(totals.revokedXu)} xu, trần tháng cắt ${formatXu(totals.clippedXu)} xu.`)}</p>
      <h3>${tr('Authors', 'Tác giả')}</h3>
      <div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tr('Author', 'Tác giả')}</th><th>${tr('Badge', 'Huy hiệu')}</th><th>${tr('Published', 'Vụ đã đăng')}</th><th>${tr('Best case', 'Vụ tốt nhất')}</th><th>${tr('Paid / held', 'Đã trả / đang giữ')}</th></tr></thead>
        <tbody>${authorRows}</tbody></table></div>
      <h3>${tr('Author payouts', 'Khoản thưởng tác giả')}</h3>
      <div class="adm-table-wrap"><table class="adm-table" id="ai-author-payouts">
        <thead><tr><th>${tr('For', 'Cho')}</th><th>${tr('Coins', 'Xu')}</th><th>${tr('State', 'Trạng thái')}</th><th>${tr('Payable from', 'Trả từ')}</th><th>${tr('Actions', 'Thao tác')}</th></tr></thead>
        <tbody>${payoutRows}</tbody></table></div>
    </section>`;
}

/** Asks for a reason in the page; resolves null when cancelled. */
export function askReason(title, required, abortSignal) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ac-dialog';
    dialog.setAttribute('aria-labelledby', 'aai-reason-title');
    dialog.innerHTML = `
      <header class="ac-dialog-head"><div class="ac-dialog-heading"><h2 id="aai-reason-title">${escapeHtml(title)}</h2></div>
        <button type="button" class="ac-dialog-close" data-reason-cancel aria-label="${tr('Close', 'Đóng')}">${icon('x', 20)}</button></header>
      <form class="ac-dialog-body" novalidate>
        <label class="ac-field"><span>${tr('Reason', 'Lý do')}</span><textarea class="field-input" name="reason" rows="3" maxlength="500"></textarea></label>
        <p class="aai-field-error" role="alert" hidden>${tr('Write a reason.', 'Hãy ghi lý do.')}</p>
        <div class="ac-dialog-actions"><button type="button" class="btn btn-ghost" data-reason-cancel>${tr('Cancel', 'Hủy')}</button>
          <button type="submit" class="btn btn-primary">${tr('Confirm', 'Xác nhận')}</button></div>
      </form>`;
    document.body.append(dialog);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener('abort', cancel);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const cancel = () => finish(null);
    abortSignal?.addEventListener('abort', cancel, { once: true });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); cancel(); });
    dialog.querySelectorAll('[data-reason-cancel]').forEach((button) => button.addEventListener('click', cancel));
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const text = dialog.querySelector('textarea').value.trim();
      if (required && !text) { dialog.querySelector('[role="alert"]').hidden = false; return; }
      finish(text);
    });
    dialog.showModal();
    dialog.querySelector('textarea').focus();
  });
}
