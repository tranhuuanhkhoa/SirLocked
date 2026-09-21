using SirLocked.Api.DTOs.Ai;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Interfaces;

public interface IAiAssetPipeline
{
    Task<AiDraftResponse> ExecuteAsync(
        AiCaseDraft draft,
        bool finalAssets,
        bool forceRegenerate,
        CancellationToken cancellationToken);
}
