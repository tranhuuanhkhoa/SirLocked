using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SirLocked.Api.Models;
using SirLocked.Api.Services.Projection;

var mode = GetOption("--mode") ?? "mock";
var output = GetOption("--output");
var maxUsdText = GetOption("--max-usd") ?? "5";
if (!decimal.TryParse(maxUsdText, System.Globalization.NumberStyles.Number,
        System.Globalization.CultureInfo.InvariantCulture, out var maxUsd) || maxUsd <= 0 || maxUsd > 5)
{
    Console.Error.WriteLine("--max-usd must be a positive value no greater than 5.");
    return 2;
}
var reserveUsdText = GetOption("--reserve-usd") ?? Environment.GetEnvironmentVariable("SIRLOCKED_BENCHMARK_RESERVATION_USD");
var hasSafeReserve = decimal.TryParse(reserveUsdText, System.Globalization.NumberStyles.Number,
    System.Globalization.CultureInfo.InvariantCulture, out var reserveUsd)
    && reserveUsd > 0 && reserveUsd <= maxUsd;
var corpusHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
    "short/normal/full|en/vi|V2/V3|unknown-evidence-id|duplicate-claim-proof|missing-claim-proof|causal-reference-mismatch"))).ToLowerInvariant();

object report;
var exitCode = 0;
if (mode.Equals("mock", StringComparison.OrdinalIgnoreCase))
{
    var rows = AiPromptBenchmark.Run();
    var passed = rows.All(row => row.CompiledEquivalent && row.MissingNarrativeFacts == 0 && row.ProjectionErrors == 0
        && row.CompactSchemaBytes < row.LegacySchemaBytes && row.CompactOutputBytes < row.LegacyOutputBytes);
    report = new
    {
        mode = "mock",
        model = "configured-baseline (mock: provider not called)",
        promptVersion = AiGenerationSchemaVersions.Prompt,
        schemaVersion = "ai-case-benchmark-v1",
        validatorVersion = "blind-review-validator-v1",
        compilerVersion = "projection-compiler-current",
        corpusHash,
        measurement = "UTF-8 bytes; not tokenizer tokens, provider cost, or live acceptance rate",
        corpus = "12 deterministic fixtures: short/normal/full x English/Vietnamese x V2/V3",
        negativeFixtures = new[] { "unknown-evidence-id", "duplicate-claim-proof", "missing-claim-proof", "causal-reference-mismatch" },
        completed = rows.Count,
        total = rows.Count,
        liveCostUsd = (decimal?)null,
        knownCostUsd = (decimal?)null,
        unknownCostUsd = (decimal?)null,
        costPerAcceptedCaseUsd = (decimal?)null,
        rows,
        status = passed ? "PASSED" : "FAILED",
        passed
    };
    exitCode = passed ? 0 : 1;
}
else if (mode.Equals("live", StringComparison.OrdinalIgnoreCase)
         || mode.Equals("resume", StringComparison.OrdinalIgnoreCase))
{
    var baseUrl = GetOption("--base-url") ?? Environment.GetEnvironmentVariable("SIRLOCKED_BENCHMARK_BASE_URL");
    var token = Environment.GetEnvironmentVariable("SIRLOCKED_BENCHMARK_TOKEN");
    if (string.IsNullOrWhiteSpace(baseUrl) || string.IsNullOrWhiteSpace(token))
    {
        report = LiveBenchmarkRunner.Blocked(mode, maxUsd,
            "Set SIRLOCKED_BENCHMARK_BASE_URL and SIRLOCKED_BENCHMARK_TOKEN. No provider call was attempted.");
        exitCode = 2;
    }
    else if (!hasSafeReserve)
    {
        report = LiveBenchmarkRunner.Blocked(mode, maxUsd,
            "Set --reserve-usd (or SIRLOCKED_BENCHMARK_RESERVATION_USD) to a conservative per-call reservation before live mode. No provider call was attempted.");
        exitCode = 2;
    }
    else
    {
        report = await LiveBenchmarkRunner.RunAsync(
            new Uri(baseUrl, UriKind.Absolute), token, maxUsd, reserveUsd,
            GetOption("--state"), mode.Equals("resume", StringComparison.OrdinalIgnoreCase));
        exitCode = 0;
    }
}
else
{
    Console.Error.WriteLine("Usage: dotnet run --project tools/AiPromptBenchmark -- --mode mock|live|resume [--output report.json] [--max-usd 5] [--reserve-usd 0.25]");
    return 2;
}

var json = JsonSerializer.Serialize(report, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });
if (!string.IsNullOrWhiteSpace(output))
{
    var path = Path.GetFullPath(output);
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    await File.WriteAllTextAsync(path, json);
    var markdownPath = Path.ChangeExtension(path, ".md");
    await File.WriteAllTextAsync(markdownPath, LiveBenchmarkRunner.ToMarkdown(report));
}
Console.WriteLine(json);
return exitCode;

string? GetOption(string name)
{
    var index = Array.FindIndex(args, arg => string.Equals(arg, name, StringComparison.OrdinalIgnoreCase));
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
}
