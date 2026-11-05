/*
 * Moved as it is from the approved prototype (ho-so-src/titles.js): only imports and exports were added,
 * plus the changes listed in cosmetics/README.md. The drawing is not to be redrawn or simplified.
 */
import { ART } from './art-manifest.js';
import { blossomSVG, roseSVG } from './frames.js';
import { $, IMG, RUYI, drawWing, matDefs, reduce, rng } from './lib.js';

const TITLES = [
  { id: 'tan-binh', n: 'Tân Binh', r: 'common', sty: 'thuong', src: 'Mặc định' },
  { id: 'khach-quen', n: 'Khách Quen Sở Cẩm', r: 'common', sty: 'thuong', src: 'Chơi 10 vụ' },
  { id: 'ghi-chep', n: 'Người Ghi Chép', r: 'common', sty: 'thuong', src: 'Ghi 50 lời khai' },
  { id: 'mat-tinh', n: 'Mắt Tinh Tường', r: 'rare', sty: 'ngan', src: 'Tìm 100 manh mối' },
  { id: 'tho-khoa', n: 'Thợ Mở Khóa', r: 'rare', sty: 'ngan', src: 'Giải 25 câu đố ổ khóa' },
  { id: 'san-manh-moi', n: 'Kẻ Săn Manh Mối', r: 'rare', sty: 'ngan', src: 'Ra từ Hòm Niêm Phong' },
  { id: 'bach-nguyet', n: 'Bạch Nguyệt Thám Tử', r: 'rare', sty: 'nguyet', src: 'Phá án lúc nửa đêm' },
  { id: 'an-si', n: 'Ẩn Sĩ Trúc Lâm', r: 'myth', sty: 'truc', src: 'Ra từ Tráp Sơn Mài' },
  { id: 'doc-dau-vet', n: 'Kẻ Đọc Dấu Vết', r: 'myth', sty: 'ngoc', src: 'Phá án không dùng gợi ý' },
  { id: 'van-tay', n: 'Chuyên Gia Vân Tay', r: 'myth', sty: 'ngoc', src: 'Đạt cấp 30' },
  { id: 'han-bang', n: 'Hàn Băng Tâm Thám', r: 'myth', sty: 'bang', src: 'Ra từ Tráp Sơn Mài' },
  { id: 'anh-dao', n: 'Anh Đào Lạc Phố', r: 'myth', sty: 'anhdao', src: 'Ra từ Tráp Sơn Mài' },
  { id: 'mac-thu', n: 'Mặc Ảnh Thư Sinh', r: 'myth', sty: 'mac', src: 'Ra từ Hòm Niêm Phong' },
  { id: 'tinh-khong', n: 'Tinh Không Dạ Hành', r: 'myth', sty: 'tinhkhong', src: 'Ra từ Hòm Niêm Phong' },
  { id: 'vo-song', n: 'Vô Song Kiếm Khách', r: 'leg', sty: 'kiem', src: 'Ra từ Két Nhà Băng' },
  { id: 'huyet-kiem', n: 'Huyết Kiếm Truy Hung', r: 'leg', sty: 'kiem', src: 'Thắng 50 vụ' },
  { id: 'bong-ma', n: 'Bóng Ma Bến Sương', r: 'leg', sty: 'thanh', src: 'Ra từ Hòm Niêm Phong' },
  { id: 'tham-tu-truong', n: 'Thám Tử Trưởng', r: 'leg', sty: 'thantham', src: 'Đạt cấp 50' },
  { id: 'hoa-luan', n: 'Hỏa Luân Phán Quan', r: 'leg', sty: 'hoa', src: 'Ra từ Két Nhà Băng' },
  { id: 'hac-duc', n: 'Hắc Dực Dạ Quân', r: 'leg', sty: 'hacduc', src: 'Ra từ Hòm Niêm Phong' },
  { id: 'long-phung', n: 'Long Phụng Thần Thám', r: 'gold', sty: 'longphung', src: 'Bí ẩn · mọi hòm' },
  { id: 'kim-long', n: 'Kim Long Phá Án', r: 'gold', sty: 'kimlong', src: 'Bí ẩn · Két Nhà Băng' },
  { id: 'giu-gio', n: 'Người Giữ Giờ 2:17', r: 'gold', sty: 'kimlong', src: 'Sở hữu Đồng hồ 2:17' },
  { id: 'phuong-hoang', n: 'Phượng Hoàng Bất Tử', r: 'gold', sty: 'phuong', src: 'Bí ẩn · Tráp Sơn Mài' },
  { id: 'thien-menh', n: 'Thiên Mệnh Thần Thám', r: 'gold', sty: 'thienmenh', src: 'Bí ẩn · Hòm Niêm Phong' },
];
const T = Object.fromEntries(TITLES.map(t => [t.id, t]));
/* style table. glow = aura colour, parts = particle spec, ext = ornament margins [left,right,top,bottom] */
const STY = {
  thuong:    { mat: 'bronze', shape: 'hex',   inner: ['#231e19', '#0c0b0a'], txt: ['#f2e6d2', '#c6b494', '#8c7a5c'], glow: '200,150,90', ext: [8, 8, 4, 4] },
  ngan:      { mat: 'silver', shape: 'hex',   inner: ['#1b2c4a', '#070b16'], txt: ['#ffffff', '#d8e6ff', '#8eaad6'], glow: '110,160,255', ext: [46, 46, 6, 6], parts: [['tw', 3, '220,235,255']] },
  nguyet:    { mat: 'silver', shape: 'notch', inner: ['#1e2c50', '#060a18'], txt: ['#ffffff', '#e2ecff', '#9ab4e8'], glow: '150,185,255', ext: [24, 24, 26, 6], parts: [['rise', 5, '220,232,255'], ['tw', 2, '255,255,255']] },
  truc:      { mat: 'bark',   shape: 'rect',  inner: ['#1d2c1b', '#070b06'], txt: ['#f6ffea', '#d2eeaa', '#86b45a'], glow: '120,210,110', ext: [26, 26, 14, 14], trim: 'jade', parts: [['leaf', 5, '120,190,80'], ['tw', 2, '230,255,200']] },
  ngoc:      { mat: 'gold',   shape: 'notch', inner: ['#24805a', '#05261a'], txt: ['#ffffff', '#ddfff0', '#7ad8ae'], glow: '60,220,160', ext: [30, 30, 16, 30], tassel: '#b0141e', parts: [['tw', 3, '220,255,240'], ['rise', 3, '160,255,210']] },
  bang:      { mat: 'silver', shape: 'hex',   inner: ['#1a4a6e', '#04121e'], txt: ['#ffffff', '#e0f6ff', '#86cdf2'], glow: '120,210,255', ext: [36, 36, 22, 10], parts: [['snow', 7, '235,248,255'], ['tw', 3, '220,245,255']] },
  anhdao:    { mat: 'lacquer', shape: 'notch', inner: ['#3e0e18', '#12030a'], txt: ['#fff4f6', '#ffd0dc', '#e888a4'], glow: '255,140,180', ext: [34, 34, 18, 14], trim: 'gold', parts: [['petal', 7, '255,190,210'], ['tw', 2, '255,230,240']] },
  mac:       { mat: 'iron',   shape: 'rect',  inner: ['#22242a', '#08090b'], txt: ['#f4f4f2', '#cfd2d8', '#8a909c'], glow: '190,200,220', ext: [30, 30, 12, 12], parts: [['smoke', 5, '200,208,224']] },
  tinhkhong: { mat: 'gold',   shape: 'notch', inner: ['#1a2460', '#050820'], txt: ['#fffbea', '#ffe6a8', '#d4a850'], glow: '110,120,255', ext: [30, 30, 22, 8], parts: [['tw', 6, '255,240,190'], ['rise', 3, '200,210,255']] },
  kiem:      { mat: 'gold',   shape: 'hex',   inner: ['#8a101a', '#1c0205'], txt: ['#fff8e6', '#ffdc96', '#dca448'], glow: '230,50,60', ext: [56, 34, 12, 30], tassel: '#b0141e', sweep: 1, parts: [['rise', 6, '255,170,90'], ['tw', 2, '255,230,200']] },
  thanh:     { mat: 'silver', shape: 'goth',  inner: ['#2c1a24', '#080508'], txt: ['#f8e8ec', '#dca8b4', '#9a5062'], glow: '200,20,60', ext: [44, 44, 24, 8], sweep: 1, parts: [['smoke', 4, '150,20,50'], ['petal', 4, '150,10,40']] },
  thantham:  { mat: 'gold',   shape: 'notch', inner: ['#3a2a1c', '#0c0805'], txt: ['#fff4dc', '#eccc90', '#ae7e3e'], glow: '255,190,90', ext: [34, 34, 26, 6], sweep: 1, parts: [['rise', 5, '255,210,130'], ['tw', 3, '255,240,200']] },
  hoa:       { mat: 'gold',   shape: 'hex',   inner: ['#7a1a06', '#1a0402'], txt: ['#fffbe8', '#ffd890', '#ff8a3a'], glow: '255,110,30', ext: [40, 40, 26, 8], sweep: 1, parts: [['ember', 10, '255,150,50']] },
  hacduc:    { mat: 'steel',  shape: 'hex',   inner: ['#1e1828', '#06050a'], txt: ['#f6f0ff', '#d4c4f0', '#8a74b8'], glow: '150,90,255', ext: [100, 100, 30, 10], sweep: 1, parts: [['feather', 5, '40,30,60'], ['tw', 2, '220,200,255']] },
  longphung: { mat: 'gold',   shape: 'notch', inner: ['#1e1612', '#050303'], txt: ['#fffbe8', '#ffe08c', '#c08a2c'], glow: '255,190,80', ext: [118, 118, 24, 30], tassel: '#b0141e', rays: 1, sweep: 1, parts: [['rise', 8, '255,214,120'], ['tw', 4, '255,248,220']] },
  kimlong:   { mat: 'gold',   shape: 'notch', inner: ['#2e1e0a', '#090502'], txt: ['#fffbe8', '#ffe08c', '#c08a2c'], glow: '255,200,90', ext: [118, 118, 24, 30], tassel: '#b0141e', rays: 1, sweep: 1, parts: [['rise', 8, '255,214,120'], ['tw', 4, '255,248,220']] },
  phuong:    { mat: 'gold',   shape: 'notch', inner: ['#3a0e06', '#0e0302'], txt: ['#fffbe8', '#ffd890', '#ff8a3a'], glow: '255,120,40', ext: [76, 76, 86, 26], rays: 1, sweep: 1, parts: [['ember', 10, '255,150,50'], ['tw', 3, '255,240,200']] },
  thienmenh: { mat: 'gold',   shape: 'notch', inner: ['#2a2410', '#080703'], txt: ['#ffffff', '#fff2c0', '#d8b04a'], glow: '255,236,170', ext: [100, 100, 34, 10], rays: 1, sweep: 1, parts: [['wfeather', 6, '255,255,255'], ['tw', 5, '255,250,220']] },
};
const LVL = { common: 1, rare: 2, myth: 3, leg: 4, gold: 5 };
let TID = 0;
const MCV = document.createElement('canvas').getContext('2d');
function measureTitle(s, fs, ls) { MCV.font = `700 ${fs}px "Cormorant SC", Georgia, serif`; return MCV.measureText(s).width + ls * (s.length - 1); }
function platePath(shape, W, H, inset = 0) {
  const i = inset, e = 11 - i * 0.4;
  if (shape === 'rect') return `M${i} ${i}H${W - i}V${H - i}H${i}Z`;
  if (shape === 'notch') { const n = 7 - i * 0.6; return `M${i + n} ${i}H${W - i - n}Q${W - i - n} ${i + n} ${W - i} ${i + n}V${H - i - n}Q${W - i - n} ${H - i - n} ${W - i - n} ${H - i}H${i + n}Q${i + n} ${H - i - n} ${i} ${H - i - n}V${i + n}Q${i + n} ${i + n} ${i + n} ${i}Z`; }
  if (shape === 'goth') return `M${i + e} ${i}H${W / 2 - 9}L${W / 2} ${i - 7 + i * 1.4}L${W / 2 + 9} ${i}H${W - i - e}L${W - i} ${H / 2}L${W - i - e} ${H - i}H${i + e}L${i} ${H / 2}Z`;
  return `M${i + e} ${i}H${W - i - e}L${W - i} ${H / 2}L${W - i - e} ${H - i}H${i + e}L${i} ${H / 2}Z`;
}
const FILIGREE = 'M64 22C52 22 46 11 36 11C26 11 22 20 27 25C31 29 37 25 34 21M64 22C54 24 48 34 38 35C30 36 27 31 30 28M36 11C30 5 20 5 13 10M38 35C32 40 22 40 15 35';
/* wing ornaments rendered once from the living wing art */
const ORN = {};
function ornament(kind) {
  if (ORN[kind] !== undefined) return ORN[kind];
  if ([...IMG.values()].some(im => !im.complete)) return null;
  const cv = document.createElement('canvas'), c = cv.getContext('2d', { willReadFrequently: true }); cv.width = 300; cv.height = 240; const right = kind.endsWith('R');
  drawWing(c, right ? 14 : 286, 200, right ? 1 : -1, 210, 0, kind.startsWith('wingAsh') ? 'ash' : 'dark', { seed: 4, raise: -0.15, breath: 0 });
  if ([...IMG.values()].some(im => !im.complete)) return null;
  try { ORN[kind] = cv.toDataURL('image/png'); } catch (e) { ORN[kind] = ''; }
  return ORN[kind];
}
/* painted ornaments are set once as CSS backgrounds (keeps the DOM light) */
let ornCssDone = false;
function installTitleDefs() {
  if (!$('ttdefs')) { const d = document.createElement('div'); d.innerHTML = `<svg id="ttdefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${matDefs('gold', 'silver', 'bronze', 'iron', 'jade', 'bark', 'lacquer', 'steel')}
<radialGradient id="tl-rose" cx=".5" cy=".7" r=".8"><stop offset="0" stop-color="#b0182e"/><stop offset=".7" stop-color="#5a0614"/><stop offset="1" stop-color="#2a020a"/></radialGradient>
<radialGradient id="pt" cx=".5" cy=".8" r=".9"><stop offset="0" stop-color="#d8687e"/><stop offset=".45" stop-color="#f6c4cf"/><stop offset="1" stop-color="#fff4f6"/></radialGradient>
<linearGradient id="tl-ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".45" stop-color="#a8dcff" stop-opacity=".7"/><stop offset="1" stop-color="#2a6aa8" stop-opacity=".6"/></linearGradient>
<linearGradient id="tl-fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff2b0"/><stop offset=".35" stop-color="#ffb030"/><stop offset=".75" stop-color="#e83a10"/><stop offset="1" stop-color="#8a0a04" stop-opacity="0"/></linearGradient>
<filter id="tl-tglow" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs></svg>`; document.body.prepend(d.firstChild); }
  if (!ornCssDone && typeof ART !== 'undefined') { ornCssDone = true; const s = document.createElement('style');
    s.textContent = `.hs-ob-dragon{background-image:url(${ART['rong-bay']})}.hs-ob-phx{background-image:url(${ART['phuong-bay']})}.hs-ob-phxF{background-image:url(${ART['phuong-xoe']})}`; document.head.append(s); }
}
function wingCss() { const K = ['wingDark', 'wingDarkR', 'wingAsh', 'wingAshR'].map(ornament); if (K.some(v => v === null)) return false; const s = document.createElement('style'); s.textContent = `.hs-ob-wingD{background-image:url(${K[0]})}.hs-ob-wingDR{background-image:url(${K[1]})}.hs-ob-wingA{background-image:url(${K[2]})}.hs-ob-wingAR{background-image:url(${K[3]})}`; document.head.append(s); return true; }

/* particles: deterministic spread, CSS-driven (cheap, smooth) */
function particles(spec, VW, VH, ml, mt, W, H, seed) {
  const R = rng(seed); let h = '';
  for (const [k, n, col] of spec) for (let i = 0; i < n; i++) {
    const x = ml + R() * W, d = (k === 'tw' ? 2.4 : k === 'ember' || k === 'rise' ? 2.6 : 4.6) + R() * 2, dl = -R() * d, dx = Math.round((R() - .5) * 26);
    const y = k === 'tw' ? mt - 8 + R() * (H + 16) : k === 'ember' || k === 'rise' || k === 'smoke' ? mt + H * (0.5 + R() * 0.5) : mt - 6 - R() * 8;
    h += `<i class="hs-tp hs-p-${k}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--c:${col.replace(/,/g, ' ')};--d:${d.toFixed(2)}s;--dl:${dl.toFixed(2)}s;--dx:${dx}px"></i>`;
  }
  return h;
}
/* Moving plaques share one clock at 30 ticks a second: each SMIL tick repaints the metal under the sweep, and at the
   screen's own rate (up to 144 a second) that alone keeps a laptop GPU busy. Under a running entrance only the
   plaque on the stage ticks. */
const PLAQUE_TICK_MS = 33;
const movingPlaques = new Set();
let plaqueClock = 0;
function tickPlaques() {
  const held = document.body.classList.contains('hs-stage-open'), now = performance.now() / 1000;
  for (const svg of movingPlaques) {
    if (!svg.isConnected) movingPlaques.delete(svg);
    else if (!held || svg.closest('.hs-stage')) svg.setCurrentTime(now);
  }
  if (movingPlaques.size === 0) { clearInterval(plaqueClock); plaqueClock = 0; }
}
/* a plaque moves through CSS and through SMIL inside its SVG; both stop and start together */
function setPlaqueMotion(root, moving) {
  root.classList.toggle('hs-rest', !moving);
  root.querySelectorAll('svg.hs-plq').forEach(svg => {
    svg.pauseAnimations();
    if (moving && !reduce.matches) movingPlaques.add(svg); else movingPlaques.delete(svg);
  });
  if (movingPlaques.size > 0 && !plaqueClock) plaqueClock = setInterval(tickPlaques, PLAQUE_TICK_MS);
}
/* the wing ornaments are painted once, the first time a plaque that wears them is shown */
const WING_RETRY_MS = 250, WING_RETRIES = 40;
let wingsAsked = false;
function askForWings() {
  if (wingsAsked) return;
  wingsAsked = true;
  let tries = 0;
  const install = () => { if (!wingCss() && ++tries < WING_RETRIES) setTimeout(install, WING_RETRY_MS); };
  setTimeout(install, 0);
}
/* the plaque */
function titleHTML(t, o = {}) {
  const st = t.ov ? { ...STY[t.sty], ...t.ov } : STY[t.sty], L = LVL[t.r], id = 'tt' + (++TID); let sc = o.scale || 1; const bare = !!o.bare, still = reduce.matches;
  const fs = L === 1 ? 19 : 22, ls = 2.6, H = L === 1 ? 34 : 42, tw = measureTitle(t.n, fs, ls), pad = L === 1 ? 20 : 30, W = Math.ceil(tw + pad * 2);
  const [ml, mr, mt, mb] = bare ? [10, 10, 6, 6] : st.ext, VW = W + ml + mr, VH = H + mt + mb;
  if (o.maxW && VW * sc > o.maxW) sc = o.maxW / VW;
  const esc = t.n.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const S = bare ? '' : t.sty, P = (d, ins = 0) => platePath(st.shape, W, H, ins);
  if (S === 'hacduc' || S === 'thienmenh') askForWings();
  let defs = `<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${st.txt[0]}"/><stop offset=".55" stop-color="${st.txt[1]}"/><stop offset="1" stop-color="${st.txt[2]}"/></linearGradient>
<linearGradient id="${id}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${st.inner[0]}"/><stop offset="1" stop-color="${st.inner[1]}"/></linearGradient>
<linearGradient id="${id}hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
<pattern id="${id}d" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M9 2C7 5 7 7 9 9C11 7 11 5 9 2ZM9 9C6 8 4 6 3 4C5 5 7 7 9 9ZM9 9C12 8 14 6 15 4C13 5 11 7 9 9ZM9 12L11 14L9 16L7 14Z" fill="#fff" opacity=".07"/></pattern>
<clipPath id="${id}c"><path d="${P(0, 3.2)}"/></clipPath>`;
  let back = '', front = '';
  /* ---- ornaments per style (SVG, plate coordinates; plate spans 0..W, 0..H) ---- */
  if (S === 'ngan' || S === 'thanh') front += `<g fill="none" stroke-linecap="round">${[0, 1].map(k => `<g transform="translate(${k ? W - 6 : 6} ${H / 2 - 22}) scale(${k ? -1 : 1} 1) translate(-64 0)"><path d="${FILIGREE}" stroke="#0b0d12" stroke-width="3.6"/><path d="${FILIGREE}" stroke="url(#g-silver)" stroke-width="2.2" filter="url(#m-silver)"/><circle cx="8" cy="22" r="3.2" fill="url(#g-silver)" filter="url(#m-silver)"/></g>`).join('')}</g>`;
  if (S === 'nguyet') front += `<g transform="translate(${W / 2} -12)"><circle r="16" fill="#cfe0ff" opacity=".18">${still ? '' : '<animate attributeName="opacity" values=".1;.3;.1" dur="4s" repeatCount="indefinite"/>'}</circle><path d="M2 -11.8A12 12 0 1 0 2 11.8A14.5 14.5 0 0 1 2 -11.8Z" fill="url(#g-silver)" filter="url(#m-silver)"/></g>` + [0, 1].map(k => `<g transform="translate(${k ? W + 12 : -12} ${H / 2})" fill="#e8f0ff">${[[0, 0, 2.4], [-7, -9, 1.4], [6, 9, 1.2]].map(([x, y, r]) => `<path d="M${x} ${y - r * 2.2}L${x + r * .5} ${y - r * .5}L${x + r * 2.2} ${y}L${x + r * .5} ${y + r * .5}L${x} ${y + r * 2.2}L${x - r * .5} ${y + r * .5}L${x - r * 2.2} ${y}L${x - r * .5} ${y - r * .5}Z"/>`).join('')}</g>`).join('');
  if (S === 'truc') for (const k of [0, 1]) { const x = k ? W + 8 : -8, dir = k ? 1 : -1;
    back += `<g filter="url(#m-jade)" fill="url(#g-jade)">${[0, 1, 2].map(j => `<rect x="${x - 4}" y="${-12 + j * 22}" width="8" height="20" rx="2.2"/>`).join('')}</g>`;
    front += `<g fill="#6aa848" stroke="#2a4a1a" stroke-width=".4"><g>${still ? '' : `<animateTransform attributeName="transform" type="rotate" values="-6 ${x} 8;6 ${x} 8;-6 ${x} 8" dur="${4.2 + k * .7}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`}<path d="M${x} 8C${x + dir * 7} 1 ${x + dir * 16} -1 ${x + dir * 21} 1C${x + dir * 14} 6 ${x + dir * 7} 8 ${x} 8Z"/><path d="M${x} 10C${x + dir * 9} 11 ${x + dir * 16} 16 ${x + dir * 19} 21C${x + dir * 12} 18 ${x + dir * 5} 15 ${x} 10Z" fill="#86c45a"/></g>
<g>${still ? '' : `<animateTransform attributeName="transform" type="rotate" values="5 ${x} 32;-5 ${x} 32;5 ${x} 32" dur="${5 - k * .5}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`}<path d="M${x} 32C${x + dir * 8} 27 ${x + dir * 15} 28 ${x + dir * 19} 33C${x + dir * 12} 35 ${x + dir * 5} 34 ${x} 32Z"/></g></g>`; }
  if (S === 'ngoc' || S === 'kiem' || S === 'longphung' || S === 'kimlong' || S === 'thantham' || S === 'tinhkhong') front += [0, 1].map(k => `<g transform="translate(${k ? W + 3 : -3} ${H / 2}) rotate(${k ? 90 : -90}) scale(1.15)" filter="url(#m-gold)" fill="url(#g-gold)"><path d="${RUYI}"/></g>`).join('');
  if (S === 'ngoc') front += `<g filter="url(#m-jade)" fill="url(#g-jade)"><circle cx="${W / 2}" cy="-4" r="7.5"/></g><circle cx="${W / 2}" cy="-4" r="2.6" fill="#062a1c"/>`;
  if (S === 'bang') { const shard = (x, y, a, l, w) => `<g transform="translate(${x} ${y}) rotate(${a})"><path d="M${-w / 2} 0L${-w / 2} ${-l * .7}L0 ${-l}L${w / 2} ${-l * .74}L${w / 2} 0Z" fill="url(#tl-ice)" stroke="#f2fbff" stroke-opacity=".7" stroke-width=".5"/><path d="M0 0L0 ${-l}L${w / 2} ${-l * .74}L${w / 2} 0Z" fill="#0a2a4a" fill-opacity=".35"/></g>`;
    front += [0, 1].map(k => { const x = k ? W + 2 : -2, s = k ? 1 : -1; return [[-60, 22, 7], [-90, 30, 8], [-120, 20, 6], [-30, 14, 5], [-150, 14, 5]].map(([a, l, w]) => shard(x, H / 2, k ? -a : a, l, w)).join(''); }).join('') + [-24, -8, 8, 24].map((dx, i) => shard(W / 2 + dx, 2, dx * .9, i % 3 ? 14 : 22, 6)).join(''); }
  if (S === 'anhdao') front += `<g fill="none" stroke="#2a1a14" stroke-width="2.2" stroke-linecap="round"><path d="M-30 ${H + 6}C-10 ${H - 2} 10 ${H + 4} 40 ${H + 2}"/><path d="M${W + 30} -8C${W + 10} 2 ${W - 10} -6 ${W - 44} -2"/></g>` + [[-22, H + 2, 6], [0, H + 3, 7], [24, H + 4, 5.5], [W + 22, -4, 6], [W, -3, 7], [W - 26, -2, 5.5]].map(([x, y, r], i) => blossomSVG(x, y, r, i * 23)).join('');
  if (S === 'mac') { back += `<path d="M-28 ${H * .62}C${W * .2} ${H * .1} ${W * .6} ${H * 1.05} ${W + 28} ${H * .3}" fill="none" stroke="#0a0a0c" stroke-width="${H * .9}" stroke-linecap="round" opacity=".85" filter="url(#m-iron)"/><path d="M-24 ${H * .7}C${W * .3} ${H * .35} ${W * .6} ${H * .9} ${W + 24} ${H * .45}" fill="none" stroke="#8a90a0" stroke-opacity=".25" stroke-width="1.2" stroke-dasharray="40 8 60 6"/>`;
    front += `<g transform="translate(${W + 12} ${H - 2}) rotate(-8)"><rect x="-9" y="-9" width="18" height="18" rx="1.5" fill="#a3161c"/><path d="M-5-5H5M0-7V7M-5 1H5M-4 4.5L4 6.5" stroke="#f6e8e0" stroke-width="1.5" stroke-linecap="round" fill="none"/></g>`; }
  if (S === 'tinhkhong') { front += `<g transform="translate(${W / 2} -10)"><circle r="15" fill="#ffe6a0" opacity=".16">${still ? '' : '<animate attributeName="opacity" values=".08;.28;.08" dur="4.4s" repeatCount="indefinite"/>'}</circle><path d="M2 -10.8A11 11 0 1 0 2 10.8A13.5 13.5 0 0 1 2 -10.8Z" fill="url(#g-gold)" filter="url(#m-gold)"/></g>`;
    defs += `<pattern id="${id}s" width="26" height="22" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r=".8" fill="#ffe6a0" opacity=".8"/><circle cx="17" cy="14" r=".6" fill="#fff" opacity=".7"/><circle cx="22" cy="3" r=".5" fill="#ffe6a0" opacity=".6"/></pattern>`; }
  if (S === 'kiem') { defs += `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f8ff"/><stop offset=".5" stop-color="#9aa6b8"/><stop offset="1" stop-color="#3a414e"/></linearGradient>
<linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="-60" y1="0" x2="-20" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>${still ? '' : `<animateTransform attributeName="gradientTransform" type="translate" values="0 0;${W + 140} 0;${W + 140} 0" keyTimes="0;.45;1" dur="3.6s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .4 1;0 0 1 1"/>`}</linearGradient>`;
    const sword = rot => `<g transform="rotate(${rot} ${W / 2} ${H / 2})"><path d="M-28 ${H / 2 - 2.4}H${W + 12}L${W + 26} ${H / 2}L${W + 12} ${H / 2 + 2.4}H-28Z" fill="url(#${id}s)" stroke="#12151a" stroke-width=".4"/><path d="M-28 ${H / 2 - 2.4}H${W + 12}L${W + 26} ${H / 2}L${W + 12} ${H / 2 + 2.4}H-28Z" fill="url(#${id}g)"/><rect x="-32" y="${H / 2 - 8}" width="4.5" height="16" rx="1" filter="url(#m-gold)" fill="url(#g-gold)"/><rect x="-46" y="${H / 2 - 2.2}" width="14" height="4.4" fill="#3a0a0a"/><circle cx="-48" cy="${H / 2}" r="2.8" fill="#d8a848"/></g>`;
    back += sword(-8) + sword(8); }
  if (S === 'thanh') { defs += `<radialGradient id="${id}a" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#c0142a" stop-opacity=".55"/><stop offset="1" stop-color="#c0142a" stop-opacity="0"/></radialGradient>`;
    let vine = `M6 1`; for (let x = 14; x <= W - 6; x += 9) vine += `Q${x - 4.5} ${(x / 9) % 2 ? -4 : 4} ${x} 1`;
    front += `<path d="${vine}" fill="none" stroke="#3a4a36" stroke-width="1.7"/>` + Array.from({ length: Math.floor(W / 15) }, (_, i) => `<path d="M${12 + i * 15} 1l${i % 2 ? 2.6 : -2.6} -2.6l.9 2.8z" fill="#3a4a36"/>`).join('') + roseSVG(W / 2, -10, 6.5).replace(/url\(#rs\)/g, 'url(#tl-rose)') + roseSVG(16, H - 1, 4.5).replace(/url\(#rs\)/g, 'url(#tl-rose)') + roseSVG(W - 16, H - 1, 4.5).replace(/url\(#rs\)/g, 'url(#tl-rose)')
      + [-1, 1].map(s => `<g filter="url(#m-iron)" fill="url(#g-iron)"><path d="M${s < 0 ? -14 : W + 14} ${H / 2 + 12}L${s < 0 ? -14 : W + 14} ${H / 2 - 10}L${s < 0 ? -10 : W + 10} ${H / 2 - 22}L${s < 0 ? -6 : W + 6} ${H / 2 - 10}L${s < 0 ? -6 : W + 6} ${H / 2 + 12}Z"/></g>`).join(''); }
  if (S === 'thantham') { defs += `<radialGradient id="${id}l" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#d8ecff" stop-opacity=".6"/><stop offset="1" stop-color="#3a5a7a" stop-opacity=".3"/></radialGradient>`;
    front += `<g transform="translate(${W / 2} -10)"><path d="M7 7L16 16" stroke="#4a2c12" stroke-width="4.2" stroke-linecap="round"/><circle r="10.5" fill="url(#${id}l)"/><circle r="10.5" fill="none" filter="url(#m-gold)" stroke="url(#g-gold)" stroke-width="3.2"/>
<path d="M-1 -6l1.2 4.2l4.2 1.2l-4.2 1.2l-1.2 4.2l-1.2-4.2l-4.2-1.2l4.2-1.2z" fill="#fff" opacity="0">${still ? '' : '<animate attributeName="opacity" values="0;0;1;0" dur="3.4s" repeatCount="indefinite"/>'}</path></g>`
      + [0, 1].map(k => `<g transform="translate(${k ? W + 18 : -18} ${H / 2})"><g filter="url(#m-gold)" fill="url(#g-gold)">${still ? '' : `<animateTransform attributeName="transform" type="rotate" from="0" to="${k ? -360 : 360}" dur="9s" repeatCount="indefinite"/>`}<path d="M-1.6-8h3.2l.8 2.4 2.2.9 2.2-1.2 2.3 2.3-1.2 2.2.9 2.2 2.4.8v3.2l-2.4.8-.9 2.2 1.2 2.2-2.3 2.3-2.2-1.2-2.2.9-.8 2.4h-3.2l-.8-2.4-2.2-.9-2.2 1.2-2.3-2.3 1.2-2.2-.9-2.2-2.4-.8v-3.2l2.4-.8.9-2.2-1.2-2.2 2.3-2.3 2.2 1.2 2.2-.9z" transform="scale(.9)"/></g><circle r="2.6" fill="#1a1006"/></g>`).join(''); }
  if (S === 'hoa') { const fl = (x, y, s, r, dl) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0C6-4 7-14 0-26C-7-14-6-4 0 0Z" fill="url(#tl-fl)">${still ? '' : `<animateTransform attributeName="transform" type="scale" values="1 1;1.08 .86;.94 1.1;1 1" dur="${1.4 + dl}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>`}</path></g>`;
    back += [0, 1].map(k => { const x = k ? W - 2 : 2, d = k ? 1 : -1; return [[d * 6, 1, d * 70, .1], [d * 4, .85, d * 40, .3], [d * 3, .7, d * 100, .5]].map(([dx, s, r, dl]) => fl(x + dx, H / 2, s * 1.3, r, dl)).join(''); }).join('') + [-30, -12, 0, 12, 30].map((dx, i) => fl(W / 2 + dx, 4, i === 2 ? 1.2 : .8, dx * .6, i * .17)).join(''); }
  if (S === 'longphung' || S === 'kimlong') front += `<g transform="translate(${W / 2} -8)"><circle r="12" fill="#ffd27a" opacity=".25">${still ? '' : '<animate attributeName="r" values="10;15;10" dur="3s" repeatCount="indefinite"/>'}</circle><circle r="6.5" fill="url(#${id}p)"/></g>`;
  if (S === 'longphung' || S === 'kimlong') defs += `<radialGradient id="${id}p" cx=".38" cy=".35" r=".65"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#fff0c0"/><stop offset="1" stop-color="#c8862a"/></radialGradient>`;
  if (S === 'thienmenh') front += `<ellipse cx="${W / 2}" cy="-14" rx="22" ry="6" fill="none" stroke="#fff2c0" stroke-width="2.4" opacity=".9">${still ? '' : '<animate attributeName="opacity" values=".6;1;.6" dur="3s" repeatCount="indefinite"/>'}</ellipse><ellipse cx="${W / 2}" cy="-14" rx="22" ry="6" fill="none" stroke="#fffbe8" stroke-width="7" opacity=".18"/>`;
  // plate sweep (light passing over the whole metal plate)
  let over = '';
  if ((st.sweep || L >= 4) && !still) { defs += `<linearGradient id="${id}w" gradientUnits="userSpaceOnUse" x1="${-W * .4}" y1="0" x2="${-W * .1}" y2="${H}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".32"/><stop offset="1" stop-color="#fff" stop-opacity="0"/><animateTransform attributeName="gradientTransform" type="translate" values="0 0;${W * 1.6} 0;${W * 1.6} 0" keyTimes="0;.42;1" dur="${4.4 + (t.n.length % 3) * .4}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .35 1;0 0 1 1"/></linearGradient>`;
    over += `<path d="${P(0)}" fill="url(#${id}w)" style="mix-blend-mode:screen"/>`; }
  if (L >= 2 && !still) { defs += `<linearGradient id="${id}h" gradientUnits="userSpaceOnUse" x1="${-W * .5}" y1="0" x2="${-W * .1}" y2="${H}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/><animateTransform attributeName="gradientTransform" type="translate" values="0 0;${W * 1.7} 0;${W * 1.7} 0" keyTimes="0;.5;1" dur="${L >= 4 ? 3.8 : 5.2}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .35 1;0 0 1 1"/></linearGradient>`;
    over += `<text x="${W / 2}" y="${H / 2 + fs * 0.34}" text-anchor="middle" font-family="'Cormorant SC',Georgia,serif" font-weight="700" font-size="${fs}" letter-spacing="${ls}" fill="url(#${id}h)">${esc}</text>`; }
  const trim = st.trim ? `<path d="${P(0, 2.4)}" fill="none" filter="url(#m-${st.trim})" stroke="url(#g-${st.trim})" stroke-width="1.6"/>` : `<path d="${P(0, 4.4)}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width=".7"/>`;
  const corners = L >= 3 ? [[7, 7], [W - 7, 7], [7, H - 7], [W - 7, H - 7]].map(([x, y]) => `<path d="M${x} ${y - 2.6}L${x + 2.6} ${y}L${x} ${y + 2.6}L${x - 2.6} ${y}Z" fill="url(#g-${st.trim || st.mat})" filter="url(#m-${st.trim || st.mat})"/>`).join('') : '';
  const svg = `<svg class="hs-plq" width="${VW}" height="${VH}" viewBox="${-ml} ${-mt} ${VW} ${VH}" aria-hidden="true"><defs>${defs}</defs>${back}
<path d="${P(0)}" filter="url(#m-${st.mat})" fill="url(#g-${st.mat})"/>
<path d="${P(0, 3.2)}" fill="url(#${id}i)"/><g clip-path="url(#${id}c)"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id}${S === 'tinhkhong' ? 's' : 'd'})"/><rect x="0" y="0" width="${W}" height="${H}" fill="url(#${id}hl)"/></g>${trim}${corners}${front}
<text x="${W / 2}" y="${H / 2 + fs * 0.34}" text-anchor="middle" font-family="'Cormorant SC',Georgia,serif" font-weight="700" font-size="${fs}" letter-spacing="${ls}" fill="rgb(${st.glow})" opacity="${L >= 3 ? .55 : .3}" filter="url(#tl-tglow)">${esc}</text>
<text x="${W / 2}" y="${H / 2 + fs * 0.34}" text-anchor="middle" font-family="'Cormorant SC',Georgia,serif" font-weight="700" font-size="${fs}" letter-spacing="${ls}" fill="url(#${id}t)" stroke="#000" stroke-opacity=".75" stroke-width="2.4" paint-order="stroke">${esc}</text>${over}</svg>`;
  /* ---- living layers around the plaque ---- */
  let fx = '';
  const cx = ml + W / 2, cy = mt + H / 2;
  if (L >= 2) fx += `<i class="hs-au" style="left:${cx - W * .62}px;top:${cy - H * (L >= 4 ? 1.4 : 1.1)}px;width:${W * 1.24}px;height:${H * (L >= 4 ? 2.8 : 2.2)}px;--g:${st.glow.replace(/,/g, ' ')};opacity:${[0, 0, .35, .5, .62, .75][L]}"></i>`;
  if (st.rays && !bare) { const R = Math.max(W * .62, 120); fx += `<i class="hs-ry" style="left:${cx - R}px;top:${cy - R}px;width:${R * 2}px;height:${R * 2}px;--g:${st.glow.replace(/,/g, ' ')}"></i>`; }
  let orn = '';
  if (!bare) {
    if (S === 'longphung') orn += `<i class="hs-ob hs-ob-dragon hs-hov" style="left:${ml - 122}px;top:${cy - 40}px;width:140px;height:73px"></i><i class="hs-ob hs-ob-phx hs-hov2 hs-flip" style="left:${ml + W - 16}px;top:${cy - 52}px;width:136px;height:104px"></i>`;
    if (S === 'kimlong') orn += `<i class="hs-ob hs-ob-dragon hs-hov" style="left:${ml - 122}px;top:${cy - 40}px;width:140px;height:73px"></i><i class="hs-ob hs-ob-dragon hs-hov2 hs-flip" style="left:${ml + W - 18}px;top:${cy - 40}px;width:140px;height:73px"></i>`;
    if (S === 'phuong') orn += `<i class="hs-ob hs-ob-phxF hs-breathe" style="left:${cx - 110}px;top:${cy - 104}px;width:220px;height:150px"></i>`;
    if (S === 'hacduc' || S === 'thienmenh') { const cls = S === 'hacduc' ? 'hs-ob-wingD' : 'hs-ob-wingA', ww = 104, wh = 83; orn += `<i class="hs-ob ${cls} hs-flapL" style="left:${ml - ww + 8}px;top:${cy - wh + 12}px;width:${ww}px;height:${wh}px"></i><i class="hs-ob ${cls}R hs-flapR" style="left:${ml + W - 8}px;top:${cy - wh + 12}px;width:${ww}px;height:${wh}px"></i>`; }
    if (st.tassel) orn += [ml + 16, ml + W - 16].map((x, k) => `<i class="hs-ts" style="left:${x - 4}px;top:${mt + H - 3}px;--tc:${st.tassel};animation-delay:${-k * 1.1}s"></i>`).join('');
    if (st.parts && !still) orn += particles(st.parts, VW, VH, ml, mt, W, H, t.n.length * 7 + L);
  }
  const plate = `<span class="hs-tl-in" style="width:${VW}px;height:${VH}px;transform:scale(${sc})">${fx}${S === 'phuong' ? orn : ''}${svg}${S === 'phuong' ? '' : orn}</span>`;
  return `<span class="hs-tl hs-r-${t.r}${bare ? ' hs-bare' : ''}" style="width:${(VW * sc).toFixed(1)}px;height:${(VH * sc).toFixed(1)}px" role="img" aria-label="Danh hiệu ${esc}">${plate}</span>`;
}

/* a title described by data: { n, r, src, made, sty, glow, parts }. The words come from the server, the plaque from STY */
function titleFrom(o) { const ov = {}; if (o.glow) ov.glow = o.glow; if (o.parts) ov.parts = o.parts; return { n: o.n, r: o.r, src: o.src, made: !!o.made, sty: STY[o.sty] ? o.sty : 'thuong', ov: Object.keys(ov).length ? ov : undefined }; }
function defineTitle(id, o) { const known = T[id]; if (known) { Object.assign(known, titleFrom(o)); return; } const t = Object.assign({ id }, titleFrom(o)); T[id] = t; TITLES.push(t); }
const STYLE_KEYS = Object.keys(STY);

export { STYLE_KEYS, T, TITLES, defineTitle, installTitleDefs, setPlaqueMotion, titleFrom, titleHTML };
