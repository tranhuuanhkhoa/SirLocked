/**
 * Màn tân thủ "Nhập môn: Ấm men lam" — the steps of the coach that walks a newcomer through one solo case.
 * Pure data and progress rules (no DOM): the coach in tutorialCoach.ts draws the card and the pointer.
 * Progress only moves forward. A step is done when the server state shows it (a clue unlocked, a scene reached)
 * or when the page reports the player did it (walked, opened the case file, the bag or a hint).
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
};

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
  /** Which detective the step needs; the room switches automatically when the player acts. */
  role?: 'INVESTIGATOR' | 'INTERROGATOR';
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
    text: 'Đây là màn tân thủ: một vụ án nhỏ để học cách chơi. Mũi tên vàng chỉ chỗ cần bấm, làm xong một bước thì bước sau tự hiện. Ở vụ thật bạn chơi cùng một người: Sherlock hỏi chuyện, Watson tìm vật chứng. Ở đây bạn làm cả hai, game tự đổi vai cho bạn.',
    manual: true,
    done: () => false,
    target: () => null,
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
    text: 'Bấm vào ông Lưu: thám tử đi tới và mở hội thoại. Chọn câu "Chuyện gì đã xảy ra?". Hỏi chuyện là việc của Sherlock.',
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
    text: 'Bấm vào cuốn sổ khách trên quầy. Khám vật là việc của Watson: game tự đổi vai cho bạn.',
    role: 'INVESTIGATOR',
    done: (s) => has(s, 'evidence-tt-so-khach'),
    target: (s) => toScene(s, TRA_LAU, world(TRA_LAU, 928, 1250)),
  },
  {
    id: 'camera',
    title: 'Chụp ảnh hiện trường',
    text: 'Bấm nút Máy ảnh (phím Z). Đưa khung ngắm vào khay trà ở đầu quầy rồi bấm để chụp. Ảnh chụp đúng chỗ thành manh mối.',
    role: 'INVESTIGATOR',
    done: (s) => has(s, 'clue-tt-vong-nuoc'),
    target: (s) => s.uiKind === 'CAMERA'
      ? world(TRA_LAU, 892, 1248)
      : toScene(s, TRA_LAU, dom('#floating-camera-btn', '#mobile-camera-btn')),
  },
  {
    id: 'puzzle',
    title: 'Giải đố',
    text: 'Bấm vào mấy mảnh thư dưới chân quầy rồi ghép lại: kéo từng mảnh vào khung, nhấp đúp (hoặc phím R) để xoay mảnh bị ngược. Bí thì bấm gợi ý ngay trong câu đố.',
    done: (s) => s.solvedPuzzleIds.has('puzzle-tt-thu-xe') || has(s, 'evidence-tt-thu-tra-gia'),
    target: (s) => s.uiKind === 'PUZZLE' ? null : toScene(s, TRA_LAU, world(TRA_LAU, 512, 1630)),
  },
  {
    id: 'case-file',
    title: 'Hồ sơ vụ án',
    text: 'Mọi lời khai và vật chứng nằm trong Hồ sơ vụ án. Bấm nút Hồ sơ vụ án để xem, rồi đóng lại.',
    done: (s) => s.events.has('caseFile'),
    target: () => dom(...CASE_FILE_BUTTON),
  },
  {
    id: 'talk-lan',
    title: 'Hỏi nhân chứng',
    text: 'Hỏi cô Mỹ Lan "Chiều nay cô thấy gì?". Nhân chứng thường kể điều mình tận mắt thấy.',
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
    text: 'Bấm vào A Phúc ở đầu ngõ phía trên và hỏi "Anh đang chờ chở ai?".',
    role: 'INTERROGATOR',
    done: (s) => has(s, 'fact-tt-phuc-cho'),
    target: (s) => s.uiKind === 'DIALOGUE'
      ? dom('.conversation-choices button', '.bpa-dlg-choices button', '[data-vn-advance]')
      : toScene(s, NGO, world(NGO, 1448, 900)),
  },
  {
    id: 'box',
    title: 'Mở hòm gỗ',
    text: 'Bấm vào chiếc hòm gỗ trên xe kéo để mở ra xem.',
    role: 'INVESTIGATOR',
    done: (s) => has(s, 'evidence-tt-am-men-lam'),
    target: (s) => toScene(s, NGO, world(NGO, 1328, 860)),
  },
  {
    id: 'bag',
    title: 'Túi đồ',
    text: 'Vật nhặt được nằm trong Túi đồ. Bấm Túi đồ để xem chiếc ấm men lam, rồi đóng lại.',
    done: (s) => s.events.has('bag') || s.collectedItemIds.size === 0,
    target: () => dom('#floating-bag-btn', '#mobile-inventory-btn'),
  },
  {
    id: 'talk-hamilton',
    title: 'Hỏi nghi phạm',
    text: 'Bấm vào ngài Hamilton (quý ông đội mũ cao ở phía dưới ngõ) và hỏi "Chiều nay ngài ở đâu?". Nghe kỹ: có một câu không đúng sự thật.',
    role: 'INTERROGATOR',
    done: (s) => has(s, 'fact-tt-ham-khai'),
    target: (s) => s.uiKind === 'DIALOGUE'
      ? dom('.conversation-choices button', '.bpa-dlg-choices button', '[data-vn-advance]')
      : toScene(s, NGO, world(NGO, 1088, 1480)),
  },
  {
    id: 'crack',
    title: 'Vạch trần lời nói dối',
    text: 'Ngài Hamilton nói chưa hề vào trà lâu, nhưng sổ khách có chữ ký của ngài. Mở Hồ sơ vụ án, bấm "Bắt lỗi câu này" ở câu "Tôi chưa hề bước chân vào trà lâu…", chọn chứng cứ "Chữ ký trong sổ khách" rồi bấm Xác nhận.',
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
    text: 'Đủ chứng cứ rồi! Trong Hồ sơ vụ án bấm "Lập cáo buộc". Chọn thủ phạm Ngài Hamilton; động cơ: muốn có chiếc ấm ông Lưu không chịu bán; cách làm: lúc ông Lưu vào kho, cất ấm vào hòm gỗ. Gắn chứng cứ: động cơ = Thư trả giá, cách làm = Ấm men lam trong hòm, cơ hội = Chữ ký trong sổ khách. Rồi bấm Tiếp và Xác nhận.',
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
  };
}

/** The role a hotspot needs in a two-player room: people are questioned by Sherlock, things are handled by Watson. */
export function roleForHotspot(type: string): 'INVESTIGATOR' | 'INTERROGATOR' | null {
  if (type === 'CHARACTER') return 'INTERROGATOR';
  if (type === 'ITEM' || type === 'OBJECT' || type === 'CLUE' || type === 'ENVIRONMENT') return 'INVESTIGATOR';
  return null;
}
