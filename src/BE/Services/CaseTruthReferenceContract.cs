using SirLocked.Api.Models;

namespace SirLocked.Api.Services;

internal static class CaseTruthReferenceContract
{
    public static IReadOnlyList<string> CoreActionIds(CoreCaseTruth core) =>
        StableDistinct(core.PreparationActionIds
            .Concat(core.CrimeActionIds)
            .Concat(core.ConcealmentActionIds)
            .Concat(core.CulpritMistakeActionIds));

    public static IReadOnlyList<string> TimelineEventIds(IEnumerable<TrueTimelineEvent> timeline) =>
        StableDistinct(timeline.Select(item => item.EventId));

    public static IReadOnlyList<string> PlannedTraceIds(IEnumerable<TrueTimelineEvent> timeline) =>
        StableDistinct(timeline.SelectMany(item => item.TraceIds));

    private static IReadOnlyList<string> StableDistinct(IEnumerable<string> values)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>();
        foreach (var value in values)
        {
            if (seen.Add(value)) result.Add(value);
        }
        return result;
    }
}
