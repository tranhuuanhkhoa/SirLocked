# SIRLOCKED
## Báo cáo phân tích sản phẩm và kỹ thuật

**Ngày đánh giá:** 16/10/2026 · **Góc nhìn:** senior developer / technical reviewer

**Phiên bản:** `ui/bang-pha-an` · `5f8feebcf40e6c3e5e19294bffc56b1d0786327a`

**Repository nguồn:** https://github.com/Chipchiplip/Sirlocked

Tài liệu dành cho chủ dự án và developer cần hiểu hệ thống, kiểm tra quyết định thiết kế, chọn việc cải thiện và chuẩn bị trao đổi kỹ thuật. Đây là đánh giá mã nguồn và bằng chứng kiểm thử, không phải chứng nhận bảo mật hay xác nhận sản phẩm đã vận hành production.

## Mục lục

1. Kết luận điều hành và quyết định đề xuất
2. Phạm vi, phương pháp và độ tin cậy
3. Quy mô mã nguồn và công nghệ
4. Sản phẩm, vai trò và danh mục chức năng
5. Các luồng nghiệp vụ chính
6. Kiến trúc và ranh giới tin cậy
7. Dữ liệu, bất biến và lịch sử kết quả
8. Gameplay, tính đồng thời và realtime
9. Hệ thống AI, chất lượng nội dung và chi phí
10. Frontend, trải nghiệm và khả năng bảo trì
11. Bảo mật và điều kiện công khai repository
12. Hiệu năng và khả năng mở rộng
13. Chất lượng mã và tổ chức dự án
14. Kiểm thử và phân tích CI
15. Triển khai, vận hành và quan sát hệ thống
16. Danh sách vấn đề có thể hành động
17. Lộ trình cải thiện và cổng nghiệm thu
18. Câu hỏi cần xác thực, cách trình bày dự án và nguồn dẫn chứng

## 1. Kết luận điều hành và quyết định đề xuất

### 1.1 Đánh giá tổng thể

SirLocked là một ứng dụng game điều tra hợp tác hai người, có backend quản lý trạng thái và quyền hành động, giao diện chơi game bằng Phaser, cùng pipeline tạo vụ án bằng AI có kiểm tra và phê duyệt. Phạm vi đã vượt một ứng dụng CRUD thông thường: có đồng thuận giữa hai người chơi, thông tin riêng theo vai trò, xử lý tranh chấp ghi dữ liệu, khôi phục kết quả, hàng đợi AI và quản lý ngân sách.

Giá trị kỹ thuật rõ nhất nằm ở việc mô hình hóa nghiệp vụ và bảo vệ trạng thái dùng chung. MongoDB được dùng như nơi lưu aggregate của phòng chơi; version và cập nhật có điều kiện giúp ngăn ghi đè giữa các hành động. Cơ chế đối chất và buộc tội dùng revision để hai người xác nhận cùng một phiên bản nội dung. Đây là những lựa chọn phù hợp với game hai người và nhóm phát triển nhỏ. [S03–S08]

Hạn chế chính hiện nay là độ tin cậy của quy trình phát hành, cấu hình môi trường, các file tập trung quá nhiều trách nhiệm và một số truy vấn thống kê chưa giới hạn lượng dữ liệu xử lý. Số lượng tính năng lớn hơn mức đã được chứng minh bằng kiểm thử đầu cuối và playtest. Chưa có căn cứ để khẳng định số người chơi đồng thời, độ ổn định dài hạn, tỷ lệ giữ chân hoặc hiệu quả thương mại.

### 1.2 Quyết định theo mục tiêu

| Mục tiêu | Đánh giá | Điều kiện tiếp theo |
| --- | --- | --- |
| Học tập, đồ án, trình bày kỹ thuật | Có nền tảng tốt | Chọn luồng demo ổn định; mô tả đúng phần cá nhân đóng góp |
| Demo có người hướng dẫn | Có thể chuẩn bị | Sửa cấu hình khởi động, xác thực hai trình duyệt, dùng nội dung đã duyệt |
| Playtest ngoài nhóm | Chưa nên mở rộng ngay | Khép các lỗi CI, đo phiên chơi và thử reconnect thực tế |
| Public mã nguồn | Cần kiểm tra đúng repository và toàn bộ refs | Repo gốc đang phân tích còn dữ liệu token đã track; bản làm sạch ở repo riêng là một lịch sử khác |
| Production công khai | Chưa đủ bằng chứng sẵn sàng | Hoàn thành cổng phát hành, hardening môi trường, sao lưu/khôi phục và kiểm thử tải |

### 1.3 Năm việc nên làm đầu tiên

- Sửa việc đăng ký Google OAuth khi cấu hình rỗng; bảo đảm `/live` và đăng nhập thường hoạt động khi không bật Google.
- Điều tra ba lỗi browser test bằng trace và tái hiện có kiểm soát; hoàn thành smoke test API và phiên chơi hai trình duyệt.
- Bảo vệ lịch sử Git đúng repo cần công khai; không đưa các file tạm, bundle sao lưu và báo cáo chứa dữ liệu nhạy cảm lên mạng.
- Ưu tiên rút ngắn đường tải gameplay và thay truy vấn thống kê không giới hạn khi chuẩn bị thử với dữ liệu lớn.
- Tách dần các use case trong `AiCaseService` và `gamePage`, giữ nguyên hành vi bằng bộ kiểm thử hiện có.

## 2. Phạm vi, phương pháp và độ tin cậy

### 2.1 Phạm vi thực hiện

Đã kiểm kê file được Git quản lý, đọc cấu hình/build/workflow, mô hình dữ liệu, controller, các dịch vụ nghiệp vụ trọng tâm, đường đi của trạng thái gameplay, hàng đợi AI và các module frontend liên quan. Đối chiếu tài liệu trong repo với triển khai hiện tại; chạy kiểm tra frontend và backend; phân tích log CI đã thu thập trong phiên làm việc. Các nhận xét quan trọng có mã nguồn tham chiếu ở cuối báo cáo.

Phân tích tập trung vào luồng có tác động lớn: xác thực, vào phòng, phân quyền dữ liệu, ghi đồng thời, xác nhận hai người, lưu kết quả, tạo nội dung AI, reconnect và vận hành. Không coi việc có đọc danh sách file là bằng chứng rằng từng dòng mã và từng nhánh giao diện đã được kiểm toán độc lập.

### 2.2 Phân loại bằng chứng

| Nhãn | Ý nghĩa | Ví dụ trong báo cáo |
| --- | --- | --- |
| Xác minh mã | Có thể chỉ ra triển khai trực tiếp | Workshop tải danh sách rồi phân trang trong bộ nhớ |
| Chạy lại | Lệnh thực thi tại workspace này | Typecheck, 24 test frontend, build, test .NET |
| Log CI | Đọc log từ workflow cụ thể | ClientId rỗng; 130/133 browser test pass |
| Suy luận | Hệ quả thiết kế hợp lý, chưa đo hoặc tái hiện | Presence phân tán khi chạy nhiều API instance |
| Cần xác thực | Chưa đủ dữ liệu quyết định | Số phòng đồng thời và mức chi phí AI chấp nhận được |

### 2.3 Giới hạn cần giữ khi đọc kết luận

Không gọi AI trả phí, không chạy tấn công vào dịch vụ thật, không thay dữ liệu production và không kiểm thử tải mạng công khai. Không có số liệu kinh doanh hay phỏng vấn người dùng để kết luận độ hấp dẫn của game. Các cảnh báo dependency là kết quả phân tích package; khả năng khai thác thực tế còn phụ thuộc đường gọi API và môi trường.

CI dùng để đối chiếu nằm ở repo riêng `duongtuankiet-se/SirLocked`, commit `d905bf2`; phần mã ứng dụng tương ứng với bản gốc `5f8feeb`, còn các thay đổi bổ sung tập trung vào làm sạch lịch sử và chống commit credential. Kết quả secret scanning của repo riêng không thay thế việc quét repo gốc. [E02–E04]

## 3. Quy mô mã nguồn và công nghệ

### 3.1 Kiểm kê tại commit đánh giá

| Chỉ số | Kết quả | Cách hiểu |
| --- | --- | --- |
| File được Git quản lý | 910 | Có mã, tài liệu, ảnh, font, âm thanh và file tạm đã track |
| Tổng dung lượng file được quản lý | Khoảng 192,1 MiB | Không phải dung lượng clone hay dung lượng mã text thuần |
| Dòng `.cs/.js/.ts/.mjs/.css` | 107.200 | Bao gồm test, CSS, dòng trống và comment |
| Dòng thuộc đường dẫn test theo bộ đếm | 26.982 | Khoảng 25,2% tập dòng trên; không phải code coverage |
| File C# | 301 | Bao gồm API, test và công cụ |
| File trong cây Services | 133 | Bao gồm các module con; không tương đương 133 tính năng |
| File C# test unit / integration | 58 / 18 | Số file, không phải số test case |
| Browser spec | 17 | Playwright |
| HTTP action attributes | 116 | Đếm Get/Post/Put/Patch/Delete; không phải số nghiệp vụ độc lập |

Số liệu được tạo bằng `git ls-files` và bộ đếm text, lưu trong phụ lục máy đọc được `SIRLOCKED_REVIEW_METRICS_2026-10-16.json`. [E01]

### 3.2 Công nghệ thực sự được sử dụng

| Lớp | Công nghệ | Nhận xét |
| --- | --- | --- |
| API | C#, ASP.NET Core, .NET 9 | Controller, DI, validation, middleware, background service |
| Dữ liệu | MongoDB, MongoDB.Driver 3.9 | Embedded room state, index và atomic conditional update |
| Realtime | ASP.NET Core SignalR | Room group, thông báo version, pose và presence |
| Auth | JWT, BCrypt, Google OAuth | Refresh rotation; token bảo mật được hash phía server |
| Frontend | JavaScript SPA, Vite, HTML/CSS | Routing hash và DOM; không phải React |
| Gameplay renderer | TypeScript, Phaser 4 | Cảnh, tương tác, di chuyển và lớp trình bày game |
| AI và media | OpenAI; Cloudinary; video xAI tùy cấu hình | Nội dung có schema, approval và kiểm soát chi phí |
| Kiểm thử | xUnit, Playwright, Node test runner | Có unit/domain, Mongo opt-in, UI và script hai trình duyệt |
| Tự động hóa | GitHub Actions, PowerShell | Pipeline kiểm tra và đóng gói demo |

Tại ngày đánh giá, .NET 9 hết hỗ trợ ngày 10/11/2026; cần lên kế hoạch chuyển sang bản còn được hỗ trợ, ưu tiên thử .NET 10 LTS. CI đang dùng Node 20, đã được Node.js đánh dấu EOL; nên chuẩn hóa Node 24 LTS rồi chạy lại build/test. Đây là vấn đề vòng đời công cụ, không tự động chứng minh ứng dụng đang bị khai thác. [W01, W02]

## 4. Sản phẩm, vai trò và danh mục chức năng

### 4.1 Mục tiêu và mô hình chơi

Hai người cùng giải một vụ án, nhưng nhận công cụ và thông tin khác nhau. Investigator tập trung vào hiện trường, đồ vật và chứng cứ; Interrogator tập trung vào đối thoại và lời khai. Người chơi cần trao đổi, đối chiếu thông tin, mở các nhánh điều tra rồi thống nhất kết luận.

Điểm khác biệt có thể trình bày là sự kết hợp giữa nội dung vụ án có cấu trúc, hành động hợp tác và AI hỗ trợ tác giả. Khả năng tạo được JSON chưa đủ để kết luận vụ án có suy luận hay hoặc người chơi thấy thú vị; các tiêu chí đó cần playtest người thật.

### 4.2 Hai nhóm vai trò cần phân biệt

| Nhóm | Vai trò | Trách nhiệm |
| --- | --- | --- |
| Tài khoản | PLAYER | Đăng nhập, tham gia phòng và chơi theo quyền |
| Tài khoản | VIP | Có quyền sử dụng một số chức năng AI theo policy/quota |
| Tài khoản | ADMIN | Quản trị người dùng, vụ án, duyệt/publish và cấu hình nội dung |
| Trong phòng | Investigator | Điều tra vật chứng và thao tác hiện trường theo luật vụ án |
| Trong phòng | Interrogator | Khai thác lời khai và tham gia đối chất theo luật vụ án |

Role VIP hiện có trong hệ thống phân quyền. Không tìm thấy bằng chứng đủ để gọi đây là sản phẩm thanh toán/gia hạn thuê bao hoàn chỉnh. Tên `AdminAiCasesController` cũng không có nghĩa toàn bộ endpoint chỉ dành cho ADMIN: controller cho ADMIN/VIP, một số thao tác nhạy cảm bổ sung yêu cầu ADMIN. [S01, S10]

### 4.3 Danh mục chức năng và mức độ hiện thực hóa

| Nhóm | Chức năng đã thấy trong mã | Giới hạn / chú ý |
| --- | --- | --- |
| Tài khoản | Đăng ký/đăng nhập, xác minh email, quên/đặt lại mật khẩu, refresh, logout, Google OAuth | OAuth thiếu cấu hình đang làm hỏng request trong CI |
| Hồ sơ | Hồ sơ thám tử, số vụ chơi/giải, tỷ lệ thành công, thành tích, rank/badge | Thống kê creator đang trả null có chủ đích |
| Thư viện vụ án | Danh sách vụ published, chi tiết, tìm kiếm/sắp xếp Workshop | Author chưa có dữ liệu chuẩn; phân trang đang ở memory |
| Phòng chơi | Tạo phòng bằng vụ án, mã tham gia, vào lại, chọn vai, ready, host start, leave/abandon | Hai người; role phải đáp ứng điều kiện trước khi bắt đầu |
| Hiện trường | Đi đến cảnh, inspect/use/combine item, tương tác môi trường, puzzle, ảnh chứng cứ | Cơ chế phụ thuộc mechanicsVersion và dữ liệu vụ án |
| Hội thoại | Ask dialogue, converse, trình chứng cứ, lời khai/nhánh hội thoại | Có nội dung riêng theo vai trò ở V3 |
| Suy luận | Deduction, hint, hoàn thành cảnh/giai đoạn, mở nội dung tiếp theo | Mở khóa dựa trên điều kiện server |
| Hợp tác V3 | Đối chất cặp, disclosure, xác nhận theo revision, buộc tội đồng thuận | Không thể mô tả là hai client tự quyết kết quả |
| Kết quả | Chấm điểm, thành công/thất bại, ending, lưu snapshot, xem lại result | Kết quả có snapshot để hạn chế thay đổi nghĩa lịch sử |
| Realtime | Trạng thái phòng, version change, teammate pose, ping, kết nối lại | Presence và một số cache đang theo process |
| Cộng đồng | Review theo điều kiện đã chơi, leaderboard, case/challenge tuần | Chưa phải marketplace hoặc mạng xã hội hoàn chỉnh |
| Quản trị | Quản lý người dùng/vụ án, import/publish, quản lý AI draft | Cần kiểm soát owner và role tại từng use case |
| Nội dung AI | Truth, repair, projection, validation/review, layout, asset, approval, publish | Provider thật và chất lượng nội dung chưa được kiểm chứng trong lần chạy này |
| AI vận hành | Queue Mongo, lease/heartbeat, retry, checkpoint, quota, budget và usage | Retry ngoài hệ thống vẫn có thể phát sinh chi phí lặp |
| Trình bày | Intro/cinematic/media theo cấu hình, video tùy chọn | Không phải mọi môi trường đều bật hoặc có media đã sinh |
| Playtest | Thu sự kiện, pseudonym và retention TTL | Có telemetry không đồng nghĩa đã có kết quả nghiên cứu người chơi |

Nguồn chính: controller, service và model tương ứng; đặc biệt GameController liệt kê rõ các command hiện trường/hội thoại. [S02–S04, S09–S15]

## 5. Các luồng nghiệp vụ chính

### 5.1 Từ đăng ký đến vào phòng

Người dùng đăng ký hoặc đăng nhập, nhận access/refresh token rồi dùng API có xác thực. Để tạo hoặc vào phòng, service kiểm tra điều kiện xác minh email; ADMIN có ngoại lệ theo logic triển khai. Tạo phòng chỉ nhận vụ án có trạng thái published. Mã phòng được chuẩn hóa khi join.

Chọn vai và ready là thay đổi trạng thái lobby; host bắt đầu sau khi kiểm tra đủ người, vai trò và điều kiện. LobbyVersion giúp tránh hai thao tác lobby cùng ghi đè. Join có giới hạn số người ngay trong filter cập nhật MongoDB, nên hai người cùng tranh vị trí cuối không đơn giản làm phòng vượt quá hai người. [S03]

Trong trường hợp cùng một tài khoản gửi hai join song song khi chỉ còn một chỗ, filter size khiến tối đa một request thêm thành viên; request còn lại có thể nhận conflict dù tài khoản vừa được thêm. Đây là khác biệt về trải nghiệm retry/idempotency cần test thêm, chưa phải bằng chứng phòng có thành viên trùng.

### 5.2 Một hành động điều tra

Client gửi ý định và các ID cần thiết. Backend nạp room/case, xác nhận membership, vai trò, trạng thái hiện tại và điều kiện mở khóa. Domain rules tính chuyển trạng thái; persistence thử ghi với version hiện tại. Nếu ghi thành công, backend trả projection dành cho caller và phát thông báo để người còn lại tải trạng thái phù hợp.

Không nên gửi toàn bộ case có đáp án xuống client rồi chỉ ẩn HTML. Hướng V3 của dự án xử lý quyền biết thông tin ở server projection, phù hợp với gameplay bất đối xứng. Khi phát triển tính năng mới, cần kiểm tra cả REST, event realtime, URL ảnh, nội dung lỗi và telemetry để không tạo kênh lộ phụ. [S04, S05, S08]

### 5.3 Đối chất giữa hai vai trò

Một người đề xuất đối chất dựa trên lời khai; người còn lại đóng góp chứng cứ theo vai trò. Mỗi sửa đổi tăng revision. Confirm phải gắn với revision mà người chơi đã thấy; thay nội dung cần xác nhận lại. Khi đã đến giai đoạn disclosure/review, dữ liệu được bảo vệ theo luật để tránh thay bằng chứng sau khi bên kia xác nhận.

Một tương tác sai cần phản hồi đủ để chơi tiếp nhưng không trả đáp án thật. Kết quả mở khóa phải được áp dụng đúng một lần về mặt nghiệp vụ ngay cả khi command bị gửi lại. CAS và state machine hỗ trợ điều này; không nên diễn giải là mạng bảo đảm gửi message đúng một lần. [S06]

### 5.4 Đồng thuận buộc tội và kết thúc

Hai người thống nhất bản kết luận hiện tại rồi xác nhận cùng revision. Backend đối chiếu luật của vụ án, tính kết quả và ghi trạng thái hoàn thành kèm snapshot trong room. Sau đó lưu GameResult riêng bằng upsert theo roomId duy nhất.

Nếu tiến trình dừng giữa hai bước, snapshot trong room cho phép khôi phục GameResult. Đây là thiết kế phục hồi phù hợp; không phải transaction ACID bao trùm hai collection. Cần giữ cơ chế repair/reconciliation và kiểm thử crash window khi thay đổi luồng này. [S07]

### 5.5 Tạo và phát hành một vụ án AI

ADMIN hoặc tài khoản có quyền yêu cầu draft theo cấu hình và ngân sách. Hệ thống quản lý workflow, sinh truth và dữ liệu chiếu thành gameplay; các validator/reviewer kiểm tra cấu trúc, tham chiếu, logic và tính sẵn sàng. Các bước phê duyệt truth, logic hoặc layout phụ thuộc mode. Sau đó sinh/tái sinh asset, import và publish theo quyền ADMIN.

Một draft được tạo thành công chưa tương đương một case đã playable. Một case validate thành công chưa tương đương nội dung đã được người chơi kiểm chứng. Trong báo cáo vận hành nên tách ít nhất các trạng thái: yêu cầu đã nhận, đang sinh, cần duyệt, lỗi có thể retry, sẵn sàng import và đã publish. [S10–S12]

## 6. Kiến trúc và ranh giới tin cậy

### 6.1 Sơ đồ hệ thống hiện tại

```text
Trình duyệt A / B
  SPA: routing + session + REST + SignalR
  Phaser: renderer + input + navigation
                |
  JWT / HTTPS; dữ liệu từ client phải kiểm tra
                v
ASP.NET Core API - một ứng dụng triển khai
  Middleware / auth / controller / DTO
  Domain rules + coordinators + services
  Projection theo caller + persistence CAS
        |                   |
        v                   v
  MongoDB             SignalR room groups
  rooms / cases       invalidation + presence + pose
  results / users
  drafts / usage
        ^
        |
  Hosted workers --> OpenAI / Cloudinary / video tùy chọn
  queue + lease        API bên ngoài, có độ trễ và chi phí
```

### 6.2 Kiểu kiến trúc

Đây là monolith phân lớp với các module nghiệp vụ ngày càng rõ. Controller gọi service/interface; services dùng MongoDbContext trực tiếp; domain helpers/coordinators xử lý quy tắc. Các worker chạy trong cùng host API. Cách tổ chức này phù hợp với giai đoạn hiện tại vì dễ debug, giữ ít thành phần vận hành và tận dụng atomic document update.

Không nên gọi dự án là microservices. Cũng chưa nên tuyên bố Clean Architecture nghiêm ngặt: ranh giới phụ thuộc domain/persistence chưa được cô lập hoàn toàn. Việc thêm repository tổng quát cho mọi collection không tự giải quyết được các bất biến đặc thù; các cổng chuyên biệt như state persistence/result store hiện có hữu ích hơn.

### 6.3 Ranh giới cần bảo vệ

- Browser là vùng không tin cậy: role, userId, điểm số, trạng thái mở khóa và đáp án phải do server quyết định.
- Projection là ranh giới quyền đọc: mỗi người chỉ nhận dữ liệu được phép biết ở thời điểm hiện tại.
- Mongo là nơi giữ trạng thái chuẩn; SignalR truyền thông báo, không thay thế việc xác nhận dữ liệu bền vững.
- Provider AI là đầu ra không tin cậy: schema hợp lệ vẫn cần kiểm tra logic, tham chiếu, tài nguyên và nội dung.
- Công cụ tác giả/ADMIN có quyền cao: prompt, truth, JSON case và media draft cần quyền riêng; dữ liệu này không mặc nhiên được trả cho người chơi.
- Secret và dữ liệu cá nhân đi qua môi trường triển khai/log/Git, nên kiểm soát cần trải cả vòng đời phát triển.

### 6.4 Kiến trúc mục tiêu ngắn hạn

Giữ một backend triển khai, làm rõ các module Auth, Lobby, Gameplay, Content/AI, Community và Operations. Định nghĩa interface theo hành động nghiệp vụ; tách mapping/projection khỏi mutation; dùng contract version cho case và event. Chỉ tách worker thành process riêng khi có bằng chứng AI/media làm ảnh hưởng latency API hoặc cần scale khác biệt.

## 7. Dữ liệu, bất biến và lịch sử kết quả

### 7.1 Các nhóm dữ liệu chính

| Nhóm collection | Vai trò | Bất biến quan trọng |
| --- | --- | --- |
| Users | Danh tính, role, trạng thái, hash password/token | Email duy nhất; thu hồi quyền có hiệu lực đúng kỳ vọng |
| Cases | Định nghĩa vụ án có version và trạng thái | caseId duy nhất; chỉ published được chọn để chơi |
| Rooms + GameplayState | Lobby, thành viên, presence, tiến độ | Tối đa hai người; mutation cần membership và version |
| GameResults | Lịch sử kết quả và snapshot case | Một kết quả cho mỗi roomId |
| EvidencePhotos | Ảnh chứng cứ theo phòng và clue | Cặp roomId/clueId duy nhất; đọc có kiểm tra quyền |
| AiCaseDrafts | Workflow, checkpoint, lease, quota | Claim có điều kiện; run/version/input hash đúng |
| AI logs / usage / budget | Nhật ký và kiểm soát tiêu thụ | Không quyết toán lặp hoặc giải phóng sai reservation |
| Reviews | Đánh giá case sau khi đủ điều kiện | Một review của user cho case; kiểm tra đã chơi |
| Weekly features | Nội dung/challenge theo tuần | Quản trị theo role; lọc thời gian/trạng thái |
| Playtest events | Sự kiện quan sát phiên chơi | Retention TTL và pseudonym; tránh đưa spoiler/PII vào payload |

### 7.2 Điểm tốt về consistency

GameplayState được nhúng trong room giúp việc kiểm tra và ghi tiến độ nằm trong một atomic update. Persistence chỉ cập nhật trường gameplay/status/thời gian, tránh replace cả room bằng bản cũ rồi xóa mất presence vừa ghi. Đây là xử lý đúng một lỗi concurrency thường gặp. [S05]

Index duy nhất GameResults.roomId được xem là bất biến quan trọng: khởi động kiểm tra dữ liệu trùng và xác minh index; không tiếp tục im lặng nếu thiếu. Result snapshot giữ tên nhân vật, chứng cứ, final logic và presentation cần cho giải thích lịch sử. Dữ liệu cũ vẫn được hỗ trợ bằng field nullable. [S07, S09]

### 7.3 Các khoảng trống về mô hình

Thời gian giải nhanh trong Profile hiện tính bằng cách đọc lại room và StartedAt/CompletedAt. Nếu về sau xóa room để giảm dung lượng, thống kê thời gian có thể thiếu. Nên lưu duration đã xác nhận, gameplay version và các thông tin thống kê cần thiết ngay trong result; backfill có phân biệt dữ liệu không biết. [S13]

Workshop tính một số tỷ lệ đúng/sai dựa trên FinalLogic của case hiện tại, trong khi GameResult đã có snapshot. Nếu định nghĩa case thay đổi dưới cùng caseId, số liệu lịch sử có thể bị diễn giải lại. Đây là rủi ro có điều kiện; hướng xử lý là version hóa case và ưu tiên snapshot kết quả khi thống kê. Không sửa dữ liệu lịch sử bằng cách đoán đáp án của bản cũ. [S14]

Provenance `SourceAiDraftId` đã xuất hiện nhưng chưa tạo thành mô hình author chuẩn dùng thống nhất cho case thủ công và AI. Creator stats trả null, Workshop author để Unknown. Cần thêm owner/author có migration và quy tắc phân quyền rõ ràng trước khi quảng bá nền tảng nội dung do cộng đồng đóng góp.

### 7.4 Index và vòng đời dữ liệu

Đã có index cho email, caseId, roomCode, truy vấn phòng theo player/status, queue/lease/quota, ảnh chứng cứ, review và telemetry TTL. GameResults có index caseId/createdAt và roomId unique; chưa thấy index players trong nhóm index hiện tại, dù Profile truy vấn theo người chơi. Cần dùng explain trên dữ liệu đại diện để chọn index đa khóa theo pattern thực tế, thay vì thêm index hàng loạt. [S09]

Cần chính sách riêng cho room hoàn thành, ảnh, action log, draft thất bại và asset không được publish. Phải biết dữ liệu nào còn được Profile/Leaderboard/Result sử dụng trước khi đặt TTL. Sao lưu có ích khi đã thử restore, gồm cả media ngoài MongoDB và liên kết từ case.

## 8. Gameplay, tính đồng thời và realtime

### 8.1 Server authoritative ở phạm vi nào?

Backend là thẩm quyền cho tiến độ, điều kiện mở khóa, role, đối chất, buộc tội và kết quả. Client gửi pose để đồng đội nhìn thấy chuyển động; đây là dữ liệu trình bày, không phải server mô phỏng vật lý toàn bộ bản đồ. Khi mô tả kỹ thuật, nên nói rõ phạm vi này để tránh tạo kỳ vọng chống gian lận như game hành động cạnh tranh.

### 8.2 Version và retry

Gameplay update lọc theo roomId, gameplayState.version và trạng thái room. Version chỉ được tăng khi ghi thành công; trường hợp conflict được xử lý bằng retry có giới hạn ở coordinator. Với hai người, cơ chế này dễ vận hành hơn khóa phân tán và bảo vệ tốt dữ liệu dùng chung.

Một version chung cũng khiến các hành động độc lập tranh chấp cùng aggregate. Hiện chưa có số liệu conflict để coi đây là vấn đề tải. Nên ghi metric conflict/retry theo command; chỉ cân nhắc tách sub-aggregate nếu tỷ lệ retry và latency cho thấy nút thắt. Không tách trước vì sẽ làm phức tạp các điều kiện giao nhau.

### 8.3 Realtime là thông báo thay đổi

Thông báo version cho phép client tải projection mới theo caller. Frontend coalesce nhiều event, giữ một request đang chạy, sử dụng retry có giới hạn và bỏ qua kết quả sau disposal. Khi reconnect, client cần join lại room thành công rồi mới đánh dấu kết nối đã phục hồi. Đây là thiết kế có chủ đích và có unit test. [S08, S16]

Cửa sổ rủi ro: DB đã ghi nhưng host dừng trước khi phát event. Người còn lại có thể chưa thấy trạng thái cho đến khi refetch/reconnect. Hiện chưa có transactional outbox cho thông báo này. Trước mắt có thể thêm reconciliation version định kỳ phù hợp và đo độ trễ đồng bộ; cân nhắc outbox khi yêu cầu độ tin cậy cao hơn và chi phí triển khai được chấp nhận.

### 8.4 Presence và nhiều instance

GameHub dùng tracker static và dictionary static trong process; pose có interval 50 ms. Đây là bằng chứng trạng thái kết nối không tự chia sẻ giữa hai API instance. Cache case cũng là IMemoryCache của process. Chỉ bật thêm replica có thể làm presence không đầy đủ hoặc cache invalidation chậm. [S08, S17]

Cần kiểm chứng graceful disconnect, đóng tab, mạng đứt, nhiều tab cùng tài khoản, reconnect vào instance khác và API crash. SignalR backplane/service giúp phân phối event nhưng chưa tự giải quyết lease presence hay invalidation cache. Nếu mở rộng, phải thiết kế cả ba và đo trên cấu hình thực tế.

### 8.5 Những test hồi quy nên bảo vệ

- Hai command cùng đọc một version: chỉ một ghi được, command còn lại có kết quả nghiệp vụ hợp lý sau retry.
- Confirm revision cũ không kết thúc đối chất hoặc buộc tội phiên bản mới.
- Gửi lặp command cuối không cộng điểm/mở khóa/lưu result thêm lần nữa.
- User ngoài phòng không đọc state, ảnh, result hoặc join SignalR group.
- Sau terminal state, các command không được mở lại tiến độ hoặc đổi kết quả.
- Mất event/reconnect không khiến một client giữ trạng thái cũ vô thời hạn.

## 9. Hệ thống AI, chất lượng nội dung và chi phí

### 9.1 Các tầng trách nhiệm

| Tầng | Vai trò | Cần đánh giá bằng |
| --- | --- | --- |
| Truth | Sự thật chuẩn của vụ án, quan hệ nhân quả và đáp án | Tính nhất quán, đầy đủ, không mâu thuẫn |
| Projection | Chuyển truth thành cảnh, clue, hội thoại, challenge | Reachability, phân vai, không lộ đáp án sớm |
| Validation | Kiểm tra schema, ID, liên kết và điều kiện | Bộ fixture đúng/sai; lỗi có vị trí và nguyên nhân |
| Review/approval | Kiểm tra nội dung và xác nhận của người có quyền | Bằng chứng duyệt đúng input hash/version |
| Presentation | Layout, ảnh, sprite, âm thanh/cinematic tùy mode | Khả năng đọc, kích thước, URL và ràng buộc runtime |
| Orchestration | Queue, checkpoint, retry, quota và publish | Phục hồi sau lỗi, không chạy sai revision, chi phí |

Ưu điểm là dự án đã tách khái niệm truth khỏi game case công khai và có các cổng duyệt. Điều này giúp giảm việc AI tự tạo cả câu chuyện và luật mà không có chuẩn để đối chiếu. Tuy vậy, reviewer cũng dùng mô hình không tạo thành chứng minh toán học về tính đúng; human review và chơi thử vẫn cần thiết. [S10–S12]

### 9.2 Hàng đợi và khả năng phục hồi

Worker lấy job từ MongoDB, claim theo workflow, duy trì heartbeat khoảng hai phút; lease và generationRunId/input hash giúp tránh worker cũ tiếp tục ghi lên draft mới. Retry cho lỗi tạm thời có backoff 15 giây, một phút, năm phút và số lần giới hạn. Các checkpoint giúp không luôn phải bắt đầu lại toàn bộ pipeline. [S11]

Thiết kế là at-least-once về thực thi: nếu request đã đến provider nhưng response mất, retry có thể tạo thêm lượt tính phí. Mongo lease ngăn nhiều worker sở hữu cùng job hợp lệ, nhưng không biến API provider thành exactly-once. Các trạng thái chưa rõ việc submit video cần được giữ để reconciliation/manual recovery, tránh tự gọi lại vô hạn.

### 9.3 Kiểm soát chi phí

Quota, budget reservation và usage ledger là nền tảng tốt. Tuy nhiên, để đánh giá hiệu quả cần báo cáo chi phí theo draft thành công, draft thất bại, repair, asset và từng provider. Chỉ đếm số request sẽ bỏ qua kích thước token, số ảnh và lượt retry.

Một công thức vận hành nên dùng: chi phí một case publish = tổng text + vision + image + video + retry/repair phân bổ. Tỷ lệ publish = số draft publish / số draft được nhận trong cùng cohort. Không lấy case còn pending làm thất bại quá sớm, cũng không bỏ thất bại khỏi chi phí trung bình.

Chưa có dữ liệu đủ để ghi lợi ích như “giảm 80% thời gian tạo nội dung” hay “tiết kiệm X% chi phí”. Nếu muốn chứng minh, so sánh thời gian tác giả hoàn thành một case đạt cùng tiêu chí, bao gồm review và sửa lỗi thủ công.

### 9.4 Rủi ro AI cần quản lý

- Schema/prompt/model/parser/validator cùng thay đổi có thể lệch contract. Cần version, fixture và migration rõ; hash xác nhận nội dung đã duyệt.
- Các nhánh repair có thể tạo liên kết mới sai hoặc làm mất cơ chế đã được duyệt. Chạy lại validation và so sánh semantic diff sau repair.
- Narrative hợp lý không bảo đảm tất cả clue có thể khám phá theo thứ tự hợp lệ. Cần kiểm tra đồ thị dependency và walkthrough.
- Prompt hoặc nội dung do người dùng nhập cần giới hạn độ dài/quyền sử dụng; text sinh ra phải được coi là dữ liệu, không phải lệnh hệ thống hay HTML tin cậy.
- Việc tải hoặc lưu media bên ngoài cần allowlist, timeout, giới hạn kích thước và kiểm tra quyền theo loại tài nguyên; chưa thực hiện kiểm thử SSRF đối kháng trong lần đánh giá này.
- Asset cần metadata về nguồn, model, quyền sử dụng và trạng thái duyệt. Tạo bằng AI không tự chứng minh quyền phân phối mọi tài nguyên trong repo.

### 9.5 Bộ đánh giá nên có

Duy trì tập case cố định có nhãn: đúng, sai tham chiếu, vòng dependency, thiếu chứng cứ cho kết luận, lộ spoiler, vai trò không có việc làm và lỗi trình bày. So sánh mỗi phiên bản prompt/compiler bằng tỷ lệ pass, tỷ lệ người duyệt sửa, thời gian hoàn thành và tổng chi phí. Provider probe thật nên chạy theo lịch/quota được kiểm soát, tách khỏi CI mặc định.

## 10. Frontend, trải nghiệm và khả năng bảo trì

### 10.1 Tổ chức và điểm mạnh

SPA JavaScript gọi API qua service, quản lý session và điều hướng bằng hash. Gameplay dùng TypeScript/Phaser; navigation được tách để kiểm thử độc lập engine. Route lifecycle dùng AbortController/cleanup để hạn chế callback cũ cập nhật giao diện sau khi đổi trang. Realtime refetch có deduplication và giới hạn retry. Đây là các cơ chế hữu ích trong ứng dụng nhiều thao tác bất đồng bộ. [S16, S18]

Navigation dùng hình học vật cản và đường đi xác định, thích hợp các scene nhỏ. Unit test đã kiểm tra đường không xuyên vật cản, spawn, điểm tiếp cận và tốc độ theo frame. Những test này không thay thế tương tác browser thật: input, delta time, camera và DOM overlay vẫn có thể làm luồng người dùng thất bại.

### 10.2 Điểm tập trung trách nhiệm

`gamePage.ts` dài 6.043 dòng, đồng thời gắn nhiều logic render, input, UI và orchestration. `adminAiPage.js` dài 1.762 dòng. Việc sửa một tương tác có thể ảnh hưởng cleanup, network và state ở xa trong cùng file. LOC là dấu hiệu để kiểm tra độ kết dính và coupling, không phải tự nó chứng minh mã kém. [E01]

Nên tách theo trách nhiệm có trạng thái rõ: scene runtime, movement/input, API/realtime bridge, investigation panels, paired-action UI, presentation và page coordinator. Mỗi module có mount/dispose và nhận projection thay vì tự biết toàn bộ global state. Giữ gamePage làm nơi nối các thành phần sau khi đã có characterization tests.

### 10.3 Type safety và contract

Typecheck hiện pass, nhưng tsconfig đặt `strict: false`, `checkJs: false`, `allowJs: true`. Vì vậy không thể nói toàn bộ frontend được bảo vệ bởi strict TypeScript. Một phần lớn JavaScript không được kiểm tra kiểu đầy đủ. [S18]

Đề xuất tăng dần: chuẩn hóa DTO state/command/event, thêm kiểu cho module nhạy cảm, bật strict theo module hoặc project con; dùng contract test hoặc client type sinh từ API nếu có lợi. Tránh chuyển toàn bộ framework chỉ để đạt cảm giác hiện đại; vấn đề chính là trách nhiệm và contract.

### 10.4 Đường tải và khả năng sử dụng

Build hiện sinh gameplay JS khoảng 1.927,91 kB, gzip 458,25 kB; index JS 494,54 kB, gzip 141,79 kB. CSS gameplay khoảng 188,90 kB và index 348,81 kB trước gzip. Đây là số liệu bundle, chưa gồm toàn bộ ảnh, font, âm thanh tải khi chơi. [E05]

Nên đo trên máy phổ thông và mạng chậm: thời gian mở lobby, đến khi điều khiển được nhân vật, peak memory, long task và tốc độ khung hình. Tách editor/admin khỏi player path, lazy load asset theo scene, gỡ CSS không dùng có kiểm chứng. Manual chunks có thể đổi cách chia gói nhưng không tự giảm tổng dữ liệu.

### 10.5 UX và accessibility cần xác thực

Đã có role guide và hỗ trợ một số điều kiện reduced motion trong lifecycle. Chưa đủ bằng chứng để tuyên bố đạt chuẩn accessibility. Cần kiểm tra bằng bàn phím, thứ tự focus, đóng modal, độ tương phản, scale chữ, thông báo lỗi và phương án cho người khó nhận biết màu. Các yếu tố này ảnh hưởng trực tiếp khả năng hai người hiểu lượt và quyền thao tác.

Chỉ số playtest nên ghi thời gian hiểu vai, lần cần người hướng dẫn, khoảng thời gian một người không có hành động ý nghĩa, tỷ lệ hoàn thành đối chất và lý do bỏ phiên. Nội dung thu thập cần có consent phù hợp và tránh ghi đáp án riêng hoặc thông tin cá nhân không cần thiết.

## 11. Bảo mật và điều kiện công khai repository

### 11.1 Trạng thái cần phân biệt

Repo gốc tại commit đánh giá vẫn có bảy file JSON tạm được track, chứa 12 JWT duy nhất đã được nhận diện trong lần quét trước. Các token có thời hạn kết thúc vào tháng 6/2026, đã hết hạn tại ngày báo cáo; báo cáo không chép lại token. `.gitignore` không loại file đã track hoặc xóa lịch sử cũ. [E03]

Repo riêng `duongtuankiet-se/SirLocked`, main `d905bf2`, đã có lịch sử làm sạch và workflow Gitleaks pass. Điều này chỉ áp dụng phạm vi repo/refs đã xử lý. Không thể dùng kết quả đó để khẳng định repo gốc vừa checkout cũng sạch. Các bundle sao lưu lịch sử trong thư mục tmp cần tiếp tục giữ riêng.

Không tìm thấy khóa provider thật trong phạm vi quét text đã thực hiện trước đó. Câu này không bảo đảm tuyệt đối không có secret trong ảnh, artifact, fork, log ngoài phạm vi hoặc dịch vụ khác. Khi public, kiểm tra tất cả branch/tag định đẩy và các release/Actions artifact liên quan.

### 11.2 Các cơ chế bảo vệ đã có

- Password BCrypt; refresh/reset/verification token được hash phía server.
- Refresh rotation có kiểm tra điều kiện; AuthorizationVersion hỗ trợ vô hiệu hóa token sau một số thay đổi nhạy cảm như password/role/status.
- Controller có auth/role; gameplay kiểm tra membership và quyền ở service.
- V3 projection kiểm soát dữ liệu riêng theo vai trò; ảnh chứng cứ có endpoint kiểm tra quyền.
- Giới hạn upload ảnh, kích thước/pixel và chuẩn hóa ảnh trước khi dùng.
- Production demo seeding có guard và yêu cầu cấu hình phù hợp; không nên bỏ các guard để chạy demo trên mạng công khai.
- Có rate limiting trong pipeline, validation và các kiểm tra cấu hình quan trọng; cần kiểm thử từng policy thực tế thay vì coi việc bật middleware đã bao phủ mọi endpoint.

### 11.3 Rủi ro token trình duyệt và logout

Frontend lưu access/refresh token trong localStorage. XSS hoặc JavaScript cùng origin bị kiểm soát có thể đọc chúng. OAuth callback đưa token vào URL fragment rồi frontend lấy ra; fragment không được gửi như HTTP query tới server theo hành vi URL thông thường, nhưng vẫn hiện cho mã trình duyệt và có thể tồn tại trong lịch sử trước khi được dọn. Không nên mô tả sai là chắc chắn lộ qua server access log. [S01, S19]

Nên cân nhắc refresh token trong cookie HttpOnly/Secure với cơ chế CSRF phù hợp và access token ngắn hạn trong memory; hoặc dùng mô hình BFF nếu phù hợp triển khai. Thay đổi này cần thiết kế luồng refresh nhiều tab, CORS, logout và OAuth callback, không chỉ đổi một dòng lưu token. OWASP khuyến cáo tránh lưu session identifier trong localStorage. [W03]

Logout hiện xóa refresh token nhưng không tăng AuthorizationVersion; access token có thời hạn mặc định 12 giờ có thể còn hợp lệ đến khi hết hạn nếu không có lý do thu hồi khác. Đây là hệ quả cần quyết định theo chính sách logout, đặc biệt với ADMIN. Đề xuất access ngắn hơn và cơ chế revoke được kiểm thử; tránh đổi semantics khi chưa xem nhiều thiết bị và phiên song song. [S01]

### 11.4 Môi trường, dữ liệu và dependency

Docker Compose dùng MongoDB 7, map `27017:27017`, chưa cấu hình auth trong file này. Cấu hình phù hợp máy dev cô lập không nên mang nguyên lên host công khai. Bind localhost nếu chỉ dùng local; production cần mạng riêng, auth, TLS khi phù hợp và backup. CI dùng MongoDB 8 nên cũng cần quyết định phiên bản chuẩn. [S20]

Password policy DTO có mức tối thiểu sáu ký tự và yêu cầu chữ/số; nên tăng chất lượng policy theo yêu cầu sản phẩm, giới hạn thử sai và kiểm tra password phổ biến. Chưa thực hiện đánh giá online brute force hay pentest xác thực.

Audit dependency đã thu thập ghi nhận npm có ba package bị đánh dấu mức tổng hợp high với năm advisory; ImageSharp 3.1.11 có năm advisory duy nhất, ba high/hai moderate. Việc cảnh báo lặp trong ba project .NET không có nghĩa có 15 lỗ hổng khác nhau. Một số advisory ImageSharp liên quan API histogram/TIFF encoder không thấy được gọi trong luồng ảnh hiện tại; chưa chứng minh đường khai thác từ ứng dụng. [E03, W04, W05]

Ưu tiên cập nhật có kiểm soát và chạy lại fixture ảnh, build, test. Các package build/tooling như PostCSS/source-map cần xét tác nhân và đầu vào build; không suy từ audit high thành người chơi từ xa đã có RCE. Với ImageSharp, kiểm tra tương thích API, framework và điều kiện license trước khi chọn phiên bản đích.

### 11.5 Điều kiện trước khi public và trước khi mở ứng dụng

Public mã nguồn: chọn đúng remote, xác nhận quyền phân phối mã/ảnh/font/âm thanh, quét toàn bộ refs cần công khai, bỏ file tạm đã track, xoay credential còn hiệu lực nếu từng lộ, kiểm tra artifact và giữ scanner hoạt động. Xóa lịch sử phải phối hợp người có quyền vì ảnh hưởng clone và branch của cộng tác viên.

Mở ứng dụng ra Internet: cần thêm cấu hình deployment, TLS/proxy/CORS, credential production, hardening auth, policy dữ liệu, hạn mức AI, giám sát và khả năng rollback. Secret scan xanh chỉ xác nhận một lớp kiểm tra; CI gameplay đỏ không tự ngăn đổi visibility nhưng là tín hiệu bản phát hành chưa đạt điều kiện chất lượng.

## 12. Hiệu năng và khả năng mở rộng

### 12.1 Truy vấn cộng đồng

Workshop đọc toàn bộ published cases, lọc/search trong memory, tải toàn bộ results của các case khớp, tính thống kê/ranking rồi mới Skip/Take. Đây là phân trang đầu ra, chưa giới hạn công việc của server. Code có chú thích thừa nhận lựa chọn demo-scale; đồng thời đã tránh N+1 bằng cách lấy results theo nhóm. [S14]

Leaderboard cũng lấy tập kết quả phù hợp rồi phòng liên quan trước khi giới hạn bảng xếp hạng. Profile đọc tất cả results của một người rồi rooms để suy thời gian. Review summary đọc tập review để tổng hợp. Các lựa chọn này dễ hiểu khi ít dữ liệu, nhưng lượng RAM/CPU và dữ liệu DB truyền tăng theo lịch sử. [S13–S15]

### 12.2 Hướng cải thiện phù hợp

- Danh sách mới nhất: filter/sort/projection/pagination ở MongoDB, chỉ lấy field thẻ vụ án.
- Tỷ lệ/điểm tổng hợp: dùng aggregation hoặc bảng thống kê có version; phải có cơ chế rebuild và xử lý result ghi lặp.
- Top bảng xếp hạng: lưu các field cần sort trong result; index theo case, thời gian và tiêu chí được chọn sau explain.
- Hồ sơ: index players, pagination lịch sử, summary theo user nếu đo cho thấy cần.
- Review: aggregate phân bố rating và count, không cần kéo toàn bộ text để tính số sao.
- Cache summary có TTL/invalidation rõ; không cache dữ liệu riêng của người A rồi trả cho B bằng key thiếu user/role.

### 12.3 Các giới hạn khác

Room document chứa tiến độ tăng dần; cần theo dõi kích thước document và tách log/media phù hợp để không tiến sát giới hạn MongoDB. CaseCache trả cùng tham chiếu object và tự GetOrCreate, chưa có single-flight khi nhiều request miss; nên xem case cached là bất biến và đo cache stampede trước khi thêm khóa. [S17]

Worker AI/media chạy cùng host API có thể cạnh tranh tài nguyên CPU/network/memory. Thử một phiên chơi khi đồng thời sinh asset để đo ảnh hưởng; tách worker là bước hợp lý khi số liệu xác nhận. Chưa có cơ sở để yêu cầu Kubernetes, Kafka hoặc chia microservices ngay.

### 12.4 Kế hoạch đo tải đề xuất

Đây là thiết kế thử nghiệm, chưa phải năng lực hệ thống được chứng minh. Bắt đầu dataset 100/1.000/10.000 results; đo Workshop, Profile và leaderboard với 1/10/50 client đồng thời. Với gameplay, tăng dần 1/5/20 phòng hai người trên môi trường ghi rõ CPU/RAM/DB/network; dừng khi lỗi hoặc chi phí vượt ngân sách thử.

Thu p50/p95/p99 latency, lỗi nghiệp vụ và hạ tầng riêng, CAS conflict/retry, heap/GC, số document examined/returned, kích thước payload và độ trễ đồng bộ giữa hai client. Chạy baseline không AI rồi chạy có AI worker. Chỉ công bố con số chịu tải sau khi có báo cáo tái hiện được.

## 13. Chất lượng mã và tổ chức dự án

### 13.1 Các điểm nên giữ

Domain rules thuần giúp kiểm thử không cần DB; coordinator gói state transition và persistence; interfaces cho các cổng nhạy cảm; snapshot kết quả và unique index bảo vệ bất biến. Frontend có module recovery/lifecycle tách riêng và unit test. Tài liệu ADR/schema/playtest hiện diện, giúp hiểu ý định thiết kế. [S05–S12, S16]

### 13.2 Các điểm làm tăng chi phí thay đổi

| File / khu vực | Quy mô đo được | Rủi ro bảo trì | Hướng xử lý |
| --- | --- | --- | --- |
| AiCaseService.cs | 6.559 dòng | Orchestration, provider và nhiều bước workflow tập trung | Tách use case và provider adapter theo ranh giới đầu vào/đầu ra |
| gamePage.ts | 6.043 dòng | UI/input/render/network cùng trạng thái | Tách runtime và panel, lifecycle thống nhất |
| GameplayService.cs | 1.939 dòng | Nhiều command và biến thể mechanics | Dispatcher/use case theo nhóm; giữ common invariant ở một nơi |
| CaseValidationService.cs | 1.932 dòng | Nhiều quy tắc chồng lên nhau | Validator theo contract, trả lỗi có cấu trúc, fixture matrix |
| CSS gameplay/workshop | Nhiều file 1.900–2.900 dòng | Cascade, trùng style và ảnh hưởng layout ngoài ý muốn | Scope component, audit unused, visual regression |
| AI service partial và schema | Nhiều contract/version | Sửa một nơi không chắc đồng bộ nơi khác | Single source cho contract, compatibility fixtures |

Tách file đơn thuần chỉ làm file ngắn hơn. Refactor có giá trị khi giảm số trạng thái một module cần biết, làm rõ quyền sở hữu dữ liệu và giảm số nơi phải sửa cho một use case. Nên dùng từng PR nhỏ với test bảo vệ hành vi hiện tại.

### 13.3 Tài liệu và tính đúng của kiến thức dự án

Một số tài liệu ngữ cảnh cũ mô tả branch/công nghệ/tính năng khác hiện tại. Ví dụ AI_CONTEXT còn nhắc hướng Deepseek hoặc phạm vi community cũ, trong khi triển khai đang có Workshop/Leaderboard và pipeline OpenAI. Cần phân loại tài liệu: current, historical decision, prototype, audit proposal. [S21]

Tài liệu audit cũ là thông tin lịch sử hoặc đề xuất; không được lấy danh sách “còn thiếu” tháng trước làm kết luận tháng này mà không đối chiếu source. README nên dẫn đến một bản system overview, bảng biến môi trường, quy trình chạy test thật và danh sách hạn chế đã biết.

### 13.4 Quản lý thay đổi nội dung

Case data là một phần chương trình vì điều khiển điều kiện mở khóa và logic thắng. Cần review JSON như review code: schemaVersion, mechanicsVersion, provenance, migration, automated validation và golden walkthrough. Tách canonical gameplay khỏi presentation giúp đổi hình thức không làm lệch luật; cần tiếp tục bảo vệ ranh giới đó trong import/publish.

## 14. Kiểm thử và phân tích CI

### 14.1 Các lệnh chạy tại workspace

| Kiểm tra | Kết quả ngày 16/10/2026 | Giới hạn |
| --- | --- | --- |
| dotnet test Release --no-restore | Exit 0; 936 unit + 109 integration báo pass | Mongo IT và OpenAI schema probe tắt |
| npm run typecheck | Pass | strict/checkJs đang tắt |
| npm run test:assets | 4/4 pass | Đóng gói asset và chặn traversal trong các fixture |
| npm run test:realtime | 11/11 pass | Logic recovery bằng test, không phải mạng Internet thật |
| npm run test:guide | 3/3 pass | State role guide |
| npm run test:navigation | 6/6 pass | Hình học/pathfinding độc lập browser |
| npm run build | Pass | Có cảnh báo chunk lớn và annotation SignalR được bỏ |

Lần chạy backend có cảnh báo dependency ImageSharp và analyzer xUnit. Ban đầu lệnh trong sandbox không hoàn tất, nên kết quả được lấy từ lần chạy ngoài sandbox đã được cho phép; log cuối có exit 0. Không diễn giải sự cố sandbox thành lỗi ứng dụng. [E05]

### 14.2 Vì sao integration pass chưa đủ?

Nhiều test Mongo dùng kiểm tra biến `SIRLOCKED_RUN_MONGO_IT`; khi không bằng true thì return sớm. Test runner vẫn đếm pass, không phải skipped. Do đó 109 pass ở lần chạy local không chứng minh 109 ca đã thực thi trên MongoDB thật. Đây là điểm minh bạch test cần cải thiện: dùng skip có lý do hoặc tách project/job bắt buộc bật Mongo. [S22]

CI api-smoke có bật Mongo integration và log cho thấy 109 ca pass trước khi lỗi ở bước chạy HTTP API. Bằng chứng này mạnh hơn cho nhóm test DB, nhưng không thay cho full-stack game hoặc kiểm tra provider AI thật.

### 14.3 Phân tích workflow CI đã quan sát

Workflow run `38880366747`, commit `d905bf2` trên repo riêng có ba job thất bại. Secret scanning run `38880366801` thành công. [E02]

**Job api-smoke — nguyên nhân xác minh từ log và source.** Backend build được, Mongo test pass, API có mở cổng nhưng request readiness bị exception `ClientId` rỗng trong cấu hình Google. Program đăng ký Google authentication không điều kiện; CI không cung cấp Google ClientId. Authentication middleware khởi tạo options làm request thất bại, nên `/live` không đạt. Không cần cấp AI key hay Google secret thật chỉ để smoke test. Nên đăng ký provider khi đủ cấu hình, hiển thị capability tương ứng và test cả bật/tắt provider. [S01, S23]

**Job two-browser-game — hiện tượng xác minh, nguyên nhân chưa kết luận.** Seeder/build hoàn thành; script báo timeout chờ API health tại `scripts/test-v3-full-stack.ps1:132`. Cấu hình tương tự khiến lỗi Google là giả thuyết hợp lý, nhưng log API chi tiết chưa được giữ trong output này. Cần lưu stdout/stderr và response health để xác nhận. Phần gameplay hai browser chưa chạy đến nên chưa có bằng chứng pass/fail về gameplay thực tế từ job đó.

**Job verify — ba lỗi trong 133 browser test.** Backend test pass; typecheck và test assets/realtime/guide pass. Browser có 130 pass và ba fail:

- `game-ui-smoke.spec.ts:1059`: test có tên nhắc portrait/bottom speech, nhưng assertion fail quan sát được là quãng đường keyboard movement: kỳ vọng lớn hơn 100, thực tế 67,5. Không nên quy thành lỗi kích thước portrait chỉ dựa tên test.
- `navigation.spec.ts:96`: trạng thái pending motion vẫn true sau thời gian chờ 10 giây.
- `navigation.spec.ts:193`: thao tác exit scene kỳ vọng được gọi một lần nhưng thực tế 0 sau 10 giây.

Log có lỗi Vite proxy connection refused cho API không được mock đầy đủ. Đây là nhiễu cần xử lý để test rõ hơn, nhưng chưa chứng minh là nguyên nhân của ba lỗi trên. Cần trace/video, vị trí nhân vật, frame time và route state khi tái hiện. Không sửa bằng cách tăng timeout hàng loạt trước khi hiểu nguyên nhân.

### 14.4 Những khoảng trống kiểm thử còn quan trọng

Chưa chạy lại toàn bộ Playwright ở local trong đợt báo cáo này; dùng bằng chứng CI đã nêu. Chưa thực hiện paid AI probe, multi-instance, load test, pentest hay restore drill. Không có coverage report để kết luận phần trăm phủ nhánh/dòng.

Nên bổ sung test theo rủi ro: provider optional startup, thành viên ngoài phòng, projection không lộ thông tin, race terminal/confirm, job lease bị mất, crash sau DB write trước notify, result repair, request provider trạng thái chưa rõ, xóa room không làm sai thống kê và refresh nhiều tab. Các test đã có phải được kiểm kê trước khi thêm để tránh lặp.

## 15. Triển khai, vận hành và quan sát hệ thống

### 15.1 Tính tái lập môi trường

Cần một cấu hình demo tối thiểu chạy được mà không có provider thật; cấu hình staging và production tách biệt; danh sách biến bắt buộc/tùy chọn và capability có thể kiểm tra. Fail-fast cho JWT/DB invariant là hợp lý, nhưng provider tùy chọn không nên làm hỏng toàn bộ request chỉ vì clientId rỗng.

Chuẩn hóa .NET/Node/Mongo giữa local và CI; cố định lockfile và định nghĩa runtime hỗ trợ. Frontend build pass không có nghĩa backend có health đúng, và API health pass cũng không có nghĩa một phòng chơi hoàn thành được. Pipeline nên thể hiện từng cổng riêng.

### 15.2 Quan sát theo nghiệp vụ

| Nhóm | Metric / log cần có | Dùng để quyết định |
| --- | --- | --- |
| HTTP | p95, lỗi theo route, rate-limit hit, auth failure | Có đáp ứng tải và có sự cố đăng nhập không |
| Gameplay | active room, command latency, CAS conflict/retry, duplicate terminal | Invariant ổn định và có tranh chấp quá mức không |
| Realtime | reconnect, failed rejoin, state version lag | Hai người có thấy cùng tiến độ trong thời gian chấp nhận được không |
| AI queue | queue age, run duration, retry, lease lost, stuck job | Có backlog và cần tách worker không |
| AI cost | reservation pending, actual cost, cost/publish, repair rate | Hạn mức và chất lượng có kiểm soát được không |
| DB/media | query examined/returned, dung lượng, orphan asset | Cần index, aggregation hoặc retention nào |
| Sản phẩm | hoàn thành hướng dẫn/đối chất/vụ án, lý do bỏ | Game có dễ hiểu và hợp tác có ý nghĩa không |

Log nên có correlationId, roomId/draftId và workflowRunId phù hợp; không ghi bearer token, refresh token, password hoặc toàn bộ truth vào log người chơi. Phân tách log debug tác giả và log vận hành, đặt retention và quyền truy cập.

### 15.3 Runbook cần có

Mô tả cách rollback bản API/FE và contract tương thích; cách xử lý draft kẹt/lease mất/reservation chưa quyết toán; cách dựng lại GameResult từ snapshot; cách gỡ case lỗi khỏi published mà không phá phiên đang chơi; và cách khôi phục Mongo cùng media.

Theo dõi các sự kiện không thể tự retry an toàn, đặc biệt request provider có thể đã tính phí nhưng chưa biết kết quả. Runbook cần thao tác cụ thể, quyền cần có và cách kiểm chứng sau sửa; không chỉ ghi “restart server”.

## 16. Danh sách vấn đề có thể hành động

### 16.1 Quy ước ưu tiên

P0: rủi ro nghiêm trọng đang xảy ra cần chặn ngay; chưa xác minh sự cố đang bị khai thác để gán P0 trong báo cáo này. P1: chặn mục tiêu phát hành/public phù hợp. P2: cần xử lý để tăng độ tin cậy và chuẩn bị tăng dữ liệu. P3: cải thiện có thể xếp sau khi có số đo. Mức ưu tiên phụ thuộc mục tiêu; public source và production là hai cổng khác nhau.

### F01 — Google provider rỗng làm HTTP smoke thất bại

**P1 · Xác minh mã + log CI · Phụ trách: backend.** Program đăng ký Google bất kể có cấu hình; CI request báo ClientId rỗng. Sửa theo optional capability hoặc cấu hình test tường minh. Nghiệm thu: API khởi động và `/live` trả 200 khi Google tắt; local login hoạt động; bật Google với cấu hình hợp lệ vẫn chạy; cấu hình thiếu một nửa báo lỗi dễ hiểu. [S01, S23]

### F02 — Ba browser test lỗi, full-stack chưa được chứng minh

**P1 · Log CI · Phụ trách: frontend + QA.** Có failure movement/navigation và job hai browser dừng trước gameplay. Thu trace/video/API log; tái hiện ba ca độc lập rồi chạy full suite. Nghiệm thu: không còn lỗi đã biết, test không dựa sleep mù, hai user hoàn thành một case thật với reconnect. Chưa được gọi đây là lỗi flaky hay lỗi sản phẩm chắc chắn khi chưa chẩn đoán. [E02]

### F03 — Repo gốc vẫn có dữ liệu JWT trong file đã track

**P1 khi public repo gốc · Xác minh ở đợt quét trước · Phụ trách: maintainer.** Token đã hết hạn nhưng lịch sử vẫn chứa dữ liệu không nên phân phối. Không đẩy refs/bundle cũ sang repo sạch. Nghiệm thu: scan current tree và mọi refs định công khai, review allowlist, không có token thật còn hiệu lực; quyền phân phối asset được xác nhận. Không thay lịch sử repo gốc trong phạm vi báo cáo. [E03, E04]

### F04 — Token storage và logout còn khoảng trễ thu hồi

**P2, nâng P1 cho ADMIN/public deployment · Xác minh mã · Phụ trách: backend + frontend.** localStorage chứa access/refresh, access mặc định 12 giờ, logout không tăng AuthorizationVersion. Thiết kế lại phiên theo threat model; thêm test revoke/multi-tab/OAuth. Nghiệm thu: thời gian token còn hiệu lực sau logout đúng policy và được test; giảm khả năng JavaScript đọc refresh token. [S01, S19]

### F05 — Truy vấn thống kê chưa giới hạn dữ liệu xử lý

**P2 trước tăng dữ liệu · Xác minh mã · Phụ trách: backend/data.** Workshop/leaderboard/profile/summary đọc tập dữ liệu rồi tính memory. Đo baseline, chuyển filter/projection/aggregation/pagination phù hợp và index theo explain. Nghiệm thu: đúng kết quả so với fixture cũ, số document/payload được kiểm soát và latency đạt mục tiêu đã thống nhất. [S13–S15]

### F06 — Chạy nhiều instance cần thiết kế bổ sung

**P2 nếu mở replica · Suy luận từ code · Phụ trách: backend/operations.** Presence static và cache process-local. Chọn single instance có giám sát cho demo hoặc thiết kế shared routing/events/presence/cache invalidation khi tăng replica. Nghiệm thu: hai người nối khác instance vẫn đồng bộ, crash/rejoin không để online sai kéo dài. [S08, S17]

### F07 — Tập trung trách nhiệm trong AI và gameplay UI

**P2 · Xác minh cấu trúc · Phụ trách: backend/frontend.** AiCaseService 6.559 dòng; gamePage 6.043 dòng. Tách use case và module có lifecycle, giữ characterization tests. Nghiệm thu: một thay đổi nhỏ không cần sửa nhiều trạng thái unrelated; module có contract và test riêng. Không đặt chỉ tiêu số dòng đơn thuần. [E01]

### F08 — Runtime và dependency cần cập nhật

**P2, có thời hạn gần · Audit + nguồn chính thức · Phụ trách: maintainer.** .NET 9 gần hết hỗ trợ, Node20 CI EOL và dependency có advisory. Lập PR nâng từng lớp, kiểm tra tương thích và license. Nghiệm thu: runtime còn hỗ trợ, audit được xử lý hoặc có chấp nhận rủi ro có hạn, test ảnh/gameplay/build pass. [W01, W02, E03]

### F09 — Integration return sớm tạo tín hiệu pass khó hiểu

**P2 · Xác minh mã · Phụ trách: QA/backend.** Tách test có Mongo và provider probe; thể hiện skip rõ ràng. Nghiệm thu: CI release bắt buộc chạy DB test với cờ bật và số ca thực thi được ghi; không dùng tổng pass local để chứng minh DB đã kiểm tra. [S22]

### F10 — Kết quả lịch sử và thống kê còn phụ thuộc room/current case

**P2 trước retention/edit case · Xác minh mã, tác động có điều kiện · Phụ trách: domain/data.** Lưu duration/version vào result; stats dùng snapshot phù hợp; migration không giả dữ liệu cũ. Nghiệm thu: sửa case hoặc dọn room không đổi ý nghĩa lịch sử đã ghi, dữ liệu thiếu hiển thị Unknown. [S07, S13, S14]

### F11 — Bundle gameplay và CSS lớn

**P2 khi demo mạng chậm; nếu chưa có tác động đo được thì P3 · Chạy build · Phụ trách: frontend.** Tách player/editor path, đo asset/runtime, giảm phần không dùng. Nghiệm thu: có so sánh transfer/time-to-interactive và frame time trên thiết bị mục tiêu; giữ visual regression. [E05]

### F12 — Quy trình production và AI recovery chưa được chứng minh

**P2 trước mở dịch vụ · Giới hạn bằng chứng · Phụ trách: operations + backend.** Cần restore drill, rollback, cảnh báo queue/cost và xử lý provider unknown state. Nghiệm thu: diễn tập với dữ liệu staging, có thời gian khôi phục đo được và không lặp thanh toán khi recovery. Đây là thiếu bằng chứng trong đợt review, không khẳng định mọi công cụ vận hành đều chưa tồn tại.

## 17. Lộ trình cải thiện và cổng nghiệm thu

### 17.1 Giai đoạn 1 — Làm bản demo đáng tin cậy

Ưu tiên F01/F02/F03 theo mục tiêu. Khóa scope một case V3 đã duyệt và hai vai trò. Làm môi trường không yêu cầu paid provider để smoke test; giữ Google optional đúng semantics. Lưu log/trace khi CI lỗi. Xác minh một phiên từ đăng nhập, join/ready/start đến đối chất, đồng thuận kết luận và result.

Cổng hoàn thành: clean checkout chạy được theo hướng dẫn; CI có tín hiệu rõ; một phiên hai browser thật hoàn thành; refresh/reconnect không mất tiến độ; các lỗi còn tồn tại được nêu minh bạch. Nếu công khai source, chỉ dùng lịch sử đã được quét và xác nhận quyền asset.

### 17.2 Giai đoạn 2 — Ổn định nền tảng và đo trước khi sửa lớn

Thực hiện trong khoảng kế hoạch 30 ngày đầu nếu nguồn lực cho phép, không phải cam kết thời lượng. Nâng runtime theo deadline hỗ trợ; làm rõ auth session; test DB bắt buộc; lưu metrics CAS/realtime/queue. Đo Workshop với dataset lớn hơn và frontend trên thiết bị mục tiêu. Chọn một lát cắt nhỏ tách gamePage hoặc AI use case có test bảo vệ.

Cổng hoàn thành: có baseline hiệu năng/chi phí; xử lý advisory có quyết định; dữ liệu test phân biệt thực thi/skip; module đầu tiên tách mà không đổi hành vi; có tài liệu cấu hình được kiểm tra bằng clean setup.

### 17.3 Giai đoạn 3 — Chất lượng nội dung và dữ liệu lâu dài

Trong khoảng kế hoạch ngày 31–60: tăng fixture AI và kiểm tra progression, đo cost/publish; tổ chức playtest có protocol; xác định scene/role khiến người chơi bị kẹt. Chuẩn hóa result duration/version, case provenance và thống kê. Chỉ thêm aggregation/cache cần thiết theo số đo; giữ rebuild được.

Cổng hoàn thành: mỗi case có walkthrough, người duyệt và phiên bản; số liệu chơi thật có nguồn; thống kê không phụ thuộc tài liệu hiện tại làm đổi lịch sử; retry AI có chi phí và trạng thái quan sát được.

### 17.4 Giai đoạn 4 — Chuẩn bị phát hành có kiểm soát

Trong khoảng kế hoạch ngày 61–90: restore drill, rollback, retention, cảnh báo, hardening môi trường và test tải nhỏ. Nếu cần nhiều instance, triển khai shared realtime/presence/cache rồi test cross-instance. Nếu API bị AI cạnh tranh tài nguyên, tách worker với cùng protocol lease/checkpoint trước khi nghĩ đến hệ thống queue mới.

Cổng hoàn thành: owner chấp nhận rõ mức tải/chi phí/rủi ro; test khôi phục và phân quyền đạt; không còn P1 của phạm vi phát hành. Mở beta giới hạn trước khi mở rộng. Thời lượng thực tế phụ thuộc nhân sự, dữ liệu và kết quả tái hiện lỗi; không nên dùng roadmap làm lịch giao hàng cố định.

### 17.5 Bộ cổng phát hành thực dụng

| Cổng | Bằng chứng bắt buộc |
| --- | --- |
| G1 — Setup | Clone sạch, cài dependency, khởi động API/FE/DB theo tài liệu |
| G2 — Nghiệp vụ | Hai user khác nhau hoàn thành case; quyền vai trò, revision và terminal đúng |
| G3 — Phục hồi | Reload, mất mạng, reconnect, duplicate command và repair result |
| G4 — Bảo mật | Secret scan đúng refs, kiểm tra role/membership/media, cấu hình deploy an toàn |
| G5 — Chất lượng | Browser failures được xử lý; DB test thật; case validation và human review |
| G6 — Vận hành | Backup/restore, rollback, alert API/queue/cost; giới hạn ngân sách |
| G7 — Đo lường | Baseline latency, bundle/runtime, chi phí case và quan sát playtest |

## 18. Câu hỏi cần xác thực, cách trình bày dự án và nguồn dẫn chứng

### 18.1 Các quyết định chủ dự án cần chốt

- Mục tiêu gần nhất là đồ án/demo, portfolio công khai, playtest hay dịch vụ có người dùng? Mỗi mục tiêu có cổng khác nhau.
- Có bao nhiêu developer vận hành, mức thời gian duy trì và ngân sách AI tháng là bao nhiêu?
- Ngôn ngữ/thiết bị/mạng mục tiêu của người chơi là gì? Game có yêu cầu hai người ở cùng cuộc gọi không?
- Nội dung published có được chỉnh cùng caseId hay phải tạo version mới? Phiên đang chơi dùng bản nào?
- Xóa tài khoản, xóa room, giữ ảnh chứng cứ và log bao lâu? Những thống kê nào phải còn sau khi dọn dữ liệu?
- Ai được tạo/duyệt/publish case; owner draft được xác định ra sao; ai xử lý job/provider kẹt?
- Những phần mã/asset nào nhóm có quyền công khai; license và attribution nào cần giữ?

### 18.2 Các mô tả có thể dùng khi trao đổi kỹ thuật

Mô tả an toàn theo bằng chứng: “SirLocked là game điều tra hợp tác hai người, sử dụng ASP.NET Core, MongoDB, SignalR và Phaser. Backend quản lý tiến độ và projection theo vai trò; các tương tác đối chất và buộc tội sử dụng revision cùng optimistic concurrency. Hệ thống có pipeline AI tạo vụ án có cấu trúc, validation, approval, queue và budget tracking.”

Để dùng cho CV, chỉ chọn trách nhiệm đã thực sự làm và giải thích được. Có thể chọn các chủ đề: thiết kế state machine, CAS MongoDB, bảo vệ dữ liệu riêng, recovery realtime, result snapshot, pipeline AI có lease/quota, renderer và navigation. Không nhận toàn bộ dự án là đóng góp cá nhân khi chưa đối chiếu commit và phân công nhóm.

Các outcome có bằng chứng hiện tại là chức năng đã triển khai và kết quả kiểm tra cụ thể, ví dụ build/typecheck pass hay test logic recovery. Chưa có bằng chứng để ghi lượng người dùng, độ sẵn sàng 99,9%, hỗ trợ hàng nghìn concurrent user, giảm chi phí phần trăm hoặc production launch thành công. Số liệu test phải kèm phạm vi; không biến 109 integration pass khi tắt Mongo thành “đã kiểm thử toàn bộ database”.

### 18.3 Bản đồ đọc mã nguồn

Các đường dẫn dưới đây tương đối từ root repository. Số dòng ở các mục có ghi là mốc của commit đánh giá; tên module là đầu mối đọc cho phần còn lại. Đường dẫn được giữ trong PDF để tra cứu ngay cả khi không có kết nối GitHub.

| Mã | Nguồn | Dùng kiểm chứng |
| --- | --- | --- |
| S01 | src/BE/Program.cs:316; Services/AuthService.cs; Configurations/JwtSettings.cs; WebAPI/GoogleAuthenticationSetup.cs | Auth, optional Google, token lifetime/revoke |
| S02 | src/BE/WebAPI/Controllers/GameController.cs:18 | Danh mục command gameplay |
| S03 | src/BE/Services/RoomService.cs:47,85,309,407 | Create/join/start và LobbyVersion |
| S04 | src/BE/Services/GameplayService.cs; GameplayContextLoader.cs; GameStateBuilder.cs | Quyền hành động, context và projection |
| S05 | src/BE/Services/GameplayStatePersistence.cs:20 | CAS và cập nhật trường gameplay |
| S06 | src/BE/Services/PairedConfrontationCoordinator.cs:17; PairedConfrontationRules.cs | Revision và state machine đối chất |
| S07 | src/BE/Services/AccusationConsensusCoordinator.cs; GameResultFactory.cs; Models/GameResult.cs | Đồng thuận, snapshot và materialize result |
| S08 | src/BE/WebAPI/Hubs/GameHub.cs:16; Services/GameNotifier.cs | Presence, pose và realtime event |
| S09 | src/BE/DataAccess/MongoDbContext.cs:64,293 | Collection và index/invariant kết quả |
| S10 | src/BE/WebAPI/Controllers/AdminAiCasesController.cs:12; Services/AiCaseService.cs | Quyền và các bước pipeline AI |
| S11 | src/BE/Services/AiGenerationWorker.cs:8; AiDraftWorkflowCoordinator.cs; AiUsageAccounting.cs | Queue, lease, retry và usage |
| S12 | src/BE/Services/CaseTruthService.cs; Projection/; CaseValidationService.cs | Truth, compiler và validation |
| S13 | src/BE/Services/ProfileService.cs:28,58,152; LeaderboardService.cs:19 | Profile, creator gap và thời gian giải |
| S14 | src/BE/Services/WorkshopService.cs:38,124,216 | In-memory ranking, author và stats |
| S15 | src/BE/Services/ReviewService.cs:20,96; WeeklyService.cs; BadgeService.cs | Review, weekly và badge |
| S16 | src/FE/Client/js/services/stateRefetcher.js; routeLifecycle.js; scripts/realtime-recovery.test.mjs | Retry, cleanup và reconnect |
| S17 | src/BE/Services/CaseCache.cs:19,49 | Cache theo process và object dùng chung |
| S18 | src/FE/Client/js/pages/gamePage.ts; game/navigation.ts; tsconfig.json | Runtime, navigation và mức typecheck |
| S19 | src/FE/Client/js/services/session.js; pages/oauthCallbackPage.js:28; src/BE/WebAPI/FrontendRedirects.cs:18 | Token ở browser và fragment OAuth |
| S20 | docker-compose.yml; .github/workflows/ci.yml | Mongo/network và môi trường CI |
| S21 | README.md; AI_CONTEXT.md; docs/; ai-game-docs/ | Tài liệu hiện tại và tài liệu lịch sử |
| S22 | src/BE/IntegrationTests/AiCaseWorkflowHostTests.cs:36; MongoAiUsageAccountingTests.cs:150 | Test return khi không bật Mongo |
| S23 | .github/workflows/ci.yml; scripts/test-v3-full-stack.ps1:132 | Startup smoke và timeout health |

### 18.4 Bằng chứng thực thi và bảo mật đã lưu

- E01: `tmp/senior-review/metrics.json`; bản sao phát hành `output/reports/SIRLOCKED_REVIEW_METRICS_2026-10-16.json`.
- E02: CI https://github.com/duongtuankiet-se/SirLocked/actions/runs/38880366747 ; secret scan https://github.com/duongtuankiet-se/SirLocked/actions/runs/38880366801 . Repo riêng có thể yêu cầu đăng nhập. Metadata ở `output/security/github-ci-status.json`; log đã che dữ liệu tại `tmp/security-remediation/ci-logs/`.
- E03: `output/security/SECURITY_REVIEW_2026-10-16.md`; `tmp/security/npm-audit.json`; `tmp/security/dotnet-audit.json`. Đối chiếu nội dung report bảo mật với repo/branch hiện tại trước khi dùng.
- E04: `output/security/SECURITY_CLEANUP_PUBLISHED_2026-10-16.md` và báo cáo cleanup liên quan, phạm vi repo riêng.
- E05: `tmp/senior-review/backend-test.log` và TRX ở `tmp/senior-review/test-results/`; frontend commands chạy tại `src/FE` gồm typecheck, test:assets, test:realtime, test:guide, test:navigation và build. Bản tóm tắt kết quả ở `output/reports/SIRLOCKED_REVIEW_VERIFICATION_2026-10-16.json`.

### 18.5 Nguồn bên ngoài đã đối chiếu ngày 16/10/2026

- W01 — Microsoft .NET support policy: https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core . Căn cứ thời hạn hỗ trợ .NET 9 và lựa chọn .NET 10 LTS.
- W02 — Node.js releases: https://nodejs.org/en/about/previous-releases . Căn cứ Node 20 EOL và Node 24 LTS.
- W03 — OWASP HTML5 Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html . Căn cứ rủi ro session identifier trong localStorage.
- W04 — ImageSharp advisory: https://github.com/advisories/GHSA-j3p4-wp97-rph4 . Ví dụ cần phân biệt package advisory với đường gọi có thể khai thác; các advisory còn lại có trong audit JSON.
- W05 — PostCSS advisory: https://github.com/advisories/GHSA-r28c-9q8g-f849 . Rủi ro source map trong xử lý đầu vào build; không tự chứng minh remote exploit của game.

### 18.6 Kết luận cuối

SirLocked có nền tảng nghiệp vụ và nhiều cơ chế kỹ thuật đáng đầu tư tiếp: server quản lý trạng thái, quyền biết thông tin theo vai trò, revision/CAS, kết quả có snapshot và workflow AI có kiểm soát. Bước phát triển đem lại giá trị nhất là chứng minh một phiên chơi trọn vẹn ổn định, đóng các khoảng trống cấu hình/CI và đo tải/chi phí trước khi mở rộng kiến trúc.

Nên dùng tài liệu này làm danh sách quyết định và tiêu chí nghiệm thu. Mỗi kết luận về production, chất lượng nội dung hay hiệu quả kinh doanh cần được bổ sung bằng bằng chứng tương ứng trước khi đưa vào kế hoạch phát hành hoặc CV.
