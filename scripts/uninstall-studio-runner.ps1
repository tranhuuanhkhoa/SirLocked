# Go tac vu tu chay cua runner:
#   powershell -ExecutionPolicy Bypass -File scripts/uninstall-studio-runner.ps1
$ErrorActionPreference = 'Stop'
$taskName = 'SirLocked Studio Runner'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Da go tac vu '$taskName'."
} else {
    Write-Host "Khong co tac vu '$taskName'."
}
