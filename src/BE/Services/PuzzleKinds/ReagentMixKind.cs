using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P10 · Pha thuốc thử. Drop reagents (yellow / blue / red, at most <c>maxDrops</c>) into the beaker;
/// the colour is a pigment-style RYB trilinear mix of the drop ratios. When the CIELAB distance to the
/// target swatch is below the tolerance, sweeping the mix over the letter reveals the hidden ink; a
/// wrong sweep stains the letter (a failed attempt).
///
/// params (public): { reagents:[{key,name,low,rgb}], cube:{w,r,y,b,ry,rb,yb,ryb}, target:[r,g,b], targetName,
///                    tolerance, maxDrops, total?, testimony? }
/// solution (secret): { recipe:{y,b,r}, hints:[…] }
/// reveal: { title, text, letter:[lines of the hidden ink] } — the letter text is sent only once solved.
/// answer: { drops:{y,b,r} } → the server mixes and measures ΔE itself.
/// The target colour and the mixing rule are public by nature (the swatch and the meter are drawn on the
/// client); the recipe is generated so that only its own ratio comes within 3 × tolerance of the target.
/// </summary>
public sealed class ReagentMixKind : IPuzzleKind
{
    public string Kind => "reagent_mix";

    public static readonly string[] Keys = { "y", "b", "r" };
    public const int MaxDrops = 8;
    public const double Tolerance = 1.5;

    private static readonly (string Key, string Name, string Low, int[] Rgb)[] DefaultReagents =
    {
        ("y", "VÀNG NGHỆ", "vàng nghệ", new[] { 226, 172, 34 }),
        ("b", "LAM ĐỒNG", "lam đồng", new[] { 36, 98, 162 }),
        ("r", "ĐỎ SON", "đỏ son", new[] { 196, 58, 38 })
    };

    /// <summary>RYB cube corners (pigment-style mixing tuned to the three reagents), from the mockup.</summary>
    private static readonly (string Corner, int[] Rgb)[] DefaultCube =
    {
        ("w", new[] { 240, 236, 222 }), ("r", new[] { 196, 58, 38 }), ("y", new[] { 226, 172, 34 }), ("b", new[] { 36, 98, 162 }),
        ("ry", new[] { 216, 108, 32 }), ("rb", new[] { 104, 44, 98 }), ("yb", new[] { 58, 132, 66 }), ("ryb", new[] { 58, 44, 30 })
    };

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        var s = definition.Solution;
        if (!PuzzleJson.Has(p, "reagents"))
        {
            p["reagents"] = new JsonArray(DefaultReagents.Select(item => (JsonNode?)new JsonObject
            {
                ["key"] = item.Key, ["name"] = item.Name, ["low"] = item.Low, ["rgb"] = PuzzleJson.IntArray(item.Rgb)
            }).ToArray());
        }
        if (!PuzzleJson.Has(p, "cube"))
        {
            var cube = new JsonObject();
            foreach (var (corner, rgb) in DefaultCube) cube[corner] = PuzzleJson.IntArray(rgb);
            p["cube"] = cube;
        }
        if (!PuzzleJson.Has(p, "tolerance")) p["tolerance"] = Tolerance;
        if (!PuzzleJson.Has(p, "maxDrops")) p["maxDrops"] = MaxDrops;
        var cubeValues = ReadCube(p) ?? DefaultCubeValues();
        var maxDrops = Math.Clamp(PuzzleJson.Int(p, "maxDrops", MaxDrops), 3, 12);
        var tolerance = PuzzleJson.Number(p, "tolerance", Tolerance);

        if (!PuzzleJson.Has(s, "recipe"))
        {
            var (minTotal, maxTotal, allThree, margin) = definition.Difficulty switch
            {
                PuzzleDifficulties.Hard => (6, 8, false, 3.0),
                PuzzleDifficulties.Normal => (5, 7, true, 4.0),
                _ => (4, 6, true, 5.0)
            };
            var candidates = AllCombos(maxDrops)
                .Where(c => c.Total >= minTotal && c.Total <= Math.Min(maxTotal, maxDrops))
                .Where(c => !allThree || (c.Y > 0 && c.B > 0 && c.R > 0))
                .Where(c => Gcd(Gcd(c.Y, c.B), c.R) == 1)
                .Where(c => NearestOther(cubeValues, c, maxDrops) >= Math.Max(margin, tolerance * 2))
                .ToList();
            var recipe = candidates.Count > 0 ? candidates[rng.Next(candidates.Count)] : new Combo(3, 2, 1);
            s["recipe"] = new JsonObject { ["y"] = recipe.Y, ["b"] = recipe.B, ["r"] = recipe.R };
        }
        var chosen = ReadRecipe(s) ?? new Combo(3, 2, 1);
        if (!PuzzleJson.Has(p, "target")) p["target"] = PuzzleJson.IntArray(Mix(cubeValues, chosen) ?? new[] { 0, 0, 0 });
        var target = PuzzleJson.Ints(p, "target").ToArray();
        if (!PuzzleJson.Has(p, "targetName") && target.Length == 3) p["targetName"] = ColourName(target);
        if (!PuzzleJson.Has(p, "total") && definition.Difficulty != PuzzleDifficulties.Hard) p["total"] = chosen.Total;
        if (!PuzzleJson.Has(p, "testimony") && definition.Difficulty == PuzzleDifficulties.Easy)
        {
            var witness = PuzzleJson.Text(p, "witness", "Thợ ảnh");
            p["testimony"] = $"{witness} khai: thuốc này luôn ‘{Rule(chosen)}’.";
        }
        if (!PuzzleJson.Has(s, "hints"))
        {
            var parts = new List<string>();
            if (chosen.Y > 0) parts.Add($"{chosen.Y} vàng");
            if (chosen.B > 0) parts.Add($"{chosen.B} lam");
            if (chosen.R > 0) parts.Add($"{chosen.R} đỏ");
            s["hints"] = new JsonArray(
                $"Tổng cộng {chosen.Total} giọt — {Rule(chosen)}.",
                $"Công thức: {string.Join(", ", parts)}.");
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        var p = definition.Params;
        var cube = ReadCube(p);
        if (cube is null) { error("params.cube", "cube must hold the 8 RYB corners as [r,g,b] (0–255)."); return; }
        var maxDrops = PuzzleJson.Int(p, "maxDrops", 0);
        if (maxDrops is < 3 or > 12) error("params.maxDrops", "maxDrops must be 3–12.");
        var tolerance = PuzzleJson.Number(p, "tolerance", 0);
        if (tolerance is <= 0 or > 10) error("params.tolerance", "tolerance must be in (0, 10].");
        var target = PuzzleJson.Ints(p, "target");
        if (target.Count != 3 || target.Any(v => v is < 0 or > 255)) { error("params.target", "target must be [r,g,b] (0–255)."); return; }
        var recipe = ReadRecipe(definition.Solution);
        if (recipe is null || recipe.Value.Total < 1 || recipe.Value.Total > Math.Max(1, maxDrops))
        {
            error("solution.recipe", "recipe must be {y,b,r} drops, 1…maxDrops in total.");
            return;
        }
        var deltaE = DeltaE(Mix(cube, recipe.Value)!, target.ToArray());
        if (deltaE >= tolerance) error("solution.recipe", $"The recipe does not reach the target colour (ΔE {deltaE:0.00}).");
        if (p["reagents"] is not JsonArray reagents || reagents.Count != 3) error("params.reagents", "reagents must list y, b and r.");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var p = definition.Params;
        var maxDrops = PuzzleJson.Int(p, "maxDrops", MaxDrops);
        var drops = ReadDrops(answer);
        if (drops is null || drops.Value.Total < 1 || drops.Value.Total > maxDrops)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Cốc chưa có thuốc hợp lệ.", false);
        var cube = ReadCube(p) ?? DefaultCubeValues();
        var target = PuzzleJson.Ints(p, "target").ToArray();
        if (target.Length != 3) return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Thiếu màu mẫu.", false);
        var deltaE = DeltaE(Mix(cube, drops.Value)!, target);
        if (deltaE < PuzzleJson.Number(p, "tolerance", Tolerance))
            return new PuzzleVerdict(true, new JsonObject { ["match"] = true });
        return new PuzzleVerdict(false, new JsonObject { ["match"] = false, ["stain"] = true }, "Sai thuốc — lá thư bị ố một góc.");
    }

    // ----- colour (same maths as PuzzleReagent.dc.html / kinds/reagent_mix.ts) -----

    public readonly record struct Combo(int Y, int B, int R)
    {
        public int Total => Y + B + R;
    }

    public static Dictionary<string, int[]> DefaultCubeValues() => DefaultCube.ToDictionary(item => item.Corner, item => item.Rgb);

    /// <summary>Trilinear RYB mix of the drop ratios (normalised by the largest count); null for an empty cup.</summary>
    public static int[]? Mix(IReadOnlyDictionary<string, int[]> cube, Combo drops)
    {
        var max = Math.Max(drops.Y, Math.Max(drops.B, drops.R));
        if (max <= 0) return null;
        double y = (double)drops.Y / max, b = (double)drops.B / max, r = (double)drops.R / max;
        var corners = new (int R, int Y, int B, string Key)[]
        {
            (0, 0, 0, "w"), (1, 0, 0, "r"), (0, 1, 0, "y"), (0, 0, 1, "b"),
            (1, 1, 0, "ry"), (1, 0, 1, "rb"), (0, 1, 1, "yb"), (1, 1, 1, "ryb")
        };
        var output = new double[3];
        foreach (var corner in corners)
        {
            var weight = (corner.R == 1 ? r : 1 - r) * (corner.Y == 1 ? y : 1 - y) * (corner.B == 1 ? b : 1 - b);
            var colour = cube[corner.Key];
            for (var i = 0; i < 3; i++) output[i] += weight * colour[i];
        }
        // Math.round in JavaScript rounds .5 up; AwayFromZero matches it for these non-negative values.
        return output.Select(value => (int)Math.Round(value, MidpointRounding.AwayFromZero)).ToArray();
    }

    public static double[] Lab(int[] rgb)
    {
        static double Linear(double v)
        {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : Math.Pow((v + 0.055) / 1.055, 2.4);
        }
        static double F(double t) => t > 0.008856 ? Math.Cbrt(t) : 7.787 * t + 16.0 / 116;
        double r = Linear(rgb[0]), g = Linear(rgb[1]), b = Linear(rgb[2]);
        var x = F((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
        var yv = F(r * 0.2126 + g * 0.7152 + b * 0.0722);
        var z = F((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
        return new[] { 116 * yv - 16, 500 * (x - yv), 200 * (yv - z) };
    }

    public static double DeltaE(int[] a, int[] b)
    {
        var la = Lab(a);
        var lb = Lab(b);
        return Math.Sqrt(Math.Pow(la[0] - lb[0], 2) + Math.Pow(la[1] - lb[1], 2) + Math.Pow(la[2] - lb[2], 2));
    }

    /// <summary>Smallest ΔE from the recipe's colour to any cup that is not the same ratio.</summary>
    public static double NearestOther(IReadOnlyDictionary<string, int[]> cube, Combo recipe, int maxDrops)
    {
        var target = Mix(cube, recipe)!;
        var nearest = double.MaxValue;
        foreach (var combo in AllCombos(maxDrops))
        {
            if (SameRatio(combo, recipe)) continue;
            nearest = Math.Min(nearest, DeltaE(Mix(cube, combo)!, target));
        }
        return nearest;
    }

    public static IEnumerable<Combo> AllCombos(int maxDrops)
    {
        for (var y = 0; y <= maxDrops; y++)
        for (var b = 0; b <= maxDrops - y; b++)
        for (var r = 0; r <= maxDrops - y - b; r++)
            if (y + b + r > 0) yield return new Combo(y, b, r);
    }

    private static bool SameRatio(Combo a, Combo b) =>
        a.Y * b.B == a.B * b.Y && a.Y * b.R == a.R * b.Y && a.B * b.R == a.R * b.B;

    private static int Gcd(int a, int b) => b == 0 ? Math.Abs(a) : Gcd(b, a % b);

    private static Dictionary<string, int[]>? ReadCube(JsonObject p)
    {
        if (p["cube"] is not JsonObject cube) return null;
        var result = new Dictionary<string, int[]>();
        foreach (var (corner, _) in DefaultCube)
        {
            var values = PuzzleJson.Ints(cube, corner);
            if (values.Count != 3 || values.Any(v => v is < 0 or > 255)) return null;
            result[corner] = values.ToArray();
        }
        return result;
    }

    private static Combo? ReadRecipe(JsonObject solution)
    {
        if (solution["recipe"] is not JsonObject recipe) return null;
        var combo = new Combo(PuzzleJson.Int(recipe, "y", -1), PuzzleJson.Int(recipe, "b", -1), PuzzleJson.Int(recipe, "r", -1));
        return combo.Y >= 0 && combo.B >= 0 && combo.R >= 0 ? combo : null;
    }

    private static Combo? ReadDrops(JsonElement answer)
    {
        if (answer.ValueKind != JsonValueKind.Object || !answer.TryGetProperty("drops", out var drops) || drops.ValueKind != JsonValueKind.Object)
            return null;
        var counts = new Dictionary<string, int> { ["y"] = 0, ["b"] = 0, ["r"] = 0 };
        foreach (var property in drops.EnumerateObject())
        {
            if (!counts.ContainsKey(property.Name)) return null;
            if (property.Value.ValueKind != JsonValueKind.Number || !property.Value.TryGetInt32(out var count) || count is < 0 or > 99) return null;
            counts[property.Name] = count;
        }
        return new Combo(counts["y"], counts["b"], counts["r"]);
    }

    /// <summary>The witness's rule of thumb for a recipe, e.g. "nhiều vàng hơn lam, đỏ chỉ một giọt".</summary>
    public static string Rule(Combo recipe)
    {
        var named = new List<(string Name, int Count)> { ("vàng", recipe.Y), ("lam", recipe.B), ("đỏ", recipe.R) }
            .Where(item => item.Count > 0).OrderByDescending(item => item.Count).ToList();
        string Amount(int count) => count == 1 ? "chỉ một giọt" : $"{count} giọt";
        if (named.Count == 1) return $"chỉ dùng {named[0].Name}";
        if (named.Count == 2)
            return named[0].Count == named[1].Count ? $"{named[0].Name} và {named[1].Name} bằng nhau"
                : $"nhiều {named[0].Name} hơn {named[1].Name}, {named[1].Name} {Amount(named[1].Count)}";
        var (a, b, c) = (named[0], named[1], named[2]);
        if (a.Count == b.Count) return $"{a.Name} và {b.Name} bằng nhau, {c.Name} {Amount(c.Count)}";
        if (b.Count == c.Count) return $"nhiều {a.Name} nhất, {b.Name} và {c.Name} mỗi thứ {Amount(b.Count).Replace("chỉ ", string.Empty)}";
        return $"nhiều {a.Name} hơn {b.Name}, {c.Name} {Amount(c.Count)}";
    }

    /// <summary>A plain Vietnamese name for the target swatch (hue / lightness buckets).</summary>
    public static string ColourName(int[] rgb)
    {
        double r = rgb[0] / 255.0, g = rgb[1] / 255.0, b = rgb[2] / 255.0;
        double max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
        var l = (max + min) / 2;
        var d = max - min;
        var sat = d == 0 ? 0 : d / (1 - Math.Abs(2 * l - 1));
        double hue = 0;
        if (d > 0)
        {
            if (max == r) hue = 60 * (((g - b) / d) % 6);
            else if (max == g) hue = 60 * ((b - r) / d + 2);
            else hue = 60 * ((r - g) / d + 4);
        }
        if (hue < 0) hue += 360;
        if (sat < 0.12) return l < 0.3 ? "xám chì" : "xám tro";
        if (l < 0.22) return "nâu sẫm";
        if (hue < 15 || hue >= 345) return l < 0.36 ? "đỏ nâu" : "đỏ gạch";
        if (hue < 40) return l < 0.36 ? "nâu đất" : "cam đất";
        if (hue < 58) return l < 0.38 ? "vàng đồng" : "vàng nghệ";
        if (hue < 100) return l < 0.36 ? "xanh rêu" : "xanh cốm";
        if (hue < 170) return "xanh lục";
        if (hue < 200) return "xanh ngọc";
        if (hue < 250) return "xanh lam";
        if (hue < 290) return "tím";
        return l < 0.3 ? "tím mận" : "đỏ mận";
    }
}
