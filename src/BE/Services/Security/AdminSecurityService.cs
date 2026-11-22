using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;

namespace SirLocked.Api.Services.Security;

public interface IAdminStepUpValidator
{
    Task<bool> HasStepUpAsync(string adminId, CancellationToken ct = default);
}

public interface IAdminLoginVerifier
{
    Task VerifyLoginAsync(User user, string? code, CancellationToken ct = default);
}

public interface IAdminSecurityOperations
{
    Task<AdminTwoFactorSetupResponse> SetupAsync(CurrentUser caller, CancellationToken ct = default);
    Task<AdminTwoFactorEnableResponse> EnableAsync(CurrentUser caller, string code, CancellationToken ct = default);
    Task DisableAsync(CurrentUser caller, string code, CancellationToken ct = default);
    Task<AdminStepUpResponse> StepUpAsync(string adminId, string? password, string? code, CancellationToken ct = default);
}

public sealed class AdminSecurityService : IAdminStepUpValidator, IAdminLoginVerifier, IAdminSecurityOperations
{
    private const string ProtectorPurpose = "SirLocked.AdminTotp.v1";
    private const string RecoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private readonly MongoDbContext _db;
    private readonly IDataProtector _protector;
    private readonly IAdminAudit _audit;
    private readonly AdminSecuritySettings _settings;
    private readonly TimeProvider _time;

    public AdminSecurityService(
        MongoDbContext db,
        IDataProtectionProvider protectionProvider,
        IAdminAudit audit,
        IOptions<AdminSecuritySettings> settings,
        TimeProvider? time = null)
    {
        _db = db;
        _protector = protectionProvider.CreateProtector(ProtectorPurpose);
        _audit = audit;
        _settings = settings.Value;
        _time = time ?? TimeProvider.System;
    }

    public async Task VerifyLoginAsync(User user, string? code, CancellationToken ct = default)
    {
        if (user.Role != UserRole.Admin || !user.TwoFactorEnabled) return;
        if (string.IsNullOrWhiteSpace(code))
            throw ApiException.Unauthorized("A two-factor code is required.", "TWO_FACTOR_REQUIRED", "auth.twoFactorRequired");
        if (!await VerifyEnabledCodeAsync(user, code, ct))
            throw ApiException.Unauthorized("The two-factor code is invalid.", "TWO_FACTOR_INVALID", "auth.twoFactorInvalid");
    }

    public async Task<AdminTwoFactorSetupResponse> SetupAsync(CurrentUser caller, CancellationToken ct = default)
    {
        var user = await FindAdminAsync(caller.Id, ct);
        if (user.TwoFactorEnabled)
            throw ApiException.Conflict("Two-factor authentication is already enabled.");

        var secret = Totp.GenerateSecret();
        var protectedSecret = _protector.Protect(secret);
        var update = Builders<User>.Update
            .Set(item => item.TwoFactorPendingSecretProtected, protectedSecret)
            .Set(item => item.UpdatedAt, _time.GetUtcNow().UtcDateTime);
        var changed = await _db.Users.UpdateOneAsync(
            item => item.Id == user.Id && item.Role == UserRole.Admin && !item.TwoFactorEnabled,
            update, cancellationToken: ct);
        if (changed.MatchedCount != 1)
            throw ApiException.Conflict("Two-factor authentication is already enabled.");
        await _audit.LogAsync(caller, "admin.2fa.setup", "user", user.Id,
            new { pending = user.TwoFactorPendingSecretProtected is not null },
            new { pending = true }, ct: ct);

        var label = $"SirLocked:{Uri.EscapeDataString(user.Email)}";
        var uri = $"otpauth://totp/{label}?secret={secret}&issuer=SirLocked&digits=6&period=30";
        return new AdminTwoFactorSetupResponse(secret, uri);
    }

    public async Task<AdminTwoFactorEnableResponse> EnableAsync(
        CurrentUser caller,
        string code,
        CancellationToken ct = default)
    {
        var user = await FindAdminAsync(caller.Id, ct);
        if (user.TwoFactorEnabled)
            throw ApiException.Conflict("Two-factor authentication is already enabled.");
        if (string.IsNullOrWhiteSpace(user.TwoFactorPendingSecretProtected))
            throw ApiException.BadRequest("Start two-factor setup before enabling it.");

        var secret = _protector.Unprotect(user.TwoFactorPendingSecretProtected);
        if (!Totp.TryGetMatchingStep(secret, code, _time.GetUtcNow(), user.TwoFactorLastUsedStep, out var step))
            throw ApiException.Unauthorized("The two-factor code is invalid.", "TWO_FACTOR_INVALID", "auth.twoFactorInvalid");

        var codes = Enumerable.Range(0, 8).Select(_ => GenerateRecoveryCode()).ToArray();
        var hashes = codes.Select(HashRecoveryCode).ToArray();
        var filter = UserIdAndUnusedStep(user.Id, step)
                     & Builders<User>.Filter.Eq(item => item.TwoFactorPendingSecretProtected, user.TwoFactorPendingSecretProtected)
                     & Builders<User>.Filter.Eq(item => item.TwoFactorEnabled, false);
        var update = Builders<User>.Update
            .Set(item => item.TwoFactorSecretProtected, user.TwoFactorPendingSecretProtected)
            .Set(item => item.TwoFactorPendingSecretProtected, null)
            .Set(item => item.TwoFactorEnabled, true)
            .Set(item => item.TwoFactorLastUsedStep, step)
            .Set(item => item.TwoFactorRecoveryCodeHashes, hashes.ToList())
            .Set(item => item.UpdatedAt, _time.GetUtcNow().UtcDateTime);
        var changed = await _db.Users.UpdateOneAsync(filter, update, cancellationToken: ct);
        if (changed.MatchedCount != 1)
            throw ApiException.Unauthorized("The two-factor code has already been used.", "TWO_FACTOR_INVALID", "auth.twoFactorInvalid");

        await _audit.LogAsync(caller, "admin.2fa.enable", "user", user.Id,
            new { enabled = false }, new { enabled = true, recoveryCodes = codes.Length }, ct: ct);
        return new AdminTwoFactorEnableResponse(codes);
    }

    public async Task DisableAsync(CurrentUser caller, string code, CancellationToken ct = default)
    {
        var user = await FindAdminAsync(caller.Id, ct);
        if (!user.TwoFactorEnabled)
            throw ApiException.BadRequest("Two-factor authentication is not enabled.");
        if (!await VerifyEnabledCodeAsync(user, code, ct))
            throw ApiException.Unauthorized("The two-factor code is invalid.", "TWO_FACTOR_INVALID", "auth.twoFactorInvalid");

        var update = Builders<User>.Update
            .Set(item => item.TwoFactorSecretProtected, null)
            .Set(item => item.TwoFactorPendingSecretProtected, null)
            .Set(item => item.TwoFactorEnabled, false)
            .Set(item => item.TwoFactorLastUsedStep, null)
            .Set(item => item.TwoFactorRecoveryCodeHashes, [])
            .Set(item => item.AdminStepUpUntil, null)
            .Set(item => item.UpdatedAt, _time.GetUtcNow().UtcDateTime);
        await _db.Users.UpdateOneAsync(item => item.Id == user.Id, update, cancellationToken: ct);
        await _audit.LogAsync(caller, "admin.2fa.disable", "user", user.Id,
            new { enabled = true }, new { enabled = false }, ct: ct);
    }

    public async Task<AdminStepUpResponse> StepUpAsync(
        string adminId,
        string? password,
        string? code,
        CancellationToken ct = default)
    {
        var user = await FindAdminAsync(adminId, ct);
        if (user.TwoFactorEnabled)
        {
            if (string.IsNullOrWhiteSpace(code))
                throw ApiException.Unauthorized("A two-factor code is required.", "TWO_FACTOR_REQUIRED", "auth.twoFactorRequired");
            if (!await VerifyEnabledCodeAsync(user, code, ct))
                throw ApiException.Unauthorized("The two-factor code is invalid.", "TWO_FACTOR_INVALID", "auth.twoFactorInvalid");
        }
        else
        {
            if (string.IsNullOrWhiteSpace(user.PasswordHash))
                throw ApiException.Forbidden("Set up two-factor authentication before using step-up actions.",
                    "TWO_FACTOR_SETUP_REQUIRED", "auth.twoFactorSetupRequired");
            if (string.IsNullOrWhiteSpace(password) || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
                throw ApiException.Unauthorized("Step-up credentials are invalid.", "STEP_UP_INVALID", "admin.stepUpInvalid");
        }

        var now = _time.GetUtcNow().UtcDateTime;
        var until = now.AddMinutes(_settings.EffectiveStepUpMinutes);
        await _db.Users.UpdateOneAsync(item => item.Id == user.Id,
            Builders<User>.Update.Set(item => item.AdminStepUpUntil, until).Set(item => item.UpdatedAt, now),
            cancellationToken: ct);
        await _audit.LogAsync(new CurrentUser(user.Id, user.FullName, user.Role), "admin.stepup", "user", user.Id,
            new { stepUpUntil = user.AdminStepUpUntil }, new { stepUpUntil = until }, ct: ct);
        return new AdminStepUpResponse(until);
    }

    public async Task<UserResponse> ResetAsync(CurrentUser caller, string userId, CancellationToken ct = default)
    {
        var user = await FindAdminAsync(userId, ct);
        var wasEnabled = user.TwoFactorEnabled;
        var update = Builders<User>.Update
            .Set(item => item.TwoFactorSecretProtected, null)
            .Set(item => item.TwoFactorPendingSecretProtected, null)
            .Set(item => item.TwoFactorEnabled, false)
            .Set(item => item.TwoFactorLastUsedStep, null)
            .Set(item => item.TwoFactorRecoveryCodeHashes, [])
            .Set(item => item.AdminStepUpUntil, null)
            .Inc(item => item.AuthorizationVersion, 1)
            .Set(item => item.UpdatedAt, _time.GetUtcNow().UtcDateTime);
        await _db.Users.UpdateOneAsync(item => item.Id == user.Id, update, cancellationToken: ct);
        user.TwoFactorEnabled = false;
        user.TwoFactorSecretProtected = null;
        user.TwoFactorPendingSecretProtected = null;
        user.TwoFactorRecoveryCodeHashes = [];
        user.AdminStepUpUntil = null;
        await _audit.LogAsync(caller, "admin.2fa.reset", "user", user.Id,
            new { enabled = wasEnabled }, new { enabled = false }, ct: ct);
        return UserResponseFor(user);
    }

    public async Task<bool> HasStepUpAsync(string adminId, CancellationToken ct = default)
    {
        var user = await _db.Users.Find(item => item.Id == adminId).FirstOrDefaultAsync(ct);
        return user?.AdminStepUpUntil is DateTime until && until > _time.GetUtcNow().UtcDateTime;
    }

    public bool RequireTwoFactor => _settings.RequireTwoFactor;

    private async Task<bool> VerifyEnabledCodeAsync(User user, string? code, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(code)) return false;
        if (!string.IsNullOrWhiteSpace(user.TwoFactorSecretProtected))
        {
            var secret = _protector.Unprotect(user.TwoFactorSecretProtected);
            if (Totp.TryGetMatchingStep(secret, code, _time.GetUtcNow(), user.TwoFactorLastUsedStep, out var step))
            {
                var result = await _db.Users.UpdateOneAsync(
                    UserIdAndUnusedStep(user.Id, step)
                    & Builders<User>.Filter.Eq(item => item.TwoFactorEnabled, true),
                    Builders<User>.Update
                        .Set(item => item.TwoFactorLastUsedStep, step)
                        .Set(item => item.UpdatedAt, _time.GetUtcNow().UtcDateTime),
                    cancellationToken: ct);
                if (result.MatchedCount == 1) return true;
            }
        }

        var normalized = NormalizeRecoveryCode(code);
        if (normalized.Length == 0) return false;
        var hash = HashRecoveryCode(normalized);
        var stored = user.TwoFactorRecoveryCodeHashes.FirstOrDefault(item => FixedHashEquals(item, hash));
        if (stored is null) return false;
        var filter = Builders<User>.Filter.Eq(item => item.Id, user.Id)
                     & Builders<User>.Filter.Eq(item => item.TwoFactorEnabled, true)
                     & Builders<User>.Filter.AnyEq(item => item.TwoFactorRecoveryCodeHashes, stored);
        var consumed = await _db.Users.UpdateOneAsync(
            filter,
            Builders<User>.Update
                .Pull(item => item.TwoFactorRecoveryCodeHashes, stored)
                .Set(item => item.UpdatedAt, _time.GetUtcNow().UtcDateTime),
            cancellationToken: ct);
        if (consumed.MatchedCount != 1) return false;
        var remaining = Math.Max(0, user.TwoFactorRecoveryCodeHashes.Count - 1);
        await _audit.LogAsync(new CurrentUser(user.Id, user.FullName, user.Role),
            "admin.2fa.recovery", "user", user.Id,
            new { recoveryCodesRemaining = user.TwoFactorRecoveryCodeHashes.Count },
            new { recoveryCodesRemaining = remaining }, ct: ct);
        user.TwoFactorRecoveryCodeHashes.Remove(stored);
        return true;
    }

    private async Task<User> FindAdminAsync(string id, CancellationToken ct) =>
        await _db.Users.Find(item => item.Id == id && item.Role == UserRole.Admin).FirstOrDefaultAsync(ct)
        ?? throw ApiException.NotFound("Admin user not found.");

    private static FilterDefinition<User> UserIdAndUnusedStep(string userId, long step)
    {
        var filter = Builders<User>.Filter;
        var unused = filter.Eq(item => item.TwoFactorLastUsedStep, null)
                     | filter.Lt(item => item.TwoFactorLastUsedStep, step)
                     | filter.Exists(item => item.TwoFactorLastUsedStep, false);
        return filter.Eq(item => item.Id, userId) & unused;
    }

    private static string GenerateRecoveryCode()
    {
        var characters = new char[10];
        for (var index = 0; index < characters.Length; index++)
            characters[index] = RecoveryAlphabet[RandomNumberGenerator.GetInt32(RecoveryAlphabet.Length)];
        return new string(characters);
    }

    private static string NormalizeRecoveryCode(string code) =>
        new(code.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    private static string HashRecoveryCode(string code) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(NormalizeRecoveryCode(code))));

    private static bool FixedHashEquals(string left, string right)
    {
        try
        {
            return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(left), Convert.FromHexString(right));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static UserResponse UserResponseFor(User user) => new()
    {
        UserId = user.Id,
        FullName = user.FullName,
        Email = user.Email,
        Role = user.Role,
        AdminRole = AdminRoles.Effective(user),
        AdminPermissions = AdminRoles.PermissionsFor(user),
        TwoFactorEnabled = user.TwoFactorEnabled,
        Status = user.Status,
        IsEmailVerified = user.IsEmailVerified,
        HasPassword = !string.IsNullOrWhiteSpace(user.PasswordHash),
        CreatedAt = user.CreatedAt
    };
}
