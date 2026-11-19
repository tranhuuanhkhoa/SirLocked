using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>Gameplay entry points for interactive puzzles (answer checks, probes, hints, run views).</summary>
public static class InteractivePuzzles
{
    public const string HintCounterKey = "hints";

    public static PuzzleRunState RunFor(GameplayState state, string puzzleId)
    {
        if (!state.PuzzleRuns.TryGetValue(puzzleId, out var run))
        {
            run = new PuzzleRunState();
            state.PuzzleRuns[puzzleId] = run;
        }
        return run;
    }

    public static PuzzleVerdict Check(CasePuzzle puzzle, string answerJson, GameplayState state)
    {
        var kind = PuzzleKindRegistry.Find(puzzle.Kind)
            ?? throw ApiException.BadRequest("This puzzle kind is not supported by the server.");
        using var answer = Parse(answerJson, "answer");
        var run = RunFor(state, puzzle.PuzzleId);
        var verdict = kind.Check(PuzzleKindRegistry.Context(puzzle), answer.RootElement, run);
        // Malformed answers and a jammed lock are not mistakes: they do not count as attempts either.
        if (!verdict.Solved && verdict.CountsAsMistake) run.Attempts++;
        return verdict;
    }

    public static PuzzleVerdict Probe(CasePuzzle puzzle, string payloadJson, GameplayState state)
    {
        var kind = PuzzleKindRegistry.Find(puzzle.Kind)
            ?? throw ApiException.BadRequest("This puzzle kind is not supported by the server.");
        using var payload = Parse(payloadJson, "payload");
        var context = PuzzleKindRegistry.Context(puzzle);
        var run = RunFor(state, puzzle.PuzzleId);
        if (payload.RootElement.ValueKind == JsonValueKind.Object
            && payload.RootElement.TryGetProperty("$hint", out var hintFlag) && hintFlag.ValueKind == JsonValueKind.True)
        {
            var hints = Hints(context);
            var used = HintsUsed(run);
            if (hints.Count == 0) return new PuzzleVerdict(false, new JsonObject { ["hint"] = null, ["left"] = 0 }, "Câu đố này không có gợi ý.", false);
            var index = Math.Min(used, hints.Count - 1);
            if (used < hints.Count)
            {
                run.Data[HintCounterKey] = (used + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
                state.LeadHintCount++;
            }
            return new PuzzleVerdict(false, new JsonObject
            {
                ["hint"] = hints[index],
                ["level"] = index + 1,
                ["left"] = Math.Max(0, hints.Count - (index + 1))
            }, hints[index], false);
        }
        var verdict = kind.Probe(context, payload.RootElement, run)
            ?? throw ApiException.BadRequest("This puzzle has no probe action.");
        run.ProbesUsed++;
        return verdict;
    }

    public static List<string> Hints(PuzzleKindContext context) =>
        context.Solution["hints"] is JsonArray array
            ? array.Select(node => node?.GetValue<string>() ?? string.Empty).Where(text => text.Length > 0).ToList()
            : new List<string>();

    public static int HintsUsed(PuzzleRunState? run) =>
        run is not null && run.Data.TryGetValue(HintCounterKey, out var text) && int.TryParse(text, out var value) ? value : 0;

    private static JsonDocument Parse(string? json, string field)
    {
        try
        {
            var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json, new JsonDocumentOptions { MaxDepth = 16 });
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                document.Dispose();
                throw ApiException.BadRequest($"Puzzle {field} must be a JSON object.");
            }
            return document;
        }
        catch (JsonException)
        {
            throw ApiException.BadRequest($"Puzzle {field} is not valid JSON.");
        }
    }
}

public static class PuzzleRunViews
{
    public readonly record struct View(string Json, int HintsAvailable, int HintsUsed);

    public static View Build(CasePuzzle puzzle, PuzzleRunState? run)
    {
        PuzzleKindContext context;
        try { context = PuzzleKindRegistry.Context(puzzle); }
        catch (JsonException) { return new View(string.Empty, 0, 0); }
        var hints = InteractivePuzzles.Hints(context);
        var used = InteractivePuzzles.HintsUsed(run);
        var view = new JsonObject
        {
            ["attempts"] = run?.Attempts ?? 0,
            ["probesUsed"] = run?.ProbesUsed ?? 0,
            // Hints already bought are shown to both players again.
            ["hints"] = new JsonArray(hints.Take(used).Select(hint => (JsonNode?)JsonValue.Create(hint)).ToArray())
        };
        var kind = PuzzleKindRegistry.Find(puzzle.Kind);
        if (kind is not null && run is not null && kind.RunView(context, run) is { } extra)
        {
            foreach (var (key, value) in extra) view[key] = value?.DeepClone();
        }
        return new View(view.ToJsonString(), hints.Count, Math.Min(used, hints.Count));
    }
}
