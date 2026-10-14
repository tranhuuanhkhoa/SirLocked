[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$mainStatePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'tmp/local-main/processes.json'
if (!(Test-Path -LiteralPath $mainStatePath)) { Write-Host 'No managed main-config application is registered.'; return }
$mainState = Get-Content -LiteralPath $mainStatePath -Raw | ConvertFrom-Json
foreach ($mainEntry in $mainState.Processes) {
    $mainChild = Get-Process -Id $mainEntry.Id -ErrorAction SilentlyContinue
    if ($mainChild -and $mainChild.StartTime.ToUniversalTime().Ticks -eq ([DateTimeOffset]$mainEntry.StartedUtc).UtcDateTime.Ticks) {
        Stop-Process -Id $mainChild.Id -ErrorAction Stop
        Write-Host "Stopped $($mainEntry.Name)."
    }
}
Remove-Item -LiteralPath $mainStatePath
Write-Host 'Main-config application stopped. Database data and logs are retained.'
