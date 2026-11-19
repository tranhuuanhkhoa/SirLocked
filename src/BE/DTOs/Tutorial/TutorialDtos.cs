namespace SirLocked.Api.DTOs.Tutorial;

/// <summary>What the client needs to route a player: ask for a path, push to the tutorial, or let them play.</summary>
public sealed class TutorialStatusResponse
{
    /// <summary>"VETERAN", "BEGINNER", or null while the account still has to choose.</summary>
    public string? Path { get; set; }
    /// <summary>True when the client must show the Kỳ cựu / Nhập môn choice.</summary>
    public bool NeedsChoice { get; set; }
    /// <summary>True when the player may not enter normal rooms until the tutorial is finished.</summary>
    public bool Required { get; set; }
    public bool Completed { get; set; }
    public DateTime? CompletedAt { get; set; }
    /// <summary>A tutorial room of this player that is still being played, to resume instead of starting over.</summary>
    public string? ActiveRoomId { get; set; }
    public string CaseId { get; set; } = string.Empty;
}

public sealed class TutorialChoiceRequest
{
    public string Path { get; set; } = string.Empty;
}

public sealed class TutorialStartResponse
{
    public string RoomId { get; set; } = string.Empty;
    /// <summary>True when an unfinished tutorial room was resumed instead of creating a new one.</summary>
    public bool Resumed { get; set; }
}

public sealed class TutorialRoleRequest
{
    public string Role { get; set; } = string.Empty;
}
