using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using Xunit;

namespace SirLocked.IntegrationTests.AdminPlayers;

/// <summary>
/// Accounts made and changed by an admin on /admin/players: create, edit, new password, soft delete and restore.
/// Opt-in: SIRLOCKED_RUN_MONGO_IT=true.
/// </summary>
public sealed class MongoAdminAccountsTests
{
    private static readonly CurrentUser Admin = AdminPlayersEnv.Admin;
    private const string Reason = "Tài khoản thử nghiệm";

    private static bool Enabled => string.Equals(
        Environment.GetEnvironmentVariable("SIRLOCKED_RUN_MONGO_IT"), "true", StringComparison.OrdinalIgnoreCase);

    private static string Code(ApiException error) => ((ApiErrorDetails)error.Errors!).Code;

    private static AdminCreateAccountRequest NewAccount(string email = "  Tester.One@Example.com ", string password = "matkhau123", string? role = null) =>
        new() { FullName = "  Thám tử Thử  ", Email = email, NewPassword = password, Role = role, Reason = Reason };

    private static async Task<User> UserAsync(AdminPlayersEnv env, string id) => await env.Db.Users.Find(u => u.Id == id).FirstAsync();

    [Fact]
    public async Task Create_MakesAVerifiedPlayerWhoCanSignIn_AndAuditsWithoutThePassword()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();

        var created = await env.Accounts.CreateAsync(Admin, NewAccount(role: "vip"));

        Assert.Equal("Thám tử Thử", created.FullName);
        Assert.Equal("tester.one@example.com", created.Email);
        Assert.Equal(UserRole.Vip, created.Role);
        Assert.Equal(UserStatus.Active, created.Status);
        Assert.True(created.IsEmailVerified);
        var user = await UserAsync(env, created.UserId);
        Assert.True(BCrypt.Net.BCrypt.Verify("matkhau123", user.PasswordHash));
        var entry = Assert.Single(await env.AuditEntriesAsync(AdminAccountActions.Create));
        Assert.Equal(created.UserId, entry.TargetId);
        Assert.Equal(Reason, entry.Reason);
        Assert.DoesNotContain("matkhau123", entry.After ?? string.Empty);
        Assert.DoesNotContain(user.PasswordHash, entry.After ?? string.Empty);
        // A new account is a player like any other in the list.
        var list = await env.Players.ListAsync(new AdminPlayerQuery("tester.one", null, null, null, false, 1, 25));
        Assert.Equal(created.UserId, Assert.Single(list.Items).UserId);
    }

    [Fact]
    public async Task Create_RefusesATakenEmail_AWeakPassword_AnAdminRole_AndAMissingReason()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        await env.AddUserAsync(email: "taken@example.com");

        Assert.Equal(AdminPlayerErrors.EmailTaken, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.CreateAsync(Admin, NewAccount("TAKEN@example.com")))));
        var weak = await Assert.ThrowsAsync<ApiException>(() => env.Accounts.CreateAsync(Admin, NewAccount(password: "abcdef")));
        Assert.Equal(AdminPlayerErrors.AccountInvalid, Code(weak));
        Assert.Contains("chữ số", weak.Message);
        Assert.Equal(AdminPlayerErrors.AccountInvalid, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.CreateAsync(Admin, NewAccount(role: UserRole.Admin)))));
        Assert.Equal(AdminPlayerErrors.AccountInvalid, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.CreateAsync(Admin, NewAccount("not-an-email")))));
        var noReason = NewAccount();
        noReason.Reason = " ";
        Assert.Equal(AdminPlayerErrors.ReasonRequired, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.CreateAsync(Admin, noReason))));
        Assert.Equal(1, await env.Db.Users.CountDocumentsAsync(FilterDefinition<User>.Empty));
    }

    [Fact]
    public async Task Update_ChangesNameAndEmail_AndAnOldResetLinkStopsWorking()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var player = await env.AddUserAsync("Cũ", email: "old@example.com", verified: false);
        await env.AddUserAsync(email: "other@example.com");

        Assert.Equal(AdminPlayerErrors.EmailTaken, Code(await Assert.ThrowsAsync<ApiException>(() =>
            env.Accounts.UpdateAsync(Admin, player.Id, new AdminUpdateAccountRequest { FullName = "Mới", Email = "Other@example.com", Reason = Reason }))));
        Assert.Equal(AdminPlayerErrors.AccountUnchanged, Code(await Assert.ThrowsAsync<ApiException>(() =>
            env.Accounts.UpdateAsync(Admin, player.Id, new AdminUpdateAccountRequest { FullName = "Cũ", Email = "OLD@example.com", Reason = Reason }))));

        var updated = await env.Accounts.UpdateAsync(Admin, player.Id, new AdminUpdateAccountRequest { FullName = " Mới ", Email = "New@Example.com", Reason = Reason });

        Assert.Equal("Mới", updated.FullName);
        Assert.Equal("new@example.com", updated.Email);
        var user = await UserAsync(env, player.Id);
        Assert.True(user.IsEmailVerified);
        Assert.Null(user.ResetPasswordTokenHash);
        Assert.Null(user.EmailVerificationTokenHash);
        // The password is untouched by an edit.
        Assert.Equal("SECRET-password-hash", user.PasswordHash);
        var entry = Assert.Single(await env.AuditEntriesAsync(AdminAccountActions.Edit));
        Assert.Contains("old@example.com", entry.Before ?? string.Empty);
        Assert.Contains("new@example.com", entry.After ?? string.Empty);
    }

    [Fact]
    public async Task SetPassword_ReplacesTheHash_AndSignsThePlayerOutEverywhere()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var player = await env.AddUserAsync();
        var version = (await UserAsync(env, player.Id)).AuthorizationVersion;

        Assert.Equal(AdminPlayerErrors.AccountInvalid, Code(await Assert.ThrowsAsync<ApiException>(() =>
            env.Accounts.SetPasswordAsync(Admin, player.Id, new AdminSetPasswordRequest { NewPassword = "12345678", Reason = Reason }))));
        await env.Accounts.SetPasswordAsync(Admin, player.Id, new AdminSetPasswordRequest { NewPassword = "moi2026ok", Reason = Reason });

        var user = await UserAsync(env, player.Id);
        Assert.True(BCrypt.Net.BCrypt.Verify("moi2026ok", user.PasswordHash));
        Assert.Equal(version + 1, user.AuthorizationVersion);
        Assert.Null(user.RefreshTokenHash);
        Assert.Null(user.ResetPasswordTokenHash);
        var entry = Assert.Single(await env.AuditEntriesAsync(AdminAccountActions.Password));
        Assert.DoesNotContain("moi2026ok", entry.After ?? string.Empty);
    }

    [Fact]
    public async Task Delete_HidesTheAccountAndSignsItOut_KeepsItsData_AndRestoreBringsItBack()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var player = await env.AddUserAsync("Sẽ xóa", email: "gone@example.com");
        var balance = (await env.AccountAsync(player.Id)).Balance;

        var deleted = await env.Accounts.DeleteAsync(Admin, player.Id, Reason);

        Assert.Equal(UserStatus.Deleted, deleted.Status);
        var user = await UserAsync(env, player.Id);
        Assert.Equal(UserStatus.Deleted, user.Status);
        Assert.Null(user.RefreshTokenHash);
        Assert.Equal(balance, (await env.AccountAsync(player.Id)).Balance);
        // Out of the list and every other filter, listed only under "deleted"; the detail page still opens.
        Assert.Empty((await env.Players.ListAsync(new AdminPlayerQuery("gone@", null, null, null, false, 1, 25))).Items);
        Assert.Empty((await env.Players.ListAsync(new AdminPlayerQuery("gone@", null, AdminPlayerStatusFilter.Unverified, null, false, 1, 25))).Items);
        Assert.Single((await env.Players.ListAsync(new AdminPlayerQuery("gone@", null, AdminPlayerStatusFilter.Deleted, null, false, 1, 25))).Items);
        Assert.Equal(UserStatus.Deleted, (await env.Players.GetDetailAsync(player.Id)).Account.Status);
        // A deleted account takes no more changes, and its email stays taken.
        Assert.Equal(AdminPlayerErrors.PlayerNotFound, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.DeleteAsync(Admin, player.Id, Reason))));
        Assert.Equal(AdminPlayerErrors.PlayerNotFound, Code(await Assert.ThrowsAsync<ApiException>(() =>
            env.Accounts.SetPasswordAsync(Admin, player.Id, new AdminSetPasswordRequest { NewPassword = "abc12345", Reason = Reason }))));
        Assert.Equal(AdminPlayerErrors.EmailTaken, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.CreateAsync(Admin, NewAccount("gone@example.com")))));

        var restored = await env.Accounts.RestoreAsync(Admin, player.Id, Reason);

        Assert.Equal(UserStatus.Active, restored.Status);
        Assert.Single((await env.Players.ListAsync(new AdminPlayerQuery("gone@", null, null, null, false, 1, 25))).Items);
        Assert.Equal(AdminPlayerErrors.AccountNotDeleted, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.RestoreAsync(Admin, player.Id, Reason))));
        Assert.Single(await env.AuditEntriesAsync(AdminAccountActions.Delete));
        Assert.Single(await env.AuditEntriesAsync(AdminAccountActions.Restore));
    }

    [Fact]
    public async Task AnAdminAccount_IsNeitherEditedNorDeletedHere()
    {
        if (!Enabled) return;
        await using var env = await AdminPlayersEnv.CreateAsync();
        var other = await env.AddUserAsync("Quản trị khác", role: UserRole.Admin);

        Assert.Equal(AdminPlayerErrors.AdminAccount, Code(await Assert.ThrowsAsync<ApiException>(() => env.Accounts.DeleteAsync(Admin, other.Id, Reason))));
        Assert.Equal(AdminPlayerErrors.AdminAccount, Code(await Assert.ThrowsAsync<ApiException>(() =>
            env.Accounts.SetPasswordAsync(Admin, other.Id, new AdminSetPasswordRequest { NewPassword = "abc12345", Reason = Reason }))));
        Assert.Equal(AdminPlayerErrors.AdminAccount, Code(await Assert.ThrowsAsync<ApiException>(() =>
            env.Accounts.UpdateAsync(Admin, other.Id, new AdminUpdateAccountRequest { FullName = "Đổi", Email = "x@example.com", Reason = Reason }))));
        Assert.Equal(UserStatus.Active, (await UserAsync(env, other.Id)).Status);
    }
}
