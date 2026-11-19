import { initials } from '../utils/dom.js';
import { bpaIcons, bpaMono } from './pairedConfrontation.js';

export type AccusationProposalStatus = 'AwaitingConfirmation' | 'Resolved' | 'Cancelled';

export type AccusationEvidenceLink = {
  claimType: string;
  /** Null when the server withheld a clue the viewer has not earned; see `isUndisclosed`. */
  evidenceId?: string | null;
  isUndisclosed?: boolean;
};

export type AccusationProposal = {
  attemptId: string;
  status: AccusationProposalStatus;
  revision: number;
  proposedByUserId: string;
  proposedByRole: string;
  culpritId: string;
  motiveId?: string | null;
  methodId?: string | null;
  evidenceIds: string[];
  evidenceLinks: AccusationEvidenceLink[];
  confirmedUserIds: string[];
  updatedAt: string;
};

export type AccusationSummaryRow = {
  label: string;
  value: string;
  /** Lets the proposal sheet group rows; rows without a kind render as plain lines. */
  kind?: 'suspect' | 'motive' | 'method' | 'claim' | 'evidence';
  /** Suspect role, shown under the name. */
  detail?: string;
  undisclosed?: boolean;
};

/** A detective as the confirmation boxes show them: initials only, never a portrait. */
export type AccusationPerson = {
  name: string;
  initials: string;
  role: string;
};

export type AccusationConsensusModel = {
  proposal: AccusationProposal;
  rows: AccusationSummaryRow[];
  proposerName: string;
  partnerName: string;
  proposedByMe: boolean;
  confirmedByMe: boolean;
  partnerConfirmed: boolean;
  /** The proposal moved past the revision this client last looked at. */
  needsReReview: boolean;
  me?: AccusationPerson;
  partner?: AccusationPerson;
  proposerInitials?: string;
  /** Both detectives confirmed and the server filed the accusation; shown briefly before the result. */
  filed: boolean;
  resultHref?: string;
  caseTitle?: string;
  sceneTitle?: string;
  meta?: string[];
  /** Same revision and confirmations as the sheet already on screen: no entrance motion. */
  renderKey?: string;
  settled?: boolean;
};

type BuildInput = {
  proposal: AccusationProposal;
  localUserId: string;
  rows: AccusationSummaryRow[];
  proposerName: string;
  partnerName: string;
  /** `attemptId:revision` of the last revision this client acknowledged, if any. */
  acknowledgedKey: string | null;
  me?: AccusationPerson;
  partner?: AccusationPerson;
  proposerInitials?: string;
  filed?: boolean;
  resultHref?: string;
  caseTitle?: string;
  sceneTitle?: string;
  meta?: string[];
  renderKey?: string;
  settled?: boolean;
};

type Escape = (value: string) => string;
type Translate = (english: string, vietnamese: string) => string;

export function accusationRevisionKey(proposal: AccusationProposal): string {
  return `${proposal.attemptId}:${proposal.revision}`;
}

export function buildAccusationConsensusModel(input: BuildInput): AccusationConsensusModel {
  const { proposal, localUserId } = input;
  const confirmedUserIds = proposal.confirmedUserIds ?? [];
  const confirmedByMe = Boolean(input.filed) || confirmedUserIds.includes(localUserId);
  return {
    proposal,
    rows: input.rows,
    proposerName: input.proposerName,
    partnerName: input.partnerName,
    proposedByMe: proposal.proposedByUserId === localUserId,
    confirmedByMe,
    partnerConfirmed: Boolean(input.filed) || confirmedUserIds.some((userId) => userId !== localUserId),
    // The revision is read from server state; the client never guesses that a proposal changed.
    needsReReview: !confirmedByMe && input.acknowledgedKey !== accusationRevisionKey(proposal),
    me: input.me,
    partner: input.partner,
    proposerInitials: input.proposerInitials,
    filed: Boolean(input.filed),
    resultHref: input.resultHref,
    caseTitle: input.caseTitle,
    sceneTitle: input.sceneTitle,
    meta: input.meta,
    renderKey: input.renderKey,
    settled: Boolean(input.settled),
  };
}

/* --------------------------------------------------------------------------
   Shared pieces of the accusation sheet (Accuse.html), used by the draft
   wizard in gamePage and by the consensus panel below.
   -------------------------------------------------------------------------- */

export type AccusationPhase = 'draft' | 'review' | 'filed';

export function renderAccusationHeader(options: {
  escape: Escape;
  tr: Translate;
  phase: AccusationPhase;
  caseTitle?: string;
  sceneTitle?: string;
  closable: boolean;
}): string {
  const { escape, tr, phase } = options;
  const stepState = (index: number) => {
    const current = phase === 'draft' ? 0 : phase === 'review' ? 1 : 3;
    return index < current ? 'is-done' : index === current ? 'is-now' : 'is-lock';
  };
  const steps = [tr('DRAFT', 'SOẠN CÁO BUỘC'), tr('READ TOGETHER', 'CÙNG ĐỌC LẠI'), tr('FILED', 'ĐÃ NỘP')];
  return `${options.caseTitle ? `<div class="bpa-ac-ftab" aria-hidden="true"><span>${escape(options.caseTitle)}</span></div>` : ''}
    <header class="bpa-ac-head">
      <div class="bpa-ac-label">
        <span class="bpa-pin" aria-hidden="true"></span>
        ${options.sceneTitle ? `<p class="bpa-ac-labkick">${escape(options.sceneTitle)}</p>` : ''}
        <h2>${tr('Final Accusation', 'Cáo buộc cuối cùng')}</h2>
      </div>
      <div class="bpa-ac-mid">
        <p class="bpa-ac-warn${phase === 'filed' ? ' is-done' : ''}">${phase === 'filed' ? bpaIcons.check : bpaIcons.warn}${phase === 'filed'
          ? tr('The accusation has been filed.', 'Cáo buộc đã được nộp.')
          : tr('A wrong accusation ends the case.', 'Cáo buộc sai sẽ kết thúc vụ án.')}</p>
        <ol class="bpa-ac-path" aria-label="${tr('Accusation progress', 'Tiến độ cáo buộc')}">
          ${steps.map((label, index) => `<li class="${stepState(index)}"${stepState(index) === 'is-now' ? ' aria-current="step"' : ''}><span class="bpa-ac-node" aria-hidden="true"></span>${label}${index < steps.length - 1 ? '<span class="bpa-ac-link" aria-hidden="true"></span>' : ''}</li>`).join('')}
        </ol>
      </div>
      ${options.closable ? `<div class="bpa-ac-close"><button class="bpa-btn bpa-btn--gold bpa-btn--sm" type="button" data-accuse-close>${tr('Close', 'Đóng')}<kbd class="bpa-esc" aria-hidden="true">Esc</kbd></button></div>` : ''}
    </header>`;
}

export function renderAccusationSheet(options: {
  escape: Escape;
  tr: Translate;
  rows: AccusationSummaryRow[];
  revision?: number | null;
  authorLine?: string;
  authorInitials?: string;
  filed?: boolean;
  meta?: string[];
}): string {
  const { escape, tr, rows } = options;
  const head = rows.filter((row) => row.kind === 'suspect' || row.kind === 'motive' || row.kind === 'method' || !row.kind);
  const claims = rows.filter((row) => row.kind === 'claim' || row.kind === 'evidence');
  const row = (entry: AccusationSummaryRow) => {
    if (entry.kind === 'suspect') {
      return `<div class="bpa-ac-row is-sus"><span class="bpa-ac-rpin" aria-hidden="true"></span><p class="bpa-ac-rowk">${escape(entry.label)}</p>
        <div class="bpa-ac-rowv bpa-ac-who1">${bpaMono(initials(entry.value), 'witness', 'lg')}<p><b>${escape(entry.value)}</b>${entry.detail ? `<i>${escape(entry.detail)}</i>` : ''}</p></div></div>`;
    }
    if (entry.kind === 'claim' || entry.kind === 'evidence') {
      return `<div class="bpa-ac-row is-ev"><span class="bpa-ac-rpin" aria-hidden="true"></span><p class="bpa-ac-rowk">${escape(entry.label)}</p>
        <div class="bpa-ac-rowv bpa-ac-evrow">${bpaIcons.doc}<b>${escape(entry.value)}</b>${entry.undisclosed ? `<i class="bpa-ac-evmeta">${tr('Only your partner has seen it', 'Chỉ đồng đội đã thấy')}</i>` : ''}</div></div>`;
    }
    return `<div class="bpa-ac-row"><span class="bpa-ac-rpin" aria-hidden="true"></span><p class="bpa-ac-rowk">${escape(entry.label)}</p><p class="bpa-ac-rowv">${escape(entry.value)}</p></div>`;
  };
  return `<section class="bpa-ac-prop accusation-review" aria-label="${tr('Accusation proposal', 'Đề xuất cáo buộc')}">
    <span class="bpa-pin" aria-hidden="true"></span>
    <div class="bpa-ac-prophead"><p class="bpa-ac-kick">${tr('ACCUSATION PROPOSAL', 'ĐỀ XUẤT CÁO BUỘC')}</p>${options.revision ? `<b class="bpa-ac-ver">${tr('REVISION', 'PHIÊN BẢN')} ${options.revision}</b>` : `<b class="bpa-ac-ver">${tr('DRAFT', 'BẢN NHÁP')}</b>`}</div>
    ${options.authorLine ? `<p class="bpa-ac-by">${options.authorInitials ? bpaMono(options.authorInitials, 'partner', 'sm') : ''}${options.authorLine}</p>` : ''}
    <div class="bpa-ac-rows">
      ${head.map(row).join('')}
      ${options.filed ? `<div class="bpa-ac-bigbox" aria-hidden="true"><b class="bpa-ac-big"><span class="bpa-ac-bigt">${tr('ACCUSATION FILED', 'ĐÃ NỘP CÁO BUỘC')}</span><span class="bpa-ac-bigd">${new Date().toLocaleDateString()}</span></b></div>` : ''}
      ${claims.length ? `<p class="bpa-ac-rowh">${tr('CLAIMS OF THE ACCUSATION', 'CÁC LUẬN ĐIỂM CÁO BUỘC')}</p>${claims.map(row).join('')}` : ''}
    </div>
    ${options.meta?.length ? `<p class="bpa-ac-meta">${options.meta.map((entry) => `<span>${escape(entry)}</span>`).join('')}</p>` : ''}
  </section>`;
}

function personCard(kicker: string, person: AccusationPerson | undefined, fallbackName: string, tone: 'me' | 'partner', confirmed: boolean, tr: Translate, escape: Escape): string {
  const name = person?.name ?? fallbackName;
  return `<div class="bpa-ac-who${confirmed ? ' is-confirmed' : ''}">
      <p class="bpa-ac-whok"><b class="bpa-ac-mark" aria-hidden="true">${confirmed ? '✓' : '○'}</b> ${kicker}</p>
      <div class="bpa-ac-whon">${bpaMono(person?.initials ?? initials(name), tone, 'lg')}<p><b>${escape(name)}</b>${person?.role ? `<i>${escape(person.role)}</i>` : ''}</p></div>
      <div class="bpa-ac-sbox">${confirmed
        ? `<b class="bpa-ac-seal">${bpaIcons.check}${tr('CONFIRMED', 'ĐÃ XÁC NHẬN')}</b>`
        : `<i class="bpa-ac-wait"><em aria-hidden="true"></em>${tr('waiting…', 'đang chờ…')}</i>`}</div>
    </div>`;
}

export function renderAccusationConsensus(
  model: AccusationConsensusModel,
  escape: Escape,
  tr: Translate,
): string {
  const { proposal } = model;
  const authorLine = model.proposedByMe
    ? tr('You proposed this accusation.', 'Bạn đã đề xuất cáo buộc này.')
    : `${escape(model.proposerName)} ${tr('proposed this accusation.', 'đã đề xuất cáo buộc này.')}`;
  const warning = model.needsReReview && !model.filed
    ? `<p class="notice bpa-ac-alert" data-accusation-revision-warning role="status">${bpaIcons.warn}${tr(
        'The proposal changed. Read it again before you confirm.',
        'Đề xuất đã thay đổi. Hãy đọc lại trước khi xác nhận.',
      )}</p>`
    : '';
  const waiting = model.confirmedByMe && !model.partnerConfirmed && !model.filed
    ? `<p class="v3-waiting bpa-ac-status" role="status">${tr(
        'Waiting for your partner to confirm this revision.',
        'Đang chờ đồng đội xác nhận phiên bản này.',
      )}</p>`
    : '';
  const controls = model.filed
    ? `<div class="bpa-ac-final" role="status">
        <p class="bpa-ac-kick is-gold">${tr('INVESTIGATION COMPLETE', 'ĐIỀU TRA HOÀN TẤT')}</p>
        <p class="bpa-ac-finh">${tr('The case is closed', 'Vụ án đã hoàn tất')}</p>
        ${model.resultHref ? `<a class="bpa-btn bpa-btn--red bpa-ac-result" href="${escape(model.resultHref)}">${tr('View case result', 'Xem kết quả vụ án')}${bpaIcons.arrow}</a>` : ''}
      </div>`
    : `<div class="bpa-ac-ctrl">
        ${model.needsReReview
          ? `<label class="bpa-ac-read"><input type="checkbox" id="accusation-review"> ${tr('I have re-read it', 'Tôi đã đọc lại')}</label>
             <button class="bpa-btn bpa-btn--red bpa-ac-go" type="button" disabled aria-describedby="bpa-ac-reread-hint">${bpaIcons.check}${tr('Confirm accusation', 'Xác nhận cáo buộc')}</button>
             <p class="bpa-sr" id="bpa-ac-reread-hint">${tr('Tick “I have re-read it” first.', 'Hãy đánh dấu “Tôi đã đọc lại” trước.')}</p>`
          : `<button class="bpa-btn bpa-btn--red bpa-ac-go" id="accusation-confirm" type="button" ${model.confirmedByMe ? 'disabled' : ''}>${bpaIcons.check}${model.confirmedByMe ? tr('Confirmed', 'Đã xác nhận') : tr('Confirm accusation', 'Xác nhận cáo buộc')}</button>`}
        <div class="bpa-ac-secondary">
          <button class="bpa-btn bpa-btn--gold" id="accusation-amend" type="button">${tr('Edit proposal', 'Sửa đề xuất')}</button>
          <button class="bpa-btn bpa-btn--gold" id="accusation-cancel" type="button">${tr('Withdraw', 'Rút lại')}</button>
        </div>
      </div>`;

  return `<div class="overlay bpa-ac-veil" data-modal-key="accusation-consensus"><div class="modal modal-wide accusation-modal bpa-ac is-consensus${model.filed ? ' is-filed' : ''}${model.settled ? ' is-settled' : ''}"${model.renderKey ? ` data-render-key="${escape(model.renderKey)}"` : ''} data-accusation-attempt="${escape(proposal.attemptId)}" data-accusation-revision="${proposal.revision}">
    ${renderAccusationHeader({ escape, tr, phase: model.filed ? 'filed' : 'review', caseTitle: model.caseTitle, sceneTitle: model.sceneTitle, closable: false })}
    <div class="bpa-ac-body">
      <div class="bpa-ac-review">
        ${renderAccusationSheet({ escape, tr, rows: model.rows, revision: proposal.revision, authorLine, authorInitials: model.proposedByMe ? undefined : model.proposerInitials, filed: model.filed, meta: model.meta })}
        <section class="bpa-ac-confirm" aria-label="${tr('Team confirmation', 'Xác nhận của đội')}">
          <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
          <div class="bpa-ac-chead">
            <p class="bpa-ac-kick is-gold">${tr('TEAM CONFIRMATION', 'XÁC NHẬN CỦA ĐỘI')}</p>
            <h3 class="bpa-ac-both">${tr('Both detectives must confirm the same revision.', 'Cả hai thám tử phải xác nhận cùng một phiên bản.')} <span class="bpa-ac-rev">· r${proposal.revision}</span></h3>
            ${warning}
          </div>
          <div class="bpa-ac-pair v3-confirmation-state">
            ${personCard(tr('You', 'Bạn'), model.me, tr('You', 'Bạn'), 'me', model.confirmedByMe, tr, escape)}
            ${personCard(tr('Partner', 'Đồng đội'), model.partner, model.partnerName, 'partner', model.partnerConfirmed, tr, escape)}
          </div>
          ${waiting}
          ${controls}
        </section>
      </div>
    </div>
  </div></div>`;
}
