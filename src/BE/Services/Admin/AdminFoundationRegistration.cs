namespace SirLocked.Api.Services.Admin;

public static class AdminFoundationRegistration
{
    /// <summary>What every admin area shares: the audit log and picture uploads.</summary>
    public static IServiceCollection AddAdminFoundation(this IServiceCollection services)
    {
        services.AddSingleton<IAdminAudit, AdminAuditService>();
        services.AddHttpClient<IAdminAssetStorage, CloudinaryAdminAssetStorage>(client => client.Timeout = TimeSpan.FromSeconds(60));
        services.AddScoped<AdminAssetService>();
        return services;
    }
}
