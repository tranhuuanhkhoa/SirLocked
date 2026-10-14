# SirLocked — chạy ba cặp playtest từ xa

Bộ này thực hiện phần chuẩn bị và thu bằng chứng của giai đoạn A. Không có dữ liệu người chơi thật được tạo sẵn. Tạo AI trả phí, checkout và kết luận thương mại vẫn **NOT RUN** cho tới khi các cổng tương ứng được kiểm chứng.

## Bản đang chạy ngày 04/10/2026

Batch: `tmp/playtest/commercial-r3-authored-20261004`. Link hiện tại: https://heat-steel-mediterranean-heights.trycloudflare.com. Mật khẩu truy cập và sáu tài khoản mới nằm trong `private/player-invitations.txt` của batch này. Link là tạm; đọc `processes.json` sau mỗi lần khởi động lại để lấy URL mới. Giữ máy đang chạy và không để máy ngủ trong buổi thử. Các bản trước đã dừng; thư mục và dữ liệu cũ được giữ lại.

Catalogue hiện có hai Broken Seal cùng **Đêm khóa sổ** (`case-reference-dem-khoa-so-vi`) và **Hồ sơ chuyến tàu số 7** (`case-full-chuyen-tau-so-7-vi`). Đăng nhập rồi chọn case ở màn hình tạo phòng. Case mới được nạp từ JSON tác giả vào database thử riêng; không import vào database chính.

Code cập nhật đã qua build API/seeder Release, frontend production và TypeScript. Rehearsal HTTPS bằng hai trình duyệt đạt 11 kiểm tra: catalogue khớp bốn case đã chọn, kiểm tra quyền/SignalR/reconnect và hai vai vào cảnh đầu của mỗi case mới. Tất cả đường dẫn media trực tiếp của hai case mới trả HTTP 200. Rehearsal này không chơi hết case mới; bằng chứng chơi hết trước đó nằm trong thư mục nội dung tương ứng. Kết quả kỹ thuật ở `logs/preflight.json`; **không phải playtest người thật**. Các room ID trong log này là room kỹ thuật, không tính vào mẫu người chơi. Bundle SHA256: `57832722fecd4831a63117d5996f9136c8d65c9823fe02c7eee53b66ff9ef675`.

Với bản hiện tại, thay `tmp/playtest/commercial-r1` trong các lệnh dưới bằng `tmp/playtest/commercial-r3-authored-20261004`. Không chạy `prepare` lại cho batch này. Khi cần khởi động lại, dùng binary đã xác minh `.tools/cloudflared-2026.9.3.exe`.

## Bản build và tài khoản riêng

Chạy từ repository chứa `SirLocked.sln`, với .NET 9, Node và Python:

```powershell
python scripts/playtest-kit.py prepare --batch commercial-r1
python scripts/playtest-kit.py verify --run tmp/playtest/commercial-r1
python scripts/playtest-kit.py start --run tmp/playtest/commercial-r1 --tunnel --cloudflared .tools/cloudflared-2026.9.3.exe
```

`prepare` đóng gói API Release, frontend production và seeder. Mặc định nó nạp hai Broken Seal; thêm `--case ai-game-docs/reference-case-dem-khoa-so/case.json --case ai-game-docs/full-case-chuyen-tau-so-7/case.json` để nạp cả hai case tác giả, kèm media. Nó ghi commit **và hash source thực tế**, kể cả thay đổi chưa commit; hash tất cả binary, frontend, gateway và case được kiểm tra trước mỗi lần chạy/thu/report. Backend publish được loại bỏ cấu hình local và dùng sentinel `.env` để không đọc secrets ở repository cha. Có thể tiếp tục sửa source sau khi đóng gói; người thử vẫn chơi binary đã chốt. Không sửa hoặc rebuild trực tiếp thư mục batch.

MongoDB portable được tìm trong `.tools`, hoặc truyền `--mongod <đường dẫn>`. Mongo chỉ nghe `127.0.0.1:27024`, database riêng `SirLockedPlaytest_commercial-r1`; API nghe `127.0.0.1:5236`; gateway nghe `127.0.0.1:5194`. Launcher từ chối cổng đang bận. Không đọc hoặc ghi database chính, không gọi provider AI, không seed tài khoản demo mặc định.

Link TryCloudflare xuất hiện ở output và trong `tmp/playtest/commercial-r1/processes.json`. File `private/player-invitations.txt` chứa mật khẩu truy cập và sáu tài khoản người chơi; **chỉ gửi từng người đúng tài khoản của họ**. Tài khoản facilitator nằm trong `private/credentials.json`, chỉ dùng local để xuất telemetry. Toàn bộ `tmp/` được git-ignore; không chép secrets vào docs, commit, ảnh hoặc bản ghi chia sẻ.

Gateway yêu cầu mật khẩu truy cập, cookie ký có thời hạn 12 giờ, chặn API admin/AI, đăng ký và Swagger ở đường public. Frontend được phục vụ từ bản build cố định; chỉ media/code được phục vụ, không có file JSON/secret/source map. API vẫn tự kiểm tra JWT, vai và thành viên phòng. Gateway hỗ trợ HTTP và WebSocket SignalR. Đây là bản thử tạm trên máy này; máy cần chạy trong suốt buổi. Restart tunnel có thể đổi URL, nhưng không đổi build hoặc dữ liệu.

## Chạy lần lượt A01 → A02 → A03

Giữ protocol trong `docs/playtest/V3_PLAYTEST_PROTOCOL_VI.md`. Mẫu A01/A02 vẫn gắn với Broken Seal tiếng Việt; A03 gắn với Broken Seal tiếng Anh. Không điền kết quả chơi case tác giả vào các mẫu này; thử case tác giả cần đợt và protocol riêng theo thời lượng case. Đợt tiếp theo tập trung người chơi tiếng Anh trước khi đánh giá nhu cầu quốc tế. Hai người dùng máy/màn hình riêng, trao đổi qua Discord/thoại, không chia sẻ màn hình. Người điều phối chỉ can thiệp theo protocol và ghi lại mọi lần can thiệp.

Mỗi cặp có thư mục `evidence/A01`, `A02` hoặc `A03` gồm:

- `observations.csv`: mẫu theo 30 giây. Các ô hành vi/counter đều để trống, không phải quan sát thực. Điền từ 0 đến cuối buổi; phần hàng trống còn lại được bỏ qua. Không điền 0 khi không quan sát được.
- `survey.csv`: hai dòng, một dòng mỗi vai. Điền `has_seen_answer`, `completed_case`, `wants_next_case` bằng 0/1; comprehension 1–5 theo rubric hiện có; `blocking_errors` là số lỗi chặn. Ghi ví dụ hợp tác, phản hồi chờ và lý do ở cột hậu tố `no_pii`.
- `telemetry.json`: xuất sau buổi qua CLI; không chứa raw room/user ID hoặc token.

Ghi mốc UTC bắt đầu/kết thúc **gameplay**, rồi xuất ngay sau từng buổi:

```powershell
python scripts/playtest-kit.py capture --run tmp/playtest/commercial-r1 --session A01 --from-utc '<UTC bắt đầu, ISO 8601>' --to-utc '<UTC kết thúc, ISO 8601>'
python scripts/playtest-kit.py report --run tmp/playtest/commercial-r1
```

Các cặp phải chạy **lần lượt**, không chạy đồng thời hoặc chơi rehearsal trong cửa sổ capture. Summary hiện tổng hợp theo cửa sổ thời gian; CLI từ chối cửa sổ có nhiều hơn một room, không có event hoặc bị truncated. Nó cũng từ chối ghi đè telemetry đã thu. Thu cả phỏng vấn trước khi tạo report. Trước khi chia sẻ dữ liệu, đọc lại toàn bộ ghi chú để loại tên/email/handle; không lưu bản ghi giọng nói hay hình người chơi vào repository.

`sandbox_checksum` trong CSV mới là hash **kết hợp các fixture đã chọn**; từng file có SHA256 riêng trong manifest. Các JSON có byte khác nhau nên không dùng hash riêng của một case như hash chung cả đợt. CSV lịch sử có hai dòng mẫu được giữ nguyên, không tính vào kết quả.

## Đọc kết quả

Report ở `evidence/gate-report.md` và JSON tương ứng. Dữ liệu trống là NOT RUN; thiếu/mismatch là INCOMPLETE; waiting imbalance `null` là không quan sát được, không tự quy thành 0. Số private sharing cần xuất hiện trong ít nhất hai khoảng quan sát mỗi cặp; điều này chốt trước buổi đầu để cụ thể hóa “xảy ra đều đặn”. Ngưỡng muốn chơi tiếp 70% tính trên sáu người, không bắt từng cặp đạt 100%.

Ba cặp chỉ cho phép dừng/sửa core loop hoặc chuẩn bị đợt tiếp theo; **không** cho phép kết luận Scale hoặc mở checkout. Khi cần sửa, giữ dữ liệu cũ, lập tối đa năm vấn đề gắn với quan sát, sửa rồi tạo batch mới. Giai đoạn B chỉ chạy sau khi có kết quả 8–12 cặp và quyết định tiếp tục được ghi nhận.

## Dừng bản thử

```powershell
python scripts/playtest-kit.py stop --run tmp/playtest/commercial-r1
```

Script chỉ dừng PID có thời điểm tạo khớp tiến trình đã ghi nhận, theo thứ tự tunnel → gateway → API → Mongo. Không xóa DB hoặc bằng chứng. Không dùng launcher demo local cũ làm server public.
