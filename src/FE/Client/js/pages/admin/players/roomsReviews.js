import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { actionDialog, dateTime, num, pagedList, playerLink, tableHtml } from './shared.js';

const ROOM_STATUS = { WAITING: 'Đang chờ', READY: 'Sẵn sàng', IN_PROGRESS: 'Đang chơi', ABANDONED: 'Đã đóng' };

function connection(player) {
  if (player.isConnected) return '<span class="chip chip-ok">Đang kết nối</span>';
  return `<span class="chip chip-bad">Mất kết nối</span>${player.disconnectedAt ? ` <span class="muted small">từ ${escapeHtml(dateTime(player.disconnectedAt))}</span>` : ''}`;
}

/** Rooms open or being played. Closing one ends it the way a timeout does, and tells whoever is still in it. */
export function mountRooms(host, { signal }) {
  host.innerHTML = `
    <form class="adp-filters" data-adp-rooms-filter>
      <div class="adp-filter adp-filter--wide">
        <label class="field-label" for="adp-ro-q">Mã phòng, mã vụ án hoặc tên người chơi</label>
        <input class="field-input" id="adp-ro-q" name="q" maxlength="100">
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-ro-status">Trạng thái phòng</label>
        <select class="field-input" id="adp-ro-status" name="status">
          <option value="">Đang mở hoặc đang chơi</option>
          <option value="WAITING">Đang chờ</option>
          <option value="READY">Sẵn sàng</option>
          <option value="IN_PROGRESS">Đang chơi</option>
        </select>
      </div>
      <button class="btn btn-primary adp-filter-go" type="submit">Lọc</button>
    </form>
    <div data-adp-rooms aria-live="polite"></div>`;
  let filters = {};
  const list = pagedList(host.querySelector('[data-adp-rooms]'), {
    signal,
    empty: 'Không có phòng nào đang mở hoặc đang chơi.',
    load: (page) => adminPlayersApi.rooms({ ...filters, page }),
    draw: (items) => tableHtml([
      { label: 'Phòng', cell: (row) => `<code class="adp-code">${escapeHtml(row.roomCode)}</code><br><span class="muted small">${escapeHtml(row.caseTitle)}</span>` },
      { label: 'Trạng thái', cell: (row) => `${escapeHtml(ROOM_STATUS[row.status] ?? row.status)}${row.looksHung ? ' <span class="chip chip-bad">Có vẻ treo</span>' : ''}` },
      {
        label: 'Người chơi',
        cell: (row) => row.players.map((player) => `<div class="adp-room-player">${playerLink(player.userId, player.username)} ${connection(player)}</div>`).join('') || '—',
      },
      { label: 'Thời gian', cell: (row) => `<span class="muted small">Tạo ${escapeHtml(dateTime(row.createdAt))}<br>${row.startedAt ? `Bắt đầu ${escapeHtml(dateTime(row.startedAt))}<br>` : ''}Hoạt động ${escapeHtml(dateTime(row.lastActivityAt))}</span>` },
      { label: 'Thao tác', className: 'adp-actions', cell: () => '<button class="btn btn-ghost btn-sm" type="button" data-act="close">Đóng phòng</button>' },
    ], items),
    actions: {
      close: async (row) => {
        const answer = await actionDialog({
          signal,
          danger: true,
          title: `Đóng phòng ${row.roomCode}`,
          message: row.status === 'IN_PROGRESS'
            ? 'Ván kết thúc như khi hết giờ chờ kết nối lại: bị bỏ dở, không ai nhận thưởng. Người chơi trong phòng được báo ngay.'
            : 'Phòng bị xóa. Người đang trong phòng được báo ngay.',
          confirmLabel: 'Đóng phòng',
          submit: ({ reason }) => adminPlayersApi.closeRoom(row.roomId, reason.trim()),
        });
        if (answer === null) return;
        toast('Đã đóng phòng.', 'success');
        list.refresh();
      },
    },
  });
  host.querySelector('[data-adp-rooms-filter]').addEventListener('submit', (event) => {
    event.preventDefault();
    filters = Object.fromEntries([...new FormData(event.target).entries()].map(([key, value]) => [key, String(value).trim()]));
    list.refresh(1);
  }, { signal });
  list.refresh();
}

const stars = (rating) => `<span aria-label="${num(rating)} trên 5 sao">${'★'.repeat(Math.max(0, Math.min(5, rating)))}${'☆'.repeat(Math.max(0, 5 - rating))}</span>`;

/** The newest reviews, hidden ones included. Hiding is reversible; deleting keeps a copy in the audit log. */
export function mountReviews(host, { signal }) {
  host.innerHTML = `
    <form class="adp-filters" data-adp-reviews-filter>
      <div class="adp-filter adp-filter--wide">
        <label class="field-label" for="adp-re-case">Mã vụ án</label>
        <input class="field-input" id="adp-re-case" name="caseId">
      </div>
      <div class="adp-filter">
        <label class="field-label" for="adp-re-hidden">Hiển thị</label>
        <select class="field-input" id="adp-re-hidden" name="hidden">
          <option value="">Tất cả</option>
          <option value="false">Đang hiện</option>
          <option value="true">Đang ẩn</option>
        </select>
      </div>
      <button class="btn btn-primary adp-filter-go" type="submit">Lọc</button>
    </form>
    <div data-adp-reviews aria-live="polite"></div>`;
  let filters = {};

  const act = async (dialog, call, done) => {
    const answer = await actionDialog({ signal, ...dialog, submit: ({ reason }) => call(reason.trim()) });
    if (answer === null) return;
    toast(done, 'success');
    list.refresh();
  };

  const list = pagedList(host.querySelector('[data-adp-reviews]'), {
    signal,
    empty: 'Không có đánh giá nào.',
    load: (page) => adminPlayersApi.reviews({ ...filters, page }),
    draw: (items) => tableHtml([
      { label: 'Vụ án', cell: (row) => `${escapeHtml(row.caseTitle)}<br><span class="muted small">${escapeHtml(row.caseId)}</span>` },
      { label: 'Người viết', cell: (row) => playerLink(row.userId, row.authorDisplay) },
      { label: 'Điểm', cell: (row) => stars(row.rating) },
      { label: 'Nội dung', cell: (row) => `<span class="adp-review-text">${escapeHtml(row.reviewText || '(không có lời)')}</span>${row.hidden ? `<br><span class="chip chip-bad">Đang ẩn</span> <span class="muted small">${escapeHtml(row.hiddenReason ?? '')}</span>` : ''}` },
      { label: 'Lúc', cell: (row) => escapeHtml(dateTime(row.createdAt)) },
      {
        label: 'Thao tác',
        className: 'adp-actions',
        cell: (row) => `
          ${row.hidden
    ? '<button class="btn btn-ghost btn-sm" type="button" data-act="unhide">Hiện lại</button>'
    : '<button class="btn btn-ghost btn-sm" type="button" data-act="hide">Ẩn</button>'}
          <button class="btn adp-btn-danger btn-sm" type="button" data-act="remove">Xóa</button>`,
      },
    ], items),
    actions: {
      hide: (row) => act(
        { danger: true, title: 'Ẩn đánh giá', message: 'Người chơi không còn thấy đánh giá này, và nó không tính vào điểm trung bình của vụ án. Có thể hiện lại sau.', confirmLabel: 'Ẩn đánh giá' },
        (reason) => adminPlayersApi.hideReview(row.id, reason), 'Đã ẩn đánh giá.',
      ),
      unhide: (row) => act(
        { title: 'Hiện lại đánh giá', message: 'Đánh giá trở lại danh sách và điểm trung bình của vụ án.', confirmLabel: 'Hiện lại' },
        (reason) => adminPlayersApi.unhideReview(row.id, reason), 'Đã hiện lại đánh giá.',
      ),
      remove: (row) => act(
        { danger: true, title: 'Xóa đánh giá', message: 'Đánh giá bị xóa hẳn, chỉ còn bản sao trong nhật ký admin. Người chơi có thể viết lại.', confirmLabel: 'Xóa đánh giá' },
        (reason) => adminPlayersApi.deleteReview(row.id, reason), 'Đã xóa đánh giá.',
      ),
    },
  });

  host.querySelector('[data-adp-reviews-filter]').addEventListener('submit', (event) => {
    event.preventDefault();
    filters = Object.fromEntries([...new FormData(event.target).entries()].map(([key, value]) => [key, String(value).trim()]));
    list.refresh(1);
  }, { signal });
  list.refresh();
}
