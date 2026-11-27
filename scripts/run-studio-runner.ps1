param([switch]$Check)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source

if (-not $env:SIRLOCKED_CODEX_BIN) {
    $codex = (Get-Command codex.exe -ErrorAction SilentlyContinue).Source
    if (-not $codex) {
        $codex = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.InstallLocation 'app/resources/codex.exe' } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
    }
    if (-not $codex) {
        throw 'Khong tim thay Codex CLI. Cai Codex hoac dat SIRLOCKED_CODEX_BIN.'
    }
    $env:SIRLOCKED_CODEX_BIN = $codex
}

$runnerArgs = @(Join-Path $repoRoot 'tools/studio-runner/src/index.mjs')
if ($Check) { $runnerArgs += '--check' }
& $node @runnerArgs
exit $LASTEXITCODE
