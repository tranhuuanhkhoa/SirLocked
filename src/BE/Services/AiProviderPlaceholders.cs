using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using SirLocked.API.Configurations;
using SirLocked.API.DTOs.Admin;

namespace SirLocked.API.Services;

public interface IDeepseekService
{
    Task<string?> GenerateCaseJsonAsync(CreateAiCaseRequest request, CancellationToken cancellationToken = default);
}

public interface IGeminiService;
public interface IChatGptImageService;
public interface ICloudinaryService;

public sealed class DeepseekService : IDeepseekService
{
    private readonly HttpClient _httpClient;
    private readonly AiSettings _settings;

    public DeepseekService(HttpClient httpClient, IOptions<AiSettings> settings)
    {
        _httpClient = httpClient;
        _settings = settings.Value;
    }

    public async Task<string?> GenerateCaseJsonAsync(CreateAiCaseRequest request, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_settings.DeepseekApiKey))
        {
            return null;
        }

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, "https://api.deepseek.com/chat/completions");
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.DeepseekApiKey);

        var payload = new
        {
            model = "deepseek-chat",
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content = "You generate JSON only. Return one SirLocked GameCase object with properties matching the C# model: caseId,title,summary,status,estimatedMinutes,stages,characters,items,clues,dialogues,finalLogic. Use status DRAFT. Include at least 2 stages, 3 characters, 3 items, 3 clues, and finalLogic with culpritId,motive,method,requiredEvidenceIds."
                },
                new
                {
                    role = "user",
                    content = $"Create a detective case idea: {request.Prompt}. Stage count target: {request.StageCount}. Visual style: {request.VisualStyle}."
                }
            },
            temperature = 0.7,
            stream = false
        };

        httpRequest.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var content = document.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString();

        return StripJsonFence(content);
    }

    private static string? StripJsonFence(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        var firstLineBreak = trimmed.IndexOf('\n');
        var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        return firstLineBreak >= 0 && lastFence > firstLineBreak
            ? trimmed[(firstLineBreak + 1)..lastFence].Trim()
            : trimmed;
    }
}

public sealed class GeminiService : IGeminiService;
public sealed class ChatGptImageService : IChatGptImageService;
public sealed class CloudinaryService : ICloudinaryService;
