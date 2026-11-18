namespace SirLocked.Api.Configurations;

/// <summary>The weekly challenge: which case runs each week and what counts as a good one. Section "WeeklyChallenge".</summary>
public sealed class WeeklyChallengeSettings
{
    /// <summary>When true, a case is picked on its own at the start of each week if admin has not chosen one.</summary>
    public bool AutoPick { get; set; } = true;

    /// <summary>The total score (out of 100) a solved weekly case must reach for the player to earn the weekly chest.</summary>
    public int MinScore { get; set; } = 80;

    /// <summary>The lowest average star rating a case may have to be picked on its own.</summary>
    public double MinAverageRating { get; set; } = 4.0;

    /// <summary>How many counted reviews a case needs before its average counts.</summary>
    public int MinReviews { get; set; } = 5;

    /// <summary>A case that ran in one of this many past weeks is not picked again.</summary>
    public int NoRepeatWeeks { get; set; } = 4;
}
