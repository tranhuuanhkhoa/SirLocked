# Âm thanh, thời tiết, giọng bíp trong case JSON

Các trường dưới đây đều **tùy chọn**. Vụ cũ không có chúng vẫn hợp lệ và chạy y như trước. Chúng đi trọn đường: hợp đồng AI (bot Claude), model, import, case đã publish, API trả cho game (chi tiết vụ và runtime cảnh V3). Mẫu chuẩn: vụ "Đồng hồ bỏ túi đêm mưa" (`Claude outputs/vu-an-mau/dong-ho-dem-mua/case-pixel-dong-ho-dem-mua-vi.json`, bản sao làm fixture test ở `src/BE/Tests/Fixtures/`).

## Giọng bíp của nhân vật

`characters[].voice.blip`

```json
"voice": { "blip": { "pitch": 520, "speed": 24, "wave": "sine", "variance": 0.25 } }
```

| Trường | Giá trị | Ý nghĩa |
| --- | --- | --- |
| `pitch` | 80–1200 | Cao độ (Hz) |
| `speed` | 10–40 | Số chữ mỗi giây khi thoại chạy |
| `wave` | `square` \| `triangle` \| `sine` \| `sawtooth` | Dạng sóng của bộ tạo âm |
| `variance` | 0–1 | Độ dao động cao độ giữa các chữ |

Bíp không phụ thuộc ngôn ngữ: vụ tiếng Anh dùng y như vụ tiếng Việt. Game nhận `voice` trong danh sách nhân vật của API chi tiết vụ (`GET /api/cases/{caseId}`, mảng `characters`) và trong `characters` của từng cảnh.

## Nhạc của khu

`stages[].scenes[].runtime.audio.music` (cạnh `ambienceUrl` và `cues` đã có)

```json
"music": {
  "url": "/assets/audio/music/hang-duong/ben-cang-dem-mua.ogg",
  "fallbackUrl": "/assets/audio/music/hang-duong/ben-cang-dem-mua.mp3",
  "title": "Bến cảng đêm mưa",
  "source": "claude-8bit",
  "license": "Sir Locked (tự sáng tác)",
  "loopStartSec": 0,
  "loopEndSec": 50.526327,
  "volume": 0.55
}
```

| Trường | Bắt buộc | Quy tắc |
| --- | --- | --- |
| `url` | có | `.ogg`; `https://…` hoặc đường dẫn `/assets/…` (không có `..`) |
| `fallbackUrl` | không | `.mp3` cho trình duyệt không phát được Ogg; cùng quy tắc URL |
| `title`, `source`, `license` | có | Ghi nguồn và giấy phép, chép từ thư viện nhạc (`music_search`) |
| `loopStartSec`, `loopEndSec` | không | Giây; `loopEndSec` phải lớn hơn `loopStartSec`. Ghi đủ 6 chữ số thập phân như thư viện (đúng tới mẫu): Chromium giải mã Vorbis còn dư vài trăm mẫu đệm sau mẫu cuối, game lặp đúng ở `loopEndSec` |
| `volume` | có | 0–1 |

Mỗi khu một bài, lặp liền; đổi khu thì chuyển bài êm (VUAN-4 làm phần phát).

### Thư viện nhạc (VUAN-5)

Nhạc của các khu lấy từ thư viện của game, không trỏ ra ngoài: `src/FE/public/assets/audio/music/<thế giới>/<bài>.{ogg,mp3}` (`hang-duong`, `taisho`, `thuong-hai`, `chung` cho bài dùng chung theo không khí), chỉ mục `src/FE/public/assets/audio/music/index.json`.

- **Chỉ mục**, mỗi bài: `id`, `file` (.ogg), `fallback` (.mp3), `title`, `labelVi`, `author`, `source` (`opengameart` | `kenney` | `pixabay` | `claude-8bit`), `sourceUrl` (trang gốc), `license`, `licenseUrl`, `world` (hoặc `ALL`), `areas[]`, `moods[]`, `bpm` (ước lượng), `loopStartSec`, `loopEndSec`, `durationSec`, `loudness`, `volume` gợi ý, `sha256`/`bytes` của file .ogg, `fallbackSha256`/`fallbackBytes` của file .mp3, `original` (link file gốc, sha256 file gốc, ngày tải), `processing` (đoạn cắt từ file gốc, độ giống ở mối nối, đo mối nối). Đầu file có bảng `licenses` (tóm tắt tiếng Việt), `worlds` (khu của từng thế giới, kèm key và nhãn của thư viện hình) và `moods`.
- **Giấy phép cho phép:** OpenGameArt chỉ bài ghi CC0 (`CC0 1.0`); Kenney (`Kenney CC0`); Pixabay (`Pixabay Content License`, chỉ khi hai nguồn trên thiếu, giữ `sourceUrl` để khiếu nại khi YouTube/TikTok nhận nhầm); bài Claude tự viết (`Sir Locked (tự sáng tác)`, `sourceUrl` là file mô tả trong `tools/music-gen/songs/`).
- **Khu:** Hàng Đường `street`, `harbor`, `train_station`, `market`, `lake_park`, `villa_district`, `shop`, `clock_shop`, `tavern`, `tea_room`, `police_station`, `theater`, `study`; Taishō `lantern_street`, `tram_station`, `shrine_garden`, `tea_house`, `tatami_lodging`, `kabuki_backstage`; Thượng Hải `concession_street`, `river_bund`, `shikumen_alley`, `tea_house`, `singing_hall`, `mahjong_parlor`, `detective_office`. **Mood dùng chung:** `dieu-tra-yen`, `cang-thang`, `bi-an`, `lat-mat`, `buon`, `ket-thuc` (thêm `am-ap`, `yen-tinh`, `nhon-nhip`, `sang-trong`, `vui`).
- **Xử lý** (`tools/music-gen/build_library.py`, đọc `tools/music-gen/library.json`): tải file gốc vào `tmp/music-src/` và kiểm sha256; tìm đoạn lặp bằng ma trận tự tương đồng của phổ (đoạn nhạc quanh điểm cuối giống đoạn quanh điểm đầu), dời điểm đầu vào nhịp mạnh, khớp sóng ở điểm cuối, crossfade 80 ms ở mối nối; bài tác giả đã làm lặp liền thì giữ nguyên cả file; chuẩn −16 LUFS, đỉnh thật ≤ −1,5 dBTP (limiter vòng, không làm hở mối nối); xuất Vorbis q2 (~96 kbit/s) và MP3 96 kbit/s. Mỗi file ≤ 1,5 MiB, cả thư viện ≤ 40 MiB. Cần `numpy`, `scipy`, ffmpeg (`FFMPEG_PATH` nếu không có trên PATH), `curl`.
- **Bài 8-bit tự viết:** `tools/music-gen/music_gen.py` dựng bài từ file mô tả JSON (`songs/*.json`: `bpm`, `bars`, một hợp âm mỗi ô nhịp, các bè `bass` / `arp` / `pad` / `melody` / `comp` / `hits`, dạng sóng `pulse`, `tri`, `sine`, `saw`, `pluck`, `noise`, swing, vang, lọc). Đuôi nốt, tiếng vang và bộ lọc quấn vòng nên file lặp liền. Hai bài của vụ mẫu (`ben-cang-dem-mua`, `tiem-dong-ho`) và `thuong-hai/tra-lau` làm theo cách này.
- **Bot chọn nhạc:** tool `music_search { world, area, mood, query }` của `tools/studio-mcp` trả bài hợp nhất trước, kèm object `music` ghi thẳng vào `scenes[].atmosphere.audio.music` (skill `/tao-vu-an` bước 8).
- **Ghi công trong game:** cuối bảng Âm thanh có mục "Âm nhạc": các bài đã nghe trong phiên, mới nhất trước, tên bài, tác giả, giấy phép, link trang gốc (lấy từ chỉ mục); bài tự viết ghi "Sir Locked tự sáng tác".
- **Kiểm tra:** `npm run test:music` (file có đủ, sha256 khớp, giấy phép trong danh sách, khu nào cũng có bài, dung lượng, CI chạy) và `tests/music-loop.spec.ts` (trình duyệt giải mã từng bài cả .ogg lẫn .mp3, phát lặp 3 lần đúng như game, đo biên độ quanh mối nối: không tiếng tách, không khoảng lặng).

## Thời tiết, trong nhà, thời điểm

`stages[].scenes[].runtime.weather`, `runtime.indoor`, `runtime.timeOfDay`

```json
"weather": { "type": "RAIN", "intensity": 0.7 },
"indoor": false,
"timeOfDay": "NIGHT"
```

| Trường | Giá trị |
| --- | --- |
| `weather.type` | `NONE` \| `RAIN` \| `WIND` \| `SNOW` \| `STORM` |
| `weather.intensity` | 0–1 |
| `indoor` | `true` \| `false` |
| `timeOfDay` | `DAY` \| `DUSK` \| `NIGHT` |

Luật (validator báo lỗi, không bao giờ văng exception):

- `indoor = true` thì `weather` phải là `NONE` hoặc không có (`IndoorWeather`).
- Giá trị ngoài khoảng, giá trị lạ, URL không phải `https://` hoặc `/assets/…` đều bị báo lỗi kèm đường dẫn trường.

Trong game (VUAN-4): thời tiết chỉ có ở cảnh ngoài trời; vào nhà tắt hết tiếng và hình thời tiết, chỉ còn nhạc khu; ra ngoài thì bật lại; giông có chớp sáng rồi sấm sau vài giây; đêm và hoàng hôn dùng ảnh nền biến thể, game tô màu nhân vật và vật phẩm cho khớp.

## Trong game (VUAN-4)

| Phần | Cách làm | File |
| --- | --- | --- |
| Bíp | WebAudio, một tiếng mỗi chữ cái/chữ số khi lời nhân chứng chạy ra; khoảng trắng, dấu câu không kêu, dấu câu ngừng lâu gấp 5; cao độ dao động theo `variance` bằng bộ ngẫu nhiên có seed theo `characterId`; tối đa 3 tiếng cùng lúc. Nhân vật có `voice.blip` thì chữ chạy theo `speed`; nhân vật không có thì giữ tốc độ cũ và dùng giọng mặc định sinh từ id. Lời của thám tử không kêu | `Client/js/game/atmosphere/blipCore.js`, `dialoguePresenter.ts` |
| Nhạc | Tải và giải mã khi vào khu (lazy), giữ tối đa 4 bài đã tải; lặp liền bằng `loopStartSec`/`loopEndSec`; cùng bài thì phát tiếp, khác bài chuyển chéo 1,5 giây; có thoại thì còn 40 %; `.ogg` trước, trình duyệt không phát Ogg thì `.mp3`; không có `music` thì như cũ (`ambienceUrl` hoặc nền tổng hợp) | `audioController.ts`, `atmosphere/musicCore.js` |
| Tiếng thời tiết | Nhiễu lọc: mưa (high-pass + low-pass), gió (LFO trên bộ lọc), tuyết (gió nhẹ), giông (mưa to + sấm sau chớp 1–3 giây); độ to theo `intensity`, đi theo thanh Hiệu ứng | `audioController.ts`, `atmosphere/weatherCore.js` |
| Hình thời tiết | Lớp Phaser trên cảnh, dưới nhãn cửa và giao diện; hạt vuông theo lưới pixel của cảnh; mưa xiên + tóe nước, tuyết lượn, lá và bụi bay ngang, giông có chớp cả màn hình 6–12 giây một lần (tắt chớp khi `prefers-reduced-motion`) | `weatherLayer.ts` |
| Máy yếu | Màn nhỏ + ít nhân CPU bắt đầu ở nửa số hạt; 8 giây đầu đo FPS theo cửa sổ 2 giây, dưới 40 thì giảm còn nửa rồi một phần tư; nút "Tắt hiệu ứng thời tiết" | `weatherCore.js` |
| Thời điểm | `NIGHT` tô xanh tối, `DUSK` tô cam nhẹ cho nhân vật, người chơi, vật phẩm, lớp cảnh trước | `gamePage.ts` |
| Tiếng hiệu ứng | Gói CC0 của Kenney ở `public/assets/audio/sfx/` (`LICENSES.json`); cue cũ `/assets/audio/point-click/<cue>.wav` của vụ đã đăng tự chuyển sang gói mới, file cũ làm dự phòng; cue trỏ vào `sfx/ui/` có bộ tự tổng hợp `sfx/tu-tong-hop/` làm dự phòng; 11 bộ tiếng giải đố (10 loại tương tác + giải đố cổ điển) | `atmosphere/sfxCatalog.js`, `puzzles/host.ts`, `scripts/build-sfx-pack.mjs` |
| Cài đặt | Thanh Nhạc, Hiệu ứng, Bíp nhân vật, nút Tắt hiệu ứng thời tiết; lưu trong `localStorage` `sirlocked.audio.v1` (thêm `blips`, `weatherEffects`) | `audioController.ts` |

Công cụ của bot (`tools/studio-mcp`): `blip_preview` (WAV từng nhân vật, cùng code với game), `weather_preview` (video 5–8 giây một cảnh với thời tiết/thời điểm cho trước), `sfx_search` (tìm trong gói CC0), `music_search` (tìm nhạc khu trong thư viện nhạc, VUAN-5).

## Đường đi qua server

- **Hợp đồng AI.** Bot gửi `voice` trong mỗi nhân vật. Không khí cảnh gửi dưới khóa `atmosphere` của cảnh (`{ audio: { music }, weather, indoor, timeOfDay }`), vì `runtime` là phần server tự dựng từ bố cục. Server ghi `atmosphere` vào `runtime` của cảnh và giữ nguyên khi dựng lại bố cục. Cả hai đều tùy chọn trong schema (`CaseAtmosphereSchemas`), kể cả nội dung projection (`characters.*.voice`, `scenes.*.atmosphere`).
- **Model và lưu trữ.** `CaseCharacter.Voice`, `SceneRuntime.Weather/Indoor/TimeOfDay`, `SceneAudioConfig.Music`; không ghi khi rỗng, nên vụ cũ lưu y như trước.
- **Import và vụ đã đăng.** Import giữ nguyên các trường (đã test với vụ mẫu, kể cả vòng lưu BSON của MongoDB).
- **API của game.** `CaseCharacterDto.Voice`; runtime cảnh V3 sao chép qua whitelist `V3SceneProjectionPolicy.CloneRuntime` (đã thêm `audio.music`, `weather`, `indoor`, `timeOfDay`).
- **Đơn hàng.** `order.weather` và `order.timeOfDay` được đưa vào prompt; Claude chọn thời tiết cho cảnh ngoài trời, để trống cảnh trong nhà.
