import { escapeHtml } from './dom.js';

/** Small toast/notice system; every important unlock also lands in the action log server-side. */
export function toast(message, type = 'info', duration = 4200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = escapeHtml(message);
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 350);
  }, duration);
}
