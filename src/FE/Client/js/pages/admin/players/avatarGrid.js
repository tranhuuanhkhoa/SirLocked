import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { escapeHtml } from '../../../utils/dom.js';
import { toast } from '../../../utils/toast.js';
import { AVATAR_REASONS, actionDialog, dateTime, hashParams, pageParam, pagedList, playerLink, writeHashParams } from './shared.js';

/** The newest uploaded pictures. Deleting takes one click on a ready reason; approving takes the picture off the waiting list. */
export function mountAvatarGrid(host, { signal }) {
  let pendingOnly = hashParams().get('all') !== 'true';

  host.innerHTML = `
    <label class="adp-check">
      <input type="checkbox" data-adp-pending${pendingOnly ? ' checked' : ''}> Chỉ ảnh chờ duyệt
    </label>
    <div data-adp-avatars aria-live="polite"></div>`;

  const grid = host.querySelector('[data-adp-avatars]');
  const list = pagedList(grid, {
    signal,
    startPage: pageParam(),
    empty: 'Không có ảnh nào đang chờ duyệt.',
    load: (page) => adminPlayersApi.avatars({ pending: pendingOnly ? 'true' : 'false', page }),
    onPage: (page) => writeHashParams({ page }),
    draw: (items) => `
      <ul class="adp-avatar-grid">
        ${items.map((item, index) => `
          <li class="adp-avatar-card" data-adp-avatar data-row="${index}">
            <img src="${escapeHtml(item.avatarUrl)}" alt="Ảnh đại diện của ${escapeHtml(item.fullName)}" width="160" height="160" loading="lazy" referrerpolicy="no-referrer">
            <div class="adp-avatar-who">${playerLink(item.userId, item.fullName)}
              <span class="muted small">${escapeHtml(dateTime(item.uploadedAt))}${item.approved ? ' · Đã duyệt' : ''}</span>
            </div>
            <div class="adp-avatar-actions">
              ${item.approved ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-act="approve">Duyệt</button>'}
              <button class="btn adp-btn-danger btn-sm" type="button" data-act="remove">Xóa ảnh</button>
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
      },
    },
  });

  host.querySelector('[data-adp-pending]').addEventListener('change', (event) => {
    pendingOnly = event.target.checked;
    writeHashParams({ all: pendingOnly ? '' : 'true', page: 1 });
    list.refresh(1);
  }, { signal });

  list.refresh();
}
