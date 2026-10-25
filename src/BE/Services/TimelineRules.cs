using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

/// <summary>
/// Open co-op timeline: fixed events sit on the ruler as soon as their source clues are known; open
/// events are placed by the team between placed ones and checked by <see cref="CaseTimelineEvent.SortKey"/>.
/// </summary>
public static class TimelineRules
{
    public static bool IsKnown(CaseTimelineEvent timelineEvent, GameplayState state) =>
        timelineEvent.RequiredClueIds.All(state.UnlockedClueIds.Contains);

    public static bool IsPlaced(CaseTimelineEvent timelineEvent, GameplayState state) =>
        (timelineEvent.IsFixed && IsKnown(timelineEvent, state)) || state.PlacedTimelineEventIds.Contains(timelineEvent.EventId);

    public static List<CaseTimelineEvent> PlacedInOrder(CaseTimeline timeline, GameplayState state) =>
        timeline.Events.Where(item => IsPlaced(item, state)).OrderBy(item => item.SortKey).ToList();

    public static TimelineViewDto? BuildView(GameCase gameCase, GameplayState state)
    {
        var timeline = gameCase.Timeline;
        if (timeline is null || timeline.Events.Count == 0) return null;
        TimelineEventDto Dto(CaseTimelineEvent item, bool placed) => new()
        {
            EventId = item.EventId,
            Label = item.Label,
            Detail = item.Detail,
            DayLabel = item.DayLabel,
            TimeLabel = placed ? item.TimeLabel : string.Empty,
            IsFixed = item.IsFixed
        };
        var placed = PlacedInOrder(timeline, state);
        var open = timeline.Events
            .Where(item => !item.IsFixed && IsKnown(item, state) && !state.PlacedTimelineEventIds.Contains(item.EventId))
            .OrderBy(item => item.EventId, StringComparer.Ordinal) // never leak the order through the tray
            .ToList();
        return new TimelineViewDto
        {
            Title = timeline.Title,
            Prompt = timeline.Prompt,
            Placed = placed.Select(item => Dto(item, true)).ToList(),
            Open = open.Select(item => Dto(item, false)).ToList(),
            HiddenCount = timeline.Events.Count - placed.Count - open.Count,
            WrongCount = state.WrongTimelineCount
        };
    }

    public enum PlacementOutcome { Correct, TooEarly, TooLate }

    /// <summary>
    /// Judges placing <paramref name="timelineEvent"/> right after <paramref name="afterEventId"/>
    /// (null/empty = at the very start) among the events placed so far.
    /// </summary>
    public static PlacementOutcome Judge(CaseTimeline timeline, GameplayState state, CaseTimelineEvent timelineEvent, string? afterEventId)
    {
        var placed = PlacedInOrder(timeline, state);
        var correctAfter = placed.LastOrDefault(item => item.SortKey < timelineEvent.SortKey);
        var chosenIndex = string.IsNullOrWhiteSpace(afterEventId) ? -1 : placed.FindIndex(item => item.EventId == afterEventId);
        if (!string.IsNullOrWhiteSpace(afterEventId) && chosenIndex < 0)
            throw DTOs.ApiException.BadRequest("That timeline position no longer exists.");
        var correctIndex = correctAfter is null ? -1 : placed.IndexOf(correctAfter);
        if (chosenIndex == correctIndex) return PlacementOutcome.Correct;
        return chosenIndex < correctIndex ? PlacementOutcome.TooEarly : PlacementOutcome.TooLate;
    }
}
