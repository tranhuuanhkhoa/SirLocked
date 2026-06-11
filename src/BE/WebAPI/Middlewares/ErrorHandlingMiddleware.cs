using System.Text.Json;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.WebAPI.Middlewares;

public class ErrorHandlingMiddleware
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly RequestDelegate _next;
    private readonly ILogger<ErrorHandlingMiddleware> _logger;

    public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (ApiException ex)
        {
            await WriteAsync(context, ex.StatusCode, ex.Message, ex.Errors);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception for {Method} {Path}", context.Request.Method, context.Request.Path);
            await WriteAsync(context, 500, "An unexpected server error occurred.");
        }
    }

    private static async Task WriteAsync(HttpContext context, int statusCode, string message, object? errors = null)
    {
        if (context.Response.HasStarted) return;
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json";
        var body = ApiResponse<object>.Fail(message, errors);
        await context.Response.WriteAsync(JsonSerializer.Serialize(body, JsonOptions));
    }
}
