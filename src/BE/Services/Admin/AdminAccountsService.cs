using MongoDB.Bson;
using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Services.Admin;

/// <summary>
/// Creating, editing, deleting and restoring accounts from /admin/players, by the same rules as signing up: players and
/// VIPs on the "Người chơi" tab, admins on the "Quản trị" tab. Deleting is soft: the account is marked DELETED, signed
/// out everywhere and left out of the lists unless asked for; its coins, items and history stay, so it can be restored.
/// An admin cannot delete their own account, nor the last active admin, so the admin pages always keep someone.
/// Every change needs a reason and goes to the audit log (never with a password or a hash).
/// Admin accounts are made and changed only by an admin with the roles permission (SUPER_ADMIN): otherwise a SUPPORT
/// admin could create a SUPER_ADMIN (a new admin has no AdminRole, which counts as SUPER_ADMIN) or take one over by
/// setting its email or password. The last active SUPER_ADMIN is never deleted.
/// </summary>
public sealed class AdminAccountsService
{
    private readonly MongoDbContext _db;
    private readonly IAdminAudit _audit;
    private readonly TimeProvider _time;

    public AdminAccountsService(MongoDbContext db, IAdminAudit audit, TimeProvider? time = null)
    {
        _db = db;
        _audit = audit;
        _time = time ?? TimeProvider.System;
    }

    private DateTime Now => _time.GetUtcNow().UtcDateTime;

    public async Task<AdminAccountDto> CreateAsync(CurrentUser admin, AdminCreateAccountRequest request, CancellationToken ct = default)
    {
        var reason = AdminPlayersRules.NormalizeReason(request.Reason);
        var role = string.IsNullOrWhiteSpace(request.Role) ? UserRole.Player : request.Role.Trim().ToUpperInvariant();
        if (role is not (UserRole.Player or UserRole.Vip or UserRole.Admin))
            throw AdminPlayersRules.Error(400, AdminPlayerErrors.AccountInvalid, "Vai trò chỉ được là Người chơi, VIP hoặc Quản trị.");
        if (role == UserRole.Admin) RequireRolesPermission(admin);
        ThrowIfInvalid(AuthValidator.AccountErrors(request.FullName, request.Email, request.NewPassword));
        var email = NormalizeEmail(request.Email!);
        if (await EmailTakenAsync(email, null, ct)) throw EmailTaken();

        var now = Now;
        var user = new User
        {
            Id = ObjectId.GenerateNewId().ToString(),
            FullName = request.FullName!.Trim(),
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword),
            Role = role,
            Status = UserStatus.Active,
            // An admin vouches for the address, so the player can sign in at once.
            IsEmailVerified = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        try
        {
            await _db.Users.InsertOneAsync(user, cancellationToken: ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            throw EmailTaken();
        }
        await _audit.LogAsync(admin, AdminAccountActions.Create, "user", user.Id, null, Snapshot(user), reason, ct);
        return Dto(user);
    }

    public async Task<AdminAccountDto> UpdateAsync(CurrentUser admin, string userId, AdminUpdateAccountRequest request, CancellationToken ct = default)
    {
        var reason = AdminPlayersRules.NormalizeReason(request.Reason);
        var user = await RequireEditableAsync(userId, ct);
        RequireRolesPermissionFor(admin, user);
        ThrowIfInvalid(AuthValidator.AccountErrors(request.FullName, request.Email, null, checkPassword: false));
        var fullName = request.FullName!.Trim();
        var email = NormalizeEmail(request.Email!);
        var emailChanged = !string.Equals(email, user.Email, StringComparison.Ordinal);
        if (fullName == user.FullName && !emailChanged)
            throw AdminPlayersRules.Error(400, AdminPlayerErrors.AccountUnchanged, "Tên và email vẫn như cũ.");
        if (emailChanged && await EmailTakenAsync(email, user.Id, ct)) throw EmailTaken();

        var update = Builders<User>.Update
            .Set(u => u.FullName, fullName)
            .Set(u => u.Email, email)
            .Set(u => u.UpdatedAt, Now);
        if (emailChanged)
        {
            // The new address is the admin's word; a reset or verification link sent to the old one must stop working.
            update = update
                .Set(u => u.IsEmailVerified, true)
                .Set(u => u.EmailVerificationToken, null)
                .Set(u => u.EmailVerificationTokenHash, null)
                .Set(u => u.EmailVerificationTokenExpiry, null)
                .Set(u => u.ResetPasswordToken, null)
                .Set(u => u.ResetPasswordTokenHash, null)
                .Set(u => u.ResetPasswordTokenExpiry, null);
        }
        try
        {
            await ApplyAsync(user, update, ct);
        }
        catch (MongoWriteException exception) when (exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            throw EmailTaken();
        }
        var before = new { fullName = user.FullName, email = user.Email };
        user.FullName = fullName;
        user.Email = email;
        if (emailChanged) user.IsEmailVerified = true;
        await _audit.LogAsync(admin, AdminAccountActions.Edit, "user", user.Id, before, new { fullName, email }, reason, ct);
        return Dto(user);
    }

    /// <summary>Sets a new password and signs the player out everywhere; any reset link already sent stops working.</summary>
    public async Task<AdminAccountDto> SetPasswordAsync(CurrentUser admin, string userId, AdminSetPasswordRequest request, CancellationToken ct = default)
    {
        var reason = AdminPlayersRules.NormalizeReason(request.Reason);
        var user = await RequireEditableAsync(userId, ct);
        RequireRolesPermissionFor(admin, user);
        ThrowIfInvalid(AuthValidator.AccountErrors(null, null, request.NewPassword, checkIdentity: false));
        var update = SignOut(Builders<User>.Update
            .Set(u => u.PasswordHash, BCrypt.Net.BCrypt.HashPassword(request.NewPassword))
            .Set(u => u.ResetPasswordToken, null)
            .Set(u => u.ResetPasswordTokenHash, null)
            .Set(u => u.ResetPasswordTokenExpiry, null));
        await ApplyAsync(user, update, ct);
        await _audit.LogAsync(admin, AdminAccountActions.Password, "user", user.Id, null, new { passwordChanged = true, signedOut = true }, reason, ct);
        return Dto(user);
    }

    public async Task<AdminAccountDto> DeleteAsync(CurrentUser admin, string userId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var user = await RequireEditableAsync(userId, ct);
        RequireRolesPermissionFor(admin, user);
        if (user.Role == UserRole.Admin)
        {
            if (user.Id == admin.Id)
                throw AdminPlayersRules.Error(409, AdminPlayerErrors.SelfAction, "Không tự xóa tài khoản quản trị của chính mình được.");
            var otherAdmins = await _db.Users.CountDocumentsAsync(
                u => u.Role == UserRole.Admin && u.Status == UserStatus.Active && u.Id != user.Id, cancellationToken: ct);
            if (otherAdmins == 0)
                throw AdminPlayersRules.Error(409, AdminPlayerErrors.LastAdmin, "Đây là tài khoản quản trị cuối cùng còn hoạt động, không xóa được.");
            if (AdminRoles.Effective(user) == AdminRoles.SuperAdmin)
            {
                // No AdminRole counts as SUPER_ADMIN (accounts from before admin roles).
                var otherSuperAdmins = await _db.Users.CountDocumentsAsync(
                    u => u.Role == UserRole.Admin && u.Status == UserStatus.Active && u.Id != user.Id
                         && (u.AdminRole == null || u.AdminRole == AdminRoles.SuperAdmin), cancellationToken: ct);
                AdminRoleRules.ValidateLastSuperAdminDemotion(otherSuperAdmins + 1);
            }
        }
        var result = await _db.Users.UpdateOneAsync(
            u => u.Id == user.Id && u.Status != UserStatus.Deleted,
            SignOut(Builders<User>.Update.Set(u => u.Status, UserStatus.Deleted)),
            cancellationToken: ct);
        if (result.ModifiedCount == 0) throw Changed();
        var before = new { status = user.Status };
        user.Status = UserStatus.Deleted;
        await _audit.LogAsync(admin, AdminAccountActions.Delete, "user", user.Id, before, new { status = user.Status }, note, ct);
        return Dto(user);
    }

    /// <summary>Brings a deleted account back as active; the player signs in with the password they had.</summary>
    public async Task<AdminAccountDto> RestoreAsync(CurrentUser admin, string userId, string? reason, CancellationToken ct = default)
    {
        var note = AdminPlayersRules.NormalizeReason(reason);
        var user = await FindAsync(userId, ct)
            ?? throw AdminPlayersRules.Error(404, AdminPlayerErrors.PlayerNotFound, "Không tìm thấy người chơi này.");
        RequireRolesPermissionFor(admin, user);
        if (user.Status != UserStatus.Deleted)
            throw AdminPlayersRules.Error(409, AdminPlayerErrors.AccountNotDeleted, "Tài khoản này chưa bị xóa.");
        var result = await _db.Users.UpdateOneAsync(
            u => u.Id == user.Id && u.Status == UserStatus.Deleted,
            Builders<User>.Update
                .Set(u => u.Status, UserStatus.Active)
                .Inc(u => u.AuthorizationVersion, 1)
                .Set(u => u.UpdatedAt, Now),
            cancellationToken: ct);
        if (result.ModifiedCount == 0) throw Changed();
        user.Status = UserStatus.Active;
        await _audit.LogAsync(admin, AdminAccountActions.Restore, "user", user.Id, new { status = UserStatus.Deleted }, new { status = user.Status }, note, ct);
        return Dto(user);
    }

    // ------------------------------------------------------------------ helpers

    private static void RequireRolesPermission(CurrentUser admin)
    {
        if (!AdminRoles.HasPermission(admin.AdminRole ?? AdminRoles.SuperAdmin, AdminRoles.RolesPermission))
            throw AdminPlayersRules.Error(403, AdminPlayerErrors.AdminAccountsForbidden,
                "Chỉ quản trị viên SUPER_ADMIN mới tạo hoặc sửa được tài khoản quản trị.");
    }

    private static void RequireRolesPermissionFor(CurrentUser admin, User target)
    {
        if (target.Role == UserRole.Admin) RequireRolesPermission(admin);
    }

    private Task<User?> FindAsync(string userId, CancellationToken ct) =>
        ObjectId.TryParse(userId, out _)
            ? _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync(ct)!
            : Task.FromResult<User?>(null);

    /// <summary>A live account: a deleted one must be restored first.</summary>
    private async Task<User> RequireEditableAsync(string userId, CancellationToken ct)
    {
        var user = await FindAsync(userId, ct);
        if (user is null || user.Status == UserStatus.Deleted)
            throw AdminPlayersRules.Error(404, AdminPlayerErrors.PlayerNotFound, "Không tìm thấy tài khoản này (hoặc tài khoản đã bị xóa).");
        return user;
    }

    /// <summary>Writes only if the account is still live and has the role it had when read.</summary>
    private async Task ApplyAsync(User user, UpdateDefinition<User> update, CancellationToken ct)
    {
        var result = await _db.Users.UpdateOneAsync(
            u => u.Id == user.Id && u.Status != UserStatus.Deleted && u.Role == user.Role,
            update, cancellationToken: ct);
        if (result.MatchedCount == 0) throw Changed();
    }

    /// <summary>Every session ends: issued tokens fail the authorization-version check and the refresh token is gone.</summary>
    private UpdateDefinition<User> SignOut(UpdateDefinition<User> update) => update
        .Inc(u => u.AuthorizationVersion, 1)
        .Set(u => u.RefreshToken, null)
        .Set(u => u.RefreshTokenHash, null)
        .Set(u => u.RefreshTokenExpiry, null)
        .Set(u => u.UpdatedAt, Now);

    private async Task<bool> EmailTakenAsync(string email, string? exceptUserId, CancellationToken ct) =>
        await _db.Users.CountDocumentsAsync(u => u.Email == email && u.Id != exceptUserId, cancellationToken: ct) > 0;

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static void ThrowIfInvalid(Dictionary<string, string[]> errors)
    {
        if (errors.Count == 0) return;
        throw AdminPlayersRules.Error(400, AdminPlayerErrors.AccountInvalid, string.Join(" ", errors.Values.SelectMany(messages => messages)));
    }

    private static ApiException EmailTaken() =>
        AdminPlayersRules.Error(409, AdminPlayerErrors.EmailTaken, "Email này đã có tài khoản (kể cả tài khoản đã xóa). Hãy dùng email khác, hoặc khôi phục tài khoản cũ.");

    private static ApiException Changed() =>
        AdminPlayersRules.Error(409, AdminPlayerErrors.AccountChanged, "Tài khoản vừa thay đổi. Hãy tải lại trang rồi thử lại.");

    private static object Snapshot(User user) => new { fullName = user.FullName, email = user.Email, role = user.Role, status = user.Status };

    private static AdminAccountDto Dto(User user) =>
        new(user.Id, user.FullName, user.Email, user.Role, user.Status, user.IsEmailVerified, user.CreatedAt);
}

/// <summary>What these changes are called in the audit log.</summary>
public static class AdminAccountActions
{
    public const string Create = "player.create";
    public const string Edit = "player.edit";
    public const string Password = "player.password";
    public const string Delete = "player.delete";
    public const string Restore = "player.restore";
}
