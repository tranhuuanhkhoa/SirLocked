# Đánh giá và cải thiện game — 30/09/2026

> Đây là báo cáo của đợt đánh giá trước. Ba ưu tiên cuối báo cáo đã được xử lý trong đợt tiếp theo; xem [báo cáo hoàn tất](completion-2026-09-30/README.md) và JSON mới để biết trạng thái hiện tại.

Đã phối hợp ba nhánh đánh giá: chất lượng cốt truyện/chứng cứ, gameplay, giao diện tạo case. Phần tích hợp backend được kiểm tra riêng. Các sửa đổi đã chạy trên API local với database gốc; không commit, push, tạo ảnh hoặc publish case.

**Kết luận:** luồng sửa case an toàn hơn và bộ dựng gameplay đã sửa các lỗi cụ thể. Chưa đủ bằng chứng để gọi chất lượng sinh case AI là ổn định. Lượt thử thật cải thiện một phần nội dung nhưng candidate vẫn không đạt, nên JSON và checkpoint cũ được giữ nguyên.

## Các thay đổi đã thực hiện

| Nhóm | Vấn đề và kết quả |
| --- | --- |
| Workflow backend | Cho sửa truth cả khi đã có JSON gameplay đang chờ duyệt. Accept vô hiệu hóa dữ liệu phụ thuộc để tạo lại; Reject hoặc lỗi provider giữ bản đang có. Chặn thao tác xung đột và ghi đè từ phiên bản draft cũ. |
| Giao diện admin | Phân biệt cấu trúc hợp lệ với chất lượng cốt truyện. Hiện báo cáo riêng của candidate trước khi duyệt; chặn phản hồi đến muộn sau đổi draft/hủy/rời trang và giải thích lỗi xung đột. |
| Timeline/ngoại phạm | Dành trước slot cho core action, báo sớm khi không thể vừa giới hạn. Ngoại phạm chỉ loại nghi phạm khi thực sự ngăn được hành động phạm tội tại địa điểm khác. |
| Chất lượng nội dung | Yêu cầu nguồn quan sát được cho động cơ, phương thức phạm tội thực tế và thời gian; không dùng nhãn khác nhau để biến nguồn lặp thành độc lập. Đây là guardrail prompt/review, vẫn cần đánh giá nội dung. |
| Gameplay | Short Demo/Normal Random không bị ép thêm puzzle mã cố định và vật phẩm phụ chỉ để đủ số lượng. Case causal có puzzle REQUIRED phải hoàn thành trước cáo buộc. Các preset nhiều cơ chế giữ hợp đồng riêng. |
| Bảo toàn chứng cứ | Giữ mọi trace/lời khai hỗ trợ năm kết luận cuối. Nếu vượt giới hạn, báo lỗi có phạm vi sửa rõ ràng; không âm thầm bỏ nguồn phụ. Validator phát hiện plan đã lưu thiếu nguồn. |

Giao diện cáo buộc vẫn chọn một chứng cứ đại diện cho mỗi nhóm; những nguồn hỗ trợ khác vẫn được đưa vào gameplay để khám phá. Thay đổi lần này không thêm yêu cầu bắt buộc thu thập tất cả nguồn hay thay cấu trúc UI cáo buộc.

## Kiểm chứng

- **770/770 backend unit tests đạt**, tăng từ 739 trước đợt sửa. Gồm ngoại phạm, giới hạn timeline, puzzle gate, các preset và bảo toàn nguồn chứng cứ.
- **17/17 kiểm thử HTTP workflow trên MongoDB thử nghiệm riêng đạt**, gồm 13 ca mới: quyền truy cập, accept/reject, lỗi provider, tác vụ đang chạy và chống cập nhật từ phiên bản cũ. OpenAI được mock trong nhóm này.
- **35 kiểm thử UI khác nhau liên quan tạo case đạt**, trong đó 11 ca mới; TypeScript typecheck đạt. Các API trong kiểm thử UI được mock.
- API build thành công, **0 warning / 0 error**. API báo `Healthy`, frontend trả HTTP 200 sau khi cập nhật bản cuối.
- MongoDB thử nghiệm đã tắt; API và frontend của dự án tiếp tục chạy. Database gốc ping thành công. Không đổi `.env`, không đặt lại sổ ngân sách.

Lệnh unit: `dotnet test src/BE/Tests/SirLocked.Tests.csproj --artifacts-path tmp/create-case-tests --no-restore`.

Kết quả cục bộ: `tmp/team-improvement-20260930/test-results/backend-quality-final.trx` và `truth-repair-workflow-final.trx`. Các kết quả này kiểm tra đúng hành vi phần mềm; chưa thay thế lượt chơi đầy đủ với hai người thật.

## Lượt thử JSON trả phí

Giữ model hiện tại và sửa cùng case **Hạ Màn Tại Kho Hải Âu** từ TIMELINE. Thêm 5 lượt text, tốn **0,617225 USD**; tổng đợt thử hiện **1,656639 / 5 USD**, còn **3,343361 USD**. Reservation, lượt chưa đối soát và hàng đợi đều bằng 0. Chi phí theo sổ usage của ứng dụng.

Candidate đã giải thích động cơ và một số quan hệ vật lý tốt hơn, nhưng còn `ProofLinkMismatch`, thiếu chứng cứ cho hành động tráo chứng thư và nguồn động cơ chưa độc lập. Provider reviewer chưa chạy vì lỗi cấu trúc; không coi `NOT_RUN` là đạt. Không chấp nhận candidate. Bản gốc giữ trạng thái `FULL_LOGIC_AWAITING_APPROVAL` và nội dung không đổi.

Các guardrail prompt cuối được bổ sung sau lượt thử này và chưa gọi provider để kiểm tra lại. Không tăng model trong đợt này; một case chưa đủ để đánh giá lợi ích của việc tăng model.

[Xem candidate, ngân sách và đánh giá chi tiết](json-quality-trial-2026-09-30/README.md).

## Ưu tiên tiếp theo

1. **P1 — Chứng minh đủ phương thức gây án trước lượt thử tiếp.** Dùng candidate đã lưu làm ví dụ lỗi; lập bảng từng ý của `coreTruth.method` → sự kiện → dấu vết/lời khai → chứng cứ người chơi nhìn thấy. Sửa từ TIMELINE, dành slot cho tráo chứng thư/kết quả trộm và gộp nguồn ngoại phạm dư. Tiêu chí đạt: mọi ý bắt buộc của phương thức và động cơ có nguồn cụ thể, liên kết hai chiều đúng, qua projectability, không vượt giới hạn. Không chỉ xóa cạnh sai hoặc thu hẹp kết luận để được thông qua.
2. **P2 — Chơi thử hai vai với JSON đã qua đánh giá.** Kiểm tra khám phá đủ nguồn, trao đổi thông tin, đối chất và cáo buộc; xác nhận không có bước bắt buộc vô nghĩa hay vai nào chỉ đứng xem. Với preset Puzzle Heavy/Full Feature, kiểm tra riêng phần thưởng của puzzle vì các cơ chế mẫu vẫn cần biên soạn nội dung tốt hơn.
3. **P2 — Giảm phí sửa lại bằng checkpoint của candidate.** Hiện repair luôn bắt đầu từ checkpoint đang được giữ, không từ candidate lỗi. Nếu bổ sung khả năng sửa tiếp candidate, phải xác thực/hash toàn bộ phần upstream và chỉ tái sử dụng phần đã đạt; bảo toàn checkpoint cũ, dùng kiểm tra phiên bản khi accept/reject, không tự lặp gọi AI. Cần regression cho candidate cũ, sai upstream, hủy và lỗi provider trước khi dùng trả phí.

[Hướng dẫn vận hành và cấu hình JSON 5 USD](../docs/AI_CASE_SETUP_VI.md). Ứng dụng local: <http://127.0.0.1:5173/>.
