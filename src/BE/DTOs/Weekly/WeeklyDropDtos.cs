using SirLocked.Api.DTOs.Market;

namespace SirLocked.Api.DTOs.Weekly;

/// <summary>
/// One weekly challenge chest of the caller. <see cref="State"/> is PENDING (on its way to the bag), WAITING (the bag was
/// full: claim it after making room) or DONE (in the bag). A chest kind no longer in the catalog shows its id as its name.
/// </summary>
public sealed record WeeklyDropDto(
    string Id,
    string WeekKey,
    string ChestId,
    string ChestName,
    string ChestNameEn,
    string IconKey,
    ChestLookDto? Look,
    string State,
    DateTime CreatedAt);

/// <summary>
/// What one game did for the caller's weekly chest: one of WeeklyDropStatuses. <see cref="Drop"/> is the week's chest
/// when there is one to show: the one this game dropped (GRANTED, WAITING) or the one the week already gave (ALREADY_THIS_WEEK).
/// </summary>
public sealed record WeeklyDropStatusDto(string Status, WeeklyDropDto? Drop, int MinScore);

/// <summary>
/// The caller's weekly reward: this week's chest if the week gave one, and every chest still waiting to be claimed
/// (this week's included), newest week first.
/// </summary>
public sealed record WeeklyRewardDto(string WeekKey, int MinScore, WeeklyDropDto? ThisWeek, IReadOnlyList<WeeklyDropDto> Waiting);
