using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services;

/// <summary>Pure decision logic for weekly features (admin gate + active-window selection).</summary>
public static class WeeklyRules
{
    /// <summary>
    /// Defence-in-depth admin check reusing the JWT role claim. The controller's
    /// [Authorize(Roles="ADMIN")] is the primary gate; this makes the rule unit-testable too.
    /// </summary>
    public static void EnsureAdmin(string? role)
    {
        if (!string.Equals(role, UserRole.Admin, StringComparison.Ordinal))
        {
            throw ApiException.Forbidden("Only an admin can manage weekly features.");
        }
    }

    /// <summary>
    /// Picks the feature of <paramref name="type"/> that is active and whose [weekStart, weekEnd]
    /// window contains <paramref name="now"/>; newest first. Returns null when none applies.
    /// </summary>
    public static WeeklyFeature? PickActive(IEnumerable<WeeklyFeature> features, string type, DateTime now) =>
        features
            .Where(f => f.IsActive && f.Type == type && f.WeekStart <= now && now <= f.WeekEnd)
            .OrderByDescending(f => f.CreatedAt)
            .FirstOrDefault();
}
