using SirLocked.Api.DTOs.Investigation;
using SirLocked.Api.DTOs.Room;
using SirLocked.Api.DTOs.Submission;

namespace SirLocked.Api.Services.Interfaces;

/// <summary>Broadcasts lobby/gameplay events to the SignalR room group.</summary>
public interface IGameNotifier
{
    // Lobby
    Task PlayerJoined(string roomId, string userId, RoomResponse room);
    Task PlayerLeft(string roomId, string userId, RoomResponse room);
    Task RolesUpdated(string roomId, string userId, RoomResponse room);
    Task ReadyUpdated(string roomId, string userId, RoomResponse room);
    Task GameStarted(string roomId, RoomResponse room);

    // Gameplay
    Task GameStateUpdated(string roomId, long version);
    Task ItemFound(string roomId, string itemId, string userId, long version);
    Task ClueUnlocked(string roomId, string clueId, string? sourceId, string userId, long version);
    Task DialogueAnswered(string roomId, string dialogueId, string userId, long version);
    Task EvidencePresented(string roomId, string dialogueId, string evidenceId, string userId, long version);
    Task InvestigationUpdate(string roomId, InvestigationUpdateDto update);
    Task SceneChanged(string roomId, string previousSceneId, string currentSceneId, string userId, long version);
    Task StageChanged(string roomId, string previousStageId, string currentStageId, string previousSceneId, string currentSceneId, bool isFinalStageCompleted, string userId, long version);
    Task GameCompleted(string roomId, GameResultResponse result);
    Task SystemMessage(string roomId, string message);
}
