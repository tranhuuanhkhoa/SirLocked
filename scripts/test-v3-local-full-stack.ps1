[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repoRoot 'docker-compose.v3-local.yml'
$apiProject = Join-Path $repoRoot 'src/BE/SirLocked.API.csproj'
$frontendRoot = Join-Path $repoRoot 'src/FE'
$apiOut = 'C:\tmp\sirlocked-v3-full-stack-api.out.log'
$apiErr = 'C:\tmp\sirlocked-v3-full-stack-api.err.log'
$apiProcess = $null

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required for the isolated V3 full-stack gate.'
}

$passwordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(18)
$jwtBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(64)
$testPassword = 'V3!' + [Convert]::ToBase64String($passwordBytes).Replace('/', 'x').Replace('+', 'Y')
$jwtSecret = [Convert]::ToBase64String($jwtBytes)

try {
    docker compose -f $composeFile up -d --wait
    if ($LASTEXITCODE -ne 0) { throw "Docker compose failed with exit code $LASTEXITCODE." }

    $env:ASPNETCORE_ENVIRONMENT = 'V3Local'
    $env:Jwt__Secret = $jwtSecret
    $env:V3LocalAudit__TestPassword = $testPassword
    $env:VITE_API_URL = 'http://127.0.0.1:5290'
    $env:SIRLOCKED_RUN_V3_FULL_STACK = 'true'
    $env:SIRLOCKED_V3_TEST_PASSWORD = $testPassword

    $apiProcess = Start-Process `
        -FilePath 'dotnet' `
        -ArgumentList @('run', '--project', $apiProject, '--urls', 'http://127.0.0.1:5290') `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $apiOut `
        -RedirectStandardError $apiErr `
        -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $healthy = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($apiProcess.HasExited) {
            throw "V3 API exited before readiness. Inspect $apiOut and $apiErr."
        }
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5290/health' -TimeoutSec 2
            if ($health -eq 'Healthy' -or $health.status -eq 'Healthy') { $healthy = $true; break }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $healthy) { throw "Timed out waiting for V3 API health. Inspect $apiOut and $apiErr." }

    Push-Location $frontendRoot
    try {
        & npm.cmd run test:ui -- tests/v3-full-stack-local.spec.ts
        if ($LASTEXITCODE -ne 0) { throw "V3 full-stack Playwright gate failed with exit code $LASTEXITCODE." }
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item Env:ASPNETCORE_ENVIRONMENT -ErrorAction SilentlyContinue
    Remove-Item Env:Jwt__Secret -ErrorAction SilentlyContinue
    Remove-Item Env:V3LocalAudit__TestPassword -ErrorAction SilentlyContinue
    Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
    Remove-Item Env:SIRLOCKED_RUN_V3_FULL_STACK -ErrorAction SilentlyContinue
    Remove-Item Env:SIRLOCKED_V3_TEST_PASSWORD -ErrorAction SilentlyContinue
    docker compose -f $composeFile down
}
