using Microsoft.AspNetCore.SignalR;
using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI.Hubs;

namespace SirLocked.Api.Services;

public class GameNotifier : IGameNotifier
{
    private readonly IHubContext<GameHub> _hub;

    public GameNotifier(IHubContext<GameHub> hub) => _hub = hub;

    private IClientProxy Group(string roomId) => _hub.Clients.Group(GameHub.RoomGroup(roomId));

    public Task PlayerJoined(string roomId, string userId, RoomResponse room) =>
        Group(roomId).SendAsync("PlayerJoined", new { roomId, userId, room });

    public Task PlayerLeft(string roomId, string userId, RoomResponse room) =>
        Group(roomId).SendAsync("PlayerLeft", new { roomId, userId, room });

    public Task RolesUpdated(string roomId, string userId, RoomResponse room) =>
        Group(roomId).SendAsync("RolesUpdated", new { roomId, userId, room });

    public Task ReadyUpdated(string roomId, string userId, RoomResponse room) =>
        Group(roomId).SendAsync("ReadyUpdated", new { roomId, userId, room });

    public Task GameStarted(string roomId, RoomResponse room) =>
        Group(roomId).SendAsync("GameStarted", new { roomId, room });

    public Task GameStateUpdated(string roomId, long version) =>
        Group(roomId).SendAsync("GameStateUpdated", BuildGameStateUpdatedPayload(roomId, version));

    internal static GameStateVersionUpdateDto BuildGameStateUpdatedPayload(string roomId, long version) =>
        new(roomId, version);

    public Task ItemFound(string roomId, string itemId, string userId, long version) =>
        Group(roomId).SendAsync("ItemFound", new { roomId, itemId, userId, version });

    public Task ClueUnlocked(string roomId, string clueId, string? sourceId, string userId, long version) =>
        Group(roomId).SendAsync("ClueUnlocked", new { roomId, clueId, sourceId, userId, version });

    public Task DialogueAnswered(string roomId, string dialogueId, string userId, long version) =>
        Group(roomId).SendAsync("DialogueAnswered", new { roomId, dialogueId, userId, version });

    public Task EvidencePresented(string roomId, string dialogueId, string evidenceId, string userId, long version) =>
        Group(roomId).SendAsync("EvidencePresented", new { roomId, dialogueId, evidenceId, userId, version });

    public Task InvestigationUpdate(string roomId, InvestigationUpdateDto update) =>
        Group(roomId).SendAsync("InvestigationUpdate", update);

    public Task SceneChanged(string roomId, string previousSceneId, string currentSceneId, string userId, long version) =>
        Group(roomId).SendAsync("SceneChanged", new { roomId, previousSceneId, currentSceneId, userId, version });

    public Task StageChanged(string roomId, string previousStageId, string currentStageId, string previousSceneId, string currentSceneId, bool isFinalStageCompleted, string userId, long version) =>
        Group(roomId).SendAsync("StageChanged", new { roomId, previousStageId, currentStageId, previousSceneId, currentSceneId, isFinalStageCompleted, userId, version });

    public Task GameCompleted(string roomId, GameResultResponse result) =>
        Group(roomId).SendAsync("GameCompleted", result);

    public Task SystemMessage(string roomId, string message) =>
        Group(roomId).SendAsync("SystemMessageReceived", new { roomId, message, createdAt = DateTime.UtcNow });
}
