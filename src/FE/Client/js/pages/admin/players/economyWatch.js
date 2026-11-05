import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { defName } from '../../market/marketKit.js';
import { PRICE_FLAGS, actionDialog, alertBox, coins, dateTime, num, playerLink, tableHtml } from './shared.js';

/** Flags only. Nothing here acts on them, on purpose: what a flag means is for an admin to judge. */
export function mountAnomalies(host, { signal }) {
  host.innerHTML = '<p class="muted">Đang tìm…</p>';
  (async () => {
    let data;
    try {
      data = await adminPlayersApi.anomalies();
    } catch (error) {
      if (signal?.aborted) return;
      host.innerHTML = alertBox(error);
      host.dataset.adpLoaded = 'true';
      return;
    }
    if (signal?.aborted) return;
    const prices = data?.prices ?? [];
    const funnels = data?.funnels ?? [];
    const pairs = data?.repeatedPairs ?? [];
    const none = (text) => `<div class="empty-state small">${escapeHtml(text)}</div>`;
    host.innerHTML = `
      <p class="muted small">Xét tin rao đang mở và giao dịch trong 7 ngày gần đây. Đây chỉ là đánh dấu để bạn xem xét, hệ thống không tự xử lý.</p>
      ${data?.truncated ? '<p class="notice">Dữ liệu quá nhiều nên chỉ xét phần mới nhất, danh sách có thể chưa đủ.</p>' : ''}

      <h3 class="section-title">Giá bất thường</h3>
      <p class="muted small">Từ 10 lần giá tham chiếu trở lên, hoặc thấp hơn 10% giá tham chiếu.</p>
      ${prices.length ? tableHtml([
    { label: 'Loại', cell: (row) => (row.kind === 'SALE' ? 'Đã bán' : 'Đang rao') },
    { label: 'Vật phẩm', cell: (row) => escapeHtml(defName(row.def)) },
    { label: 'Giá', cell: (row) => `${coins(row.price)}<br><span class="muted small">Tham chiếu ${num(row.referencePrice)}</span>` },
    { label: 'Cảnh báo', cell: (row) => `<span class="chip chip-bad">${escapeHtml(PRICE_FLAGS[row.flag] ?? row.flag)}</span>` },
    { label: 'Người bán', cell: (row) => playerLink(row.userId, row.userName) },
    { label: 'Lúc', cell: (row) => escapeHtml(dateTime(row.at)) },
  ], prices) : none('Không có giá nào bất thường.')}

      <h3 class="section-title">Nhận nhiều từ tài khoản mới</h3>
      <p class="muted small">Tổng từ 500 xu hoặc 3 vật phẩm qua trao đổi, từ tài khoản tạo chưa quá 24 giờ.</p>
      ${funnels.length ? tableHtml([
    { label: 'Người nhận', cell: (row) => playerLink(row.receiverId, row.receiverName) },
    { label: 'Đã nhận', cell: (row) => `${coins(row.coins)}, ${num(row.items)} vật phẩm` },
    { label: 'Từ tài khoản mới', cell: (row) => row.giverIds.map((id, index) => playerLink(id, row.giverNames[index])).join(', ') },
    { label: 'Số đề nghị', cell: (row) => num(row.tradeIds.length) },
  ], funnels) : none('Không có trường hợp nào.')}

      <h3 class="section-title">Trao đổi qua lại nhiều lần</h3>
      <p class="muted small">Cùng 2 tài khoản, từ 5 lần trở lên trong 7 ngày.</p>
      ${pairs.length ? tableHtml([
    { label: 'Tài khoản 1', cell: (row) => playerLink(row.firstId, row.firstName) },
    { label: 'Tài khoản 2', cell: (row) => playerLink(row.secondId, row.secondName) },
    { label: 'Số lần', cell: (row) => num(row.trades) },
    { label: 'Gần nhất', cell: (row) => escapeHtml(dateTime(row.lastAt)) },
  ], pairs) : none('Không có trường hợp nào.')}`;
    host.dataset.adpLoaded = 'true';
  })();
}

const STUCK_KINDS = {
  LISTING: 'Tin rao', ORDER: 'Lệnh mua', TRADE: 'Đề nghị trao đổi', TRANSACTION: 'Giao dịch chợ',
  CHEST_OPENING: 'Lượt mở hòm', CHEST_PURCHASE: 'Lượt mua hòm, chìa', XP_EXCHANGE: 'Lượt đổi KN', ADMIN_OPERATION: 'Thao tác admin',
};

function age(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${num(minutes)} phút`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${num(hours)} giờ` : `${num(Math.floor(hours / 24))} ngày`;
}

/** Operations left halfway for over five minutes, and the one button that runs the recovery the server already has. */
export function mountStuck(host, { signal }) {
  host.innerHTML = `
    <div class="adp-section-head">
      <p class="muted small">Đang ở trạng thái trung gian quá 5 phút. Máy chủ tự thử khôi phục mỗi 30 giây; thứ còn ở đây là thứ đã thử mà chưa xong.</p>
      <button class="btn btn-primary" type="button" data-adp-recover>Chạy khôi phục</button>
    </div>
    <div data-adp-stuck aria-live="polite"><p class="muted">Đang tải…</p></div>`;
  const body = host.querySelector('[data-adp-stuck]');

  const load = async () => {
    try {
      const data = await adminPlayersApi.stuck();
      if (signal?.aborted) return;
      const items = data?.items ?? [];
      body.innerHTML = items.length
        ? `${data.truncated ? '<p class="notice">Mỗi loại chỉ hiện 100 mục cũ nhất.</p>' : ''}${tableHtml([
          { label: 'Loại', cell: (row) => escapeHtml(STUCK_KINDS[row.kind] ?? row.kind) },
          { label: 'Mã', cell: (row) => `<span class="adp-break">${escapeHtml(row.id)}</span>` },
          { label: 'Trạng thái', cell: (row) => `<code class="adp-code">${escapeHtml(row.state)}</code>` },
          { label: 'Người chơi', cell: (row) => (row.userId ? playerLink(row.userId) : '—') },
          { label: 'Chi tiết', cell: (row) => escapeHtml(row.detail ?? '—') },
          { label: 'Đã kẹt', cell: (row) => escapeHtml(age(row.ageSeconds)) },
        ], items)}`
        : '<div class="empty-state">Không có giao dịch nào bị kẹt.</div>';
    } catch (error) {
      if (!signal?.aborted) body.innerHTML = alertBox(error);
    }
    host.dataset.adpLoaded = 'true';
  };

  host.querySelector('[data-adp-recover]').addEventListener('click', async () => {
    const report = await actionDialog({
      signal,
      title: 'Chạy khôi phục',
      message: 'Chạy đúng một lượt logic khôi phục có sẵn của máy chủ: giao dịch trước điểm cam kết được hoàn lại, sau điểm cam kết được làm nốt.',
      confirmLabel: 'Chạy khôi phục',
      submit: ({ reason }) => adminPlayersApi.recover(reason.trim()),
    });
    if (report === null) return;
    toast(`Đã xử lý ${num(report.resumed)} mục, còn kẹt ${num(report.stillStuck)}.`, report.stillStuck ? 'info' : 'success');
    load();
  }, { signal });

  load();
}
