import { renderV3EvidencePhoto, type DisclosedPair, type PairedConfrontationState } from './pairedConfrontation.js';

type Escape = (value: string) => string;
type Translate = (english: string, vietnamese: string) => string;

export function renderCrackPayoff(
  pair: DisclosedPair | null,
  escape: Escape,
  tr: Translate,
  caseComplete = false,
): string {
  if (!pair) return '';
  const correct = pair.status === 'RESOLVED_SHARED_TRUTH';
  return `<div class="v3-crack-overlay ${correct ? 'is-correct' : 'is-incorrect'}" role="dialog" aria-modal="true" aria-live="assertive" aria-labelledby="v3-crack-title">
    <div class="v3-crack-stage">
      <span class="v3-crack-kicker">${correct ? tr('CRACK THE LIE', 'PHÁ VỠ LỜI DỐI') : tr('PAIR REJECTED', 'CẶP CHƯA ĐÚNG')}</span>
      <div class="v3-crack-pair">
        <article><span>${tr('TESTIMONY', 'LỜI KHAI')}</span><blockquote>${escape(pair.testimony.text)}</blockquote></article>
        <div class="v3-crack-stamp" aria-hidden="true">${correct ? 'CRACK' : '×'}</div>
        <article><span>${tr('EVIDENCE', 'CHỨNG CỨ')}</span>${renderV3EvidencePhoto(pair.evidence, escape, 'v3-crack-photo')}<h3>${escape(pair.evidence.title)}</h3><p>${escape(pair.evidence.inventoryDescription || pair.evidence.content)}</p></article>
      </div>
      <h2 id="v3-crack-title">${escape(correct ? pair.revealTitle || tr('The lie is broken', 'Lời dối trá đã bị phá') : tr('Not enough to break the statement', 'Chưa đủ để phá lời khai'))}</h2>
      ${pair.feedback ? `<p class="v3-crack-feedback">${escape(pair.feedback)}</p>` : ''}
      ${correct ? pair.reveals.map((reveal) => `<div class="v3-shared-reveal"><strong>${escape(reveal.title)}</strong><p>${escape(reveal.content)}</p></div>`).join('') : ''}
      <button class="btn btn-gold" id="v3-crack-dismiss" type="button">${caseComplete
        ? tr('View case result', 'Xem kết quả vụ án')
        : tr('Continue', 'Tiếp tục')}</button>
    </div>
  </div>`;
}

export function renderV3CaseComplete(
  complete: boolean,
  truth: DisclosedPair | null,
  escape: Escape,
  tr: Translate,
): string {
  if (!complete) return '';
  const reveal = truth?.reveals?.[0];
  return `<div class="v3-case-complete-overlay" role="dialog" aria-modal="true" aria-labelledby="v3-complete-title">
    <section class="v3-case-complete-card">
      <span class="v3-crack-kicker">${tr('INVESTIGATION COMPLETE', 'ĐIỀU TRA HOÀN TẤT')}</span>
      <h2 id="v3-complete-title">${tr('Case complete', 'Vụ án đã hoàn tất')}</h2>
      <p>${tr(
        'Both detectives confirmed the contradiction and established a shared truth. There are no more required actions in this sandbox.',
        'Cả hai điều tra viên đã xác nhận mâu thuẫn và thiết lập sự thật chung. Sandbox này không còn hành động bắt buộc nào.',
      )}</p>
      ${truth?.revealTitle ? `<strong class="v3-complete-truth">${escape(truth.revealTitle)}</strong>` : ''}
      ${reveal ? `<div class="v3-shared-reveal"><strong>${escape(reveal.title)}</strong><p>${escape(reveal.content)}</p></div>` : ''}
      <div class="v3-complete-actions">
        <button class="btn btn-ghost" id="v3-complete-review" type="button">${tr('Review the solved pair', 'Xem lại cặp đã phá')}</button>
        <a class="btn btn-gold" id="v3-complete-exit" href="#/cases">${tr('Exit to case list', 'Thoát về danh sách vụ án')}</a>
      </div>
    </section>
  </div>`;
}

export function newestTerminalPair(state: PairedConfrontationState): DisclosedPair | null {
  const pairs = [
    ...(state.sharedKnowledge?.attemptHistory ?? []).filter((pair) => pair.status === 'ResolvedIncorrect'),
    ...(state.sharedKnowledge?.resolvedTruths ?? []).filter((pair) => pair.status === 'RESOLVED_SHARED_TRUTH'),
  ];
  return pairs.sort((left, right) =>
    Date.parse(right.resolvedAt || right.disclosedAt) - Date.parse(left.resolvedAt || left.disclosedAt))[0] ?? null;
}
