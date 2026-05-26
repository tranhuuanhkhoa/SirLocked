using SirLocked.API.DTOs.Admin;
using SirLocked.API.Models;
using SirLocked.API.Repositories;

namespace SirLocked.API.Services;

public sealed class AiCaseService : IAiCaseService
{
    private readonly IAiCaseRepository _drafts;

    public AiCaseService(IAiCaseRepository drafts)
    {
        _drafts = drafts;
    }

    public async Task<AiCaseDraftResponse> CreateDraftAsync(CreateAiCaseRequest request, CancellationToken cancellationToken = default)
    {
        var draft = new AiCaseDraft
        {
            Prompt = request.Prompt,
            Status = "DRAFT"
        };

        await _drafts.CreateDraftAsync(draft, cancellationToken);
        return new AiCaseDraftResponse
        {
            DraftId = draft.Id ?? string.Empty,
            Prompt = draft.Prompt,
            Status = draft.Status
        };
    }
}
