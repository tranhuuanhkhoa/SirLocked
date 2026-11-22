using System.Diagnostics.Metrics;

namespace SirLocked.Api.Services.Observability;

public static class SirLockedTelemetry
{
    public static readonly Meter Meter = new("SirLocked");
    public static readonly UpDownCounter<long> SignalRConnections =
        Meter.CreateUpDownCounter<long>("sirlocked.signalr.connections");
    public static readonly Counter<long> ServerErrors =
        Meter.CreateCounter<long>("sirlocked.http.server_errors");
    public static readonly Counter<long> WorkerFailures =
        Meter.CreateCounter<long>("sirlocked.worker.failures");

    public static void RecordWorkerFailure(string worker) =>
        WorkerFailures.Add(1, new KeyValuePair<string, object?>("worker", worker));
}
