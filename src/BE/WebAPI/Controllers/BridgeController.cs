using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using SirLocked.Api.Configurations;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Case;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Bridge;

namespace SirLocked.Api.WebAPI.Controllers;

/// <summary>
/// Authenticates the Claude bot by the <c>X-Bridge-Key</c> header only. JWTs are ignored here, and the key opens no
/// other API. Without a configured key every bridge call answers 503 BRIDGE_NOT_CONFIGURED. The header value is never
/// logged.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class BridgeKeyAttribute : Attribute, IAuthorizationFilter
{
    public const string HeaderName = "X-Bridge-Key";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var settings = context.HttpContext.RequestServices.GetRequiredService<IOptions<BridgeSettings>>().Value;
        if (!settings.IsConfigured)
        {
            context.Result = Fail(StatusCodes.Status503ServiceUnavailable,
                "The Claude bridge is not configured on this server.", "BRIDGE_NOT_CONFIGURED");
            return;
        }
        var supplied = context.HttpContext.Request.Headers[HeaderName].ToString();
        if (string.IsNullOrEmpty(supplied) || !KeysMatch(supplied, settings.Key))
            context.Result = Fail(StatusCodes.Status401Unauthorized, "A valid X-Bridge-Key header is required.", "BRIDGE_KEY_INVALID");
    }

    /// <summary>Constant-time comparison of fixed-length digests, so neither content nor length leaks through timing.</summary>
    internal static bool KeysMatch(string supplied, string expected) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(supplied.Trim())),
            SHA256.HashData(Encoding.UTF8.GetBytes(expected.Trim())));

    private static ObjectResult Fail(int status, string message, string code) =>
        new(ApiResponse<object>.Fail(message, new ApiErrorDetails(code, $"ai.bridge.{code.ToLowerInvariant()}")))
        {
            StatusCode = status
        };
}

[Route("api/bridge")]
[AllowAnonymous]
[BridgeKey]
[EnableRateLimiting("bridge")]
public sealed class BridgeController(
    AiBridgeService bridge,
    AssetLibraryService library,
    IBridgeAssetStorage assetStorage,
    IOptions<BridgeSettings> settings) : BaseApiController
{
    /// <summary>Checks the key; also says whether pictures can be uploaded (Cloudinary, or local storage outside Production).</summary>
    [HttpGet("ping")]
    public ActionResult<ApiResponse<object>> Ping() =>
        Ok<object>(new { ok = true, serverTime = DateTime.UtcNow, assetStorage = assetStorage.IsAvailable }, "Bridge key accepted.");

    [HttpGet("requests")]
    public async Task<ActionResult<ApiResponse<List<object>>>> List(
        [FromQuery] string? status = "PENDING", [FromQuery] int limit = 100, [FromQuery] string? lane = null,
        CancellationToken ct = default) =>
        Ok(await bridge.ListRequestsAsync(status, limit, ct, lane));

    [HttpPost("requests/{id}/take")]
    public async Task<ActionResult<ApiResponse<object>>> Take(string id, [FromQuery] string? lane, CancellationToken ct) =>
        Ok(await bridge.TakeAsync(id, ct, lane), "Request taken.");

    [HttpPost("requests/{id}/release")]
    public async Task<ActionResult<ApiResponse<object>>> Release(string id, CancellationToken ct) =>
        Ok(await bridge.ReleaseAsync(id, ct), "Request released.");

    /// <summary>draft_ask: puts a question with 2-4 options to the creator; the request waits until they answer.</summary>
    [HttpPost("requests/{id}/ask")]
    public async Task<ActionResult<ApiResponse<object>>> Ask(
        string id, [FromBody] AiDecisionAskRequest body, [FromServices] AiDecisionService decisions, CancellationToken ct)
    {
        var decision = await decisions.AskAsync(id, body, ct);
        return Ok<object>(new { decisionId = decision.Id, status = AiBridgeStatuses.AwaitingDecision }, "Question sent to the creator.");
    }

    /// <summary>Body: the answer JSON object itself, or <c>{ "json": ... }</c>.</summary>
    [HttpPost("requests/{id}/submit")]
    public async Task<ActionResult<ApiResponse<BridgeSubmitResult>>> Submit(string id, [FromBody] JsonElement body, CancellationToken ct)
    {
        var answer = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("json", out var wrapped) && CountProperties(body) == 1
            ? wrapped
            : body;
        var result = await bridge.SubmitAsync(id, answer, ct);
        return Ok(result, result.Accepted ? "Answer accepted." : "Answer refused by the schema check.");
    }

    [HttpGet("drafts/{id}")]
    public async Task<ActionResult<ApiResponse<object>>> Draft(string id, CancellationToken ct) =>
        Ok(await bridge.GetDraftAsync(id, ct));

    [HttpGet("drafts/{id}/player-view")]
    public async Task<ActionResult<ApiResponse<JsonObject>>> PlayerView(string id, CancellationToken ct) =>
        Ok(await bridge.PlayerViewAsync(id, ct));

    /// <summary>The whole case JSON with the solution, for the bot's local playtest (never shown to players).</summary>
    [HttpGet("drafts/{id}/case-json")]
    public async Task<ActionResult<ApiResponse<object>>> CaseJson(string id, CancellationToken ct) =>
        Ok(await bridge.CaseJsonAsync(id, ct));

    [HttpGet("drafts/{id}/assets-needed")]
    public async Task<ActionResult<ApiResponse<object>>> AssetsNeeded(string id, CancellationToken ct) =>
        Ok(await bridge.AssetsNeededAsync(id, ct));

    /// <summary>
    /// Pixel drafts (VUAN-6B): <c>{ "choices": [{ "subject": "scene:&lt;id&gt;", "source": "LIBRARY", "libraryKey": "v-case-pho" }] }</c>.
    /// Returns the PixelLab request plan; 409 AI_PIXELLAB_CAP_EXCEEDED when it needs more than the order's pixelLabCap.
    /// </summary>
    [HttpPut("drafts/{id}/asset-plan")]
    public async Task<ActionResult<ApiResponse<object>>> PutAssetPlan(string id, [FromBody] BridgeAssetPlanRequest request, CancellationToken ct) =>
        Ok(await bridge.PutAssetPlanAsync(id, request.Choices, ct), "Asset plan accepted.");

    /// <summary>Multipart form: <c>slotId</c> and <c>file</c> (PNG or WebP).</summary>
    [HttpPost("drafts/{id}/assets")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult<ApiResponse<AiBridgeAssetUpload>>> UploadAsset(
        string id, [FromForm] string slotId, IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            throw ApiException.BadRequest("Attach the picture as the 'file' form field.");
        if (file.Length > settings.Value.MaxAssetBytes)
            throw ApiException.BadRequest($"Images may be at most {settings.Value.MaxAssetBytes / (1024 * 1024)} MB.",
                new ApiErrorDetails("ASSET_TOO_LARGE", "ai.bridge.assetTooLarge"));
        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        return Ok(await bridge.UploadAssetAsync(id, slotId, buffer.ToArray(), ct), "Image stored.");
    }

    [HttpPost("drafts/{id}/assets/complete")]
    public async Task<ActionResult<ApiResponse<BridgeSubmitResult>>> CompleteAssets(string id, CancellationToken ct)
    {
        var result = await bridge.CompleteAssetsAsync(id, ct);
        return Ok(result, result.Accepted ? "Images complete; the pipeline continues." : "Some images are missing.");
    }

    /// <summary>Body: <c>{ "markdown": "..." }</c>.</summary>
    [HttpPut("drafts/{id}/report")]
    public async Task<ActionResult<ApiResponse<object>>> PutReport(string id, [FromBody] BridgeReportRequest request, CancellationToken ct) =>
        Ok(await bridge.PutReportAsync(id, request.Markdown, ct), "Report saved.");

    /// <summary>Body: <c>{ "gate": "STORY" | "LOGIC" | "LAYOUT" }</c>. Fast review mode only; never the truth gate.</summary>
    [HttpPost("drafts/{id}/approve-gate")]
    public async Task<ActionResult<ApiResponse<object>>> ApproveGate(string id, [FromBody] BridgeGateRequest request, CancellationToken ct) =>
        Ok(await bridge.ApproveGateAsync(id, request.Gate, ct), "Gate approved by the bot (fast mode).");

    /// <summary>Imports an unpublished copy for the playtest. The bridge has no publish endpoint.</summary>
    [HttpPost("drafts/{id}/import")]
    public async Task<ActionResult<ApiResponse<CaseSummaryResponse>>> Import(string id, CancellationToken ct) =>
        Ok(await bridge.ImportAsync(id, ct), "Draft imported, not published.");

    /// <summary>The studio's view of the library; retired pictures are included unless <c>includeRetired=false</c>.</summary>
    [HttpGet("library")]
    public async Task<ActionResult<ApiResponse<List<AssetLibraryEntry>>>> Library(
        [FromQuery] string? world, [FromQuery] string? kind, [FromQuery] bool includeRetired = true, CancellationToken ct = default) =>
        Ok(await library.ListAsync(world, kind, includeRetired, ct));

    /// <summary>
    /// Multipart form: <c>key</c> (library key), <c>role</c> (<c>main</c>, <c>thumb</c>, <c>sprite</c>, <c>idle</c>,
    /// <c>portrait</c>, <c>mask</c>...) and <c>file</c> (PNG or WebP). Stores the picture (Cloudinary on the server) and
    /// returns its URL; the bot then writes the URL into the library entry with PUT library.
    /// </summary>
    [HttpPost("library/files")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<ActionResult<ApiResponse<BridgeLibraryFile>>> UploadLibraryFile(
        [FromForm] string key, [FromForm] string role, IFormFile? file, CancellationToken ct)
    {
        var normalizedKey = (key ?? string.Empty).Trim();
        if (normalizedKey.Length is 0 or > 120 || normalizedKey.Any(char.IsWhiteSpace))
            throw ApiException.BadRequest("key must be a library key without spaces (at most 120 characters).",
                new ApiErrorDetails("ASSET_LIBRARY_INVALID", "ai.library.invalid"));
        var normalizedRole = (role ?? string.Empty).Trim().ToLowerInvariant();
        if (!AssetLibraryService.IsSafeRole(normalizedRole))
            throw ApiException.BadRequest("role must be 1-40 lowercase letters, digits or dashes.",
                new ApiErrorDetails("ASSET_LIBRARY_INVALID", "ai.library.invalid"));
        if (file is null || file.Length == 0)
            throw ApiException.BadRequest("Attach the picture as the 'file' form field.");
        if (file.Length > settings.Value.MaxAssetBytes)
            throw ApiException.BadRequest($"Images may be at most {settings.Value.MaxAssetBytes / (1024 * 1024)} MB.",
                new ApiErrorDetails("ASSET_TOO_LARGE", "ai.bridge.assetTooLarge"));
        await using var stream = file.OpenReadStream();
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, ct);
        return Ok(await assetStorage.SaveLibraryAsync(normalizedKey, normalizedRole, buffer.ToArray(), ct), "Library image stored.");
    }

    [HttpPut("library")]
    [RequestSizeLimit(4 * 1024 * 1024)]
    public async Task<ActionResult<ApiResponse<AssetLibraryUpsertResult>>> PutLibrary(
        [FromBody] AssetLibraryUpsertRequest request, CancellationToken ct) =>
        Ok(await library.UpsertAsync(request, ct), "Library updated.");

    private static int CountProperties(JsonElement element)
    {
        var count = 0;
        foreach (var _ in element.EnumerateObject()) count++;
        return count;
    }
}

public sealed class BridgeReportRequest
{
    public string Markdown { get; set; } = string.Empty;
}

public sealed class BridgeGateRequest
{
    public string Gate { get; set; } = string.Empty;
}

public sealed class BridgeAssetPlanRequest
{
    public List<AiAssetChoice> Choices { get; set; } = new();
}
