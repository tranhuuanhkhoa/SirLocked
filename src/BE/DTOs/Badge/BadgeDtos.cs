namespace SirLocked.Api.DTOs.Badge;

/// <summary>A single achievement and whether the inspected user has earned it.</summary>
public class BadgeDto
{
    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    /// <summary>lucide icon name the frontend renders.</summary>
    public string IconKey { get; set; } = string.Empty;
    public bool Earned { get; set; }
    /// <summary>Short context for an earned badge, e.g. "Vụ The Manor · 8:32"; null when not earned.</summary>
    public string? EarnedContext { get; set; }
}
