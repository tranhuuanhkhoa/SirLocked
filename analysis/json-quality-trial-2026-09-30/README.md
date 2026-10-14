# Thử sửa chất lượng JSON — 30/09/2026

Đã thử sửa từ TIMELINE của vụ **Hạ Màn Tại Kho Hải Âu**, giữ seed/core và ngân sách tổng 5 USD. Bản sửa bị chặn ở `CANDIDATE_INVALID`; không chấp nhận, không tạo lại gameplay, không tạo ảnh, import hoặc publish. Case/checkpoint gốc giữ nguyên và đang ở `FULL_LOGIC_AWAITING_APPROVAL`.

| Kết quả | Giá trị |
| --- | --- |
| Chi phí trước lượt này | 1,039414 USD |
| Chi phí thêm — 5 lượt text | 0,617225 USD |
| Tổng đã ghi nhận | 1,656639 USD / 5 USD |
| Ngân sách còn lại | 3,343361 USD |
| Reservation / lượt chưa đối soát | 0 / 0 |
| Hàng đợi sau thử | 0 |
| Model | Giữ nguyên `gpt-5.6-sol` |
| Database gốc / API / frontend | Ping thành công / Healthy / HTTP 200 |

Chi phí lấy từ usage và bảng giá cấu hình trong ứng dụng, không phải hóa đơn nhà cung cấp. Không đổi hạn mức hay xóa sổ kế toán.

## Nội dung tốt hơn và lỗi còn lại

Candidate đã có tài liệu nối quyền thừa kế của Edwin với chứng thư, giải thích nguồn sáp và hành động kích hoạt phông sập, sửa khoảng cơ hội của người có ngoại phạm, và giảm suy diễn phút chính xác từ timestamp nội bộ.

Tuy vậy, chưa đủ để người chơi suy luận toàn bộ lời giải:

1. **Phương thức trộm thiếu chứng cứ:** METHOD chỉ chứng minh việc chuẩn bị phông sập. Chưa có nguồn chứng minh tráo chứng thư bằng giấy trắng và dùng bảo vật làm mục tiêu giả. Nên phân bổ lại các slot chứng cứ từ timeline; hiện ba trong sáu trace được dành cho các hồ sơ ngoại phạm riêng lẻ.
2. **Một liên kết hai chiều sai:** graph dùng trace vé của Mabel cho OPPORTUNITY, còn trace chỉ khai TIMELINE. Đây là lỗi cấu trúc khiến reviewer provider chưa chạy (`NOT_RUN`). Chỉ sửa cạnh này không khắc phục thiếu chứng cứ phương thức.
3. **Độ độc lập của nguồn động cơ yếu:** tài liệu Edwin ký và lời Edwin nhắc lại tài liệu không trở thành hai nguồn độc lập chỉ nhờ nhãn metadata khác nhau.

Nhóm đánh giá cũng phát hiện bộ dựng gameplay có thể bỏ nguồn của kết luận gồm nhiều ý sau khi đã chọn một chứng cứ đại diện cho mỗi loại. Lỗi ứng dụng này được xử lý riêng trong đợt cải thiện: bảo toàn các nguồn đã liên kết với kết luận và báo vượt giới hạn khi không thể giữ đủ; không sửa dữ kiện của candidate để làm cho nó vượt kiểm tra.

Guardrail prompt bổ sung sau lượt thử yêu cầu chứng cứ cho phương thức phạm tội thực tế và không đếm nguồn lặp lại là độc lập. **Các prompt bổ sung cuối chưa được thử lại bằng provider**, vì đã dừng chi phí. Một case không đủ để kết luận độ ổn định hay so sánh model.

## Tệp kết quả

- [Candidate truth](candidate-truth.json): bản sửa lỗi để tái hiện và đánh giá; không phải JSON gameplay dùng để import.
- [Kết quả và ngân sách](result.json).
- [Usage tổng hợp](usage-summary.json).
- [Đánh giá thủ công của nhóm](review.json).
- [Case gốc ngày 28/09](../json-only-trial-2026-09-28/README.md).
- [Hướng dẫn sửa checkpoint](../../docs/AI_CASE_SETUP_VI.md).

Repair hiện bắt đầu từ checkpoint đang có, không tiếp tục từ candidate lỗi. Vì vậy không gọi repair PROOF_GRAPH với kỳ vọng giữ các cải thiện mới trong candidate. Lần thử trả phí tiếp theo cần sửa từ TIMELINE với kế hoạch chứng cứ cho hành động trộm, rồi đọc lại cả bản sửa trước khi duyệt. Ngân sách còn lại không đồng nghĩa đã cam kết gọi tiếp.
