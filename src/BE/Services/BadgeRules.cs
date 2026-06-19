using SirLocked.Api.DTOs.Badge;

namespace SirLocked.Api.Services;

/// <summary>
/// One winning play, flattened from a GameResult + its room's GameplayState, with only the
/// fields the badge catalog needs. Built by <see cref="BadgeService"/> so the rules stay I/O-free.
/// </summary>
public sealed record BadgePlay(
    string CaseId,
    string CaseTitle,
    bool HasDetailedStats,
    bool UsedHint,
    int? DurationSeconds,
    int WrongDeductionCount,
    int WrongEvidenceCount,
    int CameraMissCount,
    int Score,
    DateTime CompletedAt);

/// <summary>
/// The achievement catalog and the pure logic that decides which badges a set of winning plays earns.
/// Every badge maps to a field that actually exists on GameResult/GameplayState — nothing fabricated.
/// </summary>
public static class BadgeRules
{
    public const int SpeedThresholdSeconds = 600; // under 10 minutes
    public const int MasterScoreThreshold = 90;

    public sealed record BadgeDef(
        string Key,
        string Name,
        string Description,
        string IconKey,
        Func<BadgePlay, bool> Condition);

    public static readonly IReadOnlyList<BadgeDef> Catalog = new[]
    {
        new BadgeDef("first_solve", "Thám tử tập sự",
            "Phá án thành công lần đầu tiên.", "badge-check",
            _ => true),
        new BadgeDef("no_hint", "Không cần gợi ý",
            "Phá một vụ án mà không dùng gợi ý nào.", "lightbulb-off",
            p => p.HasDetailedStats && !p.UsedHint),
        new BadgeDef("speed_demon", "Tốc độ ánh sáng",
            "Phá án trong dưới 10 phút.", "timer",
            p => p.DurationSeconds is > 0 and < SpeedThresholdSeconds),
        new BadgeDef("flawless", "Suy luận hoàn hảo",
            "Phá án không có suy luận hay bằng chứng sai nào.", "target",
            p => p.HasDetailedStats && p.WrongDeductionCount == 0 && p.WrongEvidenceCount == 0),
        new BadgeDef("sharp_eye", "Mắt thám tử",
            "Phá án không bỏ sót lần chụp bằng chứng nào.", "camera",
            p => p.HasDetailedStats && p.CameraMissCount == 0),
        new BadgeDef("master", "Cao thủ phá án",
            "Đạt 90 điểm trở lên trong một vụ án.", "crown",
            p => p.Score >= MasterScoreThreshold),
    };

    /// <summary>
    /// Evaluates the catalog against a user's winning plays. A badge is earned if ANY play satisfies
    /// it; the context comes from the first such play. With no plays, every badge returns earned=false.
    /// </summary>
    public static List<BadgeDto> Evaluate(IReadOnlyList<BadgePlay> winningPlays)
    {
        return Catalog.Select(def =>
        {
            var hit = winningPlays.FirstOrDefault(def.Condition);
            return new BadgeDto
            {
                Key = def.Key,
                Name = def.Name,
                Description = def.Description,
                IconKey = def.IconKey,
                Earned = hit is not null,
                EarnedContext = hit is null ? null : Context(hit)
            };
        }).ToList();
    }

    private static string Context(BadgePlay p)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(p.CaseTitle))
        {
            parts.Add($"Vụ {p.CaseTitle}");
        }
        if (p.DurationSeconds is int d and > 0)
        {
            parts.Add($"{d / 60}:{d % 60:D2}");
        }
        return string.Join(" · ", parts);
    }
}
