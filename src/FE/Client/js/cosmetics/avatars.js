/*
 * Moved as it is from the approved prototype (ho-so-src/avatars.js): only imports and exports were added,
 * plus the changes listed in cosmetics/README.md. The drawing is not to be redrawn or simplified.
 */
import { SVG, svgImg } from './lib.js';

const AVS = [
  { id: 'nonla', n: 'Nón lá trong sương', svg: () => SVG(480, 480, '0 0 400 400', `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22324a"/><stop offset=".6" stop-color="#0e1522"/><stop offset="1" stop-color="#06080d"/></linearGradient>
<radialGradient id="mo" cx=".42" cy=".4" r=".6"><stop offset="0" stop-color="#fbf7ea"/><stop offset=".8" stop-color="#d6d4c6"/><stop offset="1" stop-color="#b0b0a4"/></radialGradient>
<radialGradient id="mg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#cfd8ea" stop-opacity=".35"/><stop offset="1" stop-color="#cfd8ea" stop-opacity="0"/></radialGradient>
<radialGradient id="ln" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb860" stop-opacity=".9"/><stop offset=".3" stop-color="#ff8a30" stop-opacity=".35"/><stop offset="1" stop-color="#ff8a30" stop-opacity="0"/></radialGradient>
<linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa8c0" stop-opacity="0"/><stop offset="1" stop-color="#9aa8c0" stop-opacity=".22"/></linearGradient>
<filter id="bl"><feGaussianBlur stdDeviation="3"/></filter>`,
    `<rect width="400" height="400" fill="url(#bg)"/><circle cx="286" cy="112" r="130" fill="url(#mg)"/><circle cx="286" cy="112" r="50" fill="url(#mo)"/>
<path d="M0 262L40 252L60 238L90 246L130 232L170 244L190 236L230 250L270 240L310 252L350 238L400 250V400H0Z" fill="#131c2a"/>
<path d="M20 252Q60 236 100 252M240 248Q290 232 340 248" stroke="#1c2838" stroke-width="6" fill="none"/>
<circle cx="64" cy="232" r="22" fill="url(#ln)"/><circle cx="120" cy="252" r="16" fill="url(#ln)"/><rect x="60" y="226" width="8" height="12" rx="3" fill="#ffb060"/><rect x="117" y="247" width="6" height="9" rx="2" fill="#ffa050"/>
<ellipse cx="200" cy="300" rx="260" ry="18" fill="#cfd8ea" opacity=".06" filter="url(#bl)"/>
<g fill="#7f8daa" opacity=".55" transform="translate(3 -2)"><path d="M84 198L200 126L316 198Q200 218 84 198Z"/><path d="M66 400C76 322 128 286 170 272L200 300L230 272C272 286 324 322 334 400Z"/></g>
<path d="M84 198L200 126L316 198Q200 218 84 198Z" fill="#0b0d13"/>
<g stroke="#2a3346" stroke-width="1" opacity=".7">${Array.from({ length: 11 }, (_, i) => `<path d="M200 130L${96 + i * 21} ${200 + Math.sin(i / 10 * Math.PI) * 9}"/>`).join('')}</g>
<path d="M160 204Q166 248 200 256Q234 248 240 204Z" fill="#0d1017"/><path d="M66 400C76 322 128 286 170 272L200 300L230 272C272 286 324 322 334 400Z" fill="#0b0e14"/>
<path d="M170 272L200 330L230 272" fill="none" stroke="#1e2636" stroke-width="3"/><path d="M182 236l10 2M208 238l10-2" stroke="#c8d6f0" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
<rect y="300" width="400" height="100" fill="url(#fg)"/>`) },
  { id: 'nu', n: 'Nữ thám tử', svg: () => SVG(480, 480, '0 0 400 400', `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3e2618"/><stop offset=".6" stop-color="#1a0f0c"/><stop offset="1" stop-color="#0a0606"/></linearGradient>
<radialGradient id="la" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffcf80" stop-opacity=".95"/><stop offset=".25" stop-color="#ff7a2a" stop-opacity=".5"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></radialGradient>
<linearGradient id="lb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a1410"/><stop offset=".5" stop-color="#e2401e"/><stop offset="1" stop-color="#8a1410"/></linearGradient>
<filter id="bl"><feGaussianBlur stdDeviation="5"/></filter>`,
    `<rect width="400" height="400" fill="url(#bg)"/><circle cx="318" cy="118" r="120" fill="url(#la)"/>
<g><path d="M318 64V80" stroke="#2a1408" stroke-width="2"/><ellipse cx="318" cy="114" rx="30" ry="36" fill="url(#lb)"/><path d="M296 114H340M300 98H336M300 130H336" stroke="#5a0a08" stroke-opacity=".5"/><rect x="306" y="78" width="24" height="6" fill="#2a1408"/><rect x="306" y="146" width="24" height="6" fill="#2a1408"/><path d="M318 152V176" stroke="#c8301a" stroke-width="2"/></g>
<g fill="#ffb060" opacity=".35" filter="url(#bl)"><circle cx="60" cy="90" r="10"/><circle cx="110" cy="160" r="7"/><circle cx="40" cy="250" r="12"/></g>
<g transform="translate(4 0)" fill="#d8743a" opacity=".55"><circle cx="246" cy="104" r="36"/><path d="M140 158C140 112 172 86 212 86C250 86 276 112 276 150C276 176 266 192 250 202L248 238C282 252 322 272 340 400H80C96 302 132 264 176 250L182 228C170 228 160 224 156 216C150 216 146 212 148 206C144 202 146 198 150 196C146 192 148 188 152 186L144 172C142 166 140 162 140 158Z"/></g>
<circle cx="246" cy="104" r="36" fill="#0e0807"/>
<path d="M140 158C140 112 172 86 212 86C250 86 276 112 276 150C276 176 266 192 250 202L248 238C282 252 322 272 340 400H80C96 302 132 264 176 250L182 228C170 228 160 224 156 216C150 216 146 212 148 206C144 202 146 198 150 196C146 192 148 188 152 186L144 172C142 166 140 162 140 158Z" fill="#0e0807"/>
<path d="M226 66L292 128" stroke="#5ac8a0" stroke-width="3.4" stroke-linecap="round"/><circle cx="226" cy="66" r="4" fill="#8ae6c0"/><path d="M290 126V160" stroke="#c8a050" stroke-width="1"/><circle cx="290" cy="164" r="4.5" fill="#5ac8a0"/>
<path d="M176 250C200 262 230 262 248 238" fill="none" stroke="#2a1410" stroke-width="2"/>`) },
  { id: 'kiem', n: 'Kiếm khách', svg: () => SVG(480, 480, '0 0 400 400', `<radialGradient id="bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#3a0e12"/><stop offset=".6" stop-color="#140608"/><stop offset="1" stop-color="#060304"/></radialGradient>
<radialGradient id="mo" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="#ff8a6a"/><stop offset=".7" stop-color="#c8281e"/><stop offset="1" stop-color="#8a1010"/></radialGradient>
<radialGradient id="mg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff4a3a" stop-opacity=".4"/><stop offset="1" stop-color="#ff4a3a" stop-opacity="0"/></radialGradient>
<linearGradient id="sc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a0a0c" stop-opacity="0"/><stop offset="1" stop-color="#6a1216"/></linearGradient>`,
    `<rect width="400" height="400" fill="url(#bg)"/><circle cx="200" cy="176" r="170" fill="url(#mg)"/><circle cx="200" cy="176" r="96" fill="url(#mo)"/>
<path d="M0 300C60 286 120 292 200 282C280 292 340 286 400 300V400H0Z" fill="#0c0405"/>
<path d="M150 236C110 226 60 236 10 222C50 246 100 256 152 252Z" fill="url(#sc)"/>
<g fill="#ff7a5a" opacity=".5" transform="translate(-3 -2)"><ellipse cx="200" cy="162" rx="92" ry="20"/><path d="M80 400C88 318 130 270 200 262C270 270 312 318 320 400Z"/></g>
<path d="M262 120L296 72" stroke="#120607" stroke-width="7" stroke-linecap="round"/><path d="M252 134L278 128" stroke="#120607" stroke-width="5" stroke-linecap="round"/>
<path d="M200 128C222 128 236 146 236 166H164C164 146 178 128 200 128Z" fill="#0b0405"/><ellipse cx="200" cy="164" rx="92" ry="20" fill="#0b0405"/>
<path d="M174 170C172 196 184 214 200 216C216 214 228 196 226 170Z" fill="#0b0405"/><path d="M188 210L185 242H215L212 210Z" fill="#0b0405"/><path d="M80 400C88 318 130 270 200 262C270 270 312 318 320 400Z" fill="#0b0405"/>
<path d="M150 252C120 262 90 258 60 262" stroke="#1a0608" stroke-width="10" stroke-linecap="round" fill="none"/>`) },
  { id: 'qua', n: 'Quạ đêm', svg: () => SVG(480, 480, '0 0 400 400', `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2230"/><stop offset="1" stop-color="#07090d"/></linearGradient>
<radialGradient id="mo" cx=".45" cy=".42" r=".6"><stop offset="0" stop-color="#f6f2e6"/><stop offset=".85" stop-color="#cfcdc2"/><stop offset="1" stop-color="#a8a69c"/></radialGradient>
<radialGradient id="mg" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#d8e0f0" stop-opacity=".3"/><stop offset="1" stop-color="#d8e0f0" stop-opacity="0"/></radialGradient>
<radialGradient id="lp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd890" stop-opacity=".9"/><stop offset=".3" stop-color="#ffa040" stop-opacity=".35"/><stop offset="1" stop-color="#ffa040" stop-opacity="0"/></radialGradient>
<linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9aa8c0" stop-opacity="0"/><stop offset="1" stop-color="#9aa8c0" stop-opacity=".25"/></linearGradient>`,
    `<rect width="400" height="400" fill="url(#bg)"/><circle cx="210" cy="150" r="170" fill="url(#mg)"/><circle cx="210" cy="150" r="96" fill="url(#mo)"/>
<circle cx="200" cy="246" r="70" fill="url(#lp)"/>
<g fill="#0a0c10"><rect x="194" y="262" width="12" height="140"/><path d="M178 400h44l-8-24h-28z"/><path d="M176 222h48l-6 40h-36z" fill="#120f0a"/><path d="M170 222L200 200L230 222Z"/><rect x="184" y="262" width="32" height="6"/></g>
<rect x="183" y="226" width="34" height="32" fill="#ffc870" opacity=".85"/><path d="M200 226V258M183 242H217" stroke="#2a1a08" stroke-width="2"/>
<path d="M200 200C196 186 186 178 172 176C176 168 186 164 196 168C202 156 214 150 226 154L240 150L232 160C240 168 242 180 236 190C246 196 262 196 276 192C262 204 244 208 228 204L214 206L212 214L206 206Z" fill="#06070a"/>
<circle cx="224" cy="160" r="2.2" fill="#e0c060"/>
<rect y="310" width="400" height="90" fill="url(#fg)"/>`) },
];
const AV = Object.fromEntries(AVS.map(a => [a.id, a]));
function avatarImg(id) {
  const a = AV[id] || AVS[0]; return svgImg('av-' + a.id, a.svg);
}

/* the detective's own picture, served by the image host and shared between every canvas that shows it */
const UPLOADS = new Map();
function uploadedAvatarImg(url) {
  let im = UPLOADS.get(url);
  if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.src = url; UPLOADS.set(url, im); }
  return im;
}
/* the image for what the server says this player wears ({ avatar, avatarUrl }) */
function avatarFor(look) {
  if (look?.avatar === 'upload' && look.avatarUrl) return uploadedAvatarImg(look.avatarUrl);
  return avatarImg(look?.avatar);
}

export { AVS, avatarFor, avatarImg };
