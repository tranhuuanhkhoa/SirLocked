#!/usr/bin/env node
/**
 * Phần C — nhập thư viện đợt 0 (0 lượt PixelLab).
 *   node tools/studio-mcp/scripts/import-library.mjs [--source "<thư mục thu-vien-dot0>"]
 *
 * Đọc manifest.jsonl + files/ của đợt 0 (mặc định "Claude outputs/thu-vien-dot0"), xử lý từng file bằng các hàm
 * của asset_process (WebP lossless, ảnh nhỏ, sprite sheet 1152x128, chân dung 288x288, xóa chữ vô nghĩa), gắn thế
 * giới theo tiền tố key, đặt tên tiếng Việt và tiếng Anh, thêm 6 bối cảnh và dàn nhân vật của 2 vụ pixel có sẵn,
 * đánh dấu 2 vật phẩm hỏng và mọi NPC đợt 0 (vẽ kiểu chibi, lệch cỡ) là retired, rồi ghi tools/studio-mcp/library/index.json.
 * File đã xử lý nằm ở tmp/library-build/<key>/ (git bỏ qua). Đưa lên server: tool library_sync { direction: "push" }.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(here, '..');
const repo = path.resolve(studio, '..', '..');
const dist = (file) => new URL(`file:///${path.join(studio, 'dist', 'src', file).replace(/\\/g, '/')}`).href;
const { loadRgba, saveRgba, resizeNearest, hasTransparency } = await import(dist('image/raster.js'));
const { npcFromZip, idleSheet, portrait, cleanText } = await import(dist('image/process.js'));
const { loadIndex, saveIndex, emptyItem, upsertItem } = await import(dist('library/index-store.js'));

const argIndex = process.argv.indexOf('--source');
const source = argIndex > 0 ? path.resolve(process.argv[argIndex + 1]) : path.join(repo, 'Claude outputs', 'thu-vien-dot0');
const manifestFile = path.join(source, 'manifest.jsonl');
if (!existsSync(manifestFile)) {
  console.error(`Không thấy ${manifestFile}. Truyền --source <thư mục có manifest.jsonl và files/>.`);
  process.exit(2);
}
const buildRoot = path.join(repo, 'tmp', 'library-build');
const rel = (file) => path.relative(repo, file).split(path.sep).join('/');
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// ------------------------------------------------------------------------------------------------ worlds and names

export function worldOf(key) {
  if (key.startsWith('v-') || key === 'map-ben-cang' || key === 'room-tiem-dong-ho' || key.startsWith('npc-01')) return 'HANG_DUONG_VICTORIAN';
  if (key.startsWith('j-')) return 'TAISHO_JAPAN';
  if (key.startsWith('c-')) return 'SHANGHAI_1930';
  if (key.startsWith('all-')) return 'ALL';
  // The three pilot items (item-...) were drawn for the Hàng Đường sample case in its style.
  if (key.startsWith('item-')) return 'HANG_DUONG_VICTORIAN';
  return 'ALL';
}

const KIND = { outdoor_map: 'OUTDOOR_MAP', interior: 'INTERIOR', npc: 'NPC', item: 'ITEM' };
const RETIRED = {
  'all-item-manh-thu-xe': 'PixelLab vẽ ra chữ "K" trên mảnh thư: không dùng.',
  'all-item-trang-giay-trang': 'Gần như vô hình trên nền game: không dùng.',
};
/**
 * NPC đợt 0 vẽ bằng create_character từ chữ (prompt "chibi", không có ảnh Sherlock làm mẫu): kiểu chibi đầu to, mắt to,
 * lệch phong cách của Sherlock, Watson và NPC vụ Lò thuốc. Khóa đến khi vẽ lại theo quy trình
 * character-front -> character-rotate -> character-idle trong ai-game-docs/visual-style-templates/pixellab.
 */
const RETIRED_NPC_NOTE = 'NPC đợt 0 vẽ kiểu chibi đầu to (create_character từ chữ, không ảnh Sherlock làm mẫu), lệch phong cách game: khóa đến khi vẽ lại theo templates.json.';
/** Gibberish lettering to remove before use (rect in pixels of the 64x64 item), as in the sample case's ticket. */
const CLEAN_TEXT = { 'item-ve-tau-rach': [[20, 16, 27, 50], [28, 34, 50, 50]] };

const NAMES = {
  'map-ben-cang': ['Bến cảng', 'Harbour'],
  'room-tiem-dong-ho': ['Tiệm đồng hồ', "Clockmaker's shop"],
  'npc-01-co-ban-hoa': ['Cô bán hoa', 'Flower seller'],
  'item-dong-ho-bo-tui-vo': ['Đồng hồ bỏ túi vỡ mặt', 'Cracked pocket watch'],
  'item-ve-tau-rach': ['Vé tàu rách', 'Torn train ticket'],
  'item-lo-thuoc-doc': ['Lọ thuốc độc', 'Poison vial'],
  'v-map-ga-tau': ['Ga tàu và quảng trường', 'Railway station and square'],
  'v-map-cho': ['Phố chợ', 'Market street'],
  'v-map-cong-vien-ho': ['Công viên bờ hồ', 'Lakeside park'],
  'v-map-biet-thu': ['Khu biệt thự', 'Villa district'],
  'j-map-pho-den-long': ['Phố đèn lồng bên kênh', 'Lantern street by the canal'],
  'j-map-ga-xe-dien': ['Ga xe điện', 'Tram station plaza'],
  'j-map-den-vuon': ['Đền và vườn', 'Shrine and garden'],
  'c-map-pho-to-gioi': ['Phố tô giới', 'Concession street'],
  'c-map-ben-song': ['Bến sông', 'Riverside bund'],
  'c-map-ngo-thach-kho-mon': ['Ngõ nhà cổng đá', 'Shikumen lane'],
  'v-room-hieu-vang': ['Hiệu vàng', "Goldsmith's shop"],
  'v-room-hieu-may': ['Hiệu may', "Tailor's shop"],
  'v-room-hieu-sach': ['Hiệu sách', 'Bookshop'],
  'v-room-xuong-in': ['Xưởng in', 'Print shop'],
  'v-room-quan-ruou': ['Quán rượu', 'Pub'],
  'v-room-phong-tra': ['Phòng trà', 'Tea room'],
  'v-room-sanh-khach-san': ['Sảnh khách sạn', 'Hotel lobby'],
  'v-room-phong-khach-san': ['Phòng khách sạn', 'Hotel room'],
  'v-room-so-canh-sat': ['Sở cảnh sát', 'Police station'],
  'v-room-toa-soan': ['Tòa soạn báo', 'Newspaper office'],
  'v-room-phong-kham': ['Phòng khám', "Doctor's surgery"],
  'v-room-hau-truong': ['Hậu trường nhà hát', 'Theatre backstage'],
  'v-room-thu-phong': ['Thư phòng', 'Study'],
  'v-room-phong-ngu': ['Phòng ngủ', 'Bedroom'],
  'v-room-gac-xep': ['Gác xép', 'Attic'],
  'v-room-ham-ruou': ['Hầm rượu', 'Wine cellar'],
  'j-room-nha-tra': ['Nhà trà', 'Teahouse'],
  'j-room-tiem-kimono': ['Tiệm kimono', 'Kimono shop'],
  'j-room-phong-tro': ['Phòng trọ chiếu tatami', 'Tatami boarding room'],
  'j-room-hau-truong-kabuki': ['Hậu trường kabuki', 'Kabuki backstage'],
  'j-room-don-canh-sat': ['Đồn cảnh sát', 'Police box'],
  'j-room-tiem-thuoc': ['Tiệm thuốc', 'Pharmacy'],
  'j-room-bach-hoa': ['Cửa hàng bách hóa kiểu Tây', 'Western-style department store'],
  'j-room-nha-tam': ['Nhà tắm công cộng', 'Public bathhouse'],
  'v-npc-02-quan-gia': ['Quản gia già', 'Elderly butler'],
  'v-npc-03-hau-gai': ['Hầu gái trẻ', 'Young housemaid'],
  'v-npc-04-canh-sat': ['Cảnh sát tuần tra', 'Police constable'],
  'v-npc-05-thanh-tra': ['Thanh tra cảnh sát', 'Police inspector'],
  'v-npc-06-nha-bao': ['Nhà báo trẻ', 'Young reporter'],
  'v-npc-07-bac-si': ['Bác sĩ già', 'Elderly doctor'],
  'v-npc-08-y-ta': ['Y tá', 'Nurse'],
  'v-npc-09-ca-si-opera': ['Ca sĩ opera', 'Opera singer'],
  'v-npc-10-nhac-cong': ['Nhạc công vĩ cầm', 'Violinist'],
  'v-npc-11-thuy-thu': ['Thủy thủ', 'Sailor'],
  'v-npc-12-phu-ben-cang': ['Phu bến cảng', 'Dock worker'],
  'v-npc-13-tre-ban-bao': ['Trẻ bán báo', 'Newsboy'],
  'v-npc-14-quy-ba': ['Quý bà', 'Wealthy lady'],
  'v-npc-15-quy-ong': ['Quý ông', 'Wealthy gentleman'],
  'v-npc-16-ong-lao': ['Ông lão', 'Frail old man'],
  'v-npc-17-ba-goa': ['Bà góa', 'Old widow'],
  'v-npc-18-tho-dong-ho': ['Thợ đồng hồ', 'Clockmaker'],
  'v-npc-19-chu-quan-ruou': ['Chủ quán rượu', 'Pub landlord'],
  'v-npc-20-hau-ban-tra': ['Cô phục vụ phòng trà', 'Tea room waitress'],
  'v-npc-21-linh-muc': ['Linh mục', 'Priest'],
  'v-npc-22-tho-anh-rong': ['Thợ ảnh rong', 'Street photographer'],
  'v-npc-23-giao-su': ['Giáo sư', 'Professor'],
  'v-npc-24-xa-phu': ['Xà phu xe ngựa', 'Hansom cab driver'],
  'v-npc-25-ke-moc-tui': ['Kẻ móc túi', 'Pickpocket'],
  'j-npc-01-geisha': ['Geisha', 'Geisha'],
  'j-npc-02-phu-xe-keo': ['Phu xe kéo', 'Rickshaw puller'],
  'j-npc-03-canh-sat': ['Cảnh sát', 'Policeman'],
  'j-npc-04-nu-sinh': ['Nữ sinh', 'Schoolgirl'],
  'j-npc-05-thuong-gia': ['Thương gia mặc vest', 'Businessman'],
  'j-npc-06-nha-su': ['Nhà sư', 'Buddhist monk'],
  'j-npc-07-co-ban-hang': ['Cô bán hàng', 'Shop girl'],
  'j-npc-08-hoa-si': ['Họa sĩ', 'Painter'],
  'j-npc-09-chu-quan': ['Bà chủ nhà trà', 'Teahouse proprietress'],
  'j-npc-10-tho-moc': ['Thợ mộc', 'Carpenter'],
  'j-npc-11-nha-van': ['Nhà văn', 'Novelist'],
  'j-npc-12-quy-ba': ['Quý bà', 'Wealthy lady'],
  'j-npc-13-ong-lao': ['Ông lão', 'Old man'],
  'j-npc-14-cau-be': ['Cậu bé giao hàng', 'Delivery boy'],
  'all-item-chia-khoa-dong': ['Chìa khóa đồng', 'Brass key'],
  'all-item-chia-khoa-sat': ['Chìa khóa sắt', 'Iron key'],
  'all-item-chum-chia-khoa': ['Chùm chìa khóa', 'Key ring'],
  'all-item-o-khoa-vo': ['Ổ khóa vỡ', 'Broken padlock'],
  'all-item-hop-khoa-so': ['Hộp khóa số', 'Number-dial lockbox'],
  'all-item-bo-mo-khoa': ['Bộ mở khóa', 'Lockpick roll'],
  'all-item-ket-sat-nho': ['Két sắt nhỏ', 'Small safe'],
  'all-item-hom-go': ['Hòm gỗ', 'Wooden strongbox'],
  'all-item-phong-bi-niem': ['Phong bì niêm sáp', 'Wax-sealed envelope'],
  'all-item-manh-thu-xe': ['Mảnh thư xé', 'Torn letter fragments'],
  'all-item-ban-do-gap': ['Bản đồ gấp', 'Folded map'],
  'all-item-anh-chan-dung': ['Ảnh chân dung cũ', 'Old portrait photograph'],
  'all-item-so-cai': ['Sổ cái', 'Ledger'],
  'all-item-nhat-ky-khoa': ['Nhật ký có khóa', 'Diary with a clasp'],
  'all-item-bien-lai': ['Biên lai', 'Receipt'],
  'all-item-the-bai': ['Lá bài', 'Playing card'],
  'all-item-quan-co-ma': ['Quân cờ mã', 'Chess knight'],
  'all-item-trang-giay-trang': ['Trang giấy trắng', 'Blank sheet of paper'],
  'all-item-so-tay-nho': ['Sổ tay nhỏ', 'Pocket notebook'],
  'all-item-lo-thuoc-nau': ['Lọ thuốc nâu', 'Brown medicine bottle'],
  'all-item-goi-bot': ['Gói bột trắng', 'Packet of white powder'],
  'all-item-ong-tiem': ['Ống tiêm cổ', 'Antique syringe'],
  'all-item-hop-thuoc-thiec': ['Hộp thuốc bằng thiếc', 'Tin pill box'],
  'all-item-coi-chay': ['Cối chày đá', 'Mortar and pestle'],
  'all-item-binh-thuy-tinh': ['Bình thủy tinh', 'Chemist flask'],
  'all-item-gia-ong-nghiem': ['Giá ống nghiệm', 'Test tube rack'],
  'all-item-kinh-lup': ['Kính lúp', 'Magnifying glass'],
  'all-item-binh-nuoc-hoa': ['Bình nước hoa', 'Perfume bottle'],
};

// ------------------------------------------------------------------------------------------------ processing

async function processScene(item, file) {
  const image = await loadRgba(readFileSync(file));
  const dir = path.join(buildRoot, item.key);
  const main = path.join(dir, 'main.webp');
  const thumb = path.join(dir, 'thumb.webp');
  await saveRgba(image, main);
  await saveRgba(resizeNearest(image, 128, Math.round((128 * image.height) / image.width)), thumb);
  item.width = image.width;
  item.height = image.height;
  item.local.files = { main: rel(main), thumb: rel(thumb) };
  if (image.width !== 512 || image.height !== 512) item.local.notes.push(`Kích thước ${image.width}x${image.height}, không phải 512x512.`);
  if (hasTransparency(image)) item.local.notes.push('Ảnh cảnh có vùng trong suốt.');
}

async function processItem(item, file) {
  let image = await loadRgba(readFileSync(file));
  if (CLEAN_TEXT[item.key]) {
    const result = cleanText(image, CLEAN_TEXT[item.key].map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 })), { threshold: 40 });
    image = result.image;
    item.local.notes.push(`clean_text: xóa ${result.changed} pixel chữ vô nghĩa (vùng ${JSON.stringify(CLEAN_TEXT[item.key])}).`);
    item.tags.push('da-xoa-chu');
  }
  const dir = path.join(buildRoot, item.key);
  const main = path.join(dir, 'main.webp');
  await saveRgba(image, main);
  item.width = image.width;
  item.height = image.height;
  item.local.files = { main: rel(main) };
  if (!hasTransparency(image)) item.local.notes.push('Vật phẩm không có nền trong suốt.');
}

async function processNpc(item, zipFile) {
  const npc = await npcFromZip(readFileSync(zipFile));
  const sheet = idleSheet(npc);
  const dir = path.join(buildRoot, item.key);
  const files = { sprite: path.join(dir, 'sprite.webp'), idle: path.join(dir, 'idle.webp'), portrait: path.join(dir, 'portrait.webp') };
  await saveRgba(npc.south, files.sprite);
  await saveRgba(sheet.image, files.idle);
  const face = portrait(npc.south);
  await saveRgba(face, files.portrait);
  item.width = face.width;
  item.height = face.height;
  // main = the 288x288 portrait (form thumbnail and case portrait); sprite and idle sheet as extra roles.
  item.local.files = { main: rel(files.portrait), sprite: rel(files.sprite), idle: rel(files.idle) };
  item.local.idleSource = sheet.source;
  item.tags.push(sheet.source === 'pixellab-idle' ? 'co-hoat-anh' : 'hoat-anh-tho-bang-code');
}

// ------------------------------------------------------------------------------------------------ batch 0

mkdirSync(buildRoot, { recursive: true });
const index = loadIndex(path.join(studio, 'library', 'index.json'));
const rows = readFileSync(manifestFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const animations = new Map(rows.filter((row) => row.kind === 'anim').map((row) => [row.key.replace(/-idle$/, ''), row]));
const counts = {};
const problems = [];
for (const row of rows) {
  if (row.kind === 'anim') continue;
  const kind = KIND[row.kind];
  if (!kind) { problems.push(`${row.key}: loại lạ ${row.kind}`); continue; }
  const names = NAMES[row.key];
  if (!names) problems.push(`${row.key}: chưa có tên`);
  const item = emptyItem(row.key, kind, worldOf(row.key));
  item.tags = [...new Set((row.tags ?? []).filter((tag) => !tag.startsWith('the-gioi:') && tag !== 'npc' && tag !== 'vat-pham'))];
  [item.nameVi, item.nameEn] = names ?? [row.key, row.key];
  item.prompt = String(row.prompt ?? '').slice(0, 2000);
  item.pixelLabJobId = String(row.job_id ?? row.character_id ?? row.object_id ?? '');
  item.local = { origin: '', notes: [], styleRef: row.style_ref ?? undefined };
  if (RETIRED[row.key]) {
    item.retired = true;
    item.local.notes.push(RETIRED[row.key]);
  } else if (kind === 'NPC') {
    item.retired = true;
    item.local.notes.push(RETIRED_NPC_NOTE);
  }
  try {
    if (kind === 'NPC') {
      const zip = path.join(source, 'files', 'npc', `${row.key}.zip`);
      item.local.origin = rel(zip);
      await processNpc(item, zip);
      const anim = animations.get(row.key);
      if (anim) item.local.notes.push(`Hoạt ảnh đứng yên PixelLab: job ${anim.job_id}.`);
    } else {
      const folder = { OUTDOOR_MAP: 'outdoor_map', INTERIOR: 'interior', ITEM: 'item' }[kind];
      const file = path.join(source, 'files', folder, `${row.key}.png`);
      item.local.origin = rel(file);
      if (kind === 'ITEM') await processItem(item, file);
      else await processScene(item, file);
    }
  } catch (error) {
    problems.push(`${row.key}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  item.local.sha256 = Object.fromEntries(Object.entries(item.local.files ?? {}).map(([role, file]) => [role, sha(path.join(repo, file))]));
  if (!item.local.notes.length) delete item.local.notes;
  // Keep URLs a previous sync already set (re-running the import never forgets what is on the server).
  const previous = index.items.find((entry) => entry.key === item.key);
  if (previous) {
    item.url = previous.url;
    item.thumbUrl = previous.thumbUrl;
    item.files = previous.files ?? {};
    item.local.uploadedSha256 = previous.local?.uploadedSha256;
    item.firstUsedByCaseId = previous.firstUsedByCaseId ?? '';
  }
  upsertItem(index, item);
  counts[`${item.world}/${kind}`] = (counts[`${item.world}/${kind}`] ?? 0) + 1;
}

// ------------------------------------------------------------------------------------------------ the two pixel cases

const PIXEL = '/assets/pixel/lo-thuoc-thu-nam';
const caseFiles = ['case-pixel-lo-thuoc-thu-nam-vi.json', 'case-pixel-tram-hong-ngoc-vi.json']
  .map((name) => path.join(repo, 'src', 'BE', 'SeedData', 'V3', name));
const cases = caseFiles.map((file) => ({ file, json: JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) }));
const SCENE_NAMES = {
  pho: ['Phố Hàng Đường', 'Hang Duong street'], 'nha-so-7': ['Nhà số 7', 'House number 7'], 'hieu-thuoc': ['Hiệu thuốc', 'Apothecary'],
  'nha-xe': ['Nhà xe ngựa', 'Carriage house'], 'cam-do': ['Tiệm cầm đồ', 'Pawnshop'], 'hieu-anh': ['Hiệu ảnh', 'Photo studio'],
};
for (const [slug, [nameVi, nameEn]] of Object.entries(SCENE_NAMES)) {
  const url = `${PIXEL}/scenes/${slug}.png`;
  const file = path.join(repo, 'src', 'FE', 'public', url);
  const image = await loadRgba(readFileSync(file));
  const scene = cases[0].json.stages.flatMap((stage) => stage.scenes).find((entry) => entry.backgroundUrl === url);
  const projection = scene?.runtime?.render?.projection ?? (slug === 'pho' ? 'topdown' : 'isometric');
  const item = emptyItem(`v-case-${slug}`, projection === 'topdown' ? 'OUTDOOR_MAP' : 'INTERIOR', 'HANG_DUONG_VICTORIAN');
  Object.assign(item, {
    nameVi, nameEn, url, thumbUrl: url, width: image.width, height: image.height,
    tags: ['vu-pixel-co-san', projection === 'topdown' ? 'ngoai-troi' : 'trong-nha', 'co-walk-grid'],
    prompt: `Bối cảnh của 2 vụ pixel có sẵn (Lọ thuốc thứ Năm, Trầm hồng ngọc). ${scene?.description ?? ''}`.slice(0, 2000),
    firstUsedByCaseId: cases[0].json.caseId,
  });
  item.local = {
    origin: `src/FE/public${url}`,
    walk: scene ? { fromCase: rel(cases[0].file), sceneId: scene.sceneId, walkableArea: scene.runtime.walkableArea, projection } : undefined,
    notes: ['Ảnh nằm sẵn trong game (/assets/pixel/...): không cần tải lên Cloudinary. walkGrid lấy trong case JSON ở local.walk.'],
  };
  if (slug === 'pho') item.files = Object.fromEntries((scene?.runtime?.render?.foreground ?? []).map((fg) => [`fg-${fg.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40), fg.url]));
  upsertItem(index, item);
  counts[`HANG_DUONG_VICTORIAN/${item.kind}`] = (counts[`HANG_DUONG_VICTORIAN/${item.kind}`] ?? 0) + 1;
}
const characters = new Map();
for (const { json } of cases) {
  for (const character of json.characters) {
    const sprite = character.presentation?.sprite ?? {};
    const idle = JSON.stringify(character.presentation ?? {}).match(/\/assets\/pixel\/lo-thuoc-thu-nam\/characters\/([a-z0-9-]+)-idle\.png/);
    if (!idle) continue;
    const slug = idle[1];
    if (!characters.has(slug)) characters.set(slug, { slug, names: new Set(), descriptions: new Set(), caseId: json.caseId, sprite });
    characters.get(slug).names.add(character.name);
    characters.get(slug).descriptions.add(character.description);
  }
}
for (const { slug, names, descriptions, caseId } of characters.values()) {
  const idleUrl = `${PIXEL}/characters/${slug}-idle.png`;
  const portraitUrl = `${PIXEL}/characters/${slug}-portrait.png`;
  const face = await loadRgba(readFileSync(path.join(repo, 'src', 'FE', 'public', portraitUrl)));
  const item = emptyItem(`v-case-npc-${slug}`, 'NPC', 'HANG_DUONG_VICTORIAN');
  Object.assign(item, {
    nameVi: [...names].join(' / '), nameEn: [...names].join(' / '), url: portraitUrl, thumbUrl: portraitUrl, width: face.width, height: face.height,
    files: { idle: idleUrl, portrait: portraitUrl }, tags: ['vu-pixel-co-san', 'co-hoat-anh', 'nhan-vat-quen'],
    prompt: `Nhân vật của vụ pixel có sẵn. ${[...descriptions].join(' | ')}`.slice(0, 2000), firstUsedByCaseId: caseId,
  });
  item.local = { origin: `src/FE/public${portraitUrl}`, notes: ['Ảnh nằm sẵn trong game: không cần tải lên. Tên là vai trong các vụ cũ; vụ mới đổi tên, đổi vai được (không dùng một gương mặt cho hai vai trong cùng vụ).'] };
  upsertItem(index, item);
  counts['HANG_DUONG_VICTORIAN/NPC'] = (counts['HANG_DUONG_VICTORIAN/NPC'] ?? 0) + 1;
}

saveIndex(path.join(studio, 'library', 'index.json'), index);
const retired = index.items.filter((item) => item.retired).map((item) => item.key);
console.log(JSON.stringify({ items: index.items.length, counts, retired, problems, build: rel(buildRoot) }, null, 1));
if (problems.length) process.exitCode = 1;
