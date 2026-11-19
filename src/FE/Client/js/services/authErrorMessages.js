import { tr } from './i18n.js';

// Authentication API messages are stable, but older responses mix English and
// Vietnamese. Present every known message in the language selected by the user.
// Every pair is [English, Vietnamese].
const messages = [
  ['This email is already registered.', 'Email này đã được đăng ký.'],
  ['This email is already registered. Sign in or use a different email.', 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.'],
  ['Please check the information you entered.', 'Vui lòng kiểm tra thông tin đã nhập.'],
  ['Full name must be between 2 and 80 characters.', 'Họ và tên phải có từ 2 đến 80 ký tự.'],
  ['Enter a valid email address.', 'Vui lòng nhập địa chỉ email hợp lệ.'],
  ['Password must be 6–100 characters with at least one letter and one number.', 'Mật khẩu phải có 6–100 ký tự, gồm ít nhất một chữ cái và một chữ số.'],
  ['Enter your password.', 'Vui lòng nhập mật khẩu.'],
  ['Invalid password.', 'Mật khẩu không hợp lệ.'],
  ['Enter your current password.', 'Vui lòng nhập mật khẩu hiện tại.'],
  ['Invalid current password.', 'Mật khẩu hiện tại không hợp lệ.'],
  ['New password must differ from the current password.', 'Mật khẩu mới phải khác mật khẩu hiện tại.'],
  ['Invalid password reset link.', 'Liên kết đặt lại mật khẩu không hợp lệ.'],
  ['Invalid verification code.', 'Mã xác thực không hợp lệ.'],
  ['Invalid email or password.', 'Email hoặc mật khẩu không đúng.'],
  ['This account is locked or deleted.', 'Tài khoản đã bị khóa hoặc xóa.'],
  ['Invalid or expired reset token.', 'Mã đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'],
  ['Invalid or expired verification token.', 'Mã xác minh không hợp lệ hoặc đã hết hạn.'],
  ['Email is already verified.', 'Email đã được xác minh.'],
  ['Current password is incorrect.', 'Mật khẩu hiện tại không đúng.'],
  ['New password must be different from current password.', 'Mật khẩu mới phải khác mật khẩu hiện tại.'],
  ['This account uses Google sign-in and does not have a local password.', 'Tài khoản này đăng nhập bằng Google và không có mật khẩu riêng.'],
  ['Verification email delivery failed.', 'Không gửi được email xác minh. Vui lòng thử lại sau.'],
  ['Password reset email delivery failed.', 'Không gửi được email đặt lại mật khẩu. Vui lòng thử lại sau.'],
];

const translations = new Map(messages.flatMap(([en, vi]) => [
  [vi, { en, vi }], [en, { en, vi }],
]));

export function authErrorMessage(message) {
  if (!message) return '';
  const pair = translations.get(message.trim());
  return pair ? tr(pair.en, pair.vi) : message;
}
