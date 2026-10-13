# Chạy demo SirLocked trên Windows

Đây là demo tùy chọn với database riêng. Dự án chính dùng cấu hình `.env` hiện có và chạy frontend ở [localhost:5173](http://localhost:5173), API ở `localhost:5215`; xem cách khởi động thông thường trong [README](../README.md#run-locally). Nếu `.env` trỏ tới MongoDB từ xa đang truy cập được, dự án chính không cần Docker hoặc MongoDB cài trên máy.

## Chạy với database chính để thử tạo case

```powershell
./scripts/start-local-main.ps1
```

Script build code mới rồi mở API ở `http://localhost:5215` và frontend ở `http://localhost:5173`. API chạy từ `src/BE`, đọc nguyên `.env` và `appsettings.Development.json` hiện có; không thay database, tài khoản, mock, quota, ngân sách hoặc cấu hình asset bằng giá trị demo. Đăng nhập bằng tài khoản trong database chính và mở `/#/admin/ai` để tạo draft. Các cổng phải còn trống; script không dừng ứng dụng khác.

Worker của API tiếp tục tác vụ generation đã xếp hàng theo hành vi thông thường. Draft cũ đang giữ quota vẫn được giữ; nếu cấu hình giới hạn một draft đang hoạt động, phải hoàn tất/hủy draft đó hoặc chủ động điều chỉnh quota trước khi tạo thêm. Trần ngân sách dùng sổ chi tiêu hiện có, không được đặt lại khi khởi động.

Dừng bằng `./scripts/stop-local-main.ps1`; script chỉ dừng hai tiến trình đã ghi nhận bằng PID và thời điểm tạo, không xóa dữ liệu database. Log và thông tin tiến trình nằm trong `tmp/local-main`.

## Khởi động

Từ thư mục chứa `SirLocked.sln`:

```powershell
./scripts/start-local-demo.ps1
```

Script dùng .NET 9, Node.js và MongoDB portable. Nó tìm `mongod` trong PATH hoặc `.tools/`; nếu MongoDB đặt ở nơi khác:

```powershell
./scripts/start-local-demo.ps1 -MongoExecutable 'C:\duong-dan\mongod.exe'
```

Trên máy mới, chạy `dotnet restore SirLocked.sln` ở repo root và `npm ci` trong `src/FE` trước. MongoDB cần được cài sẵn; script không tự tải phần mềm.

Script build backend, mở ba tiến trình ẩn, chờ `/health` xác nhận MongoDB, seed cặp case V3 cũ và cặp point-and-click Anh/Việt khi catalogue chưa có từng cặp, rồi mở Vite. Các cổng mặc định:

- Game: <http://127.0.0.1:5174>
- API health: <http://127.0.0.1:5216/health>
- MongoDB: `127.0.0.1:27020`, database `SirLockedLocalDemo`

MongoDB chỉ lắng nghe loopback và có thư mục riêng `tmp/local-demo/mongo-data`. Script không sửa `.env`, không kết nối DB bên ngoài đang cấu hình và không xóa ván chơi khi dừng. AI chạy mock, sinh asset trả phí và video đều tắt. Đây là cấu hình demo local, không dùng để triển khai public.

Hai cổng demo `5174`/`5216` tách khỏi cổng dự án chính `5173`/`5215`. Trình duyệt lưu phiên đăng nhập riêng theo origin, nên tài khoản/token demo không thay phiên của dự án chính. Dữ liệu cũ vẫn được truy cập qua dự án chính và cấu hình `.env` ban đầu.

Tài khoản được tạo trong DB demo:

| Vai | Email | Mật khẩu demo local |
|---|---|---|
| Quản trị | `admin@sirlocked.local` | `LocalDemo123!` |
| Người chơi 1 | `player1@demo.sirlocked.local` | `LocalDemo123!` |
| Người chơi 2 | `player2@demo.sirlocked.local` | `LocalDemo123!` |

Tài khoản người chơi demo được xác minh tự động trong Development, không gửi email. Mở hai browser profile hoặc hai trình duyệt để đăng nhập riêng. Hai cửa sổ ẩn danh của cùng trình duyệt có thể dùng chung session, nên không mặc định xem chúng là hai profile độc lập.

Chọn cùng một vụ án, tạo/vào phòng bằng mã, chọn hai vai khác nhau, cả hai bấm Sẵn sàng rồi host bắt đầu. Để kiểm chứng thông tin riêng, hai người không nhìn màn hình nhau và giao tiếp bằng thoại.

## Vụ án point-and-click

Chọn **The Night Ledger** hoặc bản tiếng Việt **Cuốn sổ trong đêm**. Vụ án đi qua phòng bán vé và hành lang hậu trường, dùng cùng hệ thống co-op V3: chứng cứ của Điều tra viên và lời khai của Thẩm vấn viên chỉ được chia sẻ khi hai người chủ động đối chất.

- Nhấp sàn để đi đến vị trí; nhấp vật thể, nhân chứng hoặc lối đi để nhân vật đến gần rồi tương tác. Click mới thay yêu cầu cũ. **WASD / phím mũi tên** di chuyển hai chiều, **E** tương tác gần nhất, **Esc** hủy đường đi hoặc đóng giao diện.
- **B** mở túi đồ. Chọn **Kết hợp**, chọn hai món rồi xác nhận; để dùng một món, mở chi tiết, chọn **Dùng** rồi nhấp đích trong cảnh.
- **Z** bật máy ảnh cho Điều tra viên. Chế độ máy ảnh dùng thao tác chụp hiện có; đóng lại để tiếp tục di chuyển.
- Nhấp nhân chứng bằng vai Thẩm vấn viên, chọn câu hỏi, dùng **Space** để hiện hết hoặc đọc tiếp, **Esc** rời hội thoại. Các lựa chọn mới vẫn dựa trên chứng cứ do máy chủ xác nhận.
- Hồ sơ vụ án chứa chứng cứ/lời khai riêng, đối chất, suy luận và bản đồ. Cáo buộc cuối chỉ hoàn tất khi cả hai người xác nhận cùng một phiên bản.

Nhạc nền và hiệu ứng là các WAV gốc đi kèm dự án, có fallback tổng hợp cho case cũ. Điều chỉnh nhạc/hiệu ứng hoặc tắt âm trong điều khiển âm thanh của trận; thiết lập được lưu trên trình duyệt. Âm thanh bắt đầu sau thao tác người dùng, dừng khi tab bị ẩn hoặc rời game; hội thoại giảm âm nền. Hướng dẫn theo vai và gợi ý trong cảnh hỗ trợ khi bị kẹt.

Đặc tả runtime cho nội dung mới: `scene.runtime.navigationObstacles` là các hình chữ nhật theo tọa độ gốc của cảnh, mô tả chỗ chân nhân vật không đi qua; danh sách rỗng cho phép đi khắp vùng `walkableArea`. Khi trường này vắng mặt, renderer dùng `itemPlacements[].reservedSlot` theo hành vi case cũ. `scene.runtime.audio` gồm `ambienceUrl` và `cues` (tên cue → URL asset). Backend kiểm tra hình học/URL và chỉ chiếu các trường trình bày này; đáp án, chứng cứ riêng và quyền thao tác vẫn do backend quyết định. Đường đi dùng thuật toán visibility graph với vật cản được nới theo kích thước nhân vật; mở panel, đổi cảnh, mất đồng bộ/kết nối hoặc rời game hủy tương tác đang chờ.

Seed riêng bằng `POST /api/admin/cases/seed-point-click-demo` với tài khoản Admin. Endpoint seed Crack cũ vẫn giữ đúng hai case của nó. Các vụ án mới dùng ID riêng, không thay nội dung những ván cũ.

Trong lobby có **Sao chép lời mời**: link điền sẵn mã phòng và được giữ qua đăng nhập/đăng ký/xác minh email. Người nhận vẫn bấm Vào phòng để xác nhận. Link loopback của bản demo chỉ dùng trên cùng máy; khi triển khai trên domain chung, link sẽ dùng domain đó.

Trang Vụ án có **Tiếp tục ván đang chơi**, chỉ hiển thị tối đa 20 phòng còn hoạt động mà tài khoản đang là thành viên. Phòng chờ mở lại lobby; ván đã bắt đầu mở lại gameplay. Phòng đã kết thúc hoặc bị bỏ cuộc không được khôi phục thành ván mới.

Trong trận, mở **Hướng dẫn** để xem ba bước theo vai. Tiến độ chỉ ghi khi chính người chơi thực hiện hành động, không tự tăng theo hành động đồng đội; có thể đóng/mở lại mà không chặn game. Đây là hướng dẫn trong trận, chưa phải chế độ solo với bot.

Trong ván đang chơi, nếu một trong hai người mất kết nối liên tục đủ **5 phút**, máy chủ tự kết thúc phòng. Kết nối lại trước hạn sẽ hủy bộ đếm của người đó; mất kết nối lần sau được tính lại từ đầu. Giao diện hiển thị thời gian còn lại, không cần bấm kết thúc. Nếu cả hai đều offline, máy chủ vẫn xử lý; khi quay lại, người chơi thấy phòng đã kết thúc. Phòng chờ chưa bắt đầu và ván đã hoàn thành không chịu quy tắc này. Máy chủ kiểm tra mỗi 5 giây nên giao diện có thể chờ thêm một nhịp để nhận trạng thái cuối.

## Dừng và khởi động lại

```powershell
./scripts/stop-local-demo.ps1
./scripts/start-local-demo.ps1
```

Lệnh dừng chỉ tác động PID và thời điểm khởi động do launcher ghi nhận; giữ nguyên data/log. Nếu có cổng bị chiếm, launcher từ chối thay vì dừng chương trình khác. Có thể đổi `-ApiPort`, `-FrontendPort`, `-MongoPort`. Nhật ký nằm trong `tmp/local-demo/*.log`; không chia sẻ log nếu bạn tự thêm thông tin riêng vào đó.

JWT local được đổi mỗi lần khởi động: đăng nhập lại sau khi restart. Tài khoản hiện có không bị ghi đè mật khẩu. Nếu đã đổi mật khẩu admin demo, dùng quy trình chạy thủ công trong README; launcher dùng thông tin demo ban đầu để seed catalogue.

## Kiểm chứng trước playtest

```powershell
dotnet test src/BE/Tests/SirLocked.Tests.csproj --no-restore
# Khi demo local đang chạy, dùng Mongo27020 nhưng DB test tự tạo có tên sirlocked_it_<guid>.
./scripts/test-v3-full-stack.ps1 -MongoConnectionString 'mongodb://127.0.0.1:27020/?serverSelectionTimeoutMS=3000' -ApiPort 5315 -FrontendPort 5273
```

Script full-stack tạo rồi xóa chỉ DB test riêng, không dùng `SirLockedLocalDemo`. Nó kiểm tra auth/HTTP/Mongo/SignalR và hai trình duyệt thật. Trên máy mới cần cài Chromium của Playwright bằng `npx playwright install chromium` trong `src/FE`.

Chạy toàn bộ vụ án point-and-click bằng click thật trên canvas và điều khiển UI:

```powershell
./scripts/test-v3-full-stack.ps1 -PointClick -MongoConnectionString 'mongodb://127.0.0.1:27020/?serverSelectionTimeoutMS=3000' -ApiPort 5326 -FrontendPort 5286
# Bản tiếng Việt, giữ nguyên bố cục/ảnh đã tác giả hóa:
./scripts/test-v3-full-stack.ps1 -PointClick -CaseJsonPath './src/BE/SeedData/V3/case-point-click-night-ledger-vi.json' -MongoConnectionString 'mongodb://127.0.0.1:27020/?serverSelectionTimeoutMS=3000' -ApiPort 5326 -FrontendPort 5286
```

Lượt này chỉ dùng API để đăng nhập/tạo phòng và đọc trạng thái kiểm chứng; thu đồ, ghép đồ, dùng chìa khóa, nhập mã, hỏi nhân chứng, chuyển cảnh, đối chất, suy luận và cáo buộc đều đi qua canvas/UI sản phẩm. Seeder giữ nguyên bố cục/asset của case, ghi provenance và chỉ đổi ID DB, timestamp, trạng thái publish trong DB test. Có thể dùng `-UseAuthoredLayout -CaseJsonPath ...` với bộ full-stack V3 cũ cho các case đã có layout. Các đáp án lấy từ fixture để kiểm tra khả năng hoàn thành, không đo độ khó suy luận hoặc trải nghiệm người mới.

Để kiểm tra JSON case vừa tạo trước khi làm ảnh, thêm `-CaseJsonPath 'đường-dẫn-case.json'` vào lệnh trên. Seeder giữ nguyên file nguồn, tạo bản sao dưới `tmp/crack-full-stack-*/playable-case.json`, thêm layout mock chuẩn của backend và ảnh có sẵn trong dự án. File `playable-case.provenance.json` ghi SHA256 nguồn và phép biến đổi; không gọi AI hay tạo ảnh. Sau khi qua cả validation logic và validation publish, hai trình duyệt thu chứng cứ bằng API thật, đối chất, suy luận rồi cùng xác nhận cáo buộc. Đây là kiểm tra khả năng hoàn thành bằng đáp án của case, không thay thế đánh giá chất lượng suy luận hoặc bố cục ảnh.

Bộ test cũng đóng kết nối thật, xác nhận hạn reconnect khoảng 5 phút, kết nối lại trong hạn, rồi kiểm tra worker tự kết thúc phòng khi quá hạn. Để không chờ 5 phút mỗi lần, helper chỉ lùi timestamp của người đã offline trong DB `sirlocked_it_*` trên loopback; không thêm endpoint thử nghiệm vào API sản phẩm. API và frontend test dùng cổng riêng; mặc định là `5226` và `5186`.

Trong `src/FE`, chạy `npm run typecheck`, `npm run test:realtime`, `npm run test:guide`, `npm run test:navigation`, `npm run test:assets`, `npm run test:ui` và `npm run build:demo`. Mỗi lượt browser test ghi artifact vào thư mục riêng dưới `test-results/` để các lượt không xóa trace của nhau.

Browser suite tự mở Vite và từ chối dùng cổng đang bị chiếm. Nếu dự án chính đang chạy ở `5173` (demo dùng `5174`), chọn cổng test riêng trước khi chạy:

```powershell
$env:SIRLOCKED_PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:5279'
npm run test:ui
Remove-Item Env:SIRLOCKED_PLAYWRIGHT_BASE_URL
```

## Bản đóng gói demo

```powershell
cd src/FE
npm run build:demo
```

`dist/case-assets.json` liệt kê bốn case (cặp Crack và cặp Night Ledger) cùng checksum/dung lượng asset, gồm cả âm thanh. Chỉ dùng gói này với backend phục vụ các case có trong manifest; danh mục backend không tự bị lọc. Nếu phát hành thêm case, dùng `npm run build:cases -- --case <case1.json> --case <case2.json>` để chọn đủ nội dung. Script không đưa JSON có đáp án vào public.

## Phần cần người thật và dịch vụ ngoài

- Chạy ba cặp theo `docs/playtest/V3_PLAYTEST_PROTOCOL_VI.md`; không thay số liệu quan sát bằng kết quả test tự động.
- Nếu bật telemetry, cấu hình rõ `GameplayV3__PlaytestInstrumentationEnabled` và pseudonym key; launcher mặc định tắt telemetry.
- AI thật cần quota, ngân sách và bảng giá/reservation đã kiểm chứng theo `docs/CINEMATIC_PRESENTATION_VI.md`. API key riêng chưa đủ. Launcher này luôn giữ chế độ mock.
- SMTP, Google login, Cloudinary và xAI cần kiểm chứng riêng trên môi trường triển khai. Đợt demo local không xác nhận các dịch vụ đó.

## Kết quả kiểm chứng ngày 27/09/2026

- Backend: 690/690 unit tests và 50/50 integration tests đạt; integration dùng MongoDB loopback và DB disposable. 12 schema probes gọi provider trả phí được loại khỏi lượt chạy, không tính vào số đạt.
- Frontend: typecheck đạt; 11 realtime, 3 role-guide và 3 asset tests đạt.
- Chromium: 71/71 UI tests đạt, gồm gia hạn phiên nhiều tab, lỗi mạng kéo dài, điều hướng chậm, lời mời, tiếp tục ván và hướng dẫn theo vai.
- Full-stack: 3/3 lượt V3 với hai browser contexts, HTTP/Auth/SignalR/Mongo thật đi đến kết quả cuối. Lượt đầu khi source đang thay đổi bị timeout; lượt xác nhận sau khi source ổn định đạt cả ba trận.
- Build demo đạt: 2 case, 35 asset, 16.054.659 byte asset; toàn bộ `dist` khoảng 17,7 MiB. Ba asset shell được Vite cảnh báo lúc compile đã được plugin chép vào output và kiểm tra tồn tại. Chunk gameplay/Phaser vẫn khoảng 1,8 MB trước gzip.
- Launcher đã được kiểm tra start → health → seed → stop → restart; catalogue giữ nguyên và backend tiếp tục báo Healthy.
- Workflow CI đã cập nhật thêm full-stack và artifact demo, nhưng chưa có run GitHub Actions mới trong lượt làm việc này.

Các kiểm thử tự động trên không thay thế playtest với ba cặp người mới.

## Bản point-and-click ngày 30/09/2026

- Vòng chơi mới đã được xác nhận bằng hai browser contexts thật trên cả case Anh và Việt: click canvas để đến gần và khám đồ/NPC, ghép biên nhận trong túi, dùng chìa vào tủ, nhập mã hộp tiền, hỏi nhân chứng, chuyển cảnh, đối chất đôi, suy luận và hai người đồng thuận cáo buộc → kết quả thắng. API chỉ dùng để chuẩn bị phòng và đọc kết quả kiểm chứng; không gọi endpoint thay cho các hành động chơi trong lượt này.
- Backend: 855/855 unit tests và 95/95 integration tests đạt, không skip. Unit gồm hai regression mới cho mục tiêu Anh/Việt; integration đạt trước chỉnh sửa câu chữ cuối. Integration dùng MongoDB loopback, database riêng `sirlocked_it_*`, fake provider và dọn DB sau test. Các probe OpenAI trả phí bị loại khỏi lượt này và không tính vào số đạt.
- Chromium UI suite: 128/128 đạt; gồm 7 trường hợp navigation bằng click, hủy yêu cầu chờ khi dùng bàn phím/mở panel/camera/đổi cảnh, kiểm tra focus và race audio. Ảnh desktop/mobile đã được xem; ảnh recovery được chụp lại sau khi nhả clock và đợi resize (1/1 kiểm tra tương ứng đạt).
- Typecheck, 11 realtime, 3 role-guide, 6 pure navigation và 4 asset packaging tests đạt. Build demo đạt: 4 case, 45 media files, 16.710.425 byte media; không đóng gói JSON có đáp án. Vite vẫn cảnh báo chunk Phaser/gameplay khoảng 1,83 MB trước gzip; ba asset shell được cảnh báo lúc compile đã được xác nhận tồn tại trong output.
- Các kết quả lịch sử mới chụp snapshot tên/ngữ nghĩa đáp án và ending tại thời điểm kết thúc. Overwrite case không làm đổi kết quả đó; guard ngăn overwrite nếu có lịch sử cũ chưa có snapshot. Không phục dựng dữ liệu lịch sử đã bị overwrite trước bản sửa.
- Lượt UI Việt cuối đạt sau khi Việt hóa mục tiêu/thông báo tiến độ và nhãn chứng cứ trong kết quả; đã kiểm tra các thông báo tiếng Anh quan sát được không còn xuất hiện. Demo được restart bằng launcher quản lý PID: frontend trả 200, API `Healthy`, đăng nhập player1 thành công, catalogue đủ bốn case và 9/9 audio URL của hai cảnh trả 200. Dữ liệu ván cũ được giữ nguyên.

Điều hướng và tương tác đang chờ chỉ tồn tại trên client; server giữ quyền quyết định vai, trạng thái và tiến độ. Hai case mới đã được kiểm tra đường tiếp cận mọi mục tiêu từ cả hai điểm spawn. Validator kiểm tra hình học nhưng chưa chứng minh toàn bộ khả năng tiếp cận cho mọi tổ hợp obstacle trong các case tác giả hóa sau này; các case đó cần chạy harness layout gốc và xem ảnh trước publish. Chưa có số liệu playtest người thật cho vụ án mới và không suy ra độ vui/độ khó từ việc tự động dùng đáp án fixture.
