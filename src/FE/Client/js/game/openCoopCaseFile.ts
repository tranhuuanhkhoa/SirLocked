import '../../../css/43-open-coop.css';
import { initials } from '../utils/dom.js';
import type { PrivateEvidence, PrivateTestimony, DisclosedPair } from './pairedConfrontation';

/**
 * Open co-op case file: one shared notebook with three sections —
 * 1. Sơ đồ vụ án (case board): everything either detective found, live for both;
 * 2. Dòng thời gian (timeline): place known events between fixed ones;
 * 3. Phá vỡ lời dối (Crack the Lie): either detective drafts statement + evidence, both confirm.
 */

type Translate = (en: string, vi: string) => string;
type Escape = (value: unknown) => string;

export type OpenCoopEvidence = PrivateEvidence & { foundByUserId?: string; foundByRole?: string; foundAt?: string | null };
export type OpenCoopTestimony = PrivateTestimony & { foundByUserId?: string; foundAt?: string | null; canChallenge?: boolean };

export type TimelineEvent = { eventId: string; label: string; detail: string; dayLabel: string; timeLabel: string; isFixed: boolean };
export type TimelineView = { title: string; prompt: string; placed: TimelineEvent[]; open: TimelineEvent[]; hiddenCount: number; wrongCount: number };

export type ActiveDraft = {
  attemptId: string;
  revision: number;
  status: string;
  evidence?: OpenCoopEvidence | null;
  testimony?: OpenCoopTestimony | null;
  confirmedByMe?: boolean;
  partnerConfirmed?: boolean;
  canConfirm?: boolean;
  canCancel?: boolean;
};

export type OpenCoopContext = {
  tr: Translate;
  escape: Escape;
  meId: string;
  partnerName: string;
  /** Display name for a player id (falls back to role names). */
  who: (userId: string | undefined, role?: string) => string;
  sceneTitle: (sceneId: string) => string;
  characters: Array<{ characterId: string; name: string; role?: string }>;
  newIds: Set<string>;
  openCardId: string | null;
  selectedTimelineId: string | null;
  evidencePhoto: (evidence: OpenCoopEvidence) => string;
};

export type OpenCoopFacts = Array<{ clueId: string; title: string; content: string }>;

const finderChip = (ctx: OpenCoopContext, userId?: string, role?: string) => {
  if (!userId) return '';
  const mine = userId === ctx.meId;
  return `<span class="oc-chip ${mine ? 'is-me' : 'is-partner'}">${ctx.escape(mine ? ctx.tr('You', 'Bạn') : ctx.who(userId, role))}</span>`;
};

function evidenceCard(evidence: OpenCoopEvidence, ctx: OpenCoopContext, active: ActiveDraft | null) {
  const { tr, escape } = ctx;
  const open = ctx.openCardId === evidence.clueId;
  const fresh = ctx.newIds.has(evidence.clueId);
  const inDraft = active?.evidence?.clueId === evidence.clueId;
  const photo = ctx.evidencePhoto(evidence);
  const action = active && !inDraft
    ? `<button type="button" class="oc-act" data-v3-propose-evidence="${escape(evidence.clueId)}">${tr('Use as evidence', 'Đưa chứng cứ này')}</button>`
    : '';
  return `<article class="oc-card oc-ev${fresh ? ' is-new' : ''}${inDraft ? ' is-drafted' : ''}${open ? ' is-open' : ''}" data-oc-card="${escape(evidence.clueId)}">
    <button type="button" class="oc-card-hd" data-oc-toggle="${escape(evidence.clueId)}" aria-expanded="${open}">
      <span class="oc-tile">${photo || `<span>${escape(initials(evidence.title))}</span>`}</span>
      <span class="oc-card-t"><b>${escape(evidence.title)}</b><i>${escape(ctx.sceneTitle(evidence.sceneId))}</i></span>
      ${fresh ? `<span class="oc-new">${tr('NEW', 'MỚI')}</span>` : ''}
    </button>
    <div class="oc-card-bd">
      <p>${escape(evidence.content)}</p>
      ${evidence.narrativeMeaning ? `<p class="oc-why">${escape(evidence.narrativeMeaning)}</p>` : ''}
      <p class="oc-meta">${finderChip(ctx, evidence.foundByUserId, evidence.foundByRole)}</p>
      ${action}
    </div>
  </article>`;
}

function testimonyCard(testimony: OpenCoopTestimony, ctx: OpenCoopContext, active: ActiveDraft | null, broken: DisclosedPair | undefined) {
  const { tr, escape } = ctx;
  const fresh = ctx.newIds.has(testimony.testimonyFragmentId);
  const inDraft = active?.testimony?.testimonyFragmentId === testimony.testimonyFragmentId;
  let action = '';
  if (!broken) {
    if (!active) action = `<button type="button" class="oc-act is-red" data-v3-start-testimony="${escape(testimony.testimonyFragmentId)}">${tr('Catch this lie', 'Bắt lỗi câu này')}</button>`;
    else if (!inDraft) action = `<button type="button" class="oc-act" data-v3-edit-testimony="${escape(testimony.testimonyFragmentId)}">${tr('Use this statement', 'Chọn câu này')}</button>`;
  }
  return `<li class="oc-quote${broken ? ' is-broken' : ''}${inDraft ? ' is-drafted' : ''}${fresh ? ' is-new' : ''}">
    <q>${escape(testimony.text)}</q>
    ${broken ? `<span class="oc-stamp">${tr('CRACKED', 'ĐÃ VẠCH TRẦN')}</span><p class="oc-broken-by">${tr('Broken by', 'Bị vạch trần bởi')} ${escape(broken.evidence.title)}</p>` : ''}
    <p class="oc-meta">${finderChip(ctx, testimony.foundByUserId)}${fresh ? `<span class="oc-new">${tr('NEW', 'MỚI')}</span>` : ''}</p>
    ${action}
  </li>`;
}

export function renderOpenCoopBoard(
  evidence: OpenCoopEvidence[],
  testimonies: OpenCoopTestimony[],
  facts: OpenCoopFacts,
  resolved: DisclosedPair[],
  active: ActiveDraft | null,
  ctx: OpenCoopContext,
): string {
  const { tr, escape } = ctx;
  const broken = new Map(resolved.map((pair) => [pair.testimony.testimonyFragmentId, pair]));
  const byCharacter = new Map<string, OpenCoopTestimony[]>();
  testimonies.forEach((entry) => byCharacter.set(entry.characterId, [...(byCharacter.get(entry.characterId) ?? []), entry]));
  const people = ctx.characters.map((character) => {
    const said = byCharacter.get(character.characterId) ?? [];
    return `<section class="oc-person" aria-label="${escape(character.name)}">
      <header class="oc-person-hd"><span class="oc-mono">${escape(initials(character.name))}</span><div><b>${escape(character.name)}</b><i>${escape(character.role ?? '')}</i></div></header>
      ${said.length
        ? `<ul class="oc-quotes">${said.map((entry) => testimonyCard(entry, ctx, active, broken.get(entry.testimonyFragmentId))).join('')}</ul>`
        : `<p class="oc-empty">${tr('Sherlock has not questioned them yet.', 'Sherlock chưa hỏi người này.')}</p>`}
    </section>`;
  }).join('');

  const byScene = new Map<string, OpenCoopEvidence[]>();
  evidence.forEach((entry) => byScene.set(entry.sceneId || '', [...(byScene.get(entry.sceneId || '') ?? []), entry]));
  const places = [...byScene.entries()].map(([sceneId, entries]) => `
    <section class="oc-place"><h4>${escape(ctx.sceneTitle(sceneId) || tr('Elsewhere', 'Nơi khác'))}</h4>
      <div class="oc-cards">${entries.map((entry) => evidenceCard(entry, ctx, active)).join('')}</div>
    </section>`).join('');

  const factsHtml = facts.length
    ? `<section class="oc-facts" aria-label="${tr('Conclusions', 'Kết luận')}"><h4>${tr('What we know for sure', 'Điều đã chắc chắn')}</h4>
        <ul>${facts.map((fact) => `<li class="${ctx.newIds.has(fact.clueId) ? 'is-new' : ''}"><b>${escape(fact.title)}</b><p>${escape(fact.content)}</p></li>`).join('')}</ul></section>`
    : '';

  const draftBar = active
    ? `<div class="oc-draftbar" role="status">${tr('A lie is being cracked — pick a statement and a piece of evidence, then both confirm in "Crack the Lie".',
        'Đang bắt lỗi một lời khai — chọn câu khai và chứng cứ, rồi cả hai xác nhận ở mục "Phá vỡ lời dối".')}
        <button type="button" class="oc-act" data-case-goto="contradictions">${tr('Open', 'Mở')}</button></div>`
    : '';

  return `<div class="oc-board">
    ${draftBar}
    <div class="oc-board-grid">
      <div class="oc-col oc-col-people"><h3 class="oc-col-h">${tr('People & statements', 'Người & lời khai')}</h3>${people || `<p class="oc-empty">${tr('No one yet.', 'Chưa có ai.')}</p>`}</div>
      <div class="oc-col oc-col-ev"><h3 class="oc-col-h">${tr('Evidence by place', 'Chứng cứ theo nơi tìm thấy')} <span>${evidence.length}</span></h3>
        ${places || `<p class="oc-empty">${tr('Watson has not found any evidence yet. Search the scenes and use the camera.', 'Watson chưa tìm được chứng cứ nào. Hãy lục soát hiện trường và dùng máy ảnh.')}</p>`}</div>
    </div>
    ${factsHtml}
  </div>`;
}

export function renderOpenCoopTimeline(view: TimelineView | null | undefined, ctx: OpenCoopContext): string {
  const { tr, escape } = ctx;
  if (!view) return `<p class="oc-empty">${tr('This case has no timeline.', 'Vụ án này không có dòng thời gian.')}</p>`;
  const selected = ctx.selectedTimelineId;
  const slot = (afterId: string, label: string) => `<li class="oc-tl-slot${selected ? ' is-armed' : ''}">
      <button type="button" data-oc-slot="${escape(afterId)}" ${selected ? '' : 'disabled'} aria-label="${escape(label)}"><span aria-hidden="true">+</span></button></li>`;
  const items: string[] = [slot('', tr('Place before the first event', 'Đặt trước mốc đầu tiên'))];
  let lastDay = '';
  view.placed.forEach((event) => {
    const day = event.dayLabel && event.dayLabel !== lastDay ? `<span class="oc-tl-day">${escape(event.dayLabel)}</span>` : '';
    lastDay = event.dayLabel || lastDay;
    items.push(`<li class="oc-tl-ev${event.isFixed ? ' is-fixed' : ' is-placed'}${ctx.newIds.has(event.eventId) ? ' is-new' : ''}">${day}
        <time>${escape(event.timeLabel)}</time><b>${escape(event.label)}</b>${event.detail ? `<p>${escape(event.detail)}</p>` : ''}</li>`);
    items.push(slot(event.eventId, tr(`Place after “${event.label}”`, `Đặt sau “${event.label}”`)));
  });
  const tray = view.open.length
    ? view.open.map((event) => `<button type="button" class="oc-tl-card${selected === event.eventId ? ' is-selected' : ''}" draggable="true"
        data-oc-tl-pick="${escape(event.eventId)}" aria-pressed="${selected === event.eventId}">
        ${event.dayLabel ? `<span class="oc-tl-day">${escape(event.dayLabel)}</span>` : ''}<b>${escape(event.label)}</b>${event.detail ? `<p>${escape(event.detail)}</p>` : ''}<span class="oc-tl-q">?</span></button>`).join('')
    : `<p class="oc-empty">${view.hiddenCount
      ? tr(`${view.hiddenCount} more event(s) will appear as you find clues.`, `Còn ${view.hiddenCount} mốc sẽ hiện khi các bạn tìm thêm manh mối.`)
      : tr('Every event is in place.', 'Mọi mốc đã vào đúng chỗ.')}</p>`;
  return `<div class="oc-tl">
    ${view.prompt ? `<p class="oc-tl-prompt">${escape(view.prompt)}</p>` : ''}
    <ol class="oc-tl-track" aria-label="${escape(view.title || tr('Timeline', 'Dòng thời gian'))}">${items.join('')}</ol>
    <section class="oc-tl-tray" aria-label="${tr('Events to place', 'Mốc chưa xếp')}">
      <h4>${tr('Not placed yet', 'Chưa xếp')} <span>${view.open.length}</span></h4>
      <p class="oc-tl-how">${selected
        ? tr('Now tap a “+” slot on the line (or drag the card there).', 'Giờ chạm vào một khe “+” trên trục (hoặc kéo thẻ thả vào đó).')
        : tr('Tap a card, then tap where it belongs. Wrong spots cost a little score.', 'Chạm một thẻ, rồi chạm vào chỗ nó thuộc về. Đặt sai bị trừ chút điểm.')}</p>
      <div class="oc-tl-cards">${tray}</div>
      ${view.wrongCount ? `<p class="oc-meta">${tr('Misplaced', 'Đặt sai')}: ${view.wrongCount}</p>` : ''}
    </section>
  </div>`;
}

export function renderOpenCoopCrack(
  evidence: OpenCoopEvidence[],
  testimonies: OpenCoopTestimony[],
  resolved: DisclosedPair[],
  history: DisclosedPair[],
  active: ActiveDraft | null,
  ctx: OpenCoopContext,
): string {
  const { tr, escape } = ctx;
  const brokenIds = new Set(resolved.map((pair) => pair.testimony.testimonyFragmentId));
  // Only statements that belong to a Crack the Lie can be put forward (the server says which).
  const openStatements = testimonies.filter((entry) => !brokenIds.has(entry.testimonyFragmentId) && entry.canChallenge !== false);
  let body: string;
  if (!active) {
    body = `<section class="oc-cx-pick"><h4>${tr('Pick a statement you can break', 'Chọn một lời khai có thể vạch trần')}</h4>
      ${openStatements.length
        ? `<ul class="oc-quotes">${openStatements.map((entry) => `<li class="oc-quote"><span class="oc-who">${escape(entry.characterName)}</span><q>${escape(entry.text)}</q>
            <button type="button" class="oc-act is-red" data-v3-start-testimony="${escape(entry.testimonyFragmentId)}">${tr('Catch this lie', 'Bắt lỗi câu này')}</button></li>`).join('')}</ul>`
        : `<p class="oc-empty">${tr('Sherlock needs statements first — question the people in the scenes.', 'Cần có lời khai trước — Sherlock hãy hỏi những người trong các cảnh.')}</p>`}
    </section>`;
  } else {
    const statement = active.testimony
      ? `<q>${escape(active.testimony.text)}</q><span class="oc-who">${escape(active.testimony.characterName)}</span>`
      : `<p class="oc-empty">${tr('Pick a statement below.', 'Chọn một câu khai bên dưới.')}</p>`;
    const proof = active.evidence
      ? `<b>${escape(active.evidence.title)}</b><p>${escape(active.evidence.content)}</p>`
      : `<p class="oc-empty">${tr('Pick the evidence that contradicts it.', 'Chọn chứng cứ mâu thuẫn với câu đó.')}</p>`;
    const ready = Boolean(active.testimony && active.evidence);
    const confirmState = !ready
      ? tr('Both a statement and a piece of evidence are needed.', 'Cần đủ một câu khai và một chứng cứ.')
      : active.confirmedByMe && !active.partnerConfirmed
        ? tr(`Waiting for ${ctx.partnerName} to confirm…`, `Đang chờ ${ctx.partnerName} xác nhận…`)
        : active.partnerConfirmed && !active.confirmedByMe
          ? tr(`${ctx.partnerName} agrees — confirm to present it.`, `${ctx.partnerName} đã đồng ý — xác nhận để đưa ra.`)
          : tr('Discuss it, then both confirm. A wrong pairing only costs a little score.', 'Bàn với nhau rồi cả hai xác nhận. Ghép sai chỉ bị trừ chút điểm.');
    body = `<section class="oc-cx-draft" aria-live="polite">
      <div class="oc-cx-pair">
        <div class="oc-cx-slot is-statement"><span class="oc-cx-k">${tr('STATEMENT', 'LỜI KHAI')}</span>${statement}</div>
        <span class="oc-cx-vs" aria-hidden="true">≠</span>
        <div class="oc-cx-slot is-proof"><span class="oc-cx-k">${tr('EVIDENCE', 'CHỨNG CỨ')}</span>${proof}</div>
      </div>
      <p class="oc-cx-state">${confirmState}</p>
      <div class="oc-cx-actions">
        ${active.canConfirm && ready ? `<button type="button" class="bpa-btn bpa-btn--red" data-v3-confirm>${tr('Confirm', 'Xác nhận')}</button>` : ''}
        ${active.canCancel ? `<button type="button" class="bpa-btn bpa-btn--ink" data-v3-cancel>${tr('Cancel', 'Hủy')}</button>` : ''}
      </div>
    </section>
    <div class="oc-cx-pickers">
      <section><h4>${tr('Statements', 'Câu khai')}</h4><ul class="oc-mini">${openStatements.map((entry) => `<li${active.testimony?.testimonyFragmentId === entry.testimonyFragmentId ? ' class="is-on"' : ''}>
          <button type="button" data-v3-edit-testimony="${escape(entry.testimonyFragmentId)}"><span class="oc-who">${escape(entry.characterName)}</span> ${escape(entry.text)}</button></li>`).join('')}</ul></section>
      <section><h4>${tr('Evidence', 'Chứng cứ')}</h4><ul class="oc-mini">${evidence.map((entry) => `<li${active.evidence?.clueId === entry.clueId ? ' class="is-on"' : ''}>
          <button type="button" data-v3-propose-evidence="${escape(entry.clueId)}"><b>${escape(entry.title)}</b></button></li>`).join('')}</ul></section>
    </div>`;
  }
  const past = [...resolved, ...history];
  const historyHtml = past.length
    ? `<section class="oc-cx-history"><h4>${tr('Earlier attempts', 'Các lượt trước')}</h4><ul>${past.map((pair) => `<li class="${pair.status === 'RESOLVED_SHARED_TRUTH' ? 'is-ok' : 'is-bad'}">
        <q>${escape(pair.testimony.text)}</q> ↔ <b>${escape(pair.evidence.title)}</b>
        <span>${pair.status === 'RESOLVED_SHARED_TRUTH' ? tr('CRACKED', 'ĐÃ VẠCH TRẦN') : tr('DID NOT HOLD', 'KHÔNG KHỚP')}</span></li>`).join('')}</ul></section>`
    : '';
  return `<div class="oc-cx">${body}${historyHtml}</div>`;
}
