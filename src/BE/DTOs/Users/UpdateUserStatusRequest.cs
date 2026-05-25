using System.ComponentModel.DataAnnotations;

namespace SirLocked.API.DTOs.Users;

public sealed class UpdateUserStatusRequest
{
    [Required]
    public string Status { get; init; } = string.Empty;
}
