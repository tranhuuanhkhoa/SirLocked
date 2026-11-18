using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SirLocked.Api.Models;

/// <summary>Why a saved copy of a case exists in the editor history (Case Studio, /admin/editor).</summary>
public static class CaseEditorRevisionKinds
{
    /// <summary>The case as the bot imported it, saved the first time the editor opened it.</summary>
    public const string Original = "ORIGINAL";
    /// <summary>The editor pressed "Lưu phiên bản".</summary>
    public const string Checkpoint = "CHECKPOINT";
    /// <summary>Saved automatically just before an older version was restored over it.</summary>
    public const string BeforeRestore = "BEFORE_RESTORE";
    /// <summary>The exact case that was published from the editor.</summary>
    public const string Publish = "PUBLISH";
    /// <summary>The edited case, kept when an import (the bot or /admin/import) overwrote it.</summary>
    public const string BeforeImport = "BEFORE_IMPORT";
}

/// <summary>
/// One edited case: a version number that every save bumps (optimistic concurrency between two open editors) and the
/// number the next saved copy gets. The case itself stays in <c>cases</c>; this only tracks the editing.
/// </summary>
[BsonIgnoreExtraElements]
public class CaseEditorState
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string CaseId { get; set; } = string.Empty;
    /// <summary>Bumped by every save, restore and publish. A save that names an older version is refused (409).</summary>
    public int Version { get; set; } = 1;
    public int NextRevision { get; set; } = 1;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string UpdatedByUserId { get; set; } = string.Empty;
    public string UpdatedByName { get; set; } = string.Empty;
}

/// <summary>A full copy of a case at one moment of editing, so any version can be compared with and restored.</summary>
[BsonIgnoreExtraElements]
public class CaseEditorRevision
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = string.Empty;

    public string CaseId { get; set; } = string.Empty;
    public int Number { get; set; }
    public string Kind { get; set; } = CaseEditorRevisionKinds.Checkpoint;
    public string Note { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    /// <summary>The editor version the copy was taken at.</summary>
    public int EditorVersion { get; set; }
    public int ErrorCount { get; set; }
    public int WarningCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedByUserId { get; set; } = string.Empty;
    public string CreatedByName { get; set; } = string.Empty;
    /// <summary>The whole case as camelCase JSON (the same shape as the admin case JSON).</summary>
    public string CaseJson { get; set; } = string.Empty;
}
