# Chay mot lan tren may chay bot (khong can quyen admin):
#   powershell -ExecutionPolicy Bypass -File scripts/install-studio-runner.ps1
# Dang ky tac vu "SirLocked Studio Runner": moi lan dang nhap Windows, runner tu chay an, giu ket noi toi
# /hubs/bridge va chay Codex khi server bao co viec. Log: tmp/studio-runner/.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runnerDir = Join-Path $repoRoot 'tools/studio-runner'
$taskName = 'SirLocked Studio Runner'

$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$codexExe = (Get-Command codex.exe -ErrorAction Stop).Source
if (-not [Environment]::GetEnvironmentVariable('SIRLOCKED_BRIDGE_KEY', 'User')) {
    throw 'Chua dat SIRLOCKED_BRIDGE_KEY cho tai khoan Windows.'
}
if (-not (Test-Path (Join-Path $runnerDir 'node_modules/@microsoft/signalr'))) {
    Push-Location $runnerDir
    try { & npm.cmd ci --silent; if ($LASTEXITCODE -ne 0) { throw 'npm ci that bai trong tools/studio-runner.' } }
    finally { Pop-Location }
}

Push-Location (Join-Path $repoRoot 'tools/studio-mcp')
try {
    if (-not (Test-Path 'node_modules/@modelcontextprotocol/sdk')) {
        & npm.cmd ci --silent
    } else {
        & npm.cmd run build --silent
    }
    if ($LASTEXITCODE -ne 0) { throw 'Khong build duoc sirlocked-studio MCP.' }
} finally { Pop-Location }

$runner = Join-Path $runnerDir 'src/index.mjs'
$quote = { param($value) "'" + $value.Replace("'", "''") + "'" }
$command = '$env:SIRLOCKED_CODEX_BIN = ' + (& $quote $codexExe) +
    '; & ' + (& $quote $nodeExe) + ' ' + (& $quote $runner) + '; exit $LASTEXITCODE'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$command`"" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description 'SirLocked: tu dong xu ly don bridge bang Codex tren may nay.' -Force | Out-Null

Write-Host "Da dang ky tac vu '$taskName' (chay khi dang nhap)."
Write-Host "Chay ngay khong can dang nhap lai: Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Kiem tra: Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "Log: $(Join-Path $repoRoot 'tmp/studio-runner/runner.log')"
