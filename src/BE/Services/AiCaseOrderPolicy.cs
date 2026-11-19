using System.Globalization;
using System.Text;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>Normalizes creator orders, derives the order status and renders the order into every prompt.</summary>
public static class AiCaseOrderPolicy
{
    public const int MaxLibraryPicks = 12;

    private static readonly IReadOnlyDictionary<string, string> WorldDescriptions = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [AiCaseWorlds.HangDuongVictorian] =
            "Hang Duong street, a fictional Victorian-style port city (about 1900-1935): gaslight, brick shopfronts, harbor, railway; English-style names and dress unless the creator asks otherwise",
        [AiCaseWorlds.TaishoJapan] =
            "Taisho-era Japan (1912-1926): wooden lantern streets, trams, tea houses, kimono and Western suits side by side; Japanese names, honorifics and period objects",
        [AiCaseWorlds.Shanghai1930] =
            "1930s Shanghai: concession streets with neon, riverside wharves, shikumen stone-gate lanes, teahouses and pawnshops; Chinese names, qipao and changshan, period objects",
        [AiCaseWorlds.NewWorld] =
            "a new world described by the creator's idea, kept to 1900-1935 technology so every puzzle type stays plausible; nothing in the image library fits it yet"
    };

    public static string WorldDescription(string? world) =>
        WorldDescriptions.TryGetValue(world ?? string.Empty, out var description) ? description : string.Empty;

    /// <summary>
    /// A new (OPEN_COOP_1) order: suspects and play time come from the difficulty level, whatever the client sent;
    /// the NPC limit follows the level's suspects. It runs on autopilot (<see cref="AiCaseReviewModes.Auto"/>):
    /// no gate waits for a person, whatever review mode the client sent. The one exception is a paid VIP order
    /// (VUAN-7, <paramref name="paidVipMaxPixelLabCap"/> set): it keeps the FULL review mode and its PixelLab packs.
    /// </summary>
    public static AiCaseOrder Normalize(AiCaseOrder? requested, string role, AiDifficultyProfile profile,
        int? paidVipMaxPixelLabCap = null)
    {
        requested ??= new AiCaseOrder();
        var levelled = new AiCaseOrder
        {
            World = requested.World, LocationIds = requested.LocationIds, NpcIds = requested.NpcIds,
            SuspectCount = profile.Suspects, CharacterNotes = requested.CharacterNotes, Weather = requested.Weather,
            TimeOfDay = requested.TimeOfDay, PlayMinutes = 30, ContentLevel = requested.ContentLevel,
            PixelLabCap = requested.PixelLabCap, ReviewMode = AiCaseReviewModes.Full,
            Speed = requested.Speed, VipExtraPixelLab = requested.VipExtraPixelLab
        };
        var order = Normalize(levelled, role, paidVipMaxPixelLabCap);
        order.PlayMinutes = profile.EstimatedMinutes;
        var paidVipOrder = paidVipMaxPixelLabCap is not null
            && !string.Equals(role, UserRole.Admin, StringComparison.OrdinalIgnoreCase);
        if (!paidVipOrder) order.ReviewMode = AiCaseReviewModes.Auto;
        return order;
    }

    /// <summary>
    /// Server-normalized order. An ADMIN order, and a VIP order on the free bridge lane (the VIP API lane is closed),
    /// keeps the review mode and the PixelLab cap the creator chose; -1 means no fixed cap.
    /// A paid VIP order (VUAN-7, <paramref name="paidVipMaxPixelLabCap"/> set) always gets the FULL review mode and a
    /// PixelLab cap of 30 generations, or more (whole packs of 30, paid per extra generation) up to that cap.
    /// </summary>
    public static AiCaseOrder Normalize(AiCaseOrder? requested, string role, int? paidVipMaxPixelLabCap = null)
    {
        requested ??= new AiCaseOrder();
        var order = new AiCaseOrder
        {
            World = Pick(requested.World, AiCaseWorlds.Orderable, AiCaseWorlds.HangDuongVictorian, "world"),
            LocationIds = NormalizeKeys(requested.LocationIds, "locationIds"),
            NpcIds = NormalizeKeys(requested.NpcIds, "npcIds"),
            SuspectCount = requested.SuspectCount is 0 ? 4 : requested.SuspectCount,
            CharacterNotes = (requested.CharacterNotes ?? string.Empty).Trim(),
            Weather = Pick(requested.Weather, AiCaseWeathers.All, AiCaseWeathers.Auto, "weather"),
            TimeOfDay = Pick(requested.TimeOfDay, AiCaseTimesOfDay.All, AiCaseTimesOfDay.Auto, "timeOfDay"),
            PlayMinutes = requested.PlayMinutes is 0 ? 30 : requested.PlayMinutes,
            ContentLevel = Pick(requested.ContentLevel, AiCaseContentLevels.All, AiCaseContentLevels.Standard, "contentLevel"),
            PixelLabCap = requested.PixelLabCap,
            ReviewMode = Pick(requested.ReviewMode, AiCaseReviewModes.All, AiCaseReviewModes.Full, "reviewMode"),
            Speed = SirLocked.Api.Services.Vip.VipSpeeds.Normalize(requested.Speed)
        };
        if (order.SuspectCount is < AiCaseOrder.MinSuspects or > AiCaseOrder.MaxSuspects)
            throw Invalid("suspectCount must be between 3 and 6.", "suspectCount");
        // Room for every suspect plus a few side characters (witnesses, the victim, a returning face).
        if (order.NpcIds.Count > order.SuspectCount + AiCaseOrder.ExtraNpcPicks)
            throw Invalid($"npcIds accepts at most {order.SuspectCount + AiCaseOrder.ExtraNpcPicks} entries for {order.SuspectCount} suspects.", "npcIds");
        if (order.CharacterNotes.Length > AiCaseOrder.MaxCharacterNotes)
            throw Invalid("characterNotes must be at most 600 characters.", "characterNotes");
        if (!AiCaseOrder.PlayMinuteOptions.Contains(order.PlayMinutes))
            throw Invalid("playMinutes must be 20, 30, 45 or 60.", "playMinutes");
        if (!AiCaseOrder.PixelLabCapOptions.Contains(order.PixelLabCap))
            throw Invalid("pixelLabCap must be -1 (unlimited), 0, 30, 60 or 100.", "pixelLabCap");

        var isAdmin = string.Equals(role, UserRole.Admin, StringComparison.OrdinalIgnoreCase);
        if (!isAdmin && paidVipMaxPixelLabCap is { } vipMaxPixelLabCap)
        {
            // Paid VIP order (VUAN-7): reviewed at all gates and capped.
            order.ReviewMode = AiCaseReviewModes.Full;
            // 30 generations are included; more only when the VIP explicitly buys them, up to the setting.
            var extra = Math.Clamp(requested.VipExtraPixelLab, 0, Math.Max(0, vipMaxPixelLabCap - AiCaseOrder.VipPixelLabCap));
            extra -= extra % AiCaseOrder.VipPixelLabCap; // whole packs of 30, so the cap stays one of 30/60/100
            order.VipExtraPixelLab = extra;
            order.PixelLabCap = AiCaseOrder.VipPixelLabCap + extra;
        }
        else
        {
            // ADMIN orders and free VIP orders run on the bridge and choose the review mode and the cap like an admin
            // (the role only decides the weekly order limit). The speed only means something for paid VIP orders.
            order.Speed = SirLocked.Api.Services.Vip.VipSpeeds.Fast;
            order.VipExtraPixelLab = 0;
        }
        return order;
    }

    private static string Pick(string? value, IReadOnlyList<string> allowed, string fallback, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var normalized = value.Trim().ToUpperInvariant();
        return allowed.Contains(normalized) ? normalized : throw Invalid($"{field} '{value}' is not supported.", field);
    }

    private static List<string> NormalizeKeys(List<string>? keys, string field)
    {
        var normalized = (keys ?? new List<string>())
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Select(key => key.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (normalized.Count > MaxLibraryPicks) throw Invalid($"{field} accepts at most {MaxLibraryPicks} entries.", field);
        if (normalized.Any(key => key.Length > 120 || key.Any(char.IsWhiteSpace)))
            throw Invalid($"{field} must contain library keys without spaces.", field);
        return normalized;
    }

    /// <param name="field">The order field at fault (camelCase); the error names it as <c>order.&lt;field&gt;</c>.</param>
    private static ApiException Invalid(string message, string field) =>
        ApiException.BadRequest(message, new ApiErrorDetails("AI_ORDER_INVALID", "ai.order.invalid") { Field = $"order.{field}" });

    /// <summary>
    /// The order as an explicit block appended to every step's prompt. Drafts created before orders existed have no
    /// order and keep their original prompts.
    /// </summary>
    public static string BuildPromptBlock(AiCaseOrder? order) => BuildPromptBlock(order, null);

    /// <summary>With a difficulty profile (OPEN_COOP_1 drafts) the play time line states the level's range.</summary>
    public static string BuildPromptBlock(AiCaseOrder? order, AiDifficultyProfile? profile)
    {
        if (order is null) return string.Empty;
        var builder = new StringBuilder();
        builder.AppendLine("CREATOR ORDER (normalized by the server; every step must respect it):");
        builder.AppendLine($"- world: {order.World} - {WorldDescription(order.World)}");
        builder.AppendLine(order.LocationIds.Count == 0
            ? "- locations: none requested; prefer places already in this world's image library"
            : $"- locations (image library keys, use these places): {string.Join(", ", order.LocationIds)}");
        builder.AppendLine($"- suspects: exactly {order.SuspectCount}");
        builder.AppendLine(order.NpcIds.Count == 0
            ? "- NPCs: none requested; prefer faces already in the image library, never one face for two roles"
            : $"- NPCs (image library keys, cast them; one face per role): {string.Join(", ", order.NpcIds)}");
        if (!string.IsNullOrWhiteSpace(order.CharacterNotes))
            builder.AppendLine($"- character wishes: {order.CharacterNotes}");
        builder.AppendLine(order.Weather == AiCaseWeathers.Auto
            ? "- weather: AUTO (choose one that fits; outdoor scenes only, indoor scenes have no weather)"
            : $"- weather: {order.Weather} (outdoor scenes only; indoor scenes have no weather)");
        builder.AppendLine(order.TimeOfDay == AiCaseTimesOfDay.Auto
            ? "- time of day: AUTO (choose one that fits)"
            : $"- time of day: {order.TimeOfDay}");
        builder.AppendLine(profile is null
            ? $"- target play time: about {order.PlayMinutes.ToString(CultureInfo.InvariantCulture)} minutes"
            : $"- target play time: about {profile.PlayMinutes.Min.ToString(CultureInfo.InvariantCulture)}-"
              + $"{profile.PlayMinutes.Max.ToString(CultureInfo.InvariantCulture)} minutes ({profile.Difficulty})");
        builder.AppendLine(order.ContentLevel == AiCaseContentLevels.Light
            ? "- content level: LIGHT (no blood or gore, suitable for every age)"
            : "- content level: STANDARD");
        builder.AppendLine(order.PixelLabCap switch
        {
            0 => "- new PixelLab images: none, use library pictures and code-made variants only",
            < 0 => "- new PixelLab images: no fixed cap; plan the cheapest picture set first and ask the creator with draft_ask "
                   + $"before spending more than {AiCaseOrder.AskAboveGenerations.ToString(CultureInfo.InvariantCulture)} generations",
            _ => $"- new PixelLab images: at most {order.PixelLabCap.ToString(CultureInfo.InvariantCulture)} generations"
        });
        builder.Append($"- review mode: {order.ReviewMode}");
        return builder.ToString();
    }

    /// <summary>
    /// The order status that follows from the draft's workflow state. Statuses set by a person (waiting for the
    /// owner's approval, rejected, cancelled) are kept as they are.
    /// </summary>
    public static string Derive(AiCaseDraft draft, bool claudeHasRequestInHand)
    {
        if (draft.OrderStatus is AiOrderStatuses.AwaitingOwnerApproval or AiOrderStatuses.Rejected)
            return draft.OrderStatus;
        if (draft.Status == AiDraftStatus.Cancelled) return AiOrderStatuses.Cancelled;
        if (draft.Decisions.Any(decision => decision.Status == AiDecisionStatuses.Open)) return AiOrderStatuses.AwaitingDecision;
        if (draft.Status is AiDraftStatus.ReadyToPublish or AiDraftStatus.Imported or AiDraftStatus.Published)
            return AiOrderStatuses.Submitted;
        var queued = draft.QueueState is AiQueueStates.Pending or AiQueueStates.Running
            or AiQueueStates.RetryScheduled or AiQueueStates.AwaitingClaude;
        if (!queued && draft.Status is AiDraftStatus.StoryAwaitingApproval or AiDraftStatus.CaseTruthAwaitingApproval
                or AiDraftStatus.CaseTruthInvalid or AiDraftStatus.FullLogicAwaitingApproval
                or AiDraftStatus.OpenAiGeneratedValid or AiDraftStatus.SceneLayoutAwaitingApproval
                or AiDraftStatus.AssetsGenerated or AiDraftStatus.GeneratedInvalid)
            return AiOrderStatuses.AwaitingGate;
        return claudeHasRequestInHand ? AiOrderStatuses.ClaudeWorking : AiOrderStatuses.QueuedForClaude;
    }
}
