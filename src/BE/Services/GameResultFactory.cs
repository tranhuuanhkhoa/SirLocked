using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public static class GameResultFactory
{
    public static FinalAccusationSnapshot CreateSnapshot(
        GameRoom room,
        GameCase gameCase,
        AccuseRequest request,
        IReadOnlyCollection<string> submittedEvidenceIds,
        bool success,
        DateTime completedAt)
    {
        var isV2 = gameCase.MechanicsVersion >= CaseMechanicsVersions.InvestigationV2;
        return new FinalAccusationSnapshot
        {
            CaseId = gameCase.CaseId,
            PlayerIds = room.Players.Select(player => player.UserId).ToList(),
            SelectedCulpritId = request.CulpritId,
            SelectedEvidenceIds = submittedEvidenceIds.Distinct().ToList(),
            SelectedMotiveId = request.MotiveId,
            SelectedMethodId = request.MethodId,
            SelectedEvidenceLinks = request.EvidenceLinks.Select(link => new SelectedEvidenceLink
            {
                ClaimType = link.ClaimType.Trim().ToUpperInvariant(),
                EvidenceId = link.EvidenceId
            }).ToList(),
            ScoreSummary = isV2 ? GameplayV2Rules.BuildScoreSummary(gameCase, room.GameplayState!, success) : null,
            Success = success,
            Ending = success ? gameCase.FinalLogic.WinEnding : gameCase.FinalLogic.FailEnding,
            CompletedAt = completedAt
        };
    }

    public static GameResult CreateResult(string roomId, FinalAccusationSnapshot snapshot) => new()
    {
        RoomId = roomId,
        CaseId = snapshot.CaseId,
        Players = snapshot.PlayerIds.ToList(),
        SelectedCulpritId = snapshot.SelectedCulpritId,
        SelectedEvidenceIds = snapshot.SelectedEvidenceIds.ToList(),
        SelectedMotiveId = snapshot.SelectedMotiveId,
        SelectedMethodId = snapshot.SelectedMethodId,
        SelectedEvidenceLinks = snapshot.SelectedEvidenceLinks.Select(link => new SelectedEvidenceLink
        {
            ClaimType = link.ClaimType,
            EvidenceId = link.EvidenceId
        }).ToList(),
        ScoreSummary = snapshot.ScoreSummary,
        Success = snapshot.Success,
        Ending = snapshot.Ending,
        CreatedAt = snapshot.CompletedAt
    };
}

public static class GameResultPersistenceCoordinator
{
    public static async Task<GameResult> MaterializeAsync(
        string roomId,
        FinalAccusationSnapshot snapshot,
        IGameResultStore store,
        CancellationToken cancellationToken = default) =>
        await store.UpsertAsync(GameResultFactory.CreateResult(roomId, snapshot), cancellationToken);

    public static async Task<GameResult> MaterializeFromCompletedRoomAsync(
        GameRoom room,
        IGameResultStore store,
        CancellationToken cancellationToken = default)
    {
        if (room.Status != RoomStatus.Completed)
        {
            throw ApiException.NotFound("No result for this room yet.");
        }

        var snapshot = room.GameplayState?.FinalAccusationSnapshot
            ?? throw ApiException.Conflict("This completed room has no recoverable final accusation snapshot.");
        return await MaterializeAsync(room.Id, snapshot, store, cancellationToken);
    }
}

public sealed class MongoGameResultStore : IGameResultStore
{
    private readonly MongoDbContext _db;

    public MongoGameResultStore(MongoDbContext db) => _db = db;

    public async Task<GameResult?> FindByRoomIdAsync(
        string roomId,
        CancellationToken cancellationToken = default) =>
        await _db.GameResults.Find(result => result.RoomId == roomId)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<GameResult> UpsertAsync(
        GameResult result,
        CancellationToken cancellationToken = default)
    {
        var filter = Builders<GameResult>.Filter.Eq(existing => existing.RoomId, result.RoomId);
        var update = Builders<GameResult>.Update
            .Set(existing => existing.CaseId, result.CaseId)
            .Set(existing => existing.Players, result.Players)
            .Set(existing => existing.SelectedCulpritId, result.SelectedCulpritId)
            .Set(existing => existing.SelectedEvidenceIds, result.SelectedEvidenceIds)
            .Set(existing => existing.SelectedMotiveId, result.SelectedMotiveId)
            .Set(existing => existing.SelectedMethodId, result.SelectedMethodId)
            .Set(existing => existing.SelectedEvidenceLinks, result.SelectedEvidenceLinks)
            .Set(existing => existing.ScoreSummary, result.ScoreSummary)
            .Set(existing => existing.Success, result.Success)
            .Set(existing => existing.Ending, result.Ending)
            .Set(existing => existing.CreatedAt, result.CreatedAt);
        var upsertOptions = new FindOneAndUpdateOptions<GameResult>
        {
            IsUpsert = true,
            ReturnDocument = ReturnDocument.After
        };

        try
        {
            return await _db.GameResults.FindOneAndUpdateAsync(
                filter,
                update,
                upsertOptions,
                cancellationToken);
        }
        catch (MongoWriteException exception) when (
            exception.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            // Another request won the unique RoomId upsert race. Reapply the same authoritative snapshot.
            return await _db.GameResults.FindOneAndUpdateAsync(
                filter,
                update,
                new FindOneAndUpdateOptions<GameResult> { ReturnDocument = ReturnDocument.After },
                cancellationToken)
                ?? throw new InvalidOperationException(
                    $"Game result upsert race for room '{result.RoomId}' did not leave a recoverable result.");
        }
    }
}
