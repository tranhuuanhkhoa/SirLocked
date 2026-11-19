/**
 * P4 · Soi tài liệu bị sửa (port of design/project/PuzzleForgery.dc.html, prefix fg-).
 * The document, its reference copy and the traces of each alteration come from the per-case params;
 * the layout of the rows (and so the zones, ink circles, tags and string anchors) is computed here in
 * the mockup's 440 × 540 design units. A field can only be circled under the lamp that shows its
 * trace; when every altered field is circled the documents are joined and {marks} is submitted.
 */
import './doc_forgery.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleTone } from '../types';

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const text = (obj: any, key: string, fallback: string) => (obj && typeof obj[key] === 'string' && obj[key].trim() ? obj[key] : fallback);
const W = 440;
const H = 540;
const LIM = { x0: 40, x1: 400, y0: 70, y1: 470 };
const LINE = 31; // design px between written lines of one field
const C_LINE = 23; // the same on the 290 × 330 reference copy
type Light = 'normal' | 'rake' | 'uv';
const LIGHTS: Light[] = ['normal', 'rake', 'uv'];
const FOLD = { x0: 0, y0: 258, x1: 440, y1: 284, cx: 104, cy: 270 };

interface Field {
  id: string; label: string; name: string; value: string[]; ref: string[]; trace: '' | 'erase' | 'overwrite' | 'ink'; light: '' | 'rake' | 'uv'; ghost: string[];
  lines: number; top: number; zone: { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number };
  cTop: number; cLines: number; anchorE: { x: number; y: number }; anchorR: { x: number; y: number }; tag: string;
}
interface State {
  light: Light; lx: number; ly: number; glide: boolean; marks: Record<string, number>; miss: number; mx: number; my: number; wob: number; fl: number;
  msg: string; phase: 'play' | 'join' | 'strings' | 'stamp' | 'won'; str: { e: { x: number; y: number }; r: { x: number; y: number } }[] | null;
  geo: { jx: number; jy: number; js: number } | null; stat: boolean; k: number;
}

/** small deterministic PRNG for decorative paper fibres */
function prng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const lines = (value: unknown) => String(value ?? '').split('\n').map((line) => line.trim()).filter((line, i, all) => line.length > 0 || (i === 0 && all.length === 1));
const r1 = (v: number) => Math.round(v * 10) / 10;

/** a hand-drawn ink loop around a rect, ~1.1 turns (like the mockup's circles), as a smooth cubic path */
function loopPath(x0: number, y0: number, x1: number, y1: number, seed: string) {
  const rnd = prng(seed);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 8, ry = (y1 - y0) / 2 + 5;
  const pts: [number, number][] = [];
  const start = Math.PI * (0.95 + rnd() * 0.1);
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const a = start + (i / steps) * Math.PI * 2.16;
    const wob = 1 + (rnd() - 0.5) * 0.06 - (i / steps) * 0.04;
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
}

function mount(body: HTMLElement, ctx0: PuzzleContext): PuzzleKindHandle {
  let ctx = ctx0;
  const p = ctx.params ?? {};
  const doc = p.doc ?? {};
  const refDoc = p.ref ?? {};
  const seal = p.seal ?? {};
  const cards = p.cards ?? {};
  const signers: any[] = Array.isArray(p.signers) ? p.signers : [];
  const sign1 = signers[0] ?? {}, sign2 = signers[1] ?? {};

  // ---------- layout of the rows (design units) ----------
  const fields: Field[] = [];
  let top = 96;
  let cTop = 67;
  ((p.fields ?? []) as any[]).forEach((raw, index) => {
    if (!raw) return;
    const value = lines(raw.value);
    const ref = lines(raw.ref ?? raw.value);
    const ghost = lines(raw.ghost);
    const trace = (['erase', 'overwrite', 'ink'].includes(raw.trace) ? raw.trace : '') as Field['trace'];
    const n = Math.max(1, Math.min(2, Math.max(value.filter(Boolean).length, ghost.filter(Boolean).length)));
    // keep the writing clear of the paper's middle fold
    if (top - 4 < FOLD.y1 + 2 && top + 30 + LINE * (n - 1) + 4 > FOLD.y0 - 6) top = FOLD.y1 + 2;
    const y0 = top - 10, y1 = top + 30 + LINE * (n - 1) + 4;
    const cLines = Math.max(1, Math.min(2, Math.max(ref.filter(Boolean).length, trace === 'ink' && !ref.join('') ? n : 0)));
    const label = String(raw.label ?? '');
    const name = label.replace(/[:：]\s*$/, '').trim();
    const refText = ref.join(' ');
    const tagWord = trace === 'erase' ? 'TẨY XÓA' : trace === 'overwrite' ? (/\d/.test(value.join('')) ? 'SỬA SỐ' : 'VIẾT ĐÈ') : 'MỰC KHÁC';
    fields.push({
      id: String(raw.id ?? `f${index + 1}`), label, name, value, ref, trace, light: trace ? (trace === 'ink' ? 'uv' : 'rake') : '', ghost, lines: n, top,
      zone: { x0: 132, y0, x1: 414, y1, cx: 252, cy: Math.round((y0 + y1) / 2) },
      cTop, cLines, anchorE: { x: 146, y: y1 - 10 },
      anchorR: { x: Math.round(Math.max(140, Math.min(266, 108 + refText.length * 8 + 8))), y: Math.round(cTop + 9 + (C_LINE * (cLines - 1)) / 2) },
      tag: `<b>${esc(tagWord)}</b> · ${esc(name.toUpperCase())}`,
    });
    top += 48 + LINE * (n - 1);
    cTop += 29 + C_LINE * (cLines - 1);
  });
  const traced = fields.filter((f) => f.trace);
  const need = Math.max(1, traced.length);
  const lastBottom = fields.length ? fields[fields.length - 1].zone.y1 : 300;
  const shift = Math.max(0, Math.min(40, lastBottom + 8 - 372));
  const cShift = Math.max(0, Math.min(60, cTop - 4 - 236));
  const firstTraced = traced[0];

  const reduce = () => ctx.reducedMotion;
  const isPhone = () => window.matchMedia?.('(max-width: 900px)').matches ?? false;
  const timers: Record<string, number> = {};
  let raf = 0;
  let pend: { x: number; y: number } | null = null;
  let dead = false;
  let dragging = false;
  let moved = false;
  let d0: { x: number; y: number } | null = null;
  let submitted = false;

  const snap = (): State => ({ light: 'normal', lx: 322, ly: 118, glide: false, marks: {}, miss: 0, mx: 0, my: 0, wob: 0, fl: 0, msg: 'intro', phase: 'play', str: null, geo: null, stat: false, k: 0 });
  let s: State = snap();
  const setState = (patch: Partial<State>, after?: () => void) => { s = { ...s, ...patch }; paint(); after?.(); };

  // ---------- messages ----------
  const MSG: Record<string, string> = {
    intro: 'Ánh sáng thường: nhìn như mắt thường, chưa thấy dấu vết sửa chữa.',
    normal: 'Ánh sáng thường: nhìn như mắt thường.',
    rake: 'Đèn xiên chiếu sát mặt giấy — chỗ lồi lõm, xơ giấy sẽ đổ bóng.',
    uv: 'Đèn UV: giấy tối lại, mỗi loại mực phát sáng một kiểu.',
    wrong: 'Dưới ánh sáng này chưa thấy gì bất thường.',
    decoy: 'Chỉ là nếp gấp tự nhiên.',
    empty: 'Không thấy dấu vết nào ở chỗ này.',
    already: 'Chỗ này đã được khoanh.',
    join: `Đủ ${need} chỗ. Đặt ${text(doc, 'short', 'tài liệu')} cạnh ${text(refDoc, 'short', 'bản lưu')} để đối chiếu…`,
    won: `${text(doc, 'short', 'Tài liệu').replace(/^./, (c) => c.toUpperCase())} đã bị sửa — đã thêm vào hồ sơ.`,
    neterr: ctx.tr('Could not reach the server — circle the last spot again.', 'Không gửi được kết quả — khoanh lại chỗ cuối cùng để thử lại.'),
  };
  traced.forEach((f) => {
    MSG[`mark-${f.id}`] = f.trace === 'erase' ? `Khoanh được: mặt giấy quanh ô ${f.name.toLowerCase()} bị xơ — chữ đã bị tẩy rồi viết lại.`
      : f.trace === 'overwrite' ? `Khoanh được: dưới “${f.value.join(' ')}” còn rãnh hằn của “${f.ghost.join(' ')}” cũ.`
        : `Khoanh được: dòng ${f.name.toLowerCase()} phát sáng khác hẳn phần mực còn lại.`;
  });

  // ---------- markup ----------
  function reliefFor(f: Field, i: number) {
    let out = '';
    if (f.trace === 'erase') {
      const rnd = prng(`${f.id}|${f.value.join()}`);
      const len = Math.max(...f.value.concat(f.ghost).map((line) => line.length), 6);
      const xEnd = Math.min(404, 156 + len * 10.5 + 12);
      let zig = '';
      for (let k = 0; k < f.lines; k++) {
        const ya = f.top + LINE * k + 2, yb = ya + 24;
        zig += `M${r1(144 + rnd() * 4)} ${r1(ya)}`;
        for (let x = 150, up = false; x < xEnd; x += 10 + rnd() * 6, up = !up) zig += `L${r1(x)} ${r1((up ? ya : yb) + (rnd() - 0.5) * 3)}`;
        zig += `M${r1(xEnd)} ${r1(yb - 3)}`;
        for (let x = xEnd - 12, up = true; x > 146; x -= 12 + rnd() * 8, up = !up) zig += `L${r1(x)} ${r1((up ? ya + 4 : yb - 3) + (rnd() - 0.5) * 3)}`;
      }
      let curls = '';
      for (let n = 0; n < 30 + 20 * f.lines; n++) {
        const x = 138 + rnd() * (xEnd - 138), y = f.top - 2 + rnd() * (30 + LINE * (f.lines - 1));
        const a = rnd() * Math.PI * 2, l = 3 + rnd() * 5;
        curls += `M${r1(x)} ${r1(y)}Q${r1(x + Math.cos(a) * l * 0.6 + (rnd() - 0.5) * 3)} ${r1(y + Math.sin(a) * l * 0.6 + (rnd() - 0.5) * 3)} ${r1(x + Math.cos(a) * l)} ${r1(y + Math.sin(a) * l)}`;
      }
      out += `<defs><mask id="fg-m-scrub-${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="440" height="540"><path d="${zig}" style="fill: none; stroke: #fff; stroke-width: 15; stroke-linecap: round; stroke-linejoin: round" filter="url(#fg-f-soft4)"></path></mask></defs>
        <g mask="url(#fg-m-scrub-${i})"><rect x="118" y="${f.top - 20}" width="300" height="${48 + LINE * f.lines}" filter="url(#fg-f-scuff)"></rect><rect class="fg-lift" x="118" y="${f.top - 20}" width="300" height="${48 + LINE * f.lines}"></rect></g>
        <path class="fg-rf-sh" transform="translate(.7 .8)" d="${curls}"></path><path class="fg-rf-hi" d="${curls}"></path>`;
    }
    if (f.ghost.length && f.trace !== 'ink') {
      out += `<g filter="url(#fg-f-deboss)">${f.ghost.map((line, k) => `<text class="fg-ghost" x="${f.trace === 'overwrite' ? 155.4 : 151.6}" y="${r1(f.top + 22.5 + LINE * k)}">${esc(line)}</text>`).join('')}</g>`;
    }
    return out;
  }
  const sigShift = (y: number) => `top: ${y + shift}px`;
  const paper = (lens: boolean) => `
    <div class="fg-paper">
      <svg class="fg-grain" viewBox="0 0 440 540" aria-hidden="true"><rect width="440" height="540" filter="url(#fg-f-grain)"></rect></svg>
      <span class="fg-crease" aria-hidden="true"></span>
      <svg class="fg-relief" viewBox="0 0 440 540" aria-hidden="true">
        <rect width="440" height="540" filter="url(#fg-f-fib)"></rect>
        ${lens ? fields.map(reliefFor).join('') : ''}
                            <g class="fg-cr"><path class="fg-dk" transform="translate(0 -1.6)" filter="url(#fg-f-soft)" d="M-4 268.9C0.7 269 14.7 269.7 24 269.8C33.3 270 42.7 269.6 52 269.7C61.3 269.7 70.7 269.8 80 270C89.3 270.2 98.7 270.4 108 270.6C117.3 270.7 126.7 270.9 136 270.8C145.3 270.7 154.7 270 164 269.8C173.3 269.6 182.7 269.6 192 269.6C201.3 269.6 210.7 269.4 220 269.7C229.3 270 238.7 271.4 248 271.5C257.3 271.6 266.7 270.2 276 270.2C285.3 270.1 294.7 271 304 271.2C313.3 271.3 322.7 271.2 332 271.1C341.3 271 350.7 270.4 360 270.3C369.3 270.3 378.7 270.4 388 270.6C397.3 270.8 406.7 271.6 416 271.6C425.3 271.6 439.3 270.6 444 270.4"></path><path class="fg-lt" transform="translate(0 2.1)" filter="url(#fg-f-soft)" d="M-4 268.9C0.7 269 14.7 269.7 24 269.8C33.3 270 42.7 269.6 52 269.7C61.3 269.7 70.7 269.8 80 270C89.3 270.2 98.7 270.4 108 270.6C117.3 270.7 126.7 270.9 136 270.8C145.3 270.7 154.7 270 164 269.8C173.3 269.6 182.7 269.6 192 269.6C201.3 269.6 210.7 269.4 220 269.7C229.3 270 238.7 271.4 248 271.5C257.3 271.6 266.7 270.2 276 270.2C285.3 270.1 294.7 271 304 271.2C313.3 271.3 322.7 271.2 332 271.1C341.3 271 350.7 270.4 360 270.3C369.3 270.3 378.7 270.4 388 270.6C397.3 270.8 406.7 271.6 416 271.6C425.3 271.6 439.3 270.6 444 270.4"></path><path class="fg-ln" d="M-4 268.9C0.7 269 14.7 269.7 24 269.8C33.3 270 42.7 269.6 52 269.7C61.3 269.7 70.7 269.8 80 270C89.3 270.2 98.7 270.4 108 270.6C117.3 270.7 126.7 270.9 136 270.8C145.3 270.7 154.7 270 164 269.8C173.3 269.6 182.7 269.6 192 269.6C201.3 269.6 210.7 269.4 220 269.7C229.3 270 238.7 271.4 248 271.5C257.3 271.6 266.7 270.2 276 270.2C285.3 270.1 294.7 271 304 271.2C313.3 271.3 322.7 271.2 332 271.1C341.3 271 350.7 270.4 360 270.3C369.3 270.3 378.7 270.4 388 270.6C397.3 270.8 406.7 271.6 416 271.6C425.3 271.6 439.3 270.6 444 270.4"></path></g>
      </svg>
                          <svg class="fg-uvfib" viewBox="0 0 440 540" aria-hidden="true"><path d="M14 350.7Q16.2 345.8 15.8 340.4M53.1 134.4Q47.6 137 43.8 141.7M392 319.7Q396.1 322.4 397.1 327.2M281.2 196.1Q290.2 197 298.7 200.5M50 236.1Q56.2 231.6 64 231.1M275.5 249.4Q274.9 253.4 274.5 257.3M241.3 429.2Q238.1 433.2 237.5 438.3M278.2 97.6Q282.5 89 281.8 79.5M110.9 481.3Q103.5 477.5 98.6 470.8M163.7 95Q159.9 99.9 153.7 100.2M357 213Q356.9 219.2 361.3 223.6M357 235.5Q350.4 237.6 343.5 236.5M229.6 281.6Q225.1 275.1 217.2 274.7M207.6 183.3Q200.3 186.6 192.4 187.9M221.5 485.4Q215.5 489.1 211.1 494.5M146.8 374.9Q143.9 383.2 146.7 391.6M71.3 334.9Q77.3 336.8 82.1 340.8M74.9 362.7Q67.9 356.3 61.6 349.2M82.4 286.2Q86.2 279.4 82.8 272.4M108.7 44.9Q113.5 49.4 111.7 55.7M296.8 187.9Q287.9 189.4 280.6 194.8M367.6 20.2Q371.5 26.6 375.3 33.1M334 393.6Q331.9 387 335.8 381.3M100.6 423Q106.5 426.8 113.4 428.4M201.4 204.9Q205.6 202.4 209.3 205.7M240.2 367Q242.3 375.7 245.8 384"></path></svg>
      <span class="fg-t fg-title">${esc(text(doc, 'title', 'BIÊN NHẬN'))}</span>
      <span class="fg-t fg-sub">${esc(text(doc, 'sub', ''))}</span>
      <span class="fg-rule" aria-hidden="true"></span>
      ${fields.map((f) => `
        <span class="fg-t fg-lab" style="top: ${f.top + 6}px">${esc(f.label)}</span>
        ${Array.from({ length: f.lines }, (_, k) => `<span class="fg-line" style="top: ${f.top + 30 + LINE * k}px" aria-hidden="true"></span>`).join('')}
        ${f.value.filter(Boolean).map((line, k) => `<span class="fg-t fg-ink${f.trace === 'ink' ? ' fg-ink-c' : ''}${f.trace === 'erase' ? ' fg-ink-a' : ''}" style="top: ${f.top + LINE * k}px">${esc(line)}</span>`).join('')}`).join('')}
      <span class="fg-rule2" aria-hidden="true" style="${sigShift(372)}"></span>
      <span class="fg-t fg-lab fg-sl1" style="${sigShift(384)}">${esc(text(sign1, 'label', 'Người lập ký'))}</span>
                          <svg class="fg-sig fg-sig1" style="${sigShift(398)}" viewBox="0 0 140 52" aria-hidden="true"><path d="M6 36C10 22 16 10 22 12C28 14 20 34 26 36C32 38 36 16 42 14C48 12 44 30 50 30C56 30 58 18 64 18C70 18 66 32 72 32C80 32 84 14 92 14C100 14 94 34 102 32C110 30 116 20 134 16"></path><path d="M18 44C50 40 92 40 132 36"></path></svg>
      <span class="fg-t fg-ink fg-sn fg-sn1" style="${sigShift(450)}">${esc(text(sign1, 'name', ''))}</span>
      <span class="fg-t fg-lab fg-sl2" style="${sigShift(384)}">${esc(text(sign2, 'label', 'Người nhận ký'))}</span>
                          <svg class="fg-sig fg-sig2" style="${sigShift(396)}" viewBox="0 0 140 52" aria-hidden="true"><path d="M8 32C12 12 30 4 36 16C41 27 24 40 18 33C12 26 38 14 52 19C61 22 55 36 63 35C71 34 72 20 80 21C88 22 84 35 93 33C103 31 106 15 117 18C126 21 119 37 133 30"></path><path d="M26 44C58 39 96 36 130 27"></path></svg>
      <span class="fg-t fg-ink fg-sn fg-sn2" style="${sigShift(450)}">${esc(text(sign2, 'name', ''))}</span>
                          <svg class="fg-seal" style="${sigShift(394)}" viewBox="-50 -50 100 100" aria-hidden="true"><g filter="url(#fg-f-stamp)"><circle class="fg-seal-o" r="45"></circle><circle class="fg-seal-i" r="31.5"></circle><text class="fg-seal-ring"><textPath href="#fg-p-seal" startOffset="50%"${esc(text(seal, 'ring', 'ĐÃ NHẬN ĐỦ'))}</textPath></text><path class="fg-seal-star" d="M0 33.2l1.4 2.8 3.1.5-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.5z"></path><path class="fg-seal-bar" d="M-22 -9H22M-22 16H22"></path><text class="fg-seal-c" y="1.5">${esc(text(seal, 'top', 'ĐÃ'))}</text><text class="fg-seal-c" y="12.5">${esc(text(seal, 'bottom', 'NHẬN'))}</text></g></svg>
    </div>`;
  const marksLayer = (main: boolean) => `
    <div class="fg-marks${main ? ' fg-mainmarks' : ''}">
      <svg class="fg-inks" viewBox="0 0 440 540" aria-hidden="true">
        ${traced.map((f) => `<path class="fg-circ" data-circ="${esc(f.id)}" pathLength="1" d="${loopPath(f.zone.x0 + 6, f.zone.y0 + 8, Math.min(f.zone.x1, 156 + Math.max(...f.value.map((l) => l.length), 4) * 10.5 + 10), f.zone.y1 - 8, f.id)}"></path>`).join('')}
      </svg>
      ${traced.map((f, i) => `<span class="fg-tag" data-tag="${esc(f.id)}" style="right: ${[16, 24, 20][i % 3]}px; top: ${f.zone.y1 - 12}px; transform: rotate(${[-2, 1.5, -1.2][i % 3]}deg)"><span class="fg-tag-in">${f.tag}</span></span>`).join('')}
      <span class="fg-miss" data-miss aria-hidden="true"><svg viewBox="-10 -10 20 20"><path d="M-6 -5.4L5.6 6.2M5.8 -6L-5.2 5.4"></path></svg></span>
      ${main ? traced.map((f) => `<span class="fg-anc" data-anc-e="${esc(f.id)}" style="left: ${f.anchorE.x}px; top: ${f.anchorE.y}px"></span>`).join('') : ''}
    </div>`;
  const zok = '<svg class="fg-zok" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 2.6C6 2.4 2.6 6 2.8 11c.2 4.6 4 8.2 8.6 8 4.6-.2 7.9-4 7.6-8.4C18.7 6.4 15.8 3.4 12.3 2.6" style="fill: #fbf6ed; stroke: #9e3f2a; stroke-width: 1.8; stroke-linecap: round"></path><path d="M7.2 11.4l2.6 2.7 5-5.6" style="fill: none; stroke: #9e3f2a; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round"></path></svg>';
  const zones = [...fields.map((f) => ({ id: f.id, name: f.name, traced: !!f.trace })), { id: 'fold', name: 'Nếp gấp giữa', traced: false }];

  body.innerHTML = `
    <svg class="fg-defs" aria-hidden="true" focusable="false">
      <defs>
                <path id="fg-p-seal" d="M-35 0A35 35 0 0 1 35 0"></path>
                <!-- worn stamp ink: speckled gaps in the red notary seal -->
                <filter id="fg-f-stamp" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="3" seed="12" result="n"></feTurbulence>
                  <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4.2 3.05" result="m"></feColorMatrix>
                  <feComposite in="SourceGraphic" in2="m" operator="in"></feComposite>
                </filter>
                <radialGradient id="fg-g-pin" cx=".35" cy=".3" r=".75"><stop offset="0" style="stop-color: #f3a291"></stop><stop offset=".45" style="stop-color: #c0392b"></stop><stop offset="1" style="stop-color: #6e1a12"></stop></radialGradient>
                <filter id="fg-f-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency=".8 .5" numOctaves="2" seed="9" result="n"></feTurbulence>
                  <feColorMatrix in="n" type="matrix" values="0 0 0 0 .42  0 0 0 0 .32  0 0 0 0 .18  0 0 0 -1.5 .92"></feColorMatrix>
                </filter>
                <filter id="fg-f-leather" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="4" result="n"></feTurbulence>
                  <feColorMatrix in="n" type="matrix" values="0 0 0 0 .62  0 0 0 0 .66  0 0 0 0 .55  0 0 0 1.6 -.62"></feColorMatrix>
                </filter>
                <!-- raking light: lighting maps whose flat areas come out mid grey (neutral under hard-light) -->
                <filter id="fg-f-fib" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency=".8 1.15" numOctaves="3" seed="8" result="n"></feTurbulence>
                  <feDiffuseLighting in="n" surfaceScale=".12" diffuseConstant="1.46" lighting-color="#ffffff">
                    <feDistantLight azimuth="225" elevation="20"></feDistantLight>
                  </feDiffuseLighting>
                </filter>
                <filter id="fg-f-scuff" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                  <feTurbulence type="fractalNoise" baseFrequency=".42 1.5" numOctaves="3" seed="21" result="n"></feTurbulence>
                  <feDiffuseLighting in="n" surfaceScale=".95" diffuseConstant="1.46" lighting-color="#ffffff">
                    <feDistantLight azimuth="225" elevation="20"></feDistantLight>
                  </feDiffuseLighting>
                </filter>
                <!-- pressed-in writing seen under raking light: dark inner edge top-left, lit inner edge bottom-right -->
                <filter id="fg-f-deboss" x="-6%" y="-20%" width="112%" height="140%" color-interpolation-filters="sRGB">
                  <feOffset in="SourceAlpha" dx=".85" dy=".85" result="s1"></feOffset>
                  <feComposite in="SourceAlpha" in2="s1" operator="out" result="tl"></feComposite>
                  <feFlood flood-color="#000" flood-opacity=".66"></feFlood>
                  <feComposite in2="tl" operator="in" result="dk"></feComposite>
                  <feOffset in="SourceAlpha" dx="-.85" dy="-.85" result="s2"></feOffset>
                  <feComposite in="SourceAlpha" in2="s2" operator="out" result="br"></feComposite>
                  <feFlood flood-color="#fff" flood-opacity=".92"></feFlood>
                  <feComposite in2="br" operator="in" result="lt"></feComposite>
                  <feFlood flood-color="#000" flood-opacity=".1"></feFlood>
                  <feComposite in2="SourceAlpha" operator="in" result="fl"></feComposite>
                  <feMerge><feMergeNode in="fl"></feMergeNode><feMergeNode in="dk"></feMergeNode><feMergeNode in="lt"></feMergeNode></feMerge>
                </filter>
                <filter id="fg-f-soft" filterUnits="userSpaceOnUse" x="-20" y="-20" width="480" height="580">
                  <feGaussianBlur stdDeviation="1.1"></feGaussianBlur>
                </filter>
                <filter id="fg-f-soft4" x="-10%" y="-40%" width="120%" height="180%">
                  <feGaussianBlur stdDeviation="4.5"></feGaussianBlur>
                </filter>
      </defs>
    </svg>

            <div class="fg-mat" data-fg="mat" aria-hidden="true"><svg class="fg-matgrain" preserveAspectRatio="none" viewBox="0 0 880 660"><rect width="880" height="660" filter="url(#fg-f-leather)"></rect></svg></div>

    <div class="fg-bar">
      <span class="fg-bar-k" id="fg-light-k">ĐÈN SOI</span>
      <div class="fg-seg" role="group" aria-labelledby="fg-light-k">
                <button type="button" class="fg-lbtn" data-light="normal" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="11.5" r="4.4"></circle><path d="M12 3v1.8M12 18.2V20M3.5 11.5h1.8M18.7 11.5h1.8M6 5.5l1.3 1.3M16.7 16.2l1.3 1.3M18 5.5l-1.3 1.3M7.3 16.2L6 17.5"></path></svg>Ánh sáng thường</button>
                <button type="button" class="fg-lbtn" data-light="rake" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 19.5c2.6 0 2.6-1.6 5.2-1.6s2.6 1.6 5.2 1.6 2.6-1.6 5.2-1.6 2.6 1.6 3.4 1.6"></path><path d="M2.5 7.5l13 8M2.5 11.8l7.5 4.6M5.5 4.5l15 9.2"></path></svg>Đèn xiên</button>
                <button type="button" class="fg-lbtn uv" data-light="uv" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="3.5" width="15" height="5.5" rx="2.75"></rect><path d="M8 12.5c1.2 1.1-1.2 2.3 0 3.4s-1.2 2.3 0 3.4M12 12.5c1.2 1.1-1.2 2.3 0 3.4s-1.2 2.3 0 3.4M16 12.5c1.2 1.1-1.2 2.3 0 3.4s-1.2 2.3 0 3.4"></path></svg>Đèn UV</button>
      </div>
      <div class="fg-count" aria-hidden="true"><span class="fg-count-k">ĐÃ KHOANH</span><span class="fg-count-n" data-fg="count">0/${need}</span><span class="fg-dots">${traced.map(() => '<i></i>').join('')}</span></div>
    </div>

    <span class="fg-slot" data-fg="slot" aria-hidden="true"></span>
    <figure class="fg-envcol" data-fg="col" style="margin-bottom: 0">
      <span class="fg-doclabel">${esc(text(doc, 'label', 'TÀI LIỆU TRÊN BÀN'))}</span>
      <figcaption class="s-sr">${esc(text(doc, 'label', 'Tài liệu'))}. Kính lúp phóng to 2 lần chỗ đang soi; dùng các nút Soi nhanh từng ô nếu không dùng chuột.</figcaption>
      <div class="fg-envbox" data-fg="box">
        <div class="fg-env" data-fg="env">
          <div class="fg-docmain">${paper(false)}</div>
          ${marksLayer(true)}
          <div class="fg-bigstamp" aria-hidden="true">ĐÃ BỊ SỬA</div>
          <div class="fg-lens" data-fg="lens" aria-hidden="true">
            <div class="fg-lens-a"><div class="fg-lens-b"><div class="fg-lens-w" data-fg="wob">
              <span class="fg-lshadow"></span>
              <span class="fg-handle" data-fg="handle"><span class="fg-ferrule"></span><span class="fg-grip"></span></span>
              <div class="fg-glass">
                <div class="fg-copy" data-fg="copy">${paper(true)}${marksLayer(false)}</div>
                <span class="fg-tint"></span>
                <span class="fg-flash" data-fg="flash"></span>
                <span class="fg-edge"></span>
                <svg class="fg-ret" viewBox="-12 -12 24 24"><path d="M-11 0H-5M5 0H11M0 -11V-5M0 5V11"></path></svg>
                <span class="fg-glint"></span>
              </div>
              <span class="fg-rim"></span>
            </div></div></div>
          </div>
        </div>
      </div>
    </figure>

    <figure class="fg-ref" data-fg="ref" style="margin-left: 0; margin-right: 0; margin-bottom: 0">
      <span class="fg-doclabel">${esc(text(refDoc, 'label', 'BẢN LƯU ĐỐI CHIẾU'))}</span>
      <span class="s-pin red" aria-hidden="true"></span>
      <div class="fg-carbon"${cShift ? ` style="height: ${330 + cShift}px"` : ''}>
        <span class="fg-ct fg-c-title">${esc(text(refDoc, 'title', text(doc, 'title', 'BIÊN NHẬN')))}</span>
        <span class="fg-ct fg-c-sub">${esc(text(refDoc, 'sub', text(doc, 'sub', '')))}</span>
        <span class="fg-c-rule" aria-hidden="true"></span>
        ${fields.map((f) => `
          <span class="fg-ct fg-c-lab" style="top: ${f.cTop + 5}px">${esc(f.label)}</span>
          ${Array.from({ length: f.cLines }, (_, k) => `<span class="fg-c-line" style="top: ${f.cTop + 20 + C_LINE * k}px" aria-hidden="true"></span>`).join('')}
          ${f.ref.filter(Boolean).map((line, k) => `<span class="fg-ct fg-c-ink" style="top: ${f.cTop + C_LINE * k}px">${esc(line)}</span>`).join('')}`).join('')}
        <span class="fg-c-rule2" aria-hidden="true" style="top: ${236 + cShift}px"></span>
        <span class="fg-ct fg-c-lab fg-c-sl1" style="top: ${246 + cShift}px">${esc(text(sign1, 'label', 'Người lập ký'))}</span>
                <svg class="fg-c-sig fg-c-sig1" style="top: ${258 + cShift}px" viewBox="0 0 140 52" aria-hidden="true"><path d="M6 36C10 22 16 10 22 12C28 14 20 34 26 36C32 38 36 16 42 14C48 12 44 30 50 30C56 30 58 18 64 18C70 18 66 32 72 32C80 32 84 14 92 14C100 14 94 34 102 32C110 30 116 20 134 16"></path><path d="M18 44C50 40 92 40 132 36"></path></svg>
        <span class="fg-ct fg-c-ink fg-c-sn fg-c-sn1" style="top: ${298 + cShift}px">${esc(text(sign1, 'name', ''))}</span>
        <span class="fg-ct fg-c-lab fg-c-sl2" style="top: ${246 + cShift}px">${esc(text(sign2, 'label', 'Người nhận ký'))}</span>
                <svg class="fg-c-sig fg-c-sig2" style="top: ${257 + cShift}px" viewBox="0 0 140 52" aria-hidden="true"><path d="M8 32C12 12 30 4 36 16C41 27 24 40 18 33C12 26 38 14 52 19C61 22 55 36 63 35C71 34 72 20 80 21C88 22 84 35 93 33C103 31 106 15 117 18C126 21 119 37 133 30"></path><path d="M26 44C58 39 96 36 130 27"></path></svg>
        <span class="fg-ct fg-c-ink fg-c-sn fg-c-sn2" style="top: ${298 + cShift}px">${esc(text(sign2, 'name', ''))}</span>
        ${traced.map((f) => `<span class="fg-anc" data-anc-r="${esc(f.id)}" style="left: ${f.anchorR.x}px; top: ${f.anchorR.y}px"></span>`).join('')}
      </div>
    </figure>

    <aside class="fg-side">
      <section class="pz-card fg-zcard s-paper" aria-labelledby="fg-zt">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3 id="fg-zt">Soi nhanh từng ô</h3>
        <div class="fg-zgrid">${zones.map((z) => `<button type="button" class="fg-zbtn" data-zone="${esc(z.id)}">${esc(z.id === 'fold' ? z.name : `Ô ${z.name.toLowerCase()}`)}${z.traced ? zok : ''}</button>`).join('')}</div>
        <p class="fg-znote">Bàn phím: Tab tới một ô để đưa kính lúp tới, Enter để khoanh. Phím 1 · 2 · 3 đổi đèn.</p>
      </section>
      <article class="pz-card fg-ctx">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>${esc(text(cards, 'ctxTitle', 'Tài liệu trên bàn'))}</h3>
        <p>${esc(text(cards, 'ctxText', 'Bản lưu được gửi sang để đối chiếu với tài liệu này.'))}</p>
                <div class="fg-ctx-f"><span class="pz-tag mine">${esc(text(cards, 'ctxTag', 'RIÊNG · ĐIỀU TRA VIÊN'))}</span><svg class="fg-ctx-ic" viewBox="0 0 64 44" aria-hidden="true"><path d="M13 17L16 4.5L47 3L49.5 17" style="fill: #fbf6ed; stroke: #8a7350; stroke-width: 1.1; stroke-linejoin: round"></path><path d="M20 8.5H42M20.5 12.5H37" style="fill: none; stroke: #33408a; stroke-width: 1; stroke-linecap: round"></path><rect x="2" y="15" width="60" height="27" rx="2" style="fill: #6b4428; stroke: #3d2614; stroke-width: 1.2"></rect><rect x="6" y="19" width="52" height="19" rx="1.5" style="fill: #8a5a34; stroke: #3d2614; stroke-width: .8"></rect><rect x="23.5" y="25.5" width="17" height="5" rx="2.5" style="fill: #e4c77a; stroke: #5e4a1c; stroke-width: 1"></rect></svg></div>
      </article>
      <article class="pz-card fg-mate">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="fg-mate-h"><span class="g-mono rust" aria-hidden="true">${esc(text(cards, 'mateMono', 'TV'))}</span><span><b>${esc(text(cards, 'mateName', 'Đồng đội'))}</b> chia sẻ lời khai</span></div>
        <p class="fg-say">${esc(text(cards, 'mateLead', 'Nhân chứng khai:'))} <i>${esc(text(cards, 'mateText', 'giấy tờ được ký xong thì không ai ghi thêm dòng nào.'))}</i></p>
        <span class="pz-tag partner">${esc(text(cards, 'mateTag', 'ĐÃ CHIA SẺ · THẨM VẤN VIÊN'))}</span>
      </article>
    </aside>

    <svg class="fg-strings" data-fg="strings" aria-hidden="true">
      ${traced.map((_, i) => `<path class="fg-str sh s${(i % 3) + 1}" pathLength="1" transform="translate(2 5)" data-str="${i}"></path>`).join('')}
      ${traced.map((_, i) => `<path class="fg-str rd s${(i % 3) + 1}" pathLength="1" data-str="${i}"></path>`).join('')}
      ${traced.map((_, i) => `<circle class="fg-spin s${(i % 3) + 1}" r="5.5" fill="url(#fg-g-pin)" data-pin-e="${i}"></circle>`).join('')}
      ${traced.map((_, i) => `<circle class="fg-spin e${(i % 3) + 1}" r="5.5" fill="url(#fg-g-pin)" data-pin-r="${i}"></circle>`).join('')}
    </svg>`;

  const foot = body.closest('.pz-sheet')?.querySelector<HTMLElement>('.pz-foot');
  const actions = document.createElement('div');
  actions.className = 'pz-actions fg-actions';
  actions.innerHTML = '<button type="button" class="s-btn s-btn-gold s-btn-sm" data-fg="reset">Làm lại</button>';
  (foot ?? body).appendChild(actions);

  const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = body) => root.querySelector(sel) as T;
  const all = <T extends Element = HTMLElement>(sel: string, root: ParentNode = body) => [...root.querySelectorAll(sel)] as T[];
  const el = {
    mat: q('[data-fg="mat"]'), slot: q('[data-fg="slot"]'), col: q('[data-fg="col"]'), box: q('[data-fg="box"]'), env: q('[data-fg="env"]'),
    ref: q('[data-fg="ref"]'), lens: q('[data-fg="lens"]'), wob: q('[data-fg="wob"]'), handle: q('[data-fg="handle"]'), copy: q('[data-fg="copy"]'),
    flash: q('[data-fg="flash"]'), count: q('[data-fg="count"]'), reset: q<HTMLButtonElement>('[data-fg="reset"]', actions),
  };
  const lightBtns = all<HTMLButtonElement>('[data-light]');
  const dots = all('.fg-dots i');
  const zoneBtns = all<HTMLButtonElement>('[data-zone]');
  const circs = all<SVGPathElement>('[data-circ]');
  const tags = all('[data-tag]');
  const misses = all('[data-miss]');
  const strPaths = all<SVGPathElement>('[data-str]');
  const pinE = all<SVGCircleElement>('[data-pin-e]');
  const pinR = all<SVGCircleElement>('[data-pin-r]');

  // ---------- helpers ----------
  const later = (key: string, ms: number, fn: () => void) => { clearTimeout(timers[key]); timers[key] = window.setTimeout(() => { delete timers[key]; if (!dead) fn(); }, ms); };
  const clearTimers = () => { Object.keys(timers).forEach((key) => { clearTimeout(timers[key]); delete timers[key]; }); };
  const cancelRaf = () => { if (raf) cancelAnimationFrame(raf); raf = 0; pend = null; };
  const phaseN = () => ({ play: 0, join: 1, strings: 2, stamp: 3, won: 4 }[s.phase] || 0);
  const locked = () => phaseN() > 0 || ctx.solved;
  const marked = () => traced.filter((f) => s.marks[f.id]).length;
  let lastSay = '';
  function say(kick: string, msg: string, tone: PuzzleTone = 'info') {
    const key = `${kick}|${msg}|${tone}`;
    if (key === lastSay) return;
    lastSay = key;
    ctx.setStatus(`${kick} ${msg}`, tone);
    const status = body.closest('.pz-sheet')?.querySelector<HTMLElement>('.pz-status');
    if (!status) return;
    const b = document.createElement('b');
    b.textContent = kick;
    status.replaceChildren(b, document.createTextNode(` ${msg}`));
  }

  // ---------- measuring (lens mapping, phone scale, string anchors) ----------
  function fitK() {
    const slot = el.slot, col = el.col, box = el.box;
    if (!slot || !slot.clientWidth) return 0;
    let k = slot.clientWidth / W;
    if (!isPhone() && body.clientHeight) {
      const room = body.clientHeight - (col.offsetTop + box.offsetTop) - 16;
      if (room > 160) k = Math.min(k, room / H);
    }
    return Math.max(0.45, Math.min(1, Math.round(k * 1000) / 1000));
  }
  function joinGeo() {
    const { col, box, ref, mat } = el;
    if (isPhone() || !box.offsetWidth) return null;
    const k = box.offsetWidth / W;
    const envR = col.offsetLeft + box.offsetWidth;
    const envTop = col.offsetTop + box.offsetTop;
    // the document moves right a little (staying on the mat); the reference slides under its left edge
    const js = Math.max(0, Math.min(34, Math.round(mat.offsetLeft + mat.offsetWidth - 20 - envR)));
    const jx = Math.round(col.offsetLeft + js + 7 - (ref.offsetLeft + ref.offsetWidth));
    // the first altered row of the reference lines up with the document's, so the strings fan out between rows
    const yMain = firstTraced ? firstTraced.zone.cy : 240;
    const yRef = firstTraced ? firstTraced.anchorR.y : 160;
    const jy = Math.min(Math.round(envTop + yMain * k - (ref.offsetTop + yRef)), Math.round(mat.offsetTop + mat.offsetHeight - 16 - (ref.offsetTop + ref.offsetHeight)));
    return { jx, jy, js };
  }
  function measure() {
    const { col, box, ref, env } = el;
    const carbon = ref.querySelector<HTMLElement>('.fg-carbon');
    if (!carbon || !box.offsetWidth) return;
    const k = box.offsetWidth / W;
    const g = (phaseN() >= 1 && s.geo) || { js: 0, jx: 0, jy: 0 };
    const out: State['str'] = [];
    for (const f of traced) {
      const ea = env.querySelector<HTMLElement>(`.fg-mainmarks [data-anc-e="${CSS.escape(f.id)}"]`);
      const ra = carbon.querySelector<HTMLElement>(`[data-anc-r="${CSS.escape(f.id)}"]`);
      if (!ea || !ra) return;
      out.push({
        e: { x: Math.round(col.offsetLeft + g.js + box.offsetLeft + (ea.offsetLeft + 1) * k), y: Math.round(col.offsetTop + box.offsetTop + (ea.offsetTop + 1) * k) },
        r: { x: Math.round(ref.offsetLeft + g.jx + carbon.offsetLeft + ra.offsetLeft + 1), y: Math.round(ref.offsetTop + g.jy + carbon.offsetTop + ra.offsetTop + 1) },
      });
    }
    if (JSON.stringify(out) !== JSON.stringify(s.str)) setState({ str: out });
  }
  function relayout() {
    if (dead) return;
    const k = fitK();
    if (k && Math.abs(k - (s.k || 0)) > 0.002) { setState({ k }, relayout); return; }
    if (phaseN() < 1) return;
    const g = joinGeo();
    if (JSON.stringify(g) !== JSON.stringify(s.geo)) { setState({ geo: g }, measure); return; }
    measure();
  }

  // ---------- lens ----------
  function docPt(e: { clientX: number; clientY: number }) {
    const r = el.env.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = (e.clientX - r.left) * W / r.width;
    const y = (e.clientY - r.top) * H / r.height;
    return { x: Math.round(Math.min(LIM.x1, Math.max(LIM.x0, x)) * 10) / 10, y: Math.round(Math.min(LIM.y1, Math.max(LIM.y0, y)) * 10) / 10 };
  }
  function queueLens(x: number, y: number) {
    pend = { x, y };
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const pt = pend;
      pend = null;
      if (!pt || dead || locked()) return;
      if (pt.x === s.lx && pt.y === s.ly && !s.glide) return;
      setState({ lx: pt.x, ly: pt.y, glide: false });
    });
  }
  function zoneAt(x: number, y: number): string {
    for (const f of fields) if (x >= f.zone.x0 && x <= f.zone.x1 && y >= f.zone.y0 && y <= f.zone.y1) return f.id;
    if (x >= FOLD.x0 && x <= FOLD.x1 && y >= FOLD.y0 && y <= FOLD.y1) return 'fold';
    return '';
  }
  const fieldOf = (id: string) => fields.find((f) => f.id === id);
  const onEnvMove = (e: PointerEvent) => {
    if (locked()) return;
    if (e.pointerType && e.pointerType !== 'mouse' && !dragging) return;
    // a press that travels is a drag of the lens, not a click to mark
    if (dragging && d0 && Math.abs(e.clientX - d0.x) + Math.abs(e.clientY - d0.y) > 8) moved = true;
    const pt = docPt(e);
    if (pt) queueLens(pt.x, pt.y);
  };
  const onEnvDown = (e: PointerEvent) => {
    if (locked()) return;
    try { el.env.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragging = true;
    moved = false;
    d0 = { x: e.clientX, y: e.clientY };
    const pt = docPt(e);
    if (pt) queueLens(pt.x, pt.y);
  };
  const onEnvUp = (e: PointerEvent) => {
    dragging = false;
    try { if (el.env.hasPointerCapture(e.pointerId)) el.env.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onEnvClick = (e: MouseEvent) => {
    if (locked()) return;
    if (moved) { moved = false; return; }
    const pt = docPt(e);
    if (!pt) return;
    cancelRaf();
    examine(pt.x, pt.y, false);
  };

  /** mark whatever sits under the lens centre, under the current light */
  function examine(x: number, y: number, glide: boolean) {
    const z = zoneAt(x, y);
    const mk = { ...s.marks };
    const patch: Partial<State> = { lx: x, ly: y, glide };
    let didMark = false;
    const f = z && z !== 'fold' ? fieldOf(z) : undefined;
    if (f) {
      if (mk[f.id]) patch.msg = 'already';
      else if (f.light && f.light === s.light) { mk[f.id] = 2; patch.marks = mk; patch.msg = `mark-${f.id}`; didMark = true; }
      else { patch.msg = 'wrong'; patch.wob = s.wob === 1 ? 2 : 1; }
    } else {
      patch.msg = z === 'fold' ? 'decoy' : 'empty';
      patch.miss = s.miss === 1 ? 2 : 1;
      patch.mx = Math.round(x);
      patch.my = Math.round(y);
      later('miss', 1500, () => setState({ miss: 0 }));
    }
    setState(patch);
    if (didMark && traced.every((t) => mk[t.id])) later('join', reduce() ? 450 : 1350, startJoin);
  }
  function setLight(l: Light) {
    if (locked() || s.light === l) return;
    setState({ light: l, msg: l, fl: s.fl === 1 ? 2 : 1 });
  }
  function zoneCenter(id: string) {
    if (id === 'fold') return { x: FOLD.cx, y: FOLD.cy };
    const f = fieldOf(id)!;
    return { x: f.zone.cx, y: f.zone.cy };
  }
  function zoneFocus(id: string) {
    if (locked()) return;
    const c = zoneCenter(id);
    if (s.lx === c.x && s.ly === c.y) return;
    cancelRaf();
    setState({ lx: c.x, ly: c.y, glide: true });
  }
  function zonePress(id: string) {
    if (locked()) return;
    const c = zoneCenter(id);
    cancelRaf();
    examine(c.x, c.y, true);
  }

  // ---------- success: the lens lifts off, the documents slide together, strings, stamp, answer ----------
  function startJoin() {
    if (locked()) return;
    cancelRaf();
    const geo = joinGeo();
    if (reduce()) { setState({ phase: 'won', msg: 'join', light: 'normal', glide: false, geo }, measure); submit(); return; }
    setState({ phase: 'join', msg: 'join', light: 'normal', glide: false, geo }, measure);
    // the strings start when the documents have finished sliding (transitionend); this is the fallback
    later('strings', 1700, startStrings);
  }
  function startStrings() {
    if (s.phase !== 'join') return;
    measure();
    setState({ phase: 'strings' });
    later('stamp', 1300, () => { setState({ phase: 'stamp' }); submit(); });
  }
  const onMoved = (e: TransitionEvent) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
    if (s.phase === 'join') later('strings', 40, startStrings);
  };
  /** the marks go to the server once the stamp is down (the host then shows the card) */
  function submit() {
    if (submitted) return;
    submitted = true;
    const marks: Record<string, string> = {};
    traced.forEach((f) => { if (s.marks[f.id]) marks[f.id] = f.light; });
    ctx.submit({ marks }).then((result) => {
      if (dead) return;
      if (result.solved) { setState({ phase: 'won', msg: 'won' }); return; }
      submitted = false;
      unjoin(result.message || MSG.wrong);
    }).catch((error: any) => {
      if (dead) return;
      submitted = false;
      unjoin(error?.message || MSG.neterr);
    });
  }
  /** the server did not accept the answer: take the documents apart again, keep all but the last mark */
  function unjoin(message: string) {
    clearTimers();
    const marks = { ...s.marks };
    const last = traced[traced.length - 1];
    if (last) delete marks[last.id];
    setState({ phase: 'play', geo: null, str: null, marks, msg: 'server' });
    say(`ĐÃ KHOANH: ${marked()}/${need}`, message, 'bad');
  }
  function reset() {
    clearTimers();
    cancelRaf();
    submitted = false;
    lastSay = '';
    setState({ ...snap(), k: s.k });
  }

  // ---------- painting ----------
  const setCls = (node: Element, cls: string) => { if (node.getAttribute('class') !== cls) node.setAttribute('class', cls); };
  /** the body element belongs to the host: only add/remove this kind's own classes on it */
  let bodyClasses: string[] = [];
  function setBodyClasses(next: string[]) {
    bodyClasses.filter((c) => !next.includes(c)).forEach((c) => body.classList.remove(c));
    next.filter((c) => !bodyClasses.includes(c)).forEach((c) => body.classList.add(c));
    bodyClasses = next;
  }
  function paint() {
    const lx = s.lx, ly = s.ly, light = s.light, mk = s.marks, P = phaseN(), k = s.k || 0;
    const n = marked();
    const at = P === 0 ? zoneAt(lx, ly) : '';
    const on = (id: string) => (mk[id] === 2 ? 'is-on is-draw' : (mk[id] ? 'is-on' : ''));
    setBodyClasses(['fg-body', `lm-${light}`, P >= 1 ? 'is-join' : '', P >= 2 ? 'is-strings' : '', P >= 3 ? 'is-stamp' : '', s.stat ? 'is-static' : '', k && k < 0.9 ? 'is-small' : ''].filter(Boolean));
    if (k) { el.box.style.width = `${r1(W * k)}px`; el.box.style.height = `${r1(H * k)}px`; el.env.style.transform = `scale(${k})`; }
    else { el.box.style.width = ''; el.box.style.height = ''; el.env.style.transform = ''; }
    const geo = P >= 1 ? s.geo : null;
    el.col.style.transform = geo ? `translateX(${geo.js}px)` : 'none';
    el.ref.style.transform = geo ? `translate(${geo.jx}px, ${geo.jy}px)` : (P >= 1 ? 'none' : 'rotate(-1.4deg)');
    lightBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.light === light ? 'true' : 'false'));
    el.count.textContent = `${n}/${need}`;
    dots.forEach((d, i) => setCls(d, traced[i] && mk[traced[i].id] ? 'is-on' : ''));
    circs.forEach((c) => setCls(c, `fg-circ ${on(c.dataset.circ!)}`.trim()));
    tags.forEach((t) => setCls(t, `fg-tag ${on(t.dataset.tag!)}`.trim()));
    misses.forEach((m) => { setCls(m, ['fg-miss', s.miss === 1 ? 'ms-a' : s.miss === 2 ? 'ms-b' : ''].filter(Boolean).join(' ')); m.style.left = `${s.mx}px`; m.style.top = `${s.my}px`; });
    // the lens
    setCls(el.lens, ['fg-lens', `lm-${light}`, s.glide ? 'is-glide' : '', s.miss ? 'is-miss' : ''].filter(Boolean).join(' '));
    el.lens.style.transform = `translate(${r1(lx)}px, ${r1(ly)}px)`;
    el.copy.style.transform = `translate(${r1(100 - 2 * lx)}px, ${r1(100 - 2 * ly)}px) scale(2)`;
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    // the handle swings away from the right and bottom edges so it stays on the mat
    const fx = clamp01((lx - 0.5 * W) / (0.32 * W));
    const fy = clamp01((ly - 0.68 * H) / (0.18 * H));
    el.handle.style.transform = `rotate(${Math.round((45 + 90 * fx) * (1 - 2 * fy))}deg)`;
    setCls(el.wob, `fg-lens-w${s.wob === 1 ? ' wob-a' : s.wob === 2 ? ' wob-b' : ''}`);
    setCls(el.flash, `fg-flash${s.fl === 1 ? ' fx-a' : s.fl === 2 ? ' fx-b' : ''}`);
    // quick-zone buttons
    zoneBtns.forEach((b) => {
      const id = b.dataset.zone!;
      setCls(b, ['fg-zbtn', mk[id] ? 'is-done' : '', at === id ? 'is-at' : ''].filter(Boolean).join(' '));
      const name = id === 'fold' ? 'Nếp gấp giữa' : `Ô ${fieldOf(id)!.name.toLowerCase()}`;
      b.setAttribute('aria-label', `${name}${mk[id] ? ' — đã khoanh' : ' — đưa kính lúp tới, Enter để khoanh dưới đèn đang bật'}`);
      b.disabled = P > 0;
    });
    // strings
    const st = s.str;
    traced.forEach((_, i) => {
      const o = st && st[i];
      let d = 'M0 0';
      if (o) {
        const mx = Math.round((o.e.x + o.r.x) / 2);
        // the documents lie flat on the desk, so the strings are nearly taut (a little slack only)
        const my = Math.round((o.e.y + o.r.y) / 2 + 4 + Math.abs(o.e.x - o.r.x) * 0.03);
        d = `M${o.e.x} ${o.e.y}Q${mx} ${my} ${o.r.x} ${o.r.y}`;
      }
      strPaths.filter((pth) => pth.dataset.str === String(i)).forEach((pth) => pth.setAttribute('d', d));
      pinE[i]?.setAttribute('cx', String(o ? o.e.x : -40)); pinE[i]?.setAttribute('cy', String(o ? o.e.y : -40));
      pinR[i]?.setAttribute('cx', String(o ? o.r.x : -40)); pinR[i]?.setAttribute('cy', String(o ? o.r.y : -40));
    });
    el.reset.disabled = (P > 0) || (P === 0 && n === 0 && light === 'normal' && !s.miss) || ctx.solved;
    if (s.msg !== 'server') say(`ĐÃ KHOANH: ${n}/${need}`, MSG[s.msg] || '', s.msg === 'won' || s.msg.startsWith('mark-') ? 'ok' : 'info');
  }

  // ---------- wiring ----------
  const onBodyClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const lb = t.closest<HTMLButtonElement>('[data-light]');
    if (lb) { setLight(lb.dataset.light as Light); return; }
    const zb = t.closest<HTMLButtonElement>('[data-zone]');
    if (zb) zonePress(zb.dataset.zone!);
  };
  const onFocusIn = (e: FocusEvent) => { const zb = (e.target as HTMLElement).closest<HTMLElement>('[data-zone]'); if (zb) zoneFocus(zb.dataset.zone!); };
  const sheet = body.closest<HTMLElement>('.pz-veil') ?? body;
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) setLight(LIGHTS[i]);
  };
  const onReset = (e: Event) => { e.preventDefault(); reset(); };
  el.env.addEventListener('pointerdown', onEnvDown);
  el.env.addEventListener('pointermove', onEnvMove);
  el.env.addEventListener('pointerup', onEnvUp);
  el.env.addEventListener('pointercancel', onEnvUp);
  el.env.addEventListener('click', onEnvClick);
  el.col.addEventListener('transitionend', onMoved);
  el.ref.addEventListener('transitionend', onMoved);
  body.addEventListener('click', onBodyClick);
  body.addEventListener('focusin', onFocusIn);
  sheet.addEventListener('keydown', onKey);
  el.reset.addEventListener('click', onReset);
  let ro: ResizeObserver | null = null;
  try { ro = new ResizeObserver(() => relayout()); ro.observe(el.slot); ro.observe(body); } catch { ro = null; }
  const onFonts = () => relayout();
  document.fonts?.ready.then(() => { if (!dead) onFonts(); }).catch(() => undefined);

  function showSolved() {
    const marks: Record<string, number> = {};
    traced.forEach((f) => { marks[f.id] = 1; });
    setState({ marks, phase: 'won', msg: 'won', light: 'normal', stat: true, glide: false });
    s = { ...s, geo: joinGeo() };
    paint();
    measure();
  }
  if (ctx.solved) showSolved(); else paint();
  relayout();

  return {
    update(next) {
      ctx = next;
      if (next.solved && phaseN() === 0) { clearTimers(); cancelRaf(); showSolved(); return; }
      paint();
    },
    unmount() {
      dead = true;
      clearTimers();
      cancelRaf();
      ro?.disconnect();
      el.env.removeEventListener('pointerdown', onEnvDown);
      el.env.removeEventListener('pointermove', onEnvMove);
      el.env.removeEventListener('pointerup', onEnvUp);
      el.env.removeEventListener('pointercancel', onEnvUp);
      el.env.removeEventListener('click', onEnvClick);
      el.col.removeEventListener('transitionend', onMoved);
      el.ref.removeEventListener('transitionend', onMoved);
      body.removeEventListener('click', onBodyClick);
      body.removeEventListener('focusin', onFocusIn);
      sheet.removeEventListener('keydown', onKey);
      el.reset.removeEventListener('click', onReset);
      actions.remove();
      setBodyClasses([]);
      body.innerHTML = '';
    },
  };
}

const docForgery: PuzzleKindModule = {
  kind: 'doc_forgery',
  label: { en: 'Document forgery', vi: 'Soi tài liệu' },
  mount,
};

export default docForgery;
