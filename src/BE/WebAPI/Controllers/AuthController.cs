using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.WebAPI;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/auth")]
public class AuthController : BaseApiController
{
    private readonly IAuthService _authService;
    private readonly FrontendRedirects _frontendRedirects;

    public AuthController(IAuthService authService, FrontendRedirects frontendRedirects)
    {
        _authService = authService;
        _frontendRedirects = frontendRedirects;
    }

    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("register")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Register([FromBody] RegisterRequest request) =>
        Ok(await _authService.RegisterAsync(request), "Account created.");

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Login([FromBody] LoginRequest request) =>
        Ok(await _authService.LoginAsync(request), "Logged in.");

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<UserResponse>>> Me() =>
        Ok(await _authService.GetMeAsync(CallerId));

    [HttpPost("refresh")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Refresh([FromBody] RefreshTokenRequest request) =>
        Ok(await _authService.RefreshTokenAsync(request), "Token refreshed.");

    [HttpGet("google")]
    [AllowAnonymous]
    public IActionResult GoogleLogin()
    {
        var redirectUrl = Url.Action(nameof(GoogleCallback), "Auth");
        var properties = new AuthenticationProperties
        {
            RedirectUri = redirectUrl
        };
        return Challenge(properties, GoogleDefaults.AuthenticationScheme);
    }

    [HttpGet("google/callback")]
    [AllowAnonymous]
    public async Task<IActionResult> GoogleCallback()
    {
        // Đọc danh tính từ cookie "External" mà Google middleware đã ghi
        var result = await HttpContext.AuthenticateAsync("External");
        if (!result.Succeeded)
            return Redirect(_frontendRedirects.LoginError("google_failed"));

        var email = result.Principal?.FindFirstValue(ClaimTypes.Email);
        var fullName = result.Principal?.FindFirstValue(ClaimTypes.Name) ?? "Google User";

        // Dọn cookie tạm sau khi đã lấy thông tin
        await HttpContext.SignOutAsync("External");

        if (string.IsNullOrEmpty(email))
            return Redirect(_frontendRedirects.LoginError("no_email"));

        var auth = await _authService.GoogleLoginAsync(email, fullName);

        // Redirect về frontend kèm token
        var redirectUrl = _frontendRedirects.OAuthCallback(auth.Token, auth.RefreshToken);
        return Redirect(redirectUrl);
    }

    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting("email")]
    public async Task<ActionResult<ApiResponse<object>>> ForgotPassword([FromBody] ForgotPasswordRequest request) =>
        Ok(await _authService.ForgotPasswordAsync(request), "Reset token generated.");

    [HttpPost("reset-password")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<object>>> ResetPassword([FromBody] ResetPasswordRequest request)
    {
        await _authService.ResetPasswordAsync(request);
        return Ok<object>(new { }, "Password reset successfully. You can now log in.");
    }

    [HttpPost("verify-email")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<object>>> VerifyEmail([FromBody] VerifyEmailRequest request)
    {
        await _authService.VerifyEmailAsync(request);
        return Ok<object>(new { }, "Email verified successfully.");
    }

    [HttpPost("resend-verification")]
    [Authorize]
    [EnableRateLimiting("email")]
    public async Task<ActionResult<ApiResponse<object>>> ResendVerification() =>
        Ok(await _authService.ResendVerificationAsync(CallerId), "Verification token generated.");

    [HttpPatch("change-password")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<object>>> ChangePassword([FromBody] ChangePasswordRequest request)
    {
        await _authService.ChangePasswordAsync(CallerId, request);
        return Ok<object>(new { }, "Password changed successfully.");
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<object>>> Logout()
    {
        // Thu hồi refresh token phía server; client cũng tự xóa JWT.
        await _authService.LogoutAsync(CallerId);
        return Ok<object>(new { loggedOut = true }, "Logged out.");
    }
}
