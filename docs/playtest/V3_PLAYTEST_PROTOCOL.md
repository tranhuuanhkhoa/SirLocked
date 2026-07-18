# V3 Crack the Lie — Human Playtest Protocol

## Phạm vi

Protocol này chỉ đo vertical slice V3 8–12 phút. Automation đã kiểm tra contract, privacy projection và flow kỹ thuật; các nhận định về fun, tension, surprise, memorable moment hoặc ý định chơi tiếp đều là **Requires human playtest validation**.

Gate 1 dùng ba cặp người chơi mới trên cùng Build A. Không sửa code, case, copy, hint hoặc fixture giữa ba session. Với nhóm người chơi nói tiếng Việt, dùng `case-v3-broken-seal-vi` cho cả ba session để không trộn biến ngôn ngữ. Bản EN chỉ dùng cho cohort tiếng Anh riêng.

## Chuẩn bị

- Chỉ chạy `appsettings.V3Local.json` với Mongo trên `127.0.0.1:27018` và database `sirlocked_v3_local`.
- Dùng đúng hai tài khoản audit `.invalid`; không thu email thật, OAuth, API key hoặc dữ liệu production.
- Ghi runtime commit, locale và checksum fixture vào đầu biểu mẫu.
- Mở hai máy hoặc hai browser context độc lập. Gán role trước khi giải thích luật; đổi phía ngồi giữa các session nếu có thể.
- Người điều phối có đồng hồ và form 30 giây; không nhìn notebook thay người chơi và không gợi ý pair.

## Script đọc nguyên văn

> Hai bạn có thông tin riêng. Investigator tìm chứng cứ vật lý; Interrogator hỏi nhân chứng để lấy mảnh lời khai. Hãy nói chuyện như bình thường. Khi muốn kiểm tra một mâu thuẫn, Interrogator bắt đầu Joint Review, Investigator ghép chứng cứ, rồi cả hai xác nhận cùng revision. Bạn có thể sửa hoặc hủy mà không bị phạt. Mục tiêu là giải thích chính xác lời khai bị phá như thế nào.

Không nói trước evidence đúng, fragment đúng, số lần thử dự kiến hoặc nội dung reveal.

## Trình tự session

1. Bắt đầu ghi ở giây 0 khi cả hai nhìn thấy scene.
2. Mỗi 30 giây ghi action hiện tại của từng role, trạng thái giao tiếp và waiting; không diễn giải cảm xúc thay người chơi.
3. Chỉ can thiệp khi có lỗi kỹ thuật hoặc cả hai không có action hợp lệ trong 60 giây. Ghi `facilitator_intervention=1` và lý do dạng category.
4. Dừng khi reveal xuất hiện hoặc phút 15. Không cho chơi lại trong cùng session.
5. Ngay sau đó, hỏi riêng từng người:
   - “Mâu thuẫn chính xác là gì?”
   - “Thông tin nào của bạn đã giúp đội?”
   - “Bạn đóng góp bao nhiêu, từ 1 đến 5?”
6. Chỉ sau hai câu factual mới hỏi tự do về chán, bất ngờ, tension, khoảnh khắc đáng nhớ và muốn chơi tiếp. Đây là dữ liệu human validation, không trộn với automated result.

## Coding rules

- `private_detail_spoken=1` chỉ khi một người diễn đạt một chi tiết chỉ role đó sở hữu trước disclosure đầu tiên; không cần trích nguyên văn.
- `actionable=0` khi UI không cung cấp action có thể tiến loop và người đó chỉ chờ partner.
- Một waiting episode bắt đầu khi `actionable` chuyển 1→0 và kết thúc khi trở lại 1; cộng duration theo timestamp, không ước lượng cuối session.
- `contradiction_correct=1` khi người chơi nêu đủ: lời khai nói seal nguyên vẹn + wax cho thấy đã mở và niêm phong lại.
- `unassisted_soft_lock=1` khi cả hai không thể tiến trong 60 giây mà không có can thiệp, reload do bug hoặc chỉ dẫn ngoài game.
- Không ghi tên thật, email, nội dung chat ngoài playtest hoặc bất kỳ PII nào trong notes/export.

## Gate 1 — ba cặp

- **KILL** nếu ít nhất 2/3 cặp hoàn thành mà không trao đổi private detail, hoặc ít nhất 2/3 cặp không giải thích được contradiction.
- **ITERATE** nếu loop tạo giao tiếp nhưng cue, waiting hoặc payoff là bottleneck. Chỉ sửa bottleneck có bằng chứng lớn nhất.
- Không tuyên bố PASS tổng thể sau ba cặp; Gate 1 chỉ quyết định Kill/Iterate và chuẩn bị Gate 2.

## Gate 2 — năm cặp mới

PASS khi toàn bộ cohort tối thiểu tám cặp đạt tất cả:

- ≥75% cặp nói ít nhất một private detail trước Joint Review.
- ≥75% người chơi giải thích đúng contradiction.
- Median contribution của từng role ≥3/5.
- Không có unassisted soft-lock.
- ≥75% cặp hoàn thành trong 15 phút.
- Waiting >45 giây xuất hiện ở ≤25% cặp.

Nếu borderline, chạy thêm tối đa bốn cặp mới; tổng không vượt 12. Chỉ Human Gate PASS mới mở migration case, AI generator V3 hoặc production hardening.
