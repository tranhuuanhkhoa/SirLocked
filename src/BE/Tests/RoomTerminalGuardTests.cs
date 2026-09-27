using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services;
using SirLocked.Api.Services.Interfaces;
using Xunit;

namespace SirLocked.Tests;

/// <summary>
/// Locks the lobby entry points against COMPLETED/ABANDONED rooms. The room is served from memory
/// and lobby writes are intercepted, so every assertion is about the guard order, not about MongoDB.
/// </summary>
public class RoomTerminalGuardTests
{
    private static readonly CurrentUser Host = new("host-1", "Host", UserRole.Player);
    private static readonly CurrentUser Guest = new("guest-1", "Guest", UserRole.Player);
    private static readonly DateTime EndedAt = new(2026, 7, 20, 10, 0, 0, DateTimeKind.Utc);

    public static TheoryData<string> TerminalStatuses =>
        new() { RoomStatus.Completed, RoomStatus.Abandoned };

    [Theory]
    [MemberData(nameof(TerminalStatuses))]
    public async Task SelectRole_OnTerminalRoom_IsRefusedWithoutWriting(string status)
    {
        var service = ServiceFor(TerminalRoom(status), out var room, out var writes);

        var exception = await Assert.ThrowsAsync<ApiException>(() =>
            service.SelectRoleAsync(Host, room.Id, PlayerRole.Interrogator));

        Assert.Equal(409, exception.StatusCode);
        Assert.Equal(RoomService.RoomEndedMessage, exception.Message);
        Assert.Equal(
            new ApiErrorDetails(RoomService.RoomEndedCode, RoomService.RoomEndedMessageKey),
            exception.Errors);
        Assert.Empty(writes);
        Assert.Equal(status, room.Status);
        Assert.Equal(PlayerRole.Investigator, room.Players[0].Role);
    }

    [Theory]
    [MemberData(nameof(TerminalStatuses))]
    public async Task SetReady_OnTerminalRoom_IsRefusedWithoutWriting(string status)
    {
        var service = ServiceFor(TerminalRoom(status), out var room, out var writes);

        var exception = await Assert.ThrowsAsync<ApiException>(() =>
            service.SetReadyAsync(Host, room.Id, isReady: true));

        Assert.Equal(409, exception.StatusCode);
        Assert.Equal(RoomService.RoomEndedMessage, exception.Message);
        Assert.Empty(writes);
        Assert.Equal(status, room.Status);
    }

    // The regression this plan exists for: a finished run must survive a second start attempt.
    [Theory]
    [MemberData(nameof(TerminalStatuses))]
    public async Task Start_OnTerminalRoom_IsRefusedAndLeavesTheFinishedGameplayStateIntact(string status)
    {
        var service = ServiceFor(TerminalRoom(status), out var room, out var writes);
        var finished = room.GameplayState!;

        var exception = await Assert.ThrowsAsync<ApiException>(() => service.StartAsync(Host, room.Id));

        Assert.Equal(409, exception.StatusCode);
        Assert.Equal(RoomService.RoomEndedMessage, exception.Message);
        Assert.Empty(writes);
        Assert.Equal(status, room.Status);
        Assert.Same(finished, room.GameplayState);
        Assert.Equal(11, room.GameplayState!.Version);
        Assert.Equal(EndedAt, room.GameplayState.CompletedAt);
        Assert.Equal(GameStatus.Won, room.GameplayState.GameStatus);
        Assert.Equal(new[] { "clue-1" }, room.GameplayState.UnlockedClueIds);
        Assert.NotNull(room.GameplayState.FinalAccusationSnapshot);
    }

    [Theory]
    [MemberData(nameof(TerminalStatuses))]
    public async Task Leave_OnTerminalRoom_IsRefusedAndKeepsTheTerminalStatus(string status)
    {
        var service = ServiceFor(TerminalRoom(status), out var room, out var writes);

        var exception = await Assert.ThrowsAsync<ApiException>(() => service.LeaveAsync(Guest, room.Id));

        Assert.Equal(409, exception.StatusCode);
        Assert.Equal(RoomService.RoomEndedLeaveMessage, exception.Message);
        Assert.Equal(
            new ApiErrorDetails(RoomService.RoomEndedCode, RoomService.RoomEndedMessageKey),
            exception.Errors);
        Assert.Empty(writes);
        Assert.Equal(status, room.Status);
        Assert.Equal(2, room.Players.Count);
    }

    [Fact]
    public async Task InProgressRoom_KeepsItsOwnRefusalMessages()
    {
        var running = TerminalRoom(RoomStatus.InProgress);
        var service = ServiceFor(running, out var room, out var writes);

        var role = await Assert.ThrowsAsync<ApiException>(() =>
            service.SelectRoleAsync(Host, room.Id, PlayerRole.Interrogator));
        var start = await Assert.ThrowsAsync<ApiException>(() => service.StartAsync(Host, room.Id));
        var leave = await Assert.ThrowsAsync<ApiException>(() => service.LeaveAsync(Guest, room.Id));

        Assert.Equal(RoomService.GameAlreadyStartedMessage, role.Message);
        Assert.Equal(RoomService.GameAlreadyStartedMessage, start.Message);
        Assert.Equal(400, leave.StatusCode);
        Assert.Empty(writes);
    }

    [Fact]
    public async Task SelectRole_OnReadyRoom_DropsTheRoomBackToWaiting()
    {
        var service = ServiceFor(ReadyRoom(), out var room, out var writes);

        var response = await service.SelectRoleAsync(Guest, room.Id, PlayerRole.Interrogator);

        Assert.Equal(RoomStatus.Waiting, response.Status);
        Assert.Equal(RoomStatus.Waiting, room.Status);
        Assert.False(room.Players.Single(p => p.UserId == Guest.Id).IsReady);
        Assert.Equal(RoomLifecycle.LobbyStatuses.ToArray(), Assert.Single(writes).ExpectedStatuses.ToArray());
    }

    [Fact]
    public async Task SetReady_OnWaitingRoom_PromotesToReadyAndFiltersOnLobbyStatuses()
    {
        var waiting = ReadyRoom();
        waiting.Status = RoomStatus.Waiting;
        waiting.Players[1].IsReady = false;
        var service = ServiceFor(waiting, out var room, out var writes);

        var response = await service.SetReadyAsync(Guest, room.Id, isReady: true);

        Assert.Equal(RoomStatus.Ready, response.Status);
        Assert.Equal(RoomStatus.Ready, room.Status);
        Assert.Equal(RoomLifecycle.LobbyStatuses.ToArray(), Assert.Single(writes).ExpectedStatuses.ToArray());
    }

    [Fact]
    public async Task Start_OnReadyRoom_StillWorksAndFiltersOnStartableStatuses()
    {
        var service = ServiceFor(ReadyRoom(), out var room, out var writes);

        var response = await service.StartAsync(Host, room.Id);

        Assert.Equal(RoomStatus.InProgress, response.Status);
        Assert.Equal(RoomStatus.InProgress, room.Status);
        Assert.Equal(1, room.GameplayState!.Version);
        Assert.Equal("scene-1", room.GameplayState.CurrentSceneId);
        Assert.Equal(RoomLifecycle.StartableStatuses.ToArray(), Assert.Single(writes).ExpectedStatuses.ToArray());
    }

    [Fact]
    public async Task Leave_OnReadyRoom_StillWorksAndRecomputesToWaiting()
    {
        var service = ServiceFor(ReadyRoom(), out var room, out var writes);

        var response = await service.LeaveAsync(Guest, room.Id);

        Assert.NotNull(response);
        Assert.Equal(RoomStatus.Waiting, response!.Status);
        Assert.Equal(Host.Id, Assert.Single(room.Players).UserId);
        Assert.Equal(RoomLifecycle.LobbyStatuses.ToArray(), Assert.Single(writes).ExpectedStatuses.ToArray());
    }

    private static RecordingRoomService ServiceFor(
        GameRoom source,
        out GameRoom room,
        out IReadOnlyList<LobbyWrite> writes)
    {
        var service = new RecordingRoomService(source);
        room = source;
        writes = service.Writes;
        return service;
    }

    private static GameRoom ReadyRoom() => new()
    {
        Id = "507f1f77bcf86cd799439011",
        RoomCode = "ABCDEF",
        CaseId = "case-1",
        HostUserId = Host.Id,
        Status = RoomStatus.Ready,
        LobbyVersion = 4,
        Players = new List<RoomPlayer>
        {
            new() { UserId = Host.Id, Username = Host.FullName, Role = PlayerRole.Investigator, IsReady = true },
            new() { UserId = Guest.Id, Username = Guest.FullName, Role = PlayerRole.Interrogator, IsReady = true }
        }
    };

    private static GameRoom TerminalRoom(string status)
    {
        var room = ReadyRoom();
        room.Status = status;
        room.GameplayState = new GameplayState
        {
            CurrentStageId = "stage-1",
            CurrentSceneId = "scene-9",
            Version = 11,
            GameStatus = GameStatus.Won,
            UnlockedClueIds = new List<string> { "clue-1" },
            CompletedAt = EndedAt,
            FinalAccusationSnapshot = new FinalAccusationSnapshot
            {
                CaseId = room.CaseId,
                SelectedCulpritId = "suspect-1",
                Success = true,
                CompletedAt = EndedAt
            }
        };
        return room;
    }

    internal sealed record LobbyWrite(string Status, IReadOnlyCollection<string> ExpectedStatuses);

    private sealed class RecordingRoomService : RoomService
    {
        private readonly GameRoom _room;
        private readonly List<LobbyWrite> _writes = new();

        public RecordingRoomService(GameRoom room)
            : base(OfflineDbContext(), new StubCaseService(), new SilentNotifier()) => _room = room;

        public IReadOnlyList<LobbyWrite> Writes => _writes;

        protected override Task<GameRoom> RequireRoomAsync(string roomId) => Task.FromResult(_room);

        protected override Task<bool> TrySaveLobbyAsync(GameRoom room, IReadOnlyCollection<string> expectedStatuses)
        {
            _writes.Add(new LobbyWrite(room.Status, expectedStatuses));
            room.LobbyVersion++;
            return Task.FromResult(true);
        }

        // The client is never used: MongoDB connects lazily and every guard refuses before any query.
        private static MongoDbContext OfflineDbContext() => new(Options.Create(new MongoDbSettings
        {
            ConnectionString = "mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=1&directConnection=true",
            DatabaseName = "sirlocked_unit_offline"
        }));
    }

    private sealed class StubCaseService : ICaseService
    {
        public Task<GameCase> GetCaseAsync(string caseId) => Task.FromResult(new GameCase
        {
            CaseId = caseId,
            Title = "Stub Case",
            Status = CaseStatus.Published,
            Stages = new List<CaseStage>
            {
                new()
                {
                    StageId = "stage-1",
                    Order = 1,
                    Scenes = new List<CaseScene> { new() { SceneId = "scene-1" } }
                }
            }
        });

        public Task<GameCase?> FindCaseAsync(string caseId) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> GetPublishedAsync() => throw new NotSupportedException();
        public Task<CasePublicDetailResponse> GetPublicDetailAsync(string caseId) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> GetAllForAdminAsync() => throw new NotSupportedException();
        public CaseValidationResponse ValidateJson(JsonElement caseJson) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> ImportJsonAsync(JsonElement caseJson, bool overwrite, bool preserveServerMetadata = false) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> PublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> UnpublishAsync(string caseId) => throw new NotSupportedException();
        public Task<CaseSummaryResponse> SeedSampleAsync(bool publish) => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedDemoAsync() => throw new NotSupportedException();
        public Task<List<CaseSummaryResponse>> SeedCrackDemoAsync() => throw new NotSupportedException();
        public GameCase ParseCase(JsonElement caseJson) => throw new NotSupportedException();
        public GameCase ParseCase(string caseJson) => throw new NotSupportedException();
    }

    private sealed class SilentNotifier : IGameNotifier
    {
        public Task PlayerJoined(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task PlayerLeft(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task RolesUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task ReadyUpdated(string roomId, string userId, RoomResponse room) => Task.CompletedTask;
        public Task GameStarted(string roomId, RoomResponse room) => Task.CompletedTask;
        public Task GameStateUpdated(string roomId, long version) => Task.CompletedTask;
        public Task ItemFound(string roomId, string itemId, string userId, long version) => Task.CompletedTask;
        public Task ClueUnlocked(string roomId, string clueId, string? sourceId, string userId, long version) => Task.CompletedTask;
        public Task DialogueAnswered(string roomId, string dialogueId, string userId, long version) => Task.CompletedTask;
        public Task EvidencePresented(string roomId, string dialogueId, string evidenceId, string userId, long version) => Task.CompletedTask;
        public Task InvestigationUpdate(string roomId, InvestigationUpdateDto update) => Task.CompletedTask;
        public Task SceneChanged(string roomId, string previousSceneId, string currentSceneId, string userId, long version) => Task.CompletedTask;
        public Task StageChanged(string roomId, string previousStageId, string currentStageId, string previousSceneId, string currentSceneId, bool isFinalStageCompleted, string userId, long version) => Task.CompletedTask;
        public Task GameCompleted(string roomId, GameResultResponse result) => Task.CompletedTask;
        public Task SystemMessage(string roomId, string message) => Task.CompletedTask;
    }
}
