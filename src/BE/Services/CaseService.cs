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

public class CaseService : ICaseService
{
    private static readonly string[] CrackDemoFiles =
    [
        "case-v3-broken-seal-en.json",
        "case-v3-broken-seal-vi.json"
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

    public CaseService(
        MongoDbContext db,
        CaseCache cache,
        ICaseValidationService validator,
        IOptions<GameplayV3Settings> gameplayV3Settings,
        IWebHostEnvironment env,
        ILogger<CaseService> logger)
    {
        _db = db;
        _cache = cache;
        _validator = validator;
        _gameplayV3Settings = gameplayV3Settings.Value;
        _env = env;
        _logger = logger;
    }

    public Task<List<CaseSummaryResponse>> GetPublishedAsync() =>
        _cache.GetPublishedAsync(async () =>
        {
            var cases = await _db.Cases.Find(c => c.Status == CaseStatus.Published)
                .SortByDescending(c => c.UpdatedAt).ToListAsync();
            return cases.Select(CaseSummaryResponse.From).ToList();
        });

    public async Task<CasePublicDetailResponse> GetPublicDetailAsync(string caseId)
    {
        var gameCase = await GetCaseAsync(caseId);
        if (gameCase.Status != CaseStatus.Published)
        {
            throw ApiException.NotFound("Case not found.");
        }
        return CasePublicDetailResponse.FromCase(gameCase);
    }

    public Task<List<CaseSummaryResponse>> GetAllForAdminAsync() =>
        _cache.GetAdminListAsync(async () =>
        {
            var cases = await _db.Cases.Find(_ => true).SortByDescending(c => c.UpdatedAt).ToListAsync();
            return cases.Select(CaseSummaryResponse.From).ToList();
        });

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
        return new CaseValidationResponse { IsValid = result.IsValid, Errors = result.Errors };
    }

    public async Task<CaseSummaryResponse> ImportJsonAsync(JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false)
    {
        var gameCase = ParseCase(caseJson);
        if (!preserveServerMetadata)
        {
            gameCase.GenerationPreset = string.Empty;
            gameCase.SourceAiDraftId = string.Empty;
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
        return await UpsertValidatedAsync(gameCase, overwrite, forceDraft: true);
    }

    public async Task<CaseSummaryResponse> PublishAsync(string caseId)
    {
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

        return await SetStatusAsync(gameCase, CaseStatus.Published);
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
            var gameCase = LoadBundledCrackCase(fileName);
            await UpsertValidatedAsync(gameCase, overwrite: true, forceDraft: true);
            results.Add(await PublishAsync(gameCase.CaseId));
        }
        return results;
    }

    private async Task<CaseSummaryResponse> UpsertValidatedAsync(GameCase gameCase, bool overwrite, bool forceDraft)
    {
        if (forceDraft)
        {
            gameCase.Status = CaseStatus.Draft;
        }

        var validation = _validator.Validate(gameCase);
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
            var activeRoom = await _db.Rooms.Find(room =>
                    room.CaseId == gameCase.CaseId
                    && (room.Status == RoomStatus.Waiting || room.Status == RoomStatus.InProgress))
                .Limit(1)
                .FirstOrDefaultAsync();
            if (activeRoom is not null)
            {
                throw ApiException.Conflict(
                    $"Case '{gameCase.CaseId}' is referenced by active room '{activeRoom.RoomCode}'. Import it under a new caseId after that room finishes.",
                    "CASE_IMMUTABLE_WHILE_ACTIVE",
                    "case.immutableWhileActive");
            }

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
        return CaseSummaryResponse.From(gameCase);
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

    private GameCase LoadBundledCrackCase(string fileName)
    {
        if (!CrackDemoFiles.Contains(fileName, StringComparer.Ordinal))
        {
            throw new InvalidOperationException($"Unsupported Crack demo fixture '{fileName}'.");
        }

        var candidates = new[]
        {
            Path.Combine(_env.ContentRootPath, "SeedData", "V3", fileName),
            Path.Combine(AppContext.BaseDirectory, "SeedData", "V3", fileName)
        };
        var path = candidates.FirstOrDefault(File.Exists)
            ?? throw ApiException.NotFound($"Crack demo fixture '{fileName}' was not found.");
        var gameCase = ParseCase(File.ReadAllText(path));
        var expectedCaseId = Path.GetFileNameWithoutExtension(fileName);
        if (!string.Equals(gameCase.CaseId, expectedCaseId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"Crack demo fixture '{fileName}' declared unexpected caseId '{gameCase.CaseId}'.");
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
