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
    /// Server-normalized order. VIP orders always get the FULL review mode and a 30-generation PixelLab cap.
    /// </summary>
    public static AiCaseOrder Normalize(AiCaseOrder? requested, string role)
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
            ReviewMode = Pick(requested.ReviewMode, AiCaseReviewModes.All, AiCaseReviewModes.Full, "reviewMode")
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
            throw Invalid("pixelLabCap must be 0, 30, 60 or 100.", "pixelLabCap");

        if (!string.Equals(role, UserRole.Admin, StringComparison.OrdinalIgnoreCase))
        {
            // VIPs never choose these: every VIP order is reviewed at all gates and capped.
            order.ReviewMode = AiCaseReviewModes.Full;
            order.PixelLabCap = AiCaseOrder.VipPixelLabCap;
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
    public static string BuildPromptBlock(AiCaseOrder? order)
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
        builder.AppendLine($"- target play time: about {order.PlayMinutes.ToString(CultureInfo.InvariantCulture)} minutes");
        builder.AppendLine(order.ContentLevel == AiCaseContentLevels.Light
            ? "- content level: LIGHT (no blood or gore, suitable for every age)"
            : "- content level: STANDARD");
        builder.AppendLine(order.PixelLabCap == 0
            ? "- new PixelLab images: none, use library pictures and code-made variants only"
            : $"- new PixelLab images: at most {order.PixelLabCap.ToString(CultureInfo.InvariantCulture)} generations");
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
