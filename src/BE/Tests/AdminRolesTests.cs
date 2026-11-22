using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.DTOs;
using Xunit;

namespace SirLocked.Api.Tests;

public sealed class AdminRolesTests
{
    [Theory]
    [InlineData(AdminRoles.Content, AdminRoles.ContentPermission)]
    [InlineData(AdminRoles.Finance, AdminRoles.EconomyPermission)]
    [InlineData(AdminRoles.Finance, AdminRoles.AuditPermission)]
    [InlineData(AdminRoles.Support, AdminRoles.PlayersPermission)]
    [InlineData(AdminRoles.Support, AdminRoles.ModerationPermission)]
    [InlineData(AdminRoles.Moderator, AdminRoles.ModerationPermission)]
    public void GrantsThePermissionMatrix(string role, string permission) =>
        Assert.True(AdminRoles.HasPermission(role, permission));

    [Theory]
    [InlineData(AdminRoles.Content, AdminRoles.EconomyPermission)]
    [InlineData(AdminRoles.Finance, AdminRoles.PlayersPermission)]
    [InlineData(AdminRoles.Support, AdminRoles.AuditPermission)]
    [InlineData(AdminRoles.Moderator, AdminRoles.ContentPermission)]
    public void DeniesPermissionsOutsideTheRoleMatrix(string role, string permission) =>
        Assert.False(AdminRoles.HasPermission(role, permission));

    [Fact]
    public void AdminWithoutStoredRoleFallsBackToSuperAdminButNonAdminHasNoRole()
    {
        var legacyAdmin = new User { Role = UserRole.Admin };
        var player = new User { Role = UserRole.Player };

        Assert.Equal(AdminRoles.SuperAdmin, AdminRoles.Effective(legacyAdmin));
        Assert.Equal(AdminRoles.AllPermissions.OrderBy(value => value), AdminRoles.PermissionsFor(legacyAdmin).OrderBy(value => value));
        Assert.Null(AdminRoles.Effective(player));
        Assert.Empty(AdminRoles.PermissionsFor(player));
    }

    [Fact]
    public void LastEffectiveSuperAdminCannotBeDemoted()
    {
        var error = Assert.Throws<ApiException>(() => AdminRoleRules.ValidateLastSuperAdminDemotion(1));
        Assert.Equal(409, error.StatusCode);
        Assert.Equal("LAST_SUPER_ADMIN", Assert.IsType<ApiErrorDetails>(error.Errors).Code);
        AdminRoleRules.ValidateLastSuperAdminDemotion(2);
    }
}
