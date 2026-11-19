import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { pill } from '../../../components/admin/ui.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { actionDialog, dateTime, num, pagedList, playerLink, sectionCard, tableHtml } from './shared.js';

const ROOM_STATUS = { WAITING: 'Đang chờ', READY: 'Sẵn sàng', IN_PROGRESS: 'Đang chơi', ABANDONED: 'Đã đóng' };
const ROOM_TONE = { IN_PROGRESS: 'ok', READY: 'gold' };

function connection(player) {
  if (player.isConnected) return pill('Đang kết nối', 'ok', { dot: true, small: true });
  return `${pill('Mất kết nối', 'bad', { dot: true, small: true })}${player.disconnectedAt ? ` <span class="adp-muted">từ ${escapeHtml(dateTime(player.disconnectedAt))}</span>` : ''}`;
}

/** Rooms open or being played. Closing one ends it the way a timeout does, and tells whoever is still in it. */
export function mountRooms(host, { signal }) {
  host.innerHTML = sectionCard({
    id: 'adp-rooms-title',
    title: 'Phòng đang mở',
    sub: 'Phòng đang chờ người hoặc đang chơi. Đóng phòng treo thì người trong phòng được báo ngay.',
    body: `
      <form class="adp-filters" data-adp-rooms-filter>
        <div class="adp-filter adp-filter--grow">
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
      <div class="adp-rows" data-adp-rooms aria-live="polite"></div>`,
  });
  let filters = {};
  const list = pagedList(host.querySelector('[data-adp-rooms]'), {
    signal,
    noun: 'phòng',
    empty: 'Không có phòng nào đang mở hoặc đang chơi.',
    load: (page) => adminPlayersApi.rooms({ ...filters, page }),
    draw: (items) => tableHtml([
      { label: 'Phòng', cell: (row) => `<code class="adp-code adp-code--strong">${escapeHtml(row.roomCode)}</code><br><span class="adp-muted">${escapeHtml(row.caseTitle)}</span>` },
      {
        label: 'Trạng thái',
        cell: (row) => `<span class="adp-pills">${pill(ROOM_STATUS[row.status] ?? row.status, ROOM_TONE[row.status] ?? '', { small: true })}${row.looksHung ? pill('Có vẻ treo', 'bad', { small: true }) : ''}</span>`,
      },
      {
        label: 'Người chơi',
        cell: (row) => row.players.map((player) => `<div class="adp-room-player">${playerLink(player.userId, player.username)} ${connection(player)}</div>`).join('') || '—',
      },
      { label: 'Thời gian', cell: (row) => `<span class="adp-muted adp-times">Tạo ${escapeHtml(dateTime(row.createdAt))}<br>${row.startedAt ? `Bắt đầu ${escapeHtml(dateTime(row.startedAt))}<br>` : ''}Hoạt động ${escapeHtml(dateTime(row.lastActivityAt))}</span>` },
      { label: 'Thao tác', className: 'adp-actions', cell: () => '<button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-act="close">Đóng phòng</button>' },
    ], items, { minWidth: 940 }),
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

const stars = (rating) => `<span class="adp-stars" aria-label="${num(rating)} trên 5 sao">${'★'.repeat(Math.max(0, Math.min(5, rating)))}<span aria-hidden="true" class="adp-stars-off">${'☆'.repeat(Math.max(0, 5 - rating))}</span></span>`;

/** The newest reviews, hidden ones included. Hiding is reversible; deleting keeps a copy in the audit log. */
export function mountReviews(host, { signal }) {
  host.innerHTML = sectionCard({
    id: 'adp-reviews-title',
    title: 'Đánh giá vụ án',
    sub: 'Đánh giá mới nhất, kể cả đánh giá đang ẩn. Ẩn thì hiện lại được; xóa thì chỉ còn bản sao trong nhật ký admin.',
    body: `
      <form class="adp-filters" data-adp-reviews-filter>
        <div class="adp-filter adp-filter--grow">
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
      <div class="adp-rows" data-adp-reviews aria-live="polite"></div>`,
  });
  let filters = {};

  const act = async (dialog, call, done) => {
    const answer = await actionDialog({ signal, ...dialog, submit: ({ reason }) => call(reason.trim()) });
    if (answer === null) return;
    toast(done, 'success');
    list.refresh();
  };

  const list = pagedList(host.querySelector('[data-adp-reviews]'), {
    signal,
    noun: 'đánh giá',
    empty: 'Không có đánh giá nào.',
    load: (page) => adminPlayersApi.reviews({ ...filters, page }),
    draw: (items) => tableHtml([
      { label: 'Vụ án', cell: (row) => `<strong class="adp-strong">${escapeHtml(row.caseTitle)}</strong><br><code class="adp-code">${escapeHtml(row.caseId)}</code>` },
      { label: 'Người viết', cell: (row) => playerLink(row.userId, row.authorDisplay) },
      { label: 'Điểm', cell: (row) => stars(row.rating) },
      { label: 'Nội dung', cell: (row) => `<span class="adp-review-text">${escapeHtml(row.reviewText || '(không có lời)')}</span>${row.hidden ? `<span class="adp-review-hidden">${pill('Đang ẩn', 'bad', { small: true })} <span class="adp-muted">${escapeHtml(row.hiddenReason ?? '')}</span></span>` : ''}` },
      { label: 'Lúc', cell: (row) => `<span class="adp-date">${escapeHtml(dateTime(row.createdAt))}</span>` },
      {
        label: 'Thao tác',
        className: 'adp-actions',
        cell: (row) => `
          <span class="adm-table-actions">
            ${row.hidden
    ? '<button class="btn btn-ghost btn-sm adm-btn-ok" type="button" data-act="unhide">Hiện lại</button>'
    : '<button class="btn btn-ghost btn-sm" type="button" data-act="hide">Ẩn</button>'}
            <button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-act="remove">Xóa</button>
          </span>`,
      },
    ], items, { minWidth: 980 }),
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
