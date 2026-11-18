using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>The "Tác giả" badge levels (VUAN-7 part H).</summary>
public static class AuthorTiers
{
    public const string None = "";
    /// <summary>At least one published case.</summary>
    public const string Author = "AUTHOR";
    /// <summary>"Tác giả được yêu thích": a case with enough counted completions and a high rating.</summary>
    public const string Silver = "SILVER";
    /// <summary>"Tác giả vàng".</summary>
    public const string Gold = "GOLD";

    public static int Rank(string? tier) => tier switch { Gold => 3, Silver => 2, Author => 1, _ => 0 };
}

public static class AuthorPayoutKinds
{
    /// <summary>The author's share of a batch of hint coins and ad views of one case.</summary>
    public const string Share = "SHARE";
    /// <summary>The one-time bonus of reaching a tier.</summary>
    public const string Tier = "TIER";
}

public static class AuthorPayoutStates
{
    /// <summary>Waiting out the hold period; paid automatically after it.</summary>
    public const string Held = "HELD";
    /// <summary>Stopped by an admin; not paid until released.</summary>
    public const string OnHold = "ON_HOLD";
    public const string Paid = "PAID";
    public const string Revoked = "REVOKED";
}

/// <summary>Bonus coins owed to an author (<c>authorPayouts</c>), held before they are paid (VUAN-7 part H).</summary>
[BsonIgnoreExtraElements]
public class AuthorPayout
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string AuthorUserId { get; set; } = string.Empty;
    public string CaseId { get; set; } = string.Empty;
    public string Kind { get; set; } = AuthorPayoutKinds.Share;
    /// <summary>TIER payouts: the tier reached.</summary>
    public string Tier { get; set; } = string.Empty;
    /// <summary>Calendar month in Vietnam time (yyyy-MM), for the monthly cap.</summary>
    public string MonthKey { get; set; } = string.Empty;
    public long Xu { get; set; }
    /// <summary>What the monthly cap cut off.</summary>
    public long ClippedXu { get; set; }
    /// <summary>Hint coins and ad VND the share was computed from (eligible events only).</summary>
    public long SourceXu { get; set; }
    public long SourceVnd { get; set; }
    public int EligibleEvents { get; set; }
    public int IneligibleEvents { get; set; }
    public string State { get; set; } = AuthorPayoutStates.Held;
    public DateTime CreatedAt { get; set; }
    public DateTime AvailableAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string ChangedByUserId { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    /// <summary>Bonus coins actually taken back when a paid payout was revoked (never more than the author still has).</summary>
    public long RevokedXu { get; set; }
}

/// <summary>Per-author summary the badges read (<c>authorStats</c>, id = user id), refreshed by the reward worker.</summary>
[BsonIgnoreExtraElements]
public class AuthorStats
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public string Tier { get; set; } = AuthorTiers.None;
    public int PublishedCases { get; set; }
    /// <summary>Best case: counted completions and rating (percent of 5 stars).</summary>
    public int BestCompletions { get; set; }
    public int BestRatingPercent { get; set; }
    public string BestCaseId { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Hashed network fingerprints of a user (<c>userNetworkKeys</c>, id = user id): SHA-256 of the IP address and the
/// browser's device id, never the IP itself. Accounts sharing a fingerprint count once toward an author's rewards.
/// </summary>
[BsonIgnoreExtraElements]
public class UserNetworkKeys
{
    [BsonId] public string Id { get; set; } = string.Empty;
    public List<string> Keys { get; set; } = new();
    public DateTime UpdatedAt { get; set; }
}
