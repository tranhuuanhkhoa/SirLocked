using System.Text.Json;
using MongoDB.Bson;
using MongoDB.Bson.IO;
using MongoDB.Driver;
using SirLocked.Api.DTOs;
using SirLocked.Api.DTOs.Admin;
using SirLocked.Api.Models.Catalog;
using SirLocked.Api.Services.Catalog;

namespace SirLocked.Api.Services.Admin;

/// <summary>Filters of the audit log. Null or blank means "any".</summary>
public sealed record AdminAuditQuery(
    string? TargetType = null,
    string? TargetId = null,
    string? AdminId = null,
    string? Action = null,
    DateTime? From = null,
    DateTime? To = null,
    int Page = 1,
    int PageSize = AdminAuditService.DefaultPageSize);

/// <summary>Every admin write records itself here. See docs/admin-contracts.md.</summary>
public interface IAdminAudit
{
    /// <summary>
    /// Records one admin action, after it has been applied. <paramref name="before"/> and <paramref name="after"/> are
    /// what the target looked like, and are stored as JSON: a model, a BsonDocument, a DTO or an anonymous object all work.
    /// Pass them without secrets. A failed write throws, so the caller finds out the action went unrecorded.
    /// </summary>
    Task LogAsync(
        CurrentUser admin, string action, string targetType, string targetId,
        object? before, object? after, string? reason = null, CancellationToken ct = default);

    Task<AdminAuditPageDto> QueryAsync(AdminAuditQuery query, CancellationToken ct = default);
}

public sealed class AdminAuditService : IAdminAudit
{
    public const int DefaultPageSize = 50;
    public const int MaxPageSize = 200;

    private static readonly JsonWriterSettings RelaxedJson = new() { OutputMode = JsonOutputMode.RelaxedExtendedJson };

    private readonly CatalogStore _store;
    private readonly TimeProvider _time;

    public AdminAuditService(CatalogStore store, TimeProvider? time = null)
    {
        _store = store;
        _time = time ?? TimeProvider.System;
    }

    public Task LogAsync(
        CurrentUser admin, string action, string targetType, string targetId,
        object? before, object? after, string? reason = null, CancellationToken ct = default) =>
        _store.Audit.InsertOneAsync(new AdminAuditEntry
        {
            At = _time.GetUtcNow().UtcDateTime,
            AdminId = admin.Id,
            AdminName = admin.FullName,
            Action = action,
            TargetType = targetType,
            TargetId = targetId,
            Before = ToJson(before),
            After = ToJson(after),
            Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
        }, cancellationToken: ct);

    public async Task<AdminAuditPageDto> QueryAsync(AdminAuditQuery query, CancellationToken ct = default)
    {
        var page = Math.Max(1, query.Page);
        var pageSize = Math.Clamp(query.PageSize, 1, MaxPageSize);

        var filter = Builders<AdminAuditEntry>.Filter;
        var conditions = new List<FilterDefinition<AdminAuditEntry>>();
        if (!string.IsNullOrWhiteSpace(query.TargetType)) conditions.Add(filter.Eq(a => a.TargetType, query.TargetType));
        if (!string.IsNullOrWhiteSpace(query.TargetId)) conditions.Add(filter.Eq(a => a.TargetId, query.TargetId));
        if (!string.IsNullOrWhiteSpace(query.AdminId)) conditions.Add(filter.Eq(a => a.AdminId, query.AdminId));
        if (!string.IsNullOrWhiteSpace(query.Action)) conditions.Add(filter.Eq(a => a.Action, query.Action));
        if (query.From is { } from) conditions.Add(filter.Gte(a => a.At, from));
        if (query.To is { } to) conditions.Add(filter.Lte(a => a.At, to));
        var combined = conditions.Count == 0 ? filter.Empty : filter.And(conditions);

        var total = await _store.Audit.CountDocumentsAsync(combined, cancellationToken: ct);
        var entries = await _store.Audit.Find(combined)
            .SortByDescending(a => a.At).ThenByDescending(a => a.Id)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(ct);
        return new AdminAuditPageDto(entries.Select(ToDto).ToList(), page, pageSize, total);
    }

    private static AdminAuditEntryDto ToDto(AdminAuditEntry entry) => new(
        entry.Id, entry.At, entry.AdminId, entry.AdminName, entry.Action, entry.TargetType, entry.TargetId,
        Parse(entry.Before), Parse(entry.After), entry.Reason);

    private static JsonElement? Parse(string? json)
    {
        if (json is null) return null;
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    /// <summary>A stored model keeps the field names it has in the database, so the log reads like the document it describes.</summary>
    internal static string? ToJson(object? value) => value switch
    {
        null => null,
        JsonElement element => element.GetRawText(),
        BsonValue bson => bson.ToJson(RelaxedJson),
        _ => value.ToJson(value.GetType(), RelaxedJson),
    };
}
