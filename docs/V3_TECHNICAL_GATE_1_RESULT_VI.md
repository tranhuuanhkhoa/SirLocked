# SIRLOCKED — V3 TECHNICAL GATE 1 RESULT

**Ngày:** 19/07/2026  
**Phạm vi:** `mechanicsVersion = 3`, backend privacy architecture và pure domain rules  
**Kết luận:** **PASS**

## 1. Kết quả gate

Gate 1 đã chứng minh được seam kỹ thuật cần thiết để tiếp tục sang tuần API:

- Cùng một canonical `GameplayState` tạo serialized response khác nhau cho Investigator và Interrogator.
- `INV_SECRET_SENTINEL_7F91` và `INT_SECRET_SENTINEL_42AC` không xuất hiện trong wrong-role response ở các trạng thái collecting, ready for review, incorrect và correct.
- V1/V2 giữ nguyên đường projection cũ.
- Joint review disclosure tồn tại qua edit; confirmation gắn với revision; correct/incorrect resolution idempotent.
- Photo policy dùng cùng knowledge lifecycle với state projection.
- V3 không project hoặc persist legacy shared action log.
- SignalR state invalidation chỉ có `RoomId` và `Version`; notifier không nhận full state.
- Coded error và unhandled exception response không serialize private sentinel hoặc exception detail.
- Không dùng MongoDB Atlas, database production, case production hoặc asset gốc trong quá trình gate.

Kết quả này chứng minh **privacy architecture và domain feasibility**, không chứng minh gameplay vui hoặc V3 đã playable.

## 2. Bằng chứng tự động

| Check | Result |
|---|---|
| Backend full suite, Debug | 256/256 pass |
| Backend full suite, Release isolated output | 256/256 pass |
| V3/domain/privacy tests mới | 19 pass |
| Frontend `npm run typecheck` | Pass |
| Frontend `npm run build` | Pass |
| `git diff --check` | Pass |
| Production/Atlas access | Không thực hiện |

Release output mặc định đang bị một tiến trình `SirLocked.Api.exe` hiện hữu giữ file. Không dừng tiến trình đó; verification được chạy lại với output biệt lập trong thư mục local ignored và pass 256/256. Đây không phải lỗi source.

## 3. Test matrix đã qua

- Role ownership: Investigator chỉ nhận evidence riêng; Interrogator chỉ nhận testimony fragment riêng.
- Collecting: partner thấy readiness, không thấy proposal content.
- Ready/Awaiting: cả hai thấy đúng pair đã chủ động disclosure.
- Edit: revision tăng, confirmation xóa, disclosure cũ vẫn tồn tại.
- Incorrect: wrong count tăng đúng một lần, không unlock, không serialize correct evidence ID.
- Correct: reveal unlock đúng một lần và pair vào `ResolvedSharedTruth`.
- Cancel/abandon: không penalty; terminal record được giữ để retry/snapshot.
- BSON/JSON: status serialize dạng string; legacy document thiếu V3 field vẫn deserialize an toàn.
- Photo: owner và disclosed partner được phép; private partner/unknown clue bị từ chối.
- Secondary channels: action log, conversation transcript, missing IDs, scene runtime, puzzle/interaction IDs và SignalR payload không mang sentinel sang wrong role.
- Errors: stable code/message key; exception detail không ra response.

## 4. Những gì chưa được kiểm chứng

- Chưa có paired mutation API/controller/coordinator.
- Chưa chạy optimistic second-confirm qua MongoDB local hoặc concurrent HTTP requests.
- Chưa có reconnect flow end-to-end với hai browser.
- Chưa có UI, sandbox, content validator hoặc case V3 playable.
- Chưa đánh giá communication, agency, waiting, tension, payoff hoặc fun.

Mọi kết luận về trải nghiệm người chơi: `Requires human playtest validation`.

## 5. Quyết định tiếp theo

**Cho phép bắt đầu tuần API có điều kiện.** Phạm vi tiếp theo chỉ gồm start/edit testimony/submit evidence/confirm/cancel, coordinator dùng optimistic room version, MongoDB local biệt lập và API-only two-session tests. Không bắt đầu UI, sandbox hoặc migrate case cho tới khi API gate chứng minh exactly-once resolution, reconnect recovery và zero leak qua HTTP/SignalR thực tế.
