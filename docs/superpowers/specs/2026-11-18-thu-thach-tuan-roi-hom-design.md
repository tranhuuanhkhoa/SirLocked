# Thử thách tuần tự xoay vụ và rớt hòm

Ngày: 2026-11-18 · Nhánh: `feat/thu-thach-tuan` (từ `feat/claude-vu-an` 6f18f8f) · Người duyệt: Yen

## 1. Ý định

Trang `/workshop/challenge` đã có: vụ thử thách, đồng hồ đếm ngược, bảng xếp hạng nhanh nhất. Nhưng admin phải tự chọn vụ và đặt khung tuần bằng tay (`POST /api/admin/weekly`), và thử thách không cho người chơi thứ gì.

Yen muốn hai việc:

1. **Thử thách tự reset mỗi tuần**: mỗi tuần hệ thống tự bốc ngẫu nhiên một vụ trong các vụ hay.
2. **Thưởng hòm giống kiểu rớt đồ hằng tuần của CS2**: mỗi tuần, ai phá vụ thử thách đạt từ 80/100 điểm thì chắc chắn được 1 hòm. Hòm hiếm có tỷ lệ thấp hơn hòm cùi.

Lý do: chợ cần nguồn hàng có giá trị thật. Song song với việc này, ở nhánh kho rương (`feat/kho-ruong-giao-dien`, D:/sl-kho-ruong, **chưa commit**), Yen đã cho shop ngừng bán hòm và chỉ bán chìa (`Chests:SellChests = false`). Vậy hòm chỉ còn đến từ phần thưởng, và thử thách tuần là nguồn chính. Hòm nào ít rớt mà nhiều đồ đẹp thì người chơi sẽ tự định giá cao trên chợ, và đó là thứ làm chợ sống. Hệ thống không đặt giá hòm trên chợ. Người bán tự đặt giá, như hiện nay.

## 2. Mục tiêu

- **G1. Tự xoay vụ.** Vào đầu mỗi tuần có đúng một vụ thử thách đang hoạt động, mọi người thấy cùng một vụ, và không ai phải bấm gì.
- **G2. Rớt hòm.** Mỗi tài khoản được tối đa 1 hòm mỗi tuần: lần đầu trong tuần phá vụ thử thách đạt từ 80 điểm thì nhận đúng 1 hòm, loại hòm quay theo tỷ lệ.
- **G3. Tỷ lệ chỉnh được.** Admin đặt tỷ lệ rớt cho từng hòm ở `/admin/chests`. Người chơi xem được tỷ lệ này.
- **G4. Người mua thấy được giá trị.** Người chơi xem đồ bên trong và tỷ lệ độ hiếm của từng hòm ở **trang kho rương** (`chestPage.js`). Trang này đã có khối tỷ lệ, và ở nhánh kho rương đã ghi "hòm rơi từ Thử thách tuần" (Y12). Nhánh này không làm gì thêm cho G4, chỉ cần không làm hỏng trang đó.

## 3. Không làm

- Hệ thống không định giá hòm trên chợ, không có giá sàn hay giá trần mới. Giá do người bán tự đặt trong giới hạn `MarketRules` hiện có.
- Không thêm loại hòm mới riêng cho thử thách. Hòm rớt ra chính là các hòm của shop (`chest_np`, `chest_sm`, `chest_nb` và hòm admin thêm sau này).
- Không thưởng xu cho thử thách. Thưởng xu theo ván (`GrantGameRewardsAsync`) vẫn giữ nguyên như cũ.
- Không đổi luật bảng xếp hạng thử thách (vẫn xếp nhanh nhất trong khung tuần).
- Không đổi luật chấm điểm.
- Không sửa trang chợ và trang kho rương. Nội dung và tỷ lệ của hòm đã hiện ở trang kho rương, và trang đó thuộc nhánh kho rương (Y12).

## 4. Những điều không được xảy ra

- **Cày hòm:** người chơi phá lại vụ đã biết lời giải để lấy thêm hòm. Mỗi tài khoản chỉ 1 hòm mỗi tuần, không có ngoại lệ.
- **Mất hòm:** người chơi đủ điều kiện nhưng không nhận được hòm, vì máy chủ khởi động lại, vì túi đầy, hay vì gọi trùng.
- **Hòm nhân đôi:** cùng một người, cùng một tuần mà có 2 hòm. Ví dụ: hai ván xong cùng lúc, hoặc lưu kết quả lại một lần nữa.
- **Không có vụ:** đầu tuần không chọn được vụ nào vì thiếu vụ đạt chuẩn, và trang thử thách trống.
- **Tỷ lệ sai:** tỷ lệ công bố khác với cách máy chủ quay thật.

## 5. Ràng buộc

- MongoDB chạy standalone, không có transaction nhiều document. Mọi thay đổi phải là chuỗi ghi có điều kiện và làm lại được (idempotent), giống cách `ChestService` và `MarketService` đang làm: dùng `_id` xác định trước làm khóa chống trùng, và có vòng quét phục hồi nếu cần.
- Chỉ máy chủ quyết định kết quả quay. Dùng `IChestRandom` hiện có (hoặc một bản tương đương có thể thay khi test).
- Live catalog hòm nằm trong collection `chests` (`CatalogChest`), không nằm trong `appsettings`. Tỷ lệ thử thách phải lưu ở đó để admin chỉnh được.
- Nhánh này cần thay đổi `SellChests` của nhánh kho rương. Hai nhánh phải gộp chung trước khi deploy, nếu không shop vẫn bán hòm và thử thách mất ý nghĩa. Nhánh này **không** tự sửa lại phần `SellChests`.
- Giao diện có tiếng Việt và tiếng Anh, theo hàm `tr()` như các trang khác.
- Trước khi deploy phải kiểm tra bản đang chạy trên VPS và các phiên khác (xem ghi chú deploy trong memory `admin-gop-status`).

## 6. Những gì Yen đã quyết

| # | Quyết định |
|---|---|
| Y1 | Thử thách tự reset mỗi tuần, bốc ngẫu nhiên 1 vụ trong các vụ hay. |
| Y2 | "Vụ hay" xác định theo đánh giá sao của người chơi. |
| Y3 | Đạt từ 80 điểm thì **chắc chắn** có hòm, 1 lần mỗi tuần, như cách rớt đồ hằng tuần của CS2. |
| Y4 | Hòm rớt ra là các hòm của shop. Shop giờ chỉ bán chìa (đã sửa ở nhánh kho rương). |
| Y5 | Mở hòm vẫn cần chìa mua bằng xu. |
| Y6 | Hòm hiếm có tỷ lệ thấp hơn hòm cùi. Yen giao cho Claude chia tỷ lệ. |
| Y7 | Giá hòm trên chợ do người chơi tự đặt. Hòm nhiều đồ đẹp thì tự nhiên giá cao hơn. |
| Y8 | Vụ do người chơi làm (có `AuthorUserId`) vẫn được bốc. Khi tính điểm sao chỉ dùng đánh giá từ tài khoản đã xác minh email. Tác giả không nhận hòm từ vụ của chính mình. |
| Y9 | Phải đạt từ 80 điểm **và** bắt đúng hung thủ (`Success == true`) mới có hòm. |
| Y10 | Tuần mới bắt đầu lúc **7h sáng thứ Tư giờ Việt Nam**. |
| Y11 | Chỉ tài khoản **đã xác minh email** mới được rớt hòm. Tài khoản chưa xác minh không được quay. |
| Y12 | Đồ bên trong và tỷ lệ của hòm xem ở trang kho rương. Chợ không đổi. |
| Y13 | Đồng ý: tiêu chí vụ hay (4.0 sao, 5 đánh giá, không trùng 4 tuần, nới dần, bốc đều), admin chọn tay được, ván nào cũng tính, chơi nhóm thì mỗi người quay riêng, tỷ lệ 60/30/10, hòm mới mặc định 0, hòm tắt không rớt, lên server sau hoặc cùng nhánh kho rương. |

## 7. Thiết kế

### 7.1 Tuần

- Một tuần bắt đầu lúc **07:00 thứ Tư giờ Việt Nam** (Y10). Mốc này trùng đúng **00:00 thứ Tư giờ UTC**. Tuần kết thúc ngay trước mốc của thứ Tư tuần sau.
- Khóa tuần là ngày UTC của thứ Tư bắt đầu tuần, dạng `yyyy-MM-dd`, ví dụ `2026-11-18` cho tuần bắt đầu 07:00 VN ngày 18/11/2026. Khóa này dùng chung cho việc chọn vụ và cho việc rớt hòm. Không dùng tuần ISO, vì tuần ISO bắt đầu từ thứ Hai.
- `WeekStart` và `WeekEnd` lưu trong `WeeklyFeature` là giờ UTC: thứ Tư 00:00 UTC và thứ Tư tuần sau 00:00 UTC.
- Bản đầu tiên lên server vào giữa tuần thì tuần hiện tại tính theo mốc thứ Tư gần nhất đã qua.

### 7.2 Tự chọn vụ của tuần

**Điều kiện vụ được bốc** *(các con số do Claude chọn, nên đưa vào cài đặt để chỉnh được)*:

1. Vụ đang chơi được theo `CaseCatalogPolicy.IsPlayable` (hiện tại nghĩa là vụ pixel, công khai). Không lấy màn tân thủ, không lấy bản nháp hay vụ chỉ dùng chạy thử.
2. Điểm sao trung bình từ **4.0** trở lên, với ít nhất **5** đánh giá (`CaseReview.Rating` từ 1 đến 5). **Chỉ tính đánh giá của tài khoản đã xác minh email và đang hoạt động** (Y8). Tác giả tự đánh giá vụ của mình cũng không tính, nếu hệ thống đánh giá hiện tại cho phép tác giả tự đánh giá. Vụ chính thức và vụ có tác giả dùng chung một bộ lọc.
3. Không trùng vụ thử thách của **4** tuần gần nhất.

**Khi không đủ vụ** thì nới điều kiện lần lượt cho tới khi có ít nhất một vụ:

1. Cho phép vụ của 4 tuần gần nhất (vẫn tránh vụ của tuần ngay trước).
2. Hạ số đánh giá tối thiểu xuống 3, rồi xuống 1.
3. Hạ điểm sao xuống 3.5.
4. Lấy mọi vụ chơi được, ưu tiên vụ có điểm sao cao hơn.
5. Không có vụ nào chơi được thì không tạo thử thách. Trang hiển thị trạng thái trống như hiện nay, và ghi log cảnh báo.

**Cách bốc:** chọn ngẫu nhiên đều trong các vụ đạt chuẩn *(Claude chọn: không đặt trọng số theo số sao, để vụ ít người đánh giá vẫn có cơ hội)*.

**Khi nào bốc:** phải đảm bảo có đúng một vụ cho mỗi tuần dù nhiều request gọi cùng lúc.

- Cách gợi ý: lưu `WeeklyFeature` với khóa duy nhất theo (`Type = WEEKLY_CHALLENGE`, `WeekKey`).
- Lần gọi đầu tiên trong tuần (đọc `GET /api/workshop/weekly/challenge`), hoặc một worker chạy định kỳ, sẽ thử chèn bản ghi của tuần. Ai chèn thua (lỗi trùng khóa) thì đọc bản ghi của người thắng.
- Builder tự chọn chạy lúc gọi đầu tiên, chạy bằng worker, hay cả hai.

**Admin chọn tay:**

- Endpoint admin hiện có vẫn hoạt động. Admin chọn vụ cho tuần đang chạy (hoặc tuần sau) thì thay vụ đã bốc của tuần đó.
- Bản ghi admin đặt không bị lần bốc tự động ghi đè.
- Nếu admin đặt khung giờ không trùng ranh giới tuần thì có hai cách: bắt về đúng khung tuần, hoặc chấp nhận nhưng việc rớt hòm vẫn tính theo khóa tuần. Builder chọn, ghi rõ trong code.
- Nút "Xóa thử thách" của admin chỉ tắt vụ đang chạy. Tuần sau hệ thống vẫn tự bốc lại.

### 7.3 Rớt hòm

**Điều kiện.** Một người chơi nhận hòm khi thỏa cả bốn điều sau:

1. Có một `GameResult` của vụ thử thách đang chạy, tạo trong khung của tuần đó. Ván chơi từ trang thử thách hay từ danh sách vụ đều được *(Claude chọn)*.
2. `ScoreSummary.TotalScore >= 80` **và** `Success == true` (Y9).
3. Người chơi có tên trong `GameResult.Players`, là tài khoản đã đăng ký (không phải khách) và đang hoạt động, và **không phải tác giả của vụ** (`GameCase.AuthorUserId`, Y8). Tác giả vẫn chơi được và vẫn lên bảng xếp hạng, chỉ không nhận hòm từ vụ của mình.
4. Tuần này người đó chưa có lần rớt hòm nào.

**Xác minh email** (Y11):

- Tài khoản phải đã xác minh email và đang hoạt động, cùng điều kiện với `RequireVerifiedAsync` của chợ. Như vậy tài khoản phụ không cày hòm được.
- Tài khoản chưa xác minh thì **không quay và không ghi lần rớt nào**. Họ vẫn lên bảng xếp hạng.
- Trang kết quả ghi "Xác minh email để nhận hòm thử thách tuần".
- Vì không có lần rớt nào được ghi, người đó xác minh xong và phá lại vụ đạt từ 80 điểm trong cùng tuần thì vẫn nhận được hòm của tuần.
- Xác minh được kiểm tra vào lúc xét rớt, tức ngay sau khi lưu `GameResult`.
  - Vòng quét phục hồi (cho kết quả mà bước xét rớt chưa chạy vì máy chủ dừng) cũng kiểm tra xác minh vào lúc nó chạy.
  - Trường hợp ai đó xác minh đúng trong vài phút giữa lúc máy chủ dừng và lúc vòng quét chạy thì vẫn được hòm. Chấp nhận trường hợp này.

Chơi nhóm thì mỗi người đủ điều kiện được quay riêng, ra loại hòm riêng.

**Chống trùng.**

- Mỗi lần rớt là một document có `_id = "<weekKey>:<userId>"`. Lần chèn thứ hai bị lỗi trùng khóa, nên không thể có 2 hòm trong một tuần.
- Kết quả quay (`ChestDefId`) và `RewardItemId` được chọn và ghi vào document này **trước**, rồi mới tạo vật phẩm. Nếu phải chạy lại thì ra đúng hòm cũ, giống `ChestOpening`.

**Thời điểm.** Ngay sau khi lưu `GameResult`, cùng chỗ đang gọi `GrantGameRewardsAsync` (`MarketHosting.cs`). Thêm một vòng quét phục hồi cho các lần rớt đã ghi mà chưa giao xong hòm.

**Tạo hòm.**

- Tạo một `MarketItem` cho hòm vào túi người chơi, `Source` mới là `WEEKLY` *(Claude chọn tên. Hòm này vẫn bán và trao đổi được như hòm thường. Không thêm nó vào `IsEarned`)*.
- Cập nhật `MarketAccount.Slots` giống các lối cấp đồ khác.

**Túi đầy** *(Claude chọn)*:

- Hòm không được mất. Lần rớt vẫn ghi lại, hòm chờ ở trạng thái "chờ nhận" và nằm trên trang thử thách.
- Người chơi dọn túi rồi bấm "Nhận hòm" thì hòm vào túi.
- Hòm chờ nhận không hết hạn khi sang tuần mới. Hòm của tuần trước vẫn nhận được.
- Builder có thể chọn cách khác nếu đáp ứng đúng hai yêu cầu: không mất hòm, và không vượt giới hạn túi.

### 7.4 Tỷ lệ rớt

- Thêm vào `CatalogChest` một trường mới, ví dụ `ChallengeWeight` (số nguyên ≥ 0). Hòm có trọng số 0 thì không rớt từ thử thách.
- Tỷ lệ của mỗi hòm bằng trọng số của nó chia cho tổng trọng số của các hòm đang bật (`Active`) có trọng số > 0.
- Chỉ hòm `Active = true` mới rớt *(Claude chọn)*. Lý do: `BuyKeyAsync` từ chối bán chìa cho hòm đã tắt (`CHEST_NOT_FOR_SALE`). Nếu cho hòm tắt rớt ra thì người chơi không mua được chìa để mở. Tắt một hòm ở admin nghĩa là ngừng cả bán chìa lẫn rớt ở thử thách. Khi tính tỷ lệ, bỏ qua hòm đã tắt.

**Trọng số mặc định khi seed hoặc migrate** *(Claude chọn. Hòm có giá trị trung bình của đồ bên trong càng cao thì càng hiếm. Builder phải kiểm lại thứ tự này theo `ExpectedValue` thật trong live catalog trước khi gán)*:

| Hòm | Trọng số | Tỷ lệ |
|---|---|---|
| `chest_np` Hòm Niêm Phong (cùi) | 60 | 60% |
| `chest_sm` Tráp Sơn Mài (vừa) | 30 | 30% |
| `chest_nb` Két Nhà Băng (hiếm) | 10 | 10% |
| Hòm admin thêm mới | 0 | không rớt, cho tới khi admin đặt |

Nếu live catalog trên production có thêm hòm, migration để chúng ở 0 và ghi log, để Yen tự đặt.

**Admin.**

- Thêm ô "Tỷ lệ rớt ở thử thách tuần" cho mỗi hòm ở `/admin/chests`.
- Hiện tỷ lệ % đã quy đổi trên toàn bộ bảng.
- Trường này đi theo cơ chế phiên bản, so sánh và lịch sử sửa đổi hiện có của `AdminChestsRules`.

**Người chơi.** Trang thử thách có khối "Phần thưởng tuần này":

- Đạt từ 80 điểm là được 1 hòm.
- Danh sách hòm có thể rớt kèm tỷ lệ %.
- Trạng thái của người đang xem: "Chưa nhận", "Đã nhận: <tên hòm>" hoặc "Hòm chờ nhận (túi đầy)".

### 7.5 Giao diện

- **Trang kết quả** (`resultPage.js`):
  - Ván thử thách đủ điều kiện: khối thông báo nhận hòm, có hình hòm và tên hòm, nút "Xem trong túi" và nút "Mua chìa".
  - Đã nhận hòm tuần này rồi: dòng "Bạn đã nhận hòm tuần này".
  - Dưới 80 điểm: dòng "Cần 80 điểm để nhận hòm".
  - Đủ 80 điểm nhưng bắt sai: dòng "Phải phá được vụ mới nhận hòm".
  - Tác giả chơi vụ của mình: dòng "Tác giả không nhận hòm từ vụ của mình".
- **Trang thử thách** (`challengePage.js`): khối phần thưởng ở mục 7.4, cạnh đồng hồ đếm ngược. Đồng hồ đếm về 07:00 thứ Tư giờ VN. Trang hiện dùng `isoWeek` (trong `caseOfWeekBanner.js`) để ghi số tuần, nên phải đổi sang nhãn theo khóa tuần mới để không lệch với mốc thứ Tư. Mỗi hòm trong khối phần thưởng có link sang trang kho rương để xem đồ bên trong *(Claude chọn)*.
- **Chợ và trang kho rương:** không sửa (Y12).

### 7.6 API (gợi ý, builder chốt)

- `GET /api/workshop/weekly/challenge`: trả thêm khóa tuần, danh sách hòm có thể rớt kèm %, và trạng thái phần thưởng của người đang đăng nhập.
- `POST /api/workshop/weekly/challenge/claim`: nhận hòm đang chờ, có `idempotencyKey` như các API của hòm.
- DTO kết quả ván (hoặc endpoint kết quả) có thêm thông tin hòm vừa rớt, nếu có.

## 8. Phần để builder tự quyết

- Chạy bốc vụ lúc gọi đầu tiên, bằng worker, hay cả hai.
- Đặt tên collection hoặc model mới cho lần rớt, ví dụ `weeklyDrops` với `WeeklyDrop`.
- Cách lấy điểm sao trung bình: tính lúc bốc từ `caseReviews`, hoặc dùng số liệu tổng hợp có sẵn trong `ReviewRules`.
- Nơi đặt các con số cài đặt (ngưỡng 80 điểm, 4.0 sao, 5 đánh giá, 4 tuần): `appsettings` (`WeeklyChallenge:*`) hay cài đặt admin. Tối thiểu là `appsettings`.
- Cách vẽ khối phần thưởng trên trang thử thách và trang kết quả, theo phong cách `34-bpa-workshop.css`.

## 9. Kiểm thử bắt buộc

- **Unit**
  - Tính khóa tuần quanh ranh giới 07:00 thứ Tư giờ VN (06:59:59 và 07:00:00), kể cả tuần vắt qua năm mới.
  - Bộ lọc vụ hay và từng bước nới điều kiện.
  - Quy đổi trọng số ra %.
  - Điều kiện nhận hòm: 79 với 80 điểm, `Success` false, tài khoản chưa xác minh, tác giả chơi vụ của mình.
  - Bộ lọc vụ hay bỏ qua đánh giá của tài khoản chưa xác minh.
- **Tích hợp Mongo** (như `MongoChestTests`)
  - Hai ván cùng tuần chỉ ra 1 hòm, kể cả khi chạy song song.
  - Lưu lại `GameResult` không ra thêm hòm.
  - Máy chủ dừng giữa chừng thì vòng quét giao hòm.
  - Túi đầy thì hòm chờ, dọn túi rồi bấm nhận thì vào túi.
  - Tuần mới thì nhận được hòm mới.
  - Hai request đầu tuần cùng lúc chỉ tạo một vụ.
- **Giao diện**
  - Spec Playwright mock API cho khối phần thưởng trên trang thử thách và trang kết quả.
  - Ô tỷ lệ ở `/admin/chests`.

## 10. Rủi ro đã biết

- **Ít vụ có đánh giá:** nếu production có ít vụ đủ 5 đánh giá, các bước nới điều kiện ở 7.2 sẽ thường xuyên chạy. Nên ghi log bước nới đã dùng mỗi tuần để Yen thấy.
- **Phụ thuộc nhánh kho rương:** nếu nhánh này lên production trước nhánh kho rương, shop vẫn bán hòm và hòm thử thách bị giá shop chặn trên. Phải gộp `feat/kho-ruong-giao-dien` (sau khi commit) trước hoặc cùng lúc.
- **Hòm thừa trên chợ:** mỗi tuần có thêm tối đa N hòm, với N là số người đạt từ 80 điểm. Chìa là chỗ duy nhất rút xu ra khỏi game. Nếu sau vài tuần giá hòm trên chợ rơi về mức thấp nhất, Yen có thể hạ trọng số hoặc tăng ngưỡng điểm. Việc này chỉ cần đổi cài đặt, không cần sửa code.
