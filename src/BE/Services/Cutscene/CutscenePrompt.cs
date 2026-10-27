using System.Text.Json.Nodes;

namespace SirLocked.Api.Services.Cutscene;

/// <summary>The instructions and the strict JSON schema for the intro script.</summary>
public static class CutscenePrompt
{
    public const string SchemaName = "motion_comic_v1";

    public const string Instructions =
        "Bạn là biên kịch truyện tranh trinh thám noir. Chỉ trả về đúng một đối tượng JSON theo schema, không markdown, không lời giải thích.";

    public static string Build(string inputJson, string caseId) => $$"""
Hãy viết KỊCH BẢN MỞ ĐẦU dạng truyện tranh động cho vụ án dưới đây. Người chơi sẽ xem nó trước khi vào điều tra.

GIỌNG VĂN: noir, câu ngắn, trầm, tiếng Việt có dấu. Mở bằng thời gian và địa điểm. Gieo MỘT chi tiết lạ, chưa giải thích. Kết bằng lời mời vào cuộc, không kết luận gì. Ví dụ giọng văn (chỉ để học nhịp, không chép):
- "Bến Sương. 2 giờ 17 phút sáng."
- "Ở Bến Sương, chẳng ai gọi vào giờ này để hỏi thăm sức khỏe."
- "Hắn không trốn. Hắn đang mời tôi vào cuộc chơi."
Chữ hiệu ứng ngắn, in hoa, như "CẠCH.", "ẦM!!", "TÚT... TÚT...".

LUẬT CỨNG:
- caseId phải là "{{caseId}}", language là "vi", format là "motion-comic-v1".
- 2 đến 3 trang, tổng 5 đến 9 khung. Số khung mỗi trang theo layout: wide-top-two-bottom=3, tall-left-two-right=3, three-strips=3, splash=1, splash-inset=2.
- Mỗi khung có 1 đến 3 nhịp (beats). Nhịp caption và speech tối đa 90 ký tự, nhịp sfx tối đa 12 ký tự.
- art.id CHỈ được lấy từ các id trong dữ liệu bên dưới: kind "scene" dùng id trong scenes, "character" dùng id trong characters, "item" dùng id trong itemsWithImages, "cover" dùng id "cover" nếu có coverId. Không bịa id.
- speech phải có speakerId là id của một nhân vật có trong characters. caption và sfx để speakerId rỗng.
- focus là [x, y, w, h] tỉ lệ 0 đến 1 trong ảnh, w và h tối thiểu 0.3; chọn vùng có chủ thể.
- Tổng thời lượng khi phát phải khoảng 40 đến 75 giây: mỗi nhịp lời tốn khoảng 1.7 giây cộng 0.05 giây mỗi ký tự, mỗi sfx 1.2 giây, mỗi khung 0.9 giây, mỗi trang 1.1 giây. Nhắm khoảng 55 giây (thường 7 đến 8 khung, 2 nhịp mỗi khung).
- Không bịa nhân vật, địa điểm hay vật chứng ngoài dữ liệu. Chỉ dùng những gì người chơi thấy ngay từ đầu.
- Tuyệt đối không nói ai là hung thủ, không kết luận, không nêu động cơ hay cách gây án, không đoán. Giữ nghi vấn đồng đều giữa các nhân vật.
- audio tối đa 2 mục mỗi khung, chọn trong: thump, ring, siren, shatter, thunder, ticking. weather chọn trong: none, rain, fog, streetlight, sunrise, night. enter chọn trong: none, top, left, right, bottom. mood chọn trong: rain-night, fog-morning, warm-dusk, neon-night, clear-day, storm-night, candle-dark. sfx style chọn trong: impact, soft, glass, phone, thunder.
- title.eyebrow dạng "Hồ sơ 01"; title.title là tên vụ án; title.subtitle một câu mời vào cuộc.

DỮ LIỆU VỤ ÁN (công khai):
{{inputJson}}
""";

    public static string BuildRepair(string basePrompt, string previousJson, IEnumerable<CutsceneIssue> issues) =>
        basePrompt + "\n\nBẢN TRƯỚC (có lỗi):\n" + previousJson + "\n\nCÁC LỖI CẦN SỬA (giữ nguyên phần đúng, chỉ sửa lỗi, vẫn trả về toàn bộ JSON):\n"
        + string.Join("\n", issues.Take(20).Select(issue => $"- {issue.Path}: {issue.Message}"));

    private static JsonObject Str(int? max = null) => new() { ["type"] = "string" };

    private static JsonObject Enum(IEnumerable<string> values) => new()
    {
        ["type"] = "string",
        ["enum"] = new JsonArray(values.Select(value => (JsonNode)JsonValue.Create(value)!).ToArray())
    };

    private static JsonObject Obj(params (string Name, JsonNode Schema)[] properties)
    {
        var props = new JsonObject();
        foreach (var (name, schema) in properties) props[name] = schema;
        return new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["properties"] = props,
            ["required"] = new JsonArray(properties.Select(p => (JsonNode)JsonValue.Create(p.Name)!).ToArray())
        };
    }

    private static JsonObject Arr(JsonNode items, int? min = null, int? max = null)
    {
        var array = new JsonObject { ["type"] = "array", ["items"] = items };
        if (min is not null) array["minItems"] = min;
        if (max is not null) array["maxItems"] = max;
        return array;
    }

    public static JsonObject Schema() => Obj(
        ("format", Enum(new[] { MotionComicScript.FormatName })),
        ("caseId", Str()),
        ("language", Enum(new[] { "vi" })),
        ("title", Obj(("eyebrow", Str()), ("title", Str()), ("subtitle", Str()))),
        ("mood", Enum(MotionComicRules.Moods)),
        ("pages", Arr(Obj(
            ("layout", Enum(MotionComicRules.Layouts.Keys)),
            ("panels", Arr(Obj(
                ("art", Obj(
                    ("kind", Enum(MotionComicRules.ArtKinds)),
                    ("id", Str()),
                    ("focus", Arr(new JsonObject { ["type"] = "number" }, 4, 4)))),
                ("weather", Enum(MotionComicRules.Weathers)),
                ("enter", Enum(MotionComicRules.Enters)),
                ("beats", Arr(Obj(
                    ("type", Enum(MotionComicRules.BeatTypes)),
                    ("speakerId", Str()),
                    ("text", Str()),
                    ("style", Enum(MotionComicRules.SfxStyles.Prepend("")))), 1, MotionComicRules.MaxBeatsPerPanel)),
                ("audio", Arr(Enum(MotionComicRules.AudioCues), 0, MotionComicRules.MaxAudioCuesPerPanel))), 1, 3))),
            MotionComicRules.MinPages, MotionComicRules.MaxPages)));
}
