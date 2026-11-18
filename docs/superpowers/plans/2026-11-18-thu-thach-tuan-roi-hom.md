# Thử thách tuần tự xoay vụ và rớt hòm — Kế hoạch làm

> **Cho agent thực hiện:** BẮT BUỘC dùng superpowers:subagent-driven-development (khuyên dùng) hoặc superpowers:executing-plans để làm từng task. Các bước dùng checkbox (`- [ ]`).

**Mục tiêu:** Mỗi tuần (từ 07:00 thứ Tư giờ VN) hệ thống tự bốc một vụ hay làm thử thách. Mỗi tài khoản đã xác minh email phá vụ đó với ≥ 80 điểm và bắt đúng hung thủ thì nhận đúng 1 hòm/tuần, loại hòm quay theo trọng số admin chỉnh được.

**Kiến trúc:**
- Tuần được định danh bằng `ChallengeWeek`, tính theo mốc thứ Tư 00:00 UTC.
- `WeeklyService` ghi một `WeeklyFeature` có `WeekKey` cho mỗi tuần. Unique index chống bốc hai lần. Có worker chạy nền và thêm lần gọi đọc đầu tiên để bảo đảm tuần nào cũng có vụ.
- `WeeklyDropService` (namespace Market) được gọi từ `MarketGameRewardHook` sau khi lưu `GameResult`. Nó ghi `WeeklyDrop` với `_id = "<weekKey>:<userId>"` **trước**, rồi cấp hòm qua `MarketService.GrantItemAsync` (idempotent theo item id). Túi đầy thì hòm chờ người chơi bấm nhận.
- Trọng số rớt nằm ở `CatalogChest.ChallengeWeight`. Giá trị null nghĩa là dùng mặc định theo id hòm.

**Công nghệ:** ASP.NET Core (.NET), MongoDB standalone (không có transaction), xUnit (`src/BE/Tests` cho unit, `src/BE/IntegrationTests` cho Mongo), JS thuần + Vite, Playwright (`src/FE/tests`).

**Spec:** `docs/superpowers/specs/2026-11-18-thu-thach-tuan-roi-hom-design.md` (đọc kèm; mục Y1–Y13 là quyết định của Yen).

## Ràng buộc chung

- Tuần bắt đầu **07:00 thứ Tư giờ VN = 00:00 thứ Tư UTC**. Khóa tuần là `yyyy-MM-dd` của ngày thứ Tư đó, ví dụ `2026-11-18`.
- Ngưỡng nhận hòm: `ScoreSummary.TotalScore >= 80` **và** `Success == true`.
- Mỗi tài khoản tối đa 1 hòm/tuần. Tài khoản phải `IsEmailVerified && Status == Active`, không phải khách. Tác giả vụ (`GameCase.AuthorUserId`) không nhận hòm từ vụ của mình.
- Vụ hay: điểm trung bình ≥ 4.0 với ≥ 5 đánh giá. Chỉ tính đánh giá không `Hidden`, của tài khoản đã xác minh và đang hoạt động, không phải của tác giả. Không trùng vụ của 4 tuần gần nhất. Bốc đều.
- Trọng số mặc định: `chest_np` 60, `chest_sm` 30, `chest_nb` 10, hòm khác 0. Chỉ hòm `Active` với trọng số > 0 mới rớt.
- Không sửa `ChestService.BuyKeyAsync`/`BuyChestAsync`, không sửa `Chests:SellChests`, không sửa `chestPage.js` và trang chợ. Những phần đó thuộc nhánh `feat/kho-ruong-giao-dien`.
- Chữ trên giao diện có VI và EN qua `tr('English', 'Tiếng Việt')`.
- Mọi bước ghi Mongo phải chạy lại được: dùng `_id` chọn trước, bắt `DuplicateKey`, update có điều kiện. Không dùng transaction.
- Commit theo đường dẫn: `git commit -- <paths>`. Message dạng `feat(thu-thach): ...` không dấu, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Làm trong worktree `D:/sl-thu-thach` (nhánh `feat/thu-thach-tuan`).
- Test Mongo cần `SIRLOCKED_RUN_MONGO_IT=true`, `SIRLOCKED_TEST_MONGO` và `SIRLOCKED_TEST_MONGO_CONNECTION_STRING` trỏ tới mongod loopback. Có thể chạy `D:/Sirlocked/.tools/mongodb-8.0.12/mongod.exe` trên một cổng riêng, ví dụ 27031. Nếu thiếu `SIRLOCKED_RUN_MONGO_IT` thì test Mongo tự bỏ qua và **vẫn báo pass**.

## Trọng tâm khi review

1. **Một người chơi xong hai ván thử thách gần như cùng lúc** (hai phòng). Phải ra đúng 1 `WeeklyDrop` và 1 hòm. Test ở Task 6: `Evaluate_TwoQualifyingGamesInParallel_GiveOneChest`.
2. **Ván xong sát mốc tuần** (`CreatedAt` = 2026-11-17T23:59:59Z, thuộc tuần `2026-11-11`) nhưng được đánh giá sau mốc. Phải tính theo vụ của tuần `2026-11-11` và khóa `2026-11-11:<user>`. Test ở Task 6: `Evaluate_UsesTheWeekOfTheResult_NotTheClock`.
3. **`GameResult` được lưu lại lần nữa** (upsert, hook chạy lại, vòng quét chạy lại). Không được ra thêm hòm, số slot vẫn khớp số đồ. Test ở Task 6: `Evaluate_Repeated_GivesOneChest_AndSlotsMatchItems`.
4. **Admin tắt hết hòm hoặc để mọi trọng số bằng 0.** Không lỗi, trạng thái `NO_CHEST`, có log cảnh báo. Trang thử thách hiện "Tuần này chưa có hòm nào rớt". Test ở Task 2 (`Odds_IgnoresInactiveAndZero`) và Task 6 (`Evaluate_NoChestToRoll_ReturnsNoChest`).
5. **Không có vụ chơi được nào**, hoặc vụ đã bốc bị gỡ giữa tuần. `GET challenge` trả `null`, worker không ném lỗi. Test ở Task 5: `Ensure_NoPlayableCase_CreatesNothing`.
6. **Id người chơi là khách** (không phải ObjectId) nằm trong `Players`. Trả `UNVERIFIED`, không ném lỗi parse. Test ở Task 6: `Evaluate_GuestPlayer_IsUnverified`.

---

### Task 1: Tuần thử thách và cài đặt

**Files:**
- Create: `src/BE/Services/Weekly/ChallengeWeek.cs`
- Create: `src/BE/Configurations/WeeklyChallengeSettings.cs`
- Modify: `src/BE/Program.cs` (cạnh dòng `Configure<CaseCatalogSettings>`, khoảng dòng 80)
- Modify: `src/BE/appsettings.json` (thêm section `WeeklyChallenge`)
- Test: `src/BE/Tests/ChallengeWeekTests.cs`

**Interfaces:**
- Produces:
  - `public readonly record struct ChallengeWeek(string Key, DateTime StartUtc, DateTime EndUtc)` (namespace `SirLocked.Api.Services.Weekly`). `EndUtc = StartUtc + 7 ngày`, là mốc loại trừ.
  - `public static ChallengeWeek Containing(DateTime utc)`.
  - `public static ChallengeWeek FromKey(string key)`.
  - `public ChallengeWeek Previous(int weeks = 1)`.
  - `public bool Contains(DateTime utc)`: `StartUtc <= utc < EndUtc`.
  - `public sealed class WeeklyChallengeSettings { bool AutoPick = true; int MinScore = 80; double MinAverageRating = 4.0; int MinReviews = 5; int NoRepeatWeeks = 4; }`, bind section `"WeeklyChallenge"`.

- [ ] **Step 1: Viết test fail**

```csharp
[Theory]
[InlineData("2026-11-18T00:00:00Z", "2026-11-18")]   // thứ Tư 07:00 VN
[InlineData("2026-11-17T23:59:59Z", "2026-11-11")]   // thứ Tư 06:59:59 VN
[InlineData("2026-11-24T16:59:59Z", "2026-11-18")]   // thứ Ba 23:59 VN
[InlineData("2027-01-05T10:00:00Z", "2026-12-30")]   // tuần vắt qua năm
public void Containing_StartsOnWednesdayMidnightUtc(string at, string key)
{
    var week = ChallengeWeek.Containing(DateTime.Parse(at, null, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal));
    Assert.Equal(key, week.Key);
    Assert.Equal(DayOfWeek.Wednesday, week.StartUtc.DayOfWeek);
    Assert.Equal(TimeSpan.Zero, week.StartUtc.TimeOfDay);
    Assert.Equal(week.StartUtc.AddDays(7), week.EndUtc);
    Assert.Equal(DateTimeKind.Utc, week.StartUtc.Kind);
}

[Fact] public void FromKey_RoundTrips() => Assert.Equal(ChallengeWeek.Containing(new DateTime(2026, 11, 20, 3, 0, 0, DateTimeKind.Utc)), ChallengeWeek.FromKey("2026-11-18"));
[Fact] public void Previous_GoesBackWholeWeeks() => Assert.Equal("2026-10-21", ChallengeWeek.FromKey("2026-11-18").Previous(4).Key);
[Fact] public void Contains_EndIsExclusive() { var w = ChallengeWeek.FromKey("2026-11-18"); Assert.True(w.Contains(w.StartUtc)); Assert.False(w.Contains(w.EndUtc)); }
[Fact] public void FromKey_RejectsANonWednesday() => Assert.Throws<ArgumentException>(() => ChallengeWeek.FromKey("2026-11-19"));
```

- [ ] **Step 2: Chạy, thấy fail.** `dotnet test src/BE/Tests/SirLocked.Tests.csproj --filter FullyQualifiedName~ChallengeWeekTests`. Kỳ vọng: lỗi biên dịch, `ChallengeWeek` chưa có.
- [ ] **Step 3: Viết `ChallengeWeek` và `WeeklyChallengeSettings`.** Đăng ký `builder.Services.Configure<WeeklyChallengeSettings>(builder.Configuration.GetSection("WeeklyChallenge"));`. Thêm vào appsettings `"WeeklyChallenge": { "AutoPick": true, "MinScore": 80, "MinAverageRating": 4.0, "MinReviews": 5, "NoRepeatWeeks": 4 }`. Input `Kind` khác Utc thì `ToUniversalTime()` trước khi tính.
- [ ] **Step 4: Chạy lại, thấy pass.** Cùng lệnh, kỳ vọng 8 test PASS.
- [ ] **Step 5: Commit** `feat(thu-thach): tuan thu thach bat dau 7h sang thu Tu gio VN (00:00 UTC), cai dat WeeklyChallenge`.

---

### Task 2: Trọng số rớt của hòm trong catalog

**Files:**
- Modify: `src/BE/Models/Catalog/CatalogModels.cs:66-90` (`CatalogChest`)
- Modify: `src/BE/Services/Market/ChestCatalog.cs` (`ChestDef`)
- Modify: `src/BE/Services/Catalog/CatalogSnapshot.cs:144-164` (`ToChest`)
- Modify: `src/BE/Services/Admin/CatalogRules.cs` (`ValidateChest`)
- Create: `src/BE/Services/Weekly/WeeklyDropRules.cs`
- Test: `src/BE/Tests/WeeklyDropRulesTests.cs`

**Interfaces:**
- Consumes: `IChestRandom.NextInt(int)`, `ChestDef`, `CatalogSnapshot.Chests`.
- Produces:
  - `CatalogChest.ChallengeWeight`: `int?`, null nghĩa là dùng mặc định.
  - `ChestDef.ChallengeWeight`: `int`, là trọng số thực tế. Thêm tham số constructor `int challengeWeight = 0` ở cuối.
  - `WeeklyDropRules.DefaultWeight(string chestId) -> int`: np 60, sm 30, nb 10, còn lại 0.
  - `WeeklyDropRules.EffectiveWeight(CatalogChest chest) -> int`: `chest.ChallengeWeight ?? DefaultWeight(chest.Id)`.
  - `WeeklyDropRules.Odds(IEnumerable<ChestDef> chests) -> IReadOnlyList<WeeklyChestOdds>` với `public sealed record WeeklyChestOdds(ChestDef Chest, decimal Percent)`. Chỉ gồm hòm `Active && ChallengeWeight > 0`, sắp theo `ChallengeWeight` giảm dần rồi theo `Id`. Percent làm tròn 2 chữ số.
  - `WeeklyDropRules.RollChest(IReadOnlyList<WeeklyChestOdds> odds, IChestRandom random) -> ChestDef?`: lấy `ticket = random.NextInt(tổng trọng số)` rồi đi theo thứ tự của `Odds`. Trả null khi danh sách rỗng.
  - `WeeklyDropRules.MaxWeight = 10_000`.

- [ ] **Step 1: Viết test fail**

```csharp
Odds_DefaultsAre60_30_10()                    // seed snapshot (CatalogSeedData.ToSnapshot(new ChestSettings())): np 60.00, sm 30.00, nb 10.00
Odds_IgnoresInactiveAndZero()                 // nb Active=false, sm weight 0 → chỉ np, 100.00
Odds_EmptyWhenNothingDrops()                  // mọi hòm weight 0 → rỗng; RollChest(rỗng) == null
RollChest_FollowsTheWeights()                 // ScriptedRandom(0) → np; (59) → np; (60) → sm; (89) → sm; (90) → nb; (99) → nb
EffectiveWeight_NullUsesDefault_ExplicitWins() // {Id=chest_np, ChallengeWeight=null} → 60; {Id=chest_np, ChallengeWeight=0} → 0; {Id=chest_new, null} → 0
ValidateChest_RejectsNegativeOrHugeChallengeWeight() // -1 và 10_001 → mỗi giá trị đúng 1 violation code WeightInvalid, message chứa "Thử thách tuần"
```

- [ ] **Step 2: Chạy, thấy fail.** `dotnet test src/BE/Tests/SirLocked.Tests.csproj --filter FullyQualifiedName~WeeklyDropRulesTests`.
- [ ] **Step 3: Viết code.**
  - Thêm `public int? ChallengeWeight { get; set; }` vào `CatalogChest`.
  - `ToChest` truyền `WeeklyDropRules.EffectiveWeight(chest)` vào `ChestDef`.
  - `CatalogRules.ValidateChest` thêm violation khi trọng số thực tế < 0 hoặc > `MaxWeight`: `"Trọng số rớt ở Thử thách tuần phải từ 0 đến 10.000."`.
  - Kiểm tra `CatalogSeedData.ToSnapshot` có đi qua `ToChest` không. Nếu không, truyền trọng số mặc định ở đó.
- [ ] **Step 4: Chạy test của task, rồi cả project Tests.** `dotnet test src/BE/Tests/SirLocked.Tests.csproj`. Kỳ vọng: tất cả PASS, không test cũ nào hỏng.
- [ ] **Step 5: Commit** `feat(thu-thach): trong so rot hom o Thu thach tuan (mac dinh 60/30/10, hom tat hoac trong so 0 khong rot)`.

---

### Task 3: Admin hòm chỉnh trọng số Thử thách tuần (server)

**Files:**
- Modify: `src/BE/DTOs/Admin/AdminChestDtos.cs`: `AdminChestRowDto`, `AdminChestDetailDto`, `AdminChestDraftRequest`, `AdminChestVersionDto`
- Modify: `src/BE/Services/Admin/AdminChestsRules.cs`: `Clone`, `Diff`
- Modify: `src/BE/Services/Admin/AdminChestsChestService.cs`: `ListAsync`, `Apply`, `ToDetail`, chỗ tạo hòm mới (khoảng dòng 170), danh sách phiên bản (khoảng dòng 94)
- Test: `src/BE/Tests/AdminChestsRulesTests.cs`, `src/BE/IntegrationTests/MongoAdminChestsTests.cs`

**Interfaces:**
- Consumes: `WeeklyDropRules.EffectiveWeight`, `WeeklyDropRules.MaxWeight` (Task 2).
- Produces:
  - Thêm `int ChallengeWeight, decimal ChallengePercent` vào `AdminChestRowDto` và `AdminChestDetailDto`. Percent tính trên các hòm `Active` có trọng số > 0. Hòm tắt hoặc trọng số 0 thì percent = 0.
  - Thêm `int ChallengeWeight` vào `AdminChestVersionDto`.
  - Thêm `int? ChallengeWeight` vào `AdminChestDraftRequest`. Null thì giữ giá trị cũ, để client cũ không xóa mất.
  - Field diff có tên `"challengeWeight"`.

- [ ] **Step 1: Viết test fail.**
  - Unit `Diff_ReportsChallengeWeight`: trước null với id `chest_np` (thực tế 60), sau 25. Field `challengeWeight` có giá trị "60" thành "25".
  - Unit `Clone_CopiesChallengeWeight`.
  - Mongo `Save_ChallengeWeight_IsStoredAndShownAsPercent`: lưu np = 30. List trả np 30 → 42.86, sm 30 → 42.86, nb 10 → 14.29.
  - Mongo `Save_WithoutChallengeWeight_KeepsIt`.
  - Mongo `NewChest_StartsAtZero`.
- [ ] **Step 2: Chạy, thấy fail.** `dotnet test src/BE/Tests/SirLocked.Tests.csproj --filter FullyQualifiedName~AdminChestsRulesTests`, rồi `dotnet test src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj --filter FullyQualifiedName~MongoAdminChestsTests` với các biến Mongo đã đặt.
- [ ] **Step 3: Viết code.**
  - `Apply`: `after.ChallengeWeight = draft.ChallengeWeight ?? before.ChallengeWeight`.
  - Hòm mới: `ChallengeWeight = 0`.
  - `ListAsync` và `ToDetail` tính percent từ toàn bộ hòm đọc được (`ReadChestsAsync`).
- [ ] **Step 4: Chạy lại hai lệnh trên, cùng `MongoAdminChestsHostTests`.** Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(admin-hom): truong trong so rot o Thu thach tuan, ty le % tren danh sach va chi tiet, lich su sua`.

---

### Task 4: Luật bốc vụ hay (thuần)

**Files:**
- Create: `src/BE/Services/Weekly/ChallengePickRules.cs`
- Test: `src/BE/Tests/ChallengePickRulesTests.cs`

**Interfaces:**
- Consumes: `WeeklyChallengeSettings` (Task 1), `IChestRandom`.
- Produces:
  - `public sealed record ChallengeCandidate(string CaseId, double AverageRating, int ReviewCount)`.
  - `public sealed record ChallengePool(IReadOnlyList<ChallengeCandidate> Cases, int Step)`.
  - `ChallengePickRules.Eligible(IReadOnlyList<ChallengeCandidate> all, IReadOnlyList<string> recentCaseIds, string? lastWeekCaseId, WeeklyChallengeSettings s) -> ChallengePool`. `recentCaseIds` là vụ của `NoRepeatWeeks` tuần trước.
  - `ChallengePickRules.Pick(ChallengePool pool, IChestRandom random) -> ChallengeCandidate?`: sắp `Cases` theo `CaseId` (ordinal) rồi lấy `[random.NextInt(Count)]`. Trả null khi rỗng.

Các bước nới, lấy bước đầu tiên có ít nhất một vụ:

| Step | Điểm tối thiểu | Số đánh giá tối thiểu | Loại trừ |
|---|---|---|---|
| 0 | `MinAverageRating` | `MinReviews` | mọi vụ trong `recentCaseIds` |
| 1 | `MinAverageRating` | `MinReviews` | chỉ `lastWeekCaseId` |
| 2 | `MinAverageRating` | `min(3, MinReviews)` | chỉ `lastWeekCaseId` |
| 3 | `MinAverageRating` | 1 | chỉ `lastWeekCaseId` |
| 4 | 3.5 | 1 | chỉ `lastWeekCaseId` |
| 5 | không | 0 | `lastWeekCaseId`, trừ khi đó là vụ duy nhất. Chỉ giữ các vụ có `AverageRating` cao nhất (vụ chưa có đánh giá tính 0) |

`all` rỗng thì trả `ChallengePool([], 5)`.

- [ ] **Step 1: Viết test fail.** Mỗi bước một test, dùng bộ candidate `A(4.5,6) B(4.2,5) C(3.9,10) D(5.0,2) E(3.6,1) F(0,0)`:
  - `Step0_SkipsRecentWeeks`: recent [A], last A → {B}, step 0.
  - `Step1_AllowsOlderRecent`: recent [A,B], last B → {A}, step 1.
  - `Step2_ThreeReviews`: bỏ A, B khỏi `all`, recent [], last null → rỗng ở step 0–2 vì D chỉ có 2 đánh giá; step 3 → {D}. Viết thêm một case mà step 2 có kết quả: thêm G(4.1,3) → {G}, step 2.
  - `Step4_RelaxesRating`: chỉ có C, E, F → {C, E}, step 4.
  - `Step5_TopRatedWhenNothingElse`: chỉ có F và H(0,0) → {F, H}, step 5. Chỉ có F, last F → {F}.
  - `Pick_IsUniformByIndex`: pool {B, A}, ScriptedRandom(1) → B (vì đã sắp A, B).
  - `Eligible_EmptyInput_GivesEmpty`.
- [ ] **Step 2: Chạy, thấy fail.** `--filter FullyQualifiedName~ChallengePickRulesTests`.
- [ ] **Step 3: Viết `ChallengePickRules`** theo bảng trên.
- [ ] **Step 4: Chạy lại, thấy PASS.**
- [ ] **Step 5: Commit** `feat(thu-thach): luat boc vu hay (4 sao, 5 danh gia, khong trung 4 tuan, noi dan)`.

---

### Task 5: Tự bốc vụ mỗi tuần trong WeeklyService

**Files:**
- Modify: `src/BE/Models/WeeklyFeature.cs`: thêm `string? WeekKey`, `string Source` với hằng `WeeklyFeatureSources.Auto = "AUTO"`, `Admin = "ADMIN"`
- Modify: `src/BE/DataAccess/MongoDbContext.cs:202-208`: thêm index
- Modify: `src/BE/Services/WeeklyService.cs`, `src/BE/Services/Interfaces/IWeeklyService.cs`
- Modify: `src/BE/DTOs/Weekly/*.cs`: `WeeklyFeatureDto` + `WeeklyDropOddsDto`
- Create: `src/BE/Services/Weekly/WeeklyChallengeWorker.cs`
- Modify: `src/BE/Program.cs`: `AddHostedService<WeeklyChallengeWorker>()`
- Test: `src/BE/IntegrationTests/MongoWeeklyChallengeTests.cs` (dựng env giống `MongoChestTests.ChestEnv`, database `sirlocked_it_weekly_<guid>`)

**Interfaces:**
- Consumes: `ChallengeWeek`, `WeeklyChallengeSettings`, `ChallengePickRules`, `WeeklyDropRules.Odds`, `ICatalogProvider`, `IChestRandom`, `CaseCatalogPolicy.IsPlayable`, `TutorialRules.IsTutorialCase`.
- Produces:
  - `IWeeklyService.EnsureChallengeAsync(ChallengeWeek week, CancellationToken ct) -> Task<WeeklyFeature?>`. Trả document có khóa của tuần, tạo mới khi thiếu và `AutoPick` bật. Trả null khi tuần đó đã bị xóa hoặc không có vụ nào.
  - `IWeeklyService.FindChallengeAsync(ChallengeWeek week, CancellationToken ct) -> Task<WeeklyFeature?>`. Chỉ đọc, `IsActive == true`, không tạo mới.
  - `WeeklyFeatureDto` thêm `string? WeekKey`, `string? Source`, `int MinScore`, `List<WeeklyDropOddsDto> Drops` (rỗng với `CASE_OF_WEEK`).
  - `public sealed record WeeklyDropOddsDto(string ChestId, string Name, string NameEn, string IconKey, ChestLookDto? Look, decimal Percent)`.
  - Constructor `WeeklyService(MongoDbContext db, ILeaderboardService leaderboard, CaseCatalogPolicy? catalog = null, IOptions<WeeklyChallengeSettings>? settings = null, ICatalogProvider? chests = null, IChestRandom? random = null, TimeProvider? time = null)`. Các tham số mới đều optional để test cũ không vỡ.
  - Index: `ux_weeklyFeatures_type_weekKey` unique trên `{type: 1, weekKey: 1}`, `PartialFilterExpression = { weekKey: { $type: "string" } }`.

Hành vi:
- **Bốc vụ (`EnsureChallengeAsync`):**
  1. Đọc document theo `(WEEKLY_CHALLENGE, week.Key)`. Có thì trả về: `IsActive` thì trả document, không thì trả null.
  2. Chưa có thì xem có document cũ (không có `WeekKey`) đang active và chứa `now` không. Có thì **nhận lại** vụ đó với `Source = ADMIN`.
  3. Nếu không có thì `AutoPick`:
     - Ứng viên là các vụ `IsPlayable` và không phải màn tân thủ.
     - Điểm sao tính bằng aggregate trên `Reviews` với `!Hidden`, `UserId != AuthorUserId`, user đã xác minh và đang hoạt động.
     - `recentCaseIds` là vụ của `week.Previous(1..NoRepeatWeeks)`. `lastWeekCaseId` là vụ của `Previous(1)`.
  4. Insert document mới. Gặp `DuplicateKey` thì đọc lại document đã thắng.
  5. Log `Information`: tuần, vụ, step nới. Không có vụ nào thì log `Warning` và không insert.
- **`GetActiveChallengeAsync`:**
  - Gọi `EnsureChallengeAsync(ChallengeWeek.Containing(now))`.
  - Vụ không còn chơi được thì trả null, như hiện tại.
  - DTO có `Drops` lấy từ `WeeklyDropRules.Odds` và `MinScore`.
  - `WeekStart = week.StartUtc`, `WeekEnd = week.EndUtc`. Leaderboard dùng đúng khung này.
- **`SetWeeklyFeatureAsync` với `WEEKLY_CHALLENGE`:**
  - Tính `week = Containing(request.WeekStart)`, bỏ qua `WeekEnd`.
  - Upsert document có khóa: `CaseId`, `IsActive = true`, `Source = ADMIN`, khung tuần đã căn mốc.
  - `CASE_OF_WEEK` giữ nguyên code cũ.
- **`ClearWeeklyFeatureAsync` với `WEEKLY_CHALLENGE`:**
  - Upsert document có khóa của tuần hiện tại với `IsActive = false` (giữ `CaseId` nếu có).
  - Đồng thời tắt các document cũ như code hiện tại.
  - Tuần sau worker tự bốc lại.
- **Worker:**
  - `PeriodicTimer` mỗi 5 phút.
  - Mỗi vòng tạo scope, gọi `EnsureChallengeAsync(Containing(now))`.
  - Bắt mọi exception (trừ `OperationCanceledException`) và log `Warning`.

- [ ] **Step 1: Viết test fail (Mongo).**
  - `Ensure_PicksAGoodCase_OncePerWeek`: hai lần gọi song song bằng `Task.WhenAll` → 1 document, cùng `CaseId`.
  - `Ensure_CountsOnlyVerifiedNonAuthorReviews`: vụ X có 5 đánh giá 5 sao nhưng 3 của tài khoản chưa xác minh, vụ Y có 5 đánh giá 4 sao hợp lệ → chọn Y.
  - `Ensure_AvoidsTheLastFourWeeks`.
  - `Ensure_NoPlayableCase_CreatesNothing` → null, 0 document.
  - `Ensure_AdoptsTheLegacyActiveChallenge`.
  - `Clear_StopsThisWeek_NextWeekPicksAgain`: dùng `FakeTimeProvider` hoặc truyền tuần trực tiếp.
  - `Set_SnapsAdminWindowToTheWeek`: `WeekStart` = thứ Sáu → `StartUtc` = thứ Tư trước đó.
  - `GetActive_ReturnsOddsAndMinScore`: Drops np 60, sm 30, nb 10; MinScore 80.
  - Kiểm tra index: tạo index của `MongoDbContext.EnsureIndexesAsync` trên database có sẵn document cũ không có `weekKey` → không lỗi.
- [ ] **Step 2: Chạy, thấy fail.** `dotnet test src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj --filter FullyQualifiedName~MongoWeeklyChallengeTests`.
- [ ] **Step 3: Viết code theo phần Hành vi.** Cập nhật `src/BE/Tests/WeeklyServiceTests.cs` nếu chữ ký thay đổi làm nó vỡ.
- [ ] **Step 4: Chạy lại.** `MongoWeeklyChallengeTests`, `WeeklyServiceTests`, `MongoCaseCatalogTests` (cũng dùng WeeklyService). Thêm một test host (`AiBridgeWorkflowHostTests` hoặc bất kỳ host test nào) để chứng minh DI vẫn dựng được. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(thu-thach): moi tuan tu boc vu hay (worker 5 phut + lan doc dau), admin chon tay hoac xoa theo tuan, tra ty le hom`.

---

### Task 6: Rớt hòm sau ván thử thách

**Files:**
- Create: `src/BE/Models/Market/WeeklyDrop.cs`
- Modify: `src/BE/Models/Market/MarketModels.cs`: `MarketItemSources.Weekly = "WEEKLY"` (không thêm vào `IsEarned`)
- Modify: `src/BE/Services/Market/MarketStore.cs`: collection `weeklyDrops` + index
- Modify: `src/BE/Services/Market/MarketService.Admin.cs:19-34`: tách `GrantItemAsync`
- Modify: `src/BE/Services/Weekly/WeeklyDropRules.cs`: thêm `Ineligibility`
- Create: `src/BE/Services/Market/WeeklyDropService.cs`
- Modify: `src/BE/Services/Market/MarketHosting.cs`: hook, worker, `AddMarket`
- Test: `src/BE/Tests/WeeklyDropRulesTests.cs` (thêm), `src/BE/IntegrationTests/MongoWeeklyDropTests.cs`

**Interfaces:**
- Consumes: `IWeeklyService.FindChallengeAsync` (Task 5), `WeeklyDropRules.Odds/RollChest` (Task 2), `ChallengeWeek`, `WeeklyChallengeSettings`.
- Produces:
  - `WeeklyDrop { [BsonId] string Id; string UserId; string WeekKey; string CaseId; string RoomId; string ChestDefId; string ItemId; string State; DateTime CreatedAt; DateTime UpdatedAt; DateTime? DeliveredAt; }`.
  - `WeeklyDropStates`: `PENDING` (đã quay, chưa giao), `WAITING` (túi đầy), `DONE`.
  - `WeeklyDrop.IdOf(string weekKey, string userId) => $"{weekKey}:{userId}"`.
  - Index: `{userId: 1, state: 1}` và `{state: 1, updatedAt: 1}`.
  - `MarketService.GrantItemAsync(string userId, string defId, string itemId, string source, string opKey, CancellationToken ct) -> Task<bool>` (internal). `AdminGrantItemAsync` gọi lại hàm này với `MarketItemSources.Grant` và `AdminGrantOpKey(itemId)`.
  - `WeeklyDropStatuses`: `GRANTED, WAITING, NOT_CHALLENGE, LOW_SCORE, NOT_SOLVED, AUTHOR, UNVERIFIED, ALREADY_THIS_WEEK, NO_CHEST`.
  - `WeeklyDropRules.Ineligibility(GameResult result, string userId, string? authorUserId, bool verifiedActive, int minScore) -> string?`. Thứ tự kiểm: `LOW_SCORE` (`ScoreSummary` null hoặc dưới ngưỡng), `NOT_SOLVED`, `AUTHOR`, `UNVERIFIED`. Trả null khi đủ điều kiện.
  - `WeeklyDropService.EvaluatePlayerAsync(GameResult result, string userId, CancellationToken ct) -> Task<string>`: trả một `WeeklyDropStatuses`.
  - `WeeklyDropService.EvaluateAsync(GameResult result, CancellationToken ct) -> Task`: chạy cho mọi người chơi khác rỗng, distinct.
  - `WeeklyDropService.RecoverAsync(TimeSpan staleAfter, CancellationToken ct) -> Task<int>`.

`EvaluatePlayerAsync`:
1. `week = ChallengeWeek.Containing(result.CreatedAt)`. `challenge = FindChallengeAsync(week)` (tuần hiện tại thì dùng `EnsureChallengeAsync`). Thiếu, hoặc `challenge.CaseId != result.CaseId` → `NOT_CHALLENGE`.
2. Đọc drop theo `IdOf(week.Key, userId)`:
   - Đã có và `RoomId == result.RoomId` thì đẩy tiếp (bước 6) rồi trả `GRANTED` hoặc `WAITING`.
   - Đã có với phòng khác thì trả `ALREADY_THIS_WEEK`.
3. Lấy `authorUserId` từ `Cases`. Lấy `verifiedActive`: id không phải ObjectId thì false, không query. Gọi `Ineligibility`, có lý do thì trả lý do.
4. `odds = Odds(catalog.Chests)`, `chest = RollChest(...)`. Null thì log `Warning` và trả `NO_CHEST`.
5. Insert `WeeklyDrop { State = PENDING, ItemId = MarketStore.NewId(), ... }`. Gặp `DuplicateKey` thì quay lại bước 2.
6. Đẩy tiếp: `GrantItemAsync(userId, ChestDefId, ItemId, Weekly, $"weekly:{Id}")`.
   - true → `State = DONE`, `DeliveredAt = now`.
   - false → `State = WAITING`. Update có điều kiện `State != DONE`.

`RecoverAsync`:
- Đẩy tiếp các drop `PENDING` có `UpdatedAt < now - staleAfter` (giới hạn 200).
- Tìm `GameResults` trong 48 giờ qua, `CreatedAt < cutoff`, `Success == true`, `ScoreSummary.TotalScore >= MinScore` (giới hạn 500). Bỏ những người đã có drop của tuần đó. Gọi `EvaluatePlayerAsync` cho người còn lại.

Hook:
- `MarketGameRewardHook.OnGameResultPersistedAsync` gọi `_drops.EvaluateAsync(result)` sau phần thưởng xu, trong `try/catch` riêng, log `Error`.
- `MarketMaintenanceWorker` gọi `WeeklyDropService.RecoverAsync(StaleAfter)` cùng vòng quét.
- `AddMarket` đăng ký `AddScoped<WeeklyDropService>()`.

- [ ] **Step 1: Viết test fail.**
  - Unit `Ineligibility_*`: 79/true → LOW_SCORE; 80/false → NOT_SOLVED; 85/true với user là tác giả → AUTHOR; 85/true chưa xác minh → UNVERIFIED; 80/true đủ điều kiện → null; `ScoreSummary` null → LOW_SCORE.
  - Mongo `Evaluate_QualifyingGame_GivesOneChestInTheBag`: ScriptedRandom(95) → `chest_nb`. Item `Source == WEEKLY`, `OwnerId` đúng, `AssertSlotsMatchItemsAsync`.
  - Mongo `Evaluate_Repeated_GivesOneChest_AndSlotsMatchItems`: gọi 3 lần, cộng `RecoverAsync(TimeSpan.Zero)`.
  - Mongo `Evaluate_TwoQualifyingGamesInParallel_GiveOneChest`: hai phòng, `Task.WhenAll` → 1 drop. Phòng thứ hai trả `ALREADY_THIS_WEEK`.
  - Mongo `Evaluate_UsesTheWeekOfTheResult_NotTheClock`: tuần `2026-11-11` có vụ P, tuần `2026-11-18` có vụ Q. Result vụ P với `CreatedAt` 2026-11-17T23:59:59Z → drop id `2026-11-11:<user>`.
  - Mongo `Evaluate_OtherCase_IsNotChallenge`.
  - Mongo `Evaluate_GuestPlayer_IsUnverified`: id `guest-abc`.
  - Mongo `Evaluate_FullBag_Waits_ThenGrantsWhenRoom` (phần claim kiểm ở Task 7; ở đây chỉ kiểm `State == WAITING` và không có item).
  - Mongo `Evaluate_NoChestToRoll_ReturnsNoChest`.
  - Mongo `Recover_FindsAResultWhoseHookNeverRan`.
  - Mongo `Evaluate_EachTeammateRollsOwnChest`: hai người chơi một phòng → 2 drop.
- [ ] **Step 2: Chạy, thấy fail.** Unit `--filter FullyQualifiedName~WeeklyDropRulesTests`. Mongo `--filter FullyQualifiedName~MongoWeeklyDropTests`.
- [ ] **Step 3: Viết code theo các phần ở trên.**
- [ ] **Step 4: Chạy lại.** Hai lệnh trên cùng `MongoChestTests`, `MongoMarketTests`, `MongoAdminChestsTests`, `MongoAccusationConsensusTests` để chắc `GrantItemAsync` và hook không làm vỡ phần cũ. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(thu-thach): dat 80 diem va bat dung hung thu thi rot 1 hom moi tuan (tai khoan da xac minh, tac gia khong nhan), tui day thi cho nhan, vong quet hoi phuc`.

---

### Task 7: API phần thưởng tuần (xem và nhận hòm)

**Files:**
- Create: `src/BE/DTOs/Weekly/WeeklyDropDtos.cs`
- Modify: `src/BE/Services/Market/WeeklyDropService.cs`
- Modify: `src/BE/WebAPI/Controllers/WeeklyController.cs`
- Test: `src/BE/IntegrationTests/MongoWeeklyDropTests.cs` (thêm)

**Interfaces:**
- Consumes: `WeeklyDropService` (Task 6), `ChestDef`, `ChestLookDto`.
- Produces (JSON camelCase):
  - `public sealed record WeeklyDropDto(string Id, string WeekKey, string ChestId, string ChestName, string ChestNameEn, string IconKey, ChestLookDto? Look, string State, DateTime CreatedAt)`.
  - `public sealed record WeeklyDropStatusDto(string Status, WeeklyDropDto? Drop, int MinScore)`.
  - `public sealed record WeeklyRewardDto(string WeekKey, int MinScore, WeeklyDropDto? ThisWeek, IReadOnlyList<WeeklyDropDto> Waiting)`.
  - `WeeklyDropService.GetForRoomAsync(string userId, string roomId, ct) -> WeeklyDropStatusDto`:
    - Không có result, hoặc user không có trong `Players` → `NOT_CHALLENGE`.
    - Có thì gọi `EvaluatePlayerAsync` (idempotent) rồi dựng DTO.
  - `WeeklyDropService.GetMineAsync(string userId, ct) -> WeeklyRewardDto`: drop của tuần hiện tại, cộng mọi drop `WAITING` của user, mới nhất trước.
  - `WeeklyDropService.ClaimAsync(CurrentUser user, string dropId, ct) -> WeeklyDropDto`:
    - Không thuộc user → 404 `WEEKLY_DROP_NOT_FOUND`.
    - Đã `DONE` → trả luôn.
    - Đang `WAITING` thì đẩy tiếp. Vẫn đầy thì 409 `SLOTS_FULL` (dùng `MarketService.Error`).
  - Route, tất cả `[Authorize]`, đặt trong `WeeklyController`:
    - `GET api/workshop/weekly/challenge/reward`
    - `GET api/workshop/weekly/challenge/reward/{roomId}`
    - `POST api/workshop/weekly/challenge/reward/{dropId}/claim`
    - `GET challenge` vẫn `[AllowAnonymous]`.

- [ ] **Step 1: Viết test fail (Mongo, gọi thẳng service).**
  - `Claim_AfterMakingRoom_GivesTheSameChest`: túi đầy → WAITING. Gỡ 1 món → claim → DONE, `ItemId` đúng như lúc quay. Claim lần nữa vẫn trả DONE, không thêm item.
  - `Claim_StillFull_Returns409SlotsFull`.
  - `Claim_SomeoneElsesDrop_Returns404`.
  - `GetForRoom_ReportsEachStatus`: GRANTED, LOW_SCORE, NOT_SOLVED, ALREADY_THIS_WEEK.
  - `GetMine_ListsWaitingFromLastWeek`: drop WAITING tuần trước vẫn có trong `Waiting`.
- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Viết DTO, method service và route.**
- [ ] **Step 4: Chạy lại `MongoWeeklyDropTests`, rồi build cả solution.** `dotnet build src/BE/SirLocked.Api.csproj`. Kỳ vọng: PASS, 0 lỗi.
- [ ] **Step 5: Commit** `feat(thu-thach): API xem phan thuong tuan, trang thai theo van, nhan hom dang cho`.

---

### Task 8: Admin hòm — ô trọng số Thử thách tuần (giao diện)

**Files:**
- Modify: `src/FE/Client/js/pages/admin/chests/chestDraft.js`: `draftOf` thêm `challengeWeight: chest.challengeWeight ?? 0`
- Modify: `src/FE/Client/js/pages/admin/chests/chestDetail.js`:
  - Thêm ô số `challengeWeight` cạnh `sortOrder`, nhãn `Trọng số rớt ở Thử thách tuần`, `min="0" max="10000" step="1"`.
  - Dòng gợi ý dưới ô: `Hiện chiếm {percent}% số hòm rớt ở Thử thách tuần. 0 = không rớt.`
  - Handler input số đối xử `challengeWeight` giống `sortOrder`.
  - Bảng nhãn field (dòng 27) thêm `challengeWeight: 'Trọng số Thử thách tuần'`.
  - Tóm tắt phiên bản (dòng 458) thêm ` · thử thách ${version.challengeWeight}`.
- Modify: `src/FE/Client/js/pages/admin/chests/chestList.js`: mỗi hàng thêm nhãn `Thử thách tuần: {challengePercent}%`, hoặc `Không rớt` khi bằng 0
- Test: `src/FE/tests/admin-chests/admin-pages.spec.ts` (thêm test)

**Interfaces:**
- Consumes: các trường `challengeWeight`, `challengePercent` trong row, detail và version của Task 3. Draft gửi `challengeWeight`.

- [ ] **Step 1: Viết test fail.**
  - Mock row và detail `chest_np` có `challengeWeight: 60, challengePercent: 60`.
  - Danh sách hiện `Thử thách tuần: 60%`.
  - Trang chi tiết có ô giá trị `60`. Đổi thành `25` rồi lưu → body PUT/POST lưu có `challengeWeight: 25`.
  - Hòm `challengeWeight: 0` hiện `Không rớt`.
- [ ] **Step 2: Chạy, thấy fail.** Trong `src/FE`: `SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5181 node tests/run-ui-smoke.mjs tests/admin-chests/admin-pages.spec.ts --trace=off`. Không có backend sau Vite.
- [ ] **Step 3: Viết code.**
- [ ] **Step 4: Chạy lại, thấy PASS** (cả các test cũ trong file).
- [ ] **Step 5: Commit** `feat(admin-hom): o trong so rot o Thu thach tuan va ty le tren danh sach hom`.

---

### Task 9: Trang Thử thách tuần — khối "Phần thưởng tuần này"

**Files:**
- Modify: `src/FE/Client/js/api/weeklyApi.js`: thêm `reward: () => get('/api/workshop/weekly/challenge/reward')`, `rewardForRoom: (roomId) => get(\`/api/workshop/weekly/challenge/reward/${encodeURIComponent(roomId)}\`)`, `claim: (dropId) => apiFetch('POST', \`/api/workshop/weekly/challenge/reward/${encodeURIComponent(dropId)}/claim\`)`
- Create: `src/FE/Client/js/pages/workshop/weeklyRewardBox.js`
- Modify: `src/FE/Client/js/pages/challengePage.js`: chèn hộp phần thưởng vào `pageHtml` cạnh đồng hồ, mount sau `render`
- Modify: `src/FE/css/34-bpa-workshop.css`
- Test: `src/FE/tests/weekly-challenge-reward.spec.ts`

**Interfaces:**
- Consumes: `challenge.drops[]`, `challenge.minScore`, `challenge.weekKey` (Task 5). `weeklyApi.reward()` và `weeklyApi.claim()` trả `WeeklyRewardDto` và `WeeklyDropDto` (Task 7).
- Produces:
  - `export function weeklyRewardBoxHtml(challenge) -> string`.
  - `export async function mountWeeklyRewardBox(container, { signal }) -> void`: gọi `reward()` khi `session.user()` có. Khách thì giữ khối tĩnh, thêm dòng "Đăng nhập để nhận hòm".

Nội dung (chuỗi VI cố định, EN tương đương):
- Tiêu đề `Phần thưởng tuần này` / `This week's reward`.
- Dòng luật `Đạt từ {minScore} điểm và phá được vụ: nhận 1 hòm (mỗi tuần 1 lần).`
- Danh sách hòm: icon, tên, `{percent}%`. Icon dùng helper sprite hòm mà `pages/market/marketKit.js` đang dùng.
- `drops` rỗng: `Tuần này chưa có hòm nào rớt.`
- Trạng thái của người xem:
  - `ThisWeek` là `DONE`: `Đã nhận: {tên hòm}`.
  - `ThisWeek` là `WAITING`: `Túi đầy — dọn túi rồi bấm Nhận hòm`.
  - Không có: `Chưa nhận`.
- Mỗi drop `WAITING` có nút `Nhận hòm`. Bấm thì gọi `claim`.
  - Thành công: đổi thành `Đã nhận`.
  - Lỗi `SLOTS_FULL`: `Túi vẫn đầy.`
- Link `Xem đồ trong hòm ở Kho Rương` tới `/kho-ruong`.

- [ ] **Step 1: Viết test fail.** Mock `GET /api/workshop/weekly/challenge` (drops 60/30/10, minScore 80), `.../challenge/leaderboard`, `.../challenge/reward`. Các trường hợp:
  - Khách thấy ba hòm với `60%`, `30%`, `10%` và dòng "Đăng nhập để nhận hòm".
  - Người đăng nhập có `thisWeek.state = DONE` thấy "Đã nhận: Két Nhà Băng".
  - Có một drop `WAITING`: bấm "Nhận hòm" → POST claim được gọi đúng id → hiện "Đã nhận". Lần hai mock 409 `SLOTS_FULL` → hiện "Túi vẫn đầy".
  - `drops: []` → "Tuần này chưa có hòm nào rớt".
  - Ở độ rộng 390px không có cuộn ngang.

  Route chặn bằng `url.pathname.startsWith('/api/')`.
- [ ] **Step 2: Chạy, thấy fail.** `SIRLOCKED_PLAYWRIGHT_BASE_URL=http://127.0.0.1:5181 node tests/run-ui-smoke.mjs tests/weekly-challenge-reward.spec.ts --trace=off`.
- [ ] **Step 3: Viết code.** Đồng hồ vẫn đếm về `challenge.weekEnd`, server đã trả mốc thứ Tư. Giữ `isoWeek(challenge.weekStart)` cho nhãn số tuần: `weekStart` luôn là thứ Tư nên mỗi tuần thử thách có đúng một số. Đây là lệch nhẹ khỏi mục 7.5 của spec, không đổi hành vi người chơi thấy.
- [ ] **Step 4: Chạy lại spec này và spec trang thử thách hiện có (nếu có), thấy PASS.**
- [ ] **Step 5: Commit** `feat(thu-thach): khoi Phan thuong tuan nay tren trang thu thach (ty le hom, trang thai, nhan hom dang cho)`.

---

### Task 10: Trang kết quả — báo hòm thử thách

**Files:**
- Create: `src/FE/Client/js/components/weeklyDropNotice.js`
- Modify: `src/FE/Client/js/pages/resultPage.js`: thêm `<div class="bpa-weekly-drop" data-weekly-drop hidden></div>` gần chip phần thưởng (dòng 440). Gọi `hydrateWeeklyDrop(el, roomId)` cạnh `hydrateRewardChip` (dòng 451), trừ khi là `tutorial` hoặc `playtest`.
- Modify: `src/FE/css/35-bpa-result.css`
- Test: `src/FE/tests/weekly-challenge-reward.spec.ts` (thêm)

**Interfaces:**
- Consumes: `weeklyApi.rewardForRoom(roomId)` trả `WeeklyDropStatusDto` (Task 7).
- Produces: `export async function hydrateWeeklyDrop(container, roomId) -> void`. Nuốt mọi lỗi mạng giống `hydrateRewardChip`.

Nội dung theo status (VI cố định, EN tương đương):

| Status | Hiện |
|---|---|
| `GRANTED` | `Thử thách tuần: bạn nhận được {tên hòm}!` + nút `Mở ở Kho Rương` → `/kho-ruong` |
| `WAITING` | `Thử thách tuần: túi đầy, {tên hòm} đang chờ ở trang Thử thách tuần.` + link `/workshop/challenge` |
| `LOW_SCORE` | `Cần {minScore} điểm để nhận hòm Thử thách tuần.` |
| `NOT_SOLVED` | `Phải phá được vụ mới nhận hòm Thử thách tuần.` |
| `UNVERIFIED` | `Xác minh email để nhận hòm Thử thách tuần.` |
| `AUTHOR` | `Tác giả không nhận hòm từ vụ của mình.` |
| `ALREADY_THIS_WEEK` | `Bạn đã nhận hòm Thử thách tuần này.` |
| `NOT_CHALLENGE`, `NO_CHEST` | giữ `hidden` |

- [ ] **Step 1: Viết test fail.**
  - Mock `GET /api/rooms/.../result` (hoặc đúng endpoint mà `gameApi.result` gọi) và `.../challenge/reward/{roomId}`.
  - Mỗi status một test, kiểm đúng câu và link.
  - `NOT_CHALLENGE` → phần tử vẫn `hidden`.
  - Phòng tân thủ (`caseId = TUTORIAL_CASE_ID`) → không gọi endpoint reward.
- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Viết code.**
- [ ] **Step 4: Chạy lại spec, cùng các spec trang kết quả hiện có (`grep -l "/result/" tests/*.spec.ts`), thấy PASS.**
- [ ] **Step 5: Commit** `feat(thu-thach): trang ket qua bao hom Thu thach tuan theo tung truong hop`.

---

### Task 11: Kiểm tra toàn nhánh

- [ ] **Step 1:** `dotnet test src/BE/Tests/SirLocked.Tests.csproj`. Kỳ vọng: 0 failed.
- [ ] **Step 2:** `dotnet test src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj` với `SIRLOCKED_RUN_MONGO_IT=true` và hai biến Mongo. Kỳ vọng: 0 failed. Ghi số test đã chạy thật, không tính test bị bỏ qua.
- [ ] **Step 3:** `cd src/FE && npx tsc --noEmit -p .` (nếu project có tsconfig) và `npm run build`. Kỳ vọng: không lỗi.
- [ ] **Step 4:** Chạy các spec FE đã sửa, cùng `tests/admin-chests/*.spec.ts`, `tests/chest-page.spec.ts`, `tests/clean-urls.spec.ts`, với `--trace=off`. Kỳ vọng: PASS. Spec nào fail thì chạy lại trên commit gốc 6f18f8f trước khi kết luận là lỗi mới.
- [ ] **Step 5:** Cập nhật memory dự án (file mới `thu-thach-tuan-status.md` + một dòng trong `MEMORY.md`): nhánh, commit, việc còn chờ Yen (gộp sau `feat/kho-ruong-giao-dien`, deploy, thử với tài khoản thật).
