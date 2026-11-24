using SirLocked.Api.Models;
using System.Collections.Generic;

namespace SirLocked.Api.Models.Enums;

public static class AdminRoles
{
    public const string SuperAdmin = "SUPER_ADMIN";
    public const string Content = "CONTENT";
    public const string Finance = "FINANCE";
    public const string Support = "SUPPORT";
    public const string Moderator = "MODERATOR";

    public const string ContentPermission = "content";
    public const string EconomyPermission = "economy";
    public const string PlayersPermission = "players";
    public const string ModerationPermission = "moderation";
    public const string AuditPermission = "audit";
    public const string RolesPermission = "roles";

    public static readonly string[] AllPermissions =
    [
        ContentPermission,
        EconomyPermission,
        PlayersPermission,
        ModerationPermission,
        AuditPermission,
        RolesPermission
    ];

    public static string? Effective(User user) =>
        user.Role == UserRole.Admin ? user.AdminRole ?? SuperAdmin : null;

    public static string[] PermissionsFor(User user)
    {
        var role = Effective(user);
        return role switch
        {
            SuperAdmin => [.. AllPermissions],
            Content => [ContentPermission],
            Finance => [EconomyPermission, AuditPermission],
            Support => [PlayersPermission, ModerationPermission],
            Moderator => [ModerationPermission],
            _ => []
        };
    }

    public static bool IsKnown(string? role) =>
        role is SuperAdmin or Content or Finance or Support or Moderator;

    public static bool HasPermission(string? role, string permission) =>
        role switch
        {
            SuperAdmin => true,
            Content => permission == ContentPermission,
            Finance => permission is EconomyPermission or AuditPermission,
            Support => permission is PlayersPermission or ModerationPermission,
            Moderator => permission == ModerationPermission,
            _ => false
        };
}
