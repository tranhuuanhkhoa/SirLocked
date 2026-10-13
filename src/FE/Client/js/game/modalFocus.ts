type FocusMemory = { id?: string; selector?: string; index: number };

function controls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]')]
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden], [inert]')
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

/** Identify a focused choice before a DOM redraw without retaining its detached node. */
export function rememberFocusedControl(root: HTMLElement): FocusMemory | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || !root.contains(element)) return null;
  const action = [...element.attributes].find((attribute) => attribute.name.startsWith('data-')
    && attribute.name !== 'data-events-bound');
  return { id: element.id || undefined,
    selector: action ? `[${action.name}="${CSS.escape(action.value)}"]` : undefined,
    index: controls(root).indexOf(element) };
}

export function restoreFocusedControl(root: HTMLElement, memory: FocusMemory | null, fallback?: string): boolean {
  if (!memory) return false;
  const available = controls(root);
  const target = (memory.id ? root.querySelector<HTMLElement>(`#${CSS.escape(memory.id)}`) : null)
    ?? (memory.selector ? root.querySelector<HTMLElement>(memory.selector) : null)
    ?? (fallback ? root.querySelector<HTMLElement>(fallback) : available[memory.index]);
  if (!target || !available.includes(target)) return false;
  target.focus({ preventScroll: true });
  return true;
}

/** DOM modal focus only. Gameplay owns Escape, back actions and scene input gates. */
export function createModalFocusManager(root: HTMLElement) {
  let active: HTMLElement | null = null;
  let activeKey = '';
  let returnElement: HTMLElement | null = null;
  let returnId = '';
  let lastControl: FocusMemory | null = null;
  let disposed = false;
  let headingId = 0;
  const inerted = new Map<HTMLElement, boolean>();
  const selectors = ['.comic-overlay', '.vn-overlay', '.v3-crack-overlay', '.v3-case-complete-overlay',
    '.overlay:not(.is-closing-shield)', '.case-file-drawer', '.inventory-drawer'];
  const visible = (element: HTMLElement) => !element.closest('[hidden], .is-closing-shield')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  function releaseInert() {
    for (const [element, previous] of inerted) element.inert = previous;
    inerted.clear();
  }
  function isolate(layer: HTMLElement) {
    let branch: HTMLElement = layer;
    while (branch.parentElement && branch !== root) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        if (!inerted.has(sibling)) inerted.set(sibling, sibling.inert);
        sibling.inert = true;
      }
      branch = branch.parentElement;
    }
  }
  function focusInitial(layer: HTMLElement) {
    const preferred = layer.querySelector<HTMLElement>('[data-modal-autofocus], [autofocus]');
    const heading = layer.querySelector<HTMLElement>('h2, h3');
    if (heading) heading.tabIndex = -1;
    (preferred ?? heading ?? controls(layer)[0] ?? layer).focus({ preventScroll: true });
  }
  const focusChanged = () => {
    if (active?.isConnected && active.contains(document.activeElement)) lastControl = rememberFocusedControl(active);
  };
  root.addEventListener('focusin', focusChanged);
  return {
    sync() {
      if (disposed) return;
      releaseInert();
      const next = selectors.map((selector) => [...root.querySelectorAll<HTMLElement>(selector)].reverse().find(visible))
        .find(Boolean) ?? null;
      const nextKey = next ? next.dataset.modalKey || next.id || `${next.classList.contains('inventory-drawer') ? 'inventory' : next.classList.contains('case-file-modal') ? 'case-file' : 'overlay'}:${next.querySelector('h2, h3')?.textContent ?? ''}` : '';
      if (!next) {
        const previous = active;
        active = null; activeKey = ''; lastControl = null;
        if (previous && (!document.activeElement || document.activeElement === document.body || previous.contains(document.activeElement))) {
          const target = returnId ? document.getElementById(returnId) : returnElement;
          if (target?.isConnected) target.focus({ preventScroll: true });
        }
        returnElement = null; returnId = '';
        return;
      }
      const newModal = nextKey !== activeKey;
      if (!active) {
        const focused = document.activeElement;
        returnElement = focused instanceof HTMLElement && focused !== document.body ? focused : root.querySelector('canvas');
        returnId = returnElement?.id ?? '';
        if (returnElement instanceof HTMLCanvasElement) returnElement.tabIndex = 0;
      }
      active = next; activeKey = nextKey;
      next.setAttribute('role', 'dialog'); next.setAttribute('aria-modal', 'true'); next.tabIndex = -1;
      if (!next.hasAttribute('aria-label') && !next.hasAttribute('aria-labelledby')) {
        const heading = next.querySelector<HTMLElement>('h2, h3');
        if (heading) { heading.id ||= `sirlocked-modal-heading-${++headingId}`; next.setAttribute('aria-labelledby', heading.id); }
      }
      isolate(next);
      if (!next.contains(document.activeElement)) {
        if (newModal || !restoreFocusedControl(next, lastControl)) focusInitial(next);
      }
      lastControl = rememberFocusedControl(next);
    },
    handleKey(event: KeyboardEvent) {
      if (disposed || event.key !== 'Tab' || !active?.isConnected) return false;
      const available = controls(active);
      const first = available[0], last = available.at(-1);
      if (!first) { event.preventDefault(); active.focus(); return true; }
      if (!available.includes(document.activeElement as HTMLElement)
        || event.shiftKey && document.activeElement === first
        || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return true;
      }
      return false;
    },
    dispose() {
      disposed = true; releaseInert(); root.removeEventListener('focusin', focusChanged);
      active = null; returnElement = null; lastControl = null;
    },
  };
}
