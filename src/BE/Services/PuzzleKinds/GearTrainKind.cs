using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P6 · Bộ bánh răng đồng hồ. Gears from a tray go onto pegs between a fixed crank (drive) gear and the
/// hand (output) gear. Two gears mesh when their centre distance equals the sum of their pitch radii
/// (r = teeth × module / 2) within a tolerance; a gear that comes closer than that plus two addenda and a
/// clearance collides. Every mesh reverses the direction, so the hands only run forward when an odd
/// number of gears sits between the ends; a bent gear anywhere in the driven train jams it.
///
/// The board is picked from a small library of layouts that were verified by brute force (exactly one
/// way to make the hands run forward, plus a shorter train that runs them backwards).
///
/// params (public): { drive:{x,y,teeth}, output:{x,y,teeth}, module, tolerance, clearance, kinkDeg,
///                    pegs:[{id,x,y}], tray:[{id,teeth,bent?,a0}], targetMin, startMin, layout }
/// solution (secret): { mount:{peg:gearId}, hints:[…] }
/// answer: { mount:{peg:gearId} } — the server rebuilds the mesh graph and runs the train.
/// </summary>
public sealed class GearTrainKind : IPuzzleKind
{
    public string Kind => "gear_train";
    public const double Module = 8;
    public const double Tolerance = 1.5;
    public const double Clearance = 8;
    public const int KinkDeg = 180;
    public static readonly int[] TraySizes = { 10, 16, 24 };

    public sealed record Peg(string Id, double X, double Y);
    public sealed record Gear(string Id, int Teeth, bool Bent);
    public sealed record Board(double DriveX, double DriveY, int DriveTeeth, double OutX, double OutY, int OutTeeth,
        double Module, double Tolerance, double Clearance, List<Peg> Pegs, List<Gear> Tray);
    public sealed record Layout(string Id, string Difficulty, (string Id, double X, double Y)[] Pegs, (string Id, int Teeth, bool Bent)[] Tray);

    public enum Outcome { Forward, Backward, Bent, Conflict, Open, Hit, Invalid }

    /// <summary>Drive (crank) and hand gear sit where the clock's back plate has its bushings.</summary>
    public const double DriveX = 222, DriveY = 262, OutX = 634.7, OutY = 220.5;
    public const int DriveTeeth = 20, OutTeeth = 12;

    /// <summary>Verified boards (see PuzzleKindGearTrainTests: unique forward train + a backwards trap).</summary>
    public static readonly Layout[] Library =
    {
        new("E1", PuzzleDifficulties.Easy, new[] { ("A", 365.6, 251.4), ("B", 516.9, 303.4), ("C", 443.4, 353.0), ("D", 603.2, 361.0) },
            new[] { ("M1", 16, false), ("M2", 16, false), ("L1", 24, false), ("X", 16, true) }),
        new("E2", PuzzleDifficulties.Easy, new[] { ("A", 383.7, 192.5), ("B", 528.9, 318.1), ("C", 434.3, 344.3), ("D", 593.6, 358.5) },
            new[] { ("M1", 16, false), ("L1", 24, false), ("L2", 24, false), ("X", 16, true) }),
        new("E3", PuzzleDifficulties.Easy, new[] { ("A", 352.5, 201.1), ("B", 498.4, 266.8), ("C", 436.2, 337.4), ("D", 595.8, 325.5) },
            new[] { ("M1", 16, false), ("M2", 16, false), ("L1", 24, false), ("X", 16, true) }),
        // N1 is the board of the design mockup (PuzzleGears.dc.html).
        new("N1", PuzzleDifficulties.Normal, new[] { ("A", 364.6, 242.0), ("B", 503.2, 162.0), ("C", 467.4, 364.5), ("D", 624.1, 332.0) },
            new[] { ("S1", 10, false), ("M1", 16, false), ("M2", 16, false), ("L1", 24, false), ("X", 16, true) }),
        new("N2", PuzzleDifficulties.Normal, new[] { ("A", 386.5, 199.5), ("B", 532.2, 265.6), ("C", 484.5, 364.6), ("D", 641.2, 332.3) },
            new[] { ("M1", 16, false), ("L1", 24, false), ("L2", 24, false), ("S1", 10, false), ("X", 16, true) }),
        new("N3", PuzzleDifficulties.Normal, new[] { ("A", 397.2, 245.3), ("B", 536.5, 166.6), ("C", 436.8, 400.4), ("D", 591.0, 357.7) },
            new[] { ("M1", 16, false), ("L1", 24, false), ("L2", 24, false), ("M2", 16, false), ("X", 16, true) }),
        new("H1", PuzzleDifficulties.Hard, new[] { ("A", 397.9, 266.7), ("B", 527.7, 253.6), ("C", 495.4, 393.6), ("D", 605.7, 328.7), ("E", 381.7, 188.1) },
            new[] { ("M1", 16, false), ("M2", 16, false), ("L1", 24, false), ("L2", 24, false), ("X", 16, true) }),
        new("H2", PuzzleDifficulties.Hard, new[] { ("A", 383.3, 332.4), ("B", 506.3, 155.4), ("C", 540.9, 360.3), ("D", 664.8, 328.4), ("E", 353.9, 204.3) },
            new[] { ("M1", 16, false), ("M2", 16, false), ("L1", 24, false), ("L2", 24, false), ("X", 16, true) }),
    };

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        if (!PuzzleJson.Has(p, "pegs") || !PuzzleJson.Has(p, "tray"))
        {
            var pool = Library.Where(layout => layout.Difficulty == definition.Difficulty).ToArray();
            var layout = pool[rng.Next(pool.Length)];
            // Letter the pegs left → right so the answer is not always "A, C, D".
            var pegs = layout.Pegs.OrderBy(peg => peg.X).ThenBy(peg => peg.Y)
                .Select((peg, index) => new JsonObject { ["id"] = ((char)('A' + index)).ToString(), ["x"] = peg.X, ["y"] = peg.Y }).ToList();
            // Shuffle the tray (the bent gear stays in its own compartment at the end).
            var plain = PuzzleJson.Shuffled(rng, Enumerable.Range(0, layout.Tray.Length).Where(index => !layout.Tray[index].Bent)).ToList();
            var bent = Enumerable.Range(0, layout.Tray.Length).Where(index => layout.Tray[index].Bent);
            var tray = plain.Concat(bent).Select(index => new JsonObject
            {
                ["id"] = layout.Tray[index].Id,
                ["teeth"] = layout.Tray[index].Teeth,
                ["bent"] = layout.Tray[index].Bent,
                ["a0"] = rng.Next(-20, 21)
            }).ToList();
            p["pegs"] = new JsonArray(pegs.Select(node => (JsonNode?)node).ToArray());
            p["tray"] = new JsonArray(tray.Select(node => (JsonNode?)node).ToArray());
            p["layout"] = layout.Id;
        }
        if (!PuzzleJson.Has(p, "drive")) p["drive"] = new JsonObject { ["x"] = DriveX, ["y"] = DriveY, ["teeth"] = DriveTeeth };
        if (!PuzzleJson.Has(p, "output")) p["output"] = new JsonObject { ["x"] = OutX, ["y"] = OutY, ["teeth"] = OutTeeth };
        if (!PuzzleJson.Has(p, "module")) p["module"] = Module;
        if (!PuzzleJson.Has(p, "tolerance")) p["tolerance"] = Tolerance;
        if (!PuzzleJson.Has(p, "clearance")) p["clearance"] = Clearance;
        if (!PuzzleJson.Has(p, "kinkDeg")) p["kinkDeg"] = KinkDeg;
        if (!PuzzleJson.Has(p, "startMin")) p["startMin"] = 0;
        // 5-minute steps between 1:00 and 11:55 on the 12-hour dial
        if (!PuzzleJson.Has(p, "targetMin")) p["targetMin"] = rng.Next(12, 144) * 5;

        Board board;
        try { board = Read(p); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException) { return; }
        var s = definition.Solution;
        if (!PuzzleJson.Has(s, "mount") && Solve(board) is { } mount)
        {
            var node = new JsonObject();
            foreach (var (peg, gear) in mount.OrderBy(pair => pair.Key)) node[peg] = gear;
            s["mount"] = node;
        }
        if (!PuzzleJson.Has(s, "hints"))
        {
            var route = s["mount"] is JsonObject solution ? Route(board, solution.ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>())) : new List<string>();
            s["hints"] = new JsonArray(
                "Mỗi lần ăn khớp, chiều quay đổi một lần. Đếm số bánh răng nằm giữa tay quay và bánh kim.",
                route.Count > 0
                    ? $"Đi đường qua trục {string.Join(" → ", route)}: cần {route.Count} bánh răng ở giữa, và đừng dùng bánh cong."
                    : "Cần một số lẻ bánh răng ở giữa — và đừng dùng bánh cong.");
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        Board board;
        try { board = Read(definition.Params); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            error("params", exception.Message);
            return;
        }
        if (board.Pegs.Count is < 2 or > 6) error("params.pegs", "Use 2–6 pegs.");
        if (board.Pegs.Select(peg => peg.Id).Distinct().Count() != board.Pegs.Count) error("params.pegs", "Peg ids must be unique.");
        if (board.Tray.Count is < 1 or > 5) error("params.tray", "The tray holds 1–5 gears.");
        if (board.Tray.Select(gear => gear.Id).Distinct().Count() != board.Tray.Count) error("params.tray", "Gear ids must be unique.");
        if (board.Tray.Any(gear => !TraySizes.Contains(gear.Teeth))) error("params.tray", "Tray gears must have 10, 16 or 24 teeth (the art has no other sizes).");
        if (board.Tray.Any(gear => gear.Bent && gear.Teeth != 16)) error("params.tray", "Only a 16-tooth gear can be the bent one.");
        if (board.DriveTeeth != DriveTeeth || board.OutTeeth != OutTeeth) error("params.drive", "The crank gear has 20 teeth and the hand gear 12.");
        if (Math.Abs(board.DriveX - DriveX) > 0.01 || Math.Abs(board.DriveY - DriveY) > 0.01 || Math.Abs(board.OutX - OutX) > 0.01 || Math.Abs(board.OutY - OutY) > 0.01)
            error("params.drive", "The crank and the hand gear sit on fixed bushings of the back plate art; only pegs and tray change.");
        if (board.Pegs.Any(peg => peg.X is < 60 or > 740 || peg.Y is < 60 or > 480)) error("params.pegs", "Pegs must sit on the back plate (x 60–740, y 60–480).");
        var mount = Solve(board);
        if (mount is null) error("params", "No set of tray gears makes the hands run forward.");
        else if (PuzzleJson.Has(definition.Solution, "mount"))
        {
            var authored = ReadMount(definition.Solution);
            if (authored is null || Run(board, authored) != Outcome.Forward) error("solution.mount", "The stored mount does not run the hands forward.");
        }
        var target = PuzzleJson.Int(definition.Params, "targetMin", -1);
        if (target is < 1 or > 719) error("params.targetMin", "targetMin is minutes on a 12-hour dial (1–719).");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        Board board;
        try { board = Read(definition.Params); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            return new PuzzleVerdict(false, new JsonObject { ["result"] = "invalid" }, "Bộ máy không đọc được.", false);
        }
        var mount = ReadMount(answer);
        var outcome = mount is null ? Outcome.Invalid : Run(board, mount);
        var (word, message) = outcome switch
        {
            Outcome.Forward => ("forward", (string?)null),
            Outcome.Backward => ("backward", "Kim quay ngược — cần đổi đường truyền."),
            Outcome.Bent => ("bent", "Bánh răng cong làm kẹt cả bộ máy."),
            Outcome.Conflict => ("conflict", "Hai nhánh truyền ép nhau ngược chiều — bộ máy kẹt cứng."),
            Outcome.Open => ("open", "Đường truyền chưa tới bánh kim."),
            Outcome.Hit => ("hit", "Có hai bánh răng đâm vào nhau."),
            _ => ("invalid", "Cách lắp bánh răng không hợp lệ.")
        };
        // Turning a train that never reaches the hands is not a wrong answer, just a test.
        return new PuzzleVerdict(outcome == Outcome.Forward, new JsonObject { ["result"] = word }, message,
            outcome is not (Outcome.Open or Outcome.Invalid));
    }

    // ----- mechanics (same rules as PuzzleGears.dc.html graph()/train()/check()) -----

    public static double Radius(Board board, int teeth) => teeth * board.Module / 2;

    private sealed record Node(string Id, double X, double Y, int Teeth, bool Bent);

    public static Outcome Run(Board board, IReadOnlyDictionary<string, string> mount)
    {
        var gears = board.Tray.ToDictionary(gear => gear.Id);
        var pegs = board.Pegs.ToDictionary(peg => peg.Id);
        if (mount.Keys.Any(peg => !pegs.ContainsKey(peg)) || mount.Values.Any(gear => !gears.ContainsKey(gear))) return Outcome.Invalid;
        if (mount.Values.Distinct().Count() != mount.Count) return Outcome.Invalid;
        var nodes = new List<Node> { new("drv", board.DriveX, board.DriveY, board.DriveTeeth, false), new("out", board.OutX, board.OutY, board.OutTeeth, false) };
        nodes.AddRange(mount.Select(pair => new Node(pair.Value, pegs[pair.Key].X, pegs[pair.Key].Y, gears[pair.Value].Teeth, gears[pair.Value].Bent)));
        var adjacency = nodes.ToDictionary(node => node.Id, _ => new List<string>());
        for (var i = 0; i < nodes.Count; i++)
        for (var j = i + 1; j < nodes.Count; j++)
        {
            var (a, b) = (nodes[i], nodes[j]);
            var distance = Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
            var sum = Radius(board, a.Teeth) + Radius(board, b.Teeth);
            if (Math.Abs(distance - sum) <= board.Tolerance) { adjacency[a.Id].Add(b.Id); adjacency[b.Id].Add(a.Id); }
            else if (distance < sum + 2 * board.Module + board.Clearance) return Outcome.Hit;
        }
        var sign = new Dictionary<string, int> { ["drv"] = 1 };
        var order = new List<string> { "drv" };
        var conflict = false;
        for (var index = 0; index < order.Count; index++)
        {
            var u = order[index];
            foreach (var v in adjacency[u])
            {
                if (!sign.TryGetValue(v, out var existing)) { sign[v] = -sign[u]; order.Add(v); }
                else if (existing == sign[u]) conflict = true;
            }
        }
        if (conflict) return Outcome.Conflict;
        if (order.Any(id => gears.TryGetValue(id, out var gear) && gear.Bent)) return Outcome.Bent;
        if (!sign.TryGetValue("out", out var outSign)) return Outcome.Open;
        return outSign > 0 ? Outcome.Forward : Outcome.Backward;
    }

    /// <summary>Every way to put tray gears on pegs (at most one gear per peg, each gear once).</summary>
    public static IEnumerable<Dictionary<string, string>> AllMounts(Board board)
    {
        var pegs = board.Pegs.Select(peg => peg.Id).ToList();
        var gears = board.Tray.Select(gear => gear.Id).ToList();
        var current = new Dictionary<string, string>();
        var used = new HashSet<string>();
        IEnumerable<Dictionary<string, string>> Walk(int index)
        {
            if (index == pegs.Count) { yield return new Dictionary<string, string>(current); yield break; }
            foreach (var mount in Walk(index + 1)) yield return mount;
            foreach (var gear in gears)
            {
                if (!used.Add(gear)) continue;
                current[pegs[index]] = gear;
                foreach (var mount in Walk(index + 1)) yield return mount;
                current.Remove(pegs[index]);
                used.Remove(gear);
            }
        }
        return Walk(0);
    }

    /// <summary>The smallest mount that runs the hands forward (null when the board has none).</summary>
    public static Dictionary<string, string>? Solve(Board board) =>
        AllMounts(board).Where(mount => Run(board, mount) == Outcome.Forward)
            .OrderBy(mount => mount.Count)
            .ThenBy(mount => string.Join(",", mount.OrderBy(pair => pair.Key).Select(pair => pair.Key + pair.Value)), StringComparer.Ordinal)
            .FirstOrDefault();

    /// <summary>Peg ids of the driven chain from the crank to the hand gear.</summary>
    public static List<string> Route(Board board, IReadOnlyDictionary<string, string> mount)
    {
        var gears = board.Tray.ToDictionary(gear => gear.Id);
        var pegs = board.Pegs.ToDictionary(peg => peg.Id);
        if (mount.Keys.Any(peg => !pegs.ContainsKey(peg)) || mount.Values.Any(gear => !gears.ContainsKey(gear))) return new List<string>();
        var nodes = new List<(string Id, string Peg, double X, double Y, int Teeth)> { ("drv", "", board.DriveX, board.DriveY, board.DriveTeeth), ("out", "", board.OutX, board.OutY, board.OutTeeth) };
        nodes.AddRange(mount.Select(pair => (pair.Value, pair.Key, pegs[pair.Key].X, pegs[pair.Key].Y, gears[pair.Value].Teeth)));
        var parent = new Dictionary<string, string?> { ["drv"] = null };
        var queue = new Queue<string>();
        queue.Enqueue("drv");
        while (queue.Count > 0)
        {
            var u = nodes.First(node => node.Id == queue.Peek());
            queue.Dequeue();
            foreach (var v in nodes)
            {
                if (parent.ContainsKey(v.Id)) continue;
                var distance = Math.Sqrt((u.X - v.X) * (u.X - v.X) + (u.Y - v.Y) * (u.Y - v.Y));
                if (Math.Abs(distance - Radius(board, u.Teeth) - Radius(board, v.Teeth)) > board.Tolerance) continue;
                parent[v.Id] = u.Id;
                queue.Enqueue(v.Id);
            }
        }
        var route = new List<string>();
        if (!parent.ContainsKey("out")) return route;
        for (var at = parent["out"]; at is not null && at != "drv"; at = parent[at])
            route.Insert(0, nodes.First(node => node.Id == at).Peg);
        return route;
    }

    public static Board Read(JsonObject p)
    {
        (double X, double Y, int Teeth) End(string key, double x, double y, int teeth) =>
            p[key] is JsonObject end
                ? (PuzzleJson.Number(end, "x", x), PuzzleJson.Number(end, "y", y), PuzzleJson.Int(end, "teeth", teeth))
                : (x, y, teeth);
        var drive = End("drive", DriveX, DriveY, DriveTeeth);
        var output = End("output", OutX, OutY, OutTeeth);
        var pegs = (p["pegs"] as JsonArray ?? throw new InvalidOperationException("Missing pegs."))
            .Select(node => node as JsonObject ?? throw new FormatException("A peg is { id, x, y }."))
            .Select(peg => new Peg(PuzzleJson.Text(peg, "id"), PuzzleJson.Number(peg, "x", double.NaN), PuzzleJson.Number(peg, "y", double.NaN)))
            .ToList();
        if (pegs.Any(peg => peg.Id.Length == 0 || double.IsNaN(peg.X) || double.IsNaN(peg.Y))) throw new FormatException("A peg is { id, x, y }.");
        var tray = (p["tray"] as JsonArray ?? throw new InvalidOperationException("Missing tray."))
            .Select(node => node as JsonObject ?? throw new FormatException("A tray gear is { id, teeth, bent }."))
            .Select(gear => new Gear(PuzzleJson.Text(gear, "id"), PuzzleJson.Int(gear, "teeth", 0),
                gear["bent"] is JsonValue bent && bent.TryGetValue<bool>(out var isBent) && isBent))
            .ToList();
        if (tray.Any(gear => gear.Id.Length == 0 || gear.Teeth <= 0)) throw new FormatException("A tray gear is { id, teeth, bent }.");
        return new Board(drive.X, drive.Y, drive.Teeth, output.X, output.Y, output.Teeth,
            PuzzleJson.Number(p, "module", Module), PuzzleJson.Number(p, "tolerance", Tolerance), PuzzleJson.Number(p, "clearance", Clearance), pegs, tray);
    }

    private static Dictionary<string, string>? ReadMount(JsonObject solution) =>
        solution["mount"] is JsonObject mount && mount.All(pair => pair.Value is JsonValue value && value.TryGetValue<string>(out _))
            ? mount.ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>())
            : null;

    private static Dictionary<string, string>? ReadMount(JsonElement answer)
    {
        if (answer.ValueKind != JsonValueKind.Object || !answer.TryGetProperty("mount", out var mount) || mount.ValueKind != JsonValueKind.Object) return null;
        var result = new Dictionary<string, string>();
        foreach (var property in mount.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.Null) continue;
            if (property.Value.ValueKind != JsonValueKind.String || result.Count >= 12) return null;
            result[property.Name] = property.Value.GetString()!;
        }
        return result;
    }
}
