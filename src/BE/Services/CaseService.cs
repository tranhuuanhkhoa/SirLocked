using System.Text.Json;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Projection;

namespace SirLocked.Api.Services;

public class CaseService : ICaseService, IPixelCaseSeeder, ITutorialCaseSeeder
{
    /// <summary>Set once the tutorial case was refreshed from its bundled file in this process.</summary>
    private static int _tutorialRefreshed;

    internal static System.Linq.Expressions.Expression<Func<GameRoom, bool>> ReferencingActiveCase(string caseId) =>
        room => room.CaseId == caseId && (room.Status == RoomStatus.Waiting || room.Status == RoomStatus.Ready || room.Status == RoomStatus.InProgress);

    internal static System.Linq.Expressions.Expression<Func<GameRoom, bool>> ReferencingLegacyCompletedCase(string caseId) =>
        room => room.CaseId == caseId && room.Status == RoomStatus.Completed
            && (room.GameplayState == null || room.GameplayState.FinalAccusationSnapshot == null
                || room.GameplayState.FinalAccusationSnapshot.CaseDefinitionSnapshot == null);

    internal static System.Linq.Expressions.Expression<Func<GameResult, bool>> ReferencingLegacyResult(string caseId) =>
        result => result.CaseId == caseId && result.CaseDefinitionSnapshot == null;

    private static readonly string[] CrackDemoFiles =
    [
        "case-v3-broken-seal-en.json",
        "case-v3-broken-seal-vi.json"
    ];

    private static readonly string[] PointClickDemoFiles =
    [
        "case-point-click-night-ledger-en.json",
        "case-point-click-night-ledger-vi.json"
    ];

    /// <summary>Hand-authored PixelLab case: one outdoor map, five interiors, pixel render mode.</summary>
    private static readonly string[] PixelDemoFiles =
    [
        "case-pixel-lo-thuoc-thu-nam-vi.json",
        "case-pixel-tram-hong-ngoc-vi.json"
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    private readonly MongoDbContext _db;
    private readonly CaseCache _cache;
    private readonly ICaseValidationService _validator;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<CaseService> _logger;
    private readonly GameplayV3Settings _gameplayV3Settings;
    private readonly CaseCatalogPolicy _catalog;

    public CaseService(
        MongoDbContext db,
        CaseCache cache,
        ICaseValidationService validator,
        IOptions<GameplayV3Settings> gameplayV3Settings,
        IWebHostEnvironment env,
        ILogger<CaseService> logger,
        CaseCatalogPolicy? catalog = null)
    {
        _catalog = catalog ?? CaseCatalogPolicy.Open;
        _db = db;
        _cache = cache;
        _validator = validator;
        _gameplayV3Settings = gameplayV3Settings.Value;
        _env = env;
        _logger = logger;
    }

    public async Task<List<CaseSummaryResponse>> GetPublishedAsync()
    {
        var published = await _cache.GetPublishedAsync(async () =>
        {
            var cases = await _db.Cases.Find(c => c.Status == CaseStatus.Published)
                .SortByDescending(c => c.UpdatedAt).ToListAsync();
            return cases.Select(CaseSummaryResponse.From).ToList();
        });
        // Filtered after the cache so changing the catalogue setting never leaves a stale list behind.
        return published.Where(_catalog.IsPlayable).ToList();
    }

    public async Task<CasePublicDetailResponse> GetPublicDetailAsync(string caseId)
    {
        var gameCase = await GetCaseAsync(caseId);
        if (!_catalog.IsPlayable(gameCase))
        {
            throw ApiException.NotFound("Case not found.");
        }
        return CasePublicDetailResponse.FromCase(gameCase);
    }

    public async Task<List<CaseSummaryResponse>> GetAllForAdminAsync()
    {
        var all = await _cache.GetAdminListAsync(() => LoadAdminListAsync(_db));
        // Copies, so the cached summaries are never mutated; the flag tells admins what players can see.
        return all.Select(summary => summary.WithPlayerVisible(_catalog.IsPlayable(summary))).ToList();
    }

    /// <summary>The cached admin list of every stored case (shared with <see cref="LegacyCaseCatalog"/>).</summary>
    internal static async Task<List<CaseSummaryResponse>> LoadAdminListAsync(MongoDbContext db)
    {
        var cases = await db.Cases.Find(_ => true).SortByDescending(c => c.UpdatedAt).ToListAsync();
        return cases.Select(CaseSummaryResponse.From).ToList();
    }

    public Task<GameCase> GetCaseAsync(string caseId) =>
        _cache.GetCaseAsync(caseId, async () =>
            await FindCaseAsync(caseId) ?? throw ApiException.NotFound("Case not found."));

    public Task<GameCase?> FindCaseAsync(string caseId) =>
        _db.Cases.Find(c => c.CaseId == caseId).FirstOrDefaultAsync()!;

    public GameCase ParseCase(JsonElement caseJson) => ParseCase(caseJson.GetRawText());

    public GameCase ParseCase(string caseJson)
    {
        if (string.IsNullOrWhiteSpace(caseJson))
        {
            throw ApiException.BadRequest("Case JSON is empty.");
        }

        GameCase? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<GameCase>(caseJson, JsonOptions);
        }
        catch (JsonException ex)
        {
            throw ApiException.BadRequest($"Case JSON could not be parsed: {ex.Message}");
        }

        if (parsed is null)
        {
            throw ApiException.BadRequest("Case JSON is empty.");
        }

        // System.Text.Json permits explicit null values for collection properties.
        // Reject those at the input boundary with a field-level validation error
        // instead of allowing a later validator/serializer dereference to become 500.
        var missingCollections = new List<string>();
        if (parsed.Stages is null) missingCollections.Add("stages");
        if (parsed.Characters is null) missingCollections.Add("characters");
        if (parsed.Items is null) missingCollections.Add("items");
        if (parsed.Clues is null) missingCollections.Add("clues");
        if (parsed.Dialogues is null) missingCollections.Add("dialogues");
        if (parsed.ConversationNodes is null) missingCollections.Add("conversationNodes");
        if (parsed.TestimonyFragments is null) missingCollections.Add("testimonyFragments");
        if (parsed.EvidenceChallenges is null) missingCollections.Add("evidenceChallenges");
        if (parsed.Deductions is null) missingCollections.Add("deductions");
        if (parsed.RequiredTeamworkChains is null) missingCollections.Add("requiredTeamworkChains");
        if (parsed.Hints is null) missingCollections.Add("hints");
        if (parsed.Interactions is null) missingCollections.Add("interactions");
        if (parsed.Puzzles is null) missingCollections.Add("puzzles");
        if (parsed.AlternateRewardPaths is null) missingCollections.Add("alternateRewardPaths");
        if (parsed.FinalLogic is null) missingCollections.Add("finalLogic");
        if (missingCollections.Count > 0)
        {
            throw ApiException.Unprocessable(
                "Case JSON contains null collection fields.",
                missingCollections.Select(field => new { field, code = "REQUIRED_COLLECTION" }).ToList());
        }

        parsed.Id = string.Empty; // never trust incoming _id
        return parsed;
    }

    public CaseValidationResponse ValidateJson(JsonElement caseJson)
    {
        var gameCase = ParseCase(caseJson);
        var result = _validator.Validate(gameCase);
        return new CaseValidationResponse { IsValid = result.IsValid, Errors = result.Errors, Warnings = result.Warnings };
    }

    public async Task<CaseValidationResponse> ValidateJsonForImportAsync(JsonElement caseJson)
    {
        var gameCase = ParseCase(caseJson);
        var result = _validator.Validate(gameCase);
        // The admin import strips AI metadata, so judge the case as a manual import would.
        if (await IsNewCaseAsync(gameCase.CaseId)) result.RequireHints();
        return new CaseValidationResponse { IsValid = result.IsValid, Errors = result.Errors, Warnings = result.Warnings };
    }

    /// <summary>Case IDs that ship with the server (seed and demo files). They predate the hint rule and only warn.</summary>
    private static readonly IReadOnlySet<string> BundledCaseIds = CrackDemoFiles
        .Concat(PointClickDemoFiles).Concat(PixelDemoFiles).Append(TutorialRules.CaseFile)
        .Select(Path.GetFileNameWithoutExtension)
        .OfType<string>()
        .Concat(["case-week2-manor", "case-demo-opera-diamond"])
        .ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// A "new case" for the hint rule (VUAN-6): its caseId is neither in the database nor bundled with the server.
    /// Cases that already exist (published or not) keep missing hints as warnings.
    /// </summary>
    private async Task<bool> IsNewCaseAsync(string caseId) =>
        !BundledCaseIds.Contains(caseId) && await FindCaseAsync(caseId) is null;

    public async Task<CaseSummaryResponse> ImportJsonAsync(JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false)
    {
        var gameCase = ParseCase(caseJson);
        if (!preserveServerMetadata)
        {
            gameCase.GenerationPreset = string.Empty;
            gameCase.SourceAiDraftId = string.Empty;
            gameCase.AuthorUserId = string.Empty;
            gameCase.AiSemanticReviewStatus = string.Empty;
            gameCase.LogicContractVersion = CaseLogicContractVersions.LegacyThreeClaim;
            gameCase.LogicVerificationStatus = CaseLogicVerificationStatuses.LegacyUnverified;
            gameCase.TruthSchemaVersion = string.Empty;
            gameCase.TruthHash = string.Empty;
            gameCase.BlindReviewStatus = string.Empty;
            gameCase.ProjectionSchemaVersion = string.Empty;
            gameCase.ProjectionPlanHash = string.Empty;
            gameCase.ProjectionCompilerVersion = string.Empty;
            gameCase.ProjectionBuildMode = string.Empty;
        }
        // AI-sourced cases (bridge import, metadata kept) were held to the hint rule by the AI pipeline itself.
        var requireHints = string.IsNullOrWhiteSpace(gameCase.SourceAiDraftId) && await IsNewCaseAsync(gameCase.CaseId);
        return await UpsertValidatedAsync(gameCase, overwrite, forceDraft: true, requireHints);
    }

    public async Task<CaseSummaryResponse> PublishAsync(string caseId)
    {
        // The newcomer tutorial is played only through its solo room; publishing it would put it in the catalogue.
        if (TutorialRules.IsTutorialCase(caseId))
            throw ApiException.Conflict("Màn tân thủ không đăng công khai; người chơi vào qua nút Màn tân thủ.",
                "TUTORIAL_NOT_PUBLISHABLE", "tutorial.notPublishable");
        var gameCase = await GetCaseAsync(caseId);

        if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation
            && !_gameplayV3Settings.Enabled)
            throw ApiException.Conflict(
                "V3 gameplay is not enabled for publishing.",
                "V3_NOT_ENABLED",
                "game.confrontation.disabled");
        if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation
            && !string.IsNullOrWhiteSpace(gameCase.SourceAiDraftId))
        {
            if (gameCase.GenerationMode != CaseGenerationModes.CameraEmbedded
                || gameCase.MechanicsVersion != CaseMechanicsVersions.InvestigationV3PairedConfrontation
                || string.IsNullOrWhiteSpace(gameCase.SourceAiDraftId)
                || gameCase.AiSemanticReviewStatus != AiV3SemanticReviewStatuses.Passed)
                throw ApiException.Conflict(
                    "The AI-generated V3 case has not passed its canonical semantic review gate.",
                    "AI_V3_SEMANTIC_REVIEW_REQUIRED",
                    "ai.v3Preset.semanticReviewRequired");
        }
        if (gameCase.LogicContractVersion >= CaseLogicContractVersions.CausalFiveClaim
            && !string.IsNullOrWhiteSpace(gameCase.SourceAiDraftId)
            && (gameCase.TruthSchemaVersion is not (CaseTruthSchemaVersions.V1 or CaseTruthSchemaVersions.V2)
                || string.IsNullOrWhiteSpace(gameCase.TruthHash)
                || gameCase.LogicVerificationStatus != CaseLogicVerificationStatuses.CausalVerified))
            throw ApiException.Conflict(
                "The AI case has not passed its immutable deterministic truth gate.",
                "AI_CASE_TRUTH_REQUIRED",
                "ai.caseTruth.required");

        // Never publish a case that no longer passes deterministic validation.
        var validation = _validator.Validate(gameCase);
        if (gameCase.MechanicsVersion == CaseMechanicsVersions.InvestigationV3PairedConfrontation
            && !string.IsNullOrWhiteSpace(gameCase.SourceAiDraftId))
            validation.Errors.AddRange(AiV3GenerationProfile.Validate(gameCase).Errors);
        if (!validation.IsValid)
        {
            throw ApiException.Unprocessable("Case validation failed; it cannot be published.", validation.Errors);
        }

        // The hint rule only warns here: a new case met it at import, an older one is never blocked by it.
        var published = await SetStatusAsync(gameCase, CaseStatus.Published);
        if (validation.Warnings.Count > 0) published.ValidationWarnings = validation.Warnings;
        return published;
    }

    /// <summary>The case as camelCase JSON, the shape every import and the admin JSON view use.</summary>
    public static string SerializeCase(GameCase gameCase) => JsonSerializer.Serialize(gameCase, JsonOptions);

    /// <summary>
    /// Case Studio save: replaces an unpublished case in place, whatever its validation says (a draft may be half done;
    /// publishing is what is gated). A published case is never replaced here. Only playtest rooms may be open on it:
    /// another active room would see its definition change under the players, as <see cref="ImportJsonAsync"/> refuses.
    /// </summary>
    public async Task<GameCase> ReplaceDraftAsync(GameCase gameCase)
    {
        var existing = await FindCaseAsync(gameCase.CaseId) ?? throw ApiException.NotFound("Case not found.");
        if (!string.Equals(existing.Status, CaseStatus.Draft, StringComparison.OrdinalIgnoreCase))
            throw ApiException.Conflict("Vụ đã xuất bản: gỡ xuất bản trước khi sửa.", "CASE_EDITOR_PUBLISHED", "caseEditor.published");
        var activeRoom = await _db.Rooms.Find(ReferencingActiveCase(gameCase.CaseId))
            .ToListAsync();
        if (activeRoom.FirstOrDefault(room => room.Playtest is null) is { } room)
            throw ApiException.Conflict(
                $"Case '{gameCase.CaseId}' is played in room '{room.RoomCode}'. Wait for that room to finish before editing it.",
                "CASE_IMMUTABLE_WHILE_ACTIVE",
                "case.immutableWhileActive");
        // Same rule as the import: results recorded without a copy of the case would change meaning.
        var legacyRoom = await _db.Rooms.Find(ReferencingLegacyCompletedCase(gameCase.CaseId)).Limit(1).FirstOrDefaultAsync();
        var legacyResult = await _db.GameResults.Find(ReferencingLegacyResult(gameCase.CaseId)).Limit(1).FirstOrDefaultAsync();
        if (legacyRoom is not null || legacyResult is not null)
            throw ApiException.Conflict(
                $"Case '{gameCase.CaseId}' has historical results without an original definition snapshot. Import the revised case under a new caseId to preserve those results.",
                "CASE_IMMUTABLE_FOR_LEGACY_RESULT",
                "case.immutableForLegacyResult");

        gameCase.Id = existing.Id;
        gameCase.Status = CaseStatus.Draft;
        gameCase.CreatedAt = existing.CreatedAt;
        gameCase.UpdatedAt = DateTime.UtcNow;
        var replaced = await _db.Cases.ReplaceOneAsync(
            c => c.Id == existing.Id && c.Status == CaseStatus.Draft,
            gameCase);
        _cache.Invalidate(gameCase.CaseId);
        if (replaced.MatchedCount == 0)
            throw ApiException.Conflict("Vụ đã xuất bản: gỡ xuất bản trước khi sửa.", "CASE_EDITOR_PUBLISHED", "caseEditor.published");
        return gameCase;
    }

    public async Task<CaseSummaryResponse> UnpublishAsync(string caseId)
    {
        var gameCase = await GetCaseAsync(caseId);
        return await SetStatusAsync(gameCase, CaseStatus.Draft);
    }

    public async Task<CaseSummaryResponse> SeedSampleAsync(bool publish)
    {
        var gameCase = LoadSeedCase();
        var summary = await UpsertValidatedAsync(gameCase, overwrite: true, forceDraft: !publish);
        if (publish)
        {
            summary = await PublishAsync(gameCase.CaseId);
        }
        return summary;
    }

    public async Task<List<CaseSummaryResponse>> SeedDemoAsync()
    {
        var results = new List<CaseSummaryResponse> { await SeedSampleAsync(publish: true) };

        // Second, smaller demo case generated by the deterministic mock factory.
        var demo = MockCaseFactory.Create(
            "A stolen opera diamond vanishes from a sealed dressing room during the final aria",
            stageCount: 3,
            difficulty: "easy",
            caseId: "case-demo-opera-diamond");
        await UpsertValidatedAsync(demo, overwrite: true, forceDraft: false);
        results.Add(await PublishAsync(demo.CaseId));
        return results;
    }

    public async Task<List<CaseSummaryResponse>> SeedCrackDemoAsync()
    {
        var results = new List<CaseSummaryResponse>(CrackDemoFiles.Length);
        foreach (var fileName in CrackDemoFiles)
        {
            var gameCase = LoadBundledDemoCase(fileName);
            await UpsertValidatedAsync(gameCase, overwrite: true, forceDraft: true);
            results.Add(await PublishAsync(gameCase.CaseId));
        }
        return results;
    }

    public async Task<List<CaseSummaryResponse>> SeedPointClickDemoAsync()
    {
        var results = new List<CaseSummaryResponse>(PointClickDemoFiles.Length);
        foreach (var fileName in PointClickDemoFiles)
        {
            var gameCase = LoadBundledDemoCase(fileName);
            await UpsertValidatedAsync(gameCase, overwrite: true, forceDraft: true);
            results.Add(await PublishAsync(gameCase.CaseId));
        }
        return results;
    }

    public async Task<List<CaseSummaryResponse>> SeedPixelDemoAsync()
    {
        var results = new List<CaseSummaryResponse>(PixelDemoFiles.Length);
        foreach (var fileName in PixelDemoFiles)
        {
            var gameCase = LoadBundledDemoCase(fileName);
            try
            {
                await UpsertValidatedAsync(gameCase, overwrite: true, forceDraft: true);
            }
            catch (ApiException error) when (error.Errors is ApiErrorDetails { Code: "CASE_IMMUTABLE_WHILE_ACTIVE" })
            {
                // A room is still playing this case: keep the published copy and seed the others.
                _logger.LogWarning("Pixel demo {CaseId} left unchanged: {Message}", gameCase.CaseId, error.Message);
                var existing = await _db.Cases.Find(c => c.CaseId == gameCase.CaseId).FirstOrDefaultAsync();
                if (existing is not null) results.Add(CaseSummaryResponse.From(existing));
                continue;
            }
            results.Add(await PublishAsync(gameCase.CaseId));
        }
        return results;
    }

    /// <summary>
    /// Startup seeding: inserts only the bundled pixel cases that are not in the database yet. A case that
    /// already exists (even unpublished, even edited by an admin) is never touched; the admin button
    /// "seed-pixel-demo" is what refreshes content.
    /// </summary>
    public async Task<IReadOnlyList<string>> SeedMissingPixelCasesAsync(CancellationToken ct = default)
    {
        var seeded = new List<string>();
        foreach (var fileName in PixelDemoFiles)
        {
            ct.ThrowIfCancellationRequested();
            var caseId = Path.GetFileNameWithoutExtension(fileName);
            if (await FindCaseAsync(caseId) is not null) continue;
            try
            {
                var gameCase = LoadBundledDemoCase(fileName);
                await UpsertValidatedAsync(gameCase, overwrite: false, forceDraft: true);
                await PublishAsync(gameCase.CaseId);
                seeded.Add(gameCase.CaseId);
            }
            catch (ApiException error) when (error.StatusCode == 409)
            {
                // Another API instance seeded it first.
                _logger.LogInformation("Pixel case {CaseId} was seeded by another instance.", caseId);
            }
        }
        return seeded;
    }

    public async Task<GameCase> EnsureTutorialCaseAsync(CancellationToken ct = default)
    {
        var existing = await FindCaseAsync(TutorialRules.CaseId);
        if (existing is null || Interlocked.Exchange(ref _tutorialRefreshed, 1) == 0)
        {
            ct.ThrowIfCancellationRequested();
            var bundled = LoadBundledDemoCase(TutorialRules.CaseFile);
            try
            {
                await UpsertValidatedAsync(bundled, overwrite: true, forceDraft: true);
            }
            catch (ApiException error) when (existing is not null
                && error.Errors is ApiErrorDetails { Code: "CASE_IMMUTABLE_WHILE_ACTIVE" })
            {
                // Someone is playing the tutorial right now: keep the stored copy until the next restart.
                _logger.LogWarning("Tutorial case left unchanged while a tutorial room is active.");
            }
            catch (ApiException error) when (existing is null && error.StatusCode == 409)
            {
                _logger.LogInformation("Tutorial case was seeded by another instance.");
            }
        }
        return await GetCaseAsync(TutorialRules.CaseId);
    }

    private async Task<CaseSummaryResponse> UpsertValidatedAsync(GameCase gameCase, bool overwrite, bool forceDraft, bool requireHints = false)
    {
        if (forceDraft)
        {
            gameCase.Status = CaseStatus.Draft;
        }

        // Interactive puzzles get their per-case answers here (deterministic per case and puzzle).
        Services.PuzzleKinds.PuzzleKindRegistry.FillMissing(gameCase);
        var validation = _validator.Validate(gameCase);
        if (requireHints) validation.RequireHints();
        if (!validation.IsValid)
        {
            throw ApiException.Unprocessable("Case validation failed.", validation.Errors);
        }

        var existing = await FindCaseAsync(gameCase.CaseId);
        if (existing is not null)
        {
            if (!overwrite)
            {
                throw ApiException.Conflict($"A case with caseId '{gameCase.CaseId}' already exists. Use overwrite to replace it.");
            }

            // A room stores only the caseId and resolves the definition at runtime.
            // Replacing a published/in-progress definition would therefore mutate an
            // active session underneath its players.  Publish a new caseId instead.
            var activeRoom = await _db.Rooms.Find(ReferencingActiveCase(gameCase.CaseId))
                .Limit(1)
                .FirstOrDefaultAsync();
            if (activeRoom is not null)
            {
                throw ApiException.Conflict(
                    $"Case '{gameCase.CaseId}' is referenced by active room '{activeRoom.RoomCode}'. Import it under a new caseId after that room finishes.",
                    "CASE_IMMUTABLE_WHILE_ACTIVE",
                    "case.immutableWhileActive");
            }

            // Historical records have no original answer/label definition. Keep their
            // existing case intact rather than inventing a snapshot from a replacement.
            var legacyRoom = await _db.Rooms.Find(ReferencingLegacyCompletedCase(gameCase.CaseId))
                .Limit(1).FirstOrDefaultAsync();
            var legacyResult = await _db.GameResults.Find(ReferencingLegacyResult(gameCase.CaseId))
                .Limit(1).FirstOrDefaultAsync();
            if (legacyRoom is not null || legacyResult is not null)
            {
                throw ApiException.Conflict(
                    $"Case '{gameCase.CaseId}' has historical results without an original definition snapshot. Import the revised case under a new caseId to preserve those results.",
                    "CASE_IMMUTABLE_FOR_LEGACY_RESULT",
                    "case.immutableForLegacyResult");
            }

            // Case Studio edits are kept as a saved copy before the import replaces them.
            await CaseEditor.CaseEditorImportGuard.KeepEditedCopyAsync(_db, existing);
            gameCase.Id = existing.Id;
            gameCase.CreatedAt = existing.CreatedAt;
            gameCase.UpdatedAt = DateTime.UtcNow;
            await _db.Cases.ReplaceOneAsync(c => c.Id == existing.Id, gameCase);
        }
        else
        {
            gameCase.CreatedAt = DateTime.UtcNow;
            gameCase.UpdatedAt = DateTime.UtcNow;
            await _db.Cases.InsertOneAsync(gameCase);
        }

        _cache.Invalidate(gameCase.CaseId);
        _logger.LogInformation("Case '{CaseId}' imported/seeded with status {Status}.", gameCase.CaseId, gameCase.Status);
        var summary = CaseSummaryResponse.From(gameCase);
        if (validation.Warnings.Count > 0) summary.ValidationWarnings = validation.Warnings;
        return summary;
    }

    private async Task<CaseSummaryResponse> SetStatusAsync(GameCase gameCase, string status)
    {
        var update = Builders<GameCase>.Update
            .Set(c => c.Status, status)
            .Set(c => c.UpdatedAt, DateTime.UtcNow);
        await _db.Cases.UpdateOneAsync(c => c.Id == gameCase.Id, update);
        gameCase.Status = status;
        gameCase.UpdatedAt = DateTime.UtcNow;
        _cache.Invalidate(gameCase.CaseId);
        return CaseSummaryResponse.From(gameCase);
    }

    private GameCase LoadSeedCase()
    {
        // Prefer the canonical doc sample so docs and seed never drift; fall back to the bundled copy.
        var candidates = new[]
        {
            FindUpwards("ai-game-docs/samples/sample-case.json"),
            Path.Combine(_env.ContentRootPath, "SeedData", "sample-case.json"),
            Path.Combine(AppContext.BaseDirectory, "SeedData", "sample-case.json")
        };

        var path = candidates.FirstOrDefault(p => p is not null && File.Exists(p));
        if (path is null)
        {
            throw ApiException.NotFound("sample-case.json seed file was not found.");
        }

        return ParseCase(File.ReadAllText(path));
    }

    private GameCase LoadBundledDemoCase(string fileName)
    {
        if (!CrackDemoFiles.Concat(PointClickDemoFiles).Concat(PixelDemoFiles).Append(TutorialRules.CaseFile).Contains(fileName, StringComparer.Ordinal))
        {
            throw new InvalidOperationException($"Unsupported demo fixture '{fileName}'.");
        }

        var candidates = new[]
        {
            Path.Combine(_env.ContentRootPath, "SeedData", "V3", fileName),
            Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", fileName)
        };
        var path = candidates.FirstOrDefault(File.Exists)
            ?? throw ApiException.NotFound($"Demo fixture '{fileName}' was not found.");
        var gameCase = ParseCase(File.ReadAllText(path));
        var expectedCaseId = Path.GetFileNameWithoutExtension(fileName);
        if (!string.Equals(gameCase.CaseId, expectedCaseId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Demo fixture '{fileName}' declared unexpected caseId '{gameCase.CaseId}'.");
        }
        return gameCase;
    }

    private string? FindUpwards(string relativePath)
    {
        var dir = new DirectoryInfo(_env.ContentRootPath);
        for (var depth = 0; dir is not null && depth < 6; depth++, dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, relativePath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
