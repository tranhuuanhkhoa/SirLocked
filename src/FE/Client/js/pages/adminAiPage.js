import { aiCaseApi } from '../api/aiCaseApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { navigate } from '../services/navigation.js';
import { plural, tr } from '../services/i18n.js';
import { renderSafeMarkdown } from '../utils/safeMarkdown.js';
import { icon, pageHead, pill, stateBox, tile } from '../components/admin/ui.js';
import { gateCheckText, isV3, v3PublishGate } from './adminV3Gates.js';
import { mountPresentationEditor, presentationPlaceholder } from './adminPresentation.js';

const STATUS_AWAITING_APPROVAL = 'STORY_AWAITING_APPROVAL';
const STATUS_TRUTH_AWAITING_APPROVAL = 'CASE_TRUTH_AWAITING_APPROVAL';
const STATUS_TRUTH_INVALID = 'CASE_TRUTH_INVALID';
const STATUS_FULL_LOGIC_AWAITING_APPROVAL = 'FULL_LOGIC_AWAITING_APPROVAL';
const STATUS_SCENE_LAYOUT_AWAITING_APPROVAL = 'SCENE_LAYOUT_AWAITING_APPROVAL';
const STATUS_READY_TO_PUBLISH = 'READY_TO_PUBLISH';
const STATUS_PUBLISHED = 'PUBLISHED';
const STATUS_GENERATED_INVALID = 'GENERATED_INVALID';
const TERMINAL_STATUSES = new Set([STATUS_AWAITING_APPROVAL, STATUS_TRUTH_AWAITING_APPROVAL, STATUS_TRUTH_INVALID, STATUS_FULL_LOGIC_AWAITING_APPROVAL, STATUS_SCENE_LAYOUT_AWAITING_APPROVAL, STATUS_READY_TO_PUBLISH, STATUS_PUBLISHED, STATUS_GENERATED_INVALID, 'CANCELLED']);
// AWAITING_CLAUDE: the run is parked until the Claude bot answers through the bridge.
const ACTIVE_QUEUE_STATES = new Set(['PENDING', 'RUNNING', 'RETRY_SCHEDULED', 'AWAITING_CLAUDE']);
const AWAITING_STATUSES = new Set([STATUS_AWAITING_APPROVAL, STATUS_TRUTH_AWAITING_APPROVAL, STATUS_FULL_LOGIC_AWAITING_APPROVAL, STATUS_SCENE_LAYOUT_AWAITING_APPROVAL]);
// A VIP order waiting for an admin (or rejected) cannot move by itself, so nothing polls it.
const isTerminalDraft = (draft) => draft?.status === 'CANCELLED'
  || draft?.orderStatus === 'AWAITING_OWNER_APPROVAL' || draft?.orderStatus === 'REJECTED'
  || (TERMINAL_STATUSES.has(draft?.status) && !ACTIVE_QUEUE_STATES.has(draft?.queueState));
// A queued or running draft still carries the failurePhase/validationErrors of the attempt before
// it, so the UI must not present them as the outcome of the run that is currently in flight.
const isGeneratingDraft = (draft) => ACTIVE_QUEUE_STATES.has(draft?.queueState)
  || String(draft?.status || '').startsWith('GENERATING_');
const TRUTH_ARTIFACT_ORDER = ['CASE_SEED', 'CORE_TRUTH', 'TIMELINE', 'OPPORTUNITY', 'EVIDENCE', 'STATEMENTS', 'PROOF_GRAPH'];
const PRESETS = {
  NORMAL_RANDOM: {
    label: 'Normal random',
    labelVi: 'Ngẫu nhiên cân bằng',
    stageCount: 4,
    difficulty: 'medium',
    description: 'Balanced generation; AI picks a sensible mix of mechanics.',
    descriptionVi: 'Cấu hình cân bằng; AI chọn tổ hợp cơ chế phù hợp.',
  },
  FULL_FEATURE: {
    label: 'Full Feature Case',
    labelVi: 'Vụ án đầy đủ tính năng',
    stageCount: 6,
    difficulty: 'hard',
    description: 'Max scope: all puzzle types, item use, combine, camera, dialogue, challenges, deductions.',
    descriptionVi: 'Phạm vi tối đa: đủ loại câu đố, vật phẩm, kết hợp, camera, hội thoại, thử thách và suy luận.',
  },
  SHORT_DEMO: {
    label: 'Short Demo',
    labelVi: 'Bản thử ngắn',
    stageCount: 2,
    difficulty: 'easy',
    description: 'Compact feature demo: 2 stages, 2–3 scenes, 4 characters. Requires 1 combine recipe, 1 item use, 1 puzzle, 1 branching dialogue, 1 confrontation, 1 deduction, and 1 teamwork chain.',
    descriptionVi: 'Vụ án gọn đủ cơ chế: 2 chặng, 2–3 cảnh, 4 nhân vật. Bắt buộc 1 công thức ghép vật phẩm, 1 lần dùng vật phẩm, 1 câu đố, 1 hội thoại phân nhánh, 1 đối chất, 1 suy luận và 1 chuỗi phối hợp hai vai.',
  },
  PUZZLE_HEAVY: {
    label: 'Puzzle Heavy',
    labelVi: 'Nặng câu đố',
    stageCount: 5,
    difficulty: 'hard',
    description: 'Forces code, sequence, symbol, item-use, and combine mechanics.',
    descriptionVi: 'Ưu tiên mật mã, chuỗi, ký hiệu, sử dụng và kết hợp vật phẩm.',
  },
  DIALOGUE_HEAVY: {
    label: 'Dialogue Heavy',
    labelVi: 'Nặng hội thoại',
    stageCount: 5,
    difficulty: 'medium',
    description: 'Focuses on conversation trees, testimony, contradictions, and deductions.',
    descriptionVi: 'Tập trung vào cây hội thoại, lời khai, mâu thuẫn và suy luận.',
  },
};

const CASE_TYPES = {
  RANDOM: ['Random crime type', 'Loại vụ án ngẫu nhiên'],
  MURDER: ['Murder', 'Án mạng'],
  MISSING_PERSON: ['Missing person', 'Mất tích'],
  THEFT: ['Theft', 'Trộm cắp'],
  SABOTAGE: ['Sabotage', 'Phá hoại'],
  FRAUD: ['Fraud', 'Lừa đảo'],
  KIDNAPPING: ['Kidnapping', 'Bắt cóc'],
};

/**
 * The worlds an order can be set in (AiCaseWorlds on the server). The old setting lock (eight European places) is gone:
 * places now come from the chosen world's picture library.
 */
const WORLDS = [
  { id: 'HANG_DUONG_VICTORIAN', name: ['Hang Duong Street', 'Phố Hàng Đường'], sub: ['Victorian-style port city', 'Thành phố cảng kiểu Victoria'] },
  { id: 'TAISHO_JAPAN', name: ['Taishō Japan', 'Nhật Bản Taishō'], sub: ['Lantern streets, trams, tea houses', 'Phố đèn lồng, tàu điện, nhà trà'] },
  { id: 'SHANGHAI_1930', name: ['Shanghai 1930', 'Thượng Hải 1930'], sub: ['Concessions, wharves, stone-gate lanes', 'Tô giới, bến sông, ngõ thạch khố môn'] },
  { id: 'NEW_WORLD', name: ['New world', 'Thế giới mới'], sub: ['Described in your idea; drawn from scratch', 'Mô tả trong ý tưởng; vẽ mới từ đầu'] },
];
const NEW_WORLD = 'NEW_WORLD';
const LOCATION_KINDS = { OUTDOOR_MAP: ['Outdoor', 'Ngoài trời'], INTERIOR: ['Indoor', 'Trong nhà'] };
const WEATHERS = {
  AUTO: ['Let the bot choose', 'Để bot chọn'], CLEAR: ['Sunny', 'Nắng'], RAIN: ['Rain', 'Mưa'],
  WIND: ['Wind', 'Gió'], SNOW: ['Snow', 'Tuyết'], STORM: ['Thunderstorm', 'Giông'],
};
const TIMES_OF_DAY = { AUTO: ['Let the bot choose', 'Để bot chọn'], DAY: ['Day', 'Ngày'], DUSK: ['Dusk', 'Hoàng hôn'], NIGHT: ['Night', 'Đêm'] };
const CONTENT_LEVELS = { LIGHT: ['Light', 'Nhẹ'], STANDARD: ['Standard', 'Thường'] };
const CONTENT_LEVEL_HELP = {
  LIGHT: ['No blood or gore; fine for every age.', 'Không máu me; hợp mọi lứa tuổi.'],
  STANDARD: ['Classic detective fiction; violence is described, never dwelt on.', 'Trinh thám cổ điển; có nhắc tới bạo lực nhưng không tả kỹ.'],
};
const DIFFICULTIES = { easy: ['Easy', 'Dễ'], medium: ['Medium', 'Vừa'], hard: ['Hard', 'Khó'] };
const STAGE_OPTIONS = [2, 3, 4, 5, 6];
const PLAY_MINUTES = [20, 30, 45, 60];
const SUSPECT_OPTIONS = [3, 4, 5, 6];
/** PixelLab generations the bot may spend on new pictures; 0 means the library only. ADMIN only. */
const PIXELLAB_CAPS = [0, 30, 60, 100];
const REVIEW_MODES = { FULL: ['Full · 4 gates', 'Đầy đủ 4 cổng'], FAST: ['Fast · 2 reviews', 'Nhanh · duyệt 2 lần'] };
/** Chips that start a line of the idea, so a creator remembers what a good brief covers. */
const IDEA_HINTS = {
  victim: ['Victim', 'Nạn nhân'],
  weapon: ['Weapon', 'Hung khí'],
  secret: ['Secret', 'Bí mật'],
  atmosphere: ['Atmosphere', 'Bầu không khí'],
};
const MAX_IDEA = 2000;
const MAX_CHARACTER_NOTES = 600;
/** The server takes at most 12 library keys per list, and suspects + 3 NPCs. */
const MAX_LOCATIONS = 12;
const EXTRA_NPCS = 3;
/** What the server forces per preset (AiCaseService.ApplyPresetDefaults): the form only offers these. */
const PRESET_LIMITS = {
  NORMAL_RANDOM: { stages: [2, 6], difficulties: ['easy', 'medium', 'hard'] },
  FULL_FEATURE: { stages: [6, 6], difficulties: ['hard'] },
  SHORT_DEMO: { stages: [2, 2], difficulties: ['easy'] },
  PUZZLE_HEAVY: { stages: [5, 6], difficulties: ['hard'] },
  DIALOGUE_HEAVY: { stages: [5, 6], difficulties: ['medium', 'hard'] },
};
/** Order fields the server can name in an error (errors.field = "order.<name>"), mapped to the form field that shows it. */
const ORDER_ERROR_FIELDS = {
  world: 'world', locationids: 'locationIds', npcids: 'npcIds', suspectcount: 'suspectCount', characternotes: 'characterNotes',
  weather: 'weather', timeofday: 'timeOfDay', playminutes: 'playMinutes', contentlevel: 'contentLevel',
  pixellabcap: 'pixelLabCap', reviewmode: 'reviewMode', prompt: 'prompt', stagecount: 'stageCount', difficulty: 'difficulty',
};
/** What a creator reads under a refused field; the server's own words follow it. */
const FIELD_ERROR_LABELS = {
  world: ['Pick one of the four worlds.', 'Hãy chọn một trong bốn thế giới.'],
  locationIds: ['Pick at most 12 places from the library.', 'Chỉ chọn tối đa 12 địa điểm trong thư viện.'],
  npcIds: ['Too many NPCs for the number of suspects (suspects + 3 at most).', 'Quá nhiều NPC so với số nghi phạm (tối đa số nghi phạm + 3).'],
  suspectCount: ['Suspects must be 3 to 6.', 'Số nghi phạm phải từ 3 đến 6.'],
  characterNotes: ['Character notes are limited to 600 characters.', 'Mô tả nhân vật tối đa 600 ký tự.'],
  weather: ['Pick a weather from the list.', 'Hãy chọn thời tiết trong danh sách.'],
  timeOfDay: ['Pick a time of day from the list.', 'Hãy chọn thời điểm trong danh sách.'],
  playMinutes: ['Play time must be 20, 30, 45 or 60 minutes.', 'Thời lượng chơi phải là 20, 30, 45 hoặc 60 phút.'],
  contentLevel: ['Pick Light or Standard.', 'Hãy chọn Nhẹ hoặc Thường.'],
  pixelLabCap: ['Pick library only, 30, 60 or 100 generations.', 'Hãy chọn chỉ thư viện, 30, 60 hoặc 100 lượt.'],
  reviewMode: ['Pick full or fast review.', 'Hãy chọn duyệt đầy đủ hoặc nhanh.'],
  prompt: ['The idea is limited to 2,000 characters.', 'Ý tưởng tối đa 2.000 ký tự.'],
  stageCount: ['Pick a number of stages this preset allows.', 'Hãy chọn số chặng mà cấu hình này cho phép.'],
  difficulty: ['Pick a difficulty this preset allows.', 'Hãy chọn độ khó mà cấu hình này cho phép.'],
};

const CREATIVE_TONES = {
  classic_mystery: ['Classic mystery', 'Bí ẩn cổ điển'],
  tense: ['Tense', 'Căng thẳng'],
  melancholic: ['Melancholic', 'U buồn'],
  light_humor: ['Light humor', 'Hài nhẹ'],
};
const CREATIVE_MECHANICS = {
  timeline: ['Timeline reconstruction', 'Đối chiếu dòng thời gian'],
  physical_trace: ['Physical trace', 'Dấu vết vật lý'],
  object_switch: ['Object switch', 'Hoán đổi vật thể'],
  access_opportunity: ['Access and opportunity', 'Quyền tiếp cận và cơ hội'],
  observability: ['Sight and sound observability', 'Khả năng quan sát'],
  custody: ['Document custody', 'Chuỗi bàn giao tài liệu'],
};

function caseTypeLabel(caseType) {
  const labels = CASE_TYPES[caseType];
  return labels ? tr(labels[0], labels[1]) : (caseType || tr('Legacy / unknown', 'Case cũ / chưa xác định'));
}

// The case-type pills and the summary card use a shorter name for "random"; the <select> keeps the full labels.
const CASE_TYPE_SHORT = { RANDOM: ['Random', 'Ngẫu nhiên'] };

function caseTypeShortLabel(caseType) {
  const labels = CASE_TYPE_SHORT[caseType];
  return labels ? tr(labels[0], labels[1]) : caseTypeLabel(caseType);
}

/** The first sentence of a preset description: the preset cards show it, the summary card shows all of it. */
function firstSentence(text) {
  return String(text).match(/^.*?\.(?=\s|$)/)?.[0] ?? text;
}

/** The manual gates every AI draft passes after creation, in order (the "review steps" card). */
const REVIEW_STEPS = [
  ['Approve the premise', 'Duyệt tiền đề'],
  ['Approve the case truth', 'Duyệt sự thật vụ án'],
  ['Approve the full logic', 'Duyệt logic đầy đủ'],
  ['Approve the layout', 'Duyệt bố cục'],
  ['Publish', 'Xuất bản'],
];
/** Fast mode (ADMIN only): the bot passes the premise, logic and layout gates itself; a person still checks two things. */
const FAST_REVIEW_STEPS = [
  ['Approve the case truth', 'Duyệt sự thật vụ án'],
  ['Play the test run, then publish', 'Chơi thử bản cuối rồi xuất bản'],
];

const GATE_PASS_ICON = icon('check', 16);
const GATE_FAIL_ICON = icon('x', 16);

function legacyCrackBudget(presetKey) {
  switch (presetKey) {
    case 'SHORT_DEMO':
      return '1 Crack · 1 camera-containing Crack';
    case 'FULL_FEATURE':
      return '5–6 Cracks · camera quota: 2 when using 5, 2–3 when using 6';
    default:
      return '3–4 Cracks · camera quota: 1 when using 3, 2 when using 4';
  }
}
const DEFAULT_CRACK_BUDGETS = {
  SHORT_DEMO: { minCracks: 1, maxCracks: 1, minTestimonies: 2, maxTestimonies: 4, minEvidence: 3, maxEvidence: 6, targetTestimonies: 2, targetEvidence: 3, maxPairsPerCrack: 12, maxPairsPerCase: 12 },
  NORMAL_RANDOM: { minCracks: 1, maxCracks: 2, minTestimonies: 2, maxTestimonies: 4, minEvidence: 3, maxEvidence: 6, targetTestimonies: 3, targetEvidence: 3, maxPairsPerCrack: 18, maxPairsPerCase: 30 },
  PUZZLE_HEAVY: { minCracks: 1, maxCracks: 2, minTestimonies: 2, maxTestimonies: 4, minEvidence: 3, maxEvidence: 6, targetTestimonies: 2, targetEvidence: 4, maxPairsPerCrack: 18, maxPairsPerCase: 30 },
  DIALOGUE_HEAVY: { minCracks: 1, maxCracks: 2, minTestimonies: 2, maxTestimonies: 4, minEvidence: 3, maxEvidence: 6, targetTestimonies: 4, targetEvidence: 3, maxPairsPerCrack: 18, maxPairsPerCase: 30 },
  FULL_FEATURE: { minCracks: 2, maxCracks: 3, minTestimonies: 2, maxTestimonies: 4, minEvidence: 3, maxEvidence: 6, targetTestimonies: 3, targetEvidence: 5, maxPairsPerCrack: 24, maxPairsPerCase: 60 },
};

function crackBudget(presetKey, budgets = {}) {
  const budget = budgets?.[presetKey] || DEFAULT_CRACK_BUDGETS[presetKey];
  if (!budget) return tr('Crack budget is unavailable for this preset.', 'Không có ngân sách Crack cho cấu hình này.');
  const crackCount = budget.minCracks === budget.maxCracks
    ? `${budget.minCracks} Crack`
    : `${budget.minCracks}–${budget.maxCracks} Cracks`;
  return `${crackCount} · ${tr('target', 'mục tiêu')} ${budget.targetTestimonies}T × ${budget.targetEvidence}E · ` +
    `${budget.minTestimonies}–${budget.maxTestimonies}T / ${budget.minEvidence}–${budget.maxEvidence}E · ` +
    `${tr('max', 'tối đa')} ${budget.maxPairsPerCrack} ${tr('pairs/Crack', 'cặp/Crack')}, ${budget.maxPairsPerCase}/${tr('case', 'vụ')}`;
}

const REASON_LABELS = {
  DIRECT_NEGATION: ['Direct negation', 'Phủ định trực tiếp'],
  RELATED_ONLY: ['Related only', 'Chỉ liên quan'],
  ACTOR_NOT_IDENTIFIED: ['Actor not identified', 'Chưa xác định người thực hiện'],
  SCOPE_MISMATCH: ['Scope mismatch', 'Không khớp phạm vi'],
  INFERENCE_REQUIRED: ['Inference required', 'Cần suy đoán thêm'],
  AMBIGUOUS: ['Ambiguous', 'Mơ hồ'],
};

function reasonLabel(code) {
  const labels = REASON_LABELS[code];
  return labels ? tr(labels[0], labels[1]) : (code || 'UNCLASSIFIED');
}

const STATUS_LABELS = {
  CANCELLED: ['Cancelled', 'Đã hủy'],
  GENERATING_STORY: ['Generating story', 'Đang tạo tiền đề'],
  STORY_AWAITING_APPROVAL: ['Story awaiting approval', 'Chờ duyệt tiền đề'],
  GENERATING_CASE_TRUTH: ['Generating case truth', 'Đang tạo sự thật vụ án'],
  CASE_TRUTH_AWAITING_APPROVAL: ['Truth awaiting approval', 'Chờ duyệt sự thật'],
  CASE_TRUTH_INVALID: ['Case truth invalid', 'Sự thật vụ án không hợp lệ'],
  GENERATING_FULL_CASE: ['Projecting gameplay', 'Đang dựng gameplay'],
  OPENAI_GENERATED_VALID: ['Projection validated', 'Gameplay đã hợp lệ'],
  FULL_LOGIC_AWAITING_APPROVAL: ['Logic awaiting approval', 'Chờ duyệt logic'],
  GENERATING_SCENE_LAYOUT: ['Generating scene layout', 'Đang tạo bố cục cảnh'],
  SCENE_LAYOUT_AWAITING_APPROVAL: ['Layout awaiting approval', 'Chờ duyệt bố cục'],
  GENERATING_FINAL_ASSETS: ['Generating final assets', 'Đang tạo tài nguyên cuối'],
  READY_TO_PUBLISH: ['Ready to publish', 'Sẵn sàng xuất bản'],
  IMPORTED: ['Imported, not published', 'Đã import, chưa đăng'],
  GENERATED_INVALID: ['Generation invalid', 'Kết quả sinh không hợp lệ'],
  PUBLISHED: ['Published', 'Đã xuất bản'],
};

function localizedPair(value) {
  return Array.isArray(value) ? tr(value[0], value[1]) : value;
}

function statusLabel(status) {
  return localizedPair(STATUS_LABELS[status]) || status || tr('Unknown', 'Không xác định');
}

/** Order states of the Claude bot workflow (docs/AI_CASE_SETUP_VI.md). */
const ORDER_STATUS_LABELS = {
  AWAITING_OWNER_APPROVAL: ['Waiting for admin approval', 'Chờ Yen duyệt'],
  QUEUED_FOR_CLAUDE: ['Waiting for Claude', 'Chờ Claude'],
  CLAUDE_WORKING: ['Claude is working', 'Claude đang làm'],
  AWAITING_GATE: ['Waiting for review', 'Chờ duyệt cổng'],
  SUBMITTED: ['Submitted', 'Đã nộp'],
  REJECTED: ['Rejected', 'Đã từ chối'],
  CANCELLED: ['Cancelled', 'Đã hủy'],
};

function orderStatusLabel(status) {
  return localizedPair(ORDER_STATUS_LABELS[status]) || status || '';
}

function orderedByLabel(role) {
  return role === 'ADMIN' ? 'ADMIN' : role === 'VIP' ? 'VIP' : (role || tr('Unknown', 'Không rõ'));
}

const CREATION_ERROR_LABELS = {
  BRIDGE_NOT_CONFIGURED: ['The Claude bridge key is not set on the server yet, so no bot can take orders. The administrator runs scripts/set-bridge-key.sh.', 'Máy chủ chưa có khóa bridge của Claude nên chưa bot nào nhận được đơn. Quản trị viên chạy scripts/set-bridge-key.sh.'],
  ASSET_STORAGE_UNAVAILABLE: ['Cloudinary is not configured, so the bot cannot upload case images yet.', 'Chưa cấu hình Cloudinary nên bot chưa tải được hình của vụ.'],
  AI_WEEKLY_LIMIT: ['You have used this week\'s AI case orders. A new week starts on Monday (Vietnam time).', 'Bạn đã dùng hết số đơn tạo vụ của tuần này. Tuần mới bắt đầu từ thứ Hai (giờ Việt Nam).'],
  AI_ORDER_INVALID: ['Some order options are not valid. Check them and try again.', 'Một số lựa chọn của đơn chưa hợp lệ. Hãy kiểm tra lại rồi gửi lại.'],
  AI_ORDER_AWAITING_APPROVAL: ['This order is waiting for an admin to approve it.', 'Đơn này đang chờ quản trị viên duyệt.'],
  AI_ORDER_REJECTED: ['This order was rejected.', 'Đơn này đã bị từ chối.'],
  AI_ORDER_NOT_AWAITING_APPROVAL: ['Only an order waiting for approval can be approved or rejected.', 'Chỉ duyệt hoặc từ chối được đơn đang chờ duyệt.'],
  AI_ORDER_REASON_REQUIRED: ['Write a reason for the rejection.', 'Hãy ghi lý do từ chối.'],
  AI_CREATIVE_CONSTRAINT_WORLD_MISMATCH: ['The setting lock belongs to the Victorian world.', 'Khóa bối cảnh chỉ dùng cho thế giới kiểu Victoria.'],
  AI_SETTINGS_INVALID: ['The weekly limit must be a whole number from 0 to 50.', 'Giới hạn mỗi tuần phải là số nguyên từ 0 đến 50.'],
  AI_BRIDGE_RUN_REQUIRED: ['Claude answers this step inside a queued run. Use Continue or retry.', 'Claude chỉ trả lời bước này trong lượt chạy của hàng chờ. Hãy bấm Tiếp tục hoặc thử lại.'],
  AI_TRUTH_REPAIR_PENDING: ['Review and accept or reject the pending truth repair before continuing with gameplay or assets.', 'Hãy kiểm tra và chấp nhận hoặc từ chối bản sửa truth đang chờ trước khi tiếp tục gameplay hoặc tài nguyên.'],
  AI_WORKFLOW_CONFLICT: ['This draft is running or has changed. Refresh its details before trying again.', 'Bản nháp đang chạy hoặc đã thay đổi. Hãy tải lại chi tiết trước khi thử lại.'],
  AI_TRUTH_REPAIR_CANDIDATE_UNAVAILABLE: ['This repair candidate is no longer available. Refresh the draft before continuing.', 'Bản sửa này không còn khả dụng. Hãy tải lại bản nháp trước khi tiếp tục.'],
  AI_TRUTH_REPAIR_CANDIDATE_STALE: ['The current truth changed after this candidate was created. Create a new repair from the current truth.', 'Sự thật hiện tại đã thay đổi sau khi tạo bản sửa này. Hãy tạo bản sửa mới từ sự thật hiện tại.'],
  AI_TRUTH_REPAIR_CANDIDATE_UPSTREAM_INVALID: ['Earlier candidate artifacts still need repair. Choose an earlier repair scope.', 'Phần trước của bản sửa vẫn còn lỗi. Hãy chọn phạm vi sửa bắt đầu sớm hơn.'],
  UNSAFE_TRUTH_REPAIR_SCOPE: ['Choose the recommended repair scope or an earlier one so every affected artifact can be repaired.', 'Hãy chọn phạm vi sửa được khuyến nghị hoặc sớm hơn để sửa đủ các phần bị ảnh hưởng.'],
  AI_ACTIVE_DRAFT_LIMIT: ['You have reached your active-draft limit. Complete or cancel a draft in Recent AI drafts before creating another.', 'Bạn đã đạt giới hạn bản nháp đang hoạt động. Hãy hoàn tất hoặc hủy một bản nháp trong Bản nháp AI gần đây trước khi tạo vụ án khác.'],
  AI_DAILY_LIMIT: ["You have reached today's creation limit. Continue an existing draft or try again after the daily limit resets; cancellation does not reset this limit.", 'Bạn đã đạt giới hạn tạo vụ án hôm nay. Hãy tiếp tục bản nháp hiện có hoặc thử lại khi hạn mức ngày được đặt lại; hủy bản nháp không đặt lại hạn mức này.'],
  AI_V3_PRESET_DISABLED: ['Crack the Lie generation is disabled. Uncheck it or ask the administrator to enable it.', 'Tính năng tạo Phá Vỡ Lời Dối đang tắt. Hãy bỏ chọn tính năng này hoặc nhờ quản trị viên bật.'],
};

function aiErrorText(error) {
  const code = error?.code || error?.errors?.code;
  if (CREATION_ERROR_LABELS[code]) return localizedPair(CREATION_ERROR_LABELS[code]);
  if (error?.status === 0) return tr('Cannot reach the server. Check the connection, then try again.', 'Không thể kết nối máy chủ. Hãy kiểm tra kết nối rồi thử lại.');
  if (error?.status === 401) return tr('Your session has expired. Sign in again before continuing.', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trước khi tiếp tục.');
  if (error?.status === 403) return tr('Your account does not have permission for this AI operation.', 'Tài khoản của bạn không có quyền thực hiện thao tác AI này.');
  if (error?.status === 404) return tr('This draft is no longer available. Refresh the draft list.', 'Bản nháp này không còn khả dụng. Hãy tải lại danh sách bản nháp.');
  if (error?.status >= 500) return tr('The server could not complete this AI request. Your entered settings are preserved; try again after the server recovers.', 'Máy chủ chưa thể xử lý yêu cầu AI này. Các thiết lập đã nhập được giữ lại; hãy thử lại khi máy chủ hoạt động ổn định.');
  return error?.message || tr('The AI request could not be completed. Please try again.', 'Không thể hoàn tất yêu cầu AI. Vui lòng thử lại.');
}

const PROGRESS_STATES = {
  CANCELLED: {
    percent: 0,
    title: ['Draft cancelled', 'Đã hủy bản nháp'],
    detail: ['This draft will not continue generating.', 'Bản nháp này sẽ không tiếp tục được tạo.'],
  },
  GENERATING_STORY: {
    percent: 8,
    title: ['Creating the case premise', 'Đang tạo tiền đề vụ án'],
    detail: ['Claude prepares a spoiler-free mystery outline (the order waits until the bot takes it).', 'Claude chuẩn bị dàn ý bí ẩn không tiết lộ đáp án (đơn chờ tới khi bot nhận).'],
  },
  STORY_AWAITING_APPROVAL: {
    percent: 18,
    title: ['Story premise ready', 'Tiền đề đã sẵn sàng'],
    detail: ['Approve the premise to generate the immutable case truth.', 'Duyệt tiền đề để tạo nguồn sự thật bất biến của vụ án.'],
  },
  GENERATING_CASE_TRUTH: {
    percent: 30,
    title: ['Building causal case truth', 'Đang dựng sự thật nhân quả'],
    detail: ['Locking timeline, opportunity, physical traces, statements, and five-category proof.', 'Đang khóa dòng thời gian, cơ hội, dấu vết vật lý, lời khai và năm nhóm chứng minh.'],
  },
  CASE_TRUTH_AWAITING_APPROVAL: {
    percent: 42,
    title: ['Case truth ready', 'Sự thật vụ án đã sẵn sàng'],
    detail: ['Review the spoiler truth and approve it before gameplay projection.', 'Kiểm tra nội dung spoiler rồi duyệt trước khi dựng gameplay.'],
  },
  CASE_TRUTH_INVALID: {
    percent: 42,
    title: ['Case truth blocked', 'Sự thật vụ án bị chặn'],
    detail: ['The truth failed deterministic validation.', 'Sự thật không vượt qua validator tất định.'],
  },
  GENERATING_FULL_CASE: {
    percent: 55,
    title: ['Projecting truth into gameplay', 'Đang chuyển sự thật thành gameplay'],
    detail: ['Building clues, dialogue, puzzles, deductions, and accusation from the locked truth.', 'Đang dựng manh mối, hội thoại, câu đố, suy luận và cáo buộc từ truth đã khóa.'],
  },
  OPENAI_GENERATED_VALID: {
    percent: 64,
    title: ['Gameplay projection validated', 'Gameplay đã được xác thực'],
    detail: ['The truth-backed investigation passed deterministic validation; advisory review was recorded.', 'Vụ án đã vượt qua validator tất định; đánh giá AI được lưu dưới dạng tham khảo.'],
  },
  FULL_LOGIC_AWAITING_APPROVAL: {
    percent: 66,
    title: ['Full logic ready', 'Logic đầy đủ đã sẵn sàng'],
    detail: ['Review the truth-backed gameplay before generating scene layouts.', 'Kiểm tra gameplay bám truth trước khi tạo bố cục cảnh.'],
  },
  GENERATING_SCENE_LAYOUT: {
    percent: 68,
    title: ['Generating scene layouts', 'Đang tạo bố cục cảnh'],
    detail: ['Creating embedded clue backgrounds and detecting clue regions.', 'Đang tạo phông nền có manh mối và xác định vùng tương tác.'],
  },
  SCENE_LAYOUT_AWAITING_APPROVAL: {
    percent: 82,
    title: ['Scene layout ready', 'Bố cục cảnh đã sẵn sàng'],
    detail: ['Review clue zones and scene metadata before publishing.', 'Kiểm tra vùng manh mối và metadata cảnh trước khi xuất bản.'],
  },
  GENERATING_FINAL_ASSETS: {
    percent: 90,
    title: ['Generating final assets', 'Đang tạo tài nguyên cuối'],
    detail: ['Preparing character assets and the final runtime bundle.', 'Đang chuẩn bị tài nguyên nhân vật và gói runtime cuối.'],
  },
  READY_TO_PUBLISH: {
    percent: 96,
    title: ['Ready to publish', 'Sẵn sàng xuất bản'],
    detail: ['Final assets are ready. Publish is a separate manual action.', 'Tài nguyên cuối đã sẵn sàng. Xuất bản vẫn là thao tác thủ công riêng.'],
  },
  GENERATING_ASSETS: {
    percent: 68,
    title: ['Generating scenes and assets', 'Đang tạo cảnh và tài nguyên'],
    detail: ['Creating backgrounds, placement plans, characters, and evidence.', 'Đang tạo phông nền, bố trí, nhân vật và chứng cứ.'],
  },
  ASSETS_GENERATED: {
    percent: 92,
    title: ['Assets ready', 'Tài nguyên đã sẵn sàng'],
    detail: ['Importing and publishing the playable case.', 'Đang nhập và xuất bản vụ án có thể chơi.'],
  },
  IMPORTED: {
    percent: 97,
    title: ['Case imported', 'Vụ án đã được nhập'],
    detail: ['Publishing the case.', 'Đang xuất bản vụ án.'],
  },
  PUBLISHED: {
    percent: 100,
    title: ['Case published', 'Vụ án đã xuất bản'],
    detail: ['The new case is ready to play.', 'Vụ án mới đã sẵn sàng để chơi.'],
  },
  GENERATED_INVALID: {
    percent: 100,
    title: ['Generation failed', 'Sinh vụ án thất bại'],
    detail: ['Fix the account or validation issue, then continue this draft.', 'Khắc phục lỗi tài khoản hoặc validation rồi tiếp tục bản nháp.'],
  },
};

export async function renderAdminAiPage(app) {
  render(app, `<div class="page aai-page">${stateBox('loading', tr('Loading the AI case creator…', 'Đang tải trang tạo vụ án AI…'))}</div>`);

  let drafts = [];
  let capabilities = {
    aiCaseV3PresetEnabled: false,
    gameplayV3Enabled: false,
    canCreateV3Draft: false,
    canPublishV3: false,
  };
  const canManageDrafts = session.isAdmin() || session.isVip();
  let pollTimer = null;
  let progressClock = null;
  let runStartedAt = 0;
  let runVersion = 0;
  let currentProgressStatus = 'GENERATING_STORY';
  let disposed = false;
  let disposePresentation = () => {};
  let capabilitiesError = null;
  let draftListError = null;
  let creationError = null;
  let pollingError = null;
  let visibleDraft = null;
  let creating = false;
  let checkingReadiness = false;
  const isAdmin = session.isAdmin();
  const isVip = !isAdmin && session.isVip();
  const readStored = (key) => { try { return window.localStorage.getItem(key); } catch { return null; } };
  const storedCaseType = readStored('sirlocked.aiCaseType');
  // The order being written. Defaults are what Yen settled on: Hang Duong, the bot picks weather and time, light
  // content, 30 PixelLab generations, all four review gates. Only the case language and type are remembered.
  const form = {
    preset: 'NORMAL_RANDOM',
    stageCount: PRESETS.NORMAL_RANDOM.stageCount,
    difficulty: PRESETS.NORMAL_RANDOM.difficulty,
    playMinutes: 30,
    language: readStored('sirlocked.aiCaseLanguage') === 'vi' ? 'vi' : 'en',
    caseType: CASE_TYPES[storedCaseType] ? storedCaseType : 'RANDOM',
    contentLevel: 'LIGHT',
    world: WORLDS[0].id,
    locationIds: [],
    locationKind: '',
    suspectCount: 4,
    npcIds: [],
    characterNotes: '',
    weather: 'AUTO',
    timeOfDay: 'AUTO',
    tone: '',
    includeCrack: false,
    idea: '',
    mechanic: '',
    pixelLabCap: 30,
    reviewMode: 'FULL',
  };
  /** Messages shown under a field: the server's refusal of the last order, or a limit the creator just ran into. */
  let fieldErrors = {};
  let library = [];
  let libraryError = null;
  let quota = null;
  let quotaError = null;
  let settings = null;
  let settingsError = null;
  let settingsNotice = '';
  let savingSettings = false;
  const pageAbort = new AbortController();

  async function loadCapabilities() {
    try {
      capabilities = await aiCaseApi.capabilities() || {};
      capabilitiesError = null;
    } catch (error) {
      capabilitiesError = error;
    }
  }

  async function loadDraftList(version = runVersion) {
    if (!canManageDrafts) return;
    try {
      const latest = await aiCaseApi.drafts();
      if (disposed || version !== runVersion) return;
      drafts = latest;
      draftListError = null;
    } catch (error) {
      if (disposed || version !== runVersion) return;
      draftListError = error;
    }
  }

  /** Places and NPCs for the order (one read; the form filters by world and kind). A failure leaves the pickers empty. */
  async function loadLibrary() {
    try {
      const entries = await aiCaseApi.library('', '');
      library = Array.isArray(entries) ? entries.filter((entry) => entry && entry.key && !entry.retired) : [];
      libraryError = null;
    } catch (error) {
      libraryError = error;
    }
  }

  /** A VIP's orders left this week. ADMIN orders are unlimited, so ADMIN skips the call. */
  async function loadQuota() {
    if (!isVip) return;
    try {
      quota = await aiCaseApi.quota();
      quotaError = null;
    } catch (error) {
      quotaError = error;
    }
  }

  async function loadSettings() {
    if (!isAdmin) return;
    try {
      settings = await aiCaseApi.settings();
      settingsError = null;
    } catch (error) {
      settingsError = error;
    }
  }

  await Promise.all([loadCapabilities(), loadDraftList(), loadLibrary(), loadQuota(), loadSettings()]);
  draw();

  function creationBlocked() {
    return Boolean(capabilitiesError) || capabilities.canCreateDraft === false
      || (form.includeCrack && Array.isArray(capabilities.v3CreationBlockers) && capabilities.canCreateV3Draft === false);
  }

  /** Why the order cannot be sent yet, beyond server readiness (shown in the summary next to the button). */
  function orderBlockReason() {
    if (isVip && quota && !quota.unlimited && Number(quota.remaining) <= 0) {
      return tr(
        `You have used all ${quota.weeklyLimit} orders of this week. A new week starts on Monday (Vietnam time).`,
        `Bạn đã dùng hết ${quota.weeklyLimit} đơn của tuần này. Tuần mới bắt đầu từ thứ Hai (giờ Việt Nam).`);
    }
    const npcLimit = form.suspectCount + EXTRA_NPCS;
    if (form.npcIds.length > npcLimit) {
      return tr(
        `${form.npcIds.length} NPCs are picked but ${form.suspectCount} suspects allow at most ${npcLimit}. Remove some or add suspects.`,
        `Đang chọn ${form.npcIds.length} NPC, nhưng ${form.suspectCount} nghi phạm chỉ cho tối đa ${npcLimit}. Bỏ bớt NPC hoặc tăng số nghi phạm.`);
    }
    return '';
  }

  function submitDisabled() {
    return creating || creationBlocked() || Boolean(orderBlockReason());
  }

  /** The text areas are the only controls not mirrored into `form` on every change; read them before a redraw. */
  function captureCreationForm() {
    const idea = app.querySelector('#ai-creator-direction');
    if (idea) form.idea = idea.value;
    const notes = app.querySelector('#ai-character-notes');
    if (notes) form.characterNotes = notes.value;
  }

  function renderCreationStatus() {
    const slot = app.querySelector('#ai-creation-status');
    if (!slot) return;
    const blockers = form.includeCrack && Array.isArray(capabilities.v3CreationBlockers)
      ? capabilities.v3CreationBlockers : capabilities.creationBlockers || [];
    const errorMarkup = (error) => `<p>${escapeHtml(aiErrorText(error))}</p>${error?.code || error?.errors?.code ? `<small>${tr('Code', 'Mã lỗi')}: <code>${escapeHtml(error.code || error.errors.code)}</code></small>` : ''}`;
    // Built as a list so an empty slot stays truly empty (and takes no room in the page).
    slot.innerHTML = [
      creationBlocked() ? `<div class="notice notice-bad" role="alert" id="ai-readiness-error">
        <strong>${capabilitiesError ? tr('Could not check AI availability.', 'Chưa kiểm tra được trạng thái AI.') : tr('Case creation is unavailable.', 'Chưa thể tạo vụ án.')}</strong>
        ${capabilitiesError ? errorMarkup(capabilitiesError) : blockers.length ? blockers.map(errorMarkup).join('') : `<p>${tr('The server has disabled case creation. Ask the administrator to review its AI settings.', 'Máy chủ đang tắt chức năng tạo vụ án. Hãy nhờ quản trị viên kiểm tra thiết lập AI.')}</p>`}
      </div>` : '',
      creationError ? `<div class="notice notice-bad" role="alert" id="ai-request-error"><strong>${tr('AI request could not be completed.', 'Chưa thể hoàn tất yêu cầu AI.')}</strong>${errorMarkup(creationError)}</div>` : '',
      draftListError ? `<div class="notice notice-bad" role="alert"><strong>${tr('Could not load recent drafts.', 'Không tải được bản nháp gần đây.')}</strong>${errorMarkup(draftListError)}</div>` : '',
      creationBlocked() || draftListError ? `<button class="btn btn-ghost" type="button" id="ai-check-readiness" ${checkingReadiness ? 'disabled' : ''}>${icon('refresh', 18)}${checkingReadiness ? tr('Checking…', 'Đang kiểm tra…') : tr('Check again', 'Kiểm tra lại')}</button>` : '',
      pollingError ? `<div class="notice notice-bad" role="alert" id="ai-poll-error"><strong>${tr('Draft status could not be loaded.', 'Không tải được trạng thái bản nháp.')}</strong>${errorMarkup(pollingError.error)}<button class="btn btn-ghost btn-sm" type="button" id="ai-retry-status">${icon('refresh', 16)}${tr('Retry status check', 'Thử tải trạng thái lại')}</button></div>` : '',
    ].filter(Boolean).join('');
    slot.querySelector('#ai-check-readiness')?.addEventListener('click', async () => {
      if (checkingReadiness) return;
      checkingReadiness = true;
      renderCreationStatus();
      await Promise.all([loadCapabilities(), loadDraftList(), libraryError ? loadLibrary() : null, loadQuota()]);
      checkingReadiness = false;
      if (!disposed) draw(visibleDraft);
    });
    slot.querySelector('#ai-retry-status')?.addEventListener('click', () => {
      const draftId = pollingError.draftId;
      pollingError = null;
      renderCreationStatus();
      startProgressClock();
      startPolling(draftId, ++runVersion);
    });
  }

  /** "Chơi thử": an imported draft that is not published yet (the server checks ADMIN or the draft's author). */
  function canPlaytest(draft) {
    return draft.status === 'IMPORTED' && Boolean(draft.importedCaseId);
  }

  function playtestButton(draft, style = 'btn-ghost') {
    return canPlaytest(draft)
      ? `<button class="btn ${style} btn-sm" type="button" data-playtest-draft="${escapeHtml(draft.draftId)}"
          title="${escapeHtml(tr('Open a private room for this unpublished draft and invite one player by link', 'Mở phòng riêng cho bản nháp chưa đăng và mời một người bằng liên kết'))}">${tr('Playtest', 'Chơi thử')}</button>`
      : '';
  }

  function cancelButton(draft) {
    return draft.canCancel === true && !['PUBLISHED', 'IMPORTED', 'CANCELLED'].includes(draft.status)
      ? `<button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-cancel-draft="${escapeHtml(draft.draftId)}">${tr('Cancel draft', 'Hủy bản nháp')}</button>` : '';
  }

  /** Pill colour of a draft status: running or cancelled neutral, waiting for a person gold, done green, failed red. */
  function statusTone(d) {
    if (isGeneratingDraft(d) || d.status === 'CANCELLED') return '';
    if (AWAITING_STATUSES.has(d.status)) return 'gold';
    return isSuccessStatus(d.status) ? 'ok' : 'bad';
  }

  function statusPill(d) {
    // A VIP order waiting for an admin has not started: "Generating story" would be untrue.
    if (d.orderStatus === 'AWAITING_OWNER_APPROVAL') return pill(tr('Not started', 'Chưa bắt đầu'), '', { dot: true });
    return pill(statusLabel(d.status), statusTone(d), { dot: true });
  }

  /** Where the order stands with the Claude bot; VIP orders first wait for an admin. */
  function orderStatusPill(d) {
    if (!d.orderStatus) return '';
    const tone = d.orderStatus === 'AWAITING_OWNER_APPROVAL' || d.orderStatus === 'AWAITING_GATE' ? 'gold'
      : d.orderStatus === 'SUBMITTED' ? 'ok' : d.orderStatus === 'REJECTED' ? 'bad' : '';
    return `<span data-order-status="${escapeHtml(d.orderStatus)}">${pill(orderStatusLabel(d.orderStatus), tone, { dot: true })}</span>`;
  }

  /** When the order reached its current status (the latest matching history entry). */
  function orderStatusTime(d) {
    const history = Array.isArray(d.orderStatusHistory) ? d.orderStatusHistory : [];
    const change = [...history].reverse().find((entry) => entry?.status === d.orderStatus) || history[history.length - 1];
    return change?.at ? formatTime(change.at) : '';
  }

  /** "Trạng thái đơn" cell: the status pill and when it began. */
  function orderStatusCell(d) {
    if (!d.orderStatus) return `<span class="aai-cell"><small>${tr('No order (older draft)', 'Không có đơn (bản nháp cũ)')}</small></span>`;
    const time = orderStatusTime(d);
    return `<span class="aai-cell aai-order-cell">${orderStatusPill(d)}${time ? `<small data-order-time>${escapeHtml(time)}</small>` : ''}</span>`;
  }

  function orderButtons(d) {
    if (!isAdmin || d.orderStatus !== 'AWAITING_OWNER_APPROVAL') return '';
    return `<button class="btn btn-primary btn-sm" type="button" data-approve-order="${escapeHtml(d.draftId)}">${tr('Approve order', 'Duyệt đơn')}</button>
      <button class="btn btn-ghost btn-sm adm-btn-danger" type="button" data-reject-order="${escapeHtml(d.draftId)}">${tr('Reject', 'Từ chối')}</button>`;
  }

  function isSuccessStatus(status) {
    return status === STATUS_AWAITING_APPROVAL ||
      status === STATUS_TRUTH_AWAITING_APPROVAL ||
      status === STATUS_FULL_LOGIC_AWAITING_APPROVAL ||
      status === STATUS_SCENE_LAYOUT_AWAITING_APPROVAL ||
      status === STATUS_READY_TO_PUBLISH ||
      status === 'IMPORTED' ||
      status === STATUS_PUBLISHED ||
      status === 'OPENAI_GENERATED_VALID' ||
      status === 'ASSETS_GENERATED';
  }

  function canContinueDraft(d) {
    return Boolean(d.canContinue);
  }

  function isV3Draft(d) {
    return isV3(d);
  }

  function hasPassedRequiredReview(d) {
    return !isV3Draft(d) || d.v3SemanticReview?.status === 'PASSED';
  }

  function truthReviewPassed(d) {
    const review = d.truthReviewerResult;
    return review?.status === 'PASSED'
      && review.timelineFeasible === true
      && review.physicalCausalityFeasible === true
      && review.uniqueSolution === true
      && Number(review.confidence || 0) >= 0.8
      && !(review.findings?.length);
  }

  function canRepairTruth(d) {
    return [STATUS_TRUTH_AWAITING_APPROVAL, STATUS_TRUTH_INVALID, STATUS_FULL_LOGIC_AWAITING_APPROVAL].includes(d.status)
      && !d.publishedCase && !d.importedCaseId && !isGeneratingDraft(d);
  }

  function canContinueTruthRepairCandidate(d) {
    return canRepairTruth(d) && d.truthRepairStatus === 'CANDIDATE_INVALID' && Boolean(d.truthRepairCandidate);
  }

  function continueButton(d, style = 'btn-primary') {
    if (d.status === 'CANCELLED') return '';
    if (isGeneratingDraft(d) || d.truthRepairStatus === 'CANDIDATE_READY') return '';
    if (d.status === STATUS_GENERATED_INVALID && ['BLUEPRINT_JSON', 'FULL_LOGIC_JSON', 'PROJECTION_CONTENT_JSON', 'PROJECTION_COMPILE', 'PROJECTION_CONFORMANCE', 'PRE_ASSET_VALIDATION', 'V3_SEMANTIC_REVIEW', 'BLIND_SOLVABILITY_REVIEW'].includes(d.failurePhase)) {
      const label = d.failurePhase === 'V3_SEMANTIC_REVIEW' ? tr('Regenerate V3 logic', 'Tạo lại logic V3')
        : d.failurePhase === 'BLIND_SOLVABILITY_REVIEW' ? tr('Regenerate projection', 'Tạo lại gameplay')
        : d.failurePhase === 'PROJECTION_CONFORMANCE' && !d.hasGeneratedJson
          ? tr('Repair truth for preset', 'Sửa truth theo cấu hình')
          : tr('Retry JSON repair', 'Thử sửa JSON lại');
      return `<button class="btn ${style} btn-sm" type="button" data-retry-json="${escapeHtml(d.draftId)}">${label}</button>`;
    }
    if (d.status === STATUS_GENERATED_INVALID && d.failurePhase === 'VISUAL_QA') {
      return `<button class="btn ${style} btn-sm" type="button" data-regenerate-failed-assets="${escapeHtml(d.draftId)}">${tr('Regenerate failed scene', 'Tạo lại cảnh lỗi')}</button>`;
    }
    if (d.status === STATUS_AWAITING_APPROVAL) {
      return `<button class="btn ${style} btn-sm" type="button" data-approve-story="${escapeHtml(d.draftId)}">${tr('Approve story preview', 'Duyệt tiền đề')}</button>`;
    }
    if (d.status === STATUS_TRUTH_AWAITING_APPROVAL) {
      return d.canContinue
        ? `<button class="btn ${style} btn-sm" type="button" data-approve-truth="${escapeHtml(d.draftId)}">${tr('Approve case truth', 'Duyệt sự thật vụ án')}</button>`
        : '';
    }
    if (d.status === STATUS_TRUTH_INVALID) {
      return `<button class="btn ${style} btn-sm" type="button" data-repair-truth="${escapeHtml(d.draftId)}">${tr('Repair scoped truth', 'Sửa truth theo phạm vi')}</button>`;
    }
    if (d.status === STATUS_FULL_LOGIC_AWAITING_APPROVAL) {
      return hasPassedRequiredReview(d)
        ? `<button class="btn ${style} btn-sm" type="button" data-approve-full-logic="${escapeHtml(d.draftId)}">${tr('Approve full logic', 'Duyệt logic đầy đủ')}</button>`
        : '';
    }
    if (d.status === STATUS_SCENE_LAYOUT_AWAITING_APPROVAL) {
      return hasPassedRequiredReview(d)
        ? `<button class="btn ${style} btn-sm" type="button" data-approve-scene-layout="${escapeHtml(d.draftId)}">${tr('Approve layout', 'Duyệt bố cục')}</button>`
        : '';
    }
    if (d.status === STATUS_READY_TO_PUBLISH && session.isAdmin()) {
      const gate = v3PublishGate(d, capabilities, true);
      if (!gate.canPublish) {
        return `<button class="btn btn-ghost btn-sm" type="button" disabled title="${escapeHtml(gate.reason)}">${tr('Publish blocked', 'Xuất bản bị chặn')}</button>`;
      }
      return `<button class="btn ${style} btn-sm" type="button" data-publish-draft="${escapeHtml(d.draftId)}">${tr('Publish', 'Xuất bản')}</button>`;
    }
    return canContinueDraft(d)
      ? `<button class="btn ${style} btn-sm" type="button" data-continue="${escapeHtml(d.draftId)}">${tr('Continue', 'Tiếp tục')}</button>`
      : '';
  }

  function draftRow(d) {
    const title = d.caseTitle || d.storyPreview?.title || '(preview)';
    const prompt = d.prompt || 'AI-generated original mystery';
    const preset = presetLabel(d.settings?.generationPreset);
    const language = d.settings?.language === 'vi' ? 'Tiếng Việt' : 'English';
    const effectiveCaseType = d.storyDiversity?.caseType || d.settings?.caseType;
    const presetMeta = [d.order?.world ? worldLabel(d.order.world) : '', effectiveCaseType ? caseTypeLabel(effectiveCaseType) : '', language].filter(Boolean).join(' · ');
    const mine = d.createdByUserId && d.createdByUserId === session.user()?.userId;
    return `
    <tr data-draft-row="${escapeHtml(d.draftId)}">
      <td><span class="aai-cell"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(prompt.slice(0, 70))}</small></span></td>
      <td><span class="aai-cell"><strong>${escapeHtml(orderedByLabel(d.createdByRole))}</strong>${mine ? `<small>${tr('you', 'bạn')}</small>` : ''}</span></td>
      <td>${orderStatusCell(d)}</td>
      <td><span class="aai-cell"><strong>${escapeHtml(preset)}</strong><small>${escapeHtml(presetMeta)}</small></span>${isV3Draft(d) ? `<span class="chip aai-review-chip ${d.v3SemanticReview?.status === 'PASSED' ? 'chip-ok' : 'chip-bad'}">Review ${escapeHtml(d.v3SemanticReview?.status || 'NOT_RUN')}</span>` : ''}</td>
      <td>${statusPill(d)}</td>
      <td>
        <div class="adm-table-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-view="${escapeHtml(d.draftId)}">${tr('View', 'Xem')}</button>
          ${orderButtons(d)}
          ${continueButton(d, 'btn-ghost')}
          ${cancelButton(d)}
          ${playtestButton(d)}
          ${d.status === STATUS_PUBLISHED || (d.importedCaseId && !canPlaytest(d))
            ? `<a class="btn btn-ghost btn-sm" href="/cases/${encodeURIComponent(d.importedCaseId ?? d.caseId)}">${tr('Open case', 'Mở vụ án')}</a>`
            : ''}
        </div>
      </td>
    </tr>`;
  }

  /** "Bản nháp AI gần đây": the drafts in a table, or why there is none. */
  function draftsCard() {
    const table = (rows) => `
      <div class="adm-table-wrap${rows ? '' : ' aai-table-wrap--empty'}">
        <table class="adm-table admin-table aai-drafts-table">
          <thead><tr><th>${tr('Draft', 'Bản nháp')}</th><th>${tr('Ordered by', 'Người đặt')}</th><th>${tr('Order status', 'Trạng thái đơn')}</th><th>${tr('Preset', 'Cấu hình')}</th><th>${tr('Draft status', 'Trạng thái bản nháp')}</th><th class="aai-th-actions">${tr('Actions', 'Thao tác')}</th></tr></thead>
          ${rows ? `<tbody>${rows}</tbody>` : ''}
        </table>
      </div>`;
    // The error itself, with "Check again", is in the status area at the top of the page.
    const body = draftListError && drafts.length === 0
      ? stateBox('error', tr('The draft list is unavailable.', 'Chưa tải được danh sách bản nháp.'), tr('The reason and a “Check again” button are at the top of the page.', 'Lý do và nút “Kiểm tra lại” ở đầu trang.'))
      : drafts.length === 0
        ? `${table('')}${stateBox('empty', tr('No drafts yet.', 'Chưa có bản nháp.'), tr('New drafts appear here so you can review them step by step.', 'Bản nháp vừa tạo sẽ hiện ở đây để bạn duyệt từng bước.'))}`
        : table(drafts.map(draftRow).join(''));
    return `
      <section class="adm-card adm-card--flush aai-drafts" aria-labelledby="aai-drafts-title">
        <div class="adm-card-head"><h2 class="adm-card-title" id="aai-drafts-title">${tr('Recent AI drafts', 'Bản nháp AI gần đây')}</h2></div>
        ${body}
      </section>`;
  }

  // ---------------------------------------------------------------- order form helpers

  function numberText(value) {
    return new Intl.NumberFormat(tr('en-US', 'vi-VN')).format(value);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(tr('en-GB', 'vi-VN'), { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function pairLabel(table, key, fallback = '') {
    return table[key] ? tr(table[key][0], table[key][1]) : fallback;
  }

  function worldLabel(id) {
    const world = WORLDS.find((item) => item.id === id);
    return world ? tr(world.name[0], world.name[1]) : (id || '');
  }

  /** Only pictures the server could have stored: Cloudinary (https) or the game's own /assets folder. */
  function safeImageUrl(url) {
    const value = String(url || '');
    return /^https:\/\//i.test(value) || /^\/assets\//.test(value) ? value : '';
  }

  // Function declarations, not arrows: the first draw() runs before this part of the closure is reached.
  function entryName(entry) {
    return tr(entry.nameEn || entry.nameVi || entry.key, entry.nameVi || entry.nameEn || entry.key);
  }
  function entryThumb(entry) {
    return entry.thumbUrl || entry.files?.thumb || entry.url || '';
  }
  function npcPortrait(entry) {
    return entry.files?.portrait || entry.thumbUrl || entry.url || '';
  }
  /** Entries of the world, plus those that belong to every world. */
  function inWorld(entry, world = form.world) {
    return entry.world === world || entry.world === 'ALL';
  }
  function locationEntries() {
    return library.filter((entry) => (entry.kind === 'OUTDOOR_MAP' || entry.kind === 'INTERIOR') && inWorld(entry));
  }
  function npcEntries() {
    return library.filter((entry) => entry.kind === 'NPC' && inWorld(entry));
  }

  function worldThumb(worldId) {
    const entry = library.find((item) => item.world === worldId && item.kind === 'OUTDOOR_MAP' && safeImageUrl(entryThumb(item)));
    return entry ? safeImageUrl(entryThumb(entry)) : '';
  }

  function namesOf(keys) {
    return keys.map((key) => {
      const entry = library.find((item) => item.key === key);
      return entry ? entryName(entry) : key;
    }).join(', ');
  }

  function presetLimitText(presetKey) {
    if (presetKey === 'NORMAL_RANDOM') return tr('Choose 2–6 stages and any difficulty.', 'Tự chọn 2–6 chặng và độ khó.');
    const limits = PRESET_LIMITS[presetKey] || PRESET_LIMITS.NORMAL_RANDOM;
    const stages = limits.stages[0] === limits.stages[1] ? `${limits.stages[0]}` : `${limits.stages[0]}–${limits.stages[1]}`;
    const difficulties = limits.difficulties.map((value) => pairLabel(DIFFICULTIES, value)).join(tr(' or ', ' hoặc '));
    return tr(`This preset needs ${stages} stages and ${difficulties} difficulty.`, `Cấu hình này cần ${stages} chặng, độ khó ${difficulties}.`);
  }

  function charactersSummary() {
    const suspects = tr(`${form.suspectCount} suspects`, `${form.suspectCount} nghi phạm`);
    return form.npcIds.length ? `${suspects} · ${namesOf(form.npcIds)}` : `${suspects} · ${tr('bot casts NPCs', 'bot chọn NPC')}`;
  }

  function reviewStepsHtml() {
    const steps = isAdmin && form.reviewMode === 'FAST' ? FAST_REVIEW_STEPS : REVIEW_STEPS;
    return steps.map(([en, vi], index) => `<li data-review-step><span class="aai-flow-num${index === steps.length - 1 ? ' aai-flow-num--ok' : ''}" aria-hidden="true">${index + 1}</span>${escapeHtml(tr(en, vi))}</li>`).join('');
  }

  function vipQuotaText() {
    if (quotaError) return tr('Could not read how many orders you have left this week.', 'Chưa đọc được số đơn còn lại trong tuần.');
    if (!quota || quota.unlimited) return '';
    return tr(`Orders left this week: ${quota.remaining}/${quota.weeklyLimit}.`, `Còn ${quota.remaining}/${quota.weeklyLimit} đơn trong tuần này.`);
  }

  function fieldErrorHtml(field) {
    return `<p class="aai-field-error" data-field-error="${field}" role="alert"${fieldErrors[field] ? '' : ' hidden'}>${escapeHtml(fieldErrors[field] || '')}</p>`;
  }

  function worldButton(world) {
    const thumb = world.id === NEW_WORLD ? '' : worldThumb(world.id);
    const name = tr(world.name[0], world.name[1]);
    const sub = tr(world.sub[0], world.sub[1]);
    return `<button type="button" class="aai-world" data-world="${world.id}" aria-pressed="${form.world === world.id}" aria-label="${escapeHtml(`${name}. ${sub}`)}">
      <span class="aai-world-art${thumb ? '' : ' aai-world-art--blank'}" aria-hidden="true">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">` : icon(world.id === NEW_WORLD ? 'compass' : 'grid', 30)}</span>
      <span class="aai-world-text" aria-hidden="true"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(sub)}</small></span>
      <span class="aai-pick-check" aria-hidden="true">${icon('check', 14)}</span>
    </button>`;
  }

  function pickButton(entry, kind, selected, image, sub = '') {
    const name = entryName(entry);
    const src = safeImageUrl(image);
    return `<button type="button" class="aai-pick aai-pick--${kind}" data-${kind}="${escapeHtml(entry.key)}" aria-pressed="${selected}" aria-label="${escapeHtml(sub ? `${name} (${sub})` : name)}">
      <span class="aai-pick-art" aria-hidden="true">${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async">` : icon(kind === 'npc' ? 'user' : 'grid', 22)}</span>
      <span class="aai-pick-name" aria-hidden="true">${escapeHtml(name)}</span>
      <span class="aai-pick-check" aria-hidden="true">${icon('check', 14)}</span>
    </button>`;
  }

  function libraryErrorHtml(what) {
    return `<div class="aai-pick-empty aai-pick-empty--error" role="alert"><span>${what}</span><button class="btn btn-ghost btn-sm" type="button" data-reload-library>${icon('refresh', 16)}${tr('Try again', 'Thử lại')}</button></div>`;
  }

  function locationGridHtml() {
    if (libraryError) {
      return libraryErrorHtml(tr('The picture library could not be loaded. You can still send the order; the bot then picks the places.', 'Không tải được thư viện hình. Vẫn gửi đơn được; khi đó bot tự chọn địa điểm.'));
    }
    const entries = locationEntries().filter((entry) => !form.locationKind || entry.kind === form.locationKind);
    if (!entries.length) {
      return `<p class="aai-pick-empty">${form.world === NEW_WORLD
        ? tr('A new world has no places in the library yet. Describe where the case happens in the Idea card.', 'Thế giới mới chưa có địa điểm trong thư viện. Hãy tả nơi xảy ra vụ án ở thẻ Ý tưởng.')
        : tr('The library has no places of this kind in this world yet.', 'Thư viện chưa có địa điểm loại này ở thế giới này.')}</p>`;
    }
    return entries.map((entry) => pickButton(entry, 'location', form.locationIds.includes(entry.key), entryThumb(entry), pairLabel(LOCATION_KINDS, entry.kind))).join('');
  }

  function npcGridHtml() {
    if (libraryError) {
      return libraryErrorHtml(tr('The picture library could not be loaded. You can still send the order; the bot then casts the characters.', 'Không tải được thư viện hình. Vẫn gửi đơn được; khi đó bot tự chọn nhân vật.'));
    }
    const entries = npcEntries();
    if (!entries.length) {
      return `<p class="aai-pick-empty">${form.world === NEW_WORLD
        ? tr('A new world has no characters in the library yet. Describe them below.', 'Thế giới mới chưa có nhân vật trong thư viện. Hãy tả nhân vật ở ô bên dưới.')
        : tr('The library has no characters for this world yet; the bot draws them.', 'Thư viện chưa có nhân vật của thế giới này; bot sẽ vẽ mới.')}</p>`;
    }
    return entries.map((entry) => pickButton(entry, 'npc', form.npcIds.includes(entry.key), npcPortrait(entry))).join('');
  }

  function settingsStatusHtml() {
    if (settingsNotice) return escapeHtml(settingsNotice);
    if (settingsError) return escapeHtml(aiErrorText(settingsError));
    return '';
  }

  /** ADMIN only: how many orders each VIP may send per week (GET/PUT /api/admin/ai-cases/settings). */
  function settingsCardHtml() {
    const value = settings?.vipWeeklyOrderLimit ?? '';
    return `
      <section class="adm-card aai-settings" aria-labelledby="aai-settings-title">
        <h2 class="aai-flow-title" id="aai-settings-title">${tr('VIP orders', 'Đơn của VIP')}</h2>
        <form class="aai-settings-form" id="ai-settings-form" novalidate>
          <label class="aai-label" for="ai-vip-weekly-limit">${tr('Orders per VIP each week', 'Số đơn mỗi VIP được gửi mỗi tuần')}</label>
          <div class="aai-settings-row">
            <input class="field-input" id="ai-vip-weekly-limit" name="vipWeeklyOrderLimit" type="number" inputmode="numeric" min="0" max="50" step="1" value="${escapeHtml(value)}" aria-describedby="ai-settings-help ai-settings-status" ${settings ? '' : 'disabled'}>
            <button class="btn btn-primary btn-sm" type="submit" id="ai-save-settings" ${settings && !savingSettings ? '' : 'disabled'}>${savingSettings ? tr('Saving…', 'Đang lưu…') : tr('Save', 'Lưu')}</button>
          </div>
          <p class="aai-help" id="ai-settings-help">${tr('0 pauses VIP orders. A week runs Monday to Sunday, Vietnam time; rejected orders do not count.', '0 là tạm dừng nhận đơn VIP. Tuần tính từ thứ Hai đến Chủ nhật (giờ Việt Nam); đơn bị từ chối không tính.')}</p>
          <p class="aai-settings-status${settingsError && !settingsNotice ? ' is-error' : ''}" id="ai-settings-status" role="status">${settingsStatusHtml()}</p>
        </form>
      </section>`;
  }

  /**
   * The order form: numbered cards on the left (world first, as in plan section 6), the navy summary with
   * "Send order to Claude" and the review steps on the right; below 900 px the summary drops under the cards.
   */
  function creationLayout() {
    const presetKey = PRESETS[form.preset] ? form.preset : 'NORMAL_RANDOM';
    const limits = PRESET_LIMITS[presetKey];
    const v3Enabled = Boolean(capabilities.aiCaseV3PresetEnabled);
    let stepNumber = 0;
    const stepHead = (id, title) => `
      <div class="aai-step-head">
        <span class="aai-step-num" aria-hidden="true">${String(++stepNumber).padStart(2, '0')}</span>
        <h2 class="adm-card-title" id="${id}">${escapeHtml(title)}</h2>
      </div>`;
    // The <select>s of preset, language and case type stay the source of truth (tests and the redraw read them); the
    // cards, segments and pills are the visible radio controls kept in sync with them.
    const hiddenSelect = (id, options) => `<select id="${id}" class="aai-sr" tabindex="-1" aria-hidden="true">${options}</select>`;
    const radioSeg = (name, labelledBy, options, current, { compact = false, disabled = () => false, describedBy = '', navy = false } = {}) => `
      <div class="aai-seg${compact ? ' aai-seg--compact' : ''}${navy ? ' aai-seg--navy' : ''}" role="radiogroup" aria-labelledby="${labelledBy}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
        ${options.map(([value, label]) => `<label><input type="radio" class="aai-sr" name="${name}" value="${escapeHtml(value)}" ${String(current) === String(value) ? 'checked' : ''} ${disabled(value) ? 'disabled' : ''}><span>${escapeHtml(label)}</span></label>`).join('')}
      </div>`;
    const radioChips = (name, labelledBy, table, current, describedBy = '') => `
      <div class="aai-chips" role="radiogroup" aria-labelledby="${labelledBy}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
        ${Object.entries(table).map(([value, labels]) => `<label class="aai-chip"><input type="radio" class="aai-sr" name="${name}" value="${value}" ${current === value ? 'checked' : ''}><span>${escapeHtml(tr(labels[0], labels[1]))}</span></label>`).join('')}
      </div>`;
    const lockField = (id, label, table, current) => `
      <div class="aai-field">
        <label class="aai-label" for="${id}">${label}</label>
        <select class="field-input" id="${id}"><option value="">${tr('Automatic', 'Tự động')}</option>${Object.entries(table).map(([value, labels]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${escapeHtml(tr(labels[0], labels[1]))}</option>`).join('')}</select>
      </div>`;
    const summaryRow = (key, label) => `<dt>${label}</dt><dd data-aai-sum="${key}"></dd>`;

    const worldCard = `
      <section class="adm-card aai-step" aria-labelledby="aai-world-title">
        ${stepHead('aai-world-title', tr('World and locations', 'Thế giới và địa điểm'))}
        <div class="aai-field" data-field="world">
          <div class="aai-worlds" role="group" aria-label="${tr('World', 'Thế giới')}">
            ${WORLDS.map(worldButton).join('')}
          </div>
          ${fieldErrorHtml('world')}
          <p class="aai-hint" id="ai-new-world-note"${form.world === NEW_WORLD ? '' : ' hidden'}>${icon('compass', 16)}<span>${tr('A new world has no pictures yet: the bot reports how many PixelLab generations it needs before it starts drawing.', 'Thế giới mới chưa có ảnh: bot sẽ báo số lượt cần vẽ trước khi làm.')}</span></p>
        </div>
        <div class="aai-field" data-field="locationIds">
          <div class="aai-field-row">
            <h3 class="aai-field-title" id="aai-locations-title">${tr('Locations', 'Địa điểm')} <span class="aai-count" id="ai-location-count"></span></h3>
            <div class="aai-filter" role="group" aria-label="${tr('Show locations', 'Hiện địa điểm')}">
              ${[['', tr('All', 'Tất cả')], ...Object.entries(LOCATION_KINDS).map(([value, labels]) => [value, tr(labels[0], labels[1])])]
                .map(([value, label]) => `<button type="button" class="aai-filter-btn" data-location-kind="${value}" aria-pressed="${form.locationKind === value}">${escapeHtml(label)}</button>`).join('')}
            </div>
          </div>
          <div class="aai-pick-grid" id="ai-location-grid" role="group" aria-labelledby="aai-locations-title" aria-describedby="ai-location-help">${locationGridHtml()}</div>
          <p class="aai-help" id="ai-location-help">${tr(`Pick several places (up to ${MAX_LOCATIONS}). Leave it empty and the bot picks from this world's library. Replaces the old setting lock.`, `Chọn nhiều nơi (tối đa ${MAX_LOCATIONS}). Để trống thì bot tự chọn trong thư viện của thế giới này. Thay cho ô Khóa bối cảnh cũ.`)}</p>
          ${fieldErrorHtml('locationIds')}
        </div>
      </section>`;

    const presetCard = `
      <section class="adm-card aai-step" aria-labelledby="aai-preset-title">
        ${stepHead('aai-preset-title', tr('Generation preset', 'Cấu hình tạo'))}
        ${hiddenSelect('ai-preset-select', Object.keys(PRESETS).map((value) => `<option value="${value}" ${presetKey === value ? 'selected' : ''}>${escapeHtml(presetLabel(value))}</option>`).join(''))}
        <div class="aai-presets" role="radiogroup" aria-labelledby="aai-preset-title">
          ${Object.keys(PRESETS).map((value) => `
            <label class="aai-preset">
              <span class="aai-preset-top">
                <strong id="aai-preset-${value}">${escapeHtml(presetLabel(value))}</strong>
                <input type="radio" name="aai-preset" value="${value}" ${presetKey === value ? 'checked' : ''} aria-labelledby="aai-preset-${value}" aria-describedby="aai-preset-${value}-desc">
              </span>
              <span class="aai-preset-desc" id="aai-preset-${value}-desc">${escapeHtml(firstSentence(presetDescription(value)))}</span>
            </label>`).join('')}
        </div>
        <div class="aai-config-grid">
          <div class="aai-field" data-field="stageCount">
            <h3 class="aai-field-title" id="aai-stages-title">${tr('Stages', 'Số chặng')}</h3>
            ${radioSeg('aai-stages', 'aai-stages-title', STAGE_OPTIONS.map((count) => [count, String(count)]), form.stageCount, {
    compact: true, describedBy: 'ai-preset-limits', disabled: (count) => count < limits.stages[0] || count > limits.stages[1],
  })}
            ${fieldErrorHtml('stageCount')}
          </div>
          <div class="aai-field" data-field="difficulty">
            <h3 class="aai-field-title" id="aai-difficulty-title">${tr('Difficulty', 'Độ khó')}</h3>
            ${radioSeg('aai-difficulty', 'aai-difficulty-title', Object.entries(DIFFICULTIES).map(([value, labels]) => [value, tr(labels[0], labels[1])]), form.difficulty, {
    compact: true, describedBy: 'ai-preset-limits', disabled: (value) => !limits.difficulties.includes(value),
  })}
            ${fieldErrorHtml('difficulty')}
          </div>
          <div class="aai-field" data-field="playMinutes">
            <h3 class="aai-field-title" id="aai-minutes-title">${tr('Play time', 'Thời lượng chơi')}</h3>
            ${radioSeg('aai-minutes', 'aai-minutes-title', PLAY_MINUTES.map((minutes) => [minutes, tr(`${minutes} min`, `${minutes} phút`)]), form.playMinutes, { compact: true })}
            ${fieldErrorHtml('playMinutes')}
          </div>
        </div>
        <p class="aai-help" id="ai-preset-limits">${escapeHtml(presetLimitText(presetKey))}</p>
      </section>`;

    const languageCard = `
      <section class="adm-card aai-step aai-step--language" aria-labelledby="aai-language-title">
        ${stepHead('aai-language-title', tr('Language and case type', 'Ngôn ngữ và loại vụ án'))}
        <div class="aai-field">
          <h3 class="aai-field-title" id="aai-language-field-title">${tr('Case language', 'Ngôn ngữ nội dung vụ án')}</h3>
          ${hiddenSelect('ai-language-select', `<option value="en" ${form.language === 'en' ? 'selected' : ''}>English</option><option value="vi" ${form.language === 'vi' ? 'selected' : ''}>Tiếng Việt</option>`)}
          <div class="aai-seg" role="radiogroup" aria-labelledby="aai-language-field-title" aria-describedby="aai-language-help">
            ${[['en', 'English'], ['vi', 'Tiếng Việt']].map(([value, label]) => `<label><input type="radio" class="aai-sr" name="aai-language" value="${value}" ${form.language === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}
          </div>
          <p class="aai-help" id="aai-language-help">${tr('Applies to the title, story, clues, dialogue, and ending.', 'Áp dụng cho tiêu đề, cốt truyện, manh mối, hội thoại và kết thúc.')}</p>
        </div>
        <div class="aai-field">
          <h3 class="aai-field-title" id="aai-case-type-title">${tr('Case type', 'Loại vụ án')}</h3>
          ${hiddenSelect('ai-case-type-select', Object.keys(CASE_TYPES).map((value) => `<option value="${value}" ${form.caseType === value ? 'selected' : ''}>${escapeHtml(caseTypeLabel(value))}</option>`).join(''))}
          <div class="aai-chips" role="radiogroup" aria-labelledby="aai-case-type-title" aria-describedby="aai-case-type-help">
            ${Object.keys(CASE_TYPES).map((value) => `<label class="aai-chip"><input type="radio" class="aai-sr" name="aai-case-type" value="${value}" ${form.caseType === value ? 'checked' : ''}><span>${escapeHtml(caseTypeShortLabel(value))}</span></label>`).join('')}
          </div>
          <p class="aai-help" id="aai-case-type-help">${tr('Separate from gameplay preset. Random receives a new server diversity seed for every draft.', 'Tách biệt với cấu hình gameplay. Chế độ ngẫu nhiên nhận seed đa dạng mới từ máy chủ cho mỗi bản nháp.')}</p>
        </div>
        <div class="aai-field" data-field="contentLevel">
          <h3 class="aai-field-title" id="aai-content-title">${tr('Content level', 'Mức nội dung')}</h3>
          ${radioSeg('aai-content', 'aai-content-title', Object.entries(CONTENT_LEVELS).map(([value, labels]) => [value, tr(labels[0], labels[1])]), form.contentLevel, { describedBy: 'ai-content-help' })}
          <p class="aai-help" id="ai-content-help">${escapeHtml(pairLabel(CONTENT_LEVEL_HELP, form.contentLevel))}</p>
          ${fieldErrorHtml('contentLevel')}
        </div>
      </section>`;

    const charactersCard = `
      <section class="adm-card aai-step" aria-labelledby="aai-characters-title">
        ${stepHead('aai-characters-title', tr('Characters', 'Nhân vật'))}
        <div class="aai-field" data-field="suspectCount">
          <h3 class="aai-field-title" id="aai-suspects-title">${tr('Suspects', 'Số nghi phạm')}</h3>
          ${radioSeg('aai-suspects', 'aai-suspects-title', SUSPECT_OPTIONS.map((count) => [count, String(count)]), form.suspectCount, { compact: true })}
          ${fieldErrorHtml('suspectCount')}
        </div>
        <div class="aai-field" data-field="npcIds">
          <div class="aai-field-row">
            <h3 class="aai-field-title" id="aai-npcs-title">${tr('NPCs from the library', 'NPC từ thư viện')} <span class="aai-count" id="ai-npc-count"></span></h3>
          </div>
          <div class="aai-pick-grid aai-pick-grid--npc" id="ai-npc-grid" role="group" aria-labelledby="aai-npcs-title" aria-describedby="ai-npc-help">${npcGridHtml()}</div>
          <p class="aai-help" id="ai-npc-help"></p>
          ${fieldErrorHtml('npcIds')}
        </div>
        <div class="aai-field" data-field="characterNotes">
          <label class="aai-label" for="ai-character-notes">${tr('Characters you would like', 'Mô tả nhân vật muốn có')} <span>${tr('(optional)', '(không bắt buộc)')}</span></label>
          <textarea class="field-input aai-textarea" id="ai-character-notes" rows="3" maxlength="${MAX_CHARACTER_NOTES}" aria-describedby="ai-character-notes-count" placeholder="${escapeHtml(tr('For example: an old watchmaker who knows everyone; a returning detective from an earlier case.', 'Ví dụ: một ông thợ đồng hồ quen cả phố; thám tử của vụ trước quay lại.'))}">${escapeHtml(form.characterNotes)}</textarea>
          <p class="aai-counter" id="ai-character-notes-count"></p>
          ${fieldErrorHtml('characterNotes')}
        </div>
      </section>`;

    const atmosphereCard = `
      <section class="adm-card aai-step" aria-labelledby="aai-atmosphere-title">
        ${stepHead('aai-atmosphere-title', tr('Atmosphere', 'Không khí'))}
        <div class="aai-field" data-field="weather">
          <h3 class="aai-field-title" id="aai-weather-title">${tr('Weather', 'Thời tiết')}</h3>
          ${radioChips('aai-weather', 'aai-weather-title', WEATHERS, form.weather, 'ai-weather-help')}
          <p class="aai-help" id="ai-weather-help">${tr('Outdoor scenes only: indoors there is never weather.', 'Chỉ áp cho cảnh ngoài trời; trong nhà không có thời tiết.')}</p>
          ${fieldErrorHtml('weather')}
        </div>
        <div class="aai-field" data-field="timeOfDay">
          <h3 class="aai-field-title" id="aai-time-title">${tr('Time of day', 'Thời điểm')}</h3>
          ${radioChips('aai-time', 'aai-time-title', TIMES_OF_DAY, form.timeOfDay)}
          ${fieldErrorHtml('timeOfDay')}
        </div>
        <div class="aai-locks">${lockField('ai-tone-lock', tr('Tone lock', 'Khóa sắc thái'), CREATIVE_TONES, form.tone)}</div>
      </section>`;

    const crackCard = v3Enabled ? `
      <section class="adm-card aai-step" aria-labelledby="aai-extension-title">
        ${stepHead('aai-extension-title', tr('Gameplay extension', 'Mở rộng gameplay'))}
        <label class="aai-toggle" for="ai-include-crack">
          <span class="aai-toggle-text">
            <span class="aai-toggle-name"><strong id="aai-crack-title">${tr('Include Crack the Lie', 'Thêm Phá Vỡ Lời Dối')}</strong><span id="ai-crack-badge" class="adm-pill aai-v3-pill">V3 · Crack</span></span>
            <span class="aai-toggle-desc" id="aai-crack-desc">${tr('Keeps the selected V2 preset and adds private evidence, testimony and Joint Review loops.', 'Giữ preset V2 đã chọn và thêm chứng cứ riêng, lời khai riêng cùng vòng Cùng xem xét.')}</span>
            <span class="aai-mono" id="ai-crack-budget">${crackBudget(presetKey, capabilities.crackBudgets)}</span>
          </span>
          <input id="ai-include-crack" class="aai-switch" type="checkbox" role="switch" ${form.includeCrack ? 'checked' : ''} aria-labelledby="aai-crack-title" aria-describedby="aai-crack-desc ai-crack-budget">
        </label>
        ${!capabilities.gameplayV3Enabled
          ? `<div class="notice notice-bad"><strong>${tr('V3 gameplay is disabled.', 'Gameplay V3 đang tắt.')}</strong> ${tr('V3 drafts can be generated and reviewed, but cannot be published.', 'Có thể tạo và kiểm tra bản nháp V3 nhưng chưa thể xuất bản.')}</div>`
          : ''}
      </section>` : '';

    const ideaCard = `
      <section class="adm-card aai-step" aria-labelledby="aai-idea-title">
        ${stepHead('aai-idea-title', tr('Idea', 'Ý tưởng'))}
        <div class="aai-field" data-field="prompt">
          <label class="aai-label" for="ai-creator-direction">${tr('Your idea for the case', 'Ý tưởng cho vụ án')} <span>${tr('(optional)', '(không bắt buộc)')}</span></label>
          <div class="aai-inserts" role="group" aria-label="${tr('Add a prompt line to the idea', 'Chèn gợi ý vào ý tưởng')}">
            ${Object.entries(IDEA_HINTS).map(([key, labels]) => `<button type="button" class="aai-insert" data-idea-hint="${key}">${icon('plus', 14)}<span>${escapeHtml(tr(labels[0], labels[1]))}</span></button>`).join('')}
          </div>
          <textarea class="field-input aai-textarea" id="ai-creator-direction" rows="5" maxlength="${MAX_IDEA}" aria-describedby="ai-idea-count" placeholder="${escapeHtml(tr('A geisha goes missing on the night of the lantern festival… Do not include the Crack answer.', 'Một geisha mất tích đêm lễ hội đèn lồng… Không tiết lộ đáp án Crack.'))}">${escapeHtml(form.idea)}</textarea>
          <p class="aai-counter" id="ai-idea-count"></p>
          ${fieldErrorHtml('prompt')}
        </div>
        <div class="aai-locks">${lockField('ai-mechanic-lock', tr('Investigation mechanic', 'Khóa cơ chế điều tra'), CREATIVE_MECHANICS, form.mechanic)}</div>
      </section>`;

    const adminControls = isAdmin ? `
      <div class="aai-summary-controls">
        <div class="aai-summary-field" data-field="pixelLabCap">
          <label for="ai-pixellab-cap">${tr('Max PixelLab generations', 'Lượt PixelLab tối đa')}</label>
          <select class="aai-summary-select" id="ai-pixellab-cap">${PIXELLAB_CAPS.map((cap) => `<option value="${cap}" ${form.pixelLabCap === cap ? 'selected' : ''}>${cap === 0 ? tr('Library only', 'Chỉ thư viện') : tr(`Up to ${cap}`, `Tối đa ${cap}`)}</option>`).join('')}</select>
          ${fieldErrorHtml('pixelLabCap')}
        </div>
        <div class="aai-summary-field" data-field="reviewMode">
          <span class="aai-summary-label" id="aai-review-title">${tr('Review mode', 'Chế độ duyệt')}</span>
          ${radioSeg('aai-review', 'aai-review-title', Object.entries(REVIEW_MODES).map(([value, labels]) => [value, tr(labels[0], labels[1])]), form.reviewMode, { navy: true })}
          ${fieldErrorHtml('reviewMode')}
        </div>
      </div>` : '';

    const vipQuota = isVip ? `
      <div class="aai-summary-vip" id="ai-vip-quota">
        <p>${icon('clock', 16)}<span>${tr('This order waits for the owner (Yen) to approve it.', 'Đơn sẽ chờ Yen duyệt.')}</span></p>
        <p data-quota-remaining>${escapeHtml(vipQuotaText())}</p>
      </div>` : '';

    const aside = `
      <aside class="aai-aside" aria-labelledby="aai-summary-title">
        <section class="aai-summary">
          <h2 id="aai-summary-title">${tr('Draft to create', 'Bản nháp sẽ tạo')}</h2>
          <dl class="aai-summary-list">
            ${summaryRow('world', tr('World', 'Thế giới'))}
            ${summaryRow('locations', tr('Locations', 'Địa điểm'))}
            ${summaryRow('preset', tr('Preset', 'Cấu hình'))}
            ${summaryRow('scope', tr('Scope', 'Quy mô'))}
            ${summaryRow('language', tr('Language', 'Ngôn ngữ'))}
            ${summaryRow('caseType', tr('Case type', 'Loại vụ án'))}
            ${summaryRow('content', tr('Content', 'Nội dung'))}
            ${summaryRow('characters', tr('Characters', 'Nhân vật'))}
            ${summaryRow('weather', tr('Weather', 'Thời tiết'))}
            ${summaryRow('timeOfDay', tr('Time of day', 'Thời điểm'))}
            ${summaryRow('tone', tr('Tone', 'Sắc thái'))}
            ${v3Enabled ? summaryRow('crack', tr('Crack the Lie', 'Phá Vỡ Lời Dối')) : ''}
            ${summaryRow('mechanic', tr('Mechanic', 'Cơ chế'))}
          </dl>
          ${adminControls}
          ${vipQuota}
          <p class="aai-summary-note" id="ai-preset-help">${escapeHtml(presetDescription(presetKey))}</p>
          <p class="aai-summary-block" id="ai-submit-reason" hidden></p>
          <button class="btn aai-create" type="button" id="quick-create-btn" ${submitDisabled() ? 'disabled' : ''}>${icon('sparkle', 18)}<span data-create-label>${creating ? tr('Sending order…', 'Đang gửi đơn…') : tr('Send order to Claude', 'Gửi đơn cho Claude')}</span></button>
        </section>
        <section class="adm-card aai-flow" aria-labelledby="aai-flow-title">
          <h2 class="aai-flow-title" id="aai-flow-title">${tr('Review steps after creation', 'Các bước duyệt sau khi tạo')}</h2>
          <ol class="aai-flow-list" id="ai-review-steps">${reviewStepsHtml()}</ol>
          <p class="aai-help" id="ai-review-note"${isAdmin && form.reviewMode === 'FAST' ? '' : ' hidden'}>${tr('Fast mode: the bot passes the premise, logic and layout gates itself when every check passes. The case truth is always reviewed by a person.', 'Chế độ nhanh: bot tự qua cổng tiền đề, logic và bố cục khi mọi kiểm tra đều đạt. Sự thật vụ án luôn do người duyệt.')}</p>
        </section>
        ${isAdmin ? settingsCardHtml() : ''}
      </aside>`;

    return `
      <div class="aai-layout">
        <div class="aai-form">${worldCard}${presetCard}${languageCard}${charactersCard}${atmosphereCard}${crackCard}${ideaCard}</div>
        ${aside}
      </div>`;
  }

  // ---------------------------------------------------------------- keeping the form, summary and limits in step

  function setFieldError(field, message) {
    if (message) fieldErrors[field] = message;
    else delete fieldErrors[field];
    const slot = app.querySelector(`[data-field-error="${field}"]`);
    if (slot) {
      slot.textContent = message || '';
      slot.hidden = !message;
    }
    app.querySelector(`[data-field="${field}"]`)?.classList.toggle('has-error', Boolean(message));
  }

  function clearFieldError(field) {
    if (fieldErrors[field]) setFieldError(field, '');
  }

  function syncSummary() {
    const set = (key, text) => {
      const cell = app.querySelector(`[data-aai-sum="${key}"]`);
      if (cell) cell.textContent = text;
    };
    set('world', worldLabel(form.world));
    set('locations', form.locationIds.length ? namesOf(form.locationIds) : tr('Bot picks from the library', 'Để bot chọn trong thư viện'));
    set('preset', presetLabel(form.preset));
    set('scope', `${form.stageCount} ${tr(plural(form.stageCount, 'stage', 'stages'), 'chặng')} · ${pairLabel(DIFFICULTIES, form.difficulty)} · ${tr(`${form.playMinutes} min`, `${form.playMinutes} phút`)}`);
    set('language', form.language === 'vi' ? 'Tiếng Việt' : 'English');
    set('caseType', caseTypeShortLabel(form.caseType));
    set('content', pairLabel(CONTENT_LEVELS, form.contentLevel));
    set('characters', charactersSummary());
    set('weather', pairLabel(WEATHERS, form.weather));
    set('timeOfDay', pairLabel(TIMES_OF_DAY, form.timeOfDay));
    set('tone', pairLabel(CREATIVE_TONES, form.tone, tr('Automatic', 'Tự động')));
    set('crack', form.includeCrack ? tr('On', 'Bật') : tr('Off', 'Tắt'));
    set('mechanic', pairLabel(CREATIVE_MECHANICS, form.mechanic, tr('Automatic', 'Tự động')));
  }

  function syncCounters() {
    const counter = (id, length, max) => {
      const node = app.querySelector(id);
      if (!node) return;
      node.textContent = tr(`${numberText(length)} / ${numberText(max)} characters`, `${numberText(length)} / ${numberText(max)} ký tự`);
      node.classList.toggle('is-near', length >= max * 0.9 && length < max);
      node.classList.toggle('is-full', length >= max);
    };
    counter('#ai-idea-count', form.idea.length, MAX_IDEA);
    counter('#ai-character-notes-count', form.characterNotes.length, MAX_CHARACTER_NOTES);
  }

  /** Counts beside the pickers, the NPC limit and its message, and whether the order can go. */
  function syncLimits() {
    const npcLimit = form.suspectCount + EXTRA_NPCS;
    const locationCount = app.querySelector('#ai-location-count');
    if (locationCount) locationCount.textContent = tr(`${form.locationIds.length} picked`, `đã chọn ${form.locationIds.length}`);
    const npcCount = app.querySelector('#ai-npc-count');
    if (npcCount) npcCount.textContent = `${form.npcIds.length} / ${npcLimit}`;
    const npcHelp = app.querySelector('#ai-npc-help');
    if (npcHelp) {
      npcHelp.textContent = tr(
        `Portraits of this world. Pick up to ${npcLimit} (suspects + ${EXTRA_NPCS}); leave it empty and the bot casts them.`,
        `Chân dung của thế giới này. Chọn tối đa ${npcLimit} (số nghi phạm + ${EXTRA_NPCS}); để trống thì bot tự chọn.`);
    }
    if (form.npcIds.length > npcLimit) {
      setFieldError('npcIds', tr(
        `${form.npcIds.length} NPCs are picked but ${form.suspectCount} suspects allow ${npcLimit}. Remove some, or add suspects.`,
        `Đang chọn ${form.npcIds.length} NPC, nhưng ${form.suspectCount} nghi phạm chỉ cho tối đa ${npcLimit}. Bỏ bớt NPC hoặc tăng số nghi phạm.`));
    }
  }

  function syncSubmit() {
    const button = app.querySelector('#quick-create-btn');
    if (!button) return;
    const reason = orderBlockReason();
    button.disabled = submitDisabled();
    const slot = app.querySelector('#ai-submit-reason');
    if (slot) {
      slot.textContent = reason;
      slot.hidden = !reason;
    }
    if (reason) button.setAttribute('aria-describedby', 'ai-submit-reason');
    else button.removeAttribute('aria-describedby');
  }

  function syncForm() {
    syncSummary();
    syncCounters();
    syncLimits();
    syncSubmit();
  }

  function renderPickers() {
    const locations = app.querySelector('#ai-location-grid');
    if (locations) locations.innerHTML = locationGridHtml();
    const npcs = app.querySelector('#ai-npc-grid');
    if (npcs) npcs.innerHTML = npcGridHtml();
  }

  /**
   * A new world brings its own places and faces: picks that belong only to the old world are dropped (entries for
   * every world stay), and the pickers show the new world's library.
   */
  function selectWorld(worldId) {
    if (!WORLDS.some((world) => world.id === worldId) || form.world === worldId) return;
    form.world = worldId;
    const stillThere = (key) => library.some((entry) => entry.key === key && inWorld(entry, worldId));
    form.locationIds = form.locationIds.filter(stillThere);
    form.npcIds = form.npcIds.filter(stillThere);
    for (const field of ['world', 'locationIds', 'npcIds']) clearFieldError(field);
    app.querySelectorAll('[data-world]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.world === worldId)));
    const note = app.querySelector('#ai-new-world-note');
    if (note) note.hidden = worldId !== NEW_WORLD;
    renderPickers();
    syncForm();
  }

  function toggleLocation(button) {
    const key = button.dataset.location;
    const picked = form.locationIds.includes(key);
    if (!picked && form.locationIds.length >= MAX_LOCATIONS) {
      setFieldError('locationIds', tr(`An order names at most ${MAX_LOCATIONS} places. Remove one first.`, `Mỗi đơn chọn tối đa ${MAX_LOCATIONS} địa điểm. Hãy bỏ bớt một nơi trước.`));
      return;
    }
    form.locationIds = picked ? form.locationIds.filter((item) => item !== key) : [...form.locationIds, key];
    button.setAttribute('aria-pressed', String(!picked));
    clearFieldError('locationIds');
    syncForm();
  }

  function toggleNpc(button) {
    const key = button.dataset.npc;
    const picked = form.npcIds.includes(key);
    const limit = form.suspectCount + EXTRA_NPCS;
    if (!picked && form.npcIds.length >= limit) {
      setFieldError('npcIds', tr(
        `${form.suspectCount} suspects allow at most ${limit} NPCs. Remove one, or add a suspect.`,
        `${form.suspectCount} nghi phạm chỉ chọn được tối đa ${limit} NPC. Bỏ bớt một NPC hoặc tăng số nghi phạm.`));
      return;
    }
    form.npcIds = picked ? form.npcIds.filter((item) => item !== key) : [...form.npcIds, key];
    button.setAttribute('aria-pressed', String(!picked));
    clearFieldError('npcIds');
    syncForm();
  }

  /** Starts a new line of the idea with a hint ("Victim: "), at the caret, never past 2,000 characters. */
  function insertIdeaHint(key) {
    const textarea = app.querySelector('#ai-creator-direction');
    const labels = IDEA_HINTS[key];
    if (!textarea || !labels) return;
    const value = textarea.value;
    const touched = textarea.dataset.touched === '1';
    const start = touched ? textarea.selectionStart : value.length;
    const end = touched ? textarea.selectionEnd : value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const text = `${before && !before.endsWith('\n') ? '\n' : ''}${tr(labels[0], labels[1])}: `;
    if (before.length + text.length + after.length > MAX_IDEA) {
      setFieldError('prompt', tr('The idea is full (2,000 characters). Shorten it before adding a hint.', 'Ý tưởng đã đủ 2.000 ký tự. Hãy rút gọn trước khi chèn gợi ý.'));
      textarea.focus();
      return;
    }
    textarea.value = `${before}${text}${after}`;
    const caret = before.length + text.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dataset.touched = '1';
    form.idea = textarea.value;
    clearFieldError('prompt');
    syncCounters();
  }

  /** The preset fixes stages and difficulty on the server: the form follows it so it never promises otherwise. */
  function applyPreset(presetKey) {
    const key = PRESETS[presetKey] ? presetKey : 'NORMAL_RANDOM';
    form.preset = key;
    form.stageCount = PRESETS[key].stageCount;
    form.difficulty = PRESETS[key].difficulty;
    const limits = PRESET_LIMITS[key];
    app.querySelectorAll('input[name="aai-stages"]').forEach((radio) => {
      const count = Number(radio.value);
      radio.disabled = count < limits.stages[0] || count > limits.stages[1];
      radio.checked = count === form.stageCount;
    });
    app.querySelectorAll('input[name="aai-difficulty"]').forEach((radio) => {
      radio.disabled = !limits.difficulties.includes(radio.value);
      radio.checked = radio.value === form.difficulty;
    });
    const help = app.querySelector('#ai-preset-limits');
    if (help) help.textContent = presetLimitText(key);
    clearFieldError('stageCount');
    clearFieldError('difficulty');
  }

  function renderReviewSteps() {
    const list = app.querySelector('#ai-review-steps');
    if (list) list.innerHTML = reviewStepsHtml();
    const note = app.querySelector('#ai-review-note');
    if (note) note.hidden = !(isAdmin && form.reviewMode === 'FAST');
  }

  /** The order as POST /api/admin/ai-cases expects it (AiCaseOrder). A VIP never sends the PixelLab cap or review mode. */
  function buildOrder() {
    const order = {
      world: form.world,
      locationIds: [...form.locationIds],
      npcIds: [...form.npcIds],
      suspectCount: form.suspectCount,
      characterNotes: form.characterNotes.trim(),
      weather: form.weather,
      timeOfDay: form.timeOfDay,
      playMinutes: form.playMinutes,
      contentLevel: form.contentLevel,
    };
    if (isAdmin) {
      order.pixelLabCap = form.pixelLabCap;
      order.reviewMode = form.reviewMode;
    }
    return order;
  }

  /**
   * Puts the server's refusal next to the field it is about: `errors.field` ("order.suspectCount") for order errors,
   * or the keys of a model validation error ({ "Prompt": [...] }). Returns the fields it marked.
   */
  function showServerFieldErrors(error) {
    const toField = (path) => ORDER_ERROR_FIELDS[String(path || '').replace(/^\$\./, '').split('.').pop().replace(/\[\d+\]$/, '').toLowerCase()] || '';
    const details = error?.errors;
    const found = new Map();
    if (typeof details?.field === 'string') {
      const field = toField(details.field);
      if (field) found.set(field, error.message);
    } else if (details && typeof details === 'object' && !details.code) {
      for (const [key, messages] of Object.entries(details)) {
        const field = toField(key);
        if (field && !found.has(field)) found.set(field, [].concat(messages)[0] || error.message);
      }
    }
    for (const [field, message] of found) {
      setFieldError(field, `${pairLabel(FIELD_ERROR_LABELS, field, '')} ${tr('Server', 'Máy chủ')}: ${message}`.trim());
    }
    return [...found.keys()];
  }

  function focusField(field) {
    const container = app.querySelector(`[data-field="${field}"]`);
    if (!container) return;
    container.scrollIntoView({ block: 'center' });
    container.querySelector('input:not([disabled]):checked, button, textarea, select, input:not([disabled])')?.focus({ preventScroll: true });
  }

  function draw(activeDraft = null) {
    if (disposed) return;
    captureCreationForm();
    visibleDraft = activeDraft;
    disposePresentation();
    disposePresentation = () => {};
    // The progress and the open draft sit above the form: "Create" and "View" both lead the eye (and the scroll) there.
    render(app, `
    <div class="page aai-page">
      ${pageHead({
    title: tr('AI Case Creator', 'Tạo vụ án bằng AI'),
    sub: tr('Create a premise, approve its immutable causal truth, then project that truth into playable clues, dialogue, puzzles, and a five-claim accusation.', 'Tạo tiền đề, duyệt nguồn sự thật nhân quả bất biến, rồi chuyển truth thành manh mối, hội thoại, câu đố và cáo buộc năm luận điểm.'),
  })}

      <div id="ai-creation-status" class="aai-status"></div>

      <section class="adm-card aai-progress generation-progress" id="generation-progress" hidden aria-live="polite">
        <div class="generation-progress-heading">
          <strong id="generation-progress-title">${tr('Preparing...', 'Đang chuẩn bị...')}</strong>
          <span id="generation-progress-percent">0%</span>
        </div>
        <div class="generation-progress-track" role="progressbar" aria-labelledby="generation-progress-title" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="generation-progress-fill" id="generation-progress-fill"></div>
        </div>
        <p class="muted small" id="generation-progress-detail"></p>
      </section>

      <div id="ai-output" class="aai-output">${activeDraft ? draftDetail(activeDraft) : ''}</div>

      ${creationLayout()}

      ${canManageDrafts ? draftsCard() : ''}
    </div>`);
    bind();
    syncForm();
    renderCreationStatus();
  }

  function failureBlock(d, generating) {
    const phase = d.failurePhase && d.failurePhase !== 'NONE'
      ? `<p class="aai-failure-phase">${tr('Failure phase', 'Giai đoạn lỗi')}: <code>${escapeHtml(d.failurePhase)}</code>${d.failedAssetIds?.length ? ` · ${tr('Failed assets', 'Tài nguyên lỗi')}: ${d.failedAssetIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}` : ''}</p>`
      : '';
    const errors = d.validationErrors?.length
      ? `<ul>${d.validationErrors.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
      : '';
    if (!phase && !errors) return '';
    if (!generating) return `<div class="notice notice-bad aai-failure">${phase}${errors}</div>`;
    return `<details class="truth-section aai-previous" data-previous-attempt><summary>${tr(
      'Result of the previous attempt', 'Kết quả lần chạy trước'
    )}</summary>${phase}${errors}</details>`;
  }

  function draftDetail(d) {
    const preview = d.storyPreview;
    const published = d.publishedCase || d.importedCaseId || d.status === STATUS_PUBLISHED;
    const caseId = d.publishedCase?.caseId || d.importedCaseId || d.caseId;
    const resumeAction = continueButton(d);
    const generating = isGeneratingDraft(d);
    const cannotResume = !generating && d.status === STATUS_GENERATED_INVALID && !d.hasGeneratedJson && !published && !d.canContinue;
    const title = d.caseTitle || preview?.title || d.caseId || tr('Untitled draft', 'Bản nháp chưa có tên');
    // Technical fingerprints of the run, one per line in monospace.
    const codes = [
      d.storyDiversity?.seed ? `Diversity seed: <code>${escapeHtml(d.storyDiversity.seed)}</code>${d.storyDiversity?.coreFingerprint ? ` · Core: <code>${escapeHtml(d.storyDiversity.coreFingerprint.slice(0, 12))}</code>` : ''}${d.storyFingerprint ? ` · Preview: <code>${escapeHtml(d.storyFingerprint.slice(0, 12))}</code>` : ''}` : '',
      d.storyDiversity?.creativeConstraints && !d.storyDiversity.creativeConstraints.isEmpty ? `${tr('Locked creative brief', 'Brief sáng tác đã khóa')}: ${escapeHtml([d.storyDiversity.creativeConstraints.settingId, d.storyDiversity.creativeConstraints.toneId, d.storyDiversity.creativeConstraints.investigationMechanicId].filter(Boolean).join(' · '))}` : '',
      d.hasProjectionPlan ? `Projection: ${escapeHtml(d.projectionPlanSchemaVersion)} · <code>${escapeHtml((d.projectionPlanHash || '').slice(0, 12))}</code> · ${escapeHtml(d.projectionCompilerVersion)} · ${escapeHtml(d.projectionBuildMode)}` : d.projectionBuildMode ? `Build mode: ${escapeHtml(d.projectionBuildMode)}` : '',
      d.jsonFolderPath ? `Bundle: ${escapeHtml(d.jsonFolderPath)}` : '',
      d.assetManifest?.assetRootUrl ? `Assets: ${escapeHtml(d.assetManifest.assetRootUrl)} (${d.assetManifest.assets?.length ?? 0})` : '',
    ].filter(Boolean);
    const adminReview = session.isAdmin() && caseId
      ? `<a class="btn btn-ghost btn-sm" href="/admin/cases/${encodeURIComponent(caseId)}">${tr('Admin review', 'Xem trong quản trị vụ án')}</a>` : '';
    const actions = canPlaytest(d)
      ? `${playtestButton(d, 'btn-primary')}
          ${adminReview}`
      : published && caseId
        ? `<a class="btn btn-primary btn-sm" href="/cases/${encodeURIComponent(caseId)}">${tr('Open published case', 'Mở vụ án đã xuất bản')}</a>
          ${adminReview}`
        : `${resumeAction}${cancelButton(d)}`;
    return `
    <section class="adm-card aai-draft-head" aria-labelledby="aai-draft-title">
      <div class="aai-draft-titlebar">
        <div class="aai-draft-heading">
          <span class="adm-eyebrow">${tr('AI draft', 'Bản nháp AI')} · ${escapeHtml(orderedByLabel(d.createdByRole))}</span>
          <h2 class="aai-draft-title" id="aai-draft-title">${escapeHtml(title)}</h2>
        </div>
        ${statusPill(d)}
      </div>
      ${orderSummary(d)}
      <p class="aai-draft-meta">${tr('Preset', 'Cấu hình')}: ${escapeHtml(presetLabel(d.settings?.generationPreset))} · ${tr('Case type', 'Loại vụ án')}: ${escapeHtml(caseTypeLabel(d.storyDiversity?.caseType || d.settings?.caseType))} · ${tr('Language', 'Ngôn ngữ')}: ${d.settings?.language === 'vi' ? 'Tiếng Việt' : 'English'} · ${tr('Logic contract', 'Hợp đồng logic')}: v${Number(d.logicContractVersion || 1)}</p>
      ${codes.length ? `<ul class="aai-codes">${codes.map((line) => `<li>${line}</li>`).join('')}</ul>` : ''}
      ${failureBlock(d, generating)}
      ${cannotResume
        ? `<p class="aai-note">${tr(
            'This draft has no recoverable checkpoint for its current failure. Review the validation details, then create a new case if the source artifact cannot be repaired.',
            'Bản nháp không có checkpoint có thể phục hồi cho lỗi hiện tại. Hãy xem chi tiết validation; chỉ tạo case mới nếu artifact nguồn không thể sửa.'
          )}</p>`
        : ''}
      ${actions.trim() ? `<div class="case-actions aai-actions">${actions}</div>` : ''}
      ${canPlaytest(d) ? `<p class="aai-note" data-playtest-help>${tr('Imported, not published yet. Playtest opens a private room that only you (or an admin) and one player invited by link can join; it is not ranked and gives no rewards.', 'Đã import, chưa đăng. Chơi thử mở một phòng riêng chỉ bạn (hoặc ADMIN) và một người được mời bằng liên kết vào được; ván này không tính xếp hạng, không nhận thưởng.')}</p>` : ''}
    </section>
    ${bridgeReportPanel(d)}
    ${qualitySummary(d)}
    ${preview ? previewCard(preview, title) : ''}
    ${truthPanel(d)}
    ${blindReviewPanel(d)}
    ${provenancePanel(d)}
    ${v3PublishGatePanel(d)}
    ${v3ReviewPanel(d)}
    ${repairPanel(d)}
    ${generationDiagnostics(d)}
    ${presentationPlaceholder(d)}
    ${d.generatedJson && session.isAdmin()
      ? `<details class="json-details aai-panel aai-disclosure">
          <summary>${tr('Generated JSON', 'JSON đã tạo')}</summary>
          <p class="muted small">${tr('Replacing JSON validates the complete case, snapshots the current JSON, and resets layout/assets for v5 regeneration. Existing v4 files are not deleted.', 'Thay JSON sẽ kiểm tra toàn bộ vụ án, lưu bản chụp JSON hiện tại và đặt lại bố cục/tài nguyên để tạo lại v5. File v4 hiện có không bị xóa.')}</p>
          <textarea class="field-input json-editor" rows="24" data-json-editor="${escapeHtml(d.draftId)}" spellcheck="false" aria-label="${tr('Generated JSON', 'JSON đã tạo')}">${escapeHtml(d.generatedJson)}</textarea>
          <div class="case-actions aai-actions">
            <button class="btn btn-primary btn-sm" type="button" data-replace-json="${escapeHtml(d.draftId)}">${tr('Validate and replace JSON', 'Kiểm tra và thay JSON')}</button>
          </div>
        </details>`
      : ''}`;
  }

  function truthValues(values, fallback = '—') {
    return Array.isArray(values) && values.length ? values.map((value) => escapeHtml(value)).join(', ') : fallback;
  }

  /** Title row of a review panel: heading on the left, a status chip (HTML) on the right. */
  function panelHead(title, chipHtml = '', level = 3) {
    return `<div class="adm-card-head aai-panel-head"><h${level} class="aai-panel-title">${escapeHtml(title)}</h${level}>${chipHtml}</div>`;
  }

  /** Small labelled facts (culprit, motive...) as tiles. Values are plain text. */
  function factTiles(items) {
    return `<div class="aai-facts">${items.map(([label, value]) => `<div class="aai-fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`).join('')}</div>`;
  }

  function proofSourceGroups(truth, conclusion) {
    const traceIds = new Set(conclusion.supportingTraceIds || []);
    const statementIds = new Set(conclusion.supportingStatementIds || []);
    return new Set([
      ...(truth.traceLedger || []).filter((entry) => traceIds.has(entry.traceId)).map((entry) => entry.independentSourceGroup),
      ...(truth.statementLedger || []).filter((entry) => statementIds.has(entry.statementId)).map((entry) => entry.independentSourceGroup),
    ].filter(Boolean));
  }

  function proofCategoryLabel(category) {
    const labels = {
      MOTIVE: ['Motive', 'Động cơ'], METHOD: ['Method', 'Phương thức'],
      OPPORTUNITY: ['Opportunity', 'Cơ hội'], IDENTITY: ['Identity', 'Danh tính'], TIMELINE: ['Timeline', 'Dòng thời gian'],
    };
    return localizedPair(labels[category]) || category;
  }

  function reviewFindings(review) {
    if (review?.findings?.length) return review.findings;
    return (review?.issues || []).map((message, index) => ({
      findingId: `legacy-${index + 1}`,
      code: 'LEGACY_REVIEW_ISSUE',
      relatedIds: [],
      message,
    }));
  }

  function qualitySummary(d) {
    if (!d.truthSummary) return '';
    const status = d.truthReviewerResult?.status || d.truthSummary.reviewerStatus || 'NOT_RUN';
    const validationErrors = (d.truthValidationReport?.length || d.truthSummary.validationErrorCount || 0)
      + (d.validationErrors?.length || 0);
    return `<section class="notice ${validationErrors || ['FAILED', 'AMBIGUOUS'].includes(status) ? 'notice-bad' : ''} aai-panel aai-quality" data-ai-quality-summary>
      <h3 class="aai-panel-title">${tr('Quality checks', 'Kiểm tra chất lượng')}</h3>
      <p>${tr('Structure', 'Cấu trúc')}: ${validationErrors ? tr('Needs repair', 'Cần sửa') : tr('Passed deterministic validation', 'Đã qua kiểm tra tất định')} · ${tr('Story review (advisory)', 'Đánh giá cốt truyện (tham khảo)')}: <strong>${escapeHtml(status)}</strong></p>
      <p class="muted small">${status === 'NOT_RUN'
        ? tr('Story quality has not been reviewed. A valid structure alone does not establish that the mystery is playable.', 'Chất lượng cốt truyện chưa được đánh giá. Cấu trúc hợp lệ chưa đủ để xác nhận vụ án chơi được.')
        : tr('Review the findings below before approval. Structural validation and V3 pair checks do not establish the quality of the whole story.', 'Hãy đọc các phát hiện bên dưới trước khi duyệt. Kiểm tra cấu trúc và cặp đối chất V3 chưa xác nhận chất lượng toàn bộ cốt truyện.')}</p>
    </section>`;
  }

  function truthRepairReviewPanel(d) {
    if (!d.truthRepairCandidate) return '';
    const review = d.truthRepairReviewerResult;
    const status = review?.status || 'NOT_RUN';
    const findings = reviewFindings(review);
    const valid = d.truthRepairStatus === 'CANDIDATE_READY' && !d.truthRepairValidationReport?.length;
    return `<section class="notice ${!valid || ['FAILED', 'AMBIGUOUS'].includes(status) ? 'notice-bad' : ''} aai-subpanel" data-truth-repair-review>
      <h4>${tr('Repair candidate review', 'Đánh giá bản sửa')}</h4>
      <p>${valid ? tr('Structure passed; review the content before accepting.', 'Cấu trúc hợp lệ; hãy kiểm tra nội dung trước khi chấp nhận.') : tr('The candidate still needs structural repair.', 'Bản sửa vẫn cần sửa lỗi cấu trúc.')}</p>
      <p><strong>${tr('Candidate story review (advisory)', 'Đánh giá cốt truyện bản sửa (tham khảo)')}: ${escapeHtml(status)}</strong>${review && status !== 'NOT_RUN' ? ` · ${tr('Confidence', 'Độ tin cậy')}: ${(Number(review.confidence || 0) * 100).toFixed(0)}%` : ''}</p>
      ${status === 'NOT_RUN' ? `<p>${tr('The candidate has not received a story quality review.', 'Bản sửa chưa được đánh giá chất lượng cốt truyện.')}</p>` : ''}
      ${findings.length ? renderReviewFindingGroups(findings) : ''}
      ${d.truthRepairValidationReport?.length ? `<div class="notice notice-bad" role="alert" data-truth-repair-validation><strong>${tr('Candidate validation errors', 'Lỗi kiểm tra bản sửa')}</strong><ul>${d.truthRepairValidationReport.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
      <p class="muted small">${tr('These findings are advisory. Accepting replaces the truth and requires gameplay to be generated again; rejecting preserves the current draft.', 'Các phát hiện này mang tính tham khảo. Chấp nhận sẽ thay truth và yêu cầu tạo lại gameplay; từ chối giữ nguyên bản nháp hiện tại.')}</p>
      ${canContinueTruthRepairCandidate(d) ? `<div class="aai-repair" data-truth-repair-continuation>
        <h4>${tr('Continue repairing this candidate', 'Tiếp tục sửa từ bản sửa này')}</h4>
        <p>${tr('Reuse this candidate’s valid earlier artifacts and regenerate only the selected scope and what follows. The current truth and gameplay stay unchanged until you accept a valid candidate.', 'Tái sử dụng phần hợp lệ trước đó của bản sửa và chỉ tạo lại từ phạm vi đã chọn. Sự thật và gameplay hiện tại được giữ nguyên đến khi bạn chấp nhận một bản sửa hợp lệ.')}</p>
        ${d.truthRepairCandidatePlan ? `<p class="muted small" data-truth-repair-candidate-plan>${tr('Candidate repair recommendation', 'Khuyến nghị sửa bản sửa')}: <strong>${escapeHtml(d.truthRepairCandidatePlan.recommendedStartArtifact || 'TIMELINE')}</strong> · ${tr('Reasons', 'Lý do')}: ${truthValues(d.truthRepairCandidatePlan.reasonCodes)}</p>` : ''}
        <label class="truth-repair-field"><span>${tr('Candidate repair start', 'Bắt đầu sửa bản sửa từ')}</span><select class="field-input" data-candidate-repair-scope="${escapeHtml(d.draftId)}">${truthRepairScopeOptions(d.truthRepairCandidatePlan)}</select><small class="muted">${tr('Choose the recommended scope or an earlier one if its inputs also need changes.', 'Chọn phạm vi được khuyến nghị hoặc sớm hơn nếu dữ liệu đầu vào cũng cần thay đổi.')}</small></label>
        <label class="truth-repair-field"><span>${tr('Candidate repair instructions', 'Yêu cầu sửa tiếp bản sửa')}</span><textarea class="field-input" rows="2" maxlength="2000" data-candidate-repair-instructions="${escapeHtml(d.draftId)}" placeholder="${tr('Describe how to fix the candidate errors above.', 'Mô tả cách khắc phục các lỗi của bản sửa ở trên.')}"></textarea></label>
        <div class="case-actions aai-actions"><button class="btn btn-primary btn-sm" type="button" data-continue-truth-repair="${escapeHtml(d.draftId)}">${tr('Continue from this candidate', 'Sửa tiếp từ bản sửa này')}</button><button class="btn btn-ghost btn-sm" type="button" data-reject-truth-repair="${escapeHtml(d.draftId)}">${tr('Discard candidate', 'Bỏ bản sửa này')}</button></div>
      </div>` : ''}
    </section>`;
  }

  function truthRepairScopeOptions(plan) {
    const recommended = plan?.recommendedStartArtifact || 'TIMELINE';
    const recommendedIndex = TRUTH_ARTIFACT_ORDER.indexOf(recommended);
    const allowed = recommendedIndex >= 0
      ? TRUTH_ARTIFACT_ORDER.slice(0, recommendedIndex + 1)
      : TRUTH_ARTIFACT_ORDER.slice(0, 3);
    const selected = plan?.selectedStartArtifact || recommended;
    return allowed.map((artifact) =>
      `<option value="${artifact}" ${artifact === selected ? 'selected' : ''}>${artifact}${artifact === recommended ? ' (recommended)' : ''}</option>`).join('');
  }

  function findingArtifact(code) {
    if (code === 'OPPORTUNITY_CONSISTENCY' || code === 'SOLUTION_AMBIGUITY') return 'OPPORTUNITY';
    if (code === 'TRACE_PERSISTENCE' || code === 'PROOF_SCOPE') return 'EVIDENCE';
    return 'TIMELINE';
  }

  function renderReviewFindingGroups(findings) {
    const groups = new Map();
    for (const finding of findings) {
      const artifact = findingArtifact(finding.code);
      if (!groups.has(artifact)) groups.set(artifact, []);
      groups.get(artifact).push(finding);
    }
    return [...groups.entries()].map(([artifact, items]) =>
      `<section class="aai-findings" data-review-finding-group="${artifact}"><h4>${artifact}</h4><ul>${items.map((finding) => `<li><span class="chip chip-bad">${escapeHtml(finding.code || 'OTHER')}</span> <span>${escapeHtml(finding.message || '')}${finding.relatedIds?.length ? `<br><span class="aai-ids">${truthValues(finding.relatedIds)}</span>` : ''}</span></li>`).join('')}</ul></section>`).join('');
  }

  function truthPanel(d) {
    const summary = d.truthSummary;
    if (!summary) return '';
    const truth = d.caseTruth;
    const review = d.truthReviewerResult;
    const reviewPassed = truthReviewPassed(d);
    const findings = reviewFindings(review);
    const repairPlan = d.truthRepairPlan;
    const candidateReady = d.truthRepairStatus === 'CANDIDATE_READY' && d.truthRepairCandidate;
    const core = truth?.coreTruth;
    const conclusions = truth?.proofGraph?.conclusions || [];
    return `<section class="notice ${!summary.validationErrorCount ? 'notice-ok' : 'notice-bad'} truth-review-panel aai-panel" data-truth-review>
      ${panelHead(tr('Immutable case truth (spoiler)', 'Sự thật vụ án bất biến (có spoiler)'), `<span class="chip ${reviewPassed ? 'chip-ok' : ''}">${tr('Advisory', 'Tham khảo')}: ${escapeHtml(review?.status || summary.reviewerStatus || 'NOT_RUN')}</span>`)}
      <p class="aai-mono-line">Schema ${escapeHtml(summary.schemaVersion || '')} · SHA-256 <code>${escapeHtml(summary.truthHash || '')}</code></p>
      <div class="aai-tiles">
        ${tile({ label: tr('timeline events', 'sự kiện'), value: summary.timelineEventCount, of: summary.maxTimelineEvents || '?' })}
        ${tile({ label: tr('causal traces', 'dấu vết nhân quả'), value: summary.traceCount, of: summary.maxTraces || '?' })}
        ${tile({ label: tr('statements', 'lời khai'), value: summary.statementCount, of: summary.maxStatements || '?' })}
        ${tile({ label: tr('proof conclusions', 'kết luận'), value: summary.proofConclusionCount })}
      </div>
      ${review ? `<p class="muted small"><strong>${tr('Advisory AI review', 'Đánh giá AI tham khảo')}:</strong> ${tr('Findings do not block approval when deterministic validation passes.', 'Các phát hiện không chặn phê duyệt khi validator tất định đã pass.')}</p><div class="truth-review-verdicts">
        <strong>${tr('Reviewer confidence', 'Độ tin cậy của reviewer')}: ${(Number(review.confidence || 0) * 100).toFixed(0)}%</strong>
        <span class="chip ${review.timelineFeasible ? 'chip-ok' : 'chip-bad'}">${tr('Timeline', 'Thời gian')} ${review.timelineFeasible ? 'PASS' : 'BLOCK'}</span>
        <span class="chip ${review.physicalCausalityFeasible ? 'chip-ok' : 'chip-bad'}">${tr('Causality', 'Nhân quả')} ${review.physicalCausalityFeasible ? 'PASS' : 'BLOCK'}</span>
        <span class="chip ${review.uniqueSolution ? 'chip-ok' : 'chip-bad'}">${tr('Unique solution', 'Nghiệm duy nhất')} ${review.uniqueSolution ? 'PASS' : 'BLOCK'}</span>
      </div>${findings.length ? `<div class="aai-subpanel truth-validation-errors"><strong>${tr('Advisory reviewer findings', 'Phát hiện tham khảo từ reviewer')}</strong>${renderReviewFindingGroups(findings)}</div>` : ''}` : ''}
      ${d.truthValidationReport?.length ? `<div class="notice notice-bad truth-validation-errors"><strong>${tr('Validation report', 'Báo cáo validation')}</strong><ul>${d.truthValidationReport.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
      ${truth && core ? `${factTiles([
    [tr('Culprit', 'Thủ phạm'), core.culpritId],
    [tr('Target', 'Nạn nhân/mục tiêu'), core.targetId],
    [tr('Motive', 'Động cơ'), core.motive],
    [tr('Method', 'Phương thức'), core.method],
  ])}
      <details class="truth-section" open><summary>${tr('True timeline', 'Dòng thời gian thật')} (${truth.trueTimeline?.length || 0})</summary>
        <div class="table-scroll"><table class="admin-table truth-table"><thead><tr><th>${tr('Time', 'Thời gian')}</th><th>${tr('Actor / place', 'Nhân vật / nơi')}</th><th>${tr('Action', 'Hành động')}</th><th>${tr('Witnesses / traces', 'Nhân chứng / dấu vết')}</th></tr></thead>
        <tbody>${(truth.trueTimeline || []).map((event) => `<tr><td><strong>${event.startMinute}–${event.endMinute}</strong><br><span class="muted small">${escapeHtml(event.eventId)}</span></td><td>${escapeHtml(event.actorId)}<br><span class="muted small">${escapeHtml(event.locationId)}</span></td><td>${escapeHtml(event.action)}${event.travelFromPreviousMinutes ? `<br><span class="muted small">${tr('Travel', 'Di chuyển')}: ${event.travelFromPreviousMinutes}m</span>` : ''}</td><td>${truthValues(event.witnessIds)}<br><span class="muted small">${truthValues(event.traceIds)}</span></td></tr>`).join('')}</tbody></table></div>
      </details>
      <details class="truth-section" open><summary>${tr('Opportunity matrix', 'Ma trận cơ hội')} (${truth.opportunityMatrix?.length || 0})</summary>
        <div class="table-scroll"><table class="admin-table truth-table"><thead><tr><th>${tr('Suspect', 'Nghi phạm')}</th><th>${tr('Crime-opportunity window', 'Khoảng cơ hội phạm tội')}</th><th>${tr('Capability', 'Năng lực')}</th><th>${tr('Alibi / elimination', 'Ngoại phạm / loại trừ')}</th></tr></thead>
        <tbody>${(truth.opportunityMatrix || []).map((entry) => `<tr><td><strong>${escapeHtml(entry.characterId)}</strong><br><span class="chip ${entry.identityLinkedToCrime ? 'chip-bad' : 'chip-ok'}">${entry.identityLinkedToCrime ? tr('IDENTITY LINK', 'CÓ LIÊN KẾT') : tr('NO IDENTITY LINK', 'KHÔNG LIÊN KẾT')}</span></td><td>${entry.availableFromMinute}–${entry.availableToMinute}<br><span class="muted small">${entry.hasMotive ? tr('Has motive', 'Có động cơ') : tr('No proven motive', 'Chưa có động cơ')}</span></td><td><span class="muted small">${tr('Access', 'Quyền truy cập')}: ${truthValues(entry.accessIds)}<br>${tr('Tools', 'Công cụ')}: ${truthValues(entry.toolIds)}<br>${tr('Knowledge', 'Kiến thức')}: ${truthValues(entry.knowledgeIds)}</span></td><td><span class="chip ${entry.alibiVerified ? 'chip-ok' : ''}">${entry.alibiVerified ? tr('VERIFIED', 'ĐÃ XÁC MINH') : tr('UNVERIFIED', 'CHƯA XÁC MINH')}</span><br>${truthValues(entry.alibiEventIds)}<br><span class="muted small">${escapeHtml(entry.eliminationReason || '—')}</span></td></tr>`).join('')}</tbody></table></div>
      </details>
      <details class="truth-section"><summary>${tr('Causal trace ledger', 'Sổ dấu vết nhân quả')} (${truth.traceLedger?.length || 0})</summary>
        <div class="table-scroll"><table class="admin-table truth-table"><thead><tr><th>${tr('Trace / source action', 'Dấu vết / hành động nguồn')}</th><th>${tr('Physical cause', 'Nguyên nhân vật lý')}</th><th>${tr('Scope of proof', 'Phạm vi chứng minh')}</th><th>${tr('Source group', 'Nhóm nguồn')}</th></tr></thead>
        <tbody>${(truth.traceLedger || []).map((trace) => `<tr><td><strong>${escapeHtml(trace.traceId)}</strong><br><span class="muted small">${escapeHtml(trace.sourceActionId)} · ${escapeHtml(trace.createdByCharacterId)} · ${trace.createdAtMinute}m · ${escapeHtml(trace.locationId)}</span></td><td>${escapeHtml(trace.physicalCause)}<br><span class="muted small">${escapeHtml(trace.persistenceReason)}</span></td><td>${escapeHtml(trace.proves)}<br><span class="muted small">${tr('Does not prove', 'Không chứng minh')}: ${escapeHtml(trace.doesNotProve)}</span></td><td>${escapeHtml(trace.independentSourceGroup)}<br><span class="muted small">${truthValues(trace.supportsConclusionIds)}</span></td></tr>`).join('')}</tbody></table></div>
      </details>
      <details class="truth-section"><summary>${tr('Statement ledger', 'Sổ lời khai')} (${truth.statementLedger?.length || 0})</summary>
        <div class="table-scroll"><table class="admin-table truth-table"><thead><tr><th>${tr('Speaker / status', 'Người nói / trạng thái')}</th><th>${tr('Statement', 'Lời khai')}</th><th>${tr('Knowledge basis', 'Nguồn hiểu biết')}</th><th>${tr('Contradiction', 'Mâu thuẫn')}</th></tr></thead>
        <tbody>${(truth.statementLedger || []).map((statement) => `<tr><td><strong>${escapeHtml(statement.speakerId)}</strong><br><span class="chip ${statement.truthStatus === 'TRUE' ? 'chip-ok' : 'chip-bad'}">${escapeHtml(statement.truthStatus)}</span></td><td>${escapeHtml(statement.content)}${statement.reasonForLie ? `<br><span class="muted small">${tr('Reason', 'Lý do')}: ${escapeHtml(statement.reasonForLie)}</span>` : ''}</td><td>${truthValues(statement.eventIds)}<br><span class="muted small">${truthValues(statement.knowledgeSourceIds)}</span></td><td>${truthValues(statement.contradictedByTraceIds)}<br><span class="muted small">${truthValues(statement.supportsConclusionIds)}</span></td></tr>`).join('')}</tbody></table></div>
      </details>
      <details class="truth-section" open><summary>${tr('Five-category proof coverage', 'Bao phủ năm nhóm chứng minh')} (${conclusions.length})</summary>
        <div class="proof-coverage-grid" data-proof-coverage>${conclusions.map((conclusion) => {
          const groups = proofSourceGroups(truth, conclusion);
          const covered = groups.size >= 2;
          return `<article class="proof-coverage-card ${covered ? 'is-covered' : 'is-blocked'}"><div><strong>${escapeHtml(proofCategoryLabel(conclusion.category))}</strong><span class="chip ${covered ? 'chip-ok' : 'chip-bad'}">${groups.size} ${tr('sources', 'nguồn')}</span></div><p>${escapeHtml(conclusion.proposition)}</p><small>${tr('Traces', 'Dấu vết')}: ${truthValues(conclusion.supportingTraceIds)}<br>${tr('Statements', 'Lời khai')}: ${truthValues(conclusion.supportingStatementIds)}<br>${tr('Excludes', 'Loại trừ')}: ${truthValues(conclusion.excludesSuspectIds)}</small></article>`;
        }).join('')}</div>
      </details>
      ${truth.redHerringLedger?.length ? `<details class="truth-section"><summary>${tr('Red herrings and clearing evidence', 'Nghi binh và chứng cứ giải oan')} (${truth.redHerringLedger.length})</summary><div class="proof-coverage-grid">${truth.redHerringLedger.map((entry) => `<article class="proof-coverage-card"><strong>${escapeHtml(entry.suspectId)}</strong><p>${escapeHtml(entry.suspiciousReason)}</p><small>${tr('Innocent explanation', 'Giải thích vô tội')}: ${escapeHtml(entry.innocentExplanation)}<br>${tr('Clearing evidence', 'Chứng cứ giải oan')}: ${truthValues([...(entry.clearingTraceIds || []), ...(entry.clearingStatementIds || [])])}</small></article>`).join('')}</div></details>` : ''}
      <details class="json-details"><summary>${tr('Open spoiler truth JSON', 'Mở JSON truth có spoiler')}</summary><pre class="json-view">${escapeHtml(JSON.stringify(truth, null, 2))}</pre></details>` : ''}
      ${repairPlan ? `<p class="muted small" data-truth-repair-plan><strong>${tr('Recommended repair start', 'Điểm bắt đầu sửa được khuyến nghị')}:</strong> ${escapeHtml(repairPlan.recommendedStartArtifact || 'TIMELINE')} · ${tr('Reasons', 'Lý do')}: ${truthValues(repairPlan.reasonCodes)} · ${tr('Stale downstream', 'Downstream cần tạo lại')}: ${truthValues(repairPlan.staleArtifacts)}</p>` : ''}
      ${truthRepairReviewPanel(d)}
      ${canRepairTruth(d) ? `<div class="aai-repair">${!candidateReady ? `${d.truthRepairCandidate ? `<h4>${tr('Start again from current truth', 'Tạo lại từ sự thật hiện tại')}</h4><p class="muted small">${tr('This starts a separate repair from the current checkpoint and replaces the saved candidate.', 'Thao tác này bắt đầu sửa từ checkpoint hiện tại và thay thế bản sửa đang lưu.')}</p>` : ''}<label class="truth-repair-field"><span>${tr('Repair start artifact', 'Artifact bắt đầu sửa')}</span><select class="field-input" data-truth-repair-scope="${escapeHtml(d.draftId)}">${truthRepairScopeOptions(repairPlan)}</select><small class="muted">${tr('You may start earlier than recommended, never later.', 'Có thể bắt đầu sớm hơn khuyến nghị, không được bắt đầu muộn hơn.')}</small></label><label class="truth-repair-field"><span>${tr('Scoped repair instructions', 'Yêu cầu sửa theo phạm vi')}</span><textarea class="field-input" rows="2" maxlength="2000" data-truth-repair-instructions="${escapeHtml(d.draftId)}" placeholder="${tr('Describe the invalid causal artifact; valid upstream truth will remain locked.', 'Mô tả artifact nhân quả bị lỗi; truth upstream hợp lệ vẫn được khóa.')}"></textarea></label>` : ''}<div class="case-actions aai-actions">
        ${!candidateReady ? `<button class="btn btn-ghost btn-sm" type="button" data-repair-truth="${escapeHtml(d.draftId)}">${d.truthRepairCandidate ? tr('Repair from current truth', 'Sửa từ sự thật hiện tại') : tr('Create scoped repair', 'Tạo bản sửa theo phạm vi')}</button>` : ''}
        ${candidateReady ? `<button class="btn btn-primary btn-sm" type="button" data-accept-truth-repair="${escapeHtml(d.draftId)}">${tr('Accept truth repair', 'Chấp nhận bản sửa truth')}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-reject-truth-repair="${escapeHtml(d.draftId)}">${tr('Reject truth repair', 'Từ chối bản sửa truth')}</button>` : ''}
      </div></div>` : ''}
      ${!d.truthRepairCandidate && d.truthRepairValidationReport?.length ? `<ul class="notice notice-bad aai-alert-list" role="alert">${d.truthRepairValidationReport.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
      ${d.truthRepairCandidate ? `<details class="json-details"><summary>${tr('Truth repair candidate', 'Ứng viên sửa truth')}</summary><pre class="json-view">${escapeHtml(JSON.stringify(d.truthRepairCandidate, null, 2))}</pre></details>` : ''}
    </section>`;
  }

  function blindReviewPanel(d) {
    const review = d.blindSolvabilityReview || { status: 'NOT_RUN', uniqueSolution: false, confidence: 0, evidenceChainIds: [], findings: [] };
    if (!d.blindSolvabilityReview && !d.blindReviewAssessment) return '';
    const assessment = d.blindReviewAssessment || { status: 'NOT_RUN', validationErrors: [] };
    const findings = reviewFindings(review);
    const passed = assessment.status === 'PASSED';
    const assessmentLabel = {
      PASSED: tr('Verified pass', 'Đã xác minh đạt'),
      FAILED: tr('Reviewer failed', 'Reviewer đánh giá chưa đạt'),
      AMBIGUOUS: tr('Ambiguous', 'Còn mơ hồ'),
      INVALID: tr('Reviewer result invalid', 'Kết quả reviewer không hợp lệ'),
      UNAVAILABLE: tr('Review unavailable', 'Không lấy được review'),
      DISABLED: tr('Review disabled', 'Review đang tắt'),
      LEGACY_UNVERIFIED: tr('Legacy / unverified', 'Case cũ / chưa xác minh'),
      STALE: tr('Review is stale', 'Review đã cũ'),
    }[assessment.status] || tr('Not verified', 'Chưa xác minh');
    const assessmentErrors = (assessment.validationErrors || []).map((finding) =>
      `<li><strong>${escapeHtml(finding.code || 'VALIDATION')}</strong>: ${escapeHtml(finding.message || '')}</li>`).join('');
    const claimProofs = (review.claimProofs || []).map((proof) =>
      `<li><strong>${escapeHtml(proof.claimType || '')}</strong>: ${truthValues(proof.evidenceIds)}${proof.reasoning ? ` — ${escapeHtml(proof.reasoning)}` : ''}</li>`).join('');
    return `<section class="notice ${passed ? 'notice-ok' : ''} blind-review-panel aai-panel" data-blind-review>
      ${panelHead(tr('Advisory blind solvability review', 'Đánh giá khả năng giải mù (tham khảo)'), `<span class="chip ${passed ? 'chip-ok' : ''}">${escapeHtml(assessmentLabel)}</span>`)}
      <p class="muted">${tr('The reviewer only received information collectible before accusation; truth metadata and the final answer were removed.', 'Reviewer chỉ nhận thông tin người chơi có thể thu thập trước cáo buộc; metadata truth và đáp án cuối đã bị loại bỏ.')}</p>
      <dl class="aai-pairs">
        <div><dt>${tr('Server assessment', 'Xác minh từ server')}:</dt> <dd>${escapeHtml(assessment.status || 'NOT_RUN')}</dd></div>
        <div><dt>${tr('Reviewer confidence', 'Độ tin cậy của reviewer')}:</dt> <dd>${(Number(review.confidence || 0) * 100).toFixed(0)}%</dd></div>
      </dl>
      ${factTiles([
    [tr('Inferred culprit', 'Thủ phạm suy ra'), review.culpritId || '—'],
    [tr('Unique solution', 'Nghiệm duy nhất'), review.uniqueSolution ? 'PASS' : 'BLOCK'],
    [tr('Inferred motive', 'Động cơ suy ra'), review.motive || '—'],
    [tr('Inferred method', 'Phương thức suy ra'), review.method || '—'],
  ])}
      <dl class="aai-pairs">
        <div><dt>${tr('Timeline reconstruction', 'Tái dựng dòng thời gian')}:</dt> <dd>${escapeHtml(review.timelineSummary || '—')}</dd></div>
        <div><dt>${tr('Evidence chain', 'Chuỗi chứng cứ')}:</dt> <dd>${truthValues(review.evidenceChainIds)}</dd></div>
      </dl>
      ${claimProofs ? `<div class="aai-subpanel"><strong>${tr('Proof by claim', 'Chứng cứ theo luận điểm')}:</strong><ul>${claimProofs}</ul></div>` : ''}
      ${findings.length ? `<ul class="aai-list">${findings.map((finding) => `<li><strong>${escapeHtml(finding.code)}</strong>${finding.relatedIds?.length ? ` [${finding.relatedIds.map(escapeHtml).join(', ')}]` : ''}: ${escapeHtml(finding.message)}</li>`).join('')}</ul>` : ''}
      ${assessmentErrors ? `<div class="notice notice-bad"><strong>${tr('Server validation', 'Lỗi xác minh server')}:</strong><ul>${assessmentErrors}</ul></div>` : ''}
    </section>`;
  }

  function provenancePanel(d) {
    const artifacts = d.artifactProvenance || [];
    if (!artifacts.length) return '';
    const staleCount = artifacts.filter((artifact) => artifact.isStale).length;
    return `<details class="notice artifact-provenance aai-panel aai-disclosure" data-artifact-provenance ${staleCount ? 'open' : ''}>
      <summary><span>${tr('Artifact dependency provenance', 'Nguồn gốc dependency của artifact')}</span> <span class="chip ${staleCount ? 'chip-bad' : 'chip-ok'}">${staleCount ? `${staleCount} STALE` : 'CURRENT'}</span></summary>
      <div class="table-scroll"><table class="admin-table truth-table"><thead><tr><th>${tr('Artifact', 'Artifact')}</th><th>${tr('State', 'Trạng thái')}</th><th>Input SHA-256</th><th>Output SHA-256</th><th>${tr('Generated', 'Thời điểm tạo')}</th></tr></thead>
      <tbody>${artifacts.map((artifact) => `<tr><td><strong>${escapeHtml(artifact.artifact)}</strong></td><td><span class="chip ${artifact.isStale ? 'chip-bad' : 'chip-ok'}">${artifact.isStale ? 'STALE' : 'CURRENT'}</span></td><td><code>${escapeHtml((artifact.inputHash || '—').slice(0, 16))}</code></td><td><code>${escapeHtml((artifact.outputHash || '—').slice(0, 16))}</code></td><td>${artifact.generatedAt ? escapeHtml(new Date(artifact.generatedAt).toLocaleString()) : '—'}</td></tr>`).join('')}</tbody></table></div>
    </details>`;
  }

  function generationDiagnostics(d) {
    const attempts = d.generationAttempts || [];
    if (!attempts.length) return '';
    const inputTokens = attempts.reduce((sum, attempt) => sum + (attempt.inputTokens || 0), 0);
    const outputTokens = attempts.reduce((sum, attempt) => sum + (attempt.outputTokens || 0), 0);
    const phaseTotals = new Map();
    for (const attempt of attempts) {
      const step = String(attempt.step || '');
      const phase = /StoryPreview/i.test(step) ? 'Story preview'
        : /CaseTruth|TruthFeasibility/i.test(step) ? 'Case truth'
        : /BlindSolvability/i.test(step) ? 'Blind solvability'
        : /Blueprint/i.test(step) ? 'Blueprint'
        : /V3Pair|Semantic/i.test(step) ? 'Semantic review'
        : /FullCase|FullLogic/i.test(step) ? 'Full case'
        : 'Other';
      const total = phaseTotals.get(phase) || { input: 0, output: 0, calls: 0 };
      total.input += attempt.inputTokens || 0;
      total.output += attempt.outputTokens || 0;
      total.calls += 1;
      phaseTotals.set(phase, total);
    }
    return `<details class="json-details aai-panel aai-disclosure">
      <summary>${tr('Generation diagnostics', 'Chẩn đoán quá trình tạo')} (${attempts.length})</summary>
      <ul class="aai-list">${[...phaseTotals].map(([phase, total]) => `<li><strong>${escapeHtml(phase)}</strong>: ${total.calls} call(s) · ${total.input} input / ${total.output} output tokens</li>`).join('')}</ul>
      <p class="aai-mono-line">Prompt: ${escapeHtml(d.promptVersion || 'unknown')} · Schema: ${escapeHtml(d.schemaVersion || 'unknown')} · Tokens: ${inputTokens} in / ${outputTokens} out</p>
      <ul class="aai-list aai-list--mono">${attempts.slice(-10).map((attempt) => `<li>${escapeHtml(attempt.step)} #${attempt.attemptNumber}: ${escapeHtml(attempt.status)}${attempt.failureCategory ? ` — ${escapeHtml(attempt.failureCategory)}` : ''}</li>`).join('')}</ul>
    </details>`;
  }

  function repairPanel(d) {
    if (isV3Draft(d) || Number(d.logicContractVersion || 1) >= 2) return '';
    if (d.status !== STATUS_FULL_LOGIC_AWAITING_APPROVAL && d.status !== STATUS_GENERATED_INVALID) return '';
    const hasCandidate = Boolean(d.repairedCandidateJson);
    return `
    <section class="notice aai-panel">
      ${panelHead(tr('Full logic repair', 'Sửa logic đầy đủ'))}
      <p class="muted small">${tr('Creates a camera-first repair candidate without overwriting the current draft.', 'Tạo bản sửa ưu tiên camera mà không ghi đè bản nháp hiện tại.')}</p>
      <div class="case-actions aai-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-repair-full-logic="${escapeHtml(d.draftId)}">Repair item evidence</button>
        ${hasCandidate && d.repairStatus === 'CANDIDATE_READY'
          ? `<button class="btn btn-primary btn-sm" type="button" data-accept-repair="${escapeHtml(d.draftId)}">Accept repair</button>
             <button class="btn btn-ghost btn-sm" type="button" data-reject-repair="${escapeHtml(d.draftId)}">Reject repair</button>`
          : ''}
      </div>
      ${d.repairStatus ? `<p class="muted small">Repair status: ${escapeHtml(d.repairStatus)}</p>` : ''}
      ${d.repairValidationReport?.length
        ? `<ul>${d.repairValidationReport.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
        : ''}
      ${hasCandidate && session.isAdmin()
        ? `<details class="json-details"><summary>Repaired candidate JSON</summary><pre class="json-view">${escapeHtml(d.repairedCandidateJson)}</pre></details>`
        : ''}
    </section>`;
  }

  function v3ReviewPanel(d) {
    if (d.settings?.mechanicsVersion !== 3 && !d.settings?.includeCrackTheLie) return '';
    const emptyReview = (tone, text) => `<section class="notice ${tone} aai-panel">${panelHead('V3 Crack review')}<p class="muted small">${text}</p></section>`;
    if (!d.generatedJson) return emptyReview('', tr('Full logic has not been generated yet.', 'Chưa tạo logic đầy đủ.'));

    let gameCase;
    try {
      gameCase = JSON.parse(d.generatedJson);
    } catch {
      return emptyReview('notice-bad', tr('Generated JSON cannot be parsed.', 'Không đọc được JSON đã tạo.'));
    }
    const challenges = [...(gameCase.evidenceChallenges || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    if (challenges.length === 0) return emptyReview('notice-bad', tr('No paired challenge was found.', 'Không tìm thấy thử thách ghép cặp nào.'));

    const clues = new Map((gameCase.clues || []).map((clue) => [clue.clueId, clue]));
    const items = new Map((gameCase.items || []).map((item) => [item.itemId, item]));
    const puzzles = new Map((gameCase.puzzles || []).map((puzzle) => [puzzle.puzzleId, puzzle]));
    const interactions = new Map((gameCase.interactions || []).map((interaction) => [interaction.interactionId, interaction]));
    const fragments = new Map((gameCase.testimonyFragments || []).map((fragment) => [fragment.id, fragment]));
    const dialogues = new Map((gameCase.dialogues || []).map((dialogue) => [dialogue.dialogueId, dialogue]));
    const crackReviews = new Map((d.v3SemanticReview?.cracks || []).map((review) => [review.challengeId, review]));
    if (challenges.length === 1 && crackReviews.size === 0 && d.v3SemanticReview?.pairEvaluations?.length) {
      crackReviews.set(challenges[0].challengeId, { pairEvaluations: d.v3SemanticReview.pairEvaluations });
    }

    const panels = challenges.map((challenge) => {
      const review = crackReviews.get(challenge.challengeId);
      const evaluations = new Map((review?.pairEvaluations || [])
        .map((entry) => [`${entry.evidenceId}\u001f${entry.testimonyFragmentId}`, entry]));
      const evidenceIds = challenge.candidateEvidenceIds || [];
      const fragmentIds = challenge.candidateTestimonyFragmentIds || [];
      const pairCount = evidenceIds.length * fragmentIds.length;
      const validCount = [...evaluations.values()].filter((entry) => entry.isValidContradiction).length;
      const presetBudget = capabilities.crackBudgets?.[d.settings?.generationPreset];
      const sourceDialogue = dialogues.get(challenge.dialogueId);
      const alternativeValid = [...evaluations.values()].some((entry) => entry.isValidContradiction &&
        (entry.evidenceId !== challenge.correctEvidenceId || entry.testimonyFragmentId !== challenge.testimonyFragmentId));
      return `<article class="v3-ai-review aai-crack">
        ${panelHead(`Crack ${String(challenge.order || '?')} ${challenge.isSignature ? '· SIGNATURE' : ''}`, `<span class="chip aai-code-chip">${escapeHtml(challenge.challengeId)}</span>`, 4)}
        ${alternativeValid ? '<p class="notice notice-bad">Warning: the independent reviewer found an alternative valid pair.</p>' : ''}
        <p class="muted small"><strong>${fragmentIds.length}T × ${evidenceIds.length}E = ${pairCount} pairs</strong> · valid ${validCount} · reviewed ${evaluations.size}/${pairCount}${presetBudget ? ` · budget ${presetBudget.maxPairsPerCrack}/Crack, ${presetBudget.maxPairsPerCase}/case` : ''}</p>
        <p><strong>Source answer:</strong> ${escapeHtml(sourceDialogue?.answer || '')}</p>
        <div class="table-scroll"><table class="admin-table v3-pair-matrix">
          <thead><tr><th>Evidence / testimony</th>${fragmentIds.map((id) => `<th>${escapeHtml(fragments.get(id)?.text || id)}</th>`).join('')}</tr></thead>
          <tbody>${evidenceIds.map((evidenceId) => {
            const clue = clues.get(evidenceId);
            const item = items.get(clue?.source);
            const puzzle = puzzles.get(clue?.source);
            const interaction = interactions.get(clue?.source);
            const acquisition = clue?.acquisitionMethod || (String(clue?.sourceType).toLowerCase() === 'camera' ? 'CAMERA_CAPTURE' : 'LEGACY_DERIVED');
            const sourceLabel = item?.name || puzzle?.prompt || interaction?.type || clue?.source || 'unknown';
            return `<tr><th>${escapeHtml(clue?.title || evidenceId)}<br><span class="chip">${escapeHtml(acquisition)}</span><br><span class="muted small">Source: ${escapeHtml(sourceLabel)} (${escapeHtml(clue?.source || 'unknown')})</span>${clue?.content ? `<br><span class="muted small">${escapeHtml(clue.content)}</span>` : ''}</th>
              ${fragmentIds.map((fragmentId) => {
                const evaluation = evaluations.get(`${evidenceId}\u001f${fragmentId}`);
                const authoredCorrect = evidenceId === challenge.correctEvidenceId && fragmentId === challenge.testimonyFragmentId;
                const reviewerSelected = evaluation?.isValidContradiction === true;
                const verdict = evaluation ? `${evaluation.isValidContradiction ? 'Valid' : 'Invalid'} ${Math.round((evaluation.confidence || 0) * 100)}%` : 'Not reviewed';
                const classes = [authoredCorrect ? 'v3-pair-correct' : '', reviewerSelected ? 'v3-pair-reviewer-selected' : ''].filter(Boolean).join(' ');
                return `<td class="${classes}"><strong>${authoredCorrect ? 'AUTHORED CORRECT' : 'Not authored'}${reviewerSelected ? ' · REVIEWER SELECTED' : ''}</strong><br><span class="small">${escapeHtml(verdict)}</span>${evaluation?.reasonCode ? `<br><span class="chip">${escapeHtml(reasonLabel(evaluation.reasonCode))}</span>` : ''}${evaluation?.reason ? `<br><span class="muted small">${escapeHtml(evaluation.reason)}</span>` : ''}</td>`;
              }).join('')}</tr>`;
          }).join('')}</tbody>
        </table></div>
        <p><strong>Success:</strong> ${escapeHtml(challenge.successResponse || '')}</p>
        <p><strong>Failure:</strong> ${escapeHtml(challenge.failureResponse || '')}</p>
        <p><strong>Reveal:</strong> ${escapeHtml(challenge.revealTitle || '')} — ${escapeHtml((challenge.unlockClueIds || []).map((id) => clues.get(id)?.content || id).join(', '))}</p>
      </article>`;
    }).join('');

    return `<section class="v3-ai-review-list aai-panel">${panelHead('V3 Crack matrices', `<span class="chip ${d.v3SemanticReview?.status === 'PASSED' ? 'chip-ok' : 'chip-bad'}">${escapeHtml(d.v3SemanticReview?.status || 'NOT_RUN')}</span>`)}${panels}</section>`;
  }

  function v3PublishGatePanel(d) {
    if (!isV3Draft(d)) return '';
    const deterministicValid = d.hasGeneratedJson
      ? d.status !== STATUS_GENERATED_INVALID && !(d.validationErrors?.length)
      : null;
    const gate = v3PublishGate(d, capabilities, deterministicValid);
    return `<section class="notice ${gate.canPublish ? 'notice-ok' : 'notice-bad'} v3-publish-gate aai-panel">
      ${panelHead(tr('V3 publish gate', 'Điều kiện xuất bản V3'), `<span class="chip ${gate.canPublish ? 'chip-ok' : 'chip-bad'}">${gate.canPublish ? tr('READY', 'SẴN SÀNG') : tr('BLOCKED', 'CHƯA ĐẠT')}</span>`)}
      <ul class="v3-gate-list aai-checks">${gate.checks.map((check) => {
    const text = gateCheckText(check);
    return `<li class="aai-check ${check.passed ? 'v3-gate-pass' : 'v3-gate-fail'}">
          <span class="aai-check-mark" aria-hidden="true">${check.passed ? GATE_PASS_ICON : GATE_FAIL_ICON}</span>
          <span class="aai-check-text"><strong><span class="aai-sr">${check.passed ? 'PASS' : 'BLOCK'} · </span>${escapeHtml(text.label)}</strong><span>${escapeHtml(text.detail)}</span></span>
        </li>`;
  }).join('')}</ul>
    </section>`;
  }

  /** The story premise. The draft head above already shows its title, so it is repeated only when it differs. */
  function previewCard(preview, draftTitle) {
    const fact = (label, value) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
    const pending = tr('Pending', 'Chưa có');
    return `
    <section class="aai-panel aai-premise" data-ai-premise>
      ${panelHead(tr('Story premise', 'Tiền đề vụ án'))}
      ${preview.title && preview.title !== draftTitle ? `<p class="aai-premise-name">${escapeHtml(preview.title)}</p>` : ''}
      ${preview.summary ? `<p class="aai-premise-summary">${escapeHtml(preview.summary)}</p>` : ''}
      <dl class="aai-premise-facts">
        ${fact(tr('Setting', 'Bối cảnh'), preview.setting || pending)}
        ${fact(tr('Opening incident', 'Sự việc mở đầu'), preview.openingIncident || pending)}
        ${fact(tr('Tone', 'Sắc thái'), preview.tone || pending)}
        ${fact(tr('Player promise', 'Điều người chơi sẽ trải nghiệm'), preview.playerPromise || pending)}
        ${preview.keyLocations?.length ? fact(tr('Locations', 'Địa điểm'), preview.keyLocations.join(', ')) : ''}
        ${preview.suspectTeasers?.length ? fact(tr('Suspects', 'Nghi phạm'), preview.suspectTeasers.join(', ')) : ''}
      </dl>
    </section>`;
  }

  function updateProgress(status, overrideDetail = '') {
    const panel = qs('#generation-progress', app);
    if (!panel) return;
    currentProgressStatus = status;

    const state = PROGRESS_STATES[status] || {
      percent: 5,
      title: 'Generating case',
      detail: status || 'Waiting for the backend.',
    };
    const elapsed = runStartedAt ? Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)) : 0;
    const detail = overrideDetail || localizedPair(state.detail);
    const fill = qs('#generation-progress-fill', panel);
    const track = panel.querySelector('[role="progressbar"]');

    panel.hidden = false;
    qs('#generation-progress-title', panel).textContent = localizedPair(state.title);
    qs('#generation-progress-percent', panel).textContent = `${state.percent}%`;
    qs('#generation-progress-detail', panel).textContent = `${detail} ${tr('Elapsed', 'Đã chạy')}: ${elapsed}s.`;
    fill.style.width = `${state.percent}%`;
    track.setAttribute('aria-valuenow', String(state.percent));
    panel.classList.toggle('generation-progress-error', status === 'GENERATED_INVALID');
  }

  function stopPolling() {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function startProgressClock() {
    if (progressClock) window.clearInterval(progressClock);
    progressClock = window.setInterval(() => {
      if (!disposed && runStartedAt) updateProgress(currentProgressStatus);
    }, 1000);
  }

  function stopProgressClock() {
    if (progressClock) window.clearInterval(progressClock);
    progressClock = null;
  }

  function startPolling(draftId, version) {
    stopPolling();

    const poll = async () => {
      if (disposed || version !== runVersion) return;
      try {
        const current = await aiCaseApi.draft(draftId);
        if (disposed || version !== runVersion) return;
        updateProgress(current.status);
        if (isTerminalDraft(current)) {
          stopPolling();
          stopProgressClock();
          if (current.status === STATUS_GENERATED_INVALID || current.status === STATUS_TRUTH_INVALID) {
            creationError = { code: current.lastGenerationErrorCode, message: tr('Generation failed. Review the draft details below before retrying.', 'Tạo vụ án thất bại. Hãy kiểm tra chi tiết bản nháp bên dưới trước khi thử lại.') };
          }
          await loadDraftList();
          if (disposed || version !== runVersion) return;
          draw(current);
          return;
        }
      } catch (error) {
        if (disposed || version !== runVersion) return;
        stopPolling();
        stopProgressClock();
        pollingError = { error, draftId };
        renderCreationStatus();
        return;
      }
      if (!disposed && version === runVersion) pollTimer = window.setTimeout(poll, 1500);
    };

    pollTimer = window.setTimeout(poll, 500);
  }

  function bind() {
    app.querySelector('[data-open-presentation]')?.addEventListener('click', () => {
      const host = app.querySelector('[data-presentation-host]');
      if (host) disposePresentation = mountPresentationEditor(host, host.dataset.presentationHost);
    });
    const presetSelect = qs('#ai-preset-select', app);
    const languageSelect = qs('#ai-language-select', app);
    const caseTypeSelect = qs('#ai-case-type-select', app);
    const crackToggle = qs('#ai-include-crack', app);
    const crackBudgetText = qs('#ai-crack-budget', app);
    const presetHelp = qs('#ai-preset-help', app);
    const layout = qs('.aai-layout', app);
    const syncCrackProfile = () => {
      const presetKey = PRESETS[form.preset] ? form.preset : 'NORMAL_RANDOM';
      const confrontationHelp = presetKey === 'SHORT_DEMO'
        ? form.includeCrack
          ? tr('The one confrontation uses paired testimony and evidence through Crack the Lie; every other demo mechanic stays required.', 'Đối chất duy nhất dùng cặp lời khai và chứng cứ qua Phá Vỡ Lời Dối; các cơ chế thử còn lại vẫn bắt buộc.')
          : tr('The one confrontation uses the standard flow. Crack the Lie remains optional.', 'Đối chất duy nhất dùng luồng thông thường. Phá Vỡ Lời Dối vẫn là lựa chọn tùy chọn.')
        : form.includeCrack
          ? tr('Crack the Lie will be added on top of this preset.', 'Crack the Lie sẽ được thêm trên cấu hình này.')
          : '';
      presetHelp.textContent = `${presetDescription(presetKey)}${confrontationHelp ? ` ${confrontationHelp}` : ''}`;
      if (crackBudgetText) crackBudgetText.textContent = crackBudget(presetKey, capabilities.crackBudgets);
      // The "V3 · Crack" pill names the feature and stays visible (as in the design); the switch shows the state.
    };
    syncCrackProfile();
    presetSelect?.addEventListener('change', () => {
      applyPreset(presetSelect.value);
      syncCrackProfile();
    });
    crackToggle?.addEventListener('change', () => {
      form.includeCrack = crackToggle.checked;
      syncCrackProfile();
      syncForm();
      renderCreationStatus();
    });
    languageSelect?.addEventListener('change', () => {
      form.language = languageSelect.value === 'vi' ? 'vi' : 'en';
      try { window.localStorage.setItem('sirlocked.aiCaseLanguage', form.language); } catch { /* remembering is optional */ }
    });
    caseTypeSelect?.addEventListener('change', () => {
      form.caseType = CASE_TYPES[caseTypeSelect.value] ? caseTypeSelect.value : 'RANDOM';
      try { window.localStorage.setItem('sirlocked.aiCaseType', form.caseType); } catch { /* remembering is optional */ }
    });

    // The preset cards, language segment and case-type pills are radios mirroring the hidden <select>s:
    // a radio sets its select and fires its "change" (so the handlers above run); a select change moves the radio.
    for (const [select, name] of [[presetSelect, 'aai-preset'], [languageSelect, 'aai-language'], [caseTypeSelect, 'aai-case-type']]) {
      if (!select) continue;
      const radios = [...app.querySelectorAll(`input[type="radio"][name="${name}"]`)];
      radios.forEach((radio) => radio.addEventListener('change', () => {
        if (!radio.checked || select.value === radio.value) return;
        select.value = radio.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }));
      select.addEventListener('change', () => {
        radios.forEach((radio) => { radio.checked = radio.value === select.value; });
        syncForm();
      });
    }

    // Every other control writes straight into `form`; one listener per event type covers the cards and the summary.
    const radioFields = {
      'aai-stages': ['stageCount', Number],
      'aai-difficulty': ['difficulty', String],
      'aai-minutes': ['playMinutes', Number],
      'aai-content': ['contentLevel', String],
      'aai-suspects': ['suspectCount', Number],
      'aai-weather': ['weather', String],
      'aai-time': ['timeOfDay', String],
      'aai-review': ['reviewMode', String],
    };
    layout?.addEventListener('change', (event) => {
      const control = event.target;
      if (control.type === 'radio' && radioFields[control.name]) {
        if (!control.checked) return;
        const [key, cast] = radioFields[control.name];
        form[key] = cast(control.value);
        clearFieldError(key);
        if (key === 'suspectCount' && form.npcIds.length <= form.suspectCount + EXTRA_NPCS) clearFieldError('npcIds');
        if (key === 'contentLevel') {
          const help = app.querySelector('#ai-content-help');
          if (help) help.textContent = pairLabel(CONTENT_LEVEL_HELP, form.contentLevel);
        }
        if (key === 'reviewMode') renderReviewSteps();
        syncForm();
        return;
      }
      if (control.id === 'ai-tone-lock') form.tone = control.value;
      else if (control.id === 'ai-mechanic-lock') form.mechanic = control.value;
      else if (control.id === 'ai-pixellab-cap') {
        form.pixelLabCap = Number(control.value);
        clearFieldError('pixelLabCap');
      } else return;
      syncForm();
    });
    layout?.addEventListener('input', (event) => {
      const control = event.target;
      if (control.id === 'ai-creator-direction') {
        // maxlength stops typing and pasting; a value set by script can still be longer.
        if (control.value.length > MAX_IDEA) control.value = control.value.slice(0, MAX_IDEA);
        form.idea = control.value;
        control.dataset.touched = '1';
        clearFieldError('prompt');
        syncCounters();
      } else if (control.id === 'ai-character-notes') {
        if (control.value.length > MAX_CHARACTER_NOTES) control.value = control.value.slice(0, MAX_CHARACTER_NOTES);
        form.characterNotes = control.value;
        clearFieldError('characterNotes');
        syncCounters();
      }
    });
    // Clicking or tabbing into the idea puts the caret where the creator wants a hint inserted.
    qs('#ai-creator-direction', app)?.addEventListener('focus', (event) => { event.target.dataset.touched = '1'; });
    layout?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-world], [data-location-kind], [data-location], [data-npc], [data-idea-hint], [data-reload-library]');
      if (!target || !layout.contains(target)) return;
      if (target.dataset.world) selectWorld(target.dataset.world);
      else if (target.dataset.locationKind !== undefined) {
        form.locationKind = target.dataset.locationKind;
        app.querySelectorAll('[data-location-kind]').forEach((button) => button.setAttribute('aria-pressed', String(button === target)));
        const grid = app.querySelector('#ai-location-grid');
        if (grid) grid.innerHTML = locationGridHtml();
      } else if (target.dataset.location) toggleLocation(target);
      else if (target.dataset.npc) toggleNpc(target);
      else if (target.dataset.ideaHint) insertIdeaHint(target.dataset.ideaHint);
      else if (target.hasAttribute('data-reload-library')) {
        target.disabled = true;
        void loadLibrary().then(() => {
          if (disposed) return;
          const worlds = app.querySelector('.aai-worlds');
          if (worlds) worlds.innerHTML = WORLDS.map(worldButton).join('');
          renderPickers();
          syncForm();
        });
      }
    });

    qs('#ai-settings-form', app)?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveSettings();
    });

    qs('#quick-create-btn', app).addEventListener('click', () => void submitOrder());

    app.querySelectorAll('[data-view]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const version = ++runVersion;
        stopPolling();
        stopProgressClock();
        pollingError = null;
        try {
          const draft = await aiCaseApi.draft(btn.dataset.view);
          if (disposed || version !== runVersion) return;
          draw(draft);
          if (!isTerminalDraft(draft)) {
            runStartedAt = Date.now();
            startProgressClock();
            startPolling(draft.draftId, version);
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
          if (disposed || version !== runVersion) return;
          toast(aiErrorText(err), 'error');
        }
      }));

    app.querySelectorAll('[data-continue]').forEach((btn) =>
      btn.addEventListener('click', () => continueDraft(btn.dataset.continue, btn)));

    app.querySelectorAll('[data-cancel-draft]').forEach((btn) =>
      btn.addEventListener('click', () => cancelDraft(btn.dataset.cancelDraft, btn)));

    app.querySelectorAll('[data-playtest-draft]').forEach((btn) =>
      btn.addEventListener('click', () => startPlaytest(btn.dataset.playtestDraft, btn)));

    app.querySelectorAll('[data-approve-order]').forEach((btn) =>
      btn.addEventListener('click', () => decideOrder(btn.dataset.approveOrder, btn, true)));

    app.querySelectorAll('[data-reject-order]').forEach((btn) =>
      btn.addEventListener('click', () => decideOrder(btn.dataset.rejectOrder, btn, false)));

    app.querySelectorAll('[data-retry-json]').forEach((btn) =>
      btn.addEventListener('click', () => retryFailedDraft(btn.dataset.retryJson, btn, 'json')));

    app.querySelectorAll('[data-regenerate-failed-assets]').forEach((btn) =>
      btn.addEventListener('click', () => retryFailedDraft(btn.dataset.regenerateFailedAssets, btn, 'assets')));

    app.querySelectorAll('[data-approve-story]').forEach((btn) =>
      btn.addEventListener('click', () => approveStory(btn.dataset.approveStory, btn)));

    app.querySelectorAll('[data-approve-truth]').forEach((btn) =>
      btn.addEventListener('click', () => approveTruth(btn.dataset.approveTruth, btn)));

    app.querySelectorAll('[data-repair-truth]').forEach((btn) =>
      btn.addEventListener('click', () => repairTruth(btn.dataset.repairTruth, btn)));

    app.querySelectorAll('[data-continue-truth-repair]').forEach((btn) =>
      btn.addEventListener('click', () => repairTruth(btn.dataset.continueTruthRepair, btn, true)));

    app.querySelectorAll('[data-accept-truth-repair]').forEach((btn) =>
      btn.addEventListener('click', () => resolveTruthRepair(btn.dataset.acceptTruthRepair, btn, true)));

    app.querySelectorAll('[data-reject-truth-repair]').forEach((btn) =>
      btn.addEventListener('click', () => resolveTruthRepair(btn.dataset.rejectTruthRepair, btn, false)));

    app.querySelectorAll('[data-approve-full-logic]').forEach((btn) =>
      btn.addEventListener('click', () => approveGate(btn.dataset.approveFullLogic, btn, 'full-logic')));

    app.querySelectorAll('[data-approve-scene-layout]').forEach((btn) =>
      btn.addEventListener('click', () => approveGate(btn.dataset.approveSceneLayout, btn, 'scene-layout')));

    app.querySelectorAll('[data-publish-draft]').forEach((btn) =>
      btn.addEventListener('click', () => publishDraft(btn.dataset.publishDraft, btn)));

    app.querySelectorAll('[data-repair-full-logic]').forEach((btn) =>
      btn.addEventListener('click', () => repairFullLogic(btn.dataset.repairFullLogic, btn)));

    app.querySelectorAll('[data-accept-repair]').forEach((btn) =>
      btn.addEventListener('click', () => acceptRepair(btn.dataset.acceptRepair, btn)));

    app.querySelectorAll('[data-reject-repair]').forEach((btn) =>
      btn.addEventListener('click', () => rejectRepair(btn.dataset.rejectRepair, btn)));

    app.querySelectorAll('[data-replace-json]').forEach((btn) =>
      btn.addEventListener('click', () => replaceDraftJson(btn.dataset.replaceJson, btn)));
  }

  function presetLabel(value) {
    const preset = PRESETS[value] ?? PRESETS.NORMAL_RANDOM;
    return tr(preset.label, preset.labelVi);
  }

  function presetDescription(value) {
    const preset = PRESETS[value] ?? PRESETS.NORMAL_RANDOM;
    return tr(preset.description, preset.descriptionVi);
  }

  /** "Send order to Claude": the order goes into the queue (ADMIN) or waits for an admin (VIP). */
  async function submitOrder() {
    captureCreationForm();
    if (submitDisabled()) return;
    creating = true;
    pollingError = null;
    stopPolling();
    for (const field of Object.keys(fieldErrors)) setFieldError(field, '');
    const button = qs('#quick-create-btn', app);
    const version = ++runVersion;
    let activeDraftId = null;
    const idempotencyKey = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runStartedAt = Date.now();
    button.disabled = true;
    const label = button.querySelector('[data-create-label]');
    if (label) label.textContent = tr('Sending order…', 'Đang gửi đơn…');
    updateProgress('GENERATING_STORY');
    // The progress sits above the form; on a phone the button is far below it.
    qs('#generation-progress', app)?.scrollIntoView({ block: 'nearest' });
    startProgressClock();

    try {
      const previewDraft = await aiCaseApi.generate(
        form.idea.trim(),
        form.stageCount,
        form.difficulty,
        form.preset,
        form.language,
        form.includeCrack,
        form.caseType,
        idempotencyKey,
        // The setting lock is gone: places come from the world's library (order.locationIds).
        { settingId: '', toneId: form.tone, investigationMechanicId: form.mechanic },
        buildOrder());
      activeDraftId = previewDraft.draftId;
      if (disposed || version !== runVersion) return;
      creating = false;
      creationError = null;
      updateProgress(previewDraft.status);
      await Promise.all([loadDraftList(), loadQuota()]);
      if (disposed || version !== runVersion) return;
      if (isTerminalDraft(previewDraft)) {
        stopProgressClock();
        if (previewDraft.orderStatus === 'AWAITING_OWNER_APPROVAL') {
          toast(tr('Order sent. It waits for the owner to approve it.', 'Đã gửi đơn. Đơn đang chờ Yen duyệt.'), 'success', 7000);
        } else if (previewDraft.status === STATUS_AWAITING_APPROVAL) {
          toast(tr('Story preview is ready for manual approval.', 'Tiền đề đã sẵn sàng để duyệt thủ công.'), 'success', 7000);
        } else if (previewDraft.status !== 'CANCELLED') {
          creationError = { code: previewDraft.lastGenerationErrorCode, message: tr('Generation failed. Review the draft details below before retrying.', 'Tạo vụ án thất bại. Hãy kiểm tra chi tiết bản nháp bên dưới trước khi thử lại.') };
        }
      } else {
        startPolling(activeDraftId, version);
        toast(tr('Order sent to Claude.', 'Đã gửi đơn cho Claude.'), 'success', 5000);
      }
      draw(previewDraft);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      creating = false;
      creationError = err;
      stopPolling();
      stopProgressClock();
      let latest = null;
      if (activeDraftId) {
        try {
          latest = await aiCaseApi.draft(activeDraftId);
        } catch {
          /* fall back to the normal page if the failed draft cannot be reloaded */
        }
      }
      await Promise.all([loadDraftList(), err?.errors?.code === 'AI_WEEKLY_LIMIT' ? loadQuota() : null]);
      if (disposed || version !== runVersion) return;
      draw(latest || visibleDraft);
      // The redraw keeps every choice; the refusal now sits under the field it is about.
      const fields = showServerFieldErrors(err);
      if (fields.length) focusField(fields[0]);
    }
  }

  /** ADMIN: the VIP weekly limit. Only the settings card is redrawn, so the order being written stays as it is. */
  async function saveSettings() {
    const input = qs('#ai-vip-weekly-limit', app);
    if (!input || savingSettings) return;
    const raw = input.value.trim();
    const value = Number(raw);
    const status = qs('#ai-settings-status', app);
    if (raw === '' || !Number.isInteger(value) || value < 0 || value > 50) {
      status.textContent = localizedPair(CREATION_ERROR_LABELS.AI_SETTINGS_INVALID);
      status.classList.add('is-error');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    savingSettings = true;
    settingsNotice = '';
    redrawSettings();
    try {
      settings = await aiCaseApi.saveSettings(value);
      settingsError = null;
      settingsNotice = tr(`Saved: each VIP may send ${settings.vipWeeklyOrderLimit} orders a week.`, `Đã lưu: mỗi VIP được gửi ${settings.vipWeeklyOrderLimit} đơn mỗi tuần.`);
    } catch (error) {
      settingsError = error;
      settingsNotice = '';
    }
    savingSettings = false;
    if (disposed) return;
    redrawSettings();
    qs('#ai-vip-weekly-limit', app)?.focus();
  }

  function redrawSettings() {
    const card = app.querySelector('.aai-settings');
    if (!card) return;
    const fresh = document.createElement('div');
    fresh.innerHTML = settingsCardHtml();
    const next = fresh.firstElementChild;
    card.replaceWith(next);
    next.querySelector('#ai-settings-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveSettings();
    });
  }

  /**
   * Asks for the reason of a rejection in a dialog of the page (never the browser's prompt). Resolves to whether the
   * order was rejected. The VIP sees the reason.
   */
  function rejectOrderDialog(draftId) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ac-dialog aai-reject-dialog';
      dialog.setAttribute('aria-labelledby', 'aai-reject-title');
      dialog.setAttribute('aria-describedby', 'aai-reject-sub');
      dialog.innerHTML = `
        <header class="ac-dialog-head">
          <div class="ac-dialog-heading">
            <h2 id="aai-reject-title">${tr('Reject this VIP order', 'Từ chối đơn VIP')}</h2>
            <p class="ac-dialog-sub" id="aai-reject-sub">${tr('The VIP sees this reason. A rejected order no longer counts against their week.', 'VIP sẽ thấy lý do này. Đơn bị từ chối không tính vào số đơn trong tuần của họ.')}</p>
          </div>
          <button type="button" class="ac-dialog-close" data-reject-cancel aria-label="${tr('Close', 'Đóng')}">${icon('x', 20)}</button>
        </header>
        <form class="ac-dialog-body" novalidate>
          <label class="ac-field"><span>${tr('Reason', 'Lý do')}</span>
            <textarea class="field-input" name="reason" rows="3" maxlength="500" required aria-describedby="aai-reject-error"></textarea>
          </label>
          <p class="aai-field-error" id="aai-reject-error" role="alert" hidden></p>
          <div class="ac-dialog-actions">
            <button type="button" class="btn btn-ghost" data-reject-cancel>${tr('Cancel', 'Hủy')}</button>
            <button type="submit" class="btn ac-btn-danger" data-reject-confirm>${tr('Reject order', 'Từ chối đơn')}</button>
          </div>
        </form>`;
      document.body.append(dialog);
      const formNode = dialog.querySelector('form');
      const reason = formNode.elements.reason;
      const error = dialog.querySelector('#aai-reject-error');
      const confirm = dialog.querySelector('[data-reject-confirm]');
      let busy = false;
      let settled = false;
      const finish = (rejected) => {
        if (settled) return;
        settled = true;
        pageAbort.signal.removeEventListener('abort', cancel);
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(rejected);
      };
      const cancel = () => finish(false);
      pageAbort.signal.addEventListener('abort', cancel, { once: true });
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if (!busy) cancel();
      });
      dialog.querySelectorAll('[data-reject-cancel]').forEach((button) => button.addEventListener('click', () => { if (!busy) cancel(); }));
      formNode.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) return;
        const text = reason.value.trim();
        if (!text) {
          error.textContent = tr('Write a reason for the VIP.', 'Hãy ghi lý do cho VIP.');
          error.hidden = false;
          reason.setAttribute('aria-invalid', 'true');
          reason.focus();
          return;
        }
        busy = true;
        confirm.disabled = true;
        error.hidden = true;
        try {
          await aiCaseApi.rejectOrder(draftId, text);
          finish(true);
        } catch (failure) {
          if (settled) return;
          error.textContent = aiErrorText(failure);
          error.hidden = false;
          busy = false;
          confirm.disabled = false;
        }
      });
      dialog.showModal();
      reason.focus();
    });
  }

  /** Admin decision on a VIP order. Approval queues it for Claude; rejection asks for a reason in the page. */
  async function decideOrder(draftId, button, approve) {
    const version = ++runVersion;
    button.disabled = true;
    try {
      let draft = null;
      if (approve) {
        draft = await aiCaseApi.approveOrder(draftId);
      } else {
        const rejected = await rejectOrderDialog(draftId);
        if (disposed || version !== runVersion) return;
        if (!rejected) {
          button.disabled = false;
          button.focus();
          return;
        }
        draft = visibleDraft?.draftId === draftId ? await aiCaseApi.draft(draftId).catch(() => null) : null;
      }
      if (disposed || version !== runVersion) return;
      await loadDraftList();
      if (disposed || version !== runVersion) return;
      draw(visibleDraft?.draftId === draftId ? (draft || visibleDraft) : visibleDraft);
      toast(approve ? tr('Order approved; it now waits for Claude.', 'Đã duyệt đơn; đơn đang chờ Claude.') : tr('Order rejected.', 'Đã từ chối đơn.'), 'success');
    } catch (error) {
      if (disposed || version !== runVersion) return;
      button.disabled = false;
      toast(aiErrorText(error), 'error');
    }
  }

  /** The order as the creator wrote it, in one line, for the draft card. */
  function orderFacts(order) {
    if (!order) return '';
    const facts = [
      worldLabel(order.world),
      order.locationIds?.length ? tr(`${order.locationIds.length} places`, `${order.locationIds.length} địa điểm`) : '',
      tr(`${order.suspectCount} suspects`, `${order.suspectCount} nghi phạm`),
      order.npcIds?.length ? tr(`${order.npcIds.length} NPCs`, `${order.npcIds.length} NPC`) : '',
      pairLabel(WEATHERS, order.weather, order.weather),
      pairLabel(TIMES_OF_DAY, order.timeOfDay, order.timeOfDay),
      tr(`${order.playMinutes} min`, `${order.playMinutes} phút`),
      pairLabel(CONTENT_LEVELS, order.contentLevel, order.contentLevel),
      isAdmin ? (order.pixelLabCap === 0 ? tr('library pictures only', 'chỉ ảnh thư viện') : tr(`≤ ${order.pixelLabCap} PixelLab`, `≤ ${order.pixelLabCap} lượt PixelLab`)) : '',
      isAdmin ? pairLabel(REVIEW_MODES, order.reviewMode, order.reviewMode) : '',
    ].filter(Boolean);
    return facts.map(escapeHtml).join(' · ');
  }

  /** Order line of the draft card: status with times, the order itself, the step Claude is on. */
  function orderSummary(d) {
    if (!d.orderStatus) return '';
    const history = (d.orderStatusHistory || []).slice(-4)
      .map((change) => `${escapeHtml(orderStatusLabel(change.status))} · ${escapeHtml(formatTime(change.at))}`)
      .join(' → ');
    const facts = orderFacts(d.order);
    const waiting = d.claudeWait ? `<p class="aai-note" data-claude-wait>${tr('Waiting for Claude on step', 'Đang chờ Claude ở bước')} <code>${escapeHtml(d.claudeWait.step)}</code></p>` : '';
    const rejected = d.orderRejectReason ? `<p class="aai-note">${tr('Rejection reason', 'Lý do từ chối')}: ${escapeHtml(d.orderRejectReason)}</p>` : '';
    return `<div class="aai-order"><p class="aai-draft-meta">${tr('Order', 'Đơn')}: ${orderStatusPill(d)} ${orderButtons(d)}</p>${facts ? `<p class="aai-note" data-order-facts>${facts}</p>` : ''}${history ? `<p class="muted small">${history}</p>` : ''}${waiting}${rejected}</div>`;
  }

  /** The bot's report.md (ADMIN), rendered from Markdown without ever inserting the report's own HTML. */
  function bridgeReportPanel(d) {
    if (!isAdmin || !d.bridgeReport) return '';
    const updated = d.bridgeReportUpdatedAt ? ` · ${escapeHtml(formatTime(d.bridgeReportUpdatedAt))}` : '';
    return `<details class="json-details aai-panel aai-disclosure aai-report-panel" data-bridge-report open>
      <summary>${tr('Bot report (report.md)', 'Báo cáo của bot (report.md)')}<span class="aai-report-time">${updated}</span></summary>
      <div class="aai-report">${renderSafeMarkdown(d.bridgeReport)}</div>
    </details>`;
  }

  /**
   * Asks in a dialog of the page (never the browser's confirm) whether to cancel a draft. Resolves to true only when the
   * admin or VIP confirms; Esc, the close button and "Keep the draft" resolve to false.
   */
  function confirmCancelDialog() {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'ac-dialog aai-cancel-dialog';
      dialog.setAttribute('aria-labelledby', 'aai-cancel-title');
      dialog.setAttribute('aria-describedby', 'aai-cancel-sub');
      dialog.innerHTML = `
        <header class="ac-dialog-head">
          <div class="ac-dialog-heading">
            <h2 id="aai-cancel-title">${tr('Cancel this draft?', 'Hủy bản nháp này?')}</h2>
            <p class="ac-dialog-sub" id="aai-cancel-sub">${tr(
              "Generation stops and open Claude requests are closed. Cancelling does not reset today's creation limit.",
              'Các bước tạo tiếp theo sẽ dừng và các yêu cầu đang chờ Claude sẽ bị đóng. Hủy bản nháp không đặt lại hạn mức tạo hôm nay.'
            )}</p>
          </div>
          <button type="button" class="ac-dialog-close" data-cancel-keep aria-label="${tr('Close', 'Đóng')}">${icon('x', 20)}</button>
        </header>
        <div class="ac-dialog-body">
          <div class="ac-dialog-actions">
            <button type="button" class="btn btn-ghost" data-cancel-keep>${tr('Keep the draft', 'Giữ bản nháp')}</button>
            <button type="button" class="btn ac-btn-danger" data-cancel-confirm>${tr('Cancel draft', 'Hủy bản nháp')}</button>
          </div>
        </div>`;
      document.body.append(dialog);
      let settled = false;
      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        pageAbort.signal.removeEventListener('abort', keep);
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(confirmed);
      };
      const keep = () => finish(false);
      pageAbort.signal.addEventListener('abort', keep, { once: true });
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        keep();
      });
      dialog.querySelectorAll('[data-cancel-keep]').forEach((button) => button.addEventListener('click', keep));
      dialog.querySelector('[data-cancel-confirm]').addEventListener('click', () => finish(true));
      dialog.showModal();
      // The safe choice has the focus, so Enter never cancels a draft by accident.
      dialog.querySelector('.ac-dialog-actions [data-cancel-keep]')?.focus();
    });
  }

  /** "Chơi thử": opens (or reopens) the private playtest room of an imported draft and goes to its lobby. */
  async function startPlaytest(draftId, button) {
    button.disabled = true;
    try {
      const room = await aiCaseApi.playtest(draftId);
      if (disposed) return;
      navigate(`/lobby/${encodeURIComponent(room.roomId)}`);
    } catch (error) {
      if (disposed) return;
      button.disabled = false;
      toast(error?.errors?.code === 'PLAYTEST_FORBIDDEN'
        ? tr('Only an admin or the author of this draft can playtest it.', 'Chỉ ADMIN hoặc tác giả bản nháp mới chơi thử được.')
        : error?.errors?.code === 'PLAYTEST_NOT_IMPORTED'
          ? tr('This draft has not been imported as a case yet.', 'Bản nháp này chưa được import thành vụ án.')
          : aiErrorText(error), 'error');
    }
  }

  async function cancelDraft(draftId, button) {
    button.disabled = true;
    const confirmed = await confirmCancelDialog();
    if (disposed) return;
    if (!confirmed) {
      button.disabled = false;
      button.focus();
      return;
    }
    const version = ++runVersion;
    stopPolling();
    stopProgressClock();
    pollingError = null;
    button.disabled = true;
    button.textContent = tr('Cancelling…', 'Đang hủy…');
    try {
      const draft = await aiCaseApi.cancelDraft(draftId);
      if (disposed || version !== runVersion) return;
      await loadDraftList();
      if (disposed || version !== runVersion) return;
      draw(draft);
      toast(tr('Draft cancelled. You can review the creation limit and try again.', 'Đã hủy bản nháp. Bạn có thể kiểm tra hạn mức tạo và thử lại.'), 'success', 7000);
    } catch (error) {
      if (disposed || version !== runVersion) return;
      creationError = error;
      draw(visibleDraft);
    }
  }

  async function approveStory(draftId, button) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = tr('Generating truth...', 'Đang tạo truth...');
    updateProgress('GENERATING_CASE_TRUTH');
    startProgressClock();
    startPolling(draftId, version);

    try {
      const draft = await aiCaseApi.approveDraft(draftId);
      if (disposed || version !== runVersion) return;
      if (!isTerminalDraft(draft)) {
        updateProgress(draft.status);
        draw(draft);
        return;
      }
      stopPolling();
      stopProgressClock();
      updateProgress(draft.status);
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      draw(draft);
      toast(draft.status === STATUS_TRUTH_AWAITING_APPROVAL
        ? tr('Case truth is ready for spoiler review.', 'Sự thật vụ án đã sẵn sàng để kiểm tra spoiler.')
        : tr('Case truth generation needs repair.', 'Sự thật vụ án cần được sửa.'), draft.status === STATUS_TRUTH_AWAITING_APPROVAL ? 'success' : 'error', 7000);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep current page if reload fails */
      }
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function approveTruth(draftId, button) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = tr('Building gameplay...', 'Đang dựng gameplay...');
    updateProgress('GENERATING_FULL_CASE');
    startProgressClock();
    startPolling(draftId, version);
    try {
      const draft = await aiCaseApi.approveTruth(draftId);
      if (disposed || version !== runVersion) return;
      if (!isTerminalDraft(draft)) {
        updateProgress(draft.status);
        draw(draft);
        return;
      }
      stopPolling();
      stopProgressClock();
      updateProgress(draft.status);
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      draw(draft);
      toast(draft.status === STATUS_FULL_LOGIC_AWAITING_APPROVAL
        ? (draft.blindReviewAssessment?.status === 'PASSED'
          ? tr('Gameplay projection passed the advisory blind review.', 'Gameplay đã vượt qua blind review tham khảo.')
          : tr('Gameplay projection is ready for admin review.', 'Gameplay đã sẵn sàng để admin kiểm tra.'))
        : tr('Gameplay projection is blocked. Review validation details.', 'Gameplay bị chặn. Hãy kiểm tra chi tiết validation.'),
      draft.status === STATUS_FULL_LOGIC_AWAITING_APPROVAL ? 'success' : 'error', 8000);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function repairTruth(draftId, button, useRepairCandidate = false) {
    const version = ++runVersion;
    stopPolling();
    runStartedAt = Date.now();
    button.disabled = true;
    app.querySelectorAll('[data-repair-truth], [data-continue-truth-repair], [data-reject-truth-repair]').forEach((action) => {
      if ([action.dataset.repairTruth, action.dataset.continueTruthRepair, action.dataset.rejectTruthRepair].includes(draftId)) action.disabled = true;
    });
    button.textContent = tr('Repairing truth...', 'Đang sửa truth...');
    startProgressClock();
    try {
      const instructionField = [...app.querySelectorAll(useRepairCandidate ? '[data-candidate-repair-instructions]' : '[data-truth-repair-instructions]')]
        .find((field) => (useRepairCandidate ? field.dataset.candidateRepairInstructions : field.dataset.truthRepairInstructions) === draftId);
      const instructions = instructionField?.value?.trim()
        || 'Repair only the invalid causal artifact and preserve every valid upstream fact.';
      const scopeField = [...app.querySelectorAll(useRepairCandidate ? '[data-candidate-repair-scope]' : '[data-truth-repair-scope]')]
        .find((field) => (useRepairCandidate ? field.dataset.candidateRepairScope : field.dataset.truthRepairScope) === draftId);
      const draft = await aiCaseApi.repairTruth(draftId, instructions, scopeField?.value || null, useRepairCandidate);
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      draw(draft);
      if (!isTerminalDraft(draft)) {
        startPolling(draftId, version);
        toast(tr('Truth repair was queued.', 'Đã xếp hàng sửa truth.'), 'success', 5000);
        return;
      }
      stopProgressClock();
      toast(draft.truthRepairStatus === 'CANDIDATE_READY'
        ? tr('Repair structure passed. Read the candidate story review before accepting.', 'Cấu trúc bản sửa hợp lệ. Hãy đọc đánh giá cốt truyện bản sửa trước khi chấp nhận.')
        : tr('Truth repair candidate is still invalid.', 'Ứng viên sửa truth vẫn chưa hợp lệ.'),
      draft.truthRepairStatus === 'CANDIDATE_READY' ? 'success' : 'error', 8000);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopProgressClock();
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      if (disposed || version !== runVersion) return;
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function resolveTruthRepair(draftId, button, accept) {
    const version = ++runVersion;
    stopPolling();
    stopProgressClock();
    button.disabled = true;
    try {
      const draft = accept
        ? await aiCaseApi.acceptTruthRepair(draftId)
        : await aiCaseApi.rejectTruthRepair(draftId);
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      draw(draft);
      toast(accept
        ? tr('Truth repair accepted; downstream artifacts were invalidated.', 'Đã chấp nhận bản sửa truth; artifact downstream đã bị đánh dấu stale.')
        : tr('Truth repair rejected.', 'Đã từ chối bản sửa truth.'), 'success', 7000);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      if (disposed || version !== runVersion) return;
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function approveGate(draftId, button, gate) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = gate === 'full-logic' ? 'Generating layout...' : 'Generating final assets...';
    updateProgress(gate === 'full-logic' ? 'GENERATING_SCENE_LAYOUT' : 'GENERATING_FINAL_ASSETS');
    startProgressClock();
    startPolling(draftId, version);

    try {
      const draft = gate === 'full-logic'
        ? await aiCaseApi.approveFullLogic(draftId)
        : await aiCaseApi.approveSceneLayout(draftId);
      if (disposed || version !== runVersion) return;
      if (!isTerminalDraft(draft)) {
        updateProgress(draft.status);
        draw(draft);
        return;
      }
      stopPolling();
      stopProgressClock();
      updateProgress(draft.status);
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      draw(draft);
      if (draft.status === STATUS_SCENE_LAYOUT_AWAITING_APPROVAL) {
        toast('Scene layout is ready for review.', 'success', 7000);
      } else if (draft.status === STATUS_READY_TO_PUBLISH) {
        toast('Final assets are ready. Publish manually when you are ready.', 'success', 7000);
      } else {
        toast('Draft advanced to the next gate.', 'info', 7000);
      }
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep current page if reload fails */
      }
      if (disposed || version !== runVersion) return;
      await loadDraftList(version);
      if (disposed || version !== runVersion) return;
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function publishDraft(draftId, button) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = 'Publishing...';
    updateProgress('IMPORTED', 'Publishing the approved draft.');
    startProgressClock();

    try {
      const published = await aiCaseApi.publishDraft(draftId, true);
      if (disposed || version !== runVersion) return;
      stopProgressClock();
      await loadDraftList();
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      draw(latest);
      toast(`"${published.title || 'Case'}" published.`, 'success', 7000);
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep current page if reload fails */
      }
      await loadDraftList();
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function repairFullLogic(draftId, button) {
    button.disabled = true;
    button.textContent = 'Repairing...';
    try {
      const draft = await aiCaseApi.repairFullLogic(
        draftId,
        'Normalize final evidence into natural scene-scale camera clues while keeping IDs and logic stable.'
      );
      await loadDraftList();
      draw(draft);
      toast(draft.repairStatus === 'CANDIDATE_READY' ? 'Repair candidate is ready.' : 'Repair candidate needs review.', 'info', 7000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      await loadDraftList();
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function acceptRepair(draftId, button) {
    button.disabled = true;
    button.textContent = 'Accepting...';
    try {
      const draft = await aiCaseApi.acceptRepair(draftId);
      await loadDraftList();
      draw(draft);
      toast('Repair accepted. Review full logic before layout generation.', 'success', 7000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      await loadDraftList();
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function rejectRepair(draftId, button) {
    button.disabled = true;
    button.textContent = 'Rejecting...';
    try {
      const draft = await aiCaseApi.rejectRepair(draftId);
      await loadDraftList();
      draw(draft);
      toast('Repair rejected. Original logic remains unchanged.', 'info', 7000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      await loadDraftList();
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function replaceDraftJson(draftId, button) {
    const editor = app.querySelector(`[data-json-editor="${CSS.escape(draftId)}"]`);
    if (!editor) return;

    let caseJson;
    try {
      caseJson = JSON.parse(editor.value);
    } catch (err) {
      toast(`Invalid JSON: ${err.message}`, 'error', 9000);
      return;
    }

    if (!window.confirm('Replace this draft JSON and reset its layout/assets? The previous JSON will be kept as a snapshot.')) return;
    button.disabled = true;
    button.textContent = 'Validating...';
    try {
      const draft = await aiCaseApi.replaceJson(draftId, caseJson);
      await loadDraftList();
      draw(draft);
      toast('Draft JSON replaced. Review full logic before regenerating v5 layout and assets.', 'success', 8000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      await loadDraftList();
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function continueDraft(draftId, button) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = 'Continuing...';
    updateProgress('GENERATING_ASSETS', 'Continuing from the saved checkpoint.');
    startProgressClock();
    startPolling(draftId, version);

    try {
      const draft = await aiCaseApi.continueDraft(draftId);
      if (disposed || version !== runVersion) return;
      if (!isTerminalDraft(draft)) {
        updateProgress(draft.status);
        draw(draft);
        return;
      }
      stopPolling();
      stopProgressClock();
      updateProgress(draft.status);
      await loadDraftList();
      draw(draft);
      const title = draft.publishedCase?.title || draft.caseTitle || draft.storyPreview?.title || 'Case';
      if (draft.status === STATUS_PUBLISHED) {
        toast(`"${title}" published.`, 'success', 7000);
      } else {
        toast('Draft continued but did not publish. Check validation details.', 'error', 9000);
      }
    } catch (err) {
      if (disposed || version !== runVersion) return;
      stopPolling();
      stopProgressClock();
      let latest = null;
      try {
        latest = await aiCaseApi.draft(draftId);
      } catch {
        /* keep the current page if the draft cannot be reloaded */
      }
      await loadDraftList();
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  async function retryFailedDraft(draftId, button, mode) {
    const version = ++runVersion;
    runStartedAt = Date.now();
    button.disabled = true;
    button.textContent = mode === 'json' ? 'Repairing JSON...' : 'Regenerating scene...';
    startProgressClock();
    startPolling(draftId, version);
    try {
      const draft = mode === 'json'
        ? await aiCaseApi.retryJson(draftId)
        : await aiCaseApi.regenerateFailedAssets(draftId);
      if (!isTerminalDraft(draft)) {
        updateProgress(draft.status);
        draw(draft);
        return;
      }
      stopPolling();
      stopProgressClock();
      await loadDraftList();
      draw(draft);
      toast(mode === 'json' ? 'JSON checkpoint repaired and revalidated.' : 'Failed scene regenerated and revalidated.', 'success', 8000);
    } catch (err) {
      const latest = await aiCaseApi.draft(draftId).catch(() => null);
      await loadDraftList();
      toast(aiErrorText(err), 'error', 9000);
      draw(latest);
    }
  }

  return () => {
    disposed = true;
    pageAbort.abort();
    disposePresentation();
    runVersion += 1;
    stopPolling();
    stopProgressClock();
  };
}
