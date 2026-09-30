using SirLocked.Api.Models;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public partial class AiCaseService
{
    internal async Task<AiProviderHttpResponse> AccountedResponseAsync(
        string draftId, string step, string kind, string model, Func<Task<AiProviderHttpResponse>> send)
    {
        var lease = _usageAccounting is null ? null
            : await _usageAccounting.BeforeCallAsync(draftId, step, kind, model, _operationCancellationToken);
        AiProviderHttpResponse? response = null;
        try { return response = await send(); }
        finally { await RecordUsageSafelyAsync(lease, response?.Body, response?.StatusCode); }
    }

    internal async Task<HttpResponseMessage> AccountedImageAsync(
        string draftId, string step, string model, Func<Task<HttpResponseMessage>> send)
    {
        var lease = _usageAccounting is null ? null
            : await _usageAccounting.BeforeCallAsync(draftId, step, "image", model, _operationCancellationToken);
        HttpResponseMessage? response = null;
        string? body = null;
        try
        {
            response = await send();
            body = await response.Content.ReadAsStringAsync(_operationCancellationToken);
            return response;
        }
        catch { response?.Dispose(); throw; }
        finally { await RecordUsageSafelyAsync(lease, body, response is null ? null : (int)response.StatusCode); }
    }

    private async Task RecordUsageSafelyAsync(AiCallLease? lease, string? body, int? status)
    {
        if (lease is null || _usageAccounting is null) return;
        // A cancelled caller must not skip accounting for a request the provider may have executed.
        using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        try { await _usageAccounting.RecordAsync(lease, body, status, cleanup.Token); }
        catch (Exception exception)
        {
            // Keep the reservation unresolved rather than pretend a missing usage record cost zero.
            _logger.LogError(exception, "AI usage reconciliation pending for call {CallId}.", lease.Id);
        }
    }
}
