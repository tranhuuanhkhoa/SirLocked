import { escapeHtml } from '../../../utils/dom.js';

/* What the player, economy and audit admin pages share: the address, tables, paging and the dialog every dangerous action goes through. */

export const num = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('vi-VN'));
export const coins = (value) => `${num(value)} xu`;

export function dateTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function playerLink(userId, name) {
  return userId ? `<a class="adp-link" href="#/admin/players/${encodeURIComponent(userId)}">${escapeHtml(name || userId)}</a>` : escapeHtml(name || '—');
}

// ---- the address: filters live in the hash, and changing them does not re-run the route or its lens transition ----

export function hashParams() {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1));
}

export function writeHashParams(values) {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  const base = at < 0 ? hash : hash.slice(0, at);
  const params = hashParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '' || value === 1) params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  window.history.replaceState(window.history.state, '', `${base}${text ? `?${text}` : ''}`);
}

export const pageParam = () => Math.max(1, Number(hashParams().get('page')) || 1);

/** One key per user action, made of the characters the server's idempotency rule accepts. */
export function newKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const errorMessage = (error) => error?.message || 'Có lỗi xảy ra. Hãy thử lại.';

export const alertBox = (error) => `<div class="empty-state" role="alert">${escapeHtml(errorMessage(error))}</div>`;

// ---- tables ----

/**
 * `columns` are { label, cell(row), className? }. Each cell carries its label so that on a phone a row becomes a card.
 * Whatever `cell` returns is markup: it must escape what it was given.
 */
export function tableHtml(columns, rows, { attrs = '' } = {}) {
  return `
    <div class="adp-table-wrap">
      <table class="admin-table adp-table" ${attrs}>
        <thead><tr>${columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((row, index) => `<tr data-row="${index}">${columns.map((column) => `
            <td data-label="${escapeHtml(column.label)}"${column.className ? ` class="${column.className}"` : ''}>${column.cell(row, index)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

export function pagerHtml(data) {
  const pageSize = data?.pageSize || 1;
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const last = Math.max(1, Math.ceil(total / pageSize));
  return `
    <nav class="adp-pager" aria-label="Phân trang">
      <button class="btn btn-ghost btn-sm" type="button" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>Trang trước</button>
      <span class="muted small">Trang ${num(page)}/${num(last)} · ${num(total)} mục</span>
      <button class="btn btn-ghost btn-sm" type="button" data-page="${page + 1}"${page >= last ? ' disabled' : ''}>Trang sau</button>
    </nav>`;
}

/**
 * A server-paged list in `host`. `load(page)` asks the server, `draw(items, data)` returns the markup, `actions` maps a
 * button's data-act to what it does with its row. An answer that arrives after a newer request, or after leaving the page, is dropped.
 */
export function pagedList(host, { load, draw, empty, actions = {}, signal, startPage = 1, onPage }) {
  let page = startPage;
  let items = [];
  let latest = 0;

  host.addEventListener('click', (event) => {
    const pager = event.target.closest?.('[data-page]');
    if (pager && !pager.disabled) {
      refresh(Number(pager.dataset.page));
      return;
    }
    const button = event.target.closest?.('[data-act]');
    if (!button || button.disabled) return;
    const row = items[Number(button.closest('[data-row]')?.dataset.row)];
    actions[button.dataset.act]?.(row, button);
  }, signal ? { signal } : undefined);

  async function refresh(nextPage = page) {
    page = nextPage;
    const mine = ++latest;
    host.setAttribute('aria-busy', 'true');
    try {
      const data = await load(page);
      if (mine !== latest || signal?.aborted) return;
      items = data?.items ?? [];
      // The last row of the last page went away: the page before it still has rows.
      if (items.length === 0 && page > 1 && (data?.total ?? 0) > 0) {
        refresh(page - 1);
        return;
      }
      host.innerHTML = items.length
        ? `${draw(items, data)}${pagerHtml(data)}`
        : `<div class="empty-state">${escapeHtml(empty)}</div>`;
      onPage?.(page);
    } catch (error) {
      if (mine !== latest || signal?.aborted) return;
      host.innerHTML = alertBox(error);
    }
    host.removeAttribute('aria-busy');
    host.dataset.adpLoaded = 'true';
  }
  return { refresh };
}

// ---- tabs ----

export function tabsHtml(tabs, active, label) {
  return `
    <div class="adp-tabs" role="tablist" aria-label="${escapeHtml(label)}">
      ${tabs.map((tab) => `<button class="adp-tab${tab.id === active ? ' is-active' : ''}" type="button" role="tab" data-tab="${tab.id}" aria-selected="${tab.id === active}">${escapeHtml(tab.label)}</button>`).join('')}
    </div>`;
}

// ---- the dialog ----

/** Reasons offered for a picture, one click each. */
export const AVATAR_REASONS = ['Ảnh phản cảm', 'Ảnh khiêu dâm', 'Bạo lực, máu me', 'Giả mạo người khác', 'Quảng cáo, spam'];

function fieldHtml(field) {
  const id = `adp-field-${field.name}`;
  const label = `<label class="field-label" for="${id}">${escapeHtml(field.label)}</label>`;
  const hint = field.hint ? `<span class="field-hint">${escapeHtml(field.hint)}</span>` : '';
  if (field.type === 'select') {
    return `<div class="field">${label}
      <select class="field-input" id="${id}" name="${field.name}">
        ${(field.options ?? []).map((option) => `<option value="${escapeHtml(option.value)}"${option.value === field.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
      </select>${hint}</div>`;
  }
  return `<div class="field">${label}
    <input class="field-input" id="${id}" name="${field.name}" type="${field.type ?? 'text'}" inputmode="${field.type === 'number' ? 'numeric' : 'text'}"
      value="${escapeHtml(field.value ?? '')}"${field.min !== undefined ? ` min="${field.min}"` : ''}${field.max !== undefined ? ` max="${field.max}"` : ''}>${hint}</div>`;
}

/**
 * The one way a dangerous action happens: says what will happen, asks for a reason, stays open until the server has
 * answered and shows its refusal. Resolves with the server's answer, or null when cancelled.
 *
 * `submit(values, key)` gets one idempotency key per attempt at this action. The key survives a lost connection or a
 * server error, because the first try may have gone through, and is renewed after a clear refusal, because the journal
 * stores that refusal for good and would only repeat it.
 */
export function actionDialog({ title, message, notice, fields = [], askReason = true, presets = [], confirmLabel = 'Xác nhận', danger = false, submit, signal }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'adp-dialog';
    dialog.setAttribute('aria-labelledby', 'adp-dialog-title');
    dialog.innerHTML = `
      <form method="dialog" class="adp-dialog-form" novalidate>
        <h3 id="adp-dialog-title" class="adp-dialog-title">${escapeHtml(title)}</h3>
        ${message ? `<p class="adp-dialog-message">${escapeHtml(message)}</p>` : ''}
        ${notice ? `<p class="adp-dialog-notice">${escapeHtml(notice)}</p>` : ''}
        ${fields.map(fieldHtml).join('')}
        ${askReason ? `
          ${presets.length ? `<div class="adp-presets">${presets.map((preset) => `<button class="btn btn-ghost btn-sm" type="button" data-preset="${escapeHtml(preset)}">${escapeHtml(preset)}</button>`).join('')}</div>` : ''}
          <div class="field">
            <label class="field-label" for="adp-field-reason">Lý do</label>
            <textarea class="field-input adp-reason" id="adp-field-reason" name="reason" rows="2" maxlength="500"></textarea>
          </div>` : ''}
        <p class="field-error adp-dialog-error" role="alert"></p>
        <div class="adp-dialog-actions">
          <button class="btn btn-ghost" type="button" data-cancel>Hủy</button>
          <button class="btn ${danger ? 'adp-btn-danger' : 'btn-primary'}" type="submit" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`;
    document.body.append(dialog);

    const form = dialog.querySelector('form');
    const error = dialog.querySelector('.adp-dialog-error');
    const confirm = dialog.querySelector('[data-confirm]');
    let key = newKey();
    let busy = false;
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    const cancel = () => finish(null);
    signal?.addEventListener('abort', cancel, { once: true });

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!busy) cancel();
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => { if (!busy) cancel(); });
    dialog.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => {
      form.elements.reason.value = button.dataset.preset;
    }));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const values = Object.fromEntries(new FormData(form).entries());
      if (askReason && String(values.reason ?? '').trim().length < 3) {
        error.textContent = 'Hãy nhập lý do, ít nhất 3 ký tự.';
        form.elements.reason.focus();
        return;
      }
      const invalid = fields.find((field) => field.validate?.(values[field.name], values));
      if (invalid) {
        error.textContent = invalid.validate(values[invalid.name], values);
        form.elements[invalid.name]?.focus();
        return;
      }
      busy = true;
      confirm.disabled = true;
      error.textContent = '';
      try {
        finish(await submit(values, key));
      } catch (failure) {
        if (settled) return;
        error.textContent = errorMessage(failure);
        if (failure?.status >= 400 && failure?.status < 500) key = newKey();
      }
      busy = false;
      confirm.disabled = false;
    });

    dialog.showModal();
    if (signal?.aborted) cancel();
  });
}

export const STATUS_LABELS = { ACTIVE: 'Đang hoạt động', LOCKED: 'Bị khóa', DELETED: 'Đã xóa' };
export const ROLE_LABELS = { PLAYER: 'Người chơi', VIP: 'VIP', ADMIN: 'Quản trị' };

export function statusChip(status) {
  return `<span class="chip ${status === 'ACTIVE' ? 'chip-ok' : 'chip-bad'}">${escapeHtml(STATUS_LABELS[status] ?? status)}</span>`;
}

export function roleChip(role) {
  return `<span class="chip ${role === 'ADMIN' || role === 'VIP' ? 'chip-gold' : ''}">${escapeHtml(ROLE_LABELS[role] ?? role)}</span>`;
}

export const PRICE_FLAGS = { HIGH: 'Giá cao bất thường', LOW: 'Giá thấp bất thường' };

export function priceFlag(flag) {
  return flag ? ` <span class="chip chip-bad">${escapeHtml(PRICE_FLAGS[flag] ?? flag)}</span>` : '';
}

export const TRADE_STATUS = {
  PENDING: 'Đang chờ', ACCEPTING: 'Đang chấp nhận', ACCEPTED: 'Đã chấp nhận', DECLINED: 'Đã từ chối',
  CANCELLED: 'Đã hủy', COUNTERED: 'Đã phản đề nghị', FAILED: 'Thất bại',
};
