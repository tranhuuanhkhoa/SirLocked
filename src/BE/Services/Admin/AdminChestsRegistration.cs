namespace SirLocked.Api.Services.Admin;

public static class AdminChestsRegistration
{
    /// <summary>Services of the Chests and items admin area (ADMIN-1). Register them here, not in Program.cs.</summary>
    public static IServiceCollection AddAdminChests(this IServiceCollection services)
    {
        services.AddSingleton<AdminChestsStore>();
        services.AddHostedService<AdminChestsIndexWorker>();
        services.AddScoped<AdminChestsItemService>();
        services.AddScoped<AdminChestsChestService>();
        services.AddScoped<AdminChestStylesService>();
        services.AddScoped<AdminChestsStatsService>();
        return services;
    }
}
