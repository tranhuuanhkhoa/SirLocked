[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'docker-compose.v3-local.yml'
$apiProject = Join-Path $repoRoot 'src/BE/SirLocked.API.csproj'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required for the isolated V3 local environment.'
}

$passwordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(18)
$jwtBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(64)
$testPassword = 'V3!' + [Convert]::ToBase64String($passwordBytes).Replace('/', 'x').Replace('+', 'Y')
$jwtSecret = [Convert]::ToBase64String($jwtBytes)

try {
    docker compose -f $composeFile up -d --wait
    $env:ASPNETCORE_ENVIRONMENT = 'V3Local'
    $env:Jwt__Secret = $jwtSecret
    $env:V3LocalAudit__TestPassword = $testPassword

    Write-Host 'Local-only V3 accounts:'
    Write-Host '  audit_investigator@audit.invalid'
    Write-Host '  audit_interrogator@audit.invalid'
    Write-Host "  Password: $testPassword"
    dotnet run --project $apiProject --urls http://127.0.0.1:5290
}
finally {
    Remove-Item Env:ASPNETCORE_ENVIRONMENT -ErrorAction SilentlyContinue
    Remove-Item Env:Jwt__Secret -ErrorAction SilentlyContinue
    Remove-Item Env:V3LocalAudit__TestPassword -ErrorAction SilentlyContinue
    docker compose -f $composeFile down
}
