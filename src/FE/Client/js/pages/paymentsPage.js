import '../../../css/49-payments.css';
import QRCode from 'qrcode';
import { paymentsApi } from '../api/paymentsApi.js';
import { marketApi, newRequestId } from '../api/marketApi.js';
import { publishWallet } from '../components/walletChip.js';
import { escapeHtml, render } from '../utils/dom.js';
import { navigate } from '../services/navigation.js';
import { session } from '../services/session.js';
import { tr } from '../services/i18n.js';

const number = (value) => Number(value).toLocaleString('vi-VN');
const money = (value) => `${number(value)} ₫`;
const terminal = new Set(['CREDITED', 'CANCELLED', 'EXPIRED', 'REVIEW']);
const labels = {
  CREATING: ['Preparing payment', 'Đang tạo thanh toán'],
  PENDING: ['Awaiting transfer', 'Chờ chuyển khoản'],
  PAID: ['Payment received · adding coins', 'Đã nhận tiền · đang cộng xu'],
  CREDITED: ['Coins added', 'Đã cộng xu'],
  CANCELLED: ['Cancelled', 'Đã hủy'], EXPIRED: ['Expired', 'Đã hết hạn'],
  REVIEW: ['Payment needs review', 'Giao dịch cần đối soát'],
};
const statusText = (status) => tr(...(labels[status] || ['Processing', 'Đang xử lý']));

function checkoutUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'pay.payos.vn' || url.hostname.endsWith('.payos.vn')) ? url.href : '';
  } catch { return ''; }
}

/** Hash routing, shared auth client and lifecycle match the existing market/chest pages. */
export async function renderPaymentsPage(app, code, { signal } = {}) {
  let disposed = false;
  let timer;
  let busy = false;
  const userId = session.user()?.userId;
  const active = () => !disposed && !signal?.aborted && app.isConnected && session.user()?.userId === userId;
  const storageKey = `sirlocked.topup-request:${userId}`;
  const cleanup = () => { disposed = true; clearTimeout(timer); };
  signal?.addEventListener('abort', cleanup, { once: true });
  render(app, `<div class="bpa-container sl-pay-page">
    <a class="sl-pay-back" href="/market">← ${tr('Market', 'Chợ đồ')}</a>
    <p class="bpa-kicker">${tr('DETECTIVE WALLET', 'VÍ THÁM TỬ')}</p>
    <h1>${tr('Top up coins', 'Nạp xu')}</h1>
    <p class="sl-pay-lede">${tr('Transfer with your banking app. Coins arrive after payment is confirmed.', 'Chuyển khoản bằng ứng dụng ngân hàng. Xu được cộng sau khi thanh toán được xác nhận.')}</p>
    <p class="sl-pay-error" role="alert" hidden></p>
    <section data-payment-content aria-live="polite">${tr('Loading…', 'Đang tải…')}</section>
  </div>`);
  const content = app.querySelector('[data-payment-content]');
  const errorBox = app.querySelector('[role="alert"]');
  const showError = (error) => {
    if (!active()) return;
    errorBox.textContent = error?.message || tr('Please try again.', 'Vui lòng thử lại.');
    errorBox.hidden = false;
  };
  const clearError = () => { errorBox.hidden = true; };
  let lastOrder;
  let lastMarkup = '';

  async function paintOrder(order) {
    if (!active()) return;
    lastOrder = order;
    if (order.status !== 'CREATING') {
      try {
        const pending = JSON.parse(sessionStorage.getItem(storageKey));
        if (String(pending?.orderCode) === String(order.orderCode)) sessionStorage.removeItem(storageKey);
      } catch { /* no pending request */ }
    }
    const href = checkoutUrl(order.checkoutUrl);
    const payable = order.status === 'PENDING' && new Date(order.expiresAt).getTime() > Date.now();
    const markup = `<article class="sl-pay-card">
      <div class="sl-pay-card-head"><h2>${tr('Transfer details', 'Thông tin chuyển khoản')}</h2><span class="sl-pay-status" data-status="${escapeHtml(order.status)}">${escapeHtml(statusText(order.status))}</span></div>
      <p class="sl-pay-total">${money(order.amount)} <span>→ ${number(order.coins)} xu</span></p>
      <p class="sl-pay-order-id">${tr('Order', 'Mã đơn')}: ${escapeHtml(String(order.orderCode))}</p>
      ${payable ? `<div class="sl-pay-transfer">
        <div class="sl-pay-qr">${order.qrCode ? '<canvas data-qr aria-label="QR chuyển khoản"></canvas>' : `<p>${tr('Open payOS to view the transfer QR.', 'Mở payOS để xem mã QR chuyển khoản.')}</p>`}</div>
        <div><dl>
          ${order.accountName ? `<dt>${tr('Account holder', 'Chủ tài khoản')}</dt><dd>${escapeHtml(order.accountName)}</dd>` : ''}
          ${order.accountNumber ? `<dt>${tr('Account number', 'Số tài khoản')}</dt><dd>${escapeHtml(order.accountNumber)} <button class="sl-pay-copy" data-copy="accountNumber">${tr('Copy', 'Sao chép')}</button></dd>` : ''}
          ${order.bankBin ? `<dt>${tr('Bank BIN', 'Mã ngân hàng (BIN)')}</dt><dd>${escapeHtml(order.bankBin)}</dd>` : ''}
          <dt>${tr('Transfer memo', 'Nội dung chuyển khoản')}</dt><dd>${escapeHtml(order.description)} <button class="sl-pay-copy" data-copy="description">${tr('Copy', 'Sao chép')}</button></dd>
          <dt>${tr('Expires', 'Hết hạn')}</dt><dd>${escapeHtml(new Date(order.expiresAt).toLocaleString('vi-VN'))}</dd>
        </dl><p>${tr('Keep the amount and transfer memo exactly as shown.', 'Giữ nguyên số tiền và nội dung chuyển khoản.')}</p>
        ${href ? `<a class="sl-pay-button" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${tr('Open payOS checkout', 'Mở trang thanh toán payOS')} ↗</a>` : ''}</div></div>` : ''}
      ${order.status === 'CREDITED' ? `<p class="sl-pay-success">${tr('Your wallet has received', 'Ví của anh đã nhận')} <strong>${number(order.coins)} xu</strong>.</p>` : ''}
      ${order.status === 'CREATING' ? `<p>${tr('The payment request is being checked. Return to the package page to retry the same request if needed.', 'Hệ thống đang kiểm tra yêu cầu tạo đơn. Nếu cần, quay lại trang gói nạp để thử lại cùng yêu cầu.')}</p>` : ''}
      ${order.status === 'REVIEW' ? `<p>${tr('Keep this order code and contact the administrator for reconciliation.', 'Giữ mã đơn và liên hệ quản trị viên để đối soát giao dịch.')}</p>` : ''}
      ${order.status === 'PENDING' && !payable ? `<p>${tr('The transfer window has ended. Checking the final status.', 'Đã hết thời gian chuyển khoản. Đang kiểm tra trạng thái cuối cùng.')}</p>` : ''}
      <div class="sl-pay-actions"><button class="sl-pay-button sl-pay-secondary" data-refresh>${tr('Check status', 'Kiểm tra trạng thái')}</button>
      ${payable ? `<button class="sl-pay-button sl-pay-secondary" data-cancel>${tr('Cancel order', 'Hủy đơn')}</button>` : ''}
      <a href="/payments">${tr('Packages & history', 'Gói nạp & lịch sử')}</a></div>
    </article>`;
    // Preserve keyboard focus and avoid repainting the QR on every poll.
    if (markup !== lastMarkup) {
      lastMarkup = markup;
      content.innerHTML = markup;
      const canvas = content.querySelector('[data-qr]');
      if (canvas) await QRCode.toCanvas(canvas, order.qrCode, { width: 256, margin: 2, errorCorrectionLevel: 'M' });
    }
    if (order.status === 'CREDITED') {
      const wallet = await marketApi.wallet();
      if (active()) publishWallet(wallet);
    }
  }

  async function refresh() {
    if (!active() || busy) return;
    busy = true;
    clearTimeout(timer);
    try { await paintOrder(await paymentsApi.order(code)); clearError(); }
    catch (error) { showError(error); }
    finally {
      busy = false;
      if (active() && !terminal.has(lastOrder?.status)) timer = setTimeout(refresh, 5000);
    }
  }

  app.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target || !active() || busy) return;
    if (target.hasAttribute('data-refresh')) { await refresh(); return; }
    if (target.dataset.copy) {
      try { await navigator.clipboard.writeText(lastOrder[target.dataset.copy]); target.textContent = tr('Copied', 'Đã sao chép'); }
      catch { showError({ message: tr('Please select and copy the value manually.', 'Anh hãy chọn và sao chép thông tin trực tiếp.') }); }
      return;
    }
    if (target.hasAttribute('data-cancel')) {
      busy = true; target.disabled = true;
      try { await paintOrder(await paymentsApi.cancel(code)); clearError(); }
      catch (error) { showError(error); }
      finally { busy = false; if (active()) { target.disabled = false; await refresh(); } }
      return;
    }
    if (target.dataset.package) {
      busy = true;
      app.querySelectorAll('[data-package]').forEach(button => { button.disabled = true; });
      try {
        let pending;
        try { pending = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* new request */ }
        if (pending && pending.packageId !== target.dataset.package)
          throw new Error(tr('Retry your previous package first to resolve the pending request.', 'Hãy thử lại gói trước để xác định kết quả yêu cầu đang chờ.'));
        pending ||= { packageId: target.dataset.package, requestId: newRequestId() };
        sessionStorage.setItem(storageKey, JSON.stringify(pending));
        const order = await paymentsApi.create(pending.packageId, pending.requestId);
        if (!active()) return;
        sessionStorage.setItem(storageKey, JSON.stringify({ ...pending, orderCode: order.orderCode }));
        if (order.status !== 'CREATING') sessionStorage.removeItem(storageKey);
        navigate(`/payments/${order.orderCode}`);
      } catch (error) { showError(error); }
      finally {
        busy = false;
        if (active()) app.querySelectorAll('[data-package]').forEach(button => { button.disabled = false; });
      }
    }
  });

  try {
    if (code) await refresh();
    else {
      const [catalog, history, wallet] = await Promise.all([paymentsApi.packages(), paymentsApi.history(), marketApi.wallet()]);
      if (!active()) return cleanup;
      publishWallet(wallet);
      // Clear an interrupted request only after its persisted order has been resolved.
      let pending;
      try { pending = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* empty */ }
      if (pending?.orderCode && history.some(order => String(order.orderCode) === String(pending.orderCode) && order.status !== 'CREATING')) {
        sessionStorage.removeItem(storageKey);
        pending = null;
      }
      content.innerHTML = `<p class="sl-pay-balance">${tr('Current balance', 'Số dư hiện tại')}: <strong>${number(wallet.balance)} xu</strong></p>
        ${!catalog.enabled ? `<p class="sl-pay-notice" role="status">${tr('Top-ups are not available yet. Please check back later.', 'Nạp xu hiện chưa được mở. Anh vui lòng quay lại sau.')}</p>` : ''}
        ${pending ? `<p class="sl-pay-notice">${tr('A previous request is waiting. Select the same package to retry safely.', 'Có yêu cầu trước đang chờ. Chọn lại cùng gói để tiếp tục an toàn.')}</p>` : ''}
        <div class="sl-pay-packages">${catalog.packages.map(pack => `<article class="sl-pay-card">
          <h2>${number(pack.coins)} xu</h2><p class="sl-pay-price">${money(pack.amount)}</p>
          <button class="sl-pay-button" data-package="${escapeHtml(pack.id)}" ${!catalog.enabled || pending && pending.packageId !== pack.id ? 'disabled' : ''}>${tr('Top up', 'Nạp')} ${number(pack.coins)} xu</button>
        </article>`).join('')}</div>
        <section class="sl-pay-card"><h2>${tr('Recent top-ups', 'Lịch sử nạp gần đây')}</h2>
        ${history.length ? `<div class="sl-pay-history">${history.map(order => `<a href="/payments/${order.orderCode}" class="sl-pay-history-row">
          <span><strong>${money(order.amount)}</strong> · ${number(order.coins)} xu<br><small>${escapeHtml(new Date(order.createdAt).toLocaleString('vi-VN'))}</small></span>
          <span>${escapeHtml(statusText(order.status))} →</span></a>`).join('')}</div>` : `<p>${tr('No top-ups yet.', 'Anh chưa có giao dịch nạp xu.')}</p>`}</section>`;
    }
  } catch (error) { showError(error); if (active()) content.textContent = tr('Unable to load payment details. Reload to retry.', 'Chưa tải được thông tin thanh toán. Anh tải lại trang để thử lại.'); }
  return cleanup;
}
