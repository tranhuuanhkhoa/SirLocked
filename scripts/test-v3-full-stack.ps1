[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$ApiPort = 5226,
    [ValidateRange(1024, 65535)]
    [int]$FrontendPort = 5186,
    [string]$MongoConnectionString = 'mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=3000',
    [string]$CaseJsonPath = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$apiProject = Join-Path $repoRoot 'src/BE/SirLocked.Api.csproj'
$apiContentRoot = Join-Path $repoRoot 'src/BE'
$frontendRoot = Join-Path $repoRoot 'src/FE'
$seederProject = Join-Path $repoRoot 'tools/FullStackTestSeeder/FullStackTestSeeder.csproj'
$runToken = [Guid]::NewGuid().ToString('N')
$databaseName = "sirlocked_it_$runToken"
$runRoot = Join-Path $repoRoot "tmp/crack-full-stack-$runToken"
$apiOutput = Join-Path $runRoot 'api'
$seederOutput = Join-Path $runRoot 'seeder'
$apiDll = Join-Path $apiOutput 'SirLocked.Api.dll'
$seederDll = Join-Path $seederOutput 'FullStackTestSeeder.dll'
$playableCasePath = Join-Path $runRoot 'playable-case.json'
$apiUrl = "http://127.0.0.1:$ApiPort"
$frontendUrl = "http://127.0.0.1:$FrontendPort"
$apiProcess = $null
$environmentKeys = @(
    'ASPNETCORE_ENVIRONMENT', 'Jwt__Secret', 'MongoDb__ConnectionString', 'MongoDb__DatabaseName',
    'MOCK_AI_RESPONSES', 'SKIP_ASSET_GENERATION', 'PresentationVideo__Enabled', 'Cloudinary__Enabled',
    'VITE_API_URL', 'SIRLOCKED_RUN_V3_FULL_STACK', 'SIRLOCKED_TEST_PASSWORD',
    'SIRLOCKED_TEST_API_URL', 'SIRLOCKED_PLAYWRIGHT_BASE_URL'
    'SIRLOCKED_TEST_CASE_PATH', 'SIRLOCKED_TEST_SEEDER_DLL', 'SIRLOCKED_TEST_MONGO', 'SIRLOCKED_TEST_DATABASE'
)
$previousEnvironment = @{}
foreach ($key in $environmentKeys) { $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }

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
$testPassword = 'IT!' + [Convert]::ToBase64String($passwordBytes).Replace('/', 'x').Replace('+', 'Y')
$jwtSecret = [Convert]::ToBase64String($jwtBytes)

try {
    New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
    foreach ($port in @($ApiPort, $FrontendPort)) {
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
        try { $probe.Start() }
        catch { throw "Refusing to run: loopback port $port is already occupied." }
        finally { $probe.Stop() }
    }

    dotnet build $seederProject --no-restore --output $seederOutput
    if ($LASTEXITCODE -ne 0) { throw "Test seeder build failed with exit code $LASTEXITCODE." }
    if ($CaseJsonPath) { $CaseJsonPath = (Resolve-Path -LiteralPath $CaseJsonPath).Path }
    dotnet $seederDll seed $MongoConnectionString $databaseName $testPassword $repoRoot $CaseJsonPath $playableCasePath
    if ($LASTEXITCODE -ne 0) { throw "Temporary database seed failed with exit code $LASTEXITCODE." }

    dotnet build $apiProject --configuration Debug --no-restore --output $apiOutput
    if ($LASTEXITCODE -ne 0) { throw "API build failed with exit code $LASTEXITCODE." }

    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:Jwt__Secret = $jwtSecret
    $env:MongoDb__ConnectionString = $MongoConnectionString
    $env:MongoDb__DatabaseName = $databaseName
    $env:MOCK_AI_RESPONSES = 'true'
    $env:SKIP_ASSET_GENERATION = 'true'
    $env:PresentationVideo__Enabled = 'false'
    $env:Cloudinary__Enabled = 'false'
    $env:VITE_API_URL = $apiUrl
    $env:SIRLOCKED_RUN_V3_FULL_STACK = 'true'
    $env:SIRLOCKED_TEST_PASSWORD = $testPassword
    $env:SIRLOCKED_TEST_API_URL = $apiUrl
    $env:SIRLOCKED_PLAYWRIGHT_BASE_URL = $frontendUrl
    $env:SIRLOCKED_TEST_CASE_PATH = if ($CaseJsonPath) { $playableCasePath } else { '' }
    $env:SIRLOCKED_TEST_SEEDER_DLL = $seederDll
    $env:SIRLOCKED_TEST_MONGO = $MongoConnectionString
    $env:SIRLOCKED_TEST_DATABASE = $databaseName

    $apiArguments = @(
        $apiDll,
        '--urls', $apiUrl,
        '--environment', 'Development',
        "--Jwt:Secret=$jwtSecret",
        "--MongoDb:ConnectionString=$MongoConnectionString",
        "--MongoDb:DatabaseName=$databaseName"
    )
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command dotnet).Source
    $startInfo.Arguments = ($apiArguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $startInfo.WorkingDirectory = $apiContentRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $apiProcess = [Diagnostics.Process]::new()
    $apiProcess.StartInfo = $startInfo
    if (-not $apiProcess.Start()) { throw 'Could not start the API test process.' }
    $apiProcess.BeginOutputReadLine()
    $apiProcess.BeginErrorReadLine()

    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $healthy = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($apiProcess.HasExited) {
            throw "API exited before readiness with code $($apiProcess.ExitCode)."
        }
        try {
            $health = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 2
            if ($health -eq 'Healthy' -or $health.status -eq 'Healthy') { $healthy = $true; break }
        }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $healthy) { throw 'Timed out waiting for API health.' }

    Push-Location $frontendRoot
    try {
        $npmExecutable = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'npm.cmd' } else { 'npm' }
        & $npmExecutable run test:ui -- tests/v3-full-stack.spec.ts
        if ($LASTEXITCODE -ne 0) { throw "V3 full-stack test failed with exit code $LASTEXITCODE." }
    }
    finally { Pop-Location }
}
finally {
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    foreach ($key in $environmentKeys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
    if (Test-Path -LiteralPath $seederDll) {
        dotnet $seederDll drop $MongoConnectionString $databaseName
    }
    Write-Host "Full-stack build artifacts retained at $runRoot."
}
