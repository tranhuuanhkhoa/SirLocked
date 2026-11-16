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
  "license": "Sir Locked (tự sáng tác bằng code)",
  "loopStartSec": 0,
  "loopEndSec": 50.526,
  "volume": 0.55
}
```

| Trường | Bắt buộc | Quy tắc |
| --- | --- | --- |
| `url` | có | `.ogg`; `https://…` hoặc đường dẫn `/assets/…` (không có `..`) |
| `fallbackUrl` | không | `.mp3` cho trình duyệt không phát được Ogg; cùng quy tắc URL |
| `title`, `source`, `license` | có | Ghi nguồn và giấy phép (bảng kê nhạc) |
| `loopStartSec`, `loopEndSec` | không | Giây; `loopEndSec` phải lớn hơn `loopStartSec` |
| `volume` | có | 0–1 |

Mỗi khu một bài, lặp liền; đổi khu thì chuyển bài êm (VUAN-4 làm phần phát).

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

Công cụ của bot (`tools/studio-mcp`): `blip_preview` (WAV từng nhân vật, cùng code với game), `weather_preview` (video 5–8 giây một cảnh với thời tiết/thời điểm cho trước), `sfx_search` (tìm trong gói CC0).

## Đường đi qua server

- **Hợp đồng AI.** Bot gửi `voice` trong mỗi nhân vật. Không khí cảnh gửi dưới khóa `atmosphere` của cảnh (`{ audio: { music }, weather, indoor, timeOfDay }`), vì `runtime` là phần server tự dựng từ bố cục. Server ghi `atmosphere` vào `runtime` của cảnh và giữ nguyên khi dựng lại bố cục. Cả hai đều tùy chọn trong schema (`CaseAtmosphereSchemas`), kể cả nội dung projection (`characters.*.voice`, `scenes.*.atmosphere`).
- **Model và lưu trữ.** `CaseCharacter.Voice`, `SceneRuntime.Weather/Indoor/TimeOfDay`, `SceneAudioConfig.Music`; không ghi khi rỗng, nên vụ cũ lưu y như trước.
- **Import và vụ đã đăng.** Import giữ nguyên các trường (đã test với vụ mẫu, kể cả vòng lưu BSON của MongoDB).
- **API của game.** `CaseCharacterDto.Voice`; runtime cảnh V3 sao chép qua whitelist `V3SceneProjectionPolicy.CloneRuntime` (đã thêm `audio.music`, `weather`, `indoor`, `timeOfDay`).
- **Đơn hàng.** `order.weather` và `order.timeOfDay` được đưa vào prompt; Claude chọn thời tiết cho cảnh ngoài trời, để trống cảnh trong nhà.
