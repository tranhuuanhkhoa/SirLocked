using System.ComponentModel.DataAnnotations;

namespace SirLocked.API.DTOs.Users;

public sealed class UpdateProfileRequest
{
    [Required]
    [MinLength(2)]
    public string FullName { get; init; } = string.Empty;
}
