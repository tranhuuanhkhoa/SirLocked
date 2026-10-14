[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$statePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'tmp/local-demo/processes.json'
if (!(Test-Path -LiteralPath $statePath)) { Write-Host 'No managed local demo is running.'; return }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
# PID plus creation time prevents accidentally stopping an unrelated process after PID reuse.
foreach ($entry in @($state.Processes | Sort-Object { if ($_.Name -eq 'mongo') { 1 } else { 0 } })) {
    $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([DateTimeOffset]$entry.StartedUtc).UtcDateTime.Ticks) {
        Stop-Process -Id $process.Id -ErrorAction Stop
        Write-Host "Stopped $($entry.Name)."
    }
}
Remove-Item -LiteralPath $statePath
Write-Host 'Demo stopped. MongoDB data and logs remain in tmp/local-demo.'
