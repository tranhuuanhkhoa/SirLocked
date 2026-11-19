/**
 * P5 · Hộp nhạc lên dây (port of design/project/PuzzleMusicBox.dc.html, prefix mb-).
 * One pin per beat on the brass drum; turning the crank plays the tune. The client never knows the
 * melody: every play is a server probe ({pins} → {firstWrong}) and the drum stops at that beat. When a
 * play runs clean the box coasts, the hidden drawer opens and the pins are submitted.
 */
import './music_box.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleTone } from '../types';

const NAMES = ['', 'LA', 'SON', 'MI', 'RÊ', 'ĐỒ'];
const LOWER = ['', 'la', 'son', 'mi', 'rê', 'đồ'];
/** note-head y on the little staves of the score strip, per row */
const STAFF = [0, 22, 25, 31, 34, 37];
/** note-head y on the postcard staff (lines at 42…70), per row: A4 G4 E4 D4 C4 */
const POST_Y = [0, 59.5, 63, 70, 73.5, 77];
const LEAD = 0.75; // a column reaches the comb 0.75 beat after it starts moving
const STEP = 90; // crank degrees per beat

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const text = (obj: any, key: string, fallback: string) => (obj && typeof obj[key] === 'string' && obj[key].trim() ? obj[key] : fallback);

type Phase = 'set' | 'play' | 'fail' | 'rewind' | 'coast' | 'open';
interface Note { r: number; ok: boolean }
interface Slot { r: number; bad: boolean; echo: boolean; n: number }
interface State {
  pins: number[]; cur: { c: number; r: number }; t: number; dur: number; ease: string; phase: Phase;
  played: number; notes: (Note | null)[]; bad: number; failEmpty: boolean; toothV: number[]; toothBad: number;
  slots: (Slot | null)[]; slotN: number; shakeN: number; popN: number[]; ghost: ({ r: number; n: number } | null)[];
  msg: string; msgC: number; moved: boolean; solved: boolean; dragging: boolean;
}

function mount(body: HTMLElement, ctx0: PuzzleContext): PuzzleKindHandle {
  let ctx = ctx0;
  const p = ctx.params ?? {};
  const N = Math.max(4, Math.min(8, Number(p.beats) || 8));
  const known: number[] = Array.from({ length: N }, (_, i) => Number(p.known?.[i]) || 0);
  const beatMs = Math.max(260, Math.min(900, Number(p.beatMs) || 520));
  const post = p.postcard ?? {};
  const wit = p.witness ?? {};
  const firstHidden = known.findIndex((row) => !row);
  const hiddenCount = known.filter((row) => !row).length;
  const plaque = text(p, 'plaque', 'Nº 9');
  const keyMark = text(p, 'keyMark', '9');
  const reduced = () => ctx.reducedMotion;
  const timers: number[] = [];
  let raf = 0;
  let drag: { id: number; cx: number; cy: number; a: number; x: number; y: number } | null = null;
  let anim: { from: number; to: number; start: number; dur: number } | null = null;
  let wantFocus = false;
  let dead = false;
  /** verdict of the play in progress: null while the probe is on its way */
  let verdict: { firstWrong: number } | null = null;
  let waiting: { c: number; auto: boolean } | null = null;
  let playToken = 0;

  const blank = (): State => ({
    pins: Array(N + 1).fill(0), cur: { c: 1, r: 3 }, t: 0, dur: 0, ease: 'linear', phase: 'set', played: 0,
    notes: Array(N).fill(null), bad: 0, failEmpty: false, toothV: [0, 0, 0, 0, 0, 0], toothBad: 0,
    slots: [null, null, null, null], slotN: 0, shakeN: 0, popN: Array(N + 1).fill(0), ghost: Array(N + 1).fill(null),
    msg: 'fresh', msgC: 0, moved: false, solved: false, dragging: false,
  });
  const m: State = blank();

  // ---------- markup ----------
  const cell = (c: number, r: number) =>
    `<button type="button" class="mb-cell r${r}" data-cell="${c}-${r}" tabindex="-1" aria-label="Nhịp ${c} · ${NAMES[r]}" aria-pressed="false"><i class="mb-hole"></i><i class="mb-pin"></i></button>`;
  const dupCol = (c: number) =>
    `<div class="mb-col" aria-hidden="true"><span class="mb-num">${c}</span>${[1, 2, 3, 4, 5].map((r) => `<i class="mb-cell" data-dup="${c}-${r}"><i class="mb-hole"></i><i class="mb-pin"></i></i>`).join('')}<i class="mb-gear"></i></div>`;
  const realCols = Array.from({ length: N }, (_, i) => i + 1).map((c) =>
    `<div class="mb-col" data-col="${c}"><span class="mb-num" aria-hidden="true">${c}</span>${[1, 2, 3, 4, 5].map((r) => cell(c, r)).join('')}<i class="mb-ghost" data-ghost="${c}" aria-hidden="true"></i><i class="mb-gear" aria-hidden="true"></i></div>`).join('');
  const dupCols = [...Array.from({ length: N }, (_, i) => i + 1), 1, 2].map(dupCol).join('');
  const scoreItem = (i: number) => `
    <li class="mb-sc" data-sc="${i}">
      <span class="mb-sc-i" aria-hidden="true">${i + 1}</span>
      <svg class="mb-sc-st" viewBox="0 0 44 42" aria-hidden="true">
        <path class="mb-sc-ln" d="M2 7H42M2 13H42M2 19H42M2 25H42M2 31H42"></path>
        <path class="mb-sc-led" d="M14 37H30"></path>
        <g class="mb-sc-nt"><g class="mb-sc-tl"><g class="mb-sc-in"><ellipse class="mb-sc-head" cx="22" cy="0" rx="4.7" ry="3.4" transform="rotate(-20 22 0)"></ellipse><path class="mb-sc-stem" d="M26.2 -1.2 V-18"></path></g></g></g>
        <path class="mb-sc-rest" d="M19 10 L25.5 16.5 L19.5 22 L25.5 28 Q19 26.5 20.5 34"></path>
      </svg>
      <span class="mb-sc-n" aria-hidden="true"></span>
      <span class="s-sr"></span>
    </li>`;
  const glyph = '<svg viewBox="0 0 20 32" aria-hidden="true"><path d="M11.4 25 V3 H13.8 C14.4 8 19.8 9.6 18.8 16.4 C17.8 12.8 15.8 11.8 13.8 11.4 V25 Z"></path><ellipse cx="7.2" cy="25.4" rx="6.2" ry="4.5" transform="rotate(-22 7.2 25.4)"></ellipse></svg>';

  body.classList.add('mb-host');
  body.innerHTML = `
    <aside class="mb-clues" aria-label="${esc(ctx.tr('Clues for the music box', 'Manh mối cho hộp nhạc'))}">
      <article class="pz-card s-paper mb-card-a">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <span class="pz-tag mine" style="margin-top: 0">${esc(text(post, 'tag', 'RIÊNG · ĐIỀU TRA VIÊN'))}</span>
        <h3 style="margin-top: 4px">${esc(text(post, 'title', 'Bưu thiếp kẹp trong nắp hộp'))}</h3>
        ${postcardSvg()}
        <p>${esc(text(post, 'caption', firstHidden >= 0 ? `Dòng nhạc bị nước làm nhòe từ nốt thứ ${firstHidden + 1}.` : 'Dòng nhạc trên bưu thiếp.'))}</p>
      </article>
      <article class="pz-card s-paper mb-card-b">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="mb-from"><span class="g-mono rust" aria-hidden="true">${esc(text(wit, 'mono', 'TV'))}</span><span class="pz-tag partner" style="margin-top: 0">${esc(text(wit, 'tag', 'ĐÃ CHIA SẺ · THẨM VẤN VIÊN'))}</span></div>
        <p class="mb-qlead">${esc(text(wit, 'lead', 'Bà chủ trọ ngân nga:'))}</p>
        <p class="mb-quote">${esc(text(p, 'quote', '‘…’'))}</p>
      </article>
      <article class="pz-card s-paper mb-card-c">
        <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <h3>Năm lưỡi gảy của hộp</h3>
                <svg class="mb-ladder" viewBox="0 0 250 58" role="img" aria-label="Thang nốt của hộp, từ thấp đến cao: ĐỒ, RÊ, MI, SON, LA.">
                  <rect x="6" y="44" width="44" height="12" fill="#e9dcc0" stroke="#8a7a5c" stroke-width=".9"></rect><path d="M6 44.6H50" stroke="#c7a24b" stroke-width="1.6"></path><text x="28" y="39" class="mb-lad-t">ĐỒ</text>
                  <rect x="54" y="36" width="44" height="20" fill="#e9dcc0" stroke="#8a7a5c" stroke-width=".9"></rect><path d="M54 36.6H98" stroke="#c7a24b" stroke-width="1.6"></path><text x="76" y="31" class="mb-lad-t">RÊ</text>
                  <rect x="102" y="28" width="44" height="28" fill="#e9dcc0" stroke="#8a7a5c" stroke-width=".9"></rect><path d="M102 28.6H146" stroke="#c7a24b" stroke-width="1.6"></path><text x="124" y="23" class="mb-lad-t">MI</text>
                  <rect x="150" y="20" width="44" height="36" fill="#e9dcc0" stroke="#8a7a5c" stroke-width=".9"></rect><path d="M150 20.6H194" stroke="#c7a24b" stroke-width="1.6"></path><text x="172" y="15" class="mb-lad-t">SON</text>
                  <rect x="198" y="12" width="44" height="44" fill="#e9dcc0" stroke="#8a7a5c" stroke-width=".9"></rect><path d="M198 12.6H242" stroke="#c7a24b" stroke-width="1.6"></path><text x="220" y="7" class="mb-lad-t">LA</text>
                  <path d="M6 57.4H240" stroke="#5b5248" stroke-width="1"></path>
                </svg>
        <p>ĐỒ thấp nhất, LA cao nhất.</p>
      </article>
    </aside>

    <section class="mb-sec" aria-label="${esc(ctx.title)}">
      <div class="mb-mat">
        <div class="mb-wrap">
          <div class="mb-rig" data-mb="rig" style="--beats: ${N}">
            <div class="mb-top">
              <div class="mb-score">
                <span class="mb-score-k"><span>BẢN NHẠC</span><small data-mb="cap"></small></span>
                <ol class="mb-sc-list" aria-label="Bản nhạc vừa chơi">${Array.from({ length: N }, (_, i) => scoreItem(i)).join('')}</ol>
              </div>
              <p class="mb-keys" aria-hidden="true"><span><span class="pz-kbd">← ↑ → ↓</span>chọn lỗ</span><span><span class="pz-kbd">Space</span>cắm / rút chốt</span><span><span class="pz-kbd">P</span>quay thử</span></p>
            </div>
                    <div class="mb-lid" aria-hidden="true">
                      <svg class="mb-lid-svg" viewBox="0 0 676 84" preserveAspectRatio="none" aria-hidden="true">
                      <defs>
                        <linearGradient id="mb-g-lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0f09"></stop><stop offset=".55" stop-color="#43190f"></stop><stop offset="1" stop-color="#2c100a"></stop></linearGradient>
                        <radialGradient id="mb-g-lidv" cx=".5" cy=".55" r=".7"><stop offset="0" stop-color="#7b1c23"></stop><stop offset=".7" stop-color="#4b0f15"></stop><stop offset="1" stop-color="#2a070b"></stop></radialGradient>
                        <linearGradient id="mb-g-gloss" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd2b0" stop-opacity="0"></stop><stop offset=".5" stop-color="#ffd2b0" stop-opacity=".2"></stop><stop offset="1" stop-color="#ffd2b0" stop-opacity="0"></stop></linearGradient>
                      </defs>
                      <path d="M30 0 H646 L676 84 H0 Z" fill="url(#mb-g-lid)"></path>
                      <path d="M120 3 H300 L290 9 H112 Z" fill="url(#mb-g-gloss)"></path>
                      <path d="M52 11 H624 L650 78 H26 Z" fill="url(#mb-g-lidv)"></path>
                      <path d="M52 11 H624 L650 78 H26 Z" fill="none" stroke="rgba(0,0,0,.6)" stroke-width="2"></path>
                      <path d="M57 15 H619 L643 74 H33 Z" fill="none" stroke="#c7a24b" stroke-opacity=".55" stroke-width="1.2"></path>
                      <path d="M30 .6 H646" stroke="rgba(255,200,170,.25)" stroke-width="1.2"></path>
                      <path d="M0 83.4 H676" stroke="rgba(0,0,0,.7)" stroke-width="1.4"></path>
                      <path d="M454 20 L470 31 L466 44" fill="none" stroke="rgba(255,210,190,.12)" stroke-width="1"></path>
                    </svg>
                      <i class="mb-lid-card"></i>
                      <svg class="mb-lid-clip" viewBox="0 0 26 22" aria-hidden="true"><path d="M3 4 H23 V9 Q23 12 20 12 H6 Q3 12 3 9 Z" fill="#c7a24b" stroke="#4a3810" stroke-width=".8"></path><path d="M7 12 V19 Q7 21 9 21 H17 Q19 21 19 19 V12" fill="none" stroke="#d8b864" stroke-width="1.6"></path><circle cx="13" cy="7.6" r="1.6" fill="#4a3810"></circle><path d="M5 5 H21" stroke="rgba(255,244,210,.6)" stroke-width=".8"></path></svg>
                      <svg class="mb-plaque" viewBox="0 0 86 36" aria-hidden="true">
                      <defs><linearGradient id="mb-g-plq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3dc95"></stop><stop offset=".55" stop-color="#c39b47"></stop><stop offset="1" stop-color="#6e5420"></stop></linearGradient></defs>
                      <ellipse cx="43" cy="18" rx="41" ry="16" fill="url(#mb-g-plq)" stroke="#3a2c10" stroke-width="1"></ellipse>
                      <ellipse cx="43" cy="18" rx="36" ry="12.5" fill="none" stroke="rgba(58,42,12,.55)" stroke-width=".8" stroke-dasharray="1.4 1.6"></ellipse>
                      <path d="M20 11.5 a6.5 6.5 0 1 0 0 13 a5 5 0 1 1 0 -13 z" fill="#5e4a1c"></path>
                      <circle cx="25.5" cy="13.5" r="1.1" fill="#5e4a1c"></circle>
                      <text x="49" y="22.6" text-anchor="middle" class="mb-plq-t">${esc(plaque)}</text>
                    </svg>
                      <svg class="mb-sprig" viewBox="0 0 70 66" aria-hidden="true">
                      <path d="M8 62 C18 48 24 34 26 14 M24 40 C34 36 40 28 44 18 M20 50 C30 50 40 46 50 38 M26 26 C20 20 18 14 18 6" fill="none" stroke="#9a8a68" stroke-width="1.2" stroke-linecap="round"></path>
                      <path d="M30 32 q6 -6 10 -2 q-4 6 -10 2 z M18 44 q-2 -8 4 -10 q2 8 -4 10 z" fill="#6f6a4c" opacity=".8"></path>
                      <g fill="#b8a07a"><circle cx="26" cy="13" r="2.6"></circle><circle cx="23.5" cy="11" r="2.1"></circle><circle cx="28.5" cy="11" r="2.1"></circle></g>
                      <g fill="#9c6b70"><circle cx="44" cy="17" r="2.4"></circle><circle cx="41.8" cy="15" r="1.9"></circle><circle cx="46.2" cy="15.2" r="1.9"></circle></g>
                      <g fill="#c9b48c"><circle cx="18" cy="5.5" r="2.2"></circle><circle cx="50.5" cy="37.5" r="2.2"></circle><circle cx="52.6" cy="35.4" r="1.6"></circle></g>
                    </svg>
                    </div>

            <div class="mb-body">
              <i class="mb-hinge l" aria-hidden="true"></i><i class="mb-hinge r" aria-hidden="true"></i>
              <div class="mb-bay">
                <i class="mb-screw" aria-hidden="true" style="left: 3px; top: 3px"></i><i class="mb-screw" aria-hidden="true" style="left: 3px; bottom: 3px"></i>
                <div class="mb-combcol">
                  <span class="mb-bay-k" aria-hidden="true">NHỊP</span>
                  <div class="mb-comb" data-mb="comb">
                    <i class="mb-comb-sh" aria-hidden="true"></i>
                    <i class="mb-comb-base" aria-hidden="true"></i>
                    <i class="mb-screw" aria-hidden="true" style="top: 22%"></i><i class="mb-screw" aria-hidden="true" style="top: 74%"></i>
                    ${[1, 2, 3, 4, 5].map((r) => `<span class="mb-lab r${r}" aria-hidden="true">${NAMES[r]}</span>`).join('')}
                    ${[1, 2, 3, 4, 5].map((r) => `<i class="mb-tooth r${r}" data-tooth="${r}" aria-hidden="true"><i class="mb-tip"></i></i>`).join('')}
                  </div>
                </div>
                <div class="mb-drumwrap">
                  <div class="mb-drum" role="group" aria-label="Trục đồng: ${N} nhịp, mỗi nhịp 5 lỗ ứng với 5 nốt" aria-describedby="mb-help">
                    <div class="mb-face">
                      <div class="mb-strip" data-mb="strip">${realCols}${dupCols}</div>
                    </div>
                    <i class="mb-shade" aria-hidden="true"></i>
                    <i class="mb-pline" aria-hidden="true"></i>
                  </div>
                  <div class="mb-fx" aria-hidden="true">
                    ${[0, 1, 2, 3].map((i) => `<div class="mb-slot" data-slot="${i}"><i class="mb-ring"></i><i class="mb-ring b"></i><span class="mb-glyph"><span class="mb-gtilt">${glyph}<b></b></span></span></div>`).join('')}
                    <i class="mb-flash" data-mb="flash"></i>
                  </div>
                </div>
                        <div class="mb-fly" aria-hidden="true">
                          <svg class="mb-fan" viewBox="0 0 30 30" aria-hidden="true"><path d="M15 13.2 L27.6 10.6 Q29.6 15 27.6 19.4 L15 16.8 Z M15 13.2 L2.4 10.6 Q.4 15 2.4 19.4 L15 16.8 Z" fill="#c9a24e" stroke="#4a3810" stroke-width=".8"></path><path d="M16 13.6 L27 11.4 M14 13.6 L3 11.4" stroke="rgba(255,244,210,.65)" stroke-width=".7"></path><circle cx="15" cy="15" r="3.2" fill="#8a6a28" stroke="#3a2c10" stroke-width=".8"></circle></svg>
                          <i class="mb-worm"></i>
                        </div>
              </div>
                      <div class="mb-comp" aria-hidden="true">
                        <i class="mb-orn-sh"></i>
                        <i class="mb-spindle"></i>
                        <svg class="mb-orn-base" viewBox="0 0 48 26" aria-hidden="true"><defs><linearGradient id="mb-g-obase" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5e4a1c"></stop><stop offset=".4" stop-color="#f3dc95"></stop><stop offset=".75" stop-color="#b38a34"></stop><stop offset="1" stop-color="#4a3810"></stop></linearGradient></defs><ellipse cx="24" cy="18" rx="22" ry="7" fill="url(#mb-g-obase)" stroke="#3a2c10" stroke-width=".8"></ellipse><path d="M10 16 Q24 2 38 16" fill="url(#mb-g-obase)" stroke="#3a2c10" stroke-width=".8"></path><ellipse cx="24" cy="7" rx="4" ry="2" fill="#f3dc95" stroke="#3a2c10" stroke-width=".6"></ellipse></svg>
                        <div class="mb-orn">
                          <div class="mb-orn-plate" data-mb="orn">
                          <svg viewBox="0 0 96 118" aria-hidden="true">
                            <defs>
                              <linearGradient id="mb-g-orn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0bd"></stop><stop offset=".35" stop-color="#e3c071"></stop><stop offset=".7" stop-color="#a77f30"></stop><stop offset="1" stop-color="#5e4a1c"></stop></linearGradient>
                              <mask id="mb-m-cres" maskUnits="userSpaceOnUse" x="0" y="0" width="96" height="118"><rect x="0" y="0" width="96" height="118" fill="#fff"></rect><circle cx="57" cy="52" r="31" fill="#000"></circle></mask>
                            </defs>
                            <g mask="url(#mb-m-cres)">
                              <circle cx="42" cy="52" r="38" fill="url(#mb-g-orn)" stroke="#4a3810" stroke-width="1.4"></circle>
                              <circle cx="42" cy="52" r="33" fill="none" stroke="rgba(74,56,16,.55)" stroke-width="1" stroke-dasharray="1.2 3.2"></circle>
                              <path d="M14 40 Q10 56 18 70" fill="none" stroke="rgba(255,250,225,.6)" stroke-width="2" stroke-linecap="round"></path>
                            </g>
                            <circle cx="57" cy="52" r="31" fill="none" stroke="#4a3810" stroke-width="1.2" mask="url(#mb-m-cres)"></circle>
                            <path d="M65.6 22.2 L67.4 27 L69.6 31.6 L71 36 L72 40.5" fill="none" stroke="#c7a24b" stroke-width="1" stroke-dasharray="1.6 1.2"></path>
                            <path d="M72 41 L74.6 48.4 L82.4 48.6 L76.2 53.4 L78.4 61 L72 56.6 L65.6 61 L67.8 53.4 L61.6 48.6 L69.4 48.4 Z" fill="url(#mb-g-orn)" stroke="#4a3810" stroke-width="1"></path>
                            <circle cx="42" cy="91" r="3.4" fill="#c7a24b" stroke="#4a3810" stroke-width=".8"></circle>
                          </svg>
                          </div>
                        </div>
                      </div>
            </div>

                    <div class="mb-crank" data-mb="crank" aria-hidden="true">
                      <svg viewBox="0 0 124 124" aria-hidden="true">
                        <defs>
                          <radialGradient id="mb-g-ros" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#f6e2a2"></stop><stop offset=".6" stop-color="#b58d3c"></stop><stop offset="1" stop-color="#5e4a1c"></stop></radialGradient>
                          <linearGradient id="mb-g-arm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6e5420"></stop><stop offset=".35" stop-color="#f6e2a2"></stop><stop offset=".7" stop-color="#c49b45"></stop><stop offset="1" stop-color="#5e4a1c"></stop></linearGradient>
                          <radialGradient id="mb-g-knob" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#8a4a2a"></stop><stop offset=".55" stop-color="#4a1f12"></stop><stop offset="1" stop-color="#1e0b05"></stop></radialGradient>
                        </defs>
                        <circle class="mb-cpath" cx="62" cy="62" r="56"></circle>
                        <path class="mb-carrow" d="M106.6 27.4 L113.6 22.4 L114.4 31.8 Z"></path>
                        <path class="mb-carrow" d="M17.4 96.6 L10.4 101.6 L9.6 92.2 Z"></path>
                        <circle cx="62" cy="64" r="24" fill="rgba(0,0,0,.45)"></circle>
                        <circle cx="62" cy="62" r="23" fill="url(#mb-g-ros)" stroke="#3a2c10" stroke-width="1"></circle>
                        <circle cx="62" cy="62" r="17" fill="none" stroke="rgba(58,42,12,.5)" stroke-width=".8" stroke-dasharray="1.4 1.8"></circle>
                        <circle cx="62" cy="44" r="1.8" fill="#3a2c10"></circle><circle cx="80" cy="62" r="1.8" fill="#3a2c10"></circle><circle cx="62" cy="80" r="1.8" fill="#3a2c10"></circle><circle cx="44" cy="62" r="1.8" fill="#3a2c10"></circle>
                        <g class="mb-arm" data-mb="arm">
                          <path d="M57 64 L59 20 Q62 15 65 20 L67 64 Z" fill="rgba(0,0,0,.35)" transform="translate(3 4)"></path>
                          <path d="M56.5 64 L58.6 20 Q62 14.5 65.4 20 L67.5 64 Z" fill="url(#mb-g-arm)" stroke="#3a2c10" stroke-width=".9"></path>
                          <circle cx="62" cy="16" r="12.5" fill="rgba(0,0,0,.4)" transform="translate(2 4)"></circle>
                          <circle cx="62" cy="16" r="12" fill="url(#mb-g-knob)" stroke="#120604" stroke-width="1"></circle>
                          <ellipse cx="58" cy="11.5" rx="4.6" ry="2.8" fill="rgba(255,214,180,.32)"></ellipse>
                        </g>
                        <circle cx="62" cy="62" r="9" fill="url(#mb-g-ros)" stroke="#3a2c10" stroke-width="1"></circle>
                        <path d="M57.5 59.5 L66.5 64.5" stroke="#3a2c10" stroke-width="1.4"></path>
                      </svg>
                      <span class="mb-crank-cap">TAY QUAY ↻</span>
                    </div>

                    <div class="mb-front" aria-hidden="true">
                      <i class="mb-foot l"></i><i class="mb-foot r"></i>
                      <span class="mb-cach">cạch!</span>
                      <div class="mb-dwin">
                        <div class="mb-dslide">
                          <div class="mb-tray">
                            <div class="mb-key">
                          <svg viewBox="0 0 100 36" aria-hidden="true">
                            <defs><linearGradient id="mb-g-key" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0bd"></stop><stop offset=".45" stop-color="#d4ae58"></stop><stop offset="1" stop-color="#6e5420"></stop></linearGradient></defs>
                            <ellipse cx="52" cy="27" rx="44" ry="6" fill="rgba(0,0,0,.45)"></ellipse>
                            <path d="M28 15.5 H84 V20.5 H28 Z" fill="url(#mb-g-key)" stroke="#3a2c10" stroke-width=".8"></path>
                            <path d="M72 20.5 H86 V30 H82 V25.5 H78 V30 H74 V24 H72 Z" fill="url(#mb-g-key)" stroke="#3a2c10" stroke-width=".8"></path>
                            <path d="M84 15.5 Q88 18 84 20.5" fill="url(#mb-g-key)" stroke="#3a2c10" stroke-width=".8"></path>
                            <circle cx="17" cy="18" r="13" fill="url(#mb-g-key)" stroke="#3a2c10" stroke-width=".9"></circle>
                            <circle cx="17" cy="18" r="9.5" fill="none" stroke="rgba(58,42,12,.5)" stroke-width=".8"></circle>
                            <circle cx="6.5" cy="18" r="2" fill="#2a070b"></circle>
                            <text x="18.5" y="22.6" text-anchor="middle" font-family="'Playfair Display', Georgia, serif" font-size="13" font-weight="700" fill="#3a2a0c">${esc(keyMark)}</text>
                            <path d="M30 16.4 H82" stroke="rgba(255,250,225,.7)" stroke-width=".8"></path>
                          </svg>
                              <svg class="mb-glint" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0 L9.2 6.8 L16 8 L9.2 9.2 L8 16 L6.8 9.2 L0 8 L6.8 6.8 Z" fill="#fffbe6"></path></svg>
                            </div>
                          </div>
                          <div class="mb-dfront"></div>
                        </div>
                      </div>
                    </div>
            <div class="mb-room" aria-hidden="true"></div>
          </div>
        </div>
        <p id="mb-help" class="s-sr">Dùng phím mũi tên để chọn lỗ trên trục đồng; phím cách hoặc Enter để cắm hoặc rút chốt; Delete để rút chốt của nhịp đang chọn; phím P để quay thử. Mỗi nhịp chỉ giữ một chốt. Có thể kéo tay quay bên phải hộp theo chiều kim đồng hồ.</p>
      </div>
    </section>`;

  // footer actions live next to the host's status line (the mockup's footer)
  const foot = body.closest('.pz-sheet')?.querySelector<HTMLElement>('.pz-foot');
  const actions = document.createElement('div');
  actions.className = 'pz-actions mb-actions';
  actions.style.alignItems = 'center';
  actions.innerHTML = `
    <span class="mb-tries" data-mb="tries">Lần quay: 0</span>
    <button type="button" class="s-btn s-btn-gold s-btn-sm mb-btn-off" data-mb="clear" aria-disabled="true">Gỡ hết chốt</button>
    <button type="button" class="s-btn s-btn-red mb-play" data-mb="play" aria-disabled="true" aria-keyshortcuts="P">Quay thử <span class="pz-kbd" aria-hidden="true">P</span></button>`;
  (foot ?? body).appendChild(actions);

  const q = <T extends Element = HTMLElement>(sel: string, root: ParentNode = body) => root.querySelector(sel) as T;
  const el = {
    rig: q('[data-mb="rig"]'), cap: q('[data-mb="cap"]'), comb: q('[data-mb="comb"]'), strip: q('[data-mb="strip"]'),
    flash: q('[data-mb="flash"]'), orn: q('[data-mb="orn"]'), arm: q<SVGGElement>('[data-mb="arm"]'), crank: q('[data-mb="crank"]'),
    drum: q('.mb-drum'), tries: q('[data-mb="tries"]', actions), clear: q('[data-mb="clear"]', actions), play: q('[data-mb="play"]', actions),
  };
  const cells = new Map<string, HTMLButtonElement>();
  body.querySelectorAll<HTMLButtonElement>('button.mb-cell').forEach((b) => cells.set(b.dataset.cell!, b));
  const dups = [...body.querySelectorAll<HTMLElement>('[data-dup]')];
  const cols = [...body.querySelectorAll<HTMLElement>('[data-col]')];
  const ghosts = [...body.querySelectorAll<HTMLElement>('[data-ghost]')];
  const scores = [...body.querySelectorAll<HTMLElement>('[data-sc]')];
  const teeth = [...body.querySelectorAll<HTMLElement>('[data-tooth]')];
  const slotEls = [...body.querySelectorAll<HTMLElement>('[data-slot]')];

  function postcardSvg() {
    const span = N > 1 ? 175 / (N - 1) : 0;
    const xs = Array.from({ length: N }, (_, i) => Math.round((36 + i * span) * 10) / 10);
    const shown = known.map((row, i) => ({ row, x: xs[i] })).filter((note) => note.row);
    const hidden = known.map((row, i) => ({ row, x: xs[i] })).filter((note) => !note.row);
    const heads = shown.map((n) => `<ellipse cx="${n.x}" cy="${POST_Y[n.row]}" rx="4.6" ry="3.3" transform="rotate(-20 ${n.x} ${POST_Y[n.row]})"></ellipse>`).join('');
    const ledgers = shown.filter((n) => n.row === 5).map((n) => `M${n.x - 7} 77H${n.x + 7}`).join('');
    const stems = shown.map((n) => `M${n.x + 4.2} ${POST_Y[n.row] - 1} V${POST_Y[n.row] - 23}`).join(' ');
    const sol = shown.map((n) => `<text x="${n.x}" y="96" class="mb-post-sol">${LOWER[n.row]}</text>`).join('');
    let stain = '';
    if (hidden.length) {
      const x0 = hidden[0].x - 19;
      const x1 = Math.min(246, hidden[hidden.length - 1].x + 33);
      const k = Math.max(0.3, (x1 - x0) / 105);
      stain = `<g transform="translate(${x0} 0) scale(${k.toFixed(3)} 1) translate(-140 0)"><path d="M150 40 C162 30 186 31 204 36 C222 41 240 38 242 52 C245 70 238 84 242 100 C244 112 226 118 206 114 C188 110 170 118 158 108 C146 98 152 84 147 70 C143 58 140 48 150 40 Z" fill="rgba(128,92,46,.17)" stroke="rgba(112,76,36,.42)" stroke-width="1.6" vector-effect="non-scaling-stroke"></path><path d="M158 50 C168 44 190 46 202 50 C216 55 230 54 232 64" fill="none" stroke="rgba(112,76,36,.2)" stroke-width="1.2" vector-effect="non-scaling-stroke"></path></g>
        <g filter="url(#mb-f-smear)" fill="#2a3a52" opacity=".62">${hidden.map((n, i) => `<ellipse cx="${n.x + 1}" cy="${66 + (i % 2 ? 4 : -1)}" rx="5.5" ry="15"></ellipse><rect x="${n.x - 10}" y="${90 + (i % 3) - 1}" width="${18 + (i % 2) * 2}" height="7" rx="3"></rect>`).join('')}</g>
        <g filter="url(#mb-f-soft)" fill="none" stroke="#4b4033" stroke-width=".9" opacity=".55"><path d="M${x0} 42H234M${x0} 49H234M${x0} 56H234M${x0} 63H234M${x0} 70H234"></path></g>`;
    }
    const lines = hidden.length ? hidden[0].x - 19 : 234;
    const readable = shown.map((n) => LOWER[n.row]).join(', ');
    const label = `Bưu thiếp có khuông nhạc năm dòng với ${N} nốt. ${shown.length} nốt đọc được: ${readable}.` + (hidden.length ? ` ${hidden.length} nốt bị vết nước làm nhòe, không đọc được.` : '');
    return `<svg class="mb-post" viewBox="0 0 250 124" role="img" aria-label="${esc(label)}">
      <defs>
        <radialGradient id="mb-g-post" cx=".45" cy=".42" r=".8"><stop offset=".5" stop-color="#f2e7cd"></stop><stop offset="1" stop-color="#d9c398"></stop></radialGradient>
        <filter id="mb-f-smear" x="-60%" y="-40%" width="220%" height="180%"><feGaussianBlur stdDeviation="2.6"></feGaussianBlur></filter>
        <filter id="mb-f-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.2"></feGaussianBlur></filter>
      </defs>
      <g transform="rotate(-1.3 125 62)">
        <rect x="5" y="4" width="240" height="116" rx="1.5" fill="url(#mb-g-post)" stroke="#bfa57a" stroke-width=".8"></rect>
        <rect x="208" y="10" width="29" height="33" fill="#ece2c9" stroke="#b49c70" stroke-width=".9" stroke-dasharray="1.6 1.4"></rect>
        <rect x="211.5" y="13.5" width="22" height="26" fill="#6f2c31" opacity=".8"></rect>
        <path d="M224.5 18.5 A8 8 0 1 0 224.5 34.5 A10 10 0 0 1 224.5 18.5 Z" fill="#e6c675"></path>
        <path d="M190 18 q4 -3 8 0 t8 0 t8 0 t8 0 M190 24 q4 -3 8 0 t8 0 t8 0 t8 0 M190 30 q4 -3 8 0 t8 0 t8 0 t8 0" fill="none" stroke="#4b4339" stroke-width=".8" opacity=".55"></path>
        <text x="15" y="24" class="mb-post-hand">${esc(text(post, 'text', 'Hát lại cho ta nghe.'))}</text>
        <path d="M14 42H${lines}M14 49H${lines}M14 56H${lines}M14 63H${lines}M14 70H${lines}" fill="none" stroke="#4b4033" stroke-width=".8" opacity=".8"></path>
        <path d="M14 42V70" stroke="#4b4033" stroke-width="1"></path>
        <g fill="#1d2a3a">${heads}</g>
        ${ledgers ? `<path d="${ledgers}" fill="none" stroke="#4b4033" stroke-width=".8"></path>` : ''}
        <path d="${stems}" fill="none" stroke="#1d2a3a" stroke-width="1.2"></path>
        ${sol}
        ${stain}
        <path d="M231 42V70 M234 42V70" stroke="#4b4033" stroke-width="1.1" opacity=".35"></path>
      </g>
    </svg>`;
  }

  // ---------- helpers ----------
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => { timers.splice(timers.indexOf(t), 1); if (!dead) fn(); }, ms);
    timers.push(t);
    return t;
  };
  const clearTimers = () => { timers.splice(0).forEach((t) => clearTimeout(t)); };
  const stopDrag = () => { if (raf) cancelAnimationFrame(raf); raf = 0; drag = null; };
  const count = () => m.pins.slice(1).filter(Boolean).length;
  const commit = (patch: Partial<State>) => { Object.assign(m, patch); paint(); };

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

  // ---------- pins ----------
  function toggle(c: number, r: number) {
    if (m.solved || m.phase === 'coast' || m.phase === 'open') return;
    if (m.phase !== 'set') { commit({ msg: 'busy', cur: { c, r } }); return; }
    const pins = m.pins.slice();
    const old = pins[c] || 0;
    const patch: Partial<State> = { cur: { c, r }, msgC: c };
    const ghostAt = (row: number) => { const g = m.ghost.slice(); g[c] = { r: row, n: (m.ghost[c]?.n || 0) + 1 }; return g; };
    if (old === r) {
      pins[c] = 0;
      Object.assign(patch, { ghost: ghostAt(r), msg: 'unpin', moved: false });
    } else {
      pins[c] = r;
      const pop = m.popN.slice(); pop[c] = (pop[c] || 0) + 1;
      patch.popN = pop;
      if (old) patch.ghost = ghostAt(old);
      Object.assign(patch, { msg: 'pin', moved: !!old });
    }
    patch.pins = pins;
    if (m.bad === c) patch.bad = 0;
    commit(patch);
  }
  function clearAll() {
    if (m.solved || m.phase !== 'set') { if (m.phase === 'play') commit({ msg: 'busy' }); return; }
    if (!count()) return;
    const ghost = m.ghost.slice();
    const pins = Array(N + 1).fill(0);
    for (let c = 1; c <= N; c++) if (m.pins[c]) ghost[c] = { r: m.pins[c], n: (m.ghost[c]?.n || 0) + 1 };
    commit({ pins, ghost, bad: 0, msg: 'clear' });
  }

  // ---------- playback: each column reaches the comb at (c - 1) + LEAD ----------
  const fresh = (): Partial<State> => ({ phase: 'play', played: 0, notes: Array(N).fill(null), bad: 0, failEmpty: false, toothBad: 0, msg: 'play', msgC: 0 });

  /** Ask the server where this tune goes wrong; the drum turns meanwhile and waits at the first pluck. */
  function startProbe() {
    verdict = null;
    waiting = null;
    const token = ++playToken;
    const pins = m.pins.slice(1, N + 1);
    ctx.probe({ pins }).then((result) => {
      if (dead || token !== playToken) return;
      const fw = Number(result?.feedback?.firstWrong);
      if (!Number.isFinite(fw) || fw < 0) throw new Error(result?.message || 'probe');
      verdict = { firstWrong: fw };
      const w = waiting;
      waiting = null;
      if (w && m.phase === 'play') {
        if (pluck(w.c, w.auto) === 'ok' && w.auto) autoStep();
      }
    }).catch((error: any) => {
      if (dead || token !== playToken) return;
      abortPlay(error?.message);
    });
  }
  function abortPlay(message?: string) {
    playToken++;
    verdict = null;
    waiting = null;
    anim = null;
    clearTimers();
    stopDrag();
    commit({ phase: 'set', t: 0, dur: reduced() ? 0 : 300, ease: 'cubic-bezier(.3,1.4,.5,1)', dragging: false, msg: 'neterr' });
    if (message) say('LỖI', message, 'bad');
  }
  function play() {
    if (m.solved || m.phase !== 'set') { if (m.phase === 'play' || m.phase === 'fail' || m.phase === 'rewind') commit({ msg: m.phase === 'play' ? 'play' : m.msg }); return; }
    clearTimers();
    commit({ ...fresh(), t: 0, dur: 0 });
    startProbe();
    autoStep();
  }
  function autoStep() {
    if (m.phase !== 'play' || drag) return;
    const c = m.played + 1;
    const target = m.played + LEAD;
    const dur = Math.max(0, Math.round((target - m.t) * beatMs));
    anim = { from: m.t, to: target, start: Date.now(), dur };
    commit({ t: target, dur, ease: 'linear' });
    later(() => { anim = null; pluck(c, true); }, dur);
  }
  function curT() {
    const a = anim;
    if (!a) return m.t;
    const k = a.dur ? Math.min(1, Math.max(0, (Date.now() - a.start) / a.dur)) : 1;
    return a.from + (a.to - a.from) * k;
  }
  function slotPatch(r: number, bad: boolean, echo: boolean): Partial<State> {
    const n = (m.slotN || 0) + 1;
    const slots = m.slots.slice();
    slots[(n - 1) % 4] = { r, bad, echo, n };
    return { slots, slotN: n };
  }
  function pluck(c: number, auto: boolean): 'ok' | 'bad' | 'win' | 'skip' | 'wait' {
    if (m.phase !== 'play' || c !== m.played + 1) return 'skip';
    if (!verdict) { waiting = { c, auto }; return 'wait'; }
    const r = m.pins[c] || 0;
    const ok = verdict.firstWrong === 0 || c < verdict.firstWrong;
    const notes = m.notes.slice();
    notes[c - 1] = { r, ok };
    const patch: Partial<State> = { notes, played: c, msg: 'play', msgC: c };
    if (!auto) Object.assign(patch, { t: c - 1 + LEAD, dur: 0 });
    if (r) {
      const tv = m.toothV.slice(); tv[r] = (tv[r] || 0) + 1;
      patch.toothV = tv;
      Object.assign(patch, slotPatch(r, !ok, false));
    }
    if (!ok) { fail(c, r, patch); return 'bad'; }
    if (c === N) { win(patch); return 'win'; }
    commit(patch);
    if (auto) autoStep();
    return 'ok';
  }
  function fail(c: number, r: number, patch: Partial<State>) {
    drag = null;
    anim = null;
    clearTimers();
    commit({ ...patch, phase: 'fail', bad: c, failEmpty: !r, toothBad: r, shakeN: (m.shakeN || 0) + 1, msg: 'fail', msgC: c, dragging: false });
    // the comb shudders, then the drum rolls back to the start
    const back = reduced() ? 0 : Math.round(Math.min(950, 260 + m.t * 110));
    later(() => {
      commit({ phase: 'rewind', t: 0, dur: back, ease: 'cubic-bezier(.45,0,.2,1)', toothBad: 0 });
      later(() => commit({ phase: 'set' }), back + 40);
    }, reduced() ? 450 : 1000);
  }
  function win(patch: Partial<State>) {
    drag = null;
    anim = null;
    clearTimers();
    const first = m.pins[1] || 3;
    if (reduced()) {
      commit({ ...patch, phase: 'open', t: N + 1, dur: 0, msg: 'win', dragging: false });
      submit();
      return;
    }
    // the drum keeps turning, slowing down; the first note rings once more as it winds down
    commit({ ...patch, phase: 'coast', t: N + 0.75, dur: 1000, ease: 'cubic-bezier(.3,.52,.6,1)', msg: 'win', dragging: false });
    later(() => {
      const tv = m.toothV.slice(); tv[first] = (tv[first] || 0) + 1;
      commit({ toothV: tv, t: N + 1, dur: 820, ease: 'cubic-bezier(.2,.62,.35,1)', ...slotPatch(first, false, true) });
      later(() => { commit({ phase: 'open' }); later(submit, 700); }, 980);
    }, 1000);
  }
  /** The clean play is sent as the answer once the drawer has opened (the host then shows the card). */
  function submit() {
    ctx.submit({ pins: m.pins.slice(1, N + 1) }).then((result) => {
      if (dead) return;
      if (result.solved) { commit({ solved: true, msg: 'won' }); return; }
      commit({ phase: 'set', t: 0, dur: 0, msg: 'fail', msgC: Number(result.feedback?.firstWrong) || 1 });
    }).catch((error: any) => {
      if (dead) return;
      commit({ phase: 'set', t: 0, dur: 0, msg: 'neterr' });
      say('LỖI', error?.message || ctx.tr('Could not reach the server.', 'Không gửi được kết quả — thử quay lại.'), 'bad');
    });
  }

  // ---------- crank: drag it round clockwise (rAF-throttled); let go and the spring plays on ----------
  function crankDown(e: PointerEvent) {
    if (m.solved || !(m.phase === 'set' || m.phase === 'play')) return;
    if (e.button != null && e.button !== 0) return;
    const rc = el.crank.getBoundingClientRect();
    if (!rc.width) return;
    const cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
    if (m.phase === 'play') { clearTimers(); const t = curT(); anim = null; commit({ t, dur: 0 }); }
    drag = { id: e.pointerId, cx, cy, a: Math.atan2(e.clientY - cy, e.clientX - cx), x: e.clientX, y: e.clientY };
    try { el.crank.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
    commit(m.phase === 'set' ? { dragging: true, msg: m.msg === 'fail' ? 'fail' : 'grab' } : { dragging: true });
  }
  function crankMove(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; crankFrame(); });
  }
  function crankFrame() {
    const d = drag;
    if (!d) return;
    if (Math.hypot(d.x - d.cx, d.y - d.cy) < 10) return;
    const a = Math.atan2(d.y - d.cy, d.x - d.cx);
    let da = (a - d.a) * 180 / Math.PI;
    while (da > 180) da -= 360;
    while (da < -180) da += 360;
    d.a = a;
    if (da <= 0) return; // ratchet: it only turns clockwise
    let nt = Math.min(m.t + Math.min(da, 60) / STEP, N);
    if (m.phase === 'set') {
      // a small nudge only takes up the slack; the tune (and the old score) is kept until it really turns
      if (nt < 0.3) { commit({ t: Math.round(nt * 1000) / 1000, dur: 0 }); return; }
      commit(fresh());
      startProbe();
    }
    if (m.phase !== 'play') return;
    while (m.phase === 'play' && m.played < N && nt >= m.played + LEAD) {
      const res = pluck(m.played + 1, false);
      if (res === 'wait') { nt = Math.min(nt, m.played + LEAD - 0.01); break; }
      if (res !== 'ok') return;
    }
    if (m.phase === 'play') commit({ t: Math.round(nt * 1000) / 1000, dur: 0 });
  }
  function crankUp(e: PointerEvent) {
    const d = drag;
    if (!d || (e && e.pointerId !== d.id)) { if (m.dragging) commit({ dragging: false }); return; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; crankFrame(); }
    drag = null;
    try { el.crank.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (m.phase === 'play') {
      if (m.played === 0 && m.t < 0.3) {
        playToken++; verdict = null; waiting = null;
        commit({ phase: 'set', t: 0, dur: 300, ease: 'cubic-bezier(.3,1.4,.5,1)', dragging: false, msg: 'grab' });
        return;
      }
      waiting = null;
      commit({ dragging: false });
      autoStep();
      return;
    }
    if (m.phase === 'set' && m.t > 0) { commit({ t: 0, dur: 300, ease: 'cubic-bezier(.3,1.4,.5,1)', dragging: false }); return; }
    commit({ dragging: false });
  }

  // ---------- keyboard ----------
  function drumKey(e: KeyboardEvent) {
    const k = e.key;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[k] || k === 'Home' || k === 'End') {
      e.preventDefault();
      let c = m.cur.c, r = m.cur.r;
      if (k === 'Home') c = 1;
      else if (k === 'End') c = N;
      else { c = Math.max(1, Math.min(N, c + dirs[k][0])); r = Math.max(1, Math.min(5, r + dirs[k][1])); }
      wantFocus = true;
      commit({ cur: { c, r } });
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      const c = m.cur.c;
      if (m.pins[c]) toggle(c, m.pins[c]);
    }
  }
  function sheetKey(e: KeyboardEvent) {
    if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      play();
    }
  }

  // ---------- painting ----------
  const setCls = (node: Element, cls: string) => { if (node.getAttribute('class') !== cls) node.setAttribute('class', cls); };
  function paint() {
    const { phase, played, pins } = m;
    const n = count();
    for (let c = 1; c <= N; c++) {
      const pr = pins[c] || 0;
      const pn = m.popN[c] || 0;
      for (let r = 1; r <= 5; r++) {
        const b = cells.get(`${c}-${r}`)!;
        const has = pr === r;
        setCls(b, ['mb-cell', `r${r}`, has ? 'has-pin' : '', has && pn ? (pn % 2 ? 'pop-a' : 'pop-b') : ''].filter(Boolean).join(' '));
        b.tabIndex = m.cur.c === c && m.cur.r === r ? 0 : -1;
        b.setAttribute('aria-pressed', has ? 'true' : 'false');
      }
      const g = m.ghost[c];
      const gh = ghosts[c - 1];
      setCls(gh, ['mb-ghost', g && g.n ? (g.n % 2 ? 'gh-a' : 'gh-b') : ''].filter(Boolean).join(' '));
      gh.style.setProperty('--r', String(g ? g.r : 1));
      const now = reduced() && (phase === 'play' || phase === 'fail') && played === c;
      setCls(cols[c - 1], ['mb-col', m.bad === c && phase !== 'play' ? 'is-bad' : '', now ? 'is-now' : ''].filter(Boolean).join(' '));
    }
    dups.forEach((d) => {
      const [c, r] = d.dataset.dup!.split('-').map(Number);
      setCls(d, pins[c] === r ? 'mb-cell has-pin' : 'mb-cell');
    });
    for (let i = 0; i < N; i++) {
      const nt = m.notes[i];
      const li = scores[i];
      let cls = '', y = STAFF[3], name = '', sr = `Nhịp ${i + 1}: chưa chơi`;
      if (nt) {
        if (nt.r) { y = STAFF[nt.r]; name = NAMES[nt.r]; } else name = 'TRỐNG';
        cls = nt.ok ? 'is-on' : (nt.r ? 'is-bad' : 'is-empty');
        if (nt.r === 5) cls += ' is-do';
        sr = `Nhịp ${i + 1}: ${nt.r ? NAMES[nt.r] : 'không có nốt'}${nt.ok ? '' : ' — lệch'}`;
      } else if (phase === 'play' && played === i) cls = 'is-next';
      setCls(li, `mb-sc ${cls}`.trim());
      (li.querySelector('.mb-sc-nt') as SVGGElement).style.transform = `translateY(${y}px)`;
      li.querySelector('.mb-sc-n')!.textContent = name;
      li.querySelector('.s-sr')!.textContent = sr;
    }
    teeth.forEach((tooth) => {
      const r = Number(tooth.dataset.tooth);
      setCls(tooth, ['mb-tooth', `r${r}`, m.toothV[r] ? (m.toothV[r] % 2 ? 'va' : 'vb') : '', m.toothBad === r && phase === 'fail' ? 'is-bad' : ''].filter(Boolean).join(' '));
    });
    slotEls.forEach((slot, i) => {
      const sl = m.slots[i];
      setCls(slot, sl ? ['mb-slot', Math.floor((sl.n - 1) / 4) % 2 ? 'sb' : 'sa', sl.bad ? 'is-bad' : '', sl.echo ? 'is-echo' : ''].filter(Boolean).join(' ') : 'mb-slot');
      slot.style.setProperty('--r', String(sl ? sl.r : 3));
      slot.querySelector('b')!.textContent = sl ? NAMES[sl.r] : '';
    });
    const run = phase === 'play' || phase === 'coast';
    setCls(el.rig, ['mb-rig', run ? 'is-run' : '', phase !== 'set' ? 'is-busy' : '', m.dragging ? 'is-drag' : '', phase === 'open' ? 'is-open' : '', phase === 'fail' ? 'is-fail' : ''].filter(Boolean).join(' '));
    el.cap.textContent = played && phase !== 'set' ? `${played}/${N}` : '';
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const trans = (node: HTMLElement | SVGElement) => { node.style.transitionDuration = `${m.dur || 0}ms`; node.style.transitionTimingFunction = m.ease || 'linear'; };
    trans(el.strip); el.strip.style.transform = `translateX(calc(${r3(-m.t)} * var(--colW)))`;
    trans(el.orn); el.orn.style.transform = `rotateY(${r3(m.t * 40)}deg)`;
    trans(el.arm); el.arm.style.transform = `rotate(${r3(m.t * STEP)}deg)`;
    setCls(el.comb, ['mb-comb', m.shakeN ? (m.shakeN % 2 ? 'shk-a' : 'shk-b') : ''].filter(Boolean).join(' '));
    setCls(el.flash, ['mb-flash', m.shakeN ? (m.shakeN % 2 ? 'fa' : 'fb') : '', m.failEmpty ? 'is-all' : ''].filter(Boolean).join(' '));
    el.flash.style.setProperty('--r', String(m.toothBad || m.notes[(m.bad || 1) - 1]?.r || 3));
    const plays = Math.max(Number(ctx.run?.probesUsed) || 0, 0);
    el.tries.textContent = `Lần quay: ${plays}`;
    const ready = phase === 'set' && !m.solved && n === N;
    el.play.setAttribute('aria-disabled', phase !== 'set' || m.solved ? 'true' : 'false');
    el.play.classList.toggle('is-ready', ready);
    el.clear.setAttribute('aria-disabled', phase !== 'set' || m.solved || !n ? 'true' : 'false');
    status(n);
    if (wantFocus) {
      const target = cells.get(`${m.cur.c}-${m.cur.r}`);
      if (target) { wantFocus = false; target.focus({ preventScroll: true }); }
    }
  }
  function status(n: number) {
    const mc = m.msgC || 0;
    const pins = m.pins;
    switch (m.msg) {
      case 'pin': return say(`CHỐT ${n}/${N}`, m.moved ? `Đã dời chốt nhịp ${mc} sang ${NAMES[pins[mc]]}.` : `Cắm chốt nhịp ${mc}: ${NAMES[pins[mc]]}.`);
      case 'unpin': return say(`CHỐT ${n}/${N}`, `Đã rút chốt ở nhịp ${mc}.`);
      case 'clear': return say(`CHỐT 0/${N}`, 'Đã gỡ hết chốt trên trục.');
      case 'grab': return say('TAY QUAY', 'Kéo vòng theo chiều kim đồng hồ để trục đồng quay.');
      case 'busy': return say('ĐANG CHƠI', 'Chờ hộp nhạc dừng rồi hãy sửa chốt.', 'info', 'mb-k-warn');
      case 'play': return say('ĐANG CHƠI', m.played ? `Nhịp ${m.played}/${N} · ${NAMES[pins[m.played]] || 'TRỐNG'}` : 'Trục đồng bắt đầu quay…');
      case 'fail': return say('LỆCH NHỊP', `Giai điệu lệch ở nhịp ${mc}.${m.failEmpty ? ' Nhịp này chưa có chốt.' : ''}`, 'bad');
      case 'win': return say('ĐÚNG GIAI ĐIỆU', 'Hộp nhạc chơi trọn bài — có tiếng ‘cạch’ dưới đáy hộp.', 'ok', 'mb-k-ok');
      case 'won': return say('ĐÃ MỞ NGĂN', ctx.tr('The hidden drawer is open.', 'Ngăn bí mật dưới đáy hộp đã mở.'), 'ok', 'mb-k-ok');
      case 'neterr': return undefined;
      default: return say('CẮM CHỐT', 'Nhấp vào lỗ trên trục đồng để cắm chốt — mỗi nhịp một chốt — rồi quay tay quay.');
    }
  }

  // ---------- wiring ----------
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.mb-cell');
    if (!b || !body.contains(b)) return;
    const [c, r] = b.dataset.cell!.split('-').map(Number);
    toggle(c, r);
  };
  const onDrumKey = (e: KeyboardEvent) => drumKey(e);
  const onPlay = (e: Event) => { e.preventDefault(); play(); };
  const onClear = (e: Event) => { e.preventDefault(); clearAll(); };
  const sheet = body.closest<HTMLElement>('.pz-veil') ?? body;
  body.addEventListener('click', onClick);
  el.drum.addEventListener('keydown', onDrumKey);
  el.crank.addEventListener('pointerdown', crankDown);
  el.crank.addEventListener('pointermove', crankMove);
  el.crank.addEventListener('pointerup', crankUp);
  el.crank.addEventListener('pointercancel', crankUp);
  el.play.addEventListener('click', onPlay);
  el.clear.addEventListener('click', onClear);
  sheet.addEventListener('keydown', sheetKey);

  if (ctx.solved) Object.assign(m, { phase: 'open', solved: true, msg: 'won', t: N + 1 });
  paint();

  return {
    update(next) {
      ctx = next;
      if (next.solved && !m.solved && m.phase !== 'coast' && m.phase !== 'open') {
        // the partner opened it
        playToken++;
        clearTimers();
        stopDrag();
        commit({ phase: 'open', solved: true, msg: 'won', t: N + 1, dur: 0 });
        return;
      }
      if (next.solved) m.solved = true;
      paint();
    },
    unmount() {
      dead = true;
      playToken++;
      clearTimers();
      stopDrag();
      body.removeEventListener('click', onClick);
      el.drum.removeEventListener('keydown', onDrumKey);
      el.crank.removeEventListener('pointerdown', crankDown);
      el.crank.removeEventListener('pointermove', crankMove);
      el.crank.removeEventListener('pointerup', crankUp);
      el.crank.removeEventListener('pointercancel', crankUp);
      el.play.removeEventListener('click', onPlay);
      el.clear.removeEventListener('click', onClear);
      sheet.removeEventListener('keydown', sheetKey);
      actions.remove();
      body.classList.remove('mb-host');
      body.innerHTML = '';
    },
  };
}

const musicBox: PuzzleKindModule = {
  kind: 'music_box',
  label: { en: 'Music box', vi: 'Hộp nhạc' },
  mount,
};

export default musicBox;
