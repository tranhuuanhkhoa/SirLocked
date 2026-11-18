using SirLocked.Api.DTOs;
using SirLocked.Api.Models;

namespace SirLocked.Api.Services.Cutscene;

public static class AiIntroCutsceneStatuses
{
    public const string Queued = "QUEUED";
    public const string Skipped = "SKIPPED";
    public const string Exists = "EXISTS";
    public const string Failed = "FAILED";
}

public interface IAiIntroCutsceneStarter
{
    /// <summary>Queues the intro cutscene of an imported case. Never throws; returns one of <see cref="AiIntroCutsceneStatuses"/>.</summary>
    Task<string> StartAsync(AiDraftSettings settings, string caseId, CancellationToken ct);
}

/// <summary>
/// After an OPEN_COOP_1 draft is imported, asks for its intro cutscene (the bot writes it through the bridge, like
/// the admin "Generate" button). Older drafts are left alone. A failure is reported back, never thrown, so the
/// import always stands; the admin can still generate the cutscene by hand.
/// </summary>
public sealed class AiIntroCutsceneStarter(Func<string, CancellationToken, Task> generate) : IAiIntroCutsceneStarter
{
    private const int MaxError = 300;

    public async Task<string> StartAsync(AiDraftSettings settings, string caseId, CancellationToken ct)
    {
        if (!AiPipelineVersions.IsOpenCoop(settings)) return AiIntroCutsceneStatuses.Skipped;
        try
        {
            await generate(caseId, ct);
            return AiIntroCutsceneStatuses.Queued;
        }
        catch (ApiException exception) when (exception.StatusCode == 409)
        {
            return AiIntroCutsceneStatuses.Exists;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var message = exception.Message.Length > MaxError ? exception.Message[..MaxError] : exception.Message;
            return $"{AiIntroCutsceneStatuses.Failed}: {message}";
        }
    }
}
