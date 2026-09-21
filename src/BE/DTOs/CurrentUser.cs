namespace SirLocked.Api.DTOs;

/// <summary>Authenticated caller identity taken from JWT claims.</summary>
public record CurrentUser(string Id, string FullName, string Role);
