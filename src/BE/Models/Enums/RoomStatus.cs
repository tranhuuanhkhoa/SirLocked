namespace SirLocked.Api.Models.Enums;

public static class RoomStatus
{
    public const string Waiting = "WAITING";
    public const string Ready = "READY";
    public const string InProgress = "IN_PROGRESS";
    public const string Completed = "COMPLETED";
    public const string Abandoned = "ABANDONED";
}

public static class PlayerRole
{
    public const string Investigator = "INVESTIGATOR";
    public const string Interrogator = "INTERROGATOR";

    public static bool IsValid(string? role) =>
        role == Investigator || role == Interrogator;
}

public static class GameStatus
{
    public const string InProgress = "IN_PROGRESS";
    public const string Won = "WON";
    public const string Failed = "FAILED";
}
