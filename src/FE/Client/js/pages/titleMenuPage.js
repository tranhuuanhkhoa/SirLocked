import '../../../css/23-bpa-home.css';
import { authApi } from '../api/authApi.js';
import { marketApi } from '../api/marketApi.js';
import { profileApi } from '../api/profileApi.js';
import { roomApi } from '../api/roomApi.js';
import { weeklyApi } from '../api/weeklyApi.js';
import { workshopApi } from '../api/workshopApi.js';
import { activeRoomDestination } from '../services/roomInvites.js';
import { session } from '../services/session.js';
import { hydrateTutorialBanner } from '../services/tutorial.js';
import { tr, uiLanguage } from '../services/i18n.js';
import { escapeHtml, initials, render } from '../utils/dom.js';
import { changeText, defName, fmt as formatPrice, itemTile, rarityLabel, rarityOf } from './market/marketKit.js';
import { navigate } from '../services/navigation.js';

/** Fired with the /profile/me payload so the header chip can reuse it. */
export const PROFILE_EVENT = 'sirlocked:profile';

const RANK_ORDER = ['APPRENTICE', 'DETECTIVE', 'INSPECTOR', 'MASTER'];
const RANK_EN = { APPRENTICE: 'Apprentice', DETECTIVE: 'Detective', INSPECTOR: 'Inspector', MASTER: 'Master' };

/** The backend labels ranks in Vietnamese only; English follows the stable tier key. */
export function detectiveRankLabel(rank) {
  if (!rank) return '';
  return tr(RANK_EN[rank.tier] || rank.tierLabel || '', rank.tierLabel || '');
}

function nextRankLabel(rank) {
  const next = RANK_ORDER[RANK_ORDER.indexOf(rank?.tier) + 1];
  return tr(RANK_EN[next] || rank?.nextTierLabel || '', rank?.nextTierLabel || '');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString(uiLanguage() === 'vi' ? 'vi-VN' : 'en-US');
}

function percent(fraction) {
  return `${Math.round((fraction ?? 0) * 100)}%`;
}

function timeLeft(weekEnd) {
  const remaining = new Date(weekEnd).getTime() - Date.now();
  if (Number.isNaN(remaining)) return '—';
  if (remaining <= 0) return tr('ENDED', 'ĐÃ KẾT THÚC');
  const minutes = Math.floor(remaining / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return tr(`${days}D ${hours}H`, `${days}N ${hours}G`);
  return tr(`${hours}H ${minutes % 60}M`, `${hours}G ${minutes % 60}P`);
}

function isoWeek(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
}

const ARROW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
const CASE_FILE_ART = `
  <svg class="bpa-home-feature-art" width="84" height="104" viewBox="0 0 84 104" aria-hidden="true">
    <rect width="84" height="104" fill="#0d1014"/>
    <rect x="14" y="20" width="44" height="58" fill="#6b2a1c"/>
    <rect x="18" y="24" width="36" height="50" fill="none" stroke="#c7a24b"/>
    <path d="M58 22h8v54h-8" fill="#e9dcc0"/>
    <circle cx="36" cy="44" r="6" fill="#c7a24b"/>
    <path d="M34 48h4l1.5 12h-7z" fill="#c7a24b"/>
    <path d="M30 88h40" stroke="#bf3b2c" stroke-width="2"/>
  </svg>`;

/** Red strings from the centre column to the four edge pins (desktop only). */
function threadsMarkup() {
  const lines = '<line pathLength="1" x1="380" y1="23.8%" x2="100%" y2="50%"/><line pathLength="1" x1="380" y1="76.2%" x2="100%" y2="50%"/>';
  const half = (side) => `
    <svg class="bpa-home-threads bpa-home-threads--${side}" aria-hidden="true" focusable="false">
      <g class="bpa-home-thread-shadow">${lines}</g>
      <g class="bpa-home-thread">${lines}</g>
    </svg>`;
  return half('left') + half('right');
}

function statCell(label, value, id) {
  return `<div><dt>${label}</dt><dd id="${id}">${value}</dd></div>`;
}

export function renderTitleMenuPage(app) {
  const user = session.user();
  const name = user?.fullName || tr('Detective', 'Thám tử');
  const role = session.isAdmin() ? 'ADMIN' : session.isVip() ? 'VIP' : tr('DETECTIVE', 'THÁM TỬ');

  render(app, `
    <section class="title-menu-screen bpa-home" aria-labelledby="title-menu-heading">
      <div class="bpa-container bpa-home-wrap">
        <h1 id="title-menu-heading" class="bpa-sr">${tr('Sir Locked home', 'Trang chủ Sir Locked')}</h1>
        <div class="tt-menu-banner" id="home-tutorial" hidden></div>
        <div class="bpa-home-grid">
          ${threadsMarkup()}

          <div class="bpa-home-slot bpa-home-room">
            <div class="bpa-home-card bpa-home-card--kraft bpa-tilt-l">
              <span class="bpa-pin" aria-hidden="true"></span>
              <span class="bpa-pin bpa-pin--red bpa-home-edgepin bpa-home-edgepin--right" aria-hidden="true"></span>
              <p class="bpa-home-head"><span>${tr('FILE 01 · ROOMS', 'HỒ SƠ 01 · PHÒNG')}</span><span id="home-open-rooms">${tr('2 DETECTIVES', '2 THÁM TỬ')}</span></p>
              <h2 class="bpa-home-title">${tr('Investigation room', 'Phòng điều tra')}</h2>
              <p class="bpa-home-text">${tr(
                'Play with friends in a private room, or join a public room that is waiting for a partner.',
                'Chơi với bạn bè trong phòng riêng, hoặc vào một phòng công khai đang chờ người.',
              )}</p>
              <div class="bpa-home-tiles">
                <a class="bpa-home-tile" href="/rooms">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2f6363" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                  <strong class="is-teal">${tr('PUBLIC', 'CÔNG KHAI')}</strong>
                  <span>${tr('Open rooms anyone can join', 'Ai cũng thấy và vào được')}</span>
                </a>
                <a class="bpa-home-tile" href="/create-room">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7a3f27" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2.5"/></svg>
                  <strong class="is-rust">${tr('PRIVATE', 'RIÊNG TƯ')}</strong>
                  <span>${tr('Invite code only', 'Chỉ vào bằng mã mời')}</span>
                </a>
              </div>
              <div class="bpa-home-foot" id="home-rooms" aria-live="polite">
                <span class="bpa-home-go is-static">${tr('Checking your rooms…', 'Đang kiểm tra phòng…')}</span>
              </div>
            </div>
          </div>

          <div class="bpa-home-slot bpa-home-work">
            <a class="bpa-home-card bpa-home-card--folder bpa-home-cardlink bpa-tilt-r" href="/workshop">
              <span class="bpa-pin" aria-hidden="true"></span>
              <span class="bpa-pin bpa-pin--red bpa-home-edgepin bpa-home-edgepin--right" aria-hidden="true"></span>
              <p class="bpa-home-head"><span>${tr('FILE 02 · COMMUNITY', 'HỒ SƠ 02 · CỘNG ĐỒNG')}</span><span>WORKSHOP</span></p>
              <h2 class="bpa-home-title">${tr('Community cases', 'Vụ án cộng đồng')}</h2>
              <div class="bpa-home-feature" id="home-featured" aria-busy="true">
                ${CASE_FILE_ART}
                <div class="bpa-home-feature-copy"><span class="bpa-home-muted">${tr('Opening the file…', 'Đang mở hồ sơ…')}</span></div>
              </div>
              <span class="bpa-home-go">${tr('EXPLORE WORKSHOP', 'KHÁM PHÁ WORKSHOP')} ${ARROW}</span>
            </a>
          </div>

          <div class="bpa-home-slot bpa-home-center">
            <a class="bpa-home-who bpa-paper bpa-home-cardlink" href="/detective" aria-labelledby="home-who-name home-who-go">
              <span class="bpa-pin" aria-hidden="true"></span>
              <p class="bpa-home-head bpa-home-head--rule"><span>${tr('DETECTIVE CARD', 'THẺ THÁM TỬ')}</span><span>${escapeHtml(role)}</span></p>
              <div class="bpa-home-who-row">
                <span class="bpa-avatar bpa-avatar--lg" aria-hidden="true">${escapeHtml(initials(name))}</span>
                <div class="bpa-home-who-copy">
                  <h2 id="home-who-name" class="bpa-home-who-name">${escapeHtml(name)}</h2>
                  <span class="bpa-home-rank" id="home-rank">${escapeHtml(role)}</span>
                  <span class="bpa-home-progress" aria-hidden="true"><span id="home-progress-fill"></span></span>
                  <span class="bpa-home-progress-text" id="home-progress-text">${tr('Loading your record…', 'Đang tải hồ sơ…')}</span>
                </div>
              </div>
              <dl class="bpa-home-stats">
                ${statCell(tr('CASES SOLVED', 'VỤ ĐÃ PHÁ'), '—', 'home-stat-solved')}
                ${statCell(tr('WIN RATE', 'TỈ LỆ THẮNG'), '—', 'home-stat-rate')}
                ${statCell(tr('CASES PLAYED', 'VỤ ĐÃ CHƠI'), '—', 'home-stat-played')}
              </dl>
              <span class="bpa-sr" id="home-who-go">${tr('Open detective profile', 'Mở hồ sơ thám tử')}</span>
            </a>

            <section class="bpa-home-ready" aria-labelledby="home-ready-title">
              <span class="bpa-pin bpa-pin--red" aria-hidden="true"></span>
              <div class="bpa-home-scene">
                <img src="/assets/menu/sirlocked-title-menu.png" alt="${tr('Crime scene: a London street at night, gas lamps and wet cobbles', 'Hiện trường: phố London về đêm, đèn khí và mặt đường ướt')}">
                <span class="bpa-tape bpa-home-tape" aria-hidden="true"></span>
                <span class="bpa-tape bpa-home-tape bpa-home-tape--end" aria-hidden="true"></span>
                <span class="bpa-home-scene-tag">${tr('CRIME SCENE · 23:47', 'HIỆN TRƯỜNG · 23:47')}</span>
              </div>
              <div class="bpa-home-ready-copy">
                <p class="bpa-kicker">${tr('NEW CASE · QUICK MATCH', 'VỤ ÁN MỚI · GHÉP ĐÔI NHANH')}</p>
                <h2 id="home-ready-title" class="bpa-home-ready-title">${tr('Ready to crack the case?', 'Sẵn sàng phá án?')}</h2>
                <p>${tr(
                  'Get paired with another detective: one examines the scene, the other questions the witnesses.',
                  'Ghép đôi với một thám tử khác: một người khám nghiệm hiện trường, một người hỏi nhân chứng.',
                )}</p>
              </div>
              <a class="bpa-btn bpa-btn--red bpa-btn--block bpa-home-start" href="/find-game">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/></svg>
                ${tr('FIND A GAME', 'TÌM TRẬN')}
              </a>
              <a class="bpa-link bpa-link--gold bpa-home-join" href="/rooms">${tr('Playing with friends? Create a private room', 'Chơi với bạn bè? Tạo phòng riêng')}</a>
            </section>
          </div>

          <div class="bpa-home-slot bpa-home-badges bpa-home-market">
            <a class="bpa-home-card bpa-home-card--ledger bpa-home-cardlink bpa-tilt-r" href="/market">
              <span class="bpa-pin" aria-hidden="true"></span>
              <span class="bpa-pin bpa-pin--red bpa-home-edgepin bpa-home-edgepin--left" aria-hidden="true"></span>
              <p class="bpa-home-head"><span>${tr('TRADING LEDGER', 'SỔ GIAO DỊCH')}</span><span>${tr('BUY · SELL · SWAP', 'MUA · BÁN · ĐỔI')}</span></p>
              <h2 class="bpa-home-title">${tr('Market', 'Chợ đồ')}</h2>
              <ul class="bpa-mk-homelist" id="home-market" aria-busy="true">
                <li class="bpa-home-muted">${tr('Opening the ledger…', 'Đang mở sổ giao dịch…')}</li>
              </ul>
              <span class="bpa-home-go">${tr('ENTER THE MARKET', 'VÀO CHỢ')} ${ARROW}</span>
            </a>
          </div>

          <div class="bpa-home-slot bpa-home-week">
            <a class="bpa-home-card bpa-home-card--news bpa-home-cardlink bpa-tilt-l" href="/workshop/challenge">
              <span class="bpa-pin" aria-hidden="true"></span>
              <span class="bpa-pin bpa-pin--red bpa-home-edgepin bpa-home-edgepin--left" aria-hidden="true"></span>
              <p class="bpa-home-masthead"><span>${tr('221B GAZETTE · SPECIAL ISSUE', 'BÁO 221B · SỐ ĐẶC BIỆT')}</span><span id="home-week-no"></span></p>
              <p class="bpa-kicker bpa-home-week-kicker">${tr('WEEKLY CHALLENGE', 'THỬ THÁCH TUẦN')}</p>
              <div id="home-week" aria-busy="true">
                <h2 class="bpa-home-title bpa-home-title--news">${tr('Checking the paper…', 'Đang đọc báo…')}</h2>
              </div>
              <span class="bpa-home-go">${tr('TAKE THE CHALLENGE', 'THAM GIA THỬ THÁCH')} ${ARROW}</span>
            </a>
          </div>
        </div>

        <p class="bpa-home-exit">
          <button class="bpa-link bpa-link--gold" id="title-menu-logout" type="button">${tr('Leave 221B · Log out', 'Rời 221B · Đăng xuất')}</button>
        </p>
      </div>
    </section>`);

  app.querySelector('#title-menu-logout')?.addEventListener('click', async () => {
    try {
      await authApi.logout();
    } catch {
      // Local sign-out still succeeds if the server cannot revoke the token.
    }
    const signIn = session.loginAddress();
    session.clear();
    navigate(signIn);
  });

  // Each card fills itself; a slow or failed request never blocks the others.
  void hydrateTutorialBanner(app);
  loadProfile(app);
  loadActiveRooms(app);
  loadOpenRoomCount(app);
  loadMarket(app);
  loadFeatured(app);
  loadChallenge(app);
}

async function loadProfile(app) {
  let profile;
  try {
    profile = await profileApi.me();
  } catch {
    if (app.isConnected) app.querySelector('#home-progress-text').textContent = tr('Your record could not be loaded.', 'Không tải được hồ sơ.');
    return;
  }
  if (!app.isConnected) return;
  window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: profile }));
  const rank = profile.rank || {};
  const progress = Math.max(0, Math.min(100, Math.round(rank.progressPercent || 0)));
  const remaining = rank.nextThreshold != null ? Math.max(0, rank.nextThreshold - (rank.solved ?? profile.casesSolved ?? 0)) : 0;
  app.querySelector('#home-rank').textContent = detectiveRankLabel(rank) || tr('Detective', 'Thám tử');
  app.querySelector('#home-progress-fill').style.width = `${progress}%`;
  app.querySelector('#home-progress-text').textContent = rank.nextThreshold != null
    ? tr(`${remaining} more ${remaining === 1 ? 'case' : 'cases'} to ${nextRankLabel(rank)}`, `Còn ${remaining} vụ tới ${nextRankLabel(rank)}`)
    : tr('Highest rank reached', 'Đã đạt cấp bậc cao nhất');
  app.querySelector('#home-stat-solved').textContent = formatNumber(profile.casesSolved);
  app.querySelector('#home-stat-rate').textContent = percent(profile.successRate);
  app.querySelector('#home-stat-played').textContent = formatNumber(profile.casesPlayed);
}

async function loadActiveRooms(app) {
  let rooms = null;
  try {
    rooms = (await roomApi.mine()).filter((room) => activeRoomDestination(room));
  } catch {
    rooms = null;
  }
  if (!app.isConnected) return;
  const mount = app.querySelector('#home-rooms');
  if (!rooms?.length) {
    mount.innerHTML = `<span class="bpa-home-go is-static">${rooms
      ? tr('No open rooms right now', 'Chưa có phòng nào đang mở')
      : tr('Your rooms could not be checked', 'Không kiểm tra được phòng của bạn')}</span>`;
    return;
  }
  // One open room resumes directly; several are listed on the cases page.
  const href = rooms.length === 1 ? activeRoomDestination(rooms[0]) : '/cases';
  const label = rooms.length === 1
    ? tr('Resume your open case', 'Tiếp tục ván đang chơi')
    : tr(`${rooms.length} open rooms · resume`, `${rooms.length} phòng đang mở · tiếp tục`);
  mount.innerHTML = `<a class="bpa-home-go" href="${href}">${label} ${ARROW}</a>`;
}

/** "12 PHÒNG MỞ": public rooms with a free seat; the static label stays if the list is unavailable. */
async function loadOpenRoomCount(app) {
  let rooms;
  try {
    rooms = await roomApi.publicRooms({ openOnly: true });
  } catch {
    return;
  }
  const label = app.isConnected ? app.querySelector('#home-open-rooms') : null;
  if (!label || !Array.isArray(rooms)) return;
  label.textContent = tr(`${rooms.length} OPEN ${rooms.length === 1 ? 'ROOM' : 'ROOMS'}`, `${rooms.length} PHÒNG MỞ`);
}

/** Chợ đồ teaser: the three most traded item types with their lowest ask and 30-day change. */
async function loadMarket(app) {
  const list = app.querySelector('#home-market');
  let rows = null;
  try {
    rows = (await marketApi.browse({ sort: 'popular' })).rows.slice(0, 3);
  } catch {
    rows = null;
  }
  if (!app.isConnected) return;
  list.removeAttribute('aria-busy');
  if (!rows?.length) {
    list.innerHTML = `<li class="bpa-home-muted">${tr('The market could not be opened.', 'Không mở được sổ giao dịch.')}</li>`;
    return;
  }
  list.innerHTML = rows.map((row) => {
    const rarity = rarityOf(row.def.rarity);
    const change = changeText(row.changePercent);
    return `
    <li class="bpa-mk-homerow">
      ${itemTile(row.def, 34, 28)}
      <span class="bpa-mk-homename"><span>${escapeHtml(defName(row.def))}</span><span class="bpa-mk-rar is-${rarity.cls}">${escapeHtml(rarityLabel(row.def.rarity).toUpperCase())}</span></span>
      <span class="bpa-mk-homeprice">${row.lowestAsk != null ? formatPrice(row.lowestAsk) : '—'}<small class="${change.up ? 'is-up' : 'is-down'}">${row.lowestAsk != null ? change.text : tr('none listed', 'chưa rao')}</small></span>
    </li>`;
  }).join('');
}

async function loadFeatured(app) {
  const mount = app.querySelector('#home-featured');
  let feature = null;
  let kicker = tr('CASE OF THE WEEK', 'VỤ ÁN CỦA TUẦN');
  try {
    const weekly = await weeklyApi.caseOfWeek();
    if (weekly) {
      const stats = await workshopApi.stats(weekly.caseId).catch(() => null);
      feature = { ...weekly, title: weekly.caseTitle, totalPlays: stats?.totalPlays, wrongCulpritRate: stats?.wrongCulpritRate };
    }
  } catch {
    // Fall back to the most played community case below.
  }
  if (!feature) {
    try {
      const hot = await workshopApi.cases({ sort: 'hot', pageSize: 1 });
      if (hot?.items?.[0]) {
        feature = hot.items[0];
        kicker = tr('MOST PLAYED', 'ĐANG ĐƯỢC CHƠI NHIỀU');
      }
    } catch {
      feature = null;
    }
  }
  if (!app.isConnected) return;
  mount.removeAttribute('aria-busy');
  if (!feature) {
    mount.innerHTML = `${CASE_FILE_ART}
      <div class="bpa-home-feature-copy"><span class="bpa-home-muted">${tr(
        'No featured case this week — browse the community archive.',
        'Tuần này chưa có vụ nổi bật — hãy xem kho vụ án cộng đồng.',
      )}</span></div>`;
    return;
  }
  const facts = [
    feature.estimatedMinutes ? tr(`${feature.estimatedMinutes} min`, `${feature.estimatedMinutes} phút`) : '',
    feature.totalPlays != null ? tr(`${formatNumber(feature.totalPlays)} plays`, `${formatNumber(feature.totalPlays)} lượt chơi`) : '',
  ].filter(Boolean).join(' · ');
  const wrong = feature.totalPlays > 0 && feature.wrongCulpritRate != null
    ? `<span class="bpa-home-feature-note">${tr(`${percent(feature.wrongCulpritRate)} of teams accused the wrong person`, `${percent(feature.wrongCulpritRate)} đội buộc tội nhầm`)}</span>`
    : '';
  mount.innerHTML = `
    ${feature.coverImageUrl
      ? `<span class="bpa-home-feature-cover"><img src="${escapeHtml(feature.coverImageUrl)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></span>`
      : CASE_FILE_ART}
    <div class="bpa-home-feature-copy">
      <span class="bpa-home-feature-kicker">${kicker}</span>
      <strong class="bpa-home-feature-title">${escapeHtml(feature.title)}</strong>
      ${facts ? `<span>${facts}</span>` : ''}
      ${wrong}
    </div>`;
}

async function loadChallenge(app) {
  const mount = app.querySelector('#home-week');
  let challenge = null;
  let board = null;
  try {
    [challenge, board] = await Promise.all([
      weeklyApi.challenge(),
      weeklyApi.challengeLeaderboard(1).catch(() => null),
    ]);
  } catch {
    challenge = undefined;
  }
  if (!app.isConnected) return;
  mount.removeAttribute('aria-busy');
  if (!challenge) {
    mount.innerHTML = `
      <h2 class="bpa-home-title bpa-home-title--news">${challenge === undefined
        ? tr('The paper is late', 'Báo chưa tới')
        : tr('No challenge this week', 'Chưa có thử thách tuần')}</h2>
      <p class="bpa-home-text bpa-home-text--news">${challenge === undefined
        ? tr('The weekly challenge could not be loaded.', 'Không tải được thử thách tuần.')
        : tr('A new weekly challenge will be posted here.', 'Thử thách tuần mới sẽ được đăng tại đây.')}</p>`;
    return;
  }
  const week = isoWeek(challenge.weekStart);
  if (week) app.querySelector('#home-week-no').textContent = tr(`WEEK ${week}`, `TUẦN ${week}`);
  mount.innerHTML = `
    <h2 class="bpa-home-title bpa-home-title--news">${escapeHtml(challenge.caseTitle)}</h2>
    <p class="bpa-home-text bpa-home-text--news">${tr(
      'Solve it fastest to put your team on this week’s honour roll.',
      'Phá án nhanh nhất để có tên trên bảng vàng của tuần.',
    )}</p>
    <div class="bpa-home-ticker">
      <div><span>${tr('TIME LEFT', 'CÒN LẠI')}</span><strong>${timeLeft(challenge.weekEnd)}</strong></div>
      <div><span>${tr('TEAMS RANKED', 'ĐỘI ĐÃ XẾP HẠNG')}</span><strong>${board ? formatNumber(board.totalRanked ?? board.entries?.length ?? 0) : '—'}</strong></div>
    </div>`;
}
