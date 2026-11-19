# Chay mot lan tren may chay bot (khong can quyen admin):
#   powershell -ExecutionPolicy Bypass -File scripts/install-studio-runner.ps1
# Dang ky tac vu "SirLocked Studio Runner": moi lan dang nhap Windows, runner tu chay an, giu ket noi toi
# /hubs/bridge va chay claude -p "/tao-vu-an" khi server bao co viec. Log: tmp/studio-runner/.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runnerDir = Join-Path $repoRoot 'tools/studio-runner'
$taskName = 'SirLocked Studio Runner'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Chua co Node.js (can Node 22 tro len).' }
if (-not [Environment]::GetEnvironmentVariable('SIRLOCKED_BRIDGE_KEY', 'User')) {
    Write-Warning 'Chua dat SIRLOCKED_BRIDGE_KEY cho tai khoan Windows: runner se dung ngay khi chay.'
}
if (-not (Test-Path (Join-Path $runnerDir 'node_modules/@microsoft/signalr'))) {
    Push-Location $runnerDir
    try { & npm.cmd ci --silent; if ($LASTEXITCODE -ne 0) { throw 'npm ci that bai trong tools/studio-runner.' } }
    finally { Pop-Location }
}

$command = "Set-Location -LiteralPath '$repoRoot'; node tools/studio-runner/src/index.mjs"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$command`"" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Runner cua xuong vu an SirLocked (tools/studio-runner).' -Force | Out-Null

Write-Host "Da dang ky tac vu '$taskName' (chay khi dang nhap)."
Write-Host "Chay ngay khong can dang nhap lai: Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Kiem tra: Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "Log: $(Join-Path $repoRoot 'tmp/studio-runner/runner.log')"
