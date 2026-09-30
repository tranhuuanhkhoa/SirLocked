# Hoàn tất sửa và kiểm tra game — 30/09/2026

Đã xử lý ba ưu tiên của đợt đánh giá trước: sửa nội dung vụ án đang thử, tiếp tục sửa từ candidate thay vì sinh lại toàn bộ, và chơi thử hai vai từ đầu đến cuối. API local đã nạp bản cuối; database gốc ping thành công, API `Healthy`, frontend HTTP 200. Không thay kết nối `.env`, không commit/push, không tạo ảnh hoặc publish case.

## Kết quả vụ án thật

**Hạ Màn Tại Kho Hải Âu**, draft `6aba793fa941714af5247263`, đang ở `FULL_LOGIC_AWAITING_APPROVAL` với [JSON gameplay mới](case.json).

- Cấu trúc truth và JSON: **0 lỗi**.
- [Đánh giá cốt truyện](truth-review.json): **PASSED**, confidence 0,93; timeline khả thi, nhân quả vật lý khả thi, một lời giải; không còn findings.
- [Đánh giá đối chất V3](v3-review.json): **PASSED**.
- Blind-solvability reviewer riêng của ứng dụng: **NOT_RUN**, đang tắt trong cấu hình. Không tính trạng thái này là đạt.
- Hai browser đi hết JSON mới bằng HTTP/Auth/SignalR/Mongo thật: **CASE CLOSED**, score 100, teamwork 15/15, cả năm nhóm cáo buộc đúng. [Ảnh kết thúc](playtest-case-closed.png).
- Nội dung có 2 stage, 3 scene, 4 nhân vật, 6 chứng cứ nguồn và 1 clue mở sau đối chất, 7 dialogue, 1 đối chất, 1 deduction, 1 teamwork chain. Short Demo không bị thêm puzzle phụ để đủ số lượng.

JSON gốc không bị sửa để vượt test. Bộ test tạo bản sao với `ApplyDeterministicMockSceneLayout` của backend và art có sẵn để kiểm tra gameplay trước khi làm ảnh. SHA256 nguồn là `569C9FD034575B75549907B7700729CF8F8D8CB1B4BEA6C76440F14C3AA37F71`, giữ nguyên trước/sau test. [Thông tin bản sao dùng để chơi thử](playtest-provenance.json). DB test riêng đã xóa; Mongo và API/FE test đã dừng.

## Những thay đổi chính

| Phần | Kết quả |
| --- | --- |
| Sửa tiếp candidate | Thêm `useRepairCandidate` và khuyến nghị riêng. Chỉ tái sử dụng upstream đã kiểm tra, gắn hash với checkpoint gốc, dùng snapshot và phiên bản workflow để chặn cập nhật cũ. Lỗi provider giữ candidate trước đó. |
| Kiểm tra theo công đoạn | Statement mới không còn bị đối chiếu với proof graph cũ. Xóa dữ liệu phụ thuộc trong bản sao khi tạo lại, lưu lỗi đúng công đoạn thay vì hàng chục lỗi dây chuyền. Prefix chưa có evidence dùng tham chiếu dự kiến để kiểm tra liên kết, không coi chúng là bằng chứng đã được tạo. |
| Các trường hợp biên | Khuyến nghị sửa bản gốc được tính từ bản gốc, không lấy nhầm từ candidate. Thiếu JSON checkpoint gốc sẽ chặn continuation, tránh tự tạo lại từ story. |
| Giao diện admin | Có thao tác sửa tiếp bản lỗi, phạm vi và nội dung hướng dẫn riêng, báo cáo cấu trúc/cốt truyện riêng. Chặn phản hồi đến muộn sau đổi draft, hủy hoặc rời trang. |
| Cốt truyện và chứng cứ | Bổ sung nguồn độc lập cho động cơ, kết quả tráo chứng thư và giấu bảo vật; giữ quan hệ nguồn phụ thuộc đúng. Lời khai Clara hiện xác nhận cả Hector và Mabel, đủ phạm vi ngoại phạm. TIMELINE dùng thứ tự lớp sáp và khoảng thời gian có bản ghi, không dùng phút gây án bí mật như bằng chứng. |
| Prompt | Proof graph nhận danh sách liên kết ngược chính xác từ ledger. Thêm yêu cầu kiểm tra nguồn ngoại phạm cho từng người riêng, không lấy hai nhóm nguồn chỉ nói về người khác để chứng minh cho họ. |
| Puzzle Heavy/Full Feature | Thay mã `314` và đáp án mẫu bằng bài đối chiếu điều đã chứng minh/giới hạn của chứng cứ đã khám phá. Ba puzzle mở ba chứng cứ thật; ghép phiếu → hồ sơ → bàn đối chiếu → chứng cứ cho puzzle cuối. Compiler giữ hướng dẫn và validator khóa đáp án, điều kiện, phần thưởng, vai trò REQUIRED. |
| Chống lộ nội dung | Puzzle chưa đủ điều kiện không trả prompt/options. Luồng cơ chế có thứ tự mở khóa, không thể bỏ bước ghép/dùng vật phẩm bằng thao tác inspect. |
| Ngân sách | Request text cố định Standard trước kiểm tra byte và giữ chỗ, kể cả payload override. Không làm thay đổi object của caller. Giữ nguyên hạn mức tổng và mỗi draft 5 USD. |

Chức năng cáo buộc vẫn chọn một chứng cứ đại diện cho mỗi nhóm. Tất cả nguồn hỗ trợ đã được giữ trong gameplay, nhưng không thêm luật buộc thu đủ mọi nguồn phụ. Puzzle mặc định mới là đối chiếu hồ sơ có đáp án kiểm chứng, chưa phải câu đố vật lý được biên soạn riêng cho từng câu chuyện.

## Kiểm chứng phần mềm

| Nhóm | Kết quả |
| --- | --- |
| Backend unit toàn bộ sau bản cuối | **821/821** |
| HTTP workflow trên MongoDB test riêng | **26/26** |
| UI tạo/sửa case và đối chất | **47/47** |
| Full-stack fixture V3 chuẩn | **4/4** |
| Full-stack FullFeature mới | **2/2** |
| Full-stack chính JSON live mới | **2/2** |
| TypeScript / FE production build | Đạt |
| API build | Đạt, 0 warning / 0 error |

Full-stack chuẩn có thử đáp án đối chất sai rồi đúng, thay lựa chọn làm mất xác nhận cũ, tải lại trang và hai người cùng cáo buộc. FullFeature hoàn thành cả ba puzzle REQUIRED, có đi lại cảnh bằng API thật.

Kiểm tra mất kết nối thực hiện disconnect thật, thấy hạn gần 300 giây, reconnect trước hạn để hủy đếm; sau lần disconnect tiếp theo, chỉ lùi timestamp trong DB test để worker xử lý quá hạn. Worker đóng phòng và lần reconnect muộn không thể khôi phục. Đây là kiểm thử logic mốc 5 phút có tăng tốc thời gian, không tuyên bố đã ngồi chờ đủ 5 phút. [Ảnh phòng hết hạn](playtest-room-ended.png).

TRX workflow: `tmp/team-improvement-20260930/test-results/truth-repair-workflow-final.trx`. TRX unit trước tám ca Standard-tier cuối: `tmp/team-improvement-20260930/test-results/completion-unit-final.trx` (813/813); bộ cuối 821/821 đã chạy thành công sau tám ca mới. FE artifacts nằm trong các thư mục riêng dưới `src/FE/test-results/`.

FE build vẫn cảnh báo chunk gameplay/Phaser khoảng 1,8 MB trước gzip; đó là giới hạn hiện có, không phải lỗi build mới. Chưa chạy CI từ xa hoặc triển khai production trong đợt này.

## Chi phí và các lần sửa

[Sổ usage](usage.json) ghi **3,156430 / 5 USD**, còn **1,843570 USD**; tổng 30 call text, không có call ảnh/vision/video. Riêng đợt hoàn tất này thêm 13 call và **1,499791 USD** so với mốc 1,656639 USD của báo cáo trước. Reservation, call chưa đối soát và hàng đợi đều bằng 0. Toàn bộ 30 raw response xác nhận `service_tier=default`, `status=completed`; [bảng kiểm tra tier](provider-tier-audit.json) không chứa nội dung hoặc khóa API.

Lượt tạo lại ban đầu bị lỗi phần mềm kiểm tra graph cũ trước khi sinh graph mới; lỗi đã được sửa và có regression. Sau đó reviewer phát hiện thiếu lời quan sát Clara → Hector. Bản truth hợp lệ về cấu trúc được giữ làm checkpoint trung gian, vẫn mang reviewer FAILED và chưa tạo gameplay. Lượt sửa evidence/statements kế tiếp thiếu liên kết Mabel → TIMELINE; tiếp tục từ STATEMENTS đã sửa đủ. Chỉ khi reviewer PASSED mới chấp nhận bản cuối và dựng gameplay. Không tạo draft khác hay xóa sổ ngân sách.

Cấu hình local cuối dùng reservation text 1,50 USD thay cho 2 USD, sau khi pin Standard và kiểm tra trần payload 100.000 byte / output 28.000 token. Theo giá Standard/cache-write hiện dùng, ước lượng bảo thủ là 1,06 USD, còn 0,44 USD dự phòng; đây không phải trần hóa đơn do provider cam kết. Mẫu cấu hình trong repo vẫn giữ 2 USD. [Giá Sol chính thức đã đối chiếu ngày 30/09](https://developers.openai.com/api/docs/models/gpt-5.6-sol). Tổng ngân sách không tăng và các reservation cũ không bị sửa.

## Trạng thái sử dụng

Mở ứng dụng local tại <http://127.0.0.1:5173/> và vào AI Creator để xem draft đang chờ duyệt gameplay. Bản JSON này chưa được đưa vào catalogue của database gốc; bước ảnh/layout cuối và publish được để lại theo yêu cầu thử JSON trước. Chơi thử ở trên dùng bản sao trong database cô lập.

Kết quả chứng minh các luồng đã kiểm tra chạy được và vụ án này đã vượt các gate nêu trên. Một vụ án cùng kiểm thử tự động chưa đủ kết luận mọi nội dung sinh ra đều ổn định hoặc game đã sẵn sàng production. Playtest với người mới và đánh giá ảnh sẽ cần thực hiện khi chuyển sang giai đoạn đó.

[Hướng dẫn tạo case và vận hành](../../docs/AI_CASE_SETUP_VI.md) · [Hướng dẫn full-stack](../../docs/LOCAL_DEMO_VI.md) · [Số liệu cuối](summary.json)
