param(
    [string]$ConnectionString = 'mongodb://127.0.0.1:27018',
    [string]$DatabaseName = 'sirlocked_v3_local',
    [string]$OutputPath = 'C:\tmp\sirlocked-v3-playtest-events.csv'
)

$ErrorActionPreference = 'Stop'

if ($ConnectionString.StartsWith('mongodb+srv', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing SRV/Atlas connection. V3 playtest export is local-only.'
}

$uri = [System.Uri]$ConnectionString
$loopbackHosts = @('127.0.0.1', 'localhost', '::1')
if ($uri.Scheme -ne 'mongodb' -or $loopbackHosts -notcontains $uri.Host) {
    throw "Refusing non-loopback MongoDB host '$($uri.Host)'."
}
if (-not $DatabaseName.StartsWith('sirlocked_v3_', [System.StringComparison]::Ordinal)) {
    throw "Refusing database '$DatabaseName'; required prefix is sirlocked_v3_."
}

$mongoExport = Get-Command mongoexport -ErrorAction SilentlyContinue
if (-not $mongoExport) {
    throw 'mongoexport is not installed. Install MongoDB Database Tools locally; do not substitute Atlas.'
}

$outputDirectory = Split-Path -Parent $OutputPath
if ([string]::IsNullOrWhiteSpace($outputDirectory)) {
    throw 'OutputPath must include an explicit directory.'
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$fields = 'sessionPseudonym,userHash,role,eventType,stateVersion,attemptId,revision,durationMs,count,timestamp'
& $mongoExport.Source `
    --uri $ConnectionString `
    --db $DatabaseName `
    --collection v3PlaytestEvents `
    --type csv `
    --fields $fields `
    --out $OutputPath

if ($LASTEXITCODE -ne 0) {
    throw "mongoexport failed with exit code $LASTEXITCODE."
}

Write-Output "Exported privacy-safe local V3 events to $OutputPath"
