namespace SirLocked.Api.DTOs.Admin;

// Accounts an admin creates, edits, deletes and restores on /admin/players. The answer lists its fields by hand, like
// every admin DTO: no hash and no token. The two requests carry the new password the admin typed (inbound only).

public sealed record AdminAccountDto(
    string UserId,
    string FullName,
    string Email,
    string Role,
    string Status,
    bool IsEmailVerified,
    DateTime CreatedAt);

public sealed class AdminCreateAccountRequest
{
    public string? FullName { get; set; }
    public string? Email { get; set; }
    /// <summary>The password the admin gives the player; only its hash is stored.</summary>
    public string? NewPassword { get; set; }
    /// <summary>PLAYER (default), VIP, or ADMIN (the "Quản trị" tab).</summary>
    public string? Role { get; set; }
    public string? Reason { get; set; }
}

public sealed class AdminUpdateAccountRequest
{
    public string? FullName { get; set; }
    public string? Email { get; set; }
    public string? Reason { get; set; }
}

public sealed class AdminSetPasswordRequest
{
    public string? NewPassword { get; set; }
    public string? Reason { get; set; }
}
