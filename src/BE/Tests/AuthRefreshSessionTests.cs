using SirLocked.Api.DTOs;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using Xunit;

namespace SirLocked.Tests;

public sealed class AuthRefreshSessionTests
{
    private static readonly DateTime Now = new(2026, 9, 27, 0, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(null)]
    [InlineData(-1)]
    [InlineData(0)]
    public void MissingOrExpiredSessionCannotBeRefreshed(int? expiryOffsetSeconds)
    {
        var user = new User
        {
            RefreshTokenExpiry = expiryOffsetSeconds is int offset ? Now.AddSeconds(offset) : null
        };

        var error = Assert.Throws<ApiException>(() => AuthService.EnsureRefreshSessionIsActive(user, Now));

        Assert.Equal(401, error.StatusCode);
    }

    [Theory]
    [InlineData(UserStatus.Locked)]
    [InlineData(UserStatus.Deleted)]
    public void InactiveAccountCannotRefreshAnUnexpiredSession(string status)
    {
        var user = new User { Status = status, RefreshTokenExpiry = Now.AddDays(1) };

        var error = Assert.Throws<ApiException>(() => AuthService.EnsureRefreshSessionIsActive(user, Now));

        Assert.Equal(403, error.StatusCode);
    }

    [Fact]
    public void ActiveUnexpiredSessionPassesValidation() =>
        AuthService.EnsureRefreshSessionIsActive(new User { RefreshTokenExpiry = Now.AddSeconds(1) }, Now);
}
