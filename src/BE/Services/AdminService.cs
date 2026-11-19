using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
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
        return users.Select(u => new UserResponse
        {
            UserId = u.Id,
            FullName = u.FullName,
            Email = u.Email,
            Role = u.Role,
            Status = u.Status,
            CreatedAt = u.CreatedAt
        }).ToList();
    }

    public async Task<UserResponse> SetUserStatusAsync(string userId, string status)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");

        if (user.Role == UserRole.Admin && status != UserStatus.Active)
        {
            throw ApiException.BadRequest("Admin accounts cannot be locked.");
        }

        var update = Builders<Models.User>.Update
            .Set(u => u.Status, status)
            .Inc(u => u.AuthorizationVersion, 1)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);

        user.Status = status;
        return new UserResponse
        {
            UserId = user.Id,
            FullName = user.FullName,
            Email = user.Email,
            Role = user.Role,
            Status = user.Status,
            CreatedAt = user.CreatedAt
        };
    }

    public async Task<UserResponse> SetUserRoleAsync(string userId, string role)
    {
        role = role.Trim().ToUpperInvariant();
        if (role is not UserRole.Player and not UserRole.Vip)
        {
            throw ApiException.BadRequest($"Role must be {UserRole.Player} or {UserRole.Vip}.");
        }

        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");

        if (user.Role == UserRole.Admin)
        {
            throw ApiException.BadRequest("Admin account roles cannot be changed.");
        }

        var update = Builders<Models.User>.Update
            .Set(u => u.Role, role)
            .Inc(u => u.AuthorizationVersion, 1)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);

        user.Role = role;
        return new UserResponse
        {
            UserId = user.Id,
            FullName = user.FullName,
            Email = user.Email,
            Role = user.Role,
            Status = user.Status,
            CreatedAt = user.CreatedAt
        };
    }
}
