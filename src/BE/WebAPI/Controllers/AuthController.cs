using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;
using SirLocked.Api.Services.Security;
using SirLocked.Api.WebAPI;

namespace SirLocked.Api.WebAPI.Controllers;

[Route("api/auth")]
public class AuthController : BaseApiController
{
    private readonly IAuthService _authService;
    private readonly FrontendRedirects _frontendRedirects;
    private readonly IAdminSecurityOperations _adminSecurity;

    public AuthController(IAuthService authService, FrontendRedirects frontendRedirects, IAdminSecurityOperations adminSecurity)
    {
        _authService = authService;
        _frontendRedirects = frontendRedirects;
        _adminSecurity = adminSecurity;
    }

    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("register")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Register([FromBody] RegisterRequest request)
    {
        var auth = await _authService.RegisterAsync(request);
        AuthCookies.SetRefresh(Response, auth.RefreshToken, auth.RefreshTokenExpiry);
        return Ok(auth, "Account created.");
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Login([FromBody] LoginRequest request)
    {
        var auth = await _authService.LoginAsync(request);
        AuthCookies.SetRefresh(Response, auth.RefreshToken, auth.RefreshTokenExpiry);
        return Ok(auth, "Logged in.");
    }

    [HttpPost("admin/login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> AdminLogin([FromBody] LoginRequest request)
    {
        var auth = await _authService.AdminLoginAsync(request);
        AuthCookies.SetRefresh(Response, auth.RefreshToken, auth.RefreshTokenExpiry);
        return Ok(auth, "Logged in.");
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<UserResponse>>> Me() =>
        Ok(await _authService.GetMeAsync(CallerId));

    [HttpPost("refresh")]
    [AllowAnonymous]
    [EnableRateLimiting("auth-token")]
    public async Task<ActionResult<ApiResponse<AuthResponse>>> Refresh(
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] RefreshTokenRequest? request)
    {
        var cookieToken = Request.Cookies[AuthCookies.RefreshCookieName];
        string? refreshToken;
        if (!string.IsNullOrWhiteSpace(cookieToken))
        {
            if (!string.Equals(Request.Headers["X-SirLocked-Client"].ToString(), "web", StringComparison.Ordinal))
                throw ApiException.Forbidden("The required client header is missing.", "CSRF_HEADER_MISSING", "auth.csrfHeaderMissing");
            refreshToken = cookieToken;
        }
        else
        {
            refreshToken = request?.RefreshToken;
        }

        if (string.IsNullOrWhiteSpace(refreshToken))
            throw ApiException.Unauthorized("Refresh token is required.");

        var auth = await _authService.RefreshTokenAsync(new RefreshTokenRequest { RefreshToken = refreshToken });
        AuthCookies.SetRefresh(Response, auth.RefreshToken, auth.RefreshTokenExpiry);
        return Ok(auth, "Token refreshed.");
    }

    [HttpGet("google")]
    [AllowAnonymous]
    public async Task<IActionResult> GoogleLogin()
    {
        var schemeProvider = HttpContext.RequestServices.GetRequiredService<IAuthenticationSchemeProvider>();
        if (await schemeProvider.GetSchemeAsync(GoogleDefaults.AuthenticationScheme) is null)
            return Redirect(_frontendRedirects.LoginError("google_unavailable"));

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

        AuthResponse auth;
        try
        {
            auth = await _authService.GoogleLoginAsync(email, fullName);
        }
        catch (ApiException exception) when (exception.Errors is ApiErrorDetails { Code: "ADMIN_2FA_REQUIRED" })
        {
            return Redirect(_frontendRedirects.LoginError("admin_2fa_required"));
        }

        AuthCookies.SetRefresh(Response, auth.RefreshToken, auth.RefreshTokenExpiry);
        return Redirect(_frontendRedirects.OAuthCallback());
    }

    [HttpPost("admin/2fa/setup")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AdminTwoFactorSetupResponse>>> SetupAdminTwoFactor(CancellationToken ct) =>
        Ok(await _adminSecurity.SetupAsync(Caller, ct));

    [HttpPost("admin/2fa/enable")]
    [Authorize(Roles = UserRole.Admin)]
    public async Task<ActionResult<ApiResponse<AdminTwoFactorEnableResponse>>> EnableAdminTwoFactor(
        [FromBody] AdminTwoFactorCodeRequest request, CancellationToken ct) =>
        Ok(await _adminSecurity.EnableAsync(Caller, request.Code, ct));

    [HttpPost("admin/2fa/disable")]
    [Authorize(Roles = UserRole.Admin)]
    [RequireAdminStepUp]
    public async Task<ActionResult<ApiResponse<bool>>> DisableAdminTwoFactor(
        [FromBody] AdminTwoFactorCodeRequest request, CancellationToken ct)
    {
        await _adminSecurity.DisableAsync(Caller, request.Code, ct);
        return Ok(true);
    }

    [HttpPost("admin/step-up")]
    [Authorize(Roles = UserRole.Admin)]
    [EnableRateLimiting("login")]
    public async Task<ActionResult<ApiResponse<AdminStepUpResponse>>> StepUp(
        [FromBody] AdminStepUpRequest request, CancellationToken ct) =>
        Ok(await _adminSecurity.StepUpAsync(CallerId, request.Password, request.TwoFactorCode, ct));

    [HttpPost("forgot-password")]
    [AllowAnonymous]
    [EnableRateLimiting("email")]
    public async Task<ActionResult<ApiResponse<object>>> ForgotPassword([FromBody] ForgotPasswordRequest request) =>
        Ok(await _authService.ForgotPasswordAsync(request), "Reset token generated.");

    [HttpPost("reset-password")]
    [AllowAnonymous]
    [EnableRateLimiting("auth-token")]
    public async Task<ActionResult<ApiResponse<object>>> ResetPassword([FromBody] ResetPasswordRequest request)
    {
        await _authService.ResetPasswordAsync(request);
        return Ok<object>(new { }, "Password reset successfully. You can now log in.");
    }

    [HttpPost("verify-email")]
    [AllowAnonymous]
    [EnableRateLimiting("auth-token")]
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
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<object>>> Logout()
    {
        var refreshToken = Request.Cookies[AuthCookies.RefreshCookieName];
        AuthCookies.ClearRefresh(Response);

        if (User.Identity?.IsAuthenticated == true)
        {
            await _authService.LogoutAsync(CallerId);
        }
        else if (!string.IsNullOrWhiteSpace(refreshToken))
        {
            if (!await _authService.LogoutByRefreshTokenAsync(refreshToken))
                throw ApiException.Unauthorized();
        }
        else
        {
            throw ApiException.Unauthorized();
        }

        return Ok<object>(new { loggedOut = true }, "Logged out.");
    }
}
