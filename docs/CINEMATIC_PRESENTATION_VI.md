# SirLocked — cinematic presentation và chi phí generation

Triển khai ngày 23/09/2026, trên baseline `d5b05f9`. Giữ stack hiện tại và khả năng đọc case không có presentation. Tài liệu này cập nhật phần presentation/generation của roadmap cũ; không thay thế các gate playtest với người thật.

## Trải nghiệm chơi

- Hội thoại visual novel: portrait lớn, lời thoại phía dưới, vùng câu hỏi/chứng cứ riêng. Click hoặc Space hiện hết câu trước, lần tiếp theo chuyển câu; Escape đóng; lịch sử lưu transcript. Presenter giữ line/progress/focus qua cập nhật đồng đội.
- Portrait video muted, không lip-sync; lỗi tải/autoplay hoặc reduced motion dùng poster. Không gọi AI khi chơi.
- NPC dùng sprite sheet nếu được khai báo; ảnh cũ có nhịp thở nhẹ và hitbox độc lập. Reduced motion giữ ảnh tĩnh. HUD/input thay đổi không dựng lại toàn cảnh Phaser.
- Intro/reveal/ending do `CutsceneController` quản lý. Skip chỉ tác động người xem; không ghi progression. Trạng thái đã xem lưu cục bộ theo user/room/version; xóa dữ liệu trình duyệt sẽ xóa lịch sử xem. Ending chỉ được cấp trong kết quả tương ứng. Cache chỉ giữ media đang xem và panel/clip kế tiếp đã được server cho phép; abort/revoke khi không dùng. Reduced motion không preload video.
- Âm thanh gồm ambience tổng hợp nhẹ theo scene và cue tương tác; chỉnh nhạc/SFX riêng, mute, duck khi hội thoại và dừng khi tab ẩn. Module có hook ambience URL cho lập trình viên, chưa có field audio authoring trong case/admin; chưa có lồng tiếng hoặc thư viện nhạc được cấp phép riêng.
- Recap lấy shared resolved truths và nguồn được phép thấy, không gọi LLM. Ping chỉ có DISCOVERY/COMPARE/WAITING, TTL 8 giây, cooldown 3 giây/người/phòng; không gửi nội dung chứng cứ. Cooldown dùng bộ nhớ trong deployment một API instance hiện tại.

## Authoring và duyệt video

Trong AI Creator, mở draft đã tạo và duyệt nội dung ở trạng thái **READY_TO_PUBLISH**, trước lần import/publish đầu tiên → **Mở storyboard và chi phí**. Storyboard mặc định dùng ảnh cover/scene và tối đa ba portrait có sẵn. Art direction giữ pixel Victorian; UI render chữ bên ngoài video. Draft đã import/publish vẫn xem được presentation, nhưng bị chặn tạo video trả phí vì workflow hiện tại không hỗ trợ gắn thêm vào draft đã xuất bản. Muốn author presentation mới, dùng một draft chưa import.

1. Kiểm tra ảnh tham chiếu, chỉ dẫn chuyển động, caption và thời lượng. Intro chỉ kể thông tin mở đầu; ending chỉ dùng truth đã xác nhận. Duyệt nội dung này là bước bắt buộc của người biên tập: kiểm tra JSON không chứng minh caption không chứa spoiler.
2. Lưu storyboard. Mỗi thay đổi vô hiệu hóa duyệt dự toán; clip thay đổi cần duyệt lại, clip không đổi giữ media/approval đã đạt.
3. Kiểm tra giá/model/version hiện tại, tick duyệt dự toán rồi tạo toàn bộ hoặc duyệt giá riêng và **Tạo riêng clip này**. Tạo riêng giữ nguyên clip đã đạt khác.
4. Xem video và poster. Duyệt từng clip hoặc duyệt bộ trình diễn. Clip lỗi có poster vẫn có thể dùng fallback; regeneration không ảnh hưởng gameplay.
5. Publish/import draft như workflow hiện có; chỉ package đã duyệt được gắn vào case. Case đang được phòng WAITING/READY/IN_PROGRESS tham chiếu được bảo vệ khỏi overwrite.

Mặc định: intro 6 giây + ending 6 giây + tối đa 3 portrait × 4 giây. REVEAL dùng panel tĩnh, gắn `targetId` với challenge được giải; không gen video giữa trận. Các clip có `kind` INTRO/ENDING/PORTRAIT/REVEAL; ending `targetId` WON hoặc FAILED.

API admin (ADMIN, hoặc VIP chủ draft; recover chỉ ADMIN):

| Route dưới `/api/admin/ai-cases/{draftId}/presentation` | Mục đích |
|---|---|
| GET | Storyboard, trạng thái và dự toán |
| PUT | `{expectedVersion, clips}`; lưu với kiểm tra revision |
| POST `/generate` | `{expectedVersion, approvedBudgetUsd}`; queue cả bộ |
| POST `/clips/{clipId}/generate` | Cùng body; chỉ queue clip đã chọn |
| POST `/clips/{clipId}/approve` | `{expectedVersion}` |
| POST `/approve` | `{expectedVersion}`; duyệt package |
| POST `/clips/{clipId}/recover` | `{providerRequestId}`; tiếp tục request đã tồn tại |
| GET `/media/{assetId}` | Preview đã xác thực |

Các package, job, request ID và checkpoint lưu trong Mongo. Worker chỉ cho một video request hoạt động, với heartbeat và kiểm tra revision/submission claim trước khi gửi. Poll/download/upload retry riêng; kết quả submit chưa rõ chuyển SUBMISSION_UNKNOWN và dừng gửi mới. Admin phải lấy ID có thật từ provider rồi dùng panel khôi phục; không bấm lại generate để đoán request cũ đã thất bại. Không tự giải phóng khoản dự phòng của response chưa xác định. Crash giữa lúc giữ chỗ tiền và lưu lease vào job cũng giữ tiền để đối soát, không tự kết luận chưa tốn phí.

Video URL provider là tạm thời; worker tải và lưu Cloudinary ngay khi hoàn thành. Video/poster lưu với delivery type `authenticated`. Player nhận route media của game sau kiểm tra thành viên/phân quyền/trigger, không nhận URL provider, Cloudinary public ID hay manifest spoiler. Proxy backend kiểm tra lại quyền mỗi lần tải. Manifest nội bộ lưu MIME, byte count, SHA-256, approval và dimensions/duration khi provider cung cấp; trường chưa biết để null.

## Cấu hình và ngân sách

Video **tắt mặc định**. Giữ key trong `.env` không commit hoặc secret store. Chưa có giá mặc định: phải điền giá đã kiểm chứng theo model thực tế. Không copy một mức giá ví dụ vào production.

| Cấu hình | Giá trị/ý nghĩa |
|---|---|
| `PresentationVideo__Enabled` | `false` cho đến khi đã cấu hình và duyệt ngân sách |
| `PresentationVideo__ApiKey` | Key xAI ở backend |
| `PresentationVideo__Model` | Mặc định `grok-imagine-video-1.5` |
| `PresentationVideo__PricePerSecondUsd` | Giá USD/giây đã kiểm chứng |
| `PresentationVideo__PricingVersion` | Ngày/phiên bản nguồn giá |
| `PresentationVideo__MaximumPackageUsd` | Trần dự toán một gói; mặc định 10 USD, không phải giá gói |
| `PresentationVideo__Resolution` | Mặc định `480p` |
| `PresentationVideo__PollSeconds` | Mặc định 10 |
| `PresentationVideo__JobTimeoutMinutes` | Mặc định 30 |
| `PresentationVideo__MaxVideoBytes` | Mặc định 33,554,432 bytes |
| `Cloudinary__Enabled`, `CloudName`, `ApiKey`, `ApiSecret`, `Folder` | Dùng cấu hình Cloudinary hiện có |
| `AiQuota__Enabled` | Phải true cho paid calls; mock không cần |
| `AiQuota__GlobalBudgetUsd` | Trần tổng đã dùng + đang dự phòng trong ledger |
| `AiQuota__MaxActiveDraftsPerUser`, `MaxCasesPerUserPerDay` | Quota admission hiện có |
| `AiUsage__MaxDraftUsd` | Trần một draft; bắt buộc >0 để bật video |
| `AiUsage__PriceVersion` | Phiên bản giá text/vision/image |
| `AiUsage__Models__<model>__ReservationUsd` | Dự phòng bảo thủ cho mỗi lần gọi, gồm retry |
| `AiUsage__Models__<model>__InputPerMillionUsd`, `OutputPerMillionUsd`, `CachedInputPerMillionUsd` | Giá token thực theo model |
| `AiUsage__Models__<model>__ImageInputPerMillionUsd`, `ImageOutputPerMillionUsd`, `CacheWritePerMillionUsd` | Điền khi model có modality tương ứng |

Các switch mock/skip asset hiện có tiếp tục chặn paid media. Thiếu giá hoặc reservation thì paid call bị chặn trước HTTP. Khi quota bật, ledger tạo bằng giới hạn cấu hình ban đầu; đổi giới hạn cần reconciliation vận hành thay vì tự reset số đã dùng.

GET `/api/admin/ai-cases/{draftId}/usage` và panel usage phân biệt:

- **Provider báo phí**: tiền do provider trả về (xAI cost ticks được đổi sang USD).
- **Tính theo usage**: counters thực × bảng giá đã chụp tại lúc gọi.
- **Chưa xác định**: không có dữ liệu đủ đáng tin; giữ khoản dự phòng, không coi là miễn phí.

Input/output/cached/reasoning token, latency, stage, model và price version lưu theo từng lần gọi generation trả phí; reasoning thuộc output nên không tính tiền hai lần. Video dùng một lease từ submit đến kết quả cuối, các lượt polling không tạo thêm usage event. Settlement nguyên tử chỉ giải phóng reservation/ghi phí một lần; worker reconciliation tiếp tục bản ghi RECORDED sau crash, không tự xóa UNKNOWN. Dự phòng phải đủ bảo thủ: provider có thể trả chi phí cao hơn mức dự phòng, lúc đó vẫn ghi đúng phí và chặn các request tiếp theo.

## Hợp đồng case và NPC

`GameCase.presentation` là optional, gồm version/packageId/clips. Case cũ không cần migration. Không tự thêm URL media bí mật vào JSON gửi player. Character sprite có thể author trong JSON case như sau:

```json
{
  "characterId": "witness-1",
  "imageUrl": "/assets/ai-generated/sample/witness-portrait.png",
  "presentation": {
    "spriteSheet": {
      "url": "/assets/ai-generated/sample/witness-idle.png",
      "frameWidth": 64,
      "frameHeight": 96,
      "frameCount": 6,
      "fps": 4,
      "idleFrames": [0, 1, 2, 3, 4, 5],
      "anchorX": 0.5,
      "anchorY": 1
    }
  }
}
```

Đây là fragment để ghép vào character hiện có, không phải case import hoàn chỉnh. Frame đặt thành grid và ảnh phải đúng kích thước; giữ imageUrl làm fallback. Mỗi NPC lệch phase, không đổi vùng click theo frame.

## Prompt và repair

- `ProjectionPromptContext` lấy trace physical cause/proves/does-not-prove, statement nguyên bản/lie/reason và facts của scene/character theo slot đã duyệt.
- `ProjectionWireContract` version 2 gửi nội dung compact; server giữ IDs/edges/layout/runtime defaults và khôi phục qua compiler. Draft cũ không có version vẫn đọc contract 1; published GameCase không đổi schema nội bộ theo model.
- Semantic repair chỉ gửi challenge cần sửa cùng các slot phụ thuộc; merge phía server, giữ hash phần ngoài phạm vi và review quan hệ bị ảnh hưởng. Checkpoint dùng projection content thật.
- Text/vision dùng cùng xử lý response và phân loại lỗi; configuration/schema không retry như lỗi mạng. Stable instructions ở trước, facts động ở sau. Cache savings chỉ kết luận từ usage thực.

Chạy benchmark offline từ repo root:

```powershell
dotnet run --project tools/AiPromptBenchmark -- --output analysis/ai-prompt-benchmark.json
```

Corpus 12 fixture VI/EN × short/normal/full × V2/V3 kiểm tra facts, schema, compiler equivalence và kích thước UTF-8. Unit tests bổ sung sentinel facts, opaque IDs và scoped repair. Đây **không phải** đo tokenizer hoặc quality/latency/cost từ model thật. Giữ model hiện tại; trước đổi model phải chạy corpus có provider thật trong ngân sách, đo tỷ lệ đạt lần đầu, fidelity, gameplay pass, retry, latency và chi phí **mỗi case đạt**.

## Đóng gói asset

Build mặc định không đổi. Build chọn case bỏ các folder AI-generated không được case tham chiếu, giữ asset shell dùng chung và xuất `dist/case-assets.json` với SHA-256/byte count:

```powershell
cd src/FE
npm run test:assets
npm run build:cases -- --case ../BE/SeedData/V3/case-v3-broken-seal-en.json --report-only
npm run build:cases -- --case ../BE/SeedData/V3/case-v3-broken-seal-en.json
```

Có thể lặp `--case` cho nhiều case được phục vụ. Không đưa JSON case có đáp án vào public: script chỉ xuất IDs và manifest asset. Media `/api/...` có quyền truy cập không được copy vào public. Chọn đủ mọi case mà deployment cung cấp; build này không tự lọc danh mục backend. Thiếu asset làm build fail, không bỏ qua âm thầm. Seed legacy `sample-case.json` hiện tham chiếu `/assets/cases/locked-manor.jpg` không có trong repo; dùng seed V3 đã kiểm chứng hoặc sửa asset của seed trước.

## Kiểm chứng và gate còn lại

Chạy unit tests, Mongo integration trên DB disposable, frontend typecheck/build, `npm run test:assets` và `npm run test:ui`. CI được cấu hình chạy UI với Chromium và Mongo integration ở job có service Mongo. Browser suite dùng mocked API để kiểm tra VN state, animation identity, video fallback/reduced motion, ending, hai người chơi độc lập, ping TTL, quyền chứng cứ và admin budget/recovery.

Kết quả xác nhận trong workspace: 678 unit tests, 35 integration tests (28 kiểm tra Mongo/HTTP thật + 7 kiểm tra guard), 48 browser tests, 3 asset tests và 3 lượt full-stack hai trình duyệt dùng Auth/HTTP/Mongo thật đều pass; typecheck và build pass. Lượt integration cuối loại 12 OpenAI schema probes trả phí bằng filter, không tính các probe chưa chạy là kết quả xác nhận. Đã sửa ba partial index quota/idempotency dùng toán tử Mongo không hỗ trợ, rồi kiểm tra tạo index và uniqueness trên Mongo thật. Fixture HTTP có cấu hình SMTP giả và chặn mọi lần gửi email, không phụ thuộc secret máy phát triển. Build vẫn cảnh báo chunk Phaser khoảng 1,8 MB trước gzip; đợt này giữ lazy route hiện có, chưa thay renderer hoặc chứng minh đạt mọi bundle budget của roadmap cũ. CI workflow được bổ sung, chưa có kết quả một run GitHub Actions mới trong phiên này.

Chưa thực hiện live xAI/Cloudinary round-trip hoặc benchmark model trả phí. Cần admin xem loop thật, crop/nhịp pixel art, upload/download được bảo vệ và kiểm tra giá/model đang sử dụng trước bật production. Human gate vẫn là một case hoàn chỉnh với ba cặp theo `docs/playtest/V3_PLAYTEST_PROTOCOL_VI.md`; kiểm tra hiểu lời thoại, vị trí nút, recap và phối hợp. Save/resume, bot solo, voice acting và video NPC trên map vẫn ngoài phạm vi.

Nguồn hợp đồng provider: [xAI video generation](https://docs.x.ai/developers/model-capabilities/video/generation), [xAI cost tracking](https://docs.x.ai/developers/cost-tracking), [Cloudinary access control](https://cloudinary.com/documentation/control_access_to_media), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
