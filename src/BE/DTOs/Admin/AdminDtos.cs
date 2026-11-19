using System.Text.Json;

namespace SirLocked.Api.DTOs.Admin;

public sealed record AdminAuditEntryDto(
    string Id,
    DateTime At,
    string AdminId,
    string AdminName,
    string Action,
    string TargetType,
    string TargetId,
    JsonElement? Before,
    JsonElement? After,
    string? Reason);

public sealed record AdminAuditPageDto(
    IReadOnlyList<AdminAuditEntryDto> Items,
    int Page,
    int PageSize,
    long Total);

/// <summary>A picture stored for admin use. Width and height are in pixels.</summary>
public sealed record AdminAssetDto(string Url, int Width, int Height);
