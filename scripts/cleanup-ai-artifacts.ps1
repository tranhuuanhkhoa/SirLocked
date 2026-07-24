[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:5215',
    [Parameter(Mandatory = $true)]
    [string]$Token,
    [ValidateRange(1, 3650)]
    [int]$OlderThanDays = 30,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$applyValue = if ($Apply) { 'true' } else { 'false' }
$uri = "$($BaseUrl.TrimEnd('/'))/api/admin/ai-cases/artifacts/cleanup?apply=$applyValue&olderThanDays=$OlderThanDays"
$headers = @{ Authorization = "Bearer $Token" }
$result = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers
$result | ConvertTo-Json -Depth 8

if (-not $Apply) {
    Write-Host 'Dry-run only. Re-run with -Apply to delete the reported paths.'
}
