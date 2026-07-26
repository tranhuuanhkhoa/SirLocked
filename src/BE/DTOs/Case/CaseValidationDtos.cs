namespace SirLocked.Api.DTOs.Case;

public class CaseValidationError
{
    public string Code { get; set; } = string.Empty;
    public string Path { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? RefId { get; set; }
}

public class CaseValidationResult
{
    public bool IsValid => Errors.Count == 0;
    public List<CaseValidationError> Errors { get; set; } = new();

    public void Add(string code, string path, string message, string? refId = null) =>
        Errors.Add(new CaseValidationError { Code = code, Path = path, Message = message, RefId = refId });

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
