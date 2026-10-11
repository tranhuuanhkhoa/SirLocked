using System.Text.Json;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class PresentationService(
    MongoDbContext db, IPresentationStore store, IPresentationMediaStorage media,
    ICaseService cases, IOptions<PresentationVideoSettings> options, IOptions<CloudinarySettings> cloudinary,
    IOptions<AiQuotaSettings> quota, IOptions<AiUsageSettings> usage, IOptions<OpenAiSettings> openAi)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<PresentationAdminResponse> GetAsync(CurrentUser user, string draftId, CancellationToken ct)
    {
        var (draft, gameCase) = await RequireDraftAsync(user, draftId, ct);
        var package = await store.GetPackageAsync(draftId, ct) ?? NewPackage(draft, gameCase);
        return ToResponse(package, draft.Status);
    }

    public async Task<PresentationAdminResponse> UpdateAsync(CurrentUser user, string draftId, PresentationUpdateRequest request, CancellationToken ct)
    {
        var (draft, gameCase) = await RequireDraftAsync(user, draftId, ct);
        var current = await store.GetPackageAsync(draftId, ct);
        if (current is { Status: "GENERATING" }) throw ApiException.Conflict("Wait for the current video jobs before editing the storyboard.");
        if (current?.Clips.Any(clip => clip.Status == "SUBMISSION_UNKNOWN") == true)
            throw ApiException.Conflict("Resolve the unknown provider submission before changing the storyboard.");
        if ((current?.Version ?? 0) != request.ExpectedVersion) throw Stale();
        var package = new PresentationPackage
        {
            Id = draftId, OwnerUserId = draft.CreatedByUserId, CaseFingerprint = PresentationPolicy.Fingerprint(gameCase),
            Clips = PresentationPolicy.ValidateAndCopy(request.Clips, gameCase),
            GenerationId = current?.GenerationId ?? string.Empty
        };
        if (current is not null && current.CaseFingerprint == package.CaseFingerprint)
            PresentationPolicy.PreserveUnchangedMedia(package.Clips, current);
        if (!await store.SavePackageAsync(package, request.ExpectedVersion, ct)) throw Stale();
        return ToResponse(package, draft.Status);
    }

    public async Task<PresentationAdminResponse> GenerateAsync(CurrentUser user, string draftId, PresentationGenerateRequest request, CancellationToken ct, string? clipId = null)
    {
        var (draft, gameCase) = await RequireDraftAsync(user, draftId, ct);
        if (PresentationPolicy.GenerationStatusDisabledReason(draft.Status) is { } statusReason)
            throw ApiException.Conflict(statusReason);
        var package = await store.GetPackageAsync(draftId, ct)
            ?? throw ApiException.Conflict("Save and review the storyboard before approving generation.");
        var requestedIds = package.Clips.Where(clip => clipId is null || clip.Id == clipId).Select(clip => clip.Id).ToList();
        if (package.Status == "GENERATING" && package.Version == request.ExpectedVersion + 1
            && package.ApprovedBudgetUsd == request.ApprovedBudgetUsd && package.GenerationClipIds.SequenceEqual(requestedIds)) return ToResponse(package, draft.Status);
        if (package.Version != request.ExpectedVersion) throw Stale();
        if (package.Status == "GENERATING" || package.Clips.Any(clip => clip.Status == "SUBMISSION_UNKNOWN"))
            throw ApiException.Conflict("A presentation generation is already active or needs provider recovery.");
        var disabled = DisabledReason();
        if (disabled is not null) throw ApiException.Conflict(disabled);
        PresentationPolicy.ValidateAndCopy(package.Clips, gameCase);
        if (package.CaseFingerprint != PresentationPolicy.Fingerprint(gameCase))
            throw ApiException.Conflict("The case changed. Save and review the storyboard again.");
        PresentationPolicy.PrepareGeneration(package, requestedIds, options.Value, request.ApprovedBudgetUsd);
        if (!await store.SavePackageAsync(package, request.ExpectedVersion, ct)) throw Stale();
        // Queue publication is recoverable: the worker recreates missing deterministic job IDs.
        await EnsureJobsAsync(package, store, ct);
        return ToResponse(package, draft.Status);
    }

    public async Task<PresentationAdminResponse> ApproveAsync(CurrentUser user, string draftId, long expectedVersion, string? clipId, CancellationToken ct)
    {
        var (draft, gameCase) = await RequireDraftAsync(user, draftId, ct);
        var package = await store.GetPackageAsync(draftId, ct) ?? throw ApiException.NotFound("Presentation not found.");
        if (package.Version != expectedVersion) throw Stale();
        if (package.CaseFingerprint != PresentationPolicy.Fingerprint(gameCase)) throw ApiException.Conflict("The storyboard is stale for this case.");
        var selected = clipId is null ? package.Clips : package.Clips.Where(clip => clip.Id == clipId).ToList();
        if (selected.Count == 0 || selected.Any(clip => clip.Status is not ("READY" or "FALLBACK_READY") || clip.PosterAssetId is null))
            throw ApiException.Conflict("Only completed videos or available still fallbacks can be approved.");
        foreach (var clip in selected) clip.Approved = true;
        if (clipId is null) package.Status = "APPROVED";
        if (!await store.SavePackageAsync(package, expectedVersion, ct)) throw Stale();
        foreach (var assetId in selected.SelectMany(clip => new[] { clip.PosterAssetId, clip.VideoAssetId }).Where(id => id is not null))
        {
            var asset = await store.GetAssetAsync(assetId!, ct);
            if (asset is null) continue;
            asset.ApprovalStatus = "APPROVED";
            await store.SaveAssetAsync(asset, ct);
        }
        return ToResponse(package, draft.Status);
    }

    public async Task AttachApprovedAsync(GameCase gameCase, string draftId, CancellationToken ct = default)
    {
        var package = await store.GetPackageAsync(draftId, ct);
        if (package is null) return;
        if (package.Status == "GENERATING" || package.Clips.Any(clip => clip.Status == "SUBMISSION_UNKNOWN"))
            throw ApiException.Conflict("Finish or recover presentation generation before importing this case.");
        if (package.Status != "APPROVED") return; // Presentation is optional; never block legacy case publishing.
        if (package.CaseFingerprint != PresentationPolicy.Fingerprint(gameCase))
            throw ApiException.Conflict("Approved presentation no longer matches the case. Review it before publishing.");
        gameCase.Presentation = new CasePresentation
        {
            PackageId = draftId, Version = $"{package.GenerationId}:{package.Version}",
            Clips = package.Clips.Where(clip => clip.Approved).Select(clip => new PresentationClip
            {
                Id = clip.Id, Kind = clip.Kind, TargetId = clip.TargetId, Caption = clip.Caption, Speaker = clip.Speaker,
                DurationSeconds = clip.DurationSeconds, PosterAssetId = clip.PosterAssetId, VideoAssetId = clip.VideoAssetId
            }).ToList()
        };
    }

    public async Task<PresentationMediaBytes> ReadAdminMediaAsync(CurrentUser user, string draftId, string assetId, CancellationToken ct)
    {
        await RequireDraftAsync(user, draftId, ct);
        var asset = await store.GetAssetAsync(assetId, ct);
        if (asset is null || asset.DraftId != draftId) throw MediaUnavailable();
        return await media.DownloadAsync(asset, ct);
    }

    public async Task<PresentationMediaBytes> ReadGameMediaAsync(string userId, string roomId, string assetId, CancellationToken ct)
    {
        var room = await db.Rooms.Find(room => room.Id == roomId).FirstOrDefaultAsync(ct);
        if (room is null || !room.Players.Any(player => player.UserId == userId)) throw MediaUnavailable();
        var gameCase = await cases.GetCaseAsync(room.CaseId);
        if (gameCase.Presentation is not { } presentation || !presentation.Clips.Any(clip =>
            (clip.PosterAssetId == assetId || clip.VideoAssetId == assetId) && PresentationPolicy.IsEligible(clip, room, gameCase, userId))) throw MediaUnavailable();
        var asset = await store.GetAssetAsync(assetId, ct);
        if (asset is null || asset.DraftId != presentation.PackageId) throw MediaUnavailable();
        return await media.DownloadAsync(asset, ct);
    }

    public async Task RecoverAsync(CurrentUser user, string draftId, string clipId, string providerRequestId, CancellationToken ct)
    {
        await RequireDraftAsync(user, draftId, ct);
        if (user.Role != UserRole.Admin) throw ApiException.Forbidden("Administrator recovery is required.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(providerRequestId ?? "", "^[a-zA-Z0-9_-]{1,160}$")) throw ApiException.BadRequest("A provider request ID is required.");
        var package = await store.GetPackageAsync(draftId, ct) ?? throw ApiException.NotFound("Presentation not found.");
        var clip = package.Clips.FirstOrDefault(clip => clip.Id == clipId);
        var job = clip?.JobId is null ? null : await store.GetJobAsync(clip.JobId, ct);
        if (job?.Status != "SUBMISSION_UNKNOWN") throw ApiException.Conflict("This job does not require submission recovery.");
        job.ProviderRequestId = providerRequestId;
        job.Status = "PENDING";
        job.CreatedAt = DateTime.UtcNow;
        job.NextPollAt = DateTime.UtcNow;
        await store.SaveJobAsync(job, ct);
        clip!.Status = "PENDING";
        package.Status = "GENERATING";
        await store.SavePackageAsync(package, package.Version, ct);
    }

    public static async Task EnsureJobsAsync(PresentationPackage package, IPresentationStore store, CancellationToken ct)
    {
        foreach (var clip in package.Clips.Where(clip => clip.JobId is not null && (package.GenerationClipIds.Count == 0 || package.GenerationClipIds.Contains(clip.Id))))
            await store.InsertJobAsync(new PresentationVideoJob
            {
                Id = clip.JobId!, DraftId = package.Id, GenerationId = package.GenerationId, ClipId = clip.Id,
                Model = package.Model, PricingVersion = package.PricingVersion,
                Resolution = package.Resolution,
                ReservedUsd = clip.GenerateVideo ? clip.DurationSeconds * package.PricePerSecondUsd : 0m
            }, ct);
    }

    private async Task<(AiCaseDraft, GameCase)> RequireDraftAsync(CurrentUser user, string draftId, CancellationToken ct)
    {
        var draft = await db.AiCaseDrafts.Find(draft => draft.Id == draftId).FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Draft not found.");
        if (user.Role != UserRole.Admin && draft.CreatedByUserId != user.Id) throw ApiException.Forbidden("You do not own this draft.");
        if (string.IsNullOrWhiteSpace(draft.GeneratedJson)) throw ApiException.Conflict("Generate and review the case before adding presentation.");
        var gameCase = JsonSerializer.Deserialize<GameCase>(draft.GeneratedJson, JsonOptions)
            ?? throw ApiException.Conflict("The case definition is unavailable.");
        return (draft, gameCase);
    }

    private PresentationPackage NewPackage(AiCaseDraft draft, GameCase gameCase)
    {
        var source = gameCase.CoverImageUrl;
        if (string.IsNullOrWhiteSpace(source)) source = gameCase.Stages.SelectMany(stage => stage.Scenes).FirstOrDefault()?.BackgroundUrl ?? "";
        var package = new PresentationPackage { Id = draft.Id, Version = 0, OwnerUserId = draft.CreatedByUserId, CaseFingerprint = PresentationPolicy.Fingerprint(gameCase) };
        if (!string.IsNullOrWhiteSpace(source))
        {
            package.Clips.Add(new() { Id = "intro", Kind = "INTRO", SourceImageUrl = source, Caption = gameCase.Summary, DurationSeconds = 6,
                Prompt = "Preserve the source's Victorian detective pixel-art style, palette and crisp pixel edges. Subtle comic motion, slow camera push, ambient light and drifting dust. Preserve all objects and composition. No photorealism, text, speech or new characters." });
            package.Clips.Add(new() { Id = "ending", Kind = "ENDING", TargetId = "WON", SourceImageUrl = source, Caption = gameCase.FinalLogic.WinEnding, DurationSeconds = 6,
                Prompt = "Preserve the source's Victorian detective pixel-art style, palette and crisp pixel edges. Restrained comic epilogue, slow camera pullback and soft changing light. Preserve composition. No photorealism, text, speech or new objects." });
        }
        foreach (var character in gameCase.Characters.Where(character => !string.IsNullOrWhiteSpace(character.ImageUrl)).Take(3))
            package.Clips.Add(new() { Id = $"portrait-{package.Clips.Count}", Kind = "PORTRAIT", TargetId = character.CharacterId,
                SourceImageUrl = character.ImageUrl, DurationSeconds = 4,
                Prompt = "Preserve the source's Victorian detective pixel-art style, palette and crisp pixel edges. Seamless quiet portrait loop, subtle breathing and one natural blink. Locked camera. Preserve identity, pose, clothing and background. No photorealism, speech, lip sync, text or new objects." });
        if (!string.IsNullOrWhiteSpace(source))
            foreach (var challenge in gameCase.EvidenceChallenges.Take(Math.Max(0, 12 - package.Clips.Count)))
            {
                var characterId = gameCase.Dialogues.FirstOrDefault(dialogue => dialogue.DialogueId == challenge.DialogueId)?.CharacterId;
                var sceneImage = gameCase.Stages.SelectMany(stage => stage.Scenes)
                    .FirstOrDefault(scene => characterId is not null && scene.CharacterIds.Contains(characterId) && !string.IsNullOrWhiteSpace(scene.BackgroundUrl))?.BackgroundUrl ?? source;
                package.Clips.Add(new()
                {
                    Id = $"reveal-{package.Clips.Count}", Kind = "REVEAL", TargetId = challenge.ChallengeId,
                    SourceImageUrl = sceneImage, Caption = challenge.SuccessResponse, Speaker = challenge.RevealTitle,
                    DurationSeconds = 4, GenerateVideo = false,
                    Prompt = "Keep this Victorian pixel-art comic panel still. Preserve the source image and composition."
                });
            }
        return package;
    }

    private string? DisabledReason() => !options.Value.Enabled ? "Video generation is disabled." : openAi.Value.BlocksAssetCalls || openAi.Value.MockAiResponses
        ? "AI safety switches disable paid media generation." : !options.Value.HasPricing ? "Configure a verified video price and pricing version first."
        : !quota.Value.Enabled || quota.Value.GlobalBudgetUsd <= 0 || usage.Value.MaxDraftUsd <= 0 ? "Enable the global and per-draft AI budgets first."
        : string.IsNullOrWhiteSpace(options.Value.ApiKey) ? "Configure the xAI API key first."
        : !cloudinary.Value.Enabled || string.IsNullOrWhiteSpace(cloudinary.Value.ApiKey) || string.IsNullOrWhiteSpace(cloudinary.Value.ApiSecret) || string.IsNullOrWhiteSpace(cloudinary.Value.CloudName)
            ? "Configure protected Cloudinary media storage first." : null;

    private PresentationAdminResponse ToResponse(PresentationPackage package, string draftStatus) => new()
    {
        DraftId = package.Id, Version = package.Version, Status = package.Status,
        GenerationEnabled = PresentationPolicy.GenerationStatusDisabledReason(draftStatus) is null && DisabledReason() is null,
        DisabledReason = PresentationPolicy.GenerationStatusDisabledReason(draftStatus) ?? DisabledReason(),
        Estimate = new() { Configured = options.Value.HasPricing, TotalUsd = PresentationPolicy.Estimate(package.Clips, options.Value),
            Model = options.Value.Model, PricingVersion = options.Value.PricingVersion },
        Clips = package.Clips.Select(clip => new PresentationClipAdminDto
        {
            Id = clip.Id, Kind = clip.Kind, TargetId = clip.TargetId, Caption = clip.Caption, Speaker = clip.Speaker,
            DurationSeconds = clip.DurationSeconds, SourceImageUrl = clip.SourceImageUrl, Prompt = clip.Prompt,
            GenerateVideo = clip.GenerateVideo, Status = clip.Status, JobId = clip.JobId, Approved = clip.Approved, ErrorCode = clip.ErrorCode,
            EstimatedUsd = PresentationPolicy.Estimate([clip], options.Value),
            PosterUrl = clip.PosterAssetId is null ? null : AdminMediaUrl(package.Id, clip.PosterAssetId),
            VideoUrl = clip.VideoAssetId is null ? null : AdminMediaUrl(package.Id, clip.VideoAssetId)
        }).ToList()
    };
    private static string AdminMediaUrl(string draftId, string assetId) => $"/api/admin/ai-cases/{Uri.EscapeDataString(draftId)}/presentation/media/{Uri.EscapeDataString(assetId)}";
    private static ApiException Stale() => ApiException.Conflict("The presentation changed. Refresh before trying again.");
    private static ApiException MediaUnavailable() => ApiException.NotFound("Presentation media is unavailable.");
}
