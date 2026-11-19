namespace SirLocked.Api.Services.Admin;

public static class AdminCosmeticsRegistration
{
    /// <summary>Services of the Cosmetics admin area (ADMIN-2). Register them here, not in Program.cs.</summary>
    public static IServiceCollection AddAdminCosmetics(this IServiceCollection services)
    {
        services.AddSingleton<ICosmeticDefaults, CosmeticDefaultsStore>();
        services.AddScoped<AdminCosmeticsService>();
        return services;
    }
}
