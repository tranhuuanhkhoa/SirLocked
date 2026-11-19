# Xu VIP, gợi ý có phí, quảng cáo và tác giả (VUAN-7)

Tài liệu cho người vận hành Sir Locked. Kế hoạch và các con số gốc nằm ở
`Claude outputs/vu-an-claude/VUAN-7-XU-VIP.md` (phần 1–9). Đơn VIP trả xu chạy bằng Claude API: xem
[AI_CASE_SETUP_VI.md](AI_CASE_SETUP_VI.md), mục "Đơn VIP trả xu".

Giá tạo vụ (mục 2) chỉ áp dụng khi server có `Anthropic__ApiKey`. Chưa có khóa thì đơn VIP miễn phí: đơn đi bot qua
bridge như đơn ADMIN và không giữ xu. Gợi ý có phí, quảng cáo và thưởng tác giả chạy như nhau ở cả hai trường hợp.

Mọi con số dưới đây là mặc định. ADMIN sửa ở thẻ **Cài đặt** của `/admin/ai`; mỗi lần lưu ghi một dòng nhật ký admin
(`ai-vip-pricing.update`, `ai-vip-models.update`, `hint-pricing.update`, `author-rewards.update`).

## 1. Hai loại xu

| Loại | Trường | Từ đâu | Dùng vào |
| --- | --- | --- | --- |
| Xu nạp (xu thường) | `marketAccounts.balance` | Nạp payOS, xu sẵn có, thưởng ván chơi, bán đồ | Mọi thứ |
| Xu thưởng | `marketAccounts.bonusBalance` | Chia doanh thu tác giả, thưởng bậc tác giả | Hòm, mỹ phẩm của shop, gợi ý (được tiêu **trước** xu nạp). Không dùng để mua bán giữa người chơi. Tạo vụ VIP chỉ khi `maxBonusShare` > 0 (mặc định 0, tối đa 0,3) |

- Mỗi thao tác là một lệnh cập nhật Mongo nguyên tử có chặn âm, idempotent theo mã giao dịch, và ghi sổ `walletLedger`
  (PENDING → APPLIED/REJECTED).
- Giữ xu đơn VIP: `held`/`bonusHeld`.
- Xu không đổi ra tiền.

## 2. Giá tạo vụ VIP (`aiVipPricing`)

| Preset | Nhanh | Tiết kiệm |
| --- | ---: | ---: |
| Short Demo | 5.000 xu | 2.500 xu |
| Normal Random | 8.000 xu | 4.500 xu |
| Puzzle Heavy, Dialogue Heavy | 9.500 xu | 5.000 xu |
| Full Feature | 14.000 xu | 7.500 xu |
| Phá Vỡ Lời Dối (không có trong bảng gốc, tạm như Heavy) | 9.500 xu | 5.000 xu |

- Thêm lượt PixelLab: 15 xu một lượt. Chỉ bán khi `pixelLabEnabled` bật; mặc định tắt, đơn VIP chỉ dùng thư viện và biến thể.
- Tỷ giá 26.500 VND/USD; 1 xu = 10 VND.

**Xu của một đơn:**

| Khi nào | Xu |
| --- | --- |
| Đặt đơn | Giữ giá. Thiếu xu thì server chặn (`VIP_INSUFFICIENT_COINS`), không giữ gì. |
| Yen từ chối | Trả toàn bộ ngay. |
| Đơn hỏng: chạm trần chi phí, không qua luật nội dung, model từ chối, Console hết hạn mức | Trả toàn bộ ngay, đóng đơn. |
| Đơn hỏng vì lỗi khác | Chờ 24 giờ cho ADMIN thử lại, sau đó trả toàn bộ và đóng đơn. |
| VIP hủy trước khi chạy | Trả toàn bộ. |
| VIP hủy sau khi chạy | Trả phần chưa dùng. Đã dùng = chi phí Claude thật + lượt PixelLab của kế hoạch, quy ra xu. |
| ADMIN hủy | Trả toàn bộ. |
| Giao vụ (vụ sẵn sàng đăng, `SUBMITTED`) | Trừ hẳn. |

Worker `VipLaneWorker` đối soát mỗi phút từ trạng thái trong database, nên vẫn đúng khi server khởi động lại giữa chừng.

## 3. Gợi ý có phí (`hintPricing`)

| Mức | Giá | Trừ điểm vụ |
| --- | --- | --- |
| 1 | Miễn phí | 0 |
| 2 | 1 quảng cáo thưởng hoặc 20 xu | 5% |
| 3 | 50 xu | 15% |

- Tổng trừ tối đa 60%. Mức trừ được ghi lúc mở gợi ý, nên đổi cài đặt về sau không chấm lại ván cũ.
- Áp cho gợi ý cảnh, đối chất, suy luận và câu đố.
- Người đầu tiên trong phòng mở một mức thì trả; đồng đội xem mức đó miễn phí; mở lại không trừ lần nữa.
- Phòng tân thủ và phòng chơi thử không thu.
- `vipFreeLevel2`: VIP mở mức 2 miễn phí (mặc định tắt).

**Quảng cáo** (Google H5 Games Ads, Ad Placement API):

- Chỉ bật khi đặt `Ads__Enabled=true` và `Ads__PublisherId=ca-pub-…`.
- Quảng cáo chỉ dùng cho mức 2. Người chơi tự bấm "Xem quảng cáo"; không có quảng cáo bắt buộc giữa lúc điều tra.
- Server cấp vé trước khi chiếu. Vé chỉ được xác nhận khi SDK báo `adViewed` và đã qua ít nhất 5 giây, và chỉ dùng được một lần.
- Quảng cáo lỗi hoặc bị bỏ: không mất lượt, người chơi trả bằng xu nếu muốn.
- Hộp chọn không có hiệu ứng chuyển động.

**Doanh thu theo vụ** (`caseRevenue`):

- Mỗi gợi ý trả xu là một sự kiện ghi số xu.
- Mỗi lượt xem quảng cáo là một sự kiện ghi `adRevenueVndPerView` (mặc định 53 VND).

## 4. Tác giả (`authorRewards`)

Vụ do VIP đặt mang `authorUserId` từ lúc import. Trường này không lấy từ JSON nhập tay.

| Bậc | Điều kiện | Thưởng một lần |
| --- | --- | --- |
| Tác giả | Có 1 vụ đã đăng | — |
| Tác giả được yêu thích | 100 người chơi xong, điểm ≥ 85% | 1.500 xu thưởng |
| Tác giả vàng | 500 người chơi xong, điểm ≥ 90% | 5.000 xu thưởng |

- Huy hiệu hiện ở thẻ vụ, trang chi tiết vụ và hồ sơ thám tử.
- Điểm đánh giá = trung bình sao của các đánh giá không bị ẩn, quy ra phần trăm của 5 sao.

**Chia doanh thu:** tác giả nhận 30% xu gợi ý và 30% tiền quảng cáo của vụ mình, quy ra xu thưởng.

- Giữ 7 ngày rồi mới trả.
- Trần mỗi tháng 20.000 xu cho một tác giả (giờ Việt Nam).
- Vụ không làm ra tiền thì không có thưởng.

**Không tính:**

- lượt của chính tác giả;
- tài khoản dưới 7 ngày tuổi;
- tài khoản chưa chơi vụ khác;
- ván chơi ngắn hơn 50% thời lượng ước tính;
- tài khoản trùng thiết bị hoặc IP với một tài khoản đã được tính. Server chỉ lưu SHA-256 của IP + mã thiết bị, không lưu IP.

Ván chưa xong thì chờ tối đa 2 ngày rồi mới xét.

**ADMIN:**

- `/api/admin/authors`: xem tác giả và khoản thưởng; tạm giữ, thả, thu hồi (cũng có trên `/admin/ai`).
- Thu hồi khoản đã trả lấy lại xu thưởng còn lại, không đụng xu nạp.
- Mọi thao tác ghi nhật ký admin.

## 5. Báo cáo (`GET /api/admin/ai-cases/vip-report?days=30`, thẻ trên `/admin/ai`)

- Mỗi đơn VIP: token và tiền theo model (USD, VND), lượt PixelLab của kế hoạch, giá đã thu, lời hoặc lỗ.
- Trung bình 30 ngày theo preset và tốc độ (chỉ các đơn đã tất toán).
- Doanh thu gợi ý và quảng cáo theo vụ, kèm phần đã chia tác giả.
- Tổng xu đã trả, đang giữ, đã thu hồi, bị trần tháng cắt.

Sau 5 đơn VIP đầu, Yen xem bảng này rồi chỉnh giá ở thẻ Cài đặt.
