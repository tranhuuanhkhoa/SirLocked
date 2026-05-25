namespace SirLocked.API.Helpers;

public static class UserRoles
{
    public const string Admin = "ADMIN";
    public const string Host = "HOST";
    public const string Player = "PLAYER";

    public static readonly string[] All = [Admin, Host, Player];
}
