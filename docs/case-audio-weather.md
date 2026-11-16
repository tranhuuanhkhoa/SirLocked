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

Trong game (VUAN-4): thời tiết chỉ có ở cảnh ngoài trời; vào nhà tắt hết tiếng và hình thời tiết, chỉ còn nhạc khu; ra ngoài thì bật lại; giông có chớp sáng rồi sấm sau vài giây; đêm phủ lớp tối và ánh đèn bằng code.

## Đường đi qua server

- **Hợp đồng AI.** Bot gửi `voice` trong mỗi nhân vật. Không khí cảnh gửi dưới khóa `atmosphere` của cảnh (`{ audio: { music }, weather, indoor, timeOfDay }`), vì `runtime` là phần server tự dựng từ bố cục. Server ghi `atmosphere` vào `runtime` của cảnh và giữ nguyên khi dựng lại bố cục. Cả hai đều tùy chọn trong schema (`CaseAtmosphereSchemas`), kể cả nội dung projection (`characters.*.voice`, `scenes.*.atmosphere`).
- **Model và lưu trữ.** `CaseCharacter.Voice`, `SceneRuntime.Weather/Indoor/TimeOfDay`, `SceneAudioConfig.Music`; không ghi khi rỗng, nên vụ cũ lưu y như trước.
- **Import và vụ đã đăng.** Import giữ nguyên các trường (đã test với vụ mẫu, kể cả vòng lưu BSON của MongoDB).
- **API của game.** `CaseCharacterDto.Voice`; runtime cảnh V3 sao chép qua whitelist `V3SceneProjectionPolicy.CloneRuntime` (đã thêm `audio.music`, `weather`, `indoor`, `timeOfDay`).
- **Đơn hàng.** `order.weather` và `order.timeOfDay` được đưa vào prompt; Claude chọn thời tiết cho cảnh ngoài trời, để trống cảnh trong nhà.
