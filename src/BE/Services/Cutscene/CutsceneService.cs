using System.Text.Json;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Cutscene;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Cutscene;

/// <summary>Stores, approves and serves case cutscenes. Players only ever receive the APPROVED version.</summary>
public sealed class CutsceneService(
    ICutsceneStore store,
    ICaseService cases,
    CaseCatalogPolicy catalog,
    CutsceneScriptGenerator generator,
    IOptions<CutsceneSettings> settings,
    AiBridgeRequestStore bridgeRequests,
    IOptions<AiGenerationSettings> generation,
    ILogger<CutsceneService> logger,
    MongoDbContext? db = null)
{
    private const string Trigger = CutsceneTriggers.Intro;
    private const string PipelineRunPrefix = "import-intro-";

    // ---------------------------------------------------------------- players

    /// <summary>
    /// The approved intro for a case players can open, or null (no cutscene, disabled, or the case is hidden).
    /// <paramref name="playtest"/>: the caller sits in a playtest room of this unpublished case, so it is shown anyway.
    /// </summary>
    public async Task<PlayerCutsceneDto?> GetPlayerIntroAsync(string caseId, CancellationToken ct = default, bool playtest = false)
    {
        if (!settings.Value.Enabled) return null;
        var gameCase = await cases.FindCaseAsync(caseId);
        // The newcomer tutorial stays a draft (never in the catalogue) but still opens with its intro.
        if (gameCase is null || (!playtest && !catalog.IsPlayable(gameCase) && !TutorialRules.IsTutorialCase(gameCase.CaseId))) return null;
        var approved = (await store.ListAsync(caseId, Trigger, ct)).FirstOrDefault(c => c.Status == CutsceneStatus.Approved);
        var script = approved is null ? null : TryParse(approved.ScriptJson);
        if (approved is null || script is null) return null;
        return new PlayerCutsceneDto { CaseId = caseId, Trigger = Trigger, Version = approved.Version, Script = script, Assets = BuildAssets(gameCase) };
    }

    // ---------------------------------------------------------------- admin

    public async Task<AdminCutsceneDto> GetAdminAsync(string caseId, CancellationToken ct = default)
    {
        var gameCase = await cases.GetCaseAsync(caseId);
        var versions = await store.ListAsync(caseId, Trigger, ct);
        var latest = versions.FirstOrDefault();
        var pending = await OpenRunAsync(caseId, versions, ct);
        return new AdminCutsceneDto
        {
            CaseId = caseId,
            ClaudeRequest = pending is null ? null : new CutsceneClaudeRequestDto
            {
                RequestId = pending.Id,
                Step = pending.Step,
                Status = pending.Status,
                CreatedAt = pending.CreatedAt
            },
            Versions = versions.Select(ToVersionDto).ToList(),
            Latest = latest is null ? null : ToVersionDto(latest),
            Script = latest is null ? null : TryParse(latest.ScriptJson),
            Assets = BuildAssets(gameCase)
        };
    }

    /// <summary>
    /// Queues the script for Claude (or continues the run already queued). The admin sees "waiting for Claude" until
    /// the bot answers through the bridge; the answer then becomes a new DRAFT version.
    /// </summary>
    public async Task<AdminCutsceneDto> GenerateAsync(string caseId, bool regenerate, string actor, CancellationToken ct = default)
    {
        await cases.GetCaseAsync(caseId);
        var existing = await store.ListAsync(caseId, Trigger, ct);
        var open = await OpenRunAsync(caseId, existing, ct);
        if (open is null && existing.Count > 0 && !regenerate)
            throw ApiException.Conflict("This case already has a cutscene. Asking Claude again replaces the draft; confirm to continue.",
                "CUTSCENE_REGENERATE_CONFIRM", "cutscene.regenerate.confirm");
        var runId = open?.GenerationRunId
            ?? (actor == "ai-pipeline" && existing.Count == 0 ? PipelineRunPrefix : "") + Guid.NewGuid().ToString("N");
        return await RunAsync(caseId, runId, actor, ct);
    }

    /// <summary>Called by the bridge after the bot answered a CUTSCENE request: replays the run with its answers.</summary>
    public async Task<AdminCutsceneDto> ContinueFromBridgeAsync(string caseId, string generationRunId, CancellationToken ct = default) =>
        await RunAsync(caseId, generationRunId, "claude-bridge", ct);

    private async Task<AdminCutsceneDto> RunAsync(string caseId, string generationRunId, string actor, CancellationToken ct)
    {
        var gameCase = await cases.GetCaseAsync(caseId);
        var existing = await store.ListAsync(caseId, Trigger, ct);
        var fromImport = generationRunId.StartsWith(PipelineRunPrefix, StringComparison.Ordinal)
            && !string.IsNullOrEmpty(gameCase.SourceAiDraftId);
        var stored = existing.FirstOrDefault(version => version.GenerationRunId == generationRunId);
        if (stored is not null)
        {
            var ready = stored.Status == CutsceneStatus.Approved;
            if (fromImport && stored.Status == CutsceneStatus.Draft && stored.Source != "MANUAL" && existing.Count == 1)
            {
                await ApproveAsync(caseId, stored.Id, actor, ct);
                ready = true;
            }
            if (fromImport && ready)
                await SaveImportIntroStatusAsync(gameCase, AiIntroCutsceneStatuses.Ready, ct);
            return await GetAdminAsync(caseId, ct);
        }
        CutsceneGenerationResult result;
        try
        {
            result = await generator.GenerateAsync(gameCase, generationRunId, ct);
        }
        catch (AiAwaitingClaudeException)
        {
            return await GetAdminAsync(caseId, ct);
        }
        catch (ApiException) when (fromImport)
        {
            await SaveImportIntroStatusAsync(gameCase, AiIntroCutsceneStatuses.Failed, ct);
            throw;
        }
        var saved = await InsertNextVersionAsync(caseId, existing, result.ScriptJson, result.Script, result.Mock ? "MOCK" : "CLAUDE",
            result.Model, actor, ct, generationRunId);
        // A later admin edit or regeneration keeps the normal approval workflow.
        if (settings.Value.AutoApprove
            || (fromImport && existing.Count == 0 && (await store.ListAsync(caseId, Trigger, ct)).Count == 1))
        {
            await ApproveAsync(caseId, saved.Id, actor, ct);
            if (fromImport) await SaveImportIntroStatusAsync(gameCase, AiIntroCutsceneStatuses.Ready, ct);
        }
        return await GetAdminAsync(caseId, ct);
    }

    private async Task SaveImportIntroStatusAsync(GameCase gameCase, string status, CancellationToken ct)
    {
        if (db is null) return;
        await db.AiCaseDrafts.UpdateOneAsync(
            d => d.Id == gameCase.SourceAiDraftId && d.ImportedCaseId == gameCase.CaseId
                && d.IntroCutsceneStatus != status,
            Builders<AiCaseDraft>.Update.Set(d => d.IntroCutsceneStatus, status)
                .Set(d => d.IntroCutsceneFinishedAt, DateTime.UtcNow), cancellationToken: ct);
    }

    /// <summary>The newest Claude run of this case that has not produced a version yet.</summary>
    private async Task<AiBridgeRequest?> OpenRunAsync(string caseId, List<CaseCutscene> versions, CancellationToken ct)
    {
        if (generation.Value.BlocksAiCalls) return null; // Mock mode answers at once and never queues a request.
        var requests = await bridgeRequests.ListForOwnerAsync(AiBridgeOwnerTypes.Cutscene, caseId, ct);
        var latest = requests.LastOrDefault(request => request.Status is not (AiBridgeStatuses.Stale or AiBridgeStatuses.Cancelled));
        if (latest is null || versions.Any(version => version.GenerationRunId == latest.GenerationRunId)) return null;
        if (latest.Step == "CutsceneScriptRepair" && AiBridgeStatuses.Answered.Contains(latest.Status)) return null;
        return latest;
    }

    /// <summary>Saves an admin edit. Editing a draft changes it in place; editing anything else starts a new draft version.</summary>
    public async Task<AdminCutsceneDto> UpdateScriptAsync(string caseId, string id, MotionComicScript script, string actor, CancellationToken ct = default)
    {
        var gameCase = await cases.GetCaseAsync(caseId);
        var current = await RequireAsync(caseId, id, ct);
        Require(script, gameCase);
        var json = JsonSerializer.Serialize(script, CutsceneScriptGenerator.JsonOptions);
        if (current.Status == CutsceneStatus.Draft)
        {
            current.ScriptJson = json; current.Source = "MANUAL"; current.EstimatedSeconds = MotionComicRules.EstimateSeconds(script);
            current.UpdatedAt = DateTime.UtcNow;
            await store.ReplaceAsync(current, ct);
        }
        else
        {
            await InsertNextVersionAsync(caseId, await store.ListAsync(caseId, Trigger, ct), json, script, "MANUAL", current.Model, actor, ct);
        }
        return await GetAdminAsync(caseId, ct);
    }

    public async Task<AdminCutsceneDto> ApproveAsync(string caseId, string id, string actor, CancellationToken ct = default)
    {
        var gameCase = await cases.GetCaseAsync(caseId);
        var target = await RequireAsync(caseId, id, ct);
        var script = TryParse(target.ScriptJson);
        Require(script, gameCase);
        foreach (var other in (await store.ListAsync(caseId, Trigger, ct)).Where(c => c.Status == CutsceneStatus.Approved && c.Id != target.Id))
        {
            other.Status = CutsceneStatus.Superseded; other.UpdatedAt = DateTime.UtcNow;
            await store.ReplaceAsync(other, ct);
        }
        target.Status = CutsceneStatus.Approved; target.ApprovedBy = actor; target.ApprovedAt = DateTime.UtcNow; target.UpdatedAt = DateTime.UtcNow;
        await store.ReplaceAsync(target, ct);
        return await GetAdminAsync(caseId, ct);
    }

    /// <summary>Hides the cutscene from players. The versions stay, so approving one brings it back.</summary>
    public async Task<AdminCutsceneDto> DisableAsync(string caseId, CancellationToken ct = default)
    {
        await cases.GetCaseAsync(caseId);
        foreach (var approved in (await store.ListAsync(caseId, Trigger, ct)).Where(c => c.Status == CutsceneStatus.Approved))
        {
            approved.Status = CutsceneStatus.Disabled; approved.UpdatedAt = DateTime.UtcNow;
            await store.ReplaceAsync(approved, ct);
        }
        return await GetAdminAsync(caseId, ct);
    }

    /// <summary>The approved script as JSON, ready to commit as SeedData/Cutscenes/{caseId}.intro.json.</summary>
    public async Task<string?> ExportApprovedAsync(string caseId, CancellationToken ct = default)
    {
        var approved = (await store.ListAsync(caseId, Trigger, ct)).FirstOrDefault(c => c.Status == CutsceneStatus.Approved);
        var script = approved is null ? null : TryParse(approved.ScriptJson);
        return script is null ? null : JsonSerializer.Serialize(script, new JsonSerializerOptions(CutsceneScriptGenerator.JsonOptions)
        {
            WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        });
    }

    // ---------------------------------------------------------------- startup seeding

    public static string SeedFilePath(string caseId) => Path.Combine(AppContext.BaseDirectory, "SeedData", "Cutscenes", caseId + ".intro.json");

    /// <summary>
    /// Inserts approved cutscenes from the repo files for cases that have none. It never overwrites an existing version;
    /// the one exception adds a translation: when the seed file brings an English version and the approved script is
    /// exactly that file's Vietnamese text without English, the file becomes a new approved version (the old one is kept
    /// as SUPERSEDED). An approved script an admin or Claude changed is left alone.
    /// </summary>
    public async Task<IReadOnlyList<string>> SeedMissingAsync(IEnumerable<GameCase> publishedCases, CancellationToken ct = default)
    {
        var seeded = new List<string>();
        foreach (var gameCase in publishedCases)
        {
            ct.ThrowIfCancellationRequested();
            var versions = await store.ListAsync(gameCase.CaseId, Trigger, ct);
            if (versions.Count > 0)
            {
                await AddEnglishFromSeedAsync(gameCase, versions, ct);
                continue;
            }
            try
            {
                var file = SeedFilePath(gameCase.CaseId);
                if (File.Exists(file))
                {
                    var script = TryParse(await File.ReadAllTextAsync(file, ct));
                    var issues = CutsceneScriptValidator.Validate(script, gameCase);
                    if (script is null || issues.Count > 0)
                    {
                        logger.LogWarning("Skipping cutscene seed for {CaseId}: {Issue}", gameCase.CaseId, issues.FirstOrDefault()?.Message ?? "invalid JSON");
                        continue;
                    }
                    var saved = await InsertNextVersionAsync(gameCase.CaseId, new List<CaseCutscene>(), JsonSerializer.Serialize(script, CutsceneScriptGenerator.JsonOptions),
                        script, "SEED", "seed-file", "system", ct);
                    saved.Status = CutsceneStatus.Approved; saved.ApprovedAt = DateTime.UtcNow; saved.ApprovedBy = "system";
                    await store.ReplaceAsync(saved, ct);
                    seeded.Add(gameCase.CaseId);
                }
                // Scripts are written by the Claude bot only when an admin asks for one: startup never queues work.
            }
            catch (ApiException error) when (error.StatusCode == 409) { /* another instance got there first */ }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogError(error, "Cutscene seeding failed for {CaseId}; the API keeps running.", gameCase.CaseId);
            }
        }
        return seeded;
    }

    /// <summary>See <see cref="SeedMissingAsync"/>: brings the seed file's English text to an untouched approved script.</summary>
    private async Task AddEnglishFromSeedAsync(GameCase gameCase, List<CaseCutscene> versions, CancellationToken ct)
    {
        try
        {
            var approved = versions.FirstOrDefault(version => version.Status == CutsceneStatus.Approved);
            var current = approved is null ? null : TryParse(approved.ScriptJson);
            var file = SeedFilePath(gameCase.CaseId);
            if (approved is null || current is null || MotionComicRules.HasEnglish(current) || !File.Exists(file)) return;
            var seed = TryParse(await File.ReadAllTextAsync(file, ct));
            if (seed is null || !MotionComicRules.HasEnglish(seed)) return;
            string Vietnamese(MotionComicScript script) =>
                JsonSerializer.Serialize(MotionComicRules.WithoutEnglish(script), CutsceneScriptGenerator.JsonOptions);
            if (Vietnamese(seed) != Vietnamese(current))
            {
                logger.LogInformation("Cutscene {CaseId}: the approved v{Version} differs from the seed file, so its English text is not added.",
                    gameCase.CaseId, approved.Version);
                return;
            }
            var issues = CutsceneScriptValidator.Validate(seed, gameCase);
            if (issues.Count > 0)
            {
                logger.LogWarning("Cutscene {CaseId}: the English seed is not valid: {Issue}", gameCase.CaseId, issues[0].Message);
                return;
            }
            var saved = await InsertNextVersionAsync(gameCase.CaseId, versions, JsonSerializer.Serialize(seed, CutsceneScriptGenerator.JsonOptions),
                seed, "SEED", "seed-file", "system", ct);
            approved.Status = CutsceneStatus.Superseded; approved.UpdatedAt = DateTime.UtcNow;
            await store.ReplaceAsync(approved, ct);
            saved.Status = CutsceneStatus.Approved; saved.ApprovedAt = DateTime.UtcNow; saved.ApprovedBy = "system";
            await store.ReplaceAsync(saved, ct);
            logger.LogInformation("Cutscene {CaseId}: English text added as approved v{Version}.", gameCase.CaseId, saved.Version);
        }
        catch (ApiException error) when (error.StatusCode == 409) { /* another instance got there first */ }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            logger.LogError(error, "Adding the English cutscene text failed for {CaseId}; the API keeps running.", gameCase.CaseId);
        }
    }

    // ---------------------------------------------------------------- helpers

    private async Task<CaseCutscene> InsertNextVersionAsync(string caseId, List<CaseCutscene> existing, string json, MotionComicScript script,
        string source, string model, string actor, CancellationToken ct, string generationRunId = "")
    {
        var version = (existing.Count == 0 ? 0 : existing.Max(c => c.Version)) + 1;
        var cutscene = new CaseCutscene
        {
            Id = CaseCutscene.MakeId(caseId, Trigger, version), CaseId = caseId, Trigger = Trigger, Version = version,
            Status = CutsceneStatus.Draft, Source = source, Model = model, ScriptJson = json,
            EstimatedSeconds = MotionComicRules.EstimateSeconds(script), CreatedBy = actor,
            GenerationRunId = generationRunId
        };
        await store.InsertAsync(cutscene, ct);
        return cutscene;
    }

    private async Task<CaseCutscene> RequireAsync(string caseId, string id, CancellationToken ct)
    {
        var found = await store.GetAsync(id, ct);
        if (found is null || found.CaseId != caseId || found.Trigger != Trigger) throw ApiException.NotFound("Cutscene not found.");
        return found;
    }

    private static void Require(MotionComicScript? script, GameCase gameCase)
    {
        var issues = CutsceneScriptValidator.Validate(script, gameCase);
        if (issues.Count > 0)
            throw ApiException.Unprocessable("The cutscene script is not valid.", issues.Select(issue => $"{issue.Path}: {issue.Message}").ToList());
    }

    private static MotionComicScript? TryParse(string json)
    {
        try { return JsonSerializer.Deserialize<MotionComicScript>(json, CutsceneScriptGenerator.JsonOptions); }
        catch (JsonException) { return null; }
    }

    private static CutsceneVersionDto ToVersionDto(CaseCutscene c) => new()
    {
        Id = c.Id, Version = c.Version, Status = c.Status, Source = c.Source, Model = c.Model,
        EstimatedSeconds = c.EstimatedSeconds, CreatedAt = c.CreatedAt, ApprovedAt = c.ApprovedAt
    };

    public static ComicAssetsDto BuildAssets(GameCase gameCase)
    {
        var assets = new ComicAssetsDto { CoverUrl = gameCase.CoverImageUrl ?? string.Empty };
        foreach (var scene in gameCase.Stages.SelectMany(stage => stage.Scenes).Where(scene => !string.IsNullOrWhiteSpace(scene.BackgroundUrl)))
            assets.Scenes[scene.SceneId] = new ComicAssetRef { Title = scene.Title, Url = scene.BackgroundUrl };
        foreach (var character in gameCase.Characters.Where(character => !string.IsNullOrWhiteSpace(character.ImageUrl)))
            assets.Characters[character.CharacterId] = new ComicAssetRef { Title = character.Name, Url = character.ImageUrl };
        foreach (var item in gameCase.Items.Where(item => !string.IsNullOrWhiteSpace(item.ImageUrl)))
            assets.Items[item.ItemId] = new ComicAssetRef { Title = item.Name, Url = item.ImageUrl };
        return assets;
    }
}
