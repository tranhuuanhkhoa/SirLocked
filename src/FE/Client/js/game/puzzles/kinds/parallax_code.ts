/**
 * P8 · Góc nhìn đúng — port of design/project/PuzzlePerspective.dc.html (prefix pv-).
 * Move the viewpoint over a four-layer ink drawing behind a glass door; each layer shifts by
 * −viewpoint × amplitude × depth. White paint pieces on different layers only join into a character at
 * one viewpoint (they snap magnetically there and turn red once found). Enter the three characters in the
 * order the partner's clue gives; the code is checked on the server (ctx.submit { code }).
 *
 * params (all public, generated per case by ParallaxCodeKind): slots [{id,name,short,at}], views [[x,y]],
 * order [slotId], paint {d1..d4: [{g, d}]}, snap, glimmer, amp, depth, viewMinY, width (+ optional text).
 * A found character can also be entered by tapping its chip: that sends "@slot" (the server knows what
 * is painted there), so the client never needs to know the characters.
 * Simplified vs the mockup: the mockup hand-placed each white stroke on an object and clipped it there; the
 * per-case strokes are plain brush lines, and all paint layers sit above all ink layers (each still moving
 * with its own depth) so no foreground object can hide part of a character.
 */
import './parallax_code.css';
import artD1 from './parallax_code/art-d1.svg?raw';
import artD2 from './parallax_code/art-d2.svg?raw';
import artD3 from './parallax_code/art-d3.svg?raw';
import artD4 from './parallax_code/art-d4.svg?raw';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule } from '../types';

type Layer = 'd1' | 'd2' | 'd3' | 'd4';
type Phase = 'play' | 'check' | 'unlock' | 'open' | 'bloom' | 'won';
interface Slot { id: string; name: string; short: string; x: number; y: number }
interface Piece { g: number; a: [number, number]; b: [number, number] }
interface Entry { ch?: string; slot?: number }

const LAYERS: Layer[] = ['d4', 'd3', 'd2', 'd1'];
const ART: Record<Layer, string> = { d1: artD1, d2: artD2, d3: artD3, d4: artD4 };
const PHASE_N: Record<Phase, number> = { play: 0, check: 0, unlock: 1, open: 2, bloom: 3, won: 4 };
const REST = { x: 0, y: 0.2 }; // where the view settles once the cabinet opens
const CODE_LEN = 3;

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;
const fin = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

const DOOR = `<svg class="pv-ink" viewBox="0 0 600 540" focusable="false"><defs><clipPath id="pv-c-esc"><rect x="580" y="236" width="18" height="68"></rect></clipPath></defs><path class="pv-tint" d="M14 14L586 14L586 522L14 522Z"></path><path class="pv-sheen" d="M40 16L150 16L36 250L16 250L16 120Z"></path><path class="pv-sheen s2" d="M176 16L206 16L70 300L56 300Z"></path><path class="pv-sheen s2" d="M560 330L584 300L584 420L500 524L470 524Z"></path><path class="i k4 o3" d="M40 16L16 64M150 16L36 250M206 16L70 300M584 300L560 330"></path><path class="pf" d="M0 0L600 0L600 540L0 540ZM14 14L586 14L586 522L14 522Z" fill-rule="evenodd"></path><path class="i k4 o5" d="M12 0L12 540M9 0L9 540M7 0L7 540M4 0L4 540M2 0L2 209M2 219L2 540M600 0L600 540M597 0L597 540M594 0L595 540M592 0L592 540M590 0L590 540M588 0L588 540M0 0L600 0M0 3L600 3M0 5L328 5M333 5L600 6M0 8L600 8M0 10L600 10M0 13L600 12M0 523L600 523M0 525L600 525M0 528L600 528M0 530L600 531M0 534L600 533M0 536L600 536M0 539L600 538"></path><path class="i k15" d="M14 14L586 14L586 522L14 522Z"></path><path class="i k5 o7" d="M10.5 10.5L589.5 10.5L589.5 525.5L10.5 525.5Z"></path><path class="i k12" d="M1 1L599 1L599 539L1 539Z"></path><path class="pfo" d="M3 79L19 79L19 105L3 105Z"></path><path class="i k5" d="M3 88L19 88M3 96L19 96"></path><path class="if" d="M9.7 83A1.3 1.3 0 1 0 12.3 83A1.3 1.3 0 1 0 9.7 83ZM9.7 101A1.3 1.3 0 1 0 12.3 101A1.3 1.3 0 1 0 9.7 101Z"></path><path class="pfo" d="M3 435L19 435L19 461L3 461Z"></path><path class="i k5" d="M3 444L19 444M3 452L19 452"></path><path class="if" d="M9.7 439A1.3 1.3 0 1 0 12.3 439A1.3 1.3 0 1 0 9.7 439ZM9.7 457A1.3 1.3 0 1 0 12.3 457A1.3 1.3 0 1 0 9.7 457Z"></path><text class="pv-pencil" x="352" y="535">__PENCIL__</text><path class="pv-pencil-u" d="M350 537.8C352.2 537.7 358.9 537.3 363.3 537.2C367.8 537.1 372.2 537.4 376.7 537.4C381.1 537.4 385.6 537.4 390 537.4C394.4 537.4 398.9 537.3 403.3 537.3C407.8 537.3 412.2 537.3 416.7 537.3C421.1 537.4 425.6 537.7 430 537.7C434.4 537.7 438.9 537.4 443.3 537.4C447.8 537.4 452.2 537.7 456.7 537.6C461.1 537.6 467.8 537.1 470 537"></path><path class="pfo" d="M580 244Q589 237 598 244L598 296Q589 303 580 296Z"></path><path class="i k5 o7" d="M597 240L597 300M596 240L596 300M594 240L594 300M593 240L593 300M591 240L591 300" clip-path="url(#pv-c-esc)"></path><path class="i k5" d="M587.6 250A1.4 1.4 0 1 0 590.4 250A1.4 1.4 0 1 0 587.6 250ZM587.6 290A1.4 1.4 0 1 0 590.4 290A1.4 1.4 0 1 0 587.6 290Z"></path><g class="pv-tumb"><circle class="pfo" cx="589" cy="270" r="6.6"></circle><path class="if" d="M587.4 265.8L590.6 265.8L590.1 274.2L587.9 274.2Z"></path><circle class="if" cx="589" cy="267.4" r="2.2"></circle></g><path class="pv-clack" d="M577 258L571 252M575 270L566 270M577 282L571 288M589 234L589 227M589 306L589 313"></path></svg>`;
const GRAIN = `<svg class="pv-grain" viewBox="0 0 600 540" preserveAspectRatio="none" aria-hidden="true" focusable="false"><filter id="pv-f-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".9 .7" numOctaves="2" seed="5" result="n"></feTurbulence><feColorMatrix in="n" type="matrix" values="0 0 0 0 .55  0 0 0 0 .52  0 0 0 0 .47  0 0 0 -1.6 1.02"></feColorMatrix></filter><rect width="600" height="540" filter="url(#pv-f-grain)"></rect></svg>`;
const BUD = `<g class="pv-budg" data-pv="bud"><path class="pv-bstem" pathLength="1" d="M368.5 66.5C367.3 67.2 364 69.8 361.5 70.5C359 71.3 354.8 70.9 353.5 71"></path><g class="pv-bud" style="transform-origin: 353.5px 71px"><path class="pv-budp" d="M353.5 72.5C351.8 72.5 348.5 69.4 348.5 67C348.5 64.6 351.8 58 353.5 58C355.2 58 358.5 64.6 358.5 67C358.5 69.4 355.2 72.5 353.5 72.5Z"></path></g><path class="pv-pet p1" style="transform-origin: 353.5px 71px" d="M353.5 71C351.9 71.3 348 67.8 347.6 65.6C347.2 63.5 349.6 58.3 351.1 58C352.7 57.7 356.7 61.7 357.1 63.9C357.5 66.1 355.1 70.7 353.5 71Z"></path><path class="pv-pet p2 is-red" style="transform-origin: 353.5px 71px" d="M353.5 71C352.7 69.6 354.8 64.8 356.7 63.7C358.7 62.7 364.3 63.2 365.1 64.7C365.9 66.1 363.3 71.1 361.4 72.2C359.4 73.3 354.3 72.4 353.5 71Z"></path><path class="pv-pet p3" style="transform-origin: 353.5px 71px" d="M353.5 71C354.6 69.8 359.8 70.3 361.4 71.8C363 73.3 364.3 78.8 363.2 80C362.1 81.2 356.4 80.3 354.8 78.8C353.2 77.3 352.4 72.2 353.5 71Z"></path><path class="pv-pet p4" style="transform-origin: 353.5px 71px" d="M353.5 71C355 71.7 356.2 76.8 355.3 78.8C354.3 80.8 349.5 83.7 348 83C346.5 82.4 345.6 76.7 346.5 74.7C347.4 72.7 352 70.3 353.5 71Z"></path><path class="pv-pet p5" style="transform-origin: 353.5px 71px" d="M353.5 71C353.3 72.6 348.9 75.4 346.7 75.1C344.5 74.9 340.2 71.2 340.4 69.6C340.5 68 345.5 65.3 347.7 65.5C349.9 65.8 353.7 69.4 353.5 71Z"></path><circle class="pv-bctr" cx="353.5" cy="71" r="2.6"></circle></g>`;

function mount(body: HTMLElement, ctx0: PuzzleContext): PuzzleKindHandle {
  let ctx = ctx0;
  const tr = ctx.tr;
  const p = ctx.params ?? {};
  const rm = () => ctx.reducedMotion;

  // ----- params -----
  const slots: Slot[] = (Array.isArray(p.slots) ? p.slots : []).slice(0, CODE_LEN).map((s: any, i: number) => ({
    id: String(s?.id ?? `s${i}`), name: String(s?.name ?? `#${i + 1}`), short: String(s?.short ?? s?.name ?? `#${i + 1}`),
    x: fin(s?.at?.[0], 300), y: fin(s?.at?.[1], 270),
  }));
  while (slots.length < CODE_LEN) slots.push({ id: `s${slots.length}`, name: `#${slots.length + 1}`, short: `#${slots.length + 1}`, x: 300, y: 270 });
  const views = slots.map((_, i) => ({ x: fin(p.views?.[i]?.[0], 0), y: fin(p.views?.[i]?.[1], 0) }));
  const order: number[] = Array.isArray(p.order) ? p.order.map((id: string) => slots.findIndex((s) => s.id === id)).filter((i: number) => i >= 0) : [0, 1, 2];
  const AX = fin(p.amp?.[0], 110), AY = fin(p.amp?.[1], 90);
  const F: Record<Layer, number> = { d1: fin(p.depth?.d1, 1), d2: fin(p.depth?.d2, 0.66), d3: fin(p.depth?.d3, 0.36), d4: fin(p.depth?.d4, 0.08) };
  const SNAP = fin(p.snap, 0.085);
  const GLIM = fin(p.glimmer, 0.24);
  const VYMIN = fin(p.viewMinY, -0.4);
  const W = fin(p.width, 7.5);
  const pieces: Record<Layer, Piece[]> = { d1: [], d2: [], d3: [], d4: [] };
  for (const layer of LAYERS) {
    for (const item of Array.isArray(p.paint?.[layer]) ? p.paint[layer] : []) {
      const m = /M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(String(item?.d ?? ''));
      if (!m) continue;
      pieces[layer].push({ g: Number.isInteger(item.g) ? item.g : -1, a: [+m[1], +m[2]], b: [+m[3], +m[4]] });
    }
  }

  const sayViews = () => {
    const low = views.filter((v) => v.y > 0.3).length, high = views.filter((v) => v.y < 0).length, side = views.filter((v) => Math.abs(v.x) > 0.6).length;
    if (low >= 2) return tr('you only see it sitting down', 'ngồi xuống rồi mới thấy');
    if (high >= 2) return tr('stand up straight to see it', 'đứng thẳng lên mới thấy');
    if (side >= 2) return tr('step to the side to see it', 'đứng lệch sang bên mới thấy');
    return tr('stand in the right spot to see it', 'đứng đúng chỗ mới thấy');
  };
  const orderWords = order.map((i) => slots[i].short).join(', ');
  const text = {
    mineTag: p.mineTag || tr('PRIVATE · INVESTIGATOR', 'RIÊNG · ĐIỀU TRA VIÊN'),
    clueTitle: p.clueTitle || tr('Pencil on the glass frame', 'Bút chì trên khung kính'),
    pencil: p.pencil || sayViews(),
    clueText: p.clueText || tr('A thin pencil line along the bottom of the glass frame, slanted, as if jotted down in a hurry.', 'Nét chì mảnh sát mép dưới khung kính, viết nghiêng như ghi vội cho chính mình.'),
    partnerMono: p.partnerMono || 'TV',
    partnerName: p.partnerName || tr('Your partner', 'Đồng đội'),
    partnerSays: p.partnerSays || tr('A witness says:', 'Người giúp việc khai:'),
    partnerQuote: String(p.partnerQuote || tr('the owner would sit in the armchair facing the shelf, muttering ‘{order}’.', 'ông chủ hay ngồi ghế bành nhìn kệ, lẩm nhẩm ‘{order}’.')).replace('{order}', orderWords),
    partnerTag: p.partnerTag || tr('SHARED · INTERROGATOR', 'ĐÃ CHIA SẺ · THẨM VẤN VIÊN'),
    ctxTitle: p.contextTitle || tr('A glass cabinet with a code lock', 'Tủ kính khóa mã'),
    ctxText: p.contextText || tr('A lock with three letter wheels. Fresh white paint marks on the objects — not dust, not dirt.', 'Ổ khóa ba ô chữ. Trên các món đồ có những vệt sơn trắng mới — không giống bụi hay vết bẩn.'),
    frameLabel: p.frameLabel || tr('GLASS CABINET · COLLECTOR’S SHELF', 'TỦ KÍNH · KỆ ĐỒ SƯU TẬP'),
  };

  // ----- drawing helpers -----
  const shifted = (piece: Piece, f: number, g: number) => {
    // where a piece lands when seen from its own viewpoint (used to draw the found character small)
    const v = views[g] ?? { x: 0, y: 0 };
    return { a: [piece.a[0] - v.x * AX * f, piece.a[1] - v.y * AY * f], b: [piece.b[0] - v.x * AX * f, piece.b[1] - v.y * AY * f] };
  };
  /** The character painted at slot g, re-assembled from its pieces (ink on paper) — for chips, cells and the pad. */
  const glyphOf = (g: number, cls = 'pv-glyph', width = 9) => {
    const s = slots[g];
    let d = '';
    for (const layer of LAYERS) for (const piece of pieces[layer]) {
      if (piece.g !== g) continue;
      const { a, b } = shifted(piece, F[layer], g);
      d += `M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}`;
    }
    return `<svg class="${cls}" viewBox="${r1(s.x - 40)} ${r1(s.y - 52)} 80 104" aria-hidden="true" focusable="false"><path class="pv-gl" d="${d}" stroke-width="${width}"></path></svg>`;
  };
  const typedGlyph = (ch: string) => `<svg class="pv-glyph" viewBox="0 0 54 54" aria-hidden="true" focusable="false"><text x="27" y="29" font-size="40">${esc(ch)}</text></svg>`;
  const star = (x: number, y: number, s: number) => `M${r1(x)} ${r1(y - s)}Q${r1(x)} ${r1(y)} ${r1(x + s)} ${r1(y)}Q${r1(x)} ${r1(y)} ${r1(x)} ${r1(y + s)}Q${r1(x)} ${r1(y)} ${r1(x - s)} ${r1(y)}Q${r1(x)} ${r1(y)} ${r1(x)} ${r1(y - s)}Z`;
  const sparkCount = [0, 0, 0];
  function paintSvg(layer: Layer) {
    const groups = new Map<number, string>();
    for (const piece of pieces[layer]) {
      const [ax, ay] = piece.a, [bx, by] = piece.b;
      const d = `M${ax} ${ay}L${bx} ${by}`;
      const len = Math.max(1, Math.hypot(bx - ax, by - ay));
      const nx = -(by - ay) / len * W * 0.22, ny = (bx - ax) / len * W * 0.22;
      const brush = `M${r1(ax + nx)} ${r1(ay + ny)}L${r1(bx + nx)} ${r1(by + ny)}M${r1(ax - nx)} ${r1(ay - ny)}L${r1(bx - nx)} ${r1(by - ny)}`;
      let out = `<path class="pv-halo" d="${d}" stroke-width="${W + 7}"></path>`
        + `<path class="pv-shd" d="${d}" stroke-width="${W}" transform="translate(1.3 1.7)"></path>`
        + `<path class="pv-ol" d="${d}" stroke-width="${W + 2.4}"></path>`
        + `<path class="pv-wt" d="${d}" stroke-width="${W}"></path>`
        + `<path class="pv-br" d="${brush}" stroke-dasharray="6 4"></path>`;
      if (piece.g >= 0 && piece.g < CODE_LEN && sparkCount[piece.g] < 4) {
        const k = ++sparkCount[piece.g];
        out += `<path class="pv-spk k${k}" d="${star((ax + bx) / 2 + (k % 2 ? -6 : 6), (ay + by) / 2 - 4, [7, 8.5, 10, 5][k - 1])}"></path>`;
      }
      groups.set(piece.g, (groups.get(piece.g) ?? '') + out);
    }
    let svg = `<svg class="pv-paint" viewBox="-130 -110 860 760" aria-hidden="true" focusable="false">`;
    for (const [g, inner] of groups) svg += `<g class="${g < 0 ? 'pv-g pv-decoy' : 'pv-g'}"${g >= 0 ? ` data-pv-g="${g}"` : ''}>${inner}</g>`;
    if (layer === 'd1') svg += BUD;
    return svg + '</svg>';
  }
  const rip = (g: number) => `<g class="pv-rip" data-pv-rip="${g}" transform="translate(${r1(slots[g].x)} ${r1(slots[g].y)})"><path class="pv-drop" d="M0 -15C4 -7.6 7 -3.2 7 1.6A7 7 0 0 1 -7 1.6C-7 -3.2 -4 -7.6 0 -15Z"></path><circle class="pv-ring r1" r="9"></circle><circle class="pv-ring r2" r="9"></circle><circle class="pv-ring r3" r="9"></circle></g>`;
  const px = (x: number) => r3(6 + (x + 1) / 2 * 88);
  const py = (y: number) => r3(6 + (y - VYMIN) / (1 - VYMIN) * 88);

  body.innerHTML = `
    <div class="pv-body">
      <aside class="pv-side">
        <article class="pz-card pv-clue">
          <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
          <h3>${esc(text.clueTitle)}</h3>
          <div class="pv-glassnote">
            <span class="pv-scrawl">‘${esc(text.pencil)}’</span>
            <svg class="pv-scrawl-u" viewBox="0 0 160 7" preserveAspectRatio="none" aria-hidden="true"><path d="M2 4.2C30 2.6 58 5.8 90 3.6S140 2.2 158 4.8"></path></svg>
          </div>
          <p>${esc(text.clueText)}</p>
          <span class="pz-tag mine">${esc(text.mineTag)}</span>
        </article>
        <article class="pz-card pv-mate">
          <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
          <div class="pv-mate-h"><span class="g-mono rust" aria-hidden="true">${esc(text.partnerMono)}</span><span><b>${esc(text.partnerName)}</b> ${esc(tr('shares a testimony', 'chia sẻ lời khai'))}</span></div>
          <p class="pv-say">${esc(text.partnerSays)} <i>${esc(text.partnerQuote)}</i></p>
          <span class="pz-tag partner">${esc(text.partnerTag)}</span>
        </article>
        <article class="pz-card pv-ctx">
          <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
          <h3>${esc(text.ctxTitle)}</h3>
          <p>${esc(text.ctxText)}</p>
          <span class="pz-tag mine">${esc(text.mineTag)}</span>
        </article>
      </aside>

      <div class="pv-mat">
        <div class="pv-stage">
          <div class="pv-slot">
            <div class="pv-fwrap">
              <div class="pv-frame">
                <span class="pv-flabel" aria-hidden="true">${esc(text.frameLabel)}</span>
                <div class="pv-pane" data-pv="pane" tabindex="0" role="group" aria-roledescription="${esc(tr('picture frame', 'khung tranh'))}" aria-label="${esc(tr('The shelf behind the glass. Drag, or use the arrow keys, to change where you stand; hold Shift for big steps.', 'Kệ đồ sau tủ kính. Kéo, hoặc dùng phím mũi tên, để đổi chỗ đứng; giữ Shift để bước lớn.'))}" aria-describedby="pv-pos">
                  ${LAYERS.map((layer) => `<div class="pv-layer pv-${layer}" data-pv-layer="${layer}">${ART[layer]}</div>`).join('')}
                  ${LAYERS.map((layer) => `<div class="pv-layer pv-${layer}" data-pv-layer="${layer}">${paintSvg(layer)}</div>`).join('')}
                  <svg class="pv-fx" viewBox="0 0 600 540" aria-hidden="true" focusable="false">${slots.map((_, g) => rip(g)).join('')}</svg>
                  ${GRAIN}
                  <div class="pv-vig" aria-hidden="true"></div>
                  <div class="pv-door" aria-hidden="true">${DOOR.replace('__PENCIL__', esc(text.pencil))}</div>
                  <span class="s-sr" id="pv-pos" data-pv="pos"></span>
                </div>
              </div>
              <div class="pv-cap">
                <span class="pv-k">${esc(tr('DRAG ON THE PICTURE TO CHANGE WHERE YOU STAND', 'KÉO TRÊN TRANH ĐỂ ĐỔI CHỖ ĐỨNG'))}</span>
                <span class="pv-kb" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>Shift</kbd></span>
              </div>
            </div>
          </div>
        </div>

        <div class="pv-panel">
          <section class="pv-card2 s-paper" aria-labelledby="pv-code-t">
            <div class="pv-codeh"><span class="pv-k" id="pv-code-t">${esc(tr('CABINET CODE', 'MÃ TỦ KÍNH'))}</span><span class="pv-k pv-miss" data-pv="miss"></span></div>
            <div class="pv-cells" data-pv="cells">
              ${Array.from({ length: CODE_LEN }, (_, i) => `<span class="pv-cell" data-pv-cell="${i}"><span data-pv-cg></span><span class="pv-wch" data-pv-wch aria-hidden="true"></span><i class="pv-caret" aria-hidden="true"></i><b class="pv-cring" aria-hidden="true"></b><em class="pv-cn" aria-hidden="true">${i + 1}</em></span>`).join('')}
              <input class="pv-input" data-pv="input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">
            </div>
            <div class="pv-codefoot"><button type="button" class="pv-back" data-pv="back">${esc(tr('⌫ Erase', '⌫ Xóa ô'))}</button></div>
            <p class="pv-note">${esc(tr('Type the characters, or tap a character you have found below.', 'Gõ ký tự bằng bàn phím, hoặc chạm vào ký tự đã thấy bên dưới.'))}</p>
            <div class="pv-k" style="margin-top: 12px" id="pv-found-t">${esc(tr('FOUND ON THE SHELF', 'ĐÃ THẤY TRÊN KỆ'))}</div>
            <div class="pv-chips" role="group" aria-labelledby="pv-found-t">
              ${slots.map((s, g) => `<button type="button" class="pv-chip" data-pv-chip="${g}">${glyphOf(g)}<span class="pv-chip-q" aria-hidden="true">?</span><span class="pv-chip-l">${esc(s.short.toUpperCase())}</span></button>`).join('')}
            </div>
          </section>

          <section class="pv-card2" aria-labelledby="pv-view-t">
            <span class="pv-k" id="pv-view-t">${esc(tr('WHERE YOU STAND', 'CHỖ ĐỨNG CỦA BẠN'))}</span>
            <div class="pv-viewrow">
              <div class="pv-pad" aria-hidden="true">
                <svg viewBox="0 0 112 112" preserveAspectRatio="none"><path class="pv-pad-grid" d="M31.4 0V112M80.6 0V112M0 66.7H112M0 94.9H112"></path><path class="pv-pad-ax" d="M56 0V112M0 38.4H112"></path></svg>
                <span class="pv-pad-t" style="left: 50%; top: 5px; transform: translateX(-50%)">${esc(tr('HIGH', 'CAO'))}</span>
                <span class="pv-pad-t" style="left: 50%; bottom: 5px; transform: translateX(-50%)">${esc(tr('LOW', 'THẤP'))}</span>
                <span class="pv-pad-t" style="left: 5px; top: 50%; transform: translateY(-50%) rotate(-90deg); transform-origin: 0 50%; margin-left: 5px">${esc(tr('LEFT', 'TRÁI'))}</span>
                <span class="pv-pad-t" style="right: 5px; top: 50%; transform: translateY(-50%) rotate(90deg); transform-origin: 100% 50%; margin-right: 5px">${esc(tr('RIGHT', 'PHẢI'))}</span>
                ${views.map((v, g) => `<span class="pv-mark" data-pv-mark="${g}" style="left: ${px(v.x)}%; top: ${py(v.y)}%">${glyphOf(g, 'pv-markg', 12)}</span>`).join('')}
                <span class="pv-eye" data-pv="eye"></span>
              </div>
              <div class="pv-dpad" role="group" aria-label="${esc(tr('Change where you stand', 'Đổi chỗ đứng'))}">
                <button type="button" class="pv-dbtn up" data-pv-step="0,-0.1" aria-label="${esc(tr('Stand taller', 'Đứng cao lên'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"></path></svg></button>
                <button type="button" class="pv-dbtn lf" data-pv-step="-0.1,0" aria-label="${esc(tr('Step left', 'Bước sang trái'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"></path></svg></button>
                <button type="button" class="pv-dbtn ct" data-pv-step="mid" aria-label="${esc(tr('Back to the middle of the room', 'Về chỗ đứng giữa phòng'))}">${esc(tr('MID', 'GIỮA'))}</button>
                <button type="button" class="pv-dbtn rt" data-pv-step="0.1,0" aria-label="${esc(tr('Step right', 'Bước sang phải'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></button>
                <button type="button" class="pv-dbtn dn" data-pv-step="0,0.1" aria-label="${esc(tr('Crouch lower', 'Ngồi thấp xuống'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"></path></svg></button>
              </div>
            </div>
          </section>
          <div class="pv-acts"><button type="button" class="s-btn s-btn-gold s-btn-sm" data-pv="reset">${esc(tr('Start over', 'Làm lại'))}</button></div>
        </div>
      </div>
    </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(name: string) => body.querySelector<T>(`[data-pv="${name}"]`)!;
  const el = { pane: $('pane'), pos: $('pos'), miss: $('miss'), cells: $('cells'), input: $<HTMLInputElement>('input'), back: $<HTMLButtonElement>('back'), eye: $('eye'), reset: $<HTMLButtonElement>('reset') };
  // every layer is drawn twice: its ink first (all four), then its paint above all ink, moving together
  const layerEls = [...body.querySelectorAll<HTMLElement>('[data-pv-layer]')].map((node) => [node.dataset.pvLayer as Layer, node] as const);
  const groupEls = [...body.querySelectorAll<SVGGElement>('[data-pv-g]')];
  const ripEls = [...body.querySelectorAll<SVGGElement>('[data-pv-rip]')];
  const cellEls = [...body.querySelectorAll<HTMLElement>('[data-pv-cell]')];
  const chipEls = [...body.querySelectorAll<HTMLButtonElement>('[data-pv-chip]')];
  const markEls = [...body.querySelectorAll<HTMLElement>('[data-pv-mark]')];
  const stepEls = [...body.querySelectorAll<HTMLButtonElement>('[data-pv-step]')];
  const budEl = body.querySelector<SVGGElement>('[data-pv="bud"]');
  const veil = (body.closest('[data-pzh-kind]') as HTMLElement | null) ?? body;

  // ----- state (the mockup's, with the code checked on the server) -----
  const base = () => ({
    vx: 0, vy: 0, snapG: -1, ease: false, drag: false, found: [false, false, false], rip: -1, ripN: 0,
    cells: [] as Entry[], land: 0, wch: null as Entry | null, wk: 0, miss: 0, msg: 'intro', arg: { n: 0, g: -1, c: '' },
    phase: 'play' as Phase, stat: false, lockUntil: 0, errText: '',
  });
  type State = ReturnType<typeof base>;
  let s: State = base();
  const timers = new Map<string, number>();
  let raf = 0;
  let pend: [number, number] | null = null;
  let drag: { id: number; x0: number; y0: number; vx: number; vy: number; k: number } | null = null;
  let dead = false;
  let lastStatus = '';

  const later = (k: string, ms: number, fn: () => void) => {
    clearTimeout(timers.get(k));
    timers.set(k, window.setTimeout(() => { timers.delete(k); if (!dead) fn(); }, ms));
  };
  const clearTimers = () => { timers.forEach((t) => clearTimeout(t)); timers.clear(); };
  const cancelRaf = () => { if (raf) cancelAnimationFrame(raf); raf = 0; pend = null; };
  const set = (patch: Partial<State>) => { s = { ...s, ...patch }; paint(); };
  const P = () => PHASE_N[s.phase];
  const locked = () => P() > 0;
  const dist = (x: number, y: number, g: number) => Math.hypot(x - views[g].x, y - views[g].y);
  const jammed = () => s.lockUntil > Date.now();
  const typing = () => s.phase === 'play' && s.cells.length < CODE_LEN && !jammed();

  /* move the viewpoint; snaps magnetically onto a stroke group's viewpoint */
  function commit(x: number, y: number, how: 'key' | 'drag') {
    if (locked()) return;
    const cl = (v: number, lo: number) => Math.max(lo, Math.min(1, Math.round(v * 1000) / 1000));
    x = cl(x, -1);
    y = cl(y, VYMIN);
    let vx = x, vy = y, snapG = -1;
    for (let g = 0; g < CODE_LEN; g++) {
      if (how === 'key' && s.snapG === g) continue; // a key press away from the spot you are locked on must be able to leave it
      if (dist(x, y, g) <= SNAP) { vx = views[g].x; vy = views[g].y; snapG = g; break; }
    }
    const found = s.found.slice();
    const patch: Partial<State> = { vx, vy, snapG, ease: how === 'key' || snapG !== s.snapG };
    if (snapG >= 0 && !found[snapG]) {
      found[snapG] = true;
      patch.found = found;
      patch.rip = snapG;
      patch.ripN = s.ripN + 1;
      patch.msg = found.every(Boolean) ? 'all' : 'found';
      patch.arg = { n: 0, g: snapG, c: '' };
      later('rip', 2100, () => set({ rip: -1 }));
    } else if (snapG < 0) {
      let best = -1, bd = 9;
      for (let g = 0; g < CODE_LEN; g++) {
        if (found[g]) continue;
        const d = dist(vx, vy, g);
        if (d < GLIM && d < bd) { best = g; bd = d; }
      }
      if (best >= 0) { patch.msg = 'glim'; patch.arg = { n: 0, g: best, c: '' }; }
      else if (s.msg === 'glim') patch.msg = 'seek';
    }
    set(patch);
  }
  const step = (dx: number, dy: number) => commit(s.vx + dx, s.vy + dy, 'key');

  function queue(x: number, y: number) {
    pend = [x, y];
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const q = pend;
      pend = null;
      if (!q || dead || locked()) return;
      commit(q[0], q[1], 'drag');
    });
  }
  function onDown(e: PointerEvent) {
    if (locked() || (typeof e.button === 'number' && e.button !== 0)) return;
    try { el.pane.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const r = el.pane.getBoundingClientRect();
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, vx: s.vx, vy: s.vy, k: (r.width || 600) / 600 };
    set({ drag: true, ease: false });
  }
  function onMove(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.id || locked()) return;
    // the viewpoint follows the finger: drag left = step left, drag down = sit lower
    queue(d.vx + (e.clientX - d.x0) / d.k / 200, d.vy + (e.clientY - d.y0) / d.k / 160);
  }
  function onUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    try { if (el.pane.hasPointerCapture(e.pointerId)) el.pane.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = null;
    const q = pend;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    pend = null;
    if (q && !locked()) commit(q[0], q[1], 'drag');
    set({ drag: false });
  }

  // ----- the code cells -----
  const label = (entry: Entry | null) => (entry?.slot != null ? slots[entry.slot].short : entry?.ch ?? '');
  function enter(entry: Entry) {
    if (!typing()) {
      if (jammed()) set({ msg: 'jam' });
      return;
    }
    const cells = s.cells.concat([entry]);
    set({ cells, wch: null, wk: 0, msg: 'typed', arg: { n: cells.length, g: entry.slot ?? -1, c: label(entry) } });
    if (cells.length === CODE_LEN) check(cells);
  }
  function typeChar(raw: string) {
    const ch = String(raw || '').toUpperCase();
    if (ch.length !== 1 || !/[\p{L}\p{N}]/u.test(ch)) return;
    enter({ ch });
  }
  function erase() {
    if (s.phase !== 'play' || !s.cells.length) return;
    set({ cells: s.cells.slice(0, -1), msg: 'erased' });
  }
  function check(cells: Entry[]) {
    set({ phase: 'check', msg: 'checking' });
    const code = cells.map((c) => (c.slot != null ? `@${slots[c.slot].id}` : c.ch ?? ''));
    ctx.submit({ code }).then((result) => {
      if (dead) return;
      if (result.solved) { opened(); return; }
      const fb = result.feedback ?? {};
      const now = Date.now();
      if (fb.locked) {
        set({ phase: 'play', cells: cells.slice(0, -1), msg: 'jam', lockUntil: now + fin(fb.wait, 5) * 1000 });
        tick();
        return;
      }
      if (Number.isInteger(fb.firstWrong)) {
        const i = Math.max(0, Math.min(CODE_LEN - 1, fb.firstWrong));
        set({ phase: 'play', cells: cells.slice(0, i), wch: cells[i], wk: s.wk === 1 ? 2 : 1, miss: typeof fb.wrong === 'number' ? fb.wrong : s.miss + 1,
          msg: 'wrong', arg: { n: i + 1, g: cells[i].slot ?? -1, c: label(cells[i]) }, lockUntil: fb.wait ? now + fin(fb.wait, 0) * 1000 : 0 });
        if (fb.wait) tick();
        return;
      }
      set({ phase: 'play', cells: cells.slice(0, -1), msg: 'error', errText: result.message || '' });
    }).catch((error: any) => {
      if (!dead) set({ phase: 'play', cells: cells.slice(0, -1), msg: 'error', errText: error?.message || tr('Could not reach the server — try again.', 'Không gửi được mã — thử lại.') });
    });
  }
  /** Repaints the jam countdown every second, then frees the lock. */
  function tick() {
    if (!jammed()) { if (s.msg === 'jam' || s.msg === 'wrong') set({ msg: s.msg === 'jam' ? 'free' : s.msg }); return; }
    paint();
    later('jam', 1000, tick);
  }
  function opened() {
    const land = s.land === 1 ? 2 : 1;
    if (rm()) {
      drag = null;
      set({ land, phase: 'won', msg: 'won', ease: false, drag: false, vx: REST.x, vy: REST.y, snapG: -1, found: [true, true, true] });
      return;
    }
    drag = null;
    set({ land, phase: 'unlock', msg: 'opening', drag: false, found: [true, true, true] });
    // the door swings while the view settles back into the armchair
    later('open', 750, () => set({ phase: 'open', vx: REST.x, vy: REST.y, snapG: -1, ease: false }));
    later('bloom', 2250, () => set({ phase: 'bloom' }));
    later('won', 4700, () => set({ phase: 'won', msg: 'won' }));
  }
  function reset() {
    if (P() > 0 || s.phase === 'check') return;
    clearTimers();
    cancelRaf();
    drag = null;
    set({ ...base(), miss: s.miss, lockUntil: s.lockUntil });
    if (jammed()) tick();
  }

  // ----- input -----
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]') && target !== el.input) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      if (locked()) return;
      e.preventDefault();
      const st = e.shiftKey ? 0.2 : 0.05;
      step(k === 'ArrowLeft' ? -st : (k === 'ArrowRight' ? st : 0), k === 'ArrowUp' ? -st : (k === 'ArrowDown' ? st : 0));
      return;
    }
    if (k === 'Backspace' || k === 'Delete') { e.preventDefault(); erase(); return; }
    if (target?.closest('button') && (k === 'Enter' || k === ' ')) return;
    if (k && k.length === 1 && k.trim() && !e.repeat) {
      e.preventDefault();
      typeChar(k);
    }
  }
  function onInput() {
    const v = el.input.value || '';
    el.input.value = '';
    if (v) typeChar(v.slice(-1));
  }
  function onClick(e: Event) {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLButtonElement>('[data-pv-chip]');
    if (chip) { if (!chip.disabled) enter({ slot: Number(chip.dataset.pvChip) }); return; }
    const stepBtn = t.closest<HTMLButtonElement>('[data-pv-step]');
    if (stepBtn) {
      if (stepBtn.disabled) return;
      const v = stepBtn.dataset.pvStep!;
      if (v === 'mid') { commit(0, 0, 'key'); if (!locked()) set({ msg: 'center' }); return; }
      const [dx, dy] = v.split(',').map(Number);
      step(dx, dy);
      return;
    }
    if (t.closest('[data-pv="back"]')) { erase(); return; }
    if (t.closest('[data-pv="reset"]')) reset();
  }

  // ----- view -----
  const put = (node: Element | null | undefined, prop: string, value: string) => {
    if (!node) return;
    if (prop === 'class') { if (node.getAttribute('class') !== value) node.setAttribute('class', value); return; }
    if (prop === 'text') { if (node.textContent !== value) node.textContent = value; return; }
    if (prop === 'html') { if ((node as HTMLElement).dataset.pvHtml !== value) { (node as HTMLElement).dataset.pvHtml = value; node.innerHTML = value; } return; }
    if (prop.startsWith('@')) { if (node.getAttribute(prop.slice(1)) !== value) node.setAttribute(prop.slice(1), value); return; }
    const style = (node as HTMLElement).style;
    if (style.getPropertyValue(prop) !== value) style.setProperty(prop, value);
  };

  function message(): string {
    const name = s.arg.g >= 0 ? slots[s.arg.g].name : '';
    switch (s.msg) {
      case 'intro': return tr('The white paint marks are scattered over the shelf. Change where you stand to find the angle where they join.', 'Những vệt sơn trắng nằm rời rạc trên kệ. Đổi chỗ đứng để tìm góc chúng nối liền.');
      case 'seek': return tr('The marks fall apart again. Move slowly — far marks drift a little, near ones a lot.', 'Vệt sơn lại rời ra. Đổi chỗ đứng chậm thôi — ở xa trôi ít, ở gần trôi nhiều.');
      case 'glim': return tr(`The paint on the ${name} starts to glint — almost there.`, `Vệt sơn ở ${name} bắt đầu lấp lánh — sắp đúng góc.`);
      case 'found': return tr(`Right angle! The marks on the ${name} join into a character.`, `Đúng góc! Các vệt ở ${name} ghép thành một ký tự.`);
      case 'all': return tr('All three characters found. Enter them in the right order.', 'Đã thấy đủ ba ký tự. Ghi chúng vào ô mã theo đúng thứ tự.');
      case 'center': return tr('Back to the middle of the room.', 'Về chỗ đứng giữa phòng.');
      case 'typed': return s.cells.length < CODE_LEN ? tr(`Cell ${s.arg.n}: ‘${s.arg.c}’.`, `Ô ${s.arg.n}: ‘${s.arg.c}’.`) : tr('Trying the code…', 'Đang thử mã…');
      case 'erased': return tr('Cell erased.', 'Đã xóa một ô.');
      case 'checking': return tr('Trying the code…', 'Đang thử mã…');
      case 'wrong': return tr(`‘${s.arg.c}’ does not fit cell ${s.arg.n} — the ink runs off.`, `‘${s.arg.c}’ không khớp ô thứ ${s.arg.n} — mực trôi mất.`)
        + (jammed() ? ' ' + tr(`The lock jams for ${Math.ceil((s.lockUntil - Date.now()) / 1000)} s.`, `Ổ khóa kẹt ${Math.ceil((s.lockUntil - Date.now()) / 1000)} giây.`) : '');
      case 'jam': return jammed() ? tr(`The lock is jammed — try again in ${Math.ceil((s.lockUntil - Date.now()) / 1000)} s.`, `Ổ khóa đang kẹt — thử lại sau ${Math.ceil((s.lockUntil - Date.now()) / 1000)} giây.`) : tr('The lock turns freely again.', 'Ổ khóa đã hết kẹt.');
      case 'free': return tr('The lock turns freely again.', 'Ổ khóa đã hết kẹt.');
      case 'error': return s.errText || tr('Try again.', 'Thử lại.');
      case 'opening': return tr('The code fits. The lock of the glass cabinet turns…', 'Mã khớp. Khóa tủ kính xoay…');
      case 'won': return tr('The glass cabinet is open. The code has been added to the case file.', 'Tủ kính đã mở. Mã đã được ghi vào hồ sơ.');
      default: return '';
    }
  }

  function paint() {
    const p4 = P();
    const lt = (f: number) => `translate3d(${r3(-s.vx * AX * f / 8.6)}%, ${r3(-s.vy * AY * f / 7.6)}%, 0)`;
    body.classList.toggle('pv-rm', ctx.reducedMotion);
    layerEls.forEach(([layer, node]) => put(node, 'transform', lt(F[layer])));
    put(el.pane, 'class', 'pv-pane' + (s.ease ? ' is-ease' : '') + (s.drag ? ' is-drag' : '') + (p4 >= 2 && !s.stat && !rm() ? ' is-glide' : '')
      + (p4 >= 1 ? ' is-unlock' : '') + (p4 >= 2 ? ' is-open' : '') + (p4 >= 3 ? ' is-bloom' : '') + (s.stat || rm() ? ' is-static' : ''));
    groupEls.forEach((node) => {
      const g = Number(node.dataset.pvG);
      let c = 'pv-g';
      if (s.found[g]) c += ' is-red';
      else {
        const d = dist(s.vx, s.vy, g);
        c += d < GLIM * 0.58 ? ' glim-3' : (d < GLIM ? ' glim-2' : (d < GLIM * 1.42 ? ' glim-1' : ''));
      }
      put(node, 'class', c);
    });
    ripEls.forEach((node) => put(node, 'class', 'pv-rip' + (s.rip === Number(node.dataset.pvRip) && !rm() ? ' is-go' : '')));
    if (budEl) put(budEl, 'class', 'pv-budg' + (p4 >= 3 || (p4 >= 2 && rm()) ? ' is-bloom' : ''));

    // the code
    const n = s.cells.length;
    const canType = typing();
    cellEls.forEach((cell, i) => {
      const entry = s.cells[i];
      const full = !!entry;
      const act = n === i && s.phase === 'play' && !jammed();
      put(cell, 'class', 'pv-cell' + (full ? ' is-full' : '') + (act ? ' is-act' : '') + (full && p4 >= 1 && i === CODE_LEN - 1 && s.land ? (s.land === 1 ? ' ld-a' : ' ld-b') : ''));
      put(cell.querySelector('[data-pv-cg]'), 'html', entry ? (entry.slot != null ? glyphOf(entry.slot) : typedGlyph(entry.ch ?? '')) : '');
      const wobble = n === i && s.phase === 'play' && s.wk && s.wch;
      put(cell.querySelector('[data-pv-wch]'), 'class', 'pv-wch' + (wobble ? (s.wk === 1 ? ' w-a' : ' w-b') : ''));
      put(cell.querySelector('[data-pv-wch]'), 'html', wobble ? (s.wch!.slot != null ? glyphOf(s.wch!.slot, 'pv-glyph') : esc(s.wch!.ch ?? '')) : '');
    });
    put(el.cells, 'class', 'pv-cells' + (canType ? '' : ' is-off') + (s.phase === 'check' ? ' is-busy' : ''));
    el.input.disabled = !canType;
    put(el.input, '@aria-label', n < CODE_LEN ? tr(`Cabinet code — type the character for cell ${n + 1} of ${CODE_LEN}`, `Ô mã tủ kính — gõ ký tự cho ô thứ ${n + 1} trên ${CODE_LEN}`) : tr('Cabinet code — all cells filled', 'Ô mã tủ kính — đã đủ 3 ký tự'));
    el.back.disabled = s.phase !== 'play' || n === 0;
    put(el.miss, 'text', s.miss ? `${tr('WRONG', 'SAI')}: ${s.miss}` : '');
    chipEls.forEach((chip) => {
      const g = Number(chip.dataset.pvChip);
      put(chip, 'class', 'pv-chip' + (s.found[g] ? ' is-found' : ''));
      chip.disabled = !s.found[g] || !canType;
      put(chip, '@aria-label', s.found[g] ? tr(`The character on the ${slots[g].name} — tap to enter it`, `Ký tự trên ${slots[g].name} — chạm để ghi vào ô mã`) : tr(`${slots[g].name} — no character seen yet`, `${slots[g].name.charAt(0).toUpperCase()}${slots[g].name.slice(1)} — chưa thấy ký tự`));
    });

    // where you stand
    markEls.forEach((mark) => put(mark, 'class', 'pv-mark' + (s.found[Number(mark.dataset.pvMark)] ? ' is-on' : '')));
    put(el.eye, 'class', 'pv-eye' + (s.drag ? ' is-drag' : ''));
    put(el.eye, 'left', `${px(s.vx)}%`);
    put(el.eye, 'top', `${py(s.vy)}%`);
    stepEls.forEach((b) => { b.disabled = p4 > 0; });
    el.reset.disabled = p4 > 0 || s.phase === 'check' || (s.found.every((f) => !f) && n === 0 && s.vx === 0 && s.vy === 0);
    const h = s.vx < -0.6 ? tr('far to the left', 'lệch trái nhiều') : (s.vx < -0.2 ? tr('a little to the left', 'hơi lệch trái') : (s.vx <= 0.2 ? tr('in the middle', 'chính giữa') : (s.vx <= 0.6 ? tr('a little to the right', 'hơi lệch phải') : tr('far to the right', 'lệch phải nhiều'))));
    const v = s.vy < -0.2 ? tr('standing tall, looking down', 'đứng thẳng, nhìn từ trên xuống') : (s.vy <= 0.2 ? tr('at eye level', 'ngang tầm mắt') : (s.vy <= 0.6 ? tr('crouching a little', 'hơi khom xuống') : tr('sitting low', 'ngồi thấp')));
    put(el.pos, 'text', tr(`Where you stand: ${h}, ${v}.`, `Chỗ đứng: ${h}, ${v}.`));

    const nf = s.found.filter(Boolean).length;
    const tone = s.msg === 'wrong' || s.msg === 'jam' || s.msg === 'error' ? 'bad' : (s.msg === 'found' || s.msg === 'all' || s.msg === 'opening' || s.msg === 'won' ? 'ok' : 'info');
    const status = `${tr(`FOUND ${nf}/3 · CODE ${n}/3`, `ĐÃ THẤY ${nf}/3 · ĐÃ GHI ${n}/3`)} — ${message()}`;
    if (status !== lastStatus) { lastStatus = status; ctx.setStatus(status, tone); }
  }

  el.pane.addEventListener('pointerdown', onDown);
  el.pane.addEventListener('pointermove', onMove);
  el.pane.addEventListener('pointerup', onUp);
  el.pane.addEventListener('pointercancel', onUp);
  el.input.addEventListener('input', onInput);
  body.addEventListener('click', onClick);
  veil.addEventListener('keydown', onKey);

  if (ctx.solved) s = { ...s, vx: REST.x, vy: REST.y, found: [true, true, true], phase: 'won', msg: 'won', stat: true };
  paint();

  return {
    update(next) {
      ctx = next;
      if (next.solved && s.phase === 'play') {
        clearTimers();
        cancelRaf();
        drag = null;
        set({ vx: REST.x, vy: REST.y, snapG: -1, found: [true, true, true], phase: 'won', msg: 'won', stat: true, drag: false });
        return;
      }
      paint();
    },
    unmount() {
      dead = true;
      clearTimers();
      cancelRaf();
      drag = null;
      el.pane.removeEventListener('pointerdown', onDown);
      el.pane.removeEventListener('pointermove', onMove);
      el.pane.removeEventListener('pointerup', onUp);
      el.pane.removeEventListener('pointercancel', onUp);
      el.input.removeEventListener('input', onInput);
      body.removeEventListener('click', onClick);
      veil.removeEventListener('keydown', onKey);
      body.innerHTML = '';
      body.classList.remove('pv-rm');
    },
  };
}

const parallaxCode: PuzzleKindModule = {
  kind: 'parallax_code',
  label: { en: 'Right angle', vi: 'Góc nhìn' },
  mount,
};

export default parallaxCode;
