using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Admin;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class AdminService : IAdminService
{
    private readonly MongoDbContext _db;
    private readonly LegacyCaseCatalog? _legacy;

    public AdminService(MongoDbContext db, LegacyCaseCatalog? legacy = null)
    {
        _db = db;
        _legacy = legacy;
    }

    public async Task<object> GetDashboardAsync()
    {
        var totalUsers = await _db.Users.CountDocumentsAsync(_ => true);
        // Cases, rooms and results of hidden (legacy) cases are left out of the counters too.
        var hidden = _legacy is null ? [] : await _legacy.GetHiddenCaseIdsAsync();
        var casesFilter = hidden.Count == 0 ? Builders<GameCase>.Filter.Empty : Builders<GameCase>.Filter.Nin(c => c.CaseId, hidden);
        var roomsFilter = hidden.Count == 0 ? Builders<GameRoom>.Filter.Empty : Builders<GameRoom>.Filter.Nin(r => r.CaseId, hidden);
        var resultsFilter = hidden.Count == 0 ? Builders<GameResult>.Filter.Empty : Builders<GameResult>.Filter.Nin(r => r.CaseId, hidden);
        var totalCases = await _db.Cases.CountDocumentsAsync(casesFilter);
        var publishedCases = await _db.Cases.CountDocumentsAsync(casesFilter & Builders<GameCase>.Filter.Eq(c => c.Status, CaseStatus.Published));
        var totalRooms = await _db.Rooms.CountDocumentsAsync(roomsFilter);
        var activeRooms = await _db.Rooms.CountDocumentsAsync(roomsFilter & Builders<GameRoom>.Filter.Eq(r => r.Status, RoomStatus.InProgress));
        var totalResults = await _db.GameResults.CountDocumentsAsync(resultsFilter);
        var wins = await _db.GameResults.CountDocumentsAsync(resultsFilter & Builders<GameResult>.Filter.Eq(r => r.Success, true));
        var totalDrafts = await _db.AiCaseDrafts.CountDocumentsAsync(_ => true);

        return new
        {
            totalUsers,
            totalCases,
            publishedCases,
            totalRooms,
            activeRooms,
            totalResults,
            wins,
            losses = totalResults - wins,
            totalAiDrafts = totalDrafts,
            // True while older (non-pixel) cases are hidden; the dashboard then stops offering to create them.
            legacyCasesHidden = _legacy?.Enabled ?? false
        };
    }

    public async Task<List<UserResponse>> GetUsersAsync()
    {
        var users = await _db.Users.Find(_ => true).SortByDescending(u => u.CreatedAt).Limit(200).ToListAsync();
        return users.Select(ToUserResponse).ToList();
    }

    public async Task<UserResponse> GetUserAsync(string userId)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");
        return ToUserResponse(user);
    }

    public async Task<UserResponse> SetUserStatusAsync(string userId, string status)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");

        if (user.Role == UserRole.Admin && status != UserStatus.Active)
        {
            throw ApiException.BadRequest("Admin accounts cannot be locked.");
        }

        // A deleted account comes back only through "restore", which says so in the audit log.
        if (user.Status == UserStatus.Deleted)
        {
            throw ApiException.Conflict("Tài khoản này đã bị xóa. Hãy khôi phục tài khoản trước.");
        }

        var update = Builders<Models.User>.Update
            .Set(u => u.Status, status)
            .Inc(u => u.AuthorizationVersion, 1)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);

        user.Status = status;
        return ToUserResponse(user);
    }

    public async Task<UserResponse> SetUserRoleAsync(string userId, string role)
    {
        role = role.Trim().ToUpperInvariant();
        if (role is not UserRole.Player and not UserRole.Vip and not UserRole.Admin)
        {
            throw ApiException.BadRequest($"Role must be {UserRole.Player}, {UserRole.Vip}, or {UserRole.Admin}.");
        }

        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");

        if (role == UserRole.Admin && user.Role == UserRole.Admin)
            throw ApiException.BadRequest("This account is already an admin.");

        if (user.Role == UserRole.Admin
            && role != UserRole.Admin
            && AdminRoles.Effective(user) == AdminRoles.SuperAdmin)
            await EnsureNotLastSuperAdminAsync();

        var update = Builders<Models.User>.Update
            .Set(u => u.Role, role)
            .Set(u => u.AdminRole, role == UserRole.Admin ? AdminRoles.Support : null)
            .Set(u => u.TwoFactorSecretProtected, null)
            .Set(u => u.TwoFactorPendingSecretProtected, null)
            .Set(u => u.TwoFactorEnabled, false)
            .Set(u => u.TwoFactorLastUsedStep, null)
            .Set(u => u.TwoFactorRecoveryCodeHashes, [])
            .Set(u => u.AdminStepUpUntil, null)
            .Inc(u => u.AuthorizationVersion, 1)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);

        user.Role = role;
        user.AdminRole = role == UserRole.Admin ? AdminRoles.Support : null;
        user.TwoFactorEnabled = false;
        user.TwoFactorSecretProtected = null;
        user.TwoFactorPendingSecretProtected = null;
        user.TwoFactorLastUsedStep = null;
        user.TwoFactorRecoveryCodeHashes = [];
        user.AdminStepUpUntil = null;
        return ToUserResponse(user);
    }

    public async Task<UserResponse> SetAdminRoleAsync(string userId, string adminRole)
    {
        adminRole = (adminRole ?? string.Empty).Trim().ToUpperInvariant();
        if (!AdminRoles.IsKnown(adminRole))
            throw ApiException.BadRequest("Unknown admin role.");

        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");
        if (user.Role != UserRole.Admin)
            throw ApiException.BadRequest("The target user is not an admin.");

        if (AdminRoles.Effective(user) == AdminRoles.SuperAdmin && adminRole != AdminRoles.SuperAdmin)
            await EnsureNotLastSuperAdminAsync();

        var update = Builders<Models.User>.Update
            .Set(u => u.AdminRole, adminRole)
            .Inc(u => u.AuthorizationVersion, 1)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);
        user.AdminRole = adminRole;
        return ToUserResponse(user);
    }

    private async Task EnsureNotLastSuperAdminAsync()
    {
        var superAdmins = await _db.Users.CountDocumentsAsync(u =>
            u.Role == UserRole.Admin
            && (u.AdminRole == AdminRoles.SuperAdmin || u.AdminRole == null));
        AdminRoleRules.ValidateLastSuperAdminDemotion(superAdmins);
    }

    private static UserResponse ToUserResponse(Models.User user) => new()
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
