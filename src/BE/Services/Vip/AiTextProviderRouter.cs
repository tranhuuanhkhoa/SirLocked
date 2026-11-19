using MongoDB.Driver;
using SirLocked.Api.DataAccess;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services.Vip;

/// <summary>
/// The pipeline's one <see cref="IAiTextProvider"/>: paid VIP orders (<see cref="AiDraftLanes.VipApi"/>) go to the
/// Claude API lane, everything else (ADMIN orders, drafts made before VUAN-7) to the ADMIN bot through the bridge.
/// A cutscene follows the lane of the draft its case came from.
/// </summary>
public sealed class AiTextProviderRouter(
    ClaudeBridgeTextProvider bridge,
    ClaudeApiTextProvider api,
    MongoDbContext db) : IAiTextProvider
{
    private readonly Dictionary<string, string> _lanes = new(StringComparer.Ordinal);

    public async Task<string> GenerateJsonAsync(AiTextRequest request, CancellationToken cancellationToken = default) =>
        await LaneAsync(request, cancellationToken) == AiDraftLanes.VipApi
            ? await api.GenerateJsonAsync(request, cancellationToken)
            : await bridge.GenerateJsonAsync(request, cancellationToken);

    private async Task<string> LaneAsync(AiTextRequest request, CancellationToken ct)
    {
        var cacheKey = request.OwnerType + ":" + request.OwnerId;
        if (_lanes.TryGetValue(cacheKey, out var known)) return known;
        var draftId = request.OwnerId;
        if (request.OwnerType == AiBridgeOwnerTypes.Cutscene)
            draftId = await db.Cases.Find(item => item.CaseId == request.OwnerId)
                .Project(item => item.SourceAiDraftId)
                .FirstOrDefaultAsync(ct) ?? string.Empty;
        var lane = string.IsNullOrWhiteSpace(draftId)
            ? AiDraftLanes.Bridge
            : await db.AiCaseDrafts.Find(item => item.Id == draftId).Project(item => item.Lane).FirstOrDefaultAsync(ct)
              ?? AiDraftLanes.Bridge;
        _lanes[cacheKey] = lane;
        return lane;
    }
}
