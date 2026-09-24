export type V3ConfrontationStatus =
  | 'CollectingProposals'
  | 'ReadyForReview'
  | 'AwaitingSecondConfirmation'
  | 'ResolvedCorrect'
  | 'ResolvedIncorrect'
  | 'Cancelled';

export type PrivateEvidence = {
  clueId: string;
  title: string;
  content: string;
  source: string;
  sourceType: string;
  sceneId: string;
  inventoryDescription: string;
  narrativeMeaning: string;
  photoUrl?: string | null;
};

export type PrivateTestimony = {
  testimonyFragmentId: string;
  dialogueId: string;
  characterId: string;
  characterName: string;
  text: string;
};

export type SharedReveal = {
  clueId: string;
  title: string;
  content: string;
  narrativeMeaning: string;
};

export type DisclosedPair = {
  attemptId: string;
  revision: number;
  status: string;
  evidence: PrivateEvidence;
  testimony: PrivateTestimony;
  feedback?: string | null;
  revealTitle?: string | null;
  reveals: SharedReveal[];
  disclosedAt: string;
  resolvedAt?: string | null;
};

export type ActivePairedConfrontation = {
  attemptId: string;
  revision: number;
  status: V3ConfrontationStatus;
  evidence?: PrivateEvidence | null;
  testimony?: PrivateTestimony | null;
  partnerHasProposed: boolean;
  confirmedByMe: boolean;
  partnerConfirmed: boolean;
  partnerConnected: boolean;
  canEdit: boolean;
  canConfirm: boolean;
  canCancel: boolean;
};

export type PairedConfrontationState = {
  privateEvidence?: PrivateEvidence[];
  privateTestimonies?: PrivateTestimony[];
  sharedKnowledge?: {
    attemptHistory?: DisclosedPair[];
    resolvedTruths?: DisclosedPair[];
  };
  activeConfrontation?: ActivePairedConfrontation | null;
};

export type PairedConfrontationViewModel = {
  role: string | null;
  active: ActivePairedConfrontation | null;
  privateEvidence: PrivateEvidence[];
  privateTestimonies: PrivateTestimony[];
  disclosedEvidenceIds: Set<string>;
  disclosedTestimonyIds: Set<string>;
  attemptHistory: DisclosedPair[];
  resolvedTruths: DisclosedPair[];
  phase: 'IDLE' | 'COLLECTING' | 'REVIEW' | 'WAITING';
  canStart: boolean;
};

type Escape = (value: string) => string;
type Translate = (english: string, vietnamese: string) => string;

export function renderV3EvidencePhoto(
  evidence: PrivateEvidence | null | undefined,
  escape: Escape,
  className: string,
): string {
  if (!evidence?.photoUrl) return '';
  return `<img class="${className}" data-auth-image="${escape(evidence.photoUrl)}" alt="${escape(`Captured evidence: ${evidence.title}`)}">`;
}

export function buildPairedConfrontationViewModel(
  state: PairedConfrontationState,
  role: string | null,
): PairedConfrontationViewModel {
  const active = state.activeConfrontation ?? null;
  const phase = !active
    ? 'IDLE'
    : active.status === 'CollectingProposals'
      ? 'COLLECTING'
      : active.status === 'AwaitingSecondConfirmation'
        ? 'WAITING'
        : 'REVIEW';
  const attemptHistory = [...(state.sharedKnowledge?.attemptHistory ?? [])];
  const resolvedTruths = [...(state.sharedKnowledge?.resolvedTruths ?? [])];
  const disclosedPairs = [...attemptHistory, ...resolvedTruths];
  const disclosedEvidenceIds = new Set(disclosedPairs.map((pair) => pair.evidence.clueId));
  const disclosedTestimonyIds = new Set(disclosedPairs.map((pair) => pair.testimony.testimonyFragmentId));
  const evidenceById = new Map((state.privateEvidence ?? []).map((entry) => [entry.clueId, entry]));
  const testimonyById = new Map((state.privateTestimonies ?? []).map((entry) => [entry.testimonyFragmentId, entry]));

  // Compatibility for an already-running local API that used to remove disclosed
  // owner knowledge from PrivateEvidence/PrivateTestimonies. Joint Review makes
  // these exact pairs visible, so restoring only the caller's role-owned side
  // does not disclose anything new.
  if (role === 'INVESTIGATOR') {
    disclosedPairs.forEach((pair) => evidenceById.set(pair.evidence.clueId, pair.evidence));
  }
  if (role === 'INTERROGATOR') {
    disclosedPairs.forEach((pair) => testimonyById.set(pair.testimony.testimonyFragmentId, pair.testimony));
  }

  return {
    role,
    active,
    privateEvidence: [...evidenceById.values()],
    privateTestimonies: [...testimonyById.values()],
    disclosedEvidenceIds,
    disclosedTestimonyIds,
    attemptHistory,
    resolvedTruths,
    phase,
    canStart: role === 'INTERROGATOR' && active === null,
  };
}

export function renderPrivateEvidencePanel(
  model: PairedConfrontationViewModel,
  escape: Escape,
  tr: Translate,
): string {
  if (model.role !== 'INVESTIGATOR') {
    return `<div class="v3-private-empty"><strong>${tr('Partner-owned evidence', 'Chứng cứ của đồng đội')}</strong><p>${tr('Ask your Investigator to describe physical traces. Their private evidence is never copied into this screen.', 'Hãy hỏi Điều tra viên về dấu vết vật lý. Chứng cứ riêng của họ không được sao chép vào màn hình này.')}</p></div>`;
  }
  if (model.privateEvidence.length === 0) {
    return `<div class="empty-state small">${tr('Inspect the scene to add private physical evidence.', 'Khám nghiệm hiện trường để thêm chứng cứ vật lý riêng.')}</div>`;
  }

  const canPropose = Boolean(model.active?.canEdit);
  return `<div class="v3-private-list">${model.privateEvidence.map((evidence) => `
    <article class="v3-private-card" data-private-evidence-card="${escape(evidence.clueId)}">
      <span class="v3-private-label">${model.disclosedEvidenceIds.has(evidence.clueId)
        ? tr('SHARED BEFORE · INVESTIGATOR', 'ĐÃ CHIA SẺ · ĐIỀU TRA VIÊN')
        : tr('PRIVATE · INVESTIGATOR', 'RIÊNG · ĐIỀU TRA VIÊN')}</span>
      ${renderV3EvidencePhoto(evidence, escape, 'v3-private-photo')}
      <h3>${escape(evidence.title)}</h3>
      <p>${escape(evidence.inventoryDescription || evidence.content)}</p>
      <button class="btn btn-gold btn-sm" data-v3-propose-evidence="${escape(evidence.clueId)}" ${canPropose ? '' : 'disabled'}>
        ${model.active ? tr('Propose for Joint Review', 'Đề xuất để cùng xem xét') : tr('Waiting for a testimony proposal', 'Đang chờ đề xuất lời khai')}
      </button>
    </article>`).join('')}</div>`;
}

export function renderPrivateTestimonyPanel(
  model: PairedConfrontationViewModel,
  escape: Escape,
  tr: Translate,
): string {
  if (model.role !== 'INTERROGATOR') {
    return `<div class="v3-private-empty"><strong>${tr('Partner-owned testimony', 'Lời khai của đồng đội')}</strong><p>${tr('Ask your Interrogator to describe what the witness said. Private fragments stay off this screen.', 'Hãy hỏi Thẩm vấn viên nhân chứng đã nói gì. Các đoạn lời khai riêng không xuất hiện ở màn hình này.')}</p></div>`;
  }
  if (model.privateTestimonies.length === 0) {
    return `<div class="empty-state small">${tr('Question the witness to record private testimony fragments.', 'Hỏi nhân chứng để ghi lại các đoạn lời khai riêng.')}</div>`;
  }

  return `<div class="v3-private-list">${model.privateTestimonies.map((testimony) => {
    const command = model.active ? 'data-v3-edit-testimony' : 'data-v3-start-testimony';
    return `
      <article class="v3-private-card" data-private-testimony-card="${escape(testimony.testimonyFragmentId)}">
        <span class="v3-private-label">${model.disclosedTestimonyIds.has(testimony.testimonyFragmentId)
          ? tr('SHARED BEFORE · INTERROGATOR', 'ĐÃ CHIA SẺ · THẨM VẤN VIÊN')
          : tr('PRIVATE · INTERROGATOR', 'RIÊNG · THẨM VẤN VIÊN')}</span>
        <h3>${escape(testimony.characterName || tr('Witness', 'Nhân chứng'))}</h3>
        <blockquote>${escape(testimony.text)}</blockquote>
        <button class="btn btn-gold btn-sm" ${command}="${escape(testimony.testimonyFragmentId)}" ${model.active && !model.active.canEdit ? 'disabled' : ''}>
          ${model.active ? tr('Replace proposal', 'Đổi đề xuất') : tr('Start confrontation', 'Bắt đầu đối chất')}
        </button>
      </article>`;
  }).join('')}</div>`;
}

export function renderJointReviewPanel(
  model: PairedConfrontationViewModel,
  escape: Escape,
  tr: Translate,
): string {
  const active = model.active;
  let activeMarkup = '';
  if (!active) {
    activeMarkup = `<div class="v3-review-cue"><strong>${tr('No active confrontation', 'Chưa có đối chất')}</strong><p>${tr('The Interrogator starts by proposing one private testimony fragment.', 'Thẩm vấn viên bắt đầu bằng cách đề xuất một đoạn lời khai riêng.')}</p></div>`;
  } else if (model.phase === 'COLLECTING') {
    const ownProposal = model.role === 'INVESTIGATOR' ? active.evidence?.title : active.testimony?.text;
    activeMarkup = `<div class="v3-review-cue is-collecting" data-v3-active-attempt="${escape(active.attemptId)}">
      <span class="v3-private-label">${tr('COLLECTING PROPOSALS', 'ĐANG THU ĐỀ XUẤT')} · r${active.revision}</span>
      ${ownProposal ? `<p class="v3-own-proposal">${escape(ownProposal)}</p>` : ''}
      <strong>${active.partnerHasProposed
        ? tr('Your partner has submitted a private proposal.', 'Đồng đội đã gửi một đề xuất riêng.')
        : tr('Waiting for the other role to propose.', 'Đang chờ vai còn lại đề xuất.')}</strong>
      <p>${tr('The pair stays hidden until both sides have proposed.', 'Cặp dữ liệu vẫn được giấu cho đến khi cả hai bên đã đề xuất.')}</p>
      ${active.canCancel ? `<button class="btn btn-ghost btn-sm" data-v3-cancel>${tr('Cancel attempt', 'Hủy lượt thử')}</button>` : ''}
    </div>`;
  } else {
    activeMarkup = `<section class="v3-joint-review" data-v3-active-attempt="${escape(active.attemptId)}">
      <div class="v3-review-heading"><div><span>${tr('JOINT REVIEW', 'CÙNG XEM XÉT')} · r${active.revision}</span><h3>${tr('Does this evidence crack the testimony?', 'Chứng cứ này có phá được lời khai?')}</h3></div></div>
      <div class="v3-pair-grid">
        <article class="v3-pair-card testimony"><span>${tr('TESTIMONY', 'LỜI KHAI')}</span><blockquote>${escape(active.testimony?.text ?? '')}</blockquote></article>
        <div class="v3-pair-link" aria-hidden="true">×</div>
        <article class="v3-pair-card evidence"><span>${tr('EVIDENCE', 'CHỨNG CỨ')}</span>${renderV3EvidencePhoto(active.evidence, escape, 'v3-pair-photo')}<h4>${escape(active.evidence?.title ?? '')}</h4><p>${escape(active.evidence?.inventoryDescription || active.evidence?.content || '')}</p></article>
      </div>
      <div class="v3-confirmation-state">
        <span class="${active.confirmedByMe ? 'is-confirmed' : ''}">${active.confirmedByMe ? '✓' : '○'} ${tr('You', 'Bạn')}</span>
        <span class="${active.partnerConfirmed ? 'is-confirmed' : ''}">${active.partnerConfirmed ? '✓' : '○'} ${tr('Partner', 'Đồng đội')}</span>
      </div>
      ${model.phase === 'WAITING' && active.confirmedByMe ? `<p class="v3-waiting">${tr('Waiting for your partner to confirm this revision.', 'Đang chờ đồng đội xác nhận phiên bản này.')}</p>` : ''}
      <div class="v3-review-actions">
        <button class="btn btn-gold" data-v3-confirm ${active.canConfirm ? '' : 'disabled'}>${tr('Confirm pair', 'Xác nhận cặp')}</button>
        <button class="btn btn-ghost" data-v3-cancel ${active.canCancel ? '' : 'disabled'}>${tr('Cancel', 'Hủy')}</button>
      </div>
    </section>`;
  }

  const history = [...model.attemptHistory, ...model.resolvedTruths]
    .sort((left, right) => Date.parse(right.resolvedAt || right.disclosedAt) - Date.parse(left.resolvedAt || left.disclosedAt));
  const historyMarkup = history.length === 0
    ? ''
    : `<section class="v3-shared-history"><h3>${tr('Shared attempts', 'Các lượt thử đã chia sẻ')}</h3>${history.map((pair) => `
        <article class="v3-history-pair ${pair.status === 'RESOLVED_SHARED_TRUTH' ? 'is-truth' : ''}">
          <span>${escape(pair.status.replaceAll('_', ' '))} · r${pair.revision}</span>
          ${renderV3EvidencePhoto(pair.evidence, escape, 'v3-history-photo')}
          <strong>${escape(pair.evidence.title)}</strong>
          <blockquote>${escape(pair.testimony.text)}</blockquote>
          ${pair.feedback ? `<p>${escape(pair.feedback)}</p>` : ''}
        </article>`).join('')}</section>`;

  return `<div class="v3-review-panel">${activeMarkup}${historyMarkup}</div>`;
}
