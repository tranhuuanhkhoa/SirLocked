namespace SirLocked.Api.Models.Enums;

public static class AdminPolicies
{
    public const string Content = "admin:content";
    public const string Economy = "admin:economy";
    public const string Players = "admin:players";
    public const string Moderation = "admin:moderation";
    public const string Audit = "admin:audit";
    public const string Roles = "admin:roles";

    public static readonly (string Name, string Permission)[] All =
    [
        (Content, AdminRoles.ContentPermission),
        (Economy, AdminRoles.EconomyPermission),
        (Players, AdminRoles.PlayersPermission),
        (Moderation, AdminRoles.ModerationPermission),
        (Audit, AdminRoles.AuditPermission),
        (Roles, AdminRoles.RolesPermission)
    ];
}
