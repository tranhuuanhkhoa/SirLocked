using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Open co-op case wall ("Sơ đồ vụ án — ghép ảnh &amp; lời khai"). Everything either detective found
/// lands in one shared envelope; the team pins each statement on the person who said it and each piece
/// of evidence on the person it points to. Targets are the case's people (minus the victim) plus the
/// middle card — the victim when the case has one, otherwise the case itself.
/// </summary>
public static class CaseBoardRules
{
    /// <summary>Target id of the middle card when the case has no victim character.</summary>
    public const string CaseTarget = "case";
    public const string KindStatement = "say";
    public const string KindEvidence = "ev";

    public static bool IsVictim(CaseCharacter character) => Has(character.Role, "nạn nhân", "victim", "người chết", "deceased");

    public static bool IsWitness(CaseCharacter character) => Has(character.Role, "nhân chứng", "witness");

    private static bool Has(string? text, params string[] words) =>
        !string.IsNullOrWhiteSpace(text) && words.Any(word => text.Contains(word, StringComparison.OrdinalIgnoreCase));

    public static string CenterTargetId(GameCase gameCase) =>
        gameCase.Characters.FirstOrDefault(IsVictim)?.CharacterId ?? CaseTarget;

    public static List<CaseCharacter> Columns(GameCase gameCase) =>
        gameCase.Characters.Where(character => !IsVictim(character)).ToList();

    public static bool IsTarget(GameCase gameCase, string targetId) =>
        targetId == CenterTargetId(gameCase) || Columns(gameCase).Any(character => character.CharacterId == targetId);

    /// <summary>Who said a statement (via its dialogue or conversation node).</summary>
    public static string? Speaker(GameCase gameCase, TestimonyFragment fragment)
    {
        var dialogue = gameCase.Dialogues.FirstOrDefault(item => item.DialogueId == fragment.DialogueId);
        if (dialogue is not null) return dialogue.CharacterId;
        return gameCase.ConversationNodes.FirstOrDefault(node =>
            node.SourceDialogueId == fragment.DialogueId || node.StatementIds.Contains(fragment.Id))?.CharacterId;
    }

    /// <summary>Every target an item may be pinned on. The first one is where a hint points.</summary>
    public static List<string> Targets(GameCase gameCase, string itemId)
    {
        var center = CenterTargetId(gameCase);
        var people = gameCase.Characters.Select(character => character.CharacterId).ToHashSet();
        string Map(string characterId) => characterId == center ? center : characterId;

        var fragment = gameCase.TestimonyFragments.FirstOrDefault(item => item.Id == itemId);
        if (fragment is not null)
        {
            var speaker = Speaker(gameCase, fragment);
            return speaker is not null && people.Contains(speaker) ? new List<string> { Map(speaker) } : new List<string> { center };
        }

        var clue = gameCase.Clues.FirstOrDefault(item => item.ClueId == itemId && item.IsEvidence);
        if (clue is null) return new List<string>();
        var related = clue.RelatedCharacterIds.Where(people.Contains).Select(Map).Distinct().ToList();
        return related.Count > 0 ? related : new List<string> { center };
    }

    public static string? KindOf(GameCase gameCase, string itemId) =>
        gameCase.TestimonyFragments.Any(item => item.Id == itemId) ? KindStatement
        : gameCase.Clues.Any(item => item.ClueId == itemId && item.IsEvidence) ? KindEvidence
        : null;

    /// <summary>Items the team has found, in the order they were found.</summary>
    public static List<string> FoundItems(GameCase gameCase, GameplayState state)
    {
        var evidence = state.ClueDiscoveries
            .Where(discovery => gameCase.Clues.Any(clue => clue.ClueId == discovery.ClueId && clue.IsEvidence))
            .Select(discovery => (Id: discovery.ClueId, At: discovery.DiscoveredAt));
        var statements = state.TestimonyDiscoveries
            .Where(discovery => gameCase.TestimonyFragments.Any(fragment => fragment.Id == discovery.TestimonyFragmentId))
            .Select(discovery => (Id: discovery.TestimonyFragmentId, At: discovery.DiscoveredAt));
        return evidence.Concat(statements)
            .OrderBy(item => item.At)
            .Select(item => item.Id)
            .Distinct()
            .ToList();
    }

    public static bool IsFound(GameCase gameCase, GameplayState state, string itemId) =>
        state.ClueDiscoveries.Any(discovery => discovery.ClueId == itemId)
        || state.TestimonyDiscoveries.Any(discovery => discovery.TestimonyFragmentId == itemId);

    public static bool IsCorrect(GameCase gameCase, string itemId, string targetId) =>
        Targets(gameCase, itemId).Contains(targetId);

    /// <summary>The next unpinned found item and its target, for the board hint.</summary>
    public static (string ItemId, string TargetId)? NextHint(GameCase gameCase, GameplayState state)
    {
        foreach (var itemId in FoundItems(gameCase, state))
        {
            if (state.BoardPins.ContainsKey(itemId)) continue;
            var targets = Targets(gameCase, itemId);
            if (targets.Count > 0) return (itemId, targets[0]);
        }
        return null;
    }

    public static BoardViewDto? BuildView(GameCase gameCase, GameplayState state)
    {
        if (!CaseRuleSets.IsOpenCoop(gameCase)) return null;
        var board = gameCase.Board ?? new CaseBoard();
        var center = CenterTargetId(gameCase);
        var victim = gameCase.Characters.FirstOrDefault(character => character.CharacterId == center);

        // Canonical owner of every item in the case (its first target), for the per-person counters.
        var owners = gameCase.TestimonyFragments.Select(fragment => (Id: fragment.Id, Kind: KindStatement))
            .Concat(gameCase.Clues.Where(clue => clue.IsEvidence).Select(clue => (Id: clue.ClueId, Kind: KindEvidence)))
            .Select(item => (item.Id, item.Kind, Owner: Targets(gameCase, item.Id).FirstOrDefault() ?? center))
            .ToList();
        int Count(string target, string kind) => owners.Count(item => item.Owner == target && item.Kind == kind);

        var found = FoundItems(gameCase, state);
        var pins = found
            .Where(state.BoardPins.ContainsKey)
            .Select(itemId => new BoardPinDto
            {
                ItemId = itemId,
                Kind = KindOf(gameCase, itemId) ?? KindEvidence,
                TargetId = state.BoardPins[itemId],
            })
            .ToList();
        var pinned = pins.Select(pin => pin.ItemId).ToHashSet();

        return new BoardViewDto
        {
            Summary = string.IsNullOrWhiteSpace(board.Summary) ? gameCase.Summary : board.Summary,
            Center = new BoardCenterDto
            {
                TargetId = center,
                CharacterId = victim?.CharacterId,
                Kicker = !string.IsNullOrWhiteSpace(board.CenterKicker) ? board.CenterKicker : victim is not null ? "NẠN NHÂN" : "VỤ VIỆC",
                Title = victim?.Name ?? (string.IsNullOrWhiteSpace(board.CenterTitle) ? gameCase.Title : board.CenterTitle),
                Subtitle = victim is not null ? ShortRole(victim.Role, victim.Description) : board.CenterSubtitle,
                ImageUrl = victim?.ImageUrl ?? string.Empty,
                StatementTotal = Count(center, KindStatement),
                EvidenceTotal = Count(center, KindEvidence),
            },
            Columns = Columns(gameCase).Select(character => new BoardColumnDto
            {
                TargetId = character.CharacterId,
                Name = character.Name,
                Role = ShortRole(character.Role, string.Empty),
                Kind = IsWitness(character) ? "WITNESS" : "SUSPECT",
                ImageUrl = character.ImageUrl,
                StatementTotal = Count(character.CharacterId, KindStatement),
                EvidenceTotal = Count(character.CharacterId, KindEvidence),
            }).ToList(),
            Pins = pins,
            Envelope = found.Where(itemId => !pinned.Contains(itemId)).ToList(),
            Links = board.Links
                .Where(link => pinned.Contains(link.FromId) && pinned.Contains(link.ToId))
                .Select(link => new BoardLinkDto { FromId = link.FromId, ToId = link.ToId, Label = link.Label })
                .ToList(),
            WrongCount = state.WrongBoardPinCount,
            TotalItems = owners.Count,
        };
    }

    /// <summary>"Chủ tiệm cầm đồ — người báo mất" → "Chủ tiệm cầm đồ".</summary>
    public static string ShortRole(string? role, string? fallback)
    {
        var text = string.IsNullOrWhiteSpace(role) ? fallback ?? string.Empty : role;
        foreach (var separator in new[] { " — ", " – ", " - ", ";", "," })
        {
            var index = text.IndexOf(separator, StringComparison.Ordinal);
            if (index > 0) text = text[..index];
        }
        return text.Trim();
    }
}
