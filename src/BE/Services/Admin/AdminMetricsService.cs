using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Models.Payments;
using SirLocked.Api.Services.Observability;

namespace SirLocked.Api.Services.Admin;

public sealed record ActivityDayMetric(string Day, long ActiveUsers, long NewUsers);
public sealed record ActivityRetentionMetric(string CohortDay, long CohortSize, double? D1, double? D7);
public sealed record AdminActivityMetrics(
    long OnlineConnections,
    long OnlineUsers,
    long ActiveRooms,
    long Requests5m,
    double ErrorRate5m,
    long Dau,
    long Wau,
    long Mau,
    IReadOnlyList<ActivityDayMetric> Daily,
    IReadOnlyList<ActivityRetentionMetric> Retention);
public sealed record RevenueDayMetric(string Day, long Amount, long Orders);
public sealed record AdminRevenueMetrics(string Currency, long TotalPaid, long PaidOrders, IReadOnlyList<RevenueDayMetric> Daily);
public sealed record ActivityCohort(string Day, IReadOnlyCollection<string> UserIds);

public static class ActivityMetricsMath
{
    public static IReadOnlyList<ActivityDayMetric> BuildDaily(
        DateOnly start,
        DateOnly end,
        IReadOnlyDictionary<DateOnly, HashSet<string>> activeUsers,
        IReadOnlyDictionary<DateOnly, long> newUsers)
    {
        var result = new List<ActivityDayMetric>();
        for (var day = start; day <= end; day = day.AddDays(1))
        {
            result.Add(new ActivityDayMetric(
                day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                activeUsers.TryGetValue(day, out var users) ? users.Count : 0,
                newUsers.TryGetValue(day, out var count) ? count : 0));
        }
        return result;
    }

    public static long CountDistinctUsers(
        DateOnly start,
        DateOnly end,
        IReadOnlyDictionary<DateOnly, HashSet<string>> activeUsers)
    {
        var users = new HashSet<string>(StringComparer.Ordinal);
        for (var day = start; day <= end; day = day.AddDays(1))
            if (activeUsers.TryGetValue(day, out var daily)) users.UnionWith(daily);
        return users.Count;
    }

    public static IReadOnlyList<ActivityRetentionMetric> BuildRetention(
        DateOnly today,
        IReadOnlyCollection<ActivityCohort> cohorts,
        IReadOnlyDictionary<DateOnly, HashSet<string>> activeUsers)
    {
        return cohorts.OrderBy(cohort => DateOnly.ParseExact(cohort.Day, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture))
            .Select(cohort =>
            {
                var cohortDay = DateOnly.ParseExact(cohort.Day, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
                return new ActivityRetentionMetric(
                    cohort.Day,
                    cohort.UserIds.Count,
                    Retention(cohort.UserIds, cohortDay.AddDays(1), today, activeUsers),
                    Retention(cohort.UserIds, cohortDay.AddDays(7), today, activeUsers));
            })
            .ToArray();
    }

    private static double? Retention(
        IReadOnlyCollection<string> cohort,
        DateOnly observedDay,
        DateOnly today,
        IReadOnlyDictionary<DateOnly, HashSet<string>> activeUsers)
    {
        if (observedDay > today) return null;
        if (cohort.Count == 0) return 0;
        return activeUsers.TryGetValue(observedDay, out var active)
            ? (double)cohort.Count(active.Contains) / cohort.Count
            : 0;
    }
}

public sealed class AdminMetricsService(
    MongoDbContext db,
    OnlineConnections onlineConnections,
    RequestHealthWindow requestHealth,
    TimeProvider timeProvider)
{
    public async Task<AdminActivityMetrics> GetActivityAsync(int days, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var today = DateOnly.FromDateTime(now);
        var end = today.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var start = today.AddDays(-(days - 1));
        var retentionActivityStart = today.AddDays(-12);
        var firstActivityDay = start < retentionActivityStart ? start : retentionActivityStart;
        var mauStart = today.AddDays(-29);
        if (mauStart < firstActivityDay) firstActivityDay = mauStart;
        var firstActivity = firstActivityDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        var activityFilter = Builders<UserActivityDay>.Filter.Gte(item => item.Day,
                firstActivityDay.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture))
            & Builders<UserActivityDay>.Filter.Lte(item => item.Day,
                today.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture));
        var activityRows = await db.UserActivityDays.Find(activityFilter)
            .Project(item => new UserActivityDay { UserId = item.UserId, Day = item.Day })
            .ToListAsync(cancellationToken);
        var activeByDay = activityRows
            .GroupBy(item => DateOnly.ParseExact(item.Day, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture))
            .ToDictionary(group => group.Key, group => group.Select(item => item.UserId).ToHashSet(StringComparer.Ordinal));

        var newUsers = await db.Users.Find(user => user.CreatedAt >= firstActivity && user.CreatedAt < end)
            .Project(user => new { user.Id, user.CreatedAt })
            .ToListAsync(cancellationToken);
        var newUsersByDay = newUsers
            .GroupBy(user => DateOnly.FromDateTime(DateTime.SpecifyKind(user.CreatedAt, DateTimeKind.Utc)))
            .ToDictionary(group => group.Key, group => (long)group.Count());

        var cohortStart = today.AddDays(-13).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var cohorts = newUsers
            .Where(user => user.CreatedAt >= cohortStart)
            .GroupBy(user => DateOnly.FromDateTime(DateTime.SpecifyKind(user.CreatedAt, DateTimeKind.Utc)))
            .Select(group => new ActivityCohort(
                group.Key.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                group.Select(user => user.Id).ToArray()))
            .ToArray();
        var daily = ActivityMetricsMath.BuildDaily(start, today, activeByDay, newUsersByDay);
        var health = requestHealth.Snapshot();

        return new AdminActivityMetrics(
            onlineConnections.ConnectionCount,
            onlineConnections.DistinctUserCount,
            await db.Rooms.CountDocumentsAsync(room => room.Status == RoomStatus.InProgress, cancellationToken: cancellationToken),
            health.Requests5m,
            health.ErrorRate5m,
            ActivityMetricsMath.CountDistinctUsers(today, today, activeByDay),
            ActivityMetricsMath.CountDistinctUsers(today.AddDays(-6), today, activeByDay),
            ActivityMetricsMath.CountDistinctUsers(today.AddDays(-29), today, activeByDay),
            daily,
            ActivityMetricsMath.BuildRetention(today, cohorts, activeByDay));
    }

    public async Task<AdminRevenueMetrics> GetRevenueAsync(int days, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        var startDay = today.AddDays(-(days - 1));
        var start = startDay.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var end = today.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var orders = await db.Database.GetCollection<PaymentOrder>("paymentOrders")
            .Find(order => (order.Status == "PAID" || order.Status == "CREDITED")
                           && order.PaidAt.HasValue && order.PaidAt.Value >= start && order.PaidAt.Value < end)
            .Project(order => new { order.Amount, order.PaidAt })
            .ToListAsync(cancellationToken);
        var byDay = orders.GroupBy(order => DateOnly.FromDateTime(DateTime.SpecifyKind(order.PaidAt!.Value, DateTimeKind.Utc)))
            .ToDictionary(group => group.Key, group => (Amount: (long)group.Sum(order => order.Amount), Orders: (long)group.Count()));
        var daily = Enumerable.Range(0, days).Select(offset =>
        {
            var day = startDay.AddDays(offset);
            var totals = byDay.GetValueOrDefault(day);
            return new RevenueDayMetric(
                day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                totals.Amount,
                totals.Orders);
        }).ToArray();
        return new AdminRevenueMetrics("VND", orders.Sum(order => (long)order.Amount), orders.Count, daily);
    }
}
