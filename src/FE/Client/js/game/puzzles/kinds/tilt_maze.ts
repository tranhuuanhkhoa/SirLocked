/**
 * P9 · Hộp mê cung nghiêng — port of design/project/PuzzleTiltMaze.dc.html.
 * An ice-slide maze in a 3D box: each tilt rolls the ball until a wall, the rim or the closed gate; holes
 * send it back to the start (the lever springs back, the gate shuts), the lever toggles the gate every
 * time the ball rolls over it and the brass socket catches the ball.
 *
 * Driven only by ctx.params ({ size, start, socket, lever, holes, gate, walls, optimal } + optional card
 * text). The board plays locally for instant feedback; when the ball drops into the socket the tilts
 * since the last return to the start are sent as { moves } and the server replays them (TiltMazeKind).
 */
import './tilt_maze.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule } from '../types';

type Dir = 'U' | 'D' | 'L' | 'R';
type Cell = [number, number];
type Edge = [number, number, number, number];

interface Level {
  n: number;
  start: Cell;
  sock: Cell;
  lever: Cell;
  holes: Cell[];
  gate: Edge;
  walls: Edge[];
}

const DIR: Record<Dir, Cell> = { U: [-1, 0], D: [1, 0], L: [0, -1], R: [0, 1] };

/** The mockup's level (used only when the params are unusable). */
const MOCKUP: Level = {
  n: 7, start: [6, 0], sock: [3, 3], lever: [1, 1], holes: [[3, 5], [4, 2], [6, 4]], gate: [3, 3, 4, 3],
  walls: [[0, 5, 1, 5], [1, 4, 1, 5], [1, 4, 2, 4], [1, 5, 2, 5], [2, 0, 2, 1], [2, 2, 2, 3], [2, 2, 3, 2], [2, 3, 3, 3], [2, 6, 3, 6],
    [3, 2, 3, 3], [3, 3, 3, 4], [4, 1, 4, 2], [4, 0, 5, 0], [4, 5, 5, 5], [5, 1, 5, 2], [5, 4, 5, 5], [6, 3, 6, 4]],
};

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const r2 = (v: number) => Math.round(v * 100) / 100;
const alt = (n: number, a: string, b: string) => (n ? (n % 2 ? a : b) : '');
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function readLevel(p: any): Level {
  const cell = (v: any): Cell | null => (Array.isArray(v) && v.length === 2 && v.every(isInt) ? [v[0], v[1]] : null);
  const edge = (v: any): Edge | null => (Array.isArray(v) && v.length === 4 && v.every(isInt) ? [v[0], v[1], v[2], v[3]] : null);
  const n = isInt(p?.size) && p.size >= 4 && p.size <= 9 ? p.size : 7;
  const start = cell(p?.start), sock = cell(p?.socket), lever = cell(p?.lever), gate = edge(p?.gate);
  const holes = Array.isArray(p?.holes) ? p.holes.map(cell) : null;
  const walls = Array.isArray(p?.walls) ? p.walls.map(edge) : null;
  if (!start || !sock || !lever || !gate || !holes || !walls || holes.some((h: Cell | null) => !h) || walls.some((w: Edge | null) => !w)) return MOCKUP;
  return { n, start, sock, lever, gate, holes: holes as Cell[], walls: walls as Edge[] };
}

const key = (r: number, c: number, r2_: number, c2: number) =>
  (r < r2_ || (r === r2_ && c < c2)) ? `${r},${c}|${r2_},${c2}` : `${r2_},${c2}|${r},${c}`;

interface SlideResult { kind: 'stop' | 'hole' | 'win'; r: number; c: number; gate: boolean; path: Cell[]; levers: number[]; stop: string; hole?: number }

/* time fraction at which the eased roll (cubic-bezier(.42,.02,.62,1)) reaches progress f */
function timeAt(f: number) {
  const bz = (t: number, a: number, b: number) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (bz(m, 0.02, 1) < f) lo = m; else hi = m; }
  return bz((lo + hi) / 2, 0.42, 0.62);
}

function mount(body: HTMLElement, ctx0: PuzzleContext): PuzzleKindHandle {
  let ctx = ctx0;
  const tr = ctx.tr;
  const p = ctx.params ?? {};
  const L = readLevel(p);
  const N = L.n;
  const WALL = new Set(L.walls.map((w) => key(w[0], w[1], w[2], w[3])));
  const GATE = key(L.gate[0], L.gate[1], L.gate[2], L.gate[3]);
  const at = (q: Cell, r: number, c: number) => q[0] === r && q[1] === c;
  const holeAt = (r: number, c: number) => L.holes.findIndex((h) => at(h, r, c));
  const WORD: Record<Dir, string> = { U: tr('up', 'lên trên'), D: tr('down', 'xuống dưới'), L: tr('left', 'sang trái'), R: tr('right', 'sang phải') };
  const SIDE: Record<Dir, string> = { U: tr('above', 'phía trên'), D: tr('below', 'phía dưới'), L: tr('on the left', 'bên trái'), R: tr('on the right', 'bên phải') };
  const BASE = 40;
  const TILT = 8;
  const rm = () => ctx.reducedMotion;

  // ----- gate geometry: the edge line, and which side is the socket (the flap stands on the line) -----
  const [g1r, g1c, g2r, g2c] = L.gate;
  const horizontal = g1c === g2c; // cells above/below each other → the edge is a horizontal line
  const gateX = horizontal ? g1c + 0.5 : Math.max(g1c, g2c);
  const gateY = horizontal ? Math.max(g1r, g2r) : g1r + 0.5;
  const inner: Cell = at(L.sock, g2r, g2c) ? [g2r, g2c] : [g1r, g1c];
  const outer: Cell = inner[0] === g1r && inner[1] === g1c ? [g2r, g2c] : [g1r, g1c];
  const gateDeg = horizontal ? (inner[0] < outer[0] ? 0 : 180) : (inner[1] < outer[1] ? -90 : 90);
  /* where each hole drops into the glass channel on the front (% of its width) — same fit as the mockup */
  const chanFor = (h: number) => r2(107.3 * (L.holes[h][1] + 0.5) / N - 1.5);
  const u2k = (u: number) => r2(u * N / 7); // mockup tray units → this board's cell units

  // ----- walls → raised strips (collinear neighbours merged, brass around the socket) -----
  function strips() {
    const runs: string[] = [];
    const brass = (w: Edge) => at(L.sock, w[0], w[1]) || at(L.sock, w[2], w[3]);
    const groups = new Map<string, { line: number; from: number; vertical: boolean; brass: boolean }[]>();
    for (const w of L.walls) {
      const vertical = w[0] === w[2]; // same row → wall between two columns
      const line = vertical ? Math.max(w[1], w[3]) : Math.max(w[0], w[2]);
      const from = vertical ? w[0] : w[1];
      const k = `${vertical ? 'v' : 'h'}${line}${brass(w) ? 'b' : ''}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push({ line, from, vertical, brass: brass(w) });
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.from - b.from);
      let i = 0;
      while (i < list.length) {
        let j = i;
        while (j + 1 < list.length && list[j + 1].from === list[j].from + 1) j++;
        const { line, vertical, brass: isBrass } = list[i];
        const a = Math.max(0, list[i].from - 0.08);
        const b = Math.min(N, list[j].from + 1 + 0.08);
        const len = r2(b - a);
        const across = r2(line - 0.08);
        const style = vertical
          ? `left: calc(var(--k) * ${across}); top: calc(var(--k) * ${r2(a)}); width: calc(var(--k) * 0.16); height: calc(var(--k) * ${len})`
          : `left: calc(var(--k) * ${r2(a)}); top: calc(var(--k) * ${across}); width: calc(var(--k) * ${len}); height: calc(var(--k) * 0.16)`;
        runs.push(`<div class="tm-strip${isBrass ? ' is-brass' : ''}${vertical ? ' is-v' : ''}" style="${style}"><i class="tm-st-w"></i><i class="tm-st-e"></i><i class="tm-st-s"></i><i class="tm-st-t"></i></div>`);
        i = j + 1;
      }
    }
    return runs.join('');
  }

  function floorPaint() {
    const w = 700 / N;
    const fills = ['#d9b787', '#d0aa78', '#dab98a', '#cea773', '#d6b281', '#d1ab7a', '#d8b585', '#d3ae7d', '#d7b383'];
    let planks = '';
    for (let i = 0; i < N; i++) planks += `<rect x="${r2(i * w)}" y="0" width="${r2(w + 0.5)}" height="700" fill="${fills[i % fills.length]}"></rect>`;
    const cols = Array.from({ length: N - 1 }, (_, i) => `M${r2((i + 1) * w)} 0 V700`).join(' ');
    const rows = Array.from({ length: N - 1 }, (_, i) => `M0 ${r2((i + 1) * w)} H700`).join(' ');
    return `<svg class="tm-paint" viewBox="0 0 700 700" preserveAspectRatio="none" aria-hidden="true">
      <defs><radialGradient id="tm-g-vig" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#2a1608" stop-opacity="0"></stop><stop offset="1" stop-color="#2a1608" stop-opacity=".5"></stop></radialGradient></defs>
      ${planks}
      <path d="M18 0 C24 120 14 250 22 380 S16 600 24 700 M62 0 C57 140 69 270 60 410 S66 590 58 700 M126 0 C132 150 120 300 130 450 S122 620 128 700 M171 0 C166 120 178 260 168 420 S175 600 170 700 M232 0 C238 160 226 280 236 430 S228 610 234 700 M276 0 C270 130 282 300 272 440 S280 620 274 700 M330 0 C336 140 324 290 334 440 S326 600 332 700 M372 0 C366 150 380 280 370 430 S378 620 371 700 M424 0 C430 120 418 270 428 420 S420 600 426 700 M468 0 C462 140 474 290 464 450 S472 610 466 700 M528 0 C534 150 522 300 532 440 S524 620 530 700 M572 0 C566 130 578 280 568 420 S576 600 570 700 M626 0 C632 140 620 290 630 430 S622 610 628 700 M674 0 C668 150 680 280 670 440 S678 620 672 700" fill="none" stroke="#8a5a2c" stroke-opacity=".16" stroke-width="1.6"></path>
      <path d="${cols}" stroke="#5c3818" stroke-opacity=".28" stroke-width="1.4"></path>
      <path d="M350 350 L870 350 L862 440 Z M350 350 L839 528 L800 610 Z M350 350 L748 684 L684 748 Z M350 350 L610 800 L528 839 Z M350 350 L440 862 L350 870 Z M350 350 L260 862 L172 839 Z M350 350 L90 800 L16 748 Z M350 350 L-48 684 L-100 610 Z M350 350 L-139 528 L-162 440 Z M350 350 L-170 350 L-162 260 Z M350 350 L-139 172 L-100 90 Z M350 350 L-48 16 L16 -48 Z M350 350 L90 -100 L172 -139 Z M350 350 L260 -162 L350 -170 Z M350 350 L440 -162 L528 -139 Z M350 350 L610 -100 L684 -48 Z M350 350 L748 16 L800 90 Z M350 350 L839 172 L862 260 Z" fill="#b04a2c" fill-opacity=".1"></path>
      <circle cx="350" cy="350" r="168" fill="none" stroke="#9e3f2a" stroke-opacity=".38" stroke-width="4" stroke-dasharray="1 11" stroke-linecap="round"></circle>
      <circle cx="350" cy="350" r="186" fill="none" stroke="#2f6363" stroke-opacity=".28" stroke-width="2"></circle>
      <path d="${rows}" stroke="#5c3818" stroke-opacity=".16" stroke-width="1.4" stroke-dasharray="7 6"></path>
      <g fill="#2f6363" fill-opacity=".42">
        <path transform="translate(350 50) scale(1.3)" d="M0.0 -10.0 L2.5 -3.4 L9.5 -3.1 L4.0 1.3 L5.9 8.1 L0.0 4.2 L-5.9 8.1 L-4.0 1.3 L-9.5 -3.1 L-2.5 -3.4 Z"></path>
        <path transform="translate(650 550) scale(1.1)" d="M0.0 -10.0 L2.5 -3.4 L9.5 -3.1 L4.0 1.3 L5.9 8.1 L0.0 4.2 L-5.9 8.1 L-4.0 1.3 L-9.5 -3.1 L-2.5 -3.4 Z"></path>
        <path transform="translate(50 250) scale(.9)" d="M0.0 -10.0 L2.5 -3.4 L9.5 -3.1 L4.0 1.3 L5.9 8.1 L0.0 4.2 L-5.9 8.1 L-4.0 1.3 L-9.5 -3.1 L-2.5 -3.4 Z"></path>
      </g>
      <g fill="#b0802c" fill-opacity=".5">
        <path transform="translate(450 150) scale(.8)" d="M0.0 -10.0 L2.5 -3.4 L9.5 -3.1 L4.0 1.3 L5.9 8.1 L0.0 4.2 L-5.9 8.1 L-4.0 1.3 L-9.5 -3.1 L-2.5 -3.4 Z"></path>
        <path transform="translate(150 650) scale(.8)" d="M0.0 -10.0 L2.5 -3.4 L9.5 -3.1 L4.0 1.3 L5.9 8.1 L0.0 4.2 L-5.9 8.1 L-4.0 1.3 L-9.5 -3.1 L-2.5 -3.4 Z"></path>
      </g>
      <path d="M664 30 A26 26 0 1 0 676 78 A20 20 0 1 1 664 30 Z" fill="#2f6363" fill-opacity=".38"></path>
      <ellipse cx="560" cy="430" rx="40" ry="16" fill="#fff6e0" fill-opacity=".1"></ellipse>
      <ellipse cx="160" cy="120" rx="34" ry="12" fill="#fff6e0" fill-opacity=".09"></ellipse>
      <ellipse cx="300" cy="610" rx="46" ry="14" fill="#5c3818" fill-opacity=".07"></ellipse>
      <rect x="0" y="0" width="700" height="700" fill="url(#tm-g-vig)"></rect>
    </svg>`;
  }

  const ARROW_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 V5 M10 15 V18.5 M1.5 10 H5 M15 10 H18.5 M4 4 L6.4 6.4 M13.6 13.6 L16 16 M16 4 L13.6 6.4 M6.4 13.6 L4 16"></path></svg>';
  const kpos = (x: number, y: number) => `left: calc(var(--k) * ${r2(x)}); top: calc(var(--k) * ${r2(y)})`;
  const sideName = (q: Cell) => `${tr('row', 'hàng')} ${q[0] + 1}, ${tr('column', 'cột')} ${q[1] + 1}`;
  const gateSide = (() => {
    const d = gateDeg === 0 ? tr('below', 'phía dưới') : gateDeg === 180 ? tr('above', 'phía trên') : gateDeg === 90 ? tr('the left', 'bên trái') : tr('the right', 'bên phải');
    return d;
  })();

  const text = {
    mineTag: p.mineTag || tr('PRIVATE · INVESTIGATOR', 'RIÊNG · ĐIỀU TRA VIÊN'),
    labelTitle: p.labelTitle || tr('Label under the box', 'Nhãn dưới đáy hộp'),
    labelKick: p.labelKick || tr('FADED INK · UNSIGNED', 'MỰC ĐÃ PHAI · KHÔNG KÝ TÊN'),
    labelQuote: p.labelQuote || tr('‘The ball only stops at a wall.’', '‘Bi chỉ dừng khi chạm vách.’'),
    partnerMono: p.partnerMono || 'TV',
    partnerTag: p.partnerTag || tr('SHARED · INTERROGATOR', 'ĐÃ CHIA SẺ · THẨM VẤN VIÊN'),
    partnerQuote: p.partnerQuote || tr('A witness says the box clicks every time the ball rolls over the little brass lever inside — then a small door opens.',
      'Nhân chứng khai: chiếc hộp kêu ‘tách’ mỗi khi bi lăn qua cái cần đồng bên trong — sau đó có tiếng cửa nhỏ mở.'),
    insideTitle: p.insideTitle || tr('Inside the box', 'Bên trong hộp'),
    openText: p.openText || tr('What was inside the box has been added to the case file.', 'Vật trong hộp đã được thêm vào hồ sơ.'),
  };

  body.innerHTML = `
    <aside class="tm-clues" aria-label="${esc(tr('Clues about the box', 'Manh mối về chiếc hộp'))}">
      <svg width="0" height="0" style="position: absolute" aria-hidden="true">
        <symbol id="tm-i-sock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#c7a24b" stroke="#5e4a1c" stroke-width="1.2"></circle><circle cx="12" cy="12" r="5" fill="#140c05"></circle><path d="M12 3.6 V6 M12 18 V20.4 M3.6 12 H6 M18 12 H20.4" stroke="#5e4a1c" stroke-width="1.4"></path></symbol>
        <symbol id="tm-i-lever" viewBox="0 0 24 24"><circle cx="12" cy="14" r="8" fill="#d6b25c" stroke="#5e4a1c" stroke-width="1.2"></circle><path d="M12 14 L17.5 5.5" stroke="#5e4a1c" stroke-width="3.4" stroke-linecap="round"></path><path d="M12 14 L17.5 5.5" stroke="#f6e2a0" stroke-width="1.6" stroke-linecap="round"></path><circle cx="17.8" cy="5" r="2.8" fill="#c0392b" stroke="#6e1a12"></circle><circle cx="12" cy="14" r="1.8" fill="#3a2c10"></circle></symbol>
        <symbol id="tm-i-gate" viewBox="0 0 24 24"><path d="M3 20.5 H21" stroke="#5b5248" stroke-width="1.6"></path><rect x="5" y="8" width="14" height="12" rx="1.5" fill="#d6b25c" stroke="#5e4a1c" stroke-width="1.2"></rect><circle cx="7.8" cy="11" r="1" fill="#3a2c10"></circle><circle cx="16.2" cy="11" r="1" fill="#3a2c10"></circle><path d="M12 12 V17" stroke="#3a2c10" stroke-width="2.2" stroke-linecap="round"></path></symbol>
        <symbol id="tm-i-hole" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#9e3f2a" stroke-width="1.4" stroke-dasharray="1.6 2.2"></circle><circle cx="12" cy="12" r="7" fill="#140c05"></circle><circle cx="12" cy="13" r="4" fill="#000"></circle></symbol>
      </svg>
      <article class="pz-card s-paper tm-card-a">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <span class="pz-tag mine" style="margin-top: 0">${esc(text.mineTag)}</span>
        <h3 style="margin-top: 4px">${esc(text.labelTitle)}</h3>
        <p class="tm-label"><span class="tm-label-k">${esc(text.labelKick)}</span><span class="tm-label-q">${esc(text.labelQuote)}</span></p>
        <svg class="tm-rule" viewBox="0 0 250 56" role="img" aria-label="${esc(tr('Hand drawing under the label: the ball rolls straight across four empty cells and stops against the wall.', 'Hình vẽ tay dưới nhãn: viên bi lăn một mạch qua bốn ô trống rồi dừng sát thanh vách.'))}">
          <rect x="4" y="12" width="236" height="40" rx="3" fill="#ead9b6" stroke="#8a6a3a" stroke-width="1"></rect>
          <path d="M51 12 V52 M98 12 V52 M145 12 V52 M192 12 V52" stroke="#8a6a3a" stroke-opacity=".45" stroke-dasharray="3 3"></path>
          <rect x="234" y="8" width="9" height="48" rx="1.5" fill="#6b4526" stroke="#3f2714"></rect>
          <circle cx="27" cy="32" r="10" fill="none" stroke="#5b5248" stroke-width="1.2" stroke-dasharray="2.4 2.4"></circle>
          <path d="M44 32 H200" stroke="#9e3f2a" stroke-width="1.8" stroke-dasharray="6 4"></path>
          <path d="M196 26.5 L206 32 L196 37.5" fill="none" stroke="#9e3f2a" stroke-width="1.8" stroke-linejoin="round"></path>
          <circle cx="221" cy="32" r="10.5" fill="#9aa5ac" stroke="#2b3238" stroke-width="1.2"></circle><circle cx="217.5" cy="28.5" r="3" fill="#fff" opacity=".85"></circle>
          <text x="27" y="8" text-anchor="middle" style="font-family: 'Source Code Pro', monospace; font-size: 10px; font-weight: 700; letter-spacing: .12em; fill: #5b5248">${esc(tr('ROLL', 'LĂN'))}</text>
          <text x="214" y="8" text-anchor="middle" style="font-family: 'Source Code Pro', monospace; font-size: 10px; font-weight: 700; letter-spacing: .12em; fill: #9e3f2a">${esc(tr('STOP', 'DỪNG'))}</text>
        </svg>
      </article>
      <article class="pz-card s-paper tm-card-b">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="tm-from"><span class="g-mono rust" aria-hidden="true">${esc(text.partnerMono)}</span><span class="pz-tag partner" style="margin-top: 0">${esc(text.partnerTag)}</span></div>
        <p class="tm-quote">${esc(text.partnerQuote)}</p>
      </article>
      <article class="pz-card s-paper tm-card-c">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>${esc(text.insideTitle)}</h3>
        <ul class="tm-legend">
          <li data-tm="lgSock"><svg class="tm-lg-ic" aria-hidden="true"><use href="#tm-i-sock"></use></svg><span><b>${esc(tr('Brass socket', 'Ổ đồng'))}</b> — ${esc(tr('where the ball must go', 'đích của viên bi'))}</span></li>
          <li data-tm="lgLever"><svg class="tm-lg-ic" aria-hidden="true"><use href="#tm-i-lever"></use></svg><span><b>${esc(tr('Brass lever', 'Cần gạt đồng'))}</b></span></li>
          <li data-tm="lgGate"><svg class="tm-lg-ic" aria-hidden="true"><use href="#tm-i-gate"></use></svg><span><b>${esc(tr('Gate', 'Cửa chắn'))}</b> — <span data-tm="gateState"></span></span></li>
          <li data-tm="lgHole"><svg class="tm-lg-ic" aria-hidden="true"><use href="#tm-i-hole"></use></svg><span><b>${esc(tr('Hole', 'Lỗ'))}</b> — ${esc(tr('the ball drops and rolls back to the start', 'bi rơi, lăn về ô xuất phát'))}</span></li>
        </ul>
      </article>
    </aside>

    <section class="tm-sec" aria-label="${esc(tr('Tilting maze box', 'Hộp mê cung nghiêng'))}">
      <div class="tm-mat" data-tm="mat">
        <div class="tm-top">
          <p class="tm-chip" data-tm="gateChip"><i class="tm-lamp" aria-hidden="true"></i>${esc(tr('Gate', 'Cửa chắn'))}: <b data-tm="gateWord"></b></p>
          <p class="tm-chip tm-falls">${esc(tr('Falls', 'Rơi lỗ'))}: <b data-tm="falls">0</b></p>
          <p class="tm-top-hint">${esc(tr('Drag the box to tilt · arrow keys · R resets the ball', 'Kéo hộp để nghiêng · phím mũi tên · R đặt lại bi'))}</p>
        </div>
        <div class="tm-row">
          <div class="tm-scene" data-tm="scene" tabindex="0" role="application" aria-roledescription="${esc(tr('maze box', 'hộp mê cung'))}" aria-label="${esc(tr(`Maze box, ${N} by ${N} cells`, `Hộp mê cung ${N} nhân ${N} ô`))}" aria-describedby="tm-help">
            <div class="tm-box" data-tm="box" aria-hidden="true">
              <i class="tm-f tm-ground"></i>
              <i class="tm-f tm-in-floor"></i>
              <i class="tm-f tm-in-back"></i>
              <i class="tm-f tm-in-w"></i>
              <i class="tm-f tm-in-e"></i>
              <i class="tm-f tm-rt tm-rt-n"></i><i class="tm-f tm-rt tm-rt-s"></i><i class="tm-f tm-rt tm-rt-w"></i><i class="tm-f tm-rt tm-rt-e"></i>
              <div class="tm-f tm-paper">
                <svg class="tm-paper-ink" viewBox="0 0 320 230" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M150 22 l5 -10 l5 10 l11 1 l-8 7 l3 11 l-11 -6 l-11 6 l3 -11 l-8 -7 z" fill="#9e3f2a" opacity=".75"></path>
                  <path d="M40 58 H280" stroke="#07111f" stroke-width="5" opacity=".55"></path>
                  <path d="M64 78 H256 M40 102 H130 M188 102 H282 M40 122 H120 M188 122 H262 M40 142 H138 M188 142 H270" stroke="#3b3328" stroke-width="3" opacity=".35"></path>
                  <rect x="182" y="158" width="104" height="42" fill="none" stroke="#3b3328" stroke-width="2" opacity=".4"></rect>
                  <path d="M190 182 C200 170 208 192 218 178 S236 186 246 174 S262 186 276 176" fill="none" stroke="#1d3a8a" stroke-width="3" opacity=".8"></path>
                </svg>
              </div>
              <i class="tm-f tm-b-west"></i>
              <i class="tm-f tm-b-east"></i>
              <div class="tm-f tm-b-front">
                <svg class="tm-fpaint" viewBox="0 0 778 115" preserveAspectRatio="none" aria-hidden="true">
                  <rect x="9" y="7" width="760" height="101" rx="3" fill="none" stroke="#d9b45a" stroke-opacity=".7" stroke-width="1.8"></rect>
                  <rect x="15" y="13" width="748" height="89" rx="2" fill="none" stroke="#d9b45a" stroke-opacity=".45" stroke-width="1" stroke-dasharray="2 4"></rect>
                  <g fill="#e2c06a" opacity=".85">
                    <path d="M150 20 l2.6 6.4 l6.9 .4 l-5.3 4.4 l1.8 6.7 l-6 -3.8 l-6 3.8 l1.8 -6.7 l-5.3 -4.4 l6.9 -.4 z"></path>
                    <path d="M628 20 l2.6 6.4 l6.9 .4 l-5.3 4.4 l1.8 6.7 l-6 -3.8 l-6 3.8 l1.8 -6.7 l-5.3 -4.4 l6.9 -.4 z"></path>
                    <path d="M246 27 l1.6 4 l4.3 .3 l-3.3 2.8 l1.1 4.2 l-3.7 -2.4 l-3.7 2.4 l1.1 -4.2 l-3.3 -2.8 l4.3 -.3 z"></path>
                    <path d="M532 27 l1.6 4 l4.3 .3 l-3.3 2.8 l1.1 4.2 l-3.7 -2.4 l-3.7 2.4 l1.1 -4.2 l-3.3 -2.8 l4.3 -.3 z"></path>
                  </g>
                  <path d="M196 33 H318 M460 33 H582" stroke="#d9b45a" stroke-opacity=".5" stroke-width="1.4" stroke-dasharray="1 5" stroke-linecap="round"></path>
                  <path d="M9 7 L34 7 L9 32 Z M769 7 L744 7 L769 32 Z M9 108 L34 108 L9 83 Z M769 108 L744 108 L769 83 Z" fill="#c7a24b"></path>
                </svg>
                <i class="tm-catch"></i>
                <i class="tm-lift"></i>
                <div class="tm-chan"><i class="tm-cball" data-tm="cball"></i></div>
                <svg class="tm-gear" data-tm="gear" viewBox="0 0 40 40" aria-hidden="true"><path d="M17.6 2 h4.8 l.9 5.1 a13 13 0 0 1 3.9 1.6 l4.2 -3 l3.4 3.4 l-3 4.2 a13 13 0 0 1 1.6 3.9 l5.1 .9 v4.8 l-5.1 .9 a13 13 0 0 1 -1.6 3.9 l3 4.2 l-3.4 3.4 l-4.2 -3 a13 13 0 0 1 -3.9 1.6 l-.9 5.1 h-4.8 l-.9 -5.1 a13 13 0 0 1 -3.9 -1.6 l-4.2 3 l-3.4 -3.4 l3 -4.2 a13 13 0 0 1 -1.6 -3.9 l-5.1 -.9 v-4.8 l5.1 -.9 a13 13 0 0 1 1.6 -3.9 l-3 -4.2 l3.4 -3.4 l4.2 3 a13 13 0 0 1 3.9 -1.6 z" fill="#c7a24b" stroke="#4a3810" stroke-width="1.2"></path><circle cx="20" cy="20" r="8" fill="#8f6d2c" stroke="#4a3810" stroke-width="1.2"></circle><circle cx="20" cy="20" r="3" fill="#2b1f08"></circle><path d="M20 12 V15 M20 25 V28 M12 20 H15 M25 20 H28" stroke="#f6e2a0" stroke-width="1.4" stroke-linecap="round"></path></svg>
              </div>
              <div class="tm-3d tm-lid">
                <div class="tm-f tm-l-under"><span class="tm-l-seal"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 L24.4 14.4 L36.6 15 L27.1 22.7 L30.3 34.6 L20 27.8 L9.7 34.6 L12.9 22.7 L3.4 15 L15.6 14.4 Z" fill="none" stroke="#d9b45a" stroke-width="1.6" stroke-opacity=".8"></path></svg></span></div>
                <i class="tm-f tm-l-west"></i>
                <i class="tm-f tm-l-east"></i>
                <i class="tm-f tm-l-front"></i>
                <i class="tm-f tm-li-n"></i>
                <i class="tm-f tm-li-w"></i>
                <i class="tm-f tm-li-e"></i>
                <div class="tm-3d tm-maze" style="--n: ${N}">
                  <div class="tm-f tm-floor">
                    ${floorPaint()}
                    <i class="tm-cup" style="${kpos(L.start[1] + 0.5, L.start[0] + 0.5)}"></i>
                    ${L.holes.map((h, i) => `<i class="tm-hole" data-tm="hole${i}" style="${kpos(h[1] + 0.5, h[0] + 0.5)}"></i>`).join('')}
                    <span class="tm-gbw" style="${kpos(gateX, gateY)}; transform: rotate(${gateDeg}deg)"><i class="tm-gbed"></i></span>
                    <span class="tm-sock" style="${kpos(L.sock[1] + 0.5, L.sock[0] + 0.5)}"><i class="tm-ring"></i></span>
                    <i class="tm-lplate" style="${kpos(L.lever[1] + 0.5, L.lever[0] + 0.5)}"></i>
                  </div>
                  ${strips()}
                  <div class="tm-3d tm-gwrap" style="${kpos(gateX, gateY)}; transform: rotateZ(${gateDeg}deg)"><div class="tm-3d tm-gate" data-tm="gate"><i class="tm-gflap" data-tm="gflap"></i></div></div>
                  <div class="tm-3d tm-lev" data-tm="lev" style="${kpos(L.lever[1] + 0.5, L.lever[0] + 0.5)}">
                    <i class="tm-f tm-lev-sh"></i>
                    <i class="tm-f tm-lev-bar"></i>
                    <i class="tm-f tm-lev-cap"></i>
                    <i class="tm-f tm-lev-knob" data-tm="knob"></i>
                  </div>
                  <i class="tm-f tm-thud" data-tm="thud"></i>
                  <div class="tm-3d tm-bpos" data-tm="bpos">
                    <i class="tm-f tm-bshadow"></i>
                    <div class="tm-f tm-bill" data-tm="bill">
                      <span class="tm-ball">
                        <span class="tm-roll" data-tm="roll"><i class="tm-roll-in" data-tm="rollIn"></i></span>
                        <i class="tm-spec" data-tm="spec"></i>
                      </span>
                    </div>
                  </div>
                  <div class="tm-f tm-popw" data-tm-pop style="${kpos(L.lever[1] + 1.3, L.lever[0] + 0.45)}"><span class="tm-pop" data-tm="popLever">${ARROW_ICON}${esc(tr('click!', 'tách!'))}</span></div>
                  <div class="tm-f tm-popw" data-tm-pop style="${kpos(gateX, gateY + 0.1)}"><span class="tm-pop is-red" data-tm="popGate">${esc(tr('clonk!', 'cộc!'))}</span></div>
                  <div class="tm-f tm-popw" data-tm-pop style="${kpos(L.sock[1] + 0.5, L.sock[0] + 0.2)}"><span class="tm-pop" data-tm="popSock">${ARROW_ICON}${esc(tr('clack!', 'cạch!'))}</span></div>
                  <div class="tm-f tm-popw" data-tm-pop style="${kpos(L.start[1] + 0.9, L.start[0] + 0.3)}"><span class="tm-pop" data-tm="popCup">${esc(tr('pop!', 'bật!'))}</span></div>
                  <div class="tm-f tm-popw" data-tm="chanPop" data-tm-pop-low><span class="tm-pop" data-tm="popChan">${esc(tr('rattle…', 'lọc cọc…'))}</span></div>
                  <div class="tm-f tm-popw" data-tm-pop style="${kpos(N / 2, u2k(7.7))}"><span class="tm-pop is-latch">${esc(tr('latch!', 'bật chốt!'))}</span></div>
                </div>
                <i class="tm-f tm-lr tm-lr-n"></i><i class="tm-f tm-lr tm-lr-s"></i><i class="tm-f tm-lr tm-lr-w"></i><i class="tm-f tm-lr tm-lr-e"></i>
                <i class="tm-f tm-corner" style="left: 0; top: 0; transform: translateZ(calc(var(--u) * .5 + 1px))"></i>
                <i class="tm-f tm-corner" style="left: calc(var(--u) * 7.45); top: 0; transform: translateZ(calc(var(--u) * .5 + 1px)) rotate(90deg)"></i>
                <i class="tm-f tm-corner" style="left: 0; top: calc(var(--u) * 7.45); transform: translateZ(calc(var(--u) * .5 + 1px)) rotate(-90deg)"></i>
                <i class="tm-f tm-corner" style="left: calc(var(--u) * 7.45); top: calc(var(--u) * 7.45); transform: translateZ(calc(var(--u) * .5 + 1px)) rotate(180deg)"></i>
                <i class="tm-f tm-hasp"></i>
              </div>
            </div>
          </div>
          <div class="tm-panel">
            <p class="tm-pk">${esc(tr('TILT PAD', 'BẢNG NGHIÊNG'))}</p>
            <div class="tm-pad">
              <button type="button" class="tm-key tm-k-u" data-tm-dir="U" aria-label="${esc(tr('Tilt the box up', 'Nghiêng hộp về phía trên'))}" aria-keyshortcuts="ArrowUp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19 V5 M6 11 L12 5 L18 11"></path></svg></button>
              <button type="button" class="tm-key tm-k-l" data-tm-dir="L" aria-label="${esc(tr('Tilt the box left', 'Nghiêng hộp sang trái'))}" aria-keyshortcuts="ArrowLeft"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12 H5 M11 6 L5 12 L11 18"></path></svg></button>
              <button type="button" class="tm-key tm-k-r" data-tm-dir="R" aria-label="${esc(tr('Tilt the box right', 'Nghiêng hộp sang phải'))}" aria-keyshortcuts="ArrowRight"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12 H19 M13 6 L19 12 L13 18"></path></svg></button>
              <button type="button" class="tm-key tm-k-d" data-tm-dir="D" aria-label="${esc(tr('Tilt the box down', 'Nghiêng hộp về phía dưới'))}" aria-keyshortcuts="ArrowDown"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5 V19 M6 13 L12 19 L18 13"></path></svg></button>
              <span class="tm-level" aria-hidden="true"><i class="tm-bubble" data-tm="bubble"></i></span>
            </div>
            <p class="tm-odo" aria-hidden="true">
              <span class="tm-pk">${esc(tr('TILTS', 'SỐ LẦN NGHIÊNG'))}</span>
              <span class="tm-drums">
                <span class="tm-drum"><span class="tm-dstrip" data-tm="dTens"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span></span></span>
                <span class="tm-drum"><span class="tm-dstrip" data-tm="dOnes"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span></span></span>
              </span>
            </p>
            <div class="tm-acts">
              <span class="tm-tries" data-tm="tries"></span>
              <button type="button" class="s-btn s-btn-gold s-btn-sm" data-tm="reset" aria-keyshortcuts="R">${esc(tr('Reset ball', 'Đặt lại bi'))} <span class="pz-kbd" aria-hidden="true">R</span></button>
            </div>
          </div>
        </div>
        <p id="tm-help" class="s-sr">${esc(tr(
          `A ${N} by ${N} box. The ball starts at ${sideName(L.start)}; the brass socket is at ${sideName(L.sock)} and its entrance from ${gateSide} is shut by a brass gate. Use the arrow keys to tilt the box; the ball rolls until it hits a wall. R puts the ball back at the start. You can also drag the box with the mouse or a finger in the direction to tilt.`,
          `Hộp ${N} nhân ${N} ô. Viên bi bắt đầu ở ${sideName(L.start)}, ổ đồng ở ${sideName(L.sock)}, lối vào ổ từ ${gateSide} bị cửa chắn đồng đóng lại. Dùng phím mũi tên để nghiêng hộp; bi lăn một mạch tới khi chạm vách. Phím R đặt bi về ô xuất phát. Có thể kéo hộp bằng chuột hoặc ngón tay theo hướng muốn nghiêng.`))}</p>
      </div>
    </section>`;

  const $ = <T extends Element = HTMLElement>(name: string) => body.querySelector<HTMLElement>(`[data-tm="${name}"]`) as unknown as T;
  const el = {
    mat: $('mat'), scene: $('scene'), box: $('box'), gateChip: $('gateChip'), gateWord: $('gateWord'), falls: $('falls'),
    gate: $('gate'), gflap: $('gflap'), lev: $('lev'), knob: $('knob'), thud: $('thud'), bpos: $('bpos'), bill: $('bill'),
    roll: $('roll'), rollIn: $('rollIn'), spec: $('spec'), cball: $('cball'), gear: $('gear') as unknown as SVGElement,
    popLever: $('popLever'), popGate: $('popGate'), popSock: $('popSock'), popCup: $('popCup'), popChan: $('popChan'), chanPop: $('chanPop'),
    lgSock: $('lgSock'), lgLever: $('lgLever'), lgGate: $('lgGate'), lgHole: $('lgHole'), gateState: $('gateState'),
    bubble: $('bubble'), dTens: $('dTens'), dOnes: $('dOnes'), tries: $('tries'), reset: $<HTMLButtonElement>('reset'),
  };
  const holeEls = L.holes.map((_, i) => $(`hole${i}`));
  const popEls = [...body.querySelectorAll<HTMLElement>('[data-tm-pop]')];
  const keyEls = [...body.querySelectorAll<HTMLButtonElement>('[data-tm-dir]')];
  const veil = (body.closest('[data-pzh-kind]') as HTMLElement | null) ?? body;

  // ----- state (same shape as the mockup's) -----
  const base = () => ({
    r: L.start[0], c: L.start[1], gate: false, tilts: 0, falls: 0, phase: 'play',
    bx: L.start[1] + 0.5, by: L.start[0] + 0.5, bz: 0.3, bdur: 0, bdel: 0, sink: false, hide: false, lift: false, pop: false, inSock: false,
    tiltDir: '' as Dir | '', dragTx: 0, dragTy: 0, dragging: false,
    leverVis: false, gateVis: false, leverN: 0, rattleN: 0, thudN: 0, thudX: 0.5, thudY: 0.5, chanN: 0, chanFx: 50, popN: 0, sockN: 0,
    rollN: 0, rollDir: 'R' as Dir, rollMs: 400, rollIt: 1,
    win: false, latch: false, open: false, msg: 'ready', msgDir: 'U' as Dir, lastHole: -1, bumpN: 0, errText: '',
  });
  type State = ReturnType<typeof base>;
  let s: State = base();
  /** Tilts since the ball last stood at the start with the gate shut; loops are cut (same cell + gate = same state). */
  let moves = '';
  let visited: string[] = [`${L.start[0]},${L.start[1]},0`];
  let timers: number[] = [];
  let levelT = 0;
  let raf = 0;
  let drag: { id: number; x0: number; y0: number; x: number; y: number; fired: boolean } | null = null;
  let queued: Dir | null = null;
  let dead = false;
  let lastStatus = '';

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => { timers = timers.filter((x) => x !== t); if (!dead) fn(); }, ms);
    timers.push(t);
    return t;
  };
  const clearLevel = () => { if (levelT) { clearTimeout(levelT); timers = timers.filter((x) => x !== levelT); levelT = 0; } };
  const clearTimers = () => { timers.forEach((t) => clearTimeout(t)); timers = []; levelT = 0; queued = null; };
  const set = (patch: Partial<State>) => { s = { ...s, ...patch }; paint(); };

  function record(d: Dir, r: number, c: number, gate: boolean) {
    const k = `${r},${c},${gate ? 1 : 0}`;
    const seen = visited.indexOf(k);
    if (seen >= 0) { moves = moves.slice(0, seen); visited = visited.slice(0, seen + 1); return; }
    moves += d;
    visited.push(k);
  }
  function forget() { moves = ''; visited = [`${L.start[0]},${L.start[1]},0`]; }

  // ----- rules (same as TiltMazeKind.Slide) -----
  function edge(r: number, c: number, d: Dir) {
    const v = DIR[d];
    const rr = r + v[0], cc = c + v[1];
    if (rr < 0 || rr >= N || cc < 0 || cc >= N) return 'rim';
    const k = key(r, c, rr, cc);
    if (WALL.has(k)) return 'wall';
    if (k === GATE) return 'gate';
    return '';
  }
  function slide(r: number, c: number, gate: boolean, d: Dir): SlideResult {
    const v = DIR[d];
    const path: Cell[] = [[r, c]];
    const levers: number[] = [];
    let g = gate;
    for (let guard = 0; guard < N * N * 4; guard++) {
      const e = edge(r, c, d);
      if (e === 'rim' || e === 'wall' || (e === 'gate' && !g)) return { kind: 'stop', r, c, gate: g, path, levers, stop: e };
      r += v[0]; c += v[1];
      path.push([r, c]);
      const h = holeAt(r, c);
      if (h >= 0) return { kind: 'hole', hole: h, r, c, gate: g, path, levers, stop: '' };
      if (at(L.sock, r, c)) return { kind: 'win', r, c, gate: g, path, levers, stop: '' };
      if (at(L.lever, r, c)) { g = !g; levers.push(path.length - 1); }
    }
    return { kind: 'stop', r, c, gate: g, path, levers, stop: 'rim' };
  }

  // ----- tilting -----
  function tilt(d: Dir) {
    if (s.phase === 'moving') { queued = d; return; }
    if (s.phase !== 'play') return;
    queued = null;
    clearLevel();
    const res = slide(s.r, s.c, s.gate, d);
    const n = res.path.length - 1;
    const v = DIR[d];
    const common: Partial<State> = { tilts: s.tilts + 1, tiltDir: rm() ? '' : d, dragTx: 0, dragTy: 0, lastHole: -1, msgDir: d };

    if (n === 0) {
      record(d, s.r, s.c, s.gate);
      const patch: Partial<State> = { ...common, msg: res.stop === 'gate' ? 'gate' : 'blocked', thudN: s.thudN + 1, thudX: s.c + 0.5 + v[1] * 0.4, thudY: s.r + 0.5 + v[0] * 0.4 };
      if (res.stop === 'gate') patch.rattleN = s.rattleN + 1;
      set(patch);
      if (!rm()) levelT = later(() => { levelT = 0; set({ tiltDir: '' }); }, 420);
      return;
    }

    const end = res.path[n];
    const logical = res.kind === 'hole' ? { r: L.start[0], c: L.start[1], gate: false } : { r: res.r, c: res.c, gate: res.gate };
    if (res.kind !== 'win') record(d, logical.r, logical.c, logical.gate);
    const winMoves = res.kind === 'win' ? moves + d : '';

    if (rm()) {
      if (res.kind === 'hole') {
        set({ ...common, ...logical, bx: L.start[1] + 0.5, by: L.start[0] + 0.5, bz: 0.3, bdur: 0, bdel: 0, leverVis: false, gateVis: false, falls: s.falls + 1, lastHole: res.hole!, msg: 'fall' });
      } else if (res.kind === 'win') {
        set({ ...common, ...logical, bx: end[1] + 0.5, by: end[0] + 0.5, bz: 0.06, bdur: 0, bdel: 0, inSock: true, leverVis: res.gate, gateVis: res.gate, phase: 'win', win: true, msg: 'win' });
        submitWin(winMoves);
      } else {
        set({ ...common, ...logical, bx: end[1] + 0.5, by: end[0] + 0.5, bdur: 0, bdel: 0, leverVis: res.gate, gateVis: res.gate, msg: res.levers.length ? 'lever' : (res.stop === 'gate' ? 'gate' : 'stop') });
      }
      return;
    }

    const dur = Math.round(150 + 92 * n);
    const del = 90;
    set({ ...common, ...logical, phase: 'moving', bx: end[1] + 0.5, by: end[0] + 0.5, bdur: dur, bdel: del, rollN: s.rollN + 1, rollDir: d, rollMs: Math.max(120, Math.round(dur / n)), rollIt: n, msg: 'moving' });
    /* the lever flips at the moment the ball rolls across it, and the gate swings with it */
    res.levers.forEach((i) => {
      later(() => set({ leverVis: !s.leverVis, gateVis: !s.gateVis, leverN: s.leverN + 1 }), Math.max(0, Math.round(del + dur * timeAt(i / n)) - 20));
    });
    const arriveMs = del + dur;
    if (res.kind === 'stop') later(() => arrive(res, d), arriveMs);
    else if (res.kind === 'hole') later(() => fall(res), arriveMs);
    else later(() => win(winMoves), arriveMs);
  }

  function arrive(res: SlideResult, d: Dir) {
    const v = DIR[d];
    const patch: Partial<State> = { phase: 'play', msg: res.levers.length ? 'lever' : (res.stop === 'gate' ? 'gate' : 'stop'), thudN: s.thudN + 1, thudX: res.c + 0.5 + v[1] * 0.4, thudY: res.r + 0.5 + v[0] * 0.4 };
    if (res.stop === 'gate') patch.rattleN = s.rattleN + 1;
    set(patch);
    levelT = later(() => { levelT = 0; set({ tiltDir: '' }); }, 170);
    if (queued) { const q = queued; queued = null; later(() => tilt(q), 70); }
  }

  function fall(res: SlideResult) {
    queued = null;
    /* swallowed: the ball sinks into the dark */
    set({ phase: 'falling', sink: true, bz: -0.34, msg: 'falling', falls: s.falls + 1, lastHole: res.hole!, bumpN: s.bumpN + 1 });
    /* it rattles along the glass channel on the front of the box; the lever springs back and the gate shuts */
    later(() => {
      const reset = s.leverVis || s.gateVis;
      set({ sink: false, hide: true, bx: L.start[1] + 0.5, by: L.start[0] + 0.5, bdur: 0, bdel: 0, bz: -0.42, tiltDir: '',
        chanN: s.chanN + 1, chanFx: chanFor(res.hole!), leverVis: false, gateVis: false, leverN: reset ? s.leverN + 1 : s.leverN });
    }, 470);
    /* the little lift pops it back into the start cup */
    later(() => set({ hide: false, pop: true, bz: 0.3, popN: s.popN + 1 }), 470 + 860);
    later(() => set({ pop: false, phase: 'play', msg: 'fall' }), 470 + 860 + 460);
  }

  function win(winMoves: string) {
    queued = null;
    clearLevel();
    set({ phase: 'win', win: true, inSock: true, bz: 0.06, sockN: s.sockN + 1, msg: 'win', tiltDir: '' });
    submitWin(winMoves);
  }

  /** The ball is in the socket: the server replays the tilts. The lid only opens once it agrees. */
  function submitWin(winMoves: string) {
    const arrivedAt = Date.now();
    ctx.submit({ moves: winMoves }).then((result) => {
      if (dead) return;
      if (result.solved) {
        forget();
        const spent = Date.now() - arrivedAt;
        if (rm()) { set({ latch: true, open: true, phase: 'open', msg: 'open' }); return; }
        later(() => set({ latch: true }), Math.max(0, 950 - spent));
        later(() => set({ open: true, phase: 'open' }), Math.max(0, 1300 - spent));
        later(() => set({ msg: 'open' }), Math.max(0, 3000 - spent));
        return;
      }
      rejected(result.message || tr('The box did not open.', 'Hộp không mở.'));
    }).catch((error: any) => {
      if (!dead) rejected(error?.message || tr('Could not reach the server — try again.', 'Không gửi được kết quả — thử lại.'));
    });
  }

  function rejected(message: string) {
    forget();
    set({ ...base(), tilts: s.tilts, falls: s.falls, leverN: s.leverN + 1, popN: s.popN + 1, msg: 'error', errText: message });
  }

  function reset() {
    if (s.phase !== 'play') return;
    const atStart = s.r === L.start[0] && s.c === L.start[1];
    if (atStart && !s.gate && !s.leverVis) return;
    clearLevel();
    queued = null;
    forget();
    const changed = s.leverVis || s.gateVis;
    const patch: Partial<State> = { r: L.start[0], c: L.start[1], gate: false, leverVis: false, gateVis: false, leverN: changed ? s.leverN + 1 : s.leverN,
      lastHole: -1, msg: 'reset', tiltDir: '', dragTx: 0, dragTy: 0 };
    if (rm() || atStart) { set({ ...patch, bx: L.start[1] + 0.5, by: L.start[0] + 0.5, bdur: 0, bdel: 0, bz: 0.3 }); return; }
    /* lift the ball out, then drop it into the start cup */
    set({ ...patch, phase: 'falling', lift: true, bz: 1.1 });
    later(() => set({ lift: false, hide: true, bx: L.start[1] + 0.5, by: L.start[0] + 0.5, bdur: 0, bdel: 0, bz: -0.42 }), 330);
    later(() => set({ hide: false, pop: true, bz: 0.3, popN: s.popN + 1 }), 400);
    later(() => set({ pop: false, phase: 'play' }), 880);
  }

  /** The partner solved it (or the sheet reopened after solving): show the open box. */
  function showSolved() {
    if (s.win) return;
    clearTimers();
    stopDrag();
    const open = { r: L.sock[0], c: L.sock[1], gate: true, bx: L.sock[1] + 0.5, by: L.sock[0] + 0.5, bz: 0.06, bdur: 0, bdel: 0, inSock: true,
      leverVis: true, gateVis: true, win: true, tiltDir: '' as const, dragging: false };
    if (rm()) { set({ ...open, latch: true, open: true, phase: 'open', msg: 'open' }); return; }
    set({ ...open, phase: 'win', msg: 'win', sockN: s.sockN + 1 });
    later(() => set({ latch: true }), 500);
    later(() => set({ open: true, phase: 'open' }), 800);
    later(() => set({ msg: 'open' }), 2200);
  }

  // ----- dragging the box -----
  function stopDrag() { if (raf) cancelAnimationFrame(raf); raf = 0; drag = null; }
  function onDown(e: PointerEvent) {
    if (e.button != null && e.button !== 0) return;
    if (s.win) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, fired: false };
    try { el.scene.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    set({ dragging: true });
  }
  function onMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; dragFrame(); });
  }
  function dragFrame() {
    const d = drag;
    if (!d || d.fired) return;
    const dx = d.x - d.x0, dy = d.y - d.y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 36) {
      const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U');
      d.fired = true;
      set({ dragTx: 0, dragTy: 0, dragging: false });
      tilt(dir);
      return;
    }
    const cl = (v: number) => Math.max(-6, Math.min(6, Math.round(v * 10) / 10));
    set({ dragTx: cl(-dy * 0.18), dragTy: cl(dx * 0.18) });
  }
  function onUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; dragFrame(); }
    drag = null;
    try { el.scene.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    set({ dragging: false, dragTx: 0, dragTy: 0 });
  }
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (target?.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
    const map: Record<string, Dir> = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };
    if (map[e.key]) { e.preventDefault(); tilt(map[e.key]); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); reset(); }
  }
  function onClick(e: Event) {
    const t = e.target as HTMLElement;
    const k = t.closest<HTMLElement>('[data-tm-dir]');
    if (k) { tilt(k.dataset.tmDir as Dir); return; }
    if (t.closest('[data-tm="reset"]')) reset();
  }

  // ----- view -----
  /** Writes a class, text or style value only when it changed (paint runs every drag frame). */
  const put = (node: Element | null | undefined, prop: string, value: string) => {
    if (!node) return;
    if (prop === 'class') { if (node.getAttribute('class') !== value) node.setAttribute('class', value); return; }
    if (prop === 'text') { if (node.textContent !== value) node.textContent = value; return; }
    const style = (node as HTMLElement).style;
    if (style.getPropertyValue(prop) !== value) style.setProperty(prop, value);
  };

  function status() {
    const pos = `${tr('row', 'hàng')} ${s.r + 1}, ${tr('column', 'cột')} ${s.c + 1}`;
    const underGate = at(outer, s.r, s.c) && !s.gate;
    switch (s.msg) {
      case 'moving': return [tr('ROLLING', 'ĐANG LĂN'), tr(`Tilting the box ${WORD[s.msgDir]} — the ball is rolling…`, `Nghiêng hộp ${WORD[s.msgDir]} — bi đang lăn…`), 'info'];
      case 'stop': return [tr('STOPPED', 'BI DỪNG'), tr(`The ball hit a wall and stopped at ${pos}.`, `Bi chạm vách, dừng ở ${pos}.`) + (underGate ? tr(' The brass gate is shut — no way into the socket yet.', ' Cửa chắn đồng đang đóng — chưa vào được ổ.') : ''), 'info'];
      case 'gate': return [tr('GATE SHUT', 'CỬA CHẮN ĐÓNG'), tr(`The ball knocks on the brass gate — it is shut; the ball stops at ${pos}.`, `Bi va vào cửa chắn đồng — cửa đang đóng, bi dừng ở ${pos}.`), 'info'];
      case 'lever': return [tr('CLICK!', 'TÁCH!'), (s.gate ? tr('The ball rolled over the lever — a small door opens.', 'Bi lăn qua cần gạt — có tiếng cửa nhỏ mở.') : tr('The ball rolled over the lever again — the gate shuts.', 'Bi lăn qua cần gạt lần nữa — cửa chắn lại đóng.')) + ' ' + tr(`It stops at ${pos}.`, `Bi dừng ở ${pos}.`), s.gate ? 'ok' : 'info'];
      case 'blocked': return [tr('NOT MOVING', 'ĐỨNG YÊN'), tr(`There is a wall right ${SIDE[s.msgDir]} — the ball does not roll.`, `Vách ở ngay ${SIDE[s.msgDir]} — bi không lăn.`), 'info'];
      case 'falling': return [tr('DOWN A HOLE!', 'RƠI XUỐNG LỖ!'), tr('The ball drops into a hole…', 'Bi rơi tõm vào lỗ…'), 'bad'];
      case 'fall': return [tr('DOWN A HOLE!', 'RƠI XUỐNG LỖ!'), tr(`The ball rolls back to the start along the side channel. The lever springs back, the gate shuts. Tilts: ${s.tilts}.`, `Bi theo máng bên hông lăn về ô xuất phát. Cần gạt bật về, cửa chắn đóng lại. Số lần nghiêng: ${s.tilts}.`), 'bad'];
      case 'reset': return [tr('RESET', 'ĐẶT LẠI'), tr('The ball is back at the start, the lever springs back, the gate shuts.', 'Bi về ô xuất phát, cần gạt bật về, cửa chắn đóng.'), 'info'];
      case 'win': return [tr('CLACK!', 'CẠCH!'), tr('The ball is in the brass socket — the ring turns and the lid latch springs open.', 'Bi đã vào ổ đồng — vòng đồng xoay, chốt nắp bật ra.'), 'ok'];
      case 'open': return [tr('LID OPEN', 'NẮP ĐÃ MỞ'), text.openText, 'ok'];
      case 'error': return [tr('NOT OPENED', 'CHƯA MỞ'), s.errText, 'bad'];
      default: return [tr('READY', 'SẴN SÀNG'), tr('The brass gate shuts the way into the socket. Tilt the box to roll the ball (arrow keys).', 'Cửa chắn đồng đang đóng lối vào ổ. Nghiêng hộp để lăn bi (phím mũi tên).'), 'info'];
    }
  }

  function paint() {
    const T = TILT;
    let tx = 0, ty = 0;
    if (s.tiltDir === 'U') tx = T; else if (s.tiltDir === 'D') tx = -T; else if (s.tiltDir === 'L') ty = -T; else if (s.tiltDir === 'R') ty = T;
    else { tx = s.dragTx; ty = s.dragTy; }
    const open = s.open;
    const ax = (open ? 28 : BASE) + tx;
    const boxT = (open ? 'translateY(calc(var(--u) * 2.5)) translateZ(calc(var(--u) * -10)) ' : 'translateY(0px) translateZ(0px) ') + `rotateX(${r2(ax)}deg) rotateY(${r2(ty)}deg)`;
    const billT = `rotateY(${r2(-ty)}deg) rotateX(${r2(-ax)}deg)`;
    const levDeg = s.leverVis ? 40 : -40;
    const moving = s.phase === 'moving';
    const hz = s.rollDir === 'L' || s.rollDir === 'R';

    body.classList.toggle('tm-rm', ctx.reducedMotion);
    put(el.mat, 'class', ['tm-mat', s.dragging ? 'is-drag' : '', s.win ? 'is-win' : '', s.latch ? 'is-latch' : '', open ? 'is-open' : ''].filter(Boolean).join(' '));
    put(el.box, 'transform', boxT);
    put(el.gateChip, 'class', 'tm-chip' + (s.gateVis ? ' is-open' : ''));
    put(el.gateWord, 'text', s.gateVis ? tr('OPEN', 'MỞ') : tr('SHUT', 'ĐÓNG'));
    put(el.falls, 'text', String(s.falls));
    put(el.gate, 'class', 'tm-3d tm-gate' + (s.gateVis ? ' is-open' : ''));
    put(el.gflap, 'class', ['tm-gflap', alt(s.rattleN, 'rt-a', 'rt-b')].filter(Boolean).join(' '));
    put(el.lev, 'transform', `rotateZ(${levDeg}deg)`);
    put(el.knob, 'transform', `translateZ(calc(var(--k) * .16)) rotateZ(${-levDeg}deg) ${billT}`);
    put(el.thud, 'class', ['tm-f tm-thud', alt(s.thudN, 'ta', 'tb')].filter(Boolean).join(' '));
    put(el.thud, 'left', `calc(var(--k) * ${r2(s.thudX)})`);
    put(el.thud, 'top', `calc(var(--k) * ${r2(s.thudY)})`);
    put(el.bpos, 'class', ['tm-3d tm-bpos', s.sink ? 'is-sink' : '', s.hide ? 'is-hide' : '', s.lift ? 'is-lift' : '', s.pop ? 'is-pop' : '', s.inSock ? 'is-sock' : '', moving ? 'is-roll' : ''].filter(Boolean).join(' '));
    put(el.bpos, 'transform', `translate3d(calc(var(--k) * ${r2(s.bx)}), calc(var(--k) * ${r2(s.by)}), 0)`);
    put(el.bpos, 'transition-duration', `${s.bdur}ms`);
    put(el.bpos, 'transition-delay', `${s.bdel}ms`);
    put(el.bill, 'transform', `translateZ(calc(var(--k) * ${s.bz})) ${billT}`);
    put(el.roll, 'transform', `rotate(${({ R: 0, D: 90, L: 180, U: 270 } as Record<Dir, number>)[s.rollDir] ?? 0}deg)`);
    put(el.rollIn, 'class', ['tm-roll-in', moving ? alt(s.rollN, 'ra', 'rb') : ''].filter(Boolean).join(' '));
    put(el.rollIn, 'animation-duration', `${s.rollMs}ms`);
    put(el.rollIn, 'animation-iteration-count', String(s.rollIt));
    put(el.rollIn, 'animation-delay', `${s.bdel}ms`);
    put(el.spec, 'class', 'tm-spec ' + (hz ? 'is-h' : 'is-v'));
    put(el.spec, 'left', `${r2(36 - ty * 1.1)}%`);
    put(el.spec, 'top', `${r2(30 - tx * 0.9)}%`);
    const popT = `translateZ(calc(var(--u) * 1.1)) ${billT}`;
    popEls.forEach((node) => put(node, 'transform', popT));
    put(el.chanPop, 'transform', `translateZ(calc(var(--u) * -.45)) ${billT}`);
    put(el.chanPop, 'left', `calc(var(--k) * ${u2k(0.11 + ((s.chanFx + 2.6) / 200) * 6.5)})`);
    put(el.chanPop, 'top', `calc(var(--k) * ${u2k(7.9)})`);
    put(el.popLever, 'class', ['tm-pop', alt(s.leverN, 'pa', 'pb')].filter(Boolean).join(' '));
    put(el.popGate, 'class', ['tm-pop is-red', alt(s.rattleN, 'pa', 'pb')].filter(Boolean).join(' '));
    put(el.popSock, 'class', ['tm-pop', alt(s.sockN, 'pa', 'pb')].filter(Boolean).join(' '));
    put(el.popCup, 'class', ['tm-pop', alt(s.popN, 'pa', 'pb')].filter(Boolean).join(' '));
    put(el.popChan, 'class', ['tm-pop', alt(s.chanN, 'pa', 'pb')].filter(Boolean).join(' '));
    put(el.cball, 'class', ['tm-cball', alt(s.chanN, 'ca', 'cb')].filter(Boolean).join(' '));
    put(el.cball, '--fx', `${s.chanFx}%`);
    if (el.gear) {
      const g = ['tm-gear', alt(s.chanN + s.popN, 'ga', 'gb')].filter(Boolean).join(' ');
      if (el.gear.getAttribute('class') !== g) el.gear.setAttribute('class', g);
    }
    holeEls.forEach((node, i) => put(node, 'class', 'tm-hole' + (s.lastHole === i ? ' is-last' : '')));
    put(el.lgSock, 'class', s.win ? 'is-on' : '');
    put(el.lgLever, 'class', s.leverVis ? 'is-on' : '');
    put(el.lgGate, 'class', s.gateVis ? 'is-on' : '');
    put(el.lgHole, 'class', s.lastHole >= 0 || s.phase === 'falling' ? 'is-warn' : '');
    put(el.gateState, 'text', s.gateVis ? tr('open', 'đang mở') : tr('shut', 'đang đóng'));
    keyEls.forEach((node) => put(node, 'class', `tm-key tm-k-${node.dataset.tmDir!.toLowerCase()}` + (s.tiltDir === node.dataset.tmDir ? ' is-on' : '')));
    put(el.bubble, 'transform', `translate(${r2(-ty / T * 12)}px, ${r2(tx / T * 12)}px)`);
    put(el.dTens, 'transform', `translateY(${-34 * (Math.floor(s.tilts / 10) % 10)}px)`);
    put(el.dOnes, 'transform', `translateY(${-34 * (s.tilts % 10)}px)`);
    put(el.tries, 'text', `${tr('Tilts', 'Số lần nghiêng')}: ${s.tilts}`);
    put(el.tries, 'class', ['tm-tries', alt(s.bumpN, 'bump-a', 'bump-b')].filter(Boolean).join(' '));
    el.reset.disabled = s.phase !== 'play' || (s.r === L.start[0] && s.c === L.start[1] && !s.gate && !s.leverVis);
    const [kick, line, tone] = status();
    const message = `${kick} — ${line}`;
    if (message !== lastStatus) { lastStatus = message; ctx.setStatus(message, tone as 'info' | 'ok' | 'bad'); }
  }

  el.scene.addEventListener('pointerdown', onDown);
  el.scene.addEventListener('pointermove', onMove);
  el.scene.addEventListener('pointerup', onUp);
  el.scene.addEventListener('pointercancel', onUp);
  body.addEventListener('click', onClick);
  veil.addEventListener('keydown', onKey);

  if (ctx.solved) {
    s = { ...s, r: L.sock[0], c: L.sock[1], gate: true, bx: L.sock[1] + 0.5, by: L.sock[0] + 0.5, bz: 0.06, inSock: true, leverVis: true, gateVis: true,
      phase: 'open', win: true, latch: true, open: true, msg: 'open' };
  }
  paint();

  return {
    update(next) {
      ctx = next;
      if (next.solved && !s.win) showSolved();
      else paint();
    },
    unmount() {
      dead = true;
      clearTimers();
      stopDrag();
      el.scene.removeEventListener('pointerdown', onDown);
      el.scene.removeEventListener('pointermove', onMove);
      el.scene.removeEventListener('pointerup', onUp);
      el.scene.removeEventListener('pointercancel', onUp);
      body.removeEventListener('click', onClick);
      veil.removeEventListener('keydown', onKey);
      body.innerHTML = '';
      body.classList.remove('tm-rm');
    },
  };
}

const tiltMaze: PuzzleKindModule = {
  kind: 'tilt_maze',
  label: { en: 'Tilting maze', vi: 'Mê cung nghiêng' },
  mount,
};

export default tiltMaze;
