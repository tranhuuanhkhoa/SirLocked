import { escapeHtml, initials } from '../../../utils/dom.js';
import { replaceAddress } from '../../../services/navigation.js';
import { icon, pager, pill, stateBox } from '../../../components/admin/ui.js';

/* What the player, economy and audit admin pages share: the address, tables, paging and the dialog every dangerous action goes through. */

export const num = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('vi-VN'));
export const coins = (value) => `${num(value)} xu`;

export function dateTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function playerLink(userId, name) {
  return userId ? `<a class="adp-link" href="/admin/players/${encodeURIComponent(userId)}">${escapeHtml(name || userId)}</a>` : escapeHtml(name || '—');
}

/** A person in a table: initials, the name linking to their page, and a second line (email). */
export function personLink(userId, name, sub = '') {
  const shown = name || userId || '—';
  return `
    <span class="adm-person adp-person">
      <span class="adm-avatar" aria-hidden="true">${escapeHtml(initials(shown))}</span>
      <span class="adm-person-text">
        ${userId ? `<a class="adp-person-name" href="/admin/players/${encodeURIComponent(userId)}">${escapeHtml(shown)}</a>` : `<strong>${escapeHtml(shown)}</strong>`}
        ${sub ? `<small>${escapeHtml(sub)}</small>` : ''}
      </span>
    </span>`;
}

// ---- the address: filters live in the query, and changing them does not re-run the route or its lens transition ----

export function routeParams() {
  return new URLSearchParams(window.location.search);
}

export function writeRouteParams(values) {
  const params = routeParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '' || value === 1) params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  replaceAddress(`${window.location.pathname}${text ? `?${text}` : ''}`);
}

export const pageParam = () => Math.max(1, Number(routeParams().get('page')) || 1);

/** The page size the address asks for, if it is one of `sizes`; otherwise the server's own default (null). */
export function sizeParam(sizes) {
  const size = Number(routeParams().get('size'));
  return sizes.includes(size) ? size : null;
}

/** One key per user action, made of the characters the server's idempotency rule accepts. */
export function newKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const errorMessage = (error) => error?.message || 'Có lỗi xảy ra. Hãy thử lại.';

export const alertBox = (error) => stateBox('error', errorMessage(error));

/** "Nothing to worry about" inside a card: a tick and one line. */
export const okEmpty = (text) => `<div class="adp-ok-empty">${icon('check', 18)}<span>${escapeHtml(text)}</span></div>`;

// ---- tables ----

/**
 * `columns` are { label, cell(row), className?, num? }. `num` right-aligns the column (numbers).
 * Whatever `cell` returns is markup: it must escape what it was given. A wide table scrolls inside its own frame.
 */
export function tableHtml(columns, rows, { attrs = '', minWidth = 0 } = {}) {
  const classOf = (column) => [column.className, column.num && 'adm-num'].filter(Boolean).join(' ');
  return `
    <div class="adm-table-wrap adp-table-wrap">
      <table class="adm-table admin-table adp-table" ${attrs}${minWidth ? ` style="min-width: ${Number(minWidth)}px"` : ''}>
        <thead><tr>${columns.map((column) => `<th scope="col"${classOf(column) ? ` class="${classOf(column)}"` : ''}>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((row, index) => `<tr data-row="${index}">${columns.map((column) => `
            <td data-label="${escapeHtml(column.label)}"${classOf(column) ? ` class="${classOf(column)}"` : ''}>${column.cell(row, index)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** The strip under a list: "Hiển thị 1–25 / 60 …", an optional page-size choice and the page buttons. */
export function pagerHtml(data, { noun = 'mục', sizes = null } = {}) {
  const pageSize = data?.pageSize || 1;
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  let perPageHtml = '';
  if (sizes) {
    const choices = [...new Set([...sizes, pageSize])].sort((a, b) => a - b);
    perPageHtml = `
      <label class="adp-per-page">Mỗi trang
        <select data-adp-size>${choices.map((size) => `<option value="${size}"${size === pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select>
      </label>`;
  }
  return pager({ page, pageSize, total, noun, perPageHtml });
}

/**
 * A server-paged list in `host`. `load(page, size)` asks the server, `draw(items, data)` returns the markup, `actions` maps a
 * button's data-act to what it does with its row. An answer that arrives after a newer request, or after leaving the page, is dropped.
 * `sizes` offers a page-size choice; `size` is null until someone picks one, so the server's default applies.
 */
export function pagedList(host, { load, draw, empty, emptyNote = '', emptyHtml = null, noun = 'mục', actions = {}, signal, startPage = 1, onPage, sizes = null, startSize = null, onSize }) {
  let page = startPage;
  let size = startSize;
  let items = [];
  let latest = 0;
  const options = signal ? { signal } : undefined;

  host.addEventListener('click', (event) => {
    const pagerButton = event.target.closest?.('[data-adm-page], [data-page]');
    if (pagerButton && !pagerButton.disabled) {
      refresh(Number(pagerButton.dataset.admPage ?? pagerButton.dataset.page));
      return;
    }
    const button = event.target.closest?.('[data-act]');
    if (!button || button.disabled) return;
    const row = items[Number(button.closest('[data-row]')?.dataset.row)];
    actions[button.dataset.act]?.(row, button);
  }, options);

  host.addEventListener('change', (event) => {
    const select = event.target.closest?.('[data-adp-size]');
    if (!select) return;
    size = Number(select.value);
    onSize?.(size);
    refresh(1);
  }, options);

  async function refresh(nextPage = page) {
    page = nextPage;
    const mine = ++latest;
    host.setAttribute('aria-busy', 'true');
    if (!host.firstElementChild) host.innerHTML = stateBox('loading', 'Đang tải…');
    try {
      const data = await load(page, size ?? undefined);
      if (mine !== latest || signal?.aborted) return;
      items = data?.items ?? [];
      // The last row of the last page went away: the page before it still has rows.
      if (items.length === 0 && page > 1 && (data?.total ?? 0) > 0) {
        refresh(page - 1);
        return;
      }
      host.innerHTML = items.length
        ? `${draw(items, data)}${pagerHtml(data, { noun, sizes })}`
        : (emptyHtml?.() || stateBox('empty', empty, emptyNote));
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
    // The close button comes last in the markup, so the first field still gets the focus when the dialog opens.
    dialog.innerHTML = `
      <form method="dialog" class="adp-dialog-form" novalidate>
        <h2 id="adp-dialog-title" class="adp-dialog-title">${escapeHtml(title)}</h2>
        ${message ? `<p class="adp-dialog-message">${escapeHtml(message)}</p>` : ''}
        ${notice ? `<p class="adp-dialog-notice">${escapeHtml(notice)}</p>` : ''}
        ${fields.map(fieldHtml).join('')}
        ${askReason ? `
          ${presets.length ? `<div class="adp-presets" role="group" aria-label="Lý do có sẵn">${presets.map((preset) => `<button class="btn btn-ghost btn-sm" type="button" data-preset="${escapeHtml(preset)}">${escapeHtml(preset)}</button>`).join('')}</div>` : ''}
          <div class="field">
            <label class="field-label" for="adp-field-reason">Lý do</label>
            <textarea class="field-input adp-reason" id="adp-field-reason" name="reason" rows="2" maxlength="500" placeholder="Ít nhất 3 ký tự"></textarea>
          </div>` : ''}
        <p class="field-error adp-dialog-error" role="alert"></p>
        <div class="adp-dialog-actions">
          <button class="btn btn-ghost" type="button" data-cancel>Hủy</button>
          <button class="btn ${danger ? 'adp-btn-danger' : 'btn-primary'}" type="submit" data-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
        <button class="adp-dialog-close" type="button" data-close aria-label="Đóng">${icon('x', 20)}</button>
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
    dialog.querySelectorAll('[data-cancel], [data-close]').forEach((button) => button.addEventListener('click', () => { if (!busy) cancel(); }));
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
const STATUS_TONES = { ACTIVE: 'ok', LOCKED: 'bad' };
const ROLE_TONES = { ADMIN: 'gold', VIP: 'violet' };

export function statusChip(status) {
  return pill(STATUS_LABELS[status] ?? status, STATUS_TONES[status] ?? '', { dot: true, small: true });
}

export function roleChip(role) {
  return pill(ROLE_LABELS[role] ?? role, ROLE_TONES[role] ?? '', { small: true });
}

export const PRICE_FLAGS = { HIGH: 'Giá cao bất thường', LOW: 'Giá thấp bất thường' };

export function priceFlag(flag) {
  return flag ? ` ${pill(PRICE_FLAGS[flag] ?? flag, 'bad', { small: true })}` : '';
}

export const TRADE_STATUS = {
  PENDING: 'Đang chờ', ACCEPTING: 'Đang chấp nhận', ACCEPTED: 'Đã chấp nhận', DECLINED: 'Đã từ chối',
  CANCELLED: 'Đã hủy', COUNTERED: 'Đã phản đề nghị', FAILED: 'Thất bại',
};

/** A titled white card. `flush` lets a table touch its edges; `headExtra` sits on the right of the title. */
export function sectionCard({ title, sub = '', headExtra = '', body = '', flush = true, id, attrs = '' }) {
  return `
    <section class="adm-card${flush ? ' adm-card--flush' : ''} adp-card" aria-labelledby="${id}"${attrs ? ` ${attrs}` : ''}>
      <div class="adm-card-head">
        <div class="adp-card-heading">
          <h2 class="adm-card-title" id="${id}">${escapeHtml(title)}</h2>
          ${sub ? `<p class="adm-card-sub">${escapeHtml(sub)}</p>` : ''}
        </div>
        ${headExtra}
      </div>
      ${body}
    </section>`;
}
