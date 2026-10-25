/**
 * P7 · Cân tiểu ly của hiệu thuốc — port of design/project/PuzzleScale.dc.html.
 * A row of identical vials, one heavier. Put equal counts on the two pans and weigh: each weighing spends
 * a brass token and is judged on the server (ctx.probe { left, right } → { res, tokensLeft }). Then point
 * out the heavy vial (ctx.submit { pick }). A wrong pick re-shuffles the vials on the server: the tokens
 * come back and the ledger turns to a new page.
 *
 * params: { vials, tokens, perPan } + optional text (shop, shopName, batch, grams, cards, note…).
 * run view (from the server): { tokens, tokensLeft, round, log:[{L,R,res}] } — shared with the partner.
 */
import './balance_scale.css';
import type { PuzzleContext, PuzzleKindHandle, PuzzleKindModule, PuzzleRunView } from '../types';

type Side = 'L' | 'R' | 'S';
type Res = 'L' | 'R' | 'E';
interface Weighing { L: number[]; R: number[]; res: Res }
type Phase = 'load' | 'coin' | 'swing' | 'result' | 'return' | 'pick' | 'insp' | 'peel' | 'wrong' | 'solved';

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (a: number, b: number) => a - b;
const int = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
const NUMBER_WORD = ['', 'Một', 'Hai', 'Ba', 'Bốn', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười'];

/* damped swing, sampled at each half period (ease-in-out between samples) */
const DEV = [-1, 0.45, -0.2025, 0.0911, -0.041, 0.0185, -0.0083, 0];
const LVL = [0, 1, -0.45, 0.2, -0.09, 0.04, -0.016, 0];
const SWAY = [0, 1, -0.72, 0.46, -0.27, 0.13, -0.05, 0];
const TILT = 9;

const SVG_DEFS = `              <svg width="0" height="0" style="position: absolute" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="sc-g-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#11291f"></stop><stop offset=".55" stop-color="#0d2119"></stop><stop offset="1" stop-color="#081510"></stop></linearGradient>
<pattern id="sc-p-boards" width="58" height="12" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="1.4" height="12" fill="rgba(0,0,0,.42)"></rect><rect x="1.6" y="0" width="1" height="12" fill="rgba(190,230,200,.045)"></rect><rect x="30" y="0" width="12" height="12" fill="rgba(0,0,0,.05)"></rect></pattern>
<radialGradient id="sc-g-lamp" cx=".24" cy=".12" r=".75"><stop offset="0" stop-color="#ffc47a" stop-opacity=".2"></stop><stop offset=".45" stop-color="#ffc47a" stop-opacity=".06"></stop><stop offset="1" stop-color="#ffc47a" stop-opacity="0"></stop></radialGradient>
<linearGradient id="sc-g-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5c3b22"></stop><stop offset=".5" stop-color="#3d2716"></stop><stop offset="1" stop-color="#22150b"></stop></linearGradient>
<linearGradient id="sc-g-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"></stop><stop offset="1" stop-color="#000" stop-opacity="0"></stop></linearGradient>
<linearGradient id="sc-g-jar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0a1410"></stop><stop offset=".3" stop-color="#1b2d25"></stop><stop offset=".55" stop-color="#101e18"></stop><stop offset="1" stop-color="#060d0a"></stop></linearGradient>
<linearGradient id="sc-g-brassv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6e3a3"></stop><stop offset=".5" stop-color="#c7a24b"></stop><stop offset="1" stop-color="#6e5620"></stop></linearGradient>
<linearGradient id="sc-g-brassh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5e4a1c"></stop><stop offset=".32" stop-color="#f3dc95"></stop><stop offset=".6" stop-color="#c7a24b"></stop><stop offset="1" stop-color="#4f3e16"></stop></linearGradient>
<linearGradient id="sc-g-brassd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9b866"></stop><stop offset="1" stop-color="#7a5f24"></stop></linearGradient>
<linearGradient id="sc-g-leather" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22392f"></stop><stop offset="1" stop-color="#13221c"></stop></linearGradient>
<linearGradient id="sc-g-stone" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a463f"></stop><stop offset=".35" stop-color="#8f8a7e"></stop><stop offset=".7" stop-color="#6a665c"></stop><stop offset="1" stop-color="#3a3731"></stop></linearGradient>
<linearGradient id="sc-g-ivory" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe5cc"></stop><stop offset="1" stop-color="#cdbb92"></stop></linearGradient>
<linearGradient id="sc-g-amber" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a1604"></stop><stop offset=".14" stop-color="#8c410c"></stop><stop offset=".34" stop-color="#d4862a"></stop><stop offset=".48" stop-color="#eaa64a"></stop><stop offset=".64" stop-color="#b9661b"></stop><stop offset=".86" stop-color="#6b3008"></stop><stop offset="1" stop-color="#2c1103"></stop></linearGradient>
<linearGradient id="sc-g-liq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b2d06" stop-opacity=".9"></stop><stop offset="1" stop-color="#2e1003" stop-opacity=".96"></stop></linearGradient>
<linearGradient id="sc-g-cork" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5e4329"></stop><stop offset=".38" stop-color="#b08b5e"></stop><stop offset=".7" stop-color="#8c6a43"></stop><stop offset="1" stop-color="#4b3420"></stop></linearGradient>
<linearGradient id="sc-g-dishin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f300f"></stop><stop offset="1" stop-color="#9a7a32"></stop></linearGradient>
<linearGradient id="sc-g-dishout" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3dc95"></stop><stop offset=".45" stop-color="#c39b47"></stop><stop offset="1" stop-color="#5e4a1c"></stop></linearGradient>
<radialGradient id="sc-g-coinf" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff1c2"></stop><stop offset=".45" stop-color="#d9b45c"></stop><stop offset="1" stop-color="#6e5420"></stop></radialGradient>
<radialGradient id="sc-g-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd98a" stop-opacity=".85"></stop><stop offset=".55" stop-color="#efb85a" stop-opacity=".3"></stop><stop offset="1" stop-color="#efb85a" stop-opacity="0"></stop></radialGradient>
<linearGradient id="sc-g-mothw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a39682"></stop><stop offset="1" stop-color="#6c604f"></stop></linearGradient>
<!-- one amber vial (48 × 96): glass and its paper label are separate so the close-up can peel the label -->
<g id="sc-vial-glass">
<path d="M17.5 21 V25 C17.5 29 5 31 5 40 V87 Q5 94 12 94 H36 Q43 94 43 87 V40 C43 31 30.5 29 30.5 25 V21 Z" fill="url(#sc-g-amber)" stroke="#2e1203" stroke-width="1"></path>
<path d="M7.6 46 Q24 49.2 40.4 46 V86.6 Q40.4 91.6 35.4 91.6 H12.6 Q7.6 91.6 7.6 86.6 Z" fill="url(#sc-g-liq)"></path>
<path d="M7.8 46.2 Q24 49.4 40.2 46.2" fill="none" stroke="rgba(255,206,130,.45)" stroke-width="1"></path>
<path d="M9.4 42 C9.4 37 13 34.2 16.4 33" fill="none" stroke="rgba(255,242,214,.6)" stroke-width="1.6" stroke-linecap="round"></path>
<path d="M8.8 45 V86" stroke="rgba(255,236,200,.3)" stroke-width="2.6" stroke-linecap="round"></path>
<path d="M39.4 44 V85" stroke="rgba(40,14,0,.4)" stroke-width="2"></path>
<path d="M17.6 24.6 Q24 26.6 30.4 24.6" fill="none" stroke="#7a2b1c" stroke-width="1.7"></path>
<rect x="15.4" y="18.4" width="17.2" height="4.6" rx="1.8" fill="#c97a2a" stroke="#2e1203" stroke-width=".8"></rect>
<path d="M16.6 19.4 H31.4" stroke="rgba(255,226,170,.6)" stroke-width=".8"></path>
<path d="M17 4.2 Q17 2 19.2 2 H28.8 Q31 2 31 4.2 V19 H17 Z" fill="url(#sc-g-cork)" stroke="#33220f" stroke-width=".8"></path>
<path d="M19.5 7 h2 M24.5 9.6 h2 M20.4 13.4 h2 M26 15.2 h1.6 M23 5 h1.4" stroke="rgba(40,24,10,.55)" stroke-width="1"></path>
</g>
<g id="sc-vial-label">
<rect x="9" y="53" width="30" height="29" rx="1" fill="#efe4c8"></rect>
<path d="M9 53 H39 V82 H9 Z" fill="none" stroke="rgba(60,40,10,.35)" stroke-width=".6"></path>
<rect x="10.8" y="54.8" width="26.4" height="25.4" fill="none" stroke="#9e3f2a" stroke-width=".7" opacity=".85"></rect>
<path d="M9 53 H13 V82 H9 Z M35 53 H39 V82 H35 Z" fill="rgba(60,40,10,.14)"></path>
</g>
<!-- the upper shelf of dark jars, cut by the top edge -->
<g id="sc-g-jars">
<rect x="0" y="0" width="1000" height="62" fill="rgba(3,9,7,.5)"></rect>
<g fill="url(#sc-g-jar)" stroke="rgba(199,162,75,.2)" stroke-width="1">
<path d="M24 52 V22 Q24 16 31 14 Q27 10 31 5 H71 Q75 10 71 14 Q78 16 78 22 V52 Z"></path>
<path d="M106 52 Q94 52 94 40 Q94 27 112 22 V-4 H124 V22 Q142 27 142 40 Q142 52 130 52 Z"></path>
<path d="M162 52 V14 Q162 6 170 4 V-10 H180 V4 Q188 6 188 14 V52 Z"></path>
<path d="M208 52 V20 H264 V52 Z M204 20 H268 V13 Q236 4 204 13 Z"></path>
<path d="M288 52 V22 Q288 13 300 11 V-2 H312 V11 Q324 13 324 22 V52 Z"></path>
<path d="M346 52 V24 Q346 18 353 16 Q349 12 353 7 H393 Q397 12 393 16 Q400 18 400 24 V52 Z"></path>
<path d="M424 52 V32 Q424 25 432 23 V14 H446 V23 Q454 25 454 32 V52 Z"></path>
<path d="M482 52 Q476 36 490 27 Q502 19 508 17 V2 H522 V17 Q528 19 540 27 Q554 36 548 52 Z"></path>
<path d="M576 52 V18 Q576 9 586 7 V-6 H598 V7 Q608 9 608 18 V52 Z"></path>
<path d="M630 52 V22 H684 V52 Z M626 22 H688 V15 Q657 6 626 15 Z"></path>
<path d="M708 52 V10 Q708 3 715 1 V-12 H723 V1 Q730 3 730 10 V52 Z"></path>
<path d="M754 52 V23 Q754 17 761 15 Q757 11 761 6 H801 Q805 11 801 15 Q808 17 808 23 V52 Z"></path>
<path d="M842 52 Q830 52 830 41 Q830 29 848 24 V6 H858 V24 Q876 29 876 41 Q876 52 864 52 Z"></path>
<path d="M902 52 V20 Q902 12 912 10 V-4 H924 V10 Q934 12 934 20 V52 Z"></path>
<path d="M954 52 V24 H998 V52 Z M950 24 H1002 V17 Q976 9 950 17 Z"></path>
</g>
<g fill="rgba(233,220,192,.09)">
<rect x="34" y="28" width="34" height="14"></rect><rect x="104" y="34" width="28" height="10"></rect><rect x="216" y="30" width="40" height="12"></rect><rect x="356" y="30" width="34" height="14"></rect><rect x="494" y="34" width="42" height="10"></rect><rect x="638" y="32" width="38" height="12"></rect><rect x="764" y="29" width="34" height="14"></rect><rect x="908" y="28" width="20" height="12"></rect><rect x="958" y="32" width="36" height="12"></rect>
</g>
<rect x="0" y="52" width="1000" height="9" fill="url(#sc-g-wood)"></rect>
<path d="M0 52.6 H1000" stroke="rgba(239,212,134,.3)" stroke-width="1"></path>
<rect x="0" y="61" width="1000" height="16" fill="url(#sc-g-shade)"></rect>
</g>
<!-- main shelf: the plank's top is at local y 0 -->
<g id="sc-g-shelf">
<rect x="44" y="16" width="912" height="20" fill="url(#sc-g-shade)"></rect>
<path d="M108 16 H148 C148 30 128 34 120 54 Q118 60 112 60 H108 Z M892 16 H852 C852 30 872 34 880 54 Q882 60 888 60 H892 Z" fill="#1b1109" stroke="rgba(199,162,75,.34)" stroke-width="1"></path>
<circle cx="115" cy="24" r="2" fill="#a8822e"></circle><circle cx="885" cy="24" r="2" fill="#a8822e"></circle>
<rect x="40" y="0" width="920" height="16" rx="1.5" fill="url(#sc-g-wood)"></rect>
<path d="M41 .7 H959" stroke="rgba(255,222,170,.3)" stroke-width="1.2"></path>
<path d="M40 16 H960" stroke="rgba(0,0,0,.6)" stroke-width="1.2"></path>
<path d="M60 7 Q200 5 340 8 T640 7 T940 8" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1"></path>
<path d="M40 11 H960" stroke="rgba(199,162,75,.18)" stroke-width="1"></path>
</g>
<!-- the still moth, wings spread, resting where the wall meets the shelf -->
<g id="sc-g-moth">
<ellipse cx="4" cy="17" rx="30" ry="3" fill="rgba(0,0,0,.4)"></ellipse>
<path d="M0 3 C-7 5 -18 10 -21 16 C-13 18.5 -5 14.5 0 9 Z M0 3 C7 5 18 10 21 16 C13 18.5 5 14.5 0 9 Z" fill="#6c604f" stroke="#3c342b" stroke-width=".6"></path>
<path d="M0 -3 C-6 -8 -22 -13 -35 -7 C-31 0 -24 8 -16 12 C-9 9 -3 5 0 2 Z M0 -3 C6 -8 22 -13 35 -7 C31 0 24 8 16 12 C9 9 3 5 0 2 Z" fill="url(#sc-g-mothw)" stroke="#3c342b" stroke-width=".7"></path>
<path d="M-6 -6 C-13 -3 -17 3 -18 9 M6 -6 C13 -3 17 3 18 9" fill="none" stroke="#4f453a" stroke-width="1.5" opacity=".75"></path>
<path d="M-12 -9.5 C-20 -7 -27 -3 -30 1 M12 -9.5 C20 -7 27 -3 30 1" fill="none" stroke="#c4b8a3" stroke-width="1" opacity=".55"></path>
<circle cx="-23" cy="-4" r="2.4" fill="#3b3229"></circle><circle cx="23" cy="-4" r="2.4" fill="#3b3229"></circle>
<circle cx="-23" cy="-4" r="1" fill="#c9bda8"></circle><circle cx="23" cy="-4" r="1" fill="#c9bda8"></circle>
<ellipse cx="0" cy="3" rx="3.2" ry="9" fill="#5b4f43"></ellipse>
<ellipse cx="0" cy="-4" rx="4" ry="3.6" fill="#857764"></ellipse>
<circle cx="0" cy="-8.6" r="2.3" fill="#4d4238"></circle>
<path d="M-1 -10 C-4 -16 -9 -19 -14 -20 M1 -10 C4 -16 9 -19 14 -20" fill="none" stroke="#7b6f5d" stroke-width=".9"></path>
<path d="M-5 -15 l-2 -2.4 M-8 -17.4 l-1.6 -2.6 M-11 -19 l-.8 -2.6 M5 -15 l2 -2.4 M8 -17.4 l1.6 -2.6 M11 -19 l.8 -2.6" stroke="#7b6f5d" stroke-width=".6"></path>
</g>
<!-- a small framed pharmacy licence hanging a little crooked, origin at its top-left -->
<g id="sc-g-frame">
<path d="M8 4 L40 -16 L72 4" fill="none" stroke="rgba(150,120,80,.55)" stroke-width="1"></path>
<circle cx="40" cy="-17" r="2.2" fill="#a8822e"></circle>
<g transform="rotate(-2.5 40 46)">
<rect x="3" y="5" width="80" height="92" fill="rgba(0,0,0,.45)"></rect>
<rect x="0" y="0" width="80" height="92" fill="#2a1a10" stroke="#120b06" stroke-width="1"></rect>
<rect x="6" y="6" width="68" height="80" fill="none" stroke="rgba(199,162,75,.45)" stroke-width="1"></rect>
<rect x="9" y="9" width="62" height="74" fill="#b9aa84"></rect>
<rect x="9" y="9" width="62" height="74" fill="url(#sc-g-shade)" opacity=".35"></rect>
<path d="M22 20 H58 M28 25 H52" stroke="rgba(50,32,14,.75)" stroke-width="2.2"></path>
<path d="M16 34 H64 M16 40 H62 M16 46 H64 M16 52 H56 M16 58 H44" stroke="rgba(60,40,20,.42)" stroke-width="1.2"></path>
<path d="M47 68 L44 80 L49 76 L52 81 L53 69 Z" fill="#6b2318"></path>
<circle cx="50" cy="66" r="6.4" fill="#8e2a1c" stroke="#5a170e" stroke-width=".8"></circle>
<circle cx="50" cy="66" r="3.4" fill="none" stroke="rgba(255,190,170,.35)" stroke-width=".8"></circle>
<path d="M17 72 Q24 66 30 72" fill="none" stroke="rgba(30,20,10,.55)" stroke-width="1"></path>
</g>
</g>
<!-- counter: top face at local y 0 -->
<g id="sc-g-counter">
<rect x="0" y="0" width="1000" height="20" fill="url(#sc-g-leather)"></rect>
<path d="M0 .6 H1000" stroke="rgba(255,226,170,.16)" stroke-width="1.2"></path>
<rect x="0" y="20" width="1000" height="4" fill="url(#sc-g-brassv)"></rect>
<rect x="0" y="24" width="1000" height="60" fill="#1c120a"></rect>
<rect x="0" y="24" width="1000" height="10" fill="rgba(0,0,0,.45)"></rect>
<path d="M24 38 H476 V84 M24 38 V84 M524 38 H976 V84 M524 38 V84" fill="none" stroke="rgba(199,162,75,.18)" stroke-width="1"></path>
</g>
<!-- stone mortar and pestle, origin at the base centre -->
<g id="sc-g-mortar">
<ellipse cx="2" cy="1" rx="54" ry="5" fill="rgba(0,0,0,.5)"></ellipse>
<ellipse cx="0" cy="-36" rx="46" ry="7" fill="#8e897d"></ellipse>
<ellipse cx="0" cy="-35.4" rx="39" ry="4.6" fill="#24221e"></ellipse>
<path d="M4 -33 L40 -84 Q44 -90 50 -86 Q55 -82 51 -76 L14 -29 Z" fill="url(#sc-g-stone)" stroke="#2c2a25" stroke-width=".8"></path>
<path d="M-46 -36 A46 7 0 0 0 46 -36 Q44 -6 22 -3 V0 H-22 V-3 Q-44 -6 -46 -36 Z" fill="url(#sc-g-stone)" stroke="#2c2a25" stroke-width=".8"></path>
<path d="M-40 -30 Q-36 -12 -20 -7" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2" stroke-linecap="round"></path>
</g>
<!-- brass tray for the weighing tokens, origin at its centre -->
<g id="sc-g-dish">
<ellipse cx="3" cy="7" rx="58" ry="7" fill="rgba(0,0,0,.55)"></ellipse>
<ellipse cx="0" cy="1" rx="54" ry="10" fill="url(#sc-g-brassv)" stroke="#3a2c10" stroke-width=".8"></ellipse>
<ellipse cx="0" cy="-.5" rx="45" ry="6.8" fill="#4a3810"></ellipse>
<ellipse cx="0" cy="0" rx="45" ry="6.8" fill="none" stroke="rgba(255,240,200,.22)" stroke-width="1"></ellipse>
</g>
<!-- static parts of the balance, desktop coordinates around the pivot (500, 292) -->
<g id="sc-g-scale">
<ellipse cx="500" cy="530" rx="130" ry="7" fill="rgba(0,0,0,.6)"></ellipse>
<rect x="492" y="300" width="16" height="184" fill="url(#sc-g-brassh)"></rect>
<rect x="487" y="328" width="26" height="8" rx="2" fill="url(#sc-g-brassh)" stroke="#3a2c10" stroke-width=".7"></rect>
<rect x="485" y="466" width="30" height="10" rx="2" fill="url(#sc-g-brassh)" stroke="#3a2c10" stroke-width=".7"></rect>
<path d="M476 268 V300 Q476 312 488 312 H512 Q524 312 524 300 V268 H516 V300 Q516 304 512 304 H488 Q484 304 484 300 V268 Z" fill="url(#sc-g-brassh)" stroke="#3a2c10" stroke-width=".8"></path>
<circle cx="480" cy="264" r="5.6" fill="url(#sc-g-brassv)" stroke="#3a2c10" stroke-width=".7"></circle>
<circle cx="520" cy="264" r="5.6" fill="url(#sc-g-brassv)" stroke="#3a2c10" stroke-width=".7"></circle>
<rect x="489" y="297" width="22" height="6" rx="1.5" fill="#2d544c" stroke="#13261f" stroke-width=".6"></rect>
<path d="M454.4 385.5 A104 104 0 0 0 545.6 385.5 L537.7 369.3 A86 86 0 0 1 462.3 369.3 Z" fill="url(#sc-g-ivory)" stroke="#a8822e" stroke-width="2.4"></path>
<path d="M462.4 372.7 L459.4 379.0 M469.6 375.6 L467.2 382.2 M477.0 378.0 L473.9 389.6 M484.5 379.6 L483.3 386.5 M492.2 380.7 L491.6 387.6 M507.8 380.7 L508.4 387.6 M515.5 379.6 L516.7 386.5 M523.0 378.0 L526.1 389.6 M530.4 375.6 L532.8 382.2 M537.6 372.7 L540.6 379.0" stroke="#3b2a10" stroke-width="1.2"></path>
<path d="M500 381 L500 393" stroke="#9e3f2a" stroke-width="2"></path>
<ellipse cx="500" cy="482" rx="25" ry="5" fill="url(#sc-g-brassh)"></ellipse>
<path d="M404 492 H596 V524 Q596 528 592 528 H408 Q404 528 404 524 Z" fill="url(#sc-g-wood)" stroke="#120b06" stroke-width="1"></path>
<rect x="398" y="482" width="204" height="11" rx="2.5" fill="url(#sc-g-brassv)" stroke="#3a2c10" stroke-width=".7"></rect>
<rect x="418" y="499" width="164" height="22" rx="1.5" fill="none" stroke="rgba(239,212,134,.32)" stroke-width="1"></rect>
<text x="500" y="514" text-anchor="middle" font-family="Source Code Pro, monospace" font-size="10.5" font-weight="700" letter-spacing="2.4" fill="rgba(239,212,134,.62)">CÂN TIỂU LY</text>
<ellipse cx="548" cy="485.6" rx="13" ry="2.6" fill="#0b0705"></ellipse>
<path d="M535.5 487.4 Q548 489.4 560.5 487.4" fill="none" stroke="rgba(255,236,190,.5)" stroke-width=".8"></path>
<rect x="412" y="526" width="14" height="4" rx="1" fill="#6e5620"></rect><rect x="574" y="526" width="14" height="4" rx="1" fill="#6e5620"></rect>
</g>
<!-- one pan: back part (chains, inside of the bowl), hook at (100, 10) -->
<g id="sc-g-panback">
<path d="M100 4.5 C95.5 4.5 95 9.5 98.6 11.6 L100 15.5" fill="none" stroke="#d9b65e" stroke-width="2"></path>
<path d="M100 16 L9 147 M100 16 L191 147" stroke="rgba(28,18,4,.85)" stroke-width="3.6" stroke-dasharray="5 2.6" stroke-linecap="round"></path>
<path d="M100 16 L9 147 M100 16 L191 147" stroke="#c9a14a" stroke-width="2" stroke-dasharray="5 2.6" stroke-linecap="round"></path>
<ellipse cx="100" cy="149" rx="96" ry="8.2" fill="url(#sc-g-dishin)" stroke="#6e5620" stroke-width=".8"></ellipse>
<path d="M8 147.6 A96 8 0 0 1 192 147.6" fill="none" stroke="rgba(255,236,180,.55)" stroke-width="1.2"></path>
</g>
<!-- the front lip of the bowl, drawn over the vials so they sit in it -->
<g id="sc-g-panfront">
<path d="M4 149 A96 8.2 0 0 0 196 149 Q188 163 100 166 Q12 163 4 149 Z" fill="url(#sc-g-dishout)" stroke="#4a3810" stroke-width=".8"></path>
<path d="M14 153.6 Q100 166 186 153.6" fill="none" stroke="rgba(255,244,210,.5)" stroke-width="1.2"></path>
</g>
<g id="sc-g-coin">
<circle cx="13" cy="13" r="12.4" fill="url(#sc-g-coinf)" stroke="#5e4a1c" stroke-width="1"></circle>
<circle cx="13" cy="13" r="9.4" fill="none" stroke="rgba(94,74,28,.6)" stroke-width="1"></circle>
<path d="M8.6 12 H17.4 Q17 17.4 13 17.6 Q9 17.4 8.6 12 Z M14 11.4 L17.6 7" fill="rgba(94,74,28,.7)" stroke="rgba(94,74,28,.7)" stroke-width="1.2" stroke-linecap="round"></path>
</g>
</defs>
</svg>`;
const SVG_BG = `                    <svg class="sc-bg sc-bg-d" viewBox="0 0 1000 600" aria-hidden="true">
<rect width="1000" height="600" fill="url(#sc-g-wall)"></rect>
<rect width="1000" height="600" fill="url(#sc-p-boards)"></rect>
<use href="#sc-g-jars"></use>
<rect width="1000" height="600" fill="url(#sc-g-lamp)"></rect>
<use href="#sc-g-shelf" y="196"></use>
<use href="#sc-g-moth" x="924" y="176"></use>
<use href="#sc-g-frame" x="24" y="272"></use>
<use href="#sc-g-scale"></use>
<use href="#sc-g-counter" y="528"></use>
<use href="#sc-g-mortar" x="96" y="530"></use>
<use href="#sc-g-dish" x="900" y="524"></use>
</svg>
<svg class="sc-bg sc-bg-m" viewBox="0 0 1000 1010" aria-hidden="true">
<rect width="1000" height="1010" fill="url(#sc-g-wall)"></rect>
<rect width="1000" height="1010" fill="url(#sc-p-boards)"></rect>
<use href="#sc-g-jars" y="-40"></use>
<rect width="1000" height="1010" fill="url(#sc-g-lamp)"></rect>
<use href="#sc-g-shelf" y="205"></use>
<use href="#sc-g-shelf" y="410"></use>
<use href="#sc-g-moth" x="918" y="390"></use>
<use href="#sc-g-frame" x="30" y="478"></use>
<g transform="translate(500 640) scale(1.3) translate(-500 -292)"><use href="#sc-g-scale"></use></g>
<use href="#sc-g-counter" y="947"></use>
<use href="#sc-g-mortar" x="96" y="949"></use>
<use href="#sc-g-dish" x="876" y="942"></use>
</svg>`;
const SVG_BEAM = `                    <div class="sc-beam" aria-hidden="true">
<svg viewBox="0 0 520 160">
<path d="M257 50 L259.2 139 L260 143 L260.8 139 L263 50 Z" fill="#1c2633" stroke="#0a0f16" stroke-width=".6"></path>
<path d="M259.4 54 L259.9 136" stroke="rgba(150,180,220,.55)" stroke-width=".7"></path>
<path d="M255.5 114 L260 104 L264.5 114 L260 124 Z" fill="#1c2633" stroke="#0a0f16" stroke-width=".6"></path>
<circle cx="260" cy="114" r="1.8" fill="#e0bf68"></circle>
<path d="M244 30 Q244 20 253 18 Q251 24 257 26 L260 13 L263 26 Q269 24 267 18 Q276 20 276 30 Z" fill="url(#sc-g-brassv)" stroke="#4a3810" stroke-width=".7"></path>
<circle cx="260" cy="11" r="3.6" fill="url(#sc-g-brassv)" stroke="#4a3810" stroke-width=".6"></circle>
<path d="M20 36.5 L246 33 H274 L500 36.5 V43.5 L274 47 H246 L20 43.5 Z" fill="url(#sc-g-brassv)" stroke="#4a3810" stroke-width=".9"></path>
<path d="M30 37.6 L246 34.4 M274 34.4 L490 37.6" stroke="rgba(255,248,220,.75)" stroke-width="1"></path>
<path d="M58 40 H232 M288 40 H462" stroke="rgba(74,56,16,.55)" stroke-width="1.6" stroke-dasharray="1.2 9.4"></path>
<circle cx="13" cy="40" r="4.2" fill="url(#sc-g-brassv)" stroke="#4a3810" stroke-width=".6"></circle>
<circle cx="507" cy="40" r="4.2" fill="url(#sc-g-brassv)" stroke="#4a3810" stroke-width=".6"></circle>
<circle cx="20" cy="40" r="5" fill="#1a1208" stroke="#e0bf68" stroke-width="2.4"></circle>
<circle cx="500" cy="40" r="5" fill="#1a1208" stroke="#e0bf68" stroke-width="2.4"></circle>
<rect x="244" y="27" width="32" height="26" rx="4" fill="url(#sc-g-brassd)" stroke="#3a2c10" stroke-width=".9"></rect>
<path d="M251 53 L260 45 L269 53" fill="#2a1f0a"></path>
<circle cx="260" cy="40" r="4.8" fill="#8e2a1c" stroke="#3a1008" stroke-width=".8"></circle>
<circle cx="258.5" cy="38.5" r="1.4" fill="#f3a291"></circle>
</svg>
</div>
<div class="sc-latch" aria-hidden="true">
<svg viewBox="0 0 40 16"><path d="M32 5.4 H4 Q1 5.4 1 8 Q1 11.6 4.6 11.6 H6 V8.8 H32 Z" fill="#2a3442" stroke="#0a0f16" stroke-width=".7"></path><path d="M30 6.4 H5" stroke="rgba(160,190,225,.5)" stroke-width=".6"></path><circle cx="32" cy="8" r="4.2" fill="url(#sc-g-brassd)" stroke="#3a2c10" stroke-width=".8"></circle><path d="M29.6 8 H34.4" stroke="#3a2c10" stroke-width="1"></path></svg>
</div>`;

function readLog(value: unknown): Weighing[] {
  if (!Array.isArray(value)) return [];
  return value.filter((w) => w && Array.isArray(w.L) && Array.isArray(w.R) && (w.res === 'L' || w.res === 'R' || w.res === 'E'))
    .map((w) => ({ L: w.L.filter(Number.isInteger), R: w.R.filter(Number.isInteger), res: w.res }));
}

function mount(body: HTMLElement, ctx0: PuzzleContext): PuzzleKindHandle {
  let ctx = ctx0;
  const tr = ctx.tr;
  const p = ctx.params ?? {};
  const NV = int(p.vials, 9, 3, 9);
  const TOKENS = int(p.tokens, 2, 1, 5);
  const PER_PAN = int(p.perPan, 4, 1, 4);
  const IDS = Array.from({ length: NV }, (_, i) => i + 1);
  const WORD: Record<Res, string> = { E: tr('balanced', 'cân bằng'), L: tr('left is heavier', 'trái nặng hơn'), R: tr('right is heavier', 'phải nặng hơn') };
  const rm = () => ctx.reducedMotion;
  const grams = typeof p.grams === 'number' ? p.grams : 20;
  const noteLines: string[] = Array.isArray(p.noteLines) && p.noteLines.length ? p.noteLines.slice(0, 3).map(String) : [tr('Topped up', 'Pha thêm'), '— K.'];
  const text = {
    mineTag: p.mineTag || tr('PRIVATE · INVESTIGATOR', 'RIÊNG · ĐIỀU TRA VIÊN'),
    bookTitle: p.bookTitle || tr('Pharmacy ledger', 'Sổ hiệu thuốc'),
    bookText: p.bookText || tr(`${NV} vials from one batch, exactly ${grams} grams each.`, `${NUMBER_WORD[NV] ?? NV} lọ cùng một mẻ, mỗi lọ đúng ${grams} gam.`),
    partnerMono: p.partnerMono || 'TV',
    partnerTag: p.partnerTag || tr('SHARED · INTERROGATOR', 'ĐÃ CHIA SẺ · THẨM VẤN VIÊN'),
    partnerQuote: p.partnerQuote || tr('The apprentice says only one vial was swapped — it feels a little heavier in the hand.', 'Người học việc khai: chỉ một lọ bị đổi, cầm lên thấy nặng tay hơn một chút.'),
    ledger: p.ledgerTitle || tr('Weighing log', 'Sổ cân'),
    shop: p.shop || tr('PHARMACY', 'HIỆU THUỐC'),
    shopName: p.shopName || 'HƯNG LONG',
    batch: p.batch || tr('BATCH 14', 'MẺ 14'),
    capInsp: p.capInspect || tr('The edge of the printed label bulges a little… peel it.', 'Mép nhãn in hơi phồng… bóc thử.'),
    capPeel: p.capPeel || tr(`Under the printed label is a handwritten one: ‘${noteLines.join(' ')}’`, `Dưới nhãn in là một nhãn viết tay: ‘${noteLines.join(' ')}’`),
    capWrong: p.capWrong || tr('The printed label is stuck fast — only glass underneath.', 'Nhãn in dán chặt, bên dưới chỉ có thủy tinh.'),
    solvedText: p.solvedText || '',
  };

  /* shelf spots (cqw of the scene): one row on desktop, two rows on phones — centred for any vial count */
  const SHD: Record<number, [number, number]> = {};
  const SHM: Record<number, [number, number]> = {};
  const top = Math.ceil(NV / 2);
  IDS.forEach((i) => {
    SHD[i] = [r2(50 + (i - (NV + 1) / 2) * 9.2), 19.6];
    const row = i <= top ? 0 : 1;
    const inRow = row === 0 ? top : NV - top;
    const j = row === 0 ? i - 1 : i - top - 1;
    SHM[i] = [r2(50 + (j - (inRow - 1) / 2) * 19), row === 0 ? 20.5 : 41];
  });
  const coinStyle = (k: number) => `--rxd: ${r2(90 + (k - (TOKENS - 1) / 2) * 3.6)}cqw; --ryd: 51.9cqw; --rxm: ${r2(88 + (k - (TOKENS - 1) / 2) * 3.6)}cqw; --rym: 93.7cqw`;
  const vialSvg = (i: number) => `<svg class="sc-vart" viewBox="0 0 48 96" aria-hidden="true"><ellipse class="sc-vglow" cx="24" cy="93" rx="26" ry="6" fill="url(#sc-g-glow)"></ellipse><ellipse class="sc-vsh" cx="24" cy="94.4" rx="18" ry="2.3" fill="rgba(0,0,0,.55)"></ellipse><g class="sc-vlift"><use href="#sc-vial-glass"></use><use href="#sc-vial-label"></use><text class="sc-vns" x="24" y="61.2">Nº</text><text class="sc-vno" x="24" y="78">${i}</text></g></svg>`;
  const batchSvg = () => {
    // the card's little drawing: N identical vials = one 20 g weight each
    const n = Math.min(NV, 9);
    let glass = '', caps = '', labels = '';
    for (let k = 0; k < n; k++) {
      const x = 9 + 16 * k;
      glass += `M${x} 20 h4 v3 c0 2 5 2.5 5 6.5 v17 q0 2.5 -2.5 2.5 h-9 q-2.5 0 -2.5 -2.5 v-17 c0 -4 5 -4.5 5 -6.5 z `;
      caps += `M${x} 15 h4 v5 h-4 z `;
      labels += `M${x - 2.5} 34 h9 v8 h-9 z `;
    }
    return `<svg class="sc-batch" viewBox="0 0 248 60" role="img" aria-label="${esc(tr(`Identical vials, each weighing exactly one ${grams} g weight.`, `Các lọ thuốc giống hệt nhau, mỗi lọ nặng đúng một quả cân ${grams} gam.`))}">
      <g stroke="#3a1a04" stroke-width=".7"><path d="${glass}" fill="url(#sc-g-amber)"></path></g>
      <path d="${caps}" fill="#8c6a43"></path>
      <path d="${labels}" fill="#efe4c8"></path>
      <path d="M4 55 Q4 58 8 58 H70 Q75 58 76 60 Q77 58 82 58 H144 Q148 58 148 55" fill="none" stroke="#5b5248" stroke-width="1"></path>
      <path d="M156 36 H176 M171 31.5 L176.5 36 L171 40.5" fill="none" stroke="#5b5248" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path>
      <ellipse cx="212" cy="50" rx="25" ry="5.5" fill="#4a3810"></ellipse>
      <path d="M187 27 V50 A25 5.5 0 0 0 237 50 V27 Z" fill="url(#sc-g-brassh)" stroke="#3a2c10" stroke-width=".8"></path>
      <ellipse cx="212" cy="27" rx="25" ry="5.5" fill="#ecd48c" stroke="#3a2c10" stroke-width=".8"></ellipse>
      <path d="M207 27 V18 Q207 14 212 14 Q217 14 217 18 V27" fill="url(#sc-g-brassh)" stroke="#3a2c10" stroke-width=".8"></path>
      <circle cx="212" cy="12" r="4.6" fill="url(#sc-g-brassv)" stroke="#3a2c10" stroke-width=".8"></circle>
      <text x="212" y="44" text-anchor="middle" font-family="Source Code Pro, monospace" font-size="12" font-weight="700" fill="#2b1d08">${grams} g</text>
    </svg>`;
  };

  body.innerHTML = `
    <div class="sc-left">
      <aside class="sc-clues" aria-label="${esc(tr('Clues about the vials', 'Manh mối về các lọ thuốc'))}">
        <article class="pz-card s-paper sc-card-a">
          <span class="s-pin red" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
          <span class="pz-tag mine" style="margin-top: 0">${esc(text.mineTag)}</span>
          <h3 style="margin-top: 4px">${esc(text.bookTitle)}</h3>
          <p style="text-wrap: balance">${esc(text.bookText)}</p>
          ${batchSvg()}
        </article>
        <article class="pz-card s-paper sc-card-b">
          <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
          <div class="sc-from"><span class="g-mono rust" aria-hidden="true">${esc(text.partnerMono)}</span><span class="pz-tag partner" style="margin-top: 0">${esc(text.partnerTag)}</span></div>
          <p class="sc-quote">${esc(text.partnerQuote)}</p>
        </article>
      </aside>
      <article class="sc-ledger s-paper" aria-label="${esc(text.ledger)}">
        <span class="s-pin gold" aria-hidden="true" style="top: -8px; left: 50%; margin-left: -9px"></span>
        <div class="sc-lg-head"><h3>${esc(text.ledger)}</h3><span class="sc-lg-pg" data-sc="page"></span></div>
        <ol class="sc-lg" data-sc="ledger">
          ${Array.from({ length: TOKENS }, (_, k) => `<li data-sc-row="${k}"><span class="sc-lg-m" aria-hidden="true">${k + 1}</span><span class="sc-lg-w"></span><span class="sc-lg-r"></span><span class="sc-lg-e">${esc(tr(`Weighing ${k + 1} · not yet`, `Lần ${k + 1} · chưa cân`))}</span></li>`).join('')}
          <li data-sc-row="pick"><span class="sc-lg-m" aria-hidden="true">✓</span><span class="sc-lg-w"></span><span class="sc-lg-r"></span><span class="sc-lg-e">${esc(tr('Point out · …', 'Chỉ ra · …'))}</span></li>
        </ol>
      </article>
    </div>

    <section class="sc-sec" aria-label="${esc(tr('Counter with a balance and the vials', 'Quầy thuốc với cân tiểu ly và các lọ thuốc'))}">
      ${SVG_DEFS}
      <div class="sc-mat" data-sc="mat">
        <div class="sc-top">
          <p class="sc-prog"><span>${esc(tr('TOKENS LEFT', 'THẺ CÂN CÒN'))}</span><span class="sc-pips" aria-hidden="true">${Array.from({ length: TOKENS }, () => '<i class="sc-pip"></i>').join('')}</span><span data-sc="tokens"></span></p>
          <p class="sc-top-hint">${esc(tr('Drag vials onto the pans — or Tab to a vial, press L / R, then Enter to weigh.', 'Kéo lọ lên đĩa — hoặc Tab tới lọ, bấm L / R, rồi Enter để cân.'))}</p>
        </div>
        <div class="sc-xwrap">
          <div class="sc-scene" data-sc="scene">
            ${SVG_BG}
            <div class="sc-pan side-L" aria-hidden="true" data-sc-pan="L"><svg viewBox="0 0 200 165"><ellipse class="sc-dglow" cx="100" cy="150" rx="110" ry="22" fill="url(#sc-g-glow)"></ellipse><use href="#sc-g-panback"></use></svg></div>
            <div class="sc-pan side-R" aria-hidden="true" data-sc-pan="R"><svg viewBox="0 0 200 165"><ellipse class="sc-dglow" cx="100" cy="150" rx="110" ry="22" fill="url(#sc-g-glow)"></ellipse><use href="#sc-g-panback"></use></svg></div>
            ${SVG_BEAM}
            ${Array.from({ length: TOKENS }, (_, k) => `<span class="sc-coin" data-sc-coin="${k}" style="${coinStyle(k)}" aria-hidden="true"><svg viewBox="0 0 26 26"><use href="#sc-g-coin"></use></svg></span>`).join('')}
            <span class="sc-cach" aria-hidden="true">${esc(tr('clack!', 'cạch!'))}</span>
            ${IDS.map((i) => `<button type="button" class="sc-vial on-shelf" data-sc-vial="${i}" aria-describedby="sc-help">${vialSvg(i)}</button>`).join('')}
            <div class="sc-panfront side-L" aria-hidden="true"><svg viewBox="0 0 200 165"><use href="#sc-g-panfront"></use></svg></div>
            <div class="sc-panfront side-R" aria-hidden="true"><svg viewBox="0 0 200 165"><use href="#sc-g-panfront"></use></svg></div>
            <div class="sc-pickdim" aria-hidden="true"><span><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6.5"></circle><path d="M15 15 L21 21"></path></svg>${esc(tr('POINT OUT THE SWAPPED VIAL — CLICK ONE', 'CHỈ RA LỌ BỊ TRÁO — BẤM VÀO MỘT LỌ'))}</span></div>
            <span class="sc-verdict" data-sc="verdict" aria-hidden="true"></span>
            <div class="sc-glare" aria-hidden="true"></div>
          </div>
          <div class="sc-insp" data-sc="insp" aria-hidden="true">
            <div class="sc-insp-in">
              <p class="sc-insp-k" data-sc="inspK"></p>
              <figure class="sc-big" style="margin: 0">
                <div class="sc-big-in">
                  <svg class="sc-big-svg" viewBox="0 0 48 96" aria-hidden="true"><use href="#sc-vial-glass"></use></svg>
                  <div class="sc-lh">${noteLines.map((line) => `<span>${esc(line)}</span>`).join('')}<i></i></div>
                  <div class="sc-lp"><span class="sc-lp-a">${esc(text.shop)}</span><b>${esc(text.shopName)}</b><span class="sc-lp-n" data-sc="lpNo"></span><span class="sc-lp-a">${esc(`${grams} g · ${text.batch}`)}</span></div>
                  <div class="sc-flap"></div>
                  <span class="sc-soat" aria-hidden="true">${esc(tr('rrrip…', 'soạt…'))}</span>
                  <span class="sc-wstamp" aria-hidden="true">${esc(tr('WRONG VIAL', 'SAI LỌ'))}</span>
                </div>
              </figure>
              <p class="sc-insp-cap" data-sc="inspCap"></p>
            </div>
          </div>
        </div>

        <div class="sc-ctl">
          <p class="sc-read">
            <svg class="sc-read-ic" viewBox="0 0 36 30" aria-hidden="true"><path d="M18 4 V25 M11 27 H25 M4 8 H32" fill="none" stroke="#c7a24b" stroke-width="1.8" stroke-linecap="round"></path><path d="M4 8 L1 17 H7 Z M32 8 L29 17 H35 Z" fill="none" stroke="#c7a24b" stroke-width="1.4" stroke-linejoin="round"></path><circle cx="18" cy="4" r="2" fill="#efd486"></circle></svg>
            <span class="sc-read-tx"><span class="sc-read-k" data-sc="readKick"></span><b data-sc="readMain"></b></span>
            <span class="sc-eq" data-sc="eq"></span>
          </p>
          <div class="sc-mvs" role="group" aria-label="${esc(tr('Place the selected vial', 'Đặt lọ đang chọn'))}">
            <button type="button" class="sc-mv" data-sc-act="toL" aria-keyshortcuts="L"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M8 1 L2 6 L8 11 Z"></path></svg>${esc(tr('Left pan', 'Đĩa trái'))} <span class="pz-kbd" aria-hidden="true">L</span></button>
            <button type="button" class="sc-mv" data-sc-act="toR" aria-keyshortcuts="R">${esc(tr('Right pan', 'Đĩa phải'))} <span class="pz-kbd" aria-hidden="true">R</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 1 L10 6 L4 11 Z"></path></svg></button>
            <button type="button" class="sc-mv" data-sc-act="toS" aria-keyshortcuts="Delete">${esc(tr('Back to shelf', 'Về kệ'))} <span class="pz-kbd" aria-hidden="true">Del</span></button>
            <button type="button" class="sc-mv sc-clear" data-sc-act="clear">${esc(tr('Clear pans', 'Dọn đĩa'))}</button>
          </div>
        </div>
        <div class="sc-acts">
          <span class="sc-tries" data-sc="tries"></span>
          <button type="button" class="s-btn s-btn-gold sc-pickb" data-sc-act="pick" aria-keyshortcuts="P">${esc(tr('Point out the swapped vial', 'Chỉ ra lọ bị tráo'))} <span class="pz-kbd" aria-hidden="true">P</span></button>
          <button type="button" class="s-btn s-btn-red sc-weigh" data-sc-act="weigh" aria-keyshortcuts="Enter">${esc(tr('Weigh', 'Cân'))} <span class="pz-kbd" aria-hidden="true">Enter</span></button>
        </div>
        <p id="sc-help" class="s-sr">${esc(tr(
          'Each vial is a button. L or R puts it on the left or right pan, Delete returns it to the shelf, the left and right arrows move to the next vial. Enter weighs when both pans hold the same number of vials. P switches to pointing out the swapped vial, then Enter on the vial you choose. You can also drag the vials with the mouse or a finger.',
          'Mỗi lọ là một nút. Phím L hoặc R đặt lọ lên đĩa trái hoặc đĩa phải, Delete trả lọ về kệ, mũi tên trái phải chuyển sang lọ bên cạnh. Enter để cân khi hai đĩa có số lọ bằng nhau. Phím P để chuyển sang chỉ ra lọ bị tráo, rồi Enter trên lọ cần chỉ ra. Có thể kéo thả lọ bằng chuột hoặc ngón tay.'))}</p>
      </div>
    </section>`;

  const $ = (name: string) => body.querySelector<HTMLElement>(`[data-sc="${name}"]`)!;
  const el = {
    mat: $('mat'), scene: $('scene'), tokens: $('tokens'), verdict: $('verdict'), insp: $('insp'), inspK: $('inspK'), inspCap: $('inspCap'), lpNo: $('lpNo'),
    readKick: $('readKick'), readMain: $('readMain'), eq: $('eq'), tries: $('tries'), page: $('page'),
  };
  const vEls: Record<number, HTMLButtonElement> = {};
  IDS.forEach((i) => { vEls[i] = body.querySelector<HTMLButtonElement>(`[data-sc-vial="${i}"]`)!; });
  const pips = [...body.querySelectorAll<HTMLElement>('.sc-pip')];
  const coins = [...body.querySelectorAll<HTMLElement>('[data-sc-coin]')];
  const rows = [...body.querySelectorAll<HTMLElement>('[data-sc-row]')];
  const acts = (name: string) => body.querySelector<HTMLButtonElement>(`[data-sc-act="${name}"]`)!;
  const veil = (body.closest('[data-pzh-kind]') as HTMLElement | null) ?? body;

  // ----- state (the mockup's, plus the server round) -----
  const allShelf = () => { const loc: Record<number, Side> = {}; IDS.forEach((i) => { loc[i] = 'S'; }); return loc; };
  const runOf = (run: PuzzleRunView | null | undefined) => ({
    tokens: typeof run?.tokensLeft === 'number' ? Math.max(0, Math.min(TOKENS, run.tokensLeft as number)) : TOKENS,
    round: typeof run?.round === 'number' ? (run.round as number) : 0,
    log: readLog(run?.log),
  });
  const start = runOf(ctx.run);
  let s = {
    loc: allShelf(), panL: [] as number[], panR: [] as number[], sel: 0, tokens: start.tokens, log: start.log, cur: null as Weighing | null, res: 'E' as Res, tilt: 0,
    phase: (start.tokens > 0 ? 'load' : 'pick') as Phase, picked: 0, wrongId: 0, attempts: ctx.run?.attempts ?? 0, page: start.round + 1, pgN: 0, msg: '', msgText: '', shakeN: 0,
    hop: {} as Record<number, number>, hopN: 0, coinBack: 0, bump: 0, newRow: -1, dragId: 0, dx: 0, dy: 0, zone: '' as Side | '', round: start.round,
  };
  type State = typeof s;
  let timers: number[] = [];
  let raf = 0;
  let drag: { id: number; pid: number; x0: number; y0: number; x: number; y: number; ox: number; oy: number; g: Geom; on: boolean } | null = null;
  let suppress = { id: 0, at: 0 }; // the click that follows a drop on the dragged vial
  let busy = false;          // a probe / submit is in flight
  let dead = false;
  let lastStatus = '';
  let latestRun: PuzzleRunView | null = ctx.run;

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => { timers = timers.filter((x) => x !== t); if (!dead) fn(); }, ms);
    timers.push(t);
    return t;
  };
  const clearTimers = () => { timers.forEach((t) => clearTimeout(t)); timers = []; };
  const stopDrag = () => { if (raf) cancelAnimationFrame(raf); raf = 0; drag = null; };
  const set = (patch: Partial<State>) => { s = { ...s, ...patch }; paint(); };
  const shake = (msg: string, msgText = '') => set({ msg, msgText, shakeN: s.shakeN + 1, dragId: 0 });

  // ----- moving vials -----
  function place(id: number, where: Side | '', viaDrag = false) {
    if (s.phase !== 'load') return;
    const from = s.loc[id] || 'S';
    const patch: Partial<State> = { dragId: 0, zone: '', sel: 0, msg: '' };
    if (!where || where === from) { set(patch); return; }
    let panL = s.panL.filter((x) => x !== id);
    let panR = s.panR.filter((x) => x !== id);
    if ((where === 'L' && panL.length >= PER_PAN) || (where === 'R' && panR.length >= PER_PAN)) { set({ ...patch, msg: 'full', shakeN: s.shakeN + 1 }); return; }
    if (where === 'L') panL = panL.concat([id]);
    if (where === 'R') panR = panR.concat([id]);
    const loc = { ...s.loc, [id]: where };
    const hop: Record<number, number> = {};
    if (!viaDrag && !rm()) hop[id] = 0;
    set({ ...patch, loc, panL, panR, hop, hopN: viaDrag ? s.hopN : s.hopN + 1 });
  }
  function placeSel(where: Side) {
    if (s.phase === 'pick') { set({ msg: 'inpick' }); return; }
    if (s.phase !== 'load') return;
    if (!s.sel) { shake('nosel'); return; }
    place(s.sel, where);
  }
  function backAll(patch: Partial<State> = {}): Partial<State> {
    const moved = s.panL.concat(s.panR);
    const hop: Record<number, number> = {};
    if (!rm()) moved.forEach((id, k) => { hop[id] = k * 70; });
    return { loc: allShelf(), panL: [], panR: [], hop, hopN: moved.length ? s.hopN + 1 : s.hopN, sel: 0, dragId: 0, zone: '', ...patch };
  }
  function clearPans() {
    if (s.phase !== 'load' || !(s.panL.length + s.panR.length)) return;
    set(backAll({ msg: '' }));
  }

  // ----- weighing (judged on the server) -----
  function weigh() {
    if (s.phase === 'pick') { shake(s.tokens > 0 ? 'inpick' : 'notoken'); return; }
    if (s.phase !== 'load' || busy) return;
    const Lp = s.panL, Rp = s.panR;
    let bad = '';
    if (!(s.tokens > 0)) bad = 'notoken';
    else if (!Lp.length || !Rp.length) bad = 'empty';
    else if (Lp.length !== Rp.length) bad = 'uneq';
    if (bad) { shake(bad); return; }
    clearTimers();
    stopDrag();
    busy = true;
    const sent = { L: Lp.slice().sort(num), R: Rp.slice().sort(num) };
    const t0 = Date.now();
    set({ cur: null, sel: 0, msg: '', hop: {}, dragId: 0, zone: '', phase: 'coin', tilt: 0, tokens: Math.max(0, s.tokens - 1) });
    ctx.probe({ left: sent.L, right: sent.R }).then((result) => {
      if (dead) return;
      const fb = result.feedback ?? {};
      if (fb.res !== 'L' && fb.res !== 'R' && fb.res !== 'E') {
        busy = false;
        refused(fb, result.message);
        return;
      }
      const res = fb.res as Res;
      const cur: Weighing = { ...sent, res };
      const tilt = res === 'L' ? -TILT : (res === 'R' ? TILT : 0);
      const tokens = typeof fb.tokensLeft === 'number' ? fb.tokensLeft : s.tokens;
      if (rm()) {
        set({ phase: 'result', tilt, cur, res, tokens, log: s.log.concat([cur]), newRow: s.log.length });
        later(() => returnVials(), 1800);
        return;
      }
      const wait = Math.max(0, 820 - (Date.now() - t0));
      later(() => set({ phase: 'swing', tilt, cur, res, tokens }), wait);
      later(() => set({ phase: 'result', log: s.log.concat([cur]), newRow: s.log.length }), wait + 2350);
      later(() => returnVials(), wait + 2350 + 1550);
    }).catch((error: any) => {
      if (dead) return;
      busy = false;
      refused({}, error?.message || tr('Could not reach the server — try again.', 'Không cân được — thử lại.'));
    });
  }
  function refused(fb: any, message?: string) {
    const tokens = typeof fb?.tokensLeft === 'number' ? fb.tokensLeft : s.tokens + 1;
    set({ phase: tokens > 0 ? 'load' : 'pick', tokens, coinBack: s.coinBack + 1, msg: 'refused', msgText: message || '', shakeN: s.shakeN + 1, tilt: 0, cur: null });
  }
  function returnVials() {
    const n = s.panL.length + s.panR.length;
    const next: Phase = s.tokens > 0 ? 'load' : 'pick';
    const patch = backAll({ tilt: 0, msg: next === 'pick' ? '' : 'res' });
    if (rm()) { busy = false; set({ ...patch, phase: next }); reconcile(); return; }
    set({ ...patch, phase: 'return' });
    later(() => { busy = false; set({ phase: next }); reconcile(); }, 760 + n * 70);
  }

  // ----- pointing out the swapped vial (judged on the server) -----
  function togglePick() {
    if (s.phase === 'load') { set(backAll({ phase: 'pick', msg: '' })); return; }
    if (s.phase === 'pick') {
      if (s.tokens > 0) set({ phase: 'load', msg: '' });
      else shake('nopick');
    }
  }
  function pickVial(id: number) {
    if (s.phase !== 'pick' || busy) return;
    clearTimers();
    busy = true;
    set({ phase: 'insp', picked: id, msg: '' });
    const ask = () => ctx.submit({ pick: id }).then((result) => {
      if (dead) return;
      if (result.solved) {
        if (rm()) { set({ phase: 'solved' }); return; }
        set({ phase: 'peel' });
        later(() => set({ phase: 'solved' }), 2250);
        return;
      }
      const fb = result.feedback ?? {};
      if (fb.right === false) {
        set({ phase: 'wrong', msgText: result.message || '' });
        later(() => resetWrong(fb), rm() ? 2200 : 2400);
        return;
      }
      busy = false;
      set({ phase: 'pick', picked: 0, msg: 'refused', msgText: result.message || '', shakeN: s.shakeN + 1 });
    }).catch((error: any) => {
      if (dead) return;
      busy = false;
      set({ phase: 'pick', picked: 0, msg: 'refused', msgText: error?.message || tr('Could not reach the server — try again.', 'Không gửi được — thử lại.'), shakeN: s.shakeN + 1 });
    });
    // the label close-up comes first; the answer is sent while the edge of the label lifts
    if (rm()) void ask(); else later(() => { void ask(); }, 650);
  }
  function resetWrong(fb: any) {
    const hop: Record<number, number> = {};
    if (!rm()) IDS.forEach((i, k) => { hop[i] = (k % 2 ? 4 - (k >> 1) : (k >> 1)) * 55 + k * 18; });
    busy = false;
    set({ phase: 'load', loc: allShelf(), panL: [], panR: [], tokens: typeof fb.tokensLeft === 'number' ? fb.tokensLeft : TOKENS, log: [], newRow: -1, cur: null, tilt: 0, sel: 0,
      wrongId: s.picked, picked: 0, attempts: s.attempts + 1, bump: s.bump + 1, page: s.page + 1, pgN: s.pgN + 1, round: typeof fb.round === 'number' ? fb.round : s.round + 1,
      coinBack: s.coinBack + 1, hop, hopN: s.hopN + 1, msg: 'wrong' });
  }

  /** Adopts what the partner did (a weighing or a wrong pick) once this board is idle. */
  function reconcile() {
    if (busy || !latestRun || (s.phase !== 'load' && s.phase !== 'pick')) return;
    const run = runOf(latestRun);
    if (typeof latestRun.round === 'number' && run.round !== s.round) {
      set({ ...backAll(), phase: run.tokens > 0 ? 'load' : 'pick', tokens: run.tokens, log: run.log, round: run.round, page: run.round + 1, pgN: s.pgN + 1, coinBack: s.coinBack + 1,
        newRow: -1, cur: null, tilt: 0, attempts: latestRun.attempts ?? s.attempts, msg: 'partnerWrong' });
      return;
    }
    if (Array.isArray(latestRun.log) && run.log.length > s.log.length) {
      const last = run.log[run.log.length - 1];
      set({ log: run.log, tokens: run.tokens, newRow: run.log.length - 1, cur: last, res: last.res, phase: s.phase === 'load' && run.tokens === 0 ? 'pick' : s.phase, msg: 'partner' });
    }
  }

  // ----- pointer: drag a vial between shelf and pans (rAF-throttled) -----
  interface Geom { left: number; top: number; w: number; h: number; phone: boolean }
  function geom(): Geom | null {
    const r = el.scene.getBoundingClientRect();
    if (!r.width) return null;
    return { left: r.left, top: r.top, w: r.width, h: r.height, phone: r.height / r.width > 0.8 };
  }
  const units = (cx: number, cy: number, g: Geom) => ({ x: (cx - g.left) / g.w * 1000, y: (cy - g.top) / g.w * 1000 });
  function zoneAt(pt: { x: number; y: number }, phone: boolean): Side | '' {
    if (pt.y < (phone ? 545 : 238)) return 'S';
    if (pt.y > (phone ? 1000 : 560)) return '';
    if (pt.x > 15 && pt.x < 468) return 'L';
    if (pt.x > 532 && pt.x < 985) return 'R';
    return '';
  }
  function onDown(e: PointerEvent) {
    const v = (e.target as HTMLElement).closest<HTMLElement>('[data-sc-vial]');
    if (!v || s.phase !== 'load') return;
    if (e.button != null && e.button !== 0) return;
    const g = geom();
    if (!g) return;
    const r = v.getBoundingClientRect();
    const ax = (r.left + r.right) / 2, ay = r.bottom;
    drag = { id: Number(v.dataset.scVial), pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, ox: (ax - e.clientX) / g.w * 1000, oy: (ay - e.clientY) / g.w * 1000, g, on: false };
    try { v.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  function onMove(e: PointerEvent) {
    const d = drag;
    if (!d || d.pid !== e.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.on) {
      if (Math.abs(d.x - d.x0) + Math.abs(d.y - d.y0) < 7) return;
      d.on = true;
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; dragFrame(); });
  }
  function dragFrame() {
    const d = drag;
    if (!d || !d.on) return;
    if (s.phase !== 'load') { drag = null; set({ dragId: 0, zone: '' }); return; }
    const pt = units(d.x, d.y, d.g);
    const maxY = d.g.h / d.g.w * 1000;
    const x = Math.max(30, Math.min(970, pt.x + d.ox));
    const y = Math.max(110, Math.min(maxY - 4, pt.y + d.oy));
    set({ dragId: d.id, dx: Math.round(x) / 10, dy: Math.round(y) / 10, zone: zoneAt(pt, d.g.phone), sel: 0, msg: '' });
  }
  function onUp(e: PointerEvent) {
    const d = drag;
    if (!d || d.pid !== e.pointerId) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    drag = null;
    try { (e.target as HTMLElement).closest<HTMLElement>('[data-sc-vial]')?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d.on) return;
    suppress = { id: d.id, at: Date.now() };
    const zone = e.type === 'pointercancel' ? '' : zoneAt(units(d.x, d.y, d.g), d.g.phone);
    place(d.id, zone, true);
  }
  function vClick(i: number) {
    if (suppress.id === i && Date.now() - suppress.at < 450) return;
    if (s.phase === 'pick') { pickVial(i); return; }
    if (s.phase !== 'load') return;
    const on = s.sel === i;
    set({ sel: on ? 0 : i, msg: on ? '' : 'sel' });
  }
  function vKey(i: number, e: KeyboardEvent) {
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); if (s.phase === 'pick') pickVial(i); else weigh(); return; }
    if (k === 'l' || k === 'L') { e.preventDefault(); place(i, 'L'); return; }
    if (k === 'r' || k === 'R') { e.preventDefault(); place(i, 'R'); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); place(i, 'S'); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      const j = Math.max(1, Math.min(NV, i + (k === 'ArrowLeft' ? -1 : 1)));
      vEls[j]?.focus({ preventScroll: true });
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const vial = target?.closest<HTMLElement>('[data-sc-vial]');
    if (vial && body.contains(vial)) { vKey(Number(vial.dataset.scVial), e); if (e.defaultPrevented) return; }
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePick(); }
  }
  function onClick(e: Event) {
    const t = e.target as HTMLElement;
    const v = t.closest<HTMLElement>('[data-sc-vial]');
    if (v) { vClick(Number(v.dataset.scVial)); return; }
    const pan = t.closest<HTMLElement>('[data-sc-pan]');
    if (pan) { placeSel(pan.dataset.scPan as Side); return; }
    const act = t.closest<HTMLElement>('[data-sc-act]');
    if (!act) return;
    switch (act.dataset.scAct) {
      case 'toL': placeSel('L'); break;
      case 'toR': placeSel('R'); break;
      case 'toS': placeSel('S'); break;
      case 'clear': clearPans(); break;
      case 'pick': togglePick(); break;
      case 'weigh': weigh(); break;
    }
  }

  // ----- view -----
  const put = (node: Element | null | undefined, prop: string, value: string) => {
    if (!node) return;
    if (prop === 'class') { if (node.getAttribute('class') !== value) node.setAttribute('class', value); return; }
    if (prop === 'text') { if (node.textContent !== value) node.textContent = value; return; }
    if (prop.startsWith('@')) { if (node.getAttribute(prop.slice(1)) !== value) node.setAttribute(prop.slice(1), value); return; }
    const style = (node as HTMLElement).style;
    if (style.getPropertyValue(prop) !== value) style.setProperty(prop, value);
  };
  const fmt = (w: Weighing) => w.L.join(' ') + ' | ' + w.R.join(' ');

  function status(): [string, string, 'info' | 'ok' | 'bad'] {
    const { phase, log } = s;
    const nL = s.panL.length, nR = s.panR.length;
    const last = log[log.length - 1];
    const cur = s.cur;
    if (phase === 'coin') return [tr('DROPPING THE TOKEN', 'THẢ THẺ ĐỒNG'), tr('The token drops into the slot — the needle catch lets go.', 'Thẻ rơi vào khe — chốt giữ kim nhả ra.'), 'info'];
    if (phase === 'swing') return [tr('WEIGHING', 'ĐANG CÂN'), tr('The beam swings… ', 'Cán cân dao động… ') + (cur ? fmt(cur) : ''), 'info'];
    if ((phase === 'result' || phase === 'return') && last) return [tr(`WEIGHING ${log.length}`, `LẦN ${log.length}`), `${fmt(last)} → ${WORD[last.res]}.` + (phase === 'return' ? tr(' The vials go back to the shelf.', ' Các lọ trở về kệ.') : ''), 'ok'];
    if (phase === 'insp') return [tr('CHECKING THE LABEL', 'SOI NHÃN'), tr(`Peeling the printed label of vial Nº ${s.picked}…`, `Bóc thử nhãn in của lọ Nº ${s.picked}…`), 'info'];
    if (phase === 'peel') return [tr('A SECOND LABEL', 'CÓ NHÃN THỨ HAI'), tr(`Under the printed label of vial Nº ${s.picked} is a handwritten one.`, `Dưới nhãn in của lọ Nº ${s.picked} là một nhãn viết tay.`), 'ok'];
    if (phase === 'wrong') return [tr('WRONG VIAL', 'SAI LỌ'), tr(`The label of vial Nº ${s.picked} is stuck fast — nothing underneath.`, `Nhãn lọ Nº ${s.picked} dán chặt — bên dưới không có gì.`), 'bad'];
    if (phase === 'solved') return [tr('FOUND IT', 'ĐÃ TÌM RA'), text.solvedText || tr(`Vial Nº ${s.picked} is heavier — added to the case file.`, `Lọ Nº ${s.picked} nặng hơn — đã thêm vào hồ sơ.`), 'ok'];
    if (s.msg === 'refused') return [tr('NOT DONE', 'CHƯA ĐƯỢC'), s.msgText || tr('Try again.', 'Thử lại.'), 'bad'];
    if (s.msg === 'partnerWrong') return [tr('RESHUFFLED', 'ĐÃ XẾP LẠI'), tr('Your partner pointed at the wrong vial — the vials were shuffled and the tokens returned.', 'Đồng đội chỉ sai lọ — các lọ đã bị xếp lại, thẻ cân được trả lại.'), 'bad'];
    if (s.msg === 'partner' && last) return [tr(`WEIGHING ${log.length}`, `LẦN ${log.length}`), tr(`Your partner weighed: ${fmt(last)} → ${WORD[last.res]}.`, `Đồng đội đã cân: ${fmt(last)} → ${WORD[last.res]}.`), 'ok'];
    if (phase === 'pick') {
      if (s.msg === 'nopick') return [tr('NO TOKENS LEFT', 'HẾT THẺ CÂN'), tr('No weighings left — all that remains is to point out the swapped vial.', 'Không còn lượt cân — chỉ còn cách chỉ ra lọ bị tráo.'), 'info'];
      if (s.msg === 'inpick' || s.msg === 'notoken') return [tr('POINTING OUT', 'ĐANG CHỈ RA LỌ'), s.tokens > 0 ? tr('Press “Point out the swapped vial” (P) again to keep weighing.', 'Bấm lại “Chỉ ra lọ bị tráo” (P) nếu muốn cân tiếp.') : tr('No tokens left — point out the swapped vial.', 'Hết thẻ cân — hãy chỉ ra lọ bị tráo.'), 'info'];
      if (s.tokens > 0) return [tr('POINT OUT', 'CHỈ RA LỌ'), tr('Click the swapped vial (or Tab to it and press Enter). Press the button again to keep weighing.', 'Bấm vào lọ bị tráo (hoặc Tab tới lọ rồi Enter). Bấm lại nút để cân tiếp.'), 'info'];
      return [tr('NO TOKENS LEFT', 'HẾT THẺ CÂN'), tr('Point out the swapped vial: click a vial on the shelf, or Tab to it and press Enter.', 'Chỉ ra lọ bị tráo: bấm vào một lọ trên kệ, hoặc Tab tới lọ rồi Enter.'), 'info'];
    }
    const m = s.msg;
    if (m === 'uneq') return [tr('CANNOT WEIGH YET', 'CHƯA CÂN ĐƯỢC'), tr(`Both pans need the same number of vials — now left ${nL}, right ${nR}.`, `Hai đĩa phải có số lọ bằng nhau — đang là trái ${nL}, phải ${nR}.`), 'info'];
    if (m === 'empty') return [tr('CANNOT WEIGH YET', 'CHƯA CÂN ĐƯỢC'), tr('Each pan needs at least one vial.', 'Mỗi đĩa cần ít nhất một lọ.'), 'info'];
    if (m === 'notoken') return [tr('NO TOKENS LEFT', 'HẾT THẺ CÂN'), tr('No weighings left.', 'Không còn lượt cân.'), 'info'];
    if (m === 'full') return [tr('PAN IS FULL', 'ĐĨA ĐÃ ĐẦY'), tr(`Each pan holds ${PER_PAN} vials at most.`, `Mỗi đĩa chỉ đặt được ${PER_PAN} lọ.`), 'info'];
    if (m === 'nosel') return [tr('NO VIAL SELECTED', 'CHƯA CHỌN LỌ'), tr('Click a vial first, then choose a pan.', 'Bấm vào một lọ trước, rồi chọn đĩa.'), 'info'];
    if (m === 'inpick') return [tr('POINT OUT', 'CHỈ RA LỌ'), tr('You are pointing out a vial.', 'Đang ở chế độ chỉ ra lọ.'), 'info'];
    if (m === 'wrong') return [tr('WRONG VIAL', 'SAI LỌ'), tr(`Vial Nº ${s.wrongId} is not the swapped one. The vials were shuffled and the tokens returned — weigh again from the start.`, `Lọ Nº ${s.wrongId} không phải lọ bị tráo. Các lọ đã bị xếp lại, thẻ cân được trả lại — cân lại từ đầu.`), 'bad'];
    if (m === 'res' && last && !nL && !nR) return [tr(`WEIGHING ${log.length}`, `LẦN ${log.length}`), tr(`${fmt(last)} → ${WORD[last.res]}. ${s.tokens} token(s) left.`, `${fmt(last)} → ${WORD[last.res]}. Còn ${s.tokens} thẻ cân.`), 'ok'];
    if (m === 'sel' && s.sel) return [tr(`SELECTED Nº ${s.sel}`, `ĐÃ CHỌN Nº ${s.sel}`), tr('Put it on the Left pan (L) or the Right pan (R) — or drag the vial.', 'Đặt lên Đĩa trái (L) hoặc Đĩa phải (R) — hoặc kéo thả lọ.'), 'info'];
    if (nL && nL === nR) return [tr('READY', 'SẴN SÀNG'), tr(`Left ${nL} · right ${nR}. Press Weigh (Enter) — it costs one brass token.`, `Trái ${nL} · phải ${nR}. Bấm Cân (Enter) — tốn một thẻ đồng.`), 'ok'];
    if (nL || nR) return [tr('LOADING', 'ĐANG XẾP'), tr(`Left ${nL} · right ${nR}. Both sides must match before you can weigh.`, `Trái ${nL} · phải ${nR}. Hai bên phải bằng nhau mới cân được.`), 'info'];
    return [tr('GET READY', 'CHUẨN BỊ'), tr('Drag vials onto both pans — the same number on each side — then press Weigh.', 'Kéo lọ lên hai đĩa — mỗi bên số lọ bằng nhau — rồi bấm Cân.'), 'info'];
  }

  function paint() {
    const phase = s.phase;
    const nL = s.panL.length, nR = s.panR.length;
    const log = s.log;
    const insp = phase === 'insp' || phase === 'peel' || phase === 'wrong' || phase === 'solved';
    const swingOn = phase === 'swing' || phase === 'result';
    const busyView = phase !== 'load' && phase !== 'pick';
    const tilt = s.tilt || 0;
    const bt = swingOn ? tilt : 0;
    body.classList.toggle('sc-rm', ctx.reducedMotion);

    /* swing samples for the beam (b) and the pans relative to it (pL / pR) */
    let bs: number[], sw: number[];
    if (!tilt) { bs = LVL.map((v) => v * 3.4); sw = SWAY.map((v) => v * 2.2); }
    else { bs = DEV.map((d) => tilt * (1 + d)); sw = SWAY.map((v) => v * (tilt < 0 ? 3 : -3)); }
    put(el.scene, '--bt', `${bt}deg`);
    put(el.scene, '--ptL', `${-bt}deg`);
    put(el.scene, '--ptR', `${-bt}deg`);
    for (let k = 0; k < 8; k++) {
      put(el.scene, `--b${k}`, `${r2(bs[k])}deg`);
      put(el.scene, `--pL${k}`, `${r2(sw[k] - bs[k])}deg`);
      put(el.scene, `--pR${k}`, `${r2(-sw[k] - bs[k])}deg`);
    }
    put(el.scene, 'class', ['sc-scene', 'ph-' + phase, swingOn ? 'is-swing is-free' : '', phase === 'pick' ? 'is-pick' : '',
      s.dragId ? 'is-dragging' : '', s.zone ? 'over-' + s.zone : '', s.sel && phase === 'load' ? 'has-sel' : ''].filter(Boolean).join(' '));
    put(el.mat, 'class', 'sc-mat' + (s.shakeN ? (s.shakeN % 2 ? ' shk-a' : ' shk-b') : ''));

    /* vials */
    IDS.forEach((i) => {
      const node = vEls[i];
      const where = s.loc[i] || 'S';
      const d = SHD[i], m = SHM[i];
      const cls = ['sc-vial'];
      put(node, '--sx', `${d[0]}cqw`); put(node, '--sy', `${d[1]}cqw`); put(node, '--mx', `${m[0]}cqw`); put(node, '--my', `${m[1]}cqw`);
      if (s.dragId === i) { cls.push('is-drag'); put(node, '--dx', `${s.dx}cqw`); put(node, '--dy', `${s.dy}cqw`); }
      else if (where === 'S') cls.push('on-shelf');
      else {
        const arr = where === 'L' ? s.panL : s.panR;
        const idx = Math.max(0, arr.indexOf(i));
        cls.push('on-pan', 'side-' + where);
        put(node, '--ox', `${r2((idx - (arr.length - 1) / 2) * 4.4)}cqw`);
      }
      const hop = s.hop[i];
      if (hop != null) { cls.push(s.hopN % 2 ? 'hop-a' : 'hop-b'); put(node, '--dl', `${hop}ms`); }
      if (phase === 'load' && s.sel === i) cls.push('is-sel');
      if (insp && s.picked === i) cls.push('is-out');
      put(node, 'class', cls.join(' '));
      const spot = where === 'S' ? tr('on the shelf', 'trên kệ') : (where === 'L' ? tr('on the left pan', 'trên đĩa trái') : tr('on the right pan', 'trên đĩa phải'));
      put(node, '@aria-label', phase === 'pick' ? tr(`Vial Nº ${i} — point out this one`, `Lọ Nº ${i} — chỉ ra lọ này`) : tr(`Vial Nº ${i} — ${spot}`, `Lọ Nº ${i} — ${spot}`));
      put(node, '@aria-pressed', phase === 'load' && s.sel === i ? 'true' : 'false');
      put(node, '@aria-disabled', busyView ? 'true' : 'false');
    });

    /* tokens */
    coins.forEach((node, k) => {
      let c = 'is-spent';
      if (k < s.tokens) c = 'in-dish' + (s.coinBack ? (s.coinBack % 2 ? ' back-a' : ' back-b') : '');
      else if (k === s.tokens && phase === 'coin') c = 'is-fly';
      put(node, 'class', 'sc-coin ' + c);
      put(node, 'animation-delay', k && c.includes('back') ? `${k * 0.12}s` : '');
    });
    pips.forEach((node, k) => put(node, 'class', 'sc-pip' + (s.tokens > k ? ' is-on' : '')));
    put(el.tokens, 'text', `${s.tokens}/${TOKENS}`);

    /* ledger */
    rows.forEach((row) => {
      const k = row.dataset.scRow;
      const w = row.querySelector('.sc-lg-w'), rr = row.querySelector('.sc-lg-r');
      if (k === 'pick') {
        let cls = 'is-pick is-empty', wt = '', rt = '';
        if (insp) {
          rt = phase === 'insp' ? '→ …' : (phase === 'wrong' ? tr('→ wrong vial', '→ sai lọ') : tr('→ handwritten label', '→ có nhãn viết tay'));
          cls = 'is-pick is-done is-new' + (phase === 'wrong' ? ' is-bad' : '');
          wt = tr(`Pointed · Nº ${s.picked}`, `Chỉ ra · Nº ${s.picked}`);
        }
        put(row, 'class', cls); put(w, 'text', wt); put(rr, 'text', rt);
        return;
      }
      const e = log[Number(k)];
      if (!e) { put(row, 'class', 'is-empty'); put(w, 'text', ''); put(rr, 'text', ''); return; }
      put(row, 'class', ['is-done', s.newRow === Number(k) ? 'is-new' : '', e.res === 'E' ? 'is-eq' : ''].filter(Boolean).join(' '));
      put(w, 'text', tr(`Weighing ${Number(k) + 1} · ${fmt(e)}`, `Lần ${Number(k) + 1} · ${fmt(e)}`));
      put(rr, 'text', '→ ' + WORD[e.res]);
    });
    put(el.page, 'class', 'sc-lg-pg' + (s.pgN ? (s.pgN % 2 ? ' pg-a' : ' pg-b') : ''));
    put(el.page, 'text', `${tr('PAGE', 'TRANG')} ${s.page}`);

    /* readout + verdict */
    const cur = s.cur;
    const showL = swingOn || phase === 'coin' ? (cur ? cur.L.length : nL) : nL;
    const showR = swingOn || phase === 'coin' ? (cur ? cur.R.length : nR) : nR;
    let readKick = tr('BOTH PANS', 'HAI ĐĨA CÂN');
    if (phase === 'load' && s.sel) readKick = tr(`SELECTED · VIAL Nº ${s.sel}`, `ĐANG CHỌN · LỌ Nº ${s.sel}`);
    else if (phase === 'pick') readKick = tr('POINT OUT THE SWAPPED VIAL', 'CHỈ RA LỌ BỊ TRÁO');
    else if (insp) readKick = tr(`CHECKING VIAL Nº ${s.picked}`, `ĐANG SOI LỌ Nº ${s.picked}`);
    let eqWord = tr('EMPTY', 'TRỐNG'), eqCls = '';
    if (showL || showR) { if (showL === showR) { eqWord = tr('EQUAL', 'BẰNG NHAU'); eqCls = 'is-eq'; } else { eqWord = tr('NOT EQUAL', 'CHƯA BẰNG'); eqCls = 'is-neq'; } }
    put(el.readKick, 'text', readKick);
    put(el.readMain, 'text', tr(`Left ${showL} · Right ${showR}`, `Trái ${showL} · Phải ${showR}`));
    put(el.eq, 'text', eqWord);
    put(el.eq, 'class', 'sc-eq' + (eqCls ? ' ' + eqCls : ''));
    const res = cur ? cur.res : s.res;
    put(el.verdict, 'text', res === 'E' ? tr('⚖ BALANCED', '⚖ CÂN BẰNG') : (res === 'L' ? tr('◀ LEFT IS HEAVIER', '◀ TRÁI NẶNG HƠN') : tr('RIGHT IS HEAVIER ▶', 'PHẢI NẶNG HƠN ▶')));
    put(el.verdict, 'class', 'sc-verdict' + (res === 'E' ? '' : ' is-heavy'));

    /* close-up of the chosen vial */
    let inspCap = '';
    if (phase === 'insp') inspCap = text.capInsp;
    else if (phase === 'peel' || phase === 'solved') inspCap = text.capPeel;
    else if (phase === 'wrong') inspCap = text.capWrong;
    put(el.insp, 'class', ['sc-insp', insp ? 'is-on' : '', 'ph-' + phase, phase === 'peel' || phase === 'solved' ? 'is-heavy' : ''].filter(Boolean).join(' '));
    put(el.insp, '@aria-hidden', insp ? 'false' : 'true');
    put(el.inspK, 'text', tr(`VIAL Nº ${s.picked || '—'} · LABEL`, `LỌ Nº ${s.picked || '—'} · SOI NHÃN`));
    put(el.lpNo, 'text', `Nº ${s.picked || '—'}`);
    put(el.inspCap, 'text', inspCap);

    /* controls */
    const ready = phase === 'load' && nL > 0 && nL === nR && s.tokens > 0 && !busy;
    put(acts('toL'), '@aria-disabled', phase === 'load' && s.sel ? 'false' : 'true');
    put(acts('toR'), '@aria-disabled', phase === 'load' && s.sel ? 'false' : 'true');
    put(acts('toS'), '@aria-disabled', phase === 'load' && s.sel && s.loc[s.sel] !== 'S' ? 'false' : 'true');
    put(acts('clear'), '@aria-disabled', phase === 'load' && (nL || nR) ? 'false' : 'true');
    put(acts('pick'), '@aria-pressed', phase === 'load' || phase === 'return' || swingOn || phase === 'coin' ? 'false' : 'true');
    put(acts('pick'), '@aria-disabled', phase === 'load' || phase === 'pick' ? 'false' : 'true');
    put(acts('weigh'), '@aria-disabled', ready ? 'false' : 'true');
    put(acts('weigh'), 'class', 's-btn s-btn-red sc-weigh' + (ready ? ' is-ready' : ''));
    put(el.tries, 'text', `${tr('Attempts', 'Lần thử')}: ${s.attempts}`);
    put(el.tries, 'class', ['sc-tries', s.attempts > 0 ? 'has-fail' : '', s.bump ? (s.bump % 2 ? 'bump-a' : 'bump-b') : ''].filter(Boolean).join(' '));

    const [kick, line, tone] = status();
    const message = `${kick} — ${line}`;
    if (message !== lastStatus) { lastStatus = message; ctx.setStatus(message, tone); }
  }

  el.scene.addEventListener('pointerdown', onDown);
  el.scene.addEventListener('pointermove', onMove);
  el.scene.addEventListener('pointerup', onUp);
  el.scene.addEventListener('pointercancel', onUp);
  body.addEventListener('click', onClick);
  veil.addEventListener('keydown', onKey);

  if (ctx.solved) s = { ...s, phase: 'solved', picked: 0 };
  paint();

  return {
    update(next) {
      ctx = next;
      latestRun = next.run;
      if (next.solved && s.phase !== 'solved' && s.phase !== 'peel' && !busy) {
        clearTimers();
        stopDrag();
        set({ ...backAll(), phase: 'solved', msg: '' });
        return;
      }
      reconcile();
      paint();
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
      body.classList.remove('sc-rm');
    },
  };
}

const balanceScale: PuzzleKindModule = {
  kind: 'balance_scale',
  label: { en: 'Control balance', vi: 'Cân đối chứng' },
  mount,
};

export default balanceScale;
