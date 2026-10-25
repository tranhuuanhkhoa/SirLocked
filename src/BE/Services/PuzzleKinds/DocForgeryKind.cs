using System.Text.Json;
using System.Text.Json.Nodes;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.PuzzleKinds;

/// <summary>
/// P4 · Soi tài liệu bị sửa. A document is examined under a 2× lens with three lamps. Each altered field
/// leaves a trace that only one lamp shows: scrubbed paper and the old writing pressed into it
/// ("erase") or the old digits pressed in under new ones ("overwrite") show under raking light, ink added
/// later ("ink") glows differently under UV. The paper's middle fold is a decoy. Marking a field only
/// works with the lamp that shows its trace; when every altered field is marked the document is put next
/// to the reference copy and the answer is sent.
///
/// The traces are drawn by the client, so they are part of the public params — exactly what the player
/// sees through the lens. The server keeps the answer set and checks it.
///
/// params (public): { doc:{label,title,sub}, ref:{label,title,sub}, fields:[{id,label,value,ref,trace?,light?,ghost?}],
///                    signers:[{label,name}], seal:{ring,top,bottom}, need, … authored card texts }
/// solution (secret): { marks:{fieldId:"rake"|"uv"}, hints:[…] }
/// answer: { marks:{fieldId:"rake"|"uv"} } — must equal the solution (same fields, same lamps).
/// </summary>
public sealed class DocForgeryKind : IPuzzleKind
{
    public string Kind => "doc_forgery";
    public const int MaxFields = 6;
    public static readonly string[] Traces = { "erase", "overwrite", "ink" };

    public static string LightOf(string trace) => trace == "ink" ? "uv" : "rake";

    public void Generate(PuzzleKindContext definition, Random rng)
    {
        var p = definition.Params;
        if (!PuzzleJson.Has(p, "fields")) DefaultDocument(p, rng, definition.Difficulty);
        if (!PuzzleJson.Has(p, "doc")) p["doc"] = new JsonObject { ["label"] = "BIÊN NHẬN TRÊN BÀN", ["title"] = "BIÊN NHẬN", ["sub"] = "GỬI GIỮ ĐỒ · SỐ 27" };
        if (!PuzzleJson.Has(p, "ref")) p["ref"] = new JsonObject { ["label"] = "BẢN LƯU ĐỐI CHIẾU", ["title"] = "BIÊN NHẬN", ["sub"] = "GỬI GIỮ ĐỒ · SỐ 27" };
        if (!PuzzleJson.Has(p, "signers"))
            p["signers"] = new JsonArray(new JsonObject { ["label"] = "Người nhận ký", ["name"] = "Chủ tiệm" }, new JsonObject { ["label"] = "Người gửi ký", ["name"] = "Khách gửi" });
        if (!PuzzleJson.Has(p, "seal")) p["seal"] = new JsonObject { ["ring"] = "ĐÃ NHẬN ĐỦ", ["top"] = "ĐÃ", ["bottom"] = "NHẬN" };

        var fields = p["fields"] as JsonArray ?? new JsonArray();
        var marks = new JsonObject();
        for (var index = 0; index < fields.Count; index++)
        {
            if (fields[index] is not JsonObject field) continue;
            if (!PuzzleJson.Has(field, "id")) field["id"] = $"f{index + 1}";
            var value = PuzzleJson.Text(field, "value");
            if (!PuzzleJson.Has(field, "ref")) field["ref"] = value;
            var original = PuzzleJson.Text(field, "ref");
            if (!PuzzleJson.Has(field, "trace") && original != value)
            {
                // Something was added where the reference has nothing → new ink. A digit change may be
                // written over (old digits pressed in) or added in another ink; any other change was erased.
                field["trace"] = original.Length == 0 ? "ink"
                    : original.Any(char.IsDigit) && value.Any(char.IsDigit) ? (rng.Next(2) == 0 ? "overwrite" : "ink")
                    : "erase";
            }
            var trace = PuzzleJson.Text(field, "trace");
            if (trace.Length == 0) continue;
            field["light"] = LightOf(trace);
            if (trace != "ink" && !PuzzleJson.Has(field, "ghost")) field["ghost"] = original;
            marks[PuzzleJson.Text(field, "id")] = LightOf(trace);
        }
        p["need"] = marks.Count;
        if (!PuzzleJson.Has(definition.Solution, "marks")) definition.Solution["marks"] = marks;
        if (!PuzzleJson.Has(definition.Solution, "hints"))
        {
            var refLabel = p["ref"] is JsonObject reference ? PuzzleJson.Text(reference, "label", "bản lưu") : "bản lưu";
            definition.Solution["hints"] = new JsonArray(
                $"So từng ô với {Lower(refLabel)}: ô nào khác bản lưu là ô đã bị sửa. Nếp gấp chỉ là nếp gấp.",
                "Chữ bị tẩy hoặc viết đè để lại xơ giấy và rãnh hằn — soi bằng đèn xiên. Chữ thêm bằng mực khác phát sáng khác dưới đèn UV.");
        }
    }

    public void Validate(PuzzleKindContext definition, Action<string, string> error)
    {
        if (definition.Params["fields"] is not JsonArray fields || fields.Count is < 2 or > MaxFields)
        {
            error("params.fields", $"Use 2–{MaxFields} fields.");
            return;
        }
        var ids = new HashSet<string>();
        var height = 0;
        for (var index = 0; index < fields.Count; index++)
        {
            if (fields[index] is not JsonObject field) { error($"params.fields[{index}]", "A field is an object."); continue; }
            var id = PuzzleJson.Text(field, "id");
            if (id.Length == 0 || id == "fold" || !ids.Add(id)) error($"params.fields[{index}].id", "Field ids must be unique (and not 'fold').");
            if (PuzzleJson.Text(field, "label").Length == 0) error($"params.fields[{index}].label", "Every field needs a label.");
            var trace = PuzzleJson.Text(field, "trace");
            if (trace.Length > 0 && !Traces.Contains(trace)) error($"params.fields[{index}].trace", "trace is erase, overwrite or ink.");
            if (trace.Length > 0 && PuzzleJson.Text(field, "light") != LightOf(trace)) error($"params.fields[{index}].light", "light must match the trace.");
            if (trace.Length > 0 && PuzzleJson.Text(field, "value").Length == 0) error($"params.fields[{index}].value", "An altered field must have writing on it.");
            var lines = Math.Max(Lines(PuzzleJson.Text(field, "value")), Lines(PuzzleJson.Text(field, "ghost")));
            if (lines > 2) error($"params.fields[{index}]", "A field holds at most two lines.");
            height += lines >= 2 ? 80 : 48;
        }
        if (height > 290) error("params.fields", "The fields do not fit on the page (at most ~6 one-line rows).");
        var marks = Marks(definition.Solution);
        if (marks is null || marks.Count == 0) error("solution.marks", "At least one field must be altered.");
        else
        {
            var traced = fields.OfType<JsonObject>().Where(field => PuzzleJson.Text(field, "trace").Length > 0)
                .ToDictionary(field => PuzzleJson.Text(field, "id"), field => PuzzleJson.Text(field, "light"));
            if (traced.Count != marks.Count || traced.Any(pair => !marks.TryGetValue(pair.Key, out var light) || light != pair.Value))
                error("solution.marks", "The answer must list exactly the altered fields with the lamp that shows each trace.");
            if (PuzzleJson.Int(definition.Params, "need") != marks.Count) error("params.need", "need must equal the number of altered fields.");
        }
    }

    public PuzzleVerdict Check(PuzzleKindContext definition, JsonElement answer, PuzzleRunState run)
    {
        var expected = Marks(definition.Solution) ?? new Dictionary<string, string>();
        var given = ReadMarks(answer);
        if (given is null || given.Count == 0)
            return new PuzzleVerdict(false, new JsonObject { ["reason"] = "invalid" }, "Chưa khoanh chỗ nào hợp lệ.");
        var solved = given.Count == expected.Count && given.All(pair => expected.TryGetValue(pair.Key, out var light) && light == pair.Value);
        return solved
            ? new PuzzleVerdict(true, new JsonObject { ["marked"] = given.Count })
            : new PuzzleVerdict(false, new JsonObject { ["reason"] = "mismatch" }, "Những chỗ khoanh chưa khớp với dấu vết trên giấy.");
    }

    private static Dictionary<string, string>? Marks(JsonObject solution) =>
        solution["marks"] is JsonObject marks && marks.All(pair => pair.Value is JsonValue value && value.TryGetValue<string>(out _))
            ? marks.ToDictionary(pair => pair.Key, pair => pair.Value!.GetValue<string>())
            : null;

    private static Dictionary<string, string>? ReadMarks(JsonElement answer)
    {
        if (answer.ValueKind != JsonValueKind.Object || !answer.TryGetProperty("marks", out var marks) || marks.ValueKind != JsonValueKind.Object) return null;
        var result = new Dictionary<string, string>();
        foreach (var property in marks.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.String || result.Count >= MaxFields + 1) return null;
            var light = property.Value.GetString();
            if (light is not ("rake" or "uv")) return null;
            result[property.Name] = light;
        }
        return result;
    }

    private static int Lines(string text) => text.Length == 0 ? 0 : text.Split('\n').Length;

    private static string Lower(string text) => text.Length == 0 ? text : text.ToLowerInvariant();

    // ----- neutral default document (used when a case gives no content) -----

    private static readonly string[] People = { "Nguyễn Văn Tâm", "Trần Thị Mai", "Lê Quang Huy", "Phạm Thị Lan", "Võ Minh Đức", "Hoàng Thị Thu" };
    private static readonly string[] Items = { "Đồng hồ quả quýt bạc", "Vòng ngọc bích", "Hộp trầm hương", "Nhẫn vàng mặt đá", "Bộ ấm trà men lam" };
    private static readonly (string Original, string Over)[] Amounts = { ("300 đồng", "800 đồng"), ("120 đồng", "720 đồng"), ("250 đồng", "850 đồng"), ("450 đồng", "950 đồng"), ("600 đồng", "900 đồng") };
    private static readonly (string Original, string Over)[] Dates = { ("ngày 5/10", "ngày 8/10"), ("ngày 3/11", "ngày 8/11"), ("ngày 1/9", "ngày 7/9"), ("ngày 6/12", "ngày 9/12") };
    private static readonly string[] Notes = { "Kể cả hộp đựng bằng gỗ", "Đã nhận đủ tiền đặt cọc", "Khách được chuộc trước hạn", "Người nhận chịu mọi hư hỏng" };

    private static void DefaultDocument(JsonObject p, Random rng, string difficulty)
    {
        T Pick<T>(IReadOnlyList<T> list) => list[rng.Next(list.Count)];
        var person = Pick(People);
        var otherPerson = Pick(People.Where(name => name != person).ToList());
        var item = Pick(Items);
        var amount = Pick(Amounts);
        var date = Pick(Dates);
        var note = Pick(Notes);
        var count = difficulty == PuzzleDifficulties.Hard ? 4 : difficulty == PuzzleDifficulties.Normal ? 3 : 2;
        // One alteration always needs the UV lamp, the rest the raking light.
        var rakeChoices = PuzzleJson.Shuffled(rng, new[] { 0, 1, 2 }).Take(count - 1).ToHashSet(); // 0 name · 1 amount · 2 date
        var uvOnAmount = !rakeChoices.Contains(1) && rng.Next(3) == 0;
        var fields = new JsonArray
        {
            Field("Người gửi:", rakeChoices.Contains(0) ? person : otherPerson, otherPerson, rakeChoices.Contains(0) ? "erase" : null),
            Field("Món gửi:", item, item, null),
            uvOnAmount
                ? Field("Giá trị:", TenTimes(amount.Original), amount.Original, "ink")
                : Field("Giá trị:", rakeChoices.Contains(1) ? amount.Over : amount.Original, amount.Original, rakeChoices.Contains(1) ? "overwrite" : null),
            Field("Ngày nhận:", rakeChoices.Contains(2) ? date.Over : date.Original, date.Original, rakeChoices.Contains(2) ? "overwrite" : null),
            uvOnAmount ? Field("Ghi chú:", "", "", null) : Field("Ghi chú:", note, "", "ink"),
        };
        p["fields"] = fields;
    }

    /// <summary>"300 đồng" → "3.000 đồng": a zero added in another ink.</summary>
    private static string TenTimes(string amount)
    {
        var digits = new string(amount.TakeWhile(char.IsDigit).ToArray());
        if (!int.TryParse(digits, out var value)) return amount;
        var grouped = (value * 10).ToString("#,0", System.Globalization.CultureInfo.InvariantCulture).Replace(',', '.');
        return grouped + amount[digits.Length..];
    }

    private static JsonObject Field(string label, string value, string original, string? trace)
    {
        var field = new JsonObject { ["label"] = label, ["value"] = value, ["ref"] = original };
        if (trace is not null) field["trace"] = trace;
        return field;
    }
}
