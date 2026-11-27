const orderEnds = new Set(['SUBMITTED', 'REJECTED', 'CANCELLED']);
const steps = {
  CreateStoryPreview: ['Writing the story outline', 'Đang viết cốt truyện'],
  GenerateCaseSeed: ['Choosing the setting and suspects', 'Đang xây bối cảnh và nghi phạm'],
  GenerateCoreTruth: ['Working out what happened', 'Đang xác định sự việc'],
  BuildTrueTimeline: ['Putting events in order', 'Đang dựng dòng thời gian'],
  BuildOpportunityMatrix: ['Checking who had the opportunity', 'Đang kiểm tra cơ hội gây án'],
  GenerateCausalEvidence: ['Writing the clues', 'Đang xây dựng manh mối'],
  BuildStatements: ['Writing witness statements', 'Đang viết lời khai'],
  BuildProofGraph: ['Connecting the evidence', 'Đang đối chiếu chứng cứ'],
  ReviewCaseTruthFeasibility: ['Checking that the story holds together', 'Đang kiểm tra tính nhất quán'],
  RepairTruthFindings: ['Fixing story inconsistencies', 'Đang sửa chi tiết chưa khớp'],
  GenerateFullCaseJson: ['Writing dialogue, clues and puzzles', 'Đang viết hội thoại, manh mối và câu đố'],
  RepairFullCaseJson: ['Correcting the investigation', 'Đang chỉnh nội dung điều tra'],
  ReviewV3PairMatrix: ['Checking the confrontations', 'Đang duyệt phần đối chất'],
  RepairV3SemanticLogic: ['Fixing a confrontation', 'Đang sửa phần đối chất'],
  RepairProjectionFields: ['Correcting gameplay text', 'Đang sửa nội dung trong màn chơi'],
  ReviewBlindSolvability: ['Testing the case with the blind detective', 'Thám tử mù đang giải thử'],
  ReviewBlindSolutionMeaning: ['Checking the detective’s solution', 'Đang kiểm tra lời giải của thám tử'],
  LocalizeCaseText: ['Preparing the second language', 'Đang soạn bản ngôn ngữ thứ hai'],
  UploadAssets: ['Preparing case artwork', 'Đang chuẩn bị ảnh vụ án'],
  PlanScenePlacement: ['Planning scene placement', 'Đang bố trí cảnh'],
  CutsceneScript: ['Writing the opening scene', 'Đang viết cảnh mở đầu'],
  CutsceneScriptRepair: ['Polishing the opening scene', 'Đang chỉnh cảnh mở đầu'],
};

export function humanAiStep(step) {
  return steps[String(step || '').split(':')[0]];
}

export function orderClock(draft, stopped) {
  if (!draft) return {};
  const started = Date.parse(draft.createdAt);
  const finished = draft.orderStatusHistory?.find(change => orderEnds.has(change.status));
  const caseFinished = draft.introCutsceneStartedAt || finished?.at || draft.updatedAt || draft.createdAt;
  return {
    started: Number.isFinite(started) ? started : undefined,
    ended: stopped || draft.introCutsceneStatus === 'QUEUED' ? Date.parse(caseFinished) : undefined,
  };
}

export function formatAiElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}
