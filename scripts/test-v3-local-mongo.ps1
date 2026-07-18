[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'docker-compose.v3-local.yml'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required for the isolated V3 Mongo integration gate.'
}

try {
    docker compose -f $composeFile up -d --wait
    $env:SIRLOCKED_RUN_V3_MONGO_IT = 'true'
    dotnet test (Join-Path $repoRoot 'src/BE/IntegrationTests/SirLocked.IntegrationTests.csproj') --no-restore
    if ($LASTEXITCODE -ne 0) {
        throw "V3 Mongo integration tests failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item Env:SIRLOCKED_RUN_V3_MONGO_IT -ErrorAction SilentlyContinue
    docker compose -f $composeFile down
}
