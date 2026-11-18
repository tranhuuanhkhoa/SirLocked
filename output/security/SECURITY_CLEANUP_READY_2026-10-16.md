# SirLocked - bản dọn bảo mật chờ duyệt cập nhật GitHub

## Trạng thái

Đã hoàn tất chuẩn bị và kiểm tra trên bản clone riêng. Chưa push, chưa thay lịch sử `main` trên GitHub và chưa đổi visibility.

| Mục | Giá trị |
| --- | --- |
| Repo đích | `duongtuankiet-se/SirLocked` |
| Main hiện tại trên GitHub | `5f8feebcf40e6c3e5e19294bffc56b1d0786327a` |
| Main đã chuẩn bị | `d905bf2c318ae7696a54617f432e83eeb63ba229` |
| Bản clone đã dọn | `E:\Sirlocked\tmp\security-remediation\clean-repo` |
| Commit mới | `security: prevent credential commits and add secret scanning` |

## Những gì đã thực hiện

1. Tạo và kiểm tra Git bundle sao lưu toàn bộ ref local tại `E:\Sirlocked\tmp\security-remediation\backup-before-cleanup.bundle`. Bundle chứa lịch sử cũ, bao gồm các JWT đã hết hạn; giữ riêng, không tải lên repository, issue hoặc artifact công khai.
2. Clone riêng branch hiện tại và dùng git-filter-repo 2.47.0 để loại 7 file session JSON khỏi toàn bộ lịch sử của branch chuẩn bị xuất bản:
   - `tmp/inv.json`
   - `tmp/room.json`
   - `tmp/room2.json`
   - `tmp/room3.json`
   - `tmp/room4.json`
   - `tmp/room5.json`
   - `tmp/roomv.json`
3. Giữ 113 commit lịch sử; kiểm tra danh tính tác giả, committer và thời điểm của từng commit không đổi. Các commit sau điểm dọn có hash mới. Script trong tmp vẫn được giữ.
4. Bổ sung `.gitignore` cho các biến thể env, cấu hình môi trường riêng, credential files, private key/certificate, backup bundle và output local; giữ ngoại lệ cho env/appsettings example/template.
5. Thêm `.gitleaks.toml` kế thừa rules mặc định. Ngoại lệ chỉ dành cho ba chuỗi mẫu/test chính xác và một trường hash batchKey trong report đã xác minh; không bỏ quét toàn bộ thư mục test hoặc tmp.
6. Thêm workflow secret scanning chạy trên push, pull request và chạy tay. Workflow lấy toàn bộ lịch sử, dùng quyền contents:read, checkout không lưu credential, pin SHA của checkout action, pin Gitleaks 8.30.1 và SHA256 của binary.
7. Thêm helper PowerShell, hook pre-commit tùy chọn và SECURITY.md. Hook có executable bit và thuộc tính LF để dùng với Git for Windows.
8. Tạo commit bảo vệ mới và bundle lịch sử sạch `E:\Sirlocked\tmp\security-remediation\prepared-clean-main.bundle`.

## Thay đổi source

Ngoài 7 JSON bị loại, chỉ sửa `.gitignore` và thêm:

- `.gitattributes`
- `.githooks/pre-commit`
- `.github/workflows/secret-scan.yml`
- `.gitleaks.toml`
- `SECURITY.md`
- `scripts/scan-secrets.ps1`

Đối chiếu SHA của tất cả file Git còn lại: giữ nguyên. Không thay đổi logic gameplay, tài khoản, AI, dependency hoặc cấu hình chạy database trong đợt này. Thư mục gốc `E:\Sirlocked` vẫn giữ phiên bản/lịch sử ban đầu để có thể đối chiếu và phục hồi.

## Kết quả xác minh

| Kiểm tra | Kết quả |
| --- | --- |
| Bundle backup và bundle sạch | git bundle verify thành công |
| Tác giả/committer/timestamp của 113 commit lịch sử | Được giữ nguyên |
| Quét độc lập 1.874 text blob của lịch sử đã lọc trước commit bảo vệ | 0 JWT; không còn 7 đường dẫn session JSON |
| Gitleaks toàn bộ lịch sử sau commit cuối | 104 commit có diff được công cụ tính, khoảng 16,03 MB; 0 phát hiện |
| Gitleaks thư mục làm việc | Khoảng 11,89 MB; 0 phát hiện |
| Helper PowerShell quét staged changes | Thành công, 0 phát hiện |
| Fixture provider token giả lập chỉ tạo trong bộ nhớ | Bị chặn đúng, exit 1 |
| Fixture JWT hết hạn giả lập | Bị chặn đúng, exit 1 |
| Chuỗi test sentinel và placeholder đã duyệt | Được phép đúng |
| Sentinel cùng dòng với token giả lập khác | Token khác vẫn bị chặn |
| Workflow actionlint 1.7.12 | Thành công; shellcheck/pyflakes không được chạy trong lượt này |
| Cú pháp PowerShell và shell hook | Thành công |
| git diff --cached --check | Thành công |
| Trạng thái bản chuẩn bị | Sạch |
| Kiểm tra lại remote | main vẫn trỏ 5f8feeb, chỉ có một branch main |

Không cần chạy lại bộ test gameplay cho đợt chỉ thay đổi kiểm soát Git/CI này vì mã ứng dụng được đối chiếu giữ nguyên. Workflow chưa thực thi trên GitHub vì chưa push; đã được kiểm tra local bằng actionlint và chạy scanner thực tế.

## Bước cần duyệt

Sau khi chủ repo đồng ý, cập nhật duy nhất `main` trên GitHub bằng lịch sử đã làm sạch, với lease ràng buộc main phải vẫn ở commit đã kiểm tra:

```powershell
git -C E:/Sirlocked/tmp/security-remediation/clean-repo push --force-with-lease=refs/heads/main:5f8feebcf40e6c3e5e19294bffc56b1d0786327a origin main:main
```

Không dùng push --mirror hoặc force không có lease. Nếu remote đã thay đổi, dừng và đối chiếu thay vì ghi đè. Sau push cần kiểm tra hash remote, kết quả workflow và chuẩn bị lại checkout làm việc để tránh đưa lịch sử cũ trở lại GitHub. Bản clone cũ của cộng tác viên cũng cần được đồng bộ theo lịch sử mới; backup cũ không được push.

Đổi Public là bước riêng sau khi kiểm tra kết quả trên GitHub. Nếu các object cũ còn được truy cập qua cache/PR/ref khác, làm theo hướng dẫn GitHub để xử lý dữ liệu nhạy cảm; rewrite main không đảm bảo xóa mọi bản sao trước đó.

## Những việc vận hành còn lại

- Các advisory npm/ImageSharp trong báo cáo audit trước vẫn cần xử lý và kiểm tra tương thích trước deploy; không được coi là đã vá bởi commit này.
- Lưu token trong localStorage, OAuth callback, access-token logout và MongoDB binding chưa được sửa trong đợt dọn Git/secret scanning.
- Chưa kiểm tra secrets trên provider/deploy/GitHub settings và chưa OCR toàn bộ ảnh/tài liệu binary. Không có bằng chứng key AI thật bị lộ trong phạm vi quét trước đó, nhưng không thể bảo đảm phát hiện mọi loại secret.
- Hook local là opt-in: sau khi sử dụng checkout sạch và có Gitleaks trong PATH, chạy `git config --local core.hooksPath .githooks`. CI sẽ tự chạy khi workflow đã được push.

Tham khảo công cụ: https://github.com/newren/git-filter-repo và https://github.com/gitleaks/gitleaks. Hướng dẫn xử lý dữ liệu nhạy cảm: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository.
