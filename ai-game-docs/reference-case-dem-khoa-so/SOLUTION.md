# Hồ sơ tác giả — CÓ SPOILER

## Sự thật vụ án

Mai Vân muốn dùng quỹ cứu trợ trả nợ riêng. Cô mở phong bì đã niêm phong, thay người thụ hưởng trên lệnh chi và đóng lại bằng lớp sáp mới. Tiền **chưa được chuyển**: ngân hàng chỉ giải ngân sáng hôm sau. Điều tra diễn ra lúc 22:00 nhằm chặn lệnh sai trước khi thiệt hại xảy ra.

| Thời điểm | Sự kiện và nguồn xác lập |
| --- | --- |
| 20:50 | Khang giao Mai phong bì lệnh chi cho đơn vị cứu trợ; cả hai xác nhận việc bàn giao |
| 21:00 | Mai nói đã rời quầy rồi về; đây là lời khai cần kiểm chứng |
| 21:10 | Biên nhận ngân hàng của Khang; không suy ra ngoại phạm cho cả đêm từ một mốc đơn lẻ |
| 21:18 | Cuống giao nhận mang chữ ký Mai và chữ ký xác nhận ngay trên cuống của nhân viên nhận thư |
| 21:30 | Bản lưu lệnh chi ghi người thụ hưởng là chủ nợ riêng của Mai, có số khế ước và chữ ký Mai |
| 21:45 | Lâm bắt đầu tuần tra; không dùng ca trực này để phủ nhận việc nhân viên đi lại trước đó |
| 22:00 | Hai thám tử bắt đầu điều tra |
| Sáng hôm sau | Thời điểm dự kiến giải ngân; kết thúc thắng hủy lệnh trước thời điểm này |

Móc chìa còn nguyên chỉ bác được câu “móc đã bị bẻ gãy”. Nó không chứng minh mọi cửa đều an toàn hoặc không có người lạ. Chìa dùng chung không đủ quy trách nhiệm. Khoản nợ cũ đã tất toán của Khang không phải bằng chứng ông sửa lệnh tối nay.

## Đường giải đầy đủ

1. Điều tra viên kiểm tra hai mảnh 21/42, lấy chìa, kiểm tra sáp phong bì; có thể đọc phiếu cầm đồ để bác hướng nghi ngờ Khang.
2. Thẩm vấn viên hỏi Mai và Khang, thử cả hai nhánh hội thoại của Khang rồi quay lại gốc.
3. Điều tra viên dùng máy ảnh chụp móc đồng cạnh cửa sau khi lấy chìa. Tâm vùng ảnh ở tọa độ thế giới x=339, y=262.5 trên khung 1600×900.
4. Mở túi, ghép hai nửa biên nhận. Hai mảnh đầu vào biến mất; nhận biên nhận hoàn chỉnh với mã 2142.
5. Cả hai hoàn tất phòng vé để vào hồi II.
6. Dùng chìa lên ngăn thư dịch vụ, nhận cuống 21:18.
7. Mở hộp đối soát bằng 2142, nhận bản lệnh chi 21:30. Nhập sai mã chỉ báo sai, không cấp chứng cứ.
8. Thẩm vấn viên hỏi Lâm và lưu ba mảnh lời khai của ông.
9. Cả hai thực hiện hai cặp đối chất trong bảng dưới. Cặp sai có phản hồi và cho phép mở lượt đối chất mới.
10. Chọn suy luận mô tả Mai sửa người thụ hưởng, đồng thời loại bỏ giả thuyết giật chìa và việc kết tội từ khoản nợ cũ.
11. Mở cáo buộc: chọn Mai, động cơ trả nợ riêng, phương thức mở rồi niêm phong lại. Gắn ba chứng cứ đúng và cả hai xác nhận.

## Hai cặp đối chất duy nhất

| Câu khai | Vật chứng trực tiếp | Kết quả |
| --- | --- | --- |
| Mai: “Phong bì quỹ được niêm phong nguyên vẹn cả tối.” | `evidence-overlapping-wax-dks` | `reveal-resealed-packet-dks` |
| Lâm: “Móc chìa đã bị bẻ gãy.” | `evidence-intact-hook-dks` | `reveal-hook-rumour-dks` |

Các câu nhiễu trong cùng màn không bị vật chứng khác bác trực tiếp. Quy tắc này cần giữ vì mỗi màn đối chất hiện tại chỉ có một cặp đúng được lưu trong JSON.

## Cáo buộc cuối

| Trường | Giá trị |
| --- | --- |
| Culprit | `char-mai-dks` |
| Motive | `motive-private-debt-dks` |
| Method | `method-reseal-wax-dks` |
| MOTIVE evidence | `evidence-debt-transfer-dks` |
| METHOD evidence | `evidence-overlapping-wax-dks` |
| OPPORTUNITY evidence | `evidence-key-entry-dks` |
| Deduction | `deduction-night-ledger-dks` |

Tên một số ID giữ thuật ngữ từ fixture khởi đầu để dễ đối chiếu; nội dung hiển thị và case ID là riêng. Không dùng ID làm lời thoại cho người chơi.

## Điều kiện chống kẹt

- Hồi I chỉ yêu cầu đồ, câu hỏi và ảnh có thể lấy tại phòng vé.
- Mã hộp lấy từ thao tác ghép, không bị giấu trong chính hộp đó.
- Chìa nhặt được trước khi đến ngăn thư; thao tác mở không tiêu thụ chìa.
- Cả hai nhân chứng cần đối chất đều có mặt ở hành lang cuối.
- Reveal của mỗi đối chất chỉ được cấp bởi chính màn đối chất đó.
- Suy luận yêu cầu cả hai đối chất; bằng chứng trả nợ nằm sau mã hộp nên không thể bỏ qua puzzle để thắng.
- Hồi II chỉ hoàn tất khi đã có hai reveal. Test phải giải đối chất trước khi yêu cầu hoàn tất cảnh cuối.
- Ba chứng cứ gắn với ba luận điểm cuối là ba ID khác nhau.
