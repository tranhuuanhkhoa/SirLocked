import {
  bpaIcons,
  evidenceCard,
  magnifierSvg,
  testimonyCard,
  type DisclosedPair,
  type PairedConfrontationState,
} from './pairedConfrontation.js';

type Escape = (value: string) => string;
type Translate = (english: string, vietnamese: string) => string;

/**
 * The payoff is redrawn with the rest of the game; a redraw of the pair already on
 * screen keeps its final frame instead of replaying the tear and the stamp.
 */
function alreadyShown(selector: string, key: string): boolean {
  return typeof document !== 'undefined' && document.querySelector<HTMLElement>(selector)?.dataset.pairKey === key;
}

/** Torn testimony seam, shared by both halves so they fit back together. */
const TEAR = '58.4,0 61.5,7.1 56.5,14.3 59.6,21.4 54.7,28.6 57.8,35.7 52.8,42.9 55.9,50 51,57.1 54,64.3 49.1,71.4 52.2,78.6 47.3,85.7 50.3,92.9 45.4,100';

export function renderCrackPayoff(
  pair: DisclosedPair | null,
  escape: Escape,
  tr: Translate,
  caseComplete = false,
): string {
  if (!pair) return '';
  const correct = pair.status === 'RESOLVED_SHARED_TRUTH';
  const key = `${pair.attemptId}:${pair.revision}:${pair.status}`;
  const settled = alreadyShown('.v3-crack-overlay', key);
  const cardOptions = { escape, tr, viewerRole: null, tagState: 'shared' as const };
  const testimony = testimonyCard(pair.testimony, cardOptions);
  const title = correct
    ? pair.revealTitle || tr('The lie is broken', 'Lời dối trá đã bị phá')
    : tr('Not enough to break the statement', 'Chưa đủ để phá lời khai');
  const stamp = correct
    ? `<span>${tr('LIE', 'PHÁ VỠ')}</span><span>${tr('CRACKED', 'LỜI DỐI')}</span>`
    : `<span>${tr('PAIR', 'CẶP')}</span><span>${tr('REJECTED', 'CHƯA ĐÚNG')}</span>`;

  return `<div class="v3-crack-overlay bpa-ck ${correct ? 'is-correct' : 'is-incorrect'}${settled ? ' is-settled' : ''}" data-pair-key="${escape(key)}" role="dialog" aria-modal="true" aria-live="assertive" aria-labelledby="v3-crack-title">
    <div class="v3-crack-stage bpa-ck-sheet">
      <div class="bpa-ck-tabrow" aria-hidden="true"><span class="bpa-ck-ftab">${tr('CASE FILE', 'HỒ SƠ VỤ ÁN')}<i></i>${tr('CRACK THE LIE', 'PHÁ VỠ LỜI DỐI')}</span></div>
      <div class="bpa-ck-leaf">
        <header class="bpa-cx-head">
          <div class="bpa-cx-label"><span class="bpa-pin" aria-hidden="true"></span><p class="bpa-cx-kick is-gold">${tr('CRACK THE LIE', 'PHÁ VỠ LỜI DỐI')} · ${tr('REVISION', 'LƯỢT')} ${pair.revision}</p><p class="bpa-cx-h">${tr('JOINT REVIEW', 'CÙNG XEM XÉT')}</p></div>
          <p class="bpa-cx-prompt">${correct
            ? tr('Both detectives confirmed the pair. The evidence breaks the testimony.', 'Hai thám tử đã xác nhận cặp. Chứng cứ phá được lời khai.')
            : tr('Both detectives confirmed the pair, but it does not break the testimony.', 'Hai thám tử đã xác nhận cặp, nhưng chứng cứ chưa phá được lời khai.')}</p>
        </header>
        <div class="bpa-cx-board bpa-ck-board">
          <div class="bpa-cx-col">
            <div class="bpa-cx-tcard bpa-ck-tcard">
              <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
              <div class="bpa-ck-piece is-a">${testimony}</div>
              ${correct ? `<div class="bpa-ck-piece is-b" aria-hidden="true">${testimony}</div>
              <svg class="bpa-ck-fiber" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="${TEAR}"/></svg>` : ''}
            </div>
          </div>
          <div class="bpa-cx-mid">
            ${magnifierSvg('bpa-ck', correct ? 'won' : 'cut')}
            <div class="bpa-ck-bigwrap">${correct ? '<span class="bpa-ck-ring" aria-hidden="true"></span>' : ''}<b class="v3-crack-stamp bpa-ck-bigstamp${correct ? '' : ' is-dull'}" aria-hidden="true">${stamp}</b></div>
          </div>
          <div class="bpa-cx-col">${evidenceCard(pair.evidence, { ...cardOptions, photoClass: 'v3-crack-photo' })}</div>
        </div>
        <div class="bpa-ck-result">
          <div class="bpa-ck-lead">
            <p class="bpa-cx-kick v3-crack-kicker">${correct ? tr('CRACK THE LIE', 'PHÁ VỠ LỜI DỐI') : tr('PAIR REJECTED', 'CẶP CHƯA ĐÚNG')} · ${tr('REVISION', 'LƯỢT')} ${pair.revision}</p>
            <h2 class="bpa-ck-hl" id="v3-crack-title">${escape(title)}</h2>
            ${correct ? `<p class="bpa-ck-sub">${pair.feedback ? escape(pair.feedback) : tr('The lie is broken', 'Lời dối trá đã bị phá')}</p>` : ''}
            <div class="bpa-ck-endrow">
              <p class="bpa-ck-both"><b class="bpa-mono is-me is-sm" aria-hidden="true">✓</b><b class="bpa-mono is-partner is-sm" aria-hidden="true">✓</b>${tr('YOU AND YOUR PARTNER CONFIRMED', 'BẠN VÀ ĐỒNG ĐỘI ĐÃ XÁC NHẬN')}</p>
              <button class="bpa-btn bpa-btn--red" id="v3-crack-dismiss" type="button">${caseComplete
                ? tr('View case result', 'Xem kết quả vụ án')
                : tr('Continue', 'Tiếp tục')}${bpaIcons.arrow}</button>
            </div>
          </div>
          ${correct
            ? `<div class="bpa-ck-facts"><p class="bpa-cx-kick">${tr('ESTABLISHED TRUTH', 'SỰ THẬT ĐÃ XÁC LẬP')}</p>${pair.reveals.map((reveal) => `<article class="v3-shared-reveal bpa-ck-fact">
                <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
                <b class="bpa-ck-factstamp" aria-hidden="true">${tr('NEW', 'MỚI')}</b>
                <h3 class="bpa-ck-ft">${escape(reveal.title)}</h3>
                <p class="bpa-ck-fd">${escape(reveal.content)}</p>
              </article>`).join('')}</div>`
            : `<aside class="bpa-ck-hint" aria-label="${tr('Hint', 'Gợi ý')}">
                <span class="bpa-tape-bit" aria-hidden="true"></span>
                <p class="bpa-cx-kick">${bpaIcons.bulb}${tr('HINT', 'GỢI Ý')}</p>
                <p class="v3-crack-feedback">${pair.feedback ? escape(pair.feedback) : tr('Pick a trace that speaks to exactly what the witness claimed.', 'Hãy chọn dấu vết nói đúng vào điều nhân chứng đã khẳng định.')}</p>
              </aside>`}
        </div>
      </div>
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
  const key = truth ? `${truth.attemptId}:${truth.revision}` : 'complete';
  const settled = alreadyShown('.v3-case-complete-overlay', key);
  return `<div class="v3-case-complete-overlay bpa-ck-done${settled ? ' is-settled' : ''}" data-pair-key="${escape(key)}" role="dialog" aria-modal="true" aria-labelledby="v3-complete-title">
    <section class="v3-case-complete-card bpa-ck-donecard">
      <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
      <p class="bpa-cx-kick is-gold">${tr('INVESTIGATION COMPLETE', 'ĐIỀU TRA HOÀN TẤT')}</p>
      <h2 id="v3-complete-title">${tr('Case complete', 'Vụ án đã hoàn tất')}</h2>
      <p>${tr(
        'Both detectives confirmed the contradiction and established a shared truth. There are no more required actions in this sandbox.',
        'Cả hai điều tra viên đã xác nhận mâu thuẫn và thiết lập sự thật chung. Sandbox này không còn hành động bắt buộc nào.',
      )}</p>
      ${truth?.revealTitle ? `<strong class="v3-complete-truth">${escape(truth.revealTitle)}</strong>` : ''}
      ${reveal ? `<div class="v3-shared-reveal bpa-ck-fact"><h3 class="bpa-ck-ft">${escape(reveal.title)}</h3><p class="bpa-ck-fd">${escape(reveal.content)}</p></div>` : ''}
      <div class="v3-complete-actions">
        <button class="bpa-btn bpa-btn--gold" id="v3-complete-review" type="button">${tr('Review the solved pair', 'Xem lại cặp đã phá')}</button>
        <a class="bpa-btn bpa-btn--red" id="v3-complete-exit" href="#/cases">${tr('Exit to case list', 'Thoát về danh sách vụ án')}${bpaIcons.arrow}</a>
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
