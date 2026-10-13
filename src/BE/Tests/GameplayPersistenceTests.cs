using System.Collections.Concurrent;
using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
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

    [Theory]
    [InlineData(CaseMechanicsVersions.Legacy)]
    [InlineData(CaseMechanicsVersions.InvestigationV2)]
    [InlineData(CaseMechanicsVersions.InvestigationV3PairedConfrontation)]
    public void CompletedResult_UsesOriginalDefinitionAfterSameCaseIsOverwritten(int mechanicsVersion)
    {
        var gameCase = HistoricalCase(mechanicsVersion);
        var snapshot = CaptureHistoricalResult(gameCase);
        var result = GameResultFactory.CreateResult("room", snapshot);
        var original = GameplayService.ToResultResponse(result, gameCase);
        var originalJson = JsonSerializer.Serialize(original);

        OverwriteHistoricalCase(gameCase);
        var response = GameplayService.ToResultResponse(result, gameCase);

        Assert.Equal("Original case", response.CaseTitle);
        Assert.Equal("Original suspect", response.CorrectCulpritName);
        Assert.Equal("suspect-1", response.CorrectCulpritId);
        Assert.Equal("Original motive", response.Motive);
        Assert.Equal("Original method", response.Method);
        Assert.Equal(new[] { "evidence-1" }, response.RequiredEvidenceIds);
        Assert.True(response.Success);
        Assert.Equal("win", response.Ending);
        Assert.Equal(originalJson, JsonSerializer.Serialize(response));
        if (mechanicsVersion >= CaseMechanicsVersions.InvestigationV2)
        {
            var evidence = Assert.Single(response.EvidenceResults);
            Assert.Equal("Original evidence", evidence.CorrectEvidenceTitle);
            Assert.True(evidence.IsCorrect);
            Assert.True(response.CulpritResult!.IsCorrect);
            Assert.True(response.MotiveResult!.IsCorrect);
            Assert.True(response.MethodResult!.IsCorrect);
        }
    }

    [Fact]
    public async Task CompletedSnapshot_BsonRoundTripAndMissingResultRecoveryPreserveOriginalDefinition()
    {
        var gameCase = HistoricalCase(CaseMechanicsVersions.InvestigationV3PairedConfrontation);
        var room = RoomWithState();
        room.Status = RoomStatus.Completed;
        room.GameplayState!.FinalAccusationSnapshot = CaptureHistoricalResult(gameCase);
        room.GameplayState = BsonSerializer.Deserialize<GameplayState>(room.GameplayState.ToBsonDocument());
        OverwriteHistoricalCase(gameCase);

        var result = await GameResultPersistenceCoordinator.MaterializeFromCompletedRoomAsync(room, new FakeGameResultStore());
        result.Id = ObjectId.GenerateNewId().ToString();
        var persistedResult = BsonSerializer.Deserialize<GameResult>(result.ToBsonDocument());
        var response = GameplayService.ToResultResponse(persistedResult, gameCase);

        Assert.NotNull(persistedResult.CaseDefinitionSnapshot);
        Assert.Equal("Original case", response.CaseTitle);
        Assert.Equal("suspect-1", response.CorrectCulpritId);
        Assert.Equal("Original evidence", Assert.Single(response.EvidenceResults).CorrectEvidenceTitle);
        Assert.Equal("Original ending", Assert.Single(response.Presentation!.Cutscenes).Panels.Single().Caption);
    }

    [Fact]
    public void LegacyResult_RemainsReadableWithoutInventingAnOriginalDefinition()
    {
        var result = BsonSerializer.Deserialize<GameResult>(new BsonDocument
        {
            { "caseId", "case-1" }, { "roomId", "room" }, { "success", true }, { "ending", "saved ending" }
        });
        var gameCase = HistoricalCase(CaseMechanicsVersions.Legacy);
        var response = GameplayService.ToResultResponse(result, gameCase);

        Assert.Null(result.CaseDefinitionSnapshot);
        Assert.Equal("Original case", response.CaseTitle);
        Assert.Equal("saved ending", response.Ending);
        Assert.True(response.Success);
    }

    [Theory]
    [InlineData(RoomStatus.Completed, false, true)]
    [InlineData(RoomStatus.Completed, true, false)]
    [InlineData(RoomStatus.InProgress, false, false)]
    [InlineData(RoomStatus.Abandoned, false, false)]
    public void LegacyCompletedCaseGuard_ProtectsOnlyCompletedRoomsWithoutDefinition(string status, bool hasDefinition, bool expected)
    {
        var room = CompletedRoomWithSnapshot();
        room.Status = status;
        if (hasDefinition) room.GameplayState!.FinalAccusationSnapshot!.CaseDefinitionSnapshot = new GameResultCaseSnapshot();
        var predicate = CaseService.ReferencingLegacyCompletedCase(room.CaseId).Compile();

        Assert.Equal(expected, predicate(room));
        room.CaseId = "unrelated-case";
        Assert.False(predicate(room));
    }

    [Fact]
    public void LegacyGuards_IncludeMissingCompletionStateAndStandaloneHistoricalResults()
    {
        var room = RoomWithState();
        room.Status = RoomStatus.Completed;
        var roomPredicate = CaseService.ReferencingLegacyCompletedCase(room.CaseId).Compile();
        Assert.True(roomPredicate(room));
        room.GameplayState = null;
        Assert.True(roomPredicate(room));

        var result = new GameResult { CaseId = room.CaseId };
        var resultPredicate = CaseService.ReferencingLegacyResult(room.CaseId).Compile();
        Assert.True(resultPredicate(result));
        result.CaseDefinitionSnapshot = new GameResultCaseSnapshot();
        Assert.False(resultPredicate(result));
        result.CaseDefinitionSnapshot = null;
        result.CaseId = "unrelated-case";
        Assert.False(resultPredicate(result));
    }

    [Fact]
    public void LegacyGuards_RenderMongoQueriesAgainstPersistedSnapshotFields()
    {
        var roomFilter = Builders<GameRoom>.Filter.Where(CaseService.ReferencingLegacyCompletedCase("case-1"))
            .Render(new RenderArgs<GameRoom>(BsonSerializer.LookupSerializer<GameRoom>(), BsonSerializer.SerializerRegistry));
        var resultFilter = Builders<GameResult>.Filter.Where(CaseService.ReferencingLegacyResult("case-1"))
            .Render(new RenderArgs<GameResult>(BsonSerializer.LookupSerializer<GameResult>(), BsonSerializer.SerializerRegistry));

        Assert.True(ContainsField(roomFilter, "caseId", "case-1"), roomFilter.ToJson());
        Assert.True(ContainsField(roomFilter, "status", RoomStatus.Completed), roomFilter.ToJson());
        Assert.True(ContainsField(roomFilter, "gameplayState.finalAccusationSnapshot.caseDefinitionSnapshot", BsonNull.Value), roomFilter.ToJson());
        Assert.True(ContainsField(resultFilter, "caseId", "case-1"), resultFilter.ToJson());
        Assert.True(ContainsField(resultFilter, "caseDefinitionSnapshot", BsonNull.Value), resultFilter.ToJson());

        static bool ContainsField(BsonValue value, string name, BsonValue expected) => value switch
        {
            BsonDocument document => document.Elements.Any(element =>
                (element.Name == name && element.Value == expected) || ContainsField(element.Value, name, expected)),
            BsonArray array => array.Any(item => ContainsField(item, name, expected)),
            _ => false
        };
    }

    [Fact]
    public void CompletedMedia_UsesOriginalEndingPackageAndPreservesMembershipAndOutcomeRules()
    {
        var gameCase = HistoricalCase(CaseMechanicsVersions.InvestigationV3PairedConfrontation);
        var room = RoomWithState();
        room.Status = RoomStatus.Completed;
        room.GameplayState!.FinalAccusationSnapshot = CaptureHistoricalResult(gameCase);
        OverwriteHistoricalCase(gameCase);

        var presentation = PresentationPolicy.GameMediaPresentation(room, gameCase)!;
        var clip = Assert.Single(presentation.Clips);
        Assert.Equal("original-package", presentation.PackageId);
        Assert.Equal("original-poster", clip.PosterAssetId);
        Assert.Equal("ENDING", clip.Kind);
        Assert.True(PresentationPolicy.IsEligible(clip, room, gameCase, "player-1"));
        Assert.False(PresentationPolicy.IsEligible(clip, room, gameCase, "outsider"));
        room.GameplayState.FinalAccusationSnapshot.Success = false;
        Assert.False(PresentationPolicy.IsEligible(clip, room, gameCase, "player-1"));
        Assert.DoesNotContain(presentation.Clips, candidate => candidate.PosterAssetId == "replacement-poster");
    }

    [Fact]
    public void CompletedMedia_WithNoOriginalPresentationCannotInheritReplacementClips()
    {
        var gameCase = HistoricalCase(CaseMechanicsVersions.InvestigationV2);
        gameCase.Presentation = null;
        var room = CompletedRoomWithSnapshot();
        room.GameplayState!.FinalAccusationSnapshot = CaptureHistoricalResult(gameCase);
        gameCase.Presentation = new CasePresentation { PackageId = "replacement" };

        Assert.Null(PresentationPolicy.GameMediaPresentation(room, gameCase));
    }

    [Fact]
    public void CompletedStateRead_CanRedirectToOriginalResultAfterItsSceneIsRemoved()
    {
        var gameCase = HistoricalCase(CaseMechanicsVersions.InvestigationV3PairedConfrontation);
        gameCase.Stages = [new() { StageId = "original-stage", Scenes = [new() { SceneId = "original-scene" }] }];
        var room = RoomWithState();
        room.Status = RoomStatus.Completed;
        room.GameplayState!.GameStatus = GameStatus.Won;
        room.GameplayState.Version = 42;
        room.GameplayState.CurrentStageId = "original-stage";
        room.GameplayState.PlayerSceneIds["player-1"] = "original-scene";
        room.GameplayState.FinalAccusationSnapshot = CaptureHistoricalResult(gameCase);
        gameCase.Stages.Clear();
        OverwriteHistoricalCase(gameCase);

        var response = GameStateBuilder.BuildCompletedReadState(room, "player-1")!;

        Assert.Equal(RoomStatus.Completed, response.RoomStatus);
        Assert.True(response.IsCaseComplete);
        Assert.Equal(GameStatus.Won, response.GameStatus);
        Assert.Equal(42, response.Version);
        Assert.Equal(room.Id, response.RoomId);
        Assert.Equal("Original case", response.CaseTitle);
        Assert.Equal(CaseMechanicsVersions.InvestigationV3PairedConfrontation, response.MechanicsVersion);
        Assert.Equal("original-scene", response.CurrentSceneId);
        Assert.Equal(2, response.Players.Count);
        Assert.Empty(response.UnlockedClues);
        Assert.Null(response.AccusationConfig);
        Assert.DoesNotContain("suspect-1", JsonSerializer.Serialize(response));
        Assert.DoesNotContain("Original evidence", JsonSerializer.Serialize(response));

        room.Status = RoomStatus.InProgress;
        Assert.Null(GameStateBuilder.BuildCompletedReadState(room, "player-1"));
        room.Status = RoomStatus.Completed;
        room.GameplayState.FinalAccusationSnapshot.CaseDefinitionSnapshot = null;
        Assert.Null(GameStateBuilder.BuildCompletedReadState(room, "player-1"));
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

    private static GameCase HistoricalCase(int mechanicsVersion)
    {
        var gameCase = Case(mechanicsVersion);
        gameCase.Title = "Original case";
        gameCase.Characters = [new() { CharacterId = "suspect-1", Name = "Original suspect" }];
        gameCase.Clues = [new() { ClueId = "evidence-1", Title = "Original evidence", IsEvidence = true }];
        gameCase.FinalLogic.Motive = "Original motive";
        gameCase.FinalLogic.Method = "Original method";
        gameCase.FinalLogic.CorrectMotiveId = "motive-1";
        gameCase.FinalLogic.CorrectMethodId = "method-1";
        gameCase.FinalLogic.MotiveOptions = [new() { Id = "motive-1", Label = "Original motive" }];
        gameCase.FinalLogic.MethodOptions = [new() { Id = "method-1", Label = "Original method" }];
        gameCase.FinalLogic.RequiredEvidenceIds = ["evidence-1"];
        gameCase.FinalLogic.RequiredEvidenceLinks = [new() { ClaimType = "MOTIVE", EvidenceId = "evidence-1" }];
        gameCase.Presentation = new CasePresentation
        {
            PackageId = "original-package",
            Clips = [new() { Id = "ending", Kind = "ENDING", TargetId = "WON", Caption = "Original ending", PosterAssetId = "original-poster" },
                new() { Id = "intro", Kind = "INTRO", PosterAssetId = "intro-poster" }]
        };
        return gameCase;
    }

    private static FinalAccusationSnapshot CaptureHistoricalResult(GameCase gameCase) => GameResultFactory.CreateSnapshot(
        RoomWithState(), gameCase,
        new AccuseRequest
        {
            CulpritId = "suspect-1", MotiveId = "motive-1", MethodId = "method-1",
            EvidenceLinks = [new() { ClaimType = "MOTIVE", EvidenceId = "evidence-1" }]
        }, ["evidence-1"], true, new DateTime(2026, 9, 30, 0, 0, 0, DateTimeKind.Utc));

    private static void OverwriteHistoricalCase(GameCase gameCase)
    {
        gameCase.Title = "Replacement case";
        gameCase.MechanicsVersion = CaseMechanicsVersions.Legacy;
        gameCase.Characters[0].Name = "Replacement suspect";
        gameCase.Clues[0].Title = "Replacement evidence";
        gameCase.FinalLogic.CulpritId = "suspect-2";
        gameCase.FinalLogic.Motive = "Replacement motive";
        gameCase.FinalLogic.Method = "Replacement method";
        gameCase.FinalLogic.CorrectMotiveId = "motive-2";
        gameCase.FinalLogic.CorrectMethodId = "method-2";
        gameCase.FinalLogic.MotiveOptions[0].Label = "Replacement motive";
        gameCase.FinalLogic.MethodOptions[0].Label = "Replacement method";
        gameCase.FinalLogic.RequiredEvidenceIds[0] = "evidence-2";
        gameCase.FinalLogic.RequiredEvidenceLinks[0].EvidenceId = "evidence-2";
        gameCase.Presentation!.PackageId = "replacement-package";
        gameCase.Presentation.Clips[0].Caption = "Replacement ending";
        gameCase.Presentation.Clips[0].PosterAssetId = "replacement-poster";
    }

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
