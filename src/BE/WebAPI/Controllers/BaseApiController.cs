using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;

namespace SirLocked.Api.WebAPI.Controllers;

[ApiController]
public abstract class BaseApiController : ControllerBase
{
    protected CurrentUser Caller => new(
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw ApiException.Unauthorized(),
        User.FindFirstValue(ClaimTypes.Name) ?? "Unknown",
        User.FindFirstValue(ClaimTypes.Role) ?? "PLAYER");

    protected string CallerId => Caller.Id;

    protected ActionResult<ApiResponse<T>> Ok<T>(T data, string? message = null) =>
        base.Ok(ApiResponse<T>.Ok(data, message));

    protected ActionResult<ApiResponse<T>> Accepted<T>(T data, string? message = null) =>
        base.Accepted(ApiResponse<T>.Ok(data, message));
}
