[CmdletBinding()]
param(
    [string]$ConnectionString = 'mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$testOutput = Join-Path $repoRoot ("tmp/test-v3-mongo-" + [Guid]::NewGuid().ToString('N'))
$mongoUri = [Uri]$ConnectionString
$mongoPort = if ($mongoUri.IsDefaultPort) { 27017 } else { $mongoUri.Port }
$mongoReachable = Test-NetConnection -ComputerName $mongoUri.Host -Port $mongoPort -InformationLevel Quiet
if (-not $mongoReachable) {
    throw "MongoDB dependency is unavailable at $($mongoUri.Host):$mongoPort. Start MongoDB before running the integration suite; no tests were skipped."
}
$env:SIRLOCKED_RUN_MONGO_IT = 'true'
$env:SIRLOCKED_TEST_MONGO_CONNECTION_STRING = $ConnectionString
try {
    dotnet test (Join-Path $repoRoot 'src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj') --no-restore --output $testOutput
    if ($LASTEXITCODE -ne 0) { throw "Mongo integration tests failed with exit code $LASTEXITCODE." }
}
finally {
    Remove-Item Env:SIRLOCKED_RUN_MONGO_IT -ErrorAction SilentlyContinue
    Remove-Item Env:SIRLOCKED_TEST_MONGO_CONNECTION_STRING -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testOutput) {
        $resolvedOutput = (Resolve-Path -LiteralPath $testOutput).Path
        $resolvedTmp = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'tmp')).Path
        if ($resolvedOutput.StartsWith($resolvedTmp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
        }
    }
}
