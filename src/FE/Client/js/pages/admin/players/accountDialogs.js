import { adminPlayersApi } from '../../../api/adminPlayersApi.js';
import { actionDialog } from './shared.js';

/*
 * The account itself, from /admin/players: create, edit name and email, set a new password, delete (soft) and restore.
 * The same rules as signing up are checked here first, and again on the server. Each dialog resolves with the server's
 * answer (the account), or null when the admin cancels.
 */

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{6,100}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nameError = (value) => {
  const length = String(value ?? '').trim().length;
  return length >= 2 && length <= 80 ? null : 'Họ và tên phải có từ 2 đến 80 ký tự.';
};
const emailError = (value) => {
  const email = String(value ?? '').trim();
  return email.length <= 160 && EMAIL_RULE.test(email) ? null : 'Hãy nhập một địa chỉ email hợp lệ.';
};
const passwordError = (value) => (PASSWORD_RULE.test(String(value ?? '')) ? null : 'Mật khẩu phải có 6–100 ký tự, gồm ít nhất một chữ cái và một chữ số.');

/** A password the admin can pass on as it is: letters and digits, never confusable ones (0/O, 1/l/I). */
export function suggestPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set, count) => {
    const values = crypto.getRandomValues(new Uint32Array(count));
    return Array.from(values, (value) => set[value % set.length]).join('');
  };
  return `${pick(letters, 6)}${pick(digits, 4)}`;
}

const passwordField = () => ({
  name: 'newPassword',
  label: 'Mật khẩu',
  type: 'text',
  autocomplete: 'off',
  value: suggestPassword(),
  hint: 'Đã điền sẵn một mật khẩu ngẫu nhiên, bạn đổi được. Gửi nó cho người chơi; họ tự đổi lại ở trang Hồ sơ.',
  validate: passwordError,
});

export function createAccountDialog({ signal } = {}) {
  return actionDialog({
    signal,
    title: 'Tạo tài khoản',
    message: 'Tài khoản dùng được ngay: email coi như đã xác minh, người chơi đăng nhập bằng email và mật khẩu này.',
    fields: [
      { name: 'fullName', label: 'Họ và tên', autocomplete: 'off', validate: nameError },
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'off', validate: emailError },
      passwordField(),
      {
        name: 'role',
        label: 'Vai trò',
        type: 'select',
        value: 'PLAYER',
        options: [{ value: 'PLAYER', label: 'Người chơi' }, { value: 'VIP', label: 'VIP' }],
      },
    ],
    confirmLabel: 'Tạo tài khoản',
    submit: ({ fullName, email, newPassword, role, reason }) => adminPlayersApi.createAccount({
      fullName: fullName.trim(), email: email.trim(), newPassword, role, reason: reason.trim(),
    }),
  });
}

export function editAccountDialog(account, { signal } = {}) {
  return actionDialog({
    signal,
    title: `Sửa thông tin ${account.fullName}`,
    message: 'Đổi email thì người chơi đăng nhập bằng email mới; liên kết đặt lại mật khẩu đã gửi tới email cũ hết hiệu lực.',
    fields: [
      { name: 'fullName', label: 'Họ và tên', autocomplete: 'off', value: account.fullName, validate: nameError },
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'off', value: account.email, validate: emailError },
    ],
    confirmLabel: 'Lưu thay đổi',
    submit: ({ fullName, email, reason }) => adminPlayersApi.updateAccount(account.userId, {
      fullName: fullName.trim(), email: email.trim(), reason: reason.trim(),
    }),
  });
}

export function passwordDialog(account, { signal } = {}) {
  return actionDialog({
    signal,
    danger: true,
    title: `Đặt mật khẩu mới cho ${account.fullName}`,
    message: 'Mật khẩu cũ hết dùng được, người chơi bị đăng xuất khỏi mọi thiết bị.',
    fields: [passwordField()],
    confirmLabel: 'Đặt mật khẩu mới',
    submit: ({ newPassword, reason }) => adminPlayersApi.setPassword(account.userId, { newPassword, reason: reason.trim() }),
  });
}

export function deleteAccountDialog(account, { signal } = {}) {
  return actionDialog({
    signal,
    danger: true,
    title: `Xóa tài khoản ${account.fullName}`,
    message: 'Người chơi bị đăng xuất ngay và không đăng nhập được nữa. Tài khoản ẩn khỏi danh sách (xem ở bộ lọc "Đã xóa"). Xu, vật phẩm và lịch sử vẫn giữ, nên khôi phục lại được.',
    confirmLabel: 'Xóa tài khoản',
    submit: ({ reason }) => adminPlayersApi.deleteAccount(account.userId, reason.trim()),
  });
}

export function restoreAccountDialog(account, { signal } = {}) {
  return actionDialog({
    signal,
    title: `Khôi phục ${account.fullName}`,
    message: 'Tài khoản hoạt động lại như trước khi xóa; người chơi đăng nhập bằng mật khẩu cũ.',
    confirmLabel: 'Khôi phục',
    submit: ({ reason }) => adminPlayersApi.restoreAccount(account.userId, reason.trim()),
  });
}
