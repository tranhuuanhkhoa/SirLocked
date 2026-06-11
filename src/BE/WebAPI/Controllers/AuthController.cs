using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/auth")]
public class AuthController : BaseApiController
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService) => _authService = authService;

    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Register([FromBody] RegisterRequest request) =>
        Ok(await _authService.RegisterAsync(request), "Account created.");

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Login([FromBody] LoginRequest request) =>
        Ok(await _authService.LoginAsync(request), "Logged in.");

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<UserResponse>>> Me() =>
        Ok(await _authService.GetMeAsync(CallerId));

    [HttpPost("logout")]
    [Authorize]
    public ActionResult<ApiResponse<object>> Logout() =>
        // JWTs are stateless; the client discards the token.
        Ok<object>(new { loggedOut = true }, "Logged out.");
}
