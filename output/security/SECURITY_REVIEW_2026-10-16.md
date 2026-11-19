# SirLocked - rà soát trước khi chuyển repository Public

Ngày: 16/10/2026, múi giờ Asia/Saigon. Commit kiểm tra: `5f8feebcf40e6c3e5e19294bffc56b1d0786327a`.

## Kết luận

Nên giữ Private trong lúc dọn các bản ghi token đã commit. Không phát hiện API key thật của OpenAI/xAI, GitHub PAT, Google API key, private key hoặc URI database chứa mật khẩu bằng các phép quét đã chạy. Tuy nhiên, xác nhận có 12 JWT khác nhau trong các JSON tạm vẫn được Git theo dõi; tất cả có trường `exp` đã qua hạn vào ngày 13/06/2026. Chưa có bằng chứng các JWT này còn dùng được. Các file phòng còn chứa email và ID tài khoản demo.

Đây là kiểm tra mã nguồn, lịch sử Git và dependency, không phải chứng nhận an toàn tuyệt đối hoặc pentest ứng dụng đang triển khai.

## Phạm vi và bằng chứng

- Remote `origin`: repo `duongtuankiet-se/SirLocked`; đọc `git ls-remote --heads origin` cho thấy nhánh `main` trỏ đúng commit đã kiểm tra.
- HEAD có 910 file được Git theo dõi và 113 commit tổ tiên. Tổng các ref local có 114 commit.
- Gitleaks 8.30.1 tải từ repository chính thức, đã đối chiếu SHA256. Quét `git --log-opts=--all --redact=100`: 104 commit có nội dung được công cụ tính, khoảng 16,04 MB diff; 21 cảnh báo.
- Quét bổ sung 1.882 text blob trong 3.742 object có tên lấy từ toàn bộ ref local, khoảng 34,07 MB. Tìm mẫu provider key, JWT, private key, URI có credentials và trường cấu hình nhạy cảm. Không in giá trị token.
- Quét thư mục làm việc bằng Gitleaks: khoảng 11,86 MB; 8 cảnh báo. Lượt này loại Git internals, công cụ audit, dependency folders và tmp; các file tmp được theo dõi đã được kiểm tra riêng qua Git blob và giải mã metadata JWT.
- 8 cảnh báo trong source thông thường được phân loại là placeholder cấu hình, chuỗi sentinel trong test và hash `batchKey`; chưa xác nhận chúng là credential thật.
- Đối chiếu npm audit từ lockfile và NuGet audit gồm dependency gián tiếp sau restore.
- Rà các phần chính: auth, lưu token frontend, middleware, quyền truy cập room/draft/media, cấu hình startup, image upload, Docker và CI.

Không dùng token phát hiện được để gọi provider, đăng nhập hoặc truy cập dữ liệu; không chạy app/AI generation. Không sửa source, commit, push, đổi visibility hay rewrite lịch sử. Kết quả audit ở `output/`; công cụ và dữ liệu kỹ thuật đã redact ở `tmp/security/`.

## 1. Dữ liệu xác thực vẫn còn được theo dõi

Các file: `tmp/inv.json`, `tmp/room.json`, `tmp/room2.json`, `tmp/room3.json`, `tmp/room4.json`, `tmp/room5.json`, `tmp/roomv.json`.

- Có 13 lần xuất hiện JWT, tương ứng 12 giá trị khác nhau. Gitleaks cũng tìm ra chúng trong commit `7114a80`.
- Các JWT đều có claim thời hạn và đã hết hạn ngày 13/06/2026; không phải API key OpenAI/xAI.
- Các bản ghi phòng chứa token và email/ID người dùng. Dù dữ liệu phục vụ demo, không nên công khai các bản ghi phiên đăng nhập.
- `tmp/` có trong `.gitignore`, nhưng ignore không bỏ theo dõi file đã commit.

Khuyến nghị: bỏ các artifact phiên chơi khỏi cây Git hiện tại, đồng thời cân nhắc loại chúng khỏi toàn bộ lịch sử trước khi Public. Chỉ xóa file và commit mới sẽ không xóa dữ liệu ở commit cũ. Có thể giữ script demo bằng cách chuyển script hữu ích ra `tmp/` và không kèm session JSON.

Nếu có credential thật phát hiện sau này, thu hồi/đổi credential trước; làm sạch lịch sử không thể thu hồi bản sao người khác đã tải. Không kết luận key AI cần rotate chỉ dựa trên các JWT hết hạn này.

## 2. Kết quả riêng cho API key, secret và cấu hình

| Nhóm | Kết quả |
| --- | --- |
| OpenAI / xAI API key | Chưa tìm thấy giá trị credential thật bằng các phép quét. Key trong cấu hình mặc định để trống; xAI mặc định để trống trong settings. |
| Cloudinary | ApiKey/ApiSecret trong appsettings hiện tại để trống. Không phát hiện URL Cloudinary có user/password. Public asset URL hoặc cloud name không tương đương API secret. |
| Google OAuth / SMTP | Settings mặc định để trống credential. Không tìm thấy key/token thật theo mẫu quét. |
| MongoDB | Các connection string cấu hình đã kiểm tra dùng loopback và không kèm credentials. |
| JWT signing secret | Cấu hình hiện tại để trống; lịch sử có giá trị mẫu hardcode. Không dùng bất kỳ secret mẫu/lịch sử nào cho production. |
| GitHub PAT / private keys | Không phát hiện theo mẫu quét. Username trong remote URL không phải token. |

Không thể xác minh từ checkout này: GitHub Actions secrets/variables, credential lưu trong Windows Credential Manager, secrets trong hệ thống deploy, database thật hoặc dashboard provider. Không có `.env` thật trong thư mục gốc ở thời điểm kiểm tra. Không có thao tác gọi provider để kiểm tra key có hoạt động hay không.

## 3. Quy tắc ignore chưa bao phủ hết file nhạy cảm

`.gitignore` hiện chặn `.env`, `.env.local`, `.env.*.local` và hai appsettings Development/Production. Kiểm tra cho thấy `.env.production`, `appsettings.Staging.json`, file PEM/key không được quy tắc hiện tại chặn.

Khuyến nghị: mở rộng ignore cho biến thể env, cấu hình riêng theo môi trường và private-key/certificate; giữ ngoại lệ rõ ràng cho file example/template. Không coi ignore là công cụ phát hiện secret; cần scanner trước commit/CI. Không tự ignore mọi certificate công khai nếu dự án cần dùng chúng.

## 4. Dependency có advisory

### Frontend

`npm audit --package-lock-only --ignore-scripts --json` báo 3 package có mức tổng hợp High, không có Critical:

| Package | Bản trong lockfile | Nhóm rủi ro theo advisory |
| --- | --- | --- |
| nanoid | 3.3.12 | Vòng lặp vô hạn trong một số generator với tham số size không hợp lệ. |
| postcss | 8.5.15 | Source-map auto-loading có cảnh báo path traversal/file disclosure; có thêm advisory Moderate liên quan bản sửa chưa đầy đủ. |
| source-map-js | 1.2.1 | Từ chối dịch vụ khi xử lý indexed source map được tạo độc hại. |

Đây là dependency của tooling/build. Chưa chứng minh một người chơi qua UI có thể kích hoạt những advisory này. Cần cập nhật dependency/lockfile tương thích, chạy lại audit, typecheck và build; không chỉ đổi số version bằng tay.

### Backend

NuGet audit báo `SixLabors.ImageSharp` 3.1.11 có 5 advisory: 3 High, 2 Moderate. Cùng package xuất hiện qua API và các project test nên không tính là 15 lỗi riêng.

Các High đã đối chiếu nói đến HistogramEqualization với floating-point TIFF và TIFF CCITT T4/T6 encoding. Chưa thấy code hiện tại gọi các API HistogramEqualization/TIFF encoder đó; vì vậy chưa kết luận ứng dụng có lỗ hổng khai thác được tương ứng. Dù vậy package vẫn cần nâng lên bản vá phù hợp và kiểm tra các đường xử lý ảnh. Một số advisory liệt kê 4.1.2 là bản vá, nên không mặc định một bản 3.1.x bất kỳ sẽ giải quyết tất cả; nâng major cần kiểm tra tương thích.

Theo chính sách Microsoft, .NET 9 kết thúc hỗ trợ ngày 10/11/2026. Cần lên kế hoạch chuyển runtime được hỗ trợ và dùng bản vá hiện hành trước khi vận hành dài hạn.

## 5. Điểm cần gia cố trước khi deploy Internet

### Lưu token trong trình duyệt

`src/FE/Client/js/services/session.js:8-12` lưu access token và refresh token vào localStorage. Script cùng origin đọc được chúng; nếu có XSS, token có thể bị lấy. Đây là rủi ro thiết kế, chưa phải bằng chứng đang có XSS.

Khuyến nghị: cân nhắc refresh token trong cookie HttpOnly/Secure/SameSite phù hợp, access token ngắn hạn trong bộ nhớ; thiết kế thêm chống CSRF nếu chuyển sang cookie. Giảm bề mặt XSS và áp dụng CSP ở môi trường deploy.

### Token trong URL callback Google

`src/BE/WebAPI/FrontendRedirects.cs:18-19` đưa access/refresh token vào URL fragment `#/oauth-callback?...`. Fragment không được gửi như query string HTTP tới server, vì vậy không kết luận token tự động nằm trong access log của server. Tuy nhiên JavaScript trên trang và các bên có quyền đọc URL trình duyệt có thể nhìn thấy nó. Frontend thay hash sau khi xử lý nhưng chưa có bước xóa bằng replaceState ngay trước xử lý.

Khuyến nghị: trả mã dùng một lần để frontend đổi token, hoặc dùng luồng cookie/BFF; tránh đưa refresh token vào URL. Tối thiểu xóa fragment bằng history.replaceState ngay sau khi đọc và trước khi chạy thao tác bất đồng bộ.

### Logout chưa thu hồi access token ngay

`AuthService.LogoutAsync` xóa refresh token nhưng không tăng AuthorizationVersion. Access JWT đã sao chép có thể còn hiệu lực đến lúc hết hạn; mặc định JwtSettings đặt 12 giờ. Cơ chế đổi mật khẩu/khóa/đổi role đã tăng AuthorizationVersion, nên có cơ sở để bổ sung logout theo cùng chính sách. Cần xác định logout một phiên hay tất cả phiên và đặt thời hạn access token ngắn hơn.

### Mật khẩu demo và môi trường

Source có tài khoản/mật khẩu demo cố ý công khai. Production hiện không tự seed admin nếu không bật cấu hình; nếu bật seed ngoài Development thì buộc cung cấp mật khẩu. Đây là guard tốt, nhưng không bảo vệ máy deploy nếu chạy nhầm Development hoặc dùng lại mật khẩu demo.

Khuyến nghị: deploy Production, tắt seed demo, thay/xóa tài khoản demo trên database thật, dùng secret store/biến môi trường. PasswordPolicy hiện chỉ yêu cầu từ 6 ký tự có chữ và số; cần nâng chính sách phù hợp trước khi cho đăng ký công khai.

### MongoDB Docker

`docker-compose.yml:7` publish `27017:27017`, không cấu hình auth trong compose. Nếu Docker host và firewall cho truy cập, database có thể truy cập qua interface mạng của host.

Demo local nên bind `127.0.0.1:27017:27017`. Production cần user/password, network riêng, firewall/TLS theo mô hình deploy; không mở MongoDB trực tiếp ra Internet. Chuyển repo Public tự nó không khởi chạy hoặc mở database.

### HTTPS và bảo vệ tại hạ tầng

Chưa thấy UseHttpsRedirection/UseHsts trong Program.cs; không thể kết luận thiếu HTTPS vì reverse proxy có thể đảm nhiệm. Cần xác minh HTTPS, security headers, domain CORS cụ thể và cấu hình trusted proxy thực tế tại nơi deploy.

## 6. Các cơ chế bảo vệ đã thấy trong code

- Password dùng BCrypt; refresh/reset/verification token được hash; refresh rotation có filter kiểm tra snapshot.
- JWT xác minh chữ ký, issuer, audience và lifetime; secret tối thiểu 32 ký tự được kiểm tra khi startup.
- Middleware chặn user bị khóa/xóa và kiểm tra AuthorizationVersion.
- API admin có role gate; AI draft kiểm tra ownership; gameplay loader kiểm tra thành viên room.
- Media presentation kiểm tra quyền, không trả trực tiếp URL storage bí mật; có giới hạn host download và không tự follow redirect trong client cấu hình.
- Upload ảnh chứng cứ giới hạn kích thước byte và pixel, sau đó normalize; đây không thay thế việc vá dependency decoder.
- Rate limiting cho login/register/email; CORS cấu hình origin cụ thể; Swagger bị gate ngoài Development.
- AI có quota, reservation và budget gate; key provider nằm ở backend theo các đường code đã rà.
- CI có permissions contents:read và test/build. Workflow hiện chưa có job quét secret riêng.

## 7. Trình tự xử lý đề xuất

1. Giữ repo Private; loại session JSON nhạy cảm khỏi cây source và lập kế hoạch làm sạch lịch sử. Việc rewrite/force-push phải được thống nhất vì đổi commit ID và ảnh hưởng clone khác.
2. Nếu phát hiện secret thật hoặc đang dùng lại secret mẫu: rotate tại provider/deploy trước, rồi mới làm sạch Git. Đừng gửi token thật vào chat để đối chiếu.
3. Mở rộng ignore và thêm secret scanner trong pre-commit/CI, chạy lại trên lịch sử đã làm sạch.
4. Kiểm tra dữ liệu cá nhân trong tài liệu, ảnh chụp và log; Git commit author cũng công khai khi Public. Chưa OCR toàn bộ ảnh/video hoặc dữ liệu binary.
5. Cập nhật dependency được cảnh báo và xác minh build/test. Các mục localStorage, OAuth callback, logout, Mongo binding và deployment cần xử lý trước khi đưa ứng dụng thật lên Internet; chúng không tự làm lộ API key chỉ vì source được Public.
6. Khi source/lịch sử sẵn sàng, bật Secret scanning, Push protection và Dependabot trong phạm vi GitHub hỗ trợ; review GitHub Actions secrets, workflow artifacts và environment riêng.
7. Chỉ chuyển Public sau khi chấp nhận kết quả quét và biết rõ những dữ liệu nào sẽ được công khai. Không thể bảo đảm mọi loại secret được phát hiện bằng regex/static scan.

## Tham khảo

- https://github.com/gitleaks/gitleaks
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository
- https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository
- https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html
- https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core
- https://github.com/advisories/GHSA-j3p4-wp97-rph4
- https://github.com/advisories/GHSA-j9gm-c75j-xc9q
- https://github.com/advisories/GHSA-jjfr-hcj7-qf5w
- https://github.com/advisories/GHSA-r28c-9q8g-f849

Không có giá trị API key, JWT hoặc signing secret được chép vào báo cáo này.
