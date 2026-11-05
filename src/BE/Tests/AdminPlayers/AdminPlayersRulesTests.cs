using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Market;
using SirLocked.Api.WebAPI.Controllers;
using Xunit;

namespace SirLocked.Tests.AdminPlayers;

public class AdminPlayersRulesTests
{
    private static string Code(ApiException exception) => ((ApiErrorDetails)exception.Errors!).Code;

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ab")]
    public void AReasonIsRequired(string? reason)
    {
        var error = Assert.Throws<ApiException>(() => AdminPlayersRules.NormalizeReason(reason));
        Assert.Equal(400, error.StatusCode);
        Assert.Equal(AdminPlayerErrors.ReasonRequired, Code(error));
    }

    [Fact]
    public void AReasonIsTrimmedAndCapped()
    {
        Assert.Equal("Vi phạm quy định", AdminPlayersRules.NormalizeReason("  Vi phạm quy định "));
        var error = Assert.Throws<ApiException>(() => AdminPlayersRules.NormalizeReason(new string('x', AdminPlayersRules.MaxReasonLength + 1)));
        Assert.Equal(AdminPlayerErrors.ReasonRequired, Code(error));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(AdminPlayersRules.MaxCoinAdjustment + 1)]
    [InlineData(-AdminPlayersRules.MaxCoinAdjustment - 1)]
    public void ACoinAdjustmentMustBeNonZeroAndBounded(long amount)
    {
        var error = Assert.Throws<ApiException>(() => AdminPlayersRules.ValidateCoinAmount(amount));
        Assert.Equal(AdminPlayerErrors.CoinsInvalid, Code(error));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(-1)]
    [InlineData(AdminPlayersRules.MaxCoinAdjustment)]
    [InlineData(-AdminPlayersRules.MaxCoinAdjustment)]
    public void ACoinAdjustmentInsideTheLimitsIsAccepted(long amount) => AdminPlayersRules.ValidateCoinAmount(amount);

    [Theory]
    [InlineData(0, 0)]
    [InlineData(ProgressRules.MaxLevel + 1, 0)]
    [InlineData(1, -1)]
    [InlineData(1, 200)] // Level 1 needs 200 XP, so 200 would already be level 2.
    [InlineData(ProgressRules.MaxLevel, 1)] // The bar stays empty at the cap.
    public void ProgressOutsideTheCurveIsRefused(int level, int xp)
    {
        var error = Assert.Throws<ApiException>(() => AdminPlayersRules.ValidateProgress(level, xp));
        Assert.Equal(AdminPlayerErrors.ProgressInvalid, Code(error));
    }

    [Theory]
    [InlineData(1, 0)]
    [InlineData(1, 199)]
    [InlineData(10, 0)]
    [InlineData(ProgressRules.MaxLevel, 0)]
    public void ProgressOnTheCurveIsAccepted(int level, int xp) => AdminPlayersRules.ValidateProgress(level, xp);

    [Theory]
    [InlineData("short")]
    [InlineData("has spaces in it")]
    [InlineData(null)]
    public void AnOperationNeedsAWellFormedKey(string? key)
    {
        var error = Assert.Throws<ApiException>(() => AdminPlayersRules.OperationId("admin", key));
        Assert.Equal(MarketErrors.InvalidRequestId, Code(error));
    }

    [Fact]
    public void TheSameKeyFromTwoAdminsIsTwoOperations() =>
        Assert.NotEqual(AdminPlayersRules.OperationId("a", "same-key-123"), AdminPlayersRules.OperationId("b", "same-key-123"));

    [Theory]
    [InlineData(0, 0, 1, AdminPlayersRules.DefaultPageSize)]
    [InlineData(-3, 5000, 1, AdminPlayersRules.MaxPageSize)]
    [InlineData(4, 10, 4, 10)]
    public void PagingIsClamped(int page, int size, int expectedPage, int expectedSize)
    {
        var (resultPage, resultSize) = AdminPlayersRules.Paging(page, size);
        Assert.Equal(expectedPage, resultPage);
        Assert.Equal(expectedSize, resultSize);
    }

    [Fact]
    public void RewardsAboveALevelAreWhatADowngradeKeeps()
    {
        var rewards = new[] { new LevelReward(5, "a"), new LevelReward(10, "b"), new LevelReward(20, "c") };
        Assert.Equal(new[] { "b", "c" }, AdminPlayersRules.RewardsAbove(5, rewards, new[] { "a", "b", "c", "d" }));
        Assert.Equal(new[] { "c" }, AdminPlayersRules.RewardsAbove(5, rewards, new[] { "a", "c" }));
        Assert.Empty(AdminPlayersRules.RewardsAbove(20, rewards, new[] { "a", "b", "c" }));
    }

    // ------------------------------------------------------------------ the surface

    public static IEnumerable<object[]> AdminControllers() => new[]
    {
        new object[] { typeof(AdminPlayersController) },
        new object[] { typeof(AdminEconomyController) },
        new object[] { typeof(AdminRoomsController) },
        new object[] { typeof(AdminReviewsController) },
    };

    [Theory]
    [MemberData(nameof(AdminControllers))]
    public void EveryNewControllerIsAdminOnly(Type controller)
    {
        var authorize = controller.GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single();
        Assert.Equal(UserRole.Admin, authorize.Roles);
        // Nothing opens a door the controller closed.
        var open = controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(method => method.GetCustomAttributes(typeof(AllowAnonymousAttribute), true).Length > 0)
            .Select(method => method.Name);
        Assert.Empty(open);
        Assert.StartsWith("api/admin/", controller.GetCustomAttribute<RouteAttribute>()!.Template);
    }

    private static readonly string[] Secrets =
    [
        "PasswordHash", "RefreshToken", "RefreshTokenHash", "ResetPasswordToken", "ResetPasswordTokenHash",
        "EmailVerificationToken", "EmailVerificationTokenHash",
    ];

    [Fact]
    public void NoAdminDtoCarriesASecret()
    {
        var dtos = typeof(AdminPlayerRowDto).Assembly.GetTypes()
            .Where(type => type.Namespace == typeof(AdminPlayerRowDto).Namespace)
            .ToList();
        Assert.Contains(typeof(AdminPlayerDetailDto), dtos);
        Assert.Contains(typeof(AdminEconomyOverviewDto), dtos);
        var leaks = dtos.SelectMany(type => type.GetProperties().Where(property =>
                Secrets.Contains(property.Name, StringComparer.OrdinalIgnoreCase)
                || property.Name.Contains("token", StringComparison.OrdinalIgnoreCase)
                || property.Name.Contains("password", StringComparison.OrdinalIgnoreCase))
            .Select(property => $"{type.Name}.{property.Name}"))
            // Whether a password exists is not the password.
            .Where(name => !name.EndsWith(".HasPassword", StringComparison.Ordinal))
            .ToList();
        Assert.Empty(leaks);
    }
}
