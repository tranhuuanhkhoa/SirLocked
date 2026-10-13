import { aiCaseApi } from '../api/aiCaseApi.js';
import { session } from '../services/session.js';
import { escapeHtml, render, qs } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { tr } from '../services/i18n.js';
import { isV3, v3PublishGate } from './adminV3Gates.js';
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
const ACTIVE_QUEUE_STATES = new Set(['PENDING', 'RUNNING', 'RETRY_SCHEDULED']);
const isTerminalDraft = (draft) => draft?.status === 'CANCELLED'
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

const CREATIVE_SETTINGS = {
  manor: ['Isolated manor', 'Trang viên biệt lập'],
  railway: ['Rain-soaked railway', 'Ga xe lửa trong mưa'],
  theatre: ['Riverside theatre', 'Nhà hát ven sông'],
  clockmakers: ['Clockmakers district', 'Khu thợ đồng hồ'],
  museum: ['Private museum', 'Bảo tàng tư nhân'],
  hotel: ['Grand hotel', 'Khách sạn lớn'],
  harbor: ['Harbor warehouse', 'Kho cảng'],
  observatory: ['Mountain observatory', 'Đài quan sát trên núi'],
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
  GENERATED_INVALID: ['Generation invalid', 'Kết quả sinh không hợp lệ'],
  PUBLISHED: ['Published', 'Đã xuất bản'],
};

function localizedPair(value) {
  return Array.isArray(value) ? tr(value[0], value[1]) : value;
}

function statusLabel(status) {
  return localizedPair(STATUS_LABELS[status]) || status || tr('Unknown', 'Không xác định');
}

const CREATION_ERROR_LABELS = {
  AI_PROVIDER_UNCONFIGURED: ['AI generation is not configured on the server. Ask the administrator to configure the provider.', 'Máy chủ chưa cấu hình dịch vụ tạo AI. Hãy nhờ quản trị viên cấu hình nhà cung cấp.'],
  AI_QUOTA_UNCONFIGURED: ['AI creation limits and budget have not been enabled and configured. Ask the administrator to finish the AI setup.', 'Hạn mức và ngân sách tạo AI chưa được bật và cấu hình. Hãy nhờ quản trị viên hoàn tất thiết lập AI.'],
  AI_ASSET_STORAGE_UNCONFIGURED: ['AI asset storage is not configured. Ask the administrator to configure Cloudinary.', 'Kho lưu tài nguyên AI chưa được cấu hình. Hãy nhờ quản trị viên cấu hình Cloudinary.'],
  AI_USAGE_PRICE_REQUIRED: ['AI model pricing and per-call cost reservations are missing. Ask the administrator to complete the cost settings.', 'Chưa cấu hình giá mô hình AI và khoản dự trù cho mỗi lần gọi. Hãy nhờ quản trị viên hoàn tất thiết lập chi phí.'],
  AI_REQUEST_BUDGET_LIMIT: ['This request exceeds the trial size or output limit. No AI request was sent; review the saved draft before changing the limits.', 'Yêu cầu vượt giới hạn kích thước hoặc lượng đầu ra của đợt thử. Chưa gửi yêu cầu tới AI; hãy kiểm tra bản nháp đã lưu trước khi đổi giới hạn.'],
  AI_TRUTH_REPAIR_PENDING: ['Review and accept or reject the pending truth repair before continuing with gameplay or assets.', 'Hãy kiểm tra và chấp nhận hoặc từ chối bản sửa truth đang chờ trước khi tiếp tục gameplay hoặc tài nguyên.'],
  AI_WORKFLOW_CONFLICT: ['This draft is running or has changed. Refresh its details before trying again.', 'Bản nháp đang chạy hoặc đã thay đổi. Hãy tải lại chi tiết trước khi thử lại.'],
  AI_TRUTH_REPAIR_CANDIDATE_UNAVAILABLE: ['This repair candidate is no longer available. Refresh the draft before continuing.', 'Bản sửa này không còn khả dụng. Hãy tải lại bản nháp trước khi tiếp tục.'],
  AI_TRUTH_REPAIR_CANDIDATE_STALE: ['The current truth changed after this candidate was created. Create a new repair from the current truth.', 'Sự thật hiện tại đã thay đổi sau khi tạo bản sửa này. Hãy tạo bản sửa mới từ sự thật hiện tại.'],
  AI_TRUTH_REPAIR_CANDIDATE_UPSTREAM_INVALID: ['Earlier candidate artifacts still need repair. Choose an earlier repair scope.', 'Phần trước của bản sửa vẫn còn lỗi. Hãy chọn phạm vi sửa bắt đầu sớm hơn.'],
  UNSAFE_TRUTH_REPAIR_SCOPE: ['Choose the recommended repair scope or an earlier one so every affected artifact can be repaired.', 'Hãy chọn phạm vi sửa được khuyến nghị hoặc sớm hơn để sửa đủ các phần bị ảnh hưởng.'],
  AI_ACTIVE_DRAFT_LIMIT: ['You have reached your active-draft limit. Complete or cancel a draft in Recent AI drafts before creating another.', 'Bạn đã đạt giới hạn bản nháp đang hoạt động. Hãy hoàn tất hoặc hủy một bản nháp trong Bản nháp AI gần đây trước khi tạo vụ án khác.'],
  AI_DAILY_LIMIT: ["You have reached today's creation limit. Continue an existing draft or try again after the daily limit resets; cancellation does not reset this limit.", 'Bạn đã đạt giới hạn tạo vụ án hôm nay. Hãy tiếp tục bản nháp hiện có hoặc thử lại khi hạn mức ngày được đặt lại; hủy bản nháp không đặt lại hạn mức này.'],
  AI_GLOBAL_BUDGET_EXHAUSTED: ['The remaining AI budget cannot cover this request. Ask the administrator to review usage and the configured budget.', 'Ngân sách AI còn lại không đủ cho yêu cầu này. Hãy nhờ quản trị viên kiểm tra mức sử dụng và ngân sách đã cấu hình.'],
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
    detail: ['GPT is preparing a spoiler-free mystery outline.', 'GPT đang chuẩn bị dàn ý bí ẩn không tiết lộ đáp án.'],
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
  render(app, '<div class="page"><p class="muted">Loading AI case creator...</p></div>');

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
  const formFields = {
    'ai-preset-select': 'NORMAL_RANDOM',
    'ai-creator-direction': '',
    'ai-setting-lock': '',
    'ai-tone-lock': '',
    'ai-mechanic-lock': '',
  };
  let includeCrack = false;
  let selectedLanguage = window.localStorage.getItem('sirlocked.aiCaseLanguage') === 'vi' ? 'vi' : 'en';
  let selectedCaseType = CASE_TYPES[window.localStorage.getItem('sirlocked.aiCaseType')]
    ? window.localStorage.getItem('sirlocked.aiCaseType')
    : 'RANDOM';

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

  await Promise.all([loadCapabilities(), loadDraftList()]);
  draw();

  function creationBlocked() {
    const crackSelected = app.querySelector('#ai-include-crack')?.checked ?? includeCrack;
    return Boolean(capabilitiesError) || capabilities.canCreateDraft === false
      || (crackSelected && Array.isArray(capabilities.v3CreationBlockers) && capabilities.canCreateV3Draft === false);
  }

  function captureCreationForm() {
    for (const id of Object.keys(formFields)) {
      const field = app.querySelector(`#${id}`);
      if (field) formFields[id] = field.value;
    }
    const toggle = app.querySelector('#ai-include-crack');
    if (toggle) includeCrack = toggle.checked;
  }

  function renderCreationStatus() {
    const slot = app.querySelector('#ai-creation-status');
    if (!slot) return;
    const crackSelected = app.querySelector('#ai-include-crack')?.checked ?? includeCrack;
    const blockers = crackSelected && Array.isArray(capabilities.v3CreationBlockers)
      ? capabilities.v3CreationBlockers : capabilities.creationBlockers || [];
    const errorMarkup = (error) => `<p>${escapeHtml(aiErrorText(error))}</p>${error?.code || error?.errors?.code ? `<small>${tr('Code', 'Mã lỗi')}: <code>${escapeHtml(error.code || error.errors.code)}</code></small>` : ''}`;
    slot.innerHTML = `${creationBlocked() ? `<div class="notice notice-bad" role="alert" id="ai-readiness-error">
      <strong>${capabilitiesError ? tr('Could not check AI availability.', 'Chưa kiểm tra được trạng thái AI.') : tr('Case creation is unavailable.', 'Chưa thể tạo vụ án.')}</strong>
      ${capabilitiesError ? errorMarkup(capabilitiesError) : blockers.length ? blockers.map(errorMarkup).join('') : `<p>${tr('The server has disabled case creation. Ask the administrator to review its AI settings.', 'Máy chủ đang tắt chức năng tạo vụ án. Hãy nhờ quản trị viên kiểm tra thiết lập AI.')}</p>`}
    </div>` : ''}
    ${creationError ? `<div class="notice notice-bad" role="alert" id="ai-request-error"><strong>${tr('AI request could not be completed.', 'Chưa thể hoàn tất yêu cầu AI.')}</strong>${errorMarkup(creationError)}</div>` : ''}
    ${draftListError ? `<div class="notice notice-bad" role="alert"><strong>${tr('Could not load recent drafts.', 'Không tải được bản nháp gần đây.')}</strong>${errorMarkup(draftListError)}</div>` : ''}
    ${creationBlocked() || draftListError ? `<button class="btn btn-ghost" type="button" id="ai-check-readiness" ${checkingReadiness ? 'disabled' : ''}>${checkingReadiness ? tr('Checking…', 'Đang kiểm tra…') : tr('Check again', 'Kiểm tra lại')}</button>` : ''}
    ${pollingError ? `<div class="notice notice-bad" role="alert" id="ai-poll-error"><strong>${tr('Draft status could not be loaded.', 'Không tải được trạng thái bản nháp.')}</strong>${errorMarkup(pollingError.error)}<button class="btn btn-ghost" type="button" id="ai-retry-status">${tr('Retry status check', 'Thử tải trạng thái lại')}</button></div>` : ''}`;
    slot.querySelector('#ai-check-readiness')?.addEventListener('click', async () => {
      if (checkingReadiness) return;
      checkingReadiness = true;
      renderCreationStatus();
      await Promise.all([loadCapabilities(), loadDraftList()]);
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

  function cancelButton(draft) {
    return draft.canCancel === true && !['PUBLISHED', 'IMPORTED', 'CANCELLED'].includes(draft.status)
      ? `<button class="btn btn-ghost btn-sm" type="button" data-cancel-draft="${escapeHtml(draft.draftId)}">${tr('Cancel draft', 'Hủy bản nháp')}</button>` : '';
  }

  function isSuccessStatus(status) {
    return status === STATUS_AWAITING_APPROVAL ||
      status === STATUS_TRUTH_AWAITING_APPROVAL ||
      status === STATUS_FULL_LOGIC_AWAITING_APPROVAL ||
      status === STATUS_SCENE_LAYOUT_AWAITING_APPROVAL ||
      status === STATUS_READY_TO_PUBLISH ||
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
    return `
    <tr>
      <td>${escapeHtml(title)}<br><span class="muted small">${escapeHtml(prompt.slice(0, 70))}</span></td>
      <td><span class="chip">${escapeHtml(d.provider)}</span></td>
      <td><span class="chip">${escapeHtml(preset)}</span>${effectiveCaseType ? ` <span class="chip">${escapeHtml(caseTypeLabel(effectiveCaseType))}</span>` : ''}${isV3Draft(d) ? ` <span class="chip ${d.v3SemanticReview?.status === 'PASSED' ? 'chip-ok' : 'chip-bad'}">Review ${escapeHtml(d.v3SemanticReview?.status || 'NOT_RUN')}</span>` : ''}<br><span class="muted small">${escapeHtml(language)}</span></td>
      <td><span class="chip ${isGeneratingDraft(d) ? '' : isSuccessStatus(d.status) ? 'chip-ok' : 'chip-bad'}">${escapeHtml(statusLabel(d.status))}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" data-view="${d.draftId}">${tr('View', 'Xem')}</button>
        ${continueButton(d)}
        ${cancelButton(d)}
        ${d.status === STATUS_PUBLISHED || d.importedCaseId
          ? `<a class="btn btn-ghost btn-sm" href="#/cases/${encodeURIComponent(d.importedCaseId ?? d.caseId)}">${tr('Open case', 'Mở vụ án')}</a>`
          : ''}
      </td>
    </tr>`;
  }

  function draw(activeDraft = null) {
    if (disposed) return;
    captureCreationForm();
    visibleDraft = activeDraft;
    disposePresentation();
    disposePresentation = () => {};
    const availablePresets = Object.entries(PRESETS);
    render(app, `
    <div class="page">
      <h2>${tr('AI Case Creator', 'Tạo vụ án bằng AI')}</h2>
      <p class="muted">${tr('Create a premise, approve its immutable causal truth, then project that truth into playable clues, dialogue, puzzles, and a five-claim accusation.', 'Tạo tiền đề, duyệt nguồn sự thật nhân quả bất biến, rồi chuyển truth thành manh mối, hội thoại, câu đố và cáo buộc năm luận điểm.')}</p>

      <div id="ai-creation-status"></div>

      <div class="ai-quick-create">
        <label class="ai-preset-field">
          <span>${tr('Generation preset', 'Cấu hình tạo')}</span>
          <select class="field-input" id="ai-preset-select">
            ${availablePresets.map(([value]) => `<option value="${value}" ${formFields['ai-preset-select'] === value ? 'selected' : ''}>${escapeHtml(presetLabel(value))}</option>`).join('')}
          </select>
        </label>
        <label class="ai-preset-field ai-language-field">
          <span>${tr('Case language', 'Ngôn ngữ nội dung vụ án')}</span>
          <select class="field-input" id="ai-language-select">
            <option value="en" ${selectedLanguage === 'en' ? 'selected' : ''}>English</option>
            <option value="vi" ${selectedLanguage === 'vi' ? 'selected' : ''}>Tiếng Việt</option>
          </select>
          <small class="muted">${tr('Applies to the title, story, clues, dialogue, and ending.', 'Áp dụng cho tiêu đề, cốt truyện, manh mối, hội thoại và kết thúc.')}</small>
        </label>
        <label class="ai-preset-field ai-language-field ai-case-type-field">
          <span>${tr('Case type', 'Loại vụ án')}</span>
          <select class="field-input" id="ai-case-type-select">
            ${Object.keys(CASE_TYPES).map((value) => `<option value="${value}" ${selectedCaseType === value ? 'selected' : ''}>${escapeHtml(caseTypeLabel(value))}</option>`).join('')}
          </select>
          <small class="muted">${tr('Separate from gameplay preset. Random receives a new server diversity seed for every draft.', 'Tách biệt với cấu hình gameplay. Chế độ ngẫu nhiên nhận seed đa dạng mới từ máy chủ cho mỗi bản nháp.')}</small>
        </label>
        ${capabilities.aiCaseV3PresetEnabled ? `<label class="ai-preset-field ai-crack-toggle">
          <span>${tr('Gameplay extension', 'Mở rộng gameplay')}</span>
          <span><input id="ai-include-crack" type="checkbox" ${includeCrack ? 'checked' : ''}> ${tr('Include Crack the Lie', 'Thêm Phá Vỡ Lời Dối')} <span id="ai-crack-badge" class="chip chip-gold" hidden>V3 · Crack</span></span>
          <small class="muted">${tr('Keeps the selected V2 preset and adds private evidence, testimony and Joint Review loops.', 'Giữ preset V2 đã chọn và thêm chứng cứ riêng, lời khai riêng cùng vòng Cùng xem xét.')}</small>
          <small class="muted" id="ai-crack-budget">${crackBudget('NORMAL_RANDOM', capabilities.crackBudgets)}</small>
        </label>` : ''}
        <label class="ai-preset-field ai-creator-direction">
          <span>${tr('Creator direction', 'Định hướng sáng tác')}</span>
          <textarea class="field-input" id="ai-creator-direction" rows="3" maxlength="1200" placeholder="${tr('Optional setting, tone, characters, or mystery direction. Do not include the Crack answer.', 'Bối cảnh, sắc thái, nhân vật hoặc hướng bí ẩn (không tiết lộ đáp án Crack).')}">${escapeHtml(formFields['ai-creator-direction'])}</textarea>
        </label>
        <div class="ai-creative-constraints">
          <label class="ai-preset-field"><span>${tr('Setting lock', 'Khóa bối cảnh')}</span><select class="field-input" id="ai-setting-lock"><option value="">${tr('Automatic', 'Tự động')}</option>${Object.entries(CREATIVE_SETTINGS).map(([value, labels]) => `<option value="${value}">${escapeHtml(tr(labels[0], labels[1]))}</option>`).join('')}</select></label>
          <label class="ai-preset-field"><span>${tr('Tone lock', 'Khóa sắc thái')}</span><select class="field-input" id="ai-tone-lock"><option value="">${tr('Automatic', 'Tự động')}</option>${Object.entries(CREATIVE_TONES).map(([value, labels]) => `<option value="${value}">${escapeHtml(tr(labels[0], labels[1]))}</option>`).join('')}</select></label>
          <label class="ai-preset-field"><span>${tr('Investigation mechanic', 'Khóa cơ chế điều tra')}</span><select class="field-input" id="ai-mechanic-lock"><option value="">${tr('Automatic', 'Tự động')}</option>${Object.entries(CREATIVE_MECHANICS).map(([value, labels]) => `<option value="${value}">${escapeHtml(tr(labels[0], labels[1]))}</option>`).join('')}</select></label>
        </div>
        <button class="btn btn-gold" type="button" id="quick-create-btn" ${creationBlocked() || creating ? 'disabled' : ''}>${creating ? tr('Creating case...', 'Đang tạo vụ án...') : tr('Create new case', 'Tạo vụ án mới')}</button>
        <span class="muted small" id="ai-preset-help">${escapeHtml(presetDescription('NORMAL_RANDOM'))}</span>
      </div>
      ${capabilities.aiCaseV3PresetEnabled && !capabilities.gameplayV3Enabled
        ? `<div class="notice notice-bad"><strong>${tr('V3 gameplay is disabled.', 'Gameplay V3 đang tắt.')}</strong> ${tr('V3 drafts can be generated and reviewed, but cannot be published.', 'Có thể tạo và kiểm tra bản nháp V3 nhưng chưa thể xuất bản.')}</div>`
        : ''}

      <section class="generation-progress" id="generation-progress" hidden aria-live="polite">
        <div class="generation-progress-heading">
          <strong id="generation-progress-title">${tr('Preparing...', 'Đang chuẩn bị...')}</strong>
          <span id="generation-progress-percent">0%</span>
        </div>
        <div class="generation-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="generation-progress-fill" id="generation-progress-fill"></div>
        </div>
        <p class="muted small" id="generation-progress-detail"></p>
      </section>

      <div id="ai-output">${activeDraft ? draftDetail(activeDraft) : ''}</div>

      ${canManageDrafts ? `<h3 class="section-title">${tr('Recent AI drafts', 'Bản nháp AI gần đây')}</h3>` : ''}
      ${!canManageDrafts
        ? ''
        : draftListError && drafts.length === 0
        ? ''
        : drafts.length === 0
        ? `<div class="empty-state small">${tr('No drafts yet.', 'Chưa có bản nháp.')}</div>`
        : `<table class="admin-table">
            <thead><tr><th>${tr('Draft', 'Bản nháp')}</th><th>${tr('Provider', 'Nhà cung cấp')}</th><th>${tr('Preset', 'Cấu hình')}</th><th>${tr('Status', 'Trạng thái')}</th><th></th></tr></thead>
            <tbody>${drafts.map(draftRow).join('')}</tbody>
          </table>`}
    </div>`);
    for (const id of ['ai-setting-lock', 'ai-tone-lock', 'ai-mechanic-lock']) {
      qs(`#${id}`, app).value = formFields[id];
    }
    bind();
    renderCreationStatus();
  }

  function failureBlock(d, generating) {
    const phase = d.failurePhase && d.failurePhase !== 'NONE'
      ? `<span class="muted small">Failure phase: ${escapeHtml(d.failurePhase)}${d.failedAssetIds?.length ? ` · Failed assets: ${d.failedAssetIds.map(escapeHtml).join(', ')}` : ''}</span>`
      : '';
    const errors = d.validationErrors?.length
      ? `<ul>${d.validationErrors.slice(0, 12).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
      : '';
    if (!phase && !errors) return '';
    if (!generating) return `${phase ? `<br>${phase}` : ''}${errors}`;
    return `<details class="truth-section" data-previous-attempt><summary>${tr(
      'Result of the previous attempt', 'Kết quả lần chạy trước'
    )}</summary>${phase}${errors}</details>`;
  }

  function draftDetail(d) {
    const preview = d.storyPreview;
    const statusOk = isSuccessStatus(d.status);
    const published = d.publishedCase || d.importedCaseId || d.status === STATUS_PUBLISHED;
    const caseId = d.publishedCase?.caseId || d.importedCaseId || d.caseId;
    const resumeAction = continueButton(d);
    const generating = isGeneratingDraft(d);
    const cannotResume = !generating && d.status === STATUS_GENERATED_INVALID && !d.hasGeneratedJson && !published && !d.canContinue;
    return `
    <div class="notice ${generating ? '' : statusOk ? 'notice-ok' : 'notice-bad'}">
      <strong>${escapeHtml(d.caseTitle || preview?.title || d.caseId || tr('AI draft', 'Bản nháp AI'))}</strong> - ${escapeHtml(statusLabel(d.status))} (${escapeHtml(d.provider)})
      <br><span class="muted small">${tr('Preset', 'Cấu hình')}: ${escapeHtml(presetLabel(d.settings?.generationPreset))} · ${tr('Case type', 'Loại vụ án')}: ${escapeHtml(caseTypeLabel(d.storyDiversity?.caseType || d.settings?.caseType))} · ${tr('Language', 'Ngôn ngữ')}: ${d.settings?.language === 'vi' ? 'Tiếng Việt' : 'English'} · ${tr('Logic contract', 'Hợp đồng logic')}: v${Number(d.logicContractVersion || 1)}</span>
      ${d.storyDiversity?.seed ? `<br><span class="muted small">Diversity seed: <code>${escapeHtml(d.storyDiversity.seed)}</code>${d.storyDiversity?.coreFingerprint ? ` · Core: <code>${escapeHtml(d.storyDiversity.coreFingerprint.slice(0, 12))}</code>` : ''}${d.storyFingerprint ? ` · Preview: <code>${escapeHtml(d.storyFingerprint.slice(0, 12))}</code>` : ''}</span>` : ''}
      ${d.storyDiversity?.creativeConstraints && !d.storyDiversity.creativeConstraints.isEmpty ? `<br><span class="muted small">${tr('Locked creative brief', 'Brief sáng tác đã khóa')}: ${escapeHtml([d.storyDiversity.creativeConstraints.settingId, d.storyDiversity.creativeConstraints.toneId, d.storyDiversity.creativeConstraints.investigationMechanicId].filter(Boolean).join(' · '))}</span>` : ''}
      ${d.hasProjectionPlan ? `<br><span class="muted small">Projection: ${escapeHtml(d.projectionPlanSchemaVersion)} · <code>${escapeHtml((d.projectionPlanHash || '').slice(0, 12))}</code> · ${escapeHtml(d.projectionCompilerVersion)} · ${escapeHtml(d.projectionBuildMode)}</span>` : d.projectionBuildMode ? `<br><span class="muted small">Build mode: ${escapeHtml(d.projectionBuildMode)}</span>` : ''}
      ${d.jsonFolderPath ? `<br><span class="muted small">Bundle: ${escapeHtml(d.jsonFolderPath)}</span>` : ''}
      ${d.assetManifest?.assetRootUrl
        ? `<br><span class="muted small">Assets: ${escapeHtml(d.assetManifest.assetRootUrl)} (${d.assetManifest.assets?.length ?? 0})</span>`
        : ''}
      ${failureBlock(d, generating)}
      ${cannotResume
        ? `<p class="muted small">${tr(
            'This draft has no recoverable checkpoint for its current failure. Review the validation details, then create a new case if the source artifact cannot be repaired.',
            'Bản nháp không có checkpoint có thể phục hồi cho lỗi hiện tại. Hãy xem chi tiết validation; chỉ tạo case mới nếu artifact nguồn không thể sửa.'
          )}</p>`
        : ''}
      ${published && caseId
        ? `<div class="case-actions">
            <a class="btn btn-primary btn-sm" href="#/cases/${encodeURIComponent(caseId)}">Open published case</a>
            ${session.isAdmin() ? `<a class="btn btn-ghost btn-sm" href="#/admin/cases/${encodeURIComponent(caseId)}">Admin review</a>` : ''}
          </div>`
        : resumeAction || cancelButton(d)
        ? `<div class="case-actions">${resumeAction}${cancelButton(d)}</div>`
        : ''}
    </div>
    ${qualitySummary(d)}
    ${preview ? previewCard(preview, d) : ''}
    ${truthPanel(d)}
    ${blindReviewPanel(d)}
    ${provenancePanel(d)}
    ${v3PublishGatePanel(d)}
    ${v3ReviewPanel(d)}
    ${repairPanel(d)}
    ${generationDiagnostics(d)}
    ${presentationPlaceholder(d)}
    ${d.generatedJson && session.isAdmin()
      ? `<details class="json-details">
          <summary>Generated JSON</summary>
          <p class="muted small">Replacing JSON validates the complete case, snapshots the current JSON, and resets layout/assets for v5 regeneration. Existing v4 files are not deleted.</p>
          <textarea class="field-input json-editor" rows="24" data-json-editor="${escapeHtml(d.draftId)}" spellcheck="false">${escapeHtml(d.generatedJson)}</textarea>
          <div class="case-actions">
            <button class="btn btn-primary btn-sm" type="button" data-replace-json="${escapeHtml(d.draftId)}">Validate and replace JSON</button>
          </div>
        </details>`
      : ''}`;
  }

  function truthValues(values, fallback = '—') {
    return Array.isArray(values) && values.length ? values.map((value) => escapeHtml(value)).join(', ') : fallback;
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
    return `<section class="notice ${validationErrors || ['FAILED', 'AMBIGUOUS'].includes(status) ? 'notice-bad' : ''}" data-ai-quality-summary>
      <strong>${tr('Quality checks', 'Kiểm tra chất lượng')}</strong>
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
    return `<section class="notice ${!valid || ['FAILED', 'AMBIGUOUS'].includes(status) ? 'notice-bad' : ''}" data-truth-repair-review>
      <h4>${tr('Repair candidate review', 'Đánh giá bản sửa')}</h4>
      <p>${valid ? tr('Structure passed; review the content before accepting.', 'Cấu trúc hợp lệ; hãy kiểm tra nội dung trước khi chấp nhận.') : tr('The candidate still needs structural repair.', 'Bản sửa vẫn cần sửa lỗi cấu trúc.')}</p>
      <p><strong>${tr('Candidate story review (advisory)', 'Đánh giá cốt truyện bản sửa (tham khảo)')}: ${escapeHtml(status)}</strong>${review && status !== 'NOT_RUN' ? ` · ${tr('Confidence', 'Độ tin cậy')}: ${(Number(review.confidence || 0) * 100).toFixed(0)}%` : ''}</p>
      ${status === 'NOT_RUN' ? `<p>${tr('The candidate has not received a story quality review.', 'Bản sửa chưa được đánh giá chất lượng cốt truyện.')}</p>` : ''}
      ${findings.length ? renderReviewFindingGroups(findings) : ''}
      ${d.truthRepairValidationReport?.length ? `<div role="alert" data-truth-repair-validation><strong>${tr('Candidate validation errors', 'Lỗi kiểm tra bản sửa')}</strong><ul>${d.truthRepairValidationReport.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
      <p class="muted small">${tr('These findings are advisory. Accepting replaces the truth and requires gameplay to be generated again; rejecting preserves the current draft.', 'Các phát hiện này mang tính tham khảo. Chấp nhận sẽ thay truth và yêu cầu tạo lại gameplay; từ chối giữ nguyên bản nháp hiện tại.')}</p>
      ${canContinueTruthRepairCandidate(d) ? `<div data-truth-repair-continuation>
        <h4>${tr('Continue repairing this candidate', 'Tiếp tục sửa từ bản sửa này')}</h4>
        <p>${tr('Reuse this candidate’s valid earlier artifacts and regenerate only the selected scope and what follows. The current truth and gameplay stay unchanged until you accept a valid candidate.', 'Tái sử dụng phần hợp lệ trước đó của bản sửa và chỉ tạo lại từ phạm vi đã chọn. Sự thật và gameplay hiện tại được giữ nguyên đến khi bạn chấp nhận một bản sửa hợp lệ.')}</p>
        ${d.truthRepairCandidatePlan ? `<p class="muted small" data-truth-repair-candidate-plan>${tr('Candidate repair recommendation', 'Khuyến nghị sửa bản sửa')}: <strong>${escapeHtml(d.truthRepairCandidatePlan.recommendedStartArtifact || 'TIMELINE')}</strong> · ${tr('Reasons', 'Lý do')}: ${truthValues(d.truthRepairCandidatePlan.reasonCodes)}</p>` : ''}
        <label class="truth-repair-field"><span>${tr('Candidate repair start', 'Bắt đầu sửa bản sửa từ')}</span><select class="field-input" data-candidate-repair-scope="${escapeHtml(d.draftId)}">${truthRepairScopeOptions(d.truthRepairCandidatePlan)}</select><small class="muted">${tr('Choose the recommended scope or an earlier one if its inputs also need changes.', 'Chọn phạm vi được khuyến nghị hoặc sớm hơn nếu dữ liệu đầu vào cũng cần thay đổi.')}</small></label>
        <label class="truth-repair-field"><span>${tr('Candidate repair instructions', 'Yêu cầu sửa tiếp bản sửa')}</span><textarea class="field-input" rows="2" maxlength="2000" data-candidate-repair-instructions="${escapeHtml(d.draftId)}" placeholder="${tr('Describe how to fix the candidate errors above.', 'Mô tả cách khắc phục các lỗi của bản sửa ở trên.')}"></textarea></label>
        <div class="case-actions cluster"><button class="btn btn-primary btn-sm" type="button" data-continue-truth-repair="${escapeHtml(d.draftId)}">${tr('Continue from this candidate', 'Sửa tiếp từ bản sửa này')}</button><button class="btn btn-ghost btn-sm" type="button" data-reject-truth-repair="${escapeHtml(d.draftId)}">${tr('Discard candidate', 'Bỏ bản sửa này')}</button></div>
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
      `<section data-review-finding-group="${artifact}"><h4>${artifact}</h4><ul>${items.map((finding) => `<li><span class="chip chip-bad">${escapeHtml(finding.code || 'OTHER')}</span> ${escapeHtml(finding.message || '')}${finding.relatedIds?.length ? `<br><span class="muted small">${truthValues(finding.relatedIds)}</span>` : ''}</li>`).join('')}</ul></section>`).join('');
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
    return `<section class="notice ${!summary.validationErrorCount ? 'notice-ok' : 'notice-bad'} truth-review-panel" data-truth-review>
      <div class="page-head"><h3>${tr('Immutable case truth (spoiler)', 'Sự thật vụ án bất biến (có spoiler)')}</h3><span class="chip ${reviewPassed ? 'chip-ok' : ''}">${tr('Advisory', 'Tham khảo')}: ${escapeHtml(review?.status || summary.reviewerStatus || 'NOT_RUN')}</span></div>
      <p class="muted small">Schema ${escapeHtml(summary.schemaVersion || '')} · SHA-256 <code>${escapeHtml(summary.truthHash || '')}</code></p>
      <div class="truth-metric-grid">
        <span><strong>${summary.timelineEventCount}/${summary.maxTimelineEvents || '?'}</strong>${tr('timeline events', 'sự kiện')}</span>
        <span><strong>${summary.traceCount}/${summary.maxTraces || '?'}</strong>${tr('causal traces', 'dấu vết nhân quả')}</span>
        <span><strong>${summary.statementCount}/${summary.maxStatements || '?'}</strong>${tr('statements', 'lời khai')}</span>
        <span><strong>${summary.proofConclusionCount}</strong>${tr('proof conclusions', 'kết luận')}</span>
      </div>
      ${review ? `<p class="muted small"><strong>${tr('Advisory AI review', 'Đánh giá AI tham khảo')}:</strong> ${tr('Findings do not block approval when deterministic validation passes.', 'Các phát hiện không chặn phê duyệt khi validator tất định đã pass.')}</p><div class="truth-review-verdicts">
        <strong>${tr('Reviewer confidence', 'Độ tin cậy của reviewer')}: ${(Number(review.confidence || 0) * 100).toFixed(0)}%</strong>
        <span class="chip ${review.timelineFeasible ? 'chip-ok' : 'chip-bad'}">${tr('Timeline', 'Thời gian')} ${review.timelineFeasible ? 'PASS' : 'BLOCK'}</span>
        <span class="chip ${review.physicalCausalityFeasible ? 'chip-ok' : 'chip-bad'}">${tr('Causality', 'Nhân quả')} ${review.physicalCausalityFeasible ? 'PASS' : 'BLOCK'}</span>
        <span class="chip ${review.uniqueSolution ? 'chip-ok' : 'chip-bad'}">${tr('Unique solution', 'Nghiệm duy nhất')} ${review.uniqueSolution ? 'PASS' : 'BLOCK'}</span>
      </div>${findings.length ? `<div class="truth-validation-errors"><strong>${tr('Advisory reviewer findings', 'Phát hiện tham khảo từ reviewer')}</strong>${renderReviewFindingGroups(findings)}</div>` : ''}` : ''}
      ${d.truthValidationReport?.length ? `<div class="truth-validation-errors"><strong>${tr('Validation report', 'Báo cáo validation')}</strong><ul>${d.truthValidationReport.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
      ${truth && core ? `<div class="truth-core-grid">
        <article><span>${tr('Culprit', 'Thủ phạm')}</span><strong>${escapeHtml(core.culpritId)}</strong></article>
        <article><span>${tr('Target', 'Nạn nhân/mục tiêu')}</span><strong>${escapeHtml(core.targetId)}</strong></article>
        <article><span>${tr('Motive', 'Động cơ')}</span><strong>${escapeHtml(core.motive)}</strong></article>
        <article><span>${tr('Method', 'Phương thức')}</span><strong>${escapeHtml(core.method)}</strong></article>
      </div>
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
      ${canRepairTruth(d) ? `${!candidateReady ? `${d.truthRepairCandidate ? `<h4>${tr('Start again from current truth', 'Tạo lại từ sự thật hiện tại')}</h4><p class="muted small">${tr('This starts a separate repair from the current checkpoint and replaces the saved candidate.', 'Thao tác này bắt đầu sửa từ checkpoint hiện tại và thay thế bản sửa đang lưu.')}</p>` : ''}<label class="truth-repair-field"><span>${tr('Repair start artifact', 'Artifact bắt đầu sửa')}</span><select class="field-input" data-truth-repair-scope="${escapeHtml(d.draftId)}">${truthRepairScopeOptions(repairPlan)}</select><small class="muted">${tr('You may start earlier than recommended, never later.', 'Có thể bắt đầu sớm hơn khuyến nghị, không được bắt đầu muộn hơn.')}</small></label><label class="truth-repair-field"><span>${tr('Scoped repair instructions', 'Yêu cầu sửa theo phạm vi')}</span><textarea class="field-input" rows="2" maxlength="2000" data-truth-repair-instructions="${escapeHtml(d.draftId)}" placeholder="${tr('Describe the invalid causal artifact; valid upstream truth will remain locked.', 'Mô tả artifact nhân quả bị lỗi; truth upstream hợp lệ vẫn được khóa.')}"></textarea></label>` : ''}<div class="case-actions">
        ${!candidateReady ? `<button class="btn btn-ghost btn-sm" type="button" data-repair-truth="${escapeHtml(d.draftId)}">${d.truthRepairCandidate ? tr('Repair from current truth', 'Sửa từ sự thật hiện tại') : tr('Create scoped repair', 'Tạo bản sửa theo phạm vi')}</button>` : ''}
        ${candidateReady ? `<button class="btn btn-primary btn-sm" type="button" data-accept-truth-repair="${escapeHtml(d.draftId)}">${tr('Accept truth repair', 'Chấp nhận bản sửa truth')}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-reject-truth-repair="${escapeHtml(d.draftId)}">${tr('Reject truth repair', 'Từ chối bản sửa truth')}</button>` : ''}
      </div>` : ''}
      ${!d.truthRepairCandidate && d.truthRepairValidationReport?.length ? `<ul role="alert">${d.truthRepairValidationReport.slice(0, 20).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
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
    return `<section class="notice ${passed ? 'notice-ok' : ''} blind-review-panel" data-blind-review>
      <div class="page-head"><h3>${tr('Advisory blind solvability review', 'Đánh giá khả năng giải mù (tham khảo)')}</h3><span class="chip ${passed ? 'chip-ok' : ''}">${escapeHtml(assessmentLabel)}</span></div>
      <p>${tr('The reviewer only received information collectible before accusation; truth metadata and the final answer were removed.', 'Reviewer chỉ nhận thông tin người chơi có thể thu thập trước cáo buộc; metadata truth và đáp án cuối đã bị loại bỏ.')}</p>
      <p><strong>${tr('Server assessment', 'Xác minh từ server')}:</strong> ${escapeHtml(assessment.status || 'NOT_RUN')}</p>
      <p><strong>${tr('Reviewer confidence', 'Độ tin cậy của reviewer')}:</strong> ${(Number(review.confidence || 0) * 100).toFixed(0)}%</p>
      <div class="truth-core-grid">
        <article><span>${tr('Inferred culprit', 'Thủ phạm suy ra')}</span><strong>${escapeHtml(review.culpritId || '—')}</strong></article>
        <article><span>${tr('Unique solution', 'Nghiệm duy nhất')}</span><strong>${review.uniqueSolution ? 'PASS' : 'BLOCK'}</strong></article>
        <article><span>${tr('Inferred motive', 'Động cơ suy ra')}</span><strong>${escapeHtml(review.motive || '—')}</strong></article>
        <article><span>${tr('Inferred method', 'Phương thức suy ra')}</span><strong>${escapeHtml(review.method || '—')}</strong></article>
      </div>
      <p><strong>${tr('Timeline reconstruction', 'Tái dựng dòng thời gian')}:</strong> ${escapeHtml(review.timelineSummary || '—')}</p>
      <p><strong>${tr('Evidence chain', 'Chuỗi chứng cứ')}:</strong> ${truthValues(review.evidenceChainIds)}</p>
      ${claimProofs ? `<p><strong>${tr('Proof by claim', 'Chứng cứ theo luận điểm')}:</strong></p><ul>${claimProofs}</ul>` : ''}
      ${findings.length ? `<ul>${findings.map((finding) => `<li><strong>${escapeHtml(finding.code)}</strong>${finding.relatedIds?.length ? ` [${finding.relatedIds.map(escapeHtml).join(', ')}]` : ''}: ${escapeHtml(finding.message)}</li>`).join('')}</ul>` : ''}
      ${assessmentErrors ? `<p><strong>${tr('Server validation', 'Lỗi xác minh server')}:</strong></p><ul>${assessmentErrors}</ul>` : ''}
    </section>`;
  }

  function provenancePanel(d) {
    const artifacts = d.artifactProvenance || [];
    if (!artifacts.length) return '';
    const staleCount = artifacts.filter((artifact) => artifact.isStale).length;
    return `<details class="notice artifact-provenance" data-artifact-provenance ${staleCount ? 'open' : ''}>
      <summary><strong>${tr('Artifact dependency provenance', 'Nguồn gốc dependency của artifact')}</strong> · <span class="chip ${staleCount ? 'chip-bad' : 'chip-ok'}">${staleCount ? `${staleCount} STALE` : 'CURRENT'}</span></summary>
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
    return `<details class="json-details">
      <summary>Generation diagnostics (${attempts.length})</summary>
      <ul>${[...phaseTotals].map(([phase, total]) => `<li><strong>${escapeHtml(phase)}</strong>: ${total.calls} call(s) · ${total.input} input / ${total.output} output tokens</li>`).join('')}</ul>
      <p class="muted small">Prompt: ${escapeHtml(d.promptVersion || 'unknown')} · Schema: ${escapeHtml(d.schemaVersion || 'unknown')} · Tokens: ${inputTokens} in / ${outputTokens} out</p>
      <ul>${attempts.slice(-10).map((attempt) => `<li>${escapeHtml(attempt.step)} #${attempt.attemptNumber}: ${escapeHtml(attempt.status)}${attempt.failureCategory ? ` — ${escapeHtml(attempt.failureCategory)}` : ''}</li>`).join('')}</ul>
    </details>`;
  }

  function repairPanel(d) {
    if (isV3Draft(d) || Number(d.logicContractVersion || 1) >= 2) return '';
    if (d.status !== STATUS_FULL_LOGIC_AWAITING_APPROVAL && d.status !== STATUS_GENERATED_INVALID) return '';
    const hasCandidate = Boolean(d.repairedCandidateJson);
    return `
    <section class="notice">
      <h3>Full logic repair</h3>
      <p class="muted small">Creates a camera-first repair candidate without overwriting the current draft.</p>
      <div class="case-actions">
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
    if (!d.generatedJson) return '<section class="notice"><h3>V3 Crack review</h3><p class="muted small">Full logic has not been generated yet.</p></section>';

    let gameCase;
    try {
      gameCase = JSON.parse(d.generatedJson);
    } catch {
      return '<section class="notice notice-bad"><h3>V3 Crack review</h3><p>Generated JSON cannot be parsed.</p></section>';
    }
    const challenges = [...(gameCase.evidenceChallenges || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    if (challenges.length === 0) return '<section class="notice notice-bad"><h3>V3 Crack review</h3><p>No paired challenge was found.</p></section>';

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
      return `<article class="notice v3-ai-review">
        <div class="page-head"><h3>Crack ${escapeHtml(String(challenge.order || '?'))} ${challenge.isSignature ? '· SIGNATURE' : ''}</h3><span class="chip">${escapeHtml(challenge.challengeId)}</span></div>
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

    return `<section class="v3-ai-review-list"><div class="page-head"><h3>V3 Crack matrices</h3><span class="chip ${d.v3SemanticReview?.status === 'PASSED' ? 'chip-ok' : 'chip-bad'}">${escapeHtml(d.v3SemanticReview?.status || 'NOT_RUN')}</span></div>${panels}</section>`;
  }

  function v3PublishGatePanel(d) {
    if (!isV3Draft(d)) return '';
    const deterministicValid = d.hasGeneratedJson
      ? d.status !== STATUS_GENERATED_INVALID && !(d.validationErrors?.length)
      : null;
    const gate = v3PublishGate(d, capabilities, deterministicValid);
    return `<section class="notice ${gate.canPublish ? 'notice-ok' : 'notice-bad'} v3-publish-gate">
      <div class="page-head"><h3>V3 publish gate</h3><span class="chip ${gate.canPublish ? 'chip-ok' : 'chip-bad'}">${gate.canPublish ? 'READY' : 'BLOCKED'}</span></div>
      <ul class="v3-gate-list">${gate.checks.map((check) => `<li class="${check.passed ? 'v3-gate-pass' : 'v3-gate-fail'}"><strong>${check.passed ? 'PASS' : 'BLOCK'} · ${escapeHtml(check.label)}</strong><br><span class="muted small">${escapeHtml(check.detail)}</span></li>`).join('')}</ul>
    </section>`;
  }

  function previewCard(preview, draft) {
    return `
    <section class="notice">
      <h3>${escapeHtml(preview.title)}</h3>
      <p>${escapeHtml(preview.summary)}</p>
      <p><strong>Setting:</strong> ${escapeHtml(preview.setting || 'Pending')}</p>
      <p><strong>Opening incident:</strong> ${escapeHtml(preview.openingIncident || 'Pending')}</p>
      <p><strong>Tone:</strong> ${escapeHtml(preview.tone || 'Pending')}</p>
      <p><strong>Player promise:</strong> ${escapeHtml(preview.playerPromise || 'Pending')}</p>
      ${preview.keyLocations?.length
        ? `<p><strong>Locations:</strong> ${preview.keyLocations.map(escapeHtml).join(', ')}</p>`
        : ''}
      ${preview.suspectTeasers?.length
        ? `<p><strong>Suspects:</strong> ${preview.suspectTeasers.map(escapeHtml).join(', ')}</p>`
        : ''}
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
    const crackBadge = qs('#ai-crack-badge', app);
    const crackBudgetText = qs('#ai-crack-budget', app);
    const settingLock = qs('#ai-setting-lock', app);
    const toneLock = qs('#ai-tone-lock', app);
    const mechanicLock = qs('#ai-mechanic-lock', app);
    const presetHelp = qs('#ai-preset-help', app);
    const syncCrackProfile = () => {
      const presetKey = presetSelect?.value ?? 'NORMAL_RANDOM';
      const preset = PRESETS[presetKey] ?? PRESETS.NORMAL_RANDOM;
      const confrontationHelp = presetKey === 'SHORT_DEMO'
        ? crackToggle?.checked
          ? tr('The one confrontation uses paired testimony and evidence through Crack the Lie; every other demo mechanic stays required.', 'Đối chất duy nhất dùng cặp lời khai và chứng cứ qua Phá Vỡ Lời Dối; các cơ chế thử còn lại vẫn bắt buộc.')
          : tr('The one confrontation uses the standard flow. Crack the Lie remains optional.', 'Đối chất duy nhất dùng luồng thông thường. Phá Vỡ Lời Dối vẫn là lựa chọn tùy chọn.')
        : crackToggle?.checked
          ? tr('Crack the Lie will be added on top of this preset.', 'Crack the Lie sẽ được thêm trên cấu hình này.')
          : '';
      presetHelp.textContent = `${presetDescription(presetKey)}${confrontationHelp ? ` ${confrontationHelp}` : ''}`;
      if (crackBudgetText) crackBudgetText.textContent = crackBudget(presetKey, capabilities.crackBudgets);
      if (crackBadge) crackBadge.hidden = !crackToggle?.checked;
    };
    syncCrackProfile();
    presetSelect?.addEventListener('change', () => {
      syncCrackProfile();
    });
    crackToggle?.addEventListener('change', () => {
      syncCrackProfile();
      qs('#quick-create-btn', app).disabled = creating || creationBlocked();
      renderCreationStatus();
    });
    languageSelect?.addEventListener('change', () => {
      selectedLanguage = languageSelect.value === 'vi' ? 'vi' : 'en';
      window.localStorage.setItem('sirlocked.aiCaseLanguage', selectedLanguage);
    });
    caseTypeSelect?.addEventListener('change', () => {
      selectedCaseType = CASE_TYPES[caseTypeSelect.value] ? caseTypeSelect.value : 'RANDOM';
      window.localStorage.setItem('sirlocked.aiCaseType', selectedCaseType);
    });

    qs('#quick-create-btn', app).addEventListener('click', async () => {
      if (creationBlocked() || creating) return;
      creating = true;
      pollingError = null;
      stopPolling();
      const button = qs('#quick-create-btn', app);
      const presetKey = presetSelect?.value ?? 'NORMAL_RANDOM';
      const preset = PRESETS[presetKey] ?? PRESETS.NORMAL_RANDOM;
      const language = selectedLanguage;
      const version = ++runVersion;
      let activeDraftId = null;
      const idempotencyKey = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      runStartedAt = Date.now();
      button.disabled = true;
      button.textContent = tr('Creating case...', 'Đang tạo vụ án...');
      updateProgress('GENERATING_STORY');
      startProgressClock();

      try {
        const creatorDirection = qs('#ai-creator-direction', app)?.value?.trim() || '';
        const creativeConstraints = {
          settingId: settingLock?.value || '',
          toneId: toneLock?.value || '',
          investigationMechanicId: mechanicLock?.value || '',
        };
        const previewDraft = await aiCaseApi.generate(
          creatorDirection,
          preset.stageCount,
          preset.difficulty,
          presetKey,
          language,
          Boolean(crackToggle?.checked),
          selectedCaseType,
          idempotencyKey,
          creativeConstraints);
        activeDraftId = previewDraft.draftId;
        if (disposed || version !== runVersion) return;
        creating = false;
        creationError = null;
        updateProgress(previewDraft.status);
        await loadDraftList();
        if (disposed || version !== runVersion) return;
        if (isTerminalDraft(previewDraft)) {
          stopProgressClock();
          if (previewDraft.status === STATUS_AWAITING_APPROVAL) {
            toast(tr('Story preview is ready for manual approval.', 'Tiền đề đã sẵn sàng để duyệt thủ công.'), 'success', 7000);
          } else if (previewDraft.status !== 'CANCELLED') {
            creationError = { code: previewDraft.lastGenerationErrorCode, message: tr('Generation failed. Review the draft details below before retrying.', 'Tạo vụ án thất bại. Hãy kiểm tra chi tiết bản nháp bên dưới trước khi thử lại.') };
          }
        } else {
          startPolling(activeDraftId, version);
          toast(tr('Story preview generation was queued.', 'Đã xếp hàng tạo tiền đề.'), 'success', 5000);
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
        await loadDraftList();
        if (disposed || version !== runVersion) return;
        draw(latest || visibleDraft);
      }
    });

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

  async function cancelDraft(draftId, button) {
    if (!window.confirm(tr(
      "Cancel this draft and stop future generation? Work already performed may still incur cost. Cancelling does not reset today's creation limit.",
      'Hủy bản nháp này và dừng các bước tạo tiếp theo? Công việc đã thực hiện vẫn có thể phát sinh chi phí. Hủy bản nháp không đặt lại hạn mức tạo hôm nay.'
    ))) return;
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
    disposePresentation();
    runVersion += 1;
    stopPolling();
    stopProgressClock();
  };
}
