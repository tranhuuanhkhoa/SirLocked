using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P1 · Nạy khóa ổ bi. With tension on, only the binding pin (the first unset pin in the secret binding
/// order) catches at the shear line; the others feel loose. Lifting a set pin too far jams it, and
/// releasing tension drops every pin. When all pins are set the plug turns.
///
/// params (public): { pinCount, needs:[lift per pin, 1-based order], win, over, liftMax,
///                    chest?:{title,text}, note? }
/// solution (secret): { order:[pin…], hints:[…] }
/// probe: { set:[pins already set, in order], pin:n } → { binds:bool } ("is this the binding pin now?")
/// answer: { order:[pins in the order they were set] } — equals the binding order.
/// The lift geometry (needs/win/over) is public because the pick's feel (catch, overset) is drawn on
/// the client; only which pin binds next is secret and asked through the probe.
/// </summary>
public sealed class LockpickKind : IPuzzleKind
{
    public string Kind => "lockpick";

    public const int MinPins = 3;
    public const int MaxPins = 6;
    public const int MinNeed = 10;
    public const int MaxNeed = 34;
    public const int LiftMax = 54;

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        var s = definition.Solution;
        // win = catch window below the shear line; over = how far past it a set pin may go before it jams.
        // A pin can only be lifted 20 above its shear line (keyway), so win + over < 20 keeps jams possible.
        var (pins, win, over) = definition.Difficulty switch
        {
            PuzzleDifficulties.Hard => (6, 4, 8),
            PuzzleDifficulties.Normal => (5, 5, 9),
            _ => (4, 6, 10)
        };
        if (!PuzzleJson.Has(p, "pinCount"))
        {
            // An author who pinned the needs or the order also fixed the number of pins.
            var authoredNeeds = PuzzleJson.Ints(p, "needs").Count;
            var authoredOrder = PuzzleJson.Ints(s, "order").Count;
            p["pinCount"] = authoredNeeds > 0 ? authoredNeeds : authoredOrder > 0 ? authoredOrder : pins;
        }
        var count = Math.Clamp(PuzzleJson.Int(p, "pinCount", pins), MinPins, MaxPins);
        if (!PuzzleJson.Has(p, "needs")) p["needs"] = PuzzleJson.IntArray(RandomNeeds(rng, count));
        if (!PuzzleJson.Has(p, "win")) p["win"] = win;
        if (!PuzzleJson.Has(p, "over")) p["over"] = over;
        if (!PuzzleJson.Has(p, "liftMax")) p["liftMax"] = LiftMax;
        if (!PuzzleJson.Has(s, "order")) s["order"] = PuzzleJson.IntArray(PuzzleJson.Shuffled(rng, Enumerable.Range(1, count)));
        if (!PuzzleJson.Has(s, "hints"))
        {
            var order = PuzzleJson.Ints(s, "order");
            var first = order.Count > 0 ? order[0] : 1;
            s["hints"] = new JsonArray(
                $"Chốt {first} kẹt trước. Khi một chốt khớp, chốt kẹt tiếp theo sẽ rung nhẹ.",
                $"Thứ tự kẹt: chốt {string.Join(" → ", order)}. Dừng ngay khi nghe ‘cạch’.");
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        var p = definition.Params;
        var count = PuzzleJson.Int(p, "pinCount", 0);
        if (count is < MinPins or > MaxPins) { error("params.pinCount", $"pinCount must be {MinPins}–{MaxPins}."); return; }
        var needs = PuzzleJson.Ints(p, "needs");
        if (needs.Count != count) error("params.needs", "needs must list one lift per pin.");
        else if (needs.Any(need => need is < MinNeed or > MaxNeed)) error("params.needs", $"Each need must be {MinNeed}–{MaxNeed}.");
        var win = PuzzleJson.Int(p, "win", 0);
        var over = PuzzleJson.Int(p, "over", 0);
        if (win is < 2 or > 10) error("params.win", "win must be 2–10.");
        if (over is < 4 or > 24) error("params.over", "over must be 4–24.");
        var liftMax = PuzzleJson.Int(p, "liftMax", LiftMax);
        if (needs.Count == count && needs.Any(need => need - win > Math.Min(need + 20, liftMax)))
            error("params.liftMax", "Every pin must be liftable to its shear line.");
        var order = PuzzleJson.Ints(definition.Solution, "order");
        if (!IsPermutation(order, count)) error("solution.order", "order must be a permutation of the pins 1…pinCount.");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var count = PuzzleJson.Int(definition.Params, "pinCount", 0);
        var given = PuzzleJson.Ints(answer, "order");
        if (given is null || !IsPermutation(given, count))
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Ổ khóa chưa xoay được — còn chốt chưa khớp.", false);
        var order = PuzzleJson.Ints(definition.Solution, "order");
        if (given.SequenceEqual(order))
            return new PuzzleVerdict(true, new JsonObject { ["set"] = count });
        return new PuzzleVerdict(false, new JsonObject { ["reason"] = "order" }, "Lõi khóa vẫn kẹt — các chốt không khớp đúng thứ tự.");
    }

    public PuzzleVerdict? Probe(PuzzleKindContext definition, JsonElement input, PuzzleRunState run)
    {
        var count = PuzzleJson.Int(definition.Params, "pinCount", 0);
        var set = PuzzleJson.Ints(input, "set");
        var pin = input.ValueKind == JsonValueKind.Object && input.TryGetProperty("pin", out var pinElement)
            && pinElement.ValueKind == JsonValueKind.Number && pinElement.TryGetInt32(out var number) ? number : 0;
        if (set is null || pin < 1 || pin > count || set.Count >= count || set.Any(value => value < 1 || value > count)
            || set.Distinct().Count() != set.Count || set.Contains(pin))
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Thao tác không hợp lệ.", false);
        var order = PuzzleJson.Ints(definition.Solution, "order");
        var prefix = set.Count < order.Count && set.SequenceEqual(order.Take(set.Count));
        var binds = prefix && order[set.Count] == pin;
        return new PuzzleVerdict(false, new JsonObject { ["binds"] = binds }, null, false);
    }

    /// <summary>Shear-line lifts 12–34, at least 4 apart so every pin looks and feels different.</summary>
    public static List<int> RandomNeeds(Random rng, int count)
    {
        const int low = MinNeed + 2, gap = 4;
        var slack = Math.Max(0, MaxNeed - low - gap * (count - 1));
        // Split the slack into count + 1 random parts (stars and bars), then lay the pins out in order.
        var cuts = Enumerable.Range(0, count).Select(_ => rng.Next(slack + 1)).OrderBy(value => value).ToList();
        var sorted = cuts.Select((cut, index) => low + cut + gap * index).ToList();
        return PuzzleJson.Shuffled(rng, sorted);
    }

    private static bool IsPermutation(List<int> values, int count) =>
        count > 0 && values.Count == count && values.OrderBy(value => value).SequenceEqual(Enumerable.Range(1, count));
}
