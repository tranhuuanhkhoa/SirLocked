import '../../../css/41-bpa-casefile.css';
import { initials } from '../utils/dom.js';

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
  /** Partner-owned items the pair has already put on the table together. */
  sharedEvidence: PrivateEvidence[];
  sharedTestimonies: PrivateTestimony[];
  disclosedEvidenceIds: Set<string>;
  disclosedTestimonyIds: Set<string>;
  /** Testimony fragment id → the shared truth that broke it. */
  brokenTestimonies: Map<string, DisclosedPair>;
  attemptHistory: DisclosedPair[];
  resolvedTruths: DisclosedPair[];
  phase: 'IDLE' | 'COLLECTING' | 'REVIEW' | 'WAITING';
  canStart: boolean;
};

type Escape = (value: string) => string;
type Translate = (english: string, vietnamese: string) => string;

/** Who is looking at the case file; names only ever arrive as initials on screen. */
export type CaseFilePeople = {
  myName: string;
  myInitials: string;
  partnerName: string;
  partnerInitials: string;
};

export type CaseFileRenderContext = {
  escape: Escape;
  tr: Translate;
  people: CaseFilePeople;
  /** `section=evidence&clueId=…` selection, falls back to the first card. */
  selectedEvidenceId?: string | null;
  sceneTitle?: (sceneId: string) => string;
  witnessRole?: (characterId: string) => string;
  formatTime?: (iso: string | null | undefined) => string;
};

/* --------------------------------------------------------------------------
   Shared "Bảng phá án" pieces: icons, monograms, ownership tags.
   -------------------------------------------------------------------------- */

const icon = (body: string) => `<svg class="bpa-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const bpaIcons = {
  lock: icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  shared: icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4"/><circle cx="17" cy="9" r="2.6"/><path d="M16.6 13.7c2.4.2 4 1.9 4.4 4.6"/>'),
  eye: icon('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  check: icon('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  arrow: icon('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
  back: icon('<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>'),
  search: icon('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>'),
  camera: icon('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6"/>'),
  pin: icon('<path d="M12 21s-6-5.4-6-10.5A6 6 0 0 1 18 10.5C18 15.6 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>'),
  clock: icon('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M10 2.5h4"/>'),
  bulb: icon('<path d="M9 17h6"/><path d="M10 20h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
  chat: icon('<path d="M4 5h16v11H9l-5 4z"/>'),
  warn: icon('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.4v.1"/>'),
  scale: icon('<path d="M12 4v16"/><path d="M7 20h10"/><path d="M5 7h14"/><path d="M5 7l-3 6a3 3 0 0 0 6 0z"/><path d="M19 7l-3 6a3 3 0 0 0 6 0z"/>'),
  flag: icon('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  key: icon('<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8"/><path d="M16 6l2 2"/>'),
  map: icon('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  doc: icon('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 12h7M9 16h7"/>'),
  cursor: icon('<path d="M5 3l13 6.5-5.5 2-2 5.5z"/>'),
  neq: icon('<path d="M5 9h14M5 15h14"/><path d="M16 4L8 20"/>'),
  stamp: icon('<path d="M9 3h6l-1 7h-4z"/><path d="M5 14h14v3H5z"/><path d="M4 21h16"/>'),
  redo: icon('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>'),
};

export function bpaMono(initials: string, tone: 'me' | 'partner' | 'witness' = 'witness', size: '' | 'sm' | 'lg' = ''): string {
  return `<b class="bpa-mono is-${tone}${size ? ` is-${size}` : ''}" aria-hidden="true">${initials}</b>`;
}

export function roleLabel(role: string | null | undefined, tr: Translate): string {
  if (role === 'INVESTIGATOR') return tr('INVESTIGATOR', 'ĐIỀU TRA VIÊN');
  if (role === 'INTERROGATOR') return tr('INTERROGATOR', 'THẨM VẤN VIÊN');
  return tr('DETECTIVE', 'THÁM TỬ');
}

/**
 * Ownership tag. `mine` is teal, the partner rust; filled once it has been put on the table.
 * The text keeps the role so the label still reads correctly without colour.
 */
export function ownerTag(
  owner: 'mine' | 'partner',
  ownerRole: string | null,
  state: 'private' | 'shared-before' | 'shared',
  tr: Translate,
): string {
  const role = roleLabel(ownerRole, tr);
  const text = state === 'private'
    ? `${tr('PRIVATE', 'RIÊNG')} · ${role}`
    : state === 'shared-before'
      ? `${tr('SHARED BEFORE', 'ĐÃ CHIA SẺ')} · ${role}`
      : `${tr('SHARED', 'ĐÃ CHIA SẺ')} · ${role}`;
  return `<b class="bpa-tag is-${owner}${state === 'private' ? '' : ' is-shared'}">${state === 'private' ? bpaIcons.lock : bpaIcons.shared}${text}</b>`;
}


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

  // The partner's side of a disclosed pair is shared knowledge; nothing private is read here.
  const sharedEvidence = new Map<string, PrivateEvidence>();
  const sharedTestimonies = new Map<string, PrivateTestimony>();
  disclosedPairs.forEach((pair) => {
    if (role !== 'INVESTIGATOR') sharedEvidence.set(pair.evidence.clueId, pair.evidence);
    if (role !== 'INTERROGATOR') sharedTestimonies.set(pair.testimony.testimonyFragmentId, pair.testimony);
  });
  const brokenTestimonies = new Map(resolvedTruths
    .filter((pair) => pair.status === 'RESOLVED_SHARED_TRUTH')
    .map((pair) => [pair.testimony.testimonyFragmentId, pair]));

  return {
    role,
    active,
    privateEvidence: [...evidenceById.values()],
    privateTestimonies: [...testimonyById.values()],
    sharedEvidence: [...sharedEvidence.values()],
    sharedTestimonies: [...sharedTestimonies.values()],
    disclosedEvidenceIds,
    disclosedTestimonyIds,
    brokenTestimonies,
    attemptHistory,
    resolvedTruths,
    phase,
    canStart: role === 'INTERROGATOR' && active === null,
  };
}

function fallbackContext(escape: Escape, tr: Translate, context?: CaseFileRenderContext): CaseFileRenderContext {
  return context ?? {
    escape,
    tr,
    people: { myName: tr('You', 'Bạn'), myInitials: '•', partnerName: tr('Partner', 'Đồng đội'), partnerInitials: '•' },
  };
}

function evidenceTile(evidence: PrivateEvidence, escape: Escape, photoClass: string): string {
  const photo = renderV3EvidencePhoto(evidence, escape, photoClass);
  return `<span class="bpa-cf-evtile${photo ? ' has-photo' : ''}" aria-hidden="${photo ? 'false' : 'true'}">${photo || `<span>${initials(evidence.title)}</span>`}</span>`;
}

/* --------------------------------------------------------------------------
   Tab 01 · physical evidence
   -------------------------------------------------------------------------- */

export function renderPrivateEvidencePanel(
  model: PairedConfrontationViewModel,
  escape: Escape,
  tr: Translate,
  context?: CaseFileRenderContext,
): string {
  const ctx = fallbackContext(escape, tr, context);
  const owner = model.role === 'INVESTIGATOR';
  const items = owner ? model.privateEvidence : model.sharedEvidence;
  const canPropose = Boolean(model.active?.canEdit) && owner;
  const proposedId = model.active?.evidence?.clueId ?? null;

  const cue = !owner
    ? ''
    : !model.active
      ? tr('Waiting for a testimony proposal', 'Đang chờ đề xuất lời khai')
      : canPropose
        ? tr('Your partner proposed a testimony. Propose the evidence that breaks it.', 'Đồng đội đã đề xuất lời khai. Hãy đề xuất chứng cứ phá được lời khai đó.')
        : tr('Joint Review is open in Crack the Lie.', 'Đang cùng xem xét trong mục Phá Vỡ Lời Dối.');

  const rows = items.map((evidence) => {
    const shared = model.disclosedEvidenceIds.has(evidence.clueId);
    const tag = owner
      ? ownerTag('mine', 'INVESTIGATOR', shared ? 'shared-before' : 'private', tr)
      : ownerTag('partner', 'INVESTIGATOR', 'shared', tr);
    const selected = (ctx.selectedEvidenceId ?? items[0]?.clueId) === evidence.clueId;
    const isProposed = proposedId === evidence.clueId;
    return `<article class="bpa-cf-ev${selected ? ' is-selected' : ''}${isProposed ? ' is-proposed' : ''}" ${owner ? `data-private-evidence-card="${escape(evidence.clueId)}"` : `data-shared-evidence-card="${escape(evidence.clueId)}"`}>
      <button class="bpa-cf-evpick" type="button" data-evidence-detail="${escape(evidence.clueId)}" aria-pressed="${selected}">
        ${evidenceTile(evidence, escape, owner ? 'v3-private-photo' : 'bpa-cf-shared-photo')}
        <span class="bpa-cf-evtxt">
          <span class="bpa-cf-evname">${escape(evidence.title)}</span>
          <span class="bpa-cf-evtags">${tag}${isProposed ? `<b class="bpa-mark is-key">${tr('PROPOSED', 'ĐANG ĐỀ XUẤT')}</b>` : ''}${evidence.photoUrl ? `<b class="bpa-mark is-photo">${bpaIcons.camera}${tr('PHOTO', 'CHỨNG CỨ ẢNH')}</b>` : ''}</span>
        </span>
      </button>
      ${canPropose ? `<button class="bpa-btn bpa-btn--sm bpa-btn--red bpa-cf-evpropose" type="button" data-v3-propose-evidence="${escape(evidence.clueId)}" aria-label="${tr('Propose for Joint Review', 'Đề xuất để cùng xem xét')}: ${escape(evidence.title)}">${bpaIcons.search}<span>${tr('Propose', 'Đề xuất')}</span></button>` : ''}
    </article>`;
  }).join('');

  const empty = owner
    ? `<p class="bpa-cf-empty empty-state small">${tr('Inspect the scene to add private physical evidence.', 'Khám nghiệm hiện trường để thêm chứng cứ vật lý riêng.')}</p>`
    : `<p class="bpa-cf-empty">${tr('Your partner has not shared any evidence yet.', 'Đồng đội chưa chia sẻ chứng cứ nào.')}</p>`;
  const seen = owner
    ? `<aside class="bpa-cf-seen">${bpaIcons.eye}<div><strong>${tr('What does your partner see?', 'Đồng đội thấy gì?')}</strong>${tr(
        `Your partner only sees evidence you have put into a Joint Review (${model.disclosedEvidenceIds.size}). The rest stays in your notebook.`,
        `Đồng đội chỉ thấy chứng cứ bạn đã đưa ra cùng xem xét (${model.disclosedEvidenceIds.size}). Phần còn lại nằm trong sổ của bạn.`,
      )}</div></aside>`
    : `<aside class="bpa-cf-pnote">${bpaIcons.chat}<div><strong>${tr('Partner-owned evidence', 'Chứng cứ của đồng đội')}</strong>${tr('Ask your Investigator to describe physical traces. Their private evidence is never copied into this screen.', 'Hãy hỏi Điều tra viên về dấu vết vật lý. Chứng cứ riêng của họ không được sao chép vào màn hình này.')}</div></aside>`;

  const selected = items.find((evidence) => evidence.clueId === ctx.selectedEvidenceId) ?? items[0];
  return `<div class="bpa-cf-evgrid${selected ? '' : ' is-single'}">
    <div class="bpa-cf-evcol">
      <div class="v3-private-list bpa-cf-evlist">
        ${cue ? `<p class="bpa-cf-cue${canPropose ? ' is-live' : ''}" role="status">${cue}</p>` : ''}
        ${items.length ? rows : empty}
      </div>
      ${seen}
    </div>
    ${selected ? renderEvidenceDetail(selected, model, ctx, owner) : ''}
  </div>`;
}

function renderEvidenceDetail(evidence: PrivateEvidence, model: PairedConfrontationViewModel, ctx: CaseFileRenderContext, owner: boolean): string {
  const { escape, tr } = ctx;
  const shared = model.disclosedEvidenceIds.has(evidence.clueId);
  const index = Math.max(0, (owner ? model.privateEvidence : model.sharedEvidence).indexOf(evidence)) + 1;
  const pairs = [...model.attemptHistory, ...model.resolvedTruths].filter((pair) => pair.evidence.clueId === evidence.clueId);
  const scene = ctx.sceneTitle?.(evidence.sceneId) ?? '';
  const photo = renderV3EvidencePhoto(evidence, escape, 'bpa-cf-detphoto');
  return `<section class="bpa-cf-detwrap" aria-label="${escape(evidence.title)}">
    <article class="bpa-cf-det">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <div class="bpa-cf-plate">
        <span class="bpa-cf-plno">${tr('EXHIBIT', 'VẬT CHỨNG')} Nº ${String(index).padStart(2, '0')}</span>
        ${photo
          ? `<figure class="bpa-cf-polar"><span class="bpa-cf-tape is-a" aria-hidden="true"></span><span class="bpa-cf-tape is-b" aria-hidden="true"></span><span class="bpa-cf-crop">${photo}</span><figcaption>${escape(evidence.title)}</figcaption></figure>`
          : `<span class="bpa-cf-platemono" aria-hidden="true">${initials(evidence.title)}</span>`}
        ${shared ? `<span class="bpa-cf-postmark" aria-hidden="true">${tr('SHARED', 'ĐÃ CHIA SẺ')}</span>` : ''}
      </div>
      <h3 class="bpa-cf-dettitle">${escape(evidence.title)}</h3>
      <div class="bpa-cf-evtags">${owner ? ownerTag('mine', 'INVESTIGATOR', shared ? 'shared-before' : 'private', tr) : ownerTag('partner', 'INVESTIGATOR', 'shared', tr)}${evidence.photoUrl ? `<b class="bpa-mark is-photo">${bpaIcons.camera}${tr('PHOTO EVIDENCE', 'CHỨNG CỨ ẢNH')}</b>` : ''}</div>
      <p class="bpa-cf-detdesc">${escape(evidence.content || evidence.inventoryDescription)}</p>
      ${scene ? `<dl class="bpa-cf-meta"><div><dt>${bpaIcons.pin}<span class="bpa-sr">${tr('Location', 'Địa điểm')}</span></dt><dd>${escape(scene)}</dd></div></dl>` : ''}
      ${evidence.inventoryDescription && evidence.content && evidence.inventoryDescription !== evidence.content
        ? `<p class="bpa-cf-insp"><b>${tr('INSPECTION NOTE', 'GHI CHÚ KHÁM NGHIỆM')}</b>${escape(evidence.inventoryDescription)}</p>` : ''}
      ${owner && evidence.narrativeMeaning ? `<p class="bpa-cf-insp is-teal"><b>${tr('WHY IT MATTERS', 'Ý NGHĨA')}</b>${escape(evidence.narrativeMeaning)}</p>` : ''}
      ${pairs.length ? `<p class="bpa-cf-sharedline">${bpaIcons.shared}${tr(
        `Put on the table with ${escape(ctx.people.partnerName)} in ${pairs.length} attempt(s).`,
        `Đã đưa ra cùng ${escape(ctx.people.partnerName)} xem xét trong ${pairs.length} lượt thử.`,
      )}</p>` : ''}
    </article>
  </section>`;
}

/* --------------------------------------------------------------------------
   Tab 02 · testimony
   -------------------------------------------------------------------------- */

export function renderPrivateTestimonyPanel(
  model: PairedConfrontationViewModel,
  escape: Escape,
  tr: Translate,
  context?: CaseFileRenderContext,
): string {
  const ctx = fallbackContext(escape, tr, context);
  const owner = model.role === 'INTERROGATOR';
  const items = owner ? model.privateTestimonies : model.sharedTestimonies;
  const proposedId = model.active?.testimony?.testimonyFragmentId ?? null;

  const groups = new Map<string, { name: string; characterId: string; items: PrivateTestimony[] }>();
  items.forEach((testimony) => {
    const key = testimony.characterId || testimony.characterName || '?';
    const group = groups.get(key) ?? { name: testimony.characterName || tr('Witness', 'Nhân chứng'), characterId: testimony.characterId, items: [] };
    group.items.push(testimony);
    groups.set(key, group);
  });

  const slip = (testimony: PrivateTestimony, index: number) => {
    const broken = model.brokenTestimonies.get(testimony.testimonyFragmentId);
    const shared = model.disclosedTestimonyIds.has(testimony.testimonyFragmentId);
    const tag = owner
      ? ownerTag('mine', 'INTERROGATOR', shared ? 'shared-before' : 'private', tr)
      : ownerTag('partner', 'INTERROGATOR', 'shared', tr);
    const command = model.active ? 'data-v3-edit-testimony' : 'data-v3-start-testimony';
    const isProposed = proposedId === testimony.testimonyFragmentId;
    return `<article class="bpa-cf-slip${index % 2 ? ' is-tilt' : ''}${broken ? ' is-broken' : ''}${isProposed ? ' is-proposed' : ''}" ${owner ? `data-private-testimony-card="${escape(testimony.testimonyFragmentId)}"` : `data-shared-testimony-card="${escape(testimony.testimonyFragmentId)}"`}>
      ${broken ? `<b class="bpa-cf-slipstamp" aria-hidden="true">${tr('CRACKED', 'ĐÃ BỊ PHÁ')}</b>` : ''}
      <blockquote class="bpa-cf-quote"><span class="bpa-cf-qt">${escape(testimony.text)}</span></blockquote>
      ${broken ? `<p class="bpa-cf-refute">${bpaIcons.chat}${tr('Broken by', 'Bị bác bỏ bởi')} ${escape(broken.evidence.title)}</p>` : ''}
      <div class="bpa-cf-slipmeta">
        ${tag}${isProposed ? `<b class="bpa-mark is-key">${tr('PROPOSED', 'ĐANG ĐỀ XUẤT')}</b>` : ''}
        ${owner ? `<button class="bpa-btn bpa-btn--sm ${model.active ? 'bpa-btn--ink' : 'bpa-btn--red'} bpa-cf-slipbtn" type="button" ${command}="${escape(testimony.testimonyFragmentId)}" ${model.active && !model.active.canEdit ? 'disabled' : ''}>
          ${model.active ? `${bpaIcons.redo}<span>${tr('Replace proposal', 'Đổi đề xuất')}</span>` : `${bpaIcons.search}<span>${tr('Start confrontation', 'Bắt đầu đối chất')}</span>`}
        </button>` : ''}
      </div>
    </article>`;
  };

  const body = [...groups.values()].map((group) => {
    const role = group.characterId ? ctx.witnessRole?.(group.characterId) ?? '' : '';
    return `<section class="bpa-cf-wit">
      <div class="bpa-cf-who">${bpaMono(initials(group.name), 'witness', 'lg')}<div><h3 class="bpa-cf-whoname">${escape(group.name)}</h3>${role ? `<p class="bpa-cf-whorole">${escape(role)}</p>` : ''}</div></div>
      ${group.items.map(slip).join('')}
    </section>`;
  }).join('');

  const empty = owner
    ? `<p class="bpa-cf-empty empty-state small">${tr('Question the witness to record private testimony fragments.', 'Hỏi nhân chứng để ghi lại các đoạn lời khai riêng.')}</p>`
    : `<p class="bpa-cf-empty">${tr('Your partner has not shared any testimony yet.', 'Đồng đội chưa chia sẻ lời khai nào.')}</p>`;
  const note = owner
    ? (model.active
      ? `<p class="bpa-cf-cue" role="status">${tr('A confrontation is open. Replacing your proposal resets both confirmations.', 'Đang có lượt đối chất. Đổi đề xuất sẽ xóa xác nhận của cả hai.')}</p>`
      : `<p class="bpa-cf-cue" role="status">${tr('Pick the statement you can break, then start a confrontation.', 'Chọn câu khai có thể phá, rồi bắt đầu đối chất.')}</p>`)
    : '';
  const partnerNote = owner
    ? ''
    : `<aside class="bpa-cf-pnote">${bpaIcons.chat}<div><strong>${tr('Partner-owned testimony', 'Lời khai của đồng đội')}</strong>${tr('Ask your Interrogator to describe what the witness said. Private fragments stay off this screen.', 'Hãy hỏi Thẩm vấn viên nhân chứng đã nói gì. Các đoạn lời khai riêng không xuất hiện ở màn hình này.')}</div></aside>`;

  return `<div class="v3-private-list bpa-cf-wgrid">${note}${items.length ? body : empty}</div>${partnerNote}`;
}

/* --------------------------------------------------------------------------
   Tab 03 · Crack the Lie — joint review board (Confront.html)
   -------------------------------------------------------------------------- */

type ThreadVariant = 'propose' | 'taut' | 'cut' | 'won';

/** Red string through a brass magnifier; `prefix` keeps SVG ids unique per board. */
export function magnifierSvg(prefix: string, variant: ThreadVariant): string {
  const p = prefix;
  const defs = `<defs>
      <clipPath id="${p}-glass"><circle cx="111" cy="114" r="38"/></clipPath>
      <radialGradient id="${p}-pin" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#f3a291"/><stop offset=".45" stop-color="#c0392b"/><stop offset="1" stop-color="#6e1a12"/></radialGradient>
      <linearGradient id="${p}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c2"/><stop offset=".45" stop-color="#c7a24b"/><stop offset="1" stop-color="#5e4a1c"/></linearGradient>
      <linearGradient id="${p}-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a5232"/><stop offset=".5" stop-color="#5a3b22"/><stop offset="1" stop-color="#2a1b10"/></linearGradient>
    </defs>`;
  const taut = 'M16 106Q111 122 206 106';
  const thread = (d: string, extra = '') => `<path class="bpa-thread is-shadow" pathLength="1" transform="translate(2 5)" d="${d}"/><path class="bpa-thread is-red${extra}" pathLength="1" d="${d}"/>`;
  const threads = variant === 'propose'
    ? `${thread('M16 106Q60 117 102 114')}<path class="bpa-thread-pend" d="M157 113Q183 111 199 107"/>`
    : variant === 'cut'
      ? `${thread('M16 106C28 128 42 146 62 156', ' is-dull')}${thread('M206 106C194 128 180 146 160 156', ' is-dull')}`
      : thread(taut);
  const pin = (x: number) => `<ellipse cx="${x + 2.4}" cy="110.6" rx="8" ry="5" fill="rgba(0,0,0,.45)"/><circle cx="${x}" cy="106" r="8.5" fill="url(#${p}-pin)"/>`;
  return `<svg class="bpa-cx-link is-${variant}" viewBox="0 0 222 262" aria-hidden="true" focusable="false">
    ${defs}
    ${variant === 'won' ? `<path class="bpa-thread-glow" d="${taut}"/>` : ''}
    ${threads}
    <g transform="rotate(45 111 114)"><rect x="151" y="107" width="14" height="14" rx="2" fill="#b08d3a" stroke="#5e4a1c" stroke-width="1.4"/><rect x="164" y="106" width="40" height="16" rx="8" fill="url(#${p}-wood)" stroke="#2a1b10" stroke-width="1.4"/></g>
    <circle cx="111" cy="114" r="38" fill="rgba(214,232,236,.2)"/>
    ${variant === 'taut' || variant === 'won' ? `<g clip-path="url(#${p}-glass)"><path class="bpa-thread is-mag" d="${taut}" transform="translate(111 114) scale(1.4) translate(-111 -114)"/></g>` : ''}
    ${variant === 'propose' ? '<text x="111" y="128" class="bpa-cx-qmark">?</text>' : ''}
    ${variant === 'won' ? `<g clip-path="url(#${p}-glass)"><rect class="bpa-cx-glint" x="104" y="64" width="12" height="100" fill="rgba(255,255,255,.65)"/></g>` : ''}
    <path d="M86 97a30 30 0 0 1 26-14" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="111" cy="114" r="42" fill="none" stroke="#5e4a1c" stroke-width="10"/>
    <circle cx="111" cy="114" r="42" fill="none" stroke="url(#${p}-rim)" stroke-width="7"/>
    <circle cx="111" cy="114" r="38" fill="none" stroke="rgba(94,74,28,.8)" stroke-width="1"/>
    ${pin(16)}
    ${variant === 'propose'
      ? '<circle cx="206" cy="106" r="8" fill="rgba(251,246,237,.55)" stroke="rgba(91,82,72,.75)" stroke-width="1.4" stroke-dasharray="2.6 2.2"/>'
      : pin(206)}
  </svg>`;
}

type CardOptions = {
  escape: Escape;
  tr: Translate;
  /** Who is reading: decides "you" versus "your partner" in the byline and the tag colour. */
  viewerRole: string | null;
  people?: CaseFilePeople;
  witnessRole?: string;
  photoClass?: string;
  sceneTitle?: string;
  tagState?: 'private' | 'shared-before' | 'shared';
};

export function testimonyCard(testimony: PrivateTestimony, options: CardOptions, extraClass = ''): string {
  const { escape, tr } = options;
  // Without a viewer (the shared payoff) colours and bylines follow the owning role.
  const mine = options.viewerRole === 'INTERROGATOR';
  const tone = options.viewerRole ? (mine ? 'mine' : 'partner') : 'partner';
  const byInitials = !options.people ? '' : mine ? options.people.myInitials : options.people.partnerInitials;
  const byline = !options.viewerRole || !options.people
    ? (mine ? tr('You proposed this testimony.', 'Bạn đã đề xuất lời khai này.') : tr('The Interrogator proposed this testimony.', 'Thẩm vấn viên đã đề xuất lời khai này.'))
    : mine
      ? tr('You proposed this testimony.', 'Bạn đã đề xuất lời khai này.')
      : `${escape(options.people.partnerName)} ${tr('proposed this testimony.', 'đã đề xuất lời khai này.')}`;
  const name = testimony.characterName || tr('Witness', 'Nhân chứng');
  return `<div class="bpa-cx-paper${extraClass}">
      <div class="bpa-cx-cardhead"><p class="bpa-cx-kick">${tr('TESTIMONY', 'LỜI KHAI')}</p></div>
      ${ownerTag(tone, 'INTERROGATOR', options.tagState ?? 'shared', tr)}
      <div class="bpa-cx-name">${bpaMono(initials(name))}<p><b class="bpa-cx-mini">${tr('WITNESS', 'NHÂN CHỨNG')}</b><b class="bpa-cx-nm">${escape(name)}</b>${options.witnessRole ? `<i> · ${escape(options.witnessRole)}</i>` : ''}</p></div>
      <div class="bpa-cx-ruled"><blockquote class="bpa-cx-quote">${escape(testimony.text)}</blockquote></div>
      <p class="bpa-cx-by">${byInitials ? bpaMono(byInitials, tone === 'mine' ? 'me' : 'partner', 'sm') : ''}${byline}</p>
    </div>`;
}

export function evidenceCard(evidence: PrivateEvidence, options: CardOptions): string {
  const { escape, tr } = options;
  const mine = options.viewerRole === 'INVESTIGATOR';
  const tone = options.viewerRole ? (mine ? 'mine' : 'partner') : 'mine';
  const byInitials = !options.people ? '' : mine ? options.people.myInitials : options.people.partnerInitials;
  const byline = !options.viewerRole || !options.people
    ? (mine ? tr('You proposed this evidence.', 'Bạn đã đề xuất chứng cứ này.') : tr('The Investigator proposed this evidence.', 'Điều tra viên đã đề xuất chứng cứ này.'))
    : mine
      ? tr('You proposed this evidence.', 'Bạn đã đề xuất chứng cứ này.')
      : `${escape(options.people.partnerName)} ${tr('proposed this evidence.', 'đã đề xuất chứng cứ này.')}`;
  const photo = renderV3EvidencePhoto(evidence, escape, options.photoClass ?? 'bpa-cx-photoimg');
  return `<article class="bpa-cx-ecard" aria-label="${tr('Evidence', 'Chứng cứ')}: ${escape(evidence.title)}">
      <svg class="bpa-cx-twine" viewBox="0 0 30 44" aria-hidden="true" focusable="false"><path d="M15 6C9 16 10 30 13 41M15 6C21 16 20 30 17 41" fill="none" stroke="#cdb98d" stroke-width="1.6" stroke-linecap="round"/><circle cx="16.2" cy="8" r="6" fill="rgba(0,0,0,.45)"/><circle cx="15" cy="6" r="6" fill="#c7a24b"/></svg>
      <span class="bpa-cx-hole" aria-hidden="true"></span>
      <div class="bpa-cx-cardhead"><p class="bpa-cx-kick">${tr('EVIDENCE', 'CHỨNG CỨ')}</p>${options.sceneTitle ? `<b class="bpa-cx-mini">${escape(options.sceneTitle)}</b>` : ''}</div>
      ${ownerTag(tone, 'INVESTIGATOR', options.tagState ?? 'shared', tr)}
      <figure class="bpa-cx-photo${photo ? '' : ' is-empty'}">
        <span class="bpa-tape-bit is-a" aria-hidden="true"></span><span class="bpa-tape-bit is-b" aria-hidden="true"></span>
        ${photo || `<span class="bpa-cx-photomono" aria-hidden="true">${initials(evidence.title)}</span>`}
      </figure>
      <h4 class="bpa-cx-etitle">${escape(evidence.title)}</h4>
      <p class="bpa-cx-edesc">${escape(evidence.inventoryDescription || evidence.content)}</p>
      <p class="bpa-cx-by">${byInitials ? bpaMono(byInitials, tone === 'mine' ? 'me' : 'partner', 'sm') : ''}${byline}</p>
    </article>`;
}

function sealedEnvelope(kind: 'testimony' | 'evidence', ownerRole: string, partnerHasProposed: boolean, tr: Translate, partnerInitials: string): string {
  return `<section class="bpa-cx-env" aria-label="${tr('Sealed partner proposal', 'Đề xuất của đồng đội đang niêm phong')}">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <span class="bpa-cx-flap" aria-hidden="true"></span>
      <svg class="bpa-cx-tie" viewBox="0 0 40 80" aria-hidden="true" focusable="false"><path d="M20 14C35 30 5 46 20 62C35 46 5 30 20 14" fill="none" stroke="#b8382b" stroke-width="1.8"/><circle cx="20" cy="14" r="9.5" fill="#c7a24b" stroke="#5e4a1c"/><circle cx="20" cy="62" r="9.5" fill="#c7a24b" stroke="#5e4a1c"/><path d="M20 14C29 22 18 24 12 16M20 62c-3 9-9 13-15 15" fill="none" stroke="#b8382b" stroke-width="1.8" stroke-linecap="round"/></svg>
      <div class="bpa-cx-envlabel">
        <div class="bpa-cx-cardhead"><p class="bpa-cx-kick">${kind === 'testimony' ? tr('TESTIMONY', 'LỜI KHAI') : tr('EVIDENCE', 'CHỨNG CỨ')}</p>${ownerTag('partner', ownerRole, 'private', tr)}</div>
        <p class="bpa-cx-collect"><i aria-hidden="true"></i>${tr('COLLECTING PROPOSALS', 'ĐANG THU ĐỀ XUẤT')}</p>
        <p class="bpa-cx-envline">${bpaMono(partnerInitials, 'partner', 'sm')}${partnerHasProposed
          ? tr('Your partner has submitted a private proposal.', 'Đồng đội đã gửi một đề xuất riêng.')
          : tr('Waiting for the other role to propose.', 'Đang chờ vai còn lại đề xuất.')}</p>
        <p class="bpa-cx-note">${tr('The pair stays hidden until both sides have proposed.', 'Cặp dữ liệu vẫn được giấu cho đến khi cả hai bên đã đề xuất.')}</p>
      </div>
    </section>`;
}

function evidencePicker(model: PairedConfrontationViewModel, ctx: CaseFileRenderContext): string {
  const { escape, tr } = ctx;
  const list = model.privateEvidence.map((evidence) => `<li><button class="bpa-cx-ev" type="button" data-v3-propose-evidence="${escape(evidence.clueId)}" ${model.active?.canEdit ? '' : 'disabled'}>
      <span class="bpa-cx-thumb">${evidenceTile(evidence, escape, 'bpa-cx-thumbimg')}</span>
      <span class="bpa-cx-evtxt"><span class="bpa-cx-evt">${escape(evidence.title)}</span>${ownerTag('mine', 'INVESTIGATOR', model.disclosedEvidenceIds.has(evidence.clueId) ? 'shared-before' : 'private', tr)}</span>
      <span class="bpa-cx-evgo">${tr('Propose', 'Đề xuất')}${bpaIcons.arrow}</span>
    </button></li>`).join('');
  return `<section class="bpa-cx-pick" aria-label="${tr('Your evidence', 'Chứng cứ của bạn')}">
      <span class="bpa-pin" aria-hidden="true"></span>
      <div class="bpa-cx-cardhead"><p class="bpa-cx-kick">${tr('EVIDENCE', 'CHỨNG CỨ')}</p><b class="bpa-cx-mini">${tr('YOURS', 'CỦA BẠN')}</b></div>
      <p class="bpa-cx-note">${tr('Pick one private piece of evidence to propose.', 'Chọn một chứng cứ riêng để đề xuất.')}</p>
      ${model.privateEvidence.length
        ? `<ul class="bpa-cx-evlist">${list}</ul>`
        : `<p class="bpa-cf-empty">${tr('Inspect the scene to add private physical evidence.', 'Khám nghiệm hiện trường để thêm chứng cứ vật lý riêng.')}</p>`}
    </section>`;
}

function pendingSlot(kind: 'testimony' | 'evidence', tr: Translate): string {
  return `<section class="bpa-cx-pending" aria-label="${tr('Waiting for a proposal', 'Đang chờ đề xuất')}">
      <p class="bpa-cx-kick">${kind === 'testimony' ? tr('TESTIMONY', 'LỜI KHAI') : tr('EVIDENCE', 'CHỨNG CỨ')}</p>
      <p>${tr('Not proposed yet.', 'Chưa có đề xuất.')}</p>
    </section>`;
}

function confirmationSlot(label: string, initials: string, tone: 'me' | 'partner', done: boolean, status: string, waiting: boolean): string {
  return `<div class="bpa-cx-slot${done ? ' is-confirmed' : ''}">
      <b class="bpa-cx-mark" aria-hidden="true">${done ? '✓' : '○'}</b> <div class="bpa-cx-who"><b class="bpa-cx-mini">${label}</b><i class="bpa-cx-st">${status}${waiting ? '<em class="bpa-dots" aria-hidden="true"><i></i><i></i><i></i></em>' : ''}</i></div>
      ${bpaMono(initials, tone)}
    </div>`;
}

export function renderJointReviewPanel(
  model: PairedConfrontationViewModel,
  escape: Escape,
  tr: Translate,
  context?: CaseFileRenderContext,
): string {
  const ctx = fallbackContext(escape, tr, context);
  const active = model.active;
  const people = ctx.people;
  const fmt = ctx.formatTime ?? (() => '');
  let main = '';

  if (!active) {
    main = `<section class="bpa-cx-idle">
      <div class="bpa-cx-idlecard">
        <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
        <p class="bpa-cx-kick">${tr('CRACK THE LIE', 'PHÁ VỠ LỜI DỐI')}</p>
        <h3 class="bpa-cx-h3">${tr('No active confrontation', 'Chưa có đối chất')}</h3>
        <p>${tr('The Interrogator starts by proposing one private testimony fragment.', 'Thẩm vấn viên bắt đầu bằng cách đề xuất một đoạn lời khai riêng.')}</p>
        ${model.canStart
          ? `<button class="bpa-btn bpa-btn--red" type="button" data-case-goto="testimony">${tr('Pick a testimony', 'Chọn lời khai')}${bpaIcons.arrow}</button>`
          : `<p class="bpa-cx-note">${tr('When your partner proposes a testimony, answer it with your evidence.', 'Khi đồng đội đề xuất lời khai, hãy đáp lại bằng chứng cứ của bạn.')}</p>`}
      </div>
    </section>`;
  } else {
    const isReview = model.phase !== 'COLLECTING';
    const headline = isReview
      ? tr('Does this evidence crack the testimony?', 'Chứng cứ này có phá được lời khai?')
      : tr('Each detective proposes one private half of the pair.', 'Mỗi thám tử đề xuất một nửa riêng của cặp.');
    const cardOptions = (photoClass: string): CardOptions => ({
      escape, tr, viewerRole: model.role, people, photoClass, tagState: isReview ? 'shared' : 'private',
    });
    const testimonySide = active.testimony
      ? `<div class="bpa-cx-tcard"><span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>${testimonyCard(active.testimony, { ...cardOptions('v3-pair-photo'), witnessRole: active.testimony.characterId ? ctx.witnessRole?.(active.testimony.characterId) ?? '' : '' })}</div>`
      : model.role === 'INTERROGATOR'
        ? pendingSlot('testimony', tr)
        : sealedEnvelope('testimony', 'INTERROGATOR', active.partnerHasProposed, tr, people.partnerInitials);
    const evidenceSide = active.evidence
      ? evidenceCard(active.evidence, { ...cardOptions('v3-pair-photo'), sceneTitle: ctx.sceneTitle?.(active.evidence.sceneId) ?? '' })
      : model.role === 'INVESTIGATOR'
        ? evidencePicker(model, ctx)
        : sealedEnvelope('evidence', 'INVESTIGATOR', active.partnerHasProposed, tr, people.partnerInitials);

    const myProposal = model.role === 'INVESTIGATOR' ? active.evidence?.title : active.testimony?.text;
    const strip = isReview
      ? `<section class="bpa-cx-strip" aria-label="${tr('Pair confirmation', 'Xác nhận cặp')}">
          <div class="bpa-cx-striphead"><p class="bpa-cx-kick">${tr('CONFIRM THE PAIR', 'XÁC NHẬN CẶP')}</p><i>${tr('Both detectives must confirm the same revision.', 'Cả hai thám tử phải xác nhận cùng một phiên bản.')}</i></div>
          <div class="v3-confirmation-state bpa-cx-slots">
            ${confirmationSlot(tr('You', 'Bạn'), people.myInitials, 'me', active.confirmedByMe, active.confirmedByMe ? tr('Confirmed', 'Đã xác nhận') : tr('Not confirmed', 'Chưa xác nhận'), false)}
            ${confirmationSlot(tr('Partner', 'Đồng đội'), people.partnerInitials, 'partner', active.partnerConfirmed, active.partnerConfirmed ? tr('Confirmed', 'Đã xác nhận') : active.partnerConnected ? tr('Reviewing', 'Đang xem xét') : tr('Offline', 'Mất kết nối'), !active.partnerConfirmed && active.partnerConnected)}
          </div>
          ${model.phase === 'WAITING' && active.confirmedByMe ? `<p class="v3-waiting bpa-cx-status" role="status">${tr('Waiting for your partner to confirm this revision.', 'Đang chờ đồng đội xác nhận phiên bản này.')}</p>` : ''}
        </section>
        <div class="bpa-cx-actions v3-review-actions">
          <button class="bpa-btn bpa-btn--red" type="button" data-v3-confirm ${active.canConfirm ? '' : 'disabled'}>${bpaIcons.check}${tr('Confirm pair', 'Xác nhận cặp')}</button>
          <div class="bpa-cx-row2">
            ${active.canEdit ? `<button class="bpa-btn bpa-btn--ink" type="button" data-case-goto="${model.role === 'INVESTIGATOR' ? 'evidence' : 'testimony'}">${tr('Change proposal', 'Đổi đề xuất')}</button>` : ''}
            <button class="bpa-cx-cancel" type="button" data-v3-cancel ${active.canCancel ? '' : 'disabled'}>${tr('Cancel', 'Hủy')}</button>
          </div>
        </div>`
      : `<section class="bpa-cx-strip" aria-label="${tr('Private proposals', 'Đề xuất riêng')}">
          <div class="bpa-cx-striphead"><p class="bpa-cx-kick">${tr('PRIVATE PROPOSALS', 'ĐỀ XUẤT RIÊNG')}</p><i>${active.partnerHasProposed ? tr('Your partner has proposed. Your turn.', 'Đồng đội đã đề xuất — đến lượt bạn.') : tr('Waiting for the other role.', 'Đang chờ vai còn lại.')}</i></div>
          <div class="bpa-cx-slots">
            ${confirmationSlot(tr('You', 'Bạn'), people.myInitials, 'me', Boolean(myProposal), myProposal ? escape(myProposal) : tr('Not proposed yet', 'Chưa đề xuất'), false)}
            ${confirmationSlot(tr('Partner', 'Đồng đội'), people.partnerInitials, 'partner', active.partnerHasProposed, active.partnerHasProposed ? tr('Proposed', 'Đã đề xuất') : tr('Choosing', 'Đang chọn'), !active.partnerHasProposed)}
          </div>
        </section>
        <div class="bpa-cx-actions">
          ${active.canCancel ? `<button class="bpa-btn bpa-btn--ink" type="button" data-v3-cancel>${tr('Cancel attempt', 'Hủy lượt thử')}</button>` : ''}
        </div>`;

    main = `<section class="${isReview ? 'v3-joint-review ' : ''}bpa-cx-stage is-${isReview ? 'review' : 'propose'}" data-v3-active-attempt="${escape(active.attemptId)}">
      <header class="bpa-cx-head">
        <div class="bpa-cx-label"><span class="bpa-pin" aria-hidden="true"></span><p class="bpa-cx-kick is-gold">${tr('CRACK THE LIE', 'PHÁ VỠ LỜI DỐI')} · ${tr('REVISION', 'LƯỢT')} ${active.revision}</p><h3 class="bpa-cx-h">${isReview ? tr('JOINT REVIEW', 'CÙNG XEM XÉT') : tr('COLLECTING', 'ĐANG THU ĐỀ XUẤT')}</h3></div>
        <p class="bpa-cx-prompt">${headline}</p>
      </header>
      <div class="bpa-cx-board">
        <div class="bpa-cx-col">${testimonySide}</div>
        <div class="bpa-cx-mid">${magnifierSvg(`bpa-cx-${active.attemptId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`, isReview ? 'taut' : 'propose')}<p class="bpa-cx-q">${tr('Can this evidence break the testimony?', 'Chứng cứ này có phá được lời khai?')}</p></div>
        <div class="bpa-cx-col">${evidenceSide}</div>
      </div>
      <div class="bpa-cx-bottom">${strip}</div>
    </section>`;
  }

  const truths = model.resolvedTruths.filter((pair) => pair.status === 'RESOLVED_SHARED_TRUTH');
  const facts = truths.length
    ? `<section class="truth-recap bpa-cf-facts">
        <h3 class="bpa-cf-h3">${tr('What we have established', 'Sự thật đã xác lập')}</h3>
        <ul class="bpa-cf-factlist">${truths.map((pair) => {
          const reveals = pair.reveals.length ? pair.reveals : [{ clueId: '', title: pair.revealTitle || pair.evidence.title, content: pair.feedback || '', narrativeMeaning: '' }];
          return reveals.map((reveal) => `<li class="bpa-cf-fact">
            <span class="bpa-cf-factseal" aria-hidden="true">${bpaIcons.check}</span>
            <div><p class="bpa-cf-factname">${escape(reveal.title)}</p>${reveal.content ? `<p class="bpa-cf-factdesc">${escape(reveal.content)}</p>` : ''}${pair.revealTitle ? `<b class="bpa-cf-reveal">${escape(pair.revealTitle)}</b>` : ''}</div>
            <span class="bpa-cf-facttag">${tr('REV.', 'LƯỢT')} ${pair.revision}${fmt(pair.resolvedAt || pair.disclosedAt) ? ` · ${fmt(pair.resolvedAt || pair.disclosedAt)}` : ''}</span>
          </li>`).join('');
        }).join('')}</ul>
      </section>`
    : '';

  const history = [...model.attemptHistory, ...model.resolvedTruths]
    .sort((left, right) => Date.parse(right.resolvedAt || right.disclosedAt) - Date.parse(left.resolvedAt || left.disclosedAt));
  const statusLabel = (status: string) => status === 'RESOLVED_SHARED_TRUTH'
    ? tr('RESOLVED SHARED TRUTH', 'ĐÃ PHÁ VỠ LỜI DỐI')
    : status === 'ResolvedIncorrect'
      ? tr('PAIR REJECTED', 'CẶP CHƯA ĐÚNG')
      : status === 'ATTEMPT_DISCLOSED'
        ? tr('UNDER JOINT REVIEW', 'ĐANG CÙNG XEM XÉT')
        : escape(status.replaceAll('_', ' '));
  const historyMarkup = history.length === 0
    ? `<section class="bpa-cx-log is-empty"><span class="bpa-pin" aria-hidden="true"></span><p class="bpa-cx-kick">${tr('0 ATTEMPTS', '0 LƯỢT')}</p><h3 class="bpa-cx-h3">${tr('Shared attempts', 'Các lượt thử đã chia sẻ')}</h3><p class="bpa-cx-note">${tr('Pairs you put on the table together will be filed here.', 'Các cặp hai người cùng đưa ra sẽ được lưu ở đây.')}</p></section>`
    : `<section class="v3-shared-history bpa-cx-log"><span class="bpa-pin" aria-hidden="true"></span>
        <p class="bpa-cx-kick">${history.length} ${tr(history.length === 1 ? 'ATTEMPT' : 'ATTEMPTS', 'LƯỢT')}</p>
        <h3 class="bpa-cx-h3">${tr('Shared attempts', 'Các lượt thử đã chia sẻ')}</h3>
        <ol class="bpa-cx-tries">${history.map((pair) => {
          const resultClass = pair.status === 'RESOLVED_SHARED_TRUTH' ? 'win' : pair.status === 'ResolvedIncorrect' ? 'bad' : 'open';
          const isNow = active && pair.attemptId === active.attemptId && pair.revision === active.revision;
          return `<li class="v3-history-pair bpa-cx-try${pair.status === 'RESOLVED_SHARED_TRUTH' ? ' is-truth' : ''}${isNow ? ' is-now' : ''}">
            <div class="bpa-cx-tryhead"><b>${tr('REV.', 'LƯỢT')} ${pair.revision}</b><time>${fmt(pair.resolvedAt || pair.disclosedAt)}</time></div>
            <p class="bpa-cx-tryq">“${escape(pair.testimony.text)}”</p>
            <p class="bpa-cx-trye">${renderV3EvidencePhoto(pair.evidence, escape, 'v3-history-photo')}${bpaIcons.arrow}<strong>${escape(pair.evidence.title)}</strong></p>
            ${pair.feedback ? `<p class="bpa-cx-tryfb">${escape(pair.feedback)}</p>` : ''}
            <b class="bpa-cx-res is-${resultClass}">${statusLabel(pair.status)}</b>
          </li>`;
        }).join('')}</ol>
      </section>`;

  return `<div class="v3-review-panel bpa-cx${active ? ' has-active' : ''}">
    <div class="bpa-cx-main">${main}${facts}</div>
    <aside class="bpa-cx-side" aria-label="${tr('Shared attempts', 'Các lượt thử đã chia sẻ')}">${historyMarkup}</aside>
  </div>`;
}
