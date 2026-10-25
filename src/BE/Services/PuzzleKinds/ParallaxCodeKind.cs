using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P8 · Góc nhìn đúng. A drawing in four depth layers (d1 front … d4 back) moves by
/// −viewpoint × amplitude × depth factor. Each character of the code is painted in white strokes that
/// are split over several layers; the pieces only join into the character at one viewpoint. The team
/// finds the three viewpoints, reads the characters and enters them in the order the partner's clue gives.
///
/// params (public): { slots:[{id,name,short,at:[x,y]}…3], views:[[x,y]…] (one per slot), order:[slotId…] (code
///   order — the clue), paint:{d1:[{g,d}…],…,d4:[…]} (g = slot index, −1 = decoy; d = path already
///   offset for its layer), width, snap, glimmer, amp:[ax,ay], depth:{d1..d4}, + authored text }
/// solution (secret): { code:"74N", hints:[…] }
/// answer: { code:"74N" } or { code:["7","@cage","N"] } ("@slot" = the character painted at that slot).
/// Wrong → { firstWrong:i, wrong:n } — the mockup's "this cell does not match" — and from the
/// <see cref="FreeTries"/>th wrong code on, the lock jams for a few seconds (server clock).
/// </summary>
public sealed class ParallaxCodeKind : IPuzzleKind
{
    public string Kind => "parallax_code";

    /// <summary>Server clock (replaceable in tests).</summary>
    public Func<DateTime> Clock { get; init; } = () => DateTime.UtcNow;

    public const int Length = 3;
    public const int FreeTries = 3;
    public const double AmpX = 110, AmpY = 90;
    public const double ViewMinY = -0.4;
    public static readonly IReadOnlyDictionary<string, double> Depth = new Dictionary<string, double>
    {
        ["d1"] = 1, ["d2"] = 0.66, ["d3"] = 0.36, ["d4"] = 0.08
    };
    private static readonly string[] Layers = { "d1", "d2", "d3", "d4" };

    private const string WrongKey = "wrong";
    private const string LockKey = "lockUntil";

    /// <summary>The objects of the drawing the characters are painted on (design px of the 600×540 picture).</summary>
    private static readonly (string Id, string Name, string Short, double X, double Y)[] DefaultSlots =
    {
        ("books", "chồng sách", "sách", 123, 407),
        ("cage", "lồng chim", "lồng chim", 432, 82),
        ("vases", "ba chiếc bình", "bình", 279, 234)
    };

    /// <summary>
    /// A small glyph set drawn with straight strokes on a 4 × 6 grid (y down). Characters that are easy to
    /// confuse in rough brush strokes (0/O, 1/I, 2/Z, 5/S, 8/B…) are left out.
    /// </summary>
    public static readonly IReadOnlyDictionary<char, double[][]> Glyphs = new Dictionary<char, double[][]>
    {
        ['3'] = new[] { new double[] { 0, 0.4, 1, 0, 3, 0, 4, 1, 4, 2, 3, 2.8, 1.5, 2.8 }, new double[] { 3, 2.8, 4, 3.8, 4, 5, 3, 6, 1, 6, 0, 5.6 } },
        ['4'] = new[] { new double[] { 3, 6, 3, 0, 0, 4, 4, 4 } },
        ['7'] = new[] { new double[] { 0, 0, 4, 0, 1.5, 6 } },
        ['A'] = new[] { new double[] { 0, 6, 2, 0, 4, 6 }, new double[] { 0.8, 3.8, 3.2, 3.8 } },
        ['E'] = new[] { new double[] { 4, 0, 0, 0, 0, 6, 4, 6 }, new double[] { 0, 3, 3, 3 } },
        ['F'] = new[] { new double[] { 4, 0, 0, 0, 0, 6 }, new double[] { 0, 3, 3, 3 } },
        ['H'] = new[] { new double[] { 0, 0, 0, 6 }, new double[] { 4, 0, 4, 6 }, new double[] { 0, 3, 4, 3 } },
        ['K'] = new[] { new double[] { 0, 0, 0, 6 }, new double[] { 4, 0, 0, 3.6 }, new double[] { 1.3, 2.5, 4, 6 } },
        ['L'] = new[] { new double[] { 0, 0, 0, 6, 4, 6 } },
        ['M'] = new[] { new double[] { 0, 6, 0, 0, 2, 3.6, 4, 0, 4, 6 } },
        ['N'] = new[] { new double[] { 0, 6, 0, 0, 4, 6, 4, 0 } },
        ['T'] = new[] { new double[] { 0, 0, 4, 0 }, new double[] { 2, 0, 2, 6 } },
        ['V'] = new[] { new double[] { 0, 0, 2, 6, 4, 0 } },
        ['X'] = new[] { new double[] { 0, 0, 4, 6 }, new double[] { 4, 0, 0, 6 } },
        ['Y'] = new[] { new double[] { 0, 0, 2, 3 }, new double[] { 4, 0, 2, 3, 2, 6 } }
    };

    private const double CellX = 16, CellY = 15;   // grid → design px (glyph ≈ 64 × 90)

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        var easy = definition.Difficulty == PuzzleDifficulties.Easy;
        var hard = definition.Difficulty == PuzzleDifficulties.Hard;

        List<Slot> slots;
        try { slots = Slots(p); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            p["slots"] = new JsonArray(DefaultSlots.Select(slot => (JsonNode?)new JsonObject
            {
                ["id"] = slot.Id, ["name"] = slot.Name, ["short"] = slot.Short, ["at"] = new JsonArray(slot.X, slot.Y)
            }).ToArray());
            slots = Slots(p);
        }

        // the code (secret): authored or three different characters from the glyph set
        var code = Normalize(PuzzleJson.Text(definition.Solution, "code"));
        if (code.Length != Length || code.Any(ch => !Glyphs.ContainsKey(ch)) || code.Distinct().Count() != Length)
        {
            var pool = Glyphs.Keys.OrderBy(ch => ch).ToList();
            var picked = new List<char>();
            while (picked.Count < Length)
            {
                var ch = pool[rng.Next(pool.Count)];
                if (!picked.Contains(ch)) picked.Add(ch);
            }
            code = new string(picked.ToArray());
            definition.Solution["code"] = code;
        }

        // code order over the slots (public: it is what the partner's testimony says)
        List<int> order;
        try { order = Order(p, slots); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            p["order"] = new JsonArray(PuzzleJson.Shuffled(rng, Enumerable.Range(0, Length)).Select(i => (JsonNode?)slots[i].Id).ToArray());
            order = Order(p, slots);
        }

        if (!PuzzleJson.Has(p, "snap")) p["snap"] = easy ? 0.12 : hard ? 0.065 : 0.085;
        if (!PuzzleJson.Has(p, "glimmer")) p["glimmer"] = easy ? 0.36 : hard ? 0.2 : 0.26;
        p["amp"] = new JsonArray(AmpX, AmpY);
        p["viewMinY"] = ViewMinY;
        p["depth"] = new JsonObject(Depth.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)JsonValue.Create(pair.Value))));
        if (!PuzzleJson.Has(p, "width")) p["width"] = 7.5;

        List<(double X, double Y)> views;
        try { views = Views(p); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            p["views"] = new JsonArray(RandomViews(rng, easy ? 0.62 : 0.48).Select(v => (JsonNode?)new JsonArray(v.X, v.Y)).ToArray());
            views = Views(p);
        }

        if (p["paint"] is not JsonObject)
        {
            var paint = new Dictionary<string, JsonArray>();
            foreach (var layer in Layers) paint[layer] = new JsonArray();
            // the character at slot s is code[position of s in the order]
            for (var s = 0; s < Length; s++)
            {
                var ch = code[order.IndexOf(s)];
                var layers = easy ? new[] { "d1", "d2", "d3" } : Layers;
                foreach (var (layer, d) in Pieces(ch, slots[s], views[s], layers, rng))
                    paint[layer].Add(new JsonObject { ["g"] = s, ["d"] = d });
            }
            var decoys = easy ? 3 : hard ? 7 : 5;
            for (var i = 0; i < decoys; i++)
            {
                var layer = Layers[rng.Next(Layers.Length)];
                paint[layer].Add(new JsonObject { ["g"] = -1, ["d"] = Decoy(rng) });
            }
            p["paint"] = new JsonObject(paint.Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)pair.Value)));
        }

        if (!PuzzleJson.Has(definition.Solution, "hints"))
        {
            var first = order[0];
            definition.Solution["hints"] = new JsonArray(
                "Vệt ở xa trôi ít, vệt ở gần trôi nhiều. Tìm chỗ đứng mà các vệt trên cùng một món đồ nối liền.",
                $"Thứ tự là {string.Join(", ", order.Select(i => slots[i].Name))}. Ký tự trên {slots[first].Name} hiện ra khi đứng {Describe(views[first])}.");
        }
        // reveal (sent only once solved): authored text may say {code}
        var spaced = string.Join(" ", code.ToCharArray());
        if (!PuzzleJson.Has(definition.Reveal, "title")) definition.Reveal["title"] = $"Mã: {spaced}";
        if (!PuzzleJson.Has(definition.Reveal, "text"))
            definition.Reveal["text"] = "Ba ký tự chỉ hiện ra từ đúng chỗ đứng của người đã sơn chúng.";
        foreach (var field in new[] { "title", "text" })
            if (PuzzleJson.Text(definition.Reveal, field) is { } value && value.Contains("{code}"))
                definition.Reveal[field] = value.Replace("{code}", spaced);
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        var p = definition.Params;
        var code = Normalize(PuzzleJson.Text(definition.Solution, "code"));
        if (code.Length != Length) error("solution.code", $"solution.code must have {Length} characters.");
        else if (code.Any(ch => !Glyphs.ContainsKey(ch)))
            error("solution.code", "Every character must be in the glyph set: " + string.Join("", Glyphs.Keys.OrderBy(ch => ch)));
        if (PuzzleJson.Has(p, "code")) error("params.code", "The code is secret: put it in solution.code.");
        List<Slot> slots;
        try { slots = Slots(p); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            error("params.slots", exception.Message);
            return;
        }
        try { Order(p, slots); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException) { error("params.order", exception.Message); }
        List<(double X, double Y)> views;
        try { views = Views(p); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            error("params.views", exception.Message);
            return;
        }
        if (views.Any(v => v.X < -1 || v.X > 1 || v.Y < ViewMinY || v.Y > 1)) error("params.views", "Viewpoints must be within x −1…1 and y −0.4…1.");
        var snap = PuzzleJson.Number(p, "snap", 0.085);
        for (var i = 0; i < views.Count; i++)
        {
            if (Distance(views[i], (0, 0)) < 0.3) error($"params.views[{i}]", "A viewpoint is too close to the starting view (the character would show at once).");
            for (var j = i + 1; j < views.Count; j++)
                if (Distance(views[i], views[j]) < Math.Max(0.3, snap * 3)) error($"params.views[{j}]", "Two viewpoints are too close together.");
        }
        if (p["paint"] is not JsonObject paint || Layers.Any(layer => paint[layer] is not JsonArray))
            error("params.paint", "paint must hold the stroke lists d1…d4.");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var now = Clock();
        if (run.Data.TryGetValue(LockKey, out var lockText) && long.TryParse(lockText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var lockTicks)
            && lockTicks > now.Ticks)
        {
            var wait = (int)Math.Ceiling(TimeSpan.FromTicks(lockTicks - now.Ticks).TotalSeconds);
            return new PuzzleVerdict(false, new JsonObject { ["locked"] = true, ["wait"] = wait },
                $"Ổ khóa đang kẹt — thử lại sau {wait} giây.", false);
        }

        var code = Normalize(PuzzleJson.Text(definition.Solution, "code"));
        var cells = Cells(definition, answer);
        if (cells is null || code.Length != Length)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, $"Hãy ghi đủ {Length} ký tự.", false);

        var firstWrong = Enumerable.Range(0, Length).FirstOrDefault(i => cells[i] != code[i], -1);
        if (firstWrong < 0) return new PuzzleVerdict(true, new JsonObject { ["code"] = code });

        var wrong = (run.Data.TryGetValue(WrongKey, out var wrongText) && int.TryParse(wrongText, out var w) ? w : 0) + 1;
        run.Data[WrongKey] = wrong.ToString(CultureInfo.InvariantCulture);
        var feedback = new JsonObject { ["firstWrong"] = firstWrong, ["wrong"] = wrong };
        if (wrong >= FreeTries)
        {
            var seconds = Math.Min(30, 5 * (wrong - FreeTries + 1));
            run.Data[LockKey] = now.AddSeconds(seconds).Ticks.ToString(CultureInfo.InvariantCulture);
            feedback["wait"] = seconds;
        }
        return new PuzzleVerdict(false, feedback, $"Ký tự ô thứ {firstWrong + 1} không khớp — mực trôi mất.");
    }

    // ----- answer -----

    /// <summary>The submitted cells as characters ("@slot" resolved to the character painted there), or null.</summary>
    private static string? Cells(PuzzleKindContext definition, JsonElement answer)
    {
        if (answer.ValueKind != JsonValueKind.Object || !answer.TryGetProperty("code", out var codeElement)) return null;
        if (codeElement.ValueKind == JsonValueKind.String)
        {
            var text = Normalize(codeElement.GetString());
            return text.Length == Length ? text : null;
        }
        if (codeElement.ValueKind != JsonValueKind.Array || codeElement.GetArrayLength() != Length) return null;
        var code = Normalize(PuzzleJson.Text(definition.Solution, "code"));
        List<Slot> slots;
        List<int> order;
        try
        {
            slots = Slots(definition.Params);
            order = Order(definition.Params, slots);
        }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException) { return null; }
        var result = new StringBuilder();
        foreach (var item in codeElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) return null;
            var value = item.GetString()?.Trim() ?? string.Empty;
            if (value.StartsWith('@'))
            {
                var slot = slots.FindIndex(s => s.Id == value[1..]);
                if (slot < 0 || code.Length != Length) return null;
                result.Append(code[order.IndexOf(slot)]);
                continue;
            }
            var ch = Normalize(value);
            if (ch.Length != 1) return null;
            result.Append(ch[0]);
        }
        return result.ToString();
    }

    /// <summary>Upper-case letters and digits only (spaces, dots and separators dropped).</summary>
    public static string Normalize(string? text) =>
        new((text ?? string.Empty).ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());

    // ----- params -----

    public readonly record struct Slot(string Id, string Name, double X, double Y);

    private static List<Slot> Slots(JsonObject p)
    {
        if (p["slots"] is not JsonArray array || array.Count != Length) throw new InvalidOperationException($"slots must list {Length} objects.");
        var slots = array.Select(node =>
        {
            if (node is not JsonObject slot) throw new FormatException("A slot is { id, name, at:[x,y] }.");
            var at = slot["at"] as JsonArray;
            if (at is null || at.Count != 2) throw new FormatException("slot.at is [x, y].");
            return new Slot(PuzzleJson.Text(slot, "id"), PuzzleJson.Text(slot, "name"), Num(at[0]), Num(at[1]));
        }).ToList();
        if (slots.Any(slot => slot.Id.Length == 0) || slots.Select(slot => slot.Id).Distinct().Count() != Length)
            throw new FormatException("Slot ids must be distinct and non-empty.");
        return slots;
    }

    private static List<int> Order(JsonObject p, List<Slot> slots)
    {
        if (p["order"] is not JsonArray array || array.Count != Length) throw new InvalidOperationException($"order must list the {Length} slot ids in code order.");
        var order = array.Select(node => node is JsonValue value && value.TryGetValue<string>(out var id) ? slots.FindIndex(slot => slot.Id == id) : -1).ToList();
        if (order.Any(i => i < 0) || order.Distinct().Count() != Length) throw new FormatException("order must list each slot id once.");
        return order;
    }

    private static List<(double X, double Y)> Views(JsonObject p)
    {
        if (p["views"] is not JsonArray array || array.Count != Length) throw new InvalidOperationException($"views must list {Length} viewpoints.");
        return array.Select(node =>
        {
            var v = node as JsonArray;
            if (v is null || v.Count != 2) throw new FormatException("A viewpoint is [x, y].");
            return (Num(v[0]), Num(v[1]));
        }).ToList();
    }

    // ----- generation -----

    private static List<(double X, double Y)> RandomViews(Random rng, double spacing)
    {
        for (var attempt = 0; attempt < 2000; attempt++)
        {
            var views = new List<(double X, double Y)>();
            for (var i = 0; i < Length; i++)
                views.Add((Math.Round(-0.9 + rng.NextDouble() * 1.8, 2), Math.Round(-0.25 + rng.NextDouble() * 1.1, 2)));
            if (views.All(v => Distance(v, (0, 0)) >= 0.38)
                && views.SelectMany((a, i) => views.Skip(i + 1).Select(b => Distance(a, b))).All(d => d >= spacing))
                return views;
        }
        return new() { (-0.7, 0.4), (0.35, 0.45), (0.95, 0.6) }; // the mockup's three spots
    }

    /// <summary>
    /// Cuts a character into short pieces and spreads them over the depth layers. Each piece is drawn at its
    /// place in the character plus the layer's shift at the target viewpoint, so the layer motion cancels
    /// out exactly there.
    /// </summary>
    private static IEnumerable<(string Layer, string D)> Pieces(char ch, Slot slot, (double X, double Y) view, string[] layers, Random rng)
    {
        var originX = slot.X - 2 * CellX;
        var originY = slot.Y - 3 * CellY;
        var segments = new List<((double X, double Y) A, (double X, double Y) B)>();
        foreach (var line in Glyphs[ch])
        {
            for (var i = 0; i + 3 < line.Length; i += 2)
            {
                var a = (X: originX + line[i] * CellX, Y: originY + line[i + 1] * CellY);
                var b = (X: originX + line[i + 2] * CellX, Y: originY + line[i + 3] * CellY);
                var length = Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
                var parts = length > 58 ? 2 : 1;
                for (var k = 0; k < parts; k++)
                {
                    var t0 = (double)k / parts;
                    var t1 = (double)(k + 1) / parts;
                    segments.Add(((a.X + (b.X - a.X) * t0, a.Y + (b.Y - a.Y) * t0), (a.X + (b.X - a.X) * t1, a.Y + (b.Y - a.Y) * t1)));
                }
            }
        }
        // consecutive pieces sit on different layers, starting from a random one
        var start = rng.Next(layers.Length);
        for (var i = 0; i < segments.Count; i++)
        {
            var layer = layers[(start + i) % layers.Length];
            var f = Depth[layer];
            var (dx, dy) = (view.X * AmpX * f, view.Y * AmpY * f);
            var (a, b) = segments[i];
            // stretch each piece a little so the joints close up once aligned
            var len = Math.Max(1, Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y)));
            var (ux, uy) = ((b.X - a.X) / len * 2.5, (b.Y - a.Y) / len * 2.5);
            yield return (layer, $"M{F(a.X - ux + dx)} {F(a.Y - uy + dy)}L{F(b.X + ux + dx)} {F(b.Y + uy + dy)}");
        }
    }

    private static string Decoy(Random rng)
    {
        var x = 40 + rng.NextDouble() * 520;
        var y = 40 + rng.NextDouble() * 460;
        var angle = rng.NextDouble() * Math.PI;
        var length = 14 + rng.NextDouble() * 26;
        return $"M{F(x)} {F(y)}L{F(x + Math.Cos(angle) * length)} {F(y + Math.Sin(angle) * length)}";
    }

    private static string Describe((double X, double Y) view)
    {
        var h = view.X < -0.55 ? "lệch hẳn sang trái" : view.X < -0.15 ? "hơi lệch trái" : view.X <= 0.15 ? "ở giữa" : view.X <= 0.55 ? "hơi lệch phải" : "lệch hẳn sang phải";
        var v = view.Y < -0.15 ? "đứng thẳng nhìn xuống" : view.Y <= 0.2 ? "ngang tầm mắt" : view.Y <= 0.55 ? "hơi khom xuống" : "ngồi thấp";
        return $"{h}, {v}";
    }

    private static double Num(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<double>(out var number) && double.IsFinite(number) ? number : throw new FormatException("Expected a number.");

    private static double Distance((double X, double Y) a, (double X, double Y) b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));

    private static string F(double value) => Math.Round(value, 1).ToString(CultureInfo.InvariantCulture);
}
