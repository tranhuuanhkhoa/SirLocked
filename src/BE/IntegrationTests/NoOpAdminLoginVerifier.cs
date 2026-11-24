using SirLocked.Api.Models;
using SirLocked.Api.Services.Security;

namespace SirLocked.IntegrationTests;

internal sealed class NoOpAdminLoginVerifier : IAdminLoginVerifier
{
    public Task VerifyLoginAsync(User user, string? code, CancellationToken ct = default) => Task.CompletedTask;
}
