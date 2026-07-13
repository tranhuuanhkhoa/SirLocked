using System.Collections.Concurrent;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

public class GameplayPersistenceTests
{
    [Fact]
    public void GameResultFactory_MapsLegacySnapshotAndResultWithoutScore()
    {
        var completedAt = new DateTime(2026, 7, 13, 12, 30, 0, DateTimeKind.Utc);
        var room = RoomWithState();
        var gameCase = Case(CaseMechanicsVersions.Legacy);
        var request = new AccuseRequest
        {
            CulpritId = "suspect-1",
            MotiveId = "motive-1",
            MethodId = "method-1"
        };

        var snapshot = GameResultFactory.CreateSnapshot(
            room,
            gameCase,
            request,
            new[] { "evidence-1", "evidence-1" },
            success: true,
            completedAt);
        var result = GameResultFactory.CreateResult(room.Id, snapshot);

        Assert.Equal(gameCase.CaseId, snapshot.CaseId);
        Assert.Equal(new[] { "player-1", "player-2" }, snapshot.PlayerIds);
        Assert.Equal("suspect-1", snapshot.SelectedCulpritId);
        Assert.Equal(new[] { "evidence-1" }, snapshot.SelectedEvidenceIds);
        Assert.Equal("motive-1", snapshot.SelectedMotiveId);
        Assert.Equal("method-1", snapshot.SelectedMethodId);
        Assert.True(snapshot.Success);
        Assert.Equal("win", snapshot.Ending);
        Assert.Null(snapshot.ScoreSummary);
        Assert.Equal(completedAt, snapshot.CompletedAt);
        Assert.Equal(room.Id, result.RoomId);
        Assert.Equal(snapshot.PlayerIds, result.Players);
        Assert.Equal(snapshot.SelectedEvidenceIds, result.SelectedEvidenceIds);
        Assert.Equal(completedAt, result.CreatedAt);
    }

    [Fact]
    public void GameResultFactory_MapsV2EvidenceLinksAndPreservesScore()
    {
        var room = RoomWithState();
        room.GameplayState!.UnlockedClueIds.Add("evidence-1");
        room.GameplayState.ClueDiscoveries.Add(new ClueDiscoveryRecord
        {
            ClueId = "evidence-1",
            DiscoveredByRole = PlayerRole.Investigator,
            SourceAction = ClueDiscoverySources.Camera
        });
        var gameCase = Case(CaseMechanicsVersions.InvestigationV2);
        gameCase.Clues.Add(new CaseClue { ClueId = "evidence-1", IsEvidence = true });
        var request = new AccuseRequest
        {
            CulpritId = "suspect-1",
            MotiveId = "motive-1",
            MethodId = "method-1",
            EvidenceLinks = new List<EvidenceLinkRequest>
            {
                new() { ClaimType = " motive ", EvidenceId = "evidence-1" }
            }
        };

        var snapshot = GameResultFactory.CreateSnapshot(
            room,
            gameCase,
            request,
            new[] { "evidence-1" },
            success: true,
            DateTime.UtcNow);
        var result = GameResultFactory.CreateResult(room.Id, snapshot);

        var link = Assert.Single(snapshot.SelectedEvidenceLinks);
        Assert.Equal("MOTIVE", link.ClaimType);
        Assert.Equal("evidence-1", link.EvidenceId);
        Assert.NotNull(snapshot.ScoreSummary);
        Assert.Equal(snapshot.ScoreSummary!.TotalScore, result.ScoreSummary!.TotalScore);
        Assert.Equal(snapshot.ScoreSummary.Rank, result.ScoreSummary.Rank);
        Assert.Equal("MOTIVE", Assert.Single(result.SelectedEvidenceLinks).ClaimType);
    }

    [Fact]
    public async Task MaterializationFailure_LeavesAuthoritativeSnapshotAvailableForRetry()
    {
        var room = CompletedRoomWithSnapshot();
        var store = new FakeGameResultStore { FailUpserts = true };

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            GameResultPersistenceCoordinator.MaterializeFromCompletedRoomAsync(room, store));

        Assert.NotNull(room.GameplayState!.FinalAccusationSnapshot);
        Assert.Empty(store.Results);
    }

    [Fact]
    public async Task MissingResultRepair_RepeatedUpsertYieldsOneLogicalResult()
    {
        var room = CompletedRoomWithSnapshot();
        var store = new FakeGameResultStore();

        var first = await GameResultPersistenceCoordinator.MaterializeFromCompletedRoomAsync(room, store);
        var second = await GameResultPersistenceCoordinator.MaterializeFromCompletedRoomAsync(room, store);

        Assert.Equal(first.RoomId, second.RoomId);
        Assert.Equal(first.SelectedEvidenceLinks.Single().EvidenceId, second.SelectedEvidenceLinks.Single().EvidenceId);
        Assert.Single(store.Results);
        Assert.Equal(2, store.UpsertAttempts);
    }

    [Fact]
    public async Task ConcurrentMaterialization_YieldsOneLogicalResult()
    {
        var room = CompletedRoomWithSnapshot();
        var store = new FakeGameResultStore();

        await Task.WhenAll(Enumerable.Range(0, 12).Select(_ =>
            GameResultPersistenceCoordinator.MaterializeFromCompletedRoomAsync(room, store)));

        Assert.Single(store.Results);
        Assert.Equal(12, store.UpsertAttempts);
    }

    [Fact]
    public async Task LegacyCompletedRoomWithoutSnapshot_RemainsClearlyUnrecoverable()
    {
        var room = RoomWithState();
        room.Status = RoomStatus.Completed;
        var store = new FakeGameResultStore();

        var exception = await Assert.ThrowsAsync<ApiException>(() =>
            GameResultPersistenceCoordinator.MaterializeFromCompletedRoomAsync(room, store));

        Assert.Equal(409, exception.StatusCode);
        Assert.Contains("no recoverable final accusation snapshot", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(store.Results);
    }

    [Fact]
    public void GameplaySnapshot_IsBsonCompatibleAndLegacyDocumentsDeserializeNull()
    {
        var room = CompletedRoomWithSnapshot();
        var document = room.GameplayState!.ToBsonDocument();
        var roundTripped = BsonSerializer.Deserialize<GameplayState>(document);
        var legacy = BsonSerializer.Deserialize<GameplayState>(new BsonDocument
        {
            { "currentStageId", "stage-1" },
            { "currentSceneId", "scene-1" }
        });

        Assert.Equal("suspect-1", roundTripped.FinalAccusationSnapshot!.SelectedCulpritId);
        Assert.Null(legacy.FinalAccusationSnapshot);
        Assert.DoesNotContain(
            typeof(GameStateResponse).GetProperties(),
            property => property.Name.Contains("AccusationSnapshot", StringComparison.Ordinal));
    }

    [Fact]
    public void GameResultIndexMigration_RequiresExactNamedUniqueRoomIdIndex()
    {
        var desired = IndexDocument(GameResultIndexMigration.RequiredIndexName, unique: true);
        var nonUnique = IndexDocument(GameResultIndexMigration.RequiredIndexName, unique: false);
        var wrongName = IndexDocument("roomId_1", unique: true);
        var composite = IndexDocument(
            GameResultIndexMigration.RequiredIndexName,
            unique: true,
            new BsonElement("createdAt", -1));

        Assert.True(GameResultIndexMigration.IsDesiredRoomIdIndex(desired));
        Assert.False(GameResultIndexMigration.IsDesiredRoomIdIndex(nonUnique));
        Assert.False(GameResultIndexMigration.IsDesiredRoomIdIndex(wrongName));
        Assert.False(GameResultIndexMigration.IsDesiredRoomIdIndex(composite));
        Assert.True(GameResultIndexMigration.IsIndexNotFound(27, null));
        Assert.True(GameResultIndexMigration.IsIndexNotFound(0, "IndexNotFound"));
        Assert.False(GameResultIndexMigration.IsIndexNotFound(11000, "DuplicateKey"));
    }

    [Fact]
    public void GameResultIndexInvariantException_ReportsOnlyDuplicateIdentifiersAndCounts()
    {
        var exception = new GameResultIndexInvariantException(new List<DuplicateGameResultRoom>
        {
            new("room-1", 2, new[] { "result-1", "result-2" })
        });

        var duplicate = Assert.Single(exception.Duplicates);
        Assert.Equal("room-1", duplicate.RoomId);
        Assert.Equal(2, duplicate.Count);
        Assert.Equal(new[] { "result-1", "result-2" }, duplicate.ResultIds);
        Assert.Contains("roomId=room-1, count=2, resultIds=[result-1,result-2]", exception.Message);
        Assert.DoesNotContain("ConnectionString", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static GameRoom RoomWithState() => new()
    {
        Id = "507f1f77bcf86cd799439011",
        CaseId = "case-1",
        Status = RoomStatus.InProgress,
        Players = new List<RoomPlayer>
        {
            new() { UserId = "player-1" },
            new() { UserId = "player-2" }
        },
        GameplayState = new GameplayState()
    };

    private static GameRoom CompletedRoomWithSnapshot()
    {
        var room = RoomWithState();
        room.Status = RoomStatus.Completed;
        room.GameplayState!.GameStatus = GameStatus.Won;
        room.GameplayState.FinalAccusationSnapshot = new FinalAccusationSnapshot
        {
            CaseId = room.CaseId,
            PlayerIds = room.Players.Select(player => player.UserId).ToList(),
            SelectedCulpritId = "suspect-1",
            SelectedEvidenceIds = new List<string> { "evidence-1" },
            SelectedMotiveId = "motive-1",
            SelectedMethodId = "method-1",
            SelectedEvidenceLinks = new List<SelectedEvidenceLink>
            {
                new() { ClaimType = "MOTIVE", EvidenceId = "evidence-1" }
            },
            ScoreSummary = new ScoreSummary { TotalScore = 95, Rank = "S" },
            Success = true,
            Ending = "win",
            CompletedAt = new DateTime(2026, 7, 13, 12, 30, 0, DateTimeKind.Utc)
        };
        return room;
    }

    private static GameCase Case(int mechanicsVersion) => new()
    {
        CaseId = "case-1",
        MechanicsVersion = mechanicsVersion,
        FinalLogic = new FinalLogic
        {
            CulpritId = "suspect-1",
            WinEnding = "win",
            FailEnding = "fail"
        }
    };

    private static BsonDocument IndexDocument(
        string name,
        bool unique,
        params BsonElement[] additionalKeys)
    {
        var keys = new BsonDocument("roomId", 1);
        foreach (var key in additionalKeys) keys.Add(key);
        return new BsonDocument
        {
            { "name", name },
            { "key", keys },
            { "unique", unique }
        };
    }

    private sealed class FakeGameResultStore : IGameResultStore
    {
        private readonly ConcurrentDictionary<string, GameResult> _results = new();
        private int _upsertAttempts;

        public bool FailUpserts { get; init; }
        public ICollection<GameResult> Results => _results.Values;
        public int UpsertAttempts => _upsertAttempts;

        public Task<GameResult?> FindByRoomIdAsync(
            string roomId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(_results.GetValueOrDefault(roomId));

        public Task<GameResult> UpsertAsync(
            GameResult result,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _upsertAttempts);
            if (FailUpserts) throw new InvalidOperationException("result write failed");
            return Task.FromResult(_results.AddOrUpdate(result.RoomId, result, (_, _) => result));
        }
    }
}
