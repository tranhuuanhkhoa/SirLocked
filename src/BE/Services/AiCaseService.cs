using System.Text.Json;
using SirLocked.API.DTOs.Admin;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class AiCaseService : IAiCaseService
{
    private readonly IAiCaseRepository _drafts;
    private readonly IDeepseekService _deepseek;

    public AiCaseService(IAiCaseRepository drafts, IDeepseekService deepseek)
    {
        _drafts = drafts;
        _deepseek = deepseek;
    }

    public async Task<AiCaseDraftResponse> CreateDraftAsync(CreateAiCaseRequest request, CancellationToken cancellationToken = default)
    {
        var generatedJson = await _deepseek.GenerateCaseJsonAsync(request, cancellationToken);
        var status = "DEEPSEEK_GENERATED";

        if (!TryNormalizeGeneratedCase(generatedJson, out generatedJson))
        {
            generatedJson = CreateMockCaseJson(request);
            status = "MOCK_GENERATED";
        }

        var draft = new AiCaseDraft
        {
            Prompt = request.Prompt,
            Status = status,
            GeneratedJson = generatedJson
        };

        await _drafts.CreateDraftAsync(draft, cancellationToken);
        return new AiCaseDraftResponse
        {
            DraftId = draft.Id ?? string.Empty,
            Prompt = draft.Prompt,
            Status = draft.Status,
            GeneratedJson = draft.GeneratedJson
        };
    }

    private static bool TryNormalizeGeneratedCase(string? generatedJson, out string normalizedJson)
    {
        normalizedJson = string.Empty;
        if (string.IsNullOrWhiteSpace(generatedJson))
        {
            return false;
        }

        try
        {
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            var gameCase = JsonSerializer.Deserialize<GameCase>(generatedJson, options);
            if (gameCase is null || string.IsNullOrWhiteSpace(gameCase.Title))
            {
                return false;
            }

            gameCase.CaseId = string.IsNullOrWhiteSpace(gameCase.CaseId)
                ? ("ai-draft-" + Guid.NewGuid().ToString("N"))[..17]
                : gameCase.CaseId;
            gameCase.Status = "DRAFT";
            normalizedJson = JsonSerializer.Serialize(gameCase, new JsonSerializerOptions { WriteIndented = true });
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static string CreateMockCaseJson(CreateAiCaseRequest request)
    {
        var draftCaseId = ("ai-draft-" + Guid.NewGuid().ToString("N"))[..17];
        var mockCase = CaseService.CreateSampleCase(draftCaseId);
        mockCase.Title = string.IsNullOrWhiteSpace(request.Prompt)
            ? mockCase.Title
            : $"AI Draft: {request.Prompt.Trim()}";
        mockCase.Summary = $"Mock AI draft generated from prompt: {request.Prompt.Trim()}";
        mockCase.Status = "DRAFT";
        return JsonSerializer.Serialize(mockCase, new JsonSerializerOptions { WriteIndented = true });
    }
}
