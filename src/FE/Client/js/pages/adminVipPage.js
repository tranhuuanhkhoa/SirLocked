import { aiCaseApi } from '../api/aiCaseApi.js';
import { pageHead, stateBox } from '../components/admin/ui.js';
import { tr } from '../services/i18n.js';
import { escapeHtml, render } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { askReason, loadVipReport, readVipSettings, vipReportCardHtml, vipSettingsCardHtml } from './adminAiVip.js';

const errorText = (error) => error?.message || tr('Something went wrong. Try again.', 'Có lỗi xảy ra. Hãy thử lại.');

/**
 * /admin/vip, ADMIN only: what an admin sets up for VIP orders, kept off /admin/ai, the order page VIPs use.
 * The weekly order limit, VIP prices, paid hints and author rewards, then the cost and revenue report with the payouts.
 */
export async function renderAdminVipPage(app, { signal } = {}) {
  render(app, `<div class="page aai-page avp-page">${stateBox('loading', tr('Loading VIP settings…', 'Đang tải cài đặt VIP…'))}</div>`);

  let settings = null;
  let settingsError = null;
  let report = null;
  let reportError = null;
  let limitStatus = '';
  let limitFailed = false;
  let savingLimit = false;
  let vipStatus = '';

  async function loadSettings() {
    try {
      settings = await aiCaseApi.settings();
      settingsError = null;
    } catch (error) {
      settingsError = error;
    }
  }

  async function loadReport() {
    try {
      report = await loadVipReport();
      reportError = null;
    } catch (error) {
      reportError = error;
    }
  }

  await Promise.all([loadSettings(), loadReport()]);
  if (signal?.aborted) return;

  /** How many orders each VIP may send per week (GET/PUT /api/admin/ai-cases/settings). */
  function limitCardHtml() {
    const value = settings?.vipWeeklyOrderLimit ?? '';
    return `
      <section class="adm-card aai-settings" aria-labelledby="aai-settings-title">
        <h2 class="aai-flow-title" id="aai-settings-title">${tr('VIP orders each week', 'Số đơn VIP mỗi tuần')}</h2>
        <form class="aai-settings-form" id="ai-settings-form" novalidate>
          <label class="aai-label" for="ai-vip-weekly-limit">${tr('Orders per VIP each week', 'Số đơn mỗi VIP được gửi mỗi tuần')}</label>
          <div class="aai-settings-row">
            <input class="field-input" id="ai-vip-weekly-limit" name="vipWeeklyOrderLimit" type="number" inputmode="numeric" min="0" max="50" step="1" value="${escapeHtml(value)}" aria-describedby="ai-settings-help ai-settings-status" ${settings ? '' : 'disabled'}>
            <button class="btn btn-primary btn-sm" type="submit" id="ai-save-settings" ${settings && !savingLimit ? '' : 'disabled'}>${savingLimit ? tr('Saving…', 'Đang lưu…') : tr('Save', 'Lưu')}</button>
          </div>
          <p class="aai-help" id="ai-settings-help">${tr('0 pauses VIP orders. A week runs Monday to Sunday, Vietnam time; rejected orders do not count.', '0 là tạm dừng nhận đơn VIP. Tuần tính từ thứ Hai đến Chủ nhật (giờ Việt Nam); đơn bị từ chối không tính.')}</p>
          <p class="aai-settings-status${limitFailed ? ' is-error' : ''}" id="ai-settings-status" role="status">${escapeHtml(limitStatus)}</p>
        </form>
      </section>`;
  }

  function draw() {
    render(app, `
      <div class="page aai-page avp-page">
        ${pageHead({
    title: tr('VIP', 'VIP'),
    sub: tr('VIP orders, prices, paid hints and author rewards, and what VIP orders cost and earn. Only admins see this page.', 'Đơn VIP, giá, gợi ý trả phí và thưởng tác giả, cùng chi phí và doanh thu của đơn VIP. Chỉ admin thấy trang này.'),
  })}
        ${settingsError ? stateBox('error', tr('Could not read the VIP settings', 'Không đọc được cài đặt VIP'), errorText(settingsError)) : ''}
        <div class="avp-cards">
          ${limitCardHtml()}
          ${vipSettingsCardHtml(settings, vipStatus)}
          ${vipReportCardHtml(report, reportError)}
        </div>
      </div>`);
  }

  async function saveLimit() {
    const input = app.querySelector('#ai-vip-weekly-limit');
    if (!input || savingLimit) return;
    const raw = input.value.trim();
    const value = Number(raw);
    if (raw === '' || !Number.isInteger(value) || value < 0 || value > 50) {
      // Only the status changes: what was typed stays, to be corrected.
      const status = app.querySelector('#ai-settings-status');
      status.textContent = tr('The weekly limit must be a whole number from 0 to 50.', 'Giới hạn mỗi tuần phải là số nguyên từ 0 đến 50.');
      status.classList.add('is-error');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    savingLimit = true;
    draw();
    try {
      settings = await aiCaseApi.saveSettings(value);
      limitStatus = tr(`Saved: each VIP may send ${settings.vipWeeklyOrderLimit} orders a week.`, `Đã lưu: mỗi VIP được gửi ${settings.vipWeeklyOrderLimit} đơn mỗi tuần.`);
      limitFailed = false;
    } catch (error) {
      limitStatus = errorText(error);
      limitFailed = true;
    }
    savingLimit = false;
    if (signal?.aborted) return;
    draw();
    app.querySelector('#ai-vip-weekly-limit')?.focus();
  }

  async function saveVipSettings(formNode) {
    const button = app.querySelector('#ai-save-vip-settings');
    if (!settings || button?.disabled) return;
    button.disabled = true;
    try {
      settings = await aiCaseApi.saveVipSettings(readVipSettings(formNode, settings));
      vipStatus = tr('Saved.', 'Đã lưu.');
    } catch (error) {
      vipStatus = errorText(error);
    }
    if (!signal?.aborted) draw();
  }

  async function payoutAction(button) {
    const id = button.closest('[data-payout]')?.dataset.payout;
    const action = button.dataset.payoutAction;
    let reason = '';
    if (action !== 'release') {
      reason = await askReason(action === 'revoke' ? tr('Revoke this payout', 'Thu hồi khoản thưởng') : tr('Hold this payout', 'Tạm giữ khoản thưởng'),
        action === 'revoke', signal);
      if (reason === null) return;
    }
    button.disabled = true;
    try {
      if (action === 'hold') await aiCaseApi.holdPayout(id, reason);
      else if (action === 'release') await aiCaseApi.releasePayout(id);
      else await aiCaseApi.revokePayout(id, reason);
      toast(tr('Saved.', 'Đã lưu.'), 'success');
    } catch (error) {
      toast(errorText(error), 'error');
    }
    await loadReport();
    if (!signal?.aborted) draw();
  }

  const listen = signal ? { signal } : undefined;
  app.addEventListener('submit', (event) => {
    if (event.target.id === 'ai-settings-form') {
      event.preventDefault();
      void saveLimit();
    } else if (event.target.id === 'ai-vip-settings-form') {
      event.preventDefault();
      void saveVipSettings(event.target);
    }
  }, listen);
  app.addEventListener('click', (event) => {
    const button = event.target.closest('#ai-author-payouts [data-payout-action]');
    if (button) void payoutAction(button);
  }, listen);

  draw();
}
