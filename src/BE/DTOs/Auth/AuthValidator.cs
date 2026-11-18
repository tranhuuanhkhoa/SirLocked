using System.Net.Mail;
using System.Text.RegularExpressions;

namespace SirLocked.Api.DTOs.Auth;

/// <summary>Reusable validation for every public authentication command.</summary>
public static class AuthValidator
{
    private static readonly Regex PasswordPattern = new(PasswordPolicy.Pattern, RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));

    public static void Register(RegisterRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        Name(request.FullName, errors);
        Email(request.Email, errors);
        Password(request.Password, "password", errors);
        ThrowIfInvalid(errors);
    }

    public static void Login(LoginRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        Email(request.Email, errors);
        Required(request.Password, "password", "Vui lòng nhập mật khẩu.", errors);
        if (request.Password?.Length > 100) errors["password"] = ["Mật khẩu không hợp lệ."];
        ThrowIfInvalid(errors);
    }

    public static void ForgotPassword(ForgotPasswordRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        Email(request.Email, errors);
        ThrowIfInvalid(errors);
    }

    public static void Refresh(RefreshTokenRequest request) => Token(request.RefreshToken, "refreshToken", 256);
    public static void VerifyEmail(VerifyEmailRequest request) => Token(request.Token, "token", 256);

    public static void ResetPassword(ResetPasswordRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        Required(request.Token, "token", "Liên kết đặt lại mật khẩu không hợp lệ.", errors);
        if (request.Token?.Length > 256) errors["token"] = ["Liên kết đặt lại mật khẩu không hợp lệ."];
        Password(request.NewPassword, "newPassword", errors);
        ThrowIfInvalid(errors);
    }

    public static void ChangePassword(ChangePasswordRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        Required(request.CurrentPassword, "currentPassword", "Vui lòng nhập mật khẩu hiện tại.", errors);
        if (request.CurrentPassword?.Length > 100) errors["currentPassword"] = ["Mật khẩu hiện tại không hợp lệ."];
        Password(request.NewPassword, "newPassword", errors);
        if (!string.IsNullOrEmpty(request.CurrentPassword) && request.CurrentPassword == request.NewPassword)
            errors["newPassword"] = ["Mật khẩu mới phải khác mật khẩu hiện tại."];
        ThrowIfInvalid(errors);
    }

    private static void Name(string? value, Dictionary<string, string[]> errors)
    {
        var length = value?.Trim().Length ?? 0;
        if (length < 2 || length > 80)
            errors["fullName"] = ["Họ và tên phải có từ 2 đến 80 ký tự."];
    }

    private static void Email(string? value, Dictionary<string, string[]> errors)
    {
        var email = value?.Trim();
        if (string.IsNullOrEmpty(email) || email.Length > 160 || email.Any(char.IsWhiteSpace)
            || !MailAddress.TryCreate(email, out var parsed) || !string.Equals(parsed.Address, email, StringComparison.OrdinalIgnoreCase)
            || !parsed.Host.Contains('.'))
            errors["email"] = ["Vui lòng nhập địa chỉ email hợp lệ."];
    }

    private static void Password(string? value, string field, Dictionary<string, string[]> errors)
    {
        if (value is null || !PasswordPattern.IsMatch(value))
            errors[field] = ["Mật khẩu phải có 6–100 ký tự, gồm ít nhất một chữ cái và một chữ số."];
    }

    private static void Required(string? value, string field, string message, Dictionary<string, string[]> errors)
    {
        if (string.IsNullOrWhiteSpace(value)) errors[field] = [message];
    }

    private static void Token(string? value, string field, int maxLength)
    {
        var errors = new Dictionary<string, string[]>();
        Required(value, field, "Mã xác thực không hợp lệ.", errors);
        if (value?.Length > maxLength) errors[field] = ["Mã xác thực không hợp lệ."];
        ThrowIfInvalid(errors);
    }

    private static void ThrowIfInvalid(Dictionary<string, string[]> errors)
    {
        if (errors.Count > 0)
            throw ApiException.BadRequest("Vui lòng kiểm tra thông tin đã nhập.", errors);
    }
}
