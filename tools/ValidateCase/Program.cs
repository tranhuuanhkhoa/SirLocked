using System.Security.Cryptography;
using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services;

if (args.Length is < 1 or > 2)
{
    Console.Error.WriteLine("Usage: ValidateCase <case.json> [validation-report.json]");
    return 2;
}

var path = Path.GetFullPath(args[0]);
var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true };
var source = await File.ReadAllBytesAsync(path);
var gameCase = JsonSerializer.Deserialize<GameCase>(source, options)
    ?? throw new InvalidDataException("Case JSON is empty.");
var validation = new CaseValidationService().Validate(gameCase);
var report = JsonSerializer.Serialize(new
{
    caseId = gameCase.CaseId,
    sourceSha256 = Convert.ToHexStringLower(SHA256.HashData(source)),
    validator = nameof(CaseValidationService),
    validation.IsValid,
    validation.Errors,
    scope = "Authoritative schema, reference, runtime and reachability validation; no database or provider calls. Asset files and browser gameplay require separate checks."
}, options);
Console.WriteLine(report);
if (args.Length == 2)
{
    var output = Path.GetFullPath(args[1]);
    if (string.Equals(output, path, StringComparison.OrdinalIgnoreCase))
        throw new ArgumentException("Report path must differ from the input case JSON.");
    Directory.CreateDirectory(Path.GetDirectoryName(output)!);
    await File.WriteAllTextAsync(output, report + Environment.NewLine);
}
return validation.IsValid ? 0 : 1;
