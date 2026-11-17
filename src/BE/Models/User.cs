using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using SirLocked.Api.Models.Enums;

namespace SirLocked.Api.Models;

[BsonIgnoreExtraElements]
public class User
{
    public const string AuthorizationVersionClaim = "authz_ver";

    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = UserRole.Player;
    public string Status { get; set; } = UserStatus.Active;
    /// <summary>Incremented when role/status/credentials change so issued JWTs can be revoked immediately.</summary>
    public long AuthorizationVersion { get; set; }
    public string? RefreshToken { get; set; }
    /// <summary>Only the hash is persisted for newly issued refresh tokens.</summary>
    public string? RefreshTokenHash { get; set; }
    public DateTime? RefreshTokenExpiry { get; set; }
    /// <summary>Only the hash is persisted for newly issued password reset tokens.</summary>
    public string? ResetPasswordToken { get; set; }
    public string? ResetPasswordTokenHash { get; set; }
    public DateTime? ResetPasswordTokenExpiry { get; set; }
    /// <summary>Only the hash is persisted for newly issued email verification tokens.</summary>
    public string? EmailVerificationToken { get; set; }
    public string? EmailVerificationTokenHash { get; set; }
    public DateTime? EmailVerificationTokenExpiry { get; set; }
    public bool IsEmailVerified { get; set; } = false;
    /// <summary>"VETERAN" or "BEGINNER", picked once after sign-up (null until then; see TutorialRules).</summary>
    [BsonIgnoreIfNull]
    public string? ExperiencePath { get; set; }
    /// <summary>When the newcomer tutorial was finished (won or lost). Null until then.</summary>
    [BsonIgnoreIfNull]
    public DateTime? TutorialCompletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
