using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P7 · Cân đối chứng. A row of identical vials, exactly one is heavier. The team weighs equal counts on
/// the two pans (each weighing spends one brass token, counted on the server), then points out the heavy
/// vial. A wrong pick re-shuffles the vials: the heavy one is re-rolled (seeded per puzzle and round),
/// the tokens come back and earlier weighings no longer count.
///
/// params (public):   { vials:9, tokens:2|3, perPan:4, + authored text (shop, batch, grams, cards…) }
/// solution (secret): { heavy:n, hints:[…] }
/// probe:  { left:[ids], right:[ids] } → { res:"L"|"R"|"E", tokensLeft, round, n }   (or { error, tokensLeft })
/// answer: { pick:n } → solved, or { right:false, wrong:n, round, tokensLeft } after a re-roll.
/// run.Data: round, used, heavy (current heavy after re-rolls, server only), log (this round's weighings).
/// </summary>
public sealed class BalanceScaleKind : IPuzzleKind
{
    public string Kind => "balance_scale";

    public const int MinVials = 3;
    public const int MaxVials = 9;
    public const int MaxTokens = 5;
    public const int MaxPerPan = 4;

    private const string RoundKey = "round";
    private const string UsedKey = "used";
    private const string HeavyKey = "heavy";
    private const string LogKey = "log";

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        if (!PuzzleJson.Has(p, "vials")) p["vials"] = 9;
        var vials = Math.Clamp(PuzzleJson.Int(p, "vials", 9), MinVials, MaxVials);
        if (!PuzzleJson.Has(p, "perPan")) p["perPan"] = definition.Difficulty == PuzzleDifficulties.Hard ? 3 : MaxPerPan;
        if (!PuzzleJson.Has(p, "tokens"))
        {
            // EASY leaves one spare weighing over the minimum; NORMAL/HARD give exactly the minimum.
            var minimum = MinimumWeighings(vials, Math.Clamp(PuzzleJson.Int(p, "perPan", MaxPerPan), 1, MaxPerPan)) ?? 2;
            p["tokens"] = Math.Min(MaxTokens, definition.Difficulty == PuzzleDifficulties.Easy ? minimum + 1 : minimum);
        }
        if (!PuzzleJson.Has(definition.Solution, "heavy")) definition.Solution["heavy"] = rng.Next(1, vials + 1);
        if (!PuzzleJson.Has(definition.Solution, "hints"))
        {
            var group = (int)Math.Ceiling(vials / 3.0);
            definition.Solution["hints"] = new JsonArray(
                $"Chia {vials} lọ thành ba nhóm (mỗi nhóm khoảng {group} lọ). Cân hai nhóm với nhau: bên nặng hơn — hoặc nhóm còn lại nếu cân bằng — có lọ bị tráo.",
                "Lần cân sau: trong nhóm còn nghi, đặt mỗi bên một lọ (hoặc vài lọ bằng nhau). Cân bằng thì lọ bị tráo là lọ không lên cân.");
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        var p = definition.Params;
        var vials = PuzzleJson.Int(p, "vials", -1);
        var tokens = PuzzleJson.Int(p, "tokens", -1);
        var perPan = PuzzleJson.Int(p, "perPan", -1);
        if (vials is < MinVials or > MaxVials) error("params.vials", $"vials must be {MinVials}–{MaxVials}.");
        if (tokens is < 1 or > MaxTokens) error("params.tokens", $"tokens must be 1–{MaxTokens}.");
        if (perPan is < 1 or > MaxPerPan) error("params.perPan", $"perPan must be 1–{MaxPerPan}.");
        if (PuzzleJson.Has(p, "heavy")) error("params.heavy", "The heavy vial is secret: put it in solution.heavy, not in params.");
        var heavy = PuzzleJson.Int(definition.Solution, "heavy", -1);
        if (vials >= MinVials && (heavy < 1 || heavy > vials)) error("solution.heavy", "solution.heavy must be a vial number 1…vials.");
        if (vials is >= MinVials and <= MaxVials && tokens >= 1 && perPan >= 1)
        {
            var minimum = MinimumWeighings(vials, Math.Min(perPan, MaxPerPan));
            if (minimum is null || minimum > tokens)
                error("params.tokens", $"{tokens} weighing(s) with {perPan} vial(s) per pan cannot always find the heavy vial among {vials}.");
        }
    }

    public PuzzleVerdict? Probe(PuzzleKindContext definition, JsonElement input, PuzzleRunState run)
    {
        var (vials, tokens, perPan) = Shape(definition);
        var left = PuzzleJson.Ints(input, "left");
        var right = PuzzleJson.Ints(input, "right");
        var used = Number(run, UsedKey);
        var tokensLeft = Math.Max(0, tokens - used);
        PuzzleVerdict Refuse(string code, string message) =>
            new(false, new JsonObject { ["error"] = code, ["tokensLeft"] = tokensLeft, ["round"] = Number(run, RoundKey) }, message, false);

        if (left is null || right is null) return Refuse("invalid", "Lượt cân không hợp lệ.");
        if (tokensLeft <= 0) return Refuse("notoken", "Hết thẻ cân — hãy chỉ ra lọ bị tráo.");
        if (left.Count == 0 || right.Count == 0) return Refuse("empty", "Mỗi đĩa cần ít nhất một lọ.");
        if (left.Count != right.Count) return Refuse("uneq", "Hai đĩa phải có số lọ bằng nhau.");
        if (left.Count > perPan) return Refuse("full", $"Mỗi đĩa chỉ đặt được {perPan} lọ.");
        var all = left.Concat(right).ToList();
        if (all.Any(id => id < 1 || id > vials) || all.Distinct().Count() != all.Count) return Refuse("invalid", "Lượt cân không hợp lệ.");

        var heavy = CurrentHeavy(definition, run, vials);
        var res = left.Contains(heavy) ? "L" : right.Contains(heavy) ? "R" : "E";
        used++;
        run.Data[UsedKey] = used.ToString(CultureInfo.InvariantCulture);
        var log = Log(run);
        log.Add(new JsonObject { ["L"] = PuzzleJson.IntArray(left.OrderBy(id => id)), ["R"] = PuzzleJson.IntArray(right.OrderBy(id => id)), ["res"] = res });
        run.Data[LogKey] = log.ToJsonString();
        return new PuzzleVerdict(false, new JsonObject
        {
            ["res"] = res,
            ["tokensLeft"] = Math.Max(0, tokens - used),
            ["round"] = Number(run, RoundKey),
            ["n"] = log.Count
        }, res switch { "L" => "Đĩa trái nặng hơn.", "R" => "Đĩa phải nặng hơn.", _ => "Hai đĩa cân bằng." }, false);
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var (vials, tokens, _) = Shape(definition);
        if (answer.ValueKind != JsonValueKind.Object || !answer.TryGetProperty("pick", out var pickElement)
            || pickElement.ValueKind != JsonValueKind.Number || !pickElement.TryGetInt32(out var pick) || pick < 1 || pick > vials)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Hãy chỉ ra một lọ trên quầy.", false);

        var heavy = CurrentHeavy(definition, run, vials);
        if (pick == heavy) return new PuzzleVerdict(true, new JsonObject { ["pick"] = pick });

        // Wrong vial: the pharmacist shuffles the row again. Weighings so far no longer count.
        var round = Number(run, RoundKey) + 1;
        var next = Reroll(definition, round, vials, pick);
        run.Data[RoundKey] = round.ToString(CultureInfo.InvariantCulture);
        run.Data[HeavyKey] = next.ToString(CultureInfo.InvariantCulture);
        run.Data[UsedKey] = "0";
        run.Data[LogKey] = "[]";
        return new PuzzleVerdict(false, new JsonObject
        {
            ["right"] = false,
            ["wrong"] = pick,
            ["round"] = round,
            ["tokensLeft"] = tokens
        }, $"Lọ Nº {pick} không phải lọ bị tráo. Các lọ đã bị xếp lại — cân lại từ đầu.");
    }

    public JsonObject? RunView(PuzzleKindContext definition, PuzzleRunState run)
    {
        var (_, tokens, _) = Shape(definition);
        return new JsonObject
        {
            ["tokens"] = tokens,
            ["tokensLeft"] = Math.Max(0, tokens - Number(run, UsedKey)),
            ["round"] = Number(run, RoundKey),
            ["log"] = Log(run)
        };
    }

    // ----- helpers -----

    /// <summary>Fewest weighings that always find one heavy vial among n with at most perPan per pan (null: never).</summary>
    public static int? MinimumWeighings(int vials, int perPan)
    {
        var memo = new Dictionary<int, int?>();
        int? Solve(int n)
        {
            if (n <= 1) return 0;
            if (memo.TryGetValue(n, out var known)) return known;
            memo[n] = null; // guards against cycles while computing
            int? best = null;
            for (var k = 1; k <= Math.Min(perPan, n / 2); k++)
            {
                // heavy is on the left (k), on the right (k) or among the n − 2k that stayed off the scale
                var worst = Math.Max(k, n - 2 * k);
                if (worst >= n) continue;
                var rest = Solve(worst);
                if (rest is null) continue;
                if (best is null || rest + 1 < best) best = rest + 1;
            }
            memo[n] = best;
            return best;
        }
        return Solve(vials);
    }

    private static (int Vials, int Tokens, int PerPan) Shape(PuzzleKindContext definition)
    {
        var p = definition.Params;
        return (Math.Clamp(PuzzleJson.Int(p, "vials", 9), MinVials, MaxVials),
            Math.Clamp(PuzzleJson.Int(p, "tokens", 2), 1, MaxTokens),
            Math.Clamp(PuzzleJson.Int(p, "perPan", MaxPerPan), 1, MaxPerPan));
    }

    private static int CurrentHeavy(PuzzleKindContext definition, PuzzleRunState run, int vials)
    {
        if (run.Data.TryGetValue(HeavyKey, out var text) && int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var stored)
            && stored >= 1 && stored <= vials)
            return stored;
        var heavy = PuzzleJson.Int(definition.Solution, "heavy", 1);
        return heavy >= 1 && heavy <= vials ? heavy : 1;
    }

    /// <summary>Seeded re-roll after a wrong pick: never the vial that was just ruled out.</summary>
    public static int Reroll(PuzzleKindContext definition, int round, int vials, int ruledOut)
    {
        var rng = new Random(PuzzleKindRegistry.StableSeed(definition.PuzzleId, "balance_scale", definition.Solution.ToJsonString(),
            round.ToString(CultureInfo.InvariantCulture), ruledOut.ToString(CultureInfo.InvariantCulture)));
        var choices = Enumerable.Range(1, vials).Where(id => id != ruledOut).ToList();
        return choices[rng.Next(choices.Count)];
    }

    private static int Number(PuzzleRunState run, string key) =>
        run.Data.TryGetValue(key, out var text) && int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? Math.Max(0, value) : 0;

    private static JsonArray Log(PuzzleRunState run)
    {
        if (!run.Data.TryGetValue(LogKey, out var text) || string.IsNullOrWhiteSpace(text)) return new JsonArray();
        try { return JsonNode.Parse(text) as JsonArray ?? new JsonArray(); }
        catch (JsonException) { return new JsonArray(); }
    }
}
