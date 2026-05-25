namespace SirLocked.API.Helpers;

public static class UserStatuses
{
    public const string Active = "ACTIVE";
    public const string Locked = "LOCKED";

    public static readonly string[] All = [Active, Locked];
}
