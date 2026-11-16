import '../../../css/55-tutorial.css';
import {
  ROLE_BUTTON_SELECTORS, TUTORIAL_STEPS, needsRoleSwitch, nextStepIndex, tutorialRoleName, tutorialSnapshot,
  type TutorialEvent, type TutorialSnapshot, type TutorialTarget,
} from './tutorialSteps';

type Tr = (en: string, vi: string) => string;
type Point = { x: number; y: number };

export type TutorialCoachOptions = {
  roomId: string;
  tr: Tr;
  escapeHtml: (value: string) => string;
  /** Page coordinates of a runtime point of the scene on screen (null while the scene is not drawn). */
  project: (point: Point) => Point | null;
  /** Local detective position in runtime units (null before the first pose). */
  pose: () => Point | null;
  /** Leaves the finished tutorial for the menu. */
  onLeave: () => void;
};

export type TutorialCoach = {
  update(state: Parameters<typeof tutorialSnapshot>[0], uiKind: string): void;
  report(event: TutorialEvent): void;
  destroy(): void;
  /** Read by the end-to-end tests. */
  current(): { index: number; id: string; total: number };
};

const STORE_PREFIX = 'sirlocked.tutorial.v1.';

/**
 * The tutorial coach: a card with the current step and a gold pointer on the thing to press. It lives in
 * document.body (the game page redraws its own root often) and follows the target every 250 ms, because the
 * camera scrolls and modals open and close.
 */
export function createTutorialCoach(options: TutorialCoachOptions): TutorialCoach {
  const { tr, escapeHtml } = options;
  const steps = TUTORIAL_STEPS;
  const key = `${STORE_PREFIX}${options.roomId}`;
  const saved = readSaved(key);
  let index = saved.index;
  const manualDone = new Set<string>(saved.manual);
  const events = new Set<TutorialEvent>(saved.events);
  let collapsed = false;
  let lastState: Parameters<typeof tutorialSnapshot>[0] = null;
  let uiKind = 'EXPLORE';
  let startPose: Point | null = null;
  let destroyed = false;

  const card = document.createElement('aside');
  card.className = 'tt-coach';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.dataset.testid = 'tutorial-coach';
  const pointer = document.createElement('div');
  pointer.className = 'tt-pointer';
  pointer.setAttribute('aria-hidden', 'true');
  pointer.innerHTML = '<span class="tt-ring"></span><span class="tt-arrow">▼</span>';
  pointer.hidden = true;
  document.body.append(card, pointer);

  card.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-tt-next]')) {
      const step = steps[index];
      if (step?.manual) manualDone.add(step.id);
      advance();
    } else if (target.closest('[data-tt-toggle]')) {
      collapsed = !collapsed;
      paint();
    } else if (target.closest('[data-tt-leave]')) {
      options.onLeave();
    }
  });

  // Page events the server cannot see: the HUD buttons are watched at the capture stage, before the page redraws.
  const onClick = (event: Event) => {
    const element = event.target as HTMLElement | null;
    if (!element?.closest) return;
    if (element.closest('#hint-btn')) report('hint');
  };
  document.addEventListener('click', onClick, true);

  const timer = window.setInterval(() => {
    if (destroyed) return;
    const pose = options.pose();
    if (pose) {
      if (!startPose) startPose = pose;
      else if (!events.has('moved') && Math.hypot(pose.x - startPose.x, pose.y - startPose.y) > 48) report('moved');
    }
    placePointer();
  }, 250);

  function snapshot(): TutorialSnapshot {
    return tutorialSnapshot(lastState, uiKind, events);
  }

  function save() {
    try {
      localStorage.setItem(key, JSON.stringify({ index, manual: [...manualDone], events: [...events] }));
    } catch { /* progress is also rebuilt from the game state */ }
  }

  function advance() {
    const next = nextStepIndex(steps, index, snapshot(), manualDone);
    if (next !== index) {
      index = next;
      collapsed = false;
      save();
    }
    paint();
  }

  function report(event: TutorialEvent) {
    if (events.has(event)) return;
    events.add(event);
    save();
    advance();
  }

  function paint() {
    if (destroyed) return;
    const total = steps.length;
    if (index >= total) {
      card.className = 'tt-coach is-done';
      card.innerHTML = `
        <p class="tt-kicker">${escapeHtml(tr('Tutorial', 'Màn tân thủ'))} · ${escapeHtml(tr('done', 'hoàn thành'))}</p>
        <h3 class="tt-title">${escapeHtml(tr('Case closed!', 'Phá án xong!'))}</h3>
        <p class="tt-text">${escapeHtml(tr('You have played both detectives. In a real case you and your partner each keep one role for the whole case, so work together.', 'Bạn đã chơi thử cả Sherlock lẫn Watson. Vào vụ thật, bạn và đồng đội mỗi người giữ một vai suốt vụ án, không đổi được, nên phải phối hợp. Giờ hãy tìm đồng đội và nhận vụ án thật.'))}</p>
        <div class="tt-actions"><button type="button" class="bpa-btn bpa-btn--red bpa-btn--sm" data-tt-leave>${escapeHtml(tr('Back to the menu', 'Về sảnh'))}</button></div>`;
      pointer.hidden = true;
      return;
    }
    const step = steps[index];
    const now = snapshot();
    const switchNeeded = needsRoleSwitch(step, now);
    card.className = `tt-coach${collapsed ? ' is-collapsed' : ''}${switchNeeded ? ' needs-role' : ''}`;
    card.dataset.step = step.id;
    card.dataset.role = now.role;
    card.innerHTML = `
      <div class="tt-head">
        <p class="tt-kicker">${escapeHtml(tr('Tutorial', 'Màn tân thủ'))} · ${escapeHtml(tr('step', 'bước'))} ${index + 1}/${total}${now.role ? ` · <span class="tt-role-chip" data-tt-role="${escapeHtml(now.role)}">${escapeHtml(tr('playing', 'đang là'))} ${escapeHtml(now.role === 'INVESTIGATOR' ? 'Watson' : 'Sherlock')}</span>` : ''}</p>
        <button type="button" class="tt-toggle" data-tt-toggle aria-expanded="${!collapsed}">${escapeHtml(collapsed ? tr('Show', 'Hiện') : tr('Hide', 'Ẩn'))}</button>
      </div>
      <div class="tt-progress" aria-hidden="true"><span style="width:${Math.round((index / total) * 100)}%"></span></div>
      <h3 class="tt-title">${escapeHtml(step.title)}</h3>
      ${collapsed ? '' : `<p class="tt-text">${escapeHtml(step.text)}</p>`}
      ${switchNeeded && step.role ? `<p class="tt-role-need" data-testid="tutorial-role-need">${escapeHtml(tr(
        `This step needs ${step.role === 'INVESTIGATOR' ? 'Watson' : 'Sherlock'}. Press "Switch detective" (key Q).`,
        `Bước này cần ${tutorialRoleName(step.role)}. Bạn đang là ${tutorialRoleName(now.role)}: bấm Đổi nhân vật (phím Q).`))}</p>` : ''}
      ${step.manual && !collapsed ? `<div class="tt-actions"><button type="button" class="bpa-btn bpa-btn--red bpa-btn--sm" data-tt-next>${escapeHtml(index === 0 ? tr('Start', 'Bắt đầu') : tr('Next', 'Tiếp'))}</button></div>` : ''}`;
    placePointer();
  }

  function placePointer() {
    if (destroyed) return;
    const step = steps[index];
    const now = snapshot();
    // Even with the card hidden, a step that needs the other detective keeps pointing at the switch button.
    const target = !step ? null
      : needsRoleSwitch(step, now) ? { kind: 'dom' as const, selectors: ROLE_BUTTON_SELECTORS }
        : collapsed ? null : step.target(now);
    const point = target ? locate(target) : null;
    if (!point) {
      pointer.hidden = true;
      return;
    }
    pointer.hidden = false;
    pointer.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px)`;
  }

  function locate(target: TutorialTarget): Point | null {
    if (target.kind === 'world') {
      if (lastState?.currentSceneId && target.sceneId !== lastState.currentSceneId) return null;
      const point = options.project({ x: target.x, y: target.y });
      if (!point || point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight) return null;
      return point;
    }
    for (const selector of target.selectors) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const box = element.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        if (getComputedStyle(element).visibility === 'hidden') continue;
        return { x: box.left + box.width / 2, y: box.top };
      }
    }
    return null;
  }

  paint();

  return {
    update(state, nextUiKind) {
      lastState = state;
      uiKind = nextUiKind;
      if (nextUiKind === 'CASE_FILE') report('caseFile');
      else if (nextUiKind === 'INVENTORY') report('bag');
      else if (nextUiKind === 'CAMERA') report('camera');
      advance();
    },
    report,
    destroy() {
      destroyed = true;
      window.clearInterval(timer);
      document.removeEventListener('click', onClick, true);
      card.remove();
      pointer.remove();
    },
    current: () => ({ index, id: steps[index]?.id ?? 'done', total: steps.length }),
  };
}

function readSaved(key: string): { index: number; manual: string[]; events: TutorialEvent[] } {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return {
      index: Number.isInteger(value?.index) ? value.index : 0,
      manual: Array.isArray(value?.manual) ? value.manual.filter((item: unknown) => typeof item === 'string') : [],
      events: Array.isArray(value?.events) ? value.events.filter((item: unknown) => typeof item === 'string') : [],
    };
  } catch {
    return { index: 0, manual: [], events: [] };
  }
}
