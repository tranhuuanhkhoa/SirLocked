# Trang mười bảy

Vụ án tiếng Việt cho hai người chơi, khoảng 12 phút, lấy bối cảnh phố Hàng Đường năm 1912. Ngay trước giờ đối sổ, một trang trong sổ thu tiền của hiệu đóng sách biến mất. Hai thám tử kiểm tra quầy, mái hiên ga và phòng đóng gáy để xác định người có mặt trong khoảng thời gian trang sổ biến mất.

Case có ba nhân vật, bốn vật chứng chụp ảnh, một lượt đối chất V3, một câu đố ghép biên nhận tùy chọn và ba mức gợi ý cho mỗi cảnh và lần đối chất. Bản nháp dùng lại ảnh nền và sprite của case Hàng Đường để chạy trên bộ tài nguyên hiện có.

## Kiểm định và mở bản nháp

Chạy lệnh sau từ thư mục gốc của repo.

```powershell
dotnet run --project tools/ValidateCase -- --new ai-game-docs/generated-cases/trang-muoi-bay/case.json
```

Trong trang **Vụ án → Nhập JSON** của admin, dán nội dung `case.json` và nhấn **Nhập dưới dạng bản nháp**. Case Studio dùng ID `case-trang-muoi-bay`. Tệp JSON chứa lời giải để phục vụ việc nhập và kiểm định.

## Kịch bản chơi thử với hai người

1. Mở phòng thử trong Case Studio. Kiểm tra cả hai người đi được từ quầy hiệu đóng sách qua mái hiên ga tới phòng đóng gáy và quay lại.
2. Chụp ba vật chứng ở quầy và phiếu 18:12 ở mái hiên. Kiểm tra phiếu ghi hai chữ ký và hai nửa dấu đỏ hiện đúng trên mép sổ và trang giấy gập.
3. Hỏi Vinh ở quầy, Trạch ở mái hiên và Miên trong phòng đóng gáy. Kiểm tra lời Miên đặt vụ mất trang trong khoảng 18:10–18:16.
4. Trong lượt đối chất, ghép lời phủ nhận của Vinh với giấy hẹn đối sổ trước. Lượt này phải giữ nguyên lời khai. Ghép lại với phiếu 18:12 để mở lời thừa nhận vào quầy.
5. Kiểm tra câu đố ghép giấy có thể bỏ qua và nhóm vẫn đủ ba vật chứng để buộc tội. Trong lượt thử riêng, giải câu đố để xác nhận biên nhận về ca trực của Trạch xuất hiện trong sổ.
6. Gửi lời buộc tội với giấy hẹn đối sổ cho động cơ, trang 17 trong bìa da cho cách thực hiện và phiếu 18:12 cho cơ hội. Kiểm tra kết thúc chỉ xuất hiện sau khi cả hai người xác nhận cùng đề xuất.
