using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;
using SirLocked.Api.Configurations;
using SirLocked.Api.DataAccess;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Auth;
using SirLocked.Api.Models;
using SirLocked.Api.Models.Enums;
using SirLocked.Api.Services.Interfaces;

namespace SirLocked.Api.Services;

public class AuthService : IAuthService
{
    public const string AdminEmail = "admin@sirlocked.local";
    public const string AdminDefaultPassword = "Admin123!";

    private readonly MongoDbContext _db;
    private readonly JwtSettings _jwt;
    private readonly ILogger<AuthService> _logger;
    private readonly IEmailService _email;
    private readonly AuthSettings _auth;

    public AuthService(
        MongoDbContext db,
        IOptions<JwtSettings> jwt,
        ILogger<AuthService> logger,
        IEmailService email,
        IOptions<AuthSettings> auth)
    {
        _db = db;
        _jwt = jwt.Value;
        _logger = logger;
        _email = email;
        _auth = auth.Value;
    }

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request)
    {
        var email = NormalizeEmail(request.Email);
        var existing = await _db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();
        if (existing is not null)
        {
            throw ApiException.Conflict("An account with this email already exists.");
        }

        // Development-only: skips the inbox round trip so API smoke tests can reach gameplay.
        // AuthSettings resolves this to false outside Development regardless of configuration.
        var autoVerify = _auth.AutoVerifyRegistrations;
        var verificationToken = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));

        var user = new User
        {
            FullName = request.FullName.Trim(),
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Player,
            Status = UserStatus.Active,
            EmailVerificationToken = autoVerify ? null : verificationToken,
            EmailVerificationTokenExpiry = autoVerify ? null : DateTime.UtcNow.AddHours(24),
            IsEmailVerified = autoVerify
        };

        try
        {
            await _db.Users.InsertOneAsync(user);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            throw ApiException.Conflict("An account with this email already exists.");
        }

        // Do not issue a successful onboarding response when the verification
        // message could not be delivered.
        if (!autoVerify)
        {
            try
            {
                await _email.SendVerificationEmailAsync(user.Email, user.FullName, verificationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send verification email to {Email}", user.Email);
                throw ex is ApiException apiException
                    ? apiException
                    : ApiException.BadGateway("Verification email delivery failed.");
            }
        }

        return await BuildAuthResponseAndSaveRefreshToken(user);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request)
    {
        var email = NormalizeEmail(request.Email);
        var user = await _db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();

        // Tài khoản đăng nhập bằng Google không có mật khẩu (hash rỗng).
        // Tránh BCrypt.Verify ném exception với hash rỗng → trả lỗi gọn gàng.
        if (user is null || string.IsNullOrEmpty(user.PasswordHash))
        {
            throw ApiException.Unauthorized("Invalid email or password.");
        }

        if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            throw ApiException.Unauthorized("Invalid email or password.");
        }

        if (user.Status != UserStatus.Active)
        {
            throw ApiException.Forbidden("This account is locked or deleted.");
        }

        return await BuildAuthResponseAndSaveRefreshToken(user);
    }

    public async Task<UserResponse> GetMeAsync(string userId)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");
        return ToUserResponse(user);
    }

    public async Task<AuthResponse> RefreshTokenAsync(RefreshTokenRequest request)
    {
        var tokenHash = HashRefreshToken(request.RefreshToken);
        var user = await _db.Users.Find(u => u.RefreshTokenHash == tokenHash || u.RefreshToken == request.RefreshToken).FirstOrDefaultAsync()
            ?? throw ApiException.Unauthorized("Invalid refresh token.");

        if (user.RefreshTokenExpiry < DateTime.UtcNow)
            throw ApiException.Unauthorized("Refresh token has expired. Please log in again.");

        if (user.Status != UserStatus.Active)
            throw ApiException.Forbidden("This account is locked or deleted.");

        return await BuildAuthResponseAndSaveRefreshToken(user, tokenHash);
    }

    public async Task<AuthResponse> GoogleLoginAsync(string email, string fullName)
    {
        email = NormalizeEmail(email);
        var user = await _db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();

        if (user is null)
        {
            // Tự động tạo tài khoản mới khi đăng nhập Google lần đầu
            user = new Models.User
            {
                FullName = fullName,
                Email = email,
                PasswordHash = string.Empty, // không dùng password với OAuth
                Role = UserRole.Player,
                Status = UserStatus.Active,
                IsEmailVerified = true // Google đã xác minh email rồi
            };
            await _db.Users.InsertOneAsync(user);
            _logger.LogInformation("New user registered via Google: {Email}", email);
        }
        else if (user.Status != UserStatus.Active)
        {
            throw ApiException.Forbidden("This account is locked or deleted.");
        }
        else if (!user.IsEmailVerified)
        {
            // Tự động verify email nếu đăng nhập qua Google
            var verifyUpdate = Builders<Models.User>.Update.Set(u => u.IsEmailVerified, true);
            await _db.Users.UpdateOneAsync(u => u.Id == user.Id, verifyUpdate);
            user.IsEmailVerified = true;
        }

        return await BuildAuthResponseAndSaveRefreshToken(user);
    }

    public async Task LogoutAsync(string userId)
    {
        // Thu hồi refresh token để token cũ không thể dùng tiếp sau khi đăng xuất
        var update = Builders<User>.Update
            .Set(u => u.RefreshToken, null)
            .Set(u => u.RefreshTokenExpiry, null)
            .Set(u => u.RefreshTokenHash, null)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);
    }

    public async Task<object> ForgotPasswordAsync(ForgotPasswordRequest request)
    {
        var email = NormalizeEmail(request.Email);
        var user = await _db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();

        // Không tiết lộ email có tồn tại hay không (bảo mật)
        if (user is null || user.Status != UserStatus.Active)
            return new { message = "If this email exists, a reset link has been sent." };

        var token = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        var expiry = DateTime.UtcNow.AddMinutes(30);

        var update = Builders<User>.Update
            .Set(u => u.ResetPasswordToken, token)
            .Set(u => u.ResetPasswordTokenExpiry, expiry)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == user.Id, update);

        // Gửi email chứa mã đặt lại mật khẩu
        try
        {
            await _email.SendPasswordResetEmailAsync(user.Email, user.FullName, token);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send reset email to {Email}", email);
            throw ex is ApiException apiException
                ? apiException
                : ApiException.BadGateway("Password reset email delivery failed.");
        }

        return new { message = "If this email exists, a reset code has been sent." };
    }

    public async Task ResetPasswordAsync(ResetPasswordRequest request)
    {
        var user = await _db.Users.Find(u => u.ResetPasswordToken == request.Token).FirstOrDefaultAsync()
            ?? throw ApiException.BadRequest("Invalid or expired reset token.");

        if (user.ResetPasswordTokenExpiry < DateTime.UtcNow)
            throw ApiException.BadRequest("Reset token has expired. Please request a new one.");

        var update = Builders<User>.Update
            .Set(u => u.PasswordHash, BCrypt.Net.BCrypt.HashPassword(request.NewPassword))
            .Set(u => u.ResetPasswordToken, null)
            .Set(u => u.ResetPasswordTokenExpiry, null)
            .Set(u => u.RefreshToken, null)
            .Set(u => u.RefreshTokenExpiry, null)
            .Set(u => u.RefreshTokenHash, null)
            .Inc(u => u.AuthorizationVersion, 1)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == user.Id, update);
    }

    public async Task<object> ResendVerificationAsync(string userId)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");

        if (user.IsEmailVerified)
            throw ApiException.BadRequest("Email is already verified.");

        var token = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));

        var update = Builders<User>.Update
            .Set(u => u.EmailVerificationToken, token)
            .Set(u => u.EmailVerificationTokenExpiry, DateTime.UtcNow.AddHours(24))
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);

        // Gửi lại email xác minh
        try
        {
            await _email.SendVerificationEmailAsync(user.Email, user.FullName, token);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send verification email to {Email}", user.Email);
            throw ex is ApiException apiException
                ? apiException
                : ApiException.BadGateway("Verification email delivery failed.");
        }

        return new { message = "A verification code has been sent to your email." };
    }

    public async Task VerifyEmailAsync(VerifyEmailRequest request)
    {
        var user = await _db.Users.Find(u => u.EmailVerificationToken == request.Token).FirstOrDefaultAsync()
            ?? throw ApiException.BadRequest("Invalid verification token.");

        if (user.EmailVerificationTokenExpiry < DateTime.UtcNow)
            throw ApiException.BadRequest("Liên kết xác minh đã hết hạn. Vui lòng yêu cầu gửi lại.");

        var update = Builders<User>.Update
            .Set(u => u.IsEmailVerified, true)
            .Set(u => u.EmailVerificationToken, null)
            .Set(u => u.EmailVerificationTokenExpiry, null)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        await _db.Users.UpdateOneAsync(u => u.Id == user.Id, update);
    }

    public async Task ChangePasswordAsync(string userId, ChangePasswordRequest request)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");

        if (string.IsNullOrWhiteSpace(user.PasswordHash))
            throw ApiException.BadRequest("This account uses Google sign-in and does not have a local password.");

        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
            throw ApiException.BadRequest("Current password is incorrect.");

        if (request.CurrentPassword == request.NewPassword)
            throw ApiException.BadRequest("New password must be different from current password.");

        var newHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        var update = Builders<User>.Update
            .Set(u => u.PasswordHash, newHash)
            .Set(u => u.RefreshToken, null)
            .Set(u => u.RefreshTokenExpiry, null)
            .Set(u => u.RefreshTokenHash, null)
            .Inc(u => u.AuthorizationVersion, 1)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);

        await _db.Users.UpdateOneAsync(u => u.Id == userId, update);
    }

    public async Task SeedAdminAsync(AdminSeedOptions options)
    {
        var existing = await _db.Users.Find(u => u.Role == UserRole.Admin).FirstOrDefaultAsync();
        if (existing is not null) return;

        if (string.IsNullOrWhiteSpace(options.Email) || string.IsNullOrWhiteSpace(options.Password))
        {
            throw new InvalidOperationException("Admin seed email and password must be configured when admin seeding is enabled.");
        }

        var admin = new User
        {
            FullName = string.IsNullOrWhiteSpace(options.FullName) ? "SirLocked Admin" : options.FullName.Trim(),
            Email = NormalizeEmail(options.Email),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(options.Password),
            Role = UserRole.Admin,
            Status = UserStatus.Active,
            IsEmailVerified = true
        };
        await _db.Users.InsertOneAsync(admin);
        _logger.LogInformation("Seeded admin account {Email}.", admin.Email);
    }

    private async Task<AuthResponse> BuildAuthResponseAndSaveRefreshToken(User user, string? expectedRefreshTokenHash = null)
    {
        var expiresAt = DateTime.UtcNow.AddHours(_jwt.ExpiryHours);
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.FullName),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim(User.AuthorizationVersionClaim, user.AuthorizationVersion.ToString(System.Globalization.CultureInfo.InvariantCulture))
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Secret));
        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        var refreshToken = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(64));
        var refreshTokenExpiry = DateTime.UtcNow.AddDays(7);

        var update = Builders<User>.Update
            .Set(u => u.RefreshToken, null)
            .Set(u => u.RefreshTokenHash, HashRefreshToken(refreshToken))
            .Set(u => u.RefreshTokenExpiry, refreshTokenExpiry)
            .Set(u => u.UpdatedAt, DateTime.UtcNow);
        var filter = expectedRefreshTokenHash is null
            ? Builders<User>.Filter.Eq(u => u.Id, user.Id)
            : Builders<User>.Filter.And(
                Builders<User>.Filter.Eq(u => u.Id, user.Id),
                Builders<User>.Filter.Or(
                    Builders<User>.Filter.Eq(u => u.RefreshTokenHash, expectedRefreshTokenHash),
                    Builders<User>.Filter.Eq(u => u.RefreshToken, user.RefreshToken)));
        var saved = await _db.Users.UpdateOneAsync(filter, update);
        if (expectedRefreshTokenHash is not null && saved.MatchedCount != 1)
            throw ApiException.Unauthorized("Refresh token has already been used. Please sign in again.");

        return new AuthResponse
        {
            Token = new JwtSecurityTokenHandler().WriteToken(token),
            ExpiresAt = expiresAt,
            RefreshToken = refreshToken,
            RefreshTokenExpiry = refreshTokenExpiry,
            User = ToUserResponse(user)
        };
    }

    private static UserResponse ToUserResponse(User user) => new()
    {
        UserId = user.Id,
        FullName = user.FullName,
        Email = user.Email,
        Role = user.Role,
        Status = user.Status,
        IsEmailVerified = user.IsEmailVerified,
        HasPassword = !string.IsNullOrWhiteSpace(user.PasswordHash),
        CreatedAt = user.CreatedAt
    };

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static string HashRefreshToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
}

public sealed record AdminSeedOptions(string Email, string Password, string FullName);
