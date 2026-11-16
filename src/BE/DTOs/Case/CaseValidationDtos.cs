namespace SirLocked.Api.DTOs.Case;

public class CaseValidationError
{
    public string Code { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? RefId { get; set; }
}

/// <summary>Validation codes of the hint rule: every scene, confrontation and deduction has hints at order 1, 2 and 3; every interactive puzzle has at least three solution hints.</summary>
public static class CaseHintCodes
{
    public const string MissingHintLevel = "MissingHintLevel";
    public const string DuplicateHintLevel = "DuplicateHintLevel";
    public const string MissingPuzzleHints = "MissingPuzzleHints";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        MissingHintLevel, DuplicateHintLevel, MissingPuzzleHints
    };
}

public class CaseValidationResult
{
    public bool IsValid => Errors.Count == 0;
    public List<CaseValidationError> Errors { get; set; } = new();
    /// <summary>Problems that do not block (for example a published case that predates the hint rule).</summary>
    public List<CaseValidationError> Warnings { get; set; } = new();

    public void Add(string code, string path, string message, string? refId = null) =>
        Errors.Add(new CaseValidationError { Code = code, Path = path, Message = message, RefId = refId });

    public void AddWarning(string code, string path, string message, string? refId = null) =>
        Warnings.Add(new CaseValidationError { Code = code, Path = path, Message = message, RefId = refId });

    /// <summary>
    /// Applies the hint rule (VUAN-6) strictly: hint warnings become errors. Used for new cases and AI drafts;
    /// cases that already existed keep them as warnings.
    /// </summary>
    public CaseValidationResult RequireHints()
    {
        var hintIssues = Warnings.Where(warning => CaseHintCodes.All.Contains(warning.Code)).ToList();
        foreach (var issue in hintIssues)
        {
            Warnings.Remove(issue);
            Errors.Add(issue);
        }
        return this;
    }

    public void Deduplicate() =>
        Errors = Errors
            .GroupBy(error => (error.Code, error.Path, error.RefId), StringTupleComparer.Ordinal)
            .Select(group => group.First())
            .ToList();

    private sealed class StringTupleComparer : IEqualityComparer<(string Code, string Path, string? RefId)>
    {
        public static readonly StringTupleComparer Ordinal = new();

        public bool Equals(
            (string Code, string Path, string? RefId) x,
            (string Code, string Path, string? RefId) y) =>
            string.Equals(x.Code, y.Code, StringComparison.Ordinal)
            && string.Equals(x.Path, y.Path, StringComparison.Ordinal)
            && string.Equals(x.RefId, y.RefId, StringComparison.Ordinal);

        public int GetHashCode((string Code, string Path, string? RefId) value) =>
            HashCode.Combine(
                StringComparer.Ordinal.GetHashCode(value.Code),
                StringComparer.Ordinal.GetHashCode(value.Path),
                value.RefId is null ? 0 : StringComparer.Ordinal.GetHashCode(value.RefId));
    }
}
