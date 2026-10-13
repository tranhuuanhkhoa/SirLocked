[CmdletBinding()]
param(
    [int]$MongoPort = 27027,
    [int]$ApiPort = 5327,
    [int]$FrontendPort = 5287,
    [ValidateSet('win','loss')]
    [string]$Ending = 'win'
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$mongoExe = Join-Path $repoRoot '.tools/mongodb-it-8.0.8/mongod.exe'
if (!(Test-Path -LiteralPath $mongoExe)) {
    throw 'The bundled local MongoDB binary is missing. Use scripts/test-v3-full-stack.ps1 with your own loopback MongoDB instead.'
}
$probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $MongoPort)
try { $probe.Start() } finally { $probe.Stop() }
$runRoot = Join-Path $repoRoot ('tmp/full-train-case-' + [Guid]::NewGuid().ToString('N'))
$dbPath = Join-Path $runRoot 'mongo'
New-Item -ItemType Directory -Path $dbPath -Force | Out-Null
$mongoLog = Join-Path $runRoot 'mongo.log'
$mongo = Start-Process -FilePath $mongoExe -ArgumentList @('--bind_ip','127.0.0.1','--port',"$MongoPort",'--dbpath',('"'+$dbPath+'"'),'--logpath',('"'+$mongoLog+'"')) -WindowStyle Hidden -PassThru
$previousEnding = $env:SIRLOCKED_TEST_ENDING
try {
    $env:SIRLOCKED_TEST_ENDING = $Ending
    $ready = $false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        if ($mongo.HasExited) { throw "Local MongoDB exited. See $mongoLog" }
        $client = [Net.Sockets.TcpClient]::new()
        try { $client.Connect('127.0.0.1',$MongoPort); $ready = $true; break }
        catch { Start-Sleep -Milliseconds 250 }
        finally { $client.Dispose() }
    }
    if (!$ready) { throw 'Local MongoDB did not start.' }
    & (Join-Path $repoRoot 'scripts/test-v3-full-stack.ps1') -PointClick -CaseJsonPath (Join-Path $PSScriptRoot 'case.json') `
        -MongoConnectionString "mongodb://127.0.0.1:$MongoPort/?serverSelectionTimeoutMS=3000" -ApiPort $ApiPort -FrontendPort $FrontendPort `
        *>&1 | Tee-Object -FilePath (Join-Path $runRoot 'test.log')
    if ($LASTEXITCODE -ne 0) { throw "Full train case playthrough failed with exit code $LASTEXITCODE." }
}
finally {
    $env:SIRLOCKED_TEST_ENDING = $previousEnding
    if (!$mongo.HasExited) { Stop-Process -Id $mongo.Id -Force }
    Write-Host "Full train test logs: $runRoot"
}
