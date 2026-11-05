using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MongoDB.Bson;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Market;

namespace SirLocked.Api.Services.Admin;

public static class AdminCosmeticCodes
{
    public const string NotFound = "COSMETIC_NOT_FOUND";
    public const string NotCosmetic = "COSMETIC_CATEGORY_INVALID";
    public const string NameInvalid = "COSMETIC_NAME_INVALID";
    public const string RarityInvalid = "COSMETIC_RARITY_INVALID";
    public const string TemplateUnknown = "COSMETIC_TEMPLATE_UNKNOWN";
    public const string ImageRequired = "COSMETIC_IMAGE_REQUIRED";
    public const string ImageInvalid = "COSMETIC_IMAGE_INVALID";
    public const string HoleInvalid = "COSMETIC_HOLE_INVALID";
    public const string BaseUnknown = "COSMETIC_BASE_UNKNOWN";
    public const string StyleUnknown = "COSMETIC_STYLE_UNKNOWN";
    public const string LiveInvalid = "COSMETIC_LIVE_INVALID";
    public const string SheenInvalid = "COSMETIC_SHEEN_INVALID";
    public const string ParamInvalid = "COSMETIC_PARAM_INVALID";
    public const string ModeInvalid = "COSMETIC_MODE_INVALID";
    public const string LevelInvalid = "COSMETIC_LEVEL_INVALID";
    public const string MetricUnknown = "COSMETIC_METRIC_UNKNOWN";
    public const string TargetInvalid = "COSMETIC_TARGET_INVALID";
    public const string EarnedNotTradable = "COSMETIC_EARNED_NOT_TRADABLE";
    public const string EarnedCopiesExist = "COSMETIC_EARNED_COPIES_EXIST";
    public const string OpenOrders = "COSMETIC_HAS_OPEN_ORDERS";
    public const string RetiredCannotBeEarned = "COSMETIC_RETIRED";
    public const string DefaultRequired = "COSMETIC_DEFAULT_REQUIRED";
    public const string DefaultCannotRetire = "COSMETIC_DEFAULT_RETIRE";
    public const string BuiltinCannotBeDeleted = "COSMETIC_BUILTIN";
    public const string VersionConflict = "COSMETIC_VERSION_CONFLICT";
    public const string AlreadyOwned = "COSMETIC_ALREADY_OWNED";
    public const string ReasonRequired = "ADMIN_REASON_REQUIRED";
    public const string XpInvalid = "GAME_XP_INVALID";
}

/// <summary>What a checked <c>visual</c> became: the problems, or a document holding only what the drawing code reads.</summary>
public sealed record CosmeticVisualCheck(IReadOnlyList<CatalogRuleViolation> Violations, CatalogVisual? Visual);

/// <summary>
/// What may be saved as a cosmetic. Pure functions, so the rules can be read and tested without a database.
/// Everything here ends up in a canvas or an SVG attribute on other players' screens, so nothing is passed through
/// unread: a value is either checked and copied into a new document, or refused. The tables mirror the drawing code
/// in src/FE/Client/js/cosmetics; docs/admin-cosmetics.md describes them.
/// </summary>
public static class AdminCosmeticRules
{
    public const string TemplatePainted = "painted";
    public const string TemplateClone = "builtin-clone";
    public const string TemplateStyle = "style";

    public const string ModeLevel = "level";
    public const string ModeAchievement = "achievement";
    public const string ModeDefault = "default";
    public const string ModeAdmin = "admin";

    public const long MaxXpRate = 100_000;
    public const int MaxNameLength = 60;
    public const int MaxDescriptionLength = 300;
    public const int MaxReasonLength = 500;
    public const int MaxTarget = 1_000_000;

    /// <summary>Frames a clone can borrow its drawing from: every shipped frame but the bare ring.</summary>
    public static readonly IReadOnlyList<string> FrameBases = new[]
    {
        "dong", "bac", "ngoc", "vang", "truong", "thach", "mac", "bang", "sonmai", "ulinh", "vankiem", "hacduc", "kimlong", "phuong", "tinhkhong", "lua",
    };

    /// <summary>The keys of the STY table in cosmetics/titles.js.</summary>
    public static readonly IReadOnlyList<string> TitleStyles = new[]
    {
        "thuong", "ngan", "nguyet", "truc", "ngoc", "bang", "anhdao", "mac", "tinhkhong", "kiem", "thanh", "thantham", "hoa", "hacduc", "longphung", "kimlong", "phuong", "thienmenh",
    };

    /// <summary>The ten stages of cosmetics/stage.js.</summary>
    public static readonly IReadOnlyList<string> EntranceTemplates = new[]
    {
        "lang-le", "anh-trang", "mac-vu", "truc-lam", "van-kiem", "huyet-nguyet", "hac-duc", "than-tham", "kim-long", "phuong-hoang",
    };

    /// <summary>The particle classes (hs-p-*) of css/48-cosmetics.css.</summary>
    public static readonly IReadOnlyList<string> TitleParticles = new[]
    {
        "tw", "rise", "leaf", "snow", "petal", "smoke", "ember", "feather", "wfeather",
    };

    public static readonly IReadOnlyList<string> FallKinds = new[] { "snow", "petal", "rose", "feather" };

    private static readonly string[] CreatureTemplates = { "kim-long", "phuong-hoang" };
    private const string SwordTemplate = "van-kiem";
    private const int MaxParticleRows = 4;
    private const int MaxUrlLength = 1000;

    private static readonly Regex RgbPattern = new(@"^(\d{1,3}),(\d{1,3}),(\d{1,3})$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private static readonly Regex SafeUrl = new(@"^(https://[^\s""'<>()\\]+|/assets/[^\s""'<>()\\]+)$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    // ------------------------------------------------------------------ names and small fields

    public static string? CleanReason(string? reason)
    {
        var trimmed = reason?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed.Length > MaxReasonLength ? trimmed[..MaxReasonLength] : trimmed;
    }

    public static CatalogRuleViolation? ValidateName(string? name) =>
        string.IsNullOrWhiteSpace(name) || name.Trim().Length > MaxNameLength
            ? new CatalogRuleViolation(AdminCosmeticCodes.NameInvalid, $"Tên phải có từ 1 đến {MaxNameLength} ký tự.")
            : null;

    public static CatalogRuleViolation? ValidateXp(long rareXp, long epicXp) =>
        rareXp is < 1 or > MaxXpRate || epicXp is < 1 or > MaxXpRate
            ? new CatalogRuleViolation(AdminCosmeticCodes.XpInvalid, $"KN mỗi món phải từ 1 đến {MaxXpRate:N0}.")
            : null;

    /// <summary>A level, achievement or default item is handed out for free and again after it is gone: it must never be worth money or XP.</summary>
    public static bool IsEarnedMode(string mode) => mode is ModeLevel or ModeAchievement or ModeDefault;

    public static CatalogRuleViolation? ValidateLevel(int? level) =>
        level is null or < 1 or > ProgressRules.MaxLevel
            ? new CatalogRuleViolation(AdminCosmeticCodes.LevelInvalid, $"Cấp phải từ 1 đến {ProgressRules.MaxLevel}.")
            : null;

    public static CatalogRuleViolation? ValidateAchievement(string? metric, int? target)
    {
        if (!AchievementMetrics.IsKnown(metric))
            return new CatalogRuleViolation(AdminCosmeticCodes.MetricUnknown, "Chỉ số này không có trong danh sách của game.");
        if (target is null or < 1 or > MaxTarget)
            return new CatalogRuleViolation(AdminCosmeticCodes.TargetInvalid, $"Mục tiêu phải từ 1 đến {MaxTarget:N0}.");
        // This one counts 0 or 1, so any higher target could never be reached.
        return metric == AchievementMetrics.OwnsWatch217 && target != 1
            ? new CatalogRuleViolation(AdminCosmeticCodes.TargetInvalid, "Chỉ số sở hữu Đồng hồ 2:17 chỉ có mục tiêu 1.")
            : null;
    }

    /// <summary>"Hắc Long Đỏ" becomes "hac-long-do". An id must reach the drawing tables and CSS as a plain word.</summary>
    public static string SlugOf(string name)
    {
        var plain = new StringBuilder();
        foreach (var c in name.Trim().Replace('đ', 'd').Replace('Đ', 'D').Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            plain.Append(char.IsAsciiLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-');
        }
        var slug = Regex.Replace(plain.ToString(), "-+", "-").Trim('-');
        if (slug.Length > 40) slug = slug[..40].TrimEnd('-');
        if (slug.Length == 0) return "mon";
        // These would resolve to something else in a drawing table.
        return slug is "none" or "constructor" or "prototype" ? slug + "-moi" : slug;
    }

    public static string PrefixOf(string category) => category switch
    {
        MarketCategories.Frame => CosmeticCatalog.FramePrefix,
        MarketCategories.Title => CosmeticCatalog.TitlePrefix,
        _ => CosmeticCatalog.EntrancePrefix,
    };

    // ------------------------------------------------------------------ visual

    public static CosmeticVisualCheck ValidateVisual(string category, string defId, string? imageUrl, string? template, JsonElement? parameters)
    {
        var problems = new List<CatalogRuleViolation>();
        void Problem(string code, string message) => problems.Add(new CatalogRuleViolation(code, message));

        JsonElement? given = parameters is { ValueKind: JsonValueKind.Object } ? parameters : null;
        if (parameters is { ValueKind: not (JsonValueKind.Object or JsonValueKind.Null or JsonValueKind.Undefined) })
            Problem(AdminCosmeticCodes.ParamInvalid, "Tham số của mẫu phải là một object.");

        BsonDocument? written = category switch
        {
            MarketCategories.Frame => FrameParams(template, imageUrl, given, Problem),
            MarketCategories.Title => TitleParams(template, given, Problem),
            MarketCategories.Entrance => EntranceParams(template, given, Problem),
            _ => null,
        };
        if (written is null && problems.Count == 0) Problem(AdminCosmeticCodes.NotCosmetic, "Chỉ tạo được viền, danh hiệu hoặc hiệu ứng vào sảnh.");
        if (problems.Count > 0) return new CosmeticVisualCheck(problems, null);

        return new CosmeticVisualCheck(problems, new CatalogVisual
        {
            IconKey = defId,
            // Only a painted frame keeps its picture at the top; an entrance names its pictures in its parameters.
            ImageUrl = template == TemplatePainted ? imageUrl : null,
            BuiltinId = null,
            Template = template,
            Params = written!,
        });
    }

    private static BsonDocument? FrameParams(string? template, string? imageUrl, JsonElement? given, Action<string, string> problem)
    {
        var written = new BsonDocument();
        if (template == TemplatePainted)
        {
            if (string.IsNullOrWhiteSpace(imageUrl)) problem(AdminCosmeticCodes.ImageRequired, "Viền vẽ tay cần một ảnh nền trong suốt.");
            else if (!IsSafeUrl(imageUrl)) problem(AdminCosmeticCodes.ImageInvalid, "Địa chỉ ảnh không hợp lệ.");

            if (given is not { } values || !values.TryGetProperty("hole", out var hole))
            {
                problem(AdminCosmeticCodes.HoleInvalid, "Hãy căn lỗ avatar trên ảnh.");
            }
            else if (ReadHole(hole) is { } clean)
            {
                written["hole"] = clean;
            }
            else
            {
                problem(AdminCosmeticCodes.HoleInvalid, "Lỗ avatar cần x, y không âm và bán kính lớn hơn 0.");
            }
            if (given is { } all)
            {
                if (all.TryGetProperty("scale", out var scale))
                {
                    if (Number(scale, 0.5, 1.5) is { } value) written["scale"] = value;
                    else problem(AdminCosmeticCodes.ParamInvalid, "Tỉ lệ phải từ 0,5 đến 1,5.");
                }
                if (all.TryGetProperty("glowUrl", out var glow))
                {
                    if (glow.ValueKind == JsonValueKind.String && IsSafeUrl(glow.GetString())) written["glowUrl"] = glow.GetString();
                    else problem(AdminCosmeticCodes.ImageInvalid, "Địa chỉ ảnh phát sáng không hợp lệ.");
                }
            }
        }
        else if (template == TemplateClone)
        {
            if (given is { } values && values.TryGetProperty("base", out var baseId) && baseId.ValueKind == JsonValueKind.String
                && FrameBases.Contains(baseId.GetString()!, StringComparer.Ordinal))
            {
                written["base"] = baseId.GetString();
            }
            else
            {
                problem(AdminCosmeticCodes.BaseUnknown, "Hãy chọn một viền có sẵn để làm biến thể.");
            }
        }
        else
        {
            problem(AdminCosmeticCodes.TemplateUnknown, "Mẫu viền không hợp lệ: chỉ có painted và builtin-clone.");
            return null;
        }

        if (given is { } effects)
        {
            if (effects.TryGetProperty("live", out var live))
            {
                if (ReadLive(live) is { } clean) written["live"] = clean;
                else problem(AdminCosmeticCodes.LiveInvalid, "Cấu hình hiệu ứng sống không hợp lệ.");
            }
            if (effects.TryGetProperty("sheen", out var sheen))
            {
                if (ReadSheen(sheen) is { } clean) written["sheen"] = clean;
                else problem(AdminCosmeticCodes.SheenInvalid, "Cấu hình ánh kim không hợp lệ.");
            }
        }
        return written;
    }

    private static BsonDocument? TitleParams(string? template, JsonElement? given, Action<string, string> problem)
    {
        if (template != TemplateStyle)
        {
            problem(AdminCosmeticCodes.TemplateUnknown, "Mẫu danh hiệu không hợp lệ: chỉ có style.");
            return null;
        }
        var written = new BsonDocument();
        if (given is { } values && values.TryGetProperty("style", out var style) && style.ValueKind == JsonValueKind.String
            && TitleStyles.Contains(style.GetString()!, StringComparer.Ordinal))
        {
            written["style"] = style.GetString();
        }
        else
        {
            problem(AdminCosmeticCodes.StyleUnknown, "Kiểu danh hiệu không có trong bảng 18 kiểu.");
        }
        if (given is not { } all) return written;
        if (all.TryGetProperty("glow", out var glow))
        {
            if (Rgb(glow) is { } rgb) written["glow"] = rgb;
            else problem(AdminCosmeticCodes.ParamInvalid, "Màu phát sáng phải có dạng \"r,g,b\".");
        }
        if (all.TryGetProperty("parts", out var parts))
        {
            if (ReadParticles(parts) is { } clean) written["parts"] = clean;
            else problem(AdminCosmeticCodes.ParamInvalid, "Cấu hình hạt bay không hợp lệ.");
        }
        return written;
    }

    private static BsonDocument? EntranceParams(string? template, JsonElement? given, Action<string, string> problem)
    {
        if (template is null || !EntranceTemplates.Contains(template, StringComparer.Ordinal))
        {
            problem(AdminCosmeticCodes.TemplateUnknown, "Mẫu hiệu ứng không có trong danh sách 10 mẫu.");
            return null;
        }
        var written = new BsonDocument();
        if (given is not { } all) return written;
        if (all.TryGetProperty("tint", out var tint))
        {
            if (Rgb(tint) is { } rgb) written["tint"] = rgb;
            else problem(AdminCosmeticCodes.ParamInvalid, "Màu chủ đạo phải có dạng \"r,g,b\".");
        }
        if (all.TryGetProperty("duration", out var duration))
        {
            if (Number(duration, 4, 12) is { } seconds) written["duration"] = seconds;
            else problem(AdminCosmeticCodes.ParamInvalid, "Thời lượng phải từ 4 đến 12 giây.");
        }
        if (all.TryGetProperty("imageUrl", out var image))
        {
            if (!CreatureTemplates.Contains(template)) problem(AdminCosmeticCodes.ParamInvalid, "Chỉ mẫu kim-long và phuong-hoang đổi được ảnh sinh vật.");
            else if (image.ValueKind == JsonValueKind.String && IsSafeUrl(image.GetString())) written["imageUrl"] = image.GetString();
            else problem(AdminCosmeticCodes.ImageInvalid, "Địa chỉ ảnh sinh vật không hợp lệ.");
        }
        if (all.TryGetProperty("swordUrl", out var sword))
        {
            if (template != SwordTemplate) problem(AdminCosmeticCodes.ParamInvalid, "Chỉ mẫu van-kiem đổi được ảnh kiếm.");
            else if (sword.ValueKind == JsonValueKind.String && IsSafeUrl(sword.GetString())) written["swordUrl"] = sword.GetString();
            else problem(AdminCosmeticCodes.ImageInvalid, "Địa chỉ ảnh kiếm không hợp lệ.");
        }
        return written;
    }

    private static bool IsSafeUrl(string? url) => url is { Length: <= MaxUrlLength } && SafeUrl.IsMatch(url);

    private static BsonDocument? ReadHole(JsonElement hole)
    {
        if (hole.ValueKind != JsonValueKind.Object
            || !hole.TryGetProperty("x", out var x) || !hole.TryGetProperty("y", out var y) || !hole.TryGetProperty("r", out var r))
            return null;
        var (cx, cy, radius) = (Number(x, 0, 20_000), Number(y, 0, 20_000), Number(r, 0, 20_000));
        if (cx is null || cy is null || radius is null or <= 0) return null;
        return new BsonDocument { ["x"] = cx.Value, ["y"] = cy.Value, ["r"] = radius.Value };
    }

    /// <summary>The same shape as the LIVE table in cosmetics/frames.js. Null when any entry is off.</summary>
    private static BsonDocument? ReadLive(JsonElement live)
    {
        if (live.ValueKind != JsonValueKind.Object) return null;
        var written = new BsonDocument();
        foreach (var entry in live.EnumerateObject())
        {
            BsonValue? value = entry.Name switch
            {
                "aura" => Pair(entry.Value, 0, 0.6),
                "rays" => Pair(entry.Value, 0, 0.4),
                "comet" => Comet(entry.Value),
                "spark" => Pair(entry.Value, 1, 10, whole: true),
                "embers" => Pair(entry.Value, 1, 16, whole: true),
                "fall" => Fall(entry.Value),
                "flame" => entry.Value.ValueKind == JsonValueKind.Number && entry.Value.TryGetInt32(out var on) && on == 1 ? new BsonInt32(1) : null,
                "breathe" => Number(entry.Value, 0, 0.03) is { } amount ? new BsonDouble(amount) : null,
                _ => null,
            };
            if (value is null) return null;
            written[entry.Name] = value;
        }
        return written;
    }

    /// <summary>[rgb, number]</summary>
    private static BsonArray? Pair(JsonElement value, double min, double max, bool whole = false)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 2) return null;
        var rgb = Rgb(value[0]);
        var number = Number(value[1], min, max, whole);
        return rgb is null || number is null ? null : new BsonArray { rgb, number.Value };
    }

    /// <summary>[rgb, speed, trails]</summary>
    private static BsonArray? Comet(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 3) return null;
        var rgb = Rgb(value[0]);
        var speed = Number(value[1], 0.02, 0.6);
        var trails = Number(value[2], 1, 4, whole: true);
        return rgb is null || speed is null || trails is null ? null : new BsonArray { rgb, speed.Value, trails.Value };
    }

    /// <summary>[kind, count]</summary>
    private static BsonArray? Fall(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 2) return null;
        var kind = value[0].ValueKind == JsonValueKind.String ? value[0].GetString() : null;
        var count = Number(value[1], 1, 16, whole: true);
        return kind is null || !FallKinds.Contains(kind, StringComparer.Ordinal) || count is null ? null : new BsonArray { kind, count.Value };
    }

    private static BsonDocument? ReadSheen(JsonElement sheen)
    {
        if (sheen.ValueKind != JsonValueKind.Object) return null;
        if (!sheen.TryGetProperty("rgb", out var color) || Rgb(color) is not { } rgb) return null;
        if (!sheen.TryGetProperty("a", out var strength) || Number(strength, 0, 1) is not { } a) return null;
        var written = new BsonDocument { ["rgb"] = rgb, ["a"] = a };
        if (sheen.TryGetProperty("period", out var period))
        {
            if (Number(period, 2, 20) is not { } seconds) return null;
            written["period"] = seconds;
        }
        if (sheen.TryGetProperty("conic", out var conic))
        {
            if (conic.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
            written["conic"] = conic.GetBoolean();
        }
        return written;
    }

    /// <summary>[[kind, count, rgb], ...], the shape of <c>parts</c> in the STY table.</summary>
    private static BsonArray? ReadParticles(JsonElement parts)
    {
        if (parts.ValueKind != JsonValueKind.Array || parts.GetArrayLength() > MaxParticleRows) return null;
        var written = new BsonArray();
        foreach (var row in parts.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Array || row.GetArrayLength() != 3) return null;
            var kind = row[0].ValueKind == JsonValueKind.String ? row[0].GetString() : null;
            var count = Number(row[1], 1, 12, whole: true);
            var rgb = Rgb(row[2]);
            if (kind is null || !TitleParticles.Contains(kind, StringComparer.Ordinal) || count is null || rgb is null) return null;
            written.Add(new BsonArray { kind, count.Value, rgb });
        }
        return written;
    }

    private static string? Rgb(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String) return null;
        var match = RgbPattern.Match(value.GetString() ?? string.Empty);
        if (!match.Success) return null;
        for (var group = 1; group <= 3; group++)
        {
            if (int.Parse(match.Groups[group].Value, CultureInfo.InvariantCulture) > 255) return null;
        }
        return match.Value;
    }

    private static double? Number(JsonElement value, double min, double max, bool whole = false)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number)) return null;
        if (double.IsNaN(number) || number < min || number > max) return null;
        return whole && Math.Abs(number - Math.Round(number)) > 1e-9 ? null : number;
    }
}
