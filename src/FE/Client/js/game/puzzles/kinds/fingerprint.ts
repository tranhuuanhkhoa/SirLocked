/**
 * P3 · Dấu vân tay — ported from design/project/PuzzlePrints.dc.html.
 * 1. Brush powder over the surface (pointer drag, arrow keys + Space, or "Rắc một lượt") until the latent
 *    print is clear enough (coverage ≥ params.threshold — measured here, client-only).
 * 2. Lift it with tape (the tape flies to the backing card).
 * 3. Pick a reference card: ctx.submit({ card }) → { match } or { match:false, breakAt }. The comparison
 *    then draws the minutiae lines; a wrong card breaks at the scar line.
 */
import './fingerprint.css';
import { PP_DEFS } from './fingerprint-art';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleTone } from '../types';

type Pt = [number, number];
type Phase = 'brush' | 'lifting' | 'lifted';
interface Card { id: string; mono: string; name: string; role: string; no: string; pattern: string; scar: boolean }
interface Brush { x: number; y: number; on: boolean; down: boolean; kb: boolean }

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const f1 = (v: number) => Math.round(v * 10) / 10;
const PATTERNS = ['loop', 'whorl', 'arch'];
// 9 minutiae on the loop (print-local units); #3 is the scar crossing
const M: Pt[] = [[-17.6, -66.8], [0.5, -56.2], [54.2, 18.6], [45.5, -32.1], [29.8, 69.1], [-11.1, 61], [-43.2, 25.7], [-45.4, -46.2], [3.8, -3.5]];
// look-alike points on the wrong cards for lines 1 and 2
const DECOY: Record<string, Pt[]> = { whorl: [[-31.2, -44], [30.1, -61.1]], arch: [[-40.7, -69.9], [3.5, -79.4]], mirror: [[17.6, -66.8], [-0.5, -56.2]], loop: [[-14.2, -62.1], [6.4, -51.8]] };
const REST = { x: 446, y: 312 };
const CAP = 220;
const HARD = 320;
const G = 10;
const GW = 57;
const GH = 42;
const PUFFS = [
  [[-22.1, -11.7, 6.2], [16.9, -19.5, 4.4], [24.7, 3.9, 5.2], [-6.5, -27.3, 3.9], [-27.3, 9.1, 6.8], [9.1, 20.8, 4.2], [2.6, -33.8, 5.5]],
  [[20.8, -14.3, 5.2], [-18.2, -18.2, 6.5], [-26, 2.6, 4.2], [10.4, -29.9, 5.7], [28.6, 11.7, 3.6], [-10.4, 19.5, 4.9], [-2.6, -24.7, 6]],
  [[-15.6, -22.1, 5.7], [23.4, -7.8, 4.7], [5.2, -31.2, 6.8], [-28.6, -3.9, 3.9], [15.6, 16.9, 5.2], [-14.3, 15.6, 4.4], [27.3, -23.4, 6.2]],
  [[19.5, -20.8, 4.9], [-23.4, -9.1, 6.2], [3.9, 24.7, 4.2], [-7.8, -31.2, 5.5], [26, 1.3, 6.5], [-20.8, 16.9, 3.9], [13, -35.1, 5.2]],
];

function cardsFrom(params: any): Card[] {
  const list = Array.isArray(params?.cards) ? params.cards : [];
  return list.filter((c: any) => c && c.id).map((c: any, i: number) => ({
    id: String(c.id), mono: String(c.mono ?? '').slice(0, 3), name: String(c.name ?? c.id), role: String(c.role ?? ''),
    no: String(c.no ?? `Nº ${String(i + 1).padStart(2, '0')}`), pattern: PATTERNS.includes(c.pattern) ? c.pattern : 'arch', scar: c.scar === true,
  }));
}

function mount(body: HTMLElement, initial: PuzzleContext): PuzzleKindHandle {
  let ctx = initial;
  const tr = ctx.tr;
  const params = ctx.params ?? {};
  const cards = cardsFrom(params);
  const printPattern = PATTERNS.includes(params.print?.pattern) ? params.print.pattern : 'loop';
  const P = { cx: Number(params.print?.x ?? 318), cy: Number(params.print?.y ?? 282), rot: Number(params.print?.rot ?? -14), s: 0.7 };
  const SM = { x: Number(params.smudge?.x ?? 150), y: Number(params.smudge?.y ?? 168), rot: Number(params.smudge?.rot ?? 24) };
  const threshold = Math.max(0.3, Math.min(0.9, Number(params.threshold) || 0.7));
  const thrPct = Math.round(threshold * 100);
  // the patch of the lid the tape lifts (around the print)
  const LR = { x: Math.round(P.cx - 94), y: Math.round(P.cy - 104), w: 188, h: 196 };
  const a = (P.rot * Math.PI) / 180;
  const toLid = (x: number, y: number): Pt => [P.cx + P.s * (x * Math.cos(a) - y * Math.sin(a)), P.cy + P.s * (x * Math.sin(a) + y * Math.cos(a))];
  const cells: Pt[] = [];
  for (let y = -104; y <= 94; y += 9) for (let x = -80; x <= 80; x += 9) if ((x * x) / 6084 + ((y + 8) * (y + 8)) / 10000 <= 1) cells.push(toLid(x, y));
  const sm: Pt[] = [];
  const rs = (SM.rot * Math.PI) / 180;
  for (let y = -24; y <= 24; y += 8) for (let x = -44; x <= 44; x += 8) if ((x * x) / 2116 + (y * y) / 676 <= 1) sm.push([SM.x + x * Math.cos(rs) - y * Math.sin(rs), SM.y + x * Math.sin(rs) + y * Math.cos(rs)]);
  const art = (card: Card | undefined) => {
    if (!card) return { href: `#pp-fp-${printPattern}`, flip: false, decoy: DECOY.mirror };
    const flip = card.pattern === printPattern && !card.scar;
    return { href: `#pp-fp-${card.pattern}`, flip, decoy: flip ? DECOY.mirror : DECOY[card.pattern] ?? DECOY.arch };
  };

  // ---- state ----
  let phase: Phase = 'brush';
  let brush: Brush = { x: REST.x, y: REST.y, on: false, down: false, kb: false };
  let puffs = [0, 1, 2, 3].map(() => ({ x: -60, y: -60, k: '' }));
  let puffI = 0;
  let puffT = 0;
  let passN = 0;
  let passing = false;
  let passQ = 0;
  let tape: { x: number; y: number; w: number; h: number; tx: number; ty: number; ts: number } | null = null;
  let live = false;
  let wipe = false;
  let pick: string | null = null;
  let cmpN = 0;
  let verdict: null | 'fail' | 'match' = null; // shown once the comparison animation has run
  let outcome: null | 'fail' | 'match' = null; // the server's answer for the picked card
  const failed: Record<string, boolean> = {};
  let breakAt = 3;
  let partnerSolved = false;
  let busy = false;
  let liftedAt = '';
  let alive = true;
  let raf = 0;
  let kbT = 0;
  let down = false;
  let pend: { x: number; y: number } | null = null;
  let last: { x: number; y: number } | null = null;
  let dust = new Uint8Array(GW * GH);
  let hit = new Uint8Array(cells.length);
  let smHit = new Uint8Array(sm.length);
  let hitN = 0;
  let smN = 0;
  let dabs: number[][] = [];
  let dabD = '';
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
    timers.add(id);
  };
  const clearTimers = () => { timers.forEach((id) => window.clearTimeout(id)); timers.clear(); passing = false; passQ = 0; if (kbT) { window.clearTimeout(kbT); kbT = 0; } };
  const reduced = () => Boolean(ctx.reducedMotion);
  const isPhone = () => window.matchMedia?.('(max-width: 900px)').matches ?? false;
  const level = () => (ctx.run?.hints ?? []).length;
  const restBrush = (): Brush => ({ x: REST.x, y: REST.y, on: false, down: false, kb: false });
  const cov = () => hitN / Math.max(1, cells.length);

  // ---- markup ----
  const fig = (L: 'h' | 'v') => {
    const W = L === 'h' ? 520 : 300;
    const H = L === 'h' ? 300 : 560;
    const lifted = L === 'h' ? 'translate(128 150) scale(1.1)' : 'translate(150 140)';
    const ref = L === 'h' ? 'translate(392 150) scale(1.1)' : 'translate(150 420)';
    const panels = L === 'h'
      ? '<rect class="pp-pan-a" x="14" y="4" width="228" height="292" rx="2"></rect><rect class="pp-pan-edge" x="14" y="4" width="228" height="292" rx="2"></rect><rect class="pp-pan-b" x="278" y="4" width="228" height="292" rx="2"></rect><rect class="pp-pan-edge" x="278" y="4" width="228" height="292" rx="2"></rect>'
      : '<rect class="pp-pan-a" x="36" y="4" width="228" height="270" rx="2"></rect><rect class="pp-pan-edge" x="36" y="4" width="228" height="270" rx="2"></rect><rect class="pp-pan-b" x="36" y="286" width="228" height="270" rx="2"></rect><rect class="pp-pan-edge" x="36" y="286" width="228" height="270" rx="2"></rect>';
    const film = L === 'h' ? '<rect x="30" y="14" width="196" height="272" fill="rgba(236,240,232,.14)" stroke="rgba(150,160,150,.3)"></rect>' : '<rect x="48" y="12" width="204" height="254" fill="rgba(236,240,232,.14)" stroke="rgba(150,160,150,.3)"></rect>';
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    return `<div class="pp-fig pp-fig-${L}" data-pp-fig="${L}" data-w="${W}" data-h="${H}">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
        <defs><mask id="pp-brk-${L}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="${W + 40}" height="${H + 40}"><path class="pp-brk-rev" data-pp-brkrev pathLength="1"></path></mask></defs>
        ${panels}
        <g transform="${lifted}"><g mask="url(#pp-tip)"><rect x="-100" y="-130" width="200" height="240" fill="url(#pp-grain-dk)"></rect><use href="#pp-fp-${printPattern}" class="pp-ink-lift"></use></g><ellipse class="pp-scarhint" data-pp-scarhint cx="54.2" cy="18.6" transform="rotate(53.9 54.2 18.6)" rx="52" ry="9"></ellipse><ellipse class="pp-scarring" data-pp-scar pathLength="1" cx="54.2" cy="18.6" transform="rotate(53.9 54.2 18.6)" rx="55" ry="12"></ellipse></g>
        ${film}
        <g transform="${ref}"><g mask="url(#pp-tip-ink)"><use data-pp-cmpref class="pp-ink-ref"></use></g><ellipse class="pp-scarring" data-pp-scar pathLength="1" cx="54.2" cy="18.6" transform="rotate(53.9 54.2 18.6)" rx="55" ry="12"></ellipse></g>
        <g>${nine.map((i) => `<path class="pp-halo" data-pp-halo="${i}" pathLength="1"></path>`).join('')}${nine.map((i) => `<path class="pp-ln" data-pp-ln="${i}" pathLength="1"></path>`).join('')}<path class="pp-brk" data-pp-brk mask="url(#pp-brk-${L})"></path></g>
      </svg>
      ${nine.map((i) => `<span class="pp-mk a" data-pp-ma="${i}" style="animation-delay: ${(0.15 + i * 0.05).toFixed(2)}s"><b>${i}</b></span>`).join('')}
      ${nine.map((i) => `<span class="pp-mk b" data-pp-mb="${i}"><b>${i}</b></span>`).join('')}
      <span class="pp-xmk" data-pp-x>✕</span>
      <span class="pp-cstamp" data-pp-cstamp aria-hidden="true"></span>
    </div>`;
  };
  const note = params.note ?? {};
  const testimony = params.testimony ?? null;
  const root = document.createElement('div');
  root.className = 'pp-root';
  root.innerHTML = `
    <svg class="pp-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
      ${PP_DEFS}
      <mask id="pp-dust" maskUnits="userSpaceOnUse" x="0" y="0" width="560" height="410"><path data-pp-dab d="" fill="#fff" style="filter: blur(5px)"></path></mask>
      <g id="pp-latent" transform="translate(${f1(P.cx)} ${f1(P.cy)}) rotate(${f1(P.rot)}) scale(${P.s})"><g mask="url(#pp-tip-s)"><use href="#pp-fp-${printPattern}"></use></g></g>
      <g id="pp-smudge" transform="translate(${f1(SM.x)} ${f1(SM.y)}) rotate(${f1(SM.rot)})">
        <ellipse cx="2" cy="0" rx="54" ry="31" fill="url(#pp-smg)"></ellipse>
        <path d="M-40 -17C-22 -21 6 -22 30 -17M-46 -9C-26 -14 8 -15 38 -9M-48 -1C-24 -6 12 -7 42 -1M-44 7C-22 3 14 2 40 8M-38 15C-18 11 10 10 32 15M-26 22C-12 19 6 19 20 23" fill="none" stroke="rgba(226,230,234,.34)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="11 7 5 6 17 9 4 5"></path>
        <path d="M-36 -14C-18 -18 10 -19 34 -13M-42 -5C-22 -10 12 -11 41 -5M-40 3C-18 -1 16 -2 41 4M-34 11C-14 7 14 6 36 12" fill="none" stroke="rgba(214,219,224,.16)" stroke-width="5" stroke-linecap="round"></path>
        <path d="M18 -20C30 -12 34 0 30 14M26 -18C38 -8 40 6 35 18" fill="none" stroke="rgba(226,230,234,.22)" stroke-width="2" stroke-linecap="round" stroke-dasharray="6 5"></path>
      </g>
    </defs></svg>
    <div class="pp-stage">
      <div class="pp-railrow">
        <ol class="pp-rail" aria-label="${esc(tr('Steps to take the print', 'Các bước lấy dấu vân tay'))}">
          <li data-pp-rail="1"><span class="pp-n">1</span>${esc(tr('DUST', 'RẮC BỘT'))}</li>
          <li data-pp-rail="2"><span class="pp-n">2</span>${esc(tr('LIFT', 'NHẤC DẤU'))}</li>
          <li data-pp-rail="3"><span class="pp-n">3</span>${esc(tr('COMPARE', 'ĐỐI CHIẾU'))}</li>
        </ol>
        <p class="pp-rail-tool" data-pp-keys aria-hidden="true"><span class="pz-kbd">←</span><span class="pz-kbd">↑</span><span class="pz-kbd">↓</span><span class="pz-kbd">→</span>${esc(tr('BRUSH', 'RÊ CHỔI'))}<span class="pz-kbd" style="margin-left: 6px">SPACE</span>${esc(tr('DUST', 'RẮC BỘT'))}</p>
        <p class="pp-rail-tool" data-pp-pickhint hidden>${esc(tr('PICK A REFERENCE CARD →', 'CHỌN THẺ MẪU Ở CỘT BÊN PHẢI →'))}</p>
      </div>
      <div class="pp-mat" data-pp-mat>
        <div class="pp-bench" data-pp-bench>
          <div class="pp-lidcol">
            <div class="pp-lidwrap" data-pp-lid tabindex="0" role="application" aria-roledescription="${esc(tr('surface', 'mặt vật chứng'))}" aria-label="${esc(tr('The surface. Drag to brush powder; arrow keys move the brush, space dusts on the spot.', `${params.surface || 'Mặt kim loại'}. Kéo để rê chổi rắc bột; phím mũi tên di chổi, phím cách rắc tại chỗ.`))}" aria-describedby="pp-meter-lbl">
              <svg class="pp-lid" viewBox="0 0 560 410" aria-hidden="true" focusable="false" data-pp-lidsvg>
                <rect x="92" y="2" width="78" height="16" rx="5" fill="url(#pp-hinge)"></rect>
                <rect x="390" y="2" width="78" height="16" rx="5" fill="url(#pp-hinge)"></rect>
                <rect x="12" y="12" width="536" height="384" rx="20" fill="url(#pp-steel)"></rect>
                <rect x="12" y="12" width="536" height="384" rx="20" fill="url(#pp-hair)"></rect>
                <rect x="12" y="12" width="536" height="384" rx="20" fill="url(#pp-rake)"></rect>
                <path d="M120 12H196L74 396H12V350Z" fill="rgba(255,240,215,.035)"></path>
                <rect x="12.75" y="12.75" width="534.5" height="382.5" rx="19.5" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.5"></rect>
                <rect x="30" y="30" width="500" height="326" rx="10" fill="none" stroke="rgba(0,0,0,.34)" stroke-width="2"></rect>
                <rect x="31.5" y="31.5" width="497" height="323" rx="9" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="1"></rect>
                <path d="M12 368H548V376A20 20 0 0 1 528 396H32A20 20 0 0 1 12 376Z" fill="url(#pp-lipg)"></path>
                <path d="M24 368.75H536" stroke="rgba(255,255,255,.2)" stroke-width="1.5"></path>
                <g transform="translate(38 38) rotate(22)"><circle r="9" fill="url(#pp-screw)"></circle><circle r="9" fill="none" stroke="rgba(0,0,0,.55)"></circle><rect x="-6.5" y="-1.3" width="13" height="2.6" rx="1" fill="#16191c"></rect></g>
                <g transform="translate(522 38) rotate(-38)"><circle r="9" fill="url(#pp-screw)"></circle><circle r="9" fill="none" stroke="rgba(0,0,0,.55)"></circle><rect x="-6.5" y="-1.3" width="13" height="2.6" rx="1" fill="#16191c"></rect></g>
                <g transform="translate(38 340) rotate(64)"><circle r="9" fill="url(#pp-screw)"></circle><circle r="9" fill="none" stroke="rgba(0,0,0,.55)"></circle><rect x="-6.5" y="-1.3" width="13" height="2.6" rx="1" fill="#16191c"></rect></g>
                <g transform="translate(522 340) rotate(-8)"><circle r="9" fill="url(#pp-screw)"></circle><circle r="9" fill="none" stroke="rgba(0,0,0,.55)"></circle><rect x="-6.5" y="-1.3" width="13" height="2.6" rx="1" fill="#16191c"></rect></g>
                <g transform="translate(204 44)">
                  <rect x="0" y="2" width="152" height="34" rx="3" fill="rgba(0,0,0,.45)"></rect>
                  <rect x="0" y="0" width="152" height="34" rx="3" fill="url(#pp-brass)"></rect>
                  <rect x="3.5" y="3.5" width="145" height="27" rx="2" fill="none" stroke="rgba(94,74,28,.6)"></rect>
                  <circle cx="11" cy="17" r="2.6" fill="#5e4a1c"></circle><circle cx="141" cy="17" r="2.6" fill="#5e4a1c"></circle>
                  <text class="pp-plate pp-plate-hi" x="76" y="22.8">${esc(params.plate || tr('METAL BOX', 'HỘP KIM LOẠI'))}</text>
                  <text class="pp-plate" x="76" y="21.8">${esc(params.plate || tr('METAL BOX', 'HỘP KIM LOẠI'))}</text>
                </g>
                <use href="#pp-latent" class="pp-sheen"></use>
              </svg>
              <svg class="pp-pow" viewBox="0 0 560 410" aria-hidden="true" focusable="false">
                <g mask="url(#pp-dust)">
                  <rect x="12" y="12" width="536" height="384" rx="20" fill="url(#pp-grain)"></rect>
                  <use href="#pp-smudge" class="pp-pow-smudge"></use>
                  <use href="#pp-latent" class="pp-pow-ridges"></use>
                </g>
                <g class="pp-lifted" data-pp-lifted>
                  <rect x="${LR.x}" y="${LR.y}" width="${LR.w}" height="${LR.h}" fill="url(#pp-steel)"></rect>
                  <rect x="${LR.x}" y="${LR.y}" width="${LR.w}" height="${LR.h}" fill="url(#pp-hair)"></rect>
                  <rect x="${LR.x}" y="${LR.y}" width="${LR.w}" height="${LR.h}" fill="url(#pp-rake)"></rect>
                  <use href="#pp-latent" class="pp-sheen"></use>
                  <rect x="${LR.x + 0.5}" y="${LR.y + 0.5}" width="${LR.w - 1}" height="${LR.h - 1}" fill="none" stroke="rgba(220,226,230,.22)" stroke-width="1"></rect>
                </g>
              </svg>
              <svg class="pp-edge" data-pp-edge viewBox="0 0 560 410" aria-hidden="true" focusable="false"><path d="M40 384H520"></path><text x="280" y="362">${esc(params.edge || tr('FRONT EDGE', 'MÉP TRƯỚC'))}</text></svg>
              ${PUFFS.map((set, i) => `<span class="pp-puff" data-pp-puff="${i}" aria-hidden="true"><b></b>${set.map(([dx, dy, s]) => `<i style="--dx: ${dx}px; --dy: ${dy}px; --s: ${s}px"></i>`).join('')}</span>`).join('')}
              <span class="pp-brush rest" data-pp-brush aria-hidden="true">
                <svg viewBox="-30 -145 130 170" focusable="false">
                  <ellipse class="pp-brush-sh" cx="18" cy="8" rx="20" ry="7"></ellipse>
                  <g class="pp-brush-tilt">
                    <path d="M-6.6 -50C-6.2 -82 -4.6 -112 -3.6 -132Q0 -137 3.6 -132C4.6 -112 6.2 -82 6.6 -50Z" fill="url(#pp-wood)"></path>
                    <path d="M-1.6 -60C-1.4 -90 -1 -114 -.6 -128" fill="none" stroke="rgba(255,226,180,.32)" stroke-width="1.2" stroke-linecap="round"></path>
                    <path d="M-8 -31H8L7 -51H-7Z" fill="url(#pp-ferr)"></path>
                    <path d="M-7.6 -37H7.6M-7.2 -45H7.2" stroke="rgba(60,44,16,.55)" stroke-width="1"></path>
                    <g class="pp-bb">
                      <path d="M-7 -31C-10 -21 -16 -11 -15 -3C-9 1.5 9 1.5 15 -3C16 -11 10 -21 7 -31Z" fill="url(#pp-bris)"></path>
                      <path d="M-5 -30L-12 -3M-2.5 -30L-6 -1M0 -30L0 0M2.5 -30L6 -1M5 -30L12 -3" stroke="rgba(52,40,26,.35)" stroke-width=".8" fill="none"></path>
                      <ellipse cx="0" cy="-3" rx="13.5" ry="3.6" fill="rgba(228,232,236,.75)"></ellipse>
                    </g>
                  </g>
                </svg>
              </span>
            </div>
            <div class="pp-tray">
              <div class="pp-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-labelledby="pp-meter-lbl" data-pp-meter>
                <div class="pp-meter-top"><span class="pp-meter-lbl" id="pp-meter-lbl">${esc(tr('Print clarity', 'Độ rõ của dấu'))}: <b data-pp-cov>0%</b></span><span class="pp-meter-need" data-pp-need></span></div>
                <div class="pp-meter-bar"><i data-pp-bar style="width: 0%"></i><span class="pp-meter-tick" style="left: ${thrPct}%" aria-hidden="true"></span></div>
              </div>
              <div class="pp-tray-act">
                <button type="button" class="s-btn s-btn-gold pp-passbtn" aria-describedby="pp-meter-lbl" data-pp-pass><svg viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M12.6 1.6L16.4 5.4L9.6 12.2L5.8 8.4Z" fill="currentColor" opacity=".55"></path><path d="M5.2 9L9 12.8C8.2 15 6.2 16.6 2 16.4C1.8 12.4 3 9.8 5.2 9Z" fill="currentColor"></path></svg>${esc(tr('Dust one pass', 'Rắc một lượt'))}</button>
                <button type="button" class="s-btn s-btn-red pp-liftbtn" data-pp-liftbtn></button>
              </div>
            </div>
          </div>
          <div class="pp-liftcol">
            <div class="pp-lift" data-pp-liftcard>
              <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
              <div class="pp-lift-head"><span>${esc(tr('LIFTED PRINT', 'DẤU ĐÃ NHẤC'))}</span><span>Nº 07</span></div>
              <div class="pp-lift-slot" data-pp-slot>
                <svg class="pp-lift-svg" data-pp-liftsvg hidden viewBox="${LR.x} ${LR.y} ${LR.w} ${LR.h}" role="img" aria-label="${esc(tr('The lifted print', 'Dấu vân tay đã nhấc'))}"><g mask="url(#pp-dust)"><rect x="${LR.x}" y="${LR.y}" width="${LR.w}" height="${LR.h}" fill="url(#pp-grain-dk)"></rect><use href="#pp-latent" class="pp-ink-lift"></use></g></svg>
                <span class="pp-lift-tape" data-pp-lifttape hidden aria-hidden="true"></span>
                <span class="pp-lift-empty" data-pp-liftempty>${esc(tr('No print yet', 'Chưa có dấu'))}<i>${esc(tr('Tape it once the print is clear.', 'Dán băng keo khi dấu đủ rõ.'))}</i></span>
              </div>
              <dl class="pp-lift-meta">
                <div><dt>${esc(tr('EVIDENCE', 'VẬT CHỨNG'))}</dt><dd>${esc(params.surface || tr('Metal surface', 'Mặt kim loại'))}</dd></div>
                <div><dt>${esc(tr('PLACE', 'VỊ TRÍ'))}</dt><dd>${esc(params.place || tr('Front edge', 'Mép trước'))}</dd></div>
                <div><dt>${esc(tr('TAKEN BY', 'NGƯỜI LẤY'))}</dt><dd data-pp-by>—</dd></div>
              </dl>
            </div>
            <div class="pp-kit" aria-hidden="true">
              <span><svg viewBox="0 0 58 58"><rect x="15" y="6" width="28" height="9" rx="2" fill="#c7a24b"></rect><rect x="15" y="12" width="28" height="3" fill="#5e4a1c"></rect><path d="M12 17H46V50A4 4 0 0 1 42 54H16A4 4 0 0 1 12 50Z" fill="#1d2a2e" stroke="rgba(207,214,220,.35)"></path><path d="M13 34H45V50A3 3 0 0 1 42 53H16A3 3 0 0 1 13 50Z" fill="#b9c0c6"></path><rect x="17" y="22" width="24" height="9" fill="#e9dcc0"></rect><path d="M20 26.5H38" stroke="#5b5248" stroke-width="1.5"></path></svg>${esc(tr('GREY POWDER', 'BỘT XÁM'))}</span>
              <span><svg viewBox="0 0 58 58"><circle cx="29" cy="31" r="21" fill="rgba(236,240,230,.32)" stroke="rgba(236,240,230,.55)" stroke-width="1.5"></circle><circle cx="29" cy="31" r="11" fill="#0f1815" stroke="#c9c1ad" stroke-width="3"></circle><path d="M44 16L54 10L56 15L46 21Z" fill="rgba(236,240,230,.45)"></path></svg>${esc(tr('TAPE', 'BĂNG KEO'))}</span>
            </div>
          </div>
        </div>
        <div class="pp-cmp" data-pp-cmp hidden>
          <div class="pp-cmp-head">
            <span class="pp-cmp-lab"><b>${esc(tr('LIFTED PRINT', 'DẤU ĐÃ NHẤC'))}</b> · ${esc(String(params.plate || '').toUpperCase())}</span>
            <span class="pp-count" data-pp-count>${esc(tr('Matching points', 'Điểm trùng'))}: <b data-pp-countn>0/9</b></span>
            <span class="pp-cmp-lab"><b>${esc(tr('REFERENCE', 'THẺ MẪU'))}</b> · <span data-pp-cmpwho></span></span>
          </div>
          ${fig('h')}
          ${fig('v')}
        </div>
        <div class="pp-tape" data-pp-tape hidden aria-hidden="true">
          <div class="pp-tape-sheet">
            <svg class="pp-tape-print" viewBox="${LR.x} ${LR.y} ${LR.w} ${LR.h}" preserveAspectRatio="none"><g mask="url(#pp-dust)"><rect x="${LR.x}" y="${LR.y}" width="${LR.w}" height="${LR.h}" fill="url(#pp-grain)"></rect><use href="#pp-latent" class="pp-pow-ridges"></use></g></svg>
            <svg class="pp-tape-print dk" viewBox="${LR.x} ${LR.y} ${LR.w} ${LR.h}" preserveAspectRatio="none"><g mask="url(#pp-dust)"><rect x="${LR.x}" y="${LR.y}" width="${LR.w}" height="${LR.h}" fill="url(#pp-grain-dk)"></rect><use href="#pp-latent" class="pp-ink-lift"></use></g></svg>
            <span class="pp-tape-gloss"></span>
          </div>
          <span class="pp-tape-roll"></span>
        </div>
      </div>
      <div class="pp-acts"><button type="button" class="s-btn s-btn-gold s-btn-sm" data-pp-reset></button></div>
    </div>
    <aside class="pp-refs" aria-labelledby="pp-refs-h">
      <div class="pz-card s-paper pp-case">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>${esc(note.title || tr('Where the print was', 'Nơi có dấu tay'))}</h3>
        <p>${esc(note.text || tr('The metal is still polished — a print will come up clearly with grey powder.', 'Mặt kim loại còn bóng — dấu tay sẽ lên rõ với bột xám.'))}</p>
        <span class="pz-tag mine">${esc(note.tag || tr('YOUR FIND', 'BẠN TÌM THẤY'))}</span>
        ${testimony?.text ? `<div class="pp-case-tv"><span class="g-mono rust" aria-hidden="true">${esc(String(testimony.mono || 'ĐĐ').slice(0, 3))}</span><p>${esc(testimony.text)}<span class="pz-tag partner">${esc(testimony.tag || tr('SHARED · PARTNER', 'ĐÃ CHIA SẺ · ĐỒNG ĐỘI'))}</span></p></div>` : ''}
      </div>
      <h3 class="pp-refs-h" id="pp-refs-h">${esc(tr('REFERENCE PRINT CARDS', 'THẺ VÂN TAY MẪU'))}</h3>
      <div class="pp-reflist" data-pp-reflist>
        ${cards.map((card) => {
          const look = art(card);
          return `<button type="button" class="pp-ref" data-pp-card="${esc(card.id)}" aria-pressed="false">
            <span class="pp-ref-print" aria-hidden="true"><svg viewBox="-100 -125 200 235"><g mask="url(#pp-tip-ink)"><use href="${look.href}" class="pp-ink-ref${look.flip ? ' pp-flip' : ''}"></use></g></svg></span>
            <span class="pp-ref-body">
              <span class="pp-ref-no">${esc(card.no)}</span>
              <span class="pp-ref-who"><span class="g-mono" aria-hidden="true">${esc(card.mono)}</span><span><b>${esc(card.name)}</b><i>${esc(card.role)}</i></span></span>
              <span class="pp-ref-res" data-pp-res></span>
            </span>
          </button>`;
        }).join('')}
      </div>
      <p class="pp-refs-note" data-pp-refsnote></p>
    </aside>`;
  body.appendChild(root);

  const $ = <T extends Element>(q: string) => root.querySelector<T>(q)!;
  const lid = $<HTMLElement>('[data-pp-lid]');
  const lidSvg = $<SVGSVGElement>('[data-pp-lidsvg]');
  const mat = $<HTMLElement>('[data-pp-mat]');
  const slot = $<HTMLElement>('[data-pp-slot]');
  const cmpEl = $<HTMLElement>('[data-pp-cmp]');
  const tapeEl = $<HTMLElement>('[data-pp-tape]');
  const passBtn = $<HTMLButtonElement>('[data-pp-pass]');
  const liftBtn = $<HTMLButtonElement>('[data-pp-liftbtn]');
  const resetBtn = $<HTMLButtonElement>('[data-pp-reset]');
  const reflist = $<HTMLElement>('[data-pp-reflist]');
  const dabPath = $<SVGPathElement>('[data-pp-dab]');
  const brushEl = $<HTMLElement>('[data-pp-brush]');
  const puffEls = [...root.querySelectorAll<HTMLElement>('[data-pp-puff]')];
  const refEls = new Map(cards.map((card) => [card.id, root.querySelector<HTMLButtonElement>(`[data-pp-card="${CSS.escape(card.id)}"]`)!]));
  const setCls = (node: Element, cls: string) => { if (node.getAttribute('class') !== cls) node.setAttribute('class', cls); };

  // ---- powder: dabs, coverage grids, mask path ----
  function resetDust() {
    dust = new Uint8Array(GW * GH);
    hit = new Uint8Array(cells.length);
    smHit = new Uint8Array(sm.length);
    hitN = 0;
    smN = 0;
    dabs = [];
    dabD = '';
  }
  const circ = (x: number, y: number, r: number) => `M${f1(x - r)} ${f1(y)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  function addDab(x: number, y: number, r: number, force = false) {
    const d: number[] = [];
    const pc: number[] = [];
    const sc: number[] = [];
    const i0 = Math.max(0, Math.floor((x - r) / G));
    const i1 = Math.min(GW - 1, Math.floor((x + r) / G));
    const j0 = Math.max(0, Math.floor((y - r) / G));
    const j1 = Math.min(GH - 1, Math.floor((y + r) / G));
    const rr = (r - 3) * (r - 3);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = i * G + G / 2 - x;
      const cy = j * G + G / 2 - y;
      const k = j * GW + i;
      if (cx * cx + cy * cy <= rr && !dust[k]) d.push(k);
    }
    const pr = (r - 4) * (r - 4);
    for (let i = 0; i < cells.length; i++) { if (hit[i]) continue; const dx = cells[i][0] - x; const dy = cells[i][1] - y; if (dx * dx + dy * dy <= pr) pc.push(i); }
    for (let i = 0; i < sm.length; i++) { if (smHit[i]) continue; const dx = sm[i][0] - x; const dy = sm[i][1] - y; if (dx * dx + dy * dy <= pr) sc.push(i); }
    if (!force && d.length + pc.length < 3) return false;
    // keep the mask light: past the soft cap only dabs that reveal new ridges are added
    if (dabs.length >= HARD || (dabs.length >= CAP && !pc.length)) return false;
    d.forEach((k) => { dust[k] = 1; });
    pc.forEach((i) => { hit[i] = 1; });
    sc.forEach((i) => { smHit[i] = 1; });
    hitN += pc.length;
    smN += sc.length;
    dabs.push([x, y, r]);
    dabD += circ(x, y, r);
    return true;
  }
  function strokeTo(from: { x: number; y: number }, to: { x: number; y: number }) {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const n = Math.max(1, Math.ceil(dist / 9));
    let added = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const k = dabs.length;
      const jx = (((k * 37) % 7) - 3) * 0.7;
      const jy = (((k * 53) % 7) - 3) * 0.7;
      const r = 21 + ((k * 7) % 5) * 1.5;
      if (addDab(from.x + (to.x - from.x) * t + jx, from.y + (to.y - from.y) * t + jy, r)) added++;
    }
    return added;
  }
  function snapDabs() {
    // a full dusting (used when the partner already solved it): serpentine passes over the print
    for (let row = 0; row < 9; row++) {
      const y = -114 + row * 26;
      for (let i = 0; i < 15; i++) {
        const x = (row % 2 ? 1 : -1) * (-90 + i * 12.8);
        const p = toLid(x, y);
        addDab(p[0] + ((i * 7 + row * 3) % 5) - 2, p[1] + ((i * 3 + row * 5) % 5) - 2, 22 + ((i + row) % 4) * 1.5, true);
      }
    }
  }
  function puff(p: { x: number; y: number }) {
    const i = (puffI + 1) % 4;
    const prev = puffs[i];
    puffs = puffs.slice();
    puffs[i] = { x: Math.round(p.x), y: Math.round(p.y), k: prev.k === 'a' ? 'b' : 'a' };
    puffI = i;
    puffT = Date.now();
  }

  // ---- pointer + keyboard brushing (rAF-coalesced) ----
  function toLidPt(e: PointerEvent) {
    try {
      const m = lidSvg.getScreenCTM();
      if (m) { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return { x: p.x, y: p.y }; }
    } catch { /* fall back to the box */ }
    const r = lidSvg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * 560) / r.width, y: ((e.clientY - r.top) * 410) / r.height };
  }
  const clampPt = (p: { x: number; y: number }) => ({ x: Math.max(16, Math.min(544, p.x)), y: Math.max(16, Math.min(392, p.y)) });
  function onLidDown(e: PointerEvent) {
    if (phase !== 'brush' || passing || partnerSolved) return;
    if (e.button != null && e.button > 0) return;
    try { lid.setPointerCapture(e.pointerId); } catch { /* no capture */ }
    down = true;
    last = null;
    pend = clampPt(toLidPt(e));
    schedule();
  }
  function onLidMove(e: PointerEvent) {
    if (phase !== 'brush' || passing || partnerSolved) return;
    pend = clampPt(toLidPt(e));
    schedule();
  }
  function onLidUp(e: PointerEvent) {
    if (!down) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    flush(true);
    down = false;
    last = null;
    try { lid.releasePointerCapture(e.pointerId); } catch { /* released */ }
    brush = { ...brush, down: false };
    render();
  }
  function onLidLeave(e: PointerEvent) {
    const rel = e.relatedTarget as Node | null;
    if (rel && lid.contains(rel)) return;
    if (down || passing) return;
    stopBrush();
    if (brush.on && !brush.kb) { brush = restBrush(); render(); }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(() => flush(false)); }
  function flush(sync: boolean) {
    raf = 0;
    const p = pend;
    if (!p || phase !== 'brush' || !alive) return;
    brush = { x: f1(p.x), y: f1(p.y), on: true, down, kb: false };
    let changed = false;
    if (down) {
      const added = strokeTo(last || p, p);
      last = p;
      if (added) { changed = true; if (Date.now() - puffT > 80) puff(p); }
    }
    if (!sync || changed) render();
  }
  function onLidKey(e: KeyboardEvent) {
    if (phase !== 'brush' || passing || partnerSolved) return;
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    const b = brush.on ? brush : { x: 280, y: 214 };
    let added = 0;
    let to = { x: b.x, y: b.y };
    if (dir) {
      const st = e.shiftKey ? 26 : 13;
      to = clampPt({ x: b.x + dir[0] * st, y: b.y + dir[1] * st });
      added = strokeTo(b, to);
    } else if (e.key === ' ' || e.key === 'Enter') {
      [[0, 0], [15, 8], [-13, 10], [6, -15], [-11, -10]].forEach((o) => { if (addDab(b.x + o[0], b.y + o[1], 24)) added++; });
    } else return;
    e.preventDefault();
    brush = { x: to.x, y: to.y, on: true, down: true, kb: true };
    if (added) puff(to);
    render();
    if (kbT) window.clearTimeout(kbT);
    kbT = window.setTimeout(() => { kbT = 0; if (alive && brush.kb) { brush = { ...brush, down: false }; render(); } }, 220);
  }
  function onLidFocus() {
    if (phase !== 'brush' || passing || brush.on || partnerSolved) return;
    brush = { x: 280, y: 214, on: true, down: false, kb: true };
    render();
  }
  function onLidBlur() { if (brush.kb && !passing) { brush = restBrush(); render(); } }
  function stopBrush() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    down = false;
    pend = null;
    last = null;
  }

  // keyboard / touch helper: "Rắc một lượt" sweeps one band along the front edge
  function pass() {
    if (phase !== 'brush' || partnerSolved) return;
    if (passing) { passQ = Math.min(3, passQ + 1); return; }
    const k = passN++;
    const row = k % 12;
    const y = 350 - row * 26;
    const xs: number[] = [];
    for (let x = 46; x <= 514; x += 13) xs.push(x);
    if (row % 2) xs.reverse();
    const at = (i: number) => ({ x: xs[i], y: y + (((i * 7 + row * 3) % 5) - 2) * 1.6 });
    stopBrush();
    if (kbT) { window.clearTimeout(kbT); kbT = 0; }
    if (reduced()) {
      xs.forEach((_, i) => { const p = at(i); addDab(p.x, p.y, 23 + (i % 3) * 1.5); });
      const p = at(xs.length - 1);
      brush = { x: p.x, y: p.y, on: true, down: false, kb: true };
      live = true;
      render();
      return;
    }
    passing = true;
    let i = 0;
    const tick = () => {
      const end = Math.min(xs.length - 1, i + 2);
      let added = 0;
      let p = at(i);
      for (; i <= end; i++) { p = at(i); if (addDab(p.x, p.y, 23 + (i % 3) * 1.5)) added++; }
      const fin = i >= xs.length;
      brush = { x: p.x, y: p.y, on: true, down: !fin, kb: true };
      live = true;
      if (!fin && added && Date.now() - puffT > 90) puff(p);
      if (fin) passing = false;
      render();
      if (!fin) later(46, tick);
      else if (passQ > 0) { passQ--; later(110, pass); }
    };
    tick();
  }

  // ---- step 2: lift with tape ----
  function measureTape() {
    try {
      const m = mat.getBoundingClientRect();
      const ctm = lidSvg.getScreenCTM()!;
      const p1 = new DOMPoint(LR.x, LR.y).matrixTransform(ctm);
      const p2 = new DOMPoint(LR.x + LR.w, LR.y + LR.h).matrixTransform(ctm);
      const x = p1.x - m.left;
      const y = p1.y - m.top;
      const w = p2.x - p1.x;
      const h = p2.y - p1.y;
      const sl = slot.getBoundingClientRect();
      const ts = Math.min(sl.width / w, sl.height / h);
      return { x: f1(x), y: f1(y), w: f1(w), h: f1(h), tx: f1(sl.left - m.left + sl.width / 2 - (x + w / 2)), ty: f1(sl.top - m.top + sl.height / 2 - (y + h / 2)), ts: Math.round(ts * 1000) / 1000 };
    } catch {
      return { x: 240, y: 190, w: 180, h: 188, tx: 380, ty: -60, ts: 0.8 };
    }
  }
  function lift(kb: boolean) {
    if (phase !== 'brush' || cov() < threshold) return;
    clearTimers();
    stopBrush();
    brush = restBrush();
    const now = new Date();
    liftedAt = `${tr('You', 'Bạn')} · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const done = () => { if (kb) later(60, () => focusIn(reflist, 'button')); };
    if (reduced()) { phase = 'lifted'; live = true; tape = null; render(); later(40, () => reveal(slot, 'center')); done(); return; }
    phase = 'lifting';
    live = true;
    tape = measureTape();
    render();
    // phones: the backing card sits below the lid, so follow the tape down to it
    later(1150, () => reveal(slot, 'center'));
    later(2350, () => { phase = 'lifted'; tape = null; render(); done(); });
  }
  function focusIn(el: HTMLElement, sel?: string) {
    try { const t = sel ? el.querySelector<HTMLElement>(`${sel}:not([disabled])`) : el; t?.focus({ preventScroll: true }); } catch { /* not mounted */ }
  }
  function reveal(target?: HTMLElement, block?: ScrollLogicalPosition) {
    try {
      const el = target || cmpEl || mat;
      if (!el || !isPhone()) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      if (block === 'center' ? r.top < 0 || r.bottom > vh : r.top < 0 || r.top > vh * 0.35) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: block || 'start' });
    } catch { /* static */ }
  }

  // ---- step 3: compare with a reference card (the server judges) ----
  function pickCard(id: string, kb: boolean) {
    if (phase !== 'lifted' || verdict === 'match' || busy || partnerSolved) return;
    if (pick === id && !verdict) return;
    clearTimers();
    wipe = !wipe;
    pick = id;
    cmpN = 0;
    verdict = null;
    outcome = null;
    live = true;
    busy = true;
    render();
    later(60, () => reveal());
    ctx.submit({ card: id })
      .then((result) => {
        busy = false;
        if (!alive) return;
        const fb = result.feedback ?? {};
        if (result.solved) {
          outcome = 'match';
          // the host lays its win card over the sheet about a second after a solve: draw the nine lines quickly
          if (reduced()) { cmpN = 9; verdict = 'match'; render(); return; }
          for (let i = 1; i <= 9; i++) later(60 + (i - 1) * 70, () => { cmpN = i; render(); });
          later(60 + 8 * 70 + 140, () => { verdict = 'match'; render(); if (kb) later(80, () => body.closest('.pz-sheet')?.querySelector<HTMLElement>('[data-pzh-close]')?.focus()); });
          return;
        }
        if (fb.reason === 'invalid' || fb.match !== false) {
          pick = null;
          status(tr('NOT COMPARED', 'CHƯA SO ĐƯỢC'), result.message || tr('The card could not be compared.', 'Không so được thẻ này.'), 'bad');
          render();
          return;
        }
        breakAt = Math.max(1, Math.min(9, Number(fb.breakAt) || 3));
        outcome = 'fail';
        const failNow = () => { failed[id] = true; verdict = 'fail'; render(); };
        if (reduced()) { cmpN = breakAt; failNow(); return; }
        const t0 = 700;
        const step = 330;
        for (let i = 1; i <= breakAt; i++) later(t0 + (i - 1) * step, () => { cmpN = i; render(); });
        later(t0 + (breakAt - 1) * step + 780, failNow);
      })
      .catch((error) => {
        busy = false;
        if (!alive) return;
        pick = null;
        status(tr('NOT SENT', 'CHƯA GỬI'), error?.message || tr('Could not reach the server.', 'Không gửi được tới máy chủ.'), 'bad');
        render();
      });
  }

  function reset() {
    if (phase === 'lifting' || busy || partnerSolved || verdict === 'match') return;
    clearTimers();
    stopBrush();
    if (phase === 'brush') { resetDust(); passN = 0; brush = restBrush(); live = true; render(); return; }
    resetDust();
    passN = 0;
    brush = restBrush();
    phase = 'brush';
    tape = null;
    pick = null;
    cmpN = 0;
    verdict = null;
    outcome = null;
    live = true;
    render();
  }

  function solvedByPartner() {
    if (outcome === 'match') return;
    clearTimers();
    stopBrush();
    partnerSolved = true;
    if (phase === 'brush') { resetDust(); snapDabs(); }
    phase = 'lifted';
    tape = null;
    live = false;
    render();
  }

  // ---- geometry of one comparison layout (h: side by side, v: stacked on phones) ----
  function geo(L: 'h' | 'v', decoyOf: Card | undefined) {
    const A = L === 'h' ? { x: 128, y: 150, k: 1.1 } : { x: 150, y: 140, k: 1 };
    const B = L === 'h' ? { x: 392, y: 150, k: 1.1 } : { x: 150, y: 420, k: 1 };
    const W = L === 'h' ? 520 : 300;
    const H = L === 'h' ? 300 : 560;
    const decoy = decoyOf ? art(decoyOf).decoy : null;
    return M.map((m, idx) => {
      const t = decoy && idx < 2 ? decoy[idx] : m;
      const pa: Pt = [A.x + A.k * m[0], A.y + A.k * m[1]];
      const pb: Pt = [B.x + B.k * t[0], B.y + B.k * t[1]];
      let cx = (pa[0] + pb[0]) / 2;
      let cy = (pa[1] + pb[1]) / 2;
      if (L === 'h') { const off = cy - A.y; cy += (off < 0 ? -1 : 1) * (4 + Math.abs(off) * 0.06); } else { const off = cx - A.x; cx += (off < 0 ? -1 : 1) * (4 + Math.abs(off) * 0.06); }
      const up = (p: Pt) => (p[1] < -8 ? -1 : 1);
      const side = (p: Pt) => (p[0] < 0 ? -1 : 1);
      return {
        ax: f1((pa[0] / W) * 100), ay: f1((pa[1] / H) * 100), bx: f1((pb[0] / W) * 100), by: f1((pb[1] / H) * 100),
        d: `M${f1(pa[0])} ${f1(pa[1])}Q${f1(cx)} ${f1(cy)} ${f1(pb[0])} ${f1(pb[1])}`,
        oa: L === 'h' ? [-12, up(m) * 10] : [side(m) * 11, -11], ob: L === 'h' ? [12, up(t) * 10] : [side(t) * 11, 11],
      };
    });
  }

  // ---- status ----
  let lastStatus = '';
  function status(kick: string, text: string, tone: PuzzleTone = 'info') {
    const line = `${kick} · ${text}`;
    if (line === lastStatus) return;
    lastStatus = line;
    ctx.setStatus(line, tone);
  }

  // ---- view ----
  let lastDab = -1;
  let figKey = '';
  function render() {
    if (!alive) return;
    root.classList.toggle('pp-rm', reduced());
    const brushing = phase === 'brush';
    const lifting = phase === 'lifting';
    const lifted = phase === 'lifted';
    const c = cov();
    const covPct = Math.min(100, Math.round(c * 100));
    const ready = c >= threshold;
    const lvl = level();
    const card = cards.find((x) => x.id === pick);
    const n = cmpN;
    const match = verdict === 'match';

    // rail
    const r1Done = !brushing || ready;
    const r2Done = lifted;
    const r3Done = match || partnerSolved;
    const r1Cur = brushing && !ready;
    const r2Cur = (brushing && ready) || lifting;
    const r3Cur = lifted && !r3Done;
    [[r1Done, r1Cur], [r2Done, r2Cur], [r3Done, r3Cur]].forEach(([isDone, cur], i) => {
      const li = root.querySelector<HTMLElement>(`[data-pp-rail="${i + 1}"]`)!;
      setCls(li, isDone ? 'done' : cur ? 'cur' : '');
      li.setAttribute('aria-current', cur ? 'step' : 'false');
      li.querySelector('.pp-n')!.textContent = isDone ? '✓' : String(i + 1);
    });
    $<HTMLElement>('[data-pp-keys]').hidden = !brushing;
    $<HTMLElement>('[data-pp-pickhint]').hidden = !(lifted && !match && !partnerSolved);

    // bench vs comparison
    const showCmp = lifted && !!pick;
    $<HTMLElement>('[data-pp-bench]').hidden = showCmp;
    cmpEl.hidden = !showCmp;
    setCls(lid, 'pp-lidwrap' + (brushing && !partnerSolved ? ' can' : ''));
    if (dabs.length !== lastDab) { dabPath.setAttribute('d', dabD); lastDab = dabs.length; }
    setCls($('[data-pp-lifted]'), 'pp-lifted' + (lifting || lifted ? ' on' : '') + (lifting ? ' live' : ''));
    setCls($('[data-pp-edge]'), 'pp-edge' + (lvl >= 1 && brushing ? ' on' : ''));
    setCls(brushEl, 'pp-brush' + (brush.on ? '' : ' rest') + (brush.down ? ' down' : '') + (brushing ? '' : ' hide'));
    brushEl.style.transform = `translate3d(${Math.round((brush.x / 5.6) * 1000) / 1000}cqw, ${Math.round((brush.y / 5.6) * 1000) / 1000}cqw, 0)`;
    puffEls.forEach((el, i) => {
      const p = puffs[i];
      setCls(el, 'pp-puff' + (p.k ? ` ${p.k}` : ''));
      el.style.transform = `translate3d(${Math.round((p.x / 5.6) * 1000) / 1000}cqw, ${Math.round((p.y / 5.6) * 1000) / 1000}cqw, 0)`;
    });
    // meter + tray
    $<HTMLElement>('[data-pp-meter]').setAttribute('aria-valuenow', String(covPct));
    $<HTMLElement>('[data-pp-cov]').textContent = `${covPct}%`;
    const need = $<HTMLElement>('[data-pp-need]');
    need.textContent = lifted ? tr('PRINT LIFTED', 'ĐÃ NHẤC DẤU') : lifting ? tr('LIFTING…', 'ĐANG NHẤC…') : ready ? tr('CLEAR ENOUGH TO LIFT', 'ĐỦ RÕ ĐỂ NHẤC') : tr(`NEEDS ${thrPct}%`, `CẦN ĐẠT ${thrPct}%`);
    setCls(need, 'pp-meter-need' + (ready ? ' ok' : ''));
    const bar = $<HTMLElement>('[data-pp-bar]');
    bar.style.width = `${covPct}%`;
    setCls(bar, ready ? 'ok' : '');
    passBtn.disabled = !brushing || partnerSolved;
    setCls(passBtn, 's-btn s-btn-gold pp-passbtn' + (passing ? ' busy' : ''));
    liftBtn.disabled = !(brushing && ready) || partnerSolved;
    setCls(liftBtn, 's-btn s-btn-red pp-liftbtn' + (brushing && ready ? ' ready' : ''));
    liftBtn.textContent = lifted ? tr('Print lifted', 'Đã nhấc dấu') : lifting ? tr('Lifting the print…', 'Đang nhấc dấu…') : tr('Lift the print with tape', 'Nhấc dấu bằng băng keo');
    // lift card
    setCls($('[data-pp-liftcard]'), 'pp-lift' + (lifted ? ' got' : '') + (lifted && !live ? ' still' : ''));
    $<HTMLElement>('[data-pp-liftsvg]').hidden = !lifted;
    $<HTMLElement>('[data-pp-lifttape]').hidden = !lifted;
    $<HTMLElement>('[data-pp-liftempty]').hidden = lifted;
    $<HTMLElement>('[data-pp-by]').textContent = lifted ? liftedAt || tr('Your partner', 'Đồng đội') : '—';
    // flying tape
    tapeEl.hidden = !(lifting && tape);
    if (lifting && tape) {
      tapeEl.style.cssText = `left: ${tape.x}px; top: ${tape.y}px; width: ${tape.w}px; height: ${tape.h}px; --tx: ${tape.tx}px; --ty: ${tape.ty}px; --ts: ${tape.ts}`;
    }
    // comparison
    if (showCmp && card) {
      setCls(cmpEl, 'pp-cmp' + (live ? (wipe ? ' wb' : ' wa') : ' still'));
      const look = art(card);
      const isMatch = outcome === 'match';
      const isFail = outcome === 'fail';
      const count = isMatch ? n : Math.min(n, Math.max(0, breakAt - 1));
      setCls($('[data-pp-count]'), 'pp-count' + (verdict === 'fail' ? ' bad' : match ? ' ok' : ''));
      $<HTMLElement>('[data-pp-countn]').textContent = `${count}/9`;
      $<HTMLElement>('[data-pp-cmpwho]').textContent = card.name.toUpperCase();
      root.querySelectorAll<HTMLElement>('[data-pp-fig]').forEach((figEl) => {
        const L = figEl.dataset.ppFig as 'h' | 'v';
        const key = `${L}|${card.id}|${isFail ? 'd' : 'r'}`;
        const g = geo(L, isFail ? card : undefined);
        const use = figEl.querySelector<SVGUseElement>('[data-pp-cmpref]')!;
        if (use.getAttribute('href') !== look.href) use.setAttribute('href', look.href);
        setCls(use, 'pp-ink-ref' + (look.flip ? ' pp-flip' : ''));
        if (figKey.indexOf(key) < 0) {
          g.forEach((pt, i) => {
            figEl.querySelector(`[data-pp-halo="${i + 1}"]`)!.setAttribute('d', pt.d);
            figEl.querySelector(`[data-pp-ln="${i + 1}"]`)!.setAttribute('d', pt.d);
            const ma = figEl.querySelector<HTMLElement>(`[data-pp-ma="${i + 1}"]`)!;
            ma.style.left = `${pt.ax}%`; ma.style.top = `${pt.ay}%`; ma.style.setProperty('--bx', `${pt.oa[0]}px`); ma.style.setProperty('--by', `${pt.oa[1]}px`);
            const mb = figEl.querySelector<HTMLElement>(`[data-pp-mb="${i + 1}"]`)!;
            mb.style.left = `${pt.bx}%`; mb.style.top = `${pt.by}%`; mb.style.setProperty('--bx', `${pt.ob[0]}px`); mb.style.setProperty('--by', `${pt.ob[1]}px`);
          });
          const brk = g[breakAt - 1];
          figEl.querySelector('[data-pp-brk]')!.setAttribute('d', brk.d);
          figEl.querySelector('[data-pp-brkrev]')!.setAttribute('d', brk.d);
          const x = figEl.querySelector<HTMLElement>('[data-pp-x]')!;
          x.style.left = `${brk.bx}%`; x.style.top = `${brk.by}%`;
          figKey = figKey.split(';').filter((k) => !k.startsWith(`${L}|`)).concat(key).join(';');
        }
        for (let i = 1; i <= 9; i++) {
          const on = isMatch ? i <= n : isFail && i < breakAt && i <= n;
          setCls(figEl.querySelector(`[data-pp-halo="${i}"]`)!, 'pp-halo' + (on ? ' on' : ''));
          setCls(figEl.querySelector(`[data-pp-ln="${i}"]`)!, 'pp-ln' + (on ? ' on' : ''));
          setCls(figEl.querySelector(`[data-pp-mb="${i}"]`)!, 'pp-mk b' + (on ? ' on' : ''));
          setCls(figEl.querySelector(`[data-pp-ma="${i}"]`)!, 'pp-mk a on');
        }
        const broke = isFail && n >= breakAt;
        setCls(figEl.querySelector('[data-pp-brk]')!, 'pp-brk' + (broke ? ' on' : ''));
        setCls(figEl.querySelector('[data-pp-brkrev]')!, 'pp-brk-rev' + (broke ? ' on' : ''));
        setCls(figEl.querySelector('[data-pp-x]')!, 'pp-xmk' + (broke ? ' on' : ''));
        figEl.querySelectorAll('[data-pp-scar]').forEach((el) => setCls(el, 'pp-scarring' + (match ? ' on' : '')));
        setCls(figEl.querySelector('[data-pp-scarhint]')!, 'pp-scarhint' + (lvl >= 2 ? ' on' : ''));
        const stamp = figEl.querySelector<HTMLElement>('[data-pp-cstamp]')!;
        setCls(stamp, 'pp-cstamp' + (match ? ' ok long' : verdict === 'fail' ? ' bad' : ''));
        stamp.textContent = match ? tr('MATCH · 9 POINTS', 'TRÙNG KHỚP · 9 ĐIỂM') : verdict === 'fail' ? tr('NO MATCH', 'KHÔNG KHỚP') : '';
      });
    }
    // reference cards
    cards.forEach((cd) => {
      const el = refEls.get(cd.id)!;
      const pressed = pick === cd.id;
      const isFailed = !!failed[cd.id];
      const isMatch = pressed && match;
      const running = pressed && !verdict && lifted;
      setCls(el, 'pp-ref' + (isMatch ? ' match' : '') + (lifted && !pick && !partnerSolved ? ' wait' : ''));
      el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      el.disabled = !lifted || partnerSolved || match || busy;
      el.setAttribute('aria-label', tr(`Reference card: ${cd.name}, ${cd.role}`, `Thẻ vân tay mẫu: ${cd.name}, ${cd.role}`) + (isFailed ? tr(' — no match', ' — không khớp') : isMatch ? tr(' — match', ' — trùng khớp') : ''));
      const res = el.querySelector<HTMLElement>('[data-pp-res]')!;
      res.textContent = isMatch ? tr('MATCH', 'TRÙNG KHỚP') : isFailed ? tr('NO MATCH', 'KHÔNG KHỚP') : running ? tr('COMPARING…', 'ĐANG SO…') : '';
      setCls(res, 'pp-ref-res' + (isMatch ? ' ok' : isFailed ? ' bad' : running ? ' run' : ''));
    });
    let refsNote = tr('Lift the print first, then pick a card to compare.', 'Nhấc dấu trước, rồi chọn một thẻ để đối chiếu.');
    if (partnerSolved) refsNote = tr('Your partner has identified the print.', 'Đồng đội đã xác định chủ của dấu vân tay.');
    else if (lifted && !pick) refsNote = tr('Pick a card to compare with the lifted print.', 'Chọn một thẻ để đối chiếu với dấu vừa nhấc.');
    else if (lifted && verdict === 'fail') refsNote = tr('Ruled-out cards are stamped. Pick another one.', 'Thẻ đã loại được đóng dấu. Chọn thẻ khác.');
    else if (lifted && match) refsNote = tr('The owner of the print is identified.', 'Đã xác định chủ của dấu vân tay.');
    else if (lifted) refsNote = tr('Comparing…', 'Đang đối chiếu…');
    $<HTMLElement>('[data-pp-refsnote]').textContent = refsNote;
    resetBtn.textContent = brushing ? tr('Wipe the powder', 'Lau sạch bột') : tr('Take the print again', 'Lấy dấu lại');
    resetBtn.disabled = (brushing && !dabs.length) || lifting || busy || match || partnerSolved;

    // status line
    const who = card?.name ?? '';
    if (partnerSolved) status(tr('IDENTIFIED', 'ĐÃ XÁC ĐỊNH'), tr('Your partner has already matched this print.', 'Đồng đội đã đối chiếu xong dấu vân tay này.'), 'ok');
    else if (brushing) {
      if (!dabs.length) status(tr('STEP 1 · DUST', 'BƯỚC 1 · RẮC BỘT'), tr('The surface looks clean, but the raking light shows a faint smear. Brush so the powder sticks to it.', 'Mặt kim loại trông sạch, nhưng dưới đèn xiên có vệt mờ. Rê chổi để bột bám vào dấu vết.'));
      else if (ready) status(tr('STEP 2 · LIFT', 'BƯỚC 2 · NHẤC DẤU'), tr(`The thumbprint is clear enough (${covPct}%). Tape it to lift it.`, `Dấu ngón cái đã đủ rõ (${covPct}%). Dán băng keo để nhấc dấu.`), 'ok');
      else if (smN / Math.max(1, sm.length) > 0.45 && c < 0.2) status(tr('STEP 1 · DUST', 'BƯỚC 1 · RẮC BỘT'), tr('This is only a smudge — the ridges are dragged, unreadable. Try elsewhere.', 'Vệt này chỉ là dấu nhòe — đường vân bị kéo lệch, không đọc được. Thử chỗ khác.'));
      else if (c >= 0.05) status(tr('STEP 1 · DUST', 'BƯỚC 1 · RẮC BỘT'), tr(`Ridges are showing. Dust the whole print — it needs ${thrPct}% clarity.`, `Đường vân đang hiện ra. Rắc kín dấu ngón tay — cần độ rõ ${thrPct}%.`));
      else status(tr('STEP 1 · DUST', 'BƯỚC 1 · RẮC BỘT'), tr('Powder sticks to the metal but no ridges yet. Try elsewhere.', 'Bột bám lên kim loại nhưng chưa thấy đường vân. Thử chỗ khác.'));
    } else if (lifting) status(tr('STEP 2 · LIFT', 'BƯỚC 2 · NHẤC DẤU'), tr('Press the tape on the print and peel it off — the powder comes with the ridges.', 'Miết băng keo lên dấu rồi bóc nhẹ — bột bám theo đường vân.'));
    else if (!pick) status(tr('STEP 3 · COMPARE', 'BƯỚC 3 · ĐỐI CHIẾU'), tr('The thumbprint is lifted. Pick a reference card to compare.', 'Đã nhấc dấu ngón cái. Chọn một thẻ vân tay mẫu để đối chiếu.'));
    else if (verdict === 'fail') status(tr('NO MATCH', 'KHÔNG KHỚP'), tr(`${who}'s print does not match — no scar across the ridges. Pick another card.`, `Vân tay của ${who} không khớp — không có vết sẹo cắt ngang. Chọn thẻ khác.`), 'bad');
    else if (match) status(tr('MATCH', 'TRÙNG KHỚP'), tr(`9/9 points, scar included: this is ${who}'s thumbprint.`, `9/9 điểm trùng, kể cả vết sẹo cắt chéo: đây là dấu ngón cái của ${who}.`), 'ok');
    else status(tr('STEP 3 · COMPARE', 'BƯỚC 3 · ĐỐI CHIẾU'), tr(`Comparing each point with ${who}'s card…`, `Đang so từng điểm đặc trưng với thẻ của ${who}…`));
  }

  // ---- wiring ----
  const listeners: [EventTarget, string, EventListener][] = [];
  const on = (target: EventTarget, type: string, fn: EventListener) => { target.addEventListener(type, fn); listeners.push([target, type, fn]); };
  on(lid, 'pointerdown', onLidDown as EventListener);
  on(lid, 'pointermove', onLidMove as EventListener);
  on(lid, 'pointerup', onLidUp as EventListener);
  on(lid, 'pointercancel', onLidUp as EventListener);
  on(lid, 'pointerleave', onLidLeave as EventListener);
  on(lid, 'keydown', onLidKey as EventListener);
  on(lid, 'focus', onLidFocus);
  on(lid, 'blur', onLidBlur);
  on(passBtn, 'click', () => pass());
  on(liftBtn, 'click', ((e: MouseEvent) => lift(e.detail === 0)) as EventListener);
  on(resetBtn, 'click', () => reset());
  refEls.forEach((el, id) => on(el, 'click', ((e: MouseEvent) => pickCard(id, e.detail === 0)) as EventListener));

  if (ctx.solved) solvedByPartner();
  else render();

  return {
    update(next) {
      ctx = next;
      if (next.solved && outcome !== 'match' && !busy) solvedByPartner(); // the partner matched it
      else render();
    },
    unmount() {
      alive = false;
      clearTimers();
      stopBrush();
      listeners.forEach(([target, type, fn]) => target.removeEventListener(type, fn));
      root.remove();
    },
  };
}

const fingerprint: PuzzleKindModule = {
  kind: 'fingerprint',
  label: { en: 'Fingerprints', vi: 'Dấu vân tay' },
  mount,
};

export default fingerprint;
