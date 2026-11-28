# Trang mười bảy

Vụ án tiếng Việt cho hai người chơi, khoảng 12 phút, lấy bối cảnh phố Hàng Đường năm 1912. Ngay trước giờ đối sổ, một trang trong sổ thu tiền của hiệu đóng sách biến mất. Hai thám tử kiểm tra quầy, mái hiên ga và phòng đóng gáy để xác định người có mặt trong khoảng thời gian trang sổ biến mất.

Case có ba nhân vật, bốn vật chứng chụp ảnh, một lượt đối chất V3, một câu đố ghép biên nhận tùy chọn và ba mức gợi ý cho mỗi cảnh và lần đối chất. Bản nháp dùng lại ảnh nền và sprite của case Hàng Đường để chạy trên bộ tài nguyên hiện có.

## Kiểm định và mở bản nháp

Chạy lệnh sau từ thư mục gốc của repo.

```powershell
dotnet run --project tools/ValidateCase -- --new ai-game-docs/generated-cases/trang-muoi-bay/case.json
```

Trong trang **Vụ án → Nhập JSON** của admin, dán nội dung `case.json` và nhấn **Nhập dưới dạng bản nháp**. Case Studio dùng ID `case-trang-muoi-bay`. Tệp JSON chứa lời giải để phục vụ việc nhập và kiểm định.
