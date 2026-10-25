using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P2 · Ghép mảnh giấy. A sheet torn into 4–5 pieces lies scattered (some upside down); drag each piece
/// into the frame, turn it upright, and it snaps. The tear lines are drawn on the client from
/// <c>tearSeed</c>, so the server never needs the geometry: every piece is cut from the same sheet, so
/// a correctly placed piece has its sheet origin on the frame origin and is not turned.
///
/// params (public): { pieceCount, tearSeed, flipped:[ids], partnerPiece:id|0,
///                    doc:{head,sub,meta,to,lines[],sign,stamp[]}, note:{text,mark}, find:{title,text,tag} }
/// solution (secret): { hints:[…] }
/// probe: { handoff:true } — the partner hands over the piece they hold (only when partnerPiece ≠ 0);
///        the run remembers it, so both players see the piece on the table.
/// answer: { placed:[{id,x,y,r}…] } — x/y = where the piece's sheet origin lies relative to the frame
///         origin (logical px), r = rotation in degrees. Solved when every piece is within tolerance
///         and upright.
/// Simplification vs the mockup: the partner piece is not a server inventory item; any player can ask
/// for it and the hand-off is a shared run flag (see <see cref="HandoffKey"/>).
/// </summary>
public sealed class TornPaperKind : IPuzzleKind
{
    public string Kind => "torn_paper";

    public const string HandoffKey = "handoff";
    public const double Tolerance = 10;

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        var (pieces, flips, partner) = definition.Difficulty switch
        {
            PuzzleDifficulties.Hard => (5, 2, true),
            PuzzleDifficulties.Normal => (5, 1, true),
            _ => (4, 1, false)
        };
        if (!PuzzleJson.Has(p, "pieceCount")) p["pieceCount"] = pieces;
        var count = Math.Clamp(PuzzleJson.Int(p, "pieceCount", pieces), 4, 5);
        if (!PuzzleJson.Has(p, "tearSeed")) p["tearSeed"] = rng.Next(1, 1_000_000);
        if (!PuzzleJson.Has(p, "partnerPiece"))
            p["partnerPiece"] = partner && count == 5 ? rng.Next(1, count + 1) : 0;
        var partnerPiece = PuzzleJson.Int(p, "partnerPiece", 0);
        if (!PuzzleJson.Has(p, "flipped"))
        {
            var candidates = PuzzleJson.Shuffled(rng, Enumerable.Range(1, count).Where(id => id != partnerPiece));
            p["flipped"] = PuzzleJson.IntArray(candidates.Take(flips).OrderBy(id => id));
        }
        if (!PuzzleJson.Has(p, "doc"))
        {
            p["doc"] = new JsonObject
            {
                ["head"] = "GHI CHÚ",
                ["sub"] = "GIẤY VIẾT THƯ",
                ["meta"] = "SỐ 0731 · 19:40",
                ["to"] = "GỬI: NGƯỜI NHẬN",
                ["lines"] = new JsonArray("HẸN GẶP Ở BẾN SỐ 3", "ĐÚNG 23 GIỜ · ĐỪNG MANG ĐÈN"),
                ["sign"] = "KÝ: H."
            };
        }
        if (!PuzzleJson.Has(definition.Solution, "hints"))
        {
            definition.Solution["hints"] = new JsonArray(
                "Mép thẳng của tờ giấy luôn nằm sát viền khung.",
                "Mảnh có dòng tiêu đề nằm ở góc trên bên trái.");
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        var p = definition.Params;
        var count = PuzzleJson.Int(p, "pieceCount", 0);
        if (count is < 4 or > 5) { error("params.pieceCount", "pieceCount must be 4 or 5."); return; }
        if (PuzzleJson.Int(p, "tearSeed", 0) <= 0) error("params.tearSeed", "tearSeed must be a positive integer.");
        var partner = PuzzleJson.Int(p, "partnerPiece", 0);
        if (partner < 0 || partner > count) error("params.partnerPiece", "partnerPiece must be 0 (none) or a piece id.");
        var flipped = PuzzleJson.Ints(p, "flipped");
        if (flipped.Any(id => id < 1 || id > count) || flipped.Distinct().Count() != flipped.Count)
            error("params.flipped", "flipped must list distinct piece ids.");
        if (flipped.Count >= count) error("params.flipped", "At least one piece must start upright.");
        if (p["doc"] is not JsonObject doc || doc["lines"] is not JsonArray lines || lines.Count is < 1 or > 3)
            error("params.doc", "doc.lines must hold 1–3 typed lines.");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var count = PuzzleJson.Int(definition.Params, "pieceCount", 0);
        var placed = ReadPlaced(answer);
        if (placed is null)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Không đọc được vị trí các mảnh.", false);
        var partner = PuzzleJson.Int(definition.Params, "partnerPiece", 0);
        if (partner > 0 && !HandedOff(run) && placed.Any(piece => piece.Id == partner))
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "partner" }, "Mảnh của đồng đội chưa được gửi sang.");
        var good = placed
            .Where(piece => piece.Id >= 1 && piece.Id <= count)
            .GroupBy(piece => piece.Id)
            .Count(group => group.Count() == 1 && Fits(group.First()));
        if (good == count && placed.Count == count)
            return new PuzzleVerdict(true, new JsonObject { ["placed"] = count });
        return new PuzzleVerdict(false, new JsonObject { ["reason"] = "placement", ["placed"] = good },
            "Tờ giấy chưa liền — còn mảnh lệch hoặc bị ngược.");
    }

    public PuzzleVerdict? Probe(PuzzleKindContext definition, JsonElement input, PuzzleRunState run)
    {
        var partner = PuzzleJson.Int(definition.Params, "partnerPiece", 0);
        var wantsHandoff = input.ValueKind == JsonValueKind.Object && input.TryGetProperty("handoff", out var flag)
            && flag.ValueKind == JsonValueKind.True;
        if (!wantsHandoff || partner == 0)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Không có mảnh nào để nhận.", false);
        run.Data[HandoffKey] = "1";
        return new PuzzleVerdict(false, new JsonObject { ["handedOff"] = true, ["piece"] = partner }, null, false);
    }

    public JsonObject? RunView(PuzzleKindContext definition, PuzzleRunState run) =>
        PuzzleJson.Int(definition.Params, "partnerPiece", 0) > 0 ? new JsonObject { ["handedOff"] = HandedOff(run) } : null;

    public static bool HandedOff(PuzzleRunState? run) =>
        run is not null && run.Data.TryGetValue(HandoffKey, out var value) && value == "1";

    private readonly record struct Placement(int Id, double X, double Y, double R);

    private static bool Fits(Placement piece)
    {
        var turn = ((piece.R % 360) + 360) % 360;
        return Math.Abs(piece.X) <= Tolerance && Math.Abs(piece.Y) <= Tolerance && (turn <= 2 || turn >= 358);
    }

    private static List<Placement>? ReadPlaced(JsonElement answer)
    {
        if (answer.ValueKind != JsonValueKind.Object || !answer.TryGetProperty("placed", out var array) || array.ValueKind != JsonValueKind.Array)
            return null;
        var list = new List<Placement>();
        foreach (var item in array.EnumerateArray())
        {
            if (list.Count >= 12 || item.ValueKind != JsonValueKind.Object) return null;
            if (!Number(item, "id", out var id) || !Number(item, "x", out var x) || !Number(item, "y", out var y) || !Number(item, "r", out var r))
                return null;
            if (id != Math.Floor(id) || double.IsNaN(x) || double.IsNaN(y) || double.IsNaN(r)) return null;
            list.Add(new Placement((int)id, x, y, r));
        }
        return list;
    }

    private static bool Number(JsonElement item, string key, out double value)
    {
        value = 0;
        return item.TryGetProperty(key, out var element) && element.ValueKind == JsonValueKind.Number && element.TryGetDouble(out value)
            && !double.IsInfinity(value) && Math.Abs(value) < 100_000;
    }
}
