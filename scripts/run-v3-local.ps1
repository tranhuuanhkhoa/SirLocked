[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'docker-compose.v3-local.yml'
$apiProject = Join-Path $repoRoot 'src/BE/SirLocked.API.csproj'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required for the isolated V3 local environment.'
}

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $passwordBytes = New-Object byte[] 18
    $jwtBytes = New-Object byte[] 64
    $rng.GetBytes($passwordBytes)
    $rng.GetBytes($jwtBytes)
}
finally {
    $rng.Dispose()
}
$testPassword = 'V3!' + [Convert]::ToBase64String($passwordBytes).Replace('/', 'x').Replace('+', 'Y')
$jwtSecret = [Convert]::ToBase64String($jwtBytes)

try {
    docker compose -f $composeFile up -d --wait
    $env:ASPNETCORE_ENVIRONMENT = 'V3Local'
    $env:Jwt__Secret = $jwtSecret
    $env:V3LocalAudit__TestPassword = $testPassword
    $env:MongoDb__AuditSafetyMode = 'true'
    $env:MongoDb__ConnectionString = 'mongodb://127.0.0.1:27018'
    $env:MongoDb__DatabaseName = 'sirlocked_v3_local'

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
    Remove-Item Env:MongoDb__AuditSafetyMode -ErrorAction SilentlyContinue
    Remove-Item Env:MongoDb__ConnectionString -ErrorAction SilentlyContinue
    Remove-Item Env:MongoDb__DatabaseName -ErrorAction SilentlyContinue
    docker compose -f $composeFile down
}
