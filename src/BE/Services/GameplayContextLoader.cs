using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class GameplayContextLoader : IGameplayContextLoader
{
    private readonly MongoDbContext _db;
    private readonly ICaseService _caseService;

    public GameplayContextLoader(MongoDbContext db, ICaseService caseService)
    {
        _db = db;
        _caseService = caseService;
    }

    public async Task<GameplayContext> LoadAsync(
        string userId,
        string roomId,
        bool requireInProgress,
        CancellationToken cancellationToken = default)
    {
        var room = await _db.Rooms.Find(room => room.Id == roomId)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw ApiException.NotFound("Room not found.");
        var player = room.Players.FirstOrDefault(candidate => candidate.UserId == userId)
            ?? throw ApiException.Forbidden("You are not a member of this room.");

        if (requireInProgress)
        {
            if (room.Status == RoomStatus.Completed)
            {
                throw ApiException.BadRequest("This game is already finished.");
            }
            if (room.Status != RoomStatus.InProgress || room.GameplayState is null)
            {
                throw ApiException.BadRequest("The game has not started yet.");
            }
        }

        var gameCase = await _caseService.GetCaseAsync(room.CaseId);
        return new GameplayContext(room, gameCase, player);
    }
}
