using System.IdentityModel.Tokens.Jwt;
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

    public AuthService(MongoDbContext db, IOptions<JwtSettings> jwt, ILogger<AuthService> logger)
    {
        _db = db;
        _jwt = jwt.Value;
        _logger = logger;
    }

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request)
    {
        var email = NormalizeEmail(request.Email);
        var existing = await _db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();
        if (existing is not null)
        {
            throw ApiException.Conflict("An account with this email already exists.");
        }

        var user = new User
        {
            FullName = request.FullName.Trim(),
            Email = email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Player, // public registration always creates PLAYER
            Status = UserStatus.Active
        };

        try
        {
            await _db.Users.InsertOneAsync(user);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            throw ApiException.Conflict("An account with this email already exists.");
        }

        return BuildAuthResponse(user);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request)
    {
        var email = NormalizeEmail(request.Email);
        var user = await _db.Users.Find(u => u.Email == email).FirstOrDefaultAsync();
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            throw ApiException.Unauthorized("Invalid email or password.");
        }

        if (user.Status != UserStatus.Active)
        {
            throw ApiException.Forbidden("This account is locked or deleted.");
        }

        return BuildAuthResponse(user);
    }

    public async Task<UserResponse> GetMeAsync(string userId)
    {
        var user = await _db.Users.Find(u => u.Id == userId).FirstOrDefaultAsync()
            ?? throw ApiException.NotFound("User not found.");
        return ToUserResponse(user);
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
            Status = UserStatus.Active
        };
        await _db.Users.InsertOneAsync(admin);
        _logger.LogInformation("Seeded admin account {Email}.", admin.Email);
    }

    private AuthResponse BuildAuthResponse(User user)
    {
        var expiresAt = DateTime.UtcNow.AddHours(_jwt.ExpiryHours);
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.FullName),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role)
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Secret));
        var token = new JwtSecurityToken(
            issuer: _jwt.Issuer,
            audience: _jwt.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return new AuthResponse
        {
            Token = new JwtSecurityTokenHandler().WriteToken(token),
            ExpiresAt = expiresAt,
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
        CreatedAt = user.CreatedAt
    };

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();
}

public sealed record AdminSeedOptions(string Email, string Password, string FullName);
