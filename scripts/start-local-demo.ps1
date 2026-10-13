[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$ApiPort = 5216,
    [ValidateRange(1024, 65535)][int]$FrontendPort = 5174,
    [ValidateRange(1024, 65535)][int]$MongoPort = 27020,
    [string]$MongoExecutable,
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runRoot = Join-Path $repoRoot 'tmp/local-demo'
$statePath = Join-Path $runRoot 'processes.json'
$apiRoot = Join-Path $repoRoot 'src/BE'
$frontendRoot = Join-Path $repoRoot 'src/FE'
$apiOutput = Join-Path $runRoot 'api'
$apiUrl = "http://127.0.0.1:$ApiPort"
$frontendUrl = "http://127.0.0.1:$FrontendPort"
$ownedProcesses = @()

function Save-DemoState {
    @{ Processes = $script:ownedProcesses; ApiUrl = $apiUrl; FrontendUrl = $frontendUrl; MongoPort = $MongoPort } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Wait-DemoMongo {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
        $client = [Net.Sockets.TcpClient]::new()
        try {
            if ($client.ConnectAsync('127.0.0.1', $MongoPort).Wait(500) -and $client.Connected) { return }
        }
        catch { }
        finally { $client.Dispose() }
        if (!(Get-Process -Id $script:ownedProcesses[0].Id -ErrorAction SilentlyContinue)) {
            throw "MongoDB exited. See $runRoot/mongo.err.log and mongo.out.log."
        }
        Start-Sleep -Milliseconds 250
    }
    throw "MongoDB did not become ready on port $MongoPort. See $runRoot for logs."
}

function Start-DemoProcess($Name, $Executable, $Arguments, $Directory, $EnvironmentOverrides) {
    $saved = @{}
    try {
        foreach ($key in $EnvironmentOverrides.Keys) {
            $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $EnvironmentOverrides[$key], 'Process')
        }
        $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory `
            -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runRoot "$Name.out.log") `
            -RedirectStandardError (Join-Path $runRoot "$Name.err.log") -PassThru
        return @{ Name = $Name; Id = $process.Id; StartedUtc = $process.StartTime.ToUniversalTime().ToString('o') }
    }
    finally {
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
    }
}

function Wait-DemoHttp($Url, $ExpectHealthy = $false) {
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -eq 200 -and (!$ExpectHealthy -or $response.Content.Trim() -eq 'Healthy')) { return }
        }
        catch { }
        foreach ($entry in $script:ownedProcesses) {
            if (!(Get-Process -Id $entry.Id -ErrorAction SilentlyContinue)) {
                throw "$($entry.Name) exited. See $runRoot for logs."
            }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for $Url. See $runRoot for logs."
}

if (Test-Path -LiteralPath $statePath) {
    throw 'A local demo state file already exists. Run ./scripts/stop-local-demo.ps1 before starting again.'
}
if (@($ApiPort, $FrontendPort, $MongoPort | Select-Object -Unique).Count -ne 3) {
    throw 'API, frontend and MongoDB ports must be different.'
}
foreach ($port in @($ApiPort, $FrontendPort, $MongoPort)) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    try { $probe.Start() }
    catch { throw "Port $port is already occupied. Choose a different port; existing processes are never stopped." }
    finally { $probe.Stop() }
}
$dotnet = (Get-Command dotnet -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
if (!$MongoExecutable) {
    $onPath = Get-Command mongod -ErrorAction SilentlyContinue
    if ($onPath) { $MongoExecutable = $onPath.Source }
    elseif (Test-Path (Join-Path $repoRoot '.tools')) {
        $MongoExecutable = Get-ChildItem (Join-Path $repoRoot '.tools') -Filter mongod.exe -Recurse -File |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
}
if (!$MongoExecutable -or !(Test-Path -LiteralPath $MongoExecutable)) {
    throw 'MongoDB executable not found. Install MongoDB or pass -MongoExecutable <absolute path to mongod.exe>.'
}
if (!(Test-Path (Join-Path $frontendRoot 'node_modules/vite/bin/vite.js'))) {
    throw 'Frontend dependencies are missing. Run npm ci from src/FE first.'
}
if (!$NoBuild) {
    & $dotnet build (Join-Path $apiRoot 'SirLocked.Api.csproj') --no-restore --output $apiOutput
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed. On a new machine, run dotnet restore SirLocked.sln first.' }
}
$apiDll = Join-Path $apiOutput 'SirLocked.Api.dll'
if (!(Test-Path -LiteralPath $apiDll)) { throw 'Backend binary missing. Run again without -NoBuild.' }
New-Item -ItemType Directory -Path (Join-Path $runRoot 'mongo-data') -Force | Out-Null
$jwtBytes = New-Object byte[] 64
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($jwtBytes) } finally { $rng.Dispose() }
# These credentials belong only to this loopback demo database. Never use this launcher for hosting.
$demoPassword = 'LocalDemo123!'
$overrides = @{
    ASPNETCORE_ENVIRONMENT = 'Development'
    MongoDb__ConnectionString = "mongodb://127.0.0.1:$MongoPort/?serverSelectionTimeoutMS=10000"
    MongoDb__DatabaseName = 'SirLockedLocalDemo'
    Jwt__Secret = [Convert]::ToBase64String($jwtBytes)
    Auth__SeedDefaultAdmin = 'true'
    Auth__SeedAdminEmail = 'admin@sirlocked.local'
    Auth__SeedAdminPassword = $demoPassword
    Auth__AutoVerifyRegistrations = 'true'
    Email__FrontendUrl = $frontendUrl
    Cors__AllowedOrigins__0 = $frontendUrl
    Cors__AllowedOrigins__1 = "http://localhost:$FrontendPort"
    MOCK_AI_RESPONSES = 'true'
    SKIP_ASSET_GENERATION = 'true'
    AiQuota__Enabled = 'false'
    PresentationVideo__Enabled = 'false'
    Cloudinary__Enabled = 'false'
    GameplayV3__Enabled = 'true'
    GameplayV3__PlaytestInstrumentationEnabled = 'false'
}
try {
    $ownedProcesses += Start-DemoProcess 'mongo' $MongoExecutable @(
        '--bind_ip', '127.0.0.1', '--port', $MongoPort,
        '--dbpath', ('"' + (Join-Path $runRoot 'mongo-data') + '"')
    ) $repoRoot @{}
    Save-DemoState
    Wait-DemoMongo
    $ownedProcesses += Start-DemoProcess 'api' $dotnet @(('"' + $apiDll + '"'), '--urls', $apiUrl) $apiRoot $overrides
    Save-DemoState
    Wait-DemoHttp "$apiUrl/health" $true

    $loginBody = @{ email = 'admin@sirlocked.local'; password = $demoPassword } | ConvertTo-Json
    $login = Invoke-RestMethod "$apiUrl/api/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody
    $headers = @{ Authorization = "Bearer $($login.data.token)" }
    $catalogue = Invoke-RestMethod "$apiUrl/api/cases/published" -Headers $headers
    $demoCases = @('case-v3-broken-seal-en', 'case-v3-broken-seal-vi')
    $missingCases = @($demoCases | Where-Object { $_ -notin @($catalogue.data.caseId) })
    if ($missingCases.Count -eq 2) {
        Invoke-RestMethod "$apiUrl/api/admin/cases/seed-crack-demo" -Method Post -Headers $headers | Out-Null
    }
    elseif ($missingCases.Count -gt 0) {
        Write-Warning 'The demo catalogue was edited. Use Seed Crack cases in Admin after existing matches finish to restore both cases.'
    }
    $pointClickCases = @('case-point-click-night-ledger-en', 'case-point-click-night-ledger-vi')
    $missingPointClickCases = @($pointClickCases | Where-Object { $_ -notin @($catalogue.data.caseId) })
    if ($missingPointClickCases.Count -eq 2) {
        Invoke-RestMethod "$apiUrl/api/admin/cases/seed-point-click-demo" -Method Post -Headers $headers | Out-Null
    }
    elseif ($missingPointClickCases.Count -gt 0) {
        Write-Warning 'One point-and-click case is missing. Existing matches and edited case content were retained.'
    }
    foreach ($number in 1, 2) {
        $registration = @{ fullName = "Detective $number"; email = "player$number@demo.sirlocked.local"; password = $demoPassword } | ConvertTo-Json
        try { Invoke-RestMethod "$apiUrl/api/auth/register" -Method Post -ContentType 'application/json' -Body $registration | Out-Null }
        catch { if ([int]$_.Exception.Response.StatusCode -ne 409) { throw } }
    }
    $vitePath = Join-Path $frontendRoot 'node_modules/vite/bin/vite.js'
    $ownedProcesses += Start-DemoProcess 'frontend' $node @(
        ('"' + $vitePath + '"'), '--host', '127.0.0.1', '--port', $FrontendPort, '--strictPort'
    ) $frontendRoot @{ VITE_API_URL = $apiUrl }
    Save-DemoState
    Wait-DemoHttp $frontendUrl
    Write-Host "Demo ready: $frontendUrl"
    Write-Host "Health: $apiUrl/health"
    Write-Host 'Local accounts: admin@sirlocked.local, player1@demo.sirlocked.local, player2@demo.sirlocked.local'
    Write-Host "Local demo password: $demoPassword"
    Write-Host 'Open two browser profiles/private windows, select different roles, ready both players, then start.'
    Write-Host 'Choose The Night Ledger / Cuon so trong dem for the complete point-and-click case.'
    Write-Host 'Stop with ./scripts/stop-local-demo.ps1. Saved local matches are retained.'
}
catch {
    foreach ($entry in $ownedProcesses) {
        $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $entry.StartedUtc) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    throw
}
