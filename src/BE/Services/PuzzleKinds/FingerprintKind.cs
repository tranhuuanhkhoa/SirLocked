using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P3 · Dấu vân tay. Brush powder over the surface until the latent print is clear enough, lift it with
/// tape, then compare it with one of the reference cards. The comparison draws the minutiae lines one by
/// one; a wrong card breaks at the scar crossing (line <see cref="BreakAt"/>).
///
/// params (public): { cards:[{id,mono,name,role,no,pattern,scar}], print:{pattern,x,y,rot}, threshold,
///                    smudge:{x,y,rot}, plate, edge, surface, place, note?:{title,text}, testimony?:{mono,text} }
/// solution (secret): { card:id, hints:[…] }
/// answer: { card:id } → feedback { match:true, points:9 } or { match:false, breakAt:3 }.
/// Powder coverage is client-only (it is drawn and measured in the browser).
/// </summary>
public sealed class FingerprintKind : IPuzzleKind
{
    public string Kind => "fingerprint";

    public const int Points = 9;
    public const int BreakAt = 3;
    public static readonly string[] Patterns = { "loop", "whorl", "arch" };

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        var s = definition.Solution;
        if (p["cards"] is not JsonArray cards || cards.Count == 0)
        {
            cards = new JsonArray(
                Card("a", "NA", "Người A", "Nhân chứng"),
                Card("b", "NB", "Người B", "Người làm"),
                Card("c", "NC", "Người C", "Khách quen"));
            p["cards"] = cards;
        }
        var ids = cards.OfType<JsonObject>().Select(card => PuzzleJson.Text(card, "id")).Where(id => id.Length > 0).ToList();
        if (!PuzzleJson.Has(s, "card") && ids.Count > 0) s["card"] = ids[rng.Next(ids.Count)];
        var correct = PuzzleJson.Text(s, "card");

        // The lifted print: pattern, and where it sits near the front edge of the surface. The loop drawing is
        // the one with the scar and the nine charted minutiae, so it is the default culprit pattern.
        if (p["print"] is not JsonObject print) { print = new JsonObject(); p["print"] = print; }
        if (!PuzzleJson.Has(print, "pattern")) print["pattern"] = "loop";
        if (!PuzzleJson.Has(print, "x")) print["x"] = rng.Next(250, 391);
        if (!PuzzleJson.Has(print, "y")) print["y"] = rng.Next(266, 297);
        if (!PuzzleJson.Has(print, "rot")) print["rot"] = rng.Next(-24, 9);
        var pattern = PuzzleJson.Text(print, "pattern", "loop");

        // Reference cards: the right one carries the same pattern and the scar. On EASY every wrong card has
        // another pattern; from NORMAL on one decoy shares the pattern and only the scar tells them apart.
        var others = Patterns.Where(name => name != pattern).ToList();
        var decoyShares = definition.Difficulty != PuzzleDifficulties.Easy;
        var offset = rng.Next(others.Count);
        var wrongIndex = 0;
        foreach (var card in cards.OfType<JsonObject>())
        {
            var isRight = PuzzleJson.Text(card, "id") == correct;
            if (!PuzzleJson.Has(card, "pattern"))
            {
                card["pattern"] = isRight ? pattern
                    : decoyShares && wrongIndex == 0 ? pattern
                    : others[(wrongIndex + offset) % others.Count];
            }
            if (!PuzzleJson.Has(card, "scar")) card["scar"] = isRight;
            if (!isRight) wrongIndex++;
        }
        var number = 1;
        foreach (var card in cards.OfType<JsonObject>())
        {
            if (!PuzzleJson.Has(card, "no")) card["no"] = $"Nº {number:00} · NGÓN CÁI PHẢI";
            number++;
        }

        if (!PuzzleJson.Has(p, "threshold"))
            p["threshold"] = definition.Difficulty switch { PuzzleDifficulties.Hard => 0.75, PuzzleDifficulties.Normal => 0.7, _ => 0.6 };
        if (p["smudge"] is not JsonObject)
            p["smudge"] = new JsonObject { ["x"] = rng.Next(120, 181), ["y"] = rng.Next(140, 196), ["rot"] = rng.Next(10, 40) };
        if (!PuzzleJson.Has(p, "plate")) p["plate"] = "HỘP KIM LOẠI";
        if (!PuzzleJson.Has(p, "edge")) p["edge"] = "MÉP TRƯỚC";
        if (!PuzzleJson.Has(p, "surface")) p["surface"] = "Mặt kim loại";
        if (!PuzzleJson.Has(p, "place")) p["place"] = "Mép trước";
        if (!PuzzleJson.Has(s, "hints"))
            s["hints"] = new JsonArray("Người ta thường cầm mép trước để mở.", "Tìm vết sẹo cắt chéo các đường vân.");
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        var p = definition.Params;
        if (p["cards"] is not JsonArray cards || cards.Count is < 2 or > 4)
        {
            error("params.cards", "List 2–4 reference cards.");
            return;
        }
        var list = cards.OfType<JsonObject>().ToList();
        var ids = list.Select(card => PuzzleJson.Text(card, "id")).ToList();
        if (ids.Any(id => id.Length == 0) || ids.Distinct().Count() != ids.Count) error("params.cards", "Every card needs a unique id.");
        if (list.Any(card => PuzzleJson.Text(card, "name").Length == 0)) error("params.cards", "Every card needs a name.");
        if (list.Any(card => !Patterns.Contains(PuzzleJson.Text(card, "pattern")))) error("params.cards", "pattern must be loop, whorl or arch.");
        var print = p["print"] as JsonObject;
        var pattern = print is null ? string.Empty : PuzzleJson.Text(print, "pattern");
        if (!Patterns.Contains(pattern)) error("params.print.pattern", "pattern must be loop, whorl or arch.");
        var correct = PuzzleJson.Text(definition.Solution, "card");
        if (!ids.Contains(correct)) { error("solution.card", "card must be the id of one reference card."); return; }
        var matching = list.Where(card => PuzzleJson.Text(card, "pattern") == pattern && IsTrue(card, "scar")).ToList();
        if (matching.Count != 1 || PuzzleJson.Text(matching[0], "id") != correct)
            error("params.cards", "Exactly one card — the solution card — must show the print's pattern and the scar.");
        var threshold = PuzzleJson.Number(p, "threshold", 0);
        if (threshold is < 0.3 or > 0.9) error("params.threshold", "threshold must be 0.3–0.9.");
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var card = PuzzleJson.Text(answer, "card")?.Trim() ?? string.Empty;
        var ids = (definition.Params["cards"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
            .Select(item => PuzzleJson.Text(item, "id")).ToList();
        if (card.Length == 0 || !ids.Contains(card))
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Chưa chọn thẻ vân tay mẫu.", false);
        if (card == PuzzleJson.Text(definition.Solution, "card"))
            return new PuzzleVerdict(true, new JsonObject { ["match"] = true, ["points"] = Points });
        return new PuzzleVerdict(false, new JsonObject { ["match"] = false, ["breakAt"] = BreakAt },
            "Không khớp — chọn thẻ khác.");
    }

    private static JsonObject Card(string id, string mono, string name, string role) =>
        new() { ["id"] = id, ["mono"] = mono, ["name"] = name, ["role"] = role };

    private static bool IsTrue(JsonObject obj, string key) =>
        obj.TryGetPropertyValue(key, out var node) && node is JsonValue value && value.TryGetValue<bool>(out var flag) && flag;
}
