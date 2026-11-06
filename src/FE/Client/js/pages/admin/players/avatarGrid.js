import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { icon, pill } from '../../../components/admin/ui.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { AVATAR_REASONS, actionDialog, dateTime, pageParam, pagedList, routeParams, writeRouteParams } from './shared.js';

/** The newest uploaded pictures. Deleting takes one click on a ready reason; approving takes the picture off the waiting list. */
export function mountAvatarGrid(host, { signal, onChange }) {
  let pendingOnly = routeParams().get('all') !== 'true';

  host.innerHTML = `
    <section class="adm-card adm-card--flush adp-avatars-card" aria-labelledby="adp-avatars-title">
      <div class="adm-card-head">
        <div class="adp-card-heading">
          <h2 class="adm-card-title" id="adp-avatars-title">Ảnh đại diện người chơi tải lên</h2>
          <p class="adm-card-sub">Duyệt để giữ ảnh, hoặc xóa để người chơi về lại ảnh mẫu mặc định.</p>
        </div>
        <label class="adp-check">
          <input type="checkbox" data-adp-pending${pendingOnly ? ' checked' : ''}> Chỉ ảnh chờ duyệt
        </label>
      </div>
      <div class="adp-rows" data-adp-avatars aria-live="polite"></div>
    </section>`;

  const grid = host.querySelector('[data-adp-avatars]');
  const emptyHtml = () => (pendingOnly
    ? `<div class="adp-avatars-empty">
         <span class="adp-avatars-empty-icon">${icon('check', 26)}</span>
         <strong>Không có ảnh nào đang chờ duyệt.</strong>
         <span>Ảnh đại diện người chơi tải lên sẽ hiện ở đây để duyệt hoặc xóa.</span>
       </div>`
    : null);

  const list = pagedList(grid, {
    signal,
    startPage: pageParam(),
    noun: 'ảnh',
    empty: 'Chưa có ảnh nào được tải lên.',
    load: (page) => adminPlayersApi.avatars({ pending: pendingOnly ? 'true' : 'false', page }),
    // Nothing waiting is good news, said the way the design says it.
    emptyHtml,
    onPage: (page) => writeRouteParams({ page }),
    draw: (items) => `
      <ul class="adp-avatar-grid">
        ${items.map((item, index) => `
          <li class="adp-avatar-card" data-adp-avatar data-row="${index}">
            <img src="${escapeHtml(item.avatarUrl)}" alt="Ảnh đại diện của ${escapeHtml(item.fullName)}" width="160" height="160" loading="lazy" referrerpolicy="no-referrer">
            <div class="adp-avatar-who">
              <span class="adm-person-text">
                <a class="adp-person-name" href="/admin/players/${encodeURIComponent(item.userId)}">${escapeHtml(item.fullName)}</a>
                <small>${escapeHtml(dateTime(item.uploadedAt))}</small>
              </span>
            </div>
            ${item.approved ? `<span class="adp-avatar-state">${pill('Đã duyệt', 'ok', { dot: true, small: true })}</span>` : ''}
            <div class="adp-avatar-actions">
              ${item.approved ? '' : '<button class="btn btn-ghost btn-sm adm-btn-ok" type="button" data-act="approve">Duyệt</button>'}
              <button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-act="remove">Xóa ảnh</button>
            </div>
          </li>`).join('')}
      </ul>`,
    actions: {
      approve: async (item, button) => {
        button.disabled = true;
        try {
          await adminPlayersApi.approveAvatar(item.userId);
          toast('Đã duyệt ảnh.', 'success');
          list.refresh();
          onChange?.();
        } catch (error) {
          button.disabled = false;
          toast(error.message, 'error');
        }
      },
      remove: async (item) => {
        const answer = await actionDialog({
          signal,
          danger: true,
          title: `Xóa ảnh của ${item.fullName}`,
          message: 'Người chơi về lại ảnh mẫu mặc định, file trên Cloudinary bị xóa.',
          presets: AVATAR_REASONS,
          confirmLabel: 'Xóa ảnh',
          submit: ({ reason }) => adminPlayersApi.removeAvatar(item.userId, reason.trim()),
        });
        if (answer === null) return;
        toast(answer.fileRemoved ? 'Đã xóa ảnh.' : 'Đã xóa ảnh khỏi hồ sơ, nhưng chưa xóa được file trên Cloudinary.', answer.fileRemoved ? 'success' : 'info');
        list.refresh();
        onChange?.();
      },
    },
  });

  host.querySelector('[data-adp-pending]').addEventListener('change', (event) => {
    pendingOnly = event.target.checked;
    writeRouteParams({ all: pendingOnly ? '' : 'true', page: 1 });
    list.refresh(1);
  }, { signal });

  list.refresh();
}
