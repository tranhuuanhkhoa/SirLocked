using System.Text.Json;
using SirLocked.API.DTOs.Investigation;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class GameplayService : IGameplayService
{
    private readonly IGameplayRepository _gameplayRepository;

    public GameplayService(IGameplayRepository gameplayRepository)
    {
        _gameplayRepository = gameplayRepository;
    }

    public Task<GameStateResponse> GetStateAsync(string roomId, CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new GameStateResponse
        {
            RoomId = roomId,
            Status = "WEEK_1_SCAFFOLD"
        });
    }

    public async Task<GameStateResponse> InspectItemAsync(string roomId, string userId, InspectItemRequest request, CancellationToken cancellationToken = default)
    {
        await _gameplayRepository.AddActionLogAsync(new GameActionLog
        {
            RoomId = roomId,
            UserId = userId,
            ActionType = "inspect_item_scaffold",
            PayloadJson = JsonSerializer.Serialize(request)
        }, cancellationToken);

        return new GameStateResponse
        {
            RoomId = roomId,
            Status = "ITEM_INSPECT_SCAFFOLD",
            FoundItemIds = [request.ItemId]
        };
    }

    public async Task<GameResultResponse> AccuseAsync(string roomId, string userId, AccuseRequest request, CancellationToken cancellationToken = default)
    {
        var result = new GameResult
        {
            RoomId = roomId,
            Success = false,
            Accusation = new FinalAccusation
            {
                CulpritId = request.CulpritId,
                Motive = request.Motive,
                Method = request.Method,
                EvidenceIds = request.EvidenceIds
            }
        };

        await _gameplayRepository.AddResultAsync(result, cancellationToken);
        return new GameResultResponse
        {
            ResultId = result.Id ?? string.Empty,
            RoomId = roomId,
            Success = false,
            Message = "Week 1 scaffold only. Final accusation logic starts later."
        };
    }
}
