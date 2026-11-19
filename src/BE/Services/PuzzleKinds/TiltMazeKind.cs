using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P9 · Hộp mê cung nghiêng. An ice-slide maze: each tilt rolls the ball until a wall, the rim or the
/// closed gate. Holes send it back to the start and close the gate again, the lever toggles the gate
/// every time the ball rolls over it, and the socket catches the ball (win).
///
/// params (public): { size, start:[r,c], socket:[r,c], lever:[r,c], holes:[[r,c]...],
///                    gate:[r1,c1,r2,c2], walls:[[r1,c1,r2,c2]...], optimal:n }
/// solution (secret): { moves:"URUL…", hints:[…] }
/// answer: { moves:"URUL…" } — the server replays it from the start.
/// </summary>
public sealed class TiltMazeKind : IPuzzleKind
{
    public string Kind => "tilt_maze";
    public const int MaxMoves = 60;
    private static readonly (char Key, int Dr, int Dc)[] Directions = { ('U', -1, 0), ('D', 1, 0), ('L', 0, -1), ('R', 0, 1) };

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        if (!PuzzleJson.Has(p, "walls"))
        {
            var (min, max, size) = definition.Difficulty switch
            {
                PuzzleDifficulties.Hard => (9, 12, 7),
                PuzzleDifficulties.Normal => (7, 9, 7),
                _ => (5, 7, 6)
            };
            Level? level = null;
            for (var attempt = 0; attempt < 4000 && level is null; attempt++)
            {
                var candidate = RandomLevel(rng, size);
                var solution = Solve(candidate);
                if (solution is not null && solution.Length >= min && solution.Length <= max) level = candidate with { };
            }
            level ??= MockupLevel();
            Write(p, level);
        }
        var parsed = Read(p);
        var moves = Solve(parsed) ?? string.Empty;
        p["optimal"] = moves.Length;
        if (!PuzzleJson.Has(definition.Solution, "moves")) definition.Solution["moves"] = moves;
        if (!PuzzleJson.Has(definition.Solution, "hints"))
        {
            var first = moves.Length >= 3 ? moves[..3] : moves;
            definition.Solution["hints"] = new JsonArray(
                "Cửa chắn chỉ mở khi bi lăn qua cần gạt đồng — và đóng lại nếu bi lăn qua lần nữa.",
                $"Thử bắt đầu bằng {first.Length} lần nghiêng: {string.Join(" → ", first.Select(Word))}.");
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        Level level;
        try { level = Read(definition.Params); }
        catch (Exception exception) when (exception is InvalidOperationException or FormatException)
        {
            error("params", exception.Message);
            return;
        }
        if (level.Size is < 4 or > 9) error("params.size", "size must be 4–9.");
        bool Inside((int R, int C) cell) => cell.R >= 0 && cell.C >= 0 && cell.R < level.Size && cell.C < level.Size;
        foreach (var (name, cell) in new[] { ("start", level.Start), ("socket", level.Socket), ("lever", level.Lever) })
            if (!Inside(cell)) error($"params.{name}", $"{name} is outside the board.");
        if (level.Holes.Any(hole => !Inside(hole) || hole == level.Start || hole == level.Socket || hole == level.Lever))
            error("params.holes", "Holes must be on the board and not on the start, socket or lever.");
        if (level.Walls.Concat(new[] { level.Gate }).Any(edge => !Adjacent(edge)))
            error("params.walls", "Walls and the gate must join two orthogonally adjacent cells.");
        var solution = Solve(level);
        if (solution is null) error("params", "The maze has no solution.");
        else if (solution.Length > 20) error("params", "The shortest solution is longer than 20 tilts.");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var moves = PuzzleJson.Text(answer, "moves")?.Trim().ToUpperInvariant() ?? string.Empty;
        if (moves.Length == 0 || moves.Length > MaxMoves || moves.Any(ch => "UDLR".IndexOf(ch) < 0))
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Chuỗi nghiêng không hợp lệ.");
        var level = Read(definition.Params);
        var (r, c, gate) = (level.Start.R, level.Start.C, false);
        var falls = 0;
        foreach (var move in moves)
        {
            var result = Slide(level, r, c, gate, move);
            if (result.Kind == SlideKind.Win)
                return new PuzzleVerdict(true, new JsonObject { ["tilts"] = moves.Length, ["falls"] = falls });
            if (result.Kind == SlideKind.Hole) { (r, c, gate) = (level.Start.R, level.Start.C, false); falls++; }
            else (r, c, gate) = (result.R, result.C, result.Gate);
        }
        return new PuzzleVerdict(false, new JsonObject { ["r"] = r, ["c"] = c, ["gate"] = gate, ["falls"] = falls },
            "Bi chưa vào ổ.");
    }

    // ----- rules (same as PuzzleTiltMaze.dc.html slide()) -----

    public sealed record Level(int Size, (int R, int C) Start, (int R, int C) Socket, (int R, int C) Lever,
        List<(int R, int C)> Holes, (int R1, int C1, int R2, int C2) Gate, List<(int R1, int C1, int R2, int C2)> Walls);

    public enum SlideKind { Stop, Hole, Win }
    public readonly record struct SlideResult(SlideKind Kind, int R, int C, bool Gate);

    public static SlideResult Slide(Level level, int r, int c, bool gate, char direction)
    {
        var (_, dr, dc) = Directions.First(d => d.Key == direction);
        var walls = level.Walls.Select(Key).ToHashSet();
        var gateKey = Key(level.Gate);
        for (var steps = 0; steps < level.Size * level.Size * 4; steps++)
        {
            var (r2, c2) = (r + dr, c + dc);
            if (r2 < 0 || c2 < 0 || r2 >= level.Size || c2 >= level.Size) return new(SlideKind.Stop, r, c, gate);
            var key = Key((r, c, r2, c2));
            if (walls.Contains(key) || (key == gateKey && !gate)) return new(SlideKind.Stop, r, c, gate);
            (r, c) = (r2, c2);
            if (level.Holes.Contains((r, c))) return new(SlideKind.Hole, r, c, gate);
            if ((r, c) == level.Socket) return new(SlideKind.Win, r, c, gate);
            if ((r, c) == level.Lever) gate = !gate;
        }
        return new(SlideKind.Stop, r, c, gate);
    }

    /// <summary>Breadth-first search over (cell, gate); returns the shortest tilt string or null.</summary>
    public static string? Solve(Level level)
    {
        var start = (level.Start.R, level.Start.C, false);
        var seen = new Dictionary<(int, int, bool), string> { [start] = string.Empty };
        var queue = new Queue<(int R, int C, bool Gate)>();
        queue.Enqueue(start);
        while (queue.Count > 0)
        {
            var (r, c, gate) = queue.Dequeue();
            var path = seen[(r, c, gate)];
            if (path.Length > 30) continue;
            foreach (var (key, _, _) in Directions)
            {
                var result = Slide(level, r, c, gate, key);
                if (result.Kind == SlideKind.Win) return path + key;
                var next = result.Kind == SlideKind.Hole ? (level.Start.R, level.Start.C, false) : (result.R, result.C, result.Gate);
                if (seen.ContainsKey(next)) continue;
                seen[next] = path + key;
                queue.Enqueue(next);
            }
        }
        return null;
    }

    private static Level RandomLevel(Random rng, int size)
    {
        (int, int) Cell() => (rng.Next(size), rng.Next(size));
        var socket = (rng.Next(1, size - 1), rng.Next(1, size - 1));
        // Close three sides of the socket; the fourth side is the gate.
        var sides = PuzzleJson.Shuffled(rng, new[] { 0, 1, 2, 3 });
        var neighbours = new[] { (-1, 0), (1, 0), (0, -1), (0, 1) };
        var walls = new List<(int, int, int, int)>();
        (int, int, int, int) gate = default;
        for (var i = 0; i < 4; i++)
        {
            var (dr, dc) = neighbours[sides[i]];
            var edge = (socket.Item1, socket.Item2, socket.Item1 + dr, socket.Item2 + dc);
            if (i == 0) gate = edge; else walls.Add(edge);
        }
        var start = Cell();
        while (start == socket) start = Cell();
        var lever = Cell();
        while (lever == socket || lever == start) lever = Cell();
        var holes = new List<(int, int)>();
        var holeCount = size >= 7 ? 3 : 2;
        while (holes.Count < holeCount)
        {
            var hole = Cell();
            if (hole != socket && hole != start && hole != lever && !holes.Contains(hole)) holes.Add(hole);
        }
        var wallCount = size * 2;
        while (walls.Count < wallCount + 3)
        {
            var (r, c) = Cell();
            var (dr, dc) = neighbours[rng.Next(4)];
            var edge = (r, c, r + dr, c + dc);
            if (edge.Item3 < 0 || edge.Item4 < 0 || edge.Item3 >= size || edge.Item4 >= size) continue;
            if (Key(edge) == Key(gate) || walls.Any(wall => Key(wall) == Key(edge))) continue;
            walls.Add(edge);
        }
        return new Level(size, start, socket, lever, holes, gate, walls);
    }

    private static Level MockupLevel() => new(7, (6, 0), (3, 3), (1, 1), new() { (3, 5), (4, 2), (6, 4) }, (3, 3, 4, 3), new()
    {
        (0, 5, 1, 5), (1, 4, 1, 5), (1, 4, 2, 4), (1, 5, 2, 5), (2, 0, 2, 1), (2, 2, 2, 3), (2, 2, 3, 2), (2, 3, 3, 3), (2, 6, 3, 6),
        (3, 2, 3, 3), (3, 3, 3, 4), (4, 1, 4, 2), (4, 0, 5, 0), (4, 5, 5, 5), (5, 1, 5, 2), (5, 4, 5, 5), (6, 3, 6, 4)
    });

    private static void Write(JsonObject p, Level level)
    {
        JsonArray Cell((int R, int C) cell) => PuzzleJson.IntArray(new[] { cell.R, cell.C });
        JsonArray Edge((int R1, int C1, int R2, int C2) edge) => PuzzleJson.IntArray(new[] { edge.R1, edge.C1, edge.R2, edge.C2 });
        p["size"] = level.Size;
        p["start"] = Cell(level.Start);
        p["socket"] = Cell(level.Socket);
        p["lever"] = Cell(level.Lever);
        p["holes"] = new JsonArray(level.Holes.Select(hole => (JsonNode?)Cell(hole)).ToArray());
        p["gate"] = Edge(level.Gate);
        p["walls"] = new JsonArray(level.Walls.Select(wall => (JsonNode?)Edge(wall)).ToArray());
    }

    public static Level Read(JsonObject p)
    {
        (int, int) Cell(JsonNode? node)
        {
            var values = node?.AsArray().Select(item => item!.GetValue<int>()).ToArray() ?? throw new InvalidOperationException("Missing cell.");
            if (values.Length != 2) throw new FormatException("A cell is [row, column].");
            return (values[0], values[1]);
        }
        (int, int, int, int) Edge(JsonNode? node)
        {
            var values = node?.AsArray().Select(item => item!.GetValue<int>()).ToArray() ?? throw new InvalidOperationException("Missing edge.");
            if (values.Length != 4) throw new FormatException("An edge is [row1, column1, row2, column2].");
            return (values[0], values[1], values[2], values[3]);
        }
        return new Level(
            PuzzleJson.Int(p, "size", 7),
            Cell(p["start"]), Cell(p["socket"]), Cell(p["lever"]),
            (p["holes"] as JsonArray ?? new JsonArray()).Select(Cell).ToList(),
            Edge(p["gate"]),
            (p["walls"] as JsonArray ?? new JsonArray()).Select(Edge).ToList());
    }

    private static bool Adjacent((int R1, int C1, int R2, int C2) edge) =>
        Math.Abs(edge.R1 - edge.R2) + Math.Abs(edge.C1 - edge.C2) == 1;

    private static string Key((int R1, int C1, int R2, int C2) edge) =>
        edge.R1 < edge.R2 || (edge.R1 == edge.R2 && edge.C1 < edge.C2)
            ? $"{edge.R1},{edge.C1}|{edge.R2},{edge.C2}"
            : $"{edge.R2},{edge.C2}|{edge.R1},{edge.C1}";

    private static string Word(char move) => move switch
    {
        'U' => "lên",
        'D' => "xuống",
        'L' => "trái",
        _ => "phải"
    };
}
