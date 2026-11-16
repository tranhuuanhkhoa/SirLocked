/** Registers every sirlocked-studio tool on an MCP server. Handlers live in src/tools/ and are unit tested directly. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { StudioError } from './bridge-client.js';
import { assetProcess, assetVariant, PROCESS_OPS } from './tools/assets.js';
import { bridgeCheck, bridgeList, bridgeRelease, bridgeSubmit, bridgeTake } from './tools/bridge.js';
import type { ToolContext } from './tools/context.js';
import {
  assetsComplete, assetsNeeded, assetUpload, draftApproveGate, draftGet, draftImport, draftReport, playerView,
} from './tools/draft.js';
import { librarySearch, librarySync } from './tools/library.js';
import { playtest } from './tools/playtest.js';
import { VARIANT_TYPES } from './image/variant.js';

export const TOOL_NAMES = [
  'bridge_list', 'bridge_take', 'bridge_check', 'bridge_submit', 'bridge_release',
  'draft_get', 'draft_approve_gate', 'draft_import', 'draft_report', 'player_view',
  'assets_needed', 'asset_upload', 'assets_complete',
  'library_search', 'library_sync', 'asset_process', 'asset_variant', 'playtest',
] as const;

type Handler = (args: any) => Promise<unknown> | unknown;

export function toolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 1) }] };
}

export function toolError(error: unknown) {
  const studio = error instanceof StudioError ? error : null;
  const payload = {
    error: studio?.code ?? 'ERROR',
    message: error instanceof Error ? error.message : String(error),
    status: studio?.status || undefined,
    details: studio?.details,
  };
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 1) }] };
}

function wrap(handler: Handler) {
  return async (args: any) => {
    try {
      return toolResult(await handler(args ?? {}));
    } catch (error) {
      return toolError(error);
    }
  };
}

const id = z.string().min(1).max(96);

export function createStudioServer(ctx: ToolContext, version = '0.1.0'): McpServer {
  const server = new McpServer({ name: 'sirlocked-studio', version });
  const tool = (name: (typeof TOOL_NAMES)[number], description: string, inputSchema: Record<string, z.ZodTypeAny>, handler: Handler) =>
    server.registerTool(name, { description, inputSchema }, wrap(handler));

  // ---------------------------------------------------------------- bridge
  tool('bridge_list', 'Danh sách yêu cầu của server đang chờ Claude (mặc định PENDING). Đơn VIP chỉ hiện sau khi Yen duyệt.',
    { status: z.string().optional().describe('PENDING | TAKEN | SUBMITTED | ACCEPTED | REJECTED | STALE'), draftId: id.optional(), limit: z.number().int().min(1).max(500).optional() },
    (args) => bridgeList(ctx, args));
  tool('bridge_take', 'Nhận một yêu cầu (giữ lease). Ghi prompt.md, schema.json, order.json, instructions.md vào tmp/bridge/<requestId>/ và chỉ trả đường dẫn. Câu trả lời viết vào answer.json cùng thư mục.',
    { requestId: id }, (args) => bridgeTake(ctx, args));
  tool('bridge_check', 'Kiểm file JSON theo schema.json của yêu cầu (ajv, draft 2020-12 như server). Trả lỗi gọn: đường dẫn trường + lý do. Mặc định file = tmp/bridge/<requestId>/answer.json.',
    { requestId: id.optional(), file: z.string().optional(), schemaFile: z.string().optional() }, (args) => bridgeCheck(ctx, args));
  tool('bridge_submit', 'Nộp câu trả lời ĐỌC TỪ FILE (mặc định tmp/bridge/<requestId>/answer.json). Kiểm schema trên máy trước; đạt mới gửi. Trả kết quả kiểm của server và việc tiếp theo.',
    { requestId: id, file: z.string().optional(), skipLocalCheck: z.boolean().optional() }, (args) => bridgeSubmit(ctx, args));
  tool('bridge_release', 'Trả lại yêu cầu đã nhận (bỏ dở) để lần sau nhận lại.', { requestId: id }, (args) => bridgeRelease(ctx, args));

  // ---------------------------------------------------------------- drafts
  tool('draft_get', 'Trạng thái draft: cổng đang chờ, báo cáo validator, yêu cầu đang mở, việc tiếp theo. Bản đầy đủ ghi ở tmp/bridge/<draftId>/draft.json.',
    { draftId: id }, (args) => draftGet(ctx, args));
  tool('draft_approve_gate', 'CHỈ dùng khi đơn ở chế độ nhanh (FAST) VÀ mọi lớp kiểm tra đều đạt: bot qua cổng STORY, LOGIC hoặc LAYOUT. Cổng TRUTH luôn do Yen duyệt. Đơn FULL: không dùng.',
    { draftId: id, gate: z.enum(['STORY', 'LOGIC', 'LAYOUT']), allChecksPassed: z.boolean().describe('true chỉ khi schema, validator, thám tử mù, biên tập đều đạt') },
    (args) => draftApproveGate(ctx, args));
  tool('draft_import', 'Import draft READY_TO_PUBLISH thành vụ CHƯA đăng để chạy thử; lưu case JSON đầy đủ vào tmp/bridge/<draftId>/case.json. Không có tool publish: chỉ ADMIN đăng.',
    { draftId: id }, (args) => draftImport(ctx, args));
  tool('draft_report', 'Đẩy report.md (mặc định tmp/bridge/<draftId>/report.md) lên draft để Yen xem trên admin.',
    { draftId: id, file: z.string().optional() }, (args) => draftReport(ctx, args));
  tool('player_view', 'Ghi player-view.json (những gì người chơi thấy, đã bỏ lời giải) vào tmp/bridge/<draftId>/ cho agent tham-tu-mu.',
    { draftId: id }, (args) => playerView(ctx, args));

  // ---------------------------------------------------------------- pictures of a draft
  tool('assets_needed', 'Danh sách ô hình của draft (bìa, nền cảnh, sprite, chân dung, vật phẩm): kích thước, nền trong suốt, mô tả mỹ thuật, ô nào đang được xin. Bản đầy đủ ở tmp/bridge/<draftId>/assets-needed.json.',
    { draftId: id, onlyRequested: z.boolean().optional() }, (args) => assetsNeeded(ctx, args));
  tool('asset_upload', 'Tải hình (PNG/WebP, ≤ 5 MB) cho một ô của draft qua bridge (server đưa lên Cloudinary).',
    { draftId: id, slotId: z.string().min(1), file: z.string().min(1), width: z.number().int().optional(), height: z.number().int().optional(), transparent: z.boolean().optional() },
    (args) => assetUpload(ctx, args));
  tool('assets_complete', 'Báo server đã đủ hình cho yêu cầu ASSETS đang mở; pipeline đi tiếp.', { draftId: id }, (args) => assetsComplete(ctx, args));

  // ---------------------------------------------------------------- library
  tool('library_search', 'Tìm hình có sẵn theo thế giới (HANG_DUONG_VICTORIAN, TAISHO_JAPAN, SHANGHAI_1930, ALL), loại (OUTDOOR_MAP, INTERIOR, NPC, ITEM, PROP), nhãn, từ khóa (không cần dấu). Trả key, tên, url, ảnh nhỏ. download: true chép/tải file về tmp/library-cache/<key>/.',
    {
      world: z.string().optional(), kind: z.string().optional(), tags: z.array(z.string()).optional(), query: z.string().optional(),
      includeRetired: z.boolean().optional(), parentKey: z.string().optional(), limit: z.number().int().min(1).max(500).optional(),
      download: z.boolean().optional(), fromServer: z.boolean().optional().describe('gộp thêm danh sách trên server (cần khóa bridge)'),
    }, (args) => librarySearch(ctx, args));
  tool('library_sync', 'Đồng bộ thư viện với server (/api/bridge/library): push tải file mới lên (Cloudinary) rồi ghi assetLibrary; pull kéo URL về index local. index.json được cập nhật.',
    { direction: z.enum(['pull', 'push', 'both']).optional(), keys: z.array(z.string()).optional(), dryRun: z.boolean().optional() },
    (args) => librarySync(ctx, args));

  // ---------------------------------------------------------------- local picture work
  tool('asset_process', [
    'Xử lý ảnh trên máy, 0 lượt PixelLab. op:',
    'inspect | check_size {width,height,transparent} | cut_background {tolerance,color} | to_webp |',
    'clean_text {rects:[[x0,y0,x1,y1]], mode:"fill"|"inpaint"} (xóa chữ vô nghĩa AI vẽ lên vật phẩm) |',
    'cover {scene, portraits[]} (ảnh bìa ghép) | idle_breathe (hoạt ảnh thở bằng code, sheet 1152x128) |',
    'sprite_sheet (zip PixelLab có idle thì dùng, không thì thở) | portrait (288x288 nearest) | npc_bundle (sprite+idle+portrait) |',
    'mask_from_shapes {width,height,walk:[{rect}|{diamond}],block:[...]} | walkable {picture} (mask -> walkGrid, walkableArea, navigationObstacles + ảnh phủ để tự kiểm) |',
    'fit {width,height,mode:"contain"|"cover"} (đưa ảnh pixel vào ô khác kích thước bằng phóng nguyên lần, không nhòe).',
  ].join(' '),
    { op: z.enum(PROCESS_OPS), input: z.string().optional(), inputs: z.array(z.string()).optional(), output: z.string().optional(), params: z.record(z.string(), z.any()).optional() },
    (args) => assetProcess(ctx, args));
  tool('asset_variant', [
    'Biến thể miễn phí từ ảnh/mục thư viện có sẵn (input = đường dẫn hoặc key thư viện). type:',
    'night {lights:[{x,y,r}], windows:[{x0,y0,x1,y1}]} (Claude tự nhìn ảnh để chấm đèn, cửa) | dusk | snow {amount} |',
    'after_rain {lights, puddles:[{x,y,rx,ry}]} | mirror {boxes, points, coordinateWidth, mask} | recolor {hueFrom:[min,max], hueTo, satMul, minSat, region} |',
    'compose {add:[{source,x,y,scale,flip,shadow}], remove:[[x0,y0,x1,y1]]}. Không đổi được hình khối (thêm tầng, đổi phòng): cần PixelLab.',
    'Lưu vào index thư viện (parentKey, variant, source VARIANT) và ghi ảnh so sánh trước/sau.',
  ].join(' '),
    {
      type: z.enum(VARIANT_TYPES), input: z.string().min(1), params: z.record(z.string(), z.any()).optional(), key: z.string().optional(), output: z.string().optional(),
      saveToLibrary: z.boolean().optional(), nameVi: z.string().optional(), nameEn: z.string().optional(), tags: z.array(z.string()).optional(),
    }, (args) => assetVariant(ctx, args));

  // ---------------------------------------------------------------- playtest
  tool('playtest', 'Chạy game trên MÁY NÀY (tự dựng Mongo + API + web nếu chưa có), hai thám tử tự chơi theo lời giải, chụp từng cảnh, gom lỗi console, ước tính thời gian chơi, kiểm nhạc/thời tiết. Lấy case qua draftId (bridge) hoặc casePath. Chạy 1–3 phút (lần đầu build lâu hơn).',
    {
      draftId: id.optional(), casePath: z.string().optional(), apiUrl: z.string().optional(), webUrl: z.string().optional(),
      screenshots: z.boolean().optional(), reimport: z.boolean().optional(), timeoutMinutes: z.number().int().min(2).max(60).optional(),
    }, (args) => playtest(ctx, args));

  return server;
}
