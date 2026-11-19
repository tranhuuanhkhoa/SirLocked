/** Registers every sirlocked-studio tool on an MCP server. Handlers live in src/tools/ and are unit tested directly. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { StudioError } from './bridge-client.js';
import { assetProcess, assetVariant, PROCESS_OPS } from './tools/assets.js';
import { bridgeAsk, bridgeCheck, bridgeList, bridgeRelease, bridgeSubmit, bridgeTake } from './tools/bridge.js';
import type { ToolContext } from './tools/context.js';
import {
  assetDownload, assetPlan, assetsComplete, assetsNeeded, assetUpload, draftApproveGate, draftGet, draftImport, draftReport, playerView,
} from './tools/draft.js';
import { librarySearch, librarySync } from './tools/library.js';
import { pixellabCharacterZip } from './tools/pixellab.js';
import { playtest } from './tools/playtest.js';
import { blipPreview, sfxSearch, TIMES_OF_DAY, weatherPreview, WEATHER_TYPES } from './tools/atmosphere.js';
import { musicSearch } from './tools/music.js';
import { VARIANT_TYPES } from './image/variant.js';

export const TOOL_NAMES = [
  'bridge_list', 'bridge_take', 'bridge_check', 'bridge_submit', 'bridge_release',
  'draft_get', 'draft_ask', 'draft_approve_gate', 'draft_import', 'draft_report', 'player_view',
  'assets_needed', 'asset_plan', 'asset_upload', 'asset_download', 'pixellab_character_zip', 'assets_complete',
  'library_search', 'library_sync', 'asset_process', 'asset_variant', 'playtest',
  'weather_preview', 'blip_preview', 'sfx_search', 'music_search',
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
  tool('bridge_list', 'Danh sách yêu cầu của server đang chờ Claude (mặc định PENDING), gồm cả đơn của VIP.',
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
  tool('draft_ask', 'Hỏi người đặt đơn trên trang /admin/ai thay vì hỏi trong chat: 2–4 lựa chọn, mỗi lựa chọn có nhãn, mô tả và số lượt PixelLab nếu tốn. Yêu cầu phải đang được bot giữ (bridge_take). Gửi xong thì DỪNG lượt chạy; khi người đặt đơn chọn, bot được gọi lại và đọc decisions.json của yêu cầu.',
    {
      requestId: id,
      key: z.string().regex(/^[a-z0-9-]{1,60}$/).describe('Tên ngắn của câu hỏi, ví dụ "asset-budget"'),
      question: z.string().min(1).max(500),
      options: z.array(z.object({
        id: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().min(1).max(80),
        detail: z.string().max(300).optional(), generations: z.number().int().min(0).optional(),
      })).min(2).max(4),
    },
    (args) => bridgeAsk(ctx, args));
  tool('draft_approve_gate', 'CHỈ dùng khi đơn ở chế độ nhanh (FAST) VÀ mọi lớp kiểm tra đều đạt: bot qua cổng STORY, LOGIC hoặc LAYOUT. Cổng TRUTH luôn do người đặt đơn duyệt. Đơn FULL: không dùng.',
    { draftId: id, gate: z.enum(['STORY', 'LOGIC', 'LAYOUT']), allChecksPassed: z.boolean().describe('true chỉ khi schema, validator, thám tử mù, biên tập đều đạt') },
    (args) => draftApproveGate(ctx, args));
  tool('draft_import', 'Import draft READY_TO_PUBLISH thành vụ CHƯA đăng để chạy thử; lưu case JSON đầy đủ vào tmp/bridge/<draftId>/case.json. Không có tool publish: chỉ ADMIN đăng.',
    { draftId: id }, (args) => draftImport(ctx, args));
  tool('draft_report', 'Đẩy report.md (mặc định tmp/bridge/<draftId>/report.md) lên draft để người đặt đơn xem trên admin.',
    { draftId: id, file: z.string().optional() }, (args) => draftReport(ctx, args));
  tool('player_view', 'Ghi player-view.json (những gì người chơi thấy, đã bỏ lời giải) vào tmp/bridge/<draftId>/ cho agent tham-tu-mu.',
    { draftId: id }, (args) => playerView(ctx, args));

  // ---------------------------------------------------------------- pictures of a draft
  tool('assets_needed', 'Danh sách ô hình của draft: kích thước, nền trong suốt, mô tả, ô nào đang được xin. Vụ pixel (VUAN-6B): nền 512x512, sprite thở 1152x128, chân dung 288x288, icon 64x64, không có ô bìa; kèm subjects (cảnh, NPC, icon) với gợi ý thư viện và kế hoạch request PixelLab (tmp/bridge/<draftId>/pixellab-plan.json). Bản đầy đủ ở tmp/bridge/<draftId>/assets-needed.json.',
    { draftId: id, onlyRequested: z.boolean().optional() }, (args) => assetsNeeded(ctx, args));
  tool('asset_plan', 'Vụ pixel: khai nguồn từng hình trước khi tải lên. choices: [{ subject: "scene:<id>" | "character:<id>" | "item:<id>", source: LIBRARY | VARIANT | PIXELLAB, libraryKey, parentKey, variant, inpaintItems }]. Thư viện và biến thể 0 lượt; PIXELLAB thành request theo templates.json. Vật điều tra nằm trong ảnh cảnh, không dán: cảnh PIXELLAB ghi vật vào visualDescription; cảnh LIBRARY/VARIANT chưa có vật thì khai inpaintItems: [itemId] (một request item-inpaint cho cả cảnh, Inpaint Pro 10 lượt, mask tô rộng theo cả mặt vật nằm lên). Tổng lượt vượt pixelLabCap của đơn thì server từ chối (AI_PIXELLAB_CAP_EXCEEDED): dùng thêm thư viện hoặc hỏi người đặt đơn bằng draft_ask. Chưa có kế hoạch đạt thì server không nhận ảnh.',
    {
      draftId: id,
      choices: z.array(z.object({
        subject: z.string().min(1), source: z.enum(['LIBRARY', 'VARIANT', 'PIXELLAB']), libraryKey: z.string().optional(),
        parentKey: z.string().optional(), variant: z.string().optional(), note: z.string().optional(),
        inpaintItems: z.array(z.string()).optional().describe('cảnh LIBRARY/VARIANT: itemId của vật cần PixelLab vẽ thêm vào ảnh (inpaint)'),
      })),
    }, (args) => assetPlan(ctx, args));
  tool('asset_upload', 'Tải hình (PNG/WebP, ≤ 5 MB) cho một ô của draft qua bridge (server đưa lên Cloudinary).',
    { draftId: id, slotId: z.string().min(1), file: z.string().min(1), width: z.number().int().optional(), height: z.number().int().optional(), transparent: z.boolean().optional() },
    (args) => assetUpload(ctx, args));
  tool('asset_download', 'Tải về máy hình mà một ô của draft ĐÃ có trên server (currentUrl trong assets_needed), lưu ở tmp/bridge/<draftId>/assets/<slotId>.png. Dùng khi bước bố cục cần ảnh nền cảnh để đo và dựng walkGrid mà máy không còn bản gốc. Chỉ tải hình của chính draft, 0 lượt PixelLab.',
    { draftId: id, slotId: z.string().min(1) }, (args) => assetDownload(ctx, args));
  tool('pixellab_character_zip', 'Tải file zip của một nhân vật PixelLab (create_character + animate_character) về tmp/pixellab/<draftId>/chars/<npcId>/character.zip để asset_process npc_bundle cắt sprite thở và chân dung. Chỉ tải từ api.pixellab.ai theo characterId, 0 lượt PixelLab.',
    { draftId: id, npcId: id, characterId: z.string().min(1) }, (args) => pixellabCharacterZip(ctx, args));
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
    'mask_from_shapes {width,height,walk:[{rect}|{diamond}],block:[...]} | walkable {picture} (mask -> walkGrid 128x128 ô 16, walkableArea, navigationObstacles + ảnh phủ để tự kiểm) |',
    'foreground {map, mask, rect:[x0,y0,x1,y1], id, baseRow} (cắt đồ che từ bản đồ NATIVE 512 theo mask, trả layer x,y,width,height,baseY đơn vị runtime x4) |',
    'icon_sheet {names:[...]} (cắt tấm icon PixelLab 256x256 lưới 4x4 thành ô 64x64) |',
    'fit {width,height,mode:"contain"|"cover",scale} (CHỈ cho vụ cũ 1600x900; vụ pixel không dùng) |',
    'inpaint_prep {scene, polygon:[[x,y],...] | polygons | maskImage | rect(s), description, size:128|256|512, id} (cắt khung + mask tự do + context từ cảnh NATIVE 512 để PixelLab vẽ thêm vật, trả sẵn lệnh Inpaint Pro (inpaint_image, mask_image) và số lượt; mask hẹp thì báo MASK_TIGHT) |',
    'inpaint_merge {plan, result, boxes:{itemId:[x0,y0,x1,y1]}} (chỉ chép pixel trong mask của ảnh PixelLab vào cảnh, trả ảnh so sánh và itemPlacement asset rỗng + hotspot phủ từng vật).',
    'VẬT ĐIỀU TRA KHÔNG BAO GIỜ DÁN ẢNH LÊN CẢNH. Vật nên tạo trước: cảnh mới thì ghi mọi vật vào mô tả cảnh để PixelLab vẽ luôn.',
    'Muốn thêm vật đè lên vùng có sẵn thì inpaint cho chuẩn: polygon tô RỘNG theo cả mặt vật nằm lên (cả mặt bàn, ghế, kệ), không ôm sát vật; description kể mọi vật phải có trên mặt đó (trong mask PixelLab vẽ lại hết); xong đo lại ô bấm, clueZones.',
    'itemPlacements[].asset luôn rỗng, ô bấm phủ đúng vật trong ảnh; items[].imageUrl chỉ là icon 64x64 cho túi đồ.',
    'NPC CHUẨN: lấy từ quy trình PixelLab của templates.json (character-front có ảnh Sherlock làm mẫu -> create_character v3 -> idle v3),',
    'sprite south đúng 96x96 (khung trần, cùng khung với Sherlock và Watson V3 96), phong cách tỉ lệ người thật như Sherlock, Watson, NPC vụ Lò thuốc; cao thấp tùy nhân vật trong khung, không chibi.',
    'sprite_sheet, idle_breathe, portrait, npc_bundle từ chối sprite không phải 96x96 (NPC_FORMAT) và zip PixelLab có prompt chibi/đầu to (NPC_STYLE).',
  ].join(' '),
    { op: z.enum(PROCESS_OPS), input: z.string().optional(), inputs: z.array(z.string()).optional(), output: z.string().optional(), params: z.record(z.string(), z.any()).optional() },
    (args) => assetProcess(ctx, args));
  tool('asset_variant', [
    'Biến thể miễn phí từ ảnh/mục thư viện có sẵn (input = đường dẫn hoặc key thư viện). type:',
    'night {lights:[[x,y,r]], windows:[[x0,y0,x1,y1]]} (Claude tự nhìn ảnh để chấm đèn, cửa) | dusk | snow {amount} |',
    'after_rain {lights, puddles:[[x,y,rx,ry]]} | mirror {boxes, points, coordinateWidth, mask} | recolor {hueFrom:[min,max], hueTo, satMul, minSat, region} |',
    'compose {remove:[[x0,y0,x1,y1]]} (xóa vật bằng nội suy, cả mẩu vật cũ sót ngoài mask inpaint). Không dán ảnh vật lên cảnh (ITEM_PASTE_FORBIDDEN): thêm vật bằng asset_process inpaint_prep/inpaint_merge, mask rộng theo cả mặt.',
    'Không đổi được hình khối (thêm tầng, đổi phòng): cần PixelLab.',
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

  // ---------------------------------------------------------------- sound and weather (VUAN-4)
  tool('weather_preview', [
    'Quay 5–20 giây một cảnh trên MÁY NÀY (Vite local, API giả lập, không cần Mongo) với thời tiết và thời điểm cho trước:',
    'weather NONE|RAIN|WIND|SNOW|STORM, intensity 0–1, timeOfDay DAY|DUSK|NIGHT (đặt weather khác NONE thì cảnh thành ngoài trời).',
    'Trả video WebM (MP4 khi có ffmpeg và format mp4) có tiếng của trang (nhạc khu, mưa gió, sấm; sound: false để tắt), ảnh chụp giữa đoạn, số hạt, chớp, tiếng thời tiết có chạy không.',
    'musicId (id từ music_search) đặt bài đó làm nhạc của cảnh trước khi quay.',
    'Ảnh nền đêm/hoàng hôn làm trước bằng asset_variant rồi đưa vào backgroundUrl nếu case chưa trỏ tới.',
  ].join(' '), {
    casePath: z.string().optional(), draftId: id.optional(), sceneId: z.string().optional(),
    weather: z.enum(WEATHER_TYPES).optional(), intensity: z.number().min(0).max(1).optional(), timeOfDay: z.enum(TIMES_OF_DAY).optional(),
    backgroundUrl: z.string().optional(), seconds: z.number().min(5).max(20).optional(),
    width: z.number().int().min(390).max(1920).optional(), height: z.number().int().min(400).max(1080).optional(),
    webUrl: z.string().optional(), outDir: z.string().optional(), name: z.string().optional(), format: z.enum(['webm', 'mp4']).optional(),
    quality: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]).optional().describe('số hạt: 1 đầy đủ, 0.5 hoặc 0.25 như máy yếu'),
    musicId: z.string().optional().describe('id bài trong thư viện nhạc (music_search)'), sound: z.boolean().optional(),
  }, (args) => weatherPreview(ctx, args));
  tool('blip_preview', 'Xuất file WAV nghe thử tiếng bíp của từng nhân vật trong case (render offline, cùng code với game). Nhân vật không có voice.blip dùng giọng mặc định theo characterId. Báo các nhân vật nghe gần giống nhau.',
    { casePath: z.string().optional(), draftId: id.optional(), characterIds: z.array(z.string()).optional(), text: z.string().max(400).optional(), outDir: z.string().optional() },
    (args) => blipPreview(ctx, args));
  tool('sfx_search', 'Tìm trong gói tiếng CC0 của game (src/FE/public/assets/audio/sfx/LICENSES.json): theo cue giao diện (dialogue, discovery, reveal, scene, ping, interact, error), loại giải đố, event (tap, probe, solve, wrong) hoặc nhãn (không cần dấu). Trả file, nguồn, giấy phép.',
    { query: z.string().optional(), cue: z.string().optional(), kind: z.string().optional(), event: z.string().optional(), includeFallback: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() },
    (args) => sfxSearch(ctx, args));
  tool('music_search', [
    'Tìm nhạc nền trong thư viện của game (src/FE/public/assets/audio/music/index.json, ~30 bài CC0/tự viết, lặp liền, -16 LUFS):',
    'world HANG_DUONG_VICTORIAN|TAISHO_JAPAN|SHANGHAI_1930|ALL, area (street, harbor, tea_house... hoặc tên tiếng Việt, hoặc key/nhãn thư viện hình như j-map-pho-den-long),',
    'mood (dieu-tra-yen, cang-thang, bi-an, lat-mat, buon, ket-thuc, am-ap, yen-tinh, nhon-nhip, sang-trong, vui), query (không cần dấu).',
    'Trả id, url .ogg/.mp3, tác giả, nguồn, tóm tắt giấy phép và object music để ghi thẳng vào scenes[].atmosphere.audio.music.',
  ].join(' '), {
    world: z.string().optional(), area: z.string().optional(), mood: z.string().optional(), query: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }, (args) => musicSearch(ctx, args));

  return server;
}
