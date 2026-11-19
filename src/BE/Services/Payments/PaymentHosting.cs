using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.Models.Payments;

namespace SirLocked.Api.Services.Payments;

public static class PaymentHosting
{
    public static IServiceCollection AddPayments(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<PayOsSettings>().Configure(settings =>
            {
                // ConfigurationBinder appends to initialized lists. Explicit packages replace the examples.
                if (configuration.GetSection("PayOS:Packages").Exists()) settings.Packages.Clear();
                configuration.GetSection("PayOS").Bind(settings);
            })
            .Validate(s => s.IsValid(), "PayOS requires credentials, an HTTPS frontend origin (HTTP loopback for development), valid packages and expiry.")
            .ValidateOnStart();
        services.AddHttpClient<IPayOsClient, PayOsClient>(client => client.Timeout = TimeSpan.FromSeconds(20))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false }).RemoveAllLoggers();
        services.AddScoped<PaymentService>();
        services.AddHostedService<PaymentRecoveryWorker>();
        return services;
    }
}

public sealed class PaymentRecoveryWorker(IServiceScopeFactory scopes, ILogger<PaymentRecoveryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        var indexed = false;
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var payments = scope.ServiceProvider.GetRequiredService<PaymentService>();
                if (!payments.Enabled) continue;
                if (!indexed)
                {
                    await payments.Orders.Indexes.CreateManyAsync([
                        new CreateIndexModel<PaymentOrder>(Builders<PaymentOrder>.IndexKeys.Ascending(o => o.UserId).Descending(o => o.CreatedAt)),
                        new CreateIndexModel<PaymentOrder>(Builders<PaymentOrder>.IndexKeys.Ascending(o => o.Status).Ascending(o => o.NextCheckAt))
                    ], stoppingToken);
                    indexed = true;
                }
                await payments.RecoverAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e) { logger.LogError("Payment recovery sweep failed ({Type}).", e.GetType().Name); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
