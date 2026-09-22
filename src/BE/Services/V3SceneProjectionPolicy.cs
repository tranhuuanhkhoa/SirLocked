using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>
/// Produces the playable, role-specific scene surface for V3. This policy clones
/// runtime data before filtering so projection can never mutate canonical case data.
/// </summary>
public static class V3SceneProjectionPolicy
{
    public static void Apply(GameStateResponse response, GameCase gameCase, RoomPlayer player)
    {
        var investigator = player.Role == PlayerRole.Investigator;
        var interrogator = player.Role == PlayerRole.Interrogator;
        var sourceRuntime = response.VisibleScene.Runtime;

        response.VisibleScene.Runtime = sourceRuntime is null
            ? null
            : CloneRuntime(sourceRuntime, investigator);
        response.VisibleScene.Hotspots = response.VisibleScene.Hotspots
            .Where(hotspot => investigator
                ? !hotspot.Type.Equals("CHARACTER", StringComparison.OrdinalIgnoreCase)
                : interrogator && hotspot.Type.Equals("CHARACTER", StringComparison.OrdinalIgnoreCase))
            .Select(SanitizeHotspot)
            .ToList();
        response.VisibleScene.Items = investigator
            ? response.VisibleScene.Items
            : new List<SceneItemDto>();
        response.VisibleScene.AvailableDialogues = interrogator
            ? response.VisibleScene.AvailableDialogues.Select(SanitizeDialogue).ToList()
            : new List<SceneDialogueDto>();
        response.VisibleScene.ConversationTreeCharacterIds = interrogator
            ? response.VisibleScene.ConversationTreeCharacterIds
            : new List<string>();
        response.VisibleScene.ConversationTranscript = interrogator
            ? response.VisibleScene.ConversationTranscript
            : new List<ConversationTranscriptEntryDto>();
        response.VisibleScene.Puzzles = investigator
            ? response.VisibleScene.Puzzles
            : new List<ScenePuzzleDto>();

        var itemIds = gameCase.Items.Select(item => item.ItemId).ToHashSet(StringComparer.Ordinal);
        var clueIds = gameCase.Clues.Select(clue => clue.ClueId).ToHashSet(StringComparer.Ordinal);
        var dialogueIds = gameCase.Dialogues.Select(dialogue => dialogue.DialogueId).ToHashSet(StringComparer.Ordinal);
        var interactionIds = gameCase.Interactions.Select(interaction => interaction.InteractionId).ToHashSet(StringComparer.Ordinal);
        var puzzleIds = gameCase.Puzzles.Select(puzzle => puzzle.PuzzleId).ToHashSet(StringComparer.Ordinal);
        response.InspectedItemIds = investigator
            ? response.InspectedItemIds.Where(itemIds.Contains).ToList()
            : new List<string>();
        response.CollectedItemIds = investigator
            ? response.CollectedItemIds.Where(itemIds.Contains).ToList()
            : new List<string>();
        response.CapturedClueIds = investigator
            ? response.CapturedClueIds.Where(clueIds.Contains).ToList()
            : new List<string>();
        response.CollectedItems = investigator ? response.CollectedItems : new List<SceneItemDto>();
        response.AskedDialogueIds = interrogator
            ? response.AskedDialogueIds.Where(dialogueIds.Contains).ToList()
            : new List<string>();
        response.UsedInteractionIds = investigator
            ? response.UsedInteractionIds.Where(interactionIds.Contains).ToList()
            : new List<string>();
        response.SolvedPuzzleIds = investigator
            ? response.SolvedPuzzleIds.Where(puzzleIds.Contains).ToList()
            : new List<string>();
        response.SelectedEvidenceIds = new List<string>();
        response.CurrentSceneMissingRequirements = new MissingRequirementsDto();
        if (response.ActiveConfrontation is not null)
        {
            response.CurrentObjective = BuildObjective(
                gameCase.Language,
                gameCase.GenerationPreset,
                player.Role,
                response.ActiveConfrontation,
                false);
        }
    }

    private static HotspotDto SanitizeHotspot(HotspotDto hotspot) => new()
    {
        HotspotId = hotspot.HotspotId,
        Type = hotspot.Type,
        TargetId = hotspot.TargetId,
        X = hotspot.X,
        Y = hotspot.Y,
        Width = hotspot.Width,
        Height = hotspot.Height,
        ZIndex = hotspot.ZIndex,
        Label = hotspot.Label,
        IsLocked = hotspot.IsLocked,
        RequiredClueIds = new List<string>(),
        MissingClueIds = new List<string>()
    };

    private static SceneDialogueDto SanitizeDialogue(SceneDialogueDto dialogue) => new()
    {
        DialogueId = dialogue.DialogueId,
        CharacterId = dialogue.CharacterId,
        Question = dialogue.Question,
        IsLocked = dialogue.IsLocked,
        IsAsked = dialogue.IsAsked,
        Answer = dialogue.IsAsked ? dialogue.Answer : null,
        RequiredClueIds = new List<string>(),
        MissingClueIds = new List<string>(),
        EvidenceChallenges = new List<EvidenceChallengeDto>()
    };

    private static SceneRuntime CloneRuntime(SceneRuntime source, bool investigator) => new()
    {
        Width = source.Width,
        Height = source.Height,
        FloorY = source.FloorY,
        WalkableArea = Clone(source.WalkableArea),
        SpawnPoints = source.SpawnPoints.ToDictionary(
            pair => pair.Key,
            pair => new SpawnPoint
            {
                X = pair.Value.X,
                Y = pair.Value.Y,
                Anchor = pair.Value.Anchor,
                Direction = pair.Value.Direction
            }),
        ItemPlacements = investigator ? source.ItemPlacements.Select(Clone).ToList() : new List<ItemPlacement>(),
        CharacterPlacements = source.CharacterPlacements.Select(Clone).ToList(),
        ClueZones = investigator ? source.ClueZones.Select(Clone).ToList() : new List<ClueZone>(),
        CameraRules = investigator
            ? new CameraRules
            {
                CaptureRectWidth = source.CameraRules.CaptureRectWidth,
                CaptureRectHeight = source.CameraRules.CaptureRectHeight,
                MinClueCoverage = source.CameraRules.MinClueCoverage,
                NearMissCoverage = source.CameraRules.NearMissCoverage,
                RequireCaptureCenterInside = source.CameraRules.RequireCaptureCenterInside
            }
            : new CameraRules(),
        Transitions = source.Transitions.Select(Clone).ToList()
    };

    private static ItemPlacement Clone(ItemPlacement value) => new()
    {
        ItemId = value.ItemId,
        Asset = value.Asset,
        Position = Clone(value.Position),
        Size = Clone(value.Size),
        Hotspot = Clone(value.Hotspot)!,
        ReservedSlot = Clone(value.ReservedSlot),
        Anchor = value.Anchor,
        Depth = value.Depth
    };

    private static CharacterPlacement Clone(CharacterPlacement value) => new()
    {
        CharacterId = value.CharacterId,
        Asset = value.Asset,
        Position = Clone(value.Position),
        Size = Clone(value.Size),
        Hotspot = Clone(value.Hotspot)!,
        ReservedSlot = Clone(value.ReservedSlot),
        Anchor = value.Anchor,
        Direction = value.Direction,
        Depth = value.Depth
    };

    private static ClueZone Clone(ClueZone value) => new()
    {
        ClueId = value.ClueId,
        Label = value.Label,
        Bounds = Clone(value.Bounds)!,
        Shape = value.Shape,
        Surface = value.Surface,
        Visibility = value.Visibility,
        DetectionDifficulty = value.DetectionDifficulty,
        DetectionStatus = value.DetectionStatus,
        Confidence = value.Confidence,
        Source = value.Source,
        IsFallback = value.IsFallback,
        RequiredClueIds = new List<string>(),
        Reason = string.Empty
    };

    private static TransitionZone Clone(TransitionZone value) => new()
    {
        TransitionId = value.TransitionId,
        TargetSceneId = value.TargetSceneId,
        Label = value.Label,
        Hotspot = Clone(value.Hotspot)!,
        Depth = value.Depth
    };

    private static RuntimePoint Clone(RuntimePoint value) => new()
    {
        X = value.X,
        Y = value.Y,
        Anchor = value.Anchor
    };

    private static RuntimeSize Clone(RuntimeSize value) => new()
    {
        Width = value.Width,
        Height = value.Height
    };

    private static RuntimeBox? Clone(RuntimeBox? value) => value is null ? null : new RuntimeBox
    {
        X = value.X,
        Y = value.Y,
        Width = value.Width,
        Height = value.Height
    };

    private static string BuildObjective(
        string language,
        string generationPreset,
        string? role,
        PairedConfrontationViewDto? active,
        bool isCaseComplete)
    {
        var vi = language.Equals(CaseLanguages.Vietnamese, StringComparison.OrdinalIgnoreCase);
        if (isCaseComplete)
        {
            return vi
                ? "Vụ án đã hoàn tất. Mâu thuẫn cuối cùng đã được phá và sự thật đã được chia sẻ."
                : "Case complete. The final contradiction is cracked and the truth is shared.";
        }

        if (active is not null)
        {
            if (active.Status == PairedConfrontationStatus.CollectingProposals)
            {
                return role == PlayerRole.Investigator
                    ? vi ? "Chọn một chứng cứ vật lý để đối chiếu với lời khai của đồng đội." : "Choose physical evidence to test your partner's testimony."
                    : vi ? "Chờ chứng cứ của đồng đội hoặc chỉnh sửa lời khai đã chọn." : "Wait for your partner's evidence or edit your selected testimony.";
            }

            return active.ConfirmedByMe
                ? vi ? "Đã xác nhận. Hãy chờ đồng đội xác nhận cùng phiên bản." : "Confirmed. Wait for your partner to confirm this revision."
                : vi ? "Cùng xem lại cặp thông tin rồi xác nhận hoặc chỉnh sửa." : "Review the pair together, then confirm or edit.";
        }

        if (AiV3GenerationProfile.IsV3Preset(generationPreset))
        {
            return role == PlayerRole.Investigator
                ? vi ? "Chụp ảnh chi tiết ẩn trong hiện trường và kiểm tra cả hai vật chứng." : "Photograph the hidden scene detail and inspect both physical evidence items."
                : vi ? "Hỏi nhân chứng và ghi lại cả ba mảnh lời khai trước khi đối chất." : "Question the witness and record all three testimony fragments before confronting the claim.";
        }

        return role == PlayerRole.Investigator
            ? vi ? "Khám nghiệm hiện trường và lưu các chứng cứ vật lý đáng ngờ." : "Examine the scene and record suspicious physical evidence."
            : vi ? "Thẩm vấn nhân chứng và lưu những lời khai có thể kiểm chứng." : "Question the witness and record claims that can be tested.";
    }
}
