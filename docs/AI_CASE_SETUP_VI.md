# Cấu hình tạo case AI

Chơi case đã xuất bản không cần gọi AI. Tạo JSON mới cần đủ cấu hình provider và ngân sách; nơi lưu ảnh chỉ cần khi bật bước tạo ảnh. Có API key chưa đủ để bật chức năng tạo case.

## Thử JSON trước, ngân sách 5 USD

[`config/ai-generation.json-only.example.json`](../config/ai-generation.json-only.example.json) là cấu hình thử text với `GlobalBudgetUsd=5`, `MaxDraftUsd=5`, `GenerateJsonOnly=true`, `SkipAssetGeneration=true`, `DisableAutoPublish=true`. Cloudinary và video vẫn tắt; không cần bảng giá ảnh ở chế độ này. Gộp cấu hình vào `src/BE/appsettings.Development.json` rồi khởi động lại API; giữ nguyên kết nối DB và khóa trong `.env`.

Khi draft đã hoàn thiện và cần import hoặc xuất bản thủ công, đặt `OpenAI:DisableAutoPublish=false` rồi khởi động lại API. Cờ này chặn cả thao tác thủ công, không chỉ tự động xuất bản. `AiDryRun` và `ValidateOnly` cũng phải tắt; có thể giữ `GenerateJsonOnly=true`, `SkipAssetGeneration=true` và ngân sách hiện tại. Import/publish dùng dữ liệu đã lưu, không gọi provider để sinh nội dung hay ảnh.

Mẫu này dùng gpt-5.6-sol và giữ chỗ 2 USD mỗi request. Nó chặn payload text vượt 100.000 bytes (kể cả schema) hoặc yêu cầu hơn 28.000 output tokens **trước** khi gọi provider/giữ chỗ ngân sách. Vượt giới hạn trả `AI_REQUEST_BUDGET_LIMIT`; không tự cắt nội dung. Các giới hạn `AiUsage:MaxTextRequestBytes` và `MaxTextOutputTokens` mặc định 0 (không áp dụng), cần được xem lại cùng giá/model nếu đổi cấu hình thử.

Trong lượt hoàn tất ngày 30/09, cấu hình local dùng **1,50 USD giữ chỗ/request text** để tận dụng phần ngân sách còn lại; tổng và hạn mức mỗi draft vẫn là **5 USD**, không đặt lại sổ chi tiêu. Request text được cố định `service_tier=default` trước kiểm tra kích thước để khớp bảng giá Standard. Với hai trần đang áp dụng, ước lượng bảo thủ theo mức input/cache-write cao nhất là `100.000 × 5/1.000.000 + 28.000 × 20/1.000.000 = 1,06 USD`, còn 0,44 USD dự phòng cho framing. Đây là ước lượng kỹ thuật, không phải báo giá của provider; không áp dụng cho ảnh, vision, tools, context khác hoặc model/giá khác. [Giá Sol đã đối chiếu](https://developers.openai.com/api/docs/models/gpt-5.6-sol). Mẫu cấu hình vẫn giữ reservation 2 USD thận trọng hơn.

Thử đúng một `SHORT_DEMO` bằng tiếng Việt và bật Crack the Lie: tạo preview → duyệt truth → duyệt gameplay. Dừng ở `FULL_LOGIC_AWAITING_APPROVAL`, kiểm tra JSON, validation và chi phí. Không gọi `approve-full-logic`, `continue`, import hoặc publish cho lượt thử JSON. JSON lúc này nằm trong `data.generatedJson` của `GET /api/admin/ai-cases/{draftId}`, chưa có export tự động ra thư mục `GeneratedCaseJson`.

Ngân sách 5 USD là tổng cho đợt thử theo sổ kế toán ứng dụng, không phải 5 USD mỗi ngày. Nếu chưa hoàn thành trong hạn mức, giữ checkpoint để xem lỗi và usage trước; không tự tạo lại draft hoặc xóa reservation. Chỉ bật lại sinh ảnh sau khi quyết định ngân sách ảnh riêng.

## Sửa chất lượng từ checkpoint

Từ ngày 30/09/2026, có thể sửa truth khi draft đang chờ duyệt truth hoặc ở `FULL_LOGIC_AWAITING_APPROVAL`, chưa import/publish và không có tác vụ đang chạy. Dùng **Tạo bản sửa theo phạm vi**, xem cả báo cáo cấu trúc lẫn **đánh giá cốt truyện của bản sửa** trước khi chấp nhận.

- **Chấp nhận:** quay về cổng duyệt truth; JSON gameplay, projection và các review/tài nguyên phụ thuộc được vô hiệu hóa. Duyệt truth để tạo lại gameplay từ bản mới.
- **Từ chối:** giữ JSON gameplay và checkpoint hiện tại. Nếu provider lỗi khi sửa, bản đang có và trạng thái duyệt cũ vẫn được giữ.
- Khi bản sửa còn chờ xử lý hoặc chờ chấp nhận, các bước duyệt gameplay, thay JSON và tạo lại tài nguyên bị chặn để tránh trộn dữ liệu cũ/mới.

`CANDIDATE_READY` nghĩa là bản sửa đã qua kiểm tra cấu trúc và khả năng dựng gameplay; không đồng nghĩa nội dung đã được reviewer đánh giá tốt. `NOT_RUN` nghĩa là reviewer chưa chạy, không phải đạt. Reviewer là nguồn cảnh báo tham khảo: `FAILED` hoặc `AMBIGUOUS` không tự biến thành `PASSED` sau khi chấp nhận. Kiểm tra V3 chỉ đánh giá các cặp bằng chứng/lời khai của đối chất, không chứng minh toàn bộ động cơ, thời gian hay chất lượng cốt truyện.

### Sửa tiếp candidate đã lưu

Khi có `CANDIDATE_INVALID` còn lưu nội dung và hàng đợi đang rảnh, chọn **Sửa tiếp từ bản sửa này**. Giao diện hiển thị khuyến nghị và báo cáo riêng của candidate; chọn công đoạn được khuyến nghị hoặc một công đoạn sớm hơn. Nếu chỉ proof graph còn lỗi, có thể giữ timeline, chứng cứ và lời khai đã đạt rồi sinh lại từ `PROOF_GRAPH`, thay vì trả phí tạo lại toàn bộ truth. Backend xác thực lại các phần được giữ trước khi xếp hàng.

**Sửa từ sự thật hiện tại** là lựa chọn khác: bắt đầu lại từ checkpoint chính và thay candidate đang lưu. **Bỏ bản sửa này** xóa candidate, giữ checkpoint và JSON gameplay chính. Candidate ở trạng thái `CANDIDATE_READY` cần được chấp nhận hoặc từ chối trước khi tạo một lượt sửa khác.

Qua API, gửi `useRepairCandidate: true` trong `POST /api/admin/ai-cases/{draftId}/repair-truth`; mặc định là `false`. Các trường `repairFromArtifact` và `repairInstructions` vẫn chọn phạm vi và yêu cầu sửa. `truthRepairCandidatePlan` là khuyến nghị cho candidate, còn `truthRepairPlan` phục vụ checkpoint hiện tại. Mỗi lần bấm sửa là một yêu cầu rõ ràng; lỗi cấu trúc không tự khởi động vòng sửa trả phí mới.

Backend lưu bản chụp đầu vào, hash candidate và hash toàn bộ checkpoint gốc; kiểm tra các phần trước phạm vi sửa ban đầu không bị thay đổi. Phiên bản workflow và mã lượt chạy ngăn kết quả cũ ghi đè sau khi hủy, chấp nhận hoặc từ chối. Candidate cũ chưa có hash lịch sử chỉ được tiếp tục sau khi đối chiếu nội dung đã lưu, checkpoint hiện tại và phần phải giữ nguyên; lần xếp hàng mới tạo ràng buộc hash từ trạng thái đã xác thực đó.

Mỗi công đoạn sinh lại sẽ bỏ dữ liệu phụ thuộc cũ trên bản sao đang sửa. Validator kiểm tra phần đã có theo đúng công đoạn, không dùng proof graph cũ để đánh giá lời khai mới; báo cáo giữ lỗi tại công đoạn dừng. Nếu phần đó nay đã qua kiểm tra, khuyến nghị chuyển sang công đoạn tiếp theo chưa hoàn tất. Kiểm tra đầy đủ toàn bộ truth và khả năng dựng gameplay vẫn bắt buộc trước khi chấp nhận. Nếu provider lỗi trong lúc sửa tiếp, candidate đầu vào được giữ để xem lại hoặc yêu cầu sửa tiếp sau; checkpoint và JSON chính không đổi.

Các lỗi `AI_TRUTH_REPAIR_CANDIDATE_UNAVAILABLE`, `AI_TRUTH_REPAIR_CANDIDATE_STALE` hoặc `AI_TRUTH_REPAIR_CANDIDATE_UPSTREAM_INVALID` lần lượt cho biết không còn candidate phù hợp, bản sửa không còn khớp checkpoint, hoặc phần cần tái sử dụng chưa đạt. Tải lại draft và dùng khuyến nghị hiện tại; không đổi hash hay sửa dữ liệu trực tiếp để bỏ qua kiểm tra.

### Chứng cứ và cơ chế điều tra

Prompt hiện dành trước slot cho toàn bộ core action, yêu cầu nguồn chứng cứ quan sát được cho động cơ và không dùng timestamp nội bộ như bằng chứng định giờ. Validator chỉ dùng ngoại phạm để loại nghi phạm khi nó thực sự cản trở một hành động phạm tội tại địa điểm khác. Các kiểm tra này giảm lỗi cụ thể; vẫn cần đọc nội dung sinh ra.

Bộ dựng gameplay giữ mọi trace và lời khai được liên kết với năm kết luận cuối, kể cả nguồn phụ ngoài năm chứng cứ đại diện trên giao diện. Nếu không đủ chỗ, nó báo lỗi thay vì bỏ nguồn: `ProjectionProofClosureBudget` yêu cầu xem lại phân bổ chứng cứ từ TIMELINE; `ProjectionDialogueBudget` yêu cầu gộp các lời khai tương thích hoặc sửa từ STATEMENTS. Không xóa liên kết chứng minh chỉ để đủ giới hạn. Plan cũ thiếu nguồn cũng bị validator phát hiện khi kiểm tra lại.

Prompt và reviewer yêu cầu chứng cứ chứng minh phương thức phạm tội thực tế; chỉ chứng minh hành động gây xao nhãng chưa đủ. Lời kể lặp lại cùng tài liệu không được tính thành hai nguồn độc lập bằng cách đổi nhãn. Đây là hướng dẫn ngữ nghĩa cho AI, không phải cam kết sinh case đúng. [Kết quả thử ngày 30/09](../analysis/json-quality-trial-2026-09-30/README.md) giữ nguyên kết quả của lượt thử trước; lượt kiểm chứng sau khi hoàn thiện sẽ có báo cáo riêng, không ghi đè lịch sử này.

Short Demo mới là bản thử **mỗi cơ chế một lần**, vẫn giữ **2 chặng, 2–3 cảnh và 4 nhân vật**. Bắt buộc có **1 công thức ghép vật phẩm, 1 lần dùng vật phẩm, 1 câu đố, ít nhất 1 nhân vật có hội thoại phân nhánh, 1 đối chất, 1 suy luận và 1 chuỗi phối hợp hai vai**. Chuỗi hành động phải phục vụ chứng cứ trong truth đã duyệt; không thêm vật phẩm hay mã giải cố định chỉ để đủ số lượng. Với puzzle `REQUIRED`, runtime yêu cầu giải xong trước cáo buộc, nhất quán với validator.

Phá Vỡ Lời Dối vẫn **tùy chọn**. Không bật thì đối chất duy nhất dùng luồng V2 thông thường; bật thì dùng đúng 1 đối chất cặp lời khai/chứng cứ của V3, các cơ chế còn lại vẫn bắt buộc. Không cần chọn Full Feature để thử mỗi cơ chế một ít.

Backend tự gán `settings.shortDemoProfileVersion = 1` khi tạo Short Demo mới; client tiếp tục gửi `generationPreset: "SHORT_DEMO"`, `stageCount: 2`, `difficulty: "easy"` và lựa chọn `includeCrackTheLie`, không gửi hoặc sửa phiên bản profile. Draft cũ thiếu trường này hoặc có giá trị `0` giữ hợp đồng legacy **0–1 puzzle, 0–1 tương tác**, nên tiếp tục checkpoint cũ không tự bị yêu cầu bổ sung cơ chế. Normal Random vẫn không tự thêm puzzle hoặc vật phẩm phụ chỉ để đủ số lượng.

Puzzle Heavy/Full Feature dùng chuỗi **đối chiếu hồ sơ**: khám phá chứng cứ → thu thập hai phiếu tương ứng → ghép hồ sơ → dùng tại bàn đối chiếu, kết hợp các bài phân tích chứng cứ. Đáp án được dựng từ nhận định đã được chứng minh và giới hạn của các dấu vết đã duyệt; người chơi phải phân biệt hai phần này. Mỗi puzzle và bước đối chiếu mở một dấu vết riêng đã có trong truth, với điều kiện thu thập rõ ràng. Nguồn mở chứng cứ cũ được thay thế để việc xem vật phẩm không bỏ qua chuỗi điều tra; vật phẩm đầu vào vẫn được giữ cho các bước cần dùng sau.

Preset nhiều cơ chế cần đủ hai chứng cứ khám phá độc lập bằng camera, đủ dấu vết làm phần thưởng riêng và không vượt giới hạn vật phẩm. Nếu truth không đủ nguồn, bộ dựng trả lỗi để sửa nội dung hoặc chọn preset nhỏ hơn. Các bài đối chiếu này kiểm tra việc đọc chứng cứ đã khám phá; mức hấp dẫn và độ khó suy luận vẫn cần được đánh giá bằng nội dung vụ án và lượt chơi thực tế.

## Cấu hình thử đã chuẩn bị

[`config/ai-generation.trial.example.json`](../config/ai-generation.trial.example.json) là cấu hình mẫu **chưa được ứng dụng tự tải**. Nó giữ model hiện tại, bật Cloudinary và quota, giới hạn một draft đang làm và một case/người/ngày, đặt ngân sách ứng dụng 10 USD tổng cộng và 10 USD/draft. Nó không chứa hoặc thay đổi thông tin MongoDB, đăng nhập hay API key. Video không được bật.

Sau khi chọn ngân sách, gộp các mục trong mẫu vào `src/BE/appsettings.Development.json` (không ghi đè các mục sẵn có), rồi khởi động lại API. File Development đã được Git bỏ qua. Biến môi trường và `.env` có độ ưu tiên cao hơn file JSON; nếu cùng khóa tồn tại, chỉnh giá trị ở nguồn đó. Giữ `OpenAI__ApiKey`, `Cloudinary__CloudName`, `Cloudinary__ApiKey`, `Cloudinary__ApiSecret` trong `.env` hiện tại.

Ngân sách này là sổ theo dõi của ứng dụng, không phải nạp tiền OpenAI hay cam kết một case sẽ hoàn thành trong 10 USD. Trước mỗi request, ứng dụng giữ chỗ 2 USD cho text/vision hoặc 1 USD cho ảnh, rồi đối soát theo usage. Thiếu số liệu usage thì khoản giữ chỗ vẫn còn. Đây không phải trần cứng phía nhà cung cấp; phải xem lại mức giữ chỗ khi tăng kích thước đầu vào, đổi model hoặc giá. Cloudinary tính phí riêng theo tài khoản đang dùng. `GlobalBudgetUsd` là tổng theo sổ hiện có, không tự đặt lại mỗi ngày; không xóa sổ để lách hạn mức. Nếu sổ đã có limit khác, cần đối soát trước khi đổi limit cấu hình.

Quá trình tạo preview/truth/logic/ảnh vẫn chạy theo từng bước duyệt; publish thực hiện riêng trên giao diện sau khi đã kiểm tra nội dung.

## Giá tham chiếu

Đã đối chiếu OpenAI Docs ngày 28/09/2026, đơn vị USD/triệu token, Standard:

| Model | Text input | Cached text input | Text output | Image input | Image output |
| --- | ---: | ---: | ---: | ---: | ---: |
| gpt-5.6-sol | 4 | 0.4 | 20 | 4 | Không tạo ảnh |
| gpt-image-2 | 2.5 | 0.625 | Không tạo text | 4 | 15 |
| gpt-image-1.5 | 5 | 1.25 | 10 | 8 | 32 |

Nguồn: [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [bảng giá OpenAI](https://developers.openai.com/api/docs/pricing), [GPT Image 1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5). GPT-5.6 Sol cache writes là 5 USD/triệu token. Bảng mẫu dành cho prompt dưới 272K input tokens; giá long-context và service tier khác cần bảng tính tương ứng. Image 2 không tạo text output nên trường bắt buộc `OutputPerMillionUsd` dùng 0; chi phí ảnh dùng `ImageOutputPerMillionUsd`. Cached image input chưa được bộ tính hiện tại tách riêng; gặp usage không phân loại chắc chắn thì hệ thống giữ reservation để đối soát.

## Khi tạo chưa được

- `AI_QUOTA_UNCONFIGURED`: bật quota và điền hạn mức/ngân sách dương.
- `AI_ASSET_STORAGE_UNCONFIGURED`: bật Cloudinary và kiểm tra đủ ba thông tin tài khoản.
- `AI_USAGE_PRICE_REQUIRED`: thêm bảng giá có ngày và reservation cho từng model sử dụng.
- `AI_REQUEST_BUDGET_LIMIT`: payload/schema hoặc trần output vượt giới hạn lượt thử; request chưa được gửi đến provider.
- `AI_ACTIVE_DRAFT_LIMIT`: tiếp tục hoặc hủy draft đang làm trong danh sách. Hủy không hoàn lại phí đã gọi hay tự đặt lại hạn mức ngày.
- `AI_DAILY_LIMIT`: hết số lần tạo trong ngày theo giờ Việt Nam.
- `AI_GLOBAL_BUDGET_EXHAUSTED`: kiểm tra chi phí đã ghi nhận và reservation chưa đối soát; không tự xóa dữ liệu kế toán.

Trang tạo case hiển thị kiểm tra cấu hình trước khi cho gửi yêu cầu. Kiểm tra này không gọi OpenAI/Cloudinary và không chứng minh tài khoản còn tín dụng, có quyền tạo ảnh hay provider đang hoạt động. Sau khi cấu hình, tạo một Short Demo và duyệt lần lượt preview → truth → gameplay → scene layout → assets trước khi publish.
