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
}
