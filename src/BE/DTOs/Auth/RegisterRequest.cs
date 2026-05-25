using System.ComponentModel.DataAnnotations;

namespace SirLocked.API.DTOs.Auth;

public sealed class RegisterRequest
{
    [Required]
    [MinLength(2)]
    public string FullName { get; init; } = string.Empty;

    [Required]
    [EmailAddress]
    public string Email { get; init; } = string.Empty;

    [Required]
    [MinLength(6)]
    public string Password { get; init; } = string.Empty;

    public string Role { get; init; } = "PLAYER";
}
