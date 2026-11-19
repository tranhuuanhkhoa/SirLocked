/**
 * P6 · Bộ bánh răng đồng hồ (port of design/project/PuzzleGears.dc.html, prefix gp-).
 * The board (pegs, tray, crank and hand gear) comes from the server's verified layout library; the
 * mesh/train rules below are the mockup's, and the server re-runs them on the submitted mount
 * ({mount:{peg:gearId}}) when the hands reach the target or when a turn ends in a jam/kink.
 */
import './gear_train.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleTone } from '../types';

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const text = (obj: any, key: string, fallback: string) => (obj && typeof obj[key] === 'string' && obj[key].trim() ? obj[key] : fallback);
const VX = 32;
const VW = 940;
const VH = 640;
const SHD: Record<number, number> = { 10: 52, 16: 76, 24: 108 };
const GLOW: Record<number, number> = { 10: 56, 16: 80, 24: 112 };
const TK = 0.5; // tray scale
const HANDLE_R = 104;
const HANDLE_A0 = -118;
const SIZE_WORD: Record<number, string> = { 10: 'nhỏ', 16: 'vừa', 24: 'lớn' };

interface GearDef { id: string; n: number; bent: boolean; sym: string; hl: string; tray: { x: number; y: number }; a0: number; label: string; name: string }
interface Node { id: string; x: number; y: number; n: number; peg?: string }
type Pos = Record<string, string>; // gear id → peg id | 'tray' | 'drag' | 'off'
interface Pop { t: string; x: number; y: number; tone: string; col: string }
interface State {
  pos: Pos; ang: Record<string, number>; minDeg: number; backRun: number; kink: boolean; turned: boolean; lastDir: number; strain: boolean;
  phase: 'build' | 'ring' | 'open'; rang: boolean; solved: boolean; held: string | null; cursor: string; kbPeg: string | null;
  dragId: string | null; dragX: number; dragY: number; dragPeg: string | null; cranking: boolean; auto: boolean; snap: string[];
  flash: { x: number; y: number }[]; flashN: number; jamN: number; jamAt: string | null; kinkN: number; pop: Pop | null; popN: number;
  msg: string; arg: any; tries: number; bump: number;
}

function hm(minutes: number) {
  const mm = ((Math.round(minutes) % 720) + 720) % 720;
  return { h: Math.floor(mm / 60) || 12, m: mm % 60 };
}

function mount(body: HTMLElement, ctx0: PuzzleContext): PuzzleKindHandle {
  let ctx = ctx0;
  const p = ctx.params ?? {};
  const MOD = Number(p.module) || 8;
  const TOL = Number(p.tolerance) || 1.5;
  const CLEAR = Number(p.clearance) || 8;
  const KINK = Number(p.kinkDeg) || 180;
  const FIX: Record<string, Node> = {
    drv: { id: 'drv', x: Number(p.drive?.x) || 222, y: Number(p.drive?.y) || 262, n: Number(p.drive?.teeth) || 20 },
    out: { id: 'out', x: Number(p.output?.x) || 634.7, y: Number(p.output?.y) || 220.5, n: Number(p.output?.teeth) || 12 },
  };
  const RATIO = FIX.drv.n / FIX.out.n;
  const START = (Number(p.startMin) || 0) * 6;
  const TARGET = Math.max(START + 30, (Number(p.targetMin) || 195) * 6);
  const target = hm(TARGET / 6);
  const targetWords = `${target.h} giờ ${String(target.m).padStart(2, '0')}`;
  const PEGS: Record<string, { x: number; y: number }> = {};
  const PEG_IDS: string[] = [];
  for (const peg of (p.pegs ?? []) as any[]) {
    if (!peg?.id) continue;
    PEGS[peg.id] = { x: Number(peg.x), y: Number(peg.y) };
    PEG_IDS.push(String(peg.id));
  }
  // tray: plain gears small → large, the bent one in its own compartment
  const rawTray = ((p.tray ?? []) as any[]).filter((g) => g?.id).map((g, i) => ({ id: String(g.id), n: Number(g.teeth) || 16, bent: Boolean(g.bent), a0: Number(g.a0) || 0, i }));
  const plain = rawTray.filter((g) => !g.bent).sort((a, b) => a.n - b.n || a.i - b.i);
  const bentOnes = rawTray.filter((g) => g.bent);
  const SLOTS: Record<number, number[]> = { 1: [452], 2: [312, 512], 3: [262, 422, 582], 4: [232, 372, 512, 652] };
  const slotXs = SLOTS[Math.min(4, Math.max(1, plain.length))] ?? SLOTS[4];
  const sameSize = (n: number, bent: boolean) => rawTray.filter((g) => g.n === n && g.bent === bent).length;
  const G: Record<string, GearDef> = {};
  const IDS: string[] = [];
  plain.forEach((g, i) => {
    const multi = sameSize(g.n, false) > 1;
    const k = plain.filter((o) => o.n === g.n).indexOf(g);
    G[g.id] = { id: g.id, n: g.n, bent: false, sym: `#gp-g${g.n}`, hl: `#gp-hl${g.n}`, tray: { x: slotXs[i] ?? 232 + i * 140, y: 562 }, a0: g.a0,
      label: `Bánh ${SIZE_WORD[g.n] ?? ''}`.trim(), name: `bánh ${SIZE_WORD[g.n] ?? ''} ${g.n} răng${multi && k > 0 ? ` (cái thứ ${k === 1 ? 'hai' : k + 1})` : ''}` };
    IDS.push(g.id);
  });
  bentOnes.forEach((g, i) => {
    G[g.id] = { id: g.id, n: g.n, bent: true, sym: '#gp-g16x', hl: `#gp-hl${g.n}`, tray: { x: 822 - i * 60, y: 562 }, a0: g.a0 || -14, label: 'Bánh cong', name: `bánh cong ${g.n} răng, gãy răng` };
    IDS.push(g.id);
  });
  const note = p.note ?? {};
  const witness = p.witness ?? {};
  const maker = p.maker ?? {};
  const reduced = () => ctx.reducedMotion;

  const timers: number[] = [];
  let rafPtr = 0;
  let rafTurn = 0;
  let drag: any = null;
  let focusTo: string | null = null;
  let dead = false;
  let submitting = false;

  // ---------- state ----------
  function base(): State {
    const pos: Pos = {};
    const ang: Record<string, number> = { drv: 0, out: 0 };
    IDS.forEach((id) => { pos[id] = 'tray'; ang[id] = G[id].a0; });
    return { pos, ang, minDeg: START, backRun: 0, kink: false, turned: false, lastDir: 0, strain: false,
      phase: 'build', rang: false, solved: false, held: null, cursor: PEG_IDS[0] ?? 'A', kbPeg: null,
      dragId: null, dragX: 0, dragY: 0, dragPeg: null, cranking: false, auto: false, snap: [],
      flash: [], flashN: 0, jamN: 0, jamAt: null, kinkN: 0, pop: null, popN: 0, msg: 'start', arg: null, tries: 0, bump: 0 };
  }
  let s: State = base();
  const setState = (patch: Partial<State>) => { s = { ...s, ...patch }; paint(); };

  // ---------- gear train maths (same as the mockup and GearTrainKind.cs) ----------
  const rOf = (n: number) => n * MOD / 2;
  const nOf = (id: string) => (FIX[id] ? FIX[id].n : G[id].n);
  function nodes(pos: Pos): Node[] {
    const out: Node[] = [{ ...FIX.drv }, { ...FIX.out }];
    IDS.forEach((id) => { const pg = PEGS[pos[id]]; if (pg) out.push({ id, x: pg.x, y: pg.y, n: G[id].n, peg: pos[id] }); });
    return out;
  }
  function graph(pos: Pos) {
    const ns = nodes(pos);
    const by: Record<string, Node> = {};
    const adj: Record<string, string[]> = {};
    ns.forEach((n) => { by[n.id] = n; adj[n.id] = []; });
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      if (Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - rOf(a.n) - rOf(b.n)) <= TOL) { adj[a.id].push(b.id); adj[b.id].push(a.id); }
    }
    return { ns, by, adj };
  }
  function train(pos: Pos) {
    const g = graph(pos);
    const sign: Record<string, number> = { drv: 1 };
    const parent: Record<string, string> = {};
    const order = ['drv'];
    let conflict = false;
    for (let i = 0; i < order.length; i++) {
      const u = order[i];
      g.adj[u].forEach((v) => {
        if (sign[v] == null) { sign[v] = -sign[u]; parent[v] = u; order.push(v); }
        else if (sign[v] === sign[u]) conflict = true;
      });
    }
    const bent = order.filter((id) => G[id] && G[id].bent)[0] || null;
    return { g, sign, parent, order, conflict, bent, outSign: sign.out || 0 };
  }
  function check(pos: Pos, id: string, peg: string) {
    const pg = PEGS[peg], r = rOf(G[id].n), meshes: string[] = [], hits: string[] = [];
    nodes(pos).forEach((n) => {
      if (n.id === id) return;
      const d = Math.hypot(pg.x - n.x, pg.y - n.y), sum = r + rOf(n.n);
      if (Math.abs(d - sum) <= TOL) meshes.push(n.id);
      else if (d < sum + 2 * MOD + CLEAR) hits.push(n.id);
    });
    return { meshes, hits };
  }
  /** turn child C so a tooth gap faces the parent's tooth on the line of centres */
  function alignTo(ang: Record<string, number>, P: Node, C: Node) {
    const phi = Math.atan2(C.y - P.y, C.x - P.x) * 180 / Math.PI;
    const tpP = 360 / P.n, tpC = 360 / C.n;
    const q = (phi - (ang[P.id] || 0)) / tpP;
    const pP = q - Math.floor(q);
    const baseA = phi + 180 - tpC * (0.5 - pP);
    const cur = ang[C.id] || 0;
    return baseA + Math.round((cur - baseA) / tpC) * tpC;
  }
  function applyPlace(st: State, id: string, peg: string): { ok: boolean; hits?: string[]; meshes?: string[]; bumped?: string | null; s?: State } {
    const pos = { ...st.pos, [id]: 'off' };
    let bumped: string | null = null;
    IDS.forEach((o) => { if (o !== id && pos[o] === peg) bumped = o; });
    if (bumped) pos[bumped] = 'tray';
    const chk = check(pos, id, peg);
    if (chk.hits.length) return { ok: false, hits: chk.hits };
    const before = train(pos);
    pos[id] = peg;
    const t = train(pos);
    const ang = { ...st.ang };
    const snap: string[] = [];
    if (t.sign[id] != null) {
      // joined the driven train: everything newly connected settles into mesh with its driver
      t.order.forEach((n) => { if (n === 'drv' || before.sign[n] != null) return; ang[n] = alignTo(ang, t.g.by[t.parent[n]], t.g.by[n]); snap.push(n); });
    } else if (t.g.adj[id].length) {
      // a free-spinning group: settle it around the hand gear if present, else around a neighbour
      const comp = [id];
      for (let i = 0; i < comp.length; i++) t.g.adj[comp[i]].forEach((v) => { if (comp.indexOf(v) < 0) comp.push(v); });
      const root = comp.indexOf('out') >= 0 ? 'out' : t.g.adj[id][0];
      const seen = [root];
      for (let i = 0; i < seen.length; i++) {
        const u = seen[i];
        t.g.adj[u].forEach((v) => { if (seen.indexOf(v) >= 0) return; seen.push(v); ang[v] = alignTo(ang, t.g.by[u], t.g.by[v]); snap.push(v); });
      }
    }
    return { ok: true, meshes: chk.meshes, bumped, s: { ...st, pos, ang, snap, kink: false, backRun: 0, strain: false, turned: false, held: null } };
  }
  function crankCalc(st: State, delta: number): any {
    const t = train(st.pos);
    if (t.conflict) return { jam: 'conflict', t };
    if (t.bent) return { jam: 'bent', t };
    if (t.outSign < 0 && st.kink) return { kinked: true, t };
    let d = delta, event: string | null = null;
    if (t.outSign > 0) { const need = (TARGET - st.minDeg) / RATIO; if (d >= need - 1e-6) { d = Math.max(0, need); event = 'done'; } }
    else if (t.outSign < 0) { const left = (KINK - st.backRun) / RATIO; if (d >= left - 1e-6) { d = Math.max(0, left); event = 'kink'; } }
    const ang = { ...st.ang };
    t.order.forEach((id) => { ang[id] = (ang[id] || 0) + t.sign[id] * d * FIX.drv.n / nOf(id); });
    const patch: Partial<State> = { ang, turned: true, minDeg: st.minDeg + t.outSign * d * RATIO,
      backRun: t.outSign < 0 ? st.backRun + d * RATIO : st.backRun, lastDir: t.outSign || st.lastDir || 0, strain: t.outSign < 0 };
    if (event === 'done') patch.minDeg = TARGET;
    if (event === 'kink') patch.backRun = KINK;
    return { t, d, event, patch };
  }

  // ---------- timers ----------
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => { timers.splice(timers.indexOf(t), 1); if (!dead) fn(); }, ms);
    timers.push(t);
    return t;
  };
  const clearTimers = () => { timers.splice(0).forEach((t) => clearTimeout(t)); };
  const stopPtr = () => { if (rafPtr) cancelAnimationFrame(rafPtr); rafPtr = 0; drag = null; };
  const stopTurn = () => { if (rafTurn) cancelAnimationFrame(rafTurn); rafTurn = 0; };
  const busy = () => s.phase !== 'build' || !!s.auto || submitting;

  // ---------- server ----------
  const mountOf = (pos: Pos) => { const out: Record<string, string> = {}; IDS.forEach((id) => { if (PEGS[pos[id]]) out[pos[id]] = id; }); return out; };
  /** A finished turn (hands at the target, or a jam/kink) is sent to the server, which runs the train itself. */
  function report(expectWin: boolean) {
    submitting = expectWin;
    const answer = { mount: mountOf(s.pos) };
    ctx.submit(answer).then((result) => {
      if (dead) return;
      submitting = false;
      if (result.solved) { if (!s.solved) setState({ solved: true }); return; }
      if (expectWin) {
        // the server disagrees: put the machine back so the team can try again
        setState({ phase: 'build', rang: false, minDeg: START, lastDir: 0, msg: 'server', arg: { text: result.message } });
      }
    }).catch((error: any) => {
      if (dead) return;
      submitting = false;
      if (expectWin) setState({ phase: 'build', rang: false, minDeg: START, lastDir: 0, msg: 'server', arg: { text: error?.message || ctx.tr('Could not reach the server.', 'Không gửi được kết quả — thử quay lại.') } });
    });
  }

  // ---------- placing / removing ----------
  function contact(a: { x: number; y: number; n: number }, b: { x: number; y: number; n: number }) {
    const ra = rOf(a.n), rb = rOf(b.n), k = ra / (ra + rb);
    return { x: Math.round((a.x + (b.x - a.x) * k) * 10) / 10, y: Math.round((a.y + (b.y - a.y) * k) * 10) / 10 };
  }
  function commitPlace(res: { meshes?: string[]; bumped?: string | null; s?: State }, id: string, peg: string, extra: Partial<State> = {}) {
    const ns = res.s;
    const me = { id, x: PEGS[peg].x, y: PEGS[peg].y, n: G[id].n };
    const by = graph(ns.pos).by;
    const flash = res.meshes.slice(0, 2).map((nid) => contact(me, by[nid]));
    const patch: Partial<State> = { ...ns, ...extra, dragId: null, dragPeg: null, flash, flashN: (s.flashN || 0) + 1,
      msg: res.meshes.length ? 'mesh' : 'loose', arg: { id, peg, meshes: res.meshes, bumped: res.bumped } };
    if (flash.length) Object.assign(patch, { pop: { t: 'cạch', x: flash[0].x, y: flash[0].y, tone: 'is-gold', col: '#efd486' }, popN: (s.popN || 0) + 1 });
    setState(patch);
    later(() => setState({ snap: [] }), 450);
  }
  function refuse(id: string, peg: string, hit: string, extra: Partial<State> = {}) {
    const pg = PEGS[peg];
    setState({ msg: 'hit', arg: { id, peg, hit }, pop: { t: 'chạm!', x: pg.x, y: pg.y, tone: 'is-red', col: '#e0563e' }, popN: (s.popN || 0) + 1, ...extra });
  }
  function placeHeld(peg: string) {
    const id = s.held;
    if (!id || busy()) return;
    if (s.pos[id] === peg) { setState({ held: null, msg: 'same', arg: { id, peg } }); return; }
    const res = applyPlace(s, id, peg);
    if (!res.ok) { refuse(id, peg, res.hits[0]); return; }
    commitPlace(res, id, peg);
  }
  function toTray(id: string) {
    if (!id || busy()) return;
    setState({ pos: { ...s.pos, [id]: 'tray' }, held: null, kink: false, backRun: 0, strain: false, turned: false, snap: [], msg: 'returned', arg: { id } });
  }
  function clearAll() {
    if (busy()) return;
    const pos: Pos = {};
    IDS.forEach((id) => { pos[id] = 'tray'; });
    setState({ pos, held: null, kink: false, backRun: 0, strain: false, turned: false, snap: [], msg: 'cleared', arg: null });
  }
  const occupant = (st: State, peg: string) => IDS.filter((id) => st.pos[id] === peg)[0] || null;

  // ---------- turning the crank ----------
  function jam(r: any) {
    const at = r.jam === 'bent' ? r.t.bent : 'out';
    const n = r.t.g.by[at] || FIX.out;
    setState({ jamN: (s.jamN || 0) + 1, jamAt: at, msg: r.jam, tries: (s.tries || 0) + 1, bump: (s.bump || 0) + 1, held: null,
      pop: { t: 'kẹt!', x: n.x, y: n.y, tone: 'is-red', col: '#e0563e' }, popN: (s.popN || 0) + 1, strain: false });
    report(false);
  }
  function turnBy(da: number, g: any): string {
    const r = crankCalc(s, da);
    if (r.jam) { if (!g.jam) { g.jam = true; jam(r); } return 'stop'; }
    if (r.kinked) {
      if (!g.kinkMsg) { g.kinkMsg = true; setState({ msg: 'kinked', jamN: (s.jamN || 0) + 1, jamAt: 'spring', pop: { t: 'kẹt!', x: 697, y: 168, tone: 'is-red', col: '#e0563e' }, popN: (s.popN || 0) + 1 }); }
      return 'stop';
    }
    g.moved += da;
    const patch: Partial<State> = { ...r.patch, snap: [] };
    if (r.event === 'kink') {
      Object.assign(patch, { kink: true, strain: false, kinkN: (s.kinkN || 0) + 1, msg: 'back', tries: (s.tries || 0) + 1, bump: (s.bump || 0) + 1,
        pop: { t: 'rắc!', x: 697, y: 160, tone: 'is-red', col: '#e0563e' }, popN: (s.popN || 0) + 1 });
      setState(patch);
      report(false);
      return 'stop';
    }
    if (r.event === 'done') { setState(patch); win(); return 'stop'; }
    if (r.t.outSign > 0) patch.msg = 'fwd';
    else if (r.t.outSign < 0) patch.msg = 'backing';
    else patch.msg = g.moved > 40 ? 'noconn' : 'spin';
    setState(patch);
    return '';
  }
  function autoTurn() {
    if (busy() || drag || s.solved) return;
    const t = train(s.pos);
    const g = { jam: false, kinkMsg: false, moved: 0 };
    if (t.conflict || t.bent || (t.outSign < 0 && s.kink)) { turnBy(1, g); return; }
    let total: number, dur: number;
    if (t.outSign > 0) { total = (TARGET - s.minDeg) / RATIO; dur = Math.max(900, Math.min(2600, total / 360 * 1150)); }
    else if (t.outSign < 0) { total = (KINK - s.backRun) / RATIO + 4; dur = 1000; }
    else { total = 360; dur = 1500; }
    if (reduced()) { setState({ held: null }); turnBy(total, g); return; }
    setState({ auto: true, held: null });
    const t0 = performance.now();
    let done = 0;
    const step = (now: number) => {
      rafTurn = 0;
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const want = total * e, da = want - done;
      done = want;
      let res = '';
      if (da > 0) res = turnBy(da, g);
      if (res === 'stop' || k >= 1) {
        const patch: Partial<State> = { auto: false, strain: false };
        if (res !== 'stop' && t.outSign === 0) patch.msg = 'noconn';
        if (s.phase === 'build') setState(patch); else s = { ...s, auto: false };
        return;
      }
      rafTurn = requestAnimationFrame(step);
    };
    rafTurn = requestAnimationFrame(step);
  }
  function win() {
    stopPtr();
    stopTurn();
    if (reduced()) { setState({ phase: 'open', auto: false, cranking: false, held: null, strain: false, msg: 'win' }); report(true); return; }
    setState({ phase: 'ring', rang: true, auto: false, cranking: false, held: null, strain: false, msg: 'win' });
    later(() => { setState({ phase: 'open' }); report(true); }, 1150);
  }

  // ---------- pointer: drag gears, tap gear then peg, or drag round the crank ----------
  function svgPt(e: PointerEvent) {
    const r = stage.getBoundingClientRect();
    if (!r.width) return null;
    const k = r.width / VW;
    return { x: (e.clientX - r.left) / k + VX, y: (e.clientY - r.top) / k, k };
  }
  function handlePos(a: number) {
    const t = ((a || 0) + HANDLE_A0) * Math.PI / 180;
    return { x: FIX.drv.x + HANDLE_R * Math.cos(t), y: FIX.drv.y + HANDLE_R * Math.sin(t) };
  }
  function center(st: State, id: string) {
    const pg = PEGS[st.pos[id]];
    return pg ? { x: pg.x, y: pg.y } : { x: G[id].tray.x, y: G[id].tray.y };
  }
  function hitTest(pt: { x: number; y: number; k: number }): any {
    const u = 1 / pt.k;
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    // with a gear in hand a tap near a peg means "put it there", even when the crank knob has swung close
    // (on a phone the knob's touch radius is large)
    if (s.held) for (const pg of PEG_IDS) if (dist(pt, PEGS[pg]) <= Math.max(34, 26 * u)) return { kind: 'peg', peg: pg };
    if (dist(pt, handlePos(s.ang.drv)) <= Math.max(26, 22 * u)) return { kind: 'crank' };
    for (const id of IDS) { const pg = PEGS[s.pos[id]]; if (pg && dist(pt, pg) <= rOf(G[id].n) + 4) return { kind: 'gear', id }; }
    if (dist(pt, FIX.drv) <= rOf(FIX.drv.n) + 10) return { kind: 'crank' };
    for (const id of IDS) { if (s.pos[id] !== 'tray') continue; if (dist(pt, G[id].tray) <= Math.max(rOf(G[id].n) * TK + 12, 24 * u)) return { kind: 'gear', id }; }
    for (const pg of PEG_IDS) if (dist(pt, PEGS[pg]) <= Math.max(34, 26 * u)) return { kind: 'peg', peg: pg };
    if (pt.y >= 496) return { kind: 'tray' };
    return null;
  }
  function nearPeg(x: number, y: number) {
    let best: string | null = null, bd = 74;
    PEG_IDS.forEach((pg) => { const d = Math.hypot(x - PEGS[pg].x, y - PEGS[pg].y); if (d < bd) { bd = d; best = pg; } });
    return best;
  }
  const angAt = (pt: { x: number; y: number }) => Math.atan2(pt.y - FIX.drv.y, pt.x - FIX.drv.x) * 180 / Math.PI;
  function pDown(e: PointerEvent) {
    if (busy() || drag || s.solved) return;
    if (e.button != null && e.button !== 0) return;
    const pt = svgPt(e);
    if (!pt) return;
    const h = hitTest(pt);
    if (!h) { if (s.held) setState({ held: null, msg: 'unheld', arg: { id: s.held } }); return; }
    if (h.kind === 'peg') { if (s.held) placeHeld(h.peg); return; }
    if (h.kind === 'tray') { if (s.held && PEGS[s.pos[s.held]]) toTray(s.held); return; }
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
    if (h.kind === 'crank') {
      drag = { mode: 'crank', pid: e.pointerId, x: pt.x, y: pt.y, last: angAt(pt), jam: false, kinkMsg: false, ccw: false, moved: 0 };
      setState({ cranking: true, held: null });
      return;
    }
    const c = center(s, h.id);
    drag = { mode: 'gear', pid: e.pointerId, gid: h.id, sx: pt.x, sy: pt.y, x: pt.x, y: pt.y, ox: pt.x - c.x, oy: pt.y - c.y, moved: false, from: s.pos[h.id] };
  }
  function pMove(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    const pt = svgPt(e);
    if (!pt) return;
    d.x = pt.x;
    d.y = pt.y;
    if (!rafPtr) rafPtr = requestAnimationFrame(() => { rafPtr = 0; frame(); });
  }
  function frame() {
    const d = drag;
    if (!d) return;
    if (d.mode === 'gear') {
      if (!d.moved) { if (Math.hypot(d.x - d.sx, d.y - d.sy) < 6) return; d.moved = true; }
      const gx = Math.round((d.x - d.ox) * 10) / 10, gy = Math.round((d.y - d.oy) * 10) / 10;
      const patch: Partial<State> = { dragId: d.gid, dragX: gx, dragY: gy, dragPeg: nearPeg(gx, gy) };
      if (s.dragId !== d.gid) {
        // lifting it off a peg changes the train
        Object.assign(patch, { pos: { ...s.pos, [d.gid]: 'drag' }, held: null, msg: 'lift', arg: { id: d.gid } });
        if (PEGS[d.from]) Object.assign(patch, { kink: false, backRun: 0, strain: false, turned: false });
      }
      setState(patch);
      return;
    }
    let da = angAt(d) - d.last;
    while (da > 180) da -= 360;
    while (da < -180) da += 360;
    d.last = angAt(d);
    if (Math.abs(da) < 0.05) return;
    if (da < 0) { if (!d.ccw && da < -1.5) { d.ccw = true; setState({ msg: 'ratchet' }); } return; }
    if (d.jam || d.kinkMsg || d.stop) return;
    if (turnBy(da, d) === 'stop') d.stop = true;
  }
  function pUp(e: PointerEvent) {
    const d = drag;
    if (!d || (e && e.pointerId !== d.pid)) return;
    if (rafPtr) { cancelAnimationFrame(rafPtr); rafPtr = 0; frame(); }
    drag = null;
    try { stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d.mode === 'crank') { if (s.phase === 'build') setState({ cranking: false, strain: false }); else s = { ...s, cranking: false }; return; }
    if (s.phase !== 'build') return;
    if (!d.moved) {
      if (s.held === d.gid) setState({ held: null, msg: 'unheld', arg: { id: d.gid } });
      else setState({ held: d.gid, msg: 'held', arg: { id: d.gid } });
      return;
    }
    const peg = s.dragPeg;
    const baseS = { ...s, dragId: null, dragPeg: null };
    if (peg) {
      const res = applyPlace(baseS, d.gid, peg);
      // its tray button disappears, so keep focus inside the dialog (C still works)
      if (res.ok) { if (d.from === 'tray') focusTo = `peg-${peg}`; commitPlace(res, d.gid, peg); return; }
      refuse(d.gid, peg, res.hits[0], { pos: { ...s.pos, [d.gid]: 'tray' }, dragId: null, dragPeg: null });
      return;
    }
    setState({ pos: { ...s.pos, [d.gid]: 'tray' }, dragId: null, dragPeg: null, msg: PEGS[d.from] ? 'returned' : 'start', arg: { id: d.gid } });
  }

  // ---------- keyboard ----------
  function trayKey(id: string, e: KeyboardEvent) {
    const k = e.key;
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (busy()) return;
      if (s.held === id) { setState({ held: null, msg: 'unheld', arg: { id } }); return; }
      const cur = s.cursor || PEG_IDS[0];
      const free = occupant(s, cur) ? (PEG_IDS.filter((pg) => !occupant(s, pg))[0] || cur) : cur;
      focusTo = `peg-${free}`;
      setState({ held: id, cursor: free, msg: 'held', arg: { id } });
      return;
    }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const list = IDS.filter((x) => s.pos[x] === 'tray');
      const i = list.indexOf(id);
      if (i < 0 || !list.length) return;
      focusTo = `tray-${list[(i + (k === 'ArrowRight' ? 1 : -1) + list.length) % list.length]}`;
      paint();
    }
  }
  function pegKey(peg: string, e: KeyboardEvent) {
    const k = e.key;
    const nav: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (nav[k]) {
      e.preventDefault();
      const i = PEG_IDS.indexOf(peg);
      const nx = PEG_IDS[(i + nav[k] + PEG_IDS.length) % PEG_IDS.length];
      focusTo = `peg-${nx}`;
      setState({ cursor: nx, kbPeg: nx });
      return;
    }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (busy()) return;
      if (s.held) { placeHeld(peg); return; }
      const occ = occupant(s, peg);
      if (occ) { setState({ held: occ, msg: 'held', arg: { id: occ } }); return; }
      setState({ msg: 'emptyPeg', arg: { peg } });
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (busy()) return;
      const occ = occupant(s, peg);
      if (occ) toTray(occ);
      else setState({ msg: 'emptyPeg', arg: { peg } });
    }
  }

  // ---------- markup ----------
  const pct = (x: number, y: number) => `left: ${((x - VX) / VW * 100).toFixed(2)}%; top: ${(y / VH * 100).toFixed(2)}%`;
  const gearShadow = (id: string) => { const n = G[id].n; const o = n === 24 ? [7, 10] : n === 10 ? [5, 8] : [6, 9]; return `<g class="gp-sh" data-sh="${esc(id)}"><circle cx="${o[0]}" cy="${o[1]}" r="${G[id].bent ? 78 : SHD[n] ?? 76}" fill="url(#gp-rg-shd)"></circle></g>`; };
  const gearSvg = (id: string) => `<g class="gp-gr" data-gr="${esc(id)}"><g class="gp-shk"><g class="gp-rot"><use href="${G[id].sym}"></use></g><use href="${G[id].hl}"></use><circle class="gp-glow" r="${G[id].bent ? 82 : GLOW[G[id].n] ?? 80}"></circle></g></g>`;
  const legendGroups: { key: string; ids: string[]; teeth: number; bent: boolean }[] = [];
  IDS.forEach((id) => {
    const key = `${G[id].n}-${G[id].bent}`;
    const found = legendGroups.find((g) => g.key === key);
    if (found) found.ids.push(id); else legendGroups.push({ key, ids: [id], teeth: G[id].n, bent: G[id].bent });
  });
  const legendIcon = (g: { teeth: number; bent: boolean }) => {
    const r = g.bent ? 76 : g.teeth === 10 ? 50 : g.teeth === 24 ? 106 : 74;
    return `<svg class="gp-lg-ic" viewBox="${-r} ${-r} ${2 * r} ${2 * r}" aria-hidden="true"><use href="${g.bent ? '#gp-g16x' : `#gp-g${g.teeth}`}"></use></svg>`;
  };
  const legendText = (g: { teeth: number; bent: boolean; ids: string[] }) => g.bent
    ? '<b>Cong</b> · gãy răng'
    : `<b>${(SIZE_WORD[g.teeth] ?? '').replace(/^./, (c) => c.toUpperCase())}${g.ids.length > 1 ? ` ×${g.ids.length}` : ''}</b> · ${g.teeth} răng`;

  body.classList.add('gp-host');
  body.innerHTML = `
    <aside class="gp-clues" aria-label="${esc(ctx.tr('Clues about the clockwork', 'Manh mối về bộ máy đồng hồ'))}">
      <article class="pz-card s-paper gp-card-a">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <span class="pz-tag mine" style="margin-top: 0">${esc(text(note, 'tag', 'RIÊNG · ĐIỀU TRA VIÊN'))}</span>
        <h3 style="margin-top: 4px">${esc(text(note, 'title', 'Ghi chú trên khay đồ nghề'))}</h3>
        <div class="gp-scrap"><p>${esc(text(note, 'text', '‘Đủ bánh cho một đường — đừng dùng bánh cong.’'))}</p></div>
        <p class="gp-cap">${esc(text(note, 'caption', 'Mẩu giấy kẹp dưới đáy khay, nét bút chì.'))}</p>
      </article>
      <article class="pz-card s-paper gp-card-b">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="gp-from"><span class="g-mono rust" aria-hidden="true">${esc(text(witness, 'mono', 'TV'))}</span><span class="pz-tag partner" style="margin-top: 0">${esc(text(witness, 'tag', 'ĐÃ CHIA SẺ · THẨM VẤN VIÊN'))}</span></div>
        <p class="gp-quote">${esc(text(witness, 'text', `Người gác chuông khai: đồng hồ dừng đúng ${targetWords} đêm qua, và kim chạy ngược khi ông thử sửa.`))}</p>
      </article>
      <article class="pz-card s-paper gp-card-c">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>Khay đồ nghề</h3>
        <ul class="gp-legend">${legendGroups.map((g, i) => `<li data-lg="${i}">${legendIcon(g)}<span>${legendText(g)}</span><em></em></li>`).join('')}</ul>
        <p class="gp-rule">Hai bánh chỉ ăn khớp khi khoảng cách hai trục vừa bằng tổng hai bán kính.</p>
        <p class="gp-keys">PHÍM · Tab · Enter cầm/lắp · ←→ chọn trục · Delete gỡ · C quay</p>
      </article>
    </aside>

    <section class="gp-sec" aria-label="${esc(ctx.tr('Back plate of the clockwork', 'Tấm lưng bộ máy đồng hồ'))}">
      <div class="gp-mat" data-gp="mat">
        <div class="gp-top">
          <p class="gp-chain"><span class="gp-ck">ĐƯỜNG TRUYỀN</span>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="gp-cc is-off" data-cc="${i}"><span></span><i></i></span>`).join('')}</p>
          <p class="gp-time" data-gp="time"><span class="gp-lamp" data-gp="lamp" aria-hidden="true"></span>MẶT SỐ <b data-gp="clock"></b><span class="gp-dirw" data-gp="dirw"></span></p>
        </div>
        <div class="gp-xwrap">
          <div class="gp-stage" data-gp="stage">
            <svg class="gp-art" viewBox="32 0 940 640" aria-hidden="true">
                      <defs>
                        <g id="gp-g10"><path d="M29.3 -6.6 L46.6 -4.2 Q49.4 0 46.1 4.2 L29.4 6.6 Q28.8 9.4 27.5 11.8 L40.3 23.9 Q39.5 28.6 35.1 30.7 L19.9 22.6 Q17.8 24.6 15.3 25.7 L18.4 43.2 Q15.1 46.6 10.4 45.3 L2.7 30.1 Q0.1 30.1 -2.7 30.1 L-10.4 45.6 Q-15.2 47 -18.6 43.2 L-15.2 25.7 Q-17.6 24.2 -19.8 22.6 L-35 30.6 Q-39.8 29.1 -40.2 24.1 L-27.5 11.8 Q-29.2 9.5 -29.2 6.7 L-46.1 4.1 Q-49 -0.1 -46.3 -4.2 L-29.1 -6.7 Q-28.5 -9.2 -27.7 -11.9 L-39.8 -23.7 Q-39.6 -28.9 -35.4 -31 L-19.7 -22.6 Q-17.9 -24.6 -15.3 -25.6 L-18.1 -42.6 Q-15.1 -46.5 -10.4 -45.2 L-2.7 -30.1 Q-0.1 -30.3 2.8 -29.9 L10.5 -45.8 Q15.2 -46.8 18.4 -43 L15.2 -25.4 Q18 -24.6 19.8 -22.8 L34.9 -30.5 Q40 -29.1 40.4 -24.1 L27.8 -11.9 Q28.4 -9.3 29.4 -6.7Z M25.4 6.5 A4.4 4.4 0 1 1 16.6 6.5 A4.4 4.4 0 1 1 25.4 6.5Z M-11.7 15 A4.4 4.4 0 1 1 -20.5 15 A4.4 4.4 0 1 1 -11.7 15Z M-0.5 -21.5 A4.4 4.4 0 1 1 -9.3 -21.5 A4.4 4.4 0 1 1 -0.5 -21.5Z" fill="#c29a47" fill-rule="evenodd" stroke="#1a110b" stroke-width="2.6" stroke-linejoin="round"></path><path d="M29.3 -6.6 L46.6 -4.2 Q49.4 0 46.1 4.2 L29.4 6.6 Q28.8 9.4 27.5 11.8 L40.3 23.9 Q39.5 28.6 35.1 30.7 L19.9 22.6 Q17.8 24.6 15.3 25.7 L18.4 43.2 Q15.1 46.6 10.4 45.3 L2.7 30.1 Q0.1 30.1 -2.7 30.1 L-10.4 45.6 Q-15.2 47 -18.6 43.2 L-15.2 25.7 Q-17.6 24.2 -19.8 22.6 L-35 30.6 Q-39.8 29.1 -40.2 24.1 L-27.5 11.8 Q-29.2 9.5 -29.2 6.7 L-46.1 4.1 Q-49 -0.1 -46.3 -4.2 L-29.1 -6.7 Q-28.5 -9.2 -27.7 -11.9 L-39.8 -23.7 Q-39.6 -28.9 -35.4 -31 L-19.7 -22.6 Q-17.9 -24.6 -15.3 -25.6 L-18.1 -42.6 Q-15.1 -46.5 -10.4 -45.2 L-2.7 -30.1 Q-0.1 -30.3 2.8 -29.9 L10.5 -45.8 Q15.2 -46.8 18.4 -43 L15.2 -25.4 Q18 -24.6 19.8 -22.8 L34.9 -30.5 Q40 -29.1 40.4 -24.1 L27.8 -11.9 Q28.4 -9.3 29.4 -6.7Z" fill="none" stroke="rgba(26,17,11,.5)" stroke-width="1" transform="translate(1.3 -1) rotate(.6)"></path><path d="M26.8 0 A26.8 26.8 0 1 1 26.8 -0.2" fill="none" stroke="#6e5220" stroke-width="1.3" stroke-dasharray="36.6 6.4" opacity=".85"></path><path d="M-6.1 -18.1 L-1.6 -20.2 M-19.3 -4.2 L-18.5 -9.1 M7.8 -23.7 L12.1 -21 M21.1 -1.8 L19.9 3.1 M-21.7 -7.4 L-19.3 -11.7 M21 -2.4 L21 2.6 M13.9 18.2 L10.4 21.9 M22.9 10.6 L20.1 14.7 M-9.3 -22.6 L-4.3 -22.8 M16.5 -4.3 L18.1 0.5 M-17.9 -9.3 L-15.3 -13.6 M-16.9 -1.1 L-17.2 -6.1 M-17.9 6.9 L-19.3 2.1 M-5.5 -19.5 L-0.6 -20.7" stroke="#6e5220" stroke-width="1" stroke-linecap="round" opacity=".55"></path><g fill="#7a3d1d" opacity="0.45"><ellipse cx="-16" cy="-10" rx="3.2" ry="2.3" transform="rotate(80 -16 -10)"></ellipse><ellipse cx="0.7" cy="22.9" rx="1.8" ry="1.5" transform="rotate(116 0.7 22.9)"></ellipse><ellipse cx="15.7" cy="0.3" rx="1.5" ry="1.4" transform="rotate(24 15.7 0.3)"></ellipse><ellipse cx="6.7" cy="-15.1" rx="2.5" ry="2.3" transform="rotate(133 6.7 -15.1)"></ellipse><ellipse cx="5.8" cy="-14.1" rx="1.4" ry="1.2" transform="rotate(39 5.8 -14.1)"></ellipse><ellipse cx="14" cy="12" rx="1.4" ry="1.3" transform="rotate(115 14 12)"></ellipse><ellipse cx="-3.9" cy="-21.1" rx="2.7" ry="2.4" transform="rotate(69 -3.9 -21.1)"></ellipse></g><circle r="13" fill="#d8b866" stroke="#1a110b" stroke-width="2.2"></circle><circle r="8.5" fill="none" stroke="rgba(60,40,10,.55)" stroke-width="1.1"></circle><circle cx="3.5" cy="3.6" r="2.2" fill="#2a1d0c"></circle><path d="M1.9 2.4 L5.1 4.8" stroke="#d9c08a" stroke-width=".8"></path><circle r="6.4" fill="#120c07"></circle></g>
<g id="gp-g12"><path d="M37 -7.1 L54.7 -4.3 Q56.9 -0.1 54.5 4.3 L37.7 7 Q37.2 9.9 35.5 12.6 L49.6 23.8 Q49.7 28.5 45.1 30.9 L29.2 25 Q27.3 27.3 24.5 28.7 L30.7 44.9 Q28.5 49.4 23.7 49.7 L12.6 36.2 Q9.9 37.1 7.1 37.5 L4.2 54.4 Q-0.2 57.5 -4.3 54.8 L-7.1 37.2 Q-9.8 36.7 -12.6 36.1 L-23.8 49.4 Q-28.5 49.7 -30.9 45.2 L-24.9 29 Q-26.9 27 -28.5 24.5 L-45.2 31.1 Q-49.6 28.5 -49.4 23.8 L-35.6 12.4 Q-37 10 -37 6.9 L-54.8 4.1 Q-57.3 0.2 -54.2 -4.2 L-37.5 -7 Q-36.9 -9.8 -35.6 -12.5 L-49.8 -23.7 Q-49.6 -28.6 -44.8 -30.8 L-28.9 -24.8 Q-27.3 -27.4 -25 -29 L-30.6 -44.9 Q-28.6 -49.6 -23.7 -49.5 L-12.6 -35.9 Q-9.8 -36.8 -6.9 -37.1 L-4.3 -54.7 Q0.1 -56.8 4.1 -54.2 L6.9 -37 Q9.9 -36.6 12.6 -35.9 L23.8 -49.3 Q28.3 -49.2 30.8 -45.2 L24.7 -28.8 Q27.1 -27.2 28.4 -24.5 L45.2 -31 Q49.4 -28.6 49.1 -23.4 L36.2 -12.8 Q37.2 -10 37.2 -7.1Z" fill="#b38a3d" fill-rule="evenodd" stroke="#1a110b" stroke-width="2.6" stroke-linejoin="round"></path><path d="M37 -7.1 L54.7 -4.3 Q56.9 -0.1 54.5 4.3 L37.7 7 Q37.2 9.9 35.5 12.6 L49.6 23.8 Q49.7 28.5 45.1 30.9 L29.2 25 Q27.3 27.3 24.5 28.7 L30.7 44.9 Q28.5 49.4 23.7 49.7 L12.6 36.2 Q9.9 37.1 7.1 37.5 L4.2 54.4 Q-0.2 57.5 -4.3 54.8 L-7.1 37.2 Q-9.8 36.7 -12.6 36.1 L-23.8 49.4 Q-28.5 49.7 -30.9 45.2 L-24.9 29 Q-26.9 27 -28.5 24.5 L-45.2 31.1 Q-49.6 28.5 -49.4 23.8 L-35.6 12.4 Q-37 10 -37 6.9 L-54.8 4.1 Q-57.3 0.2 -54.2 -4.2 L-37.5 -7 Q-36.9 -9.8 -35.6 -12.5 L-49.8 -23.7 Q-49.6 -28.6 -44.8 -30.8 L-28.9 -24.8 Q-27.3 -27.4 -25 -29 L-30.6 -44.9 Q-28.6 -49.6 -23.7 -49.5 L-12.6 -35.9 Q-9.8 -36.8 -6.9 -37.1 L-4.3 -54.7 Q0.1 -56.8 4.1 -54.2 L6.9 -37 Q9.9 -36.6 12.6 -35.9 L23.8 -49.3 Q28.3 -49.2 30.8 -45.2 L24.7 -28.8 Q27.1 -27.2 28.4 -24.5 L45.2 -31 Q49.4 -28.6 49.1 -23.4 L36.2 -12.8 Q37.2 -10 37.2 -7.1Z" fill="none" stroke="rgba(26,17,11,.5)" stroke-width="1" transform="translate(1.3 -1) rotate(.6)"></path><path d="M34.8 0 A34.8 34.8 0 1 1 34.8 -0.3" fill="none" stroke="#644a1a" stroke-width="1.3" stroke-dasharray="33.2 7.8" opacity=".85"></path><path d="M-19.5 -2 L-19.5 -7 M19.4 22.9 L15.8 26.2 M-7.5 -29 L-2.5 -29.1 M21.2 17.9 L17 20.6 M-19 -26.1 L-15.5 -29.7 M-6 -19.3 L-1 -19.4 M5.4 -21.5 L10 -19.7 M-22.8 -16.9 L-18.7 -19.8 M-1.5 16.7 L-6.5 16.7 M14.1 -25.1 L17.3 -21.3 M9.7 17.8 L4.8 18.6 M0.5 18.7 L-4.5 19.1 M-16.2 -8 L-12.5 -11.4 M-3.4 31.7 L-8.4 31.1 M20.3 7 L17.2 10.9 M-16 -10.9 L-12.9 -14.8" stroke="#644a1a" stroke-width="1" stroke-linecap="round" opacity=".55"></path><g fill="#7a3d1d" opacity="0.45"><ellipse cx="-19.8" cy="6.6" rx="2" ry="1.8" transform="rotate(62 -19.8 6.6)"></ellipse><ellipse cx="-21.8" cy="3.3" rx="2.9" ry="2.2" transform="rotate(59 -21.8 3.3)"></ellipse><ellipse cx="11.9" cy="-14.6" rx="2.4" ry="1.5" transform="rotate(149 11.9 -14.6)"></ellipse><ellipse cx="-10.2" cy="32.5" rx="1.6" ry="1.2" transform="rotate(2 -10.2 32.5)"></ellipse><ellipse cx="21" cy="-5.9" rx="2.5" ry="2.1" transform="rotate(170 21 -5.9)"></ellipse><ellipse cx="8.3" cy="31.5" rx="2" ry="1.3" transform="rotate(71 8.3 31.5)"></ellipse><ellipse cx="-5.9" cy="13.9" rx="1.2" ry="0.8" transform="rotate(94 -5.9 13.9)"></ellipse><ellipse cx="6.3" cy="-33.2" rx="1.6" ry="1.4" transform="rotate(171 6.3 -33.2)"></ellipse></g><path d="M23.5 0 L26.7 13.7 L20.4 11.7 L20.4 11.7 L16.1 25 L11.8 20.4 L11.8 20.4 L1.5 30.1 L0 23.5 L0 23.5 L-13.7 26.7 L-11.7 20.4 L-11.7 20.4 L-25 16.2 L-20.4 11.7 L-20.4 11.7 L-30.2 1.5 L-23.5 0 L-23.5 0 L-26.9 -13.8 L-20.4 -11.7 L-20.4 -11.7 L-16.4 -25.3 L-11.8 -20.4 L-11.8 -20.4 L-1.5 -29.7 L0 -23.5 L0 -23.5 L13.6 -26.5 L11.8 -20.4 L11.8 -20.4 L25.4 -16.4 L20.4 -11.8 L20.4 -11.8 L30 -1.5 L23.5 0Z" fill="#8f9592" stroke="#1a110b" stroke-width="2" stroke-linejoin="round"></path><circle r="17" fill="#b9bdb8" stroke="#1a110b" stroke-width="1.6"></circle><circle r="11" fill="#c9a24d" stroke="#3a2a0c" stroke-width="1.4"></circle><circle r="5.5" fill="#120c07"></circle></g>
<g id="gp-g16"><path d="M53.5 -7.3 L70.2 -4 Q72.8 0 70.3 4.3 L53.6 7.5 Q53.3 10.7 52 13.5 L67.1 23.4 Q68 28 63.6 31 L46.2 27.2 Q44.9 30 42.9 32.5 L52.7 46.9 Q51.6 51.7 47.3 53.1 L32.4 43 Q29.9 44.9 27.7 46.8 L30.7 63.4 Q28.1 67.7 23.4 67.1 L13.4 52 Q10.5 52.8 7.4 53.9 L4.2 70.2 Q-0.2 72.9 -4.1 70.6 L-7.6 53.7 Q-10.5 53.3 -13.7 52.2 L-23.1 66.9 Q-27.7 67.3 -30.9 63.8 L-27.4 46.4 Q-30.4 45.3 -32.5 43.1 L-46.7 52.7 Q-51.7 51.5 -52.7 46.9 L-42.9 32.6 Q-45.5 30.3 -46.1 27.3 L-63.4 30.8 Q-67.3 27.9 -66.5 23.1 L-52.7 13.5 Q-53.2 10.4 -53.2 7.6 L-70.2 4.2 Q-73.1 -0.1 -70.2 -4.1 L-53.7 -7.6 Q-53.3 -10.6 -52.2 -13.6 L-66.8 -23.2 Q-67.6 -27.8 -63.4 -30.9 L-46.2 -27.1 Q-44.9 -29.9 -42.9 -32.4 L-53 -46.8 Q-51.6 -51.5 -46.8 -52.8 L-32.3 -42.8 Q-30.3 -45.3 -27.2 -46.2 L-30.6 -63.4 Q-27.8 -67.1 -23.1 -67.1 L-13.5 -52.1 Q-10.6 -53.5 -7.4 -53.9 L-4.1 -70.3 Q-0.1 -73.1 4.2 -70.6 L7.5 -53.7 Q10.7 -53.4 13.4 -52 L23.2 -66.5 Q28.2 -67.5 30.9 -64.1 L27.1 -46.2 Q30.4 -45.3 32.5 -42.8 L47.3 -53.1 Q51.7 -51.9 52.7 -46.9 L43.4 -32.7 Q45.3 -30.2 46.9 -27.5 L63.2 -30.8 Q67.4 -28 67.1 -23.1 L52.5 -13.5 Q53.4 -10.6 53.5 -7.5Z M35.8 16 Q40.1 18.1 37.7 22.1 A44 44 0 0 1 11.5 42 Q7.1 43.4 6.8 38.7 L8.7 20.8 Q6.4 15.7 10.3 13.5 A17 17 0 0 0 10.4 13.8 Q13.5 10.3 17.3 13.7Z M-4.8 38.8 Q-4.9 43.7 -9.7 43.3 A44 44 0 0 1 -36.7 25 Q-39.1 20.2 -35 18.2 L-16.9 14.6 Q-13 11 -9.5 14.2 A17 17 0 0 0 -9.7 13.4 Q-5.6 16.1 -7.5 20.9Z M-38.3 7.4 Q-43.1 8.9 -43.7 3.7 A44 44 0 0 1 -34.6 -27.4 Q-31.3 -30.9 -27.3 -27.9 L-19 -11.6 Q-14.4 -9 -16.3 -4.9 A17 17 0 0 0 -16 -5.3 Q-17 -0.3 -22.3 -0.4Z M-19.7 -33.7 Q-21.8 -38.2 -17.2 -40.4 A44 44 0 0 1 15.3 -41 Q19.7 -39.3 17.3 -35.3 L5.1 -21.5 Q4.1 -16.5 -1 -16.7 A17 17 0 0 0 -0.1 -17.4 Q-4.9 -16.3 -6.7 -20.6Z M25.9 -29 Q29.6 -32.5 32.9 -29.3 A44 44 0 0 1 44 2.1 Q43.5 6.6 38.2 5.9 L22.1 -1.9 Q17 -1.2 15.9 -5.6 A17 17 0 0 0 15.7 -5.5 Q14 -9.7 18 -12.8Z" fill="#9c6238" fill-rule="evenodd" stroke="#1a110b" stroke-width="2.6" stroke-linejoin="round"></path><path d="M53.5 -7.3 L70.2 -4 Q72.8 0 70.3 4.3 L53.6 7.5 Q53.3 10.7 52 13.5 L67.1 23.4 Q68 28 63.6 31 L46.2 27.2 Q44.9 30 42.9 32.5 L52.7 46.9 Q51.6 51.7 47.3 53.1 L32.4 43 Q29.9 44.9 27.7 46.8 L30.7 63.4 Q28.1 67.7 23.4 67.1 L13.4 52 Q10.5 52.8 7.4 53.9 L4.2 70.2 Q-0.2 72.9 -4.1 70.6 L-7.6 53.7 Q-10.5 53.3 -13.7 52.2 L-23.1 66.9 Q-27.7 67.3 -30.9 63.8 L-27.4 46.4 Q-30.4 45.3 -32.5 43.1 L-46.7 52.7 Q-51.7 51.5 -52.7 46.9 L-42.9 32.6 Q-45.5 30.3 -46.1 27.3 L-63.4 30.8 Q-67.3 27.9 -66.5 23.1 L-52.7 13.5 Q-53.2 10.4 -53.2 7.6 L-70.2 4.2 Q-73.1 -0.1 -70.2 -4.1 L-53.7 -7.6 Q-53.3 -10.6 -52.2 -13.6 L-66.8 -23.2 Q-67.6 -27.8 -63.4 -30.9 L-46.2 -27.1 Q-44.9 -29.9 -42.9 -32.4 L-53 -46.8 Q-51.6 -51.5 -46.8 -52.8 L-32.3 -42.8 Q-30.3 -45.3 -27.2 -46.2 L-30.6 -63.4 Q-27.8 -67.1 -23.1 -67.1 L-13.5 -52.1 Q-10.6 -53.5 -7.4 -53.9 L-4.1 -70.3 Q-0.1 -73.1 4.2 -70.6 L7.5 -53.7 Q10.7 -53.4 13.4 -52 L23.2 -66.5 Q28.2 -67.5 30.9 -64.1 L27.1 -46.2 Q30.4 -45.3 32.5 -42.8 L47.3 -53.1 Q51.7 -51.9 52.7 -46.9 L43.4 -32.7 Q45.3 -30.2 46.9 -27.5 L63.2 -30.8 Q67.4 -28 67.1 -23.1 L52.5 -13.5 Q53.4 -10.6 53.5 -7.5Z" fill="none" stroke="rgba(26,17,11,.5)" stroke-width="1" transform="translate(1.3 -1) rotate(.6)"></path><path d="M50.8 0 A50.8 50.8 0 1 1 50.8 -0.4" fill="none" stroke="#55301a" stroke-width="1.3" stroke-dasharray="38.4 6.3" opacity=".85"></path><path d="M45.7 8.1 A46.4 46.4 0 1 1 46.2 -4" fill="none" stroke="rgba(255,236,196,.22)" stroke-width="1"></path><path d="M36.8 -28.5 L40.5 -25.1 M-15.7 -46.4 L-10.8 -47.3 M-45 -16.1 L-42 -20.1 M-46.2 10.3 L-46.7 5.3 M16.4 45.2 L12.2 48 M-28.5 -38.3 L-25.1 -42 M-29.7 37.5 L-33.6 34.4 M14.9 46.6 L9.9 46.6 M-48.9 4.4 L-48.2 -0.5 M47.6 -2.2 L49 2.6 M31.6 -35.8 L35.3 -32.4 M-46.8 13.2 L-47.1 8.2 M-45.4 -15 L-43.5 -19.6 M2.4 48 L-2.5 47.3 M39.3 -29.4 L40.9 -24.7 M6.1 47.6 L1.3 49 M-10.2 47.9 L-14.5 45.4 M35 32.6 L31.3 35.9 M46.6 -16.2 L46.7 -11.2 M23.2 -42.1 L26.5 -38.4" stroke="#55301a" stroke-width="1" stroke-linecap="round" opacity=".55"></path><g fill="#7a3d1d" opacity="0.45"><ellipse cx="-14.5" cy="-48.3" rx="2.1" ry="2" transform="rotate(134 -14.5 -48.3)"></ellipse><ellipse cx="4" cy="-47.1" rx="1.9" ry="1.3" transform="rotate(168 4 -47.1)"></ellipse><ellipse cx="-10.4" cy="-48" rx="2" ry="1.6" transform="rotate(46 -10.4 -48)"></ellipse><ellipse cx="30.3" cy="-40.6" rx="2.4" ry="2.1" transform="rotate(151 30.3 -40.6)"></ellipse><ellipse cx="35.5" cy="34.8" rx="2.4" ry="2.4" transform="rotate(65 35.5 34.8)"></ellipse><ellipse cx="-38.7" cy="31.6" rx="2.6" ry="2.5" transform="rotate(30 -38.7 31.6)"></ellipse><ellipse cx="-43" cy="22.1" rx="1.5" ry="1.4" transform="rotate(118 -43 22.1)"></ellipse><ellipse cx="38.7" cy="29.9" rx="2.2" ry="1.8" transform="rotate(162 38.7 29.9)"></ellipse><ellipse cx="42.6" cy="21" rx="1.7" ry="1.4" transform="rotate(110 42.6 21)"></ellipse><ellipse cx="41.5" cy="-22.9" rx="1.6" ry="1.5" transform="rotate(125 41.5 -22.9)"></ellipse><ellipse cx="-31" cy="35.4" rx="1.2" ry="1.2" transform="rotate(52 -31 35.4)"></ellipse></g><circle r="17" fill="#c49450" stroke="#1a110b" stroke-width="2.2"></circle><circle r="12.5" fill="none" stroke="rgba(60,40,10,.55)" stroke-width="1.1"></circle><circle cx="6.3" cy="6.5" r="2.2" fill="#2a1d0c"></circle><path d="M4.7 5.3 L7.9 7.7" stroke="#d9c08a" stroke-width=".8"></path><circle r="6.4" fill="#120c07"></circle></g>
<g id="gp-g16x"><g transform="matrix(1.02 .07 -.05 .95 1.5 -1)"><path d="M56.5 -8.1 L75.2 -4.5 Q76.9 0.1 74.6 4.3 L56.5 7.8 Q57.2 11.3 55.4 14.2 L70.8 24.7 Q70.8 29.3 67.7 33 L49 28.7 Q47.3 31.6 44.8 33.9 L53.8 48 Q53 53.2 46.6 52.6 L31.9 42.5 Q29.2 43.9 26.1 44.2 L25.8 50.8 L23.5 54.2 L20 50.9 L18 54.6 L12.1 47.2 Q9.6 48.8 6.9 49.7 L-0.1 50.8 L-7.3 52.3 Q-10.4 51.8 -13.2 50.9 L-18.7 58.4 L-23.5 59.1 L-23.8 54.7 L-27.6 54.7 L-27.4 46.6 Q-29.7 44.5 -32 42.3 L-45.9 51.5 Q-50.8 50.6 -51.5 45.5 L-42.3 32 Q-43 28.7 -45.4 26.7 L-61.1 29.5 Q-64.2 26.6 -63.4 22.2 L-49.7 13 Q-50.2 10 -50.8 7.1 L-66.7 4.1 Q-68.5 -0.2 -66 -4 L-51 -7.2 Q-50 -9.8 -49.3 -12.9 L-62.6 -21.7 Q-63.7 -26.5 -59.6 -28.9 L-44.2 -26.1 Q-42.7 -28.5 -41.7 -31.4 L-51.4 -45.6 Q-49.8 -50 -45.5 -51.4 L-32.7 -43.2 Q-30.1 -44.8 -27.7 -46.9 L-30.1 -61.5 L-27.3 -65.7 L-24 -68.1 L-13.7 -53.5 Q-10.9 -54.3 -7.4 -54 L-4 -71.1 Q0.2 -72.7 4.1 -70.8 L7.3 -52.8 Q10.5 -53.1 13.3 -51.8 L23.1 -66.3 Q28.5 -68.3 31.1 -64.4 L27.3 -46.4 Q30.4 -45.4 33.6 -44.3 L47.5 -53.5 Q52.6 -52.9 54.1 -48.3 L44.8 -33.8 Q46.4 -30.9 48.4 -28.5 L66.5 -32.1 Q70.1 -29.2 70.4 -24.5 L55.3 -14.3 Q56.4 -11.2 57 -8.1Z M33.9 17.6 Q38.9 20.6 36.1 24.5 A44 44 0 0 1 9.9 42.4 Q4.4 43.8 3.7 38.1 L7 21 Q5.4 16.1 10.7 13.2 A17 17 0 0 0 9.6 14.1 Q12.9 11.1 17.6 15.1Z M-13 37.5 Q-14.4 41.6 -18.3 38.8 A44 44 0 0 1 -37.5 22.9 Q-40.3 17.7 -36.2 15.3 L-17.3 12.4 Q-13.6 10.1 -9.4 13.2 A17 17 0 0 0 -11.5 12.3 Q-7.6 15.2 -9.1 19.4Z M-37.9 4.8 Q-43.6 6.2 -43.6 1.4 A44 44 0 0 1 -33 -29.3 Q-29.3 -32.8 -25.9 -29.4 L-17.4 -12.5 Q-13.9 -9.8 -16.6 -5.6 A17 17 0 0 0 -16.4 -7 Q-16.9 -1.4 -22.7 -1.7Z M-16.8 -35.6 Q-19.4 -39.5 -14.5 -41.4 A44 44 0 0 1 17.8 -40.5 Q22.1 -38 19.2 -34.6 L5.9 -21.5 Q5.1 -16.2 0.6 -17.1 A17 17 0 0 0 0.2 -17.1 Q-3.9 -16.5 -4.4 -21.4Z M28.5 -26.4 Q31.6 -30.6 35.7 -27 A44 44 0 0 1 43.7 4 Q43 9.3 39 8.3 L21.6 -1.1 Q17 -0.2 17.1 -4.9 A17 17 0 0 0 16.6 -3.4 Q14.5 -8.8 19.4 -11.1Z" fill="#7d4527" fill-rule="evenodd" stroke="#1a110b" stroke-width="2.6" stroke-linejoin="round"></path><path d="M56.5 -8.1 L75.2 -4.5 Q76.9 0.1 74.6 4.3 L56.5 7.8 Q57.2 11.3 55.4 14.2 L70.8 24.7 Q70.8 29.3 67.7 33 L49 28.7 Q47.3 31.6 44.8 33.9 L53.8 48 Q53 53.2 46.6 52.6 L31.9 42.5 Q29.2 43.9 26.1 44.2 L25.8 50.8 L23.5 54.2 L20 50.9 L18 54.6 L12.1 47.2 Q9.6 48.8 6.9 49.7 L-0.1 50.8 L-7.3 52.3 Q-10.4 51.8 -13.2 50.9 L-18.7 58.4 L-23.5 59.1 L-23.8 54.7 L-27.6 54.7 L-27.4 46.6 Q-29.7 44.5 -32 42.3 L-45.9 51.5 Q-50.8 50.6 -51.5 45.5 L-42.3 32 Q-43 28.7 -45.4 26.7 L-61.1 29.5 Q-64.2 26.6 -63.4 22.2 L-49.7 13 Q-50.2 10 -50.8 7.1 L-66.7 4.1 Q-68.5 -0.2 -66 -4 L-51 -7.2 Q-50 -9.8 -49.3 -12.9 L-62.6 -21.7 Q-63.7 -26.5 -59.6 -28.9 L-44.2 -26.1 Q-42.7 -28.5 -41.7 -31.4 L-51.4 -45.6 Q-49.8 -50 -45.5 -51.4 L-32.7 -43.2 Q-30.1 -44.8 -27.7 -46.9 L-30.1 -61.5 L-27.3 -65.7 L-24 -68.1 L-13.7 -53.5 Q-10.9 -54.3 -7.4 -54 L-4 -71.1 Q0.2 -72.7 4.1 -70.8 L7.3 -52.8 Q10.5 -53.1 13.3 -51.8 L23.1 -66.3 Q28.5 -68.3 31.1 -64.4 L27.3 -46.4 Q30.4 -45.4 33.6 -44.3 L47.5 -53.5 Q52.6 -52.9 54.1 -48.3 L44.8 -33.8 Q46.4 -30.9 48.4 -28.5 L66.5 -32.1 Q70.1 -29.2 70.4 -24.5 L55.3 -14.3 Q56.4 -11.2 57 -8.1Z" fill="none" stroke="rgba(26,17,11,.5)" stroke-width="1" transform="translate(1.4 -1.1) rotate(.8)"></path><g fill="#b3622e" opacity="0.75"><ellipse cx="-36.4" cy="-28.3" rx="2.6" ry="1.9" transform="rotate(149 -36.4 -28.3)"></ellipse><ellipse cx="-35.1" cy="33.3" rx="4.3" ry="2.8" transform="rotate(14 -35.1 33.3)"></ellipse><ellipse cx="-41.2" cy="21.7" rx="3.4" ry="2.7" transform="rotate(42 -41.2 21.7)"></ellipse><ellipse cx="36.7" cy="-35.4" rx="5.3" ry="4.9" transform="rotate(21 36.7 -35.4)"></ellipse><ellipse cx="18.1" cy="45.7" rx="4.2" ry="2.8" transform="rotate(93 18.1 45.7)"></ellipse><ellipse cx="-48.4" cy="-7.7" rx="3.7" ry="2.7" transform="rotate(44 -48.4 -7.7)"></ellipse><ellipse cx="-43.1" cy="16.2" rx="3.4" ry="2.3" transform="rotate(59 -43.1 16.2)"></ellipse><ellipse cx="-10.8" cy="-49.5" rx="4.8" ry="3.6" transform="rotate(79 -10.8 -49.5)"></ellipse><ellipse cx="-47.3" cy="-1" rx="3.6" ry="3.4" transform="rotate(130 -47.3 -1)"></ellipse><ellipse cx="-5" cy="47.3" rx="5.2" ry="3.6" transform="rotate(31 -5 47.3)"></ellipse><ellipse cx="44" cy="-25.5" rx="4.8" ry="4.4" transform="rotate(166 44 -25.5)"></ellipse><ellipse cx="-5.4" cy="-51.2" rx="4.6" ry="4.4" transform="rotate(141 -5.4 -51.2)"></ellipse><ellipse cx="41.4" cy="-22.9" rx="3.6" ry="2.9" transform="rotate(55 41.4 -22.9)"></ellipse><ellipse cx="36.2" cy="-33.1" rx="2.8" ry="2.4" transform="rotate(179 36.2 -33.1)"></ellipse><ellipse cx="-21.9" cy="-46.8" rx="5" ry="4.7" transform="rotate(125 -21.9 -46.8)"></ellipse><ellipse cx="-4.7" cy="-48.5" rx="3.5" ry="2.5" transform="rotate(25 -4.7 -48.5)"></ellipse><ellipse cx="19.3" cy="43.6" rx="4" ry="3.5" transform="rotate(101 19.3 43.6)"></ellipse><ellipse cx="-37.8" cy="-34.7" rx="3.6" ry="2.7" transform="rotate(56 -37.8 -34.7)"></ellipse><ellipse cx="-26.8" cy="-42.9" rx="5.4" ry="5.2" transform="rotate(39 -26.8 -42.9)"></ellipse><ellipse cx="32.6" cy="37.1" rx="2" ry="1.2" transform="rotate(69 32.6 37.1)"></ellipse><ellipse cx="45.2" cy="-9.5" rx="4.8" ry="4.3" transform="rotate(33 45.2 -9.5)"></ellipse><ellipse cx="-3.6" cy="48" rx="4.6" ry="3.3" transform="rotate(136 -3.6 48)"></ellipse></g><g fill="#3e1f0f" opacity="0.6"><ellipse cx="-34.2" cy="-31.5" rx="1.8" ry="1.4" transform="rotate(113 -34.2 -31.5)"></ellipse><ellipse cx="-37.1" cy="-28.6" rx="2.7" ry="2" transform="rotate(95 -37.1 -28.6)"></ellipse><ellipse cx="-42.1" cy="28.9" rx="1.4" ry="1" transform="rotate(111 -42.1 28.9)"></ellipse><ellipse cx="49.9" cy="0.9" rx="3.4" ry="2.4" transform="rotate(137 49.9 0.9)"></ellipse><ellipse cx="17.4" cy="46.4" rx="1.5" ry="0.9" transform="rotate(147 17.4 46.4)"></ellipse><ellipse cx="50.4" cy="-3.9" rx="3.3" ry="3" transform="rotate(159 50.4 -3.9)"></ellipse><ellipse cx="13" cy="45.8" rx="1.8" ry="1.1" transform="rotate(112 13 45.8)"></ellipse><ellipse cx="40" cy="-27.9" rx="2.2" ry="1.8" transform="rotate(135 40 -27.9)"></ellipse><ellipse cx="-46" cy="8.3" rx="3.1" ry="2.3" transform="rotate(30 -46 8.3)"></ellipse><ellipse cx="26" cy="-38.5" rx="1.7" ry="1.4" transform="rotate(92 26 -38.5)"></ellipse><ellipse cx="-44.5" cy="26.4" rx="2.6" ry="1.8" transform="rotate(97 -44.5 26.4)"></ellipse><ellipse cx="-16.1" cy="48.4" rx="1.8" ry="1.6" transform="rotate(43 -16.1 48.4)"></ellipse><ellipse cx="-11.2" cy="-48.9" rx="1.3" ry="1.1" transform="rotate(4 -11.2 -48.9)"></ellipse><ellipse cx="1.4" cy="49.7" rx="1.7" ry="1.2" transform="rotate(39 1.4 49.7)"></ellipse></g><path d="M50.6 0 A50.6 50.6 0 1 1 50.6 -0.4" fill="none" stroke="#3e1f0f" stroke-width="1.3" stroke-dasharray="18 7" opacity=".8"></path><path d="M13.6 53.3 L9.1 47.1 L12.7 41.1 L10.1 44.9" fill="none" stroke="#120a05" stroke-width="2" stroke-linejoin="round"></path></g><circle cx="3" cy="-2" r="17" fill="#9a6a3a" stroke="#1a110b" stroke-width="2.2"></circle><circle cx="3" cy="-2" r="12.5" fill="none" stroke="rgba(40,20,8,.6)" stroke-width="1.1"></circle><circle cx="3" cy="-2" r="6.4" fill="#120c07"></circle></g>
<g id="gp-g20"><path d="M69.9 -7.8 L86.7 -4.2 Q89.4 0 87 4.2 L69.2 7.8 Q69.7 11 68.4 14.2 L83.6 22.6 Q84.5 27.6 81.4 30.8 L63.6 28.8 Q62.4 31.8 60.6 34.4 L72.5 47.2 Q72.4 52.4 67.2 54.1 L51.7 47.2 Q50 49.8 47.3 51.8 L54.5 67.5 Q52.1 71.9 47.6 72.5 L34.7 61.2 Q32 62.3 29 63.4 L30.9 81 Q27.7 84.7 22.6 83.6 L14.2 68.8 Q11.2 69.7 7.7 69.3 L4 87 Q-0.2 89.2 -4.2 86.4 L-7.8 69.4 Q-10.9 69.3 -14.2 68.9 L-22.6 83.5 Q-27.6 85.2 -30.7 81.3 L-28.9 63.6 Q-31.9 62.4 -34.7 61 L-47.5 72.9 Q-52.5 72.5 -54.1 67.7 L-47.5 51.9 Q-49.6 49.5 -51.6 47 L-67.5 54.5 Q-72 52.1 -72.3 47.6 L-61.2 34.8 Q-63 32 -63.8 28.8 L-80.7 30.8 Q-84.6 27.2 -84 23 L-68.2 14 Q-69.4 10.9 -69.3 7.8 L-86.9 4.3 Q-88.8 0.2 -86.4 -4.3 L-70 -7.8 Q-69.7 -11.1 -68.7 -14.3 L-83.8 -22.6 Q-84.3 -27.6 -81.3 -31.1 L-64.2 -28.9 Q-62.9 -31.9 -61 -34.6 L-72.7 -47.9 Q-71.8 -52.1 -67.4 -53.8 L-51.9 -47.1 Q-49.6 -49.6 -47.1 -51.8 L-54.2 -67.7 Q-52.4 -72.3 -47.3 -72.2 L-34.3 -60.5 Q-31.9 -62.4 -29.1 -63.7 L-30.6 -80.8 Q-27.6 -84.5 -22.7 -84 L-14 -68.4 Q-11 -69 -7.7 -69.8 L-4 -86.3 Q0.1 -89.1 4 -86.8 L7.9 -69.7 Q11.1 -69.6 14 -68.5 L22.8 -83.6 Q27.5 -84.9 30.8 -81.4 L29.1 -64.1 Q32.2 -62.8 34.5 -60.9 L47.8 -72.7 Q52.3 -71.8 54.4 -68 L46.9 -51.5 Q49.4 -49.6 52 -47.5 L67.4 -54 Q72.2 -52.4 72.6 -47.3 L60.7 -34.3 Q62.6 -31.9 63.4 -28.6 L80.9 -30.8 Q84.7 -27.7 83.6 -22.8 L68.5 -13.9 Q69.5 -11.1 69.8 -7.8Z M53 7.3 Q57.5 8 56.6 12.9 A58 58 0 0 1 38.5 44.2 Q34.1 46.9 31.5 42.5 L19.3 15.8 Q15.2 13 18.4 8.4 A20 20 0 0 0 16.3 11.7 Q18.6 7.3 23.4 8.9Z M19.8 49.3 Q21.8 53.7 16.9 55.9 A58 58 0 0 1 -18.6 54.9 Q-23.6 53 -21.5 48.2 L-4.9 24.3 Q-3.6 19.7 1.3 19.6 A20 20 0 0 0 -2.2 20.3 Q3 19.8 3.9 24.6Z M-32.4 41.6 Q-35.6 45.8 -39.9 42.1 A58 58 0 0 1 -57.4 10.5 Q-57.7 6 -52.8 5.8 L-23.2 8 Q-18.8 6.7 -16.7 11.3 A20 20 0 0 0 -18.6 7.8 Q-15.6 12.5 -19.5 15.1Z M-52.5 -7.6 Q-57.5 -8 -56.1 -13.2 A58 58 0 0 1 -37.7 -43.4 Q-34.1 -46.9 -30.8 -43 L-19.5 -15.8 Q-15.2 -13 -17.8 -8.7 A20 20 0 0 0 -16.1 -11.8 Q-18.6 -7.3 -22.9 -9.5Z M-20 -49.1 Q-21.8 -53.7 -17.3 -55.3 A58 58 0 0 1 19.2 -54.7 Q23.6 -53 21.7 -48.5 L4.4 -24.2 Q3.6 -19.7 -1.6 -19.9 A20 20 0 0 0 1.9 -19.8 Q-3 -19.8 -3.8 -24.3Z M32.8 -42.2 Q35.6 -45.8 39.5 -42.6 A58 58 0 0 1 56.8 -10.9 Q57.7 -6 52.3 -5.6 L23.4 -7.9 Q18.8 -6.7 16.2 -11.1 A20 20 0 0 0 17.9 -8.4 Q15.6 -12.5 19.4 -15.7Z" fill="#5d5a52" fill-rule="evenodd" stroke="#1a110b" stroke-width="2.6" stroke-linejoin="round"></path><path d="M69.9 -7.8 L86.7 -4.2 Q89.4 0 87 4.2 L69.2 7.8 Q69.7 11 68.4 14.2 L83.6 22.6 Q84.5 27.6 81.4 30.8 L63.6 28.8 Q62.4 31.8 60.6 34.4 L72.5 47.2 Q72.4 52.4 67.2 54.1 L51.7 47.2 Q50 49.8 47.3 51.8 L54.5 67.5 Q52.1 71.9 47.6 72.5 L34.7 61.2 Q32 62.3 29 63.4 L30.9 81 Q27.7 84.7 22.6 83.6 L14.2 68.8 Q11.2 69.7 7.7 69.3 L4 87 Q-0.2 89.2 -4.2 86.4 L-7.8 69.4 Q-10.9 69.3 -14.2 68.9 L-22.6 83.5 Q-27.6 85.2 -30.7 81.3 L-28.9 63.6 Q-31.9 62.4 -34.7 61 L-47.5 72.9 Q-52.5 72.5 -54.1 67.7 L-47.5 51.9 Q-49.6 49.5 -51.6 47 L-67.5 54.5 Q-72 52.1 -72.3 47.6 L-61.2 34.8 Q-63 32 -63.8 28.8 L-80.7 30.8 Q-84.6 27.2 -84 23 L-68.2 14 Q-69.4 10.9 -69.3 7.8 L-86.9 4.3 Q-88.8 0.2 -86.4 -4.3 L-70 -7.8 Q-69.7 -11.1 -68.7 -14.3 L-83.8 -22.6 Q-84.3 -27.6 -81.3 -31.1 L-64.2 -28.9 Q-62.9 -31.9 -61 -34.6 L-72.7 -47.9 Q-71.8 -52.1 -67.4 -53.8 L-51.9 -47.1 Q-49.6 -49.6 -47.1 -51.8 L-54.2 -67.7 Q-52.4 -72.3 -47.3 -72.2 L-34.3 -60.5 Q-31.9 -62.4 -29.1 -63.7 L-30.6 -80.8 Q-27.6 -84.5 -22.7 -84 L-14 -68.4 Q-11 -69 -7.7 -69.8 L-4 -86.3 Q0.1 -89.1 4 -86.8 L7.9 -69.7 Q11.1 -69.6 14 -68.5 L22.8 -83.6 Q27.5 -84.9 30.8 -81.4 L29.1 -64.1 Q32.2 -62.8 34.5 -60.9 L47.8 -72.7 Q52.3 -71.8 54.4 -68 L46.9 -51.5 Q49.4 -49.6 52 -47.5 L67.4 -54 Q72.2 -52.4 72.6 -47.3 L60.7 -34.3 Q62.6 -31.9 63.4 -28.6 L80.9 -30.8 Q84.7 -27.7 83.6 -22.8 L68.5 -13.9 Q69.5 -11.1 69.8 -7.8Z" fill="none" stroke="rgba(26,17,11,.5)" stroke-width="1" transform="translate(1.3 -1) rotate(.6)"></path><path d="M66.8 0 A66.8 66.8 0 1 1 66.8 -0.6" fill="none" stroke="#2c2a26" stroke-width="1.3" stroke-dasharray="37 6.7" opacity=".85"></path><path d="M59.5 10.5 A60.4 60.4 0 1 1 60.2 -5.3" fill="none" stroke="rgba(255,236,196,.22)" stroke-width="1"></path><path d="M63.6 9.5 L62.1 14.3 M-55.1 -33.9 L-52.1 -37.9 M-25.9 59.9 L-30 57.1 M44.9 46.2 L41.1 49.5 M60.8 -18.7 L62.2 -13.9 M9.8 -64.5 L14.5 -62.7 M8.8 -61.1 L13.7 -60 M-19.1 60.9 L-23.9 59.5 M37.1 49.6 L33.5 53.1 M60.1 22.7 L57.8 27.1 M-46 41.4 L-48.8 37.2 M-14 -60.8 L-9.3 -62.6 M38.8 -51.6 L41.6 -47.4 M-42 48.1 L-44.9 44.1 M47.2 -44.9 L50.1 -40.8 M63.1 -8.2 L62.9 -3.2 M62.5 11.4 L60.6 16 M20.6 57.8 L15.9 59.4 M61.6 -8.7 L63.1 -3.9 M-59.4 -17 L-57 -21.4 M59.6 24 L58.1 28.7 M-63.1 11.5 L-62.8 6.5 M43 -47.9 L46.9 -44.7 M-61.8 -5 L-60.5 -9.9" stroke="#2c2a26" stroke-width="1" stroke-linecap="round" opacity=".55"></path><g fill="#7a3d1d" opacity="0.45"><ellipse cx="-25.4" cy="-56.4" rx="2.2" ry="1.7" transform="rotate(11 -25.4 -56.4)"></ellipse><ellipse cx="63.7" cy="-5.1" rx="2.6" ry="1.7" transform="rotate(158 63.7 -5.1)"></ellipse><ellipse cx="-54.8" cy="37" rx="2.2" ry="1.7" transform="rotate(111 -54.8 37)"></ellipse><ellipse cx="8.4" cy="65.5" rx="3" ry="2.8" transform="rotate(92 8.4 65.5)"></ellipse><ellipse cx="34.7" cy="-52.7" rx="2.6" ry="2.4" transform="rotate(66 34.7 -52.7)"></ellipse><ellipse cx="18" cy="-60.6" rx="2.1" ry="1.8" transform="rotate(61 18 -60.6)"></ellipse><ellipse cx="28.5" cy="-59.5" rx="1.6" ry="1.1" transform="rotate(29 28.5 -59.5)"></ellipse><ellipse cx="-62.9" cy="-5.3" rx="2.6" ry="2.4" transform="rotate(53 -62.9 -5.3)"></ellipse><ellipse cx="-56.6" cy="28.1" rx="2.5" ry="2.3" transform="rotate(12 -56.6 28.1)"></ellipse><ellipse cx="35.3" cy="56.7" rx="2.1" ry="1.4" transform="rotate(156 35.3 56.7)"></ellipse><ellipse cx="30.5" cy="-51.9" rx="2.4" ry="1.6" transform="rotate(50 30.5 -51.9)"></ellipse><ellipse cx="-66.3" cy="-5.4" rx="2.3" ry="1.6" transform="rotate(150 -66.3 -5.4)"></ellipse><ellipse cx="60.4" cy="17.2" rx="1.7" ry="1.3" transform="rotate(132 60.4 17.2)"></ellipse><ellipse cx="39.6" cy="52.6" rx="2.8" ry="2.4" transform="rotate(102 39.6 52.6)"></ellipse></g><circle r="20" fill="#b8913f" stroke="#1a110b" stroke-width="2.2"></circle><circle r="15.5" fill="none" stroke="rgba(60,40,10,.55)" stroke-width="1.1"></circle><circle cx="8.4" cy="8.6" r="2.2" fill="#2a1d0c"></circle><path d="M6.8 7.4 L10 9.8" stroke="#d9c08a" stroke-width=".8"></path><circle r="6.4" fill="#120c07"></circle></g>
<g id="gp-g24"><path d="M85.3 -7.8 L102.2 -3.9 Q104.7 0 102.2 4.4 L85.6 8.2 Q85.7 11.5 85 14.7 L100.6 22.6 Q101.2 27.3 97.7 30.6 L80.6 30.1 Q79.9 33.3 77.9 35.9 L91 47.4 Q90.6 52.4 86.6 54.6 L70.5 49.8 Q68.6 52.8 65.8 54.9 L75.9 69.8 Q74.2 73.9 69.2 75.6 L54.5 66 Q52.4 68.6 50 70.3 L55 87.2 Q52.5 91.4 47.5 90.9 L36 78.4 Q33.2 79.6 30.1 80.7 L30.8 98.3 Q27.5 101.8 22.4 100 L14.7 84.9 Q11.4 85.4 8.2 85.6 L4.4 102.8 Q-0.1 104.9 -4.2 102.5 L-8 85.4 Q-11.3 86 -14.6 84.5 L-22.8 100.6 Q-27.2 101.1 -30.8 98 L-29.5 80.4 Q-33.1 79.3 -35.8 78.2 L-47.4 91 Q-52.4 90.8 -54.6 86.8 L-49.7 69.7 Q-52.6 68.5 -54.7 66.2 L-69.6 75.6 Q-74 74.2 -75.5 69.5 L-66.1 54.9 Q-68.4 52.3 -70.1 49.8 L-86.3 55 Q-91.2 52.8 -90.7 47.8 L-78.1 35.8 Q-79.6 32.9 -80.6 29.6 L-98.2 30.5 Q-101.1 27.3 -100 22.4 L-84.5 14.5 Q-85.3 11.2 -85.5 8 L-102.4 4.5 Q-105.4 -0.2 -102.3 -4.4 L-86.1 -8.1 Q-85.2 -11.4 -85.1 -14.4 L-99.9 -22.6 Q-101.9 -27.2 -98.1 -30.4 L-80.8 -29.7 Q-80.1 -33.3 -78 -35.8 L-90.8 -47.3 Q-91.1 -53 -86.7 -54.7 L-69.9 -49.7 Q-68.1 -52.2 -66.1 -55 L-75.8 -69.8 Q-74.5 -74.1 -69.2 -75.5 L-55.3 -66.4 Q-52.6 -68.2 -49.7 -70.5 L-55.2 -86.4 Q-52.9 -91.2 -47.6 -91.1 L-36 -77.8 Q-33.1 -79.3 -29.8 -81.1 L-30.8 -98.2 Q-27.3 -101.1 -22.3 -100 L-14.4 -85.1 Q-11.4 -85.4 -8.2 -85.8 L-4.4 -102.5 Q0 -105.3 4.5 -102.8 L7.9 -85.5 Q11.5 -85.9 14.2 -84.5 L22.3 -99.9 Q27.3 -101.3 30.5 -97.7 L29.9 -81 Q33 -79.5 36.1 -78.3 L47.6 -90.9 Q52.1 -90.8 54.8 -87 L49.6 -69.8 Q52.8 -68.5 55 -66.6 L69.6 -75.9 Q74.4 -74.7 75.8 -69.7 L66.5 -55.2 Q68.3 -52.1 70.1 -49.9 L86.5 -54.7 Q90.8 -52.7 91.1 -47.8 L78.4 -35.9 Q79.5 -33.2 80.8 -29.9 L97.8 -30.9 Q101.7 -27.2 100.4 -22.3 L84.7 -14.4 Q86 -11.2 85.3 -8.1Z M59.8 34.5 Q64 37.2 61.7 41.6 A74 74 0 0 1 19.2 71.8 Q14.7 72.5 13.6 68.1 L12.1 22.9 Q9.4 18.8 13.4 15.9 A21 21 0 0 0 11.2 17.6 Q14.8 14.9 18 18.4Z M-0.2 69.3 Q-0.2 74 -4.8 73.5 A74 74 0 0 1 -51.7 52.6 Q-55.5 49 -51.4 45.4 L-14.5 21.5 Q-11.6 17.5 -7.5 20 A21 21 0 0 0 -10.1 18.8 Q-5.5 20.3 -7.3 25.5Z M-60.1 34.3 Q-64.2 36.8 -66.7 32.2 A74 74 0 0 1 -71.9 -19.1 Q-70.2 -23.5 -65.3 -21.7 L-26.2 -1.4 Q-21 -1.3 -20.9 4.2 A21 21 0 0 0 -21.4 0.5 Q-20.3 5.3 -24.8 7.1Z M-59.9 -34.3 Q-64 -37.2 -61 -41.5 A74 74 0 0 1 -19.2 -71.2 Q-14.7 -72.5 -13.8 -67.6 L-11.9 -22.9 Q-9.4 -18.8 -13.6 -16.3 A21 21 0 0 0 -10.4 -17.6 Q-14.8 -14.9 -18.6 -18.7Z M0.5 -69.1 Q0.2 -74 4.9 -73.5 A74 74 0 0 1 52 -52.6 Q55.5 -49 51.9 -45.9 L14.3 -21.2 Q11.6 -17.5 7 -19.6 A21 21 0 0 0 9.7 -18.5 Q5.5 -20.3 6.8 -24.6Z M60.4 -34.3 Q64.2 -36.8 66.1 -32.1 A74 74 0 0 1 71.2 18.7 Q70.2 23.5 65.7 21.7 L26.2 1.1 Q21 1.3 20.7 -3.5 A21 21 0 0 0 20.7 -0.3 Q20.3 -5.3 25.3 -6.9Z" fill="#626a5b" fill-rule="evenodd" stroke="#1a110b" stroke-width="2.6" stroke-linejoin="round"></path><path d="M85.3 -7.8 L102.2 -3.9 Q104.7 0 102.2 4.4 L85.6 8.2 Q85.7 11.5 85 14.7 L100.6 22.6 Q101.2 27.3 97.7 30.6 L80.6 30.1 Q79.9 33.3 77.9 35.9 L91 47.4 Q90.6 52.4 86.6 54.6 L70.5 49.8 Q68.6 52.8 65.8 54.9 L75.9 69.8 Q74.2 73.9 69.2 75.6 L54.5 66 Q52.4 68.6 50 70.3 L55 87.2 Q52.5 91.4 47.5 90.9 L36 78.4 Q33.2 79.6 30.1 80.7 L30.8 98.3 Q27.5 101.8 22.4 100 L14.7 84.9 Q11.4 85.4 8.2 85.6 L4.4 102.8 Q-0.1 104.9 -4.2 102.5 L-8 85.4 Q-11.3 86 -14.6 84.5 L-22.8 100.6 Q-27.2 101.1 -30.8 98 L-29.5 80.4 Q-33.1 79.3 -35.8 78.2 L-47.4 91 Q-52.4 90.8 -54.6 86.8 L-49.7 69.7 Q-52.6 68.5 -54.7 66.2 L-69.6 75.6 Q-74 74.2 -75.5 69.5 L-66.1 54.9 Q-68.4 52.3 -70.1 49.8 L-86.3 55 Q-91.2 52.8 -90.7 47.8 L-78.1 35.8 Q-79.6 32.9 -80.6 29.6 L-98.2 30.5 Q-101.1 27.3 -100 22.4 L-84.5 14.5 Q-85.3 11.2 -85.5 8 L-102.4 4.5 Q-105.4 -0.2 -102.3 -4.4 L-86.1 -8.1 Q-85.2 -11.4 -85.1 -14.4 L-99.9 -22.6 Q-101.9 -27.2 -98.1 -30.4 L-80.8 -29.7 Q-80.1 -33.3 -78 -35.8 L-90.8 -47.3 Q-91.1 -53 -86.7 -54.7 L-69.9 -49.7 Q-68.1 -52.2 -66.1 -55 L-75.8 -69.8 Q-74.5 -74.1 -69.2 -75.5 L-55.3 -66.4 Q-52.6 -68.2 -49.7 -70.5 L-55.2 -86.4 Q-52.9 -91.2 -47.6 -91.1 L-36 -77.8 Q-33.1 -79.3 -29.8 -81.1 L-30.8 -98.2 Q-27.3 -101.1 -22.3 -100 L-14.4 -85.1 Q-11.4 -85.4 -8.2 -85.8 L-4.4 -102.5 Q0 -105.3 4.5 -102.8 L7.9 -85.5 Q11.5 -85.9 14.2 -84.5 L22.3 -99.9 Q27.3 -101.3 30.5 -97.7 L29.9 -81 Q33 -79.5 36.1 -78.3 L47.6 -90.9 Q52.1 -90.8 54.8 -87 L49.6 -69.8 Q52.8 -68.5 55 -66.6 L69.6 -75.9 Q74.4 -74.7 75.8 -69.7 L66.5 -55.2 Q68.3 -52.1 70.1 -49.9 L86.5 -54.7 Q90.8 -52.7 91.1 -47.8 L78.4 -35.9 Q79.5 -33.2 80.8 -29.9 L97.8 -30.9 Q101.7 -27.2 100.4 -22.3 L84.7 -14.4 Q86 -11.2 85.3 -8.1Z" fill="none" stroke="rgba(26,17,11,.5)" stroke-width="1" transform="translate(1.3 -1) rotate(.6)"></path><path d="M82.8 0 A82.8 82.8 0 1 1 82.8 -0.7" fill="none" stroke="#30362d" stroke-width="1.3" stroke-dasharray="33.5 9.4" opacity=".85"></path><path d="M75.2 13.3 A76.4 76.4 0 1 1 76.1 -6.7" fill="none" stroke="rgba(255,236,196,.22)" stroke-width="1"></path><path d="M31.9 71 L27.1 72.4 M-78.4 -8.8 L-77.4 -13.7 M54.5 -57.1 L57 -52.8 M-57.3 -52.9 L-54.6 -57.1 M-78 -6.2 L-78 -11.2 M75.9 19.7 L74.3 24.4 M39.6 -68.6 L44.2 -66.7 M-74.6 29.3 L-76.3 24.6 M48.3 -63.2 L51.6 -59.4 M79.2 4.4 L78.7 9.4 M28.4 -74.9 L33 -73 M69.5 -41.5 L71.5 -37 M-63 -45.6 L-60 -49.6 M-46.3 -62 L-42.8 -65.6 M-78.9 -9.5 L-78.6 -14.5 M-28.9 -73 L-24.7 -75.7 M-71.9 -29.9 L-69.5 -34.3 M-40.8 66.1 L-44.5 62.7 M74.1 24.6 L73.7 29.6 M-75.5 13.3 L-77.3 8.7 M-67.9 -44 L-64.4 -47.5 M-31.4 75 L-35.5 72.2 M-72.8 -23.3 L-72.5 -28.3 M68 -37 L70.1 -32.5 M-77.1 -5.1 L-76.2 -10 M13.9 76.3 L8.9 76.1 M-77.7 -24.3 L-74.9 -28.5 M53.5 -55.8 L57 -52.2" stroke="#30362d" stroke-width="1" stroke-linecap="round" opacity=".55"></path><g fill="#7a3d1d" opacity="0.45"><ellipse cx="-41.3" cy="-65.7" rx="2.5" ry="1.7" transform="rotate(51 -41.3 -65.7)"></ellipse><ellipse cx="26.8" cy="75.9" rx="2.1" ry="1.9" transform="rotate(14 26.8 75.9)"></ellipse><ellipse cx="-73.5" cy="-37.3" rx="3" ry="2.9" transform="rotate(106 -73.5 -37.3)"></ellipse><ellipse cx="63.5" cy="-51.4" rx="3.1" ry="2.7" transform="rotate(79 63.5 -51.4)"></ellipse><ellipse cx="3.2" cy="81.8" rx="2" ry="1.3" transform="rotate(97 3.2 81.8)"></ellipse><ellipse cx="-72.9" cy="22" rx="2.9" ry="2.2" transform="rotate(26 -72.9 22)"></ellipse><ellipse cx="-76.3" cy="-23.6" rx="1.6" ry="1.2" transform="rotate(8 -76.3 -23.6)"></ellipse><ellipse cx="-41.1" cy="-64.1" rx="2.6" ry="2" transform="rotate(127 -41.1 -64.1)"></ellipse><ellipse cx="18.1" cy="75.1" rx="2.1" ry="1.9" transform="rotate(172 18.1 75.1)"></ellipse><ellipse cx="-16.6" cy="-77.3" rx="3.2" ry="2.5" transform="rotate(87 -16.6 -77.3)"></ellipse><ellipse cx="70.6" cy="29.9" rx="1.7" ry="1.7" transform="rotate(4 70.6 29.9)"></ellipse><ellipse cx="75.4" cy="-16.8" rx="3.1" ry="2.9" transform="rotate(54 75.4 -16.8)"></ellipse><ellipse cx="-36.9" cy="-69" rx="2.1" ry="1.8" transform="rotate(93 -36.9 -69)"></ellipse><ellipse cx="-61.8" cy="-50.1" rx="3" ry="1.8" transform="rotate(68 -61.8 -50.1)"></ellipse><ellipse cx="-78.6" cy="-10" rx="1.4" ry="1.2" transform="rotate(90 -78.6 -10)"></ellipse><ellipse cx="-0.5" cy="78.6" rx="3.1" ry="2.6" transform="rotate(82 -0.5 78.6)"></ellipse><ellipse cx="74.5" cy="-35.5" rx="1.6" ry="1" transform="rotate(16 74.5 -35.5)"></ellipse></g><circle r="21" fill="#bf9a4c" stroke="#1a110b" stroke-width="2.2"></circle><circle r="16.5" fill="none" stroke="rgba(60,40,10,.55)" stroke-width="1.1"></circle><circle cx="9.1" cy="9.3" r="2.2" fill="#2a1d0c"></circle><path d="M7.5 8.1 L10.7 10.5" stroke="#d9c08a" stroke-width=".8"></path><circle r="6.4" fill="#120c07"></circle></g>
<g id="gp-hl10"><path d="M-21.1 -6.1 A22 22 0 0 1 8.2 -20.4" fill="none" stroke="rgba(255,238,200,.22)" stroke-width="10" stroke-linecap="round"></path><path d="M20.4 8.2 A22 22 0 0 1 -11 19.1" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="10" stroke-linecap="round"></path></g>
<g id="gp-hl12"><path d="M-32.7 -9.4 A34 34 0 0 1 12.7 -31.5" fill="none" stroke="rgba(255,238,200,.22)" stroke-width="7" stroke-linecap="round"></path><path d="M31.5 12.7 A34 34 0 0 1 -17 29.4" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="7" stroke-linecap="round"></path></g>
<g id="gp-hl16"><path d="M-47.6 -13.6 A49.5 49.5 0 0 1 18.5 -45.9" fill="none" stroke="rgba(255,238,200,.22)" stroke-width="7" stroke-linecap="round"></path><path d="M45.9 18.5 A49.5 49.5 0 0 1 -24.7 42.9" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="7" stroke-linecap="round"></path></g>
<g id="gp-hl20"><path d="M-62 -17.8 A64.5 64.5 0 0 1 24.2 -59.8" fill="none" stroke="rgba(255,238,200,.22)" stroke-width="8" stroke-linecap="round"></path><path d="M59.8 24.2 A64.5 64.5 0 0 1 -32.2 55.9" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="8" stroke-linecap="round"></path></g>
<g id="gp-hl24"><path d="M-77.4 -22.2 A80.5 80.5 0 0 1 30.2 -74.6" fill="none" stroke="rgba(255,238,200,.22)" stroke-width="9" stroke-linecap="round"></path><path d="M74.6 30.2 A80.5 80.5 0 0 1 -40.2 69.7" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="9" stroke-linecap="round"></path></g>
                        <linearGradient id="gp-lg-plate" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#4d4137"></stop><stop offset=".5" stop-color="#372d26"></stop><stop offset="1" stop-color="#241c17"></stop></linearGradient>
                        <radialGradient id="gp-rg-rust" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a0582a" stop-opacity=".62"></stop><stop offset=".6" stop-color="#7a3d1d" stop-opacity=".3"></stop><stop offset="1" stop-color="#7a3d1d" stop-opacity="0"></stop></radialGradient>
                        <linearGradient id="gp-rg-drip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a65c2c" stop-opacity=".8"></stop><stop offset="1" stop-color="#7a3d1d" stop-opacity="0"></stop></linearGradient>
                        <radialGradient id="gp-rg-shd" cx=".5" cy=".5" r=".5"><stop offset=".72" stop-color="#000" stop-opacity=".5"></stop><stop offset="1" stop-color="#000" stop-opacity="0"></stop></radialGradient>
                        <radialGradient id="gp-rg-brass" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#f3dc95"></stop><stop offset=".55" stop-color="#c39b47"></stop><stop offset="1" stop-color="#6e5420"></stop></radialGradient>
                        <radialGradient id="gp-rg-steel" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#eef1ee"></stop><stop offset=".5" stop-color="#959d9a"></stop><stop offset="1" stop-color="#3a403e"></stop></radialGradient>
                        <radialGradient id="gp-rg-face" cx=".45" cy=".4" r=".65"><stop offset="0" stop-color="#f1e7cf"></stop><stop offset=".75" stop-color="#dccaa3"></stop><stop offset="1" stop-color="#b59f73"></stop></radialGradient>
                        <radialGradient id="gp-rg-wood" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#5a3a22"></stop><stop offset="1" stop-color="#3a2414"></stop></radialGradient>
                        <radialGradient id="gp-rg-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd890" stop-opacity=".75"></stop><stop offset="1" stop-color="#ffb34d" stop-opacity="0"></stop></radialGradient>
                        <linearGradient id="gp-lg-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7b5333"></stop><stop offset=".45" stop-color="#5d3c23"></stop><stop offset="1" stop-color="#3a2414"></stop></linearGradient>
                        <linearGradient id="gp-lg-felt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14201b"></stop><stop offset=".25" stop-color="#1f2f28"></stop><stop offset="1" stop-color="#1a2822"></stop></linearGradient>
                        <linearGradient id="gp-lg-rod" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3b8b2"></stop><stop offset=".42" stop-color="#666b66"></stop><stop offset="1" stop-color="#262a28"></stop></linearGradient>
                        <linearGradient id="gp-lg-iron" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a4e44"></stop><stop offset="1" stop-color="#2c241e"></stop></linearGradient>
                        <linearGradient id="gp-lg-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6eedb"></stop><stop offset=".55" stop-color="#e3d4b1"></stop><stop offset="1" stop-color="#a99670"></stop></linearGradient>
                        <filter id="gp-f-wob" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="4" result="n"></feTurbulence><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap></filter>
                        <filter id="gp-f-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="7"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 .06  0 0 0 0 .04  0 0 0 0 .03  0 0 0 1.7 -.8"></feColorMatrix></filter>
                        <filter id="gp-f-mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".02 .03" numOctaves="4" seed="12"></feTurbulence><feColorMatrix type="matrix" values="0 0 0 0 .56  0 0 0 0 .27  0 0 0 0 .12  0 0 0 2.4 -1.3"></feColorMatrix></filter>
                        <filter id="gp-f-soft" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="7"></feGaussianBlur></filter>
                        <clipPath id="gp-cp-plate"><path d="M64 40 Q49 40 47 56 L44 456 Q44 475 63 476 L936 478 Q957 477 957 458 L960 120 Q960 101 941 100 L770 97 Q752 96 750 80 L748 58 Q746 41 729 41 Z"></path></clipPath>
                        <clipPath id="gp-cp-rod"><rect x="56" y="-7" width="90" height="14"></rect></clipPath>
                        <g id="gp-rivet"><circle r="4.8" fill="url(#gp-rg-steel)" stroke="#120c08" stroke-width="1.5"></circle><circle cx="-1.4" cy="-1.5" r="1.2" fill="rgba(255,255,255,.55)"></circle></g>
                        <g id="gp-nut"><path d="M14 0 L7 12.1 L-7 12.1 L-14 0 L-7 -12.1 L7 -12.1 Z" fill="url(#gp-rg-steel)" stroke="#120c08" stroke-width="2" stroke-linejoin="round"></path><circle r="6" fill="#2a2420" stroke="#120c08" stroke-width="1.2"></circle><circle r="3" fill="#7d837f"></circle></g>
                        <g id="gp-bush"><circle r="17" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="2.5"></circle><circle r="14" fill="url(#gp-rg-brass)" stroke="#2b1f0a" stroke-width="2"></circle><circle r="9.5" fill="none" stroke="rgba(60,40,10,.6)" stroke-width="1.1"></circle><circle r="6.5" fill="url(#gp-rg-steel)" stroke="#1a110b" stroke-width="1.4"></circle><circle cx="-1.8" cy="-2" r="1.6" fill="rgba(255,255,255,.7)"></circle></g>
                        <g id="gp-hh"><path d="M-3.4 12 L-2.8 -20 Q-10 -28 0 -42 Q10 -28 2.8 -20 L3.4 12 Z" fill="#1d1510" stroke="#0d0906" stroke-width="1"></path><circle cy="-29" r="3.2" fill="#dccaa3"></circle></g>
                        <g id="gp-mh"><path d="M-2.4 16 L-1.7 -38 L-5 -44 L0 -63 L5 -44 L1.7 -38 L2.4 16 Z" fill="#1d1510" stroke="#0d0906" stroke-width="1"></path></g>
                      </defs>

                      <!-- iron back plate -->
                      <path d="M64 40 Q49 40 47 56 L44 456 Q44 475 63 476 L936 478 Q957 477 957 458 L960 120 Q960 101 941 100 L770 97 Q752 96 750 80 L748 58 Q746 41 729 41 Z" transform="translate(10 16)" fill="#000" opacity=".55" filter="url(#gp-f-soft)"></path>
                      <g clip-path="url(#gp-cp-plate)">
                        <rect x="40" y="36" width="924" height="446" fill="url(#gp-lg-plate)"></rect>
                        <rect x="40" y="36" width="924" height="446" filter="url(#gp-f-mottle)" opacity=".34"></rect>
                        <rect x="40" y="36" width="924" height="446" filter="url(#gp-f-grain)" opacity=".7"></rect>
                        <ellipse cx="150" cy="410" rx="120" ry="70" fill="url(#gp-rg-rust)"></ellipse>
                        <ellipse cx="560" cy="80" rx="150" ry="46" fill="url(#gp-rg-rust)"></ellipse>
                        <ellipse cx="760" cy="440" rx="110" ry="60" fill="url(#gp-rg-rust)"></ellipse>
                        <ellipse cx="420" cy="300" rx="70" ry="90" fill="url(#gp-rg-rust)" opacity=".7"></ellipse>
                        <ellipse cx="930" cy="290" rx="40" ry="110" fill="url(#gp-rg-rust)"></ellipse>
                        <path d="M127 62 Q127.7 85.7 127.9 105.1 Q130.4 83.6 133 62Z" fill="url(#gp-rg-drip)"></path><path d="M287.2 62 Q289.5 101.5 291.1 133.8 Q291.9 97.9 292.8 62Z" fill="url(#gp-rg-drip)"></path><path d="M446.9 62 Q447.7 87.3 447.8 108.1 Q450.4 85 453.1 62Z" fill="url(#gp-rg-drip)"></path><path d="M607.3 62 Q609.2 96.7 610.5 125.1 Q611.6 93.5 612.7 62Z" fill="url(#gp-rg-drip)"></path><path d="M366.9 62 Q368.1 87.9 368.7 109 Q370.9 85.5 373.1 62Z" fill="url(#gp-rg-drip)"></path><path d="M955.4 150 Q956.5 187.2 957.2 217.6 Q958.9 183.8 960.6 150Z" fill="url(#gp-rg-drip)"></path>
                        <path d="M118 120 L176 108 M300 444 L372 426 M600 452 L652 436 M690 120 L712 96 M520 300 L556 286" stroke="rgba(255,230,200,.12)" stroke-width="1.2" stroke-linecap="round"></path>
                        <path d="M60 60 H952" stroke="rgba(0,0,0,0)"></path>
                        <!-- inset engraved border -->
                        <path d="M66 58 L728 58 Q734 58 734 64 L736 96 Q738 114 756 115 L938 117 Q942 117 942 121 L940 458 Q940 462 936 462 L64 460 Q60 460 60 456 L62 62 Q62 58 66 58 Z" fill="none" stroke="rgba(0,0,0,.42)" stroke-width="2"></path>
                        <path d="M67 60 L728 60 Q732 60 732 64 L734 96 Q736 116 756 117 L938 119" fill="none" stroke="rgba(255,226,190,.08)" stroke-width="1.2"></path>
                      </g>
                      <g filter="url(#gp-f-wob)">
                        <path d="M64 40 Q49 40 47 56 L44 456 Q44 475 63 476 L936 478 Q957 477 957 458 L960 120 Q960 101 941 100 L770 97 Q752 96 750 80 L748 58 Q746 41 729 41 Z" fill="none" stroke="#120c08" stroke-width="3.6" stroke-linejoin="round"></path>
                        <path d="M66 43 L728 44 Q743 44 745 58 L747 80 Q750 99 769 100 L940 103" fill="none" stroke="rgba(255,226,190,.18)" stroke-width="1.6"></path>
                        <path d="M62 46 Q53 47 51 58 L48 452" fill="none" stroke="rgba(18,12,8,.55)" stroke-width="1.2" transform="translate(-2 1)"></path>
                      </g>
                      <use href="#gp-rivet" x="50.3" y="52.4"></use><use href="#gp-rivet" x="89.6" y="52.2"></use><use href="#gp-rivet" x="129.3" y="52.1"></use><use href="#gp-rivet" x="170.4" y="51.9"></use><use href="#gp-rivet" x="210.6" y="51.6"></use><use href="#gp-rivet" x="250.4" y="52.4"></use><use href="#gp-rivet" x="290.3" y="51.2"></use><use href="#gp-rivet" x="329.9" y="51.7"></use><use href="#gp-rivet" x="370.6" y="51.7"></use><use href="#gp-rivet" x="410.4" y="52.4"></use><use href="#gp-rivet" x="449.6" y="51.2"></use><use href="#gp-rivet" x="490.5" y="51.5"></use><use href="#gp-rivet" x="529.6" y="51.4"></use><use href="#gp-rivet" x="570" y="52.8"></use><use href="#gp-rivet" x="609.6" y="51.3"></use><use href="#gp-rivet" x="650.6" y="51.7"></use><use href="#gp-rivet" x="741.9" y="104.8"></use><use href="#gp-rivet" x="957.6" y="111.8"></use><use href="#gp-rivet" x="957.5" y="151.9"></use><use href="#gp-rivet" x="958.4" y="191.3"></use><use href="#gp-rivet" x="958" y="230.5"></use><use href="#gp-rivet" x="958.2" y="268.8"></use><use href="#gp-rivet" x="958.2" y="308.8"></use><use href="#gp-rivet" x="957.7" y="348.4"></use><use href="#gp-rivet" x="958.2" y="386.5"></use><use href="#gp-rivet" x="958.7" y="426.4"></use><use href="#gp-rivet" x="937.8" y="470.6"></use><use href="#gp-rivet" x="897.2" y="469.5"></use><use href="#gp-rivet" x="857.8" y="469.6"></use><use href="#gp-rivet" x="817.7" y="469.2"></use><use href="#gp-rivet" x="776.3" y="470.4"></use><use href="#gp-rivet" x="735.9" y="470.3"></use><use href="#gp-rivet" x="695.1" y="469.3"></use><use href="#gp-rivet" x="655.8" y="470"></use><use href="#gp-rivet" x="614.7" y="470.7"></use><use href="#gp-rivet" x="574" y="470.4"></use><use href="#gp-rivet" x="535.1" y="469.7"></use><use href="#gp-rivet" x="494.1" y="470.6"></use><use href="#gp-rivet" x="454.2" y="470.1"></use><use href="#gp-rivet" x="414" y="470.3"></use><use href="#gp-rivet" x="373" y="469.4"></use><use href="#gp-rivet" x="332.2" y="470"></use><use href="#gp-rivet" x="291.6" y="469.6"></use><use href="#gp-rivet" x="252.2" y="469.4"></use><use href="#gp-rivet" x="210.8" y="469.7"></use><use href="#gp-rivet" x="171.6" y="470.2"></use><use href="#gp-rivet" x="130.6" y="469.4"></use><use href="#gp-rivet" x="90" y="470.7"></use><use href="#gp-rivet" x="43.7" y="466.3"></use><use href="#gp-rivet" x="44.4" y="424.4"></use><use href="#gp-rivet" x="44.5" y="384.7"></use><use href="#gp-rivet" x="44.2" y="342.4"></use><use href="#gp-rivet" x="43.8" y="301.8"></use><use href="#gp-rivet" x="43.3" y="260.9"></use><use href="#gp-rivet" x="44.7" y="219.7"></use><use href="#gp-rivet" x="44.4" y="178.3"></use><use href="#gp-rivet" x="44.5" y="137.4"></use><use href="#gp-rivet" x="44" y="97.5"></use>
                      <use href="#gp-nut" x="78" y="76"></use><use href="#gp-nut" x="78" y="444"></use><use href="#gp-nut" x="926" y="136"></use><use href="#gp-nut" x="712" y="76"></use>

                      <!-- etched lettering + crank direction arrow -->
                      <text class="gp-etch gp-etch-hl" x="97" y="113">MẶT SAU · BỘ MÁY GÁC CHUÔNG</text>
                      <text class="gp-etch" x="96" y="112">MẶT SAU · BỘ MÁY GÁC CHUÔNG</text>
                      <path d="M102.8 227.8 A124 124 0 0 1 167.6 150.5" fill="none" stroke="rgba(20,13,9,.8)" stroke-width="3" stroke-linecap="round"></path>
                      <path d="M104 229 A124 124 0 0 1 168.8 151.7" fill="none" stroke="rgba(255,226,190,.14)" stroke-width="1.2"></path>
                      <path d="M178.4 145.3 L163.8 142.7 L171.6 157.8 Z" fill="rgba(20,13,9,.85)"></path>
                      <text class="gp-etch" x="0" y="0" transform="translate(88 198) rotate(-62)">QUAY</text>
                      <text class="gp-etch gp-etch-hl" x="222" y="392" text-anchor="middle" transform="translate(1 1)">TAY QUAY</text>
                      <text class="gp-etch" x="222" y="392" text-anchor="middle">TAY QUAY</text>
                      <text class="gp-etch gp-etch-hl" x="717" y="265" text-anchor="middle" transform="translate(1 1)">BÁNH KIM</text>
                      <text class="gp-etch" x="717" y="265" text-anchor="middle">BÁNH KIM</text>

                      <!-- riveted repair patch -->
                      <g filter="url(#gp-f-wob)">
                        <path d="M652 414 L738 409 Q744 409 744 415 L747 458 Q747 464 741 464 L657 467 Q651 467 651 461 Z" transform="translate(4 5)" fill="rgba(0,0,0,.45)"></path>
                        <path d="M652 414 L738 409 Q744 409 744 415 L747 458 Q747 464 741 464 L657 467 Q651 467 651 461 Z" fill="url(#gp-lg-iron)" stroke="#120c08" stroke-width="2.4" stroke-linejoin="round"></path>
                        <path d="M656 418 L736 413" stroke="rgba(255,226,190,.16)" stroke-width="1.2"></path>
                      </g>
                      <ellipse cx="700" cy="452" rx="40" ry="12" fill="url(#gp-rg-rust)"></ellipse>
                      <use href="#gp-rivet" x="661" y="423"></use><use href="#gp-rivet" x="735" y="419"></use><use href="#gp-rivet" x="662" y="456"></use><use href="#gp-rivet" x="737" y="453"></use>

                      <!-- maker's plate -->
                      <g transform="rotate(-1.5 182 430)">
                        <rect x="66" y="408" width="234" height="46" rx="8" fill="url(#gp-rg-brass)" stroke="#2b1f0a" stroke-width="2"></rect>
                        <rect x="72" y="414" width="222" height="34" rx="5" fill="none" stroke="rgba(60,40,10,.55)" stroke-width="1"></rect>
                        <use href="#gp-rivet" x="78" y="431"></use><use href="#gp-rivet" x="288" y="431"></use>
                        <text class="gp-maker" x="183" y="429">${esc(text(maker, 'name', 'XƯỞNG ĐỒNG HỒ PHÚC AN'))}</text>
                        <text class="gp-maker2" x="183" y="444">${esc(text(maker, 'line', 'HUẾ · 1908 · Nº 3'))}</text>
                      </g>

                      <!-- leading-off rod to the setting dial (stripes move on the live layer) -->
                      <g transform="translate(634.7 220.5) rotate(-3.715)">
                        <rect x="40" y="-7" width="150" height="14" rx="3" fill="url(#gp-lg-rod)" stroke="#120c08" stroke-width="1.6"></rect>
                        <rect x="118" y="-11" width="16" height="22" rx="3" fill="url(#gp-rg-brass)" stroke="#2b1f0a" stroke-width="1.6"></rect>
                      </g>

              <use href="#gp-bush" x="${FIX.drv.x}" y="${FIX.drv.y}"></use>
              <use href="#gp-bush" x="${FIX.out.x}" y="${FIX.out.y}"></use>
              ${PEG_IDS.map((pg) => `<use href="#gp-bush" x="${PEGS[pg].x}" y="${PEGS[pg].y}"></use>`).join('')}
                      <!-- click-spring anchor post -->
                      <circle cx="718" cy="190" r="7" fill="url(#gp-rg-steel)" stroke="#120c08" stroke-width="1.6"></circle>

                      <!-- bell bracket -->
                      <g filter="url(#gp-f-wob)">
                        <path d="M812 102 Q810 36 858 16 Q906 36 904 102" fill="none" stroke="#120c08" stroke-width="11" stroke-linecap="round"></path>
                        <path d="M812 102 Q810 36 858 16 Q906 36 904 102" fill="none" stroke="#4a3e35" stroke-width="6" stroke-linecap="round"></path>
                        <path d="M815 96 Q814 40 858 21" fill="none" stroke="rgba(255,226,190,.2)" stroke-width="1.4"></path>
                      </g>
                      <rect x="800" y="96" width="24" height="12" rx="3" fill="url(#gp-lg-iron)" stroke="#120c08" stroke-width="1.6"></rect>
                      <rect x="892" y="96" width="24" height="12" rx="3" fill="url(#gp-lg-iron)" stroke="#120c08" stroke-width="1.6"></rect>

                      <!-- setting dial -->
                      <circle cx="864" cy="214" r="84" fill="#000" opacity=".45" filter="url(#gp-f-soft)"></circle>
                      <circle cx="858" cy="206" r="80" fill="url(#gp-rg-brass)" stroke="#1a110b" stroke-width="2.6"></circle>
                      <circle cx="858" cy="206" r="74" fill="none" stroke="rgba(60,40,10,.55)" stroke-width="1.2"></circle>
                      <circle cx="858" cy="206" r="70.5" fill="url(#gp-rg-face)" stroke="#2b1f0a" stroke-width="1.6"></circle>
                      <ellipse cx="886" cy="236" rx="22" ry="12" fill="#a87a43" opacity=".22" transform="rotate(-24 886 236)"></ellipse>
                      <ellipse cx="832" cy="180" rx="10" ry="6" fill="#8b6a3a" opacity=".18"></ellipse>
                      <g transform="translate(858 206)"><path d="M6.8 -65.1 L7.3 -69.6 M13.6 -64.1 L14.6 -68.5 M20.2 -62.3 L21.6 -66.6 M26.6 -59.8 L28.5 -63.9 M38.5 -53 L41.1 -56.6 M43.8 -48.7 L46.8 -52 M48.7 -43.8 L52 -46.8 M53 -38.5 L56.6 -41.1 M59.8 -26.6 L63.9 -28.5 M62.3 -20.2 L66.6 -21.6 M64.1 -13.6 L68.5 -14.6 M65.1 -6.8 L69.6 -7.3 M65.1 6.8 L69.6 7.3 M64.1 13.6 L68.5 14.6 M62.3 20.2 L66.6 21.6 M59.8 26.6 L63.9 28.5 M53 38.5 L56.6 41.1 M48.7 43.8 L52 46.8 M43.8 48.7 L46.8 52 M38.5 53 L41.1 56.6 M26.6 59.8 L28.5 63.9 M20.2 62.3 L21.6 66.6 M13.6 64.1 L14.6 68.5 M6.8 65.1 L7.3 69.6 M-6.8 65.1 L-7.3 69.6 M-13.6 64.1 L-14.6 68.5 M-20.2 62.3 L-21.6 66.6 M-26.6 59.8 L-28.5 63.9 M-38.5 53 L-41.1 56.6 M-43.8 48.7 L-46.8 52 M-48.7 43.8 L-52 46.8 M-53 38.5 L-56.6 41.1 M-59.8 26.6 L-63.9 28.5 M-62.3 20.2 L-66.6 21.6 M-64.1 13.6 L-68.5 14.6 M-65.1 6.8 L-69.6 7.3 M-65.1 -6.8 L-69.6 -7.3 M-64.1 -13.6 L-68.5 -14.6 M-62.3 -20.2 L-66.6 -21.6 M-59.8 -26.6 L-63.9 -28.5 M-53 -38.5 L-56.6 -41.1 M-48.7 -43.8 L-52 -46.8 M-43.8 -48.7 L-46.8 -52 M-38.5 -53 L-41.1 -56.6 M-26.6 -59.8 L-28.5 -63.9 M-20.2 -62.3 L-21.6 -66.6 M-13.6 -64.1 L-14.6 -68.5 M-6.8 -65.1 L-7.3 -69.6" stroke="#3b2d1d" stroke-width="1.1"></path><path d="M0 -61 L0 -70 M30.5 -52.8 L35 -60.6 M52.8 -30.5 L60.6 -35 M61 0 L70 0 M52.8 30.5 L60.6 35 M30.5 52.8 L35 60.6 M0 61 L0 70 M-30.5 52.8 L-35 60.6 M-52.8 30.5 L-60.6 35 M-61 0 L-70 0 M-52.8 -30.5 L-60.6 -35 M-30.5 -52.8 L-35 -60.6" stroke="#2a1d10" stroke-width="2.6" stroke-linecap="round"></path></g>
                      <text class="gp-num" x="858" y="163">XII</text>
                      <text class="gp-num" x="904" y="212">III</text>
                      <text class="gp-num" x="858" y="261">VI</text>
                      <text class="gp-num" x="812" y="212">IX</text>
                      <text class="gp-etch gp-etch-hl" x="859" y="308" text-anchor="middle">MẶT SỐ</text>
                      <text class="gp-etch" x="858" y="307" text-anchor="middle">MẶT SỐ</text>

                      <!-- the little compartment behind the door -->
                      <rect x="790" y="318" width="146" height="134" rx="6" fill="#120c08"></rect>
                      <rect x="796" y="324" width="134" height="122" rx="4" fill="#0b0705"></rect>
                      <path d="M796 324 H930 V340 Q863 332 796 340 Z" fill="rgba(0,0,0,.5)"></path>
                      <g transform="rotate(-6 863 392)">
                        <rect x="818" y="376" width="92" height="30" rx="14" fill="url(#gp-lg-paper)" stroke="#3b2f1e" stroke-width="1.4"></rect>
                        <ellipse cx="820" cy="391" rx="7" ry="15" fill="#efe4c8" stroke="#3b2f1e" stroke-width="1.2"></ellipse>
                        <path d="M820 384 Q824 391 820 398 Q816 391 820 386" fill="none" stroke="#7a6a4e" stroke-width="1"></path>
                        <path d="M858 376.5 V405.5 M864 376.5 V405.5" stroke="#bf3b2c" stroke-width="3"></path>
                        <path d="M861 405 Q852 420 846 424 M861 405 Q868 418 878 421" fill="none" stroke="#bf3b2c" stroke-width="2.2" stroke-linecap="round"></path>
                      </g>

                      <!-- tool tray -->
                      <rect x="152" y="506" width="756" height="132" rx="10" fill="#000" opacity=".5" filter="url(#gp-f-soft)"></rect>
                      <rect x="146" y="498" width="756" height="136" rx="10" fill="url(#gp-lg-wood)" stroke="#120c08" stroke-width="2.6"></rect>
                      <path d="M160 504 Q400 500 640 505 T 892 503 M158 628 Q420 624 660 629 T 890 627" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.2"></path>
                      <rect x="162" y="512" width="724" height="110" rx="6" fill="url(#gp-lg-felt)" stroke="#0b0705" stroke-width="2"></rect>
                      <rect x="162" y="512" width="724" height="110" rx="6" filter="url(#gp-f-grain)" opacity=".5"></rect>
                      <rect x="742" y="510" width="12" height="114" fill="url(#gp-lg-wood)" stroke="#120c08" stroke-width="1.6"></rect>
              ${IDS.map((id) => { const r = G[id].bent ? 42 : G[id].n === 10 ? 30 : G[id].n === 24 ? 56 : 42; return `<ellipse cx="${G[id].tray.x}" cy="566" rx="${r}" ry="${r - (G[id].n === 24 ? 4 : 2)}" fill="rgba(0,0,0,.34)"></ellipse>`; }).join('')}
                      <g transform="rotate(-4 182 566)">
                        <path d="M170 520 L194 518 L196 552 L193 560 L197 600 L172 604 L174 570 L169 560 Z" fill="#e6d8b8" stroke="rgba(60,48,30,.6)" stroke-width="1"></path>
                        <path d="M175 530 H190 M176 538 H188 M175 546 H191 M177 574 H189 M176 582 H190 M178 590 H186" stroke="rgba(60,60,80,.55)" stroke-width="1.2" stroke-linecap="round"></path>
                      </g>
                      <path d="M146 508 Q146 498 156 498 H176 V506 H154 V528 H146 Z M902 508 Q902 498 892 498 H872 V506 H894 V528 H902 Z M146 624 Q146 634 156 634 H176 V626 H154 V604 H146 Z M902 624 Q902 634 892 634 H872 V626 H894 V604 H902 Z" fill="url(#gp-rg-brass)" stroke="#2b1f0a" stroke-width="1.2"></path>
            </svg>

            <svg class="gp-live" viewBox="32 0 940 640" aria-hidden="true">
                      <!-- rod stripes -->
                      <g transform="translate(634.7 220.5) rotate(-3.715)"><g clip-path="url(#gp-cp-rod)"><g data-gp="rod"><path d="M40 -7 H46 L42 7 H36 Z M54 -7 H60 L56 7 H50 Z M68 -7 H74 L70 7 H64 Z M82 -7 H88 L84 7 H78 Z M96 -7 H102 L98 7 H92 Z M110 -7 H116 L112 7 H106 Z M124 -7 H130 L126 7 H120 Z M138 -7 H144 L140 7 H134 Z M152 -7 H158 L154 7 H148 Z" fill="rgba(14,10,8,.5)"></path></g></g></g>

                      <!-- shadows -->
                      <circle cx="228" cy="270" r="92" fill="url(#gp-rg-shd)"></circle>
                      <circle cx="640" cy="228" r="60" fill="url(#gp-rg-shd)"></circle>
              ${IDS.map(gearShadow).join('')}
                      <!-- fixed drive gear with crank arm, fixed output gear with ratchet -->
                      <g data-gp="drv" transform="translate(222 262)"><g class="gp-shk"><g class="gp-rot" data-gp="drvRot"><use href="#gp-g20"></use>
                        <g transform="rotate(-118)"><path d="M-14 -9 L96 -7 Q104 -6 104 0 Q104 6 96 7 L-14 9 Q-24 0 -14 -9 Z" fill="#4f4a43" stroke="#120c08" stroke-width="2.4" stroke-linejoin="round"></path><path d="M-6 -5.5 L94 -4" stroke="rgba(255,236,200,.28)" stroke-width="1.4" stroke-linecap="round"></path><circle r="16" fill="url(#gp-rg-brass)" stroke="#1a110b" stroke-width="2.2"></circle><circle r="7" fill="#2a2018" stroke="#120c08" stroke-width="1.2"></circle><path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke="#8a7a5a" stroke-width="1.4"></path></g>
                      </g><use href="#gp-hl20"></use></g></g>
                      <g data-gp="out" transform="translate(634.7 220.5)"><g class="gp-shk"><g class="gp-rot" data-gp="outRot"><use href="#gp-g12"></use></g><use href="#gp-hl12"></use></g></g>
              ${IDS.map(gearSvg).join('')}
                      <!-- crank knob (kept upright so its light stays put) -->
                      <g class="gp-knob" data-gp="knob"><g class="gp-shk"><circle cx="3" cy="5" r="17" fill="rgba(0,0,0,.45)"></circle><circle r="16" fill="url(#gp-rg-wood)" stroke="#120c08" stroke-width="2.4"></circle><circle r="11" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.2"></circle><ellipse cx="-5" cy="-6" rx="5.5" ry="3.6" fill="rgba(255,226,190,.32)" transform="rotate(-35 -5 -6)"></ellipse></g></g>

                      <!-- click (pawl) on the output ratchet, with its spring -->
                      <g class="gp-spr-n"><path d="M714 189 L709.3 193.9 L709.3 181.5 L703 192.2 L703 179.8 L696.7 190.5 L696.7 178.1 L690.4 188.8 L690.4 176.4 L684.1 187.1 L684.2 174.6 L677.8 185.4 L677.9 172.9 L671.6 183.6 L670 177" fill="none" stroke="#120c08" stroke-width="4.4" stroke-linejoin="round" stroke-linecap="round"></path><path d="M714 189 L709.3 193.9 L709.3 181.5 L703 192.2 L703 179.8 L696.7 190.5 L696.7 178.1 L690.4 188.8 L690.4 176.4 L684.1 187.1 L684.2 174.6 L677.8 185.4 L677.9 172.9 L671.6 183.6 L670 177" fill="none" stroke="#c9cfcb" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"></path></g>
                      <g class="gp-spr-k"><path d="M714 189 L708.2 194.5 L706.5 188.4 L699 198.8 L697.8 191.1 L689.7 203.1 L689.2 193.8 L680.5 207.4 L682.3 191.3 L676 198.2 L677.3 183.8 L671.5 189 L672.2 176.2 L667.1 179.9 L666 172" fill="none" stroke="#120c08" stroke-width="4.4" stroke-linejoin="round" stroke-linecap="round"></path><path d="M714 189 L708.2 194.5 L706.5 188.4 L699 198.8 L697.8 191.1 L689.7 203.1 L689.2 193.8 L680.5 207.4 L682.3 191.3 L676 198.2 L677.3 183.8 L671.5 189 L672.2 176.2 L667.1 179.9 L666 172" fill="none" stroke="#f0b8a4" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"></path></g>
                      <circle class="gp-kfl" cx="696" cy="164" r="22" fill="rgba(224,86,62,.32)"></circle>
                      <g class="gp-pawl" data-gp="pawl"><path d="M686 148 Q694 152 692 161 L660 195 Q655 200 649 197 L646 193 Q650 189 655 186 L676 160 Q676 150 686 148 Z" fill="url(#gp-lg-iron)" stroke="#120c08" stroke-width="2.2" stroke-linejoin="round"></path><path d="M684 153 L660 184" stroke="rgba(255,226,190,.22)" stroke-width="1.2"></path></g>
                      <circle cx="684" cy="156" r="5.5" fill="url(#gp-rg-brass)" stroke="#1a110b" stroke-width="1.6"></circle>

                      <!-- hands on the setting dial -->
                      <g transform="translate(858 206)">
                        <g class="gp-hands" data-gp="hour"><use href="#gp-hh"></use></g>
                        <g class="gp-hands" data-gp="min"><use href="#gp-mh"></use></g>
                        <circle r="6" fill="url(#gp-rg-brass)" stroke="#1a110b" stroke-width="1.6"></circle>
                      </g>

                      <!-- bell -->
                      <path class="gp-ringarc r1" d="M800 30 Q786 54 800 78"></path>
                      <path class="gp-ringarc r2" d="M786 22 Q768 54 786 86"></path>
                      <path class="gp-ringarc r3" d="M772 14 Q750 54 772 94"></path>
                      <path class="gp-ringarc r1" d="M916 30 Q930 54 916 78"></path>
                      <path class="gp-ringarc r2" d="M930 22 Q948 54 930 86"></path>
                      <path class="gp-ringarc r3" d="M944 14 Q966 54 944 94"></path>
                      <path class="gp-ringarc d2 r1" d="M800 30 Q786 54 800 78"></path>
                      <path class="gp-ringarc d2 r2" d="M786 22 Q768 54 786 86"></path>
                      <path class="gp-ringarc d2 r1" d="M916 30 Q930 54 916 78"></path>
                      <path class="gp-ringarc d2 r2" d="M930 22 Q948 54 930 86"></path>
                      <g class="gp-bell">
                        <path d="M858 18 V30" stroke="#120c08" stroke-width="5"></path>
                        <circle cx="858" cy="86" r="6" fill="#2a2018" stroke="#120c08" stroke-width="1.6"></circle>
                        <path d="M832 80 Q832 46 846 34 Q858 26 870 34 Q884 46 884 80 Q886 87 896 90 Q858 98 820 90 Q830 87 832 80 Z" fill="url(#gp-rg-brass)" stroke="#1a110b" stroke-width="2.6" stroke-linejoin="round"></path>
                        <path d="M838 74 Q838 50 848 40" fill="none" stroke="rgba(255,248,220,.6)" stroke-width="2.4" stroke-linecap="round"></path>
                        <path d="M824 89 Q858 84 892 89" fill="none" stroke="rgba(60,40,10,.6)" stroke-width="1.4"></path>
                        <circle cx="858" cy="28" r="5" fill="url(#gp-rg-steel)" stroke="#120c08" stroke-width="1.4"></circle>
                      </g>
                      <text class="gp-pop gp-bpop is-gold" x="952" y="118">boong!</text>
                      <text class="gp-pop gp-bpop d2 is-gold" x="772" y="118">boong!</text>

                      <!-- compartment door -->
                      <rect class="gp-door-glow" x="796" y="324" width="134" height="122" rx="4" fill="url(#gp-rg-glow)"></rect>
                      <g class="gp-door-f">
                        <rect x="794" y="322" width="138" height="126" rx="4" fill="url(#gp-lg-iron)" stroke="#120c08" stroke-width="2.4"></rect>
                        <rect x="802" y="330" width="122" height="110" rx="3" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="1.6"></rect>
                        <ellipse cx="860" cy="400" rx="34" ry="20" fill="url(#gp-rg-rust)"></ellipse>
                        <rect x="788" y="336" width="12" height="24" rx="3" fill="url(#gp-rg-steel)" stroke="#120c08" stroke-width="1.4"></rect>
                        <rect x="788" y="410" width="12" height="24" rx="3" fill="url(#gp-rg-steel)" stroke="#120c08" stroke-width="1.4"></rect>
                        <circle cx="916" cy="385" r="8" fill="url(#gp-rg-brass)" stroke="#1a110b" stroke-width="1.8"></circle>
                        <use href="#gp-rivet" x="812" y="338"></use><use href="#gp-rivet" x="914" y="338"></use><use href="#gp-rivet" x="812" y="432"></use><use href="#gp-rivet" x="914" y="432"></use>
                        <text class="gp-etch" x="863" y="390" text-anchor="middle">${esc(text(p, 'door', 'Nº 3'))}</text>
                      </g>
                      <g class="gp-door-b">
                        <rect x="794" y="322" width="138" height="126" rx="4" fill="#2a221d" stroke="#120c08" stroke-width="2.4"></rect>
                        <rect x="804" y="332" width="118" height="106" rx="3" fill="none" stroke="rgba(255,226,190,.12)" stroke-width="1.4"></rect>
                      </g>

              <g class="gp-prev" data-gp="prev"><circle class="gp-prev-ring" r="10"></circle></g>
              ${[0, 1, 2].map((i) => `<g class="gp-mk" data-mk="${i}"><g class="mk-m"><circle r="9" fill="rgba(143,224,204,.25)" stroke="#8fe0cc" stroke-width="2.4"></circle><circle r="3" fill="#8fe0cc"></circle></g><g class="mk-h"><circle r="11" fill="rgba(224,86,62,.3)" stroke="#e0563e" stroke-width="2.4"></circle><path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="#ffd2c4" stroke-width="2.6" stroke-linecap="round"></path></g></g>`).join('')}
              <g class="gp-ghost" data-gp="ghost">
                <circle cx="12" cy="20" r="56" fill="url(#gp-rg-shd)"></circle>
                <g data-gp="ghostRot"><use href="#gp-g10"></use></g>
                <use href="#gp-hl10"></use>
              </g>
              ${[0, 1].map((i) => `<g data-fl="${i}"><g class="gp-fl"><path d="M0 -15 V-7 M0 7 V15 M-15 0 H-7 M7 0 H15 M-10 -10 L-5 -5 M5 5 L10 10 M10 -10 L5 -5 M-5 5 L-10 10" stroke="#fff1c2" stroke-width="2.6" stroke-linecap="round"></path><circle r="4" fill="#fff6d6"></circle></g></g>`).join('')}
              <g data-gp="pop">
                <circle class="gp-burst" r="26" fill="none" stroke="none" stroke-width="3"></circle>
                <text class="gp-pop" x="0" y="-30"></text>
              </g>
            </svg>

            <div class="gp-hits">
              ${IDS.map((id) => `<button type="button" class="gp-tb${G[id].bent ? ' is-bent' : ''}" data-tb="${esc(id)}" data-focus="tray-${esc(id)}" style="${pct(G[id].tray.x, G[id].tray.y)}" aria-pressed="false"><span class="gp-tchip" aria-hidden="true"><span class="gp-tl">${G[id].bent ? `CONG · ${G[id].n}` : `${G[id].n} RĂNG`}</span><span class="gp-ts">${G[id].bent ? 'CONG' : G[id].n}</span></span></button>`).join('')}
              ${PEG_IDS.map((pg) => `<button type="button" class="gp-peg" data-peg="${esc(pg)}" data-focus="peg-${esc(pg)}" style="${pct(PEGS[pg].x, PEGS[pg].y)}" aria-describedby="gp-help"><span class="gp-pchip" aria-hidden="true">${esc(pg)}</span></button>`).join('')}
              <button type="button" class="gp-crank" data-gp="crank" style="${pct(FIX.drv.x, FIX.drv.y)}" aria-label="Tay quay — nhấn Enter để quay thử" aria-keyshortcuts="C"></button>
            </div>
          </div>
        </div>
        <p id="gp-help" class="s-sr">Dùng Tab tới một bánh răng trong khay, Enter để cầm lên; mũi tên hoặc Tab để chọn trục ${PEG_IDS.join(', ')}; Enter để lắp; Delete để gỡ bánh khỏi trục; phím C để quay tay quay. Có thể kéo thả bằng chuột hoặc ngón tay, hoặc chạm bánh rồi chạm trục. Kéo vòng quanh tay quay theo chiều kim đồng hồ để quay.</p>
      </div>
    </section>`;

  const foot = body.closest('.pz-sheet')?.querySelector<HTMLElement>('.pz-foot');
  const actions = document.createElement('div');
  actions.className = 'pz-actions gp-actions';
  actions.style.alignItems = 'center';
  actions.innerHTML = `
    <span class="gp-tries" data-gp="tries">Lần thử: 0</span>
    <button type="button" class="s-btn s-btn-gold s-btn-sm" data-gp="clear">Gỡ hết bánh</button>
    <button type="button" class="s-btn s-btn-red gp-turn" data-gp="turn" aria-keyshortcuts="C">Quay tay quay <span class="pz-kbd" aria-hidden="true">C</span></button>`;
  (foot ?? body).appendChild(actions);

  const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = body) => root.querySelector(sel) as T;
  const all = <T extends Element = HTMLElement>(sel: string, root: ParentNode = body) => [...root.querySelectorAll(sel)] as T[];
  const stage = q('[data-gp="stage"]');
  const el = {
    mat: q('[data-gp="mat"]'), time: q('[data-gp="time"]'), lamp: q('[data-gp="lamp"]'), clock: q('[data-gp="clock"]'), dirw: q('[data-gp="dirw"]'),
    rod: q<SVGGElement>('[data-gp="rod"]'), drv: q<SVGGElement>('[data-gp="drv"]'), drvRot: q<SVGGElement>('[data-gp="drvRot"]'),
    out: q<SVGGElement>('[data-gp="out"]'), outRot: q<SVGGElement>('[data-gp="outRot"]'), knob: q<SVGGElement>('[data-gp="knob"]'),
    pawl: q<SVGGElement>('[data-gp="pawl"]'), hour: q<SVGGElement>('[data-gp="hour"]'), min: q<SVGGElement>('[data-gp="min"]'),
    prev: q<SVGGElement>('[data-gp="prev"]'), ghost: q<SVGGElement>('[data-gp="ghost"]'), ghostRot: q<SVGGElement>('[data-gp="ghostRot"]'),
    pop: q<SVGGElement>('[data-gp="pop"]'), crank: q('[data-gp="crank"]'),
    tries: q('[data-gp="tries"]', actions), clear: q<HTMLButtonElement>('[data-gp="clear"]', actions), turn: q<HTMLButtonElement>('[data-gp="turn"]', actions),
  };
  const chips = all('[data-cc]');
  const gearEls = new Map(all<SVGGElement>('[data-gr]').map((g) => [g.dataset.gr!, g]));
  const shEls = new Map(all<SVGGElement>('[data-sh]').map((g) => [g.dataset.sh!, g]));
  const trayBtns = new Map(all<HTMLButtonElement>('[data-tb]').map((b) => [b.dataset.tb!, b]));
  const pegBtns = new Map(all<HTMLButtonElement>('[data-peg]').map((b) => [b.dataset.peg!, b]));
  const marks = all<SVGGElement>('[data-mk]');
  const flashes = all<SVGGElement>('[data-fl]');
  const legendItems = all('[data-lg]');

  // ---------- painting ----------
  let lastSay = '';
  function say(kick: string, msg: string, tone: PuzzleTone = 'info', cls = '') {
    const key = `${kick}|${msg}|${tone}|${cls}`;
    if (key === lastSay) return;
    lastSay = key;
    ctx.setStatus(`${kick} ${msg}`, tone);
    const status = body.closest('.pz-sheet')?.querySelector<HTMLElement>('.pz-status');
    if (!status) return;
    const b = document.createElement('b');
    b.textContent = kick;
    if (cls) b.className = cls;
    status.replaceChildren(b, document.createTextNode(` ${msg}`));
  }
  const setCls = (node: Element, cls: string) => { if (node.getAttribute('class') !== cls) node.setAttribute('class', cls); };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  function paint() {
    const phase = s.phase;
    const done = phase !== 'build';
    const t = train(s.pos);
    const snap = s.snap || [];
    const label = (id: string) => (G[id] ? G[id].label : id);
    const nameOf = (nid: string) => (nid === 'drv' ? 'tay quay' : nid === 'out' ? 'bánh kim' : (PEGS[s.pos[nid]] ? `bánh ở trục ${s.pos[nid]}` : label(nid).toLowerCase()));

    // gears
    IDS.forEach((id) => {
      const g = G[id], pp = s.pos[id];
      const cls: string[] = [];
      let x: number, y: number, k = 1;
      if (s.dragId === id || pp === 'drag') { x = s.dragX; y = s.dragY; cls.push('is-drag'); }
      else if (PEGS[pp]) { x = PEGS[pp].x; y = PEGS[pp].y; cls.push('is-peg'); }
      else { x = g.tray.x; y = g.tray.y; k = s.held === id ? 0.56 : TK; cls.push('is-tray'); }
      if (s.held === id) cls.push('is-held');
      if (t.sign[id] != null) cls.push('in-train');
      if (s.msg === 'bent' && s.jamAt === id) cls.push('is-bad');
      const tf = `translate(${r1(x)}px, ${r1(y)}px) scale(${k})`;
      const ge = gearEls.get(id)!;
      setCls(ge, `gp-gr ${cls.join(' ')}`);
      ge.style.transform = tf;
      const rot = ge.querySelector<SVGGElement>('.gp-rot')!;
      setCls(rot, snap.indexOf(id) >= 0 ? 'gp-rot is-snap' : 'gp-rot');
      rot.style.transform = `rotate(${r1(s.ang[id] || 0)}deg)`;
      const sh = shEls.get(id)!;
      setCls(sh, `gp-sh ${cls.join(' ')}`);
      sh.style.transform = tf;
    });
    setCls(el.drv, t.sign.drv != null ? 'in-train' : '');
    setCls(el.out, t.sign.out != null ? 'in-train' : '');
    el.drvRot.style.transform = `rotate(${r1(s.ang.drv || 0)}deg)`;
    setCls(el.outRot, snap.indexOf('out') >= 0 ? 'gp-rot is-snap' : 'gp-rot');
    el.outRot.style.transform = `rotate(${r1(s.ang.out || 0)}deg)`;
    const hp = handlePos(s.ang.drv);
    el.knob.style.transform = `translate(${r1(hp.x)}px, ${r1(hp.y)}px)`;
    el.rod.style.transform = `translateX(${r1(((((s.ang.out || 0) / 360) * 14) % 14 + 14) % 14 - 14)}px)`;
    let pawlDeg = 0;
    if (s.lastDir > 0 && !s.kink) { const qq = ((s.ang.out || 0) % 30 + 30) % 30; pawlDeg = r1(qq / 30 * 6); }
    el.pawl.style.transform = `rotate(${pawlDeg}deg)`;
    el.hour.style.transform = `rotate(${r1(s.minDeg / 12)}deg)`;
    el.min.style.transform = `rotate(${r1(s.minDeg)}deg)`;

    // drop preview: dragged gear over a peg, or a held gear with a peg focused
    let pvId: string | null = null, pvPeg: string | null = null;
    if (s.dragId && s.dragPeg) { pvId = s.dragId; pvPeg = s.dragPeg; }
    else if (s.held && s.kbPeg && s.pos[s.held] !== s.kbPeg) { pvId = s.held; pvPeg = s.kbPeg; }
    const pegState: Record<string, string> = {};
    const mks: { cls: string; x: number; y: number }[] = [{ cls: '', x: 0, y: 0 }, { cls: '', x: 0, y: 0 }, { cls: '', x: 0, y: 0 }];
    if (pvId && pvPeg) {
      const pos = { ...s.pos, [pvId]: 'off' };
      const occ = IDS.filter((id) => pos[id] === pvPeg)[0];
      if (occ) pos[occ] = 'tray';
      const chk = check(pos, pvId, pvPeg);
      const me = { x: PEGS[pvPeg].x, y: PEGS[pvPeg].y, n: G[pvId].n };
      const by = graph(pos).by;
      const list = chk.hits.map((h) => ({ cls: 'is-hit', ...contact(me, by[h]) })).concat(chk.meshes.map((m2) => ({ cls: 'is-mesh', ...contact(me, by[m2]) })));
      list.slice(0, 3).forEach((m2, i) => { mks[i] = m2; });
      const st = chk.hits.length ? 'is-hit' : chk.meshes.length ? 'is-mesh' : 'is-free';
      setCls(el.prev, `gp-prev is-on ${st}`);
      el.prev.style.transform = `translate(${r1(me.x)}px, ${r1(me.y)}px)`;
      el.prev.querySelector('circle')!.setAttribute('r', String(rOf(me.n)));
      pegState[pvPeg] = `is-target ${st === 'is-free' ? '' : st}`.trim();
    } else setCls(el.prev, 'gp-prev');
    marks.forEach((mk, i) => { setCls(mk, `gp-mk ${mks[i].cls}`.trim()); mk.style.transform = `translate(${mks[i].x}px, ${mks[i].y}px)`; });

    // chain read-out
    const tag = (id: string) => (id === 'drv' ? 'TAY QUAY' : id === 'out' ? 'BÁNH KIM' : (s.pos[id] || '?'));
    let chain: string[] = [];
    const linked = t.sign.out != null;
    if (linked) { let c: string | undefined = 'out'; while (c) { chain.unshift(c); c = t.parent[c]; } } else chain = t.order.slice();
    const chipVals = chain.map((id) => ({ t: tag(id), d: s.turned ? (t.sign[id] > 0 ? ' ↻' : ' ↺') : '', cls: [s.turned && t.sign[id] < 0 ? 'is-ccw' : '', id === 'out' ? 'is-end' : ''].join(' ').trim() }));
    if (!linked) chipVals.push({ t: 'BÁNH KIM', d: '', cls: 'is-miss' });
    chips.forEach((chip, i) => {
      const v = chipVals[i] || { t: '', d: '', cls: 'is-off' };
      setCls(chip, `gp-cc ${v.cls}`.trim());
      chip.firstElementChild!.textContent = v.t;
      chip.lastElementChild!.textContent = v.d;
    });

    // clock read-out
    const now = hm(s.minDeg / 6);
    const timeStr = `${now.h}:${String(now.m).padStart(2, '0')}`;
    const dir = s.lastDir || 0;
    const timeCls = dir > 0 ? 'is-fwd' : dir < 0 ? 'is-back' : '';
    setCls(el.time, `gp-time ${timeCls}`.trim());
    setCls(el.lamp, `gp-lamp ${timeCls}`.trim());
    el.clock.textContent = timeStr;
    el.dirw.textContent = dir > 0 ? 'THUẬN' : dir < 0 ? 'NGƯỢC' : '';

    // tray + peg buttons
    IDS.forEach((id) => {
      const b = trayBtns.get(id)!;
      const inTray = s.pos[id] === 'tray';
      b.hidden = !inTray;
      b.setAttribute('aria-pressed', s.held === id ? 'true' : 'false');
      setCls(b, `gp-tb${G[id].bent ? ' is-bent' : ''}${s.held === id ? ' is-held' : ''}`);
      b.setAttribute('aria-label', `${G[id].name[0].toUpperCase()}${G[id].name.slice(1)} — trong khay${s.held === id ? ', đang cầm' : ''}. Enter để cầm lên.`);
    });
    PEG_IDS.forEach((pg) => {
      const b = pegBtns.get(pg)!;
      const occ = occupant(s, pg);
      setCls(b, ['gp-peg', occ ? 'is-full' : '', pegState[pg] || ''].filter(Boolean).join(' '));
      let lab = `Trục ${pg} — ${occ ? G[occ].name + (t.sign[occ] != null ? ', đang nối với tay quay' : ', chưa nối với tay quay') : 'trống'}`;
      lab += s.held ? '. Enter để lắp bánh đang cầm.' : occ ? '. Enter để cầm lên, Delete để gỡ.' : '.';
      b.setAttribute('aria-label', lab);
    });

    // legend card
    const where = (id: string) => { const pp = s.pos[id]; return s.held === id ? 'ĐANG CẦM' : (pp === 'drag' ? 'ĐANG KÉO' : PEGS[pp] ? `TRỤC ${pp}` : 'KHAY'); };
    const short = (id: string) => { const pp = s.pos[id]; return s.held === id ? 'CẦM' : (pp === 'drag' ? 'KÉO' : PEGS[pp] ? pp : 'KHAY'); };
    legendGroups.forEach((g, i) => {
      const li = legendItems[i];
      let at: string;
      if (g.ids.length === 1) at = where(g.ids[0]);
      else { const ws = g.ids.map(short); at = ws.every((w) => w === ws[0]) ? `${ws[0]} ×${ws.length}` : ws.join(' · '); }
      const on = g.ids.some((id) => s.held === id || s.dragId === id);
      setCls(li, [on ? 'is-on' : '', g.bent && t.bent ? 'is-bad' : ''].filter(Boolean).join(' '));
      li.querySelector('em')!.textContent = at;
    });

    // effects
    const fl = s.flash || [];
    const fc = s.flashN ? (s.flashN % 2 ? 'fa' : 'fb') : '';
    flashes.forEach((f, i) => {
      f.style.transform = `translate(${fl[i] ? fl[i].x : 0}px, ${fl[i] ? fl[i].y : 0}px)`;
      setCls(f.firstElementChild!, `gp-fl ${fl[i] ? fc : ''}`.trim());
    });
    const pop = s.pop;
    const pc = s.popN ? (s.popN % 2 ? 'pa' : 'pb') : '';
    el.pop.style.transform = `translate(${r1(pop?.x ?? 0)}px, ${r1(pop?.y ?? 0)}px)`;
    const burst = el.pop.querySelector('circle')!;
    setCls(burst, `gp-burst ${pop ? pc : ''}`.trim());
    burst.setAttribute('stroke', pop?.col ?? 'none');
    const word = el.pop.querySelector('text')!;
    setCls(word, `gp-pop ${pop ? `${pc} ${pop.tone}` : ''}`.trim());
    word.textContent = pop?.t ?? '';
    const ghostId = s.dragId;
    setCls(el.ghost, ghostId ? 'gp-ghost is-on' : 'gp-ghost');
    if (ghostId) {
      const gh = G[ghostId];
      el.ghost.style.transform = `translate(${r1(s.dragX)}px, ${r1(s.dragY)}px)`;
      el.ghost.querySelector('circle')!.setAttribute('r', String((gh.bent ? 78 : SHD[gh.n] ?? 76) + 4));
      el.ghostRot.style.transform = `rotate(${r1(s.ang[ghostId] || 0)}deg) scale(1.03)`;
      el.ghostRot.firstElementChild!.setAttribute('href', gh.sym);
      el.ghost.lastElementChild!.setAttribute('href', gh.hl);
    }

    setCls(el.mat, ['gp-mat', s.dragId ? 'is-drag' : '', s.cranking ? 'is-crank' : '', s.auto || s.cranking ? 'is-busy' : '', done ? 'is-done' : '', s.kink ? 'is-kink' : '',
      s.kinkN ? (s.kinkN % 2 ? 'kk-a' : 'kk-b') : '', s.strain && !s.kink ? 'is-strain' : '', s.jamN ? (s.jamN % 2 ? 'shk-a' : 'shk-b') : '',
      s.rang ? 'is-ring' : '', phase === 'open' ? 'is-open' : ''].filter(Boolean).join(' '));

    // footer
    const tries = Math.max(s.tries || 0, Number(ctx.run?.attempts) || 0);
    el.tries.textContent = `Lần thử: ${tries}`;
    setCls(el.tries, ['gp-tries', tries > 0 ? 'has-fail' : '', s.bump ? (s.bump % 2 ? 'bump-a' : 'bump-b') : ''].filter(Boolean).join(' '));
    const ready = phase === 'build' && !s.auto && t.outSign > 0 && !t.bent && !t.conflict;
    const anyPlaced = IDS.some((id) => PEGS[s.pos[id]]);
    el.turn.disabled = phase !== 'build' || !!s.auto || s.solved;
    el.turn.classList.toggle('is-ready', ready && !s.solved);
    el.clear.disabled = phase !== 'build' || !!s.auto || !anyPlaced || s.solved;

    // status line
    const a = s.arg || {};
    const lab = a.id ? label(a.id) : '';
    const listN = (ids: string[]) => ids.map(nameOf).join(' và ');
    switch (s.msg) {
      case 'held': say('ĐANG CẦM', `${lab} (${G[a.id].n} răng). Chọn một trục rồi thả — Enter, hoặc chạm vào trục.`); break;
      case 'unheld': say('LẮP RĂNG', `Đã đặt ${lab.toLowerCase()} xuống.`); break;
      case 'lift': say('ĐANG KÉO', `${lab} — thả lên một trục, hoặc thả ra ngoài để trả về khay.`); break;
      case 'mesh': say('ĂN KHỚP', `${lab} ở trục ${a.peg} ăn khớp với ${listN(a.meshes || [])}.${a.bumped ? ' Bánh cũ ở trục này đã về khay.' : ''}`, 'ok', 'gp-k-ok'); break;
      case 'loose': say('CHƯA KHỚP', `${lab} ở trục ${a.peg} không chạm bánh nào — nó sẽ đứng yên.`, 'info', 'gp-k-warn'); break;
      case 'hit': say('KHÔNG VỪA', `${lab} không vừa trục ${a.peg} — răng sẽ đâm vào ${nameOf(a.hit)}.`, 'info', 'gp-k-warn'); break;
      case 'returned': say('TRẢ VỀ KHAY', `${lab} đã về khay.`); break;
      case 'same': say('LẮP RĂNG', `${lab} vẫn ở trục ${a.peg}.`); break;
      case 'emptyPeg': say('TRỤC TRỐNG', `Trục ${a.peg} đang trống — chọn một bánh trong khay trước.`, 'info', 'gp-k-warn'); break;
      case 'cleared': say('GỠ HẾT', 'Mọi bánh răng đã về khay.'); break;
      case 'ratchet': say('CÓC HÃM', 'Tay quay có cóc hãm — chỉ quay theo chiều kim đồng hồ.', 'info', 'gp-k-warn'); break;
      case 'spin': say('ĐANG QUAY', 'Tay quay đang quay…'); break;
      case 'noconn': say('CHƯA NỐI', 'Tay quay quay được, nhưng kim không nhúc nhích — đường truyền chưa tới bánh kim.', 'info', 'gp-k-warn'); break;
      case 'fwd': say('THUẬN CHIỀU', `Kim chạy thuận chiều — ${timeStr}.`, 'ok', 'gp-k-ok'); break;
      case 'backing': say('NGƯỢC CHIỀU', `Kim đang lùi — ${timeStr}…`, 'bad'); break;
      case 'back': case 'kinked': say('KIM QUAY NGƯỢC', 'Kim quay ngược! Lò xo hãm bị gập. Đổi đường truyền rồi quay lại.', 'bad'); break;
      case 'bent': say('KẸT MÁY', 'Bánh răng cong làm kẹt cả bộ máy.', 'bad'); break;
      case 'conflict': say('KẸT MÁY', 'Hai nhánh truyền ép nhau ngược chiều — bộ máy kẹt cứng.', 'bad'); break;
      case 'win': say('MÁY ĐÃ CHẠY', `${targetWords} — chuông gác điểm, ngăn nhỏ trên tấm máy bật mở.`, 'ok', 'gp-k-ok'); break;
      case 'server': say('KẸT MÁY', a.text || 'Bộ máy chưa chạy đúng.', 'bad'); break;
      default: say('LẮP RĂNG', `Kéo một bánh răng từ khay lên trục ${PEG_IDS.slice(0, -1).join(', ')} hoặc ${PEG_IDS[PEG_IDS.length - 1]} — hoặc chạm bánh rồi chạm trục.`);
    }

    if (focusTo) {
      const target = body.querySelector<HTMLElement>(`[data-focus="${focusTo}"]`);
      if (target && !target.hidden) { focusTo = null; target.focus({ preventScroll: true }); }
    }
  }

  // ---------- wiring ----------
  const onTrayKey = (e: KeyboardEvent) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tb]'); if (b) trayKey(b.dataset.tb!, e); };
  const onPegKey = (e: KeyboardEvent) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-peg]'); if (b) pegKey(b.dataset.peg!, e); };
  const onKeydown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-tb]')) onTrayKey(e);
    else if (target.closest('[data-peg]')) onPegKey(e);
    else if (target === el.crank && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) { e.preventDefault(); autoTurn(); }
    if (e.key === 'Escape' && s.held) {
      // the first Escape puts the held gear down; the next one closes the sheet
      e.preventDefault();
      e.stopPropagation();
      setState({ held: null, msg: 'unheld', arg: { id: s.held } });
    }
  };
  const onFocusIn = (e: FocusEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-peg]');
    if (b && (s.kbPeg !== b.dataset.peg || s.cursor !== b.dataset.peg)) setState({ kbPeg: b.dataset.peg!, cursor: b.dataset.peg! });
  };
  const onFocusOut = (e: FocusEvent) => { if ((e.target as HTMLElement).closest('[data-peg]') && s.kbPeg) setState({ kbPeg: null }); };
  const sheet = body.closest<HTMLElement>('.pz-veil') ?? body;
  const onSheetKey = (e: KeyboardEvent) => {
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      autoTurn();
    }
  };
  const onTurn = (e: Event) => { e.preventDefault(); autoTurn(); };
  const onClear = (e: Event) => { e.preventDefault(); clearAll(); };
  stage.addEventListener('pointerdown', pDown);
  stage.addEventListener('pointermove', pMove);
  stage.addEventListener('pointerup', pUp);
  stage.addEventListener('pointercancel', pUp);
  body.addEventListener('keydown', onKeydown);
  body.addEventListener('focusin', onFocusIn);
  body.addEventListener('focusout', onFocusOut);
  sheet.addEventListener('keydown', onSheetKey);
  el.turn.addEventListener('click', onTurn);
  el.clear.addEventListener('click', onClear);

  if (ctx.solved) s = { ...s, phase: 'open', solved: true, minDeg: TARGET, msg: 'win' };
  paint();

  return {
    update(next) {
      ctx = next;
      if (next.solved && !s.solved && s.phase === 'build') {
        // solved by the partner: the hands jump to the target and the door opens
        clearTimers();
        stopPtr();
        stopTurn();
        setState({ phase: 'open', solved: true, minDeg: TARGET, auto: false, cranking: false, held: null, msg: 'win', lastDir: 1 });
        return;
      }
      if (next.solved) s = { ...s, solved: true };
      paint();
    },
    unmount() {
      dead = true;
      clearTimers();
      stopPtr();
      stopTurn();
      stage.removeEventListener('pointerdown', pDown);
      stage.removeEventListener('pointermove', pMove);
      stage.removeEventListener('pointerup', pUp);
      stage.removeEventListener('pointercancel', pUp);
      body.removeEventListener('keydown', onKeydown);
      body.removeEventListener('focusin', onFocusIn);
      body.removeEventListener('focusout', onFocusOut);
      sheet.removeEventListener('keydown', onSheetKey);
      el.turn.removeEventListener('click', onTurn);
      el.clear.removeEventListener('click', onClear);
      actions.remove();
      body.classList.remove('gp-host');
      body.innerHTML = '';
    },
  };
}

const gearTrain: PuzzleKindModule = {
  kind: 'gear_train',
  label: { en: 'Gear train', vi: 'Bánh răng' },
  mount,
};

export default gearTrain;
