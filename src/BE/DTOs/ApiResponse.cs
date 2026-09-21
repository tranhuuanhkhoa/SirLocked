namespace SirLocked.Api.DTOs;

/// <summary>Consistent envelope for every API response.</summary>
public class ApiResponse<T>
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public T? Data { get; set; }
    public object? Errors { get; set; }

    public static ApiResponse<T> Ok(T data, string? message = null) =>
        new() { Success = true, Data = data, Message = message };

    public static ApiResponse<T> Fail(string message, object? errors = null) =>
        new() { Success = false, Message = message, Errors = errors };
}

public class ApiException : Exception
{
    public int StatusCode { get; }
    public object? Errors { get; }

    public ApiException(int statusCode, string message, object? errors = null) : base(message)
    {
        StatusCode = statusCode;
        Errors = errors;
    }

    public static ApiException BadRequest(string message, object? errors = null) => new(400, message, errors);
    public static ApiException Unauthorized(string message = "Unauthorized.") => new(401, message);
    public static ApiException Forbidden(string message = "You are not allowed to do that.") => new(403, message);
    public static ApiException NotFound(string message) => new(404, message);
    public static ApiException Conflict(string message, object? errors = null) => new(409, message, errors);
    public static ApiException Unprocessable(string message, object? errors = null) => new(422, message, errors);
    public static ApiException BadGateway(string message) => new(502, message);

    public static ApiException NotFound(string message, string code, string messageKey) =>
        new(404, message, new ApiErrorDetails(code, messageKey));

    public static ApiException Conflict(string message, string code, string messageKey) =>
        new(409, message, new ApiErrorDetails(code, messageKey));

    public static ApiException Forbidden(string message, string code, string messageKey) =>
        new(403, message, new ApiErrorDetails(code, messageKey));
}

public sealed record ApiErrorDetails(string Code, string MessageKey);
