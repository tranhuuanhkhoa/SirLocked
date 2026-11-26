namespace SirLocked.Api.DTOs;

/// <summary>
/// Authenticated caller identity taken from JWT claims. AdminRole is the "admin_role" claim of an ADMIN; null (an older
/// token, or code acting on its own) counts as SUPER_ADMIN, as the admin policies read it.
/// </summary>
public record CurrentUser(string Id, string FullName, string Role, string? AdminRole = null);
