using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public sealed class AiOpenAiClient : IAiOpenAiClient
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly OpenAiSettings _settings;

    public AiOpenAiClient(IHttpClientFactory httpClientFactory, IOptions<OpenAiSettings> settings)
    {
        _httpClientFactory = httpClientFactory;
        _settings = settings.Value;
    }

    public async Task<AiProviderHttpResponse> PostStructuredJsonAsync(
        object payload,
        CancellationToken cancellationToken = default)
    {
        var client = _httpClientFactory.CreateClient(AiCaseService.OpenAiHttpClientName);
        client.Timeout = TimeSpan.FromSeconds(Math.Clamp(_settings.TimeoutSeconds, 30, 1800));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _settings.ApiKey);

        using var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        using var response = await client.PostAsync(
            $"{_settings.BaseUrl.TrimEnd('/')}/responses",
            content,
            cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        return new AiProviderHttpResponse((int)response.StatusCode, response.IsSuccessStatusCode, body);
    }
}
