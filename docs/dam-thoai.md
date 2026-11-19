# Đàm thoại và điện tín trong trận

Trong trận hai người, mỗi thám tử có một khung nhỏ dưới ô mục tiêu (trên điện thoại là 3 nút tròn ở mép phải). Khung có:

| Nút | Làm gì |
|---|---|
| **Loa** | Mở đàm thoại để nghe đồng đội. Tắt loa thì tắt luôn mic và ngắt kết nối. Trình duyệt nhớ loa cho trận sau. |
| **Mic** | Xin quyền micro rồi nói. Bật mic thì loa tự bật. Mỗi trận mic bắt đầu ở trạng thái tắt. |
| **Điện tín** | Mở hoặc đóng khung chat (phím **T**). Đồng đội nhắn khi khung đang đóng: dấu sáp đỏ đếm số tin nhấp nháy, nút sáng đỏ, một mẩu tin hiện dưới khung 5 giây. |

Màn tân thủ chơi một mình nên không có khung. Phòng chưa bắt đầu hoặc đã kết thúc cũng không có.

## Hai người kết nối với nhau thế nào

**Chat** đi qua máy chủ:
1. Gửi bằng `POST /api/game/rooms/{roomId}/chat`.
2. Máy chủ kiểm, lưu vào collection `teamChatMessages`, rồi đẩy sự kiện `TeamChatMessage` cho cả phòng qua SignalR.
3. Mở lại trang thì đọc lịch sử bằng `GET .../chat` (80 dòng cuối).
4. Index TTL tự xóa tin sau 3 ngày.

Luật chat: tối đa 300 ký tự, 6 tin mỗi 10 giây, hai tin cách nhau ít nhất 0,3 giây. Chỉ hai thám tử của trận đang chạy được gửi và đọc.

**Tiếng nói** đi thẳng từ trình duyệt này sang trình duyệt kia (WebRTC). Máy chủ không nghe, không ghi âm. Nó chỉ làm hai việc:
- kiểm ai được nói;
- chuyển các tin "bắt tay" giữa hai người qua `GameHub`.

Các bước:
1. Bấm **Loa**: trình duyệt hỏi `GET .../voice` lấy danh sách máy chủ STUN/TURN, rồi gọi hub `VoiceJoin`.
   - Chưa ai bật loa thì chưa có kết nối nào, nên hai người chưa thấy địa chỉ mạng của nhau.
2. Khi cả hai đã bật loa, người có user id nhỏ hơn gửi "offer", người kia trả "answer". Hai bên trao nhau các "ICE candidate" (đường mạng có thể đi) qua hub `VoiceSignal`.
3. **STUN** giúp mỗi máy biết địa chỉ công khai của mình, nên phần lớn mạng nhà nối thẳng được.
   - Một số mạng chặn đi thẳng: nhiều mạng 4G, wifi công ty, NAT chặt. Khi đó cần **TURN**, một máy chủ chuyển tiếp tiếng.
4. Bật hay tắt mic chỉ thay luồng âm thanh trên kết nối đang có (`replaceTrack`), không bắt tay lại.
5. Mạng rớt thì người gọi thử nối lại 2 lần. Hết lần thì khung hiện "Không nối được máy" kèm nút thử lại.
   - Một người tải lại trang hoặc mất kết nối SignalR: khi vào lại, hai bên tự nối lại.

Mỗi người chỉ có một kênh đàm thoại mỗi trận. Mở thêm tab thì tab mới lấy kênh, tab cũ báo "Đàm thoại đã chuyển sang tab khác".

## Cấu hình máy chủ chuyển tiếp (TURN)

Không cấu hình gì thì chỉ có STUN miễn phí (`stun.cloudflare.com`, `stun.l.google.com`). Đa số trận vẫn nói được; một số người dùng 4G sẽ thấy "Không nối được máy".

Có 2 cách thêm TURN. Cả hai chỉ đặt bằng **biến môi trường** trên máy chủ, không ghi vào file trong repo.

**Cách 1, Cloudflare Realtime TURN** (khuyên dùng, không phải cài gì):
- Tạo "TURN key" trong trang Cloudflare (Realtime → TURN).
- Đặt:
  ```
  Voice__CloudflareTurnKeyId=<key id>
  Voice__CloudflareTurnApiToken=<API token của key>
  ```
- Máy chủ xin chứng chỉ tạm (6 giờ) cho từng người khi họ bật loa, và bỏ cổng 53 vì trình duyệt chặn cổng này.
- Giá: Cloudflare tính 0,05 USD mỗi GB, 1.000 GB đầu mỗi tháng miễn phí. Tiếng nói khoảng 40 kbps mỗi chiều, chỉ tính khi đi qua relay.

**Cách 2, coturn tự cài** (trên VPS, cần mở cổng UDP):
- Bật `use-auth-secret` và đặt `static-auth-secret` trong coturn.
- Đặt:
  ```
  Voice__TurnUrls__0=turn:<tên miền>:3478?transport=udp
  Voice__TurnUrls__1=turn:<tên miền>:3478?transport=tcp
  Voice__TurnSharedSecret=<static-auth-secret>
  ```

**Tùy chọn khác:**
- `Voice__RelayOnly=true`: mọi tiếng nói đi qua relay, hai người không bao giờ thấy IP của nhau. Tốn băng thông relay. Chỉ có tác dụng khi đã có TURN.
- `Voice__CredentialLifetimeMinutes`: thời hạn chứng chỉ relay, mặc định 360.

## Code nằm đâu

- **Backend**
  - `Services/TeamComms/`:
    - `TeamCommsRules`: ai được nói, làm sạch chữ, kiểm tin bắt tay;
    - `SlidingWindowLimiter`: giới hạn tốc độ chat và tin bắt tay;
    - `VoiceRoomRegistry`: ai đang mở đàm thoại, từ kết nối nào;
    - `IceServerProvider`: danh sách STUN/TURN, chứng chỉ Cloudflare hoặc coturn;
    - `TeamChatService`: lưu và đẩy tin chat.
  - `WebAPI/Controllers/TeamCommsController.cs`: `GET/POST .../chat`, `GET .../voice`.
  - `WebAPI/Hubs/GameHub.cs`:
    - các hàm `VoiceJoin`, `VoiceMic`, `VoiceLeave`, `VoiceSignal`;
    - sự kiện `VoiceState` (có cờ `fresh` khi một người vừa mở lại kênh) và `VoiceSignal`.
    - Rời phòng hoặc mất kết nối thì kênh tự đóng.
  - `DataAccess/MongoDbContext.TeamChat.cs`: collection `teamChatMessages`, index theo phòng và index TTL.
- **Frontend**
  - `Client/js/game/teamComms.ts`: khung, chat, WebRTC.
  - `Client/js/api/teamCommsApi.js`.
  - `css/56-team-comms.css`.
  - `pages/gamePage.ts`: gắn khung, chuyển 3 sự kiện hub vào, báo kết nối lại, dọn khi rời trang.
- **Test**
  - `Tests/TeamCommsTests.cs` (unit).
  - `IntegrationTests/MongoTeamChatTests.cs` (cần Mongo).
  - `tests/team-comms.spec.ts`: Playwright. Gồm một cuộc gọi thật giữa hai trình duyệt có mic giả.
