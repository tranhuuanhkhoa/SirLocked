# SIRLOCKED — PRE-PLAYTEST GAME DIRECTOR AUDIT

Ngày audit: 18/07/2026  
Phạm vi: **Glass Meridian Affair** và **Glasshouse Oath**  
Loại audit: **Pre-Playtest Game Director Audit** — không phải Measured Game Director Audit  
Mục tiêu: kiểm chứng flow hệ thống, cấu trúc co-op, phân phối thông tin, rủi ro progression và chuẩn bị playtest người thật.

## Quy ước bằng chứng

- **[Đã kiểm chứng]**: đọc trực tiếp từ JSON/source/asset, hoặc tái hiện thành công trong MongoDB và API local.
- **[Suy luận cấu trúc]**: hệ quả hợp lý của dependency/UI/content, nhưng chưa phải phản ứng của người chơi.
- **[Chưa thể biết]**: không có dữ liệu người thật.
- **`Requires human playtest validation`**: tuyệt đối không được xem là kết luận về cảm xúc hoặc độ vui.

## Kết luận điều hành

**[Đã kiểm chứng]** Cả hai case đều có thể đi từ tạo room đến kết quả thắng bằng hai tài khoản giả lập trong môi trường local. Không quan sát full-case soft-lock trên canonical path. Glass Meridian cần tối thiểu 43 gameplay action calls để thắng nếu bỏ qua puzzle không cần thiết; Glasshouse cần 33. Hai lần thử action sai vai cho mỗi case đều bị API chặn đúng quyền.

**[Đã kiểm chứng]** Vấn đề lớn nhất của Glass Meridian không phải thiếu content: ba puzzle cùng unlock ba clue đã được evidence challenge unlock trước đó; `puzzle-tide-sequence` còn mất điều kiện sau khi `item-meridian-dial` bị consume để ráp driver. Automated flow vẫn thắng mà không giải puzzle này. Puzzle layer hiện không tạo progression hoặc information payoff độc lập.

**[Đã kiểm chứng]** Glasshouse có flow ngắn và cân bằng action call hơn, nhưng Interrogator không có required action ở đầu scene 3 và 4 cho tới khi Investigator tìm clue. `dlg-10`, được scene 3 yêu cầu, đã xuất hiện và bị canonical agent hỏi ở scene 2 vì dialogue được project theo character chứ không theo scene.

**[Đã kiểm chứng]** Mọi clue/testimony/contradiction đã unlock nằm trong một shared `GameStateResponse` đầy đủ cho cả hai vai. Hệ thống lưu ai tìm ra clue, nhưng UI không giữ nội dung clue ở chế độ role-private.

**[Chưa thể biết]** Game có vui, gây bất ngờ, tạo tension, khiến hai người tranh luận hay có khoảnh khắc đáng nhớ hay không. Tất cả các nhận định đó là **`Requires human playtest validation`**.

Sơ đồ editable gồm ba page — hai case flow và information distribution: [SIRLOCKED_PRE_PLAYTEST_FLOW_MAP.drawio](./diagrams/SIRLOCKED_PRE_PLAYTEST_FLOW_MAP.drawio). File đã qua structural validator: 0 error, 0 warning, 0 overlap/crossing. Máy audit không có draw.io CLI nên không tạo PNG; `.drawio` là source có thể mở trực tiếp bằng draw.io desktop/diagrams.net.

---

# 1. Phạm vi và môi trường audit biệt lập

## 1.1 Guard an toàn

| Hạng mục | Kết quả |
|---|---|
| MongoDB | **[Đã kiểm chứng]** MongoDB Community 7.0.22 portable, bind duy nhất `127.0.0.1:27029`. |
| Database | **[Đã kiểm chứng]** Chỉ dùng `sirlocked_game_director_audit`. Seeder từ chối mọi tên database khác. |
| Connection guard | **[Đã kiểm chứng]** Chỉ chấp nhận `localhost`/`127.0.0.1`, port 27029, không TLS, không username. |
| Case import | **[Đã kiểm chứng]** Chỉ có `case-glass-meridian-affair` và `case-glasshouse-oath`. |
| User | **[Đã kiểm chứng]** Chỉ có `audit_investigator@audit.local` và `audit_interrogator@audit.local`; cả hai verified test users. |
| External services | **[Đã kiểm chứng]** OpenAI/Google/Cloudinary/email đều dùng `audit-disabled`; AI dry-run/mock/skip-generation/validate-only bật. |
| Admin seed | **[Đã kiểm chứng]** Tắt trong environment `Audit`. |
| Config | **[Đã kiểm chứng]** Nằm ngoài repository tại `D:\CODE\Final\sirlocked_game_director_audit_temp\audit-config.json`; không có production secret. |
| Production/Atlas | **[Đã kiểm chứng trong phạm vi thao tác audit]** Không dùng URI Atlas, không gọi database production, không gọi lệnh drop trên Atlas. |

MongoDB portable được lấy từ [MongoDB Community archive](https://www.mongodb.com/try/download/community-edition/releases/archive) theo [hướng dẫn Windows ZIP chính thức](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-windows-zip/).

## 1.2 Phương thức chạy

- Hai bearer session độc lập chạy đồng thời theo vai `INVESTIGATOR` và `INTERROGATOR` để thực hiện full canonical flow qua API local.
- Một in-app browser kiểm tra UI theo thứ tự: login → catalog → tạo room → SignalR cập nhật người thứ hai → chọn vai/ready/start → intro → live scene Investigator → live scene Interrogator → dialogue panel → result.
- Hệ thống browser hiện tại không cung cấp hai isolated visual browser context cùng lúc. Vì vậy phần full flow là dual authenticated session ở API; UI của hai vai được kiểm tra tuần tự trong cùng browser.
- Camera automation gửi ảnh PNG local hợp lệ và capture rectangle đúng authored clue zone. Nó kiểm chứng rule/progression, **không đo thời gian người thật tìm và căn khung clue**.
- Walking và thao tác canvas không được tự động hóa theo thời gian thực. Không được dùng API timing để suy ra pacing cảm xúc.

---

# 2. Dữ liệu đã kiểm chứng

## 2.1 Case contract và asset

| Chỉ số | Glass Meridian Affair | Glasshouse Oath |
|---|---:|---:|
| Authored estimate — không phải measured duration | 35 phút | 35 phút |
| Stage / scene | 6 / 6 | 4 / 4 |
| Character | 5 | 5 |
| Item | 5 | 0 |
| Clue | 12 | 12 |
| Camera clue | 9 | 10 |
| Dialogue-unlocked clue | 0 | 2 |
| Red herring | 1 | 2 |
| Dialogue | 12 | 14 |
| Required/canonical dialogue | 10 | 12 |
| Optional dialogue | 2 | 2 |
| Conversation node | 6 | 0 |
| Evidence challenge | 3 | 2 |
| Deduction | 2 | 1 |
| Puzzle authored | 3 | 0 |
| Interaction | 2 | 0 |
| Required teamwork chain | 2 | 1 |
| Hint | 11 | 7 |
| Asset | 48 ảnh / 35.79 MB | 32 ảnh / 27.98 MB |
| Scene backgrounds | 6 ảnh, 1600×900, 11.35 MB | 4 ảnh, 1600×900, 8.17 MB |

**[Đã kiểm chứng]** Cả hai JSON đều qua `CaseValidationService.Validate()` với `IsValid=true`, 0 validation error. Điều này chỉ xác nhận publish contract và final reachability; validator không phát hiện dead optional puzzle hoặc dialogue xuất hiện sớm.

## 2.2 Instrumented flow

| Chỉ số | Glass Meridian | Glasshouse Oath |
|---|---:|---:|
| Full flow tạo room → thắng | Thành công | Thành công |
| Core success action calls, bỏ login/lobby/hint/poll | 43 tối thiểu | 33 |
| Canonical probe có mở optional puzzle | 47 | 33 |
| Investigator core calls | 25 tối thiểu | 16 |
| Interrogator core calls | 18 | 17 |
| Camera hit | 9/9 authored camera clue trên path | 10/10 authored camera clue |
| Item inspect | 5 | 0 |
| Required dialogue asked | 10 | 12 |
| Evidence challenge resolved | 3 | 2 |
| Deduction solved | 2 | 1 |
| Puzzle solved | 2/3; tide puzzle không còn khả dụng | 0 |
| Scene complete calls | 6 | 4 |
| Teammate continuation calls | 5 | 3 |
| Correct accusation | 1 | 1 |
| Wrong-role probes | 2/2 bị chặn | 2/2 bị chặn |
| Unexpected API error | 0 | 0 |

“Core call” ở đây là một API action có chủ đích. Nó không tương đương số click vật lý, thời gian đọc, thời gian đi bộ hoặc số lần người chơi thử sai.

**Hint behavior đã kiểm chứng:** Meridian có 6 scene + 3 confrontation + 2 deduction hint = **11 unique hint**; Glasshouse có 4 + 2 + 1 = **7 unique hint**. Probe cùng một scene hint lần đầu trả `IsNew=true`, lần lặp trả `IsNew=false` và cùng nội dung. Hệ thống không chặn việc bấm lặp; sau khi dùng hết hint của target, hint cuối tiếp tục được trả lại nhưng không tạo unique hint mới.

## 2.3 Local response timing

| Chỉ số | Glass Meridian | Glasshouse Oath |
|---|---:|---:|
| Gameplay request median | 16.79 ms | 16.03 ms |
| Gameplay request p95 | 279.95 ms | 146.81 ms |
| Gameplay request max | 407.94 ms | 170.25 ms |
| Tổng response bytes trong action log probe | 1,833,306 | 1,090,731 |
| Response lớn nhất | 53,153 bytes | 45,940 bytes |

Đây là localhost warm-run, không đại diện cho Internet latency hoặc máy người chơi. Mười scene background đều trả HTTP 200 từ Vite local; mỗi file từ 1.55–2.19 MB. Warm local transfer nằm trong khoảng 3.7–21.9 ms, không được dùng làm dự đoán thời gian tải production.

## 2.4 UI đã đi qua

- **[Đã kiểm chứng]** Catalog chỉ hiển thị đúng hai case audit.
- **[Đã kiểm chứng]** Browser tạo room `Glasshouse Oath`; API session thứ hai join, chọn `INTERROGATOR`, ready; lobby tự cập nhật từ 1/2 thành 2/2 mà không reload.
- **[Đã kiểm chứng]** Start chỉ enable khi hai người khác vai và cùng ready.
- **[Đã kiểm chứng]** Live Investigator và Interrogator cùng nhìn một scene, nhưng avatar/tool khác vai.
- **[Đã kiểm chứng]** Objective ở cả hai vai là team objective: Investigator cũng thấy “ask 3 more question(s)”; Interrogator cũng thấy “uncover 3 more clue(s)”.
- **[Đã kiểm chứng]** Interrogator mở Pike ở scene 1: một question khả dụng, hai question hiện “locked — find stronger evidence first”.
- **[Đã kiểm chứng]** Result Meridian trình bày culprit/motive/method/ba evidence link, score 100 và teamwork 15/15 sau canonical correct accusation.

---

# 3. Dữ liệu chỉ được suy luận

| Suy luận cấu trúc | Cơ sở | Trạng thái |
|---|---|---|
| Shared case file có thể làm giảm nhu cầu mô tả clue bằng lời. | Cả hai role nhận full clue content ngay khi unlock; 31/24 observer snapshot có delta mới. | **`Requires human playtest validation`** |
| Glasshouse có nguy cơ Interrogator chờ ở scene 3 và 4. | Required-action snapshot của Interrogator bằng 0 ở entry cho tới khi Investigator tìm clue. | **`Requires human playtest validation`** về cảm giác/chán; trạng thái không có action là đã kiểm chứng. |
| Glasshouse có nguy cơ reading overload đều qua cả bốn scene. | Structural exposure upper bound 304–341 từ/scene; 12 required dialogue. | **`Requires human playtest validation`** |
| Meridian puzzle có nguy cơ bị xem là “việc phụ không payoff”. | Reward clue đã được challenge unlock; win path không cần puzzle; một puzzle dead sau consume. | **`Requires human playtest validation`** về cảm nhận; dependency là đã kiểm chứng. |
| Team objective có thể khiến người chơi thử action không thuộc vai mình. | Objective không role-specific trong UI live; API chặn action sai vai. | **`Requires human playtest validation`** |
| `dlg-10` xuất hiện ở scene 2 có thể phá nhịp reveal scene 3. | Canonical agent hỏi nó ở scene 2; scene 3 mới liệt kê nó là required. | **`Requires human playtest validation`** về mức ảnh hưởng narrative. |
| Meridian roof chain có cấu trúc gần signature moment hơn các chain còn lại. | Có đủ I clue → INT confrontation → NPC concession → deduction thay roof-escape theory. | Chỉ là candidate; **`Requires human playtest validation`** cho Aha/memorability. |

---

# 4. Dữ liệu chưa thể biết

Không có dữ liệu người chơi thật, video, voice transcript, gaze, self-report hoặc interview. Vì vậy chưa thể kết luận:

- Người chơi có chán, bất ngờ, tò mò, căng thẳng, thỏa mãn hoặc muốn chơi tiếp không.
- Dialogue có hấp dẫn hay không.
- Scene nào đáng nhớ nhất.
- Hai người có thực sự tranh luận hay chỉ im lặng đọc shared state.
- Emotional curve thực tế.
- Thời gian walking/searching/reading/thinking/discussing/waiting.
- First clue latency của người thật.
- Camera clue có dễ nhìn/căn khung hay không.
- Red herring có công bằng hay gây mất niềm tin.
- Final accusation là suy luận hay checklist.
- Thời lượng thực tế có gần authored estimate 35 phút hay không.
- Người chơi mới có hiểu keybind, icon và objective mà không cần moderator không.

Tất cả các mục trên: **`Requires human playtest validation`**.

---

# 5. Flow map — Glass Meridian Affair

```text
Room → Gallery → Exhibition Hall → Rainwalk
                              ↘ Merrit contradiction
                              ↘ Jonas contradiction
        → Maintenance Tunnels → Deduction: locked-room method
        → Cartographers' Annex → Ansel contradiction
        → Clocktower → Deduction: culprit chain
        → Final accusation

Optional branch sau đó: backtrack Gallery → 2 puzzle redundant.
Tide puzzle không còn khả dụng sau khi Meridian Dial bị consume.
```

| Scene | Investigator path | Interrogator path | Gate/unlock đã kiểm chứng |
|---|---|---|---|
| 1. Meridian Gallery | Capture `gallery-bolt`, `luminous-smear`; inspect `prism-key`. | `ansel-gallery`, `strake-transfer`. | Cả item + 2 clue + 2 dialogue mới complete. |
| 2. Exhibition Hall | Capture `donation-ledger`, `blackout-switch`; inspect `brass-crank`. | `captain-route`, `merrit-roof`. | Merrit challenge được mở sau question nhưng cần clue ở scene 3. |
| 3. Rooftop Rainwalk | Capture `roof-footprints`, `rainwalk-reflection`; inspect `meridian-dial`; combine dial + crank. | `jonas-blackout`; dùng reflection với Merrit và blackout-switch với Jonas. | Hai challenge unlock `symbol-prism` và `tide-sequence`; scene complete không cần puzzle. |
| 4. Maintenance Tunnels | Capture `tube-salt-scrape`; inspect assembled driver + tunnel hatch; use driver. | Ban đầu 0 required action; sau clue hỏi `jonas-tunnels`. | Scene 5 được interaction mở; Deduction 1 available và solved. |
| 5. Cartographers' Annex | Capture `secretary-wax`. | Ban đầu 0 required action; sau clue hỏi `ansel-visitor`, `strake-annex`; challenge Ansel. | Challenge unlock `manifest-decoded`. |
| 6. Harbor Clocktower | Capture `clocktower-timing`. | Ban đầu 0 required action; sau clue hỏi `ansel-final`, `captain-clock`. | Deduction 2 available; final gates satisfied. |
| Optional backtrack | Gallery: solve manifest + prism puzzles. | Không có role-specific action tương ứng. | Không unlock thông tin mới; reward đã có từ challenge. |

## Structural sequence issue — puzzle layer

| Puzzle | Reward | Reward đã được unlock bởi | Runtime result |
|---|---|---|---|
| `puzzle-prism-symbols` | `clue-symbol-prism` | `challenge-merrit-roof` | Solve được sau backtrack nhưng không có new clue. |
| `puzzle-manifest-code` | `clue-manifest-decoded` | `challenge-ansel-visitor` | Solve được sau backtrack nhưng không có new clue. |
| `puzzle-tide-sequence` | `clue-tide-sequence` | `challenge-jonas-blackout` | `item-meridian-dial` đã bị consume; puzzle còn locked và không solve trong flow. |

**[Đã kiểm chứng]** Game vẫn thắng với `puzzle-tide-sequence` unsolved. Đây là dead optional content, không phải full-case soft-lock.

---

# 6. Flow map — Glasshouse Oath

```text
Room → Glasshouse → Pump Room → Voss contradiction → Study
                                           ↘ dlg-10 xuất hiện sớm
     → Livia contradiction → Cellar → Deduction/teamwork chain
     → Final accusation
```

| Scene | Investigator path | Interrogator path | Gate/unlock đã kiểm chứng |
|---|---|---|---|
| 1. Glasshouse | Capture required clue 1/2/3; clue 4 là optional red herring. | Required dlg 1/3/4; dlg 2 optional. | 3 camera + 3 dialogue required. |
| 2. Pump Room | Capture clue 5/7. | Required dlg 5/6/7; dùng clue 2 ở Voss challenge. | Challenge unlock clue 6, bắt buộc để complete scene. `dlg-10` của scene 3 bị hỏi sớm tại đây. |
| 3. Study | Entry: capture clue 8/9 trước. | Entry: 0 required action còn khả dụng; sau clue hỏi dlg 9/11, challenge Livia unlock clue 10. Dlg 10 đã asked ở scene 2. | Clue 8/9/10 + dlg 9/10/11 required. |
| 4. Cellar | Entry: capture clue 11/12 trước. | Entry: 0 required action; sau clue hỏi dlg 12/13/14. | Teamwork chain ghép clue 11 + challenge 2 từ scene trước + deduction. |
| Final | Solve deduction và correct accusation. | Có thể tham gia quyết định, nhưng canonical call do Investigator gửi. | Case thắng; không puzzle/item/backtrack. |

**[Đã kiểm chứng]** Scene 3 và 4 không có required action cho Interrogator tại entry. Con số 0 là action-availability snapshot, không phải số giây chờ.

---

# 7. Action map theo vai

## 7.1 Contract

| Action | Investigator | Interrogator | Shared/any role |
|---|:---:|:---:|:---:|
| Camera capture | ✓ | API chặn | — |
| Inspect item | ✓ | API chặn | — |
| Combine/use item | ✓ | API chặn | — |
| Solve scene puzzle | ✓ | API chặn | — |
| Ask dialogue | API chặn | ✓ | — |
| Conversation tree | API chặn | ✓ | — |
| Present evidence challenge | API chặn | ✓ | — |
| Request hint | ✓ | ✓ | Shared hint state |
| Solve deduction | ✓ | ✓ | Canonical audit dùng Investigator |
| Complete/go to scene | ✓ | ✓ | Mỗi caller tự chuyển scene |
| Accuse | ✓ | ✓ | Canonical audit dùng host/Investigator |

## 7.2 Canonical successful calls

| Vai | Glass Meridian — minimum win path | Glasshouse |
|---|---:|---:|
| Investigator | 9 capture + 5 inspect + 2 interaction + 6 complete + 2 deduction + 1 accuse = **25** | 10 capture + 4 complete + 1 deduction + 1 accuse = **16** |
| Interrogator | 10 dialogue + 3 challenge + 5 continuation = **18** | 12 dialogue + 2 challenge + 3 continuation = **17** |
| Tổng | **43** | **33** |

Meridian thêm 4 Investigator calls nếu người chơi theo optional puzzle branch: backtrack, hai puzzle, return final.

---

# 8. Information distribution map

## 8.1 Nguồn thông tin

| Information | Người tạo action | Sau action | Role-private content? |
|---|---|---|---|
| Camera clue | Investigator | Full `ClueDto` vào `UnlockedClues` shared | Không |
| Dialogue answer | Interrogator | Full Q/A vào `Testimonies` shared | Không |
| Contradiction resolution | Interrogator | Prompt/evidence/resolution vào shared state | Không |
| Item/interaction/puzzle state | Investigator | IDs và item metadata shared | Không |
| Deduction state | Role gửi action | Availability/options/result shared | Không |
| Scene/progress/action log | Mỗi role | Shared | Không |

Backend có `ClueDiscoveryRecord.DiscoveredByRole` và `ResolvedByRole` để biết nguồn đóng góp, nhưng projection người chơi vẫn gửi full unlocked content cho cả hai vai.

## 8.2 Full-state observations trong audit

| Chỉ số | Glass Meridian | Glasshouse |
|---|---:|---:|
| Cross-role full-state observations | 48 | 34 |
| Observation có field mới | 31 | 24 |
| Tổng bytes của observer state response | 1,775,854 | 1,046,365 |
| Observer state response lớn nhất | 50,688 | 45,550 |

Các con số này đến từ audit polling sau action để chứng minh role còn lại nhận state mới; chúng không phải packet count của một phiên người chơi bình thường. Lobby realtime update đã được browser xác nhận. SignalR gameplay packet chưa được network-capture riêng.

## 8.3 Communication risk

**[Suy luận cấu trúc]** Khi Investigator chụp clue, Interrogator có thể mở Case File và đọc nguyên `title + content`; khi Interrogator hỏi NPC, Investigator đọc được nguyên Q/A trong Testimony. Cơ chế này hỗ trợ completion nhưng có thể thay “mô tả cho nhau” bằng “cùng đọc UI”. **`Requires human playtest validation`** để biết người chơi có thực sự bỏ giao tiếp hay không.

---

# 9. Các đoạn có nguy cơ một vai phải chờ

| Case/đoạn | Bằng chứng hệ thống | Vai có nguy cơ chờ | Mức chắc chắn |
|---|---|---|---|
| Meridian scene 4 entry | Required action snapshot của INT = 0; dialogue cần `tube-salt-scrape`. | Interrogator | Trạng thái 0 action đã kiểm chứng; cảm giác chờ cần human test. |
| Meridian scene 5 entry | Required action snapshot của INT = 0; dialogue cần `secretary-wax`. | Interrogator | Như trên. |
| Meridian scene 6 entry | Required action snapshot của INT = 0; dialogue cần `clocktower-timing`. | Interrogator | Như trên. |
| Meridian optional backtrack | Chỉ Investigator giải puzzle; Interrogator không có paired action. | Interrogator | Structural; nhịp thực tế chưa biết. |
| Glasshouse scene 3 entry | Dlg 9/11 locked đến khi clue 8/9 được capture; dlg 10 đã asked sớm. | Interrogator | Trạng thái 0 action đã kiểm chứng. |
| Glasshouse scene 4 entry | Dlg 12/13/14 cần clue 11/12. | Interrogator | Trạng thái 0 action đã kiểm chứng. |
| Mọi scene sau khi I xong phần vật lý | Scene vẫn cần dialogue/challenge trước complete. | Investigator | **[Suy luận]** Có thể review Case File/thảo luận, nên chưa gọi là idle thật. |

Không có duration wait vì automation không mô phỏng thời gian tìm/đọc. Mọi nhận định “chán vì chờ”: **`Requires human playtest validation`**.

---

# 10. Các đoạn có nguy cơ reading overload

## 10.1 Text inventory

| Text | Glass Meridian | Glasshouse |
|---|---:|---:|
| Scene descriptions | 158 từ | 127 từ |
| Clue public fields — upper bound nếu mở capture detail + Case File | 858 | 767 |
| Dialogue Q+A | 435 | 535 |
| Avg Q+A/dialogue | 36.2 | 38.2 |
| Longest answer | 34 | 35 |
| Avg clue content — chỉ `content` | 36.3 | 30.2 |
| Conversation tree text | 186 | 0 |
| Challenge text | 141 | 120 |
| Deduction text | 190 | 128 |
| Puzzle text | 136 | 0 |
| Hint text | 183 | 157 |
| Final logic/options/ending | 310 | 312 |

## 10.2 Structural exposure upper bound theo scene

Con số dưới đây cộng description + public fields của required clue + required Q/A. Người chơi không bắt buộc đọc toàn bộ cùng lúc, nên đây là **upper bound cấu trúc**, không phải measured reading.

| Scene | Từ |
|---|---:|
| Meridian Gallery | 276 |
| Meridian Exhibition Hall | 258 |
| Meridian Rainwalk | 187 |
| Meridian Tunnels | 135 |
| Meridian Annex | 159 |
| Meridian Clocktower | 173 |
| Glasshouse scene 1 | 341 |
| Glasshouse scene 2 | 320 |
| Glasshouse scene 3 | 322 |
| Glasshouse scene 4 | 304 |

**[Suy luận cấu trúc]** Glasshouse giữ mức exposure gần như ngang nhau qua bốn scene, trong khi Meridian giảm sau hai scene đầu. Điều này tạo giả thuyết Glasshouse có thể thiếu khoảng thở hoặc escalation về mật độ đọc. Việc người chơi có overload/skip text hay không: **`Requires human playtest validation`**.

---

# 11. Các vị trí gần nhất với “Crack the Lie”

## 11.1 Glass Meridian — chain A

| Bước | Có trong hệ thống? | Bằng chứng |
|---|:---:|---|
| Investigator phát hiện chi tiết độc quyền | ✓ | `clue-rainwalk-reflection`, camera-only. |
| Thông tin cần diễn giải | ✓ về cấu trúc | Reflection có thể bác roof crossing; việc người chơi tự diễn giải chưa biết. |
| Interrogator nhận và sử dụng | ✓ | Present reflection vào `challenge-merrit-roof`. |
| NPC phản ứng | ✓ | Success response: Merrit thừa nhận staged sighting. |
| Lời khai bị phá | ✓ | `CONTRADICTION_RESOLVED`. |
| Hypothesis thay đổi | Có trong authored deduction | Deduction chuyển roof escape thành staged-sighting theory. Phản ứng người chơi chưa biết. |
| Gameplay mở rộng | ✓ | Unlock clue `symbol-prism`, teamwork chain và deduction gate. |
| Presentation payoff | Chưa đo | UI contradiction/case file tồn tại; impact cần human test. |

Đây là candidate mạnh nhất về cấu trúc, không phải kết luận “Aha moment”. **`Requires human playtest validation`**.

## 11.2 Glass Meridian — chain B

`secretary-wax` camera → `dlg-ansel-visitor` → present wax → Ansel concession → `manifest-decoded` → culprit deduction. Chuỗi hoàn chỉnh hơn về motive/opportunity, nhưng clue `manifest-decoded` cũng là reward trùng của puzzle manifest.

## 11.3 Glasshouse

- Candidate A: `clue-2` ở scene 1 → Voss challenge scene 2 → NPC thừa nhận gray-dusted figure → unlock `clue-6`.
- Candidate B: `clue-8` ở scene 3 → Livia challenge → household oath được lộ → unlock `clue-10`.
- Authored teamwork chain lại dùng `clue-11` ở scene 4 + challenge B đã hoàn thành ở scene 3 + deduction. Đây là late merge, không phải một handoff liền mạch.

Candidate A là chuỗi cross-scene rõ nhất; candidate B gắn motive tốt hơn. Candidate nào tạo reversal thật: **`Requires human playtest validation`**.

---

# 12. Shared state có thể làm mất nhu cầu giao tiếp ở đâu

| Điểm | Shared state hiện tại | Rủi ro cần test |
|---|---|---|
| Sau camera hit | Role còn lại nhận full clue content và photo URL. | Có cần Investigator mô tả vị trí/chi tiết không? |
| Sau dialogue | Investigator nhận full question/answer. | Interrogator có cần kể lại lời khai không? |
| Sau challenge | Cả hai nhận prompt, evidence title và success response. | Moment có trở thành system notification thay vì social reveal không? |
| Case File | UI ghi “Shared investigation”; evidence/testimony/contradiction đều chung. | Hai người có chỉ đọc độc lập rồi click tiếp không? |
| Deduction | Cả hai thấy cùng options và missing count. | Có tạo debate hay chỉ chọn option rõ nhất? |
| Action log | Cả hai đọc được teammate vừa làm gì. | Coordination bằng lời có bị log thay thế không? |

Không đề xuất xóa shared state trước playtest. Cần đo “thông tin nào được nói trước khi role kia tự mở Case File” để xác định phần nào nên giữ private/summary-only.

---

# 13. Soft-lock và objective clarity

| Priority | Vấn đề | Bằng chứng | Ảnh hưởng hệ thống |
|---:|---|---|---|
| 1 | Meridian tide puzzle mất required item. | Dial bị consume khi combine; puzzle cần dial sau khi clock clue ở scene 6. | Puzzle-level soft-lock; không block win. |
| 2 | Ba puzzle Meridian trùng reward với ba challenge. | Cùng `unlockClueIds`; challenge xảy ra trước puzzle. | Puzzle không có unique information/progression payoff. |
| 3 | Glasshouse `dlg-10` xuất hiện sớm. | Dialogue project theo NPC; Voss ở scene 2/3; no clue gate; automation hỏi ở scene 2. | Scene 3 mất một action/reveal theo authored condition. |
| 4 | Objective không role-specific. | Live Investigator thấy “ask questions”; Interrogator thấy “uncover clues”. | Người chơi có thể không biết phần nào mình làm được. |
| 5 | Locked dialogue chỉ nói “find stronger evidence”. | UI live Pike panel. | Không nêu clue/category còn thiếu; có thể là intentional anti-spoiler. |
| 6 | Mỗi người tự continue scene. | `CompleteScene` move caller only; teammate phải gọi lại. | Có thể lệch scene tạm thời nếu một người không tiếp tục. |
| 7 | Optional content không nằm trong objective count. | Meridian 2 optional dialogue; Glasshouse clue 4 + dlg 2/8; final path bỏ được. | Người chơi completionist có thể đọc/làm thêm mà không biết giá trị. |
| 8 | Publish validator không bắt dead optional content. | Cả hai case valid; runtime vẫn tái hiện tide puzzle dead và dlg-10 early. | Audit coverage gap, không phải runtime crash. |

**[Đã kiểm chứng]** Không có full-case soft-lock trong hai canonical flow.  
**[Chưa thể biết]** Các điểm trên có làm người chơi bối rối hay bỏ game không — **`Requires human playtest validation`**.

---

# 14. Top 10 giả thuyết cần người thật kiểm chứng

| # | Giả thuyết | Bằng chứng cấu trúc | Cách kiểm chứng |
|---:|---|---|---|
| 1 | Người chơi ít truyền đạt clue vì role kia đọc full Case File ngay. | Full shared clue/testimony. | Ghi thời điểm clue unlock, thời điểm role tìm ra nói, thời điểm role kia mở Case File. |
| 2 | Interrogator cảm thấy bị động ở Glasshouse scene 3/4 entry. | 0 required action trước camera clue. | Đo idle duration, action attempts, lời yêu cầu teammate, self-report sau scene. |
| 3 | Investigator nhầm team objective là action của mình. | Objective hiển thị “ask questions”. | Đếm click/di chuyển tìm action không tồn tại và câu hỏi về role. |
| 4 | Glasshouse có reading load quá đều và người chơi bắt đầu skim ở scene sau. | 304–341 từ upper bound mỗi scene. | Đo dwell, skip/typewriter advance, reopen testimony, recall clue. |
| 5 | `dlg-10` sớm làm reveal scene 3 mất ý nghĩa hoặc gây mismatch ngữ cảnh. | Asked ở scene 2 trong automation. | Hỏi người chơi Voss đang nói về địa điểm/sự kiện nào; ghi confusion marker. |
| 6 | Meridian puzzle bị xem là không cần hoặc gây bối rối vì reward đã có. | Win path không cần puzzle; rewards duplicate. | Không hướng dẫn; ghi ai mở puzzle, lý do họ làm, payoff họ nhận ra. |
| 7 | Meridian roof chain tạo hypothesis reversal thật. | Chuỗi clue → challenge → deduction đầy đủ nhất. | Trước/sau challenge, mỗi người ghi riêng theory một câu; so sánh thay đổi. |
| 8 | Glasshouse Voss challenge tạo cross-role handoff tốt hơn chain authored cuối. | Clue scene 1 được dùng scene 2; unlock lời khai mới. | Ghi ai nhắc clue, ai chọn evidence, có cần nói chuyện không. |
| 9 | Final accusation là checklist thay vì tranh luận. | Cả hai thấy cùng options/evidence; one caller submits. | Ghi duration discussion, số theory cạnh tranh, evidence rationale được nói. |
| 10 | Red herring có được xem là “fair clue” hay chỉ noise. | Meridian 1; Glasshouse 2, trong đó clue 4 optional. | Sau session yêu cầu phân loại clue thật/đỏ và giải thích bằng evidence, không hỏi cảm xúc trước. |

Mọi kết quả của bảng này chỉ có giá trị sau human playtest.

---

# 15. Kịch bản playtest cụ thể cho hai người

## 15.1 Case đầu tiên

Chạy **Glasshouse Oath** trước. Không sửa content giữa lúc một cặp đang chơi.

## 15.2 Chuẩn bị

- Hai người chơi thật, không dùng chung màn hình; có voice call hoặc ngồi cách nhau không nhìn màn hình nhau.
- Gán ngẫu nhiên Investigator/Interrogator; ghi rõ mức quen game và quen puzzle/co-op.
- Record hai màn hình, mic chung hoặc hai track mic, event log và moderator notes. Có consent.
- Không nói trước culprit, required clue, `Crack the Lie`, red herring hoặc mục tiêu nghiên cứu.
- Moderator chỉ giới thiệu: “Hãy cùng giải case. Nói chuyện như bình thường. Khi không biết làm gì, hãy nói bạn đang cố làm gì.”

## 15.3 Protocol

| Mốc | Moderator làm gì | Dữ liệu phải ghi |
|---|---|---|
| Login/lobby | Để người chơi tự join, chọn vai, ready/start. | Thời gian, lỗi room code, nhầm vai, câu hỏi UI. |
| Intro/scene 1 | Không hướng dẫn keybind trừ khi không thể tiếp tục. | Time-to-first meaningful action; action đầu mỗi role; first clue/dialogue. |
| Clue 2 xuất hiện | Không nhắc phải chia sẻ. | Investigator có nói gì trước khi Interrogator mở Case File không. |
| Trước Voss challenge | Yêu cầu mỗi người viết riêng một câu: “Bạn nghĩ chuyện gì đã xảy ra?” | Theory snapshot, không công khai cho teammate. |
| Sau Voss challenge | Không hỏi “có bất ngờ không” ngay. | Theory có đổi; ai chọn evidence; NPC response có được nhắc lại. |
| Scene 3 entry | Im lặng quan sát. | Interrogator available action, waiting, UI navigation, `dlg-10` context. |
| Livia challenge | Ghi lời trao đổi nguyên văn. | Information sharing / interpretation / debate / UI instruction. |
| Scene 4 entry | Im lặng quan sát. | Idle duration, clue 11/12 handoff, locked dialogue reaction. |
| Trước deduction | Mỗi người chọn riêng culprit + 3 evidence + confidence 0–100. | Agreement gap và evidence recall. |
| Final accusation | Cho hai người tự quyết ai thao tác. | Discussion duration, rejected options, final rationale. |
| Result | Để màn hình kết quả chạy xong rồi mới interview. | Có đọc ending không; evidence explanation có khớp theory không. |

## 15.4 Intervention rule

- Nếu không có state-changing action trong 120 giây, moderator hỏi trung tính: “Hai bạn đang cố đạt điều gì?”
- Nếu vẫn kẹt sau câu hỏi đó, cho một hint có sẵn trong game; không giải thích ngoài UI.
- Ghi chính xác timestamp, câu hỏi, hint context, role yêu cầu và action sau hint.
- Không gắn nhãn “bored/confused” nếu người chơi không tự nói hoặc interview không xác nhận.

## 15.5 Post-session interview

1. Mỗi người kể lại case theo thứ tự mình hiểu, không xem Case File.
2. Clue nào chỉ bạn biết trước? Bạn truyền nó cho teammate thế nào?
3. Khi nào theory của bạn thay đổi? Vì evidence nào?
4. Có lúc nào bạn không biết mình có action gì không? Chỉ đúng màn hình/scene.
5. Bạn có mở Case File thay vì hỏi teammate không? Tại sao?
6. Evidence challenge nào là suy luận; challenge nào là thử menu?
7. Final accusation phản ánh điều hai người đã bàn hay chỉ là đáp án rõ nhất trên UI?
8. Bạn muốn tiếp tục case khác không? Lý do cụ thể.

Các câu 3, 7, 8 là dữ liệu human validation; không được thay bằng suy luận của observer.

---

# 16. Template ghi dữ liệu mỗi 30 giây

| Field | Cách ghi |
|---|---|
| Timestamp | `mm:ss`, đồng bộ hai video. |
| Role | INV / INT / TEAM. |
| Scene | Scene ID + title. |
| Activity | Walking / Searching / Inspecting / Reading / Dialogue / Discussing / Puzzle / Inventory / Camera / Waiting / Navigation-UI / Accusation / Reveal / Other. |
| Available actions | Số và ID action hệ thống đang cho role đó. |
| Input/action | Click/key/API-equivalent action vừa làm. |
| New information | Clue/dialogue/challenge/deduction ID; ai tạo ra. |
| Shared state | Version, delta field, role kia đã thấy/mở chưa. |
| Communication | Coordination / Information sharing / Interpretation / Debate / Confirmation / UI instruction / Social reaction / None. |
| Real decision | Có/không; options đang cạnh tranh. |
| Objective shown | Chuỗi objective đúng như UI. |
| Friction | Error, retry, wrong-role attempt, unclear lock, no action. |
| Hint | Hint ID/context/new/repeat. |
| Emotion | `Unknown` trừ khi người chơi tự nói hoặc có self-report. |
| Observer note | Chỉ mô tả hành vi nhìn/nghe được, không diễn giải cảm xúc. |

CSV header dùng ngay:

```csv
timestamp,role,scene_id,activity,available_action_count,input_action,new_information_id,information_source_role,state_version,shared_delta,communication_type,real_decision,objective_text,friction,hint_id,self_report_emotion,observer_note
00:00,INV,scene-1,Navigation/UI,0,login,,,,,None,No,"",,Unknown,""
00:00,INT,scene-1,Navigation/UI,0,login,,,,,None,No,"",,Unknown,""
```

---

# 17. Event/log cần bổ sung để đo tự động

Mọi event dùng monotonic client time + server UTC; không ghi email thật, voice content hoặc PII.

## 17.1 Common envelope

```json
{
  "eventName": "...",
  "sessionId": "playtest-pseudonymous-id",
  "roomId": "audit-room-id",
  "caseId": "case-glasshouse-oath",
  "userId": "pseudonymous-user-id",
  "role": "INVESTIGATOR",
  "sceneId": "scene-1",
  "clientMonotonicMs": 0,
  "serverUtc": "2026-07-18T00:00:00Z",
  "stateVersion": 0,
  "buildId": "local-audit"
}
```

## 17.2 Event list

| Event | Payload tối thiểu | Đo được gì |
|---|---|---|
| `playtest_session_started` | experience level, role assignment, consent flags | Cohort/context. |
| `room_flow_step` | create/join/select_role/ready/start, success, latency | Lobby friction. |
| `scene_entered` | from/to, role, entry reason | Per-role scene timeline. |
| `available_actions_snapshot` | action IDs, locked reasons | Idle/no-action windows. |
| `objective_rendered` | exact text, missing counts, role | Objective-role mismatch. |
| `movement_started/stopped` | position, duration, distance | Walking/searching time. |
| `hotspot_entered/interacted` | hotspot/target, role | Search and missed affordance. |
| `camera_opened/closed` | scene, duration | Camera mode dwell. |
| `camera_capture_attempted` | rect, nearest clue, coverage, result, attempt index | Miss/near-miss/hit and framing difficulty. |
| `clue_unlocked` | clue, source action, source role | First information timing. |
| `shared_state_received` | version, payload bytes, delta field IDs, latency | Full-state frequency/cost. |
| `case_file_opened/closed` | tab, duration, clue count | Whether shared UI replaces talking. |
| `evidence_detail_opened` | clue, role, dwell, reopened | Reading/review behavior. |
| `dialogue_panel_opened` | character, available/locked question IDs | Interrogator agency. |
| `dialogue_question_selected` | dialogue, required clues, scene | Order and early projection. |
| `dialogue_typewriter_skipped` | dialogue, elapsed text ms | Skim/skip signal, not boredom. |
| `dialogue_completed` | dialogue, words, dwell | Reading exposure. |
| `challenge_opened` | challenge, available evidence IDs | Evidence choice surface. |
| `challenge_evidence_selected` | challenge/evidence, attempt, correct | Trial-and-error vs first-pass. |
| `challenge_resolved` | challenge, unlocked clue, source roles | Crack-the-Lie chain completion. |
| `item_inspected/combined/used` | item/target/interaction, result | Inventory flow. |
| `puzzle_opened` | puzzle, locked reasons, reward already unlocked | Meridian redundancy/dead puzzle. |
| `puzzle_attempted` | answer type, attempt, result | Puzzle retries. Không log raw free text nếu có PII risk. |
| `puzzle_became_unreachable` | puzzle, missing consumed item | Runtime content dead-end. |
| `deduction_became_available` | missing-before, source events | Time-to-deduction. |
| `deduction_attempted` | option, attempt, result | Deduction trial behavior. |
| `scene_complete_attempted` | success, missing IDs, role | Objective clarity/gates. |
| `role_idle_started/ended` | available-action count, duration, scene | System-defined idle. Không suy ra boredom. |
| `hint_requested` | hint/context/isNew, time since last state change | Stuck/hint use. |
| `accusation_opened` | available suspects/evidence, role | Final flow entry. |
| `accusation_submitted` | selections, discussion marker, result | Final reasoning outcome. |
| `ui_error` | action, status, error code, correlation ID | Technical friction. |
| `asset_load` | URL category, bytes, duration, cache, status | Scene/popup load. |
| `signalr_state_update` | version, payload bytes, reconnect count, latency | Realtime reliability. |
| `player_self_report` | prompt ID, response, timestamp | Chỉ nguồn hợp lệ cho emotion/tension. |

## 17.3 Derived metrics

- Time-to-first-action và time-to-first-clue theo role.
- Active/idle duration theo role dựa trên available action + input, không dựa trên im lặng.
- Số clue được nói ra trước khi role kia mở Case File — cần manual voice coding hoặc consented transcript.
- Dialogue dwell/word, skip rate, reopen rate.
- First-try challenge/deduction rate.
- Thời gian giữa Investigator clue và Interrogator challenge.
- State payload bytes/update và stale version/reconnect.
- Objective mismatch attempts: role gọi action bị API chặn.
- Puzzle opened sau khi reward đã unlock; unreachable puzzle count.

---

# 18. Case nên playtest trước

## Chọn: Glasshouse Oath

Lý do hoàn toàn dựa trên cấu trúc:

1. **Flow ngắn hơn:** 4 scene thay vì 6; 33 core calls thay vì 43 tối thiểu.
2. **Action balance gần hơn:** Investigator 16, Interrogator 17; Meridian là 25 và 18.
3. **Ít confound mechanic:** không item, puzzle, combine, backtrack hoặc dead optional puzzle.
4. **Có đủ core co-op để test:** 4 scene gate cần cả hai role, 2 evidence challenge, 1 required teamwork chain, 1 final deduction.
5. **Có hypothesis rõ để đo:** Interrogator 0 required action ở scene 3/4 entry; full shared state; `dlg-10` xuất hiện sớm; reading exposure 304–341 từ/scene.
6. **Runtime sạch:** canonical flow hoàn thành, thắng, 0 unexpected API error, không cần bỏ qua một mechanic bị kẹt.

Glass Meridian nên playtest sau khi quyết định rõ ba puzzle là required hay optional, loại reward duplication và sửa lifecycle của `item-meridian-dial`. Nếu playtest ngay, dữ liệu về puzzle payoff sẽ bị trộn với một dependency đã biết là không nhất quán.

Việc Glasshouse có vui hơn, tension tốt hơn hoặc đáng nhớ hơn Meridian không thể kết luận từ audit này. **`Requires human playtest validation`**.

---

# 19. Mức độ tin cậy

| Phần | Độ tin cậy | Lý do |
|---|---|---|
| JSON/asset/content counts | Cao | Đếm trực tiếp từ hai case và asset folder. |
| Role permissions/progression/final reachability | Cao | Full local flow + negative role probes + source contract. |
| Shared-state projection | Cao | Source projection + cross-role observer checks + live lobby realtime. |
| Local API timing | Cao cho máy local này, thấp cho production | Không có network thực. |
| UI clarity risk | Trung bình | UI live đã quan sát; phản ứng người thật chưa có. |
| Waiting/reading/communication risk | Trung bình-thấp | Dependency có thật; duration và cảm giác chưa biết. |
| Fun/tension/surprise/emotional curve | Không đủ bằng chứng | **`Requires human playtest validation`**. |

## Trạng thái cuối audit

- Hai case: structurally reachable và thắng trong local audit.
- Không có kết luận fun verdict.
- Không có emotional curve giả lập.
- Không có dữ liệu production/Atlas.
- **[Đã kiểm chứng]** `sirlocked_game_director_audit` đã được drop trên `mongodb://127.0.0.1:27029`; status check sau drop trả `exists=false`, `atlasTouched=false`.
- **[Đã kiểm chứng]** Cổng audit 5173, 5291 và 27029 đã đóng. Cổng 5290 vẫn giữ nguyên và không bị audit tác động.
- **[Đã kiểm chứng]** Audit/API/Mongo/frontend log không chứa `mongodb+srv`, `mongodb.net`, OpenAI/Google/Cloudinary/SMTP endpoint.
- **[Đã kiểm chứng]** Hai source JSON và hai asset folder không có thay đổi từ audit; thay đổi repository chỉ gồm báo cáo và sơ đồ mới.
