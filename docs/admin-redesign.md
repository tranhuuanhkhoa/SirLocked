# Giao diện admin "Hồ sơ giấy"

Tài liệu này dành cho người sửa giao diện các trang `/admin`. Nó ghi lại hệ thiết kế lấy từ bộ HTML của Yen (`sirlocked-admin-html`, tone B "Hồ sơ giấy"), bảng ánh xạ thiết kế với trang thật, và các quy ước khi làm trang mới.

Bộ HTML gốc nằm ngoài repo. Khi làm, chép vào `tmp/admin-html` (thư mục `tmp/` không commit). Ảnh chụp từng trang thiết kế ở 1440 và 390 px nằm trong `tmp/admin-redesign/design/`.

## 1. Kiến trúc

| Phần | File | Ghi chú |
|---|---|---|
| Khung (sidebar, thanh trên) | `src/FE/Client/js/components/admin/shell.js` | Router gọi `syncAdminArea(route)` rồi `syncAdminNav(...)` trên mọi route. `components/adminNav.js` chỉ còn re-export để code cũ không gãy. |
| Mảnh giao diện dùng chung | `src/FE/Client/js/components/admin/ui.js` | `pageHead`, `kpiCard`, `tile`, `card`, `pill`, `rarityPill`, `person`, `segTabs`, `stateBox`, `pager`, `todayEyebrow` |
| Icon | `src/FE/Client/js/components/admin/icons.js` | `icon(name, size)`, nét mảnh của thiết kế |
| Theme | `src/FE/css/60-admin-theme.css` | Token, khung, nút, ô nhập, thẻ, nhãn, tab, bảng, phân trang, trạng thái, hộp thoại |
| CSS từng khu | `49-admin-shell.css` (phần chung còn lại), `50-admin-chests.css`, `51-admin-cosmetics.css`, `52-admin-players.css`, `53-admin-cases.css` | Chỉ giữ thứ riêng của khu đó |

**Phạm vi.** Router đặt `body[data-area="admin"]` trên route `admin: true` và `aiAccess: true`. Mọi quy tắc trong `60-admin-theme.css` đều nằm dưới thuộc tính đó, nên trang người chơi không đổi. Admin có thêm lớp `body.adm-has-side` (lưới 2 cột: sidebar 248 px, nội dung). Người chỉ có quyền AI (VIP) vào `/admin/ai` thấy trang theo giao diện mới nhưng vẫn dùng thanh điều hướng người chơi, không có sidebar.

**Token cũ được gán lại.** Trong vùng admin, `--gold-light`, `--beige`, `--beige-muted`, `--panel`, `--line`, `--well`, `--btn-fill`... trỏ sang màu giấy. Vì vậy CSS cũ của các khu (viết bằng token) tự đổi màu. Muốn màu của thiết kế thì dùng token `--adm-*`.

**Không có hiệu ứng kính lúp** khi chuyển trang trong vùng admin (`main.js`, điều kiện `lens`).

## 2. Hệ thiết kế

### Màu

| Token | Giá trị | Dùng cho |
|---|---|---|
| `--adm-paper` | `#f4efe6` | nền trang |
| `--adm-paper-2` | `#f8f4ec` | thanh trên, nền ô tìm trong thẻ |
| `--adm-card` | `#fffdf9` | thẻ, nút phụ, ô nhập |
| `--adm-tile` | `#f6f1e8` | ô số nhỏ, đầu bảng, dòng việc |
| `--adm-seg` | `#ebe3d5` | khay tab |
| `--adm-line` | `#e6dccb` | viền thẻ |
| `--adm-input-line` / `--adm-btn-line` | `#ded2be` / `#d6c8af` | viền ô nhập / nút phụ |
| `--adm-navy` | `#10203a` | sidebar, nút chính, tiêu đề |
| `--adm-ink` | `#1d2738` | chữ thường |
| `--adm-muted` | `#6a6153` | chữ phụ |
| `--adm-gold` | `#b78a2c` | vòng focus, gạch chân tab |
| `--adm-gold-bright` | `#e2bd66` | logo, avatar admin, nút "Tạo vụ án mới" trên nền navy |
| `--adm-gold-text` | `#8a6516` | liên kết |
| `--adm-ok` / `--adm-ok-bg` | `#23685f` / `#def0ec` | Hoạt động, Đã duyệt, Đang bán |
| `--adm-bad` / `--adm-bad-bg` | `#9a4426` / `#f9e4dc` | Khóa, Gỡ, Xóa, lỗi |
| `--adm-warn` / `--adm-warn-bg` | `#7a5a12` / `#f5e9c8` | Admin, số xu |
| `--adm-violet` / `--adm-violet-bg` | `#4f3c8c` / `#ebe4fa` | VIP |

Độ hiếm (nền / chữ): Thường `#efe9df / #4d4538`, Hiếm `#e0ebf8 / #245a92`, Quý `#ece5fa / #53409a`, Huyền thoại `#f8ead0 / #8a5a0c`, Bí ẩn `#f8e1e1 / #9b2f3a`. Dùng `rarityPill(rarity)` hoặc lớp `adm-pill adm-rarity adm-rarity--EPIC`.

### Chữ

- Be Vietnam Pro (400–700) cho mọi chữ thường, 15 px, dòng 1.5.
- Playfair Display 700 cho tiêu đề: h1 38 px (30 px trên điện thoại), tiêu đề thẻ 21 px, số lớn 44 px.
- Source Code Pro cho mã (`case-pixel-...`, `chest_np`), dòng ngày phía trên tiêu đề (12 px, giãn chữ .14em, chữ hoa).
- Nhãn mục chữ hoa nhỏ ("HÔM NAY"): 13 px, 600, giãn .08em, màu `--adm-eyebrow`.

### Khoảng cách, bo góc, đổ bóng

- Nội dung: lề 32 px trên, 40 px hai bên (16 px trên điện thoại), rộng tối đa 1240 px. Khoảng giữa các khối 32 px, giữa thẻ trong lưới 16 px.
- Bo góc: thẻ 18 px, ô số 14 px, nút và ô nhập 12 px, nút nhỏ 10 px, nhãn 999 px, hộp thoại 20 px.
- Đổ bóng thẻ: `0 1px 2px rgba(29,39,56,.05), 0 8px 24px rgba(29,39,56,.04)`; khi rê chuột thẻ liên kết đổi viền `#cdb27a`.
- Nút, ô nhập, mục menu cao tối thiểu 44 px; nút nhỏ 38 px.

### Component

| Component | Lớp / hàm | Ghi chú |
|---|---|---|
| Đầu trang | `pageHead({ eyebrow, title, sub, actionsHtml, backHref, backLabel })` | `backHref` vẽ "← Tất cả vụ án" phía trên |
| Thẻ | `adm-card`, `adm-card--flush`, `adm-card-head`, `adm-card-title`, `adm-card-sub` hoặc `card({...})` | `--flush` để bảng chạm mép |
| Thẻ số lớn | `kpiCard({ label, value, href, linkLabel, iconName, tone, dark })` | `dark` cho thẻ navy (Xu đang lưu hành ở trang Kinh tế) |
| Ô số nhỏ | `tile({ label, value, of, note, meter, gold })`, lưới `adm-grid adm-grid--tiles` | `.stat-card` cũ cũng được vẽ như ô số |
| Nút | `btn` + `btn-primary` (navy), `btn-ghost` (viền), `btn-sm`, `adm-btn-danger` (đỏ đất), `adm-btn-ok` (xanh), `adm-btn-accent` (vàng) | `.ac-btn-danger`, `.acf-btn-danger`, `.adp-btn-danger` được vẽ như `adm-btn-danger` |
| Nhãn | `pill(text, tone, { dot })`, `adm-pill--ok/bad/gold/violet/navy/line` | `chip`, `chip-ok`, `chip-bad`, `chip-gold` cũ cũng theo |
| Nút lọc tròn | `adm-filters` > `button.adm-filter[aria-pressed]` | "Tất cả 7 · Admin 2" |
| Tab khay | `segTabs(items, label)` hoặc `nav.adm-seg` > `a/button` với `is-active` / `aria-current` / `aria-selected` / `aria-pressed` | Mục con của một trang (Hòm · Vật phẩm · Nhật ký mở hòm · Cấp hòm & chìa) |
| Tab gạch chân | `div.adm-tabs[role=tablist]` > `button[aria-selected]` | Nội dung trong một thẻ (Cutscene · Cấu trúc · JSON, Kho đồ · Lịch sử trận) |
| Bảng | `adm-table-wrap` > `table.adm-table` (hoặc `.admin-table` cũ) | Đầu bảng chữ hoa 12 px trên nền `--adm-tile`; bảng rộng cuộn ngang trong khung riêng |
| Người trong bảng | `person(name, sub)` | avatar chữ cái đầu |
| Phân trang | `pager({ page, pageSize, total, noun, perPageHtml })`, nút `[data-adm-page]` | "Hiển thị 1–10 / 42 ..." |
| Trống / đang tải / lỗi | `stateBox('empty' | 'loading' | 'error', title, note)` | `.empty-state` cũ cũng theo |
| Thông báo | `.notice`, `.notice-ok`, `.notice-bad` | |
| Hộp thoại | `<dialog>` gắn vào `body`; các hộp thoại sẵn có (`openDialog`/`confirmDialog` khu hòm, `askReason` khu mỹ phẩm, `actionDialog` khu người chơi) giữ nguyên logic và ô lý do | nền mờ `rgba(16,32,58,.45)`, bo 20 px |
| Toast | `utils/toast.js` như cũ | nền navy, xanh khi thành công, đỏ đất khi lỗi |

### Điện thoại (≤ 900 px)

Sidebar thu thành thanh trên cùng: logo và nút Menu ghi tên trang hiện tại. Bấm Menu mở lưới 2 cột các mục, Esc để đóng. Thanh tìm xuống dòng dưới. Bảng cuộn ngang trong khung riêng, trang không bao giờ tràn ngang.

### Tìm nhanh trên thanh trên

Gõ chữ rồi chọn nơi tìm: Người chơi (`/admin/players?q=`), Vật phẩm (`/admin/items?q=`), Vụ án (`/admin/cases?q=`). Enter đi tới mục đầu. Các trang đó tự đọc `q` từ địa chỉ.

## 3. Quy ước khi làm một trang

1. **Giữ nguyên logic:** mọi lời gọi API, kiểm tra quyền, hộp xác nhận và trường `reason`, ghi nhật ký, xử lý lỗi, `routeLifecycle` (hủy timer và listener qua `signal`). Chỉ đổi markup và CSS.
2. **Không có số giả.** Dữ liệu trong thiết kế chỉ là mẫu. Thứ thiết kế có mà API chưa có thì ghi vào mục 5, không bịa.
3. **Không sửa cách vẽ** của mỹ phẩm (`cosmetics/`) và màn quay hòm. Chỉ đặt chúng vào khung mới.
4. Giữ tiếng Việt; chỗ đang dùng `tr(...)` thì giữ song ngữ.
5. Ô nhập có nhãn (`<label>` hoặc `aria-label`), focus nhìn thấy được, tương phản đủ.
6. Không chép nguyên file HTML thiết kế (React và script nội tuyến) vào app.
7. Giữ các `id`, `data-*` và lớp mà test hoặc code khác đang dùng. Selector trong test đổi theo giao diện thì sửa selector, giữ nguyên điều được kiểm tra.
8. Chạy được ở 390 px.

## 4. Bảng ánh xạ thiết kế ↔ trang thật

(a) có thiết kế và có trang · (b) có trang, không có thiết kế, dựng bằng hệ thiết kế này · (c) có thiết kế, chưa có chức năng

| Thiết kế | Trang thật | Loại | Ghi chú |
|---|---|---|---|
| `index.html` Tổng quan | `/admin` (`adminDashboardPage.js`) | a | |
| `vu-an.html` Vụ án | `/admin/cases` (`adminCasesPage.js`) | a | |
| `vu-an.html` hộp thoại Nhập JSON | `/admin/import` (`adminImportPage.js`) | a | trang riêng, vẽ như hộp thoại trong thẻ |
| `chi-tiet-vu-an.html` | `/admin/cases/:id` (`adminCaseDetailPage.js`, `adminCutscene.js`, `adminPresentation.js`, `adminV3Gates.js`) | a | |
| `tao-vu-an-ai.html` | `/admin/ai` (`adminAiPage.js`) | a | cả phần duyệt bản nháp sau khi tạo là (b) |
| `hang-tuan.html` | `/admin/weekly` (`weeklyAdminPage.js`) | a | |
| `hom.html` Hòm · Nhật ký mở hòm · Cấp hòm & chìa | `/admin/chests` (`adminChestsPage.js`, `pages/admin/chests/*`) | a | tab Thống kê là (b) |
| `sua-hom.html` | `/admin/chests/:id` | a | tab Thiết lập, Lịch sử, Thống kê theo cùng hệ |
| `vat-pham.html` | `/admin/items` (`adminItemsPage.js`) | a | |
| `my-pham.html` | `/admin/cosmetics`, `/admin/cosmetics/:defId` (`adminCosmeticsPage.js`, `pages/admin/cosmetics/*`) | a | trình sửa từng món là (b) |
| `nguoi-choi.html` | `/admin/players` | a | |
| `chi-tiet-nguoi-choi.html` | `/admin/players/:id` | a | |
| `kinh-te.html` | `/admin/economy` (`adminEconomyPage.js`, `pages/admin/players/economy*.js`, `roomsReviews.js`) | a | tab Tổng quan; các tab khác là (b) |
| `nhat-ky.html` | `/admin/audit` (`adminAuditPage.js`) | a | |
| `dang-nhap.html` | `/admin/login` (`adminLoginPage.js`) | a | |
| `phuong-an-A-nen-toi.html` | | | phương án nền tối để so sánh, không làm |

## 5. Thiết kế có nhưng chưa có chức năng

Không làm giả. Mỗi mục dưới đây cần API hoặc nghiệp vụ mới; Yen quyết có làm không.

| Trang | Thiết kế có | Vì sao chưa làm |
|---|---|---|
| Thanh trên | Một ô tìm chung trả kết quả gộp người chơi, vụ án, vật phẩm | Chưa có API tìm chung. Đã làm bản thật nhỏ hơn: gõ chữ rồi chọn nơi tìm, trang đó mở với ô tìm điền sẵn (`?q=`). |
| Tổng quan | "Bản nháp AI · Chờ xem lại và xuất bản" | API chỉ trả tổng số bản nháp (`totalAiDrafts`), không đếm bản đang chờ. Trang ghi "Tổng số bản nháp đã tạo". |
| Vụ án | Nút "Xóa" bản nháp và hộp thoại "Xóa bản nháp?" | Không có API xóa vụ án. |
| Vụ án | Bộ lọc "Đã gỡ" | Gỡ xuất bản đưa vụ án về bản nháp, không có trạng thái riêng. Trang có "Đã lưu trữ" khi có vụ án ARCHIVED. |
| Vụ án | Ghi chú "Không có vụ án cũ nào đang ẩn." | API không cho biết vụ án nào là vụ án cũ đang bị ẩn. |
| Nhật ký | Email của admin trong từng dòng | API chỉ trả `adminName`. |
| Nhật ký | Tên đối tượng dễ đọc (email người chơi, tên vật phẩm) | API chỉ trả `targetType` và `targetId`; trang hiện mã. |
| Nhật ký | Bảng trước/sau dễ đọc ("Trạng thái: Đang hoạt động → Bị khóa") | Cần bảng ánh xạ tên trường và giá trị; trang hiện đường dẫn JSON và giá trị gốc. |
| Nhật ký | Nhãn "Kinh tế" cho cộng/trừ xu | Nhãn lấy từ `targetType` thật, với cộng xu là "Người chơi". |
| Mỹ phẩm | "Ra từ hòm" là một lựa chọn trong ô "Cách nhận" | API chỉ có theo cấp, thành tích, mặc định, admin cấp. Món nào rơi từ hòm nào đặt ở trang sửa hòm; trình sửa mỹ phẩm hiện danh sách hòm chỉ đọc kèm liên kết. |

Thêm từ API sẵn có, không đổi backend: số ảnh chờ duyệt trên tab, nút Khóa/Mở khóa ở trang chi tiết người chơi, "Mỗi trang" ở danh sách người chơi và nhật ký, "Sao chép JSON" ở chi tiết vụ án, đếm vụ án và người dùng trên sidebar.

## 6. Trang không có thiết kế, đã dựng theo hệ thiết kế mới

| Khu | Phần |
|---|---|
| Tổng quan | Khối "Đo đạc phiên chơi thử" (chỉ hiện khi bật đo đạc) |
| Vụ án | Trình sửa chữ cutscene; điều kiện xuất bản bị chặn (✕ đỏ, "CHƯA ĐẠT"); danh sách lỗi kiểm tra, xuất bản, nhập; vụ án bị chặn xuất bản kèm lý do; nhãn "CŨ · ẩn với người chơi"; bộ storyboard và chi phí |
| Hòm | Tab Lịch sử và Thống kê của trang sửa hòm; thanh "Xem thử như người chơi"; thông báo "Danh mục có N chỗ chưa khớp" |
| Mỹ phẩm | Tab Danh hiệu, Hiệu ứng vào sảnh; công thức KN ở Thiết lập KN; toàn bộ trình sửa viền, danh hiệu, hiệu ứng (tạo mới và sửa) |
| Người chơi | Lưới duyệt ảnh đại diện; các tab Lịch sử trận, Mở hòm, Giao dịch chợ, Trao đổi, Nhật ký admin ở trang chi tiết; hộp thoại thao tác |
| Kinh tế | Các tab Chợ, Lịch sử & trao đổi (Xuất CSV), Bất thường, Giao dịch kẹt, Phòng chơi, Đánh giá; chế độ 30 ngày của biểu đồ |
| Tạo vụ án AI | Toàn bộ luồng duyệt sau khi tạo: thẻ tiến độ, thẻ đầu bản nháp, duyệt tiền đề, sự thật vụ án (bảng cuộn trong khung, form sửa có phạm vi, bản sửa đề xuất), duyệt mù, nguồn gốc, điều kiện xuất bản V3, ma trận Crack, chẩn đoán, JSON sửa được và chỉ đọc |
| Nhật ký | Bảng trước/sau khi bấm "Xem chi tiết" |
| Mọi trang | Trạng thái đang tải, lỗi, trống |

## 7. Khác thiết kế có chủ ý

- Danh sách vật phẩm mặc định 50 dòng một trang, mỹ phẩm 24 thẻ: các bộ test full-stack cần món ở trang đầu (VC-0217, Kim Long).
- Bật/tắt hòm vẫn bắt nhập lý do (thiết kế để tùy chọn), như quy tắc cũ.
- Hình thật thay hình mẫu: hòm pixel, viền có avatar mẫu bên trong, bảng tên danh hiệu thật, sân khấu hiệu ứng thật, ảnh đại diện trong viền ở trang chi tiết người chơi.
- Tạo và sửa mỹ phẩm mở trang trình sửa đầy đủ thay vì ngăn kéo bên: ngăn kéo không chứa được tải ảnh, căn lỗ và hiệu ứng.
- Nhập JSON là một trang riêng vẽ như hộp thoại trong thẻ (địa chỉ `/admin/import` giữ nguyên).
- Trang đăng nhập admin có thêm nút đổi ngôn ngữ EN/VI.
- Thanh lưu ở trang sửa hòm và trình sửa mỹ phẩm dính đáy màn hình.
- Trang Tạo vụ án AI: ba ô chọn cũ (cấu hình, ngôn ngữ, loại vụ án) vẫn nằm trong trang làm nguồn dữ liệu, ẩn đi; thẻ, khay và nút hiện ra là radio thật đồng bộ với chúng. Bản nháp đang mở và thẻ tiến độ nằm trên form.

## 8. Còn có thể làm gọn

Một số mẫu đang lặp ở CSS từng khu, có thể chuyển vào theme và `ui.js` sau: công tắc bật/tắt (`ac-switch`, `acf-switch`, `aai-switch`), thanh lưu tối dính đáy (`ac-savebar`, `acf-savebar`), ô chọn số dòng trong phân trang (`ac-/adp-/acs-/acf-per-page`), đầu hộp thoại có nút đóng (`ac-dialog-*`, `acf-modal-*`, `adp-dialog`), ô tải ảnh, thẻ chọn kiểu radio, icon tải lên và thùng rác. Chưa gộp để tránh làm vỡ các trang vừa xong.
