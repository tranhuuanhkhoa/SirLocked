namespace SirLocked.Api.Services.Interfaces;

public sealed record AiProviderHttpResponse(int StatusCode, bool IsSuccess, string Body);

public interface IAiOpenAiClient
{
    Task<AiProviderHttpResponse> PostStructuredJsonAsync(object payload, CancellationToken cancellationToken = default);
}
