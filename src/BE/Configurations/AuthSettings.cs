namespace SirLocked.Api.Configurations;

public sealed class AuthSettings
{
    /// <summary>
    /// Development-only convenience so API smoke tests can register players and play a full match
    /// without an inbox. Resolved once at startup by <see cref="ResolveAutoVerifyRegistrations"/>,
    /// which ignores the setting outside Development, so a deployed environment cannot turn it on.
    /// </summary>
    public bool AutoVerifyRegistrations { get; set; }

    public static bool ResolveAutoVerifyRegistrations(IConfiguration configuration, IHostEnvironment environment)
    {
        if (!environment.IsDevelopment())
        {
            return false;
        }

        static bool Flag(IConfiguration configuration, string key) =>
            bool.TryParse(configuration[key], out var enabled) && enabled;

        return Flag(configuration, "Auth:AutoVerifyRegistrations")
               || Flag(configuration, "AUTH_AUTO_VERIFY_REGISTRATIONS");
    }
}
