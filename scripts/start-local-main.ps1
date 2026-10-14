[CmdletBinding()]
param(
    [ValidateRange(1024,65535)][int]$ApiPort = 5215,
    [ValidateRange(1024,65535)][int]$FrontendPort = 5173,
    [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
$mainRepoRoot = Split-Path -Parent $PSScriptRoot
$mainRunRoot = Join-Path $mainRepoRoot 'tmp/local-main'
$mainStatePath = Join-Path $mainRunRoot 'processes.json'
$mainApiRoot = Join-Path $mainRepoRoot 'src/BE'
$mainFrontendRoot = Join-Path $mainRepoRoot 'src/FE'
$mainApiOutput = Join-Path $mainRunRoot 'api'
$mainApiUrl = "http://localhost:$ApiPort"
$mainFrontendUrl = "http://localhost:$FrontendPort"
$mainOwnedProcesses = @()
if (Test-Path -LiteralPath $mainStatePath) { throw 'A managed main-config application is already registered. Run scripts/stop-local-main.ps1 first.' }
if ($ApiPort -eq $FrontendPort) { throw 'API and frontend ports must differ.' }
foreach ($mainPort in @($ApiPort,$FrontendPort)) {
    $mainPortProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$mainPort)
    try { $mainPortProbe.Start() }
    catch { throw "Port $mainPort is occupied; existing processes are left running." }
    finally { $mainPortProbe.Stop() }
}
$mainDotnet = (Get-Command dotnet -ErrorAction Stop).Source
$mainNode = (Get-Command node -ErrorAction Stop).Source
$mainVitePath = Join-Path $mainFrontendRoot 'node_modules/vite/bin/vite.js'
if (!(Test-Path -LiteralPath $mainVitePath)) { throw 'Frontend dependencies are missing.' }
New-Item -ItemType Directory -Path $mainRunRoot -Force | Out-Null
if (!$NoBuild) {
    & $mainDotnet build (Join-Path $mainApiRoot 'SirLocked.Api.csproj') --no-restore --output $mainApiOutput
    if ($LASTEXITCODE -ne 0) { throw 'Main API build failed.' }
}
$mainApiDll = Join-Path $mainApiOutput 'SirLocked.Api.dll'
if (!(Test-Path -LiteralPath $mainApiDll)) { throw 'Main API binary is missing.' }

function Save-MainState {
    @{ Mode = 'MainConfig'; ApiUrl = $mainApiUrl; FrontendUrl = $mainFrontendUrl; Processes = $script:mainOwnedProcesses } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $mainStatePath -Encoding utf8
}
function Start-MainProcess($Name,$Executable,$Arguments,$Directory,$Overrides) {
    $mainSavedEnvironment = @{}
    try {
        foreach ($mainKey in $Overrides.Keys) {
            $mainSavedEnvironment[$mainKey] = [Environment]::GetEnvironmentVariable($mainKey,'Process')
            [Environment]::SetEnvironmentVariable($mainKey,$Overrides[$mainKey],'Process')
        }
        $mainChild = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory `
            -WindowStyle Hidden -RedirectStandardOutput (Join-Path $mainRunRoot "$Name.out.log") `
            -RedirectStandardError (Join-Path $mainRunRoot "$Name.err.log") -PassThru
        return @{ Name = $Name; Id = $mainChild.Id; StartedUtc = $mainChild.StartTime.ToUniversalTime().ToString('o') }
    }
    finally {
        foreach ($mainKey in $mainSavedEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($mainKey,$mainSavedEnvironment[$mainKey],'Process')
        }
    }
}
function Wait-MainHttp($Url,$Healthy = $false) {
    $mainDeadline = [DateTime]::UtcNow.AddSeconds(55)
    while ([DateTime]::UtcNow -lt $mainDeadline) {
        try {
            $mainResponse = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($mainResponse.StatusCode -eq 200 -and (!$Healthy -or $mainResponse.Content.Trim() -eq 'Healthy')) { return }
        }
        catch { }
        foreach ($mainEntry in $script:mainOwnedProcesses) {
            if (!(Get-Process -Id $mainEntry.Id -ErrorAction SilentlyContinue)) { throw "$($mainEntry.Name) exited; inspect tmp/local-main logs." }
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for $Url; inspect tmp/local-main logs."
}
try {
    # The normal application reads its existing .env and Development settings.
    # Do not inject demo DB, mock, quota, auth, budget or asset overrides here.
    $mainOwnedProcesses += Start-MainProcess 'api' $mainDotnet @(('"' + $mainApiDll + '"'),'--urls',$mainApiUrl) $mainApiRoot @{ ASPNETCORE_ENVIRONMENT = 'Development' }
    Save-MainState
    Wait-MainHttp "$mainApiUrl/health" $true
    $mainOwnedProcesses += Start-MainProcess 'frontend' $mainNode @(('"' + $mainVitePath + '"'),'--host','localhost','--port',$FrontendPort,'--strictPort') $mainFrontendRoot @{ VITE_API_URL = $mainApiUrl }
    Save-MainState
    Wait-MainHttp $mainFrontendUrl
    Write-Host "Main-config application ready: $mainFrontendUrl"
    Write-Host "API health: $mainApiUrl/health"
    Write-Host 'Uses the existing main database, accounts, provider settings and budget. No demo data is imported.'
}
catch {
    foreach ($mainEntry in $mainOwnedProcesses) {
        $mainChild = Get-Process -Id $mainEntry.Id -ErrorAction SilentlyContinue
        if ($mainChild -and $mainChild.StartTime.ToUniversalTime().Ticks -eq ([DateTimeOffset]$mainEntry.StartedUtc).UtcDateTime.Ticks) {
            Stop-Process -Id $mainChild.Id -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path -LiteralPath $mainStatePath) { Remove-Item -LiteralPath $mainStatePath }
    throw
}
