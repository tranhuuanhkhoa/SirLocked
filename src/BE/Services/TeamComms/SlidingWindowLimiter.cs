using System.Collections.Concurrent;

namespace SirLocked.Api.Services.TeamComms;

/// <summary>
/// At most <c>limit</c> events per key within <c>window</c>, and never two closer than <c>minimumGap</c>. Used for chat
/// lines and voice signals, so one player can neither flood the partner nor the server. Thread-safe.
/// </summary>
public sealed class SlidingWindowLimiter
{
    private readonly ConcurrentDictionary<string, Queue<long>> _events = new();
    private readonly int _limit;
    private readonly long _windowTicks;
    private readonly long _gapTicks;
    private int _calls;

    public SlidingWindowLimiter(int limit, TimeSpan window, TimeSpan minimumGap = default)
    {
        if (limit < 1) throw new ArgumentOutOfRangeException(nameof(limit));
        _limit = limit;
        _windowTicks = window.Ticks;
        _gapTicks = minimumGap.Ticks;
    }

    /// <summary>A chat line: 6 per 10 seconds, at least 0.3 second apart.</summary>
    public static SlidingWindowLimiter ForChat() => new(6, TimeSpan.FromSeconds(10), TimeSpan.FromMilliseconds(300));

    /// <summary>Voice set-up messages: a connection needs an offer, an answer and a few dozen candidates.</summary>
    public static SlidingWindowLimiter ForVoiceSignals() => new(150, TimeSpan.FromSeconds(10));

    public bool TryAcquire(string key, DateTime utcNow)
    {
        var now = utcNow.Ticks;
        var events = _events.GetOrAdd(key, _ => new Queue<long>());
        bool accepted;
        lock (events)
        {
            while (events.Count > 0 && now - events.Peek() >= _windowTicks) events.Dequeue();
            var tooSoon = events.Count > 0 && _gapTicks > 0 && now - LastOf(events) < _gapTicks;
            accepted = !tooSoon && events.Count < _limit;
            if (accepted) events.Enqueue(now);
        }
        if (Interlocked.Increment(ref _calls) % 256 == 0) Sweep(now);
        return accepted;
    }

    private static long LastOf(Queue<long> events)
    {
        var last = 0L;
        foreach (var value in events) last = value;
        return last;
    }

    /// <summary>Forgets keys whose window has passed, so the dictionary does not grow with every match ever played.</summary>
    private void Sweep(long now)
    {
        foreach (var entry in _events)
        {
            bool idle;
            lock (entry.Value) idle = entry.Value.Count == 0 || now - LastOf(entry.Value) >= _windowTicks;
            if (idle) ((ICollection<KeyValuePair<string, Queue<long>>>)_events).Remove(entry);
        }
    }
}
