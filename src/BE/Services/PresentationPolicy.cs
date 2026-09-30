using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

public static class PresentationPolicy
{
    public static string? GenerationStatusDisabledReason(string draftStatus) =>
        draftStatus == AiDraftStatus.ReadyToPublish ? null
            : "Presentation must be generated and approved while the draft is READY_TO_PUBLISH, before its first import or publish.";

    public static string Fingerprint(GameCase gameCase)
    {
        // Do not mutate cached case objects, and exclude publication metadata.
        var source = new { gameCase.CaseId, gameCase.Title, gameCase.Summary, gameCase.Stages,
            gameCase.ArtStyle, gameCase.SubStyle, gameCase.CharacterStyle, gameCase.Characters,
            gameCase.Items, gameCase.Clues, gameCase.Dialogues, gameCase.TestimonyFragments,
            gameCase.ConversationNodes, gameCase.FinalLogic, gameCase.EvidenceChallenges,
            gameCase.Deductions, gameCase.Interactions, gameCase.Puzzles };
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(source))));
    }

    public static List<PresentationStoryboardClip> ValidateAndCopy(
        IEnumerable<PresentationStoryboardClip> supplied, GameCase gameCase)
    {
        if (supplied is null) throw ApiException.BadRequest("A storyboard is required.");
        var clips = supplied.ToList();
        if (clips.Any(clip => clip is null)) throw ApiException.BadRequest("Storyboard clips cannot be null.");
        if (clips.Count > 12) throw ApiException.BadRequest("A presentation may contain at most twelve clips.");
        if (clips.Select(clip => clip.Id).Distinct(StringComparer.Ordinal).Count() != clips.Count)
            throw ApiException.BadRequest("Presentation clip IDs must be unique.");
        var sourceImages = gameCase.Characters.Select(character => character.ImageUrl)
            .Concat(gameCase.Stages.SelectMany(stage => stage.Scenes).Select(scene => scene.BackgroundUrl))
            .Append(gameCase.CoverImageUrl).Where(url => !string.IsNullOrWhiteSpace(url)).ToHashSet(StringComparer.Ordinal);
        foreach (var clip in clips)
        {
            if (!Regex.IsMatch(clip.Id ?? "", "^[a-zA-Z0-9_-]{1,64}$"))
                throw ApiException.BadRequest("A clip requires a safe ID of at most 64 characters.");
            if (clip.Kind is not ("INTRO" or "REVEAL" or "ENDING" or "PORTRAIT"))
                throw ApiException.BadRequest("Unsupported presentation clip kind.");
            if (!sourceImages.Contains(clip.SourceImageUrl))
                throw ApiException.BadRequest("Choose an existing case portrait, cover or scene image as the source.");
            if (string.IsNullOrWhiteSpace(clip.Prompt) || clip.Prompt.Length > 1800 || (clip.Caption?.Length ?? 0) > 1200 || (clip.Speaker?.Length ?? 0) > 100)
                throw ApiException.BadRequest("Clip prompt or caption exceeds its limit.");
            if (clip.DurationSeconds < 1 || clip.DurationSeconds > (clip.Kind == "PORTRAIT" ? 4 : 6))
                throw ApiException.BadRequest("Economy clips allow up to 4 seconds per portrait and 6 seconds per cinematic.");
            if (clip.Kind == "PORTRAIT" && !gameCase.Characters.Any(character => character.CharacterId == clip.TargetId))
                throw ApiException.BadRequest("Portrait clips require a case character.");
            if (clip.Kind == "REVEAL" && (!gameCase.EvidenceChallenges.Any(challenge => challenge.ChallengeId == clip.TargetId) || clip.GenerateVideo))
                throw ApiException.BadRequest("Reveal panels require a confrontation and use a still image in the economy preset.");
            if (clip.Kind == "ENDING" && clip.TargetId is not (null or "" or "WON" or "FAILED"))
                throw ApiException.BadRequest("Ending outcome must be WON, FAILED or empty.");
        }
        if (clips.Count(clip => clip.Kind == "INTRO") > 1 || clips.Count(clip => clip.Kind == "ENDING") > 1
            || clips.Count(clip => clip.Kind == "PORTRAIT") > 3)
            throw ApiException.BadRequest("Economy allows one intro, one ending and three portrait loops.");
        return clips.Select(clip => new PresentationStoryboardClip
        {
            Id = clip.Id, Kind = clip.Kind, TargetId = clip.TargetId, Caption = clip.Caption ?? "",
            Speaker = clip.Speaker ?? "", SourceImageUrl = clip.SourceImageUrl, Prompt = clip.Prompt,
            GenerateVideo = clip.GenerateVideo, DurationSeconds = clip.DurationSeconds
        }).ToList();
    }

    public static decimal? Estimate(IEnumerable<PresentationStoryboardClip> clips, PresentationVideoSettings settings) =>
        settings.HasPricing ? decimal.Ceiling(clips.Where(clip => clip.GenerateVideo).Sum(clip => clip.DurationSeconds) * settings.PricePerSecondUsd!.Value * 1_000_000m) / 1_000_000m : null;

    public static void PreserveUnchangedMedia(List<PresentationStoryboardClip> updated, PresentationPackage previous)
    {
        foreach (var clip in updated)
        {
            var old = previous.Clips.FirstOrDefault(candidate => candidate.Id == clip.Id);
            if (old is null || old.Kind != clip.Kind || old.TargetId != clip.TargetId || old.SourceImageUrl != clip.SourceImageUrl
                || old.Prompt != clip.Prompt || old.DurationSeconds != clip.DurationSeconds || old.GenerateVideo != clip.GenerateVideo) continue;
            clip.JobId = old.JobId;
            clip.Status = old.Status;
            clip.PosterAssetId = old.PosterAssetId;
            clip.VideoAssetId = old.VideoAssetId;
            clip.ErrorCode = old.ErrorCode;
            clip.Approved = old.Approved && old.Caption == clip.Caption && old.Speaker == clip.Speaker;
        }
    }

    public static void PrepareGeneration(PresentationPackage package, IReadOnlyCollection<string> clipIds,
        PresentationVideoSettings settings, decimal approvedBudgetUsd)
    {
        var selected = package.Clips.Where(clip => clipIds.Contains(clip.Id)).ToList();
        var estimate = Estimate(selected, settings);
        if (estimate is null || selected.Count == 0 || selected.Count != clipIds.Count
            || approvedBudgetUsd < estimate || approvedBudgetUsd > settings.MaximumPackageUsd)
            throw ApiException.BadRequest("Approve the displayed estimate within the configured package budget.");
        package.Status = "GENERATING";
        package.GenerationId = Guid.NewGuid().ToString("N");
        package.GenerationClipIds = clipIds.ToList();
        package.ApprovedBudgetUsd = approvedBudgetUsd;
        package.PricingVersion = settings.PricingVersion;
        package.Model = settings.Model;
        package.Resolution = settings.Resolution;
        package.PricePerSecondUsd = settings.PricePerSecondUsd!.Value;
        foreach (var clip in selected)
        {
            clip.JobId = Guid.NewGuid().ToString("N");
            clip.Status = "QUEUED";
            clip.Approved = false;
            clip.ErrorCode = null;
            clip.VideoAssetId = null;
            clip.PosterAssetId = null;
        }
    }

    public static bool IsEligible(PresentationClip clip, GameRoom room, GameCase gameCase, string userId)
    {
        if (!room.Players.Any(player => player.UserId == userId) || room.GameplayState is not { } state) return false;
        if (clip.Kind == "INTRO") return room.Status is RoomStatus.InProgress or RoomStatus.Completed;
        if (clip.Kind == "ENDING") return room.Status == RoomStatus.Completed && state.FinalAccusationSnapshot is { } result
            && (string.IsNullOrEmpty(clip.TargetId) || clip.TargetId == (result.Success ? "WON" : "FAILED"));
        if (clip.Kind == "REVEAL") return state.ResolvedConfrontationRecords.Any(record => record.ChallengeId == clip.TargetId);
        if (clip.Kind == "PORTRAIT")
        {
            var sceneId = state.PlayerSceneIds.GetValueOrDefault(userId, state.CurrentSceneId);
            return gameCase.Stages.SelectMany(stage => stage.Scenes).Any(scene => scene.SceneId == sceneId && scene.CharacterIds.Contains(clip.TargetId ?? ""));
        }
        return false;
    }

    public static string MediaUrl(string roomId, string assetId) =>
        $"/api/game/rooms/{Uri.EscapeDataString(roomId)}/presentation/media/{Uri.EscapeDataString(assetId)}";

    public static GamePresentationDto? Project(GameRoom room, GameCase gameCase, string userId)
    {
        if (gameCase.Presentation is not { } presentation) return null;
        return new GamePresentationDto
        {
            Version = presentation.Version,
            Cutscenes = presentation.Clips.Where(clip => clip.Kind != "PORTRAIT" && IsEligible(clip, room, gameCase, userId))
                .Select(clip => ToCutscene(clip, room.Id)).ToList()
        };
    }

    public static GamePresentationDto? ProjectResult(GameCase gameCase, string roomId, bool success) =>
        gameCase.Presentation is not { } presentation ? null : new GamePresentationDto
        {
            Version = presentation.Version,
            Cutscenes = presentation.Clips.Where(clip => clip.Kind == "ENDING"
                && (string.IsNullOrEmpty(clip.TargetId) || clip.TargetId == (success ? "WON" : "FAILED")))
                .Select(clip => ToCutscene(clip, roomId)).ToList()
        };

    public static void Apply(GameStateResponse response, GameRoom room, GameCase gameCase, string userId)
    {
        response.Presentation = Project(room, gameCase, userId);
        foreach (var character in response.VisibleScene.Characters)
        {
            var clip = gameCase.Presentation?.Clips.FirstOrDefault(clip => clip.Kind == "PORTRAIT"
                && clip.TargetId == character.CharacterId && IsEligible(clip, room, gameCase, userId));
            if (clip is null) continue;
            character.Presentation ??= new CharacterPresentationDto();
            character.Presentation.PortraitUrl = clip.PosterAssetId is null ? null : MediaUrl(room.Id, clip.PosterAssetId);
            character.Presentation.PortraitVideoUrl = clip.VideoAssetId is null ? null : MediaUrl(room.Id, clip.VideoAssetId);
        }
    }

    private static CutsceneDto ToCutscene(PresentationClip clip, string roomId) => new()
    {
        Id = clip.Id, Trigger = clip.Kind, TriggerId = clip.TargetId,
        Panels = [new CutscenePanelDto
        {
            Id = clip.Id, Caption = clip.Caption, Speaker = clip.Speaker, DurationMs = clip.DurationSeconds * 1000,
            ImageUrl = clip.PosterAssetId is null ? null : MediaUrl(roomId, clip.PosterAssetId),
            VideoUrl = clip.VideoAssetId is null ? null : MediaUrl(roomId, clip.VideoAssetId)
        }]
    };
}
