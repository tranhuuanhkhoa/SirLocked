using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// The hint rule wants three <c>solution.hints</c> on every interactive puzzle (<see cref="CaseHintRules.MinPuzzleHints"/>),
/// ordered from a general direction to almost the answer; most kinds generate two specific ones. The compiler tops an
/// optional puzzle up with general hints placed in front, so the kind's own hints stay last (the most specific).
/// </summary>
public static class OptionalPuzzleHints
{
    private static readonly string[] Vietnamese =
    [
        "Đọc lại lời dẫn của câu đố: mọi thứ cần để giải đều có trên màn hình.",
        "Thử từng bước nhỏ và để ý thứ gì thay đổi sau mỗi lần thử.",
        "Nếu vẫn bí, làm lại từ đầu và so từng phần với lời dẫn."
    ];

    private static readonly string[] English =
    [
        "Read the puzzle's prompt again: everything you need is on screen.",
        "Try one small step at a time and watch what changes after each try.",
        "Still stuck? Start over and compare each part with the prompt."
    ];

    public static void TopUp(CasePuzzle puzzle, string language)
    {
        var solution = PuzzleKindAuthoring.Parse(puzzle.SolutionJson);
        var own = solution["hints"] is JsonArray array
            ? array.Select(node => node?.GetValue<string>() ?? string.Empty).Where(text => !string.IsNullOrWhiteSpace(text)).ToList()
            : [];
        if (own.Count >= CaseHintRules.MinPuzzleHints) return;
        var general = (language == CaseLanguages.Vietnamese ? Vietnamese : English)
            .Where(text => !own.Contains(text, StringComparer.Ordinal))
            .Take(CaseHintRules.MinPuzzleHints - own.Count);
        solution["hints"] = new JsonArray(general.Concat(own).Select(text => (JsonNode?)JsonValue.Create(text)).ToArray());
        puzzle.SolutionJson = solution.ToJsonString();
    }
}
