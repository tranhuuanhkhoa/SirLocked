# Cánh én bên ga Hàng Đường

Màn Dễ ba cảnh được tạo từ web local bằng Codex MCP và PixelLab. `case.json` chứa nội dung gốc tiếng Việt, bản dịch tiếng Anh và lời giải dùng cho kiểm thử. ID vụ án là `case-ai-6b09d6cf457e2d0b4223954b`.

- Ảnh nền, nhân vật và lớp tiền cảnh nằm ở `src/FE/public/assets/pixel/canh-en-ben-ga-hang-duong/`.
- Kịch bản mở đầu song ngữ nằm ở `src/BE/SeedData/Cutscenes/case-ai-6b09d6cf457e2d0b4223954b.intro.json`.

Để chơi thử trên stack local, import `case.json` bằng `POST /api/admin/cases/import-json` với `preserveServerMetadata: true` rồi xuất bản trong danh mục local. Khi API local khởi động với vụ án đã có trong danh mục, bộ nạp intro sẽ đọc tệp trên. Mở một phòng mới để xem intro và dùng nút EN/VI để kiểm tra bản dịch.
