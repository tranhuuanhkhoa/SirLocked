import '../../../css/44-case-wall.css';
import { initials } from '../utils/dom.js';
import { WALL_SPRITE } from './openCoopWallArt';
import type { DisclosedPair } from './pairedConfrontation';
import type { OpenCoopEvidence, OpenCoopTestimony } from './openCoopCaseFile';

/**
 * Open co-op case file in the "Hồ sơ vụ án mới" style.
 * - renderOpenCoopShell: cork wall shell (case label, folder tabs, team chips, footer status + legend);
 * - createCaseWall: tab 01 "Sơ đồ vụ án — ghép ảnh & lời khai". Everything the team found sits in the
 *   shared envelope; drag (or tap / Enter, then pick a column) to pin each statement on the person who
 *   said it and each piece of evidence on the person it points to. The server judges every pin, so the
 *   wall stays the same for both detectives. Red strings join pinned cards: the person to the middle
 *   card, cracked lies to the evidence that broke them, and the case's own labelled strings.
 *
 * The game page re-renders its overlay on every state push, so the wall keeps its UI state (held card,
 * drag, scroll, first-seen times for animations) here and re-binds after each render.
 */

type Translate = (en: string, vi: string) => string;
type Escape = (value: unknown) => string;

export type BoardCenter = { targetId: string; characterId?: string | null; kicker: string; title: string; subtitle: string; imageUrl?: string; statementTotal: number; evidenceTotal: number };
export type BoardColumn = { targetId: string; name: string; role: string; kind: string; imageUrl?: string; statementTotal: number; evidenceTotal: number };
export type BoardPin = { itemId: string; kind: string; targetId: string };
export type BoardLink = { fromId: string; toId: string; label: string };
export type BoardView = {
  summary: string;
  center: BoardCenter;
  columns: BoardColumn[];
  pins: BoardPin[];
  envelope: string[];
  links: BoardLink[];
  wrongCount: number;
  totalItems: number;
};

export type WallPlayer = { userId: string; username: string; role?: string | null };

export type WallData = {
  tr: Translate;
  escape: Escape;
  meId: string;
  players: WallPlayer[];
  evidence: OpenCoopEvidence[];
  testimonies: OpenCoopTestimony[];
  /** Lies cracked by the team (RESOLVED_SHARED_TRUTH). */
  cracked: DisclosedPair[];
  /** The Crack the Lie draft under discussion, if any. */
  draft: { testimonyId?: string | null; evidenceId?: string | null } | null;
  newIds: Set<string>;
  sceneTitle: (sceneId: string) => string;
  evidencePhoto: (evidence: OpenCoopEvidence) => string;
};

export type WallStatus = { label: string; text: string; tone: 'info' | 'ok' | 'bad' };

type WallItem = {
  id: string;
  kind: 'say' | 'ev';
  code: string;
  title: string;
  text: string;
  speaker: string;
  finderId: string;
  finderRole: string;
  foundAt: string;
  puzzle: boolean;
  sceneId: string;
  meaning: string;
  canChallenge: boolean;
  evidence?: OpenCoopEvidence;
};

type Point = { x: number; y: number };
type YarnSpec = { key: string; cls: 'rel' | 'th' | 'cy' | 'ln'; from: string; to: string; label?: string; tag?: 'mt' | '' };

const JUST_MS = 1400;
const INTRO_MS = 1500;
const HINT_MS = 9000;

let spriteReady = false;
function ensureSprite() {
  if (spriteReady || typeof document === 'undefined') return;
  if (!document.getElementById('ocw-sprite')) {
    const holder = document.createElement('div');
    holder.innerHTML = `<svg id="ocw-sprite" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${WALL_SPRITE}</svg>`;
    document.body.appendChild(holder.firstElementChild!);
  }
  spriteReady = true;
}

/** Picks a drawing for a piece of evidence from its title (falls back to a magnifier over a jar). */
export function wallArtFor(title: string): string {
  const t = title.toLocaleLowerCase('vi');
  const rules: Array<[RegExp, string]> = [
    [/vân tay|dấu tay/, 'ocw-a-print'],
    [/trâm|nhẫn|ngọc|vòng|dây chuyền/, 'ocw-a-ring'],
    [/phim|ảnh|chụp|âm bản/, 'ocw-a-film'],
    [/tủ kính|tủ|két|hòm/, 'ocw-a-cabinet'],
    [/cuống|phiếu cầm/, 'ocw-a-pawn'],
    [/biên nhận|hóa đơn|biên lai|phiếu/, 'ocw-d-receipt'],
    [/thư|lá thư|bức thư/, 'ocw-a-letter'],
    [/sổ/, 'ocw-a-ledger'],
    [/sách|nhật ký/, 'ocw-a-book'],
    [/hợp đồng|di chúc|giấy|mảnh|văn bản/, 'ocw-a-will'],
    [/lọ|chai|thuốc|bột/, 'ocw-a-vial'],
  ];
  return rules.find(([pattern]) => pattern.test(t))?.[1] ?? 'ocw-a-glue';
}

const roleClass = (role?: string | null) => (role === 'INVESTIGATOR' ? 'inv' : role === 'INTERROGATOR' ? 'int' : 'gd');
const roleName = (role?: string | null) => (role === 'INVESTIGATOR' ? 'Watson' : role === 'INTERROGATOR' ? 'Sherlock' : '');

function clock(iso?: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Statements L1…, puzzle evidence G1…, other evidence V1…, numbered in the order the team found them. */
function buildItems(data: WallData): Map<string, WallItem> {
  const byTime = <T extends { foundAt?: string | null }>(list: T[]) =>
    [...list].sort((a, b) => (Date.parse(a.foundAt ?? '') || 0) - (Date.parse(b.foundAt ?? '') || 0));
  const items = new Map<string, WallItem>();
  const roleOf = (userId?: string) => data.players.find((player) => player.userId === userId)?.role ?? '';
  byTime(data.testimonies).forEach((entry, index) => items.set(entry.testimonyFragmentId, {
    id: entry.testimonyFragmentId,
    kind: 'say',
    code: `L${index + 1}`,
    title: entry.characterName,
    text: entry.text,
    speaker: entry.characterName,
    finderId: entry.foundByUserId ?? '',
    finderRole: roleOf(entry.foundByUserId) || 'INTERROGATOR',
    foundAt: entry.foundAt ?? '',
    puzzle: false,
    sceneId: '',
    meaning: '',
    canChallenge: entry.canChallenge !== false,
  }));
  let puzzles = 0;
  let others = 0;
  byTime(data.evidence).forEach((entry) => {
    const puzzle = (entry.sourceType ?? '').toLowerCase() === 'puzzle';
    items.set(entry.clueId, {
      id: entry.clueId,
      kind: 'ev',
      code: puzzle ? `G${++puzzles}` : `V${++others}`,
      title: entry.title,
      text: entry.content,
      speaker: '',
      finderId: entry.foundByUserId ?? '',
      finderRole: entry.foundByRole || roleOf(entry.foundByUserId) || 'INVESTIGATOR',
      foundAt: entry.foundAt ?? '',
      puzzle,
      sceneId: entry.sceneId,
      meaning: entry.narrativeMeaning ?? '',
      canChallenge: false,
      evidence: entry,
    });
  });
  return items;
}

/* --------------------------------------------------------------------------------------------- */
/* Shell                                                                                          */
/* --------------------------------------------------------------------------------------------- */

export type ShellTab = { key: string; no: string; name: string; sub: string; dot?: boolean };

export function renderOpenCoopShell(o: {
  tr: Translate;
  escape: Escape;
  caseTitle: string;
  place: string;
  section: string;
  tabs: ShellTab[];
  accuse: { enabled: boolean; name: string; sub: string; reason: string };
  me: WallPlayer | null;
  partner: WallPlayer | null;
  body: string;
  status: WallStatus;
  opening: boolean;
  renderKey: string;
}): string {
  const { tr, escape } = o;
  const chip = (player: WallPlayer | null, mine: boolean) => {
    if (!player) return '';
    const cls = roleClass(player.role);
    const label = `${mine ? tr('YOU', 'BẠN') : escape(player.username)} · ${roleName(player.role) || tr('DETECTIVE', 'THÁM TỬ')}`;
    return `<span class="ocw-who ${cls === 'inv' ? 'is-inv' : 'is-int'}"><span class="ocw-mono ${cls}" aria-hidden="true">${escape(initials(player.username))}</span><span>${label}</span></span>`;
  };
  const tabs = o.tabs.map((tab) => {
    const selected = tab.key === o.section;
    return `<button type="button" class="ocw-tab" role="tab" id="ocw-tab-${tab.key}" aria-selected="${selected}" aria-controls="ocw-panel" data-case-tab="${tab.key}">
        <b>${escape(tab.no)}</b><span>${escape(tab.name)}</span><i>${escape(tab.sub)}</i>${tab.dot ? '<em class="ocw-dot" aria-hidden="true"></em>' : ''}</button>`;
  }).join('');
  const accuse = `<button type="button" class="ocw-tab is-accuse" id="case-file-accuse-btn" ${o.accuse.enabled ? '' : `aria-disabled="true" data-reason="${escape(o.accuse.reason)}"`}>
      <b>${tr('ACCUSE', 'CÁO BUỘC')}</b><span>${escape(o.accuse.name)}</span><i>${escape(o.accuse.sub)}</i></button>`;
  const legend = [
    ['#2f6363', tr('Evidence · Watson', 'Vật chứng · Watson')],
    ['#7a3f27', tr('Statements · Sherlock', 'Lời khai · Sherlock')],
    ['#c7a24b', tr('Puzzles · both', 'Giải đố · cả hai')],
    ['#fbf6ed', tr('Case record', 'Hồ sơ gốc')],
  ].map(([color, label]) => `<li><i style="background:${color}" aria-hidden="true"></i>${label}</li>`).join('');
  return `<div class="ocw-veil${o.opening ? ' is-opening' : ''}" aria-hidden="true"></div>
    <section class="case-file-drawer case-file-modal ocw${o.opening ? ' is-opening' : ''}" data-modal-key="case-file" data-case-section="${escape(o.section)}" data-render-key="${escape(o.renderKey)}" role="dialog" aria-modal="true" aria-labelledby="ocw-title">
      <header class="ocw-head">
        <div class="ocw-label"><span class="ocw-kick">${tr('CASE FILE · CO-OP', 'HỒ SƠ VỤ ÁN · HỢP TÁC')}</span><h2 id="ocw-title">${escape(o.caseTitle)}</h2>${o.place ? `<small>${escape(o.place)}</small>` : ''}</div>
        <div class="ocw-team">${chip(o.me, true)}${chip(o.partner, false)}
          <button type="button" class="close-drawer-btn ocw-close" aria-keyshortcuts="Escape">${tr('Close', 'Đóng')}<kbd aria-hidden="true">Esc</kbd></button></div>
        <nav class="ocw-nav" aria-label="${tr('Case file sections', 'Các mục hồ sơ')}"><div class="ocw-tabs" role="tablist">${tabs}${accuse}</div></nav>
      </header>
      <div class="ocw-body" id="ocw-panel" role="tabpanel" aria-labelledby="ocw-tab-${escape(o.section)}">${o.body}</div>
      <footer class="ocw-foot">
        <p class="ocw-status" role="status" aria-live="polite" data-tone="${o.status.tone}" data-ocw-status><b>${escape(o.status.label)}</b>${escape(o.status.text)}</p>
        <ul class="ocw-legend" aria-label="${tr('Colour key', 'Chú giải màu')}">${legend}</ul>
      </footer>
    </section>`;
}

/* --------------------------------------------------------------------------------------------- */
/* Wall                                                                                           */
/* --------------------------------------------------------------------------------------------- */

export type CaseWallOptions = {
  tr: Translate;
  /** Sends a pin to the server and applies the returned state; resolves true when it was the right person. */
  pin: (itemId: string, targetId: string) => Promise<boolean>;
  /** Asks the server where one envelope card belongs (and applies the returned state). */
  hint: () => Promise<{ itemId: string; targetId: string } | null>;
  redraw: () => void;
};

export function createCaseWall(options: CaseWallOptions) {
  const { tr } = options;
  let held: string | null = null;
  let keyTarget: string | null = null;
  let openItem: string | null = null;
  let hintState: { itemId: string; targetId: string; at: number } | null = null;
  let shake: { targetId: string; at: number; flip: boolean } | null = null;
  let status: (WallStatus & { at: number }) | null = null;
  let introAt: number | null = null;
  let busy = false;
  let seeded = false;
  const firstSeen = new Map<string, number>();
  let scrollTop = 0;
  let trayScroll = 0;
  let focusAfter = '';
  let suppressClick = false;

  // last render, for event handlers and the strings
  let items = new Map<string, WallItem>();
  let names = new Map<string, string>();
  let targets: string[] = [];
  let yarn: YarnSpec[] = [];
  let lastBoard: BoardView | null = null;

  // drag
  let press: { id: string; x: number; y: number; el: HTMLElement; pointerId: number; started: boolean } | null = null;
  let ghost: HTMLElement | null = null;
  let origin: DOMRect | null = null;
  let lifted: string | null = null;
  let over: string | null = null;
  let movePending: { x: number; y: number } | null = null;
  let moveFrame = 0;
  let root: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const now = () => Date.now();
  const age = (key: string) => {
    const seen = firstSeen.get(key);
    return seen === undefined ? Number.POSITIVE_INFINITY : now() - seen;
  };
  const isJust = (key: string, window = JUST_MS) => age(key) < window;

  function setStatus(text: string, tone: WallStatus['tone'] = 'info', label?: string) {
    status = { label: label ?? (tone === 'bad' ? tr('NOT THERE', 'CHƯA ĐÚNG') : tone === 'ok' ? tr('PINNED', 'ĐÃ GHIM') : tr('NOTE', 'GHI CHÚ')), text, tone, at: now() };
    const line = root?.closest('.ocw')?.querySelector<HTMLElement>('[data-ocw-status]');
    if (line) {
      line.dataset.tone = tone;
      line.innerHTML = `<b></b>`;
      line.querySelector('b')!.textContent = status.label;
      line.append(text);
    }
  }

  function footerStatus(board: BoardView | null): WallStatus {
    if (status && now() - status.at < 7000 && hintState && status.label === tr('HINT', 'GỢI Ý')) return status;
    if (held) {
      const item = items.get(held);
      return {
        label: tr('HOLDING', 'ĐANG CẦM'),
        text: tr(`${item?.code ?? ''} — pick a person (← →, Enter) or press Esc to put it back.`,
          `${item?.code ?? ''} — chọn người (← →, Enter), hoặc bấm Esc để thả lại vào phong bì.`),
        tone: 'info',
      };
    }
    if (status && now() - status.at < 7000) return status;
    if (!board) return { label: '', text: '', tone: 'info' };
    const pinned = board.pins.length;
    if (pinned + board.envelope.length === 0) {
      return { label: tr('EMPTY ENVELOPE', 'PHONG BÌ TRỐNG'), text: tr('Watson finds evidence, Sherlock questions people — everything you find drops into the envelope.', 'Watson tìm chứng cứ, Sherlock hỏi chuyện — mọi thứ tìm được sẽ rơi vào phong bì.'), tone: 'info' };
    }
    if (board.envelope.length) {
      return { label: tr('PINNING', 'ĐANG GHÉP'), text: tr(`${board.envelope.length} card(s) in the envelope. Drag each onto the right person — the red string ties itself.`, `Còn ${board.envelope.length} mục trong phong bì. Kéo vào đúng người — dây đỏ sẽ tự nối.`), tone: 'info' };
    }
    if (pinned >= board.totalItems) {
      return { label: tr('BOARD COMPLETE', 'SƠ ĐỒ ĐÃ ĐỦ'), text: tr('Every photo and statement is on the right person — on to Crack the Lie.', 'Mọi ảnh và lời khai đã về đúng người — sang Phá vỡ lời dối.'), tone: 'ok' };
    }
    return { label: tr('WAITING FOR LEADS', 'CHỜ MANH MỐI'), text: tr(`Everything found is pinned. ${board.totalItems - pinned} card(s) in this case are still out there.`, `Đã ghim hết những gì tìm được. Vụ án còn ${board.totalItems - pinned} mục chưa ai tìm thấy.`), tone: 'info' };
  }

  /* ---------------------------------- render ---------------------------------- */

  function render(board: BoardView | null | undefined, data: WallData): string {
    ensureSprite();
    const { tr: t, escape } = data;
    if (!board) return `<div class="ocw-wall"><p class="ocw-tray-empty">${t('This case has no case wall.', 'Vụ án này không có sơ đồ.')}</p></div>`;
    lastBoard = board;
    items = buildItems(data);
    // A card the partner pinned meanwhile can no longer be held here.
    if (held && !board.envelope.includes(held)) { held = null; keyTarget = null; }
    if (hintState && !board.envelope.includes(hintState.itemId)) hintState = null;
    const time = now();
    const pinOf = new Map(board.pins.map((pin) => [pin.itemId, pin]));
    const crackedBy = new Map(data.cracked.map((pair) => [pair.testimony.testimonyFragmentId, pair]));
    names = new Map<string, string>([[board.center.targetId, board.center.title], ...board.columns.map((column) => [column.targetId, column.name] as [string, string])]);
    targets = [board.center.targetId, ...board.columns.map((column) => column.targetId)];

    // strings, keyed so a new one draws itself once
    yarn = [];
    board.columns.forEach((column) => yarn.push({ key: `rel:${column.targetId}`, cls: 'rel', from: `head:${column.targetId}`, to: `head:${board.center.targetId}`, label: column.role }));
    board.pins.forEach((pin) => yarn.push({ key: `th:${pin.itemId}`, cls: 'th', from: `head:${pin.targetId}`, to: `item:${pin.itemId}` }));
    data.cracked.forEach((pair, index) => {
      if (pinOf.has(pair.testimony.testimonyFragmentId) && pinOf.has(pair.evidence.clueId)) {
        yarn.push({ key: `cy:${pair.testimony.testimonyFragmentId}`, cls: 'cy', from: `item:${pair.evidence.clueId}`, to: `item:${pair.testimony.testimonyFragmentId}`, label: `✗ C${index + 1}`, tag: 'mt' });
      }
    });
    board.links.forEach((link) => yarn.push({ key: `ln:${link.fromId}>${link.toId}`, cls: 'ln', from: `item:${link.fromId}`, to: `item:${link.toId}`, label: link.label, tag: '' }));

    // first-seen times drive the one-off animations (pins landing, strings drawing, stamps)
    const keys = [...board.pins.map((pin) => `pin:${pin.itemId}`), ...yarn.map((spec) => spec.key), ...data.cracked.map((pair) => `x:${pair.testimony.testimonyFragmentId}`)];
    if (board.envelope.length === 0 && board.pins.length > 0 && board.pins.length >= board.totalItems) keys.push('fin');
    for (const key of keys) if (!firstSeen.has(key)) firstSeen.set(key, seeded ? time : 0);
    seeded = true;

    const introAge = introAt === null ? Number.POSITIVE_INFINITY : time - introAt;
    const intro = introAge < INTRO_MS;
    const hint = hintState && time - hintState.at < HINT_MS ? hintState : null;
    const shaking = shake && time - shake.at < 600 ? shake : null;

    const itemHtml = (id: string, placed: boolean, delay = 0) => {
      const item = items.get(id);
      if (!item) return '';
      const pair = crackedBy.get(id);
      const pinAge = age(`pin:${id}`);
      const just = placed && pinAge < JUST_MS;
      const xAge = age(`x:${id}`);
      const classes = [
        'ocw-it', `k-${item.kind}`, placed ? 'is-placed' : 'is-tray',
        held === id ? 'is-held' : '', lifted === id ? 'is-lifted' : '',
        hint?.itemId === id ? 'is-hint' : '', openItem === id ? 'is-open' : '',
        just ? 'is-just' : '', pair ? 'is-x' : '', pair && xAge < 2400 ? 'is-xjust' : '',
        data.draft && (data.draft.testimonyId === id || data.draft.evidenceId === id) ? 'is-drafted' : '',
      ].filter(Boolean).join(' ');
      const t0 = just ? -pinAge : pair && xAge < 2400 ? -xAge : intro ? -introAge : 0;
      const style = `--d:${delay}ms;--t0:${Math.round(t0)}ms`;
      const by = `<span class="ocw-by ${item.puzzle ? 'gd' : roleClass(item.finderRole)}" aria-hidden="true">${escape(initials(data.players.find((player) => player.userId === item.finderId)?.username ?? roleName(item.finderRole) ?? '?'))}</span>`;
      const fresh = !placed && data.newIds.has(id) ? `<span class="ocw-newtag">${t('NEW', 'MỚI')}</span>` : '';
      const speaker = placed ? names.get(pinOf.get(id)?.targetId ?? '') ?? item.speaker : '';
      if (item.kind === 'say') {
        const label = placed
          ? t(`Statement ${item.code} by ${speaker}: ${item.text}`, `Lời khai ${item.code} của ${speaker}: ${item.text}`)
          : t(`Statement ${item.code}: ${item.text}. Pick it up, then choose who said it.`, `Lời khai ${item.code}: ${item.text}. Cầm lên rồi chọn người đã nói.`);
        return `<button type="button" class="${classes}" data-ocw-item="${escape(id)}" style="${style}" aria-label="${escape(label)}"${held === id ? ' aria-pressed="true"' : ''}>
          <span class="ocw-fx"><span class="ocw-slip"></span><span class="ocw-sid">${escape(item.code)}</span><span class="ocw-q">${escape(item.text)}</span>
            <span class="ocw-where">${placed ? `— ${escape(speaker)}` : escape(t(`noted ${clock(item.foundAt)}`, `ghi lúc ${clock(item.foundAt)}`))}</span>${by}
            <span class="ocw-strike" aria-hidden="true"><svg viewBox="0 0 100 60" preserveAspectRatio="none"><path pathLength="1" d="M2 12 Q50 8 98 14"/><path pathLength="1" d="M2 30 Q50 26 96 32"/><path pathLength="1" d="M2 48 Q40 45 72 50"/></svg></span>
            <span class="ocw-bb" aria-hidden="true"><svg viewBox="0 0 80 30" preserveAspectRatio="none"><ellipse cx="40" cy="15" rx="37" ry="12" pathLength="1"/></svg><b>${t('BROKEN', 'BỊ BÁC')}</b></span></span>
          <span class="ocw-pin int" aria-hidden="true"></span>${fresh}</button>`;
      }
      const photo = item.evidence ? data.evidencePhoto(item.evidence) : '';
      const art = photo || `<svg viewBox="0 0 94 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#${wallArtFor(item.title)}"/></svg>`;
      const label = placed
        ? t(`Evidence ${item.code}: ${item.title}, pinned on ${speaker}`, `Chứng cứ ${item.code}: ${item.title}, đã ghim vào ${speaker}`)
        : t(`Evidence ${item.code}: ${item.title}. Pick it up, then choose who it points to.`, `Chứng cứ ${item.code}: ${item.title}. Cầm lên rồi chọn người mà nó chỉ tới.`);
      return `<button type="button" class="${classes}" data-ocw-item="${escape(id)}" style="${style}" aria-label="${escape(label)}"${held === id ? ' aria-pressed="true"' : ''}>
        <span class="ocw-fx"><span class="ocw-pol"></span><span class="ocw-ph">${art}</span><span class="ocw-cap">${escape(item.title)}</span>${by}</span>
        <span class="ocw-num">${escape(item.code)}</span><span class="ocw-pin ${item.puzzle ? 'gd' : 'inv'}" aria-hidden="true"></span>${fresh}</button>`;
    };

    const slots = (kind: 'say' | 'ev', remaining: number) => {
      if (remaining <= 0) return '';
      const shown = Math.min(remaining, 6);
      return Array.from({ length: shown }, (_, index) => {
        const more = index === shown - 1 && remaining > shown ? ` is-more" data-more="+${remaining - shown + 1}` : '';
        return `<span class="ocw-slot k-${kind}${more}" aria-hidden="true"></span>`;
      }).join('');
    };
    const pinnedOn = (targetId: string, kind: 'say' | 'ev') => board.pins.filter((pin) => pin.targetId === targetId && (pin.kind === kind));
    const targetState = (targetId: string) => [
      over === targetId ? 'is-over' : '', keyTarget === targetId && held ? 'is-target' : '', hint?.targetId === targetId ? 'is-hint' : '',
    ].filter(Boolean).join(' ');
    const headShake = (targetId: string) => (shaking?.targetId === targetId ? (shaking.flip ? ' sh-b' : ' sh-a') : '');

    const columns = board.columns.map((column, index) => {
      const say = pinnedOn(column.targetId, 'say');
      const ev = pinnedOn(column.targetId, 'ev');
      const total = column.statementTotal + column.evidenceTotal;
      const witness = column.kind === 'WITNESS';
      return `<section class="ocw-col ${targetState(column.targetId)}" data-ocw-target="${escape(column.targetId)}" aria-label="${escape(column.name)}">
        <button type="button" class="ocw-hd ${witness ? 'wit' : 'sus'}${headShake(column.targetId)}" data-ocw-target="${escape(column.targetId)}" data-ocw-head style="--d:${160 + index * 90}ms"
          aria-label="${escape(`${column.name} — ${column.role}. ${say.length + ev.length}/${total}${held ? t('. Pin here.', '. Ghim vào đây.') : ''}`)}">
          <span class="ocw-hin"><span class="ocw-pin hs" aria-hidden="true"></span><span class="ocw-sil" aria-hidden="true"><svg viewBox="0 0 104 100" preserveAspectRatio="xMidYMid slice"><use href="#ocw-sil"/></svg></span>
            <span class="ocw-mono ${witness ? 'wit' : 'sus'}" aria-hidden="true">${escape(initials(column.name))}</span>
            <span class="ocw-hn"><em>${witness ? t('WITNESS', 'NHÂN CHỨNG') : t('SUSPECT', 'NGHI PHẠM')}</em><b>${escape(column.name)}</b><i>${escape(column.role)}</i></span>
            <span class="ocw-cnt${total > 0 && say.length + ev.length >= total ? ' is-full' : ''}" aria-hidden="true">${say.length + ev.length}/${total}</span></span>
        </button>
        ${column.statementTotal > 0 ? `<div class="ocw-zone"><b>${t('STATEMENTS', 'LỜI KHAI')}</b><div class="ocw-slots">${say.map((pin) => itemHtml(pin.itemId, true)).join('')}${slots('say', column.statementTotal - say.length)}</div></div>` : ''}
        ${column.evidenceTotal > 0 ? `<div class="ocw-zone"><b>${t('EVIDENCE', 'CHỨNG CỨ')}</b><div class="ocw-slots">${ev.map((pin) => itemHtml(pin.itemId, true)).join('')}${slots('ev', column.evidenceTotal - ev.length)}</div></div>` : ''}
      </section>`;
    }).join('');

    const weights = board.columns.map((column) => Math.max(1, Math.min(column.statementTotal, 4) * 1.75, Math.min(column.evidenceTotal, 7)));
    const gridColumns = weights.map((weight) => `minmax(0, ${weight.toFixed(2)}fr)`).join(' ');

    const center = board.center;
    const victim = Boolean(center.characterId);
    const centerSay = pinnedOn(center.targetId, 'say');
    const centerEv = pinnedOn(center.targetId, 'ev');
    const centerTotal = center.statementTotal + center.evidenceTotal;
    const centerPinned = centerSay.length + centerEv.length;
    const centerArt = victim
      ? `<span class="ocw-sil" aria-hidden="true"><svg viewBox="0 0 104 100" preserveAspectRatio="xMidYMid slice"><use href="#ocw-sil"/></svg></span><span class="ocw-mono vic" aria-hidden="true">${escape(initials(center.title))}</span>`
      : `<span class="ocw-gem" aria-hidden="true"><svg viewBox="0 0 94 80" preserveAspectRatio="xMidYMid slice"><use href="#${wallArtFor(center.title)}"/></svg></span>`;
    const mid = `<div class="ocw-mid">
        <div class="ocw-mid-pins">${[...centerSay, ...centerEv].map((pin) => itemHtml(pin.itemId, true)).join('')}${slots('ev', center.evidenceTotal - centerEv.length)}${slots('say', center.statementTotal - centerSay.length)}</div>
        <button type="button" class="ocw-lv${victim ? '' : ' is-case'} ${targetState(center.targetId)}${headShake(center.targetId)}" data-ocw-target="${escape(center.targetId)}" data-ocw-head style="--d:40ms"
          aria-label="${escape(`${center.kicker}: ${center.title}. ${centerPinned}/${centerTotal}${held ? t('. Pin here.', '. Ghim vào đây.') : ''}`)}">
          <span class="ocw-pin hs" aria-hidden="true"></span>${centerArt}
          <span class="ocw-hn"><em>${escape(center.kicker)}</em><b>${escape(center.title)}</b>${center.subtitle ? `<i>${escape(center.subtitle)}</i>` : ''}</span>
          <span class="ocw-cnt${centerTotal > 0 && centerPinned >= centerTotal ? ' is-full' : ''}" aria-hidden="true">${centerPinned}/${centerTotal}</span>
        </button>
      </div>`;

    const band = `<div class="ocw-band">
        <article class="ocw-sheet" style="--d:0ms"><span class="ocw-spin" aria-hidden="true"></span>
          <b><span>${t('SUMMARY · CASE RECORD', 'TÓM TẮT · HỒ SƠ GỐC')}</span><span>${board.pins.length}/${board.totalItems}</span></b>
          <p>${escape(board.summary)}</p></article>
        ${mid}
        <article class="ocw-rules" style="--d:120ms"><span class="ocw-tape" aria-hidden="true"></span><b>${t('HOW TO PIN', 'CÁCH GHÉP')}</b>
          <p><span>①</span>${t('Pin each <u>statement</u> on the person who said it.', 'Ghim <u>lời khai</u> vào người đã nói.')}</p>
          <p><span>②</span>${t('Pin each <u>photo</u> on the person it points to.', 'Ghim <u>ảnh</u> vào người mà nó chỉ tới.')}</p>
          <small>${t('Drag and drop · or tap/Enter a card, then a column (← → Enter)', 'Kéo thả · hoặc chạm/Enter một mục rồi chọn cột (← → Enter)')}</small></article>
      </div>`;

    const envelope = board.envelope.filter((id) => items.has(id));
    const complete = envelope.length === 0 && board.pins.length > 0 && board.pins.length >= board.totalItems;
    const finAge = age('fin');
    const tray = complete
      ? `<div class="ocw-fin${finAge < 2000 ? ' is-just' : ''}" style="--t0:${finAge < 2000 ? -Math.round(finAge) : 0}ms"><span class="ocw-stamp">${t('BOARD COMPLETE', 'SƠ ĐỒ ĐÃ ĐỦ')}</span>
          <div class="ocw-cta"><b>${board.pins.length}/${board.totalItems} · ${t('EVERY PHOTO AND STATEMENT IS ON THE RIGHT PERSON', 'MỌI ẢNH VÀ LỜI KHAI ĐÃ VỀ ĐÚNG NGƯỜI')}</b>
            <p>${t('The red strings are tied. Take the board to Crack the Lie.', 'Dây đỏ đã nối xong. Mang sơ đồ sang bước bắt lỗi lời khai.')}</p>
            <div><button type="button" class="ocw-btn red" data-case-goto="contradictions">${t('Crack the Lie →', 'Phá vỡ lời dối →')}</button><button type="button" class="ocw-btn ink" data-case-goto="timeline">${t('Timeline', 'Dòng thời gian')}</button></div></div></div>`
      : `<div class="ocw-tray" role="group" aria-label="${t('Case envelope', 'Phong bì hồ sơ')}" data-ocw-tray>${envelope.length
        ? envelope.map((id, index) => itemHtml(id, false, 220 + index * 60)).join('')
        : `<p class="ocw-tray-empty">${board.pins.length
          ? t(`Nothing left to pin. ${board.totalItems - board.pins.length} card(s) are still to be found — Watson searches, Sherlock asks.`, `Không còn gì để ghim. Còn ${board.totalItems - board.pins.length} mục chưa tìm thấy — Watson lục soát, Sherlock hỏi chuyện.`)
          : t('The envelope is empty. What Watson finds and what Sherlock hears lands here for both of you.', 'Phong bì đang trống. Những gì Watson tìm được và Sherlock nghe được sẽ rơi vào đây cho cả hai.')}</p>`}</div>`;

    const dock = `<div class="ocw-dock${envelope.length ? '' : ' is-empty'}">
        <div class="ocw-env" style="--d:160ms"><div class="ocw-envb"></div><div class="ocw-flap"></div>
          <div class="ocw-envt"><b>${t('CASE<br>ENVELOPE', 'PHONG BÌ<br>HỒ SƠ')}</b><em>${complete ? '' : t('LEFT', 'CÒN')}</em><strong class="${envelope.length ? '' : 'is-zero'}">${envelope.length}</strong><i>${complete ? t('all pinned', 'đã ghim hết') : t('to pin', 'mục cần ghim')}</i></div></div>
        ${tray}
        <div class="ocw-hintbox"><button type="button" class="ocw-hintbtn" data-ocw-hint ${envelope.length ? '' : 'disabled'} aria-keyshortcuts="G">${t('Hint', 'Gợi ý')}<kbd aria-hidden="true">G</kbd></button>
          <p>${t('Shows the right person for one card · costs a little score.', 'Chỉ đúng người cho một mục · trừ chút điểm.')}</p></div>
      </div>`;

    const card = openItem && items.has(openItem) ? detailCard(items.get(openItem)!, board, data, pinOf, crackedBy) : '';
    const wallClasses = ['ocw-wall', intro ? 'is-intro' : '', held ? 'is-holding' : '', lifted ? 'is-dragging' : '', complete ? 'is-fin' : ''].filter(Boolean).join(' ');
    return `<div class="${wallClasses}" data-ocw-wall tabindex="-1" style="--t0:${intro ? -Math.round(introAge) : 0}ms">
        <div class="ocw-scroll" data-ocw-scroll><div class="ocw-canvas" data-ocw-canvas>
          <svg class="ocw-yarn" data-ocw-yarn aria-hidden="true" focusable="false"></svg><div data-ocw-labels></div>
          ${band}
          <div class="ocw-cols" style="grid-template-columns:${gridColumns}">${columns}</div>
        </div></div>
        ${dock}
        <div class="ocw-peek" data-ocw-peek hidden></div>
        ${card}
      </div>`;
  }

  function detailCard(item: WallItem, board: BoardView, data: WallData, pinOf: Map<string, BoardPin>, crackedBy: Map<string, DisclosedPair>) {
    const { tr: t, escape } = data;
    const pin = pinOf.get(item.id);
    const pair = crackedBy.get(item.id);
    const finder = data.players.find((player) => player.userId === item.finderId);
    const who = finder ? `${finder.userId === data.meId ? t('you', 'bạn') : finder.username}${roleName(finder.role) ? ` (${roleName(finder.role)})` : ''}` : roleName(item.finderRole);
    let actions = '';
    if (item.kind === 'say' && !pair && item.canChallenge) {
      actions = data.draft
        ? (data.draft.testimonyId === item.id ? '' : `<button type="button" class="ocw-btn ink" data-v3-edit-testimony="${escape(item.id)}">${t('Use this statement', 'Dùng câu này để bắt lỗi')}</button>`)
        : `<button type="button" class="ocw-btn red" data-v3-start-testimony="${escape(item.id)}" data-case-goto="contradictions">${t('Catch this lie', 'Bắt lỗi câu này')}</button>`;
    } else if (item.kind === 'ev' && data.draft && data.draft.evidenceId !== item.id) {
      actions = `<button type="button" class="ocw-btn ink" data-v3-propose-evidence="${escape(item.id)}">${t('Use as evidence', 'Đưa chứng cứ này')}</button>`;
    }
    const meta = [
      who ? `<li>${t('Found by', 'Tìm bởi')}: ${escape(who)}${item.foundAt ? ` · ${escape(clock(item.foundAt))}` : ''}</li>` : '',
      item.sceneId && data.sceneTitle(item.sceneId) ? `<li>${t('Where', 'Nơi')}: ${escape(data.sceneTitle(item.sceneId))}</li>` : '',
      pin ? `<li>${t('Pinned on', 'Ghim vào')}: ${escape(names.get(pin.targetId) ?? '')}</li>` : '',
      pair ? `<li>${t('Broken by', 'Bị bác bởi')}: ${escape(pair.evidence.title)}</li>` : '',
    ].join('');
    return `<aside class="ocw-card" role="dialog" aria-labelledby="ocw-card-title"><div class="ocw-cin">
        <div class="ocw-ch"><div><span class="ocw-ck">${escape(item.code)} · ${item.kind === 'say' ? t('STATEMENT', 'LỜI KHAI') : item.puzzle ? t('PUZZLE EVIDENCE', 'CHỨNG CỨ GIẢI ĐỐ') : t('EVIDENCE', 'VẬT CHỨNG')}</span>
          <h4 class="ocw-ct" id="ocw-card-title">${escape(item.kind === 'say' ? (pin ? names.get(pin.targetId) ?? item.speaker : t('Who said this?', 'Ai đã nói câu này?')) : item.title)}</h4></div>
          <button type="button" class="ocw-cx" data-ocw-close-card aria-label="${t('Close', 'Đóng')}">×</button></div>
        <p class="ocw-cbody${item.kind === 'say' ? ' is-quote' : ''}">${item.kind === 'say' ? `“${escape(item.text)}”` : escape(item.text)}</p>
        ${item.meaning ? `<p class="ocw-cbody"><i>${escape(item.meaning)}</i></p>` : ''}
        <ul class="ocw-cmeta">${meta}</ul>
        ${actions ? `<div class="ocw-cact">${actions}</div>` : ''}
      </div></aside>`;
  }

  /* ---------------------------------- strings ---------------------------------- */

  function anchor(canvas: HTMLElement, ref: string, end: 'top' | 'bottom'): Point | null {
    const [type, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    const el = type === 'head'
      ? canvas.querySelector<HTMLElement>(`[data-ocw-head][data-ocw-target="${CSS.escape(id)}"]`)
      : canvas.querySelector<HTMLElement>(`[data-ocw-item="${CSS.escape(id)}"]`);
    if (!el) return null;
    const base = canvas.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    if (!rect.width) return null;
    return { x: rect.left - base.left + rect.width / 2, y: (end === 'top' ? rect.top - base.top + 2 : rect.bottom - base.top - 4) };
  }

  function drawYarn() {
    const canvas = root?.querySelector<HTMLElement>('[data-ocw-canvas]');
    const svg = root?.querySelector<SVGSVGElement>('[data-ocw-yarn]');
    const labels = root?.querySelector<HTMLElement>('[data-ocw-labels]');
    if (!canvas || !svg || !labels) return;
    const width = canvas.scrollWidth;
    const height = canvas.scrollHeight;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const introAge = introAt === null ? Number.POSITIVE_INFINITY : now() - introAt;
    const paths: string[] = [];
    const tags: string[] = [];
    // Cards and notes the labels should not cover; placed labels join the list as they are placed.
    const base = canvas.getBoundingClientRect();
    const blocked = [...canvas.querySelectorAll<HTMLElement>('.ocw-it, .ocw-hd, .ocw-lv, .ocw-sheet, .ocw-rules')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    });
    const hits = (box: { x: number; y: number; w: number; h: number }) =>
      blocked.some((r) => box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y);
    const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    for (const spec of yarn) {
      const a = anchor(canvas, spec.from, spec.cls === 'rel' || spec.cls === 'th' ? (spec.cls === 'rel' ? 'top' : 'bottom') : 'top');
      const b = anchor(canvas, spec.to, spec.cls === 'rel' ? 'bottom' : 'top');
      if (!a || !b) continue;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < 4) continue;
      const sagBy = Math.min(70, distance * 0.14 + 10);
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sagBy };
      const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      const keyAge = age(spec.key);
      const just = keyAge < JUST_MS + 600;
      const anim = just ? ' is-just' : introAge < INTRO_MS && spec.cls === 'rel' ? ' is-intro' : '';
      const t0 = just ? -Math.round(keyAge) : introAge < INTRO_MS ? -Math.round(introAge) : 0;
      const style = anim ? ` style="--t0:${t0}ms"` : '';
      if (spec.cls === 'cy' || spec.cls === 'ln') {
        paths.push(`<path class="cy-sh${anim}" pathLength="1" d="${d}"${style}/><path class="cy${anim}" pathLength="1" d="${d}"${style}/><path class="cy-gl${anim}" pathLength="1" d="${d}"${style}/>`);
      } else {
        paths.push(`<path class="${spec.cls}${anim}" pathLength="1" d="${d}"${style}/>`);
      }
      if (spec.label) {
        // labels sit on the curve: at the middle for strings between cards, near the person for relations
        const at = (t: number) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
        let point = at(spec.cls === 'rel' ? 0.82 : 0.5);
        if (spec.cls !== 'rel') {
          // slide the tag along its string to the first spot that covers no card text
          const width = spec.label.length * 8 + 34;
          const boxAt = (p: Point) => ({ x: p.x - width / 2, y: p.y - 14, w: width, h: 28 });
          const free = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.15, 0.85].map(at).find((p) => !hits(boxAt(p)));
          if (free) point = free;
          else if (distance < 160) point = { x: point.x, y: Math.min(a.y, b.y) - 24 };
          blocked.push(boxAt(point));
        }
        const relPoint = spec.cls === 'rel' ? { x: (1 - 0.12) * (1 - 0.12) * a.x + 2 * 0.88 * 0.12 * c.x + 0.0144 * b.x, y: (0.88 * 0.88) * a.y + 2 * 0.88 * 0.12 * c.y + 0.0144 * b.y } : point;
        tags.push(spec.cls === 'rel'
          ? `<span class="ocw-rel" style="left:${relPoint.x.toFixed(0)}px;top:${(relPoint.y - 6).toFixed(0)}px">${esc(spec.label)}</span>`
          : `<span class="ocw-tag${spec.tag ? ` ${spec.tag}` : ''}${just ? ' is-just' : ''}" style="left:${point.x.toFixed(0)}px;top:${point.y.toFixed(0)}px;--t0:${just ? -Math.round(keyAge) : 0}ms">${esc(spec.label)}</span>`);
      }
    }
    svg.innerHTML = paths.join('');
    labels.innerHTML = tags.join('');
  }

  /* ---------------------------------- actions ---------------------------------- */

  async function pinTo(itemId: string, targetId: string, fromDrag = false) {
    if (busy) return false;
    busy = true;
    const item = items.get(itemId);
    const name = names.get(targetId) ?? '';
    let ok = false;
    try {
      ok = await options.pin(itemId, targetId);
      if (ok) {
        held = null;
        keyTarget = null;
        if (hintState?.itemId === itemId) hintState = null;
        setStatus(tr(`${item?.code ?? ''} pinned on ${name}.`, `Đã ghim ${item?.code ?? ''} vào ${name}.`), 'ok');
      } else {
        shake = { targetId, at: now(), flip: !(shake?.flip ?? false) };
        setStatus(item?.kind === 'say'
          ? tr(`Not ${name}'s words. Who said it?`, `Không phải lời của ${name}. Ai đã nói câu này?`)
          : tr(`This does not point to ${name}. Who is it about?`, `Ảnh này không chỉ tới ${name}. Nó nói về ai?`), 'bad');
        if (fromDrag) held = null;
      }
    } catch (error: any) {
      setStatus(error?.message || tr('Could not pin the card.', 'Không ghim được mục này.'), 'bad');
    } finally {
      busy = false;
      options.redraw();
    }
    return ok;
  }

  async function askHint() {
    if (busy || !lastBoard?.envelope.length) return;
    busy = true;
    try {
      const result = await options.hint();
      if (result) {
        hintState = { ...result, at: now() };
        held = result.itemId;
        keyTarget = result.targetId;
        const item = items.get(result.itemId);
        setStatus(tr(`${item?.code ?? 'This card'} belongs to ${names.get(result.targetId) ?? ''} — click the lit column to pin it.`,
          `${item?.code ?? 'Mục này'} thuộc về ${names.get(result.targetId) ?? ''} — bấm vào cột đang sáng để ghim.`), 'info', tr('HINT', 'GỢI Ý'));
        focusAfter = `[data-ocw-head][data-ocw-target="${CSS.escape(result.targetId)}"]`;
      }
    } catch (error: any) {
      setStatus(error?.message || tr('No hint right now.', 'Chưa lấy được gợi ý.'), 'bad');
    } finally {
      busy = false;
      options.redraw();
    }
  }

  /* ---------------------------------- drag ---------------------------------- */

  function clearOver() {
    root?.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
    over = null;
  }

  function setOver(id: string | null) {
    if (id === over) return;
    clearOver();
    over = id;
    if (!id || !root) return;
    root.querySelectorAll<HTMLElement>(`.ocw-col[data-ocw-target="${CSS.escape(id)}"], .ocw-lv[data-ocw-target="${CSS.escape(id)}"]`).forEach((el) => el.classList.add('is-over'));
  }

  function startDrag() {
    if (!press) return;
    press.started = true;
    origin = press.el.getBoundingClientRect();
    ghost = document.createElement('div');
    ghost.className = 'ocw-ghost';
    ghost.style.width = `${origin.width}px`;
    ghost.style.height = `${origin.height}px`;
    ghost.style.transform = `translate(${origin.left}px, ${origin.top}px)`;
    const clone = press.el.cloneNode(true) as HTMLElement;
    clone.classList.remove('is-held', 'is-hint', 'is-open', 'is-just');
    clone.removeAttribute('data-ocw-item');
    clone.setAttribute('aria-hidden', 'true');
    clone.tabIndex = -1;
    ghost.appendChild(clone);
    document.body.appendChild(ghost);
    lifted = press.id;
    held = null;
    press.el.classList.add('is-lifted');
    root?.classList.add('is-dragging');
    hidePeek();
  }

  function autoScroll(y: number) {
    const scroller = root?.querySelector<HTMLElement>('[data-ocw-scroll]');
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (y > rect.top && y < rect.top + 48) scroller.scrollTop -= 14;
    else if (y > rect.bottom - 48 && y <= rect.bottom) scroller.scrollTop += 14;
  }

  function onMoveFrame() {
    moveFrame = 0;
    if (!press || !movePending || !ghost || !origin) return;
    const { x, y } = movePending;
    ghost.style.transform = `translate(${origin.left + x - press.x}px, ${origin.top + y - press.y}px)`;
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const target = hit?.closest<HTMLElement>('.ocw-wall [data-ocw-target]');
    setOver(target?.dataset.ocwTarget ?? null);
    autoScroll(y);
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    if (!press.started) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) return;
      startDrag();
    }
    event.preventDefault();
    movePending = { x: event.clientX, y: event.clientY };
    if (!moveFrame) moveFrame = requestAnimationFrame(onMoveFrame);
  };

  function endListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
  }

  function sendGhostBack(itemId: string) {
    const current = ghost;
    ghost = null;
    if (!current) return;
    const home = root?.querySelector<HTMLElement>(`[data-ocw-item="${CSS.escape(itemId)}"]`)?.getBoundingClientRect() ?? origin;
    current.classList.remove('is-pending');
    current.classList.add('is-back');
    if (home) current.style.transform = `translate(${home.left}px, ${home.top}px)`;
    window.setTimeout(() => current.remove(), 700);
  }

  function dropGhost() {
    const current = ghost;
    ghost = null;
    if (!current) return;
    current.classList.add('is-gone');
    window.setTimeout(() => current.remove(), 260);
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    endListeners();
    const drag = press;
    press = null;
    if (!drag.started) return; // a tap: the click handler picks the card up
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 0);
    if (movePending) onMoveFrame();
    const target = over;
    clearOver();
    lifted = null;
    root?.classList.remove('is-dragging');
    if (!target) {
      sendGhostBack(drag.id);
      options.redraw();
      return;
    }
    ghost?.classList.add('is-pending');
    void pinTo(drag.id, target, true).then((ok) => {
      if (ok) dropGhost();
      else requestAnimationFrame(() => sendGhostBack(drag.id));
    });
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    endListeners();
    const drag = press;
    press = null;
    clearOver();
    lifted = null;
    root?.classList.remove('is-dragging');
    if (drag.started) sendGhostBack(drag.id);
  };

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || busy) return;
    const el = (event.target as HTMLElement).closest<HTMLElement>('.ocw-it.is-tray');
    if (!el?.dataset.ocwItem) return;
    press = { id: el.dataset.ocwItem, x: event.clientX, y: event.clientY, el, pointerId: event.pointerId, started: false };
    movePending = null;
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  /* ---------------------------------- peek ---------------------------------- */

  function hidePeek() {
    const peek = root?.querySelector<HTMLElement>('[data-ocw-peek]');
    if (peek) peek.hidden = true;
  }

  function showPeek(el: HTMLElement) {
    const id = el.dataset.ocwItem;
    const item = id ? items.get(id) : null;
    const peek = root?.querySelector<HTMLElement>('[data-ocw-peek]');
    if (!item || !peek || !root || lifted || openItem === id) return;
    const placed = el.classList.contains('is-placed');
    const finder = lastBoard ? '' : '';
    peek.className = `ocw-peek k-${item.kind}`;
    peek.innerHTML = `<span class="ocw-pk-t"><em></em><b></b><span></span><i></i></span>`;
    const [em, b, span, i] = ['em', 'b', 'span', 'i'].map((tag) => peek.querySelector(`.ocw-pk-t > ${tag}`)!) as HTMLElement[];
    em.textContent = `${item.code} · ${item.kind === 'say' ? tr('STATEMENT', 'LỜI KHAI') : item.puzzle ? tr('PUZZLE', 'GIẢI ĐỐ') : tr('EVIDENCE', 'VẬT CHỨNG')}`;
    b.textContent = item.kind === 'say' ? (placed ? item.speaker : tr('Who said this?', 'Ai đã nói câu này?')) : item.title;
    span.textContent = item.kind === 'say' ? `“${item.text}”` : item.text;
    i.textContent = placed ? tr('Click for details', 'Bấm để xem chi tiết') : tr('Drag onto a person, or tap then pick a column', 'Kéo vào một người, hoặc chạm rồi chọn cột') + finder;
    peek.hidden = false;
    const base = root.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const width = 320;
    let left = rect.left - base.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, base.width - width - 8));
    const height = peek.offsetHeight || 110;
    let top = rect.top - base.top - height - 12;
    if (top < 8) top = rect.bottom - base.top + 12;
    peek.style.left = `${left}px`;
    peek.style.top = `${Math.min(top, base.height - height - 8)}px`;
  }

  /* ---------------------------------- input ---------------------------------- */

  function onClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-ocw-hint]')) { event.preventDefault(); void askHint(); return; }
    if (target.closest('[data-ocw-close-card]')) { event.preventDefault(); openItem = null; options.redraw(); return; }
    if (target.closest('.ocw-card')) return;
    const itemEl = target.closest<HTMLElement>('[data-ocw-item]');
    if (itemEl) {
      if (suppressClick) return;
      const id = itemEl.dataset.ocwItem ?? '';
      if (itemEl.classList.contains('is-tray')) {
        held = held === id ? null : id;
        if (held) {
          keyTarget = hintState?.itemId === id ? hintState.targetId : keyTarget ?? targets[1] ?? targets[0] ?? null;
          status = null;
        }
        openItem = null;
        focusAfter = `[data-ocw-item="${CSS.escape(id)}"]`;
        hidePeek();
        options.redraw();
        return;
      }
      if (held) {
        const column = itemEl.closest<HTMLElement>('[data-ocw-target]')?.dataset.ocwTarget;
        if (column) void pinTo(held, column);
        return;
      }
      openItem = openItem === id ? null : id;
      hidePeek();
      options.redraw();
      return;
    }
    const zone = target.closest<HTMLElement>('[data-ocw-target]');
    if (zone && held) {
      event.preventDefault();
      void pinTo(held, zone.dataset.ocwTarget ?? '');
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!root?.isConnected) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if (event.target instanceof Element && !event.target.closest('.ocw') && event.target !== document.body) return;
    if ((event.key === 'g' || event.key === 'G') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      void askHint();
      return;
    }
    if (held && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!targets.length) return;
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const index = keyTarget ? targets.indexOf(keyTarget) : -1;
      keyTarget = targets[(index + step + targets.length) % targets.length];
      focusAfter = `[data-ocw-head][data-ocw-target="${CSS.escape(keyTarget)}"]`;
      options.redraw();
      return;
    }
    if (event.key === 'Escape' && (held || openItem)) {
      event.preventDefault();
      event.stopPropagation();
      const was = held ?? openItem;
      held = null;
      openItem = null;
      if (was) focusAfter = `[data-ocw-item="${CSS.escape(was)}"]`;
      options.redraw();
    }
  }

  const onOver = (event: Event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-ocw-item]');
    if (el && !(event.target as HTMLElement).closest('.ocw-card')) showPeek(el);
  };
  const onOut = (event: Event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-ocw-item]');
    const next = (event as PointerEvent | FocusEvent).relatedTarget as HTMLElement | null;
    if (el && (!next || !el.contains(next))) hidePeek();
  };

  /* ---------------------------------- lifecycle ---------------------------------- */

  /** Bind the freshly rendered wall (or forget it when the board is not on screen). */
  function afterRender(next: HTMLElement | null) {
    resizeObserver?.disconnect();
    resizeObserver = null;
    root = next;
    if (!next) {
      if (press || ghost) {
        endListeners();
        press = null;
        ghost?.remove();
        ghost = null;
      }
      lifted = null;
      over = null;
      held = null;
      openItem = null;
      return;
    }
    next.addEventListener('pointerdown', onPointerDown);
    next.addEventListener('click', onClick);
    next.addEventListener('pointerover', onOver);
    next.addEventListener('pointerout', onOut);
    next.addEventListener('focusin', onOver);
    next.addEventListener('focusout', onOut);
    const scroller = next.querySelector<HTMLElement>('[data-ocw-scroll]');
    if (scroller) {
      scroller.scrollTop = scrollTop;
      scroller.addEventListener('scroll', () => { scrollTop = scroller.scrollTop; hidePeek(); }, { passive: true });
    }
    const tray = next.querySelector<HTMLElement>('[data-ocw-tray]');
    if (tray) {
      tray.scrollTop = trayScroll;
      tray.addEventListener('scroll', () => { trayScroll = tray.scrollTop; hidePeek(); }, { passive: true });
    }
    if (lifted) next.querySelector(`[data-ocw-item="${CSS.escape(lifted)}"]`)?.classList.add('is-lifted');
    if (over) {
      const keep = over;
      over = null;
      setOver(keep);
    }
    drawYarn();
    const canvas = next.querySelector<HTMLElement>('[data-ocw-canvas]');
    if (canvas && typeof ResizeObserver !== 'undefined') {
      let frame = 0;
      resizeObserver = new ResizeObserver(() => {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; drawYarn(); });
      });
      resizeObserver.observe(canvas);
    }
    if (focusAfter) {
      const el = next.querySelector<HTMLElement>(focusAfter);
      focusAfter = '';
      if (el) {
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    if (hintState && now() - hintState.at < 400) {
      next.querySelector<HTMLElement>(`.ocw-col[data-ocw-target="${CSS.escape(hintState.targetId)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  // Keys work wherever focus sits in the case file (a redraw can drop focus to <body>), and run
  // before the game's own Escape handler so putting a card back does not close the folder.
  window.addEventListener('keydown', onKeyDown, true);

  return {
    render,
    afterRender,
    destroy() {
      window.removeEventListener('keydown', onKeyDown, true);
      afterRender(null);
    },
    footerStatus,
    /** The case file just opened on the wall: play the entrance once. */
    markOpened() {
      introAt = now();
      held = null;
      openItem = null;
      status = null;
    },
    /** From the partner feed: show one card (detail when pinned, highlighted when still in the envelope). */
    reveal(itemId: string) {
      const pinned = lastBoard?.pins.some((pin) => pin.itemId === itemId);
      if (pinned) openItem = itemId;
      else if (lastBoard?.envelope.includes(itemId)) { held = itemId; focusAfter = `[data-ocw-item="${CSS.escape(itemId)}"]`; }
    },
    isBusy: () => busy || Boolean(press?.started),
  };
}

export type CaseWall = ReturnType<typeof createCaseWall>;
