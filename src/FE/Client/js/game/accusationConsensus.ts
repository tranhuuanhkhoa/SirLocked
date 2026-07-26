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
};

type BuildInput = {
  proposal: AccusationProposal;
  localUserId: string;
  rows: AccusationSummaryRow[];
  proposerName: string;
  partnerName: string;
  /** `attemptId:revision` of the last revision this client acknowledged, if any. */
  acknowledgedKey: string | null;
};

type Escape = (value: string) => string;
type Translate = (english: string, vietnamese: string) => string;

export function accusationRevisionKey(proposal: AccusationProposal): string {
  return `${proposal.attemptId}:${proposal.revision}`;
}

export function buildAccusationConsensusModel(input: BuildInput): AccusationConsensusModel {
  const { proposal, localUserId } = input;
  const confirmedUserIds = proposal.confirmedUserIds ?? [];
  const confirmedByMe = confirmedUserIds.includes(localUserId);
  return {
    proposal,
    rows: input.rows,
    proposerName: input.proposerName,
    partnerName: input.partnerName,
    proposedByMe: proposal.proposedByUserId === localUserId,
    confirmedByMe,
    partnerConfirmed: confirmedUserIds.some((userId) => userId !== localUserId),
    // The revision is read from server state; the client never guesses that a proposal changed.
    needsReReview: !confirmedByMe && input.acknowledgedKey !== accusationRevisionKey(proposal),
  };
}

export function renderAccusationConsensus(
  model: AccusationConsensusModel,
  escape: Escape,
  tr: Translate,
): string {
  const { proposal } = model;
  const summary = model.rows
    .map((row) => `<p><strong>${escape(row.label)}:</strong> ${escape(row.value)}</p>`)
    .join('');
  const authorLine = model.proposedByMe
    ? tr('You proposed this accusation.', 'Bạn đã đề xuất cáo buộc này.')
    : `${escape(model.proposerName)} ${tr('proposed this accusation.', 'đã đề xuất cáo buộc này.')}`;
  const warning = model.needsReReview
    ? `<p class="notice" data-accusation-revision-warning>${tr(
        'The proposal changed. Read it again before you confirm.',
        'Đề xuất đã thay đổi. Hãy đọc lại trước khi xác nhận.',
      )}</p>`
    : '';
  const waiting = model.confirmedByMe && !model.partnerConfirmed
    ? `<p class="v3-waiting">${tr(
        'Waiting for your partner to confirm this revision.',
        'Đang chờ đồng đội xác nhận phiên bản này.',
      )}</p>`
    : '';

  return `<div class="overlay"><div class="modal modal-wide accusation-modal" data-accusation-attempt="${escape(proposal.attemptId)}" data-accusation-revision="${proposal.revision}">
    <h2>${tr('Final Accusation', 'Cáo buộc cuối cùng')}</h2>
    <p class="muted">${authorLine} ${tr('Both detectives must confirm the same revision.', 'Cả hai thám tử phải xác nhận cùng một phiên bản.')} · r${proposal.revision}</p>
    <div class="accusation-review">${summary}
      <p class="notice">${tr('A wrong accusation ends the case.', 'Cáo buộc sai sẽ kết thúc vụ án.')}</p>
    </div>
    ${warning}
    <div class="v3-confirmation-state">
      <span class="${model.confirmedByMe ? 'is-confirmed' : ''}">${model.confirmedByMe ? '✓' : '○'} ${tr('You', 'Bạn')}</span>
      <span class="${model.partnerConfirmed ? 'is-confirmed' : ''}">${model.partnerConfirmed ? '✓' : '○'} ${escape(model.partnerName)}</span>
    </div>
    ${waiting}
    <div class="modal-actions">
      <button class="btn btn-ghost" id="accusation-cancel" type="button">${tr('Withdraw', 'Rút lại')}</button>
      <button class="btn btn-ghost" id="accusation-amend" type="button">${tr('Edit proposal', 'Sửa đề xuất')}</button>
      ${model.needsReReview
        ? `<button class="btn btn-gold" id="accusation-review" type="button">${tr('I have re-read it', 'Tôi đã đọc lại')}</button>`
        : `<button class="btn btn-gold" id="accusation-confirm" type="button" ${model.confirmedByMe ? 'disabled' : ''}>${tr('Confirm accusation', 'Xác nhận cáo buộc')}</button>`}
    </div>
  </div></div>`;
}
