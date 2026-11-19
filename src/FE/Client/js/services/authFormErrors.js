import { tr } from './i18n.js';
import { authErrorMessage } from './authErrorMessages.js';

// Keep API validation beside the field that needs attention on the auth card.
export function clearAuthErrors(form) {
  form.querySelectorAll('.bpa-auth-field-error').forEach((node) => node.remove());
  form.querySelectorAll('[data-auth-original-description]').forEach(clearAuthFieldError);
  form.querySelectorAll('[data-auth-form-error]').forEach((node) => node.remove());
}

export function clearAuthFieldError(input) {
  const original = input.dataset.authOriginalDescription;
  if (original === undefined) return;
  if (original) input.setAttribute('aria-describedby', original);
  else input.removeAttribute('aria-describedby');
  delete input.dataset.authOriginalDescription;
  input.removeAttribute('aria-invalid');
  document.getElementById(`${input.id}-error`)?.remove();
}

export function showAuthError(form, error) {
  clearAuthErrors(form);
  const errors = error?.errors;
  let first = null;
  if (errors && typeof errors === 'object' && !Array.isArray(errors)) {
    for (const [key, messages] of Object.entries(errors)) {
      const field = key.split('.').pop();
      const input = [...form.elements].find((element) => element.name?.toLowerCase() === field.toLowerCase());
      if (!input) continue;
      const message = Array.isArray(messages) ? messages[0] : messages;
      if (typeof message !== 'string' || !message) continue;
      input.setAttribute('aria-invalid', 'true');
      input.dataset.authOriginalDescription = input.getAttribute('aria-describedby') || '';
      const note = document.createElement('p');
      note.className = 'bpa-auth-field-error';
      note.id = `${input.id}-error`;
      note.textContent = authErrorMessage(message);
      note.setAttribute('role', 'alert');
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), note.id].filter(Boolean).join(' '));
      input.closest('.bpa-auth-field')?.append(note);
      first ??= input;
    }
  }
  if (first) { first.focus(); return; }
  const note = document.createElement('p');
  note.className = 'bpa-auth-form-error';
  note.dataset.authFormError = '';
  note.setAttribute('role', 'alert');
  note.textContent = error?.status === 429
    ? tr('Too many attempts. Please wait a moment and try again.', 'Bạn đã thử quá nhiều lần. Vui lòng đợi một chút rồi thử lại.')
    : authErrorMessage(error?.message) || tr('Please check your details and try again.', 'Vui lòng kiểm tra thông tin rồi thử lại.');
  form.prepend(note);
}

export function validateAuthForm(form) {
  const errors = {};
  for (const input of form.querySelectorAll('input[name]')) {
    const value = input.value;
    if (input.required && !value.trim()) {
      errors[input.name] = [tr('Please fill in this field.', 'Vui lòng điền thông tin này.')];
    } else if (input.type === 'email' && value && !input.validity.valid) {
      errors[input.name] = [tr('Enter a valid email address.', 'Vui lòng nhập địa chỉ email hợp lệ.')];
    } else if (input.name === 'fullName' && value.trim().length < 2) {
      errors[input.name] = [tr('Enter at least 2 characters.', 'Họ tên cần ít nhất 2 ký tự.')];
    } else if ((input.name === 'password' && form.id === 'form-register') || input.name === 'newPassword') {
      if (!/^(?=.*[A-Za-z])(?=.*\d).{6,100}$/.test(value))
        errors[input.name] = [tr('Use 6–100 characters with a letter and a number.', 'Dùng 6–100 ký tự, gồm chữ và số.')];
    }
    if (input.maxLength > 0 && value.length > input.maxLength)
      errors[input.name] = [tr('This value is too long.', 'Thông tin này quá dài.')];
  }
  if (Object.keys(errors).length) {
    showAuthError(form, { errors });
    return false;
  }
  clearAuthErrors(form);
  return true;
}
