# Form đặt vụ mới và pipeline theo mức độ (OPEN_COOP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi đơn mới chọn một mức Dễ / Trung bình / Khó trên form một trang (bố cục A), và pipeline AI dựng vụ `OPEN_COOP` đúng cỡ của mức đó, có câu đố tương tác phụ, bảng Hồ sơ vụ án, dòng thời gian (mức Trung bình, Khó) và cảnh mở đầu tự tạo.

**Architecture:** Một bảng `AiDifficultyProfiles` trên server là nguồn số duy nhất. Bản nháp mới mang `PipelineVersion = "OPEN_COOP_1"`; `AiGenerationContract.For(settings)`, ngân sách sự thật và số nghi phạm đọc bảng đó khi có cờ này, còn bản nháp cũ (không cờ) đi đường cũ nguyên vẹn. Bước chiếu lối chơi dựng một chặng chứa mọi cảnh, gắn `ruleSet = OPEN_COOP`, tạo ô câu đố `INTERACTIVE_PUZZLE` tùy chọn; AI viết `kind` và phần chữ, server hoàn thiện bằng `PuzzleKindRegistry`. Form lấy bảng qua `capabilities`.

**Tech Stack:** ASP.NET Core 9 + MongoDB (`src/BE`), xUnit (`src/BE/Tests`, `src/BE/IntegrationTests`), frontend JS + Playwright (`src/FE`), MCP studio Node 22 (`tools/studio-mcp`).

**Spec:** `docs/superpowers/specs/2026-11-19-pipeline-muc-do-open-coop-design.md` (bản phác form: `.superpowers/brainstorm/1563-1795020811/content/form-layout.html`, bố cục A).

## Global Constraints

- Nhánh mới `feature/pipeline-muc-do` tách từ `origin/feature/kiet-auth-validation`; mang theo các thay đổi chưa commit đang có trong cây làm việc (`tools/studio-mcp` `asset_download`, `pixellab_character_zip`; luật 9 trong `.claude/skills/tao-vu-an/SKILL.md`).
- Bản nháp không có `PipelineVersion` (mọi bản nháp tạo trước đợt này, kể cả "Toa cáp treo trống") đi đường cũ, không đổi hành vi, không bị chuyển đổi.
- Mức độ: `easy | medium | hard`; "Thiên về": `BALANCED | PUZZLE | DIALOGUE`.
- Bảng số (spec mục 1, đã duyệt): thời gian 10–15 / 20–30 / 40–60 phút (`estimatedMinutes` 12 / 25 / 50); cảnh 2–3 / 4–5 / 6–8; nghi phạm 3 / 4 / 5; đối chất 1 / 2 / 3; câu đố phụ 1–2 / 2–3 / 4–6; chứng cứ gây nhiễu 0–1 / 1–2 / 2–3; chứng cứ cần để buộc tội 2 / 3 / 4 (mức Khó có ít nhất một suy luận nối); gợi ý 3 / 3 / 2 mức cho mỗi cảnh, câu đố, đối chất; độ khó câu đố EASY / NORMAL / HARD.
- Câu đố trong pipeline mới luôn `type = INTERACTIVE_PUZZLE`, `progressionRole = OPTIONAL`, không lặp `kind` trong một vụ; chứng cứ chỉ có được từ câu đố không được là chứng cứ duy nhất của điều kiện buộc tội.
- `fingerprint`, `doc_forgery`, `parallax_code` lấy đáp án từ sự thật đã duyệt, không để AI bịa.
- Form: một cột, token `--adm-*` của `css/60-admin-theme.css`, tiêu đề `--adm-display`; song ngữ qua `tr()`; không còn nút V3 Crack, ô số chặng / số nghi phạm / thời lượng, 6 kiểu đơn.
- Không bao giờ in, ghi hay commit khóa bridge / PixelLab. Không deploy, không push khi chủ dự án chưa bảo.

## Review Focus

1. Client cũ (tab admin chưa tải lại) gửi `stageCount: 6`, `generationPreset: "CRACK_THE_LIE_V3"`, `includeCrackTheLie: false`, `order.suspectCount: 6`, `order.playMinutes: 45`: phải ra bản nháp `OPEN_COOP_1` theo mức đã gửi, không 400, không áp preset cũ. → test ở Task 2.
2. Sự thật mức Khó chỉ có 4 địa điểm (dưới 6 cảnh tối thiểu): phải dừng ở bước sự thật với lỗi nói rõ "mức Khó cần 6–8 địa điểm", không vỡ ở bước chiếu. → test ở Task 5.
3. Sự thật không có dữ kiện hợp cho `fingerprint` / `doc_forgery` / `parallax_code`, mà AI vẫn chọn loại đó: bị từ chối với lời nhắn chọn loại khác, không sinh câu đố sai. → test ở Task 8.
4. Bản nháp cũ đang ở bước chiếu hoặc nhập vụ sau khi deploy: dựng nhiều chặng như cũ, nhập vụ không tự tạo cảnh mở đầu. → test ở Task 6 và Task 11.
5. Form trên màn 375 px và chỉ dùng bàn phím: chọn được mức, thế giới, chip, mở "Tùy chọn thêm", gửi được đơn. → test ở Task 3.

---

### Task 1: Hồ sơ mức độ và cờ pipeline mới

**Files:**
- Create: `src/BE/Services/AiDifficultyProfiles.cs`
- Modify: `src/BE/Models/AiCaseDraft.cs` (`AiDraftSettings`, khoảng dòng 376), `.gitignore`
- Test: `src/BE/Tests/AiDifficultyProfilesTests.cs`

**Interfaces:**
- Produces:
  - `public static class AiPipelineVersions { public const string OpenCoop1 = "OPEN_COOP_1"; public static bool IsOpenCoop(AiDraftSettings s); }`
  - `public static class AiCaseLeanings { Balanced = "BALANCED", Puzzle = "PUZZLE", Dialogue = "DIALOGUE"; IReadOnlyList<string> All; string Normalize(string?) }` (rỗng → BALANCED, giá trị lạ → `ApiException.BadRequest` mã `AI_ORDER_INVALID`, field `leaning`)
  - `public sealed record IntRange(int Min, int Max);`
  - `public sealed record AiDifficultyProfile(string Difficulty, IntRange PlayMinutes, int EstimatedMinutes, IntRange Scenes, int Suspects, IntRange Characters, IntRange Clues, IntRange Dialogues, int Cracks, int Deductions, int TeamworkChains, IntRange Puzzles, IntRange Interactions, IntRange RedHerrings, int RequiredEvidence, int HintLevels, string PuzzleDifficulty, IntRange TimelineEvents, int MinConversationCharacters, IntRange PixelLabNewWorld, IntRange PixelLabLibraryWorld);`
  - `public static class AiDifficultyProfiles { IReadOnlyList<AiDifficultyProfile> All; AiDifficultyProfile For(string? difficulty); int PuzzleCount(AiDifficultyProfile p, string leaning); int ConversationCharacters(AiDifficultyProfile p, string leaning); AiGenerationContract Contract(AiDifficultyProfile p, string leaning); }` — `For` nhận hoa/thường, rỗng → `medium`, lạ → `ApiException.BadRequest` field `difficulty`.
  - `AiDraftSettings.PipelineVersion` (string, mặc định `""`), `AiDraftSettings.Leaning` (string, mặc định `""`).

Giá trị bảng (spec mục 1 + các số Claude đặt, ghi lại ở "Rulings"):

| field | easy | medium | hard |
|---|---|---|---|
| PlayMinutes / EstimatedMinutes | 10–15 / 12 | 20–30 / 25 | 40–60 / 50 |
| Scenes | 2–3 | 4–5 | 6–8 |
| Suspects | 3 | 4 | 5 |
| Characters | 4–6 | 5–7 | 6–8 |
| Clues | 6–10 | 10–14 | 15–22 |
| Dialogues | 4–8 | 8–12 | 12–18 |
| Cracks / Deductions / TeamworkChains | 1 / 0 / 0 | 2 / 1 / 1 | 3 / 2 / 1 |
| Puzzles | 1–2 | 2–3 | 4–6 |
| Interactions | 0–1 | 1–2 | 2–3 |
| RedHerrings | 0–1 | 1–2 | 2–3 |
| RequiredEvidence / HintLevels / PuzzleDifficulty | 2 / 3 / EASY | 3 / 3 / NORMAL | 4 / 2 / HARD |
| TimelineEvents | 0–0 | 5–6 | 7–9 |
| MinConversationCharacters | 1 | 2 | 3 |
| PixelLab (thế giới mới / thế giới có thư viện) | 60–120 / 10–40 | 150–220 / 30–80 | 300–450 / 60–150 |

`PuzzleCount`: BALANCED / PUZZLE / DIALOGUE = easy 1 / 2 / 1, medium 2 / 3 / 2, hard 5 / 6 / 4. `ConversationCharacters`: DIALOGUE thì +1, còn lại bằng `MinConversationCharacters`. `Contract` trả `AiGenerationContract(MinStages: 1, MaxStages: 1, Scenes.Min, Scenes.Max, Characters.Min, Characters.Max, Clues.Min, Clues.Max, Dialogues.Min, Dialogues.Max, EvidenceChallenges: Cracks, Deductions, TeamworkChains, MinPuzzles: PuzzleCount, MaxPuzzles: PuzzleCount, Interactions.Min, Interactions.Max, ConversationCharacters, MaxEvidenceChallenges: Cracks)`.

- [ ] **Step 0: Tạo nhánh và bỏ qua `.superpowers/`**

```bash
git fetch origin
git switch -c feature/pipeline-muc-do origin/feature/kiet-auth-validation
printf '\n.superpowers/\n' >> .gitignore
git status --short
```
Expected: `M .gitignore`, các file `tools/studio-mcp/...` và `.claude/skills/tao-vu-an/SKILL.md` vẫn hiện (theo sang nhánh mới), không xung đột.

- [ ] **Step 1: Viết test hỏng**

```csharp
public class AiDifficultyProfilesTests
{
    [Theory]
    [InlineData("easy", 2, 3, 3, 1, 12)]
    [InlineData("MEDIUM", 4, 5, 4, 2, 25)]
    [InlineData("hard", 6, 8, 5, 3, 50)]
    public void For_ReturnsApprovedNumbers(string level, int minScenes, int maxScenes, int suspects, int cracks, int minutes)
    {
        var p = AiDifficultyProfiles.For(level);
        Assert.Equal(new IntRange(minScenes, maxScenes), p.Scenes);
        Assert.Equal(suspects, p.Suspects);
        Assert.Equal(cracks, p.Cracks);
        Assert.Equal(minutes, p.EstimatedMinutes);
    }

    [Fact] public void For_EmptyMeansMedium() => Assert.Equal("medium", AiDifficultyProfiles.For("").Difficulty);
    [Fact] public void For_UnknownLevel_Throws() =>
        Assert.Equal("order.difficulty", Assert.Throws<ApiException>(() => AiDifficultyProfiles.For("insane")).Details!.Field);

    [Theory]
    [InlineData("easy", "BALANCED", 1)] [InlineData("easy", "PUZZLE", 2)]
    [InlineData("medium", "DIALOGUE", 2)] [InlineData("hard", "PUZZLE", 6)] [InlineData("hard", "DIALOGUE", 4)]
    public void PuzzleCount_StaysInsideTheLevel(string level, string leaning, int expected)
    {
        var p = AiDifficultyProfiles.For(level);
        var count = AiDifficultyProfiles.PuzzleCount(p, leaning);
        Assert.Equal(expected, count);
        Assert.InRange(count, p.Puzzles.Min, p.Puzzles.Max);
    }

    [Fact]
    public void Contract_IsOneStageWithExactCracks()
    {
        var c = AiDifficultyProfiles.Contract(AiDifficultyProfiles.For("hard"), AiCaseLeanings.Balanced);
        Assert.Equal((1, 1), (c.MinStages, c.MaxStages));
        Assert.Equal((6, 8), (c.MinScenes, c.MaxScenes));
        Assert.Equal((3, 3), (c.EvidenceChallenges, c.MaxEvidenceChallenges));
        Assert.Equal((5, 5), (c.MinPuzzles, c.MaxPuzzles));
    }

    [Fact]
    public void IsOpenCoop_OnlyForTheNewPipeline()
    {
        Assert.False(AiPipelineVersions.IsOpenCoop(new AiDraftSettings()));
        Assert.True(AiPipelineVersions.IsOpenCoop(new AiDraftSettings { PipelineVersion = "OPEN_COOP_1" }));
    }
}
```

- [ ] **Step 2: Chạy, thấy hỏng**

Run: `dotnet test src/BE/Tests/SirLocked.Tests.csproj --filter "FullyQualifiedName~AiDifficultyProfilesTests"`
Expected: build FAIL, `AiDifficultyProfiles` không tồn tại.

- [ ] **Step 3: Viết `AiDifficultyProfiles.cs` và hai trường mới trên `AiDraftSettings`** theo Interfaces và bảng trên. Lỗi dùng `ApiException.BadRequest(..., new ApiErrorDetails("AI_ORDER_INVALID", "ai.order.invalid") { Field = "order.difficulty" })` giống `AiCaseOrderPolicy.Invalid`.

- [ ] **Step 4: Chạy lại** — cùng lệnh. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore src/BE/Services/AiDifficultyProfiles.cs src/BE/Models/AiCaseDraft.cs src/BE/Tests/AiDifficultyProfilesTests.cs
git commit -m "feat(ai): difficulty profiles and the OPEN_COOP_1 pipeline flag"
```

---

### Task 2: Đơn mới theo mức độ, không còn ghi đè; capabilities trả bảng

**Files:**
- Modify: `src/BE/DTOs/Ai/AiDtos.cs` (`GenerateAiCaseRequest` thêm `Leaning`; `AiCaseCapabilitiesResponse` thêm `DifficultyProfiles`)
- Modify: `src/BE/Services/AiCaseService.cs` (`CreateNewDraftSettings` khoảng dòng 574, `ApplyPresetDefaults`, `GetCapabilities`, chỗ gọi `AiCaseOrderPolicy.Normalize`)
- Modify: `src/BE/Services/AiCaseOrderPolicy.cs` (`Normalize`, `BuildPromptBlock`)
- Test: `src/BE/Tests/AiOrderDifficultyTests.cs`

**Interfaces:**
- Consumes: Task 1 (`AiDifficultyProfiles`, `AiPipelineVersions`, `AiCaseLeanings`).
- Produces:
  - `AiCaseOrderPolicy.Normalize(AiCaseOrder? requested, string role, AiDifficultyProfile profile)`: đặt `SuspectCount = profile.Suspects`, `PlayMinutes = profile.EstimatedMinutes`, bỏ kiểm `PlayMinuteOptions` và kiểm khoảng 3–6 cho đơn mới; giới hạn `npcIds` là `profile.Suspects + ExtraNpcPicks`. Overload cũ hai tham số giữ nguyên cho bản nháp cũ.
  - `BuildPromptBlock(order, profile?)`: có profile thì dòng thời gian chơi ghi `about {PlayMinutes.Min}-{PlayMinutes.Max} minutes ({difficulty})`.
  - `CreateNewDraftSettings(request)` luôn trả: `PipelineVersion = OPEN_COOP_1`, `Difficulty` = mức đã chuẩn hóa, `Leaning`, `StageCount = 1`, `GenerationPreset = NORMAL_RANDOM`, `IncludeCrackTheLie = true`, `MechanicsVersion = InvestigationV3PairedConfrontation`; bỏ qua `request.StageCount`, `GenerationPreset`, `IncludeCrackTheLie`; không gọi `ApplyPresetDefaults`.
  - `AiDifficultyProfileResponse { difficulty, playMinutes{min,max}, estimatedMinutes, scenes, suspects, cracks, puzzles{min,max}, redHerrings, requiredEvidence, pixelLab{newWorld{min,max}, libraryWorld{min,max}} }`; `AiCaseCapabilitiesResponse.DifficultyProfiles: List<AiDifficultyProfileResponse>` (3 phần tử, thứ tự easy, medium, hard).

- [ ] **Step 1: Viết test hỏng**

```csharp
public class AiOrderDifficultyTests
{
    [Fact]
    public void OldClientFields_AreIgnored_ForANewOrder()
    {
        var settings = AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest
        {
            Difficulty = "hard", StageCount = 6, GenerationPreset = "CRACK_THE_LIE_V3", IncludeCrackTheLie = false, Leaning = "PUZZLE"
        });
        Assert.Equal(AiPipelineVersions.OpenCoop1, settings.PipelineVersion);
        Assert.Equal("hard", settings.Difficulty);
        Assert.Equal("PUZZLE", settings.Leaning);
        Assert.Equal(1, settings.StageCount);
        Assert.True(settings.IncludeCrackTheLie);
        Assert.Equal(CaseMechanicsVersions.InvestigationV3PairedConfrontation, settings.MechanicsVersion);
    }

    [Theory] [InlineData("FULL_FEATURE")] [InlineData("SHORT_DEMO")] [InlineData("PUZZLE_HEAVY")]
    public void Preset_NeverChangesTheChosenDifficulty(string preset) =>
        Assert.Equal("easy", AiCaseService.CreateNewDraftSettings(new GenerateAiCaseRequest { Difficulty = "easy", GenerationPreset = preset }).Difficulty);

    [Fact]
    public void Normalize_TakesSuspectsAndMinutesFromTheLevel()
    {
        var order = AiCaseOrderPolicy.Normalize(new AiCaseOrder { SuspectCount = 6, PlayMinutes = 45 }, "ADMIN", AiDifficultyProfiles.For("easy"));
        Assert.Equal(3, order.SuspectCount);
        Assert.Equal(12, order.PlayMinutes);
    }

    [Fact]
    public void Normalize_NpcLimitFollowsTheLevel() =>
        Assert.Throws<ApiException>(() => AiCaseOrderPolicy.Normalize(
            new AiCaseOrder { NpcIds = Enumerable.Range(1, 7).Select(i => $"npc-{i}").ToList() }, "ADMIN", AiDifficultyProfiles.For("easy")));

    [Fact]
    public void Capabilities_ListTheThreeLevels() // dùng AiCaseService dựng như các test GetCapabilities hiện có
    {
        var levels = /* service */.GetCapabilities().DifficultyProfiles;
        Assert.Equal(new[] { "easy", "medium", "hard" }, levels.Select(l => l.Difficulty));
        Assert.Equal(5, levels[2].Suspects);
        Assert.Equal(300, levels[2].PixelLab.NewWorld.Min);
    }
}
```

(Test cuối dựng `AiCaseService` theo cách các test `GetCapabilities` hiện có trong `src/BE/Tests` đang làm; tìm bằng `grep -rn "GetCapabilities" src/BE/Tests`.)

- [ ] **Step 2: Chạy, thấy hỏng** — `dotnet test src/BE/Tests/SirLocked.Tests.csproj --filter "FullyQualifiedName~AiOrderDifficultyTests"`. Expected: build FAIL (`Leaning`, overload `Normalize` chưa có).

- [ ] **Step 3: Sửa theo Interfaces.** Chỗ `CreatePreviewAsync` gọi `AiCaseOrderPolicy.Normalize(request.Order, role)` đổi sang overload ba tham số với `AiDifficultyProfiles.For(request.Difficulty)`; `GenerationInputHash` thêm `Leaning` và `PipelineVersion`; bỏ `request.StageCount`, `request.GenerationPreset` khỏi hash của đơn mới.

- [ ] **Step 4: Chạy lại test mới và cả bộ unit**

Run: `dotnet test src/BE/Tests/SirLocked.Tests.csproj`
Expected: PASS hết. Test cũ nào khẳng định preset ghi đè độ khó cho **đơn mới** thì sửa test theo spec (ghi `Ruling:` trong ledger); test về bản nháp cũ phải giữ nguyên và vẫn đạt.

- [ ] **Step 5: Commit** — `git commit -am "feat(ai): orders take their size from the difficulty level"` (thêm file test mới bằng `git add`).

---

### Task 3: Form đặt vụ bố cục A

**Files:**
- Create: `src/FE/Client/js/pages/adminAiOrderForm.js`
- Modify: `src/FE/Client/js/pages/adminAiPage.js` (thay các card `worldCard … ideaCard`, `PRESETS`, khối "Bản nháp sẽ tạo", "Các bước duyệt sau khi tạo" và hàm gửi ở khoảng dòng 2344 bằng module mới), `src/FE/Client/js/api/aiCaseApi.js`, `src/FE/css/54-admin-ai.css`
- Test: `src/FE/tests/admin-ai-order-form.spec.ts` (viết lại phần form; giữ các test bảng bản nháp, đơn VIP, hạn mức tuần)

**Interfaces:**
- Consumes: `capabilities.difficultyProfiles` (Task 2), `aiCaseApi.library`, `aiCaseApi.quota`.
- Produces:
  - `aiCaseApi.createOrder({ difficulty, leaning, language, caseType, prompt, order }, idempotencyKey)` → `POST /api/admin/ai-cases` (không gửi `stageCount`, `generationPreset`, `includeCrackTheLie`).
  - `export function renderOrderForm(host, { capabilities, library, quota, role, onSubmit })` và `export function orderPayload(state)` trong `adminAiOrderForm.js`; `state = { difficulty, world, caseType, weather, timeOfDay, leaning, idea, characterNotes, locationIds, npcIds, language, contentLevel, pixelLabCap, reviewMode }`, mặc định `medium`, thế giới đầu tiên, `RANDOM`, `AUTO`, `AUTO`, `BALANCED`, `pixelLabCap -1`, `reviewMode FULL`.

Bố cục (spec mục 3): tiêu đề "Đặt vụ án mới" + một dòng dẫn; nhãn nhỏ "MỨC ĐỘ" và 3 thẻ (tên, khoảng phút, "x–y cảnh · n nghi phạm · n đối chất · x–y câu đố"); "THẾ GIỚI" là 4 thẻ có ảnh (giữ `worldThumb` hiện có); các hàng Loại vụ / Không khí / Thiên về là chip radio, ngăn bằng đường kẻ `--adm-line`; ô Ý tưởng; `<details>` "Tùy chọn thêm" chứa địa điểm và NPC thư viện (giữ logic chọn hiện có), ghi chú nhân vật, ngôn ngữ, mức nội dung, lượt PixelLab, cách duyệt (ô "nhanh" chỉ cho ADMIN như hiện nay); thanh tóm tắt nền `--adm-navy` dính đáy với "Mức · Thế giới · Loại vụ", "~a–b phút chơi · ước c–d lượt PixelLab · duyệt …" và nút "Tạo vụ án". Không có `.adm-card` lồng nhau. Dưới 640 px: thẻ mức độ xếp dọc, thế giới 2 cột.

- [ ] **Step 1: Viết test Playwright hỏng** (trong `admin-ai-order-form.spec.ts`, API giả như file đang làm; thêm `difficultyProfiles` vào `capabilities` giả với đúng số của Task 1):

```ts
test('three level cards show the server numbers and drive the summary', async ({ page }) => {
  await openForm(page, 'ADMIN');
  await expect(page.getByRole('radio', { name: /Trung bình/ })).toBeChecked();
  await expect(page.locator('[data-level="hard"]')).toContainText('40–60 phút');
  await expect(page.locator('[data-level="hard"]')).toContainText('6–8 cảnh');
  await page.getByRole('radio', { name: /Khó/ }).check();
  await expect(page.locator('.aai-order-bar')).toContainText('40–60 phút chơi');
  await expect(page.locator('.aai-order-bar')).toContainText('300–450 lượt PixelLab'); // thế giới mới
});

test('changing the level changes no other field', async ({ page }) => {
  await openForm(page, 'ADMIN');
  await page.getByRole('radio', { name: 'Bắt cóc' }).check();
  await page.getByRole('radio', { name: 'Giải đố nhiều hơn' }).check();
  await page.getByRole('radio', { name: /Dễ/ }).check();
  await expect(page.getByRole('radio', { name: 'Bắt cóc' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Giải đố nhiều hơn' })).toBeChecked();
});

test('old controls are gone', async ({ page }) => {
  await openForm(page, 'ADMIN');
  await expect(page.getByText(/V3 · Crack|Phá Vỡ Lời Dối|Số chặng|Số nghi phạm|Thời lượng chơi/)).toHaveCount(0);
});

test('submit sends the new order shape only', async ({ page }) => {
  const sent = await submitAndCapture(page, async () => {
    await page.getByRole('radio', { name: /Khó/ }).check();
    await page.getByRole('radio', { name: 'Tuyết' }).check();
    await page.getByLabel('Ý tưởng').fill('Cáp treo đêm tuyết');
  });
  expect(sent).toMatchObject({ difficulty: 'hard', leaning: 'BALANCED', order: { weather: 'SNOW', pixelLabCap: -1, reviewMode: 'FULL' } });
  expect(sent).not.toHaveProperty('stageCount');
  expect(sent).not.toHaveProperty('generationPreset');
  expect(sent).not.toHaveProperty('includeCrackTheLie');
});

test('works at 375 px with the keyboard only', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openForm(page, 'VIP');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole('radio', { name: /Dễ/ }).focus();
  await page.keyboard.press('ArrowRight'); // sang Trung bình
  await expect(page.getByRole('radio', { name: /Trung bình/ })).toBeChecked();
  await page.getByText('Tùy chọn thêm').press('Enter');
  await expect(page.getByLabel('Lượt PixelLab')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Duyệt nhanh/ })).toHaveCount(0); // VIP không có duyệt nhanh
});
```

(`openForm`, `submitAndCapture` là helper trong file: dựng route giả, mở `/admin/ai`, bắt body `POST /api/admin/ai-cases`.)

- [ ] **Step 2: Chạy, thấy hỏng** — `cd src/FE && node ./tests/run-ui-smoke.mjs tests/admin-ai-order-form.spec.ts`. Expected: các test mới FAIL (form cũ).

- [ ] **Step 3: Viết `adminAiOrderForm.js`, nối vào `adminAiPage.js`, thêm `aiCaseApi.createOrder`, viết lại phần CSS form trong `54-admin-ai.css`** theo bố cục và Interfaces. Xóa `PRESETS`, các card cũ, `stageCount`/`generationPreset`/`includeCrackTheLie` khỏi trạng thái form và khỏi `FIELD_ERRORS` không còn dùng. Lỗi server (`order.<field>`) hiện ngay dưới mục tương ứng như cơ chế `fieldErrorHtml` hiện có.

- [ ] **Step 4: Chạy lại spec và build**

Run: `cd src/FE && node ./tests/run-ui-smoke.mjs tests/admin-ai-order-form.spec.ts tests/admin-ai-language.spec.ts tests/admin-ai-creation-errors.spec.ts && npm run build`
Expected: PASS; build không lỗi. Sửa `admin-ai-language` / `admin-ai-creation-errors` nếu chúng nhắm vào ô đã bỏ (ghi `Ruling:`).

- [ ] **Step 5: Mở trang thật bằng dev server để nhìn** (Playwright screenshot hoặc trình duyệt) ở 1280 px và 375 px, so với bản phác A. Ghi ảnh vào ledger.

- [ ] **Step 6: Commit** — `git add` các file trên, `git commit -m "feat(admin-ai): one-page order form by difficulty level"`.

---

### Task 4: Hợp đồng, ngân sách sự thật và số nghi phạm theo mức

**Files:**
- Modify: `src/BE/Services/AiGenerationContract.cs` (`For(AiDraftSettings)`), `src/BE/Services/AiTruthGenerationBudget.cs` (`For(AiDraftSettings)`, `ForProjection`), `src/BE/Services/CaseTargetAllocationPolicy.cs` (`RequiredSuspects`), `src/BE/Services/Projection/ProjectionCapacityPolicy.cs` (chứng cứ gây nhiễu)
- Test: `src/BE/Tests/AiDifficultyBudgetTests.cs`

**Interfaces:**
- Consumes: Task 1.
- Produces: với `AiPipelineVersions.IsOpenCoop(settings)`:
  - `AiGenerationContract.For(settings)` = `AiDifficultyProfiles.Contract(profile, settings.Leaning)`.
  - `AiTruthGenerationBudget.For(settings)` và `ForProjection(settings)`: `MaxSuspects = profile.Suspects`, `MaxLocations = profile.Scenes.Max`, `MaxRedHerrings = profile.RedHerrings.Max`, `MaxTimelineEvents = max(12, profile.TimelineEvents.Max * 2)`; các trường còn lại như đường preset NORMAL_RANDOM.
  - `CaseTargetAllocationPolicy.RequiredSuspects(...)` trả `profile.Suspects` (thêm overload nhận `AiDraftSettings` nếu chữ ký hiện tại không đủ).
  - Kiểm sự thật: số địa điểm dùng tới ngoài `profile.Scenes` → lỗi `TruthLocationCountForLevel` với thông điệp `"{Level} needs {min}-{max} locations; truth uses {n}."` ở bước sự thật.

- [ ] **Step 1: Viết test hỏng**

```csharp
public class AiDifficultyBudgetTests
{
    static AiDraftSettings S(string level) => new() { PipelineVersion = AiPipelineVersions.OpenCoop1, Difficulty = level, Leaning = "BALANCED", StageCount = 1 };

    [Fact] public void HardOneStage_AllowsFiveSuspects() => Assert.Equal(5, AiTruthGenerationBudget.ForProjection(S("hard")).MaxSuspects);
    [Fact] public void HardBudget_AllowsEightLocations() => Assert.Equal(8, AiTruthGenerationBudget.For(S("hard")).MaxLocations);
    [Fact] public void Contract_ComesFromTheProfile() => Assert.Equal((4, 5), (AiGenerationContract.For(S("medium")).MinScenes, AiGenerationContract.For(S("medium")).MaxScenes));
    [Fact] public void OldDraft_KeepsThePresetContract() =>
        Assert.Equal(AiGenerationContract.For("NORMAL_RANDOM", 4), AiGenerationContract.For(new AiDraftSettings { StageCount = 4 }));
}
```

Thêm vào test sự thật hiện có (tìm `ValidateCaseTruth` trong `src/BE/Tests`) một ca: bản nháp `hard`, sự thật 4 địa điểm → lỗi mã `TruthLocationCountForLevel` (Review Focus 2).

- [ ] **Step 2: Chạy, thấy hỏng** — `dotnet test src/BE/Tests/SirLocked.Tests.csproj --filter "FullyQualifiedName~AiDifficultyBudgetTests|FullyQualifiedName~CaseTruth"`. Expected: FAIL.
- [ ] **Step 3: Sửa theo Interfaces.**
- [ ] **Step 4: Chạy cả bộ unit** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ai): truth budget and suspects follow the difficulty level`.

---

### Task 5: Bước chiếu dựng vụ OPEN_COOP một chặng

**Files:**
- Modify: `src/BE/Services/Projection/GameplayProjectionPlanner.cs` (`ValidateProjectability` khoảng dòng 55, khối tạo chặng khoảng dòng 212, nơi đặt `MechanicsVersion` cho skeleton)
- Test: `src/BE/Tests/OpenCoopProjectionTests.cs`

**Interfaces:**
- Consumes: Task 4 (contract một chặng).
- Produces: với bản nháp `OPEN_COOP_1`, `plan.Skeleton` có đúng một `CaseStage` (`stage-01`) chứa mọi cảnh theo thứ tự `OrderedLocations`; `Skeleton.RuleSet = CaseRuleSets.OpenCoop`; `Skeleton.MechanicsVersion = InvestigationV3PairedConfrontation`; `Skeleton.EstimatedMinutes = profile.EstimatedMinutes`; bỏ kiểm `ProjectionStageCoverage`. `finalLogic.requiredEvidenceIds` đúng `profile.RequiredEvidence` phần tử; mức Khó: `finalLogic` cần ít nhất một `deductionId`. Bản nháp cũ không đổi.

- [ ] **Step 1: Viết test hỏng** — dựng `CaseTruthPackage` mẫu bằng helper hiện có của test projection (tìm `GameplayProjectionPlannerTests` trong `src/BE/Tests`), mức `medium`, 5 địa điểm:

```csharp
[Fact] public void NewDraft_HasOneStageWithEveryScene()
{
    var plan = Plan(OpenCoopDraft("medium"), TruthWithLocations(5));
    var stage = Assert.Single(plan.Skeleton.Stages);
    Assert.Equal(5, stage.Scenes.Count);
    Assert.Equal(CaseRuleSets.OpenCoop, plan.Skeleton.RuleSet);
    Assert.Equal(25, plan.Skeleton.EstimatedMinutes);
}
[Fact] public void NewDraft_RequiresTheLevelsEvidenceCount() =>
    Assert.Equal(3, Plan(OpenCoopDraft("medium"), TruthWithLocations(5)).Skeleton.FinalLogic.RequiredEvidenceIds.Count);
[Fact] public void HardDraft_NeedsADeductionForTheAccusation() =>
    Assert.NotEmpty(Plan(OpenCoopDraft("hard"), TruthWithLocations(6)).Skeleton.FinalLogic.RequiredDeductionIds);
[Fact] public void OldDraft_StillBuildsStages() =>
    Assert.Equal(4, Plan(new AiCaseDraft { Settings = new() { StageCount = 4 } }, TruthWithLocations(5)).Skeleton.Stages.Count); // Review Focus 4
```

(Tên trường cần suy luận của `FinalLogic` lấy theo model hiện có; nếu khác `RequiredDeductionIds` thì dùng trường thật và ghi `Ruling:`.)

- [ ] **Step 2: Chạy, thấy hỏng** — `--filter "FullyQualifiedName~OpenCoopProjectionTests"`.
- [ ] **Step 3: Sửa planner theo Interfaces.**
- [ ] **Step 4: Chạy cả bộ unit** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ai): projection builds one-stage OPEN_COOP cases`.

---

### Task 6: Ô câu đố tương tác tùy chọn trong bước chiếu

**Files:**
- Create: `src/BE/Services/Projection/GameplayProjectionPlanner.OptionalPuzzles.cs`
- Modify: `src/BE/Services/Projection/GameplayProjectionPlanner.cs` (gọi `CreateOptionalPuzzles` thay `CreateInvestigativeMechanics` cho bản nháp mới)
- Test: `src/BE/Tests/OptionalPuzzleProjectionTests.cs`

**Interfaces:**
- Consumes: Task 5 (skeleton một chặng), `AiDifficultyProfiles.PuzzleCount`.
- Produces: `private static void CreateOptionalPuzzles(GameCase skeleton, CaseTruthPackage truth, AiDifficultyProfile profile, string leaning, ProjectionPlan plan)`. Tạo `PuzzleCount(profile, leaning)` câu đố `puzzle-01…`, mỗi câu: `Type = INTERACTIVE_PUZZLE`, `ProgressionRole = "OPTIONAL"`, `Difficulty = profile.PuzzleDifficulty`, `Kind = ""` (AI chọn ở Task 7), `TargetId` = một `CaseItem` mới `item-puzzle-NN` với `IsInteractivePuzzleObject = true` đặt trong một cảnh (rải đều các cảnh, cảnh có ít câu đố nhất trước), `UnlockClueIds` = đúng một manh mối thưởng. Manh mối thưởng: một dấu vết sự thật **không** nằm trong `FinalLogic.RequiredEvidenceIds` và không là `correctEvidenceId` của đối chất nào; nếu không đủ dấu vết như vậy thì tạo manh mối "củng cố" mới từ lời khai đã có (nội dung AI viết ở Task 7). Thêm `plan.Puzzles[puzzleId]` như đường cũ.

- [ ] **Step 1: Viết test hỏng**

```csharp
[Theory] [InlineData("easy","BALANCED",1)] [InlineData("medium","PUZZLE",3)] [InlineData("hard","DIALOGUE",4)]
public void PuzzleCount_FollowsLevelAndLeaning(string level, string leaning, int n) =>
    Assert.Equal(n, Plan(OpenCoopDraft(level, leaning), TruthFor(level)).Skeleton.Puzzles.Count);

[Fact] public void EveryPuzzleIsOptionalAndInteractive()
{
    var c = Plan(OpenCoopDraft("hard"), TruthFor("hard")).Skeleton;
    Assert.All(c.Puzzles, p => { Assert.Equal("INTERACTIVE_PUZZLE", p.Type); Assert.Equal("OPTIONAL", p.ProgressionRole); Assert.Equal("HARD", p.Difficulty); });
    Assert.All(c.Puzzles, p => Assert.True(c.Items.Single(i => i.ItemId == p.TargetId).IsInteractivePuzzleObject));
    Assert.All(c.Puzzles, p => Assert.Contains(c.Stages[0].Scenes, s => s.ItemIds.Contains(p.TargetId)));
}

[Fact] public void PuzzleRewardIsNeverTheOnlyProof()
{
    var c = Plan(OpenCoopDraft("hard"), TruthFor("hard")).Skeleton;
    var rewards = c.Puzzles.SelectMany(p => p.UnlockClueIds).ToHashSet();
    Assert.DoesNotContain(c.FinalLogic.RequiredEvidenceIds, rewards.Contains);
    Assert.DoesNotContain(c.EvidenceChallenges.Select(e => e.CorrectEvidenceId), rewards.Contains);
}

[Fact] public void OldDraft_KeepsTheOldPuzzleRotation() =>
    Assert.All(Plan(OldDraftWithPuzzles(), TruthFor("medium")).Skeleton.Puzzles, p => Assert.NotEqual("INTERACTIVE_PUZZLE", p.Type));
```

- [ ] **Step 2: Chạy, thấy hỏng** — `--filter "FullyQualifiedName~OptionalPuzzleProjectionTests"`.
- [ ] **Step 3: Viết `CreateOptionalPuzzles`.**
- [ ] **Step 4: Chạy cả bộ unit** — PASS.
- [ ] **Step 5: Commit** — `feat(ai): optional interactive puzzle slots by level`.

---

### Task 7: AI chọn loại câu đố và viết chữ; server hoàn thiện (loại không gắn sự thật)

**Files:**
- Create: `src/BE/Services/PuzzleKinds/PuzzleKindAuthoring.cs`
- Modify: `src/BE/Services/Projection/ProjectionContracts.cs` (`PuzzleProjectionContent` thêm `Kind`, `Authored`, `Hints`), `ProjectionContentSchemaFactory.cs` (khối `puzzles` khoảng dòng 93), `GameCaseProjectionCompiler.cs` (khối puzzle khoảng dòng 121 và kiểm khoảng dòng 236), `ProjectionWireContract.cs`, prompt bước chiếu trong `src/BE/Services/AiCaseService.cs` (khối "Puzzles may only use type CODE_PUZZLE…" khoảng dòng 3651: thêm nhánh cho bản nháp mới)
- Test: `src/BE/Tests/PuzzleKindAuthoringTests.cs`

**Interfaces:**
- Consumes: Task 6 (ô câu đố có `Kind = ""`), `PuzzleKindRegistry` (`FillMissing`, `Validate`, `IsInteractive`).
- Produces:
  - `public static class PuzzleKindAuthoring { IReadOnlyList<string> FreeKinds; IReadOnlyList<string> TruthBoundKinds; IReadOnlyList<string> RequiredAuthoredKeys(string kind); IReadOnlyList<string> OfferedKinds(CaseTruthPackage truth); }` — `FreeKinds` = `torn_paper, lockpick, music_box, gear_train, balance_scale, tilt_maze, reagent_mix`; `TruthBoundKinds` = `fingerprint, doc_forgery, parallax_code`; `RequiredAuthoredKeys` = các khóa chữ trong `params` mà `Complete` của kind không tự sinh (người làm đọc từng file `*Kind.cs`, ví dụ `torn_paper`: `doc`, `note`, `find`). `OfferedKinds` = `FreeKinds` + những loại gắn sự thật có dữ kiện hợp (Task 8; ở task này trả `FreeKinds`).
  - Schema nội dung cho mỗi câu đố của bản nháp mới: `kind` (enum `OfferedKinds`), `authored` (object), `prompt`, `investigationPurpose`, `successMessage`, `failureMessage`, `hints` (mảng đúng `profile.HintLevels` chuỗi).
  - Compiler: đặt `Kind`, `ParamsJson = authored`, `PuzzleKindRegistry.FillMissing` cho câu đố đó, rồi `Validate`; lỗi đưa vào lỗi chiếu với đường dẫn `puzzles.<id>.authored.<field>` để bước sửa theo phạm vi dùng được. Hai câu đố trùng `kind` → lỗi `PuzzleKindRepeated`.

- [ ] **Step 1: Viết test hỏng**

```csharp
[Theory] [MemberData(nameof(FreeKindFixtures))] // mỗi kind một object authored mẫu tối thiểu, viết theo RequiredAuthoredKeys
public void FreeKind_CompletesAndValidates(string kind, string authoredJson)
{
    var puzzle = CompileOne(kind, authoredJson);
    Assert.False(string.IsNullOrEmpty(puzzle.SolutionJson));
    Assert.Empty(ValidatePuzzle(puzzle));
}

[Fact] public void MissingAuthoredKey_IsReportedOnItsPath() =>
    Assert.Contains(CompileErrors("torn_paper", "{}"), e => e.StartsWith("puzzles.puzzle-01.authored."));

[Fact] public void RepeatedKind_IsRejected() =>
    Assert.Contains(CompileErrors(("torn_paper", TornPaper), ("torn_paper", TornPaper)), e => e.Contains("PuzzleKindRepeated"));

[Fact] public void Schema_OffersOnlyKnownKinds() =>
    Assert.Equal(PuzzleKindAuthoring.FreeKinds.OrderBy(k => k), SchemaKindEnum(OpenCoopDraft("medium")).OrderBy(k => k));
```

- [ ] **Step 2: Chạy, thấy hỏng** — `--filter "FullyQualifiedName~PuzzleKindAuthoringTests"`.
- [ ] **Step 3: Viết `PuzzleKindAuthoring`, sửa schema, contract, compiler, prompt** theo Interfaces. Prompt (chỉ bản nháp mới) nói rõ: câu đố là phần thưởng phụ; chọn `kind` hợp truyện và không lặp; chỉ viết chữ trong `authored`; không viết lời giải.
- [ ] **Step 4: Chạy cả bộ unit** — PASS.
- [ ] **Step 5: Commit** — `feat(ai): AI authors interactive puzzle text, server completes it`.

---

### Task 8: Ba loại câu đố gắn sự thật

**Files:**
- Create: `src/BE/Services/PuzzleKinds/TruthBoundPuzzleAnswers.cs`
- Modify: `src/BE/Services/PuzzleKinds/PuzzleKindAuthoring.cs` (`OfferedKinds`), `GameCaseProjectionCompiler.cs` (gọi `Apply` trước `FillMissing`)
- Test: `src/BE/Tests/TruthBoundPuzzleTests.cs`

**Interfaces:**
- Consumes: Task 7.
- Produces: `public static class TruthBoundPuzzleAnswers { bool CanOffer(string kind, CaseTruthPackage truth); void Apply(CasePuzzle puzzle, CaseTruthPackage truth, GameCase gameCase); }`
  - `fingerprint`: cần một dấu vết sự thật ghi rõ nhân vật để lại dấu tay trên một vật. `Apply`: thẻ đối chiếu = các nghi phạm của vụ (tên, vai lấy từ `characters`), `solution.card` = nhân vật đó.
  - `doc_forgery`: cần một dấu vết sự thật về giấy tờ bị sửa (giá trị cũ, giá trị mới). `Apply`: các trường bị sửa và giá trị thật lấy từ dấu vết đó.
  - `parallax_code`: cần một dữ kiện sự thật là một mã/ký hiệu 3 ký tự. `Apply`: `solution.code` = mã đó.
  - `CanOffer` sai thì loại đó không vào enum; AI vẫn gửi loại đó → lỗi `PuzzleKindNotSupportedByTruth` với thông điệp "Chọn loại khác: sự thật không có dữ kiện cho {kind}." (Review Focus 3). Nhận diện dữ kiện theo các trường có cấu trúc của `CaseTruthPackage` (người làm đọc model dấu vết); không dò chữ tự do.

- [ ] **Step 1: Viết test hỏng**

```csharp
[Fact] public void Fingerprint_AnswerIsTheCharacterTheTruthNames()
{
    var (truth, gameCase) = TruthWithPrintBy("char-pho-khiem");
    var p = Puzzle("fingerprint");
    TruthBoundPuzzleAnswers.Apply(p, truth, gameCase);
    Assert.Equal("char-pho-khiem", JsonNode.Parse(p.SolutionJson)!["card"]!.GetValue<string>());
}
[Fact] public void DocForgery_FieldsComeFromTheTruth() { /* giá trị cũ/mới trong params và solution khớp dấu vết */ }
[Fact] public void ParallaxCode_CodeComesFromTheTruth() { /* solution.code == mã trong sự thật */ }
[Fact] public void KindWithoutTruthFact_IsNotOffered() =>
    Assert.DoesNotContain("fingerprint", PuzzleKindAuthoring.OfferedKinds(TruthWithoutPrints()));
[Fact] public void KindWithoutTruthFact_ChosenAnyway_IsRejected() =>
    Assert.Contains(CompileErrors(TruthWithoutPrints(), ("fingerprint", "{}")), e => e.Contains("PuzzleKindNotSupportedByTruth"));
```

- [ ] **Step 2: Chạy, thấy hỏng.** — `--filter "FullyQualifiedName~TruthBoundPuzzleTests"`
- [ ] **Step 3: Viết `TruthBoundPuzzleAnswers`, nối vào `OfferedKinds` và compiler.**
- [ ] **Step 4: Chạy cả bộ unit** — PASS.
- [ ] **Step 5: Commit** — `feat(ai): truth-bound puzzle answers come from the approved truth`.

---

### Task 9: Bảng Hồ sơ vụ án, dòng thời gian và gợi ý theo mức

**Files:**
- Modify: `ProjectionContracts.cs` (nội dung thêm `Board`, `Timeline`), `ProjectionContentSchemaFactory.cs`, `GameCaseProjectionCompiler.cs`, `GameplayProjectionPlanner.cs` (chọn mốc thời gian), prompt bước chiếu trong `AiCaseService.cs`
- Test: `src/BE/Tests/OpenCoopBoardTimelineTests.cs`

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - Nội dung `board`: `centerKicker`, `centerTitle`, `centerSubtitle`, `summary`, `links` (0–3, `fromId`/`toId` phải là id manh mối hoặc lời khai đã có). Compiler gán `GameCase.Board`.
  - Planner chọn `TimelineEvents` mốc từ dòng thời gian sự thật (mức Dễ: không có `timeline`): khoảng một nửa `IsFixed = true` (luôn gồm mốc đầu và mốc cuối), `SortKey` theo thứ tự sự thật, `RequiredClueIds` của mốc cố định là manh mối chứa giờ đó. AI viết `title`, `prompt` và `label`/`detail`/`dayLabel`/`timeLabel` cho từng mốc qua schema có id khóa sẵn.
  - Gợi ý: mỗi cảnh, mỗi câu đố, mỗi đối chất có đúng `profile.HintLevels` `CaseHint` (`Order` 1..n).

- [ ] **Step 1: Viết test hỏng**

```csharp
[Fact] public void Board_IsCompiledFromContent() => Assert.Equal("NGƯỜI MẤT TÍCH", Compile(OpenCoopDraft("medium"), ContentWithBoard("NGƯỜI MẤT TÍCH")).Board!.CenterKicker);
[Fact] public void BoardLink_ToUnknownId_IsRejected() => Assert.NotEmpty(CompileErrors(OpenCoopDraft("medium"), ContentWithBoardLink("clue-x", "nope")));
[Theory] [InlineData("easy",0,0)] [InlineData("medium",5,6)] [InlineData("hard",7,9)]
public void Timeline_SizeFollowsTheLevel(string level, int min, int max)
{
    var c = Compile(OpenCoopDraft(level), FullContentFor(level));
    if (max == 0) Assert.Null(c.Timeline);
    else { Assert.InRange(c.Timeline!.Events.Count, min, max); Assert.True(c.Timeline.Events.First().IsFixed); Assert.True(c.Timeline.Events.Last().IsFixed); }
}
[Theory] [InlineData("easy",3)] [InlineData("hard",2)]
public void Hints_PerPuzzleFollowTheLevel(string level, int n) =>
    Assert.All(Compile(OpenCoopDraft(level), FullContentFor(level)).Puzzles,
        p => Assert.Equal(n, Compile(OpenCoopDraft(level), FullContentFor(level)).Hints.Count(h => h.TargetId == p.PuzzleId)));
```

- [ ] **Step 2: Chạy, thấy hỏng.** — `--filter "FullyQualifiedName~OpenCoopBoardTimelineTests"`
- [ ] **Step 3: Sửa contract, schema, planner, compiler, prompt.**
- [ ] **Step 4: Chạy cả bộ unit** — PASS (validator hiện có chặn dây nối lộ đáp án vẫn chạy).
- [ ] **Step 5: Commit** — `feat(ai): board, timeline and hints by level`.

---

### Task 10: Kiểm tra "đúng mức" và vụ mẫu (mock) cho cả ba mức

**Files:**
- Create: `src/BE/Services/AiDifficultyConformance.cs`
- Modify: `src/BE/Services/AiGenerationContract.cs` (`Validate(GameCase, AiDraftSettings)` gọi kiểm mới cho bản nháp mới), `src/BE/Services/AiCaseMockFactory.cs`
- Test: `src/BE/Tests/AiDifficultyConformanceTests.cs`

**Interfaces:**
- Consumes: Task 1–9.
- Produces: `public static class AiDifficultyConformance { IReadOnlyList<string> Check(GameCase gameCase, AiDraftSettings settings); }` — mỗi lệch một dòng có mã: `LevelSceneCount`, `LevelSuspectCount`, `LevelCrackCount`, `LevelPuzzleCount`, `LevelRedHerringCount`, `LevelRequiredEvidence`, `LevelDeductionMissing` (Khó), `LevelRuleSet`, `LevelPuzzleNotOptional`, `LevelPuzzleSoleProof`. Chạy trong `Validate` nên bị bắt ở kiểm tra trước LAYOUT (bước `PRE_ASSET_VALIDATION` hiện có). `AiCaseMockFactory` sinh vụ `OPEN_COOP_1` hợp lệ cho cả ba mức.

- [ ] **Step 1: Viết test hỏng**

```csharp
[Theory] [InlineData("easy")] [InlineData("medium")] [InlineData("hard")]
public void MockCase_PassesEveryCheck(string level)
{
    var settings = OpenCoopSettings(level);
    var gameCase = AiCaseMockFactory.CreateCase(settings /* chữ ký hiện có của factory */);
    Assert.Empty(AiDifficultyConformance.Check(gameCase, settings));
    Assert.True(new CaseValidationService().Validate(gameCase).IsValid);
}
[Theory]
[InlineData("LevelSceneCount")] [InlineData("LevelSuspectCount")] [InlineData("LevelCrackCount")] [InlineData("LevelPuzzleCount")]
[InlineData("LevelRuleSet")] [InlineData("LevelPuzzleNotOptional")] [InlineData("LevelPuzzleSoleProof")] [InlineData("LevelDeductionMissing")]
public void EachMismatch_IsReported(string code) =>
    Assert.Contains(AiDifficultyConformance.Check(BrokenFor(code), OpenCoopSettings("hard")), e => e.StartsWith(code));
```

(`BrokenFor(code)` lấy vụ mẫu mức Khó rồi làm hỏng đúng một thứ.)

- [ ] **Step 2: Chạy, thấy hỏng.** — `--filter "FullyQualifiedName~AiDifficultyConformanceTests"`
- [ ] **Step 3: Viết `AiDifficultyConformance`, nối vào `Validate`, sửa `AiCaseMockFactory`.**
- [ ] **Step 4: Chạy cả bộ unit** — PASS.
- [ ] **Step 5: Commit** — `feat(ai): level conformance check and mock cases for every level`.

---

### Task 11: Tự tạo cảnh mở đầu sau khi nhập vụ

**Files:**
- Create: `src/BE/Services/Cutscene/AiIntroCutsceneStarter.cs`
- Modify: `src/BE/Services/AiCaseService.cs` (`ImportDraftAsync` khoảng dòng 2365, sau khi ghi `Imported`/`Published`), `src/BE/Models/AiCaseDraft.cs` (`IntroCutsceneStatus`, `IntroCutsceneError`), DI trong `Program.cs`
- Test: `src/BE/IntegrationTests/AiIntroCutsceneTests.cs`

**Interfaces:**
- Consumes: `CutsceneService.GenerateAsync(string caseId, bool regenerate, string actor, CancellationToken)`.
- Produces: `public interface IAiIntroCutsceneStarter { Task StartAsync(AiCaseDraft draft, string caseId, CancellationToken ct); }`; bản thật gọi `GenerateAsync(caseId, regenerate: false, actor: "ai-pipeline")` chỉ khi `AiPipelineVersions.IsOpenCoop(draft.Settings)`; bắt mọi ngoại lệ, ghi `IntroCutsceneStatus = "FAILED"` và `IntroCutsceneError` (cắt 300 ký tự), thành công ghi `"QUEUED"`. `ImportDraftAsync` không bao giờ ném lỗi vì bước này.

- [ ] **Step 1: Viết test hỏng** (Mongo thật, khuôn như `AiOrderStatusCompletionTests`):

```csharp
[Fact] public async Task Import_NewDraft_QueuesTheIntro()      // starter giả ghi lại lời gọi
{ /* nhập bản nháp OPEN_COOP_1 sẵn sàng → starter được gọi đúng caseId; IntroCutsceneStatus == "QUEUED" */ }
[Fact] public async Task Import_OldDraft_DoesNotQueueAnIntro()  // Review Focus 4
{ /* bản nháp không PipelineVersion → starter không được gọi */ }
[Fact] public async Task Import_IntroFailure_DoesNotBlockTheImport()
{ /* starter ném lỗi → import vẫn trả CaseSummaryResponse; IntroCutsceneStatus == "FAILED" */ }
```

- [ ] **Step 2: Chạy, thấy hỏng**

Run (Mongo cục bộ đang chạy ở 27017):
```bash
SIRLOCKED_RUN_MONGO_IT=true SIRLOCKED_TEST_MONGO=mongodb://127.0.0.1:27017 SIRLOCKED_TEST_MONGO_CONNECTION_STRING=mongodb://127.0.0.1:27017 \
  dotnet test src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj --filter "FullyQualifiedName~AiIntroCutsceneTests"
```
Expected: FAIL. (Không đặt các biến này thì test im lặng bỏ qua: luôn đặt.)
- [ ] **Step 3: Viết starter, gọi trong `ImportDraftAsync`, đăng ký DI.**
- [ ] **Step 4: Chạy lại** — PASS.
- [ ] **Step 5: Commit** — `feat(ai): queue the intro cutscene after a new draft is imported`.

---

### Task 12: Skill của bot và MCP studio

**Files:**
- Modify: `.claude/skills/tao-vu-an/SKILL.md`, `tools/studio-mcp/src/playtest/solver.ts` (nếu solver giả định nhiều chặng), `tools/studio-mcp/src/tools/draft.ts` (`playerView` nếu đếm theo chặng)
- Test: `tools/studio-mcp/test/playtest-solver.test.ts`, `tools/studio-mcp/test/bridge-tools.test.ts`

**Interfaces:**
- Consumes: vụ `OPEN_COOP` một chặng (Task 5), câu đố `OPTIONAL` (Task 6).
- Produces: solver chạy được vụ một chặng nhiều cảnh mở sẵn và bỏ qua câu đố `OPTIONAL`; SKILL.md có: mục "Mức độ" (bảng ngắn + lượt PixelLab ước tính, quy tắc hỏi khi vượt 60 lượt giữ nguyên), hướng dẫn bước chiếu mới (chọn `kind` không lặp, chỉ viết `authored`, gợi ý đúng số mức, viết `board`, mốc thời gian), bước cảnh mở đầu tự đến sau nhập vụ (yêu cầu bridge `CUTSCENE`), và câu "chạy thử không giải câu đố phụ".

- [ ] **Step 1: Viết test hỏng** trong `playtest-solver.test.ts`: một vụ `ruleSet: "OPEN_COOP"`, `stages: [{ scenes: [s1, s2, s3] }]`, một câu đố `INTERACTIVE_PUZZLE` `OPTIONAL` → solver ra lời giải buộc tội đúng mà không cần câu đố đó.
- [ ] **Step 2: Chạy, thấy hỏng (hoặc đạt ngay thì ghi vào ledger là solver đã hỗ trợ, giữ test làm chốt)** — `cd tools/studio-mcp && npm test`.
- [ ] **Step 3: Sửa solver/`playerView` nếu cần; cập nhật SKILL.md.**
- [ ] **Step 4: Chạy lại** — `npm test` PASS (trước đây 107 qua, 2 bỏ qua; nay thêm test mới).
- [ ] **Step 5: Commit** — gồm cả các thay đổi chưa commit mang sang từ `feature/case-creating` (`asset_download`, `pixellab_character_zip`, luật 9): `git add tools/studio-mcp .claude/skills/tao-vu-an/SKILL.md && git commit -m "feat(studio): bot instructions and playtest for OPEN_COOP cases"`.

---

### Task 13: Kiểm tra toàn nhánh

- [ ] **Step 1: Chạy mọi bộ test**

```bash
dotnet test src/BE/Tests/SirLocked.Tests.csproj
SIRLOCKED_RUN_MONGO_IT=true SIRLOCKED_TEST_MONGO=mongodb://127.0.0.1:27017 SIRLOCKED_TEST_MONGO_CONNECTION_STRING=mongodb://127.0.0.1:27017 dotnet test src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj
(cd src/FE && npm run build && node ./tests/run-ui-smoke.mjs)
(cd tools/studio-mcp && npm test)
(cd tools/studio-runner && npm test)
```
Expected: tất cả PASS. Lỗi nào không do nhánh này gây ra vẫn ghi tên vào báo cáo.

- [ ] **Step 2: Chạy thật một đơn mức Dễ** trên server cục bộ với runner (không deploy): đi hết tới nhập vụ, mở vụ trong phòng chơi thử, xác nhận mở mọi cảnh từ đầu, có bảng Hồ sơ, có 1–2 câu đố mở được, cảnh mở đầu đã xếp hàng. Ghi kết quả vào ledger. Bước này tốn lượt Claude và PixelLab: hỏi chủ dự án trước khi chạy.

## Rulings (Claude đặt khi viết kế hoạch — chủ dự án kiểm)

- Bảng hồ sơ mở rộng thêm các số spec không ghi: nhân vật 4–6 / 5–7 / 6–8; manh mối 6–10 / 10–14 / 15–22; hội thoại 4–8 / 8–12 / 12–18; suy luận 0 / 1 / 2; chuỗi phối hợp 0 / 1 / 1; tương tác 0–1 / 1–2 / 2–3; mốc thời gian 0 / 5–6 / 7–9; nhân vật có hội thoại nhánh 1 / 2 / 3 (+1 khi "Hội thoại nhiều hơn"); lượt PixelLab ước tính thế giới mới 60–120 / 150–220 / 300–450, thế giới có thư viện 10–40 / 30–80 / 60–150.
- Số câu đố theo "Thiên về" (Cân bằng / Giải đố / Hội thoại): Dễ 1 / 2 / 1, Trung bình 2 / 3 / 2, Khó 5 / 6 / 4.
- Bảng mức độ đi kèm `GET /api/admin/ai-cases/capabilities` (form đã tải sẵn) thay cho một đường dẫn mới `/api/ai/difficulty-profiles` (spec để người làm chọn đường dẫn).
- Đơn mới vẫn ghi `GenerationPreset = NORMAL_RANDOM` và `IncludeCrackTheLie = true` trong settings để các nhánh code cũ đọc settings không vỡ; form không còn gửi hai trường này.
- Form tách ra `adminAiOrderForm.js` vì `adminAiPage.js` đã hơn 3.100 dòng; CSS vẫn ở `54-admin-ai.css` để không đổi cách nạp.
