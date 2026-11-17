/**
 * Màn tân thủ "Nhập môn: Ấm men lam" — the steps of the coach that walks a newcomer through one solo case.
 * Pure data and progress rules (no DOM): the coach in tutorialCoach.ts draws the card and the pointer.
 * Progress only moves forward. A step is done when the server state shows it (a clue unlocked, a scene reached)
 * or when the page reports the player did it (walked, opened the case file, the bag or a hint).
 *
 * The tutorial teaches both detectives. In a real case each player keeps one role for the whole case (Sherlock the
 * Interrogator questions people, Watson the Investigator handles objects); only this tutorial room lets the single
 * player switch, with the "Đổi nhân vật" button (key Q). A step that needs the other detective points at that button.
 */

export const TUTORIAL_CASE_ID = 'case-pixel-tan-thu-vi';
const TRA_LAU = 'scene-tt-tra-lau';
const NGO = 'scene-tt-ngo';

/** Page events the coach is told about (the server state cannot see them). */
export type TutorialEvent = 'moved' | 'caseFile' | 'bag' | 'hint' | 'camera';

/** What the coach reads from the game state; every field is optional so a partial state never throws. */
export type TutorialSnapshot = {
  sceneId: string;
  clueIds: Set<string>;
  solvedPuzzleIds: Set<string>;
  collectedItemIds: Set<string>;
  resolvedChallengeIds: Set<string>;
  events: Set<TutorialEvent>;
  uiKind: string;
  roomStatus: string;
  hasActiveConfrontation: boolean;
  confrontationTestimonyId: string;
  confrontationEvidenceId: string;
  /** The solo player's current detective (INTERROGATOR = Sherlock, INVESTIGATOR = Watson); empty before the state. */
  role: string;
};

export type TutorialRole = 'INVESTIGATOR' | 'INTERROGATOR';
/** The tray button that switches detective; it exists only in the tutorial room. */
export const ROLE_BUTTON_SELECTORS = ['#tutorial-role-btn'];

/** Who each role is, as the tutorial names them. */
export function tutorialRoleName(role: string): string {
  return role === 'INVESTIGATOR' ? 'Watson (Điều tra viên)' : 'Sherlock (Thẩm vấn viên)';
}

/** The step needs the other detective now: the coach points at the switch button instead of the target. */
export function needsRoleSwitch(step: TutorialStep | undefined, snapshot: TutorialSnapshot): boolean {
  if (!step?.role || !snapshot.role || snapshot.role === step.role) return false;
  return snapshot.uiKind === 'EXPLORE';
}

/**
 * Where the pointer goes. `world` is a runtime point of a scene (2048 space); `dom` is a CSS selector, the first
 * visible match wins. `sceneId` limits a world target to its own scene.
 */
export type TutorialTarget =
  | { kind: 'world'; sceneId: string; x: number; y: number }
  | { kind: 'dom'; selectors: string[] };

export type TutorialStep = {
  id: string;
  title: string;
  text: string;
  /** Steps without a server or page signal are read and confirmed with the button. */
  manual?: boolean;
  done: (snapshot: TutorialSnapshot) => boolean;
  /** Pointer for the current moment of the step (null hides it). */
  target: (snapshot: TutorialSnapshot) => TutorialTarget | null;
  /** Which detective the step needs; the player switches with the "Đổi nhân vật" button when it is the other one. */
  role?: TutorialRole;
};

const world = (sceneId: string, x: number, y: number): TutorialTarget => ({ kind: 'world', sceneId, x, y });
const dom = (...selectors: string[]): TutorialTarget => ({ kind: 'dom', selectors });
const has = (snapshot: TutorialSnapshot, clueId: string) => snapshot.clueIds.has(clueId);
const inScene = (snapshot: TutorialSnapshot, sceneId: string) => snapshot.sceneId === sceneId;
const CASE_FILE_BUTTON = ['#case-file-btn', '#map-case-file-btn'];
/** Before the player is in the right place, the pointer shows the way there (the door or the map). */
const toScene = (snapshot: TutorialSnapshot, sceneId: string, here: TutorialTarget): TutorialTarget =>
  inScene(snapshot, sceneId)
    ? here
    : sceneId === NGO
      ? world(TRA_LAU, 1040, 1860)
      : world(NGO, 400, 1040);

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Chào thám tử mới!',
    text: 'Đây là màn tân thủ: một vụ án nhỏ để học cách chơi. Mũi tên vàng chỉ chỗ cần bấm, làm xong một bước thì bước sau tự hiện. Sir Locked chơi hai người, mỗi người giữ một vai: Sherlock (Thẩm vấn viên) hỏi chuyện nhân vật, Watson (Điều tra viên) khám đồ vật, chụp ảnh hiện trường và giữ Túi đồ. Hai người dùng chung Hồ sơ vụ án, cùng giải đố, cùng vạch lời nói dối và cùng chốt cáo buộc.',
    manual: true,
    done: () => false,
    target: () => null,
  },
  {
    id: 'roles',
    title: 'Chơi thử cả hai vai',
    text: 'Riêng màn tân thủ, bạn được chơi cả Sherlock lẫn Watson: bấm nút Đổi nhân vật (phím Q) để đổi qua lại. Ô Đội điều tra ở góc trên phải ghi bạn đang là ai. Bạn bắt đầu là Sherlock. Vào vụ thật với người khác thì mỗi người một vai, không đổi được giữa chừng, nên hai người phải phối hợp.',
    manual: true,
    done: () => false,
    target: () => dom(...ROLE_BUTTON_SELECTORS),
  },
  {
    id: 'move',
    title: 'Đi lại',
    text: 'Bấm xuống sàn để đi tới đó, hoặc dùng phím WASD / mũi tên. Thử đi tới chỗ mũi tên chỉ.',
    done: (s) => s.events.has('moved'),
    target: (s) => toScene(s, TRA_LAU, world(TRA_LAU, 1220, 1820)),
  },
  {
    id: 'talk-luu',
    title: 'Hỏi chuyện chủ trà lâu',
    text: 'Hỏi chuyện là việc của Sherlock (Thẩm vấn viên). Bấm vào ông Lưu: thám tử đi tới và mở hội thoại. Chọn câu "Chuyện gì đã xảy ra?".',
    role: 'INTERROGATOR',
    done: (s) => has(s, 'fact-tt-mat-am'),
    target: (s) => s.uiKind === 'DIALOGUE'
      ? dom('.conversation-choices button', '.bpa-dlg-choices button', '[data-vn-advance]')
      : toScene(s, TRA_LAU, world(TRA_LAU, 820, 1500)),
  },
  {
    id: 'ask-who',
    title: 'Hỏi thêm',
    text: 'Hỏi tiếp "Chiều nay ai ghé trà lâu?". Câu trả lời có ích được ghi vào Hồ sơ vụ án.',
    role: 'INTERROGATOR',
    done: (s) => has(s, 'fact-tt-hoi-mua'),
    target: (s) => s.uiKind === 'DIALOGUE'
      ? dom('.conversation-choices button', '.bpa-dlg-choices button', '[data-vn-advance]')
      : toScene(s, TRA_LAU, world(TRA_LAU, 820, 1500)),
  },
  {
    id: 'guestbook',
    title: 'Tìm vật chứng',
    text: 'Khám đồ vật là việc của Watson (Điều tra viên). Bấm Đổi nhân vật (phím Q) để sang Watson, rồi bấm vào cuốn sổ khách bìa đỏ trên quầy, cạnh khay trà. Ở vụ thật, Sherlock không khám được vật: phải nhờ đồng đội Watson.',
    role: 'INVESTIGATOR',
    done: (s) => has(s, 'evidence-tt-so-khach'),
    target: (s) => toScene(s, TRA_LAU, world(TRA_LAU, 818, 1336)),
  },
  {
    id: 'camera',
    title: 'Chụp ảnh hiện trường',
    text: 'Máy ảnh cũng là đồ nghề của Watson. Bấm nút Máy ảnh (phím Z), đưa khung ngắm vào khay trà ở đầu quầy rồi bấm để chụp. Ảnh chụp đúng chỗ thành manh mối.',
    role: 'INVESTIGATOR',
    done: (s) => has(s, 'clue-tt-vong-nuoc'),
    target: (s) => s.uiKind === 'CAMERA'
      ? world(TRA_LAU, 892, 1248)
      : toScene(s, TRA_LAU, dom('#floating-camera-btn', '#mobile-camera-btn')),
  },
  {
    id: 'puzzle',
    title: 'Giải đố',
    text: 'Câu đố thì vai nào giải cũng được. Bấm vào mấy mảnh thư xé trên quầy, cạnh cái cân, rồi ghép lại: kéo từng mảnh vào khung, nhấp đúp (hoặc phím R) để xoay mảnh bị ngược. Bí thì bấm gợi ý ngay trong câu đố.',
    done: (s) => s.solvedPuzzleIds.has('puzzle-tt-thu-xe') || has(s, 'evidence-tt-thu-tra-gia'),
    target: (s) => s.uiKind === 'PUZZLE' ? null : toScene(s, TRA_LAU, world(TRA_LAU, 526, 1288)),
  },
  {
    id: 'case-file',
    title: 'Hồ sơ vụ án',
    text: 'Hồ sơ vụ án dùng chung cho cả hai: lời khai Sherlock hỏi được và vật chứng Watson tìm được đều nằm ở đây. Bấm nút Hồ sơ vụ án để xem, rồi đóng lại.',
    done: (s) => s.events.has('caseFile'),
    target: () => dom(...CASE_FILE_BUTTON),
  },
  {
    id: 'talk-lan',
    title: 'Hỏi nhân chứng',
    text: 'Đổi lại Sherlock (phím Q) rồi hỏi cô Mỹ Lan "Chiều nay cô thấy gì?". Nhân chứng thường kể điều mình tận mắt thấy.',
    role: 'INTERROGATOR',
    done: (s) => has(s, 'fact-tt-lan-thay'),
    target: (s) => s.uiKind === 'DIALOGUE'
      ? dom('.conversation-choices button', '.bpa-dlg-choices button', '[data-vn-advance]')
      : toScene(s, TRA_LAU, world(TRA_LAU, 1340, 1540)),
  },
  {
    id: 'hint',
    title: 'Gợi ý khi bí',
    text: 'Không biết làm gì tiếp? Bấm Gợi ý. Gợi ý mức 1 chỉ hướng, mức 2 và 3 rõ dần. Bấm thử một lần.',
    done: (s) => s.events.has('hint'),
    target: () => dom('#hint-btn'),
  },
  {
    id: 'go-out',
    title: 'Sang cảnh khác',
    text: 'Bấm vào lối ra phía dưới phòng (nhãn "Ra ngõ Thạch Khố Môn") để ra ngõ. Ngoài trời đang mưa phùn; vào nhà thì mưa tắt.',
    done: (s) => inScene(s, NGO) || has(s, 'fact-tt-phuc-cho'),
    target: (s) => inScene(s, TRA_LAU) ? world(TRA_LAU, 1040, 1860) : null,
  },
  {
    id: 'talk-phuc',
    title: 'Hỏi người kéo xe',
    text: 'Sherlock hỏi chuyện: bấm vào A Phúc ở đầu ngõ phía trên và hỏi "Anh đang chờ chở ai?".',
    role: 'INTERROGATOR',
    done: (s) => has(s, 'fact-tt-phuc-cho'),
    target: (s) => s.uiKind === 'DIALOGUE'
      ? dom('.conversation-choices button', '.bpa-dlg-choices button', '[data-vn-advance]')
      : toScene(s, NGO, world(NGO, 1448, 900)),
  },
  {
    id: 'box',
    title: 'Mở hòm gỗ',
    text: 'Mở đồ là việc của Watson: đổi sang Watson (phím Q) rồi bấm vào chiếc hòm gỗ trên xe kéo.',
    role: 'INVESTIGATOR',
    done: (s) => has(s, 'evidence-tt-am-men-lam'),
    target: (s) => toScene(s, NGO, world(NGO, 1328, 870)),
  },
  {
    id: 'bag',
    title: 'Túi đồ',
    text: 'Vật nhặt được nằm trong Túi đồ, chỉ Watson mở được (phím B). Bấm Túi đồ để xem chiếc ấm men lam, rồi đóng lại.',
    role: 'INVESTIGATOR',
    done: (s) => s.events.has('bag') || s.collectedItemIds.size === 0,
    target: () => dom('#floating-bag-btn', '#mobile-inventory-btn'),
  },
  {
    id: 'talk-hamilton',
    title: 'Hỏi nghi phạm',
    text: 'Đổi lại Sherlock (phím Q), bấm vào ngài Hamilton (quý ông đội mũ cao ở phía dưới ngõ) và hỏi "Chiều nay ngài ở đâu?". Nghe kỹ: có một câu không đúng sự thật.',
    role: 'INTERROGATOR',
    done: (s) => has(s, 'fact-tt-ham-khai'),
    target: (s) => s.uiKind === 'DIALOGUE'
      ? dom('.conversation-choices button', '.bpa-dlg-choices button', '[data-vn-advance]')
      : toScene(s, NGO, world(NGO, 1088, 1480)),
  },
  {
    id: 'crack',
    title: 'Vạch trần lời nói dối',
    text: 'Ngài Hamilton nói chưa hề vào trà lâu, nhưng sổ khách có chữ ký của ngài. Mở Hồ sơ vụ án, bấm "Bắt lỗi câu này" ở câu "Tôi chưa hề bước chân vào trà lâu…", chọn chứng cứ "Chữ ký trong sổ khách" rồi bấm Xác nhận. Ở vụ thật hai người làm chung: một người bắt lỗi câu khai, người kia đưa chứng cứ, rồi cả hai cùng bấm Xác nhận.',
    done: (s) => s.resolvedChallengeIds.has('challenge-tt-chua-vao') || has(s, 'reveal-tt-ham-o-tra-lau'),
    target: (s) => {
      if (s.uiKind !== 'CASE_FILE') return dom(...CASE_FILE_BUTTON);
      if (!s.hasActiveConfrontation) return dom('[data-v3-start-testimony="frag-tt-ham-chua-vao"]', '[data-v3-edit-testimony="frag-tt-ham-chua-vao"]');
      if (s.confrontationTestimonyId !== 'frag-tt-ham-chua-vao') return dom('[data-v3-edit-testimony="frag-tt-ham-chua-vao"]');
      if (s.confrontationEvidenceId !== 'evidence-tt-so-khach') return dom('[data-v3-propose-evidence="evidence-tt-so-khach"]');
      return dom('[data-v3-confirm]');
    },
  },
  {
    id: 'accuse',
    title: 'Buộc tội',
    text: 'Đủ chứng cứ rồi! Trong Hồ sơ vụ án bấm "Lập cáo buộc". Chọn thủ phạm Ngài Hamilton; động cơ: muốn có chiếc ấm ông Lưu không chịu bán; cách làm: lúc ông Lưu vào kho, cất ấm vào hòm gỗ. Gắn chứng cứ: động cơ = Thư trả giá, cách làm = Ấm men lam trong hòm, cơ hội = Chữ ký trong sổ khách. Rồi bấm Tiếp và Xác nhận. Ở vụ thật một người lập cáo buộc, người kia phải đồng ý thì mới chốt.',
    done: (s) => s.roomStatus === 'COMPLETED',
    target: (s) => s.uiKind === 'ACCUSATION'
      ? dom('#accuse-confirm', '#accuse-next', '#accuse-review')
      : s.uiKind === 'CASE_FILE' ? dom('#case-file-accuse-btn') : dom(...CASE_FILE_BUTTON),
  },
];

/** The step to show: the first one not yet done at or after the furthest step reached (never goes back). */
export function nextStepIndex(steps: TutorialStep[], from: number, snapshot: TutorialSnapshot, manualDone: Set<string>): number {
  let index = Math.max(0, from);
  while (index < steps.length) {
    const step = steps[index];
    const finished = step.manual ? manualDone.has(step.id) : step.done(snapshot);
    if (!finished) break;
    index += 1;
  }
  return index;
}

type StateLike = {
  caseId?: string;
  players?: Array<{ role?: string | null }>;
  currentSceneId?: string;
  roomStatus?: string;
  unlockedClues?: Array<{ clueId: string }>;
  capturedClueIds?: string[];
  solvedPuzzleIds?: string[];
  collectedItemIds?: string[];
  resolvedConfrontations?: Array<{ challengeId: string }>;
  activeConfrontation?: { testimony?: { testimonyFragmentId?: string } | null; evidence?: { clueId?: string } | null } | null;
};

export function tutorialSnapshot(state: StateLike | null, uiKind: string, events: Set<TutorialEvent>): TutorialSnapshot {
  const active = state?.activeConfrontation ?? null;
  return {
    sceneId: state?.currentSceneId ?? '',
    clueIds: new Set([...(state?.unlockedClues ?? []).map((clue) => clue.clueId), ...(state?.capturedClueIds ?? [])]),
    solvedPuzzleIds: new Set(state?.solvedPuzzleIds ?? []),
    collectedItemIds: new Set(state?.collectedItemIds ?? []),
    resolvedChallengeIds: new Set((state?.resolvedConfrontations ?? []).map((record) => record.challengeId)),
    events,
    uiKind,
    roomStatus: state?.roomStatus ?? '',
    hasActiveConfrontation: Boolean(active),
    confrontationTestimonyId: active?.testimony?.testimonyFragmentId ?? '',
    confrontationEvidenceId: active?.evidence?.clueId ?? '',
    // The tutorial room has one player.
    role: state?.players?.[0]?.role ?? '',
  };
}

/** The role a hotspot needs in a two-player room: people are questioned by Sherlock, things are handled by Watson. */
export function roleForHotspot(type: string): TutorialRole | null {
  if (type === 'CHARACTER') return 'INTERROGATOR';
  if (type === 'ITEM' || type === 'OBJECT' || type === 'CLUE' || type === 'ENVIRONMENT') return 'INVESTIGATOR';
  return null;
}
