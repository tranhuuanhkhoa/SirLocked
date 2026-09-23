using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class AdminService : IAdminService
{
    private readonly MongoDbContext _db;

    public AdminService(MongoDbContext db) => _db = db;

    public async Task<object> GetDashboardAsync()
    {
        var totalUsers = await _db.Users.CountDocumentsAsync(_ => true);
        var totalCases = await _db.Cases.CountDocumentsAsync(_ => true);
        var publishedCases = await _db.Cases.CountDocumentsAsync(c => c.Status == CaseStatus.Published);
        var totalRooms = await _db.Rooms.CountDocumentsAsync(_ => true);
        var activeRooms = await _db.Rooms.CountDocumentsAsync(r => r.Status == RoomStatus.InProgress);
        var totalResults = await _db.GameResults.CountDocumentsAsync(_ => true);
        var wins = await _db.GameResults.CountDocumentsAsync(r => r.Success);
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
            totalAiDrafts = totalDrafts
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
