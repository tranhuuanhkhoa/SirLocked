namespace SirLocked.Api.Configurations;

public sealed class CorsSettings
{
    public string[] AllowedOrigins { get; set; } =
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173"
    ];
}
