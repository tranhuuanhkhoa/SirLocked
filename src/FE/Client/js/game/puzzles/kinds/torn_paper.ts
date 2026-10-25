/**
 * P2 · Ghép mảnh giấy — ported from design/project/PuzzleTorn.dc.html.
 * The tear lines are drawn here from params.tearSeed (4 or 5 pieces), so every case tears its sheet
 * differently. Drag a piece near its slot while upright and it snaps; double-click / double-tap / R turns
 * it 180°. When every piece is in, the module submits { placed:[{id,x,y,r}] } (x/y = the piece's sheet
 * origin relative to the frame origin). A partner-held piece (params.partnerPiece) is brought onto the
 * table with ctx.probe({ handoff: true }); the run flag `handedOff` shows it to both players.
 */
import './torn_paper.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleTone } from '../types';

type Pt = [number, number];
type EdgeKind = 'E' | 'W' | 'N';
type Part = [EdgeKind, Pt[], boolean?];
interface Geo { bx: number; by: number; bw: number; bh: number; co: string; ci: string; fib: string; burn: string; pts: string; sheetPts: string; tape: { x: number; y: number; w: number; r: number } }
interface PieceState { x: number; y: number; jit: number; turns: number; placed: boolean; fx: string; slap: boolean }
interface Layout { w: number; h: number; fx: number; fy: number; sc: Record<number, [number, number, number]> }

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const f1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** mulberry32 — the mockup's seeded generator, so a seed always tears the same way. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A torn edge along the control polyline (same noise as the mockup). */
function tear(ctrl: Pt[], seed: number): Pt[] {
  const rnd = rng(seed);
  const segs: { a: Pt; b: Pt; l: number; s0: number }[] = [];
  let total = 0;
  for (let i = 0; i < ctrl.length - 1; i++) {
    const a = ctrl[i];
    const b = ctrl[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.001;
    segs.push({ a, b, l, s0: total });
    total += l;
  }
  const n = Math.max(3, Math.round(total / 2.6));
  const p1 = rnd() * 6.283;
  const p3 = rnd() * 6.283;
  let walk = 0;
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const sp = (total * i) / n;
    let sg = segs[segs.length - 1];
    for (const seg of segs) { if (sp <= seg.s0 + seg.l) { sg = seg; break; } }
    const t = (sp - sg.s0) / sg.l;
    const x = sg.a[0] + (sg.b[0] - sg.a[0]) * t;
    const y = sg.a[1] + (sg.b[1] - sg.a[1]) * t;
    const nx = -(sg.b[1] - sg.a[1]) / sg.l;
    const ny = (sg.b[0] - sg.a[0]) / sg.l;
    const taper = Math.min(1, Math.min(sp, total - sp) / 8);
    walk = walk * 0.82 + (rnd() - 0.5) * 1.5;
    let off = 1.9 * Math.sin(sp / 9 + p1) + 0.8 * Math.sin(sp / 23 + p3) + walk * 1.25 + (rnd() - 0.5) * 0.85;
    if (rnd() < 0.06) off += (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 2.4);
    off *= taper;
    out.push([x + nx * off, y + ny * off]);
  }
  out[0] = [ctrl[0][0], ctrl[0][1]];
  out[n] = [ctrl[ctrl.length - 1][0], ctrl[ctrl.length - 1][1]];
  return out;
}

/** The lighter fibrous rim: the printed face is inset a little along torn edges only. */
function inner(pts: Pt[], kind: EdgeKind, seed: number): Pt[] {
  if (kind === 'E') return pts.map((p) => [p[0], p[1]] as Pt);
  const rnd = rng(seed);
  const m = pts.length - 1;
  const ph = rnd() * 6.283;
  return pts.map((p, i) => {
    if (i === 0 || i === m) return [p[0], p[1]] as Pt;
    const a = pts[i - 1];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const taper = Math.min(1, Math.min(i, m - i) / 3);
    const w = (kind === 'W' ? 1.5 + 1.6 * (0.5 + 0.5 * Math.sin(i * 0.43 + ph)) + rnd() * 0.9 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(i * 0.57 + ph)) + rnd() * 0.45) * taper;
    return [p[0] - (dy / l) * w, p[1] + (dx / l) * w] as Pt;
  });
}

const rev = (a: Pt[]) => a.slice().reverse();

/** Control polylines of the tears for this case (the 5-piece layout follows the mockup). */
function tearPlan(count: number, seed: number) {
  const r = rng(seed * 7919 + 13);
  const j = (v: number, d: number) => f1(v + (r() * 2 - 1) * d);
  // a wavy control line from a to b with n inner points pushed sideways up to amp
  const path = (a: Pt, b: Pt, n: number, amp: number): Pt[] => {
    const out: Pt[] = [a];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1) + (r() - 0.5) * (0.4 / (n + 1));
      const off = (r() * 2 - 1) * amp;
      out.push([f1(a[0] + dx * t - (dy / l) * off), f1(a[1] + dy * t + (dx / l) * off)]);
    }
    out.push(b);
    return out;
  };
  const s = (k: number) => (seed % 100000) * 7 + k;
  if (count === 5) {
    const x1 = j(218, 12);
    const A: Pt = [j(140, 8), j(138, 6)];
    const J: Pt = [j(205, 8), j(146, 5)];
    const B: Pt = [j(272, 8), j(141, 6)];
    const yl = j(134, 8);
    const yr = j(149, 8);
    const T = {
      t1: tear(path([x1, 0], J, 4, 9), s(11)),
      t2a: tear(path([0, yl], A, 3, 5), s(23)),
      t2b: tear(path(A, J, 1, 5), s(37)),
      t2c: tear(path(J, B, 1, 4), s(41)),
      t2d: tear(path(B, [400, yr], 2, 6), s(53)),
      t3: tear(path(A, [j(152, 10), 284], 3, 9), s(67)),
      t4: tear(path(B, [j(263, 10), 284], 3, 9), s(79)),
    };
    const end = (t: Pt[]) => t[t.length - 1];
    const defs: Record<number, Part[]> = {
      1: [['E', [[0, 0], [x1, 0]]], ['W', T.t1], ['N', rev(T.t2b)], ['W', rev(T.t2a), true], ['E', [[0, yl], [0, 0]]]],
      2: [['N', T.t2a], ['W', T.t3], ['E', [end(T.t3), [0, 284], [0, yl]]]],
      3: [['W', T.t2b], ['N', T.t2c], ['W', T.t4, true], ['E', [end(T.t4), end(T.t3)]], ['N', rev(T.t3)]],
      4: [['W', T.t2d, true], ['E', [[400, yr], [400, 284], end(T.t4)]], ['N', rev(T.t4)]],
      5: [['E', [[x1, 0], [400, 0], [400, yr]]], ['N', rev(T.t2d)], ['W', rev(T.t2c)], ['N', rev(T.t1)]],
    };
    return { tears: Object.values(T), defs };
  }
  const x1 = j(212, 18);
  const J: Pt = [j(205, 16), j(142, 8)];
  const yl = j(138, 10);
  const yr = j(144, 10);
  const T = {
    t1: tear(path([x1, 0], J, 4, 9), s(11)),
    t2a: tear(path([0, yl], J, 4, 6), s(23)),
    t2b: tear(path(J, [400, yr], 4, 6), s(53)),
    t3: tear(path(J, [j(200, 22), 284], 4, 9), s(67)),
  };
  const x3 = T.t3[T.t3.length - 1];
  const defs: Record<number, Part[]> = {
    1: [['E', [[0, 0], [x1, 0]]], ['W', T.t1], ['N', rev(T.t2a), true], ['E', [[0, yl], [0, 0]]]],
    2: [['W', T.t2a], ['N', T.t3], ['E', [x3, [0, 284], [0, yl]]]],
    3: [['N', T.t2b, true], ['E', [[400, yr], [400, 284], x3]], ['W', rev(T.t3)]],
    4: [['E', [[x1, 0], [400, 0], [400, yr]]], ['N', rev(T.t2b)], ['W', rev(T.t1)]],
  };
  return { tears: Object.values(T), defs };
}

function buildGeo(count: number, seed: number) {
  const plan = tearPlan(count, seed);
  const pc: Record<number, Geo> = {};
  for (let id = 1; id <= count; id++) {
    const outer: Pt[] = [];
    const inn: Pt[] = [];
    const torn: Pt[][] = [];
    const burnt: Pt[][] = [];
    plan.defs[id].forEach((part, pi) => {
      if (part[0] !== 'E') (part[2] ? burnt : torn).push(part[1]);
      const ins = inner(part[1], part[0], id * 31 + pi * 7 + seed);
      part[1].forEach((p, i) => { if (i === 0 && outer.length) return; outer.push(p); inn.push(ins[i]); });
    });
    const last = outer[outer.length - 1];
    if (Math.abs(last[0] - outer[0][0]) < 0.01 && Math.abs(last[1] - outer[0][1]) < 0.01) { outer.pop(); inn.pop(); }
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    outer.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    const bx = Math.max(0, Math.floor(x0));
    const by = Math.max(0, Math.floor(y0));
    const bw = Math.ceil(x1) - bx;
    const bh = Math.ceil(y1) - by;
    const poly = (arr: Pt[]) => 'polygon(' + arr.map((p) => `${f1(p[0] - bx)}px ${f1(p[1] - by)}px`).join(', ') + ')';
    const line = (list: Pt[][]) => list.map((pts) => 'M' + pts.map((p) => `${f1(p[0] - bx)} ${f1(p[1] - by)}`).join(' L')).join(' ') || 'M0 0';
    // a tape strip across the middle of the piece's longest torn edge
    const edge = [...torn, ...burnt].sort((a, b) => b.length - a.length)[0] ?? outer;
    const mid = edge[Math.floor(edge.length / 2)];
    const a = edge[Math.max(0, Math.floor(edge.length / 2) - 3)];
    const b = edge[Math.min(edge.length - 1, Math.floor(edge.length / 2) + 3)];
    let angle = ((((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 90) % 180) + 180) % 180;
    if (angle > 90) angle -= 180;
    pc[id] = {
      bx, by, bw, bh,
      co: poly(outer), ci: poly(inn),
      fib: line(torn), burn: line(burnt),
      pts: outer.map((p) => `${f1(p[0] - bx)},${f1(p[1] - by)}`).join(' '),
      sheetPts: outer.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' '),
      tape: { x: f1(mid[0]), y: f1(mid[1]), w: 52 + (id % 3) * 4, r: f1(angle) },
    };
  }
  const seam = plan.tears.map((t) => 'M' + t.map((p) => `${f1(p[0])} ${f1(p[1])}`).join(' L')).join(' ');
  return { pc, seam };
}

/** Kraft hairs on the work mat (procedural, stand-in for the mockup's baked path). */
function hairs() {
  const r = rng(7);
  let d = '';
  for (let i = 0; i < 220; i++) {
    const x = f1(r() * 872);
    const y = f1(r() * 740);
    const a = r() * Math.PI * 2;
    const l = 3 + r() * 6;
    d += `M${x} ${y}Q${f1(x + Math.cos(a) * l * 0.5 + (r() - 0.5) * 3)} ${f1(y + Math.sin(a) * l * 0.5 + (r() - 0.5) * 3)} ${f1(x + Math.cos(a) * l)} ${f1(y + Math.sin(a) * l)}`;
  }
  return d;
}

const LAYOUTS = (count: number): Record<'desk' | 'phone', Layout> => ({
  desk: {
    w: 872, h: 600, fx: 236, fy: 158,
    sc: count === 5
      ? { 1: [10, 68, -4], 2: [690, 416, 4], 3: [36, 400, 7], 4: [378, 6, -3], 5: [650, 198, 6] }
      : { 1: [10, 68, -4], 2: [672, 400, 4], 3: [36, 396, 7], 4: [650, 160, 6] },
  },
  phone: {
    w: 440, h: 736, fx: 20, fy: 92,
    sc: count === 5
      ? { 1: [8, 398, -4], 2: [270, 566, 3], 3: [10, 570, 5], 4: [286, 402, 6], 5: [122, 574, -4] }
      : { 1: [8, 398, -4], 2: [232, 404, 6], 3: [10, 566, 5], 4: [226, 570, 3] },
  },
});

/** "[[SỐ]] 0731" → <i>SỐ</i> 0731 (the red small-caps labels of the form). */
const labels = (text: string) => esc(text).replace(/\[\[(.+?)\]\]/g, '<i>$1</i>');
const marked = (text: string, circle: string, under: string) => {
  let html = labels(text);
  if (circle && text.includes(circle)) html = html.replace(esc(circle), `<b class="tp-mk" data-tp-circle>${esc(circle)}</b>`);
  if (under && text.includes(under)) html = html.replace(esc(under), `<b class="tp-mk" data-tp-under>${esc(under)}</b>`);
  return html;
};

function mount(body: HTMLElement, initial: PuzzleContext): PuzzleKindHandle {
  let ctx = initial;
  const tr = ctx.tr;
  const params = ctx.params ?? {};
  const COUNT = Math.max(4, Math.min(5, Math.round(Number(params.pieceCount) || 4)));
  const IDS = Array.from({ length: COUNT }, (_, i) => i + 1);
  const seed = Math.max(1, Math.round(Number(params.tearSeed) || 1));
  const flipped = new Set<number>((Array.isArray(params.flipped) ? params.flipped : []).map(Number));
  const partner = IDS.includes(Number(params.partnerPiece)) ? Number(params.partnerPiece) : 0;
  const geo = buildGeo(COUNT, seed);
  const LAY = LAYOUTS(COUNT);
  // pieces start in shuffled slots (seeded), so where a piece lies never hints where it goes
  const slotOrder = (() => { const r = rng(seed + 101); const s = IDS.slice(); for (let i = s.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [s[i], s[k]] = [s[k], s[i]]; } return s; })();
  const slotOf = (id: number, lay: 'desk' | 'phone'): [number, number, number] => {
    const L = LAY[lay];
    const c = L.sc[slotOrder[id - 1]];
    const g = geo.pc[id];
    return [clamp(c[0], 6, L.w - g.bw - 6), clamp(c[1], 6, L.h - g.bh - 6), c[2]];
  };

  const doc = params.doc ?? {};
  const docLines: string[] = (Array.isArray(doc.lines) ? doc.lines : []).slice(0, 3).map(String);
  const stamp: string[] = Array.isArray(doc.stamp) && doc.stamp.length === 3 ? doc.stamp.map(String) : [];
  const note = params.note ?? {};
  const noteText = String(note.text ?? '');
  const noteMark = String(note.mark ?? '');
  const find = params.find ?? {};

  // ---- state ----
  let lay: 'desk' | 'phone' = window.innerWidth < 672 ? 'phone' : 'desk';
  let k = 1;
  let fit = 'all';
  const pieces: Record<number, PieceState> = {};
  IDS.forEach((id) => {
    const c = slotOf(id, lay);
    pieces[id] = { x: c[0], y: c[1], jit: c[2], turns: flipped.has(id) ? 1 : 0, placed: false, fx: '', slap: false };
  });
  let order = IDS.slice();
  let sel = 0;
  let dragId = 0;
  let tilt = 0;
  let snapId = 0;
  let sent: 'no' | 'wait' | 'yes' = partner ? (ctx.run?.handedOff ? 'yes' : 'no') : 'yes';
  let done = false;
  let fin = false;
  let flashId = 0;
  let flashAB = 'a';
  let bump = '';
  let kick = tr('STEP 1', 'BƯỚC 1');
  let text = tr('The torn pieces lie on the table. Drag each one into the frame.', 'Các mảnh giấy xé đã trải trên bàn. Kéo từng mảnh vào khung ghép.');
  let tone: PuzzleTone = 'info';
  let submitting = false;
  let hintsSeen = (ctx.run?.hints ?? []).length;
  let alive = true;
  let raf = 0;
  let drag: null | { id: number; pid: number; k: number; rl: number; rt: number; ox: number; oy: number; sx: number; sy: number; nx: number; ny: number; moved: boolean; vx: number; px: number; type: string; el: HTMLElement } = null;
  let lastTap: { id: number; t: number } | null = null;
  let lastType = 'mouse';
  let askKey = false;
  const timers = new Map<string, number>();
  const later = (key: string, ms: number, fn: () => void) => {
    const old = timers.get(key);
    if (old) window.clearTimeout(old);
    timers.set(key, window.setTimeout(() => { timers.delete(key); if (alive) fn(); }, ms));
  };
  const reduced = () => Boolean(ctx.reducedMotion);

  // ---- markup ----
  const paperHtml = () => `
    <span class="tp-bd"></span>
    <span class="tp-hd"><b>${esc(doc.head || tr('NOTE', 'GHI CHÚ'))}</b>${doc.sub ? ` · ${esc(doc.sub)}` : ''}</span>
    <span class="tp-rule"></span>
    ${doc.meta ? `<span class="tp-meta">${labels(String(doc.meta))}</span>` : ''}
    ${doc.to ? `<span class="tp-to">${labels(String(doc.to))}</span><span class="tp-dot tp-d1"></span>` : ''}
    ${docLines.map((line, i) => `<span class="tp-msg tp-m${docLines.length === 3 ? i + 1 : i === 0 ? 1 : 2}${docLines.length === 3 && i === 1 ? ' is-mid' : ''}">${marked(line, String(doc.circle ?? ''), String(doc.underline ?? ''))}</span>`).join('')}
    ${doc.sign ? `<span class="tp-msg tp-m4">${labels(String(doc.sign))}</span>` : ''}
    ${stamp.length ? `<svg class="tp-pm" viewBox="-32 -32 64 64" aria-hidden="true" focusable="false"><circle r="30.5"></circle><circle class="pm-i" r="28.2"></circle><path d="M-27.4 -7H27.4M-27.4 7H27.4"></path><text y="-11.5">${esc(stamp[0])}</text><text class="pm-c" y="4">${esc(stamp[1])}</text><text y="17.6">${esc(stamp[2])}</text></svg>` : ''}
    ${noteText || noteMark ? `<span class="tp-pen" style="left: ${Math.max(150, Math.round(382 - (noteText.length + noteMark.length + 1) * 7.6))}px">${esc(noteText)}${noteMark ? ` <span class="tp-pen-u">${esc(noteMark)}</span>` : ''}</span>` : ''}`;
  const paper = paperHtml();
  const pieceHtml = (id: number) => {
    const g = geo.pc[id];
    const vb = `0 0 ${g.bw} ${g.bh}`;
    return `
      <div class="tp-pc" data-tp-pc="${id}" style="width: ${g.bw}px; height: ${g.bh}px">
        <div class="tp-lift" data-tp-lift>
          <svg class="tp-fib" viewBox="${vb}" aria-hidden="true" focusable="false"><path d="${g.fib}"></path><path class="tp-fib-b" d="${g.burn}"></path></svg>
          <button type="button" class="tp-hit" data-piece="${id}" style="clip-path: ${g.co}" aria-describedby="tp-keys">
            <span class="tp-fw"><span class="tp-face" data-tp-face style="clip-path: ${g.ci}">
              <span class="tp-paper" style="left: ${-g.bx}px; top: ${-g.by}px">${paper}</span>
              <span class="tp-curl tp-curl${((id - 1) % 5) + 1}"></span>
            </span></span>
            <svg class="tp-burn" viewBox="${vb}" aria-hidden="true" focusable="false"><path d="${g.burn}"></path><path class="tp-burn-b" d="${g.burn}"></path></svg>
            <svg class="tp-char" viewBox="${vb}" aria-hidden="true" focusable="false"><path d="${g.burn}"></path><path class="tp-char-b" d="${g.burn}"></path></svg>
          </button>
        </div>
        <svg class="tp-ring" viewBox="${vb}" aria-hidden="true" focusable="false"><polygon class="tp-ring-a" points="${g.pts}"></polygon><polygon class="tp-ring-b" points="${g.pts}"></polygon></svg>
        ${id === partner ? '<span class="tp-tvtag" aria-hidden="true"><span class="g-mono rust">ĐĐ</span></span>' : ''}
      </div>`;
  };

  const root = document.createElement('div');
  root.className = 'tp-root';
  root.innerHTML = `
    <div class="tp-col" data-tp-col>
      <article class="pz-card tp-card tp-mine">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <span class="tp-ck">${esc(find.tag || tr('EVIDENCE', 'VẬT CHỨNG'))}</span>
        <h3>${esc(find.title || tr('A torn sheet', 'Mẩu giấy bị xé'))}</h3>
        <p>${esc(find.text || tr('Someone tore this sheet apart. Put it back together to read it.', 'Ai đó đã xé vụn tờ giấy này. Ghép lại để đọc được nội dung.'))}</p>
        <span class="pz-tag mine">${esc(find.mine || tr('YOUR FIND', 'BẠN TÌM THẤY'))}</span>
      </article>
      <article class="pz-card tp-card tp-partner" data-tp-partner ${partner ? '' : 'hidden'}>
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="tp-who"><span class="g-mono rust" aria-hidden="true">ĐĐ</span><div><b>${esc(tr('Your partner', 'Đồng đội'))}</b><small>${esc(tr('HOLDS ONE PIECE', 'ĐANG GIỮ 1 MẢNH'))}</small></div></div>
        <p>${esc(params.partnerNote || tr('Your partner found one more piece somewhere else.', 'Đồng đội nhặt được thêm một mảnh ở nơi khác.'))}</p>
        <span class="pz-tag partner">${esc(tr('SHARED · PARTNER', 'ĐÃ CHIA SẺ · ĐỒNG ĐỘI'))}</span>
        <button type="button" class="s-btn s-btn-red tp-ask" data-tp-ask></button>
      </article>
      <div class="tp-keys" id="tp-keys">
        <b>${esc(tr('KEYBOARD', 'BÀN PHÍM'))}</b>
        <div class="tp-krow"><span class="tp-kb">Tab</span>${esc(tr('select a piece', 'chọn mảnh'))}</div>
        <div class="tp-krow"><span class="tp-kb">← ↑ → ↓</span>${esc(tr('move 10px', 'dời 10px'))} · <span class="tp-kb">Shift</span>50px</div>
        <div class="tp-krow"><span class="tp-kb">R</span>${esc(tr('turn 180°', 'xoay 180°'))}</div>
        <div class="tp-krow"><span class="tp-kb">Enter</span>${esc(tr('try it in the frame', 'thử ghép vào khung'))}</div>
      </div>
      <div class="tp-acts" data-tp-acts>
        <button type="button" class="s-btn s-btn-gold s-btn-sm" data-tp-rot><span aria-hidden="true">↻</span>${esc(tr('Turn piece', 'Xoay mảnh'))}</button>
        <button type="button" class="s-btn s-btn-gold s-btn-sm" data-tp-tidy>${esc(tr('Gather loose pieces', 'Xếp lại mảnh rời'))}</button>
      </div>
    </div>
    <div class="tp-stage" data-tp-stage>
      <div class="tp-fit" data-tp-fit>
        <div class="tp-board" data-tp-board role="group" aria-label="${esc(tr('Work mat: the frame and the torn pieces', 'Bàn ghép: khung và các mảnh giấy bị xé'))}">
          <svg class="tp-grain" aria-hidden="true" focusable="false"><filter id="tp-kraft" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.007 0.01" numOctaves="3" seed="2" result="n1"></feTurbulence><feColorMatrix in="n1" type="matrix" values="0 0 0 0 .42  0 0 0 0 .27  0 0 0 0 .11  1 0 0 0 -0.42" result="mott"></feColorMatrix><feTurbulence type="fractalNoise" baseFrequency="0.7 0.3" numOctaves="3" seed="5" result="n2"></feTurbulence><feColorMatrix in="n2" type="matrix" values="0 0 0 0 .34  0 0 0 0 .22  0 0 0 0 .08  -1.5 0 0 0 .88" result="fib"></feColorMatrix><feMerge><feMergeNode in="mott"></feMergeNode><feMergeNode in="fib"></feMergeNode></feMerge></filter><rect width="100%" height="100%" filter="url(#tp-kraft)" opacity=".45"></rect><path class="tp-hair" d="${hairs()}"></path></svg>
          <span class="tp-prog" data-tp-prog style="left: 14px; top: 14px"><span data-tp-progtx></span><span class="tp-ticks" aria-hidden="true">${IDS.map((id) => `<i data-tp-tick="${id}"></i>`).join('')}</span></span>
          <div class="tp-frame" data-tp-frame aria-hidden="true">
            <span class="tp-frame-bg"></span>
            <svg class="tp-outline" viewBox="-16 -16 432 316" focusable="false">
              <rect class="tp-o2" x="0.8" y="-0.6" width="399" height="285"></rect>
              <rect class="tp-o1" x="0" y="0" width="400" height="284"></rect>
              <path class="tp-crop" d="M-12 0H-4M0 -12V-4M412 0H404M400 -12V-4M-12 284H-4M0 296V288M412 284H404M400 296V288"></path>
              <path class="tp-tick" d="M50 -7V-2M100 -9V-2M150 -7V-2M200 -9V-2M250 -7V-2M300 -9V-2M350 -7V-2"></path>
            </svg>
            <span class="tp-flbl">${esc(tr('FRAME', 'KHUNG GHÉP'))}</span>
            <span class="tp-fdim">A5 · 210 × 148</span>
          </div>
          <svg class="tp-decor" viewBox="0 0 872 600" aria-hidden="true" focusable="false">
            <defs>
              <filter id="tp-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"></feGaussianBlur></filter>
              <radialGradient id="tp-rollg" cx="50%" cy="50%" r="50%"><stop offset="56%" stop-color="#d9c48f"></stop><stop offset="70%" stop-color="#e8d7a8"></stop><stop offset="86%" stop-color="#dcc690"></stop><stop offset="100%" stop-color="#c9b077"></stop></radialGradient>
              <linearGradient id="tp-penb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d5a47"></stop><stop offset=".45" stop-color="#2b4334"></stop><stop offset="1" stop-color="#1b2b21"></stop></linearGradient>
            </defs>
            <g transform="translate(560 528)">
              <ellipse cx="6" cy="10" rx="44" ry="41" style="fill: rgba(46,26,6,.42)" filter="url(#tp-soft)"></ellipse>
              <circle r="41" style="fill: url(#tp-rollg)"></circle>
              <circle r="41" style="fill: none; stroke: rgba(120,92,44,.35); stroke-width: 1"></circle>
              <circle r="33" style="fill: none; stroke: rgba(255,255,255,.22); stroke-width: 1"></circle>
              <circle r="23.5" style="fill: #a07a46"></circle>
              <circle r="19" style="fill: #b38c56; stroke: rgba(60,38,12,.45); stroke-width: 1.5"></circle>
              <path d="M30 28L56 40L50 52L24 37Z" style="fill: rgba(232,216,172,.88)"></path>
            </g>
            <g transform="translate(276 566) rotate(-8)">
              <rect x="6" y="5" width="180" height="11" rx="2" style="fill: rgba(46,26,6,.35)" filter="url(#tp-soft)"></rect>
              <path d="M0 5.5L22 0H24V11H22Z" style="fill: #e3c69a"></path>
              <path d="M0 5.5L7 3.7V7.3Z" style="fill: #2b2b2b"></path>
              <rect x="24" y="0" width="128" height="11" style="fill: url(#tp-penb)"></rect>
              <rect x="24" y="3.6" width="128" height="1" style="fill: rgba(255,255,255,.14)"></rect>
              <rect x="152" y="-0.5" width="16" height="12" style="fill: #c7a24b"></rect>
              <rect x="155" y="-0.5" width="1.5" height="12" style="fill: #5e4a1c"></rect>
              <rect x="163" y="-0.5" width="1.5" height="12" style="fill: #5e4a1c"></rect>
              <rect x="168" y="0" width="12" height="11" rx="2" style="fill: #9e3f2a"></rect>
            </g>
          </svg>
          <span class="tp-paper" data-tp-measure aria-hidden="true" style="visibility: hidden; left: -2000px; top: 0">${paper}</span>
          ${IDS.map(pieceHtml).join('')}
          <div class="tp-tapes" data-tp-tapes aria-hidden="true">${IDS.map((id) => {
            const t = geo.pc[id].tape;
            return `<span class="tp-tape" data-tp-tape="${id}" hidden style="left: ${f1(t.x - t.w / 2)}px; top: ${t.y}px; width: ${t.w}px; --r: ${t.r}deg"></span>`;
          }).join('')}</div>
          <div class="tp-over" data-tp-over aria-hidden="true">
            <svg class="tp-tgts" viewBox="0 0 400 284" focusable="false">${IDS.map((id) => `<polygon class="tp-tgt" data-tp-tgt="${id}" points="${geo.pc[id].sheetPts}"></polygon>`).join('')}</svg>
            <div class="tp-done" data-tp-done hidden>
              <svg class="tp-seams" viewBox="0 0 400 284" focusable="false"><path d="${geo.seam}"></path></svg>
              <span class="tp-dim"></span>
              <span class="tp-glow"></span>
              <span class="tp-sweep"><i></i></span>
              <svg class="tp-circle" viewBox="0 0 400 284" focusable="false"><path pathLength="1" data-tp-ink d=""></path><path class="tp-ul" pathLength="1" data-tp-ul d=""></path></svg>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  body.appendChild(root);

  const $ = <T extends Element>(q: string) => root.querySelector<T>(q)!;
  const col = $<HTMLElement>('[data-tp-col]');
  const stage = $<HTMLElement>('[data-tp-stage]');
  const fitEl = $<HTMLElement>('[data-tp-fit]');
  const board = $<HTMLElement>('[data-tp-board]');
  const frameEls = ['[data-tp-frame]', '[data-tp-tapes]', '[data-tp-over]'].map((q) => $<HTMLElement>(q));
  const prog = $<HTMLElement>('[data-tp-prog]');
  const progTx = $<HTMLElement>('[data-tp-progtx]');
  const askBtn = $<HTMLButtonElement>('[data-tp-ask]');
  const partnerCard = $<HTMLElement>('[data-tp-partner]');
  const rotBtn = $<HTMLButtonElement>('[data-tp-rot]');
  const tidyBtn = $<HTMLButtonElement>('[data-tp-tidy]');
  const doneEl = $<HTMLElement>('[data-tp-done]');
  const pcEls: Record<number, { wrap: HTMLElement; lift: HTMLElement; hit: HTMLButtonElement; face: HTMLElement; tape: HTMLElement; tgt: SVGPolygonElement; tick: HTMLElement }> = {};
  IDS.forEach((id) => {
    const wrap = root.querySelector<HTMLElement>(`[data-tp-pc="${id}"]`)!;
    pcEls[id] = {
      wrap,
      lift: wrap.querySelector<HTMLElement>('[data-tp-lift]')!,
      hit: wrap.querySelector<HTMLButtonElement>('.tp-hit')!,
      face: wrap.querySelector<HTMLElement>('[data-tp-face]')!,
      tape: root.querySelector<HTMLElement>(`[data-tp-tape="${id}"]`)!,
      tgt: root.querySelector<SVGPolygonElement>(`[data-tp-tgt="${id}"]`)!,
      tick: root.querySelector<HTMLElement>(`[data-tp-tick="${id}"]`)!,
    };
  });
  const setCls = (node: Element, cls: string) => { if (node.getAttribute('class') !== cls) node.setAttribute('class', cls); };
  const sheet = () => body.closest<HTMLElement>('.pz-sheet');

  // ---- layout + scale ----
  const stacked = () => window.matchMedia?.('(max-width: 900px)').matches ?? false;
  function relayout(next: 'desk' | 'phone') {
    const L = LAY[next];
    IDS.forEach((id) => {
      const p = pieces[id];
      const g = geo.pc[id];
      const c = slotOf(id, next);
      pieces[id] = { ...p, ...(p.placed ? { x: L.fx + g.bx, y: L.fy + g.by } : { x: c[0], y: c[1] }), fx: '' };
    });
    lay = next;
  }
  function measure() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w) return;
    const isStacked = stacked();
    const next = isStacked && w < 640 ? 'phone' : 'desk';
    if (next !== lay) relayout(next);
    const L = LAY[lay];
    let nk = isStacked ? w / L.w : Math.min(w / L.w, (h - 4) / L.h);
    nk = Math.round(Math.max(0.35, Math.min(1, nk)) * 1000) / 1000;
    k = nk;
    fit = isStacked ? 'all' : h < 400 ? 'min' : h < 582 ? 'nokeys' : 'all';
    render();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
  ro?.observe(stage);

  // phone: the sheet scrolls, so bring the mat (frame at its top) into view
  function scrollToBoard(smooth: boolean) {
    const sh = sheet();
    if (!sh || lay !== 'phone' || sh.scrollHeight <= sh.clientHeight + 1) return;
    const top = Math.max(0, Math.round(board.getBoundingClientRect().top - sh.getBoundingClientRect().top + sh.scrollTop - 10));
    if (Math.abs(top - sh.scrollTop) < 24) return;
    try { sh.scrollTo({ top, behavior: smooth && !reduced() ? 'smooth' : 'auto' }); } catch { sh.scrollTop = top; }
  }

  // ---- helpers ----
  const front = (id: number) => { order = order.filter((n) => n !== id).concat(id); };
  const visible = (id: number) => id !== partner || sent === 'yes';
  const placedCount = () => IDS.filter((id) => pieces[id].placed).length;
  const limits = (id: number) => {
    const L = LAY[lay];
    const g = geo.pc[id];
    return { x0: -g.bw * 0.35, x1: L.w - g.bw * 0.65, y0: -g.bh * 0.35, y1: L.h - g.bh * 0.65 };
  };
  const say = (k2: string, t: string, tn: PuzzleTone = 'info') => { kick = k2; text = t; tone = tn; };

  // ---- pointer: drag with rAF-coalesced updates ----
  function pieceId(e: Event) { return Number((e.currentTarget as HTMLElement)?.getAttribute('data-piece')) || 0; }
  function onDown(e: PointerEvent) {
    const id = pieceId(e);
    const p = pieces[id];
    lastType = e.pointerType || 'mouse';
    if (!p || p.placed || done || drag) return;
    if (lastType === 'mouse' && e.button !== 0) return;
    const r = board.getBoundingClientRect();
    if (!r.width) return;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* best effort */ }
    const L = LAY[lay];
    const kk = r.width / L.w;
    const lx = (e.clientX - r.left) / kk;
    const ly = (e.clientY - r.top) / kk;
    drag = { id, pid: e.pointerId, k: kk, rl: r.left, rt: r.top, ox: lx - p.x, oy: ly - p.y, sx: e.clientX, sy: e.clientY, nx: p.x, ny: p.y, moved: false, vx: 0, px: e.clientX, type: lastType, el };
    sel = id;
    front(id);
    render();
  }
  function onMove(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 4) return;
      d.moved = true;
    }
    const lim = limits(d.id);
    d.nx = clamp((e.clientX - d.rl) / d.k - d.ox, lim.x0, lim.x1);
    d.ny = clamp((e.clientY - d.rt) / d.k - d.oy, lim.y0, lim.y1);
    d.vx = d.vx * 0.55 + (e.clientX - d.px) * 0.45;
    d.px = e.clientX;
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function flush() {
    raf = 0;
    const d = drag;
    if (!d || !alive) return;
    tilt = Math.round(clamp(d.vx * 0.45, -6, 6) * 10) / 10;
    pieces[d.id] = { ...pieces[d.id], x: d.nx, y: d.ny, fx: '' };
    if (dragId !== d.id) say(tr('HOLDING', 'ĐANG CẦM'), tr(`Piece ${d.id}. Drop it near its place and it snaps in.`, `Mảnh ${d.id}. Thả gần đúng chỗ, mảnh sẽ tự khớp.`));
    dragId = d.id;
    render();
    d.vx *= 0.6;
    if (Math.abs(d.vx) > 0.4) raf = requestAnimationFrame(flush);
  }
  function onUp(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    drag = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    try { d.el.releasePointerCapture(e.pointerId); } catch { /* released */ }
    if (!d.moved) {
      dragId = 0;
      tilt = 0;
      render();
      if (d.type !== 'mouse' && e.type !== 'pointercancel') {
        const now = Date.now();
        if (lastTap && lastTap.id === d.id && now - lastTap.t < 380) { lastTap = null; rotate(d.id); } else lastTap = { id: d.id, t: now };
      }
      return;
    }
    dropPiece(d.id, d.nx, d.ny, 28 / d.k, 'ptr');
  }
  function onDbl(e: MouseEvent) { if (lastType === 'mouse') rotate(pieceId(e)); }

  function rotate(id: number, via?: string) {
    const p = pieces[id];
    if (!p || p.placed || done || !visible(id)) return;
    const turns = p.turns + 1;
    const up = turns % 2 === 0;
    const L = LAY[lay];
    const g = geo.pc[id];
    // already lying on its slot: turning it upright lets it drop straight in
    if (up && Math.hypot(p.x - (L.fx + g.bx), p.y - (L.fy + g.by)) <= 28 / (k || 1)) {
      pieces[id] = { ...p, turns };
      snap(id, via);
      return;
    }
    pieces[id] = { ...p, turns, jit: 0, fx: '' };
    sel = id;
    front(id);
    say(tr('TURNED', 'ĐÃ XOAY'), up ? tr(`Piece ${id} is upright — the text reads now.`, `Mảnh ${id} đã xuôi chiều — chữ đọc được rồi.`) : tr(`Piece ${id} is upside down.`, `Mảnh ${id} đang lộn ngược.`));
    render();
  }

  function snap(id: number, via?: string) {
    const L = LAY[lay];
    const g = geo.pc[id];
    const p = pieces[id];
    pieces[id] = { ...p, x: L.fx + g.bx, y: L.fy + g.by, jit: 0, placed: true, slap: true, fx: p.fx === 'is-settle-a' ? 'is-settle-b' : 'is-settle-a' };
    const count = placedCount();
    let t = tr(`Piece ${id} is in place — taped down.`, `Mảnh ${id} vào đúng chỗ — đã dán băng keo.`);
    if (count === COUNT - 1 && partner && !pieces[partner].placed && sent === 'no') t = tr(`Piece ${id} fits. One gap is left — your partner holds that piece.`, `Mảnh ${id} đã khớp. Còn trống một chỗ — đồng đội đang giữ mảnh đó.`);
    if (count === COUNT) t = tr('The last piece fits. Hold the sheet still under the lamp…', 'Mảnh cuối đã khớp. Giữ yên tờ giấy dưới đèn…');
    dragId = 0;
    tilt = 0;
    sel = 0;
    snapId = id;
    if (flashId === id) flashId = 0;
    bump = bump === 'a' ? 'b' : 'a';
    say(`${tr('PLACED', 'ĐÃ KHỚP')} ${count}/${COUNT}`, t, 'ok');
    render();
    later('snap', 460, () => { snapId = 0; render(); });
    if (count === COUNT) finish();
    else if (via === 'key') later('focus', 60, focusNext);
  }

  /** Snap when within ~28 screen px of its slot AND upright; otherwise it stays (straightened). */
  function dropPiece(id: number, x: number, y: number, thr: number, via: string) {
    const L = LAY[lay];
    const g = geo.pc[id];
    const p = pieces[id];
    const tx = L.fx + g.bx;
    const ty = L.fy + g.by;
    const dist = Math.hypot(x - tx, y - ty);
    const up = p.turns % 2 === 0;
    pieces[id] = { ...p, x, y };
    if (dist <= thr && up) { snap(id, via); return; }
    const cx = x + g.bw / 2;
    const cy = y + g.bh / 2;
    const onFrame = cx > L.fx - 24 && cx < L.fx + 424 && cy > L.fy - 24 && cy < L.fy + 308;
    const near = dist <= Math.max(thr * 2.6, 72);
    let fx = p.fx === 'is-nope-a' ? 'is-nope-b' : 'is-nope-a';
    if (!up && near) say(tr('UPSIDE DOWN', 'BỊ NGƯỢC'), tr(`Right place, but piece ${id} is upside down. Double-click or press R to turn it.`, `Đúng chỗ rồi, nhưng mảnh ${id} đang lộn ngược. Nhấp đúp hoặc bấm R để xoay.`), 'bad');
    else if (onFrame && !up) say(tr('NOT A FIT', 'CHƯA KHỚP'), tr(`The text on piece ${id} is upside down — turn it first.`, `Chữ trên mảnh ${id} đang lộn ngược — xoay lại trước đã.`), 'bad');
    else if (onFrame) say(tr('NOT A FIT', 'CHƯA KHỚP'), tr(`Piece ${id} does not fit here. Follow the torn and the straight edges of the sheet.`, `Mảnh ${id} không khớp ở đây. Dò theo mép xé và mép thẳng của tờ giấy.`), 'bad');
    else { say(tr('PUT DOWN', 'ĐẶT TẠM'), tr(`Piece ${id} lies outside the frame.`, `Mảnh ${id} nằm ngoài khung.`)); fx = ''; }
    pieces[id] = { ...pieces[id], jit: 0, fx };
    dragId = 0;
    tilt = 0;
    render();
  }

  function answer() {
    const L = LAY[lay];
    return IDS.map((id) => {
      const p = pieces[id];
      const g = geo.pc[id];
      return { id, x: f1(p.x - L.fx - g.bx), y: f1(p.y - L.fy - g.by), r: ((p.turns * 180 + p.jit) % 360 + 360) % 360 };
    });
  }

  function finish() {
    if (submitting) return;
    submitting = true;
    ctx.submit({ placed: answer() })
      .then((result) => {
        submitting = false;
        if (!alive) return;
        if (!result.solved) {
          say(tr('NOT YET', 'CHƯA LIỀN'), result.message || tr('The sheet is not whole yet.', 'Tờ giấy chưa liền.'), 'bad');
          render();
          return;
        }
        complete(true);
      })
      .catch((error) => {
        submitting = false;
        if (!alive) return;
        say(tr('NOT SENT', 'CHƯA GỬI'), error?.message || tr('Could not reach the server.', 'Không gửi được tới máy chủ.'), 'bad');
        render();
      });
  }

  /** Measures the circled / underlined words once, then reveals the pencil note. */
  function drawInk() {
    const m = root.querySelector<HTMLElement>('[data-tp-measure]');
    const box = (q: string) => {
      const b = m?.querySelector<HTMLElement>(q);
      const host = b?.offsetParent as HTMLElement | null;
      if (!b || !host) return null;
      return { x: host.offsetLeft + b.offsetLeft, y: host.offsetTop + b.offsetTop, w: b.offsetWidth, h: b.offsetHeight || 21 };
    };
    const c = box('[data-tp-circle]');
    const u = box('[data-tp-under]');
    if (c) {
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2 + 1;
      const rx = c.w / 2 + 16;
      const ry = c.h / 2 + 9;
      const pts: string[] = [];
      for (let i = 0; i <= 72; i++) {
        const t = Math.PI * 0.92 + (i / 72) * Math.PI * 2 * 1.1;
        const wob = 1 + 0.035 * Math.sin(i * 0.7);
        pts.push(`${f1(cx + Math.cos(t) * rx * wob)} ${f1(cy + Math.sin(t) * ry * wob * (1 - (i / 72) * 0.08))}`);
      }
      root.querySelector('[data-tp-ink]')!.setAttribute('d', 'M' + pts.join('L'));
    }
    if (u) {
      const y = u.y + u.h + 3;
      root.querySelector('[data-tp-ul]')!.setAttribute('d', `M${f1(u.x - 2)} ${f1(y)} Q${f1(u.x + u.w / 2)} ${f1(y + 1.6)} ${f1(u.x + u.w + 2)} ${f1(y - 0.4)} L${f1(u.x + u.w + 6)} ${f1(y - 3.4)}`);
    }
  }

  function complete(animated: boolean) {
    IDS.forEach((id) => {
      const L = LAY[lay];
      const g = geo.pc[id];
      pieces[id] = { ...pieces[id], x: L.fx + g.bx, y: L.fy + g.by, jit: 0, turns: 0, placed: true, slap: animated };
    });
    sent = 'yes';
    drawInk();
    const finalText = noteText || noteMark
      ? tr(`The sheet is whole. Under the lamp a pencil note shows: “${[noteText, noteMark].filter(Boolean).join(' ')}”.`, `Tờ giấy đã liền. Dưới ánh đèn hiện ra nét bút chì: “${[noteText, noteMark].filter(Boolean).join(' ')}”.`)
      : tr('The sheet is whole again.', 'Tờ giấy đã liền lại.');
    if (!animated || reduced()) {
      done = true;
      fin = true;
      sel = 0;
      flashId = 0;
      say(tr('DONE', 'HOÀN TẤT'), finalText, 'ok');
      render();
      return;
    }
    later('view', 300, () => scrollToBoard(true));
    later('done', 320, () => { done = true; sel = 0; flashId = 0; say(tr('DONE', 'HOÀN TẤT'), finalText, 'ok'); render(); });
  }

  function focusNext() {
    const next = IDS.find((n) => !pieces[n].placed && visible(n));
    if (next) pcEls[next].hit.focus({ preventScroll: true });
    else if (sent === 'no') askBtn.focus({ preventScroll: true });
  }

  function onPieceKey(e: KeyboardEvent) {
    const id = pieceId(e);
    const p = pieces[id];
    if (!p || p.placed || done) return;
    const key = e.key;
    const step = e.shiftKey ? 50 : 10;
    let dx = 0;
    let dy = 0;
    if (key === 'ArrowLeft') dx = -step;
    else if (key === 'ArrowRight') dx = step;
    else if (key === 'ArrowUp') dy = -step;
    else if (key === 'ArrowDown') dy = step;
    if (dx || dy) {
      e.preventDefault();
      const lim = limits(id);
      pieces[id] = { ...p, x: clamp(p.x + dx, lim.x0, lim.x1), y: clamp(p.y + dy, lim.y0, lim.y1), fx: '' };
      sel = id;
      front(id);
      render();
      return;
    }
    if (key === 'r' || key === 'R') { e.preventDefault(); e.stopPropagation(); rotate(id, 'key'); return; }
    if (key === 'Enter') { e.preventDefault(); dropPiece(id, p.x, p.y, 28 / (k || 1), 'key'); }
  }
  function onPieceFocus(e: FocusEvent) {
    const id = pieceId(e);
    if (id && sel !== id && pieces[id] && !pieces[id].placed) { sel = id; render(); }
  }
  function onBodyKey(e: KeyboardEvent) {
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && sel) {
      const t = e.target as HTMLElement;
      if (t?.closest?.('[data-piece]')) return;
      rotate(sel);
    }
  }

  function askPartner(e: MouseEvent) {
    if (!partner || sent !== 'no' || done) return;
    askKey = e.detail === 0; // Enter/Space: hand focus to the new piece when it lands
    sent = 'wait';
    say(tr('WAITING', 'CHỜ ĐỒNG ĐỘI'), tr('Waiting for your partner…', 'Đang chờ đồng đội gửi mảnh…'));
    render();
    ctx.probe({ handoff: true })
      .then((result) => {
        if (!alive) return;
        if (!result?.feedback?.handedOff) {
          sent = 'no';
          say(tr('NO PIECE', 'CHƯA NHẬN ĐƯỢC'), result?.message || tr('The piece did not arrive.', 'Mảnh giấy chưa tới.'), 'bad');
          render();
          return;
        }
        arrive(true);
      })
      .catch((error) => {
        if (!alive) return;
        sent = 'no';
        say(tr('NOT SENT', 'CHƯA GỬI'), error?.message || tr('Could not reach the server.', 'Không gửi được tới máy chủ.'), 'bad');
        render();
      });
  }

  function arrive(animated: boolean) {
    if (!partner || sent === 'yes') return;
    sent = 'yes';
    pieces[partner] = { ...pieces[partner], fx: animated && !reduced() ? 'is-arrive' : '' };
    front(partner);
    say(tr('FROM YOUR PARTNER', 'ĐỒNG ĐỘI GỬI'), tr(`Piece ${partner} from your partner is on the table. Drag it into the frame.`, `Mảnh ${partner} của đồng đội đã tới bàn. Kéo nó vào khung.`), 'ok');
    render();
    later('look', 30, () => {
      scrollToBoard(true);
      if (askKey) { askKey = false; pcEls[partner].hit.focus({ preventScroll: true }); }
    });
    later('arrive', 1100, () => { if (pieces[partner].fx === 'is-arrive') { pieces[partner] = { ...pieces[partner], fx: '' }; render(); } });
  }

  function tidy() {
    IDS.forEach((id) => {
      const p = pieces[id];
      if (p.placed) return;
      const c = slotOf(id, lay);
      pieces[id] = { ...p, x: c[0], y: c[1], jit: c[2], fx: '' };
    });
    say(tr('GATHERED', 'XẾP LẠI'), tr('The loose pieces are back around the frame.', 'Các mảnh rời đã về quanh khung.'));
    render();
  }

  // ---- view ----
  let lastStatus = '';
  function render() {
    if (!alive) return;
    root.classList.toggle('tp-rm', reduced());
    const L = LAY[lay];
    const count = placedCount();
    fitEl.style.width = `${Math.round(L.w * k)}px`;
    fitEl.style.height = `${Math.round(L.h * k)}px`;
    board.style.width = `${L.w}px`;
    board.style.height = `${L.h}px`;
    board.style.transform = `scale(${k})`;
    setCls(board, `tp-board lay-${lay}${done ? ' is-done' : ''}${fin ? ' is-final' : ''}${dragId ? ' is-dragging' : ''}`);
    setCls(col, 'tp-col' + (fit === 'min' ? ' is-tight is-tighter' : fit === 'nokeys' ? ' is-tight' : ''));
    frameEls.forEach((node) => { node.style.left = `${L.fx}px`; node.style.top = `${L.fy}px`; });
    progTx.textContent = `${tr('Placed', 'Đã khớp')} ${count}/${COUNT}`;
    setCls(prog, 'tp-prog' + (bump ? ` bump-${bump}` : ''));
    const level = Math.max(hintsSeen, (ctx.run?.hints ?? []).length);
    IDS.forEach((id) => {
      const p = pieces[id];
      const g = geo.pc[id];
      const e = pcEls[id];
      const isDrag = dragId === id;
      const ang = p.turns * 180 + p.jit + (isDrag ? tilt + 1.5 : 0);
      const cls = ['tp-pc', p.placed ? 'is-placed' : 'is-loose'];
      if (isDrag) cls.push('is-drag');
      if (sel === id && !p.placed) cls.push('is-sel');
      if (snapId === id) cls.push('is-snapping');
      setCls(e.wrap, cls.join(' '));
      e.wrap.hidden = !visible(id);
      e.wrap.style.zIndex = String(p.placed ? (snapId === id && !done ? 30 : 2) : isDrag ? 40 : 10 + order.indexOf(id));
      e.wrap.style.transform = `translate(${f1(p.x)}px, ${f1(p.y)}px) rotate(${f1(ang)}deg) scale(${isDrag ? 1.04 : 1})`;
      setCls(e.lift, 'tp-lift' + (p.fx ? ` ${p.fx}` : ''));
      e.face.style.clipPath = done ? g.co : g.ci;
      e.hit.disabled = p.placed || done;
      e.hit.setAttribute('aria-label', tr(
        `Piece ${id}${id === partner ? " (your partner's)" : ''} — ${p.placed ? 'in place' : 'loose' + (p.turns % 2 ? ', upside down' : '')}`,
        `Mảnh ${id}${id === partner ? ' của đồng đội' : ''} — ${p.placed ? 'đã khớp' : 'chưa đặt' + (p.turns % 2 ? ', đang bị ngược' : '')}`));
      e.tape.hidden = !p.placed;
      setCls(e.tape, 'tp-tape' + (p.placed && p.slap ? ' is-slap' : ''));
      setCls(e.tgt, 'tp-tgt' + (level >= 2 && flashId === id && !p.placed ? ` is-on fl-${flashAB}` : ''));
      setCls(e.tick, id <= count ? 'on' : '');
    });
    doneEl.hidden = !done;
    // partner card + actions
    partnerCard.hidden = !partner;
    setCls(partnerCard, 'pz-card tp-card tp-partner' + (partner && count === COUNT - 1 && sent === 'no' && !done ? ' is-call' : ''));
    askBtn.disabled = sent !== 'no' || done;
    setCls(askBtn, 's-btn s-btn-red tp-ask' + (sent === 'wait' ? ' is-wait' : sent === 'yes' ? ' is-got' : ''));
    askBtn.innerHTML = sent === 'wait' ? `${esc(tr('Waiting for your partner…', 'Đang chờ đồng đội…'))}<span class="tp-wait" aria-hidden="true"><i></i></span>`
      : sent === 'yes' ? `✓ ${esc(tr(`Got piece ${partner}`, `Đã nhận mảnh ${partner}`))}` : esc(tr('Ask your partner for the piece', 'Nhờ đồng đội gửi mảnh'));
    const selP = sel ? pieces[sel] : null;
    const canRot = !!(selP && !selP.placed && !done && visible(sel));
    rotBtn.disabled = !canRot;
    rotBtn.setAttribute('aria-label', canRot ? tr(`Turn piece ${sel} 180 degrees`, `Xoay mảnh ${sel} 180 độ`) : tr('Turn a piece: select one first', 'Xoay mảnh: hãy chọn một mảnh trước'));
    tidyBtn.disabled = done || !IDS.some((id) => !pieces[id].placed && visible(id));
    rotBtn.hidden = done;
    tidyBtn.hidden = done;
    const line = `${kick} · ${text}`;
    if (line !== lastStatus) { lastStatus = line; ctx.setStatus(line, tone); }
  }

  // ---- wiring ----
  const listeners: [EventTarget, string, EventListener][] = [];
  const on = (target: EventTarget, type: string, fn: EventListener) => { target.addEventListener(type, fn); listeners.push([target, type, fn]); };
  IDS.forEach((id) => {
    const hit = pcEls[id].hit;
    on(hit, 'pointerdown', onDown as EventListener);
    on(hit, 'pointermove', onMove as EventListener);
    on(hit, 'pointerup', onUp as EventListener);
    on(hit, 'pointercancel', onUp as EventListener);
    on(hit, 'dblclick', onDbl as EventListener);
    on(hit, 'keydown', onPieceKey as EventListener);
    on(hit, 'focus', onPieceFocus as EventListener);
  });
  on(body, 'keydown', onBodyKey as EventListener);
  on(askBtn, 'click', askPartner as EventListener);
  on(rotBtn, 'click', () => { if (sel) rotate(sel); });
  on(tidyBtn, 'click', tidy);

  if (ctx.solved) complete(false);
  measure();
  render();

  return {
    update(next) {
      ctx = next;
      const hints = (next.run?.hints ?? []).length;
      if (hints >= 2 && hints > hintsSeen) {
        // second hint: flash the outline of the first missing piece
        flashId = IDS.find((n) => !pieces[n].placed && visible(n)) || 0;
        flashAB = flashAB === 'a' ? 'b' : 'a';
      }
      hintsSeen = hints;
      if (partner && next.run?.handedOff && sent !== 'yes') arrive(true);
      if (next.solved && !done && !submitting) complete(false); // the partner finished it
      render();
    },
    unmount() {
      alive = false;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      if (raf) cancelAnimationFrame(raf);
      drag = null;
      ro?.disconnect();
      listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
      root.remove();
    },
  };
}

const tornPaper: PuzzleKindModule = {
  kind: 'torn_paper',
  label: { en: 'Torn paper', vi: 'Ghép mảnh giấy' },
  mount,
};

export default tornPaper;
