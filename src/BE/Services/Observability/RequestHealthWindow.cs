namespace SirLocked.Api.Services.Observability;

public sealed class RequestHealthWindow(TimeProvider timeProvider)
{
    private const int BucketSeconds = 10;
    private const int BucketCount = 30;
    private readonly object _gate = new();
    private readonly long[] _bucketIds = Enumerable.Repeat(long.MinValue, BucketCount).ToArray();
    private readonly long[] _requests = new long[BucketCount];
    private readonly long[] _errors = new long[BucketCount];

    public long Requests5m => Snapshot().Requests5m;
    public double ErrorRate5m => Snapshot().ErrorRate5m;

    public void Record(int statusCode)
    {
        var bucketId = timeProvider.GetUtcNow().ToUnixTimeSeconds() / BucketSeconds;
        var index = (int)(bucketId % BucketCount);
        lock (_gate)
        {
            if (_bucketIds[index] != bucketId)
            {
                _bucketIds[index] = bucketId;
                _requests[index] = 0;
                _errors[index] = 0;
            }

            _requests[index]++;
            if (statusCode >= 500) _errors[index]++;
        }
    }

    public RequestHealthSnapshot Snapshot()
    {
        var currentBucket = timeProvider.GetUtcNow().ToUnixTimeSeconds() / BucketSeconds;
        var earliestBucket = currentBucket - BucketCount + 1;
        lock (_gate)
        {
            long requests = 0;
            long errors = 0;
            for (var index = 0; index < BucketCount; index++)
            {
                if (_bucketIds[index] < earliestBucket || _bucketIds[index] > currentBucket) continue;
                requests += _requests[index];
                errors += _errors[index];
            }

            return new RequestHealthSnapshot(requests, requests == 0 ? 0 : (double)errors / requests);
        }
    }
}

public sealed record RequestHealthSnapshot(long Requests5m, double ErrorRate5m);

public sealed class RequestHealthWindowMiddleware(RequestDelegate next, RequestHealthWindow window)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        finally
        {
            window.Record(context.Response.StatusCode);
        }
    }
}
