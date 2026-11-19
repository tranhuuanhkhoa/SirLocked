using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// One interactive puzzle's definition as a kind sees it. <see cref="Params"/> is public (sent to the
/// client once the puzzle is unlocked), <see cref="Solution"/> never leaves the server and
/// <see cref="Reveal"/> is sent only after the puzzle is solved.
/// </summary>
public sealed class PuzzleKindContext
{
    public string PuzzleId { get; init; } = string.Empty;
    public JsonObject Params { get; init; } = new();
    public JsonObject Solution { get; init; } = new();
    public JsonObject Reveal { get; init; } = new();
    /// <summary>EASY, NORMAL or HARD (defaults to EASY).</summary>
    public string Difficulty { get; init; } = PuzzleDifficulties.Easy;
}

public static class PuzzleDifficulties
{
    public const string Easy = "EASY";
    public const string Normal = "NORMAL";
    public const string Hard = "HARD";

    public static string Normalize(string? value) => value?.Trim().ToUpperInvariant() switch
    {
        Normal => Normal,
        Hard => Hard,
        _ => Easy
    };
}

/// <summary>Outcome of a submitted answer or a probe. <see cref="Feedback"/> is sent to the client as-is.</summary>
public sealed record PuzzleVerdict(bool Solved, JsonObject? Feedback = null, string? Message = null, bool CountsAsMistake = true);

/// <summary>
/// A server-side puzzle kind. Implementations are discovered by reflection (public, non-abstract, with a
/// parameterless constructor), so adding a kind never touches a shared registry file.
/// </summary>
public interface IPuzzleKind
{
    /// <summary>Stable lowercase id, e.g. "tilt_maze". Matches the frontend module name.</summary>
    string Kind { get; }

    /// <summary>
    /// Completes a definition for one case: fill every value the author left out (randomized parts of
    /// params, the solution, reveal text) from <paramref name="rng"/>. Never overwrite authored values, so
    /// re-running it is a no-op and an author can pin any part.
    /// </summary>
    void Generate(PuzzleKindContext definition, Random rng);

    /// <summary>Authoring checks. Report problems through <paramref name="error"/>(fieldPath, message).</summary>
    void Validate(PuzzleKindContext definition, Action<string, string> error);

    /// <summary>Judges a final answer. May read and update <paramref name="run"/>.</summary>
    PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run);

    /// <summary>Optional mid-puzzle server query (e.g. weigh on the scale). Null means "not supported".</summary>
    PuzzleVerdict? Probe(PuzzleKindContext definition, JsonElement input, PuzzleRunState run) => null;

    /// <summary>Optional public view of the run (e.g. weighings left), merged into the puzzle DTO.</summary>
    JsonObject? RunView(PuzzleKindContext definition, PuzzleRunState run) => null;
}

public static class PuzzleKindRegistry
{
    private static readonly Lazy<Dictionary<string, IPuzzleKind>> Registered = new(Discover);

    public static IReadOnlyCollection<string> KnownKinds => Registered.Value.Keys.ToList();

    public static IPuzzleKind? Find(string? kind) =>
        !string.IsNullOrWhiteSpace(kind) && Registered.Value.TryGetValue(kind.Trim(), out var found) ? found : null;

    public static bool IsInteractive(CasePuzzle puzzle) =>
        string.Equals(puzzle.Type, CasePuzzleTypes.InteractivePuzzle, StringComparison.OrdinalIgnoreCase);

    public static PuzzleKindContext Context(CasePuzzle puzzle) => new()
    {
        PuzzleId = puzzle.PuzzleId,
        Params = ParseObject(puzzle.ParamsJson),
        Solution = ParseObject(puzzle.SolutionJson),
        Reveal = ParseObject(puzzle.RevealJson),
        Difficulty = PuzzleDifficulties.Normalize(puzzle.Difficulty)
    };

    public static void Store(CasePuzzle puzzle, PuzzleKindContext context)
    {
        puzzle.ParamsJson = context.Params.ToJsonString();
        puzzle.SolutionJson = context.Solution.ToJsonString();
        puzzle.RevealJson = context.Reveal.Count == 0 ? string.Empty : context.Reveal.ToJsonString();
        puzzle.Difficulty = context.Difficulty;
    }

    /// <summary>
    /// Fills the per-case parameters of every interactive puzzle. Deterministic per case and puzzle
    /// (same case → same answers on every re-seed; different cases → different answers).
    /// </summary>
    public static void FillMissing(GameCase gameCase)
    {
        foreach (var puzzle in gameCase.Puzzles.Where(IsInteractive))
        {
            var kind = Find(puzzle.Kind);
            if (kind is null) continue;
            PuzzleKindContext context;
            try { context = Context(puzzle); }
            catch (JsonException) { continue; }
            kind.Generate(context, new Random(StableSeed(gameCase.CaseId, puzzle.PuzzleId, puzzle.Kind)));
            Store(puzzle, context);
        }
    }

    public static void Validate(CasePuzzle puzzle, string path, Action<string, string, string> add)
    {
        var kind = Find(puzzle.Kind);
        if (kind is null)
        {
            add($"{path}.kind", "Unknown interactive puzzle kind. Known kinds: " + string.Join(", ", KnownKinds.OrderBy(k => k)), puzzle.Kind);
            return;
        }
        PuzzleKindContext context;
        try { context = Context(puzzle); }
        catch (JsonException exception)
        {
            add($"{path}.params", "Puzzle params/solution/reveal must be JSON objects: " + exception.Message, puzzle.PuzzleId);
            return;
        }
        try
        {
            kind.Validate(context, (field, message) => add($"{path}.{field}", message, puzzle.PuzzleId));
        }
        catch (Exception exception) when (exception is ArgumentException or IndexOutOfRangeException
            or InvalidOperationException or KeyNotFoundException or NullReferenceException or FormatException
            or OverflowException or JsonException)
        {
            // A kind reports problems through add(); incomplete data must never crash validation of a whole case.
            add($"{path}.params", $"The {puzzle.Kind} parameters are incomplete and could not be checked ({exception.GetType().Name}).", puzzle.PuzzleId);
        }
    }

    /// <summary>FNV-1a over the parts; stable across processes (unlike string.GetHashCode).</summary>
    public static int StableSeed(params string?[] parts)
    {
        unchecked
        {
            uint hash = 2166136261;
            foreach (var part in parts)
            {
                foreach (var ch in part ?? string.Empty)
                {
                    hash ^= ch;
                    hash *= 16777619;
                }
                hash ^= 0x1f;
                hash *= 16777619;
            }
            return (int)(hash & 0x7fffffff);
        }
    }

    public static JsonObject ParseObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new JsonObject();
        return JsonNode.Parse(json) as JsonObject
            ?? throw new JsonException("Expected a JSON object.");
    }

    private static Dictionary<string, IPuzzleKind> Discover()
    {
        var kinds = new Dictionary<string, IPuzzleKind>(StringComparer.OrdinalIgnoreCase);
        foreach (var type in typeof(IPuzzleKind).Assembly.GetTypes())
        {
            if (type.IsAbstract || type.IsInterface || !typeof(IPuzzleKind).IsAssignableFrom(type)) continue;
            if (type.GetConstructor(Type.EmptyTypes) is null) continue;
            var instance = (IPuzzleKind)Activator.CreateInstance(type)!;
            kinds[instance.Kind] = instance;
        }
        return kinds;
    }
}

/// <summary>Small helpers for kinds reading and writing JSON parameters.</summary>
public static class PuzzleJson
{
    public static bool Has(JsonObject obj, string key) => obj.TryGetPropertyValue(key, out var node) && node is not null;

    public static int Int(JsonObject obj, string key, int fallback = 0) =>
        obj.TryGetPropertyValue(key, out var node) && node is JsonValue value && value.TryGetValue<int>(out var result) ? result : fallback;

    public static double Number(JsonObject obj, string key, double fallback = 0) =>
        obj.TryGetPropertyValue(key, out var node) && node is JsonValue value && value.TryGetValue<double>(out var result) ? result : fallback;

    public static string Text(JsonObject obj, string key, string fallback = "") =>
        obj.TryGetPropertyValue(key, out var node) && node is JsonValue value && value.TryGetValue<string>(out var result) ? result : fallback;

    public static List<int> Ints(JsonObject obj, string key) =>
        obj.TryGetPropertyValue(key, out var node) && node is JsonArray array
            ? array.Select(item => item is JsonValue value && value.TryGetValue<int>(out var number) ? number : int.MinValue).ToList()
            : new List<int>();

    public static JsonArray IntArray(IEnumerable<int> values) => new(values.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray());

    /// <summary>Reads an int array from a submitted answer element.</summary>
    public static List<int>? Ints(JsonElement element, string key)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(key, out var array) || array.ValueKind != JsonValueKind.Array)
            return null;
        var values = new List<int>();
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Number || !item.TryGetInt32(out var number)) return null;
            values.Add(number);
        }
        return values;
    }

    public static string? Text(JsonElement element, string key) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>Fisher–Yates shuffle of 1..n (or the given values) with the case's RNG.</summary>
    public static List<int> Shuffled(Random rng, IEnumerable<int> values)
    {
        var list = values.ToList();
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
        return list;
    }
}
