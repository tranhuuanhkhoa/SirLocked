import '../../../css/32-bpa-cases.css';
import { caseApi } from '../api/caseApi.js';
import { roomApi } from '../api/roomApi.js';
import { escapeHtml, render, placeholderStyle, initials } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { plural, tr } from '../services/i18n.js';

/* ---------------------------------------------------------------------------
   The case dossier ("bìa chi tiết"). Shared by the #/cases/<id> page and the
   open folder beside the drawer on #/cases, so both show the same file.
   --------------------------------------------------------------------------- */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** A count from the API, or null when the field is missing. */
export function countOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** "V3 · Crack" / "V2" — the same mechanics plate the workshop uses. */
export function mechanicsLabel(version) {
  if (version === 3) return 'V3 · Crack';
  if (version === 2) return 'V2';
  return '';
}

/** Two-digit file number used on folder tabs: "Nº 01". */
export function fileNumber(index) {
  return `Nº ${String(index + 1).padStart(2, '0')}`;
}

export const icons = {
  plus: (size = 13) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  eye: (size = 14) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></g></svg>`,
  back: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 12H5"/><path d="M11 18l-6-6 6-6"/></svg>',
  arrow: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
  key: () => '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L19 4"/><path d="M16 7l2.5 2.5"/><path d="M13.5 9.5l2 2"/></svg>',
  lock: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  silhouette: () => '<svg width="60" height="64" viewBox="0 0 60 64" aria-hidden="true" focusable="false"><circle cx="30" cy="23" r="12.5" fill="#3b3328"/><path d="M6 64C6 47 17 39 30 39S54 47 54 64Z" fill="#3b3328"/><text x="30" y="29" text-anchor="middle" font-family="Playfair Display, Georgia, serif" font-size="16" font-weight="700" fill="#efd486">?</text></svg>',
};

/** The cover image from the case data on its deterministic placeholder. */
export function coverArt(c, className) {
  const url = c.coverImageUrl ? `<img src="${escapeHtml(c.coverImageUrl)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="${className}" style="${placeholderStyle(c.caseId)}">${url}</span>`;
}

function statsMarkup(c) {
  const stats = [
    [countOf(c.estimatedMinutes), () => tr('min', 'phút')],
    [countOf(c.sceneCount), (n) => tr(plural(n, 'scene', 'scenes'), 'hiện trường')],
    [countOf(c.itemCount), (n) => tr(plural(n, 'item', 'items'), 'vật phẩm')],
    [countOf(c.clueCount), (n) => tr(plural(n, 'clue', 'clues'), 'manh mối')],
    [countOf(c.dialogueCount), (n) => tr(plural(n, 'question', 'questions'), 'câu hỏi')],
  ].filter(([n]) => n !== null);
  if (!stats.length) return '';
  return `
    <ul class="bpa-cases-stats" data-count="${stats.length}" aria-label="${tr('Case figures', 'Thông số vụ án')}">
      ${stats.map(([n, label]) => `<li><span class="bpa-cases-sn">${n}</span> <span class="bpa-cases-sl">${label(n)}</span></li>`).join('')}
    </ul>`;
}

/** Acts: the API only knows how many there are, so the markers carry numbers, never invented titles. */
function actsMarkup(c, h) {
  const count = countOf(c.stageCount);
  if (!count || count < 1) return '';
  const label = tr(`${count} ${plural(count, 'act', 'acts')}`, `${count} hồi`);
  const markers = count <= ROMAN.length
    ? `<ol class="bpa-cases-acts" aria-label="${label}">
        ${ROMAN.slice(0, count).map((numeral, i) => `
          <li class="bpa-cases-act" style="--i:${i}">
            <span class="bpa-cases-actpin" aria-hidden="true"></span>
            <span class="bpa-cases-actk">${tr('Act', 'Hồi')}</span>
            <span class="bpa-cases-actn">${numeral}</span>
          </li>`).join('')}
      </ol>`
    : `<p class="bpa-cases-actcount">${label}</p>`;
  return `
    <section class="bpa-cases-dsec bpa-cases-dsec--acts">
      <${h} class="bpa-cases-h3">${tr('Acts of the investigation', 'Các hồi điều tra')}</${h}>
      ${markers}
    </section>`;
}

/** People of interest: initials monograms only, never portraits. */
export function peopleMarkup(characters) {
  const list = Array.isArray(characters) ? characters : [];
  if (!list.length) return '';
  return `
    <ul class="bpa-cases-people">
      ${list.map((ch) => `
        <li class="bpa-cases-person">
          <span class="bpa-avatar bpa-cases-mono" aria-hidden="true">${escapeHtml(initials(ch.name))}</span>
          <div class="bpa-cases-pbody">
            <p class="bpa-cases-pname"><strong>${escapeHtml(ch.name)}</strong>${ch.role ? `<span class="bpa-cases-prole">${escapeHtml(ch.role)}</span>` : ''}</p>
            ${ch.description ? `<p class="bpa-cases-pdesc">${escapeHtml(ch.description)}</p>` : ''}
          </div>
        </li>`).join('')}
    </ul>`;
}

/**
 * While the dossier's people are still on their way (board view only):
 * faceless silhouettes, one per suspect, and a status line.
 */
export function sealedPeopleMarkup(count, state) {
  const n = countOf(count) ?? 0;
  const shown = Math.min(n, 5);
  const silhouettes = shown
    ? `<div class="bpa-cases-sus" aria-hidden="true">${Array.from({ length: shown }, () => `<span class="bpa-cases-su">${icons.silhouette()}</span>`).join('')}</div>`
    : '';
  const failed = state === 'error';
  const suspects = n ? tr(`${n} ${plural(n, 'suspect', 'suspects')}`, `${n} nghi phạm`) : '';
  return `
    ${silhouettes}
    <div class="bpa-cases-sealnote">
      ${suspects ? `<p class="bpa-cases-sealk">${suspects}${failed ? '' : ` · ${tr('opening files', 'đang mở hồ sơ')}`}</p>` : ''}
      <p class="bpa-cases-note">${icons.lock()}${failed
        ? tr('The people of interest could not be loaded.', 'Chưa tải được hồ sơ nhân vật.')
        : tr('Opening the people of interest…', 'Đang mở hồ sơ nhân vật…')}</p>
    </div>`;
}

/**
 * Full dossier markup.
 * opts.level     heading level of the case title (2 on its own page, 3 inside the cases board)
 * opts.titleId   id of the title (focus target)
 * opts.people    inner markup of the people block
 * opts.actions   markup of the action row
 * opts.wide      two-column layout for the standalone page
 */
export function caseDossierMarkup(c, opts) {
  const level = opts.level ?? 2;
  const h = `h${level}`;
  const sub = `h${level + 1}`;
  const mech = mechanicsLabel(c.mechanicsVersion);
  const people = opts.people ?? '';
  return `
    <div class="bpa-cases-dossier${opts.wide ? ' bpa-cases-dossier--wide' : ''}">
      <div class="bpa-cases-dcol bpa-cases-dcol--main">
        <div class="bpa-cases-dtop">
          <a class="bpa-cases-back" href="#/cases" data-dossier-back>${icons.back()}${tr('All cases', 'Tất cả vụ án')}</a>
          <span class="bpa-cases-stampbox" aria-hidden="true"><span class="bpa-cases-stamp">${tr('Published', 'Đã xuất bản')}</span></span>
        </div>
        <p class="bpa-kicker bpa-cases-kick">${tr('Co-op case · 2 detectives', 'Vụ án hợp tác · 2 thám tử')}</p>
        <${h} id="${opts.titleId}" class="bpa-cases-dtitle" tabindex="-1">${escapeHtml(c.title)}</${h}>
        ${mech ? `<div class="bpa-cases-dmeta"><span class="bpa-chip bpa-chip--dark">${mech}</span></div>` : ''}
        ${c.summary ? `<p class="bpa-cases-dsum">${escapeHtml(c.summary)}</p>` : ''}
        ${statsMarkup(c)}
        ${actsMarkup(c, sub)}
      </div>
      <div class="bpa-cases-dcol bpa-cases-dcol--side">
        <figure class="bpa-cases-photo">
          <span class="bpa-cases-tape" aria-hidden="true"></span>
          <span class="bpa-cases-tape bpa-cases-tape--r" aria-hidden="true"></span>
          ${coverArt(c, 'bpa-cases-photo-img')}
        </figure>
        <section class="bpa-cases-dsec bpa-cases-dsec--people"${people ? '' : ' hidden'} data-dossier-people>
          <${sub} class="bpa-cases-h3">${tr('People of interest', 'Nhân vật liên quan')}</${sub}>
          <div class="bpa-cases-pslot">${people}</div>
        </section>
      </div>
      <div class="bpa-cases-dacts"><div class="bpa-cases-dacts-in">${opts.actions ?? ''}</div></div>
    </div>`;
}

export async function renderCaseDetailPage(app, caseId) {
  render(app, `
    <div class="bpa-container bpa-cases-page bpa-cases-page--detail">
      <p class="bpa-cases-loading" role="status"><span class="bpa-cases-spinner bpa-spin" aria-hidden="true"></span>${tr('Loading case…', 'Đang tải vụ án…')}</p>
    </div>`);

  let detail;
  try {
    detail = await caseApi.detail(decodeURIComponent(caseId));
  } catch (err) {
    render(app, `
      <div class="bpa-container bpa-cases-page bpa-cases-page--detail">
        <div class="bpa-paper bpa-paper--note bpa-cases-notice" role="alert">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <p class="bpa-kicker">${tr('Case file unavailable', 'Không mở được hồ sơ')}</p>
          <p class="bpa-cases-notice-text">${escapeHtml(err.message)}</p>
          <a class="bpa-link" href="#/cases">${icons.back()}${tr('All cases', 'Tất cả vụ án')}</a>
        </div>
      </div>`);
    return;
  }

  const characters = Array.isArray(detail.characters) ? detail.characters : [];

  render(app, `
  <div class="bpa-container bpa-cases-page bpa-cases-page--detail">
    <section class="bpa-cases-cover bpa-cases-cover--wide" aria-labelledby="bpa-cases-detail-title">
      <span class="bpa-cases-dtab" aria-hidden="true"><span class="bpa-cases-tabdot"></span>${tr('Case file', 'Hồ sơ vụ án')}</span>
      <span class="bpa-cases-under" aria-hidden="true"></span>
      <div class="bpa-cases-sheet bpa-paper">
        <span class="bpa-cases-margin" aria-hidden="true"></span>
        <div class="bpa-cases-dc bpa-cases-st0">
          ${caseDossierMarkup(detail, {
            level: 2,
            titleId: 'bpa-cases-detail-title',
            wide: true,
            people: peopleMarkup(characters),
            actions: `
              <button type="button" class="bpa-btn bpa-btn--red" id="create-room">${icons.plus(15)}${tr('Create room', 'Tạo phòng')}</button>
              <a class="bpa-btn bpa-btn--ink" href="#/join">${icons.key()}${tr('Join with code', 'Vào bằng mã phòng')}</a>`,
          })}
        </div>
      </div>
    </section>
  </div>`);

  const createButton = app.querySelector('#create-room');
  createButton.addEventListener('click', async () => {
    createButton.disabled = true;
    try {
      const room = await roomApi.create(detail.caseId);
      toast(tr(`Room ${room.roomCode} created.`, `Đã tạo phòng ${room.roomCode}.`), 'success');
      window.location.hash = `#/lobby/${room.roomId}`;
    } catch (err) {
      toast(err.message, 'error');
      createButton.disabled = false;
    }
  });
}
